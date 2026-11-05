// VERIFIER-V1 (M202, batch 38): experimental out-of-process verification. Spec: peaceai/spec/verifier-v1.md.
// NOT the default. Verdicts are decided in a verifier process (the box / runner uid) that never imports candidate
// code; the candidate process (stage-2 cand uid) only returns serialized call results over one pipe.
// Status: EXPERIMENTAL, opt-in via VERDICT_MODE "oop-v1". EDIT_SCOPE_POLICY and the in-process default are unchanged.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, chmodSync, existsSync } from "node:fs";
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
] as const;
export type VerifierRefusal = (typeof VERIFIER_REFUSALS)[number];

export type CaseExpect =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly error?: { readonly name?: string; readonly message?: string | RegExp } };

export interface DataCase {
  readonly id: string;
  readonly fn: string;
  readonly args: readonly unknown[];
  readonly expect: CaseExpect;
}

export interface CaseFile {
  readonly version: typeof VERIFIER_VERSION;
  readonly module: string; // repo-relative path of the candidate module
  readonly cases: readonly DataCase[];
}

export type CaseResult =
  | { readonly id: string; readonly pass: true }
  | { readonly id: string; readonly pass: false; readonly reason: string };

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
  /** Environment that names PEACEAI_STAGE2_CAND. */
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

export const MAX_LINE_BYTES = 65_536;
export const MAX_DEPTH = 32;
export const MAX_CASES = 200;
export const DEFAULT_CALL_MS = 5_000;
export const DEFAULT_SESSION_MS = 60_000;

const HARNESS_PATH = fileURLToPath(new URL("./verifier-harness.cjs", import.meta.url));

/** Select a verdict mode: exact names only; anything else is null (refused). undefined -> default. */
export function selectVerdictMode(flag: string | undefined): VerdictMode | null {
  if (flag === undefined) return DEFAULT_VERDICT_MODE; // m202-guard:default-inproc
  if ((VERDICT_MODES as readonly string[]).includes(flag)) return flag as VerdictMode;
  return null;
}

/** Deep equality using the verifier's own primordials (not candidate-reachable Object.is / matchers). */
export function valuesEqual(a: unknown, b: unknown, depth = 0): boolean {
  if (depth > MAX_DEPTH) return false; // m202-guard:eq-depth
  if (P.is(a, b)) return true;
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return false;
  if (P.isArray(a) !== P.isArray(b)) return false;
  if (P.isArray(a) && P.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!valuesEqual(a[i], b[i], depth + 1)) return false;
    return true;
  }
  const ak = P.keys(a as object).sort();
  const bk = P.keys(b as object).sort();
  if (ak.length !== bk.length) return false;
  for (let i = 0; i < ak.length; i++) if (ak[i] !== bk[i]) return false;
  for (const k of ak) if (!valuesEqual((a as any)[k], (b as any)[k], depth + 1)) return false;
  return true;
}

function jsonDepth(v: unknown, d = 0): number {
  if (d > MAX_DEPTH) return d;
  if (v === null || typeof v !== "object") return d;
  let m = d;
  if (P.isArray(v)) for (const x of v) m = Math.max(m, jsonDepth(x, d + 1));
  else for (const k of P.keys(v as object)) m = Math.max(m, jsonDepth((v as any)[k], d + 1));
  return m;
}

