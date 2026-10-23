/**
 * M98 (public-existing-function-edit-v1, kind EXISTING_EDIT): one learned family with two parts.
 *
 *  G1  replace ONE statement inside an existing named function or class method (`in T in FILE: replace statement
 *      OLD with NEW`). OLD must match exactly one of the target's own statements token for token (nested functions
 *      and classes are never searched); NEW is 1..MAX_NEW_STATEMENTS statements from a bounded grammar.
 *  G2  the self-grading test: a NEW test file that drives the edited code (an exported function, or a method of a
 *      `new C(..)` of an exported class, async or not) with injected, recorded object-literal fakes only. It must fail
 *      before the edit by assertions only and pass after it (Job B, `selfGrade`).
 *
 * Why one family: a statement edit in IO code (the scanner chain) is only gradable by a fake-driven fail-before /
 * pass-after test, so G1 never ships without G2; the G2 grammar lives in its own section and is reusable.
 *
 * Everything fails closed (null): the edited module and every module it loads must be hermetic for the entries the
 * test calls (no clock, no local time, no environment, no timers, no global reads or writes outside GLOBAL_OK, no hidden
 * module state, no package imports except node:crypto createHash / createHmac), checked on BOTH the base and the edited
 * source; a capability default (`config.fetchImpl ?? fetch`, `config.now ?? (() => new Date())`) is accepted only when
 * the test injects that key. Job B repeats the check on the graded tree and runs the after-tree in three time zones.
 */
import { createHash } from "node:crypto";
import ts from "typescript";
import { PROTECTED_SELF } from "./selfchange.js";
import { importStyle } from "./learned-test.js";

export const EXISTING_EDIT_PARAM_KEYS = ["fakes", "grading", "io", "match", "paths", "statements", "target", "test"] as const;
export const EXISTING_EDIT_VOCAB: Record<(typeof EXISTING_EDIT_PARAM_KEYS)[number], readonly string[]> = {
  fakes: ["recorded-object-literal-v1"],
  grading: ["self-fail-before-pass-after-assertions"],
  io: ["injected-only-v1"],
  match: ["unique-statement"],
  paths: ["in-scope-source"],
  statements: ["bounded-grammar-v1"],
  target: ["named-function-or-class-method"],
  test: ["new-file-fake-driven"],
};
const NAME = String.raw`[A-Za-z_$][\w$]*`;
const FILE = String.raw`src/[\w./-]+\.ts`;
export const EXISTING_EDIT_TRIGGER = String.raw`^in (?<target>${NAME}(?:\.${NAME})?) in (?<file>${FILE}): replace statement (?<body>.+)$`;
export const MAX_OLD_CHARS = 400;
export const MAX_NEW_CHARS = 600;
export const MAX_NEW_STATEMENTS = 4;
export const MAX_BULLETS = 16;
export const MAX_MODULES = 40;
export const MAX_UNITS = 800;

export interface ExistingEdit { path: string; content: string; extra: { path: string; content: string; create: true }[]; selfGrade: true }
export type Read = (rel: string) => string | null;

/** Spec validation (learned.ts validateSpec): public-mined, exactly the param keys, each its one vocabulary value. */
export function validExistingEditParams(p: Record<string, unknown>, minedFrom: unknown): boolean {
  return minedFrom === "public" && okParams(p as Record<string, string | string[]>);
}

// ---------------------------------------------------------------------------------------------------------------
// shared parsing helpers
// ---------------------------------------------------------------------------------------------------------------
const diag = (sf: ts.SourceFile): number => (sf as unknown as { parseDiagnostics: unknown[] }).parseDiagnostics.length;

/** Statements of `text` parsed as the body of an async function (so `return` and `await` parse); null on any error. */
export function parseStatements(text: string): ts.Statement[] | null {
  if (text.includes("\n") || hasComment(text)) return null;
  const sf = ts.createSourceFile("s.ts", `async function __m98() {\n${text}\n}`, ts.ScriptTarget.Latest, true);
  if (diag(sf) || sf.statements.length !== 1) return null;
  const f = sf.statements[0]!;
  if (!ts.isFunctionDeclaration(f) || !f.body) return null;
  return [...f.body.statements];
}

/** Code tokens of a text (trivia dropped, a trailing `;` dropped), for token-wise statement matching. */
export function codeTokens(text: string): string[] {
  return scanCode(text).tokens;
}
/** True when the text holds a comment (scanned with regex / template rescans, so `"https://x"` is not one). */
export function hasComment(text: string): boolean {
  return scanCode(text).comments > 0;
}
function scanCode(text: string): { tokens: string[]; comments: number } {
  const sc = ts.createScanner(ts.ScriptTarget.Latest, false, ts.LanguageVariant.Standard, text);
  let comments = 0;
  const out: string[] = [];
  const braces: number[] = []; // brace depth per open template substitution
  let depth = 0;
  let prev: ts.SyntaxKind = ts.SyntaxKind.Unknown;
  const valueEnd = (k: ts.SyntaxKind) => k === ts.SyntaxKind.Identifier || k === ts.SyntaxKind.NumericLiteral || k === ts.SyntaxKind.StringLiteral || k === ts.SyntaxKind.CloseParenToken || k === ts.SyntaxKind.CloseBracketToken || k === ts.SyntaxKind.CloseBraceToken || k === ts.SyntaxKind.ThisKeyword || k === ts.SyntaxKind.RegularExpressionLiteral || k === ts.SyntaxKind.NoSubstitutionTemplateLiteral || k === ts.SyntaxKind.TemplateTail || k === ts.SyntaxKind.PlusPlusToken || k === ts.SyntaxKind.MinusMinusToken;
  for (let k = sc.scan(); k !== ts.SyntaxKind.EndOfFileToken; k = sc.scan()) {
    if (k === ts.SyntaxKind.WhitespaceTrivia || k === ts.SyntaxKind.NewLineTrivia || k === ts.SyntaxKind.ShebangTrivia || k === ts.SyntaxKind.ConflictMarkerTrivia) continue;
    if (k === ts.SyntaxKind.SingleLineCommentTrivia || k === ts.SyntaxKind.MultiLineCommentTrivia) { comments += 1; continue; }
    if ((k === ts.SyntaxKind.SlashToken || k === ts.SyntaxKind.SlashEqualsToken) && !valueEnd(prev)) k = sc.reScanSlashToken();
    else if (k === ts.SyntaxKind.TemplateHead) { braces.push(depth); depth = 0; }
    else if (k === ts.SyntaxKind.OpenBraceToken) depth += 1;
    else if (k === ts.SyntaxKind.CloseBraceToken) {
      if (depth === 0 && braces.length) {
        k = sc.reScanTemplateToken(false);
        if (k === ts.SyntaxKind.TemplateTail) depth = braces.pop()!;
      } else depth -= 1;
    }
    out.push(sc.getTokenText());
    prev = k;
  }
  while (out.length && out[out.length - 1] === ";") out.pop();
  return { tokens: out, comments };
}
const sameCode = (a: string, b: string): boolean => { const x = codeTokens(a), y = codeTokens(b); return x.length === y.length && x.every((t, i) => t === y[i]); };

const isFunctionLike = (n: ts.Node): n is ts.FunctionLikeDeclaration =>
  ts.isFunctionDeclaration(n) || ts.isMethodDeclaration(n) || ts.isConstructorDeclaration(n) || ts.isArrowFunction(n) || ts.isFunctionExpression(n) || ts.isGetAccessorDeclaration(n) || ts.isSetAccessorDeclaration(n);

// ---------------------------------------------------------------------------------------------------------------
// G1: the target, the statement site, the NEW grammar
// ---------------------------------------------------------------------------------------------------------------
export type Target = { kind: "function"; name: string; node: ts.FunctionDeclaration } | { kind: "method"; cls: string; name: string; node: ts.MethodDeclaration; classNode: ts.ClassDeclaration };

/** A module-level function declaration (exported or not) or a non-static, non-abstract method with a body of a top-level class. */
export function findTarget(sf: ts.SourceFile, target: string): Target | null {
  const [a, b] = target.split(".");
  const hits: Target[] = [];
  for (const st of sf.statements) {
    if (!b && ts.isFunctionDeclaration(st) && st.name?.text === a && st.body) hits.push({ kind: "function", name: a!, node: st });
    if (b && ts.isClassDeclaration(st) && st.name?.text === a) {
      for (const m of st.members) {
        if (!ts.isMethodDeclaration(m) || !m.body || !ts.isIdentifier(m.name) || m.name.text !== b) continue;
        if (m.modifiers?.some((x) => x.kind === ts.SyntaxKind.StaticKeyword || x.kind === ts.SyntaxKind.AbstractKeyword)) continue;
        hits.push({ kind: "method", cls: a!, name: b, node: m, classNode: st });
      }
    }
  }
  // overloads: only one body may carry the name
  if (!b) {
    const all = sf.statements.filter((s) => ts.isFunctionDeclaration(s) && s.name?.text === a);
    if (all.length !== 1) return null;
  }
  return hits.length === 1 ? hits[0]! : null;
}

/** The target's own statements: descends into blocks, if/else, loops, try/catch/finally, switch clauses, labels; never into nested functions or classes. */
export function ownStatements(body: ts.Block): ts.Statement[] {
  const out: ts.Statement[] = [];
  const visit = (s: ts.Statement): void => {
    out.push(s);
    if (ts.isBlock(s)) s.statements.forEach(visit);
    else if (ts.isIfStatement(s)) { visit(s.thenStatement); if (s.elseStatement) visit(s.elseStatement); }
    else if (ts.isForStatement(s) || ts.isForOfStatement(s) || ts.isForInStatement(s) || ts.isWhileStatement(s) || ts.isDoStatement(s) || ts.isLabeledStatement(s)) visit(s.statement);
    else if (ts.isTryStatement(s)) { visit(s.tryBlock); if (s.catchClause) visit(s.catchClause.block); if (s.finallyBlock) visit(s.finallyBlock); }
    else if (ts.isSwitchStatement(s)) for (const c of s.caseBlock.clauses) c.statements.forEach(visit);
  };
  body.statements.forEach(visit);
  return out;
}

const OLD_KINDS = new Set([ts.SyntaxKind.VariableStatement, ts.SyntaxKind.ExpressionStatement, ts.SyntaxKind.ReturnStatement, ts.SyntaxKind.ThrowStatement, ts.SyntaxKind.IfStatement]);

/** Names a statement list declares at its own top level (const/let/var, incl. binding patterns). */
function topDeclared(sts: readonly ts.Statement[]): Set<string> {
  const out = new Set<string>();
  const bind = (n: ts.BindingName): void => {
    if (ts.isIdentifier(n)) out.add(n.text);
    else for (const e of n.elements) if (!ts.isOmittedExpression(e)) bind(e.name);
  };
  for (const s of sts) if (ts.isVariableStatement(s)) for (const d of s.declarationList.declarations) bind(d.name);
  return out;
}

/**
 * The NEW grammar (bounded-grammar-v1): const/let declarations, expression statements, if/else, return, throw,
 * blocks, `for (const x of [literal array])`, `for (const x of <name>)`, try/catch(/finally), break/continue. No
 * function or class declarations, no while/do/for(;;)/for-in/switch/labels, no `var`, no template literals, no
 * `delete`, no `arguments`. Names and globals are checked by the hermetic walk on the edited module.
 */
export function newGrammarProblem(sts: readonly ts.Statement[], isAsync: boolean): string | null {
  let bad: string | null = null;
  const stmt = (s: ts.Statement, loop: boolean): void => {
    if (bad) return;
    if (ts.isVariableStatement(s)) {
      if (!(s.declarationList.flags & (ts.NodeFlags.Const | ts.NodeFlags.Let))) { bad = "edit_new_var"; return; }
      for (const d of s.declarationList.declarations) if (d.initializer) expr(d.initializer); else if (s.declarationList.flags & ts.NodeFlags.Const) bad = "edit_new_grammar";
    } else if (ts.isExpressionStatement(s)) expr(s.expression);
    else if (ts.isIfStatement(s)) { expr(s.expression); stmt(s.thenStatement, loop); if (s.elseStatement) stmt(s.elseStatement, loop); }
    else if (ts.isReturnStatement(s)) { if (s.expression) expr(s.expression); }
    else if (ts.isThrowStatement(s)) expr(s.expression);
    else if (ts.isBlock(s)) s.statements.forEach((x) => stmt(x, loop));
    else if (ts.isForOfStatement(s)) {
      if (s.awaitModifier || !ts.isVariableDeclarationList(s.initializer) || !(s.initializer.flags & ts.NodeFlags.Const)) { bad = "edit_new_loop"; return; }
      const it = s.expression;
      const bounded = (ts.isArrayLiteralExpression(it) && it.elements.length <= 8 && it.elements.every((e) => ts.isNumericLiteral(e) || ts.isStringLiteral(e))) || ts.isIdentifier(it) || ts.isPropertyAccessExpression(it);
      if (!bounded) { bad = "edit_new_loop"; return; }
      expr(it);
      stmt(s.statement, true);
    } else if (ts.isTryStatement(s)) { stmt(s.tryBlock, loop); if (s.catchClause) stmt(s.catchClause.block, loop); if (s.finallyBlock) stmt(s.finallyBlock, loop); }
    else if (ts.isBreakStatement(s) || ts.isContinueStatement(s)) { if (!loop || s.label) bad = "edit_new_grammar"; }
    else bad = "edit_new_grammar";
  };
  const expr = (e: ts.Node): void => {
    const v = (n: ts.Node): void => {
      if (bad) return;
      if (ts.isTemplateExpression(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isTaggedTemplateExpression(n)) { bad = "edit_new_template"; return; }
      if (ts.isDeleteExpression(n) || ts.isClassExpression(n) || ts.isMetaProperty(n) || n.kind === ts.SyntaxKind.ImportKeyword || ts.isYieldExpression(n)) { bad = "edit_new_grammar"; return; }
      if (ts.isAwaitExpression(n) && !isAsync) { bad = "edit_new_await"; return; }
      if (ts.isIdentifier(n) && n.text === "arguments") { bad = "edit_new_grammar"; return; }
      if (isFunctionLike(n)) {
        // arrow callbacks only, expression or block bodies under the same grammar
        if (!ts.isArrowFunction(n)) { bad = "edit_new_grammar"; return; }
        if (ts.isBlock(n.body)) { const inner = newGrammarProblem(n.body.statements, !!n.modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword)); if (inner) bad = inner; return; }
        const inner = newGrammarProblem([ts.factory.createExpressionStatement(n.body as ts.Expression)], !!n.modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword));
        if (inner) bad = inner;
        return;
      }
      ts.forEachChild(n, v);
    };
    v(e);
  };
  for (const s of sts) stmt(s, false);
  return bad;
}

