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
// Other edits come from the loop-v2 repair proposer (the catalog of templates). Attempts stay within
// that loop's MAX_ATTEMPTS and the proposer's MAX_CANDIDATES. A diff is returned only when the given
// test passes and the original suite still passes. Nothing here pushes.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, posix } from "node:path";
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
  "CANT_DO_YET_NO_BODY",
  "CANT_DO_YET_SIGNATURE",
  "CANT_DO_YET_NOT_A_FUNCTION",
  "CANT_DO_YET_NO_MODULE",
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
  "missing_symbol",
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

/** A symbol the runner says the base does not provide, and the module the test imported it from. */
export interface MissingSymbol {
  symbol: string;
  module: string;
  /** Repo path the import names, when that path matches sourcePattern. */
  file: string | null;
  shape: "named" | "default" | "default-prop";
}

export type ScaffoldPlan =
  | { ok: true; files: { path: string; content: string }[]; symbols: MissingSymbol[]; expectations: Expectation[] }
  | { ok: false; reason: SpecCant; symbols: MissingSymbol[] };

const PARAMS = ["a", "b", "c", "d", "e", "f"];

interface BindingRef { spec: string; file: string | null; local: string; imported: string; kind: "named" | "default" | "namespace" }
interface CallFact { arity: number; args: unknown[] | null; reduced: { kind: "equal" | "boolean" | "type"; expected: unknown } | { kind: "throws" } | null }
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

