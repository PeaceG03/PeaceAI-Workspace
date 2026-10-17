// M15: the ADD_FUNCTION learned rule. A spec of this kind carries the style mined from Builder's own new exported
// pure functions in public repositories (peaceai/lib/mine.ts, shape PURE_FUNCTION): a top-level
// `export function name(typed params): Type { return EXPR; }`. The edit is fixed here: ONE such function appended
// at the end of an existing source module, plus ONE new test file from the task's bullets. Parameters and the
// return type come from a small type vocabulary; EXPR may use only the new function's parameters, literals and a
// fixed set of pure operators, built-ins and string/array methods (no other names, no calls to the module's code,
// no closures, no assignment). Job B grades the candidate against itself (`selfGrade`): its new test must pass with
// the function and fail with the module put back to the task base. Deterministic; no model.
import { createHash, randomBytes } from "node:crypto";
import { existsSync, lstatSync, realpathSync } from "node:fs";
import { join, relative, sep } from "node:path";
import ts from "typescript";
import { buildTestEdit, parseTestTask, type TestTask } from "./learned-test.ts";

export const FUNCTION_PARAM_KEYS = ["body", "grading", "params", "placement", "returns", "test"] as const;
export const FUNCTION_VOCAB: Record<(typeof FUNCTION_PARAM_KEYS)[number], readonly string[]> = {
  body: ["single-return"],
  grading: ["self-fail-before-pass-after"],
  params: ["typed"],
  // M17: "end-of-module-or-new-module" also lets the rule create the named module when it does not exist yet.
  placement: ["end-of-module", "end-of-module-or-new-module"],
  returns: ["annotated"],
  test: ["new-file"],
};
export const MAX_EXPR_CHARS = 200;
export const MAX_PARAMS = 4;
/** M15.1: padStart/padEnd target length cap (integer literal only); `repeat` is not allowed. */
export const MAX_PAD = 64;
const PAD = new Set(["padStart", "padEnd"]);
/** Parameter and return types a learned function may declare. */
export const FUNCTION_TYPES = ["string", "number", "boolean", "string[]", "number[]", "readonly string[]", "readonly number[]"] as const;
const NAME = String.raw`[A-Za-z_$][\w$]*`;
const FILE = String.raw`[\w./-]+\.ts`;
const TYPE = String.raw`(?:readonly )?(?:string|number|boolean)(?:\[\])?`;
const PARAM = String.raw`${NAME}: ?${TYPE}`;
/**
 * Header line (the rule's trigger). Backticks are optional (issue cleaning turns them into spaces):
 * add function NAME(a: T, b: U): R to src/file.ts returning EXPR
 */
export const FUNCTION_TRIGGER = String.raw`^add (?:a )?(?:pure )?function \x60?(?<fn>${NAME}) ?\((?<sig>(?:${PARAM}(?:, ?${PARAM}){0,${MAX_PARAMS - 1}})?)\) ?: ?(?<ret>${TYPE})\x60? to \x60?(?<file>${FILE})\x60? returning (?<expr>[^\n]{1,${MAX_EXPR_CHARS}}?)\.?$`;

export interface FunctionTask { fn: string; file: string; params: { name: string; type: string }[]; ret: string; expr: string; test: TestTask }
export interface FunctionEdit { path: string; content: string; create?: true; extra: { path: string; content: string; create: true }[]; selfGrade: true }

const strip = (s: string) => s.replace(/\x60/g, " ").trim();

export function parseFunctionTask(trigger: string, objective: string): FunctionTask | null {
  const lines = objective.split("\n").map((l) => l.trim()).filter(Boolean);
  const heads = lines.filter((l) => new RegExp(trigger, "i").test(l));
  if (heads.length !== 1) return null;
  const g = new RegExp(trigger, "i").exec(heads[0]!)!.groups ?? {};
  if (!g.fn || !g.file || !g.ret || g.expr === undefined || g.sig === undefined) return null;
  const params: { name: string; type: string }[] = [];
  for (const part of g.sig.split(",").map((p) => p.trim()).filter(Boolean)) {
    const m = new RegExp(String.raw`^(${NAME}): ?(${TYPE})$`).exec(part);
    if (!m || params.some((p) => p.name === m[1])) return null;
    params.push({ name: m[1]!, type: m[2]! });
  }
  if (params.length === 0 || params.length > MAX_PARAMS) return null;
  if (!(FUNCTION_TYPES as readonly string[]).includes(g.ret) || params.some((p) => !(FUNCTION_TYPES as readonly string[]).includes(p.type))) return null;
  const expr = strip(g.expr);
  const pseudo = createHash("sha256").update(`${g.file}\0${g.fn}\0${g.sig}\0${g.ret}\0${expr}`).digest("hex").slice(0, 40);
  // The test bullets reuse the M12 grammar; the "fix" is this candidate itself (a stable id names the file).
  const testText = [`add a test for ${g.fn} in ${g.file}: ${g.fn} returns the expected values`, ...lines.filter((l) => /^[-*] /.test(l)), `Fix: ${pseudo}`].join("\n");
  const test = parseTestTask(String.raw`^add (?:a )?test for (?<symbol>${NAME}) in (?<file>${FILE})(?: ?: (?<title>[^\n]{1,120}?))?$`, testText);
  if (!test || test.symbol !== g.fn || test.file !== g.file || test.checks.length === 0) return null;
  if (test.checks.some((c) => c.kind === "rejects")) return null;
  return { fn: g.fn, file: g.file, params, ret: g.ret, expr, test };
}

const parseExpr = (text: string): ts.Expression | null => {
  const sf = ts.createSourceFile("e.ts", `(${text});`, ts.ScriptTarget.Latest, true);
  const st = sf.statements;
  if (st.length !== 1 || !ts.isExpressionStatement(st[0]!) || (sf as unknown as { parseDiagnostics: unknown[] }).parseDiagnostics.length) return null;
  const e = (st[0] as ts.ExpressionStatement).expression;
  return ts.isParenthesizedExpression(e) ? e.expression : null;
};

/** Pure free calls (any arity, allowed arguments only). */
const CALLS = new Set(["Math.min", "Math.max", "Math.floor", "Math.ceil", "Math.round", "Math.abs", "Math.trunc", "Math.sign", "String", "Number", "Boolean", "Number.isFinite", "Number.isInteger", "Number.isNaN", "Number.isSafeInteger", "Array.isArray"]);
/** Pure methods on a value built from the parameters (strings and arrays; none mutates its receiver). */
const METHODS = new Set(["slice", "padStart", "padEnd", "includes", "startsWith", "endsWith", "trim", "trimStart", "trimEnd", "toUpperCase", "toLowerCase", "indexOf", "lastIndexOf", "at", "join", "concat", "split", "toFixed"]);
const PROPS = new Set(["length"]);
const BINARY = new Set([
  ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken, ts.SyntaxKind.LessThanToken, ts.SyntaxKind.LessThanEqualsToken,
  ts.SyntaxKind.GreaterThanToken, ts.SyntaxKind.GreaterThanEqualsToken, ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken,
  ts.SyntaxKind.PlusToken, ts.SyntaxKind.MinusToken, ts.SyntaxKind.AsteriskToken, ts.SyntaxKind.SlashToken, ts.SyntaxKind.PercentToken,
]);

/**
 * True when every node of EXPR is allowed, every free name is one of `params`, and at least one parameter is read
 * (a constant body is refused). Allowed: literals, parameters, `.length`, the listed pure methods and calls,
 * arithmetic/comparison/logical operators, `!`, unary minus, `typeof`, `?:`, template literals and array literals.
 * Not allowed: any other name (so no calls into the module or globals), `new`, assignment, `++/--`, `delete`,
 * closures, spread, element access, optional chaining. Note: a caller-supplied object could still run a getter.
 */
