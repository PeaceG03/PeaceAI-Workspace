// M57: the approved function-top guard rule is reachable end to end: issue text -> nlparse -> admitted rule -> candidate.
import assert from "node:assert/strict";
import test from "node:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { admitRules, loadApprovedList } from "../lib/approved.ts";
import { applyRule, TRIGGERS, type RuleSpec } from "../lib/learned.ts";
import { GUARD_TOP_TRIGGER, GUARD_TRIGGER, parseGuardTask, safeCondition } from "../lib/learned-guard.ts";
import { nlDecision } from "../lib/nlparse.ts";

const repo = join(import.meta.dirname, "../..");
const dir = join(repo, "peaceai/rules/learned");
const specs = readdirSync(dir).filter((f) => f.endsWith(".json")).sort().map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")));
const admissions = admitRules(specs, loadApprovedList(join(repo, "peaceai/rules/approved.json")));
const approved = admissions.filter((a) => a.decision === "APPROVED" && a.spec).map((a) => a.spec!);
const kinds = new Set(approved.map((s) => s.kind)); // the same set generate.ts hands nlDecision
const isTest = (p: string) => p.endsWith(".test.ts");

// Fixture shaped like PeaceSTOCKS src/universe.ts (the #166/#186 target), with leading early returns.
const SRC = [
  "export function eligibilityForBarCount(barCount: number): string {",
  '  if (barCount < 1) return "LEVEL_0";',
  '  if (barCount < 20) return "LEVEL_1";',
  '  if (barCount < 252) return "LEVEL_2";',
  '  return "LEVEL_3";',
  "}",
  "",
].join("\n");
const files = [{ path: "src/universe.ts", content: SRC }];

// Exact issue texts of #186 (live proof) and #187 (refusal proof).
const I186 = {
  title: "[scanner] guard eligibilityForBarCount at the top against a non-integer or negative barCount",
  body: "Target: PeaceG03/PeaceSTOCKS\n\nguard `eligibilityForBarCount` in `src/universe.ts` at the top: throw INVALID_BAR_COUNT when !Number.isInteger(barCount) || barCount < 0\n- `eligibilityForBarCount(-1)` throws INVALID_BAR_COUNT\n- `eligibilityForBarCount(20)` is `\"LEVEL_2\"`\n\n(Live proof of guard-top v2 (public-throw-guard-top-v1, approved in #185), retrying #166. A NaN bar count falls through every `<` comparison and is graded LEVEL_3. Fail closed at the top of the function. Expected COUNTS.)\n",
};
const I187 = {
  title: "[scanner] refusal proof: guard eligibilityForBarCount at the top on an unknown name",
  body: "Target: PeaceG03/PeaceSTOCKS\n\nguard `eligibilityForBarCount` in `src/universe.ts` at the top: throw INVALID_BAR_COUNT when !Number.isInteger(limit) || limit < 0\n- `eligibilityForBarCount(-1)` throws INVALID_BAR_COUNT\n- `eligibilityForBarCount(20)` is `\"LEVEL_2\"`\n\n(Live refusal proof of guard-top v2: the condition names `limit`, which is not a parameter of the function. Expected: PeaceAI refuses with no candidate.)\n",
};

const run = (objective: string) => approved.map((s) => ({ id: s.id, edit: applyRule(s, objective, files, isTest) })).filter((x) => x.edit);

test("top-v1 is admitted from the real approved list, and the rule routing uses each spec's own trigger", () => {
  const top = approved.find((s) => s.id === "public-throw-guard-top-v1") as RuleSpec | undefined;
  assert.ok(top, "public-throw-guard-top-v1 admitted");
  assert.equal(top!.kind, "ADD_THROW_GUARD");
  assert.equal(top!.trigger, GUARD_TOP_TRIGGER);
  assert.equal(TRIGGERS.ADD_THROW_GUARD, GUARD_TRIGGER, "proposer default stays v1; top-v1 routes via its spec trigger");
  assert.ok(kinds.has("ADD_THROW_GUARD"));
});

test("#186 end to end: canonical parse, exactly one candidate from top-v1, guard first", () => {
  const d = nlDecision(I186, undefined, kinds, null);
  assert.equal(d.status, "canonical", JSON.stringify(d));
  const objective = (d as { objective: string }).objective;
  const hits = run(objective);
  assert.deepEqual(hits.map((h) => h.id), ["public-throw-guard-top-v1"], "only top-v1 fires (v1 ignores the top phrasing)");
  const e = hits[0]!.edit!;
  assert.equal(e.path, "src/universe.ts");
  const lines = e.content.split("\n");
  assert.equal(lines[1], '  if (!Number.isInteger(barCount) || barCount < 0) throw new Error("INVALID_BAR_COUNT");');
  assert.equal(lines[2], '  if (barCount < 1) return "LEVEL_0";');
  assert.ok(e.selfGrade && e.extra && e.extra.length === 1 && e.extra[0]!.create === true && isTest(e.extra[0]!.path));
  assert.match(e.extra[0]!.content, /INVALID_BAR_COUNT/);
});

test("#186 is refused as not-approved when ADD_THROW_GUARD is not approved (no silent run)", () => {
  const d = nlDecision(I186, undefined, new Set(), null);
  assert.equal(d.status, "unsure");
  assert.equal((d as { reason: string }).reason, "RULE_NOT_APPROVED");
});

test("#187: the condition check itself refuses the unknown name `limit`; no candidate", () => {
  const d = nlDecision(I187, undefined, kinds, null);
  assert.equal(d.status, "canonical");
  const objective = (d as { objective: string }).objective;
  const task = parseGuardTask(GUARD_TOP_TRIGGER, objective);
  assert.ok(task, "the task itself reads; refusal must come from the condition check");
  const cond = /when (.*)$/m.exec(objective.split("\n").find((l) => / at the top: /.test(l))!)![1]!;
  const expr = (ts.createSourceFile("c.ts", `(${cond});`, ts.ScriptTarget.Latest, true).statements[0] as ts.ExpressionStatement).expression;
  assert.equal(safeCondition(expr, new Set(["barCount"])), false, "unknown name refused");
  const good = (ts.createSourceFile("c.ts", "(!Number.isInteger(barCount) || barCount < 0);", ts.ScriptTarget.Latest, true).statements[0] as ts.ExpressionStatement).expression;
  assert.equal(safeCondition(good, new Set(["barCount"])), true, "control: #186's condition passes the same check");
  assert.deepEqual(run(objective), [], "no candidate from any approved rule");
});