function evalConcrete(node: ts.Expression): { ok: true; value: unknown } | { ok: false } {
  const expr = unwrap(node);
  if (ts.isStringLiteral(expr) || ts.isNoSubstitutionTemplateLiteral(expr)) return { ok: true, value: expr.text };
  if (ts.isNumericLiteral(expr)) return { ok: true, value: Number(expr.text) };
  if (expr.kind === ts.SyntaxKind.TrueKeyword) return { ok: true, value: true };
  if (expr.kind === ts.SyntaxKind.FalseKeyword) return { ok: true, value: false };
  if (expr.kind === ts.SyntaxKind.NullKeyword) return { ok: true, value: null };
  if (ts.isPrefixUnaryExpression(expr) && expr.operator === ts.SyntaxKind.MinusToken && ts.isNumericLiteral(expr.operand)) return { ok: true, value: -Number(expr.operand.text) };
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
      if (!ts.isPropertyAssignment(prop)) return { ok: false };
      const key = ts.isIdentifier(prop.name) || ts.isStringLiteral(prop.name) || ts.isNumericLiteral(prop.name) ? prop.name.text : null;
      if (key === null) return { ok: false };
      const v = evalConcrete(prop.initializer);
      if (!v.ok) return v;
      obj[key] = v.value;
    }
    return { ok: true, value: obj };
  }
  return { ok: false };
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
      if ((name === "toBe" || name === "toEqual" || name === "toStrictEqual") && outer.parent.arguments[0]) {
        const v = evalConcrete(outer.parent.arguments[0]);
        return v.ok ? { kind: "equal", expected: v.value } : null;
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
      return v.ok ? { kind: "equal", expected: v.value } : null;
    }
    if (method === "ok") return { kind: "boolean", expected: true };
  }
  if ((obj === "t" || obj === "tt") && (at === 0 || at === 1)) {
    if (at === 0 && method === "true") return { kind: "boolean", expected: true };
    if (at === 0 && method === "false") return { kind: "boolean", expected: false };
    if ((method === "is" || method === "deepEqual") && other) {
      const v = evalConcrete(other);
      return v.ok ? { kind: "equal", expected: v.value } : null;
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

function comparisonBody(examples: Example[]): string | null {
  if (!examples.length || examples.some((ex) => typeof ex.expected !== "boolean" || ex.args.some((arg) => typeof arg !== "number"))) return null;
  const arity = examples[0]!.args.length;
  if (examples.some((ex) => ex.args.length !== arity) || (arity !== 1 && arity !== 2)) return null;
  const fits: string[] = [];
  const constants = [...new Set(examples.flatMap((ex) => ex.args as number[]))];
  const keep = (text: string, fn: (args: number[]) => boolean) => { if (examples.every((ex) => fn(ex.args as number[]) === ex.expected)) fits.push(text); };
  if (arity === 2) for (const pred of CMP) keep(`a ${pred.op} b`, (args) => pred.fn(args[0]!, args[1]!));
  for (const n of constants) for (const pred of CMP) {
    keep(`a ${pred.op} ${JSON.stringify(n)}`, (args) => pred.fn(args[0]!, n));
    if (arity === 2) keep(`b ${pred.op} ${JSON.stringify(n)}`, (args) => pred.fn(args[1]!, n));
  }
  if (fits.length !== 1) return null;
  return `  return ${fits[0]};`;
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

/** One body, or a refusal. A body is kept only when every reduced call agrees with that one form. */
function bodyFor(calls: CallFact[], peers: { name: string; arity: number }[], symbol: string): { body: string; types: string[]; ret: string } | "signature" | "no-body" {
  if (!calls.length) return "no-body";
  const arities = new Set(calls.map((call) => call.arity));
  if (arities.size !== 1) return "signature";
  const arity = [...arities][0]!;
  if (arity > PARAMS.length) return "signature";
  const reduced = calls.filter((call) => call.reduced);
  if (!reduced.length || reduced.some((call) => call.args === null || call.reduced?.kind === "throws")) return "no-body";
  const examples: Example[] = reduced.map((call) => ({ args: call.args as unknown[], expected: call.reduced && "expected" in call.reduced ? call.reduced.expected : null }));
  const concrete = examples.filter((_, i) => reduced[i]?.reduced?.kind !== "type");
  if (!concrete.length || reduced.every((call) => call.reduced?.kind === "type")) return "no-body";
  const agree = (value: unknown) => reduced.every((call) => call.reduced?.kind !== "type" || ("expected" in call.reduced && call.reduced.expected === valueType(value)));
  const types = Array.from({ length: arity }, (_, i) => paramType(concrete.map((ex) => ex.args[i])));
  const options: { body: string; ret: string }[] = [];
  const keep = (body: string | null, ret: string) => { if (body && agree(concrete[0]!.expected)) options.push({ body, ret }); };
  if (concrete.every((ex) => JSON.stringify(ex.expected) === JSON.stringify(concrete[0]!.expected))) keep(literalBody(concrete), resultType(concrete.map((ex) => ex.expected)));
  keep(booleanBody(concrete), "boolean");
  keep(typeofBody(concrete), resultType(concrete.map((ex) => ex.expected)));
  const gaps = stringBody(concrete);
  if (gaps) {
    const parts: string[] = [];
    if (gaps[0]) parts.push(JSON.stringify(gaps[0]));
    PARAMS.slice(0, arity).forEach((name, i) => { parts.push(name); if (gaps[i + 1]) parts.push(JSON.stringify(gaps[i + 1])); });
    keep(renderReturn(parts.length ? parts : ['""']), "string");
  }
  keep(comparisonBody(concrete), "boolean");
  keep(projectBody(concrete), resultType(concrete.map((ex) => ex.expected)));
  keep(sumBody(concrete), "number");
  keep(splitBody(concrete), "string");
  const peersFit = peers.filter((peer) => peer.name !== symbol && peer.arity === arity);
  if (peersFit.length === 1) keep(`  return ${peersFit[0]!.name}(${PARAMS.slice(0, arity).join(", ")});`, "unknown");
  const unique = [...new Map(options.map((option) => [option.body, option])).values()];
  if (unique.length !== 1) return "no-body";
  return { body: unique[0]!.body, types, ret: unique[0]!.ret };
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
export function scaffoldPlan(testFile: string, text: string, output: string, sourcePattern: string, deny: readonly string[] = [], read: (path: string) => string | null = () => null): ScaffoldPlan | null {
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
        add({ symbol: hit.symbol, module: hit.binding.spec, file: hit.binding.file, shape: hit.shape }, {
          arity: node.arguments.length,
          args: args.every((arg) => arg.ok) ? args.map((arg) => arg.ok ? arg.value : null) : null,
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
  for (const [path, group] of byFile) {
    if (group.filter((want) => want.shape === "default").length > 1) return { ok: false, reason: "CANT_DO_YET_NO_BODY", symbols };
    if (group.some((want) => want.shape === "default") && group.some((want) => want.shape === "default-prop")) return { ok: false, reason: "CANT_DO_YET_NO_BODY", symbols };
    const existing = read(path);
    if (existing !== null && group.some((want) => want.shape !== "named")) return { ok: false, reason: "CANT_DO_YET_NO_BODY", symbols };
    const peers = existing === null ? [] : peerFunctions(existing);
    const chunks: string[] = [];
    for (const want of group) {
      const built = bodyFor(want.calls, peers, want.symbol);
      if (built === "signature") return { ok: false, reason: "CANT_DO_YET_SIGNATURE", symbols };
      if (built === "no-body") return { ok: false, reason: "CANT_DO_YET_NO_BODY", symbols };
      chunks.push(renderFunction(want.symbol, want.shape, built));
      for (const call of want.calls) {
        if (!call.reduced || call.args === null || call.reduced.kind === "throws" || expectations.length >= 32) continue;
        expectations.push({
          kind: call.reduced.kind, symbol: want.symbol, file: path,
          input: call.args.map((arg) => JSON.stringify(arg)).join(", ").slice(0, 80),
          expected: JSON.stringify(call.reduced.expected).slice(0, 80),
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
  return { ok: true, files, symbols, expectations };
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
  return { status: "diff", diff, attempts: 1, expectations: plan.expectations, diagnostic: note("verified", 0, output) };
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
  if (seen === "runner_error" || /has no exported member|does not provide an export named|TypeError: [A-Za-z_$][\w$]* is not a function/.test(output)) {
    const built = finishScaffold(input, output, first.code, cap);
    if (built) return built;
  }
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
