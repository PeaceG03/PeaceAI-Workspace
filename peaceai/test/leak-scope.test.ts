import assert from "node:assert/strict";
import test from "node:test";

import { parseTerms, scanText } from "../lib/leak.ts";
import { checkPullRequestScope, mayChangeProtected, approvalExemptionProblem } from "../lib/scope.ts";
import { branchProblem } from "../lib/approval.ts";

// Fixtures are assembled at runtime so this file itself passes the tree scan.
const at = "@";
const kinds = (text: string, terms: string[] = []) => scanText(text, terms).map((f) => f.kind);

test("emails: personal flagged, noreply and example allowed", () => {
  assert.deepEqual(kinds(`contact jane.doe${at}gmail.com`), ["email"]);
  assert.deepEqual(kinds(`123+someone${at}users.noreply.github.com`), []);
  assert.deepEqual(kinds(`user${at}example.com`), []);
  assert.deepEqual(kinds(`git${at}github.com:Owner/Repo.git`), []);
});

test("phone numbers", () => {
  assert.deepEqual(kinds(["call (303)", "555-0142"].join(" ")), ["phone-number"]);
  assert.deepEqual(kinds(["+1", ["720", "555", "0199"].join(".")].join(" ")), ["phone-number"]);
  assert.deepEqual(kinds(["+44", "20", "7946", "0958"].join(" ")), ["phone-number"]);
  assert.deepEqual(kinds("version 1.2.3 and sha 4f9c2a1 and 2026-10-09"), []);
});

test("home paths", () => {
  assert.deepEqual(kinds(["", "Users", "someone", "code"].join("/")), ["home-path"]);
  assert.deepEqual(kinds(["", "home", "someone", "x"].join("/")), ["home-path"]);
  assert.deepEqual(kinds(["C:", "Users", "someone", "x"].join("\\")), ["home-path"]);
  assert.deepEqual(kinds(["", "home", "runner", "work"].join("/")), []);
});

test("keys and tokens", () => {
  assert.deepEqual(kinds(["-----BEGIN OPENSSH", "PRIVATE KEY-----"].join(" ")), ["private-key"]);
  assert.deepEqual(kinds("ghp_" + "a".repeat(36)), ["github-token"]);
  assert.deepEqual(kinds("github_pat_" + "B".repeat(60)), ["github-token"]);
  assert.deepEqual(kinds("AKIA" + "ABCDEFGHIJKLMNOP"), ["aws-key"]);
  assert.deepEqual(kinds("xoxb-" + "1234567890-abc"), ["slack-token"]);
});

test("optional private terms come only from runtime input", () => {
  const terms = parseTerms("alpha-term\nBeta Term, x");
  assert.deepEqual(terms, ["alpha-term", "Beta Term"]);
  assert.deepEqual(kinds("mentions beta term here", terms), ["private-term"]);
  assert.deepEqual(kinds("nothing here", terms), []);
});

const owner = "PeaceG03";
const ownerPr = { author: owner, headRepo: "PeaceG03/PeaceAI-Workspace", baseRepo: "PeaceG03/PeaceAI-Workspace", headRef: "feature" };

test("PR scope: owner PRs may change protected files; bot, fork and other PRs may not", () => {
  const changes = [
    { status: "M", path: ".github/workflows/peace-task.yml" },
    { status: "M", path: "package.json" },
    { status: "M", path: "src/text.test.ts" },
    { status: "D", path: "src/text.ts" },
  ];
  assert.deepEqual(checkPullRequestScope(changes, ownerPr, owner), []);
  assert.equal(mayChangeProtected({ ...ownerPr, headRef: "peace-task/issue-1" }, owner), false);
  assert.equal(mayChangeProtected({ ...ownerPr, headRepo: "fork/PeaceAI-Workspace" }, owner), false);
  assert.equal(mayChangeProtected({ ...ownerPr, author: "github-actions[bot]" }, owner), false);
  assert.equal(mayChangeProtected(null, owner), false);
  const bot = { ...ownerPr, author: "github-actions[bot]", headRef: "peace-task/issue-1" };
  assert.equal(checkPullRequestScope(changes, bot, owner).length, 4);
  assert.deepEqual(checkPullRequestScope([{ status: "A", path: "src/text.new.test.ts" }, { status: "M", path: "src/text.ts" }], bot, owner), []);
});

