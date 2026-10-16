// M71: carry-forward grades a learned candidate by the grade type its approved rule declares on main
// (spec.params.grading, resolved from main's approved list + spec file; never the candidate or the issue).
// Same-diff, applies and files-unchanged checks are unchanged (m68). Live gap: #305 (env-fix COUNTS, no stub step:
// carry_grade_not_counts) and #306/#307 (workflow-job / tsconfig-script, suite-only: carry_no_fresh_grade).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { checkCarry, declaredRule, freshFromRecord, sha256, suiteFromRecord, type CarryInput, type PendingCarry } from "../lib/carry.ts";
import { specHash } from "../lib/learned.ts";

const root = resolve(import.meta.dirname, "../..");
const read = (p: string) => readFileSync(resolve(root, p), "utf8");
const approved = (JSON.parse(read("peaceai/rules/approved.json")) as { rules: { id: string; sha256: string }[] }).rules;
const specOf = (id: string) => { try { const spec = JSON.parse(read(`peaceai/rules/learned/${id}.json`)); return { spec, hash: specHash(spec) }; } catch { return null; } };
const op = (id: string) => `learned:${id}@${specOf(id)!.hash}`;
const rule = (id: string, kind: string) => declaredRule(op(id), [`LEARNED_${kind}`], approved, specOf);

const BASE = "a".repeat(40), HEAD = "b".repeat(40);
const DIFF = ["diff --git a/src/m.ts b/src/m.ts", "--- a/src/m.ts", "+++ b/src/m.ts", "@@ -1 +1,2 @@", " export const x = 1;", "+export function strictFoo(v: string | undefined): boolean { return v === \"1\"; }", ""].join("\n");
const H = sha256(DIFF);
const pending: PendingCarry = { schema: "peaceai-carry-pending:v1", issue: 7, verdictCommentId: "555", label: "A", runId: "100", candidateId: "candidate-1", oldBase: BASE, diffSha256: H };
const task = { issue: 7, runId: "200", baseSha: HEAD, regradeOf: { runId: "100", candidateId: "candidate-1", oldBase: BASE, diffSha256: H } };
const selfRec = { applied: true, typecheckPassed: true, originalSuitePassed: true, eligible: true, newTestsPassed: true, newTestFiles: 1, testGrading: { beforeFix: false, verdict: "COUNTS" } };
const suiteRec = { applied: true, typecheckPassed: true, originalSuitePassed: true, eligible: true, newTestsPassed: true, newTestFiles: 0, testGrading: null };
const input = (r: CarryInput["rule"], c: typeof selfRec | typeof suiteRec | undefined): CarryInput => ({
  pending, task, diff: DIFF, appliedByJobA: true, applyCheck: true, changedSinceBase: ["src/other.ts"],
  fresh: freshFromRecord(c as never), suite: suiteFromRecord(c as never), rule: r,
});
const no = (reason: string) => ({ carry: false, reason });

test("declared grade types come from main's approved specs", () => {
  assert.equal(rule("public-env-fix-v1", "ENV_FIX")!.grading, "self");
  assert.equal(rule("public-workflow-job-v1", "WORKFLOW_JOB")!.grading, "suite");
  assert.equal(rule("public-tsconfig-script-v1", "TSCONFIG_SCRIPT")!.grading, "suite");
  assert.equal(rule("public-loop-function-v2", "COMPLEX_FUNCTION")!.grading, "self-stub");
  assert.equal(declaredRule("ADD_GUARD_CLAUSE", [], approved, specOf), undefined, "not a learned candidate");
});
test("the candidate cannot choose its grade type: wrong hash, unapproved id, or a foreign transformation refuses", () => {
  assert.equal(declaredRule(`learned:public-env-fix-v1@${"0".repeat(64)}`, ["LEARNED_ENV_FIX"], approved, specOf), null);
  assert.equal(declaredRule(op("public-env-fix-v1"), ["LEARNED_WORKFLOW_JOB"], approved, specOf), null);
  assert.equal(declaredRule(op("public-env-fix-v1"), ["LEARNED_ENV_FIX"], approved.filter((r) => r.id !== "public-env-fix-v1"), specOf), null);
  assert.equal(declaredRule("learned:bogus", ["LEARNED_ENV_FIX"], approved, specOf), null);
  assert.deepEqual(checkCarry(input(null, selfRec)), no("carry_rule_unknown"));
});