/** The OLD/NEW split of the trigger body: the unique ` with ` where OLD parses as ONE statement and NEW as 1..4. */
export function splitBody(body: string): { oldText: string; newText: string } | null {
  const hits: { oldText: string; newText: string }[] = [];
  for (let i = body.indexOf(" with "); i !== -1; i = body.indexOf(" with ", i + 1)) {
    const oldText = body.slice(0, i).trim(), newText = body.slice(i + 6).trim().replace(/\.$/, (m) => (/[\w)\]"']\.$/.test(body) ? "" : m));
    const o = parseStatements(oldText), n = parseStatements(newText);
    if (o && o.length === 1 && n && n.length >= 1 && n.length <= MAX_NEW_STATEMENTS) hits.push({ oldText, newText });
  }
  return hits.length === 1 ? hits[0]! : null;
}

/** G1: apply the replacement; null unless OLD matches exactly one own statement and the result parses. */
export function editStatement(path: string, text: string, target: string, oldText: string, newText: string): { content: string; target: Target } | null {
  if (oldText.length > MAX_OLD_CHARS || newText.length > MAX_NEW_CHARS || sameCode(oldText, newText)) return null;
  const sf = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
  if (diag(sf)) return null;
  const t = findTarget(sf, target);
  if (!t || !t.node.body) return null;
  const isAsync = !!t.node.modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword);
  const oldSts = parseStatements(oldText), newSts = parseStatements(newText);
  if (!oldSts || oldSts.length !== 1 || !newSts || newSts.length < 1 || newSts.length > MAX_NEW_STATEMENTS) return null;
  if (!OLD_KINDS.has(oldSts[0]!.kind)) return null;
  if (newGrammarProblem(newSts, isAsync)) return null;
  const matches = ownStatements(t.node.body).filter((s) => sameCode(s.getText(sf), oldText));
  if (matches.length !== 1) return null;
  const site = matches[0]!;
  // every name OLD declares stays declared at NEW's top level (later statements keep resolving)
  const declared = topDeclared(oldSts), kept = topDeclared(newSts);
  if ([...declared].some((n) => !kept.has(n))) return null;
  const parentIsList = ts.isBlock(site.parent) || ts.isCaseClause(site.parent) || ts.isDefaultClause(site.parent);
  if (!parentIsList && kept.size) return null; // a declaration under an unbraced if/loop would not parse anyway
  const start = site.getStart(sf), end = site.getEnd();
  const lineStart = text.lastIndexOf("\n", start - 1) + 1;
  const indent = /^[ \t]*/.exec(text.slice(lineStart, start))![0];
  const pieces = newSts.map((s) => s.getText());
  const replacement = parentIsList ? pieces.join(`\n${indent}`) : (pieces.length === 1 ? pieces[0]! : `{ ${pieces.join(" ")} }`);
  const content = text.slice(0, start) + replacement + text.slice(end);
  const after = ts.createSourceFile(path, content, ts.ScriptTarget.Latest, true);
  if (diag(after)) return null;
  const t2 = findTarget(after, target);
  if (!t2) return null;
  return { content, target: t2 };
}

// ---------------------------------------------------------------------------------------------------------------
// The hermetic walk (io: injected-only-v1)
// ---------------------------------------------------------------------------------------------------------------
/** Globals the reached code may read; `ctor` = may be `new`-ed. Everything else (Date, process, fetch, timers, globalThis, Intl, Reflect, Symbol, ...) is refused. */
const GLOBAL_OK: Readonly<Record<string, { ctor: boolean }>> = {
  undefined: { ctor: false }, NaN: { ctor: false }, Infinity: { ctor: false },
  Number: { ctor: false }, Math: { ctor: false }, String: { ctor: false }, Boolean: { ctor: false }, Array: { ctor: true }, Object: { ctor: false }, JSON: { ctor: false },
  Error: { ctor: true }, TypeError: { ctor: true }, RangeError: { ctor: true }, SyntaxError: { ctor: true },
  Uint8Array: { ctor: true }, Uint8ClampedArray: { ctor: true }, Int8Array: { ctor: true }, Uint16Array: { ctor: true }, Int16Array: { ctor: true }, Uint32Array: { ctor: true }, Int32Array: { ctor: true }, Float32Array: { ctor: true }, Float64Array: { ctor: true }, BigInt64Array: { ctor: true }, BigUint64Array: { ctor: true }, ArrayBuffer: { ctor: true }, DataView: { ctor: true }, Buffer: { ctor: false }, Map: { ctor: true }, Set: { ctor: true }, Promise: { ctor: true },
  URL: { ctor: true }, URLSearchParams: { ctor: true }, TextEncoder: { ctor: true }, TextDecoder: { ctor: true }, Headers: { ctor: true }, Response: { ctor: true }, Request: { ctor: true },
  encodeURIComponent: { ctor: false }, decodeURIComponent: { ctor: false }, encodeURI: { ctor: false }, decodeURI: { ctor: false },
  parseInt: { ctor: false }, parseFloat: { ctor: false }, isFinite: { ctor: false }, isNaN: { ctor: false }, BigInt: { ctor: false }, console: { ctor: false },
};
/** Members of allowed globals that are still refused (randomness, prototype / property-definition patching, clocks). */
const GLOBAL_MEMBER_DENY = new Set(["Math.random", "Object.defineProperty", "Object.defineProperties", "Object.setPrototypeOf", "Object.getPrototypeOf", "Object.assign", "Promise.race", "Buffer.allocUnsafe", "Buffer.allocUnsafeSlow", "URL.createObjectURL", "URL.revokeObjectURL", "Response.redirect"]);
const REFLECTION = new Set(["constructor", "__proto__", "prototype", "caller", "callee", "__defineGetter__", "__defineSetter__", "__lookupGetter__", "__lookupSetter__"]);
/** Auditor #489: the engine itself never edits (or pulls into a closure) a test helper or a fixture / mock, no matter what targets.json denyPatterns say. */
export const isExcludedSource = (p: string): boolean => /\.test-helper\.ts$/.test(p) || /(?:^|\/)(?:fixtures|__fixtures__|__mocks__|__tests__|testdata|test-helpers|mocks)\//.test(p);
/** Local-time reads and Date setters (the learned-complex DATE lists), refused by member name on any receiver. */
const LOCAL_TIME = /^(?:getFullYear|getYear|getMonth|getDate|getDay|getHours|getMinutes|getSeconds|getMilliseconds|getTimezoneOffset|toLocaleString|toLocaleDateString|toLocaleTimeString|toDateString|toTimeString|toUTCString|toJSON|set(?:UTC)?(?:FullYear|Year|Month|Date|Hours|Minutes|Seconds|Milliseconds|Time))$/;
const CRYPTO_OK = new Set(["createHash", "createHmac"]);
const BUILTINS = new Set(["assert", "buffer", "crypto", "events", "fs", "fs/promises", "os", "path", "stream", "string_decoder", "url", "util", "zlib", "child_process", "http", "https", "net", "readline", "timers", "timers/promises", "worker_threads", "perf_hooks"]);
const NONMUTATING = new Set(["has", "get", "includes", "indexOf", "lastIndexOf", "find", "findIndex", "findLast", "findLastIndex", "some", "every", "map", "filter", "reduce", "forEach", "slice", "concat", "join", "keys", "values", "entries", "at", "flat", "flatMap", "test", "exec", "size", "length"]);
const STRING_REGEX_SINKS = new Set(["matchAll", "replaceAll", "replace", "match", "split", "search"]);

// ---------------------------------------------------------------------------------------------------------------
// Auditor #489 (review of 7508d20): the edit gate is an ALLOWLIST. A banned-word list was walked around with no banned
// word and no computed key (X1: Object.getOwnPropertyDescriptors -> Object.prototype -> the __proto__ getter's
// .get.call(() => 0) -> Function.prototype -> Function; X2: the same walk, then `V.x = ..` on Object.prototype).
// Edited code (every reference the edited target unit makes MORE often than the base unit did; see allowTokens) may
// only use: the target's own parameters and locals, fresh literals, `this`, member reads / method calls on those, and
// the short list below. Each entry is a pure, total, side-effect-free function or constant of a primitive / plain
// value: it can't reach I/O, a clock, randomness, a prototype, a property descriptor or a function constructor.
// ---------------------------------------------------------------------------------------------------------------
/** `Global.member` an edit may use. Justification per group:
 *  - Math.min/max/floor/ceil/round/abs/trunc/sign: arithmetic on numbers; no state (Math.random is NOT listed).
 *  - Number.isInteger/isFinite/isNaN/isSafeInteger: predicates (no coercion side effects); MAX/MIN_SAFE_INTEGER: constants.
 *  - Array.isArray: a type predicate.
 *  - Object.keys/values/entries: OWN ENUMERABLE data of a value already in hand (no descriptors, accessors, prototype,
 *    symbols or non-enumerables; getOwnPropertyDescriptor(s)/getOwnPropertyNames/create/assign/fromEntries are NOT listed).
 *  - Promise.all/allSettled: awaiting collaborator calls already allowed one by one (race is not listed). */
export const EDIT_GLOBAL_MEMBERS: ReadonlySet<string> = new Set([
  "Math.min", "Math.max", "Math.floor", "Math.ceil", "Math.round", "Math.abs", "Math.trunc", "Math.sign",
  "Number.isInteger", "Number.isFinite", "Number.isNaN", "Number.isSafeInteger", "Number.MAX_SAFE_INTEGER", "Number.MIN_SAFE_INTEGER",
  "Array.isArray",
  "Object.keys", "Object.values", "Object.entries",
  "Promise.all", "Promise.allSettled",
]);
/** Globals an edit may CALL directly: String/Number/Boolean (primitive conversion), parseInt/parseFloat (pure parsing). */
export const EDIT_GLOBAL_CALLS: ReadonlySet<string> = new Set(["String", "Number", "Boolean", "parseInt", "parseFloat"]);
/** Globals an edit may `new`: Error/TypeError/RangeError (a fresh error to throw), Map/Set (a fresh empty-or-copied container). */
export const EDIT_GLOBAL_NEW: ReadonlySet<string> = new Set(["Error", "TypeError", "RangeError", "Map", "Set"]);
/** Constant identifiers that are always fine. */
const EDIT_GLOBAL_VALUES: ReadonlySet<string> = new Set(["undefined", "NaN", "Infinity"]);
/** Member NAMES never allowed on any receiver: descriptor / prototype reflection, rebinding `this`, stack capture. */
export const EDIT_BANNED_MEMBERS: ReadonlySet<string> = new Set([
  ...REFLECTION, "call", "apply", "bind", "getOwnPropertyDescriptor", "getOwnPropertyDescriptors", "getOwnPropertyNames",
  "getOwnPropertySymbols", "getPrototypeOf", "setPrototypeOf", "defineProperty", "defineProperties", "captureStackTrace",
  "prepareStackTrace", "stackTraceLimit",
]);
/** Size-taking string builders: allowed only with a small numeric literal (no huge repeat / pad). */
const EDIT_SIZED = new Set(["repeat", "padStart", "padEnd"]);
export const EDIT_MAX_SIZE = 256;

export interface Injection { args: (null | "data" | { keys: Set<string> })[] }

const isBuiltin = (spec: string): boolean => spec.startsWith("node:") || BUILTINS.has(spec);

/** `./x`, `./x.js`, `./x.ts` from `from`'s directory to an existing repo-relative path (`x.ts`, `x/index.ts`). */
export function resolveRelative(from: string, spec: string, read: Read): string | null {
  if (!spec.startsWith("./") && !spec.startsWith("../")) return null;
  const dir = from.includes("/") ? from.slice(0, from.lastIndexOf("/")) : "";
  const parts = (dir ? dir.split("/") : []);
  for (const p of spec.split("/")) {
    if (p === "." || p === "") continue;
    if (p === "..") { if (!parts.length) return null; parts.pop(); } else parts.push(p);
  }
  const base = parts.join("/");
  const stem = base.replace(/\.(?:js|ts|mjs)$/, "");
  for (const c of [`${stem}.ts`, `${stem}/index.ts`]) if (read(c) !== null) return c;
  return null;
}

interface Closure { files: Map<string, ts.SourceFile>; program: ts.Program; checker: ts.TypeChecker }

