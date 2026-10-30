import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import { addText, emptyIndex } from "../lib/coretext.ts";
import { parseDiff } from "../lib/diff.ts";
import { gateCandidate } from "../lib/gate.ts";
import { buildRecords, taskEntry } from "../lib/records.ts";
import { reviewBody } from "../lib/review.ts";
import { checkCandidateScope } from "../lib/scope.ts";
import { MAX_SOURCE_BYTES, MAX_SOURCES, relatedTests, selectSources, taskIdentifiers } from "../lib/sources.ts";
import { decide, DECISION_MESSAGE, loadTargets, resolveTarget, scopeOf, visibilityOf } from "../lib/target.ts";
import { cleanIssueText } from "../lib/taskmap.ts";

const WS = "PeaceG03/PeaceAI-Workspace";
const PS = "PeaceG03/PeaceSTOCKS";
const targets = loadTargets();
const psScope = scopeOf(targets.targets[PS]!);
const wsScope = scopeOf(targets.targets[WS]!);
// Built at runtime so this file itself carries no address (the pre-push scan would rightly block it).
const FAKE_EMAIL = ["someone", "gmail.com"].join("@");
const publicApi = (name: string) => ({ full_name: name, private: false, visibility: "public" });

const editDiff = (path: string, added: string[]) =>
  [`diff --git a/${path} b/${path}`, "index 1111111..2222222 100644", `--- a/${path}`, `+++ b/${path}`, "@@ -1,1 +1,2 @@", " context", ...added.map((l) => `+${l}`), ""].join("\n");
const newFileDiff = (path: string, added: string[]) =>
  [`diff --git a/${path} b/${path}`, "new file mode 100644", "index 0000000..3333333", "--- /dev/null", `+++ b/${path}`, `@@ -0,0 +1,${added.length} @@`, ...added.map((l) => `+${l}`), ""].join("\n");

// ---------- routing ----------
test("target routing: default, label, body line, conflicts, invalid names", () => {
  assert.deepEqual(resolveTarget(["peace-task"], "Add a thing", WS), { ok: true, target: WS });
  assert.deepEqual(resolveTarget(["peace-task", `target:${PS}`], "", WS), { ok: true, target: PS });
  assert.deepEqual(resolveTarget([], `Do X.\n\nTarget: ${PS}\n`, WS), { ok: true, target: PS });
  assert.deepEqual(resolveTarget([`target:${PS}`], `target: ${PS.toLowerCase()}`, WS), { ok: true, target: PS });
  assert.deepEqual(resolveTarget([`target:${PS}`], `Target: ${WS}`, WS), { ok: false, reason: "conflicting-targets" });
  assert.deepEqual(resolveTarget(["target:not a repo"], "", WS), { ok: false, reason: "invalid-target" });
  assert.deepEqual(resolveTarget(["target:a/../b"], "", WS).ok, false);
  assert.deepEqual(resolveTarget(["target:PeaceG03/.github"], "", WS), { ok: false, reason: "invalid-target" });
  // A mention inside a sentence is not a routing line.
  assert.deepEqual(resolveTarget([], `Mirror the target: ${PS} later, maybe`, WS), { ok: true, target: WS });
});

test("the target line is not part of the task text the kernel sees", () => {
  const text = cleanIssueText({ title: "Add constant", body: `Add an exported constant LIMIT with value 3 to src/a.ts.\nTarget: ${PS}` });
  assert.ok(!text.includes("PeaceSTOCKS"), text);
  assert.match(text, /src\/a\.ts/);
});

// ---------- visibility ----------
test("visibility: public only when the API says public on every field for the same repo", () => {
  assert.equal(visibilityOf(PS, publicApi(PS)), "public");
  assert.equal(visibilityOf(PS, { ...publicApi(PS), full_name: "peaceg03/peacestocks" }), "public");
  assert.equal(visibilityOf(PS, { ...publicApi(PS), private: true }), "private");
  assert.equal(visibilityOf(PS, { ...publicApi(PS), visibility: "internal" }), "private");
  assert.equal(visibilityOf(PS, { ...publicApi(PS), visibility: undefined }), "private");
  assert.equal(visibilityOf(PS, publicApi("PeaceG03/Other")), "private"); // renamed / redirected
  assert.equal(visibilityOf(PS, null), "private"); // check failed or could not run
  assert.equal(visibilityOf(PS, "oops"), "private");
  assert.equal(visibilityOf(PS, publicApi(PS), true), "private"); // forced failure
});

