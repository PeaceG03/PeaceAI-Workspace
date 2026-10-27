// M12: the test-writing learned edit type (ADD_TEST_CASE). Mining test files from the allowed public
// repositories only, the proposal and its spec checks, the template engine and its refusals, Job A's
// approval gate (an unapproved rule gives 0 candidates), the Job B harness grading (pass after the fix AND
// fail before it, written by the harness), the Results rejection, and that the gates and protected set hold.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { APPROVED_SCHEMA } from "../lib/approved.ts";
import { parseDiff } from "../lib/diff.ts";
import { gateCandidate, loadSummaryContext, NO_CLAIMS, operationIdAllowed, validateSummary } from "../lib/gate.ts";
import { applyRule, specHash, validateSpec, type RuleSpec } from "../lib/learned.ts";
import { buildTestEdit, checkRoot, exportedValues, parseTestTask, TEST_TRIGGER } from "../lib/learned-test.ts";
import { tally, type ShapeStats } from "../lib/mine.ts";
import { assertTestMiningAllowed, mineTests, observeTestFile, PEACE_AUTHOR, TestMiningRefused } from "../lib/minetest.ts";
import { parseTask } from "../lib/nlparse.ts";
import { cleanIssueText } from "../lib/taskmap.ts";
import { proposalBody, proposeRules } from "../lib/propose.ts";
import { buildRecords, gradingReject } from "../lib/records.ts";
import { gradingVerdict, validateFix, validateResults, validTestGrading } from "../lib/results.ts";
import { checkCandidateScope, WORKSPACE_SCOPE } from "../lib/scope.ts";
import { PROTECTED_SELF, protectedReason } from "../lib/selfchange.ts";
import { addText, emptyIndex } from "../lib/coretext.ts";
import ts from "typescript";

