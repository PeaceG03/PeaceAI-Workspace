// M8 hardening (Auditor PASS note): the Results sync never pushes to main; approval PRs change only the
// approved list and only with entries that match a Results attestation (re-verified against a fresh
// Results clone, fail closed); CI rejects core-sourced entries without a valid attestation reference and
// any branch diff that touches other files (or touches the list outside an approval branch).
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { attestationFor, attestationProblem, branchProblem, verifySyncChange, type AttestationRecord, type CommentEvent } from "../lib/approval.ts";
import { APPROVED_SCHEMA, validateList, type ApprovalEntry } from "../lib/approved.ts";
import { RULE_SCHEMA, specHash, TRIGGERS, type RuleSpec } from "../lib/learned.ts";
import { proposalBody } from "../lib/propose.ts";

const repo = resolve(import.meta.dirname, "..", "..");
const tsx = join(repo, "node_modules/.bin/tsx");
const scratch = () => mkdtempSync(join(tmpdir(), "m8h-"));
const git = (cwd: string, ...a: string[]) => execFileSync("git", a, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const commit = (cwd: string, msg: string) => { git(cwd, "add", "-A"); git(cwd, "-c", "user.name=t", "-c", "user.email=t@example.com", "commit", "-qm", msg); };

const CORE: RuleSpec = {
  schema: RULE_SCHEMA, id: "core-set-literal-v1", kind: "SET_LITERAL", minedFrom: "core", minerVersion: "peaceai-miner:v1", shape: "LITERAL_CHANGE",
  trigger: TRIGGERS.SET_LITERAL, params: { contexts: ["object-property", "top-level-const"], kinds: ["number", "string"] },
  evidence: { hunks: 68, commits: 41, files: 35, repos: ["PeaceG03/PeaceAI"] },
};
const SHA = specHash(CORE);
const URL = "https://github.com/PeaceG03/PeaceAI-Results/issues/1#issuecomment-555";
const proposal = { spec: CORE, sha256: SHA, stats: { shape: "LITERAL_CHANGE" as never, covered: null, hunks: 68, commits: 41, files: 35, examples: [], styles: {} } };
const ev: CommentEvent = { repo: "PeaceG03/PeaceAI-Results", body: `/approve-rule ${SHA}`, author: "PeaceG03", association: "OWNER", commentId: 555, url: URL, createdAt: "2026-10-10T23:00:00Z", issue: 1, labels: ["rule-proposal"], issueBody: proposalBody(proposal, [], ["x"]) };
const ATT = (attestationFor(ev) as unknown as { attestation: Record<string, unknown> }).attestation;
const PUBLIC_ENTRY: ApprovalEntry = {
  id: "public-set-literal-v1", sha256: "a".repeat(64), source: "workspace",
  approval: { url: "https://github.com/PeaceG03/PeaceAI-Workspace/issues/45#issuecomment-9", commentId: 9, issue: 45, repo: "PeaceG03/PeaceAI-Workspace", author: "PeaceG03", approvedAt: "2026-10-10T22:00:00Z" },
};
const coreEntry = (commitSha: string, over: Partial<ApprovalEntry> = {}): ApprovalEntry => ({
  id: CORE.id, sha256: SHA, source: "results",
  approval: { url: URL, commentId: 555, issue: 1, repo: "PeaceG03/PeaceAI-Results", author: "PeaceG03", approvedAt: "2026-10-10T23:00:00Z" },
  attestation: { commit: commitSha, path: `rules/approvals/${SHA}.json` }, ...over,
});

// ---- 1. never pushes to main; only an approval-branch PR, checks, squash merge

function fakeGhForPr(dir: string): string {
  const bin = join(dir, "bin");
  mkdirSync(bin);
  writeFileSync(join(bin, "gh"), `#!/usr/bin/env bash
echo "$*" >> ${JSON.stringify(join(dir, "gh.log"))}
case "$1 $2" in
  "pr create") echo "https://github.com/PeaceG03/PeaceAI-Workspace/pull/77" ;;
  "pr view") echo "0123456789abcdef0123456789abcdef01234567" ;;
esac
exit 0
`);
  chmodSync(join(bin, "gh"), 0o755);
  return bin;
}

function prFixture() {
  const dir = scratch();
  const origin = join(dir, "origin.git");
  git(dir, "init", "-q", "--bare", "-b", "main", origin);
  const work = join(dir, "work");
  git(dir, "clone", "-q", origin, work);
  mkdirSync(join(work, "peaceai/rules"), { recursive: true });
  writeFileSync(join(work, "peaceai/rules/approved.json"), JSON.stringify({ schema: APPROVED_SCHEMA, rules: [] }));
  writeFileSync(join(work, "README.md"), "x\n");
  commit(work, "base");
  git(work, "push", "-q", "origin", "HEAD:main");
  const mainBefore = git(origin, "rev-parse", "main").trim();
  writeFileSync(join(dir, "msg.txt"), `approve learned rule: ${CORE.id}\n\nRule: ${CORE.id}\nApproval: ${URL}\n`);
  const run = () => spawnSync(join(repo, "peaceai/bin/approve-rule-pr.sh"), [join(dir, "msg.txt")], {
    cwd: work, encoding: "utf8",
    env: { ...process.env, PATH: `${fakeGhForPr(dir)}:${process.env.PATH}`, GH_TOKEN: "dummy", GITHUB_REPOSITORY: "PeaceG03/PeaceAI-Workspace", PEACEAI_CHECKS_SETTLE: "0", GITHUB_OUTPUT: join(dir, "out") },
  });
  return { dir, origin, work, mainBefore, run };
}

test("approve-rule-pr.sh: pushes only a peaceai-approve-rule/ branch changing only the list, then PR, required checks, squash merge", () => {
  const f = prFixture();
  try {
    writeFileSync(join(f.work, "peaceai/rules/approved.json"), JSON.stringify({ schema: APPROVED_SCHEMA, rules: [coreEntry("c".repeat(40))] }));
    const r = f.run();
    assert.equal(r.status, 0, r.stderr);
    assert.equal(git(f.origin, "rev-parse", "main").trim(), f.mainBefore, "main is never pushed");
    const branches = git(f.origin, "for-each-ref", "--format=%(refname:short)", "refs/heads").trim().split("\n").sort();
    assert.equal(branches.length, 2);
    const branch = branches.find((b) => b !== "main")!;
    assert.match(branch, /^peaceai-approve-rule\/[0-9a-f]{12}-[0-9a-f]{6}$/);
    assert.equal(git(f.origin, "diff", "--name-only", "main", branch).trim(), "peaceai/rules/approved.json");
    assert.equal(git(f.origin, "rev-list", "--count", `main..${branch}`).trim(), "1");
    assert.match(git(f.origin, "log", "-1", "--format=%an <%ae>%n%B", branch), /^github-actions\[bot\] <41898282\+github-actions\[bot\]@users\.noreply\.github\.com>\napprove learned rule: core-set-literal-v1[\s\S]*Approval: https:\/\/github\.com\/PeaceG03\/PeaceAI-Results\/issues\/1#issuecomment-555/);
    const calls = readFileSync(join(f.dir, "gh.log"), "utf8").trim().split("\n").filter((l) => /^(pr|workflow) /.test(l)).map((l) => l.split(" ").slice(0, 3).join(" "));
    assert.deepEqual(calls, ["pr create --repo", "workflow run leak-check.yml", "workflow run ci.yml", "pr checks 77", "pr merge 77", "pr view 77"]);
    assert.match(readFileSync(join(f.dir, "gh.log"), "utf8"), /pr checks 77 .*--required --watch/);
    assert.match(readFileSync(join(f.dir, "gh.log"), "utf8"), /pr merge 77 .*--squash/);
  } finally { rmSync(f.dir, { recursive: true, force: true }); }
});

test("approve-rule-pr.sh: refuses (pushes nothing) when any other file changed", () => {
  const f = prFixture();
  try {
    writeFileSync(join(f.work, "peaceai/rules/approved.json"), JSON.stringify({ schema: APPROVED_SCHEMA, rules: [] }) + " ");
    writeFileSync(join(f.work, "README.md"), "changed\n");
    const r = f.run();
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /only the approved list may change/);
    assert.deepEqual(git(f.origin, "for-each-ref", "--format=%(refname:short)", "refs/heads").trim().split("\n"), ["main"]);
  } finally { rmSync(f.dir, { recursive: true, force: true }); }
});

test("workflow: nothing pushes to main; the sync verifies core, then re-verifies against Results and fails closed before its PR", () => {
  const wf = readFileSync(join(repo, ".github/workflows/peace-approve-rule.yml"), "utf8");
  const pr = readFileSync(join(repo, "peaceai/bin/approve-rule-pr.sh"), "utf8");
  for (const text of [wf, pr]) assert.ok(!/HEAD:main|push[^\n]*(\borigin main\b|refs\/heads\/main)/.test(text), "no direct push to main");
  assert.equal(pr.split("\n").filter((l) => !l.startsWith("#") && /\bpush\b/.test(l)).length, 1, "one push, to the approval branch");
  assert.match(pr, /push -q origin "HEAD:refs\/heads\/\$branch"/);
  assert.match(pr, /case "\$branch" in peaceai-approve-rule\/\*\)/);
  const job = (name: string) => {
    const rest = wf.slice(wf.indexOf(`\n  ${name}:\n`) + 1);
    const next = rest.slice(1).search(/\n {2}[a-z][a-z-]*:\n/);
    return next === -1 ? rest : rest.slice(0, next + 1);
  };
  const verify = job("results-verify")!;
  const land = job("results-land")!;
  assert.match(verify, /environment: peaceai-core/);
  assert.match(verify, /permissions:\n {6}contents: read\n/);
  assert.ok(!/approve-rule-pr\.sh|contents: write/.test(verify), "the core-verifying job cannot land anything");
  assert.match(land, /environment: peaceai-results/);
  assert.match(land, /needs: results-verify/);
  const order = ["git clone --quiet --no-tags git@github.com:PeaceG03/PeaceAI-Results.git", "approve-rule.ts reverify", "rm -rf \"$RUNNER_TEMP/results\"", "steps.reverify.outputs.ok != 'true'", "approve-rule-pr.sh"];
  let at = -1;
  for (const s of order) { const i = land.indexOf(s); assert.ok(i > at, `${s} in order`); at = i; }
  assert.equal((wf.match(/approve-rule-pr\.sh/g) ?? []).length, 2, "only the Workspace-comment job and results-land land changes");
});

