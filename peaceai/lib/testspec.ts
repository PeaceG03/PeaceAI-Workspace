// Test-as-spec. credit: false.
// The failing test is the spec. The subject is context only: "make this failing test pass, context: <subject>".
// The test file is the one the grader checks out from the fix onto the base. The fix diff and the fix's
// source files are not inputs. A run uses the practice sandbox when the replay drives it.
// Symbols come from the test's own imports and calls, kept only when the path matches sourcePattern.
// Edits come from the loop-v2 repair proposer (the catalog of templates). Attempts stay within that
// loop's MAX_ATTEMPTS and the proposer's MAX_CANDIDATES. A diff is returned only when the given test
// passes and the original suite still passes. Nothing here pushes.
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join, posix } from "node:path";
import ts from "typescript";
import { isTestPath, openRepo } from "./codesearch.ts";
import { MAX_CANDIDATES, repairProposer, type RepairFeedback } from "./editpropose.ts";
import { MAX_ATTEMPTS } from "./loop.ts";

export const SPEC_SCHEMA = "peaceai-test-spec:v1";
export const UNDERSTANDINGS = ["text", "test-as-spec"] as const;
export type Understanding = (typeof UNDERSTANDINGS)[number];

export const SPEC_CANT = [
  "CANT_DO_YET_NO_SYMBOL",
  "CANT_DO_YET_ASSERTION",
  "CANT_DO_YET_NO_VERIFY",
  "CANT_DO_YET_CAP",
] as const;
export type SpecCant = (typeof SPEC_CANT)[number];

/** The attempt cap. It cannot rise above the loop's cap or the proposer's candidate cap. */
export const SPEC_ATTEMPT_CAP = Math.min(MAX_ATTEMPTS, MAX_CANDIDATES);

export interface SpecRun { code: number | null; stdout: string }
export type SpecRunner = (cmd: readonly string[]) => SpecRun;

export interface Expectation {
  kind: "equal" | "throws" | "type";
  symbol: string;
  file: string;
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
  run: SpecRunner;
  /** Defaults to SPEC_ATTEMPT_CAP. Larger values are clamped down. */
  maxAttempts?: number;
}

export type SpecResult =
  | { status: "diff"; diff: string; attempts: number; expectations: Expectation[] }
  | { status: "cant"; reason: SpecCant; attempts: number };

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

function called(expr: ts.Expression, locals: ReadonlyMap<string, Binding>): { symbol: string; file: string } | null {
  if (!ts.isCallExpression(expr)) return null;
  const callee = expr.expression;
  if (ts.isIdentifier(callee)) {
    const b = locals.get(callee.text);
    if (!b || !expr.arguments.every(literal)) return null;
    return { symbol: b.imported === "default" ? b.local : b.imported, file: b.file };
  }
  if (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression) && ts.isIdentifier(callee.name)) {
    const b = locals.get(callee.expression.text);
    if (!b || !expr.arguments.every(literal)) return null;
    return { symbol: callee.name.text, file: b.file };
  }
  return null;
}

