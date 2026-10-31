// M151: loop v2 (peaceai/lib/loopdeps.ts + peaceai/lib/loop.ts): the repo's own runner (node:test, vitest, jest)
// and dependencies (lockfile only, scripts off, as the candidate uid, cached per run), offline. Behavior cases live
// in m151-cases.ts (replayed against mutants by m151-mutation.test.ts); this file adds the v2 row validator and
// static checks. NO network: the package manager and the runner are vendored stubs (m151-fixtures.ts).
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import * as deps from "../lib/loopdeps.ts";
import * as loop from "../lib/loop.ts";
import { LOOP_SCHEMA_V2, loopRowProblem, type LoopRow } from "../lib/looprow.ts";
import { CASES } from "./m151-cases.ts";
import { setup, teardown, type Ctx } from "./m151-fixtures.ts";

const ROOT = resolve(import.meta.dirname, "../..");
let ctx: Ctx;
before(() => { ctx = setup(); });
after(() => teardown(ctx));

// a case that needs the candidate uid is SKIPPED (with its reason) where it is missing, never counted as a pass
for (const c of CASES) test(`M151: ${c.id}`, (t) => { if (c.needsCand && !ctx.cand) { t.skip(c.needsCand); return; } c.run({ deps, loop }, ctx); });

const v2 = (over: Partial<LoopRow> = {}): LoopRow => ({
  schema: LOOP_SCHEMA_V2, at: "2026-10-30T23:00:00Z", set: "public", taskFileSha256: "a".repeat(64), taskKey: "0123456789abcdef", repo: "o/r", commit: "c".repeat(40),
  workspace: "d".repeat(40), loop: "loop-v2", loopSha256: "e".repeat(64), proposer: "rules-v1", lm: "not-loadable", code: "ATTEMPT_LIMIT", maxAttempts: 2, attempts: 2,
  result: "fail", attemptCodes: [["TEST_FAIL"], ["RELATED_FAIL"]], tests: { total: 3, passedByPeaceAI: 1, filledByTeam: 2 },
  runner: "vitest", deps: "pnpm", baseline: { total: 3, passing: 1, failing: 2 }, ...over,
});

test("M151: v2 rows: runner, deps and baseline are required, fixed values, consistent; v1 rows cannot carry v2 codes", () => {
  assert.equal(loopRowProblem(v2()), null);
  assert.equal(loopRowProblem(v2({ code: "DEPS_TOO_LARGE", result: "refused", attempts: 0, attemptCodes: [], tests: null, deps: null, baseline: null })), null);
  assert.equal(loopRowProblem(v2({ code: "TEST_RUNNER_UNSUPPORTED", result: "refused", attempts: 0, attemptCodes: [], tests: null, runner: null, deps: null, baseline: null })), null);
  const { runner: _r, ...noRunner } = v2();
  const bad: [Record<string, unknown>, string][] = [
    [noRunner, "loop_keys"],
    [{ ...v2(), runner: "mocha" }, "runner"],
    [{ ...v2(), deps: "bun" }, "deps"],
    [{ ...v2(), baseline: { total: 3, passing: 1, failing: 2, names: ["x"] } }, "baseline_keys"],
    [{ ...v2(), baseline: { total: 3, passing: 2, failing: 2 } }, "baseline_values"],
    [{ ...v2(), runner: null, deps: null }, "baseline_without_runner"],
    [{ ...v2(), baseline: null }, "baseline_presence"],
    [{ ...v2({ code: "NO_EDIT", result: "refused", attempts: 0, attemptCodes: [], tests: null, baseline: null }), runner: null }, "deps_without_runner"],
    [{ ...v2(), loop: "loop-v1" }, "loop"],
    [{ ...v2(), schema: "peaceai-plan-loop:v1", loop: "loop-v1" }, "loop_keys"],
  ];
  for (const [row, want] of bad) assert.equal(loopRowProblem(JSON.parse(JSON.stringify(row))), want, JSON.stringify(row));
  const v1 = { ...JSON.parse(JSON.stringify(v2())), schema: "peaceai-plan-loop:v1", loop: "loop-v1" };
  delete v1.runner; delete v1.deps; delete v1.baseline;
  assert.equal(loopRowProblem(v1), "attempt_codes", "RELATED_FAIL is v2 only");
  assert.equal(loopRowProblem({ ...v1, attemptCodes: [["TEST_FAIL"], ["TEST_FAIL"]] }), null, "v1 rows still validate");
  assert.equal(loopRowProblem({ ...v1, attemptCodes: [], attempts: 0, code: "DEPS_TIMEOUT", result: "refused", tests: null }), "code", "DEPS_* codes are v2 only");
  assert.equal(loopRowProblem({ ...v1, attemptCodes: [], attempts: 0, code: "DEPS_NONREGISTRY", result: "refused", tests: null }), "code");
  assert.equal(loopRowProblem(v2({ code: "DEPS_NONREGISTRY", result: "refused", attempts: 0, attemptCodes: [], tests: null, deps: null, baseline: null })), null);
  assert.equal(loopRowProblem(v2({ code: "DEPS_PM_CONFIG", result: "refused", attempts: 0, attemptCodes: [], tests: null, deps: null, baseline: null })), null);
  assert.equal(loopRowProblem({ ...v1, attemptCodes: [], attempts: 0, code: "DEPS_PM_CONFIG", result: "refused", tests: null }), "code", "DEPS_PM_CONFIG is v2 only");
});

test("M151: hidden rows carry the taskKey and scores only: runner, deps and baseline must be null", () => {
  const { repo: _repo, commit: _commit, ...pub } = v2();
  const hidden = { ...pub, set: "hidden" as const, runner: null, deps: null, baseline: null };
  assert.equal(loopRowProblem(hidden), null, "a hidden row with attempts and test counts but no runner / deps / baseline");
  for (const over of [{ runner: "vitest" }, { deps: "pnpm" }, { deps: "none" }, { baseline: { total: 3, passing: 1, failing: 2 } }]) {
    assert.equal(loopRowProblem(JSON.parse(JSON.stringify({ ...hidden, ...over }))), "hidden_detail", JSON.stringify(over));
  }
  assert.equal(loopRowProblem({ ...hidden, repo: "o/r", commit: "c".repeat(40) }), "hidden_names_repo");
  assert.equal(loopRowProblem({ ...v2(), baseline: null }), "baseline_presence", "public rows that ran tests still need the baseline");
});

test("M151: loopdeps is general (no task, repo or task-set strings) and part of the loop's pinned code", () => {
  const src = readFileSync(join(ROOT, "peaceai/lib/loopdeps.ts"), "utf8");
  const tasks = JSON.parse(readFileSync(join(ROOT, "peaceai/plan/tasks-public-v1.json"), "utf8")).tasks as { repo: string }[];
  for (const t of tasks) for (const w of t.repo.split("/")) assert.ok(!src.toLowerCase().includes(w.toLowerCase()), `loopdeps names ${w}`);
  assert.ok(!/tasks-public|hidden-tasks|\bhidden\b/i.test(src));
  assert.ok(readFileSync(join(ROOT, "peaceai/lib/loop.ts"), "utf8").includes('"lib/loopdeps.ts"'), "loopSha256 covers loopdeps.ts");
  // the only network use is the registry install step, which runs under env -i with the registry pinned
  assert.match(src, /export const REGISTRY = "https:\/\/registry\.npmjs\.org\/";/);
  assert.match(src, /env\.npm_config_registry = REGISTRY; \/\/ guard:deps-registry/);
  assert.equal((src.match(/spawnSync\(cmd\[0\]/g) ?? []).length, 1, "one install run site");
});