// ---- 2. only entries matching a Results attestation

const rec = (content: unknown, message = `approve\n\nApproval: ${URL}\n`, onMain = true): AttestationRecord => ({ content: typeof content === "string" ? content : JSON.stringify(content), message, onMain });

test("verifySyncChange: new entries must match the Results attestation field by field; workspace entries untouched", () => {
  const c = "c".repeat(40);
  const base = { rules: [PUBLIC_ENTRY] };
  const proposed = { rules: [coreEntry(c), PUBLIC_ENTRY] };
  const read = (r: AttestationRecord | null) => (commitSha: string, path: string) => (commitSha === c && path === `rules/approvals/${SHA}.json` ? r : null);
  const ok = verifySyncChange(base, proposed, read(rec(ATT)));
  assert.ok(ok.ok);
  assert.deepEqual(ok.ok && ok.added.map((e) => e.id), [CORE.id]);
  const why = (p: { rules: ApprovalEntry[] }, r: AttestationRecord | null, b: { rules: ApprovalEntry[] } = base) => { const x = verifySyncChange(b, p, read(r)); return x.ok ? "OK" : x.reason; };
  assert.equal(why(proposed, null), "ATTESTATION_MISSING");
  assert.equal(why(proposed, rec(ATT, undefined, false)), "ATTESTATION_NOT_ON_RESULTS_MAIN");
  assert.equal(why(proposed, rec({ ...ATT, commentId: 556 })), "ATTESTATION_MISMATCH");
  assert.equal(why(proposed, rec({ ...ATT, sha256: "b".repeat(64) })), "ATTESTATION_MISMATCH");
  assert.equal(why(proposed, rec("{not json")), "ATTESTATION_MISMATCH");
  assert.equal(why(proposed, rec(ATT, "no citation")), "ATTESTATION_NOT_CITED");
  assert.equal(why({ rules: [coreEntry(c)] }, rec(ATT)), "BASE_ENTRY_CHANGED", "a Workspace entry dropped");
  assert.equal(why({ rules: [coreEntry(c), { ...PUBLIC_ENTRY, sha256: "f".repeat(64) }] }, rec(ATT)), "BASE_ENTRY_CHANGED", "a Workspace entry altered");
  assert.equal(why({ rules: [PUBLIC_ENTRY, { ...PUBLIC_ENTRY, id: "public-other-v1" }] }, rec(ATT)), "NOT_A_RESULTS_ENTRY", "the sync cannot add Workspace entries");
  assert.equal(why(base, rec(ATT)), "OK", "no change is fine");
});

