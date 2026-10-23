// M13: the ADD_THROW_GUARD learned rule. A spec of this kind carries the style mined from Builder's own
// `if (cond) throw new Error("CODE")` guards in public repositories (peaceai/lib/mine.ts, shape THROW_GUARD):
// brace style, error form, message form and placement. The edit is fixed here: one guard line at the entry
// of a uniquely named exported function (after any guards already there), plus ONE new test file that calls
// the function so the guard trips. The condition may use only the function's own parameters, literals,
// property reads, comparisons, `!`, `&&`/`||`, `typeof` and a few pure built-ins; nothing else. Job B grades
// the candidate itself: its new test must pass with the guard and fail with the guard's source edit taken
// back out (bin/test-candidates.ts, `selfGrade`), otherwise it is rejected. Deterministic; no model.
import { createHash } from "node:crypto";
import ts from "typescript";
import { buildTestEdit, parseTestTask, type TestTask } from "./learned-test.ts";

export const GUARD_PARAM_KEYS = ["braces", "error", "grading", "lines", "message", "placement", "test"] as const;
export const GUARD_VOCAB: Record<(typeof GUARD_PARAM_KEYS)[number], readonly string[]> = {
  braces: ["none"],
  error: ["Error"],
  grading: ["self-fail-before-pass-after"],
  lines: ["one"],
  message: ["code-only"],
  placement: ["function-entry", "function-top"], // M47 proposal: function-top = first statement, ahead of any early return
  test: ["new-file"],
};
export const MAX_COND_CHARS = 160;
const NAME = String.raw`[A-Za-z_$][\w$]*`;
const FILE = String.raw`[\w./-]+\.ts`;
/** Header line (the rule's trigger). Backticks are optional: the cleaned issue text turns them into spaces. */
export const GUARD_TRIGGER = String.raw`^guard \x60?(?<fn>${NAME})\x60? in \x60?(?<file>${FILE})\x60? ?: throw \x60?(?<code>[A-Z][A-Z0-9_]{2,63})\x60? (?:when|if) (?<cond>[^\n]{1,${MAX_COND_CHARS}}?)\.?$`;

/** M47: the function-top rule's own header (distinct phrase, so a task never matches both placements). */
export const GUARD_TOP_TRIGGER = String.raw`^guard \x60?(?<fn>${NAME})\x60? in \x60?(?<file>${FILE})\x60? at the top ?: throw \x60?(?<code>[A-Z][A-Z0-9_]{2,63})\x60? (?:when|if) (?<cond>[^\n]{1,${MAX_COND_CHARS}}?)\.?$`;

export interface GuardTask { fn: string; file: string; code: string; cond: string; test: TestTask }
export interface GuardEdit { path: string; content: string; extra: { path: string; content: string; create: true }[]; selfGrade: true }

const strip = (s: string) => s.replace(/\x60/g, " ").trim();
/** Built-ins a condition may call: pure, one argument. */
const CALLS = new Set(["Number.isFinite", "Number.isInteger", "Number.isNaN", "Number.isSafeInteger", "Array.isArray"]);
const COMPARE = new Set([ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken, ts.SyntaxKind.LessThanToken, ts.SyntaxKind.LessThanEqualsToken, ts.SyntaxKind.GreaterThanToken, ts.SyntaxKind.GreaterThanEqualsToken, ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.BarBarToken]);

/** Reads the header, then the test bullets (at least one `- CALL throws CODE` with the same code). Null when anything is off. */
export function parseGuardTask(trigger: string, objective: string): GuardTask | null {
  const lines = objective.split("\n").map((l) => l.trim()).filter(Boolean);
  const heads = lines.filter((l) => new RegExp(trigger, "i").test(l));
  if (heads.length !== 1) return null;
  const g = new RegExp(trigger, "i").exec(heads[0]!)!.groups ?? {};
  if (!g.fn || !g.file || !g.code || !g.cond) return null;
  const cond = strip(g.cond);
  const pseudo = createHash("sha256").update(`${g.file}\0${g.fn}\0${g.code}\0${cond}`).digest("hex").slice(0, 40);
  // The test bullets reuse the M12 grammar; the "fix" is this candidate itself (a stable id names the file).
  const testText = [`add a test for ${g.fn} in ${g.file}: ${g.fn} throws ${g.code}`, ...lines.filter((l) => /^[-*] /.test(l)), `Fix: ${pseudo}`].join("\n");
  const test = parseTestTask(String.raw`^add (?:a )?test for (?<symbol>${NAME}) in (?<file>${FILE})(?: ?: (?<title>[^\n]{1,120}?))?$`, testText);
  if (!test || test.symbol !== g.fn || test.file !== g.file) return null;
  const trips = test.checks.filter((c) => c.kind === "throws" && c.code === g.code);
  if (trips.length === 0 || test.checks.some((c) => c.kind === "throws" && c.code !== g.code) || test.checks.some((c) => c.kind === "rejects")) return null;
  return { fn: g.fn, file: g.file, code: g.code, cond, test };
}

