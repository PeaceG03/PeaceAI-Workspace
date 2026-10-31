// M162 behavior cases: the loop picks its planner only through lib/plandefault.ts selectPlanner (no flag = the default,
// plan-only-v3 per #650), runs that planner, and records the planner and its plannerSha256 in every row (row schema
// peaceai-plan-loop:v3). As data, so m162-mutation.test.ts can replay them against mutants of loop.ts / looprow.ts.
// The fixture is M152's tiny synthetic node:test repo (not modeled on any scorecard task). The cases that look at the
// plan itself run the real loop to the baseline and need the stage-2 candidate uid; without it they assert the
// fail-closed CAND_UID_* refusal (the row still names the planner: it is picked before anything runs).
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PLANNERS } from "../lib/plandefault.ts";
import { plannerSha256 } from "../lib/planrun.ts";
import { plannerSha256V2 } from "../lib/plan2run.ts";
import { plannerSha256V3 } from "../lib/plan3run.ts";
import { plannerSha256V4 } from "../lib/plan4run.ts";
import { lockRow } from "../lib/planrun.ts";
import type * as Loop from "../lib/loop.ts";
import type * as Row from "../lib/looprow.ts";
import type { M152Ctx } from "./m152-fixtures.ts";

export interface Libs { loop: typeof Loop; row: typeof Row }
export interface Case { id: string; needsCand?: boolean; run: (l: Libs, ctx: M152Ctx) => void }

const SHA: Record<string, () => string> = { "plan-only-v1": () => plannerSha256(), "plan-only-v2": () => plannerSha256V2(), "plan-only-v3": () => plannerSha256V3(), "plan-only-v4": () => plannerSha256V4() };

/** A proposer that records the plan the loop gives it and stops at once (NO_EDIT), so a run ends after the baseline. */
function spy(): { p: Loop.Proposer; plans: string[] } {
  const plans: string[] = [];
  return { plans, p: { name: "m162-spy", next(i) { plans.push(i.plan.planner); return { refuse: "NO_EDIT" }; } } };
}
const taskOpts = (ctx: M152Ctx, proposer: Loop.Proposer) => ({ root: ctx.root, fetcher: ctx.fetcher, proposer, maxAttempts: 1, runMs: 60_000, env: ctx.env, rules: [], training: new Set<string>() });

function checkRow(l: Libs, ctx: M152Ctx, r: Loop.LoopResult, name: string, plans: string[]): void {
  assert.equal(r.row.schema, "peaceai-plan-loop:v3");
  assert.equal(r.row.planner, name);
  assert.equal(r.row.plannerSha256, SHA[name]!(), `${name}: the row carries that planner's own digest`);
  assert.equal(l.row.loopRowProblem(r.row), null);
  if (!ctx.cand) { assert.match(r.row.code, /^CAND_UID_/); return; }
  assert.equal(r.row.code, "NO_EDIT");
  assert.equal(r.plan?.planner, name, `${name}: the loop's plan came from that planner`);
  assert.deepEqual(plans, [name], `${name}: the proposer was given that planner's plan`);
}

