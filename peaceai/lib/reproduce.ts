// REPRODUCE-REPORTED-FAILURE v1 (M196, Batch 30; spec peaceai/spec/reproduce-v1.md). EXPERIMENTAL and PLAN-ONLY.
// Given one v5 diagnosis site (plan5.ts: a code, the file, the enclosing function and the shape it leaves by: thrown,
// logged, pushed or returned), writes a CANDIDATE regression test in the repo's own runner (node:test, vitest, jest or
// mocha, picked by loopdeps.detectRunner as the loop picks it) that drives the enclosing function with one of its
// injected dependencies failing and asserts the reported code is NOT produced. The test is built from an existing test
// of the same module (its imports, setup, hooks and the call it already makes), never from a template of its own.
// A candidate is kept only when, run as the stage-2 candidate uid in the loop's isolation (no network):
//   repro    (dependency failing, asserts the code is NOT produced) FAILS        else REPRO_NOT_FAILING / REPRO_WRONG_REASON
//   probe    (dependency failing, asserts the code IS produced)     PASSES       else REPRO_WRONG_REASON (load error, setup
//            error, the failure never reached the site or was never observed)
//   control  (no dependency failing, asserts the code is NOT produced) PASSES   else REPRO_VACUOUS (the code is produced
//            whatever the dependency does: the test cannot tell a fix from no fix)
// NOT FOR CREDIT: nothing here is imported by the loop, its grading, m119's credit sources or selfpropose.ts; the test
// is written only to the output dir, never into the checkout. Using such tests for credit needs a separate reviewed
// design (a self-written test can be vacuous in ways three runs do not rule out). Each condition is one line tagged
// `repro-guard:<id>`; M196 removes each in turn and requires a case to fail.
// Batch 32: more than one existing test may call the entry, and the first one found may never reach the site (an
// early return, an option that skips the dependency). planRepros builds one candidate per usable existing test and
// ranks them statically (setup naming the failing dependency, then the module's own test file, then discovery
// order); reproduce tries at most MAX_ATTEMPTS of them in that order, each with the full three-variant judge on its
// own three runs, and stops at the first REPRO_OK. Every attempt is recorded; evidence is never pooled across attempts.
// Batch 33: a base whose own setup already makes the failing dependency throw or reject (the test itself injects the
// failure) is ranked BELOW the others: the control variant would then also see the code, so the candidate is predicted
// REPRO_VACUOUS. Ranking still never decides a result; detection is static and conservative (when unsure, do not demote).
// Nothing here names a repository, task, task set or file of any task set.
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, posix } from "node:path";
import ts from "typescript";
import { isGeneratedPath, isTestPath, openRepo, resolveSpecifier, type CodeRepo } from "./codesearch.ts";
import { isolationProblem, runnerWrapper, type Copy } from "./loop.ts";
import { detectRunner, installDeps, installShim, openDepsCache, openWorkDir, shimArgs, type DepsOptions, type RunnerPick } from "./loopdeps.ts";
import { fileStem, isBehaviorTest, isSourceFile } from "./plan4.ts";
import { caughtBy, REPORT_VIAS, templatePrefix, type ThrowSite } from "./plan5.ts";
import { guardedRun, stage2CandUid, type CandUid, type RawRun } from "./selfpropose.ts";

export const REPRO_VERSION = "reproduce-v1" as const;
export const REPRO_REFUSALS = [
  "REPRO_NO_DIAGNOSIS", "REPRO_TEST_TARGET", "REPRO_NO_ENTRY", "REPRO_NO_TRIGGER", "REPRO_NO_OBSERVE", "REPRO_NO_EXISTING_TEST",
  "REPRO_RUNNER", "REPRO_ISOLATION", "REPRO_DEPS", "REPRO_NOT_FAILING", "REPRO_WRONG_REASON", "REPRO_VACUOUS",
] as const;
export type ReproRefusal = (typeof REPRO_REFUSALS)[number];
export type ReproCode = "REPRO_OK" | ReproRefusal;
export type Channel = "thrown" | "logged" | "pushed" | "returned";
export const VARIANTS = ["repro", "probe", "control"] as const;
export type Variant = (typeof VARIANTS)[number];

export interface Trigger { param: number; prop: string | null; reject: boolean; callee: string }
/** Batch 32/33: why a base test is ranked where it is (static; it never decides a result, the judge does). */
export interface BaseRank {
  /** Batch 33: its own setup already makes the failing dependency throw or reject (predicted REPRO_VACUOUS). Ranked below others. */
  setupInjectsFailure: boolean;
  /** Its setup provides or names the failing dependency (the trigger's property, or a non-null argument for a called parameter). */
  namesDependency: boolean;
  /** It is the module's own test file (same file stem as the site's file). */
  ownFile: boolean;
  /** Discovery order (related tests first, then the rest sorted; calls in file order). */
  found: number;
}
export interface ReproPlan {
  version: typeof REPRO_VERSION;
  code: string;
  site: ThrowSite;
  channel: Channel;
  entry: { name: string; path: string };
  trigger: Trigger;
  /** The entry's parameter index of the logger the code is logged through (null: console / process streams). */
  logParam: number | null;
  existing: { path: string; line: number };
  runner: RunnerPick;
  /** Repo-relative path the candidate test is run at (beside the existing test; removed after each run). */
  testPath: string;
  /** node:test only: the package's test script runs through tsx and tsx is a dependency, so node gets `--import tsx`. */
  tsxImport: boolean;
  variants: Record<Variant, string>;
  rank: BaseRank;
}
export type PlanResult = ReproPlan | { refuse: ReproRefusal; detail?: string };
export type PlansResult = { plans: ReproPlan[] } | { refuse: ReproRefusal; detail?: string };
/** Batch 32: at most this many base tests are run (each attempt is a sandbox copy and three runs). */
export const MAX_ATTEMPTS = 3;

const CODE_SHAPE = /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+$/;
const TESTISH = new Set(["test", "it", "describe", "suite", "context", "specify", "bench", "xit", "xdescribe", "fit", "fdescribe", "xtest"]);
const MAX_FILE = 1 << 20;
/** Methods of plain data (arrays, strings) a parameter is read with; calling one is not a dependency call. */
const DATA_METHODS = new Set(["map", "filter", "forEach", "reduce", "reduceRight", "find", "findIndex", "findLast", "some", "every", "flatMap", "flat", "includes", "indexOf", "lastIndexOf", "slice", "join", "split", "trim", "trimStart", "trimEnd", "toLowerCase", "toUpperCase", "startsWith", "endsWith", "replace", "replaceAll", "concat", "at", "keys", "values", "entries", "sort", "toString", "padStart", "padEnd"]);
const MAX_TESTS_SCANNED = 400;

const lineOf = (sf: ts.SourceFile, n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
const endLineOf = (sf: ts.SourceFile, n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getEnd()).line + 1;
const parse = (path: string, text: string) => ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, path.endsWith("x") ? ts.ScriptKind.TSX : /\.[cm]?js$/.test(path) ? ts.ScriptKind.JS : ts.ScriptKind.TS);
const word = (code: string) => new RegExp(`(?<![A-Za-z0-9_])${code}(?![A-Za-z0-9_])`);
/** The text names the code: as a whole token, or (template-prefix sites) through its boundary-safe prefix. */
const names = (text: string, code: string, prefix: string | null) => word(code).test(text) || (prefix !== null && text.includes(prefix));
const readSmall = (root: string, p: string): string | null => { try { const f = join(root, p); return statSync(f).size <= MAX_FILE ? readFileSync(f, "utf8") : null; } catch { return null; } };
const mods = (n: ts.Node) => (ts.canHaveModifiers(n) ? ts.getModifiers(n) ?? [] : []);
const exported = (n: ts.Node) => mods(n).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
const rootIdent = (e: ts.Expression): ts.Identifier | null => {
  let x: ts.Expression = e;
  while (ts.isCallExpression(x) || ts.isPropertyAccessExpression(x) || ts.isElementAccessExpression(x) || ts.isNonNullExpression(x) || ts.isParenthesizedExpression(x)) x = x.expression;
  return ts.isIdentifier(x) ? x : null;
};
const isTestish = (st: ts.Statement) => ts.isExpressionStatement(st) && ts.isCallExpression(st.expression) && TESTISH.has(rootIdent(st.expression.expression)?.text ?? "");

