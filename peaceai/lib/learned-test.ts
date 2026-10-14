// M12: the ADD_TEST_CASE learned rule (test-writing edit type). A spec of this kind carries the template
// parameters mined from finished tests in public repositories (peaceai/lib/minetest.ts): the test and assert
// imports, the check forms seen often enough, the error matcher style and the size limit. The skeleton is
// fixed here; every placeholder is filled only from the task text (title, check expressions, error codes,
// fix commit) and the target code (exported names, import style). It writes one NEW test file and never
// touches an existing one. Job B then grades the test: it must pass on the fixed code and fail on the code
// before the fix (bin/test-candidates.ts), otherwise the candidate is rejected. Deterministic; no model.
import ts from "typescript";
import { MAX_OBJECT_EXPR_CHARS, objectArgsReason } from "./objargs.ts";

export const TEST_PARAM_KEYS = ["assert", "checks", "framework", "grading", "matcher", "maxLines", "placement"] as const;
export const TEST_CHECKS = ["equal", "deepEqual", "throws", "rejects"] as const;
export type TestCheckKind = (typeof TEST_CHECKS)[number];
export const TEST_FRAMEWORKS = ["node:test-default"] as const;
export const TEST_ASSERTS = ["node:assert/strict-default"] as const;
export const TEST_MATCHERS = ["regex"] as const;
export const MAX_CHECKS = 8;
export const MAX_EXPR_CHARS = 200;
export { MAX_OBJECT_DEPTH, MAX_OBJECT_EXPR_CHARS, MAX_OBJECT_KEYS, objectArgsReason } from "./objargs.ts";

const NAME = String.raw`[A-Za-z_$][\w$]*`;
const FILE = String.raw`[\w./-]+\.ts`;
/** Header line of the task (the rule's trigger). Backticks are optional: the issue text is cleaned, which turns them into spaces. */
export const TEST_TRIGGER = String.raw`^add (?:a )?(?:regression )?test for \x60?(?<symbol>${NAME})\x60? in \x60?(?<file>${FILE})\x60?(?: ?: (?<title>[^\n]{1,120}?))?\.?$`;
/** Fix commit line: the commit whose source change the new test must pin. Required (no fix, no candidate). */
export const FIX_LINE = /^fix(?:ed)?(?: (?:in|by))?:? ?(?<sha>[0-9a-f]{40})\.?$/i;
const LIT = String.raw`"[^"\n]*"|'[^'\n]*'|-?\d+(?:\.\d+)?|true|false|null|undefined`;
const CHECK_LINE: { kind: TestCheckKind; re: RegExp }[] = [
  { kind: "rejects", re: /^[-*] (?<expr>.+) rejects with \x60?(?<code>[A-Z][A-Z0-9_]{2,63})\x60?\.?$/ },
  { kind: "throws", re: /^[-*] (?<expr>.+) throws \x60?(?<code>[A-Z][A-Z0-9_]{2,63})\x60?\.?$/ },
  { kind: "deepEqual", re: /^[-*] (?<expr>.+) equals \x60?(?<value>[[{].*[\]}])\x60?\.?$/ },
  { kind: "equal", re: new RegExp(String.raw`^[-*] (?<expr>.+) is \x60?(?<value>${LIT})\x60?\.?$`) },
];

export interface TestCheck { kind: TestCheckKind; expr: string; value?: string; code?: string }
export interface TestTask { symbol: string; file: string; title: string | null; checks: TestCheck[]; fixSha: string }
/** `create` for a new file; M14 `placement: append`: an existing test file with the new case appended (no `create`). */
export interface TestEdit { path: string; content: string; create?: true; fixSha: string }

const strip = (s: string) => s.replace(/^\x60|\x60$/g, "").trim();

/** Reads the header (trigger), the bulleted checks under it and the fix line. Null when anything is off. */
export function parseTestTask(trigger: string, objective: string): TestTask | null {
  const lines = objective.split("\n").map((l) => l.trim()).filter(Boolean);
  const head = lines.findIndex((l) => new RegExp(trigger, "i").test(l));
  if (head < 0) return null;
  const g = new RegExp(trigger, "i").exec(lines[head]!)!.groups ?? {};
  if (!g.symbol || !g.file) return null;
  const fixes = lines.map((l) => FIX_LINE.exec(l)?.groups?.sha).filter((s): s is string => !!s);
  if (new Set(fixes).size !== 1) return null; // exactly one fix commit
  const checks: TestCheck[] = [];
  for (const l of lines.slice(head + 1)) {
    if (!/^[-*] /.test(l)) continue;
    const hit = CHECK_LINE.map((c) => ({ c, m: c.re.exec(l) })).find((x) => x.m);
    if (!hit) return null; // a bullet we cannot read: refuse rather than drop it
    const m = hit.m!.groups!;
    checks.push({ kind: hit.c.kind, expr: strip(m.expr!), ...(m.value !== undefined ? { value: strip(m.value) } : {}), ...(m.code ? { code: m.code } : {}) });
  }
  if (checks.length === 0 || checks.length > MAX_CHECKS) return null;
  return { symbol: g.symbol, file: g.file, title: g.title?.trim() || null, checks, fixSha: fixes[0]!.toLowerCase() };
}