/** The module-load closure of `entry`: every relative value import, transitively. Package value imports are refused. */
export function loadClosure(entry: string, read: Read, override?: { path: string; content: string }): Closure | string {
  const texts = new Map<string, string>();
  const todo = [entry];
  const get = (p: string): string | null => (override && p === override.path ? override.content : read(p));
  while (todo.length) {
    const p = todo.pop()!;
    if (texts.has(p)) continue;
    if (texts.size >= MAX_MODULES) return "edit_closure_too_large";
    const t = get(p);
    if (t === null) return `edit_module_unreadable:${p}`;
    texts.set(p, t);
    const sf = ts.createSourceFile(p, t, ts.ScriptTarget.Latest, true);
    if (diag(sf)) return `edit_module_parse:${p}`;
    for (const st of sf.statements) {
      const spec = (ts.isImportDeclaration(st) || ts.isExportDeclaration(st)) && st.moduleSpecifier && ts.isStringLiteral(st.moduleSpecifier) ? st.moduleSpecifier.text : null;
      if (spec === null) continue;
      const typeOnly = ts.isImportDeclaration(st) ? !!st.importClause?.isTypeOnly || (!!st.importClause && !st.importClause.name && !!st.importClause.namedBindings && ts.isNamedImports(st.importClause.namedBindings) && st.importClause.namedBindings.elements.length > 0 && st.importClause.namedBindings.elements.every((e) => e.isTypeOnly)) : (st as ts.ExportDeclaration).isTypeOnly;
      if (spec.startsWith(".")) {
        const r = resolveRelative(p, spec, get);
        if (!r) return `edit_import_unresolved:${spec}`;
        if (!typeOnly) todo.push(r);
        else if (!texts.has(r)) todo.push(r); // types still need the declarations for the checker
      } else if (!isBuiltin(spec) && !typeOnly) return `edit_package_import:${spec}`;
    }
  }
  const files = new Map<string, ts.SourceFile>();
  for (const [p, t] of texts) files.set(p, ts.createSourceFile(`/r/${p}`, t, ts.ScriptTarget.Latest, true));
  const options: ts.CompilerOptions = { noLib: true, noEmit: true, target: ts.ScriptTarget.Latest, module: ts.ModuleKind.ESNext, types: [], noResolve: false, allowJs: false };
  const byAbs = new Map<string, ts.SourceFile>([...files].map(([p, sf]) => [`/r/${p}`, sf]));
  const host: ts.CompilerHost = {
    getSourceFile: (name) => byAbs.get(name),
    getDefaultLibFileName: () => "/lib.d.ts",
    writeFile: () => undefined,
    getCurrentDirectory: () => "/r",
    getCanonicalFileName: (f) => f,
    useCaseSensitiveFileNames: () => true,
    getNewLine: () => "\n",
    fileExists: (f) => byAbs.has(f),
    readFile: (f) => byAbs.get(f)?.text,
    resolveModuleNames: (names, containing) => names.map((n) => {
      const rel = resolveRelative(containing.replace(/^\/r\//, ""), n, (q) => (files.has(q) ? "" : null));
      return rel ? { resolvedFileName: `/r/${rel}`, extension: ts.Extension.Ts, isExternalLibraryImport: false } : undefined;
    }),
  };
  const program = ts.createProgram({ rootNames: [...byAbs.keys()], options, host });
  return { files: new Map([...files].map(([p]) => [p, program.getSourceFile(`/r/${p}`)!])), program, checker: program.getTypeChecker() };
}

const unwrap = (e: ts.Expression): ts.Expression => {
  let x = e;
  while (ts.isParenthesizedExpression(x) || ts.isAsExpression(x) || ts.isSatisfiesExpression(x) || ts.isNonNullExpression(x) || ts.isTypeAssertionExpression(x)) x = x.expression;
  return x;
};

/** Inert at module load: literals, regexes, plain arrays/objects of inert values, functions, references, new Set/Map of inert, Object.freeze(inert). */
function inertAtLoad(e: ts.Expression): boolean {
  const x = unwrap(e);
  if (ts.isStringLiteral(x) || ts.isNumericLiteral(x) || ts.isBigIntLiteral(x) || ts.isNoSubstitutionTemplateLiteral(x) || ts.isRegularExpressionLiteral(x)) return true;
  if (x.kind === ts.SyntaxKind.TrueKeyword || x.kind === ts.SyntaxKind.FalseKeyword || x.kind === ts.SyntaxKind.NullKeyword) return true;
  if (ts.isPrefixUnaryExpression(x) && (x.operator === ts.SyntaxKind.MinusToken || x.operator === ts.SyntaxKind.PlusToken) && ts.isNumericLiteral(x.operand)) return true;
  if (ts.isArrowFunction(x) || ts.isFunctionExpression(x)) return true;
  if (ts.isIdentifier(x)) return x.text !== "process" && x.text !== "globalThis" && x.text !== "Date";
  if (ts.isPropertyAccessExpression(x)) return ts.isIdentifier(unwrap(x.expression)) && inertAtLoad(x.expression);
  if (ts.isTemplateExpression(x)) return x.templateSpans.every((s) => inertAtLoad(s.expression));
  if (ts.isArrayLiteralExpression(x)) return x.elements.every((el) => (ts.isSpreadElement(el) ? inertAtLoad(el.expression) : !ts.isOmittedExpression(el) && inertAtLoad(el)));
  if (ts.isObjectLiteralExpression(x)) return x.properties.every((p) => (ts.isPropertyAssignment(p) ? !ts.isComputedPropertyName(p.name) && inertAtLoad(p.initializer) : ts.isShorthandPropertyAssignment(p) || (ts.isSpreadAssignment(p) && inertAtLoad(p.expression)) || ts.isMethodDeclaration(p)));
  if (ts.isNewExpression(x) && ts.isIdentifier(x.expression) && (x.expression.text === "Set" || x.expression.text === "Map")) return (x.arguments ?? []).every(inertAtLoad);
  if (ts.isCallExpression(x) && ts.isPropertyAccessExpression(x.expression) && ts.isIdentifier(x.expression.expression) && x.expression.expression.text === "Object" && x.expression.name.text === "freeze") return x.arguments.every(inertAtLoad);
  if (ts.isBinaryExpression(x) && [ts.SyntaxKind.PlusToken, ts.SyntaxKind.MinusToken, ts.SyntaxKind.AsteriskToken, ts.SyntaxKind.SlashToken, ts.SyntaxKind.AsteriskAsteriskToken].includes(x.operatorToken.kind)) return inertAtLoad(x.left) && inertAtLoad(x.right);
  return false;
}

/**
 * Module-load check of every module in the closure: only imports, declarations and variable / enum / static-field
 * initializers run at import, and those initializers are walked (shallow: function bodies are not run at load) under
 * the same hermetic rules; a module function they call is walked in full.
 */
export function loadProblem(c: Closure, modPath: string): string | null {
  for (const [p, sf] of c.files) {
    for (const st of sf.statements) {
      if (ts.isImportDeclaration(st) || ts.isInterfaceDeclaration(st) || ts.isTypeAliasDeclaration(st) || ts.isFunctionDeclaration(st) || ts.isEmptyStatement(st) || ts.isExportDeclaration(st) || ts.isEnumDeclaration(st) || ts.isVariableStatement(st)) continue;
      if (ts.isModuleDeclaration(st) && st.modifiers?.some((m) => m.kind === ts.SyntaxKind.DeclareKeyword)) continue;
      if (ts.isExportAssignment(st)) continue;
      if (ts.isClassDeclaration(st)) {
        if (ts.getDecorators(st)?.length) return `edit_module_load:${p}`;
        for (const m of st.members) {
          if (ts.isClassStaticBlockDeclaration(m) || ts.getDecorators(m as ts.HasDecorators)?.length) return `edit_module_load:${p}`;
          if (m.name && ts.isComputedPropertyName(m.name)) return `edit_module_load:${p}`;
        }
        if (st.heritageClauses?.some((h) => h.token === ts.SyntaxKind.ExtendsKeyword && h.types.some((t) => !ts.isIdentifier(t.expression)))) return `edit_module_load:${p}`;
        continue;
      }
      return `edit_module_load:${p}`;
    }
  }
  const r = reachProblem(c, modPath, null);
  return typeof r === "string" ? r : null;
}

/** Where the last refusal of reachProblem was raised (`/r/<path>:<line>`), for census reports only. */
export let problemAt = "";
type Unit = ts.FunctionLikeDeclaration | ts.PropertyDeclaration | ts.Expression;
const inTypePosition = (n: ts.Node): boolean => {
  for (let a: ts.Node | undefined = n.parent; a; a = a.parent) {
    if (ts.isTypeNode(a) && !ts.isExpressionWithTypeArguments(a)) return true;
    if (ts.isHeritageClause(a)) return a.token === ts.SyntaxKind.ImplementsKeyword;
    if (ts.isExpressionStatement(a) || ts.isBlock(a) || isFunctionLike(a) || ts.isSourceFile(a)) return false;
  }
  return false;
};
const isDeclName = (id: ts.Identifier): boolean => {
  const p = id.parent;
  if (ts.isPropertyAccessExpression(p) && p.name === id) return true;
  if (ts.isQualifiedName(p)) return true;
  if ((ts.isVariableDeclaration(p) || ts.isParameter(p) || ts.isFunctionDeclaration(p) || ts.isFunctionExpression(p) || ts.isClassDeclaration(p) || ts.isClassExpression(p) || ts.isPropertyDeclaration(p) || ts.isMethodDeclaration(p) || ts.isPropertyAssignment(p) || ts.isPropertySignature(p) || ts.isMethodSignature(p) || ts.isEnumMember(p) || ts.isGetAccessorDeclaration(p) || ts.isSetAccessorDeclaration(p) || ts.isTypeParameterDeclaration(p) || ts.isImportSpecifier(p) || ts.isImportClause(p) || ts.isNamespaceImport(p) || ts.isExportSpecifier(p)) && (p as { name?: ts.Node }).name === id) return true;
  if (ts.isBindingElement(p) && (p.name === id || p.propertyName === id)) return true;
  if (ts.isLabeledStatement(p) || ts.isBreakStatement(p) || ts.isContinueStatement(p)) return true;
  return false;
};
const rootOf = (e: ts.Expression): ts.Expression => {
  let x = unwrap(e);
  while (ts.isPropertyAccessExpression(x) || ts.isElementAccessExpression(x)) x = unwrap(x.expression);
  return x;
};
const containingFunction = (n: ts.Node): ts.Node | null => {
  for (let a: ts.Node | undefined = n.parent; a; a = a.parent) {
    if (isFunctionLike(a) || ts.isClassStaticBlockDeclaration(a)) return a;
    if (ts.isSourceFile(a)) return null;
  }
  return null;
};
const declOf = (s: ts.Symbol | undefined): ts.Declaration | undefined => s?.valueDeclaration ?? s?.declarations?.[0];

/**
 * Auditor #489: capability tokens a function body references — bare global capabilities (fetch, process, require,
 * timers, eval, Function, Reflect, ...), reflection member names (constructor, __proto__, prototype, ...), and
 * `as any` / `as unknown` escapes. `capabilityDelta` refuses an edit that uses ANY token more often than the base
 * target did (counted, not just present), so a splice can neither add new I/O surface (even hidden behind an injected
 * `?? default`, or a second one beside a default the base already had) nor a reflection / type-erasure path. Defaults
 * already present in the base survive unchanged (they are stubbed by the fake).
 */
const CAPABILITY_IDENTS = new Set([
  "fetch", "process", "require", "globalThis", "global", "self", "eval", "Function", "Reflect", "Proxy",
  "WebAssembly", "XMLHttpRequest", "WebSocket", "EventSource", "Worker", "SharedWorker", "importScripts",
  "setTimeout", "setInterval", "setImmediate", "clearTimeout", "clearInterval", "clearImmediate", "queueMicrotask",
  "__dirname", "__filename", "module", "exports", "Deno", "Bun", "GLOBAL", "root",
]);
function capabilityTokens(node: ts.Node): Map<string, number> {
  const out = new Map<string, number>();
  const add = (k: string): void => { out.set(k, (out.get(k) ?? 0) + 1); };
  // Auditor #489: a computed member access is only "data from the tested function's own parameters" when BOTH the
  // receiver's root and the key are bare parameters of the target. Any other dynamic key (string-built, local,
  // template, fromCharCode, ...) is a capability token, so an edit can't add one (P2/P3 prototype paths without a cast).
  const params = new Set<string>();
  if (ts.isFunctionLike(node)) for (const p of node.parameters) if (ts.isIdentifier(p.name)) params.add(p.name.text);
  const isParam = (e: ts.Expression): boolean => { const u = unwrap(e); return ts.isIdentifier(u) && params.has(u.text); };
  const visit = (n: ts.Node): void => {
    if (ts.isElementAccessExpression(n)) {
      const a = unwrap(n.argumentExpression);
      const literalKey = ts.isNumericLiteral(a) || ((ts.isStringLiteral(a) || ts.isNoSubstitutionTemplateLiteral(a)) && !REFLECTION.has(a.text));
      const r = rootOf(n.expression);
      if (!literalKey && !(isParam(a) && ts.isIdentifier(r) && params.has(r.text))) add("computed");
    }
    if (ts.isAsExpression(n) || ts.isTypeAssertionExpression(n)) {
      if (n.type.kind === ts.SyntaxKind.AnyKeyword) add("cast:any");
      else if (n.type.kind === ts.SyntaxKind.UnknownKeyword) add("cast:unknown");
    }
    if (ts.isPropertyAccessExpression(n) && REFLECTION.has(n.name.text)) add(`refl:${n.name.text}`);
    if (ts.isElementAccessExpression(n)) {
      const a = unwrap(n.argumentExpression);
      if ((ts.isStringLiteral(a) || ts.isNoSubstitutionTemplateLiteral(a)) && REFLECTION.has(a.text)) add(`refl:${a.text}`);
    }
    if (ts.isIdentifier(n) && CAPABILITY_IDENTS.has(n.text) && !isDeclName(n) && !inTypePosition(n)) add(`id:${n.text}`);
    // Auditor #489 (follow-up): the same reflection / dynamic-key paths through destructuring and object literals —
    // `const { constructor: C } = f`, `const { constructor } = f`, `const { [k]: C } = o`, `{ __proto__: x }`,
    // `{ [k]: v }`. A computed property name is a "computed" token unless it is a literal non-reflection key.
    if (ts.isComputedPropertyName(n)) {
      const a = unwrap(n.expression);
      const lit = ts.isNumericLiteral(a) || ((ts.isStringLiteral(a) || ts.isNoSubstitutionTemplateLiteral(a)) && !REFLECTION.has(a.text));
      if ((ts.isStringLiteral(a) || ts.isNoSubstitutionTemplateLiteral(a)) && REFLECTION.has(a.text)) add(`refl:${a.text}`);
      else if (!lit) add("computed");
    }
    const keyText = (k: ts.Node | undefined): string | null => (k && (ts.isIdentifier(k) || ts.isStringLiteral(k) || ts.isNoSubstitutionTemplateLiteral(k)) ? k.text : null);
    if (ts.isBindingElement(n)) {
      const k = keyText(n.propertyName) ?? (n.propertyName ? null : keyText(n.name));
      if (k !== null && REFLECTION.has(k) && ts.isObjectBindingPattern(n.parent)) add(`refl:${k}`);
    }
    if ((ts.isPropertyAssignment(n) || ts.isShorthandPropertyAssignment(n) || ts.isMethodDeclaration(n) || ts.isGetAccessorDeclaration(n) || ts.isSetAccessorDeclaration(n)) && ts.isObjectLiteralExpression(n.parent)) {
      const k = keyText(n.name);
      if (k !== null && REFLECTION.has(k)) add(`refl:${k}`);
    }
    ts.forEachChild(n, visit);
  };
  visit(node);
  return out;
}
/**
 * Auditor #489 (review of 7508d20): the ALLOWLIST tokens of a target unit. Every reference that is not on the allowlist
 * (see EDIT_GLOBAL_MEMBERS) is a token; capabilityDelta refuses an edit that has any token more often than the base
 * unit, so every reference an edit ADDS must be allowlisted. Tokens (each its own guard, each covered by a test):
 * - `ref:<name>`      an identifier that is not a parameter / local of the unit, `undefined` / `NaN` / `Infinity`, or an
 *                     allowlisted global used in its allowlisted form (module bindings, imports, Date, Symbol, Object
 *                     itself as a value, ...). Capability idents keep their own `id:` token.
 * - `gm:<G>.<m>`      a member of a global that is not in EDIT_GLOBAL_MEMBERS (Object.getOwnPropertyDescriptors, Math.random)
 * - `member:<m>`      a member name in EDIT_BANNED_MEMBERS on ANY receiver (.call/.apply/.bind, descriptors, prototypes)
 * - `accessor:<m>`    `.get` / `.set` read as a value instead of called directly (an accessor function grab)
 * - `call-local`      calling a local that is not a parameter (a function obtained at run time; also recursion)
 * - `write-nonfresh`  a property write whose root is `this`, a parameter, or a local not initialised to a fresh literal
 * - `shadow`          a local declared with the name of a global
 * - `size`            repeat / padStart / padEnd without a small literal size, `Array(..)` / `new Array(..)` with arguments,
 *                     self-doubling (`s += s`, `a = a.concat(a)`, `a.push(...a)`)
 * - `regex`           any regex literal or RegExp (backtracking cost is data-dependent; fail closed)
 * - `reflstr:<s>`     a reflection name as a string literal (e.g. a `["__proto__", v]` entry)
 */
function allowTokens(node: ts.Node): Map<string, number> {
  const out = new Map<string, number>();
  const add = (k: string): void => { out.set(k, (out.get(k) ?? 0) + 1); };
  const params = new Set<string>(), locals = new Set<string>(), fresh = new Set<string>();
  const bind = (nm: ts.BindingName, into: Set<string>): void => {
    if (ts.isIdentifier(nm)) into.add(nm.text);
    else for (const el of nm.elements) if (!ts.isOmittedExpression(el)) bind(el.name, into);
  };
  if (ts.isFunctionLike(node)) for (const p of node.parameters) bind(p.name, params);
  const isFresh = (e: ts.Expression): boolean => {
    const x = unwrap(e);
    return ts.isArrayLiteralExpression(x) || ts.isObjectLiteralExpression(x) || ts.isStringLiteral(x) || ts.isNumericLiteral(x) || ts.isNoSubstitutionTemplateLiteral(x) || x.kind === ts.SyntaxKind.TrueKeyword || x.kind === ts.SyntaxKind.FalseKeyword || x.kind === ts.SyntaxKind.NullKeyword;
  };
  const collect = (n: ts.Node): void => {
    if (n !== node && ts.isFunctionLike(n)) for (const p of n.parameters) bind(p.name, locals);
    if (ts.isVariableDeclaration(n)) {
      bind(n.name, locals);
      // fresh only if it is never re-bound: a `const`, initialised to a literal the unit itself created
      if (ts.isIdentifier(n.name) && n.initializer && isFresh(n.initializer) && ts.isVariableDeclarationList(n.parent) && (n.parent.flags & ts.NodeFlags.Const)) fresh.add(n.name.text);
    }
    if ((ts.isFunctionDeclaration(n) || ts.isClassDeclaration(n)) && n !== node && n.name) locals.add(n.name.text);
    if (ts.isCatchClause(n) && n.variableDeclaration) bind(n.variableDeclaration.name, locals);
    ts.forEachChild(n, collect);
  };
  collect(node);
  for (const p of params) locals.add(p);
  for (const l of locals) if (Object.hasOwn(GLOBAL_OK, l) || CAPABILITY_IDENTS.has(l) || EDIT_GLOBAL_CALLS.has(l) || EDIT_GLOBAL_NEW.has(l)) add("shadow");
  const directCallee = (n: ts.Node): boolean => ts.isCallExpression(n.parent) && n.parent.expression === n;
  const literalString = (e: ts.Expression): string | null => { const x = unwrap(e); return ts.isStringLiteral(x) || ts.isNoSubstitutionTemplateLiteral(x) ? x.text : null; };
  const smallSize = (e: ts.Expression | undefined): boolean => { const x = e ? unwrap(e) : undefined; return !!x && ts.isNumericLiteral(x) && Number(x.text) <= EDIT_MAX_SIZE; };
  const mentions = (e: ts.Node, name: string): number => { let k = 0; const v = (x: ts.Node): void => { if (ts.isIdentifier(x) && x.text === name && !(ts.isPropertyAccessExpression(x.parent) && x.parent.name === x)) k++; ts.forEachChild(x, v); }; v(e); return k; };
  const member = (recv: ts.Expression, name: string, at: ts.Node): void => {
    if (EDIT_BANNED_MEMBERS.has(name)) add(`member:${name}`);
    else if ((name === "get" || name === "set") && !directCallee(at)) add(`accessor:${name}`);
    const r = unwrap(recv);
    if (ts.isIdentifier(r) && !locals.has(r.text) && (Object.hasOwn(GLOBAL_OK, r.text) || EDIT_GLOBAL_CALLS.has(r.text) || EDIT_GLOBAL_NEW.has(r.text)) && !EDIT_GLOBAL_MEMBERS.has(`${r.text}.${name}`)) add(`gm:${r.text}.${name}`);
    if (EDIT_SIZED.has(name) && directCallee(at) && !smallSize((at.parent as ts.CallExpression).arguments[0])) add("size");
  };
  const visit = (n: ts.Node): void => {
    if (ts.isTypeNode(n) && !ts.isExpressionWithTypeArguments(n)) return;
    if (ts.isPropertyAccessExpression(n)) member(n.expression, n.name.text, n);
    if (ts.isElementAccessExpression(n)) { const k = literalString(n.argumentExpression); if (k !== null) member(n.expression, k, n); }
    if (ts.isRegularExpressionLiteral(n)) add("regex");
    if (ts.isStringLiteral(n) && REFLECTION.has(n.text)) add(`reflstr:${n.text}`);
    if ((ts.isCallExpression(n) || ts.isNewExpression(n)) && ts.isIdentifier(n.expression) && n.expression.text === "Array" && (n.arguments?.length ?? 0) > 0) add("size");
    if (ts.isCallExpression(n)) {
      const c = unwrap(n.expression);
      if (ts.isIdentifier(c) && locals.has(c.text) && !params.has(c.text)) add("call-local");
      // self-doubling growth: a.push(...a), a.concat(a)
      if (ts.isPropertyAccessExpression(c) && (c.name.text === "push" || c.name.text === "unshift" || c.name.text === "concat")) {
        const r = unwrap(c.expression);
        if (ts.isIdentifier(r) && n.arguments.some((a) => mentions(a, r.text) > 0)) add("size");
      }
    }
    if (ts.isBinaryExpression(n) && n.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && n.operatorToken.kind <= ts.SyntaxKind.LastAssignment) {
      const l = unwrap(n.left);
      if (ts.isIdentifier(l)) {
        const self = mentions(n.right, l.text);
        if ((n.operatorToken.kind !== ts.SyntaxKind.EqualsToken && self > 0) || self > 1) add("size");
      }
    }
    // property writes: only through a const local the unit initialised to a fresh literal
    const wt = ts.isBinaryExpression(n) ? (n.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && n.operatorToken.kind <= ts.SyntaxKind.LastAssignment ? unwrap(n.left) : null)
      : ts.isDeleteExpression(n) ? unwrap(n.expression) : (ts.isPrefixUnaryExpression(n) || ts.isPostfixUnaryExpression(n)) && (n.operator === ts.SyntaxKind.PlusPlusToken || n.operator === ts.SyntaxKind.MinusMinusToken) ? unwrap(n.operand) : null;
    if (wt && (ts.isPropertyAccessExpression(wt) || ts.isElementAccessExpression(wt))) {
      const owner = unwrap(wt.expression);
      if (!(ts.isIdentifier(owner) && fresh.has(owner.text))) add("write-nonfresh");
    }
    if (ts.isIdentifier(n) && !isDeclName(n) && !inTypePosition(n) && !CAPABILITY_IDENTS.has(n.text)) {
      const p = n.parent;
      const t = n.text;
      const shorthand = ts.isShorthandPropertyAssignment(p) && p.name === n;
      if (locals.has(t) || EDIT_GLOBAL_VALUES.has(t)) { /* own parameter / local / constant */ }
      else if (!shorthand && ts.isPropertyAccessExpression(p) && p.expression === n && EDIT_GLOBAL_MEMBERS.has(`${t}.${p.name.text}`)) { /* allowlisted member */ }
      else if (!shorthand && ts.isElementAccessExpression(p) && p.expression === n && EDIT_GLOBAL_MEMBERS.has(`${t}.${literalString(p.argumentExpression) ?? ""}`)) { /* allowlisted member, literal key */ }
      else if (!shorthand && ts.isCallExpression(p) && p.expression === n && EDIT_GLOBAL_CALLS.has(t)) { /* allowlisted call */ }
      else if (!shorthand && ts.isNewExpression(p) && p.expression === n && EDIT_GLOBAL_NEW.has(t) && (p.arguments?.length ?? 0) <= 1) { /* allowlisted constructor */ }
      else add(`ref:${t}`);
    }
    ts.forEachChild(n, visit);
  };
  visit(node);
  return out;
}

/** Null unless the edited target uses some capability token MORE often than the base target did (a multiset, so an edit
 *  can't hide a second `?? fetch` behind one the base already had); then the refusal code. */
function capabilityDelta(base: ts.Node, real: ts.Node): string | null {
  const b = capabilityTokens(base);
  for (const [tk, n] of capabilityTokens(real)) if (n > (b.get(tk) ?? 0)) return `edit_new_capability:${tk}`;
  const fb = floatTokens(base);
  for (const [tk, n] of floatTokens(real)) if (n > (fb.get(tk) ?? 0)) return `edit_unawaited:${tk}`;
  // Auditor #489 (review of 7508d20): the allowlist — every reference the edit adds must be allowlisted.
  const ab = allowTokens(base);
  for (const [tk, n] of allowTokens(real)) if (n > (ab.get(tk) ?? 0)) return `edit_not_allowlisted:${tk}`;
  return null;
}
/**
 * Auditor #489 (G2 pass): ways an edit can leave a promise un-awaited, so the graded test could settle before the
 * work (or its rejection) happens. Counted like capability tokens; an edit may not add any:
 * - `call`: a bare expression statement calling a collaborator (a method on a parameter or on `this`, or a parameter
 *   itself) without `await`
 * - `void`: `void <call>`
 * - `then`: a `.then` / `.catch` / `.finally` chain
 * - `new-promise`: `new Promise(...)` (executor-timed work)
 * - `callback`: a non-async callback whose body calls a collaborator, passed to anything other than an `await`ed
 *   `Promise.all` / `Promise.allSettled` (e.g. `keys.forEach((k) => this.client.put(k))`)
 */
function floatTokens(node: ts.Node): Map<string, number> {
  const out = new Map<string, number>();
  const add = (k: string): void => { out.set(k, (out.get(k) ?? 0) + 1); };
  const params = new Set<string>();
  if (ts.isFunctionLike(node)) for (const p of node.parameters) if (ts.isIdentifier(p.name)) params.add(p.name.text);
  const collaborator = (e: ts.Expression): boolean => {
    const u = unwrap(e);
    if (!ts.isCallExpression(u)) return false;
    const callee = unwrap(u.expression);
    if (ts.isIdentifier(callee)) return params.has(callee.text);
    if (ts.isPropertyAccessExpression(callee) || ts.isElementAccessExpression(callee)) {
      const r = rootOf(callee.expression);
      return r.kind === ts.SyntaxKind.ThisKeyword || (ts.isIdentifier(r) && params.has(r.text));
    }
    return false;
  };
  const callsCollaborator = (n: ts.Node): boolean => {
    let hit = false;
    const v = (x: ts.Node): void => { if (hit) return; if (ts.isAwaitExpression(x)) return; if (ts.isExpression(x) && collaborator(x)) { hit = true; return; } ts.forEachChild(x, v); };
    v(n);
    return hit;
  };
  const awaitedAll = (fn: ts.Node): boolean => {
    // fn is an argument of `.map(...)` whose result is the array literal / argument of an awaited Promise.all(Settled)
    let p: ts.Node = fn.parent;
    for (let i = 0; i < 6 && p; i++, p = p.parent) {
      if (ts.isCallExpression(p) && ts.isPropertyAccessExpression(p.expression) && ts.isIdentifier(p.expression.expression) && p.expression.expression.text === "Promise" && (p.expression.name.text === "all" || p.expression.name.text === "allSettled")) {
        return !!p.parent && ts.isAwaitExpression(p.parent);
      }
      if (ts.isBlock(p) || ts.isSourceFile(p)) return false;
    }
    return false;
  };
  const visit = (n: ts.Node): void => {
    if (ts.isExpressionStatement(n) && collaborator(n.expression)) add("call");
    if (ts.isVoidExpression(n) && ts.isCallExpression(unwrap(n.expression))) add("void");
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && /^(?:then|catch|finally)$/.test(n.expression.name.text)) add("then");
    if (ts.isNewExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === "Promise") add("new-promise");
    if ((ts.isArrowFunction(n) || ts.isFunctionExpression(n)) && n !== node && !(ts.getModifiers(n) ?? []).some((m) => m.kind === ts.SyntaxKind.AsyncKeyword) && callsCollaborator(n.body) && !awaitedAll(n)) add("callback");
    ts.forEachChild(n, visit);
  };
  visit(node);
  return out;
}
const memberName = (m: ts.ClassElement): string | null => (m.name && (ts.isIdentifier(m.name) || ts.isPrivateIdentifier(m.name) || ts.isStringLiteral(m.name)) ? m.name.text : null);
const isStaticMember = (m: ts.ClassElement): boolean => (ts.getModifiers(m as ts.HasModifiers) ?? []).some((x) => x.kind === ts.SyntaxKind.StaticKeyword);

export interface Entry { kind: "new"; cls: string; method: string; args: Injection["args"]; ctorArgs: Injection["args"] }
export interface FnEntry { kind: "call"; fn: string; args: Injection["args"] }

/**
 * Walk every unit the entry can reach (fail closed) and return the reached units, or a refusal code. `injection`
 * describes, per entry parameter, what the test passes: null (nothing), "data" (plain data), or an object literal with
 * its keys (fakes and data). A capability default `P.k ?? E` / `P ?? E` / `p = E` on an entry parameter is skipped
 * only when the test injects that key / argument; otherwise E is walked and refused like any other code.
 */
export function reachProblem(c: Closure, modPath: string, entry: Entry | FnEntry | null): { reached: Set<ts.Node> } | string {
  const sf = c.files.get(modPath);
  if (!sf) return "edit_module_missing";
  const checker = c.checker;
  const reached = new Set<ts.Node>();
  const wholeClasses = new Set<ts.ClassDeclaration>();
  const queue: Unit[] = [];
  const ctx = new Map<ts.Node, { params: Map<ts.Symbol, Injection["args"][number]>; args: Injection["args"] }>();
  let problem: string | null = null;
  let current: ts.Node | null = null;
  const fail = (code: string): void => { if (problem === null && current) problemAt = `${current.getSourceFile().fileName}:${current.getSourceFile().getLineAndCharacterOfPosition(current.getStart()).line + 1}`; problem ??= code; };
  const enqueue = (u: Unit): void => { if (!reached.has(u)) { reached.add(u); queue.push(u); } };
  const exportedClass = (s: ts.SourceFile, name: string): ts.ClassDeclaration | null => {
    const hits = s.statements.filter((x): x is ts.ClassDeclaration => ts.isClassDeclaration(x) && x.name?.text === name && !!x.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword));
    return hits.length === 1 ? hits[0]! : null;
  };
  const classInit = (cls: ts.ClassDeclaration): ts.ConstructorDeclaration | undefined => {
    if (cls.heritageClauses?.some((h) => h.token === ts.SyntaxKind.ExtendsKeyword)) { fail("edit_class_extends"); return undefined; }
    for (const m of cls.members) if (ts.isPropertyDeclaration(m) && !isStaticMember(m) && m.initializer) enqueue(m);
    const ctor = cls.members.find(ts.isConstructorDeclaration);
    if (ctor) enqueue(ctor);
    return ctor;
  };
  const wholeClass = (cls: ts.ClassDeclaration): void => {
    if (wholeClasses.has(cls)) return;
    wholeClasses.add(cls);
    classInit(cls);
    for (const m of cls.members) if ((ts.isMethodDeclaration(m) || ts.isGetAccessorDeclaration(m) || ts.isSetAccessorDeclaration(m)) && m.body) enqueue(m);
  };
  const bindCtx = (u: ts.FunctionLikeDeclaration | undefined, args: Injection["args"]): void => {
    if (!u) { if (args.some((a) => a !== null)) { /* no ctor: args ignored */ } return; }
    const params = new Map<ts.Symbol, Injection["args"][number]>();
    u.parameters.forEach((p, i) => {
      if (!ts.isIdentifier(p.name)) return;
      const syms = ts.isParameterPropertyDeclaration(p, p.parent) ? checker.getSymbolsOfParameterPropertyDeclaration(p, p.name.text) : [checker.getSymbolAtLocation(p.name)];
      for (const s of syms) if (s) params.set(s, args[i] ?? null);
    });
    ctx.set(u, { params, args });
  };
  const shallow = new Set<ts.Node>();
  const loadRef = { current: false };
  if (entry === null) {
    // load units: what runs at import, in every module of the closure
    for (const f of c.files.values()) for (const st of f.statements) {
      const inits: ts.Expression[] = [];
      if (ts.isVariableStatement(st) && !st.modifiers?.some((m) => m.kind === ts.SyntaxKind.DeclareKeyword)) for (const d of st.declarationList.declarations) { if (d.initializer) inits.push(d.initializer); }
      else if (ts.isEnumDeclaration(st)) for (const m of st.members) { if (m.initializer) inits.push(m.initializer); }
      else if (ts.isExportAssignment(st)) inits.push(st.expression);
      else if (ts.isClassDeclaration(st)) for (const m of st.members) { if (ts.isPropertyDeclaration(m) && isStaticMember(m) && m.initializer) inits.push(m.initializer); }
      for (const e of inits) { shallow.add(e); enqueue(e); }
    }
  } else if (entry.kind === "new") {
    const cls = exportedClass(sf, entry.cls);
    if (!cls) return "edit_entry_not_exported";
    const ctor = classInit(cls);
    bindCtx(ctor, entry.ctorArgs);
    const ms = cls.members.filter((m): m is ts.MethodDeclaration => ts.isMethodDeclaration(m) && memberName(m) === entry.method && !isStaticMember(m) && !!m.body && !(ts.getModifiers(m) ?? []).some((x) => x.kind === ts.SyntaxKind.PrivateKeyword || x.kind === ts.SyntaxKind.ProtectedKeyword) && ts.isIdentifier(m.name));
    if (ms.length !== 1) return "edit_entry_method";
    enqueue(ms[0]!);
    bindCtx(ms[0]!, entry.args);
  } else {
    const fns = sf.statements.filter((x): x is ts.FunctionDeclaration => ts.isFunctionDeclaration(x) && x.name?.text === entry.fn && !!x.body && !!x.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword));
    if (fns.length !== 1) return "edit_entry_not_exported";
    enqueue(fns[0]!);
    bindCtx(fns[0]!, entry.args);
  }
  const moduleDataUse = (id: ts.Identifier, decl: ts.VariableDeclaration): void => {
    const init = decl.initializer ? unwrap(decl.initializer) : undefined;
    if (!init) { fail("edit_hidden_state"); return; }
    const primitive = ts.isStringLiteral(init) || ts.isNumericLiteral(init) || ts.isNoSubstitutionTemplateLiteral(init) || ts.isTemplateExpression(init) || init.kind === ts.SyntaxKind.TrueKeyword || init.kind === ts.SyntaxKind.FalseKeyword || init.kind === ts.SyntaxKind.NullKeyword || (ts.isPrefixUnaryExpression(init) && ts.isNumericLiteral(init.operand)) || ts.isBinaryExpression(init);
    if (primitive) return;
    if (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) { enqueue(init); return; }
    if (ts.isIdentifier(init) || ts.isPropertyAccessExpression(init)) { fail("edit_hidden_state"); return; }
    const regex = ts.isRegularExpressionLiteral(init);
    const sticky = regex && /\/[a-z]*[gy][a-z]*$/.test(init.text);
    // read-only positions only
    let e: ts.Node = id;
    while (ts.isParenthesizedExpression(e.parent) || ts.isNonNullExpression(e.parent) || ts.isAsExpression(e.parent)) e = e.parent;
    const p = e.parent;
    if (ts.isCallExpression(p) && p.arguments.includes(e as ts.Expression) && regex) {
      const callee = p.expression;
      if (ts.isPropertyAccessExpression(callee) && STRING_REGEX_SINKS.has(callee.name.text) && p.arguments[0] === e) return;
      fail("edit_hidden_state"); return;
    }
    if (sticky) { fail("edit_hidden_state"); return; }
    if (ts.isPropertyAccessExpression(p) && p.expression === e) {
      if (isWriteTarget(p)) { fail("edit_hidden_state"); return; }
      const call = ts.isCallExpression(p.parent) && p.parent.expression === p;
      if (call && !NONMUTATING.has(p.name.text)) fail("edit_hidden_state");
      return;
    }
    if (ts.isElementAccessExpression(p) && p.expression === e) { if (isWriteTarget(p)) fail("edit_hidden_state"); return; }
    if (ts.isSpreadElement(p) || ts.isSpreadAssignment(p)) return;
    if (ts.isForOfStatement(p) && p.expression === e) return;
    if (ts.isBinaryExpression(p) && p.right === e && p.operatorToken.kind === ts.SyntaxKind.InKeyword) return;
    fail("edit_hidden_state");
  };
  const isWriteTarget = (n: ts.Node): boolean => {
    let e: ts.Node = n;
    while (ts.isParenthesizedExpression(e.parent) || ts.isNonNullExpression(e.parent)) e = e.parent;
    const p = e.parent;
    if (ts.isBinaryExpression(p) && p.left === e && p.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && p.operatorToken.kind <= ts.SyntaxKind.LastAssignment) return true;
    if ((ts.isPrefixUnaryExpression(p) || ts.isPostfixUnaryExpression(p)) && (p.operator === ts.SyntaxKind.PlusPlusToken || p.operator === ts.SyntaxKind.MinusMinusToken)) return true;
    if (ts.isDeleteExpression(p)) return true;
    if ((ts.isArrayLiteralExpression(p) || ts.isObjectLiteralExpression(p) || ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p) || ts.isSpreadElement(p)) && isWriteTarget(p)) return true;
    if (ts.isForOfStatement(p) && p.initializer === e) return true;
    return false;
  };
  const resolveAlias = (s: ts.Symbol, id: ts.Node): { decl: ts.Declaration } | { builtin: string; name: string } | null => {
    const d = s.declarations?.[0];
    let imp: ts.Node | undefined = d;
    while (imp && !ts.isImportDeclaration(imp)) imp = imp.parent;
    if (imp && ts.isImportDeclaration(imp) && ts.isStringLiteral(imp.moduleSpecifier) && !imp.moduleSpecifier.text.startsWith(".")) {
      if (!d || !ts.isImportSpecifier(d)) return null;
      return { builtin: imp.moduleSpecifier.text, name: (d.propertyName ?? d.name).text };
    }
    if (d && ts.isNamespaceImport(d)) return null;
    const t = checker.getAliasedSymbol(s);
    const td = declOf(t);
    void id;
    return td ? { decl: td } : null;
  };
  const moduleDecl = (decl: ts.Declaration, id: ts.Identifier): void => {
    const p = id.parent;
    const called = (ts.isCallExpression(p) && p.expression === id) || (ts.isNewExpression(p) && p.expression === id);
    if (loadRef.current && !called && (ts.isFunctionDeclaration(decl) || ts.isClassDeclaration(decl))) return;
    if (ts.isFunctionDeclaration(decl)) { if (decl.body) enqueue(decl); else { const impl = decl.parent && ts.isSourceFile(decl.parent) ? decl.parent.statements.find((s) => ts.isFunctionDeclaration(s) && s.name?.text === decl.name?.text && s.body) : undefined; if (impl) enqueue(impl as ts.FunctionDeclaration); else fail("edit_unresolved_function"); } return; }
    if (ts.isClassDeclaration(decl)) {
      if (ts.isNewExpression(p) && p.expression === id) { wholeClass(decl); return; }
      if (ts.isBinaryExpression(p) && p.right === id && p.operatorToken.kind === ts.SyntaxKind.InstanceOfKeyword) return;
      if (ts.isPropertyAccessExpression(p) && p.expression === id) {
        const ms = decl.members.filter((m) => isStaticMember(m) && memberName(m) === p.name.text);
        if (ms.length !== 1) { fail("edit_class_escape"); return; }
        const m = ms[0]!;
        if (ts.isMethodDeclaration(m) && m.body) { enqueue(m); return; }
        if (ts.isPropertyDeclaration(m) && m.initializer && (ts.getModifiers(m) ?? []).some((x) => x.kind === ts.SyntaxKind.ReadonlyKeyword) && inertAtLoad(m.initializer) && !isWriteTarget(p)) return;
        fail("edit_hidden_state"); return;
      }
      fail("edit_class_escape"); return;
    }
    if (ts.isEnumDeclaration(decl) || ts.isEnumMember(decl)) return;
    if (ts.isVariableDeclaration(decl)) {
      const list = decl.parent;
      if (!ts.isVariableDeclarationList(list) || !(list.flags & ts.NodeFlags.Const)) { fail("edit_hidden_state"); return; }
      if (isWriteTarget(id)) { fail("edit_global_write"); return; }
      if (loadRef.current) { const init = decl.initializer ? unwrap(decl.initializer) : undefined; if (init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) && ts.isCallExpression(id.parent) && id.parent.expression === id) enqueue(init); return; }
      moduleDataUse(id, decl);
      return;
    }
    if (ts.isInterfaceDeclaration(decl) || ts.isTypeAliasDeclaration(decl)) return;
    fail("edit_unresolved_reference");
  };
  const ctxOf = (n: ts.Node): { params: Map<ts.Symbol, Injection["args"][number]>; args: Injection["args"] } | undefined => {
    for (let a: ts.Node | undefined = n; a; a = a.parent) { const c0 = ctx.get(a); if (c0) return c0; if (ts.isSourceFile(a)) return undefined; }
    return undefined;
  };
  /** A capability default whose right side is skipped because the test injects it. */
  const injectedDefault = (n: ts.BinaryExpression): boolean => {
    if (n.operatorToken.kind !== ts.SyntaxKind.QuestionQuestionToken && n.operatorToken.kind !== ts.SyntaxKind.BarBarToken) return false;
    const c0 = ctxOf(n);
    if (!c0) return false;
    const l = unwrap(n.left);
    const id = ts.isPropertyAccessExpression(l) && ts.isIdentifier(l.expression) ? l.expression : ts.isIdentifier(l) ? l : null;
    if (!id) return false;
    const s = checker.getSymbolAtLocation(id);
    if (!s || !c0.params.has(s)) return false;
    const inj = c0.params.get(s);
    if (ts.isPropertyAccessExpression(l)) return !!inj && inj !== "data" && inj.keys.has(l.name.text);
    return inj !== null && inj !== undefined;
  };
  const paramUseProblem = (u: ts.Node): void => {
    // in an entry unit, an injected parameter is only ever read (P.k, or P itself as a param property); never written
    const c0 = ctx.get(u);
    if (!c0) return;
    const v = (n: ts.Node): void => {
      if (ts.isIdentifier(n) && !isDeclName(n) && !inTypePosition(n)) {
        const s = checker.getSymbolAtLocation(n);
        if (s && c0.params.has(s)) {
          if (isWriteTarget(n)) fail("edit_param_write");
          const p = n.parent;
          if (ts.isPropertyAccessExpression(p) && p.expression === n && isWriteTarget(p)) fail("edit_param_write");
          if (ts.isElementAccessExpression(p) && p.expression === n && isWriteTarget(p)) fail("edit_param_write");
        }
      }
      ts.forEachChild(n, v);
    };
    v(u);
  };
  const walk = (u: Unit): void => {
    paramUseProblem(u);
    const cls = ts.isClassDeclaration(u.parent) ? u.parent : null;
    const load = shallow.has(u);
    loadRef.current = load;
    const visit = (n: ts.Node): void => {
      if (problem) return;
      current = n;
      if (load && isFunctionLike(n)) return; // not run at load; walked in full if called
      if (load && ts.isClassExpression(n)) { fail("edit_module_load"); return; }
      // parameter defaults of an entry unit: skipped only when the test passes that argument
      if (ts.isParameter(n) && n.initializer) {
        const c0 = ctx.get(n.parent);
        const idx = (n.parent as ts.FunctionLikeDeclaration).parameters.indexOf(n);
        const inj = c0 ? [...c0.params.entries()].find(([s]) => declOf(s) === n)?.[1] ?? c0.args[idx] ?? null : null;
        if (!(c0 && inj)) visit(n.initializer);
        return;
      }
      if (ts.isBinaryExpression(n) && injectedDefault(n)) { visit(n.left); return; }
      if (ts.isDecorator(n)) { fail("edit_decorator"); return; }
      if (ts.isMetaProperty(n) || (ts.isCallExpression(n) && n.expression.kind === ts.SyntaxKind.ImportKeyword)) { fail("edit_dynamic_import"); return; }
      if (ts.isWithStatement(n) || ts.isDebuggerStatement(n)) { fail("edit_grammar"); return; }
      if (n.kind === ts.SyntaxKind.SuperKeyword) { fail("edit_class_extends"); return; }
      if (ts.isTypeNode(n) && !ts.isExpressionWithTypeArguments(n)) return;
      if (ts.isPropertyAccessExpression(n)) {
        const name = n.name.text;
        if (REFLECTION.has(name)) { fail("edit_reflection"); return; }
        const isCall = ts.isCallExpression(n.parent) && n.parent.expression === n;
        if (isCall && LOCAL_TIME.test(name)) { fail("edit_local_time"); return; }
        const recv = unwrap(n.expression);
        if (recv.kind === ts.SyntaxKind.ThisKeyword && cls) {
          const ms = cls.members.filter((m) => !isStaticMember(m) && memberName(m) === (ts.isPrivateIdentifier(n.name) ? n.name.text : name));
          for (const m of ms) if ((ts.isMethodDeclaration(m) || ts.isGetAccessorDeclaration(m) || ts.isSetAccessorDeclaration(m)) && m.body) enqueue(m);
          visit(n.name); return;
        }
        if (ts.isIdentifier(recv) && !checker.getSymbolAtLocation(recv) && GLOBAL_MEMBER_DENY.has(`${recv.text}.${name}`)) { fail(`edit_io_global:${recv.text}.${name}`); return; }
      }
      if (ts.isElementAccessExpression(n)) {
        const a = unwrap(n.argumentExpression);
        if ((ts.isStringLiteral(a) || ts.isNoSubstitutionTemplateLiteral(a)) && (REFLECTION.has(a.text) || LOCAL_TIME.test(a.text))) { fail("edit_reflection"); return; }
        const recv = unwrap(n.expression);
        if (ts.isIdentifier(recv) && !checker.getSymbolAtLocation(recv)) { fail(`edit_io_global:${recv.text}`); return; }
        if (!(ts.isStringLiteral(a) || ts.isNumericLiteral(a))) {
          // Auditor #489: a computed key may name anything (constructor, __proto__, a clock getter, ...), built from
          // strings at run time. A computed CALL is refused outright; otherwise the access is allowed ONLY when the
          // receiver's root is injected data from the entry's own parameters. Every other receiver fails closed.
          if (ts.isCallExpression(n.parent) && n.parent.expression === n) { fail("edit_computed_call"); return; }
          const r = rootOf(recv);
          if (!ts.isIdentifier(r) && r.kind !== ts.SyntaxKind.ThisKeyword) { fail("edit_computed_access"); return; }
        }
      }
      if (n.kind === ts.SyntaxKind.ThisKeyword) {
        const p = n.parent;
        if (!(ts.isPropertyAccessExpression(p) && p.expression === n) && cls) wholeClass(cls);
      }
      if (ts.isBinaryExpression(n) || ts.isPrefixUnaryExpression(n) || ts.isPostfixUnaryExpression(n) || ts.isDeleteExpression(n)) {
        const target = ts.isBinaryExpression(n) ? (n.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && n.operatorToken.kind <= ts.SyntaxKind.LastAssignment ? n.left : null)
          : ts.isDeleteExpression(n) ? n.expression : (n.operator === ts.SyntaxKind.PlusPlusToken || n.operator === ts.SyntaxKind.MinusMinusToken ? n.operand : null);
        if (target && !ts.isArrayLiteralExpression(target) && !ts.isObjectLiteralExpression(target)) {
          const r = rootOf(target);
          if (ts.isIdentifier(r)) {
            const s = checker.getSymbolAtLocation(r);
            const d = declOf(s);
            if (!s || !d) { fail("edit_global_write"); return; }
            if (s.flags & ts.SymbolFlags.Alias) { fail("edit_global_write"); return; }
            if (!containingFunction(d) && !ts.isParameter(d)) { fail("edit_global_write"); return; }
          } else if (r.kind !== ts.SyntaxKind.ThisKeyword) {
            // Auditor #489: a write whose root is not a plain identifier or `this` (e.g. `({} as any)[k].x = ...`)
            // can reach Object.prototype or another shared object; refuse it outright.
            fail("edit_global_write"); return;
          }
        }
      }
      if (ts.isIdentifier(n) && !isDeclName(n) && !inTypePosition(n)) {
        const p = n.parent;
        if (n.text === "arguments") { fail("edit_grammar"); return; }
        if (n.text === "undefined" && !declOf(checker.getSymbolAtLocation(n))) { ts.forEachChild(n, visit); return; }
        const s = ts.isShorthandPropertyAssignment(p) && p.name === n ? checker.getShorthandAssignmentValueSymbol(p) : checker.getSymbolAtLocation(n);
        if (!s) {
          const g = GLOBAL_OK[n.text];
          if (!g || !Object.hasOwn(GLOBAL_OK, n.text)) { fail(`edit_io_global:${n.text}`); return; }
          if (ts.isNewExpression(p) && p.expression === n && !g.ctor) { fail(`edit_io_global:new ${n.text}`); return; }
        } else if (s.flags & ts.SymbolFlags.Alias) {
          const r = resolveAlias(s, n);
          if (!r) { fail("edit_import_unresolved"); return; }
          if ("builtin" in r) {
            if ((r.builtin === "node:crypto" || r.builtin === "crypto") && CRYPTO_OK.has(r.name)) { /* deterministic hashing */ }
            else { fail(`edit_io_import:${r.builtin}`); return; }
          } else if (!containingFunction(r.decl)) moduleDecl(r.decl, n);
          else { fail("edit_unresolved_reference"); return; }
        } else {
          const d = declOf(s);
          if (!d) { fail("edit_unresolved_reference"); return; }
          if (ts.isParameter(d) || containingFunction(d) || ts.isTypeParameterDeclaration(d)) { /* local */ }
          else if (ts.isSourceFile(d.parent) || (ts.isVariableDeclarationList(d.parent) && ts.isSourceFile(d.parent.parent.parent)) || ts.isEnumMember(d)) moduleDecl(d, n);
          else if (ts.isPropertyDeclaration(d) || ts.isMethodDeclaration(d)) { /* member names via shorthand etc. */ }
          else if (ts.isCatchClause(d.parent) || ts.isVariableDeclaration(d)) { /* local */ }
          else { fail("edit_unresolved_reference"); return; }
        }
      }
      ts.forEachChild(n, visit);
    };
    if (ts.isPropertyDeclaration(u)) { if (u.initializer) visit(u.initializer); }
    else if (load || !isFunctionLike(u)) visit(u);
    else {
      for (const prm of u.parameters) visit(prm);
      if (u.body) visit(u.body);
    }
  };
  let steps = 0;
  while (queue.length && !problem) {
    if (++steps > MAX_UNITS) return "edit_reach_too_large";
    walk(queue.shift()!);
  }
  return problem ?? { reached };
}