/** M74 (public-date-function-v1): extra callables and methods a spec may add to the vocabulary (each call's argument cap). */
export interface ExtraVocab { calls: ReadonlyMap<string, number>; methods: ReadonlySet<string> }
export function safeBody(e: ts.Expression, params: ReadonlySet<string>, extra?: ExtraVocab): boolean {
  let usesParam = false;
  const ok = (n: ts.Node): boolean => {
    if (ts.isParenthesizedExpression(n)) return ok(n.expression);
    if (ts.isIdentifier(n)) { if (params.has(n.text)) usesParam = true; return params.has(n.text); }
    if (ts.isStringLiteral(n) || ts.isNumericLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) || n.kind === ts.SyntaxKind.TrueKeyword || n.kind === ts.SyntaxKind.FalseKeyword || n.kind === ts.SyntaxKind.NullKeyword) return true;
    if (ts.isTemplateExpression(n)) return n.templateSpans.every((s) => ok(s.expression));
    if (ts.isArrayLiteralExpression(n)) return n.elements.length <= 16 && n.elements.every((x) => !ts.isSpreadElement(x) && !ts.isOmittedExpression(x) && ok(x));
    if (ts.isPropertyAccessExpression(n)) return !n.questionDotToken && ts.isIdentifier(n.name) && PROPS.has(n.name.text) && ok(n.expression);
    if (ts.isPrefixUnaryExpression(n)) return (n.operator === ts.SyntaxKind.ExclamationToken || n.operator === ts.SyntaxKind.MinusToken) && ok(n.operand);
    if (ts.isTypeOfExpression(n)) return ok(n.expression);
    if (ts.isConditionalExpression(n)) return ok(n.condition) && ok(n.whenTrue) && ok(n.whenFalse);
    if (ts.isBinaryExpression(n)) return BINARY.has(n.operatorToken.kind) && ok(n.left) && ok(n.right);
    if (ts.isCallExpression(n)) {
      const callee = n.expression;
      const extraCall = ts.isIdentifier(callee) && !!extra?.calls.has(callee.text);
      if (n.questionDotToken || n.typeArguments || n.arguments.length > (extraCall ? extra!.calls.get((callee as ts.Identifier).text)! : 4) || !n.arguments.every((a) => !ts.isSpreadElement(a) && ok(a))) return false;
      if (extraCall) return true;
      if (ts.isPropertyAccessExpression(callee) && !callee.questionDotToken && ts.isIdentifier(callee.name) && (METHODS.has(callee.name.text) || !!extra?.methods.has(callee.name.text)) && !CALLS.has(callee.getText())) {
        // padStart/padEnd: the target length must be a small integer literal (bounded output).
        if (PAD.has(callee.name.text)) { const len = n.arguments[0]; if (!len || !ts.isNumericLiteral(len) || !/^\d+$/.test(len.text) || Number(len.text) > MAX_PAD) return false; }
        return ok(callee.expression);
      }
      return CALLS.has(callee.getText());
    }
    return false;
  };
  return ok(e) && usesParam;
}