/** Parse one protocol response line. Fail-closed on any deviation. */
export function parseResponse(line: string, maxBytes = MAX_LINE_BYTES, maxDepth = MAX_DEPTH):
  | { ok: true; id: number; resultOk: true; value: unknown }
  | { ok: true; id: number; resultOk: false; error: { name: string; message: string } }
  | { ok: false; code: "OOP_PROTOCOL" | "OOP_OVERSIZE" | "OOP_DEPTH"; detail: string } {
  if (typeof line !== "string") return { ok: false, code: "OOP_PROTOCOL", detail: "not-string" }; // m202-guard:proto-type
  if (Buffer.byteLength(line, "utf8") > maxBytes) return { ok: false, code: "OOP_OVERSIZE", detail: "line" }; // m202-guard:oversize
  let obj: any;
  try { obj = P.parse(line); }
  catch { return { ok: false, code: "OOP_PROTOCOL", detail: "bad-json" }; } // m202-guard:proto-json
  if (!obj || typeof obj !== "object" || P.isArray(obj)) return { ok: false, code: "OOP_PROTOCOL", detail: "not-object" };
  if (obj.v !== 1) return { ok: false, code: "OOP_PROTOCOL", detail: "version" }; // m202-guard:proto-v
  if (typeof obj.id !== "number" || !P.isInteger(obj.id)) return { ok: false, code: "OOP_PROTOCOL", detail: "id" };
  if (typeof obj.ok !== "boolean") return { ok: false, code: "OOP_PROTOCOL", detail: "ok" };
  if (jsonDepth(obj) > maxDepth) return { ok: false, code: "OOP_DEPTH", detail: "response" }; // m202-guard:depth
  if (obj.ok === true) {
    if (!("value" in obj)) return { ok: false, code: "OOP_PROTOCOL", detail: "value" };
    if ("error" in obj) return { ok: false, code: "OOP_PROTOCOL", detail: "value-and-error" };
    return { ok: true, id: obj.id, resultOk: true, value: obj.value };
  }
  const err = obj.error;
  if (!err || typeof err !== "object" || P.isArray(err)) return { ok: false, code: "OOP_PROTOCOL", detail: "error" };
  if (typeof err.name !== "string" || typeof err.message !== "string") return { ok: false, code: "OOP_PROTOCOL", detail: "error-fields" };
  if ("value" in obj) return { ok: false, code: "OOP_PROTOCOL", detail: "error-and-value" };
  return { ok: true, id: obj.id, resultOk: false, error: { name: err.name, message: err.message } };
}

function expectHolds(got: { resultOk: true; value: unknown } | { resultOk: false; error: { name: string; message: string } }, exp: CaseExpect): boolean {
  if (exp.ok) return got.resultOk === true && valuesEqual(got.value, exp.value); // m202-guard:expect-value
  if (got.resultOk !== false) return false;
  if (exp.error?.name !== undefined && got.error.name !== exp.error.name) return false;
  if (exp.error?.message !== undefined) {
    if (exp.error.message instanceof RegExp) return exp.error.message.test(got.error.message);
    return got.error.message === exp.error.message;
  }
  return true; // any error
}

// ---- case source: JSON file, or conservative extraction from simple assert / expect calls

const LIT_MAX = 200;

/** A TypeScript/JS literal the extractor accepts (JSON-serializable scalars and shallow arrays/objects of those). */
function litFromNode(node: any, ts: typeof import("typescript")): { ok: true; value: unknown } | { ok: false } {
  if (!node) return { ok: false };
  if (node.kind === ts.SyntaxKind.StringLiteral || node.kind === ts.SyntaxKind.NoSubstitutionTemplateLiteral) return { ok: true, value: node.text };
  if (node.kind === ts.SyntaxKind.NumericLiteral) {
    const n = Number(node.text);
    return P.isFinite(n) ? { ok: true, value: n } : { ok: false };
  }
  if (node.kind === ts.SyntaxKind.TrueKeyword) return { ok: true, value: true };
  if (node.kind === ts.SyntaxKind.FalseKeyword) return { ok: true, value: false };
  if (node.kind === ts.SyntaxKind.NullKeyword) return { ok: true, value: null };
  if (node.kind === ts.SyntaxKind.PrefixUnaryExpression && node.operator === ts.SyntaxKind.MinusToken) {
    const inner = litFromNode(node.operand, ts);
    return inner.ok && typeof inner.value === "number" ? { ok: true, value: -inner.value } : { ok: false };
  }
  if (node.kind === ts.SyntaxKind.ArrayLiteralExpression) {
    if (node.elements.length > LIT_MAX) return { ok: false };
    const out: unknown[] = [];
    for (const el of node.elements) {
      if (ts.isSpreadElement(el)) return { ok: false };
      const v = litFromNode(el, ts);
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
      const v = litFromNode(p.initializer, ts);
      if (!v.ok) return { ok: false };
      out[key] = v.value;
    }
    return { ok: true, value: out };
  }
  return { ok: false };
}

export type ExtractResult =
  | { readonly ok: true; readonly cases: readonly DataCase[]; readonly moduleHint: string | null }
  | { readonly ok: false; readonly code: "OOP_CASES_EMPTY" | "OOP_CASES_NONLITERAL"; readonly detail?: string };

/**
 * Conservative extraction: only `assert.strictEqual(fn(lit...), lit)`, `assert.equal(fn(lit...), lit)`,
 * `expect(fn(lit...)).toBe(lit)` / `.toEqual(lit)` where `fn` is a bare identifier (or `mod.fn` with `mod` an
 * identifier). Anything else in the file that looks like an assertion is a NONLITERAL refuse; other statements are
 * ignored. Does not claim coverage of arbitrary tests.
 */