// ---------------------------------------------------------------------------------------------------------------
// G2: the fake-driven test (fakes: recorded-object-literal-v1; test: new-file-fake-driven)
// ---------------------------------------------------------------------------------------------------------------
const OUTCOMES = new Set(["resolves", "returns", "rejects", "throws"]);
const ISO_Z = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
export const MAX_ARRAY_ITEMS = 50;
export const MAX_STRING_CHARS = 400;

function parseExpression(text: string): ts.Expression | null {
  if (text.includes("\n") || hasComment(text)) return null;
  const sf = ts.createSourceFile("e.ts", `(${text});`, ts.ScriptTarget.Latest, true);
  if (diag(sf) || sf.statements.length !== 1 || !ts.isExpressionStatement(sf.statements[0]!)) return null;
  const e = (sf.statements[0] as ts.ExpressionStatement).expression;
  return ts.isParenthesizedExpression(e) ? e.expression : null;
}

type Ctx = { fakes: Map<string, ts.Expression> };
const literalString = (e: ts.Expression): string | null => (ts.isStringLiteral(e) && e.text.length <= MAX_STRING_CHARS && !REFLECTION.has(e.text) ? e.text : null);
const callName = (e: ts.Expression): string | null => (ts.isCallExpression(e) && ts.isIdentifier(e.expression) && !e.typeArguments && !e.questionDotToken ? e.expression.text : null);