function resultsRepo(dir: string, message: string) {
  const origin = join(dir, "results.git");
  git(dir, "init", "-q", "--bare", "-b", "main", origin);
  const src = join(dir, "results-src");
  git(dir, "clone", "-q", origin, src);
  writeFileSync(join(src, "README.md"), "results\n");
  commit(src, "base");
  mkdirSync(join(src, "rules/approvals"), { recursive: true });
  writeFileSync(join(src, "rules/approvals", `${SHA}.json`), JSON.stringify(ATT, null, 2) + "\n");
  git(src, "add", "-A");
  git(src, "-c", "user.name=github-actions[bot]", "-c", "user.email=41898282+github-actions[bot]@users.noreply.github.com", "commit", "-qm", message);
  const attCommit = git(src, "rev-parse", "HEAD").trim();
  git(src, "push", "-q", "origin", "HEAD:main");
  // An attestation that never reached Results main.
  git(src, "checkout", "-q", "-b", "side");
  writeFileSync(join(src, "rules/approvals", `${SHA}.json`), JSON.stringify(ATT, null, 2) + "\n\n");
  commit(src, `side\n\nApproval: ${URL}`);
  const sideCommit = git(src, "rev-parse", "HEAD").trim();
  git(src, "push", "-q", "origin", "side");
  const fresh = join(dir, "results");
  git(dir, "clone", "-q", origin, fresh);
  git(fresh, "fetch", "-q", "origin", "side");
  return { fresh, attCommit, sideCommit };
}