const parseExpr = (text: string): ts.Expression | null => {
  const sf = ts.createSourceFile("e.ts", `(${text});`, ts.ScriptTarget.Latest, true);
  const st = sf.statements;
  if (st.length !== 1 || !ts.isExpressionStatement(st[0]!) || (sf as unknown as { parseDiagnostics: unknown[] }).parseDiagnostics.length) return null;
  const e = (st[0] as ts.ExpressionStatement).expression;
  return ts.isParenthesizedExpression(e) ? e.expression : null;
};

/** M35: a `new Date("...")` argument: identifier Date (not shadowable here: checks only name exports), exactly one plain
 *  string literal of at most MAX_DATE_LITERAL_CHARS characters from a date-text alphabet (no escapes, no templates). */
export const MAX_DATE_LITERAL_CHARS = 32;
export function isDateLiteral(n: ts.Node): boolean {
  if (!ts.isNewExpression(n) || n.typeArguments || !ts.isIdentifier(n.expression) || n.expression.text !== "Date") return false;
  const a = n.arguments ?? [];
  if (a.length !== 1 || !ts.isStringLiteral(a[0]!)) return false;
  const raw = a[0]!.getText().slice(1, -1);
  return raw.length <= MAX_DATE_LITERAL_CHARS && /^[0-9A-Za-z:.+\- ]*$/.test(raw) && raw === a[0]!.text;
}

/** A literal value: string, number, -number, true/false/null/undefined, arrays and plain objects of those.
 *  M35: with `dates`, also a `new Date("...")` (isDateLiteral), directly or inside arrays/objects. */
function isLiteralValue(n: ts.Node, dates = false): boolean {
  if (dates && isDateLiteral(n)) return true;
  if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isNumericLiteral(n)) return true;
  if (n.kind === ts.SyntaxKind.TrueKeyword || n.kind === ts.SyntaxKind.FalseKeyword || n.kind === ts.SyntaxKind.NullKeyword) return true;
  if (ts.isIdentifier(n) && n.text === "undefined") return true;
  if (ts.isPrefixUnaryExpression(n) && n.operator === ts.SyntaxKind.MinusToken && ts.isNumericLiteral(n.operand)) return true;
  if (ts.isArrayLiteralExpression(n)) return n.elements.every((x) => isLiteralValue(x, dates));
  if (ts.isObjectLiteralExpression(n))
    return n.properties.every((p) => ts.isPropertyAssignment(p) && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) && isLiteralValue(p.initializer, dates));
  return false;
}

/**
 * The root identifier of an allowed check expression, or null. Allowed: an exported name, then property
 * reads, literal index reads, and calls (or `new`) whose arguments are literal values. Nothing else: no
 * other identifiers, operators, functions or templates, so no code beyond names the task and target give.
 */
export function checkRoot(e: ts.Expression, dates = false): string | null {
  if (ts.isIdentifier(e)) return e.text === "undefined" ? null : e.text;
  if (ts.isPropertyAccessExpression(e)) return e.questionDotToken ? null : checkRoot(e.expression, dates);
  if (ts.isElementAccessExpression(e)) return isLiteralValue(e.argumentExpression) && !ts.isObjectLiteralExpression(e.argumentExpression) ? checkRoot(e.expression, dates) : null;
  // M35: Date arguments only as call arguments (never as an index, a `new` argument or an expected value).
  if (ts.isCallExpression(e)) return !e.typeArguments && e.arguments.every((a) => isLiteralValue(a, dates)) ? checkRoot(e.expression, dates) : null;
  if (ts.isNewExpression(e)) return !e.typeArguments && ts.isIdentifier(e.expression) && (e.arguments ?? []).every((a) => isLiteralValue(a)) ? e.expression.text : null;
  return null;
}