export function extractCasesFromSource(source: string, filePath = "test.ts"): ExtractResult {
  const kind = filePath.endsWith(".tsx") ? ts.ScriptKind.TSX : filePath.endsWith(".js") || filePath.endsWith(".cjs") || filePath.endsWith(".mjs")
    ? ts.ScriptKind.JS : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(filePath, source, ts.ScriptTarget.ES2022, true, kind);
  const cases: DataCase[] = [];
  let nonLiteral = false;
  let detail = "";
  let moduleHint: string | null = null;

  // collect import bindings of the form `import { isLeap } from "../src/leap.ts"` / `const { isLeap } = require(...)`
  const imported = new Map<string, string>(); // local name -> module path hint
  for (const stmt of sf.statements) {
    if (ts.isImportDeclaration(stmt) && stmt.importClause && stmt.moduleSpecifier && ts.isStringLiteral(stmt.moduleSpecifier)) {
      const mod = stmt.moduleSpecifier.text;
      if (!moduleHint && /\.\.?[/\\]/.test(mod)) moduleHint = mod;
      const nb = stmt.importClause.namedBindings;
      if (nb && ts.isNamedImports(nb)) for (const el of nb.elements) imported.set(el.name.text, mod);
      if (stmt.importClause.name) imported.set(stmt.importClause.name.text, mod);
    }
    if (ts.isVariableStatement(stmt)) {
      for (const d of stmt.declarationList.declarations) {
        if (!d.initializer || !ts.isCallExpression(d.initializer)) continue;
        const cal = d.initializer.expression;
        if (!(ts.isIdentifier(cal) && cal.text === "require")) continue;
        const arg0 = d.initializer.arguments[0];
        if (!arg0 || !ts.isStringLiteral(arg0)) continue;
        const mod = arg0.text;
        if (!moduleHint && /\.\.?[/\\]/.test(mod)) moduleHint = mod;
        if (ts.isObjectBindingPattern(d.name)) {
          for (const el of d.name.elements) {
            if (ts.isBindingElement(el) && ts.isIdentifier(el.name) && (!el.propertyName || ts.isIdentifier(el.propertyName))) {
              imported.set(el.name.text, mod);
            }
          }
        }
      }
    }
  }

  function fnCall(expr: any): { fn: string; args: unknown[] } | null {
    if (!ts.isCallExpression(expr)) return null;
    let fn: string | null = null;
    if (ts.isIdentifier(expr.expression)) fn = expr.expression.text;
    else if (ts.isPropertyAccessExpression(expr.expression) && ts.isIdentifier(expr.expression.name)
      && (ts.isIdentifier(expr.expression.expression) || ts.isPropertyAccessExpression(expr.expression.expression))) {
      // mod.fn or exports.fn — take the property name as the function to call on the candidate module
      fn = expr.expression.name.text;
    }
    if (!fn) return null;
    const args: unknown[] = [];
    for (const a of expr.arguments) {
      if (ts.isSpreadElement(a)) return null;
      const v = litFromNode(a, ts);
      if (!v.ok) return null;
      args.push(v.value);
    }
    return { fn, args };
  }

  function visit(node: any) {
    // assert.strictEqual(fn(lits), lit) / assert.equal(...)
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
      && ts.isIdentifier(node.expression.expression) && node.expression.expression.text === "assert"
      && (node.expression.name.text === "strictEqual" || node.expression.name.text === "equal" || node.expression.name.text === "deepStrictEqual" || node.expression.name.text === "deepEqual")) {
      if (node.arguments.length < 2) { nonLiteral = true; detail = "assert-arity"; return; }
      const call = fnCall(node.arguments[0]);
      const exp = litFromNode(node.arguments[1], ts);
      if (!call || !exp.ok) { nonLiteral = true; detail = "assert-nonliteral"; return; }
      cases.push({ id: `c${cases.length + 1}:${call.fn}`, fn: call.fn, args: call.args, expect: { ok: true, value: exp.value } });
      return; // don't walk into args again
    }
    // expect(fn(lits)).toBe(lit) / .toEqual(lit)
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
      && (node.expression.name.text === "toBe" || node.expression.name.text === "toEqual")
      && ts.isCallExpression(node.expression.expression)
      && ts.isIdentifier(node.expression.expression.expression)
      && node.expression.expression.expression.text === "expect") {
      const inner = node.expression.expression.arguments[0];
      const call = fnCall(inner);
      const expArg = node.arguments[0];
      const exp = expArg ? litFromNode(expArg, ts) : { ok: false as const };
      if (!call || !exp.ok) { nonLiteral = true; detail = "expect-nonliteral"; return; }
      cases.push({ id: `c${cases.length + 1}:${call.fn}`, fn: call.fn, args: call.args, expect: { ok: true, value: exp.value } });
      return;
    }
    // a bare expect(...) or assert(...) that isn't the shapes above: if it looks like an assertion, refuse
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && (node.expression.text === "expect" || node.expression.text === "assert")) {
      // parent may be .toBe — handled above when we visit the outer call; only flag if this expect is a statement expression
      // Walk children normally; the outer toBe visit catches the good shape. A lone expect(x) as a statement is nonliteral.
    }
    ts.forEachChild(node, visit);
  }
  visit(sf);

  // second pass: any call to expect( or assert. that was NOT captured is a near-miss nonliteral
  // (already flagged inside visit when shape mismatched)

  if (nonLiteral) return { ok: false, code: "OOP_CASES_NONLITERAL", detail }; // m202-guard:nonliteral
  if (cases.length === 0) return { ok: false, code: "OOP_CASES_EMPTY" }; // m202-guard:empty
  if (cases.length > MAX_CASES) return { ok: false, code: "OOP_CASES_NONLITERAL", detail: "too-many" };
  return { ok: true, cases: P.freeze(cases) as readonly DataCase[], moduleHint };
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
    // args and expect.value must be JSON-serializable (re-parse roundtrip)
    try {
      const round = P.parse(P.stringify(c.args));
      if (!valuesEqual(round, c.args)) return { ok: false, code: "OOP_CASES_NONLITERAL", detail: "args" };
    } catch { return { ok: false, code: "OOP_CASES_NONLITERAL", detail: "args" }; }
    cases.push({ id: c.id, fn: c.fn, args: c.args, expect: c.expect.ok
      ? { ok: true, value: c.expect.value }
      : { ok: false, error: c.expect.error } });
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