const parseExpr = (text: string): ts.Expression | null => {
  const sf = ts.createSourceFile("c.ts", `(${text});`, ts.ScriptTarget.Latest, true);
  const st = sf.statements;
  if (st.length !== 1 || !ts.isExpressionStatement(st[0]!) || (sf as unknown as { parseDiagnostics: unknown[] }).parseDiagnostics.length) return null;
  const e = (st[0] as ts.ExpressionStatement).expression;
  return ts.isParenthesizedExpression(e) ? e.expression : null;
};

/**
 * True when every node of the condition is allowed, every free name is one of `params`, and at least one
 * parameter is read (a constant condition such as `true` or `1 < 2` is refused). Note: property reads and
 * comparisons on a parameter can still run a getter or `valueOf` defined by the caller's object.
 */
export function safeCondition(e: ts.Expression, params: ReadonlySet<string>): boolean {
  let usesParam = false;
  const ok = (n: ts.Node): boolean => {
    if (ts.isParenthesizedExpression(n)) return ok(n.expression);
    if (ts.isIdentifier(n)) { if (params.has(n.text)) usesParam = true; return params.has(n.text); }
    if (ts.isStringLiteral(n) || ts.isNumericLiteral(n) || n.kind === ts.SyntaxKind.TrueKeyword || n.kind === ts.SyntaxKind.FalseKeyword || n.kind === ts.SyntaxKind.NullKeyword) return true;
    if (ts.isPropertyAccessExpression(n)) return !n.questionDotToken && ts.isIdentifier(n.name) && ok(n.expression);
    if (ts.isPrefixUnaryExpression(n)) return (n.operator === ts.SyntaxKind.ExclamationToken && ok(n.operand)) || (n.operator === ts.SyntaxKind.MinusToken && ts.isNumericLiteral(n.operand));
    if (ts.isTypeOfExpression(n)) return ok(n.expression);
    if (ts.isBinaryExpression(n)) return COMPARE.has(n.operatorToken.kind) && ok(n.left) && ok(n.right);
    if (ts.isCallExpression(n)) return !n.questionDotToken && !n.typeArguments && CALLS.has(n.expression.getText()) && n.arguments.length === 1 && ok(n.arguments[0]!);
    return false;
  };
  return ok(e) && usesParam;
}