const repo = resolve(import.meta.dirname, "..", "..");
const tsx = join(repo, "node_modules/.bin/tsx");
const FIX = "a".repeat(40);
const scratch = () => mkdtempSync(join(tmpdir(), "m12-"));
const git = (cwd: string, ...a: string[]) => execFileSync("git", ["-c", "user.name=PeaceG03", "-c", `user.email=${PEACE_AUTHOR}`, ...a], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

const PARAMS = { assert: "node:assert/strict-default", checks: ["equal", "deepEqual", "throws", "rejects"], framework: "node:test-default", grading: "fail-before-pass-after", matcher: "regex", maxLines: "40", placement: "new-file" };
const spec = (over: Partial<RuleSpec> = {}): RuleSpec => ({
  schema: "peaceai-learned-rule:v1", id: "public-test-case-v1", kind: "ADD_TEST_CASE", minedFrom: "public", minerVersion: "peaceai-miner:v1", shape: "TEST_CASE",
  trigger: TEST_TRIGGER, params: { ...PARAMS }, evidence: { hunks: 612, commits: 96, files: 59, repos: ["PeaceG03/PeaceAI-Workspace", "PeaceG03/PeaceSTOCKS"] }, ...over,
});
const CAL = [
  "export type Kind = \"NORMAL\" | \"CLOSED\";",
  "export function sessionKind(date: string): Kind {",
  "  return date.endsWith(\"-12-25\") ? \"CLOSED\" : \"NORMAL\";",
  "}",
  "export function requireDate(date: string): string {",
  "  if (!/^\\d{4}-\\d{2}-\\d{2}$/.test(date)) throw new Error(\"BAD_DATE: \" + date);",
  "  return date;",
  "}",
  "const internal = 1;",
  "export { internal as exportedInternal };",
  "",
].join("\n");
const TASK = [
  "add a test for sessionKind in src/cal.ts: Christmas is closed",
  "- sessionKind(\"2026-12-25\") is \"CLOSED\"",
  "- sessionKind(\"2026-12-24\") is \"NORMAL\"",
  "- requireDate(\"x\") throws BAD_DATE",
  `Fix: ${FIX}`,
].join("\n");

// ---- mining (test files, public repositories only)

test("test miner: a new top-level test() case in a test file is one TEST_CASE with style facts only", () => {
  const post = 'import assert from "node:assert/strict";\nimport test from "node:test";\nimport { f } from "./f";\n\ntest("old", () => {\n  assert.equal(f(1), 1);\n});\n\ntest("holiday calendar fails closed", () => {\n  assert.equal(f(2), 2);\n  assert.deepEqual([f(3)], [3]);\n  assert.throws(() => f(-1), /NEGATIVE/);\n});\n';
  const diff = "@@ -7,0 +8,6 @@\n+\n+test(\"holiday calendar fails closed\", () => {\n+  assert.equal(f(2), 2);\n+  assert.deepEqual([f(3)], [3]);\n+  assert.throws(() => f(-1), /NEGATIVE/);\n+});\n";
  const all = observeTestFile("PeaceSTOCKS@1", "src/f.test.ts", post, diff);
  // M14: an appended case is also a TEST_CASE_APPEND observation (same style facts).
  assert.deepEqual(all.map((o) => o.shape), ["TEST_CASE", "TEST_CASE_APPEND"]);
  const obs = all.filter((o) => o.shape === "TEST_CASE");
  assert.equal(obs.length, 1, "the unchanged case is not counted");
  assert.deepEqual(obs[0]!.style, {
    framework: "node:test-default", assert: "node:assert/strict-default", importExt: "none", lines: "<=12",
    "check:equal": "yes", "check:deepEqual": "yes", "check:throws": "yes", "check:rejects": "no", matcher: "regex", objectArgs: "no", async: "no", failClosed: "yes", calendar: "yes",
  });
  assert.ok(!JSON.stringify(obs).includes("NEGATIVE"), "no code text in observations");
  assert.deepEqual(observeTestFile("PeaceSTOCKS@1", "src/f.ts", post, diff), [], "non-test files are not test evidence");
});

test("test miner: refuses every repository that is not the public scanner or this Workspace (label AND origin)", () => {
  const dir = scratch();
  try {
    git(dir, "init", "-q");
    for (const label of ["PeaceSTOCKS-Net", "PeaceSTOCKS-Net-Runner", "PeaceAI", "PeaceAI-Results", "anything"])
      assert.throws(() => assertTestMiningAllowed(dir, label), TestMiningRefused, label);
    assert.throws(() => mineTests(dir, "HEAD", "PeaceSTOCKS-Net"), TestMiningRefused);
    // Allowed label but the origin is another repository (e.g. a private clone renamed): refused.
    git(dir, "remote", "add", "origin", "https://github.com/PeaceG03/PeaceSTOCKS-Net.git");
    assert.throws(() => assertTestMiningAllowed(dir, "PeaceSTOCKS"), /origin of PeaceSTOCKS is not PeaceG03\/PeaceSTOCKS/);
    git(dir, "remote", "set-url", "origin", "git@github.com:PeaceG03/PeaceSTOCKS.git");
    assert.doesNotThrow(() => assertTestMiningAllowed(dir, "PeaceSTOCKS"));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("test miner: only Peace's noreply commits count", () => {
  const dir = scratch();
  try {
    git(dir, "init", "-q");
    git(dir, "remote", "add", "origin", "https://github.com/PeaceG03/PeaceAI-Workspace.git");
    mkdirSync(join(dir, "src"));
    writeFileSync(join(dir, "src/a.ts"), "export const a = 1;\n");
    git(dir, "add", "-A"); git(dir, "commit", "-qm", "base");
    writeFileSync(join(dir, "src/a.test.ts"), 'import assert from "node:assert/strict";\nimport test from "node:test";\nimport { a } from "./a.ts";\n\ntest("a", () => {\n  assert.equal(a, 1);\n});\n');
    git(dir, "add", "-A"); git(dir, "commit", "-qm", "peace test");
    writeFileSync(join(dir, "src/b.test.ts"), 'import test from "node:test";\ntest("b", () => {});\n');
    git(dir, "add", "-A");
    execFileSync("git", ["-c", "user.name=x", "-c", "user.email=x@example.com", "commit", "-qm", "someone else"], { cwd: dir });
    const r = mineTests(dir, "HEAD", "PeaceAI-Workspace");
    assert.equal(r.commits, 2);
    assert.deepEqual(r.observations.map((o) => [o.path, o.style.importExt]), [["src/a.test.ts", "ts"]]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ---- proposal and spec

const testStats = (over: Partial<ShapeStats["styles"]> = {}): ShapeStats => ({
  shape: "TEST_CASE", covered: null, hunks: 20, commits: 9, files: 6, examples: [{ commit: "PeaceSTOCKS@abcdef0123", path: "src/x.test.ts", line: 3 }],
  styles: {
    framework: { "node:test-default": 19, "node:test-named": 1 }, assert: { "node:assert/strict-default": 20 }, lines: { "<=12": 4, "13-40": 12, ">40": 4 },
    "check:equal": { yes: 15, no: 5 }, "check:deepEqual": { yes: 8, no: 12 }, "check:throws": { yes: 3, no: 17 }, "check:rejects": { yes: 1, no: 19 },
    matcher: { "n/a": 16, regex: 3, other: 1 }, ...over,
  },
});

test("proposal: TEST_CASE becomes a valid ADD_TEST_CASE spec with learned template parameters (public only)", () => {
  const { proposals } = proposeRules([testStats()], "public", ["PeaceG03/PeaceSTOCKS", "PeaceG03/PeaceAI-Workspace"]);
  assert.equal(proposals.length, 1);
  const s = proposals[0]!.spec;
  assert.equal(s.id, "public-test-case-v1");
  assert.equal(s.kind, "ADD_TEST_CASE");
  assert.ok(validateSpec(s));
  // rejects: support 1 < 2, so it is not learned; maxLines from the 13-40 majority.
  assert.deepEqual(s.params, { ...PARAMS, checks: ["equal", "deepEqual", "throws"] });
  assert.equal(proposals[0]!.sha256, specHash(s));
  const body = proposalBody(proposals[0]!, [{ label: "PeaceSTOCKS@abcdef0123 src/x.test.ts:3", url: "https://github.com/PeaceG03/PeaceSTOCKS/commit/abcdef0123" }]);
  assert.match(body, /FAIL on the code before the fix/);
  assert.doesNotMatch(body, /M7 repair loop as every other/);
  // Never from core; no regex matcher majority means no throws/rejects; wrong imports mean no rule.
  assert.deepEqual(proposeRules([testStats()], "core", ["PeaceG03/PeaceAI"]).skipped, [{ shape: "TEST_CASE", why: "no-executable-kind" }]);
  assert.deepEqual(proposeRules([testStats({ matcher: { other: 3 } })], "public", ["r"]).proposals[0]!.spec.params.checks, ["equal", "deepEqual"]);
  assert.deepEqual(proposeRules([testStats({ framework: { "node:test-named": 20 } })], "public", ["r"]).skipped, [{ shape: "TEST_CASE", why: "no-learnable-params" }]);
  assert.deepEqual(proposeRules([{ ...testStats(), commits: 2 }], "public", ["r"]).skipped, [{ shape: "TEST_CASE", why: "below-threshold" }]);
});

test("spec: ADD_TEST_CASE params are a fixed vocabulary; core-mined or extra keys are invalid", () => {
  assert.ok(validateSpec(spec()));
  assert.equal(validateSpec(spec({ id: "core-test-case-v1", minedFrom: "core" })), false);
  assert.equal(validateSpec(spec({ params: { ...PARAMS, extra: "x" } })), false);
  assert.equal(validateSpec(spec({ params: { ...PARAMS, checks: ["equal", "match"] } })), false);
  assert.equal(validateSpec(spec({ params: { ...PARAMS, placement: "insert" } })), false); // M14: "append" is now valid; anything else is not
  assert.equal(validateSpec(spec({ params: { ...PARAMS, grading: "none" } })), false);
  assert.equal(validateSpec(spec({ params: { ...PARAMS, maxLines: "400" } })), false);
});

// ---- engine

const files = [{ path: "src/cal.ts", content: CAL }, { path: "src/other.test.ts", content: 'import { x } from "./other";\n' }];

test("engine: fills the learned template from task names and target exports into one NEW test file", () => {
  const edit = applyRule(spec(), TASK, files);
  assert.ok(edit);
  assert.equal(edit.path, `src/cal.christmas-is-closed-${FIX.slice(0, 7)}.test.ts`);
  assert.equal(edit.create, true);
  assert.equal(edit.fixSha, FIX);
  assert.equal(edit.content, [
    'import assert from "node:assert/strict";',
    'import test from "node:test";',
    'import { requireDate, sessionKind } from "./cal";',
    "",
    'test("Christmas is closed", () => {',
    '  assert.equal(sessionKind("2026-12-25"), "CLOSED");',
    '  assert.equal(sessionKind("2026-12-24"), "NORMAL");',
    '  assert.throws(() => requireDate("x"), /BAD_DATE/);',
    "});",
    "",
  ].join("\n"));
  // Import style follows the target's own tests (".ts" when they use it).
  const tsStyle = applyRule(spec(), TASK, [files[0]!, { path: "src/o.test.ts", content: 'import { x } from "./o.ts";\n' }]);
  assert.match(tsStyle!.content, /from "\.\/cal\.ts";/);
  // Async checks render as an async test with assert.rejects.
  const rej = applyRule(spec(), TASK.replace('- requireDate("x") throws BAD_DATE', '- requireDate("x") rejects with BAD_DATE'), files);
  assert.match(rej!.content, /test\("Christmas is closed", async \(\) => \{/);
  assert.match(rej!.content, /await assert\.rejects\(async \(\) => requireDate\("x"\), \/BAD_DATE\/\);/);
  assert.ok(exportedValues("src/cal.ts", CAL).has("exportedInternal"));
});

test("engine: a task written with backticks reads the same after Job A's issue-text cleaning", () => {
  const ticked = TASK.replace("sessionKind in src/cal.ts:", "`sessionKind` in `src/cal.ts`:").replace('- sessionKind("2026-12-25") is "CLOSED"', '- `sessionKind("2026-12-25")` is "CLOSED"').replace("throws BAD_DATE", "throws `BAD_DATE`");
  const cleaned = cleanIssueText({ title: "[test] t", body: ticked });
  assert.match(cleaned, /src\/cal\.ts :/, "cleaning leaves a space before the colon");
  assert.equal(applyRule(spec(), cleaned, files)?.content, applyRule(spec(), TASK, files)?.content);
});

test("engine: refuses anything not made only of task names, target exports and literals", () => {
  const no = (task: string, f = files, s = spec()) => assert.equal(applyRule(s, task, f), null, task);
  no(TASK.replace(`Fix: ${FIX}`, ""));                                              // no fix commit
  no(`${TASK}\nFix: ${"b".repeat(40)}`);                                          // two fix commits
  no(TASK.replace('sessionKind("2026-12-24")', 'internal("2026-12-24")'));         // not exported
  no(TASK.replace('sessionKind("2026-12-24")', "sessionKind(process.env.X)"));     // identifier argument
  no(TASK.replace('sessionKind("2026-12-24")', 'sessionKind("a" + "b")'));         // operator
  no(TASK.replace('sessionKind("2026-12-24")', "sessionKind(`${1}`)"));            // template
  no(TASK.replace('is "NORMAL"', "is NORMAL"));                                    // value not a literal (unreadable bullet)
  no(`${TASK}\n- sessionKind("x") matches /y/`);                                  // unknown check form
  no(TASK.replace("src/cal.ts", "src/missing.ts"));                               // target not in scope
  no(TASK.replace("add a test for sessionKind", "add a test for Kind"));           // type-only name
  no(TASK, [...files, { path: `src/cal.christmas-is-closed-${FIX.slice(0, 7)}.test.ts`, content: "" }]); // path exists
  no(TASK, files, spec({ params: { ...PARAMS, checks: ["equal"] } }));             // throws not learned
  no(TASK, files, spec({ params: { ...PARAMS, maxLines: "4" } }));                 // over the learned size
  const many = [TASK.split("\n")[0]!, ...Array.from({ length: 9 }, (_, i) => `- sessionKind("2026-01-0${i}") is "NORMAL"`), `Fix: ${FIX}`].join("\n");
  no(many);                                                                        // too many checks
  const parse = (t: string) => { const sf = ts.createSourceFile("e.ts", `(${t});`, ts.ScriptTarget.Latest, true); return ((sf.statements[0] as ts.ExpressionStatement).expression as ts.ParenthesizedExpression).expression; };
  assert.equal(checkRoot(parse("a.b(1).c[0]")), "a");
  assert.equal(checkRoot(parse("a?.b")), null);
  assert.equal(checkRoot(parse("(() => 1)()")), null);
  assert.equal(checkRoot(parse("a.b(c)")), null);
  assert.equal(parseTestTask(TEST_TRIGGER, "set x to 1"), null);
  assert.equal(buildTestEdit(PARAMS, parseTestTask(TEST_TRIGGER, TASK)!, files)?.path.endsWith(".test.ts"), true);
});

test("nl parse: the test trigger is canonical but refused as RULE_NOT_APPROVED until its kind is approved", () => {
  const off = parseTask({ title: "", body: TASK }, { model: null, approvedKinds: new Set() });
  assert.deepEqual(off, { status: "unsure", reason: "RULE_NOT_APPROVED", hint: null });
  const on = parseTask({ title: "", body: TASK }, { model: null, approvedKinds: new Set(["ADD_TEST_CASE"]) });
  assert.equal(on.status, "canonical");
});

// ---- Job A: the approval gate

function fakeKernel(dir: string): string {
  const file = join(dir, "fake-kernel.cjs");
  writeFileSync(file, `const crypto = require("node:crypto");
exports.NATIVE_CODE_SYNTHESIS_PROTOCOL_VERSION = "x";
exports.sourceFingerprint = (p, c) => crypto.createHash("sha256").update(p + "\\0" + c).digest("hex");
exports.PeaceAINativeCodeSynthesizer = class { synthesize() { return { status: "INSUFFICIENT" }; } };
exports.parsePlanSteps = () => null;
`);
  return file;
}
const entry = (sha: string) => ({
  id: "public-test-case-v1", sha256: sha, source: "workspace",
  approval: { url: "https://github.com/PeaceG03/PeaceAI-Workspace/issues/40#issuecomment-123", commentId: 123, issue: 40, repo: "PeaceG03/PeaceAI-Workspace", author: "PeaceG03", approvedAt: "2026-10-11T00:00:00Z" },
});
function runJobA(mode: "empty" | "approved" | "hash-changed", body = TASK, nl = "off") {
  const dir = scratch();
  const ws = join(dir, "ws");
  mkdirSync(join(ws, "src"), { recursive: true });
  writeFileSync(join(ws, "src/cal.ts"), CAL);
  git(ws, "init", "-q"); git(ws, "add", "-A"); git(ws, "commit", "-qm", "base");
  const rules = join(dir, "rules");
  mkdirSync(rules);
  writeFileSync(join(rules, "public-test-case-v1.json"), JSON.stringify(spec()));
  const list = join(dir, "approved.json");
  const sha = mode === "hash-changed" ? specHash(spec({ params: { ...PARAMS, maxLines: "12" } })) : specHash(spec());
  writeFileSync(list, JSON.stringify({ schema: APPROVED_SCHEMA, rules: mode === "empty" ? [] : [entry(sha)] }));
  const out = join(dir, "out");
  const r = spawnSync(tsx, [join(repo, "peaceai/bin/generate.ts")], {
    cwd: repo, encoding: "utf8",
    env: { ...process.env, PEACEAI_NL_PARSE: nl, PEACEAI_KERNEL_BUNDLE: fakeKernel(dir), PEACEAI_OUT_DIR: out, PEACEAI_WORKSPACE_DIR: ws, PEACEAI_TARGET: "PeaceG03/PeaceAI-Workspace", ISSUE_NUMBER: "9", ISSUE_TITLE: "[test] learned test", ISSUE_BODY: body, PEACEAI_RULES_DIR: rules, PEACEAI_APPROVED_LIST: list },
  });
  const summary = existsSync(join(out, "summary.json")) ? JSON.parse(readFileSync(join(out, "summary.json"), "utf8")) : null;
  const diff = summary?.candidates[0] ? readFileSync(join(out, summary.candidates[0].file), "utf8") : "";
  rmSync(dir, { recursive: true, force: true });
  return { r, summary, diff };
}

test("Job A: an UNAPPROVED (or hash-changed) test rule gives 0 candidates", () => {
  for (const [mode, why] of [["empty", "NOT_APPROVED"], ["hash-changed", "HASH_CHANGED"]] as const) {
    const { r, summary } = runJobA(mode);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, new RegExp(`learned admission rules=1 approved=0 refused=public-test-case-v1:${why}`));
    assert.match(r.stdout, new RegExp(`learned rules=1 approved=0 candidates=0 refused=public-test-case-v1:${why}`));
    assert.equal(summary.candidates.length, 0);
  }
  // With the parser on (production default), the unapproved trigger is refused before generation.
  const nl = runJobA("empty", TASK, "on");
  assert.match(nl.r.stdout, /learned admission rules=1 approved=0 refused=public-test-case-v1:NOT_APPROVED/);
  assert.match(nl.r.stdout, /nl=unsure reason=RULE_NOT_APPROVED/);
  assert.equal(nl.summary.candidates.length, 0);
});

test("Job A: an approved test rule creates one new test file, carries the fix commit, and the summary validates", () => {
  const { r, summary, diff } = runJobA("approved");
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /learned rules=1 approved=1 candidates=1/);
  assert.equal(summary.candidates.length, 1);
  assert.deepEqual(summary.candidates[0].transformations, ["LEARNED_ADD_TEST_CASE"]);
  assert.equal(summary.candidates[0].operationId, `learned:public-test-case-v1@${specHash(spec())}`);
  assert.equal(summary.candidates[0].fixSha, FIX);
  const ctx = { learned: new Map([["public-test-case-v1", specHash(spec())]]), lmModels: new Set<string>() };
  assert.ok(validateSummary(summary, ctx), "Job A's gate, Job B, B2, C and the review accept it while its hash is pinned");
  assert.equal(validateSummary(summary), false, "and refuse it with no approved list");
  const parsed = parseDiff(diff);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0]!.isNew, true);
  assert.deepEqual(checkCandidateScope(parsed, new Set(["src/cal.ts"]), WORKSPACE_SCOPE), []);
  assert.equal(validateSummary({ ...summary, candidates: [{ ...summary.candidates[0], fixSha: "nothex" }] }, ctx), false);
  assert.equal(validateSummary({ ...summary, candidates: [{ ...summary.candidates[0], operationId: "learned:../x" }] }, ctx), false);
});

test("gate: learned:<id> is accepted ONLY for an id pinned in approved.json with that exact hash; lm-fill only for a bound model id", () => {
  const dir = scratch();
  try {
    const sha = specHash(spec());
    const list = join(dir, "approved.json");
    writeFileSync(list, JSON.stringify({ schema: APPROVED_SCHEMA, rules: [entry(sha)] }));
    const ctx = loadSummaryContext(list);
    const ok = (id: unknown, c = ctx) => operationIdAllowed(id, c);
    assert.equal(ok(`learned:public-test-case-v1@${sha}`), true, "approved id + pinned hash");
    assert.equal(ok(`learned:public-unknown-v1@${sha}`), false, "unknown id");
    assert.equal(ok(`learned:public-test-case-v1@${"0".repeat(64)}`), false, "known id, wrong hash");
    assert.equal(ok(`learned:public-test-case-v1@${specHash(spec({ params: { ...PARAMS, maxLines: "12" } }))}`), false, "hash of a changed spec");
    assert.equal(ok("learned:public-test-case-v1"), false, "prefix + id without a hash");
    assert.equal(ok(`learned:public-test-case-v1@${sha}`, NO_CLAIMS), false, "no approved list");
    assert.equal(ok(`learned:public-test-case-v1@${sha}`, loadSummaryContext(join(dir, "missing.json"))), false, "missing list");
    writeFileSync(join(dir, "corrupt.json"), "{");
    assert.equal(ok(`learned:public-test-case-v1@${sha}`, loadSummaryContext(join(dir, "corrupt.json"))), false, "corrupt list");
    assert.equal(ok("SET_LITERAL"), true, "kernel ids unchanged");
    assert.equal(ok(null), true);
    // lm-fill: never by prefix; only the exact verified model id the caller binds. The jobs bind none.
    const model = "lm-v1-0123456789ab";
    assert.equal(ok(`lm-fill:${model}`), false, "lm-fill with no bound model");
    const lm = { learned: new Map<string, string>(), lmModels: new Set([model]) };
    assert.equal(ok(`lm-fill:${model}`, lm), true, "bound model id");
    assert.equal(ok("lm-fill:lm-v1-ffffffffffff", lm), false, "another model id");
    assert.equal(ok("lm-fill:", lm), false);
    assert.equal(loadSummaryContext(list).lmModels.size, 0);
    // The real list: every pinned rule is accepted with its own hash and with no other.
    const real = loadSummaryContext(join(repo, "peaceai/rules/approved.json"));
    for (const r of JSON.parse(readFileSync(join(repo, "peaceai/rules/approved.json"), "utf8")).rules) {
      assert.equal(ok(`learned:${r.id}@${r.sha256}`, real), true, r.id);
      assert.equal(ok(`learned:${r.id}@${"f".repeat(64)}`, real), false, r.id);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("Fix: <sha> is validated before any revert: full 40-hex, on the target's main, and only source files reverted", () => {
  const dir = scratch();
  try {
    const ws = join(dir, "t");
    mkdirSync(join(ws, "src"), { recursive: true });
    const commit = (files: Record<string, string>, msg: string) => {
      for (const [p, c] of Object.entries(files)) { mkdirSync(join(ws, p, ".."), { recursive: true }); writeFileSync(join(ws, p), c); }
      git(ws, "add", "-A"); git(ws, "commit", "-qm", msg);
      return git(ws, "rev-parse", "HEAD").trim();
    };
    git(ws, "init", "-q", "-b", "main");
    commit({ "src/cal.ts": BUGGY }, "base");
    const valid = commit({ "src/cal.ts": FIXED, "src/cal.test.ts": "// test\n", "docs/NOTES.md": "x\n" }, "fix with its test and a note");
    const ci = commit({ "src/cal.ts": FIXED + "// a\n", ".github/workflows/ci.yml": "on: push\n" }, "fix + workflow");
    const pkg = commit({ "src/cal.ts": FIXED + "// b\n", "package.json": "{}\n" }, "fix + config");
    const scr = commit({ "src/cal.ts": FIXED + "// c\n", "scripts/release.ts": "x\n" }, "fix + script");
    const base = git(ws, "rev-parse", "HEAD").trim();
    git(ws, "checkout", "-q", "-b", "side");
    const branchOnly = commit({ "src/cal.ts": FIXED + "// side\n" }, "branch-only fix");
    git(ws, "checkout", "-q", "main");
    const other = join(dir, "o");
    mkdirSync(other);
    git(other, "init", "-q", "-b", "main");
    writeFileSync(join(other, "x.ts"), "export const x = 1;\n");
    git(other, "add", "-A"); git(other, "commit", "-qm", "foreign");
    const foreign = git(other, "rev-parse", "HEAD").trim();
    const run = (...a: string[]) => { try { return git(ws, ...a); } catch { return null; } };
    const v = (sha: string, b = base) => validateFix(sha, b, run, WORKSPACE_SCOPE);
    assert.deepEqual(v(valid), { ok: true, paths: ["src/cal.ts"] }, "valid fix: only its non-test source is reverted");
    assert.deepEqual(v(foreign), { ok: false, reason: "fix-invalid" }, "a SHA from another repo");
    assert.deepEqual(v(branchOnly, branchOnly), { ok: false, reason: "fix-not-on-main" }, "a branch-only commit (even when it is the base)");
    assert.deepEqual(v(ci), { ok: false, reason: "fix-touches-non-source" }, "a fix touching .github/");
    assert.deepEqual(v(pkg), { ok: false, reason: "fix-touches-non-source" }, "a fix touching a config");
    assert.deepEqual(v(scr), { ok: false, reason: "fix-touches-non-source" }, "a fix touching a script");
    assert.deepEqual(v(valid.slice(0, 7)), { ok: false, reason: "fix-invalid" }, "short sha");
    assert.deepEqual(v(valid.toUpperCase()), { ok: false, reason: "fix-invalid" });
    assert.deepEqual(v("HEAD~1"), { ok: false, reason: "fix-invalid" });
    const root = git(ws, "rev-list", "--max-parents=0", "HEAD").trim();
    assert.deepEqual(v(root), { ok: false, reason: "fix-invalid" }, "a root commit has nothing to revert to");
    assert.deepEqual(v(base, valid), { ok: false, reason: "fix-not-ancestor" }, "a fix newer than the task base");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ---- Job B: grading in the tamper-proof harness

const BUGGY = 'export function sessionKind(date: string): "NORMAL" | "CLOSED" {\n  return date === "2026-12-24" ? "CLOSED" : "NORMAL";\n}\n';
const FIXED = 'export function sessionKind(date: string): "NORMAL" | "CLOSED" {\n  return date === "2026-12-25" ? "CLOSED" : "NORMAL";\n}\n';
const TSCONFIG = JSON.stringify({ compilerOptions: { target: "ES2022", module: "ESNext", moduleResolution: "Bundler", strict: true, noEmit: true, skipLibCheck: true, allowImportingTsExtensions: true, types: ["node"] }, include: ["src/**/*.ts"] });
const caseFile = (checks: string[]) => ['import assert from "node:assert/strict";', 'import test from "node:test";', 'import { sessionKind } from "./cal";', "", 'test("t", () => {', ...checks, "});", ""].join("\n");

function gradeFixture() {
  const dir = scratch();
  const ws = join(dir, "ws");
  mkdirSync(join(ws, "src"), { recursive: true });
  writeFileSync(join(ws, "src/cal.ts"), BUGGY);
  writeFileSync(join(ws, "src/base.test.ts"), 'import test from "node:test";\ntest("base", () => {});\n');
  writeFileSync(join(ws, "tsconfig.json"), TSCONFIG);
  writeFileSync(join(ws, ".gitignore"), "node_modules\n");
  symlinkSync(join(repo, "node_modules"), join(ws, "node_modules"));
  git(ws, "init", "-q", "-b", "main"); git(ws, "add", "-A"); git(ws, "commit", "-qm", "buggy");
  writeFileSync(join(ws, "src/cal.ts"), FIXED);
  git(ws, "add", "-A"); git(ws, "commit", "-qm", "fix");
  const fixSha = git(ws, "rev-parse", "HEAD").trim();
  writeFileSync(join(ws, "README.md"), "later\n");
  git(ws, "add", "-A"); git(ws, "commit", "-qm", "later");
  const baseSha = git(ws, "rev-parse", "HEAD").trim();
  const newTest = (name: string, content: string) => {
    writeFileSync(join(ws, name), content);
    git(ws, "add", "-N", "--", name);
    const d = git(ws, "diff", "--no-color", "--full-index", "--no-renames");
    git(ws, "reset", "-q", "--hard"); git(ws, "clean", "-fdq");
    return d;
  };
  return { dir, ws, fixSha, baseSha, newTest };
}
function runGrading(fx: ReturnType<typeof gradeFixture>, cands: { diff: string; fixSha?: string }[]) {
  const inDir = join(fx.dir, "in");
  mkdirSync(join(inDir, "candidates"), { recursive: true });
  const candidates = cands.map((c, i) => {
    writeFileSync(join(inDir, "candidates", `candidate-${i + 1}.diff`), c.diff);
    return { id: `candidate-${i + 1}`, file: `candidates/candidate-${i + 1}.diff`, transformations: ["LEARNED_ADD_TEST_CASE"], operationId: null, diffBytes: c.diff.length, diffLines: 5, ...(c.fixSha ? { fixSha: c.fixSha } : {}) };
  });
  const summary = { schema: "peaceai-workspace-candidates:v1", taskId: "workspace-issue-9", baseSha: fx.baseSha, candidates };
  writeFileSync(join(inDir, "summary.json"), JSON.stringify(summary));
  const resultsFile = join(fx.dir, "out", "results.json");
  mkdirSync(join(fx.dir, "out"), { recursive: true });
  const r = spawnSync(tsx, [join(repo, "peaceai/bin/test-candidates.ts")], {
    cwd: repo, encoding: "utf8",
    env: { ...process.env, PEACEAI_IN_DIR: inDir, PEACEAI_RESULTS_FILE: resultsFile, PEACEAI_WORKSPACE_DIR: fx.ws, PEACEAI_TARGET: "PeaceG03/PeaceAI-Workspace", PEACEAI_SANDBOX_USER: "", PEACEAI_REQUIRE_SANDBOX: "" },
  });
  assert.equal(r.status, 0, r.stderr);
  const results = JSON.parse(readFileSync(resultsFile, "utf8"));
  assert.ok(validateResults(results));
  return { results: results.results, summary, stdout: r.stdout };
}

test("Job B: a learned test counts only if it passes on the fixed code AND fails on the code before the fix", () => {
  const fx = gradeFixture();
  try {
    const good = fx.newTest("src/cal.good.test.ts", caseFile(['  assert.equal(sessionKind("2026-12-25"), "CLOSED");']));
    const both = fx.newTest("src/cal.both.test.ts", caseFile(['  assert.equal(sessionKind("2026-07-01"), "NORMAL");']));
    const never = fx.newTest("src/cal.never.test.ts", caseFile(['  assert.equal(sessionKind("2026-07-01"), "CLOSED");']));
    const before = fx.newTest("src/cal.before.test.ts", caseFile(['  assert.equal(sessionKind("2026-12-24"), "CLOSED");']));
    const { results, summary, stdout } = runGrading(fx, [
      { diff: good, fixSha: fx.fixSha }, { diff: both, fixSha: fx.fixSha }, { diff: never, fixSha: fx.fixSha }, { diff: before, fixSha: fx.fixSha }, { diff: good, fixSha: "f".repeat(40) },
    ]);
    const g = (i: number) => results[i].testGrading;
    assert.deepEqual(g(0), { fixSha: fx.fixSha, afterFix: true, beforeFix: false, verdict: "COUNTS", reason: null });
    assert.deepEqual(g(1), { fixSha: fx.fixSha, afterFix: true, beforeFix: true, verdict: "REJECTED_PASSES_BOTH", reason: null });
    assert.deepEqual(g(2), { fixSha: fx.fixSha, afterFix: false, beforeFix: false, verdict: "REJECTED_FAILS_BOTH", reason: null });
    assert.deepEqual(g(3), { fixSha: fx.fixSha, afterFix: false, beforeFix: true, verdict: "REJECTED_FAILS_AFTER_FIX", reason: null });
    assert.equal(g(4)!.verdict, "UNGRADABLE");
    assert.equal(g(4)!.reason, "fix-invalid", "a sha that is not a commit in the target is refused before any revert");
    assert.match(stdout, /candidate-1 .* grading=COUNTS after_fix=true before_fix=false/);
    // Results: only the COUNTS candidate is eligible; the grading is recorded on each learned candidate.
    const rec = buildRecords({ issue: 9, runId: "1", recordedAt: "2026-10-11T00:00:00Z", baseSha: fx.baseSha, title: "[test] t", body: "add a test for sessionKind in src/cal.ts" }, summary.candidates, results, "seed");
    assert.deepEqual(rec.ranking.candidates.map((c) => [c.id, c.eligible, c.rejectReason, c.testGrading?.verdict]), [
      ["candidate-1", true, null, "COUNTS"],
      ["candidate-2", false, "test-grading", "REJECTED_PASSES_BOTH"],
      ["candidate-3", false, "new-tests", "REJECTED_FAILS_BOTH"],
      ["candidate-4", false, "new-tests", "REJECTED_FAILS_AFTER_FIX"],
      ["candidate-5", false, "test-grading", "UNGRADABLE"],
    ]);
  } finally { rmSync(fx.dir, { recursive: true, force: true }); }
});

test("Job B: a learned candidate that edits source (not test-only) or a fix with no source change is UNGRADABLE", () => {
  const fx = gradeFixture();
  try {
    writeFileSync(join(fx.ws, "src/cal.x.test.ts"), caseFile(['  assert.equal(sessionKind("2026-12-25"), "CLOSED");']));
    writeFileSync(join(fx.ws, "src/cal.ts"), FIXED + "export const extra = 1;\n");
    git(fx.ws, "add", "-N", "--", "src/cal.x.test.ts");
    const mixed = git(fx.ws, "diff", "--no-color", "--full-index", "--no-renames");
    git(fx.ws, "reset", "-q", "--hard"); git(fx.ws, "clean", "-fdq");
    const docsOnly = git(fx.ws, "rev-parse", "HEAD").trim(); // the "later" commit changes README only
    const good = fx.newTest("src/cal.good.test.ts", caseFile(['  assert.equal(sessionKind("2026-12-25"), "CLOSED");']));
    const { results } = runGrading(fx, [{ diff: mixed, fixSha: fx.fixSha }, { diff: good, fixSha: docsOnly }]);
    assert.deepEqual([results[0]!.testGrading!.reason, results[1]!.testGrading!.reason], ["not-test-only", "no-source-change"]);
  } finally { rmSync(fx.dir, { recursive: true, force: true }); }
});

test("Results: grading records validate strictly; missing or mismatched grading is a rejection", () => {
  const ok = { fixSha: FIX, afterFix: true, beforeFix: false, verdict: "COUNTS", reason: null };
  assert.ok(validTestGrading(ok));
  assert.equal(validTestGrading({ ...ok, verdict: "REJECTED_PASSES_BOTH" }), false, "verdict must follow from the two runs");
  assert.equal(validTestGrading({ ...ok, extra: 1 }), false);
  assert.equal(validTestGrading({ ...ok, beforeFix: null, verdict: "UNGRADABLE", reason: "made-up" }), false);
  assert.deepEqual([gradingVerdict(true, false), gradingVerdict(true, true), gradingVerdict(false, false), gradingVerdict(false, true)], ["COUNTS", "REJECTED_PASSES_BOTH", "REJECTED_FAILS_BOTH", "REJECTED_FAILS_AFTER_FIX"]);
  const r = { id: "candidate-1", diffBytes: 1, diffLines: 1, applied: true, typecheckPassed: true, originalSuitePassed: true, newTestsPassed: true, newTestFiles: 1 };
  assert.equal(gradingReject({ fixSha: FIX }, r), "test-grading", "no grading recorded");
  assert.equal(gradingReject({ fixSha: FIX }, { ...r, testGrading: { ...ok, fixSha: "b".repeat(40) } as never }), "test-grading", "graded against another commit");
  assert.equal(gradingReject({ fixSha: FIX }, { ...r, testGrading: ok as never }), null);
  assert.equal(gradingReject({}, r), null, "non-learned candidates are unaffected");
});

// ---- gates and protected set

test("gates unchanged: a learned test cannot edit an existing test, and core text / personal info in it are refused", () => {
  const edit = applyRule(spec(), TASK, files)!;
  const asExisting = `diff --git a/src/cal.test.ts b/src/cal.test.ts\nindex 1111111..2222222 100644\n--- a/src/cal.test.ts\n+++ b/src/cal.test.ts\n@@ -1 +1,2 @@\n x\n+${edit.content.split("\n")[0]}\n`;
  assert.ok(checkCandidateScope(parseDiff(asExisting), new Set(["src/cal.ts", "src/cal.test.ts"]), WORKSPACE_SCOPE).length > 0);
  const coreLine = "  assert.equal(computeTheVerySpecificInternalThing(alpha, beta), 42);";
  const core = { text: emptyIndex(), paths: new Set<string>(), basenames: new Set<string>() };
  addText(core.text, `${coreLine}\n`);
  const created = `diff --git a/src/cal.n.test.ts b/src/cal.n.test.ts\nnew file mode 100644\nindex 0000000..1111111\n--- /dev/null\n+++ b/src/cal.n.test.ts\n@@ -0,0 +1,2 @@\n+${coreLine}\n+// mail ${["someone", "gmail.com"].join("@")}\n`;
  const res = gateCandidate(created, new Set(["src/cal.ts"]), emptyIndex(), core, WORKSPACE_SCOPE);
  assert.equal(res.ok, false);
  assert.ok(res.reasons.some((x) => x.startsWith("core-text")) && res.reasons.some((x) => x.startsWith("personal-info")), res.reasons.join("; "));
});

test("protected set: pinned entries (now incl. learned-test.ts and minetest.ts) still cover the rule engine, gates, results, rules and workflows", () => {
  const digest = createHash("sha256").update(PROTECTED_SELF.map((p) => `/${p.pattern.source}/${p.pattern.flags}`).join("\n")).digest("hex");
  assert.equal(digest, PROTECTED_DIGEST, "PROTECTED_SELF changed");
  for (const p of ["peaceai/lib/learned.ts", "peaceai/lib/learned-test.ts", "peaceai/lib/minetest.ts", "peaceai/lib/gate.ts", "peaceai/lib/results.ts", "peaceai/lib/diff.ts", "peaceai/bin/test-candidates.ts", "peaceai/rules/learned/public-test-case-v1.json", "peaceai/rules/approved.json", ".github/workflows/peace-task.yml", ".github/workflows/corpus-checks.yml", "peaceai/test/m12-test-rule.test.ts", "peaceai/test/m42-prepush-reach.test.ts", "src/cal.test.ts"])
    assert.ok(protectedReason(p), p);
});
const PROTECTED_DIGEST = "56a15abb8d7808e74d6f62fa0c34e55a42ca88393f3c90a8016b0d726c781550"; // M119 (rounds 4-5, unmerged #544): + one entry protecting peaceai/lib/credit-line-allowlist.json (the 80 genuine whole credit lines), add-only (was 48357196...). M114: + lib/derive-string.ts in the M99 entry (the v5 string-parser engine learned-derive.ts imports), add-only. M117 (Auditor #512/#527 note, Peace-authorized stage-2 work): the existing-tests entry drops /i so its peaceai/self-tests/ exemption is lowercase-only, with .test.ts spelled case-insensitively; tighten-only (m110), no entry added or removed (was 6bf03fbd...). M113: + lib/derive-list.ts in the M99 entry (the v4 list engine learned-derive.ts imports; closure test m96); nothing removed. M110 (Auditor #509 note 1): every PROTECTED_SELF pattern is case-insensitive (/i) and the digest now covers source AND flags, so dropping a flag also changes it; no entry added or removed. M106 stage-1 re-pin (Peace, 2026-10-25 09:32 MT "Yes on all 4 go ahead"): + .env anywhere, any approved.json, peaceai/read-only-ops.json, peaceai/results-repo/ (the STAGE1_GAPS the M106 cross-check found). M101 (Peace, 2026-10-23): + lib/derive-family-census.ts (the census bin's lib; closure test 1117). M100: + derive-practice.yml (checks only), its families manifest, derive-practice lib/kinds and bins. M99 (merged after M98): + derive-from-behavior engine, rule, spec doc, proofs, evidence, fixtures, learned spec and proposal record. M98: + learned-edit-existing.ts engine and the existing-function-edit-v1 spec doc, proofs, evidence, fixtures, learned spec and proposal record. M97: + test-case-existing-v7 spec doc, proofs, evidence, fixtures, learned spec and proposal record. M96: + the lib import closure of the protected tools (patch, self-zone, queue and 20 more) and kernel-guard.ts. M95: + the workflow TypeScript tools (pr-guard, verdict-patch, parse-verdict, target-check and 8 more). M94: + every peaceai/bin/*.sh (job scripts on the trusted runner). M93: + test-case-existing-v6 spec doc, proofs, evidence, fixtures, learned spec and proposal record. M91: + test-case-existing-v5 spec doc, proofs, evidence, fixtures, learned spec and proposal record. M90: + test-case-existing-v4 spec doc, proofs, evidence, fixtures, learned spec and proposal record. M88: + test-case-existing-v3 spec doc, proofs, evidence, fixtures, learned spec and proposal record. M85: + complex-calls-v1, test-case-existing-v2 and replace-expression-v2 spec docs, tests, evidence, fixtures, learned specs and proposal records. M80: + TEST_CASE_EXISTING engine, spec, evidence, fixtures, learned spec, proposal record and proofs. stacked landing: + lib/stacked.ts in the M16 entry. #286 follow-up: + bin/await-held-runs.sh in the approval-tools entry. carry-forward: + lib/carry.ts, bin/carry-check.ts, bin/carry-verdict.ts in the M18 entry. M67: + un-drop batch kinds (workflow-job, tsconfig-script, env-fix, loop-function-v2) and their proofs. M66: + IMPORT_EDIT v2 learned spec and wiring proofs (m66-import-edit-v2-wiring.test.ts). M49 BLOCKING (1): + ft-core gate. M65: + LOOP_FUNCTION wiring proofs
