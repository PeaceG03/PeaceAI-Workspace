// M231: a replay may read the issue the log already cites, and it runs on the parent of the landing commit.
// EXPERIMENTAL. credit is false. The sentences are made up. No network.
import assert from "node:assert/strict";
import test from "node:test";
import { adoptIssueBody, citedIssue, landingParent } from "../lib/capabilityjob.ts";

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
  assert.equal(adoptIssueBody(ASKED, BODY), BODY);
  assert.equal(adoptIssueBody("add a characterization test for total in src/cart.ts", BODY), BODY);
});

test("a near-miss issue is not adopted", () => {
  const swap = (from: string, to: string) => BODY.replace(from, to);
  assert.equal(adoptIssueBody(ASKED, swap("src/cart.ts", "src/carts.ts")), null);
  assert.equal(adoptIssueBody(ASKED, swap("src/cart.ts", "src/./cart.ts")), null);
  assert.equal(adoptIssueBody(ASKED, swap("for total", "for totality")), null);
  assert.equal(adoptIssueBody(ASKED, swap("for total", "for Total")), null);
  assert.equal(adoptIssueBody("add a characterization test for other in src/cart.ts", BODY), null);
  assert.equal(adoptIssueBody(ASKED, "please import the milk from the test file"), null);
  assert.equal(adoptIssueBody(ASKED, "add a characterization test for total in src/cart.ts: totals"), null);
  assert.equal(adoptIssueBody(ASKED, `${BODY}\n- remember to import the milk`), null);
  assert.equal(adoptIssueBody(ASKED, `${BODY}\n- totality(1) is 2`), null);
  assert.equal(adoptIssueBody(ASKED, BODY.replace("- total(0) throws NOT_POSITIVE", "- other(0) throws NOT_POSITIVE")), null);
  assert.equal(adoptIssueBody(ASKED, `${BODY}\nFix: ${"ab".repeat(20)}`), null);
  assert.equal(adoptIssueBody(ASKED, `${BODY}\n- also edit src/secrets.ts`), null);
  assert.equal(adoptIssueBody("make env BUDGET_MS strict in src/gap.ts as integer 1..10", BODY), null);
  assert.equal(adoptIssueBody(ASKED, ""), null);
  assert.equal(adoptIssueBody(ASKED, `${"x".repeat(8001)}\n${BODY}`), null);
  const earlier = `add a characterization test for other in src/pay.ts: no\n- other(1) is 1\n${BODY}`;
  assert.equal(adoptIssueBody(ASKED, earlier), null);
});
