// Test-as-spec. credit: false.
// The failing test is the spec. The subject is context only: "make this failing test pass, context: <subject>".
// The test file is the one the grader checks out from the fix onto the base. The fix diff and the fix's
// source files are not inputs. Every test runs in the practice sandbox with the recorded node.
// Git outside that sandbox uses the locked hooks, fsmonitor, and isolated config, and only after
// the poison check.
// Symbols come from the test's own imports and calls, kept only when the path matches sourcePattern.
// Edits come from the loop-v2 repair proposer (the catalog of templates). Attempts stay within that
// loop's MAX_ATTEMPTS and the proposer's MAX_CANDIDATES. A diff is returned only when the given test
// passes and the original suite still passes. Nothing here pushes.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, posix } from "node:path";
import ts from "typescript";
import { isTestPath, openRepo } from "./codesearch.ts";
import { MAX_CANDIDATES, repairProposer, type RepairFeedback } from "./editpropose.ts";
import { MAX_ATTEMPTS } from "./loop.ts";
import { poisonChanges, poisonStamp, practiceGit, releaseWorktree, runInPracticeSandbox, type PracticeToolchain } from "./practicemine.ts";

export const SPEC_SCHEMA = "peaceai-test-spec:v1";
export const UNDERSTANDINGS = ["text", "test-as-spec"] as const;
export type Understanding = (typeof UNDERSTANDINGS)[number];

export const SPEC_CANT = [
  "CANT_DO_YET_NO_SYMBOL",
  "CANT_DO_YET_RUNNER_ERROR",
  "CANT_DO_YET_NO_FAILURE",
  "CANT_DO_YET_ASSERTION_UNPARSED",
  "CANT_DO_YET_ASSERTION_UNREDUCIBLE",
  "CANT_DO_YET_NO_VERIFY",
  "CANT_DO_YET_CAP",
] as const;
export type SpecCant = (typeof SPEC_CANT)[number];

/** The attempt cap. It cannot rise above the loop's cap or the proposer's candidate cap. */
export const SPEC_ATTEMPT_CAP = Math.min(MAX_ATTEMPTS, MAX_CANDIDATES);

export interface Expectation {
  kind: "equal" | "throws" | "type" | "boolean";
  symbol: string;
  file: string;
  /** Source text of the call arguments, shortened. */
  input: string;
  /** Source text of the expected value, "true"/"false", or "throws". */
  expected: string;
}

export const SPEC_DIAG_KINDS = [
  "runner_error", "no_failure", "assertion_unparsed", "assertion_unreducible",
  "reduced", "verified", "no_symbol", "no_verify", "cap", "sandbox_poison", "unsafe",
] as const;
export type SpecDiagKind = (typeof SPEC_DIAG_KINDS)[number];

export interface SpecDiagnostic {
  kind: SpecDiagKind;
  code: number | null;
  command: string[];
  lines: string[];
}

export interface SpecInput {
  root: string;
  /** Commit subject. Context only. */
  subject: string;
  testFile: string;
  testCommand: readonly string[];
  sourcePattern: string;
  denyPatterns?: readonly string[];
  /** "full" drops the test-file argument. "related" runs the given test plus these extra files. */
  originalSuite?: "full" | "related";
  relatedTests?: readonly string[];
  /** The pair's recorded node. The sandbox refuses any other interpreter. */
  toolchain: Pick<PracticeToolchain, "nodePath">;
  /** Clone node_modules to bind read-only. Null when the repo has none. */
  nodeModules?: string | null;
  /**
   * Puts the spec test back after the sandbox reset. The reset checks out HEAD, which drops
   * a test that was taken from the fix. Replay passes a guarded git checkout of that one file.
   */
  restoreTree?: () => boolean;
  /** Defaults to SPEC_ATTEMPT_CAP. Larger values are clamped down. */
  maxAttempts?: number;
}

export type SpecBlock = "UNSAFE_ENV" | "SANDBOX_POISON";

