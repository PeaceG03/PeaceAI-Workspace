// M13: the throw-guard learned edit type (ADD_THROW_GUARD). The miner's THROW_GUARD shape, the proposal and
// its spec checks, the engine and its refusals (condition vocabulary, unique exported function, new code),
// Job A's approval gate (unapproved: 0 candidates), the Job B self-grading (the new test must pass with the
// guard AND fail with the candidate's own source edit taken back out), and the Results rejection.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import ts from "typescript";
import { APPROVED_SCHEMA } from "../lib/approved.ts";
import { parseDiff } from "../lib/diff.ts";
import { validateSummary } from "../lib/gate.ts";
import { applyRule, specHash, validateSpec, type RuleSpec } from "../lib/learned.ts";
import { buildGuardEdit, GUARD_TRIGGER, parseGuardTask, safeCondition } from "../lib/learned-guard.ts";
import { observeFile, parseHunks, tally, type ShapeStats } from "../lib/mine.ts";
import { PEACE_AUTHOR } from "../lib/minetest.ts";
import { parseTask } from "../lib/nlparse.ts";
import { proposalBody, proposeRules } from "../lib/propose.ts";
import { buildRecords, gradingReject } from "../lib/records.ts";
import { validateResults } from "../lib/results.ts";
import { checkCandidateScope, WORKSPACE_SCOPE } from "../lib/scope.ts";
import { cleanIssueText } from "../lib/taskmap.ts";

