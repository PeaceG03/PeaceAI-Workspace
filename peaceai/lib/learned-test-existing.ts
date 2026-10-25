// M80 (TEST_CASE_EXISTING, proposal public-test-case-existing-v1): a characterization test for an EXISTING exported
// pure function. ADD_TEST_CASE (M12) needs a fix commit, so it can only pin new behavior. This kind needs none:
// - the task names an exported function in an existing in-scope source module and gives the checks (the M12 bullet
//   grammar: `- CALL is VALUE`, `- CALL equals [..]`, `- CALL throws CODE`; no `rejects`, no Fix line);
// - the candidate is ONE new test file next to the module (`<stem>.<slug>-<id7>.test.ts`); no source edit, ever;
// - Job B grades it fix-free: the test must PASS on today's code (three runs) and FAIL, by assertions only, with
//   the function's body replaced by a write-only type-default stub (the M23 confined stub route);
// - the target must be a plain, unprotected, non-test `.ts` module whose function is provably pure by a transitive
//   module-local analysis (below). Refused by name: async/generator/Promise (test_target_async), I/O and process
//   globals or Node builtin imports (test_target_io), the clock and local-time Date reads (test_target_date_local),
//   any other impurity (test_target_impure), PeaceAI's own protected paths (self_protected_path), and signatures
//   outside the vocabulary (test_target_signature). No model.
import ts from "typescript";
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { isAbsolute, join, relative } from "node:path";
import { ARGS_NESTED_OBJECTS, ARGS_PLAIN_DATA_V3, ARGS_PLAIN_DATA_V7, buildTestEdit, checkRoot, FIX_LINE, isDateLiteral, isMapSetLiteral, ISO_DATE_TEXT, parseTestTask, type TestTask } from "./learned-test.ts";
import { DATE_LOCAL_TIME, DATE_NOW, DATE_SETTER, dateRefusal, plainPath } from "./learned-complex.ts";
import { PROTECTED_SELF } from "./selfchange.ts";

const NAME = String.raw`[A-Za-z_$][\w$]*`;
const FILE = String.raw`[\w./-]+\.ts`;
/** Header line: its own phrase ("characterization test"), so it never overlaps ADD_TEST_CASE's "add (regression) test for". */
export const TEST_EXISTING_TRIGGER = String.raw`^add (?:a )?characteri[sz]ation test for \x60?(?<symbol>${NAME})\x60? in \x60?(?<file>${FILE})\x60?(?: ?: (?<title>[^\n]{1,120}?))?\.?$`;
export const TEST_EXISTING_FLAG = "PEACEAI_TEST_EXISTING";
export const testExistingEnabled = (env: Record<string, string | undefined>): boolean => env[TEST_EXISTING_FLAG] === "true";

export const TEST_EXISTING_PARAM_KEYS = ["assert", "checks", "framework", "grading", "matcher", "maxLines", "placement", "target"] as const;
export const TEST_EXISTING_VOCAB = {
  assert: ["node:assert/strict-default"],
  checks: ["equal", "deepEqual", "throws"],
  framework: ["node:test-default"],
  grading: ["pass-now-fail-stub"],
  matcher: ["regex"],
  placement: ["new-file"],
  // M85 (public-test-case-existing-v2): "exported-pure-function-v2" widens the target only: plain-data object types
  // (interfaces / type aliases / object type literals of the vocabulary, string/number literal unions) in the
  // signature, and named value imports from relative sibling modules followed by the same purity analysis (bounded).
  // M88 (public-test-case-existing-v3): "exported-pure-function-v3" = the v2 target plus the built-in `Date` in the
  // signature (parameters, return, members), Date literal arguments and expected values, and object literals nested
  // inside array arguments (gap 1). Clock, local-time and setter use stay refused by the same Date rules as v1/v2.
  // M90 (public-test-case-existing-v4): "exported-pure-function-v4" = the v3 target plus (a) optional parameters
  // (`p?: T`) and typed parameters with a default (`p: T = EXPR`, the initializer analyzed like the body, so a clock
  // or impure default stays refused by name), (b) the built-in generic plain-data references `Array<T>`,
  // `ReadonlyArray<T>`, `Readonly<T>`, `Partial<T>`, `Record<K, V>` (K string / number / a string-literal union, V plain
  // data) and `Pick<T, K>` / `Omit<T, K>` (T plain data, K string / string-literal keys),
  // and (c) plain-data types nested up to MAX_TYPE_DEPTH_V4 with up to MAX_TYPE_MEMBERS_V4 members per object.
  // Classes, functions, Map/Set, bytes, unknown/any, typeof, intersections and other generics stay refused.
  // M91 (public-test-case-existing-v5): "exported-pure-function-v5" = the v4 target plus (a) `typeof N` where N is a
  // top-level `const` (module-local or a named import from a followed relative sibling) whose initializer is a
  // string / number / boolean literal (optionally `as const`; M92: a type annotation alone never qualifies, and one
  // present must itself be plain data), and (b)
  // `T["k"]` property lookups where T is a plain object type v4 accepts and k a string literal naming one of its
  // property signatures. Every other typeof (functions, `let`, values of non-literal type) and indexed access stays refused.
  // M93 (public-test-case-existing-v6): "exported-pure-function-v6" = the v5 target plus (a) a parameter whose whole
  // type is `unknown` (checks still pass only plain-data literals; `any`, and `unknown` nested anywhere or as the
  // return type, stay refused), and (b) a parameter typed `NodeJS.ProcessEnv` (the global name, read as
  // Record<string, string | undefined>), optionally with the default `= process.env` (exactly that expression, on the
  // tested function only) when every call of the function in every check passes an object literal for that
  // parameter, so the default never runs (Job A on the task, Job B on the graded test source).
  // M97 (public-test-case-existing-v7): "exported-pure-function-v7" = the v6 target plus (a) the global
  // `Map<K, V>` / `ReadonlyMap<K, V>` / `Set<K>` / `ReadonlySet<K>` in the signature (K a string / number / string- or
  // number-literal union key, never an object or function; V plain data or a nested collection), with `new Map([..])` /
  // `new Set([..])` literals in checks, and (b) a `void` return type when every check is `throws CODE` or `is undefined`
  // and at least one is `throws` (Job A on the task, Job B on the graded test). A target v6 accepts is v6's; a target
  // only v7 accepts gets the v7 hardening (no write deeper than one step into a fresh copy, no escaping module
  // container, and the v6 closure rules plus no global or prototype patch anywhere in the relative import closure).
  target: ["exported-pure-function", "exported-pure-function-v2", "exported-pure-function-v3", "exported-pure-function-v4", "exported-pure-function-v5", "exported-pure-function-v6", "exported-pure-function-v7"],
} as const;
/** M85 bounds for the v2 target: sibling modules followed, import depth, structural type nesting. */
export const MAX_IMPORT_MODULES = 4;
export const MAX_IMPORT_DEPTH = 2;
export const MAX_TYPE_DEPTH = 3;
export const MAX_TYPE_MEMBERS = 16;
/** M90 (v4 target only): wider structural bounds (v1-v3 keep 3 / 16). */
export const MAX_TYPE_DEPTH_V4 = 6;
export const MAX_TYPE_MEMBERS_V4 = 32;
/** M90 (v4 target only): the built-in generic plain-data references. */
export const V4_GENERICS: ReadonlySet<string> = new Set(["Array", "ReadonlyArray", "Readonly", "Partial", "Record", "Pick", "Omit"]);
/** M97 (v7 target only): the built-in keyed collections (global names only). */
export const V7_COLLECTIONS: ReadonlySet<string> = new Set(["Map", "ReadonlyMap", "Set", "ReadonlySet"]);

// Named refusals (each one is a distinct, stable reason string in Job A's refusal lines).
export const TEST_TARGET_NOT_FOUND = "test_target_not_found";
export const TEST_TARGET_NOT_EXPORTED = "test_target_not_exported";
export const TEST_TARGET_ASYNC = "test_target_async";
export const TEST_TARGET_IO = "test_target_io";
export const TEST_TARGET_DATE_LOCAL = "test_target_date_local";
export const TEST_TARGET_IMPURE = "test_target_impure";
export const TEST_TARGET_SIGNATURE = "test_target_signature";
export const TEST_TARGET_TOO_LARGE = "test_target_too_large";
export const TEST_CHECK_REFUSED = "test_check_refused";
export const SELF_PROTECTED_PATH = "self_protected_path";
export const TEST_EXISTING_REFUSALS: ReadonlySet<string> = new Set([TEST_TARGET_NOT_FOUND, TEST_TARGET_NOT_EXPORTED, TEST_TARGET_ASYNC, TEST_TARGET_IO, TEST_TARGET_DATE_LOCAL, TEST_TARGET_IMPURE, TEST_TARGET_SIGNATURE, TEST_TARGET_TOO_LARGE, TEST_CHECK_REFUSED, SELF_PROTECTED_PATH]);
/** When several apply, the reported one is the first in this order. */
const PRIORITY = [TEST_TARGET_ASYNC, TEST_TARGET_IO, TEST_TARGET_DATE_LOCAL, TEST_TARGET_IMPURE, TEST_TARGET_TOO_LARGE] as const;

/** Parameter and return types: the ADD_FUNCTION vocabulary plus boolean arrays (each has a stub default). */
const TYPES = /^(?:readonly )?(?:string|number|boolean)(?:\[\])?$/;
export const MAX_PARAMS = 4;
/** The analysis follows at most this many module functions (the target included) and module consts. */
export const MAX_FUNCTIONS = 12;
export const MAX_CONSTS = 24;

const IO_GLOBALS = new Set(["process", "console", "require", "module", "exports", "__dirname", "__filename", "globalThis", "global", "window", "self", "document", "navigator", "location", "fetch", "XMLHttpRequest", "WebSocket", "EventSource", "setTimeout", "setInterval", "setImmediate", "clearTimeout", "clearInterval", "clearImmediate", "queueMicrotask", "crypto", "performance", "localStorage", "sessionStorage", "indexedDB", "caches", "Deno", "Bun", "Worker", "SharedArrayBuffer", "Atomics", "WebAssembly"]);
/** Locale/time-zone dependent: refused as date-local (the runner's zone and ICU data decide the result). */
const LOCAL_TIME_GLOBALS = new Set(["Intl"]);
const PURE_GLOBALS = new Set(["undefined", "NaN", "Infinity", "Number", "String", "Boolean", "Array", "Object", "JSON", "Math", "Error", "TypeError", "RangeError", "SyntaxError", "RegExp", "Map", "Set", "Date", "BigInt", "parseInt", "parseFloat", "isNaN", "isFinite", "encodeURIComponent", "decodeURIComponent"]);
const PURE_NEW = new Set(["Error", "TypeError", "RangeError", "SyntaxError", "Map", "Set", "Array", "RegExp", "Date"]);
const OBJECT_OK = new Set(["keys", "values", "entries", "fromEntries", "is", "hasOwn"]);
const MUTATORS = new Set(["push", "pop", "shift", "unshift", "splice", "sort", "reverse", "fill", "copyWithin", "set", "add", "delete", "clear", "compile"]);
const FRESH_METHODS = new Set(["slice", "map", "filter", "concat", "split", "flat", "flatMap", "toSorted", "toReversed", "toSpliced", "with", "keys", "values", "entries", "match", "matchAll"]);
/** Auditor #466: built-in string-producing methods (a built-in receiver gives a primitive, so a fresh-method chain stays built-in). */
const STRING_RESULT = new Set(["trim", "trimStart", "trimEnd", "toLowerCase", "toUpperCase", "padStart", "padEnd", "replace", "replaceAll", "repeat", "join", "toString", "toFixed", "toPrecision", "normalize", "substring", "substr", "charAt", "toISOString"]);
/** Auditor #466: stack text depends on file paths and line numbers of the checkout, not on the arguments. */
const STACK_NAMES = new Set(["stack", "captureStackTrace", "stackTraceLimit", "prepareStackTrace"]);
const NODE_BUILTINS = /^(?:node:.*|assert|async_hooks|buffer|child_process|cluster|console|constants|crypto|dgram|diagnostics_channel|dns|domain|events|fs|fs\/promises|http|http2|https|inspector|module|net|os|path|perf_hooks|process|punycode|querystring|readline|repl|stream|stream\/promises|string_decoder|sys|timers|tls|trace_events|tty|url|util|v8|vm|wasi|worker_threads|zlib)$/;

const isProtected = (path: string) => PROTECTED_SELF.some((x) => x.pattern.test(path));
const exported = (n: ts.Node) => ts.canHaveModifiers(n) && (ts.getModifiers(n) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
const hasMod = (n: ts.Node, k: ts.SyntaxKind) => ts.canHaveModifiers(n) && (ts.getModifiers(n) ?? []).some((m) => m.kind === k);

interface ModuleIndex {
  fns: Map<string, ts.FunctionDeclaration[]>;
  consts: Map<string, ts.VariableDeclaration>;
  /** module-level let/var, classes, namespaces: state the analysis does not follow */
  mutable: Set<string>;
  enums: Set<string>;
  imports: Map<string, { spec: string; typeOnly: boolean; imported?: string }>;
  /** M85: non-generic interfaces and type aliases declared in the module (name -> declaration) */
  types: Map<string, ts.InterfaceDeclaration | ts.TypeAliasDeclaration | null>;
  /** module names that are mutated (assigned through or receiver of a mutating call) anywhere in the module */
  mutated: Set<string>;
  exportNames: Set<string>;
}

function rootName(e: ts.Expression): ts.Expression {
  let x = e;
  for (;;) {
    if (ts.isPropertyAccessExpression(x) || ts.isElementAccessExpression(x) || ts.isNonNullExpression(x) || ts.isParenthesizedExpression(x) || ts.isAsExpression(x) || ts.isSatisfiesExpression(x)) x = x.expression;
    else return x;
  }
}

/** M97: property / element steps from `e` down to its root (parentheses, `!`, `as`, `satisfies` do not count). */
function accessDepth(e: ts.Expression): number {
  let x = e;
  let n = 0;
  for (;;) {
    if (ts.isPropertyAccessExpression(x) || ts.isElementAccessExpression(x)) { n += 1; x = x.expression; }
    else if (ts.isNonNullExpression(x) || ts.isParenthesizedExpression(x) || ts.isAsExpression(x) || ts.isSatisfiesExpression(x)) x = x.expression;
    else return n;
  }
}

function indexModule(sf: ts.SourceFile): ModuleIndex {
  const idx: ModuleIndex = { fns: new Map(), consts: new Map(), mutable: new Set(), enums: new Set(), imports: new Map(), mutated: new Set(), exportNames: new Set(), types: new Map() };
  for (const s of sf.statements) {
    if (ts.isFunctionDeclaration(s) && s.name) { const l = idx.fns.get(s.name.text) ?? []; l.push(s); idx.fns.set(s.name.text, l); if (exported(s) && !hasMod(s, ts.SyntaxKind.DefaultKeyword)) idx.exportNames.add(s.name.text); }
    else if (ts.isVariableStatement(s)) {
      const isConst = (s.declarationList.flags & ts.NodeFlags.Const) !== 0;
      for (const d of s.declarationList.declarations) {
        const names: string[] = [];
        const collect = (b: ts.BindingName) => { if (ts.isIdentifier(b)) names.push(b.text); else for (const el of b.elements) if (!ts.isOmittedExpression(el)) collect(el.name); };
        collect(d.name);
        for (const n of names) { if (isConst && ts.isIdentifier(d.name) && d.initializer) idx.consts.set(n, d); else idx.mutable.add(n); if (exported(s)) idx.exportNames.add(n); }
      }
    } else if (ts.isClassDeclaration(s) && s.name) idx.mutable.add(s.name.text);
    else if (ts.isEnumDeclaration(s)) idx.enums.add(s.name.text);
    else if (ts.isInterfaceDeclaration(s) || ts.isTypeAliasDeclaration(s)) idx.types.set(s.name.text, idx.types.has(s.name.text) || s.typeParameters?.length || (ts.isInterfaceDeclaration(s) && s.heritageClauses?.length) ? null : s);
    else if (ts.isModuleDeclaration(s) && ts.isIdentifier(s.name)) idx.mutable.add(s.name.text);
    else if (ts.isImportDeclaration(s) && ts.isStringLiteral(s.moduleSpecifier)) {
      const c = s.importClause; const spec = s.moduleSpecifier.text;
      if (!c) continue;
      if (c.name) idx.imports.set(c.name.text, { spec, typeOnly: !!c.isTypeOnly });
      const nb = c.namedBindings;
      if (nb && ts.isNamespaceImport(nb)) idx.imports.set(nb.name.text, { spec, typeOnly: !!c.isTypeOnly });
      if (nb && ts.isNamedImports(nb)) for (const el of nb.elements) idx.imports.set(el.name.text, { spec, typeOnly: !!c.isTypeOnly || el.isTypeOnly, imported: (el.propertyName ?? el.name).text });
    } else if (ts.isImportEqualsDeclaration(s)) idx.mutable.add(s.name.text);
    else if (ts.isExportDeclaration(s) && !s.isTypeOnly && !s.moduleSpecifier && s.exportClause && ts.isNamedExports(s.exportClause))
      for (const el of s.exportClause.elements) if (!el.isTypeOnly && !el.propertyName) idx.exportNames.add(el.name.text);
  }
  const v = (n: ts.Node): void => {
    if (ts.isBinaryExpression(n) && n.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && n.operatorToken.kind <= ts.SyntaxKind.LastAssignment) {
      const r = rootName(n.left); if (ts.isIdentifier(r)) idx.mutated.add(r.text);
    }
    if ((ts.isPrefixUnaryExpression(n) || ts.isPostfixUnaryExpression(n)) && (n.operator === ts.SyntaxKind.PlusPlusToken || n.operator === ts.SyntaxKind.MinusMinusToken)) {
      const r = rootName(n.operand); if (ts.isIdentifier(r)) idx.mutated.add(r.text);
    }
    if (ts.isDeleteExpression(n)) { const r = rootName(n.expression); if (ts.isIdentifier(r)) idx.mutated.add(r.text); }
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression)) {
      const m = n.expression.name.text;
      if (MUTATORS.has(m)) { const r = rootName(n.expression.expression); if (ts.isIdentifier(r)) idx.mutated.add(r.text); }
      if (ts.isIdentifier(n.expression.expression) && n.expression.expression.text === "Object" && !OBJECT_OK.has(m) && n.arguments[0]) { const r = rootName(n.arguments[0]); if (ts.isIdentifier(r)) idx.mutated.add(r.text); }
    }
    ts.forEachChild(n, v);
  };
  v(sf);
  return idx;
}

/** Is `n` an identifier in an expression (value) position, i.e. a reference the analysis must resolve? */
/**
 * #466 (Auditor ruling on Date setters): a setter on a FRESH LOCAL Date is sound under exact conditions, so the
 * TEST_EXISTING walk no longer refuses it by name - in v7 ONLY (decision #466: approved / pending versions never widen
 * beyond main, so v1-v6 keep refusing every Date setter; the Date-to-string refusal below applies to every version). `dateRefusal` (learned-complex.ts, shared with the
 * DATE function spec) is unchanged; this layer only removes the setter refusal for call sites proven fresh:
 * (a) the receiver is a `const` / `let` declared in the same function as `new Date(arg, ...)` with at least one argument
 *     (no `new Date()`, nothing fed by Date.now / performance - those keep their own refusals), `Date` is the global
 *     (no declaration named Date anywhere in the file), and no other declaration of the name exists in that function;
 * (b) the setter is `setTime` or `setUTC*` only - local-time setters (setDate, setHours, ...), local getters and
 *     toString / toLocale* keep their refusals;
 * (c) the Date never escapes before a setter runs: any use other than a called UTC read (getTime / valueOf /
 *     toISOString / getUTC*), a comparison or subtraction operand, a `new Date(d)` copy argument, or `return d` is an
 *     escape (call argument, container / property store, alias, destructuring, spread, template, reassignment). A
 *     reference from a nested function (closure capture) disables every setter on that Date. A setter is kept only if
 *     it ends before every escape in source order and no loop repeats both without re-creating the Date; returning
 *     after the mutations is fine;
 * (d) `Date.prototype` patches stay refused by the global-patch check of the walk.
 */
const TE_LOCAL_DATE_READS = /^(?:getFullYear|getYear|getMonth|getDate|getDay|getHours|getMinutes|getSeconds|getMilliseconds|getTimezoneOffset|toLocaleString|toLocaleDateString|toLocaleTimeString|toDateString|toTimeString|toUTCString|toJSON)$/;
const TE_DATE_SETTERS = /^set(?:UTC)?(?:FullYear|Year|Month|Date|Hours|Minutes|Seconds|Milliseconds|Time)$/;
const TE_UTC_SETTER = /^(?:setTime|setUTC(?:FullYear|Month|Date|Hours|Minutes|Seconds|Milliseconds))$/;
const TE_DATE_SAFE_READ = /^(?:getTime|valueOf|toISOString|getUTC(?:FullYear|Month|Date|Day|Hours|Minutes|Seconds|Milliseconds))$/;
const TE_DATE_SAFE_OP = new Set([ts.SyntaxKind.LessThanToken, ts.SyntaxKind.LessThanEqualsToken, ts.SyntaxKind.GreaterThanToken, ts.SyntaxKind.GreaterThanEqualsToken, ts.SyntaxKind.MinusToken, ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken]);
const teFnLike = (n: ts.Node): n is ts.FunctionLikeDeclaration => ts.isFunctionDeclaration(n) || ts.isFunctionExpression(n) || ts.isArrowFunction(n) || ts.isMethodDeclaration(n) || ts.isGetAccessor(n) || ts.isSetAccessor(n) || ts.isConstructorDeclaration(n);
function teScopeOf(n: ts.Node): ts.Node | undefined {
  for (let p = n.parent; p; p = p.parent) if (teFnLike(p)) return p;
  return undefined;
}
const teDeclaresDate = new WeakMap<ts.SourceFile, boolean>();
function teFileDeclares(sf: ts.SourceFile, name: string): boolean {
  if (name === "Date" && teDeclaresDate.has(sf)) return teDeclaresDate.get(sf)!;
  let hit = false;
  const v = (n: ts.Node): void => {
    if (hit) return;
    const nm = (n as { name?: ts.Node }).name;
    if (nm && ts.isIdentifier(nm) && nm.text === name && (ts.isVariableDeclaration(n) || ts.isParameter(n) || ts.isBindingElement(n) || ts.isFunctionDeclaration(n) || ts.isFunctionExpression(n) || ts.isClassDeclaration(n) || ts.isClassExpression(n) || ts.isImportSpecifier(n) || ts.isImportClause(n) || ts.isNamespaceImport(n) || ts.isEnumDeclaration(n) || ts.isModuleDeclaration(n) || ts.isImportEqualsDeclaration(n))) hit = true;
    ts.forEachChild(n, v);
  };
  v(sf);
  if (name === "Date") teDeclaresDate.set(sf, hit);
  return hit;
}
/** Loops whose repeated part (condition / incrementor / body; not a for-initializer) contains n, up to scope. */
function teLoops(n: ts.Node, scope: ts.Node): ts.Node[] {
  const out: ts.Node[] = [];
  let c: ts.Node = n;
  for (let p = n.parent; p && c !== scope; c = p, p = p.parent) {
    if (ts.isForStatement(p)) { if (c !== p.initializer) out.push(p); }
    else if (ts.isForOfStatement(p) || ts.isForInStatement(p)) { if (c === p.statement) out.push(p); }
    else if (ts.isWhileStatement(p) || ts.isDoStatement(p)) out.push(p);
    if (p === scope) break;
  }
  return out;
}
/** The setter property-access nodes (`d.setUTCDate`) inside root that act on a fresh local Date (see above). */
export function freshDateSetters(root: ts.Node, scopeFn?: ts.Node): Set<ts.Node> {
  const ok = new Set<ts.Node>();
  const sf = root.getSourceFile();
  if (teFileDeclares(sf, "Date")) return ok;
  const scopes: ts.Node[] = scopeFn ? [scopeFn] : [];
  const coll = (n: ts.Node): void => { if (teFnLike(n)) scopes.push(n); ts.forEachChild(n, coll); };
  coll(root);
  for (const S of scopes) {
    const body = (S as ts.FunctionLikeDeclaration).body;
    if (!body) continue;
    const decls: ts.VariableDeclaration[] = [];
    const findDecls = (n: ts.Node): void => {
      if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer && teScopeOf(n) === S) decls.push(n);
      ts.forEachChild(n, findDecls);
    };
    findDecls(body);
    for (const V of decls) {
      const init = V.initializer!;
      if (!ts.isNewExpression(init) || !ts.isIdentifier(init.expression) || init.expression.text !== "Date") continue;
      const args = init.arguments ?? ts.factory.createNodeArray();
      if (args.length < 1) continue;
      const fedByClock = (n: ts.Node): boolean => (ts.isIdentifier(n) && (n.text === "performance" || (n.text === "Date" && !(ts.isPropertyAccessExpression(n.parent) && n.parent.expression === n && n.parent.name.text === "UTC")))) || !!ts.forEachChild(n, (k) => fedByClock(k) || undefined);
      if (args.some((x) => fedByClock(x) || dateRefusal(x) !== null)) continue;
      const list = V.parent;
      if (!ts.isVariableDeclarationList(list) || !(list.flags & (ts.NodeFlags.Const | ts.NodeFlags.Let))) continue;
      const name = (V.name as ts.Identifier).text;
      let shadow = false;
      const refs: ts.Identifier[] = [];
      const scan = (n: ts.Node): void => {
        const nm = (n as { name?: ts.Node }).name;
        if (n !== V && nm && ts.isIdentifier(nm) && nm.text === name && (ts.isVariableDeclaration(n) || ts.isParameter(n) || ts.isBindingElement(n) || ts.isFunctionDeclaration(n) || ts.isFunctionExpression(n) || ts.isClassDeclaration(n) || ts.isClassExpression(n))) shadow = true;
        if (ts.isCatchClause(n) && n.variableDeclaration && ts.isIdentifier(n.variableDeclaration.name) && n.variableDeclaration.name.text === name) shadow = true;
        if (ts.isIdentifier(n) && n.text === name && n !== V.name && isValueReference(n)) refs.push(n);
        ts.forEachChild(n, scan);
      };
      scan(S);
      if (shadow) continue;
      const setters: ts.PropertyAccessExpression[] = [];
      const escapes: ts.Node[] = [];
      let captured = false;
      for (const r of refs) {
        if (teScopeOf(r) !== S) { captured = true; break; }
        const p = r.parent;
        if (ts.isPropertyAccessExpression(p) && p.expression === r && ts.isIdentifier(p.name) && ts.isCallExpression(p.parent) && p.parent.expression === p) {
          if (TE_UTC_SETTER.test(p.name.text)) { setters.push(p); continue; }
          if (TE_DATE_SAFE_READ.test(p.name.text)) continue;
        } else if (ts.isBinaryExpression(p) && TE_DATE_SAFE_OP.has(p.operatorToken.kind)) continue;
        else if (ts.isNewExpression(p) && ts.isIdentifier(p.expression) && p.expression.text === "Date" && (p.arguments ?? ts.factory.createNodeArray<ts.Expression>()).includes(r)) continue;
        else if (ts.isReturnStatement(p) && p.expression === r) continue;
        escapes.push(r);
      }
      if (captured) continue;
      const vLoops = new Set(teLoops(V, S));
      for (const st of setters) {
        const sLoops = teLoops(st, S);
        const safe = escapes.every((e) => st.parent.end <= e.getStart(sf) && !teLoops(e, S).some((l) => sLoops.includes(l) && !vLoops.has(l)));
        if (safe) ok.add(st);
      }
    }
  }
  return ok;
}
/**
 * #466 (Auditor ruling, item b): a Date converted to a string by toString is local-time (zone-dependent) like
 * toLocale* / toDateString. Refused (date_local_time) when the value is Date-valued as far as the syntax shows: a
 * `new Date(..)`, a call of a function of the file annotated to return Date, or a name some declaration of which in
 * the file is annotated Date or initialized Date-valued; and it is converted by `.toString()`, `String(x)`, a
 * template span or `+` / `+=` (for the implicit conversions only an exact `Date` - a `new Date(..)`, a name annotated
 * exactly `Date` or initialized with one - counts; a `Date | string` union converted implicitly is left as at main).
 * Name-based (no type checker), so it may over-refuse; a Date reached through a property or a container is not
 * followed (see the PR body).
 */
function teDateish(e: ts.Expression, sf: ts.SourceFile, depth = 0, exact = false): boolean {
  while (ts.isParenthesizedExpression(e) || ts.isAsExpression(e) || ts.isNonNullExpression(e) || ts.isSatisfiesExpression(e)) e = e.expression;
  if (depth > 4) return false;
  const dateType = (t: ts.TypeNode | undefined): boolean => {
    let hit = false;
    const v = (n: ts.Node): void => { if (ts.isTypeReferenceNode(n) && ts.isIdentifier(n.typeName) && n.typeName.text === "Date") hit = true; ts.forEachChild(n, v); };
    if (t) { if (exact) return ts.isTypeReferenceNode(t) && ts.isIdentifier(t.typeName) && t.typeName.text === "Date"; v(t); }
    return hit;
  };
  if (ts.isNewExpression(e)) return ts.isIdentifier(e.expression) && e.expression.text === "Date";
  const named = (name: string, pick: (n: ts.Node) => boolean): boolean => {
    let hit = false;
    const v = (n: ts.Node): void => { const d = (n as { name?: ts.Node }).name; if (!hit && d && ts.isIdentifier(d) && d.text === name && pick(n)) hit = true; if (!hit) ts.forEachChild(n, v); };
    v(sf);
    return hit;
  };
  if (ts.isCallExpression(e) && ts.isIdentifier(e.expression)) {
    const fn = e.expression.text;
    return named(fn, (n) => (ts.isFunctionDeclaration(n) && dateType(n.type)) || (ts.isVariableDeclaration(n) && !!n.initializer && (ts.isArrowFunction(n.initializer) || ts.isFunctionExpression(n.initializer)) && (dateType(n.initializer.type) || (!n.initializer.type && ts.isArrowFunction(n.initializer) && !ts.isBlock(n.initializer.body) && teDateish(n.initializer.body, sf, depth + 1, exact)))));
  }
  if (ts.isIdentifier(e)) {
    // Resolve to the innermost lexically enclosing declaration of the name (not any same-named declaration in the file).
    const nm = e.text, at = e.getStart(sf);
    let best: ts.VariableDeclaration | ts.ParameterDeclaration | undefined, span = Infinity;
    const holder = (n: ts.Node): ts.Node => {
      let p: ts.Node = n.parent;
      if (ts.isParameter(n)) return p;
      while (!(ts.isBlock(p) || ts.isSourceFile(p) || ts.isForStatement(p) || ts.isForOfStatement(p) || ts.isForInStatement(p) || ts.isCatchClause(p) || teFnLike(p))) p = p.parent;
      return p;
    };
    const v = (n: ts.Node): void => {
      if ((ts.isVariableDeclaration(n) || ts.isParameter(n)) && ts.isIdentifier(n.name) && n.name.text === nm) {
        const h = holder(n);
        if (h.getStart(sf) <= at && at < h.end && h.end - h.getStart(sf) < span) { best = n; span = h.end - h.getStart(sf); }
      }
      ts.forEachChild(n, v);
    };
    v(sf);
    const b = best as ts.VariableDeclaration | ts.ParameterDeclaration | undefined;
    return !!b && (dateType(b.type) || (!!b.initializer && teDateish(b.initializer, sf, depth + 1, exact)));
  }
  return false;
}
function teDateToString(node: ts.Node): boolean {
  const sf = node.getSourceFile();
  let hit = false;
  const v = (n: ts.Node): void => {
    if (hit) return;
    if (ts.isCallExpression(n)) {
      const c = n.expression;
      if ((ts.isPropertyAccessExpression(c) && ts.isIdentifier(c.name) && c.name.text === "toString" && teDateish(c.expression, sf)) ||
        (ts.isElementAccessExpression(c) && ts.isStringLiteralLike(c.argumentExpression) && c.argumentExpression.text === "toString" && teDateish(c.expression, sf)) ||
        (ts.isIdentifier(c) && c.text === "String" && n.arguments.some((x) => teDateish(x, sf, 0, true)))) hit = true;
    }
    if (ts.isTemplateSpan(n) && teDateish(n.expression, sf, 0, true)) hit = true;
    if (ts.isBinaryExpression(n) && (n.operatorToken.kind === ts.SyntaxKind.PlusToken || n.operatorToken.kind === ts.SyntaxKind.PlusEqualsToken) && (teDateish(n.left, sf, 0, true) || teDateish(n.right, sf, 0, true))) hit = true;
    ts.forEachChild(n, v);
  };
  v(node);
  return hit;
}
/** dateRefusal, plus Date-to-string conversions (teDateToString, every version); with `freshSetters` (v7 only), setter calls proven to act on a fresh local Date (freshDateSetters) are not refused. */
function dateRefusalTE(node: ts.Node, scopeFn: ts.Node | undefined, freshSetters: boolean, tested?: ts.Node, loadOnly = false): string | null {
  const r = dateRefusal(node);
  if (r === DATE_NOW || r === DATE_LOCAL_TIME) return r;
  if (teDateToString(node)) return DATE_LOCAL_TIME;
  // Auditor #466 (4th review), every version: the fail-closed Date-use allowlist (teDateUseProblem).
  if (teDateUseProblem(node, tested, loadOnly)) return DATE_LOCAL_TIME;
  // Decision #466: the fresh-Date setter allowance is v7 only; v1-v6 refuse every Date setter, as at main.
  if (r !== DATE_SETTER || !freshSetters) return r;
  const ok = freshDateSetters(node, scopeFn);
  if (ok.size === 0) return r;
  // r === DATE_SETTER means no clock read; re-scan for a local-time read or a setter that is not proven fresh.
  let local = false, setter = false;
  const isDate = (e: ts.Expression) => ts.isIdentifier(e) && e.text === "Date";
  const v = (n: ts.Node): void => {
    if (ts.isNewExpression(n) && isDate(n.expression) && (n.arguments?.length ?? 0) > 1) local = true;
    if (ts.isPropertyAccessExpression(n) && ts.isIdentifier(n.name)) {
      if (isDate(n.expression) && n.name.text === "parse") local = true;
      else if (isDate(n.expression) && n.name.text === "now") local = true;
      else if (TE_LOCAL_DATE_READS.test(n.name.text)) local = true;
      else if (TE_DATE_SETTERS.test(n.name.text) && !ok.has(n)) setter = true;
    }
    ts.forEachChild(n, v);
  };
  v(node);
  return local ? DATE_LOCAL_TIME : setter ? DATE_SETTER : null;
}

/**
 * Auditor #466 (4th review), FAIL-CLOSED DATE USE, every version (v1-v7; only adds refusals). A Date object is
 * zone-free only through its UTC surface. Instead of naming the conversions that read the zone (toString, String(),
 * templates, `+`, join, concat, replace, padEnd, encodeURIComponent, `d["getHours"]`, Reflect.apply, ...), a
 * Date-VALUED expression may appear only
 * - as the receiver of a dotted call of setTime / setUTC* / getUTC* / getTime / valueOf / toISOString
 *   (`d.getTime()`, `d?.getTime()`; the setters stay refused by dateRefusal below v7 and outside a proven-fresh local);
 * - as the bare value of `return` (or an arrow's expression body) of the tested function, or of a non-exported
 *   named function / const arrow of the same file every reference of which is a direct call (`g(..)`);
 * - as the initializer of a simple local or non-exported module binding (`const d = new Date(x)`) or the right side
 *   of a plain `=` to such a name (the binding is then Date-valued, its uses held to the same rule);
 * - through parentheses, `!` (non-null), `as` / `satisfies` a Date type, a `?:` branch, `??` / `||` / `&&` operands,
 *   the right side of a comma, and as an expression statement (value discarded).
 * Everything else refuses (date_local_time): element access, array / object literals, call or `new` arguments
 * (including `new Date(d)`, `String(d)`, `JSON.stringify(d)`, `Object.assign(d, ..)`, `Reflect.apply(.., d, ..)`),
 * spread, templates, every operator (`+`, `<`, `-`, `==`, `!`), `as` another type, property stores, `.call` / `.bind`.
 * Date-VALUED (syntax only, no type checker): `new Date(..)`; a name whose innermost declaration is annotated with a
 * type mentioning Date, initialized or `=`-assigned a Date-valued expression; a call of a same-file function
 * annotated to return a type mentioning Date or returning a Date-valued expression; the wrappers above.
 * The `Date` global itself may only be the callee of `new Date(..)` or the receiver of `Date.UTC(..)`
 * (Date.now / Date.parse stay refused by dateRefusal): `Date()` (a local-time string), `Date.prototype.getHours.call`,
 * `const D = Date`, `Reflect.construct(Date, ..)` refuse. A file declaring its own `Date` refuses any Date use.
 * DATE STRINGS (blocker 3): `new Date(x)` with one argument only when x is provably not a zoneless date string: a
 * number expression (numeric literal, arithmetic, unary +/-, Date.UTC, getTime / valueOf / getUTC*, Math.*, Number,
 * parseInt / parseFloat, `.length`, a const / never-reassigned let initialized so), an ISO literal with an explicit Z
 * or offset or a date-only YYYY-MM-DD (ISO_DATE_TEXT, real calendar values), a const naming one; or - tested function
 * only, never a load-time callee - one of the tested function's own never-reassigned plain parameters, which the
 * test-side check (dateArgProblem, Job A and Job B) then holds to such a literal in every call of the test.
 * Anything else (a helper's parameter, a template, a property, a call result) refuses. `new Date(a, b, ..)` (local
 * fields) and `new Date()` (the clock) stay refused by dateRefusal.
 */
