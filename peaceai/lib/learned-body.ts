// M27 (bulk teaching, family `modify-body`): a learned rule for one small bounded edit INSIDE an existing
// function, mined from Peace's own public commits (peaceai/lib/minebody.ts, shape EXPR_REPLACE). GUARD_MID is
// mined too but is below the evidence bar (8 examples), so it has no rule.
// - REPLACE_EXPRESSION: replace ONE `if (...)` condition or ONE `return ...;` expression of a uniquely named
//   exported function with a new expression. The old text must match exactly one site (whitespace-insensitive)
//   in the function's own body (never inside a nested function). The new expression may use only names the old
//   one used, the function's parameters and its own const/let locals declared before the site, literals and pure
//   operators. Calls only to a few pure built-ins or to a callee the OLD expression already calls at that site
//   (no new capability). No assignment, `new`, closures, element access or spread. It must differ from the old one.
// It writes ONE new test file from the task's bullets (ADD_TEST_CASE grammar). Job B grades the candidate
// against itself (selfGrade): the new test must PASS with the edit and FAIL with the source put back to the
// task base. No M7 repair. Issue cleaning strips `>`, so use `<`/`<=`. Deterministic; no model.
import { createHash } from "node:crypto";
import ts from "typescript";
import { buildTestEdit, parseTestTask, type TestTask } from "./learned-test.ts";
import { exportedFunction } from "./learned-guard.ts";
import { PROTECTED_SELF } from "./selfchange.ts";

export const BODY_PARAM_KEYS = ["calls", "grading", "match", "names", "paths", "sites", "test"] as const;
export const BODY_VOCAB = {
  // Auditor (#136, 6): a callee the OLD expression calls may be called again WITH NEW ARGUMENTS (checked as reads).
  calls: ["pure-builtins-and-old-callees-any-args"],
  grading: ["self-fail-before-pass-after"],
  match: ["unique-site"],
  names: ["old-names-params-and-enclosing-locals"],
  // Auditor (#136, 3; round 2, 2): only the EDITABLE_PATHS allow-list (never protected, never scanner-chain code).
  paths: ["allow-listed-leaf-modules"],
  sites: ["if-condition", "return-expression"],
  test: ["new-file"],
} as const;
export const MAX_EXPR_CHARS = 160;
const NAME = String.raw`[A-Za-z_$][\w$]*`;
const FILE = String.raw`[\w./-]+\.ts`;
const EXPR = String.raw`[^\n]{1,${MAX_EXPR_CHARS}}?`;
export const REPLACE_TRIGGER = String.raw`^in \x60?(?<fn>${NAME})\x60? in \x60?(?<file>${FILE})\x60? ?: replace (?<site>condition|return) \x60?(?<old>${EXPR})\x60? with \x60?(?<new>${EXPR})\x60?\.?$`;

export interface BodyEdit { path: string; content: string; extra: { path: string; content: string; create: true }[]; selfGrade: true }
const strip = (s: string) => s.replace(/\x60/g, " ").trim();
/**
 * Auditor (#136, 5): token-by-token comparison (kind + exact text; comments and whitespace ignored, quotes and
 * escapes kept), for the site match and the "unchanged" check. No whitespace/quote collapsing.
 */
export function tokens(text: string): string[] {
  const sc = ts.createScanner(ts.ScriptTarget.Latest, true, ts.LanguageVariant.Standard, text);
  const out: string[] = [];
  for (let k = sc.scan(); k !== ts.SyntaxKind.EndOfFileToken; k = sc.scan()) out.push(`${k}:${sc.getTokenText()}`);
  return out;
}
const sameTokens = (a: string, b: string) => { const x = tokens(a), y = tokens(b); return x.length === y.length && x.every((t, i) => t === y[i]); };
/**
 * Round 2 (Auditor #136, 2): an ALLOW-list of the only files this rule may edit, not a deny-list of prefixes.
 * Each is a leaf, side-effect-free module (no node:/process/fetch use, no import of scanner-chain code), checked
 * by hand at the time of listing. Any other path, including every new file and all PeaceSTOCKS scanner-chain
 * code, is refused. Adding a path is a change to this protected file (own PR, Auditor review).
 */
