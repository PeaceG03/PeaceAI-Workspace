import assert from "node:assert/strict";
import test from "node:test";

import { parseTerms, scanText } from "../lib/leak.ts";
import { checkPullRequestScope, mayChangeProtected } from "../lib/scope.ts";

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
