// M11: self-change sandbox guardrails.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import {
  AUDITOR_COMMAND, budgetMinutes, checkSelfChangeDiff, listSha, MAX_BUDGET_MINUTES, promotionDecision, PROMOTE_COMMAND,
  SANDBOX_USER, SELF_SCHEMA, selfChangeAllowedHere, type RunIdentity, type SelfChangeRecord,
} from "../lib/selfchange.ts";
import { proposeInSandbox } from "../lib/selfpropose.ts";

const repo = resolve(import.meta.dirname, "../..");
const tsx = join(repo, "node_modules/.bin/tsx");
const cli = join(repo, "peaceai/bin/self-change.ts");
const NOREPLY = ["-c", "user.name=PeaceG03", "-c", "user.email=301894882+PeaceG03@users.noreply.github.com"];
const git = (cwd: string, ...a: string[]) => execFileSync("git", a, { cwd, encoding: "utf8" }).trim();

const add = (path: string, lines: string[]) => `diff --git a/${path} b/${path}\nnew file mode 100644\nindex 0000000..1111111\n--- /dev/null\n+++ b/${path}\n@@ -0,0 +1,${lines.length} @@\n${lines.map((l) => `+${l}`).join("\n")}\n`;
const modify = (path: string, from: string, to: string) => `diff --git a/${path} b/${path}\nindex 1111111..2222222 100644\n--- a/${path}\n+++ b/${path}\n@@ -1 +1 @@\n-${from}\n+${to}\n`;

test("protected set: any self-change touching it is refused, by path (every rename/copy side) and by content", () => {
  const cases: [string, RegExp][] = [
    [modify(".github/workflows/ci.yml", "a", "b"), /protected|outside peaceai/],
    [modify("peaceai/rules/approved.json", "a", "b"), /learned-rule list/],
    [modify("peaceai/test/gate.test.ts", "a", "b"), /live test suite/],
    [add("peaceai/lib/x.test.ts", ["x"]), /existing tests anywhere/],
    [modify("peaceai/lib/leak.ts", "a", "b"), /gates, approvals/],
    [modify("peaceai/lib/selfchange.ts", "a", "b"), /self-change rules/],
    [modify("peaceai/bin/self-change.ts", "a", "b"), /self-change tools/],
    [modify("peaceai/bin/approve-rule-pr.sh", "a", "b"), /approval/],
    [modify("peaceai/self/approvers.json", "a", "b"), /self-change records/],
    [modify("peaceai/lib/lm.ts", "a", "b"), /memcheck/],
    [modify("package.json", "a", "b"), /outside peaceai/],
    [modify("src/text.ts", "a", "b"), /outside peaceai/],
    // Renames and copies: either side protected is refused (moving a gate away, or moving code onto a gate).
    ["diff --git a/peaceai/lib/leak.ts b/peaceai/lib/leak2.ts\nsimilarity index 100%\nrename from peaceai/lib/leak.ts\nrename to peaceai/lib/leak2.ts\n", /gates, approvals/],
    ["diff --git a/peaceai/lib/rank.ts b/peaceai/lib/scope.ts\nsimilarity index 90%\nrename from peaceai/lib/rank.ts\nrename to peaceai/lib/scope.ts\n", /gates, approvals/],
    ["diff --git a/peaceai/lib/rank.ts b/peaceai/lib/rank2.ts\nsimilarity index 100%\ncopy from peaceai/lib/rank.ts\ncopy to peaceai/lib/rank2.ts\n", /copies a file/],
    ["diff --git a/peaceai/lib/link.ts b/peaceai/lib/link.ts\nnew file mode 120000\nindex 0000000..1111111\n--- /dev/null\n+++ b/peaceai/lib/link.ts\n@@ -0,0 +1 @@\n+../../.github/workflows/ci.yml\n", /mode 120000/],
    ["diff --git a/peaceai/lib/rank.ts b/peaceai/lib/rank.ts\nold mode 100644\nnew mode 100755\n", /mode 100755/],
    ["diff --git a/peaceai/lib/rank.ts b/peaceai/lib/rank.ts\ndeleted file mode 100644\nindex 1111111..0000000\n--- a/peaceai/lib/rank.ts\n+++ /dev/null\n@@ -1 +0,0 @@\n-x\n", /deletes a file/],
    ["diff --git a/peaceai/lib/blob.ts b/peaceai/lib/blob.ts\nnew file mode 100644\nindex 0000000..1111111\nGIT binary patch\nliteral 3\nKcmZ?wbN~PV\n", /binary/],
    [add("peaceai/lib/../.github/x.ts", ["x"]), /plain relative path/],
    // Content: an allowed path whose added code reaches the protected set or a credential.
    [add("peaceai/lib/helper.ts", ['writeFileSync(".github/workflows/x.yml", "")']), /workflow directory/],
    [add("peaceai/lib/helper.ts", ['const p = "peaceai/rules/" + "approved.json";']), /approved-rule list/],
    [add("peaceai/lib/helper.ts", ["const t = process.env.GITHUB_TOKEN;"]), /credential/],
    [add("peaceai/lib/helper.ts", ['execFileSync("git", ["config", "core.hooksPath", "/dev/null"]);']), /git hooks/],
    [add("peaceai/lib/helper.ts", ["export const x = (isProtectedPath as any) = () => false;"]), /gate function/],
    [add("peaceai/lib/helper.ts", ['eval("1")']), /dynamic code/],
    [add("peaceai/lib/helper.ts", ["const c = process.env.PEACEAI_RANKER;"]), /runner variable/],
    ["", /not a git diff/],
  ];
  for (const [diff, why] of cases) {
    const r = checkSelfChangeDiff(diff);
    assert.equal(r.ok, false, diff);
    assert.ok(r.refusals.some((x) => why.test(x.reason)), `${diff}\n${JSON.stringify(r.refusals)}`);
  }
  const ok = checkSelfChangeDiff(add("peaceai/lib/textnorm.ts", ["export const trimEnd = (s: string) => s.replace(/\\s+$/, \"\");"]) + add("peaceai/self-tests/textnorm.test.ts", ['import test from "node:test";']));
  assert.deepEqual(ok, { ok: true, refusals: [], paths: ["peaceai/lib/textnorm.ts", "peaceai/self-tests/textnorm.test.ts"] });
});

