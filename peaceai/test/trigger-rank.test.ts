import assert from "node:assert/strict";
import test from "node:test";

import { isPassing, rankCandidates, shuffle, type CandidateResult } from "../lib/rank.ts";
import { reviewBody, validatePresentation } from "../lib/review.ts";
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

test("review body shows every presented candidate the same way, in order, with no scores", () => {
  const presentation = [{ label: "A", id: "candidate-3" }, { label: "B", id: "candidate-1" }];
  const diffs = new Map([["candidate-1", "diff one"], ["candidate-3", "diff three"], ["candidate-2", "diff two"]]);
  const body = reviewBody(presentation, diffs);
  assert.ok(body.indexOf("diff three") < body.indexOf("diff one"));
  assert.ok(!body.includes("diff two"));
  assert.ok(!/score|rank|chosen|recommended|top|best|candidate-\d/i.test(body));
  const sections = body.split("### Candidate ").slice(1).map((s) => s.replace(/^[A-Z]/, "").replace(/diff (one|three)/, "X"));
  assert.equal(sections[0]!.trim().split("\n").slice(0, 6).join("\n"), sections[1]!.trim().split("\n").slice(0, 6).join("\n"));
});

test("presentation must be sequential letters over distinct known candidates", () => {
  const ids = ["candidate-1", "candidate-2"];
  assert.equal(validatePresentation([{ label: "A", id: "candidate-2" }, { label: "B", id: "candidate-1" }], ids), true);
  assert.equal(validatePresentation([{ label: "B", id: "candidate-2" }], ids), false);
  assert.equal(validatePresentation([{ label: "A", id: "candidate-2" }, { label: "B", id: "candidate-2" }], ids), false);
  assert.equal(validatePresentation([{ label: "A", id: "candidate-9" }], ids), false);
  assert.equal(validatePresentation([{ label: "A", id: "candidate-1", rank: 1 }], ids), false);
  assert.equal(validatePresentation([], ids), false);
});

test("task mapping cleans issue text and puts named owners first", () => {
  assert.equal(cleanIssueText({ title: "T", body: "a <!-- hidden --> `b`\n```\ncode\n```" }), "T\n\na b");
  // Identifier underscores survive (M4 families name constants like MAX_ITEMS); emphasis does not.
  assert.equal(cleanIssueText({ title: "Add an exported constant MAX_ITEMS with value 5", body: "_really_ __now__" }), "Add an exported constant MAX_ITEMS with value 5\n\n really now");
  const variants = buildVariants({ title: "Trim", body: "Edit src/text.ts please" }, ["src/numbers.ts", "src/text.ts", "src/text.test.ts"]);
  assert.equal(variants[0]!.targetPath, "src/text.ts");
  assert.ok(variants.every((v) => !v.targetPath.endsWith(".test.ts")));
  assert.ok(variants.some((v) => /focused tests/.test(v.objective)));
  const withTests = buildVariants({ title: "Trim", body: "Add a helper in src/text.ts, with focused tests." }, ["src/text.ts"]);
  assert.ok(withTests.every((v) => /focused tests/.test(v.objective)), "never drop the test request");
  assert.deepEqual(buildVariants({ title: "", body: "" }, ["src/a.ts"]), []);
});