test("happy path: env-fix (self) COUNTS without a stub step carries (#305)", () => {
  assert.deepEqual(checkCarry(input(rule("public-env-fix-v1", "ENV_FIX"), selfRec)), { carry: true });
});
test("happy path: workflow-job and tsconfig-script (suite-only) carry on their own fresh gates (#306/#307)", () => {
  assert.deepEqual(checkCarry(input(rule("public-workflow-job-v1", "WORKFLOW_JOB"), suiteRec)), { carry: true });
  assert.deepEqual(checkCarry(input(rule("public-tsconfig-script-v1", "TSCONFIG_SCRIPT"), suiteRec)), { carry: true });
});
test("missing fresh grade refuses", () => {
  assert.deepEqual(checkCarry(input(rule("public-env-fix-v1", "ENV_FIX"), undefined)), no("carry_no_fresh_grade"));
  assert.deepEqual(checkCarry(input(rule("public-workflow-job-v1", "WORKFLOW_JOB"), undefined)), no("carry_no_fresh_grade"));
  assert.deepEqual(checkCarry(input(rule("public-tsconfig-script-v1", "TSCONFIG_SCRIPT"), { ...suiteRec, applied: false })), no("carry_no_fresh_grade"));
});
test("failed fresh grade refuses", () => {
  const ef = rule("public-env-fix-v1", "ENV_FIX");
  assert.deepEqual(checkCarry(input(ef, { ...selfRec, testGrading: { beforeFix: true, verdict: "VACUOUS" } })), no("carry_grade_not_counts"));
  assert.deepEqual(checkCarry(input(ef, { ...selfRec, originalSuitePassed: false })), no("carry_grade_not_counts"));
  assert.deepEqual(checkCarry(input(ef, { ...selfRec, testGrading: { beforeFix: false, verdict: "COUNTS", stubFails: false } as never })), no("carry_grade_not_counts"));
  const wj = rule("public-workflow-job-v1", "WORKFLOW_JOB");
  for (const k of ["typecheckPassed", "originalSuitePassed", "eligible"] as const)
    assert.deepEqual(checkCarry(input(wj, { ...suiteRec, [k]: false })), no("carry_grade_not_counts"), k);
});
test("a grade type that does not match the rule refuses", () => {
  // suite-only rule, but the record carries a test grade
  assert.deepEqual(checkCarry(input(rule("public-tsconfig-script-v1", "TSCONFIG_SCRIPT"), selfRec)), no("carry_grade_type_mismatch"));
  // self-graded rule, but the record has only suite gates (no test grade)
  assert.deepEqual(checkCarry(input(rule("public-env-fix-v1", "ENV_FIX"), suiteRec)), no("carry_grade_type_mismatch"));
  // self-stub rule without a stub result does not count
  assert.deepEqual(checkCarry(input(rule("public-loop-function-v2", "COMPLEX_FUNCTION"), selfRec)), no("carry_grade_not_counts"));
});
test("same-diff / applies / files-unchanged still come first", () => {
  const ef = rule("public-env-fix-v1", "ENV_FIX");
  assert.deepEqual(checkCarry({ ...input(ef, selfRec), diff: DIFF + "x" }), no("carry_hash_mismatch"));
  assert.deepEqual(checkCarry({ ...input(ef, selfRec), applyCheck: false }), no("carry_not_clean"));
  assert.deepEqual(checkCarry({ ...input(ef, selfRec), changedSinceBase: ["src/m.ts"] }), no("carry_files_changed"));
});