/** Names a module exports (declarations and `export { a, b as c }`), without type-only exports. */
export function exportedValues(path: string, content: string): Set<string> {
  const sf = ts.createSourceFile(path, content, ts.ScriptTarget.Latest, true);
  const out = new Set<string>();
  const exported = (n: ts.Node) => ts.canHaveModifiers(n) && (ts.getModifiers(n) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
  for (const s of sf.statements) {
    if (ts.isVariableStatement(s) && exported(s)) for (const d of s.declarationList.declarations) { if (ts.isIdentifier(d.name)) out.add(d.name.text); }
    else if ((ts.isFunctionDeclaration(s) || ts.isClassDeclaration(s) || ts.isEnumDeclaration(s)) && exported(s) && s.name) out.add(s.name.text);
    else if (ts.isExportDeclaration(s) && !s.isTypeOnly && !s.moduleSpecifier && s.exportClause && ts.isNamedExports(s.exportClause))
      for (const el of s.exportClause.elements) if (!el.isTypeOnly) out.add(el.name.text);
  }
  return out;
}

/** Import style of the target's own tests: "ts" when most relative imports end in .ts, else extensionless. */
export function importStyle(files: readonly { path: string; content: string }[], isTest: (p: string) => boolean): "ts" | "none" {
  let ts_ = 0;
  let none = 0;
  for (const f of files) {
    if (!isTest(f.path)) continue;
    for (const m of f.content.matchAll(/^import [^;]*? from "(\.{1,2}\/[^"]+)";$/gm)) {
      if (m[1]!.endsWith(".ts")) ts_ += 1;
      else if (!/\.[a-z]+$/.test(m[1]!)) none += 1;
    }
  }
  return ts_ > none ? "ts" : "none";
}

const renderValue = (text: string) => {
  const e = parseExpr(text);
  return e && isLiteralValue(e) ? e.getText() : null;
};
const slug = (s: string) => {
  const full = s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const cut = full.length <= 32 ? full : full.slice(0, 33).replace(/-[^-]*$/, "") || full.slice(0, 32);
  return cut || "case";
};

/**
 * Builds the new test file. Refuses (null) unless: the spec allows every check form used; the target file
 * exists among the in-scope sources and exports the symbol and every expression root; every value parses
 * as a literal; the new path does not exist; and the test case fits the learned size limit.
 */