/** Every top-level and nested declaration name in the module, plus imported names. */
function declaredNames(sf: ts.SourceFile): Set<string> {
  const out = new Set<string>();
  const visit = (n: ts.Node) => {
    const name = (n as { name?: ts.Node }).name;
    if (name && ts.isIdentifier(name) && (ts.isFunctionDeclaration(n) || ts.isVariableDeclaration(n) || ts.isClassDeclaration(n) || ts.isInterfaceDeclaration(n) || ts.isTypeAliasDeclaration(n) || ts.isEnumDeclaration(n) || ts.isImportSpecifier(n) || ts.isNamespaceImport(n) || ts.isImportClause(n))) out.add(name.text);
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

/** Builds the appended function and its new test. Refuses (null) on anything outside the learned, fixed shape. */
export function buildFunctionEdit(
  params: Record<string, string | string[]>,
  task: FunctionTask,
  files: readonly { path: string; content: string }[],
  isTest: (p: string) => boolean = (p) => /\.test\.ts$/.test(p),
): FunctionEdit | null {
  for (const k of FUNCTION_PARAM_KEYS) if (typeof params[k] !== "string" || !FUNCTION_VOCAB[k].includes(params[k] as string)) return null;
  if (task.expr.length > MAX_EXPR_CHARS) return null;
  const target = files.find((f) => f.path === task.file);
  if (!target) return params.placement === "end-of-module-or-new-module" ? buildNewModule(task, files, isTest) : null;
  if (isTest(target.path) || !/\.ts$/.test(target.path) || /\.d\.ts$/.test(target.path)) return null;
  const sf = ts.createSourceFile(target.path, target.content, ts.ScriptTarget.Latest, true);
  if ((sf as unknown as { parseDiagnostics: unknown[] }).parseDiagnostics.length) return null;
  // A new function only: the name must not already be declared, imported or exported anywhere in the module.
  if (declaredNames(sf).has(task.fn) || new RegExp(String.raw`\b${task.fn.replace(/\$/g, "\\$")}\b`).test(target.content)) return null;
  const names = new Set(task.params.map((p) => p.name));
  if (names.has(task.fn) || PROTECTED_NAMES.test(task.fn) || [...names].some((n) => PROTECTED_NAMES.test(n))) return null;
  const body = parseExpr(task.expr);
  if (!body || !safeBody(body, names)) return null;
  const sig = task.params.map((p) => `${p.name}: ${p.type}`).join(", ");
  const fnText = `export function ${task.fn}(${sig}): ${task.ret} {\n  return ${body.getText()};\n}\n`;
  const base = target.content.endsWith("\n") ? target.content : `${target.content}\n`;
  const content = `${base}\n${fnText}`;
  const post = ts.createSourceFile(target.path, content, ts.ScriptTarget.Latest, true);
  if ((post as unknown as { parseDiagnostics: unknown[] }).parseDiagnostics.length) return null;
  // The test is built against the module WITH the new function (it must export every name a check starts from).
  const withFn = files.map((f) => (f.path === target.path ? { path: f.path, content } : f));
  const testParams = { assert: "node:assert/strict-default", checks: ["equal", "deepEqual", "throws"], framework: "node:test-default", grading: "fail-before-pass-after", matcher: "regex", maxLines: "12", placement: "new-file" };
  const test = buildTestEdit(testParams, task.test, withFn, isTest);
  if (!test || !callsFunction(test.content, task.fn)) return null;
  return { path: target.path, content, extra: [{ path: test.path, content: test.content, create: true }], selfGrade: true };
}

/** M17: the named module does not exist yet, so the function becomes a new module holding only it. */
export const NEW_MODULE_PATH = /^src\/(?:[a-z0-9][\w-]*\/)*[a-z0-9][\w-]*\.ts$/;
function buildNewModule(task: FunctionTask, files: readonly { path: string; content: string }[], isTest: (p: string) => boolean): FunctionEdit | null {
  const path = task.file;
  if (!NEW_MODULE_PATH.test(path) || PROTECTED_MODULE.test(path) || isTest(path) || /\.d\.ts$/.test(path) || /\.(test|spec)\./.test(path)) return null;
  // Same-directory sibling required: a new module goes next to existing source, never into a new directory.
  const dir = path.slice(0, path.lastIndexOf("/") + 1);
  if (!files.some((f) => f.path.startsWith(dir) && !f.path.slice(dir.length).includes("/") && /\.ts$/.test(f.path) && !isTest(f.path))) return null;
  // The name must not already be a file name in that directory (case-insensitive), e.g. foo.ts vs Foo.ts.
  if (files.some((f) => f.path.toLowerCase() === path.toLowerCase())) return null;
  const names = new Set(task.params.map((p) => p.name));
  if (names.has(task.fn) || PROTECTED_NAMES.test(task.fn) || [...names].some((n) => PROTECTED_NAMES.test(n))) return null;
  const body = parseExpr(task.expr);
  if (!body || !safeBody(body, names)) return null;
  const sig = task.params.map((p) => `${p.name}: ${p.type}`).join(", ");
  const content = `export function ${task.fn}(${sig}): ${task.ret} {\n  return ${body.getText()};\n}\n`;
  const post = ts.createSourceFile(path, content, ts.ScriptTarget.Latest, true);
  if ((post as unknown as { parseDiagnostics: unknown[] }).parseDiagnostics.length) return null;
  const withFn = [...files, { path, content }];
  const testParams = { assert: "node:assert/strict-default", checks: ["equal", "deepEqual", "throws"], framework: "node:test-default", grading: "fail-before-pass-after", matcher: "regex", maxLines: "12", placement: "new-file" };
  const test = buildTestEdit(testParams, task.test, withFn, isTest);
  if (!test || test.path === path || !callsFunction(test.content, task.fn)) return null;
  return { path, content, create: true, extra: [{ path: test.path, content: test.content, create: true }], selfGrade: true };
}

/**
 * M17 (Auditor): names a new function may never take: gate/approval/leak function names (they would reach the
 * protected set by content), prototype/Object members, and anything starting with `__`.
 */
export const PROTECTED_NAMES = /^(?:isProtectedPath|protectedReason|PROTECTED_SELF|checkSelfChangeDiff|promotionDecision|mayChangeProtected|lmJobAllowed|scanText|validateSpec|specHash|applyRule|admitRules|loadApprovedList|checkCandidateScope|gradeSelf|gradingVerdict|validTestGrading|rebaseAndRegrade|stubFunction|constructor|prototype|toString|valueOf|hasOwnProperty|isPrototypeOf|propertyIsEnumerable|toLocaleString|then|default|__\w*)$/;
/** Paths a new module may never take: anything protected, or under peaceai/, .github/ or scripts. */
export const PROTECTED_MODULE = /(^|\/)(peaceai|\.github|\.githooks|scripts?|bin)\/|(^|[\/._-])(public-origin|approved?|approval|leak|gates?|selfchange|secrets?|tokens?|credentials?)([._-]|\.ts$)/i;

/** M17 (Auditor): an import-only test is refused. The test must CALL the function (outside the import line). */
export function callsFunction(testContent: string, fn: string): boolean {
  const sf = ts.createSourceFile("t.ts", testContent, ts.ScriptTarget.Latest, true);
  let calls = 0;
  const visit = (n: ts.Node) => { if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === fn) calls++; ts.forEachChild(n, visit); };
  visit(sf);
  return calls > 0;
}

/**
 * M17 (Auditor): the module with exported function `fn`'s body replaced by a type-default return ("" / 0 /
 * false / []). The new test must FAIL against this stub too (a test a constant satisfies proves nothing).
 * Null when `fn` is not exactly one exported single-return function with a vocabulary return type.
 */
export function stubFunction(content: string, fn: string): string | null {
  const sf = ts.createSourceFile("m.ts", content, ts.ScriptTarget.Latest, true);
  const hits = sf.statements.filter((s): s is ts.FunctionDeclaration => ts.isFunctionDeclaration(s) && s.name?.text === fn);
  if (hits.length !== 1) return null;
  const f = hits[0]!;
  const st = f.body?.statements;
  if (!f.type || !st || st.length !== 1 || !ts.isReturnStatement(st[0]!) || !st[0]!.expression) return null;
  const t = f.type.getText(sf).replace(/^readonly /, "");
  const dflt = t === "string" ? '""' : t === "number" ? "0" : t === "boolean" ? "false" : /\[\]$/.test(t) ? "[]" : null;
  if (!dflt) return null;
  const e = st[0]!.expression;
  return content.slice(0, e.getStart(sf)) + dflt + content.slice(e.getEnd());
}

export function applyFunctionRule(trigger: string, params: Record<string, string | string[]>, objective: string, files: readonly { path: string; content: string }[], isTest?: (p: string) => boolean): FunctionEdit | null {
  const task = parseFunctionTask(trigger, objective);
  return task ? buildFunctionEdit(params, task, files, isTest) : null;
}

/**
 * M17 (Auditor): on disk, a new module's path must resolve inside `root` and no existing component of it may be
 * a symlink (checked with lstat, then realpath of the deepest existing directory). The file itself must not exist.
 */
export function safeNewModuleOnDisk(root: string, rel: string): boolean {
  if (!NEW_MODULE_PATH.test(rel)) return false;
  let realRoot: string;
  try { realRoot = realpathSync(root); } catch { return false; }
  const parts = rel.split("/");
  let cur = root;
  for (let i = 0; i < parts.length; i++) {
    cur = join(cur, parts[i]!);
    let st;
    try { st = lstatSync(cur); } catch { if (i === parts.length - 1) break; return false; }
    if (st.isSymbolicLink()) return false;
    if (i === parts.length - 1) return false; // the module already exists
    if (!st.isDirectory()) return false;
  }
  const dir = join(root, ...parts.slice(0, -1));
  if (!existsSync(dir)) return false;
  const r = relative(realRoot, realpathSync(dir));
  return r === "" || (!r.startsWith("..") && !r.startsWith(sep) && !r.split(sep).includes(".."));
}

/** M23: prefix of the per-run nonce the HARNESS (parent) holds; never written into the stubbed module. */
export const STUB_BODY_CODE = "PEACEAI_STUB_BODY";
/** A fresh per-run nonce, `PEACEAI_STUB_BODY_<32 hex>`, held only by the parent (names its note channel). */
export function newStubCode(): string {
  return `${STUB_BODY_CODE}_${randomBytes(16).toString("hex")}`;
}
/**
 * Round 3 (Auditor #129): the fd the stub writes its "stub ran" note to: the test process's stderr, which the
 * parent points at a file it opened O_WRONLY|O_APPEND in its own 0700 directory (fds 0-2 survive sudo; higher fds
 * do not). A read on it fails (EBADF) and the test has no read permission for the file's path.
 */
export const STUB_NOTE_FD = 2;
export const STUB_NOTE = "\u0000peaceai-stub-ran\n";
/** Number of stub notes in the parent's copy of the channel. */
export const countStubNotes = (channel: string): number => channel.split(STUB_NOTE).length - 1;
/**
 * Round 3 (Auditor #129): the stub is WRITE-ONLY and holds no code. On each call it writes STUB_NOTE to fd
 * STUB_NOTE_FD (opened O_WRONLY by the parent, so a read on it fails with EBADF) and returns a type default
 * (string/number/boolean/array) or `undefined`. It never throws; the only credited failure is an assertion.
 */
const STUB_PRELUDE = `import { writeSync as __peaceaiStubWrite } from "node:fs";\nfunction __peaceaiStubRan(): void { try { __peaceaiStubWrite(${STUB_NOTE_FD}, ${JSON.stringify(STUB_NOTE)}); } catch { /* no note channel */ } }\n`;

/**
 * M23 (Auditor, #127): the "before" state for a learned test whose fix commit CREATED the module. Exported
 * function `fn`'s whole body is replaced by `{ __peaceaiStubRan(); return <default>; }`. Null (fail closed) when
 * `fn` is not exactly one top-level function declaration with a body, or is a generator/overloaded. `throws` is
 * true when no type default applies (then `return undefined`); the caller still refuses expects-throw tests there.
 * The note helper itself is added once by stubAll.
 */
export function stubBody(content: string, fn: string, requireExport = true, objects = false): { content: string; throws: boolean } | null {
  const sf = ts.createSourceFile("m.ts", content, ts.ScriptTarget.Latest, true);
  const hits = sf.statements.filter((s): s is ts.FunctionDeclaration => ts.isFunctionDeclaration(s) && s.name?.text === fn);
  if (hits.length !== 1) return null;
  const f = hits[0]!;
  if (!f.body || f.asteriskToken || (requireExport && !(ts.getModifiers(f) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword))) return null;
  const t = f.type?.getText(sf).replace(/^readonly /, "") ?? "";
  // M85 (test-case-existing-v2 only, `objects`): any other annotated return (a plain-data object type) stubs to `{}`.
  const dflt = t === "string" ? '""' : t === "number" ? "0" : t === "boolean" ? "false" : /\[\]$/.test(t) ? "[]" : objects && t !== "" ? "({} as never)" : null;
  const stub = `{ __peaceaiStubRan(); return ${dflt ?? "undefined as never"}; }`;
  return { content: content.slice(0, f.body.getStart(sf)) + stub + content.slice(f.body.getEnd()), throws: dflt === null };
}

/**
 * M23 (Auditor #129): the bindings a test imports from `spec`: `imported` is the module's export name, `local`
 * the name the test calls (differs for `{ a as b }`). Null (fail closed) when the test also imports `spec` as a
 * namespace or default, since calls through those cannot be attributed.
 */
export function importedBindings(testContent: string, spec: string): { imported: string; local: string }[] | null {
  const sf = ts.createSourceFile("t.ts", testContent, ts.ScriptTarget.Latest, true);
  const out: { imported: string; local: string }[] = [];
  for (const s of sf.statements) {
    if (!ts.isImportDeclaration(s) || !ts.isStringLiteral(s.moduleSpecifier) || s.moduleSpecifier.text !== spec) continue;
    const c = s.importClause;
    if (!c || c.isTypeOnly) continue;
    if (c.name) return null;
    const nb = c.namedBindings;
    if (!nb) continue;
    if (!ts.isNamedImports(nb)) return null;
    for (const e of nb.elements) if (!e.isTypeOnly) out.push({ imported: (e.propertyName ?? e.name).text, local: e.name.text });
  }
  return out;
}

/** M23: names a test imports from module specifier `spec` (named imports only). */
export function importedNames(testContent: string, spec: string): string[] {
  const sf = ts.createSourceFile("t.ts", testContent, ts.ScriptTarget.Latest, true);
  const out: string[] = [];
  for (const s of sf.statements) {
    if (!ts.isImportDeclaration(s) || !ts.isStringLiteral(s.moduleSpecifier) || s.moduleSpecifier.text !== spec) continue;
    const nb = s.importClause?.namedBindings;
    if (s.importClause?.isTypeOnly || !nb || !ts.isNamedImports(nb)) continue;
    for (const e of nb.elements) if (!e.isTypeOnly) out.push((e.propertyName ?? e.name).text);
  }
  return out;
}

/** M23: true when a test expects a throw or rejection (assert.throws / assert.rejects / assert.doesNotThrow...). */
export function expectsThrow(testContent: string): boolean {
  return /\bassert\s*\.\s*(?:throws|rejects|doesNotThrow|doesNotReject)\s*\(/.test(testContent);
}

/** M23: names of the top-level function declarations (with a body) in a module. */
export function declaredFunctions(content: string): string[] {
  const sf = ts.createSourceFile("m.ts", content, ts.ScriptTarget.Latest, true);
  return sf.statements.filter((s): s is ts.FunctionDeclaration => ts.isFunctionDeclaration(s) && !!s.name && !!s.body).map((s) => s.name!.text);
}

/**
 * M23 (Auditor): stub EVERY function in `fns` (the functions the fix commit created in this module), applied
 * one at a time on the result. Null (fail closed) when any of them is missing today or cannot be stubbed.
 */
export function stubAll(content: string, fns: readonly string[], objects = false): { content: string; throws: boolean } | null {
  if (fns.length === 0 || new Set(fns).size !== fns.length) return null;
  let cur = content;
  let throws = false;
  for (const fn of fns) {
    const s = stubBody(cur, fn, false, objects);
    if (!s) return null;
    cur = s.content;
    throws ||= s.throws;
  }
  if (/__peaceaiStub/.test(content)) return null; // the real module may not name the stub helper
  return { content: STUB_PRELUDE + cur, throws };
}

/**
 * Round 3 (Auditor #129): credit needs BOTH (a) the parent saw the stub run (`notes` > 0 STUB_NOTE bytes read
 * from its own end of the write-only channel) and (b) the runner reports at least one failure and EVERY failing
 * test failed by an assertion (ERR_ASSERTION). The stub holds no code, so nothing in the test's process can reveal
 * or forge a credited error; load errors, crashes, timeouts and any other throw are not credited.
 */
export function stubFailureCredited(tap: string, notes: number): boolean {
  if (!(notes > 0)) return false;
  const lines = tap.split("\n");
  let failures = 0;
  for (let i = 0; i < lines.length; i++) {
    if (!/^\s*not ok \d+ - /.test(lines[i]!)) continue;
    failures++;
    let errCode = "";
    for (let j = i + 1; j < lines.length && !/^\s*(?:not ok|ok) \d+ - /.test(lines[j]!); j++) {
      const c = /^\s+code: '([A-Z_]+)'$/.exec(lines[j]!); if (c && !errCode) errCode = c[1]!;
    }
    if (errCode !== "ERR_ASSERTION") return false;
  }
  return failures > 0;
}

/** Imports a graded test may have: the runner, strict assert, and modules named in `allowed` (named bindings only). */
const TEST_IMPORTS = new Set(["node:test", "node:assert/strict"]);
const FORBIDDEN_NAMES = new Set(["process", "require", "globalThis", "global", "eval", "Function", "Deno", "Bun", "__dirname", "__filename", "module", "exports", "Reflect", "Proxy", "setTimeout", "setInterval", "queueMicrotask", "fetch", "WebAssembly", "console",
  // Round 2 (Auditor #129): sources of nondeterminism and of a stringified function.
  "Date", "performance", "Symbol", "crypto", "String", "Intl", "arguments"]);
/** Round 2 (Auditor #129): property names that reach a function's source, prototype chain or caller. */
const FORBIDDEN_PROPS = new Set(["constructor", "__proto__", "prototype", "caller", "callee", "toString", "toLocaleString", "toSource", "random",
  // Round 3 (Auditor #129 F1/F2): descriptor/prototype walks, function names, high-resolution timing.
  // Round 4 (Auditor #129 B1): legacy accessor hooks.
  "__lookupGetter__", "__lookupSetter__", "__defineGetter__", "__defineSetter__",
  "name", "getPrototypeOf", "setPrototypeOf", "getOwnPropertyDescriptor", "getOwnPropertyDescriptors", "getOwnPropertyNames", "getOwnPropertySymbols", "defineProperty", "defineProperties", "values", "hrtime", "now", "timeOrigin"]);
/**
 * Round 3 (Auditor #129): ALLOW-list grammar. A free identifier (not declared in the test, not imported) must be
 * one of these globals; everything else (setImmediate, AbortSignal, MessageChannel, WeakRef, FinalizationRegistry,
 * Atomics, SharedArrayBuffer, structuredClone, ...) is refused. `Object` is allowed only for the listed members.
 */
const ALLOWED_GLOBALS = new Set(["undefined", "NaN", "Infinity", "Number", "Boolean", "Array", "JSON", "Math", "Error", "TypeError", "RangeError", "Map", "Set", "BigInt", "parseInt", "parseFloat", "isNaN", "isFinite", "Object", "Buffer"]);
const OBJECT_MEMBERS = new Set(["keys", "fromEntries", "freeze"]);
/**
 * Round 4 (Auditor #129 B1/B2): property names are an ALLOW-list too. `x.p` is accepted only when
 *  - x is a global with listed members (Object, Buffer.from/alloc, Math minus random, Number, JSON, Array), or
 *  - x is the test's `assert` import and p an assert method, or x is the test runner (`test.skip`/`todo`/`only`), or
 *  - p is a data key: declared by the test itself (object literal / type / destructuring keys) or by the module
 *    under test (`dataKeys`: its property keys, interface fields and property reads), or a plain data method.
 * FORBIDDEN_PROPS always wins. `Error`/`TypeError`/`RangeError` only as `new X(...)`.
 */
const GLOBAL_MEMBERS: Readonly<Record<string, ReadonlySet<string>>> = {
  Object: OBJECT_MEMBERS,
  Buffer: new Set(["from", "alloc"]),
  Math: new Set(["min", "max", "abs", "floor", "ceil", "round", "trunc", "sign", "sqrt", "pow", "PI", "E"]),
  Number: new Set(["isFinite", "isInteger", "isNaN", "isSafeInteger", "parseFloat", "parseInt", "MAX_SAFE_INTEGER", "MIN_SAFE_INTEGER", "EPSILON", "POSITIVE_INFINITY", "NEGATIVE_INFINITY"]),
  JSON: new Set(["parse", "stringify"]),
  Array: new Set(["isArray", "from", "of"]),
};
const ASSERT_METHODS = new Set(["ok", "equal", "notEqual", "deepEqual", "notDeepEqual", "strictEqual", "notStrictEqual", "deepStrictEqual", "notDeepStrictEqual", "throws", "doesNotThrow", "rejects", "doesNotReject", "match", "doesNotMatch", "fail"]);
const RUNNER_MEMBERS = new Set(["skip", "todo", "only"]);
/** M29 (Auditor follow-up): members of the test-context parameter (`test("x", (t) => ...)`). */
const CONTEXT_MEMBERS = new Set(["skip", "todo", "diagnostic"]);
const DATA_METHODS = new Set(["length", "size", "map", "filter", "find", "findIndex", "some", "every", "includes", "indexOf", "slice", "at", "concat", "flat", "reduce", "sort", "reverse", "startsWith", "endsWith", "trim", "split", "padStart", "padEnd", "toUpperCase", "toLowerCase", "toFixed", "get", "has", "add", "set", "push"]);
const ERROR_CTORS = new Set(["Error", "TypeError", "RangeError"]);
/** Round 4 (Auditor #129): the property names a module declares or reads (its returned values' members). */
export function moduleDataKeys(content: string): string[] {
  const sf = ts.createSourceFile("m.ts", content, ts.ScriptTarget.Latest, true);
  const out = new Set<string>();
  const v = (n: ts.Node): void => {
    if ((ts.isPropertyAssignment(n) || ts.isPropertySignature(n) || ts.isPropertyDeclaration(n)) && (ts.isIdentifier(n.name) || ts.isStringLiteral(n.name))) out.add(n.name.text);
    if (ts.isShorthandPropertyAssignment(n)) out.add(n.name.text);
    if (ts.isPropertyAccessExpression(n) && ts.isIdentifier(n.name)) out.add(n.name.text);
    if (ts.isBindingElement(n) && n.propertyName && ts.isIdentifier(n.propertyName)) out.add(n.propertyName.text);
    ts.forEachChild(n, v);
  };
  v(sf);
  return [...out].filter((k) => !FORBIDDEN_PROPS.has(k)).sort();
}
/** Round 4 (Auditor #129 B1): constant value of a string expression (literals, `+`, parens, no-substitution templates), or null. */
function constString(e: ts.Expression): string | null {
  if (ts.isStringLiteralLike(e)) return e.text;
  if (ts.isNumericLiteral(e)) return e.text;
  if (ts.isParenthesizedExpression(e)) return constString(e.expression);
  if (ts.isBinaryExpression(e) && e.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const a = constString(e.left), b = constString(e.right);
    return a !== null && b !== null ? a + b : null;
  }
  if (ts.isTemplateExpression(e)) {
    let out = e.head.text;
    for (const sp of e.templateSpans) { const x = constString(sp.expression); if (x === null) return null; out += x + sp.literal.text; }
    return out;
  }
  return null;
}
const dangerousString = (t: string) => FORBIDDEN_PROPS.has(t) || /__proto__|__lookup|__define|prototype|constructor/.test(t);
/** Round 3 (Auditor #129): syntax a graded test may use; any other node kind is refused. */
const ALLOWED_KINDS = new Set<ts.SyntaxKind>([
  ts.SyntaxKind.SourceFile, ts.SyntaxKind.EndOfFileToken, ts.SyntaxKind.ImportDeclaration, ts.SyntaxKind.ImportClause, ts.SyntaxKind.NamedImports, ts.SyntaxKind.ImportSpecifier, ts.SyntaxKind.NamespaceImport,
  ts.SyntaxKind.Identifier, ts.SyntaxKind.StringLiteral, ts.SyntaxKind.NumericLiteral, ts.SyntaxKind.BigIntLiteral, ts.SyntaxKind.RegularExpressionLiteral,
  ts.SyntaxKind.NoSubstitutionTemplateLiteral, ts.SyntaxKind.TemplateExpression, ts.SyntaxKind.TemplateHead, ts.SyntaxKind.TemplateMiddle, ts.SyntaxKind.TemplateTail, ts.SyntaxKind.TemplateSpan,
  ts.SyntaxKind.TrueKeyword, ts.SyntaxKind.FalseKeyword, ts.SyntaxKind.NullKeyword, ts.SyntaxKind.AsyncKeyword, ts.SyntaxKind.ConstKeyword, ts.SyntaxKind.ReadonlyKeyword,
  ts.SyntaxKind.ExpressionStatement, ts.SyntaxKind.VariableStatement, ts.SyntaxKind.VariableDeclarationList, ts.SyntaxKind.VariableDeclaration, ts.SyntaxKind.Block, ts.SyntaxKind.ReturnStatement,
  ts.SyntaxKind.IfStatement, ts.SyntaxKind.ForOfStatement, ts.SyntaxKind.ForStatement, ts.SyntaxKind.ThrowStatement, ts.SyntaxKind.TryStatement, ts.SyntaxKind.CatchClause, ts.SyntaxKind.EmptyStatement,
  ts.SyntaxKind.CallExpression, ts.SyntaxKind.NewExpression, ts.SyntaxKind.PropertyAccessExpression, ts.SyntaxKind.ElementAccessExpression, ts.SyntaxKind.ArrowFunction, ts.SyntaxKind.FunctionExpression, ts.SyntaxKind.FunctionDeclaration,
  ts.SyntaxKind.ObjectLiteralExpression, ts.SyntaxKind.PropertyAssignment, ts.SyntaxKind.ShorthandPropertyAssignment, ts.SyntaxKind.ArrayLiteralExpression, ts.SyntaxKind.SpreadElement,
  ts.SyntaxKind.BinaryExpression, ts.SyntaxKind.PrefixUnaryExpression, ts.SyntaxKind.PostfixUnaryExpression, ts.SyntaxKind.ParenthesizedExpression, ts.SyntaxKind.ConditionalExpression,
  ts.SyntaxKind.AwaitExpression, ts.SyntaxKind.TypeOfExpression, ts.SyntaxKind.AsExpression, ts.SyntaxKind.NonNullExpression,
  ts.SyntaxKind.ArrayBindingPattern, ts.SyntaxKind.ObjectBindingPattern, ts.SyntaxKind.BindingElement, ts.SyntaxKind.Parameter, ts.SyntaxKind.OmittedExpression,
  ts.SyntaxKind.TypeReference, ts.SyntaxKind.ArrayType, ts.SyntaxKind.UnionType, ts.SyntaxKind.LiteralType, ts.SyntaxKind.TypeLiteral, ts.SyntaxKind.PropertySignature, ts.SyntaxKind.TupleType, ts.SyntaxKind.QualifiedName,
  ts.SyntaxKind.AnyKeyword, ts.SyntaxKind.UnknownKeyword, ts.SyntaxKind.NumberKeyword, ts.SyntaxKind.StringKeyword, ts.SyntaxKind.BooleanKeyword, ts.SyntaxKind.VoidKeyword, ts.SyntaxKind.UndefinedKeyword, ts.SyntaxKind.NeverKeyword,
]);
const isPunctuation = (k: ts.SyntaxKind) => k >= ts.SyntaxKind.FirstPunctuation && k <= ts.SyntaxKind.LastPunctuation;
/** Names the test itself declares (variables, parameters, functions, imports, catch bindings, destructuring). */
function testDeclaredNames(sf: ts.SourceFile): Set<string> {
  const out = new Set<string>();
  const addName = (n: ts.BindingName | ts.Identifier | undefined): void => {
    if (!n) return;
    if (ts.isIdentifier(n)) { out.add(n.text); return; }
    for (const e of n.elements) if (!ts.isOmittedExpression(e)) addName(e.name);
  };
  const v = (n: ts.Node): void => {
    if (ts.isVariableDeclaration(n) || ts.isParameter(n) || ts.isBindingElement(n)) addName(n.name);
    if ((ts.isFunctionDeclaration(n) || ts.isFunctionExpression(n)) && n.name) out.add(n.name.text);
    if (ts.isImportClause(n) && n.name) out.add(n.name.text);
    if (ts.isNamespaceImport(n) || ts.isImportSpecifier(n)) out.add(n.name.text);
    if (ts.isCatchClause(n) && n.variableDeclaration) addName(n.variableDeclaration.name);
    ts.forEachChild(n, v);
  };
  v(sf);
  return out;
}
/** Identifier positions that are not references (property names, keys, declarations, type names). */
function isReference(n: ts.Identifier): boolean {
  const p = n.parent;
  if (ts.isPropertyAccessExpression(p) && p.name === n) return false;
  if ((ts.isPropertyAssignment(p) || ts.isPropertySignature(p)) && p.name === n) return false;
  if (ts.isBindingElement(p) && p.propertyName === n) return false;
  if (ts.isImportSpecifier(p) || ts.isImportClause(p) || ts.isNamespaceImport(p)) return false;
  if ((ts.isVariableDeclaration(p) || ts.isParameter(p) || ts.isBindingElement(p) || ts.isFunctionDeclaration(p) || ts.isFunctionExpression(p)) && p.name === n) return false;
  if (ts.isTypeReferenceNode(p) || ts.isQualifiedName(p)) return false;
  return true;
}
/**
 * M23 (Auditor #129): null when a graded test cannot observe the stub other than by calling the function: it imports
 * only node:test, node:assert/strict and the modules in `allowed`; no dynamic import, import.meta, file/env/process
 * access, eval/Function, no `PEACEAI_STUB_BODY` text. Otherwise the reason (fail closed).
 */
export function gradedTestSourceProblem(src: string, allowed: readonly string[], functions?: readonly string[], dataKeys: readonly string[] = []): string | null {
  if (src.includes(STUB_BODY_CODE) || src.includes("__peaceaiStub")) return "names the stub";
  const sf = ts.createSourceFile("t.ts", src, ts.ScriptTarget.Latest, true);
  let problem: string | null = null;
  // Round 2 (Auditor #129): an imported FUNCTION of the module under test may only be CALLED (`f(...)`), never read,
  // stringified (.toString, String(), `${f}`, f + ""), passed along or inspected. `functions` names the module's
  // functions; without it every imported binding is treated as one (stricter).
  const bound = new Set<string>();
  for (const s of sf.statements) {
    if (!ts.isImportDeclaration(s) || !ts.isStringLiteral(s.moduleSpecifier) || !allowed.includes(s.moduleSpecifier.text)) continue;
    const c = s.importClause;
    if (c?.name) bound.add(c.name.text);
    const nb = c?.namedBindings;
    if (nb && ts.isNamespaceImport(nb)) bound.add(nb.name.text);
    if (nb && ts.isNamedImports(nb)) for (const e of nb.elements) if (!functions || functions.includes((e.propertyName ?? e.name).text)) bound.add(e.name.text);
  }
  const declared = testDeclaredNames(sf);
  // Round 4 (Auditor #129 B1): data keys the test itself declares, plus the module's.
  const keys = new Set<string>(dataKeys.filter((k) => !FORBIDDEN_PROPS.has(k)));
  const assertNames = new Set<string>(), runnerNames = new Set<string>();
  // M29 (Auditor follow-up): allowed keys come ONLY from the module under test (`dataKeys`); keys the test
  // declares itself (`const _k = { mock: 0 }`) unlock nothing.
  const contextNames = new Set<string>();
  const collect = (n: ts.Node): void => {
    if (ts.isImportDeclaration(n) && ts.isStringLiteral(n.moduleSpecifier) && n.importClause) {
      const m = n.moduleSpecifier.text, set = m === "node:assert/strict" ? assertNames : m === "node:test" ? runnerNames : null;
      if (set && n.importClause.name) set.add(n.importClause.name.text);
      const nb = n.importClause.namedBindings;
      if (set && nb && ts.isNamedImports(nb)) for (const e of nb.elements) if (m === "node:test" ? ["test", "it", "describe"].includes((e.propertyName ?? e.name).text) : true) set.add(e.name.text);
    }
    ts.forEachChild(n, collect);
  };
  collect(sf);
  // M29: the first parameter of a callback passed to the runner (`test("x", (t) => ...)`) is the test context.
  const ctx = (n: ts.Node): void => {
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && runnerNames.has(n.expression.text))
      for (const a of n.arguments) if ((ts.isArrowFunction(a) || ts.isFunctionExpression(a)) && a.parameters[0]) {
        const pn = a.parameters[0].name;
        if (ts.isIdentifier(pn)) contextNames.add(pn.text); else problem ??= "destructured test context";
      }
    ts.forEachChild(n, ctx);
  };
  ctx(sf);
  for (const k of [...keys]) if (FORBIDDEN_PROPS.has(k)) keys.delete(k);
  const v = (n: ts.Node): void => {
    if (problem) return;
    // Round 3 (Auditor #129): allow-list grammar first (node kinds, free identifiers, Object members).
    if (!ALLOWED_KINDS.has(n.kind) && !isPunctuation(n.kind)) { problem = `syntax ${ts.SyntaxKind[n.kind]}`; return; }
    if (ts.isIdentifier(n) && isReference(n) && !declared.has(n.text) && !ALLOWED_GLOBALS.has(n.text)) { problem = `global ${n.text}`; return; }
    if (ts.isIdentifier(n) && n.text === "Object" && isReference(n) && !declared.has("Object")
      && !(ts.isPropertyAccessExpression(n.parent) && n.parent.expression === n && OBJECT_MEMBERS.has(n.parent.name.text) && ts.isCallExpression(n.parent.parent) && n.parent.parent.expression === n.parent)) { problem = "Object other than Object.keys/fromEntries/freeze calls"; return; }
    if (ts.isImportDeclaration(n)) {
      const m = ts.isStringLiteral(n.moduleSpecifier) ? n.moduleSpecifier.text : "";
      if (!TEST_IMPORTS.has(m) && !allowed.includes(m)) problem = `imports ${m}`;
      return;
    }
    if (ts.isImportEqualsDeclaration(n) || ts.isExportDeclaration(n)) { problem = "import=/export"; return; }
    if (ts.isCallExpression(n) && n.expression.kind === ts.SyntaxKind.ImportKeyword) { problem = "dynamic import"; return; }
    if (ts.isMetaProperty(n)) { problem = "import.meta/new.target"; return; }
    if (ts.isIdentifier(n) && FORBIDDEN_NAMES.has(n.text) && !(ts.isPropertyAccessExpression(n.parent) && n.parent.name === n)) { problem = `uses ${n.text}`; return; }
    if (ts.isElementAccessExpression(n) && !ts.isNumericLiteral(n.argumentExpression)) { problem = "computed member access"; return; }
    // Round 4 (Auditor #129 B1): property-name allow-list.
    if (ts.isPropertyAccessExpression(n) && ts.isIdentifier(n.name)) {
      const p = n.name.text, base = ts.isIdentifier(n.expression) && !declared.has(n.expression.text) ? n.expression.text : null;
      const ok = !FORBIDDEN_PROPS.has(p) && (
        (base !== null && Object.hasOwn(GLOBAL_MEMBERS, base) ? GLOBAL_MEMBERS[base]!.has(p)
          : ts.isIdentifier(n.expression) && assertNames.has(n.expression.text) ? ASSERT_METHODS.has(p)
          : ts.isIdentifier(n.expression) && runnerNames.has(n.expression.text) ? RUNNER_MEMBERS.has(p)
          : ts.isIdentifier(n.expression) && contextNames.has(n.expression.text) ? CONTEXT_MEMBERS.has(p)
          : base !== null && ERROR_CTORS.has(base) ? false
          : keys.has(p) || DATA_METHODS.has(p)));
      if (!ok) { problem = `property ${p} not allow-listed`; return; }
    }
    // M29: assert, the runner and the test context are only called or member-accessed, never aliased or passed.
    if (ts.isIdentifier(n) && isReference(n) && (assertNames.has(n.text) || runnerNames.has(n.text) || contextNames.has(n.text))
      && !(ts.isCallExpression(n.parent) && n.parent.expression === n) && !(ts.isPropertyAccessExpression(n.parent) && n.parent.expression === n)) { problem = `aliases ${n.text}`; return; }
    // Round 4 (Auditor #129 B1): constant-fold string expressions; any that spell a forbidden name is refused.
    if (ts.isBinaryExpression(n) || ts.isTemplateExpression(n) || ts.isParenthesizedExpression(n)) {
      const c = constString(n as ts.Expression);
      if (c !== null && dangerousString(c)) { problem = `string evaluates to ${c}`; return; }
    }
    // Round 4 (Auditor #129 B2): Error/TypeError/RangeError only as `new X(...)`; Buffer only Buffer.from/alloc calls.
    if (ts.isIdentifier(n) && ERROR_CTORS.has(n.text) && isReference(n) && !declared.has(n.text) && !(ts.isNewExpression(n.parent) && n.parent.expression === n)) { problem = `${n.text} other than new ${n.text}(...)`; return; }
    if (ts.isIdentifier(n) && n.text === "Buffer" && isReference(n) && !declared.has("Buffer")
      && !(ts.isPropertyAccessExpression(n.parent) && n.parent.expression === n && GLOBAL_MEMBERS.Buffer!.has(n.parent.name.text) && ts.isCallExpression(n.parent.parent) && n.parent.parent.expression === n.parent)) { problem = "Buffer other than Buffer.from/alloc calls"; return; }
    if ((ts.isIdentifier(n) || ts.isPrivateIdentifier(n) || ts.isStringLiteralLike(n)) && (FORBIDDEN_PROPS.has(n.text) || (ts.isStringLiteralLike(n) && dangerousString(n.text)))) { problem = `names ${n.text}`; return; }
    if (ts.isTemplateSpan(n) && ts.isIdentifier(n.expression) && bound.has(n.expression.text)) { problem = `interpolates ${n.expression.text}`; return; }
    if (ts.isIdentifier(n) && bound.has(n.text) && !ts.isImportSpecifier(n.parent) && !ts.isImportClause(n.parent) && !ts.isNamespaceImport(n.parent)
      && !(ts.isCallExpression(n.parent) && n.parent.expression === n) && !(ts.isPropertyAccessExpression(n.parent) && n.parent.name === n)) { problem = `uses ${n.text} other than calling it`; return; }
    ts.forEachChild(n, v);
  };
  v(sf);
  return problem;
}

/**
 * M23 (Auditor #129): true when a module defines any callable other than top-level `function` declarations
 * (arrow functions, function expressions, classes, object/class methods, accessors) outside those declarations'
 * own bodies. Such a callable could carry the fix's behavior past the stubs, so the caller fails closed.
 */
/** M30 (Auditor, #127): array methods a load-time callback may be the direct argument of. */
const LOAD_TIME_METHODS = new Set(["map", "filter", "reduce", "some", "every", "find", "sort"]);
const PURE_MEMBERS: Readonly<Record<string, ReadonlySet<string>>> = { Math: GLOBAL_MEMBERS.Math!, Number: GLOBAL_MEMBERS.Number! };
const dataOnly = (e: ts.Expression): boolean =>
  ts.isNumericLiteral(e) || ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e) || e.kind === ts.SyntaxKind.TrueKeyword || e.kind === ts.SyntaxKind.FalseKeyword || e.kind === ts.SyntaxKind.NullKeyword
  || (ts.isPrefixUnaryExpression(e) && e.operator === ts.SyntaxKind.MinusToken && ts.isNumericLiteral(e.operand))
  || (ts.isArrayLiteralExpression(e) && e.elements.every((x) => dataOnly(x)))
  || (ts.isObjectLiteralExpression(e) && e.properties.every((x) => ts.isPropertyAssignment(x) && (ts.isIdentifier(x.name) || ts.isStringLiteral(x.name)) && !FORBIDDEN_PROPS.has(x.name.text) && dataOnly(x.initializer)));