// ---- M8 approval landing: the approved-list exemption (Auditor's conditions)

test("approved-list exemption: only a same-repo peaceai-approve-rule/ branch, one commit, only the list, list check passing", () => {
  const repoName = "PeaceG03/PeaceAI-Workspace";
  const list = "peaceai/rules/approved.json";
  const changes = [{ status: "M", path: list }];
  const pr = { author: "github-actions[bot]", headRepo: repoName, baseRepo: repoName, headRef: "peaceai-approve-rule/abc123abc123-a1b2c3" };
  const facts = { ahead: 1, files: [list], listCheckPassed: true, repository: repoName };
  assert.equal(approvalExemptionProblem(changes, pr, facts), null);
  assert.deepEqual(checkPullRequestScope(changes, pr, "PeaceG03", facts), []);
  const refused = (c: typeof changes, p: typeof pr | null, f: typeof facts | null, why: RegExp) => {
    assert.match(approvalExemptionProblem(c, p, f) ?? "", why);
    assert.deepEqual(checkPullRequestScope(c, p, "PeaceG03", f).map((v) => v.path), c.filter((x) => x.path === list || x.path.startsWith(".github/") || x.path.startsWith("peaceai/")).map((x) => x.path));
  };
  // A fork using the very same branch name.
  refused(changes, { ...pr, headRepo: "attacker/PeaceAI-Workspace" }, facts, /fork/);
  refused(changes, { ...pr, baseRepo: "attacker/PeaceAI-Workspace" }, facts, /fork/);
  refused(changes, pr, { ...facts, repository: "" }, /fork/);
  // Wrong branch prefix (including look-alikes).
  for (const headRef of ["main", "peace-task/issue-1", "peaceai-approve-rules/x", "x/peaceai-approve-rule/y", "Peaceai-approve-rule/x"])
    refused(changes, { ...pr, headRef }, facts, /not an approval branch/);
  // Not exactly one commit ahead.
  refused(changes, pr, { ...facts, ahead: 2 }, /exactly one commit/);
  refused(changes, pr, { ...facts, ahead: 0 }, /exactly one commit/);
  // Touches anything else, .github above all.
  refused([...changes, { status: "M", path: ".github/workflows/leak-check.yml" }], pr, { ...facts, files: [list, ".github/workflows/leak-check.yml"] }, /other than the approved list/);
  refused(changes, pr, { ...facts, files: [list, "src/config.ts"] }, /other than the approved list/);
  refused([{ status: "D", path: list }], pr, facts, /only modify/);
  refused([{ status: "A", path: list }], pr, facts, /only modify/);
  // check-approved-list failed.
  refused(changes, pr, { ...facts, listCheckPassed: false }, /check-approved-list/);
  // No PR context or no facts: no exemption.
  refused(changes, null, facts, /no pull request context/);
  refused(changes, pr, null, /no pull request context/);
  // The exemption covers the list only: another protected path on an approval branch is still a violation.
  assert.deepEqual(checkPullRequestScope([...changes, { status: "M", path: ".github/CODEOWNERS" }], pr, "PeaceG03", facts).map((v) => v.path), [list, ".github/CODEOWNERS"]);
});

test("tamper-proof's branch rule: an approval branch touching anything besides the list (above all .github/) fails", () => {
  const list = "peaceai/rules/approved.json";
  const b = "peaceai-approve-rule/abc123abc123-a1b2c3";
  assert.equal(branchProblem(b, [list], 1), null);
  for (const extra of [".github/workflows/peace-approve-rule.yml", ".github/CODEOWNERS", "peaceai/bin/approve-rule-pr.sh", "peaceai/lib/scope.ts", "src/config.ts"])
    assert.match(branchProblem(b, [list, extra], 1) ?? "", /other than the approved list/, extra);
  assert.match(branchProblem(b, [".github/workflows/ci.yml"], 1) ?? "", /other than the approved list/);
  assert.match(branchProblem(b, [list], 2) ?? "", /exactly one commit/);
  assert.match(branchProblem("feature/x", [list], 1) ?? "", /outside the approval workflow/);
});