const TE_DATE_USE_CALL = /^(?:setTime|setUTC(?:FullYear|Month|Date|Hours|Minutes|Seconds|Milliseconds)|getTime|valueOf|toISOString|getUTC(?:FullYear|Month|Date|Day|Hours|Minutes|Seconds|Milliseconds))$/;
const TE_DATE_NUM_READ = /^(?:getTime|valueOf|getUTC(?:FullYear|Month|Date|Day|Hours|Minutes|Seconds|Milliseconds))$/;
const TE_ARITH = new Set([ts.SyntaxKind.MinusToken, ts.SyntaxKind.AsteriskToken, ts.SyntaxKind.SlashToken, ts.SyntaxKind.PercentToken, ts.SyntaxKind.AsteriskAsteriskToken, ts.SyntaxKind.AmpersandToken, ts.SyntaxKind.BarToken, ts.SyntaxKind.CaretToken, ts.SyntaxKind.LessThanLessThanToken, ts.SyntaxKind.GreaterThanGreaterThanToken, ts.SyntaxKind.GreaterThanGreaterThanGreaterThanToken]);
const TE_BIND_ASSIGN = new Set([ts.SyntaxKind.EqualsToken, ts.SyntaxKind.QuestionQuestionEqualsToken, ts.SyntaxKind.BarBarEqualsToken, ts.SyntaxKind.AmpersandAmpersandEqualsToken]);
interface TeDateIdx {
  sf: ts.SourceFile;
  decls: Map<string, { d: ts.Node; h: ts.Node; s: number; e: number }[]>;
  refs: Map<string, ts.Identifier[]>;
  assigns: Map<string, ts.BinaryExpression[]>;
  exported: Set<string>;
  dateDeclared: boolean;
  dv: Map<ts.Node, boolean>;
  res: Map<ts.Identifier, ts.Node | null>;
  /** tested functions found returning a Date inside a literal (checked by dateImportedBack like a Date return) */
  containerReturn: Set<ts.Node>;
}
const teDateIdxCache = new WeakMap<ts.SourceFile, TeDateIdx>();
function teDateIdx(sf: ts.SourceFile): TeDateIdx {
  const hit = teDateIdxCache.get(sf);
  if (hit) return hit;
  const X: TeDateIdx = { sf, decls: new Map(), refs: new Map(), assigns: new Map(), exported: new Set(), dateDeclared: teFileDeclares(sf, "Date"), dv: new Map(), res: new Map(), containerReturn: new Set() };
  const push = <T>(m: Map<string, T[]>, k: string, v: T) => { const l = m.get(k); if (l) l.push(v); else m.set(k, [v]); };
  const blockHolder = (n: ts.Node): ts.Node => {
    let p: ts.Node = n.parent;
    while (!(ts.isBlock(p) || ts.isSourceFile(p) || ts.isModuleBlock(p) || ts.isCaseBlock(p) || ts.isForStatement(p) || ts.isForOfStatement(p) || ts.isForInStatement(p) || ts.isCatchClause(p) || teFnLike(p))) p = p.parent;
    return p;
  };
  const holder = (n: ts.Node): ts.Node => {
    if (ts.isParameter(n)) return n.parent;
    if (ts.isVariableDeclaration(n) && ts.isVariableDeclarationList(n.parent) && !(n.parent.flags & (ts.NodeFlags.Let | ts.NodeFlags.Const)) && !ts.isCatchClause(n.parent)) return teScopeOf(n) ?? sf;
    if (ts.isBindingElement(n)) { let p: ts.Node = n; while (ts.isBindingElement(p) || ts.isObjectBindingPattern(p) || ts.isArrayBindingPattern(p)) p = p.parent; return holder(p); }
    if (ts.isImportSpecifier(n) || ts.isImportClause(n) || ts.isNamespaceImport(n) || ts.isImportEqualsDeclaration(n)) return sf;
    if ((ts.isFunctionExpression(n) || ts.isClassExpression(n))) return n;
    return blockHolder(n);
  };
  const v = (n: ts.Node): void => {
    const nm = (n as { name?: ts.Node }).name;
    if (nm && ts.isIdentifier(nm) && (ts.isVariableDeclaration(n) || ts.isParameter(n) || ts.isBindingElement(n) || ts.isFunctionDeclaration(n) || ts.isFunctionExpression(n) || ts.isClassDeclaration(n) || ts.isClassExpression(n) || ts.isImportSpecifier(n) || ts.isImportClause(n) || ts.isNamespaceImport(n) || ts.isEnumDeclaration(n) || ts.isModuleDeclaration(n) || ts.isImportEqualsDeclaration(n))) {
      const h = holder(n);
      push(X.decls, nm.text, { d: n, h, s: h.getStart(sf), e: h.end });
    }
    if (ts.isIdentifier(n) && isValueReference(n)) push(X.refs, n.text, n);
    if (ts.isBinaryExpression(n) && TE_BIND_ASSIGN.has(n.operatorToken.kind)) { const l = teUnwrap(n.left); if (ts.isIdentifier(l)) push(X.assigns, l.text, n); }
    if (ts.isExportSpecifier(n)) X.exported.add((n.propertyName ?? n.name).text);
    if (ts.isExportAssignment(n) && ts.isIdentifier(n.expression)) X.exported.add(n.expression.text);
    ts.forEachChild(n, v);
  };
  v(sf);
  teDateIdxCache.set(sf, X);
  return X;
}
function teUnwrap(e: ts.Expression): ts.Expression {
  while (ts.isParenthesizedExpression(e) || ts.isNonNullExpression(e)) e = e.expression;
  return e;
}
/** The innermost lexically enclosing declaration of a referenced name (null: a global or unknown name). */
function teResolve(X: TeDateIdx, id: ts.Identifier): ts.Node | null {
  if (X.res.has(id)) return X.res.get(id)!;
  const at = id.getStart(X.sf);
  let best: ts.Node | null = null, span = Infinity;
  for (const c of X.decls.get(id.text) ?? []) if (c.s <= at && at < c.e && c.e - c.s < span) { best = c.d; span = c.e - c.s; }
  X.res.set(id, best);
  return best;
}
const teDateType = (t: ts.TypeNode | undefined): boolean => {
  let hit = false;
  const v = (n: ts.Node): void => { if (ts.isTypeReferenceNode(n) && ts.isIdentifier(n.typeName) && n.typeName.text === "Date") hit = true; if (!hit) ts.forEachChild(n, v); };
  if (t) v(t);
  return hit;
};
/** A whole-type Date: `Date`, or a union of Date with other members (`Date | null`, `Date | string`). */
function teTopDateType(t: ts.TypeNode | undefined): boolean {
  if (!t) return false;
  while (ts.isParenthesizedTypeNode(t)) t = t.type;
  if (ts.isTypeReferenceNode(t)) return ts.isIdentifier(t.typeName) && t.typeName.text === "Date" && !t.typeArguments;
  return ts.isUnionTypeNode(t) && t.types.some((m) => teTopDateType(m));
}
/** A reference in a write position: `x = ..`, `x += ..`, `x++`, `[x] = ..`, `({ x } = ..)`, `for (x of ..)`. */
function teWriteRef(id: ts.Identifier): boolean {
  let c: ts.Node = id;
  for (;;) {
    const p = c.parent;
    if (!p) return false;
    if (ts.isParenthesizedExpression(p) || ts.isNonNullExpression(p) || ((ts.isAsExpression(p) || ts.isSatisfiesExpression(p) || ts.isTypeAssertionExpression(p)) && p.expression === c)) { c = p; continue; }
    if (ts.isArrayLiteralExpression(p) || ts.isSpreadElement(p) || ts.isSpreadAssignment(p) || ts.isObjectLiteralExpression(p) || (ts.isShorthandPropertyAssignment(p) && p.name === c) || (ts.isPropertyAssignment(p) && p.initializer === c)) { c = p; continue; }
    if (ts.isBinaryExpression(p) && p.left === c && p.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && p.operatorToken.kind <= ts.SyntaxKind.LastAssignment) return true;
    if ((ts.isForOfStatement(p) || ts.isForInStatement(p)) && p.initializer === c) return true;
    if ((ts.isPrefixUnaryExpression(p) || ts.isPostfixUnaryExpression(p)) && (p.operator === ts.SyntaxKind.PlusPlusToken || p.operator === ts.SyntaxKind.MinusMinusToken)) return true;
    return false;
  }
}
function teRefsOf(X: TeDateIdx, d: ts.Node, name: string): ts.Identifier[] {
  return (X.refs.get(name) ?? []).filter((r) => teResolve(X, r) === d);
}
function teAssignsOf(X: TeDateIdx, d: ts.Node, name: string): ts.BinaryExpression[] {
  return (X.assigns.get(name) ?? []).filter((b) => teResolve(X, teUnwrap(b.left) as ts.Identifier) === d);
}
function teNewDate(X: TeDateIdx, e: ts.Node): e is ts.NewExpression {
  if (!ts.isNewExpression(e)) return false;
  const c = teUnwrap(e.expression);
  return ts.isIdentifier(c) && c.text === "Date" && !teResolve(X, c);
}
/** The function a callee name resolves to in this file (a declaration, or a const / let initialized with one). */
function teCalleeFn(X: TeDateIdx, callee: ts.Expression): ts.FunctionLikeDeclaration | null {
  const c = teUnwrap(callee);
  if (!ts.isIdentifier(c)) return null;
  const d = teResolve(X, c);
  if (d && ts.isFunctionDeclaration(d)) return d;
  if (d && ts.isVariableDeclaration(d) && d.initializer) { const i = teUnwrap(d.initializer); if (ts.isArrowFunction(i) || ts.isFunctionExpression(i)) return i; }
  return null;
}
function teReturnsDate(X: TeDateIdx, f: ts.FunctionLikeDeclaration): boolean {
  if (teDateType(f.type)) return true;
  if (!f.body) return false;
  if (!ts.isBlock(f.body)) return teDateValued(X, f.body);
  let hit = false;
  const v = (n: ts.Node): void => { if (hit) return; if (ts.isReturnStatement(n) && n.expression && teScopeOf(n) === f && teDateValued(X, n.expression)) hit = true; ts.forEachChild(n, v); };
  v(f.body);
  return hit;
}
/** Date-VALUED as far as the syntax shows (see the block comment). A cycle counts as not Date-valued: a Date always starts at a `new Date(..)` or a Date-annotated name, both found directly. */
function teDateValued(X: TeDateIdx, e0: ts.Expression): boolean {
  const memo = X.dv.get(e0);
  if (memo !== undefined) return memo;
  X.dv.set(e0, false);
  const e = e0;
  let r = false;
  if (ts.isParenthesizedExpression(e) || ts.isNonNullExpression(e)) r = teDateValued(X, e.expression);
  else if (ts.isAsExpression(e) || ts.isSatisfiesExpression(e) || ts.isTypeAssertionExpression(e)) r = teDateType(e.type) || teDateValued(X, e.expression);
  else if (ts.isNewExpression(e)) r = teNewDate(X, e);
  else if (ts.isConditionalExpression(e)) r = teDateValued(X, e.whenTrue) || teDateValued(X, e.whenFalse);
  else if (ts.isBinaryExpression(e)) {
    const k = e.operatorToken.kind;
    if (k === ts.SyntaxKind.QuestionQuestionToken || k === ts.SyntaxKind.BarBarToken || k === ts.SyntaxKind.AmpersandAmpersandToken) r = teDateValued(X, e.left) || teDateValued(X, e.right);
    else if (k === ts.SyntaxKind.CommaToken) r = teDateValued(X, e.right);
    else if (TE_BIND_ASSIGN.has(k)) r = teDateValued(X, e.right) || (k !== ts.SyntaxKind.EqualsToken && teDateValued(X, e.left));
  } else if (ts.isCallExpression(e)) {
    const f = teCalleeFn(X, e.expression);
    r = !!f && teReturnsDate(X, f);
  } else if (ts.isIdentifier(e)) {
    const d = teResolve(X, e);
    if (d && (ts.isVariableDeclaration(d) || ts.isParameter(d)) && ts.isIdentifier(d.name)) {
      r = teDateType(d.type) || (!!d.initializer && teDateValued(X, d.initializer)) || teAssignsOf(X, d, e.text).some((b) => teDateValued(X, b.right))
        // the element of a for-of over a Date-holding value is held as a Date itself
        || (ts.isVariableDeclaration(d) && ts.isVariableDeclarationList(d.parent) && ts.isForOfStatement(d.parent.parent) && teDateValued(X, d.parent.parent.expression));
    }
  }
  X.dv.set(e0, r);
  return r;
}
function teExportedBinding(X: TeDateIdx, d: ts.VariableDeclaration | ts.FunctionDeclaration): boolean {
  if (ts.isFunctionDeclaration(d)) return hasMod(d, ts.SyntaxKind.ExportKeyword) || hasMod(d, ts.SyntaxKind.DefaultKeyword) || (!!d.name && X.exported.has(d.name.text));
  const st = d.parent?.parent;
  if (st && ts.isVariableStatement(st) && hasMod(st, ts.SyntaxKind.ExportKeyword)) return true;
  return ts.isIdentifier(d.name) && ts.isSourceFile(st?.parent ?? d) && X.exported.has(d.name.text);
}
/** Every reference of the function's name resolving to it is the direct callee of a call (`g(..)`). */
function teOnlyCalled(X: TeDateIdx, d: ts.Node, name: string): boolean {
  return teRefsOf(X, d, name).every((r) => ts.isCallExpression(r.parent) && r.parent.expression === r);
}
/** May function f hand a Date to its caller (`return d`)? `contained`: inside an array / object literal it returns. */
function teMayReturnDate(X: TeDateIdx, f: ts.Node | undefined, tested: ts.Node | undefined, contained = false): boolean {
  if (!f) return false;
  // A Date inside a returned literal: the tested function only, never referenced in its own file (the test alone
  // receives the literal; dateImportedBack keeps every other module the analysis read from importing it).
  if (contained) { if (f === tested) X.containerReturn.add(f); return f === tested && ts.isFunctionDeclaration(f) && !!f.name && teRefsOf(X, f, f.name.text).length === 0; }
  if (ts.isFunctionDeclaration(f) && f.name) {
    if (f === tested) return teOnlyCalled(X, f, f.name.text);
    return !teExportedBinding(X, f) && teOnlyCalled(X, f, f.name.text);
  }
  if ((ts.isArrowFunction(f) || ts.isFunctionExpression(f)) && ts.isVariableDeclaration(f.parent) && f.parent.initializer === f && ts.isIdentifier(f.parent.name) && ts.isVariableDeclarationList(f.parent.parent) && f.parent.parent.flags & ts.NodeFlags.Const) {
    return !teExportedBinding(X, f.parent) && teOnlyCalled(X, f.parent, f.parent.name.text);
  }
  return false;
}
/** Is this Date-valued expression used only as the allowlist permits? */
function teDateUseOk(X: TeDateIdx, n: ts.Expression, tested: ts.Node | undefined): boolean {
  let c: ts.Node = n;
  let contained = false;
  for (;;) {
    const p = c.parent;
    if (!p) return false;
    if (ts.isParenthesizedExpression(p) || ts.isNonNullExpression(p)) { c = p; continue; }
    // An element / property value of an array or object literal: allowed only when the literal (through the same
    // wrappers) is what the tested function returns (teMayReturnDate, contained).
    if (ts.isArrayLiteralExpression(p) || (ts.isPropertyAssignment(p) && p.initializer === c) || ts.isShorthandPropertyAssignment(p)) { contained = true; c = ts.isArrayLiteralExpression(p) ? p : p.parent; continue; }
    if (contained && !(ts.isConditionalExpression(p) || ts.isBinaryExpression(p) || ts.isReturnStatement(p) || ts.isArrowFunction(p) || ts.isAsExpression(p) || ts.isSatisfiesExpression(p) || ts.isTypeAssertionExpression(p))) return false;
    if (contained && (ts.isAsExpression(p) || ts.isSatisfiesExpression(p) || ts.isTypeAssertionExpression(p))) { c = p; continue; }
    if (contained && ts.isBinaryExpression(p) && !(p.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken || p.operatorToken.kind === ts.SyntaxKind.BarBarToken || p.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken)) return false;
    if (contained && ts.isReturnStatement(p)) return p.expression === c && teMayReturnDate(X, teScopeOf(p), tested, true);
    if (contained && ts.isArrowFunction(p)) return p.body === c && teMayReturnDate(X, p, tested, true);
    // A whole argument of a direct call of a function of this file, at a parameter whose whole type is Date: the
    // parameter is then a Date-valued name, its uses held to this same allowlist where that function is analyzed.
    if ((ts.isCallExpression(p) || ts.isNewExpression(p)) && p.expression !== c && ts.isCallExpression(p)) {
      const f = teCalleeFn(X, p.expression);
      const i = p.arguments.indexOf(c as ts.Expression);
      const prm = f && i >= 0 ? f.parameters[i] : undefined;
      return !!prm && ts.isIdentifier(prm.name) && !prm.dotDotDotToken && teTopDateType(prm.type) && !p.arguments.some(ts.isSpreadElement);
    }
    if ((ts.isAsExpression(p) || ts.isSatisfiesExpression(p) || ts.isTypeAssertionExpression(p)) && p.expression === c) { if (teTopDateType(p.type)) { c = p; continue; } return false; }
    if (ts.isConditionalExpression(p) && (p.whenTrue === c || p.whenFalse === c)) { c = p; continue; }
    if (ts.isBinaryExpression(p)) {
      const k = p.operatorToken.kind;
      if (k === ts.SyntaxKind.QuestionQuestionToken || k === ts.SyntaxKind.BarBarToken || k === ts.SyntaxKind.AmpersandAmpersandToken) { c = p; continue; }
      if (k === ts.SyntaxKind.CommaToken) { if (p.left === c) return true; c = p; continue; }
      // `d - e`, `d < e`, `d === e`: a numeric operator or relation reads a Date through valueOf (hint number), and
      // strict equality is identity - never `+`, `==` / `!=` (hint default: the zoned text) or compound assignment.
      if (TE_ARITH.has(k) || k === ts.SyntaxKind.LessThanToken || k === ts.SyntaxKind.LessThanEqualsToken || k === ts.SyntaxKind.GreaterThanToken || k === ts.SyntaxKind.GreaterThanEqualsToken || k === ts.SyntaxKind.EqualsEqualsEqualsToken || k === ts.SyntaxKind.ExclamationEqualsEqualsToken) return true;
      // the target of `=` / `??=` / `||=` / `&&=` (never `+=`): written, not read as text (the right side is checked itself)
      if (TE_BIND_ASSIGN.has(k) && p.left === c) return true;
      if (TE_BIND_ASSIGN.has(k) && p.right === c) {
        const l = teUnwrap(p.left);
        const d = ts.isIdentifier(l) ? teResolve(X, l) : null;
        if (d && ((ts.isVariableDeclaration(d) && !teExportedBinding(X, d)) || ts.isParameter(d))) { c = p; continue; }
      }
      return false;
    }
    // `for (const d of ds)`: each element is a Date-valued name (teDateValued), its uses held to this allowlist
    if (ts.isForOfStatement(p) && p.expression === c) return ts.isVariableDeclarationList(p.initializer) && p.initializer.declarations.length === 1 && ts.isIdentifier(p.initializer.declarations[0]!.name);
    if (ts.isExpressionStatement(p)) return true;
    // `!d`: a Date object is always truthy, so the boolean never reads the time zone
    if (ts.isPrefixUnaryExpression(p) && p.operator === ts.SyntaxKind.ExclamationToken) return true;
    if (ts.isPropertyAccessExpression(p) && p.expression === c) return TE_DATE_USE_CALL.test(p.name.text) && ts.isCallExpression(p.parent) && p.parent.expression === p;
    if (ts.isReturnStatement(p) && p.expression === c) return teMayReturnDate(X, teScopeOf(p), tested);
    if (ts.isArrowFunction(p) && p.body === c) return teMayReturnDate(X, p, tested);
    if (ts.isVariableDeclaration(p) && p.initializer === c) return ts.isIdentifier(p.name) && !teExportedBinding(X, p);
    return false;
  }
}
/** A number however the program runs (never a string `new Date(x)` would parse in local time). */
function teNumeric(X: TeDateIdx, e: ts.Expression, seen = new Set<ts.Node>()): boolean {
  e = teUnwrap(e);
  if (seen.has(e)) return false;
  seen.add(e);
  if (ts.isNumericLiteral(e) || ts.isBigIntLiteral(e)) return true;
  if (ts.isPrefixUnaryExpression(e)) return e.operator === ts.SyntaxKind.PlusToken || e.operator === ts.SyntaxKind.MinusToken || e.operator === ts.SyntaxKind.TildeToken;
  if (ts.isBinaryExpression(e)) {
    const k = e.operatorToken.kind;
    if (TE_ARITH.has(k)) return true;
    if (k === ts.SyntaxKind.PlusToken || k === ts.SyntaxKind.QuestionQuestionToken || k === ts.SyntaxKind.BarBarToken || k === ts.SyntaxKind.AmpersandAmpersandToken) return teNumeric(X, e.left, seen) && teNumeric(X, e.right, seen);
    if (k === ts.SyntaxKind.CommaToken) return teNumeric(X, e.right, seen);
    return false;
  }
  if (ts.isConditionalExpression(e)) return teNumeric(X, e.whenTrue, seen) && teNumeric(X, e.whenFalse, seen);
  if (ts.isPropertyAccessExpression(e) && e.name.text === "length" && !e.questionDotToken) return true;
  if (ts.isCallExpression(e)) {
    const c = teUnwrap(e.expression);
    const global = (id: ts.Expression, ...names: string[]) => ts.isIdentifier(id) && names.includes(id.text) && !teResolve(X, id);
    if (ts.isPropertyAccessExpression(c)) {
      if (global(c.expression, "Math")) return true;
      if (global(c.expression, "Date") && c.name.text === "UTC") return true;
      if (global(c.expression, "Number") && (c.name.text === "parseInt" || c.name.text === "parseFloat")) return true;
      return TE_DATE_NUM_READ.test(c.name.text) && teDateValued(X, c.expression);
    }
    return global(c, "Number", "parseInt", "parseFloat");
  }
  if (ts.isIdentifier(e)) {
    const d = teResolve(X, e);
    return !!d && ts.isVariableDeclaration(d) && ts.isIdentifier(d.name) && ts.isVariableDeclarationList(d.parent) && !!(d.parent.flags & ts.NodeFlags.Const) && !!d.initializer && teNumeric(X, d.initializer, seen);
  }
  return false;
}
function teValidCalendar(raw: string): boolean {
  const [y, mo, d] = raw.slice(0, 10).split("-").map(Number) as [number, number, number];
  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][mo - 1] ?? 0;
  if (mo < 1 || mo > 12 || d < 1 || d > days) return false;
  const t = /T(\d{2}):(\d{2})(?::(\d{2}))?/.exec(raw);
  if (t && (Number(t[1]) > 23 || Number(t[2]) > 59 || Number(t[3] ?? 0) > 59)) return false;
  const z = /([+-])(\d{2}):(\d{2})$/.exec(raw.slice(10));
  return !z || (Number(z[2]) <= 14 && Number(z[3]) <= 59);
}
/** An ISO date text `new Date` reads the same in every zone: date-only, or a time with Z / an explicit offset. */
export function teIsoText(raw: string): boolean {
  return raw.length <= 40 && ISO_DATE_TEXT.test(raw) && teValidCalendar(raw);
}
function teIsoLiteral(X: TeDateIdx, e: ts.Expression): boolean {
  e = teUnwrap(e);
  if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) return e.getText(X.sf).slice(1, -1) === e.text && teIsoText(e.text);
  if (ts.isIdentifier(e)) {
    const d = teResolve(X, e);
    return !!d && ts.isVariableDeclaration(d) && ts.isIdentifier(d.name) && ts.isVariableDeclarationList(d.parent) && !!(d.parent.flags & ts.NodeFlags.Const) && !!d.initializer && !ts.isIdentifier(teUnwrap(d.initializer)) && teIsoLiteral(X, d.initializer);
  }
  return false;
}
/** Does a parameter of f feed `new Date(..)` (teTestedParam / teIsoTemplateParam)? With a module that imports f back,
 *  f may be re-entered with a value that module built: the caller refuses (targetRefusal, dateImportedBack). */
function teParamFeedsDate(X: TeDateIdx, f: ts.Node): boolean {
  let hit = false;
  const v = (n: ts.Node): void => {
    if (hit) return;
    if (ts.isNewExpression(n) && teNewDate(X, n) && n.arguments?.length === 1 && (teTestedParam(X, n.arguments[0]!, f) >= 0 || teIsoTemplateParam(X, n.arguments[0]!, f) >= 0)) hit = true;
    ts.forEachChild(n, v);
  };
  const b = (f as ts.FunctionLikeDeclaration).body;
  if (b) v(b);
  return hit;
}
/** Can the tested function call itself again (directly, or through any function of its file it names, transitively)?
 *  Then its parameter may carry a value the function built itself, not the test's literal: no parameter provenance. */
const teReentrant = new WeakMap<ts.Node, boolean>();
function teSelfReached(X: TeDateIdx, tested: ts.Node): boolean {
  const memo = teReentrant.get(tested);
  if (memo !== undefined) return memo;
  const seen = new Set<ts.Node>([tested]);
  const todo: ts.Node[] = [tested];
  let hit = false;
  while (todo.length && !hit) {
    const v = (n: ts.Node): void => {
      if (hit) return;
      if (ts.isIdentifier(n)) {
        const d = teResolve(X, n);
        if (d === tested) { hit = true; return; }
        const fn = d && ts.isVariableDeclaration(d) && d.initializer ? teUnwrap(d.initializer) : d;
        if (d && fn && (ts.isFunctionDeclaration(fn) || ts.isFunctionExpression(fn) || ts.isArrowFunction(fn) || ts.isClassDeclaration(fn) || ts.isMethodDeclaration(fn)) && !seen.has(fn)) { seen.add(fn); todo.push(fn); }
        if (d && ts.isVariableDeclaration(d) && d.initializer && !seen.has(d.initializer)) { seen.add(d.initializer); todo.push(d.initializer); }
      }
      ts.forEachChild(n, v);
    };
    const n = todo.pop()!;
    if (n === tested) { const b = (tested as ts.FunctionLikeDeclaration).body; if (b) v(b); } else v(n);
  }
  teReentrant.set(tested, hit);
  return hit;
}
/** The index of the tested function's own plain, never-reassigned parameter `e` names, or -1. */
function teTestedParam(X: TeDateIdx, e: ts.Expression, tested: ts.Node | undefined): number {
  e = teUnwrap(e);
  if (!tested || !ts.isIdentifier(e)) return -1;
  const d = teResolve(X, e);
  if (!d || !ts.isParameter(d) || d.parent !== tested || !ts.isIdentifier(d.name) || d.initializer || d.dotDotDotToken) return -1;
  if (teSelfReached(X, tested)) return -1;
  const t = d.type;
  const prim = (x: ts.TypeNode): boolean => x.kind === ts.SyntaxKind.StringKeyword || x.kind === ts.SyntaxKind.NumberKeyword || (ts.isUnionTypeNode(x) && x.types.every(prim)) || (ts.isParenthesizedTypeNode(x) && prim(x.type));
  if (t && !prim(t)) return -1;
  if (teRefsOf(X, d, e.text).some(teWriteRef)) return -1;
  return (tested as ts.FunctionLikeDeclaration).parameters.indexOf(d);
}
/** `\`${p}T00:00:00Z\``: the tested function's own parameter (teTestedParam) followed by a literal time with Z or an
 *  offset, nothing before it - an ISO text in every zone exactly when p is a date-only text, which dateArgProblem then
 *  requires of every test argument at that index. The parameter's index, or -1. */
function teIsoTemplateParam(X: TeDateIdx, e: ts.Expression, tested: ts.Node | undefined): number {
  e = teUnwrap(e);
  if (!ts.isTemplateExpression(e) || e.head.text !== "" || e.templateSpans.length !== 1) return -1;
  const sp = e.templateSpans[0]!;
  const tail = sp.literal.text;
  if (sp.literal.rawText !== tail || !/^T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(tail) || !teIsoText(`2000-01-01${tail}`)) return -1;
  return teTestedParam(X, sp.expression, tested);
}
const TE_DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
/**
 * The fail-closed Date-use check (block comment above): null, or DATE_LOCAL_TIME. `tested` is the tested function
 * (never a load-time callee): only its own parameters may feed `new Date(x)` (then held by dateArgProblem) and only
 * it may return a Date to its caller outside the file.
 */
function teDateUseProblem(node: ts.Node, tested: ts.Node | undefined, loadOnly = false): string | null {
  const X = teDateIdx(node.getSourceFile());
  let bad = false;
  const v = (n: ts.Node): void => {
    if (bad) return;
    // loadOnly (a module-level initializer, checked for what runs on load): a function body there does not run on
    // load; it is held to this same check, in full, when and if the walk reaches it as a callee (analyzeFunction).
    if (loadOnly && ts.isFunctionLike(n)) return;
    if (ts.isTypeNode(n) && !ts.isExpressionWithTypeArguments(n)) return;
    if (ts.isIdentifier(n) && n.text === "Date" && isValueReference(n)) {
      if (X.dateDeclared) { bad = true; return; }
      const p = n.parent;
      const ok = (ts.isNewExpression(p) && p.expression === n) || (ts.isPropertyAccessExpression(p) && p.expression === n && p.name.text === "UTC" && ts.isCallExpression(p.parent) && p.parent.expression === p);
      if (!ok) { bad = true; return; }
    }
    if (ts.isNewExpression(n) && teNewDate(X, n) && n.arguments?.length === 1) {
      const x = n.arguments[0]!;
      if (ts.isSpreadElement(x) || !(teNumeric(X, x) || teIsoLiteral(X, x) || teTestedParam(X, x, tested) >= 0 || teIsoTemplateParam(X, x, tested) >= 0)) { bad = true; return; }
    }
    if (ts.isNewExpression(n) && teNewDate(X, n) && n.arguments?.some(ts.isSpreadElement)) { bad = true; return; }
    if (ts.isExpression(n) && !ts.isIdentifier(n) || ts.isIdentifier(n) && isValueReference(n)) {
      if (teDateValued(X, n as ts.Expression) && !teDateUseOk(X, n as ts.Expression, tested)) { bad = true; return; }
    }
    ts.forEachChild(n, v);
  };
  v(node);
  return bad ? DATE_LOCAL_TIME : null;
}
/** An array of the global Date as a whole type: `Date[]`, `readonly Date[]`, `Array<Date>`, `ReadonlyArray<Date>` (its
 *  elements reach the target only through `for (const d of ds)`, a Date-valued name; teDateUseOk). */
function teDateArrayType(t: ts.TypeNode | undefined): boolean {
  if (!t) return false;
  while (ts.isParenthesizedTypeNode(t)) t = t.type;
  if (ts.isTypeOperatorNode(t) && t.operator === ts.SyntaxKind.ReadonlyKeyword) t = t.type;
  const isDate = (x: ts.TypeNode): boolean => ts.isTypeReferenceNode(x) && ts.isIdentifier(x.typeName) && x.typeName.text === "Date" && !x.typeArguments;
  if (ts.isArrayTypeNode(t)) return isDate(t.elementType);
  return ts.isTypeReferenceNode(t) && ts.isIdentifier(t.typeName) && (t.typeName.text === "Array" || t.typeName.text === "ReadonlyArray") && t.typeArguments?.length === 1 && isDate(t.typeArguments[0]!);
}
/** The tested function's parameters that feed `new Date(x)` (teTestedParam), and those whose whole type is Date. */
export function dateParamInfo(moduleContent: string, fn: string): { strings: number[]; dateOnly: number[]; dates: number[]; arrays: number[] } | null {
  const sf = ts.createSourceFile("m.ts", moduleContent, ts.ScriptTarget.Latest, true);
  const decls = indexModule(sf).fns.get(fn) ?? [];
  if (decls.length !== 1 || !decls[0]!.body) return null;
  const f = decls[0]!;
  const X = teDateIdx(sf);
  const strings = new Set<number>();
  const dateOnly = new Set<number>();
  const v = (n: ts.Node): void => {
    if (ts.isNewExpression(n) && teNewDate(X, n) && n.arguments?.length === 1) {
      const i = teTestedParam(X, n.arguments[0]!, f); if (i >= 0) strings.add(i);
      const j = teIsoTemplateParam(X, n.arguments[0]!, f); if (j >= 0) dateOnly.add(j);
    }
    ts.forEachChild(n, v);
  };
  v(f.body!);
  return {
    strings: [...strings].sort(),
    dateOnly: [...dateOnly].sort(),
    dates: f.parameters.flatMap((p, i) => (teTopDateType(p.type) ? [i] : [])),
    arrays: f.parameters.flatMap((p, i) => (!p.dotDotDotToken && teDateArrayType(p.type) ? [i] : [])),
  };
}
/**
 * Auditor #466 (4th review), Job A and Job B, every version: the test side of the fail-closed Date check, on the
 * test (Job B: the graded file; Job A: each check expression). Every call of `local` (the tested function) passes,
 * at each parameter feeding `new Date(x)`, a string literal of ISO text with Z / an offset or a date-only date
 * (teIsoText), or a number literal; and passes a Date literal (`new Date("<ISO>")`, isDateLiteral) only as a whole
 * argument at a parameter whose whole type is Date. Every other `new Date(..)` in the test is a Date literal outside
 * every call of the tested function (an expected value), never bound to a name. The function is never referenced
 * other than as a direct callee. null when it holds.
 */
export function dateArgProblem(moduleContent: string, fn: string, test: ts.Node, local: string): string | null {
  const info = dateParamInfo(moduleContent, fn);
  if (!info) return null; // the target analysis refuses an unreadable target
  let bad: string | null = null;
  const lit = (x: ts.Expression): boolean => {
    if (ts.isStringLiteral(x) || ts.isNoSubstitutionTemplateLiteral(x)) return x.getText().slice(1, -1) === x.text && teIsoText(x.text);
    return ts.isNumericLiteral(x) || (ts.isPrefixUnaryExpression(x) && x.operator === ts.SyntaxKind.MinusToken && ts.isNumericLiteral(x.operand));
  };
  const insideCallOf = (n: ts.Node): boolean => { for (let p = n.parent; p; p = p.parent) if (ts.isCallExpression(p) && ts.isIdentifier(p.expression) && p.expression.text === local && p.arguments.some((a) => a.pos <= n.pos && n.end <= a.end)) return true; return false; };
  const v = (n: ts.Node): void => {
    if (bad) return;
    if (ts.isIdentifier(n) && n.text === local && isValueReference(n)) {
      const p = n.parent;
      if (!(ts.isCallExpression(p) && p.expression === n)) { bad = "date-target-not-called"; return; }
      if (p.arguments.some(ts.isSpreadElement)) { bad = "date-arg-spread"; return; }
      for (const i of info.strings) { const x = p.arguments[i]; if (!x || !lit(x)) { bad = "date-string-arg-not-iso"; return; } }
      for (const i of info.dateOnly) {
        const x = p.arguments[i];
        if (!x || !(ts.isStringLiteral(x) || ts.isNoSubstitutionTemplateLiteral(x)) || x.getText().slice(1, -1) !== x.text || !TE_DATE_ONLY.test(x.text) || !teValidCalendar(x.text)) { bad = "date-template-arg-not-date-only"; return; }
      }
      p.arguments.forEach((x, i) => {
        let hasDate = false;
        const w = (k: ts.Node): void => { if (ts.isIdentifier(k) && k.text === "Date") hasDate = true; ts.forEachChild(k, w); };
        w(x);
        const dateArray = info.arrays.includes(i) && ts.isArrayLiteralExpression(x) && x.elements.every((el) => isDateLiteral(el));
        if (hasDate && !(isDateLiteral(x) && info.dates.includes(i)) && !dateArray) bad = "date-literal-not-date-param";
      });
    }
    if (ts.isNewExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === "Date" && !insideCallOf(n)) {
      if (!isDateLiteral(n)) { bad = "date-not-literal"; return; }
      for (let p: ts.Node = n.parent; p && !ts.isCallExpression(p); p = p.parent) if (ts.isVariableDeclaration(p) || ts.isBinaryExpression(p) || ts.isReturnStatement(p) || ts.isArrowFunction(p)) { bad = "date-literal-bound"; return; }
    }
    ts.forEachChild(n, v);
  };
  v(test);
  return bad;
}
/** Job B: dateArgProblem on the graded test file (`local`: the name the test imports the tested function as). */
export function dateTestProblem(moduleContent: string, fn: string, testContent: string, local: string): string | null {
  const sf = ts.createSourceFile("t.ts", testContent, ts.ScriptTarget.Latest, true);
  return dateArgProblem(moduleContent, fn, sf, local);
}

function isValueReference(n: ts.Identifier): boolean {
  const p = n.parent;
  if (!p) return false;
  if (ts.isPropertyAccessExpression(p) && p.name === n) return false;
  if ((ts.isPropertyAssignment(p) || ts.isPropertyDeclaration(p) || ts.isMethodDeclaration(p) || ts.isPropertySignature(p) || ts.isGetAccessor(p) || ts.isSetAccessor(p) || ts.isEnumMember(p)) && p.name === n) return false;
  if ((ts.isVariableDeclaration(p) || ts.isParameter(p) || ts.isFunctionDeclaration(p) || ts.isFunctionExpression(p) || ts.isClassDeclaration(p) || ts.isClassExpression(p) || ts.isBindingElement(p)) && p.name === n) return false;
  if (ts.isBindingElement(p) && p.propertyName === n) return false;
  if (ts.isLabeledStatement(p) || ts.isBreakOrContinueStatement(p)) return false;
  if (ts.isImportSpecifier(p) || ts.isExportSpecifier(p) || ts.isImportClause(p) || ts.isNamespaceImport(p)) return false;
  if (ts.isQualifiedName(p) || ts.isTypeReferenceNode(p)) return false;
  return true;
}

interface Analysis { reasons: Set<string>; fns: Set<string>; consts: Set<string>; idx: ModuleIndex; sf: ts.SourceFile; v2?: V2Ctx; lc?: LoadCallCheck; /** a load-time callee analysis (CalleeMode): its parameters are load-time arguments, never the test's */ callee?: boolean }
interface V2Ctx {
  path: string;
  /** The target module. Counted in `modules` so it is parsed once, never as one of the 4 siblings. */
  root: string;
  depth: number;
  read: (rel: string) => string | null;
  modules: Map<string, { idx: ModuleIndex; sf: ts.SourceFile; fns: Set<string>; consts: Set<string> } | null>;
  followed: Set<string>;
  /** Shared with the analysis, including refusals found while resolving a signature. */
  reasons: Set<string>;
  /** Enums and value-loaded modules already scanned for initializers and top-level statements. */
  scanned: Set<string>;
  /** M88 (v3 only): the built-in `Date` is a plain-data type (never when the module declares or imports a `Date`). */
  dates?: boolean;
  /** M90 (v4 only): optional / defaulted parameters, the V4_GENERICS references and the v4 type bounds. */
  v4?: boolean;
  /** M91 (v5 only): `typeof` of literal consts and `T["k"]` property lookups. */
  v5?: boolean;
  /** M93 (v6 only): top-level `unknown` and `NodeJS.ProcessEnv` parameters (see TEST_EXISTING_VOCAB). */
  v6?: boolean;
  /** M97 (v7 only, set only for a target v6 refuses): Map / Set types, a void return and the v7 hardening. */
  v7?: boolean;
  /** Auditor #466 (4th pass): the load-time call allowance's callee check (loadCallInert), same version as the target. */
  lc?: LoadCallCheck;
}
/** M90: a global (never shadowed in `idx`) name. */
const unshadowed = (idx: ModuleIndex, n: string): boolean => !idx.types.has(n) && !idx.imports.has(n) && !idx.enums.has(n) && !idx.mutable.has(n) && !idx.fns.has(n) && !idx.consts.has(n);
/** M90: a Record key type: string, number, or a union of string / number literals. */
function recordKey(t: ts.TypeNode): boolean {
  if (t.kind === ts.SyntaxKind.StringKeyword || t.kind === ts.SyntaxKind.NumberKeyword) return true;
  if (ts.isLiteralTypeNode(t)) return ts.isStringLiteral(t.literal) || ts.isNumericLiteral(t.literal);
  return ts.isUnionTypeNode(t) && t.types.length <= 12 && t.types.every((x) => ts.isLiteralTypeNode(x) && (ts.isStringLiteral(x.literal) || ts.isNumericLiteral(x.literal)));
}

