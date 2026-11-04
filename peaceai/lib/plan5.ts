// PLAN-ONLY mode v5 (planner id plan-only-v5, peaceai/spec/plan-only-v5.md). EXPERIMENTAL; v4 (plan4.ts) stays the
// default (lib/plandefault.ts) and is unchanged (v5 imports it, so v4's plannerSha256 does not move). v5 is v4 plus ONE
// family (M194, "diagnose from failure codes"): when the request reports a failure and states error codes
// (CONSTANT_CASE, optionally `CODE:detail`), v5 looks for the site in the shipped source that THROWS each code (a
// throw, a rejection, a constructed Error, or an Error subclass whose constructor passes the code, followed to where
// that class is thrown) and plans the fix there. Codes that no source throws (downstream symptoms such as a later
// check's report code) are listed, not planned. When no stated code has a throwing site, the plan is v4's plan
// unchanged. Every diagnose step is `missing`: no approved rule edits a throwing site, and v5 says what it cannot do yet
// (`notYet`, a fixed vocabulary). Each condition is one line tagged `rule:<id>`; M194 removes each in turn and
// requires a case to fail.
// M195 (Batch 29) widens "raises the code" to codes that are CAUGHT AND REPORTED: logged (console / logger /
// process.stderr.write), pushed into an errors / warnings / failures / problems / issues array, or returned / resolved as
// `{ ok|success: false, ... }`, inside a catch block or a `.catch(fn)` / `.then(_, fn)` rejection handler. Such a site is
// planned at the try statement or promise chain whose failure is reported (its enclosing function), not at the logging
// line, with `via: catch-log | catch-push | catch-result`. Codes built by templates (`PREFIX_${x}`) match a reported
// `PREFIX_<SEGMENT>` through a boundary-safe CONSTANT_CASE prefix (`match: "template-prefix"`). A `CODE:detail` detail
// drops a sentence's trailing full stop.
// Nothing here names a repository, task, task set or file of any task set, and no dev-set wording is matched.
// Read-only: the checkout is opened through codesearch.openRepo (readdir/stat/readFile only, nothing executed).
import ts from "typescript";
import type { CodeRepo } from "./codesearch.ts";
import type { Capability, PlanContext, PlanStep } from "./plan.ts";
import { isSourceFile, MAX_SOURCES_V4, namedTests, newTestPath, packageDirOf, planTaskV4, repoFromFiles, statedNames, testCommandFor, testOf, type PlanV4, type TestPick } from "./plan4.ts";

export const PLANNER_V5 = "plan-only-v5" as const;
export { repoFromFiles };
/** Most codes one request may report, and most files one code may be thrown in before it counts as ambiguous. */
export const MAX_CODES_V5 = 8;
export const MAX_SITE_FILES_PER_CODE = 3;
/** What a diagnose plan cannot do yet. Fixed vocabulary (a plan never carries free text). */
export const DIAG_NOT_YET = ["reproduce-reported-failure", "fix-at-throw-site", "fix-at-report-site", "trace-unthrown-codes"] as const;
export type DiagNotYet = (typeof DIAG_NOT_YET)[number];
export type DiagRefusal = "NO_FAILURE_REPORT" | "NO_CODES" | "NO_THROW_SITE";
/** How a site raises the code: thrown (M194), or caught and then reported (M195: logged, pushed into a problems array,
 *  or returned as a failed result, inside a catch block or a promise's rejection handler). */
export type SiteVia = "throw" | "reject" | "error-new" | "error-class" | "catch-log" | "catch-push" | "catch-result";
export const REPORT_VIAS: readonly SiteVia[] = ["catch-log", "catch-push", "catch-result"];
/** `token`: a literal holds the code as a whole token (or a name bound to it); `template-prefix`: a template literal
 *  builds it as `PREFIX_${x}` (M195). For a reported site, `line`/`symbol` are the try statement or promise chain whose
 *  failure is reported (where the fix belongs), not the logging line. */
