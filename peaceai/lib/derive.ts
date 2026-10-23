// M99 (DERIVE_FROM_BEHAVIOR v1): PeaceAI's own program search. Given a new pure function's typed signature and
// input -> output examples (data only, never code), it writes the function body itself: a bounded, enumerative,
// bottom-up search over a small typed DSL, keeping one program per distinct behavior on a fixed point set (the
// examples, neighbour probes around each example and far probes: 0, +-1, the outermost edges +-10 / +-100, ten times
// the largest value, cross products). It takes the SMALLEST program that fits every example and then accepts it only
// when the examples SHOW what it relies on (gateProblem); otherwise it refuses instead of guessing:
//   - derive_no_fit           nothing up to the size limit fits every example (or the only fit reads no parameter);
//   - derive_ambiguous        another program, at most DERIVE_SLACK nodes larger than the smallest fit, also fits
//                             every example but disagrees with it on a probe;
//   - derive_under_specified  a witness gate fails (gate unread, chars, edge, far, branch, cap, rival, rival_budget),
//                             with the parameter and the examples to add (Auditor #491: confidently wrong programs);
//   - derive_budget           the search budget (DERIVE_BUDGET programs, or MAX_KEPT_CELLS kept values) ran out;
//   - derive_examples         contradictory, mistyped or out-of-range examples.
// The DSL (typed; the size of a program is its node count, leaves count 1):
//   number : parameter | 1 | 2 | a + b | a - b | a * b | sq(a) | min(K, a) | max(K, a) | if(G, x, y) (x, y may be K)
//   string : parameter | L | a + b (concat) | if(G, x, y)
//   boolean: parameter | p == C | p <= C | C <= p | lo <= p <= hi | p == q | p <= q | s is empty
//            | a && b | a || b | !a
//   if-guards G (conditional on emptiness or equality only): s is empty | p == C
//   Every constant comes from the EXAMPLES; the behavior prose is never read here (it only names the module,
//   function and signature, in learned-derive.ts):
//   C (compared with a parameter): an edge the examples witness, i.e. an argument value v where two examples
//     that differ only in that argument, by exactly 1 (v and v + 1), give different results; both v and v + 1;
//   K (cap / constant result): an integer result that at least two examples produce;
//   L: string pieces of the example outputs (outputs with the example's non-empty string arguments cut out)
//   that at least two examples produce, plus "".
//   No memorizing: a string parameter is only ever tested for emptiness (never against a literal), and an integer
//   is only compared with a parameter where the examples show the result changing right there, so a lookup table
//   of arbitrary example inputs is not in the search space (such tasks are derive_no_fit instead of a wrong fit).
// Compiled programs are plain TypeScript expressions over the parameters and literals only: no globals at all (min /
// max compile to conditionals, so not even Math), no calls, no member or computed access, no regex, no I/O, no
// timers, no constructor / eval / prototype paths, at most DERIVE_MAX_EXPR_CHARS characters with string literals of
// at most DERIVE_MAX_STRING. That is a strict subset of the #489 allowlist (parameters / locals, fresh literals, a
// short list of pure globals): it uses none of the globals. derivedExprProblem re-checks it on the TypeScript AST
// (used by Job A and Job B).
// Reusable: #489 (existing-function edit) can call deriveProgram for a behavior-only statement change.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import ts from "typescript";

export type DeriveType = "number" | "string" | "boolean";
export type DeriveValue = number | string | boolean;
export interface DeriveParam { name: string; type: DeriveType }
export interface DeriveExample { args: DeriveValue[]; out: DeriveValue }
export interface DeriveInput {
  params: readonly DeriveParam[];
  ret: DeriveType;
  examples: readonly DeriveExample[];
  /** Largest program size searched (node count). */
  maxSize?: number;
  /** Most programs built before the search gives up (derive_budget). */
  budget?: number;
  /** Extra sizes searched past the first fit for a competing behavior (at most DERIVE_SLACK; default it). */
  slack?: number;
  /** Memory bound in kept values (programs x points); clamped to MAX_KEPT_CELLS (default it). */
  maxKeptCells?: number;
}
export type DeriveNode =
  | { op: "param"; i: number }
  | { op: "int"; v: number }
  | { op: "lit"; v: number | string }
  | { op: "add" | "sub" | "mul" | "cat" | "and" | "or"; a: DeriveNode; b: DeriveNode }
  | { op: "sq" | "not"; a: DeriveNode }
  | { op: "min" | "max"; c: number; a: DeriveNode }
  | { op: "eq" | "le"; a: DeriveNode; b: DeriveNode }
  | { op: "range"; i: number; lo: number; hi: number }
  | { op: "empty"; i: number }
  | { op: "if"; c: DeriveNode; t: DeriveNode; e: DeriveNode };
export interface DeriveFit { program: DeriveNode; size: number; expr: string }
export type DeriveResult =
  | { ok: true; fit: DeriveFit; probes: DeriveValue[][]; searched: number }
  | { ok: false; reason: "derive_no_fit" | "derive_ambiguous" | "derive_budget" | "derive_examples" | "derive_under_specified" | "derive_unevidenced_form"; detail?: string; gate?: DeriveGate; param?: string; alternatives?: DeriveFit[]; probe?: DeriveValue[]; questions?: DeriveQuestion[]; forms?: DeriveForm[]; searched: number };

export const DERIVE_MAX_SIZE = 13;
export const DERIVE_BUDGET = 4_000_000;
export const DERIVE_MAX_EXAMPLES = 40;
export const DERIVE_MAX_PARAMS = 3;
/** A fit is accepted only if no other behavior fits within this many extra nodes. */
export const DERIVE_SLACK = 1;
export const DERIVE_MAX_STRING = 120;
/** Longest compiled expression (characters); longer is refused (derive_expr_size), so the module is bounded. */
export const DERIVE_MAX_EXPR_CHARS = 400;
/** Most points (examples + neighbour probes + far probes) a value vector covers. */
const MAX_POINTS = 600;
/**
 * Memory bound: total values (kept programs x points) the search holds; past it the search stops (derive_budget,
 * or rival_budget in the rival search). Kept vectors are deduplicated by a 106-bit hash of their JSON (vectorKey),
 * so memory is the vectors themselves, not their text.
 */
export const MAX_KEPT_CELLS = 32_000_000;
/** The memory bound a search runs under: the caller's value, never above MAX_KEPT_CELLS. */
export function keptCellsLimit(input: Pick<DeriveInput, "maxKeptCells">): number {
  return Math.min(input.maxKeptCells ?? MAX_KEPT_CELLS, MAX_KEPT_CELLS);
}
const MAX_INT = 1e12;
/** Far-domain distance: an open true region needs an example at least this far past its edge (gate 1). */
/** A bounded region of the program is shown with no gap between consecutive examples wider than 1 / DERIVE_REGION_PARTS of it. */
export const DERIVE_REGION_PARTS = 8;
/** ...but a gap of up to DERIVE_REGION_MIN_GAP is always allowed (a region 9 wide is shown by 3 examples, not 9). */
export const DERIVE_REGION_MIN_GAP = 4;
export const DERIVE_FAR = 100;
/** The rival search (gate 3) runs this many sizes past the accepted program, over every example constant. */
export const DERIVE_RIVAL_EXTRA = 2;
/** Every branch and each side of a cap must be reached by at least this many examples (gate 2). */
export const DERIVE_MIN_REACH = 2;
const FAR_ABS = 1e9;

type V = DeriveValue | null;
interface Prog { node: DeriveNode; size: number; vals: V[]; usesParam: boolean }

const isInt = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && Math.abs(v) <= MAX_INT;
const typeOf = (v: DeriveValue): DeriveType => (typeof v === "number" ? "number" : typeof v === "string" ? "string" : "boolean");
const keyOf = (vals: readonly (V | undefined)[]): string => JSON.stringify(vals);
/**
 * The dedupe key of a value vector: two independent 53-bit hashes (cyrb53-style mixing, different seeds) over a
 * typed walk of its values (tag, then the number's two 32-bit halves / the string's length and characters), plus
 * the vector length. No JSON text is built; a collision (about n^2 / 2^107 for n kept vectors) can only merge two
 * behaviors, never invent one.
 */
const vectorKey = (vals: readonly V[]): string => {
  let a1 = 0xdeadbeef, a2 = 0x41c6ce57, b1 = 0x9e3779b9 ^ 0xdeadbeef, b2 = 0x9e3779b9 ^ 0x41c6ce57;
  const mix = (c: number) => {
    a1 = Math.imul(a1 ^ c, 2654435761); a2 = Math.imul(a2 ^ c, 1597334677);
    b1 = Math.imul(b1 ^ c, 2246822519); b2 = Math.imul(b2 ^ c, 3266489917);
  };
  for (const v of vals) {
    if (v === null) mix(0x6e756c6c);
    else if (typeof v === "boolean") mix(v ? 0x74727565 : 0x66616c73);
    else if (typeof v === "number") { mix(0x6e756d00); mix(v | 0); mix(Math.floor(v / 4294967296) | 0); }
    else { mix(0x73747200); mix(v.length); for (let i = 0; i < v.length; i++) mix(v.charCodeAt(i)); }
  }
  const fin = (h1: number, h2: number) => {
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
  };
  return fin(a1, a2) + ":" + fin(b1, b2) + ":" + vals.length.toString(36);
};

/** Problems with the examples themselves (types, ranges, contradictions); null when they are usable. */
export function examplesProblem(input: DeriveInput): string | null {
  const { params, ret, examples } = input;
  if (params.length === 0 || params.length > DERIVE_MAX_PARAMS) return "params";
  if (examples.length < 3 || examples.length > DERIVE_MAX_EXAMPLES) return "count";
  const seen = new Map<string, string>();
  for (const ex of examples) {
    if (ex.args.length !== params.length) return "arity";
    for (const [i, a] of ex.args.entries()) if (typeOf(a) !== params[i]!.type || (typeof a === "number" && !isInt(a)) || (typeof a === "string" && a.length > DERIVE_MAX_STRING)) return "arg_type";
    if (typeOf(ex.out) !== ret || (typeof ex.out === "number" && !isInt(ex.out)) || (typeof ex.out === "string" && ex.out.length > DERIVE_MAX_STRING)) return "out_type";
    const k = keyOf(ex.args), o = keyOf([ex.out]);
    if (seen.has(k) && seen.get(k) !== o) return "contradiction";
    seen.set(k, o);
  }
  // Examples that all give the same result show no behavior to derive (any consistent test would be a guess).
  if (new Set(examples.map((e) => keyOf([e.out]))).size < 2) return "one_result";
  return null;
}

/**
 * The deterministic probe set: for each example and each parameter, the boundary neighbours of that argument with
 * the other arguments kept (number: -1 / +1; string: "" and every other example value of that parameter; boolean:
 * the flip). Points equal to an example are dropped; order is stable.
 */
export function probeSet(params: readonly DeriveParam[], examples: readonly DeriveExample[]): DeriveValue[][] {
  const seen = new Set(examples.map((e) => keyOf(e.args)));
  const out: DeriveValue[][] = [];
  const add = (args: DeriveValue[]) => {
    const k = keyOf(args);
    if (!seen.has(k) && out.length < MAX_POINTS / 2) { seen.add(k); out.push(args); }
  };
  for (const ex of examples) {
    for (const [i, p] of params.entries()) {
      const v = ex.args[i]!;
      const put = (x: DeriveValue) => add(ex.args.map((a, j) => (j === i ? x : a)));
      if (p.type === "number") { put((v as number) - 1); put((v as number) + 1); }
      else if (p.type === "boolean") put(!v);
      else { put(""); for (const other of new Set(examples.map((e) => e.args[i] as string))) if (other !== v) put(other); }
    }
  }
  return out;
}