const normRel = (p: string): string | null => {
  const out: string[] = [];
  for (const s of p.split("/")) { if (s === "" || s === ".") continue; if (s === "..") { if (!out.length) return null; out.pop(); } else out.push(s); }
  return out.join("/");
};
/** M85: relative specifier candidates from `from` (no read). Null when the specifier is not relative or escapes the root. */
function siblingCandidates(from: string, spec: string): string[] | null {
  if (!spec.startsWith("./") && !spec.startsWith("../")) return null;
  const dir = from.includes("/") ? from.slice(0, from.lastIndexOf("/")) : "";
  const base = normRel(`${dir}/${spec}`);
  if (base === null) return null;
  return [...new Set([base, `${base}.ts`, `${base}/index.ts`, ...(/\.js$/.test(base) ? [base.replace(/\.js$/, ".ts")] : [])])].filter((c) => /\.ts$/.test(c));
}
/** M85: a relative specifier from `from` to exactly one readable, plain, unprotected, non-test .ts module (else null). */
function resolveSibling(from: string, spec: string, read: (rel: string) => string | null): string | null {
  const candidates = siblingCandidates(from, spec);
  if (!candidates) return null;
  const hits = candidates.filter((c) => read(c) !== null);
  if (hits.length !== 1) return null;
  const t = hits[0]!;
  if (!plainPath(t) || isProtected(t) || /\.(?:test|spec)\.ts$/.test(t) || /\.d\.ts$/.test(t)) return null;
  return t;
}
/** Sibling modules already entered (the target module is not one of them). */
function siblingSlots(v: V2Ctx): number {
  let n = 0;
  for (const k of v.modules.keys()) if (k !== v.root) n += 1;
  return n;
}
function siblingModule(v: V2Ctx, path: string): { idx: ModuleIndex; sf: ts.SourceFile; fns: Set<string>; consts: Set<string> } | null {
  if (v.modules.has(path)) return v.modules.get(path)!;
  // Cap before the read: 4 siblings, not 5, and the target does not consume a slot.
  if (path !== v.root && siblingSlots(v) >= MAX_IMPORT_MODULES) { v.reasons.add(TEST_TARGET_TOO_LARGE); return null; }
  const text = v.read(path);
  let m: { idx: ModuleIndex; sf: ts.SourceFile; fns: Set<string>; consts: Set<string> } | null = null;
  if (text !== null && text.length <= 65536) {
    const sf = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
    if (!(sf as unknown as { parseDiagnostics: unknown[] }).parseDiagnostics.length) m = { idx: indexModule(sf), sf, fns: new Set(), consts: new Set() };
  }
  v.modules.set(path, m);
  return m;
}
/**
 * Resolve a sibling without reading past the cap or the depth bound.
 * A module already loaded (a second name from it) is reused with no new read.
 */
function pickSibling(v: V2Ctx, spec: string): string | null {
  if (v.depth >= MAX_IMPORT_DEPTH) { v.reasons.add(TEST_TARGET_TOO_LARGE); return null; }
  const candidates = siblingCandidates(v.path, spec);
  if (!candidates) return null;
  const known = candidates.filter((c) => v.modules.get(c));
  if (known.length === 1) return known[0]!;
  if (siblingSlots(v) >= MAX_IMPORT_MODULES) { v.reasons.add(TEST_TARGET_TOO_LARGE); return null; }
  return resolveSibling(v.path, spec, v.read);
}
/** M85: a named value import from a relative sibling, followed into that module with the same analysis. */
function followImport(a: Analysis, imp: { spec: string; imported?: string }): void {
  const add = (r: string) => a.reasons.add(r);
  const v = a.v2!;
  if (!imp.imported || imp.imported === "default") { add(TEST_TARGET_IMPURE); return; }
  const target = pickSibling(v, imp.spec);
  if (!target) { add(v.reasons.has(TEST_TARGET_TOO_LARGE) ? TEST_TARGET_TOO_LARGE : TEST_TARGET_IMPURE); return; }
  const key = `${target}\0${imp.imported}`;
  if (v.followed.has(key)) return;
  v.followed.add(key);
  const m = siblingModule(v, target);
  if (!m) { add(v.reasons.has(TEST_TARGET_TOO_LARGE) ? TEST_TARGET_TOO_LARGE : TEST_TARGET_IMPURE); return; }
  // Only names the sibling itself declares and exports (functions or consts); re-exports are not followed.
  if (!m.idx.exportNames.has(imp.imported) || !(m.idx.fns.has(imp.imported) || m.idx.consts.has(imp.imported))) { add(TEST_TARGET_IMPURE); return; }
  const subV: V2Ctx = { ...v, path: target, depth: v.depth + 1 };
  const sub: Analysis = { reasons: a.reasons, fns: m.fns, consts: m.consts, idx: m.idx, sf: m.sf, v2: subV };
  // The sibling module runs on import: its top-level statements and enum initializers, not only the imported name.
  analyzeLoadedModule(subV, m.idx, m.sf);
  resolveName(sub, imp.imported, new Set());
}

function analysisFor(v2: V2Ctx, idx: ModuleIndex, sf: ts.SourceFile): Analysis {
  const cached = v2.modules.get(v2.path);
  return { reasons: v2.reasons, fns: cached?.fns ?? new Set(), consts: cached?.consts ?? new Set(), idx, sf, v2 };
}
/** Enum member initializers run when the module loads. A pure number/string enum stays allowed. */
function noteEnum(v2: V2Ctx, idx: ModuleIndex, sf: ts.SourceFile, name: string): void {
  const key = `enum\0${sf.fileName}\0${name}`;
  if (v2.scanned.has(key)) return;
  v2.scanned.add(key);
  const decl = sf.statements.find((s) => ts.isEnumDeclaration(s) && s.name.text === name);
  if (!decl || !ts.isEnumDeclaration(decl)) return;
  const a = analysisFor(v2, idx, sf);
  for (const mem of decl.members) if (mem.initializer) analyzeExpression(a, mem.initializer);
}
/**
 * Statements that run because this module is loaded (the target, or a value-imported sibling).
 * Expression statements and enum initializers get the full purity walk. Other initializers are
 * checked only for the clock and local time, so a module-level `new WeakMap()` or `Promise.resolve()`
 * does not by itself refuse a pure exported function (v1 does not scan those either).
 */
function analyzeLoadedModule(v2: V2Ctx, idx: ModuleIndex, sf: ts.SourceFile): void {
  const key = `mod\0${v2.path}`;
  if (v2.scanned.has(key)) return;
  v2.scanned.add(key);
  analyzeLoadTime(analysisFor(v2, idx, sf), sf);
}
/**
 * The load-time statements of one module (see analyzeLoadedModule). Auditor #466: v1 runs it on the target module
 * too (its expression statements and side-effect imports: `String.prototype.trim = ..` at load), but not the v2
 * load-time date check on unused consts.
 */
function analyzeLoadTime(a: Analysis, sf: ts.SourceFile): void {
  for (const s of sf.statements) {
    // Auditor #466: a side-effect import (`import "./polyfill.ts"`) runs that module's load-time code: a relative
    // .ts sibling gets the same load-time walk (v2+, which read siblings); anything else but a Node built-in is
    // code the walk cannot see (test_target_io, as for v6 / v7 non-.ts imports).
    if (ts.isImportDeclaration(s) && !s.importClause && ts.isStringLiteral(s.moduleSpecifier)) {
      const spec = s.moduleSpecifier.text;
      if (NODE_BUILTINS.test(spec)) continue;
      const v = a.v2;
      const rel = spec.startsWith("./") || spec.startsWith("../");
      const target = v && rel ? pickSibling(v, spec) : null;
      const m = v && target ? siblingModule(v, target) : null;
      if (!v || !target || !m) { a.reasons.add(v?.reasons.has(TEST_TARGET_TOO_LARGE) ? TEST_TARGET_TOO_LARGE : TEST_TARGET_IO); continue; }
      // What it does on load (a global write, a clock read, a patch) is an impurity of the importer.
      const seen = new Set<string>();
      analyzeLoadedModule({ ...v, path: target, depth: v.depth + 1, reasons: seen }, m.idx, m.sf);
      for (const r of seen) a.reasons.add(r.startsWith("\0") || r === TEST_TARGET_TOO_LARGE ? r : TEST_TARGET_IMPURE);
      continue;
    }
    if (ts.isExpressionStatement(s)) {
      analyzeExpression(a, s.expression);
    } else if (ts.isEnumDeclaration(s)) {
      for (const mem of s.members) if (mem.initializer) analyzeExpression(a, mem.initializer);
    } else if (ts.isVariableStatement(s) && a.v2) {
      for (const d of s.declarationList.declarations) {
        if (!d.initializer) continue;
        const dr = dateRefusalTE(d.initializer, undefined, a.v2?.v7 === true, undefined, true);
        if (dr === DATE_NOW || dr === DATE_LOCAL_TIME) a.reasons.add(TEST_TARGET_DATE_LOCAL);
        else if (dr === DATE_SETTER) a.reasons.add(TEST_TARGET_IMPURE);
      }
    }
  }
}

/**
 * M85: a plain-data type for the v2 target: the vocabulary primitives (arrays), string/number/boolean literal types
 * and unions of them with null/undefined, object type literals of property signatures only, and references to a
 * module-local non-generic interface/type alias of the same shape, or (followed) one a relative sibling exports.
 */
function structuralType(t: ts.TypeNode, idx: ModuleIndex, sf: ts.SourceFile, v2: V2Ctx | undefined, depth = 0): boolean {
  if (TYPES.test(t.getText(sf).trim())) return true;
  if (depth > (v2?.v4 ? MAX_TYPE_DEPTH_V4 : MAX_TYPE_DEPTH)) return false;
  const rec = (x: ts.TypeNode) => structuralType(x, idx, sf, v2, depth + 1);
  if (ts.isParenthesizedTypeNode(t)) return rec(t.type);
  if (ts.isArrayTypeNode(t)) return rec(t.elementType);
  if (ts.isTypeOperatorNode(t)) return t.operator === ts.SyntaxKind.ReadonlyKeyword && ts.isArrayTypeNode(t.type) && rec(t.type);
  if (ts.isLiteralTypeNode(t)) return ts.isStringLiteral(t.literal) || ts.isNumericLiteral(t.literal) || t.literal.kind === ts.SyntaxKind.NullKeyword || t.literal.kind === ts.SyntaxKind.TrueKeyword || t.literal.kind === ts.SyntaxKind.FalseKeyword;
  if (t.kind === ts.SyntaxKind.UndefinedKeyword || t.kind === ts.SyntaxKind.StringKeyword || t.kind === ts.SyntaxKind.NumberKeyword || t.kind === ts.SyntaxKind.BooleanKeyword) return true;
  if (ts.isUnionTypeNode(t)) return t.types.length <= 12 && t.types.every(rec);
  const members = v2?.v4 ? MAX_TYPE_MEMBERS_V4 : MAX_TYPE_MEMBERS;
  if (ts.isTypeLiteralNode(t)) return plainMembers(t.members, rec, members);
  // M91 (v5 only): `typeof N` of a literal const, and `T["k"]` of a plain object type's property signature.
  if (ts.isTypeQueryNode(t)) return !!v2?.v5 && !t.typeArguments?.length && ts.isIdentifier(t.exprName) && literalConstType(t.exprName.text, idx, sf, v2, depth);
  if (ts.isIndexedAccessTypeNode(t)) {
    if (!v2?.v5 || !ts.isLiteralTypeNode(t.indexType) || !ts.isStringLiteral(t.indexType.literal)) return false;
    const m = propertyOf(t.objectType, t.indexType.literal.text, idx, sf, v2);
    return !!m && structuralType(m.type, m.idx, m.sf, m.v2, depth + 1) && structuralType(t.objectType, idx, sf, v2, depth + 1);
  }
  if (ts.isTypeReferenceNode(t)) {
    if (!ts.isIdentifier(t.typeName)) return false;
    const n = t.typeName.text;
    // M90 (v4 only): Array<T> / ReadonlyArray<T> as T[], Readonly<O> for a plain object O, Record<K, V>; global names only.
    if (t.typeArguments?.length) {
      // M97 (v7 only): Map<K, V> / ReadonlyMap<K, V> / Set<K> / ReadonlySet<K>; K a Record key (string, number or a
      // string / number literal union: never an object, array or function key), V plain data (nested collections too).
      if (v2?.v7 && V7_COLLECTIONS.has(n) && unshadowed(idx, n)) {
        if ((n === "Map" || n === "ReadonlyMap") && t.typeArguments.length === 2) return recordKey(t.typeArguments[0]!) && rec(t.typeArguments[1]!);
        if ((n === "Set" || n === "ReadonlySet") && t.typeArguments.length === 1) return recordKey(t.typeArguments[0]!);
        return false;
      }
      if (!v2?.v4 || !V4_GENERICS.has(n) || !unshadowed(idx, n)) return false;
      const ta = t.typeArguments;
      if ((n === "Array" || n === "ReadonlyArray") && ta.length === 1) return rec(ta[0]!);
      if ((n === "Readonly" || n === "Partial") && ta.length === 1) return !ts.isArrayTypeNode(ta[0]!) && rec(ta[0]!);
      if (n === "Record" && ta.length === 2) return recordKey(ta[0]!) && rec(ta[1]!);
      // Pick / Omit of a plain object type: a subset of its (all plain) members; keys are string literals.
      if ((n === "Pick" || n === "Omit") && ta.length === 2) return recordKey(ta[1]!) && ta[1]!.kind !== ts.SyntaxKind.NumberKeyword && rec(ta[0]!);
      return false;
    }
    // M88: the global Date only (a module-local or imported `Date` shadows it and is analyzed as any other name).
    if (n === "Date" && v2?.dates && !idx.types.has(n) && !idx.imports.has(n) && !idx.enums.has(n) && !idx.mutable.has(n) && !idx.fns.has(n) && !idx.consts.has(n)) return true;
    if (idx.enums.has(n)) { if (v2) noteEnum(v2, idx, sf, n); return true; }
    const d = idx.types.get(n);
    if (d) return ts.isInterfaceDeclaration(d) ? plainMembers(d.members, rec, members) : rec(d.type);
    if (d === null) return false;
    const imp = idx.imports.get(n);
    if (!imp || !v2 || !imp.imported || imp.imported === "default") return false;
    const target = pickSibling(v2, imp.spec);
    const m = target ? siblingModule(v2, target) : null;
    if (!m || !target) return false;
    if (m.idx.enums.has(imp.imported)) { noteEnum({ ...v2, path: target, depth: v2.depth + 1 }, m.idx, m.sf, imp.imported); return true; }
    const sd = m.idx.types.get(imp.imported);
    if (!sd) return false;
    // pickSibling already refused depth >= MAX before this read, so the sibling sits at depth+1 <= MAX.
    const sv: V2Ctx = { ...v2, path: target, depth: v2.depth + 1 };
    if (sv.depth > MAX_IMPORT_DEPTH) { v2.reasons.add(TEST_TARGET_TOO_LARGE); return false; }
    const srec = (x: ts.TypeNode) => structuralType(x, m.idx, m.sf, sv, depth + 1);
    return ts.isInterfaceDeclaration(sd) ? plainMembers(sd.members, srec, members) : srec(sd.type);
  }
  return false;
}
function plainMembers(ms: ts.NodeArray<ts.TypeElement>, rec: (x: ts.TypeNode) => boolean, max: number = MAX_TYPE_MEMBERS): boolean {
  return ms.length <= max && ms.every((m) => ts.isPropertySignature(m) && !!m.type && (ts.isIdentifier(m.name) || ts.isStringLiteral(m.name)) && rec(m.type));
}
/** M91: a string / number / boolean literal (or `-number`), optionally wrapped in parentheses and `as const`. */
function literalInit(e: ts.Expression | undefined): boolean {
  let x = e;
  while (x && (ts.isParenthesizedExpression(x) || (ts.isAsExpression(x) && ts.isTypeReferenceNode(x.type) && ts.isIdentifier(x.type.typeName) && x.type.typeName.text === "const"))) x = x.expression;
  if (!x) return false;
  if (ts.isStringLiteral(x) || ts.isNoSubstitutionTemplateLiteral(x) || ts.isNumericLiteral(x) || x.kind === ts.SyntaxKind.TrueKeyword || x.kind === ts.SyntaxKind.FalseKeyword) return true;
  return ts.isPrefixUnaryExpression(x) && x.operator === ts.SyntaxKind.MinusToken && ts.isNumericLiteral(x.operand);
}
/** M91: the module (local or a followed relative sibling, v2 import rules) that declares name `n` as seen from `idx`. */
function declaringModule(n: string, idx: ModuleIndex, sf: ts.SourceFile, v2: V2Ctx): { name: string; idx: ModuleIndex; sf: ts.SourceFile; v2: V2Ctx } | null {
  if (!idx.imports.has(n)) return { name: n, idx, sf, v2 };
  const imp = idx.imports.get(n)!;
  if (!imp.imported || imp.imported === "default") return null;
  const target = pickSibling(v2, imp.spec);
  const m = target ? siblingModule(v2, target) : null;
  if (!m || !target) return null;
  const sv: V2Ctx = { ...v2, path: target, depth: v2.depth + 1 };
  if (sv.depth > MAX_IMPORT_DEPTH) { v2.reasons.add(TEST_TARGET_TOO_LARGE); return null; }
  return { name: imp.imported, idx: m.idx, sf: m.sf, v2: sv };
}
/** M91: `typeof n` is plain data: n is a top-level const, never mutated, whose initializer is a literal (optionally `as const`).
 * M92: an explicit annotation alone never qualifies (`const N: number = Date.now()` is refused); when present it must also be plain. */
function literalConstType(n: string, idx: ModuleIndex, sf: ts.SourceFile, v2: V2Ctx, depth: number): boolean {
  const m = declaringModule(n, idx, sf, v2);
  if (!m) return false;
  const d = m.idx.consts.get(m.name);
  if (!d || m.idx.mutable.has(m.name) || m.idx.mutated.has(m.name) || m.idx.fns.has(m.name) || m.idx.types.has(m.name) || m.idx.enums.has(m.name)) return false;
  if (!literalInit(d.initializer)) return false;
  return !d.type || structuralType(d.type, m.idx, m.sf, m.v2, depth + 1);
}
/** M91: the type of property `k` of the plain object type `t` (a type literal, or a non-generic interface / alias of one). */
function propertyOf(t: ts.TypeNode, k: string, idx: ModuleIndex, sf: ts.SourceFile, v2: V2Ctx): { type: ts.TypeNode; idx: ModuleIndex; sf: ts.SourceFile; v2: V2Ctx } | null {
  const find = (ms: ts.NodeArray<ts.TypeElement>, mi: ModuleIndex, msf: ts.SourceFile, mv: V2Ctx) => {
    const p = ms.find((x): x is ts.PropertySignature => ts.isPropertySignature(x) && !!x.type && (ts.isIdentifier(x.name) || ts.isStringLiteral(x.name)) && x.name.text === k);
    return p && !p.questionToken ? { type: p.type!, idx: mi, sf: msf, v2: mv } : null;
  };
  if (ts.isParenthesizedTypeNode(t)) return propertyOf(t.type, k, idx, sf, v2);
  if (ts.isTypeLiteralNode(t)) return find(t.members, idx, sf, v2);
  if (!ts.isTypeReferenceNode(t) || !ts.isIdentifier(t.typeName) || t.typeArguments?.length) return null;
  const m = declaringModule(t.typeName.text, idx, sf, v2);
  const d = m ? m.idx.types.get(m.name) : null;
  if (!m || !d) return null;
  if (ts.isInterfaceDeclaration(d)) return d.heritageClauses?.length ? null : find(d.members, m.idx, m.sf, m.v2);
  return ts.isTypeLiteralNode(d.type) ? find(d.type.members, m.idx, m.sf, m.v2) : null;
}

const unwrapExpr = (e: ts.Expression): ts.Expression => {
  let x = e;
  while (ts.isParenthesizedExpression(x) || ts.isAsExpression(x) || ts.isSatisfiesExpression(x) || ts.isNonNullExpression(x) || ts.isTypeAssertionExpression(x)) x = x.expression;
  return x;
};
/**
 * Names whose value is known to be a built-in instance, for one analyzed function (Auditor #466):
 * `plain` = the tested function's own parameters (plain data the check literals build; never re-assigned), so any
 * property / element path from one is plain data too; `builtin` = locals initialized with a builtinValue (never
 * re-pointed at anything else).
 */
interface BuiltinNames { plain: ReadonlySet<string>; builtin: ReadonlySet<string>; deps?: Map<string, Set<string>>; used?: (name: string) => void }
const NO_BUILTINS: BuiltinNames = { plain: new Set(), builtin: new Set() };
/**
 * Auditor #466: bookkeeping markers in the reasons set (never reported: PRIORITY and the refusal set list none).
 * FRESH_BY_NAME + m: a `x.m(..)` result was taken as fresh only by its method name (x not known built-in).
 * USER_MEMBER + m: analyzed code defines a member named m on some object (`{ m: .. }`, `{ m }`, `{ m() {} }`, `o.m = ..`);
 * USER_MEMBER + "*": a member whose name the walk cannot read (computed key, `o[k] = ..`, `Object.fromEntries`).
 * Both for one name (or "*") means `x.m(..)` may be user code returning shared state: test_target_impure.
 */
const FRESH_BY_NAME = "\0fresh-by-name:";
const USER_MEMBER = "\0user-member:";
function freshByNameConflict(reasons: ReadonlySet<string>): boolean {
  const any = reasons.has(`${USER_MEMBER}*`);
  for (const r of reasons) if (r.startsWith(FRESH_BY_NAME) && (any || reasons.has(USER_MEMBER + r.slice(FRESH_BY_NAME.length)))) return true;
  return false;
}
/**
 * Auditor #466: `e` is a built-in value (string, number, array, Map, Set, RegExp, Date, Error), so the methods called
 * on it are the built-in ones. Only then does a FRESH_METHODS call return a new value: `H.slice()` on a module object
 * `const H = { slice: () => STORE.items }` returns the module's own array.
 */
function builtinValue(e: ts.Expression, b: BuiltinNames, depth = 0): boolean {
  if (depth > 32) return false;
  const x = unwrapExpr(e);
  if (ts.isStringLiteral(x) || ts.isNoSubstitutionTemplateLiteral(x) || ts.isTemplateExpression(x) || ts.isNumericLiteral(x) || ts.isArrayLiteralExpression(x) || ts.isRegularExpressionLiteral(x)) return true;
  if (ts.isNewExpression(x) && ts.isIdentifier(x.expression) && PURE_NEW.has(x.expression.text)) return true;
  if (ts.isIdentifier(x)) return b.builtin.has(x.text) || b.plain.has(x.text);
  if (ts.isPropertyAccessExpression(x) || ts.isElementAccessExpression(x)) { const r = rootName(x); return ts.isIdentifier(r) && b.plain.has(r.text) && !x.questionDotToken; }
  if (ts.isCallExpression(x) && ts.isIdentifier(x.expression) && x.expression.text === "String") return true;
  if (ts.isCallExpression(x) && ts.isPropertyAccessExpression(x.expression)) {
    const m = x.expression.name.text; const recv = x.expression.expression;
    if (ts.isIdentifier(recv) && recv.text === "Array" && (m === "from" || m === "of")) return true;
    if (ts.isIdentifier(recv) && recv.text === "Object" && (m === "keys" || m === "values" || m === "entries")) return true;
    if (FRESH_METHODS.has(m) || STRING_RESULT.has(m)) return builtinValue(recv, b, depth + 1);
  }
  return false;
}
/** Fresh: a value created inside the function (so mutating it touches nothing outside). */
function isFresh(e: ts.Expression | undefined, fresh: ReadonlySet<string>, b: BuiltinNames = NO_BUILTINS, by?: Set<string>): boolean {
  if (!e) return false;
  const x = ts.isParenthesizedExpression(e) || ts.isAsExpression(e) || ts.isSatisfiesExpression(e) || ts.isNonNullExpression(e) ? e.expression : e;
  if (ts.isArrayLiteralExpression(x) || ts.isObjectLiteralExpression(x) || ts.isRegularExpressionLiteral(x)) return true;
  if (ts.isNewExpression(x) && ts.isIdentifier(x.expression) && PURE_NEW.has(x.expression.text)) return true;
  if (ts.isIdentifier(x)) { if (fresh.has(x.text)) for (const d of b.deps?.get(x.text) ?? []) by?.add(d); return fresh.has(x.text); }
  if (ts.isCallExpression(x) && ts.isPropertyAccessExpression(x.expression)) {
    const m = x.expression.name.text; const recv = x.expression.expression;
    if (ts.isIdentifier(recv) && (recv.text === "Array" && (m === "from" || m === "of"))) return true;
    if (ts.isIdentifier(recv) && recv.text === "Object" && (m === "keys" || m === "values" || m === "entries" || m === "fromEntries")) return true;
    // Auditor #466: a fresh-method name is fresh only on a receiver known to be a built-in value (never a module
    // object, an import, a helper's parameter or a call result the walk cannot type).
    // `by` collects those names (FRESH_BY_NAME), checked when the freshness is used to allow a write.
    if (FRESH_METHODS.has(m)) { if (!builtinValue(recv, b)) by?.add(m); return true; }
  }
  return false;
}

/** Resolves one free name of an analyzed body: locals, module functions (followed), module consts (initializer
 *  followed; refused when mutated anywhere in the module), enums, module state, imports, globals. */
function resolveName(a: Analysis, name: string, locals: ReadonlySet<string>): void {
  const add = (r: string) => a.reasons.add(r);
  if (locals.has(name)) return;
  if (a.idx.fns.has(name)) {
    if (a.fns.has(name)) return;
    a.fns.add(name);
    if (a.fns.size > MAX_FUNCTIONS) { add(TEST_TARGET_TOO_LARGE); return; }
    const decls = a.idx.fns.get(name)!.filter((d) => d.body);
    if (decls.length !== 1) { add(TEST_TARGET_IMPURE); return; }
    analyzeFunction(a, decls[0]!);
    return;
  }
  if (a.idx.consts.has(name)) {
    if (a.idx.mutated.has(name)) { add(TEST_TARGET_IMPURE); return; }
    if (a.consts.has(name)) return;
    a.consts.add(name);
    if (a.consts.size > MAX_CONSTS) { add(TEST_TARGET_TOO_LARGE); return; }
    // Auditor #466 (3rd review): a module const the walk reaches must hold no state between calls (fail-closed).
    if (!statelessInit(a.idx.consts.get(name)!.initializer!, { idx: a.idx, sf: a.sf, seen: new Set(), path: a.v2?.path ?? a.sf.fileName, read: a.v2?.read ?? null, cache: new Map(), lc: a.lc ?? a.v2?.lc }, name)) add(TEST_TARGET_IMPURE);
    analyzeExpression(a, a.idx.consts.get(name)!.initializer!);
    return;
  }
  if (a.idx.enums.has(name)) { noteEnumRead(a, name); if (a.v2) noteEnum(a.v2, a.idx, a.sf, name); return; }
  if (a.idx.mutable.has(name)) { add(TEST_TARGET_IMPURE); return; }
  const imp = a.idx.imports.get(name);
  if (imp) {
    if (imp.typeOnly) return;
    if (a.v2 && !NODE_BUILTINS.test(imp.spec) && (imp.spec.startsWith("./") || imp.spec.startsWith("../"))) { followImport(a, imp); return; }
    add(NODE_BUILTINS.test(imp.spec) ? TEST_TARGET_IO : TEST_TARGET_IMPURE);
    return;
  }
  if (IO_GLOBALS.has(name)) { add(TEST_TARGET_IO); return; }
  if (LOCAL_TIME_GLOBALS.has(name)) { add(TEST_TARGET_DATE_LOCAL); return; }
  if (PURE_GLOBALS.has(name)) return;
  add(TEST_TARGET_IMPURE);
}

function analyzeFunction(a: Analysis, f: ts.FunctionLikeDeclaration, envDefaults: ReadonlySet<ts.ParameterDeclaration> = new Set(), tested = false): void {
  const add = (r: string) => a.reasons.add(r);
  if (hasMod(f, ts.SyntaxKind.AsyncKeyword) || f.asteriskToken) add(TEST_TARGET_ASYNC);
  if (!f.body) { add(TEST_TARGET_IMPURE); return; }
  const dr = dateRefusalTE(f.body, f, a.v2?.v7 === true, tested && !a.callee ? f : undefined);
  if (dr === DATE_NOW || dr === DATE_LOCAL_TIME) add(TEST_TARGET_DATE_LOCAL);
  else if (dr === DATE_SETTER) add(TEST_TARGET_IMPURE);
  // Names declared anywhere inside the function (its params, locals, nested params): resolved locally.
  const locals = new Set<string>();
  const fresh = new Set<string>();
  // Auditor #466: built-in-valued names (see BuiltinNames). Only the tested function's parameters are plain data
  // (the check literals); a helper's parameters can be anything its caller passes.
  const plain = new Set<string>(tested ? f.parameters.flatMap((p) => (ts.isIdentifier(p.name) ? [p.name.text] : [])) : []);
  const builtin = new Set<string>();
  const deps = new Map<string, Set<string>>();
  // A write allowed because `x` is fresh: x's freshness by method name only is recorded (FRESH_BY_NAME).
  const usedFresh = (x: string) => { for (const d of deps.get(x) ?? []) a.reasons.add(FRESH_BY_NAME + d); };
  const bn: BuiltinNames = { plain, builtin, deps, used: usedFresh };
  // Every write to a name after its declaration: the right side of a plain `=`, or null (`x += ..`, `x++`, a
  // destructuring or for-of / for-in target): a built-in name must stay built-in through all of them.
  const writeRhs = new Map<string, (ts.Expression | null)[]>();
  const wrote = (k: string, rhs: ts.Expression | null) => { const l = writeRhs.get(k) ?? []; l.push(rhs); writeRhs.set(k, l); };
  const lhs = (x: ts.Node): void => { if (ts.isIdentifier(x)) wrote(x.text, null); else if (ts.isArrayLiteralExpression(x) || ts.isObjectLiteralExpression(x) || ts.isSpreadElement(x) || ts.isShorthandPropertyAssignment(x) || ts.isPropertyAssignment(x) || ts.isParenthesizedExpression(x) || ts.isNonNullExpression(x) || ts.isAsExpression(x)) ts.forEachChild(x, lhs); };
  const writes = (n: ts.Node): void => {
    if (ts.isBinaryExpression(n) && n.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && n.operatorToken.kind <= ts.SyntaxKind.LastAssignment) {
      const l = unwrapExpr(n.left);
      if (ts.isIdentifier(l) && n.operatorToken.kind === ts.SyntaxKind.EqualsToken) wrote(l.text, n.right); else lhs(n.left);
    }
    if ((ts.isPrefixUnaryExpression(n) || ts.isPostfixUnaryExpression(n)) && (n.operator === ts.SyntaxKind.PlusPlusToken || n.operator === ts.SyntaxKind.MinusMinusToken)) lhs(n.operand);
    if ((ts.isForOfStatement(n) || ts.isForInStatement(n)) && !ts.isVariableDeclarationList(n.initializer)) lhs(n.initializer);
    ts.forEachChild(n, writes);
  };
  writes(f.body);
  for (const p of f.parameters) if (p.initializer) writes(p.initializer);
  const collect = (b: ts.BindingName) => { if (ts.isIdentifier(b)) locals.add(b.text); else for (const el of b.elements) if (!ts.isOmittedExpression(el)) collect(el.name); };
  f.parameters.forEach((p) => collect(p.name));
  // A defaulted parameter may hold its default (module data, not a check literal) when a check omits it.
  for (const p of f.parameters) if (p.initializer && ts.isIdentifier(p.name) && !literalDefault(p.initializer) && !builtinValue(p.initializer, NO_BUILTINS)) plain.delete(p.name.text);
  const declCount = new Map<string, number>();
  const countDecl = (n: ts.Node): void => { if ((ts.isVariableDeclaration(n) || ts.isParameter(n) || ts.isBindingElement(n) || ts.isFunctionDeclaration(n) || ts.isFunctionExpression(n) || ts.isClassDeclaration(n)) && n.name && ts.isIdentifier(n.name)) declCount.set(n.name.text, (declCount.get(n.name.text) ?? 0) + 1); ts.forEachChild(n, countDecl); };
  countDecl(f.body);
  for (const p of f.parameters) if (ts.isIdentifier(p.name)) declCount.set(p.name.text, (declCount.get(p.name.text) ?? 0) + 1);
  // A name declared twice (shadowing in a nested scope) is ambiguous: never plain or built-in.
  for (const [k, c] of declCount) if (c > 1) plain.delete(k);
  // A re-pointed parameter keeps no path trust: it is a built-in candidate like a local.
  for (const k of [...plain]) if (writeRhs.has(k)) { plain.delete(k); builtin.add(k); }
  // Pass 1: locals and built-in candidates (a single declaration whose initializer is a built-in value).
  const inits = new Map<string, ts.Expression>();
  const declare = (n: ts.Node): void => {
    if (ts.isParameter(n) || ts.isBindingElement(n)) collect(n.name);
    if (ts.isVariableDeclaration(n)) {
      collect(n.name);
      if (ts.isIdentifier(n.name) && n.initializer && declCount.get(n.name.text) === 1) inits.set(n.name.text, n.initializer);
    }
    if ((ts.isFunctionDeclaration(n) || ts.isFunctionExpression(n)) && n.name && n !== f) locals.add(n.name.text);
    if (ts.isCatchClause(n) && n.variableDeclaration) collect(n.variableDeclaration.name);
    if (ts.isClassDeclaration(n) || ts.isClassExpression(n)) add(TEST_TARGET_IMPURE);
    ts.forEachChild(n, declare);
  };
  declare(f.body);
  for (const k of inits.keys()) builtin.add(k);
  // Greatest fixpoint: drop a candidate whose initializer or any write is not a built-in value given the others.
  for (let changed = true; changed;) {
    changed = false;
    for (const k of [...builtin]) {
      const init = inits.get(k);
      const okInit = init ? builtinValue(init, bn) : f.parameters.some((p) => ts.isIdentifier(p.name) && p.name.text === k) && tested;
      if (!okInit || (writeRhs.get(k) ?? []).some((r) => !r || !builtinValue(r, bn))) { builtin.delete(k); changed = true; }
    }
  }
  // Pass 2: fresh locals, with the final built-in names.
  const markFresh = (n: ts.Node): void => {
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name)) {
      const by = new Set<string>();
      if (isFresh(n.initializer, fresh, bn, by)) { fresh.add(n.name.text); deps.set(n.name.text, new Set([...(deps.get(n.name.text) ?? []), ...by])); }
    }
    ts.forEachChild(n, markFresh);
  };
  markFresh(f.body);
  // A `let` that is ever re-pointed at a non-fresh value is not fresh.
  const unfresh = (n: ts.Node): void => {
    if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isIdentifier(n.left) && fresh.has(n.left.text)) {
      const by = new Set<string>();
      if (!isFresh(n.right, fresh, bn, by)) fresh.delete(n.left.text);
      else deps.set(n.left.text, new Set([...(deps.get(n.left.text) ?? []), ...by]));
    }
    ts.forEachChild(n, unfresh);
  };
  unfresh(f.body);
  // Auditor #466 (all versions): a write through a fresh value (`c[0].n = 1`, `c[0].push(x)`) mutates what it holds,
  // which a copy (`xs.slice()`, `[...m.values()]`) shares with the caller or the module. Only a nest the function
  // builds itself is written two deep: a single-declaration local initialized with an array / object literal whose
  // slots are literals, every slot store a new literal (`matrix[i] = [i]`), and otherwise only read.
  const nest = new Set<string>();
  const slotNew = (e: ts.Expression | undefined): boolean => {
    const x = e && unwrapExpr(e);
    return !!x && (ts.isArrayLiteralExpression(x) || (ts.isObjectLiteralExpression(x) && x.properties.every((q) => !q.name || !ts.isIdentifier(q.name) || q.name.text !== "__proto__")));
  };
  for (const [k, init] of inits) {
    const x = unwrapExpr(init);
    const ok = fresh.has(k) && !f.parameters.some((q) => ts.isIdentifier(q.name) && q.name.text === k)
      && ((ts.isArrayLiteralExpression(x) && x.elements.every((el) => !ts.isSpreadElement(el) && slotNew(el)))
        || (ts.isObjectLiteralExpression(x) && x.properties.every((q) => ts.isPropertyAssignment(q) && slotNew(q.initializer))));
    if (ok) nest.add(k);
  }
  const SLOT_SAFE = new Set(["pop", "shift", "sort", "reverse"]);
  const inLhs = (n: ts.Node): boolean => {
    for (let c = n, q = n.parent; q && q !== f; c = q, q = q.parent) {
      if (ts.isBinaryExpression(q) && q.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && q.operatorToken.kind <= ts.SyntaxKind.LastAssignment && q.left === c) return true;
      if ((ts.isForOfStatement(q) || ts.isForInStatement(q)) && q.initializer === c) return true;
    }
    return false;
  };
  const nestUse = (n: ts.Node): void => {
    if (ts.isIdentifier(n) && nest.has(n.text) && isValueReference(n) && !(ts.isVariableDeclaration(n.parent) && n.parent.name === n)) {
      const k = n.text;
      const p = n.parent;
      let ok = false;
      if ((ts.isPropertyAccessExpression(p) || ts.isElementAccessExpression(p)) && p.expression === n) {
        const q = p.parent;
        const name = ts.isPropertyAccessExpression(p) ? p.name.text : "";
        if (ts.isBinaryExpression(q) && q.left === p) ok = q.operatorToken.kind === ts.SyntaxKind.EqualsToken && slotNew(q.right);
        else if (ts.isCallExpression(q) && q.expression === p && MUTATORS.has(name)) ok = SLOT_SAFE.has(name) || ((name === "push" || name === "unshift") && q.arguments.every(slotNew)) || (name === "splice" && q.arguments.slice(2).every(slotNew));
        else ok = !inLhs(p) || ((ts.isPropertyAccessExpression(q) || ts.isElementAccessExpression(q)) && q.expression === p);
        if (ok && inLhs(p) && !(ts.isBinaryExpression(q) && q.left === p) && !((ts.isPropertyAccessExpression(q) || ts.isElementAccessExpression(q)) && q.expression === p)) ok = false;
      } else if (ts.isForOfStatement(p) && p.expression === n) ok = true;
      if (!ok) nest.delete(k);
    }
    ts.forEachChild(n, nestUse);
  };
  nestUse(f.body);
  const nested = (e: ts.Expression, depth: number): boolean => { const r = rootName(e); return accessDepth(e) === depth && ts.isIdentifier(r) && nest.has(r.text); };
  const mutableTarget = (target: ts.Expression): boolean => {
    if (ts.isIdentifier(target)) return locals.has(target.text);
    if (ts.isArrayLiteralExpression(target) || ts.isObjectLiteralExpression(target)) return true; // destructuring: identifiers checked as references
    const r = rootName(target);
    // M97 (v7 hardening): a fresh copy (`[...m.values()]`, `new Map(m)`, `xs.slice()`) still holds the caller's objects,
    // so only the copy itself may be written (`c[k] = v`), never through it (`c[0].n = 1`).
    if (accessDepth(target) > 1 && (a.v2?.v7 || !nested(target, 2))) return false;
    if (ts.isIdentifier(r) && fresh.has(r.text)) { usedFresh(r.text); return true; }
    return false;
  };
  const resolve = (name: string): void => resolveName(a, name, locals);
  walk(a, f.body, resolve, mutableTarget, fresh, bn, (recv) => !a.v2?.v7 && nested(recv, 1));
  // M90: parameter defaults run at call time, so they get the body's rules (clock / local time / setters by name,
  // then the purity walk; nothing in a default may assign). Only adds refusals: v1-v3 accept no defaults on the
  // target, and a followed helper's default was previously not walked.
  for (const p of f.parameters) {
    if (!p.initializer) continue;
    // M93 (v6, tested function only): a `= process.env` default every check overrides (enforced by the callers).
    if (envDefaults.has(p)) continue;
    const pr = dateRefusalTE(p.initializer, undefined, a.v2?.v7 === true);
    if (pr === DATE_NOW || pr === DATE_LOCAL_TIME) add(TEST_TARGET_DATE_LOCAL);
    else if (pr === DATE_SETTER) add(TEST_TARGET_IMPURE);
    walk(a, p.initializer, resolve, () => false, fresh);
  }
}

