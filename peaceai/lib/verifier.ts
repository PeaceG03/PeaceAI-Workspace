// VERIFIER-V1 (M202, batch 38): experimental out-of-process verification. Spec: peaceai/spec/verifier-v1.md.
// NOT the default. Three uids (M204, batch 40): the candidate process (stage-2 cand uid) only answers calls over one
// pipe; the runner (this process, the box uid) relays its raw stdout; the verdict is decided by verifier-judge.cjs
// running as a THIRD uid (PEACEAI_VERIFIER_UID) and written to a directory only that uid owns. No process that
// decides the verdict imports candidate code. Case extraction from a team test file is fail-closed (M204).
// M205 (batch 41): extractor admits describe/suite nesting (names concatenated), const-of-JSON-literal bindings
// (resolved by value; shadowing/reassignment refused), test.each/it.each with a literal table, and unused imports
// of other modules (only used relative target modules matter). Still static extraction only; never evaluates tests.
// Status: EXPERIMENTAL, opt-in via VERDICT_MODE "oop-v1". EDIT_SCOPE_POLICY and the in-process default are unchanged.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, mkdtempSync, readFileSync, rmSync, chmodSync, existsSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { STAGE2_CAND_ENV, stage2CandUid, type CandUid } from "./selfpropose.ts";

export const VERIFIER_VERSION = "verifier-v1" as const;
/** Opt-in loop / CLI verdict mode. Default remains in-process (the detected runner). */
export const VERDICT_MODES = ["inproc", "oop-v1"] as const;
export type VerdictMode = (typeof VERDICT_MODES)[number];
export const DEFAULT_VERDICT_MODE: VerdictMode = "inproc";

export const VERIFIER_REFUSALS = [
  "OOP_CAND_REQUIRED",
  "OOP_CAND_BAD",
  "OOP_MODULE",
  "OOP_CASES_EMPTY",
  "OOP_CASES_NONLITERAL",
  "OOP_PROTOCOL",
  "OOP_OVERSIZE",
  "OOP_DEPTH",
  "OOP_TIMEOUT",
  "OOP_STDOUT_NOISE",
  "OOP_SPAWN",
  "OOP_LOAD",
  // M204 (batch 40)
  "OOP_CASES_UNSUPPORTED_ASSERT",
  "OOP_CASES_UNSUPPORTED_TEST",
  "OOP_CASES_NO_ASSERT",
  "OOP_VERIFIER_REQUIRED",
  "OOP_VERIFIER_BAD",
  "OOP_VERIFIER_NOT_SEPARATE",
  "OOP_JUDGE",
] as const;
export type VerifierRefusal = (typeof VERIFIER_REFUSALS)[number];

/** M204: `cmp` "is" = Object.is on a primitive (toBe / strictEqual); absent or "deep" = deep equality on exact JSON
 *  (toEqual / toStrictEqual / deepStrictEqual); `negate` = not.toBe / notStrictEqual (primitive); `any` = returns
 *  without throwing (doesNotThrow / not.toThrow). Errors: `isa` builtin class, `name`, `message` (exact string or
 *  {re, flags}), `includes` (toThrow("text")). Every ok:true form needs a synchronous return; every ok:false form a
 *  synchronous throw from the call itself. */
export type CaseExpect =
  | { readonly ok: true; readonly value?: unknown; readonly cmp?: "is" | "deep"; readonly negate?: true; readonly any?: true }
  | { readonly ok: false; readonly error?: { readonly isa?: string; readonly name?: string; readonly message?: string | { readonly re: string; readonly flags: string }; readonly includes?: string } };

export interface DataCase {
  readonly id: string;
  readonly fn: string;
  readonly args: readonly unknown[];
  readonly expect: CaseExpect;
  /** M204: "module" when the test called `ns.fn(...)` on a namespace import (the receiver); else none. */
  readonly recv?: "module";
}

export interface CaseFile {
  readonly version: typeof VERIFIER_VERSION;
  readonly module: string; // repo-relative path of the candidate module
  readonly cases: readonly DataCase[];
}

/** M203 (repair-retry-v1 evidence): what a failing case returned, as the candidate serialized it (a JSON value or an
 *  error name only). Evidence for proposing the next edit, never for a verdict: the verdict is `pass` alone. */
export type CaseGot = { readonly ok: true; readonly value: unknown } | { readonly ok: false; readonly name: string };
export type CaseResult =
  | { readonly id: string; readonly pass: true }
  | { readonly id: string; readonly pass: false; readonly reason: string; readonly got?: CaseGot };

export interface VerifyOk {
  readonly code: "OOP_OK";
  readonly pass: number;
  readonly fail: number;
  readonly results: readonly CaseResult[];
  readonly leftovers: number;
}
export interface VerifyRefuse {
  readonly code: VerifierRefusal;
  readonly detail?: string;
  readonly pass?: number;
  readonly fail?: number;
  readonly results?: readonly CaseResult[];
  readonly leftovers?: number;
}
export type VerifyResult = VerifyOk | VerifyRefuse;

export interface VerifyOptions {
  /** Absolute path of the checkout (or fixture) that holds the candidate module. */
  readonly root: string;
  /** Repo-relative module path (or absolute under root). */
  readonly module: string;
  readonly cases: readonly DataCase[];
  /** Environment that names PEACEAI_STAGE2_CAND and PEACEAI_VERIFIER_UID. */
  readonly env?: Record<string, string | undefined>;
  /** Per-call deadline (ms). Default 5_000. */
  readonly callMs?: number;
  /** Whole-session deadline (ms). Default 60_000. */
  readonly sessionMs?: number;
  /** Max bytes of one response line. Default 65_536. */
  readonly maxLineBytes?: number;
  /** Max JSON depth of a response. Default 32. */
  readonly maxDepth?: number;
}

// ---- primordials (captured at load; the verifier never trusts candidate-reachable state for equality)
const P = {
  is: Object.is,
  isArray: Array.isArray,
  keys: Object.keys,
  freeze: Object.freeze,
  stringify: JSON.stringify,
  parse: JSON.parse,
  isInteger: Number.isInteger,
  isFinite: Number.isFinite,
  floor: Math.floor,
} as const;

export const MAX_CASES = 200;
export const DEFAULT_CALL_MS = 5_000;
export const DEFAULT_SESSION_MS = 60_000;
export const JUDGE_MS = 30_000;

const HARNESS_PATH = fileURLToPath(new URL("./verifier-harness.cjs", import.meta.url));
const JUDGE_PATH = fileURLToPath(new URL("./verifier-judge.cjs", import.meta.url));
const SPEC_PATH = fileURLToPath(new URL("../spec/verifier-v1.md", import.meta.url));

// ---- parse / compare: ONE implementation, in the judge (which the third uid runs). Re-exported for tests / callers.
type Parsed =
  | { ok: true; id: number; resultOk: true; value: unknown; exact?: boolean; sync?: boolean }
  | { ok: true; id: number; resultOk: false; where?: string; error: { name: string; message: string; obj?: boolean; nameStr?: boolean; msgStr?: boolean; trunc?: boolean; isa?: string[] } }
  | { ok: false; code: VerifierRefusal; detail?: string };
const J = createRequire(import.meta.url)(JUDGE_PATH) as {
  valuesEqual(a: unknown, b: unknown, depth?: number): boolean;
  parseResponse(line: string, maxBytes?: number, maxDepth?: number): Parsed;
  expectHolds(got: Parsed, exp: CaseExpect): boolean;
  judge(req: { cases: readonly DataCase[]; runs: readonly RawRun[]; maxBytes: number; maxDepth: number }): VerifyResult;
  MAX_LINE_BYTES: number;
  MAX_DEPTH: number;
};
export const MAX_LINE_BYTES: number = J.MAX_LINE_BYTES;
export const MAX_DEPTH: number = J.MAX_DEPTH;
/** Deep equality using the judge's own primordials (not candidate-reachable Object.is / matchers). */
export const valuesEqual: (a: unknown, b: unknown, depth?: number) => boolean = J.valuesEqual;
/** Parse one protocol response line. Fail-closed on any deviation. */
export const parseResponse: (line: string, maxBytes?: number, maxDepth?: number) => Parsed = J.parseResponse;
export const expectHolds: (got: Parsed, exp: CaseExpect) => boolean = J.expectHolds;
/** What the runner relays to the judge for one case: the candidate process's raw outcome. */
export interface RawRun { readonly status: number | null; readonly stdout: string; readonly timeout?: true; readonly session?: true }
/** In-process judge (tests only; verify() always runs it as the verifier uid). */
export const judgeRuns = J.judge;

/** Select a verdict mode: exact names only; anything else is null (refused). undefined -> default. */
export function selectVerdictMode(flag: string | undefined): VerdictMode | null {
  if (flag === undefined) return DEFAULT_VERDICT_MODE; // m202-guard:default-inproc
  if ((VERDICT_MODES as readonly string[]).includes(flag)) return flag as VerdictMode;
  return null;
}

// ---- case source: JSON file, or fail-closed extraction from a test file (M204, batch 40)