/** Witnessed edges per parameter (see edgeConstants), sorted. */
export function edgesByParam(params: readonly DeriveParam[], examples: readonly DeriveExample[]): number[][] {
  return params.map((p, i) => {
    const s = new Set<number>();
    if (p.type !== "number") return [];
    const byRest = new Map<string, Map<number, string>>();
    for (const ex of examples) {
      const rest = keyOf(ex.args.filter((_, j) => j !== i));
      const m = byRest.get(rest) ?? new Map<number, string>();
      m.set(ex.args[i] as number, keyOf([ex.out]));
      byRest.set(rest, m);
    }
    for (const m of byRest.values()) for (const [v, o] of m) { const o1 = m.get(v + 1); if (o1 !== undefined && o1 !== o) { s.add(v); s.add(v + 1); } }
    return [...s].sort((a, b) => a - b);
  });
}

/** Most far probes (gate 3). */
const MAX_FAR = 160;
/**
 * Far probes (gate 3): per number parameter the values 0, 1, -1, the outermost witnessed edges +-10 and +-100, and
 * +-10x the largest example magnitude (clamped to +-1e9); per string parameter "" and the first two example values;
 * per boolean both. One parameter: those values. Several: their cross product (multi-input functions). Points equal
 * to an example are dropped; deterministic order; at most MAX_FAR.
 */
export function farProbes(params: readonly DeriveParam[], examples: readonly DeriveExample[]): DeriveValue[][] {
  const edges = edgesByParam(params, examples);
  const far: DeriveValue[][] = params.map((p, i) => {
    if (p.type === "boolean") return [false, true];
    const vals = examples.map((e) => e.args[i]!);
    if (p.type === "string") return [...new Set(["", ...(vals as string[])])].slice(0, 3);
    const big = Math.max(1, ...(vals as number[]).map(Math.abs)) * 10;
    const es = edges[i]!;
    const outer = es.length ? [es[0]!, es[es.length - 1]!] : [];
    const xs = [0, 1, -1, ...outer.flatMap((c) => [c - 100, c - 10, c + 10, c + 100]), big, -big].map((x) => Math.max(-FAR_ABS, Math.min(FAR_ABS, x)));
    return [...new Set(xs)];
  });
  const seen = new Set(examples.map((e) => keyOf(e.args)));
  let prod: DeriveValue[][] = [[]];
  for (const f of far) prod = prod.flatMap((g) => f.map((x) => [...g, x]));
  const out: DeriveValue[][] = [];
  for (const a of prod) { const k = keyOf(a); if (!seen.has(k) && out.length < MAX_FAR) { seen.add(k); out.push(a); } }
  return out;
}

/** Evaluates a program on one argument list; undefined when a value leaves the integer range. */
export function evalProgram(n: DeriveNode, args: readonly DeriveValue[], hook?: (n: DeriveNode, side: 0 | 1) => void): DeriveValue | undefined {
  const ev = (x: DeriveNode) => evalProgram(x, args, hook);
  const num = (x: DeriveNode) => ev(x) as number | undefined;
  switch (n.op) {
    case "param": return args[n.i];
    case "int": case "lit": return n.v;
    case "add": case "sub": case "mul": {
      const a = num(n.a), b = num(n.b);
      if (a === undefined || b === undefined) return undefined;
      const r = n.op === "add" ? a + b : n.op === "sub" ? a - b : a * b;
      return isInt(r) ? r : undefined;
    }
    case "sq": { const a = num(n.a); if (a === undefined) return undefined; const r = a * a; return isInt(r) ? r : undefined; }
    case "min": case "max": {
      const a = num(n.a);
      if (a === undefined) return undefined;
      // hook side 0: the value is kept (strictly inside the cap); side 1: capped (strictly past it).
      if (hook && a !== n.c) hook(n, (n.op === "min" ? a < n.c : a > n.c) ? 0 : 1);
      return n.op === "min" ? (a <= n.c ? a : n.c) : (n.c <= a ? a : n.c);
    }
    case "cat": {
      const a = ev(n.a), b = ev(n.b);
      if (typeof a !== "string" || typeof b !== "string") return undefined;
      const r = a + b;
      return r.length <= 4 * DERIVE_MAX_STRING ? r : undefined;
    }
    case "eq": { const a = ev(n.a), b = ev(n.b); return a === undefined || b === undefined ? undefined : a === b; }
    case "le": { const a = num(n.a), b = num(n.b); return a === undefined || b === undefined ? undefined : a <= b; }
    case "range": { const p = args[n.i] as number; return n.lo <= p && p <= n.hi; }
    case "empty": return args[n.i] === "";
    case "and": case "or": {
      const a = ev(n.a), b = ev(n.b);
      if (typeof a !== "boolean" || typeof b !== "boolean") return undefined;
      return n.op === "and" ? a && b : a || b;
    }
    case "not": { const a = ev(n.a); return typeof a === "boolean" ? !a : undefined; }
    case "if": { const c = ev(n.c); if (typeof c !== "boolean") return undefined; hook?.(n, c ? 0 : 1); return ev(c ? n.t : n.e); }
  }
}

const NUM = (v: number) => (v < 0 ? `(${v})` : String(v));
/** Plain TypeScript for a program: parameters, literals, + - *, ===, <=, &&, ||, !, ?: only. */
export function compileProgram(n: DeriveNode, names: readonly string[]): string {
  const c = (x: DeriveNode): string => {
    switch (x.op) {
      case "param": return names[x.i]!;
      case "int": return NUM(x.v);
      case "lit": return typeof x.v === "number" ? NUM(x.v) : JSON.stringify(x.v);
      case "add": return `(${c(x.a)} + ${c(x.b)})`;
      case "sub": return `(${c(x.a)} - ${c(x.b)})`;
      case "mul": return `(${c(x.a)} * ${c(x.b)})`;
      case "sq": return `(${c(x.a)} * ${c(x.a)})`;
      case "min": { const a = c(x.a); return `(${a} <= ${NUM(x.c)} ? ${a} : ${NUM(x.c)})`; }
      case "max": { const a = c(x.a); return `(${NUM(x.c)} <= ${a} ? ${a} : ${NUM(x.c)})`; }
      case "cat": return `(${c(x.a)} + ${c(x.b)})`;
      case "eq": return `(${c(x.a)} === ${c(x.b)})`;
      case "le": return `(${c(x.a)} <= ${c(x.b)})`;
      case "range": return `(${NUM(x.lo)} <= ${names[x.i]} && ${names[x.i]} <= ${NUM(x.hi)})`;
      case "empty": return `(${names[x.i]} === "")`;
      case "and": return `(${c(x.a)} && ${c(x.b)})`;
      case "or": return `(${c(x.a)} || ${c(x.b)})`;
      case "not": return `!${c(x.a)}`;
      case "if": return `(${c(x.c)} ? ${c(x.t)} : ${c(x.e)})`;
    }
  };
  const s = c(n);
  return s.startsWith("(") && balancedOuter(s) ? s.slice(1, -1) : s;
}
function balancedOuter(s: string): boolean {
  let d = 0, q = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    if (q) { if (ch === "\\") i++; else if (ch === '"') q = false; continue; }
    if (ch === '"') q = true;
    else if (ch === "(") d++;
    else if (ch === ")") { d--; if (d === 0 && i < s.length - 1) return false; }
  }
  return d === 0;
}

const ALLOWED_BINARY = new Set([ts.SyntaxKind.PlusToken, ts.SyntaxKind.MinusToken, ts.SyntaxKind.AsteriskToken, ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.LessThanEqualsToken, ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.BarBarToken]);
/**
 * Fail-closed check of a compiled body on the TypeScript AST: every identifier is one of `params`, and the only
 * nodes are parentheses, numeric / plain string / boolean literals, prefix `!` and unary minus on a number,
 * the binary operators + - * === <= && ||, and `?:`. So: no globals, calls, member or computed access, `new`,
 * templates, assignment, or any other name. Null when clean, else a reason code.
 */
