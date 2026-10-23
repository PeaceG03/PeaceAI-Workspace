// M99 (DERIVE_FROM_BEHAVIOR v1): PeaceAI's own program search. Given a new pure function's typed signature and
// input -> output examples (data only, never code), it writes the function body itself: a bounded, enumerative,
// bottom-up search over a small typed DSL, keeping one program per distinct behavior on a fixed point set (the
// examples plus deterministic boundary probes around each example). It returns the SMALLEST program that fits
// every example, and refuses instead of guessing:
//   - derive_no_fit      nothing up to the size limit fits every example (or the only fit reads no parameter);
//   - derive_ambiguous   another program, at most DERIVE_SLACK nodes larger than the smallest fit, also fits every
//                        example but disagrees with it on a probe;
//   - derive_budget      the search budget (programs built, or kept-value memory) ran out before a fit was found;
//   - derive_examples    contradictory, mistyped or out-of-range examples.
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
  | { ok: false; reason: "derive_no_fit" | "derive_ambiguous" | "derive_budget" | "derive_examples"; detail?: string; alternatives?: DeriveFit[]; probe?: DeriveValue[]; searched: number };

export const DERIVE_MAX_SIZE = 13;
export const DERIVE_BUDGET = 4_000_000;
export const DERIVE_MAX_EXAMPLES = 40;
export const DERIVE_MAX_PARAMS = 3;
/** A fit is accepted only if no other behavior fits within this many extra nodes. */
export const DERIVE_SLACK = 1;
export const DERIVE_MAX_STRING = 120;
/** Longest compiled expression (characters); longer is refused (derive_expr_size), so the module is bounded. */
export const DERIVE_MAX_EXPR_CHARS = 400;
const MAX_POINTS = 400;
/** Memory bound: total characters of kept value vectors; past it the search stops (derive_budget). */
const MAX_KEPT_CHARS = 64_000_000;
const MAX_INT = 1e12;

interface Prog { node: DeriveNode; size: number; vals: DeriveValue[]; usesParam: boolean }

const isInt = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && Math.abs(v) <= MAX_INT;
const typeOf = (v: DeriveValue): DeriveType => (typeof v === "number" ? "number" : typeof v === "string" ? "string" : "boolean");
const keyOf = (vals: readonly DeriveValue[]): string => JSON.stringify(vals);

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
    if (!seen.has(k) && out.length < MAX_POINTS) { seen.add(k); out.push(args); }
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

