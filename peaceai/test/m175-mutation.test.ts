// M175 mutation check: every M175 guard is a single line tagged "// m175-guard:<id>" in peaceai/lib/loop.ts or
// looprow.ts. For each one this test deletes that line and runs the M175 cases (m175-cases.ts) against the mutant in a
// child process group (capped at MUTANT_MS, group killed); at least one case must fail an assertion (not crash).
// Guards that only act in a real loop run need the stage-2 candidate uid. Spec: peaceai/spec/edit-gate-m175.md.
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
const LIB_FILES = ["looprow.ts", "loop.ts"] as const;
const TAG = /\/\/ m175-guard:([a-z0-9-]+)(?:[\s",].*)?$/;
const sources: Record<string, string> = Object.fromEntries(LIB_FILES.map((f) => [f, readFileSync(join(libDir, f), "utf8")]));
const guards = Object.entries(sources).flatMap(([file, text]) => text.split("\n").flatMap((l, i) => { const m = TAG.exec(l); return m ? [{ id: m[1]!, file, line: i }] : []; }));
const NEEDS_CAND = new Set(["scope-gate", "loop-row-scope", "loop-load-limit"]);
const cand = stage2CandUid({ PEACEAI_STAGE2_CAND: process.env.M175_CAND ?? process.env.M146_CAND ?? "" }).ok;

let dir: string;
before(() => { dir = mkdtempSync(join(tmpdir(), "peaceai-m175-mut-")); });
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
    const child = spawn(process.execPath, [...process.execArgv, join(import.meta.dirname, "m175-mutant-runner.ts"), local["looprow.ts"]!, local["loop.ts"]!], { detached: true, stdio: ["ignore", "pipe", "inherit"] });
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

test("M175 mutation: the guard tags are unique and cover the guards", () => {
  const ids = guards.map((g) => g.id);
  assert.equal(new Set(ids).size, ids.length, "duplicate guard id");
  assert.deepEqual([...ids].sort(), [
    "adds-import", "class-exists", "class-infra", "class-lockfile", "class-source", "class-test", "dangerous", "global-write", "loop-row-scope", "new-word", "policy",
    "row-scope-edit-mode", "row-scope-pass", "row-scope-value", "scope-gate", "shape-export", "skip-owned", "toplevel-count", "toplevel-kind",
    "export-at", "export-body", "export-decorated", "export-decorator", "export-kind", "export-parse", "export-plain", "export-single", "limit-bytes", "limit-files", "limit-ms", "loop-load-limit",
    "row-limit-attempts", "row-limit-baseline", "row-limit-v4",
  ].sort());
});

test("M175 mutation: the unmutated copies pass every case (the harness itself is sound)", async () => {
  const r = await runMutant("control", "none", "");
  assert.ok(r, "control hung");
  assert.deepEqual(r.crashed, []);
  assert.deepEqual(r.failed, []);
});

for (const g of guards) {
  test(`M175 mutation: deleting m175-guard:${g.id} makes a case fail`, async (t) => {
    if (NEEDS_CAND.has(g.id) && !cand) { t.skip("needs the stage-2 candidate uid (box / private job)"); return; }
    const text = sources[g.file]!.split("\n").filter((_, i) => i !== g.line).join("\n");
    const r = await runMutant(g.id, g.file, text);
    assert.ok(r, `m175-guard:${g.id} mutant hung`);
    assert.deepEqual(r.crashed, [], `m175-guard:${g.id} mutant crashed instead of failing an assertion`);
    assert.ok(r.failed.length > 0, `no case notices m175-guard:${g.id} removed`);
  });
}
