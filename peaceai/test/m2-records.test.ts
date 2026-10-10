import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type { SummaryCandidate } from "../lib/gate.ts";
import { HELD_OUT_RATE, isHeldOut, isTestTask, taskRequiresTests } from "../lib/policy.ts";
import type { CandidateResult } from "../lib/rank.ts";
import { buildRecords, buildSummary, peacePick, stableJson, taskEntry, type VerdictRecord } from "../lib/records.ts";
import { appendIndex, latestAttempt, loadAll, taskDir, writeNew, writeSummary } from "../lib/store.ts";
import { parseVerdict } from "../lib/verdict.ts";

const ISSUE_3_TITLE = "Add a helper that will normalize a title by trimming surrounding whitespace in src/text.ts, with focused tests.";

const sc = (id: string, diffLines: number, transformations = ["STRING_TRIM_HELPER"]): SummaryCandidate => ({
  id, file: `candidates/${id}.diff`, transformations, operationId: null, diffBytes: diffLines * 30, diffLines,
});
const res = (id: string, over: Partial<CandidateResult> = {}): CandidateResult => ({
  id, diffBytes: 100, diffLines: 10, applied: true, typecheckPassed: true, originalSuitePassed: true, newTestsPassed: true, newTestFiles: 1, ...over,
});
const task = (issue = 3, title = ISSUE_3_TITLE) => ({ issue, runId: "1001", recordedAt: "2026-10-10T00:00:00Z", baseSha: "a".repeat(40), title, body: "" });

test("tests-required detection", () => {
  assert.equal(taskRequiresTests(ISSUE_3_TITLE), true);
  assert.equal(taskRequiresTests("Rename symbol greet to sayHello in src/text.ts"), false);
  assert.equal(taskRequiresTests("Add a helper, and add unit tests"), true);
  assert.equal(taskRequiresTests("Add tests for slugify"), true);
  assert.equal(taskRequiresTests("Add a helper without tests"), false);
});

test("issue #3 case: a candidate with no new test is rejected before ranking, even though it is smallest", () => {
  const summary = [sc("candidate-1", 15), sc("candidate-2", 4), sc("candidate-3", 15)];
  const results = [res("candidate-1", { diffLines: 15 }), res("candidate-2", { diffLines: 4, newTestFiles: 0 }), res("candidate-3", { diffLines: 15 })];
  const { task: t, ranking } = buildRecords(task(), summary, results, "seed");
  assert.equal(t.requiresTests, true);
  const c2 = ranking.candidates.find((c) => c.id === "candidate-2")!;
  assert.equal(c2.eligible, false);
  assert.equal(c2.rejectReason, "missing-required-test");
  assert.equal(c2.label, null);
  assert.equal(c2.rankPosition, null);
  assert.notEqual(ranking.rankerTop, "candidate-2");
  assert.deepEqual(ranking.presentation.map((p) => p.id).sort(), ["candidate-1", "candidate-3"]);
  // Without the test request the same smallest candidate wins.
  const plain = buildRecords(task(4, "Normalize a title by trimming surrounding whitespace in src/text.ts"), summary, results, "seed");
  assert.equal(plain.ranking.rankerTop, "candidate-2");
});

test("ranking records reasons, positions, and a shuffled presentation independent of rank", () => {
  const summary = [sc("candidate-1", 30), sc("candidate-2", 5), sc("candidate-3", 9), sc("candidate-4", 2)];
  const results = [res("candidate-1", { diffLines: 30 }), res("candidate-2", { diffLines: 5 }), res("candidate-3", { diffLines: 9, originalSuitePassed: false }), res("candidate-4", { applied: false })];
  const { ranking } = buildRecords(task(9, "Do x"), summary, results, "s1");
  assert.deepEqual(ranking.rankerOrder, ["candidate-2", "candidate-1"]);
  assert.equal(ranking.rankerTop, "candidate-2");
  assert.equal(ranking.candidates.find((c) => c.id === "candidate-3")!.rejectReason, "original-suite");
  assert.equal(ranking.candidates.find((c) => c.id === "candidate-4")!.rejectReason, "not-applied");
  assert.deepEqual(ranking.presentation.map((p) => p.label), ["A", "B"]);
  const firstShown = new Set<string>();
  for (let i = 0; i < 30; i += 1) firstShown.add(buildRecords(task(9, "Do x"), summary, results, `seed-${i}`).ranking.presentation[0]!.id);
  assert.equal(firstShown.size, 2, "label A is not tied to the ranker's top pick");
});

