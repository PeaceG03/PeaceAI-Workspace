// M231: a replay may read the issue the log already cites, and it runs on the parent of the landing commit.
// EXPERIMENTAL. credit is false. The sentences are made up. No network.
import assert from "node:assert/strict";
import test from "node:test";
import { adoptIssueBody, citedIssue, landingParent, replayIssueTitle } from "../lib/capabilityjob.ts";
import { parseExistingTestTask, TEST_EXISTING_TRIGGER } from "../lib/learned-test-existing.ts";
import { cleanIssueText, MAX_OBJECTIVE_CHARS } from "../lib/taskmap.ts";

const SEQ = 1;
const ASKED = "Peace's task PeaceAI-Workspace#370 (source: peace): add a characterization test for total in src/cart.ts: totals";
const BODY = [
  "Target: PeaceG03/PeaceSTOCKS",
  "",
  "add a characterization test for total in src/cart.ts: totals",
  "- total(1) is 2",
  "- total(0) throws NOT_POSITIVE",
  "",
  "(a note that is not a check)",
].join("\n");

test("one cited issue is kept, and a landing sha names its parent", () => {
  assert.equal(citedIssue(ASKED), 370);
  assert.equal(citedIssue("no issue here"), null);
  assert.equal(citedIssue("PeaceAI-Workspace#370 and PeaceAI-Workspace#371"), null);
  assert.equal(citedIssue("PeaceAI-Workspace#370 twice PeaceAI-Workspace#370"), 370);
  assert.equal(landingParent("af3050f"), "af3050f^1");
  assert.equal(landingParent("a".repeat(40)), `${"a".repeat(40)}^1`);
  assert.equal(landingParent("af3050f^1"), null);
  assert.equal(landingParent("AF3050F"), null);
  assert.equal(landingParent("main"), null);
});

test("the issue body is adopted only when it is the same task with readable checks", () => {
  assert.equal(adoptIssueBody(ASKED, BODY, SEQ), BODY);
  assert.equal(adoptIssueBody("add a characterization test for total in src/cart.ts", BODY, SEQ), BODY);
});

test("a near-miss issue is not adopted", () => {
  const swap = (from: string, to: string) => BODY.replace(from, to);
  assert.equal(adoptIssueBody(ASKED, swap("src/cart.ts", "src/carts.ts"), SEQ), null);
  assert.equal(adoptIssueBody(ASKED, swap("src/cart.ts", "src/./cart.ts"), SEQ), null);
  assert.equal(adoptIssueBody(ASKED, swap("for total", "for totality"), SEQ), null);
  assert.equal(adoptIssueBody(ASKED, swap("for total", "for Total"), SEQ), null);
  assert.equal(adoptIssueBody("add a characterization test for other in src/cart.ts", BODY, SEQ), null);
  assert.equal(adoptIssueBody(ASKED, "please import the milk from the test file", SEQ), null);
  assert.equal(adoptIssueBody(ASKED, "add a characterization test for total in src/cart.ts: totals", SEQ), null);
  assert.equal(adoptIssueBody(ASKED, `${BODY}\n- remember to import the milk`, SEQ), null);
  assert.equal(adoptIssueBody(ASKED, `${BODY}\n- totality(1) is 2`, SEQ), null);
  assert.equal(adoptIssueBody(ASKED, BODY.replace("- total(0) throws NOT_POSITIVE", "- other(0) throws NOT_POSITIVE"), SEQ), null);
  assert.equal(adoptIssueBody(ASKED, `${BODY}\nFix: ${"ab".repeat(20)}`, SEQ), null);
  assert.equal(adoptIssueBody(ASKED, `${BODY}\n- also edit src/secrets.ts`, SEQ), null);
  assert.equal(adoptIssueBody("make env BUDGET_MS strict in src/gap.ts as integer 1..10", BODY, SEQ), null);
  assert.equal(adoptIssueBody(ASKED, "", SEQ), null);
  assert.equal(adoptIssueBody(ASKED, `${"x".repeat(8001)}\n${BODY}`, SEQ), null);
  const earlier = `add a characterization test for other in src/pay.ts: no\n- other(1) is 1\n${BODY}`;
  assert.equal(adoptIssueBody(ASKED, earlier, SEQ), null);
});

function totalValue(text: string): string | undefined {
  return parseExistingTestTask(TEST_EXISTING_TRIGGER, text)?.checks.find((c) => c.expr === "total(1)")?.value;
}

test("a titled budget cut is a different check and is not adopted", () => {
  // "builder-log seq 10" plus the blank line spends 20 characters. A body that fills the
  // budget and ends in thirty 9s keeps all of them under an empty title, and ten under this title.
  const seq = 10;
  assert.equal(replayIssueTitle(seq), `builder-log seq ${seq}`);
  assert.equal(replayIssueTitle(seq).length + 2, 20);
  const thirty = "9".repeat(30);
  const header = "add a characterization test for total in src/cart.ts: totals";
  const check = `- total(1) is ${thirty}`;
  const pad = "p".repeat(MAX_OBJECTIVE_CHARS - header.length - check.length - 2);
  const body = `${header}\n${pad}\n${check}`;
  assert.equal(body.length, MAX_OBJECTIVE_CHARS);
  assert.equal(body.slice(-30), thirty);
  const bare = cleanIssueText({ title: "", body });
  const titled = cleanIssueText({ title: replayIssueTitle(seq), body });
  assert.equal(totalValue(bare), thirty);
  assert.equal(totalValue(titled), "9".repeat(10));
  assert.equal(titled.length, MAX_OBJECTIVE_CHARS);
  assert.equal(adoptIssueBody(ASKED, body, seq), null);
});