const exported = (n: ts.Node) => ts.canHaveModifiers(n) && (ts.getModifiers(n) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
type Fn = { body: ts.Block; params: ts.NodeArray<ts.ParameterDeclaration> };
/** The single exported, non-generator function (declaration or `export const f = (..) => { .. }`) named `name`. */
export function exportedFunction(sf: ts.SourceFile, name: string): Fn | null {
  const hits: Fn[] = [];
  for (const s of sf.statements) {
    if (ts.isFunctionDeclaration(s) && s.name?.text === name && s.body && !s.asteriskToken && exported(s)) hits.push({ body: s.body, params: s.parameters });
    if (ts.isVariableStatement(s) && exported(s) && s.declarationList.flags & ts.NodeFlags.Const)
      for (const d of s.declarationList.declarations)
        if (ts.isIdentifier(d.name) && d.name.text === name && d.initializer && (ts.isArrowFunction(d.initializer) || ts.isFunctionExpression(d.initializer)) && ts.isBlock(d.initializer.body) && !(d.initializer as ts.FunctionExpression).asteriskToken)
          hits.push({ body: d.initializer.body, params: d.initializer.parameters });
  }
  // Overloads share a name; only a single implementation is accepted.
  return hits.length === 1 ? hits[0]! : null;
}
const isExitGuard = (s: ts.Statement) => ts.isIfStatement(s) && !s.elseStatement && (ts.isThrowStatement(s.thenStatement) || ts.isReturnStatement(s.thenStatement) || (ts.isBlock(s.thenStatement) && s.thenStatement.statements.length === 1 && (ts.isThrowStatement(s.thenStatement.statements[0]!) || ts.isReturnStatement(s.thenStatement.statements[0]!))));

/** Builds the guard edit and its new test. Refuses (null) on anything outside the learned, fixed shape. */
export function buildGuardEdit(
  params: Record<string, string | string[]>,
  task: GuardTask,
  files: readonly { path: string; content: string }[],
  isTest: (p: string) => boolean = (p) => /\.test\.ts$/.test(p),
  why?: Refusal,
): GuardEdit | null {
  const no = (reason: string): null => { if (why) why.reason = reason; return null; };
  for (const k of GUARD_PARAM_KEYS) if (typeof params[k] !== "string" || !GUARD_VOCAB[k].includes(params[k] as string)) return no("bad_rule_params");
  if (task.cond.length > MAX_COND_CHARS) return no("condition_too_long");
  const target = files.find((f) => f.path === task.file);
  if (!target || isTest(target.path)) return no("target_file_not_found");
  const sf = ts.createSourceFile(target.path, target.content, ts.ScriptTarget.Latest, true);
  const fn = exportedFunction(sf, task.fn);
  if (!fn) return no("function_not_found");
  const names = new Set<string>();
  for (const p of fn.params) { if (!ts.isIdentifier(p.name)) return no("destructured_parameter"); names.add(p.name.text); }
  const cond = parseExpr(task.cond);
  if (!cond) return no("condition_unparsable");
  if (!safeCondition(cond, names)) { const unknown = unknownNames(cond, names); return no(unknown.length ? `unsafe_condition: ${unknown.join(",")}` : "unsafe_condition"); }
  // Quote style of the file's existing Error messages (majority), else double quotes.
  const dq = (target.content.match(/new Error\("/g) ?? []).length;
  const sq = (target.content.match(/new Error\('/g) ?? []).length;
  const q = sq > dq ? "'" : '"';
  const guard = `if (${cond.getText()}) throw new Error(${q}${task.code}${q});`;
  const flat = (s: string) => s.replace(/\s+/g, " ").replace(/'/g, '"');
  if (fn.body.statements.some((s) => flat(s.getText(sf)) === flat(guard))) return no("guard_already_present");
  if (new RegExp(`["'\`]${task.code}\\b`).test(target.content)) return no("error_code_already_in_file"); // the code already exists in this file: not a new guard
  const stmts = fn.body.statements;
  let i = 0;
  // M47 (proposal, off until approved): "function-top" puts the guard first, ahead of leading early returns.
  if (params.placement !== "function-top") while (i < stmts.length && isExitGuard(stmts[i]!)) i++;
  const lineIndent = (pos: number) => /[ \t]*$/.exec(target.content.slice(0, pos))![0];
  let content: string;
  if (stmts.length === 0) {
    const close = fn.body.getEnd() - 1;
    const outer = lineIndent(fn.body.getStart(sf)).length ? lineIndent(fn.body.getStart(sf)) : /^[ \t]*/.exec(target.content.slice(target.content.lastIndexOf("\n", fn.body.getStart(sf)) + 1))![0];
    content = target.content.slice(0, fn.body.getStart(sf) + 1) + `\n${outer}  ${guard}\n${outer}` + target.content.slice(close);
  } else if (i < stmts.length) {
    const at = stmts[i]!.getStart(sf);
    content = target.content.slice(0, at) + `${guard}\n${lineIndent(at)}` + target.content.slice(at);
  } else {
    const last = stmts[stmts.length - 1]!;
    content = target.content.slice(0, last.getEnd()) + `\n${lineIndent(last.getStart(sf))}${guard}` + target.content.slice(last.getEnd());
  }
  // The guarded file must still parse.
  const post = ts.createSourceFile(target.path, content, ts.ScriptTarget.Latest, true);
  if ((post as unknown as { parseDiagnostics: unknown[] }).parseDiagnostics.length) return no("edit_does_not_parse");
  const testParams = { assert: "node:assert/strict-default", checks: ["equal", "deepEqual", "throws"], framework: "node:test-default", grading: "fail-before-pass-after", matcher: "regex", maxLines: "12", placement: "new-file" };
  const test = buildTestEdit(testParams, task.test, files, isTest);
  if (!test) return no("test_refused");
  return { path: target.path, content, extra: [{ path: test.path, content: test.content, create: true }], selfGrade: true };
}

/**
 * M59: why a matching rule refused. Set only once the task matched the rule's trigger (a rule that does not
 * match leaves it unset). The reason is a fixed code, plus for `unsafe_condition` the free names in the
 * condition that are not parameters (identifiers only, never file contents).
 */
/** `questions` (M99 round 3, DERIVE_FROM_BEHAVIOR only): the refusal's questions, as formatDeriveQuestions writes them. */
export type Refusal = { reason?: string; questions?: string };
const IDENT = /^[A-Za-z_$][\w$]{0,63}$/;
/** Free identifiers in `e` that are not one of `params` (property names and the allowed call names excluded), max 5, sorted. */
export function unknownNames(e: ts.Expression, params: ReadonlySet<string>): string[] {
  const out = new Set<string>();
  const walk = (n: ts.Node): void => {
    if (ts.isPropertyAccessExpression(n)) { if (!CALLS.has(n.getText())) walk(n.expression); return; }
    if (ts.isCallExpression(n) && CALLS.has(n.expression.getText())) { n.arguments.forEach(walk); return; }
    if (ts.isIdentifier(n)) { if (!params.has(n.text) && !CALLS.has(n.text) && IDENT.test(n.text)) out.add(n.text); return; }
    ts.forEachChild(n, walk);
  };
  walk(e);
  return [...out].sort().slice(0, 5);
}

export function applyGuardRule(trigger: string, params: Record<string, string | string[]>, objective: string, files: readonly { path: string; content: string }[], isTest?: (p: string) => boolean, why?: Refusal): GuardEdit | null {
  const no = (reason: string): null => { if (why) why.reason = reason; return null; };
  const task = parseGuardTask(trigger, objective);
  if (!task) return no("task_unparsed");
  return buildGuardEdit(params, task, files, isTest, why);
}