/** A module const's initializer: the same rules with no locals (it runs once, at import). */
function analyzeExpression(a: Analysis, e: ts.Expression): void {
  const add = (r: string) => a.reasons.add(r);
  const dr = dateRefusalTE(e, undefined, a.v2?.v7 === true);
  if (dr === DATE_NOW || dr === DATE_LOCAL_TIME) add(TEST_TARGET_DATE_LOCAL);
  else if (dr === DATE_SETTER) add(TEST_TARGET_IMPURE);
  // Arrow/function initializers: analyzed as functions (a const helper).
  const x = ts.isParenthesizedExpression(e) ? e.expression : e;
  if (ts.isArrowFunction(x) || ts.isFunctionExpression(x)) { analyzeFunction(a, x); return; }
  // A stateful regex (g/y flags keep lastIndex between calls) is module state.
  const v = (n: ts.Node): void => { if (ts.isRegularExpressionLiteral(n) && /\/[a-z]*[gy][a-z]*$/.test(n.text)) add(TEST_TARGET_IMPURE); ts.forEachChild(n, v); };
  v(e);
  // Auditor #466: built-in instances that keep state between calls, created once at import (outside any function):
  // a RegExp built by `new RegExp(..)` / `RegExp(..)` unless its flags are a literal without g / y (`new RegExp("a")`,
  // `new RegExp("a", "i")`; a non-literal pattern may carry its own flags), and an iterator (`xs.values()`,
  // `.keys()`, `.entries()`, `.matchAll(..)`, `[Symbol.iterator]()`), which a call consumes.
  const lit = (x: ts.Expression | undefined) => !!x && ts.isStringLiteralLike(x);
  const statefulAtLoad = (n: ts.Node): void => {
    if (ts.isArrowFunction(n) || ts.isFunctionExpression(n) || ts.isMethodDeclaration(n) || ts.isGetAccessor(n) || ts.isSetAccessor(n)) return;
    if ((ts.isNewExpression(n) || ts.isCallExpression(n)) && ts.isIdentifier(n.expression) && n.expression.text === "RegExp") {
      const g = n.arguments ?? ts.factory.createNodeArray();
      const flags = g[1];
      if (!lit(g[0]) || g.length > 2 || (flags && (!lit(flags) || /[gy]/.test((flags as ts.StringLiteralLike).text)))) add(TEST_TARGET_IMPURE);
    }
    if (ts.isCallExpression(n)) {
      const c = n.expression;
      if (ts.isPropertyAccessExpression(c) && ["values", "keys", "entries", "matchAll"].includes(c.name.text) && !(ts.isIdentifier(c.expression) && c.expression.text === "Object")) add(TEST_TARGET_IMPURE);
      if (ts.isElementAccessExpression(c) && !ts.isStringLiteralLike(c.argumentExpression) && !ts.isNumericLiteral(c.argumentExpression)) add(TEST_TARGET_IMPURE);
    }
    ts.forEachChild(n, statefulAtLoad);
  };
  statefulAtLoad(e);
  const resolve = (name: string): void => resolveName(a, name, new Set());
  walk(a, e, resolve, () => false, new Set());
}

/** Auditor #466 (3rd review): names bound anywhere in `sf` to a regex (a literal, `new RegExp(..)` / `RegExp(..)`). */
const REGEX_NAMES = new WeakMap<ts.SourceFile, Set<string>>();
function regexNames(sf: ts.SourceFile): Set<string> {
  let out = REGEX_NAMES.get(sf);
  if (out) return out;
  out = new Set();
  const o = out;
  const v = (n: ts.Node): void => { if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer && regexValue(n.initializer, null)) o.add(n.name.text); ts.forEachChild(n, v); };
  v(sf);
  REGEX_NAMES.set(sf, out);
  return out;
}
function regexValue(e: ts.Expression, names: ReadonlySet<string> | null): boolean {
  const x = unwrapExpr(e);
  if (ts.isRegularExpressionLiteral(x)) return true;
  if ((ts.isNewExpression(x) || ts.isCallExpression(x)) && ts.isIdentifier(x.expression) && x.expression.text === "RegExp") return true;
  return !!names && ts.isIdentifier(x) && names.has(x.text);
}
function walk(a: Analysis, root: ts.Node, resolve: (name: string) => void, mutableTarget: (t: ts.Expression) => boolean, fresh: ReadonlySet<string>, bn: BuiltinNames = NO_BUILTINS, nestRecv?: (recv: ts.Expression) => boolean): void {
  const add = (r: string) => a.reasons.add(r);
  const v = (n: ts.Node): void => {
    // Auditor #466 (3rd review), RegExp, every version: the RegExp global is only ever called (`new RegExp(..)`,
    // `RegExp(..)`). Any other use (`RegExp.$1`, `RegExp.lastMatch`, `RegExp["$_"]`, `const R = RegExp`, an argument)
    // reaches its legacy statics, shared state the last match anywhere wrote. `.constructor` (`/a/.constructor.$1`,
    // `"".constructor.prototype`) and a computed key on a regex value (`rx[k]`) reach the same: refused.
    if (ts.isIdentifier(n) && n.text === "RegExp" && isValueReference(n) && !((ts.isNewExpression(n.parent) || ts.isCallExpression(n.parent)) && n.parent.expression === n)) add(TEST_TARGET_IMPURE);
    if ((ts.isPropertyAccessExpression(n) && n.name.text === "constructor") || (ts.isElementAccessExpression(n) && ts.isStringLiteralLike(n.argumentExpression) && n.argumentExpression.text === "constructor")) add(TEST_TARGET_IMPURE);
    if (ts.isElementAccessExpression(n) && !ts.isStringLiteralLike(n.argumentExpression) && !ts.isNumericLiteral(n.argumentExpression) && regexValue(n.expression, regexNames(n.getSourceFile()))) add(TEST_TARGET_IMPURE);
    if (ts.isTypeNode(n) || ts.isTypeAliasDeclaration(n) || ts.isInterfaceDeclaration(n)) return; // types never run
    if (ts.isAwaitExpression(n) || ts.isForOfStatement(n) && n.awaitModifier) add(TEST_TARGET_ASYNC);
    if (ts.isYieldExpression(n)) add(TEST_TARGET_ASYNC);
    if ((ts.isArrowFunction(n) || ts.isFunctionExpression(n) || ts.isFunctionDeclaration(n) || ts.isMethodDeclaration(n)) && (hasMod(n, ts.SyntaxKind.AsyncKeyword) || (n as ts.FunctionLikeDeclarationBase).asteriskToken)) add(TEST_TARGET_ASYNC);
    if (n.kind === ts.SyntaxKind.ThisKeyword || n.kind === ts.SyntaxKind.SuperKeyword) add(TEST_TARGET_IMPURE);
    if (ts.isMetaProperty(n)) add(TEST_TARGET_IO);
    if (ts.isCallExpression(n) && n.expression.kind === ts.SyntaxKind.ImportKeyword) add(TEST_TARGET_IO);
    if (ts.isDeleteExpression(n) && !mutableTarget(n.expression)) add(TEST_TARGET_IMPURE);
    if (ts.isClassDeclaration(n) || ts.isClassExpression(n) || ts.isWithStatement(n)) add(TEST_TARGET_IMPURE);
    if (ts.isIdentifier(n) && (n.text === "arguments" || n.text === "eval" || n.text === "Function") && isValueReference(n)) add(TEST_TARGET_IMPURE);
    if (ts.isBinaryExpression(n) && n.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && n.operatorToken.kind <= ts.SyntaxKind.LastAssignment && !mutableTarget(n.left)) add(TEST_TARGET_IMPURE);
    if ((ts.isPrefixUnaryExpression(n) || ts.isPostfixUnaryExpression(n)) && (n.operator === ts.SyntaxKind.PlusPlusToken || n.operator === ts.SyntaxKind.MinusMinusToken) && !mutableTarget(n.operand)) add(TEST_TARGET_IMPURE);
    if (ts.isPropertyAccessExpression(n) && ts.isIdentifier(n.expression)) {
      const o = n.expression.text, m = n.name.text;
      if (o === "Math" && m === "random") add(TEST_TARGET_IMPURE);
      if (o === "Object" && !OBJECT_OK.has(m)) add(TEST_TARGET_IMPURE);
    }
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && MUTATORS.has(n.expression.name.text)) {
      const recv = n.expression.expression;
      const r = rootName(recv);
      const isMap = ts.isIdentifier(r) && (r.text === "Map" || r.text === "Set");
      const by = new Set<string>();
      if (!isMap && !(ts.isIdentifier(r) ? fresh.has(r.text) : isFresh(recv, fresh, bn, by))) add(TEST_TARGET_IMPURE);
      else if (ts.isIdentifier(r)) bn.used?.(r.text); else for (const d of by) add(FRESH_BY_NAME + d);
      // M97 (v7 hardening): a mutating call only on the fresh value itself (`c.push(x)`), never on what it holds
      // (`c[0].push(x)`, `c.get(k).add(x)`), and never on the global Map / Set (`Map.prototype.set(...)`).
      if (isMap || (accessDepth(recv) > 0 && !nestRecv?.(recv))) add(TEST_TARGET_IMPURE);
    }
    // M97 (v7 hardening): a mutator is reached only as the direct callee `x.set(..)` checked above. Its other forms
    // (`Map.prototype.clear.call(m)`, `const f = m.set`, `m["clear"]()`, `m[k]()`, `const { add } = s`) are refused.
    if (a.v2?.v7) {
      const callee = (x: ts.Node) => ts.isCallExpression(x.parent) && x.parent.expression === x;
      if (ts.isPropertyAccessExpression(n) && MUTATORS.has(n.name.text) && !callee(n)) add(TEST_TARGET_IMPURE);
      if (ts.isElementAccessExpression(n) && ts.isStringLiteralLike(n.argumentExpression) && MUTATORS.has(n.argumentExpression.text)) add(TEST_TARGET_IMPURE);
      if (ts.isCallExpression(n) && ts.isElementAccessExpression(n.expression) && !ts.isStringLiteralLike(n.expression.argumentExpression)) add(TEST_TARGET_IMPURE);
      if (ts.isBindingElement(n) && ts.isObjectBindingPattern(n.parent) && MUTATORS.has(((n.propertyName ?? n.name) as ts.Node & { text?: string }).text ?? "")) add(TEST_TARGET_IMPURE);
    }
    if (ts.isNewExpression(n) && !(ts.isIdentifier(n.expression) && PURE_NEW.has(n.expression.text))) add(TEST_TARGET_IMPURE);
    // Auditor #466: members analyzed code defines on objects (see FRESH_BY_NAME / USER_MEMBER).
    if (ts.isObjectLiteralExpression(n)) for (const pr of n.properties) {
      if (ts.isSpreadAssignment(pr)) continue;
      const nm = pr.name;
      if (!nm || ts.isPrivateIdentifier(nm)) add(`${USER_MEMBER}*`);
      else if (ts.isComputedPropertyName(nm)) { if (!(ts.isPropertyAssignment(pr) && neverCallable(pr.initializer))) add(`${USER_MEMBER}*`); }
      else add(USER_MEMBER + nm.text);
    }
    if (ts.isBinaryExpression(n) && n.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && n.operatorToken.kind <= ts.SyntaxKind.LastAssignment) {
      const t = unwrapExpr(n.left);
      if (ts.isPropertyAccessExpression(t)) add(USER_MEMBER + t.name.text);
      else if (ts.isElementAccessExpression(t)) { if (ts.isStringLiteralLike(t.argumentExpression) || ts.isNumericLiteral(t.argumentExpression)) add(USER_MEMBER + t.argumentExpression.text); else if (!neverCallable(n.right)) add(`${USER_MEMBER}*`); }
    }
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && ts.isIdentifier(n.expression.expression) && n.expression.expression.text === "Object" && n.expression.name.text === "fromEntries") add(`${USER_MEMBER}*`);
    // Auditor #466: prototypes and stack text (paths / line numbers of the checkout) are never plain data.
    if (ts.isPropertyAccessExpression(n) && (n.name.text === "prototype" || n.name.text === "__proto__" || STACK_NAMES.has(n.name.text))) add(TEST_TARGET_IMPURE);
    if (ts.isElementAccessExpression(n) && ts.isStringLiteralLike(n.argumentExpression) && (n.argumentExpression.text === "prototype" || n.argumentExpression.text === "__proto__" || STACK_NAMES.has(n.argumentExpression.text))) add(TEST_TARGET_IMPURE);
    // Auditor #466: `Object` only as `Object.<allowed>(..)`: an alias (`const O = Object`), an argument or
    // `Object[k]` could reach defineProperty / assign / setPrototypeOf.
    if (ts.isIdentifier(n) && n.text === "Object" && isValueReference(n) && !(ts.isPropertyAccessExpression(n.parent) && n.parent.expression === n)) add(TEST_TARGET_IMPURE);
    if (ts.isTaggedTemplateExpression(n) && !(ts.isPropertyAccessExpression(n.tag) && ts.isIdentifier(n.tag.expression) && n.tag.expression.text === "String" && n.tag.name.text === "raw")) add(TEST_TARGET_IMPURE);
    if (ts.isIdentifier(n) && isValueReference(n)) resolve(n.text);
    if (ts.isShorthandPropertyAssignment(n)) resolve(n.name.text);
    ts.forEachChild(n, v);
  };
  v(root);
}

/** M93 (v6): the global `NodeJS.ProcessEnv` type reference (no type arguments; `NodeJS` not declared or imported in the module). */
function processEnvType(t: ts.TypeNode | undefined, idx: ModuleIndex): boolean {
  return !!t && ts.isTypeReferenceNode(t) && !t.typeArguments?.length && ts.isQualifiedName(t.typeName) && ts.isIdentifier(t.typeName.left) && t.typeName.left.text === "NodeJS" && t.typeName.right.text === "ProcessEnv" && unshadowed(idx, "NodeJS");
}
/** M93 (v6): exactly `process.env` (the global `process`, never shadowed in the module). */
function processEnvDefault(e: ts.Expression | undefined, idx: ModuleIndex): boolean {
  return !!e && ts.isPropertyAccessExpression(e) && !e.questionDotToken && ts.isIdentifier(e.expression) && e.expression.text === "process" && e.name.text === "env" && unshadowed(idx, "process");
}
/**
 * M93 (v6): positions of the tested function's `p: NodeJS.ProcessEnv = process.env` parameters (every call in every
 * check must pass an object literal there). Null when the function is not a single exported declaration.
 */
export function envDefaultParams(content: string, fn: string): number[] | null {
  const sf = ts.createSourceFile("m.ts", content, ts.ScriptTarget.Latest, true);
  const idx = indexModule(sf);
  const decls = idx.fns.get(fn) ?? [];
  if (decls.length !== 1) return null;
  return decls[0]!.parameters.flatMap((p, i) => (processEnvType(p.type, idx) && processEnvDefault(p.initializer, idx) ? [i] : []));
}
/** M93 (v6): every call of `fn` under `root` passes an object literal at each position in `at` (so a default there never runs). */
export function callsPassEnv(root: ts.Node, fn: string, at: readonly number[]): boolean {
  let ok = true;
  let calls = 0;
  const v = (n: ts.Node): void => {
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === fn) { calls++; for (const i of at) { const g = n.arguments[i]; if (!g || !ts.isObjectLiteralExpression(g)) ok = false; } }
    // The function passed or aliased as a value (not called) could be called without the argument.
    else if (ts.isIdentifier(n) && n.text === fn && !(ts.isCallExpression(n.parent) && n.parent.expression === n) && !ts.isImportSpecifier(n.parent)) ok = false;
    ts.forEachChild(n, v);
  };
  v(root);
  return ok && (at.length === 0 || calls > 0);
}
/** M93 (Auditor #460): bound on the modules walked for imports of the target module (more is refused). */
const MAX_ENV_CLOSURE = 64;
/**
 * M93 (v6, Auditor #460): the `= process.env` default is skipped by the purity walk only when nothing but the test can
 * reach it. True (refused) when:
 * - code of the target module that runs when the target or the module runs (the target's body, every function or const
 *   the walk followed, every top-level statement other than a function declaration) references the target except as a
 *   direct call passing, at every env-default position, an object literal or (in the target's own body only) the
 *   target's own env parameter, never assigned anywhere in the module;
 * - the module has a dynamic `import(...)`;
 * - any module in the relative value-import closure of the target module imports or re-exports the target module
 *   (named, namespace, default or side-effect), or the closure has more than MAX_ENV_CLOSURE modules.
 */
function envTargetReferenced(v: V2Ctx, fn: string, decl: ts.FunctionDeclaration, at: readonly number[]): boolean {
  const root = v.modules.get(v.root);
  if (!root) return true;
  const { idx, sf, fns, consts } = root;
  const own = new Set(at.flatMap((i) => { const p = decl.parameters[i]; return p && ts.isIdentifier(p.name) && !idx.mutated.has(p.name.text) ? [p.name.text] : []; }));
  // A name re-declared anywhere inside the target (a nested parameter, variable, function, class or catch binding) may
  // not be the env parameter at a call site, so it is never trusted as one.
  const redeclared = (n: ts.Node): void => {
    if (ts.isIdentifier(n) && own.has(n.text) && !decl.parameters.some((p) => p.name === n)) {
      const q = n.parent as ts.Node & { name?: ts.Node };
      if ((ts.isVariableDeclaration(q) || ts.isParameter(q) || ts.isBindingElement(q) || ts.isFunctionDeclaration(q) || ts.isFunctionExpression(q) || ts.isClassDeclaration(q) || ts.isClassExpression(q)) && q.name === n) own.delete(n.text);
      if (ts.isBindingElement(q) && q.propertyName === n && !q.name) own.delete(n.text);
    }
    ts.forEachChild(n, redeclared);
  };
  redeclared(decl);
  let bad = false;
  const okArg = (g: ts.Expression | undefined, inTarget: boolean) => !!g && (ts.isObjectLiteralExpression(g) || (inTarget && ts.isIdentifier(g) && own.has(g.text)));
  const walk = (n: ts.Node, inTarget: boolean): void => {
    if (bad) return;
    if (ts.isCallExpression(n) && (n.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(n.expression) && n.expression.text === "require"))) { bad = true; return; }
    if (ts.isImportEqualsDeclaration(n)) { bad = true; return; }
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === fn) {
      if (!at.every((i) => okArg(n.arguments[i], inTarget))) { bad = true; return; }
      for (const g of n.arguments) walk(g, inTarget);
      return;
    }
    if (ts.isIdentifier(n) && n.text === fn && n !== decl.name && !(ts.isExportSpecifier(n.parent) && !n.parent.propertyName && !n.parent.parent.parent.moduleSpecifier)) { bad = true; return; }
    ts.forEachChild(n, (c) => walk(c, inTarget));
  };
  walk(decl, true);
  // Auditor #460 (2nd review): every top-level function the target, a followed function or any load-time code (a
  // top-level statement other than a function declaration) can name, transitively, is walked too; so a function only
  // a top-level initializer calls (`export const READY = h()`) is checked. A function nothing can name stays unwalked.
  const reach = new Set<string>([...fns]);
  const nameRefs = (n: ts.Node): void => {
    if (ts.isIdentifier(n) && idx.fns.has(n.text) && !reach.has(n.text)) {
      reach.add(n.text);
      for (const d of idx.fns.get(n.text)!) nameRefs(d);
    }
    ts.forEachChild(n, nameRefs);
  };
  nameRefs(decl);
  for (const s of sf.statements) if (!ts.isFunctionDeclaration(s) || (s.name && fns.has(s.name.text))) nameRefs(s);
  for (const s of sf.statements) {
    if (ts.isFunctionDeclaration(s)) { if (s !== decl && s.name && reach.has(s.name.text)) walk(s, false); continue; }
    if (ts.isVariableStatement(s) || ts.isExpressionStatement(s) || ts.isEnumDeclaration(s) || ts.isExportAssignment(s) || ts.isExportDeclaration(s) || ts.isIfStatement(s) || ts.isBlock(s) || ts.isForStatement(s) || ts.isForOfStatement(s) || ts.isForInStatement(s) || ts.isWhileStatement(s) || ts.isDoStatement(s) || ts.isTryStatement(s) || ts.isSwitchStatement(s) || ts.isLabeledStatement(s) || ts.isClassDeclaration(s) || ts.isModuleDeclaration(s) || ts.isThrowStatement(s)) walk(s, false);
    else if (!ts.isImportDeclaration(s) && !ts.isInterfaceDeclaration(s) && !ts.isTypeAliasDeclaration(s) && !ts.isEmptyStatement(s)) bad = true;
  }
  void consts; // followed consts are top-level variable statements, walked above
  if (bad) return true;
  // The relative value-import closure of the target module: none of it may import the target module back.
  const seen = new Set<string>([v.root]);
  const queue = [v.root];
  while (queue.length) {
    const p = queue.shift()!;
    const text = p === v.root ? sf.text : v.read(p);
    if (text === null) continue;
    const m = p === v.root ? sf : ts.createSourceFile(p, text, ts.ScriptTarget.Latest, true);
    // Auditor #460 (2nd review): `require(...)`, `import x = require(...)` and dynamic `import(...)` anywhere in another
    // module of the closure are refused (they load modules this walk does not see). In the target module the walk above
    // refuses them in every function and statement that can run.
    let loads = false;
    const seeLoads = (n: ts.Node): void => { if (loads) return; if ((ts.isCallExpression(n) && (n.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(n.expression) && n.expression.text === "require"))) || (ts.isImportEqualsDeclaration(n) && ts.isExternalModuleReference(n.moduleReference))) loads = true; else ts.forEachChild(n, seeLoads); };
    if (p !== v.root) seeLoads(m);
    if (loads) return true;
    for (const s of m.statements) {
      if (!(ts.isImportDeclaration(s) || ts.isExportDeclaration(s)) || !s.moduleSpecifier || !ts.isStringLiteral(s.moduleSpecifier)) continue;
      const typeOnly = ts.isImportDeclaration(s) ? !!s.importClause?.isTypeOnly : s.isTypeOnly;
      const hits = (siblingCandidates(p, s.moduleSpecifier.text) ?? []).filter((c) => c === v.root || v.read(c) !== null);
      if (p !== v.root && hits.includes(v.root)) return true;
      if (typeOnly) continue;
      // Auditor #460 (2nd review): a relative value or side-effect import that is not exactly one readable .ts module
      // (`./c.mjs`, `./c.js` with no c.ts, `./data.json`) is code this walk cannot see: refused.
      if (/^\.\.?\//.test(s.moduleSpecifier.text) && hits.length !== 1) return true;
      for (const c of hits) if (!seen.has(c)) { seen.add(c); if (seen.size > MAX_ENV_CLOSURE) return true; queue.push(c); }
    }
  }
  return false;
}
/** M93: Job B, on the graded test file: null when every call of `fn` passes an object literal for its env-default parameters. */
export function envArgProblem(moduleContent: string, fn: string, testContent: string): string | null {
  const at = envDefaultParams(moduleContent, fn);
  if (at === null) return "env-target-unreadable";
  if (!at.length) return null;
  const sf = ts.createSourceFile("t.ts", testContent, ts.ScriptTarget.Latest, true);
  return callsPassEnv(sf, fn, at) ? null : "env-default-not-overridden";
}

/** M90 (v4): an untyped parameter is accepted only with a string / number / boolean literal default (its type is that primitive). */
function literalDefault(e: ts.Expression | undefined): boolean {
  if (!e) return false;
  if (ts.isStringLiteral(e) || ts.isNumericLiteral(e) || e.kind === ts.SyntaxKind.TrueKeyword || e.kind === ts.SyntaxKind.FalseKeyword) return true;
  return ts.isPrefixUnaryExpression(e) && e.operator === ts.SyntaxKind.MinusToken && ts.isNumericLiteral(e.operand);
}

// ---------------------------------------------------------------------------------------------------------------
// Auditor ruling on the #466 load-call allowance, part (c): the WHOLE-REPO SHARED-BINDING SCAN (every version, every
// gate call; only adds refusals). `idx.mutated` sees one module, so a module const the target reads that ANOTHER
// module writes (or pushes into), or that an export hands out, passed. Now every module-level const the analysis read
// (exported or not; a literal or a call result) and every enum it read is checked over the WHOLE target repo
// (`opts.repo`: every file the rule was given, test files included), with the TypeScript binder resolving names, so
// aliases, renamed imports, namespace members and shadowing are followed by symbol, never by spelling:
// - no module writes it or anything inside it: assignment (also compound, logical and destructuring targets), ++ / --,
//   delete, a for-in / for-of target, a mutating method (push, set, sort, fill, ...), a method the scan does not know,
//   Object.assign / defineProperty / freeze / setPrototypeOf, Reflect.*;
// - nothing hands it out or passes it on: a return / yield / throw / `export default` / arrow body, a class field,
//   storing it in another object, an argument (or spread argument) to a callee the scan cannot follow (a function
//   declaration or a const arrow / function expression of the repo is followed: its parameter becomes an alias), a
//   tagged template, a re-export of any form (`export { X as Y }`, `export { X } from`, `export *`, `export * as`);
// - aliases are followed: `const a = L`, `a = L`, destructuring (`const { x } = L`, `[a] = L`), for-of variables,
//   callback parameters of read methods, parameters of followed callees, defaults, conditional / `??` / `||` results,
//   containers that hold it (`[L]`, `{ k: L }`, `[...L]`), read-method results that hold parts of it (`find`, `slice`,
//   Object.values / entries, Array.from, `new Set(L)`); each alias carries its depth below the binding;
// - fail closed: any unparseable module, any dynamic import or require with a non-literal specifier (or `require`
//   used as a value), eval / Function, a string-literal timer, an import-equals, a bare specifier that may name a
//   repo module (`@/`, `~/`, `#`, `/`, or a repo top-level directory), a namespace import of a module declaring the
//   binding (or an alias) used as anything but `ns.member` reads, a literal dynamic import / require of such a module;
// - a primitive const (literal or arithmetic initializer, or a call whose declared return type is primitive) holds no
//   state and is skipped; a const function value is checked for writes only; reads that reach a primitive (by the
//   initializer's literal shape, or a primitive-array return type) end the walk.
// Without `opts.repo` (Job B today, direct callers), any such binding is refused (fail closed).
export interface RepoFile { readonly path: string; readonly content: string }
/**
 * Auditor #466 (c), option A (joint Builder + Auditor decision): the one builder of both repo lists, used by Job A
 * (generate.ts) and Job B (test-candidates.ts gradeExisting), with two separate outputs:
 * - `context`: every path the target config puts in scope (`isSource`, test files included) and does not deny, with its
 *   regular-file content. The only list that may reach model context, prompts, edits, records, logs or artifacts.
 * - `scan`: the same plus the denied in-scope paths, for the static shared-binding scan only (an `export * from` a
 *   denied module, or a denied module that writes or hands out a binding, is then seen and judged; it is never a target).
 *   Its file and byte caps (MAX_SCAN_FILES / MAX_SCAN_BYTES) count denied files too and fail closed (too large).
 * Unreadable paths are dropped from both (the scan then fails closed on any import of them).
 */
/**
 * The one reader Job A and Job B hand repoFileLists: a regular file inside `root` (resolved for real), else null. A
 * symlink (broken or not), a directory, a file reached through a symlinked directory outside the root, or any read
 * error is skipped, never thrown.
 */
export function regularFileReader(root: string): (rel: string) => string | null {
  let real: string | null = null;
  try { real = realpathSync(root); } catch { real = null; }
  return (rel: string): string | null => {
    if (real === null) return null;
    try {
      const p = join(root, rel);
      if (!lstatSync(p).isFile()) return null;
      const r = relative(real, realpathSync(p));
      if (r === "" || r.startsWith("..") || isAbsolute(r)) return null;
      return readFileSync(p, "utf8");
    } catch { return null; }
  };
}
export function repoFileLists(paths: Iterable<string>, scope: { isSource(p: string): boolean; isDenied(p: string): boolean }, read: (p: string) => string | null): { context: RepoFile[]; scan: RepoFile[] } {
  const context: RepoFile[] = [];
  const scan: RepoFile[] = [];
  const seen = new Set<string>();
  for (const p of paths) {
    if (!p || seen.has(p) || !scope.isSource(p)) continue;
    seen.add(p);
    const c = read(p);
    if (c === null) continue;
    const f = { path: p, content: c };
    scan.push(f);
    if (!scope.isDenied(p)) context.push(f);
  }
  return { context, scan };
}
/** Bounds of the scan (more is refused, test_target_too_large). */
export const MAX_SCAN_FILES = 4000;
export const MAX_SCAN_BYTES = 48 * 1024 * 1024;
const MAX_SCAN_ROUNDS = 24;
const MAX_SCAN_ALIASES = 512;
const SCAN_CODE = /\.(?:[cm]?ts|tsx|[cm]?js|jsx)$/;
const SCAN_DECL = /\.d\.[cm]?ts$/;
const SCAN_ROOT = "/repo/";
const INF_DEPTH = 1e6;
const SHARED_TOO_LARGE = "too_large";
/** Methods that change their receiver. */
const WRITE_METHODS = new Set([...MUTATORS, "fill", "copyWithin", "setTime"]);
/** Read methods whose result is a primitive (or undefined); callbacks still get their parameters aliased. */
const PRIM_RESULT_METHODS = new Set(["indexOf", "lastIndexOf", "includes", "join", "some", "every", "findIndex", "findLastIndex", "has", "toString", "toLocaleString", "forEach", "toFixed", "toPrecision", "startsWith", "endsWith", "charAt", "charCodeAt", "codePointAt", "localeCompare", "padStart", "padEnd", "trim", "trimStart", "trimEnd", "toLowerCase", "toUpperCase", "repeat", "replace", "replaceAll", "split", "substring", "substr", "normalize", "match", "search", "test", "getTime", "valueOf", "toISOString", "hasOwnProperty", "isPrototypeOf", "propertyIsEnumerable"]);
/** Read methods whose result is (or holds) parts of the receiver: an element of it, or a fresh container of its elements. */
const ELEMENT_RESULT_METHODS = new Set(["at", "find", "findLast", "get", "reduce", "reduceRight"]);
/** Read methods whose result holds only the callback's return values (those are checked as callback hand-outs). */
const MAPPED_RESULT_METHODS = new Set(["map", "flatMap", "exec"]);
/** String methods that take a regex pattern and read it (a g / y module regex is refused by statelessInit). */
const STRING_REGEX_METHODS = new Set(["match", "matchAll", "replace", "replaceAll", "split", "search"]);
const CONTAINER_RESULT_METHODS = new Set(["slice", "concat", "filter", "flat", "toSorted", "toReversed", "toSpliced", "with", "values", "keys"]);
const ENTRY_RESULT_METHODS = new Set(["entries"]);
/** Map values sit two counted steps below the Map (its [k, v] entry pairs are one step down; see shapeDepth). */
const MAP_GET_DEPTH = 2;
/** Callback parameter roles by method: e = element, i = index (primitive), a = the receiver, c = accumulator. */
const CALLBACK_ROLES: Record<string, string> = { reduce: "ceia", reduceRight: "ceia", toSorted: "ee", sort: "ee" };
/** Global callees that read an argument and return a primitive (or a fresh deep copy). */
/** Globals whose result is always a primitive (Math.* too, except the impure random, which statelessInit refuses anyway). */
const PRIM_RETURN_GLOBALS = new Set(["String", "Number", "Boolean", "BigInt", "isNaN", "isFinite", "parseInt", "parseFloat", "Array.isArray", "Object.is", "Number.isInteger", "Number.isFinite", "Number.isNaN", "Number.isSafeInteger", "Number.parseFloat", "Number.parseInt", "Date.UTC", "Date.parse", "encodeURIComponent", "decodeURIComponent"]);
const PRIM_GLOBAL_CALLS = new Set(["String", "Number", "Boolean", "BigInt", "isNaN", "isFinite", "parseInt", "parseFloat", "Array.isArray", "JSON.stringify", "Object.is", "Object.hasOwn", "Object.keys", "Object.getOwnPropertyNames", "Object.isFrozen", "Object.isSealed", "Object.isExtensible", "Number.isInteger", "Number.isFinite", "Number.isNaN", "Number.isSafeInteger", "Number.parseFloat", "Number.parseInt", "structuredClone", "encodeURIComponent", "decodeURIComponent"]);
/** Global callees whose result is a fresh container of the argument's elements (or entries of them). */
const CONTAINER_GLOBAL_CALLS = new Set(["Object.values", "Array.from", "Object.fromEntries"]);
const ENTRY_GLOBAL_CALLS = new Set(["Object.entries"]);
const CONTAINER_GLOBAL_NEW = new Set(["Set", "Map"]);
/** Callback arguments the scan accepts without following: global conversions (no access to the receiver). */
const GLOBAL_CALLBACKS = new Set(["String", "Number", "Boolean"]);

interface RepoIndex { checker: ts.TypeChecker; files: Map<string, ts.SourceFile>; problem: string | null; resolve: (spec: string, from: string) => string | null }
const REPO_INDEX = new WeakMap<readonly RepoFile[], RepoIndex>();
const scriptKindOf = (p: string): ts.ScriptKind => (/\.tsx$/.test(p) ? ts.ScriptKind.TSX : /\.jsx$/.test(p) ? ts.ScriptKind.JSX : /\.[cm]?js$/.test(p) ? ts.ScriptKind.JS : ts.ScriptKind.TS);
const relOf = (fileName: string): string => (fileName.startsWith(SCAN_ROOT) ? fileName.slice(SCAN_ROOT.length) : fileName);
/** The global name path of a callee the binder does not resolve (`Object.assign`, `String`), else null. */
/** A name no repo declaration binds (a global; JS files bind `require` / `module` to declaration-less symbols). */
const isGlobalId = (n: ts.Identifier, checker: ts.TypeChecker): boolean => { const s = checker.getSymbolAtLocation(n); return !s || !s.declarations?.length; };
function globalCallee(e: ts.Expression, checker: ts.TypeChecker): string | null {
  const x = unwrapExpr(e);
  if (ts.isIdentifier(x)) return isGlobalId(x, checker) ? x.text : null;
  if (ts.isPropertyAccessExpression(x) && ts.isIdentifier(x.expression) && isGlobalId(x.expression, checker)) return `${x.expression.text}.${x.name.text}`;
  return null;
}
function inTypePosition(n: ts.Node): boolean {
  for (let q = n.parent; q; q = q.parent) {
    if (ts.isExpressionWithTypeArguments(q)) return !(ts.isHeritageClause(q.parent) && q.parent.token === ts.SyntaxKind.ExtendsKeyword && ts.isClassLike(q.parent.parent));
    if (ts.isTypeNode(q)) return true;
    if (ts.isStatement(q) || ts.isSourceFile(q) || ts.isExpression(q) && !ts.isIdentifier(q) && !ts.isQualifiedName(q as ts.Node)) return false;
  }
  return false;
}

