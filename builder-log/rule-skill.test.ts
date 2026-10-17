import { test } from "node:test";
import assert from "node:assert/strict";
import type { Entry } from "./check.ts";
import { checkRuleSkills, RULE_SKILL } from "./rule-skill.ts";

const e = (seq: number, skill: string, changed: string, by = "PeaceAI"): Entry =>
  ({ seq, date: "2026-10-15", time: "22:51", asked: "x", changed, why: "x", skill, mark: "PeaceAI-able today", by }) as Entry;

test("#238 shape: IMPORT_EDIT tag on an objargs candidate is refused; CHECK_OBJECT_LITERAL_ARGS passes", () => {
  const look = (n: number) => (n === 238 ? ["public-test-case-objargs-v1"] : null);
  assert.match(checkRuleSkills([e(99, "IMPORT_EDIT", "PeaceAI-Workspace#238, PeaceSTOCKS@c095bbc")], look)[0]!, /came from public-test-case-objargs-v1 \(CHECK_OBJECT_LITERAL_ARGS\)/);
  assert.deepEqual(checkRuleSkills([e(99, "CHECK_OBJECT_LITERAL_ARGS", "PeaceAI-Workspace#238, PeaceSTOCKS@c095bbc")], look), []);
});

test("fails closed: no record, unknown rule, no issue; Builder and issue-only lines skipped", () => {
  assert.match(checkRuleSkills([e(5, "TEST_CASE", "PeaceAI-Workspace#1, PeaceSTOCKS@abcdef1")], () => null)[0]!, /fail closed/);
  assert.match(checkRuleSkills([e(5, "TEST_CASE", "PeaceAI-Workspace#1, PeaceSTOCKS@abcdef1")], () => ["core-x-v1"])[0]!, /unknown rule core-x-v1/);
  assert.match(checkRuleSkills([e(5, "TEST_CASE", "PeaceSTOCKS@abcdef1")], () => ["public-test-case-v1"])[0]!, /no single/);
  assert.deepEqual(checkRuleSkills([e(5, "TEST_CASE", "PeaceSTOCKS@abcdef1", "Builder"), e(6, "TEST_CASE", "PeaceAI-Workspace#1")], () => null), []);
});

test("every approved public learned rule file maps to a skill", async () => {
  const { readdirSync } = await import("node:fs");
  const { resolve } = await import("node:path");
  const files = readdirSync(resolve(import.meta.dirname, "../peaceai/rules/learned")).map((f) => f.replace(/\.json$/, ""));
  for (const r of Object.keys(RULE_SKILL)) assert.ok(files.includes(r), r);
});

test("CI mode: errors name skills only, never learned rule ids", () => {
  const ci = { ci: true };
  const m = checkRuleSkills([e(99, "IMPORT_EDIT", "PeaceAI-Workspace#238, PeaceSTOCKS@c095bbc")], () => ["public-test-case-objargs-v1"], ci)[0]!;
  assert.match(m, /skill IMPORT_EDIT but #238's landed candidate's skill is CHECK_OBJECT_LITERAL_ARGS/);
  assert.ok(!/public-|learned:/.test(m), m);
  const u = checkRuleSkills([e(5, "TEST_CASE", "PeaceAI-Workspace#1, PeaceSTOCKS@abcdef1")], () => ["core-x-v1"], ci)[0]!;
  assert.match(u, /unknown rule/); assert.ok(!u.includes("core-x-v1"), u);
});

test("resultsDirLookup: the verdict's runId must be numeric (no path traversal); a numeric runId resolves", async () => {
  const { mkdtempSync, mkdirSync, writeFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { tmpdir } = await import("node:os");
  const { resultsDirLookup } = await import("./rule-skill.ts");
  const op = "learned:public-test-case-v1@" + "a".repeat(64);
  const mk = (runId: unknown, rankDir: string) => {
    const d = mkdtempSync(join(tmpdir(), "rs-"));
    mkdirSync(join(d, "tasks/7/123/verdicts"), { recursive: true }); mkdirSync(join(d, "tasks/7", rankDir), { recursive: true });
    writeFileSync(join(d, "tasks/7/123/verdicts/v.json"), JSON.stringify({ verdict: "right", runId, candidateId: "candidate-1" }));
    writeFileSync(join(d, "tasks/7", rankDir, "ranking.json"), JSON.stringify({ candidates: [{ id: "candidate-1", operationId: op }] }));
    return resultsDirLookup(d);
  };
  assert.deepEqual(mk("123", "123")(7), ["public-test-case-v1"]);
  for (const bad of ["../7/123", "123/..", "12a", "", 123, null]) assert.equal(mk(bad, "123")(7), null, String(bad));
});

test("loop-function-v2 and env-fix-v1 map to their builder-log skills; ENV_FIX approved from #292's merge", async () => {
  const { RULE_SKILL } = await import("./rule-skill.ts");
  const { APPROVED_SINCE, MISSING_SKILLS } = await import("./check.ts");
  assert.equal(RULE_SKILL["public-loop-function-v2"], "LOOP_FUNCTION");
  assert.equal(RULE_SKILL["public-env-fix-v1"], "ENV_FIX");
  assert.equal(APPROVED_SINCE.ENV_FIX, "2026-10-16 11:41");
  assert.ok(!(MISSING_SKILLS as readonly string[]).includes("ENV_FIX"));
});

test("workflow-job-v1 and tsconfig-script-v1 map to their skills; both approved from their approval merges (#296, #300)", async () => {
  const { RULE_SKILL } = await import("./rule-skill.ts");
  const { APPROVED_SINCE, MISSING_SKILLS } = await import("./check.ts");
  const { GRANDFATHERED } = await import("./trace.ts");
  assert.equal(RULE_SKILL["public-workflow-job-v1"], "WORKFLOW_JOB");
  assert.equal(RULE_SKILL["public-tsconfig-script-v1"], "TSCONFIG_SCRIPT");
  assert.equal(APPROVED_SINCE.WORKFLOW_JOB, "2026-10-16 11:46");
  assert.equal(APPROVED_SINCE.TSCONFIG_SCRIPT, "2026-10-16 12:17");
  for (const s of ["WORKFLOW_JOB", "TSCONFIG_SCRIPT"]) assert.ok(!(MISSING_SKILLS as readonly string[]).includes(s));
  assert.match(GRANDFATHERED[119]!, /^T_NO_PATCH_COMMENT: #306 .*PeaceSTOCKS PR #9/);
});