test("decide: only confirmed-public, configured targets run", () => {
  assert.deepEqual(decide({ ok: true, target: PS }, "private", targets), { run: false, reason: "not-public" });
  assert.deepEqual(decide({ ok: true, target: PS }, null, targets), { run: false, reason: "not-public" });
  assert.deepEqual(decide({ ok: true, target: "PeaceG03/Unknown" }, "public", targets), { run: false, reason: "not-configured" });
  assert.deepEqual(decide({ ok: false, reason: "invalid-target" }, null, targets), { run: false, reason: "invalid-target" });
  const ps = decide({ ok: true, target: "peaceg03/peacestocks" }, "public", targets);
  assert.ok(ps.run && ps.target === PS && !ps.isDefault && ps.config.originalSuite === "related");
  const ws = decide({ ok: true, target: WS }, "public", targets);
  assert.ok(ws.run && ws.isDefault && ws.config.originalSuite === "full");
  // The PeaceAI core is private: it can never be a target that runs.
  assert.deepEqual(decide({ ok: true, target: "PeaceG03/PeaceAI" }, "private", targets), { run: false, reason: "not-public" });
});

test("fail-closed messages are content-free (no paths, no target name, no diff)", () => {
  for (const message of Object.values(DECISION_MESSAGE)) {
    assert.ok(!/PeaceSTOCKS|src\/|diff --git|@@/.test(message), message);
  }
});

// ---------- per-target scope ----------
test("PeaceSTOCKS scope: src TypeScript only; workflows, secrets, production config, fixtures and entry points excluded", () => {
  const base = new Set(["src/dust.ts", "src/dust.test.ts", "src/host.ts", "wrangler.toml", ".github/workflows/scanner.yml", "src/fixtures/a.json"]);
  const reasons = (diff: string) => checkCandidateScope(parseDiff(diff), base, psScope).map((v) => v.reason);
  assert.deepEqual(reasons(editDiff("src/dust.ts", ["export const X = 1;"])), []);
  assert.deepEqual(reasons(newFileDiff("src/dust.extra.test.ts", ["import test from 'node:test';"])), []);
  assert.ok(reasons(editDiff("src/dust.test.ts", ["x"])).includes("modifies an existing test file"));
  assert.ok(reasons(editDiff(".github/workflows/scanner.yml", ["x"])).includes("outside allowed paths"));
  assert.ok(reasons(editDiff("wrangler.toml", ["x"])).includes("outside allowed paths"));
  assert.ok(reasons(newFileDiff(".env", ["X=1"])).includes("outside allowed paths"));
  for (const p of ["src/host.ts", "src/secrets.ts", "src/api-token.ts", "src/production-config.ts", "src/wrangler-env.ts", "src/fake-r2.test-helper.ts", "src/fixtures/x.ts", "src/.hidden.ts"])
    assert.ok(reasons(newFileDiff(p, ["export const a = 1;"])).some((r) => r === "denied path for this target" || r === "outside allowed paths"), p);
  // Workspace scope is unchanged by M5.
  assert.deepEqual(checkCandidateScope(parseDiff(editDiff("src/host.ts", ["x"])), new Set(["src/host.ts"]), wsScope), []);
});