export const CASES: Case[] = [
  {
    id: "default: with no planner the loop takes selectPlanner's default (plan-only-v3), runs it and records it with its digest",
    run(l, ctx) {
      const s = spy();
      checkRow(l, ctx, l.loop.runLoopTask(ctx.task, "public", "a".repeat(64), taskOpts(ctx, s.p)), "plan-only-v3", s.plans);
      assert.equal(l.loop.loopPlanner(undefined), "plan-only-v3");
    },
  },
  {
    id: "near miss: every planner selectPlanner knows is honoured (v1 / v2 / v3 / v4), each with its own plannerSha256",
    run(l, ctx) {
      for (const name of ["plan-only-v1", "plan-only-v2", "plan-only-v4"] as const) {
        const s = spy();
        checkRow(l, ctx, l.loop.runLoopTask(ctx.task, "public", "a".repeat(64), { ...taskOpts(ctx, s.p), planner: name }), name, s.plans);
      }
      assert.notEqual(plannerSha256(), plannerSha256V3());
      assert.notEqual(plannerSha256V4(), plannerSha256V3());
    },
  },
  {
    id: "names: short and full names map through selectPlanner; near-miss names (case, spaces, v5, empty, __proto__) are unknown",
    run(l) {
      for (const [f, n] of [["v1", "plan-only-v1"], ["v2", "plan-only-v2"], ["v3", "plan-only-v3"], ["plan-only-v1", "plan-only-v1"], ["plan-only-v3", "plan-only-v3"], ["v4", "plan-only-v4"]]) assert.equal(l.loop.loopPlanner(f), n, f);
      for (const bad of ["V3", " v3", "v3 ", "v5", "", "plan-only-v5", "__proto__", "toString"]) assert.equal(l.loop.loopPlanner(bad), null, JSON.stringify(bad));
    },
  },
  {
    id: "runLoopFile: --planner v1 gives v1 rows; an unknown name is refused PLANNER_UNKNOWN before anything runs (no row); near miss: no flag -> v3 rows",
    run(l, ctx) {
      const text = JSON.stringify({ schema: "peaceai-plan-tasks:v1", set: "public", tasks: [ctx.task] }, null, 1) + "\n";
      const file = join(ctx.base, "m162-tasks.json");
      writeFileSync(file, text);
      const log = join(ctx.root, "peaceai/plan/loop-runs.jsonl");
      const read = () => (existsSync(log) ? readFileSync(log, "utf8") : "");
      const opts = (plannerFlag?: string) => ({ root: ctx.root, committed: JSON.stringify(lockRow(text)) + "\n", fetcher: ctx.fetcher, makeProposer: () => spy().p, maxAttempts: 1, runMs: 60_000, env: ctx.env, rules: [], training: new Set<string>(), outDir: join(ctx.base, "m162-out"), plannerFlag });
      for (const bad of ["V3", "v5", "", " v1"]) {
        const before = read();
        const r = l.loop.runLoopFile(file, opts(bad));
        assert.equal(r.code, "PLANNER_UNKNOWN", JSON.stringify(bad));
        assert.equal(r.results.length, 0);
        assert.equal(read(), before, "a refused planner appends no row");
      }
      const v1 = l.loop.runLoopFile(file, opts("v1"));
      assert.equal(v1.code, "OK");
      assert.deepEqual(v1.results.map((x) => [x.row.planner, x.row.plannerSha256]), [["plan-only-v1", plannerSha256()]]);
      const def = l.loop.runLoopFile(file, opts(undefined));
      assert.equal(def.code, "OK");
      assert.deepEqual(def.results.map((x) => [x.row.planner, x.row.plannerSha256]), [["plan-only-v3", plannerSha256V3()]]);
      const rows = read().trim().split("\n").slice(-2).map((x) => JSON.parse(x) as Row.LoopRow);
      assert.deepEqual(rows.map((r) => r.planner), ["plan-only-v1", "plan-only-v3"], "the appended rows say which planner ran");
    },
  },
  {
    id: "row: v3 rows must name a known planner with a sha256; near miss: v1 / v2 rows without those keys still validate, and cannot carry them",
    run(l) {
      const v3: Record<string, unknown> = {
        schema: "peaceai-plan-loop:v3", at: "2026-10-31T08:00:00Z", set: "public", taskFileSha256: "a".repeat(64), taskKey: "0123456789abcdef", repo: "o/r", commit: "c".repeat(40),
        workspace: "d".repeat(40), loop: "loop-v2", loopSha256: "e".repeat(64), proposer: "rules-v1", planner: "plan-only-v3", plannerSha256: "f".repeat(64), lm: "not-loadable",
        code: "NO_EDIT", maxAttempts: 3, attempts: 0, result: "refused", attemptCodes: [], tests: null, runner: "node-test", deps: "none", baseline: { total: 1, passing: 0, failing: 1 },
      };
      assert.equal(l.row.loopRowProblem(v3), null);
      for (const p of ["plan-only-v1", "plan-only-v2", "plan-only-v4"]) assert.equal(l.row.loopRowProblem({ ...v3, planner: p }), null, p);
      for (const p of ["plan-only-v5", "v3", "", null, 3]) assert.equal(l.row.loopRowProblem({ ...v3, planner: p }), "planner", JSON.stringify(p));
      for (const h of ["F".repeat(64), "f".repeat(63), null, ""]) assert.equal(l.row.loopRowProblem({ ...v3, plannerSha256: h }), "planner_sha", JSON.stringify(h));
      const { planner: _p, plannerSha256: _h, ...v2 } = v3;
      assert.equal(l.row.loopRowProblem(v3.planner ? { ...v2 } : v2), "loop_keys", "a v3 row without the planner keys");
      assert.equal(l.row.loopRowProblem({ ...v2, schema: "peaceai-plan-loop:v2" }), null, "near miss: a v2 row as before");
      assert.equal(l.row.loopRowProblem({ ...v3, schema: "peaceai-plan-loop:v2" }), "loop_keys", "a v2 row cannot carry planner keys");
      assert.deepEqual([...l.row.LOOP_PLANNER_NAMES].sort(), Object.keys(PLANNERS).sort(), "the row's planner list is plandefault's");
    },
  },
];
