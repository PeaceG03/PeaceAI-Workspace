// M162: the loop and its CLI (bin/loop.ts, the public-set loop scorecard) pick the planner only through
// lib/plandefault.ts selectPlanner (default plan-only-v3 per #650), never a hard-coded v1, and record the planner and
// its plannerSha256 in every row. Behavior cases live in m162-cases.ts (replayed against mutants by
// m162-mutation.test.ts); this file adds static checks.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import * as loop from "../lib/loop.ts";
import * as row from "../lib/looprow.ts";
import { CASES } from "./m162-cases.ts";
import { setup, teardown, type M152Ctx } from "./m152-fixtures.ts";

const ROOT = resolve(import.meta.dirname, "../..");
let ctx: M152Ctx;
before(() => { ctx = setup(); });
after(() => teardown(ctx));

for (const c of CASES) test(`M162: ${c.id}`, () => c.run({ loop, row }, ctx));

test("M162: static: loop.ts imports selectPlanner and plans only through the planner table; no direct v1 planTask call is left in the task run", () => {
  const src = readFileSync(join(ROOT, "peaceai/lib/loop.ts"), "utf8");
  assert.match(src, /import \{ selectPlanner, type PlannerName \} from "\.\/plandefault\.ts";/);
  assert.match(src, /return selectPlanner\(flag\)\?\.name \?\? null;/);
  assert.doesNotMatch(src, /plan = planTask\(/, "the task run must not call v1's planTask directly");
  assert.equal([...src.matchAll(/LOOP_PLANNERS\[planner\]\.plan\(/g)].length, 1, "one plan site");
  assert.doesNotMatch(src, /DEFAULT_PLANNER/, "the loop never names the default itself");
});

test("M162: bin/loop.ts (the loop scorecard) refuses an unknown --planner before loading a task file, and names the planner in its summary", () => {
  const cli = readFileSync(join(ROOT, "peaceai/bin/loop.ts"), "utf8");
  assert.match(cli, /const planner = loopPlanner\(plannerFlag\);/);
  assert.match(cli, /runLoopFile\(file, \{[^}]*plannerFlag \}\)/);
  assert.match(cli, /console\.log\(`planner=\$\{planner\} tasks=/);
  const tsx = join(ROOT, "node_modules/.bin/tsx");
  for (const bad of ["V3", "v4"]) {
    let out = ""; let code = 0;
    try { out = execFileSync(tsx, [join(ROOT, "peaceai/bin/loop.ts"), "run", "/nonexistent/m162-tasks.json", "--planner", bad], { cwd: ctx.base, encoding: "utf8", env: { ...process.env, PEACEAI_STAGE2_CAND: "" } }); } catch (e: any) { out = String(e.stdout); code = e.status; }
    assert.equal(out.trim(), "refused PLANNER_UNKNOWN", bad);
    assert.equal(code, 2);
  }
  // near miss: a known planner gets past the planner check (and then refuses the missing file, not the planner)
  let out = "";
  try { execFileSync(tsx, [join(ROOT, "peaceai/bin/loop.ts"), "run", "/nonexistent/m162-tasks.json", "--planner", "v1"], { cwd: ctx.base, encoding: "utf8", env: { ...process.env, PEACEAI_STAGE2_CAND: "" } }); } catch (e: any) { out = String(e.stdout); }
  assert.equal(out.trim(), "refused TASK_FILE_INVALID");
});