export const EDITABLE_PATHS: Readonly<Record<string, readonly string[]>> = {
  // Round 3 (Auditor #136): keyed per repository, so a path is editable only in the repo it was checked in.
  "PeaceG03/PeaceAI-Workspace": ["src/config.ts", "src/numbers.ts", "src/presets.ts", "src/status.ts"],
  "PeaceG03/PeaceSTOCKS": [ // as of 58fdb6c
    "src/contracts.ts", "src/corporate-action-coverage.ts", "src/et-time.ts", "src/features.ts", "src/num-utils.ts",
    "src/ranking.ts", "src/recipes.ts", "src/reply-dust-dictionary.ts",
  ],
};
/** True only when `repo` is listed and `path` is on that repo's list (unknown or missing repo: false). */
export const editablePath = (repo: string | undefined, path: string): boolean =>
  !!repo && Object.hasOwn(EDITABLE_PATHS, repo) && EDITABLE_PATHS[repo]!.includes(path);
const CALLS = new Set(["Number.isFinite", "Number.isInteger", "Number.isNaN", "Number.isSafeInteger", "Array.isArray", "Math.min", "Math.max", "Math.abs", "Math.floor", "Math.ceil", "Math.round"]);
const BIN = new Set([ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken, ts.SyntaxKind.LessThanToken, ts.SyntaxKind.LessThanEqualsToken, ts.SyntaxKind.GreaterThanToken, ts.SyntaxKind.GreaterThanEqualsToken, ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken, ts.SyntaxKind.PlusToken, ts.SyntaxKind.MinusToken]);

export function parseExpr(text: string): ts.Expression | null {
  const sf = ts.createSourceFile("c.ts", `(${text});`, ts.ScriptTarget.Latest, true);
  const st = sf.statements;
  if (st.length !== 1 || !ts.isExpressionStatement(st[0]!) || (sf as unknown as { parseDiagnostics: unknown[] }).parseDiagnostics.length) return null;
  const e = (st[0] as ts.ExpressionStatement).expression;
  return ts.isParenthesizedExpression(e) ? e.expression : null;
}

/** Free identifiers read by an expression (property names excluded). */
export function freeNames(e: ts.Node): Set<string> {
  const out = new Set<string>();
  const v = (n: ts.Node): void => {
    if (ts.isPropertyAccessExpression(n)) { v(n.expression); return; }
    if (ts.isIdentifier(n)) out.add(n.text);
    ts.forEachChild(n, v);
  };
  v(e);
  return out;
}

/** Pure, bounded expression over `names`: literals, property reads, comparisons, + -, !, &&/||/??, ?:, typeof, a few built-ins. */
/** Callee texts an expression calls (e.g. `isOpen`, `s.includes`): a new expression may call these again (same site, no new capability). */
export function calleesOf(e: ts.Node): Set<string> {
  const out = new Set<string>();
  const v = (n: ts.Node): void => { if (ts.isCallExpression(n) && !n.questionDotToken) out.add(n.expression.getText().replace(/\s+/g, "")); ts.forEachChild(n, v); };
  v(e);
  return out;
}

export function safeExpression(e: ts.Expression, names: ReadonlySet<string>, callees: ReadonlySet<string> = new Set()): boolean {
  const ok = (n: ts.Node): boolean => {
    if (ts.isParenthesizedExpression(n)) return ok(n.expression);
    // Auditor (#136, 4): an identifier must be written plainly (no unicode escapes).
    if (ts.isIdentifier(n)) return names.has(n.text) && n.getText() === n.text;
    if (ts.isStringLiteral(n) || ts.isNumericLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) || [ts.SyntaxKind.TrueKeyword, ts.SyntaxKind.FalseKeyword, ts.SyntaxKind.NullKeyword].includes(n.kind)) return true;
    // Auditor (#136, 4): no optional chaining, no constructor/__proto__/prototype, plain names only.
    if (ts.isPropertyAccessExpression(n)) return !n.questionDotToken && ts.isIdentifier(n.name) && n.name.getText() === n.name.text && !["constructor", "__proto__", "prototype"].includes(n.name.text) && ok(n.expression);
    if (ts.isPrefixUnaryExpression(n)) return (n.operator === ts.SyntaxKind.ExclamationToken || n.operator === ts.SyntaxKind.MinusToken) && ok(n.operand);
    if (ts.isTypeOfExpression(n)) return ok(n.expression);
    if (ts.isBinaryExpression(n)) return BIN.has(n.operatorToken.kind) && ok(n.left) && ok(n.right);
    if (ts.isConditionalExpression(n)) return ok(n.condition) && ok(n.whenTrue) && ok(n.whenFalse);
    if (ts.isCallExpression(n)) {
      const c = n.expression.getText().replace(/\s+/g, "");
      if (n.questionDotToken || n.typeArguments || n.arguments.length > 3 || n.arguments.some((a) => ts.isSpreadElement(a) || !ok(a))) return false;
      if (CALLS.has(c)) return n.arguments.length >= 1;
      // A callee the OLD expression already calls (its receiver names are checked as reads, too).
      return callees.has(c) && (ts.isIdentifier(n.expression) || (ts.isPropertyAccessExpression(n.expression) && ok(n.expression.expression)));
    }
    return false;
  };
  return ok(e);
}