test("gate per target: denied paths, personal info, and core text with the target's own tree as baseline", () => {
  const core = { text: emptyIndex(), paths: new Set<string>(["packages/x/src/engine.ts"]), basenames: new Set<string>(["engine.ts"]) };
  const sharedLine = "export function computeGroupedWithoutIndexEntry(rows: readonly Row[], tickers: Set<string>) {";
  addText(core.text, sharedLine);
  const base = new Set(["src/dust.ts", "src/host.ts"]);
  // A line that is already public in the target tree is not a core leak.
  const targetTree = emptyIndex();
  addText(targetTree, sharedLine);
  assert.equal(gateCandidate(editDiff("src/dust.ts", [sharedLine]), base, targetTree, core, psScope).ok, true);
  // The same line is a core leak when the target does not already have it.
  assert.ok(gateCandidate(editDiff("src/dust.ts", [sharedLine]), base, emptyIndex(), core, psScope).reasons.some((r) => r.startsWith("core-text")));
  assert.ok(gateCandidate(editDiff("src/host.ts", ["export const a = 1;"]), base, emptyIndex(), core, psScope).reasons.some((r) => r.includes("denied path")));
  const pii = gateCandidate(editDiff("src/dust.ts", [`export const OWNER = "${FAKE_EMAIL}";`]), base, emptyIndex(), core, psScope);
  assert.ok(pii.reasons.some((r) => r.startsWith("personal-info")), pii.reasons.join(";"));
  assert.ok(!pii.reasons.join(" ").includes("gmail"), "gate reasons never echo the finding");
  assert.ok(gateCandidate(newFileDiff("src/engine.ts", ["export const a = 1;"]), base, emptyIndex(), core, psScope).reasons.some((r) => r.startsWith("core-path")));
});

test("targets.json: every target compiles; PeaceSTOCKS PRs need its own main-only write environment", () => {
  assert.equal(targets.default, WS);
  assert.equal(targets.targets[WS]!.writeEnvironment, null);
  assert.equal(targets.targets[PS]!.writeEnvironment, "peacestocks-write");
  assert.equal(targets.targets[PS]!.install, "pnpm");
});

// ---------- bounded sources and related tests ----------
test("selectSources: named files first, identifier matches next, budgets respected, input order kept", () => {
  const files = Array.from({ length: 40 }, (_, i) => ({ path: `src/f${String(i).padStart(2, "0")}.ts`, content: `export const v${i} = ${i};\n`.padEnd(9000, "/") }));
  files[30]!.content = "export const DUST_LIMIT = 3;\n".padEnd(9000, "/");
  const picked = selectSources("Add an exported constant MAX with value 2 to src/f35.ts near DUST_LIMIT", files);
  assert.ok(picked.length <= MAX_SOURCES);
  assert.ok(picked.reduce((s, f) => s + f.content.length, 0) <= MAX_SOURCE_BYTES);
  assert.ok(picked.some((f) => f.path === "src/f35.ts"));
  assert.ok(picked.some((f) => f.path === "src/f30.ts"));
  assert.deepEqual(picked.map((f) => f.path), [...picked.map((f) => f.path)].sort());
  // Small repos: everything fits, nothing changes.
  const small = files.slice(0, 5).map((f) => ({ ...f, content: "x" }));
  assert.deepEqual(selectSources("anything", small), small);
  assert.deepEqual(taskIdentifiers("Add DUST_LIMIT to computeRows in the file"), ["DUST_LIMIT", "computeRows"]);
});

test("relatedTests: same-stem tests and importers of the touched module", () => {
  const tests = [
    { path: "src/dust.test.ts", content: "" },
    { path: "src/dust-edge.test.ts", content: "" },
    { path: "src/other.test.ts", content: 'import { x } from "./dust.ts";' },
    { path: "src/far.test.ts", content: 'import { x } from "./dustbin.ts";' },
    { path: "src/dustbin.test.ts", content: "" },
  ];
  assert.deepEqual(relatedTests(["src/dust.ts"], tests), ["src/dust-edge.test.ts", "src/dust.test.ts", "src/other.test.ts"]);
  assert.deepEqual(relatedTests(["src/dust.ts"], tests, 2), ["src/dust-edge.test.ts", "src/dust.test.ts"]);
});