const LIT_MAX = 200;

/** M204: the extractor's matcher table. Each admitted matcher maps to a judge check that reproduces its semantics on
 *  the harness's report exactly (spec verifier-v1.md). Anything else is a refusal, never a silent skip. */
export const ASSERT_STRICT_SOURCES = ["node:assert/strict", "assert/strict"] as const;
export const ASSERT_LEGACY_SOURCES = ["node:assert", "assert"] as const;
export const EXPECT_SOURCES = ["vitest", "@jest/globals", "expect"] as const;
export const TEST_SOURCES = ["node:test", "vitest", "@jest/globals", "mocha"] as const;
export const BUILTIN_ERRORS = ["Error", "TypeError", "RangeError", "SyntaxError", "ReferenceError", "EvalError", "URIError"] as const;
const TEST_FNS = new Set(["test", "it"]);
const SUITE_FNS = new Set(["describe", "suite"]);
const HOOK_FNS = new Set(["before", "after", "beforeEach", "afterEach", "beforeAll", "afterAll", "setup", "teardown", "suiteSetup", "suiteTeardown"]);

export interface ExtractStats {
  /** test / it blocks found */
  readonly tests: number;
  /** assertion-like calls anywhere in the file (expect / assert chains, named assert functions) */
  readonly assertionsSeen: number;
  /** of those, extracted as data-only cases (0 when the file is refused: nothing is partially extracted) */
  readonly extracted: number;
  /** of those, ones an admitted matcher covers (what extraction would have produced, refused file or not) */
  readonly supported: number;
  /** every refusal, `CODE:detail` (details are matcher names / fixed words only; no test text) */
  readonly refusals: readonly string[];
}

export type ExtractRefusal = "OOP_CASES_EMPTY" | "OOP_CASES_NONLITERAL" | "OOP_CASES_UNSUPPORTED_ASSERT" | "OOP_CASES_UNSUPPORTED_TEST" | "OOP_CASES_NO_ASSERT";
export type ExtractResult =
  | { readonly ok: true; readonly cases: readonly DataCase[]; readonly moduleHint: string | null }
  | { readonly ok: false; readonly code: ExtractRefusal; readonly detail?: string };

/** Public detail words: a matcher / statement name only (no message text). */
function word(s: string): string {
  return /^[A-Za-z0-9_.:-]{1,60}$/.test(s) ? s : "other";
}

/** A TypeScript/JS literal the extractor accepts: JSON values written as literals (no -0, no __proto__ key).
 *  M205: when `scope` is set, a const-bound JSON identifier (or `obj.prop` of one) resolves to its value. */
type LitScope = Map<string, unknown>;
function litFromNode(node: any, scope?: LitScope): { ok: true; value: unknown } | { ok: false } {
  if (!node) return { ok: false };
  if (ts.isParenthesizedExpression(node)) return litFromNode(node.expression, scope);
  if (scope && ts.isIdentifier(node) && scope.has(node.text)) return { ok: true, value: scope.get(node.text) }; // m205-guard:const-resolve
  if (scope && ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression) && scope.has(node.expression.text)) {
    const base = scope.get(node.expression.text);
    if (base !== null && typeof base === "object" && !P.isArray(base) && Object.prototype.hasOwnProperty.call(base, node.name.text)) {
      return { ok: true, value: (base as Record<string, unknown>)[node.name.text] }; // m205-guard:const-prop
    }
    return { ok: false };
  }
  if (node.kind === ts.SyntaxKind.StringLiteral || node.kind === ts.SyntaxKind.NoSubstitutionTemplateLiteral) return { ok: true, value: node.text };
  if (node.kind === ts.SyntaxKind.NumericLiteral) {
    const n = Number(node.text);
    return P.isFinite(n) ? { ok: true, value: n } : { ok: false };
  }
  if (node.kind === ts.SyntaxKind.TrueKeyword) return { ok: true, value: true };
  if (node.kind === ts.SyntaxKind.FalseKeyword) return { ok: true, value: false };
  if (node.kind === ts.SyntaxKind.NullKeyword) return { ok: true, value: null };
  if (node.kind === ts.SyntaxKind.PrefixUnaryExpression && node.operator === ts.SyntaxKind.MinusToken) {
    const inner = litFromNode(node.operand, scope);
    if (!inner.ok || typeof inner.value !== "number") return { ok: false };
    if (P.is(-inner.value, -0)) return { ok: false }; // m204-guard:lit-neg-zero (JSON cannot carry -0)
    return { ok: true, value: -inner.value };
  }
  if (node.kind === ts.SyntaxKind.ArrayLiteralExpression) {
    if (node.elements.length > LIT_MAX) return { ok: false };
    const out: unknown[] = [];
    for (const el of node.elements) {
      if (ts.isSpreadElement(el) || ts.isOmittedExpression(el)) return { ok: false };
      const v = litFromNode(el, scope);
      if (!v.ok) return { ok: false };
      out.push(v.value);
    }
    return { ok: true, value: out };
  }
  if (node.kind === ts.SyntaxKind.ObjectLiteralExpression) {
    if (node.properties.length > LIT_MAX) return { ok: false };
    const out: Record<string, unknown> = {};
    for (const p of node.properties) {
      if (!ts.isPropertyAssignment(p)) return { ok: false };
      const key = ts.isIdentifier(p.name) ? p.name.text : ts.isStringLiteral(p.name) ? p.name.text : null;
      if (key === null) return { ok: false };
      if (key === "__proto__") return { ok: false }; // m204-guard:lit-proto (a literal __proto__ sets the prototype)
      const v = litFromNode(p.initializer, scope);
      if (!v.ok) return { ok: false };
      out[key] = v.value;
    }
    return { ok: true, value: out };
  }
  return { ok: false };
}

const isPrim = (v: unknown) => v === null || typeof v !== "object";
const kindWord = (n: any): string => {
  if (ts.isVariableStatement(n)) return "var";
  if (ts.isIfStatement(n)) return "if";
  if (ts.isForStatement(n) || ts.isForOfStatement(n) || ts.isForInStatement(n) || ts.isWhileStatement(n) || ts.isDoStatement(n)) return "loop";
  if (ts.isTryStatement(n)) return "try";
  if (ts.isReturnStatement(n)) return "return";
  if (ts.isExpressionStatement(n)) return "expr";
  if (ts.isFunctionDeclaration(n) || ts.isClassDeclaration(n)) return "decl";
  if (ts.isBlock(n)) return "block";
  return "other";
};

/**
 * Fail-closed extraction (M204 + M205). The file must be: imports (test / assert / expect libraries; relative target
 * modules; unused other modules are ignored), const bindings of JSON literals, and test(name, () => ...) / it(...) /
 * test.each(literalTable)(name, (params) => ...) blocks, optionally inside describe / suite (names concatenated into
 * case ids). Each test body must be ONLY assertion statements and const-of-JSON-literal bindings; each assertion must
 * be an admitted matcher on a call of a target export with literal / const-resolved arguments. Anything not exactly
 * reproducible is refused by name. One refusal refuses the whole file.
 */
