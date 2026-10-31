// M152 mutation check on the edit proposer's guards: every guard in peaceai/lib/editpropose.ts is a single line tagged
// "// guard:<id>", and the loop's prepare-on-a-clean-copy line in peaceai/lib/loop.ts is tagged
// "// m152-guard:<id>" (a separate tag, so the m146 guard list is unchanged). For each one, this test deletes that
// line, writes the mutant (and a loop.ts that imports it) to a temp dir and runs the M152 cases against them in a
// child process group (capped at MUTANT_MS, group killed). At least one case must fail with an assertion (not a
// crash). The loop prepare guards are only observable with the stage-2 candidate uid; elsewhere they are reported
// (skipped), not claimed. loop-sha-proposer runs everywhere.
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
const propSource = readFileSync(join(libDir, "editpropose.ts"), "utf8");
const loopSource = readFileSync(join(libDir, "loop.ts"), "utf8");
const TAG = /\/\/ guard:([a-z0-9-]+)\s*$/;
const LOOP_TAG = /\/\/ m152-guard:([a-z0-9-]+)\s*$/;
const propLines = propSource.split("\n");
const loopLines = loopSource.split("\n");
const guards = [
  ...propLines.flatMap((l, i) => { const m = TAG.exec(l); return m ? [{ id: m[1]!, line: i, file: "prop" as const }] : []; }),
  ...loopLines.flatMap((l, i) => { const m = LOOP_TAG.exec(l); return m ? [{ id: `loop-${m[1]!}`, line: i, file: "loop" as const }] : []; }),
];
// loop guards observable without the candidate uid (the rest need the stage-2 isolation to reach them)
const NO_CAND_GUARDS = new Set(["loop-sha-proposer"]);
const cand = stage2CandUid({ PEACEAI_STAGE2_CAND: process.env.M152_CAND ?? process.env.M146_CAND ?? "peaceai-cand" }).ok;

let dir: string;
before(() => { dir = mkdtempSync(join(tmpdir(), "peaceai-m152-mut-")); });
after(() => rmSync(dir, { recursive: true, force: true }));

function rewrite(text: string, propFile: string | null): string {
  const tsPath = createRequire(join(libDir, "loop.ts")).resolve("typescript");
  return text
    .replace(/from "\.\/([a-z0-9-]+\.ts)"/g, (_, f: string) => `from ${JSON.stringify(pathToFileURL(f === "editpropose.ts" && propFile ? propFile : join(libDir, f)).href)}`)
    .replace(/from "typescript"/, `from ${JSON.stringify(pathToFileURL(tsPath).href)}`)
    .replace(/import\.meta\.dirname/g, JSON.stringify(libDir));
}

const MUTANT_MS = 300_000;
function runMutant(name: string, propText: string, loopText: string): Promise<{ failed: string[]; crashed: string[]; cand: boolean } | null> {
  const propFile = join(dir, `mutant-${name}-editpropose.ts`);
  const loopFile = join(dir, `mutant-${name}-loop.ts`);
  writeFileSync(propFile, rewrite(propText, null));
  writeFileSync(loopFile, rewrite(loopText, propFile));
  return new Promise((done, fail) => {
    const child = spawn(process.execPath, [...process.execArgv, join(import.meta.dirname, "m152-mutant-runner.ts"), propFile, loopFile], { detached: true, stdio: ["ignore", "pipe", "inherit"] });
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

test("M152 mutation: the guard tags are unique and cover the guards", () => {
  const ids = guards.map((g) => g.id);
  assert.equal(new Set(ids).size, ids.length, "duplicate guard id");
  assert.deepEqual([...ids].sort(), ["cap", "changed", "combine-improved", "dedupe", "generated", "loop-prepare-clean", "loop-prepare-failed", "loop-sha-proposer", "parse", "span-strings", "stop-unsafe", "test-path"]);
});

test("M152 mutation: the unmutated copy passes every case (the harness itself is sound)", async () => {
  const r = await runMutant("control", propSource, loopSource);
  assert.ok(r, "control hung");
  assert.deepEqual(r.crashed, []);
  assert.deepEqual(r.failed, []);
});

for (const g of guards) {
  test(`M152 mutation: deleting guard:${g.id} makes a case fail`, async (t) => {
    if (g.file === "loop" && !NO_CAND_GUARDS.has(g.id) && !cand) { t.skip("needs the stage-2 candidate uid (box / private job)"); return; }
    const drop = (lines: string[]) => lines.filter((_, i) => i !== g.line).join("\n");
    const r = await runMutant(g.id, g.file === "prop" ? drop(propLines) : propSource, g.file === "loop" ? drop(loopLines) : loopSource);
    assert.ok(r, `guard:${g.id} mutant hung`);
    assert.deepEqual(r.crashed, [], `guard:${g.id} mutant crashed instead of failing an assertion`);
    assert.ok(r.failed.length > 0, `no case notices guard:${g.id} removed`);
  });
}