test("relatedTests ownFirst (W619): the touched module's own tests come first, stable, before importers; the cut keeps them", () => {
  const tests = [
    { path: "src/a-uses.test.ts", content: 'import { x } from "./dust.ts";' },
    { path: "src/b-uses.test.ts", content: 'import { x } from "./dust.ts";' },
    { path: "src/dust.test.ts", content: "" },
    { path: "src/dust.r2-x.test.ts", content: "" },
    { path: "src/dust-edge.test.ts", content: "" },
    { path: "src/lib/dust.test.ts", content: 'import { x } from "../dust.ts";' },
    { path: "src/dustbin.test.ts", content: "" },
  ];
  // default order is unchanged (sorted); ownFirst puts dust-edge / dust.r2-x / dust.test first, then importers sorted
  assert.deepEqual(relatedTests(["src/dust.ts"], tests), ["src/a-uses.test.ts", "src/b-uses.test.ts", "src/dust-edge.test.ts", "src/dust.r2-x.test.ts", "src/dust.test.ts", "src/lib/dust.test.ts"]);
  assert.deepEqual(relatedTests(["src/dust.ts"], tests, 6, { ownFirst: true }), ["src/dust-edge.test.ts", "src/dust.r2-x.test.ts", "src/dust.test.ts", "src/a-uses.test.ts", "src/b-uses.test.ts", "src/lib/dust.test.ts"]);
  assert.deepEqual(relatedTests(["src/dust.ts"], tests, 2), ["src/a-uses.test.ts", "src/b-uses.test.ts"]);
  assert.deepEqual(relatedTests(["src/dust.ts"], tests, 2, { ownFirst: true }), ["src/dust-edge.test.ts", "src/dust.r2-x.test.ts"]);
  // a same-named test in another directory is an importer here, not an own test
  assert.deepEqual(relatedTests(["src/lib/dust.ts"], [{ path: "src/dust.test.ts", content: 'import { x } from "./lib/dust.ts";' }, { path: "src/lib/dust.test.ts", content: "" }], 6, { ownFirst: true }), ["src/lib/dust.test.ts", "src/dust.test.ts"]);
});

// ---------- records and review ----------
test("records carry the target; the review names a non-default target", () => {
  const records = buildRecords(
    { issue: 7, runId: "1", recordedAt: "2026-10-10T00:00:00Z", baseSha: "a".repeat(40), title: "[test] x", body: "", target: PS },
    [],
    [],
    "seed",
  );
  assert.equal(records.task.target, PS);
  assert.equal(taskEntry(records.task, records.ranking, []).target, PS);
  const older = buildRecords({ issue: 8, runId: "1", recordedAt: "2026-10-10T00:00:00Z", baseSha: "a".repeat(40), title: "x", body: "" }, [], [], "s");
  assert.equal("target" in older.task, false);
  assert.equal(taskEntry(older.task, older.ranking, []).target, null);
  const body = reviewBody([{ label: "A", id: "candidate-1" }], new Map([["candidate-1", "diff"]]), PS);
  assert.match(body, /Target repository: `PeaceG03\/PeaceSTOCKS` \(public\)/);
  assert.ok(!reviewBody([{ label: "A", id: "candidate-1" }], new Map([["candidate-1", "diff"]])).includes("Target repository"));
  // M6: patch-route targets say a patch file is posted, never that a PR opens.
  const patchBody = reviewBody([{ label: "A", id: "candidate-1" }], new Map([["candidate-1", "diff"]]), PS, "patch");
  assert.match(patchBody, /posts a patch file here \(no PR\)/);
  assert.match(patchBody, /right` posts that candidate here as a `git format-patch` file\./);
  assert.ok(!/opens (a|the) PR/.test(patchBody));
});

// ---------- private-target isolation (the CLI with a fake gh) ----------
function fakeGh(api: "public" | "private" | "error"): { dir: string; log: string } {
  const dir = mkdtempSync(join(tmpdir(), "peaceai-fakegh-"));
  const log = join(dir, "calls.log");
  const repoJson = api === "public" ? JSON.stringify(publicApi(PS)) : JSON.stringify({ full_name: PS, private: true, visibility: "private" });
  const issueJson = JSON.stringify({ number: 41, labels: [{ name: "peace-task" }, { name: `target:${PS}` }], body: "Add an exported constant X with value 1 to src/dust.ts." });
  writeFileSync(
    join(dir, "gh"),
    `#!/usr/bin/env bash
printf '%s\\n' "$*" >> ${JSON.stringify(log)}
case "$1 $2" in
  "api repos/o/w/issues/41") printf '%s' ${JSON.stringify(issueJson).replace(/\$/g, "\\$")} ;;
  "api repos/${PS}") ${api === "error" ? "exit 1" : `printf '%s' '${repoJson}'`} ;;
  "issue edit"|"issue comment") ;;
  *) echo "unexpected gh call" >&2; exit 3 ;;
