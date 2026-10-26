// M114 (public-derive-from-behavior-v5): the string-parsing extension of PeaceAI's derive engine (derive.ts).
// v1-v3 derive scalar functions from comparisons, arithmetic and labels; they cannot read a field out of a line. This
// module derives small pure STRING-PARSING functions from examples alone, the same way: a bounded enumeration over a
// small typed DSL, every constant taken from the examples, and a refusal instead of a guess.
//
// Inputs: the text `s` (the first parameter, a string), plus at most ONE more parameter `q`: a number (a field
// index) or a string (a prefix, suffix or needle). Results: string, number, boolean or string[].
// The DSL (B is s or s.trim(); d is ONE non-alphanumeric character that occurs in the example texts; X is a piece of
// B, optionally .trim()-ed after it is cut):
//   X        : B | B.split(d)[i] ?? D (field i, D when the line has fewer fields; i a literal 0-5 or q)
//            | B.slice(B.lastIndexOf(d) + 1) (the last field) | B.split(d).length > i ? B.split(d).slice(i).join(d) : D
//              (everything from field i on, delimiters kept) | B.startsWith(P) ? B.slice(n) : B (strip prefix P)
//            | B.endsWith(P) ? B.slice(0, B.length - n) : B (strip suffix P); P a literal from the examples or q
//   string   : X
//   number   : /^-?\d{1,12}$/.test(X) ? Number(X) : D (strict integer) | Number.isSafeInteger(Number.parseInt(X, 10))
//              ? Number.parseInt(X, 10) : D (lenient) | B.split(d).length (field count) | X.length
//   boolean  : X.startsWith(C) | X.endsWith(C) | X.includes(C) | X === C, each also negated (C a literal common to the
//              examples on one side, or q) | /^-?\d{1,12}$/.test(X), also negated
//   string[] : B.split(d), optionally .map((v) => v.trim()), optionally .filter((v) => v !== "")
// Inside a number or boolean result a missing field reads as "". The only regular expression is the fixed literal
// /^-?\d{1,12}$/; no regex is ever built from input, nothing loops (split / slice / join / trim / includes are
// bounded by the input length), nothing is written, and no global but Number is read.
//
// Fail closed, in this order:
//   derive_examples          1-40 examples, every value typed as declared, strings printable ASCII without quotes or
//                            backslashes and at most DERIVE_MAX_STRING chars, no contradiction;
//   derive_under_specified_outputs: at least 2 distinct results (a boolean: DERIVE_MIN_REACH of each); a string
//                            result that is not the first argument unchanged on every example;
//   derive_budget            more than STR_MAX_FITS fitting programs or STR_MAX_PROBES probes;
//   derive_no_fit            no program fits every example;
//   derive_ambiguous         two fitting programs give different results on some probe, with up to 3 rows it asks
//                            for. Every fitting program is run on the probes, but the probes are a finite sample
//                            of variants of the examples, so two fits that differ only on inputs no probe covers
//                            are not told apart. That no in-vocabulary rival is missed rests on sampled harnesses
//                            (the m114 tests and the seeded and random harnesses), not on a proof. Auditor #530
//                            found one such rival: s.split(d)[i] vs s.trim().split(d)[i] when field i is the last
//                            field of a padded line, now probed by the first i+1 fields padded;
//   derive_under_specified_unread: q is never read;
//   derive_under_specified_path: the fit has a fallback the examples never take: a field or tail that can be missing
//                            (every example has it), a strip whose prefix is on every example (or on none), an
//                            integer parse that never fails (or never succeeds); a split on a delimiter that gives
//                            no example two non-empty fields (Auditor #530); a split no example's result depends
//                            on: the fit gives the same result on every example as when the line is read as one
//                            field (Auditor #530 R2); with the row it asks for. A fit that reads the whole line is
//                            not gated: a split on a delimiter that is in no example cannot be seen (a known limit).
// A default D (the missing-field result, the failed-parse result) is never chosen silently: when no example takes
// that path, every candidate D ("" and each example result; 0 and -1 for a number) is a rival, so the task is refused
// as derive_ambiguous (or, failing that, by the path gate).
// Programs that agree on every probe are one behavior; the smallest that passes the gates is emitted.
// strExprProblem re-checks emitted text (Job A and Job B): it re-enumerates the DSL over the literals the text
// itself contains and accepts only a program that compiles to the identical text.
import ts from "typescript";
import { DERIVE_MAX_STRING, DERIVE_MIN_REACH } from "./derive.ts";

export type StrRet = "string" | "number" | "boolean" | "string[]";
export type StrArg = string | number;
export type StrOut = string | number | boolean | readonly string[];
export interface StrParam { name: string; type: "string" | "number" }
export interface StrExample { args: StrArg[]; out: StrOut }
export interface StrInput { params: StrParam[]; ret: StrRet; examples: StrExample[] }

export type Piece =
  | { k: "whole" }
  | { k: "field"; d: string; i: number | "q" }
  | { k: "last"; d: string }
  | { k: "rest"; d: string; i: number }
  | { k: "strip"; side: "prefix" | "suffix"; p: string | "q" };
export interface XNode { trim: boolean; piece: Piece; post: boolean }
export type StrProgram =
  | { op: "str"; x: XNode; dflt: string }
  | { op: "int"; x: XNode; lenient: boolean; dflt: number }
  | { op: "count"; trim: boolean; d: string }
  | { op: "len"; x: XNode }
  | { op: "test"; x: XNode; test: "starts" | "ends" | "has" | "eq"; c: string | "q"; neg: boolean }
  | { op: "isint"; x: XNode; neg: boolean }
  | { op: "split"; trim: boolean; d: string; each: boolean; drop: boolean };

