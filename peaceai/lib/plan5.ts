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
// Batch 31: a code reported in a module-level `main().catch(fn)` on a function defined in the same file is planned at
// that function (`shape: "toplevel-catch"`); every other site is planned as before.
// Nothing here names a repository, task, task set or file of any task set, and no dev-set wording is matched.
// Read-only: the checkout is opened through codesearch.openRepo (readdir/stat/readFile only, nothing executed).
import { posix } from "node:path";
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
export const DIAG_NOT_YET = ["reproduce-reported-failure", "fix-at-throw-site", "fix-at-report-site", "trace-unthrown-codes", "fix-at-probable-cause"] as const;
export type DiagNotYet = (typeof DIAG_NOT_YET)[number];
export type DiagRefusal = "NO_FAILURE_REPORT" | "NO_CODES" | "NO_THROW_SITE";
/** How a site raises the code: thrown (M194), or caught and then reported (M195: logged, pushed into a problems array,
 *  or returned as a failed result, inside a catch block or a promise's rejection handler). */
export type SiteVia = "throw" | "reject" | "error-new" | "error-class" | "catch-log" | "catch-push" | "catch-result";
export const REPORT_VIAS: readonly SiteVia[] = ["catch-log", "catch-push", "catch-result"];
/** `token`: a literal holds the code as a whole token (or a name bound to it); `template-prefix`: a template literal
 *  builds it as `PREFIX_${x}` (M195). For a reported site, `line`/`symbol` are the try statement or promise chain whose
 *  failure is reported (where the fix belongs), not the logging line. */
export interface ThrowSite { path: string; line: number; symbol: string | null; via: SiteVia; match: "token" | "template-prefix"; shape?: "toplevel-catch" }
export interface ReportedCode { code: string; detail: string | null }
export interface DiagCode extends ReportedCode { status: "thrown" | "reported" | "not-thrown" | "ambiguous"; sites: ThrowSite[] }
/** `traces` (Batch 34, M198): one per site of a thrown or reported code, empty when the diagnosis is refused. */
export interface Diagnosis { family: "diagnose-failure-codes" | null; refused: DiagRefusal | null; codes: DiagCode[]; notYet: DiagNotYet[]; traces: SiteTrace[] }
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

/** Batch 31 (M195): a reported site that is a module-level `.catch(fn)` hung directly on a call to a function defined at
 *  the top level of the same file (`main().catch((e) => log(..))`). The call's failure is that function's failure, so the
 *  fix is planned at that function (`shape: "toplevel-catch"`, line and symbol of its declaration). Null otherwise (the
 *  site stays the `.catch` call, symbol null, as before). */
export function toplevelCatch(sf: ts.SourceFile, at: ts.Node): { symbol: string; line: number } | null {
  if (!ts.isCallExpression(at) || !ts.isPropertyAccessExpression(at.expression)) return null;
  let recv: ts.Expression = at.expression.expression;
  while (ts.isParenthesizedExpression(recv)) recv = recv.expression;
  const name = ts.isCallExpression(recv) ? nameOf(recv.expression) : null;
  if (at.expression.name.text !== "catch" || !ts.isCallExpression(recv) || !ts.isIdentifier(recv.expression)) return null; // rule:diag-toplevel-call
  if (ts.findAncestor(at.parent, (p) => ts.isFunctionLike(p) || ts.isClassLike(p))) return null; // rule:diag-toplevel-module
  if (!name) return null;
  const decl = sf.statements.find((st) => (ts.isFunctionDeclaration(st) && st.name?.text === name && !!st.body) || (ts.isVariableStatement(st) && st.declarationList.declarations.some((d) => ts.isIdentifier(d.name) && d.name.text === name && !!d.initializer && (ts.isArrowFunction(d.initializer) || ts.isFunctionExpression(d.initializer)))));
  if (!decl) return null; // rule:diag-toplevel-local
  return { symbol: name, line: sf.getLineAndCharacterOfPosition(decl.getStart(sf)).line + 1 };
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
    const top = REPORT_VIAS.includes(via) && enclosing(n) === null ? toplevelCatch(sf, n) : null;
    const line = top?.line ?? sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
    if (sites.some((s) => s.path === sf.fileName && s.line === line)) return;
    const site: ThrowSite = { path: sf.fileName, line, symbol: top?.symbol ?? enclosing(n), via, match, ...(top ? { shape: "toplevel-catch" as const } : {}) };
    siteNodes.set(site, { sf, node: n });
    sites.push(site);
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
  const refuse = (r: DiagRefusal, codes: DiagCode[] = []): Diagnosis => ({ family: null, refused: r, codes, notYet: [], traces: [] });
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
  const traces = traceDiagnosis(code, { family: "diagnose-failure-codes", refused: null, codes, notYet, traces: [] });
  if (traces.some((t) => t.causes.length > 0)) notYet.push("fix-at-probable-cause");
  return { family: "diagnose-failure-codes", refused: null, codes, notYet, traces };
}