export function extractCasesWithStats(source: string, filePath = "test.ts"): { result: ExtractResult; stats: ExtractStats } {
  const kind = filePath.endsWith(".tsx") ? ts.ScriptKind.TSX : filePath.endsWith(".js") || filePath.endsWith(".cjs") || filePath.endsWith(".mjs")
    ? ts.ScriptKind.JS : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(filePath, source, ts.ScriptTarget.ES2022, true, kind);
  const cases: DataCase[] = [];
  const refusals: { code: ExtractRefusal; detail: string }[] = [];
  const refuse = (code: ExtractRefusal, detail: string) => { refusals.push({ code, detail: word(detail) }); };
  let tests = 0;

  // ---- bindings
  const assertNs = new Map<string, boolean>(); // local -> strict
  const assertFn = new Map<string, { method: string; strict: boolean }>();
  const expectLocal = new Set<string>();
  const testLocal = new Map<string, "test" | "suite" | "hook">();
  const target = new Map<string, { mod: string; name: string } | { mod: string; ns: true } | { mod: string; dflt: true }>();
  const otherBound = new Set<string>();
  const relMods = new Set<string>();
  const isRel = (m: string) => /^\.\.?[/\\]/.test(m);
  const libKind = (m: string): "assert-strict" | "assert" | "expect" | "test" | "both" | null =>
    (ASSERT_STRICT_SOURCES as readonly string[]).includes(m) ? "assert-strict"
      : (ASSERT_LEGACY_SOURCES as readonly string[]).includes(m) ? "assert"
        : m === "vitest" || m === "@jest/globals" ? "both"
          : m === "expect" ? "expect" : (TEST_SOURCES as readonly string[]).includes(m) ? "test" : null;
  const bindLib = (lib: NonNullable<ReturnType<typeof libKind>>, imported: string, local: string, whole: boolean) => {
    if (lib === "assert-strict" || lib === "assert") {
      if (whole || imported === "default") { assertNs.set(local, lib === "assert-strict"); return; }
      if (imported === "strict") { assertNs.set(local, true); return; }
      assertFn.set(local, { method: imported, strict: lib === "assert-strict" });
      return;
    }
    if ((lib === "both" || lib === "expect") && (imported === "expect" || (lib === "expect" && (whole || imported === "default")))) { expectLocal.add(local); return; }
    if (lib === "both" || lib === "test") {
      if (TEST_FNS.has(imported)) { testLocal.set(local, "test"); return; }
      if (SUITE_FNS.has(imported)) { testLocal.set(local, "suite"); return; }
      if (HOOK_FNS.has(imported)) { testLocal.set(local, "hook"); return; }
      if (whole || imported === "default") { testLocal.set(local, "test"); return; } // import test from "node:test"
    }
    otherBound.add(local); // vi, mock, ...: any use in a test body is an unsupported statement
  };
  const bindModule = (mod: string, imported: string | null, local: string, whole: boolean) => {
    if (isRel(mod)) {
      relMods.add(mod);
      target.set(local, whole ? { mod, ns: true } : imported === "default" ? { mod, dflt: true } : { mod, name: imported ?? local });
      return;
    }
    const lib = libKind(mod);
    if (!lib) {
      otherBound.add(local);
      if (true) return; // m205-guard:unused-import (without this return, unused non-lib imports refuse as import-other)
      refuse("OOP_CASES_UNSUPPORTED_TEST", "import-other");
      return;
    }
    bindLib(lib, imported ?? local, local, whole);
  };

  const requireOf = (e: any): string | null => (e && ts.isCallExpression(e) && ts.isIdentifier(e.expression) && e.expression.text === "require"
    && e.arguments.length === 1 && ts.isStringLiteral(e.arguments[0]) ? e.arguments[0].text : null);

  /** M205: bind `const name = <JSON lit>` into scope; refuse shadowing / non-const / non-lit / destructuring. */
  function bindLitConst(stmt: any, scope: LitScope, where: string): boolean {
    if (!(stmt.declarationList.flags & ts.NodeFlags.Const)) { refuse("OOP_CASES_UNSUPPORTED_TEST", where + ":var"); return false; } // m205-guard:const-kind
    for (const d of stmt.declarationList.declarations) {
      if (!ts.isIdentifier(d.name) || !d.initializer) { refuse("OOP_CASES_UNSUPPORTED_TEST", where + ":const-shape"); return false; } // m205-guard:const-shape
      if (scope.has(d.name.text)) { refuse("OOP_CASES_UNSUPPORTED_TEST", where + ":const-shadow"); return false; } // m205-guard:const-shadow
      const v = litFromNode(d.initializer, scope);
      if (!v.ok) { refuse("OOP_CASES_UNSUPPORTED_TEST", where + ":var"); return false; }
      scope.set(d.name.text, v.value);
    }
    return true;
  }
  /** M205: any assignment / update of a scoped const name is a refusal (reassignment). */
  function findsReassign(node: any, scope: LitScope): boolean {
    let hit = false;
    (function walk(n: any) {
      if (hit || !n) return;
      if (ts.isBinaryExpression(n) && n.operatorToken && (
        n.operatorToken.kind === ts.SyntaxKind.EqualsToken ||
        n.operatorToken.kind === ts.SyntaxKind.PlusEqualsToken ||
        n.operatorToken.kind === ts.SyntaxKind.MinusEqualsToken ||
        n.operatorToken.kind === ts.SyntaxKind.AsteriskEqualsToken ||
        n.operatorToken.kind === ts.SyntaxKind.SlashEqualsToken ||
        n.operatorToken.kind === ts.SyntaxKind.PercentEqualsToken
      ) && ts.isIdentifier(n.left) && scope.has(n.left.text)) { hit = true; return; }
      if ((ts.isPrefixUnaryExpression(n) || ts.isPostfixUnaryExpression(n)) &&
        (n.operator === ts.SyntaxKind.PlusPlusToken || n.operator === ts.SyntaxKind.MinusMinusToken) &&
        ts.isIdentifier(n.operand) && scope.has(n.operand.text)) { hit = true; return; }
      ts.forEachChild(n, walk);
    })(node);
    return hit;
  }

  type EachRow = { values: unknown[]; paramNames: string[] };
  type TestEntry = { cb: any; path: string[]; name: string; scope: LitScope; each?: EachRow[] };
  type SuiteEntry = { cb: any; path: string[]; scope: LitScope };

  const suiteQueue: SuiteEntry[] = [];
  const testBodies: TestEntry[] = [];
  const rootScope: LitScope = new Map();

  function isTestName(name: string): boolean {
    return testLocal.get(name) === "test" || (TEST_FNS.has(name) && !target.has(name) && !otherBound.has(name) && !assertNs.has(name) && !assertFn.has(name) && !expectLocal.has(name));
  }
  function isSuiteName(name: string): boolean {
    return testLocal.get(name) === "suite" || (SUITE_FNS.has(name) && !target.has(name) && !otherBound.has(name));
  }
  function isHookName(name: string): boolean {
    return testLocal.get(name) === "hook" || (HOOK_FNS.has(name) && !target.has(name) && !otherBound.has(name));
  }

  /** Parse a literal test.each table into rows of values + the callback's param names. */
  function parseEachTable(tableNode: any, cb: any): EachRow[] | null {
    const table = litFromNode(tableNode);
    if (!table.ok || !P.isArray(table.value) || table.value.length === 0) return null; // m205-guard:each-table
    const rows = table.value as unknown[];
    const params = cb.parameters as readonly any[];
    // array of arrays of equal length
    if (rows.every((r) => P.isArray(r))) {
      const len = (rows[0] as unknown[]).length;
      if (!rows.every((r) => (r as unknown[]).length === len)) return null;
      if (params.length !== len) return null;
      const names: string[] = [];
      for (const p of params) {
        if (!ts.isIdentifier(p.name) || p.dotDotDotToken || p.initializer || p.questionToken) return null; // m205-guard:each-params
        names.push(p.name.text);
      }
      return (rows as unknown[][]).map((values) => ({ values, paramNames: names }));
    }
    // array of primitives -> one param
    if (rows.every((r) => isPrim(r))) {
      if (params.length !== 1 || !ts.isIdentifier(params[0]!.name) || params[0]!.dotDotDotToken || params[0]!.initializer || params[0]!.questionToken) return null;
      const name = params[0]!.name.text;
      return rows.map((v) => ({ values: [v], paramNames: [name] }));
    }
    // array of plain objects -> one object param OR a destructuring pattern of identifiers
    if (rows.every((r) => r !== null && typeof r === "object" && !P.isArray(r))) {
      const objs = rows as Record<string, unknown>[];
      if (params.length !== 1) return null;
      const p = params[0]!;
      if (ts.isIdentifier(p.name) && !p.dotDotDotToken && !p.initializer && !p.questionToken) {
        return objs.map((o) => ({ values: [o], paramNames: [p.name.text] }));
      }
      if (ts.isObjectBindingPattern(p.name) && !p.dotDotDotToken && !p.initializer && !p.questionToken) {
        const keys: string[] = [];
        const locals: string[] = [];
        for (const el of p.name.elements) {
          if (el.dotDotDotToken || el.initializer || !ts.isIdentifier(el.name) || (el.propertyName && !ts.isIdentifier(el.propertyName))) return null;
          keys.push(el.propertyName ? (el.propertyName as any).text : el.name.text);
          locals.push(el.name.text);
        }
        if (keys.length === 0) return null;
        if (!objs.every((o) => keys.every((k) => Object.prototype.hasOwnProperty.call(o, k)))) return null;
        return objs.map((o) => ({ values: keys.map((k) => o[k]), paramNames: locals }));
      }
      return null;
    }
    return null;
  }

  // ---- top level (and describe bodies): declarative statements only
  function topStatement(stmt: any, path: string[], scope: LitScope, inSuite: boolean) {
    if (ts.isImportDeclaration(stmt)) {
      if (inSuite) { refuse("OOP_CASES_UNSUPPORTED_TEST", "import-in-suite"); return; }
      const mod = ts.isStringLiteral(stmt.moduleSpecifier) ? stmt.moduleSpecifier.text : "";
      const ic = stmt.importClause;
      if (!ic) { refuse("OOP_CASES_UNSUPPORTED_TEST", "side-effect-import"); return; }
      if (ic.isTypeOnly) return;
      if (ic.name) bindModule(mod, "default", ic.name.text, false);
      const nb = ic.namedBindings;
      if (nb && ts.isNamespaceImport(nb)) bindModule(mod, null, nb.name.text, true);
      if (nb && ts.isNamedImports(nb)) for (const el of nb.elements) {
        if (el.isTypeOnly) continue;
        bindModule(mod, (el.propertyName ?? el.name).text, el.name.text, false);
      }
      return;
    }
    if (ts.isTypeAliasDeclaration(stmt) || ts.isInterfaceDeclaration(stmt) || ts.isEmptyStatement(stmt)) return;
    if (ts.isExpressionStatement(stmt) && ts.isStringLiteral(stmt.expression) && stmt.expression.text === "use strict") return;
    if (ts.isVariableStatement(stmt)) {
      let sawRequire = false;
      for (const d of stmt.declarationList.declarations) {
        const req = requireOf(d.initializer) ?? (d.initializer && ts.isPropertyAccessExpression(d.initializer) && d.initializer.name.text === "strict" ? requireOf(d.initializer.expression) : null);
        if (req !== null && !inSuite) {
          sawRequire = true;
          const viaStrict = !requireOf(d.initializer);
          if (ts.isIdentifier(d.name)) bindModule(viaStrict ? "node:assert/strict" : req, null, d.name.text, true);
          else if (ts.isObjectBindingPattern(d.name) && !viaStrict) {
            for (const el of d.name.elements) {
              if (!ts.isIdentifier(el.name) || el.dotDotDotToken || el.initializer || (el.propertyName && !ts.isIdentifier(el.propertyName))) { refuse("OOP_CASES_UNSUPPORTED_TEST", "require-shape"); continue; }
              bindModule(req, (el.propertyName ?? el.name).text, el.name.text, false);
            }
          } else refuse("OOP_CASES_UNSUPPORTED_TEST", "require-shape");
          continue;
        }
        if (req !== null && inSuite) { refuse("OOP_CASES_UNSUPPORTED_TEST", "suite-stmt:var"); return; }
        // lit const (possibly mixed into the same statement as a require — rare; handle per decl)
        if (!(stmt.declarationList.flags & ts.NodeFlags.Const)) { refuse("OOP_CASES_UNSUPPORTED_TEST", inSuite ? "suite-stmt:var" : "top-level:var"); return; }
        if (!ts.isIdentifier(d.name) || !d.initializer) { refuse("OOP_CASES_UNSUPPORTED_TEST", inSuite ? "suite-stmt:var" : "top-level:var"); return; }
        if (scope.has(d.name.text)) { refuse("OOP_CASES_UNSUPPORTED_TEST", (inSuite ? "suite-stmt" : "top-level") + ":const-shadow"); return; }
        const v = litFromNode(d.initializer, scope);
        if (!v.ok) { refuse("OOP_CASES_UNSUPPORTED_TEST", inSuite ? "suite-stmt:var" : "top-level:var"); return; }
        scope.set(d.name.text, v.value); // m205-guard:const-bind
      }
      void sawRequire;
      return;
    }
    if (ts.isExpressionStatement(stmt) && ts.isCallExpression(stmt.expression)) {
      const call = stmt.expression;
      const callee = call.expression;

      // M205: test.each`...`(name, cb) tagged-template form — refused (not an exact table lit)
      if (ts.isTaggedTemplateExpression(callee) && ts.isPropertyAccessExpression(callee.tag) && callee.tag.name.text === "each"
        && ts.isIdentifier(callee.tag.expression) && (isTestName(callee.tag.expression.text) || isSuiteName(callee.tag.expression.text))) {
        refuse("OOP_CASES_UNSUPPORTED_TEST", "test-modifier:each");
        return;
      }
      // M205: test.each(table)(name, cb) / it.each(table)(name, cb) — literal table only
      if (ts.isCallExpression(callee) && ts.isPropertyAccessExpression(callee.expression) && callee.expression.name.text === "each"
        && ts.isIdentifier(callee.expression.expression) && isTestName(callee.expression.expression.text)
        && callee.arguments.length === 1) {
        const nameOk = call.arguments.length === 2 && (ts.isStringLiteral(call.arguments[0]) || ts.isNoSubstitutionTemplateLiteral(call.arguments[0]));
        const cb = call.arguments.length === 2 ? call.arguments[1] : null;
        if (!nameOk || !cb || !(ts.isArrowFunction(cb) || ts.isFunctionExpression(cb))) { refuse("OOP_CASES_UNSUPPORTED_TEST", "each-shape"); return; } // m205-guard:each-shape
        if (cb.asteriskToken || (cb.modifiers ?? []).some((m: any) => m.kind === ts.SyntaxKind.AsyncKeyword)) { refuse("OOP_CASES_UNSUPPORTED_TEST", "each-async"); return; }
        const rows = parseEachTable(callee.arguments[0], cb);
        if (!rows) { refuse("OOP_CASES_UNSUPPORTED_TEST", "test-modifier:each"); return; }
        for (const r of rows) for (const n of r.paramNames) if (scope.has(n)) { refuse("OOP_CASES_UNSUPPORTED_TEST", "each-shadow"); return; } // m205-guard:each-shadow
        tests++;
        testBodies.push({ cb, path: path.slice(), name: (call.arguments[0] as any).text, scope: new Map(scope), each: rows });
        return;
      }

      const name = ts.isIdentifier(callee) ? callee.text : null;
      const role = name === null ? null : isTestName(name) ? "test" as const : isSuiteName(name) ? "suite" as const : isHookName(name) ? "hook" as const : null;
      // test.skip(...), describe.only(...), it.concurrent.each(...)(...), test.only.each(...): the root is a test name
      let root: any = callee, firstProp: string | null = null;
      while (ts.isPropertyAccessExpression(root) || ts.isCallExpression(root) || ts.isElementAccessExpression(root)) {
        if (ts.isPropertyAccessExpression(root)) firstProp = root.name.text;
        root = root.expression;
      }
      const rootName = ts.isIdentifier(root) && root !== callee ? root.text : null;
      if (rootName !== null && (testLocal.has(rootName) || ((TEST_FNS.has(rootName) || SUITE_FNS.has(rootName)) && !target.has(rootName) && !otherBound.has(rootName)))) {
        refuse("OOP_CASES_UNSUPPORTED_TEST", "test-modifier:" + (firstProp ?? "call")); // m204-guard:test-modifier (skip / only / todo / concurrent; each handled above)
        return;
      }
      if (role === "hook") { refuse("OOP_CASES_UNSUPPORTED_TEST", "hook:" + name); return; } // m204-guard:hook
      if (role === "test" || role === "suite") {
        const cb = call.arguments.length === 2 ? call.arguments[1] : null;
        const nameOk = call.arguments.length >= 1 && (ts.isStringLiteral(call.arguments[0]) || ts.isNoSubstitutionTemplateLiteral(call.arguments[0]));
        if (!cb || !nameOk || !(ts.isArrowFunction(cb) || ts.isFunctionExpression(cb))) { refuse("OOP_CASES_UNSUPPORTED_TEST", role + "-shape"); return; } // m204-guard:test-shape
        if (cb.parameters.length !== 0) { refuse("OOP_CASES_UNSUPPORTED_TEST", role + "-params"); return; } // m204-guard:test-params (t / done)
        if (cb.asteriskToken) { refuse("OOP_CASES_UNSUPPORTED_TEST", role + "-generator"); return; }
        const title = (call.arguments[0] as any).text as string;
        if (role === "suite") {
          suiteQueue.push({ cb, path: path.concat([title]), scope: new Map(scope) }); // m205-guard:suite-nest
          return;
        }
        tests++;
        testBodies.push({ cb, path: path.slice(), name: title, scope: new Map(scope) });
        return;
      }
    }
    if (ts.isExpressionStatement(stmt) && findsReassign(stmt, scope)) { refuse("OOP_CASES_UNSUPPORTED_TEST", (inSuite ? "suite-stmt" : "top-level") + ":const-reassign"); return; } // m205-guard:const-reassign
    refuse("OOP_CASES_UNSUPPORTED_TEST", (inSuite ? "suite-stmt:" : "top-level:") + kindWord(stmt)); // m204-guard:top-level
  }
  // imports first (bindings), then the rest in order
  for (const stmt of sf.statements) if (ts.isImportDeclaration(stmt) || (ts.isVariableStatement(stmt) && stmt.declarationList.declarations.some((d) => requireOf(d.initializer) !== null || (d.initializer && ts.isPropertyAccessExpression(d.initializer) && requireOf(d.initializer.expression) !== null)))) topStatement(stmt, [], rootScope, false);
  for (const stmt of sf.statements) if (!(ts.isImportDeclaration(stmt) || (ts.isVariableStatement(stmt) && stmt.declarationList.declarations.some((d) => requireOf(d.initializer) !== null || (d.initializer && ts.isPropertyAccessExpression(d.initializer) && requireOf(d.initializer.expression) !== null))))) topStatement(stmt, [], rootScope, false);
  for (let i = 0; i < suiteQueue.length; i++) {
    const s = suiteQueue[i]!;
    if (ts.isBlock(s.cb.body)) for (const st of s.cb.body.statements) topStatement(st, s.path, s.scope, true);
    else refuse("OOP_CASES_UNSUPPORTED_TEST", "suite-shape");
  }

  // ---- assertion recognition
  const isExpectName = (n: string) => expectLocal.has(n) || (n === "expect" && !target.has(n) && !otherBound.has(n) && !assertNs.has(n) && !assertFn.has(n));
  function assertionOf(call: any): { style: "expect"; path: string; subject: any; args: any[] } | { style: "assert"; method: string; strict: boolean; args: any[] } | { style: "other"; path: string } | null {
    if (!ts.isCallExpression(call)) return null;
    const callee = call.expression;
    if (ts.isIdentifier(callee)) {
      if (assertNs.has(callee.text)) return { style: "assert", method: "assert", strict: assertNs.get(callee.text)!, args: [...call.arguments] };
      const af = assertFn.get(callee.text);
      if (af) return { style: "assert", method: af.method, strict: af.strict, args: [...call.arguments] };
      if (callee.text === "assert" || callee.text === "expect") return { style: "other", path: callee.text };
      return null;
    }
    if (!ts.isPropertyAccessExpression(callee) && !ts.isElementAccessExpression(callee)) return null;
    const props: string[] = [];
    let cur: any = callee;
    while (ts.isPropertyAccessExpression(cur) || ts.isElementAccessExpression(cur) || (ts.isCallExpression(cur) && cur !== call)) {
      if (ts.isPropertyAccessExpression(cur)) { props.unshift(cur.name.text); cur = cur.expression; continue; }
      if (ts.isElementAccessExpression(cur)) { props.unshift("[]"); cur = cur.expression; continue; }
      if (ts.isIdentifier(cur.expression) && isExpectName(cur.expression.text)) {
        return { style: "expect", path: props.join("."), subject: cur.arguments.length === 1 ? cur.arguments[0] : null, args: [...call.arguments] };
      }
      if (ts.isPropertyAccessExpression(cur.expression) && ts.isIdentifier(cur.expression.expression) && isExpectName(cur.expression.expression.text)) {
        return { style: "other", path: "expect." + cur.expression.name.text + (props.length ? "." + props.join(".") : "") };
      }
      props.unshift("()");
      cur = cur.expression;
    }
    if (ts.isIdentifier(cur)) {
      if (assertNs.has(cur.text)) {
        if (props.length === 1) return { style: "assert", method: props[0]!, strict: assertNs.get(cur.text)!, args: [...call.arguments] };
        return { style: "other", path: "assert." + props.join(".") };
      }
      if (isExpectName(cur.text)) return { style: "other", path: "expect." + props.join(".") };
      if (cur.text === "assert" || cur.text === "expect") return { style: "other", path: cur.text + "." + props.join(".") };
    }
    if (props.some((p) => p === "assert" || p === "expect" || p === "should" || p === "must")) return { style: "other", path: props.join(".") };
    return null;
  }

  let assertionsSeen = 0;
  (function count(node: any) {
    if (ts.isCallExpression(node) && assertionOf(node)) {
      assertionsSeen++;
      let cur: any = node;
      while (cur && (ts.isCallExpression(cur) || ts.isPropertyAccessExpression(cur) || ts.isElementAccessExpression(cur))) {
        if (ts.isCallExpression(cur)) for (const a of cur.arguments) count(a);
        cur = cur.expression;
      }
      return;
    }
    ts.forEachChild(node, count);
  })(sf);

  // ---- target calls (M205: args may resolve through the active const scope)
  const usedMods = new Set<string>();
  let activeScope: LitScope = rootScope;
  function targetCall(expr: any): { fn: string; args: unknown[]; recv?: "module" } | null {
    while (ts.isParenthesizedExpression(expr)) expr = expr.expression;
    if (!ts.isCallExpression(expr) || expr.questionDotToken) return null;
    let fn: string | null = null, recv: "module" | undefined, mod: string | null = null;
    if (ts.isIdentifier(expr.expression)) {
      const b = target.get(expr.expression.text);
      if (!b || !("name" in b)) return null; // m204-guard:target-binding (a call of anything but a named target export)
      if (b.name === "default") return null;
      fn = b.name; mod = b.mod;
    } else if (ts.isPropertyAccessExpression(expr.expression) && ts.isIdentifier(expr.expression.expression)) {
      const b = target.get(expr.expression.expression.text);
      if (!b || !("ns" in b)) return null;
      fn = expr.expression.name.text; recv = "module"; mod = b.mod;
    }
    if (!fn || !mod) return null;
    const args: unknown[] = [];
    for (const a of expr.arguments) {
      if (ts.isSpreadElement(a)) return null;
      const v = litFromNode(a, activeScope);
      if (!v.ok) return null;
      args.push(v.value);
    }
    usedMods.add(mod);
    return recv ? { fn, args, recv } : { fn, args };
  }
  function thunkCall(node: any) {
    if (!node || !(ts.isArrowFunction(node) || ts.isFunctionExpression(node))) return null;
    if (node.parameters.length || node.asteriskToken || (node.modifiers ?? []).some((m: any) => m.kind === ts.SyntaxKind.AsyncKeyword)) return null; // m204-guard:thunk-async
    let e: any = node.body;
    if (ts.isBlock(e)) {
      if (e.statements.length !== 1) return null;
      const s = e.statements[0];
      e = ts.isExpressionStatement(s) ? s.expression : ts.isReturnStatement(s) ? s.expression : null;
    }
    return e ? targetCall(e) : null;
  }
  const builtinErr = (n: any): string | null => (n && ts.isIdentifier(n) && (BUILTIN_ERRORS as readonly string[]).includes(n.text)
    && !target.has(n.text) && !otherBound.has(n.text) && !activeScope.has(n.text) ? n.text : null);
  const regexOf = (n: any): { re: string; flags: string } | null => {
    if (!n || n.kind !== ts.SyntaxKind.RegularExpressionLiteral) return null;
    const t: string = n.text; const i = t.lastIndexOf("/");
    return { re: t.slice(1, i), flags: t.slice(i + 1) };
  };
  const msgArgOk = (n: any) => n === undefined || ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n);

  let currentPrefix = "";
  const push = (call: { fn: string; args: unknown[]; recv?: "module" }, expect: CaseExpect) => {
    cases.push({ id: `${currentPrefix}c${cases.length + 1}:${call.fn}`, fn: call.fn, args: call.args, expect, ...(call.recv ? { recv: call.recv } : {}) });
  };

  function extractAssertion(a: NonNullable<ReturnType<typeof assertionOf>>): void {
    if (a.style === "other") { refuse("OOP_CASES_UNSUPPORTED_ASSERT", a.path); return; }
    if (a.style === "assert") {
      const m = a.method;
      const VALUE = new Set(["strictEqual", "deepStrictEqual", "notStrictEqual", "equal", "deepEqual"]);
      if (VALUE.has(m)) {
        if (!a.strict && (m === "equal" || m === "deepEqual")) { refuse("OOP_CASES_UNSUPPORTED_ASSERT", m + ":loose"); return; } // m204-guard:loose-equal
        if (a.args.length < 2 || a.args.length > 3 || !msgArgOk(a.args[2])) { nonLiteral("assert-arity"); return; }
        const call = targetCall(a.args[0]);
        const exp = litFromNode(a.args[1], activeScope);
        if (!call || !exp.ok) { nonLiteral("assert-nonliteral"); return; }
        const isCmp = m === "strictEqual" || m === "equal" || m === "notStrictEqual";
        if (isCmp && !isPrim(exp.value)) { refuse("OOP_CASES_UNSUPPORTED_ASSERT", m + ":object"); return; } // m204-guard:is-object (=== on a fresh literal object never holds)
        push(call, m === "notStrictEqual" ? { ok: true, value: exp.value, negate: true } : { ok: true, value: exp.value, cmp: isCmp ? "is" : "deep" });
        return;
      }
      if (m === "throws") {
        const call = thunkCall(a.args[0]);
        if (!call) { nonLiteral("throws-nonliteral"); return; }
        const v = a.args[1];
        if (a.args.length > 3 || (a.args.length === 3 && !msgArgOk(a.args[2]))) { nonLiteral("throws-arity"); return; }
        if (v === undefined) { push(call, { ok: false }); return; }
        const cls = builtinErr(v);
        if (cls) { push(call, { ok: false, error: { isa: cls } }); return; }
        if (ts.isObjectLiteralExpression(v)) {
          const error: { name?: string; message?: string | { re: string; flags: string } } = {};
          for (const p of v.properties) {
            const key = ts.isPropertyAssignment(p) && ts.isIdentifier(p.name) ? p.name.text : null;
            if (key !== "name" && key !== "message") { refuse("OOP_CASES_UNSUPPORTED_ASSERT", "throws:object-key"); return; }
            const init = (p as any).initializer;
            const re = key === "message" ? regexOf(init) : null;
            const lit = re ? null : litFromNode(init, activeScope);
            if (re) error.message = re;
            else if (lit && lit.ok && typeof lit.value === "string") error[key] = lit.value;
            else { refuse("OOP_CASES_UNSUPPORTED_ASSERT", "throws:object-value"); return; }
          }
          if (!("name" in error) && !("message" in error)) { refuse("OOP_CASES_UNSUPPORTED_ASSERT", "throws:object-empty"); return; }
          push(call, { ok: false, error: error as any });
          return;
        }
        refuse("OOP_CASES_UNSUPPORTED_ASSERT", "throws:" + (regexOf(v) ? "regexp" : ts.isStringLiteral(v) ? "string" : "validator")); // m204-guard:throws-arg
        return;
      }
      if (m === "doesNotThrow") {
        const call = thunkCall(a.args[0]);
        if (!call || a.args.length !== 1) { nonLiteral("doesNotThrow-nonliteral"); return; }
        push(call, { ok: true, any: true });
        return;
      }
      refuse("OOP_CASES_UNSUPPORTED_ASSERT", "assert." + m);
      return;
    }
    const path = a.path;
    if (path === "toBe" || path === "toEqual" || path === "toStrictEqual" || path === "not.toBe") {
      if (a.args.length !== 1) { nonLiteral("expect-arity"); return; }
      const call = targetCall(a.subject);
      const exp = litFromNode(a.args[0], activeScope);
      if (!call || !exp.ok) { nonLiteral("expect-nonliteral"); return; }
      if ((path === "toBe" || path === "not.toBe") && !isPrim(exp.value)) { refuse("OOP_CASES_UNSUPPORTED_ASSERT", path + ":object"); return; } // m204-guard:tobe-object
      push(call, path === "not.toBe" ? { ok: true, value: exp.value, negate: true } : { ok: true, value: exp.value, cmp: path === "toBe" ? "is" : "deep" });
      return;
    }
    if (path === "toThrow" || path === "toThrowError") {
      const call = thunkCall(a.subject);
      if (!call) { nonLiteral("toThrow-nonliteral"); return; }
      if (a.args.length === 0) { push(call, { ok: false }); return; }
      if (a.args.length !== 1) { nonLiteral("toThrow-arity"); return; }
      const v = a.args[0];
      const cls = builtinErr(v);
      if (cls) { push(call, { ok: false, error: { isa: cls } }); return; }
      const re = regexOf(v);
      if (re) { push(call, { ok: false, error: { message: re } as any }); return; }
      if (ts.isStringLiteral(v) || ts.isNoSubstitutionTemplateLiteral(v)) { push(call, { ok: false, error: { includes: v.text } }); return; }
      refuse("OOP_CASES_UNSUPPORTED_ASSERT", path + ":arg"); // m204-guard:tothrow-arg
      return;
    }
    if (path === "not.toThrow" || path === "not.toThrowError") {
      const call = thunkCall(a.subject);
      if (!call || a.args.length !== 0) { nonLiteral("toThrow-nonliteral"); return; }
      push(call, { ok: true, any: true });
      return;
    }
    refuse("OOP_CASES_UNSUPPORTED_ASSERT", path); // m204-guard:unsupported-matcher (toContain, toMatchObject, resolves.*, ...)
  }
  function nonLiteral(detail: string) { refuse("OOP_CASES_NONLITERAL", detail); } // m202-guard:nonliteral

  let extracted = 0;
  let coveredAssertions = 0; // AST assertions that belong to a fully-walked test (each counts once, not per row)
  function runTestBody(cb: any, scope: LitScope, prefix: string): number {
    activeScope = scope;
    currentPrefix = prefix; // m205-guard:suite-id
    if (findsReassign(cb, scope)) { refuse("OOP_CASES_UNSUPPORTED_TEST", "stmt:const-reassign"); return 0; } // covered by m205-guard:const-reassign
    const body = cb.body;
    const stmts: any[] = ts.isBlock(body) ? [...body.statements] : [ts.factory.createExpressionStatement(body)];
    let recognised = 0;
    for (const s of stmts) {
      if (ts.isEmptyStatement(s)) continue;
      if (ts.isVariableStatement(s)) {
        bindLitConst(s, scope, "stmt"); // m205-guard:const-in-test
        continue;
      }
      let e: any = ts.isExpressionStatement(s) ? s.expression : null;
      let awaited = false;
      while (e && (ts.isAwaitExpression(e) || ts.isParenthesizedExpression(e))) { if (ts.isAwaitExpression(e)) awaited = true; e = e.expression; }
      const a = e ? assertionOf(e) : null;
      if (!a) { refuse("OOP_CASES_UNSUPPORTED_TEST", "stmt:" + kindWord(s)); continue; } // m204-guard:test-stmt
      recognised++;
      if (awaited) { refuse("OOP_CASES_UNSUPPORTED_ASSERT", "await:" + (a.style === "assert" ? a.method : a.path)); continue; }
      const before = cases.length;
      extractAssertion(a);
      extracted += cases.length - before;
    }
    if (recognised === 0) refuse("OOP_CASES_NO_ASSERT", "test"); // m204-guard:no-assert
    return recognised;
  }

  for (const t of testBodies) {
    const pathPrefix = t.path.length ? t.path.join("/") + "/" : "";
    if (t.each) {
      let rec = 0;
      for (let i = 0; i < t.each.length; i++) {
        const row = t.each[i]!;
        const scope: LitScope = new Map(t.scope);
        for (let j = 0; j < row.paramNames.length; j++) scope.set(row.paramNames[j]!, row.values[j]);
        rec = runTestBody(t.cb, scope, `${pathPrefix}@${i}/`); // m205-guard:each-expand
      }
      coveredAssertions += rec; // one AST pass worth, not per row
    } else {
      coveredAssertions += runTestBody(t.cb, new Map(t.scope), pathPrefix);
    }
  }
  if (usedMods.size > 1) refuse("OOP_CASES_UNSUPPORTED_TEST", "multi-module"); // m204-guard:multi-module
  // M205: unused relative imports of other modules are ignored (only usedMods matter). A used second module is multi-module.
  const moduleHint = usedMods.size === 1 ? [...usedMods][0]! : null;
  void relMods; // retained for clarity; unused relatives no longer refuse (see m205-guard:unused-import above)

  const stats = (admitted: boolean): ExtractStats => ({ tests, assertionsSeen, extracted: admitted ? extracted : 0, supported: extracted, refusals: refusals.map((r) => `${r.code}:${r.detail}`) });
  if (refusals.length) {
    const r = refusals[0]!;
    return { result: { ok: false, code: r.code, detail: r.detail }, stats: stats(false) };
  }
  // Fail-closed: every AST assertion belongs to a walked test. (test.each expands one AST assert into N cases, so
  // compare coveredAssertions — not extracted — to assertionsSeen.)
  if (assertionsSeen !== coveredAssertions) return { result: { ok: false, code: "OOP_CASES_UNSUPPORTED_ASSERT", detail: "uncounted" }, stats: stats(false) };
  if (cases.length === 0) return { result: { ok: false, code: "OOP_CASES_EMPTY" }, stats: stats(false) }; // m202-guard:empty
  if (cases.length > MAX_CASES) return { result: { ok: false, code: "OOP_CASES_NONLITERAL", detail: "too-many" }, stats: stats(false) };
  return { result: { ok: true, cases: P.freeze(cases) as readonly DataCase[], moduleHint }, stats: stats(true) };
}