export type StrGate = "outputs" | "unread" | "path";
export interface StrQuestion { at: StrArg[]; answers: StrOut[] }
export type StrResult =
  | { ok: true; program: StrProgram; size: number; searched: number; probes: number }
  | { ok: false; reason: "derive_examples" | "derive_budget" | "derive_no_fit" | "derive_ambiguous"; detail: string; questions?: StrQuestion[] }
  | { ok: false; reason: "derive_under_specified"; gate: StrGate; detail: string; questions?: StrQuestion[] };

export const STR_MAX_EXAMPLES = 40;
export const STR_MAX_PARAMS = 2;
/** Most field indices (0 .. STR_MAX_FIELD) and delimiters the search tries. */
export const STR_MAX_FIELD = 5;
export const STR_MAX_DELIMS = 8;
/** Longest literal prefix / suffix / needle the search tries (eq constants may be up to DERIVE_MAX_STRING). */
export const STR_MAX_CONST = 24;
export const STR_MAX_FITS = 20_000;
export const STR_MAX_PROBES = 20_000;
/** Probe-by-behavior cells the asked-row chooser may score per row. */
export const STR_ASK_SCAN = 400_000;
/** Extra string-q probe values cut from the example lines at a delimiter. */
export const STR_MAX_QCUTS = 150;
/** The one regular expression the DSL emits (a literal; never built from input). */
export const STR_INT_RE = String.raw`/^-?\d{1,12}$/`;
const INT_RE = /^-?\d{1,12}$/;
const MAX_INT = 1e12;