function repoIndex(repo: readonly RepoFile[]): RepoIndex {
  const hit = REPO_INDEX.get(repo);
  if (hit) return hit;
  const code = repo.filter((f) => SCAN_CODE.test(f.path) && !SCAN_DECL.test(f.path));
  const texts = new Map<string, string>();
  let bytes = 0;
  for (const f of code) { texts.set(SCAN_ROOT + f.path, f.content); bytes += f.content.length; }
  const dirs = new Set<string>(["/repo"]);
  for (const k of texts.keys()) { let d = k; while (d.includes("/") && d !== "/repo") { d = d.slice(0, d.lastIndexOf("/")); dirs.add(d); } }
  const top = new Set(repo.map((f) => f.path.split("/")[0]!).filter((s) => s && !SCAN_CODE.test(s)));
  const options: ts.CompilerOptions = { noLib: true, allowJs: true, checkJs: false, noEmit: true, types: [], module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, allowImportingTsExtensions: true, target: ts.ScriptTarget.Latest, jsx: ts.JsxEmit.Preserve };
  const host: ts.CompilerHost = {
    getSourceFile: (fn, lang) => { const t = texts.get(fn); return t === undefined ? undefined : ts.createSourceFile(fn, t, lang, true, scriptKindOf(fn)); },
    getDefaultLibFileName: () => "/lib.d.ts",
    writeFile: () => {},
    getCurrentDirectory: () => "/repo",
    getCanonicalFileName: (f) => f,
    useCaseSensitiveFileNames: () => true,
    getNewLine: () => "\n",
    fileExists: (f) => texts.has(f),
    readFile: (f) => texts.get(f),
    directoryExists: (d) => dirs.has(d.replace(/\/$/, "")),
    getDirectories: () => [],
    realpath: (f) => f,
  };
  const program = ts.createProgram({ rootNames: code.length > MAX_SCAN_FILES || bytes > MAX_SCAN_BYTES ? [] : [...texts.keys()], options, host });
  const checker = program.getTypeChecker();
  const files = new Map<string, ts.SourceFile>();
  for (const sf of program.getSourceFiles()) files.set(sf.fileName, sf);
  const cache = new Map<string, string | null>();
  const resolve = (spec: string, from: string): string | null => {
    const k = `${from}\0${spec}`;
    if (!cache.has(k)) { const r = ts.resolveModuleName(spec, from, options, host).resolvedModule?.resolvedFileName; cache.set(k, r && files.has(r) ? r : null); }
    return cache.get(k)!;
  };
  let problem: string | null = code.length > MAX_SCAN_FILES || bytes > MAX_SCAN_BYTES ? SHARED_TOO_LARGE : null;
  const fail = (why: string, sf: ts.SourceFile) => { if (!problem) problem = `${why}:${relOf(sf.fileName)}`; };
  const literal = (e: ts.Expression | undefined): e is ts.StringLiteralLike => !!e && ts.isStringLiteralLike(e);
  for (const sf of problem ? [] : files.values()) {
    if ((sf as unknown as { parseDiagnostics: unknown[] }).parseDiagnostics.length) { fail("unparseable", sf); continue; }
    const specs: ts.StringLiteralLike[] = [];
    const v = (n: ts.Node): void => {
      if ((ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) && n.moduleSpecifier && literal(n.moduleSpecifier)) specs.push(n.moduleSpecifier);
      if (ts.isImportEqualsDeclaration(n)) fail("import_equals", sf);
      if (ts.isCallExpression(n) && n.expression.kind === ts.SyntaxKind.ImportKeyword) { if (n.arguments.length >= 1 && literal(n.arguments[0])) specs.push(n.arguments[0]); else fail("dynamic_import", sf); }
      if (ts.isIdentifier(n) && !inTypePosition(n) && isValueReference(n) && isGlobalId(n, checker)) {
        const p = n.parent;
        if (n.text === "require") { if (ts.isCallExpression(p) && p.expression === n && p.arguments.length === 1 && literal(p.arguments[0])) specs.push(p.arguments[0]); else fail("require", sf); }
        if (n.text === "eval" || n.text === "Function") fail(n.text, sf);
        if (/^set(?:Timeout|Interval|Immediate)$/.test(n.text) && ts.isCallExpression(p) && p.expression === n && p.arguments[0] && !ts.isArrowFunction(p.arguments[0]) && !ts.isFunctionExpression(p.arguments[0]) && !ts.isIdentifier(p.arguments[0])) fail("string_timer", sf);
      }
      ts.forEachChild(n, v);
    };
    v(sf);
    for (const s of specs) {
      const t = s.text;
      // Auditor #505 (4): a relative import / export / require / import() must resolve to a scanned file (an unscanned
      // module could write the binding); only a declaration-level type-only import / export (erased) is exempt
      if (t.startsWith("./") || t.startsWith("../") || t === "." || t === "..") {
        const decl = s.parent;
        const typeOnly = (ts.isImportDeclaration(decl) && !!decl.importClause?.isTypeOnly) || (ts.isExportDeclaration(decl) && decl.isTypeOnly);
        if (!typeOnly && !resolve(t, sf.fileName)) fail("unresolved_relative_import", sf);
        continue;
      }
      if (/^(?:node:|[a-z0-9][\w.-]*:)/i.test(t) && !t.startsWith("/")) continue;
      if (/^(?:@\/|~\/|#|\/)/.test(t) || top.has(t.split("/")[0]!) || resolve(t, sf.fileName)) fail("bare_internal_specifier", sf);
    }
  }
  const ri: RepoIndex = { checker, files, problem, resolve };
  REPO_INDEX.set(repo, ri);
  return ri;
}

/** One binding the analysis read: its module, name and declaration. */
interface ReadBinding { path: string; name: string; sf: ts.SourceFile; idx: ModuleIndex; isEnum: boolean }
type BindingShape = { kind: "prim"; globals?: Set<string> } | { kind: "fn" } | { kind: "data"; primDepth: number; regex?: boolean };
/** The value shape of a const initializer: 0 = a primitive, k = every value k property steps down is primitive, INF = unknown. */
function shapeDepth(e: ts.Expression, m: { sf: ts.SourceFile; idx: ModuleIndex }, read: (rel: string) => string | null, seen: Set<string>, depth = 0): number {
  if (depth > 12) return INF_DEPTH;
  const x = unwrapExpr(e);
  if (ts.isStringLiteralLike(x) || ts.isNumericLiteral(x) || ts.isBigIntLiteral(x) || x.kind === ts.SyntaxKind.TrueKeyword || x.kind === ts.SyntaxKind.FalseKeyword || x.kind === ts.SyntaxKind.NullKeyword || ts.isTemplateExpression(x) || ts.isTypeOfExpression(x) || ts.isVoidExpression(x)) return 0;
  if (ts.isPrefixUnaryExpression(x)) return 0;
  if (regexInit(x, m.idx)) return 1; // its properties (source, flags, lastIndex, ...) are primitives
  if (ts.isBinaryExpression(x)) {
    const k = x.operatorToken.kind;
    if (k >= ts.SyntaxKind.FirstAssignment && k <= ts.SyntaxKind.LastAssignment) return INF_DEPTH;
    if (k === ts.SyntaxKind.QuestionQuestionToken || k === ts.SyntaxKind.BarBarToken || k === ts.SyntaxKind.AmpersandAmpersandToken || k === ts.SyntaxKind.CommaToken) return Math.max(shapeDepth(x.left, m, read, seen, depth + 1), shapeDepth(x.right, m, read, seen, depth + 1));
    return 0;
  }
  if (ts.isConditionalExpression(x)) return Math.max(shapeDepth(x.whenTrue, m, read, seen, depth + 1), shapeDepth(x.whenFalse, m, read, seen, depth + 1));
  if (ts.isIdentifier(x)) {
    if (x.text === "undefined" && unshadowed(m.idx, "undefined")) return 0;
    const d = m.idx.consts.get(x.text);
    const key = `${m.sf.fileName}\0${x.text}`;
    if (!d?.initializer || m.idx.mutated.has(x.text) || seen.has(key)) return INF_DEPTH;
    seen.add(key);
    return shapeDepth(d.initializer, m, read, seen, depth + 1) === 0 ? 0 : INF_DEPTH;
  }
  if (ts.isPropertyAccessExpression(x) && ts.isIdentifier(x.expression) && m.idx.enums.has(x.expression.text) && !m.idx.consts.has(x.expression.text) && !m.idx.imports.has(x.expression.text)) return 0;
  if (ts.isArrayLiteralExpression(x)) {
    let r = 1;
    for (const el of x.elements) { if (ts.isSpreadElement(el)) return INF_DEPTH; if (!ts.isOmittedExpression(el)) r = Math.max(r, 1 + shapeDepth(el, m, read, seen, depth + 1)); }
    return r >= INF_DEPTH ? INF_DEPTH : r;
  }
  if (ts.isObjectLiteralExpression(x)) {
    let r = 1;
    for (const p of x.properties) {
      if (ts.isPropertyAssignment(p) && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name) || ts.isNumericLiteral(p.name)) && !(ts.isIdentifier(p.name) && p.name.text === "__proto__") && !(ts.isStringLiteral(p.name) && p.name.text === "__proto__")) r = Math.max(r, 1 + shapeDepth(p.initializer, m, read, seen, depth + 1));
      else if (ts.isShorthandPropertyAssignment(p) && !p.objectAssignmentInitializer) r = Math.max(r, 1 + shapeDepth(p.name, m, read, seen, depth + 1));
      else return INF_DEPTH;
    }
    return r >= INF_DEPTH ? INF_DEPTH : r;
  }
  if (ts.isNewExpression(x) && ts.isIdentifier(x.expression) && (x.expression.text === "Map" || x.expression.text === "Set") && unshadowed(m.idx, x.expression.text)) {
    const a = x.arguments ?? [];
    if (a.length === 0) return x.expression.text === "Map" ? 2 : 1;
    if (a.length !== 1) return INF_DEPTH;
    const lit = unwrapExpr(a[0]!);
    if (!ts.isArrayLiteralExpression(lit)) return INF_DEPTH;
    // A Set of primitives (depth 1). A Map with primitive keys counts its entry pairs: iteration / spread yield
    // [k, v] pairs one step down and the values two steps down, so `get` is two steps too (MAP_GET_DEPTH); paths that
    // reach the values in fewer counted steps (values(), forEach, entries()) only undercount, which is stricter.
    let r = x.expression.text === "Map" ? 2 : 1;
    for (const el of lit.elements) {
      if (x.expression.text === "Set") { if (ts.isSpreadElement(el) || ts.isOmittedExpression(el) || shapeDepth(el, m, read, seen, depth + 1) !== 0) return INF_DEPTH; continue; }
      const pair = ts.isSpreadElement(el) || ts.isOmittedExpression(el) ? null : unwrapExpr(el);
      if (!pair || !ts.isArrayLiteralExpression(pair) || pair.elements.length !== 2 || pair.elements.some((y) => ts.isSpreadElement(y) || ts.isOmittedExpression(y)) || shapeDepth(pair.elements[0]!, m, read, seen, depth + 1) !== 0) return INF_DEPTH;
      r = Math.max(r, 2 + shapeDepth(pair.elements[1]!, m, read, seen, depth + 1));
    }
    return r >= INF_DEPTH ? INF_DEPTH : r;
  }
  // a call of a global that always returns a primitive (the binding then holds a primitive, nothing to share)
  if (ts.isCallExpression(x)) {
    const c = unwrapExpr(x.expression);
    const nm = ts.isIdentifier(c) ? c.text : ts.isPropertyAccessExpression(c) && ts.isIdentifier(c.expression) ? `${c.expression.text}.${c.name.text}` : null;
    if (nm && (PRIM_RETURN_GLOBALS.has(nm) || (nm.startsWith("Math.") && nm !== "Math.random")) && unshadowed(m.idx, nm.split(".")[0]!) && x.arguments.every((a) => inertPrimArg(a, m.idx, 0))) {
      // primitive only if the global is the real one: the repo scan checks no module shadows or patches it
      PRIM_GLOBAL_ROOTS?.add(nm.split(".")[0]!);
      return 0;
    }
  }
  if (ts.isCallExpression(x) && ts.isIdentifier(x.expression)) {
    const kind = calleeReturnKind(x.expression.text, m, read);
    return kind === "prim" ? 0 : kind === "array" ? 1 : INF_DEPTH;
  }
  return INF_DEPTH;
}
/** Global roots (`Date`, `Math`, ...) a binding's primitive shape relied on; collected by bindingShape. */
let PRIM_GLOBAL_ROOTS: Set<string> | null = null;
/** An inert primitive argument: a literal, a sign / arithmetic of inert ones, or a never-written module const of one. */
function inertPrimArg(e: ts.Expression, idx: ModuleIndex, depth: number): boolean {
  if (depth > 12) return false;
  const x = unwrapExpr(e);
  if (ts.isNumericLiteral(x) || ts.isStringLiteral(x) || ts.isNoSubstitutionTemplateLiteral(x) || x.kind === ts.SyntaxKind.TrueKeyword || x.kind === ts.SyntaxKind.FalseKeyword) return true;
  if (ts.isPrefixUnaryExpression(x)) return (x.operator === ts.SyntaxKind.MinusToken || x.operator === ts.SyntaxKind.PlusToken) && inertPrimArg(x.operand, idx, depth + 1);
  if (ts.isBinaryExpression(x)) {
    const k = x.operatorToken.kind;
    const arith = [ts.SyntaxKind.PlusToken, ts.SyntaxKind.MinusToken, ts.SyntaxKind.AsteriskToken, ts.SyntaxKind.SlashToken, ts.SyntaxKind.PercentToken, ts.SyntaxKind.AsteriskAsteriskToken];
    return arith.includes(k) && inertPrimArg(x.left, idx, depth + 1) && inertPrimArg(x.right, idx, depth + 1);
  }
  if (ts.isIdentifier(x)) {
    const d = idx.consts.get(x.text);
    return !!d?.initializer && !idx.mutated.has(x.text) && !idx.imports.has(x.text) && inertPrimArg(d.initializer, idx, depth + 1);
  }
  return false;
}
/** A regex literal or `new RegExp(..)` / `RegExp(..)` of the global (state flags g / y are statelessInit's). */
function regexInit(x: ts.Expression, idx: ModuleIndex): boolean {
  if (ts.isRegularExpressionLiteral(x)) return true;
  return (ts.isNewExpression(x) || ts.isCallExpression(x)) && ts.isIdentifier(x.expression) && x.expression.text === "RegExp" && unshadowed(idx, "RegExp");
}
/** The declared return kind of a plain-name callee (a same-module function declaration or a named relative import). */
function calleeReturnKind(name: string, m: { sf: ts.SourceFile; idx: ModuleIndex }, read: (rel: string) => string | null): "prim" | "array" | null {
  const local = m.idx.fns.get(name);
  if (local && !m.idx.consts.has(name) && !m.idx.imports.has(name) && !m.idx.mutable.has(name)) return local.length === 1 ? loadCallReturnKind(local[0]!.type, m.idx) : null;
  const imp = m.idx.imports.get(name);
  if (!imp || imp.typeOnly || !imp.imported || imp.imported === "default") return null;
  const hits = (siblingCandidates(m.sf.fileName, imp.spec) ?? []).filter((c) => read(c) !== null);
  if (hits.length !== 1) return null;
  const sf = ts.createSourceFile(hits[0]!, read(hits[0]!)!, ts.ScriptTarget.Latest, true);
  const idx = indexModule(sf);
  const d = idx.fns.get(imp.imported);
  return d && d.length === 1 && idx.exportNames.has(imp.imported) ? loadCallReturnKind(d[0]!.type, idx) : null;
}
function bindingShape(b: ReadBinding, read: (rel: string) => string | null): BindingShape {
  if (b.isEnum) return { kind: "data", primDepth: 1 };
  const init = b.idx.consts.get(b.name)?.initializer;
  if (!init) return { kind: "data", primDepth: INF_DEPTH };
  const x = unwrapExpr(init);
  if (ts.isArrowFunction(x) || ts.isFunctionExpression(x)) return { kind: "fn" };
  const roots = new Set<string>();
  PRIM_GLOBAL_ROOTS = roots;
  let d: number;
  try { d = shapeDepth(init, b, read, new Set([`${b.sf.fileName}\0${b.name}`])); } finally { PRIM_GLOBAL_ROOTS = null; }
  return d === 0 ? (roots.size ? { kind: "prim", globals: roots } : { kind: "prim" }) : { kind: "data", primDepth: d, regex: regexInit(x, b.idx) };
}

/** Enum names (module path \0 name) the analysis read, keyed by the analysis's shared reasons set. */
const ENUM_READS = new WeakMap<Set<string>, Set<string>>();
function noteEnumRead(a: Analysis, name: string): void {
  let s = ENUM_READS.get(a.reasons);
  if (!s) { s = new Set(); ENUM_READS.set(a.reasons, s); }
  s.add(`${a.sf.fileName}\0${name}`);
}
function readBindings(a: Analysis, v2: V2Ctx | undefined): ReadBinding[] {
  const out: ReadBinding[] = [];
  const seen = new Set<string>();
  const mods = new Map<string, { sf: ts.SourceFile; idx: ModuleIndex; consts: Set<string> }>([[a.sf.fileName, { sf: a.sf, idx: a.idx, consts: a.consts }]]);
  if (v2) for (const [p, m] of v2.modules) if (m) mods.set(p, { sf: m.sf, idx: m.idx, consts: m.consts });
  for (const [p, m] of mods) for (const n of m.consts) { const k = `${p}\0${n}`; if (!seen.has(k)) { seen.add(k); out.push({ path: p, name: n, sf: m.sf, idx: m.idx, isEnum: false }); } }
  for (const k of ENUM_READS.get(a.reasons) ?? []) {
    const [p, n] = k.split("\0") as [string, string];
    const m = mods.get(p);
    if (m && !seen.has(k)) { seen.add(k); out.push({ path: p, name: n, sf: m.sf, idx: m.idx, isEnum: true }); }
  }
  return out;
}

/**
 * The whole-repo verdict for the bindings the analysis read: null (every one passes) or the first problem
 * (`<binding>: <why> at <file>:<line>`). Without a repo list, any binding holding state fails closed.
 */
const GLOBAL_OBJECTS = new Set(["globalThis", "global", "window", "self"]);
/** The only members of a global object a repo may read when a prim-returning global's relaxation applies. */
const SAFE_GLOBAL_OBJECT_MEMBERS = new Set(["console", "crypto", "fetch", "performance", "process", "structuredClone", "queueMicrotask", "setTimeout", "clearTimeout", "setInterval", "clearInterval", "TextEncoder", "TextDecoder", "URL", "AbortController"]);
/** A write position (assignment / compound target, ++ / --, delete, destructuring or for-in/of target). */
/** Auditor #505 (1): does a function (its parameters and body, nested functions included) mention `arguments`? */
function mentionsArguments(f: ts.Node): boolean {
  let hit = false;
  const v = (n: ts.Node): void => { if (hit) return; if (ts.isIdentifier(n) && n.text === "arguments") { hit = true; return; } ts.forEachChild(n, v); };
  ts.forEachChild(f, v);
  return hit;
}
function isWriteTarget(n: ts.Node): boolean {
  let x: ts.Node = n;
  while (ts.isParenthesizedExpression(x.parent) || ts.isNonNullExpression(x.parent) || ts.isAsExpression(x.parent) || ts.isTypeAssertionExpression(x.parent) || ts.isSatisfiesExpression(x.parent)) x = x.parent;
  const p = x.parent;
  if (ts.isBinaryExpression(p) && p.left === x && p.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && p.operatorToken.kind <= ts.SyntaxKind.LastAssignment) return true;
  if ((ts.isPrefixUnaryExpression(p) || ts.isPostfixUnaryExpression(p)) && (p.operator === ts.SyntaxKind.PlusPlusToken || p.operator === ts.SyntaxKind.MinusMinusToken)) return true;
  if (ts.isDeleteExpression(p)) return true;
  if ((ts.isForInStatement(p) || ts.isForOfStatement(p)) && p.initializer === x) return true;
  if (ts.isArrayLiteralExpression(p) || ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p) || ts.isSpreadElement(p) || ts.isSpreadAssignment(p)) {
    let q: ts.Node = p;
    while (ts.isArrayLiteralExpression(q) || ts.isObjectLiteralExpression(q) || ts.isPropertyAssignment(q) || ts.isShorthandPropertyAssignment(q) || ts.isSpreadElement(q) || ts.isSpreadAssignment(q)) q = q.parent;
    return ts.isBinaryExpression(q) && q.operatorToken.kind === ts.SyntaxKind.EqualsToken && q.left.pos <= n.pos && n.end <= q.left.end;
  }
  return false;
}
/**
 * Whether any module of the repo shadows or patches the global `name` (Date, Math, ...): every occurrence must be a
 * member read (`Date.UTC(..)`, not a write of it), a call / `new` of it, a type, or another object's property name;
 * a declaration, import, parameter, assignment, value use (passed, stored, spread) or a `globalThis.Date`-style access
 * fails closed.
 */
function globalTouched(ri: RepoIndex, name: string): string | null {
  let found: string | null = null;
  const at = (n: ts.Node) => { const sf = n.getSourceFile(); return `${relOf(sf.fileName)}:${sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1}`; };
  for (const f of ri.files.values()) {
    const v = (n: ts.Node): void => {
      if (found) return;
      // Auditor #505 (3): any use of globalThis / global / window / self (an alias, an argument, a spread, a write,
      // `Object.defineProperty(globalThis, ..)`, an element access) fails closed; only a plain read of a known-safe
      // member (`globalThis.console.log(..)`) is allowed.
      if (ts.isIdentifier(n) && GLOBAL_OBJECTS.has(n.text) && !inTypePosition(n) && isGlobalId(n, ri.checker)) {
        const p = n.parent;
        const nameSlot = (ts.isPropertyAccessExpression(p) && p.name === n) || ((ts.isPropertyAssignment(p) || ts.isPropertyDeclaration(p) || ts.isPropertySignature(p) || ts.isMethodDeclaration(p) || ts.isMethodSignature(p) || ts.isGetAccessor(p) || ts.isSetAccessor(p) || ts.isEnumMember(p)) && p.name === n) || ts.isQualifiedName(p);
        const safeRead = ts.isPropertyAccessExpression(p) && p.expression === n && SAFE_GLOBAL_OBJECT_MEMBERS.has(p.name.text) && p.name.text !== name && !isWriteTarget(p);
        if (!nameSlot && !safeRead) { found = `global_${name}_via_global_object at ${at(n)}`; return; }
      }
      if (ts.isIdentifier(n) && n.text === name && !inTypePosition(n)) {
        const p = n.parent;
        const ok =
          (ts.isPropertyAccessExpression(p) && p.name === n) ||
          ((ts.isPropertyAccessExpression(p) || ts.isElementAccessExpression(p)) && p.expression === n && !isWriteTarget(p) && !(ts.isCallExpression(p.parent) && ts.isPropertyAccessExpression(p) && ["defineProperty", "assign"].includes(p.name.text))) ||
          ((ts.isCallExpression(p) || ts.isNewExpression(p)) && p.expression === n) ||
          ((ts.isPropertyAssignment(p) || ts.isPropertyDeclaration(p) || ts.isPropertySignature(p) || ts.isMethodDeclaration(p) || ts.isMethodSignature(p) || ts.isGetAccessor(p) || ts.isSetAccessor(p) || ts.isEnumMember(p)) && p.name === n) ||
          (ts.isQualifiedName(p));
        if (!ok) { found = `global_${name}_shadowed_or_patched at ${at(n)}`; return; }
      }
      ts.forEachChild(n, v);
    };
    v(f);
    if (found) return found;
  }
  return null;
}
function sharedBindingsProblem(bindings: readonly ReadBinding[], repo: readonly RepoFile[] | undefined, read: (rel: string) => string | null): string | null {
  const shaped = bindings.map((b) => ({ b, shape: bindingShape(b, read) }));
  const todo = shaped.filter((x) => x.shape.kind !== "prim");
  const viaGlobal = shaped.filter((x) => x.shape.kind === "prim" && x.shape.globals);
  if (!todo.length && !viaGlobal.length) return null;
  const first = todo[0] ?? viaGlobal[0]!;
  if (!repo) return `${first.b.path}#${first.b.name}: no_repo_list`;
  const ri = repoIndex(repo);
  if (ri.problem) return ri.problem === SHARED_TOO_LARGE ? SHARED_TOO_LARGE : `repo: ${ri.problem}`;
  for (const { b, shape } of viaGlobal) for (const g of (shape as { globals: Set<string> }).globals) {
    const r = globalTouched(ri, g);
    if (r) return `${b.path}#${b.name}: ${r}`;
  }
  for (const { b, shape } of todo) {
    const r = bindingProblem(ri, b, shape as Exclude<BindingShape, { kind: "prim" }>);
    if (r) return r === SHARED_TOO_LARGE ? r : `${b.path}#${b.name}: ${r}`;
  }
  return null;
}

function bindingProblem(ri: RepoIndex, b: ReadBinding, shape: { kind: "fn" } | { kind: "data"; primDepth: number; regex?: boolean }): string | null {
  const { checker } = ri;
  const sf = ri.files.get(SCAN_ROOT + b.path);
  if (!sf || sf.text !== b.sf.text) return "not_in_repo_list";
  const fnValue = shape.kind === "fn";
  const primDepth = shape.kind === "data" ? shape.primDepth : INF_DEPTH;
  let declName: ts.Identifier | undefined;
  for (const s of sf.statements) {
    if (b.isEnum && ts.isEnumDeclaration(s) && s.name.text === b.name) declName = s.name;
    if (!b.isEnum && ts.isVariableStatement(s)) for (const d of s.declarationList.declarations) if (ts.isIdentifier(d.name) && d.name.text === b.name) declName = d.name;
  }
  if (!declName) return "declaration_not_found";
  const norm = (s: ts.Symbol | undefined): ts.Symbol | undefined => {
    let x = s;
    for (let i = 0; x && x.flags & ts.SymbolFlags.Alias && i < 16; i++) { try { x = checker.getAliasedSymbol(x); } catch { return undefined; } }
    if (x && (x as unknown as { exportSymbol?: ts.Symbol }).exportSymbol) x = (x as unknown as { exportSymbol: ts.Symbol }).exportSymbol;
    return x;
  };
  const root = norm(checker.getSymbolAtLocation(declName));
  if (!root) return "symbol_not_found";
  /** alias symbol -> depth below the binding (the binding itself is 0). */
  const S = new Map<ts.Symbol, number>([[root, 0]]);
  /** aliases that only ever hold a FRESH container of the binding's parts (`[...L]`, `L.slice()`, `{ k: L }`): writing
   *  the container itself (push, `c[i] = v`, `c.k = v`) is no write to shared state; its elements are still shared. */
  const FR = new Map<ts.Symbol, boolean>([[root, false]]);
  let grew = false;
  let problem: string | null = null;
  const at = (n: ts.Node) => { const f = n.getSourceFile(); return `${relOf(f.fileName)}:${f.getLineAndCharacterOfPosition(n.getStart(f)).line + 1}`; };
  const fail = (why: string, n: ts.Node): string => { if (!problem) problem = `${why} at ${at(n)}`; return problem; };
  const addSym = (s: ts.Symbol | undefined, d: number, n: ts.Node, fresh = false): void => {
    const x = norm(s);
    if (!x) { fail("unresolved_alias", n); return; }
    const was = S.get(x);
    const nf = was === undefined ? fresh : FR.get(x)! && fresh;
    if (was === undefined || d < was || nf !== FR.get(x)) { S.set(x, was === undefined ? d : Math.min(d, was)); FR.set(x, nf); grew = true; }
    if (S.size > MAX_SCAN_ALIASES) problem = SHARED_TOO_LARGE;
  };
  const addPattern = (name: ts.BindingName, d: number, fresh = false): void => {
    if (ts.isIdentifier(name)) { addSym(checker.getSymbolAtLocation(name), d, name, fresh); return; }
    for (const el of name.elements) {
      if (ts.isOmittedExpression(el)) continue;
      addPattern(el.name, el.dotDotDotToken ? d : d + 1);
    }
  };
  const addAssignPattern = (e: ts.Expression, d: number): void => {
    const x = unwrapExpr(e);
    if (ts.isIdentifier(x)) { addSym(checker.getSymbolAtLocation(x), d, x); return; }
    if (ts.isBinaryExpression(x) && x.operatorToken.kind === ts.SyntaxKind.EqualsToken) { addAssignPattern(x.left, d); return; }
    if (ts.isArrayLiteralExpression(x)) { for (const el of x.elements) if (!ts.isOmittedExpression(el)) addAssignPattern(ts.isSpreadElement(el) ? el.expression : el, ts.isSpreadElement(el) ? d : d + 1); return; }
    if (ts.isObjectLiteralExpression(x)) {
      for (const p of x.properties) {
        if (ts.isPropertyAssignment(p)) addAssignPattern(p.initializer, d + 1);
        else if (ts.isShorthandPropertyAssignment(p)) addSym(checker.getShorthandAssignmentValueSymbol(p), d + 1, p);
        else if (ts.isSpreadAssignment(p)) addAssignPattern(p.expression, d);
        else fail("stored", p);
      }
      return;
    }
    fail("stored", x);
  };
  /** Is `x` (an element / property of an array / object literal, or that literal) the target of a destructuring write? */
  const destructuringTarget = (x: ts.Node): boolean => {
    let c: ts.Node = x;
    for (;;) {
      const q = c.parent;
      if (!q) return false;
      if (ts.isArrayLiteralExpression(q) || ts.isObjectLiteralExpression(q) || ts.isSpreadElement(q) || ts.isSpreadAssignment(q) || ts.isShorthandPropertyAssignment(q) || (ts.isPropertyAssignment(q) && q.initializer === c) || ts.isParenthesizedExpression(q) || (ts.isBinaryExpression(q) && q.operatorToken.kind === ts.SyntaxKind.EqualsToken && q.left === c && c !== x && (ts.isArrayLiteralExpression(q.parent) || ts.isObjectLiteralExpression(q.parent) || ts.isPropertyAssignment(q.parent)))) { c = q; continue; }
      if (c === x) return false;
      if (ts.isBinaryExpression(q) && q.operatorToken.kind === ts.SyntaxKind.EqualsToken && q.left === c) return true;
      if ((ts.isForOfStatement(q) || ts.isForInStatement(q)) && q.initializer === c) return true;
      return false;
    }
  };
  /** A callee that receives the value as argument `i` at depth `d` (or a callback argument of a read method). */
  const passTo = (call: ts.CallExpression | ts.NewExpression, callee: ts.Expression, i: number | null, d: number, n: ts.Node): string | null => {
    const g = globalCallee(callee, checker);
    if (g !== null) {
      if (fnValue) return /^(?:Object\.(?:assign|defineProperty|defineProperties|setPrototypeOf|freeze|seal|preventExtensions)|Reflect\..*)$/.test(g) ? fail("written_by_builtin", n) : null;
      if (d >= primDepth) return null;
      if (PRIM_GLOBAL_CALLS.has(g) || (/^Math\./.test(g))) return null;
      // Auditor #505 (2): `Array.of(x, ..)` is `[x, ..]`, a fresh container HOLDING each argument (one level up)
      if (ts.isCallExpression(call) && g === "Array.of" && i !== null) return use(call, d - 1, false, true);
      if (ts.isCallExpression(call) && CONTAINER_GLOBAL_CALLS.has(g) && i === 0) return use(call, d, false, true);
      if (ts.isCallExpression(call) && ENTRY_GLOBAL_CALLS.has(g) && i === 0) return use(call, d - 1, false, true);
      if (ts.isNewExpression(call) && CONTAINER_GLOBAL_NEW.has(g) && i === 0) return use(call, d - 1, false, true);
      return fail(/^(?:Object\.(?:assign|defineProperty|defineProperties|setPrototypeOf|freeze|seal|preventExtensions)|Reflect\.)/.test(g) ? "written_by_builtin" : `passed_to_${g}`, n);
    }
    if (fnValue) return null;
    if (d >= primDepth) return null;
    // a module regex (the binding itself) as the pattern of a String method on a receiver the checker types as a string
    if (shape.kind === "data" && shape.regex && d === 0 && i === 0 && ts.isCallExpression(call)) {
      const c = unwrapExpr(callee);
      if (ts.isPropertyAccessExpression(c) && STRING_REGEX_METHODS.has(c.name.text)) {
        const t = checker.getTypeAtLocation(c.expression);
        if (t.flags & ts.TypeFlags.StringLike) return null;
      }
    }
    const x = unwrapExpr(callee);
    const s = ts.isIdentifier(x) ? norm(checker.getSymbolAtLocation(x)) : undefined;
    const decl = s?.valueDeclaration;
    let f: ts.FunctionLikeDeclaration | undefined;
    if (decl && ts.isFunctionDeclaration(decl) && decl.body) f = decl;
    else if (decl && ts.isVariableDeclaration(decl) && decl.initializer && ts.isVariableDeclarationList(decl.parent) && decl.parent.flags & ts.NodeFlags.Const) { const init = unwrapExpr(decl.initializer); if (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) f = init; }
    if (!f || !ri.files.has(f.getSourceFile().fileName) || i === null || ts.isNewExpression(call)) return fail("passed_to_unanalysed_callee", n);
    const p = f.parameters[i];
    if (!p || p.dotDotDotToken || f.parameters.some((q) => q.dotDotDotToken)) return fail("passed_to_unanalysed_callee", n);
    // Auditor #505 (1): `arguments` reaches every argument past the parameter tracking (written, handed out)
    if (mentionsArguments(f)) return fail("arguments_in_callee", n);
    addPattern(p.name, d);
    return null;
  };
  const callbacks = (call: ts.CallExpression, m: string, recv: number): string | null => {
    const roles = CALLBACK_ROLES[m] ?? "eia";
    for (const arg of call.arguments) {
      const x = unwrapExpr(arg);
      if (ts.isArrowFunction(x) || ts.isFunctionExpression(x)) {
        if (mentionsArguments(x)) return fail("arguments_in_callee", x);
        x.parameters.forEach((p, k) => {
          const role = roles[k] ?? "a";
          if (p.dotDotDotToken) { addPattern(p.name, recv); return; }
          if (role === "i") return;
          const d = role === "e" ? recv + 1 : recv;
          if (d < primDepth) addPattern(p.name, d);
        });
        continue;
      }
      if (ts.isIdentifier(x) && GLOBAL_CALLBACKS.has(x.text) && isGlobalId(x, checker)) continue;
      if (ts.isIdentifier(x)) {
        const s = norm(checker.getSymbolAtLocation(x));
        const decl = s?.valueDeclaration;
        let f: ts.FunctionLikeDeclaration | undefined;
        if (decl && ts.isFunctionDeclaration(decl) && decl.body) f = decl;
        else if (decl && ts.isVariableDeclaration(decl) && decl.initializer && ts.isVariableDeclarationList(decl.parent) && decl.parent.flags & ts.NodeFlags.Const) { const init = unwrapExpr(decl.initializer); if (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) f = init; }
        if (f && ri.files.has(f.getSourceFile().fileName) && !S.has(s!)) {
          f.parameters.forEach((p, k) => {
            const role = roles[k] ?? "a";
            if (p.dotDotDotToken) { addPattern(p.name, recv); return; }
            if (role === "i") return;
            const d = role === "e" ? recv + 1 : recv;
            if (d < primDepth) addPattern(p.name, d);
          });
          continue;
        }
        if (S.has(s!)) continue; // the comparator / predicate is itself an alias value (checked where it is used)
      }
      if (shapeLiteralArg(x)) continue;
      return fail("callback_not_followed", arg);
    }
    return null;
  };
  /** Non-function arguments of a read method (`indexOf(x)`, `slice(0, 2)`, `join(",")`): not handed the receiver. */
  const shapeLiteralArg = (x: ts.Expression): boolean => !(ts.isArrowFunction(x) || ts.isFunctionExpression(x) || ts.isIdentifier(x) && !!norm(checker.getSymbolAtLocation(x))?.valueDeclaration && ts.isFunctionLike(norm(checker.getSymbolAtLocation(x))!.valueDeclaration!));
  /** One use of the binding (or an alias of it, or a container holding it) whose value sits `base` steps below the binding. */
  const use = (occ: ts.Expression, base: number, own: boolean, fresh0 = false): string | null => {
    let x: ts.Expression = occ;
    let d = base;
    let steps = 0;
    for (;;) {
      const p = x.parent;
      if ((ts.isParenthesizedExpression(p) || ts.isAsExpression(p) || ts.isSatisfiesExpression(p) || ts.isNonNullExpression(p) || ts.isTypeAssertionExpression(p)) && p.expression === x) { x = p; continue; }
      if ((ts.isPropertyAccessExpression(p) || ts.isElementAccessExpression(p)) && p.expression === x) { x = p; d += 1; steps += 1; continue; }
      break;
    }
    const p = x.parent;
    const fresh = fresh0 && steps === 0;
    // the alias variable itself (rebinding a local is no write to shared state), or one slot of a fresh container
    const local = (steps === 0 && !own) || (fresh0 && steps === 1);
    if (ts.isBinaryExpression(p) && p.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && p.operatorToken.kind <= ts.SyntaxKind.LastAssignment && p.left === x) return local ? null : fail("write", p);
    if ((ts.isPrefixUnaryExpression(p) || ts.isPostfixUnaryExpression(p)) && (p.operator === ts.SyntaxKind.PlusPlusToken || p.operator === ts.SyntaxKind.MinusMinusToken)) return local ? null : fail("write", p);
    if (ts.isDeleteExpression(p)) return local ? null : fail("write", p);
    if ((ts.isForOfStatement(p) || ts.isForInStatement(p)) && p.initializer === x) return local ? null : fail("write", p);
    if (destructuringTarget(x)) return local ? null : fail("write", x);
    if (fresh && !fnValue && d + 1 >= primDepth) return null; // a fresh container of primitives shares nothing
    if (ts.isCallExpression(p) && p.expression === x) {
      if (steps === 0) return null; // the value itself is called (a function value; its body is the purity analysis's)
      const recv = d - 1;
      if (recv >= primDepth) return null; // a method of a primitive
      const m = ts.isPropertyAccessExpression(x) ? x.name.text : ts.isElementAccessExpression(x) && ts.isStringLiteralLike(x.argumentExpression) ? x.argumentExpression.text : null;
      if (fnValue) return null;
      if (!m) return fail("computed_method", p);
      if (WRITE_METHODS.has(m) && !(fresh0 && steps === 1)) return fail(`mutator_${m}`, p);
      const isRead = WRITE_METHODS.has(m) || MAPPED_RESULT_METHODS.has(m) || PRIM_RESULT_METHODS.has(m) || ELEMENT_RESULT_METHODS.has(m) || CONTAINER_RESULT_METHODS.has(m) || ENTRY_RESULT_METHODS.has(m);
      if (!isRead) return fail(`unknown_method_${m}`, p);
      const cb = callbacks(p, m, recv);
      if (cb) return cb;
      if (PRIM_RESULT_METHODS.has(m) || MAPPED_RESULT_METHODS.has(m)) return null;
      if (WRITE_METHODS.has(m)) return m === "sort" || m === "reverse" || m === "fill" || m === "copyWithin" ? use(p, recv, false, true) : null; // a fresh container, mutated in place
      return use(p, m === "get" ? recv + MAP_GET_DEPTH : ELEMENT_RESULT_METHODS.has(m) ? recv + 1 : ENTRY_RESULT_METHODS.has(m) ? recv - 1 : recv, false, !ELEMENT_RESULT_METHODS.has(m));
    }
    if (ts.isNewExpression(p) && p.expression === x) return fnValue ? null : fail("constructed", p);
    if (ts.isVariableDeclaration(p) && p.initializer === x) { addPattern(p.name, d, fresh); return null; }
    if ((ts.isParameter(p) || ts.isBindingElement(p)) && p.initializer === x) { addPattern(p.name, d, fresh); return null; }
    if (fnValue) {
      if ((ts.isCallExpression(p) || ts.isNewExpression(p)) && p.arguments?.includes(x)) return passTo(p, p.expression, p.arguments.indexOf(x), d, x);
      if (ts.isBinaryExpression(p) && p.operatorToken.kind === ts.SyntaxKind.EqualsToken && p.right === x && ts.isIdentifier(unwrapExpr(p.left))) { addSym(checker.getSymbolAtLocation(unwrapExpr(p.left)), d, p); return null; }
      return null;
    }
    if (d >= primDepth) return null; // a primitive read
    if (ts.isBinaryExpression(p)) {
      const k = p.operatorToken.kind;
      if (p.right === x && (k === ts.SyntaxKind.EqualsToken || k === ts.SyntaxKind.QuestionQuestionEqualsToken || k === ts.SyntaxKind.BarBarEqualsToken || k === ts.SyntaxKind.AmpersandAmpersandEqualsToken)) {
        const l = unwrapExpr(p.left);
        if (ts.isIdentifier(l)) addSym(checker.getSymbolAtLocation(l), d, p, fresh);
        else if (ts.isArrayLiteralExpression(l) || ts.isObjectLiteralExpression(l)) addAssignPattern(l, d);
        else return fail("stored", p);
        return use(p, d, false, fresh);
      }
      if (k >= ts.SyntaxKind.FirstAssignment && k <= ts.SyntaxKind.LastAssignment) return null; // `s += x`: a primitive result
      if (k === ts.SyntaxKind.QuestionQuestionToken || k === ts.SyntaxKind.BarBarToken || k === ts.SyntaxKind.AmpersandAmpersandToken) return use(p, d, false);
      if (k === ts.SyntaxKind.CommaToken) return p.right === x ? use(p, d, false, fresh) : null;
      return null; // comparison, arithmetic, `in`, instanceof: a primitive result
    }
    if (ts.isReturnStatement(p) || (ts.isArrowFunction(p) && p.body === x) || ts.isYieldExpression(p)) return fail("returned", p);
    if (ts.isThrowStatement(p)) return fail("thrown", p);
    if (ts.isExportAssignment(p)) return fail("export_default", p);
    if (ts.isPropertyDeclaration(p)) return fail("stored", p);
    if ((ts.isCallExpression(p) || ts.isNewExpression(p)) && p.arguments?.includes(x)) return passTo(p, p.expression, p.arguments.indexOf(x), d, x);
    if (ts.isSpreadElement(p)) {
      const q = p.parent;
      if (ts.isArrayLiteralExpression(q)) return use(q, d, false, true);
      if ((ts.isCallExpression(q) || ts.isNewExpression(q)) && d + 1 >= primDepth) return null;
      if (ts.isCallExpression(q) || ts.isNewExpression(q)) { const g = globalCallee(q.expression, checker); return g && /^Math\./.test(g) ? null : fail("spread_into_call", p); }
      return fail(`unhandled_${ts.SyntaxKind[(q as ts.Node).kind]}`, p);
    }
    if (ts.isSpreadAssignment(p)) return use(p.parent, d, false, true);
    if (ts.isArrayLiteralExpression(p)) return use(p, d - 1, false, true);
    if (ts.isPropertyAssignment(p) && p.initializer === x) return use(p.parent, d - 1, false, true);
    if (ts.isShorthandPropertyAssignment(p)) return use(p.parent, d - 1, false, true);
    if (ts.isConditionalExpression(p)) return p.condition === x ? null : use(p, d, false);
    if (ts.isAwaitExpression(p)) return use(p, d, false, fresh);
    if (ts.isPrefixUnaryExpression(p) || ts.isTypeOfExpression(p) || ts.isVoidExpression(p)) return null;
    if (ts.isTemplateSpan(p)) return ts.isTaggedTemplateExpression(p.parent.parent) ? fail("tagged_template", p) : null;
    if (ts.isTaggedTemplateExpression(p)) return fail("tagged_template", p);
    if (ts.isElementAccessExpression(p) && p.argumentExpression === x) return null;
    if (ts.isForOfStatement(p) && p.expression === x) {
      const e = d + 1;
      if (e >= primDepth) return null;
      const init = p.initializer;
      if (ts.isVariableDeclarationList(init)) { for (const dd of init.declarations) addPattern(dd.name, e); return null; }
      const l = unwrapExpr(init);
      if (ts.isIdentifier(l)) { addSym(checker.getSymbolAtLocation(l), e, l); return null; }
      if (ts.isArrayLiteralExpression(l) || ts.isObjectLiteralExpression(l)) { addAssignPattern(l, e); return null; }
      return fail("stored", p);
    }
    if (ts.isForInStatement(p) && p.expression === x) return null;
    if ((ts.isIfStatement(p) || ts.isWhileStatement(p) || ts.isDoStatement(p) || ts.isSwitchStatement(p) || ts.isCaseClause(p)) && p.expression === x) return null;
    if (ts.isExpressionStatement(p)) return null;
    return fail(`unhandled_${ts.SyntaxKind[p.kind]}`, x);
  };
  // Fixpoint: walk every module until no new alias appears.
  const done = new Set<ts.Node>();
  for (let round = 0; ; round++) {
    if (round >= MAX_SCAN_ROUNDS) return SHARED_TOO_LARGE;
    grew = false;
    const names = new Set<string>();
    for (const s of S.keys()) names.add(s.name);
    const declFiles = new Set<string>();
    for (const s of S.keys()) for (const d of s.declarations ?? []) declFiles.add(d.getSourceFile().fileName);
    // files that export a tracked symbol (only those leak it through `export *` / `export * as`); a file with no
    // module symbol is counted as exporting (fail closed)
    const exportFiles = new Set<string>();
    // `export *` of a file leaks a tracked symbol if that file, or any file its own `export *` / `export {..} from`
    // chain reaches (cycles included), exports one; an unresolvable relative specifier in the chain fails closed
    const starMemo = new Map<string, true | string | null>();
    const starLeaks = (start: string): true | string | null => {
      const hit = starMemo.get(start);
      if (hit !== undefined) return hit;
      const seenF = new Set<string>([start]);
      const queue = [start];
      let res: true | string | null = null;
      while (queue.length && !res) {
        const fn = queue.shift()!;
        if (exportFiles.has(fn)) { res = true; break; }
        const sfx = ri.files.get(fn);
        if (!sfx) { res = "unresolved"; break; }
        const ms = checker.getSymbolAtLocation(sfx);
        if (!ms) { if (sfx.statements.some((x) => ts.isExportDeclaration(x) || ts.isExportAssignment(x) || hasMod(x, ts.SyntaxKind.ExportKeyword))) { res = "unresolved"; break; } continue; }
        if (checker.getExportsOfModule(ms).some((e) => { const t = norm(e); return !!t && S.has(t); })) { res = true; break; }
        for (const x of sfx.statements) {
          if (!ts.isExportDeclaration(x) || !x.moduleSpecifier) continue;
          if (!ts.isStringLiteralLike(x.moduleSpecifier)) { res = "unresolved"; break; }
          const t = ri.resolve(x.moduleSpecifier.text, fn);
          if (!t) { if (/^[./]/.test(x.moduleSpecifier.text)) { res = "unresolved"; break; } continue; }
          if (!seenF.has(t)) { seenF.add(t); queue.push(t); }
        }
      }
      starMemo.set(start, res);
      return res;
    };
    for (const s of S.keys()) for (const d of s.declarations ?? []) {
      const sf = d.getSourceFile();
      const ms = checker.getSymbolAtLocation(sf);
      if (!ms || checker.getExportsOfModule(ms).some((e) => norm(e) === s)) exportFiles.add(sf.fileName);
    }
    for (const f of ri.files.values()) {
      const nsNames = new Set<string>();
      const local = new Set(names);
      for (const st of f.statements) {
        if (ts.isImportDeclaration(st) && ts.isStringLiteralLike(st.moduleSpecifier)) {
          const target = ri.resolve(st.moduleSpecifier.text, f.fileName);
          const nb = st.importClause?.namedBindings;
          if (nb && ts.isNamedImports(nb)) for (const el of nb.elements) if (names.has((el.propertyName ?? el.name).text)) local.add(el.name.text);
          if (st.importClause?.name) local.add(st.importClause.name.text);
          if (nb && ts.isNamespaceImport(nb) && target && declFiles.has(target) && !st.importClause?.isTypeOnly) nsNames.add(nb.name.text);
        }
        if (ts.isExportDeclaration(st) && st.moduleSpecifier && ts.isStringLiteralLike(st.moduleSpecifier) && !st.isTypeOnly) {
          const target = ri.resolve(st.moduleSpecifier.text, f.fileName);
          if (!st.exportClause || ts.isNamespaceExport(st.exportClause)) {
            if (!target) { if (/^[./]/.test(st.moduleSpecifier.text)) return `reexport_unresolved at ${at(st)}`; }
            else { const leak = starLeaks(target); if (leak) return `reexport_star${leak === true ? "" : `_${leak}`} at ${at(st)}`; }
          }
        }
      }
      const v = (n: ts.Node): void => {
        if (problem) return;
        if (ts.isCallExpression(n) && n.arguments.length === 1 && ts.isStringLiteralLike(n.arguments[0]!) && (n.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(n.expression) && n.expression.text === "require" && isGlobalId(n.expression, checker)))) {
          const target = ri.resolve((n.arguments[0] as ts.StringLiteralLike).text, f.fileName);
          if (target && declFiles.has(target)) {
            // `const { A, B: C } = await import("./m")` (or `= require("./m")`) is a named import; any other use of the
            // module object (kept, passed, member-read, rest) fails closed.
            const pat = destructuredImport(n);
            if (!pat) { fail("dynamic_import_of_module", n); return; }
            for (const el of pat.elements) {
              const exported = ((el.propertyName ?? el.name) as ts.Identifier).text;
              for (const [s, d] of [...S]) if (s.name === exported && s.declarations?.some((x) => x.getSourceFile().fileName === target)) addSym(checker.getSymbolAtLocation(el.name), d, el.name);
              if (problem) return;
            }
          }
        }
        if (ts.isIdentifier(n) && (local.has(n.text) || nsNames.has(n.text)) && !done.has(n) && !inTypePosition(n)) {
          const p = n.parent;
          if (ts.isImportSpecifier(p) || ts.isImportClause(p) || ts.isNamespaceImport(p) || ((ts.isEnumDeclaration(p) || ts.isVariableDeclaration(p) || ts.isFunctionDeclaration(p) || ts.isClassDeclaration(p)) && p.name === n)) { /* declarations */ }
          else if (ts.isExportSpecifier(p)) {
            const decl = p.parent.parent;
            const s = decl.moduleSpecifier ? norm(checker.getSymbolAtLocation(p.propertyName ?? p.name)) : norm(checker.getExportSpecifierLocalTargetSymbol(p));
            if (s && S.has(s) && !decl.isTypeOnly && !p.isTypeOnly && (decl.moduleSpecifier || p.propertyName || S.get(s) !== 0 || s !== root)) { done.add(n); fail(decl.moduleSpecifier ? "reexport" : "export_alias", p); return; }
          } else if (nsNames.has(n.text) && isValueReference(n)) {
            const s = checker.getSymbolAtLocation(n);
            if (s && s.flags & ts.SymbolFlags.Alias && s.declarations?.some(ts.isNamespaceImport)) {
              done.add(n);
              if (!(ts.isPropertyAccessExpression(p) && p.expression === n)) { fail("namespace_escape", n); return; }
            }
          } else if (ts.isPropertyAccessExpression(p) && p.name === n) {
            const s = norm(checker.getSymbolAtLocation(n));
            if (s && S.has(s)) { done.add(n); use(p, S.get(s)!, s === root); }
          } else if (ts.isShorthandPropertyAssignment(p) && p.name === n) {
            const s = norm(checker.getShorthandAssignmentValueSymbol(p));
            if (s && S.has(s)) { done.add(n); use(n, S.get(s)!, s === root, FR.get(s)); }
          } else if (isValueReference(n)) {
            const s = norm(checker.getSymbolAtLocation(n));
            if (s && S.has(s)) { done.add(n); use(n, S.get(s)!, s === root, FR.get(s)); }
          }
        }
        ts.forEachChild(n, v);
      };
      v(f);
      if (problem) return problem;
    }
    if (!grew) return null;
    // a deeper-than-before alias (smaller depth) must be re-checked everywhere it is used
    done.clear();
  }
}