/** The extraction result alone (see extractCasesWithStats). */
export function extractCasesFromSource(source: string, filePath = "test.ts"): ExtractResult {
  return extractCasesWithStats(source, filePath).result;
}

/** M204: a JSON case file's expect, validated to exactly the forms the judge implements (anything else: refused). */
function expectOf(e: any): CaseExpect | null {
  if (!e || typeof e !== "object" || P.isArray(e) || typeof e.ok !== "boolean") return null;
  const keys = P.keys(e);
  if (e.ok === true) {
    if (keys.some((k) => !["ok", "value", "cmp", "negate", "any"].includes(k))) return null;
    if (e.cmp !== undefined && e.cmp !== "is" && e.cmp !== "deep") return null;
    if (e.negate !== undefined && e.negate !== true) return null;
    if (e.any !== undefined && e.any !== true) return null;
    const prim = e.value === null || typeof e.value !== "object";
    if ((e.cmp === "is" || e.negate) && !prim) return null;
    if (e.any) return keys.length === 2 ? { ok: true, any: true } : null;
    if (!("value" in e)) return null;
    return { ok: true, value: e.value, ...(e.cmp ? { cmp: e.cmp } : {}), ...(e.negate ? { negate: true as const } : {}) };
  }
  if (keys.some((k) => k !== "ok" && k !== "error")) return null;
  if (e.error === undefined) return { ok: false };
  const er = e.error;
  if (!er || typeof er !== "object" || P.isArray(er) || P.keys(er).some((k) => !["isa", "name", "message", "includes"].includes(k))) return null;
  if (er.isa !== undefined && !(BUILTIN_ERRORS as readonly string[]).includes(er.isa)) return null;
  if (er.name !== undefined && typeof er.name !== "string") return null;
  if (er.includes !== undefined && typeof er.includes !== "string") return null;
  if (er.message !== undefined && typeof er.message !== "string") {
    const m = er.message;
    if (!m || typeof m !== "object" || typeof m.re !== "string" || typeof m.flags !== "string" || P.keys(m).length !== 2) return null;
    try { new RegExp(m.re, m.flags); } catch { return null; }
  }
  return { ok: false, error: er };
}