export function buildTestEdit(
  params: Record<string, string | string[]>,
  task: TestTask,
  files: readonly { path: string; content: string }[],
  isTest: (p: string) => boolean = (p) => /\.test\.ts$/.test(p),
): TestEdit | null {
  const allowed = Array.isArray(params.checks) ? params.checks : [];
  if (params.framework !== "node:test-default" || params.assert !== "node:assert/strict-default" || params.matcher !== "regex") return null;
  if ((params.placement !== "new-file" && params.placement !== "append") || params.grading !== "fail-before-pass-after") return null;
  const maxLines = Number(params.maxLines);
  if (!Number.isInteger(maxLines) || maxLines < 3) return null;
  if (task.checks.some((c) => !allowed.includes(c.kind))) return null;
  const target = files.find((f) => f.path === task.file);
  if (!target || isTest(target.path) || !/^(?:.*\/)?[\w.-]+\.ts$/.test(target.path)) return null;
  const exports = exportedValues(target.path, target.content);
  if (!exports.has(task.symbol)) return null;
  // M20: the object-literal spec only runs for tasks that pass an object literal (else the plain spec covers it).
  if (params.args === "object-literal" && !task.checks.some((c) => { const x = parseExpr(c.expr); let has = false; const v = (n: ts.Node) => { if (ts.isCallExpression(n) && n.arguments.some(ts.isObjectLiteralExpression)) has = true; ts.forEachChild(n, v); }; if (x) v(x); return has; })) return null;
  // M35: the Date-argument spec only runs for tasks that pass a `new Date("...")` (else the plain specs cover it).
  if (params.args === "date-literal" && !task.checks.some((c) => { const x = parseExpr(c.expr); let has = false; const v = (n: ts.Node) => { if (ts.isCallExpression(n) && n.arguments.some((a) => isDateLiteral(a) || (ts.isArrayLiteralExpression(a) && a.elements.some(isDateLiteral)))) has = true; ts.forEachChild(n, v); }; if (x) v(x); return has; })) return null;
  const roots = new Set<string>([task.symbol]);
  const body: string[] = [];
  for (const c of task.checks) {
    const objectArgs = params.args === "object-literal";
    if (c.expr.length > (objectArgs ? MAX_OBJECT_EXPR_CHARS : MAX_EXPR_CHARS)) return null;
    const e = parseExpr(c.expr);
    // M20 (Auditor): every object in a check must be plain bounded data (objectArgsReason), under every test
    // spec: the plain specs no longer accept __proto__/constructor/prototype or repeated keys, or deep objects.
    if (e && objectArgsReason(e) !== null) return null;
    const root = e ? checkRoot(e, params.args === "date-literal") : null;
    if (!e || !root || !exports.has(root)) return null;
    roots.add(root);
    const expr = e.getText();
    if (c.kind === "equal" || c.kind === "deepEqual") {
      const v = renderValue(c.value ?? "");
      if (v === null) return null;
      if (c.kind === "deepEqual" && !/^[[{]/.test(v)) return null;
      body.push(`  assert.${c.kind}(${expr}, ${v});`);
    } else if (c.kind === "throws") body.push(`  assert.throws(() => ${expr}, /${c.code}/);`);
    else body.push(`  await assert.rejects(async () => ${expr}, /${c.code}/);`);
  }
  if (params.placement === "append") return appendTestEdit(task, target.path, [...roots], body, files, maxLines, isTest);
  const dir = target.path.includes("/") ? target.path.slice(0, target.path.lastIndexOf("/") + 1) : "";
  const stem = target.path.slice(dir.length).replace(/\.ts$/, "");
  const path = `${dir}${stem}.${slug(task.title ?? task.symbol)}-${task.fixSha.slice(0, 7)}.test.ts`;
  if (files.some((f) => f.path === path)) return null;
  const spec = `./${stem}${importStyle(files, isTest) === "ts" ? ".ts" : ""}`;
  const name = task.title ?? `${task.symbol}: behavior fixed in ${task.fixSha.slice(0, 7)}`;
  const isAsync = task.checks.some((c) => c.kind === "rejects");
  const testCase = [`test(${JSON.stringify(name)}, ${isAsync ? "async " : ""}() => {`, ...body, "});"];
  if (testCase.length > maxLines) return null;
  const content = [
    'import assert from "node:assert/strict";',
    'import test from "node:test";',
    `import { ${[...roots].sort().join(", ")} } from ${JSON.stringify(spec)};`,
    "",
    ...testCase,
    "",
  ].join("\n");
  return { path, content, create: true, fixSha: task.fixSha };
}

/**
 * M14: append the case to the target's own test file (`<dir><stem>.test.ts`). Never touches an existing line:
 * the file must already import `assert` (node:assert/strict, default) and `test` (node:test, default) and every
 * name the checks start from, from the target module; otherwise no candidate. The case is added at the end.
 */
function appendTestEdit(task: TestTask, targetPath: string, roots: string[], body: string[], files: readonly { path: string; content: string }[], maxLines: number, isTest: (p: string) => boolean): TestEdit | null {
  const dir = targetPath.includes("/") ? targetPath.slice(0, targetPath.lastIndexOf("/") + 1) : "";
  const stem = targetPath.slice(dir.length).replace(/\.ts$/, "");
  const path = `${dir}${stem}.test.ts`;
  const file = files.find((f) => f.path === path);
  if (!file || !isTest(file.path)) return null;
  const sf = ts.createSourceFile(path, file.content, ts.ScriptTarget.Latest, true);
  let assertOk = false;
  let testOk = false;
  const named = new Set<string>();
  for (const s of sf.statements) {
    if (!ts.isImportDeclaration(s) || !ts.isStringLiteral(s.moduleSpecifier) || s.importClause?.isTypeOnly) continue;
    const from = s.moduleSpecifier.text;
    const c = s.importClause;
    if (from === "node:assert/strict" && c?.name?.text === "assert") assertOk = true;
    else if (from === "node:test" && c?.name?.text === "test") testOk = true;
    else if (from === `./${stem}` || from === `./${stem}.ts`)
      if (c?.namedBindings && ts.isNamedImports(c.namedBindings)) for (const el of c.namedBindings.elements) if (!el.isTypeOnly && !el.propertyName) named.add(el.name.text);
  }
  if (!assertOk || !testOk || !roots.every((r) => named.has(r))) return null;
  const name = task.title ?? `${task.symbol}: behavior fixed in ${task.fixSha.slice(0, 7)}`;
  if (file.content.includes(JSON.stringify(name))) return null; // same test name already in the file
  const isAsync = task.checks.some((c) => c.kind === "rejects");
  const testCase = [`test(${JSON.stringify(name)}, ${isAsync ? "async " : ""}() => {`, ...body, "});"];
  if (testCase.length > maxLines) return null;
  const head = file.content.endsWith("\n") ? file.content : `${file.content}\n`;
  return { path, content: `${head}\n${testCase.join("\n")}\n`, fixSha: task.fixSha };
}