export function derivedExprProblem(text: string, params: readonly string[]): string | null {
  if (text.length > DERIVE_MAX_EXPR_CHARS) return "derive_expr_size";
  const sf = ts.createSourceFile("d.ts", `(${text});`, ts.ScriptTarget.Latest, true);
  if ((sf as unknown as { parseDiagnostics: unknown[] }).parseDiagnostics.length || sf.statements.length !== 1 || !ts.isExpressionStatement(sf.statements[0]!)) return "derive_expr_parse";
  const names = new Set(params);
  let bad: string | null = null, reads = 0;
  const visit = (n: ts.Node): void => {
    if (bad) return;
    if (ts.isParenthesizedExpression(n)) return visit(n.expression);
    if (ts.isIdentifier(n)) { if (!names.has(n.text)) bad = "derive_expr_name"; else reads++; return; }
    if (ts.isNumericLiteral(n)) { if (!/^\d{1,13}$/.test(n.text)) bad = "derive_expr_literal"; return; }
    if (ts.isStringLiteral(n)) { if (n.text.length > DERIVE_MAX_STRING || /[\\\u0000-\u001f\u007f]/.test(n.getText(sf).slice(1, -1).replace(/\\"/g, ""))) bad = "derive_expr_literal"; return; }
    if (n.kind === ts.SyntaxKind.TrueKeyword || n.kind === ts.SyntaxKind.FalseKeyword) return;
    if (ts.isPrefixUnaryExpression(n)) {
      if (n.operator === ts.SyntaxKind.ExclamationToken) return visit(n.operand);
      if (n.operator === ts.SyntaxKind.MinusToken && ts.isNumericLiteral(n.operand)) return visit(n.operand);
      bad = "derive_expr_node"; return;
    }
    if (ts.isBinaryExpression(n)) {
      if (!ALLOWED_BINARY.has(n.operatorToken.kind)) { bad = "derive_expr_operator"; return; }
      // No memorizing: === never compares with a non-empty string literal.
      if (n.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken && [n.left, n.right].some((x) => { while (ts.isParenthesizedExpression(x)) x = x.expression; return ts.isStringLiteral(x) && x.text !== ""; })) { bad = "derive_expr_memorize"; return; }
      visit(n.left); visit(n.right); return;
    }
    if (ts.isConditionalExpression(n)) { visit(n.condition); visit(n.whenTrue); visit(n.whenFalse); return; }
    bad = "derive_expr_node";
  };
  visit((sf.statements[0] as ts.ExpressionStatement).expression);
  return bad ?? (reads === 0 ? "derive_expr_constant" : null);
}

/**
 * Comparison constants C: edges the examples witness. For a number parameter i, two examples whose other arguments
 * are equal, whose i-th arguments are v and v + 1, and whose results differ, give v and v + 1. Sorted.
 */
export function edgeConstants(params: readonly DeriveParam[], examples: readonly DeriveExample[]): number[] {
  return [...new Set(edgesByParam(params, examples).flat())].sort((x, y) => x - y);
}
/** Cap / constant-result constants K: integer results at least two examples produce. Sorted. */
export function repeatedResults(examples: readonly DeriveExample[]): number[] {
  const n = new Map<number, number>();
  for (const ex of examples) if (typeof ex.out === "number") n.set(ex.out, (n.get(ex.out) ?? 0) + 1);
  return [...n].filter(([, c]) => c >= 2).map(([v]) => v).sort((a, b) => a - b);
}
/**
 * String pieces of the outputs: each output with the example's non-empty string arguments cut out; a piece is kept
 * only when at least two examples produce it (a piece seen in one output is that output memorized), plus "".
 */
function stringPieces(examples: readonly DeriveExample[]): string[] {
  const support = new Map<string, number>();
  for (const ex of examples) {
    if (typeof ex.out !== "string") continue;
    const cuts = [...new Set(ex.args.filter((a): a is string => typeof a === "string" && a.length > 0))].sort((a, b) => b.length - a.length);
    let parts = [ex.out];
    for (const c of cuts) parts = parts.flatMap((p) => p.split(c));
    for (const p of new Set(parts)) if (p.length > 0 && p.length <= DERIVE_MAX_STRING) support.set(p, (support.get(p) ?? 0) + 1);
  }
  return ["", ...[...support].filter(([, n]) => n >= 2).map(([p]) => p)].sort();
}

interface SearchSpec {
  params: readonly DeriveParam[];
  ret: DeriveType;
  /** Examples first (nEx of them), then probes. */
  points: readonly DeriveValue[][];
  nEx: number;
  target: readonly DeriveValue[];
  /** Comparison constants per parameter (number parameters only). */
  consts: readonly (readonly number[])[];
  caps: readonly number[];
  pieces: readonly string[];
  maxSize: number;
  budget: number;
  /** Memory bound in kept values (keptCellsLimit). */
  cells: number;
  /** After each completed size: true ends the search. */
  stop: (size: number, fits: readonly Prog[]) => boolean;
  /** On each new fit: true ends the search at once. */
  onFit?: (p: Prog) => boolean;
}
interface SearchOut { fits: Prog[]; searched: number; overBudget: boolean; stopped: boolean }

/**
 * The search core. Bottom-up by size; level s of each type is built only from smaller levels; one program per value
 * vector over the points is kept (the first, i.e. smallest, one built). A value that leaves the integer range at a
 * probe is recorded as null there (at an example the program is dropped: it cannot fit). A program whose value is
 * the same at every point never counts as reading a parameter (the constant-program filter).
 */
function runSearch(S: SearchSpec): SearchOut {
  const { params, points, nEx, target } = S;
  const P = points.length;
  const types: DeriveType[] = ["number", "string", "boolean"];
  const levels: Record<DeriveType, Prog[][]> = { number: [[]], string: [[]], boolean: [[]] };
  const guards: Prog[] = []; // if-guards: emptiness / equality atoms
  const seen: Record<DeriveType, Set<string>> = { number: new Set(), string: new Set(), boolean: new Set() };
  let searched = 0, keptCells = 0, overBudget = false, stopped = false;
  const fits: Prog[] = [];
  const fitsExamples = (vals: readonly V[]) => { for (let k = 0; k < nEx; k++) if (vals[k] !== target[k]) return false; return true; };
  const push = (ty: DeriveType, size: number, node: DeriveNode, usesParam: boolean, vals: V[] | null, guard = false): void => {
    if (overBudget || stopped) return;
    if (++searched > S.budget) { overBudget = true; return; }
    if (!vals) return;
    const k = vectorKey(vals);
    if (seen[ty].has(k)) return;
    seen[ty].add(k);
    if ((keptCells += P) > S.cells) { overBudget = true; return; }
    let varies = false;
    for (let j = 1; j < vals.length && !varies; j++) if (vals[j] !== vals[0]) varies = true;
    const p: Prog = { node, size, vals, usesParam: usesParam && varies };
    (levels[ty][size] ??= []).push(p);
    if (guard) guards.push(p);
    if (ty === S.ret && p.usesParam && fitsExamples(vals)) { fits.push(p); if (S.onFit?.(p)) stopped = true; }
  };
  const map1 = (f: (k: number) => V | undefined): V[] | null => {
    const out: V[] = new Array(P);
    for (let k = 0; k < P; k++) {
      const v = f(k);
      if (v === undefined || v === null) { if (k < nEx) return null; out[k] = null; } else out[k] = v;
    }
    return out;
  };
  const intOk = (r: number) => (isInt(r) ? r : undefined);
  const byNode = (node: DeriveNode): V[] | null => map1((k) => evalProgram(node, points[k]!));
  const at = (ty: DeriveType, s: number): Prog[] => levels[ty][s] ?? [];
  const guardAt = (s: number) => guards.filter((g) => g.size === s);
  type N = number | null;
  const arith = (x: readonly V[], y: readonly V[], f: (a: number, b: number) => number) => map1((k) => { const a = x[k] as N, b = y[k] as N; return a === null || b === null ? null : intOk(f(a, b)); });

  for (let size = 1; size <= S.maxSize && !overBudget && !stopped; size++) {
    for (const ty of types) levels[ty][size] ??= [];
    if (size === 1) {
      params.forEach((p, i) => { const n: DeriveNode = { op: "param", i }; push(p.type, 1, n, true, byNode(n)); });
      for (const v of [1, 2]) { const n: DeriveNode = { op: "int", v }; push("number", 1, n, false, byNode(n)); }
      for (const v of S.pieces) { const n: DeriveNode = { op: "lit", v }; push("string", 1, n, false, byNode(n)); }
    }
    // Boolean atoms over parameters (constants per parameter).
    params.forEach((p, i) => {
      const par: DeriveNode = { op: "param", i };
      const cs = S.consts[i] ?? [];
      if (p.type === "number") {
        if (size === 3) {
          for (const c of cs) {
            const lit: DeriveNode = { op: "lit", v: c };
            push("boolean", 3, { op: "eq", a: par, b: lit }, true, map1((k) => points[k]![i] === c), true);
            push("boolean", 3, { op: "le", a: par, b: lit }, true, map1((k) => (points[k]![i] as number) <= c));
            push("boolean", 3, { op: "le", a: lit, b: par }, true, map1((k) => c <= (points[k]![i] as number)));
          }
          params.forEach((q, j) => {
            if (q.type !== "number" || j === i) return;
            const pj: DeriveNode = { op: "param", i: j };
            if (i < j) push("boolean", 3, { op: "eq", a: par, b: pj }, true, map1((k) => points[k]![i] === points[k]![j]));
            push("boolean", 3, { op: "le", a: par, b: pj }, true, map1((k) => (points[k]![i] as number) <= (points[k]![j] as number)));
          });
        }
        if (size === 4) for (let x = 0; x < cs.length; x++) for (let y = x + 1; y < cs.length; y++) {
          const lo = cs[x]!, hi = cs[y]!;
          push("boolean", 4, { op: "range", i, lo, hi }, true, map1((k) => lo <= (points[k]![i] as number) && (points[k]![i] as number) <= hi));
        }
      } else if (p.type === "string") {
        if (size === 2) push("boolean", 2, { op: "empty", i }, true, map1((k) => points[k]![i] === ""), true);
      }
    });
    // Unary nodes.
    for (const a of at("number", size - 1)) if (a.usesParam) { const v = a.vals as N[]; push("number", size, { op: "sq", a: a.node }, true, map1((k) => (v[k] === null ? null : intOk(v[k]! * v[k]!)))); }
    for (const a of at("boolean", size - 1)) { const v = a.vals as (boolean | null)[]; push("boolean", size, { op: "not", a: a.node }, a.usesParam, map1((k) => (v[k] === null ? null : !v[k]))); }
    for (const a of at("number", size - 2)) if (a.usesParam) for (const c of S.caps) {
      const v = a.vals as N[];
      push("number", size, { op: "min", c, a: a.node }, true, map1((k) => (v[k] === null ? null : v[k]! <= c ? v[k]! : c)));
      push("number", size, { op: "max", c, a: a.node }, true, map1((k) => (v[k] === null ? null : c <= v[k]! ? v[k]! : c)));
    }
    // Binary nodes: sizes la + lb = size - 1.
    for (let la = 1; la <= size - 2 && !overBudget && !stopped; la++) {
      const lb = size - 1 - la;
      for (const a of at("number", la)) for (const b of at("number", lb)) {
        if (!a.usesParam && !b.usesParam) continue;
        if (la <= lb) {
          push("number", size, { op: "add", a: a.node, b: b.node }, true, arith(a.vals, b.vals, (x, y) => x + y));
          push("number", size, { op: "mul", a: a.node, b: b.node }, true, arith(a.vals, b.vals, (x, y) => x * y));
        }
        push("number", size, { op: "sub", a: a.node, b: b.node }, true, arith(a.vals, b.vals, (x, y) => x - y));
      }
      for (const a of at("string", la)) for (const b of at("string", lb)) {
        if (!a.usesParam && !b.usesParam) continue;
        if ((a.node.op === "lit" && a.node.v === "") || (b.node.op === "lit" && b.node.v === "")) continue;
        const x = a.vals as (string | null)[], y = b.vals as (string | null)[];
        push("string", size, { op: "cat", a: a.node, b: b.node }, true, map1((k) => { if (x[k] === null || y[k] === null) return null; const r = x[k]! + y[k]!; return r.length <= 4 * DERIVE_MAX_STRING ? r : undefined; }));
      }
      if (la <= lb) for (const a of at("boolean", la)) for (const b of at("boolean", lb)) {
        const x = a.vals as (boolean | null)[], y = b.vals as (boolean | null)[];
        push("boolean", size, { op: "and", a: a.node, b: b.node }, a.usesParam || b.usesParam, map1((k) => (x[k] === null || y[k] === null ? null : x[k]! && y[k]!)));
        push("boolean", size, { op: "or", a: a.node, b: b.node }, a.usesParam || b.usesParam, map1((k) => (x[k] === null || y[k] === null ? null : x[k]! || y[k]!)));
      }
    }
    // Conditionals: if(G, x, y) with |G| + |x| + |y| = size - 1; number branches may also be K constants.
    for (let lg = 2; lg <= Math.min(3, size - 3) && !overBudget && !stopped; lg++) {
      for (const g of guardAt(lg)) for (let lt = 1; lt <= size - 2 - lg; lt++) {
        const le = size - 1 - lg - lt;
        if (le < 1) continue;
        const gv = g.vals as (boolean | null)[];
        for (const ty of ["number", "string"] as const) {
          const constLeaves = (n: number) => (ty === "number" && n === 1 ? S.caps.map((c) => ({ node: { op: "lit", v: c } as DeriveNode, vals: new Array<V>(P).fill(c) })) : []);
          const xs = [...at(ty, lt), ...constLeaves(lt)], ys = [...at(ty, le), ...constLeaves(le)];
          for (const x of xs) for (const y of ys) {
            if (x.node === y.node || (x.node.op === "lit" && y.node.op === "lit" && x.node.v === y.node.v)) continue;
            const xv = x.vals, yv = y.vals;
            push(ty, size, { op: "if", c: g.node, t: x.node, e: y.node }, true, map1((k) => (gv[k] === null ? null : gv[k] ? xv[k] : yv[k])));
          }
        }
      }
    }
    if (overBudget || stopped) break;
    if (S.stop(size, fits)) break;
  }
  return { fits, searched, overBudget, stopped };
}

const dedupePoints = (pts: readonly DeriveValue[][]): DeriveValue[][] => {
  const seen = new Set<string>();
  return pts.filter((a) => { const k = keyOf(a); if (seen.has(k)) return false; seen.add(k); return true; });
};

/**
 * The search. At the first size where some parameter-reading program matches every example, DERIVE_SLACK more
 * levels are built and: exactly one such behavior up to there (on examples + neighbour probes + far probes) -> the
 * candidate; more than one -> derive_ambiguous. The candidate must then pass the witness gates (gateProblem):
 * otherwise derive_under_specified, naming what the examples do not show.
 */
export function deriveProgram(input: DeriveInput): DeriveResult {
  const r = deriveCandidate(input);
  if (!r.ok) return r;
  // Round 3 (Auditor ruling on 6f1ea5e): never emit a program that uses a form fewer than DERIVE_FORM_BAR replaying
  // upstream evidence entries show (counts read from the evidence file, the single source; see evidenceFormCounts).
  const forms = unevidencedForms(r.fit.program);
  if (forms.length === 0) return r;
  const counts = evidenceFormCounts();
  return {
    ok: false, reason: "derive_unevidenced_form", forms, searched: r.searched,
    detail: `the program that fits uses ${forms.map((f) => `the ${f} form (${DERIVE_FORM_TEXT[f]}; ${counts[f]} replaying upstream evidence entries)`).join(" and ")}; PeaceAI emits a form only once at least ${DERIVE_FORM_BAR} replaying upstream examples show it, so it does not write this one yet. Can the behavior be written without ${forms.length === 1 ? "that form" : "those forms"}?`,
  };
}

// ---- Forms and their upstream evidence (#491 round 3, Auditor ruling: narrow the rule to evidenced forms) ----

/**
 * The gated DSL forms. A program uses a form when it contains one of the form's nodes:
 *   cap     min(K, a) / max(K, a)                 (compiled to a conditional against a constant)
 *   ternary if(G, x, y)                           (a general conditional; caps are counted as cap, not here)
 *   strcat  a + b on strings
 *   eq      p === C, p === q, s is empty          (compiled to ===)
 *   or      a || b
 *   range   lo <= p <= hi, a && b                 (compiled to &&)
 *   square  sq(a), and a * a of one same subprogram
 * The base vocabulary (parameters, the constants, + - * on numbers, <=, !) is not a gated form.
 */
export const DERIVE_FORMS = ["cap", "ternary", "strcat", "eq", "or", "range", "square"] as const;
export type DeriveForm = (typeof DERIVE_FORMS)[number];
/** Fewest replaying upstream evidence entries a form needs before PeaceAI emits a program using it. */
export const DERIVE_FORM_BAR = 10;
export const DERIVE_FORM_TEXT: Readonly<Record<DeriveForm, string>> = {
  cap: "a value capped at a constant", ternary: "a general if / else", strcat: "string concatenation", eq: "an equality test",
  or: "an || of two tests", range: "an && of two tests or a range check", square: "a value times itself",
};
/** The evidence file (peaceai/rules/proposals/m99-derive-from-behavior-evidence.json): the single source of form counts. */
export const DERIVE_EVIDENCE_PATH = fileURLToPath(new URL("../rules/proposals/m99-derive-from-behavior-evidence.json", import.meta.url));

/** The gated forms a program uses (sorted in DERIVE_FORMS order). */
export function formsOf(n: DeriveNode): DeriveForm[] {
  const s = new Set<DeriveForm>();
  const walk = (x: DeriveNode): void => {
    switch (x.op) {
      case "min": case "max": s.add("cap"); walk(x.a); return;
      case "if": s.add("ternary"); walk(x.c); walk(x.t); walk(x.e); return;
      case "cat": s.add("strcat"); walk(x.a); walk(x.b); return;
      case "eq": s.add("eq"); walk(x.a); walk(x.b); return;
      case "empty": s.add("eq"); return;
      case "or": s.add("or"); walk(x.a); walk(x.b); return;
      case "and": s.add("range"); walk(x.a); walk(x.b); return;
      case "range": s.add("range"); return;
      case "sq": s.add("square"); walk(x.a); return;
      case "mul": if (JSON.stringify(x.a) === JSON.stringify(x.b)) s.add("square"); walk(x.a); walk(x.b); return;
      case "add": case "sub": case "le": walk(x.a); walk(x.b); return;
      case "not": walk(x.a); return;
      case "param": case "int": case "lit": return;
    }
  };
  walk(n);
  return DERIVE_FORMS.filter((f) => s.has(f));
}

/**
 * Entries per form in the evidence file: each example records the forms of the program it replays to (`forms`; the
 * evidence test re-derives every example and checks the recorded forms equal formsOf of the replayed program). Fail
 * closed: an unreadable or malformed file, or an entry with a form name outside DERIVE_FORMS, counts nothing.
 */
export function evidenceFormCounts(text?: string): Record<DeriveForm, number> {
  const counts = Object.fromEntries(DERIVE_FORMS.map((f) => [f, 0])) as Record<DeriveForm, number>;
  if (text === undefined && cachedCounts) return { ...cachedCounts };
  try {
    const ev = JSON.parse(text ?? readFileSync(DERIVE_EVIDENCE_PATH, "utf8")) as { examples?: unknown };
    if (!Array.isArray(ev.examples)) throw new Error("no examples");
    for (const e of ev.examples as { forms?: unknown }[]) {
      const fs = e && Array.isArray(e.forms) ? (e.forms as unknown[]) : null;
      if (!fs || !fs.every((f) => typeof f === "string" && (DERIVE_FORMS as readonly string[]).includes(f))) continue;
      for (const f of new Set(fs as DeriveForm[])) counts[f]++;
    }
  } catch {
    for (const f of DERIVE_FORMS) counts[f] = 0;
  }
  if (text === undefined) cachedCounts = { ...counts };
  return counts;
}
let cachedCounts: Record<DeriveForm, number> | undefined;

/** The forms `program` uses that fewer than DERIVE_FORM_BAR evidence entries show (empty: it may be emitted). */
export function unevidencedForms(program: DeriveNode, counts: Readonly<Record<DeriveForm, number>> = evidenceFormCounts()): DeriveForm[] {
  return formsOf(program).filter((f) => !((counts[f] ?? 0) >= DERIVE_FORM_BAR));
}

/**
 * The search and the witness gates WITHOUT the form gate: for replaying and mining upstream evidence only (the
 * evidence test, the miners). Nothing that emits code calls it; Job A, the edit hook and the review note use
 * deriveProgram (m99-derive-from-behavior.test.ts checks no lib / bin module names it).
 */
export function deriveCandidate(input: DeriveInput): DeriveResult {
  const problem = examplesProblem(input);
  if (problem) return { ok: false, reason: "derive_examples", detail: problem, searched: 0 };
  const maxSize = Math.min(input.maxSize ?? DERIVE_MAX_SIZE, DERIVE_MAX_SIZE);
  const budget = Math.min(input.budget ?? DERIVE_BUDGET, DERIVE_BUDGET);
  const { params, examples } = input;
  const nEx = examples.length;
  const probes = dedupePoints([...probeSet(params, examples), ...farProbes(params, examples)]).filter((a) => !examples.some((e) => keyOf(e.args) === keyOf(a)));
  const points: DeriveValue[][] = [...examples.map((e) => e.args), ...probes];
  const names = params.map((p) => p.name);
  const slack = Math.max(0, Math.min(input.slack ?? DERIVE_SLACK, DERIVE_SLACK));
  let first = 0;
  const r = runSearch({
    params, ret: input.ret, points, nEx, target: examples.map((e) => e.out),
    consts: edgesByParam(params, examples), caps: repeatedResults(examples), pieces: stringPieces(examples), maxSize, budget, cells: keptCellsLimit(input),
    stop: (size, fits) => { if (fits.length > 0 && first === 0) first = size; return first > 0 && size >= first + slack; },
  });
  const searched = r.searched;
  if (r.overBudget) return { ok: false, reason: "derive_budget", searched };
  if (r.fits.length === 0) { const questions = edgeQuestions(input); return { ok: false, reason: "derive_no_fit", ...(questions.length ? { questions } : {}), searched }; }
  const best = r.fits[0]!;
  if (r.fits.length > 1) {
    const b = r.fits[1]!;
    let k = nEx;
    while (k < points.length && best.vals[k] === b.vals[k]) k++;
    const questions = k < points.length ? deriveQuestions(input, best.node, [], [{ at: points[k]!, values: r.fits.slice(0, 4).map((f) => f.vals[k]!).filter((v) => v !== null) }]) : [];
    return { ok: false, reason: "derive_ambiguous", alternatives: r.fits.slice(0, 4).map((f) => ({ program: f.node, size: f.size, expr: compileProgram(f.node, names) })), probe: points[k], ...(questions.length ? { questions } : {}), searched };
  }
  // One budget for the whole derivation (round 3, m100 practice: a sparse task took ~258 s when the main search and
  // each rival pass had DERIVE_BUDGET programs of their own): the gates' rival passes get what the main search left.
  const spent = { searched: 0 };
  const gate = gateProblem(input, best.node, best.size, budget - searched, spent);
  if (gate) {
    const questions = deriveQuestions(input, best.node, gate.at ?? [], gate.rivals ?? []);
    return { ok: false, reason: "derive_under_specified", gate: gate.gate, ...(gate.param ? { param: gate.param } : {}), detail: gate.detail, ...(questions.length ? { questions } : {}), searched: searched + gate.searched };
  }
  return { ok: true, fit: { program: best.node, size: best.size, expr: compileProgram(best.node, names) }, probes, searched: searched + spent.searched };
}

// ---- The witness gates (Auditor, #491 review): a fit is accepted only when the examples SHOW what it relies on.

export type DeriveGate = "unread" | "chars" | "edge" | "far" | "region" | "span" | "branch" | "cap" | "rival" | "rival_budget";
export interface DeriveGateProblem { gate: DeriveGate; param?: string; detail: string; searched: number; at?: DeriveValue[][]; rivals?: { at: DeriveValue[]; values: DeriveValue[] }[] }

/**
 * A question the refusal asks (Peace, #491 round 3: rule programs out by asking, not only refusing): an input the
 * examples do not cover and two or more results that programs fitting EVERY example give there. `answers` is sorted
 * (numbers ascending, false before true), so nothing marks which one the derived program gives: a question is never
 * answered from the derived program; only the issue author's next example answers it.
 */
export interface DeriveQuestion { at: DeriveValue[]; answers: DeriveValue[] }
/** Most questions one refusal asks. */
export const DERIVE_MAX_QUESTIONS = 3;
const sortAnswers = (vs: readonly DeriveValue[]): DeriveValue[] => [...new Map(vs.map((v) => [keyOf([v]), v])).values()]
  .sort((x, y) => (typeof x === "number" && typeof y === "number" ? x - y : keyOf([x]) < keyOf([y]) ? -1 : keyOf([x]) > keyOf([y]) ? 1 : 0));

/**
 * The questions for a refusal (deterministic, no search beyond the one the refusal already ran). For a rival or an
 * ambiguity, the found programs' results at the input where they disagree. For a witness gate, the input it names
 * (`at`), with the derived program's result and the result of a program built to fit every example but differ there:
 * boolean results the other value (the program with that one input flipped fits every example, as the input is not
 * one); number results a cap or floor at the largest or smallest shown result (`min(largest, program)` fits every
 * example), else the nearest example's result at that one input. Inputs equal to an example are never asked.
 */
export function deriveQuestions(input: DeriveInput, program: DeriveNode, at: readonly DeriveValue[][], rivals: readonly { at: DeriveValue[]; values: DeriveValue[] }[] = []): DeriveQuestion[] {
  const exKeys = new Set(input.examples.map((e) => keyOf(e.args)));
  const outs = input.examples.map((e) => e.out).filter((v): v is number => typeof v === "number");
  const qs: DeriveQuestion[] = [];
  const seen = new Set<string>();
  const push = (pt: readonly DeriveValue[], vals: readonly DeriveValue[]) => {
    const k = keyOf(pt);
    if (qs.length >= DERIVE_MAX_QUESTIONS || seen.has(k) || exKeys.has(k) || pt.length !== input.params.length) return;
    const answers = sortAnswers(vals.filter((v) => v !== null && v !== undefined));
    if (answers.length < 2) return;
    seen.add(k);
    qs.push({ at: [...pt], answers });
  };
  for (const r of rivals) push(r.at, r.values);
  for (const pt of at) {
    const mine = evalProgram(program, pt);
    if (mine === null || mine === undefined) continue;
    let other: DeriveValue | null = null;
    if (typeof mine === "boolean") other = !mine;
    else if (typeof mine === "string") {
      // A string result: the nearest example's result there (a program equal to the derived one except at this one
      // input, which is not an example, fits every example as well).
      const near = nearestExample(input, pt);
      if (near && near.out !== mine) other = near.out;
    }
    else if (typeof mine === "number" && outs.length) {
      const hi = Math.max(...outs), lo = Math.min(...outs);
      if (mine > hi) other = hi;
      else if (mine < lo) other = lo;
      else {
        const near = nearestExample(input, pt);
        if (near && near.out !== mine) other = near.out;
      }
    }
    if (other !== null) push(pt, [mine, other]);
  }
  return qs;
}

/**
 * Questions when nothing fits (derive_no_fit): where the result changes between two examples that differ in one
 * number parameter only (the others equal) by more than 1, the examples do not say where it changes; a function
 * changing just after the first or just before the second fits them both. Asks the midpoint of the widest such gaps
 * (at most DERIVE_MAX_QUESTIONS), with the two results there as the answers. Deterministic; no search.
 */
export function edgeQuestions(input: DeriveInput): DeriveQuestion[] {
  const { params, examples } = input;
  const gaps: { w: number; at: DeriveValue[]; values: DeriveValue[] }[] = [];
  params.forEach((p, i) => {
    if (p.type !== "number") return;
    const groups = new Map<string, DeriveExample[]>();
    for (const e of examples) { const k = keyOf(e.args.filter((_, j) => j !== i)); groups.set(k, [...(groups.get(k) ?? []), e]); }
    for (const g of groups.values()) {
      const sorted = [...g].sort((x, y) => (x.args[i] as number) - (y.args[i] as number));
      for (let k = 1; k < sorted.length; k++) {
        const a = sorted[k - 1]!, b = sorted[k]!, lo = a.args[i] as number, hi = b.args[i] as number;
        if (hi - lo <= 1 || keyOf([a.out]) === keyOf([b.out])) continue;
        const at = [...a.args]; at[i] = lo + Math.floor((hi - lo) / 2);
        gaps.push({ w: hi - lo, at, values: [a.out, b.out] });
      }
    }
  });
  gaps.sort((x, y) => y.w - x.w || (keyOf(x.at) < keyOf(y.at) ? -1 : 1));
  return deriveQuestions(input, { op: "int", v: 0 }, [], gaps);
}

/** The example nearest a point (sum of distances over number arguments, mismatches of others count 1; first on a tie). */
function nearestExample(input: DeriveInput, pt: readonly DeriveValue[]): DeriveExample | null {
  let best: DeriveExample | null = null, bd = Infinity;
  for (const e of input.examples) {
    let d = 0;
    e.args.forEach((v, j) => { d += typeof v === "number" && typeof pt[j] === "number" ? Math.abs(v - (pt[j] as number)) : keyOf([v]) === keyOf([pt[j]!]) ? 0 : 1; });
    if (d < bd) { bd = d; best = e; }
  }
  return best;
}

/** A point: the example whose parameter i is nearest v, with parameter i set to v. */
function pointAt(examples: readonly DeriveExample[], i: number, v: number): DeriveValue[] {
  let best = examples[0]!, bd = Infinity;
  for (const e of examples) { const d = Math.abs((e.args[i] as number) - v); if (d < bd) { bd = d; best = e; } }
  const pt = [...best.args]; pt[i] = v; return pt;
}

/** Character classes every string parameter the program reads must show in some example value (gate 0b). */
export const DERIVE_STRING_CLASSES: readonly (readonly [string, RegExp])[] = [
  ["an upper-case letter", /[A-Z]/],
  ["a lower-case letter", /[a-z]/],
  ["a digit", /[0-9]/],
  ["a space between other characters", /\S \S/],
  ["a leading or trailing space", /^ | $/],
  ["punctuation", /[^A-Za-z0-9 ]/],
  // m100 practice (round 3, cond_suffix): a join shown only with non-empty values hides a branch on the empty string.
  ["the empty string", /^$/],
];

const walk = (n: DeriveNode, f: (x: DeriveNode) => void): void => {
  f(n);
  switch (n.op) {
    case "add": case "sub": case "mul": case "cat": case "and": case "or": case "eq": case "le": walk(n.a, f); walk(n.b, f); break;
    case "sq": case "not": case "min": case "max": walk(n.a, f); break;
    case "if": walk(n.c, f); walk(n.t, f); walk(n.e, f); break;
    default: break;
  }
};
/** Parameter indices a program reads. */
export function paramsRead(n: DeriveNode): Set<number> {
  const s = new Set<number>();
  walk(n, (x) => { if (x.op === "param" || x.op === "range" || x.op === "empty") s.add(x.i); });
  return s;
}

/**
 * The gates, in order (each names the parameter / edge the examples do not show):
 *  unread  every parameter the program does not read is shown irrelevant at non-degenerate settings: examples that
 *          differ only in it give the same result, with the other numbers not 0 / 1 / -1, the other strings
 *          non-empty, no min / max cap held, at least DERIVE_UNREAD_VALUES values of it, at both outcomes of a
 *          boolean result and of each && / || operand (unreadProblem);
 *  chars   every string parameter it reads: the example values include an upper-case and a lower-case letter, a
 *          digit, an inner space, a leading or trailing space and punctuation (a verbatim copy or an emptiness test
 *          is only shown on the characters a case change, trim or escape would alter);
 *  edge    (1) both sides of every threshold: p <= c needs examples at c and c + 1, c <= p at c - 1 and c, a range
 *          at both of its ends, p == c at c - 1, c and c + 1 (and p == q / p <= q at the same offsets), each pair
 *          with the other arguments equal and different results; an emptiness test needs "" and a non-empty value;
 *  far     (1) every parameter compared with constants has an example at least DERIVE_FAR past its last constant
 *          and one at least DERIVE_FAR before its first (the regions past the outermost edges, true or false, are
 *          shown, not assumed); two compared parameters: examples with p - q >= DERIVE_FAR and <= -DERIVE_FAR;
 *          a min / max cap at c: an example whose capped value is >= c + DERIVE_FAR and one <= c - DERIVE_FAR, for
 *          each side some neighbour or far probe reaches;
 *  region  inside every region the program's constants cut a compared parameter into, no example-free stretch
 *          longer than 1 / DERIVE_REGION_PARTS (an eighth) of the region (finite) or DERIVE_FAR (open, up to the farthest example): regionProblem;
 *  span    every number parameter the result is computed from (not only compared) is shown over at least DERIVE_FAR
 *          (largest minus smallest example value): an unwitnessed cap or clamp inside that stretch would show; and a
 *          number result is shown positive (negative) whenever the program gives a positive (negative) result at a
 *          neighbour or far probe inside the examples' range of every parameter;
 *  branch / cap (2) each branch of every conditional, and each side of every min / max cap (kept and capped), is
 *          reached by at least DERIVE_MIN_REACH examples (the true branch of a one-parameter `p === c` or emptiness
 *          test holds for one input only: one example);
 *  rival   (3) a search DERIVE_RIVAL_EXTRA sizes past the fit with EVERY example value as a constant finds no other
 *          program that fits every example but differs from the fit on a
 *          probe inside the examples' range (neighbour probes and far probes 0, +-1, edges +-10 / +-100, cross
 *          products); and a second search with the witnessed edges as constants finds none that differs on a far
 *          probe past the examples (rivalProblem). rival_budget: a search ran out of budget.
 */
/** Smallest number of distinct values an unread parameter takes in one witness group (m103, Auditor #497 (b)). */
export const DERIVE_UNREAD_VALUES = 3;
/** Number values that hide another parameter (a product by 0, a power or product by 1 or -1). */
const DEGENERATE_NUMS = new Set([0, 1, -1]);

/** A program with the node `at` (by identity) replaced by `by`. */
function replaceNode(n: DeriveNode, at: DeriveNode, by: DeriveNode): DeriveNode {
  if (n === at) return by;
  switch (n.op) {
    case "add": case "sub": case "mul": case "cat": case "and": case "or": case "eq": case "le": return { ...n, a: replaceNode(n.a, at, by), b: replaceNode(n.b, at, by) };
    case "sq": case "not": case "min": case "max": return { ...n, a: replaceNode(n.a, at, by) };
    case "if": return { ...n, c: replaceNode(n.c, at, by), t: replaceNode(n.t, at, by), e: replaceNode(n.e, at, by) };
    default: return n;
  }
}

/**
 * Programs that read parameter i and fit every example as well as `program` does: the program with i joined to its
 * result or to one of the parameters it reads (x * f(i), x + f(i) for f in i, i + 1, (i + 1) ** 2, i ** 2; strings
 * x + i, i + x). Their results are the other answers at an unread question (m103, Auditor #497: a linear guess left a
 * quadratic truth off the menu).
 */
function unreadVariants(input: DeriveInput, program: DeriveNode, i: number): DeriveNode[] {
  const { params, examples } = input;
  const P: DeriveNode = { op: "param", i };
  const leaves: DeriveNode[] = [];
  walk(program, (n) => { if (n.op === "param" && n !== program) leaves.push(n); });
  const typeAt = (n: DeriveNode) => typeOf(evalProgram(n, examples[0]!.args) ?? 0);
  const targets = [program, ...leaves.filter((n) => n.op === "param" && params[n.i]!.type === params[i]!.type)];
  const out: DeriveNode[] = [];
  for (const x of targets) {
    if (params[i]!.type === "number" && typeAt(x) === "number") {
      const one: DeriveNode = { op: "int", v: 1 };
      for (const f of [P, { op: "add", a: P, b: one }, { op: "sq", a: { op: "add", a: P, b: one } }, { op: "sq", a: P }] as DeriveNode[]) {
        out.push(replaceNode(program, x, { op: "mul", a: x, b: f }), replaceNode(program, x, { op: "add", a: x, b: f }));
      }
    } else if (params[i]!.type === "string" && typeAt(x) === "string") {
      out.push(replaceNode(program, x, { op: "cat", a: x, b: P }), replaceNode(program, x, { op: "cat", a: P, b: x }));
      // Joined only where another string is non-empty (`s === "" ? "" : s + t` shown only at s = "").
      params.forEach((q, j) => { if (j !== i && q.type === "string") out.push(replaceNode(program, x, { op: "if", c: { op: "empty", i: j }, t: x, e: { op: "cat", a: x, b: P } })); });
    }
  }
  // The term a degenerate value hid: the result plus f(i) times (p - d) or its square, for f(i) in i, i + 1, i - 1,
  // another number parameter p and d in 0, 1, -1 (a * b + c, c + (a * b) ** 2, b ** a at b = 1).
  if (params[i]!.type === "number" && typeAt(program) === "number") {
    params.forEach((q, j) => {
      if (j === i || q.type !== "number") return;
      for (const d of [0, 1, -1]) {
        const pj: DeriveNode = d === 0 ? { op: "param", i: j } : { op: "sub", a: { op: "param", i: j }, b: { op: "int", v: d } };
        for (const f of [P, { op: "add", a: P, b: { op: "int", v: 1 } }, { op: "sub", a: P, b: { op: "int", v: 1 } }] as DeriveNode[]) {
          const t: DeriveNode = { op: "mul", a: f, b: pj };
          out.push({ op: "add", a: program, b: t }, { op: "add", a: program, b: { op: "sq", a: t } });
        }
      }
    });
  }
  return out.filter((v) => examples.every((e) => keyOf([evalProgram(v, e.args) ?? null]) === keyOf([e.out])));
}

/**
 * The unread gate (m103; Auditor #494 backoff/sparse, Auditor #497 sibling witnesses). Every declared parameter the
 * program does not read must be SHOWN irrelevant at non-degenerate settings: a group of examples that differ only in
 * it, give the same result, and
 *  (a) every other number parameter is not 0, 1 or -1 (a product by 0, a power of 1, a product by +-1 or a square
 *      of a zero product hides it) and every other string parameter is non-empty (`s + t`, `s === "" ? "" : s + t`
 *      at s = "" hides t), and no min / max cap of the program is at or past its cap value (a held cap hides it);
 *  (b) it takes at least DERIVE_UNREAD_VALUES distinct values there (both values for a boolean): a symmetric pair
 *      (a = 0 and a = -2 in (a + 1) ** 2) hides it;
 *  (c) for a boolean result, and for each operand of every && / ||, such a group at both of its outcomes that some
 *      example reaches (b varied only where a > 5 is false hides b in a > 5 && b > 3).
 * Otherwise refused, asking at a setting that meets the same conditions, with the parameter's value changed; the
 * answers are the program's result and the results of programs that read it and fit every example (unreadVariants).
 */
export function unreadProblem(input: DeriveInput, program: DeriveNode, read: ReadonlySet<number>, expr: string): DeriveGateProblem | null {
  const { params, examples } = input;
  const names = params.map((p) => p.name);
  const caps: Extract<DeriveNode, { op: "min" | "max" }>[] = [];
  const decisions: DeriveNode[] = [];
  walk(program, (n) => {
    if (n.op === "min" || n.op === "max") caps.push(n);
    if (n.op === "and" || n.op === "or") decisions.push(n.a, n.b);
  });
  if (typeOf(evalProgram(program, examples[0]!.args) ?? 0) === "boolean") decisions.unshift(program);
  const atCap = (a: readonly DeriveValue[]) => caps.some((n) => { const v = evalProgram(n.a, a); return typeof v !== "number" || (n.op === "min" ? v >= n.c : v <= n.c); });
  const degenerate = (j: number, v: DeriveValue | undefined) => (params[j]!.type === "number" ? typeof v === "number" && DEGENERATE_NUMS.has(v) : params[j]!.type === "string" ? v === "" : false);
  const setting = (a: readonly DeriveValue[], i: number) => a.every((v, j) => j === i || !degenerate(j, v)) && !atCap(a);
  for (let i = 0; i < params.length; i++) {
    if (read.has(i)) continue;
    const need = params[i]!.type === "boolean" ? 2 : DERIVE_UNREAD_VALUES;
    const groups = new Map<string, { args: readonly DeriveValue[]; vals: Map<string, DeriveValue> }>();
    for (const e of examples) {
      const k = keyOf(e.args.filter((_, j) => j !== i));
      const g = groups.get(k) ?? { args: e.args, vals: new Map() };
      g.vals.set(keyOf([e.args[i]!]), e.args[i]!);
      groups.set(k, g);
    }
    if (![...groups.values()].some((g) => g.vals.size >= 2)) return { gate: "unread", param: names[i]!, searched: 0, detail: `${names[i]} is not read by \`${expr}\`, but no two examples differ only in ${names[i]} and give the same result; add such a pair` };
    const good = [...groups.values()].filter((g) => g.vals.size >= need && setting(g.args, i));
    // The requirements: some good group, and one at each outcome of each decision that an example reaches.
    const reqs: { d: DeriveNode | null; v: DeriveValue | null }[] = [{ d: null, v: null }];
    for (const d of decisions) for (const v of [true, false]) if (examples.some((e) => evalProgram(d, e.args) === v)) reqs.push({ d, v });
    const holds = (r: { d: DeriveNode | null; v: DeriveValue | null }, a: readonly DeriveValue[]) => r.d === null || evalProgram(r.d, a) === r.v;
    const miss = reqs.find((r) => !good.some((g) => holds(r, g.args)));
    if (!miss) continue;
    // The ask: a setting meeting (a) and the missing outcome, from an example with degenerate values replaced.
    let base: DeriveValue[] | null = null;
    for (const e of examples) {
      const pt = [...e.args];
      params.forEach((p, j) => {
        if (j === i || !degenerate(j, pt[j])) return;
        const cands: DeriveValue[] = p.type === "number"
          ? [...new Set(examples.map((f) => f.args[j] as number).filter((v) => !DEGENERATE_NUMS.has(v))), 2, 3, 7, -2]
          : [...new Set(examples.map((f) => f.args[j] as string).filter((v) => v !== "")), "a"];
        for (const c of cands) { const t = [...pt]; t[j] = c; if (holds(miss, t) && !atCap(t)) { pt[j] = c; return; } }
        pt[j] = cands[0]!;
      });
      if (setting(pt, i) && holds(miss, pt)) { base = pt; break; }
    }
    const what = miss.d === null ? "" : ` where \`${compileProgram(miss.d, names)}\` is ${String(miss.v)}`;
    const detail = `${names[i]} is not read by \`${expr}\`, but no ${need} or more examples differ only in ${names[i]} (giving the same result)${what} with the other number parameters not 0, 1 or -1, the other strings non-empty and the result inside every cap, where ${names[i]} could show; add such examples`;
    if (!base) return { gate: "unread", param: names[i]!, searched: 0, detail };
    const have = new Map<string, DeriveValue>();
    for (const e of examples) if (keyOf(e.args.filter((_, j) => j !== i)) === keyOf(base.filter((_, j) => j !== i))) have.set(keyOf([e.args[i]!]), e.args[i]!);
    const pool: DeriveValue[] = [base[i]!, ...examples.map((e) => e.args[i]!), ...(params[i]!.type === "number" ? [2, 3, 7, 11, 13] : params[i]!.type === "string" ? ["q", "Ab", "x y"] : [true, false])];
    const at: DeriveValue[][] = [];
    for (const v of pool) {
      if (have.size + at.length >= need || at.length >= DERIVE_MAX_QUESTIONS) break;
      const k = keyOf([v]);
      if (have.has(k) || at.some((a) => keyOf([a[i]!]) === k)) continue;
      const pt = [...base]; pt[i] = v;
      if (examples.some((e) => keyOf(e.args) === keyOf(pt))) { have.set(k, v); continue; }
      at.push(pt);
    }
    const variants = unreadVariants(input, program, i);
    const rivals = at.map((pt) => ({ at: pt, values: [evalProgram(program, pt), ...variants.map((v) => evalProgram(v, pt))].filter((v): v is DeriveValue => v !== undefined && v !== null) }))
      .filter((r) => new Set(r.values.map((v) => keyOf([v]))).size >= 2);
    return { gate: "unread", param: names[i]!, searched: 0, detail, at, ...(rivals.length ? { rivals } : {}) };
  }
  return null;
}

export function gateProblem(input: DeriveInput, program: DeriveNode, size: number, budget = DERIVE_BUDGET, spent?: { searched: number }): DeriveGateProblem | null {
  const { params, examples } = input;
  const names = params.map((p) => p.name);
  const expr = compileProgram(program, names);
  const rest = (a: readonly DeriveValue[], skip: readonly number[]) => keyOf(a.filter((_, j) => !skip.includes(j)));
  const out = (e: DeriveExample) => keyOf([e.out]);
  const fail = (gate: DeriveGate, detail: string, param?: number, at?: DeriveValue[][]): DeriveGateProblem => ({ gate, detail, searched: 0, ...(param !== undefined ? { param: names[param]! } : {}), ...(at ? { at } : {}) });
  const ptAt = (i: number, v: number) => pointAt(examples, i, v);
  const read = paramsRead(program);
  // unread (m103, Auditor #494 and #497): unreadProblem.
  const unread = unreadProblem(input, program, read, expr);
  if (unread) return unread;
  // chars
  for (const i of [...read].sort()) {
    if (params[i]!.type !== "string") continue;
    const vals = examples.map((e) => e.args[i] as string);
    const missing = DERIVE_STRING_CLASSES.filter(([, re]) => !vals.some((v) => re.test(v))).map(([d]) => d);
    if (missing.length) return fail("chars", `${names[i]} is read by \`${expr}\`, but no example value of it has ${missing.join(", ")}; add examples whose ${names[i]} does`, i, vals.includes("") ? undefined : [examples[0]!.args.map((a, j) => (j === i ? "" : a))]);
  }
  // edge (1)
  const byVal = (i: number, v: DeriveValue) => examples.filter((e) => e.args[i] === v);
  /** Two examples, same other arguments, argument i = x and = y, different results. */
  const pairDiffers = (i: number, x: DeriveValue, y: DeriveValue) => byVal(i, x).some((e) => byVal(i, y).some((f) => rest(e.args, [i]) === rest(f.args, [i]) && out(e) !== out(f)));
  /** Two examples differing by 1 in parameter i or j only (others equal), with p_i - p_j = d0 and d1, different results. */
  const deltaDiffers = (i: number, j: number, d0: number, d1: number) => examples.some((e) => examples.some((f) => {
    const de = (e.args[i] as number) - (e.args[j] as number), df = (f.args[i] as number) - (f.args[j] as number);
    if (de !== d0 || df !== d1 || out(e) === out(f)) return false;
    return (rest(e.args, [i]) === rest(f.args, [i])) || (rest(e.args, [j]) === rest(f.args, [j]));
  }));
  let edgeFail: DeriveGateProblem | null = null;
  const needPair = (i: number, x: number, y: number) => { if (!edgeFail && !pairDiffers(i, x, y)) edgeFail = fail("edge", `${names[i]}: the edge between ${x} and ${y} in \`${expr}\` is not shown; add examples ${names[i]} = ${x} and ${names[i]} = ${y} (other arguments equal) with their different results`, i, [ptAt(i, x), ptAt(i, y)]); };
  const needDelta = (i: number, j: number, d0: number, d1: number) => { if (!edgeFail && !deltaDiffers(i, j, d0, d1)) edgeFail = fail("edge", `${names[i]} - ${names[j]}: the edge between ${d0} and ${d1} in \`${expr}\` is not shown; add two examples with ${names[i]} - ${names[j]} = ${d0} and ${d1} (one argument changed by 1) with different results`, i); };
  walk(program, (n) => {
    if (n.op === "eq" || n.op === "le") {
      const a = n.a, b = n.b;
      if (a.op === "param" && b.op === "lit" && typeof b.v === "number") { if (n.op === "eq") { needPair(a.i, b.v - 1, b.v); needPair(a.i, b.v, b.v + 1); } else needPair(a.i, b.v, b.v + 1); }
      else if (a.op === "lit" && b.op === "param" && typeof a.v === "number") needPair(b.i, a.v - 1, a.v);
      else if (a.op === "param" && b.op === "param") { if (n.op === "eq") { needDelta(a.i, b.i, -1, 0); needDelta(a.i, b.i, 0, 1); } else needDelta(a.i, b.i, 0, 1); }
    } else if (n.op === "range") { needPair(n.i, n.lo - 1, n.lo); needPair(n.i, n.hi, n.hi + 1); }
    else if (n.op === "empty") {
      const i = n.i;
      if (!edgeFail && !examples.some((e) => e.args[i] === "" && examples.some((f) => f.args[i] !== "" && rest(e.args, [i]) === rest(f.args, [i]) && out(e) !== out(f))))
        edgeFail = fail("edge", `${names[i]}: the test for an empty ${names[i]} in \`${expr}\` is not shown; add an example with ${names[i]} empty and one with it non-empty (other arguments equal) giving different results`, i);
    }
  });
  if (edgeFail) return edgeFail;
  // far (1): what the program does past its outermost edges is shown, not assumed.
  const lits = new Map<number, number[]>(), deltas = new Map<string, [number, number]>();
  walk(program, (n) => {
    const add = (i: number, ...cs: number[]) => lits.set(i, [...(lits.get(i) ?? []), ...cs]);
    if ((n.op === "eq" || n.op === "le") && n.a.op === "param" && n.b.op === "lit" && typeof n.b.v === "number") add(n.a.i, n.b.v);
    else if (n.op === "le" && n.a.op === "lit" && n.b.op === "param" && typeof n.a.v === "number") add(n.b.i, n.a.v);
    else if (n.op === "range") add(n.i, n.lo, n.hi);
    else if ((n.op === "eq" || n.op === "le") && n.a.op === "param" && n.b.op === "param") deltas.set(`${n.a.i},${n.b.i}`, [n.a.i, n.b.i]);
  });
  for (const [i, cs] of [...lits].sort((x, y) => x[0] - y[0])) {
    const hi = Math.max(...cs) + DERIVE_FAR, lo = Math.min(...cs) - DERIVE_FAR;
    if (!examples.some((e) => (e.args[i] as number) >= hi))
      return fail("far", `${names[i]}: \`${expr}\` has its last edge at ${hi - DERIVE_FAR}, but no example has ${names[i]} >= ${hi}; add one so the result past every edge is shown, not assumed`, i, [ptAt(i, hi)]);
    if (!examples.some((e) => (e.args[i] as number) <= lo))
      return fail("far", `${names[i]}: \`${expr}\` has its first edge at ${lo + DERIVE_FAR}, but no example has ${names[i]} <= ${lo}; add one so the result before every edge is shown, not assumed`, i, [ptAt(i, lo)]);
  }
  // far, caps (upstream scan, round 3: a cap with one witnessed side shown only up to 100 wide): a min / max cap is an
  // edge on the value it caps, so that value is shown at least DERIVE_FAR past the cap on each side the program can
  // reach at a neighbour or far probe (a floor below a lower cap, or a cap above, cannot hide past the examples).
  const capProbes = [...probeSet(params, examples), ...farProbes(params, examples)];
  let capFar: DeriveGateProblem | null = null;
  walk(program, (n) => {
    if (capFar || (n.op !== "min" && n.op !== "max")) return;
    const inner = (a: readonly DeriveValue[]) => evalProgram(n.a, a);
    const sub = compileProgram(n.a, names);
    for (const [side, target] of [[1, n.c + DERIVE_FAR], [-1, n.c - DERIVE_FAR]] as const) {
      const past = (a: readonly DeriveValue[]) => { const v = inner(a); return typeof v === "number" && (side > 0 ? v >= target : v <= target); };
      if (examples.some((e) => past(e.args))) continue;
      const reach = capProbes.filter(past).sort((x, y) => Math.abs((inner(x) as number) - target) - Math.abs((inner(y) as number) - target))[0];
      if (!reach) continue;
      capFar = fail("far", `\`${sub}\` is capped at ${n.c}, but no example has it ${side > 0 ? ">=" : "<="} ${target}; add one so the result ${side > 0 ? "past" : "before"} the cap is shown, not assumed`, undefined, [[...reach]]);
      // The other answer there: the cap lifted past the examples (a program that keeps the cap up to the last
      // example and then lets the value through fits every example as well).
      // When an outer cap hides the lift there (a clamp's floor seen past its ceiling), every cap is lifted instead,
      // so the refusal still asks rather than only naming the input.
      const mine = evalProgram(program, reach);
      let lifted = evalProgram(liftNode(program, n), reach);
      if (lifted === mine) lifted = evalProgram(liftCaps(program), reach);
      if (typeof mine === "number" && typeof lifted === "number" && mine !== lifted) capFar.rivals = [{ at: [...reach], values: [mine, lifted] }];
      return;
    }
  });
  if (capFar) return capFar;
  for (const [i, j] of deltas.values()) {
    const d = (e: DeriveExample) => (e.args[i] as number) - (e.args[j] as number);
    if (!examples.some((e) => d(e) >= DERIVE_FAR) || !examples.some((e) => d(e) <= -DERIVE_FAR))
      return fail("far", `${names[i]} - ${names[j]}: \`${expr}\` compares them, but no examples have ${names[i]} - ${names[j]} >= ${DERIVE_FAR} and <= -${DERIVE_FAR}; add them`, i);
  }
  // region (Auditor #491 round 2, the hidden island): an example inside every region the program distinguishes.
  const regionFail = regionProblem(program, params, examples);
  if (regionFail) return fail("region", regionFail.detail, regionFail.i, (regionFail.more?.length ? regionFail.more : [regionFail.v]).map((v) => ptAt(regionFail.i, v)));
  // span (Auditor #491 round 2, the unwitnessed cap): a value the program computes from a number parameter is shown
  // over a stretch at least DERIVE_FAR wide of that parameter, so a cap or clamp inside it would have been seen.
  for (const i of [...arithmeticParams(program)].sort((x, y) => x - y)) {
    if (params[i]!.type !== "number") continue;
    const vs = examples.map((e) => e.args[i] as number);
    const lo = Math.min(...vs), hi = Math.max(...vs);
    if (hi - lo < DERIVE_FAR)
      return fail("span", `${names[i]}: \`${expr}\` computes its result from ${names[i]}, but the examples only show ${names[i]} from ${lo} to ${hi}; add examples at least ${DERIVE_FAR} apart in ${names[i]} (e.g. ${names[i]} = ${lo + DERIVE_FAR}) so a cap or limit inside that stretch would show`, i, [ptAt(i, lo + DERIVE_FAR), ptAt(i, hi - DERIVE_FAR)]);
  }
  // span, result side (Auditor #491 round 2, cap lin2): a number result is shown on every side of 0 the program
  // reaches at a probe inside the examples' range of every parameter; `a * b` shown only negative is refused, so a cap above every shown result cannot hide there.
  if (input.ret === "number") {
    const shown = new Set(examples.map((e) => Math.sign(e.out as number)));
    const inside = (pt: readonly DeriveValue[]) => pt.every((x, j) => typeof x !== "number" || examples.some((e) => (e.args[j] as number) <= x) && examples.some((e) => x <= (e.args[j] as number)));
    for (const pt of [...probeSet(params, examples), ...farProbes(params, examples)]) {
      if (!inside(pt)) continue;
      const v = evalProgram(program, pt);
      if (typeof v !== "number" || v === 0 || shown.has(Math.sign(v))) continue;
      return fail("span", `the result: \`${expr}\` gives ${v} at (${pt.map((x) => JSON.stringify(x)).join(", ")}), but no example has a ${v > 0 ? "positive" : "negative"} result; add one there`, undefined, [[...pt]]);
    }
  }
  // span, result extremes (m100 practice, round 3: cap lin2 with a cap inside the examples' range): a number result
  // is shown at its largest and smallest over the examples' range of every number parameter (the corners of that
  // box), so a cap or floor between the largest shown result and what the program gives inside the box cannot hide.
  if (input.ret === "number" && arithmeticParams(program).size) {
    const outs = examples.map((e) => e.out as number), top = Math.max(...outs), bottom = Math.min(...outs);
    let corners: DeriveValue[][] = [[]];
    params.forEach((p, j) => {
      const vs = p.type === "number" ? [...new Set([Math.min(...examples.map((e) => e.args[j] as number)), Math.max(...examples.map((e) => e.args[j] as number))])] : [examples[0]!.args[j]!];
      corners = corners.flatMap((c) => vs.map((v) => [...c, v]));
    });
    let worst: { pt: DeriveValue[]; v: number; by: number } | null = null;
    for (const pt of corners) {
      const v = evalProgram(program, pt);
      if (typeof v !== "number") continue;
      const by = v > top ? v - top : v < bottom ? bottom - v : 0;
      if (by > 0 && (!worst || by > worst.by)) worst = { pt, v, by };
    }
    if (worst) return fail("span", `the result: \`${expr}\` gives ${worst.v} at (${worst.pt.map((x) => JSON.stringify(x)).join(", ")}), inside the examples' range of every parameter, but the examples' results only go from ${bottom} to ${top}; add that input so a cap or floor there is shown, not assumed`, undefined, [worst.pt]);
  }
  // span, sign (m100 practice, round 3: floor_clamp, `n` picked for `Math.max(61, n)` from examples 61..212): a value
  // the program computes from a number parameter is shown at that parameter's 0 or below, and, when the examples show
  // it negative at all, at least DERIVE_FAR below 0, so a floor between the smallest example and 0 (or far below it)
  // shows. A cap above every example is still not seen; the review note's far probes show the program's guess there.
  // Only where the program's result there is past every shown result (a floor already shown keeps it flat there).
  const outsN = input.ret === "number" ? examples.map((e) => e.out as number) : [];
  const beyond = (pt: DeriveValue[]) => { const v = evalProgram(program, pt); return typeof v === "number" && outsN.length > 0 && (v > Math.max(...outsN) || v < Math.min(...outsN)); };
  for (const i of [...arithmeticParams(program)].sort((x, y) => x - y)) {
    if (params[i]!.type !== "number" || input.ret !== "number") continue;
    const lo = Math.min(...examples.map((e) => e.args[i] as number));
    if (lo > 0 && beyond(ptAt(i, 0)))
      return fail("span", `${names[i]}: \`${expr}\` computes its result from ${names[i]}, but no example has ${names[i]} at 0 or below (smallest ${lo}); add ${names[i]} = 0 so a floor there would show`, i, [ptAt(i, 0)]);
    if (lo < 0 && lo > -DERIVE_FAR && beyond(ptAt(i, -DERIVE_FAR)))
      return fail("span", `${names[i]}: \`${expr}\` computes its result from ${names[i]} and the examples show it negative, but none at ${-DERIVE_FAR} or below (smallest ${lo}); add ${names[i]} = ${-DERIVE_FAR} so a floor there would show`, i, [ptAt(i, -DERIVE_FAR)]);
  }
  // branch / cap (2)
  const hits = new Map<DeriveNode, [number, number]>();
  for (const e of examples) evalProgram(program, e.args, (n, side) => { const h = hits.get(n) ?? [0, 0]; h[side]++; hits.set(n, h); });
  let reachFail: DeriveGateProblem | null = null;
  walk(program, (n) => {
    if (reachFail) return;
    if (n.op !== "if" && n.op !== "min" && n.op !== "max") return;
    const [s0, s1] = hits.get(n) ?? [0, 0];
    // A condition that holds for ONE input only (`p === c` or an emptiness test of the only parameter) has a
    // single-input true branch: one example is all there is to show (gate edge already asks for c - 1, c, c + 1).
    const point = n.op === "if" && params.length === 1 && (n.c.op === "empty" || (n.c.op === "eq" && ((n.c.a.op === "param" && n.c.b.op === "lit") || (n.c.a.op === "lit" && n.c.b.op === "param"))));
    if (s0 >= (point ? 1 : DERIVE_MIN_REACH) && s1 >= DERIVE_MIN_REACH) return;
    const sub = compileProgram(n, names);
    reachFail = n.op === "if"
      ? fail("branch", `\`${sub}\`: its condition is true for ${s0} example(s) and false for ${s1}; each branch needs at least ${DERIVE_MIN_REACH} examples`)
      : fail("cap", `\`${sub}\`: ${s0} example(s) below the cap ${n.c} and ${s1} past it; each side needs at least ${DERIVE_MIN_REACH} examples`);
  });
  if (reachFail) return reachFail;
  // rival (3)
  return rivalProblem(input, program, size, budget, spent);
}

/** The program with one min / max node replaced by the value it caps (the cap lifted). */
/** The program with every min / max cap removed (each replaced by the value it caps). */
function liftCaps(x: DeriveNode): DeriveNode {
  if (x.op === "min" || x.op === "max") return liftCaps((x as { a: DeriveNode }).a);
  const o: Record<string, unknown> = { ...x };
  for (const k of ["a", "b", "c", "t", "e"]) { const v = o[k]; if (v && typeof v === "object") o[k] = liftCaps(v as DeriveNode); }
  return o as DeriveNode;
}

function liftNode(x: DeriveNode, cap: DeriveNode): DeriveNode {
  if (x === cap) return (cap as { a: DeriveNode }).a;
  const o: Record<string, unknown> = { ...x };
  for (const k of ["a", "b", "c", "t", "e"]) { const v = o[k]; if (v && typeof v === "object") o[k] = liftNode(v as DeriveNode, cap); }
  return o as DeriveNode;
}

/**
 * Number parameters the program computes its result from (not only compares): a parameter leaf anywhere except as a
 * direct operand of a comparison (`===` / `<=`); range and emptiness tests compare only.
 */
export function arithmeticParams(n: DeriveNode): Set<number> {
  const s = new Set<number>();
  const go = (x: DeriveNode, cmp: boolean): void => {
    switch (x.op) {
      case "param": if (!cmp) s.add(x.i); return;
      case "int": case "lit": case "range": case "empty": return;
      case "eq": case "le": go(x.a, true); go(x.b, true); return;
      case "add": case "sub": case "mul": case "cat": case "and": case "or": go(x.a, false); go(x.b, false); return;
      case "sq": case "not": case "min": case "max": go(x.a, false); return;
      case "if": go(x.c, false); go(x.t, false); go(x.e, false); return;
    }
  };
  go(n, false);
  return s;
}

/**
 * The region gate (Auditor #491 round 2). The constants a number parameter is compared with cut its line into
 * regions (\`p <= c\` cuts between c and c + 1, \`c <= p\` between c - 1 and c, \`p === c\` on both sides of c, a range
 * at both of its ends). Inside every region, no stretch is left without an example: in a finite region of width w
 * the examples of that parameter there (the edge gate already puts one at each end) leave no gap longer than w / DERIVE_REGION_PARTS (8),
 * and in the open region past the first or last cut no gap longer than DERIVE_FAR between the cut and the farthest
 * example (the far gate puts one at least DERIVE_FAR past). A truth with a hidden band (an island the program does
 * not have) can then only hide in a stretch at most half its region wide; the refusal names the stretch.
 */
export function regionProblem(program: DeriveNode, params: readonly DeriveParam[], examples: readonly DeriveExample[]): { i: number; detail: string; v: number; more?: number[] } | null {
  const cuts = new Map<number, Set<number>>();
  const cut = (i: number, t: number) => { const s = cuts.get(i) ?? new Set<number>(); s.add(t); cuts.set(i, s); };
  walk(program, (n) => {
    if ((n.op === "eq" || n.op === "le") && n.a.op === "param" && n.b.op === "lit" && typeof n.b.v === "number") { if (n.op === "eq") cut(n.a.i, n.b.v - 1); cut(n.a.i, n.b.v); }
    else if (n.op === "le" && n.a.op === "lit" && n.b.op === "param" && typeof n.a.v === "number") cut(n.b.i, n.a.v - 1);
    else if (n.op === "range") { cut(n.i, n.lo - 1); cut(n.i, n.hi); }
  });
  for (const [i, set] of [...cuts].sort((x, y) => x[0] - y[0])) {
    const name = params[i]!.name;
    const ts_ = [...set].sort((x, y) => x - y);
    const vs = [...new Set(examples.map((e) => e.args[i] as number))].sort((x, y) => x - y);
    /** Largest gap between consecutive example values in [a, b] (inclusive), with its two ends. */
    const widest = (a: number, b: number): [number, number, number] | null => {
      const inside = vs.filter((v) => v >= a && v <= b);
      let best: [number, number, number] | null = null;
      for (let k = 1; k < inside.length; k++) { const g = inside[k]! - inside[k - 1]!; if (!best || g > best[0]) best = [g, inside[k - 1]!, inside[k]!]; }
      return best;
    };
    for (let k = 1; k < ts_.length; k++) {
      const a = ts_[k - 1]! + 1, b = ts_[k]!, w = b - a + 1;
      const g = widest(a, b);
      // m100 practice (round 3, hidden island): an eighth of the region, not half; a band hidden between two
      // examples of a bounded region is then at most an eighth of it wide, and the question asks in the gap.
      const limit = Math.max(DERIVE_REGION_MIN_GAP, Math.floor(w / DERIVE_REGION_PARTS));
      if (!g && w > 1) return { i, v: a + Math.floor(w / 2), detail: `${name}: the region ${a} to ${b} of the program has fewer than two examples inside; add examples there (e.g. ${name} = ${a + Math.floor(w / 2)})` };
      // Round 3: every bare stretch of the region is asked about (widest first, up to DERIVE_MAX_QUESTIONS), so the
      // answers close the region in a few rounds rather than one stretch a round.
      const inR = vs.filter((v) => v >= a && v <= b);
      const more = inR.slice(1).map((v, k) => [v - inR[k]!, inR[k]!] as const).filter(([gap]) => gap > limit).sort((x, y) => y[0] - x[0] || x[1] - y[1]).slice(0, DERIVE_MAX_QUESTIONS).map(([gap, from]) => from + Math.floor(gap / 2));
      if (g && g[0] > limit) return { i, v: g[1] + Math.floor(g[0] / 2), more, detail: `${name}: inside the region ${a} to ${b} no example has ${name} between ${g[1]} and ${g[2]} (more than an eighth of the region); add one there (e.g. ${name} = ${g[1] + Math.floor(g[0] / 2)}) so a band the examples hide is shown` };
    }
    const first = ts_[0]!, last = ts_[ts_.length - 1]!;
    const below = vs.filter((v) => v <= first), above = vs.filter((v) => v > last);
    const open: [number, number][] = [];
    if (below.length) open.push([below[0]!, first]);
    if (above.length) open.push([last + 1, above[above.length - 1]!]);
    for (const [a, b] of open) {
      const g = widest(a, b);
      if (g && g[0] > DERIVE_FAR) return { i, v: g[1] + Math.floor(g[0] / 2), detail: `${name}: past the program's ${a === last + 1 ? "last" : "first"} edge no example has ${name} between ${g[1]} and ${g[2]} (more than ${DERIVE_FAR} apart); add one there (e.g. ${name} = ${g[1] + Math.floor(g[0] / 2)})` };
    }
  }
  return null;
}

/**
 * Gate 3: the rival search (see gateProblem), in two passes, both DERIVE_RIVAL_EXTRA sizes past the fit:
 *  near  every example value as a constant; probes inside the examples' range (neighbour and far probes);
 *  far   (Auditor #491 B1) the constants the main search may use (witnessed edges); the far probes OUTSIDE the
 *        examples' range (past the outermost edges +10 / +100, 10x the largest value), no upper bound; negative
 *        values only for a parameter some example gives a negative value. (With every example value as a constant
 *        `p <= largest example` would rival every program that keeps going past the examples, so this pass uses
 *        the constants a fit could have been built from.)
 */
export function rivalProblem(input: DeriveInput, program: DeriveNode, size: number, budget = DERIVE_BUDGET, spent?: { searched: number }): DeriveGateProblem | null {
  const { params, examples } = input;
  const names = params.map((p) => p.name);
  const span = params.map((p, i) => (p.type === "number" ? [Math.min(...examples.map((e) => e.args[i] as number)), Math.max(...examples.map((e) => e.args[i] as number))] : null));
  const inside = (a: readonly DeriveValue[]) => span.every((s, i) => !s || ((a[i] as number) >= s[0]! && (a[i] as number) <= s[1]!));
  const shownSign = (a: readonly DeriveValue[]) => span.every((s, i) => !s || s[0]! < 0 || (a[i] as number) >= 0);
  const exKeys = new Set(examples.map((e) => keyOf(e.args)));
  const edges = edgesByParam(params, examples);
  const caps = repeatedResults(examples);
  const near = dedupePoints([...probeSet(params, examples), ...farProbes(params, examples)]).filter((a) => inside(a) && !exKeys.has(keyOf(a)));
  const far = farProbes(params, examples).filter((a) => !inside(a) && shownSign(a) && !exKeys.has(keyOf(a)));
  /** The corners of the examples' box (number parameters at their smallest / largest example value; others as in the first example). */
  const corners = span.reduce<DeriveValue[][]>((acc, sp, i) => acc.flatMap((a) => (sp ? [sp[0]!, sp[1]!] : [examples[0]!.args[i]!]).map((v) => [...a, v])), [[]]).slice(0, 64);
  const passes: { pass: "near" | "far"; probes: DeriveValue[][]; consts: number[][] }[] = [
    { pass: "near", probes: near, consts: params.map((p, i) => (p.type === "number" ? [...new Set([...edges[i]!, ...transitionValues(examples, i)])].sort((a, b) => a - b) : [])) },
    { pass: "far", probes: far, consts: edges },
  ];
  let searched = 0;
  // Round 3 (Peace): after a near rival the far pass still runs (same budget), so the refusal asks about both kinds
  // of rival at once; the refusal and its detail are the first rival's.
  let found: DeriveGateProblem | null = null;
  const asked: { at: DeriveValue[]; values: DeriveValue[] }[][] = [];
  for (const { pass, probes, consts } of passes) {
    if (probes.length === 0) continue;
    const points = [...examples.map((e) => e.args), ...probes];
    const mine = points.map((a) => evalProgram(program, a) ?? null);
    let rival: Prog | null = null;
    const r = runSearch({
      params, ret: input.ret, points, nEx: examples.length, target: examples.map((e) => e.out), consts, caps, pieces: stringPieces(examples),
      maxSize: size + DERIVE_RIVAL_EXTRA, budget: budget - searched, cells: keptCellsLimit(input),
      stop: () => false,
      onFit: (p) => { for (let k = examples.length; k < points.length; k++) if (p.vals[k] !== null && mine[k] !== null && p.vals[k] !== mine[k]) { rival = p; return true; } return false; },
    });
    searched += r.searched;
    if (spent) spent.searched = searched;
    if (rival) {
      const rv = rival as Prog;
      let k = examples.length;
      while (!(rv.vals[k] !== null && mine[k] !== null && rv.vals[k] !== mine[k])) k++;
      const pt = points[k]!;
      const rivals = dedupePoints(pass === "near" ? [...near, ...corners] : far).filter((a) => !exKeys.has(keyOf(a)))
        .map((a) => ({ at: [...a], values: [evalProgram(rv.node, a) ?? null, evalProgram(program, a) ?? null] as DeriveValue[] }))
        .filter((q) => q.values[0] !== null && q.values[1] !== null && q.values[0] !== q.values[1])
        // A near rival is asked about inside the examples' range only (asking past it would only move the range out,
        // round after round): the near probes and the corners of the examples' box, the rival evaluated at each. A
        // far rival differs past the examples only: its far probes. Ask first where
        // the two differ most (number results), so one answer rules out the most programs (a cap just above the shown
        // results would otherwise be asked about one step at a time). Stable: ties keep probe order.
        .map((q, o) => ({ q, o, d: typeof q.values[0] === "number" && typeof q.values[1] === "number" ? Math.abs(q.values[0] - q.values[1]) : 0 }))
        .sort((x, y) => y.d - x.d || x.o - y.o).map((x) => x.q).slice(0, DERIVE_MAX_QUESTIONS);
      asked.push(rivals);
      found ??= { gate: "rival", searched: 0, detail: `\`${compileProgram(rv.node, names)}\` also fits every example but differs from \`${compileProgram(program, names)}\` at (${pt.map((v) => JSON.stringify(v)).join(", ")}): ${JSON.stringify(rv.vals[k])} vs ${JSON.stringify(mine[k])}${pass === "far" ? " (a far probe, past the examples)" : ""}; add an example there` };
      continue;
    }
    if (r.overBudget && found) break;
    if (r.overBudget) return { gate: "rival_budget", searched, detail: `the ${pass} rival search (${pass === "near" ? "every example value" : "the witnessed edges"} as constants, up to size ${size + DERIVE_RIVAL_EXTRA}) ran out of budget after ${r.searched} programs` };
  }
  if (!found) return null;
  // Questions: each pass's best first, round-robin (at most DERIVE_MAX_QUESTIONS).
  const rivals: { at: DeriveValue[]; values: DeriveValue[] }[] = [];
  for (let j = 0; rivals.length < DERIVE_MAX_QUESTIONS && asked.some((q) => j < q.length); j++) for (const q of asked) if (j < q.length && rivals.length < DERIVE_MAX_QUESTIONS) rivals.push(q[j]!);
  return { ...(found as DeriveGateProblem), searched, rivals };
}

/**
 * The example values of number parameter i a near rival may use as constants (round 3): the smallest and largest, and
 * each value whose result differs from the next or previous example's in that parameter's order. A constant inside a
 * run of examples with one result moves a threshold within that run, which every fitting rival can do with the run's
 * ends; leaving those out keeps a densely shown region (S1's 500..599 every 10) from multiplying the search.
 */
export function transitionValues(examples: readonly DeriveExample[], i: number): number[] {
  const byV = new Map<number, string>();
  for (const e of examples) { const v = e.args[i] as number, o = JSON.stringify(e.out); byV.set(v, byV.has(v) && byV.get(v) !== o ? "*" : o); }
  const vs = [...byV.keys()].sort((a, b) => a - b);
  return vs.filter((v, k) => k === 0 || k === vs.length - 1 || byV.get(v) === "*" || byV.get(v) !== byV.get(vs[k - 1]!) || byV.get(v) !== byV.get(vs[k + 1]!));
}

/** The far-probe output table of a program (for the candidate's review note): at most `limit` rows. */
export function farProbeTable(program: DeriveNode, params: readonly DeriveParam[], examples: readonly DeriveExample[], limit = 24): { args: DeriveValue[]; out: DeriveValue | undefined }[] {
  return farProbes(params, examples).slice(0, limit).map((args) => ({ args, out: evalProgram(program, args) }));
}