function testFor(fn: string, file: string, key: string, objective: string): TestTask | null {
  const lines = objective.split("\n").map((l) => l.trim()).filter(Boolean);
  const pseudo = createHash("sha256").update(key).digest("hex").slice(0, 40);
  const text = [`add a test for ${fn} in ${file}: ${fn} behaves as asked`, ...lines.filter((l) => /^[-*] /.test(l)), `Fix: ${pseudo}`].join("\n");
  const t = parseTestTask(String.raw`^add (?:a )?test for (?<symbol>${NAME}) in (?<file>${FILE})(?: ?: (?<title>[^\n]{1,120}?))?$`, text);
  // Auditor (#136, 2): at least one equal/deepEqual check, so the before-run must fail on a VALUE of the edited
  // function (a throws check alone could pass on a crash such as a null read).
  return t && t.symbol === fn && t.file === file && t.checks.some((c) => c.kind === "equal" || c.kind === "deepEqual") && !t.checks.some((c) => c.kind === "rejects") ? t : null;
}
const TEST_PARAMS = { assert: "node:assert/strict-default", checks: ["equal", "deepEqual", "throws"], framework: "node:test-default", grading: "fail-before-pass-after", matcher: "regex", maxLines: "12", placement: "new-file" };
const parses = (path: string, content: string) => !(ts.createSourceFile(path, content, ts.ScriptTarget.Latest, true) as unknown as { parseDiagnostics: unknown[] }).parseDiagnostics.length;
const okParams = (p: Record<string, string | string[]>, keys: readonly string[], vocab: Record<string, readonly string[]>) =>
  keys.every((k) => { const v = p[k]; return Array.isArray(v) ? v.length > 0 && new Set(v).size === v.length && v.every((x) => vocab[k]!.includes(x)) : typeof v === "string" && vocab[k]!.includes(v) && vocab[k]!.length === 1; });

/**
 * Auditor (#136, 1): names of the function's own const/let locals in scope at `pos`: declared (wholly) before it
 * in a block that ENCLOSES `pos` (the body or an enclosing block), or a loop variable of an enclosing loop. A local
 * declared in an earlier, already-closed block (`if (x) { const process = 1; }`) is not in scope and never counts.
 */
export function localsBefore(body: ts.Block, pos: number): Set<string> {
  const out = new Set<string>();
  const add = (l: ts.VariableDeclarationList) => { if (l.flags & (ts.NodeFlags.Const | ts.NodeFlags.Let)) for (const d of l.declarations) if (ts.isIdentifier(d.name)) out.add(d.name.text); };
  let node: ts.Node = body;
  for (;;) {
    if (ts.isBlock(node)) for (const st of node.statements) if (ts.isVariableStatement(st) && st.getEnd() <= pos) add(st.declarationList);
    if ((ts.isForStatement(node) || ts.isForOfStatement(node) || ts.isForInStatement(node)) && node.initializer && ts.isVariableDeclarationList(node.initializer) && node.initializer.getEnd() <= pos) add(node.initializer);
    const next: ts.Node | undefined = node.getChildren().flatMap((c) => (c.kind === ts.SyntaxKind.SyntaxList ? c.getChildren() : [c])).find((c) => c.getStart() <= pos && pos < c.getEnd());
    if (!next || ts.isFunctionLike(next) || ts.isClassLike(next)) break;
    node = next;
  }
  return out;
}