/** M30: a pure expression over the callback's own params, literals and Math/Number members (Auditor condition 2). */
function pureExpr(e: ts.Node, params: ReadonlySet<string>): boolean {
  if (ts.isIdentifier(e)) return params.has(e.text);
  if (ts.isNumericLiteral(e) || ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e) || e.kind === ts.SyntaxKind.TrueKeyword || e.kind === ts.SyntaxKind.FalseKeyword || e.kind === ts.SyntaxKind.NullKeyword) return true;
  if (ts.isParenthesizedExpression(e)) return pureExpr(e.expression, params);
  if (ts.isBinaryExpression(e)) return !(e.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && e.operatorToken.kind <= ts.SyntaxKind.LastAssignment) && e.operatorToken.kind !== ts.SyntaxKind.CommaToken && pureExpr(e.left, params) && pureExpr(e.right, params);
  if (ts.isPrefixUnaryExpression(e)) return [ts.SyntaxKind.MinusToken, ts.SyntaxKind.PlusToken, ts.SyntaxKind.ExclamationToken, ts.SyntaxKind.TildeToken].includes(e.operator) && pureExpr(e.operand, params);
  if (ts.isConditionalExpression(e)) return pureExpr(e.condition, params) && pureExpr(e.whenTrue, params) && pureExpr(e.whenFalse, params);
  if (ts.isPropertyAccessExpression(e)) {
    const p = e.name.text;
    if (ts.isIdentifier(e.expression) && Object.hasOwn(PURE_MEMBERS, e.expression.text) && !params.has(e.expression.text)) return PURE_MEMBERS[e.expression.text]!.has(p);
    return !FORBIDDEN_PROPS.has(p) && pureExpr(e.expression, params);
  }
  if (ts.isCallExpression(e)) return ts.isPropertyAccessExpression(e.expression) && ts.isIdentifier(e.expression.expression)
    && Object.hasOwn(PURE_MEMBERS, e.expression.expression.text) && !params.has(e.expression.expression.text) && pureExpr(e.expression, params) && e.arguments.every((a) => pureExpr(a, params));
  return false;
}
/**
 * M30 (Auditor, #127): a function/arrow expression that only runs while the module loads is not a callable the
 * stubs could miss, when ALL hold: (1) it is the direct argument of .map/.filter/.reduce/.some/.every/.find/.sort
 * on an array literal (or a top-level const holding one) inside a top-level const initializer; (2) its body is one
 * expression or simple returns over its own params, literals and Math/Number members only (no module bindings,
 * this/arguments, nested functions, assignment or update); (3) the receiver holds only data; (4) that const is
 * never called anywhere in the module.
 */