export interface ThrowSite { path: string; line: number; symbol: string | null; via: SiteVia; match: "token" | "template-prefix" }
export interface ReportedCode { code: string; detail: string | null }
export interface DiagCode extends ReportedCode { status: "thrown" | "reported" | "not-thrown" | "ambiguous"; sites: ThrowSite[] }
export interface Diagnosis { family: "diagnose-failure-codes" | null; refused: DiagRefusal | null; codes: DiagCode[]; notYet: DiagNotYet[] }
export interface PlanV5 extends Omit<PlanV4, "planner"> { planner: typeof PLANNER_V5; diagnosis: Diagnosis }

// ---- reading the request

/** A request that reports a failure (a run, job, call or check that fails, errors, throws, aborts, times out...). */
export const reportsFailure = (request: string): boolean =>
  /\b(?:fail(?:s|ed|ing|ures?)?|errors?|errored|throws?|threw|thrown|crash(?:es|ed)?|abort(?:s|ed)?|exceptions?|rejects?|rejected|timed out|times out|(?:exits?|ends?|stops?|dies) with)\b/i.test(request); // rule:diag-failure-report

/** Error codes the request reports, in order: CONSTANT_CASE with at least one underscore; `CODE:detail` keeps the
 *  detail and the detail is never a code of its own. */