/** Data values: literals, arrays, objects (plain keys), bytes("t"), date("ISO-Z"), response(status[, "body"[, {headers}]]), earlier fake names. Emitted as TS, or null. */
function emitData(e: ts.Expression, c: Ctx, opts: { fakes: boolean; response: boolean }): string | null {
  if (ts.isStringLiteral(e)) return literalString(e) === null ? null : JSON.stringify(e.text);
  if (ts.isNumericLiteral(e)) return Number.isFinite(Number(e.text)) && e.text.length <= 20 ? e.text : null;
  if (ts.isPrefixUnaryExpression(e) && e.operator === ts.SyntaxKind.MinusToken && ts.isNumericLiteral(e.operand)) return `-${e.operand.text}`;
  if (e.kind === ts.SyntaxKind.TrueKeyword) return "true";
  if (e.kind === ts.SyntaxKind.FalseKeyword) return "false";
  if (e.kind === ts.SyntaxKind.NullKeyword) return "null";
  if (ts.isIdentifier(e)) {
    if (e.text === "undefined") return "undefined";
    return opts.fakes && c.fakes.has(e.text) ? e.text : null;
  }
  if (ts.isArrayLiteralExpression(e)) {
    if (e.elements.length > MAX_ARRAY_ITEMS) return null;
    const xs = e.elements.map((x) => (ts.isSpreadElement(x) || ts.isOmittedExpression(x) ? null : emitData(x, c, opts)));
    return xs.every((x) => x !== null) ? `[${xs.join(", ")}]` : null;
  }
  if (ts.isObjectLiteralExpression(e)) {
    if (e.properties.length > MAX_ARRAY_ITEMS) return null;
    const out: string[] = [];
    const seen = new Set<string>();
    for (const p of e.properties) {
      if (!ts.isPropertyAssignment(p)) return null;
      const k = ts.isIdentifier(p.name) ? p.name.text : ts.isStringLiteral(p.name) ? p.name.text : null;
      if (k === null || REFLECTION.has(k) || seen.has(k)) return null;
      seen.add(k);
      const v = emitData(p.initializer, c, opts);
      if (v === null) return null;
      out.push(`${/^[A-Za-z_$][\w$]*$/.test(k) ? k : JSON.stringify(k)}: ${v}`);
    }
    return `{ ${out.join(", ")} }`;
  }
  const name = callName(e);
  if (name && ts.isCallExpression(e)) {
    const a = e.arguments;
    if (name === "bytes" && a.length === 1 && literalString(a[0]!) !== null) return `new TextEncoder().encode(${JSON.stringify((a[0] as ts.StringLiteral).text)})`;
    if (name === "date" && a.length === 1 && ts.isStringLiteral(a[0]!) && ISO_Z.test(a[0].text) && Number.isFinite(Date.parse(a[0].text))) return `new Date(${JSON.stringify(a[0].text)})`;
    if (name === "response" && opts.response && a.length >= 1 && a.length <= 3 && ts.isNumericLiteral(a[0]!)) {
      const status = Number(a[0].text);
      if (!Number.isInteger(status) || status < 200 || status > 599) return null;
      const nullBody = status === 204 || status === 205 || status === 304;
      if (a.length >= 2 && (nullBody || literalString(a[1]!) === null)) return null;
      let headers = "";
      if (a.length === 3) {
        const h = a[2]!;
        if (!ts.isObjectLiteralExpression(h) || !h.properties.every((p) => ts.isPropertyAssignment(p) && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) && literalString(p.initializer) !== null)) return null;
        headers = `, headers: ${emitData(h, c, { fakes: false, response: false })}`;
      }
      return `new Response(${a.length >= 2 ? JSON.stringify((a[1] as ts.StringLiteral).text) : "null"}, { status: ${status}${headers} })`;
    }
  }
  return null;
}

