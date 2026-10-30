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
/** G18 v2 (calledWith language only): a retry example needs its own site, clock and sleep fakes plus their counts. */
export const MAX_BULLETS_V2 = 32;
export const MAX_MODULES = 40;
export const MAX_UNITS = 800;

export interface ExistingEdit { path: string; content: string; extra: { path: string; content: string; create: true }[]; selfGrade: true }
export type Read = (rel: string) => string | null;

/** Spec validation (learned.ts validateSpec): public-mined, exactly the param keys, each its one vocabulary value. */
export function validExistingEditParams(p: Record<string, unknown>, minedFrom: unknown): boolean {
  if (minedFrom === "public" && isWireSizesParams(p)) return true; // G19+ (public-derive-wire-sizes-v1)
  return minedFrom === "public" && (okParams(p as Record<string, string | string[]>) || isWireParams(p) || isWire2Params(p) || isWire2RethrowParams(p));
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
/** `inLoop` (G18 wire mode only): NEW replaces a statement inside a loop, so a bare `continue` may appear; the wire
 * shape check (wireCatchOf) then proves the site really is inside a loop of the target. M98 always passes false. */
export function newGrammarProblem(sts: readonly ts.Statement[], isAsync: boolean, inLoop = false): string | null {
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
  for (const s of sts) stmt(s, inLoop);
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

/** G18: the site is inside a loop statement of the target body (never across a nested function). */
function siteInLoop(site: ts.Node, body: ts.Node): boolean {
  for (let p = site.parent; p && p !== body; p = p.parent) {
    if (isFunctionLike(p)) return false;
    if (ts.isForOfStatement(p) || ts.isForStatement(p) || ts.isForInStatement(p) || ts.isWhileStatement(p) || ts.isDoStatement(p)) return true;
  }
  return false;
}

/** G1: apply the replacement; null unless OLD matches exactly one own statement and the result parses. */
// G18 `wire`: a bare `continue` in NEW is allowed only when the matched site sits in a loop of the target (M98: never).
export function editStatement(path: string, text: string, target: string, oldText: string, newText: string, wire = false): { content: string; target: Target } | null {
  if (oldText.length > MAX_OLD_CHARS || newText.length > MAX_NEW_CHARS || sameCode(oldText, newText)) return null;
  const sf = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
  if (diag(sf)) return null;
  const t = findTarget(sf, target);
  if (!t || !t.node.body) return null;
  const isAsync = !!t.node.modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword);
  const oldSts = parseStatements(oldText), newSts = parseStatements(newText);
  if (!oldSts || oldSts.length !== 1 || !newSts || newSts.length < 1 || newSts.length > MAX_NEW_STATEMENTS) return null;
  if (!OLD_KINDS.has(oldSts[0]!.kind)) return null;
  if (!wire && newGrammarProblem(newSts, isAsync)) return null;
  const matches = ownStatements(t.node.body).filter((s) => sameCode(s.getText(sf), oldText));
  if (matches.length !== 1) return null;
  const site = matches[0]!;
  if (wire && newGrammarProblem(newSts, isAsync, siteInLoop(site, t.node.body))) return null;
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
  // Auditor #489 (non-blocking, fixed in m98b): an error's `stack` leaks the host's paths, line numbers and call chain
  "stack",
]);
/**
 * Auditor #489 (non-blocking, fixed in m98b): built-in methods that mutate their receiver in place (Array, TypedArray,
 * Date). On a receiver that is not a fresh `const` literal local of the unit (a parameter, `this`, a non-fresh local,
 * any deeper path, a call result) they would change caller-owned data, the same thing `write-nonfresh` refuses for
 * property writes. Refused however written: a call, a comma / sequence operand, nested, `?.`, `["push"]`, or a
 * non-call reference (`xs.forEach(d.xs.push, d.xs)`, a destructured `{ push }`). Token `mutate:<m>`.
 */
export const EDIT_MUTATING_MEMBERS: ReadonlySet<string> = new Set([
  "push", "pop", "shift", "unshift", "splice", "sort", "reverse", "fill", "copyWithin", "set",
  "setTime", "setFullYear", "setYear", "setMonth", "setDate", "setHours", "setMinutes", "setSeconds", "setMilliseconds",
  "setUTCFullYear", "setUTCMonth", "setUTCDate", "setUTCHours", "setUTCMinutes", "setUTCSeconds", "setUTCMilliseconds",
]);
/** Characters that make a string pattern a regex in match / matchAll / search (they build a RegExp from a string). */
const REGEX_META = /[\\^$.|?*+()[\]{}]/;
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
 * Auditor #520: STRICT inert-at-load, an allowlist (fail closed). The shallow hermetic walk below never looks inside a
 * function, so an initializer that CALLS one (an IIFE, `console.log(1)`, a tagged template) or makes the runtime call
 * user code (a getter by member access or destructuring, toString / valueOf by a template or arithmetic, an iterator
 * by a spread) ran code at import unseen. Allowed: literals (regex literals too); `undefined`; a plain name bound in the closure; a function
 * or arrow that is not invoked; an array literal (no spread, no hole) or object literal (plain or string / number keys,
 * no computed key, no spread, no getter / setter, no `__proto__`, methods allowed) of strict-inert parts; an untagged
 * template or + - * / % ** whose operands are primitive (a literal, or a plain name of a top-level const in the closure
 * whose initializer is primitive); parens / `as` / `satisfies` / `!`; and two shapes that run no user code on fresh
 * literals, only when the global is not rebound in the closure: Object.freeze(object / array literal) and
 * new Set / new Map(array literal). Everything else (any other call or `new`, member access, tagged template,
 * conditional, typeof, await, class expression, ...) is refused.
 */
function strictInert(c: Closure, e: ts.Expression): boolean {
  const x = unwrap(e);
  if (primitiveAtLoad(c, x, 0) || ts.isRegularExpressionLiteral(x)) return true;
  if (ts.isArrowFunction(x) || ts.isFunctionExpression(x)) return true;
  if (ts.isIdentifier(x)) return x.text === "undefined" ? !closureBinds(c, "undefined") : closureDecl(c, x) !== null;
  if (ts.isArrayLiteralExpression(x)) return x.elements.every((el) => !ts.isSpreadElement(el) && !ts.isOmittedExpression(el) && strictInert(c, el));
  if (ts.isObjectLiteralExpression(x)) return x.properties.every((p) => {
    if (!p.name || ts.isComputedPropertyName(p.name) || ts.isPrivateIdentifier(p.name)) return false;
    if ((ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) && p.name.text === "__proto__") return false;
    if (ts.isPropertyAssignment(p)) return strictInert(c, p.initializer);
    if (ts.isShorthandPropertyAssignment(p)) return !p.objectAssignmentInitializer && closureDecl(c, p.name) !== null;
    return ts.isMethodDeclaration(p) && !p.asteriskToken;
  });
  const fresh = (a: ts.Expression | undefined): boolean => !!a && (ts.isObjectLiteralExpression(unwrap(a)) || ts.isArrayLiteralExpression(unwrap(a))) && strictInert(c, a);
  if (ts.isCallExpression(x) && !x.questionDotToken && ts.isPropertyAccessExpression(x.expression) && ts.isIdentifier(x.expression.expression) && x.expression.expression.text === "Object" && x.expression.name.text === "freeze" && !closureBinds(c, "Object")) return x.arguments.length === 1 && fresh(x.arguments[0]);
  if (ts.isNewExpression(x) && ts.isIdentifier(x.expression) && (x.expression.text === "Set" || x.expression.text === "Map") && !closureBinds(c, x.expression.text)) {
    const a = x.arguments ?? [];
    if (a.length === 0) return true;
    const arr = unwrap(a[0]!);
    if (a.length !== 1 || !ts.isArrayLiteralExpression(arr) || !strictInert(c, arr)) return false;
    return x.expression.text === "Set" || arr.elements.every((el) => { const pair = unwrap(el); return ts.isArrayLiteralExpression(pair) && pair.elements.length === 2; });
  }
  return false;
}

/** A primitive value whose evaluation runs no user code: a literal, or + - * / % ** / an untagged template over such values or names of primitive top-level consts. */
function primitiveAtLoad(c: Closure, e: ts.Expression, depth: number): boolean {
  if (depth > 32) return false;
  const x = unwrap(e);
  if (ts.isStringLiteral(x) || ts.isNumericLiteral(x) || ts.isBigIntLiteral(x) || ts.isNoSubstitutionTemplateLiteral(x)) return true;
  if (x.kind === ts.SyntaxKind.TrueKeyword || x.kind === ts.SyntaxKind.FalseKeyword || x.kind === ts.SyntaxKind.NullKeyword) return true;
  if (ts.isPrefixUnaryExpression(x) && (x.operator === ts.SyntaxKind.MinusToken || x.operator === ts.SyntaxKind.PlusToken) && ts.isNumericLiteral(unwrap(x.operand))) return true;
  if (ts.isTemplateExpression(x)) return x.templateSpans.every((s) => primitiveAtLoad(c, s.expression, depth + 1));
  if (ts.isBinaryExpression(x) && [ts.SyntaxKind.PlusToken, ts.SyntaxKind.MinusToken, ts.SyntaxKind.AsteriskToken, ts.SyntaxKind.SlashToken, ts.SyntaxKind.PercentToken, ts.SyntaxKind.AsteriskAsteriskToken].includes(x.operatorToken.kind)) return primitiveAtLoad(c, x.left, depth + 1) && primitiveAtLoad(c, x.right, depth + 1);
  if (ts.isIdentifier(x)) {
    const d = closureDecl(c, x);
    return !!d && ts.isVariableDeclaration(d) && !!d.initializer && ts.isIdentifier(d.name) && (d.parent.flags & ts.NodeFlags.BlockScoped) === ts.NodeFlags.Const && ts.isSourceFile(d.parent.parent.parent) && primitiveAtLoad(c, d.initializer, depth + 1);
  }
  return false;
}

const closureFileOf = (c: Closure, n: ts.Node): boolean => [...c.files.values()].includes(n.getSourceFile());
/** The value declaration a plain name resolves to (through imports), when it is a top-level declaration in the closure. */
function closureDecl(c: Closure, id: ts.Identifier): ts.Declaration | null {
  let sym = ts.isShorthandPropertyAssignment(id.parent) && id.parent.name === id ? c.checker.getShorthandAssignmentValueSymbol(id.parent) : c.checker.getSymbolAtLocation(id);
  if (sym && sym.flags & ts.SymbolFlags.Alias) sym = c.checker.getAliasedSymbol(sym);
  const d = sym?.valueDeclaration;
  if (!d || !closureFileOf(c, d)) return null;
  const top = ts.isVariableDeclaration(d) ? d.parent.parent : d;
  return ts.isSourceFile(top.parent) && (ts.isVariableStatement(top) || ts.isFunctionDeclaration(top) || ts.isClassDeclaration(top) || ts.isEnumDeclaration(top)) ? d : null;
}
/** True when some module of the closure declares or imports `name` at top level (a global it would shadow). */
const closureBinds = (c: Closure, name: string): boolean => [...c.files.values()].some((sf) => {
  let hit = false;
  const walk = (n: ts.Node): void => { if (hit) return; if (ts.isIdentifier(n) && n.text === name && isBindingName(n)) hit = true; else n.forEachChild(walk); };
  walk(sf);
  return hit;
});
/** A declaring occurrence of a name (import, variable, parameter, function, class, enum, namespace, binding element). */
const isBindingName = (n: ts.Identifier): boolean => {
  const p = n.parent;
  return (ts.isImportSpecifier(p) && p.name === n) || ts.isImportClause(p) || ts.isNamespaceImport(p) || ts.isImportEqualsDeclaration(p)
    || ((ts.isVariableDeclaration(p) || ts.isParameter(p) || ts.isFunctionDeclaration(p) || ts.isFunctionExpression(p) || ts.isClassDeclaration(p) || ts.isClassExpression(p) || ts.isEnumDeclaration(p) || ts.isModuleDeclaration(p) || ts.isBindingElement(p)) && (p as { name?: ts.Node }).name === n);
};

/** Auditor #520: every expression a module of the closure evaluates at import passes strictInert, else `edit_module_load:<path>`. */
export function importTimeProblem(c: Closure): string | null {
  for (const [p, sf] of c.files) {
    const bad = `edit_module_load:${p}`;
    for (const st of sf.statements) {
      if (ts.isVariableStatement(st)) {
        if (st.modifiers?.some((m) => m.kind === ts.SyntaxKind.DeclareKeyword)) continue;
        const fl = st.declarationList.flags;
        const kind = fl & ts.NodeFlags.BlockScoped;
        if (kind === ts.NodeFlags.Using || kind === ts.NodeFlags.AwaitUsing) return bad; // disposed at module end
        for (const d of st.declarationList.declarations) {
          if (!ts.isIdentifier(d.name)) return bad; // destructuring runs getters / iterators
          if (d.initializer && !strictInert(c, d.initializer)) return bad;
        }
      } else if (ts.isEnumDeclaration(st)) {
        if (st.members.some((m) => m.initializer && !primitiveAtLoad(c, m.initializer, 0) )) return bad;
      } else if (ts.isClassDeclaration(st)) {
        for (const m of st.members) if (ts.isPropertyDeclaration(m) && m.initializer && (ts.getModifiers(m) ?? []).some((k) => k.kind === ts.SyntaxKind.StaticKeyword) && !strictInert(c, m.initializer)) return bad;
      } else if (ts.isExportAssignment(st)) {
        if (!strictInert(c, st.expression)) return bad;
      }
    }
  }
  return null;
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
  if (typeof r === "string") return r;
  // Auditor #520: after the hermetic walk (so its specific codes stay first), the strict allowlist on every initializer.
  return importTimeProblem(c);
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
  // m98b: how often each name is bound anywhere in the unit (parameters, nested callback parameters, catch variables,
  // declarations). A fresh local must be bound exactly once, so a callback parameter of the same name can't borrow its
  // freshness (`[d.xs].map((a) => a.push(1)); const a = [1];` or `... a.length = 0 ...`).
  const bound = new Map<string, number>();
  const bind = (nm: ts.BindingName, into: Set<string>): void => {
    if (ts.isIdentifier(nm)) { into.add(nm.text); bound.set(nm.text, (bound.get(nm.text) ?? 0) + 1); }
    else for (const el of nm.elements) if (!ts.isOmittedExpression(el)) bind(el.name, into);
  };
  if (ts.isFunctionLike(node)) for (const p of node.parameters) bind(p.name, params);
  const isFresh = (e: ts.Expression): boolean => {
    const x = unwrap(e);
    return ts.isArrayLiteralExpression(x) || ts.isObjectLiteralExpression(x) || ts.isStringLiteral(x) || ts.isNumericLiteral(x) || ts.isNoSubstitutionTemplateLiteral(x) || x.kind === ts.SyntaxKind.TrueKeyword || x.kind === ts.SyntaxKind.FalseKeyword || x.kind === ts.SyntaxKind.NullKeyword
      // m98b: a fresh container the unit itself constructs (`new Map()`, `new Set(xs)`): mutating it changes no caller data
      || (ts.isNewExpression(x) && ts.isIdentifier(x.expression) && (x.expression.text === "Map" || x.expression.text === "Set"));
  };
  const collect = (n: ts.Node): void => {
    if (n !== node && ts.isFunctionLike(n)) for (const p of n.parameters) bind(p.name, locals);
    if (ts.isVariableDeclaration(n)) {
      bind(n.name, locals);
      // fresh only if it is never re-bound: a `const`, initialised to a literal the unit itself created
      if (ts.isIdentifier(n.name) && n.initializer && isFresh(n.initializer) && ts.isVariableDeclarationList(n.parent) && (n.parent.flags & ts.NodeFlags.Const)) fresh.add(n.name.text);
    }
    if ((ts.isFunctionDeclaration(n) || ts.isClassDeclaration(n)) && n !== node && n.name) { locals.add(n.name.text); bound.set(n.name.text, (bound.get(n.name.text) ?? 0) + 1); }
    if (ts.isCatchClause(n) && n.variableDeclaration) bind(n.variableDeclaration.name, locals);
    ts.forEachChild(n, collect);
  };
  collect(node);
  for (const f of [...fresh]) if ((bound.get(f) ?? 0) !== 1) fresh.delete(f);
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
    // m98b (Auditor #489 non-blocking 1): an in-place mutator on anything but a fresh const literal local of the unit
    if (EDIT_MUTATING_MEMBERS.has(name) && !(ts.isIdentifier(r) && fresh.has(r.text))) add(`mutate:${name}`);
    // m98b (Auditor #489 non-blocking 2): string pattern sinks only as a direct call with a literal pattern
    if (STRING_REGEX_SINKS.has(name) && !literalPattern(name, at)) add(`pattern:${name}`);
  };
  /** A direct call whose first argument is a string literal; for match / matchAll / search (which build a RegExp from a
   *  string) the literal must also be free of regex metacharacters. A regex literal argument is the `regex` token. */
  const literalPattern = (name: string, at: ts.Node): boolean => {
    if (!directCallee(at)) return false;
    const a = (at.parent as ts.CallExpression).arguments[0];
    const lit = a ? literalString(a) : null;
    if (lit === null) return !!a && ts.isRegularExpressionLiteral(unwrap(a));
    return !(name === "match" || name === "matchAll" || name === "search") || !REGEX_META.test(lit);
  };
  /** A member name taken without a receiver expression (destructuring): checked as an un-called read of a non-fresh value. */
  const destructuredName = (k: string, at: ts.Node): void => {
    if (EDIT_BANNED_MEMBERS.has(k)) add(`member:${k}`);
    else if (k === "get" || k === "set") add(`accessor:${k}`);
    if (EDIT_MUTATING_MEMBERS.has(k)) add(`mutate:${k}`);
    if (STRING_REGEX_SINKS.has(k)) add(`pattern:${k}`);
    void at;
  };
  const keyText = (k: ts.Node | undefined): string | null => (k && (ts.isIdentifier(k) || ts.isStringLiteral(k) || ts.isNoSubstitutionTemplateLiteral(k) || ts.isNumericLiteral(k)) ? k.text : null);
  /** An object literal used as a destructuring ASSIGNMENT target (`({ stack: t } = e)`, `for ({ push } of xs)`). */
  const isDestructTarget = (o: ts.Node): boolean => {
    let e: ts.Node = o;
    for (;;) {
      const p = e.parent;
      if (ts.isParenthesizedExpression(p) || ts.isSpreadElement(p) || ts.isSpreadAssignment(p) || ts.isArrayLiteralExpression(p) || (ts.isPropertyAssignment(p) && p.initializer === e) || (ts.isShorthandPropertyAssignment(p))) { e = ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p) ? p.parent : p; continue; }
      if (ts.isBinaryExpression(p) && p.left === e && p.operatorToken.kind === ts.SyntaxKind.EqualsToken) return true;
      if ((ts.isForOfStatement(p) || ts.isForInStatement(p)) && p.initializer === e) return true;
      return false;
    }
  };
  const visit = (n: ts.Node): void => {
    if (ts.isTypeNode(n) && !ts.isExpressionWithTypeArguments(n)) return;
    if (ts.isPropertyAccessExpression(n)) member(n.expression, n.name.text, n);
    if (ts.isElementAccessExpression(n)) { const k = literalString(n.argumentExpression); if (k !== null) member(n.expression, k, n); }
    if (ts.isRegularExpressionLiteral(n)) add("regex");
    // m98b: a member name read by destructuring (`const { stack } = e`, `({ push: p } = d.xs)`) is checked like `e.stack`
    if (ts.isBindingElement(n) && ts.isObjectBindingPattern(n.parent)) { const k = keyText(n.propertyName) ?? (n.propertyName ? null : keyText(n.name)); if (k !== null) destructuredName(k, n); }
    if (ts.isObjectLiteralExpression(n) && isDestructTarget(n)) for (const p of n.properties) { const k = ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p) ? keyText(p.name) : null; if (k !== null) destructuredName(k, p); }
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
export const OUTCOMES: ReadonlySet<string> = new Set(["resolves", "returns", "rejects", "throws"]);
const ISO_Z = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
export const MAX_ARRAY_ITEMS = 50;
export const MAX_STRING_CHARS = 400;