test("approve-rule.ts reverify: re-reads attestations from a fresh Results clone; fails closed on any mismatch", () => {
  const dir = scratch();
  try {
    const { fresh, attCommit, sideCommit } = resultsRepo(dir, `approve learned rule ${CORE.id} (${SHA})\n\nApproval: ${URL}`);
    const base = join(dir, "approved.json");
    const run = (entry: ApprovalEntry) => {
      writeFileSync(base, JSON.stringify({ schema: APPROVED_SCHEMA, rules: [] }));
      writeFileSync(join(dir, "proposed.json"), JSON.stringify({ schema: APPROVED_SCHEMA, rules: [entry] }));
      writeFileSync(join(dir, "out"), "");
      const r = spawnSync(tsx, [join(repo, "peaceai/bin/approve-rule.ts"), "reverify"], { cwd: repo, encoding: "utf8", env: { ...process.env, PEACEAI_APPROVED_LIST_OUT: base, PEACEAI_PROPOSED_LIST: join(dir, "proposed.json"), PEACEAI_RESULTS_DIR: fresh, PEACEAI_MESSAGE_FILE: join(dir, "msg"), GITHUB_OUTPUT: join(dir, "out") } });
      assert.equal(r.status, 0, r.stderr);
      return { out: readFileSync(join(dir, "out"), "utf8"), list: readFileSync(base, "utf8") };
    };
    const good = run(coreEntry(attCommit));
    assert.match(good.out, /ok=true\nreason=ADDED\nchanged=true/);
    assert.ok(validateList(JSON.parse(good.list)));
    assert.match(readFileSync(join(dir, "msg"), "utf8"), new RegExp(`Attestation: PeaceG03/PeaceAI-Results@${attCommit}`));
    const side = run(coreEntry(sideCommit));
    assert.match(side.out, /ok=false\nreason=ATTESTATION_NOT_ON_RESULTS_MAIN\nchanged=false/);
    assert.equal(side.list, JSON.stringify({ schema: APPROVED_SCHEMA, rules: [] }), "list untouched on refusal");
    assert.match(run(coreEntry("e".repeat(40))).out, /reason=ATTESTATION_MISSING/);
    assert.match(run(coreEntry(attCommit, { approval: { ...coreEntry(attCommit).approval, approvedAt: "2026-10-11T00:00:00Z" } })).out, /reason=ATTESTATION_MISMATCH/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
  const dir2 = scratch();
  try {
    const { fresh, attCommit } = resultsRepo(dir2, "approve without citing the comment");
    writeFileSync(join(dir2, "approved.json"), JSON.stringify({ schema: APPROVED_SCHEMA, rules: [] }));
    writeFileSync(join(dir2, "proposed.json"), JSON.stringify({ schema: APPROVED_SCHEMA, rules: [coreEntry(attCommit)] }));
    spawnSync(tsx, [join(repo, "peaceai/bin/approve-rule.ts"), "reverify"], { cwd: repo, encoding: "utf8", env: { ...process.env, PEACEAI_APPROVED_LIST_OUT: join(dir2, "approved.json"), PEACEAI_PROPOSED_LIST: join(dir2, "proposed.json"), PEACEAI_RESULTS_DIR: fresh, GITHUB_OUTPUT: join(dir2, "out") } });
    assert.match(readFileSync(join(dir2, "out"), "utf8"), /ok=false\nreason=ATTESTATION_NOT_CITED/);
  } finally { rmSync(dir2, { recursive: true, force: true }); }
});

// ---- 3. CI: core-sourced entries need a valid attestation reference; branch diff checks

test("attestationProblem: every malformed reference on a core-sourced entry is named", () => {
  const c = "c".repeat(40);
  assert.equal(attestationProblem(coreEntry(c)), null);
  assert.equal(attestationProblem(PUBLIC_ENTRY), null);
  const { attestation: _drop, ...noAtt } = coreEntry(c);
  assert.equal(attestationProblem(noAtt), "no attestation reference");
  assert.equal(attestationProblem(coreEntry("c".repeat(39))), "attestation commit is not a full Results sha");
  assert.equal(attestationProblem(coreEntry("C".repeat(40))), "attestation commit is not a full Results sha");
  assert.equal(attestationProblem(coreEntry(c, { attestation: { commit: c, path: "rules/approvals/x.json" } })), "attestation path does not match the pinned hash");
  assert.equal(attestationProblem(coreEntry(c, { approval: { ...coreEntry(c).approval, commentId: 554 } })), "comment id missing or does not match the URL");
  assert.equal(attestationProblem(coreEntry(c, { approval: { ...coreEntry(c).approval, issue: 2 } })), "issue number missing or does not match the URL");
  assert.equal(attestationProblem(coreEntry(c, { approval: { ...coreEntry(c).approval, url: "https://github.com/PeaceG03/PeaceAI-Workspace/issues/1#issuecomment-555" } })), "approval URL is not a PeaceAI-Results issue comment");
  assert.equal(attestationProblem({ ...PUBLIC_ENTRY, id: "core-set-literal-v1" }), "core rule not approved through Results");
  assert.equal(attestationProblem(coreEntry(c, { id: "public-set-literal-v1" })), "Results entry for a non-core rule");
  assert.ok(!validateList({ schema: APPROVED_SCHEMA, rules: [coreEntry(c, { id: "public-set-literal-v1" })] }));
});

test("branchProblem: approval branches change only the list (one commit); other branches never touch it", () => {
  assert.equal(branchProblem("peaceai-approve-rule/abc", ["peaceai/rules/approved.json"], 1), null);
  assert.equal(branchProblem("peaceai-approve-rule/abc", ["peaceai/rules/approved.json", "README.md"], 1), "approval branch changes files other than the approved list");
  assert.equal(branchProblem("peaceai-approve-rule/abc", ["README.md"], 1), "approval branch changes files other than the approved list");
  assert.equal(branchProblem("peaceai-approve-rule/abc", ["peaceai/rules/approved.json"], 2), "approval branch must be exactly one commit ahead of main");
  assert.equal(branchProblem("feature", ["peaceai/rules/approved.json"], 1), "approved list changed outside the approval workflow");
  assert.equal(branchProblem("feature", ["src/a.ts"], 3), null);
});

function fakeGhCompare(dir: string, files: string[], aheadBy: number): string {
  const f = join(dir, "gh");
  writeFileSync(f, `#!/usr/bin/env node
const p = process.argv[3];
if (p.includes("/compare/main...")) process.stdout.write(JSON.stringify({ ahead_by: ${aheadBy}, files: ${JSON.stringify(files.map((filename) => ({ filename })))} }));
else process.exit(1);
`);
  chmodSync(f, 0o755);
  return f;
}

test("check-approved-list.ts: rejects a core entry without a valid attestation reference, and bad branch diffs", () => {
  const dir = scratch();
  try {
    const list = join(dir, "approved.json");
    const run = (branch: string, files: string[] = [], ahead = 1) => spawnSync(tsx, [join(repo, "peaceai/bin/check-approved-list.ts")], { cwd: repo, encoding: "utf8", env: { ...process.env, PEACEAI_APPROVED_LIST: list, GITHUB_HEAD_REF: "", GITHUB_REF_NAME: branch, GITHUB_REPOSITORY: "PeaceG03/PeaceAI-Workspace", PEACEAI_GH: fakeGhCompare(dir, files, ahead) } });
    writeFileSync(list, JSON.stringify({ schema: APPROVED_SCHEMA, rules: [coreEntry("c".repeat(40))] }));
    const ok = run("main");
    assert.equal(ok.status, 0, ok.stdout + ok.stderr);
    assert.match(ok.stdout, /APPROVED LIST NOTE core-set-literal-v1: Results approval/);
    writeFileSync(list, JSON.stringify({ schema: APPROVED_SCHEMA, rules: [coreEntry("c".repeat(12))] }));
    const bad = run("main");
    assert.equal(bad.status, 1);
    assert.match(bad.stdout, /APPROVED LIST FAIL core-set-literal-v1: attestation commit is not a full Results sha/);
    const { attestation: _a, ...noAtt } = coreEntry("c".repeat(40));
    writeFileSync(list, JSON.stringify({ schema: APPROVED_SCHEMA, rules: [noAtt] }));
    assert.match(run("main").stdout, /core-set-literal-v1: no attestation reference/);
    writeFileSync(list, JSON.stringify({ schema: APPROVED_SCHEMA, rules: [coreEntry("c".repeat(40))] }));
    assert.equal(run("peaceai-approve-rule/x", ["peaceai/rules/approved.json"]).status, 0);
    const extra = run("peaceai-approve-rule/x", ["peaceai/rules/approved.json", "peaceai/bin/generate.ts"]);
    assert.equal(extra.status, 1);
    assert.match(extra.stdout, /branch peaceai-approve-rule\/x: approval branch changes files other than the approved list/);
    const outside = run("some-feature", ["peaceai/rules/approved.json", "src/a.ts"], 2);
    assert.equal(outside.status, 1);
    assert.match(outside.stdout, /approved list changed outside the approval workflow/);
    assert.equal(run("some-feature", ["src/a.ts"], 2).status, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