/** Load a JSON case file (version verifier-v1). */
export function loadCaseFile(path: string): ExtractResult & { module?: string } {
  let raw: string;
  try { raw = readFileSync(path, "utf8"); }
  catch { return { ok: false, code: "OOP_CASES_EMPTY", detail: "unreadable" }; }
  let obj: any;
  try { obj = P.parse(raw); }
  catch { return { ok: false, code: "OOP_CASES_NONLITERAL", detail: "bad-json" }; }
  if (!obj || obj.version !== VERIFIER_VERSION || typeof obj.module !== "string" || !P.isArray(obj.cases)) {
    return { ok: false, code: "OOP_CASES_NONLITERAL", detail: "shape" };
  }
  if (obj.cases.length === 0) return { ok: false, code: "OOP_CASES_EMPTY" };
  if (obj.cases.length > MAX_CASES) return { ok: false, code: "OOP_CASES_NONLITERAL", detail: "too-many" };
  const cases: DataCase[] = [];
  for (const c of obj.cases) {
    if (!c || typeof c.id !== "string" || typeof c.fn !== "string" || !P.isArray(c.args) || !c.expect || typeof c.expect.ok !== "boolean") {
      return { ok: false, code: "OOP_CASES_NONLITERAL", detail: "case-shape" };
    }
    if (c.recv !== undefined && c.recv !== "module") return { ok: false, code: "OOP_CASES_NONLITERAL", detail: "case-shape" };
    // args and expect.value must be JSON-serializable (re-parse roundtrip)
    try {
      const round = P.parse(P.stringify(c.args));
      if (!valuesEqual(round, c.args)) return { ok: false, code: "OOP_CASES_NONLITERAL", detail: "args" };
    } catch { return { ok: false, code: "OOP_CASES_NONLITERAL", detail: "args" }; }
    const expect = expectOf(c.expect);
    if (!expect) return { ok: false, code: "OOP_CASES_UNSUPPORTED_ASSERT", detail: "case-expect" };
    cases.push({ id: c.id, fn: c.fn, args: c.args, expect, ...(c.recv ? { recv: "module" as const } : {}) });
  }
  return { ok: true, cases, moduleHint: obj.module, module: obj.module };
}

