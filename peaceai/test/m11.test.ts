// M11: self-change sandbox guardrails.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import {
  AUDITOR_LABEL, budgetMinutes, checkSelfChangeDiff, listSha, MAX_BUDGET_MINUTES, promotionDecision, PROMOTE_COMMAND,
  SELF_SCHEMA, selfChangeAllowedHere, type SelfChangeRecord,
} from "../lib/selfchange.ts";

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

test("self-change runs only on this box or a private repo's manual/proposal job, within a minute budget", () => {
  assert.deepEqual(selfChangeAllowedHere({}), { ok: true });
  assert.equal(selfChangeAllowedHere({ GITHUB_ACTIONS: "true", GITHUB_REPOSITORY: "PeaceG03/PeaceAI-Workspace", GITHUB_EVENT_NAME: "workflow_dispatch" }).reason, "PUBLIC_RUNNER_REFUSED");
  assert.equal(selfChangeAllowedHere({ GITHUB_ACTIONS: "true", GITHUB_REPOSITORY: "PeaceG03/PeaceAI-Results", GITHUB_EVENT_NAME: "schedule" }).reason, "START_MANUALLY_OR_ON_PROPOSAL");
  assert.ok(selfChangeAllowedHere({ GITHUB_ACTIONS: "true", GITHUB_REPOSITORY: "PeaceG03/PeaceAI-Results", GITHUB_EVENT_NAME: "workflow_dispatch" }).ok);
  assert.equal(budgetMinutes("999"), MAX_BUDGET_MINUTES);
  assert.equal(budgetMinutes("-1"), 15);
  assert.equal(budgetMinutes("5"), 5);
  const r = spawnSync(tsx, [cli, "propose", "--id", "sc-x", "--patch", "/dev/null"], { cwd: repo, encoding: "utf8", env: { ...process.env, GITHUB_ACTIONS: "true", GITHUB_REPOSITORY: "PeaceG03/PeaceAI-Workspace" } });
  assert.equal(r.status, 3);
  assert.match(r.stdout, /PUBLIC_RUNNER_REFUSED/);
  // No public Workspace workflow runs it (and so none on a timer).
  for (const f of readdirSync(join(repo, ".github/workflows"))) assert.doesNotMatch(readFileSync(join(repo, ".github/workflows", f), "utf8"), /self-change|selfchange/, f);
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
const propose = (live: string, id: string, diff: string, out: string) => {
  writeFileSync(join(out, `${id}.patch`), diff);
  return spawnSync(tsx, [cli, "propose", "--id", id, "--patch", join(out, `${id}.patch`), "--live", live, "--out", out, "--budget", "3"], { cwd: repo, encoding: "utf8", env: { ...process.env, GITHUB_ACTIONS: "" } });
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

test("promotion is refused without Auditor's label and Architect's command (after the label, exact id and sha)", () => {
  const liveFiles = ["peaceai/test/double.test.ts"];
  const approvers = { auditor: ["PeaceG03"], architect: ["PeaceG03"] };
  const label = { label: AUDITOR_LABEL, actor: "PeaceG03", createdAt: "2026-10-10T01:00:00Z" };
  const cmd = { body: `${PROMOTE_COMMAND} sc-good ${"b".repeat(40)}`, author: "PeaceG03", association: "OWNER", createdAt: "2026-10-10T02:00:00Z" };
  const d = (r: SelfChangeRecord, labels: any[], comments: any[], files = liveFiles) => promotionDecision(r, files, labels, comments, approvers);
  assert.deepEqual(d(record(), [label], [cmd]), { ok: true, reasons: [] });
  assert.deepEqual(d(record(), [], []).reasons, ["AUDITOR_REVIEW_MISSING", "ARCHITECT_APPROVAL_MISSING"]);
  assert.deepEqual(d(record(), [label], []).reasons, ["ARCHITECT_APPROVAL_MISSING"]);
  assert.deepEqual(d(record(), [], [cmd]).reasons, ["AUDITOR_REVIEW_MISSING"]);
  assert.deepEqual(d(record(), [{ ...label, actor: "someone-else" }], [cmd]).reasons, ["AUDITOR_REVIEW_MISSING"]);
  assert.deepEqual(d(record(), [{ ...label, label: "reviewed" }], [cmd]).reasons, ["AUDITOR_REVIEW_MISSING"]);
  assert.deepEqual(d(record(), [label], [{ ...cmd, createdAt: "2026-10-10T00:30:00Z" }]).reasons, ["ARCHITECT_APPROVAL_MISSING"], "command before the label");
  assert.deepEqual(d(record(), [label], [{ ...cmd, body: `${PROMOTE_COMMAND} sc-good ${"d".repeat(40)}` }]).reasons, ["ARCHITECT_APPROVAL_MISSING"], "another sha");
  assert.deepEqual(d(record(), [label], [{ ...cmd, association: "NONE" }]).reasons, ["ARCHITECT_APPROVAL_MISSING"]);
  assert.deepEqual(d(record(), [label], [{ ...cmd, author: "someone-else" }]).reasons, ["ARCHITECT_APPROVAL_MISSING"]);
  // Approvals never override failing or substituted live tests, or a protected path.
  assert.ok(d(record({ tests: [{ ...record().tests[0]!, exitCode: 1, fail: 1 }] }), [label], [cmd]).reasons.includes("LIVE_TESTS_FAILED"));
  assert.ok(d(record({ tests: [] }), [label], [cmd]).reasons.includes("LIVE_TESTS_NOT_RUN"));
  assert.ok(d(record(), [label], [cmd], ["peaceai/test/double.test.ts", "peaceai/test/other.test.ts"]).reasons.includes("LIVE_SUITE_MISMATCH"));
  assert.ok(d(record({ paths: ["peaceai/lib/leak.ts"] }), [label], [cmd]).reasons.includes("PROTECTED_SET"));
  assert.ok(d(record({ tests: [...record().tests, { suite: "new", files: ["x"], filesSha256: "", exitCode: 1, fail: 1, pass: 0 }] }), [label], [cmd]).reasons.includes("NEW_TESTS_FAILED"));
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
    const r = spawnSync(tsx, [cli, "rollback", "--record", join(out, "r.json"), "--repo", dir], { cwd: repo, encoding: "utf8" });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, new RegExp(`branch=peaceai-self-rollback/sc-good reverts=${merge.slice(0, 12)}`));
    assert.equal(readFileSync(join(dir, "peaceai/lib/double.ts"), "utf8"), before);
    assert.equal(existsSync(join(dir, "peaceai/lib/extra.ts")), false);
    assert.equal(git(dir, "rev-parse", "--abbrev-ref", "HEAD"), "peaceai-self-rollback/sc-good");
    // Not promoted: nothing to roll back.
    writeFileSync(join(out, "n.json"), JSON.stringify(record()));
    const n = spawnSync(tsx, [cli, "rollback", "--record", join(out, "n.json"), "--repo", dir], { cwd: repo, encoding: "utf8" });
    assert.equal(n.status, 2);
    assert.match(n.stdout, /NOT_PROMOTED/);
  } finally { rmSync(dir, { recursive: true, force: true }); rmSync(out, { recursive: true, force: true }); }
});
