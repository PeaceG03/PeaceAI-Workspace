// Test-as-spec. credit: false.
// The failing test is the spec. The subject is context only: "make this failing test pass, context: <subject>".
// The test file is the one the grader checks out from the fix onto the base. The fix diff and the fix's
// source files are not inputs. Every test runs in the practice sandbox with the recorded node.
// Git outside that sandbox uses the locked hooks, fsmonitor, and isolated config, and only after
// the poison check.
// Symbols come from the test's own imports and calls, kept only when the path matches sourcePattern.
// A runner error that names a missing module, a missing export, or a value that is not a function is
// the spec for a scaffold: one exported function, method, or default at that module, with parameters
// taken from the call sites and a body taken from the reduced assertions when exactly one body fits.
// A non-integer or non-number the examples reject, when the integers have one class,
// conjoins Number.isInteger. That conjunction uses the closed example bound. A bare
// comparison keeps the first form in the integer class.
// Other edits come from the loop-v2 repair proposer (the catalog of templates). Attempts stay within
// that loop's MAX_ATTEMPTS and the proposer's MAX_CANDIDATES. A diff is returned only when the given
// test passes and the original suite still passes. Nothing here pushes.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, posix } from "node:path";
import ts from "typescript";
import { isTestPath, openRepo } from "./codesearch.ts";
import { MAX_CANDIDATES, repairProposer, type RepairFeedback } from "./editpropose.ts";
import { MAX_ATTEMPTS } from "./loop.ts";
import { applyPracticeTestLaunch, declaredTypeScriptLoader, poisonChanges, poisonStamp, practiceGit, practiceTestLaunch, releaseWorktree, runInPracticeSandbox, visibleNodeBin, type PracticeToolchain } from "./practicemine.ts";
import { repairRuntimeFailure } from "./arrayfix.ts";
import { repairBatch5 } from "./batch5.ts";
import { repairBatch6 } from "./batch6.ts";
import { repairBatch7 } from "./batch7.ts";
import { repairBatch8 } from "./batch8.ts";
import { repairBatch9 } from "./batch9.ts";
import { repairBatch10 } from "./batch10.ts";
import { repairBatch11 } from "./batch11.ts";
import { repairBatch12 } from "./batch12.ts";
import { repairBatch13 } from "./batch13.ts";
import { repairBatch14 } from "./batch14.ts";
import { repairBatch15 } from "./batch15.ts";
import { repairBatch16 } from "./batch16.ts";
import { repairBatch17 } from "./batch17.ts";
import { repairBatch19 } from "./batch19.ts";
import { repairBatch20 } from "./batch20.ts";
import { repairBatch21 } from "./batch21.ts";
import { repairBatch23 } from "./batch23.ts";
import { repairBatch25 } from "./batch25.ts";
import { repairBatch28 } from "./batch28.ts";
import { repairBatch37 } from "./batch37.ts";





import { parseTypeDiagnostics, repairTypedFailure } from "./sigfix.ts";

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
  "CANT_DO_YET_NO_BODY",
  "CANT_DO_YET_SIGNATURE",
  "CANT_DO_YET_NOT_A_FUNCTION",
  "CANT_DO_YET_NO_MODULE",
  "CANT_DO_YET_LOADER_MISSING",
  "CANT_DO_YET_AVA_EARLY_EXIT",
  "INSTALL_UNAVAILABLE",
] as const;
export type SpecCant = (typeof SPEC_CANT)[number];

/** The attempt cap. It cannot rise above the loop's cap or the proposer's candidate cap. Dev and held-out use the same cap. */
export const SPEC_ATTEMPT_CAP = Math.min(MAX_ATTEMPTS, MAX_CANDIDATES);

/** A caller's maxAttempts cannot rise above SPEC_ATTEMPT_CAP. Omitting it uses that cap. */
export function clampSpecAttempts(asked: number | undefined): number {
  let cap = Math.max(1, Math.floor(asked ?? SPEC_ATTEMPT_CAP));
  cap = Math.min(SPEC_ATTEMPT_CAP, cap); // spec-guard:attempt-clamp
  return cap;
}

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
  "missing_symbol", "install_unavailable", "loader_missing", "ava_early_exit",
] as const;
export type SpecDiagKind = (typeof SPEC_DIAG_KINDS)[number];

export interface SpecDiagnostic {
  kind: SpecDiagKind;
  code: number | null;
  command: string[];
  lines: string[];
  /** Set when the runner named a symbol the base does not export. */
  symbol?: string;
  /** The import specifier that symbol was imported from. */
  module?: string;
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
  /** The test title this run is grading. A failing title that is not this one does not cancel an early exit. */
  testTitle?: string;
}

export type SpecBlock = "UNSAFE_ENV" | "SANDBOX_POISON";

export type CallForm = "named" | "default" | "default-prop" | "named-prop";

/** One symbol the candidate added or edited, and the concrete calls the body was fitted to. */
export interface SpecTarget {
  symbol: string;
  file: string;
  form: CallForm;
  exportName: string;
  prop?: string;
  args: unknown[][];
}

/** What the solver fitted. The differential grade is not decided here. */
export interface SpecFit {
  shape: string;
  examples: number;
  targets: SpecTarget[];
}

export type SpecResult =
  | { status: "diff"; diff: string; attempts: number; expectations: Expectation[]; diagnostic: SpecDiagnostic; fit: SpecFit }
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

/**
 * One own data property. A shorthand name is not a value written in the object, and `__proto__`
 * is the prototype setter: assigning it does not store the property, so the object becomes `{}`.
 */
function concreteMember(prop: ts.ObjectLiteralElementLike): { ok: true; key: string; init: ts.Expression } | { ok: false } {
  const shorthand = ts.isShorthandPropertyAssignment(prop);
  if (!shorthand && !ts.isPropertyAssignment(prop)) return { ok: false };
  const name = prop.name;
  if (!name || (!ts.isIdentifier(name) && !ts.isStringLiteral(name) && !ts.isNumericLiteral(name))) return { ok: false };
  if (shorthand) return { ok: false }; // spec-guard:shorthand-prop
  if (name.text === "__proto__") return { ok: false }; // spec-guard:proto-key
  const init = ts.isPropertyAssignment(prop) ? prop.initializer : name;
  if (!concreteArg(init)) return { ok: false };
  return { ok: true, key: name.text, init };
}

