// M146 mutation check on the loop's safety guards: every guard in peaceai/lib/loop.ts is a single line tagged
// "// guard:<id>". For each one, this test deletes that line, writes the mutant to a temp dir and runs the M146 cases
// against it in a child process group (capped at MUTANT_MS, group killed). At least one case must fail with an
// assertion (not a crash), so no guard is untested. Guards that only act once candidate code runs (the isolation
// layer) are only exercised where the stage-2 candidate uid exists; elsewhere they are reported, not claimed.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { stage2CandUid } from "../lib/selfpropose.ts";

const libDir = resolve(import.meta.dirname, "../lib");
const source = readFileSync(join(libDir, "loop.ts"), "utf8");
const TAG = /\/\/ guard:([a-z0-9-]+)\s*$/;
const lines = source.split("\n");
const guards = lines.flatMap((l, i) => { const m = TAG.exec(l); return m ? [{ id: m[1]!, line: i }] : []; });
/** Guards on the isolated run itself: only observable where candidate code can run (the candidate uid exists). */
const NEEDS_CAND = new Set(["wrapper", "isolated", "isolation-exit", "team-tests"]);
const cand = stage2CandUid({ PEACEAI_STAGE2_CAND: process.env.M146_CAND ?? "peaceai-cand" }).ok;

let dir: string;
before(() => { dir = mkdtempSync(join(tmpdir(), "peaceai-m146-mut-")); });
after(() => rmSync(dir, { recursive: true, force: true }));

function rewrite(text: string): string {
  const tsPath = createRequire(join(libDir, "loop.ts")).resolve("typescript");
  return text
    .replace(/from "\.\/([a-z0-9-]+\.ts)"/g, (_, f: string) => `from ${JSON.stringify(pathToFileURL(join(libDir, f)).href)}`)
    .replace(/from "typescript"/, `from ${JSON.stringify(pathToFileURL(tsPath).href)}`)
    .replace(/import\.meta\.dirname/g, JSON.stringify(libDir));
}

const MUTANT_MS = 240_000;
function runMutant(file: string): Promise<{ failed: string[]; crashed: string[]; cand: boolean } | null> {
  return new Promise((done, fail) => {
    const child = spawn(process.execPath, [...process.execArgv, join(import.meta.dirname, "m146-mutant-runner.ts"), file], { detached: true, stdio: ["ignore", "pipe", "inherit"] });
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

test("M146 mutation: the guard tags are unique and cover the safety guards", () => {
  const ids = guards.map((g) => g.id);
  assert.equal(new Set(ids).size, ids.length, "duplicate guard id");
  assert.deepEqual([...ids].sort(), ["abs", "cand", "dotdot", "git-nm", "isolated", "isolation-exit", "lock", "realpath", "self-target", "symlink", "team-tests", "wrapper"]);
});

test("M146 mutation: the unmutated copy passes every case (the harness itself is sound)", async () => {
  const file = join(dir, "control.ts");
  writeFileSync(file, rewrite(source));
  const r = await runMutant(file);
  assert.ok(r, "control hung");
  assert.deepEqual(r.crashed, []);
  assert.deepEqual(r.failed, []);
});

for (const g of guards) {
  test(`M146 mutation: deleting guard:${g.id} makes a case fail`, async (t) => {
    if (NEEDS_CAND.has(g.id) && !cand) { t.skip("needs the stage-2 candidate uid (box / private job)"); return; }
    const file = join(dir, `mutant-${g.id}.ts`);
    writeFileSync(file, rewrite(lines.filter((_, i) => i !== g.line).join("\n")));
    const r = await runMutant(file);
    assert.ok(r, `guard:${g.id} mutant hung`);
    assert.deepEqual(r.crashed, [], `guard:${g.id} mutant crashed instead of failing an assertion`);
    assert.ok(r.failed.length > 0, `no case notices guard:${g.id} removed`);
  });
}
