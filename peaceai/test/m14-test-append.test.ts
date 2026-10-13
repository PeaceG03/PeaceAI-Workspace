// M14: the test-append learned edit type (ADD_TEST_CASE with placement "append"). The narrow exception to
// "existing tests are never edited": only a graded learned test (summary fixSha), only lines added at the
// END of an existing test file, and Job B grades only the appended case (base imports + new lines), so cases
// already in the file (even ones the fix added) can never make it pass the fail-before check.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { APPROVED_SCHEMA } from "../lib/approved.ts";
import { parseDiff } from "../lib/diff.ts";
import { applyRule, specHash, validateSpec, type RuleSpec } from "../lib/learned.ts";
import { TEST_TRIGGER } from "../lib/learned-test.ts";
import { observeTestFile, PEACE_AUTHOR } from "../lib/minetest.ts";
import { tally } from "../lib/mine.ts";
import { proposeRules } from "../lib/propose.ts";
import { buildRecords } from "../lib/records.ts";
import { validateResults } from "../lib/results.ts";
import { checkCandidateScope, WORKSPACE_SCOPE } from "../lib/scope.ts";

const repo = resolve(import.meta.dirname, "..", "..");
const tsx = join(repo, "node_modules/.bin/tsx");
const scratch = () => mkdtempSync(join(tmpdir(), "m14-"));
const git = (cwd: string, ...a: string[]) => execFileSync("git", ["-c", "user.name=PeaceG03", "-c", `user.email=${PEACE_AUTHOR}`, ...a], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const PARAMS = { assert: "node:assert/strict-default", checks: ["equal", "deepEqual", "throws", "rejects"], framework: "node:test-default", grading: "fail-before-pass-after", matcher: "regex", maxLines: "40", placement: "append" };
const spec = (over: Partial<RuleSpec> = {}): RuleSpec => ({
  schema: "peaceai-learned-rule:v1", id: "public-test-case-append-v1", kind: "ADD_TEST_CASE", minedFrom: "public", minerVersion: "peaceai-miner:v1", shape: "TEST_CASE_APPEND",
  trigger: TEST_TRIGGER, params: { ...PARAMS }, evidence: { hunks: 147, commits: 56, files: 34, repos: ["PeaceG03/PeaceAI-Workspace", "PeaceG03/PeaceSTOCKS"] }, ...over,
});
const BUGGY = 'export function sessionKind(date: string): string {\n  return date.endsWith("-12-25") ? "NORMAL" : "NORMAL";\n}\n';
const FIXED = 'export function sessionKind(date: string): string {\n  return date.endsWith("-12-25") ? "CLOSED" : "NORMAL";\n}\n';
const BASE_TEST = 'import assert from "node:assert/strict";\nimport test from "node:test";\nimport { sessionKind } from "./cal";\n\ntest("summer is normal", () => {\n  assert.equal(sessionKind("2026-07-01"), "NORMAL");\n});\n';
const FIX_TEST = BASE_TEST + '\ntest("fix: christmas closed", () => {\n  assert.equal(sessionKind("2025-12-25"), "CLOSED");\n});\n';
const task = (fix: string, check = '- sessionKind("2026-12-25") is "CLOSED"') => `add a test for sessionKind in src/cal.ts: Christmas 2026 is closed\n${check}\nFix: ${fix}`;

test("spec: committed public-test-case-append-v1 validates; placement append is in the fixed vocabulary", () => {
  const s = JSON.parse(readFileSync(join(repo, "peaceai/rules/learned/public-test-case-append-v1.json"), "utf8"));
  assert.ok(validateSpec(s));
  assert.equal(s.params.placement, "append");
  assert.equal(validateSpec(spec({ params: { ...PARAMS, placement: "insert" } })), false);
});

test("miner: a case appended after every existing statement is TEST_CASE + TEST_CASE_APPEND; an inserted one is TEST_CASE only", () => {
  const post = BASE_TEST + '\ntest("x", () => {\n  assert.equal(1, 1);\n});\n';
  const appended = observeTestFile("R@1", "src/cal.test.ts", post, "@@ -7,0 +8,4 @@\n+\n+test(\"x\", () => {\n+  assert.equal(1, 1);\n+});\n");
  assert.deepEqual(appended.map((o) => o.shape).sort(), ["TEST_CASE", "TEST_CASE_APPEND"]);
  const inserted = 'import assert from "node:assert/strict";\nimport test from "node:test";\ntest("x", () => {\n  assert.equal(1, 1);\n});\ntest("old", () => {});\n';
  assert.deepEqual(observeTestFile("R@1", "src/a.test.ts", inserted, "@@ -2,0 +3,3 @@\n+test(\"x\", () => {\n+  assert.equal(1, 1);\n+});\n").map((o) => o.shape), ["TEST_CASE"]);
  const st = tally(appended).find((s) => s.shape === "TEST_CASE_APPEND")!;
  const p = proposeRules([{ ...st, commits: 56, files: 34, styles: { ...st.styles, "check:equal": { yes: 9 } } }], "public", ["PeaceG03/PeaceSTOCKS"]).proposals;
  assert.equal(p[0]?.spec.id, "public-test-case-append-v1");
  assert.equal(p[0]?.spec.params.placement, "append");
});

const FILES = [{ path: "src/cal.ts", content: FIXED }, { path: "src/cal.test.ts", content: BASE_TEST }];
test("engine: appends one case at the end of <stem>.test.ts without changing any existing line", () => {
  const e = applyRule(spec(), task("a".repeat(40)), FILES)!;
  assert.ok(e);
  assert.equal(e.path, "src/cal.test.ts");
  assert.equal(e.create, undefined);
  assert.ok(e.content.startsWith(BASE_TEST));
  assert.match(e.content.slice(BASE_TEST.length), /^\ntest\("Christmas 2026 is closed", \(\) => \{\n  assert\.equal\(sessionKind\("2026-12-25"\), "CLOSED"\);\n\}\);\n$/);
});

test("engine refusals: no own test file, missing imports, a name not imported, a duplicate test name", () => {
  const no = (files: { path: string; content: string }[], t = task("a".repeat(40))) => assert.equal(applyRule(spec(), t, files), null);
  no([FILES[0]!]);
  no([FILES[0]!, { path: "src/cal.test.ts", content: BASE_TEST.replace('import assert from "node:assert/strict";\n', "") }]);
  no([FILES[0]!, { path: "src/cal.test.ts", content: BASE_TEST.replace('import test from "node:test";\n', 'import { test } from "node:test";\n') }]);
  no([{ path: "src/cal.ts", content: FIXED + "export const other = 1;\n" }, FILES[1]!], task("a".repeat(40), "- other is 1"));
  no([FILES[0]!, { path: "src/cal.test.ts", content: BASE_TEST + 'test("Christmas 2026 is closed", () => {});\n' }]);
});

test("diff + scope: an existing test file is allowed ONLY as a pure end-append AND only for a graded learned test", () => {
  const dir = scratch();
  try {
    mkdirSync(join(dir, "src"));
    writeFileSync(join(dir, "src/cal.test.ts"), BASE_TEST);
    git(dir, "init", "-q"); git(dir, "add", "-A"); git(dir, "commit", "-qm", "b");
    const diffOf = (content: string) => { writeFileSync(join(dir, "src/cal.test.ts"), content); const d = git(dir, "diff", "--no-color"); git(dir, "checkout", "-q", "--", "."); return d; };
    const base = new Set(["src/cal.test.ts"]);
    const append = parseDiff(diffOf(BASE_TEST + '\ntest("n", () => {});\n'));
    assert.equal(append[0]!.appendOnly, true);
    assert.deepEqual(checkCandidateScope(append, base, WORKSPACE_SCOPE, { testAppend: true }), []);
    assert.ok(checkCandidateScope(append, base, WORKSPACE_SCOPE).length > 0, "no flag: still refused");
    for (const bad of [
      BASE_TEST.replace('"NORMAL"', '"CLOSED"') + '\ntest("n", () => {});\n', // edits an existing line
      BASE_TEST.replace('\ntest("summer', '\ntest("n", () => {});\n\ntest("summer'), // inserted in the middle
      BASE_TEST.replace('  assert.equal(sessionKind("2026-07-01"), "NORMAL");\n', ""), // removes a line
    ]) {
      const f = parseDiff(diffOf(bad));
      assert.equal(f[0]!.appendOnly, false);
      assert.ok(checkCandidateScope(f, base, WORKSPACE_SCOPE, { testAppend: true }).length > 0);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

const TSCONFIG = JSON.stringify({ compilerOptions: { target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext", strict: true, noEmit: true }, include: ["src"] });
function fixture() {
  const dir = scratch();
  const ws = join(dir, "ws");
  mkdirSync(join(ws, "src"), { recursive: true });
  writeFileSync(join(ws, "src/cal.ts"), BUGGY);
  writeFileSync(join(ws, "src/cal.test.ts"), BASE_TEST);
  writeFileSync(join(ws, "tsconfig.json"), TSCONFIG);
  writeFileSync(join(ws, ".gitignore"), "node_modules\n");
  symlinkSync(join(repo, "node_modules"), join(ws, "node_modules"));
  git(ws, "init", "-q", "-b", "main"); git(ws, "add", "-A"); git(ws, "commit", "-qm", "buggy");
  // The fix also adds its own case to the same test file (that case fails before the fix).
  writeFileSync(join(ws, "src/cal.ts"), FIXED); writeFileSync(join(ws, "src/cal.test.ts"), FIX_TEST);
  git(ws, "add", "-A"); git(ws, "commit", "-qm", "fix");
  const fixSha = git(ws, "rev-parse", "HEAD").trim();
  const cand = (check: string) => {
    const e = applyRule(spec(), task(fixSha, check), [{ path: "src/cal.ts", content: FIXED }, { path: "src/cal.test.ts", content: FIX_TEST }])!;
    assert.ok(e, check);
    writeFileSync(join(ws, e.path), e.content);
    const d = git(ws, "diff", "--no-color", "--full-index", "--no-renames");
    git(ws, "checkout", "-q", "--", ".");
    return d;
  };
  return { dir, ws, fixSha, baseSha: fixSha, cand };
}
function grade(fx: ReturnType<typeof fixture>, diffs: string[]) {
  const inDir = join(fx.dir, "in");
  mkdirSync(join(inDir, "candidates"), { recursive: true });
  const op = `learned:public-test-case-append-v1@${specHash(spec())}`;
  const candidates = diffs.map((d, i) => { writeFileSync(join(inDir, "candidates", `candidate-${i + 1}.diff`), d); return { id: `candidate-${i + 1}`, file: `candidates/candidate-${i + 1}.diff`, transformations: ["LEARNED_ADD_TEST_CASE"], operationId: op, diffBytes: d.length, diffLines: 4, fixSha: fx.fixSha }; });
  const summary = { schema: "peaceai-workspace-candidates:v1", taskId: "workspace-issue-9", baseSha: fx.baseSha, candidates };
  writeFileSync(join(inDir, "summary.json"), JSON.stringify(summary));
  const list = join(fx.dir, "approved.json");
  writeFileSync(list, JSON.stringify({ schema: APPROVED_SCHEMA, rules: [{ id: "public-test-case-append-v1", sha256: specHash(spec()), source: "workspace", approval: { url: "https://github.com/PeaceG03/PeaceAI-Workspace/issues/40#issuecomment-123", commentId: 123, issue: 40, repo: "PeaceG03/PeaceAI-Workspace", author: "PeaceG03", approvedAt: "2026-10-13T00:00:00Z" } }] }));
  const out = join(fx.dir, "out", "results.json");
  mkdirSync(join(fx.dir, "out"), { recursive: true });
  const r = spawnSync(tsx, [join(repo, "peaceai/bin/test-candidates.ts")], { cwd: repo, encoding: "utf8", env: { ...process.env, PEACEAI_IN_DIR: inDir, PEACEAI_RESULTS_FILE: out, PEACEAI_WORKSPACE_DIR: fx.ws, PEACEAI_TARGET: "PeaceG03/PeaceAI-Workspace", PEACEAI_SANDBOX_USER: "", PEACEAI_REQUIRE_SANDBOX: "", PEACEAI_APPROVED_LIST: list } });
  assert.equal(r.status, 0, r.stderr);
  const res = JSON.parse(readFileSync(out, "utf8"));
  assert.ok(validateResults(res));
  return { results: res.results, summary };
}

test("Job B: an appended case COUNTS only on its own; the fix's own case in the file cannot make a passes-both case count", () => {
  const fx = fixture();
  try {
    const good = fx.cand('- sessionKind("2026-12-25") is "CLOSED"');
    const both = fx.cand('- sessionKind("2026-07-02") is "NORMAL"'); // true before and after the fix
    const { results, summary } = grade(fx, [good, both]);
    assert.deepEqual(results[0].testGrading, { fixSha: fx.fixSha, afterFix: true, beforeFix: false, verdict: "COUNTS", reason: null });
    assert.equal(results[0].originalSuitePassed, true);
    assert.equal(results[1].testGrading?.verdict, "REJECTED_PASSES_BOTH", "the fix's own case is not part of the graded file");
    const rec = buildRecords({ issue: 9, runId: "1", recordedAt: "2026-10-13T00:00:00Z", baseSha: fx.baseSha, title: "[test] a", body: task(fx.fixSha) }, summary.candidates, results, "seed");
    assert.deepEqual(rec.ranking.candidates.map((c) => [c.eligible, c.rejectReason]), [[true, null], [false, "test-grading"]]);
  } finally { rmSync(fx.dir, { recursive: true, force: true }); }
});