export function parseExpression(text: string): ts.Expression | null {
  if (text.includes("\n") || hasComment(text)) return null;
  const sf = ts.createSourceFile("e.ts", `(${text});`, ts.ScriptTarget.Latest, true);
  if (diag(sf) || sf.statements.length !== 1 || !ts.isExpressionStatement(sf.statements[0]!)) return null;
  const e = (sf.statements[0] as ts.ExpressionStatement).expression;
  return ts.isParenthesizedExpression(e) ? e.expression : null;
}

type Ctx = { fakes: Map<string, ts.Expression>; wire?: boolean };
const literalString = (e: ts.Expression): string | null => (ts.isStringLiteral(e) && e.text.length <= MAX_STRING_CHARS && !REFLECTION.has(e.text) ? e.text : null);
export const callName = (e: ts.Expression): string | null => (ts.isCallExpression(e) && ts.isIdentifier(e.expression) && !e.typeArguments && !e.questionDotToken ? e.expression.text : null);

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
  // G18: in the derive-wire language only, rejects / throws take a second argument, the error's fields (wireErrorFields)
  if (!OUTCOMES.has(name) || e.arguments.length > (c.wire && (name === "rejects" || name === "throws") ? 2 : 1)) return null;
  if (name === "rejects" || name === "throws") {
    if (e.arguments.length < 1 || literalString(e.arguments[0]!) === null) return null;
    const fields = e.arguments.length === 2 ? wireErrorFields(e.arguments[1]!) : null;
    if (e.arguments.length === 2 && fields === null) return null;
    return `{ kind: "${name}", value: () => (${JSON.stringify((e.arguments[0] as ts.StringLiteral).text)})${fields === null ? "" : `, error: () => (${fields})`} }`;
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
export function uniqueSplit<T>(text: string, sep: string, ok: (l: string, r: string) => T | null): T | null {
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
export function parseFakeTest(lines: readonly string[], opts: { wire?: boolean; calledWith?: boolean } = {}): FakeTest | null {
  const bullets = lines.filter((l) => /^- (?:fake|expect) /.test(l));
  if (!bullets.length || bullets.length > (opts.calledWith ? MAX_BULLETS_V2 : MAX_BULLETS)) return null;
  const c: Ctx = { fakes: new Map(), wire: !!opts.wire };
  const fakeKeys = new Map<string, Set<string> | null>();
  const decls: string[] = [], checks: string[] = [], calls: CallShape[] = [];
  const names = new Set<string>();
  for (const b of bullets) {
    let m = /^- fake ([A-Za-z][\w$]*) = (.+)$/.exec(b);
    if (m) {
      const name = m[1]!;
      if (c.fakes.has(name) || ["assert", "test", "fakeFn", "settle", "settleSync", "bytes", "date", "response", "failure"].includes(name) || GLOBAL_OK[name]) return null;
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
    // G18 v2 (derive-wire v2 only): `- expect NAME is called with [a, ..], [b, ..]`: the recorded argument lists, data only
    m = opts.calledWith ? /^([A-Za-z][\w$]*) is called with (\[.*\])$/.exec(rest) : null;
    if (m) {
      const fake = c.fakes.get(m[1]!);
      if (!fake || !(callName(fake) && (OUTCOMES.has(callName(fake)!) || callName(fake) === "sequence"))) return null;
      const e = parseExpression(`[${m[2]!}]`);
      if (!e || !ts.isArrayLiteralExpression(e) || !e.elements.length || !e.elements.every((x) => ts.isArrayLiteralExpression(x))) return null;
      const v = emitData(e, c, { fakes: false, response: false });
      if (v === null) return null;
      checks.push(`  assert.deepEqual(${m[1]}.calls, ${v});`);
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

export function emitFakeTest(modPath: string, testPath: string, title: string, t: FakeTest, style: "ts" | "none", harness: string = FAKE_HARNESS): string {
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
    harness,
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

export const editablePath = (path: string, isTest: (p: string) => boolean): boolean =>
  !isTest(path) && !isExcludedSource(path) && /^src\/[\w./-]+\.ts$/.test(path) && !path.endsWith(".d.ts") && !PROTECTED_SELF.some((p) => p.pattern.test(path));

/** Every gate for ONE statement edit (oldText -> newText) of `target` in `filePath`; lines[0] is the header line. */
function gateSuppliedEdit(target: string, filePath: string, split: { oldText: string; newText: string }, lines: readonly string[], files: readonly { path: string; content: string }[], isTest: (p: string) => boolean, wire = false): { edit: ExistingEdit | null; reason: string | null } {
  const no = (reason: string) => ({ edit: null, reason });
  const g = { target };
  const heads = [lines[0]!];
  const file = files.find((f) => f.path === filePath);
  if (!file || !editablePath(file.path, isTest)) return no("edit_path");
  if (newGrammarProblem(parseStatements(split.newText) ?? [], true, wire)) return no("edit_new_grammar");
  // every bullet must be a fake or an expect bullet: a stray check is refused, never silently dropped
  if (lines.some((l) => /^[-*+•] /.test(l) && !/^- (?:fake|expect) /.test(l))) return no("edit_test_grammar");
  const edited = editStatement(file.path, file.content, g.target!, split.oldText, split.newText, wire);
  if (!edited) return no("edit_site");
  // Auditor #489: the edit may not introduce any new capability (global I/O, reflection, `as any`) the base lacked.
  const baseTarget = findTarget(ts.createSourceFile(file.path, file.content, ts.ScriptTarget.Latest, true), g.target!);
  // G18: a derived wire edit must have the wire shape; its capability delta is taken with the catch as `throw error;`
  let capTarget: Target | null = edited.target;
  if (wire) {
    const shape = wireEditShape(file.path, file.content, edited.content, g.target!);
    if (!shape) return no("wire_shape");
    capTarget = findTarget(ts.createSourceFile(file.path, shape.stripped, ts.ScriptTarget.Latest, true), g.target!);
    if (!capTarget) return no("wire_shape");
  }
  if (baseTarget) { const cap = capabilityDelta(baseTarget.node, capTarget.node); if (cap) return no(cap); }
  const fakeTest = parseFakeTest(lines, { wire });
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
  const content = wire
    ? emitFakeTest(file.path, testPath, `PeaceAI G18 derive-wire: ${g.target} in ${file.path} (derived try / catch, injected fakes)`, fakeTest, importStyle(files, isTest), WIRE_FAKE_HARNESS)
    : emitFakeTest(file.path, testPath, `PeaceAI M98: ${g.target} in ${file.path} (statement edit, injected fakes)`, fakeTest, importStyle(files, isTest));
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

const HARNESS_HEAD = (spec: string, names: string, harness: string = FAKE_HARNESS): string => `import assert from "node:assert/strict";\nimport test from "node:test";\nimport { ${names} } from ${JSON.stringify(spec)};\n\n${harness}`;

/** Data as emitted (emitData's output language), checked on the graded test. */
function emittedDataOk(e: ts.Expression, decls: ReadonlySet<string>, wire = false): boolean {
  const x = e;
  if (ts.isStringLiteral(x)) return x.text.length <= MAX_STRING_CHARS && !REFLECTION.has(x.text);
  if (ts.isNumericLiteral(x)) return true;
  if (ts.isPrefixUnaryExpression(x) && x.operator === ts.SyntaxKind.MinusToken && ts.isNumericLiteral(x.operand)) return true;
  if (x.kind === ts.SyntaxKind.TrueKeyword || x.kind === ts.SyntaxKind.FalseKeyword || x.kind === ts.SyntaxKind.NullKeyword) return true;
  if (ts.isIdentifier(x)) return x.text === "undefined" || decls.has(x.text);
  if (ts.isArrayLiteralExpression(x)) return x.elements.length <= MAX_ARRAY_ITEMS && x.elements.every((y) => !ts.isSpreadElement(y) && !ts.isOmittedExpression(y) && emittedDataOk(y, decls, wire));
  if (ts.isObjectLiteralExpression(x)) return x.properties.length <= MAX_ARRAY_ITEMS && x.properties.every((p) => ts.isPropertyAssignment(p) && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) && !REFLECTION.has(p.name.text) && (emittedDataOk(p.initializer, decls, wire) || emittedFakeFn(p.initializer, decls, wire)));
  if (ts.isCallExpression(x) && ts.isPropertyAccessExpression(x.expression) && x.expression.name.text === "encode" && ts.isNewExpression(x.expression.expression) && ts.isIdentifier(x.expression.expression.expression) && x.expression.expression.expression.text === "TextEncoder" && !(x.expression.expression.arguments?.length) && x.arguments.length === 1 && ts.isStringLiteral(x.arguments[0]!)) return true;
  if (ts.isNewExpression(x) && ts.isIdentifier(x.expression) && x.expression.text === "Date") return x.arguments?.length === 1 && ts.isStringLiteral(x.arguments[0]!) && ISO_Z.test(x.arguments[0].text);
  if (ts.isNewExpression(x) && ts.isIdentifier(x.expression) && x.expression.text === "Response") {
    const a = x.arguments ?? [];
    if (a.length !== 2 || !(ts.isStringLiteral(a[0]!) || a[0]!.kind === ts.SyntaxKind.NullKeyword) || !ts.isObjectLiteralExpression(a[1]!)) return false;
    return a[1].properties.every((p) => ts.isPropertyAssignment(p) && ts.isIdentifier(p.name) && ((p.name.text === "status" && ts.isNumericLiteral(p.initializer)) || (p.name.text === "headers" && ts.isObjectLiteralExpression(p.initializer) && p.initializer.properties.every((h) => ts.isPropertyAssignment(h) && ts.isStringLiteral(h.initializer)))));
  }
  return false;
}
function emittedFakeFn(e: ts.Expression, decls: ReadonlySet<string>, wire = false): boolean {
  if (!ts.isCallExpression(e) || !ts.isIdentifier(e.expression) || e.expression.text !== "fakeFn" || e.arguments.length !== 1 || !ts.isArrayLiteralExpression(e.arguments[0]!)) return false;
  const os = e.arguments[0].elements;
  return os.length >= 1 && os.length <= 8 && os.every((o) => {
    // G18: a third property `error: () => ({ ..fields })` only in the derive-wire harness, on rejects / throws only
    if (!ts.isObjectLiteralExpression(o) || !(o.properties.length === 2 || (wire && o.properties.length === 3))) return false;
    const [k, v, f] = o.properties;
    if (f && !(ts.isPropertyAssignment(f) && ts.isIdentifier(f.name) && f.name.text === "error" && ts.isArrowFunction(f.initializer) && !f.initializer.parameters.length && ts.isParenthesizedExpression(f.initializer.body) && emittedErrorFieldsOk(f.initializer.body.expression) && k && ts.isPropertyAssignment(k) && ts.isStringLiteral(k.initializer) && (k.initializer.text === "rejects" || k.initializer.text === "throws"))) return false;
    if (!k || !v || !ts.isPropertyAssignment(k) || !ts.isPropertyAssignment(v) || !ts.isIdentifier(k.name) || k.name.text !== "kind" || !ts.isStringLiteral(k.initializer) || !OUTCOMES.has(k.initializer.text)) return false;
    if (!ts.isIdentifier(v.name) || v.name.text !== "value" || !ts.isArrowFunction(v.initializer) || v.initializer.parameters.length || !ts.isParenthesizedExpression(v.initializer.body)) return false;
    return emittedDataOk(v.initializer.body.expression, decls);
  });
}

/**
 * Re-read a graded M98 test: the fixed import lines and harness, then ONE `test(..)` whose body is only fake
 * declarations (in the emitted language) and the emitted assertions. Returns the calls with their injections.
 */
export function gradedTestCalls(testPath: string, content: string, modPath: string, wire = false, calledWith = false): CallShape[] | null {
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
  // G18: a derive-wire edit's test carries the wire harness (error fields); every other test the M98 harness, byte for byte
  const head = HARNESS_HEAD(spec, names.join(", "), wire ? WIRE_FAKE_HARNESS : FAKE_HARNESS);
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
      if (!ts.isAsExpression(x) || x.type.kind !== ts.SyntaxKind.NeverKeyword || !emittedDataOk(x.expression, decls, wire)) return null;
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
      if (!(emittedFakeFn(init, decls, wire) || emittedDataOk(init, decls, wire))) return null;
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
    // G18 v2: NAME.calls, [[data, ..], ..] (only in a derive-wire v2 test)
    if (calledWith) {
      const [cl, cr] = c.arguments;
      if (cl && ts.isPropertyAccessExpression(cl) && cl.name.text === "calls" && ts.isIdentifier(cl.expression)) {
        if (!decls.has(cl.expression.text) || !cr || !ts.isArrayLiteralExpression(cr) || !cr.elements.every((x) => ts.isArrayLiteralExpression(x)) || !emittedDataOk(cr, new Set())) return null;
        continue;
      }
    }
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
  // G29: a rethrow at the retry limit of a v2 retry template (rethrowEditShape: rebuilt from the base token for token;
  // a cause-message or plain-message rethrow is refused by name), hermetic walk on the template with its timeout signal taken out,
  // before and after, the test in the v2 language. Any other edit is checked exactly as before.
  const rethrow = rethrowEditShape(modPath, baseText, realText, read);
  if (typeof rethrow === "string") return rethrow;
  // G19+: a "list the sizes too" / "use the list sizes" edit, rebuilt from the base token for token (gradeSizesProblem)
  const sizes = rethrow ? null : gradeSizesProblem(modPath, baseText, realText, testPath, testContent, read);
  if (sizes !== null) return sizes === "ok" ? null : sizes;
  if (rethrow) {
    const tcalls = gradedTestCalls(testPath, testContent, modPath, true, true);
    if (!tcalls) return "edit_test_shape";
    const ta = hermeticProblem(modPath, read, tcalls, rethrow.target, { path: modPath, content: rethrow.stripped });
    if (typeof ta === "string") return ta;
    const tb = hermeticProblem(modPath, read, tcalls, rethrow.target, { path: modPath, content: rethrow.baseStripped });
    if (typeof tb === "string") return tb;
    return ta.targetReached && tb.targetReached ? null : "edit_test_unreached";
  }
  const target = editConfinedTarget(modPath, baseText, realText);
  if (!target) {
    // G18 v2: a retry edit also adds the sleep seam and helper imports, so it is not confined to one unit; it is
    // graded only when it is EXACTLY the retry template rebuilt from the base (retryEditShape), hermetic walk on the
    // template with its per-attempt timeout signal taken out, before and after
    const retry = retryEditShape(modPath, baseText, realText, read);
    if (!retry) return "edit_not_confined";
    const rcalls = gradedTestCalls(testPath, testContent, modPath, true, true);
    if (!rcalls) return "edit_test_shape";
    const ra = hermeticProblem(modPath, read, rcalls, retry.target, { path: modPath, content: retry.stripped });
    if (typeof ra === "string") return ra;
    const rb = hermeticProblem(modPath, read, rcalls, retry.target, { path: modPath, content: baseText });
    if (typeof rb === "string") return rb;
    return ra.targetReached && rb.targetReached ? null : "edit_test_unreached";
  }
  // Auditor #489: re-run the capability-delta gate on the graded tree (base vs edited target unit).
  const btNode = findTarget(ts.createSourceFile(modPath, baseText, ts.ScriptTarget.Latest, true), target);
  const rtNode = findTarget(ts.createSourceFile(modPath, realText, ts.ScriptTarget.Latest, true), target);
  if (!btNode || !rtNode) return "edit_not_confined";
  // G18: a derive-wire edit (one own statement wrapped in try / catch, the catch in the closed wire grammar) is checked
  // with its catch replaced by `throw error;` (wireEditShape); every other edit exactly as before.
  // G18 v2: a recorded-skip edit (filter, record, continue; recordEditShape) likewise, with the v2 test language
  const wire = wireEditShape(modPath, baseText, realText, target) ?? recordEditShape(modPath, baseText, realText, target);
  const v2 = !!wire && !("catch" in wire);
  const capNode = wire ? findTarget(ts.createSourceFile(modPath, wire.stripped, ts.ScriptTarget.Latest, true), target) : rtNode;
  if (!capNode) return "edit_not_confined";
  const capB = capabilityDelta(btNode.node, capNode.node);
  if (capB) return capB;
  const calls = gradedTestCalls(testPath, testContent, modPath, !!wire, v2);
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

// ---------------------------------------------------------------------------------------------------------------
// G18 (public-derive-wire-v1, kind EXISTING_EDIT): the shared Job A / Job B pieces of a DERIVED try / catch wrap.
//
// The search (which statement, which catch) lives in derive-wire.ts. Here: the spec vocabulary, the closed catch grammar
// (WIRE_ARG_FORMS, an eligible string-line helper), the structural recognizer both jobs use (wireEditShape), the wire
// fake language (a rejects / throws outcome may carry the error's fields: code, name, cause { code, name, message })
// and its fixed harness. A wire edit is gated with its catch replaced by `throw error;` (the try wrapper and the added
// `await` add nothing), and the catch itself must match the grammar exactly, so the inserted code can only call an
// existing, pure, string-concatenating helper of the same module with fixed reads of the caught error.
// ---------------------------------------------------------------------------------------------------------------
/** The derive-wire spec's params: the M98 keys, three of them with their own one-value vocabulary (all or none). */
export const WIRE_VOCAB: Record<(typeof EXISTING_EDIT_PARAM_KEYS)[number], readonly string[]> = {
  fakes: ["recorded-object-literal-v1-error-fields"],
  grading: ["self-fail-before-pass-after-assertions"],
  io: ["injected-only-v1"],
  match: ["derived-unique-call-site-v1"],
  paths: ["in-scope-source"],
  statements: ["derived-try-catch-wrap-v1"],
  target: ["named-function-or-class-method"],
  test: ["new-file-fake-driven"],
};
export function isWireParams(p: Record<string, unknown>): boolean {
  return Object.keys(p).sort().join(",") === [...EXISTING_EDIT_PARAM_KEYS].join(",") && EXISTING_EDIT_PARAM_KEYS.every((k) => typeof p[k] === "string" && WIRE_VOCAB[k].length === 1 && WIRE_VOCAB[k].includes(p[k] as string));
}

/**
 * The fixed reads of a caught `error` a derived catch may pass to the helper (G21: message, name, code, cause.code,
 * cause.name, cause.message). Each is total: a thrown non-Error, null or primitive gives "" (or String(error) for the
 * message), never a TypeError. `id` is how Job A's search names them; the text is what is inserted.
 */
export const WIRE_ARG_FORMS: readonly { id: string; text: string }[] = [
  { id: "message", text: "error instanceof Error ? error.message : String(error)" },
  { id: "name", text: 'error instanceof Error ? error.name : ""' },
  { id: "code", text: 'String((error as { code?: unknown } | null)?.code ?? "")' },
  { id: "cause.code", text: 'String((error as { cause?: { code?: unknown } } | null)?.cause?.code ?? "")' },
  { id: "cause.name", text: 'String((error as { cause?: { name?: unknown } } | null)?.cause?.name ?? "")' },
  { id: "cause.message", text: 'String((error as { cause?: { message?: unknown } } | null)?.cause?.message ?? "")' },
];

/** An error's fields in the wire fake language: { code?, name?, cause?: { code?, name?, message? } }, string literals only, non-empty. */
const WIRE_FIELDS = new Set(["code", "name", "cause"]);
const WIRE_CAUSE_FIELDS = new Set(["code", "name", "message"]);
function fieldsObject(e: ts.Expression, allowed: ReadonlySet<string>, nested: boolean): string | null {
  if (!ts.isObjectLiteralExpression(e) || !e.properties.length) return null;
  const out: string[] = [];
  const seen = new Set<string>();
  for (const p of e.properties) {
    if (!ts.isPropertyAssignment(p) || !ts.isIdentifier(p.name) || !allowed.has(p.name.text) || seen.has(p.name.text)) return null;
    seen.add(p.name.text);
    if (p.name.text === "cause" && !nested) { const c = fieldsObject(p.initializer, WIRE_CAUSE_FIELDS, true); if (c === null) return null; out.push(`cause: ${c}`); continue; }
    const v = literalString(p.initializer);
    if (v === null) return null;
    out.push(`${p.name.text}: ${JSON.stringify(v)}`);
  }
  return `{ ${out.join(", ")} }`;
}
export function wireErrorFields(e: ts.Expression): string | null { return fieldsObject(e, WIRE_FIELDS, false); }
/** The emitted fields object, re-read on the graded test (same shape). */
function emittedErrorFieldsOk(e: ts.Expression): boolean { return wireErrorFields(e) !== null; }

/** The fixed harness of a derive-wire test (the M98 harness plus error fields; Job B checks it byte for byte). */
export const WIRE_FAKE_HARNESS = `// G18 (public-derive-wire-v1): every collaborator is a recorded, injected object-literal fake; a rejects / throws
// outcome may carry the error's fields (code, name, cause); the test reads no clock, environment, network, timer or
// global, and each outcome is captured, so a pre-edit failure is an assertion failure.
type ErrorFields = { code?: string; name?: string; cause?: { code?: string; name?: string; message?: string } };
type Outcome = { kind: "resolves" | "returns" | "rejects" | "throws"; value: () => unknown; error?: () => ErrorFields };
type Fake = ((...args: unknown[]) => unknown) & { calls: unknown[][] };
function failure(o: Outcome): Error {
  const f: ErrorFields = o.error ? o.error() : {};
  const e = f.cause === undefined ? new Error(String(o.value())) : new Error(String(o.value()), { cause: f.cause });
  if (f.code !== undefined) Object.assign(e, { code: f.code });
  if (f.name !== undefined) e.name = f.name;
  return e;
}
function fakeFn(outcomes: Outcome[]): Fake {
  const calls: unknown[][] = [];
  const fn = (...args: unknown[]): unknown => {
    calls.push(args);
    const o = outcomes[Math.min(calls.length, outcomes.length) - 1]!;
    if (o.kind === "returns") return o.value();
    if (o.kind === "resolves") return Promise.resolve(o.value());
    if (o.kind === "rejects") return Promise.reject(failure(o));
    throw failure(o);
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

/** A string-line helper: `export function H(a: string, ..): string { return EXPR; }` (1-4 string params), EXPR string literals and params joined by `+`. */
export interface WireHelper { name: string; params: string[]; expr: ts.Expression }
export function wireHelper(sf: ts.SourceFile, name: string): WireHelper | null {
  const decls = sf.statements.filter((s): s is ts.FunctionDeclaration => ts.isFunctionDeclaration(s) && s.name?.text === name);
  if (decls.length !== 1) return null;
  const f = decls[0]!;
  if (!f.body || f.asteriskToken || f.typeParameters || !(ts.getModifiers(f) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword) || (ts.getModifiers(f) ?? []).some((m) => m.kind === ts.SyntaxKind.AsyncKeyword || m.kind === ts.SyntaxKind.DeclareKeyword)) return null;
  if (!f.type || f.type.kind !== ts.SyntaxKind.StringKeyword || f.parameters.length < 1 || f.parameters.length > 4) return null;
  const params: string[] = [];
  for (const p of f.parameters) {
    if (!ts.isIdentifier(p.name) || p.initializer || p.questionToken || p.dotDotDotToken || !p.type || p.type.kind !== ts.SyntaxKind.StringKeyword) return null;
    params.push(p.name.text);
  }
  if (new Set(params).size !== params.length || f.body.statements.length !== 1) return null;
  const r = f.body.statements[0]!;
  if (!ts.isReturnStatement(r) || !r.expression) return null;
  const ok = (e: ts.Expression): boolean => {
    if (ts.isParenthesizedExpression(e)) return ok(e.expression);
    if (ts.isStringLiteral(e)) return true;
    if (ts.isIdentifier(e)) return params.includes(e.text);
    return ts.isBinaryExpression(e) && e.operatorToken.kind === ts.SyntaxKind.PlusToken && ok(e.left) && ok(e.right);
  };
  return ok(r.expression) ? { name, params, expr: r.expression } : null;
}
/** The helper's value for string arguments (it only concatenates string literals and its string parameters). */
export function evalWireHelper(h: WireHelper, args: readonly string[]): string {
  const ev = (e: ts.Expression): string => {
    if (ts.isParenthesizedExpression(e)) return ev(e.expression);
    if (ts.isStringLiteral(e)) return e.text;
    if (ts.isIdentifier(e)) return args[h.params.indexOf(e.text)]!;
    const b = e as ts.BinaryExpression;
    return ev(b.left) + ev(b.right);
  };
  return ev(h.expr);
}

const declaresName = (root: ts.Node, name: string): boolean => {
  let hit = false;
  const v = (n: ts.Node): void => {
    if (hit) return;
    const nm = (n as { name?: ts.Node }).name;
    if ((ts.isVariableDeclaration(n) || ts.isParameter(n) || ts.isFunctionDeclaration(n) || ts.isClassDeclaration(n) || ts.isBindingElement(n) || ts.isImportSpecifier(n) || ts.isImportClause(n) || ts.isNamespaceImport(n) || ts.isEnumDeclaration(n) || ts.isInterfaceDeclaration(n) || ts.isTypeAliasDeclaration(n) || ts.isModuleDeclaration(n) || ts.isImportEqualsDeclaration(n)) && nm && ts.isIdentifier(nm) && nm.text === name) { hit = true; return; }
    ts.forEachChild(n, v);
  };
  v(root);
  return hit;
};

/** The catch of a wire edit: `catch { continue; }` (inside a loop of the target) or `catch (error) { throw new Error(H(args), { cause: error }); }`. */
export type WireCatch = { kind: "continue" } | { kind: "rethrow"; helper: string; args: string[] };
function wireCatchOf(sf: ts.SourceFile, t: Target, tr: ts.TryStatement): WireCatch | string {
  const cc = tr.catchClause!;
  const body = cc.block.statements;
  if (body.length !== 1) return "wire_catch_grammar";
  const st = body[0]!;
  if (ts.isContinueStatement(st)) {
    if (cc.variableDeclaration || st.label) return "wire_catch_grammar";
    for (let p: ts.Node = tr.parent; p && p !== t.node; p = p.parent) {
      if (isFunctionLike(p)) return "wire_catch_grammar";
      if (ts.isForOfStatement(p) || ts.isForStatement(p) || ts.isForInStatement(p) || ts.isWhileStatement(p) || ts.isDoStatement(p)) return { kind: "continue" };
    }
    return "wire_catch_grammar";
  }
  const v = cc.variableDeclaration;
  if (!v || !ts.isIdentifier(v.name) || v.name.text !== "error" || v.type || v.initializer) return "wire_catch_grammar";
  if (!ts.isThrowStatement(st) || !ts.isNewExpression(st.expression)) return "wire_catch_grammar";
  const ne = st.expression;
  if (!ts.isIdentifier(ne.expression) || ne.expression.text !== "Error" || ne.typeArguments || ne.arguments?.length !== 2) return "wire_catch_grammar";
  const [msg, opts] = ne.arguments;
  if (!opts || !ts.isObjectLiteralExpression(opts) || opts.properties.length !== 1) return "wire_catch_grammar";
  const cp = opts.properties[0]!;
  if (!ts.isPropertyAssignment(cp) || !ts.isIdentifier(cp.name) || cp.name.text !== "cause" || !ts.isIdentifier(cp.initializer) || cp.initializer.text !== "error") return "wire_catch_grammar";
  if (!msg || !ts.isCallExpression(msg) || !ts.isIdentifier(msg.expression) || msg.typeArguments || msg.questionDotToken) return "wire_catch_grammar";
  const helper = wireHelper(sf, msg.expression.text);
  if (!helper || helper.name === (t.kind === "function" ? t.name : "") || msg.arguments.length !== helper.params.length) return "wire_catch_helper";
  const stringParams = t.node.parameters.filter((p) => ts.isIdentifier(p.name) && p.type?.kind === ts.SyntaxKind.StringKeyword).map((p) => (p.name as ts.Identifier).text);
  const args: string[] = [];
  for (const a of msg.arguments) {
    const form = WIRE_ARG_FORMS.find((f) => sameCode(a.getText(sf), f.text));
    if (form) { args.push(form.id); continue; }
    if (ts.isIdentifier(a) && stringParams.includes(a.text)) { args.push(`param:${a.text}`); continue; }
    return "wire_catch_grammar";
  }
  // the global Error and the helper are what they look like: neither is re-bound in the module or the target
  if (declaresName(sf, "Error") || declaresName(t.node, helper.name) || t.node.parameters.some((p) => declaresName(p, "error"))) return "wire_catch_shadow";
  return { kind: "rethrow", helper: helper.name, args };
}

/**
 * Job A and Job B: is the change from `baseText` to `realText` a wire edit of `target`? Exactly one own statement of
 * the real target is a `try { S' } catch .. { .. }` (no finally) such that putting S back (S' is S, or `return await X`
 * for the base's `return X`) gives the base file token for token. Null when the edit is not a try wrap (then it is an
 * ordinary M98 edit, as is a wrap whose catch is outside the wire grammar); else the shape, with
 * `stripped` = the real text whose catch is `catch (error) { throw error; }` (what the capability delta is taken on).
 */
export function wireEditShape(path: string, baseText: string, realText: string, target: string): { stripped: string; catch: WireCatch; site: string } | null {
  const sf = ts.createSourceFile(path, realText, ts.ScriptTarget.Latest, true);
  if (diag(sf)) return null;
  const t = findTarget(sf, target);
  if (!t?.node.body) return null;
  const baseTokens = codeTokens(baseText);
  const same = (text: string): boolean => { const x = codeTokens(text); return x.length === baseTokens.length && x.every((k, i) => k === baseTokens[i]); };
  const hits: { tr: ts.TryStatement; inner: string }[] = [];
  for (const s of ownStatements(t.node.body)) {
    if (!ts.isTryStatement(s) || !s.catchClause || s.finallyBlock || s.tryBlock.statements.length !== 1) continue;
    const inner = s.tryBlock.statements[0]!;
    const forms = [inner.getText(sf)];
    if (ts.isReturnStatement(inner) && inner.expression && ts.isAwaitExpression(inner.expression)) forms.push(`return ${inner.expression.expression.getText(sf)};`);
    for (const f of forms) if (same(realText.slice(0, s.getStart(sf)) + f + realText.slice(s.getEnd()))) { hits.push({ tr: s, inner: f }); break; }
  }
  if (hits.length !== 1) return null;
  const { tr, inner } = hits[0]!;
  // a wrap whose catch is outside the wire grammar is not a wire edit: it stays an ordinary M98 edit (generic gates,
  // M98 harness), so this recognizer never loosens or changes how a non-wire edit is checked
  const c = wireCatchOf(sf, t, tr);
  if (typeof c === "string") return null;
  const cc = tr.catchClause!;
  const stripped = realText.slice(0, cc.getStart(sf)) + "catch (error) { throw error; }" + realText.slice(cc.getEnd());
  return { stripped, catch: c, site: inner };
}

/** Job A: gate ONE derived wire edit (the derive-wire search's oldText -> newText) through every M98 gate, wire harness. */
export function gateWireEdit(target: string, filePath: string, split: { oldText: string; newText: string }, lines: readonly string[], files: readonly { path: string; content: string }[], isTest: (p: string) => boolean): { edit: ExistingEdit | null; reason: string | null } {
  return gateSuppliedEdit(target, filePath, split, lines, files, isTest, true);
}

// ---------------------------------------------------------------------------------------------------------------
// G18 derive-wire v2 (public-derive-wire-v2, kind EXISTING_EDIT): the shared Job A / Job B pieces of two more
// DERIVED edits (the search lives in derive-wire-v2.ts; peaceai/spec/derive-wire-v2.md).
//
//   retry           the target method's body becomes ONE fixed loop: each attempt re-runs the base statements before
//                   the site (so it signs again: fresh `now()`), calls the site with its own per-attempt timeout
//                   signal, and retries only (a) a rejected call (network error / timeout) or (b) a response whose
//                   status the existing status predicate S accepts, while the existing limit predicate A allows
//                   (A(failed tries)), waiting the existing delay D(attempt, base) through an injected `sleep`.
//                   A class with a config-object constructor gets the `sleep` seam in the existing `P.k ?? default`
//                   pattern (one optional config member, one field, one constructor line) when it has none.
//   recorded skip   one awaited call statement inside a for-of loop of the target (an expression statement, or a
//                   `const X = await ..` declaration, hoisted to `let X;`) is wrapped so that a failure the filter
//                   matches is RECORDED (pushed to an existing local list of the target) and the loop goes on, and
//                   every other failure is RE-THROWN (G26: v1's bare `catch { continue; }` swallowed every error and
//                   left no record; v2 never emits it).
//
// Both are recognized STRUCTURALLY: Job B extracts the holes from the graded tree, rebuilds the edit from the base and
// the holes with the same builder, and requires the graded file token for token. The holes are names (existing pure
// numeric helpers, an existing field, an existing local list), numbers stated in the issue prose, and closed-set error
// reads (WIRE_ARG_FORMS) compared with literals from the examples; nothing else can enter.
// ---------------------------------------------------------------------------------------------------------------
export const WIRE2_VOCAB: Record<(typeof EXISTING_EDIT_PARAM_KEYS)[number], readonly string[]> = {
  fakes: ["recorded-object-literal-v2-error-fields-call-args"],
  grading: ["self-fail-before-pass-after-assertions"],
  io: ["injected-only-v2-template-timeout"],
  match: ["derived-unique-call-site-v2"],
  paths: ["in-scope-source"],
  statements: ["derived-retry-or-recorded-skip-v2"],
  target: ["named-function-or-class-method"],
  test: ["new-file-fake-driven"],
};
export function isWire2Params(p: Record<string, unknown>): boolean {
  return Object.keys(p).sort().join(",") === [...EXISTING_EDIT_PARAM_KEYS].join(",") && EXISTING_EDIT_PARAM_KEYS.every((k) => typeof p[k] === "string" && WIRE2_VOCAB[k].length === 1 && WIRE2_VOCAB[k].includes(p[k] as string));
}

/** An existing pure numeric helper: `export function H(a: number[, b: number]): number | boolean { return EXPR; }`, EXPR over its params, number literals and arithmetic / comparison / logic / ternary only. */
export interface NumHelper { name: string; params: string[]; returns: "number" | "boolean"; expr: ts.Expression }
const NUM_OPS = new Set([ts.SyntaxKind.PlusToken, ts.SyntaxKind.MinusToken, ts.SyntaxKind.AsteriskToken, ts.SyntaxKind.SlashToken, ts.SyntaxKind.PercentToken, ts.SyntaxKind.LessThanToken, ts.SyntaxKind.LessThanEqualsToken, ts.SyntaxKind.GreaterThanToken, ts.SyntaxKind.GreaterThanEqualsToken, ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken, ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.BarBarToken]);
export function numHelper(sf: ts.SourceFile, name: string): NumHelper | null {
  const decls = sf.statements.filter((s): s is ts.FunctionDeclaration => ts.isFunctionDeclaration(s) && s.name?.text === name);
  if (decls.length !== 1) return null;
  const f = decls[0]!;
  const mods = ts.getModifiers(f) ?? [];
  if (!f.body || f.asteriskToken || f.typeParameters || !mods.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) || mods.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword || m.kind === ts.SyntaxKind.DeclareKeyword || m.kind === ts.SyntaxKind.DefaultKeyword)) return null;
  const returns = f.type?.kind === ts.SyntaxKind.NumberKeyword ? "number" : f.type?.kind === ts.SyntaxKind.BooleanKeyword ? "boolean" : null;
  if (!returns || f.parameters.length < 1 || f.parameters.length > 2) return null;
  const params: string[] = [];
  for (const p of f.parameters) {
    if (!ts.isIdentifier(p.name) || p.initializer || p.questionToken || p.dotDotDotToken || p.type?.kind !== ts.SyntaxKind.NumberKeyword) return null;
    params.push(p.name.text);
  }
  if (new Set(params).size !== params.length || f.body.statements.length !== 1) return null;
  const r = f.body.statements[0]!;
  if (!ts.isReturnStatement(r) || !r.expression) return null;
  const ok = (e: ts.Expression): boolean => {
    if (ts.isParenthesizedExpression(e)) return ok(e.expression);
    if (ts.isNumericLiteral(e)) return Number.isFinite(Number(e.text));
    if (ts.isIdentifier(e)) return params.includes(e.text);
    if (ts.isPrefixUnaryExpression(e)) return (e.operator === ts.SyntaxKind.ExclamationToken || e.operator === ts.SyntaxKind.MinusToken) && ok(e.operand);
    if (ts.isConditionalExpression(e)) return ok(e.condition) && ok(e.whenTrue) && ok(e.whenFalse);
    return ts.isBinaryExpression(e) && NUM_OPS.has(e.operatorToken.kind) && ok(e.left) && ok(e.right);
  };
  return ok(r.expression) ? { name, params, returns, expr: r.expression } : null;
}
export function evalNumHelper(h: NumHelper, args: readonly number[]): number | boolean {
  const ev = (e: ts.Expression): number | boolean => {
    if (ts.isParenthesizedExpression(e)) return ev(e.expression);
    if (ts.isNumericLiteral(e)) return Number(e.text);
    if (ts.isIdentifier(e)) return args[h.params.indexOf(e.text)]!;
    if (ts.isPrefixUnaryExpression(e)) { const v = ev(e.operand); return e.operator === ts.SyntaxKind.ExclamationToken ? !v : -(v as number); }
    if (ts.isConditionalExpression(e)) return ev(e.condition) ? ev(e.whenTrue) : ev(e.whenFalse);
    const b = e as ts.BinaryExpression;
    const l = ev(b.left);
    if (b.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) return l ? ev(b.right) : l;
    if (b.operatorToken.kind === ts.SyntaxKind.BarBarToken) return l ? l : ev(b.right);
    const x = l as number, y = ev(b.right) as number;
    switch (b.operatorToken.kind) {
      case ts.SyntaxKind.PlusToken: return x + y;
      case ts.SyntaxKind.MinusToken: return x - y;
      case ts.SyntaxKind.AsteriskToken: return x * y;
      case ts.SyntaxKind.SlashToken: return x / y;
      case ts.SyntaxKind.PercentToken: return x % y;
      case ts.SyntaxKind.LessThanToken: return x < y;
      case ts.SyntaxKind.LessThanEqualsToken: return x <= y;
      case ts.SyntaxKind.GreaterThanToken: return x > y;
      case ts.SyntaxKind.GreaterThanEqualsToken: return x >= y;
      case ts.SyntaxKind.EqualsEqualsEqualsToken: return x === y;
      default: return x !== y;
    }
  };
  return ev(h.expr);
}

const lineIndent = (text: string, pos: number): string => /^[ \t]*/.exec(text.slice(text.lastIndexOf("\n", pos - 1) + 1))![0];
const topDeclares = (sf: ts.SourceFile, name: string): boolean => sf.statements.some((s) => declaresName(s, name));
type Splice = { start: number; end: number; text: string };
const applySplices = (text: string, xs: Splice[]): string => [...xs].sort((a, b) => b.start - a.start).reduce((t, x) => t.slice(0, x.start) + x.text + t.slice(x.end), text);
/** A root identifier every assignment in `stmts` writes through, or null (`init.body = ..` -> init). */
const assignRoots = (stmts: readonly ts.Statement[]): (string | null)[] => {
  const out: (string | null)[] = [];
  const rootOf = (e: ts.Expression): string | null => (ts.isIdentifier(e) ? e.text : ts.isPropertyAccessExpression(e) || ts.isElementAccessExpression(e) ? rootOf(e.expression) : ts.isParenthesizedExpression(e) ? rootOf(e.expression) : null);
  const v = (n: ts.Node): void => {
    if (ts.isBinaryExpression(n) && n.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && n.operatorToken.kind <= ts.SyntaxKind.LastAssignment) out.push(rootOf(n.left));
    if ((ts.isPrefixUnaryExpression(n) || ts.isPostfixUnaryExpression(n)) && (n.operator === ts.SyntaxKind.PlusPlusToken || n.operator === ts.SyntaxKind.MinusMinusToken)) out.push(rootOf(n.operand));
    ts.forEachChild(n, v);
  };
  stmts.forEach(v);
  return out;
};
const hasKind = (n: ts.Node, kinds: readonly ts.SyntaxKind[]): boolean => { let hit = false; const v = (x: ts.Node): void => { if (hit) return; if (kinds.includes(x.kind)) { hit = true; return; } ts.forEachChild(x, v); }; v(n); return hit; };

/** The holes of a v2 retry edit. `imports`: helpers taken from another module (name -> specifier as written). */
export interface RetryHoles { target: string; site: string; status: string; allowed: string; delay: string; timeoutMs: number; baseMs: number; imports: { name: string; from: string }[] }
export const RETRY_SLEEP_TYPE = "(ms: number) => Promise<void>";
export const RETRY_SLEEP_DEFAULT = "((ms: number) => new Promise<void>((done) => setTimeout(done, ms)))";

/** The class's config-injection seam: `constructor(P: I)` / `constructor(private readonly P: I)` with I a module interface and at least one `this.k = P.k ?? E;`. */
function configSeam(sf: ts.SourceFile, cls: ts.ClassDeclaration): { ctor: ts.ConstructorDeclaration; param: string; iface: ts.InterfaceDeclaration; fields: Map<string, string> } | null {
  const ctors = cls.members.filter((m): m is ts.ConstructorDeclaration => ts.isConstructorDeclaration(m));
  if (ctors.length !== 1 || !ctors[0]!.body || ctors[0]!.parameters.length !== 1) return null;
  const ctor = ctors[0]!;
  const p = ctor.parameters[0]!;
  if (!ts.isIdentifier(p.name) || !p.type || !ts.isTypeReferenceNode(p.type) || !ts.isIdentifier(p.type.typeName) || p.type.typeArguments || p.initializer || p.questionToken) return null;
  const ifName = p.type.typeName.text;
  const ifs = sf.statements.filter((s): s is ts.InterfaceDeclaration => ts.isInterfaceDeclaration(s) && s.name.text === ifName);
  if (ifs.length !== 1 || ifs[0]!.heritageClauses || ifs[0]!.typeParameters || !ifs[0]!.members.length) return null;
  const fields = new Map<string, string>();
  for (const s of ctor.body!.statements) {
    if (!ts.isExpressionStatement(s) || !ts.isBinaryExpression(s.expression) || s.expression.operatorToken.kind !== ts.SyntaxKind.EqualsToken) continue;
    const { left, right } = s.expression;
    if (!ts.isPropertyAccessExpression(left) || left.expression.kind !== ts.SyntaxKind.ThisKeyword || !ts.isBinaryExpression(right) || right.operatorToken.kind !== ts.SyntaxKind.QuestionQuestionToken) continue;
    const r = right.left;
    if (ts.isPropertyAccessExpression(r) && ts.isIdentifier(r.expression) && r.expression.text === p.name.text) fields.set(left.name.text, r.name.text);
  }
  return fields.size ? { ctor, param: p.name.text, iface: ifs[0]!, fields } : null;
}
/** The config key a field of the target's class is injected under (`this.F = P.K ?? E`), or null. */
export function injectedKeyOf(sf: ts.SourceFile, cls: ts.ClassDeclaration, field: string): string | null {
  return configSeam(sf, cls)?.fields.get(field) ?? null;
}

/** Build the v2 retry edit of the base file, or null when the base does not have the retry shape. */
export function retryEdit(path: string, baseText: string, h: RetryHoles): string | null {
  const sf = ts.createSourceFile(path, baseText, ts.ScriptTarget.Latest, true);
  if (diag(sf)) return null;
  const t = findTarget(sf, h.target);
  if (!t || t.kind !== "method" || !t.node.body || !t.node.modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword)) return null;
  if (!Number.isInteger(h.timeoutMs) || h.timeoutMs < 1 || h.timeoutMs > 600000 || !Number.isInteger(h.baseMs) || h.baseMs < 0 || h.baseMs > 600000) return null;
  const stmts = t.node.body.statements;
  const last = stmts[stmts.length - 1];
  if (!last || !ts.isReturnStatement(last) || !last.expression || !ts.isCallExpression(last.expression)) return null;
  const call = last.expression;
  const callee = call.expression;
  if (!ts.isPropertyAccessExpression(callee) || callee.expression.kind !== ts.SyntaxKind.ThisKeyword || callee.name.text !== h.site || call.questionDotToken || call.typeArguments) return null;
  if (call.arguments.length < 1 || call.arguments.length > 2 || (call.arguments.length === 2 && !ts.isIdentifier(call.arguments[1]!))) return null;
  const prefix = stmts.slice(0, -1);
  // the base statements re-run on every attempt: no other exit, no await / yield / try / throw, and they write only
  // through their own locals (a re-run may not touch a parameter, `this` or module state twice)
  if (prefix.some((s) => hasKind(s, [ts.SyntaxKind.ReturnStatement, ts.SyntaxKind.AwaitExpression, ts.SyntaxKind.YieldExpression, ts.SyntaxKind.TryStatement, ts.SyntaxKind.ThrowStatement, ts.SyntaxKind.ForStatement, ts.SyntaxKind.ForOfStatement, ts.SyntaxKind.ForInStatement, ts.SyntaxKind.WhileStatement, ts.SyntaxKind.DoStatement, ts.SyntaxKind.FunctionExpression, ts.SyntaxKind.ArrowFunction, ts.SyntaxKind.ClassExpression]))) return null;
  const locals = new Set<string>();
  for (const s of prefix) if (ts.isVariableStatement(s)) for (const d of s.declarationList.declarations) if (ts.isIdentifier(d.name)) locals.add(d.name.text);
  if (assignRoots(prefix).some((r) => r === null || !locals.has(r))) return null;
  if (["attempt", "response", "error"].some((n) => declaresName(t.node, n))) return null;
  const helperNames = [h.status, h.allowed, h.delay];
  if (helperNames.some((n) => declaresName(t.node, n) || declaresName(t.classNode, n))) return null;
  // the helpers: declared in this module, or imported by this edit (one new single-name import per helper)
  const importNames = new Set(h.imports.map((x) => x.name));
  if (importNames.size !== h.imports.length || h.imports.some((x) => !helperNames.includes(x.name) || !/^\.{1,2}\/[\w./-]+$/.test(x.from))) return null;
  for (const n of new Set(helperNames)) {
    const local = topDeclares(sf, n);
    if (local === importNames.has(n)) return null;
    if (local && !numHelper(sf, n)) return null;
  }
  const splices: Splice[] = [];
  // imports: after the last import declaration (or at the top), one line each, in the order given
  if (h.imports.length) {
    const imps = sf.statements.filter((s) => ts.isImportDeclaration(s));
    if (h.imports.some((x) => imps.some((s) => ts.isStringLiteral((s as ts.ImportDeclaration).moduleSpecifier) && ((s as ts.ImportDeclaration).moduleSpecifier as ts.StringLiteral).text === x.from))) return null;
    const lines = h.imports.map((x) => `import { ${x.name} } from ${JSON.stringify(x.from)};`).join("\n");
    const at = imps.length ? imps[imps.length - 1]!.getEnd() : 0;
    splices.push({ start: at, end: at, text: imps.length ? `\n${lines}` : `${lines}\n` });
  }
  // the sleep seam
  const cls = t.classNode;
  const hasSleep = cls.members.some((m) => m.name && ts.isIdentifier(m.name) && m.name.text === "sleep");
  if (hasSleep) {
    const f = cls.members.find((m): m is ts.PropertyDeclaration => ts.isPropertyDeclaration(m) && ts.isIdentifier(m.name) && m.name.text === "sleep");
    const seam = configSeam(sf, cls);
    if (!f || !f.type || !sameCode(f.type.getText(sf), RETRY_SLEEP_TYPE) || seam?.fields.get("sleep") !== "sleep") return null;
  } else {
    const seam = configSeam(sf, cls);
    if (!seam || seam.iface.members.some((m) => m.name && (ts.isIdentifier(m.name) || ts.isStringLiteral(m.name)) && m.name.text === "sleep")) return null;
    if (declaresName(seam.ctor, "ms") || declaresName(seam.ctor, "done")) return null;
    const props = cls.members.filter((m) => ts.isPropertyDeclaration(m));
    if (!props.length) return null;
    const lastMember = seam.iface.members[seam.iface.members.length - 1]!;
    splices.push({ start: lastMember.getEnd(), end: lastMember.getEnd(), text: `\n${lineIndent(baseText, lastMember.getStart(sf))}sleep?: ${RETRY_SLEEP_TYPE};` });
    const lastProp = props[props.length - 1]!;
    splices.push({ start: lastProp.getEnd(), end: lastProp.getEnd(), text: `\n${lineIndent(baseText, lastProp.getStart(sf))}private readonly sleep: ${RETRY_SLEEP_TYPE};` });
    const cs = seam.ctor.body!.statements;
    const lastCs = cs[cs.length - 1]!;
    splices.push({ start: lastCs.getEnd(), end: lastCs.getEnd(), text: `\n${lineIndent(baseText, lastCs.getStart(sf))}this.sleep = ${seam.param}.sleep ?? ${RETRY_SLEEP_DEFAULT};` });
  }
  // the method body
  const body = t.node.body;
  const i0 = lineIndent(baseText, t.node.getStart(sf));
  const i1 = lineIndent(baseText, stmts[0]!.getStart(sf));
  const step = i1.slice(i0.length) || "  ";
  const i2 = i1 + step, i3 = i2 + step;
  const shift = (text: string): string => text.split("\n").map((l) => (l.trim() ? `${step}${l}` : l)).join("\n");
  const pre = prefix.length ? shift(baseText.slice(baseText.lastIndexOf("\n", prefix[0]!.getStart(sf) - 1) + 1, prefix[prefix.length - 1]!.getEnd())) : "";
  const signal = `signal: AbortSignal.timeout(${h.timeoutMs})`;
  const args = call.arguments.length === 2 ? `${call.arguments[0]!.getText(sf)}, { ...${call.arguments[1]!.getText(sf)}, ${signal} }` : `${call.arguments[0]!.getText(sf)}, { ${signal} }`;
  const wait = `await this.sleep(${h.delay}(attempt, ${h.baseMs}));`;
  const text = [
    "{",
    `${i1}for (let attempt = 0; ; attempt += 1) {`,
    ...(pre ? [pre] : []),
    `${i2}let response;`,
    `${i2}try {`,
    `${i3}response = await this.${h.site}(${args});`,
    `${i2}} catch (error) {`,
    `${i3}if (!${h.allowed}(attempt + 1)) throw error;`,
    `${i3}${wait}`,
    `${i3}continue;`,
    `${i2}}`,
    `${i2}if (!${h.status}(response.status) || !${h.allowed}(attempt + 1)) return response;`,
    `${i2}${wait}`,
    `${i1}}`,
    `${i0}}`,
  ].join("\n");
  splices.push({ start: body.getStart(sf), end: body.getEnd(), text });
  return applySplices(baseText, splices);
}

/**
 * Job A and Job B: is `realText` the v2 retry edit of `baseText`? The holes are read off the real tree, the edit is
 * rebuilt from the base with retryEdit, and the real file must match it token for token; each helper must be an
 * existing pure numeric helper (numHelper) of this module or of the relative module it is imported from (`read`).
 * `stripped` is the real text with the per-attempt `AbortSignal.timeout(N)` (the template's only timer) replaced by
 * `undefined`, for the hermetic walk; every other token of the real edit is walked as is.
 */
export function retryEditShape(path: string, baseText: string, realText: string, read: Read): { target: string; stripped: string; holes: RetryHoles } | null {
  const sf = ts.createSourceFile(path, realText, ts.ScriptTarget.Latest, true);
  if (diag(sf)) return null;
  const hits: { cls: string; m: ts.MethodDeclaration; loop: ts.ForStatement }[] = [];
  for (const st of sf.statements) {
    if (!ts.isClassDeclaration(st) || !st.name) continue;
    for (const m of st.members) {
      if (!ts.isMethodDeclaration(m) || !m.body || !ts.isIdentifier(m.name) || m.body.statements.length !== 1) continue;
      const loop = m.body.statements[0]!;
      if (ts.isForStatement(loop) && !loop.condition && loop.initializer?.getText(sf) === "let attempt = 0" && loop.incrementor?.getText(sf) === "attempt += 1") hits.push({ cls: st.name.text, m, loop });
    }
  }
  if (hits.length !== 1) return null;
  const { cls, m, loop } = hits[0]!;
  if (!ts.isBlock(loop.statement)) return null;
  const ls = loop.statement.statements;
  const tr = ls[ls.length - 3];
  const tail = ls[ls.length - 2];
  if (!tr || !ts.isTryStatement(tr) || !tr.catchClause || !tail || !ts.isIfStatement(tail)) return null;
  const a = tr.tryBlock.statements[0];
  if (!a || !ts.isExpressionStatement(a) || !ts.isBinaryExpression(a.expression) || !ts.isAwaitExpression(a.expression.right) || !ts.isCallExpression(a.expression.right.expression)) return null;
  const siteCall = a.expression.right.expression;
  if (!ts.isPropertyAccessExpression(siteCall.expression)) return null;
  const site = siteCall.expression.name.text;
  const opts = siteCall.arguments[siteCall.arguments.length - 1];
  const sig = opts && ts.isObjectLiteralExpression(opts) ? opts.properties[opts.properties.length - 1] : undefined;
  if (!sig || !ts.isPropertyAssignment(sig) || !ts.isCallExpression(sig.initializer) || sig.initializer.getText(sf).replace(/\d+/, "") !== "AbortSignal.timeout()" || !ts.isNumericLiteral(sig.initializer.arguments[0]!)) return null;
  const timeoutMs = Number((sig.initializer.arguments[0] as ts.NumericLiteral).text);
  const c0 = tr.catchClause.block.statements[0], c1 = tr.catchClause.block.statements[1];
  const calleeOf = (e: ts.Expression | undefined): ts.CallExpression | null => {
    let x = e;
    while (x && (ts.isPrefixUnaryExpression(x) || ts.isAwaitExpression(x) || ts.isParenthesizedExpression(x))) x = ts.isPrefixUnaryExpression(x) ? x.operand : x.expression;
    return x && ts.isCallExpression(x) ? x : null;
  };
  const allowedCall = c0 && ts.isIfStatement(c0) ? calleeOf(c0.expression) : null;
  const sleepCall = c1 && ts.isExpressionStatement(c1) ? calleeOf(c1.expression) : null;
  const delayCall = sleepCall ? calleeOf(sleepCall.arguments[0]) : null;
  const statusCall = ts.isBinaryExpression(tail.expression) ? calleeOf(tail.expression.left) : null;
  const nameOf = (c: ts.CallExpression | null): string | null => (c && ts.isIdentifier(c.expression) ? c.expression.text : null);
  const allowed = nameOf(allowedCall), delay = nameOf(delayCall), status = nameOf(statusCall);
  const baseArg = delayCall?.arguments[1];
  if (!allowed || !delay || !status || !baseArg || !ts.isNumericLiteral(baseArg)) return null;
  const bsf = ts.createSourceFile(path, baseText, ts.ScriptTarget.Latest, true);
  if (diag(bsf)) return null;
  const imports: { name: string; from: string }[] = [];
  const dir = path.slice(0, path.lastIndexOf("/") + 1);
  for (const n of [...new Set([status, allowed, delay])]) {
    if (topDeclares(bsf, n)) { if (!numHelper(bsf, n)) return null; continue; }
    const imp = sf.statements.find((s): s is ts.ImportDeclaration => ts.isImportDeclaration(s) && !!s.importClause?.namedBindings && ts.isNamedImports(s.importClause.namedBindings) && s.importClause.namedBindings.elements.length === 1 && s.importClause.namedBindings.elements[0]!.name.text === n && !s.importClause.namedBindings.elements[0]!.propertyName && !s.importClause.name && !s.importClause.isTypeOnly);
    if (!imp || !ts.isStringLiteral(imp.moduleSpecifier)) return null;
    const from = imp.moduleSpecifier.text;
    const rel = normalizeRel(dir, from);
    const src = rel === null ? null : read(rel) ?? read(`${rel}.ts`);
    if (src === null || !numHelper(ts.createSourceFile(rel!, src, ts.ScriptTarget.Latest, true), n)) return null;
    imports.push({ name: n, from });
  }
  // the imports are listed in the order they appear in the real file
  imports.sort((x, y) => realText.indexOf(`import { ${x.name} } from`) - realText.indexOf(`import { ${y.name} } from`));
  const holes: RetryHoles = { target: `${cls}.${m.name.getText(sf)}`, site, status, allowed, delay, timeoutMs, baseMs: Number(baseArg.text), imports };
  const rebuilt = retryEdit(path, baseText, holes);
  if (rebuilt === null || !sameCode(rebuilt, realText)) return null;
  const stripped = realText.slice(0, sig.initializer.getStart(sf)) + "undefined" + realText.slice(sig.initializer.getEnd());
  return { target: holes.target, stripped, holes };
}
const normalizeRel = (dir: string, spec: string): string | null => {
  const parts = dir.split("/").filter(Boolean);
  for (const seg of spec.split("/")) {
    if (seg === "." || seg === "") continue;
    if (seg === "..") { if (!parts.length) return null; parts.pop(); } else parts.push(seg);
  }
  const p = parts.join("/");
  return /^src\/[\w./-]+$/.test(p) ? (p.endsWith(".ts") ? p : p) : null;
};

/** The holes of a v2 recorded-skip edit. */
export type RecordValue = string; // a WIRE_ARG_FORMS id, or "item" (the loop variable)
export interface RecordHoles { target: string; site: string; filter: { read: string; op: "eq" | "prefix"; lit: string }; list: string; record: { kind: "line"; value: RecordValue } | { kind: "object"; fields: [string, RecordValue][] } }
export const recordFilterText = (f: RecordHoles["filter"]): string => {
  const r = WIRE_ARG_FORMS.find((x) => x.id === f.read)!.text;
  return f.op === "eq" ? `(${r}) === ${JSON.stringify(f.lit)}` : `(${r}).startsWith(${JSON.stringify(f.lit)})`;
};
const recordValueText = (v: RecordValue, item: string): string => (v === "item" ? item : WIRE_ARG_FORMS.find((x) => x.id === v)!.text);
export const recordText = (r: RecordHoles["record"], item: string): string => (r.kind === "line" ? recordValueText(r.value, item) : `{ ${r.fields.map(([k, v]) => `${k}: ${recordValueText(v, item)}`).join(", ")} }`);

/** The site's own loop (a for-of with a `const NAME` binding, the site directly in its block) and the list declaration. */
export function recordSite(sf: ts.SourceFile, t: Target, siteText: string): { site: ts.Statement; loop: ts.ForOfStatement; item: string; decl: { name: string; type: string | null; call: string } | null; awaited: string } | null {
  if (!t.node.body) return null;
  const sites = ownStatements(t.node.body).filter((s) => sameCode(s.getText(sf), siteText));
  if (sites.length !== 1) return null;
  const site = sites[0]!;
  const block = site.parent;
  if (!ts.isBlock(block) || !ts.isForOfStatement(block.parent) || block.parent.awaitModifier) return null;
  const loop = block.parent;
  const init = loop.initializer;
  if (!ts.isVariableDeclarationList(init) || !(init.flags & ts.NodeFlags.Const) || init.declarations.length !== 1 || !ts.isIdentifier(init.declarations[0]!.name)) return null;
  for (let p: ts.Node = site.parent; p && p !== t.node.body; p = p.parent) if (ts.isTryStatement(p) || ts.isCatchClause(p) || isFunctionLike(p)) return null;
  const item = (init.declarations[0]!.name as ts.Identifier).text;
  if (ts.isExpressionStatement(site) && ts.isAwaitExpression(site.expression)) return { site, loop, item, decl: null, awaited: site.expression.expression.getText(sf) };
  if (ts.isVariableStatement(site) && site.declarationList.flags & ts.NodeFlags.Const && site.declarationList.declarations.length === 1) {
    const d = site.declarationList.declarations[0]!;
    if (!ts.isIdentifier(d.name) || !d.initializer || !ts.isAwaitExpression(d.initializer)) return null;
    // a hoisted `let X;` without a type is typed from its assignment; refuse a later use inside a nested function
    if (!d.type) {
      const name = d.name.text;
      let bad = false;
      const v = (n: ts.Node, inFn: boolean): void => { if (bad) return; if (inFn && ts.isIdentifier(n) && n.text === name) { bad = true; return; } ts.forEachChild(n, (c) => v(c, inFn || isFunctionLike(c))); };
      for (const s of block.statements.slice(block.statements.indexOf(site) + 1)) v(s, false);
      if (bad) return null;
    }
    return { site, loop, item, decl: { name: d.name.text, type: d.type ? d.type.getText(sf) : null, call: d.initializer.expression.getText(sf) }, awaited: d.initializer.expression.getText(sf) };
  }
  return null;
}
/** A list the record may go to: an own top-level `const L: string[] = []` / `const L: { k: string; .. }[] = []` of the target, before the loop. */
export function recordLists(sf: ts.SourceFile, t: Target, loop: ts.Node): { name: string; fields: string[] | null }[] {
  const out: { name: string; fields: string[] | null }[] = [];
  for (const s of t.node.body!.statements) {
    if (s.getStart(sf) >= loop.getStart(sf) || !ts.isVariableStatement(s) || !(s.declarationList.flags & ts.NodeFlags.Const)) continue;
    for (const d of s.declarationList.declarations) {
      if (!ts.isIdentifier(d.name) || !d.type || !ts.isArrayTypeNode(d.type) || !d.initializer || !ts.isArrayLiteralExpression(d.initializer) || d.initializer.elements.length) continue;
      const el = d.type.elementType;
      if (el.kind === ts.SyntaxKind.StringKeyword) { out.push({ name: d.name.text, fields: null }); continue; }
      if (!ts.isTypeLiteralNode(el) || !el.members.length || el.members.length > 3) continue;
      const fs: string[] = [];
      for (const m of el.members) if (ts.isPropertySignature(m) && ts.isIdentifier(m.name) && !m.questionToken && m.type?.kind === ts.SyntaxKind.StringKeyword && !REFLECTION.has(m.name.text)) fs.push(m.name.text);
      if (fs.length === el.members.length && new Set(fs).size === fs.length) out.push({ name: d.name.text, fields: fs });
    }
  }
  return out;
}

/** Build the v2 recorded-skip edit, or null. */
export function recordEdit(path: string, baseText: string, h: RecordHoles): string | null {
  const sf = ts.createSourceFile(path, baseText, ts.ScriptTarget.Latest, true);
  if (diag(sf)) return null;
  const t = findTarget(sf, h.target);
  if (!t?.node.body || !t.node.modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword)) return null;
  const s = recordSite(sf, t, h.site);
  if (!s) return null;
  const lists = recordLists(sf, t, s.loop).filter((l) => l.name === h.list);
  if (lists.length !== 1) return null;
  const list = lists[0]!;
  if (h.record.kind === "line" ? list.fields !== null : list.fields === null || list.fields.join(",") !== h.record.fields.map(([k]) => k).join(",")) return null;
  const values = h.record.kind === "line" ? [h.record.value] : h.record.fields.map(([, v]) => v);
  if (!values.every((v) => v === "item" || WIRE_ARG_FORMS.some((f) => f.id === v)) || !WIRE_ARG_FORMS.some((f) => f.id === h.filter.read) || h.filter.lit.length < 1 || h.filter.lit.length > 80) return null;
  if (declaresName(t.node, "error") || declaresName(sf, "Error") || declaresName(sf, "String")) return null;
  const i1 = lineIndent(baseText, s.site.getStart(sf));
  const step = i1.slice(lineIndent(baseText, s.loop.getStart(sf)).length) || "  ";
  const i2 = i1 + step;
  const inner = s.decl ? `${s.decl.name} = await ${s.decl.call};` : `await ${s.awaited};`;
  const text = [
    ...(s.decl ? [`let ${s.decl.name}${s.decl.type ? `: ${s.decl.type}` : ""};`, `${i1}try {`] : ["try {"]),
    `${i2}${inner}`,
    `${i1}} catch (error) {`,
    `${i2}if (!(${recordFilterText(h.filter)})) throw error;`,
    `${i2}${h.list}.push(${recordText(h.record, s.item)});`,
    `${i2}continue;`,
    `${i1}}`,
  ].join("\n");
  return baseText.slice(0, s.site.getStart(sf)) + text + baseText.slice(s.site.getEnd());
}

/**
 * Job A and Job B: is `realText` the v2 recorded-skip edit of `target` in `baseText`? The holes are read off the real
 * catch (filter, list, record) and site, the edit is rebuilt with recordEdit and must match token for token.
 * `stripped`: the real text with that catch as `catch (error) { throw error; }` (the capability delta is taken on it,
 * as for v1); the hermetic walk runs on the real text.
 */
export function recordEditShape(path: string, baseText: string, realText: string, target: string): { stripped: string; holes: RecordHoles } | null {
  const sf = ts.createSourceFile(path, realText, ts.ScriptTarget.Latest, true);
  if (diag(sf)) return null;
  const t = findTarget(sf, target);
  if (!t?.node.body) return null;
  const hits: { tr: ts.TryStatement; holes: RecordHoles }[] = [];
  for (const s of ownStatements(t.node.body)) {
    if (!ts.isTryStatement(s) || !s.catchClause || s.finallyBlock || s.tryBlock.statements.length !== 1 || s.catchClause.block.statements.length !== 3) continue;
    const [c0, c1, c2] = s.catchClause.block.statements;
    if (!c0 || !c1 || !c2 || !ts.isIfStatement(c0) || !ts.isExpressionStatement(c1) || !ts.isContinueStatement(c2) || c2.label) continue;
    const inner = s.tryBlock.statements[0]!;
    let site: string | null = null;
    if (ts.isExpressionStatement(inner) && ts.isAwaitExpression(inner.expression)) site = inner.getText(sf);
    else if (ts.isExpressionStatement(inner) && ts.isBinaryExpression(inner.expression) && inner.expression.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isIdentifier(inner.expression.left) && ts.isAwaitExpression(inner.expression.right)) {
      const block = s.parent;
      const prev = ts.isBlock(block) ? block.statements[block.statements.indexOf(s) - 1] : undefined;
      if (!prev || !ts.isVariableStatement(prev) || prev.declarationList.declarations.length !== 1) continue;
      const d = prev.declarationList.declarations[0]!;
      if (!ts.isIdentifier(d.name) || d.name.text !== inner.expression.left.text || d.initializer) continue;
      site = `const ${d.name.text}${d.type ? `: ${d.type.getText(sf)}` : ""} = ${inner.expression.right.getText(sf)};`;
    }
    if (!site) continue;
    // the list and record: `L.push(R);`
    const push = c1.expression;
    if (!ts.isCallExpression(push) || !ts.isPropertyAccessExpression(push.expression) || push.expression.name.text !== "push" || !ts.isIdentifier(push.expression.expression) || push.arguments.length !== 1) continue;
    const list = push.expression.expression.text;
    const loopItem = (() => { for (let p: ts.Node = s.parent; p && p !== t.node.body; p = p.parent) if (ts.isForOfStatement(p) && ts.isVariableDeclarationList(p.initializer) && ts.isIdentifier(p.initializer.declarations[0]!.name)) return p.initializer.declarations[0]!.name.text; return null; })();
    if (!loopItem) continue;
    const valueOf = (e: ts.Expression): RecordValue | null => (ts.isIdentifier(e) && e.text === loopItem ? "item" : WIRE_ARG_FORMS.find((f) => sameCode(e.getText(sf), f.text))?.id ?? null);
    const r = push.arguments[0]!;
    let record: RecordHoles["record"] | null = null;
    if (ts.isObjectLiteralExpression(r)) {
      const fields: [string, RecordValue][] = [];
      for (const p of r.properties) { const v = ts.isPropertyAssignment(p) && ts.isIdentifier(p.name) ? valueOf(p.initializer) : null; if (!v) { fields.length = 0; break; } fields.push([(p.name as ts.Identifier).text, v]); }
      if (fields.length === r.properties.length && fields.length) record = { kind: "object", fields };
    } else { const v = valueOf(r); if (v) record = { kind: "line", value: v }; }
    if (!record) continue;
    // the filter: `if (!(F)) throw error;` with F one recordFilterText
    if (!ts.isThrowStatement(c0.thenStatement) || c0.elseStatement) continue;
    const ft = c0.expression;
    if (!ts.isPrefixUnaryExpression(ft) || ft.operator !== ts.SyntaxKind.ExclamationToken || !ts.isParenthesizedExpression(ft.operand)) continue;
    const f = ft.operand.expression;
    let filter: RecordHoles["filter"] | null = null;
    const litOf = (e: ts.Expression | undefined): string | null => (e && ts.isStringLiteral(e) ? e.text : null);
    if (ts.isBinaryExpression(f) && f.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken && ts.isParenthesizedExpression(f.left)) {
      const read = WIRE_ARG_FORMS.find((x) => sameCode(f.left.getText(sf), `(${x.text})`));
      const lit = litOf(f.right);
      if (read && lit !== null) filter = { read: read.id, op: "eq", lit };
    } else if (ts.isCallExpression(f) && ts.isPropertyAccessExpression(f.expression) && f.expression.name.text === "startsWith" && f.arguments.length === 1) {
      const read = WIRE_ARG_FORMS.find((x) => sameCode(f.expression.getText(sf).replace(/\.startsWith$/, ""), `(${x.text})`));
      const lit = litOf(f.arguments[0]);
      if (read && lit !== null) filter = { read: read.id, op: "prefix", lit };
    }
    if (!filter) continue;
    hits.push({ tr: s, holes: { target, site, filter, list, record } });
  }
  if (hits.length !== 1) return null;
  const { tr, holes } = hits[0]!;
  const rebuilt = recordEdit(path, baseText, holes);
  if (rebuilt === null || !sameCode(rebuilt, realText)) return null;
  const cc = tr.catchClause!;
  return { stripped: realText.slice(0, cc.getStart(sf)) + "catch (error) { throw error; }" + realText.slice(cc.getEnd()), holes };
}

// ---------------------------------------------------------------------------------------------------------------
// G29 (public-derive-wire-rethrow-v1, kind EXISTING_EDIT; peaceai/spec/derive-wire-v2.md "handle a failing call"):
// the shared Job A / Job B pieces of ONE more derived edit on a method that is ALREADY the v2 retry template
// (retryEdit's output). Only the template's final `throw error;` (the failure left after the last allowed try) is
// replaced with v1's closed rethrow `throw new Error(H(args), { cause: error });`: H an existing string-line helper
// (wireHelper) of this module or of one relative module it is imported from, the args closed error reads
// (RETHROW_ARG_IDS: never cause.message, Auditor #601; never the plain message, only the network filter, #623) or
// string parameters of the target. Nothing else changes: a status answer is returned exactly as before, a failure a
// later try recovers from is unchanged, and the catch never goes on without a throw (G26). Its own spec (statements
// "derived-rethrow-at-retry-limit-v2") keeps public-derive-wire-v2's spec, trigger and hash byte for byte.
// ---------------------------------------------------------------------------------------------------------------
export const WIRE2_RETHROW_VOCAB: Record<(typeof EXISTING_EDIT_PARAM_KEYS)[number], readonly string[]> = { ...WIRE2_VOCAB, statements: ["derived-rethrow-at-retry-limit-v2"] };
export function isWire2RethrowParams(p: Record<string, unknown>): boolean {
  return Object.keys(p).sort().join(",") === [...EXISTING_EDIT_PARAM_KEYS].join(",") && EXISTING_EDIT_PARAM_KEYS.every((k) => typeof p[k] === "string" && WIRE2_RETHROW_VOCAB[k].length === 1 && WIRE2_RETHROW_VOCAB[k].includes(p[k] as string));
}
/** The error's message only when it is one of the runtime's own network words (fetch's "fetch failed", a timeout or an
 *  abort), else the error's name: a message that may carry a URL, a key or a host never reaches the thrown message. */
export const RETHROW_NETWORK_MESSAGE = 'error instanceof Error ? (error.message === "fetch failed" || error.name === "TimeoutError" || error.name === "AbortError" ? error.message : error.name) : "Error"';
/** The error reads a G29 rethrow may pass (Auditor #601: the cause's code or name, never the cause's message; Auditor
 *  #623: never the error's plain message either, since the retry template always wraps a network call whose message is
 *  uncontrolled text, so `message.network` is the only message read). */
export const RETHROW_ARG_FORMS: readonly { id: string; text: string }[] = [...WIRE_ARG_FORMS.filter((f) => f.id !== "message" && f.id !== "cause.message"), { id: "message.network", text: RETHROW_NETWORK_MESSAGE }];
export const RETHROW_ARG_IDS: readonly string[] = RETHROW_ARG_FORMS.map((f) => f.id);
/** The holes of a G29 rethrow edit. `import`: the helper taken from another module (specifier as written), else null. */
export interface RethrowHoles { target: string; helper: string; args: string[]; import: { name: string; from: string } | null }

/** The v2 retry template as it stands in a method (retryEdit's output), read structurally; null when it is not. */
export interface RetryLoop { tr: ts.TryStatement; guard: ts.IfStatement; throwStmt: ts.ThrowStatement; site: string; status: string; allowed: string; delay: string; baseMs: number; timeoutMs: number; signal: ts.CallExpression }
export function retryLoopOf(sf: ts.SourceFile, t: Target): RetryLoop | null {
  if (t.kind !== "method" || !t.node.body || !t.node.modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword) || t.node.body.statements.length !== 1) return null;
  const loop = t.node.body.statements[0]!;
  if (!ts.isForStatement(loop) || loop.condition || loop.initializer?.getText(sf) !== "let attempt = 0" || loop.incrementor?.getText(sf) !== "attempt += 1" || !ts.isBlock(loop.statement)) return null;
  const ls = loop.statement.statements;
  if (ls.length < 4) return null;
  const [decl, tr, tail, wait] = ls.slice(-4) as [ts.Statement, ts.Statement, ts.Statement, ts.Statement];
  const prefix = ls.slice(0, -4);
  if (!sameCode(decl.getText(sf), "let response;") || !ts.isTryStatement(tr) || !tr.catchClause || tr.finallyBlock || !ts.isIfStatement(tail) || tail.elseStatement) return null;
  if (prefix.some((s) => hasKind(s, [ts.SyntaxKind.ReturnStatement, ts.SyntaxKind.AwaitExpression, ts.SyntaxKind.YieldExpression, ts.SyntaxKind.TryStatement, ts.SyntaxKind.ThrowStatement, ts.SyntaxKind.ForStatement, ts.SyntaxKind.ForOfStatement, ts.SyntaxKind.ForInStatement, ts.SyntaxKind.WhileStatement, ts.SyntaxKind.DoStatement, ts.SyntaxKind.FunctionExpression, ts.SyntaxKind.ArrowFunction, ts.SyntaxKind.ClassExpression, ts.SyntaxKind.ContinueStatement, ts.SyntaxKind.BreakStatement]) || ["attempt", "response", "error"].some((n) => declaresName(s, n)))) return null;
  // the try: `response = await this.SITE(a, { .., signal: AbortSignal.timeout(N) });`
  if (tr.tryBlock.statements.length !== 1) return null;
  const a = tr.tryBlock.statements[0]!;
  if (!ts.isExpressionStatement(a) || !ts.isBinaryExpression(a.expression) || a.expression.operatorToken.kind !== ts.SyntaxKind.EqualsToken || a.expression.left.getText(sf) !== "response" || !ts.isAwaitExpression(a.expression.right) || !ts.isCallExpression(a.expression.right.expression)) return null;
  const siteCall = a.expression.right.expression;
  if (!ts.isPropertyAccessExpression(siteCall.expression) || siteCall.expression.expression.kind !== ts.SyntaxKind.ThisKeyword || siteCall.questionDotToken || siteCall.typeArguments || siteCall.arguments.length !== 2) return null;
  const site = siteCall.expression.name.text;
  const opts = siteCall.arguments[1]!;
  const sig = ts.isObjectLiteralExpression(opts) ? opts.properties[opts.properties.length - 1] : undefined;
  if (!sig || !ts.isPropertyAssignment(sig) || !ts.isIdentifier(sig.name) || sig.name.text !== "signal" || !ts.isCallExpression(sig.initializer) || sig.initializer.arguments.length !== 1 || !ts.isNumericLiteral(sig.initializer.arguments[0]!) || !sameCode(sig.initializer.expression.getText(sf), "AbortSignal.timeout")) return null;
  const timeoutMs = Number((sig.initializer.arguments[0] as ts.NumericLiteral).text);
  // the catch: exactly `if (!A(attempt + 1)) throw error; await this.sleep(D(attempt, B)); continue;`
  const cv = tr.catchClause.variableDeclaration;
  if (!cv || !ts.isIdentifier(cv.name) || cv.name.text !== "error" || cv.type || cv.initializer) return null;
  const cs = tr.catchClause.block.statements;
  if (cs.length !== 3) return null;
  const [guard, sleep, cont] = cs as unknown as [ts.Statement, ts.Statement, ts.Statement];
  if (!ts.isIfStatement(guard) || guard.elseStatement || !ts.isThrowStatement(guard.thenStatement) || !ts.isContinueStatement(cont) || cont.label) return null;
  const g = guard.expression;
  if (!ts.isPrefixUnaryExpression(g) || g.operator !== ts.SyntaxKind.ExclamationToken || !ts.isCallExpression(g.operand) || !ts.isIdentifier(g.operand.expression)) return null;
  const allowed = g.operand.expression.text;
  if (!sameCode(guard.getText(sf), `if (!${allowed}(attempt + 1)) throw error;`)) return null;
  if (!ts.isExpressionStatement(sleep) || !ts.isAwaitExpression(sleep.expression) || !ts.isCallExpression(sleep.expression.expression)) return null;
  const sc = sleep.expression.expression;
  const dc = sc.arguments[0];
  if (sc.arguments.length !== 1 || !dc || !ts.isCallExpression(dc) || !ts.isIdentifier(dc.expression) || dc.arguments.length !== 2 || !ts.isNumericLiteral(dc.arguments[1]!)) return null;
  const delay = dc.expression.text, baseMs = Number((dc.arguments[1] as ts.NumericLiteral).text);
  const waitText = `await this.sleep(${delay}(attempt, ${baseMs}));`;
  if (!sameCode(sleep.getText(sf), waitText) || !sameCode(wait.getText(sf), waitText)) return null;
  // the tail: `if (!S(response.status) || !A(attempt + 1)) return response;`
  const te = tail.expression;
  const sl = ts.isBinaryExpression(te) && ts.isPrefixUnaryExpression(te.left) && ts.isCallExpression(te.left.operand) && ts.isIdentifier(te.left.operand.expression) ? te.left.operand.expression.text : null;
  if (!sl || !sameCode(tail.getText(sf), `if (!${sl}(response.status) || !${allowed}(attempt + 1)) return response;`)) return null;
  if ([sl, allowed, delay].some((n) => declaresName(t.node, n) || declaresName(t.classNode, n))) return null;
  return { tr, guard, throwStmt: guard.thenStatement, site, status: sl, allowed, delay, baseMs, timeoutMs, signal: sig.initializer };
}

const rethrowArgText = (a: string): string | null => (a.startsWith("param:") ? a.slice(6) : RETHROW_ARG_FORMS.find((f) => f.id === a)?.text ?? null);
const stringParamsOf = (t: Target): string[] => t.node.parameters.filter((p) => ts.isIdentifier(p.name) && p.type?.kind === ts.SyntaxKind.StringKeyword && !p.questionToken && !p.dotDotDotToken).map((p) => (p.name as ts.Identifier).text);

/** Build the G29 rethrow edit of a base whose target is the v2 retry template, or null. */
export function rethrowEdit(path: string, baseText: string, h: RethrowHoles): string | null {
  const sf = ts.createSourceFile(path, baseText, ts.ScriptTarget.Latest, true);
  if (diag(sf)) return null;
  const t = findTarget(sf, h.target);
  if (!t || t.kind !== "method") return null;
  const loop = retryLoopOf(sf, t);
  if (!loop) return null;
  if (!/^[A-Za-z_$][\w$]*$/.test(h.helper) || h.args.length < 1 || h.args.length > 4) return null;
  const sp = stringParamsOf(t);
  const texts = h.args.map((a) => (a.startsWith("param:") && !sp.includes(a.slice(6)) ? null : rethrowArgText(a)));
  if (texts.some((x) => x === null)) return null;
  // the global Error / String and the helper are what they look like: none is re-bound in the module, class or target
  if (declaresName(sf, "Error") || declaresName(sf, "String") || declaresName(t.node, h.helper) || declaresName(t.classNode, h.helper) || t.node.parameters.some((p) => declaresName(p, "error"))) return null;
  const local = topDeclares(sf, h.helper);
  if (local === (h.import !== null)) return null;
  if (local && !wireHelper(sf, h.helper)) return null;
  if (local && wireHelper(sf, h.helper)!.params.length !== h.args.length) return null;
  const splices: Splice[] = [];
  if (h.import) {
    if (h.import.name !== h.helper || !/^\.{1,2}\/[\w./-]+$/.test(h.import.from)) return null;
    const imps = sf.statements.filter((s): s is ts.ImportDeclaration => ts.isImportDeclaration(s));
    if (imps.some((s) => ts.isStringLiteral(s.moduleSpecifier) && s.moduleSpecifier.text === h.import!.from)) return null;
    const line = `import { ${h.helper} } from ${JSON.stringify(h.import.from)};`;
    const at = imps.length ? imps[imps.length - 1]!.getEnd() : 0;
    splices.push({ start: at, end: at, text: imps.length ? `\n${line}` : `${line}\n` });
  }
  const throwText = `throw new Error(${h.helper}(${texts.join(", ")}), { cause: error });`;
  const i3 = lineIndent(baseText, loop.guard.getStart(sf));
  const head = `if (!${loop.allowed}(attempt + 1))`;
  if (`${i3}${head} ${throwText}`.length <= 120) splices.push({ start: loop.throwStmt.getStart(sf), end: loop.throwStmt.getEnd(), text: throwText });
  else {
    // v1's multi-line rethrow layout, inside a block of the guard
    const step = i3.slice(lineIndent(baseText, loop.tr.getStart(sf)).length) || "  ";
    const i4 = i3 + step;
    const text = [`${head} {`, `${i4}throw new Error(`, `${i4}  ${h.helper}(`, ...texts.map((a, j) => `${i4}    ${a}${j < texts.length - 1 ? "," : ""}`), `${i4}  ),`, `${i4}  { cause: error }`, `${i4});`, `${i3}}`].join("\n");
    splices.push({ start: loop.guard.getStart(sf), end: loop.guard.getEnd(), text });
  }
  return applySplices(baseText, splices);
}

/**
 * Job A and Job B: is `realText` the G29 rethrow edit of `baseText`? The holes are read off the real tree (the one
 * class method whose body is the retry loop, its guard's `throw new Error(H(args), { cause: error })`), the edit is
 * rebuilt from the base with rethrowEdit and must match token for token; H must be a string-line helper (wireHelper)
 * of this module or of the relative module it is imported from (`read`). A rethrow that passes the cause's message is
 * refused by name ("wire_cause_message", Auditor #601), and so is one that passes the error's plain message
 * ("wire_message_unfiltered", Auditor #623: only the network filter `message.network` may read it). `stripped` / `baseStripped`: the real / base text with the
 * template's per-attempt `AbortSignal.timeout(N)` replaced by `undefined`, for the hermetic walks.
 */
export function rethrowEditShape(path: string, baseText: string, realText: string, read: Read): { target: string; stripped: string; baseStripped: string; holes: RethrowHoles } | string | null {
  const sf = ts.createSourceFile(path, realText, ts.ScriptTarget.Latest, true);
  const bsf = ts.createSourceFile(path, baseText, ts.ScriptTarget.Latest, true);
  if (diag(sf) || diag(bsf)) return null;
  const hits: string[] = [];
  for (const st of bsf.statements) {
    if (!ts.isClassDeclaration(st) || !st.name) continue;
    for (const m of st.members) if (ts.isMethodDeclaration(m) && ts.isIdentifier(m.name)) { const t = findTarget(bsf, `${st.name.text}.${m.name.text}`); if (t && retryLoopOf(bsf, t)) hits.push(`${st.name.text}.${m.name.text}`); }
  }
  if (hits.length !== 1) return null;
  const target = hits[0]!;
  const bt = findTarget(bsf, target)!, bl = retryLoopOf(bsf, bt)!;
  const rt = findTarget(sf, target);
  if (!rt?.node.body || rt.node.body.statements.length !== 1 || !ts.isForStatement(rt.node.body.statements[0]!)) return null;
  const rloop = rt.node.body.statements[0] as ts.ForStatement;
  if (!ts.isBlock(rloop.statement)) return null;
  const rls = rloop.statement.statements;
  const rtr = rls[rls.length - 3];
  if (!rtr || !ts.isTryStatement(rtr) || !rtr.catchClause) return null;
  const guard = rtr.catchClause.block.statements[0];
  if (!guard || !ts.isIfStatement(guard)) return null;
  const th = ts.isBlock(guard.thenStatement) && guard.thenStatement.statements.length === 1 ? guard.thenStatement.statements[0]! : guard.thenStatement;
  if (!ts.isThrowStatement(th) || !ts.isNewExpression(th.expression)) return null;
  const ne = th.expression;
  if (!ts.isIdentifier(ne.expression) || ne.expression.text !== "Error" || ne.typeArguments || ne.arguments?.length !== 2) return null;
  const msg = ne.arguments[0]!;
  if (!ts.isCallExpression(msg) || !ts.isIdentifier(msg.expression) || msg.typeArguments || msg.questionDotToken) return null;
  const helper = msg.expression.text;
  const sp = stringParamsOf(rt);
  const args: string[] = [];
  for (const a of msg.arguments) {
    if (sameCode(a.getText(sf), WIRE_ARG_FORMS.find((f) => f.id === "cause.message")!.text)) return "wire_cause_message";
    if (sameCode(a.getText(sf), WIRE_ARG_FORMS.find((f) => f.id === "message")!.text)) return "wire_message_unfiltered";
    const form = RETHROW_ARG_FORMS.find((f) => sameCode(a.getText(sf), f.text));
    if (form) { args.push(form.id); continue; }
    if (ts.isIdentifier(a) && sp.includes(a.text)) { args.push(`param:${a.text}`); continue; }
    return null;
  }
  let imp: RethrowHoles["import"] = null;
  if (topDeclares(bsf, helper)) { if (!wireHelper(bsf, helper)) return null; }
  else {
    const d = sf.statements.find((s): s is ts.ImportDeclaration => ts.isImportDeclaration(s) && !!s.importClause?.namedBindings && ts.isNamedImports(s.importClause.namedBindings) && s.importClause.namedBindings.elements.length === 1 && s.importClause.namedBindings.elements[0]!.name.text === helper && !s.importClause.namedBindings.elements[0]!.propertyName && !s.importClause.name && !s.importClause.isTypeOnly);
    if (!d || !ts.isStringLiteral(d.moduleSpecifier)) return null;
    const from = d.moduleSpecifier.text;
    const rel = normalizeRel(path.slice(0, path.lastIndexOf("/") + 1), from);
    const relTs = rel === null ? null : rel.endsWith(".ts") ? rel : `${rel}.ts`;
    const src = relTs === null ? null : read(relTs);
    const wh = src === null ? null : wireHelper(ts.createSourceFile(relTs!, src, ts.ScriptTarget.Latest, true), helper);
    if (!wh || wh.params.length !== args.length) return null;
    imp = { name: helper, from };
  }
  const holes: RethrowHoles = { target, helper, args, import: imp };
  const rebuilt = rethrowEdit(path, baseText, holes);
  if (rebuilt === null || !sameCode(rebuilt, realText)) return null;
  // the real file is the rebuilt template token for token, so its signal is where the template puts it
  const strip = (text: string, s: ts.SourceFile, sig: ts.CallExpression): string => text.slice(0, sig.getStart(s)) + "undefined" + text.slice(sig.getEnd());
  const rsig = ((rtr.tryBlock.statements[0] as ts.ExpressionStatement).expression as ts.BinaryExpression).right as ts.AwaitExpression;
  const rcall = rsig.expression as ts.CallExpression;
  const ropts = rcall.arguments[1] as ts.ObjectLiteralExpression;
  const rsigCall = (ropts.properties[ropts.properties.length - 1] as ts.PropertyAssignment).initializer as ts.CallExpression;
  return { target, stripped: strip(realText, sf, rsigCall), baseStripped: strip(baseText, bsf, bl.signal), holes };
}

// ---------------------------------------------------------------------------------------------------------------
// G19+ (public-derive-wire-sizes-v1, kind EXISTING_EDIT; peaceai/spec/derive-wire-v2.md, section G19+): the shared
// Job A / Job B pieces of TWO more derived edits, each one closed template whose holes the search in
// derive-wire-sizes.ts fills from the module and the examples:
//
//   "list the sizes too" (sizesListEdit) on a class method that pages a listing and collects keys with ONE
//       `L.push(...[...X.matchAll(/<T>([^<]+)<\/T>/gu)].map((match) => DEC(match[1] ?? "")).filter(Boolean))` and
//       returns `L.sort()` (pagingListOf): a sibling method N is added right after it, the SAME body with only the
//       collect step and the sort replaced, so it pages, signs, retries and fails exactly as the list does; each
//       element E of a page becomes `{ K: DEC(key), S: Number(size) }`, a missing or non-digit size fails the call
//       with the list's own error prefix (`P_SIZE_MISSING`, never a silent 0), and the result is sorted by key the
//       way the list is. The interface the class implements gets the OPTIONAL member, so other implementers and
//       fakes stay valid. E, the size tag and K / S are pinned by the examples (exactly one fit).
//   "use the list sizes" (sizesUseEdit) on a method that lists keys once and then reads every key whole only to
//       take its length (`const V = (await R.G(item))?.byteLength ?? 0;` in a for-of over the listed keys): when the
//       receiver has the optional sized listing N, the keys and sizes come from that one listing (no read per key);
//       without it the method is unchanged, read for read (both arms pinned by an example). No catch is added: a failing listing still fails the
//       call (G26; a measuring failure that should not fail a run is a separate, recorded decision).
//
// No error text is recorded or re-thrown by either template (the only new throw is a fixed code). Job B
// re-recognizes each edit by rebuilding it from the base token for token (sizesListEditShape / sizesUseEditShape).
// ---------------------------------------------------------------------------------------------------------------
export const WIRE_SIZES_VOCAB: Record<(typeof EXISTING_EDIT_PARAM_KEYS)[number], readonly string[]> = { ...WIRE2_VOCAB, match: ["derived-unique-list-site-v1"], statements: ["derived-list-sizes-v1"] };
export function isWireSizesParams(p: Record<string, unknown>): boolean {
  return Object.keys(p).sort().join(",") === [...EXISTING_EDIT_PARAM_KEYS].join(",") && EXISTING_EDIT_PARAM_KEYS.every((k) => typeof p[k] === "string" && WIRE_SIZES_VOCAB[k].length === 1 && WIRE_SIZES_VOCAB[k].includes(p[k] as string));
}
const SIZES_IDENT = /^[A-Za-z][A-Za-z0-9]{0,39}$/;
const SIZES_TAG = /^[A-Za-z][A-Za-z0-9]{0,31}$/;
/** The holes of a "list the sizes too" edit. */
export interface SizesListHoles { target: string; method: string; container: string; size: string; keyField: string; sizeField: string }
/** A paging key listing as it stands (see the block comment), read structurally; null when it is not one. */
export interface PagingList { decl: ts.VariableStatement; list: string; push: ts.ExpressionStatement; xml: string; keyTag: string; decode: string; ret: ts.ReturnStatement; prefix: string; iface: ts.InterfaceDeclaration; member: ts.MethodSignature }
export function pagingListOf(sf: ts.SourceFile, t: Target): PagingList | null {
  if (t.kind !== "method" || !t.node.body || !t.node.modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword) || t.node.asteriskToken || t.node.typeParameters) return null;
  if (!t.node.type || !sameCode(t.node.type.getText(sf), "Promise<string[]>")) return null;
  const stmts = t.node.body.statements;
  const decls = stmts.filter((s): s is ts.VariableStatement => ts.isVariableStatement(s) && !!(s.declarationList.flags & ts.NodeFlags.Const) && s.declarationList.declarations.length === 1 && ts.isIdentifier(s.declarationList.declarations[0]!.name) && !!s.declarationList.declarations[0]!.type && sameCode(s.declarationList.declarations[0]!.type!.getText(sf), "string[]") && !!s.declarationList.declarations[0]!.initializer && sameCode(s.declarationList.declarations[0]!.initializer!.getText(sf), "[]"));
  if (decls.length !== 1) return null;
  const decl = decls[0]!;
  const list = (decl.declarationList.declarations[0]!.name as ts.Identifier).text;
  const pushes: ts.ExpressionStatement[] = [], rets: ts.ReturnStatement[] = [], prefixes: string[] = [];
  let other = false;
  const v = (n: ts.Node): void => {
    if (ts.isFunctionLike(n) && n !== t.node && !ts.isArrowFunction(n)) { other = true; return; }
    if (ts.isExpressionStatement(n) && ts.isCallExpression(n.expression) && ts.isPropertyAccessExpression(n.expression.expression) && ts.isIdentifier(n.expression.expression.expression) && n.expression.expression.expression.text === list) {
      if (n.expression.expression.name.text === "push") { pushes.push(n); return; }
    }
    if (ts.isReturnStatement(n)) { rets.push(n); }
    if (ts.isNewExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === "Error" && n.arguments?.length === 1 && ts.isTemplateExpression(n.arguments[0]!)) {
      const te = n.arguments[0] as ts.TemplateExpression;
      const m = /^([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*)_$/.exec(te.head.text);
      if (m && te.templateSpans.length === 1 && te.templateSpans[0]!.literal.text === "" && ts.isPropertyAccessExpression(te.templateSpans[0]!.expression) && te.templateSpans[0]!.expression.name.text === "status") prefixes.push(m[1]!);
    }
    ts.forEachChild(n, v);
  };
  v(t.node.body);
  if (other || pushes.length !== 1 || rets.length !== 1 || prefixes.length !== 1) return null;
  const push = pushes[0]!, ret = rets[0]!;
  if (!ret.expression || !sameCode(ret.expression.getText(sf), `${list}.sort()`)) return null;
  // the collect step: L.push(...[...X.matchAll(/<T>([^<]+)<\/T>/gu)].map((match) => DEC(match[1] ?? "")).filter(Boolean))
  const pc = push.expression as ts.CallExpression;
  if (pc.arguments.length !== 1 || !ts.isSpreadElement(pc.arguments[0]!)) return null;
  const f = (pc.arguments[0] as ts.SpreadElement).expression;
  if (!ts.isCallExpression(f) || !ts.isPropertyAccessExpression(f.expression) || f.expression.name.text !== "filter" || f.arguments.length !== 1 || f.arguments[0]!.getText(sf) !== "Boolean") return null;
  const mp = f.expression.expression;
  if (!ts.isCallExpression(mp) || !ts.isPropertyAccessExpression(mp.expression) || mp.expression.name.text !== "map" || mp.arguments.length !== 1) return null;
  const arr = mp.expression.expression;
  if (!ts.isArrayLiteralExpression(arr) || arr.elements.length !== 1 || !ts.isSpreadElement(arr.elements[0]!)) return null;
  const ma = (arr.elements[0] as ts.SpreadElement).expression;
  if (!ts.isCallExpression(ma) || !ts.isPropertyAccessExpression(ma.expression) || ma.expression.name.text !== "matchAll" || !ts.isIdentifier(ma.expression.expression) || ma.arguments.length !== 1 || !ts.isRegularExpressionLiteral(ma.arguments[0]!)) return null;
  const xml = ma.expression.expression.text;
  const re = /^\/<([A-Za-z][A-Za-z0-9]{0,31})>\(\[\^<\]\+\)<\\\/\1>\/gu$/.exec(ma.arguments[0]!.getText(sf));
  if (!re) return null;
  const keyTag = re[1]!;
  const fn = mp.arguments[0]!;
  if (!ts.isArrowFunction(fn) || fn.parameters.length !== 1 || !ts.isCallExpression(fn.body) || !ts.isIdentifier(fn.body.expression)) return null;
  const decode = fn.body.expression.text;
  if (!sameCode(fn.getText(sf), `(match) => ${decode}(match[1] ?? "")`)) return null;
  // DEC: a module function of this file (not a parameter / local / import), so the sized listing decodes keys alike
  if (!sf.statements.some((s) => ts.isFunctionDeclaration(s) && s.name?.text === decode && !!s.body) || declaresName(t.node, decode) || declaresName(t.classNode, decode)) return null;
  // the interface the class implements, in this file, with the listing's own member
  const impl = t.classNode.heritageClauses?.find((h) => h.token === ts.SyntaxKind.ImplementsKeyword);
  if (!impl || impl.types.length !== 1 || !ts.isIdentifier(impl.types[0]!.expression) || impl.types[0]!.typeArguments) return null;
  const iname = impl.types[0]!.expression.text;
  const ifs = sf.statements.filter((s): s is ts.InterfaceDeclaration => ts.isInterfaceDeclaration(s) && s.name.text === iname);
  if (ifs.length !== 1 || ifs[0]!.typeParameters || ifs[0]!.heritageClauses) return null;
  const members = ifs[0]!.members.filter((m): m is ts.MethodSignature => ts.isMethodSignature(m) && ts.isIdentifier(m.name) && m.name.text === t.name);
  if (members.length !== 1 || members[0]!.questionToken) return null;
  return { decl, list, push, xml, keyTag, decode, ret, prefix: prefixes[0]!, iface: ifs[0]!, member: members[0]! };
}
const memberNamed = (cls: ts.ClassDeclaration | ts.InterfaceDeclaration, name: string): boolean => (cls.members as ts.NodeArray<ts.ClassElement | ts.TypeElement>).some((m) => !!m.name && (ts.isIdentifier(m.name) || ts.isStringLiteral(m.name) || ts.isPrivateIdentifier(m.name)) && m.name.text === name);

/** Build the "list the sizes too" edit of a base whose target is a paging key listing, or null. */
export function sizesListEdit(path: string, baseText: string, h: SizesListHoles): string | null {
  const sf = ts.createSourceFile(path, baseText, ts.ScriptTarget.Latest, true);
  if (diag(sf)) return null;
  const t = findTarget(sf, h.target);
  if (!t || t.kind !== "method") return null;
  const p = pagingListOf(sf, t);
  if (!p) return null;
  if (![h.method, h.keyField, h.sizeField].every((x) => SIZES_IDENT.test(x)) || ![h.container, h.size].every((x) => SIZES_TAG.test(x)) || h.keyField === h.sizeField) return null;
  if (h.container === p.keyTag || h.size === p.keyTag || h.container === h.size) return null;
  if (memberNamed(t.classNode, h.method) || memberNamed(p.iface, h.method)) return null;
  // the template's own names are what they look like: not re-bound in the method or the module
  if (["entries", "entry", "a", "b"].some((n) => declaresName(t.node, n)) || ["Number", "Boolean", "Error"].some((n) => declaresName(sf, n))) return null;
  const type = `{ ${h.keyField}: string; ${h.sizeField}: number }[]`;
  const ind = lineIndent(baseText, p.push.getStart(sf));
  const step = "  ";
  const m0 = t.node.getStart(sf), m1 = t.node.getEnd();
  const rel = (n: ts.Node): { start: number; end: number } => ({ start: n.getStart(sf) - m0, end: n.getEnd() - m0 });
  const declType = p.decl.declarationList.declarations[0]!.type!;
  const collect = [
    `const entries = [...${p.xml}.matchAll(/<${h.container}>([\\s\\S]*?)<\\/${h.container}>/gu)].map((match) => ({`,
    `${ind}${step}${h.keyField}: ${p.decode}(/<${p.keyTag}>([^<]+)<\\/${p.keyTag}>/u.exec(match[1] ?? "")?.[1] ?? ""),`,
    `${ind}${step}${h.sizeField}: Number(/<${h.size}>(\\d{1,15})<\\/${h.size}>/u.exec(match[1] ?? "")?.[1] ?? "NaN"),`,
    `${ind}}));`,
    `${ind}if (entries.some((entry) => !Number.isSafeInteger(entry.${h.sizeField}))) throw new Error(${JSON.stringify(`${p.prefix}_SIZE_MISSING`)});`,
    `${ind}${p.list}.push(...entries.filter((entry) => Boolean(entry.${h.keyField})));`,
  ].join("\n");
  const method = t.node.getText(sf);
  const inner: Splice[] = [
    { ...rel(t.node.name), text: h.method },
    { ...rel(t.node.type!), text: `Promise<${type}>` },
    { ...rel(declType), text: type },
    { ...rel(p.push), text: collect },
    { ...rel(p.ret.expression!), text: `${p.list}.sort((a, b) => (a.${h.keyField} < b.${h.keyField} ? -1 : a.${h.keyField} > b.${h.keyField} ? 1 : 0))` },
  ];
  const sibling = applySplices(method, inner);
  const mind = lineIndent(baseText, t.node.getStart(sf));
  const iind = lineIndent(baseText, p.member.getStart(sf));
  const params = p.member.parameters.map((x) => x.getText(sf)).join(", ");
  const doc = `/** Every key under the prefix (all pages) with its size in bytes, from the listing alone, sorted by key. */`;
  return applySplices(baseText, [
    { start: m1, end: m1, text: `\n\n${mind}${sibling}` },
    { start: p.member.getEnd(), end: p.member.getEnd(), text: `\n${iind}${doc}\n${iind}${h.method}?(${params}): Promise<${type}>;` },
  ]);
}

/**
 * G19+: where the per-attempt `AbortSignal.timeout(N)` of a v2 retry template sits, for the hermetic walk only: the
 * template as v2 writes it, or the same template after public-derive-wire-rethrow-v1 replaced its final `throw error;`
 * with ONE `throw new Error(H(..), { cause: error });` (PeaceSTOCKS c617e63). The rethrow is put back to `throw error;`
 * and the result must be the v2 template (retryLoopOf); the catch comes after the try, so the signal's offsets are the
 * same in both texts. Nothing of the rethrow (its helper or its arguments) is read; null when it is neither.
 */
export function sizesRetrySignalOf(path: string, sf: ts.SourceFile, t: Target): { start: number; end: number } | null {
  const l = retryLoopOf(sf, t);
  if (l) return { start: l.signal.getStart(sf), end: l.signal.getEnd() };
  if (t.kind !== "method" || !t.node.body || t.node.body.statements.length !== 1) return null;
  const loop = t.node.body.statements[0]!;
  if (!ts.isForStatement(loop) || !ts.isBlock(loop.statement) || loop.statement.statements.length < 4) return null;
  const tr = loop.statement.statements[loop.statement.statements.length - 3]!;
  if (!ts.isTryStatement(tr) || !tr.catchClause || tr.catchClause.block.statements.length !== 3) return null;
  const guard = tr.catchClause.block.statements[0]!;
  if (!ts.isIfStatement(guard) || guard.elseStatement || !ts.isBlock(guard.thenStatement) || guard.thenStatement.statements.length !== 1) return null;
  const th = guard.thenStatement.statements[0]!;
  if (!ts.isThrowStatement(th) || !th.expression || !ts.isNewExpression(th.expression) || !ts.isIdentifier(th.expression.expression) || th.expression.expression.text !== "Error") return null;
  const args = th.expression.arguments ?? [];
  if (args.length !== 2 || !ts.isCallExpression(args[0]!) || !ts.isIdentifier(args[0]!.expression) || !sameCode(args[1]!.getText(sf), "{ cause: error }")) return null;
  const back = applySplices(sf.text, [{ start: guard.thenStatement.getStart(sf), end: guard.thenStatement.getEnd(), text: "throw error;" }]);
  const bsf = ts.createSourceFile(path, back, ts.ScriptTarget.Latest, true);
  const bt = findTarget(bsf, `${t.cls}.${t.name}`);
  const bl = bt ? retryLoopOf(bsf, bt) : null;
  if (!bl || bl.signal.getEnd() > guard.thenStatement.getStart(sf)) return null;
  return { start: bl.signal.getStart(bsf), end: bl.signal.getEnd() };
}

/**
 * Job A and Job B: is `realText` the "list the sizes too" edit of `baseText`? The holes are read off the real tree
 * (the one class method of the base that is a paging key listing, the new sibling's name, tags and fields), the edit is
 * rebuilt with sizesListEdit and must match token for token. `stripped`: the real text with every v2 retry template's
 * per-attempt `AbortSignal.timeout(N)` in the class replaced by `undefined`, for the hermetic walk.
 */
export function sizesListEditShape(path: string, baseText: string, realText: string): { target: string; method: string; stripped: string; holes: SizesListHoles } | null {
  const sf = ts.createSourceFile(path, realText, ts.ScriptTarget.Latest, true);
  const bsf = ts.createSourceFile(path, baseText, ts.ScriptTarget.Latest, true);
  if (diag(sf) || diag(bsf)) return null;
  const hits: Target[] = [];
  for (const st of bsf.statements) {
    if (!ts.isClassDeclaration(st) || !st.name) continue;
    for (const m of st.members) if (ts.isMethodDeclaration(m) && ts.isIdentifier(m.name)) { const t = findTarget(bsf, `${st.name.text}.${m.name.text}`); if (t && pagingListOf(bsf, t)) hits.push(t); }
  }
  if (hits.length !== 1 || hits[0]!.kind !== "method") return null;
  const bt = hits[0]! as Extract<Target, { kind: "method" }>;
  const target = `${bt.cls}.${bt.name}`;
  const rcls = sf.statements.find((s): s is ts.ClassDeclaration => ts.isClassDeclaration(s) && s.name?.text === bt.cls);
  if (!rcls) return null;
  const at = rcls.members.findIndex((m) => ts.isMethodDeclaration(m) && ts.isIdentifier(m.name) && m.name.text === bt.name);
  const sib = rcls.members[at + 1];
  if (at < 0 || !sib || !ts.isMethodDeclaration(sib) || !ts.isIdentifier(sib.name) || !sib.body) return null;
  const method = sib.name.text;
  // the fields and tags as the sibling writes them
  const text = sib.getText(sf);
  const ty = /^async [A-Za-z][A-Za-z0-9]*\([^)]*\): Promise<\{ ([A-Za-z][A-Za-z0-9]*): string; ([A-Za-z][A-Za-z0-9]*): number \}\[\]>/.exec(text.replace(/\s+/g, " "));
  const ct = /\.matchAll\(\/<([A-Za-z][A-Za-z0-9]*)>\(\[\\s\\S\]\*\?\)<\\\/\1>\/gu\)/.exec(text);
  const sz = /Number\(\/<([A-Za-z][A-Za-z0-9]*)>\(\\d\{1,15\}\)<\\\/\1>\/u\.exec/.exec(text);
  if (!ty || !ct || !sz) return null;
  const holes: SizesListHoles = { target, method, container: ct[1]!, size: sz[1]!, keyField: ty[1]!, sizeField: ty[2]! };
  const rebuilt = sizesListEdit(path, baseText, holes);
  if (rebuilt === null || !sameCode(rebuilt, realText)) return null;
  // every v2 retry template of the class (the listing's request) with its per-attempt timeout signal taken out
  const sigs: { start: number; end: number }[] = [];
  for (const m of rcls.members) if (ts.isMethodDeclaration(m) && ts.isIdentifier(m.name)) { const t = findTarget(sf, `${bt.cls}.${m.name.text}`); const l = t ? sizesRetrySignalOf(path, sf, t) : null; if (l) sigs.push(l); }
  const stripped = applySplices(realText, sigs.map((s) => ({ ...s, text: "undefined" })));
  return { target, method, stripped, holes };
}

/** The holes of a "use the list sizes" edit. */
export interface SizesUseHoles { target: string; sized: string; keyField: string; sizeField: string }
/** The site of a "use the list sizes" edit as it stands in the base, read structurally; null when it is not one. */
export interface SizesUseSite { keysDecl: ts.VariableStatement; keys: string; recv: string; list: string; args: string; argv: string[]; loop: ts.ForOfStatement; item: string; read: ts.VariableStatement; size: string; get: string; prop: string }
export function sizesUseSiteOf(sf: ts.SourceFile, t: Target): SizesUseSite | null {
  if (!t.node.body || !t.node.modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword) || t.node.asteriskToken) return null;
  const stmts = t.node.body.statements;
  const sites: SizesUseSite[] = [];
  for (const [i, s] of stmts.entries()) {
    // const KEYS = await R.L(ARGS);   R: `this.F` or a parameter
    if (!ts.isVariableStatement(s) || !(s.declarationList.flags & ts.NodeFlags.Const) || s.declarationList.declarations.length !== 1) continue;
    const d = s.declarationList.declarations[0]!;
    if (!ts.isIdentifier(d.name) || d.type || !d.initializer || !ts.isAwaitExpression(d.initializer) || !ts.isCallExpression(d.initializer.expression)) continue;
    const c = d.initializer.expression;
    if (!ts.isPropertyAccessExpression(c.expression) || c.questionDotToken || c.typeArguments || !c.arguments.every((a) => ts.isStringLiteral(a))) continue;
    const r = c.expression.expression;
    const recvOk = (ts.isPropertyAccessExpression(r) && r.expression.kind === ts.SyntaxKind.ThisKeyword && ts.isIdentifier(r.name)) || (ts.isIdentifier(r) && t.node.parameters.some((p) => ts.isIdentifier(p.name) && p.name.text === r.text));
    if (!recvOk) continue;
    const keys = d.name.text, recv = r.getText(sf), list = c.expression.name.text, args = c.arguments.map((a) => a.getText(sf)).join(", ");
    // a later top-level for-of over KEYS whose body reads every key whole only for its length, once
    for (const l of stmts.slice(i + 1)) {
      if (!ts.isForOfStatement(l) || l.awaitModifier || !ts.isIdentifier(l.expression) || l.expression.text !== keys || !ts.isVariableDeclarationList(l.initializer) || !(l.initializer.flags & ts.NodeFlags.Const) || l.initializer.declarations.length !== 1 || !ts.isIdentifier(l.initializer.declarations[0]!.name) || !ts.isBlock(l.statement)) continue;
      const item = (l.initializer.declarations[0]!.name as ts.Identifier).text;
      for (const b of l.statement.statements) {
        if (!ts.isVariableStatement(b) || b.declarationList.declarations.length !== 1) continue;
        const bd = b.declarationList.declarations[0]!;
        if (!ts.isIdentifier(bd.name) || bd.type || !bd.initializer) continue;
        const m = /^\(await (.+)\.([A-Za-z_$][\w$]*)\(([A-Za-z_$][\w$]*)\)\)\?\.(byteLength|length) \?\? 0$/.exec(bd.initializer.getText(sf).replace(/\s+/g, " "));
        if (!m || m[1] !== recv || m[3] !== item || m[2] === list) continue;
        if (!sameCode(bd.initializer.getText(sf), `(await ${recv}.${m[2]}(${item}))?.${m[4]} ?? 0`)) continue;
        sites.push({ keysDecl: s, keys, recv, list, args, argv: c.arguments.map((a) => (a as ts.StringLiteral).text), loop: l, item, read: b, size: bd.name.text, get: m[2]!, prop: m[4]! });
      }
    }
  }
  return sites.length === 1 ? sites[0]! : null;
}

/** Build the "use the list sizes" edit, or null. */
export function sizesUseEdit(path: string, baseText: string, h: SizesUseHoles): string | null {
  const sf = ts.createSourceFile(path, baseText, ts.ScriptTarget.Latest, true);
  if (diag(sf)) return null;
  const t = findTarget(sf, h.target);
  if (!t) return null;
  const s = sizesUseSiteOf(sf, t);
  if (!s) return null;
  if (![h.sized, h.keyField, h.sizeField].every((x) => SIZES_IDENT.test(x)) || h.keyField === h.sizeField || h.sized === s.list || h.sized === s.get) return null;
  if (["sized", "sizeOf", "entry"].some((n) => declaresName(t.node, n)) || ["Map", "Number"].some((n) => declaresName(sf, n))) return null;
  // the sized listing is not already used by the method
  if (new RegExp(`\\.${h.sized}\\b`).test(t.node.getText(sf))) return null;
  const ind = lineIndent(baseText, s.keysDecl.getStart(sf));
  const head = [
    `const sized = ${s.recv}.${h.sized} ? await ${s.recv}.${h.sized}(${s.args}) : undefined;`,
    `${ind}const ${s.keys} = sized ? sized.map((entry) => entry.${h.keyField}) : await ${s.recv}.${s.list}(${s.args});`,
    `${ind}const sizeOf = new Map<string, number>(sized?.map((entry) => [entry.${h.keyField}, entry.${h.sizeField}]));`,
  ].join("\n");
  const kw = s.read.declarationList.flags & ts.NodeFlags.Const ? "const" : "let";
  const rind = lineIndent(baseText, s.read.getStart(sf));
  // the keys ARE the sized listing's keys, so every key has its size: read with Number(..), no fallback branch that no
  // example could reach (Auditor #629: no clause unpinned; a key without a size can only be NaN, never a silent 0)
  const one = `${kw} ${s.size} = sized ? Number(sizeOf.get(${s.item})) : ((await ${s.recv}.${s.get}(${s.item}))?.${s.prop} ?? 0);`;
  const read = `${rind}${one}`.length <= 120 ? one : [`${kw} ${s.size} = sized`, `${rind}  ? Number(sizeOf.get(${s.item}))`, `${rind}  : ((await ${s.recv}.${s.get}(${s.item}))?.${s.prop} ?? 0);`].join("\n");
  return applySplices(baseText, [
    { start: s.keysDecl.getStart(sf), end: s.keysDecl.getEnd(), text: head },
    { start: s.read.getStart(sf), end: s.read.getEnd(), text: read },
  ]);
}

/** Job A and Job B: is `realText` the "use the list sizes" edit of `baseText`? Holes read off the real tree, rebuilt with sizesUseEdit, token for token. */
export function sizesUseEditShape(path: string, baseText: string, realText: string): { target: string; holes: SizesUseHoles } | null {
  const sf = ts.createSourceFile(path, realText, ts.ScriptTarget.Latest, true);
  const bsf = ts.createSourceFile(path, baseText, ts.ScriptTarget.Latest, true);
  if (diag(sf) || diag(bsf)) return null;
  const hits: string[] = [];
  for (const st of bsf.statements) {
    if (ts.isFunctionDeclaration(st) && st.name) { const t = findTarget(bsf, st.name.text); if (t && sizesUseSiteOf(bsf, t)) hits.push(st.name.text); }
    if (!ts.isClassDeclaration(st) || !st.name) continue;
    for (const m of st.members) if (ts.isMethodDeclaration(m) && ts.isIdentifier(m.name)) { const t = findTarget(bsf, `${st.name.text}.${m.name.text}`); if (t && sizesUseSiteOf(bsf, t)) hits.push(`${st.name.text}.${m.name.text}`); }
  }
  for (const target of hits) {
    const rt = findTarget(sf, target);
    const first = rt?.node.body?.statements.find((x) => ts.isVariableStatement(x) && /^const sized = /.test(x.getText(sf)));
    if (!rt || !first) continue;
    const m = /^const sized = .+\.([A-Za-z][A-Za-z0-9]*) \? await /.exec(first.getText(sf).replace(/\s+/g, " "));
    const all = rt.node.body!.getText(sf).replace(/\s+/g, " ");
    const f = /sized\?\.map\(\(entry\) => \[entry\.([A-Za-z][A-Za-z0-9]*), entry\.([A-Za-z][A-Za-z0-9]*)\]\)/.exec(all);
    if (!m || !f) continue;
    const holes: SizesUseHoles = { target, sized: m[1]!, keyField: f[1]!, sizeField: f[2]! };
    const rebuilt = sizesUseEdit(path, baseText, holes);
    if (rebuilt !== null && sameCode(rebuilt, realText)) return { target, holes };
  }
  return null;
}

/** Job B for the two G19+ edits (null: not a G19+ edit, checked as before; else a refusal code or "ok"). */
export function gradeSizesProblem(modPath: string, baseText: string, realText: string, testPath: string, testContent: string, read: Read): string | null {
  const ls = sizesListEditShape(modPath, baseText, realText);
  if (ls) {
    const calls = gradedTestCalls(testPath, testContent, modPath, true, true);
    if (!calls) return "edit_test_shape";
    // every graded call is the NEW sibling (the base has no such method, so there is no walk before; the sibling is
    // the base listing's own body rebuilt token for token with the closed collect step, and it is walked after)
    if (!calls.every((c) => c.entry.kind === "new" && c.entry.method === ls.method)) return "sizes_test_entry";
    const a = hermeticProblem(modPath, read, calls, `${ls.target.split(".")[0]}.${ls.method}`, { path: modPath, content: ls.stripped });
    if (typeof a === "string") return a;
    return a.targetReached ? "ok" : "edit_test_unreached";
  }
  const us = sizesUseEditShape(modPath, baseText, realText);
  if (us) {
    const calls = gradedTestCalls(testPath, testContent, modPath, true, true);
    if (!calls) return "edit_test_shape";
    const a = hermeticProblem(modPath, read, calls, us.target, { path: modPath, content: realText });
    if (typeof a === "string") return a;
    const b = hermeticProblem(modPath, read, calls, us.target, { path: modPath, content: baseText });
    if (typeof b === "string") return b;
    return a.targetReached && b.targetReached ? "ok" : "edit_test_unreached";
  }
  return null;
}