export function loadTimeCallback(fn: ts.ArrowFunction | ts.FunctionExpression, sf: ts.SourceFile): boolean {
  const call = fn.parent;
  if (!ts.isCallExpression(call) || !ts.isPropertyAccessExpression(call.expression) || !LOAD_TIME_METHODS.has(call.expression.name.text)) return false;
  // Auditor #139 X1: the callback is the FIRST and only argument; reduce may add one data-only initial value.
  // A second argument (reduce's initial value, a thisArg) could otherwise carry a callable out of the const.
  if (call.arguments[0] !== fn) return false;
  if (call.arguments.length > 1 && !(call.expression.name.text === "reduce" && call.arguments.length === 2 && dataOnly(call.arguments[1]!))) return false;
  // (1) inside a top-level const initializer, with no function boundary between.
  let decl: ts.Node = call;
  while (decl.parent && !ts.isVariableDeclaration(decl)) { decl = decl.parent; if (ts.isFunctionLike(decl) || ts.isClassLike(decl)) return false; }
  if (!ts.isVariableDeclaration(decl) || !ts.isIdentifier(decl.name) || !decl.initializer) return false;
  const list = decl.parent;
  if (!ts.isVariableDeclarationList(list) || !(list.flags & ts.NodeFlags.Const) || !ts.isVariableStatement(list.parent) || list.parent.parent !== sf) return false;
  // (3) the receiver is a data-only array literal, or a top-level const holding one.
  const recv = call.expression.expression;
  let lit: ts.Expression | undefined = recv;
  if (ts.isIdentifier(recv)) {
    lit = undefined;
    for (const st of sf.statements) if (ts.isVariableStatement(st) && st.declarationList.flags & ts.NodeFlags.Const)
      for (const d of st.declarationList.declarations) if (ts.isIdentifier(d.name) && d.name.text === recv.text) lit = d.initializer;
  }
  if (!lit || !ts.isArrayLiteralExpression(lit) || !dataOnly(lit)) return false;
  // (2) simple identifier params; one expression body or a block of return statements only.
  const params = new Set<string>();
  for (const p of fn.parameters) { if (!ts.isIdentifier(p.name) || p.initializer || p.dotDotDotToken) return false; params.add(p.name.text); }
  if (ts.isFunctionExpression(fn) && fn.name) return false;
  const exprs: ts.Node[] = [];
  if (ts.isBlock(fn.body)) { for (const st of fn.body.statements) { if (!ts.isReturnStatement(st) || !st.expression) return false; exprs.push(st.expression); } }
  else exprs.push(fn.body);
  if (!exprs.length || !exprs.every((e) => pureExpr(e, params))) return false;
  // (4) Auditor #139 X1: the const is only ever READ through a property or index access (B[i], B.length) whose
  // result is not called, assigned or updated. Any other use (aliasing `const g = B`, passing it, placing it in
  // a literal `[B][0](x)`, calling it or a member of it) fails closed.
  const name = decl.name.text;
  let bad = false;
  const unwrapUp = (n: ts.Node): ts.Node => { let u = n; while (u.parent && (ts.isParenthesizedExpression(u.parent) || ts.isNonNullExpression(u.parent) || ts.isAsExpression(u.parent) || ts.isTypeAssertionExpression(u.parent) || ts.isSatisfiesExpression(u.parent))) u = u.parent; return u; };
  const v = (n: ts.Node): void => {
    if (bad) return;
    if (ts.isIdentifier(n) && n.text === name && n !== decl.name && !(ts.isPropertyAccessExpression(n.parent) && n.parent.name === n) && !(ts.isPropertyAssignment(n.parent) && n.parent.name === n)) {
      const u = unwrapUp(n), acc = u.parent;
      const isRead = acc && (ts.isPropertyAccessExpression(acc) || ts.isElementAccessExpression(acc)) && acc.expression === u;
      if (!isRead) { bad = true; return; }
      const r = unwrapUp(acc!), use = r.parent;
      if (use && ((ts.isCallExpression(use) || ts.isNewExpression(use)) && use.expression === r || ts.isTaggedTemplateExpression(use) && use.tag === r
        || ts.isBinaryExpression(use) && use.left === r && use.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && use.operatorToken.kind <= ts.SyntaxKind.LastAssignment
        || (ts.isPrefixUnaryExpression(use) || ts.isPostfixUnaryExpression(use)) && (use.operator === ts.SyntaxKind.PlusPlusToken || use.operator === ts.SyntaxKind.MinusMinusToken)
        || ts.isDeleteExpression(use))) { bad = true; return; }
    }
    ts.forEachChild(n, v);
  };
  v(sf);
  return !bad;
}