test("held-out split is deterministic and about 20%", () => {
  assert.equal(isHeldOut(42), isHeldOut(42));
  let held = 0;
  for (let n = 1; n <= 2000; n += 1) if (isHeldOut(n)) held += 1;
  assert.ok(Math.abs(held / 2000 - HELD_OUT_RATE) < 0.03, String(held));
  const { task: t } = buildRecords(task(7), [sc("candidate-1", 3)], [res("candidate-1")], "s");
  assert.equal(t.heldOut, isHeldOut(7));
});

test("test tasks are marked by a [test] title prefix", () => {
  assert.equal(isTestTask("[test] M2 live check"), true);
  assert.equal(isTestTask("[TEST]x"), true);
  assert.equal(isTestTask("Real task [test]"), false);
});

test("verdict parsing", () => {
  assert.deepEqual(parseVerdict("/verdict b right"), { ok: true, command: { label: "B", verdict: "right" } });
  assert.deepEqual(parseVerdict("/verdict none wrong\nextra notes"), { ok: true, command: { label: null, verdict: "wrong" } });
  assert.deepEqual(parseVerdict("/verdict A unsure"), { ok: true, command: { label: "A", verdict: "unsure" } });
  for (const bad of ["/verdict", "/verdict B", "/verdict B great", "/verdict BB right", "/verdict none right", "/verdict B right please", "/verdictB right"])
    assert.equal(parseVerdict(bad).ok, false, bad);
  assert.equal(parseVerdict("hello").ok, false);
});

const v = (commentId: string, at: string, label: string | null, candidateId: string | null, verdict: VerdictRecord["verdict"]): VerdictRecord => ({
  schema: "peaceai-results-verdict:v1", issue: 3, runId: "1001", commentId, recordedAt: at, label, candidateId, verdict,
});

test("peace pick: latest decisive verdict; unsure and per-candidate wrong never pick", () => {
  assert.deepEqual(peacePick([]), { decided: false, candidateId: null });
  assert.deepEqual(peacePick([v("1", "2026-01-01T00:00:00Z", "A", "candidate-2", "unsure")]), { decided: false, candidateId: null });
  assert.deepEqual(peacePick([v("1", "2026-01-01T00:00:00Z", "A", "candidate-2", "wrong")]), { decided: false, candidateId: null });
  assert.deepEqual(peacePick([v("2", "2026-01-02T00:00:00Z", "B", "candidate-1", "right"), v("1", "2026-01-01T00:00:00Z", "A", "candidate-2", "right")]), { decided: true, candidateId: "candidate-1" });
  assert.deepEqual(peacePick([v("1", "2026-01-01T00:00:00Z", "A", "candidate-2", "right"), v("2", "2026-01-02T00:00:00Z", null, null, "wrong")]), { decided: true, candidateId: null });
});