/** One fake outcome: resolves(V) / returns(V) / rejects("m") / throws("m"); or sequence(o1, o2, ..) (the last repeats). */
function emitOutcomes(e: ts.Expression, c: Ctx): string | null {
  const name = callName(e);
  if (!name || !ts.isCallExpression(e)) return null;
  if (name === "sequence") {
    if (e.arguments.length < 1 || e.arguments.length > 8 || e.arguments.some((x) => callName(x) === "sequence")) return null;
    const xs = e.arguments.map((x) => emitOutcomes(x, c));
    return xs.every((x) => x !== null) ? xs.join(", ") : null;
  }
  if (!OUTCOMES.has(name) || e.arguments.length > 1) return null;
  if (name === "rejects" || name === "throws") {
    if (e.arguments.length !== 1 || literalString(e.arguments[0]!) === null) return null;
    return `{ kind: "${name}", value: () => (${JSON.stringify((e.arguments[0] as ts.StringLiteral).text)}) }`;
  }
  const v = e.arguments.length ? emitData(e.arguments[0]!, c, { fakes: true, response: true }) : "undefined";
  return v === null ? null : `{ kind: "${name}", value: () => (${v}) }`;
}

/** A fake: an outcome fake (a recorded function), or an object literal of outcome fakes and data. */
function emitFake(e: ts.Expression, c: Ctx): { code: string; keys: Set<string> | null } | null {
  if (callName(e) && OUTCOMES.has(callName(e)!) || callName(e) === "sequence") {
    const o = emitOutcomes(e, c);
    return o === null ? null : { code: `fakeFn([${o}])`, keys: null };
  }
  if (!ts.isObjectLiteralExpression(e) || e.properties.length > MAX_ARRAY_ITEMS) return null;
  const out: string[] = [];
  const keys = new Set<string>();
  for (const p of e.properties) {
    if (!ts.isPropertyAssignment(p)) return null;
    const k = ts.isIdentifier(p.name) ? p.name.text : ts.isStringLiteral(p.name) ? p.name.text : null;
    if (k === null || REFLECTION.has(k) || keys.has(k)) return null;
    const fn = callName(p.initializer);
    const v = fn && (OUTCOMES.has(fn) || fn === "sequence") ? ((o) => (o === null ? null : `fakeFn([${o}])`))(emitOutcomes(p.initializer, c)) : emitData(p.initializer, c, { fakes: true, response: true });
    if (v === null) return null;
    if (p.initializer.kind !== ts.SyntaxKind.NullKeyword && !(ts.isIdentifier(p.initializer) && p.initializer.text === "undefined")) keys.add(k);
    out.push(`${/^[A-Za-z_$][\w$]*$/.test(k) ? k : JSON.stringify(k)}: ${v}`);
  }
  return { code: `{ ${out.join(", ")} }`, keys };
}

export type CallShape = { entry: Entry | FnEntry; code: string; names: string[] };

/** CALL: `new C(args).m(args)` or `f(args)`; every argument a data value (fake names allowed), cast `as never` for the type checker. */
function emitCall(e: ts.Expression, c: Ctx, fakeKeys: Map<string, Set<string> | null>): CallShape | null {
  if (!ts.isCallExpression(e) || e.questionDotToken || e.typeArguments || e.arguments.length > 6) return null;
  const inj = (a: ts.Expression): Injection["args"][number] => {
    if (a.kind === ts.SyntaxKind.NullKeyword || (ts.isIdentifier(a) && a.text === "undefined")) return null;
    if (ts.isIdentifier(a) && fakeKeys.has(a.text)) { const k = fakeKeys.get(a.text); return k ? { keys: k } : "data"; }
    if (ts.isObjectLiteralExpression(a)) return { keys: new Set(a.properties.filter((p) => ts.isPropertyAssignment(p) && p.initializer.kind !== ts.SyntaxKind.NullKeyword && !(ts.isIdentifier(p.initializer) && p.initializer.text === "undefined")).map((p) => ((p as ts.PropertyAssignment).name as ts.Identifier).text)) };
    return "data";
  };
  const args = (xs: readonly ts.Expression[]): { code: string; inj: Injection["args"] } | null => {
    const cs = xs.map((x) => emitData(x, c, { fakes: true, response: false }));
    if (!cs.every((x) => x !== null)) return null;
    return { code: cs.map((x) => `${x} as never`).join(", "), inj: xs.map(inj) };
  };
  const callArgs = args(e.arguments);
  if (!callArgs) return null;
  const callee = e.expression;
  if (ts.isIdentifier(callee)) {
    if (c.fakes.has(callee.text) || ["bytes", "date", "response", "resolves", "returns", "rejects", "throws", "sequence"].includes(callee.text)) return null;
    return { entry: { kind: "call", fn: callee.text, args: callArgs.inj }, code: `${callee.text}(${callArgs.code})`, names: [callee.text] };
  }
  if (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.name) && !callee.questionDotToken) {
    const n = unwrap(callee.expression);
    if (!ts.isNewExpression(n) || !ts.isIdentifier(n.expression) || n.typeArguments || (n.arguments?.length ?? 0) > 6) return null;
    const ctor = args(n.arguments ?? []);
    if (!ctor || c.fakes.has(n.expression.text)) return null;
    return { entry: { kind: "new", cls: n.expression.text, method: callee.name.text, args: callArgs.inj, ctorArgs: ctor.inj }, code: `new ${n.expression.text}(${ctor.code}).${callee.name.text}(${callArgs.code})`, names: [n.expression.text] };
  }
  return null;
}

/** The unique split of `text` at `sep` where both sides satisfy `ok`. */
function uniqueSplit<T>(text: string, sep: string, ok: (l: string, r: string) => T | null): T | null {
  const hits: T[] = [];
  for (let i = text.indexOf(sep); i !== -1; i = text.indexOf(sep, i + 1)) {
    const r = ok(text.slice(0, i).trim(), text.slice(i + sep.length).trim());
    if (r !== null) hits.push(r);
  }
  return hits.length === 1 ? hits[0]! : null;
}

export interface FakeTest { decls: string[]; checks: string[]; calls: CallShape[]; names: Set<string> }

/**
 * The test bullets: `- fake NAME = FAKE` and `- expect CALL resolves to V` / `- expect CALL returns V` /
 * `- expect CALL rejects with "MSG"` / `- expect CALL throws "MSG"` / `- expect NAME[.k] is called N times`.
 * Every `- fake ` / `- expect ` line must parse; at least one CALL expectation; at most MAX_BULLETS bullets.
 */