const repo = resolve(import.meta.dirname, "..", "..");
const tsx = join(repo, "node_modules/.bin/tsx");
const scratch = () => mkdtempSync(join(tmpdir(), "m13-"));
const git = (cwd: string, ...a: string[]) => execFileSync("git", ["-c", "user.name=PeaceG03", "-c", `user.email=${PEACE_AUTHOR}`, ...a], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

const PARAMS = { braces: "none", error: "Error", grading: "self-fail-before-pass-after", lines: "one", message: "code-only", placement: "function-entry", test: "new-file" };
const spec = (over: Partial<RuleSpec> = {}): RuleSpec => ({
  schema: "peaceai-learned-rule:v1", id: "public-throw-guard-v1", kind: "ADD_THROW_GUARD", minedFrom: "public", minerVersion: "peaceai-miner:v1", shape: "THROW_GUARD",
  trigger: GUARD_TRIGGER, params: { ...PARAMS }, evidence: { hunks: 27, commits: 20, files: 15, repos: ["PeaceG03/PeaceAI-Workspace", "PeaceG03/PeaceSTOCKS"] }, ...over,
});
const LIB = [
  "export function scale(value: number, factor: number): number {",
  "  if (factor === 0) throw new Error(\"ZERO_FACTOR\");",
  "  return value * factor;",
  "}",
  "export const label = (name: string, max: number): string => {",
  "  return name.slice(0, max);",
  "};",
  "function hidden(x: number): number {",
  "  return x;",
  "}",
  "export { hidden as shown };",
  "",
].join("\n");
const TASK = [
  "guard `scale` in `src/lib.ts`: throw NOT_FINITE when !Number.isFinite(value) || 1e9 < value",
  "- `scale(2e9, 2)` throws NOT_FINITE",
  "- `scale(2, 3)` is 6",
].join("\n");
const files = (content = LIB) => [{ path: "src/lib.ts", content }];

test("spec: the committed public-throw-guard-v1 file validates and hashes to its canonical JSON", () => {
  const raw = readFileSync(join(repo, "peaceai/rules/learned/public-throw-guard-v1.json"), "utf8");
  const s = JSON.parse(raw);
  assert.ok(validateSpec(s));
  assert.equal(specHash(s), "bec9151e12edf04cc5e3aede2d9d04d0f452189de769d0a14e34756b247231f3");
  assert.equal(s.trigger, GUARD_TRIGGER);
  assert.ok(validateSpec(spec()));
  assert.equal(validateSpec(spec({ minedFrom: "core", id: "core-throw-guard-v1" })), false, "public-mined only");
  assert.equal(validateSpec(spec({ params: { ...PARAMS, message: "code-detail" } })), false, "fixed vocabulary");
  assert.equal(validateSpec(spec({ params: { ...PARAMS, extra: "x" } })), false, "exact keys");
  const { placement: _drop, ...missing } = PARAMS;
  assert.equal(validateSpec(spec({ params: missing })), false);
});

test("miner: an added `if (c) throw new Error(\"CODE\")` is a THROW_GUARD (uncovered); a return guard stays GUARD_CLAUSE", () => {
  const pre = "export function f(a: number): number {\n  return a;\n}\n";
  const post = "export function f(a: number): number {\n  if (a < 0) throw new Error(\"NEG\");\n  if (a === 0) return 0;\n  return a;\n}\n";
  const hunks = parseHunks("@@ -1,0 +2,2 @@\n+  if (a < 0) throw new Error(\"NEG\");\n+  if (a === 0) return 0;\n");
  void pre;
  const obs = observeFile("R@1", "src/f.ts", post, hunks);
  const shapes = obs.map((o) => o.shape).sort();
  assert.deepEqual(shapes, ["GUARD_CLAUSE", "THROW_GUARD"]);
  const t = obs.find((o) => o.shape === "THROW_GUARD")!;
  assert.deepEqual(t.style, { braces: "none", error: "Error", lines: "one", message: "code-only", placement: "function-entry" });
  assert.equal(tally(obs).find((s) => s.shape === "THROW_GUARD")!.covered, null);
});

const stats = (over: Partial<ShapeStats["styles"]> = {}): ShapeStats => ({
  shape: "THROW_GUARD", covered: null, hunks: 27, commits: 20, files: 15, examples: [{ commit: "PeaceSTOCKS@abc1234", path: "src/a.ts", line: 3 }],
  styles: { braces: { block: 1, none: 26 }, error: { Error: 26, other: 1 }, lines: { multi: 11, one: 16 }, message: { "code-detail": 5, "code-only": 10, none: 1, other: 11 }, placement: { "function-body": 12, "function-entry": 5, nested: 10 }, ...over },
});
test("proposal: learned from public evidence only; the rendered params are the majority form with enough support", () => {
  const { proposals } = proposeRules([stats()], "public", ["PeaceG03/PeaceSTOCKS", "PeaceG03/PeaceAI-Workspace"]);
  assert.equal(proposals.length, 1);
  assert.deepEqual(proposals[0]!.spec, spec());
  assert.equal(proposals[0]!.sha256, specHash(spec()));
  assert.equal(proposeRules([stats()], "core", ["PeaceG03/PeaceAI"]).proposals.length, 0, "never core-mined");
  assert.equal(proposeRules([stats({ placement: { "function-body": 20, "function-entry": 1 } })], "public", ["x"]).proposals.length, 0, "entry placement needs support");
  assert.equal(proposeRules([stats({ message: { "code-detail": 9, "code-only": 3 } })], "public", ["x"]).proposals.length, 0, "message majority must be code-only");
  const body = proposalBody(proposals[0]!, [{ label: "PeaceSTOCKS@abc1234 src/a.ts:3", url: "https://github.com/PeaceG03/PeaceSTOCKS/commit/abc1234" }]);
  assert.match(body, /guard `functionName` in `src\/file\.ts`: throw CODE when CONDITION/);
  assert.match(body, /FAIL with the guard's source edit taken back out/);
  assert.doesNotMatch(body, /throw new Error\("NEG/);
});

test("engine: inserts one guard line at the function entry (after existing guards) and writes one new test file", () => {
  const edit = applyRule(spec(), TASK, files(), (p) => /\.test\.ts$/.test(p))!;
  assert.ok(edit);
  assert.equal(edit.selfGrade, true);
  assert.equal(edit.path, "src/lib.ts");
  assert.equal(edit.content, LIB.replace("  return value * factor;", "  if (!Number.isFinite(value) || 1e9 < value) throw new Error(\"NOT_FINITE\");\n  return value * factor;"));
  assert.equal(edit.extra!.length, 1);
  const t = edit.extra![0]!;
  assert.match(t.path, /^src\/lib\.scale-throws-not-finite-[0-9a-f]{7}\.test\.ts$/);
  assert.match(t.content, /assert\.throws\(\(\) => scale\(2e9, 2\), \/NOT_FINITE\/\);/);
  assert.match(t.content, /assert\.equal\(scale\(2, 3\), 6\);/);
  assert.match(t.content, /import \{ scale \} from "\.\/lib";/);
  // Arrow function with no guards yet; cleaned issue text (backticks removed) reads the same.
  const arrow = applyRule(spec(), cleanIssueText({ title: "[test] g", body: "guard `label` in `src/lib.ts`: throw BAD_MAX when max < 1 || !Number.isInteger(max)\n- `label(\"ab\", 0)` throws BAD_MAX" }), files())!;
  assert.ok(arrow);
  assert.match(arrow.content, /=> \{\n  if \(max < 1 \|\| !Number\.isInteger\(max\)\) throw new Error\("BAD_MAX"\);\n  return name\.slice/);
});

test("engine refusals: unsafe condition, unknown names, non-exported/ambiguous function, existing code, bad test bullets", () => {
  const no = (task: string, content = LIB) => assert.equal(applyRule(spec(), task, files(content)), null, task);
  const T = (cond: string, call = "- `scale(1, 2)` throws X_CODE") => `guard scale in src/lib.ts: throw X_CODE when ${cond}\n${call}`;
  no(T("process.exit(1)"));
  no(T("value > limit"), LIB); // `limit` is not a parameter
  no(T("value = 1"));
  no(T("fetch(value)"));
  no(T("value > (() => 1)()"));
  no(T("`${value}` === \"1\""));
  no(T("value?.toString === undefined"));
  // Issue cleaning strips ">": the damaged condition is refused, never misread.
  for (const c of ["value > 1", "value >= 1"]) assert.equal(applyRule(spec(), cleanIssueText({ title: "t", body: T(c) }), files()), null, c);
  no(T("value > 1", "- `scale(1, 2)` throws OTHER"), LIB); // test must trip the same code
  no(T("value > 1", "- `scale(1, 2)` is 2"), LIB); // no trip call
  no(T("value > 1", "- `hidden(1)` throws X_CODE"), LIB); // test root must be the guarded function
  no(T("value > 1", "- `scale(other, 2)` throws X_CODE"), LIB); // literal arguments only
  no("guard shown in src/lib.ts: throw X_CODE when x > 1\n- `shown(2)` throws X_CODE"); // re-export only, no local exported function
  no("guard scale in src/lib.ts: throw ZERO_FACTOR when factor < 0\n- `scale(1, -1)` throws ZERO_FACTOR"); // code already in the file
  no("guard scale in src/missing.ts: throw X_CODE when value > 1\n- `scale(2, 1)` throws X_CODE");
  no(T("value > 1") + "\n" + T("value > 2")); // two headers
  assert.equal(buildGuardEdit({ ...PARAMS, placement: "function-body" }, parseGuardTask(GUARD_TRIGGER, TASK)!, files()), null, "params outside the vocabulary");
  const overload = "export function scale(v: number): number;\nexport function scale(v: number): number {\n  return v;\n}\n";
  no("guard scale in src/lib.ts: throw X_CODE when v > 1\n- `scale(2)` throws X_CODE", overload + "export function scale2() {}\n" + "export function scale(v: string): number { return 0; }\n");
});

test("condition vocabulary: only parameters, literals, reads, comparisons, !, &&/||, typeof and pure built-ins", () => {
  const ok = (s: string) => safeCondition((ts.createSourceFile("c.ts", `(${s});`, ts.ScriptTarget.Latest, true).statements[0] as ts.ExpressionStatement).expression, new Set(["a", "b"]));
  for (const s of ["a > 1", "!a", "a.length === 0", "typeof a !== \"string\"", "Array.isArray(b) && b.length > 3", "Number.isNaN(a) || a < -1", "a === null"]) assert.ok(ok(s), s);
  for (const s of ["c > 1", "a + 1 > 2", "a.push(1)", "Math.random() > a", "new Date(a)", "a ? 1 : 2", "delete a.b", "a in b", "void a", "a instanceof b", "Number.isFinite(a, b)"]) assert.equal(ok(s), false, s);
});

test("parser: the guard header is canonical only when approved; refused as RULE_NOT_APPROVED otherwise", () => {
  const on = parseTask({ title: "[test] g", body: TASK }, { model: null, approvedKinds: new Set(["ADD_THROW_GUARD"]) });
  assert.equal(on.status, "canonical");
  const off = parseTask({ title: "[test] g", body: TASK }, { model: null, approvedKinds: new Set() });
  assert.deepEqual(off.status === "unsure" ? off.reason : off.status, "RULE_NOT_APPROVED");
});

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
  id: "public-throw-guard-v1", sha256: sha, source: "workspace",
  approval: { url: "https://github.com/PeaceG03/PeaceAI-Workspace/issues/40#issuecomment-123", commentId: 123, issue: 40, repo: "PeaceG03/PeaceAI-Workspace", author: "PeaceG03", approvedAt: "2026-10-11T00:00:00Z" },
});
function runJobA(mode: "empty" | "approved" | "hash-changed", nl = "off") {
  const dir = scratch();
  const ws = join(dir, "ws");
  mkdirSync(join(ws, "src"), { recursive: true });
  writeFileSync(join(ws, "src/lib.ts"), LIB);
  git(ws, "init", "-q"); git(ws, "add", "-A"); git(ws, "commit", "-qm", "base");
  const rules = join(dir, "rules");
  mkdirSync(rules);
  writeFileSync(join(rules, "public-throw-guard-v1.json"), JSON.stringify(spec()));
  const list = join(dir, "approved.json");
  const sha = mode === "hash-changed" ? specHash(spec({ evidence: { hunks: 1, commits: 1, files: 1, repos: [] } })) : specHash(spec());
  writeFileSync(list, JSON.stringify({ schema: APPROVED_SCHEMA, rules: mode === "empty" ? [] : [entry(sha)] }));
  const out = join(dir, "out");
  const r = spawnSync(tsx, [join(repo, "peaceai/bin/generate.ts")], {
    cwd: repo, encoding: "utf8",
    env: { ...process.env, PEACEAI_NL_PARSE: nl, PEACEAI_KERNEL_BUNDLE: fakeKernel(dir), PEACEAI_OUT_DIR: out, PEACEAI_WORKSPACE_DIR: ws, PEACEAI_TARGET: "PeaceG03/PeaceAI-Workspace", ISSUE_NUMBER: "9", ISSUE_TITLE: "[test] learned guard", ISSUE_BODY: TASK, PEACEAI_RULES_DIR: rules, PEACEAI_APPROVED_LIST: list },
  });
  const summary = existsSync(join(out, "summary.json")) ? JSON.parse(readFileSync(join(out, "summary.json"), "utf8")) : null;
  const diff = summary?.candidates[0] ? readFileSync(join(out, summary.candidates[0].file), "utf8") : "";
  rmSync(dir, { recursive: true, force: true });
  return { r, summary, diff };
}

test("Job A: an UNAPPROVED (or hash-changed) guard rule gives 0 candidates", () => {
  for (const [mode, why] of [["empty", "NOT_APPROVED"], ["hash-changed", "HASH_CHANGED"]] as const) {
    const { r, summary } = runJobA(mode);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, new RegExp(`learned rules=1 approved=0 candidates=0 refused=public-throw-guard-v1:${why}`));
    assert.equal(summary.candidates.length, 0);
  }
  const nl = runJobA("empty", "on");
  assert.match(nl.r.stdout, /nl=unsure reason=RULE_NOT_APPROVED/);
  assert.equal(nl.summary.candidates.length, 0);
});

test("Job A: an approved guard rule edits one source file + creates one test file, marked selfGrade; the summary validates only while pinned", () => {
  const { r, summary, diff } = runJobA("approved");
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /learned rules=1 approved=1 candidates=1/);
  const c = summary.candidates[0];
  assert.deepEqual(c.transformations, ["LEARNED_ADD_THROW_GUARD"]);
  assert.equal(c.operationId, `learned:public-throw-guard-v1@${specHash(spec())}`);
  assert.equal(c.selfGrade, true);
  assert.equal(c.fixSha, undefined);
  const ctx = { learned: new Map([["public-throw-guard-v1", specHash(spec())]]), lmModels: new Set<string>() };
  assert.ok(validateSummary(summary, ctx));
  assert.equal(validateSummary(summary), false);
  assert.equal(validateSummary({ ...summary, candidates: [{ ...c, selfGrade: "yes" }] }, ctx), false);
  assert.equal(validateSummary({ ...summary, candidates: [{ ...c, operationId: "ADD_GUARD_CLAUSE" }] }, ctx), false, "selfGrade only on a learned candidate");
  const parsed = parseDiff(diff);
  assert.deepEqual(parsed.map((f) => [f.newPath === "src/lib.ts", f.isNew]).sort(), [[false, true], [true, false]]);
  assert.deepEqual(checkCandidateScope(parsed, new Set(["src/lib.ts"]), WORKSPACE_SCOPE), []);
});

const TSCONFIG = JSON.stringify({ compilerOptions: { target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext", strict: true, noEmit: true, allowImportingTsExtensions: true }, include: ["src"] });
function gradeFixture() {
  const dir = scratch();
  const ws = join(dir, "ws");
  mkdirSync(join(ws, "src"), { recursive: true });
  writeFileSync(join(ws, "src/lib.ts"), LIB);
  writeFileSync(join(ws, "src/base.test.ts"), 'import test from "node:test";\ntest("base", () => {});\n');
  writeFileSync(join(ws, "tsconfig.json"), TSCONFIG);
  writeFileSync(join(ws, ".gitignore"), "node_modules\n");
  symlinkSync(join(repo, "node_modules"), join(ws, "node_modules"));
  git(ws, "init", "-q", "-b", "main"); git(ws, "add", "-A"); git(ws, "commit", "-qm", "base");
  const baseSha = git(ws, "rev-parse", "HEAD").trim();
  const candidate = (task: string) => {
    const e = applyRule(spec(), task, files())!;
    assert.ok(e, task);
    writeFileSync(join(ws, e.path), e.content);
    for (const x of e.extra!) writeFileSync(join(ws, x.path), x.content);
    git(ws, "add", "-N", "--", ...e.extra!.map((x) => x.path));
    const d = git(ws, "diff", "--no-color", "--full-index", "--no-renames");
    git(ws, "reset", "-q", "--hard"); git(ws, "clean", "-fdq");
    return d;
  };
  return { dir, ws, baseSha, candidate };
}
function runGrading(fx: ReturnType<typeof gradeFixture>, diffs: string[]) {
  const inDir = join(fx.dir, "in");
  mkdirSync(join(inDir, "candidates"), { recursive: true });
  const candidates = diffs.map((d, i) => {
    writeFileSync(join(inDir, "candidates", `candidate-${i + 1}.diff`), d);
    return { id: `candidate-${i + 1}`, file: `candidates/candidate-${i + 1}.diff`, transformations: ["LEARNED_ADD_THROW_GUARD"], operationId: `learned:public-throw-guard-v1@${specHash(spec())}`, diffBytes: d.length, diffLines: 5, selfGrade: true as const };
  });
  const summary = { schema: "peaceai-workspace-candidates:v1", taskId: "workspace-issue-9", baseSha: fx.baseSha, candidates };
  writeFileSync(join(inDir, "summary.json"), JSON.stringify(summary));
  const list = join(fx.dir, "approved.json");
  writeFileSync(list, JSON.stringify({ schema: APPROVED_SCHEMA, rules: [entry(specHash(spec()))] }));
  const resultsFile = join(fx.dir, "out", "results.json");
  mkdirSync(join(fx.dir, "out"), { recursive: true });
  const r = spawnSync(tsx, [join(repo, "peaceai/bin/test-candidates.ts")], {
    cwd: repo, encoding: "utf8",
    env: { ...process.env, PEACEAI_IN_DIR: inDir, PEACEAI_RESULTS_FILE: resultsFile, PEACEAI_WORKSPACE_DIR: fx.ws, PEACEAI_TARGET: "PeaceG03/PeaceAI-Workspace", PEACEAI_SANDBOX_USER: "", PEACEAI_REQUIRE_SANDBOX: "", PEACEAI_APPROVED_LIST: list },
  });
  assert.equal(r.status, 0, r.stderr);
  const results = JSON.parse(readFileSync(resultsFile, "utf8"));
  assert.ok(validateResults(results));
  return { results: results.results, summary, stdout: r.stdout };
}

test("Job B: a learned guard counts only if its new test passes WITH the guard and fails WITHOUT it", () => {
  const fx = gradeFixture();
  try {
    const good = fx.candidate(TASK);
    // A test that would pass without the guard (it trips an existing check) must be rejected: hand-edited
    // diff, since the engine itself refuses a code already in the file.
    const raw = fx.candidate("guard scale in src/lib.ts: throw NEG_VALUE when value < 0\n- `scale(-1, 1)` throws NEG_VALUE\n- `scale(2, 2)` is 4");
    const both = raw.replace("assert.throws(() => scale(-1, 1), /NEG_VALUE/);", "assert.throws(() => scale(-1, 0), /ZERO_FACTOR|NEG_VALUE/);");
    assert.notEqual(both, raw);
    const { results, summary, stdout } = runGrading(fx, [good, both]);
    assert.deepEqual(results[0].testGrading, { fixSha: fx.baseSha, afterFix: true, beforeFix: false, verdict: "COUNTS", reason: null });
    assert.equal(results[0].originalSuitePassed, true);
    assert.equal(results[0].typecheckPassed, true);
    assert.match(stdout, /candidate-1 .* grading=COUNTS after_fix=true before_fix=false/);
    const rec = buildRecords({ issue: 9, runId: "1", recordedAt: "2026-10-13T00:00:00Z", baseSha: fx.baseSha, title: "[test] g", body: TASK }, summary.candidates, results, "seed");
    assert.equal(rec.ranking.candidates[0]!.eligible, true);
    assert.equal((rec.ranking.candidates[0] as { testGrading?: { verdict: string } }).testGrading?.verdict, "COUNTS");
    assert.equal(results[1].testGrading?.verdict, "REJECTED_PASSES_BOTH");
    assert.equal(rec.ranking.candidates[1]!.eligible, false);
    assert.equal(rec.ranking.candidates[1]!.rejectReason, "test-grading");
  } finally { rmSync(fx.dir, { recursive: true, force: true }); }
});

test("Results: a selfGrade candidate is rejected unless graded COUNTS against the task base", () => {
  const base = "b".repeat(40);
  const r = { id: "candidate-1", diffBytes: 1, diffLines: 1, applied: true, typecheckPassed: true, originalSuitePassed: true, newTestsPassed: true, newTestFiles: 1 };
  const ok = { fixSha: base, afterFix: true, beforeFix: false, verdict: "COUNTS", reason: null };
  assert.equal(gradingReject({ selfGrade: true }, r, base), "test-grading", "no grading");
  assert.equal(gradingReject({ selfGrade: true }, { ...r, testGrading: { ...ok, fixSha: "c".repeat(40) } as never }, base), "test-grading", "other base");
  assert.equal(gradingReject({ selfGrade: true }, { ...r, testGrading: ok as never }, ""), "test-grading", "no base known");
  assert.equal(gradingReject({ selfGrade: true }, { ...r, testGrading: ok as never }, base), null);
});

test("protected set: learned-guard.ts, the guard spec, and this test are protected", async () => {
  const { protectedReason } = await import("../lib/selfchange.ts");
  for (const p of ["peaceai/lib/learned-guard.ts", "peaceai/lib/learned.ts", "peaceai/rules/learned/public-throw-guard-v1.json", "peaceai/test/m13-throw-guard.test.ts"]) assert.ok(protectedReason(p), p);
});