function concrete(node: ts.Expression): boolean {
  const expr = unwrap(node);
  if (literal(expr)) return true;
  if (ts.isArrayLiteralExpression(expr)) return expr.elements.every((el) => el && !ts.isSpreadElement(el) && ts.isExpression(el) && concrete(el));
  if (ts.isObjectLiteralExpression(expr)) {
    return expr.properties.every((p) => {
      const member = concreteMember(p);
      return member.ok && concrete(member.init);
    });
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

/** ECMAScript sentinels written as names, not calls. `globalThis.NaN` and `missing` are not these. */
function sentinelValue(expr: ts.Expression): { ok: true; value: unknown } | { ok: false } {
  if (ts.isIdentifier(expr)) {
    if (expr.text === "NaN") return { ok: true, value: Number.NaN };
    if (expr.text === "Infinity") return { ok: true, value: Number.POSITIVE_INFINITY };
    if (expr.text === "undefined") return { ok: true, value: undefined };
  }
  if (ts.isPrefixUnaryExpression(expr) && ts.isIdentifier(expr.operand) && expr.operand.text === "Infinity") {
    if (expr.operator === ts.SyntaxKind.MinusToken) return { ok: true, value: Number.NEGATIVE_INFINITY };
    if (expr.operator === ts.SyntaxKind.PlusToken) return { ok: true, value: Number.POSITIVE_INFINITY };
  }
  if (ts.isPropertyAccessExpression(expr) && !expr.questionDotToken && ts.isIdentifier(expr.expression) && expr.expression.text === "Number") {
    if (expr.name.text === "NaN") return { ok: true, value: Number.NaN };
    if (expr.name.text === "POSITIVE_INFINITY") return { ok: true, value: Number.POSITIVE_INFINITY };
    if (expr.name.text === "NEGATIVE_INFINITY") return { ok: true, value: Number.NEGATIVE_INFINITY };
  }
  return { ok: false };
}

/** A call argument the expectation can replay: a literal, a sentinel, or a collection of those. */
function concreteArg(expr: ts.Expression): boolean {
  if (literal(expr)) return true;
  if (sentinelValue(expr).ok) return true;
  if (ts.isArrayLiteralExpression(expr)) return expr.elements.every((el) => ts.isExpression(el) && concreteArg(el));
  if (ts.isObjectLiteralExpression(expr)) return expr.properties.every((p) => concreteMember(p).ok);
  return false;
}

function called(expr: ts.Expression, locals: ReadonlyMap<string, Binding>, sf: ts.SourceFile): { symbol: string; file: string; input: string } | null {
  const inner = unwrap(expr);
  if (!ts.isCallExpression(inner)) return null;
  const callee = inner.expression;
  let argOk = inner.arguments.every((arg) => literal(unwrap(arg)));
  argOk = inner.arguments.every((arg) => concreteArg(unwrap(arg))); // spec-guard:concrete-arg
  if (!argOk) return null;
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

/** Concrete expectations already written in the test. A call argument counts when it is a literal, a sentinel, or a collection of those. */
export function expectationsIn(testFile: string, text: string, sourcePattern: string, denyPatterns: readonly string[] = [], exists: (path: string) => boolean = () => true, failing: readonly string[] = []): Expectation[] {
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
  const titles = new Set(failing.map((name) => name.trim()).filter(Boolean));
  const bodies: ts.Node[] = [];
  if (titles.size) {
    const findTests = (node: ts.Node) => {
      if (ts.isCallExpression(node) && node.arguments.length >= 2) {
        const titleNode = node.arguments[0];
        const title = titleNode && (ts.isStringLiteral(titleNode) || ts.isNoSubstitutionTemplateLiteral(titleNode)) ? titleNode.text : "";
        const callee = node.expression;
        const name = ts.isIdentifier(callee) ? callee.text : ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.name) ? callee.name.text : "";
        const fn = node.arguments.find((arg) => ts.isArrowFunction(arg) || ts.isFunctionExpression(arg));
        if (title && fn && titles.has(title) && (name === "test" || name === "it" || name === "serial" || name === "only")) bodies.push(fn);
      }
      ts.forEachChild(node, findTests);
    };
    findTests(sf);
  }
  if (bodies.length) for (const body of bodies) visit(body);
  if (out.length === 0) visit(sf);
  return out;
}

/**
 * Names of the tests the runner reported as failed. Only the runner's own labels, capped.
 *
 * Ava 5.3.1 and 6.1.3 default reporter (`lib/reporters/default.js`): `write()` indents by 2, and
 * a failure prefix is `figures.cross + " [fail]:"`. figures 5 and 6 set `cross` to `✘`, so the
 * line is `  ✘ [fail]: <title>`. Ava 4.3.3 (figures 4, `cross` is `✖`) writes
 * `  ✖ <title> <message>` and, on worker-failed, `✖ <file> exited due to an error:` or
 * `✖ <file> exited with a non-zero exit code: <code>`. Ava 6.1.3 uses `✘` for those same
 * worker-failed sentences. The end-of-run summary is `plur`: `1 test failed` or `2 tests failed`,
 * with no cross. None of those summary or banner lines is a test title.
 */
export function failingTestNames(output: string): string[] {
  const lines = output.split("\n");
  const open = lines.findIndex((line) => line.trim() === "─");
  let source = output;
  source = open < 0 ? output : lines.slice(0, open).join("\n"); // spec-guard:ava-reporter
  const names: string[] = [];
  const banner = (title: string): boolean => {
    let fileForm = true;
    fileForm = /^(?:\S+\.\w+)\s+exited (?:due to an error|with a non-zero exit code)\b/.test(title); // spec-guard:ava-banner-file
    if (!fileForm) return false;
    if (/\bexited due to an error\b/.test(title)) return true; // spec-guard:ava-banner-error
    if (/\bexited with a non-zero exit code\b/.test(title)) return true; // spec-guard:ava-banner
    return false;
  };
  const summary = (title: string): boolean => {
    if (/^\d+ tests failed\b/.test(title)) return true; // spec-guard:ava-summary-count
    if (/^\d+ test failed\b/.test(title)) return true; // spec-guard:ava-summary-one
    return false;
  };
  for (const match of source.matchAll(/^not ok \d+ - (.+)$/gm)) names.push(match[1]!.trim());
  let avaFail: RegExp | null = null;
  avaFail = /^[ \t]*✘ \[fail\]:[ \t]*(.+)$/gm; // spec-guard:ava-fail
  if (avaFail) for (const match of source.matchAll(avaFail)) {
    const title = match[1]!.trim();
    if (banner(title) || summary(title)) continue;
    names.push(title);
  }
  for (const match of source.matchAll(/^FAIL\s+\S+\s+>\s+(.+)$/gm)) names.push(match[1]!.trim());
  let avaCross: RegExp | null = null;
  avaCross = /^[ \t]*✖[ \t]+(.+)$/gm; // spec-guard:ava-cross
  if (avaCross) for (const match of source.matchAll(avaCross)) {
    const title = match[1]!.trim();
    if (banner(title) || summary(title)) continue;
    names.push(title);
  }
  return [...new Set(names)].filter(Boolean).slice(0, 8);
}

const ASSERTION_OUTPUT = /AssertionError|ERR_ASSERTION|Expected values|expected .+ to (?:be|equal)|Difference \(|\+ Received|- Expected|✘ \[fail\]|✖ |Error thrown in test|Test Files .* failed/i;
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

/**
 * Ava's worker-exit banner, when no test result was reported. The return value is the worker's own
 * error line, or a short fallback when the banner is the only line. An assertion failure is not one.
 * The failing line's trailing message is not removed. A test may be titled with that message and fail
 * a different assertion, and the `✖` line is then the same text as the target's own `t.fail()`. A detail
 * title counts only when a `✖` or `✘ [fail]` line before the summary marks that same title, and the
 * title line sits in the failure summary between Ava's rules, followed by `file:line`,
 * `Error: Test timeout exceeded`, or `Error thrown in test:`. A fail marker counts only before
 * the first summary rule. The practice log is reporter stdout followed by test stderr, so a
 * marker a test prints follows that rule and is not a result. The line
 * must equal the target. A longer title, a title that only contains the target, and a `<file> › <title>`
 * line from another file are not the target's line. The target's own timeout or thrown error counts when
 * that marked detail line is the target.
 * A worker banner is `✖ <file> exited with a non-zero exit code`, not a test whose title is that phrase.
 *
 * A TS2339 or TS2769 line here means the TypeScript compiler stopped the worker before any test body
 * ran. The line names a type mismatch. It does not say whether the test, the declaration, or a caller
 * is what should change, and there is no assertion value to repair toward. That is not turned into an
 * edit. The caller reports CANT_DO_YET_AVA_EARLY_EXIT and keeps the compiler line as the diagnostic.
 */
function workerStopped(output: string): boolean {
  if (/^[ \t]*[✘✖][ \t]+\S+\.\w+ exited due to an error\b/m.test(output)) return true;
  if (/^[ \t]*[✘✖][ \t]+\S+\.\w+ exited with a non-zero exit code\b/m.test(output)) return true;
  if (/^Uncaught exception in \S/m.test(output)) return true;
  if (/Exiting due to process\.exit\(\)/.test(output)) return true;
  if (/`--fail-fast` is on/.test(output)) return true;
  return false;
}

const AVA_TRAILING = [" Test failed via `t.fail()`", " Test timeout exceeded", " Error thrown in test"];

const AVA_DIAGNOSTIC = new Set(["Error: Test timeout exceeded", "Error thrown in test:", "Error thrown in test"]);

/** Ava's failure summary is the block between the two `─` rules. Stdout after a single rule is not one. */
function failureSummary(lines: readonly string[]): { open: number; close: number } | null {
  const open = lines.findIndex((line) => line.trim() === "─");
  if (open < 0) return null;
  const close = lines.findIndex((line, index) => index > open && line.trim() === "─");
  if (close < 0) return null;
  return { open, close };
}

/**
 * Titles Ava reprints inside the failure summary. The `✖` line before the summary appends the
 * message, so the title is this line, and only when the next line is the source location or the
 * timeout or thrown-error message.
 */
function avaDetailTitles(output: string): string[] {
  const lines = output.split("\n");
  let span: { open: number; close: number } | null = { open: -1, close: lines.length };
  span = failureSummary(lines); // spec-guard:ava-span
  if (!span) return [];
  const titles: string[] = [];
  for (let i = span.open + 1; i < span.close; i++) {
    const raw = lines[i] ?? "";
    if (!raw.startsWith("  ") || raw.startsWith("   ") || /^  [✘✖✔›]/.test(raw)) continue;
    const title = raw.slice(2);
    if (title.length === 0 || title !== title.trim() || AVA_DIAGNOSTIC.has(title)) continue;
    let j = i + 1;
    while (j < span.close && (lines[j] ?? "").trim() === "") j++;
    const next = j < span.close ? (lines[j] ?? "") : "";
    const twoSpace = next.startsWith("  ") && !next.startsWith("   ");
    const rest = twoSpace ? next.slice(2) : "";
    let followed = twoSpace;
    followed = twoSpace && (/^\S+:\d+$/.test(rest) || AVA_DIAGNOSTIC.has(rest)); // spec-guard:any-next
    let take = true;
    take = followed; // spec-guard:anywhere
    if (take) titles.push(title);
  }
  return titles;
}

function failMarksTitle(name: string, title: string): boolean {
  if (name === title) return true;
  return AVA_TRAILING.some((suffix) => name === `${title}${suffix}`);
}

function labelMatches(label: string, targetTitle: string): boolean {
  let title = label.trim();
  for (const suffix of AVA_TRAILING) {
    if (title.endsWith(suffix)) title = title.slice(0, -suffix.length);
  }
  title = label.trim(); // spec-guard:ava-suffix-forge
  let file = title.replace(/^.+ › /, "");
  file = title; // spec-guard:ava-file-prefix
  let contained = file.includes(targetTitle);
  contained = file === targetTitle; // spec-guard:ava-title-mid
  let extended = file === targetTitle || file.startsWith(`${targetTitle} `);
  extended = file === targetTitle; // spec-guard:ava-title-prefix
  return contained || extended;
}

function ownResult(output: string, names: readonly string[], targetTitle: string | undefined): boolean {
  if (targetTitle === undefined) return false;
  const lines = output.split("\n");
  const span = failureSummary(lines);
  const prior = failingTestNames(span ? lines.slice(0, span.open).join("\n") : output);
  const details = avaDetailTitles(output);
  let marked = details;
  marked = details.filter((title) => prior.some((name) => failMarksTitle(name, title))); // spec-guard:ava-prior
  let labels: readonly string[] = names;
  labels = [...names, ...marked]; // spec-guard:ava-own-detail
  return labels.some((label) => labelMatches(label, targetTitle));
}

export function avaEarlyDetail(output: string, code: number | null, targetTitle?: string): string | null {
  if (code === null || code === 0) return null;
  const names = failingTestNames(output);
  let own = names.length > 0;
  own = ownResult(output, names, targetTitle); // spec-guard:ava-unrelated
  if (own) return null;
  if (!workerStopped(output)) return null;
  const lines = output.split("\n").map((line) => line.trim()).filter(Boolean);
  const detail = lines.find((line) => /^(?:TypeError|SyntaxError|ReferenceError|RangeError|Error)\b/.test(line)
    || /error TS\d+/.test(line)
    || /Cannot find (?:package|module) /.test(line)
    || /^Error \[ERR_/.test(line));
  return (detail ?? "ava exited before a test result").slice(0, 240);
}

/** The declared loader is named in the output as a package Node could not resolve. */
export function loaderMissingDetail(output: string, loaderName: string | null): string | null {
  if (!loaderName) return null;
  const escaped = loaderName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = output.match(new RegExp(`(?:Cannot find package '${escaped}'|Cannot find module '${escaped}(?:/[^']*)?')`));
  if (!match) return null;
  const line = output.split("\n").map((row) => row.trim()).find((row) => row.includes(match[0]));
  return (line ?? match[0]).slice(0, 240);
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
  const listed = practiceGit(root, ["ls-files", "--", ...paths]);
  const tracked = new Set(listed.ok ? listed.out.split("\n").filter(Boolean) : []);
  const fresh = paths.filter((path) => !tracked.has(path));
  if (fresh.length) practiceGit(root, ["add", "--", ...fresh]);
  const cached = fresh.length ? practiceGit(root, ["diff", "--cached", "--no-color", "--no-ext-diff", "--no-renames", "--", ...fresh]) : { ok: true, out: "" };
  if (fresh.length) practiceGit(root, ["reset", "-q", "--", ...fresh]);
  const edited = paths.filter((path) => tracked.has(path));
  const unstaged = edited.length ? practiceGit(root, ["diff", "--no-color", "--no-ext-diff", "--no-renames", "--", ...edited]) : { ok: true, out: "" };
  return `${cached.ok ? cached.out : ""}${unstaged.ok ? unstaged.out : ""}`;
}

type SandboxHit = { blocked: SpecBlock } | { blocked: null; code: number | null; stdout: string };

/** One test inside the practice sandbox. A poison or unsafe result is cleaned and blocks the next git step. */
function runSandboxed(input: SpecInput, cmd: readonly string[]): SandboxHit {
  const launch = applyPracticeTestLaunch(input.root, cmd, input.testFile, "relaxed");
  const before = poisonStamp(input.root);
  const modules = input.nodeModules && existsSync(input.nodeModules) ? input.nodeModules : null;
  const ran = runInPracticeSandbox(input.root, launch.cmd, 60_000, { capture: true, nodePath: input.toolchain.nodePath, nodeModules: modules, extraEnv: launch.env });
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

/** A symbol the runner says the base does not provide, and the module the test imported it from. */
export interface MissingSymbol {
  symbol: string;
  module: string;
  /** Repo path the import names, when that path matches sourcePattern. */
  file: string | null;
  shape: "named" | "default" | "default-prop";
}

export type ScaffoldPlan =
  | { ok: true; files: { path: string; content: string }[]; symbols: MissingSymbol[]; expectations: Expectation[]; fit: SpecFit }
  | { ok: false; reason: SpecCant; symbols: MissingSymbol[] };

const PARAMS = ["a", "b", "c", "d", "e", "f"];

interface BindingRef { spec: string; file: string | null; local: string; imported: string; kind: "named" | "default" | "namespace" }
interface CallReplay { source: string; init: string | null }
interface CallFact {
  arity: number;
  args: unknown[] | null;
  /** Argument text for a call whose value was not concrete. `init` is the const it names, one step. */
  replay?: CallReplay[];
  reduced: { kind: "equal"; expected: unknown; deep?: boolean } | { kind: "boolean" | "type"; expected: unknown } | { kind: "throws" } | null;
}
interface Want { symbol: string; module: string; file: string | null; shape: MissingSymbol["shape"]; calls: CallFact[] }

function stripQuotes(text: string): string {
  if (text.length >= 2 && ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'")))) return text.slice(1, -1);
  return text;
}

function sameModule(spec: string, file: string | null, quoted: string): boolean {
  const norm = (s: string) => stripQuotes(s).replace(/\\/g, "/").replace(/^\.\//, "").replace(/\.(?:tsx?|mts|cts|jsx?|mjs|cjs)$/, "");
  const path = norm(quoted);
  if (norm(spec) === path) return true;
  const wanted = file === null ? "" : norm(file);
  if (wanted && (path === wanted || path.endsWith(`/${wanted}`))) return true;
  const stem = norm(spec).split("/").pop() ?? "";
  return stem.length > 0 && (path === stem || path.endsWith(`/${stem}`));
}

function impliedSource(fromFile: string, spec: string, sourcePattern: string, deny: readonly string[], exists: (path: string) => boolean): string | null {
  if (!spec.startsWith(".")) return null;
  const base = posix.normalize(posix.join(posix.dirname(fromFile), spec));
  if (base.startsWith("..") || base === "" || base.startsWith("/")) return null;
  const stem = base.replace(/\.(?:tsx?|mts|cts|jsx?|mjs|cjs)$/, "");
  const candidates = [...new Set([base, `${stem}.ts`, `${stem}.tsx`, `${stem}.mts`, `${stem}.cts`, posix.join(stem, "index.ts")])];
  const allowed = candidates.filter((path) => path !== fromFile && allowedSource(path, sourcePattern, deny));
  return allowed.find((path) => exists(path)) ?? allowed[0] ?? null;
}

/** A numeric literal's value. `_` separators are syntax, so `1_832_923` is 1832923, not NaN. */
function numberLiteral(text: string): number {
  return Number(text.replace(/_/g, ""));
}

function evalConcrete(node: ts.Expression): { ok: true; value: unknown } | { ok: false } {
  const expr = unwrap(node);
  if (ts.isStringLiteral(expr) || ts.isNoSubstitutionTemplateLiteral(expr)) return { ok: true, value: expr.text };
  if (ts.isNumericLiteral(expr)) return { ok: true, value: numberLiteral(expr.text) };
  if (expr.kind === ts.SyntaxKind.TrueKeyword) return { ok: true, value: true };
  if (expr.kind === ts.SyntaxKind.FalseKeyword) return { ok: true, value: false };
  if (expr.kind === ts.SyntaxKind.NullKeyword) return { ok: true, value: null };
  if (ts.isPrefixUnaryExpression(expr) && expr.operator === ts.SyntaxKind.MinusToken && ts.isNumericLiteral(expr.operand)) return { ok: true, value: -numberLiteral(expr.operand.text) };
  const sent = sentinelValue(expr);
  if (sent.ok) return sent; // spec-guard:sentinel-value
  if (ts.isArrayLiteralExpression(expr)) {
    const items: unknown[] = [];
    for (const el of expr.elements) {
      if (!ts.isExpression(el)) return { ok: false };
      const v = evalConcrete(el);
      if (!v.ok) return v;
      items.push(v.value);
    }
    return { ok: true, value: items };
  }
  if (ts.isObjectLiteralExpression(expr)) {
    const obj: Record<string, unknown> = {};
    for (const prop of expr.properties) {
      const member = concreteMember(prop);
      if (!member.ok) return { ok: false };
      const v = evalConcrete(member.init);
      if (!v.ok) return v;
      Object.defineProperty(obj, member.key, { value: v.value, enumerable: true, writable: true, configurable: true });
    }
    return { ok: true, value: obj };
  }
  return { ok: false };
}

/** The const initializer an identifier names, when that const is earlier in the same block. One step. */
function constInit(name: string, at: ts.Node, sf: ts.SourceFile): string | null {
  let node: ts.Node | undefined = at.parent;
  while (node) {
    if ((ts.isBlock(node) || ts.isSourceFile(node) || ts.isModuleBlock(node) || ts.isCaseClause(node) || ts.isDefaultClause(node)) && "statements" in node) {
      for (const st of node.statements) {
        if (!ts.isVariableStatement(st) || !(st.declarationList.flags & ts.NodeFlags.Const)) continue;
        for (const decl of st.declarationList.declarations) {
          if (!ts.isIdentifier(decl.name) || decl.name.text !== name || !decl.initializer) continue;
          if (decl.initializer.end > at.getStart(sf)) continue;
          return decl.initializer.getText(sf);
        }
      }
    }
    node = node.parent;
  }
  return null;
}

function replayArg(expr: ts.Expression, at: ts.Node, sf: ts.SourceFile): CallReplay {
  const source = expr.getText(sf);
  if (!ts.isIdentifier(expr)) return { source, init: null };
  return { source, init: constInit(expr.text, at, sf) };
}

function reducedOf(call: ts.CallExpression): CallFact["reduced"] {
  const parent = call.parent;
  if (ts.isCallExpression(parent) && ts.isIdentifier(parent.expression) && parent.expression.text === "typeof" && parent.arguments[0] === call) {
    const gp = parent.parent;
    const typeExpected = (node: ts.Expression | undefined): CallFact["reduced"] => {
      if (!node) return null;
      const v = evalConcrete(node);
      return v.ok && typeof v.value === "string" ? { kind: "type", expected: v.value } : null;
    };
    if (ts.isCallExpression(gp) && ts.isPropertyAccessExpression(gp.expression) && gp.arguments[0] === parent && ts.isIdentifier(gp.expression.expression)) {
      const method = gp.expression.name.text;
      const obj = gp.expression.expression.text;
      if ((obj === "assert" || obj === "assertStrict") && (method === "equal" || method === "strictEqual")) return typeExpected(gp.arguments[1]);
    }
    if (ts.isCallExpression(gp) && ts.isIdentifier(gp.expression) && gp.expression.text === "expect" && gp.arguments[0] === parent) {
      const outer = gp.parent;
      if (ts.isPropertyAccessExpression(outer) && ts.isCallExpression(outer.parent) && outer.parent.expression === outer) {
        const method = outer.name.getText();
        if (method === "toBe" || method === "toEqual" || method === "toStrictEqual") return typeExpected(outer.parent.arguments[0]);
      }
    }
  }
  if (ts.isCallExpression(parent) && ts.isIdentifier(parent.expression) && parent.expression.text === "expect" && parent.arguments[0] === call) {
    const outer = parent.parent;
    if (ts.isPropertyAccessExpression(outer) && ts.isCallExpression(outer.parent) && outer.parent.expression === outer) {
      const name = outer.name.text;
      if (name === "toBeUndefined") return { kind: "equal", expected: undefined }; // spec-guard:be-undefined
        if ((name === "toBe" || name === "toEqual" || name === "toStrictEqual") && outer.parent.arguments[0]) {
          const v = evalConcrete(outer.parent.arguments[0]);
          return v.ok ? { kind: "equal", expected: v.value, ...(name === "toBe" ? {} : { deep: true }) } : null;
        }
      if (name === "toThrow" || name === "toThrowError") return { kind: "throws" };
    }
  }
  if (!ts.isCallExpression(parent) || !ts.isPropertyAccessExpression(parent.expression) || !ts.isIdentifier(parent.expression.expression)) return throwsOf(call);
  const method = parent.expression.name.text;
  const obj = parent.expression.expression.text;
  const at = parent.arguments.indexOf(call);
  const other = parent.arguments[at === 0 ? 1 : 0];
  if ((obj === "assert" || obj === "assertStrict") && at === 0) {
    if ((method === "equal" || method === "strictEqual" || method === "deepEqual" || method === "deepStrictEqual") && other) {
      const v = evalConcrete(other);
      const deep = method === "deepEqual" || method === "deepStrictEqual";
      return v.ok ? { kind: "equal", expected: v.value, ...(deep ? { deep: true } : {}) } : null;
    }
    if (method === "ok") return { kind: "boolean", expected: true };
  }
  if ((obj === "t" || obj === "tt") && (at === 0 || at === 1)) {
    if (at === 0 && method === "true") return { kind: "boolean", expected: true };
    if (at === 0 && method === "false") return { kind: "boolean", expected: false };
    if ((method === "is" || method === "deepEqual") && other) {
      const v = evalConcrete(other);
      return v.ok ? { kind: "equal", expected: v.value, ...(method === "deepEqual" ? { deep: true } : {}) } : null;
    }
  }
  return throwsOf(call);
}

function throwsOf(call: ts.CallExpression): CallFact["reduced"] {
  let fn: ts.Node = call;
  if (ts.isExpressionStatement(call.parent) && ts.isBlock(call.parent.parent)) fn = call.parent.parent.parent ?? call;
  else if ((ts.isArrowFunction(call.parent) || ts.isFunctionExpression(call.parent)) && call.parent.body === call) fn = call.parent;
  else return null;
  if (ts.isBlock(fn)) fn = fn.parent;
  if (!ts.isArrowFunction(fn) && !ts.isFunctionExpression(fn)) return null;
  const use = fn.parent;
  if (!ts.isCallExpression(use) || use.arguments[0] !== fn || !ts.isPropertyAccessExpression(use.expression) || !ts.isIdentifier(use.expression.expression)) return null;
  const method = use.expression.name.text;
  const obj = use.expression.expression.text;
  if ((obj === "assert" || obj === "assertStrict") && (method === "throws" || method === "rejects")) return { kind: "throws" };
  if ((obj === "t" || obj === "tt") && method === "throws") return { kind: "throws" };
  return null;
}

function exportedModifier(node: ts.Node): boolean {
  return ts.canHaveModifiers(node) && (ts.getModifiers(node) ?? []).some((mod) => mod.kind === ts.SyntaxKind.ExportKeyword);
}

/** What `name` already is in a module. "default" asks about the default export. */
function exportKind(text: string, name: string): "absent" | "function" | "other" {
  const sf = ts.createSourceFile("module.ts", text, ts.ScriptTarget.Latest, true);
  const locals = new Map<string, "function" | "other">();
  for (const st of sf.statements) {
    if (ts.isFunctionDeclaration(st) && st.name) locals.set(st.name.text, st.body ? "function" : "other");
    if (ts.isClassDeclaration(st) && st.name) locals.set(st.name.text, "other");
    if (ts.isVariableStatement(st)) for (const decl of st.declarationList.declarations) {
      if (!ts.isIdentifier(decl.name)) continue;
      const init = decl.initializer;
      locals.set(decl.name.text, init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) ? "function" : "other");
    }
  }
  if (name === "default") {
    for (const st of sf.statements) {
      if (ts.isExportAssignment(st)) {
        if (ts.isIdentifier(st.expression)) return locals.get(st.expression.text) ?? "other";
        return ts.isArrowFunction(st.expression) || ts.isFunctionExpression(st.expression) ? "function" : "other";
      }
      if (exportedModifier(st) && ts.canHaveModifiers(st) && (ts.getModifiers(st) ?? []).some((mod) => mod.kind === ts.SyntaxKind.DefaultKeyword)) {
        if (ts.isFunctionDeclaration(st)) return "function";
        return "other";
      }
    }
    return "absent";
  }
  for (const st of sf.statements) {
    if (exportedModifier(st) && ts.isFunctionDeclaration(st) && st.name?.text === name) return st.body ? "function" : "other";
    if (exportedModifier(st) && (ts.isClassDeclaration(st) || ts.isInterfaceDeclaration(st) || ts.isTypeAliasDeclaration(st)) && st.name?.text === name) return "other";
    if (exportedModifier(st) && ts.isVariableStatement(st)) for (const decl of st.declarationList.declarations) if (ts.isIdentifier(decl.name) && decl.name.text === name) return locals.get(name) ?? "other";
    if (ts.isExportDeclaration(st) && st.exportClause && ts.isNamedExports(st.exportClause)) {
      for (const el of st.exportClause.elements) {
        const local = (el.propertyName ?? el.name).text;
        if (el.name.text === name) return locals.get(local) ?? "other";
      }
    }
  }
  return "absent";
}

function peerFunctions(text: string): { name: string; arity: number }[] {
  const sf = ts.createSourceFile("module.ts", text, ts.ScriptTarget.Latest, true);
  const out: { name: string; arity: number }[] = [];
  for (const st of sf.statements) {
    if (!exportedModifier(st)) continue;
    if (ts.isFunctionDeclaration(st) && st.name && st.body && !st.parameters.some((p) => p.dotDotDotToken)) out.push({ name: st.name.text, arity: st.parameters.length });
    if (ts.isVariableStatement(st)) for (const decl of st.declarationList.declarations) {
      if (!ts.isIdentifier(decl.name) || !decl.initializer) continue;
      const init = decl.initializer;
      if ((ts.isArrowFunction(init) || ts.isFunctionExpression(init)) && !init.parameters.some((p) => p.dotDotDotToken)) out.push({ name: decl.name.text, arity: init.parameters.length });
    }
  }
  return out;
}

function valueType(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "unknown[]";
  if (typeof value === "object") return "Record<string, unknown>";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return typeof value;
  return "unknown";
}

function unionType(values: unknown[]): string {
  return [...new Set(values.map(valueType))].join(" | ") || "unknown";
}

function paramType(values: unknown[]): string {
  if (values.every((value) => Array.isArray(value) && value.every((item) => item && typeof item === "object" && !Array.isArray(item)))) {
    const objects = values.flat() as Record<string, unknown>[];
    const keys = [...new Set(objects.flatMap((item) => Object.keys(item)))].filter(ident);
    const fields = keys.map((key) => `${key}: ${unionType(objects.map((item) => item[key]))}`);
    return fields.length ? `{ ${fields.join("; ")} }[]` : "Record<string, unknown>[]";
  }
  if (values.every((value) => Array.isArray(value) && (value as unknown[]).every((item) => typeof item === "number"))) return "number[]";
  return unionType(values);
}

function resultType(values: unknown[]): string {
  if (values.every((value) => Array.isArray(value))) {
    const items = values.flat();
    if (items.every((item) => typeof item === "string")) return "string[]";
    if (items.every((item) => typeof item === "number")) return "number[]";
    return "unknown[]";
  }
  return unionType(values);
}

interface Example { args: unknown[]; expected: unknown }

function literalBody(examples: Example[]): string | null {
  const first = JSON.stringify(examples[0]?.expected);
  if (!examples.every((ex) => JSON.stringify(ex.expected) === first)) return null;
  return `  return ${first};`;
}

function typeofBody(examples: Example[]): string | null {
  if (examples.some((ex) => ex.args.length !== 1)) return null;
  const groups = new Map<string, unknown>();
  for (const ex of examples) {
    const arg = ex.args[0];
    const kind = arg === null || Array.isArray(arg) || typeof arg === "object" ? "" : typeof arg;
    if (kind !== "string" && kind !== "number" && kind !== "boolean") return null;
    const prev = groups.get(kind);
    if (prev !== undefined && JSON.stringify(prev) !== JSON.stringify(ex.expected)) return null;
    if (!groups.has(kind)) groups.set(kind, ex.expected);
  }
  if (groups.size < 2) return null;
  const lines = [...groups].map(([kind, value]) => `  if (typeof a === ${JSON.stringify(kind)}) return ${JSON.stringify(value)};`);
  lines.push(`  throw new Error("unreachable");`);
  return lines.join("\n");
}

function gapParses(expected: string, args: string[]): string[][] {
  const out: string[][] = [];
  const walk = (at: number, index: number, gaps: string[]) => {
    if (out.length >= 8) return;
    if (index === args.length) { out.push([...gaps, expected.slice(at)]); return; }
    const arg = args[index]!;
    let from = at;
    for (let n = 0; n < 6; n++) {
      const found = expected.indexOf(arg, from);
      if (found < 0) return;
      walk(found + arg.length, index + 1, [...gaps, expected.slice(at, found)]);
      from = found + 1;
    }
  };
  walk(0, 0, []);
  return out;
}

function shown(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function stringBody(examples: Example[]): string[] | null {
  if (examples.some((ex) => typeof ex.expected !== "string")) return null;
  const rows: { args: string[]; expected: string }[] = [];
  for (const ex of examples) {
    const args = ex.args.map(shown);
    if (args.some((arg) => arg === null) || typeof ex.expected !== "string") return null;
    rows.push({ args: args as string[], expected: ex.expected });
  }
  const full = rows.filter((ex) => ex.args.every((arg) => arg.length > 0));
  if (!full.length) return null;
  let common: string[][] | null = null;
  for (const ex of full) {
    const parses = gapParses(ex.expected, ex.args);
    const keys = new Set(parses.map((gaps) => JSON.stringify(gaps)));
    common = common === null ? parses.filter((gaps, i) => parses.findIndex((other) => JSON.stringify(other) === JSON.stringify(gaps)) === i) : common.filter((gaps) => keys.has(JSON.stringify(gaps)));
    if (!common.length) return null;
  }
  if (!common || common.length !== 1) return null;
  const gaps = common[0]!;
  for (const ex of rows) {
    let built = gaps[0] ?? "";
    ex.args.forEach((arg, i) => { built += arg + (gaps[i + 1] ?? ""); });
    if (built !== ex.expected) return null;
  }
  return gaps;
}

const CMP: { op: string; fn: (left: number, right: number) => boolean }[] = [
  { op: ">", fn: (left, right) => left > right }, { op: ">=", fn: (left, right) => left >= right },
  { op: "<", fn: (left, right) => left < right }, { op: "<=", fn: (left, right) => left <= right },
  { op: "===", fn: (left, right) => left === right }, { op: "!==", fn: (left, right) => left !== right },
];

function safeShift(n: number, delta: number): number | null {
  if (!Number.isSafeInteger(n)) return null;
  const next = n + delta;
  return Number.isSafeInteger(next) ? next : null;
}

/**
 * `a > n` and `a >= n+1` are the same predicate on safe integers, and so are `a < n` and `a <= n-1`.
 * The shift is refused when n+1 or n-1 is not a safe integer. Equality is not a greater-than class.
 */
export function integerCmpClass(op: string, n: number): string | null {
  if (op === ">") { const next = safeShift(n, 1); return next === null ? null : `gt:${next}`; }
  if (op === ">=") { return safeShift(n, -1) === null ? null : `gt:${n}`; }
  if (op === "<") { return safeShift(n, -1) === null ? null : `lt:${n}`; }
  if (op === "<=") { const next = safeShift(n, 1); return next === null ? null : `lt:${next}`; }
  if (op === "===") return Number.isSafeInteger(n) ? `eq:${n}` : null;
  if (op === "!==") return Number.isSafeInteger(n) ? `ne:${n}` : null;
  return null;
}

function closedCmp(text: string): boolean {
  return text.includes(">=") || text.includes("<=");
}

/**
 * One text per integer class, for the integer conjunction only. The first form
 * is stored, then a closed bound (`>=` / `<=`) whose literal is an example
 * replaces an open bound in that same class. A bare comparison does not use this.
 */
function chooseCmp(fits: { text: string; key: string }[]): Map<string, string> {
  const chosen = new Map<string, string>();
  for (const fit of fits) {
    const prev = chosen.get(fit.key);
    if (!prev) chosen.set(fit.key, fit.text);
    if (prev && closedCmp(fit.text) && !closedCmp(prev)) chosen.set(fit.key, fit.text); // cmp-guard:closed-bound
  }
  return chosen;
}

function comparisonBody(examples: Example[]): string | null {
  if (!examples.length || examples.some((ex) => typeof ex.expected !== "boolean" || ex.args.some((arg) => typeof arg !== "number"))) return null;
  const arity = examples[0]!.args.length;
  if (examples.some((ex) => ex.args.length !== arity) || (arity !== 1 && arity !== 2)) return null;
  const integers = examples.every((ex) => (ex.args as number[]).every((arg) => Number.isInteger(arg)));
  const fits: { text: string; key: string }[] = [];
  const constants = [...new Set(examples.flatMap((ex) => ex.args as number[]))];
  const keep = (text: string, fn: (args: number[]) => boolean, key: string) => {
    if (examples.every((ex) => fn(ex.args as number[]) === ex.expected)) fits.push({ text, key });
  };
  if (arity === 2) for (const pred of CMP) keep(`a ${pred.op} b`, (args) => pred.fn(args[0]!, args[1]!), `raw:a ${pred.op} b`);
  for (const n of constants) for (const pred of CMP) {
    const cls = integers ? integerCmpClass(pred.op, n) : null;
    const shown = JSON.stringify(n);
    keep(`a ${pred.op} ${shown}`, (args) => pred.fn(args[0]!, n), cls ?? `raw:a ${pred.op} ${shown}`);
    if (arity === 2) keep(`b ${pred.op} ${shown}`, (args) => pred.fn(args[1]!, n), cls ? `b:${cls}` : `raw:b ${pred.op} ${shown}`);
  }
  const chosen = new Map<string, string>();
  for (const fit of fits) if (!chosen.has(fit.key)) chosen.set(fit.key, fit.text);
  if (chosen.size !== 1) return null;
  return `  return ${[...chosen.values()][0]};`;
}

/** Arity-1 numeric comparisons, including more than one integer class. */
function arity1Chosen(examples: Example[]): Map<string, string> | null {
  if (!examples.length || examples.some((ex) => ex.args.length !== 1 || typeof ex.expected !== "boolean" || typeof ex.args[0] !== "number")) return null;
  const integers = examples.every((ex) => Number.isInteger(ex.args[0] as number));
  const constants = [...new Set(examples.map((ex) => ex.args[0] as number))];
  const fits: { text: string; key: string }[] = [];
  for (const n of constants) for (const pred of CMP) {
    if (!examples.every((ex) => pred.fn(ex.args[0] as number, n) === ex.expected)) continue;
    const cls = integers ? integerCmpClass(pred.op, n) : null;
    fits.push({ text: `a ${pred.op} ${JSON.stringify(n)}`, key: cls ?? `raw:${pred.op}:${JSON.stringify(n)}` });
  }
  return chooseCmp(fits);
}

function countedInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value);
}

/**
 * `Number.isInteger(a) && <comparison>` when every example that is not an integer is
 * false, and the integers have one class. A string, a boolean, or a fraction is false
 * under `Number.isInteger`, which is what those examples say. No such example, no
 * conjunction: the bare comparison already says the same thing on those integers.
 * A non-integer the examples accept is not this shape.
 */
function integerBody(examples: Example[]): string | null {
  if (!examples.length || examples.some((ex) => ex.args.length !== 1 || typeof ex.expected !== "boolean")) return null;
  const others = examples.filter((ex) => !countedInteger(ex.args[0]));
  if (!others.length) return null; // int-guard:needs-fraction
  if (others.some((ex) => ex.expected !== false)) return null; // int-guard:others-false
  const integers = examples.filter((ex) => countedInteger(ex.args[0]));
  const chosen = arity1Chosen(integers);
  if (!chosen || chosen.size !== 1) return null; // int-guard:one-class
  return `  return Number.isInteger(a) && ${[...chosen.values()][0]};`;
}

/** Every combination of boolean arguments is present, so one formula fits. */
function booleanBody(examples: Example[]): string | null {
  if (!examples.length || examples.some((ex) => ex.args.some((arg) => typeof arg !== "boolean") || typeof ex.expected !== "boolean")) return null;
  const arity = examples[0]!.args.length;
  if (arity < 1 || arity > 4 || examples.some((ex) => ex.args.length !== arity)) return null;
  const seen = new Map<string, boolean>();
  for (const ex of examples) {
    const key = ex.args.map((arg) => arg ? "1" : "0").join("");
    if (seen.has(key) && seen.get(key) !== ex.expected) return null;
    seen.set(key, ex.expected as boolean);
  }
  if (seen.size !== 2 ** arity) return null;
  const truths = [...seen].filter(([, value]) => value);
  if (!truths.length) return "  return false;";
  if (truths.length === seen.size) return "  return true;";
  const terms = truths.map(([key]) => key.split("").map((bit, i) => bit === "1" ? PARAMS[i]! : `!${PARAMS[i]}`).join(" && "));
  const expr = terms.length === 1 ? terms[0]! : terms.map((term) => `(${term})`).join(" || ");
  return `  return ${expr};`;
}

function ident(name: string): boolean {
  return /^[A-Za-z_$][\w$]*$/.test(name);
}

function objectRows(value: unknown): Record<string, unknown>[] | null {
  if (!Array.isArray(value) || value.some((item) => !item || typeof item !== "object" || Array.isArray(item))) return null;
  return value as Record<string, unknown>[];
}

/** One field, kept when another field has one boolean value, when no other projection fits. */
function projectBody(examples: Example[]): string | null {
  if (examples.some((ex) => ex.args.length !== 1 || !Array.isArray(ex.expected))) return null;
  const rows = examples.map((ex) => ({ items: objectRows(ex.args[0]), expected: ex.expected as unknown[] }));
  if (rows.some((row) => !row.items)) return null;
  const objects = rows.flatMap((row) => row.items!);
  const keys = [...new Set(objects.flatMap((item) => Object.keys(item)))].filter(ident);
  const fits: string[] = [];
  for (const project of keys) for (const filter of keys) if (filter !== project) for (const polarity of [true, false]) {
    const ok = rows.every((row) => JSON.stringify(row.items!.filter((item) => item[filter] === polarity).map((item) => item[project])) === JSON.stringify(row.expected));
    if (ok) fits.push(`a.filter((item) => item.${filter} === ${polarity}).map((item) => item.${project})`);
  }
  if (fits.length !== 1) return null;
  return `  return ${fits[0]};`;
}

/** Sum one numeric field of the objects whose other field equals the second argument. */
function sumBody(examples: Example[]): string | null {
  if (examples.some((ex) => ex.args.length !== 2 || typeof ex.expected !== "number")) return null;
  const rows = examples.map((ex) => ({ items: objectRows(ex.args[0]), key: ex.args[1], expected: ex.expected as number }));
  if (rows.some((row) => !row.items)) return null;
  const keys = [...new Set(rows.flatMap((row) => row.items!.flatMap((item) => Object.keys(item))))].filter(ident);
  const fits: string[] = [];
  for (const match of keys) for (const value of keys) if (match !== value) {
    const ok = rows.every((row) => row.items!.filter((item) => item[match] === row.key).reduce((sum, item) => sum + (typeof item[value] === "number" ? item[value] : Number.NaN), 0) === row.expected);
    if (ok) fits.push(`a.filter((item) => item.${match} === b).reduce((sum, item) => sum + item.${value}, 0)`);
  }
  if (fits.length !== 1) return null;
  return `  return ${fits[0]};`;
}

/** The text before one separator, when exactly one separator reproduces every example. */
function splitBody(examples: Example[]): string | null {
  if (examples.some((ex) => ex.args.length !== 1 || typeof ex.args[0] !== "string" || typeof ex.expected !== "string")) return null;
  const seps = new Set<string>();
  for (const ex of examples) for (const ch of ex.args[0] as string) if (!/[A-Za-z0-9]/.test(ch)) seps.add(ch);
  const fits = [...seps].filter((sep) => examples.every((ex) => (ex.args[0] as string).split(sep)[0] === ex.expected));
  if (fits.length !== 1) return null;
  return `  return a.split(${JSON.stringify(fits[0])})[0];`;
}

function renderReturn(parts: string[]): string {
  return `  return ${parts.join(" + ")};`;
}

const TAG_ORDER = ["boolean", "number", "string", "array", "object"] as const;
type ValueTag = (typeof TAG_ORDER)[number];

/** An array is not an object. null and undefined are not tags: nil owns them, and only together. A function, a symbol, or a bigint is not a tag. */
function valueTag(value: unknown): ValueTag | "nullish" | null {
  if (value === null || value === undefined) return "nullish";
  if (Array.isArray(value)) return "array";
  const kind = typeof value;
  if (kind === "boolean" || kind === "number" || kind === "string") return kind;
  if (kind === "object") return "object";
  return null;
}

const TAG_TEXT: Record<ValueTag, string> = {
  boolean: 'typeof a === "boolean"',
  number: 'typeof a === "number"',
  string: 'typeof a === "string"',
  array: "Array.isArray(a)",
  object: 'typeof a === "object"',
};

/**
 * One tag test. Exactly one tag is true on every example of that tag, every
 * other tag that appears is false, and the object tag is refused: `typeof`
 * object is also true for arrays and for null.
 */
function tagBody(examples: Example[]): string | null {
  if (!examples.length || examples.some((ex) => ex.args.length !== 1 || typeof ex.expected !== "boolean")) return null;
  const rows: { tag: ValueTag; expected: boolean }[] = [];
  for (const ex of examples) {
    const tag = valueTag(ex.args[0]);
    if (tag === "nullish") {
      if (ex.expected === true) return null;
      continue;
    }
    if (!tag) return null;
    rows.push({ tag, expected: ex.expected as boolean });
  }
  if (!rows.length) return null;
  const present = TAG_ORDER.filter((tag) => rows.some((row) => row.tag === tag));
  const of = (tag: ValueTag) => rows.filter((row) => row.tag === tag);
  const same = (tag: ValueTag) => of(tag).every((row) => row.expected === of(tag)[0]!.expected);
  if (present.some((tag) => !same(tag))) return null; // tag-guard:uniform
  const trues = present.filter((tag) => of(tag)[0]!.expected === true);
  const falses = present.filter((tag) => of(tag)[0]!.expected === false);
  if (trues.length !== 1) return null; // tag-guard:one-tag
  if (trues[0] === "object") return null; // tag-guard:not-object
  if (!falses.length) return null; // tag-guard:others-false
  return `  return ${TAG_TEXT[trues[0]!]};`;
}

/** `a == null` when null and undefined are both true and every other example is false. */
function nilBody(examples: Example[]): string | null {
  if (!examples.length || examples.some((ex) => ex.args.length !== 1 || typeof ex.expected !== "boolean")) return null;
  const isNull = (ex: Example) => ex.args[0] === null;
  const isUndef = (ex: Example) => ex.args[0] === undefined;
  const nulls = examples.filter(isNull);
  const undefs = examples.filter(isUndef);
  const rest = examples.filter((ex) => !isNull(ex) && !isUndef(ex));
  if (!nulls.length || !undefs.length) return null; // nil-guard:both
  if (nulls.some((ex) => ex.expected !== true) || undefs.some((ex) => ex.expected !== true)) return null; // nil-guard:nullish-true
  if (!rest.length || rest.some((ex) => ex.expected !== false)) return null; // nil-guard:others-false
  return "  return a == null;";
}

/** Index 0 of an array or, for the array guard's mutant, of a string. */
function atZero(value: unknown): { ok: true; value: unknown } | { ok: false } {
  if (typeof value === "string" || Array.isArray(value)) return { ok: true, value: value.length === 0 ? undefined : value[0] };
  return { ok: false };
}

/** `a[0]`, including undefined for an empty array. A constant first element stays the literal. */
function headBody(examples: Example[]): string | null {
  if (!examples.length || examples.some((ex) => ex.args.length !== 1)) return null;
  if (!examples.every((ex) => Array.isArray(ex.args[0]))) return null; // head-guard:arrays
  if (!examples.every((ex) => { const got = atZero(ex.args[0]); return got.ok && Object.is(got.value, ex.expected); })) return null; // head-guard:index0
  const shown = examples.map((ex) => Object.is(ex.expected, undefined) ? "undefined" : JSON.stringify(ex.expected));
  if (new Set(shown).size < 2) return null; // head-guard:varies
  return "  return a[0];";
}

/** Code-point reverse of a string, or of an array of strings for the string guard's mutant. */
function reversedText(value: unknown): string | null {
  if (typeof value === "string") return Array.from(value).reverse().join("");
  if (Array.isArray(value) && value.every((item) => typeof item === "string")) return value.slice().reverse().join("");
  return null;
}

/** `Array.from(a).reverse().join("")` when a non-palindrome shows it is not the identity. */
function reverseBody(examples: Example[]): string | null {
  if (!examples.length || examples.some((ex) => ex.args.length !== 1 || typeof ex.expected !== "string")) return null;
  if (!examples.every((ex) => typeof ex.args[0] === "string")) return null; // rev-guard:strings
  if (!examples.every((ex) => reversedText(ex.args[0]) === ex.expected)) return null; // rev-guard:reversed
  if (examples.every((ex) => ex.args[0] === ex.expected)) return null; // rev-guard:not-identity
  return '  return Array.from(a).reverse().join("");';
}

/** The last element, or undefined for an empty array. A string is not an array. */
function atLast(value: unknown): { ok: true; value: unknown } | { ok: false } {
  if (typeof value === "string" || Array.isArray(value)) return { ok: true, value: value.length === 0 ? undefined : value[value.length - 1] };
  return { ok: false };
}

/** `a[a.length - 1]`, including undefined for `[]`. One repeated last element stays the literal. */
function lastBody(examples: Example[]): string | null {
  if (!examples.length || examples.some((ex) => ex.args.length !== 1)) return null;
  if (!examples.every((ex) => Array.isArray(ex.args[0]))) return null; // last-guard:arrays
  if (!examples.every((ex) => { const got = atLast(ex.args[0]); return got.ok && Object.is(got.value, ex.expected); })) return null; // last-guard:index
  const shown = examples.map((ex) => Object.is(ex.expected, undefined) ? "undefined" : JSON.stringify(ex.expected));
  if (new Set(shown).size < 2) return null; // last-guard:varies
  return "  return a[a.length - 1];";
}

/**
 * `a === null` when null is true, undefined is present and false, and every
 * other example is false. Missing undefined is also `a == null`. Both nullish
 * values true is nil, not this.
 */
function nullBody(examples: Example[]): string | null {
  if (!examples.length || examples.some((ex) => ex.args.length !== 1 || typeof ex.expected !== "boolean")) return null;
  const isNull = (ex: Example) => ex.args[0] === null;
  const isUndef = (ex: Example) => ex.args[0] === undefined;
  const nulls = examples.filter(isNull);
  const undefs = examples.filter(isUndef);
  const rest = examples.filter((ex) => !isNull(ex) && !isUndef(ex));
  if (!nulls.length || nulls.some((ex) => ex.expected !== true)) return null; // null-guard:null-true
  if (!undefs.length || undefs.some((ex) => ex.expected !== false)) return null; // null-guard:undef-false
  if (rest.some((ex) => ex.expected !== false)) return null; // null-guard:others-false
  return "  return a === null;";
}

/**
 * `a != null` when null and undefined are both present and false, and every
 * other example is true. Both nullish values true is nil. Null true is strict null.
 */
function notNilBody(examples: Example[]): string | null {
  if (!examples.length || examples.some((ex) => ex.args.length !== 1 || typeof ex.expected !== "boolean")) return null;
  const isNull = (ex: Example) => ex.args[0] === null;
  const isUndef = (ex: Example) => ex.args[0] === undefined;
  const nulls = examples.filter(isNull);
  const undefs = examples.filter(isUndef);
  const rest = examples.filter((ex) => !isNull(ex) && !isUndef(ex));
  if (!nulls.length || !undefs.length) return null; // notnil-guard:both
  if (nulls.some((ex) => ex.expected !== false) || undefs.some((ex) => ex.expected !== false)) return null; // notnil-guard:nullish-false
  if (!rest.length || rest.some((ex) => ex.expected !== true)) return null; // notnil-guard:others-true
  return "  return a != null;";
}

/** Every element but the last. A string is not an array. */
function atInitial(value: unknown): { ok: true; value: unknown } | { ok: false } {
  if (typeof value === "string" || Array.isArray(value)) return { ok: true, value: value.slice(0, -1) };
  return { ok: false };
}

/** `a.slice(0, -1)`. One repeated prefix stays the literal. */
function initialBody(examples: Example[]): string | null {
  if (!examples.length || examples.some((ex) => ex.args.length !== 1)) return null;
  if (!examples.every((ex) => Array.isArray(ex.args[0]))) return null; // init-guard:arrays
  if (!examples.every((ex) => { const got = atInitial(ex.args[0]); return got.ok && deepSame(got.value, ex.expected); })) return null; // init-guard:prefix
  const shown = examples.map((ex) => JSON.stringify(ex.expected));
  if (new Set(shown).size < 2) return null; // init-guard:varies
  return "  return a.slice(0, -1);";
}

/** Every element but the first. A string is not an array. */
function atTail(value: unknown): { ok: true; value: unknown } | { ok: false } {
  if (typeof value === "string" || Array.isArray(value)) return { ok: true, value: value.slice(1) };
  return { ok: false };
}

/** `a.slice(1)`. One repeated suffix stays the literal. */
function tailBody(examples: Example[]): string | null {
  if (!examples.length || examples.some((ex) => ex.args.length !== 1)) return null;
  if (!examples.every((ex) => Array.isArray(ex.args[0]))) return null; // tail-guard:arrays
  if (!examples.every((ex) => { const got = atTail(ex.args[0]); return got.ok && deepSame(got.value, ex.expected); })) return null; // tail-guard:rest
  const shown = examples.map((ex) => JSON.stringify(ex.expected));
  if (new Set(shown).size < 2) return null; // tail-guard:varies
  return "  return a.slice(1);";
}

/** `a.slice(0, b)` when the second argument is a number and the result is that prefix. */
function takeBody(examples: Example[]): string | null {
  if (!examples.length || examples.some((ex) => ex.args.length !== 2 || typeof ex.args[1] !== "number" || !Number.isFinite(ex.args[1]))) return null;
  if (!examples.every((ex) => Array.isArray(ex.args[0]))) return null; // take-guard:arrays
  if (!examples.every((ex) => deepSame((ex.args[0] as unknown[]).slice(0, ex.args[1] as number), ex.expected))) return null; // take-guard:count
  const shown = examples.map((ex) => JSON.stringify(ex.expected));
  if (new Set(shown).size < 2) return null; // take-guard:varies
  return "  return a.slice(0, b);";
}

function finiteCount(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** `slice` on an array or, for the array guard's mutant, on a string. */
function sliced(value: string | unknown[], start: number, end?: number): unknown {
  if (typeof value === "string") return end === undefined ? value.slice(start) : value.slice(start, end);
  return end === undefined ? value.slice(start) : value.slice(start, end);
}

function asSequence(value: unknown): string | unknown[] | null {
  if (typeof value === "string" || Array.isArray(value)) return value;
  return null;
}

/** Drop a clamped count from the front. A negative count keeps the sequence. */
function atDrop(value: unknown, count: unknown): { ok: true; value: unknown } | { ok: false } {
  const seq = asSequence(value);
  const n = finiteCount(count);
  if (!seq || n === null) return { ok: false };
  return { ok: true, value: sliced(seq, Math.max(n, 0)) };
}

/**
 * `a.slice(Math.max(b, 0))`. A negative count is required: without it,
 * `a.slice(b)` says the same thing on the examples. One repeated result stays the literal.
 */
function dropBody(examples: Example[]): string | null {
  if (!examples.length || examples.some((ex) => ex.args.length !== 2)) return null;
  if (!examples.every((ex) => Array.isArray(ex.args[0]))) return null; // drop-guard:arrays
  if (!examples.every((ex) => { const got = atDrop(ex.args[0], ex.args[1]); return got.ok && deepSame(got.value, ex.expected); })) return null; // drop-guard:rest
  if (!examples.some((ex) => (ex.args[1] as number) < 0)) return null; // drop-guard:negative
  const shown = examples.map((ex) => JSON.stringify(ex.expected));
  if (new Set(shown).size < 2) return null; // drop-guard:varies
  return "  return a.slice(Math.max(b, 0));";
}

/** A count the published end-slice accepts: any number, including `NaN`, or `undefined`. */
function endCount(value: unknown): number | undefined | null {
  if (value === undefined || typeof value === "number") return value as number | undefined;
  return null;
}

/**
 * Published `dropRight`: `Math.min(-count, 0)`, then a copy when that is `0`,
 * otherwise `slice(0, n)`. `NaN` and `undefined` become `[]`. A finite
 * non-positive count copies the sequence.
 */
function atDropRight(value: unknown, count: unknown): { ok: true; value: unknown } | { ok: false } {
  const seq = asSequence(value);
  const n = endCount(count);
  if (!seq || n === null) return { ok: false };
  const end = Math.min(-(n as number), 0);
  return { ok: true, value: end === 0 ? sliced(seq, 0) : sliced(seq, 0, end) };
}

/**
 * `Math.min(-b, 0) === 0 ? a.slice() : a.slice(0, Math.min(-b, 0))`.
 * This is the published function on every count, including `NaN` and `undefined`.
 * A finite non-positive count has to be present: `a.slice(0, -b)` is empty at zero.
 */
function dropRightBody(examples: Example[]): string | null {
  if (!examples.length || examples.some((ex) => ex.args.length !== 2)) return null;
  if (!examples.every((ex) => Array.isArray(ex.args[0]))) return null; // dright-guard:arrays
  if (!examples.every((ex) => { const got = atDropRight(ex.args[0], ex.args[1]); return got.ok && deepSame(got.value, ex.expected); })) return null; // dright-guard:rest
  if (!examples.some((ex) => typeof ex.args[1] === "number" && (ex.args[1] as number) <= 0)) return null; // dright-guard:nonpos
  const shown = examples.map((ex) => JSON.stringify(ex.expected));
  if (new Set(shown).size < 2) return null; // dright-guard:varies
  return "  return Math.min(-b, 0) === 0 ? a.slice() : a.slice(0, Math.min(-b, 0));";
}

/**
 * Published `takeRight`: empty when `count <= 0`, otherwise `slice(-count)`.
 * `NaN` and `undefined` are not `<= 0`, so they copy the sequence. A finite
 * non-positive count is empty, which `slice(-count)` is not.
 */
function atTakeRight(value: unknown, count: unknown): { ok: true; value: unknown } | { ok: false } {
  const seq = asSequence(value);
  const n = endCount(count);
  if (!seq || n === null) return { ok: false };
  return { ok: true, value: (n as number) <= 0 ? [] : sliced(seq, -(n as number)) };
}

/**
 * `b <= 0 ? [] : a.slice(-b)`. `b > 0 ? a.slice(-b) : []` returns `[]` for
 * `NaN` and `undefined`; the published function copies the array there.
 */
function takeRightBody(examples: Example[]): string | null {
  if (!examples.length || examples.some((ex) => ex.args.length !== 2)) return null;
  if (!examples.every((ex) => Array.isArray(ex.args[0]))) return null; // tright-guard:arrays
  if (!examples.every((ex) => { const got = atTakeRight(ex.args[0], ex.args[1]); return got.ok && deepSame(got.value, ex.expected); })) return null; // tright-guard:rest
  if (!examples.some((ex) => typeof ex.args[1] === "number" && (ex.args[1] as number) <= 0)) return null; // tright-guard:nonpos
  const shown = examples.map((ex) => JSON.stringify(ex.expected));
  if (new Set(shown).size < 2) return null; // tright-guard:varies
  return "  return b <= 0 ? [] : a.slice(-b);";
}

function upperFirstText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function capitalizeText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
}

function lowerFirstText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  return value.charAt(0).toLowerCase() + value.slice(1);
}

function oneString(examples: Example[]): boolean {
  return examples.length > 0 && examples.every((ex) => ex.args.length === 1);
}

/**
 * `a.charAt(0).toUpperCase() + a.slice(1).toLowerCase()`. Some later character
 * must change case. If the tail is already lower, upper-first is the same function.
 */
function capitalizeBody(examples: Example[]): string | null {
  if (!oneString(examples)) return null;
  if (!examples.every((ex) => capitalizeText(ex.args[0]) === ex.expected)) return null; // cap-guard:cased
  if (!examples.some((ex) => upperFirstText(ex.args[0]) !== ex.expected)) return null; // cap-guard:lowered
  const shown = examples.map((ex) => JSON.stringify(ex.expected));
  if (new Set(shown).size < 2) return null; // cap-guard:varies
  return "  return a.charAt(0).toUpperCase() + a.slice(1).toLowerCase();";
}

/**
 * `a.charAt(0).toUpperCase() + a.slice(1)`. Some later character must stay
 * upper. If every tail is already lower, capitalize is the same function.
 */
function upperFirstBody(examples: Example[]): string | null {
  if (!oneString(examples)) return null;
  if (!examples.every((ex) => upperFirstText(ex.args[0]) === ex.expected)) return null; // upper-guard:cased
  if (!examples.some((ex) => capitalizeText(ex.args[0]) !== ex.expected)) return null; // upper-guard:kept
  const shown = examples.map((ex) => JSON.stringify(ex.expected));
  if (new Set(shown).size < 2) return null; // upper-guard:varies
  return "  return a.charAt(0).toUpperCase() + a.slice(1);";
}

/**
 * `a.charAt(0).toLowerCase() + a.slice(1)`. Some later character must stay
 * upper, so the whole string is not `toLowerCase()`.
 */
function lowerFirstBody(examples: Example[]): string | null {
  if (!oneString(examples)) return null;
  if (!examples.every((ex) => lowerFirstText(ex.args[0]) === ex.expected)) return null; // lower-guard:cased
  if (!examples.some((ex) => typeof ex.args[0] === "string" && (ex.args[0] as string).toLowerCase() !== ex.expected)) return null; // lower-guard:kept
  const shown = examples.map((ex) => JSON.stringify(ex.expected));
  if (new Set(shown).size < 2) return null; // lower-guard:varies
  return "  return a.charAt(0).toLowerCase() + a.slice(1);";
}

/**
 * `a === undefined` when undefined is true, null is present and false, and
 * every other example is false. Missing null is also `a == null`.
 */
function undefBody(examples: Example[]): string | null {
  if (!examples.length || examples.some((ex) => ex.args.length !== 1 || typeof ex.expected !== "boolean")) return null;
  const isUndef = (ex: Example) => ex.args[0] === undefined;
  const isNull = (ex: Example) => ex.args[0] === null;
  const undefs = examples.filter(isUndef);
  const nulls = examples.filter(isNull);
  const rest = examples.filter((ex) => !isUndef(ex) && !isNull(ex));
  if (!undefs.length || undefs.some((ex) => ex.expected !== true)) return null; // undef-guard:undef-true
  if (!nulls.length || nulls.some((ex) => ex.expected !== false)) return null; // undef-guard:null-false
  if (rest.some((ex) => ex.expected !== false)) return null; // undef-guard:others-false
  return "  return a === undefined;";
}

/** The published `words` split. `match` resets `lastIndex`. The emitted body uses a fresh literal. */
const WORD_RE_SRC = String.raw`/\p{Lu}?\p{Ll}+|[0-9]+|\p{Lu}+(?!\p{Ll})|\p{Emoji_Presentation}|\p{Extended_Pictographic}|\p{L}+/gu`;
const CASE_SPLIT = new RegExp(WORD_RE_SRC.slice(1, WORD_RE_SRC.lastIndexOf("/")), WORD_RE_SRC.slice(WORD_RE_SRC.lastIndexOf("/") + 1));
const WORDS_EXPR = `Array.from(a.match(${WORD_RE_SRC}) ?? [])`;

/**
 * Words of a string, or, for the string guard's mutant, the array already given.
 * An array is not split again: the published function only accepts a string.
 */
function splitWords(value: unknown): string[] | null {
  if (typeof value === "string") return Array.from(value.match(CASE_SPLIT) ?? []);
  if (Array.isArray(value) && value.every((item) => typeof item === "string")) return [...value];
  return null;
}

/** A separator split that does not break camel case or acronyms. */
function asciiWords(value: string): string[] {
  return value.split(/[^A-Za-z0-9]+/).filter((word) => word.length > 0);
}

function lowerJoin(value: unknown, sep: string): string | null {
  const parts = splitWords(value);
  if (!parts) return null;
  return parts.map((word) => word.toLowerCase()).join(sep);
}

/**
 * `Array.from(a.match(CASE_SPLIT) ?? [])`. Some word must be a camel or
 * acronym break. A separator-only split is a different function, and one
 * repeated word list stays the literal.
 */
function wordsBody(examples: Example[]): string | null {
  if (!examples.length || examples.some((ex) => ex.args.length !== 1)) return null;
  if (!examples.every((ex) => typeof ex.args[0] === "string")) return null; // words-guard:strings
  if (!examples.every((ex) => { const got = splitWords(ex.args[0]); return got !== null && deepSame(got, ex.expected); })) return null; // words-guard:split
  if (examples.some((ex) => typeof ex.args[0] === "string") && !examples.some((ex) => typeof ex.args[0] === "string" && !deepSame(asciiWords(ex.args[0] as string), ex.expected))) return null; // words-guard:camel
  return `  return ${WORDS_EXPR};`;
}

/**
 * `words(a).map(lower).join("-")`. A snake join of the same words is a
 * different function, and so is a split that does not break camel case.
 */
function kebabBody(examples: Example[]): string | null {
  if (!examples.length || examples.some((ex) => ex.args.length !== 1)) return null;
  if (!examples.every((ex) => typeof ex.args[0] === "string")) return null; // kebab-guard:strings
  if (!examples.every((ex) => lowerJoin(ex.args[0], "-") === ex.expected)) return null; // kebab-guard:joined
  if (!examples.some((ex) => lowerJoin(ex.args[0], "_") !== ex.expected)) return null; // kebab-guard:hyphen
  if (examples.some((ex) => typeof ex.args[0] === "string") && !examples.some((ex) => typeof ex.args[0] === "string" && asciiWords(ex.args[0] as string).map((word) => word.toLowerCase()).join("-") !== ex.expected)) return null; // kebab-guard:camel
  return `  return ${WORDS_EXPR}.map((word) => word.toLowerCase()).join("-");`;
}

/** `words(a).map(lower).join("_")`. The hyphen join is kebab, not this. */
function snakeBody(examples: Example[]): string | null {
  if (!examples.length || examples.some((ex) => ex.args.length !== 1)) return null;
  if (!examples.every((ex) => typeof ex.args[0] === "string")) return null; // snake-guard:strings
  if (!examples.every((ex) => lowerJoin(ex.args[0], "_") === ex.expected)) return null; // snake-guard:joined
  if (!examples.some((ex) => lowerJoin(ex.args[0], "-") !== ex.expected)) return null; // snake-guard:underscore
  if (examples.some((ex) => typeof ex.args[0] === "string") && !examples.some((ex) => typeof ex.args[0] === "string" && asciiWords(ex.args[0] as string).map((word) => word.toLowerCase()).join("_") !== ex.expected)) return null; // snake-guard:camel
  return `  return ${WORDS_EXPR}.map((word) => word.toLowerCase()).join("_");`;
}

/** Published camel case: the first word lower, every later word capitalized. */
function camelText(value: unknown): string | null {
  const parts = splitWords(value);
  if (!parts) return null;
  if (!parts.length) return "";
  const [first, ...rest] = parts;
  return first.toLowerCase() + rest.map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()).join("");
}

/** The same join on a separator split, which leaves an acronym as one word. */
function looseCamel(value: string): string {
  const parts = asciiWords(value);
  if (!parts.length) return "";
  const [first, ...rest] = parts;
  return first.toLowerCase() + rest.map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()).join("");
}

/**
 * First word lower, later words capitalized, joined with nothing. A
 * separator-only split agrees until an acronym or a camel boundary appears.
 */
function camelBody(examples: Example[]): string | null {
  if (!examples.length || examples.some((ex) => ex.args.length !== 1)) return null;
  if (!examples.every((ex) => typeof ex.args[0] === "string")) return null; // camel-guard:strings
  if (!examples.every((ex) => camelText(ex.args[0]) === ex.expected)) return null; // camel-guard:joined
  if (!examples.some((ex) => { const parts = splitWords(ex.args[0]); return parts !== null && parts.length > 1; })) return null; // camel-guard:hump
  if (examples.some((ex) => typeof ex.args[0] === "string") && !examples.some((ex) => typeof ex.args[0] === "string" && looseCamel(ex.args[0] as string) !== ex.expected)) return null; // camel-guard:boundary
  return `  return ((words) => words.length === 0 ? "" : words[0].toLowerCase() + words.slice(1).map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()).join(""))(${WORDS_EXPR});`;
}

function capWord(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}

function casedJoin(value: unknown, sep: string, map: (word: string) => string): string | null {
  const parts = splitWords(value);
  if (!parts) return null;
  return parts.map(map).join(sep);
}

function pascalText(value: unknown): string | null {
  return casedJoin(value, "", capWord);
}

function upperText(value: unknown): string | null {
  return casedJoin(value, " ", (word) => word.toUpperCase());
}

function constantText(value: unknown): string | null {
  return casedJoin(value, "_", (word) => word.toUpperCase());
}

function startText(value: unknown): string | null {
  return casedJoin(value, " ", capWord);
}

function sentenceText(value: unknown): string | null {
  const parts = splitWords(value);
  if (!parts) return null;
  return parts.map((word, i) => i === 0 ? capWord(word) : word.toLowerCase()).join(" ");
}

function asciiJoin(value: string, sep: string, map: (word: string, index: number) => string): string {
  return asciiWords(value).map(map).join(sep);
}

function manyWords(value: unknown): boolean {
  const parts = splitWords(value);
  return parts !== null && parts.length > 1;
}

/**
 * Each word capitalized, joined with nothing. One word is capitalize, so
 * some example has two words. A first word with no cased letter is camel.
 */
function pascalBody(examples: Example[]): string | null {
  if (!examples.length || examples.some((ex) => ex.args.length !== 1)) return null;
  if (!examples.every((ex) => typeof ex.args[0] === "string")) return null; // pascal-guard:strings
  if (!examples.every((ex) => pascalText(ex.args[0]) === ex.expected)) return null; // pascal-guard:joined
  if (!examples.some((ex) => manyWords(ex.args[0]))) return null; // pascal-guard:hump
  if (!examples.some((ex) => camelText(ex.args[0]) !== ex.expected)) return null; // pascal-guard:camel
  return `  return ((words) => words.map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()).join(""))(${WORDS_EXPR});`;
}

/**
 * Words uppercased and joined with `_`. One word is the space join, and a
 * word with no cased letter is snake.
 */
function constantBody(examples: Example[]): string | null {
  if (!examples.length || examples.some((ex) => ex.args.length !== 1)) return null;
  if (!examples.every((ex) => typeof ex.args[0] === "string")) return null; // constant-guard:strings
  if (!examples.every((ex) => constantText(ex.args[0]) === ex.expected)) return null; // constant-guard:joined
  if (!examples.some((ex) => upperText(ex.args[0]) !== ex.expected)) return null; // constant-guard:space
  if (!examples.some((ex) => lowerJoin(ex.args[0], "_") !== ex.expected)) return null; // constant-guard:snake
  return `  return ${WORDS_EXPR}.map((word) => word.toUpperCase()).join("_");`;
}

/**
 * Words lowercased and joined with a space. One word is kebab, snake, and
 * camel. A first word with no cased letter is sentence case.
 */
function lowerCaseBody(examples: Example[]): string | null {
  if (!examples.length || examples.some((ex) => ex.args.length !== 1)) return null;
  if (!examples.every((ex) => typeof ex.args[0] === "string")) return null; // lcase-guard:strings
  if (!examples.every((ex) => lowerJoin(ex.args[0], " ") === ex.expected)) return null; // lcase-guard:joined
  if (!examples.some((ex) => lowerJoin(ex.args[0], "-") !== ex.expected)) return null; // lcase-guard:hyphen
  if (!examples.some((ex) => sentenceText(ex.args[0]) !== ex.expected)) return null; // lcase-guard:sentence
  if (examples.some((ex) => typeof ex.args[0] === "string") && !examples.some((ex) => typeof ex.args[0] === "string" && asciiJoin(ex.args[0] as string, " ", (word) => word.toLowerCase()) !== ex.expected)) return null; // lcase-guard:boundary
  return `  return ${WORDS_EXPR}.map((word) => word.toLowerCase()).join(" ");`;
}

/**
 * Words uppercased and joined with a space. The loop in the published
 * function is this join, including on `""`. One word is constant case. A
 * word with no cased letter is the space join of the lower words.
 */
function upperCaseBody(examples: Example[]): string | null {
  if (!examples.length || examples.some((ex) => ex.args.length !== 1)) return null;
  if (!examples.every((ex) => typeof ex.args[0] === "string")) return null; // ucase-guard:strings
  if (!examples.every((ex) => upperText(ex.args[0]) === ex.expected)) return null; // ucase-guard:joined
  if (!examples.some((ex) => constantText(ex.args[0]) !== ex.expected)) return null; // ucase-guard:score
  if (!examples.some((ex) => lowerJoin(ex.args[0], " ") !== ex.expected)) return null; // ucase-guard:lower
  if (examples.some((ex) => typeof ex.args[0] === "string") && !examples.some((ex) => typeof ex.args[0] === "string" && asciiJoin(ex.args[0] as string, " ", (word) => word.toUpperCase()) !== ex.expected)) return null; // ucase-guard:boundary
  return `  return ${WORDS_EXPR}.map((word) => word.toUpperCase()).join(" ");`;
}

/**
 * Each word capitalized, joined with a space. `trim` does not change the
 * split. A later word with no cased letter is sentence case, and one word is
 * that same string.
 */
function startBody(examples: Example[]): string | null {
  if (!examples.length || examples.some((ex) => ex.args.length !== 1)) return null;
  if (!examples.every((ex) => typeof ex.args[0] === "string")) return null; // start-guard:strings
  if (!examples.every((ex) => startText(ex.args[0]) === ex.expected)) return null; // start-guard:joined
  if (!examples.some((ex) => sentenceText(ex.args[0]) !== ex.expected)) return null; // start-guard:sentence
  if (examples.some((ex) => typeof ex.args[0] === "string") && !examples.some((ex) => typeof ex.args[0] === "string" && asciiJoin(ex.args[0] as string, " ", capWord) !== ex.expected)) return null; // start-guard:boundary
  return `  return ${WORDS_EXPR}.map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()).join(" ");`;
}

/**
 * The first word capitalized, later words lowercased, joined with a space.
 * `trim` does not change the split. A later word with a cased letter is start
 * case. A first word with no cased letter is lower case.
 */
function sentenceBody(examples: Example[]): string | null {
  if (!examples.length || examples.some((ex) => ex.args.length !== 1)) return null;
  if (!examples.every((ex) => typeof ex.args[0] === "string")) return null; // sentence-guard:strings
  if (!examples.every((ex) => sentenceText(ex.args[0]) === ex.expected)) return null; // sentence-guard:joined
  if (!examples.some((ex) => startText(ex.args[0]) !== ex.expected)) return null; // sentence-guard:start
  if (!examples.some((ex) => lowerJoin(ex.args[0], " ") !== ex.expected)) return null; // sentence-guard:lower
  if (examples.some((ex) => typeof ex.args[0] === "string") && !examples.some((ex) => typeof ex.args[0] === "string" && asciiJoin(ex.args[0] as string, " ", (word, i) => i === 0 ? capWord(word) : word.toLowerCase()) !== ex.expected)) return null; // sentence-guard:boundary
  return `  return ((words) => words.map((word, i) => i === 0 ? word.charAt(0).toUpperCase() + word.slice(1).toLowerCase() : word.toLowerCase()).join(" "))(${WORDS_EXPR});`;
}

/** Array elements, or the characters of a string for the array guard's mutant. */
function asItems(value: unknown): unknown[] | null {
  if (Array.isArray(value)) return value;
  if (typeof value === "string") return Array.from(value);
  return null;
}

/** Published `difference`: `Set.has`, which is `includes` on plain values. */
function filteredOut(left: unknown, right: unknown): unknown[] | null {
  const items = asItems(left);
  const gone = asItems(right);
  if (!items || !gone) return null;
  return items.filter((item) => !gone.includes(item));
}

/**
 * `a.filter((item) => !b.includes(item))`. This is SameValueZero, including
 * `NaN` and `-0`. Something has to be removed: a disjoint pair is also `a`.
 */
function differenceBody(examples: Example[]): string | null {
  if (!examples.length || examples.some((ex) => ex.args.length !== 2)) return null;
  if (!examples.every((ex) => Array.isArray(ex.args[0]) && Array.isArray(ex.args[1]))) return null; // diff-guard:arrays
  if (!examples.every((ex) => { const got = filteredOut(ex.args[0], ex.args[1]); return got !== null && deepSame(got, ex.expected); })) return null; // diff-guard:rest
  if (examples.every((ex) => Array.isArray(ex.args[0])) && !examples.some((ex) => Array.isArray(ex.args[0]) && Array.isArray(ex.expected) && (ex.expected as unknown[]).length < (ex.args[0] as unknown[]).length)) return null; // diff-guard:removed
  return "  return a.filter((item) => !b.includes(item));";
}

/** Published `intersection`: `Set.has`, which is `includes` on plain values. */
function filteredIn(left: unknown, right: unknown): unknown[] | null {
  const items = asItems(left);
  const stay = asItems(right);
  if (!items || !stay) return null;
  return items.filter((item) => stay.includes(item));
}

/**
 * `a.filter((item) => b.includes(item))`. Something has to be dropped: a
 * second array that contains the first is also `a`.
 */
function intersectionBody(examples: Example[]): string | null {
  if (!examples.length || examples.some((ex) => ex.args.length !== 2)) return null;
  if (!examples.every((ex) => Array.isArray(ex.args[0]) && Array.isArray(ex.args[1]))) return null; // inter-guard:arrays
  if (!examples.every((ex) => { const got = filteredIn(ex.args[0], ex.args[1]); return got !== null && deepSame(got, ex.expected); })) return null; // inter-guard:rest
  if (examples.every((ex) => Array.isArray(ex.args[0])) && !examples.some((ex) => Array.isArray(ex.args[0]) && Array.isArray(ex.expected) && (ex.expected as unknown[]).length < (ex.args[0] as unknown[]).length)) return null; // inter-guard:drops
  return "  return a.filter((item) => b.includes(item));";
}

/**
 * Published symmetric difference: unique items of the concatenation, without
 * the items `filter` keeps from the first array. `filter` skips a hole and
 * `includes` reads it as `undefined`, so one `includes` test is a different
 * function. `NaN` and `-0` follow `Set` and `includes`.
 */
function xorText(left: unknown, right: unknown): unknown[] | null {
  const a = asItems(left);
  const b = asItems(right);
  if (!a || !b) return null;
  const both = a.filter((item) => b.includes(item));
  return [...new Set(a.concat(b))].filter((item) => !both.includes(item));
}

/**
 * `difference(union(a, b), intersection(a, b))`. A disjoint pair is also the
 * union, so some shared item has to be removed.
 */
function xorBody(examples: Example[]): string | null {
  if (!examples.length || examples.some((ex) => ex.args.length !== 2)) return null;
  if (!examples.every((ex) => Array.isArray(ex.args[0]) && Array.isArray(ex.args[1]))) return null; // xor-guard:arrays
  if (!examples.every((ex) => { const got = xorText(ex.args[0], ex.args[1]); return got !== null && deepSame(got, ex.expected); })) return null; // xor-guard:rest
  if (!examples.some((ex) => { const got = xorText(ex.args[0], ex.args[1]); const left = asItems(ex.args[0]); const right = asItems(ex.args[1]); return got !== null && left !== null && right !== null && !deepSame([...new Set(left.concat(right))], got); })) return null; // xor-guard:shared
  return "  return ((u, both) => u.filter((item) => !both.includes(item)))([...new Set(a.concat(b))], a.filter((item) => b.includes(item)));";
}

/**
 * Published `at`. `Math.trunc(i) || 0` maps `NaN` to `0`. A negative index
 * counts from the end. A string is not an array.
 */
function indexed(value: unknown, indices: unknown): unknown[] | null {
  if (!Array.isArray(indices)) return null;
  const read = (length: number, at: (index: number) => unknown): unknown[] => indices.map((item) => {
    const n = Number.isInteger(item) ? (item as number) : Math.trunc(item as number) || 0;
    return at(n < 0 ? n + length : n);
  });
  if (Array.isArray(value)) return read(value.length, (index) => value[index]);
  if (typeof value === "string") return read(value.length, (index) => value[index]);
  return null;
}

/**
 * `b.map` of the truncated index. A negative index has to be present:
 * `b.map((i) => a[i])` agrees while every index is already non-negative.
 */
function atBody(examples: Example[]): string | null {
  if (!examples.length || examples.some((ex) => ex.args.length !== 2)) return null;
  if (!examples.every((ex) => Array.isArray(ex.args[0]) && Array.isArray(ex.args[1]))) return null; // at-guard:arrays
  if (!examples.every((ex) => { const got = indexed(ex.args[0], ex.args[1]); return got !== null && deepSame(got, ex.expected); })) return null; // at-guard:picked
  if (!examples.some((ex) => Array.isArray(ex.args[1]) && (ex.args[1] as unknown[]).some((item) => typeof item === "number" && item < 0))) return null; // at-guard:negative
  return "  return b.map((i) => a[(n => n < 0 ? n + a.length : n)(Number.isInteger(i) ? i : Math.trunc(i) || 0)]);";
}

/** Published `lerp`. `fraction === 1` returns `stop` even when the multiply rounds. */
function lerpAt(start: unknown, stop: unknown, fraction: unknown): unknown {
  return fraction === 1 ? stop : (start as number) + ((stop as number) - (start as number)) * (fraction as number);
}

/**
 * `c === 1 ? b : a + (b - a) * c`. The multiply form is a different function
 * at `c === 1` for some floats. A spec that is only `c === 1` is `b`.
 */
function lerpBody(examples: Example[]): string | null {
  if (!examples.length || examples.some((ex) => ex.args.length !== 3)) return null;
  if (!examples.every((ex) => ex.args.every((arg) => typeof arg === "number"))) return null; // lerp-guard:numbers
  if (!examples.every((ex) => Object.is(lerpAt(ex.args[0], ex.args[1], ex.args[2]), ex.expected))) return null; // lerp-guard:line
  if (examples.every((ex) => ex.args.every((arg) => typeof arg === "number")) && !examples.some((ex) => ex.args[2] === 1 && !Object.is((ex.args[0] as number) + ((ex.args[1] as number) - (ex.args[0] as number)) * (ex.args[2] as number), ex.expected))) return null; // lerp-guard:exact
  if (!examples.some((ex) => ex.args[2] !== 1)) return null; // lerp-guard:span
  return "  return c === 1 ? b : a + (b - a) * c;";
}

/** Published `inverseLerp`. Equal ends are `0`, not the `NaN` from dividing by zero. */
function ilerpAt(start: unknown, stop: unknown, value: unknown): unknown {
  return start === stop ? 0 : ((value as number) - (start as number)) / ((stop as number) - (start as number));
}

/**
 * `a === b ? 0 : (c - a) / (b - a)`. `0 === -0` is true, so both ends at zero
 * return `0`. A spec that is also `lerp` has `start` `0` and `stop` `1`.
 */
function ilerpBody(examples: Example[]): string | null {
  if (!examples.length || examples.some((ex) => ex.args.length !== 3)) return null;
  if (!examples.every((ex) => ex.args.every((arg) => typeof arg === "number"))) return null; // ilerp-guard:numbers
  if (!examples.every((ex) => Object.is(ilerpAt(ex.args[0], ex.args[1], ex.args[2]), ex.expected))) return null; // ilerp-guard:line
  if (!examples.some((ex) => ex.args[0] === ex.args[1] && !Object.is(((ex.args[2] as number) - (ex.args[0] as number)) / ((ex.args[1] as number) - (ex.args[0] as number)), ex.expected))) return null; // ilerp-guard:flat
  if (!examples.some((ex) => !Object.is(lerpAt(ex.args[0], ex.args[1], ex.args[2]), ex.expected))) return null; // ilerp-guard:apart
  return "  return a === b ? 0 : (c - a) / (b - a);";
}

const HEX_COLOR = /^[0-9a-fA-F]{3}$|^[0-9a-fA-F]{6}$/;

/** Published `parseHex`. A bad string is black. Three digits expand before the shift. */
function parseHexText(value: unknown): [number, number, number] | null {
  if (typeof value !== "string") return null;
  const raw = value.startsWith("#") ? value.slice(1) : value;
  if (!HEX_COLOR.test(raw)) return [0, 0, 0];
  const full = raw.length === 3 ? raw[0]! + raw[0] + raw[1]! + raw[1] + raw[2]! + raw[2] : raw;
  const n = parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/**
 * Strip one `#`, reject anything that is not 3 or 6 hex digits, expand 3
 * digits, then shift. An invalid string is `[0, 0, 0]`, so some example has
 * to be invalid and some example has to be three digits.
 */
function phexBody(examples: Example[]): string | null {
  if (!examples.length || examples.some((ex) => ex.args.length !== 1)) return null;
  if (!examples.every((ex) => { const got = parseHexText(ex.args[0]); return got !== null && deepSame(got, ex.expected); })) return null; // phex-guard:rgb
  if (!examples.some((ex) => { const raw = typeof ex.args[0] === "string" ? (ex.args[0].startsWith("#") ? ex.args[0].slice(1) : ex.args[0]) : null; return raw !== null && !HEX_COLOR.test(raw) && deepSame(ex.expected, [0, 0, 0]); })) return null; // phex-guard:blank
  if (!examples.some((ex) => { const raw = typeof ex.args[0] === "string" ? (ex.args[0].startsWith("#") ? ex.args[0].slice(1) : ex.args[0]) : null; return raw !== null && raw.length === 3 && HEX_COLOR.test(raw); })) return null; // phex-guard:short
  return "  return ((raw) => /^[0-9a-fA-F]{3}$|^[0-9a-fA-F]{6}$/.test(raw) ? ((full) => ((n) => [(n >> 16) & 255, (n >> 8) & 255, n & 255])(parseInt(full, 16)))(raw.length === 3 ? raw[0] + raw[0] + raw[1] + raw[1] + raw[2] + raw[2] : raw) : [0, 0, 0])(a.startsWith(\"#\") ? a.slice(1) : a);";
}

/** Published `zipObject`. The loop reads `keys.length` and `keys[i]`, so a `Set` is empty. */
function zobjText(keys: unknown, values: unknown): Record<PropertyKey, unknown> | null {
  if (keys == null || (typeof keys !== "string" && !Array.isArray(keys))) return null;
  if (values == null || (typeof values !== "string" && !Array.isArray(values))) return null;
  const out: Record<PropertyKey, unknown> = {};
  const list = keys as ArrayLike<PropertyKey>;
  const vals = values as ArrayLike<unknown>;
  for (let i = 0; i < list.length; i++) out[list[i]!] = vals[i];
  return out;
}

/**
 * Index loop, the same as the published function. A hole is `keys[i]`, which
 * is `undefined`. A `Set` has no `length`, so the loop does not run.
 * `Object.fromEntries` would keep a `__proto__` key as its own property.
 * Some value has to be missing.
 */
function zobjBody(examples: Example[]): string | null {
  if (!examples.length || examples.some((ex) => ex.args.length !== 2)) return null;
  if (!examples.every((ex) => Array.isArray(ex.args[0]) && Array.isArray(ex.args[1]))) return null; // zobj-guard:arrays
  if (!examples.every((ex) => { const got = zobjText(ex.args[0], ex.args[1]); return got !== null && deepSame(got, ex.expected); })) return null; // zobj-guard:built
  if (!examples.some((ex) => { const got = zobjText(ex.args[0], ex.args[1]); return got !== null && Object.keys(got).some((key) => got[key] === undefined); })) return null; // zobj-guard:missing
  return "  return ((o) => { for (let i = 0; i < a.length; i++) o[a[i]] = b[i]; return o; })({});";
}

/** Published `mean`: add `nums[i]` while `i < nums.length`, then divide by that length. */
function meanOf(value: unknown): number | null {
  if (typeof value !== "string" && !Array.isArray(value)) return null;
  const list = value as ArrayLike<number>;
  let sum = 0;
  for (let i = 0; i < list.length; i++) sum += list[i]!;
  return sum / list.length;
}

/**
 * Index sum divided by `a.length`. An empty list is `0 / 0`, which is `NaN`.
 * A hole is read as `undefined`, so the sum is `NaN`. A `Set` has no length,
 * so the sum stays `0` and the quotient is `NaN`.
 */
function meanBody(examples: Example[]): string | null {
  if (!examples.length || examples.some((ex) => ex.args.length !== 1)) return null;
  if (!examples.every((ex) => Array.isArray(ex.args[0]))) return null; // mean-guard:arrays
  if (!examples.every((ex) => { const got = meanOf(ex.args[0]); return got !== null && Object.is(got, ex.expected); })) return null; // mean-guard:avg
  if (!examples.some((ex) => (ex.args[0] as { length: number }).length === 0)) return null; // mean-guard:empty
  return "  return ((n) => { let s = 0; for (let i = 0; i < n; i++) s += a[i]; return s / n; })(a.length);";
}

const BG_OPEN = "\x1b[41m";
const BG_CLOSE = "\x1b[49m";

/** Published `bgRed`: re-open after a shared close, then around each newline. */
function bgText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const nested = value.includes(BG_CLOSE) ? value.replaceAll(BG_CLOSE, BG_CLOSE + BG_OPEN) : value;
  const lined = nested.includes("\n") ? nested.replaceAll(/\r?\n/g, (match) => BG_CLOSE + match + BG_OPEN) : nested;
  return BG_OPEN + lined + BG_CLOSE;
}

/**
 * The background wrap. A newline has to be present: `open + text + close`
 * leaves the next line unstyled. The close is rewritten before the newline.
 */
function bgBody(examples: Example[]): string | null {
  if (!examples.length || examples.some((ex) => ex.args.length !== 1)) return null;
  if (!examples.every((ex) => { const got = bgText(ex.args[0]); return got !== null && Object.is(got, ex.expected); })) return null; // bg-guard:wrap
  if (!examples.some((ex) => typeof ex.args[0] === "string" && ex.args[0].includes("\n"))) return null; // bg-guard:break
  return "  return ((open, close, text) => open + ((t) => t.includes(\"\\n\") ? t.replaceAll(/\\r?\\n/g, (m) => close + m + open) : t)(text.includes(close) ? text.replaceAll(close, close + open) : text) + close)(\"\\x1b[41m\", \"\\x1b[49m\", a);";
}

/** Published `chunk`. A size that is not a positive integer throws. `slice` keeps a hole. */
function chunkOf(value: unknown, size: unknown): unknown[] | null {
  if (typeof size !== "number" || !Number.isInteger(size) || size <= 0) return null;
  if (typeof value !== "string" && !Array.isArray(value)) return null;
  const length = (value as { length: number }).length;
  return Array.from({ length: Math.ceil(length / size) }, (_, i) => (value as { slice: (start: number, end: number) => unknown }).slice(i * size, i * size + size));
}

/**
 * Positive integer sizes only. The last chunk is shorter when the length is
 * not a multiple, so some size has to cut and some last chunk has to be short.
 */
function chunkBody(examples: Example[]): string | null {
  if (!examples.length || examples.some((ex) => ex.args.length !== 2)) return null;
  if (!examples.every((ex) => Array.isArray(ex.args[0]) && typeof ex.args[1] === "number")) return null; // chunk-guard:pair
  if (!examples.every((ex) => { const got = chunkOf(ex.args[0], ex.args[1]); return got !== null && deepSame(got, ex.expected); })) return null; // chunk-guard:parts
  if (!examples.some((ex) => typeof ex.args[1] === "number" && (ex.args[0] as { length: number }).length > (ex.args[1] as number))) return null; // chunk-guard:cut
  if (!examples.some((ex) => { const got = chunkOf(ex.args[0], ex.args[1]); const last = got === null ? null : got[got.length - 1] as { length: number } | undefined; return last != null && last.length < (ex.args[1] as number); })) return null; // chunk-guard:rest
  return "  return (!Number.isInteger(b) || b <= 0) ? (() => { throw new Error(\"Size must be an integer greater than zero.\"); })() : Array.from({ length: Math.ceil(a.length / b) }, (_, i) => a.slice(i * b, i * b + b));";
}

/** Published combinations. `Array.from` visits a hole as `undefined`. Order is by index. */
function comboOf(value: unknown, size: unknown): unknown[] | null {
  if (typeof size !== "number") return null;
  if (typeof value !== "string" && !Array.isArray(value)) return null;
  const go = (items: unknown[], r: number): unknown[] | null => {
    if (!Number.isInteger(r) || r < 0) return null;
    if (r > items.length) return [];
    if (r === 0) return [[]];
    return items.flatMap((item, i) => (go(items.slice(i + 1), r - 1) ?? []).map((rest) => [item].concat(rest as unknown[])));
  };
  return go(Array.from(value as ArrayLike<unknown>), size);
}

/**
 * Index combinations. `r === 0` is `[[]]`. A larger `r` is `[]`. A bad `r`
 * throws, so the recorded calls stay on a non-negative integer.
 */
function comboBody(examples: Example[]): string | null {
  if (!examples.length || examples.some((ex) => ex.args.length !== 2)) return null;
  if (!examples.every((ex) => Array.isArray(ex.args[0]) && typeof ex.args[1] === "number")) return null; // combo-guard:pair
  if (!examples.every((ex) => { const got = comboOf(ex.args[0], ex.args[1]); return got !== null && deepSame(got, ex.expected); })) return null; // combo-guard:rows
  if (!examples.some((ex) => ex.args[1] === 0)) return null; // combo-guard:zero
  if (!examples.some((ex) => typeof ex.args[1] === "number" && (ex.args[0] as unknown[]).length < (ex.args[1] as number))) return null; // combo-guard:over
  if (!examples.some((ex) => typeof ex.args[1] === "number" && (ex.args[1] as number) > 0 && (ex.args[0] as unknown[]).length > (ex.args[1] as number))) return null; // combo-guard:pick
  return "  return ((function comb(arr, r) { if (!Number.isInteger(r) || r < 0) throw new Error(\"r must be a non-negative integer.\"); const items = Array.from(arr); if (r > items.length) return []; if (r === 0) return [[]]; return items.flatMap((item, i) => comb(items.slice(i + 1), r - 1).map((rest) => [item].concat(rest))); })(a, b));";
}

/** Published nearest-rank percentile. `NaN` sorts as the smallest value. */
function pctOf(value: unknown, rank: unknown): number | null {
  if (!Array.isArray(value) || typeof rank !== "number") return null;
  if (Number.isNaN(Number(rank)) || rank < 0 || rank > 100) return null;
  if (value.length === 0) return Number.NaN;
  const sorted = value.slice().sort((left, right) => {
    const x = Number.isNaN(left) ? Number.NEGATIVE_INFINITY : left as number;
    const y = Number.isNaN(right) ? Number.NEGATIVE_INFINITY : right as number;
    return x - y;
  });
  if (rank === 0) return sorted[0] as number;
  return sorted[Math.ceil(sorted.length * (rank / 100)) - 1] as number;
}

/**
 * `slice` keeps the published order, including a `NaN` sorted as `-Infinity`.
 * An empty list is `NaN`. A rank outside `0..100` throws in the body.
 */
function pctBody(examples: Example[]): string | null {
  if (!examples.length || examples.some((ex) => ex.args.length !== 2)) return null;
  if (!examples.every((ex) => { const got = pctOf(ex.args[0], ex.args[1]); return got !== null && Object.is(got, ex.expected); })) return null; // pct-guard:rank
  if (!examples.some((ex) => ex.args[1] === 0 || ex.args[1] === 100)) return null; // pct-guard:ends
  if (!examples.some((ex) => Array.isArray(ex.args[0]) && (ex.args[0] as unknown[]).some((item) => typeof item === "number" && Number.isNaN(item)))) return null; // pct-guard:nan
  return "  return ((arr, p) => { if (Number.isNaN(Number(p))) throw new Error(\"Expected percentile to be a number but got \\\"\" + p + \"\\\".\"); if (p < 0) throw new Error(\"Expected percentile to be >= 0 but got \\\"\" + p + \"\\\".\"); if (p > 100) throw new Error(\"Expected percentile to be <= 100 but got \\\"\" + p + \"\\\".\"); if (arr.length === 0) return NaN; const sorted = arr.slice().sort((x, y) => (Number.isNaN(x) ? -Infinity : x) - (Number.isNaN(y) ? -Infinity : y)); return p === 0 ? sorted[0] : sorted[Math.ceil(sorted.length * (p / 100)) - 1]; })(a, b);";
}

/** Lodash `baseToString`, then a case change. Top-level null and undefined are `""`. */
function baseToString(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    let result = "";
    for (let i = 0; i < value.length; i++) {
      if (i > 0) result += ",";
      result += baseToString(value[i]);
    }
    return result;
  }
  if (typeof value === "symbol" || value instanceof Symbol) return value.toString();
  const result = `${value as string}`;
  if (result === "0" && Object.is(Number(value), -0)) return "-0";
  return result;
}

function casedText(value: unknown, upper: boolean): string {
  if (value == null) return "";
  const text = baseToString(value);
  return upper ? text.toUpperCase() : text.toLowerCase();
}

const CASED_BODY = "((base) => a == null ? \"\" : base(a))(function base(value) { if (typeof value === \"string\") return value; if (Array.isArray(value)) { let result = \"\"; for (let i = 0; i < value.length; i++) { if (i > 0) result += \",\"; result += base(value[i]); } return result; } if (typeof value === \"symbol\" || value instanceof Symbol) return value.toString(); const result = value + \"\"; return result === \"0\" && Object.is(Number(value), -0) ? \"-0\" : result; })";

/**
 * Whole-string upper case after the published string conversion. A letter has
 * to change, so an already-upper string is not this shape by itself.
 */
function touprBody(examples: Example[]): string | null {
  if (!examples.length || examples.some((ex) => ex.args.length !== 1)) return null;
  if (!examples.every((ex) => casedText(ex.args[0], true) === ex.expected)) return null; // toupr-guard:case
  if (!examples.some((ex) => typeof ex.args[0] === "string" && ex.args[0] !== ex.args[0].toUpperCase())) return null; // toupr-guard:rise
  if (!examples.some((ex) => typeof ex.args[0] === "string" && /[^ \p{L}]| {2}/u.test(ex.args[0]))) return null; // toupr-guard:mark
  return `  return ${CASED_BODY}.toUpperCase();`;
}

/**
 * Whole-string lower case after the same conversion. `'aba'` does not change,
 * so a palindrome is not this shape.
 */
function tolowBody(examples: Example[]): string | null {
  if (!examples.length || examples.some((ex) => ex.args.length !== 1)) return null;
  if (!examples.every((ex) => casedText(ex.args[0], false) === ex.expected)) return null; // tolow-guard:case
  if (!examples.some((ex) => typeof ex.args[0] === "string" && ex.args[0] !== ex.args[0].toLowerCase())) return null; // tolow-guard:sink
  if (!examples.some((ex) => typeof ex.args[0] === "string" && /[^ \p{L}]| {2}/u.test(ex.args[0]))) return null; // tolow-guard:mark
  return `  return ${CASED_BODY}.toLowerCase();`;
}

/**
 * Published compat `sum`. `undefined` elements are skipped, a hole is
 * `undefined`, and strings concatenate. `null` and an empty list are `0`.
 */
function itemsOf(value: unknown): unknown[] | null {
  if (value == null || typeof (value as { length?: unknown }).length !== "number") return null;
  return Array.from(value as ArrayLike<unknown>);
}

function csumOf(value: unknown): unknown {
  if (value == null || (value as { length?: number }).length == null || (value as { length: number }).length === 0) return 0;
  return Array.from(value as ArrayLike<unknown>).reduce<unknown>((result, current) => current === undefined ? result : result === undefined ? current : (result as number) + (current as number), undefined);
}

function csumBody(examples: Example[]): string | null {
  if (!examples.length || examples.some((ex) => ex.args.length !== 1)) return null;
  if (!examples.every((ex) => Array.isArray(ex.args[0]))) return null; // csum-guard:lists
  if (!examples.every((ex) => Object.is(csumOf(ex.args[0]), ex.expected))) return null; // csum-guard:total
  if (!examples.some((ex) => { const items = itemsOf(ex.args[0]); return items !== null && items.some((item) => item === undefined); })) return null; // csum-guard:skip
  if (!examples.some((ex) => { const items = itemsOf(ex.args[0]); return items !== null && items.some((item) => typeof item === "string"); })) return null; // csum-guard:text
  return "  return (!a || !a.length) ? 0 : Array.from(a).reduce((result, current) => current === undefined ? result : result === undefined ? current : result + current, undefined);";
}

const MAX_ARRAY_LENGTH = 4294967295;

/** Published `toFinite`, then drop the fraction toward zero. A symbol is `NaN`, which `toFinite` turns into `0`. */
function toIntegerOf(value: unknown): number {
  if (typeof value === "symbol" || (typeof value === "object" && value instanceof Symbol)) value = Number.NaN;
  if (!value) return Object.is(value, 0) || value === 0 ? (value as number) : 0;
  let n = Number(value);
  if (n === Infinity || n === -Infinity) n = (n < 0 ? -1 : 1) * Number.MAX_VALUE;
  else if (n !== n) return 0;
  const remainder = n % 1;
  return remainder ? n - remainder : n;
}

/** Published `toLength`: an integer from `0` through `2^32 - 1`. `-0` becomes `0`. */
function toLengthOf(value: unknown): number {
  if (value == null) return 0;
  return Math.min(Math.max(toIntegerOf(value), 0), MAX_ARRAY_LENGTH);
}

/**
 * A length in `0..2^32-1`. A negative number is `0`, and `'12px'` is `0`
 * rather than `12`. Some example has to be negative and some has to be junk.
 */
function tlenBody(examples: Example[]): string | null {
  if (!examples.length || examples.some((ex) => ex.args.length !== 1)) return null;
  if (!examples.every((ex) => Object.is(toLengthOf(ex.args[0]), ex.expected))) return null; // tlen-guard:fit
  if (!examples.some((ex) => typeof ex.args[0] === "number" && ex.args[0] < 0 && ex.expected === 0)) return null; // tlen-guard:neg
  if (!examples.some((ex) => typeof ex.args[0] === "string" && Number.isNaN(Number(ex.args[0])) && ex.expected === 0)) return null; // tlen-guard:junk
  if (!examples.some((ex) => typeof ex.args[0] === "number" && !Number.isInteger(ex.args[0]) && ex.expected !== ex.args[0])) return null; // tlen-guard:cut
  return "  return a == null ? 0 : Math.min(Math.max((value => { if (typeof value === \"symbol\" || (typeof value === \"object\" && value instanceof Symbol)) value = NaN; const finite = !value ? (value === 0 ? value : 0) : Number(value); const n = finite !== finite ? 0 : (finite === Infinity || finite === -Infinity ? (finite < 0 ? -1 : 1) * Number.MAX_VALUE : finite); const r = n % 1; return r ? n - r : n; })(a), 0), 4294967295);";
}

/** Published `toKey`. `-0` is the string `'-0'`, not `'0'`. */
function toKeyOf(value: unknown): string | symbol {
  if (typeof value === "string" || typeof value === "symbol") return value;
  if (value != null && typeof (value as { valueOf?: unknown }).valueOf === "function" && Object.is((value as { valueOf: () => unknown }).valueOf(), -0)) return "-0";
  return String(value);
}

/**
 * `-0` has to appear. Without that, `'aba'` is this function and also the
 * identity string.
 */
function tkeyBody(examples: Example[]): string | null {
  if (!examples.length || examples.some((ex) => ex.args.length !== 1)) return null;
  if (!examples.every((ex) => Object.is(toKeyOf(ex.args[0]), ex.expected))) return null; // tkey-guard:fit
  if (!examples.some((ex) => Object.is(ex.args[0], -0))) return null; // tkey-guard:sign
  return "  return typeof a === \"string\" || typeof a === \"symbol\" ? a : (a != null && typeof a.valueOf === \"function\" && Object.is(a.valueOf(), -0) ? \"-0\" : String(a));";
}

/**
 * Every recorded call returns its argument with `Object.is` and no transform.
 * Two results have to differ, so one repeated value stays the literal.
 * Some argument is not a string, so a palindrome stays the string concatenation.
 * `null` and `undefined` stay out: `clone` and `deepFreeze` return them unchanged.
 */
function idnBody(examples: Example[]): string | null {
  if (!examples.length || examples.some((ex) => ex.args.length !== 1)) return null;
  if (!examples.every((ex) => Object.is(ex.args[0], ex.expected)) || !examples.some((ex, i) => examples.slice(i + 1).some((other) => !Object.is(ex.expected, other.expected))) || !examples.some((ex) => typeof ex.args[0] !== "string")) return null; // idn-guard:fit
  if (examples.some((ex) => ex.args[0] == null)) return null; // idn-guard:value
  return "  return a;";
}

const UNESCAPE_MAP: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": "\"", "&#39;": "'" };

