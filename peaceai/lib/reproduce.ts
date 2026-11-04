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
// Nothing here names a repository, task, task set or file of any task set.
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, posix } from "node:path";
import ts from "typescript";
import { isGeneratedPath, isTestPath, openRepo, resolveSpecifier, type CodeRepo } from "./codesearch.ts";
import { isolationProblem, runnerWrapper, type Copy } from "./loop.ts";
import { detectRunner, installDeps, installShim, openDepsCache, openWorkDir, SHIM_EXITS, shimArgs, type DepsOptions, type RunnerPick } from "./loopdeps.ts";
import { isBehaviorTest, isSourceFile } from "./plan4.ts";
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
}
export type PlanResult = ReproPlan | { refuse: ReproRefusal; detail?: string };

const CODE_SHAPE = /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+$/;
const TESTISH = new Set(["test", "it", "describe", "suite", "context", "specify", "bench", "xit", "xdescribe", "fit", "fdescribe", "xtest"]);
const MAX_FILE = 1 << 20;
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
  if (site.via === "error-class") return "REPRO_NO_TRIGGER"; // repro-guard:no-class-site (a class that passes the code, never seen thrown)
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

/** An existing test of the entry: the binding it imports it by, the call it makes inside a plain test callback. */
interface Existing { path: string; sf: ts.SourceFile; local: string; call: ts.CallExpression; cb: ts.FunctionLikeDeclaration; testCall: ts.CallExpression; describes: ts.CallExpression[] }
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
function existingCall(sf: ts.SourceFile, local: string, need: number): Omit<Existing, "path" | "sf" | "local"> | null {
  let out: Omit<Existing, "path" | "sf" | "local"> | null = null;
  const visit = (n: ts.Node): void => {
    if (out) return;
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === local) {
      const cb = ts.findAncestor(n.parent, ts.isFunctionLike) as ts.FunctionLikeDeclaration | undefined;
      const tc = cb?.parent;
      // the call is directly in a plain test("..", fn) / it("..", fn) callback (not in a helper, a hook or a nested callback)
      const inTest = !!cb && (ts.isArrowFunction(cb) || ts.isFunctionExpression(cb)) && !!tc && ts.isCallExpression(tc) && plainCall(tc, ["test", "it"]) && tc.arguments[tc.arguments.length - 1] === cb; // repro-guard:existing-in-test
      const argsOk = n.arguments.length >= need && !n.arguments.some(ts.isSpreadElement); // repro-guard:existing-args
      if (inTest && argsOk) {
        const describes: ts.CallExpression[] = [];
        let ok = ts.isExpressionStatement(tc!.parent) && !!tc!.parent.parent;
        for (let s: ts.Node | undefined = tc!.parent.parent; ok && s && !ts.isSourceFile(s); ) {
          // only describe("..", fn) bodies between the test and the file
          const fnb: ts.Node | undefined = s.parent;
          const d: ts.Node | undefined = fnb?.parent;
          if (ts.isBlock(s) && fnb && (ts.isArrowFunction(fnb) || ts.isFunctionExpression(fnb)) && d && ts.isCallExpression(d) && plainCall(d, ["describe", "suite"]) && ts.isExpressionStatement(d.parent)) { describes.unshift(d); s = d.parent.parent; }
          else ok = false;
        }
        if (ok) { out = { call: n, cb: cb!, testCall: tc as ts.CallExpression, describes }; return; }
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

/** The candidate test's three variants, from the existing test's own statements. */
function variantsOf(ex: Existing, plan: Omit<ReproPlan, "variants">, keepParams: boolean): Record<Variant, string> {
  const sf = ex.sf;
  const txt = (n: ts.Node) => n.getText(sf);
  const keep = (sts: readonly ts.Statement[]) => sts.filter((s) => !isTestish(s)).map(txt);
  const body = ex.cb.body!;
  let prefix: string[] = [];
  if (ts.isBlock(body)) {
    const at = body.statements.findIndex((s) => s.pos <= ex.call.pos && s.end >= ex.call.end);
    prefix = body.statements.slice(0, Math.max(0, at)).map(txt);
  }
  const params = keepParams ? ex.cb.parameters.map(txt).join(", ") : "";
  const testName = (v: Variant) => `peaceai-repro ${v}: ${plan.entry.name} with ${plan.trigger.callee} failing`;
  const T = (ex.testCall.expression as ts.Identifier).text;
  const one = (v: Variant): string => {
    const lines: string[] = [];
    lines.push(`${T}(${JSON.stringify(testName(v))}, async (${params}) => {`);
    for (const p of prefix) lines.push(p);
    lines.push(`const __peaceaiArgs = [${ex.call.arguments.map(txt).join(", ")}];`);
    if (v !== "control") lines.push(`__peaceaiArgs[${plan.trigger.param}] = __peaceaiFail(__peaceaiArgs[${plan.trigger.param}], ${JSON.stringify(plan.trigger.prop)}, ${plan.trigger.reject});`);
    lines.push(`const __peaceaiSeen = await __peaceaiObserve(${JSON.stringify(plan.channel)}, ${plan.logParam ?? -1}, __peaceaiArgs, () => ${ex.local}(...__peaceaiArgs));`);
    lines.push(v === "probe"
      ? `if (!__peaceaiHas(__peaceaiSeen, ${JSON.stringify(plan.code)})) throw new Error("peaceai-repro probe: the reported failure was not observed");`
      : `if (__peaceaiHas(__peaceaiSeen, ${JSON.stringify(plan.code)})) throw new Error("peaceai-repro: the reported failure was produced");`);
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

/** Static half: the candidate test for `code` at `site`, or the precise refusal. Reads files only. */
export function planRepro(code: CodeRepo, errCode: string, site: ThrowSite): PlanResult {
  const refuse = (r: ReproRefusal, detail?: string): PlanResult => (detail ? { refuse: r, detail } : { refuse: r });
  if (!CODE_SHAPE.test(errCode)) return refuse("REPRO_NO_DIAGNOSIS"); // repro-guard:code-shape
  if (!isSourceFile(site.path) || isTestPath(site.path) || isGeneratedPath(site.path)) return refuse("REPRO_TEST_TARGET"); // repro-guard:site-source
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
  // an existing test of the same module: related tests first (codesearch's import graph / naming), then any other
  const tree = code.tree({ limit: 50_000 });
  const all = tree.ok ? tree.files : [];
  const known = new Set(all);
  const related = (() => { const r = code.testsFor(site.path); return r.ok ? r.tests.map((t) => t.path) : []; })();
  const order = [...new Set([...related, ...all.filter(isBehaviorTest).sort()])].filter(isBehaviorTest).slice(0, MAX_TESTS_SCANNED);
  const need = Math.max(trigger.param, obs.logParam ?? -1) + 1;
  let ex: Existing | null = null;
  for (const p of order) {
    const t = readSmall(root, p);
    if (t === null || !t.includes(entry.name)) continue;
    const tsf = parse(p, t);
    const local = bindingOf(tsf, p, entry, known);
    if (!local) continue;
    const c = existingCall(tsf, local, need);
    if (c) { ex = { path: p, sf: tsf, local, ...c }; break; }
  }
  if (!ex) return refuse("REPRO_NO_EXISTING_TEST");
  const testPath = ex.path.replace(/(\.(?:test|spec))?(\.[cm]?[jt]sx?)$/, ".peaceai-repro$1$2");
  const det = detectRunner(root, [testPath]);
  if ("refuse" in det) return refuse("REPRO_RUNNER", det.refuse);
  const tsxImport = det.runner === "node-test" && usesTsx(root, det.pkgDir);
  const base: Omit<ReproPlan, "variants"> = { version: REPRO_VERSION, code: errCode, site, channel: obs.channel, entry, trigger, logParam: obs.logParam, existing: { path: ex.path, line: lineOf(ex.sf, ex.call) }, runner: det, testPath, tsxImport };
  return { ...base, variants: variantsOf(ex, base, det.runner === "node-test" || det.runner === "vitest") };
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
const SYNTH = new Set<number>(Object.values(SHIM_EXITS));
/** Pure: what the three runs prove. `json`: a vitest / jest / mocha run through the loop's shim. */
export function judge(json: boolean, runs: Record<Variant, VariantRun>): ReproCode {
  const all = VARIANTS.map((v) => runs[v]);
  if (all.some((r) => r.exitCode === 97 || r.exitCode === 98)) return "REPRO_ISOLATION"; // repro-guard:judge-isolation
  const clean = (r: VariantRun) => r.leftovers === 0 && !r.tampered?.length && !(json && SYNTH.has(r.exitCode)); // repro-guard:judge-clean
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
export interface ReproResult { code: ReproCode; detail?: string; runs?: Record<Variant, VariantRun>; plan?: ReproPlan }

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
    return { code: judge(json, runs), runs, plan };
  } finally {
    work.close();
    cache.close();
  }
}

/** Plan + validate, from a checkout dir: the CLI's whole job. The test text is returned only when it is REPRO_OK. */
export function reproduce(root: string, errCode: string, site: ThrowSite, o: ValidateOptions): ReproResult {
  const p = planRepro(openRepo(root), errCode, site);
  if ("refuse" in p) return { code: p.refuse, ...(p.detail ? { detail: p.detail } : {}) };
  return validateRepro(root, p, o);
}