const PROBE_HEADER = "add a characterization test for total in src/cart.ts: totals";
const PROBE_CHECK = "- total(1) is 1";
const PROBE_TRAILER = `Note. ${"x".repeat(2500)}`;
const PROBE_SEQ = 9;

function probeChecks(body: string): { expr: string; value?: string; code?: string }[] | null {
  const task = parseExistingTestTask(TEST_EXISTING_TRIGGER, cleanIssueText({ title: replayIssueTitle(PROBE_SEQ), body }));
  return task ? task.checks.map((c) => ({ expr: c.expr, ...(c.value !== undefined ? { value: c.value } : {}), ...(c.code !== undefined ? { code: c.code } : {}) })) : null;
}

test("a quoted or backticked check after the last plain bullet stays in the adopted set", () => {
  for (const hidden of ["> - total(2) is 99", "`- total(2) is 99`"]) {
    const body = [PROBE_HEADER, PROBE_CHECK, hidden, "", PROBE_TRAILER].join("\n");
    const full = cleanIssueText({ title: replayIssueTitle(PROBE_SEQ), body });
    assert.equal(full.length, MAX_OBJECTIVE_CHARS, hidden);
    const adopted = adoptIssueBody(ASKED, body, PROBE_SEQ);
    assert.ok(adopted, hidden);
    const cleaned = cleanIssueText({ title: replayIssueTitle(PROBE_SEQ), body: adopted! });
    assert.ok(full.startsWith(cleaned), hidden);
    assert.deepEqual(probeChecks(adopted!), [
      { expr: "total(1)", value: "1" },
      { expr: "total(2)", value: "99" },
    ], hidden);
  }
});

test("a check hidden in a comment or a fence is not revealed by dropping the trailer", () => {
  const hidden = [
    ["<!--", "- total(2) is 99", "-->"],
    ["```", "- total(2) is 99", "```"],
  ];
  for (const wrap of hidden) {
    const body = [PROBE_HEADER, PROBE_CHECK, ...wrap, "", PROBE_TRAILER].join("\n");
    assert.equal(cleanIssueText({ title: replayIssueTitle(PROBE_SEQ), body }).length, MAX_OBJECTIVE_CHARS);
    assert.equal(adoptIssueBody(ASKED, body, PROBE_SEQ), null);
  }
});

test("a fenced header and check are not adopted when the trailer fills the budget", () => {
  const body = ["```", PROBE_HEADER, "- total(2) is 99", "```", "", PROBE_TRAILER].join("\n");
  assert.equal(cleanIssueText({ title: replayIssueTitle(PROBE_SEQ), body }).length, MAX_OBJECTIVE_CHARS);
  assert.equal(probeChecks(["```", PROBE_HEADER, "- total(2) is 99", "```"].join("\n")), null);
  assert.equal(adoptIssueBody(ASKED, body, PROBE_SEQ), null);
});

test("a fix line in the preamble or the trailer is not removed to force an adoption", () => {
  const fix = `Fix: ${"ab".repeat(20)}`;
  for (const body of [
    [fix, PROBE_HEADER, PROBE_CHECK, "", PROBE_TRAILER].join("\n"),
    [PROBE_HEADER, PROBE_CHECK, fix, "", PROBE_TRAILER].join("\n"),
    [PROBE_HEADER, PROBE_CHECK, "", PROBE_TRAILER, fix].join("\n"),
  ]) {
    assert.equal(cleanIssueText({ title: replayIssueTitle(PROBE_SEQ), body }).length, MAX_OBJECTIVE_CHARS);
    assert.equal(adoptIssueBody(ASKED, body, PROBE_SEQ), null);
  }
});

test("a body just under the titled budget is adopted, and the seq picks that title", () => {
  const header = "add a characterization test for total in src/cart.ts: totals";
  const check = "- total(1) is 2";
  const title = replayIssueTitle(SEQ);
  const bodyLen = MAX_OBJECTIVE_CHARS - 1 - title.length - 2;
  const pad = "p".repeat(bodyLen - header.length - check.length - 2);
  const body = `${header}\n${pad}\n${check}`;
  assert.equal(body.length, bodyLen);
  const titled = cleanIssueText({ title, body });
  assert.equal(titled.length, MAX_OBJECTIVE_CHARS - 1);
  assert.equal(totalValue(titled), "2");
  assert.equal(adoptIssueBody(ASKED, body, SEQ), body);
  const longer = 10;
  assert.equal(replayIssueTitle(longer).length, title.length + 1);
  assert.equal(cleanIssueText({ title: replayIssueTitle(longer), body }).length, MAX_OBJECTIVE_CHARS);
  assert.equal(adoptIssueBody(ASKED, body, longer), null);
});