/** Published `unescape`. A run of zeros before `39` is still an apostrophe. */
function unescapeText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  return value.replace(/&(?:amp|lt|gt|quot|#(0+)?39);/g, (match) => UNESCAPE_MAP[match] ?? "'");
}

const UNESCAPE_ENTITY = /&(?:amp|lt|gt|quot|#(?:0+)?39);/;

/**
 * HTML unescape. Some argument has to contain one published entity:
 * `&amp;`, `&lt;`, `&gt;`, `&quot;`, or `&#39;` with optional leading zeros.
 * That argument is not a piece of the result, so it is not string concatenation.
 */
function uescBody(examples: Example[]): string | null {
  if (!examples.length || examples.some((ex) => ex.args.length !== 1)) return null;
  if (!examples.every((ex) => { const got = unescapeText(ex.args[0]); return got !== null && got === ex.expected; })) return null; // uesc-guard:fit
  if (!examples.some((ex) => typeof ex.args[0] === "string" && UNESCAPE_ENTITY.test(ex.args[0]))) return null; // uesc-guard:entity
  return "  return a.replace(/&(?:amp|lt|gt|quot|#(0+)?39);/g, (match) => ({ \"&amp;\": \"&\", \"&lt;\": \"<\", \"&gt;\": \">\", \"&quot;\": \"\\\"\", \"&#39;\": \"'\" })[match] || \"'\");";
}

/** Published string `dedent`: drop a blank first and last line, then the shared indent. */
function dedentText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const lines = value.replace(/\r\n/g, "\n").split("\n");
  if (lines.length > 0 && lines[0]!.trim() === "") lines.shift();
  if (lines.length > 0 && lines[lines.length - 1]!.trim() === "") lines.pop();
  let common = Infinity;
  for (const line of lines) {
    if (line.trim() === "") continue;
    let indent = 0;
    while (indent < line.length && (line[indent] === " " || line[indent] === "\t")) indent++;
    if (indent < common) common = indent;
  }
  if (common === Infinity) return "";
  return lines.map((line) => line.trim() === "" ? "" : line.slice(common)).join("\n");
}

/**
 * Shared leading indent. A newline has to appear. A one-line trim is this
 * function too, and the argument is not a piece of the result.
 */
function ddenBody(examples: Example[]): string | null {
  if (!examples.length || examples.some((ex) => ex.args.length !== 1)) return null;
  if (!examples.every((ex) => { const got = dedentText(ex.args[0]); return got !== null && got === ex.expected; })) return null; // dden-guard:fit
  if (!examples.some((ex) => typeof ex.args[0] === "string" && ex.args[0].includes("\n"))) return null; // dden-guard:line
  return "  const value = a; const rest = Array.prototype.slice.call(arguments, 1); const impl = (text) => { const lines = String(text).replace(/\\r\\n/g, \"\\n\").split(\"\\n\"); if (lines.length > 0 && lines[0].trim() === \"\") lines.shift(); if (lines.length > 0 && lines[lines.length - 1].trim() === \"\") lines.pop(); let common = Infinity; for (const line of lines) { if (line.trim() === \"\") continue; let indent = 0; while (indent < line.length && (line[indent] === \" \" || line[indent] === \"\\t\")) indent++; if (indent < common) common = indent; } if (common === Infinity) return \"\"; return lines.map((line) => line.trim() === \"\" ? \"\" : line.slice(common)).join(\"\\n\"); }; const shape = (strings) => { const first = strings[0]; const open = first.indexOf(\"\\n\"); if (open === -1 || first.slice(0, open).trim() !== \"\") throw new TypeError(\"Invalid opening line.\"); const last = strings[strings.length - 1]; const close = last.lastIndexOf(\"\\n\"); if (close === -1 || last.slice(close + 1).trim() !== \"\") throw new TypeError(\"Invalid closing line.\"); }; const partsOf = (strings) => { shape(strings); const parts = Array.from(strings); if (parts.length === 1) return [impl(parts[0])]; let mark = \"\\0\"; const joined = parts.join(\"\"); while (joined.includes(mark)) mark += \"\\0\"; return impl(parts.join(mark)).split(mark); }; const asRaw = (parts) => Object.assign(parts, { raw: parts }); if (typeof value === \"function\") return (strings, ...args) => value(asRaw(partsOf(strings)), ...args); if (typeof value === \"string\") return impl(value); const parts = partsOf(value); let text = parts[0]; for (let i = 0; i < rest.length; i++) text += String(rest[i]) + parts[i + 1]; return text;";
}

/** Published `toNumber`: a symbol is `NaN` instead of throwing. */
function plainNumber(value: unknown): number {
  if (typeof value === "symbol" || (typeof value === "object" && value instanceof Symbol)) return Number.NaN;
  return Number(value);
}

/**
 * Published `gt` / `lt`. Both strings compare as strings. Anything else uses
 * `toNumber`, so a symbol is false and an object uses `valueOf` then `toString`.
 */
function ordered(left: unknown, right: unknown, greater: boolean): boolean {
  if (typeof left === "string" && typeof right === "string") return greater ? left > right : left < right;
  return greater ? plainNumber(left) > plainNumber(right) : plainNumber(left) < plainNumber(right);
}

/** `a > b` for two strings, otherwise `toNumber(a) > toNumber(b)`. A string argument has to appear. */
function gtBody(examples: Example[]): string | null {
  if (!examples.length || examples.some((ex) => ex.args.length !== 2 || typeof ex.expected !== "boolean")) return null;
  if (!examples.every((ex) => ordered(ex.args[0], ex.args[1], true) === ex.expected)) return null; // gt-guard:fit
  if (!examples.some((ex) => typeof ex.args[0] === "string" || typeof ex.args[1] === "string")) return null; // gt-guard:text
  return "  return ((num) => typeof a === \"string\" && typeof b === \"string\" ? a > b : num(a) > num(b))((n) => typeof n === \"symbol\" || (typeof n === \"object\" && n instanceof Symbol) ? NaN : Number(n));";
}

/** `a < b` for two strings, otherwise `toNumber(a) < toNumber(b)`. A string argument has to appear. */
function ltBody(examples: Example[]): string | null {
  if (!examples.length || examples.some((ex) => ex.args.length !== 2 || typeof ex.expected !== "boolean")) return null;
  if (!examples.every((ex) => ordered(ex.args[0], ex.args[1], false) === ex.expected)) return null; // lt-guard:fit
  if (!examples.some((ex) => typeof ex.args[0] === "string" || typeof ex.args[1] === "string")) return null; // lt-guard:text
  return "  return ((num) => typeof a === \"string\" && typeof b === \"string\" ? a < b : num(a) < num(b))((n) => typeof n === \"symbol\" || (typeof n === \"object\" && n instanceof Symbol) ? NaN : Number(n));";
}

/** Published `gte`: string comparison, otherwise `toNumber`. */
function gteBody(examples: Example[]): string | null {
  if (!examples.length || examples.some((ex) => ex.args.length !== 2 || typeof ex.expected !== "boolean")) return null;
  if (!examples.every((ex) => (typeof ex.args[0] === "string" && typeof ex.args[1] === "string" ? (ex.args[0] as string) >= (ex.args[1] as string) : plainNumber(ex.args[0]) >= plainNumber(ex.args[1])) === ex.expected)) return null; // gte-guard:fit
  if (!examples.some((ex) => typeof ex.args[0] === "string" || typeof ex.args[1] === "string")) return null; // gte-guard:text
  return "  return ((num) => typeof a === \"string\" && typeof b === \"string\" ? a >= b : num(a) >= num(b))((n) => typeof n === \"symbol\" || (typeof n === \"object\" && n instanceof Symbol) ? NaN : Number(n));";
}

/**
 * Published `pull`. No `length` returns the value itself. Otherwise the array
 * is mutated with SameValueZero, and a hole stays a hole.
 */
function pullBody(examples: Example[]): string | null {
  if (!examples.length || examples.some((ex) => ex.args.length !== 2)) return null;
  const bare = (value: unknown) => value == null || (value as { length?: unknown }).length == null;
  if (!examples.every((ex) => bare(ex.args[0]) && Object.is(ex.args[0], ex.expected))) return null; // pul-guard:fit
  if (!examples.some((ex) => ex.args[0] === null) || !examples.some((ex) => ex.args[0] === undefined)) return null; // pul-guard:nullish
  return "  if (a == null || a.length == null) return a; const drop = new Set(Array.prototype.slice.call(arguments, 1)); let w = 0; for (let i = 0; i < a.length; i++) { if (drop.has(a[i])) continue; if (!Object.prototype.hasOwnProperty.call(a, i)) { delete a[w++]; continue; } a[w++] = a[i]; } a.length = w; return a;";
}

function arrayLike(value: unknown): value is ArrayLike<unknown> {
  return value != null && typeof value !== "function" && Number.isSafeInteger((value as { length?: unknown }).length) && ((value as { length: number }).length as number) >= 0;
}

function deepKeyOf(value: unknown): Array<string | symbol> {
  if (Array.isArray(value)) return value.map((item) => typeof item === "symbol" ? item : toKeyOf(item));
  if (typeof value === "symbol") return [value];
  if (typeof value !== "string") return [toKeyOf(value)];
  if (!value.includes(".") && !value.includes("[")) return [value];
  const result: string[] = [];
  let index = 0;
  let key = "";
  let quote = "";
  let bracket = false;
  let quoted = false;
  const numberKey = /^-?\d+(?:\.\d+)?$/;
  if (value.charCodeAt(0) === 46) result.push("");
  while (index < value.length) {
    const char = value[index]!;
    if (quote) {
      if (char === "\\" && index + 1 < value.length) { index++; key += value[index]; }
      else if (char === quote) quote = "";
      else key += char;
    } else if (bracket) {
      if (char === "\"" || char === "'") { quote = char; quoted = true; }
      else if (char === "]") {
        bracket = false;
        if (!quoted && key.includes(".") && !numberKey.test(key)) { for (const seg of key.split(".")) if (seg !== "") result.push(seg); }
        else result.push(key);
        key = "";
      } else key += char;
    } else if (char === "[") {
      bracket = true;
      quoted = false;
      if (key) { result.push(key); key = ""; }
    } else if (char === ".") {
      if (key) { result.push(key); key = ""; }
      const next = value[index + 1];
      if (next === undefined || next === ".") result.push("");
    } else key += char;
    index++;
  }
  if (key) result.push(key);
  return result;
}

/** Published `zipObjectDeep` for the recorded calls: paths, brackets, and missing values. */
function zdeOf(keys: unknown, values: unknown): Record<PropertyKey, unknown> | null {
  const result: Record<PropertyKey, unknown> = {};
  if (!arrayLike(keys)) return result;
  const vals = arrayLike(values) ? values : [];
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    if (key == null) continue;
    const path = Array.isArray(key) || typeof key === "symbol" || (typeof key === "string" && (key.includes(".") || key.includes("["))) ? deepKeyOf(key) : [toKeyOf(key)];
    if (!path.length) continue;
    let cur: Record<PropertyKey, unknown> = result;
    let blocked = false;
    for (let j = 0; j < path.length; j++) {
      const step = path[j]!;
      if (step === "__proto__" || step === "constructor" || step === "prototype") { blocked = true; break; }
      if (j === path.length - 1) { cur[step] = vals[i]; break; }
      const next = path[j + 1]!;
      const index = typeof next === "string" && /^(?:0|[1-9]\d*)$/.test(next);
      const slot = cur[step];
      if (slot == null || typeof slot !== "object") cur[step] = index ? [] : {};
      cur = cur[step] as Record<PropertyKey, unknown>;
    }
    if (blocked) continue;
  }
  return result;
}

