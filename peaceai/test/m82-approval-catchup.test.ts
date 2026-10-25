// M82: the scheduled approval catch-up. A late "Approve and run" on an approval PR's held pull_request runs used to
// strand the PR (results-land gives up after its waits). approval-catchup re-verifies such a PR from scratch and
// squash-merges it at the exact head; every existing guard is re-checked, and nothing else changes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { approvalMessage, BOT_EMAIL, BOT_LOGIN, CATCHUP_MIN_AGE_MS, CATCHUP_REQUIRED_CHECKS, catchupDecision, type CatchupInput } from "../lib/approval.ts";
import { withEntry, type ApprovalEntry, type ApprovedList } from "../lib/approved.ts";
import { specHash } from "../lib/learned.ts";
import { PROTECTED_SELF, protectedReason } from "../lib/selfchange.ts";

const repo = resolve(import.meta.dirname, "../..");
const read = (p: string) => readFileSync(join(repo, p), "utf8");
const REPO = "PeaceG03/PeaceAI-Workspace";
const ID = "public-test-case-existing-v1";
const SPEC = JSON.parse(read(`peaceai/rules/learned/${ID}.json`));
const SHA = specHash(SPEC);
const LIVE: ApprovedList = JSON.parse(read("peaceai/rules/approved.json"));
const MAIN: ApprovedList = { schema: LIVE.schema, rules: LIVE.rules.filter((r) => r.id !== ID) };
const COMMENT_ID = 6239191449;
const URL = `https://github.com/${REPO}/issues/362#issuecomment-${COMMENT_ID}`;
const ENTRY: ApprovalEntry = { id: ID, sha256: SHA, source: "workspace", approval: { url: URL, commentId: COMMENT_ID, issue: 362, repo: REPO, author: "PeaceG03", approvedAt: "2026-10-17T19:05:38Z" } };
const text = (l: ApprovedList) => JSON.stringify(l, null, 2) + "\n";
const HEAD = "a".repeat(40);
const PARENT = "b".repeat(40);
const BRANCH = "peaceai-approve-rule/b9e5b91458d4-9c8f82";
const NOW = Date.parse("2026-10-17T21:00:00Z");
const MARKER = `<!-- peaceai-rule-proposal:v1 id=${ID} sha256=${SHA} source=public -->`;

function input(over: Partial<CatchupInput> = {}): CatchupInput {
  return {
    repo: REPO, now: NOW,
    pr: { number: 367, user: BOT_LOGIN, headRef: BRANCH, headRepo: REPO, baseRef: "main", draft: false, createdAt: "2026-10-17T19:06:22Z", headSha: HEAD },
    commits: [{ sha: HEAD, parents: [PARENT], authorName: BOT_LOGIN, authorEmail: BOT_EMAIL, committerEmail: BOT_EMAIL, message: approvalMessage([ENTRY]) }],
    files: ["peaceai/rules/approved.json"], aheadBy: 1,
    mainListText: text(MAIN), parentListText: text(MAIN), headListText: text(withEntry(MAIN, ENTRY)),
    approval: (id) => (id === COMMENT_ID ? {
      comment: { id, body: `/approve-rule ${SHA}`, user: "PeaceG03", association: "OWNER", url: URL, createdAt: "2026-10-17T19:05:38Z", issue: 362 },
      issue: { number: 362, labels: ["rule-proposal"], body: `${MARKER}\n## proposal`, isPull: false },
    } : null),
    spec: (id) => (id === ID ? SPEC : null),
    checkRuns: CATCHUP_REQUIRED_CHECKS.map((name, i) => ({ id: 10 + i, name, status: "completed", conclusion: "success" })),
    prRuns: [{ id: 1, event: "pull_request", headSha: HEAD, headBranch: BRANCH, status: "completed", conclusion: "success" }, { id: 2, event: "pull_request", headSha: HEAD, headBranch: BRANCH, status: "completed", conclusion: "skipped" }],
    ...over,
  };
}
const reasonOf = (x: CatchupInput) => { const d = catchupDecision(x); return d.action === "merge" ? "merge" : `${d.action}:${d.reason}`; };