// ---- Batch 34 (M198): symptom-to-cause trace (bounded, static, conservative)
// A planned site is often only the symptom: it throws or reports because an upstream value was bad or an upstream
// call failed. For each admitted site the trace looks for ONE producer in the same package: the function whose call
// result the site's `if` condition reads (`via: "value"`), or the one in-repo function that can fail inside the try
// block (or promise chain) whose failure the site rethrows or reports with its own code (`via: "caught"`). From that
// producer it follows plain delegation (every `return` hands back the result of the same in-repo call,
// `via: "delegate"`) up to MAX_TRACE_HOPS hops in all. Anything it cannot decide is an explicit stop code, never a
// guess. Causes become ranked `missing` edit-source steps placed above their symptom's step.

/** Most producers one trace follows (the first producer is hop 1). */
export const MAX_TRACE_HOPS = 2;
export type TraceStop = "TRACE_NO_CONDITION" | "TRACE_INDEPENDENT" | "TRACE_UNRESOLVED" | "TRACE_AMBIGUOUS" | "TRACE_CROSS_PACKAGE" | "TRACE_ALREADY_PLANNED" | "TRACE_DEPTH";
export interface TraceCause { path: string; line: number; symbol: string; hop: number; via: "value" | "caught" | "delegate" }
export interface SiteTrace { code: string; site: { path: string; line: number }; causes: TraceCause[]; stop: TraceStop | null }
/** The syntax node each site was found at (kept off the plan: a plan carries no syntax). */
const siteNodes = new WeakMap<ThrowSite, { sf: ts.SourceFile; node: ts.Node }>();

/** A function a call can resolve to: where it is declared, and its body (or expression body). */
interface Fn { path: string; symbol: string; line: number; body: ts.Node }
/** One producer a condition or try block depends on: an in-repo function, one in another workspace package, or an
 *  opaque call (a library, a global, a method on a value) keyed by its callee text. */
type Producer = { kind: "fn"; fn: Fn } | { kind: "cross"; key: string } | { kind: "opaque"; key: string };

const strip = (e: ts.Expression): ts.Expression => {
  let x = e;
  while (ts.isAwaitExpression(x) || ts.isParenthesizedExpression(x) || ts.isAsExpression(x) || ts.isNonNullExpression(x) || ts.isSatisfiesExpression(x) || ts.isTypeAssertionExpression(x)) x = x.expression;
  return x;
};
const fnBody = (n: ts.Node): ts.Node | null =>
  (ts.isFunctionDeclaration(n) || ts.isMethodDeclaration(n) || ts.isFunctionExpression(n) || ts.isArrowFunction(n)) && n.body ? n.body : null;