/**
 * Nested paths. A flat zip would keep `'a.b'` as one key. Some path has to
 * contain `.` or `[`, and some value has to be missing.
 */
function zdeBody(examples: Example[]): string | null {
  if (!examples.length || examples.some((ex) => ex.args.length !== 2)) return null;
  if (!examples.every((ex) => { const got = zdeOf(ex.args[0], ex.args[1]); return got !== null && deepSame(got, ex.expected); })) return null; // zde-guard:built
  if (!examples.some((ex) => Array.isArray(ex.args[0]) && (ex.args[0] as unknown[]).some((key) => typeof key === "string" && (key.includes(".") || key.includes("["))))) return null; // zde-guard:nest
  if (!examples.some((ex) => { const got = zdeOf(ex.args[0], ex.args[1]); const hole = (v: unknown): boolean => v != null && typeof v === "object" && (Array.isArray(v) ? v.some((item) => item === undefined || hole(item)) : Object.keys(v).some((key) => (v as Record<string, unknown>)[key] === undefined || hole((v as Record<string, unknown>)[key]))); return got !== null && hole(got); })) return null; // zde-guard:miss
  return "  return ((keys, values) => { const like = (v) => v != null && typeof v !== \"function\" && Number.isSafeInteger(v.length) && v.length >= 0; const result = {}; if (!like(keys)) return result; const vals = like(values) ? values : []; const keyOf = (v) => typeof v === \"string\" || typeof v === \"symbol\" ? v : (v != null && typeof v.valueOf === \"function\" && Object.is(v.valueOf(), -0) ? \"-0\" : String(v)); const pathOf = (v) => { if (Array.isArray(v)) return v.map(keyOf); if (typeof v === \"symbol\") return [v]; if (typeof v !== \"string\" || (!v.includes(\".\") && !v.includes(\"[\"))) return [keyOf(v)]; const out = []; let i = 0, key = \"\", quote = \"\", bracket = false, quoted = false; if (v.charCodeAt(0) === 46) out.push(\"\"); while (i < v.length) { const ch = v[i]; if (quote) { if (ch === \"\\\\\" && i + 1 < v.length) { i++; key += v[i]; } else if (ch === quote) quote = \"\"; else key += ch; } else if (bracket) { if (ch === \"\\\"\" || ch === \"'\") { quote = ch; quoted = true; } else if (ch === \"]\") { bracket = false; if (!quoted && key.includes(\".\") && !/^-?\\d+(?:\\.\\d+)?$/.test(key)) { for (const seg of key.split(\".\")) if (seg !== \"\") out.push(seg); } else out.push(key); key = \"\"; } else key += ch; } else if (ch === \"[\") { bracket = true; quoted = false; if (key) { out.push(key); key = \"\"; } } else if (ch === \".\") { if (key) { out.push(key); key = \"\"; } const next = v[i + 1]; if (next === undefined || next === \".\") out.push(\"\"); } else key += ch; i++; } if (key) out.push(key); return out; }; const unsafe = (key) => key === \"__proto__\" || key === \"constructor\" || key === \"prototype\"; for (let i = 0; i < keys.length; i++) { const raw = keys[i]; if (raw == null) continue; const path = pathOf(raw); let cur = result; for (let j = 0; j < path.length; j++) { const step = path[j]; if (unsafe(step)) break; if (j === path.length - 1) { cur[step] = vals[i]; break; } const next = path[j + 1]; if (cur[step] == null || typeof cur[step] !== \"object\") cur[step] = typeof next === \"string\" && /^(?:0|[1-9]\\d*)$/.test(next) ? [] : {}; cur = cur[step]; } } return result; })(a, b);";
}