export function parseFakeTest(lines: readonly string[]): FakeTest | null {
  const bullets = lines.filter((l) => /^- (?:fake|expect) /.test(l));
  if (!bullets.length || bullets.length > MAX_BULLETS) return null;
  const c: Ctx = { fakes: new Map() };
  const fakeKeys = new Map<string, Set<string> | null>();
  const decls: string[] = [], checks: string[] = [], calls: CallShape[] = [];
  const names = new Set<string>();
  for (const b of bullets) {
    let m = /^- fake ([A-Za-z][\w$]*) = (.+)$/.exec(b);
    if (m) {
      const name = m[1]!;
      if (c.fakes.has(name) || ["assert", "test", "fakeFn", "settle", "settleSync", "bytes", "date", "response"].includes(name) || GLOBAL_OK[name]) return null;
      const e = parseExpression(m[2]!);
      if (!e) return null;
      const f = emitFake(e, c) ?? ((d) => (d === null ? null : { code: d, keys: ts.isObjectLiteralExpression(e) ? new Set(e.properties.map((p) => ((p as ts.PropertyAssignment).name as ts.Identifier).text)) : null }))(emitData(e, c, { fakes: true, response: false }));
      if (!f) return null;
      c.fakes.set(name, e);
      fakeKeys.set(name, f.keys);
      decls.push(`  const ${name} = ${f.code};`);
      continue;
    }
    if (!b.startsWith("- expect ")) return null;
    const rest = b.slice(9);
    m = /^([A-Za-z][\w$]*)(?:\.([A-Za-z_$][\w$]*))? is called (\d{1,3}) times?$/.exec(rest);
    if (m) {
      const fake = c.fakes.get(m[1]!);
      if (!fake) return null;
      if (m[2]) {
        if (!ts.isObjectLiteralExpression(fake)) return null;
        const prop = fake.properties.find((p) => ts.isPropertyAssignment(p) && ((ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) && p.name.text === m![2])) as ts.PropertyAssignment | undefined;
        const fn = prop ? callName(prop.initializer) : null;
        if (!fn || !(OUTCOMES.has(fn) || fn === "sequence")) return null;
      } else if (!(callName(fake) && (OUTCOMES.has(callName(fake)!) || callName(fake) === "sequence"))) return null;
      checks.push(`  assert.equal(${m[1]}${m[2] ? `.${m[2]}` : ""}.calls.length, ${Number(m[3])});`);
      continue;
    }
    const outcome = (sep: string, kind: "resolves" | "returns" | "rejects" | "throws") => uniqueSplit(rest, sep, (l, r) => {
      const ce = parseExpression(l), re = parseExpression(r);
      if (!ce || !re) return null;
      const call = emitCall(ce, c, fakeKeys);
      if (!call) return null;
      if (kind === "rejects" || kind === "throws") {
        const msg = literalString(re);
        if (msg === null) return null;
        return { call, check: `  assert.deepEqual(${kind === "rejects" ? "await settle" : "settleSync"}(() => ${call.code}), { ok: false, message: ${JSON.stringify(msg)} });` };
      }
      const v = emitData(re, c, { fakes: false, response: false });
      if (v === null) return null;
      return { call, check: `  assert.deepEqual(${kind === "resolves" ? "await settle" : "settleSync"}(() => ${call.code}), { ok: true, value: ${v} });` };
    });
    const hits = [outcome(" resolves to ", "resolves"), outcome(" returns ", "returns"), outcome(" rejects with ", "rejects"), outcome(" throws ", "throws")].filter((x) => x !== null);
    if (hits.length !== 1) return null;
    calls.push(hits[0]!.call);
    checks.push(hits[0]!.check);
    for (const n of hits[0]!.call.names) names.add(n);
  }
  if (!calls.length) return null;
  return { decls, checks, calls, names };
}

/** The fixed harness every M98 test carries (Job B checks it byte for byte). */
export const FAKE_HARNESS = `// M98 (public-existing-function-edit-v1): every collaborator is a recorded, injected object-literal fake; the test
// reads no clock, environment, network, timer or global, and each outcome is captured, so a pre-edit failure is an
// assertion failure.
type Outcome = { kind: "resolves" | "returns" | "rejects" | "throws"; value: () => unknown };
type Fake = ((...args: unknown[]) => unknown) & { calls: unknown[][] };
function fakeFn(outcomes: Outcome[]): Fake {
  const calls: unknown[][] = [];
  const fn = (...args: unknown[]): unknown => {
    calls.push(args);
    const o = outcomes[Math.min(calls.length, outcomes.length) - 1]!;
    if (o.kind === "returns") return o.value();
    if (o.kind === "resolves") return Promise.resolve(o.value());
    if (o.kind === "rejects") return Promise.reject(new Error(String(o.value())));
    throw new Error(String(o.value()));
  };
  return Object.assign(fn, { calls });
}
type Settled = { ok: true; value: unknown } | { ok: false; message: string };
async function settle(run: () => unknown): Promise<Settled> {
  try {
    return { ok: true, value: await run() };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
}
function settleSync(run: () => unknown): Settled {
  try {
    return { ok: true, value: run() };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
}
`;

export function emitFakeTest(modPath: string, testPath: string, title: string, t: FakeTest, style: "ts" | "none"): string {
  const dir = testPath.slice(0, testPath.lastIndexOf("/") + 1);
  const rel = modPath.startsWith(dir) ? `./${modPath.slice(dir.length)}` : null;
  if (!rel) throw new Error("test outside module dir");
  const spec = style === "ts" ? rel : rel.replace(/\.ts$/, "");
  const used = (code: string) => /\bsettleSync\(/.test(code);
  void used;
  return [
    `import assert from "node:assert/strict";`,
    `import test from "node:test";`,
    `import { ${[...t.names].sort().join(", ")} } from ${JSON.stringify(spec)};`,
    ``,
    FAKE_HARNESS,
    `test(${JSON.stringify(title)}, async () => {`,
    ...t.decls,
    ...t.checks,
    `});`,
    ``,
  ].join("\n");
}

// ---------------------------------------------------------------------------------------------------------------
// apply
// ---------------------------------------------------------------------------------------------------------------
const okParams = (p: Record<string, string | string[]>): boolean =>
  Object.keys(p).sort().join(",") === [...EXISTING_EDIT_PARAM_KEYS].join(",") && EXISTING_EDIT_PARAM_KEYS.every((k) => typeof p[k] === "string" && EXISTING_EDIT_VOCAB[k].length === 1 && EXISTING_EDIT_VOCAB[k].includes(p[k] as string));

/** Hermetic for every CALL, on one source state: load closure inert, every entry's reach clean; returns whether the target was reached. */
export function hermeticProblem(modPath: string, read: Read, calls: readonly CallShape[], target: string, override?: { path: string; content: string }): string | { targetReached: boolean } {
  const c = loadClosure(modPath, read, override);
  if (typeof c === "string") return c;
  const lp = loadProblem(c, modPath);
  if (lp) return lp;
  const sf = c.files.get(modPath)!;
  const t = findTarget(sf, target);
  if (!t) return "edit_target_missing";
  let targetReached = false;
  for (const call of calls) {
    for (const n of call.names) {
      const exported = sf.statements.some((s) => (ts.isClassDeclaration(s) || ts.isFunctionDeclaration(s)) && s.name?.text === n && s.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword));
      if (!exported) return "edit_entry_not_exported";
    }
    const r = reachProblem(c, modPath, call.entry);
    if (typeof r === "string") return r;
    if (r.reached.has(t.node)) targetReached = true;
  }
  return { targetReached };
}

export const existingEditSlug = (target: string): string => target.replace(/([a-z0-9])([A-Z])/g, "$1-$2").replace(/[^A-Za-z0-9]+/g, "-").toLowerCase().replace(/^-|-$/g, "").slice(0, 40);

export function applyExistingEditRule(trigger: string, params: Record<string, string | string[]>, objective: string, files: readonly { path: string; content: string }[], isTest: (p: string) => boolean = (p) => /\.test\.ts$/.test(p)): ExistingEdit | null {
  return existingEditDetail(trigger, params, objective, files, isTest).edit;
}

// ---------------------------------------------------------------------------------------------------------------
// Auditor #489 hole 4 (credit): the `replace statement OLD with NEW` SPLICE trigger is DISABLED.
//
// In that phrasing the issue supplies NEW, the full new code, and the engine only splices it in, so PeaceAI writes
// none of the code it would be credited with. The production entry (existingEditDetail, used by learned.ts applyRule
// and applyExistingEditRule) therefore refuses EVERY task with `edit_splice_disabled`, whatever the edit is: no
// splice can land as a PeaceAI skill. The gates below stay, because a DERIVED edit must pass exactly the same ones.
//
// TODO(DERIVE_FROM_BEHAVIOR v1): when the reusable derive-from-examples engine (branch m99/derive-from-behavior,
// peaceai/lib/derive.ts) lands, set EXISTING_EDIT_DERIVER to an adapter around it and give EXISTING_EDIT a
// behavior-only trigger (target + behavior + G2 fake/expect bullets, NO code; refuse code in the behavior text like
// learned-derive.ts behaviorCodeProblem). deriveExistingEditDetail then runs the derived (OLD, NEW) through
// gateSuppliedEdit unchanged: capability delta, hermetic walk, edit_unawaited, Job B. Zero or several derived
// candidates must refuse (fail closed). Until then deriveExistingEditDetail refuses with `edit_derive_pending`.
// ---------------------------------------------------------------------------------------------------------------
export const EXISTING_EDIT_SPLICE_DISABLED = true as const;

/** What a deriver gets: the target, its file, and the behavior-only test bullets (never NEW code). */
export interface ExistingEditBehaviorTask { file: string; target: string; source: string; behavior: string; test: FakeTest }
/** A deriver returns ONE derived statement edit, or a refusal (none or several candidates fit => refuse). */
export type ExistingEditDeriver = (task: ExistingEditBehaviorTask) => { oldText: string; newText: string } | { reason: string };
/** The DERIVE_FROM_BEHAVIOR hook. null until DERIVE_FROM_BEHAVIOR v1 is merged and reviewed (see TODO above). */
export const EXISTING_EDIT_DERIVER: ExistingEditDeriver | null = null;

/** Production entry: the splice trigger is disabled (Auditor #489 hole 4), so every task is refused. */
export function existingEditDetail(trigger: string, params: Record<string, string | string[]>, objective: string, files: readonly { path: string; content: string }[], isTest: (p: string) => boolean = (p) => /\.test\.ts$/.test(p)): { edit: ExistingEdit | null; reason: string | null } {
  void files; void isTest;
  const no = (reason: string) => ({ edit: null, reason });
  if (!okParams(params)) return no("edit_params");
  const re = new RegExp(trigger);
  if (objective.split("\n").map((l) => l.trim()).filter((l) => re.test(l)).length !== 1) return no("edit_trigger");
  return no("edit_splice_disabled");
}

/**
 * The DERIVE_FROM_BEHAVIOR entry (hook). Refuses with `edit_derive_pending` while EXISTING_EDIT_DERIVER is null.
 * When wired, the derived edit goes through gateSuppliedEdit, the same gates a supplied edit had to pass.
 */
export function deriveExistingEditDetail(task: Omit<ExistingEditBehaviorTask, "source" | "test"> & { bullets: readonly string[] }, files: readonly { path: string; content: string }[], isTest: (p: string) => boolean = (p) => /\.test\.ts$/.test(p)): { edit: ExistingEdit | null; reason: string | null } {
  const deriver: ExistingEditDeriver | null = EXISTING_EDIT_DERIVER;
  if (!deriver) return { edit: null, reason: "edit_derive_pending" };
  const file = files.find((f) => f.path === task.file);
  const test = parseFakeTest(task.bullets.map((l) => l.trim()));
  if (!file || !test) return { edit: null, reason: !file ? "edit_path" : "edit_test_grammar" };
  const d = deriver({ file: task.file, target: task.target, source: file.content, behavior: task.behavior, test });
  if ("reason" in d) return { edit: null, reason: d.reason };
  return gateSuppliedEdit(task.target, task.file, d, [`in ${task.target} in ${task.file}: derived from behavior`, ...task.bullets.map((l) => l.trim())], files, isTest);
}

/**
 * GATES ONLY, never an entry point: analyses a SUPPLIED statement edit in the (disabled) splice phrasing against every
 * gate (path, grammar, site, capability delta, hermetic walk, unawaited, test grammar). Used by the negative proofs,
 * the census (site eligibility) and, through gateSuppliedEdit, by a future derived edit.
 */
export function analyzeSuppliedEdit(trigger: string, params: Record<string, string | string[]>, objective: string, files: readonly { path: string; content: string }[], isTest: (p: string) => boolean = (p) => /\.test\.ts$/.test(p)): { edit: ExistingEdit | null; reason: string | null } {
  const no = (reason: string) => ({ edit: null, reason });
  if (!okParams(params)) return no("edit_params");
  const lines = objective.split("\n").map((l) => l.trim());
  const re = new RegExp(trigger);
  const heads = lines.filter((l) => re.test(l));
  if (heads.length !== 1) return no("edit_trigger");
  const g = re.exec(heads[0]!)!.groups ?? {};
  const split = splitBody(g.body ?? "");
  if (!split) {
    const file = files.find((f) => f.path === g.file);
    if (!file || !editablePath(file.path, isTest)) return no("edit_path");
    return no("edit_split");
  }
  return gateSuppliedEdit(g.target!, g.file!, split, [heads[0]!, ...lines.filter((l) => l !== heads[0])], files, isTest);
}

const editablePath = (path: string, isTest: (p: string) => boolean): boolean =>
  !isTest(path) && !isExcludedSource(path) && /^src\/[\w./-]+\.ts$/.test(path) && !path.endsWith(".d.ts") && !PROTECTED_SELF.some((p) => p.pattern.test(path));

/** Every gate for ONE statement edit (oldText -> newText) of `target` in `filePath`; lines[0] is the header line. */
function gateSuppliedEdit(target: string, filePath: string, split: { oldText: string; newText: string }, lines: readonly string[], files: readonly { path: string; content: string }[], isTest: (p: string) => boolean): { edit: ExistingEdit | null; reason: string | null } {
  const no = (reason: string) => ({ edit: null, reason });
  const g = { target };
  const heads = [lines[0]!];
  const file = files.find((f) => f.path === filePath);
  if (!file || !editablePath(file.path, isTest)) return no("edit_path");
  if (newGrammarProblem(parseStatements(split.newText) ?? [], true)) return no("edit_new_grammar");
  // every bullet must be a fake or an expect bullet: a stray check is refused, never silently dropped
  if (lines.some((l) => /^[-*+•] /.test(l) && !/^- (?:fake|expect) /.test(l))) return no("edit_test_grammar");
  const edited = editStatement(file.path, file.content, g.target!, split.oldText, split.newText);
  if (!edited) return no("edit_site");
  // Auditor #489: the edit may not introduce any new capability (global I/O, reflection, `as any`) the base lacked.
  const baseTarget = findTarget(ts.createSourceFile(file.path, file.content, ts.ScriptTarget.Latest, true), g.target!);
  if (baseTarget) { const cap = capabilityDelta(baseTarget.node, edited.target.node); if (cap) return no(cap); }
  const fakeTest = parseFakeTest(lines);
  if (!fakeTest) return no("edit_test_grammar");
  const read: Read = (rel) => { const f = files.find((x) => x.path === rel); return f && !isTest(rel) && !isExcludedSource(rel) ? f.content : null; };
  const before = hermeticProblem(file.path, read, fakeTest.calls, g.target!);
  if (typeof before === "string") return no(before);
  const after = hermeticProblem(file.path, read, fakeTest.calls, g.target!, { path: file.path, content: edited.content });
  if (typeof after === "string") return no(after);
  if (!after.targetReached || !before.targetReached) return no("edit_test_unreached");
  const dir = file.path.slice(0, file.path.lastIndexOf("/") + 1);
  const stem = file.path.slice(dir.length).replace(/\.ts$/, "");
  const id7 = createHash("sha256").update(`${heads[0]}\n${lines.filter((l) => /^- (?:fake|expect) /.test(l)).join("\n")}`).digest("hex").slice(0, 7);
  const testPath = `${dir}${stem}.${existingEditSlug(g.target!)}-${id7}.test.ts`;
  if (files.some((f) => f.path === testPath)) return no("new_test_path_exists");
  const content = emitFakeTest(file.path, testPath, `PeaceAI M98: ${g.target} in ${file.path} (statement edit, injected fakes)`, fakeTest, importStyle(files, isTest));
  return { edit: { path: file.path, content: edited.content, extra: [{ path: testPath, content, create: true }], selfGrade: true }, reason: null };
}

