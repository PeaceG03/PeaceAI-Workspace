// M171 mutation check: every M171 guard is a single line tagged "// m171-guard:<id>" (a separate tag, so the M151 /
// M152 "// guard:" and the M169 "// m169-guard:" lists are unchanged) in peaceai/lib/loopdeps.ts, looprow.ts or
// loop.ts. For each one this test deletes that line and runs the M171 cases against the mutant in a child process group
// (capped at MUTANT_MS, group killed); at least one case must fail an assertion (not crash). In particular deleting
// the refusal of a failed check (loop-work, loop-iso-early, loop-iso) or any check itself must let some case notice.
// Guards that only act in a real loop run need the stage-2 candidate uid; elsewhere they are reported as skipped.
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
const LIB_FILES = ["loopdeps.ts", "looprow.ts", "loop.ts"] as const;
const TAG = /\/\/ m171-guard:([a-z0-9-]+)\s*$/;
const sources: Record<string, string> = Object.fromEntries(LIB_FILES.map((f) => [f, readFileSync(join(libDir, f), "utf8")]));
const guards = Object.entries(sources).flatMap(([file, text]) => text.split("\n").flatMap((l, i) => { const m = TAG.exec(l); return m ? [{ id: m[1]!, file, line: i }] : []; }));
const NO_CAND_OK = new Set(["row-isofail-code", "row-isofail-only", "row-isofail-public"]);
const cand = stage2CandUid({ PEACEAI_STAGE2_CAND: process.env.M171_CAND ?? process.env.M146_CAND ?? "" }).ok;

let dir: string;
before(() => { dir = mkdtempSync(join(tmpdir(), "peaceai-m171-mut-")); });
after(() => rmSync(dir, { recursive: true, force: true }));

function rewrite(text: string, local: Record<string, string>, from: string): string {
  const tsPath = createRequire(join(libDir, "loop.ts")).resolve("typescript");
  return text
    .replace(/from "(?:\.\/|\.\.\/lib\/)([a-z0-9-]+\.ts)"/g, (_, f: string) => `from ${JSON.stringify(pathToFileURL(local[f] ?? join(libDir, f)).href)}`)
    .replace(/from "typescript"/, `from ${JSON.stringify(pathToFileURL(tsPath).href)}`)
    .replace(/import\.meta\.dirname/g, JSON.stringify(from));
}

const MUTANT_MS = 600_000;
function runMutant(name: string, file: string, text: string): Promise<{ failed: string[]; crashed: string[]; skipped: string[]; cand: boolean } | null> {
  const local = Object.fromEntries(LIB_FILES.map((f) => [f, join(dir, `mutant-${name}-${f}`)]));
  for (const f of LIB_FILES) writeFileSync(local[f]!, rewrite(f === file ? text : sources[f]!, local, libDir));
  return new Promise((done, fail) => {
    const child = spawn(process.execPath, [...process.execArgv, join(import.meta.dirname, "m171-mutant-runner.ts"), local["loopdeps.ts"]!, local["looprow.ts"]!, local["loop.ts"]!], { detached: true, stdio: ["ignore", "pipe", "inherit"] });
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

test("M171 mutation: the guard tags are unique and cover the guards", () => {
  const ids = guards.map((g) => g.id);
  assert.equal(new Set(ids).size, ids.length, "duplicate guard id");
  assert.deepEqual([...ids].sort(), [
    "iso-access", "iso-config", "iso-in-work", "iso-links", "iso-work-mode", "loop-isofail", "loop-iso", "loop-iso-early", "loop-work",
    "row-isofail-code", "row-isofail-only", "row-isofail-public", "work-probe",
  ].sort());
});

test("M171 mutation: the unmutated copies pass every case (the harness itself is sound)", async () => {
  const r = await runMutant("control", "none", "");
  assert.ok(r, "control hung");
  assert.deepEqual(r.crashed, []);
  assert.deepEqual(r.failed, []);
});

for (const g of guards) {
  test(`M171 mutation: deleting m171-guard:${g.id} makes a case fail`, async (t) => {
    if (!NO_CAND_OK.has(g.id) && !cand) { t.skip("needs the stage-2 candidate uid (box / private job)"); return; }
    const text = sources[g.file]!.split("\n").filter((_, i) => i !== g.line).join("\n");
    const r = await runMutant(g.id, g.file, text);
    assert.ok(r, `m171-guard:${g.id} mutant hung`);
    assert.deepEqual(r.crashed, [], `m171-guard:${g.id} mutant crashed instead of failing an assertion`);
    assert.ok(r.failed.length > 0, `no case notices m171-guard:${g.id} removed`);
  });
}