interface Tagged { t: string; v?: unknown }

function deepSame(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) && Array.isArray(right)) return left.length === right.length && left.every((item, i) => deepSame(item, right[i]));
  if (left && right && typeof left === "object" && typeof right === "object" && !Array.isArray(left) && !Array.isArray(right)) {
    const a = left as Record<string, unknown>;
    const b = right as Record<string, unknown>;
    const keys = Object.keys(a);
    return keys.length === Object.keys(b).length && keys.every((key) => deepSame(a[key], b[key]));
  }
  return false;
}

/** A tagged payload is plain data. Depth, node count, and a few keys are refused. */
export const OPAQUE_DECODE_LIMITS = { depth: 32, nodes: 10000, keys: 1000, string: 100_000 } as const;
const OPAQUE_FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);

/**
 * Parent-side parse of one tagged value. The sandbox does not decide the
 * check, so a deep, wide, or prototype-key payload is data and is refused.
 */
export function decodeTagged(node: unknown, budget: { nodes: number; depth: number } = { nodes: 0, depth: 0 }): { ok: true; value: unknown } | { ok: false } {
  budget.nodes += 1;
  if (budget.nodes > OPAQUE_DECODE_LIMITS.nodes || budget.depth > OPAQUE_DECODE_LIMITS.depth) return { ok: false }; // decode-guard:budget
  if (!node || typeof node !== "object") return { ok: false };
  const tag = node as Tagged;
  if (tag.t === "u") return { ok: true, value: undefined };
  if (tag.t === "z") return { ok: true, value: null };
  if (tag.t === "b") return typeof tag.v === "boolean" ? { ok: true, value: tag.v } : { ok: false };
  if (tag.t === "s") return typeof tag.v === "string" && tag.v.length <= OPAQUE_DECODE_LIMITS.string ? { ok: true, value: tag.v } : { ok: false };
  if (tag.t === "n") return typeof tag.v === "number" && Number.isFinite(tag.v) ? { ok: true, value: tag.v } : { ok: false };
  if (tag.t === "nz") return { ok: true, value: -0 };
  if (tag.t === "nan") return { ok: true, value: Number.NaN };
  if (tag.t === "pinf") return { ok: true, value: Number.POSITIVE_INFINITY };
  if (tag.t === "ninf") return { ok: true, value: Number.NEGATIVE_INFINITY };
  if (tag.t === "a" && Array.isArray(tag.v)) {
    if (tag.v.length > OPAQUE_DECODE_LIMITS.nodes) return { ok: false };
    const items: unknown[] = [];
    budget.depth += 1;
    for (const item of tag.v) {
      const decoded = decodeTagged(item, budget);
      if (!decoded.ok) return decoded;
      items.push(decoded.value);
    }
    budget.depth -= 1;
    return { ok: true, value: items };
  }
  if (tag.t === "o" && tag.v && typeof tag.v === "object" && !Array.isArray(tag.v)) {
    const entries = Object.entries(tag.v as Record<string, unknown>);
    if (entries.length > OPAQUE_DECODE_LIMITS.keys) return { ok: false };
    const obj: Record<string, unknown> = {};
    budget.depth += 1;
    for (const [key, item] of entries) {
      if (OPAQUE_FORBIDDEN_KEYS.has(key)) return { ok: false }; // decode-guard:keys
      const decoded = decodeTagged(item, budget);
      if (!decoded.ok) return decoded;
      Object.defineProperty(obj, key, { value: decoded.value, enumerable: true, writable: true, configurable: true });
    }
    budget.depth -= 1;
    return { ok: true, value: obj };
  }
  return { ok: false };
}