test("approvalMessage is what approve-rule.ts wrote for #367 (the catch-up compares against it byte for byte)", () => {
  const live = LIVE.rules.find((r) => r.id === ID)!;
  assert.equal(approvalMessage([live]), `approve learned rule: ${ID}\n\nRule: ${ID}\nSHA-256: ${SHA}\nApproval: ${live.approval.url}\nApproval-Author: PeaceG03\n\nWritten by the peace-approve-rule workflow from the approval comment(s) above.`);
  assert.match(read("peaceai/bin/approve-rule.ts"), /const msg = approvalMessage\(added\);/);
});

test("a late-approved, green, re-verified approval PR is merged at its exact head with the landing job's subject and body", () => {
  const d = catchupDecision(input());
  assert.equal(d.action, "merge");
  if (d.action !== "merge") return;
  assert.equal(d.sha, HEAD);
  assert.equal(d.subject, `approve learned rule: ${ID} (#367)`);
  assert.equal(d.body, `Rule: ${ID}\nSHA-256: ${SHA}\nApproval: ${URL}\nApproval-Author: PeaceG03\n\nWritten by the peace-approve-rule workflow from the approval comment(s) above.`);
  assert.deepEqual(d.entry, ENTRY);
  // A trailing newline in the stored commit message is fine (git strips it); a re-pin of an existing id too.
  assert.equal(reasonOf(input({ commits: [{ ...input().commits[0]!, message: approvalMessage([ENTRY]) + "\n" }] })), "merge");
});

test("waits (never refuses) while the landing job may still run, checks are pending, or runs are still held", () => {
  assert.equal(reasonOf(input({ now: Date.parse("2026-10-17T19:06:22Z") + CATCHUP_MIN_AGE_MS - 1 })), "wait:TOO_YOUNG");
  assert.equal(reasonOf(input({ checkRuns: input().checkRuns.filter((k) => k.name !== "tests") })), "wait:CHECKS_PENDING");
  assert.equal(reasonOf(input({ checkRuns: input().checkRuns.map((k) => (k.name === "tamper-proof" ? { ...k, status: "in_progress", conclusion: null } : k)) })), "wait:CHECKS_PENDING");
  assert.equal(reasonOf(input({ prRuns: [...input().prRuns, { id: 3, event: "pull_request", headSha: HEAD, headBranch: BRANCH, status: "completed", conclusion: "action_required" }] })), "wait:HELD_RUNS");
  assert.equal(reasonOf(input({ prRuns: [...input().prRuns, { id: 3, event: "pull_request", headSha: HEAD, headBranch: BRANCH, status: "queued", conclusion: null }] })), "wait:HELD_RUNS");
});

test("refuses anything the bot did not open from its own approval branch", () => {
  const pr = input().pr;
  assert.equal(reasonOf(input({ pr: { ...pr, user: "PeaceG03" } })), "refuse:NOT_APPROVAL_PR");
  assert.equal(reasonOf(input({ pr: { ...pr, headRef: "feature/x" } })), "refuse:NOT_APPROVAL_PR");
  assert.equal(reasonOf(input({ pr: { ...pr, headRef: "peaceai-approve-rule/evil" } })), "refuse:NOT_APPROVAL_PR");
  assert.equal(reasonOf(input({ pr: { ...pr, headRepo: "someone/fork" } })), "refuse:NOT_APPROVAL_PR");
  assert.equal(reasonOf(input({ pr: { ...pr, baseRef: "dev" } })), "refuse:NOT_APPROVAL_PR");
  assert.equal(reasonOf(input({ pr: { ...pr, draft: true } })), "refuse:NOT_APPROVAL_PR");
  assert.equal(reasonOf(input({ pr: { ...pr, createdAt: "yesterday" } })), "refuse:NOT_APPROVAL_PR");
});

