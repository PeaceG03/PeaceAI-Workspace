import assert from "node:assert/strict";
import { mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { SummaryCandidate } from "../lib/gate.ts";
import { findOpenPeacePr, openPeacePrs, planPr, prBranch } from "../lib/prguard.ts";
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

test("scoped unsure: only `none unsure` or unsure on the picked letter withdraws", () => {
  const r = records(32);
  const aRight = v("100", 1, "A", "candidate-1", "right");
  // A right then C unsure: a label for C; A stays counted for training and agreement.
  const label = [aRight, v("101", 2, "C", "candidate-3", "unsure")];
  const kept = effectiveVerdict(label);
  assert.deepEqual(kept.pick, { decided: true, candidateId: "candidate-1" });
  assert.equal(kept.latest!.commentId, "100");
  assert.equal(kept.withdrawn, false);
  assert.equal(kept.unsure, 1);
  const keptEntry = taskEntry(r.task, r.ranking, label);
  assert.equal(keptEntry.trainable, true);
  assert.equal(keptEntry.countsTowardAgreement, true);
  assert.equal(keptEntry.agree, true);
  // A right then A unsure: withdrawn, excluded everywhere.
  for (const rows of [[aRight, v("101", 2, "A", "candidate-1", "unsure")], [aRight, v("101", 2, null, null, "unsure")]]) {
    const e = effectiveVerdict(rows);
    assert.deepEqual(e.pick, { decided: false, candidateId: null });
    assert.equal(e.latest, null);
    assert.equal(e.withdrawn, true);
    const entry = taskEntry(r.task, r.ranking, rows);
    assert.equal(entry.trainable, false);
    assert.equal(entry.countsTowardAgreement, false);
    assert.equal(entry.withdrawn, true);
    assert.equal(entry.latestVerdict, null);
    assert.equal(buildSummary([entry]).withdrawnTasks, 1);
  }
  // Withdrawn, then B right: counts B.
  const again = effectiveVerdict([aRight, v("101", 2, "A", "candidate-1", "unsure"), v("102", 3, "B", "candidate-2", "right")]);
  assert.deepEqual(again.pick, { decided: true, candidateId: "candidate-2" });
  assert.equal(again.withdrawn, false);
  // Withdrawn, then a per-candidate label: still withdrawn, nothing counted.
  const lbl = effectiveVerdict([aRight, v("101", 2, null, null, "unsure"), v("103", 4, "B", "candidate-2", "wrong")]);
  assert.equal(lbl.pick.decided, false);
  assert.equal(lbl.withdrawn, true);
  // Unsure with nothing picked is just a label; `none wrong` pick is not withdrawn by a letter unsure.
  assert.equal(effectiveVerdict([v("100", 1, "A", "candidate-1", "unsure")]).withdrawn, false);
  const none = effectiveVerdict([v("100", 1, null, null, "wrong"), v("101", 2, "A", "candidate-1", "unsure")]);
  assert.deepEqual(none.pick, { decided: true, candidateId: null });
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
  const rows = [v("200", 2, "A", "candidate-1", "right", 35), v("201", 3, "B", "candidate-2", "right", 35), v("202", 4, "A", "candidate-1", "wrong", 35)];
  for (const row of rows) writeNew(join(taskDir(root, 35, "1001"), "verdicts", `${row.commentId}.json`), stableJson(row));
  assert.throws(() => writeNew(join(taskDir(root, 35, "1001"), "verdicts", "200.json"), "x"), /already exists/);
  const s = writeSummary(root);
  assert.deepEqual(s.agreement, { counted: 1, agree: 0, rate: 0 });
  assert.equal(s.trainableTasks, 1);
  const e = effectiveForIssue(root, 35)!;
  assert.equal(e.task.runId, "1001");
  assert.deepEqual(e.pick, { decided: true, candidateId: "candidate-2" });
  assert.equal(e.latest!.commentId, "202");
  assert.equal(readdirSync(join(taskDir(root, 35, "1001"), "verdicts")).length, 3);
  assert.equal(effectiveForIssue(root, 37), null);
});

test("PR plan: same candidate keeps its PR, a different one replaces it, none wrong closes, withdrawal marks", () => {
  const prs = [
    { number: 40, headRefName: "peace-task/issue-12-candidate-1-ab12cd34" },
    { number: 41, headRefName: prBranch(1, "candidate-2", "ffff0000") },
    { number: 42, headRefName: "feature/issue-1-x" },
    { number: 43, headRefName: "peace-task/issue-3-0a1b2c3d" }, // M2.5-era branch: candidate unknown
  ];
  assert.deepEqual(openPeacePrs(prs, 1), [{ number: 41, candidateId: "candidate-2", withdrawn: false }]);
  assert.deepEqual(openPeacePrs(prs, 3), [{ number: 43, candidateId: null, withdrawn: false }]);
  assert.equal(findOpenPeacePr(prs, 12), 40);
  assert.equal(findOpenPeacePr(prs, 2), null);
  const open = openPeacePrs(prs, 1);
  // First right, nothing open: open one.
  assert.deepEqual(planPr({ label: "B", verdict: "right", candidateId: "candidate-2" }, []), { close: [], open: true, markWithdrawn: [], unmarkWithdrawn: [], reply: "Verdict recorded: B right. Opening a PR for B." });
  // Double verdict, same candidate: no second PR.
  const same = planPr({ label: "B", verdict: "right", candidateId: "candidate-2" }, open);
  assert.deepEqual(same.close, []);
  assert.equal(same.open, false);
  assert.match(same.reply, /PR #41 already holds this candidate, so no new PR was opened/);
  // Switching letters: close the stale PR, open the new one.
  const sw = planPr({ label: "A", verdict: "right", candidateId: "candidate-1" }, open);
  assert.deepEqual(sw.close, [41]);
  assert.equal(sw.open, true);
  assert.match(sw.reply, /Closed #41 \(a different candidate\)\. Opening a PR for A\./);
  // Unknown (older) branch is treated as different.
  assert.deepEqual(planPr({ label: "A", verdict: "right", candidateId: "candidate-1" }, openPeacePrs(prs, 3)).close, [43]);
  // none wrong: nothing may stay open.
  const none = planPr({ label: "none", verdict: "wrong", candidateId: null }, open);
  assert.deepEqual(none, { close: [41], open: false, markWithdrawn: [], unmarkWithdrawn: [], reply: "Verdict recorded: none wrong. Closed #41: no candidate is acceptable." });
  // unsure that withdraws: PR stays, but is marked.
  const unsure = planPr({ label: "B", verdict: "unsure", candidateId: "candidate-2", withdrew: true }, open);
  assert.deepEqual(unsure.close, []);
  assert.equal(unsure.open, false);
  assert.deepEqual(unsure.markWithdrawn, [41]);
  assert.match(unsure.reply, /withdraws your pick/);
  assert.match(unsure.reply, /#41 marked `verdict-withdrawn`: do not merge\./);
  // Scoped unsure on another letter: a label only, no PR changes.
  const scoped = planPr({ label: "C", verdict: "unsure", candidateId: "candidate-3", withdrew: false }, open);
  assert.deepEqual({ ...scoped, reply: "" }, { close: [], open: false, markWithdrawn: [], unmarkWithdrawn: [], reply: "" });
  assert.match(scoped.reply, /label for C; your pick still counts/);
  // Per-candidate wrong does not change the pick: no PR changes.
  assert.deepEqual(planPr({ label: "A", verdict: "wrong", candidateId: "candidate-1" }, open), { close: [], open: false, markWithdrawn: [], unmarkWithdrawn: [], reply: "Verdict recorded: A wrong." });
});

test("withdrawn PR marking: labelled on withdrawal, unlabelled when the same candidate is picked again, closed if different", () => {
  const prs = [{ number: 50, headRefName: prBranch(5, "candidate-1", "aaaa0000"), labels: [{ name: "verdict-withdrawn" }] }];
  const open = openPeacePrs(prs, 5);
  assert.deepEqual(open, [{ number: 50, candidateId: "candidate-1", withdrawn: true }]);
  // Already marked: withdrawing again does not re-label or re-comment.
  assert.deepEqual(planPr({ label: "none", verdict: "unsure", candidateId: null, withdrew: true }, open).markWithdrawn, []);
  // Same candidate picked again: remove the label, keep the PR.
  const again = planPr({ label: "A", verdict: "right", candidateId: "candidate-1" }, open);
  assert.deepEqual(again.unmarkWithdrawn, [50]);
  assert.deepEqual(again.close, []);
  assert.equal(again.open, false);
  assert.match(again.reply, /Removed `verdict-withdrawn` from #50\./);
  // Different candidate: the stale PR is closed, a new one opened, nothing to unmark.
  const other = planPr({ label: "B", verdict: "right", candidateId: "candidate-2" }, open);
  assert.deepEqual(other.close, [50]);
  assert.equal(other.open, true);
  assert.deepEqual(other.unmarkWithdrawn, []);
  // Unmarked PR picked again: nothing to remove.
  assert.deepEqual(planPr({ label: "A", verdict: "right", candidateId: "candidate-1" }, openPeacePrs([{ number: 51, headRefName: prBranch(5, "candidate-1", "bbbb0000") }], 5)).unmarkWithdrawn, []);
});

test("invariant: after any verdict sequence no open PR holds a candidate other than the counted right pick", () => {
  let open: { number: number; candidateId: string | null }[] = [];
  let next = 100;
  const seq: [string, "right" | "wrong" | "unsure", string | null][] = [
    ["A", "right", "candidate-1"], ["A", "right", "candidate-1"], ["B", "right", "candidate-2"], ["B", "unsure", "candidate-2"],
    ["A", "right", "candidate-1"], ["none", "wrong", null], ["C", "right", "candidate-3"], ["A", "wrong", "candidate-1"],
  ];
  const rows: VerdictRecord[] = [];
  seq.forEach(([label, verdict, candidateId], i) => {
    const before = effectiveVerdict(rows).pick;
    const withdrew = verdict === "unsure" && (candidateId === null || (before.decided && before.candidateId === candidateId));
    const plan = planPr({ label, verdict, candidateId, withdrew }, open);
    open = open.filter((pr) => !plan.close.includes(pr.number));
    if (plan.open) open.push({ number: next++, candidateId });
    rows.push(v(String(500 + i), i, label === "none" ? null : label, candidateId, verdict));
    const pick = effectiveVerdict(rows).pick;
    assert.ok(open.length <= 1, `step ${i}: at most one open PR`);
    if (pick.decided) for (const pr of open) assert.equal(pr.candidateId, pick.candidateId, `step ${i}: open PR matches the counted pick`);
  });
});

test("record-verdict outputs: withdrew only for unsure on the picked letter or none; test flag for [test] tasks", async () => {
  const { spawnSync } = await import("node:child_process");
  const { readFileSync } = await import("node:fs");
  const repo = join(import.meta.dirname, "../..");
  const root = mkdtempSync(join(tmpdir(), "m31-"));
  const r = buildRecords({ ...task(38), title: "[test] Do x" }, [sc("candidate-1", 5), sc("candidate-2", 9), sc("candidate-3", 12)],
    [res("candidate-1", 5), res("candidate-2", 9), res("candidate-3", 12)], "s");
  writeNew(join(taskDir(root, 38, "1001"), "task.json"), stableJson(r.task));
  writeNew(join(taskDir(root, 38, "1001"), "ranking.json"), stableJson(r.ranking));
  const [a, c] = ["A", "C"];
  const say = (id: number, body: string) => {
    const out = join(root, `out-${id}`);
    const p = spawnSync(join(repo, "node_modules/.bin/tsx"), [join(repo, "peaceai/bin/record-verdict.ts")], {
      encoding: "utf8",
      env: { ...process.env, RESULTS_DIR: root, ISSUE_NUMBER: "38", COMMENT_ID: String(id), COMMENT_CREATED_AT: `2026-10-10T03:0${id % 10}:00Z`, COMMENT_BODY: body, GITHUB_OUTPUT: out },
    });
    assert.equal(p.status, 0, p.stderr);
    return Object.fromEntries(readFileSync(out, "utf8").trim().split("\n").map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
  };
  assert.equal(say(901, `/verdict ${a} right`).withdrew, "false");
  const scoped = say(902, `/verdict ${c} unsure`);
  assert.equal(scoped.withdrew, "false");
  assert.equal(scoped.test, "true");
  assert.equal(say(903, `/verdict ${a} unsure`).withdrew, "true");
  assert.equal(say(904, `/verdict ${a} right`).withdrew, "false");
  assert.equal(say(905, "/verdict none unsure").withdrew, "true");
  assert.equal(say(906, "/verdict none unsure").withdrew, "true"); // nothing standing; harmless re-mark is skipped by planPr
  const e = effectiveForIssue(root, 38)!;
  assert.equal(e.withdrawn, true);
  assert.equal(e.total, 6);
});
