// M174 mutation check: every M174 guard is a single line tagged "// m174-guard:<id>" in peaceai/lib/editpropose.ts,
// loop.ts (the load diagnostics live there) or looprow.ts. For each one this test deletes that line and runs the M174 cases
// (m174-cases.ts) against the mutant in a child process group (capped at MUTANT_MS, group killed); at least one case
// must fail an assertion (not crash). Guards that only act in a real loop run need the stage-2 candidate uid.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { stage2CandUid } from "../lib/selfpropose.ts";

const ROOT = resolve(import.meta.dirname, "../..");
const libDir = join(ROOT, "peaceai/lib");
const LIB_FILES = ["editpropose.ts", "looprow.ts", "loop.ts"] as const;
const TAG = /\/\/ m174-guard:([a-z0-9-]+)(?:[\s",].*)?$/;
const sources: Record<string, string> = Object.fromEntries(LIB_FILES.map((f) => [f, readFileSync(join(libDir, f), "utf8")]));
const guards = Object.entries(sources).flatMap(([file, text]) => text.split("\n").flatMap((l, i) => { const m = TAG.exec(l); return m ? [{ id: m[1]!, file, line: i }] : []; }));
const NEEDS_CAND = new Set(["loop-row-load"]);
const cand = stage2CandUid({ PEACEAI_STAGE2_CAND: process.env.M151_CAND ?? process.env.M146_CAND ?? "peaceai-cand" }).ok;

let dir: string;
before(() => { dir = mkdtempSync(join(tmpdir(), "peaceai-m174-mut-")); });
after(() => rmSync(dir, { recursive: true, force: true }));

function rewrite(text: string, local: Record<string, string>, from: string): string {
  const tsPath = createRequire(join(libDir, "loop.ts")).resolve("typescript");
  return text
    .replace(/from "(?:\.\/|\.\.\/lib\/)([a-z0-9-]+\.ts)"/g, (_, f: string) => `from ${JSON.stringify(pathToFileURL(local[f] ?? join(libDir, f)).href)}`)
    .replace(/from "typescript"/g, `from ${JSON.stringify(pathToFileURL(tsPath).href)}`)
    .replace(/import\.meta\.dirname/g, JSON.stringify(from));
}

const MUTANT_MS = 600_000;
function runMutant(name: string, file: string, text: string): Promise<{ failed: string[]; crashed: string[]; skipped: string[]; cand: boolean } | null> {
  const local = Object.fromEntries(LIB_FILES.map((f) => [f, join(dir, `mutant-${name}-${f}`)]));
  for (const f of LIB_FILES) writeFileSync(local[f]!, rewrite(f === file ? text : sources[f]!, local, libDir));
  return new Promise((done, fail) => {
    const child = spawn(process.execPath, [...process.execArgv, join(import.meta.dirname, "m174-mutant-runner.ts"), local["editpropose.ts"]!, local["looprow.ts"]!, local["loop.ts"]!], { detached: true, stdio: ["ignore", "pipe", "inherit"] });
    let out = "";
    child.stdout.on("data", (d) => { out += d; });
    const timer = setTimeout(() => { try { process.kill(-child.pid!, "SIGKILL"); } catch { /* gone */ } }, MUTANT_MS);
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      if (signal === "SIGKILL") return done(null);
      if (code !== 0) return fail(new Error(`mutant runner exited ${code}`));
      done(JSON.parse(out.trim().split("\n").pop()!));
    });
  });
}

test("M174 mutation: the guard tags are unique and cover the guards", () => {
  const ids = guards.map((g) => g.id);
  assert.equal(new Set(ids).size, ids.length, "duplicate guard id");
  assert.deepEqual([...ids].sort(), [
    "cap", "host-inside", "host-no-modules", "host-no-modules-lex", "lc-all-fixed", "lc-export-only", "le-body", "le-kind", "le-not-listed", "le-one-decl",
    "le-plain", "le-single", "lm-needs-export", "lm-proposer", "lm-suite-load-only", "loop-row-load", "lr-v2-only", "module-lex-inside", "module-not-team",
    "module-not-test", "module-source", "name-ident", "re-not-test", "re-unique", "relative", "row-load-baseline", "row-load-code", "row-load-value",
    "row-reached-load", "star-opaque", "star-unknown", "type-only", "type-only-name",
].sort());
});

test("M174 mutation: the unmutated copies pass every case (the harness itself is sound)", async () => {
  const r = await runMutant("control", "none", "");
  assert.ok(r, "control hung");
  assert.deepEqual(r.crashed, []);
  assert.deepEqual(r.failed, []);
});

for (const g of guards) {
  test(`M174 mutation: deleting m174-guard:${g.id} makes a case fail`, async (t) => {
    if (NEEDS_CAND.has(g.id) && !cand) { t.skip("needs the stage-2 candidate uid (box / private job)"); return; }
    const text = sources[g.file]!.split("\n").filter((_, i) => i !== g.line).join("\n");
    const r = await runMutant(g.id, g.file, text);
    assert.ok(r, `m174-guard:${g.id} mutant hung`);
    assert.deepEqual(r.crashed, [], `m174-guard:${g.id} mutant crashed instead of failing an assertion`);
    assert.ok(r.failed.length > 0, `no case notices m174-guard:${g.id} removed`);
  });
}