export function reportedCodes(request: string): ReportedCode[] {
  const out: ReportedCode[] = [];
  const text = request.replace(/`/g, " ");
  for (const m of text.matchAll(/(?<![\w$.\/:-])([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+)(?::([A-Za-z0-9_.-]{1,40}))?(?![\w$])/g)) { // rule:diag-code-shape
    if (m[1]!.length < 5 || out.some((c) => c.code === m[1])) continue;
    const detail = m[2]?.replace(/\.+$/, "") || null; // rule:diag-detail-trim
    out.push({ code: m[1]!, detail });
  }
  return out.slice(0, MAX_CODES_V5);
}

// ---- finding where a code is thrown (TypeScript syntax only, no type checker)

const word = (s: string) => new RegExp(String.raw`(?<![A-Za-z0-9_$])${s.replace(/\$/g, "\\$")}(?![A-Za-z0-9_$])`);
const nameOf = (e: ts.Node): string | null => (ts.isIdentifier(e) ? e.text : ts.isPropertyAccessExpression(e) ? e.name.text : null);
const ERRORISH = /(?:Error|Exception)$/;

function parse(code: CodeRepo, path: string): ts.SourceFile | null {
  const r = code.read(path);
  if (!r.ok || r.truncated) return null;
  const kind = /\.tsx$/.test(path) ? ts.ScriptKind.TSX : /\.jsx$/.test(path) ? ts.ScriptKind.JSX : /\.[cm]?js$/.test(path) ? ts.ScriptKind.JS : ts.ScriptKind.TS;
  return ts.createSourceFile(path, r.text, ts.ScriptTarget.Latest, true, kind);
}

/** The innermost named function, method or class around `n` (null at module level). */
function enclosing(n: ts.Node): string | null {
  for (let p: ts.Node | undefined = n.parent; p; p = p.parent) {
    if ((ts.isFunctionDeclaration(p) || ts.isMethodDeclaration(p) || ts.isClassDeclaration(p) || ts.isGetAccessor(p) || ts.isSetAccessor(p)) && p.name && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name))) return p.name.text;
    if ((ts.isArrowFunction(p) || ts.isFunctionExpression(p)) && (ts.isVariableDeclaration(p.parent) || ts.isPropertyAssignment(p.parent) || ts.isPropertyDeclaration(p.parent)) && ts.isIdentifier(p.parent.name)) return p.parent.name.text;
  }
  return null;
}

const LOG_METHOD = /^(?:error|warn|warning|fatal|critical|info|notice|log|debug|trace)$/;
/** A logging call: `console.<level>`, `<log|logger|...Logger>.<level>` (also `this.logger.<level>`), `process.stderr|stdout.write`. */
function isLogCall(e: ts.Expression): boolean {
  if (!ts.isPropertyAccessExpression(e)) return false;
  const r = e.expression;
  if (ts.isPropertyAccessExpression(r) && ts.isIdentifier(r.expression) && r.expression.text === "process" && /^(?:stderr|stdout)$/.test(r.name.text)) return e.name.text === "write";
  const recv = nameOf(r);
  return recv !== null && /^(?:console|log|logger|Log|Logger)$|[a-z0-9]Logger$/.test(recv) && LOG_METHOD.test(e.name.text);
}
/** `<problems>.push(..)` / `.unshift(..)` where the array is named errors / warnings / failures / problems / issues. */
const isProblemPush = (e: ts.Expression): boolean =>
  ts.isPropertyAccessExpression(e) && /^(?:push|unshift)$/.test(e.name.text) && /^(?:errors?|warnings?|failures?|problems?|issues?)$|[a-z0-9](?:Errors?|Warnings?|Failures?|Problems?|Issues?)$/.test(nameOf(e.expression) ?? "");
/** An object literal with `ok|success|succeeded: false` that is returned, an arrow's result, or resolved. */
function isFailedResult(o: ts.ObjectLiteralExpression): boolean {
  if (!o.properties.some((pr) => ts.isPropertyAssignment(pr) && ts.isIdentifier(pr.name) && /^(?:ok|success|succeeded)$/.test(pr.name.text) && pr.initializer.kind === ts.SyntaxKind.FalseKeyword)) return false;
  let e: ts.Node = o;
  while (ts.isParenthesizedExpression(e.parent) || ts.isAsExpression(e.parent) || ts.isSatisfiesExpression(e.parent) || ts.isTypeAssertionExpression(e.parent)) e = e.parent;
  const p = e.parent;
  return ts.isReturnStatement(p) || (ts.isArrowFunction(p) && p.body === e) || (ts.isCallExpression(p) && p.arguments.some((a) => a === e) && nameOf(p.expression) === "resolve");
}
/** The try statement whose catch block holds `n`, or the `.catch(fn)` / `.then(_, fn)` call whose handler holds it;
 *  null when `n` is not in a catch (a try block, a success handler or any other function stops the walk). */
export function caughtBy(n: ts.Node): ts.Node | null {
  for (let p = n.parent; p; p = p.parent) {
    if (ts.isCatchClause(p)) return p.parent;
    if (ts.isFunctionLike(p)) {
      const c = p.parent;
      if (c && ts.isCallExpression(c) && ts.isPropertyAccessExpression(c.expression) && ((c.expression.name.text === "catch" && c.arguments[0] === p) || (c.expression.name.text === "then" && c.arguments[1] === p))) return c;
      return null;
    }
    if (ts.isClassLike(p) || ts.isSourceFile(p)) return null;
  }
  return null;
}

/** How the value at `n` leaves as a failure, or null: walks up the expression until the first statement or function.
 *  A reported failure (`catch-*`) carries `at`, the try statement or promise chain that caught it. */
export function throwContext(n: ts.Node): { via: SiteVia; cls: string | null; at?: ts.Node } | null {
  let cur = n;
  const caught = (via: SiteVia, sink: ts.Node) => { const at = caughtBy(sink); return at ? { via, cls: null, at } : null; }; // rule:diag-report-caught
  for (let p = n.parent; p; cur = p, p = p.parent) {
    if (ts.isThrowStatement(p)) return { via: "throw", cls: null }; // rule:diag-throw
    if (ts.isNewExpression(p) && p.arguments?.some((a) => a === cur) && ERRORISH.test(nameOf(p.expression) ?? "")) return { via: "error-new", cls: null }; // rule:diag-error-new
    if (ts.isCallExpression(p) && p.arguments.some((a) => a === cur)) {
      if (nameOf(p.expression) === "reject") return { via: "reject", cls: null }; // rule:diag-reject
      const log = isLogCall(p.expression) ? caught("catch-log", p) : null; // rule:diag-report-log
      if (log) return log;
      const push = isProblemPush(p.expression) ? caught("catch-push", p) : null; // rule:diag-report-push
      if (push) return push;
      if (p.expression.kind === ts.SyntaxKind.SuperKeyword) { // rule:diag-error-class
        const cls = ts.findAncestor(p, ts.isClassLike);
        const base = cls?.heritageClauses?.find((h) => h.token === ts.SyntaxKind.ExtendsKeyword)?.types[0]?.expression;
        return base && ERRORISH.test(nameOf(base) ?? "") && cls?.name ? { via: "error-class", cls: cls.name.text } : null;
      }
    }
    const result = ts.isObjectLiteralExpression(p) && isFailedResult(p) ? caught("catch-result", p) : null; // rule:diag-report-result
    if (result) return result;
    if (ts.isStatement(p) || ts.isFunctionLike(p) || ts.isClassLike(p) || ts.isSourceFile(p)) return null; // rule:diag-statement-bound
  }
  return null;
}

/** A literal's text, or null when `n` is not a string or template literal. Template holes are dropped. */
const literalText = (n: ts.Node): string | null =>
  ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) ? n.text : ts.isTemplateExpression(n) ? [n.head.text, ...n.templateSpans.map((s) => s.literal.text)].join("\0") : null;

/** The literal prefix a template may build `errCode` from (`A_B_${x}` for `A_B_C`): the code minus its last
 *  `_SEGMENT`, only when that prefix is itself CONSTANT_CASE with at least two segments and 5+ characters (so `HTTP_${s}`
 *  or `E_${s}` never match) and the dropped segment is one plain [A-Z0-9]+ segment. Null otherwise. */
export function templatePrefix(errCode: string): string | null {
  const m = /^([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+_)[A-Z0-9]+$/.exec(errCode);
  return m && m[1]!.length - 1 >= 5 ? m[1]! : null; // rule:diag-template-prefix
}
/** A template literal that builds a code from `prefix` + a hole: some head/middle text ends with `prefix` at a word
 *  boundary of that same text (not after a hole), and the text after the hole does not continue the code. */
export function templateBuilds(n: ts.Node, prefix: string): boolean {
  if (!ts.isTemplateExpression(n)) return false;
  const parts = [n.head.text, ...n.templateSpans.map((s) => s.literal.text)];
  for (let i = 0; i < parts.length - 1; i++) {
    const t = parts[i]!;
    if (!t.endsWith(prefix)) continue;
    const before = t.slice(0, t.length - prefix.length);
    if ((before === "" ? i === 0 : /[^A-Za-z0-9_$]$/.test(before)) && !/^[A-Za-z0-9_$]/.test(parts[i + 1]!)) return true; // rule:diag-template-boundary
  }
  return false;
}

/** Sites in the shipped source that throw `code`: literals holding it as a whole token, or CONSTANT_CASE names bound to
 *  exactly it (a const, object property or enum member whose value is the code), in a throw context. Error subclasses that
 *  pass it to `super` are followed to where the class is thrown. Null when the search itself is too broad. */
export function throwSites(code: CodeRepo, errCode: string): ThrowSite[] | null {
  const tok = word(errCode);
  const prefix = templatePrefix(errCode);
  const g = code.grep(errCode, { limit: 500 });
  if (!g.ok || g.truncated) return null;
  const hits = g.hits.map((h) => h.path);
  if (prefix) {
    const gp = code.grep(prefix, { limit: 500 });
    if (!gp.ok || gp.truncated) return null;
    hits.push(...gp.hits.map((h) => h.path));
  }
  const files = [...new Set(hits)].filter(isSourceFile); // rule:diag-source-only
  const aliases = new Set<string>();
  const sites: ThrowSite[] = [];
  const classes = new Set<string>();
  const add = (sf: ts.SourceFile, n: ts.Node, via: SiteVia, match: ThrowSite["match"]) => {
    const line = sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
    if (!sites.some((s) => s.path === sf.fileName && s.line === line)) sites.push({ path: sf.fileName, line, symbol: enclosing(n), via, match });
  };
  const parsed = new Map<string, ts.SourceFile | null>();
  const sfOf = (p: string) => { if (!parsed.has(p)) parsed.set(p, parse(code, p)); return parsed.get(p)!; };
  for (const p of files) {
    const sf = sfOf(p);
    if (!sf) continue;
    const visit = (n: ts.Node): void => {
      const t = literalText(n);
      const match = t === null ? null : tok.test(t) ? "token" : prefix && templateBuilds(n, prefix) ? "template-prefix" : null;
      if (t !== null && match) {
        const ctx = throwContext(n);
        if (ctx?.via === "error-class") classes.add(ctx.cls!);
        else if (ctx) add(sf, ctx.at ?? n, ctx.via, match);
        const d = n.parent;
        if (t === errCode && d && (ts.isVariableDeclaration(d) || ts.isPropertyAssignment(d) || ts.isEnumMember(d) || ts.isPropertyDeclaration(d)) && d.initializer === n && ts.isIdentifier(d.name) && /^[A-Z][A-Z0-9_]*$/.test(d.name.text)) aliases.add(d.name.text); // rule:diag-alias
      }
      if (ts.isTemplateExpression(n)) return;
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }
  aliases.add(errCode);
  const uses = (name: string, test: (n: ts.Node) => { via: SiteVia; at?: ts.Node } | null) => {
    const h = code.grep(name, { limit: 500 });
    if (!h.ok) return;
    for (const p of [...new Set(h.hits.map((x) => x.path))].filter(isSourceFile)) {
      const sf = sfOf(p);
      if (!sf) continue;
      const visit = (n: ts.Node): void => { const r = test(n); if (r) add(sf, r.at ?? n, r.via, "token"); ts.forEachChild(n, visit); };
      visit(sf);
    }
  };
  for (const a of aliases) uses(a, (n) => { // rule:diag-alias-use
    if (!ts.isIdentifier(n) || n.text !== a) return null;
    if ((ts.isVariableDeclaration(n.parent) || ts.isPropertyAssignment(n.parent) || ts.isEnumMember(n.parent) || ts.isPropertyDeclaration(n.parent)) && n.parent.name === n) return null;
    const at = ts.isPropertyAccessExpression(n.parent) && n.parent.name === n ? n.parent : n;
    const ctx = throwContext(at);
    if (ctx?.via === "error-class") { classes.add(ctx.cls!); return null; }
    return ctx;
  });
  for (const cls of classes) { // rule:diag-class-follow
    const before = sites.length;
    uses(cls, (n) => (ts.isNewExpression(n) && nameOf(n.expression) === cls ? throwContext(n) : null));
    if (sites.length === before) { // never thrown where we can see: the class itself is the site
      const sf = files.map(sfOf).find((s) => s && s.statements.some((st) => ts.isClassDeclaration(st) && st.name?.text === cls));
      const decl = sf?.statements.find((st): st is ts.ClassDeclaration => ts.isClassDeclaration(st) && st.name?.text === cls);
      if (sf && decl) sites.push({ path: sf.fileName, line: sf.getLineAndCharacterOfPosition(decl.getStart(sf)).line + 1, symbol: cls, via: "error-class", match: "token" });
    }
  }
  return sites.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : a.line - b.line));
}

/** The diagnosis alone (also used by the planner). */
export function diagnose(code: CodeRepo, request: string): Diagnosis {
  const refuse = (r: DiagRefusal, codes: DiagCode[] = []): Diagnosis => ({ family: null, refused: r, codes, notYet: [] });
  if (!reportsFailure(request)) return refuse("NO_FAILURE_REPORT");
  const reported = reportedCodes(request);
  if (reported.length === 0) return refuse("NO_CODES");
  const codes: DiagCode[] = reported.map((c) => {
    const sites = throwSites(code, c.code);
    if (sites === null || new Set(sites.map((s) => s.path)).size > MAX_SITE_FILES_PER_CODE) return { ...c, status: "ambiguous", sites: [] }; // rule:diag-ambiguous
    const status = sites.length === 0 ? "not-thrown" : sites.some((s) => !REPORT_VIAS.includes(s.via)) ? "thrown" : "reported";
    return { ...c, status, sites };
  });
  if (!codes.some((c) => c.status === "thrown" || c.status === "reported")) return refuse("NO_THROW_SITE", codes); // rule:diag-needs-site
  const all = codes.flatMap((c) => c.sites);
  const notYet: DiagNotYet[] = ["reproduce-reported-failure"];
  if (all.some((s) => !REPORT_VIAS.includes(s.via))) notYet.push("fix-at-throw-site");
  if (all.some((s) => REPORT_VIAS.includes(s.via))) notYet.push("fix-at-report-site");
  if (codes.some((c) => c.status !== "thrown" && c.status !== "reported")) notYet.push("trace-unthrown-codes");
  return { family: "diagnose-failure-codes", refused: null, codes, notYet };
}

// ---- the planner

/** Makes the plan. Reads only `ctx` and the read-only `code` view of the same checkout; writes nothing. */
export function planTaskV5(taskId: string, request: string, ctx: PlanContext, code: CodeRepo): PlanV5 {
  const base = planTaskV4(taskId, request, ctx, code);
  const d = diagnose(code, request);
  if (d.family === null) return { ...base, planner: PLANNER_V5, diagnosis: d }; // rule:diag-fallback-v4
  const tree = code.tree();
  const all = tree.ok ? tree.files : [];
  const sources: { path: string; symbol: string | null; reason: string }[] = [];
  for (const c of d.codes) for (const s of c.sites) {
    if (sources.length < MAX_SOURCES_V4 && !sources.some((x) => x.path === s.path)) sources.push({ path: s.path, symbol: s.symbol, reason: `${s.via === "reject" ? "rejects with" : REPORT_VIAS.includes(s.via) ? "catches and reports" : "throws"} ${c.code}${REPORT_VIAS.includes(s.via) ? ` (${s.via})` : ""}${s.match === "template-prefix" ? " (template)" : ""}` }); // rule:diag-plan-sites
  }
  const tests: TestPick[] = [];
  const named = namedTests(all, statedNames(request), new Set(sources.map((s) => packageDirOf(all, s.path))));
  for (const p of named) tests.push({ path: p, add: false, reason: "named by the request" });
  if (named.length === 0) for (const s of sources) {
    const t = testOf(code, s.path);
    if (t) { if (!tests.some((x) => x.path === t)) tests.push({ path: t, add: false, reason: `tests ${s.path}` }); continue; }
    const p = newTestPath(all, s.path);
    if (p && !tests.some((x) => x.path === p)) tests.push({ path: p, add: true, reason: `new test for ${s.path}` });
  }
  const steps: PlanStep[] = [];
  const push = (s: Omit<PlanStep, "n">) => steps.push({ n: steps.length + 1, ...s });
  for (const s of sources) push({ action: "edit-source", file: s.path, symbol: s.symbol, status: "missing", rule: null, objective: null, missing: "edit-existing-function" });
  if (tests.length === 0) push({ action: "add-test", file: null, symbol: null, status: "missing", rule: null, objective: null, missing: "add-test-file" });
  for (const t of tests) push({ action: t.add ? "add-test" : "edit-test", file: t.path, symbol: null, status: "missing", rule: null, objective: null, missing: t.add ? "add-test-file" : "extend-existing-test" });
  const { n: _v4n, ...runTests } = base.steps[base.steps.length - 1]!;
  push(runTests); // v4's run-tests step (same target check), renumbered after the diagnose steps
  const tc = testCommandFor(code, all, sources[0]?.path ?? null, tests.map((t) => t.path));
  return {
    ...base, planner: PLANNER_V5,
    understanding: { ...base.understanding, kind: "edit", testsOnly: false, scope: { names: d.codes.filter((c) => c.status === "thrown" || c.status === "reported").length, sources: sources.length, tests: tests.length } },
    files: [...sources.map((s) => ({ path: s.path, role: "source" as const, reason: s.reason })), ...tests.map((t) => ({ path: t.path, role: "test" as const, reason: t.reason }))],
    steps, tests: { files: tests.map((t) => t.path), command: tc.command },
    testCommand: { pm: tc.pm, runner: tc.runner, packageDir: tc.packageDir, form: tc.form },
    missingSkills: [...new Set(steps.map((s) => s.missing).filter((m): m is Capability => m !== null))],
    diagnosis: d,
  };
}