// ---- run

function resolveModule(root: string, mod: string): string | null {
  const abs = isAbsolute(mod) ? mod : resolve(root, mod);
  if (!abs.startsWith(resolve(root))) return null; // m202-guard:module-under-root
  if (!existsSync(abs)) return null;
  return abs;
}

/** Ensure the candidate uid can traverse to `abs` (chmod +x on ancestors we own; +r on the file). */
function ensureCandReadable(abs: string): boolean {
  try {
    const root = resolve("/");
    let cur = dirname(abs);
    const chain: string[] = [];
    while (cur && cur !== root) { chain.push(cur); const parent = dirname(cur); if (parent === cur) break; cur = parent; }
    for (const d of chain.reverse()) {
      try { const st = spawnSync("stat", ["-c", "%u %a", d], { encoding: "utf8" });
        const [uid, mode] = (st.stdout ?? "").trim().split(/\s+/);
        const modeNum = mode ? parseInt(mode, 8) : NaN;
        if (Number(uid) === process.getuid!() && Number.isFinite(modeNum) && !(modeNum & 0o001)) chmodSync(d, modeNum | 0o011);
      } catch { /* best effort */ }
    }
    try { chmodSync(abs, 0o644); } catch { /* */ }
    return true;
  } catch { return false; }
}

