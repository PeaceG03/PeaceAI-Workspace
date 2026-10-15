// M58 proposal (OFF until approved): METHOD_GUARD, a NEW kind beside ADD_THROW_GUARD v1 and its function-top
// placement (both unchanged). Spec: peaceai/spec/method-guard-v1.md. Not wired into learned.ts RULE_KINDS and not in
// approved.json until Peace /approve-rule; Job A only runs it when admitted. Builder never approves.
// The edit: ONE guard as the FIRST statement of a uniquely named exported function, in the one-line form
// `if (cond) throw new Error("CODE");` or the block form `if (cond) {\n  throw new Error("CODE");\n}` (the file's
// majority style). The condition grammar is v1's (parameters, literals, property reads, comparisons, `!`, `&&`/`||`,
// `typeof`, the pure built-ins) plus method calls on a parameter-rooted receiver (folding in #149):
//   - X.startsWith(a) / X.endsWith(a) / X.includes(a) / X.has(a), one argument that is a literal or a parameter;
//   - X.getTime() / X.trim() with no argument;
//   - /re/.test(X) where /re/ is a regex literal (<= 80 chars, flags i/u only, no backreferences, lookarounds or
//     quantified groups).
// X is a parameter or a property chain rooted at one; never optional chaining, computed access or a call result.
// Note (as v1): a call or property read on a caller-supplied object can run the caller's own code.
import ts from "typescript";
import { exportedFunction, parseGuardTask, type Refusal, unknownNames } from "./learned-guard.ts";
import { buildTestEdit } from "./learned-test.ts";
import { PROTECTED_SELF } from "./selfchange.ts";

const plainPath = (p: string) => !p.startsWith("/") && !p.split("/").some((s) => s === "" || s === "." || s === "..");
const isProtected = (path: string) => PROTECTED_SELF.some((x) => x.pattern.test(path));

export const METHOD_GUARD_FLAG = "PEACEAI_METHOD_GUARD";
export const methodGuardEnabled = (env: Record<string, string | undefined>): boolean => env[METHOD_GUARD_FLAG] === "true";
export const METHOD_GUARD_MAX_COND = 160;
export const METHOD_GUARD_PARAM_KEYS = ["error", "form", "grading", "message", "placement", "test"] as const;
export const METHOD_GUARD_VOCAB: Record<(typeof METHOD_GUARD_PARAM_KEYS)[number], readonly string[]> = {
  error: ["Error"],
  form: ["block", "one-line"],
  grading: ["self-fail-before-pass-after"],
  message: ["code-only"],
  placement: ["function-top"],
  test: ["new-file"],
};
const NAME = String.raw`[A-Za-z_$][\w$]*`;
const FILE = String.raw`[\w./-]+\.ts`;
/** Distinct from ADD_THROW_GUARD / function-top: requires a method call in the condition. */
export const METHOD_GUARD_TRIGGER = String.raw`^guard \x60?(?<fn>${NAME})\x60? in \x60?(?<file>${FILE})\x60? with a method ?: throw \x60?(?<code>[A-Z][A-Z0-9_]{2,63})\x60? (?:when|if) (?<cond>[^\n]{1,${METHOD_GUARD_MAX_COND}}?)\.?$`;

const ONE_ARG = new Set(["startsWith", "endsWith", "includes", "has"]);
const NO_ARG = new Set(["getTime", "trim"]);
const CALLS = new Set(["Number.isFinite", "Number.isInteger", "Number.isNaN", "Number.isSafeInteger", "Array.isArray"]);
const COMPARE = new Set([ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken, ts.SyntaxKind.LessThanToken, ts.SyntaxKind.LessThanEqualsToken, ts.SyntaxKind.GreaterThanToken, ts.SyntaxKind.GreaterThanEqualsToken, ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.BarBarToken]);