test("keeps the one-commit, list-only, one-ahead and bot-author guards (no update-branch: a moved list is refused, not rebased)", () => {
  const c = input().commits[0]!;
  assert.equal(reasonOf(input({ commits: [c, { ...c, sha: "c".repeat(40) }] })), "refuse:NOT_ONE_COMMIT");
  assert.equal(reasonOf(input({ commits: [{ ...c, sha: "c".repeat(40) }] })), "refuse:NOT_ONE_COMMIT");
  assert.equal(reasonOf(input({ commits: [{ ...c, parents: [PARENT, "d".repeat(40)] }] })), "refuse:NOT_ONE_COMMIT");
  assert.equal(reasonOf(input({ commits: [{ ...c, authorEmail: "301894882+PeaceG03@users.noreply.github.com" }] })), "refuse:NOT_BOT_COMMIT");
  assert.equal(reasonOf(input({ commits: [{ ...c, committerEmail: "x@users.noreply.github.com" }] })), "refuse:NOT_BOT_COMMIT");
  assert.equal(reasonOf(input({ files: ["peaceai/rules/approved.json", "README.md"] })), "refuse:BRANCH");
  assert.equal(reasonOf(input({ files: ["README.md"] })), "refuse:BRANCH");
  assert.equal(reasonOf(input({ aheadBy: 2 })), "refuse:BRANCH");
  const moved = withEntry(MAIN, { ...ENTRY, id: "public-other-v1", approval: { ...ENTRY.approval, commentId: 1, url: `https://github.com/${REPO}/issues/1#issuecomment-1`, issue: 1 } });
  assert.equal(reasonOf(input({ mainListText: text(moved) })), "refuse:STALE_LIST");
  assert.equal(reasonOf(input({ mainListText: "{", parentListText: "{" })), "refuse:LIST_INVALID");
  assert.equal(reasonOf(input({ headListText: "{}" })), "refuse:LIST_INVALID");
});

test("re-verifies the single entry against Peace's /approve-rule, the proposal marker and the spec sha on main", () => {
  const one = (o: Partial<ReturnType<NonNullable<CatchupInput["approval"]>> & object> | null) => input({ approval: (id) => { const base = input().approval(id); return o === null ? null : base && { comment: { ...base.comment, ...(o.comment ?? {}) }, issue: { ...base.issue, ...(o.issue ?? {}) } }; } });
  assert.equal(reasonOf(one(null)), "refuse:COMMENT_MISSING");
  assert.equal(reasonOf(one({ comment: { user: "mallory" } } as never)), "refuse:WRONG_AUTHOR");
  assert.equal(reasonOf(one({ comment: { association: "COLLABORATOR" } } as never)), "refuse:NOT_OWNER");
  assert.equal(reasonOf(one({ comment: { body: `/approve-rule ${"f".repeat(64)}` } } as never)), "refuse:HASH_NOT_PROPOSAL");
  assert.equal(reasonOf(one({ comment: { body: "/approve-rule please" } } as never)), "refuse:BAD_COMMAND");
  assert.equal(reasonOf(one({ issue: { labels: [] } } as never)), "refuse:NOT_A_PROPOSAL");
  assert.equal(reasonOf(one({ issue: { isPull: true } } as never)), "refuse:COMMENT_MISSING");
  assert.equal(reasonOf(one({ comment: { issue: 999 } } as never)), "refuse:COMMENT_MISSING");
  // The spec on main changed after the approval: its sha no longer matches.
  assert.equal(reasonOf(input({ spec: () => ({ ...SPEC, trigger: SPEC.trigger + " " }) })), "refuse:SPEC_HASH_MISMATCH");
  assert.equal(reasonOf(input({ spec: () => null })), "refuse:SPEC_MISSING");
  // Already on main (e.g. a superseded duplicate PR after another landed).
  const landed = withEntry(MAIN, ENTRY);
  assert.equal(reasonOf(input({ mainListText: text(landed), parentListText: text(landed) })), "refuse:NOT_ONE_ENTRY");
  // The head list must be exactly what approve-rule.ts writes from that comment.
  assert.equal(reasonOf(input({ headListText: text(withEntry(MAIN, { ...ENTRY, approval: { ...ENTRY.approval, approvedAt: "2026-10-17T19:05:39Z" } })) })), "refuse:HEAD_LIST_MISMATCH");
  assert.equal(reasonOf(input({ headListText: JSON.stringify(withEntry(MAIN, ENTRY)) })), "refuse:HEAD_LIST_MISMATCH");
  const two = withEntry(withEntry(MAIN, ENTRY), { ...ENTRY, id: "public-other-v1", approval: { ...ENTRY.approval, commentId: 1, url: `https://github.com/${REPO}/issues/1#issuecomment-1`, issue: 1 } });
  assert.equal(reasonOf(input({ headListText: text(two) })), "refuse:NOT_ONE_ENTRY");
  const core = LIVE.rules.find((r) => r.source === "results")!;
  const coreHead: ApprovedList = { schema: MAIN.schema, rules: MAIN.rules.map((r) => (r.id === core.id ? { ...r, sha256: "e".repeat(64), attestation: { commit: r.attestation!.commit, path: `rules/approvals/${"e".repeat(64)}.json` } } : r)) };
  assert.equal(reasonOf(input({ headListText: text(coreHead) })), "refuse:NOT_WORKSPACE");
  assert.equal(reasonOf(input({ commits: [{ ...input().commits[0]!, message: approvalMessage([ENTRY]).replace("Approval-Author", "Approved-By") }] })), "refuse:MESSAGE_MISMATCH");
});

