// M162 mutation check on the loop's planner wiring. Two kinds of mutant, each replayed against every M162 case
// (m162-cases.ts) in a child process group (capped at MUTANT_MS, group killed); at least one case must fail with an
// assertion (not a crash):
//  - guard deletions: each guard line tagged "// m162-guard:<id>" in peaceai/lib/loop.ts or peaceai/lib/looprow.ts
//    (a separate tag, so the m146 / m152 guard lists are unchanged) is deleted;
//  - semantic mutants: fixed rewrites of the wiring that bring back what M162 removes (a hard-coded v1 planner, a v1
//    default, a dropped --planner flag, a bypassed selectPlanner, one digest for every planner, a plan that ignores
//    the picked planner).
// Mutants that are only observable once the loop has planned need the stage-2 candidate uid; elsewhere they are
// reported (skipped), not claimed.
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
const loopSource = readFileSync(join(libDir, "loop.ts"), "utf8");
const rowSource = readFileSync(join(libDir, "looprow.ts"), "utf8");
const TAG = /\/\/ m162-guard:([a-z0-9-]+)\s*$/;
const tagged = (src: string, file: "loop" | "row") => src.split("\n").flatMap((l, i) => { const m = TAG.exec(l); return m ? [{ id: m[1]!, line: i, file }] : []; });
const guards = [...tagged(loopSource, "loop"), ...tagged(rowSource, "row")];
// [id, file, from, to, needsCand]: each `from` must occur exactly once
const SEMANTIC: [string, "loop" | "row", string, string, boolean][] = [
  ["hard-coded-v1", "loop", "const planner = o.planner ?? loopPlanner(undefined)!;", "const planner: PlannerName = \"plan-only-v1\";", false],
  ["default-v1", "loop", "const planner = o.planner ?? loopPlanner(undefined)!;", "const planner = o.planner ?? \"plan-only-v1\";", false],
  ["flag-dropped", "loop", "{ ...o, planner, proposer:", "{ ...o, proposer:", false],
  ["selector-bypassed", "loop", "return selectPlanner(flag)?.name ?? null;", "return flag === undefined ? \"plan-only-v1\" : (selectPlanner(flag)?.name ?? null);", false],
  ["sha-of-v3-always", "loop", "const plannerSha = LOOP_PLANNERS[planner].sha();", "const plannerSha = plannerSha256V3();", false],
  ["plan-v1-always", "loop", "plan = LOOP_PLANNERS[planner].plan(", "plan = LOOP_PLANNERS[\"plan-only-v1\"].plan(", true],
  ["row-v3-as-v2", "row", "if (v3 && !(LOOP_PLANNER_NAMES", "if (false && !(LOOP_PLANNER_NAMES", false],
];
const cand = stage2CandUid({ PEACEAI_STAGE2_CAND: process.env.M152_CAND ?? process.env.M146_CAND ?? "peaceai-cand" }).ok;

let dir: string;
before(() => { dir = mkdtempSync(join(tmpdir(), "peaceai-m162-mut-")); });
after(() => rmSync(dir, { recursive: true, force: true }));

function rewrite(text: string, rowFile: string | null): string {
  const tsPath = createRequire(join(libDir, "loop.ts")).resolve("typescript");
  return text
    .replace(/from "\.\/([a-z0-9-]+\.ts)"/g, (_, f: string) => `from ${JSON.stringify(pathToFileURL(f === "looprow.ts" && rowFile ? rowFile : join(libDir, f)).href)}`)
    .replace(/from "typescript"/, `from ${JSON.stringify(pathToFileURL(tsPath).href)}`)
    .replace(/import\.meta\.dirname/g, JSON.stringify(libDir));
}

const MUTANT_MS = 300_000;
function runMutant(name: string, loopText: string, rowText: string): Promise<{ failed: string[]; crashed: string[]; cand: boolean } | null> {
  const rowFile = join(dir, `mutant-${name}-looprow.ts`);
  const loopFile = join(dir, `mutant-${name}-loop.ts`);
  writeFileSync(rowFile, rewrite(rowText, null));
  writeFileSync(loopFile, rewrite(loopText, rowFile));
  return new Promise((done, fail) => {
    const child = spawn(process.execPath, [...process.execArgv, join(import.meta.dirname, "m162-mutant-runner.ts"), loopFile, rowFile], { detached: true, stdio: ["ignore", "pipe", "inherit"] });
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

test("M162 mutation: the guard tags are unique and cover the guards; every semantic mutant applies exactly once", () => {
  const ids = guards.map((g) => g.id);
  assert.equal(new Set(ids).size, ids.length, "duplicate guard id");
  assert.deepEqual([...ids].sort(), ["planner-unknown", "row-planner", "row-planner-sha"]);
  for (const [id, file, from] of SEMANTIC) assert.equal((file === "loop" ? loopSource : rowSource).split(from).length, 2, `${id}: the mutated text occurs once`);
});

test("M162 mutation: the unmutated copy passes every case (the harness itself is sound)", async () => {
  const r = await runMutant("control", loopSource, rowSource);
  assert.ok(r, "control hung");
  assert.deepEqual(r.crashed, []);
  assert.deepEqual(r.failed, []);
});

async function expectKilled(name: string, loopText: string, rowText: string): Promise<void> {
  const r = await runMutant(name, loopText, rowText);
  assert.ok(r, `${name} mutant hung`);
  assert.deepEqual(r.crashed, [], `${name} mutant crashed instead of failing an assertion`);
  assert.ok(r.failed.length > 0, `no case notices the ${name} mutant`);
}

for (const g of guards) {
  test(`M162 mutation: deleting m162-guard:${g.id} makes a case fail`, async () => {
    const drop = (src: string) => src.split("\n").filter((_, i) => i !== g.line).join("\n");
    await expectKilled(`guard-${g.id}`, g.file === "loop" ? drop(loopSource) : loopSource, g.file === "row" ? drop(rowSource) : rowSource);
  });
}

for (const [id, file, from, to, needsCand] of SEMANTIC) {
  test(`M162 mutation: the ${id} mutant makes a case fail`, async (t) => {
    if (needsCand && !cand) { t.skip("needs the stage-2 candidate uid (box / private job)"); return; }
    await expectKilled(id, file === "loop" ? loopSource.replace(from, to) : loopSource, file === "row" ? rowSource.replace(from, to) : rowSource);
  });
}
