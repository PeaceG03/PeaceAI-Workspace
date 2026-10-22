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
import { ARGS_NESTED_OBJECTS, ARGS_PLAIN_DATA_V3, buildTestEdit, checkRoot, FIX_LINE, parseTestTask, type TestTask } from "./learned-test.ts";
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
  target: ["exported-pure-function", "exported-pure-function-v2", "exported-pure-function-v3", "exported-pure-function-v4", "exported-pure-function-v5", "exported-pure-function-v6"],
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
const MUTATORS = new Set(["push", "pop", "shift", "unshift", "splice", "sort", "reverse", "fill", "copyWithin", "set", "add", "delete", "clear"]);
const FRESH_METHODS = new Set(["slice", "map", "filter", "concat", "split", "flat", "flatMap", "toSorted", "toReversed", "toSpliced", "with", "keys", "values", "entries", "match", "matchAll"]);
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

interface Analysis { reasons: Set<string>; fns: Set<string>; consts: Set<string>; idx: ModuleIndex; sf: ts.SourceFile; v2?: V2Ctx }
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
  const a = analysisFor(v2, idx, sf);
  for (const s of sf.statements) {
    if (ts.isExpressionStatement(s)) {
      analyzeExpression(a, s.expression);
    } else if (ts.isEnumDeclaration(s)) {
      for (const mem of s.members) if (mem.initializer) analyzeExpression(a, mem.initializer);
    } else if (ts.isVariableStatement(s)) {
      for (const d of s.declarationList.declarations) {
        if (!d.initializer) continue;
        const dr = dateRefusal(d.initializer);
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

/** Fresh: a value created inside the function (so mutating it touches nothing outside). */
function isFresh(e: ts.Expression | undefined, fresh: ReadonlySet<string>): boolean {
  if (!e) return false;
  const x = ts.isParenthesizedExpression(e) || ts.isAsExpression(e) || ts.isSatisfiesExpression(e) || ts.isNonNullExpression(e) ? e.expression : e;
  if (ts.isArrayLiteralExpression(x) || ts.isObjectLiteralExpression(x) || ts.isRegularExpressionLiteral(x)) return true;
  if (ts.isNewExpression(x) && ts.isIdentifier(x.expression) && PURE_NEW.has(x.expression.text)) return true;
  if (ts.isIdentifier(x)) return fresh.has(x.text);
  if (ts.isCallExpression(x) && ts.isPropertyAccessExpression(x.expression)) {
    const m = x.expression.name.text; const recv = x.expression.expression;
    if (ts.isIdentifier(recv) && (recv.text === "Array" && (m === "from" || m === "of"))) return true;
    if (ts.isIdentifier(recv) && recv.text === "Object" && (m === "keys" || m === "values" || m === "entries" || m === "fromEntries")) return true;
    if (FRESH_METHODS.has(m)) return true;
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
    analyzeExpression(a, a.idx.consts.get(name)!.initializer!);
    return;
  }
  if (a.idx.enums.has(name)) { if (a.v2) noteEnum(a.v2, a.idx, a.sf, name); return; }
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

function analyzeFunction(a: Analysis, f: ts.FunctionLikeDeclaration, envDefaults: ReadonlySet<ts.ParameterDeclaration> = new Set()): void {
  const add = (r: string) => a.reasons.add(r);
  if (hasMod(f, ts.SyntaxKind.AsyncKeyword) || f.asteriskToken) add(TEST_TARGET_ASYNC);
  if (!f.body) { add(TEST_TARGET_IMPURE); return; }
  const dr = dateRefusal(f.body);
  if (dr === DATE_NOW || dr === DATE_LOCAL_TIME) add(TEST_TARGET_DATE_LOCAL);
  else if (dr === DATE_SETTER) add(TEST_TARGET_IMPURE);
  // Names declared anywhere inside the function (its params, locals, nested params): resolved locally.
  const locals = new Set<string>();
  const fresh = new Set<string>();
  const collect = (b: ts.BindingName) => { if (ts.isIdentifier(b)) locals.add(b.text); else for (const el of b.elements) if (!ts.isOmittedExpression(el)) collect(el.name); };
  const declare = (n: ts.Node): void => {
    if (ts.isParameter(n) || ts.isBindingElement(n)) collect(n.name);
    if (ts.isVariableDeclaration(n)) { collect(n.name); if (ts.isIdentifier(n.name) && isFresh(n.initializer, fresh)) fresh.add(n.name.text); }
    if ((ts.isFunctionDeclaration(n) || ts.isFunctionExpression(n)) && n.name && n !== f) locals.add(n.name.text);
    if (ts.isCatchClause(n) && n.variableDeclaration) collect(n.variableDeclaration.name);
    if (ts.isClassDeclaration(n) || ts.isClassExpression(n)) add(TEST_TARGET_IMPURE);
    ts.forEachChild(n, declare);
  };
  f.parameters.forEach((p) => collect(p.name));
  declare(f.body);
  // A `let` that is ever re-pointed at a non-fresh value is not fresh.
  const unfresh = (n: ts.Node): void => {
    if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isIdentifier(n.left) && fresh.has(n.left.text) && !isFresh(n.right, fresh)) fresh.delete(n.left.text);
    ts.forEachChild(n, unfresh);
  };
  unfresh(f.body);
  const mutableTarget = (target: ts.Expression): boolean => {
    if (ts.isIdentifier(target)) return locals.has(target.text);
    if (ts.isArrayLiteralExpression(target) || ts.isObjectLiteralExpression(target)) return true; // destructuring: identifiers checked as references
    const r = rootName(target);
    return ts.isIdentifier(r) && fresh.has(r.text);
  };
  const resolve = (name: string): void => resolveName(a, name, locals);
  walk(a, f.body, resolve, mutableTarget, fresh);
  // M90: parameter defaults run at call time, so they get the body's rules (clock / local time / setters by name,
  // then the purity walk; nothing in a default may assign). Only adds refusals: v1-v3 accept no defaults on the
  // target, and a followed helper's default was previously not walked.
  for (const p of f.parameters) {
    if (!p.initializer) continue;
    // M93 (v6, tested function only): a `= process.env` default every check overrides (enforced by the callers).
    if (envDefaults.has(p)) continue;
    const pr = dateRefusal(p.initializer);
    if (pr === DATE_NOW || pr === DATE_LOCAL_TIME) add(TEST_TARGET_DATE_LOCAL);
    else if (pr === DATE_SETTER) add(TEST_TARGET_IMPURE);
    walk(a, p.initializer, resolve, () => false, fresh);
  }
}

/** A module const's initializer: the same rules with no locals (it runs once, at import). */
function analyzeExpression(a: Analysis, e: ts.Expression): void {
  const add = (r: string) => a.reasons.add(r);
  const dr = dateRefusal(e);
  if (dr === DATE_NOW || dr === DATE_LOCAL_TIME) add(TEST_TARGET_DATE_LOCAL);
  else if (dr === DATE_SETTER) add(TEST_TARGET_IMPURE);
  // Arrow/function initializers: analyzed as functions (a const helper).
  const x = ts.isParenthesizedExpression(e) ? e.expression : e;
  if (ts.isArrowFunction(x) || ts.isFunctionExpression(x)) { analyzeFunction(a, x); return; }
  // A stateful regex (g/y flags keep lastIndex between calls) is module state.
  const v = (n: ts.Node): void => { if (ts.isRegularExpressionLiteral(n) && /\/[a-z]*[gy][a-z]*$/.test(n.text)) add(TEST_TARGET_IMPURE); ts.forEachChild(n, v); };
  v(e);
  const resolve = (name: string): void => resolveName(a, name, new Set());
  walk(a, e, resolve, () => false, new Set());
}

function walk(a: Analysis, root: ts.Node, resolve: (name: string) => void, mutableTarget: (t: ts.Expression) => boolean, fresh: ReadonlySet<string>): void {
  const add = (r: string) => a.reasons.add(r);
  const v = (n: ts.Node): void => {
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
      if (!isMap && !(ts.isIdentifier(r) ? fresh.has(r.text) : isFresh(recv, fresh))) add(TEST_TARGET_IMPURE);
    }
    if (ts.isNewExpression(n) && !(ts.isIdentifier(n.expression) && PURE_NEW.has(n.expression.text))) add(TEST_TARGET_IMPURE);
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

export interface TargetInfo { decl: ts.FunctionDeclaration; params: { name: string; type: string }[]; ret: string }

/**
 * The named refusal for testing `fn` in module `content` (path `path`), or null when it is an exported, fully
 * typed, provably pure function. Exported for Job B (re-checked on the real tree before grading) and the tests.
 */
export function existingTargetRefusal(path: string, content: string, fn: string, opts?: { v2?: { read: (rel: string) => string | null }; dates?: boolean; v4?: boolean; v5?: boolean; v6?: boolean }): string | null {
  if (!plainPath(path)) return "path_not_plain";
  if (isProtected(path) || /\.test\.ts$/.test(path) || /\.d\.ts$/.test(path)) return SELF_PROTECTED_PATH;
  const sf = ts.createSourceFile(path, content, ts.ScriptTarget.Latest, true);
  if ((sf as unknown as { parseDiagnostics: unknown[] }).parseDiagnostics.length) return "edit_refused";
  const idx = indexModule(sf);
  const decls = idx.fns.get(fn) ?? [];
  if (decls.length === 0) return idx.consts.has(fn) || idx.mutable.has(fn) ? TEST_TARGET_SIGNATURE : TEST_TARGET_NOT_FOUND;
  if (decls.length !== 1 || !decls[0]!.body) return TEST_TARGET_SIGNATURE; // overloads
  const f = decls[0]!;
  if (!idx.exportNames.has(fn)) return TEST_TARGET_NOT_EXPORTED;
  if (hasMod(f, ts.SyntaxKind.AsyncKeyword) || f.asteriskToken) return TEST_TARGET_ASYNC;
  const ret = f.type?.getText(sf).trim() ?? "";
  if (/\b(?:Promise|PromiseLike|AsyncIterable|AsyncIterableIterator|AsyncGenerator)\b/.test(ret)) return TEST_TARGET_ASYNC;
  const reasons = new Set<string>();
  const v2: V2Ctx | undefined = opts?.v2 ? { path, root: path, depth: 0, read: (rel) => (rel === path ? content : opts.v2!.read(rel)), modules: new Map(), followed: new Set(), reasons, scanned: new Set(), dates: opts.dates === true || opts.v4 === true || opts.v5 === true || opts.v6 === true, v4: opts.v4 === true || opts.v5 === true || opts.v6 === true, v5: opts.v5 === true || opts.v6 === true, v6: opts.v6 === true } : undefined;
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
  const sigBad = paramTypeof || !!f.typeParameters?.length || !typeOk(f.type) || f.parameters.length > MAX_PARAMS || f.parameters.some((p) => !ts.isIdentifier(p.name) || p.dotDotDotToken || (!v2?.v4 && (p.questionToken || p.initializer)) || (p.questionToken && p.initializer) || (p.type ? !(v6Param(p) || typeOk(p.type)) : !(v2?.v4 && literalDefault(p.initializer))));
  if (sigBad) {
    if (v2) for (const r of PRIORITY) if (v2.reasons.has(r)) return r;
    return TEST_TARGET_SIGNATURE;
  }
  const cached = v2?.modules.get(path);
  const a: Analysis = { reasons: v2 ? v2.reasons : reasons, fns: cached ? cached.fns : new Set([fn]), consts: cached ? cached.consts : new Set(), idx, sf, v2 };
  if (v2) analyzeLoadedModule(v2, idx, sf);
  analyzeFunction(a, f, envDefaults);
  for (const r of PRIORITY) if (a.reasons.has(r)) return r;
  // M93 (Auditor #460): with an exempted `= process.env` default, only the test may call the target.
  if (envDefaults.size && v2 && envTargetReferenced(v2, fn, f, f.parameters.flatMap((p, i) => (envDefaults.has(p) ? [i] : [])))) return TEST_TARGET_IO;
  return null;
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

export function buildExistingTestEdit(params: Record<string, string | string[]>, task: ExistingTestTask, files: readonly { path: string; content: string }[], isTest: (p: string) => boolean = (p) => /\.test\.ts$/.test(p), why?: { reason?: string }): ExistingTestEdit | null {
  const no = (r: string) => { if (why) why.reason = r; return null; };
  if (!validParams(params)) return no("bad_rule_params");
  if (!plainPath(task.file)) return no("path_not_plain");
  if (isProtected(task.file)) return no(SELF_PROTECTED_PATH);
  const target = files.find((f) => f.path === task.file);
  if (!target || isTest(target.path) || !/\.ts$/.test(target.path) || /\.d\.ts$/.test(target.path)) return no("target_file_not_found");
  // M90: v4 is the v3 target widened (below), with v3's checks and args mode. M91: v5 is v4 widened likewise.
  const v6 = params.target === "exported-pure-function-v6";
  const v5 = params.target === "exported-pure-function-v5" || v6;
  const v4 = params.target === "exported-pure-function-v4" || v5;
  const v3 = params.target === "exported-pure-function-v3" || v4;
  const v2 = params.target === "exported-pure-function-v2" || v3;
  const sib = { read: (rel: string) => files.find((f) => f.path === rel && !isTest(f.path))?.content ?? null };
  const r = existingTargetRefusal(target.path, target.content, task.symbol, v2 ? { v2: sib, dates: v3, v4, v5, v6 } : undefined);
  if (r) return no(r);
  // M85: the v2 spec leaves a target the v1 spec already takes to v1 (one candidate per task, never two).
  if (v2 && existingTargetRefusal(target.path, target.content, task.symbol) === null) return no("not_needed");
  // M88: likewise v3 leaves a target v2 already takes to v2.
  if (v3 && existingTargetRefusal(target.path, target.content, task.symbol, { v2: sib }) === null) return no("not_needed");
  // M90: and v4 leaves a target v3 already takes to v3.
  if (v4 && existingTargetRefusal(target.path, target.content, task.symbol, { v2: sib, dates: true }) === null) return no("not_needed");
  // M91: and v5 leaves a target v4 already takes to v4.
  if (v5 && existingTargetRefusal(target.path, target.content, task.symbol, { v2: sib, dates: true, v4: true }) === null) return no("not_needed");
  // M93: and v6 leaves a target v5 already takes to v5.
  if (v6 && existingTargetRefusal(target.path, target.content, task.symbol, { v2: sib, dates: true, v4: true, v5: true }) === null) return no("not_needed");
  // M93 (v6): a `= process.env` default must never run: every call in every check passes an object literal there.
  const envAt = v6 ? envDefaultParams(target.content, task.symbol) ?? [] : [];
  // Every check calls the target itself (the only name the test imports), with literal arguments.
  for (const c of task.checks) {
    if (!(params.checks as string[]).includes(c.kind)) return no(TEST_CHECK_REFUSED);
    const e = parseCheck(c.expr);
    if (!e || checkRoot(e, v3) !== task.symbol) return no(TEST_CHECK_REFUSED);
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
  const testParams = { assert: params.assert as string, checks: params.checks as string[], framework: params.framework as string, grading: "fail-before-pass-after", matcher: params.matcher as string, maxLines: params.maxLines as string, placement: "new-file", ...(v3 ? { args: ARGS_PLAIN_DATA_V3 } : objectArgs ? { args: "object-literal" } : nestedObjects ? { args: ARGS_NESTED_OBJECTS } : {}) };
  const title = task.title ?? `${task.symbol} characterization`;
  const test = buildTestEdit(testParams, { ...task, title, fixSha: task.id }, files, isTest);
  if (!test) return no("test_refused");
  if (!plainPath(test.path)) return no("path_not_plain");
  return { path: test.path, content: test.content, create: true, selfGrade: true };
}

/** Direct entry, behind its own flag (proposal-off-wired); Job A uses runExistingTestRule via the approved list. */
export function applyExistingTestRule(trigger: string, params: Record<string, string | string[]>, objective: string, files: readonly { path: string; content: string }[], isTest?: (p: string) => boolean, env: Record<string, string | undefined> = process.env, why?: { reason?: string }): ExistingTestEdit | null {
  if (!testExistingEnabled(env)) return null;
  return runExistingTestRule(trigger, params, objective, files, isTest, why);
}

/** Job A entry: admitted only via the hash-pinned approved list (Peace /approve-rule); reasons for refusal lines. */
export function runExistingTestRule(trigger: string, params: Record<string, string | string[]>, objective: string, files: readonly { path: string; content: string }[], isTest?: (p: string) => boolean, why?: { reason?: string }): ExistingTestEdit | null {
  const task = parseExistingTestTask(trigger, objective);
  if (!task) { if (why) why.reason = "task_unparsed"; return null; }
  return buildExistingTestEdit(params, task, files, isTest, why);
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
