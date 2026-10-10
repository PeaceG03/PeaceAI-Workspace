import assert from "node:assert/strict";
import test from "node:test";

import { isPassing, rankCandidates, shuffle, type CandidateResult } from "../lib/rank.ts";
import { planPullRequest } from "../lib/prbody.ts";
import { killSwitchAllows, shouldRunTask, type TriggerInput } from "../lib/trigger.ts";
import { buildVariants, cleanIssueText } from "../lib/taskmap.ts";

const ok: TriggerInput = {
  eventName: "issues",
  action: "labeled",
  labelName: "peace-task",
  issueAuthor: "PeaceG03",
  sender: "PeaceG03",
  enabled: "true",
  repository: "PeaceG03/PeaceAI-Workspace",
};

test("trigger runs only for owner-labeled peace-task issues with the kill switch on", () => {
  assert.equal(shouldRunTask(ok), true);
  for (const change of [
    { eventName: "pull_request" },
    { action: "opened" },
    { labelName: "bug" },
    { issueAuthor: "someone-else" },
    { sender: "someone-else" },
    { enabled: "false" },
    { enabled: undefined },
    { enabled: "TRUE" },
    { repository: "fork/PeaceAI-Workspace" },
  ] as Partial<TriggerInput>[])
    assert.equal(shouldRunTask({ ...ok, ...change }), false, JSON.stringify(change));
});

test("kill switch inside Job A accepts only the literal true", () => {
  assert.equal(killSwitchAllows("true"), true);
  for (const value of ["false", "", undefined, "1", "yes", " true"]) assert.equal(killSwitchAllows(value), false);
});

const c = (id: string, over: Partial<CandidateResult> = {}): CandidateResult => ({
  id,
  diffBytes: 100,
  diffLines: 10,
  applied: true,
  typecheckPassed: true,
  originalSuitePassed: true,
  newTestsPassed: true,
  newTestFiles: 1,
  ...over,
});

test("ranking: original suite first, then smallest diff, stable tie-break", () => {
  const ranked = rankCandidates([c("candidate-1", { diffLines: 30 }), c("candidate-2", { originalSuitePassed: false, diffLines: 1 }), c("candidate-3", { diffLines: 5 }), c("candidate-4", { diffLines: 5 })]);
  assert.deepEqual(ranked.map((x) => x.id), ["candidate-3", "candidate-4", "candidate-1", "candidate-2"]);
});

test("passing requires apply, typecheck, original suite and new tests", () => {
  assert.equal(isPassing(c("candidate-1")), true);
  for (const key of ["applied", "typecheckPassed", "originalSuitePassed", "newTestsPassed"] as const)
    assert.equal(isPassing(c("candidate-1", { [key]: false })), false, key);
});

test("shuffle is a permutation, seed-dependent, and does not mutate input", () => {
  const items = ["a", "b", "c", "d", "e"];
  const orders = new Set<string>();
  for (let i = 0; i < 40; i += 1) {
    const out = shuffle(items, `seed-${i}`);
    assert.deepEqual([...out].sort(), items);
    orders.add(out.join(""));
  }
  assert.ok(orders.size > 10);
  assert.deepEqual(items, ["a", "b", "c", "d", "e"]);
  assert.deepEqual(shuffle(items, "same"), shuffle(items, "same"));
});

test("PR plan lists every passing candidate, no scores, and picks the ranked top", () => {
  const results = {
    schema: "peaceai-workspace-results:v1" as const,
    taskId: "workspace-issue-3",
    baseSha: "b".repeat(40),
    results: [c("candidate-1", { diffLines: 20 }), c("candidate-2", { diffLines: 4 }), c("candidate-3", { newTestsPassed: false })],
  };
  const diffs = new Map([["candidate-1", "diff one"], ["candidate-2", "diff two"], ["candidate-3", "diff three"]]);
  const plan = planPullRequest(results, diffs, "3", "seed");
  assert.equal(plan.passing, 2);
  assert.equal(plan.chosenId, "candidate-2");
  assert.ok(plan.body.includes("diff one") && plan.body.includes("diff two") && !plan.body.includes("diff three"));
  assert.ok(!/score|rank|diffLines|candidate-\d/i.test(plan.body.replace(/without scores/, "")));
  const none = planPullRequest({ ...results, results: [c("candidate-1", { applied: false })] }, diffs, "3", "seed");
  assert.equal(none.passing, 0);
  assert.equal(none.chosenId, null);
});

test("task mapping cleans issue text and puts named owners first", () => {
  assert.equal(cleanIssueText({ title: "T", body: "a <!-- hidden --> `b`\n```\ncode\n```" }), "T\n\na b");
  const variants = buildVariants({ title: "Trim", body: "Edit src/text.ts please" }, ["src/numbers.ts", "src/text.ts", "src/text.test.ts"]);
  assert.equal(variants[0]!.targetPath, "src/text.ts");
  assert.ok(variants.every((v) => !v.targetPath.endsWith(".test.ts")));
  assert.ok(variants.some((v) => /focused tests/.test(v.objective)));
  assert.deepEqual(buildVariants({ title: "", body: "" }, ["src/a.ts"]), []);
});