test("agreement: only tasks with 2+ eligible candidates and a decisive pick; unsure and test excluded", () => {
  const two = buildRecords(task(10, "Do x"), [sc("candidate-1", 5), sc("candidate-2", 9)], [res("candidate-1", { diffLines: 5 }), res("candidate-2", { diffLines: 9 })], "s");
  const one = buildRecords(task(11, "Do x"), [sc("candidate-1", 5)], [res("candidate-1")], "s");
  const testTask = buildRecords(task(12, "[test] Do x"), [sc("candidate-1", 5), sc("candidate-2", 9)], [res("candidate-1", { diffLines: 5 }), res("candidate-2", { diffLines: 9 })], "s");
  const agreeEntry = taskEntry(two.task, two.ranking, [v("1", "2026-01-01T00:00:00Z", "A", "candidate-1", "right")]);
  assert.equal(agreeEntry.agree, true);
  assert.equal(agreeEntry.countsTowardAgreement, true);
  const disagree = taskEntry(two.task, two.ranking, [v("1", "2026-01-01T00:00:00Z", "A", "candidate-2", "right")]);
  assert.equal(disagree.agree, false);
  const unsure = taskEntry(two.task, two.ranking, [v("1", "2026-01-01T00:00:00Z", "A", "candidate-1", "unsure")]);
  assert.equal(unsure.agree, null);
  assert.equal(unsure.unsure, 1);
  assert.equal(unsure.countsTowardAgreement, false);
  const single = taskEntry(one.task, one.ranking, [v("1", "2026-01-01T00:00:00Z", "A", "candidate-1", "right")]);
  assert.equal(single.agree, null);
  assert.equal(single.countsTowardAgreement, false);
  const t = taskEntry(testTask.task, testTask.ranking, [v("1", "2026-01-01T00:00:00Z", "A", "candidate-1", "right")]);
  assert.equal(t.agree, true);
  assert.equal(t.countsTowardAgreement, false);
  assert.equal(t.trainable, false);
  const summary = buildSummary([agreeEntry, taskEntry(two.task, two.ranking, []), single, t, { ...disagree, issue: 13 }]);
  assert.deepEqual(summary.agreement, { counted: 2, agree: 1, rate: 0.5 });
  assert.equal(summary.testTasks, 1);
});

test("store: append-only layout, latest attempt, deterministic summary", () => {
  const root = mkdtempSync(join(tmpdir(), "results-"));
  const rec = buildRecords(task(20, "[test] Do x with focused tests"), [sc("candidate-1", 5), sc("candidate-2", 9)], [res("candidate-1"), res("candidate-2")], "s");
  const dir = taskDir(root, 20, "1001");
  writeNew(join(dir, "task.json"), stableJson(rec.task));
  writeNew(join(dir, "ranking.json"), stableJson(rec.ranking));
  assert.throws(() => writeNew(join(dir, "task.json"), "x"), /already exists/);
  assert.throws(() => taskDir(root, 20, "../x"), /invalid/);
  const later = buildRecords({ ...task(20, "[test] Do x"), runId: "1002" }, [sc("candidate-1", 5)], [res("candidate-1")], "s");
  writeNew(join(taskDir(root, 20, "1002"), "task.json"), stableJson(later.task));
  writeNew(join(taskDir(root, 20, "1002"), "ranking.json"), stableJson(later.ranking));
  writeNew(join(taskDir(root, 20, "1002"), "verdicts", "55.json"), stableJson(v("55", "2026-01-01T00:00:00Z", "A", "candidate-1", "right")));
  appendIndex(root, { type: "task", issue: 20 });
  assert.equal(latestAttempt(root, 20)!.task.runId, "1002");
  assert.equal(latestAttempt(root, 21), null);
  assert.equal(loadAll(root).length, 2);
  const s1 = writeSummary(root);
  const bytes = readFileSync(join(root, "summary.json"), "utf8");
  writeSummary(root);
  assert.equal(readFileSync(join(root, "summary.json"), "utf8"), bytes);
  assert.equal(s1.tasks, 2);
  assert.ok(existsSync(join(root, "index.jsonl")));
  assert.equal(stableJson({ b: 1, a: { d: 1, c: 2 } }), '{\n  "a": {\n    "c": 2,\n    "d": 1\n  },\n  "b": 1\n}\n');
});
