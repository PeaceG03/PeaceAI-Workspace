import assert from "node:assert/strict";
import test from "node:test";

import { isCandidateIssue, labeledByOwner, pickNext, remainingAfter, STATE, staleRunning, type QueueIssue } from "../lib/queue.ts";

const issue = (number: number, labels: string[] = ["peace-task"], over: Partial<QueueIssue> = {}): QueueIssue => ({
  number, state: "open", author: "PeaceG03", labels, isPullRequest: false, ...over,
});

test("candidate issues: open owner issues with the task label and no running/done/failed state", () => {
  assert.equal(isCandidateIssue(issue(1)), true);
  assert.equal(isCandidateIssue(issue(1, ["peace-task", STATE.queued])), true);
  for (const s of [STATE.running, STATE.done, STATE.failed]) assert.equal(isCandidateIssue(issue(1, ["peace-task", s])), false);
  assert.equal(isCandidateIssue(issue(1, [])), false);
  assert.equal(isCandidateIssue(issue(1, ["peace-task"], { author: "someone" })), false);
  assert.equal(isCandidateIssue(issue(1, ["peace-task"], { isPullRequest: true })), false);
  assert.equal(isCandidateIssue(issue(1, ["peace-task"], { state: "closed" })), false);
});

test("label provenance: the latest task-label application must be by the owner", () => {
  assert.equal(labeledByOwner([{ event: "labeled", label: "peace-task", actor: "PeaceG03" }]), true);
  assert.equal(labeledByOwner([{ event: "labeled", label: "peace-task", actor: "PeaceG03" }, { event: "labeled", label: "peace-task", actor: "other" }]), false);
  assert.equal(labeledByOwner([{ event: "labeled", label: "bug", actor: "PeaceG03" }]), false);
  assert.equal(labeledByOwner([]), false);
});

test("pick oldest verified; stale running issues are reported", () => {
  const issues = [issue(9), issue(4), issue(6, ["peace-task", STATE.running])];
  assert.equal(pickNext(issues, new Set([4, 9])), 4);
  assert.equal(pickNext(issues, new Set([9])), 9);
  assert.equal(pickNext(issues, new Set()), null);
  assert.deepEqual(staleRunning(issues), [6]);
  assert.equal(remainingAfter(issues, 4), 1);
});

/**
 * Simulates GitHub concurrency (one running, one pending slot; a newer pending run cancels the
 * older pending one) with intake dispatching a sweep per label and each finished run chaining
 * another sweep while tasks are waiting.
 */
function simulate(labelTimes: number[], runDuration: number): { processed: number[]; cancelled: number } {
  const issues: QueueIssue[] = [];
  type Run = { endsAt: number; issue: number | null };
  let running = null as Run | null;
  let pending = false;
  let cancelled = 0;
  const processed: number[] = [];
  const events = labelTimes.map((t, i) => ({ t, number: i + 1 })).sort((a, b) => a.t - b.t);
  const dispatch = () => {
    if (pending) cancelled += 1; // the older pending run is cancelled
    pending = true;
  };
  const start = (now: number) => {
    pending = false;
    const next = pickNext(issues, new Set(issues.map((i) => i.number)));
    if (next !== null) issues.find((i) => i.number === next)!.labels.push(STATE.running);
    running = { endsAt: now + runDuration, issue: next };
  };
  for (let now = 0; now < 10_000; now += 1) {
    for (const e of events.filter((e) => e.t === now)) {
      issues.push(issue(e.number, ["peace-task", STATE.queued]));
      dispatch();
    }
    const current = running as Run | null;
    if (current && current.endsAt === now) {
      const finished = current;
      running = null;
      if (finished.issue !== null) {
        const i = issues.find((x) => x.number === finished.issue)!;
        i.labels = i.labels.filter((l) => l !== STATE.running).concat(STATE.done);
        processed.push(finished.issue);
        if (issues.some(isCandidateIssue)) dispatch();
      }
    }
    if (!running && pending) start(now);
  }
  return { processed, cancelled };
}

test("two tasks labeled close together are both processed, one at a time", () => {
  const result = simulate([0, 1], 50);
  assert.deepEqual(result.processed, [1, 2]);
});

test("a burst of labels loses nothing even though pending runs get cancelled", () => {
  const result = simulate([0, 1, 2, 3, 4], 50);
  assert.deepEqual(result.processed, [1, 2, 3, 4, 5]);
  assert.ok(result.cancelled > 0, "the simulation does exercise pending-run cancellation");
});