/** Every node under `n` that is not inside a nested function. */
function ownNodes(n: ts.Node, f: (x: ts.Node) => void): void {
  const visit = (x: ts.Node): void => { f(x); if (!ts.isFunctionLike(x)) ts.forEachChild(x, visit); }; // rule:trace-own-body
  ts.forEachChild(n, visit);
}
const lineOf = (sf: ts.SourceFile, n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;

/** A top-level function of `sf` named `name`: a function declaration with a body, or a const bound to an arrow or
 *  function expression. */
function topLevelFn(sf: ts.SourceFile, name: string): Fn | null {
  for (const st of sf.statements) {
    if (ts.isFunctionDeclaration(st) && st.name?.text === name && st.body) return { path: sf.fileName, symbol: name, line: lineOf(sf, st), body: st.body };
    if (ts.isVariableStatement(st)) for (const d of st.declarationList.declarations) {
      if (ts.isIdentifier(d.name) && d.name.text === name && d.initializer && (ts.isArrowFunction(d.initializer) || ts.isFunctionExpression(d.initializer))) return { path: sf.fileName, symbol: name, line: lineOf(sf, st), body: d.initializer.body };
    }
  }
  return null;
}

/** The repo file a relative specifier names (`./x`, `./x.js` for `x.ts`, `./x/index`), or null. */
function resolveRelative(all: ReadonlySet<string>, from: string, spec: string): string | null {
  const base = posix.normalize(posix.join(posix.dirname(from), spec));
  const stem = base.replace(/\.[cm]?[jt]sx?$/, "");
  for (const c of [base, ...[".ts", ".tsx", ".js", ".mjs", ".cjs", ".jsx", "/index.ts", "/index.js"].map((x) => stem + x)]) if (all.has(c)) return c;
  return null;
}

interface TraceEnv { code: CodeRepo; all: string[]; files: ReadonlySet<string>; pkgNames: string[]; sfOf: (p: string) => ts.SourceFile | null }

/** What `call` calls: a function of the same file, a named import / destructured require of a relative module, or
 *  `this.m()` on a method of the enclosing class; a bare specifier naming a workspace package is `cross`; anything
 *  else is `opaque`. */
function resolveCall(env: TraceEnv, sf: ts.SourceFile, call: ts.CallExpression): Producer {
  const callee = call.expression;
  const opaque: Producer = { kind: "opaque", key: callee.getText(sf) };
  if (ts.isPropertyAccessExpression(callee) && callee.expression.kind === ts.SyntaxKind.ThisKeyword) { // rule:trace-resolve-this
    const cls = ts.findAncestor(call, ts.isClassLike);
    const named = cls?.members.find((x) => (ts.isMethodDeclaration(x) || ts.isPropertyDeclaration(x)) && !!x.name && ts.isIdentifier(x.name) && x.name.text === callee.name.text);
    const body = named && ts.isMethodDeclaration(named) ? named.body : named && ts.isPropertyDeclaration(named) && named.initializer && (ts.isArrowFunction(named.initializer) || ts.isFunctionExpression(named.initializer)) ? named.initializer.body : undefined;
    return named && body ? { kind: "fn", fn: { path: sf.fileName, symbol: callee.name.text, line: lineOf(sf, named), body } } : opaque;
  }
  if (!ts.isIdentifier(callee)) return opaque;
  const local = topLevelFn(sf, callee.text);
  if (local) return { kind: "fn", fn: local };
  // where the name is bound: `import { g as f } from "spec"` or `const { g: f } = require("spec")`
  let spec: string | null = null;
  let exported = callee.text;
  for (const st of sf.statements) {
    if (ts.isImportDeclaration(st) && ts.isStringLiteral(st.moduleSpecifier) && !st.importClause?.isTypeOnly) {
      const nb = st.importClause?.namedBindings;
      const el = nb && ts.isNamedImports(nb) ? nb.elements.find((e) => e.name.text === callee.text && !e.isTypeOnly) : undefined;
      if (el) { spec = st.moduleSpecifier.text; exported = el.propertyName?.text ?? el.name.text; }
    }
    if (ts.isVariableStatement(st)) for (const d of st.declarationList.declarations) {
      const init = d.initializer && strip(d.initializer);
      if (!init || !ts.isCallExpression(init) || !ts.isIdentifier(init.expression) || init.expression.text !== "require" || !init.arguments[0] || !ts.isStringLiteral(init.arguments[0]) || !ts.isObjectBindingPattern(d.name)) continue;
      const el = d.name.elements.find((e) => ts.isIdentifier(e.name) && e.name.text === callee.text);
      if (el) { spec = init.arguments[0].text; exported = el.propertyName && ts.isIdentifier(el.propertyName) ? el.propertyName.text : callee.text; }
    }
  }
  if (spec === null) return opaque;
  if (!spec.startsWith(".")) return env.pkgNames.some((n) => spec === n || spec!.startsWith(`${n}/`)) ? { kind: "cross", key: spec } : opaque; // rule:trace-workspace-name
  const target = resolveRelative(env.files, sf.fileName, spec); // rule:trace-resolve-import
  const tsf = target && isSourceFile(target) ? env.sfOf(target) : null;
  const fn = tsf ? topLevelFn(tsf, exported) : null;
  return fn ? { kind: "fn", fn } : opaque;
}

/** A function whose own body can fail: it throws, rejects, constructs an Error, awaits (a rejection propagates), or
 *  returns a call (delegation). A function doing none of these (a pure helper) is not a producer of a caught failure. */
function canFail(fn: Fn): boolean {
  let yes = !ts.isBlock(fn.body) && ts.isCallExpression(strip(fn.body as ts.Expression));
  const visit = (x: ts.Node): void => {
    if (ts.isThrowStatement(x) || ts.isAwaitExpression(x) || (ts.isNewExpression(x) && ERRORISH.test(nameOf(x.expression) ?? "")) || (ts.isCallExpression(x) && nameOf(x.expression) === "reject") || (ts.isReturnStatement(x) && !!x.expression && ts.isCallExpression(strip(x.expression)))) yes = true;
    ts.forEachChild(x, visit);
  };
  visit(fn.body);
  return yes;
}

/** The const-bound call whose result `id` holds, in the function around `at` and declared before it (also through
 *  `const { a } = call()` / `const [a] = call()`); null for a parameter, a `let`, a catch variable or a non-call value. */
function boundCall(id: ts.Identifier, at: ts.Node): ts.CallExpression | null {
  const fn = ts.findAncestor(at, ts.isFunctionLike);
  const scope = fn ? fnBody(fn) : at.getSourceFile();
  if (!scope) return null;
  let found: ts.CallExpression | null = null;
  const binds = (n: ts.BindingName): boolean => ts.isIdentifier(n) ? n.text === id.text : n.elements.some((e) => !ts.isOmittedExpression(e) && binds(e.name));
  ownNodes(scope, (x) => {
    if (found || !ts.isVariableDeclaration(x) || x.getStart() >= at.getStart() || !x.initializer) return;
    if (!(ts.getCombinedNodeFlags(x) & ts.NodeFlags.Const) || !binds(x.name)) return;
    const init = strip(x.initializer);
    if (ts.isCallExpression(init)) found = init;
  });
  return found;
}

/** Calls the condition reads a value of: a const-bound call result named in it (also inside a predicate's
 *  arguments), or a call used as a receiver (`load().length`). A predicate call itself (`isValid(x)`) is not a producer. */
function conditionCalls(cond: ts.Expression): ts.CallExpression[] {
  const out: ts.CallExpression[] = [];
  const visit = (x: ts.Node): void => {
    if (ts.isIdentifier(x) && !(ts.isPropertyAccessExpression(x.parent) && x.parent.name === x) && !(ts.isCallExpression(x.parent) && x.parent.expression === x)) {
      const c = boundCall(x, cond);
      if (c && !out.includes(c)) out.push(c);
    }
    if ((ts.isPropertyAccessExpression(x) || ts.isElementAccessExpression(x)) && ts.isCallExpression(strip(x.expression))) out.push(strip(x.expression) as ts.CallExpression);
    if (!ts.isFunctionLike(x)) ts.forEachChild(x, visit);
  };
  visit(cond);
  return out;
}

const keyOf = (p: Producer) => (p.kind === "fn" ? `${p.fn.path}#${p.fn.symbol}` : `${p.kind}:${p.key}`);

/** The producers of one site, with the hop-1 via, or a stop. */
function siteProducers(env: TraceEnv, sf: ts.SourceFile, node: ts.Node, via: SiteVia): { via: "value" | "caught"; producers: Producer[] } | TraceStop {
  const fromCalls = (v: "value" | "caught", calls: ts.CallExpression[], keep: (p: Producer) => boolean) => {
    const seen = new Map<string, Producer>();
    for (const c of calls) { const p = resolveCall(env, sf, c); if (keep(p) && !seen.has(keyOf(p))) seen.set(keyOf(p), p); }
    return { via: v, producers: [...seen.values()] };
  };
  // calls in a try block (or a promise receiver) that can fail: in-repo functions that can fail, other packages'
  // functions, and awaited opaque calls (I/O); a sync library call is not counted (see the soundness note)
  const failing = (calls: ts.CallExpression[]) => fromCalls("caught", calls, (p) => p.kind === "cross" || (p.kind === "fn" ? canFail(p.fn) : false)); // rule:trace-can-fail
  const awaited = (calls: ts.CallExpression[]) => calls.filter((c) => ts.isAwaitExpression(c.parent) || ts.isReturnStatement(c.parent));
  const tryCalls = (block: ts.Block) => { const cs: ts.CallExpression[] = []; ownNodes(block, (x) => { if (ts.isCallExpression(x)) cs.push(x); }); return cs; };
  const caughtTrace = (calls: ts.CallExpression[]) => {
    const r = failing(calls);
    const io = fromCalls("caught", awaited(calls), (p) => p.kind === "opaque");
    return { via: "caught" as const, producers: [...r.producers, ...io.producers] };
  };
  if (REPORT_VIAS.includes(via)) {
    if (ts.isTryStatement(node)) return caughtTrace(tryCalls(node.tryBlock)); // rule:trace-caught
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      let recv = strip(node.expression.expression);
      while (ts.isCallExpression(recv) && ts.isPropertyAccessExpression(recv.expression) && /^(?:then|catch|finally)$/.test(recv.expression.name.text)) recv = strip(recv.expression.expression);
      const base = ts.isCallExpression(recv) ? recv : ts.isIdentifier(recv) ? boundCall(recv, node) : null;
      return base ? fromCalls("caught", [base], () => true) : "TRACE_NO_CONDITION";
    }
    return "TRACE_NO_CONDITION";
  }
  let cond: ts.Expression | null = null;
  let tryStmt: ts.TryStatement | null = null;
  for (let cur: ts.Node = node, p = node.parent; p && !ts.isFunctionLike(p) && !ts.isSourceFile(p); cur = p, p = p.parent) {
    if (!cond && ts.isIfStatement(p) && cur !== p.expression) cond = p.expression; // rule:trace-condition
    if (!tryStmt && ts.isCatchClause(p)) tryStmt = p.parent; // rule:trace-rethrow
  }
  const valued = cond ? fromCalls("value", conditionCalls(cond), () => true) : null;
  if (valued && valued.producers.length > 0) return valued; // rule:trace-depends
  if (tryStmt) return caughtTrace(tryCalls(tryStmt.tryBlock));
  return cond ? "TRACE_INDEPENDENT" : "TRACE_NO_CONDITION";
}