export type SpecResult =
  | { status: "diff"; diff: string; attempts: number; expectations: Expectation[]; diagnostic: SpecDiagnostic }
  | { status: "cant"; reason: SpecCant; attempts: number; diagnostic: SpecDiagnostic }
  | { status: "blocked"; reason: SpecBlock; attempts: number; diagnostic: SpecDiagnostic };

export function specTask(subject: string): string {
  const context = subject.replace(/\s+/g, " ").trim().slice(0, 200);
  return context ? `make this failing test pass, context: ${context}` : "make this failing test pass";
}

function compile(source: string): RegExp | null {
  try { return new RegExp(source); } catch { return null; }
}

function denied(path: string, patterns: readonly string[]): boolean {
  for (const pattern of patterns) {
    try { if (new RegExp(pattern, "i").test(path)) return true; } catch { return true; }
  }
  return false;
}

/** A source file the target allows. Test files are not sources, even when sourcePattern matches them. */
export function allowedSource(path: string, sourcePattern: string, denyPatterns: readonly string[] = []): boolean {
  if (!path || isTestPath(path)) return false;
  const re = compile(sourcePattern);
  if (!re || !re.test(path)) return false;
  return !denied(path, denyPatterns);
}

function resolveImport(fromFile: string, spec: string, exists: (path: string) => boolean): string | null {
  if (!spec.startsWith(".")) return null;
  const base = posix.normalize(posix.join(posix.dirname(fromFile), spec));
  if (base.startsWith("..")) return null;
  const stems = base.replace(/\.(?:tsx?|mts|cts|jsx?|mjs|cjs)$/, "");
  for (const path of [`${stems}.ts`, `${stems}.tsx`, `${stems}.mts`, `${stems}.cts`, posix.join(stems, "index.ts")]) {
    if (exists(path)) return path;
  }
  return null;
}

interface Binding { local: string; imported: string; file: string }

function bindings(testFile: string, text: string, sourcePattern: string, denyPatterns: readonly string[], exists: (path: string) => boolean): Binding[] {
  const sf = ts.createSourceFile(testFile, text, ts.ScriptTarget.Latest, true);
  const out: Binding[] = [];
  for (const st of sf.statements) {
    if (!ts.isImportDeclaration(st) || !ts.isStringLiteral(st.moduleSpecifier) || !st.importClause || st.importClause.isTypeOnly) continue;
    const file = resolveImport(testFile, st.moduleSpecifier.text, exists);
    if (!file || !allowedSource(file, sourcePattern, denyPatterns)) continue;
    if (st.importClause.name) out.push({ local: st.importClause.name.text, imported: "default", file });
    const named = st.importClause.namedBindings;
    if (named && ts.isNamedImports(named)) {
      for (const el of named.elements) {
        if (el.isTypeOnly) continue;
        out.push({ local: el.name.text, imported: (el.propertyName ?? el.name).text, file });
      }
    }
  }
  return out;
}

function literal(node: ts.Expression): boolean {
  if (ts.isStringLiteral(node) || ts.isNumericLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return true;
  if (node.kind === ts.SyntaxKind.TrueKeyword || node.kind === ts.SyntaxKind.FalseKeyword || node.kind === ts.SyntaxKind.NullKeyword) return true;
  return ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.MinusToken && ts.isNumericLiteral(node.operand);
}

function concrete(node: ts.Expression): boolean {
  const expr = unwrap(node);
  if (literal(expr)) return true;
  if (ts.isArrayLiteralExpression(expr)) return expr.elements.every((el) => el && !ts.isSpreadElement(el) && ts.isExpression(el) && concrete(el));
  if (ts.isObjectLiteralExpression(expr)) {
    return expr.properties.every((p) => ts.isPropertyAssignment(p) && concrete(p.initializer) && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name) || ts.isNumericLiteral(p.name)));
  }
  return false;
}

function unwrap(expr: ts.Expression): ts.Expression {
  let cur = expr;
  while (ts.isAwaitExpression(cur) || ts.isParenthesizedExpression(cur) || ts.isAsExpression(cur) || ts.isSatisfiesExpression(cur) || ts.isTypeAssertionExpression(cur)) cur = cur.expression;
  return cur;
}