/** The plain object pattern a literal dynamic import / require is destructured into (no rest, no computed or nested names). */
function destructuredImport(call: ts.CallExpression): ts.ObjectBindingPattern | null {
  let e: ts.Node = call;
  while (ts.isParenthesizedExpression(e.parent)) e = e.parent;
  if (call.expression.kind === ts.SyntaxKind.ImportKeyword) {
    if (!ts.isAwaitExpression(e.parent)) return null;
    e = e.parent;
    while (ts.isParenthesizedExpression(e.parent)) e = e.parent;
  }
  const d = e.parent;
  if (!ts.isVariableDeclaration(d) || d.initializer !== e || !ts.isObjectBindingPattern(d.name)) return null;
  // plain names only: no rest, no computed / string keys, no nested pattern, a default only a primitive literal (a
  // default runs code when the export is undefined); the module object is the initializer itself, kept nowhere else
  const lit = (x: ts.Expression): boolean => { const y = unwrapExpr(x); return ts.isStringLiteralLike(y) || ts.isNumericLiteral(y) || y.kind === ts.SyntaxKind.TrueKeyword || y.kind === ts.SyntaxKind.FalseKeyword || y.kind === ts.SyntaxKind.NullKeyword || (ts.isPrefixUnaryExpression(y) && y.operator === ts.SyntaxKind.MinusToken && ts.isNumericLiteral(y.operand)); };
  const ok = d.name.elements.every((el) => !el.dotDotDotToken && ts.isIdentifier(el.name) && (!el.propertyName || ts.isIdentifier(el.propertyName)) && (!el.initializer || lit(el.initializer)));
  return ok ? d.name : null;
}

export interface TargetInfo { decl: ts.FunctionDeclaration; params: { name: string; type: string }[]; ret: string }

/**
 * The named refusal for testing `fn` in module `content` (path `path`), or null when it is an exported, fully
 * typed, provably pure function. Exported for Job B (re-checked on the real tree before grading) and the tests.
 */
type TargetOpts = { v2?: { read: (rel: string) => string | null }; load?: { read: (rel: string) => string | null }; dates?: boolean; v4?: boolean; v5?: boolean; v6?: boolean; v7?: boolean; /** Auditor (c): every file of the target repo (test files included) for the shared-binding scan; without it any read binding holding state is refused. */ repo?: readonly RepoFile[]; /** set to the first shared-binding scan problem (diagnostics only) */ why?: { shared?: string } };
export function existingTargetRefusal(path: string, content: string, fn: string, opts?: TargetOpts): string | null {
  return targetRefusal(path, content, fn, opts, false);
}
/** EVIDENCE REPLAY ONLY - never a gate. The same analysis as existingTargetRefusal without the closure-wide fail-closed
 *  load allowlist (Auditor #466, 3rd review): the pinned public examples blob-pin only the target module and the
 *  siblings the analysis follows, not every module their load closure reaches, so the evidence tests replay the
 *  per-function analysis with this and report the full-engine count separately. Job A and Job B call
 *  existingTargetRefusal only (asserted by the wiring tests). */
export function existingTargetAnalysisForEvidence(path: string, content: string, fn: string, opts?: TargetOpts): string | null {
  return targetRefusal(path, content, fn, opts, true);
}
/** Some other module the v2+ analysis read imports `fn` (or the whole module) from a specifier naming the target module. */
function dateImportedBack(v2: V2Ctx, path: string, fn: string): boolean {
  const stem = (s: string) => (s.split("/").pop() ?? "").replace(/\.(?:[cm]?[jt]s|tsx)$/, "");
  const want = stem(path);
  for (const [p, m] of v2.modules) {
    if (!m || p === path) continue;
    for (const st of m.sf.statements) {
      if (!ts.isImportDeclaration(st) && !ts.isExportDeclaration(st)) continue;
      const spec = st.moduleSpecifier;
      if (!spec || !ts.isStringLiteral(spec) || stem(spec.text) !== want) continue;
      if (ts.isExportDeclaration(st)) return true;
      const b = st.importClause?.namedBindings;
      if (!b || ts.isNamespaceImport(b) || st.importClause?.name) return true;
      if (b.elements.some((e) => (e.propertyName ?? e.name).text === fn)) return true;
    }
  }
  return false;
}
function targetRefusal(path: string, content: string, fn: string, opts: TargetOpts | undefined, skipLoad: boolean, inner?: CalleeMode): string | null {
  if (!plainPath(path)) return "path_not_plain";
  if (isProtected(path) || /\.test\.ts$/.test(path) || /\.d\.ts$/.test(path)) return SELF_PROTECTED_PATH;
  // M97: v7 takes every target v6 takes, unchanged (Job A then answers not_needed). Only a target v6 refuses is
  // analyzed with the v7 widenings and the v7 hardening, so v7 never loses a v6 target and never weakens one.
  if (opts?.v7 && opts.v2) {
    const r6 = targetRefusal(path, content, fn, { v2: opts.v2, v6: true, repo: opts.repo, why: opts.why }, skipLoad, inner);
    if (r6 === null) return null;
  } else if (opts?.v7) return targetRefusal(path, content, fn, { ...opts, v7: false }, skipLoad, inner);
  const sf = ts.createSourceFile(path, content, ts.ScriptTarget.Latest, true);
  if ((sf as unknown as { parseDiagnostics: unknown[] }).parseDiagnostics.length) return "edit_refused";
  const idx = indexModule(sf);
  const decls = idx.fns.get(fn) ?? [];
  if (decls.length === 0) return idx.consts.has(fn) || idx.mutable.has(fn) ? TEST_TARGET_SIGNATURE : TEST_TARGET_NOT_FOUND;
  if (decls.length !== 1 || !decls[0]!.body) return TEST_TARGET_SIGNATURE; // overloads
  const f = decls[0]!;
  if (!inner && !idx.exportNames.has(fn)) return TEST_TARGET_NOT_EXPORTED;
  if (hasMod(f, ts.SyntaxKind.AsyncKeyword) || f.asteriskToken) return TEST_TARGET_ASYNC;
  const ret = f.type?.getText(sf).trim() ?? "";
  if (/\b(?:Promise|PromiseLike|AsyncIterable|AsyncIterableIterator|AsyncGenerator)\b/.test(ret)) return TEST_TARGET_ASYNC;
  const reasons = new Set<string>();
  const v2: V2Ctx | undefined = opts?.v2 ? { path, root: path, depth: 0, read: (rel) => (rel === path ? content : opts.v2!.read(rel)), modules: new Map(), followed: new Set(), reasons, scanned: new Set(), dates: opts.dates === true || opts.v4 === true || opts.v5 === true || opts.v6 === true || opts.v7 === true, v4: opts.v4 === true || opts.v5 === true || opts.v6 === true || opts.v7 === true, v5: opts.v5 === true || opts.v6 === true || opts.v7 === true, v6: opts.v6 === true || opts.v7 === true, v7: opts.v7 === true } : undefined;
  if (v2) v2.modules.set(path, { idx, sf, fns: new Set([fn]), consts: new Set() });
  const typeOk = (t: ts.TypeNode | undefined) => !!t && (v2 ? structuralType(t, idx, sf, v2) : TYPES.test(t.getText(sf).trim()));
  // M91: `typeof p` naming one of the function's own parameters is that parameter's type, not a module const: refused.
  const paramNames = new Set(f.parameters.flatMap((p) => (ts.isIdentifier(p.name) ? [p.name.text] : [])));
  let paramTypeof = false;
  const seeTypeof = (n: ts.Node): void => { if (ts.isTypeQueryNode(n) && ts.isIdentifier(n.exprName) && paramNames.has(n.exprName.text)) paramTypeof = true; ts.forEachChild(n, seeTypeof); };
  for (const p of f.parameters) if (p.type) seeTypeof(p.type);
  if (f.type) seeTypeof(f.type);
  // M93 (v6 only): a parameter whose whole type is `unknown` or `NodeJS.ProcessEnv`; a `= process.env` default only on
  // a NodeJS.ProcessEnv parameter (its default is then skipped by the purity walk; every check must override it).
  const v6Param = (p: ts.ParameterDeclaration): boolean => !!v2?.v6 && !!p.type && (p.type.kind === ts.SyntaxKind.UnknownKeyword || processEnvType(p.type, idx));
  const envDefaults = new Set(v2?.v6 ? f.parameters.filter((p) => processEnvType(p.type, idx) && processEnvDefault(p.initializer, idx)) : []);
  // M97 (v7 only): a `void` return (never `undefined`, `never` or an `asserts` predicate); checks are then held to
  // `throws` / `is undefined` with at least one `throws` (voidTarget, Job A; voidTestProblem, Job B).
  const voidRet = !!v2?.v7 && f.type?.kind === ts.SyntaxKind.VoidKeyword;
  const sigBad = paramTypeof || !!f.typeParameters?.length || !(voidRet || typeOk(f.type)) || f.parameters.length > MAX_PARAMS || f.parameters.some((p) => !ts.isIdentifier(p.name) || p.dotDotDotToken || (!v2?.v4 && (p.questionToken || p.initializer)) || (p.questionToken && p.initializer) || (p.type ? !(v6Param(p) || typeOk(p.type)) : !(v2?.v4 && literalDefault(p.initializer))));
  if (sigBad) {
    if (v2) for (const r of PRIORITY) if (v2.reasons.has(r)) return r;
    return TEST_TARGET_SIGNATURE;
  }
  // Auditor #466 (4th pass): a load-time callee must return a primitive or an array of primitives (LOAD_CALL_RETURN).
  const retKind = inner ? loadCallReturnKind(f.type, idx) : null;
  if (inner && !retKind) return TEST_TARGET_IMPURE;
  // Auditor (c): the whole-repo shared-binding scan runs on every gate call (Job A, Job B, callee checks of a gate
  // call), never in evidence replay.
  const evidence = inner ? !!inner.evidence : skipLoad;
  const lc = inner?.lc ?? makeLoadCallCheck(path, content, opts, evidence);
  if (v2) v2.lc = lc;
  const cached = v2?.modules.get(path);
  const a: Analysis = { reasons: v2 ? v2.reasons : reasons, fns: cached ? cached.fns : new Set([fn]), consts: cached ? cached.consts : new Set(), idx, sf, v2, lc, callee: !!inner };
  if (v2) analyzeLoadedModule(v2, idx, sf);
  else analyzeLoadTime(a, sf);
  analyzeFunction(a, f, envDefaults, true);
  // Auditor #466: a fresh-by-name result used for a write, with a member of that name defined anywhere in a module
  // the analysis read (or one the walk cannot name), is refused.
  const members = new Set<string>();
  readModuleMembers(path, sf, v2, members);
  for (const m of members) a.reasons.add(USER_MEMBER + m);
  if (freshByNameConflict(a.reasons)) a.reasons.add(TEST_TARGET_IMPURE);
  // Auditor #466 (3rd review): the fail-closed load-time allowlist over the target's load closure (every version).
  // v1 reads no sibling for its analysis; `load` (Job A / Job B pass the tree) lets the load check see what v1's
  // target module imports. Without it a relative or package value import is code the check cannot see (refused).
  const lp = skipLoad ? null : loadAllowlistProblem(path, sf, idx, v2 ? v2.read : opts?.load ? (rel) => (rel === path ? content : opts.load!.read(rel)) : null, undefined, lc);
  if (lp) a.reasons.add(lp.reason);
  // Auditor #466 (4th review): a tested function that returns a Date hands it only to the test - never to another
  // module the analysis read (one importing it back, by name or as a namespace).
  if (!inner && v2 && (teReturnsDate(teDateIdx(sf), f) || teDateIdx(sf).containerReturn.has(f) || teParamFeedsDate(teDateIdx(sf), f)) && dateImportedBack(v2, path, fn)) a.reasons.add(TEST_TARGET_DATE_LOCAL);
  // Auditor (c): no module of the repo may write, hand out or pass on a binding the analysis read (sharedBindingsProblem).
  // (Skipped once a reason refuses; with `opts.why` it still runs for the diagnostic, without changing the verdict.)
  const refusedAlready = PRIORITY.some((r) => a.reasons.has(r));
  if (!evidence && (!refusedAlready || opts?.why)) {
    const rd = v2 ? v2.read : opts?.load ? (rel: string) => (rel === path ? content : opts.load!.read(rel)) : (rel: string) => (rel === path ? content : null);
    const sp = sharedBindingsProblem(readBindings(a, v2), opts?.repo, rd);
    if (sp) {
      if (!refusedAlready) a.reasons.add(sp === SHARED_TOO_LARGE ? TEST_TARGET_TOO_LARGE : TEST_TARGET_IMPURE);
      if (opts?.why && opts.why.shared === undefined) opts.why.shared = sp;
    }
  }
  for (const r of PRIORITY) if (a.reasons.has(r)) return r;
  // M93 (Auditor #460): with an exempted `= process.env` default, only the test may call the target.
  if (envDefaults.size && v2 && envTargetReferenced(v2, fn, f, f.parameters.flatMap((p, i) => (envDefaults.has(p) ? [i] : [])))) return TEST_TARGET_IO;
  // M97 (v7 hardening, targets v6 refuses only): no module container the analysis reads may escape, and the relative
  // import closure must be code the walk can see, never import the target module back, never patch a global.
  if (v2?.v7) {
    if (containerEscapes(v2)) return TEST_TARGET_IMPURE;
    const c = v7ClosureProblem(v2);
    if (c) return c;
  }
  if (inner) {
    // recursion-safe: a load-time callee whose reached functions reference one another in a cycle is refused
    if (reachedCycle(a, v2)) return TEST_TARGET_IMPURE;
    inner.verdict = { kind: retKind!, aliasFree: readsOnlyInertConsts(a, v2) };
  }
  return null;
}

/**
 * Auditor #466 (4th pass): the LOAD-TIME CALL allowance, every version. The fail-closed load allowlist refuses any
 * call of user code at import. This is the one narrow exception: a top-level `const X = g(args)` (or a top-level
 * statement `g(args);`) where
 * - `g` is a plain name for a function DECLARATION of the same module, or a named import of an exported function
 *   declaration from a relative `.ts` module of the closure (never an alias, a member, `.call`, a default or namespace
 *   import, a dynamic callee) whose own import closure never reaches the calling module back (no cycle, no TDZ order);
 * - every argument is a primitive constant (primInert: literals, inert module consts, enum members), no spread, and
 *   every omitted parameter is optional or has a primitive-constant default (so an `= process.env` default never fires);
 * - `g` itself passes the FULL target purity analysis of the same version as the target (targetRefusal in callee mode,
 *   export not required): no module-state reads beyond inert consts, no env / IO / clock / random, no global patching,
 *   no RegExp statics, no Date setters, recursion through the same walk, and its declared return type is a primitive
 *   (string / number / boolean / bigint / literal, unions of these) or an array of primitives (T[], readonly T[],
 *   Array<T>, ReadonlyArray<T>); RegExp, iterators, generators, Map / Set, Date, objects, void: refused;
 * - an ARRAY result additionally needs (a) a callee whose analysis read no module const other than primitive constants
 *   and function values (so the result cannot alias module state), and (b) a binding that is not exported, never
 *   written and only read in place in its module (length, element reads, non-mutating methods, callbacks that cannot
 *   reach the array, spread into an array literal, for-of): never handed out, so nothing can mutate it.
 * A callee check that re-enters itself or nests deeper than MAX_LOAD_CALL_DEPTH is refused.
 */