/** The one in-repo function every `return` of `fn` hands back the result of (`return g(..)`, `return await g(..)`,
 *  or a const bound to such a call): a delegate. null when some return is not a call result. */
function delegate(env: TraceEnv, fn: Fn): Producer | "AMBIGUOUS" | null {
  const sf = env.sfOf(fn.path);
  if (!sf) return null;
  const rets: ts.Expression[] = [];
  if (!ts.isBlock(fn.body)) rets.push(fn.body as ts.Expression);
  else ownNodes(fn.body, (x) => { if (ts.isReturnStatement(x) && x.expression) rets.push(x.expression); });
  if (rets.length === 0) return null;
  const ps = new Map<string, Producer>();
  for (const r of rets) {
    const e = strip(r);
    const call = ts.isCallExpression(e) ? e : ts.isIdentifier(e) ? boundCall(e, r) : null;
    if (!call) return null; // rule:trace-delegate-all
    const p = resolveCall(env, sf, call);
    ps.set(keyOf(p), p);
  }
  return ps.size > 1 ? "AMBIGUOUS" : ([...ps.values()][0] ?? null);
}

/** The trace of one site: causes in rank order (hop 1 first), and why it stopped (null: it ran out of in-repo producers). */
export function traceSite(env: TraceEnv, code: string, site: ThrowSite, planned: ReadonlySet<string>): SiteTrace {
  const out: SiteTrace = { code, site: { path: site.path, line: site.line }, causes: [], stop: null };
  const at = siteNodes.get(site);
  if (!at) return { ...out, stop: "TRACE_NO_CONDITION" };
  const first = siteProducers(env, at.sf, at.node, site.via);
  if (typeof first === "string") return { ...out, stop: first };
  if (first.producers.length > 1) return { ...out, stop: "TRACE_AMBIGUOUS" }; // rule:trace-unique
  if (first.producers.length === 0) return { ...out, stop: "TRACE_INDEPENDENT" };
  const own = packageDirOf(env.all, site.path);
  let p: Producer = first.producers[0]!;
  let via: TraceCause["via"] = first.via;
  for (let hop = 1; ; hop++) {
    if (p.kind === "opaque") return { ...out, stop: hop === 1 ? "TRACE_UNRESOLVED" : null };
    if (hop > MAX_TRACE_HOPS) return { ...out, stop: "TRACE_DEPTH" }; // rule:trace-depth
    if (p.kind === "cross" || packageDirOf(env.all, p.fn.path) !== own) return { ...out, stop: "TRACE_CROSS_PACKAGE" }; // rule:trace-same-package
    const key = `${p.fn.path}#${p.fn.symbol}`;
    if (planned.has(key) || out.causes.some((c) => `${c.path}#${c.symbol}` === key)) return { ...out, stop: hop === 1 ? "TRACE_ALREADY_PLANNED" : null }; // rule:trace-not-planned
    out.causes.push({ path: p.fn.path, line: p.fn.line, symbol: p.fn.symbol, hop, via });
    const next = delegate(env, p.fn); // rule:trace-delegate
    if (next === null) return out;
    if (next === "AMBIGUOUS") return { ...out, stop: "TRACE_AMBIGUOUS" };
    p = next;
    via = "delegate";
  }
}