/** A regex literal is safe: short, flags i/u only, no backreference, lookaround or quantified group. */
export function safeRegexLiteral(text: string): boolean {
  const m = /^\/(.+)\/([a-z]*)$/s.exec(text);
  if (!m || text.length > 82 || m[1]!.length > 80) return false;
  const [, body, flags] = m as unknown as [string, string, string];
  if (!/^[iu]*$/.test(flags) || new Set(flags).size !== flags.length) return false;
  if (/\\[1-9]|\\k</.test(body)) return false; // backreferences
  if (/\(\?[=!<]/.test(body)) return false; // lookarounds (and named groups, which need `(?<`)
  if (/\)\s*[*+?{]/.test(body)) return false; // quantified group
  try { new RegExp(body, flags); } catch { return false; }
  return true;
}

const rooted = (n: ts.Expression, params: ReadonlySet<string>): boolean => {
  if (ts.isIdentifier(n)) return params.has(n.text);
  if (ts.isPropertyAccessExpression(n)) return !n.questionDotToken && ts.isIdentifier(n.name) && rooted(n.expression, params);
  return false;
};

/** v1's grammar plus the method calls above; at least one parameter read and at least one method call. */
export function methodGuardCondition(e: ts.Expression, params: ReadonlySet<string>): boolean {
  let usesParam = false, method = false;
  const ok = (n: ts.Node): boolean => {
    if (ts.isParenthesizedExpression(n)) return ok(n.expression);
    if (ts.isIdentifier(n)) { if (params.has(n.text)) usesParam = true; return params.has(n.text); }
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isNumericLiteral(n) || n.kind === ts.SyntaxKind.TrueKeyword || n.kind === ts.SyntaxKind.FalseKeyword || n.kind === ts.SyntaxKind.NullKeyword) return true;
    if (ts.isPropertyAccessExpression(n)) return !n.questionDotToken && ts.isIdentifier(n.name) && ok(n.expression);
    if (ts.isPrefixUnaryExpression(n)) return (n.operator === ts.SyntaxKind.ExclamationToken && ok(n.operand)) || (n.operator === ts.SyntaxKind.MinusToken && ts.isNumericLiteral(n.operand));
    if (ts.isTypeOfExpression(n)) return ok(n.expression);
    if (ts.isBinaryExpression(n)) return COMPARE.has(n.operatorToken.kind) && ok(n.left) && ok(n.right);
    if (ts.isCallExpression(n)) {
      if (n.questionDotToken || n.typeArguments) return false;
      const c = n.expression;
      if (ts.isPropertyAccessExpression(c) && !c.questionDotToken && ts.isIdentifier(c.name)) {
        const m = c.name.text;
        if (ONE_ARG.has(m) && n.arguments.length === 1 && rooted(c.expression, params)) {
          const a = n.arguments[0]!;
          if (!(ts.isStringLiteral(a) || ts.isNumericLiteral(a) || ts.isNoSubstitutionTemplateLiteral(a) || (ts.isIdentifier(a) && params.has(a.text)))) return false;
          method = true; return ok(c.expression) && ok(a);
        }
        if (NO_ARG.has(m) && n.arguments.length === 0 && rooted(c.expression, params)) { method = true; return ok(c.expression); }
        if (m === "test" && n.arguments.length === 1 && ts.isRegularExpressionLiteral(c.expression) && safeRegexLiteral(c.expression.text) && rooted(n.arguments[0]!, params)) { method = true; return ok(n.arguments[0]!); }
      }
      return CALLS.has(c.getText()) && n.arguments.length === 1 && ok(n.arguments[0]!);
    }
    return false;
  };
  return ok(e) && usesParam && method;
}

/** A guard statement: `if (cond) throw new X(...)` or `if (cond) { throw new X(...) }`, no else. Returns cond. */
export function guardCondition(s: ts.Statement): ts.Expression | null {
  if (!ts.isIfStatement(s) || s.elseStatement) return null;
  const t = s.thenStatement;
  const th = ts.isThrowStatement(t) ? t : ts.isBlock(t) && t.statements.length === 1 && ts.isThrowStatement(t.statements[0]!) ? (t.statements[0] as ts.ThrowStatement) : null;
  if (!th || !ts.isNewExpression(th.expression) || !ts.isIdentifier(th.expression.expression) || !/Error$/.test(th.expression.expression.text)) return null;
  return s.expression;
}

const parseExpr = (text: string): ts.Expression | null => {
  const sf = ts.createSourceFile("c.ts", `(${text});`, ts.ScriptTarget.Latest, true);
  const st = sf.statements;
  if (st.length !== 1 || !ts.isExpressionStatement(st[0]!) || (sf as unknown as { parseDiagnostics: unknown[] }).parseDiagnostics.length) return null;
  const e = (st[0] as ts.ExpressionStatement).expression;
  return ts.isParenthesizedExpression(e) ? e.expression : null;
};

