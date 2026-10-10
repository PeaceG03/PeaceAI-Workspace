import assert from "node:assert/strict";
import { mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { SummaryCandidate } from "../lib/gate.ts";
import { findOpenPeacePr, verdictReply } from "../lib/prguard.ts";
import type { CandidateResult } from "../lib/rank.ts";
import { buildRecords, buildSummary, effectiveVerdict, stableJson, taskEntry, type VerdictRecord } from "../lib/records.ts";
import { effectiveVerdict as effectiveForIssue, taskDir, writeNew, writeSummary } from "../lib/store.ts";

const sc = (id: string, lines: number): SummaryCandidate => ({ id, file: `candidates/${id}.diff`, transformations: ["X"], operationId: null, diffBytes: lines * 10, diffLines: lines });
const res = (id: string, lines: number): CandidateResult => ({ id, diffBytes: lines * 10, diffLines: lines, applied: true, typecheckPassed: true, originalSuitePassed: true, newTestsPassed: true, newTestFiles: 0 });
const task = (issue: number, runId = "1001") => ({ issue, runId, recordedAt: "2026-10-10T00:00:00Z", baseSha: "a".repeat(40), title: "Do x", body: "" });
// candidate-1 is the ranker's top pick (smaller diff).
const records = (issue: number, runId = "1001") => buildRecords(task(issue, runId), [sc("candidate-1", 5), sc("candidate-2", 9)], [res("candidate-1", 5), res("candidate-2", 9)], "s");
const v = (commentId: string, minute: number, label: string | null, candidateId: string | null, verdict: VerdictRecord["verdict"], issue = 30, runId = "1001"): VerdictRecord => ({
  schema: "peaceai-results-verdict:v1", issue, runId, commentId, recordedAt: `2026-10-10T00:${String(minute).padStart(2, "0")}:00Z`, label, candidateId, verdict,
});

test("double verdict on the same letter: one effective verdict, agreement counted once", () => {
  const rows = [v("100", 1, "A", "candidate-1", "right"), v("101", 2, "A", "candidate-1", "right")];
  const e = effectiveVerdict(rows);
  assert.deepEqual(e.pick, { decided: true, candidateId: "candidate-1" });
  assert.equal(e.latest!.commentId, "101");
  assert.equal(e.total, 2);
  const r = records(30);
  const s = buildSummary([taskEntry(r.task, r.ranking, rows)]);
  assert.deepEqual(s.agreement, { counted: 1, agree: 1, rate: 1 });
  assert.equal(s.trainableTasks, 1);
});

test("switching letters: the latest right wins for agreement and training", () => {
  const rows = [v("100", 1, "A", "candidate-1", "right"), v("101", 2, "B", "candidate-2", "right")];
  const e = effectiveVerdict(rows);
  assert.deepEqual(e.pick, { decided: true, candidateId: "candidate-2" });
  assert.equal(e.latest!.candidateId, "candidate-2");
  const r = records(31);
  const entry = taskEntry(r.task, r.ranking, rows);
  assert.equal(entry.agree, false);
  assert.deepEqual(entry.latestVerdict, { label: "B", candidateId: "candidate-2", verdict: "right" });
  // Order of the stored rows does not matter, only when they were given.
  assert.deepEqual(effectiveVerdict([...rows].reverse()).pick, e.pick);
  // Switch back again: latest wins.
  assert.equal(effectiveVerdict([...rows, v("102", 3, "A", "candidate-1", "right")]).pick.candidateId, "candidate-1");
  // A later `none wrong` overrides a right.
  assert.deepEqual(effectiveVerdict([...rows, v("103", 4, null, null, "wrong")]).pick, { decided: true, candidateId: null });
});

test("unsure after right: recorded, never overrides; unsure alone is not trainable", () => {
  const rows = [v("100", 1, "A", "candidate-1", "right"), v("101", 2, "B", "candidate-2", "unsure")];
  const e = effectiveVerdict(rows);
  assert.deepEqual(e.pick, { decided: true, candidateId: "candidate-1" });
  assert.equal(e.latest!.commentId, "100");
  assert.equal(e.unsure, 1);
  const r = records(32);
  const entry = taskEntry(r.task, r.ranking, rows);
  assert.equal(entry.trainable, true);
  assert.equal(entry.agree, true);
  const onlyUnsure = taskEntry(r.task, r.ranking, [v("104", 1, "A", "candidate-1", "unsure")]);
  assert.equal(onlyUnsure.trainable, false);
  assert.equal(onlyUnsure.countsTowardAgreement, false);
  assert.equal(onlyUnsure.latestVerdict, null);
});

test("ordering ties: same timestamp falls back to numeric comment id", () => {
  const rows = [v("99", 1, "A", "candidate-1", "right"), v("100", 1, "B", "candidate-2", "right")];
  assert.equal(effectiveVerdict(rows).pick.candidateId, "candidate-2");
});

test("summary: only the latest attempt per issue counts; reader uses latest attempt; raw rows untouched", () => {
  const root = mkdtempSync(join(tmpdir(), "m25-"));
  for (const runId of ["900", "1001"]) {
    const r = records(35, runId);
    writeNew(join(taskDir(root, 35, runId), "task.json"), stableJson(r.task));
    writeNew(join(taskDir(root, 35, runId), "ranking.json"), stableJson(r.ranking));
  }
  writeNew(join(taskDir(root, 35, "900"), "verdicts", "100.json"), stableJson(v("100", 1, "A", "candidate-1", "right", 35, "900")));
  const rows = [v("200", 2, "A", "candidate-1", "right", 35), v("201", 3, "B", "candidate-2", "right", 35), v("202", 4, "A", "candidate-1", "unsure", 35)];
  for (const row of rows) writeNew(join(taskDir(root, 35, "1001"), "verdicts", `${row.commentId}.json`), stableJson(row));
  assert.throws(() => writeNew(join(taskDir(root, 35, "1001"), "verdicts", "200.json"), "x"), /already exists/);
  const s = writeSummary(root);
  assert.deepEqual(s.agreement, { counted: 1, agree: 0, rate: 0 });
  assert.equal(s.trainableTasks, 1);
  const e = effectiveForIssue(root, 35)!;
  assert.equal(e.task.runId, "1001");
  assert.deepEqual(e.pick, { decided: true, candidateId: "candidate-2" });
  assert.equal(e.latest!.commentId, "201");
  assert.equal(readdirSync(join(taskDir(root, 35, "1001"), "verdicts")).length, 3);
  assert.equal(effectiveForIssue(root, 37), null);
});

test("no second PR: an open PeaceAI PR for the issue blocks a new one and the reply says what to do", () => {
  const prs = [
    { number: 40, headRefName: "peace-task/issue-12-ab12cd34" },
    { number: 41, headRefName: "peace-task/issue-1-ffff0000" },
    { number: 42, headRefName: "feature/issue-1-x" },
  ];
  assert.equal(findOpenPeacePr(prs, 1), 41);
  assert.equal(findOpenPeacePr(prs, 12), 40);
  assert.equal(findOpenPeacePr(prs, 2), null);
  assert.equal(verdictReply("B", "right", null, true), "Verdict recorded: B right.");
  assert.equal(verdictReply("A", "unsure", 41, false), "Verdict recorded: A unsure.");
  const blocked = verdictReply("B", "right", 41, true);
  assert.match(blocked, /PR #41 is already open/);
  assert.match(blocked, /no new PR was opened/);
  assert.match(blocked, /close #41 and send the verdict again/);
});