/** Statements of a body, descending into blocks/if/loops but never into nested functions or classes. */
function ownStatements(body: ts.Block): ts.Statement[] {
  const out: ts.Statement[] = [];
  const v = (n: ts.Node): void => {
    if (ts.isFunctionLike(n) || ts.isClassLike(n)) return;
    if (ts.isIfStatement(n) || ts.isReturnStatement(n)) out.push(n);
    ts.forEachChild(n, v);
  };
  body.statements.forEach(v);
  return out;
}

export function applyReplaceRule(trigger: string, params: Record<string, string | string[]>, objective: string, files: readonly { path: string; content: string }[], isTest: (p: string) => boolean = (p) => /\.test\.ts$/.test(p), repo?: string): BodyEdit | null {
  if (!okParams(params, BODY_PARAM_KEYS, BODY_VOCAB)) return null;
  const heads = objective.split("\n").map((l) => l.trim()).filter((l) => new RegExp(trigger, "i").test(l));
  if (heads.length !== 1) return null;
  const g = new RegExp(trigger, "i").exec(heads[0]!)!.groups ?? {};
  const site = g.site === "condition" ? "if-condition" : "return-expression";
  if (!(params.sites as string[]).includes(site)) return null;
  const oldText = strip(g.old ?? ""), newText = strip(g.new ?? "");
  const oldE = parseExpr(oldText), newE = parseExpr(newText);
  if (!oldE || !newE || sameTokens(oldText, newText)) return null;
  const target = files.find((f) => f.path === g.file);
  if (!target || isTest(target.path) || PROTECTED_SELF.some((p) => p.pattern.test(target.path)) || !editablePath(repo, target.path)) return null;
  const sf = ts.createSourceFile(target.path, target.content, ts.ScriptTarget.Latest, true);
  const fn = exportedFunction(sf, g.fn!);
  if (!fn) return null;
  const params0 = new Set<string>();
  for (const p of fn.params) { if (!ts.isIdentifier(p.name)) return null; params0.add(p.name.text); }
  if (site === "if-condition" && freeNames(newE).size === 0) return null; // a constant condition is refused
  const hits = ownStatements(fn.body).flatMap((s) => {
    const e = site === "if-condition" ? (ts.isIfStatement(s) ? s.expression : null) : ts.isReturnStatement(s) ? s.expression ?? null : null;
    return e && sameTokens(e.getText(sf), oldText) ? [e] : [];
  });
  if (hits.length !== 1) return null;
  const e = hits[0]!;
  // Names: the old expression's own, the parameters, and the function's const/let locals declared before the site.
  const allowed = new Set([...freeNames(oldE), ...params0, ...localsBefore(fn.body, e.getStart(sf))]);
  if (!safeExpression(newE, allowed, calleesOf(oldE))) return null;
  const content = target.content.slice(0, e.getStart(sf)) + newE.getText() + target.content.slice(e.getEnd());
  if (!parses(target.path, content)) return null;
  const tt = testFor(g.fn!, g.file!, `${g.file}\0${g.fn}\0${site}\0${oldText}\0${newText}`, objective);
  if (!tt) return null;
  const test = buildTestEdit(TEST_PARAMS, tt, files, isTest);
  if (!test) return null;
  return { path: target.path, content, extra: [{ path: test.path, content: test.content, create: true }], selfGrade: true };
}

/**
 * Auditor (#136, 2): Job B credits the before-run failure only when the test runner reports EVERY failing test as
 * an assertion failure (ERR_ASSERTION), never a crash, load/import error, timeout or other throw.
 */
export function assertionFailuresOnly(tap: string): boolean {
  const lines = tap.split("\n");
  let failures = 0;
  for (let i = 0; i < lines.length; i++) {
    if (!/^\s*not ok \d+ - /.test(lines[i]!)) continue;
    failures++;
    let code = "";
    for (let j = i + 1; j < lines.length && !/^\s*(?:not ok|ok) \d+ - /.test(lines[j]!); j++) { const c = /^\s+code: '([A-Z_]+)'$/.exec(lines[j]!); if (c && !code) code = c[1]!; }
    if (code !== "ERR_ASSERTION") return false;
  }
  return failures > 0;
}