esac
`,
  );
  chmodSync(join(dir, "gh"), 0o755);
  return { dir, log };
}

function runCheck(env: Record<string, string>, gh: { dir: string }) {
  const outFile = join(gh.dir, "out.txt");
  writeFileSync(outFile, "");
  const r = spawnSync(resolve("node_modules/.bin/tsx"), ["peaceai/bin/target-check.ts"], {
    encoding: "utf8",
    env: { PATH: `${gh.dir}:${process.env.PATH}`, GITHUB_REPOSITORY: "o/w", GITHUB_OUTPUT: outFile, ...env },
  });
  return { status: r.status, stdout: r.stdout + r.stderr, outputs: readFileSync(outFile, "utf8") };
}

for (const scenario of ["private", "error", "forced"] as const) {
  test(`private-target isolation (${scenario}): fails closed, nothing of the target is fetched or printed`, () => {
    const gh = fakeGh(scenario === "forced" ? "public" : scenario);
    const r = runCheck({ MODE: "select", ISSUE_NUMBER: "41", ...(scenario === "forced" ? { PEACEAI_FORCE_VISIBILITY_FAIL: "true" } : {}) }, gh);
    assert.equal(r.status, 0, r.stdout);
    assert.match(r.outputs, /^run=false$/m);
    assert.match(r.outputs, /^target=$/m); // later jobs get no target and (in the workflow) no issue
    assert.ok(!r.stdout.includes("PeaceSTOCKS"), r.stdout);
    assert.match(r.stdout, /target_check run=false reason=not-public/);
    const calls = readFileSync(gh.log, "utf8").trim().split("\n");
    // Only: read the issue, (maybe) ask the API about visibility, mark failed, comment. Never a clone or content read.
    assert.deepEqual(calls.filter((c) => !c.startsWith(`api repos/${PS}`)), [
      "api repos/o/w/issues/41",
      "issue edit 41 --repo o/w --add-label peaceai:failed --remove-label peaceai:running",
      `issue comment 41 --repo o/w --body ${DECISION_MESSAGE["not-public"]}`,
    ]);
    if (scenario === "forced") assert.ok(!calls.some((c) => c.startsWith(`api repos/${PS}`)), "forced failure never asks");
  });
}

test("public target passes select; recheck exits non-zero the moment it is not public", () => {
  const pub = fakeGh("public");
  const ok = runCheck({ MODE: "select", ISSUE_NUMBER: "41" }, pub);
  assert.equal(ok.status, 0);
  assert.match(ok.outputs, /^run=true$/m);
  assert.match(ok.outputs, new RegExp(`^target=${PS}$`, "m"));
  assert.match(ok.outputs, /^install=pnpm$/m);
  assert.match(ok.outputs, /^write_env=peacestocks-write$/m);
  assert.equal(runCheck({ MODE: "recheck", TARGET: PS }, pub).status, 0);
  assert.equal(runCheck({ MODE: "recheck", TARGET: PS, PEACEAI_FORCE_VISIBILITY_FAIL: "true" }, pub).status, 1);
  assert.equal(runCheck({ MODE: "recheck", TARGET: PS }, fakeGh("private")).status, 1);
  assert.equal(runCheck({ MODE: "recheck", TARGET: PS }, fakeGh("error")).status, 1);
});

test("workflow: later jobs only ever see a confirmed-public target, re-checked before target content moves", () => {
  const task = readFileSync(".github/workflows/peace-task.yml", "utf8");
  assert.match(task, /issue: \$\{\{ steps\.target\.outputs\.run == 'true' && steps\.pick\.outputs\.issue \|\| '' \}\}/);
  assert.match(task, /if: needs\.select\.outputs\.issue != '' && vars\.PEACEAI_ENABLED == 'true'/);
  // Re-checks: select's decision is re-confirmed in Job A, Job B, Job B2 (M7, before target content moves), the
  // M9 lm-fill job and review.
  assert.equal(task.match(/peaceai\/bin\/target-check\.ts/g)?.length, 6);
  assert.match(task, /Re-check the target is public before posting its diffs/);
  // The force switch can only make a run fail closed.
  assert.match(task, /PEACEAI_FORCE_VISIBILITY_FAIL: \$\{\{ inputs\.force_visibility_fail == true \}\}/);
  const verdict = readFileSync(".github/workflows/peace-verdict.yml", "utf8");
  assert.match(verdict, /environment: \$\{\{ needs\.record\.outputs\.write_env \}\}/);
  assert.match(verdict, /HAS_TOKEN: \$\{\{ secrets\.TARGET_PR_TOKEN != '' \}\}/);
  assert.match(verdict, /Fail closed without a write token/);
});

test("clone-target.sh refuses bad names and clones anonymously (a missing repo fails without prompting)", () => {
  const dest = join(mkdtempSync(join(tmpdir(), "peaceai-ct-")), "t");
  const bad = spawnSync("peaceai/bin/clone-target.sh", ["not/a/repo", dest], { encoding: "utf8" });
  assert.notEqual(bad.status, 0);
  assert.match(bad.stderr, /invalid target/);
  const inside = spawnSync("peaceai/bin/clone-target.sh", [PS, resolve("peaceai/tmp-clone")], { encoding: "utf8" });
  assert.match(inside.stderr, /outside the workspace/);
  const missing = spawnSync("peaceai/bin/clone-target.sh", ["PeaceG03/peaceai-no-such-repo-m5", dest], { encoding: "utf8", timeout: 60_000, env: { ...process.env, GH_TOKEN: "x" } });
  assert.notEqual(missing.status, 0);
  assert.match(missing.stderr, /target clone failed/);
  mkdirSync(dest, { recursive: true });
});

// ---------- pre-push hook reaches new Workspace clones ----------
test("install-pre-push --template: every new Workspace clone gets the hook; other remotes are untouched", { skip: !process.env.PEACEAI_CORE_DIR }, () => {
  const root = mkdtempSync(join(tmpdir(), "peaceai-tpl-"));
  const home = join(root, "home");
  mkdirSync(home);
  const env = { ...process.env, HOME: home, GIT_CONFIG_NOSYSTEM: "1" };
  const sh = (cmd: string, cwd = root) => spawnSync("bash", ["-c", cmd], { cwd, env, encoding: "utf8" });
  assert.equal(spawnSync(resolve("peaceai/bin/install-pre-push.sh"), ["--template", process.env.PEACEAI_CORE_DIR!], { env, encoding: "utf8" }).status, 0);
  sh("mkdir -p remote/PeaceG03 && git init -q --bare remote/PeaceG03/PeaceAI-Workspace.git && git init -q --bare remote/other.git && git clone -q remote/PeaceG03/PeaceAI-Workspace.git ws");
  const ws = join(root, "ws");
  writeFileSync(join(ws, "a.ts"), `export const owner = '${FAKE_EMAIL}';\n`);
  sh("git add a.ts && git -c user.name=x -c user.email=1+x@users.noreply.github.com commit -qm t", ws);
  const blocked = sh("git push origin HEAD:main 2>&1", ws);
  assert.notEqual(blocked.status, 0);
  assert.match(blocked.stdout, /PRE-PUSH BLOCKED/);
  sh(`git remote add other ${join(root, "remote/other.git")}`, ws);
  assert.equal(sh("git push -q other HEAD:main", ws).status, 0);
});