/** Evaluates a program on one argument list; undefined when a value leaves the integer range. */
export function evalProgram(n: DeriveNode, args: readonly DeriveValue[]): DeriveValue | undefined {
  const num = (x: DeriveNode) => evalProgram(x, args) as number | undefined;
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
    case "min": case "max": { const a = num(n.a); return a === undefined ? undefined : n.op === "min" ? (a <= n.c ? a : n.c) : (n.c <= a ? a : n.c); }
    case "cat": {
      const a = evalProgram(n.a, args), b = evalProgram(n.b, args);
      if (typeof a !== "string" || typeof b !== "string") return undefined;
      const r = a + b;
      return r.length <= 4 * DERIVE_MAX_STRING ? r : undefined;
    }
    case "eq": { const a = evalProgram(n.a, args), b = evalProgram(n.b, args); return a === undefined || b === undefined ? undefined : a === b; }
    case "le": { const a = num(n.a), b = num(n.b); return a === undefined || b === undefined ? undefined : a <= b; }
    case "range": { const p = args[n.i] as number; return n.lo <= p && p <= n.hi; }
    case "empty": return args[n.i] === "";
    case "and": case "or": {
      const a = evalProgram(n.a, args), b = evalProgram(n.b, args);
      if (typeof a !== "boolean" || typeof b !== "boolean") return undefined;
      return n.op === "and" ? a && b : a || b;
    }
    case "not": { const a = evalProgram(n.a, args); return typeof a === "boolean" ? !a : undefined; }
    case "if": { const c = evalProgram(n.c, args); if (typeof c !== "boolean") return undefined; return evalProgram(c ? n.t : n.e, args); }
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
  const s = new Set<number>();
  params.forEach((p, i) => {
    if (p.type !== "number") return;
    const byRest = new Map<string, Map<number, string>>();
    for (const ex of examples) {
      const rest = keyOf(ex.args.filter((_, j) => j !== i));
      const m = byRest.get(rest) ?? new Map<number, string>();
      m.set(ex.args[i] as number, keyOf([ex.out]));
      byRest.set(rest, m);
    }
    for (const m of byRest.values()) for (const [v, o] of m) { const o1 = m.get(v + 1); if (o1 !== undefined && o1 !== o) { s.add(v); s.add(v + 1); } }
  });
  return [...s].sort((a, b) => a - b);
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
function stringPieces(input: DeriveInput): string[] {
  const support = new Map<string, number>();
  for (const ex of input.examples) {
    if (typeof ex.out !== "string") continue;
    const cuts = [...new Set(ex.args.filter((a): a is string => typeof a === "string" && a.length > 0))].sort((a, b) => b.length - a.length);
    let parts = [ex.out];
    for (const c of cuts) parts = parts.flatMap((p) => p.split(c));
    for (const p of new Set(parts)) if (p.length > 0 && p.length <= DERIVE_MAX_STRING) support.set(p, (support.get(p) ?? 0) + 1);
  }
  return ["", ...[...support].filter(([, n]) => n >= 2).map(([p]) => p)].sort();
}

/**
 * The search. Bottom-up by size; level s of each type is built only from smaller levels; one program per value
 * vector over (examples + probes) is kept (the first, i.e. smallest, one built). At the first size where some
 * parameter-reading program matches every example, DERIVE_SLACK more levels are built and: exactly one such
 * behavior up to there -> the fit; more than one -> derive_ambiguous (they agree on every example, so they
 * disagree on a probe). A program constant over every point never counts as reading a parameter.
 */
export function deriveProgram(input: DeriveInput): DeriveResult {
  const problem = examplesProblem(input);
  if (problem) return { ok: false, reason: "derive_examples", detail: problem, searched: 0 };
  const maxSize = Math.min(input.maxSize ?? DERIVE_MAX_SIZE, DERIVE_MAX_SIZE);
  const budget = Math.min(input.budget ?? DERIVE_BUDGET, DERIVE_BUDGET);
  const probes = probeSet(input.params, input.examples);
  const points: DeriveValue[][] = [...input.examples.map((e) => e.args), ...probes];
  const nEx = input.examples.length;
  const target = input.examples.map((e) => e.out);
  const names = input.params.map((p) => p.name);
  const consts = edgeConstants(input.params, input.examples);
  const caps = repeatedResults(input.examples);
  const pieces = stringPieces(input);
  const types: DeriveType[] = ["number", "string", "boolean"];
  const levels: Record<DeriveType, Prog[][]> = { number: [[]], string: [[]], boolean: [[]] };
  const guards: Prog[] = []; // if-guards: emptiness / equality atoms
  const seen: Record<DeriveType, Set<string>> = { number: new Set(), string: new Set(), boolean: new Set() };
  let searched = 0;
  let keptChars = 0;
  let overBudget = false;
  const fits: Prog[] = [];
  const slack = Math.max(0, Math.min(input.slack ?? DERIVE_SLACK, DERIVE_SLACK));
  let first = 0;
  // Every fit is a distinct behavior on (examples + probes) (one program kept per value vector), so more than one
  // fit up to the first fitting size + slack means the examples leave the behavior open: refuse.
  const decide = (): DeriveResult => {
    const best = fits[0]!;
    if (fits.length === 1) return { ok: true, fit: { program: best.node, size: best.size, expr: compileProgram(best.node, names) }, probes, searched };
    const b = fits[1]!;
    let k = nEx;
    while (k < points.length && best.vals[k] === b.vals[k]) k++;
    return { ok: false, reason: "derive_ambiguous", alternatives: fits.slice(0, 4).map((f) => ({ program: f.node, size: f.size, expr: compileProgram(f.node, names) })), probe: points[k], searched };
  };

  const P = points.length;
  const fitsExamples = (vals: readonly DeriveValue[]) => { for (let k = 0; k < nEx; k++) if (vals[k] !== target[k]) return false; return true; };
  // `vals` is built from the children's vectors (same semantics as evalProgram; null when a value leaves the range).
  const push = (ty: DeriveType, size: number, node: DeriveNode, usesParam: boolean, vals: DeriveValue[] | null, guard = false): void => {
    if (overBudget) return;
    if (++searched > budget) { overBudget = true; return; }
    if (!vals) return;
    const k = keyOf(vals);
    if (seen[ty].has(k)) return;
    seen[ty].add(k);
    if ((keptChars += k.length) > MAX_KEPT_CHARS) { overBudget = true; return; }
    // A program whose value is the same at every point reads a parameter only syntactically (p && !p): constant.
    let varies = false;
    for (let j = 1; j < vals.length && !varies; j++) if (vals[j] !== vals[0]) varies = true;
    const p: Prog = { node, size, vals, usesParam: usesParam && varies };
    (levels[ty][size] ??= []).push(p);
    if (guard) guards.push(p);
    if (ty === input.ret && p.usesParam && fitsExamples(vals)) fits.push(p);
  };
  const map1 = <T extends DeriveValue>(f: (k: number) => T | undefined): T[] | null => {
    const out: T[] = new Array(P);
    for (let k = 0; k < P; k++) { const v = f(k); if (v === undefined) return null; out[k] = v; }
    return out;
  };
  const intOk = (r: number) => (isInt(r) ? r : undefined);
  const byNode = (node: DeriveNode): DeriveValue[] | null => map1((k) => evalProgram(node, points[k]!));
  const at = (ty: DeriveType, s: number): Prog[] => levels[ty][s] ?? [];
  const guardAt = (s: number) => guards.filter((g) => g.size === s);

  for (let size = 1; size <= maxSize && !overBudget; size++) {
    for (const ty of types) levels[ty][size] ??= [];
    // Leaves.
    if (size === 1) {
      input.params.forEach((p, i) => { const n: DeriveNode = { op: "param", i }; push(p.type, 1, n, true, byNode(n)); });
      for (const v of [1, 2]) { const n: DeriveNode = { op: "int", v }; push("number", 1, n, false, byNode(n)); }
      for (const v of pieces) { const n: DeriveNode = { op: "lit", v }; push("string", 1, n, false, byNode(n)); }
    }
    // Boolean atoms over parameters.
    input.params.forEach((p, i) => {
      const par: DeriveNode = { op: "param", i };
      if (p.type === "number") {
        if (size === 3) {
          for (const c of consts) {
            const lit: DeriveNode = { op: "lit", v: c };
            push("boolean", 3, { op: "eq", a: par, b: lit }, true, map1((k) => points[k]![i] === c), true);
            push("boolean", 3, { op: "le", a: par, b: lit }, true, map1((k) => (points[k]![i] as number) <= c));
            push("boolean", 3, { op: "le", a: lit, b: par }, true, map1((k) => c <= (points[k]![i] as number)));
          }
          input.params.forEach((q, j) => {
            if (q.type !== "number" || j === i) return;
            const pj: DeriveNode = { op: "param", i: j };
            if (i < j) push("boolean", 3, { op: "eq", a: par, b: pj }, true, map1((k) => points[k]![i] === points[k]![j]));
            push("boolean", 3, { op: "le", a: par, b: pj }, true, map1((k) => (points[k]![i] as number) <= (points[k]![j] as number)));
          });
        }
        if (size === 4) for (let x = 0; x < consts.length; x++) for (let y = x + 1; y < consts.length; y++) {
          const lo = consts[x]!, hi = consts[y]!;
          push("boolean", 4, { op: "range", i, lo, hi }, true, map1((k) => lo <= (points[k]![i] as number) && (points[k]![i] as number) <= hi));
        }
      } else if (p.type === "string") {
        if (size === 2) push("boolean", 2, { op: "empty", i }, true, map1((k) => points[k]![i] === ""), true);
      }
    });
    // Unary nodes.
    for (const a of at("number", size - 1)) if (a.usesParam) { const v = a.vals as number[]; push("number", size, { op: "sq", a: a.node }, true, map1((k) => intOk(v[k]! * v[k]!))); }
    for (const a of at("boolean", size - 1)) { const v = a.vals as boolean[]; push("boolean", size, { op: "not", a: a.node }, a.usesParam, map1((k) => !v[k])); }
    for (const a of at("number", size - 2)) if (a.usesParam) for (const c of caps) {
      const v = a.vals as number[];
      push("number", size, { op: "min", c, a: a.node }, true, map1((k) => (v[k]! <= c ? v[k]! : c)));
      push("number", size, { op: "max", c, a: a.node }, true, map1((k) => (c <= v[k]! ? v[k]! : c)));
    }
    // Binary nodes: sizes la + lb = size - 1.
    for (let la = 1; la <= size - 2 && !overBudget; la++) {
      const lb = size - 1 - la;
      for (const a of at("number", la)) for (const b of at("number", lb)) {
        if (!a.usesParam && !b.usesParam) continue;
        const x = a.vals as number[], y = b.vals as number[];
        if (la <= lb) {
          push("number", size, { op: "add", a: a.node, b: b.node }, true, map1((k) => intOk(x[k]! + y[k]!)));
          push("number", size, { op: "mul", a: a.node, b: b.node }, true, map1((k) => intOk(x[k]! * y[k]!)));
        }
        push("number", size, { op: "sub", a: a.node, b: b.node }, true, map1((k) => intOk(x[k]! - y[k]!)));
      }
      for (const a of at("string", la)) for (const b of at("string", lb)) {
        if (!a.usesParam && !b.usesParam) continue;
        if ((a.node.op === "lit" && a.node.v === "") || (b.node.op === "lit" && b.node.v === "")) continue;
        const x = a.vals as string[], y = b.vals as string[];
        push("string", size, { op: "cat", a: a.node, b: b.node }, true, map1((k) => { const r = x[k]! + y[k]!; return r.length <= 4 * DERIVE_MAX_STRING ? r : undefined; }));
      }
      if (la <= lb) for (const a of at("boolean", la)) for (const b of at("boolean", lb)) {
        const x = a.vals as boolean[], y = b.vals as boolean[];
        push("boolean", size, { op: "and", a: a.node, b: b.node }, a.usesParam || b.usesParam, map1((k) => x[k]! && y[k]!));
        push("boolean", size, { op: "or", a: a.node, b: b.node }, a.usesParam || b.usesParam, map1((k) => x[k]! || y[k]!));
      }
    }
    // Conditionals: if(G, x, y) with |G| + |x| + |y| = size - 1; number branches may also be K constants.
    for (let lg = 2; lg <= Math.min(3, size - 3) && !overBudget; lg++) {
      for (const g of guardAt(lg)) for (let lt = 1; lt <= size - 2 - lg; lt++) {
        const le = size - 1 - lg - lt;
        if (le < 1) continue;
        const gv = g.vals as boolean[];
        for (const ty of ["number", "string"] as const) {
          const constLeaves = (n: number) => (ty === "number" && n === 1 ? caps.map((c) => ({ node: { op: "lit", v: c } as DeriveNode, vals: new Array<DeriveValue>(P).fill(c) })) : []);
          const xs = [...at(ty, lt), ...constLeaves(lt)], ys = [...at(ty, le), ...constLeaves(le)];
          for (const x of xs) for (const y of ys) {
            if (x.node === y.node || (x.node.op === "lit" && y.node.op === "lit" && x.node.v === y.node.v)) continue;
            const xv = x.vals, yv = y.vals;
            push(ty, size, { op: "if", c: g.node, t: x.node, e: y.node }, true, map1((k) => (gv[k] ? xv[k] : yv[k])));
          }
        }
      }
    }
    if (overBudget) break;
    if (fits.length > 0 && first === 0) first = size;
    // Decide once the slack levels above the first fitting size are built (or the size limit is reached).
    if (first > 0 && (size >= first + slack || size === maxSize)) return decide();
  }
  if (first > 0 && !overBudget) return decide();
  return { ok: false, reason: overBudget ? "derive_budget" : "derive_no_fit", searched };
}