/** The traces of every site of every thrown or reported code (empty for a refused diagnosis). */
export function traceDiagnosis(code: CodeRepo, d: Diagnosis): SiteTrace[] {
  if (d.family === null) return [];
  const tree = code.tree();
  const all = tree.ok ? tree.files : [];
  const parsed = new Map<string, ts.SourceFile | null>();
  const pkgNames: string[] = [];
  for (const f of all.filter((x) => posix.basename(x) === "package.json")) {
    const r = code.read(f);
    try { const n = r.ok ? JSON.parse(r.text).name : null; if (typeof n === "string" && n) pkgNames.push(n); } catch { /* not a manifest */ }
  }
  const env: TraceEnv = { code, all, files: new Set(all), pkgNames, sfOf: (p) => { if (!parsed.has(p)) parsed.set(p, parse(code, p)); return parsed.get(p)!; } };
  const planned = new Set(d.codes.flatMap((c) => c.sites.filter((s) => s.symbol).map((s) => `${s.path}#${s.symbol}`)));
  return d.codes.flatMap((c) => c.sites.map((s) => traceSite(env, c.code, s, planned)));
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
    if (sources.length < MAX_SOURCES_V4 && !sources.some((x) => x.path === s.path)) sources.push({ path: s.path, symbol: s.symbol, reason: `${s.via === "reject" ? "rejects with" : REPORT_VIAS.includes(s.via) ? "catches and reports" : "throws"} ${c.code}${REPORT_VIAS.includes(s.via) ? ` (${s.via}${s.shape ? `, ${s.shape}` : ""})` : ""}${s.match === "template-prefix" ? " (template)" : ""}` }); // rule:diag-plan-sites
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
  // Batch 34 (M198): each traced cause is a ranked edit-source step above its symptom's step (hop 1 first); a cause in
  // a new file adds that file (role source) while the source cap allows, a cause already stepped is not repeated.
  const causeFiles: { path: string; reason: string }[] = [];
  const stepped = new Set(sources.map((s) => `${s.path}#${s.symbol}`));
  const causesOf = (path: string) => d.traces.filter((t) => t.site.path === path).flatMap((t) => t.causes.map((c) => ({ c, code: t.code })));
  const steps: PlanStep[] = [];
  const push = (s: Omit<PlanStep, "n">) => steps.push({ n: steps.length + 1, ...s });
  for (const s of sources) {
    for (const { c, code: k } of causesOf(s.path)) { // rule:trace-plan-cause
      const known = sources.some((x) => x.path === c.path) || causeFiles.some((x) => x.path === c.path);
      if (stepped.has(`${c.path}#${c.symbol}`) || (!known && sources.length + causeFiles.length >= MAX_SOURCES_V4)) continue;
      stepped.add(`${c.path}#${c.symbol}`);
      if (!known) causeFiles.push({ path: c.path, reason: `probable cause of ${k} (${c.via}, hop ${c.hop})` });
      push({ action: "edit-source", file: c.path, symbol: c.symbol, status: "missing", rule: null, objective: null, missing: "edit-existing-function" });
    }
    push({ action: "edit-source", file: s.path, symbol: s.symbol, status: "missing", rule: null, objective: null, missing: "edit-existing-function" });
  }
  if (tests.length === 0) push({ action: "add-test", file: null, symbol: null, status: "missing", rule: null, objective: null, missing: "add-test-file" });
  for (const t of tests) push({ action: t.add ? "add-test" : "edit-test", file: t.path, symbol: null, status: "missing", rule: null, objective: null, missing: t.add ? "add-test-file" : "extend-existing-test" });
  const { n: _v4n, ...runTests } = base.steps[base.steps.length - 1]!;
  push(runTests); // v4's run-tests step (same target check), renumbered after the diagnose steps
  const tc = testCommandFor(code, all, sources[0]?.path ?? null, tests.map((t) => t.path));
  return {
    ...base, planner: PLANNER_V5,
    understanding: { ...base.understanding, kind: "edit", testsOnly: false, scope: { names: d.codes.filter((c) => c.status === "thrown" || c.status === "reported").length, sources: sources.length + causeFiles.length, tests: tests.length } },
    files: [...sources.map((s) => ({ path: s.path, role: "source" as const, reason: s.reason })), ...causeFiles.map((s) => ({ path: s.path, role: "source" as const, reason: s.reason })), ...tests.map((t) => ({ path: t.path, role: "test" as const, reason: t.reason }))],
    steps, tests: { files: tests.map((t) => t.path), command: tc.command },
    testCommand: { pm: tc.pm, runner: tc.runner, packageDir: tc.packageDir, form: tc.form },
    missingSkills: [...new Set(steps.map((s) => s.missing).filter((m): m is Capability => m !== null))],
    diagnosis: d,
  };
}