function candPids(uid: number): number[] {
  return (spawnSync("ps", ["-e", "-o", "pid=,uid="], { encoding: "utf8" }).stdout ?? "")
    .split("\n").map((l) => l.trim().split(/\s+/)).filter((p) => p.length >= 2 && Number(p[1]) === uid).map((p) => Number(p[0])).filter((n) => n > 0);
}

function nodeDisableArgs(): string[] {
  // Prefer --disable-sigusr1 when the running node supports it (node 20.19+/22+/24+).
  const help = spawnSync(process.execPath, ["--help"], { encoding: "utf8", timeout: 10_000 });
  const args: string[] = [];
  if ((help.stdout ?? "").includes("--disable-sigusr1")) args.push("--disable-sigusr1"); // m202-guard:no-sigusr1
  return args;
}

// ---- the third uid (M204)

export const VERIFIER_UID_ENV = "PEACEAI_VERIFIER_UID" as const;
export interface VerifierUid { readonly name: string; readonly uid: number; readonly gid: number }
const idOf = (args: string[]): number | null => {
  const r = spawnSync("id", args, { encoding: "utf8" });
  const t = (r.stdout ?? "").trim();
  return r.status === 0 && /^\d+$/.test(t) ? Number(t) : null;
};
/** The uid that runs the judge: named by PEACEAI_VERIFIER_UID, a real non-root user that is neither the runner nor
 *  the candidate, reachable by `sudo -n -u`, and without sudo of its own (so it cannot become either). Fail-closed. */
export function verifierUid(env: Record<string, string | undefined>, cand: CandUid):
  { ok: true; v: VerifierUid } | { ok: false; code: "OOP_VERIFIER_REQUIRED" | "OOP_VERIFIER_BAD" | "OOP_VERIFIER_NOT_SEPARATE"; detail: string } {
  const name = env[VERIFIER_UID_ENV] ?? "";
  if (!name) return { ok: false, code: "OOP_VERIFIER_REQUIRED", detail: "unset" }; // m204-guard:verifier-required
  if (!/^[a-z_][a-z0-9_-]{0,31}$/.test(name)) return { ok: false, code: "OOP_VERIFIER_BAD", detail: "name" };
  const uid = idOf(["-u", name]);
  const gid = idOf(["-g", name]);
  if (uid === null || gid === null) return { ok: false, code: "OOP_VERIFIER_BAD", detail: "missing" };
  if (uid === 0) return { ok: false, code: "OOP_VERIFIER_NOT_SEPARATE", detail: "root" }; // m204-guard:verifier-root
  if (uid === (process.getuid?.() ?? -1)) return { ok: false, code: "OOP_VERIFIER_NOT_SEPARATE", detail: "runner" }; // m204-guard:verifier-vs-runner
  if (uid === cand.uid) return { ok: false, code: "OOP_VERIFIER_NOT_SEPARATE", detail: "cand" }; // m204-guard:verifier-vs-cand
  if (spawnSync("sudo", ["-n", "-u", name, "--", "true"], { stdio: "ignore", timeout: 20_000 }).status !== 0) return { ok: false, code: "OOP_VERIFIER_BAD", detail: "unreachable" };
  if (spawnSync("sudo", ["-n", "-u", name, "--", "sudo", "-n", "true"], { stdio: "ignore", timeout: 20_000 }).status === 0) return { ok: false, code: "OOP_VERIFIER_BAD", detail: "has-sudo" }; // (no third sudo-capable user on the box to test it: spec residual)
  return { ok: true, v: { name, uid, gid } };
}

/** The candidate uid's groups (for the permission check below). */
function groupsOf(name: string): Set<number> {
  const r = spawnSync("id", ["-G", name], { encoding: "utf8" });
  return new Set((r.stdout ?? "").trim().split(/\s+/).filter((x) => /^\d+$/.test(x)).map(Number));
}
/** Can `cand` write (or, owning it, chmod) `path`, judged from owner / group / mode bits? (ACLs: spec residual.) */
export function candMayWrite(path: string, cand: CandUid, candGids: ReadonlySet<number>): boolean {
  let st;
  try { st = statSync(path); } catch { return true; } // unknown: treat as writable (fail-closed)
  if (st.uid === cand.uid) return true; // m204-guard:perm-owner
  if (st.mode & 0o002) return true; // m204-guard:perm-other
  if ((st.mode & 0o020) && candGids.has(st.gid)) return true; // m204-guard:perm-group
  return false;
}

/**
 * Run data-only cases against a candidate module out-of-process.
 * Candidate = PEACEAI_STAGE2_CAND via sudo -n -u, env -i, harness only (one process per case). Runner = this
 * process: relays each raw outcome. Judge = verifier-judge.cjs as PEACEAI_VERIFIER_UID; its verdict file is the result.
 */