test("a failed required check or pull_request run is refused; the latest run of each required check decides", () => {
  assert.equal(reasonOf(input({ checkRuns: input().checkRuns.map((k) => (k.name === "leak-check" ? { ...k, conclusion: "failure" } : k)) })), "refuse:CHECK_FAILED");
  assert.equal(reasonOf(input({ checkRuns: [...input().checkRuns, { id: 99, name: "tests", status: "completed", conclusion: "failure" }] })), "refuse:CHECK_FAILED");
  assert.equal(reasonOf(input({ checkRuns: [{ id: 1, name: "tests", status: "completed", conclusion: "failure" }, ...input().checkRuns] })), "merge");
  assert.equal(reasonOf(input({ prRuns: [...input().prRuns, { id: 3, event: "pull_request", headSha: HEAD, headBranch: BRANCH, status: "completed", conclusion: "failure" }] })), "refuse:RUN_FAILED");
  assert.equal(reasonOf(input({ prRuns: [{ id: 3, event: "pull_request", headSha: "c".repeat(40), headBranch: BRANCH, status: "completed", conclusion: "failure" }] })), "merge");
});

// ---- the script, end to end against a stand-in gh

function fakeGh(dir: string, responses: Record<string, unknown>): string {
  const bin = join(dir, "gh");
  writeFileSync(join(dir, "responses.json"), JSON.stringify(responses));
  writeFileSync(bin, `#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(join(dir, "calls.log"))}, JSON.stringify(args) + "\\n");
const r = JSON.parse(fs.readFileSync(${JSON.stringify(join(dir, "responses.json"))}, "utf8"));
if (args[0] === "pr") process.exit(0);
const key = args.filter((a) => a !== "api" && a !== "-H" && !a.startsWith("Accept:")).join(" ");
if (!(key in r)) { process.stderr.write("no fixture " + key); process.exit(1); }
const v = r[key];
process.stdout.write(typeof v === "string" ? v : JSON.stringify(v));
`);
  chmodSync(bin, 0o755);
  return bin;
}
function responses(over: Record<string, unknown> = {}): Record<string, unknown> {
  const x = input();
  const L = "peaceai/rules/approved.json";
  return {
    [`repos/${REPO}/pulls?state=open&base=main&per_page=100`]: [
      { number: 360, user: { login: "PeaceG03" }, head: { ref: "m79/x", sha: "9".repeat(40), repo: { full_name: REPO } }, base: { ref: "main" }, created_at: "2026-10-17T10:00:00Z" },
      { number: 367, user: { login: BOT_LOGIN }, head: { ref: BRANCH, sha: HEAD, repo: { full_name: REPO } }, base: { ref: "main" }, draft: false, created_at: "2026-10-01T19:06:22Z" },
    ],
    [`repos/${REPO}/pulls/367/commits?per_page=100`]: [{ sha: HEAD, parents: [{ sha: PARENT }], commit: { author: { name: BOT_LOGIN, email: BOT_EMAIL }, committer: { email: BOT_EMAIL }, message: approvalMessage([ENTRY]) } }],
    [`repos/${REPO}/pulls/367/files?per_page=100`]: [{ filename: L }],
    [`repos/${REPO}/compare/main...${HEAD}`]: { ahead_by: 1 },
    [`repos/${REPO}/contents/${L}?ref=main`]: x.mainListText,
    [`repos/${REPO}/contents/${L}?ref=${PARENT}`]: x.parentListText,
    [`repos/${REPO}/contents/${L}?ref=${HEAD}`]: x.headListText,
    [`repos/${REPO}/issues/comments/${COMMENT_ID}`]: { id: COMMENT_ID, body: `/approve-rule ${SHA}`, user: { login: "PeaceG03" }, author_association: "OWNER", html_url: URL, created_at: "2026-10-17T19:05:38Z", issue_url: `https://api.github.com/repos/${REPO}/issues/362` },
    [`repos/${REPO}/issues/362`]: { number: 362, labels: [{ name: "rule-proposal" }], body: `${MARKER}\n## proposal` },
    [`repos/${REPO}/commits/${HEAD}/check-runs?per_page=100`]: { check_runs: x.checkRuns },
    [`repos/${REPO}/actions/runs?head_sha=${HEAD}&event=pull_request&per_page=100`]: { workflow_runs: x.prRuns.map((k) => ({ id: k.id, event: k.event, head_sha: k.headSha, head_branch: k.headBranch, status: k.status, conclusion: k.conclusion })) },
    ...over,
  };
}
function runScript(r: Record<string, unknown>): { status: number | null; out: string; calls: string[][] } {
  const dir = mkdtempSync(join(tmpdir(), "m82-"));
  try {
    const gh = fakeGh(dir, r);
    const tsx = join(repo, "node_modules/.bin/tsx");
    const p = spawnSync(tsx, [join(repo, "peaceai/bin/approve-rule-catchup.ts")], { cwd: repo, encoding: "utf8", env: { PATH: process.env.PATH ?? "", HOME: dir, GITHUB_REPOSITORY: REPO, GH_TOKEN: "x", PEACEAI_GH: gh } });
    const calls = existsSync(join(dir, "calls.log")) ? readFileSync(join(dir, "calls.log"), "utf8").trim().split("\n").map((l) => JSON.parse(l)) : [];
    return { status: p.status, out: p.stdout + p.stderr, calls };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

test("script: merges the stranded approval PR once, squash, at the exact head, and only reads otherwise", () => {
  const r = runScript(responses());
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /#367: merged public-test-case-existing-v1 at aaaaaaaaaaaa by the scheduled catch-up/);
  const merges = r.calls.filter((c) => c[0] === "pr" && c[1] === "merge");
  assert.deepEqual(merges, [["pr", "merge", "367", "--repo", REPO, "--squash", "--delete-branch", "--match-head-commit", HEAD, "--subject", `approve learned rule: ${ID} (#367)`, "--body", `Rule: ${ID}\nSHA-256: ${SHA}\nApproval: ${URL}\nApproval-Author: PeaceG03\n\nWritten by the peace-approve-rule workflow from the approval comment(s) above.`]]);
  assert.ok(r.calls.every((c) => c[0] === "api" || (c[0] === "pr" && (c[1] === "merge" || c[1] === "comment"))), "only reads, one merge, one comment");
  assert.ok(r.calls.every((c) => !c.includes("-X") && !c.includes("--method") && !(c[0] === "api" && c.some((a) => /update-branch|\/rerun|\/approve$|\/cancel|\/merge$/.test(a)))));
  assert.ok(!r.calls.some((c) => c.includes("repos/PeaceG03/PeaceAI-Workspace/pulls/360/commits?per_page=100")), "human PRs are never inspected");
});

test("script: a held or refused PR is left alone (no merge, no comment)", () => {
  const held = responses({ [`repos/${REPO}/actions/runs?head_sha=${HEAD}&event=pull_request&per_page=100`]: { workflow_runs: [{ id: 5, event: "pull_request", head_sha: HEAD, head_branch: BRANCH, status: "completed", conclusion: "action_required" }] } });
  const a = runScript(held);
  assert.equal(a.status, 0, a.out);
  assert.match(a.out, /#367: wait HELD_RUNS/);
  assert.ok(!a.calls.some((c) => c[0] === "pr"));
  const stale = responses({ [`repos/${REPO}/contents/peaceai/rules/approved.json?ref=main`]: text(withEntry(MAIN, ENTRY)) });
  const b = runScript(stale);
  assert.match(b.out, /#367: refuse STALE_LIST/);
  assert.ok(!b.calls.some((c) => c[0] === "pr"));
  const broken = responses({ [`repos/${REPO}/compare/main...${HEAD}`]: "not json" });
  const c = runScript(broken);
  assert.equal(c.status, 0);
  assert.match(c.out, /#367: error reading the PR state; not merged/);
  assert.ok(!c.calls.some((x) => x[0] === "pr"));
});

// ---- wiring and protection

test("workflow: approval-catchup runs on the schedule (or a non-push-proof dispatch) with no environment, secrets or push", () => {
  const wf = read(".github/workflows/peace-approve-rule.yml");
  const job = wf.slice(wf.indexOf("\n  approval-catchup:\n"));
  assert.ok(job.length > 50);
  assert.match(wf, /schedule:\n {4}- cron: "23 \* \* \* \*"/);
  assert.match(job, /github\.ref == 'refs\/heads\/main' &&\n\s+\(github\.event_name == 'schedule' \|\| \(github\.event_name == 'workflow_dispatch' && inputs\.push_proof != true\)\)/);
  assert.match(job, /permissions:\n {6}contents: write\n {6}pull-requests: write\n {6}issues: read\n {6}checks: read\n {6}actions: read\n/);
  assert.doesNotMatch(job, /environment:|secrets\.|actions: write|git push|update-branch|approve-rule-pr\.sh/);
  assert.match(job, /run: \.\/node_modules\/\.bin\/tsx peaceai\/bin\/approve-rule-catchup\.ts\n?$/);
  assert.match(job, /persist-credentials: false/);
  // results-land, the landing job, is unchanged: same timeout, same single lander script.
  assert.match(wf, /timeout-minutes: 60 {2}# #286/);
  assert.equal((wf.match(/approve-rule-pr\.sh/g) ?? []).length, 1);
});

test("script: one merge call, always squash + --match-head-commit; no push, branch update, run approval or list write", () => {
  const s = read("peaceai/bin/approve-rule-catchup.ts");
  const code = s.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
  assert.equal((code.match(/"pr", "merge"/g) ?? []).length, 1);
  assert.match(code, /gh\("pr", "merge", String\(n\), "--repo", repo, "--squash", "--delete-branch", "--match-head-commit", d\.sha, /);
  assert.doesNotMatch(code, /update-branch|"push"|writeFileSync|"-X"|"--method"|rerun|\/approve"|"cancel"|\/cancel/);
  assert.match(code, /break; \/\/ main's list just changed/);
});

test("protected: the catch-up script and its logic are inside the protected set, with PROTECTED_SELF unchanged", () => {
  for (const p of ["peaceai/bin/approve-rule-catchup.ts", "peaceai/lib/approval.ts", "peaceai/test/m82-approval-catchup.test.ts", ".github/workflows/peace-approve-rule.yml"]) assert.ok(protectedReason(p), p);
  const m12 = read("peaceai/test/m12-test-rule.test.ts");
  assert.equal(createHash("sha256").update(PROTECTED_SELF.map((x) => `/${x.pattern.source}/${x.pattern.flags}`).join("\n")).digest("hex"), /const PROTECTED_DIGEST = "([0-9a-f]{64})"/.exec(m12)![1]);
});