/** One JSON line of tagged arguments. Extra bytes are not a payload. */
function readPayload(path: string, count: number): unknown[] | null {
  let text = "";
  try { text = readFileSync(path, "utf8"); } catch { return null; }
  const nl = text.indexOf("\n");
  if (nl < 0 || nl !== text.length - 1) return null;
  let parsed: unknown;
  try { parsed = JSON.parse(text.slice(0, -1)); } catch { return null; }
  if (!Array.isArray(parsed) || parsed.length !== count) return null;
  return parsed;
}

function decodeCall(node: unknown, arity: number, budget: { nodes: number; depth: number }): unknown[] | null {
  if (!Array.isArray(node) || node.length !== arity) return null;
  const args: unknown[] = [];
  for (const item of node) {
    const decoded = decodeTagged(item, budget);
    if (!decoded.ok) return null;
    args.push(decoded.value);
  }
  return args;
}

function valueAgrees(got: unknown, call: CallFact): boolean {
  const reduced = call.reduced;
  if (!reduced || reduced.kind === "throws") return false;
  if (reduced.kind === "type") return (got === null ? "object" : typeof got) === reduced.expected;
  if (reduced.kind === "boolean") return Object.is(got, reduced.expected);
  if (reduced.kind === "equal" && reduced.deep) return deepSame(got, reduced.expected);
  return Object.is(got, reduced.expected);
}

/** The parent-generated body, applied to plain data the parent decoded. */
function applyBody(body: string, args: unknown[]): { ok: true; value: unknown } | { ok: false } {
  try {
    const value = (new Function(...PARAMS.slice(0, args.length), body) as (...xs: unknown[]) => unknown)(...args);
    return { ok: true, value };
  } catch {
    return { ok: false };
  }
}

/**
 * The sandbox only returns the arguments. It holds no secret and does not
 * decide the check. The parent parses the tagged values and runs the
 * parent-generated body on that plain data. Missing bwrap does not start
 * the script.
 */