/** The try statement or promise chain that catches the failure at `site`, its guarded part and its handler. */
interface Region { at: ts.Node; guarded: ts.Node; handler: ts.Node; chain: boolean }
function regionAt(at: ts.Node): Region | null {
  if (ts.isTryStatement(at) && at.catchClause) return { at, guarded: at.tryBlock, handler: at.catchClause.block, chain: false };
  if (ts.isCallExpression(at) && ts.isPropertyAccessExpression(at.expression)) {
    const h = at.expression.name.text === "catch" ? at.arguments[0] : at.expression.name.text === "then" ? at.arguments[1] : undefined;
    if (h && ts.isFunctionLike(h)) return { at, guarded: at.expression.expression, handler: h, chain: true };
  }
  return null;
}
function findRegion(sf: ts.SourceFile, code: string, site: ThrowSite): Region | ReproRefusal {
  const prefix = site.match === "template-prefix" ? templatePrefix(code) : null;
  let found: Region | null = null;
  if (REPORT_VIAS.includes(site.via)) {
    const visit = (n: ts.Node): void => {
      if (found) return;
      if ((ts.isTryStatement(n) || ts.isCallExpression(n)) && lineOf(sf, n) === site.line) {
        const r = regionAt(n);
        if (r && names(r.handler.getText(sf), code, prefix)) { found = r; return; }
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
    return found ?? "REPRO_NO_DIAGNOSIS";
  }
  // a thrown code: the innermost throw / reject / new Error spanning the site line that names the code
  let best: ts.Node | null = null;
  const visit = (n: ts.Node): void => {
    if ((ts.isThrowStatement(n) || ts.isCallExpression(n) || ts.isNewExpression(n)) && lineOf(sf, n) <= site.line && endLineOf(sf, n) >= site.line && names(n.getText(sf), code, prefix)) {
      if (!best || n.getWidth(sf) <= best.getWidth(sf)) best = n;
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  if (!best) return "REPRO_NO_DIAGNOSIS";
  // only a throw inside a catch (a dependency's failure turned into the code) has a trigger a test can inject;
  // a throw on data the function computes is data-conditional and v1 does not guess the input that reaches it
  const at = caughtBy(best);
  if (!at) return "REPRO_NO_TRIGGER"; // repro-guard:throw-caught
  return regionAt(at) ?? "REPRO_NO_TRIGGER";
}

/** The top-level exported function (declaration or const arrow / function expression) named `name` that `n` is directly in. */
function entryOf(sf: ts.SourceFile, n: ts.Node, name: string | null): ts.SignatureDeclaration | null {
  const fn = ts.findAncestor(n.parent, ts.isFunctionLike) as ts.SignatureDeclaration | undefined;
  if (!fn || !name) return null;
  let top: ts.Node | null = null;
  if (ts.isFunctionDeclaration(fn) && fn.name?.text === name && ts.isSourceFile(fn.parent)) top = fn;
  if ((ts.isArrowFunction(fn) || ts.isFunctionExpression(fn)) && ts.isVariableDeclaration(fn.parent) && fn.parent.initializer === fn && ts.isIdentifier(fn.parent.name) && fn.parent.name.text === name) {
    const st = fn.parent.parent?.parent;
    if (st && ts.isVariableStatement(st) && ts.isSourceFile(st.parent)) top = st;
  }
  if (!top) return null; // repro-guard:entry-direct
  if (!(exported(top) || cjsExports(sf).has(name))) return null; // repro-guard:entry-exported
  return fn;
}
/** Names a CommonJS file exports: `module.exports = { a, b: b }`, `exports.a = ..`, `module.exports.a = ..`. */
function cjsExports(sf: ts.SourceFile): Set<string> {
  const out = new Set<string>();
  for (const st of sf.statements) {
    if (!ts.isExpressionStatement(st) || !ts.isBinaryExpression(st.expression) || st.expression.operatorToken.kind !== ts.SyntaxKind.EqualsToken) continue;
    const l = st.expression.left.getText(sf), r = st.expression.right;
    if (l === "module.exports" && ts.isObjectLiteralExpression(r)) for (const p of r.properties) { if (ts.isShorthandPropertyAssignment(p)) out.add(p.name.text); else if (ts.isPropertyAssignment(p) && ts.isIdentifier(p.name)) out.add(p.name.text); }
    const m = /^(?:module\.)?exports\.([A-Za-z_$][\w$]*)$/.exec(l);
    if (m) out.add(m[1]!);
  }
  return out;
}

/** `p(..)`, `p.m(..)` or a destructured `{ m }` param called: which parameter, which property. */
function paramCallee(e: ts.Expression, fn: ts.SignatureDeclaration): { param: number; prop: string | null } | null {
  const ps = fn.parameters;
  if (ts.isIdentifier(e)) {
    for (let i = 0; i < ps.length; i++) {
      const nm = ps[i]!.name;
      if (ts.isIdentifier(nm) && nm.text === e.text) return { param: i, prop: null };
      if (ts.isObjectBindingPattern(nm)) for (const el of nm.elements) if (!el.dotDotDotToken && ts.isIdentifier(el.name) && el.name.text === e.text) {
        const key = el.propertyName ? (ts.isIdentifier(el.propertyName) || ts.isStringLiteral(el.propertyName) ? el.propertyName.text : null) : el.name.text;
        return key ? { param: i, prop: key } : null;
      }
    }
    return null;
  }
  if (ts.isPropertyAccessExpression(e) && ts.isIdentifier(e.expression)) {
    const i = ps.findIndex((p) => ts.isIdentifier(p.name) && p.name.text === (e.expression as ts.Identifier).text);
    return i >= 0 ? { param: i, prop: e.name.text } : null;
  }
  return null;
}
/** A call whose own failure is handled right there (`x().catch(..)`, `x().then(a, b)`), so it cannot reach the site. */
const handledLocally = (c: ts.CallExpression): boolean => {
  const pa = c.parent;
  if (!pa || !ts.isPropertyAccessExpression(pa) || pa.expression !== c || !ts.isCallExpression(pa.parent) || pa.parent.expression !== pa) return false;
  return pa.name.text === "catch" || (pa.name.text === "then" && pa.parent.arguments.length >= 2);
};
/** The first call in the guarded part to an injected dependency (a parameter): its failure is what the site reports. */
function triggerIn(sf: ts.SourceFile, r: Region, fn: ts.SignatureDeclaration): Trigger | null {
  let found: Trigger | null = null;
  const visit = (n: ts.Node): void => {
    if (found) return;
    if (n !== r.guarded && ts.isFunctionLike(n)) return; // repro-guard:trigger-no-nested-fn (a callback may never run)
    if (n !== r.guarded && ts.isTryStatement(n)) return; // repro-guard:trigger-no-inner-try (an inner catch takes the failure)
    if (ts.isCallExpression(n) && !(n !== r.guarded && handledLocally(n))) { // repro-guard:trigger-handled
      const t = paramCallee(n.expression, fn); // repro-guard:trigger-param
      // a data parameter's own method (`ids.map(..)`, `name.trim()`) is not a dependency that can fail
      if (t && t.prop !== null && DATA_METHODS.has(t.prop)) { ts.forEachChild(n, visit); return; } // repro-guard:trigger-not-builtin
      if (t) { found = { ...t, reject: r.chain || ts.isAwaitExpression(n.parent), callee: n.expression.getText(sf) }; return; }
    }
    ts.forEachChild(n, visit);
  };
  visit(r.guarded);
  return found;
}

/** How the test sees the code. Null: the code goes where the test cannot look (an imported logger, a module-level list). */
function observeOf(sf: ts.SourceFile, code: string, site: ThrowSite, r: Region, fn: ts.SignatureDeclaration): { channel: Channel; logParam: number | null } | null {
  if (!REPORT_VIAS.includes(site.via)) return { channel: "thrown", logParam: null };
  if (site.via === "catch-result") return { channel: "returned", logParam: null };
  const prefix = site.match === "template-prefix" ? templatePrefix(code) : null;
  let call: ts.CallExpression | null = null;
  const visit = (n: ts.Node): void => {
    if (call) return;
    if (ts.isCallExpression(n) && n.arguments.some((a) => names(a.getText(sf), code, prefix))) { call = n; return; }
    ts.forEachChild(n, visit);
  };
  visit(r.handler);
  if (!call) return null;
  const callee = (call as ts.CallExpression).expression;
  const paramIdx = (id: ts.Identifier | null) => (id ? fn.parameters.findIndex((p) => ts.isIdentifier(p.name) && p.name.text === id.text) : -1);
  if (site.via === "catch-log") {
    const recv = ts.isPropertyAccessExpression(callee) ? callee.expression : callee;
    const t = recv.getText(sf);
    if (t === "console" || t === "process.stderr" || t === "process.stdout") return { channel: "logged", logParam: null };
    const i = ts.isIdentifier(recv) ? paramIdx(recv) : -1;
    return i >= 0 ? { channel: "logged", logParam: i } : null; // repro-guard:observe-log (an imported or module-level logger is not seen)
  }
  // catch-push: the list must be the function's own (returned or a parameter's), not module state
  if (!ts.isPropertyAccessExpression(callee)) return null;
  const id = rootIdent(callee.expression);
  const local = (x: ts.Identifier) => { let ok = false; const v = (n: ts.Node): void => { if (ok) return; if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === x.text && ts.findAncestor(n, ts.isFunctionLike) === fn) ok = true; ts.forEachChild(n, v); }; const b = (fn as ts.FunctionLikeDeclaration).body; if (b) v(b); return ok; };
  return id && (paramIdx(id) >= 0 || local(id)) ? { channel: "pushed", logParam: null } : null; // repro-guard:observe-push
}

/** An existing test of the entry: the binding it imports it by, the call it makes inside a plain test callback, either
 *  directly or (Batch 31) inside ONE async callback passed to a helper the test file defines or imports from a relative
 *  path (`await withX(async (d) => { .. entry(..) .. })`). `blocks` is the path to the call in the innermost body (the
 *  helper's callback when there is one); `helper.outer` is the path to the helper call in the test body. */
interface Helper { call: ts.CallExpression; cb: ts.ArrowFunction | ts.FunctionExpression; outer: ts.Block[] }
interface Existing { path: string; sf: ts.SourceFile; local: string; call: ts.CallExpression; cb: ts.FunctionLikeDeclaration; testCall: ts.CallExpression; describes: ts.CallExpression[]; blocks: ts.Block[]; helper: Helper | null }
/** Why a call of the entry in a test file is not usable (fixed vocabulary; the REPRO_NO_EXISTING_TEST detail). */
export const EXISTING_MISSES = ["not-in-test", "args", "path", "unknown-helper", "nested-callback", "sync-callback"] as const;
export type ExistingMiss = (typeof EXISTING_MISSES)[number];
/** The blocks from the test callback's body down to the call's statement: the body, then only the try block of a
 *  try / finally (no catch: a catch in the test could swallow the candidate's own throw). The call's statement is
 *  directly in the last block (not under an if, a loop or a nested callback). Null: not such a path. */
function blocksTo(call: ts.Node, body: ts.Block): ts.Block[] | null {
  const out: ts.Block[] = [];
  let s: ts.Node = call;
  for (;;) {
    // up through expressions only, to the statement that sits directly in a block
    let st: ts.Node = s;
    while (st.parent && !ts.isBlock(st.parent)) {
      if (ts.isStatement(st) || ts.isFunctionLike(st.parent)) return null;
      st = st.parent;
    }
    const b = st.parent as ts.Block | undefined;
    if (!b) return null;
    out.unshift(b);
    if (b === body) return out;
    const t = b.parent;
    if (!(t && ts.isTryStatement(t) && t.tryBlock === b && !t.catchClause && !!t.finallyBlock)) return null; // repro-guard:existing-plain-path
    s = t;
  }
}
function bindingOf(sf: ts.SourceFile, testPath: string, entry: { name: string; path: string }, known: ReadonlySet<string>): string | null {
  const to = (spec: string) => resolveSpecifier(testPath, spec, known) === entry.path;
  for (const st of sf.statements) {
    if (ts.isImportDeclaration(st) && ts.isStringLiteral(st.moduleSpecifier) && to(st.moduleSpecifier.text) && !st.importClause?.isTypeOnly) { // repro-guard:existing-binds
      const nb = st.importClause?.namedBindings;
      if (nb && ts.isNamedImports(nb)) for (const el of nb.elements) if ((el.propertyName ?? el.name).text === entry.name && !el.isTypeOnly) return el.name.text;
    }
    if (ts.isVariableStatement(st)) for (const d of st.declarationList.declarations) {
      const init = d.initializer;
      if (!init || !ts.isCallExpression(init) || !ts.isIdentifier(init.expression) || init.expression.text !== "require" || !init.arguments[0] || !ts.isStringLiteral(init.arguments[0]) || !to(init.arguments[0].text)) continue;
      if (ts.isObjectBindingPattern(d.name)) for (const el of d.name.elements) {
        const key = el.propertyName && ts.isIdentifier(el.propertyName) ? el.propertyName.text : ts.isIdentifier(el.name) ? el.name.text : null;
        if (key === entry.name && ts.isIdentifier(el.name)) return el.name.text;
      }
    }
  }
  return null;
}
const plainCall = (c: ts.CallExpression, names: readonly string[]) => ts.isIdentifier(c.expression) && names.includes(c.expression.text);
const isRelative = (spec: string) => spec.startsWith("./") || spec.startsWith("../");
/** Names a test file can call as a helper: its own top-level functions (declarations, const arrows / function
 *  expressions) and bindings it imports or destructures from a RELATIVE path (a file of the same repo). A name from a
 *  package (`vitest`, `node:test`, a test-utils library) or a global is not a helper. */
function helpersOf(sf: ts.SourceFile, entryLocal: string): Set<string> {
  const out = new Set<string>();
  for (const st of sf.statements) {
    if (ts.isFunctionDeclaration(st) && st.name && st.body) out.add(st.name.text);
    if (ts.isImportDeclaration(st) && ts.isStringLiteral(st.moduleSpecifier) && isRelative(st.moduleSpecifier.text) && !st.importClause?.isTypeOnly) {
      const ic = st.importClause;
      if (ic?.name) out.add(ic.name.text);
      if (ic?.namedBindings && ts.isNamedImports(ic.namedBindings)) for (const el of ic.namedBindings.elements) if (!el.isTypeOnly) out.add(el.name.text);
    }
    if (ts.isVariableStatement(st)) for (const d of st.declarationList.declarations) {
      const init = d.initializer;
      if (!init) continue;
      if (ts.isIdentifier(d.name) && (ts.isArrowFunction(init) || ts.isFunctionExpression(init))) out.add(d.name.text);
      if (ts.isObjectBindingPattern(d.name) && ts.isCallExpression(init) && ts.isIdentifier(init.expression) && init.expression.text === "require" && init.arguments[0] && ts.isStringLiteral(init.arguments[0]) && isRelative(init.arguments[0].text)) {
        for (const el of d.name.elements) if (ts.isIdentifier(el.name)) out.add(el.name.text);
      }
    }
  }
  out.delete(entryLocal);
  for (const t of TESTISH) out.delete(t);
  return out;
}
type Found = Omit<Existing, "path" | "sf" | "local">;
/** The callback is the last argument of a plain test("..", fn) / it("..", fn) call. */
const inTestCb = (cb: ts.Node | undefined): boolean => {
  const tc = cb?.parent;
  return !!cb && (ts.isArrowFunction(cb) || ts.isFunctionExpression(cb)) && !!tc && ts.isCallExpression(tc) && plainCall(tc, ["test", "it"]) && tc.arguments[tc.arguments.length - 1] === cb; // repro-guard:existing-in-test
};
/** The describe("..", fn) bodies between the test call and the file, or null when anything else is in between. */
function describesOf(tc: ts.CallExpression): ts.CallExpression[] | null {
  const describes: ts.CallExpression[] = [];
  if (!ts.isExpressionStatement(tc.parent) || !tc.parent.parent) return null;
  for (let s: ts.Node | undefined = tc.parent.parent; s && !ts.isSourceFile(s); ) {
    const fnb: ts.Node | undefined = s.parent;
    const d: ts.Node | undefined = fnb?.parent;
    if (ts.isBlock(s) && fnb && (ts.isArrowFunction(fnb) || ts.isFunctionExpression(fnb)) && d && ts.isCallExpression(d) && plainCall(d, ["describe", "suite"]) && ts.isExpressionStatement(d.parent)) { describes.unshift(d); s = d.parent.parent; }
    else return null;
  }
  return describes;
}
/** One call of the entry: usable (directly in a plain test, or in one async callback of a local helper inside one), or
 *  why not. */
function usable(n: ts.CallExpression, need: number, helpers: ReadonlySet<string>): Found | ExistingMiss {
  const argsOk = n.arguments.length >= need && !n.arguments.some(ts.isSpreadElement); // repro-guard:existing-args
  if (!argsOk) return "args";
  const cb = ts.findAncestor(n.parent, ts.isFunctionLike) as ts.FunctionLikeDeclaration | undefined;
  if (!cb) return "not-in-test";
  if (inTestCb(cb)) {
    const blocks = cb.body && ts.isBlock(cb.body) ? blocksTo(n, cb.body) : [];
    if (!blocks) return "path";
    const describes = describesOf(cb.parent as ts.CallExpression);
    return describes ? { call: n, cb, testCall: cb.parent as ts.CallExpression, describes, blocks, helper: null } : "not-in-test";
  }
  // Batch 31: the call is in a callback passed to a helper call
  const hc = cb.parent;
  const outer: ts.Node | undefined = ts.findAncestor(cb.parent, ts.isFunctionLike);
  // a hook / fixture (beforeEach(..)), a test.each(..)(..) row or a module-level callback is not in a test
  if (!outer) return "not-in-test";
  if (!(ts.isArrowFunction(cb) || ts.isFunctionExpression(cb)) || !hc || !ts.isCallExpression(hc) || !hc.arguments.some((a) => a === cb) || !ts.isIdentifier(hc.expression)) return "unknown-helper";
  if (!helpers.has(hc.expression.text)) return "unknown-helper"; // repro-guard:existing-helper-local
  if (!inTestCb(outer)) return "nested-callback"; // repro-guard:existing-helper-one-level
  const tcb = outer as ts.ArrowFunction | ts.FunctionExpression;
  if (!mods(cb).some((m) => m.kind === ts.SyntaxKind.AsyncKeyword)) return "sync-callback"; // repro-guard:existing-helper-async
  const outerBlocks = ts.isBlock(tcb.body) ? blocksTo(hc, tcb.body) : null;
  const blocks = ts.isBlock(cb.body) ? blocksTo(n, cb.body) : null;
  if (!outerBlocks || !blocks) return "path";
  const describes = describesOf(tcb.parent as ts.CallExpression);
  return describes ? { call: n, cb: tcb, testCall: tcb.parent as ts.CallExpression, describes, blocks, helper: { call: hc, cb, outer: outerBlocks } } : "not-in-test";
}
/** Every usable call of the entry in the file, in file order, the first per test (Batch 32), and the first miss. */
function existingCalls(sf: ts.SourceFile, local: string, need: number): { found: Found[]; miss: ExistingMiss | null } {
  const found: Found[] = [];
  let miss: ExistingMiss | null = null;
  const helpers = helpersOf(sf, local);
  const visit = (n: ts.Node): void => {
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === local) {
      const r = usable(n, need, helpers);
      if (typeof r === "string") miss ??= r;
      else if (!found.some((f) => f.testCall === r.testCall)) found.push(r);
      return;
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return { found, miss };
}

/** The base test's own setup, as text: the file's top-level statements (no imports, no tests), its describe chain's
 *  setup, the statements before the call at each block level (and before the helper call, with the helper
 *  callback's parameters), and the call's argument at the trigger's position. Nothing from any other test. */
function setupOf(ex: Existing, trigger: Trigger): { text: string; arg: ts.Expression | undefined } {
  const sf = ex.sf;
  const before = (blocks: readonly ts.Block[], anchor: ts.Node) => blocks.flatMap((b) => b.statements.filter((s) => s.end <= anchor.pos).map((s) => s.getText(sf)));
  const parts: string[] = [];
  for (const st of sf.statements) if (!ts.isImportDeclaration(st) && !isTestish(st)) parts.push(st.getText(sf));
  for (const d of ex.describes) {
    const f = d.arguments[d.arguments.length - 1];
    if (f && (ts.isArrowFunction(f) || ts.isFunctionExpression(f)) && ts.isBlock(f.body)) for (const st of f.body.statements) if (!isTestish(st)) parts.push(st.getText(sf));
  }
  if (ex.helper) { parts.push(...before(ex.helper.outer, ex.helper.call), ...ex.helper.cb.parameters.map((p) => p.getText(sf))); }
  parts.push(...before(ex.blocks, ex.call));
  const arg = ex.call.arguments[trigger.param];
  if (arg) parts.push(arg.getText(sf));
  return { text: parts.join("\n"), arg };
}
const NO_VALUE = (e: ts.Expression | undefined) => !e || e.kind === ts.SyntaxKind.NullKeyword || (ts.isIdentifier(e) && e.text === "undefined") || ts.isVoidExpression(e);
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
/** `Promise.reject(...)` as a call expression (possibly awaited). */
const isPromiseReject = (e: ts.Expression): boolean => {
  let x: ts.Expression = e;
  if (ts.isAwaitExpression(x)) x = x.expression;
  return ts.isCallExpression(x) && ts.isPropertyAccessExpression(x.expression) && ts.isIdentifier(x.expression.expression) && x.expression.expression.text === "Promise" && x.expression.name.text === "reject";
};
/** A function whose body clearly only throws or returns Promise.reject (conservative: a single such statement). */
function functionInjectsFailure(n: ts.Node): boolean {
  const fn = ts.isArrowFunction(n) || ts.isFunctionExpression(n) || ts.isMethodDeclaration(n) || ts.isFunctionDeclaration(n) ? n : null;
  if (!fn || !fn.body) return false;
  if (!ts.isBlock(fn.body)) return isPromiseReject(fn.body as ts.Expression);
  const sts = fn.body.statements.filter((s) => !ts.isEmptyStatement(s) && !ts.isDebuggerStatement(s));
  if (sts.length !== 1) return false;
  const s = sts[0]!;
  if (ts.isThrowStatement(s)) return true;
  if (ts.isReturnStatement(s) && s.expression && isPromiseReject(s.expression)) return true;
  if (ts.isExpressionStatement(s) && isPromiseReject(s.expression)) return true;
  return false;
}
const propName = (p: ts.ObjectLiteralElementLike): string | null => {
  if (ts.isPropertyAssignment(p) || ts.isMethodDeclaration(p) || ts.isShorthandPropertyAssignment(p) || ts.isGetAccessorDeclaration(p) || ts.isSetAccessorDeclaration(p)) {
    if (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name) || ts.isNumericLiteral(p.name)) return p.name.text;
  }
  return null;
};
/** The base test's own setup statements in run order (file top-level, describe setup, statements before the helper
 *  call, statements before the call). Nothing from any other test. */
function setupStatements(ex: Existing): ts.Statement[] {
  const out: ts.Statement[] = [];
  out.push(...ex.sf.statements.filter((s) => !ts.isImportDeclaration(s) && !isTestish(s)));
  for (const d of ex.describes) {
    const f = d.arguments[d.arguments.length - 1];
    if (f && (ts.isArrowFunction(f) || ts.isFunctionExpression(f)) && ts.isBlock(f.body)) out.push(...f.body.statements.filter((s) => !isTestish(s)));
  }
  if (ex.helper) for (const b of ex.helper.outer) out.push(...b.statements.filter((s) => s.end <= ex.helper!.call.pos));
  for (const b of ex.blocks) out.push(...b.statements.filter((s) => s.end <= ex.call.pos));
  return out;
}
/** Locals bound in the base test's own setup (file top-level, describe setup, statements before the call). */
function setupLocals(ex: Existing): Map<string, ts.Expression> {
  const out = new Map<string, ts.Expression>();
  for (const st of setupStatements(ex)) {
    if (!ts.isVariableStatement(st)) continue;
    for (const d of st.declarationList.declarations) {
      if (ts.isIdentifier(d.name) && d.initializer) out.set(d.name.text, d.initializer);
    }
  }
  return out;
}
/** Resolve an expression through setup locals (one hop). */
const resolveLocal = (e: ts.Expression, locals: ReadonlyMap<string, ts.Expression>): ts.Expression =>
  ts.isIdentifier(e) && locals.has(e.text) ? locals.get(e.text)! : e;
/** True when the expression at the trigger clearly is (or holds) a function that throws / rejects. Conservative. */
function exprInjectsFailure(e: ts.Expression | undefined, prop: string | null, locals: ReadonlyMap<string, ts.Expression>): boolean {
  if (!e) return false;
  const x = resolveLocal(e, locals);
  if (prop === null) return functionInjectsFailure(x);
  if (!ts.isObjectLiteralExpression(x)) return false;
  for (const p of x.properties) {
    if (propName(p) !== prop) continue;
    if (ts.isMethodDeclaration(p)) return functionInjectsFailure(p);
    if (ts.isPropertyAssignment(p)) {
      const init = resolveLocal(p.initializer, locals);
      return functionInjectsFailure(init);
    }
    if (ts.isShorthandPropertyAssignment(p)) {
      const init = locals.get(p.name.text);
      return init ? functionInjectsFailure(init) : false;
    }
    return false;
  }
  return false;
}
/** `obj.m = ...` / `obj["m"] = ...` as [object name, member name], else null. */
const memberAssign = (e: ts.Node): { obj: string; name: string; value: ts.Expression } | null => {
  if (!ts.isBinaryExpression(e) || e.operatorToken.kind !== ts.SyntaxKind.EqualsToken) return null;
  const l = e.left;
  if (ts.isPropertyAccessExpression(l) && ts.isIdentifier(l.expression)) return { obj: l.expression.text, name: l.name.text, value: e.right };
  if (ts.isElementAccessExpression(l) && ts.isIdentifier(l.expression) && ts.isStringLiteralLike(l.argumentExpression)) return { obj: l.expression.text, name: l.argumentExpression.text, value: e.right };
  return null;
};
/** Batch 33 follow-up: the setup overrides the trigger method on the object it passes, by a plain assignment statement
 *  (`obj.m = () => { throw ... }`), before the call. Conservative: the argument is a plain identifier; the last such
 *  statement decides; any other write to `obj.m` (nested in a branch, a loop, a callback, a compound or chained
 *  assignment) or any reassignment of `obj` in the setup means unsure, so no demotion. */
function setupAssignsFailure(ex: Existing, trigger: Trigger, locals: ReadonlyMap<string, ts.Expression>): boolean {
  const arg = ex.call.arguments[trigger.param];
  if (!arg || !ts.isIdentifier(arg) || trigger.prop === null) return false;
  const sts = setupStatements(ex);
  const top = new Set<ts.Node>();
  let last: ts.Expression | undefined;
  for (const st of sts) {
    if (!ts.isExpressionStatement(st)) continue;
    const a = memberAssign(st.expression);
    if (a && a.obj === arg.text && a.name === trigger.prop) { top.add(st.expression); last = a.value; }
  }
  if (!last) return false;
  let unsure = false;
  const visit = (n: ts.Node): void => {
    if (unsure) return;
    if (ts.isBinaryExpression(n) && n.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && n.operatorToken.kind <= ts.SyntaxKind.LastAssignment) {
      if (ts.isIdentifier(n.left) && n.left.text === arg.text) { unsure = true; return; }
      const a = ts.isPropertyAccessExpression(n.left) || ts.isElementAccessExpression(n.left) ? n.left : null;
      if (a && ts.isIdentifier(a.expression) && a.expression.text === arg.text && !top.has(n)) {
        const name = ts.isPropertyAccessExpression(a) ? a.name.text : ts.isStringLiteralLike(a.argumentExpression) ? a.argumentExpression.text : null;
        if (name === null || name === trigger.prop) { unsure = true; return; }
      }
    }
    ts.forEachChild(n, visit);
  };
  for (const st of sts) visit(st);
  return !unsure && functionInjectsFailure(resolveLocal(last, locals));
}
/** Batch 33: the base test's own setup already makes the failing dependency throw or reject. */
function setupInjectsFailureOf(ex: Existing, trigger: Trigger): boolean {
  const arg = ex.call.arguments[trigger.param];
  const locals = setupLocals(ex);
  if (setupAssignsFailure(ex, trigger, locals)) return true; // repro-guard:rank-setup-assigns-failure
  return exprInjectsFailure(arg, trigger.prop, locals); // repro-guard:rank-setup-injects-failure
}
function rankOf(ex: Existing, trigger: Trigger, sitePath: string, found: number): BaseRank {
  const { text, arg } = setupOf(ex, trigger);
  const setupInjectsFailure = setupInjectsFailureOf(ex, trigger);
  const namesDependency = trigger.prop !== null ? word(trigger.prop.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).test(text) : !NO_VALUE(arg); // repro-guard:rank-names-dependency
  const ownFile = norm(fileStem(ex.path)) === norm(fileStem(sitePath)); // repro-guard:rank-own-file
  return { setupInjectsFailure, namesDependency, ownFile, found };
}
/** Pure: demote a setup that injects the failure, then prefer naming the dependency, own file, then found. */
export const byRank = (a: BaseRank, b: BaseRank): number => Number(a.setupInjectsFailure) - Number(b.setupInjectsFailure) || Number(b.namesDependency) - Number(a.namesDependency) || Number(b.ownFile) - Number(a.ownFile) || a.found - b.found;

/** The candidate test's three variants, from the existing test's own statements. */
function variantsOf(ex: Existing, plan: Omit<ReproPlan, "variants">, keepParams: boolean): Record<Variant, string> {
  const sf = ex.sf;
  const txt = (n: ts.Node) => n.getText(sf);
  const keep = (sts: readonly ts.Statement[]) => sts.filter((s) => !isTestish(s)).map(txt);
  // the statements before `anchor` at each block level; an inner level is the try block of a try / finally, kept
  // with its finally (the test's own cleanup); `middle` goes where `anchor`'s statement was
  const around = (blocks: readonly ts.Block[], anchor: ts.Node, middle: readonly string[]): string[] => {
    const prefix: string[] = [];
    const suffix: string[] = [];
    blocks.forEach((b, i) => {
      if (i > 0) prefix.push("try {");
      const at = b.statements.findIndex((s) => s.pos <= anchor.pos && s.end >= anchor.end);
      prefix.push(...b.statements.slice(0, Math.max(0, at)).map(txt));
      if (i > 0) suffix.unshift(`} finally ${txt((b.parent as ts.TryStatement).finallyBlock!)}`);
    });
    return [...prefix, ...middle, ...suffix];
  };
  const params = keepParams ? ex.cb.parameters.map(txt).join(", ") : "";
  const testName = (v: Variant) => `peaceai-repro ${v}: ${plan.entry.name} with ${plan.trigger.callee} failing`;
  const T = (ex.testCall.expression as ts.Identifier).text;
  const one = (v: Variant): string => {
    const lines: string[] = [];
    lines.push(`${T}(${JSON.stringify(testName(v))}, async (${params}) => {`);
    const core: string[] = [];
    core.push(`const __peaceaiArgs = [${ex.call.arguments.map(txt).join(", ")}];`);
    if (v !== "control") core.push(`__peaceaiArgs[${plan.trigger.param}] = __peaceaiFail(__peaceaiArgs[${plan.trigger.param}], ${JSON.stringify(plan.trigger.prop)}, ${plan.trigger.reject});`);
    core.push(`const __peaceaiSeen = await __peaceaiObserve(${JSON.stringify(plan.channel)}, ${plan.logParam ?? -1}, __peaceaiArgs, () => ${ex.local}(...__peaceaiArgs));`);
    core.push(v === "probe"
      ? `if (!__peaceaiHas(__peaceaiSeen, ${JSON.stringify(plan.code)})) throw new Error("peaceai-repro probe: the reported failure was not observed");`
      : `if (__peaceaiHas(__peaceaiSeen, ${JSON.stringify(plan.code)})) throw new Error("peaceai-repro: the reported failure was produced");`);
    const h = ex.helper;
    if (!h) lines.push(...around(ex.blocks, ex.call, core));
    else {
      // the helper call kept (awaited, its other arguments as written), its callback rebuilt from the callback's own
      // parameters and the statements before the call, with the same injected dependency and check inside
      const cbText = [`async (${h.cb.parameters.map(txt).join(", ")}) => {`, ...around(ex.blocks, ex.call, core), "}"].join("\n");
      const call = `await ${txt(h.call.expression)}(${h.call.arguments.map((a) => (a === h.cb ? cbText : txt(a))).join(", ")});`;
      lines.push(...around(h.outer, h.call, [call]));
    }
    lines.push("});");
    let inner = lines.join("\n");
    for (let i = ex.describes.length - 1; i >= 0; i--) {
      const d = ex.describes[i]!;
      const f = d.arguments[d.arguments.length - 1] as ts.ArrowFunction | ts.FunctionExpression;
      const own = ts.isBlock(f.body) ? keep(f.body.statements) : [];
      inner = [`${(d.expression as ts.Identifier).text}(${JSON.stringify(`peaceai-repro ${i}`)}, () => {`, ...own, inner, "});"].join("\n");
    }
    return [
      ...(/\.[cm]?tsx?$/.test(plan.testPath) ? ["// @ts-nocheck"] : []),
      `// Generated by PeaceAI ${REPRO_VERSION} (plan-only candidate, ${v} variant). Not a grading test; review before use.`,
      `// Built from ${ex.path} line ${plan.existing.line}: the reported site ${plan.site.path}:${plan.site.line} (${plan.site.via}).`,
      ...keep(sf.statements),
      inner,
      HELPERS,
      "",
    ].join("\n");
  };
  return { repro: one("repro"), probe: one("probe"), control: one("control") };
}

/** The test-side helpers (plain JS: valid in .js, .cjs, .mjs and .ts files; no imports). */
export const HELPERS = [
  "function __peaceaiFail(target, prop, reject) {",
  "  const boom = () => { const e = new Error(\"peaceai-repro: injected dependency failure\"); if (reject) return Promise.reject(e); throw e; };",
  "  if (prop === null) return boom;",
  "  const base = target !== null && (typeof target === \"object\" || typeof target === \"function\") ? target : {};",
  "  return new Proxy(base, { get(t, k) { if (k === prop) return boom; const v = Reflect.get(t, k, t); return typeof v === \"function\" ? v.bind(t) : v; } });",
  "}",
  "function __peaceaiTap(logger, seen) {",
  "  if (logger === null || (typeof logger !== \"object\" && typeof logger !== \"function\")) return logger;",
  "  return new Proxy(logger, {",
  "    apply(t, self, a) { seen.push(a); return Reflect.apply(t, self, a); },",
  "    get(t, k) { const v = Reflect.get(t, k, t); return typeof v === \"function\" ? (...a) => { seen.push(a); return v.apply(t, a); } : v; },",
  "  });",
  "}",
  "async function __peaceaiObserve(channel, logIdx, args, run) {",
  "  const seen = [];",
  "  const restore = [];",
  "  if (channel === \"logged\") {",
  "    for (const k of [\"log\", \"info\", \"warn\", \"error\", \"debug\", \"trace\"]) { const o = console[k]; restore.push(() => { console[k] = o; }); console[k] = (...a) => { seen.push(a); }; }",
  "    for (const s of [process.stdout, process.stderr]) { const o = s.write; restore.push(() => { s.write = o; }); s.write = (c) => { seen.push(String(c)); return true; }; }",
  "    if (logIdx >= 0) args[logIdx] = __peaceaiTap(args[logIdx], seen);",
  "  }",
  "  try {",
  "    const r = await run();",
  "    if (channel === \"returned\" || channel === \"pushed\") seen.push(r);",
  "    if (channel === \"pushed\") seen.push(args);",
  "  } catch (e) {",
  "    if (channel === \"thrown\") seen.push(e);",
  "  } finally {",
  "    for (const f of restore.reverse()) f();",
  "  }",
  "  return seen;",
  "}",
  "function __peaceaiHas(v, code) {",
  "  const re = new RegExp(\"(?<![A-Za-z0-9_])\" + code + \"(?![A-Za-z0-9_])\");",
  "  const met = new Set();",
  "  let budget = 20000;",
  "  const walk = (x, d) => {",
  "    if (budget-- <= 0 || d > 12) return false;",
  "    if (typeof x === \"string\") return re.test(x);",
  "    if (x === null || typeof x !== \"object\") return false;",
  "    if (met.has(x)) return false;",
  "    met.add(x);",
  "    if (x instanceof Error && [x.message, x.code, x.cause, x.errors].some((y) => walk(y, d + 1))) return true;",
  "    if (x instanceof Map || x instanceof Set) { for (const e of x) if (walk(e, d + 1)) return true; return false; }",
  "    for (const k of Object.keys(x)) { let y; try { y = x[k]; } catch { continue; } if (walk(y, d + 1)) return true; }",
  "    return false;",
  "  };",
  "  return walk(v, 0);",
  "}",
].join("\n");

/** Static half: every candidate test for `code` at `site` (one per usable existing test), ranked, or the precise
 *  refusal. Reads files only. */
export function planRepros(code: CodeRepo, errCode: string, site: ThrowSite): PlansResult {
  const refuse = (r: ReproRefusal, detail?: string): PlansResult => (detail ? { refuse: r, detail } : { refuse: r });
  if (!CODE_SHAPE.test(errCode)) return refuse("REPRO_NO_DIAGNOSIS"); // repro-guard:code-shape
  if (!isSourceFile(site.path) || isTestPath(site.path) || isGeneratedPath(site.path)) return refuse("REPRO_TEST_TARGET"); // repro-guard:site-source
  // a top-level `main().catch(..)` site (plan5 Batch 31) names the called function, not a try / chain around a
  // dependency call of an exported entry: v1 has no trigger to inject there
  if (site.shape === "toplevel-catch") return refuse("REPRO_NO_ENTRY", "toplevel-catch"); // repro-guard:site-not-toplevel
  const root = code.root;
  const text = readSmall(root, site.path);
  if (text === null) return refuse("REPRO_NO_DIAGNOSIS");
  const sf = parse(site.path, text);
  const region = findRegion(sf, errCode, site);
  if (typeof region === "string") return refuse(region);
  const fn = entryOf(sf, region.at, site.symbol);
  if (!fn) return refuse("REPRO_NO_ENTRY");
  const trigger = triggerIn(sf, region, fn);
  if (!trigger) return refuse("REPRO_NO_TRIGGER");
  const obs = observeOf(sf, errCode, site, region, fn);
  if (!obs) return refuse("REPRO_NO_OBSERVE");
  const entry = { name: site.symbol!, path: site.path };
  // existing tests of the same module: related tests first (codesearch's import graph / naming), then any other
  const tree = code.tree({ limit: 50_000 });
  const all = tree.ok ? tree.files : [];
  const known = new Set(all);
  const related = (() => { const r = code.testsFor(site.path); return r.ok ? r.tests.map((t) => t.path) : []; })();
  const order = [...new Set([...related, ...all.filter(isBehaviorTest).sort()])].filter(isBehaviorTest).slice(0, MAX_TESTS_SCANNED);
  const need = Math.max(trigger.param, obs.logParam ?? -1) + 1;
  const bases: Existing[] = [];
  let miss: ExistingMiss | null = null;
  for (const p of order) {
    const t = readSmall(root, p);
    if (t === null || !t.includes(entry.name)) continue;
    const tsf = parse(p, t);
    const local = bindingOf(tsf, p, entry, known);
    if (!local) continue;
    const c = existingCalls(tsf, local, need);
    miss ??= c.miss;
    for (const f of c.found) bases.push({ path: p, sf: tsf, local, ...f });
  }
  if (!bases.length) return refuse("REPRO_NO_EXISTING_TEST", miss ?? undefined);
  const plans: ReproPlan[] = [];
  let runnerMiss: string | null = null;
  bases.forEach((ex, found) => {
    const testPath = ex.path.replace(/(\.(?:test|spec))?(\.[cm]?[jt]sx?)$/, ".peaceai-repro$1$2");
    const det = detectRunner(root, [testPath]);
    if ("refuse" in det) { runnerMiss ??= det.refuse; return; }
    const tsxImport = det.runner === "node-test" && usesTsx(root, det.pkgDir);
    const base: Omit<ReproPlan, "variants"> = { version: REPRO_VERSION, code: errCode, site, channel: obs.channel, entry, trigger, logParam: obs.logParam, existing: { path: ex.path, line: lineOf(ex.sf, ex.call) }, runner: det, testPath, tsxImport, rank: rankOf(ex, trigger, site.path, found) };
    plans.push({ ...base, variants: variantsOf(ex, base, det.runner === "node-test" || det.runner === "vitest") });
  });
  if (!plans.length) return refuse("REPRO_RUNNER", runnerMiss ?? undefined);
  return { plans: plans.sort((a, b) => byRank(a.rank, b.rank)) };
}
/** The first-ranked candidate only (the static half of attempt 1). */
export function planRepro(code: CodeRepo, errCode: string, site: ThrowSite): PlanResult {
  const r = planRepros(code, errCode, site);
  return "refuse" in r ? r : r.plans[0]!;
}
function usesTsx(root: string, pkgDir: string): boolean {
  try {
    const pkg = JSON.parse(readFileSync(join(root, pkgDir, "package.json"), "utf8"));
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    return typeof pkg.scripts?.test === "string" && /(?:^|[\s;&|])tsx\s+--test\b/.test(pkg.scripts.test) && typeof deps.tsx === "string";
  } catch { return false; }
}

// ---- the dynamic half: the three runs, as the candidate uid, in the loop's isolation

export interface VariantRun { exitCode: number; pass: number; fail: number; leftovers: number; tampered?: string[] }
/** Pure: what the three runs prove. A vitest / jest / mocha run goes through the loop's shim, whose made-up counts
 *  exit 93-95 (never 0 or 1), so they are neither a pass nor a fail here. */
export function judge(runs: Record<Variant, VariantRun>): ReproCode {
  const all = VARIANTS.map((v) => runs[v]);
  if (all.some((r) => r.exitCode === 97 || r.exitCode === 98)) return "REPRO_ISOLATION"; // repro-guard:judge-isolation
  const clean = (r: VariantRun) => r.leftovers === 0 && !r.tampered?.length; // repro-guard:judge-clean
  const passed = (r: VariantRun) => clean(r) && r.exitCode === 0 && r.fail === 0 && r.pass === 1; // repro-guard:judge-one-pass
  const failed = (r: VariantRun) => clean(r) && r.exitCode === 1 && r.fail === 1 && r.pass === 0; // repro-guard:judge-one-fail
  if (passed(runs.repro)) return "REPRO_NOT_FAILING"; // repro-guard:judge-repro-fails
  if (!failed(runs.repro)) return "REPRO_WRONG_REASON";
  if (!passed(runs.probe)) return "REPRO_WRONG_REASON"; // repro-guard:judge-probe
  if (!passed(runs.control)) return "REPRO_VACUOUS"; // repro-guard:judge-control
  return "REPRO_OK";
}

export interface ValidateOptions {
  env: Record<string, string | undefined>;
  /** privateRoots(...) of the caller: no link in the copy may point there. */
  roots: readonly string[];
  workBase?: string;
  depsBase?: string;
  deps?: DepsOptions;
  runMs?: number;
  /** Tests only: fills the copy's node_modules (a pinned tree the test installed) instead of installDeps. */
  provideDeps?: (copyDir: string) => void;
}
/** Batch 32: one base test tried: which test, why it was ranked there, and its own verdict and runs. */
export interface Attempt { base: { path: string; line: number }; rank: BaseRank; code: ReproCode; detail?: string; runs?: Record<Variant, VariantRun> }
export interface ReproResult {
  code: ReproCode;
  detail?: string;
  /** The runs of the attempt the code comes from (one attempt's, never pooled). */
  runs?: Record<Variant, VariantRun>;
  /** Only on REPRO_OK: the plan of the attempt that passed the judge. */
  plan?: ReproPlan;
  attempts?: Attempt[];
  /** Ranked candidates never run (beyond MAX_ATTEMPTS, or after a stop). */
  untried?: number;
}
/** Reasons about the base test (another base test may reach the site). Any other code is about the repository or
 *  the sandbox (runner, dependencies, isolation, candidate uid), the same for every base: no further attempt. */
const BASE_REASONS: ReadonlySet<ReproCode> = new Set<ReproCode>(["REPRO_NOT_FAILING", "REPRO_WRONG_REASON", "REPRO_VACUOUS"]);

/** Batch 32: the ranked candidates tried in order, at most MAX_ATTEMPTS, stopping at the first REPRO_OK. Each attempt
 *  is judged on its OWN three runs (`run` is validateRepro outside tests). With no REPRO_OK the result is the
 *  best-ranked attempt's code. */
export function attemptAll(plans: readonly ReproPlan[], run: (p: ReproPlan) => ReproResult): ReproResult {
  const tried = plans.slice(0, MAX_ATTEMPTS); // repro-guard:attempts-cap
  const attempts: Attempt[] = [];
  for (const p of tried) {
    const r = run(p);
    // an attempt's verdict is the judge of its own three runs; a claimed REPRO_OK without them is not one
    const code: ReproCode = r.runs ? judge(r.runs) : r.code === "REPRO_OK" ? "REPRO_WRONG_REASON" : r.code; // repro-guard:attempt-own-runs
    attempts.push({ base: { ...p.existing }, rank: p.rank, code, ...(r.detail ? { detail: r.detail } : {}), ...(r.runs ? { runs: r.runs } : {}) });
    if (code === "REPRO_OK") return { code, runs: r.runs!, plan: p, attempts, untried: plans.length - attempts.length }; // repro-guard:attempt-stop-ok
    if (!BASE_REASONS.has(code)) break; // repro-guard:attempt-stop-env
  }
  const best = attempts[0]; // repro-guard:attempts-best-ranked
  if (!best) return { code: "REPRO_NO_EXISTING_TEST", attempts, untried: plans.length };
  return { code: best.code, ...(best.detail ? { detail: best.detail } : {}), ...(best.runs ? { runs: best.runs } : {}), attempts, untried: plans.length - attempts.length };
}

/** The files copied into the sandbox: tracked files when `root` is a git checkout, else the tree (no node_modules,
 *  .git or symlinks either way). */
function sourceFiles(root: string): string[] {
  if (existsSync(join(root, ".git"))) {
    try { return execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8", maxBuffer: 1 << 28 }).split("\0").filter(Boolean); } catch { /* fall through */ }
  }
  const out: string[] = [];
  const walk = (rel: string) => {
    for (const e of readdirSync(join(root, rel))) {
      if (e === ".git" || e === "node_modules") continue;
      const r = rel ? `${rel}/${e}` : e;
      const st = lstatSync(join(root, r));
      if (st.isDirectory()) walk(r); else if (st.isFile()) out.push(r);
      if (out.length > 200_000) return;
    }
  };
  walk("");
  return out;
}
const gitq = (dir: string, ...args: string[]) => execFileSync("git", ["-c", "user.name=PeaceAI", "-c", "user.email=peaceai@invalid", "-c", "commit.gpgsign=false", ...args], { cwd: dir, stdio: ["ignore", "pipe", "ignore"], encoding: "utf8" }).trim();

export function validateRepro(root: string, plan: ReproPlan, o: ValidateOptions): ReproResult {
  const cu = stage2CandUid(o.env);
  if (!cu.ok) return { code: "REPRO_ISOLATION", detail: cu.reason }; // repro-guard:needs-cand
  const cand: CandUid = cu.cand;
  const work = openWorkDir(cand, o.workBase);
  if (!work) return { code: "REPRO_ISOLATION", detail: "WORK_DIR" };
  const cache = openDepsCache(o.depsBase);
  try {
    const dir = mkdtempSync(join(work.dir, "peaceai-repro-"));
    for (const f of sourceFiles(root)) {
      if (posix.normalize(f) === posix.normalize(plan.testPath)) continue;
      const src = join(root, f);
      try { if (!lstatSync(src).isFile()) continue; } catch { continue; }
      mkdirSync(dirname(join(dir, f)), { recursive: true });
      copyFileSync(src, join(dir, f));
    }
    gitq(dir, "init", "-q");
    gitq(dir, "add", "-A");
    gitq(dir, "commit", "-q", "--allow-empty", "-m", "peaceai-repro copy");
    chmodSync(dir, 0o755);
    const c: Copy = { dir, head: gitq(dir, "rev-parse", "HEAD"), teamTests: new Map(), close: () => {} };
    const pick = detectRunner(dir, [plan.testPath]);
    if ("refuse" in pick) return { code: "REPRO_RUNNER", detail: pick.refuse };
    if (o.provideDeps) o.provideDeps(dir);
    else if (pick.runner !== "node-test" || pick.hasDeps) {
      const d = installDeps(dir, cand, cache, o.deps);
      if ("refuse" in d) return { code: "REPRO_DEPS", detail: d.refuse };
    }
    const gid = Number(spawnSync("id", ["-g", cand.name], { encoding: "utf8" }).stdout.trim());
    mkdirSync(join(dir, "node_modules/.bin"), { recursive: true });
    writeFileSync(join(dir, "node_modules/.bin/tsx"), runnerWrapper(cand.uid, gid));
    chmodSync(join(dir, "node_modules/.bin/tsx"), 0o755);
    const json = pick.runner !== "node-test";
    if (json) installShim(dir);
    const iso = isolationProblem(c, work.dir, cand, o.roots, true);
    if (iso) return { code: "REPRO_ISOLATION", detail: iso };
    const rel = pick.pkgDir ? posix.relative(pick.pkgDir, plan.testPath) : plan.testPath;
    const args = json ? shimArgs({ ...pick, files: [rel] }) : [...(plan.tsxImport ? ["--import", "tsx"] : []), "--test", "--test-reporter=tap", plan.testPath];
    const runs = {} as Record<Variant, VariantRun>;
    const full = join(dir, plan.testPath);
    for (const v of VARIANTS) {
      writeFileSync(full, plan.variants[v]);
      const r: RawRun = guardedRun(dir, args, Date.now() + (o.runMs ?? 120_000), [plan.testPath], null, cand);
      runs[v] = { exitCode: r.exitCode, pass: r.pass, fail: r.fail, leftovers: r.leftovers, ...(r.tampered?.length ? { tampered: r.tampered } : {}) };
      rmSync(full, { force: true });
    }
    return { code: judge(runs), runs, plan };
  } finally {
    work.close();
    cache.close();
  }
}

/** Plan + validate the ranked candidates, from a checkout dir: the CLI's whole job. The plan (and so the test text)
 *  is returned only with REPRO_OK. */
export function reproduce(root: string, errCode: string, site: ThrowSite, o: ValidateOptions): ReproResult {
  const p = planRepros(openRepo(root), errCode, site);
  if ("refuse" in p) return { code: p.refuse, ...(p.detail ? { detail: p.detail } : {}) };
  return attemptAll(p.plans, (plan) => validateRepro(root, plan, o));
}