export type GuardForm = "one-line" | "block";
/** Inserts the guard as the function's first statement. null = refused. */
export function buildMethodGuardEdit(path: string, content: string, fnName: string, condText: string, code: string, form: GuardForm): string | null {
  if (!plainPath(path) || !/\.(ts|mts)$/.test(path) || path.endsWith(".d.ts") || /\.test\.ts$/.test(path)) return null;
  if (isProtected(path)) return null;
  if (condText.length > METHOD_GUARD_MAX_COND || !/^[A-Z][A-Z0-9_]{2,63}$/.test(code)) return null;
  if (form !== "one-line" && form !== "block") return null;
  const sf = ts.createSourceFile(path, content, ts.ScriptTarget.Latest, true);
  const fn = exportedFunction(sf, fnName);
  if (!fn) return null;
  const names = new Set<string>();
  for (const p of fn.params) { if (!ts.isIdentifier(p.name)) return null; names.add(p.name.text); }
  const cond = parseExpr(condText);
  if (!cond || !methodGuardCondition(cond, names)) return null;
  if (new RegExp(`["'\`]${code}\\b`).test(content)) return null;
  const sq = (content.match(/new Error\('/g) ?? []).length, dq = (content.match(/new Error\("/g) ?? []).length;
  const q = sq > dq ? "'" : '"';
  const stmts = fn.body.statements;
  const open = fn.body.getStart(sf);
  const lineStart = content.lastIndexOf("\n", open) + 1;
  const outer = /^[ \t]*/.exec(content.slice(lineStart))![0];
  const ind = stmts.length ? /[ \t]*$/.exec(content.slice(0, stmts[0]!.getStart(sf)))![0] : `${outer}  `;
  const unit = ind.length > outer.length ? ind.slice(outer.length) : "  ";
  const th = `throw new Error(${q}${code}${q});`;
  const guard = form === "one-line" ? `if (${cond.getText()}) ${th}` : `if (${cond.getText()}) {\n${ind}${unit}${th}\n${ind}}`;
  let out: string;
  if (stmts.length) { const at = stmts[0]!.getStart(sf); out = content.slice(0, at) + guard + `\n${ind}` + content.slice(at); }
  else { const close = fn.body.getEnd() - 1; out = content.slice(0, open + 1) + `\n${ind}${guard}\n${outer}` + content.slice(close); }
  const post = ts.createSourceFile(path, out, ts.ScriptTarget.Latest, true);
  if ((post as unknown as { parseDiagnostics: unknown[] }).parseDiagnostics.length) return null;
  const f2 = exportedFunction(post, fnName);
  if (!f2 || !f2.body.statements.length || !guardCondition(f2.body.statements[0]!)) return null;
  return out;
}

/** Job A entry: parse the method-guard header, build the first-statement edit + self-graded test. */
export function applyMethodGuardRule(
  trigger: string,
  params: Record<string, string | string[]>,
  objective: string,
  files: readonly { path: string; content: string }[],
  isTest?: (p: string) => boolean,
  why?: Refusal,
): { path: string; content: string; extra: { path: string; content: string; create: true }[]; selfGrade: true } | null {
  const no = (r: string) => { if (why) why.reason = r; return null; };
  for (const k of METHOD_GUARD_PARAM_KEYS) if (typeof params[k] !== "string" || !METHOD_GUARD_VOCAB[k].includes(params[k] as string)) return no("bad_rule_params");
  const task = parseGuardTask(trigger, objective);
  if (!task) return null;
  if (task.cond.length > METHOD_GUARD_MAX_COND) return no("condition_too_long");
  const target = files.find((f) => f.path === task.file);
  if (!target || (isTest ?? ((p) => /\.test\.ts$/.test(p)))(target.path)) return no("target_file_not_found");
  const sf = ts.createSourceFile(target.path, target.content, ts.ScriptTarget.Latest, true);
  const fn = exportedFunction(sf, task.fn);
  if (!fn) return no("function_not_found");
  const names = new Set<string>();
  for (const p of fn.params) { if (!ts.isIdentifier(p.name)) return no("destructured_parameter"); names.add(p.name.text); }
  const cond = parseExpr(task.cond);
  if (!cond) return no("condition_unparsable");
  if (!methodGuardCondition(cond, names)) {
    const unknown = unknownNames(cond, names);
    return no(unknown.length ? `unsafe_condition: ${unknown.join(",")}` : "unsafe_condition");
  }
  const form = params.form as GuardForm;
  const edited = buildMethodGuardEdit(target.path, target.content, task.fn, task.cond, task.code, form);
  if (!edited) return no("edit_refused");
  const testParams = { assert: "node:assert/strict-default", checks: ["equal", "deepEqual", "throws"], framework: "node:test-default", grading: "fail-before-pass-after", matcher: "regex", maxLines: "12", placement: "new-file" };
  const test = buildTestEdit(testParams, task.test, files, isTest);
  if (!test) return no("test_refused");
  return { path: target.path, content: edited, extra: [{ path: test.path, content: test.content, create: true }], selfGrade: true };
}