export function hasNonDeclarationCallables(content: string): boolean {
  const sf = ts.createSourceFile("m.ts", content, ts.ScriptTarget.Latest, true);
  let found = false;
  const v = (n: ts.Node): void => {
    if (found) return;
    if (ts.isFunctionDeclaration(n) && n.parent === sf) return; // its body is stubbed whole
    if ((ts.isArrowFunction(n) || ts.isFunctionExpression(n)) && loadTimeCallback(n, sf)) return; // M30 (Auditor, #127)
    if (ts.isArrowFunction(n) || ts.isFunctionExpression(n) || ts.isClassLike(n) || ts.isMethodDeclaration(n) || ts.isGetAccessor(n) || ts.isSetAccessor(n) || ts.isFunctionDeclaration(n)) { found = true; return; }
    ts.forEachChild(n, v);
  };
  v(sf);
  return found;
}

/**
 * Round 3 (Auditor #129): true when a module imports (or re-exports from) another file by a relative or absolute
 * path. Under the narrowed reads (test file, module, node_modules) such a module cannot load, so the harness
 * records it as ungradable "module-imports-repo-files" instead of running it. Type-only imports are erased.
 */
export function moduleImportsRepoFiles(content: string): boolean {
  const sf = ts.createSourceFile("m.ts", content, ts.ScriptTarget.Latest, true);
  let found = false;
  const v = (n: ts.Node): void => {
    if (found) return;
    if ((ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) && n.moduleSpecifier && ts.isStringLiteral(n.moduleSpecifier) && /^[./]/.test(n.moduleSpecifier.text)) {
      const typeOnly = ts.isImportDeclaration(n) ? !!n.importClause?.isTypeOnly : n.isTypeOnly;
      if (!typeOnly) { found = true; return; }
    }
    if (ts.isCallExpression(n) && n.expression.kind === ts.SyntaxKind.ImportKeyword) { found = true; return; }
    ts.forEachChild(n, v);
  };
  v(sf);
  return found;
}