function snippet(sf: ts.SourceFile, node: ts.Node): string {
  return sf.text.slice(node.getStart(sf), node.getEnd()).replace(/\s+/g, " ").slice(0, 80);
}

function called(expr: ts.Expression, locals: ReadonlyMap<string, Binding>, sf: ts.SourceFile): { symbol: string; file: string; input: string } | null {
  const inner = unwrap(expr);
  if (!ts.isCallExpression(inner)) return null;
  const callee = inner.expression;
  if (!inner.arguments.every((arg) => literal(unwrap(arg)))) return null;
  const input = inner.arguments.map((arg) => snippet(sf, arg)).join(", ");
  if (ts.isIdentifier(callee)) {
    const b = locals.get(callee.text);
    if (!b) return null;
    return { symbol: b.imported === "default" ? b.local : b.imported, file: b.file, input };
  }
  if (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression) && ts.isIdentifier(callee.name)) {
    const b = locals.get(callee.expression.text);
    if (!b) return null;
    return { symbol: callee.name.text, file: b.file, input };
  }
  return null;
}

function arrowCall(fn: ts.Expression, locals: ReadonlyMap<string, Binding>, sf: ts.SourceFile): { symbol: string; file: string; input: string } | null {
  if (!ts.isArrowFunction(fn) && !ts.isFunctionExpression(fn)) return null;
  if (ts.isCallExpression(unwrap(fn.body as ts.Expression)) || ts.isBlock(fn.body)) {
    if (!ts.isBlock(fn.body)) return called(fn.body as ts.Expression, locals, sf);
    for (const st of fn.body.statements) {
      if (ts.isExpressionStatement(st)) {
        const hit = called(st.expression, locals, sf);
        if (hit) return hit;
      }
    }
  }
  return null;
}