// ---------------------------------------------------------------------------------------------------------------
// Job B re-checks (on the graded tree, never on the task text)
// ---------------------------------------------------------------------------------------------------------------
/** The time zone + locale backstop: the after-tree must pass in every pair (a zone- or locale-dependent result fails one). */
export const EXISTING_EDIT_ENV_RUNS = [
  { TZ: "UTC", LANG: "C.UTF-8", LC_ALL: "C.UTF-8" },
  { TZ: "America/Denver", LANG: "tr_TR.UTF-8", LC_ALL: "tr_TR.UTF-8" },
  { TZ: "Asia/Tokyo", LANG: "ja_JP.UTF-8", LC_ALL: "ja_JP.UTF-8" },
] as const;

const topUnits = (sf: ts.SourceFile): Map<string, string> => {
  const out = new Map<string, string>();
  sf.statements.forEach((st, i) => {
    if (ts.isFunctionDeclaration(st) && st.name && st.body) out.set(`fn:${st.name.text}:${i}`, st.getText(sf));
    else if (ts.isClassDeclaration(st) && st.name) {
      st.members.forEach((m, j) => { out.set(`member:${st.name!.text}:${j}`, m.getText(sf)); });
      out.set(`class:${st.name.text}:${i}`, `${st.members.length}`);
    } else out.set(`stmt:${i}`, st.getText(sf));
  });
  return out;
};

/**
 * The single target the graded edit changed: exactly one module function or class method differs between the base
 * and the graded source, and every other top-level statement and class member is byte-identical. Null otherwise.
 */
export function editConfinedTarget(path: string, baseText: string, realText: string): string | null {
  const a = ts.createSourceFile(path, baseText, ts.ScriptTarget.Latest, true), b = ts.createSourceFile(path, realText, ts.ScriptTarget.Latest, true);
  if (diag(a) || diag(b) || a.statements.length !== b.statements.length) return null;
  const ua = topUnits(a), ub = topUnits(b);
  if (ua.size !== ub.size || [...ua.keys()].some((k) => !ub.has(k))) return null;
  const changed = [...ua.keys()].filter((k) => ua.get(k) !== ub.get(k));
  if (changed.length !== 1) return null;
  const [kind, owner, idx] = changed[0]!.split(":");
  if (kind === "fn") return findTarget(b, owner!) ? owner! : null;
  if (kind !== "member") return null;
  const cls = b.statements.find((s): s is ts.ClassDeclaration => ts.isClassDeclaration(s) && s.name?.text === owner)!;
  const m = cls.members[Number(idx)]!;
  if (!ts.isMethodDeclaration(m) || !ts.isIdentifier(m.name)) return null;
  const t = `${owner}.${m.name.text}`;
  return findTarget(b, t) ? t : null;
}

const HARNESS_HEAD = (spec: string, names: string): string => `import assert from "node:assert/strict";\nimport test from "node:test";\nimport { ${names} } from ${JSON.stringify(spec)};\n\n${FAKE_HARNESS}`;

/** Data as emitted (emitData's output language), checked on the graded test. */
function emittedDataOk(e: ts.Expression, decls: ReadonlySet<string>): boolean {
  const x = e;
  if (ts.isStringLiteral(x)) return x.text.length <= MAX_STRING_CHARS && !REFLECTION.has(x.text);
  if (ts.isNumericLiteral(x)) return true;
  if (ts.isPrefixUnaryExpression(x) && x.operator === ts.SyntaxKind.MinusToken && ts.isNumericLiteral(x.operand)) return true;
  if (x.kind === ts.SyntaxKind.TrueKeyword || x.kind === ts.SyntaxKind.FalseKeyword || x.kind === ts.SyntaxKind.NullKeyword) return true;
  if (ts.isIdentifier(x)) return x.text === "undefined" || decls.has(x.text);
  if (ts.isArrayLiteralExpression(x)) return x.elements.length <= MAX_ARRAY_ITEMS && x.elements.every((y) => !ts.isSpreadElement(y) && !ts.isOmittedExpression(y) && emittedDataOk(y, decls));
  if (ts.isObjectLiteralExpression(x)) return x.properties.length <= MAX_ARRAY_ITEMS && x.properties.every((p) => ts.isPropertyAssignment(p) && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) && !REFLECTION.has(p.name.text) && (emittedDataOk(p.initializer, decls) || emittedFakeFn(p.initializer, decls)));
  if (ts.isCallExpression(x) && ts.isPropertyAccessExpression(x.expression) && x.expression.name.text === "encode" && ts.isNewExpression(x.expression.expression) && ts.isIdentifier(x.expression.expression.expression) && x.expression.expression.expression.text === "TextEncoder" && !(x.expression.expression.arguments?.length) && x.arguments.length === 1 && ts.isStringLiteral(x.arguments[0]!)) return true;
  if (ts.isNewExpression(x) && ts.isIdentifier(x.expression) && x.expression.text === "Date") return x.arguments?.length === 1 && ts.isStringLiteral(x.arguments[0]!) && ISO_Z.test(x.arguments[0].text);
  if (ts.isNewExpression(x) && ts.isIdentifier(x.expression) && x.expression.text === "Response") {
    const a = x.arguments ?? [];
    if (a.length !== 2 || !(ts.isStringLiteral(a[0]!) || a[0]!.kind === ts.SyntaxKind.NullKeyword) || !ts.isObjectLiteralExpression(a[1]!)) return false;
    return a[1].properties.every((p) => ts.isPropertyAssignment(p) && ts.isIdentifier(p.name) && ((p.name.text === "status" && ts.isNumericLiteral(p.initializer)) || (p.name.text === "headers" && ts.isObjectLiteralExpression(p.initializer) && p.initializer.properties.every((h) => ts.isPropertyAssignment(h) && ts.isStringLiteral(h.initializer)))));
  }
  return false;
}
function emittedFakeFn(e: ts.Expression, decls: ReadonlySet<string>): boolean {
  if (!ts.isCallExpression(e) || !ts.isIdentifier(e.expression) || e.expression.text !== "fakeFn" || e.arguments.length !== 1 || !ts.isArrayLiteralExpression(e.arguments[0]!)) return false;
  const os = e.arguments[0].elements;
  return os.length >= 1 && os.length <= 8 && os.every((o) => {
    if (!ts.isObjectLiteralExpression(o) || o.properties.length !== 2) return false;
    const [k, v] = o.properties;
    if (!k || !v || !ts.isPropertyAssignment(k) || !ts.isPropertyAssignment(v) || !ts.isIdentifier(k.name) || k.name.text !== "kind" || !ts.isStringLiteral(k.initializer) || !OUTCOMES.has(k.initializer.text)) return false;
    if (!ts.isIdentifier(v.name) || v.name.text !== "value" || !ts.isArrowFunction(v.initializer) || v.initializer.parameters.length || !ts.isParenthesizedExpression(v.initializer.body)) return false;
    return emittedDataOk(v.initializer.body.expression, decls);
  });
}

/**
 * Re-read a graded M98 test: the fixed import lines and harness, then ONE `test(..)` whose body is only fake
 * declarations (in the emitted language) and the emitted assertions. Returns the calls with their injections.
 */
export function gradedTestCalls(testPath: string, content: string, modPath: string): CallShape[] | null {
  const dir = testPath.slice(0, testPath.lastIndexOf("/") + 1);
  if (!modPath.startsWith(dir)) return null;
  const sf = ts.createSourceFile(testPath, content, ts.ScriptTarget.Latest, true);
  if (diag(sf)) return null;
  const imp = sf.statements[2];
  if (!imp || !ts.isImportDeclaration(imp) || !ts.isStringLiteral(imp.moduleSpecifier) || !imp.importClause?.namedBindings || !ts.isNamedImports(imp.importClause.namedBindings) || imp.importClause.name) return null;
  const spec = imp.moduleSpecifier.text;
  const rel = `./${modPath.slice(dir.length)}`;
  if (spec !== rel && spec !== rel.replace(/\.ts$/, "")) return null;
  const names = imp.importClause.namedBindings.elements.map((e) => (e.propertyName ? "" : e.name.text));
  if (names.some((n) => !n)) return null;
  const head = HARNESS_HEAD(spec, names.join(", "));
  if (!content.startsWith(head)) return null;
  const restSf = ts.createSourceFile(testPath, content.slice(head.length), ts.ScriptTarget.Latest, true);
  if (diag(restSf) || restSf.statements.length !== 1) return null;
  const st = restSf.statements[0]!;
  if (!ts.isExpressionStatement(st) || !ts.isCallExpression(st.expression) || !ts.isIdentifier(st.expression.expression) || st.expression.expression.text !== "test" || st.expression.arguments.length !== 2) return null;
  const [title, body] = st.expression.arguments;
  if (!title || !ts.isStringLiteral(title) || !body || !ts.isArrowFunction(body) || body.parameters.length || !ts.isBlock(body.body)) return null;
  const decls = new Set<string>();
  const keysOf = new Map<string, Set<string> | null>();
  const calls: CallShape[] = [];
  const injOf = (a: ts.Expression): Injection["args"][number] => {
    if (a.kind === ts.SyntaxKind.NullKeyword || (ts.isIdentifier(a) && a.text === "undefined")) return null;
    if (ts.isIdentifier(a) && keysOf.has(a.text)) { const k = keysOf.get(a.text); return k ? { keys: k } : "data"; }
    if (ts.isObjectLiteralExpression(a)) return { keys: new Set(a.properties.filter((p) => ts.isPropertyAssignment(p) && p.initializer.kind !== ts.SyntaxKind.NullKeyword && !(ts.isIdentifier(p.initializer) && p.initializer.text === "undefined")).map((p) => ((p as ts.PropertyAssignment).name as ts.Identifier).text)) };
    return "data";
  };
  const argsOf = (xs: readonly ts.Expression[]): Injection["args"] | null => {
    const out: Injection["args"] = [];
    for (const x of xs) {
      if (!ts.isAsExpression(x) || x.type.kind !== ts.SyntaxKind.NeverKeyword || !emittedDataOk(x.expression, decls)) return null;
      out.push(injOf(x.expression));
    }
    return out;
  };
  for (const s of body.body.statements) {
    if (ts.isVariableStatement(s)) {
      if (!(s.declarationList.flags & ts.NodeFlags.Const) || s.declarationList.declarations.length !== 1) return null;
      const d = s.declarationList.declarations[0]!;
      if (!ts.isIdentifier(d.name) || !d.initializer || d.type || decls.has(d.name.text) || names.includes(d.name.text)) return null;
      const init = d.initializer;
      if (!(emittedFakeFn(init, decls) || emittedDataOk(init, decls))) return null;
      keysOf.set(d.name.text, ts.isObjectLiteralExpression(init) ? new Set(init.properties.filter((p) => ts.isPropertyAssignment(p) && p.initializer.kind !== ts.SyntaxKind.NullKeyword).map((p) => ((p as ts.PropertyAssignment).name as ts.Identifier).text)) : null);
      decls.add(d.name.text);
      continue;
    }
    if (!ts.isExpressionStatement(s) || !ts.isCallExpression(s.expression)) return null;
    const c = s.expression;
    const callee = c.expression;
    if (!ts.isPropertyAccessExpression(callee) || !ts.isIdentifier(callee.expression) || callee.expression.text !== "assert") return null;
    if (callee.name.text === "equal") {
      // NAME(.k).calls.length, N
      const [l, r] = c.arguments;
      if (c.arguments.length !== 2 || !l || !r || !ts.isNumericLiteral(r) || !ts.isPropertyAccessExpression(l) || l.name.text !== "length" || !ts.isPropertyAccessExpression(l.expression) || l.expression.name.text !== "calls") return null;
      const owner = l.expression.expression;
      const root = ts.isPropertyAccessExpression(owner) ? owner.expression : owner;
      if (!ts.isIdentifier(root) || !decls.has(root.text)) return null;
      continue;
    }
    if (callee.name.text !== "deepEqual" || c.arguments.length !== 2) return null;
    const [l, r] = c.arguments;
    const run = l && ts.isAwaitExpression(l) ? l.expression : l;
    if (!run || !ts.isCallExpression(run) || !ts.isIdentifier(run.expression) || !(run.expression.text === "settle" ? l !== run : run.expression.text === "settleSync" && l === run) || run.arguments.length !== 1) return null;
    const thunk = run.arguments[0]!;
    if (!ts.isArrowFunction(thunk) || thunk.parameters.length || ts.isBlock(thunk.body)) return null;
    if (!r || !ts.isObjectLiteralExpression(r) || !r.properties.every((p) => ts.isPropertyAssignment(p) && ts.isIdentifier(p.name) && ((p.name.text === "ok" && (p.initializer.kind === ts.SyntaxKind.TrueKeyword || p.initializer.kind === ts.SyntaxKind.FalseKeyword)) || (p.name.text === "value" && emittedDataOk(p.initializer, new Set())) || (p.name.text === "message" && ts.isStringLiteral(p.initializer))))) return null;
    const ce = thunk.body;
    if (!ts.isCallExpression(ce) || ce.questionDotToken) return null;
    const args = argsOf(ce.arguments);
    if (!args) return null;
    if (ts.isIdentifier(ce.expression) && names.includes(ce.expression.text)) { calls.push({ entry: { kind: "call", fn: ce.expression.text, args }, code: "", names: [ce.expression.text] }); continue; }
    if (ts.isPropertyAccessExpression(ce.expression) && ts.isIdentifier(ce.expression.name) && ts.isNewExpression(ce.expression.expression) && ts.isIdentifier(ce.expression.expression.expression) && names.includes(ce.expression.expression.expression.text)) {
      const ctorArgs = argsOf(ce.expression.expression.arguments ?? []);
      if (!ctorArgs) return null;
      calls.push({ entry: { kind: "new", cls: ce.expression.expression.expression.text, method: ce.expression.name.text, args, ctorArgs }, code: "", names: [ce.expression.expression.expression.text] });
      continue;
    }
    return null;
  }
  if (!calls.length) return null;
  // every imported name is called
  if (names.some((n) => !calls.some((c) => c.names.includes(n)))) return null;
  return calls;
}

/**
 * Job B: the graded tree's edit is confined to one function / method, the new test is an M98 test of that module,
 * and the module stays hermetic for the test's calls on the base AND the graded source, the target reached.
 * Returns null when gradable, else a refusal code. `read` reads repo-relative non-test source files of the graded tree.
 */
export function gradeExistingEditProblem(modPath: string, baseText: string, realText: string, testPath: string, testContent: string, read: Read): string | null {
  const target = editConfinedTarget(modPath, baseText, realText);
  if (!target) return "edit_not_confined";
  // Auditor #489: re-run the capability-delta gate on the graded tree (base vs edited target unit).
  const btNode = findTarget(ts.createSourceFile(modPath, baseText, ts.ScriptTarget.Latest, true), target);
  const rtNode = findTarget(ts.createSourceFile(modPath, realText, ts.ScriptTarget.Latest, true), target);
  if (!btNode || !rtNode) return "edit_not_confined";
  const capB = capabilityDelta(btNode.node, rtNode.node);
  if (capB) return capB;
  const calls = gradedTestCalls(testPath, testContent, modPath);
  if (!calls) return "edit_test_shape";
  const after = hermeticProblem(modPath, read, calls, target, { path: modPath, content: realText });
  if (typeof after === "string") return after;
  const before = hermeticProblem(modPath, read, calls, target, { path: modPath, content: baseText });
  if (typeof before === "string") return before;
  return after.targetReached && before.targetReached ? null : "edit_test_unreached";
}

/** The repo-relative files the graded test may read at load (the module-load closure), for the permission-model runs. */
export function existingEditReads(modPath: string, read: Read): string[] | null {
  const c = loadClosure(modPath, read);
  return typeof c === "string" ? null : [...c.files.keys()].sort();
}