/**
 * M32 round 2 (Auditor #141, limit 3): the #129 ALLOW-list grammar applied to ONE function body of a module, for
 * MULTI_LINE_BODY. Same node kinds, globals, property-name allow-list (module data keys + data methods + listed
 * global members), constant string folding and forbidden names as graded tests; plus, for a body:
 *  - computed access only with a numeric literal key;
 *  - no `this`/`arguments`, classes, generators, nested `function` declarations/expressions (arrows only);
 *  - a free name must be a local/parameter, an allowed global, or a top-level name of the same module that is not
 *    an import; a same-module function may be called only if ITS body passes this grammar too (recursively);
 *    anything imported may not be referenced at all (its reach cannot be checked here).
 * null = the body is inside the grammar; otherwise the reason (fail closed).
 */
export function bodyGrammarProblem(content: string, fnName: string, seen: Set<string> = new Set(), dataKeys: readonly string[] = moduleDataKeys(content)): string | null {
  const sf = ts.createSourceFile("m.ts", content, ts.ScriptTarget.Latest, true);
  const fns = new Map<string, ts.FunctionDeclaration>();
  const topValues = new Map<string, ts.Expression | undefined>(), imported = new Set<string>();
  for (const s of sf.statements) {
    if (ts.isFunctionDeclaration(s) && s.name && s.body) fns.set(s.name.text, s);
    if (ts.isVariableStatement(s)) for (const d of s.declarationList.declarations) if (ts.isIdentifier(d.name)) topValues.set(d.name.text, d.initializer);
    if (ts.isImportDeclaration(s) && s.importClause && !s.importClause.isTypeOnly) {
      const c = s.importClause;
      if (c.name) imported.add(c.name.text);
      const nb = c.namedBindings;
      if (nb && ts.isNamespaceImport(nb)) imported.add(nb.name.text);
      if (nb && ts.isNamedImports(nb)) for (const e of nb.elements) if (!e.isTypeOnly) imported.add(e.name.text);
    }
  }
  const fn = fns.get(fnName);
  if (!fn || !fn.body) return `no function ${fnName}`;
  if (fn.asteriskToken) return "generator";
  seen.add(fnName);
  // Keys come from the caller (MULTI_LINE_BODY: the file BEFORE the edit), never from the edited body itself.
  const keys = new Set(dataKeys.filter((k) => !FORBIDDEN_PROPS.has(k)));
  const declared = new Set<string>();
  const addName = (n: ts.BindingName): void => { if (ts.isIdentifier(n)) declared.add(n.text); else for (const e of n.elements) if (!ts.isOmittedExpression(e)) addName(e.name); };
  for (const p of fn.parameters) addName(p.name);
  const decl = (n: ts.Node): void => {
    if (ts.isVariableDeclaration(n) || ts.isParameter(n) || ts.isBindingElement(n)) addName(n.name);
    if (ts.isCatchClause(n) && n.variableDeclaration) addName(n.variableDeclaration.name);
    ts.forEachChild(n, decl);
  };
  decl(fn.body);
  let problem: string | null = null;
  const v = (n: ts.Node): void => {
    if (problem) return;
    if (!ALLOWED_KINDS.has(n.kind) && !isPunctuation(n.kind)) { problem = `syntax ${ts.SyntaxKind[n.kind]}`; return; }
    if (ts.isFunctionDeclaration(n) || ts.isFunctionExpression(n)) { problem = "nested function"; return; }
    if (ts.isArrowFunction(n)) for (const p of n.parameters) addName(p.name);
    if (ts.isCallExpression(n) && n.expression.kind === ts.SyntaxKind.ImportKeyword) { problem = "dynamic import"; return; }
    if (ts.isElementAccessExpression(n) && !ts.isNumericLiteral(n.argumentExpression)) { problem = "computed member access"; return; }
    if (ts.isIdentifier(n) && isReference(n)) {
      const t = n.text;
      if (FORBIDDEN_NAMES.has(t) || t === "arguments") { problem = `uses ${t}`; return; }
      if (!declared.has(t)) {
        if (imported.has(t)) { problem = `uses import ${t}`; return; }
        if (fns.has(t)) {
          if (!(ts.isCallExpression(n.parent) && n.parent.expression === n)) { problem = `uses ${t} other than calling it`; return; }
          if (!seen.has(t)) { const inner = bodyGrammarProblem(content, t, seen, dataKeys); if (inner) { problem = `calls ${t}: ${inner}`; return; } }
        } else if (topValues.has(t)) {
          // Auditor #141 F1: a top-level value is usable only when its initializer is plain data (no callable, no
          // import alias, no object holding a function); anything else is refused (fail closed).
          const init = topValues.get(t);
          if (!init || !dataOnly(init)) { problem = `uses top-level ${t} whose initializer is not data`; return; }
        } else if (!ALLOWED_GLOBALS.has(t)) { problem = `global ${t}`; return; }
        if (t === "Object" && !(ts.isPropertyAccessExpression(n.parent) && n.parent.expression === n && OBJECT_MEMBERS.has(n.parent.name.text) && ts.isCallExpression(n.parent.parent) && n.parent.parent.expression === n.parent)) { problem = "Object other than Object.keys/fromEntries/freeze calls"; return; }
        if (ERROR_CTORS.has(t) && !(ts.isNewExpression(n.parent) && n.parent.expression === n)) { problem = `${t} other than new ${t}(...)`; return; }
        if (t === "Buffer" && !(ts.isPropertyAccessExpression(n.parent) && n.parent.expression === n && GLOBAL_MEMBERS.Buffer!.has(n.parent.name.text) && ts.isCallExpression(n.parent.parent) && n.parent.parent.expression === n.parent)) { problem = "Buffer other than Buffer.from/alloc calls"; return; }
      }
    }
    if (ts.isPropertyAccessExpression(n) && ts.isIdentifier(n.name)) {
      const p = n.name.text, base = ts.isIdentifier(n.expression) && !declared.has(n.expression.text) ? n.expression.text : null;
      const ok = !FORBIDDEN_PROPS.has(p) && (base !== null && Object.hasOwn(GLOBAL_MEMBERS, base) ? GLOBAL_MEMBERS[base]!.has(p)
        : base !== null && ERROR_CTORS.has(base) ? false : keys.has(p) || DATA_METHODS.has(p));
      if (!ok) { problem = `property ${p} not allow-listed`; return; }
    }
    if (ts.isBinaryExpression(n) || ts.isTemplateExpression(n) || ts.isParenthesizedExpression(n)) {
      const c = constString(n as ts.Expression);
      if (c !== null && dangerousString(c)) { problem = `string evaluates to ${c}`; return; }
    }
    // A local or parameter may be called `values`/`name`; a forbidden name is refused as a member, key or string.
    if (((ts.isIdentifier(n) && !(isReference(n) && declared.has(n.text)) && !(ts.isVariableDeclaration(n.parent) || ts.isParameter(n.parent) || ts.isBindingElement(n.parent))) || ts.isPrivateIdentifier(n) || ts.isStringLiteralLike(n)) && (FORBIDDEN_PROPS.has(n.text) || (ts.isStringLiteralLike(n) && dangerousString(n.text)))) { problem = `names ${n.text}`; return; }
    ts.forEachChild(n, v);
  };
  v(fn.body);
  return problem;
}