/** Concrete expectations already written in the test. A call with a non-literal argument is not one. */
export function expectationsIn(testFile: string, text: string, sourcePattern: string, denyPatterns: readonly string[] = [], exists: (path: string) => boolean = () => true): Expectation[] {
  const found = bindings(testFile, text, sourcePattern, denyPatterns, exists);
  const locals = new Map(found.map((b) => [b.local, b]));
  const sf = ts.createSourceFile(testFile, text, ts.ScriptTarget.Latest, true);
  const out: Expectation[] = [];
  const add = (kind: Expectation["kind"], hit: { symbol: string; file: string; input: string } | null, expected: string) => {
    if (!hit || out.length >= 32) return;
    const row: Expectation = { kind, symbol: hit.symbol, file: hit.file, input: hit.input, expected: expected.slice(0, 80) };
    if (out.some((e) => e.kind === row.kind && e.symbol === row.symbol && e.file === row.file && e.input === row.input && e.expected === row.expected)) return;
    out.push(row);
  };
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && ts.isIdentifier(node.expression.expression) && ts.isIdentifier(node.expression.name)) {
      const obj = node.expression.expression.text;
      const method = node.expression.name.text;
      const args = node.arguments;
      const head = args[0] ? unwrap(args[0]) : undefined;
      if ((obj === "assert" || obj === "assertStrict") && head) {
        if ((method === "equal" || method === "strictEqual" || method === "deepEqual" || method === "deepStrictEqual") && args[1] && concrete(args[1])) {
          if (ts.isCallExpression(head) && ts.isIdentifier(head.expression) && head.expression.text === "typeof" && head.arguments[0]) add("type", called(head.arguments[0], locals, sf), snippet(sf, args[1]));
          else add("equal", called(head, locals, sf), snippet(sf, args[1]));
        }
        if (method === "ok") add("boolean", called(head, locals, sf), "true");
        if (method === "throws" || method === "rejects") add("throws", arrowCall(head, locals, sf), "throws");
      }
      if ((obj === "t" || obj === "tt") && head) {
        if (method === "true") add("boolean", called(head, locals, sf), "true");
        if (method === "false") add("boolean", called(head, locals, sf), "false");
        if ((method === "is" || method === "deepEqual") && args[1]) {
          const left = called(head, locals, sf);
          const right = called(args[1], locals, sf);
          if (left && concrete(args[1])) add("equal", left, snippet(sf, args[1]));
          else if (right && concrete(head)) add("equal", right, snippet(sf, head));
        }
        if (method === "throws") add("throws", arrowCall(head, locals, sf), "throws");
      }
    }
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && ts.isCallExpression(node.expression.expression)) {
      const method = node.expression.name.text;
      const inner = node.expression.expression;
      if (ts.isIdentifier(inner.expression) && inner.expression.text === "expect" && inner.arguments[0]) {
        const subject = unwrap(inner.arguments[0]);
        if ((method === "toBe" || method === "toEqual" || method === "toStrictEqual") && node.arguments[0] && concrete(node.arguments[0])) {
          if (ts.isCallExpression(subject) && ts.isIdentifier(subject.expression) && subject.expression.text === "typeof" && subject.arguments[0]) add("type", called(subject.arguments[0], locals, sf), snippet(sf, node.arguments[0]));
          else add("equal", called(subject, locals, sf), snippet(sf, node.arguments[0]));
        }
        if (method === "toThrow" || method === "toThrowError") add("throws", arrowCall(subject, locals, sf), "throws");
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

const ASSERTION_OUTPUT = /AssertionError|ERR_ASSERTION|Expected values|expected .+ to (?:be|equal)|Difference \(|\+ Received|- Expected|✘ \[fail\]|Test Files .* failed/i;
const RUNNER_OUTPUT = /bwrap:|ERR_MODULE_NOT_FOUND|Cannot find module|Cannot find package|error TS\d+|ENOENT|not found/i;

/** What a finished runner process is, before the test source is read. */
export function classifyRunnerOutput(output: string, code: number | null): "runner_error" | "no_failure" | "assertion_seen" | "assertion_unparsed" {
  if (code === null) return "runner_error";
  if (code === 0) return "no_failure";
  const assertion = ASSERTION_OUTPUT.test(output);
  if (RUNNER_OUTPUT.test(output) && !assertion) return "runner_error";
  if (assertion || /^not ok \d+/m.test(output)) return "assertion_seen";
  return "assertion_unparsed";
}

/** First assertion-relevant lines. Paths outside the work directory and env assignments are removed. */
export function sanitizeRunnerLines(output: string, workDir: string): string[] {
  const rows = output.split("\n").map((line) => line.trim()).filter(Boolean);
  const relevant = rows.filter((line) => /assert|expect|error|fail|not ok|difference|expected|received|throws|bwrap:|cannot find|ERR_/i.test(line));
  const picked = (relevant.length ? relevant : rows).slice(0, 5);
  return picked.map((line) => line
    .split(workDir).join("<work>")
    .replace(/\/(?:tmp|home|opt|usr|var|exec-daemon|Users)\/[^\s'")]+/g, "<path>")
    .replace(/\b[A-Z][A-Z0-9_]{3,}=[^\s]+/g, "<env>")
    .slice(0, 240));
}

export function specDiagnostic(kind: SpecDiagKind, code: number | null, command: readonly string[], output: string, workDir: string): SpecDiagnostic {
  return {
    kind,
    code,
    command: command.map((part) => part.startsWith(workDir) ? `<work>${part.slice(workDir.length)}` : part.startsWith("/") ? "<bin>" : part),
    lines: sanitizeRunnerLines(output, workDir),
  };
}

/**
 * Argv for the original suite. "full" runs the same runner without the one test file.
 * "related" runs the given test plus the other related files, with the same runner prefix.
 * Null when the command does not name the test file, so the suite is not invented.
 */
export function originalSuiteArgv(testCommand: readonly string[], testFile: string, suite: "full" | "related", related: readonly string[] = []): string[] | null {
  const at = testCommand.lastIndexOf(testFile);
  if (at < 1) return null;
  if (suite === "full") {
    const cmd = testCommand.filter((_, i) => i !== at);
    return cmd.length ? cmd : null;
  }
  const files = [...new Set([testFile, ...related.filter((p) => p && p !== testFile && isTestPath(p))])];
  return [...testCommand.slice(0, at), ...files, ...testCommand.slice(at + 1)];
}

function gitDiff(root: string, paths: readonly string[]): string {
  if (!paths.length) return "";
  const ran = practiceGit(root, ["diff", "--no-color", "--no-ext-diff", "--no-renames", "--", ...paths]);
  return ran.ok ? ran.out : "";
}

type SandboxHit = { blocked: SpecBlock } | { blocked: null; code: number | null; stdout: string };

/** One test inside the practice sandbox. A poison or unsafe result is cleaned and blocks the next git step. */
function runSandboxed(input: SpecInput, cmd: readonly string[]): SandboxHit {
  const before = poisonStamp(input.root);
  const modules = input.nodeModules && existsSync(input.nodeModules) ? input.nodeModules : existsSync(join(input.root, "node_modules")) ? join(input.root, "node_modules") : null;
  const ran = runInPracticeSandbox(input.root, cmd, 60_000, { capture: true, nodePath: input.toolchain.nodePath, nodeModules: modules });
  const poison = poisonChanges(before, poisonStamp(input.root));
  if (ran.unsafe || poison.length > 0) {
    releaseWorktree(input.root, before);
    input.restoreTree?.();
    return { blocked: ran.unsafe ? "UNSAFE_ENV" : "SANDBOX_POISON" };
  }
  return { blocked: null, code: ran.code, stdout: ran.stdout };
}

/** Drop the attempt's edit. The poison check already passed, so this git step is allowed. */
function resetAttempt(input: SpecInput): void {
  const before = poisonStamp(input.root);
  releaseWorktree(input.root, before);
  input.restoreTree?.();
}

function read(root: string, path: string): string | null {
  try { return readFileSync(join(root, path), "utf8"); } catch { return null; }
}

/**
 * Make the failing test pass. The proposer is repair-v2. Each attempt is one of its edits,
 * applied on the original sources, then the given test and the original suite.
 */
export function runTestSpec(input: SpecInput): SpecResult {
  const cap = Math.min(SPEC_ATTEMPT_CAP, Math.max(1, Math.floor(input.maxAttempts ?? SPEC_ATTEMPT_CAP)));
  const deny = input.denyPatterns ?? [];
  const diag = (kind: SpecDiagKind, code: number | null, output: string) => specDiagnostic(kind, code, input.testCommand, output, input.root);
  const first = runSandboxed(input, input.testCommand);
  if (first.blocked) return { status: "blocked", reason: first.blocked, attempts: 0, diagnostic: diag(first.blocked === "SANDBOX_POISON" ? "sandbox_poison" : "unsafe", null, "") };
  const output = first.stdout;
  const seen = classifyRunnerOutput(output, first.code);
  if (seen === "runner_error") return { status: "cant", reason: "CANT_DO_YET_RUNNER_ERROR", attempts: 0, diagnostic: diag("runner_error", first.code, output) };
  if (seen === "no_failure") return { status: "cant", reason: "CANT_DO_YET_NO_FAILURE", attempts: 0, diagnostic: diag("no_failure", first.code, output) };
  const testText = read(input.root, input.testFile);
  if (testText === null) return { status: "cant", reason: "CANT_DO_YET_ASSERTION_UNPARSED", attempts: 0, diagnostic: diag("assertion_unparsed", first.code, output) };
  const exists = (path: string) => read(input.root, path) !== null;
  const expectations = expectationsIn(input.testFile, testText, input.sourcePattern, deny, exists);
  if (expectations.length === 0) {
    const named = bindings(input.testFile, testText, input.sourcePattern, deny, exists);
    if (named.length === 0 && seen === "assertion_unparsed") return { status: "cant", reason: "CANT_DO_YET_ASSERTION_UNPARSED", attempts: 0, diagnostic: diag("assertion_unparsed", first.code, output) };
    if (named.length === 0) return { status: "cant", reason: "CANT_DO_YET_NO_SYMBOL", attempts: 0, diagnostic: diag("no_symbol", first.code, output) };
    return { status: "cant", reason: "CANT_DO_YET_ASSERTION_UNREDUCIBLE", attempts: 0, diagnostic: diag("assertion_unreducible", first.code, output) };
  }
  const symbols = [...new Set(expectations.map((e) => e.symbol))];
  if (symbols.length === 0) return { status: "cant", reason: "CANT_DO_YET_NO_SYMBOL", attempts: 0, diagnostic: diag("no_symbol", first.code, output) };
  const sourceFiles = [...new Set(expectations.map((e) => e.file))].filter((p) => allowedSource(p, input.sourcePattern, deny));
  if (sourceFiles.length === 0) return { status: "cant", reason: "CANT_DO_YET_NO_SYMBOL", attempts: 0, diagnostic: diag("no_symbol", first.code, output) };
  const original = new Map<string, string>();
  for (const path of sourceFiles) {
    const text = read(input.root, path);
    if (text === null) return { status: "cant", reason: "CANT_DO_YET_NO_SYMBOL", attempts: 0, diagnostic: diag("no_symbol", first.code, output) };
    original.set(path, text);
  }
  const request = `${specTask(input.subject)}\n${symbols.map((s) => `\`${s}\``).join(" ")}`;
  const failing = [...output.matchAll(/^not ok \d+ - (.+)$/gm)].map((m) => m[1]!.trim()).slice(0, 8);
  const repo = openRepo(input.root);
  const related = [...(input.relatedTests ?? [])];
  if (input.originalSuite === "related" && input.relatedTests === undefined) {
    for (const file of sourceFiles) {
      const found = repo.testsFor(file);
      if (found.ok) for (const test of found.tests) if (test.path !== input.testFile) related.push(test.path);
    }
  }
  const proposer = repairProposer({ v2: true });
  proposer.prepare(repo, { request, failing, baseFailing: failing });
  const files = [...original.entries()].map(([path, content]) => ({ path, content }));
  const feedback: RepairFeedback[] = [];
  let attempts = 0;
  for (;;) {
    const proposal = proposer.next({ files, attempt: attempts + 1, feedback, baseline: null });
    if ("refuse" in proposal) return { status: "cant", reason: "CANT_DO_YET_NO_VERIFY", attempts, diagnostic: diag("no_verify", first.code, output) };
    if (attempts >= cap) return { status: "cant", reason: "CANT_DO_YET_CAP", attempts, diagnostic: diag("cap", first.code, output) };
    const edits = proposal.edits.filter((e) => original.has(e.path));
    attempts += 1;
    if (edits.length === 0) {
      feedback.push({ attempt: attempts, codes: ["TEST_FAIL"], failing, tests: null });
      continue;
    }
    for (const edit of edits) writeFileSync(join(input.root, edit.path), edit.content);
    const again = runSandboxed(input, input.testCommand);
    if (again.blocked) return { status: "blocked", reason: again.blocked, attempts, diagnostic: diag(again.blocked === "SANDBOX_POISON" ? "sandbox_poison" : "unsafe", null, "") };
    if (again.code !== 0) {
      resetAttempt(input);
      feedback.push({ attempt: attempts, codes: ["TEST_FAIL"], failing, tests: null });
      continue;
    }
    const suite = input.originalSuite ? originalSuiteArgv(input.testCommand, input.testFile, input.originalSuite, related) : null;
    if (suite) {
      const ran = runSandboxed(input, suite);
      if (ran.blocked) return { status: "blocked", reason: ran.blocked, attempts, diagnostic: diag(ran.blocked === "SANDBOX_POISON" ? "sandbox_poison" : "unsafe", null, "") };
      if (ran.code !== 0) {
        resetAttempt(input);
        feedback.push({ attempt: attempts, codes: ["TEST_FAIL"], failing, tests: null });
        continue;
      }
    }
    const diff = gitDiff(input.root, edits.map((e) => e.path));
    resetAttempt(input);
    if (!diff.trim()) {
      feedback.push({ attempt: attempts, codes: ["TEST_FAIL"], failing, tests: null });
      continue;
    }
    return { status: "diff", diff, attempts, expectations, diagnostic: diag("verified", 0, output) };
  }
}