/** A string an issue can write as an example literal: printable ASCII without `"` or `\`, at most DERIVE_MAX_STRING. */
export const writable = (s: string): boolean => s.length <= DERIVE_MAX_STRING && /^[ !#-[\]-~]*$/.test(s);
const isInt = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && Math.abs(v) <= MAX_INT;
const DELIM = /^[ !#-/:-@[\]^_`{-~]$/;
export const outKey = (v: StrOut | undefined): string => JSON.stringify(v ?? null);

// ---------------------------------------------------------------------------------------------------------------
// Evaluation (the compiled text below computes exactly this; m114 tests compare the two on random programs)

type Path = "miss" | "have" | "strip-yes" | "strip-no" | "int-ok" | "int-fail";
type Hook = (p: Path) => void;
const canMiss = (p: Piece): boolean => (p.k === "field" && p.i !== 0) || p.k === "rest";

function evalX(x: XNode, s: string, q: StrArg | undefined, dflt: string, hook?: Hook): string {
  const b = x.trim ? s.trim() : s;
  const p = x.piece;
  let v: string;
  if (p.k === "whole") v = b;
  else if (p.k === "field") {
    const parts = b.split(p.d);
    const f = parts[(p.i === "q" ? q : p.i) as number];
    if (canMiss(p)) hook?.(f === undefined ? "miss" : "have");
    v = f ?? (p.i === 0 ? "" : dflt);
  } else if (p.k === "last") v = b.slice(b.lastIndexOf(p.d) + 1);
  else if (p.k === "rest") {
    const parts = b.split(p.d);
    hook?.(parts.length > p.i ? "have" : "miss");
    v = parts.length > p.i ? parts.slice(p.i).join(p.d) : dflt;
  } else {
    const c = (p.p === "q" ? q : p.p) as string;
    const yes = p.side === "prefix" ? b.startsWith(c) : b.endsWith(c);
    hook?.(yes ? "strip-yes" : "strip-no");
    v = !yes ? b : p.side === "prefix" ? b.slice(c.length) : b.slice(0, b.length - c.length);
  }
  return x.post ? v.trim() : v;
}

export function evalStr(prog: StrProgram, args: readonly StrArg[], hook?: Hook): StrOut {
  const s = args[0] as string, q = args[1];
  switch (prog.op) {
    case "str": return evalX(prog.x, s, q, prog.dflt, hook);
    case "int": {
      const v = evalX(prog.x, s, q, "", hook);
      if (prog.lenient) { const n = Number.parseInt(v, 10); const ok = Number.isSafeInteger(n); hook?.(ok ? "int-ok" : "int-fail"); return ok ? n : prog.dflt; }
      const ok = INT_RE.test(v); hook?.(ok ? "int-ok" : "int-fail"); return ok ? Number(v) : prog.dflt;
    }
    case "count": return (prog.trim ? s.trim() : s).split(prog.d).length;
    case "len": return evalX(prog.x, s, q, "", hook).length;
    case "test": {
      const v = evalX(prog.x, s, q, "", hook), c = (prog.c === "q" ? q : prog.c) as string;
      const r = prog.test === "starts" ? v.startsWith(c) : prog.test === "ends" ? v.endsWith(c) : prog.test === "has" ? v.includes(c) : v === c;
      return prog.neg ? !r : r;
    }
    case "isint": { const r = INT_RE.test(evalX(prog.x, s, q, "", hook)); return prog.neg ? !r : r; }
    case "split": {
      let parts = (prog.trim ? s.trim() : s).split(prog.d);
      if (prog.each) parts = parts.map((v) => v.trim());
      if (prog.drop) parts = parts.filter((v) => v !== "");
      return parts;
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Compile

const L = (s: string) => JSON.stringify(s);
/** True when `t` has no top-level `??` or `?:` (string literal contents and bracketed parts are skipped). */
function simpleText(t: string): boolean {
  let depth = 0, str = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i]!;
    if (str) { if (c === '"') str = false; continue; }
    if (c === '"') str = true;
    else if (c === "(" || c === "[") depth++;
    else if (c === ")" || c === "]") depth--;
    else if (depth === 0 && c === "?" && t[i - 1] === " ") return false;
  }
  return true;
}
const atom = (t: string) => (simpleText(t) ? t : `(${t})`);

function compileX(x: XNode, names: readonly string[], dflt: string | null): string {
  const s = names[0]!, q = names[1] ?? "";
  const b = x.trim ? `${s}.trim()` : s;
  const p = x.piece;
  let t: string;
  if (p.k === "whole") t = b;
  else if (p.k === "field") t = `${b}.split(${L(p.d)})[${p.i === "q" ? q : p.i}] ?? ${L(p.i === 0 ? "" : dflt ?? "")}`;
  else if (p.k === "last") t = `${b}.slice(${b}.lastIndexOf(${L(p.d)}) + 1)`;
  else if (p.k === "rest") t = `${b}.split(${L(p.d)}).length > ${p.i} ? ${b}.split(${L(p.d)}).slice(${p.i}).join(${L(p.d)}) : ${L(dflt ?? "")}`;
  else {
    const c = p.p === "q" ? q : L(p.p), n = p.p === "q" ? `${q}.length` : String(p.p.length);
    t = p.side === "prefix" ? `${b}.startsWith(${c}) ? ${b}.slice(${n}) : ${b}` : `${b}.endsWith(${c}) ? ${b}.slice(0, ${b}.length - ${n}) : ${b}`;
  }
  return x.post ? `${atom(t)}.trim()` : t;
}

/** The TypeScript expression of a program over the parameter names (s first, then q). */
export function compileStr(prog: StrProgram, names: readonly string[]): string {
  const s = names[0]!, q = names[1] ?? "";
  switch (prog.op) {
    case "str": return compileX(prog.x, names, prog.dflt);
    case "int": {
      const x = compileX(prog.x, names, null);
      return prog.lenient ? `Number.isSafeInteger(Number.parseInt(${x}, 10)) ? Number.parseInt(${x}, 10) : ${prog.dflt}` : `${STR_INT_RE}.test(${x}) ? Number(${x}) : ${prog.dflt}`;
    }
    case "count": return `${prog.trim ? `${s}.trim()` : s}.split(${L(prog.d)}).length`;
    case "len": return `${atom(compileX(prog.x, names, null))}.length`;
    case "test": {
      const x = atom(compileX(prog.x, names, null)), c = prog.c === "q" ? q : L(prog.c);
      if (prog.test === "eq") return `${x} ${prog.neg ? "!==" : "==="} ${c}`;
      return `${prog.neg ? "!" : ""}${x}.${prog.test === "starts" ? "startsWith" : prog.test === "ends" ? "endsWith" : "includes"}(${c})`;
    }
    case "isint": return `${prog.neg ? "!" : ""}${STR_INT_RE}.test(${compileX(prog.x, names, null)})`;
    case "split": return `${prog.trim ? `${s}.trim()` : s}.split(${L(prog.d)})${prog.each ? ".map((v) => v.trim())" : ""}${prog.drop ? '.filter((v) => v !== "")' : ""}`;
  }
}

const pieceSize = (p: Piece) => (p.k === "whole" ? 0 : p.k === "field" ? 1 : p.k === "last" ? 2 : p.k === "rest" ? 3 : 2);
const xSize = (x: XNode) => (x.trim ? 1 : 0) + (x.post ? 1 : 0) + pieceSize(x.piece);
export function strSize(p: StrProgram): number {
  switch (p.op) {
    case "str": return 1 + xSize(p.x);
    case "int": return 3 + xSize(p.x) + (p.lenient ? 1 : 0);
    case "count": return 2 + (p.trim ? 1 : 0);
    case "len": return 2 + xSize(p.x);
    case "test": return 2 + xSize(p.x) + (p.neg ? 1 : 0) + (p.test === "eq" ? 0 : 1);
    case "isint": return 3 + xSize(p.x) + (p.neg ? 1 : 0);
    case "split": return 1 + (p.trim ? 1 : 0) + (p.each ? 1 : 0) + (p.drop ? 1 : 0);
  }
}

/** True when the program reads q. */
export function readsQ(p: StrProgram): boolean {
  if (p.op === "test" && p.c === "q") return true;
  if (!("x" in p)) return false;
  const pc = p.x.piece;
  return (pc.k === "field" && pc.i === "q") || (pc.k === "strip" && pc.p === "q");
}

/** The delimiter a program splits its line on (with whether it trims the line first), or null. */
function splitOn(p: StrProgram): { trim: boolean; d: string } | null {
  if (p.op === "count" || p.op === "split") return { trim: p.trim, d: p.d };
  if ("x" in p && (p.x.piece.k === "field" || p.x.piece.k === "last" || p.x.piece.k === "rest")) return { trim: p.x.trim, d: p.x.piece.d };
  return null;
}

/** The program with its split made a no-op (a delimiter no writable line holds): the line read as one field. */
const NO_DELIM = "\u0001";
function oneField(p: StrProgram): StrProgram {
  if (p.op === "count" || p.op === "split") return { ...p, d: NO_DELIM };
  if ("x" in p && (p.x.piece.k === "field" || p.x.piece.k === "last" || p.x.piece.k === "rest")) return { ...p, x: { ...p.x, piece: { ...p.x.piece, d: NO_DELIM } } } as StrProgram;
  return p;
}

/** The fallback paths a program has (each must be taken by some example). */
function pathsOf(p: StrProgram): Path[][] {
  const out: Path[][] = [];
  if ("x" in p) {
    if (canMiss(p.x.piece)) out.push(["miss", "have"]);
    if (p.x.piece.k === "strip") out.push(["strip-yes", "strip-no"]);
  }
  if (p.op === "int") out.push(["int-ok", "int-fail"]);
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Enumeration (shared by the search and the re-check; the pools differ)

interface Pools {
  q: "number" | "string" | null;
  delims: string[];
  fields: number;
  strips: string[];
  strDefaults: (x: XNode) => string[];
  intDefaults: number[];
  consts: (x: XNode, test: "starts" | "ends" | "has" | "eq", neg: boolean) => string[];
}

function pieces(P: Pools, strips: boolean): Piece[] {
  const out: Piece[] = [{ k: "whole" }];
  for (const d of P.delims) {
    for (let i = 0; i < P.fields; i++) out.push({ k: "field", d, i });
    if (P.q === "number") out.push({ k: "field", d, i: "q" });
    out.push({ k: "last", d });
    for (let i = 1; i < P.fields; i++) out.push({ k: "rest", d, i });
  }
  if (strips) {
    const cs: (string | "q")[] = [...P.strips, ...(P.q === "string" ? ["q" as const] : [])];
    for (const p of cs) for (const side of ["prefix", "suffix"] as const) out.push({ k: "strip", side, p });
  }
  return out;
}
function xs(P: Pools, strips: boolean): XNode[] {
  const out: XNode[] = [];
  for (const piece of pieces(P, strips)) for (const trim of [false, true]) for (const post of [false, true]) {
    if (piece.k === "whole" && post) continue; // the same text as trimming B
    out.push({ trim, piece, post });
  }
  return out;
}

function* enumerate(ret: StrRet, P: Pools): Generator<StrProgram> {
  if (ret === "string") for (const x of xs(P, true)) {
    const ds = canMiss(x.piece) ? P.strDefaults(x) : [""];
    for (const dflt of ds) yield { op: "str", x, dflt };
  }
  if (ret === "number") {
    for (const x of xs(P, false)) for (const lenient of [false, true]) for (const dflt of P.intDefaults) yield { op: "int", x, lenient, dflt };
    for (const d of P.delims) for (const trim of [false, true]) yield { op: "count", trim, d };
    for (const x of xs(P, false)) yield { op: "len", x };
  }
  if (ret === "boolean") for (const x of xs(P, false)) {
    for (const test of ["eq", "starts", "ends", "has"] as const) for (const neg of [false, true]) {
      for (const c of P.consts(x, test, neg)) yield { op: "test", x, test, c, neg };
      if (P.q === "string") yield { op: "test", x, test, c: "q", neg };
    }
    for (const neg of [false, true]) yield { op: "isint", x, neg };
  }
  if (ret === "string[]") for (const d of P.delims) for (const trim of [false, true]) for (const each of [false, true]) for (const drop of [false, true]) yield { op: "split", trim, d, each, drop };
}

// ---------------------------------------------------------------------------------------------------------------
// Re-check of emitted text

/** Null when `text` is exactly the compiled text of a v5 program over these parameters with this result type. */
export function strExprProblem(text: string, params: readonly StrParam[], ret: StrRet): string | null {
  return decompileStr(text, params, ret) ? null : "derive_string_expr";
}
/** The program whose compiled text is exactly `text` (enumerated over the literals the text contains), or null. */
export function decompileStr(text: string, params: readonly StrParam[], ret: StrRet): StrProgram | null {
  if (params.length < 1 || params.length > STR_MAX_PARAMS || params[0]!.type !== "string" || text.length > 400) return null;
  const sf = ts.createSourceFile("e.ts", `(${text});`, ts.ScriptTarget.Latest, true);
  if ((sf as unknown as { parseDiagnostics: unknown[] }).parseDiagnostics.length || sf.statements.length !== 1) return null;
  const strs = new Set<string>(), nums = new Set<number>();
  let bad = false;
  const walk = (n: ts.Node): void => {
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) { if (!writable(n.text)) bad = true; strs.add(n.text); }
    else if (ts.isNumericLiteral(n)) { const v = Number(n.text); if (!isInt(v)) bad = true; nums.add(v); nums.add(-v); }
    else if (ts.isRegularExpressionLiteral(n) && n.text !== STR_INT_RE) bad = true;
    n.forEachChild(walk);
  };
  walk(sf);
  if (bad || strs.size > 6 || nums.size > 12) return null;
  const names = params.map((p) => p.name);
  const lits = [...strs];
  const P: Pools = {
    q: (params[1]?.type ?? null) as Pools["q"],
    delims: lits.filter((s) => DELIM.test(s)),
    fields: Math.min(STR_MAX_FIELD + 1, Math.max(1, ...[...nums].filter((n) => n >= 0 && n <= STR_MAX_FIELD).map((n) => n + 1))),
    strips: lits.filter((s) => s.length > 0 && s.length <= STR_MAX_CONST),
    strDefaults: () => lits,
    intDefaults: [...nums],
    consts: (_x, test) => lits.filter((s) => (test === "eq" ? true : s.length > 0 && s.length <= STR_MAX_CONST)),
  };
  for (const prog of enumerate(ret, P)) if (validProgram(prog, params) && compileStr(prog, names) === text) return prog;
  return null;
}

/** Structural validity of a program (literals in range, q of the right type). */
export function validProgram(p: StrProgram, params: readonly StrParam[]): boolean {
  const q = params[1]?.type ?? null;
  const okX = (x: XNode): boolean => {
    const c = x.piece;
    if (c.k === "field") return DELIM.test(c.d) && (c.i === "q" ? q === "number" : Number.isInteger(c.i) && c.i >= 0 && c.i <= STR_MAX_FIELD);
    if (c.k === "last") return DELIM.test(c.d);
    if (c.k === "rest") return DELIM.test(c.d) && Number.isInteger(c.i) && c.i >= 1 && c.i <= STR_MAX_FIELD;
    if (c.k === "strip") return c.p === "q" ? q === "string" : c.p.length > 0 && c.p.length <= STR_MAX_CONST && writable(c.p);
    return true;
  };
  switch (p.op) {
    case "str": return okX(p.x) && writable(p.dflt) && (canMiss(p.x.piece) || p.dflt === "") && (!p.x.post || p.dflt === p.dflt.trim());
    case "int": return okX(p.x) && p.x.piece.k !== "strip" && isInt(p.dflt);
    case "count": case "split": return DELIM.test(p.d);
    case "len": case "isint": return okX(p.x) && p.x.piece.k !== "strip";
    case "test": return okX(p.x) && p.x.piece.k !== "strip" && (p.c === "q" ? q === "string" : writable(p.c) && (p.test === "eq" || (p.c.length > 0 && p.c.length <= STR_MAX_CONST)));
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Search

export function strExamplesProblem(input: StrInput): string | null {
  const { params, ret, examples } = input;
  if (params.length < 1 || params.length > STR_MAX_PARAMS || params[0]!.type !== "string") return "params";
  if (!["string", "number", "boolean", "string[]"].includes(ret)) return "ret";
  if (examples.length < 1 || examples.length > STR_MAX_EXAMPLES) return "count";
  const seen = new Map<string, string>();
  for (const ex of examples) {
    if (ex.args.length !== params.length) return "arity";
    for (const [i, a] of ex.args.entries()) if (params[i]!.type === "string" ? typeof a !== "string" || !writable(a) : !isInt(a)) return "arg_type";
    const o = ex.out;
    const okOut = ret === "string" ? typeof o === "string" && writable(o) : ret === "number" ? isInt(o) : ret === "boolean" ? typeof o === "boolean" : Array.isArray(o) && o.length <= 64 && o.every((v) => typeof v === "string" && writable(v));
    if (!okOut) return "out_type";
    const k = JSON.stringify(ex.args), prev = seen.get(k);
    if (prev !== undefined && prev !== outKey(o)) return "contradiction";
    seen.set(k, outKey(o));
  }
  return null;
}

const uniq = <T>(xs: readonly T[]): T[] => [...new Set(xs)];
const byCount = (xs: readonly string[]): string[] => { const m = new Map<string, number>(); for (const x of xs) m.set(x, (m.get(x) ?? 0) + 1); return [...m.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).map((e) => e[0]); };
const commonPrefix = (vs: readonly string[]) => vs.reduce((a, v) => { let i = 0; while (i < a.length && i < v.length && a[i] === v[i]) i++; return a.slice(0, i); });
const commonSuffix = (vs: readonly string[]) => vs.reduce((a, v) => { let i = 0; while (i < a.length && i < v.length && a[a.length - 1 - i] === v[v.length - 1 - i]) i++; return a.slice(a.length - i); });

/** The search pools a set of examples gives. */
function searchPools(input: StrInput): Pools {
  const { params, ret, examples } = input;
  const texts = examples.map((e) => e.args[0] as string);
  const delims = byCount(texts.flatMap((t) => [...t].filter((c) => DELIM.test(c)))).slice(0, STR_MAX_DELIMS);
  let fields = 1;
  for (const d of delims) for (const t of texts) fields = Math.max(fields, Math.min(STR_MAX_FIELD + 1, t.split(d).length));
  const strOuts = ret === "string" ? uniq(examples.map((e) => e.out as string)) : [];
  const strips: string[] = [];
  if (ret === "string") for (const e of examples) for (const b of [e.args[0] as string, (e.args[0] as string).trim()]) {
    const o = e.out as string;
    for (const oo of uniq([o, o.trim()])) {
      if (b.length > oo.length && b.endsWith(oo)) strips.push(b.slice(0, b.length - oo.length));
      if (b.length > oo.length && b.startsWith(oo)) strips.push(b.slice(oo.length));
    }
  }
  const numOuts = ret === "number" ? uniq(examples.map((e) => e.out as number)) : [];
  const q = (params[1]?.type ?? null) as Pools["q"];
  const xCache = new Map<string, string[]>();
  const xVals = (x: XNode): string[] => {
    const k = JSON.stringify(x);
    let v = xCache.get(k);
    if (!v) { v = examples.map((e) => evalX(x, e.args[0] as string, e.args[1], "")); xCache.set(k, v); }
    return v;
  };
  return {
    q, delims, fields,
    strips: byCount(strips.flatMap((p) => uniq([p, p.trim(), p.trimStart(), p.trimEnd()])).filter((p) => p.length > 0 && p.length <= STR_MAX_CONST && writable(p))).slice(0, 12),
    strDefaults: (x) => uniq(["", ...strOuts]).filter((d) => !x.post || d === d.trim()).slice(0, 14),
    intDefaults: uniq([0, -1, ...numOuts]).slice(0, 14),
    consts: (x, test, neg) => {
      if (ret !== "boolean") return [];
      const vals = xVals(x);
      const pos = vals.filter((_, i) => examples[i]!.out === !neg);
      if (!pos.length) return [];
      if (test === "eq") return pos.every((v) => v === pos[0]) && writable(pos[0]!) ? [pos[0]!] : [];
      if (test === "starts") { const c = commonPrefix(pos).slice(0, STR_MAX_CONST); return Array.from({ length: c.length }, (_, i) => c.slice(0, i + 1)); }
      if (test === "ends") { const c = commonSuffix(pos); return Array.from({ length: Math.min(c.length, STR_MAX_CONST) }, (_, i) => c.slice(c.length - 1 - i)); }
      const short = pos.reduce((a, v) => (v.length < a.length ? v : a));
      const out = new Set<string>();
      for (let i = 0; i < short.length; i++) for (let j = i + 1; j <= Math.min(short.length, i + STR_MAX_CONST); j++) {
        const c = short.slice(i, j);
        if (!out.has(c) && pos.every((v) => v.includes(c))) out.add(c);
      }
      return [...out];
    },
  };
}

const FILLERS = ["", "zz", "12", "-7", "12x", " 12", "+5", "1e3", "007", "99999999999999", "x12", " "];

/** Probe inputs: variants of every example (padding, fewer and more fields, odd field values) and of the constants. */
function probeInputs(input: StrInput, P: Pools, consts: readonly string[]): StrArg[][] {
  const { params, examples } = input;
  const texts = new Set<string>();
  const add = (t: string) => { if (writable(t)) texts.add(t); };
  for (const t of ["", " ", ...consts, ...consts.map((c) => ` ${c} `)]) add(t);
  for (const e of examples) {
    const t = e.args[0] as string;
    for (const v of [t, ` ${t} `, ` ${t}`, `${t} `, t.trim(), t.slice(1), t.slice(0, -1), `~${t}`, `${t}~`]) add(v);
    for (const d of P.delims) {
      const f = t.split(d);
      // the first k fields alone, bare and padded (Auditor #530 (1)): s.split(d)[i] and s.trim().split(d)[i] differ
      // only when field i is the LAST field of a padded line, which padding the whole line or cutting it alone never shows
      for (let k = 1; k <= f.length; k++) { const c = f.slice(0, k).join(d); add(c); add(` ${c}`); add(`${c} `); add(` ${c} `); }
      for (const v of [`${t}${d}zz`, `${t}${d}`, `${d}${t}`, `${t}${d}${d}`, `${t}${d} `]) add(v);
      for (let j = 0; j < f.length && j <= STR_MAX_FIELD + 1; j++) {
        const w = (x: string) => add([...f.slice(0, j), x, ...f.slice(j + 1)].join(d));
        for (const x of FILLERS) w(x);
        w(` ${f[j]} `); w(`${f[j]}${d}${f[j]}`);
        for (const c of consts) w(c);
      }
    }
    for (const c of consts) {
      if (!c) continue;
      add(c + t); add(t + c); add(`${c} ${t}`);
      const at = t.indexOf(c);
      if (at < 0) continue;
      const r = (x: string) => add(t.slice(0, at) + x + t.slice(at + c.length));
      r(""); r(`${c}~`); r(`~${c}`); r(c.toUpperCase()); r(c.toLowerCase()); r(` ${c} `);
      for (let k = 1; k < c.length; k++) { r(`${c.slice(0, k)}~`); r(`~${c.slice(k)}`); r(c.slice(0, k)); r(c.slice(k)); }
    }
  }
  const out: StrArg[][] = [];
  if (params.length === 1) for (const t of texts) out.push([t]);
  else {
    const qs = new Set<StrArg>();
    for (const e of examples) qs.add(e.args[1]!);
    if (params[1]!.type === "number") for (let i = -1; i <= P.fields + 1; i++) qs.add(i);
    else {
      for (const e of examples) { const v = e.args[1] as string; for (const x of ["", v.slice(1), v.slice(0, -1), ` ${v}`, `${v}~`, v.toUpperCase()]) if (writable(x)) qs.add(x); }
      for (const c of consts) qs.add(c);
    }
    const qList = [...qs];
    // every text with each example's own q, and the example texts with every q
    for (const t of texts) for (const e of examples) out.push([t, e.args[1]!]);
    for (const e of examples) for (const q of qList) { out.push([e.args[0]!, q]); out.push([` ${e.args[0] as string} `, q]); }
    for (const q of qList) for (const t of [...texts].slice(0, 400)) out.push([t, q]);
    if (params[1]!.type === "string") {
      // q values cut from the example lines at a delimiter (a field with its delimiter, the fields) and each
      // example q with a delimiter on either side: they tell a test on a field from the same test on the line,
      // which a q holding the delimiter alone can do; paired with the example lines only (bounded by STR_MAX_QCUTS)
      const cuts = new Set<string>();
      const cut = (x: string) => { if (x && writable(x) && !qs.has(x) && cuts.size < STR_MAX_QCUTS) cuts.add(x); };
      for (const e of examples) for (const d of P.delims) { const v = e.args[1] as string; cut(`${v}${d}`); cut(`${d}${v}`); }
      for (const e of examples) for (const d of P.delims) {
        const f = (e.args[0] as string).split(d);
        if (f.length < 2) continue;
        cut(`${f[0]}${d}`); cut(`${d}${f[f.length - 1]}`);
        for (let j = 0; j < f.length && j <= STR_MAX_FIELD; j++) { cut(f[j]!); cut(f[j]!.trim()); }
      }
      for (const e of examples) for (const q of cuts) out.push([e.args[0]!, q]);
    }
  }
  const seen = new Set<string>();
  return out.filter((a) => { const k = JSON.stringify(a); if (seen.has(k)) return false; seen.add(k); return true; });
}

const constsOf = (p: StrProgram): string[] => {
  const out: string[] = [];
  if ("x" in p && p.x.piece.k === "strip" && p.x.piece.p !== "q") out.push(p.x.piece.p);
  if (p.op === "test" && p.c !== "q") out.push(p.c);
  if (p.op === "str" && p.dflt) out.push(p.dflt);
  return out;
};

const order = (a: { size: number; text: string }, b: { size: number; text: string }) => a.size - b.size || a.text.length - b.text.length || (a.text < b.text ? -1 : a.text > b.text ? 1 : 0);

/** Derives the one string-parsing program the examples allow, or refuses. */
export function deriveStringProgram(input: StrInput): StrResult {
  const bad = strExamplesProblem(input);
  if (bad) return { ok: false, reason: "derive_examples", detail: bad };
  const { params, ret, examples } = input;
  const outs = examples.map((e) => outKey(e.out));
  if (ret === "boolean") {
    const t = examples.filter((e) => e.out === true).length, f = examples.length - t;
    if (t < DERIVE_MIN_REACH || f < DERIVE_MIN_REACH) return { ok: false, reason: "derive_under_specified", gate: "outputs", detail: `needs at least ${DERIVE_MIN_REACH} examples giving true and ${DERIVE_MIN_REACH} giving false` };
  } else if (new Set(outs).size < 2) return { ok: false, reason: "derive_under_specified", gate: "outputs", detail: "every example gives the same result" };
  // a string parser whose every example returns its first argument unchanged shows nothing it removes or picks: the
  // bare argument would fit, and a strip or pick that no example exercises is never in the pools, so refuse
  if (ret === "string" && examples.every((e) => e.out === e.args[0])) return { ok: false, reason: "derive_under_specified", gate: "outputs", detail: `every example returns ${params[0]!.name} unchanged; add an example that shows what the parser changes` };
  const P = searchPools(input);
  const names = params.map((p) => p.name);
  const fits: StrProgram[] = [];
  let searched = 0;
  for (const prog of enumerate(ret, P)) {
    searched++;
    if (!validProgram(prog, params)) continue;
    let ok = true;
    for (let i = 0; i < examples.length && ok; i++) if (outKey(evalStr(prog, examples[i]!.args)) !== outs[i]) ok = false;
    if (!ok) continue;
    fits.push(prog);
    if (fits.length > STR_MAX_FITS) return { ok: false, reason: "derive_budget", detail: `more than ${STR_MAX_FITS} programs fit` };
  }
  if (!fits.length) return { ok: false, reason: "derive_no_fit", detail: `no program of the v5 string DSL fits every example (${searched} searched)` };
  const consts = uniq([...fits.flatMap(constsOf), ...P.strips]).filter((c) => c.length <= STR_MAX_CONST);
  const probes = probeInputs(input, P, consts);
  if (probes.length > STR_MAX_PROBES) return { ok: false, reason: "derive_budget", detail: `more than ${STR_MAX_PROBES} probes` };
  // group the fits by their results on every probe
  const groups = new Map<string, { progs: StrProgram[]; vals: StrOut[] }>();
  for (const prog of fits) {
    const vals = probes.map((a) => evalStr(prog, a));
    const k = vals.map(outKey).join("\u0001");
    const g = groups.get(k);
    if (g) g.progs.push(prog); else groups.set(k, { progs: [prog], vals });
  }
  const gs = [...groups.values()];
  if (gs.length > 1) return { ok: false, reason: "derive_ambiguous", detail: `${gs.length} different behaviors fit every example (${fits.length} programs)`, questions: askRows(probes, gs.map((g) => g.vals)) };
  const ranked = gs[0]!.progs.map((p) => ({ p, size: strSize(p), text: compileStr(p, names) })).sort(order);
  let first: StrResult | null = null;
  for (const r of ranked) {
    const g = gateProblem(r.p, input, probes);
    if (!g) return { ok: true, program: r.p, size: r.size, searched, probes: probes.length };
    first ??= g;
  }
  return first!;
}

/** Up to 3 probes that split the behaviors, each with the results the behaviors give there. */
function askRows(probes: readonly StrArg[][], vals: readonly StrOut[][]): StrQuestion[] {
  const out: StrQuestion[] = [];
  // classes of behaviors not yet told apart by a chosen probe
  let classes: number[][] = [vals.map((_, i) => i)];
  const splitBy = (cs: number[][], j: number) => cs.flatMap((c) => { const m = new Map<string, number[]>(); for (const i of c) { const k = outKey(vals[i]![j]); m.set(k, [...(m.get(k) ?? []), i]); } return [...m.values()]; });
  // greedy: each asked row is the probe that tells the most behaviors apart (the first such probe on a tie),
  // so one round can drop a whole family of rivals; the scan is bounded by STR_ASK_SCAN cells
  const scan = Math.max(1, Math.floor(STR_ASK_SCAN / Math.max(1, vals.length)));
  while (out.length < 3 && classes.length) {
    let best = -1, bestN = 0;
    for (let j = 0, seen = 0; j < probes.length && seen < scan; j++) {
      if (!classes.some((c) => new Set(c.map((i) => outKey(vals[i]![j]))).size > 1)) continue;
      seen++;
      const n = splitBy(classes, j).length;
      if (n > bestN) { best = j; bestN = n; }
    }
    if (best < 0) break;
    const answers = uniq(vals.map((v) => outKey(v[best]))).slice(0, 4).map((k) => JSON.parse(k) as StrOut);
    out.push({ at: probes[best]!, answers });
    classes = splitBy(classes, best).filter((c) => c.length > 1);
  }
  return out;
}

function gateProblem(prog: StrProgram, input: StrInput, probes: readonly StrArg[][]): StrResult | null {
  const { params, examples } = input;
  if (params.length === 2 && !readsQ(prog)) return { ok: false, reason: "derive_under_specified", gate: "unread", detail: `the fit never reads ${params[1]!.name}` };
  // Auditor #530 (2): a fit that splits on d where no example's line has two non-empty fields on d (d is absent, or
  // only at an edge: the "-" of "-3", a padding space) shows nothing about d: the examples fit a split on any such
  // delimiter (or none), and the one they were written for may be in no example
  const sd = splitOn(prog);
  const twoFields = (t: string) => (sd!.trim ? t.trim() : t).split(sd!.d).filter((f) => f !== "").length > 1;
  if (sd && !examples.some((e) => twoFields(e.args[0] as string))) {
    const at = probes.find((a) => twoFields(a[0] as string));
    const v = at ? evalStr(prog, at) : undefined;
    return { ok: false, reason: "derive_under_specified", gate: "path", detail: `no example's line has two non-empty fields on ${JSON.stringify(sd.d)}; add an example with the delimiter the parser splits on`, questions: at && v !== undefined ? [{ at, answers: [v, "?"] }] : [] };
  }
  // Auditor #530 R2: a fit that splits must show the split in some example's result: the same program reading the
  // line as one field (split on a delimiter no line holds) must give a different result on some example. Otherwise
  // every example reads the same with or without the split (the delimiter is in the lines but never moves a result,
  // or the field it picks is always the whole line or always missing), so the split, and its delimiter, are a guess
  if (sd) {
    const one = oneField(prog);
    const shows = (a: readonly StrArg[]) => outKey(evalStr(prog, a)) !== outKey(evalStr(one, a));
    if (!examples.some((e) => shows(e.args))) {
      const at = probes.find(shows);
      return { ok: false, reason: "derive_under_specified", gate: "path", detail: `no example's result depends on the split on ${JSON.stringify(sd.d)}; add an example whose result the split changes`, questions: at ? [{ at, answers: uniq([evalStr(prog, at), evalStr(one, at)].map(outKey)).map((k) => JSON.parse(k) as StrOut) }] : [] };
    }
  }
  const seen = new Set<Path>();
  for (const e of examples) evalStr(prog, e.args, (p) => seen.add(p));
  for (const pair of pathsOf(prog)) for (const path of pair) {
    if (seen.has(path)) continue;
    const at = probes.find((a) => { let hit = false; evalStr(prog, a, (p) => { if (p === path) hit = true; }); return hit; });
    const v = at ? evalStr(prog, at) : undefined;
    const alt: StrOut[] = typeof v === "number" ? [v, v === 0 ? -1 : 0] : typeof v === "boolean" ? [v, !v] : typeof v === "string" ? uniq([v, "", at![0] as string]) : [];
    return { ok: false, reason: "derive_under_specified", gate: "path", detail: `no example takes the ${path} path of the fit`, questions: at && v !== undefined ? [{ at, answers: alt.length > 1 ? alt : [v, "?"] }] : [] };
  }
  return null;
}

/** The probe table shown in the review note: the program's result on the first `n` probes no example shows. */
export function strProbeTable(prog: StrProgram, input: StrInput, n: number): { args: StrArg[]; out: StrOut }[] {
  const P = searchPools(input);
  const shown = new Set(input.examples.map((e) => JSON.stringify(e.args)));
  return probeInputs(input, P, uniq([...constsOf(prog), ...P.strips])).filter((a) => !shown.has(JSON.stringify(a))).slice(0, n).map((args) => ({ args, out: evalStr(prog, args) }));
}

/** A literal as written in an issue example or a test: "text", 12, true, ["a", "b"]. */
export function strLit(v: StrOut): string {
  if (Array.isArray(v)) return `[${v.map((x) => JSON.stringify(x)).join(", ")}]`;
  return typeof v === "string" ? JSON.stringify(v) : String(v);
}

/** The example line values: scalar args (string / integer), `gives`, then a scalar or a list of strings. */
export function lexStrValues(text: string): { values: StrArg[]; out: StrOut } | null {
  const toks: (string | number | boolean | "," | "gives" | "[" | "]" | { s: string })[] = [];
  let s = text.trim().replace(/\.$/, "");
  while (s.length) {
    let m: RegExpExecArray | null;
    if ((m = /^"([ !#-[\]-~]*)"/.exec(s))) toks.push({ s: m[1]! });
    else if ((m = /^-?(?:0|[1-9]\d{0,11})(?![\w.])/.exec(s))) toks.push(Number(m[0]));
    else if ((m = /^(?:true|false)\b/.exec(s))) toks.push(m[0] === "true");
    else if ((m = /^[,[\]]/.exec(s))) toks.push(m[0] as "," | "[" | "]");
    else if ((m = /^gives\b/.exec(s))) toks.push("gives");
    else return null;
    s = s.slice(m[0].length).replace(/^ +/, "");
  }
  const g = toks.indexOf("gives");
  if (g < 1 || toks.lastIndexOf("gives") !== g) return null;
  const values: StrArg[] = [];
  for (let i = 0; i < g; i++) {
    const t = toks[i]!;
    if (i % 2 === 1) { if (t !== ",") return null; continue; }
    if (typeof t === "object") values.push(t.s);
    else if (typeof t === "number") values.push(t);
    else return null;
  }
  if (g % 2 !== 1) return null;
  const rest = toks.slice(g + 1);
  if (rest.length === 1) {
    const t = rest[0]!;
    if (typeof t === "object") return { values, out: t.s };
    if (typeof t === "number" || typeof t === "boolean") return { values, out: t };
    return null;
  }
  if (rest[0] !== "[" || rest.at(-1) !== "]") return null;
  const inner = rest.slice(1, -1), list: string[] = [];
  for (let i = 0; i < inner.length; i++) {
    const t = inner[i]!;
    if (i % 2 === 1) { if (t !== ",") return null; continue; }
    if (typeof t !== "object") return null;
    list.push(t.s);
  }
  if (inner.length && inner.length % 2 === 0) return null;
  return { values, out: list };
}

/** A literal argument or expected value as buildDeriveStringEdit writes it, else undefined. */
export function strLitValue(e: ts.Expression): StrOut | undefined {
  if (ts.isNumericLiteral(e)) return Number(e.text);
  if (ts.isPrefixUnaryExpression(e) && e.operator === ts.SyntaxKind.MinusToken && ts.isNumericLiteral(e.operand)) return -Number(e.operand.text);
  if (ts.isStringLiteral(e)) return e.text;
  if (e.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (e.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (ts.isArrayLiteralExpression(e)) { const v = e.elements.map((x) => (ts.isStringLiteral(x) ? x.text : undefined)); return v.every((x) => x !== undefined) ? (v as string[]) : undefined; }
  return undefined;
}
