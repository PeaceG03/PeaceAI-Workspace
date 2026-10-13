// M15: the ADD_FUNCTION learned rule. A spec of this kind carries the style mined from Builder's own new exported
// pure functions in public repositories (peaceai/lib/mine.ts, shape PURE_FUNCTION): a top-level
// `export function name(typed params): Type { return EXPR; }`. The edit is fixed here: ONE such function appended
// at the end of an existing source module, plus ONE new test file from the task's bullets. Parameters and the
// return type come from a small type vocabulary; EXPR may use only the new function's parameters, literals and a
// fixed set of pure operators, built-ins and string/array methods (no other names, no calls to the module's code,
// no closures, no assignment). Job B grades the candidate against itself (`selfGrade`): its new test must pass with
// the function and fail with the module put back to the task base. Deterministic; no model.
import { createHash } from "node:crypto";
import ts from "typescript";
import { buildTestEdit, parseTestTask, type TestTask } from "./learned-test.ts";

export const FUNCTION_PARAM_KEYS = ["body", "grading", "params", "placement", "returns", "test"] as const;
export const FUNCTION_VOCAB: Record<(typeof FUNCTION_PARAM_KEYS)[number], readonly string[]> = {
  body: ["single-return"],
  grading: ["self-fail-before-pass-after"],
  params: ["typed"],
  placement: ["end-of-module"],
  returns: ["annotated"],
  test: ["new-file"],
};
export const MAX_EXPR_CHARS = 200;
export const MAX_PARAMS = 4;
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
export interface FunctionEdit { path: string; content: string; extra: { path: string; content: string; create: true }[]; selfGrade: true }

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
const METHODS = new Set(["slice", "padStart", "padEnd", "includes", "startsWith", "endsWith", "trim", "trimStart", "trimEnd", "toUpperCase", "toLowerCase", "indexOf", "lastIndexOf", "at", "join", "concat", "split", "repeat", "toFixed"]);
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
export function safeBody(e: ts.Expression, params: ReadonlySet<string>): boolean {
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
      if (n.questionDotToken || n.typeArguments || n.arguments.length > 4 || !n.arguments.every((a) => !ts.isSpreadElement(a) && ok(a))) return false;
      const callee = n.expression;
      if (ts.isPropertyAccessExpression(callee) && !callee.questionDotToken && ts.isIdentifier(callee.name) && METHODS.has(callee.name.text) && !CALLS.has(callee.getText())) return ok(callee.expression);
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
  if (!target || isTest(target.path) || !/\.ts$/.test(target.path) || /\.d\.ts$/.test(target.path)) return null;
  const sf = ts.createSourceFile(target.path, target.content, ts.ScriptTarget.Latest, true);
  if ((sf as unknown as { parseDiagnostics: unknown[] }).parseDiagnostics.length) return null;
  // A new function only: the name must not already be declared, imported or exported anywhere in the module.
  if (declaredNames(sf).has(task.fn) || new RegExp(String.raw`\b${task.fn.replace(/\$/g, "\\$")}\b`).test(target.content)) return null;
  const names = new Set(task.params.map((p) => p.name));
  if (names.has(task.fn)) return null;
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
  if (!test) return null;
  return { path: target.path, content, extra: [{ path: test.path, content: test.content, create: true }], selfGrade: true };
}

export function applyFunctionRule(trigger: string, params: Record<string, string | string[]>, objective: string, files: readonly { path: string; content: string }[], isTest?: (p: string) => boolean): FunctionEdit | null {
  const task = parseFunctionTask(trigger, objective);
  return task ? buildFunctionEdit(params, task, files, isTest) : null;
}