export function verify(o: VerifyOptions): VerifyResult {
  if (!o.cases.length) return { code: "OOP_CASES_EMPTY" }; // m202-guard:run-empty
  if (o.cases.length > MAX_CASES) return { code: "OOP_CASES_NONLITERAL", detail: "too-many" };
  const env = o.env ?? process.env;
  const cu = stage2CandUid(env);
  if (!cu.ok) return { code: cu.reason === "CAND_UID_REQUIRED" ? "OOP_CAND_REQUIRED" : "OOP_CAND_BAD", detail: cu.reason }; // m202-guard:cand
  const cand = cu.cand;
  const vu = verifierUid(env, cand);
  if (!vu.ok) return { code: vu.code, detail: vu.detail };
  const modAbs = resolveModule(o.root, o.module);
  if (!modAbs) return { code: "OOP_MODULE", detail: o.module }; // m202-guard:module
  ensureCandReadable(modAbs);
  try { chmodSync(resolve(o.root), 0o755); } catch { /* best effort */ }

  const callMs = Math.max(100, Math.floor(o.callMs ?? DEFAULT_CALL_MS));
  const sessionMs = Math.max(callMs, Math.floor(o.sessionMs ?? DEFAULT_SESSION_MS));
  const maxBytes = Math.max(256, Math.floor(o.maxLineBytes ?? MAX_LINE_BYTES));
  const maxDepth = Math.max(4, Math.floor(o.maxDepth ?? MAX_DEPTH));

  const work = mkdtempSync(join(tmpdir(), "peaceai-oop-"));
  const home = mkdtempSync(join(tmpdir(), "peaceai-oop-home-"));
  chmodSync(work, 0o755);
  try {
    for (const [from, to] of [[HARNESS_PATH, "harness.cjs"], [JUDGE_PATH, "judge.cjs"]] as const) {
      copyFileSync(from, join(work, to));
      chmodSync(join(work, to), 0o644);
    }
  } catch {
    cleanup(work, home, cand);
    return { code: "OOP_SPAWN", detail: "harness-copy" };
  }
  const outDir = join(work, "verdict");
  if (spawnSync("sudo", ["-n", "install", "-d", "-o", String(vu.v.uid), "-g", String(vu.v.gid), "-m", "0755", outDir], { stdio: "ignore" }).status !== 0) {
    cleanup(work, home, cand);
    return { code: "OOP_SPAWN", detail: "verdict-dir" };
  }
  // M204: the candidate must not own or be able to write the harness, the judge, their sources, the spec, or the
  // verdict directory; checked on every run, before the candidate runs.
  const gids = groupsOf(cand.name);
  const guarded: [string, string][] = [["work", work], ["harness", join(work, "harness.cjs")], ["judge", join(work, "judge.cjs")], ["verdict-dir", outDir],
    ["harness-src", HARNESS_PATH], ["judge-src", JUDGE_PATH], ["lib-src", fileURLToPath(import.meta.url)], ["spec", SPEC_PATH]];
  let writable: string | null = null;
  for (const [label, p] of guarded) if (writable === null && candMayWrite(p, cand, gids)) writable = label; // m204-guard:perm-check
  if (writable !== null) {
    cleanup(work, home, cand);
    return { code: "OOP_VERIFIER_BAD", detail: "cand-writable:" + writable };
  }
  const st = statSync(outDir);
  if (st.uid !== vu.v.uid) { cleanup(work, home, cand); return { code: "OOP_VERIFIER_BAD", detail: "verdict-dir-owner" }; }
  const runs = runCandidate(o, cand, modAbs, callMs, sessionMs, maxBytes, work, home);
  if ("code" in runs) { cleanup(work, home, cand); return runs; }
  const verdict = runJudge(vu.v, work, outDir, { cases: o.cases, runs: runs.runs, maxBytes, maxDepth });
  cleanup(work, home, cand);
  if (verdict.code === "OOP_OK") return { ...verdict, leftovers: runs.leftovers };
  return { ...verdict, ...(verdict.results ? { leftovers: runs.leftovers } : {}) };
}

/** The runner: one candidate process per case; collects each raw outcome. It decides nothing. */
function runCandidate(
  o: VerifyOptions, cand: CandUid, modAbs: string, callMs: number, sessionMs: number, maxBytes: number, work: string, home: string,
): { runs: RawRun[]; leftovers: number } | VerifyRefuse {
  const runs: RawRun[] = [];
  let leftovers = 0;
  const sessionDeadline = Date.now() + sessionMs;
  const harnessDst = join(work, "harness.cjs");
  try {
    if (spawnSync("sudo", ["-n", "chown", cand.name, home], { stdio: "ignore" }).status !== 0) return { code: "OOP_SPAWN", detail: "chown-home" };
    const nodeArgs = [...nodeDisableArgs(), harnessDst, modAbs];
    const envPairs = [`PATH=/usr/bin:/bin:${dirname(process.execPath)}`, `HOME=${home}`, `TMPDIR=${home}`, "NODE_OPTIONS=", "NODE_NO_WARNINGS=1"];
    for (let i = 0; i < o.cases.length; i++) {
      if (Date.now() > sessionDeadline) { runs.push({ status: null, stdout: "", timeout: true, session: true }); break; }
      const c = o.cases[i]!;
      const req = P.stringify({ v: 1, id: i + 1, fn: c.fn, args: c.args, ...(c.recv === "module" ? { recv: "module" } : {}) }) + "\n";
      if (Buffer.byteLength(req, "utf8") > maxBytes) return { code: "OOP_OVERSIZE", detail: "request" };
      const before = new Set(candPids(cand.uid));
      const r = spawnSync("sudo", ["-n", "-u", cand.name, "--", "env", "-i", ...envPairs, "setsid", "--wait", process.execPath, ...nodeArgs], {
        cwd: work, encoding: "utf8", input: req,
        timeout: Math.min(callMs, Math.max(100, sessionDeadline - Date.now())),
        killSignal: "SIGKILL", maxBuffer: maxBytes * 4, env: { PATH: process.env.PATH, LANG: "C" },
      });
      const after = candPids(cand.uid).filter((p) => !before.has(p));
      if (after.length) {
        leftovers += after.length;
        spawnSync("sudo", ["-n", "kill", "-KILL", ...after.map(String)], { stdio: "ignore" });
      }
      if ((r.error && (r.error as NodeJS.ErrnoException).code === "ETIMEDOUT") || r.status === null) {
        runs.push({ status: null, stdout: "", timeout: true });
        break;
      }
      runs.push({ status: r.status, stdout: r.stdout ?? "" });
    }
    return { runs, leftovers };
  } catch (e) {
    return { code: "OOP_SPAWN", detail: String(e).slice(0, 200) };
  }
}

/** The judge, as the verifier uid: stdin = the raw runs; output = <outDir>/verdict.json owned by that uid. */
function runJudge(v: VerifierUid, work: string, outDir: string, req: { cases: readonly DataCase[]; runs: readonly RawRun[]; maxBytes: number; maxDepth: number }): VerifyResult {
  const r = spawnSync("sudo", ["-n", "-u", v.name, "--", "env", "-i", `PATH=/usr/bin:/bin:${dirname(process.execPath)}`, "HOME=/nonexistent", "NODE_OPTIONS=",
    process.execPath, join(work, "judge.cjs"), outDir], {
    cwd: work, encoding: "utf8", input: P.stringify(req), timeout: JUDGE_MS, killSignal: "SIGKILL", maxBuffer: 1 << 20, env: { PATH: process.env.PATH, LANG: "C" },
  });
  if (r.status !== 0 || r.stdout !== "ok\n") return { code: "OOP_JUDGE", detail: r.status === null ? "timeout" : "exit" };
  const vf = join(outDir, "verdict.json");
  let st;
  try { st = statSync(vf); } catch { return { code: "OOP_JUDGE", detail: "no-verdict" }; }
  if (st.uid !== v.uid || (st.mode & 0o022) || !st.isFile()) return { code: "OOP_JUDGE", detail: "verdict-owner" }; // m204-guard:verdict-owner
  let verdict: any;
  try { verdict = P.parse(readFileSync(vf, "utf8")); } catch { return { code: "OOP_JUDGE", detail: "verdict-json" }; }
  if (!verdict || typeof verdict.code !== "string" || !(verdict.code === "OOP_OK" || (VERIFIER_REFUSALS as readonly string[]).includes(verdict.code))) {
    return { code: "OOP_JUDGE", detail: "verdict-shape" };
  }
  if (verdict.code === "OOP_OK" && !(P.isArray(verdict.results) && verdict.results.length === req.cases.length && P.isInteger(verdict.pass) && P.isInteger(verdict.fail))) {
    return { code: "OOP_JUDGE", detail: "verdict-shape" };
  }
  return verdict as VerifyResult; // m202-guard:ok
}

function cleanup(work: string, home: string, cand: CandUid): void {
  for (const p of candPids(cand.uid)) { try { spawnSync("sudo", ["-n", "kill", "-KILL", String(p)], { stdio: "ignore" }); } catch { /* */ } }
  spawnSync("sudo", ["-n", "rm", "-rf", "--", home], { stdio: "ignore" });
  spawnSync("sudo", ["-n", "rm", "-rf", "--", join(work, "verdict")], { stdio: "ignore" });
  try { rmSync(home, { recursive: true, force: true }); } catch { /* */ }
  try { rmSync(work, { recursive: true, force: true }); } catch { /* */ }
}

/** Digest of the verifier library + harness + judge (for rows / specs). */
export function verifierSha256(): string {
  const lib = readFileSync(fileURLToPath(new URL("./verifier.ts", import.meta.url)), "utf8");
  const har = readFileSync(HARNESS_PATH, "utf8");
  const jud = readFileSync(JUDGE_PATH, "utf8");
  return createHash("sha256").update(lib).update("\0").update(har).update("\0").update(jud).digest("hex");
}

export { STAGE2_CAND_ENV };