function replayInSandbox(body: string, calls: readonly CallFact[], bwrap?: string): boolean {
  const node = visibleNodeBin();
  if (!node) return false;
  const cases: { exprs: string[] }[] = [];
  for (const call of calls) {
    const replay = call.replay;
    if (!call.reduced || call.reduced.kind === "throws" || !replay || replay.length !== call.arity) return false;
    const exprs: string[] = [];
    for (const item of replay) {
      const expr = item.init ?? item.source;
      if (!expr || (item.init === null && /^[A-Za-z_$][\w$]*$/.test(item.source))) return false;
      exprs.push(expr);
    }
    cases.push({ exprs });
  }
  const script = [
    "import { writeFileSync } from 'node:fs';",
    "import { types } from 'node:util';",
    "const isProxy = types.isProxy;",
    "const cases = " + JSON.stringify(cases) + ";",
    "function plain(v, proto) {",
    "  if (v === null || typeof v !== 'object') return false;",
    "  if (isProxy(v)) return false;",
    "  if (Object.getOwnPropertySymbols(v).length) return false;",
    "  return Object.getPrototypeOf(v) === proto;",
    "}",
    "function ser(v) {",
    "  if (v === undefined) return { t: 'u' };",
    "  if (v === null) return { t: 'z' };",
    "  const ty = typeof v;",
    "  if (ty === 'boolean') return { t: 'b', v };",
    "  if (ty === 'string') return { t: 's', v };",
    "  if (ty === 'number') {",
    "    if (Object.is(v, -0)) return { t: 'nz' };",
    "    if (v !== v) return { t: 'nan' };",
    "    if (v === Infinity) return { t: 'pinf' };",
    "    if (v === -Infinity) return { t: 'ninf' };",
    "    return { t: 'n', v };",
    "  }",
    "  if (ty !== 'object') return { t: 'bad' };",
    "  if (Array.isArray(v)) {",
    "    if (!plain(v, Array.prototype)) return { t: 'bad' };",
    "    const out = [];",
    "    for (let i = 0; i < v.length; i++) {",
    "      const desc = Object.getOwnPropertyDescriptor(v, String(i));",
    "      if (!desc || desc.get || desc.set || !('value' in desc) || desc.value === undefined) return { t: 'bad' };",
    "      const s = ser(desc.value);",
    "      if (s.t === 'bad') return s;",
    "      out.push(s);",
    "    }",
    "    return { t: 'a', v: out };",
    "  }",
    "  const proto = Object.getPrototypeOf(v);",
    "  if (proto !== Object.prototype && proto !== null) return { t: 'bad' };",
    "  if (!plain(v, proto)) return { t: 'bad' };",
    "  const out = {};",
    "  for (const key of Object.keys(v)) {",
    "    if (key === 'toJSON') return { t: 'bad' };",
    "    const desc = Object.getOwnPropertyDescriptor(v, key);",
    "    if (!desc || desc.get || desc.set || !('value' in desc) || desc.value === undefined) return { t: 'bad' };",
    "    const s = ser(desc.value);",
    "    if (s.t === 'bad') return s;",
    "    out[key] = s;",
    "  }",
    "  return { t: 'o', v: out };",
    "}",
    "const out = [];",
    "for (const item of cases) {",
    "  const args = [];",
    "  for (const src of item.exprs) args.push(ser(Function('return (' + src + ')')()));",
    "  out.push(args);",
    "}",
    "writeFileSync(new URL('./result', import.meta.url), JSON.stringify(out) + '\\n');",
    "",
  ].join("\n");
  const dir = mkdtempSync(join(tmpdir(), "peaceai-opaque-"));
  const resultPath = join(dir, "result");
  try {
    const file = join(dir, "replay.mjs");
    writeFileSync(file, script);
    const ran = runInPracticeSandbox(dir, [node, file], 10_000, { capture: true, nodePath: node, ...(bwrap ? { bwrap } : {}) });
    if (ran.unsafe || ran.code !== 0) return false;
    const payload = readPayload(resultPath, cases.length);
    if (!payload) return false;
    const budget = { nodes: 0, depth: 0 };
    for (let i = 0; i < calls.length; i++) {
      const args = decodeCall(payload[i], cases[i]!.exprs.length, budget);
      if (!args) return false;
      const got = applyBody(body, args);
      if (!got.ok || !valueAgrees(got.value, calls[i]!)) return false;
    }
    return true;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function opaqueAgrees(body: string, calls: readonly CallFact[], bwrap?: string): boolean {
  const pending = calls.filter((call) => call.args === null && call.reduced && call.reduced.kind !== "throws");
  if (!pending.length) return true;
  return replayInSandbox(body, pending, bwrap);
}

/** One body, or a refusal. A body is kept only when every reduced call agrees with that one form. */
export const BODY_SHAPES = ["literal", "boolean", "typeof", "string", "comparison", "integer", "project", "sum", "split", "tag", "nil", "head", "reverse", "last", "null", "notnil", "initial", "tail", "take", "drop", "dropright", "takeright", "capitalize", "upper", "lower", "undef", "words", "kebab", "snake", "camel", "pascal", "constant", "lcase", "ucase", "start", "sentence", "diff", "inter", "xor", "at", "lerp", "ilerp", "phex", "zobj", "mean", "bg", "chunk", "combo", "pct", "toupr", "tolow", "csum", "tlen", "tkey", "zde", "idn", "uesc", "dden", "gt", "lt", "gte", "pull", "peer"] as const;
export type BodyShape = (typeof BODY_SHAPES)[number];

function bodyFor(calls: CallFact[], peers: { name: string; arity: number }[], symbol: string, bwrap?: string): { body: string; types: string[]; ret: string; shape: BodyShape } | "signature" | "no-body" {
  if (!calls.length) return "no-body";
  const arities = new Set(calls.map((call) => call.arity));
  if (arities.size !== 1) return "signature";
  const arity = [...arities][0]!;
  if (arity > PARAMS.length) return "signature";
  const reduced = calls.filter((call) => call.reduced);
  const threw = reduced.some((call) => call.reduced?.kind === "throws");
  if (!reduced.length || threw) return "no-body";
  const usable = reduced.filter((call) => call.args !== null);
  if (!usable.length) return "no-body";
  const examples: Example[] = usable.map((call) => ({ args: call.args as unknown[], expected: call.reduced && "expected" in call.reduced ? call.reduced.expected : null }));
  const concrete = examples.filter((_, i) => usable[i]?.reduced?.kind !== "type");
  if (!concrete.length || usable.every((call) => call.reduced?.kind === "type")) return "no-body";
  const agree = (value: unknown) => usable.every((call) => call.reduced?.kind !== "type" || ("expected" in call.reduced && call.reduced.expected === valueType(value)));
  const types = Array.from({ length: arity }, (_, i) => paramType(concrete.map((ex) => ex.args[i])));
  const options: { body: string; ret: string; shape: BodyShape }[] = [];
  const keep = (body: string | null, ret: string, shape: BodyShape) => { if (body && agree(concrete[0]!.expected)) options.push({ body, ret, shape }); };
  if (concrete.every((ex) => JSON.stringify(ex.expected) === JSON.stringify(concrete[0]!.expected))) keep(literalBody(concrete), resultType(concrete.map((ex) => ex.expected)), "literal");
  keep(booleanBody(concrete), "boolean", "boolean");
  keep(typeofBody(concrete), resultType(concrete.map((ex) => ex.expected)), "typeof");
  const gaps = stringBody(concrete);
  if (gaps) {
    const parts: string[] = [];
    if (gaps[0]) parts.push(JSON.stringify(gaps[0]));
    PARAMS.slice(0, arity).forEach((name, i) => { parts.push(name); if (gaps[i + 1]) parts.push(JSON.stringify(gaps[i + 1])); });
    keep(renderReturn(parts.length ? parts : ['""']), "string", "string");
  }
  keep(comparisonBody(concrete), "boolean", "comparison");
  keep(integerBody(concrete), "boolean", "integer");
  keep(tagBody(concrete), "boolean", "tag");
  keep(nilBody(concrete), "boolean", "nil");
  keep(headBody(concrete), resultType(concrete.map((ex) => ex.expected)), "head");
  keep(reverseBody(concrete), "string", "reverse");
  keep(lastBody(concrete), resultType(concrete.map((ex) => ex.expected)), "last");
  keep(nullBody(concrete), "boolean", "null");
  keep(notNilBody(concrete), "boolean", "notnil");
  keep(initialBody(concrete), resultType(concrete.map((ex) => ex.expected)), "initial");
  keep(tailBody(concrete), resultType(concrete.map((ex) => ex.expected)), "tail");
  keep(takeBody(concrete), resultType(concrete.map((ex) => ex.expected)), "take");
  keep(dropBody(concrete), resultType(concrete.map((ex) => ex.expected)), "drop");
  keep(dropRightBody(concrete), resultType(concrete.map((ex) => ex.expected)), "dropright");
  keep(takeRightBody(concrete), resultType(concrete.map((ex) => ex.expected)), "takeright");
  keep(capitalizeBody(concrete), "string", "capitalize");
  keep(upperFirstBody(concrete), "string", "upper");
  keep(lowerFirstBody(concrete), "string", "lower");
  keep(undefBody(concrete), "boolean", "undef");
  keep(wordsBody(concrete), resultType(concrete.map((ex) => ex.expected)), "words");
  keep(kebabBody(concrete), "string", "kebab");
  keep(snakeBody(concrete), "string", "snake");
  keep(camelBody(concrete), "string", "camel");
  keep(pascalBody(concrete), "string", "pascal");
  keep(constantBody(concrete), "string", "constant");
  keep(lowerCaseBody(concrete), "string", "lcase");
  keep(upperCaseBody(concrete), "string", "ucase");
  keep(startBody(concrete), "string", "start");
  keep(sentenceBody(concrete), "string", "sentence");
  keep(differenceBody(concrete), resultType(concrete.map((ex) => ex.expected)), "diff");
  keep(intersectionBody(concrete), resultType(concrete.map((ex) => ex.expected)), "inter");
  keep(xorBody(concrete), resultType(concrete.map((ex) => ex.expected)), "xor");
  keep(atBody(concrete), resultType(concrete.map((ex) => ex.expected)), "at");
  keep(lerpBody(concrete), "number", "lerp");
  keep(ilerpBody(concrete), "number", "ilerp");
  keep(phexBody(concrete), resultType(concrete.map((ex) => ex.expected)), "phex");
  keep(zobjBody(concrete), resultType(concrete.map((ex) => ex.expected)), "zobj");
  keep(meanBody(concrete), "number", "mean");
  keep(bgBody(concrete), "string", "bg");
  keep(chunkBody(concrete), resultType(concrete.map((ex) => ex.expected)), "chunk");
  keep(comboBody(concrete), resultType(concrete.map((ex) => ex.expected)), "combo");
  keep(pctBody(concrete), "number", "pct");
  keep(touprBody(concrete), "string", "toupr");
  keep(tolowBody(concrete), "string", "tolow");
  keep(csumBody(concrete), resultType(concrete.map((ex) => ex.expected)), "csum");
  keep(tlenBody(concrete), "number", "tlen");
  keep(tkeyBody(concrete), resultType(concrete.map((ex) => ex.expected)), "tkey");
  keep(zdeBody(concrete), resultType(concrete.map((ex) => ex.expected)), "zde");
  keep(idnBody(concrete), resultType(concrete.map((ex) => ex.expected)), "idn");
  keep(uescBody(concrete), "string", "uesc");
  keep(ddenBody(concrete), "string", "dden");
  keep(gtBody(concrete), "boolean", "gt");
  keep(ltBody(concrete), "boolean", "lt");
  keep(gteBody(concrete), "boolean", "gte");
  keep(pullBody(concrete), resultType(concrete.map((ex) => ex.expected)), "pull");
  keep(projectBody(concrete), resultType(concrete.map((ex) => ex.expected)), "project");
  keep(sumBody(concrete), "number", "sum");
  keep(splitBody(concrete), "string", "split");
  const peersFit = peers.filter((peer) => peer.name !== symbol && peer.arity === arity);
  if (peersFit.length === 1) keep(`  return ${peersFit[0]!.name}(${PARAMS.slice(0, arity).join(", ")});`, "unknown", "peer");
  const unique = [...new Map(options.map((option) => [option.body, option])).values()];
  if (unique.length !== 1) return "no-body";
  let checked = true;
  checked = opaqueAgrees(unique[0]!.body, reduced, bwrap); // spec-guard:opaque-call
  if (!checked) return "no-body";
  return { body: unique[0]!.body, types, ret: unique[0]!.ret, shape: unique[0]!.shape };
}

function renderFunction(symbol: string, shape: MissingSymbol["shape"], built: { body: string; types: string[]; ret: string }): string {
  const params = built.types.map((type, i) => `${PARAMS[i]}: ${type}`).join(", ");
  const keyword = shape === "default" ? "export default function" : "export function";
  return `${keyword} ${symbol}(${params}): ${built.ret} {\n${built.body}\n}\n`;
}

/**
 * The scaffold for a runner error that names a missing module, export, or non-function.
 * Null when the output is not that kind of error. A file is created or extended only at the
 * module the test imports, and only when that path matches sourcePattern.
 */
export function scaffoldPlan(testFile: string, text: string, output: string, sourcePattern: string, deny: readonly string[] = [], read: (path: string) => string | null = () => null, sandbox?: { bwrap?: string }): ScaffoldPlan | null {
  const facts = { modules: [] as string[], members: [] as { quoted: string | null; name: string }[], notFn: [] as string[] };
  for (const line of output.split("\n")) {
    for (const match of line.matchAll(/(?:Cannot find module|ERR_MODULE_NOT_FOUND)[^'"\n]*['"]([^'"]+)['"]/g)) facts.modules.push(match[1]!);
    const member = /Module (['"])(.*?)\1 has no exported member (['"])(.*?)\3/.exec(line);
    if (member) facts.members.push({ quoted: stripQuotes(member[2]!), name: member[4]! });
    const provided = /requested module ['"]([^'"]+)['"] does not provide an export named ['"]([^'"]+)['"]/.exec(line);
    if (provided) facts.members.push({ quoted: provided[1]!, name: provided[2]! });
    const notFn = /TypeError: ([A-Za-z_$][\w$]*) is not a function\b/.exec(line);
    if (notFn && notFn[1] !== "undefined") facts.notFn.push(notFn[1]!);
  }
  if (!facts.modules.length && !facts.members.length && !facts.notFn.length) return null;
  const exists = (path: string) => read(path) !== null;
  const sf = ts.createSourceFile(testFile, text, ts.ScriptTarget.Latest, true);
  const bindings: BindingRef[] = [];
  for (const st of sf.statements) {
    if (!ts.isImportDeclaration(st) || !ts.isStringLiteral(st.moduleSpecifier) || !st.importClause || st.importClause.isTypeOnly) continue;
    const spec = st.moduleSpecifier.text;
    const file = impliedSource(testFile, spec, sourcePattern, deny, exists);
    if (st.importClause.name) bindings.push({ spec, file, local: st.importClause.name.text, imported: "default", kind: "default" });
    const named = st.importClause.namedBindings;
    if (named && ts.isNamespaceImport(named)) bindings.push({ spec, file, local: named.name.text, imported: "*", kind: "namespace" });
    if (named && ts.isNamedImports(named)) for (const el of named.elements) {
      if (el.isTypeOnly) continue;
      bindings.push({ spec, file, local: el.name.text, imported: (el.propertyName ?? el.name).text, kind: "named" });
    }
  }
  const selected = (binding: BindingRef, symbol: string, local: string): boolean => {
    if (facts.modules.some((quoted) => sameModule(binding.spec, binding.file, quoted))) return true;
    if (facts.members.some((member) => member.name === symbol && (member.quoted === null || sameModule(binding.spec, binding.file, member.quoted)))) return true;
    if (facts.notFn.some((name) => name === symbol || name === local || name === binding.local)) return true;
    return false;
  };
  const wants: Want[] = [];
  const add = (want: Omit<Want, "calls">, fact: CallFact | null) => {
    let row = wants.find((item) => item.file === want.file && item.module === want.module && item.symbol === want.symbol && item.shape === want.shape);
    if (!row) { row = { ...want, calls: [] }; wants.push(row); }
    if (fact) row.calls.push(fact);
  };
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      let hit: { binding: BindingRef; shape: MissingSymbol["shape"]; symbol: string } | null = null;
      if (ts.isIdentifier(callee)) {
        const binding = bindings.find((item) => item.local === callee.text && item.kind !== "namespace");
        if (binding) hit = { binding, shape: binding.kind === "default" ? "default" : "named", symbol: binding.kind === "default" ? binding.local : binding.imported };
      } else if (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.name)) {
        const object = callee.expression;
        if (ts.isIdentifier(object)) {
          const binding = bindings.find((item) => item.local === object.text && item.kind !== "named");
          if (binding) hit = { binding, shape: binding.kind === "namespace" ? "named" : "default-prop", symbol: callee.name.text };
        }
      }
      if (hit && selected(hit.binding, hit.symbol, hit.binding.local)) {
        const args = node.arguments.map((arg) => evalConcrete(unwrap(arg)));
        const concrete = args.every((arg) => arg.ok);
        add({ symbol: hit.symbol, module: hit.binding.spec, file: hit.binding.file, shape: hit.shape }, {
          arity: node.arguments.length,
          args: concrete ? args.map((arg) => arg.ok ? arg.value : null) : null,
          ...(concrete ? {} : { replay: node.arguments.map((arg) => replayArg(unwrap(arg), node, sf)) }),
          reduced: reducedOf(node),
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  for (const binding of bindings) {
    if (binding.kind === "namespace" || binding.kind === "default") continue;
    if (!selected(binding, binding.imported, binding.local)) continue;
    if (!wants.some((want) => want.module === binding.spec && want.symbol === binding.imported)) add({ symbol: binding.imported, module: binding.spec, file: binding.file, shape: "named" }, null);
  }
  const symbols: MissingSymbol[] = [];
  const kept: Want[] = [];
  for (const want of wants) {
    const current = want.file ? read(want.file) : null;
    const kind = current === null ? "absent" : exportKind(current, want.shape === "default" ? "default" : want.symbol);
    if (kind === "function") continue;
    const row: MissingSymbol = { symbol: want.symbol, module: want.module, file: want.file, shape: want.shape };
    symbols.push(row);
    kept.push(want);
    if (kind === "other") return { ok: false, reason: "CANT_DO_YET_NOT_A_FUNCTION", symbols };
  }
  if (!symbols.length) return null;
  if (symbols.some((symbol) => symbol.file === null)) return { ok: false, reason: "CANT_DO_YET_NO_MODULE", symbols };
  const byFile = new Map<string, Want[]>();
  for (const want of kept) {
    const list = byFile.get(want.file!) ?? [];
    list.push(want);
    byFile.set(want.file!, list);
  }
  const files: { path: string; content: string }[] = [];
  const expectations: Expectation[] = [];
  const shapes: string[] = [];
  const targets: SpecTarget[] = [];
  let examples = 0;
  for (const [path, group] of byFile) {
    if (group.filter((want) => want.shape === "default").length > 1) return { ok: false, reason: "CANT_DO_YET_NO_BODY", symbols };
    if (group.some((want) => want.shape === "default") && group.some((want) => want.shape === "default-prop")) return { ok: false, reason: "CANT_DO_YET_NO_BODY", symbols };
    const existing = read(path);
    if (existing !== null && group.some((want) => want.shape !== "named")) return { ok: false, reason: "CANT_DO_YET_NO_BODY", symbols };
    const peers = existing === null ? [] : peerFunctions(existing);
    const chunks: string[] = [];
    for (const want of group) {
      const built = bodyFor(want.calls, peers, want.symbol, sandbox?.bwrap);
      if (built === "signature") return { ok: false, reason: "CANT_DO_YET_SIGNATURE", symbols };
      if (built === "no-body") return { ok: false, reason: "CANT_DO_YET_NO_BODY", symbols };
      chunks.push(renderFunction(want.symbol, want.shape, built));
      shapes.push(built.shape);
      const fitted = fittedTarget(want.calls, want.symbol, path, want.shape);
      examples += fitted.count;
      targets.push(fitted.target);
      for (const call of want.calls) {
        if (!call.reduced || call.args === null || call.reduced.kind === "throws" || expectations.length >= 32) continue;
        const shown = (value: unknown) => JSON.stringify(value) ?? "undefined";
        expectations.push({
          kind: call.reduced.kind, symbol: want.symbol, file: path,
          input: call.args.map(shown).join(", ").slice(0, 80),
          expected: shown(call.reduced.expected).slice(0, 80),
        });
      }
    }
    if (group.some((want) => want.shape === "default-prop")) {
      const props = group.filter((want) => want.shape === "default-prop").map((want) => want.symbol);
      const name = props.includes("api") ? "moduleValue" : "api";
      chunks.push(`const ${name} = { ${props.join(", ")} };\nexport default ${name};\n`);
    }
    const addition = chunks.join("\n");
    files.push({ path, content: existing === null ? addition : `${existing.endsWith("\n") ? existing : `${existing}\n`}\n${addition}` });
  }
  const shape = [...new Set(shapes)].join("+") || "literal";
  return { ok: true, files, symbols, expectations, fit: { shape, examples, targets } };
}

function fittedTarget(calls: CallFact[], symbol: string, file: string, form: MissingSymbol["shape"]): { count: number; target: SpecTarget } {
  const seen = new Set<string>();
  const argSeen = new Set<string>();
  const args: unknown[][] = [];
  for (const call of calls) {
    if (!call.reduced || call.args === null || call.reduced.kind === "throws" || !("expected" in call.reduced)) continue;
    const key = JSON.stringify({ a: call.args, e: call.reduced.expected });
    if (seen.has(key)) continue;
    seen.add(key);
    const argKey = JSON.stringify(call.args);
    if (!argSeen.has(argKey)) { argSeen.add(argKey); args.push(call.args); }
  }
  const target: SpecTarget = form === "default-prop"
    ? { symbol, file, form, exportName: "default", prop: symbol, args }
    : form === "default"
      ? { symbol, file, form, exportName: symbol, args }
      : { symbol, file, form: "named", exportName: symbol, args };
  return { count: seen.size, target };
}

function symbolTag(symbols: readonly MissingSymbol[]): { symbol: string; module: string } {
  return { symbol: symbols.map((item) => item.symbol).join(","), module: [...new Set(symbols.map((item) => item.module))].join(",") };
}

function suiteCommand(input: SpecInput, sourceFiles: readonly string[]): string[] | null {
  if (!input.originalSuite) return null;
  const related = [...(input.relatedTests ?? [])];
  if (input.originalSuite === "related" && input.relatedTests === undefined) {
    const repo = openRepo(input.root);
    for (const file of sourceFiles) {
      const found = repo.testsFor(file);
      if (found.ok) for (const test of found.tests) if (test.path !== input.testFile) related.push(test.path);
    }
  }
  return originalSuiteArgv(input.testCommand, input.testFile, input.originalSuite, related);
}

/** Write the scaffold and accept it only when the given test and the original suite both pass. */
function finishScaffold(input: SpecInput, output: string, code: number | null, cap: number): SpecResult | null {
  const testText = read(input.root, input.testFile);
  if (testText === null) return null;
  const plan = scaffoldPlan(input.testFile, testText, output, input.sourcePattern, input.denyPatterns ?? [], (path) => read(input.root, path));
  if (!plan) return null;
  const tag = symbolTag(plan.symbols);
  const note = (kind: SpecDiagKind, status: number | null, text: string): SpecDiagnostic => ({ ...specDiagnostic(kind, status, input.testCommand, text, input.root), symbol: tag.symbol, module: tag.module });
  if (!plan.ok) return { status: "cant", reason: plan.reason, attempts: 0, diagnostic: note("missing_symbol", code, output) };
  for (const file of plan.files) {
    mkdirSync(dirname(join(input.root, file.path)), { recursive: true });
    writeFileSync(join(input.root, file.path), file.content);
  }
  const again = runSandboxed(input, input.testCommand);
  if (again.blocked) return { status: "blocked", reason: again.blocked, attempts: 1, diagnostic: note(again.blocked === "SANDBOX_POISON" ? "sandbox_poison" : "unsafe", null, "") };
  if (again.code !== 0) {
    resetAttempt(input);
    return { status: "cant", reason: "CANT_DO_YET_NO_VERIFY", attempts: 1, diagnostic: note("missing_symbol", again.code, again.stdout) };
  }
  const suite = suiteCommand(input, plan.files.map((file) => file.path));
  if (suite) {
    const ran = runSandboxed(input, suite);
    if (ran.blocked) return { status: "blocked", reason: ran.blocked, attempts: 1, diagnostic: note(ran.blocked === "SANDBOX_POISON" ? "sandbox_poison" : "unsafe", null, "") };
    if (ran.code !== 0) {
      resetAttempt(input);
      return { status: "cant", reason: "CANT_DO_YET_NO_VERIFY", attempts: 1, diagnostic: note("missing_symbol", ran.code, ran.stdout) };
    }
  }
  const diff = gitDiff(input.root, plan.files.map((file) => file.path));
  resetAttempt(input);
  if (!diff.trim()) return { status: "cant", reason: "CANT_DO_YET_NO_VERIFY", attempts: 1, diagnostic: note("missing_symbol", code, output) };
  return { status: "diff", diff, attempts: 1, expectations: plan.expectations, diagnostic: note("verified", 0, output), fit: plan.fit };
}

/**
 * Make the failing test pass. The proposer is repair-v2. Each attempt is one of its edits,
 * applied on the original sources, then the given test and the original suite.
 */
function argsFromSnippet(input: string): unknown[] | null {
  if (!input.trim()) return [];
  const sf = ts.createSourceFile("call.ts", `f(${input})`, ts.ScriptTarget.Latest, true);
  let found: ts.CallExpression | null = null;
  const visit = (node: ts.Node) => { if (!found && ts.isCallExpression(node)) found = node; else ts.forEachChild(node, visit); };
  visit(sf);
  if (!found) return null;
  const call: ts.CallExpression = found;
  const args = call.arguments.map((arg) => evalConcrete(unwrap(arg)));
  if (args.some((arg) => !arg.ok)) return null;
  return args.map((arg) => arg.ok ? arg.value : null);
}

function repairFit(expectations: Expectation[], shape: string): SpecFit {
  const seen = new Set<string>();
  const by = new Map<string, SpecTarget>();
  for (const row of expectations) {
    const key = `${row.file}\0${row.symbol}\0${row.kind}\0${row.input}\0${row.expected}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const id = `${row.file}\0${row.symbol}`;
    let target = by.get(id);
    if (!target) {
      target = { symbol: row.symbol, file: row.file, form: "named", exportName: row.symbol, args: [] };
      by.set(id, target);
    }
    const args = argsFromSnippet(row.input);
    if (args && !target.args.some((have) => JSON.stringify(have) === JSON.stringify(args))) target.args.push(args);
  }
  return { shape, examples: seen.size, targets: [...by.values()] };
}

export function commandNeedsInstall(command: readonly string[]): boolean {
  return command.some((part) => part.includes("node_modules"));
}

function soleTestTitle(text: string | null): string | undefined {
  if (!text) return undefined;
  const sf = ts.createSourceFile("recorded.ts", text, ts.ScriptTarget.Latest, true);
  const titles: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && node.arguments.length >= 1) {
      const callee = node.expression;
      const name = ts.isIdentifier(callee) ? callee.text : ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.name) ? callee.name.text : "";
      const title = node.arguments[0];
      if ((name === "test" || name === "serial" || name === "only" || name === "it") && title && (ts.isStringLiteral(title) || ts.isNoSubstitutionTemplateLiteral(title))) titles.push(title.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return titles.length === 1 ? titles[0] : undefined;
}

export function runTestSpec(input: SpecInput): SpecResult {
  const cap = clampSpecAttempts(input.maxAttempts);
  const deny = input.denyPatterns ?? [];
  const planned = practiceTestLaunch({
    command: input.testCommand,
    testFile: input.testFile,
    packageJson: read(input.root, "package.json"),
    tsconfig: read(input.root, "tsconfig.json"),
    avaConfigFile: ["ava.config.js", "ava.config.cjs", "ava.config.mjs", "ava.config.ts"].some((name) => read(input.root, name) !== null),
    mode: "relaxed",
  });
  const diag = (kind: SpecDiagKind, code: number | null, output: string) => specDiagnostic(kind, code, planned.cmd, output, input.root);
  if (commandNeedsInstall(input.testCommand) && !(input.nodeModules && existsSync(input.nodeModules))) {
    return { status: "cant", reason: "INSTALL_UNAVAILABLE", attempts: 0, diagnostic: diag("install_unavailable", null, "") };
  }
  const first = runSandboxed(input, input.testCommand);
  if (first.blocked) return { status: "blocked", reason: first.blocked, attempts: 0, diagnostic: diag(first.blocked === "SANDBOX_POISON" ? "sandbox_poison" : "unsafe", null, "") };
  let output = first.stdout;
  let code = first.code;
  // A relaxed tsimp launch can hide a type error and then fail to exit. The type-checking
  // launch is the one that prints TS2345. That diagnostic is the failure.
  if (!parseTypeDiagnostics(output).length && /Failed to exit|Timed out while running tests/.test(output) && input.toolchain.nodePath) {
    const checked = applyPracticeTestLaunch(input.root, input.testCommand, input.testFile, "typecheck");
    const again = runInPracticeSandbox(input.root, checked.cmd, 60_000, {
      capture: true, nodePath: input.toolchain.nodePath, nodeModules: input.nodeModules, extraEnv: checked.env,
    });
    if (!again.unsafe && parseTypeDiagnostics(again.stdout).length) { output = again.stdout; code = again.code; }
  }
  const loaderName = declaredTypeScriptLoader(read(input.root, "package.json") ?? "", read(input.root, "tsconfig.json"))?.name ?? null;
  const missingLoader = first.code === 0 ? null : loaderMissingDetail(output, loaderName);
  if (missingLoader) {
    const note = diag("loader_missing", first.code, `${missingLoader}\n${output}`);
    if (note.lines[0] !== missingLoader) note.lines = [missingLoader, ...note.lines].slice(0, 5);
    return { status: "cant", reason: "CANT_DO_YET_LOADER_MISSING", attempts: 0, diagnostic: note };
  }
  const typed = input.toolchain.nodePath
    ? repairTypedFailure({
      root: input.root, output, sourcePattern: input.sourcePattern, denyPatterns: input.denyPatterns,
      nodePath: input.toolchain.nodePath, nodeModules: input.nodeModules, testCommand: input.testCommand,
    })
    : null;
  if (typed) {
    return {
      status: "diff", diff: typed.diff, attempts: 1, expectations: [], diagnostic: diag("verified", code, output),
      fit: { shape: "signature", examples: typed.args.length, targets: [{ symbol: typed.symbol, file: typed.file, form: "named", exportName: typed.symbol, args: typed.args }] },
    };
  }
  const runtime = !typed && !parseTypeDiagnostics(output).length && input.toolchain.nodePath
    ? repairRuntimeFailure({
      root: input.root, output, sourcePattern: input.sourcePattern,
      nodePath: input.toolchain.nodePath, nodeModules: input.nodeModules, testCommand: input.testCommand,
    })
    : null;
  if (runtime) {
    return {
      status: "diff", diff: runtime.diff, attempts: 1, expectations: [], diagnostic: diag("verified", code, output),
      fit: { shape: "array", examples: 0, targets: [{ symbol: "array", file: runtime.file, form: "named", exportName: "array", args: [] }] },
    };
  }
  const batch5 = !parseTypeDiagnostics(output).length && input.toolchain.nodePath
    ? repairBatch5({
      root: input.root, output, sourcePattern: input.sourcePattern,
      nodePath: input.toolchain.nodePath, nodeModules: input.nodeModules, testCommand: input.testCommand,
    })
    : null;
  if (batch5) {
    return {
      status: "diff", diff: batch5.diff, attempts: 1, expectations: [], diagnostic: diag("verified", code, output),
      fit: { shape: "batch5", examples: 0, targets: [{ symbol: "batch5", file: batch5.file, form: "named", exportName: "batch5", args: [] }] },
    };
  }
  const batch6 = !parseTypeDiagnostics(output).length && input.toolchain.nodePath
    ? repairBatch6({
      root: input.root, output, sourcePattern: input.sourcePattern,
      nodePath: input.toolchain.nodePath, nodeModules: input.nodeModules, testCommand: input.testCommand,
    })
    : null;
  if (batch6) {
    return {
      status: "diff", diff: batch6.diff, attempts: 1, expectations: [], diagnostic: diag("verified", code, output),
      fit: { shape: "batch6", examples: 0, targets: [{ symbol: "batch6", file: batch6.file, form: "named", exportName: "batch6", args: [] }] },
    };
  }
  const batch7 = !parseTypeDiagnostics(output).length && input.toolchain.nodePath
    ? repairBatch7({
      root: input.root, output, sourcePattern: input.sourcePattern,
      nodePath: input.toolchain.nodePath, nodeModules: input.nodeModules, testCommand: input.testCommand,
    })
    : null;
  if (batch7) {
    return {
      status: "diff", diff: batch7.diff, attempts: 1, expectations: [], diagnostic: diag("verified", code, output),
      fit: { shape: "batch7", examples: 0, targets: [{ symbol: "batch7", file: batch7.file, form: "named", exportName: "batch7", args: [] }] },
    };
  }
  const batch8 = !parseTypeDiagnostics(output).length && input.toolchain.nodePath
    ? repairBatch8({
      root: input.root, output, sourcePattern: input.sourcePattern,
      nodePath: input.toolchain.nodePath, nodeModules: input.nodeModules, testCommand: input.testCommand,
    })
    : null;
  if (batch8) {
    return {
      status: "diff", diff: batch8.diff, attempts: 1, expectations: [], diagnostic: diag("verified", code, output),
      fit: { shape: "batch8", examples: 0, targets: [{ symbol: "batch8", file: batch8.file, form: "named", exportName: "batch8", args: [] }] },
    };
  }
  const batch9 = !parseTypeDiagnostics(output).length && input.toolchain.nodePath
    ? repairBatch9({
      root: input.root, output, sourcePattern: input.sourcePattern,
      nodePath: input.toolchain.nodePath, nodeModules: input.nodeModules, testCommand: input.testCommand,
    })
    : null;
  if (batch9) {
    return {
      status: "diff", diff: batch9.diff, attempts: 1, expectations: [], diagnostic: diag("verified", code, output),
      fit: { shape: "batch9", examples: 0, targets: [{ symbol: "batch9", file: batch9.file, form: "named", exportName: "batch9", args: [] }] },
    };
  }
  const batch10 = !parseTypeDiagnostics(output).length && input.toolchain.nodePath
    ? repairBatch10({
      root: input.root, output, sourcePattern: input.sourcePattern,
      nodePath: input.toolchain.nodePath, nodeModules: input.nodeModules, testCommand: input.testCommand,
    })
    : null;
  if (batch10) {
    return {
      status: "diff", diff: batch10.diff, attempts: 1, expectations: [], diagnostic: diag("verified", code, output),
      fit: { shape: "batch10", examples: 0, targets: [{ symbol: "batch10", file: batch10.file, form: "named", exportName: "batch10", args: [] }] },
    };
  }
  const batch11 = !parseTypeDiagnostics(output).length && input.toolchain.nodePath
    ? repairBatch11({
      root: input.root, output, sourcePattern: input.sourcePattern,
      nodePath: input.toolchain.nodePath, nodeModules: input.nodeModules, testCommand: input.testCommand,
    })
    : null;
  if (batch11) {
    return {
      status: "diff", diff: batch11.diff, attempts: 1, expectations: [], diagnostic: diag("verified", code, output),
      fit: { shape: "batch11", examples: 0, targets: [{ symbol: "batch11", file: batch11.file, form: "named", exportName: "batch11", args: [] }] },
    };
  }
  const batch12 = !parseTypeDiagnostics(output).length && input.toolchain.nodePath
    ? repairBatch12({
      root: input.root, output, sourcePattern: input.sourcePattern,
      nodePath: input.toolchain.nodePath, nodeModules: input.nodeModules, testCommand: input.testCommand,
    })
    : null;
  if (batch12) {
    return {
      status: "diff", diff: batch12.diff, attempts: 1, expectations: [], diagnostic: diag("verified", code, output),
      fit: { shape: "batch12", examples: 0, targets: [{ symbol: "batch12", file: batch12.file, form: "named", exportName: "batch12", args: [] }] },
    };
  }
  const batch13 = !parseTypeDiagnostics(output).length && input.toolchain.nodePath
    ? repairBatch13({
      root: input.root, output, sourcePattern: input.sourcePattern,
      nodePath: input.toolchain.nodePath, nodeModules: input.nodeModules, testCommand: input.testCommand,
    })
    : null;
  if (batch13) {
    return {
      status: "diff", diff: batch13.diff, attempts: 1, expectations: [], diagnostic: diag("verified", code, output),
      fit: { shape: "batch13", examples: 0, targets: [{ symbol: "batch13", file: batch13.file, form: "named", exportName: "batch13", args: [] }] },
    };
  }
  const batch14 = !parseTypeDiagnostics(output).length && input.toolchain.nodePath
    ? repairBatch14({
      root: input.root, output, sourcePattern: input.sourcePattern,
      nodePath: input.toolchain.nodePath, nodeModules: input.nodeModules, testCommand: input.testCommand,
    })
    : null;
  if (batch14) {
    return {
      status: "diff", diff: batch14.diff, attempts: 1, expectations: [], diagnostic: diag("verified", code, output),
      fit: { shape: "batch14", examples: 0, targets: [{ symbol: "batch14", file: batch14.file, form: "named", exportName: "batch14", args: [] }] },
    };
  }
  const batch15 = !parseTypeDiagnostics(output).length && input.toolchain.nodePath
    ? repairBatch15({
      root: input.root, output, sourcePattern: input.sourcePattern,
      nodePath: input.toolchain.nodePath, nodeModules: input.nodeModules, testCommand: input.testCommand,
    })
    : null;
  if (batch15) {
    return {
      status: "diff", diff: batch15.diff, attempts: 1, expectations: [], diagnostic: diag("verified", code, output),
      fit: { shape: "batch15", examples: 0, targets: [{ symbol: "batch15", file: batch15.file, form: "named", exportName: "batch15", args: [] }] },
    };
  }
  const batch16 = !parseTypeDiagnostics(output).length && input.toolchain.nodePath
    ? repairBatch16({
      root: input.root, output, sourcePattern: input.sourcePattern,
      nodePath: input.toolchain.nodePath, nodeModules: input.nodeModules, testCommand: input.testCommand,
    })
    : null;
  if (batch16) {
    return {
      status: "diff", diff: batch16.diff, attempts: 1, expectations: [], diagnostic: diag("verified", code, output),
      fit: { shape: "batch16", examples: 0, targets: [{ symbol: "batch16", file: batch16.file, form: "named", exportName: "batch16", args: [] }] },
    };
  }
  const batch17 = !parseTypeDiagnostics(output).length && input.toolchain.nodePath
    ? repairBatch17({
      root: input.root, output, sourcePattern: input.sourcePattern,
      nodePath: input.toolchain.nodePath, nodeModules: input.nodeModules, testCommand: input.testCommand,
    })
    : null;
  if (batch17) {
    return {
      status: "diff", diff: batch17.diff, attempts: 1, expectations: [], diagnostic: diag("verified", code, output),
      fit: { shape: "batch17", examples: 0, targets: [{ symbol: "batch17", file: batch17.file, form: "named", exportName: "batch17", args: [] }] },
    };
  }
  const batch19 = !parseTypeDiagnostics(output).length && input.toolchain.nodePath
    ? repairBatch19({
      root: input.root, output, sourcePattern: input.sourcePattern,
      nodePath: input.toolchain.nodePath, nodeModules: input.nodeModules, testCommand: input.testCommand,
    })
    : null;
  if (batch19) {
    return {
      status: "diff", diff: batch19.diff, attempts: 1, expectations: [], diagnostic: diag("verified", code, output),
      fit: { shape: "batch19", examples: 0, targets: [{ symbol: "batch19", file: batch19.file, form: "named", exportName: "batch19", args: [] }] },
    };
  }
  const batch20 = !parseTypeDiagnostics(output).length && input.toolchain.nodePath
    ? repairBatch20({
      root: input.root, output, sourcePattern: input.sourcePattern,
      nodePath: input.toolchain.nodePath, nodeModules: input.nodeModules, testCommand: input.testCommand,
    })
    : null;
  if (batch20) {
    return {
      status: "diff", diff: batch20.diff, attempts: 1, expectations: [], diagnostic: diag("verified", code, output),
      fit: { shape: "batch20", examples: 0, targets: [{ symbol: "batch20", file: batch20.file, form: "named", exportName: "batch20", args: [] }] },
    };
  }
  const batch21 = !parseTypeDiagnostics(output).length && input.toolchain.nodePath
    ? repairBatch21({
      root: input.root, output, sourcePattern: input.sourcePattern,
      nodePath: input.toolchain.nodePath, nodeModules: input.nodeModules, testCommand: input.testCommand,
    })
    : null;
  if (batch21) {
    return {
      status: "diff", diff: batch21.diff, attempts: 1, expectations: [], diagnostic: diag("verified", code, output),
      fit: { shape: "batch21", examples: 0, targets: [{ symbol: "batch21", file: batch21.file, form: "named", exportName: "batch21", args: [] }] },
    };
  }
  const batch23 = !parseTypeDiagnostics(output).length && input.toolchain.nodePath
    ? repairBatch23({
      root: input.root, output, sourcePattern: input.sourcePattern,
      nodePath: input.toolchain.nodePath, nodeModules: input.nodeModules, testCommand: input.testCommand,
    })
    : null;
  if (batch23) {
    return {
      status: "diff", diff: batch23.diff, attempts: 1, expectations: [], diagnostic: diag("verified", code, output),
      fit: { shape: "batch23", examples: 0, targets: [{ symbol: "batch23", file: batch23.file, form: "named", exportName: "batch23", args: [] }] },
    };
  }
  const batch25 = !parseTypeDiagnostics(output).length && input.toolchain.nodePath
    ? repairBatch25({
      root: input.root, output, sourcePattern: input.sourcePattern,
      nodePath: input.toolchain.nodePath, nodeModules: input.nodeModules, testCommand: input.testCommand,
    })
    : null;
  if (batch25) {
    return {
      status: "diff", diff: batch25.diff, attempts: 1, expectations: [], diagnostic: diag("verified", code, output),
      fit: { shape: "batch25", examples: 0, targets: [{ symbol: "batch25", file: batch25.file, form: "named", exportName: "batch25", args: [] }] },
    };
  }
  const batch28 = !parseTypeDiagnostics(output).length && input.toolchain.nodePath
    ? repairBatch28({
      root: input.root, output, sourcePattern: input.sourcePattern,
      nodePath: input.toolchain.nodePath, nodeModules: input.nodeModules, testCommand: input.testCommand,
    })
    : null;
  if (batch28) {
    return {
      status: "diff", diff: batch28.diff, attempts: 1, expectations: [], diagnostic: diag("verified", code, output),
      fit: { shape: "batch28", examples: 0, targets: [{ symbol: "batch28", file: batch28.file, form: "named", exportName: "batch28", args: [] }] },
    };
  }
  const batch37 = !parseTypeDiagnostics(output).length && input.toolchain.nodePath
    ? repairBatch37({
      root: input.root, output, sourcePattern: input.sourcePattern,
      nodePath: input.toolchain.nodePath, nodeModules: input.nodeModules, testCommand: input.testCommand,
    })
    : null;
  if (batch37) {
    return {
      status: "diff", diff: batch37.diff, attempts: 1, expectations: [], diagnostic: diag("verified", code, output),
      fit: { shape: "batch37", examples: 0, targets: [{ symbol: "batch37", file: batch37.file, form: "named", exportName: "batch37", args: [] }] },
    };
  }
  if (parseTypeDiagnostics(output).length) {
    const note = diag("ava_early_exit", code, output);
    return { status: "cant", reason: "CANT_DO_YET_AVA_EARLY_EXIT", attempts: 0, diagnostic: note };
  }
  const early = avaEarlyDetail(output, code, input.testTitle ?? soleTestTitle(read(input.root, input.testFile)));
  if (early) {
    const note = diag("ava_early_exit", code, `${early}\n${output}`);
    if (note.lines[0] !== early) note.lines = [early, ...note.lines].slice(0, 5);
    return { status: "cant", reason: "CANT_DO_YET_AVA_EARLY_EXIT", attempts: 0, diagnostic: note };
  }
  const seen = classifyRunnerOutput(output, first.code);
  if (seen === "runner_error" || /has no exported member|does not provide an export named|TypeError: [A-Za-z_$][\w$]* is not a function/.test(output)) {
    const built = finishScaffold(input, output, first.code, cap);
    if (built) return built;
  }
  if (seen === "runner_error") return { status: "cant", reason: "CANT_DO_YET_RUNNER_ERROR", attempts: 0, diagnostic: diag("runner_error", first.code, output) };
  if (seen === "no_failure") return { status: "cant", reason: "CANT_DO_YET_NO_FAILURE", attempts: 0, diagnostic: diag("no_failure", first.code, output) };
  const testText = read(input.root, input.testFile);
  if (testText === null) return { status: "cant", reason: "CANT_DO_YET_ASSERTION_UNPARSED", attempts: 0, diagnostic: diag("assertion_unparsed", first.code, output) };
  const exists = (path: string) => read(input.root, path) !== null;
  const failing = failingTestNames(output);
  const expectations = expectationsIn(input.testFile, testText, input.sourcePattern, deny, exists, failing);
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
  const repo = openRepo(input.root);
  const related = [...(input.relatedTests ?? [])];
  if (input.originalSuite === "related" && input.relatedTests === undefined) {
    for (const file of sourceFiles) {
      const found = repo.testsFor(file);
      if (found.ok) for (const test of found.tests) if (test.path !== input.testFile) related.push(test.path);
    }
  }
  const proposer = repairProposer({ v2: true });
  proposer.prepare(repo, { request, failing, baseFailing: failing, specText: testText });
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
    return { status: "diff", diff, attempts, expectations, diagnostic: diag("verified", 0, output), fit: repairFit(expectations, proposal.kind || "repair") };
  }
}