/** Concrete expectations already written in the test. A call with a non-literal argument is not one. */
export function expectationsIn(testFile: string, text: string, sourcePattern: string, denyPatterns: readonly string[] = [], exists: (path: string) => boolean = () => true): Expectation[] {
  const found = bindings(testFile, text, sourcePattern, denyPatterns, exists);
  const locals = new Map(found.map((b) => [b.local, b]));
  const sf = ts.createSourceFile(testFile, text, ts.ScriptTarget.Latest, true);
  const out: Expectation[] = [];
  const add = (kind: Expectation["kind"], hit: { symbol: string; file: string } | null) => {
    if (!hit) return;
    if (out.some((e) => e.kind === kind && e.symbol === hit.symbol && e.file === hit.file)) return;
    out.push({ kind, symbol: hit.symbol, file: hit.file });
  };
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && ts.isIdentifier(node.expression.expression)) {
      const obj = node.expression.expression.text;
      const method = node.expression.name.text;
      const args = node.arguments;
      if ((obj === "assert" || obj === "assertStrict") && args[0]) {
        if ((method === "equal" || method === "strictEqual" || method === "deepEqual" || method === "deepStrictEqual") && literal(args[1] ?? args[0]!)) {
          const subject = args[0]!;
          if (ts.isCallExpression(subject) && ts.isIdentifier(subject.expression) && subject.expression.text === "typeof") add("type", called(subject.arguments[0] ?? subject, locals));
          else add("equal", called(subject, locals));
        }
        if (method === "throws" || method === "rejects") {
          const fn = args[0];
          if (fn && ts.isArrowFunction(fn) && fn.body && ts.isCallExpression(fn.body)) add("throws", called(fn.body, locals));
          else if (fn && ts.isArrowFunction(fn) && fn.body && ts.isBlock(fn.body)) {
            for (const st of fn.body.statements) if (ts.isExpressionStatement(st)) add("throws", called(st.expression, locals));
          }
        }
      }
      if (obj === "expect" && args[0]) {
        // expect(call).toBe(literal) is a property chain; handled when this node is the outer toBe call.
      }
    }
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && ts.isCallExpression(node.expression.expression)) {
      const method = node.expression.name.text;
      const inner = node.expression.expression;
      if (ts.isIdentifier(inner.expression) && inner.expression.text === "expect" && inner.arguments[0]) {
        const subject = inner.arguments[0];
        if ((method === "toBe" || method === "toEqual" || method === "toStrictEqual") && node.arguments[0] && literal(node.arguments[0])) add("equal", called(subject, locals));
        if (method === "toThrow" || method === "toThrowError") {
          if (ts.isArrowFunction(subject) && subject.body && ts.isCallExpression(subject.body)) add("throws", called(subject.body, locals));
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

/** The runner's output is an assertion failure, not a missing runner or a syntax error. */
export function assertionFailure(output: string, code: number | null): boolean {
  if (code === null || code === 0) return false;
  return /AssertionError|ERR_ASSERTION|Expected values|expected .* to (?:be|equal)|toThrow|throws/i.test(output);
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
  const ran = spawnSync("git", ["-C", root, "diff", "--no-color", "--no-ext-diff", "--no-renames", "--", ...paths], { encoding: "utf8" });
  return ran.status === 0 ? ran.stdout : "";
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
  const first = input.run(input.testCommand);
  const output = first.stdout;
  if (!assertionFailure(output, first.code)) return { status: "cant", reason: "CANT_DO_YET_ASSERTION", attempts: 0 };
  const testText = read(input.root, input.testFile);
  if (testText === null) return { status: "cant", reason: "CANT_DO_YET_ASSERTION", attempts: 0 };
  const exists = (path: string) => read(input.root, path) !== null;
  const expectations = expectationsIn(input.testFile, testText, input.sourcePattern, deny, exists);
  if (expectations.length === 0) {
    const named = bindings(input.testFile, testText, input.sourcePattern, deny, exists);
    return { status: "cant", reason: named.length === 0 ? "CANT_DO_YET_NO_SYMBOL" : "CANT_DO_YET_ASSERTION", attempts: 0 };
  }
  const symbols = [...new Set(expectations.map((e) => e.symbol))];
  if (symbols.length === 0) return { status: "cant", reason: "CANT_DO_YET_NO_SYMBOL", attempts: 0 };
  const sourceFiles = [...new Set(expectations.map((e) => e.file))].filter((p) => allowedSource(p, input.sourcePattern, deny));
  if (sourceFiles.length === 0) return { status: "cant", reason: "CANT_DO_YET_NO_SYMBOL", attempts: 0 };
  const original = new Map<string, string>();
  for (const path of sourceFiles) {
    const text = read(input.root, path);
    if (text === null) return { status: "cant", reason: "CANT_DO_YET_NO_SYMBOL", attempts: 0 };
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
  const restore = () => { for (const [path, text] of original) writeFileSync(join(input.root, path), text); };
  let attempts = 0;
  try {
    for (;;) {
      const proposal = proposer.next({ files, attempt: attempts + 1, feedback, baseline: null });
      if ("refuse" in proposal) return { status: "cant", reason: "CANT_DO_YET_NO_VERIFY", attempts };
      if (attempts >= cap) return { status: "cant", reason: "CANT_DO_YET_CAP", attempts };
      const edits = proposal.edits.filter((e) => original.has(e.path));
      attempts += 1;
      if (edits.length === 0) {
        feedback.push({ attempt: attempts, codes: ["TEST_FAIL"], failing, tests: null });
        continue;
      }
      for (const edit of edits) writeFileSync(join(input.root, edit.path), edit.content);
      const again = input.run(input.testCommand);
      if (again.code !== 0) {
        restore();
        feedback.push({ attempt: attempts, codes: ["TEST_FAIL"], failing, tests: null });
        continue;
      }
      const suite = input.originalSuite ? originalSuiteArgv(input.testCommand, input.testFile, input.originalSuite, related) : null;
      if (suite) {
        const ran = input.run(suite);
        if (ran.code !== 0) {
          restore();
          feedback.push({ attempt: attempts, codes: ["TEST_FAIL"], failing, tests: null });
          continue;
        }
      }
      const diff = gitDiff(input.root, edits.map((e) => e.path));
      restore();
      if (!diff.trim()) {
        feedback.push({ attempt: attempts, codes: ["TEST_FAIL"], failing, tests: null });
        continue;
      }
      return { status: "diff", diff, attempts, expectations };
    }
  } finally {
    restore();
  }
}