interface LoadCallVerdict { kind: "prim" | "array"; aliasFree: boolean }
type LoadCallCheck = (path: string, fn: string) => LoadCallVerdict | null;
interface CalleeMode { lc: LoadCallCheck; verdict?: LoadCallVerdict; /** the root call is evidence replay (no shared-binding scan) */ evidence?: boolean }
const MAX_LOAD_CALL_DEPTH = 4;
function makeLoadCallCheck(rootPath: string, rootContent: string, opts: TargetOpts | undefined, evidence = false): LoadCallCheck {
  const rd = opts?.v2?.read ?? opts?.load?.read ?? null;
  const readAny = (rel: string): string | null => (rel === rootPath ? rootContent : rd ? rd(rel) : null);
  const stack = new Set<string>();
  const check: LoadCallCheck = (p, name) => {
    const key = `${p}\0${name}`;
    if (stack.has(key) || stack.size >= MAX_LOAD_CALL_DEPTH) return null;
    const text = readAny(p);
    if (text === null) return null;
    stack.add(key);
    try {
      const mode: CalleeMode = { lc: check, evidence };
      return targetRefusal(p, text, name, opts, true, mode) === null && mode.verdict ? mode.verdict : null;
    } finally { stack.delete(key); }
  };
  return check;
}
function primTypeNode(t: ts.TypeNode): boolean {
  if (ts.isParenthesizedTypeNode(t)) return primTypeNode(t.type);
  if (ts.isUnionTypeNode(t)) return t.types.every(primTypeNode);
  if (ts.isLiteralTypeNode(t)) return true;
  return [ts.SyntaxKind.StringKeyword, ts.SyntaxKind.NumberKeyword, ts.SyntaxKind.BooleanKeyword, ts.SyntaxKind.BigIntKeyword].includes(t.kind);
}
function loadCallReturnKind(t: ts.TypeNode | undefined, idx: ModuleIndex): "prim" | "array" | null {
  if (!t) return null;
  if (primTypeNode(t)) return "prim";
  let x = t;
  if (ts.isTypeOperatorNode(x) && x.operator === ts.SyntaxKind.ReadonlyKeyword) x = x.type;
  if (ts.isArrayTypeNode(x)) return primTypeNode(x.elementType) ? "array" : null;
  if (ts.isTypeReferenceNode(x) && ts.isIdentifier(x.typeName) && (x.typeName.text === "Array" || x.typeName.text === "ReadonlyArray") && unshadowed(idx, x.typeName.text) && x.typeArguments?.length === 1) return primTypeNode(x.typeArguments[0]!) ? "array" : null;
  return null;
}
/** Every module const the callee's analysis read is a primitive constant or a function value (no shared object). */
function readsOnlyInertConsts(a: Analysis, v2: V2Ctx | undefined): boolean {
  const mods: { idx: ModuleIndex; sf: ts.SourceFile; consts: Set<string>; path: string }[] = [{ idx: a.idx, sf: a.sf, consts: a.consts, path: a.sf.fileName }];
  if (v2) for (const [p, m] of v2.modules) if (m) mods.push({ idx: m.idx, sf: m.sf, consts: m.consts, path: p });
  for (const m of mods) for (const n of m.consts) {
    const init = m.idx.consts.get(n)?.initializer;
    const x = init && unwrapExpr(init);
    if (!x) return false;
    if (ts.isArrowFunction(x) || ts.isFunctionExpression(x)) continue;
    if (!primInert(x, { idx: m.idx, sf: m.sf, seen: new Set(), path: m.path })) return false;
  }
  return true;
}
/** A cycle among the functions the analysis reached (any value reference, same module or a named relative import). */
function reachedCycle(a: Analysis, v2: V2Ctx | undefined): boolean {
  const mods = new Map<string, { idx: ModuleIndex; fns: Set<string> }>([[a.sf.fileName, { idx: a.idx, fns: a.fns }]]);
  if (v2) for (const [p, m] of v2.modules) if (m) mods.set(p, { idx: m.idx, fns: m.fns });
  const edges = new Map<string, Set<string>>();
  for (const [p, m] of mods) for (const name of m.fns) {
    const out = new Set<string>();
    for (const d of m.idx.fns.get(name) ?? []) {
      const v = (n: ts.Node): void => {
        if (ts.isIdentifier(n) && isValueReference(n)) {
          if (m.idx.fns.has(n.text) && m.fns.has(n.text)) out.add(`${p}\0${n.text}`);
          const imp = m.idx.imports.get(n.text);
          if (imp && !imp.typeOnly && imp.imported && v2) for (const t of (siblingCandidates(p, imp.spec) ?? []).filter((x) => mods.has(x))) out.add(`${t}\0${imp.imported}`);
        }
        ts.forEachChild(n, v);
      };
      if (d.body) v(d.body);
      for (const q of d.parameters) if (q.initializer) v(q.initializer);
    }
    edges.set(`${p}\0${name}`, out);
  }
  const state = new Map<string, number>();
  const dfs = (k: string): boolean => {
    const st = state.get(k);
    if (st === 1) return true;
    if (st === 2) return false;
    state.set(k, 1);
    for (const n of edges.get(k) ?? []) if (dfs(n)) return true;
    state.set(k, 2);
    return false;
  };
  for (const k of edges.keys()) if (dfs(k)) return true;
  return false;
}
const ARRAY_READ = new Set(["indexOf", "lastIndexOf", "includes", "at", "slice", "join", "concat"]);
const ARRAY_CALLBACK = new Set(["map", "filter", "some", "every", "find", "findIndex", "findLast", "findLastIndex", "forEach", "reduce"]);
/** An array binding (module `c`) that is not exported, never written and only read in place (see loadCallInert). */
function localArrayReadOnly(c: LoadCtx, name: string): boolean {
  if (c.idx.mutated.has(name) || c.idx.exportNames.has(name)) return false;
  let ok = true;
  const v = (n: ts.Node): void => {
    if (!ok) return;
    if (ts.isExportSpecifier(n) && (n.propertyName ?? n.name).text === name) { ok = false; return; }
    if (ts.isShorthandPropertyAssignment(n) && n.name.text === name) { ok = false; return; }
    if (ts.isIdentifier(n) && n.text === name && isValueReference(n) && !(ts.isVariableDeclaration(n.parent) && n.parent.name === n)) {
      let top: ts.Node = n;
      while ((ts.isNonNullExpression(top.parent) || ts.isParenthesizedExpression(top.parent) || ts.isAsExpression(top.parent) || ts.isSatisfiesExpression(top.parent)) && top.parent.expression === top) top = top.parent;
      const q = top.parent;
      const writeTarget = (e: ts.Node): boolean => {
        const pp = e.parent;
        return (ts.isBinaryExpression(pp) && pp.left === e && pp.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && pp.operatorToken.kind <= ts.SyntaxKind.LastAssignment)
          || ((ts.isPrefixUnaryExpression(pp) || ts.isPostfixUnaryExpression(pp)) && (pp.operator === ts.SyntaxKind.PlusPlusToken || pp.operator === ts.SyntaxKind.MinusMinusToken))
          || ts.isDeleteExpression(pp);
      };
      const cbOk = (call: ts.CallExpression, m: string): boolean => {
        if (call.arguments.length !== 1 && !(m === "reduce" && call.arguments.length === 2)) return false;
        const cb = unwrapExpr(call.arguments[0]!);
        return (ts.isArrowFunction(cb) || ts.isFunctionExpression(cb)) && cb.parameters.length <= (m === "reduce" ? 3 : 2) && cb.parameters.every((p) => !p.dotDotDotToken);
      };
      let read = false;
      if (ts.isPropertyAccessExpression(q) && q.expression === top && !q.questionDotToken) {
        const m = q.name.text;
        if (m === "length") read = !writeTarget(q);
        else if (ts.isCallExpression(q.parent) && q.parent.expression === q) read = ARRAY_READ.has(m) || (ARRAY_CALLBACK.has(m) && cbOk(q.parent, m));
      } else if (ts.isElementAccessExpression(q) && q.expression === top) read = !writeTarget(q);
      else if (ts.isSpreadElement(q) && ts.isArrayLiteralExpression(q.parent)) read = true;
      else if (ts.isForOfStatement(q) && q.expression === top) read = true;
      if (!read) { ok = false; return; }
    }
    ts.forEachChild(n, v);
  };
  v(c.sf);
  return ok;
}
function loadCallInert(x: ts.CallExpression, c: LoadCtx, binding: string | null): boolean {
  if (!c.lc || x.questionDotToken || !ts.isIdentifier(x.expression)) return false;
  const name = x.expression.text;
  const here = c.path ?? c.sf.fileName;
  let tgt: { path: string; idx: ModuleIndex; sf: ts.SourceFile; name: string } | null = null;
  if (c.idx.fns.has(name) && !c.idx.consts.has(name) && !c.idx.imports.has(name) && !c.idx.mutable.has(name) && !c.idx.enums.has(name)) tgt = { path: here, idx: c.idx, sf: c.sf, name };
  else {
    const imp = c.idx.imports.get(name);
    if (!imp || imp.typeOnly || !imp.imported || imp.imported === "default" || !/^\.\.?\//.test(imp.spec) || !c.read || !c.path) return false;
    const hits = (siblingCandidates(c.path, imp.spec) ?? []).filter((y) => c.read!(y) !== null);
    if (hits.length !== 1) return false;
    const t = hits[0]!;
    const text = c.read(t)!;
    const sf = ts.createSourceFile(t, text, ts.ScriptTarget.Latest, true);
    if ((sf as unknown as { parseDiagnostics: unknown[] }).parseDiagnostics.length) return false;
    const idx = indexModule(sf);
    if (!idx.exportNames.has(imp.imported) || !idx.fns.has(imp.imported)) return false;
    // import-back: the callee's module must never load the calling module (no cycle, no TDZ-order dependence)
    const clo = moduleReadClosure(t, c.read);
    if (!clo || clo.includes(here)) return false;
    tgt = { path: t, idx, sf, name: imp.imported };
  }
  const decls = tgt.idx.fns.get(tgt.name) ?? [];
  if (decls.length !== 1 || !decls[0]!.body || !ts.isFunctionDeclaration(decls[0]!)) return false;
  const f = decls[0]!;
  if (x.arguments.length > f.parameters.length) return false;
  if (!x.arguments.every((y) => !ts.isSpreadElement(y) && primInert(y, c))) return false;
  const tc: LoadCtx = { idx: tgt.idx, sf: tgt.sf, seen: new Set(), path: tgt.path, read: c.read, cache: c.cache };
  for (let i = x.arguments.length; i < f.parameters.length; i++) {
    const p = f.parameters[i]!;
    if (p.initializer ? !primInert(p.initializer, tc) : !p.questionToken) return false;
  }
  const v = c.lc(tgt.path, tgt.name);
  if (!v) return false;
  if (v.kind === "prim") return true;
  return v.aliasFree && binding !== null && localArrayReadOnly(c, binding);
}

/**
 * Auditor #466 (3rd review): FAIL-CLOSED load-time allowlist, every version. Instead of looking for bad load-time
 * code (a denylist the reviews kept finding holes in), every top-level statement of every module that loads with the
 * target must be one of a short list of shapes that run no code at import:
 * - imports (a Node built-in, a type-only import, or a relative `.ts` module that joins the closure and is checked
 *   the same way; a package import or anything that does not resolve to exactly one readable `.ts` module is code
 *   the walk cannot see: test_target_io), re-exports (the same), `export { local }`;
 * - function, interface, type alias and ambient (`declare`) declarations, and namespaces holding only types;
 * - enums whose initializers are primitive constants (literals, operators on them, members of enums);
 * - classes with no decorators, an `extends` that is a plain name, no static blocks and only inert static
 *   initializers and primitive-constant computed names;
 * - `const` / `let` / `var` declarations (and `export default`) whose initializer is SAFE (loadSafe: no user code runs);
 * - the ESM entry-point guard (isMainGuard; its block never runs under the test runner), and the "use strict" prologue.
 * Anything else (an expression statement, a call or `new` outside the allowlist, `if` / `for` / `try` / blocks /
 * labels / `throw` / `switch` / loops, `export =`, `import x = ..`) refuses the target: test_target_impure.
 * The closure is the target module alone for v1 (it reads no sibling, so a relative or package value import is code
 * it cannot see: test_target_io), and the whole relative import closure for v2+ (value, side-effect and re-export
 * edges; type-only imports skipped; at most MAX_LOAD_CLOSURE modules, else test_target_too_large).
 */
export const MAX_LOAD_CLOSURE = 64;
/** Data properties of the built-in namespaces a module constant may name (never functions, never writable state). */
const CONST_MEMBERS: Readonly<Record<string, ReadonlySet<string>>> = {
  Number: new Set(["MAX_SAFE_INTEGER", "MIN_SAFE_INTEGER", "MAX_VALUE", "MIN_VALUE", "EPSILON", "POSITIVE_INFINITY", "NEGATIVE_INFINITY", "NaN"]),
  Math: new Set(["PI", "E", "LN2", "LN10", "LOG2E", "LOG10E", "SQRT2", "SQRT1_2"]),
};
const ERROR_BASES = new Set(["Error", "TypeError", "RangeError", "SyntaxError"]);
export interface LoadProblem { reason: string; module: string; detail: string }
interface LoadCtx { idx: ModuleIndex; sf: ts.SourceFile; seen: Set<string>; path?: string; read?: ((rel: string) => string | null) | null; cache?: Map<string, { idx: ModuleIndex; sf: ts.SourceFile } | null>; lc?: LoadCallCheck }
/** A named import from a relative `.ts` module, as that module's own load context and exported const name. */
function importedConst(c: LoadCtx, name: string): { c: LoadCtx; name: string } | null {
  const imp = c.idx.imports.get(name);
  if (!imp || imp.typeOnly || !imp.imported || imp.imported === "default" || !c.read || !c.path || !c.cache) return null;
  const hits = (siblingCandidates(c.path, imp.spec) ?? []).filter((x) => c.read!(x) !== null);
  if (hits.length !== 1) return null;
  const t = hits[0]!;
  if (!c.cache.has(t)) {
    const text = c.read(t);
    const sf = text === null ? null : ts.createSourceFile(t, text, ts.ScriptTarget.Latest, true);
    c.cache.set(t, sf && !(sf as unknown as { parseDiagnostics: unknown[] }).parseDiagnostics.length ? { sf, idx: indexModule(sf) } : null);
  }
  const m = c.cache.get(t);
  if (!m || !m.idx.exportNames.has(imp.imported)) return null;
  return { c: { idx: m.idx, sf: m.sf, seen: c.seen, path: t, read: c.read, cache: c.cache, lc: c.lc }, name: imp.imported };
}
const propName = (n: ts.PropertyName | undefined): string | null => (n && (ts.isIdentifier(n) || ts.isStringLiteral(n) || ts.isNumericLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) ? n.text : null);
/** A module const's own initializer (one declaration, a plain name, `const`). */
function moduleConstInit(c: LoadCtx, name: string): ts.Expression | null {
  const d = c.idx.consts.get(name);
  return d && d.initializer && !c.idx.mutated.has(name) && unshadowedExceptConst(c.idx, name) ? d.initializer : null;
}
const unshadowedExceptConst = (idx: ModuleIndex, n: string): boolean => !idx.imports.has(n) && !idx.enums.has(n) && !idx.mutable.has(n) && !idx.fns.has(n);
/** A primitive constant: evaluating it runs no user code and yields a string / number / bigint / boolean / null / undefined. */
function primInert(e: ts.Expression, c: LoadCtx, depth = 0): boolean {
  if (depth > 24) return false;
  const x = unwrapExpr(e);
  if (ts.isStringLiteral(x) || ts.isNoSubstitutionTemplateLiteral(x) || ts.isNumericLiteral(x) || ts.isBigIntLiteral(x) || x.kind === ts.SyntaxKind.TrueKeyword || x.kind === ts.SyntaxKind.FalseKeyword || x.kind === ts.SyntaxKind.NullKeyword) return true;
  const r = (y: ts.Expression) => primInert(y, c, depth + 1);
  if (ts.isTemplateExpression(x)) return x.templateSpans.every((s) => r(s.expression));
  if (ts.isPrefixUnaryExpression(x)) return [ts.SyntaxKind.MinusToken, ts.SyntaxKind.PlusToken, ts.SyntaxKind.ExclamationToken, ts.SyntaxKind.TildeToken].includes(x.operator) && r(x.operand);
  if (ts.isVoidExpression(x)) return r(x.expression);
  if (ts.isTypeOfExpression(x)) return r(x.expression);
  if (ts.isConditionalExpression(x)) return r(x.condition) && r(x.whenTrue) && r(x.whenFalse);
  if (ts.isBinaryExpression(x)) {
    const k = x.operatorToken.kind;
    if ((k >= ts.SyntaxKind.FirstAssignment && k <= ts.SyntaxKind.LastAssignment) || k === ts.SyntaxKind.InKeyword || k === ts.SyntaxKind.InstanceOfKeyword) return false;
    return r(x.left) && r(x.right);
  }
  if (ts.isIdentifier(x)) {
    if (VALUE_GLOBALS.has(x.text)) return unshadowed(c.idx, x.text);
    const key = `${c.path ?? ""}\0${x.text}`;
    if (c.seen.has(key)) return false;
    const init = moduleConstInit(c, x.text);
    // a named import of a primitive constant from a relative module (read for this check only)
    const ic = init ? null : importedConst(c, x.text);
    const ii = ic ? moduleConstInit(ic.c, ic.name) : null;
    if (!init && !ii) return false;
    c.seen.add(key);
    try { return init ? r(init) : primInert(ii!, ic!.c, depth + 1); } finally { c.seen.delete(key); }
  }
  if (ts.isPropertyAccessExpression(x) && ts.isIdentifier(x.expression) && !x.questionDotToken) {
    const o = x.expression.text;
    if (c.idx.enums.has(o)) return true;
    if (CONST_MEMBERS[o]?.has(x.name.text) && unshadowed(c.idx, o)) return true;
  }
  return false;
}
/**
 * Only these uses of a module `new Map(..)` / `new Set(..)` in module `c` (never written, never handed out): reads in
 * place. An `export` of it is allowed: every module of the load closure that imports it is held to the same rule
 * (loadAllowlistProblem), and a re-export, namespace or default import of a module exporting one is refused there.
 */
function collectionReadOnly(c: LoadCtx, name: string): boolean {
  if (c.idx.mutated.has(name)) return false;
  let ok = true;
  const v = (n: ts.Node): void => {
    if (!ok) return;
    if (ts.isExportSpecifier(n) && (n.propertyName ?? n.name).text === name && (n.propertyName || n.parent.parent.moduleSpecifier)) { ok = false; return; }
    if (ts.isExportAssignment(n) && ts.isIdentifier(unwrapExpr(n.expression)) && (unwrapExpr(n.expression) as ts.Identifier).text === name) { ok = false; return; }
    if (ts.isShorthandPropertyAssignment(n) && n.name.text === name) { ok = false; return; }
    if (ts.isIdentifier(n) && n.text === name && isValueReference(n) && !(ts.isVariableDeclaration(n.parent) && n.parent.name === n)) {
      let top: ts.Node = n;
      while ((ts.isNonNullExpression(top.parent) || ts.isParenthesizedExpression(top.parent) || ts.isAsExpression(top.parent)) && top.parent.expression === top) top = top.parent;
      const q = top.parent;
      const read = (ts.isPropertyAccessExpression(q) && q.expression === top && (q.name.text === "size" || (["get", "has", "keys", "values", "entries"].includes(q.name.text) && ts.isCallExpression(q.parent) && q.parent.expression === q)))
        || (ts.isSpreadElement(q) && ts.isArrayLiteralExpression(q.parent))
        || (ts.isForOfStatement(q) && q.expression === top);
      if (!read) { ok = false; return; }
    }
    ts.forEachChild(n, v);
  };
  v(c.sf);
  return ok;
}
/** Built-in data constructors / factories a load-time initializer may call (receiver global, never shadowed). They run
 * no user code when every argument is DATA (no function, accessor or method anywhere in it), and touch no global. */
const LOAD_NEW = new Set(["Set", "Map", "WeakMap", "WeakSet", "Uint8Array", "ArrayBuffer", "DataView", "TextEncoder", "TextDecoder"]);
const LOAD_STATIC: Readonly<Record<string, ReadonlySet<string>>> = {
  Object: new Set(["freeze", "fromEntries", "entries", "keys", "values"]),
  Uint8Array: new Set(["from", "of"]),
  Buffer: new Set(["from"]),
  Date: new Set(["UTC"]),
  Array: new Set(["from", "of"]),
};
/** Built-in methods on a DATA receiver that build new data (callbacks: an arrow whose expression body is DATA). */
const LOAD_METHODS = new Set(["join", "repeat", "map", "filter", "flatMap", "slice", "concat", "padStart", "padEnd", "toUpperCase", "toLowerCase", "trim"]);
const LOAD_CALLBACK = new Set(["map", "filter", "flatMap"]);
/**
 * DATA at load: evaluating `e` runs no user code and its value holds no function. Primitive constants, regex literals,
 * array / object literals of data (no accessor, method, spread of non-data, `__proto__` or non-constant computed key),
 * names of module consts whose initializer is data (and `names`, a load-time callback's parameters), data properties of
 * those, the LOAD_NEW / LOAD_STATIC built-ins on data arguments, LOAD_METHODS on a data receiver.
 */
function loadData(e: ts.Expression, c: LoadCtx, names: ReadonlySet<string>, depth = 0): boolean {
  if (depth > 24) return false;
  const x = unwrapExpr(e);
  const r = (y: ts.Expression) => loadData(y, c, names, depth + 1);
  if (primInert(x, c)) return true;
  if (ts.isRegularExpressionLiteral(x)) return true;
  if (ts.isTemplateExpression(x)) return x.templateSpans.every((s) => r(s.expression));
  if (ts.isPrefixUnaryExpression(x)) return [ts.SyntaxKind.MinusToken, ts.SyntaxKind.PlusToken, ts.SyntaxKind.ExclamationToken, ts.SyntaxKind.TildeToken].includes(x.operator) && r(x.operand);
  if (ts.isConditionalExpression(x)) return r(x.condition) && r(x.whenTrue) && r(x.whenFalse);
  if (ts.isBinaryExpression(x)) {
    const k = x.operatorToken.kind;
    if ((k >= ts.SyntaxKind.FirstAssignment && k <= ts.SyntaxKind.LastAssignment) || k === ts.SyntaxKind.InKeyword || k === ts.SyntaxKind.InstanceOfKeyword) return false;
    return r(x.left) && r(x.right);
  }
  if (ts.isArrayLiteralExpression(x)) return x.elements.every((el) => ts.isOmittedExpression(el) || (ts.isSpreadElement(el) ? r(el.expression) : r(el)));
  if (ts.isObjectLiteralExpression(x)) return x.properties.every((p) => {
    if (p.name && ts.isComputedPropertyName(p.name) && !primInert(p.name.expression, c)) return false;
    if (p.name && propName(p.name) === "__proto__") return false;
    if (ts.isPropertyAssignment(p)) return r(p.initializer);
    if (ts.isShorthandPropertyAssignment(p)) return !p.objectAssignmentInitializer && r(p.name);
    return false;
  });
  if (ts.isIdentifier(x)) {
    if (names.has(x.text)) return true;
    const init = moduleConstInit(c, x.text);
    if (!init || c.seen.has(x.text)) return false;
    c.seen.add(x.text);
    try { return r(init); } finally { c.seen.delete(x.text); }
  }
  if (ts.isPropertyAccessExpression(x) && !x.questionDotToken) {
    if (primInert(x, c)) return true;
    if (x.name.text === "length" && r(x.expression)) return true;
    const o = unwrapExpr(x.expression);
    if (ts.isIdentifier(o) && names.has(o.text)) return true; // a property of data is data (no accessor anywhere in data)
    if (ts.isIdentifier(o)) {
      const init = moduleConstInit(c, o.text);
      const lit = init && unwrapExpr(init);
      if (lit && ts.isObjectLiteralExpression(lit)) { const p = lit.properties.find((q) => ts.isPropertyAssignment(q) && propName(q.name) === x.name.text) as ts.PropertyAssignment | undefined; return !!p && r(p.initializer); }
    }
    return false;
  }
  if (ts.isElementAccessExpression(x) && !x.questionDotToken) {
    const o = unwrapExpr(x.expression);
    return ts.isIdentifier(o) && names.has(o.text) && primInert(x.argumentExpression, c);
  }
  if (ts.isNewExpression(x) || ts.isCallExpression(x)) {
    const g = x.arguments ?? ts.factory.createNodeArray<ts.Expression>();
    const callee = x.expression;
    if (ts.isNewExpression(x)) {
      if (ts.isIdentifier(callee) && LOAD_NEW.has(callee.text) && unshadowed(c.idx, callee.text)) return g.every(r);
      if (ts.isIdentifier(callee) && callee.text === "RegExp" && unshadowed(c.idx, "RegExp")) return g.length >= 1 && g.length <= 2 && g.every((y) => ts.isStringLiteralLike(y));
      // Intl.DateTimeFormat construction reads locale data only (any use of it is test_target_date_local in the walk)
      if (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression) && callee.expression.text === "Intl" && callee.name.text === "DateTimeFormat" && unshadowed(c.idx, "Intl")) return g.every(r);
      return false;
    }
    if (ts.isIdentifier(callee) && callee.text === "RegExp" && unshadowed(c.idx, "RegExp")) return g.length >= 1 && g.length <= 2 && g.every((y) => ts.isStringLiteralLike(y));
    if (!ts.isPropertyAccessExpression(callee) || callee.questionDotToken) return false;
    const m = callee.name.text;
    const recv = unwrapExpr(callee.expression);
    if (ts.isIdentifier(recv) && LOAD_STATIC[recv.text] && unshadowed(c.idx, recv.text) && !names.has(recv.text)) return LOAD_STATIC[recv.text]!.has(m) && g.every(r);
    if (!LOAD_METHODS.has(m) || !r(recv)) return false;
    if (LOAD_CALLBACK.has(m)) {
      if (g.length !== 1) return false;
      const cb = unwrapExpr(g[0]!);
      if (!ts.isArrowFunction(cb) || hasMod(cb, ts.SyntaxKind.AsyncKeyword) || !ts.isExpression(cb.body)) return false;
      const inner = new Set(names);
      const bind = (b: ts.BindingName): boolean => { if (ts.isIdentifier(b)) { inner.add(b.text); return true; } return b.elements.every((el) => ts.isOmittedExpression(el) || (!el.dotDotDotToken && !el.initializer && bind(el.name))); };
      if (!cb.parameters.every((p) => !p.initializer && !p.dotDotDotToken && bind(p.name))) return false;
      return loadData(cb.body, c, inner, depth + 1);
    }
    return g.every(r);
  }
  return false;
}
/** SAFE at load: DATA, or a value holding functions that do not run at load (function expressions, methods,
 * accessors, references to module bindings and pure globals). Never a call of user code. */
function loadSafe(e: ts.Expression, c: LoadCtx, depth = 0): boolean {
  if (depth > 24) return false;
  if (loadData(e, c, new Set())) return true;
  const x = unwrapExpr(e);
  const r = (y: ts.Expression) => loadSafe(y, c, depth + 1);
  if (ts.isArrowFunction(x) || ts.isFunctionExpression(x)) return true;
  if (ts.isArrayLiteralExpression(x)) return x.elements.every((el) => ts.isOmittedExpression(el) || (!ts.isSpreadElement(el) && r(el)));
  if (ts.isObjectLiteralExpression(x)) return x.properties.every((p) => {
    if (ts.isSpreadAssignment(p)) return false;
    if (p.name && ts.isComputedPropertyName(p.name) && !primInert(p.name.expression, c)) return false;
    if (p.name && propName(p.name) === "__proto__") return false;
    if (ts.isPropertyAssignment(p)) return r(p.initializer);
    if (ts.isShorthandPropertyAssignment(p)) return !p.objectAssignmentInitializer && r(p.name);
    return ts.isMethodDeclaration(p) || ts.isGetAccessor(p) || ts.isSetAccessor(p);
  });
  if (ts.isIdentifier(x)) {
    const n = x.text;
    if (c.idx.fns.has(n) || c.idx.consts.has(n) || c.idx.enums.has(n) || c.idx.mutable.has(n) || (c.idx.imports.has(n) && !c.idx.imports.get(n)!.typeOnly)) return true;
    return PURE_GLOBALS.has(n) && n !== "RegExp" && n !== "Object" && unshadowed(c.idx, n);
  }
  if (ts.isPropertyAccessExpression(x) && ts.isIdentifier(x.expression) && !x.questionDotToken) {
    const imp = c.idx.imports.get(x.expression.text);
    return !!imp && !imp.imported && !imp.typeOnly && imp.spec.startsWith("."); // a namespace import's member: a module binding
  }
  if (ts.isCallExpression(x) && ts.isPropertyAccessExpression(x.expression) && ts.isIdentifier(x.expression.expression) && x.expression.expression.text === "Object" && x.expression.name.text === "freeze" && unshadowed(c.idx, "Object")) return x.arguments.length === 1 && r(x.arguments[0]!);
  return false;
}
/**
 * Auditor #466 (3rd review), module STATE, every version: a module const the walk reaches is shared by every call, so
 * its initializer must build a value that keeps no state between calls (fail-closed allowlist): primitive constants;
 * regex literals and `new RegExp("lit", "flags")` without g / y; array / object literals of such values (functions
 * included: the walk analyzes them); `Object.freeze(..)` of one; `Object.fromEntries` / `entries` / `keys` / `values`,
 * `Array.from` / `of`, `Date.UTC`, and data-building methods on data (a new plain value); `new Set(..)` / `new Map(..)`
 * of data bound to a name only read in place (collectionReadOnly). Anything else (a call of user code, an iterator, a
 * typed array, DataView, TextEncoder / TextDecoder, Intl, Buffer, a class instance) is state: test_target_impure.
 */
function statelessInit(e: ts.Expression, c: LoadCtx, binding: string | null, depth = 0): boolean {
  if (depth > 24) return false;
  const x = unwrapExpr(e);
  const r = (y: ts.Expression) => statelessInit(y, c, null, depth + 1);
  if (primInert(x, c)) return true;
  if (ts.isRegularExpressionLiteral(x)) return !/\/[a-z]*[gy][a-z]*$/.test(x.text);
  if (ts.isArrowFunction(x) || ts.isFunctionExpression(x)) return true;
  if (ts.isIdentifier(x) || ts.isPropertyAccessExpression(x) || ts.isElementAccessExpression(x)) return loadSafe(x, c) && !(ts.isIdentifier(x) && x.text === "RegExp");
  if (ts.isTemplateExpression(x) || ts.isBinaryExpression(x) || ts.isConditionalExpression(x) || ts.isPrefixUnaryExpression(x)) return loadData(x, c, new Set());
  if (ts.isArrayLiteralExpression(x)) return x.elements.every((el) => ts.isOmittedExpression(el) || (ts.isSpreadElement(el) ? loadData(el.expression, c, new Set()) : r(el)));
  if (ts.isObjectLiteralExpression(x)) return x.properties.every((p) => {
    if (ts.isSpreadAssignment(p)) return false;
    if (p.name && ts.isComputedPropertyName(p.name) && !primInert(p.name.expression, c)) return false;
    if (p.name && propName(p.name) === "__proto__") return false;
    if (ts.isPropertyAssignment(p)) return r(p.initializer);
    if (ts.isShorthandPropertyAssignment(p)) return !p.objectAssignmentInitializer;
    return ts.isMethodDeclaration(p) || ts.isGetAccessor(p) || ts.isSetAccessor(p);
  });
  if (ts.isNewExpression(x) || ts.isCallExpression(x)) {
    const callee = x.expression;
    const g = x.arguments ?? ts.factory.createNodeArray<ts.Expression>();
    if (ts.isIdentifier(callee) && callee.text === "RegExp" && unshadowed(c.idx, "RegExp")) return g.length >= 1 && g.length <= 2 && ts.isStringLiteralLike(g[0]!) && (!g[1] || (ts.isStringLiteralLike(g[1]) && !/[gy]/.test(g[1].text)));
    if (ts.isNewExpression(x)) return ts.isIdentifier(callee) && (callee.text === "Set" || callee.text === "Map") && unshadowed(c.idx, callee.text) && !!binding && collectionReadOnly(c, binding) && g.every((y) => loadData(y, c, new Set()));
    if (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression) && callee.expression.text === "Object" && callee.name.text === "freeze" && unshadowed(c.idx, "Object")) return g.length === 1 && r(g[0]!);
    if (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression) && ["Object", "Array", "Date"].includes(callee.expression.text) && unshadowed(c.idx, callee.expression.text) && !["Uint8Array", "Buffer"].includes(callee.expression.text)) return loadData(x, c, new Set());
    if (ts.isPropertyAccessExpression(callee) && LOAD_METHODS.has(callee.name.text)) return loadData(x, c, new Set());
    return ts.isCallExpression(x) && loadCallInert(x, c, binding);
  }
  return false;
}
/** A class declaration that runs no code at load (see the allowlist above). */
function classInert(s: ts.ClassDeclaration, c: LoadCtx): boolean {
  if (ts.getDecorators(s)?.length) return false;
  for (const h of s.heritageClauses ?? []) {
    if (h.token !== ts.SyntaxKind.ExtendsKeyword) continue;
    for (const t of h.types) {
      const e = unwrapExpr(t.expression);
      if (!ts.isIdentifier(e)) return false;
      if (!(c.idx.mutable.has(e.text) || (c.idx.imports.has(e.text) && c.idx.imports.get(e.text)!.spec.startsWith(".")) || (ERROR_BASES.has(e.text) && unshadowed(c.idx, e.text)))) return false;
    }
  }
  for (const m of s.members) {
    if (ts.canHaveDecorators(m) && ts.getDecorators(m)?.length) return false;
    if (ts.isClassStaticBlockDeclaration(m)) return false;
    if (m.name && ts.isComputedPropertyName(m.name) && !primInert(m.name.expression, c)) return false;
    if (ts.isPropertyDeclaration(m) && hasMod(m, ts.SyntaxKind.StaticKeyword) && m.initializer && !loadSafe(m.initializer, c)) return false;
  }
  return true;
}
const typesOnly = (b: ts.ModuleBody | undefined): boolean => !b || (ts.isModuleBlock(b) ? b.statements.every((s) => ts.isInterfaceDeclaration(s) || ts.isTypeAliasDeclaration(s) || (ts.isModuleDeclaration(s) && typesOnly(s.body))) : ts.isModuleDeclaration(b) && typesOnly(b.body));
/** One top-level statement: null when it runs no code at load (relative imports are handled by the closure walk). */
function loadStatementProblem(s: ts.Statement, c: LoadCtx, first: boolean): string | null {
  if (hasMod(s, ts.SyntaxKind.DeclareKeyword)) return null;
  if (ts.isImportDeclaration(s) || ts.isInterfaceDeclaration(s) || ts.isTypeAliasDeclaration(s) || ts.isEmptyStatement(s)) return null;
  if (ts.isExportDeclaration(s)) return null;
  if (ts.isFunctionDeclaration(s)) return null;
  if (ts.isModuleDeclaration(s)) return typesOnly(s.body) ? null : "namespace with code";
  if (ts.isEnumDeclaration(s)) return s.members.every((m) => !m.initializer || primInert(m.initializer, c)) ? null : "enum initializer";
  if (ts.isClassDeclaration(s)) return classInert(s, c) ? null : "class runs code at load";
  if (ts.isVariableStatement(s)) {
    for (const d of s.declarationList.declarations) {
      if (!d.initializer) continue;
      if (!ts.isIdentifier(d.name)) return "destructuring at load";
      if (!loadSafe(d.initializer, c) && !(s.declarationList.flags & ts.NodeFlags.Const && ts.isCallExpression(unwrapExpr(d.initializer)) && loadCallInert(unwrapExpr(d.initializer) as ts.CallExpression, c, d.name.text))) return `initializer of ${d.name.text}`;
    }
    return null;
  }
  if (ts.isExportAssignment(s)) return !s.isExportEquals && loadSafe(s.expression, c) && !isCollectionNew(s.expression) ? null : "export default value";
  if (first && ts.isExpressionStatement(s) && ts.isStringLiteral(s.expression)) return null; // "use strict"
  if (ts.isExpressionStatement(s) && ts.isCallExpression(s.expression) && loadCallInert(s.expression, c, null)) return null;
  if (isMainGuard(s, c.idx)) return null;
  return ts.SyntaxKind[s.kind];
}
const isCollectionNew = (e: ts.Expression | undefined): boolean => { const x = e && unwrapExpr(e); return !!x && ts.isNewExpression(x) && ts.isIdentifier(x.expression) && (x.expression.text === "Map" || x.expression.text === "Set"); };
/** The module consts `m` exports whose value is a `new Map(..)` / `new Set(..)`. */
function exportedCollections(m: { idx: ModuleIndex }): Set<string> {
  return new Set([...m.idx.exportNames].filter((n) => isCollectionNew(m.idx.consts.get(n)?.initializer)));
}
/** The fail-closed load check for one target (see the allowlist above): null, or the reason and where. */
/** A refused load-time statement that itself loads code (`import()`, `require`, `import =`) keeps the
 *  test_target_io reason the denylist gave it; every other refused statement is test_target_impure. */
function loadsCode(s: ts.Statement): boolean {
  if (ts.isImportEqualsDeclaration(s)) return true;
  let hit = false;
  const visit = (n: ts.Node): void => {
    if (hit) return;
    if (ts.isCallExpression(n) && (n.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(n.expression) && n.expression.text === "require"))) { hit = true; return; }
    ts.forEachChild(n, visit);
  };
  visit(s);
  return hit;
}
export function loadAllowlistProblem(path: string, sf: ts.SourceFile, idx: ModuleIndex, read: ((rel: string) => string | null) | null, all?: LoadProblem[], lc?: LoadCallCheck): LoadProblem | null {
  const fail = (x: LoadProblem): LoadProblem | null => { if (all) { all.push(x); return null; } return x; };
  const mods = new Map<string, { sf: ts.SourceFile; idx: ModuleIndex }>([[path, { sf, idx }]]);
  const cache = new Map<string, { idx: ModuleIndex; sf: ts.SourceFile } | null>();
  const queue = [path];
  while (queue.length) {
    const p = queue.shift()!;
    const m = mods.get(p)!;
    const c: LoadCtx = { idx: m.idx, sf: m.sf, seen: new Set(), path: p, read, cache, lc };
    let first = true;
    for (const s of m.sf.statements) {
      const why = loadStatementProblem(s, c, first);
      first = false;
      if (why) { const x = fail({ reason: loadsCode(s) ? TEST_TARGET_IO : TEST_TARGET_IMPURE, module: p, detail: `${why}: ${s.getText(m.sf).slice(0, 80)}` }); if (x) return x; }
      // edges: imports and re-exports that load a module
      if (ts.isImportEqualsDeclaration(s)) return { reason: TEST_TARGET_IO, module: p, detail: "import =" };
      if (!(ts.isImportDeclaration(s) || ts.isExportDeclaration(s)) || !s.moduleSpecifier || !ts.isStringLiteral(s.moduleSpecifier)) continue;
      if (ts.isImportDeclaration(s) ? !!s.importClause?.isTypeOnly : s.isTypeOnly) continue;
      const spec = s.moduleSpecifier.text;
      if (NODE_BUILTINS.test(spec)) continue;
      // v1 without the tree: a relative import is a value v1 cannot follow (its long-standing test_target_impure)
      if (!read && /^\.\.?\//.test(spec)) return { reason: TEST_TARGET_IMPURE, module: p, detail: `loads ${spec} (no tree)` };
      if (!read || !/^\.\.?\//.test(spec)) return { reason: TEST_TARGET_IO, module: p, detail: `loads ${spec}` };
      const hits = (siblingCandidates(p, spec) ?? []).filter((x) => read(x) !== null);
      if (hits.length !== 1) return { reason: TEST_TARGET_IO, module: p, detail: `unresolved ${spec}` };
      const t = hits[0]!;
      if (mods.has(t)) continue;
      if (mods.size >= MAX_LOAD_CLOSURE) return { reason: TEST_TARGET_TOO_LARGE, module: p, detail: "closure" };
      const text = read(t)!;
      const tsf = ts.createSourceFile(t, text, ts.ScriptTarget.Latest, true);
      if ((tsf as unknown as { parseDiagnostics: unknown[] }).parseDiagnostics.length) return { reason: TEST_TARGET_IMPURE, module: t, detail: "parse" };
      mods.set(t, { sf: tsf, idx: indexModule(tsf) });
      queue.push(t);
    }
  }
  // A module Map / Set another closure module imports: read in place there too; never re-exported, never reached
  // through a namespace or default import.
  for (const [p, m] of mods) for (const s of m.sf.statements) {
    if (!(ts.isImportDeclaration(s) || ts.isExportDeclaration(s)) || !s.moduleSpecifier || !ts.isStringLiteral(s.moduleSpecifier) || !read) continue;
    const hits = (siblingCandidates(p, s.moduleSpecifier.text) ?? []).filter((x) => mods.has(x));
    const t = hits.length === 1 ? mods.get(hits[0]!)! : null;
    const cols = t ? exportedCollections(t) : new Set<string>();
    if (!cols.size) continue;
    const bad = (why: string) => fail({ reason: TEST_TARGET_IMPURE, module: p, detail: `${why} of ${hits[0]}` });
    if (ts.isExportDeclaration(s)) { const x = bad("re-export"); if (x) return x; continue; }
    const cl = s.importClause;
    if (!cl || cl.isTypeOnly) continue;
    if (cl.name || (cl.namedBindings && ts.isNamespaceImport(cl.namedBindings))) { const x = bad("namespace / default import"); if (x) return x; continue; }
    if (cl.namedBindings && ts.isNamedImports(cl.namedBindings)) for (const el of cl.namedBindings.elements) {
      if (el.isTypeOnly || !cols.has((el.propertyName ?? el.name).text)) continue;
      if (!collectionReadOnly({ idx: m.idx, sf: m.sf, seen: new Set() }, el.name.text)) { const x = bad(`${el.name.text} written or handed out`); if (x) return x; }
    }
  }
  return null;
}
/** Auditor #466: `e` can never evaluate to a function (so storing it under an unknown key adds no callable member). */
function neverCallable(e: ts.Expression | undefined, depth = 0): boolean {
  if (!e || depth > 16) return false;
  const x = unwrapExpr(e);
  if (builtinValue(x, NO_BUILTINS) || ts.isObjectLiteralExpression(x) || x.kind === ts.SyntaxKind.TrueKeyword || x.kind === ts.SyntaxKind.FalseKeyword || x.kind === ts.SyntaxKind.NullKeyword || ts.isPrefixUnaryExpression(x) || ts.isPostfixUnaryExpression(x) || ts.isTypeOfExpression(x) || ts.isVoidExpression(x) || ts.isDeleteExpression(x)) return true;
  if (ts.isIdentifier(x)) return x.text === "undefined" || x.text === "NaN" || x.text === "Infinity";
  if (ts.isConditionalExpression(x)) return neverCallable(x.whenTrue, depth + 1) && neverCallable(x.whenFalse, depth + 1);
  if (ts.isBinaryExpression(x)) {
    const k = x.operatorToken.kind;
    if (k === ts.SyntaxKind.BarBarToken || k === ts.SyntaxKind.QuestionQuestionToken || k === ts.SyntaxKind.AmpersandAmpersandToken) return neverCallable(x.left, depth + 1) && neverCallable(x.right, depth + 1);
    if (k === ts.SyntaxKind.CommaToken || k === ts.SyntaxKind.EqualsToken || k === ts.SyntaxKind.BarBarEqualsToken || k === ts.SyntaxKind.QuestionQuestionEqualsToken || k === ts.SyntaxKind.AmpersandAmpersandEqualsToken) return neverCallable(x.right, depth + 1);
    return true; // arithmetic, comparison, bitwise, `in`, `instanceof`, compound arithmetic assignment: a primitive
  }
  if (ts.isCallExpression(x)) {
    const c = x.expression;
    if (ts.isIdentifier(c) && ["String", "Number", "Boolean", "parseInt", "parseFloat", "isNaN", "isFinite", "encodeURIComponent", "decodeURIComponent"].includes(c.text)) return true;
    if (ts.isPropertyAccessExpression(c) && ts.isIdentifier(c.expression) && (c.expression.text === "Math" || (c.expression.text === "JSON" && c.name.text === "stringify") || (c.expression.text === "Number" && c.name.text !== "constructor"))) return true;
    // `[..].sort()` / `.reverse()` / `.fill(v)` return their (built-in) receiver
    if (ts.isPropertyAccessExpression(c) && ["sort", "reverse", "fill", "copyWithin"].includes(c.name.text)) return builtinValue(c.expression, NO_BUILTINS);
  }
  return false;
}
/** Auditor #466: every member name `sf` defines on some object anywhere (reached or not; see USER_MEMBER). */
function memberNames(sf: ts.SourceFile, out: Set<string>): void {
  const v = (n: ts.Node): void => {
    if (ts.isObjectLiteralExpression(n)) for (const pr of n.properties) {
      if (ts.isSpreadAssignment(pr)) continue;
      const nm = pr.name;
      if (!nm || ts.isPrivateIdentifier(nm)) out.add("*");
      else if (ts.isComputedPropertyName(nm)) { if (!(ts.isPropertyAssignment(pr) && neverCallable(pr.initializer))) out.add("*"); }
      else out.add(nm.text);
    }
    if (ts.isClassLike(n)) for (const mem of n.members) { const nm = mem.name; out.add(!nm || ts.isComputedPropertyName(nm) || ts.isPrivateIdentifier(nm) ? "*" : nm.text); }
    if (ts.isBinaryExpression(n) && n.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && n.operatorToken.kind <= ts.SyntaxKind.LastAssignment) {
      const t = unwrapExpr(n.left);
      if (ts.isPropertyAccessExpression(t)) out.add(t.name.text);
      else if (ts.isElementAccessExpression(t)) { if (ts.isStringLiteralLike(t.argumentExpression) || ts.isNumericLiteral(t.argumentExpression)) out.add(t.argumentExpression.text); else if (!neverCallable(n.right)) out.add("*"); }
    }
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && ["fromEntries", "assign", "defineProperty", "defineProperties", "create", "setPrototypeOf"].includes(n.expression.name.text)) out.add("*");
    // a module function named like a fresh method is a member of the module namespace
    if (ts.isFunctionDeclaration(n) && n.name && n.parent === sf) out.add(n.name.text);
    ts.forEachChild(n, v);
  };
  v(sf);
}
/**
 * Auditor #466: the member names every module the analysis read defines anywhere (reached or not) join the walked
 * ones for the FRESH_BY_NAME check. Global patches: load-time code and reached code get the purity walk (v1 too); the
 * whole relative import closure, aliases included, is the v7 walk's (v7ClosureProblem, patchesGlobal).
 */
function readModuleMembers(path: string, sf: ts.SourceFile, v: V2Ctx | undefined, members: Set<string>): void {
  memberNames(sf, members);
  if (v) for (const [p, m] of v.modules) if (m && p !== path) memberNames(m.sf, members);
}
/** M97: a module const whose value is a container (array / object literal, `new ...`), not a primitive literal. */
function containerInit(e: ts.Expression | undefined): boolean {
  let x = e;
  while (x && (ts.isParenthesizedExpression(x) || ts.isAsExpression(x) || ts.isSatisfiesExpression(x))) x = x.expression;
  return !!x && (ts.isArrayLiteralExpression(x) || ts.isObjectLiteralExpression(x) || ts.isNewExpression(x) || ts.isCallExpression(x));
}
/**
 * M97 (v7 hardening): a module container the analysis followed (`const TABLE = new Map(...)`) is shared by every call,
 * so it may only be read in place: `TABLE.get(k)`, `TABLE.size`, `TABLE[k]`, `[...TABLE]`, `for (const x of TABLE)`.
 * Anywhere in its module, an alias (`const t = TABLE`), a return, an argument, a shorthand property or an export
 * specifier could let other code write it (which the module-wide mutation index cannot see): refused.
 */
function containerEscapes(v: V2Ctx): boolean {
  for (const m of v.modules.values()) {
    if (!m) continue;
    const names = new Set([...m.consts].filter((n) => containerInit(m.idx.consts.get(n)?.initializer)));
    if (!names.size) continue;
    // Auditor #466: a value read out of a container (`T.m`, `STORE.items`, `T[k]`, a for-of element) may be a
    // container too. A name bound to one (`const p = T[k]`, `for (const r of T)`) is a derived name, and every read
    // value (an access path from a container, or a derived name) must be consumed in place: called as a method,
    // compared, combined into a primitive, tested, used as a key, spread into an array or iterated. A return, an
    // argument, a property value, an array element or an `||` / `??` operand lets it escape: `return T.m`.
    const derived = new Set<string>();
    const climb = (n: ts.Expression): { top: ts.Expression; steps: number } => {
      let top: ts.Expression = n;
      let steps = 0;
      for (;;) {
        const q = top.parent;
        if ((ts.isPropertyAccessExpression(q) || ts.isElementAccessExpression(q)) && q.expression === top) { top = q; steps++; }
        else if ((ts.isNonNullExpression(q) || ts.isParenthesizedExpression(q) || ts.isAsExpression(q) || ts.isSatisfiesExpression(q)) && q.expression === top) top = q;
        else return { top, steps };
      }
    };
    const bindNames = (b: ts.BindingName, out: string[]): void => { if (ts.isIdentifier(b)) out.push(b.text); else for (const el of b.elements) if (!ts.isOmittedExpression(el)) bindNames(el.name, out); };
    /** Names bound by the read value `top` (a const / let initializer or a for-of over it), else null. */
    const binds = (top: ts.Expression): string[] | null => {
      const q = top.parent;
      const out: string[] = [];
      if (ts.isVariableDeclaration(q) && q.initializer === top) { bindNames(q.name, out); return out; }
      if (ts.isForOfStatement(q) && q.expression === top && ts.isVariableDeclarationList(q.initializer)) { for (const d of q.initializer.declarations) bindNames(d.name, out); return out; }
      return null;
    };
    const consumed = (top: ts.Expression): boolean => {
      const q = top.parent;
      const last = unwrapExpr(top);
      return (ts.isPropertyAccessExpression(last) && (last.name.text === "length" || last.name.text === "size"))
        || (ts.isCallExpression(q) && q.expression === top)
        || (ts.isBinaryExpression(q) && ![ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken, ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.CommaToken].includes(q.operatorToken.kind) && !(q.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && q.operatorToken.kind <= ts.SyntaxKind.LastAssignment))
        || ts.isPrefixUnaryExpression(q) || ts.isTypeOfExpression(q) || ts.isVoidExpression(q) || ts.isTemplateSpan(q)
        || (ts.isConditionalExpression(q) && q.condition === top)
        || ((ts.isIfStatement(q) || ts.isWhileStatement(q) || ts.isDoStatement(q) || ts.isSwitchStatement(q)) && q.expression === top) || ts.isCaseClause(q)
        || (ts.isElementAccessExpression(q) && q.argumentExpression === top)
        || (ts.isSpreadElement(q) && ts.isArrayLiteralExpression(q.parent));
    };
    const roots = (): ts.Node[] => m.sf.statements.flatMap((st): ts.Node[] => (ts.isVariableStatement(st) ? st.declarationList.declarations.flatMap((d) => (d.initializer ? [d.initializer] : [])) : [st]));
    // Pass 1: derived names, to a fixpoint.
    for (let grew = true; grew;) {
      grew = false;
      const collect = (n: ts.Node): void => {
        if (ts.isIdentifier(n) && isValueReference(n) && (names.has(n.text) || derived.has(n.text))) {
          const { top, steps } = climb(n);
          if (steps > 0 || derived.has(n.text) || ts.isForOfStatement(top.parent)) for (const k of binds(top) ?? []) if (!derived.has(k) && !names.has(k)) { derived.add(k); grew = true; }
        }
        ts.forEachChild(n, collect);
      };
      for (const r of roots()) collect(r);
    }
    let bad = false;
    const see = (n: ts.Node): void => {
      if (bad) return;
      if (ts.isShorthandPropertyAssignment(n) && (names.has(n.name.text) || derived.has(n.name.text))) { bad = true; return; }
      if (ts.isExportSpecifier(n) && names.has((n.propertyName ?? n.name).text)) { bad = true; return; }
      if (ts.isIdentifier(n) && isValueReference(n) && (names.has(n.text) || derived.has(n.text))) {
        const { top, steps } = climb(n);
        if (steps > 0 || derived.has(n.text)) {
          if (!binds(top) && !consumed(top) && !(ts.isForOfStatement(top.parent) && top.parent.expression === top)) { bad = true; return; }
          ts.forEachChild(n, see);
          return;
        }
        const p = n.parent;
        const inPlace = ((ts.isPropertyAccessExpression(p) || ts.isElementAccessExpression(p)) && p.expression === n)
          || (ts.isSpreadElement(p) && ts.isArrayLiteralExpression(p.parent))
          || (ts.isForOfStatement(p) && p.expression === n)
          || (ts.isBinaryExpression(p) && p.operatorToken.kind === ts.SyntaxKind.InKeyword && p.right === n)
          || ts.isTypeQueryNode(p);
        if (!inPlace) { bad = true; return; }
      }
      ts.forEachChild(n, see);
    };
    // the declaration itself (`const TABLE = new Map(...)`) is not a use; its initializer is walked
    for (const r of roots()) see(r);
    if (bad) return true;
  }
  return false;
}
/**
 * M97: the built-ins pure code relies on (and the global object itself): a write to one of them (`Map.prototype.get =
 * ...`, `globalThis.Set = ...`) changes what every module computes. Host state such as `process.exitCode = 1` in a CLI
 * entry point is not a patch (and the target cannot read `process` at all: test_target_io).
 */
const PATCHABLE = new Set([...PURE_GLOBALS, ...LOCAL_TIME_GLOBALS, "globalThis", "global", "window", "self", "Reflect", "Proxy", "Symbol", "Promise", "WeakMap", "WeakSet", "WeakRef", "Function", "ArrayBuffer", "DataView", "Uint8Array", "Buffer", "TextEncoder", "TextDecoder", "URL", "URLSearchParams", "structuredClone"]);
const VALUE_GLOBALS = new Set(["undefined", "NaN", "Infinity"]);
const PATCH_CALLS = new Set(["defineProperty", "defineProperties", "setPrototypeOf", "assign", "freeze", "seal", "preventExtensions", "set", "deleteProperty"]);
/**
 * M97: in this module, a write to a global (`Map.prototype.get = ...`, `Object.defineProperty(Set.prototype, ...)`).
 * Auditor #466: through aliases too. A name bound anywhere in the module (variable, destructuring, assignment) to a
 * value rooted in a patchable global (`const P = Set.prototype`, `const O = Object`, `const { defineProperty } =
 * Object`, `const G = globalThis`), transitively, is that global; and a call of a PATCH_CALLS function reached through
 * any such name (`O.defineProperty(..)`, `R.set(..)`, `defineProperty(..)`, `Object["assign"](..)`,
 * `Object.defineProperty.call(..)`) with a global or alias argument is a patch.
 */
function patchesGlobal(sf: ts.SourceFile): boolean {
  const idx = indexModule(sf);
  const aliases = new Set<string>();
  const rootOf = (e: ts.Expression): ts.Expression => {
    let x = e;
    for (;;) {
      x = unwrapExpr(x);
      if (ts.isPropertyAccessExpression(x) || ts.isElementAccessExpression(x)) x = x.expression;
      else if (ts.isBinaryExpression(x) && (x.operatorToken.kind === ts.SyntaxKind.BarBarToken || x.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken || x.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken || x.operatorToken.kind === ts.SyntaxKind.CommaToken)) return x;
      else return x;
    }
  };
  const globalRooted = (e: ts.Expression | undefined): boolean => {
    if (!e) return false;
    const x = unwrapExpr(e);
    if (ts.isConditionalExpression(x)) return globalRooted(x.whenTrue) || globalRooted(x.whenFalse);
    if (ts.isBinaryExpression(x) && (x.operatorToken.kind === ts.SyntaxKind.BarBarToken || x.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken || x.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken || x.operatorToken.kind === ts.SyntaxKind.CommaToken || x.operatorToken.kind === ts.SyntaxKind.EqualsToken)) return globalRooted(x.left) || globalRooted(x.right);
    if (ts.isCallExpression(x) && ts.isPropertyAccessExpression(x.expression) && ["getPrototypeOf", "getOwnPropertyDescriptor", "bind"].includes(x.expression.name.text)) return true;
    const r = rootOf(x);
    // `undefined` / `NaN` / `Infinity` are primitive values, not objects anything could be written on.
    return ts.isIdentifier(r) && ((PATCHABLE.has(r.text) && !VALUE_GLOBALS.has(r.text) && unshadowed(idx, r.text)) || aliases.has(r.text));
  };
  const isGlobal = (e: ts.Expression) => globalRooted(e);
  // Fixpoint over every binding in the module (scopes are not tracked: a same-named local counts too, conservatively).
  for (let changed = true; changed;) {
    changed = false;
    const bind = (name: ts.BindingName, init: ts.Expression | undefined, whole: boolean): void => {
      if (ts.isIdentifier(name)) { if ((whole && globalRooted(init)) && !aliases.has(name.text)) { aliases.add(name.text); changed = true; } return; }
      for (const el of name.elements) if (!ts.isOmittedExpression(el)) bind(el.name, init, true);
    };
    const v = (n: ts.Node): void => {
      if (ts.isVariableDeclaration(n) || ts.isParameter(n) || ts.isBindingElement(n) || ts.isPropertyDeclaration(n)) {
        const init = (n as { initializer?: ts.Expression }).initializer;
        if (n.name && !ts.isComputedPropertyName(n.name) && !ts.isStringLiteral(n.name) && !ts.isNumericLiteral(n.name) && !ts.isPrivateIdentifier(n.name) && !ts.isNoSubstitutionTemplateLiteral(n.name) && !ts.isBigIntLiteral(n.name)) bind(n.name, init, true);
      }
      if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.EqualsToken && globalRooted(n.right)) {
        const l = unwrapExpr(n.left);
        if (ts.isIdentifier(l) && !aliases.has(l.text)) { aliases.add(l.text); changed = true; }
        if (ts.isObjectLiteralExpression(l) || ts.isArrayLiteralExpression(l)) { const names: string[] = []; const c = (x: ts.Node): void => { if (ts.isIdentifier(x)) names.push(x.text); else ts.forEachChild(x, c); }; c(l); for (const k of names) if (!aliases.has(k)) { aliases.add(k); changed = true; } }
      }
      ts.forEachChild(n, v);
    };
    v(sf);
  }
  const patchCallee = (e: ts.Expression): boolean => {
    const x = unwrapExpr(e);
    if (ts.isIdentifier(x)) return aliases.has(x.text) || (PATCHABLE.has(x.text) && unshadowed(idx, x.text) && false);
    if (ts.isPropertyAccessExpression(x)) {
      const m = x.name.text;
      if ((m === "call" || m === "apply") && patchCallee(x.expression)) return true;
      return PATCH_CALLS.has(m) && globalRooted(x.expression);
    }
    if (ts.isElementAccessExpression(x)) return globalRooted(x.expression);
    return false;
  };
  let bad = false;
  const v = (n: ts.Node): void => {
    if (bad) return;
    if (ts.isBinaryExpression(n) && n.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && n.operatorToken.kind <= ts.SyntaxKind.LastAssignment && !ts.isIdentifier(unwrapExpr(n.left)) && isGlobal(n.left)) bad = true;
    else if (ts.isBinaryExpression(n) && n.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && n.operatorToken.kind <= ts.SyntaxKind.LastAssignment && ts.isIdentifier(unwrapExpr(n.left)) && PATCHABLE.has((unwrapExpr(n.left) as ts.Identifier).text) && unshadowed(idx, (unwrapExpr(n.left) as ts.Identifier).text)) bad = true;
    else if (ts.isDeleteExpression(n) && isGlobal(n.expression)) bad = true;
    else if ((ts.isPrefixUnaryExpression(n) || ts.isPostfixUnaryExpression(n)) && (n.operator === ts.SyntaxKind.PlusPlusToken || n.operator === ts.SyntaxKind.MinusMinusToken) && !ts.isIdentifier(unwrapExpr(n.operand)) && isGlobal(n.operand)) bad = true;
    else if (ts.isCallExpression(n) && patchCallee(n.expression) && n.arguments.some((g) => isGlobal(g))) bad = true;
    else ts.forEachChild(n, v);
  };
  v(sf);
  return bad;
}
/**
 * M97: `if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) { ... }` (no else): an `&&`
 * chain where one conjunct compares (=== / ==) a side naming `import.meta.url` (and no `process`) with a side naming
 * `process.argv[1]` (and no `import.meta`), every other conjunct reads only `process.argv`, and every other identifier
 * in the condition is a named import from a Node builtin module (`pathToFileURL`, `fileURLToPath`, `resolve`, ...).
 * Nothing module-defined can make it true for a module the test imports.
 */