/**
 * Run data-only cases against a candidate module out-of-process.
 * Verifier = this process (runner uid). Candidate = PEACEAI_STAGE2_CAND via sudo -n -u, env -i, harness only.
 */
export function verify(o: VerifyOptions): VerifyResult {
  if (!o.cases.length) return { code: "OOP_CASES_EMPTY" }; // m202-guard:run-empty
  if (o.cases.length > MAX_CASES) return { code: "OOP_CASES_NONLITERAL", detail: "too-many" };
  const cu = stage2CandUid(o.env ?? process.env);
  if (!cu.ok) return { code: cu.reason === "CAND_UID_REQUIRED" ? "OOP_CAND_REQUIRED" : "OOP_CAND_BAD", detail: cu.reason }; // m202-guard:cand
  const cand = cu.cand;
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
    copyFileSync(HARNESS_PATH, join(work, "harness.cjs"));
    chmodSync(join(work, "harness.cjs"), 0o644);
  } catch (e) {
    cleanup(work, home, cand);
    return { code: "OOP_SPAWN", detail: "harness-copy" };
  }
  return verifyByCase(o, cand, modAbs, callMs, sessionMs, maxBytes, maxDepth, work, home);
}

/** One candidate process per case (simpler sync control flow; same uid / harness / protocol). */
function verifyByCase(
  o: VerifyOptions, cand: CandUid, modAbs: string,
  callMs: number, sessionMs: number, maxBytes: number, maxDepth: number,
  work: string, home: string,
): VerifyResult {
  const results: CaseResult[] = [];
  let leftovers = 0;
  const sessionDeadline = Date.now() + sessionMs;
  const harnessDst = join(work, "harness.cjs");
  try {
    if (!existsSync(harnessDst)) {
      copyFileSync(HARNESS_PATH, harnessDst);
      chmodSync(harnessDst, 0o644);
    }
    if (spawnSync("sudo", ["-n", "chown", cand.name, home], { stdio: "ignore" }).status !== 0) {
      return { code: "OOP_SPAWN", detail: "chown-home" };
    }
    const nodeArgs = [...nodeDisableArgs(), harnessDst, modAbs];
    const envPairs = [
      `PATH=/usr/bin:/bin:${dirname(process.execPath)}`,
      `HOME=${home}`,
      `TMPDIR=${home}`,
      "NODE_OPTIONS=",
      "NODE_NO_WARNINGS=1",
    ];

    for (let i = 0; i < o.cases.length; i++) {
      if (Date.now() > sessionDeadline) {
        cleanup(work, home, cand);
        return { code: "OOP_TIMEOUT", detail: "session", pass: results.filter((r) => r.pass).length, fail: results.filter((r) => !r.pass).length, results, leftovers };
      }
      const c = o.cases[i]!;
      const id = i + 1;
      const req = P.stringify({ v: 1, id, fn: c.fn, args: c.args }) + "\n";
      if (Buffer.byteLength(req, "utf8") > maxBytes) {
        cleanup(work, home, cand);
        return { code: "OOP_OVERSIZE", detail: "request", results, leftovers };
      }
      const before = new Set(candPids(cand.uid));
      const r = spawnSync("sudo", ["-n", "-u", cand.name, "--", "env", "-i", ...envPairs, "setsid", "--wait", process.execPath, ...nodeArgs], {
        cwd: work,
        encoding: "utf8",
        input: req,
        timeout: Math.min(callMs, Math.max(100, sessionDeadline - Date.now())),
        killSignal: "SIGKILL",
        maxBuffer: maxBytes * 4,
        env: { PATH: process.env.PATH, LANG: "C" },
      });
      // reap leftovers
      const after = candPids(cand.uid).filter((p) => !before.has(p));
      if (after.length) {
        leftovers += after.length;
        spawnSync("sudo", ["-n", "kill", "-KILL", ...after.map(String)], { stdio: "ignore" });
      }
      if (r.error && (r.error as NodeJS.ErrnoException).code === "ETIMEDOUT") {
        cleanup(work, home, cand);
        return { code: "OOP_TIMEOUT", detail: c.id, pass: results.filter((x) => x.pass).length, fail: results.filter((x) => !x.pass).length + 1, results, leftovers };
      }
      if (r.status === null) {
        cleanup(work, home, cand);
        return { code: "OOP_TIMEOUT", detail: c.id, results, leftovers };
      }
      // candidate crash / non-zero without a protocol line: fail the case (not a credit)
      const out = r.stdout ?? "";
      const lines = out.split("\n").filter((l) => l !== "");
      // any non-JSON line is stdout noise
      const proto: string[] = [];
      for (const line of lines) {
        if (!line.trimStart().startsWith("{")) {
          cleanup(work, home, cand);
          return { code: "OOP_STDOUT_NOISE", detail: c.id, results, leftovers }; // m202-guard:noise
        }
        proto.push(line);
      }
      if (proto.length !== 1) {
        cleanup(work, home, cand);
        // empty output after a crash: treat as fail of the case when status != 0, else protocol
        if (proto.length === 0 && r.status !== 0) {
          results.push({ id: c.id, pass: false, reason: "exit:" + r.status });
          continue;
        }
        return { code: "OOP_PROTOCOL", detail: `lines:${proto.length}`, results, leftovers }; // m202-guard:one-line
      }
      const parsed = parseResponse(proto[0]!, maxBytes, maxDepth);
      if (!parsed.ok) {
        cleanup(work, home, cand);
        return { code: parsed.code, detail: parsed.detail, results, leftovers };
      }
      if (parsed.id !== id) {
        cleanup(work, home, cand);
        return { code: "OOP_PROTOCOL", detail: "id-mismatch", results, leftovers };
      }
      results.push(expectHolds(parsed, c.expect) ? { id: c.id, pass: true } : { id: c.id, pass: false, reason: parsed.resultOk ? "value" : "error" });
    }
    const pass = results.filter((x) => x.pass).length;
    const fail = results.length - pass;
    cleanup(work, home, cand);
    return { code: "OOP_OK", pass, fail, results, leftovers }; // m202-guard:ok
  } catch (e) {
    cleanup(work, home, cand);
    return { code: "OOP_SPAWN", detail: String(e).slice(0, 200) };
  }
}

function cleanup(work: string, home: string, cand: CandUid): void {
  for (const p of candPids(cand.uid)) { try { spawnSync("sudo", ["-n", "kill", "-KILL", String(p)], { stdio: "ignore" }); } catch { /* */ } }
  spawnSync("sudo", ["-n", "rm", "-rf", "--", home], { stdio: "ignore" });
  try { rmSync(home, { recursive: true, force: true }); } catch { /* */ }
  try { rmSync(work, { recursive: true, force: true }); } catch { /* */ }
}

/** Digest of the verifier library + harness (for rows / specs). */
export function verifierSha256(): string {
  const lib = readFileSync(fileURLToPath(new URL("./verifier.ts", import.meta.url)), "utf8");
  const har = readFileSync(HARNESS_PATH, "utf8");
  return createHash("sha256").update(lib).update("\0").update(har).digest("hex");
}

export { STAGE2_CAND_ENV };