test("the tool never sets the Auditor marker or posts the Architect command", () => {
  const src = readFileSync(cli, "utf8") + readFileSync(join(repo, "peaceai/lib/selfchange.ts"), "utf8") + readFileSync(join(repo, "peaceai/lib/selfpropose.ts"), "utf8");
  assert.doesNotMatch(src, /--add-label|issues\/[^"`]*\/labels"|gh", \["(pr|issue)", "(comment|edit)"|-X", "POST"|--method/);
  assert.doesNotMatch(src, /"api", "-X"|"api", "--method"/);
});

/** Fixture HOME paths, built at runtime (no literal user paths in the repo). */
const homeOf = (u: string) => ["", u === "root" ? "" : "home", u].filter((x, i) => i === 0 || x).join("/");

test("propose runs only as the sandbox user on the box or in an ephemeral private Actions job, within a minute budget", () => {
  const cand: RunIdentity = { user: SANDBOX_USER, uid: 1501, home: homeOf("peaceai-cand"), homeEntries: [] };
  const clean = { HOME: homeOf("peaceai-cand"), PATH: "/usr/bin" };
  assert.deepEqual(selfChangeAllowedHere(clean, cand), { ok: true });
  // The invoking (Builder's) user, root, or the sandbox name reached via sudo from itself: refused.
  assert.equal(selfChangeAllowedHere({ HOME: homeOf("box") }, { user: "box", uid: 1000, home: homeOf("box"), homeEntries: [] }).reason, "RUN_AS_SANDBOX_USER");
  assert.equal(selfChangeAllowedHere({}, { user: "root", uid: 0, home: homeOf("root"), homeEntries: [] }).reason, "RUN_AS_SANDBOX_USER");
  assert.equal(selfChangeAllowedHere({ ...clean, SUDO_USER: SANDBOX_USER }, cand).reason, "RUN_AS_SANDBOX_USER");
  // Builder's HOME or credentials reachable: refused.
  assert.equal(selfChangeAllowedHere({ ...clean, HOME: homeOf("box") }, cand).reason, "HOME_NOT_SANDBOX");
  for (const e of [".ssh", ".gitconfig", ".git-credentials", ".config", ".netrc"]) assert.equal(selfChangeAllowedHere(clean, { ...cand, homeEntries: [e] }).reason, "HOME_HAS_CREDENTIALS", e);
  for (const k of ["GH_TOKEN", "GITHUB_TOKEN", "SSH_AUTH_SOCK", "GIT_ASKPASS", "PEACEAI_CORE_DEPLOY_KEY", "GIT_CONFIG_GLOBAL"]) assert.equal(selfChangeAllowedHere({ ...clean, [k]: "x" }, cand).reason, "CREDENTIALS_IN_ENV", k);
  // Actions: only private allowlisted repos, manual or proposal-triggered, on an ephemeral GitHub-hosted runner, no credentials in env.
  const act = { GITHUB_ACTIONS: "true", GITHUB_REPOSITORY: "PeaceG03/PeaceAI-Results", GITHUB_EVENT_NAME: "workflow_dispatch", RUNNER_ENVIRONMENT: "github-hosted" };
  const runner: RunIdentity = { user: "runner", uid: 1001, home: homeOf("runner"), homeEntries: [] };
  assert.ok(selfChangeAllowedHere(act, runner).ok);
  assert.equal(selfChangeAllowedHere({ ...act, GITHUB_REPOSITORY: "PeaceG03/PeaceAI-Workspace" }, runner).reason, "PUBLIC_RUNNER_REFUSED");
  assert.equal(selfChangeAllowedHere({ ...act, GITHUB_EVENT_NAME: "schedule" }, runner).reason, "START_MANUALLY_OR_ON_PROPOSAL");
  assert.equal(selfChangeAllowedHere({ ...act, RUNNER_ENVIRONMENT: "self-hosted" }, runner).reason, "RUNNER_NOT_EPHEMERAL");
  assert.equal(selfChangeAllowedHere({ ...act, GITHUB_TOKEN: "x" }, runner).reason, "CREDENTIALS_IN_ENV");
  assert.equal(budgetMinutes("999"), MAX_BUDGET_MINUTES);
  assert.equal(budgetMinutes("-1"), 15);
  assert.equal(budgetMinutes("5"), 5);
});

test("the CLI refuses to propose as the invoking user (and on the public Workspace runners)", () => {
  const me = spawnSync(tsx, [cli, "propose", "--id", "sc-x", "--patch", "/dev/null"], { cwd: repo, encoding: "utf8", env: { ...process.env, GITHUB_ACTIONS: "" } });
  assert.equal(me.status, 3, me.stdout + me.stderr);
  assert.match(me.stdout, /self-change refused reason=(RUN_AS_SANDBOX_USER|HOME_|CREDENTIALS_IN_ENV)/);
  const pub = spawnSync(tsx, [cli, "propose", "--id", "sc-x", "--patch", "/dev/null"], { cwd: repo, encoding: "utf8", env: { ...process.env, GITHUB_ACTIONS: "true", GITHUB_REPOSITORY: "PeaceG03/PeaceAI-Workspace" } });
  assert.equal(pub.status, 3);
  assert.match(pub.stdout, /PUBLIC_RUNNER_REFUSED/);
  // No public Workspace workflow runs it (and so none on a timer).
  for (const f of readdirSync(join(repo, ".github/workflows"))) assert.doesNotMatch(readFileSync(join(repo, ".github/workflows", f), "utf8"), /self-change|selfchange|selfpropose/, f);
});

/** A tiny "live PeaceAI": one lib file and one live test. */
function liveFixture() {
  const dir = mkdtempSync(join(tmpdir(), "m11-live-"));
  mkdirSync(join(dir, "peaceai/lib"), { recursive: true });
  mkdirSync(join(dir, "peaceai/test"), { recursive: true });
  writeFileSync(join(dir, "peaceai/lib/double.ts"), "export const double = (n: number) => n * 2;\n");
  writeFileSync(join(dir, "peaceai/test/double.test.ts"), 'import assert from "node:assert/strict";\nimport test from "node:test";\nimport { double } from "../lib/double.ts";\ntest("double", () => assert.equal(double(21), 42));\n');
  writeFileSync(join(dir, ".gitignore"), "node_modules\n");
  git(dir, "init", "-q");
  git(dir, "add", "-A");
  git(dir, ...NOREPLY, "commit", "-qm", "base");
  symlinkSync(join(repo, "node_modules"), join(dir, "node_modules"), "dir");
  return dir;
}
// The proposal run itself (the CLI calls it only after the run-identity check). Source = a fresh clone of the fixture.
const propose = (live: string, id: string, diff: string, out: string) => {
  const r = proposeInSandbox({ id, diff, source: live, base: "HEAD", out, budget: "3", nodeModules: join(repo, "node_modules") });
  return { status: r.code, stdout: r.message + "\n", stderr: "" };
};

test("promotion evidence: the LIVE suite (base commit's test files) runs against the candidate in a separate copy", () => {
  const live = liveFixture();
  const out = mkdtempSync(join(tmpdir(), "m11-out-"));
  try {
    const head = git(live, "rev-parse", "HEAD");
    // A breaking change: the live test catches it.
    const bad = propose(live, "sc-bad", modify("peaceai/lib/double.ts", "export const double = (n: number) => n * 2;", "export const double = (n: number) => n * 3;"), out);
    assert.equal(bad.status, 3, bad.stdout + bad.stderr);
    assert.match(bad.stdout, /status=tested-failing .*live:pass=0,fail=1/);
    // A harmless change plus a new test: both suites pass; the record names the live suite by the base's files.
    const good = propose(live, "sc-good", modify("peaceai/lib/double.ts", "export const double = (n: number) => n * 2;", "export const double = (n: number) => n + n;") + add("peaceai/self-tests/double-more.test.ts", ['import assert from "node:assert/strict";', 'import test from "node:test";', 'import { double } from "../lib/double.ts";', 'test("double 0", () => assert.equal(double(0), 0));']), out);
    assert.equal(good.status, 0, good.stdout + good.stderr);
    assert.match(good.stdout, /status=awaiting-review .*live:pass=1,fail=0,exit=0 new:pass=1,fail=0,exit=0/);
    const rec = JSON.parse(readFileSync(join(out, "self-changes/sc-good.json"), "utf8")) as SelfChangeRecord;
    assert.equal(rec.liveSuite.filesSha256, listSha(["peaceai/test/double.test.ts"]));
    assert.deepEqual(rec.tests[0]!.files, ["peaceai/test/double.test.ts"]);
    assert.match(rec.candidateSha, /^[0-9a-f]{40}$/);
    // The exact tested commit is kept as a bundle, so the promotion PR head can be that commit.
    const verify = spawnSync("git", ["bundle", "list-heads", join(out, "self-changes/sc-good.bundle")], { encoding: "utf8" });
    assert.match(verify.stdout, new RegExp(rec.candidateSha));
    // A change that edits the live test to make itself pass is refused before anything runs.
    const cheat = propose(live, "sc-cheat", modify("peaceai/test/double.test.ts", "x", "y"), out);
    assert.equal(cheat.status, 2);
    assert.match(cheat.stdout, /live test suite/);
    assert.equal(JSON.parse(readFileSync(join(out, "self-changes/sc-cheat.json"), "utf8")).status, "refused");
    // The live checkout was never edited.
    assert.equal(git(live, "rev-parse", "HEAD"), head);
    assert.equal(git(live, "status", "--porcelain"), "");
    assert.equal(readFileSync(join(live, "peaceai/lib/double.ts"), "utf8"), "export const double = (n: number) => n * 2;\n");
  } finally { rmSync(live, { recursive: true, force: true }); rmSync(out, { recursive: true, force: true }); }
});

const record = (over: Partial<SelfChangeRecord> = {}): SelfChangeRecord => ({
  schema: SELF_SCHEMA, id: "sc-good", baseSha: "a".repeat(40), candidateSha: "b".repeat(40), diffSha256: "c".repeat(64),
  paths: ["peaceai/lib/double.ts"], check: { ok: true, refusals: [], paths: ["peaceai/lib/double.ts"] },
  liveSuite: { baseSha: "a".repeat(40), filesSha256: listSha(["peaceai/test/double.test.ts"]) },
  tests: [{ suite: "live", files: ["peaceai/test/double.test.ts"], filesSha256: listSha(["peaceai/test/double.test.ts"]), exitCode: 0, pass: 1, fail: 0 }],
  status: "awaiting-review", rollback: { kind: "revert", of: null, command: "x" }, createdAt: "2026-10-10T00:00:00Z", ...over,
});

test("promotion needs a traced /auditor-pass and a later traced /promote-self-change, both for the PR head = tested candidate", () => {
  const liveFiles = ["peaceai/test/double.test.ts"];
  const approvers = { auditor: ["PeaceG03"], architect: ["PeaceG03"] };
  const sha = "b".repeat(40), newSha = "e".repeat(40);
  const c = (id: number, body: string, createdAt: string, over: object = {}) => ({ id, url: `https://github.com/PeaceG03/PeaceAI-Workspace/pull/99#issuecomment-${id}`, body, author: "PeaceG03", association: "OWNER", createdAt, ...over });
  const pass = c(701, `${AUDITOR_COMMAND} sc-good ${sha}`, "2026-10-10T01:00:00Z");
  const promote = c(702, `${PROMOTE_COMMAND} sc-good ${sha}`, "2026-10-10T02:00:00Z");
  const d = (r: SelfChangeRecord, head: string, comments: any[], files = liveFiles) => promotionDecision(r, files, head, comments, approvers);
  assert.deepEqual(d(record(), sha, [pass, promote]), { ok: true, reasons: [], auditorComment: pass.url, architectComment: promote.url });
  assert.deepEqual(d(record(), sha, []).reasons, ["AUDITOR_PASS_MISSING", "ARCHITECT_APPROVAL_MISSING"]);
  assert.deepEqual(d(record(), sha, [pass]).reasons, ["ARCHITECT_APPROVAL_MISSING"]);
  assert.deepEqual(d(record(), sha, [promote]).reasons, ["AUDITOR_PASS_MISSING", "ARCHITECT_PROMOTE_STALE_OR_SHA_MISMATCH"]);
  // Stale after a re-push: the PR head moved (and a new proposal tested the new commit), the old pass/promote name the old SHA.
  assert.deepEqual(d(record({ candidateSha: newSha }), newSha, [pass, promote]).reasons, ["AUDITOR_PASS_STALE_OR_SHA_MISMATCH", "ARCHITECT_PROMOTE_STALE_OR_SHA_MISMATCH"]);
  // A re-push the proposal never tested: head != candidate.
  assert.ok(d(record(), newSha, [pass, promote]).reasons.includes("HEAD_NOT_TESTED_CANDIDATE"));
  // SHA mismatch between the two comments.
  assert.deepEqual(d(record(), sha, [pass, { ...promote, body: `${PROMOTE_COMMAND} sc-good ${newSha}` }]).reasons, ["ARCHITECT_PROMOTE_STALE_OR_SHA_MISMATCH"]);
  assert.deepEqual(d(record(), sha, [{ ...pass, body: `${AUDITOR_COMMAND} sc-good ${newSha}` }, promote]).reasons, ["AUDITOR_PASS_STALE_OR_SHA_MISMATCH", "ARCHITECT_PROMOTE_STALE_OR_SHA_MISMATCH"]);
  // Fresh pass and promote for the new head after a re-push: accepted.
  const pass2 = c(703, `${AUDITOR_COMMAND} sc-good ${newSha}`, "2026-10-10T03:00:00Z"), promote2 = c(704, `${PROMOTE_COMMAND} sc-good ${newSha}`, "2026-10-10T04:00:00Z");
  assert.ok(d(record({ candidateSha: newSha }), newSha, [pass, promote, pass2, promote2]).ok);
  // Promote before the pass, untraced comments, wrong people: refused. Labels are not an input at all.
  assert.deepEqual(d(record(), sha, [pass, { ...promote, createdAt: "2026-10-10T00:30:00Z" }]).reasons, ["ARCHITECT_PROMOTE_STALE_OR_SHA_MISMATCH"]);
  for (const bad of [{ id: undefined }, { url: undefined }, { url: "https://github.com/PeaceG03/PeaceAI-Workspace/pull/99#issuecomment-1" }, { url: "https://github.com/x/fork/pull/99#issuecomment-702" }, { author: "someone-else" }, { association: "NONE" }])
    assert.ok(!d(record(), sha, [pass, { ...promote, ...bad }]).ok, JSON.stringify(bad));
  assert.ok(!d(record(), sha, [{ ...pass, id: undefined }, promote]).ok);
  // Approvals never override failing or substituted live tests, or a protected path.
  assert.ok(d(record({ tests: [{ ...record().tests[0]!, exitCode: 1, fail: 1 }] }), sha, [pass, promote]).reasons.includes("LIVE_TESTS_FAILED"));
  assert.ok(d(record({ tests: [] }), sha, [pass, promote]).reasons.includes("LIVE_TESTS_NOT_RUN"));
  assert.ok(d(record(), sha, [pass, promote], ["peaceai/test/double.test.ts", "peaceai/test/other.test.ts"]).reasons.includes("LIVE_SUITE_MISMATCH"));
  assert.ok(d(record({ paths: ["peaceai/lib/leak.ts"] }), sha, [pass, promote]).reasons.includes("PROTECTED_SET"));
});

test("rollback is one step: a new branch that reverts the promotion and restores every touched path", () => {
  const dir = liveFixture();
  const out = mkdtempSync(join(tmpdir(), "m11-rb-"));
  try {
    const before = readFileSync(join(dir, "peaceai/lib/double.ts"), "utf8");
    writeFileSync(join(dir, "peaceai/lib/double.ts"), "export const double = (n: number) => n + n;\n");
    writeFileSync(join(dir, "peaceai/lib/extra.ts"), "export const x = 1;\n");
    git(dir, "add", "-A");
    git(dir, ...NOREPLY, "commit", "-qm", "promote sc-good");
    const merge = git(dir, "rev-parse", "HEAD");
    const promoted = record({ status: "promoted", paths: ["peaceai/lib/double.ts", "peaceai/lib/extra.ts"], promotion: { decision: { ok: true, reasons: [] }, mergeSha: merge } });
    writeFileSync(join(out, "r.json"), JSON.stringify(promoted));
    // (A fixture repo only; the env marks this as off Actions, as on the box.)
    const boxEnv = { ...process.env, GITHUB_ACTIONS: "" };
    const r = spawnSync(tsx, [cli, "rollback", "--record", join(out, "r.json"), "--repo", dir], { cwd: repo, encoding: "utf8", env: boxEnv });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, new RegExp(`branch=peaceai-self-rollback/sc-good reverts=${merge.slice(0, 12)}`));
    assert.equal(readFileSync(join(dir, "peaceai/lib/double.ts"), "utf8"), before);
    assert.equal(existsSync(join(dir, "peaceai/lib/extra.ts")), false);
    assert.equal(git(dir, "rev-parse", "--abbrev-ref", "HEAD"), "peaceai-self-rollback/sc-good");
    // Not promoted: nothing to roll back.
    writeFileSync(join(out, "n.json"), JSON.stringify(record()));
    const n = spawnSync(tsx, [cli, "rollback", "--record", join(out, "n.json"), "--repo", dir], { cwd: repo, encoding: "utf8", env: boxEnv });
    assert.equal(n.status, 2);
    assert.match(n.stdout, /NOT_PROMOTED/);
  } finally { rmSync(dir, { recursive: true, force: true }); rmSync(out, { recursive: true, force: true }); }
});