function isMainGuard(st: ts.Statement, idx: ModuleIndex): boolean {
  if (!ts.isIfStatement(st) || st.elseStatement) return false;
  const conj: ts.Expression[] = [];
  const split = (e: ts.Expression): void => { if (ts.isBinaryExpression(e) && e.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) { split(e.left); split(e.right); } else if (ts.isParenthesizedExpression(e)) split(e.expression); else conj.push(e); };
  split(st.expression);
  let metaNames = 0, argvNames = 0, other = false;
  const scan = (n: ts.Node): void => {
    if (ts.isPropertyAccessExpression(n) && ts.isMetaProperty(n.expression) && n.expression.keywordToken === ts.SyntaxKind.ImportKeyword && n.expression.name.text === "meta" && n.name.text === "url") { metaNames++; return; }
    if (ts.isMetaProperty(n)) { other = true; return; }
    if (ts.isPropertyAccessExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === "process" && n.name.text === "argv" && unshadowed(idx, "process")) { argvNames++; return; }
    if (ts.isIdentifier(n) && isValueReference(n)) { const imp = idx.imports.get(n.text); if (!imp || imp.typeOnly || !NODE_BUILTINS.test(imp.spec)) other = true; }
    ts.forEachChild(n, scan);
  };
  const count = (e: ts.Node) => { metaNames = 0; argvNames = 0; other = false; scan(e); return { meta: metaNames, argv: argvNames, other }; };
  let cmp = 0;
  for (const c of conj) {
    if (ts.isBinaryExpression(c) && (c.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken || c.operatorToken.kind === ts.SyntaxKind.EqualsEqualsToken)) {
      const l = count(c.left), r = count(c.right);
      if (l.other || r.other) return false;
      if ((l.meta > 0 && l.argv === 0 && r.argv > 0 && r.meta === 0) || (r.meta > 0 && r.argv === 0 && l.argv > 0 && l.meta === 0)) { cmp++; continue; }
      return false;
    }
    const x = count(c);
    if (x.other || x.meta || !x.argv) return false;
  }
  return cmp === 1;
}
/** M97: bound on the modules of the v7 closure walk (more is refused, test_target_too_large). */
const MAX_V7_CLOSURE = 64;
/**
 * M97 (v7 hardening, the v6 lessons carried over to every target only v7 accepts): walk the relative value and
 * side-effect import closure of the target module (type-only imports skipped, at most MAX_V7_CLOSURE modules).
 * - `test_target_impure` when any module but the target imports or re-exports the target module back (the v6
 *   import-back guard), or when any module of the closure (the target's included) writes a global anywhere
 *   (`Map.prototype.get = ...`, `Object.defineProperty(Set.prototype, ...)`, `globalThis.Map = ...`);
 * - `test_target_io` when a module has a relative import that is not exactly one readable `.ts` module (`./c.mjs`,
 *   `./c.js` with no c.ts, `./data.json`: code the walk cannot see), `import x = require(...)` anywhere, or `require(...)`
 *   / dynamic `import(...)` in load-time code. Load-time code (the v6 load-time reach walk, across modules): every
 *   top-level statement other than a function declaration of every closure module, plus every top-level function such
 *   code names, transitively, following named imports into the closure module that declares them (a namespace or
 *   default import reaches its whole module). The target and what it calls are the purity walk's (import() and
 *   require are test_target_io there already). A dynamic import in a function nothing loads stays unreached.
 */
function v7ClosureProblem(v: V2Ctx): string | null {
  const root = v.modules.get(v.root);
  if (!root) return TEST_TARGET_IMPURE;
  const mods = new Map<string, { sf: ts.SourceFile; idx: ModuleIndex; deps: Map<string, string> }>();
  const seen = new Set<string>([v.root]);
  const queue = [v.root];
  while (queue.length) {
    const p = queue.shift()!;
    const text = p === v.root ? root.sf.text : v.read(p);
    if (text === null) return TEST_TARGET_IO;
    const m = p === v.root ? root.sf : ts.createSourceFile(p, text, ts.ScriptTarget.Latest, true);
    const idx = p === v.root ? root.idx : indexModule(m);
    let eq = false;
    const seeEq = (n: ts.Node): void => { if (eq) return; if (ts.isImportEqualsDeclaration(n) && ts.isExternalModuleReference(n.moduleReference)) eq = true; else ts.forEachChild(n, seeEq); };
    seeEq(m);
    if (eq) return TEST_TARGET_IO;
    if (patchesGlobal(m)) return TEST_TARGET_IMPURE;
    const deps = new Map<string, string>();
    for (const s of m.statements) {
      if (!(ts.isImportDeclaration(s) || ts.isExportDeclaration(s)) || !s.moduleSpecifier || !ts.isStringLiteral(s.moduleSpecifier)) continue;
      const spec = s.moduleSpecifier.text;
      if (!/^\.\.?\//.test(spec)) continue;
      const typeOnly = ts.isImportDeclaration(s) ? !!s.importClause?.isTypeOnly : s.isTypeOnly;
      const hits = (siblingCandidates(p, spec) ?? []).filter((c) => c === v.root || v.read(c) !== null);
      if (p !== v.root && hits.includes(v.root)) return TEST_TARGET_IMPURE;
      if (typeOnly) continue;
      if (hits.length !== 1) return TEST_TARGET_IO;
      deps.set(spec, hits[0]!);
      for (const c of hits) if (!seen.has(c)) { seen.add(c); if (seen.size > MAX_V7_CLOSURE) return TEST_TARGET_TOO_LARGE; queue.push(c); }
    }
    mods.set(p, { sf: m, idx, deps });
  }
  // Load-time reach across the closure: work items are (module, top-level function name) or (module, "*" = all of it).
  const done = new Set<string>();
  const work: [string, string][] = [];
  let loads = false;
  // Per module: top-level classes and `const` function-valued declarations, walked only when named.
  const lazy = new Map<string, Map<string, ts.Node>>();
  const lazyOf = (p: string): Map<string, ts.Node> => {
    let l = lazy.get(p);
    if (l) return l;
    l = new Map();
    for (const st of mods.get(p)?.sf.statements ?? []) {
      if (ts.isClassDeclaration(st) && st.name) l.set(st.name.text, st);
      if (ts.isVariableStatement(st) && (st.declarationList.flags & ts.NodeFlags.Const) !== 0)
        for (const d of st.declarationList.declarations) { const x = d.initializer && ts.isParenthesizedExpression(d.initializer) ? d.initializer.expression : d.initializer; if (ts.isIdentifier(d.name) && x && (ts.isArrowFunction(x) || ts.isFunctionExpression(x))) l.set(d.name.text, d); }
    }
    lazy.set(p, l);
    return l;
  };
  const reachName = (p: string, name: string) => { const k = `${p}\0${name}`; if (!done.has(k)) { done.add(k); work.push([p, name]); } };
  const visit = (p: string, n: ts.Node): void => {
    if (loads) return;
    if (ts.isTypeNode(n) || ts.isInterfaceDeclaration(n) || ts.isTypeAliasDeclaration(n)) return; // types never run
    const m = mods.get(p)!;
    if (ts.isCallExpression(n) && (n.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(n.expression) && n.expression.text === "require"))) { loads = true; return; }
    if (ts.isIdentifier(n) && isValueReference(n)) {
      if (m.idx.fns.has(n.text) || lazyOf(p).has(n.text)) reachName(p, n.text);
      const imp = m.idx.imports.get(n.text);
      const dep = imp && !imp.typeOnly ? m.deps.get(imp.spec) : undefined;
      if (imp && dep) reachName(dep, imp.imported && imp.imported !== "default" ? imp.imported : "*");
    }
    ts.forEachChild(n, (c) => visit(p, c));
  };
  for (const [p, m] of mods) for (const st of m.sf.statements) {
    if (ts.isFunctionDeclaration(st) || ts.isImportDeclaration(st)) continue;
    // A class body runs at load only in its heritage clause, decorators, computed names and static parts; its
    // constructor, instance initializers and methods run when reached code names the class (then all of it is walked).
    if (ts.isClassDeclaration(st)) {
      for (const h of st.heritageClauses ?? []) visit(p, h);
      for (const d of ts.getDecorators(st) ?? []) visit(p, d);
      for (const mem of st.members) {
        if (mem.name && ts.isComputedPropertyName(mem.name)) visit(p, mem.name);
        if (ts.isClassStaticBlockDeclaration(mem) || (ts.isPropertyDeclaration(mem) && hasMod(mem, ts.SyntaxKind.StaticKeyword))) visit(p, mem);
      }
      continue;
    }
    // `const f = (..) => ..` / `function (..) {..}`: walked when named, like a function declaration.
    if (ts.isVariableStatement(st) && st.declarationList.declarations.every((d) => ts.isIdentifier(d.name) && lazyOf(p).has(d.name.text))) continue;
    // The ESM entry-point guard runs its block only when the module is the process's entry script, never under
    // the test runner (the test file is the entry): its condition is walked, its block is not load-time code.
    if (isMainGuard(st, m.idx)) visit(p, (st as ts.IfStatement).expression);
    else visit(p, st);
  }
  while (work.length && !loads) {
    const [p, name] = work.shift()!;
    const m = mods.get(p);
    if (!m) continue;
    if (name === "*") { for (const st of m.sf.statements) if (ts.isFunctionDeclaration(st) || ts.isClassDeclaration(st) || ts.isVariableStatement(st)) visit(p, st); continue; }
    for (const d of m.idx.fns.get(name) ?? []) visit(p, d);
    const lz = lazyOf(p).get(name);
    if (lz) visit(p, lz);
  }
  return loads ? TEST_TARGET_IO : null;
}
/** M97 (v7): the tested function returns `void` (a single declaration with that exact return type). */
export function voidTarget(content: string, fn: string): boolean {
  const sf = ts.createSourceFile("m.ts", content, ts.ScriptTarget.Latest, true);
  const decls = indexModule(sf).fns.get(fn) ?? [];
  return decls.length === 1 && decls[0]!.type?.kind === ts.SyntaxKind.VoidKeyword;
}
/**
 * M97 (v7, Job B): for a void target the graded test itself is held to the Job A rule: every reference to the function
 * is a call that is either the whole body of an arrow passed first to `assert.throws(..)`, or the first of exactly two
 * arguments of `assert.equal(.., undefined)`; at least one is the throws form. Null when fine.
 */
export function voidTestProblem(moduleContent: string, fn: string, testContent: string): string | null {
  if (!voidTarget(moduleContent, fn)) return null;
  const sf = ts.createSourceFile("t.ts", testContent, ts.ScriptTarget.Latest, true);
  let throwsN = 0;
  let bad = false;
  const isAssert = (e: ts.Expression, m: string) => ts.isPropertyAccessExpression(e) && ts.isIdentifier(e.expression) && e.expression.text === "assert" && e.name.text === m;
  const v = (n: ts.Node): void => {
    if (ts.isIdentifier(n) && n.text === fn && !ts.isImportSpecifier(n.parent)) {
      const call = n.parent;
      if (!ts.isCallExpression(call) || call.expression !== n) bad = true;
      else {
        const arrow = call.parent;
        const outer = arrow.parent;
        if (ts.isArrowFunction(arrow) && arrow.body === call && arrow.parameters.length === 0 && ts.isCallExpression(outer) && outer.arguments[0] === arrow && isAssert(outer.expression, "throws")) throwsN += 1;
        else if (ts.isCallExpression(arrow) && arrow.arguments.length === 2 && arrow.arguments[0] === call && isAssert(arrow.expression, "equal") && ts.isIdentifier(arrow.arguments[1]!) && arrow.arguments[1]!.text === "undefined") { /* is undefined */ }
        else bad = true;
      }
    }
    ts.forEachChild(n, v);
  };
  v(sf);
  return bad || throwsN === 0 ? "void-check-not-throws-or-undefined" : null;
}
/** M97: `n` sits, through array / object literals and parentheses only, in a call argument (`f(new Map(..))`,
 * `assert.deepEqual(r, new Map(..))`), never bound to a name the test could mutate (`const m = new Map(); m.set(..)`). */
function inCallArgument(n: ts.Node): boolean {
  let x = n;
  for (;;) {
    const p = x.parent;
    if (!p) return false;
    if (ts.isCallExpression(p)) return p.arguments.includes(x as ts.Expression);
    if (ts.isArrayLiteralExpression(p) || ts.isParenthesizedExpression(p) || ts.isObjectLiteralExpression(p) || (ts.isPropertyAssignment(p) && p.initializer === x)) { x = p; continue; }
    return false;
  }
}
/** M97 (v7, Job B): every `new Map(..)` / `new Set(..)` in the graded test is a bounded literal (isMapSetLiteral) in a call argument. */
export function mapSetTestProblem(testContent: string): string | null {
  const sf = ts.createSourceFile("t.ts", testContent, ts.ScriptTarget.Latest, true);
  let bad = false;
  const v = (n: ts.Node): void => {
    if (bad) return;
    // `new Map(..)` / `new Set(..)` return below before their callee is visited, so any other Map / Set / WeakMap /
    // WeakSet reference (`Map.groupBy`, `new WeakMap()`, an alias) lands here.
    if (ts.isIdentifier(n) && ["Map", "Set", "WeakMap", "WeakSet"].includes(n.text) && isValueReference(n)) { bad = true; return; }
    if (ts.isNewExpression(n) && ts.isIdentifier(n.expression) && (n.expression.text === "Map" || n.expression.text === "Set")) { if (!isMapSetLiteral(n) || !inCallArgument(n)) bad = true; return; }
    ts.forEachChild(n, v);
  };
  v(sf);
  return bad ? "map-set-not-literal" : null;
}

export interface ExistingTestTask extends TestTask { id: string }
export interface ExistingTestEdit { path: string; content: string; create: true; selfGrade: true }

/** Reads the header and the bullets. A Fix line belongs to ADD_TEST_CASE: refused here. Null when unreadable. */
export function parseExistingTestTask(trigger: string, objective: string): ExistingTestTask | null {
  const lines = objective.split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.some((l) => FIX_LINE.test(l))) return null;
  const head = lines.findIndex((l) => new RegExp(trigger, "i").test(l));
  if (head < 0) return null;
  const g = new RegExp(trigger, "i").exec(lines[head]!)!.groups ?? {};
  if (!g.symbol || !g.file) return null;
  const bullets = lines.slice(head + 1).filter((l) => /^[-*] /.test(l));
  // The test file's id: a hash of the task (file, function, checks), so it is stable and never a real commit.
  const id = createHash("sha256").update(["test-existing", g.file, g.symbol, ...bullets].join("\0")).digest("hex").slice(0, 40);
  // The M12 parser reads the checks; it is handed a header it accepts and the id as its fix line.
  const t = parseTestTask(String.raw`^add test for (?<symbol>[A-Za-z_$][\w$]*) in (?<file>[\w./-]+\.ts)(?: ?: (?<title>[^\n]{1,120}?))?$`, [`add test for ${g.symbol} in ${g.file}${g.title ? `: ${g.title.trim()}` : ""}`, `Fix: ${id}`, ...bullets].join("\n"));
  if (!t) return null;
  return { ...t, id };
}

function validParams(params: Record<string, string | string[]>): boolean {
  if (Object.keys(params).sort().join(",") !== [...TEST_EXISTING_PARAM_KEYS].join(",")) return false;
  for (const k of TEST_EXISTING_PARAM_KEYS) {
    const v = params[k];
    if (k === "maxLines") { if (typeof v !== "string" || !/^[1-9][0-9]?$/.test(v) || Number(v) < 3) return false; continue; }
    if (k === "checks") { if (!Array.isArray(v) || v.length === 0 || new Set(v).size !== v.length || !v.every((x) => (TEST_EXISTING_VOCAB.checks as readonly string[]).includes(x))) return false; continue; }
    if (typeof v !== "string" || !(TEST_EXISTING_VOCAB[k] as readonly string[]).includes(v)) return false;
  }
  return true;
}
export const validTestExistingParams = (p: Record<string, unknown>, minedFrom: unknown): boolean => minedFrom === "public" && validParams(p as Record<string, string | string[]>);

const parseCheck = (text: string): ts.Expression | null => {
  const sf = ts.createSourceFile("e.ts", `(${text});`, ts.ScriptTarget.Latest, true);
  const st = sf.statements;
  if (st.length !== 1 || !ts.isExpressionStatement(st[0]!) || (sf as unknown as { parseDiagnostics: unknown[] }).parseDiagnostics.length) return null;
  const e = (st[0] as ts.ExpressionStatement).expression;
  return ts.isParenthesizedExpression(e) ? e.expression : null;
};

export function buildExistingTestEdit(params: Record<string, string | string[]>, task: ExistingTestTask, files: readonly { path: string; content: string }[], isTest: (p: string) => boolean = (p) => /\.test\.ts$/.test(p), why?: { reason?: string }, scan?: readonly RepoFile[]): ExistingTestEdit | null {
  const no = (r: string) => { if (why) why.reason = r; return null; };
  if (!validParams(params)) return no("bad_rule_params");
  if (!plainPath(task.file)) return no("path_not_plain");
  if (isProtected(task.file)) return no(SELF_PROTECTED_PATH);
  const target = files.find((f) => f.path === task.file);
  if (!target || isTest(target.path) || !/\.ts$/.test(target.path) || /\.d\.ts$/.test(target.path)) return no("target_file_not_found");
  // M90: v4 is the v3 target widened (below), with v3's checks and args mode. M91: v5 is v4 widened likewise.
  // M97: v7 is v6 widened (Map / Set, void) with its own args mode (plain-data-v7: v3 plus Map / Set literals).
  const v7 = params.target === "exported-pure-function-v7";
  const v6 = params.target === "exported-pure-function-v6" || v7;
  const v5 = params.target === "exported-pure-function-v5" || v6;
  const v4 = params.target === "exported-pure-function-v4" || v5;
  const v3 = params.target === "exported-pure-function-v3" || v4;
  const v2 = params.target === "exported-pure-function-v2" || v3;
  // Auditor (c): `files` is the context list (the target and its sibling reads come only from it); the shared-binding
  // scan checks `scan` (repoFileLists' scan list: in-scope files, test files and denied files included), else `files`.
  const sib = { read: (rel: string) => files.find((f) => f.path === rel && !isTest(f.path))?.content ?? null };
  const repoAll = scan ?? files;
  const r = existingTargetRefusal(target.path, target.content, task.symbol, v2 ? { v2: sib, dates: v3, v4, v5, v6, v7, repo: repoAll } : { load: sib, repo: repoAll });
  if (r) return no(r);
  // M85: the v2 spec leaves a target the v1 spec already takes to v1 (one candidate per task, never two).
  if (v2 && existingTargetRefusal(target.path, target.content, task.symbol, { load: sib, repo: repoAll }) === null) return no("not_needed");
  // M88: likewise v3 leaves a target v2 already takes to v2.
  if (v3 && existingTargetRefusal(target.path, target.content, task.symbol, { v2: sib, repo: repoAll }) === null) return no("not_needed");
  // M90: and v4 leaves a target v3 already takes to v3.
  if (v4 && existingTargetRefusal(target.path, target.content, task.symbol, { v2: sib, dates: true, repo: repoAll }) === null) return no("not_needed");
  // M91: and v5 leaves a target v4 already takes to v4.
  if (v5 && existingTargetRefusal(target.path, target.content, task.symbol, { v2: sib, dates: true, v4: true, repo: repoAll }) === null) return no("not_needed");
  // M93: and v6 leaves a target v5 already takes to v5.
  if (v6 && existingTargetRefusal(target.path, target.content, task.symbol, { v2: sib, dates: true, v4: true, v5: true, repo: repoAll }) === null) return no("not_needed");
  // M97: and v7 leaves a target v6 already takes to v6.
  if (v7 && existingTargetRefusal(target.path, target.content, task.symbol, { v2: sib, v6: true, repo: repoAll }) === null) return no("not_needed");
  // M97 (v7): a void target's checks are `throws CODE` or `is undefined`, at least one `throws` (the stub returns a
  // value, so a test with no `throws` would be graded on that artifact alone).
  if (v7 && voidTarget(target.content, task.symbol) && (!task.checks.every((c) => c.kind === "throws" || (c.kind === "equal" && c.value === "undefined")) || !task.checks.some((c) => c.kind === "throws"))) return no(TEST_CHECK_REFUSED);
  // M93 (v6): a `= process.env` default must never run: every call in every check passes an object literal there.
  const envAt = v6 ? envDefaultParams(target.content, task.symbol) ?? [] : [];
  // Every check calls the target itself (the only name the test imports), with literal arguments.
  for (const c of task.checks) {
    if (!(params.checks as string[]).includes(c.kind)) return no(TEST_CHECK_REFUSED);
    const e = parseCheck(c.expr);
    if (!e || checkRoot(e, v3, v7) !== task.symbol) return no(TEST_CHECK_REFUSED);
    let calls = false;
    const v = (n: ts.Node): void => { if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === task.symbol) calls = true; ts.forEachChild(n, v); };
    v(e);
    if (!calls) return no(TEST_CHECK_REFUSED);
    if (envAt.length && !callsPassEnv(e, task.symbol, envAt)) return no(TEST_CHECK_REFUSED);
  }
  // M85 (v2): a check passing an object literal is written under the M20 object-argument grammar (plain bounded data).
  const objectArgs = !v3 && v2 && task.checks.some((c) => { const x = parseCheck(c.expr); let has = false; const w = (n: ts.Node) => { if (ts.isCallExpression(n) && n.arguments.some(ts.isObjectLiteralExpression)) has = true; ts.forEachChild(n, w); }; if (x) w(x); return has; });
  // M88 gap 1 (v2): objects only inside array arguments (`f([{ a: 1 }])`) get the same bounded object grammar
  // through the internal nested mode (the M20 `object-literal` mode keeps its direct-argument trigger unchanged).
  const nestedObjects = !v3 && v2 && !objectArgs && task.checks.some((c) => { const x = parseCheck(c.expr); let has = false; const w = (n: ts.Node) => { if (ts.isCallExpression(n) && n.arguments.some((g) => ts.isArrayLiteralExpression(g) && g.elements.some(ts.isObjectLiteralExpression))) has = true; ts.forEachChild(n, w); }; if (x) w(x); return has; });
  // M88 (v3): one internal args mode (never selectable by a spec's params): bounded plain-data objects, including
  // objects nested inside array arguments, and Date literals as arguments and expected values.
  const testParams = { assert: params.assert as string, checks: params.checks as string[], framework: params.framework as string, grading: "fail-before-pass-after", matcher: params.matcher as string, maxLines: params.maxLines as string, placement: "new-file", ...(v7 ? { args: ARGS_PLAIN_DATA_V7 } : v3 ? { args: ARGS_PLAIN_DATA_V3 } : objectArgs ? { args: "object-literal" } : nestedObjects ? { args: ARGS_NESTED_OBJECTS } : {}) };
  const title = task.title ?? `${task.symbol} characterization`;
  const test = buildTestEdit(testParams, { ...task, title, fixSha: task.id }, files, isTest);
  if (!test) return no("test_refused");
  if (!plainPath(test.path)) return no("path_not_plain");
  // Auditor #466 (4th review), every version: a parameter feeding `new Date(x)` gets ISO text with Z / an offset or a
  // date-only date in every call; a Date literal only as a whole argument for a parameter typed Date (dateArgProblem).
  if (dateTestProblem(target.content, task.symbol, test.content, task.symbol) !== null) return no(TEST_CHECK_REFUSED);
  return { path: test.path, content: test.content, create: true, selfGrade: true };
}

/** Direct entry, behind its own flag (proposal-off-wired); Job A uses runExistingTestRule via the approved list. */
export function applyExistingTestRule(trigger: string, params: Record<string, string | string[]>, objective: string, files: readonly { path: string; content: string }[], isTest?: (p: string) => boolean, env: Record<string, string | undefined> = process.env, why?: { reason?: string }): ExistingTestEdit | null {
  if (!testExistingEnabled(env)) return null;
  return runExistingTestRule(trigger, params, objective, files, isTest, why);
}

/** Job A entry: admitted only via the hash-pinned approved list (Peace /approve-rule); reasons for refusal lines. */
export function runExistingTestRule(trigger: string, params: Record<string, string | string[]>, objective: string, files: readonly { path: string; content: string }[], isTest?: (p: string) => boolean, why?: { reason?: string }, scan?: readonly RepoFile[]): ExistingTestEdit | null {
  const task = parseExistingTestTask(trigger, objective);
  if (!task) { if (why) why.reason = "task_unparsed"; return null; }
  return buildExistingTestEdit(params, task, files, isTest, why, scan);
}

/**
 * Job B: the repo files a module may load (relative imports, re-exports, `import("...")` types and literal dynamic
 * imports, transitively, type-only included), for the confined run's read list. Null (fail closed) when a relative
 * specifier does not resolve to exactly one regular in-tree file, a non-literal dynamic import, require or
 * import-equals appears, or the set exceeds `max` files.
 */
export function moduleReadClosure(start: string, read: (rel: string) => string | null, max = 200): string[] | null {
  const seen = new Set<string>();
  const queue = [start];
  const norm = (p: string): string | null => {
    const out: string[] = [];
    for (const s of p.split("/")) { if (s === "" || s === ".") continue; if (s === "..") { if (!out.length) return null; out.pop(); } else out.push(s); }
    return out.join("/");
  };
  while (queue.length) {
    const p = queue.pop()!;
    if (seen.has(p)) continue;
    seen.add(p);
    if (seen.size > max) return null;
    const text = read(p);
    if (text === null) return null;
    const sf = ts.createSourceFile(p, text, ts.ScriptTarget.Latest, true);
    let bad = false;
    const specs: string[] = [];
    const v = (n: ts.Node): void => {
      if ((ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) && n.moduleSpecifier && ts.isStringLiteral(n.moduleSpecifier)) specs.push(n.moduleSpecifier.text);
      // A dynamic import with a literal specifier joins the closure (it may never run; if it does, it can load);
      // any other dynamic import, require or import-equals fails closed.
      if (ts.isCallExpression(n) && n.expression.kind === ts.SyntaxKind.ImportKeyword) { const a = n.arguments[0]; if (n.arguments.length >= 1 && a && ts.isStringLiteral(a)) specs.push(a.text); else bad = true; }
      if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === "require") bad = true;
      if (ts.isImportTypeNode(n) && ts.isLiteralTypeNode(n.argument) && ts.isStringLiteral(n.argument.literal)) specs.push(n.argument.literal.text);
      if (ts.isImportEqualsDeclaration(n)) bad = true;
      ts.forEachChild(n, v);
    };
    v(sf);
    if (bad) return null;
    const dir = p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "";
    for (const s of specs) {
      if (!s.startsWith("./") && !s.startsWith("../")) continue;
      const base = norm(`${dir}/${s}`);
      if (base === null) return null;
      const hits = [base, `${base}.ts`, `${base}/index.ts`, ...(/\.js$/.test(base) ? [base.replace(/\.js$/, ".ts")] : [])].filter((c) => /\.ts$/.test(c) && read(c) !== null);
      if (hits.length !== 1) return null;
      queue.push(hits[0]!);
    }
  }
  return [...seen].sort();
}
/** Auditor #466 (3rd review): the load allowlist verdict for a module (diagnostics, proofs and census tooling). */
export function loadAllowlistDetail(path: string, content: string, read: ((rel: string) => string | null) | null, all?: LoadProblem[]): LoadProblem | null {
  const sf = ts.createSourceFile(path, content, ts.ScriptTarget.Latest, true);
  return loadAllowlistProblem(path, sf, indexModule(sf), read ? (rel) => (rel === path ? content : read(rel)) : null, all);
}
