// M113 (public-derive-from-behavior-v4): the list-input extension of PeaceAI's derive engine (peaceai/lib/derive.ts).
// v1-v3 derive scalar functions only. Health-check slice 2 needs functions over a LIST of check-ins: a summary
// (how many errored, the oldest age, is any part silent) and pruning (keep only the check-ins inside the keep window).
// This module derives such a function from examples alone, the same way: a bounded enumeration over a small typed
// DSL, every constant cut from the examples, and a refusal instead of a guess.
//
// Inputs: exactly ONE list parameter, `T[]` where T is number, string, boolean or a simple record type
// `{ a: number; b: string }` (1-4 fields of those three types), plus at most ONE scalar parameter (number or string)
// that a predicate may compare with. No nested lists, no optional fields, no string parsing.
// The DSL (x is the element, E is x itself or one field x.f, P a predicate on one element):
//   P        : E <= C | C <= E | E === C (number) | E <= t | t <= E | E < t | t < E | E === t | E !== t
//              (t the scalar parameter)
//            | E | !E (boolean) | E === S | E !== S (string; S a string seen in the example elements, "" included)
//   number   : L.length | count(P) = L.filter(P).length | sum(E) | sum(E) of L.filter(P) (the kept elements)
//            | max(E) or D when empty | min(E) or D when empty
//   boolean  : L.some(P) | L.every(P)
//   T[]      : L.filter(P)                                  (prune: keep the elements where P holds, in order)
//   label[]  : L.map(P ? A : B) (A, B strings of the outputs) | L.map(P) (boolean[])
//   field[]  : L.map(x.f) | L.filter(P).map(x.f)            (records only)
// Constants: C is an element value of that field in the examples, or one more / one less (so both sides of a
// threshold are candidates); D is the output of an example with the empty list; A and B are output strings.
//
// Fail closed, in this order:
//   derive_examples          3-40 examples, every value typed as declared, list lengths at most LIST_MAX_ELEMS,
//                            no contradiction, not all outputs equal;
//   derive_under_specified_empty / _many: an example with the empty list and one with at least 3 elements;
//   (unsplit predicates)     a P true on every example element, or false on every one, stays a candidate like any
//                            other (so "count x >= 0" over non-negative examples is a rival of the length and the
//                            task is derive_ambiguous, with a question). The one exception: a constant cut `E <= C` /
//                            `C <= E` with |C| >= DERIVE_FAR is dropped (the far gate's distance; without it every
//                            example set has an unsplit cut at its own smallest or largest value, and asking past it
//                            only moves that cut);
//   derive_budget            more than LIST_MAX_CANDIDATES programs or LIST_MAX_EVALS evaluations;
//   derive_no_fit            no program fits every example;
//   derive_ambiguous         two programs fit every example but give different results on some probe list
//                            (the ambiguity check covers EVERY fitting program, not only the smallest ones);
//   derive_under_specified_<gate>: the unique fit relies on something the examples do not show: unread (the scalar
//                            parameter is never read), branch (P true and false on at least DERIVE_MIN_REACH example
//                            elements each), kept (a count / filter / sum or field of the kept elements needs one
//                            example list where P holds on 2 or more elements), seed (max / min with the empty-list
//                            result D: some non-empty example list must give a max below D / a min above D, else
//                            "the max, but at least D" reads the same examples; a sum (D = 0): when some probe list
//                            gives a sum below D - DERIVE_FAR (else below D), an example must too, and the same above
//                            D + DERIVE_FAR (else above D), else a floor or a cap reads the same examples), edge (a
//                            threshold's both sides: E = C and E = C + 1, or E - t = 0 and 1), far (an element at
//                            least DERIVE_FAR past the threshold on each side).
// Programs that agree on every probe list are one behavior; the smallest (then the first enumerated) is emitted.
// Compiled programs call only filter / some / every / map / reduce and read .length on the list parameter, with
// arrow callbacks over the element (no mutation: sort, push, splice and friends are not in the DSL). listExprProblem
// re-checks emitted text by decompiling it back into the DSL and recompiling it to the identical text (Job A and B).
import ts from "typescript";
import { DERIVE_FAR, DERIVE_MAX_STRING, DERIVE_MIN_REACH, type DeriveType, type DeriveValue } from "./derive.ts";

export interface ListField { name: string; type: DeriveType }
export type ListElemType = DeriveType | { fields: ListField[] };
export interface ListType { list: ListElemType }
export type ListParamType = DeriveType | ListType;
export interface ListParam { name: string; type: ListParamType }
export type ListRecord = { readonly [k: string]: DeriveValue };
export type ListElem = DeriveValue | ListRecord;
export type ListArg = DeriveValue | readonly ListElem[];
export interface ListExample { args: ListArg[]; out: ListArg }
export interface ListInput {
  params: ListParam[]; ret: ListParamType; examples: ListExample[]; maxCandidates?: number; maxEvals?: number;
  /**
   * G17 (public-derive-from-behavior-v6, rule param dsl typed-dsl-v6-nonfinite only): a number value in the examples
   * may also be NaN, Infinity or -Infinity, and when an example element is one of them the predicates
   * Number.isFinite(E) / !Number.isFinite(E) join the search. Off (the default, v4): examples, search, gates and
   * refusals are unchanged.
   */
  nonFinite?: boolean;
}

export type ListPred =
  | { op: "le" | "ge" | "eqn"; f: string | null; c: number }
  | { op: "lep" | "gep" | "ltp" | "gtp" | "eqp" | "nep"; f: string | null; p: number }
  | { op: "is" | "not"; f: string | null }
  | { op: "eqs" | "nes"; f: string | null; s: string }
  /** G17 (v6 only): Number.isFinite(E) / !Number.isFinite(E). */
  | { op: "fin" | "nfin"; f: string | null };
export type ListProgram =
  | { op: "length" }
  | { op: "count" | "filter" | "some" | "every"; pred: ListPred }
  | { op: "sum"; f: string | null; pred: ListPred | null }
  | { op: "max" | "min"; f: string | null; empty: number }
  | { op: "test"; pred: ListPred }
  | { op: "label"; pred: ListPred; yes: string; no: string }
  | { op: "pluck"; f: string; pred: ListPred | null };

export type ListGate = "empty" | "many" | "unread" | "branch" | "kept" | "seed" | "edge" | "far";
export interface ListQuestion { at: ListArg[]; answers: ListArg[] }
export type ListResult =
  | { ok: true; program: ListProgram; size: number; fits: number; searched: number }
  | { ok: false; reason: "derive_examples" | "derive_no_fit" | "derive_ambiguous" | "derive_budget" | "derive_under_specified"; gate?: ListGate; param?: string; detail: string; questions?: ListQuestion[]; searched: number };

export const LIST_MIN_EXAMPLES = 3;
export const LIST_MAX_EXAMPLES = 40;
/** Most elements in one example list (and in any probe list). */
export const LIST_MAX_ELEMS = 12;
export const LIST_MAX_FIELDS = 4;
/** One list parameter plus at most one scalar parameter. */
export const LIST_MAX_PARAMS = 2;
/** The search refuses (derive_budget) past this many candidate programs... */
export const LIST_MAX_CANDIDATES = 50_000;
/** ...or this many program evaluations (examples and probes together). */
export const LIST_MAX_EVALS = 40_000_000;
/** Most probe argument vectors the ambiguity check builds. */
export const LIST_MAX_PROBES = 60_000;
const MAX_INT = 1e12;
const isInt = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && Math.abs(v) <= MAX_INT;
/** G17: NaN, Infinity or -Infinity (an example value only v6 accepts). */
export const isNonFinite = (v: unknown): v is number => typeof v === "number" && !Number.isFinite(v);
/** G17: whether any example argument, element, record field or result holds NaN, Infinity or -Infinity. */
export function hasNonFinite(examples: readonly ListExample[]): boolean {
  const walk = (v: unknown): boolean => (Array.isArray(v) ? v.some(walk) : v && typeof v === "object" ? Object.values(v).some(walk) : isNonFinite(v));
  return examples.some((e) => e.args.some(walk) || walk(e.out));
}

// ---------------------------------------------------------------------------------------------------------------
// Types

export const isListType = (t: ListParamType): t is ListType => typeof t === "object";
export const listIndex = (params: readonly ListParam[]): number => params.findIndex((p) => isListType(p.type));
const elemOf = (params: readonly ListParam[]): ListElemType => (params[listIndex(params)]!.type as ListType).list;
/** The type of E (x itself or x.f), or null when the field does not exist. */
export function valueType(elem: ListElemType, f: string | null): DeriveType | null {
  if (typeof elem === "string") return f === null ? elem : null;
  if (f === null) return null;
  return elem.fields.find((x) => x.name === f)?.type ?? null;
}
const fieldsOf = (elem: ListElemType): (string | null)[] => (typeof elem === "string" ? [null] : elem.fields.map((f) => f.name));

/** `number`, `string[]`, `{ part: string; ageDays: number }[]`: the one spelling the emitted code uses. */
export function formatListType(t: ListParamType): string {
  if (!isListType(t)) return t;
  const e = t.list;
  return typeof e === "string" ? `${e}[]` : `{ ${e.fields.map((f) => `${f.name}: ${f.type}`).join("; ")} }[]`;
}
const NAME_RE = /^[A-Za-z_$][\w$]{0,63}$/;
/** Parses the header spelling of a type (record fields separated by `;` or `,`); null when outside v4's types. */
export function parseListType(text: string): ListParamType | null {
  const s = text.trim();
  if (/^(?:number|string|boolean)$/.test(s)) return s as DeriveType;
  const m = /^(number|string|boolean)\[\]$/.exec(s);
  if (m) return { list: m[1] as DeriveType };
  const r = /^\{ ?([^{}]*?) ?\}\[\]$/.exec(s);
  if (!r) return null;
  const parts = r[1]!.split(/ ?[;,] ?/).map((x) => x.trim());
  if (parts.at(-1) === "") parts.pop();
  if (parts.length < 1 || parts.length > LIST_MAX_FIELDS) return null;
  const fields: ListField[] = [];
  for (const p of parts) {
    const f = /^([A-Za-z_$][\w$]{0,63}): ?(number|string|boolean)$/.exec(p);
    if (!f || fields.some((x) => x.name === f[1])) return null;
    fields.push({ name: f[1]!, type: f[2] as DeriveType });
  }
  return { list: { fields } };
}

const scalarOk = (v: unknown, t: DeriveType, nonFinite = false): boolean =>
  t === "number" ? isInt(v) || (nonFinite && isNonFinite(v)) : t === "string" ? typeof v === "string" && v.length <= DERIVE_MAX_STRING : typeof v === "boolean";
function elemOk(v: unknown, t: ListElemType, nonFinite = false): boolean {
  if (typeof t === "string") return scalarOk(v, t, nonFinite);
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  const keys = Object.keys(v);
  return keys.length === t.fields.length && t.fields.every((f) => Object.prototype.hasOwnProperty.call(v, f.name) && scalarOk((v as ListRecord)[f.name], f.type, nonFinite));
}
/**
 * A value matches a declared type (lists: at most LIST_MAX_ELEMS elements of the element type). A number is an
 * integer; with `nonFinite` (G17, v6 only) it may also be NaN, Infinity or -Infinity.
 */
export function valueOk(v: unknown, t: ListParamType, nonFinite = false): boolean {
  if (!isListType(t)) return scalarOk(v, t, nonFinite);
  return Array.isArray(v) && v.length <= LIST_MAX_ELEMS && v.every((e) => elemOk(e, t.list, nonFinite));
}

/**
 * Canonical JSON of a value (record keys sorted), for comparing and grouping. G17: NaN, Infinity and -Infinity are
 * their own keys (JSON would write all three as null), so two values have one key exactly when Object.is holds,
 * except 0 and -0 (one key, as before; the examples never write -0).
 */
export function valueKey(v: unknown): string {
  if (isNonFinite(v)) return String(v);
  if (Array.isArray(v)) return `[${v.map(valueKey).join(",")}]`;
  if (v && typeof v === "object") return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${valueKey((v as ListRecord)[k])}`).join(",")}}`;
  return JSON.stringify(v);
}

// ---------------------------------------------------------------------------------------------------------------
// Evaluation, size, typing

const get = (x: ListElem, f: string | null): DeriveValue => (f === null ? (x as DeriveValue) : (x as ListRecord)[f]!);
export function evalPred(p: ListPred, x: ListElem, args: readonly ListArg[]): boolean {
  const e = get(x, p.f);
  switch (p.op) {
    case "le": return (e as number) <= p.c;
    case "ge": return p.c <= (e as number);
    case "eqn": return e === p.c;
    case "lep": return (e as number) <= (args[p.p] as number);
    case "gep": return (args[p.p] as number) <= (e as number);
    case "ltp": return (e as number) < (args[p.p] as number);
    case "gtp": return (args[p.p] as number) < (e as number);
    case "eqp": return e === args[p.p];
    case "nep": return e !== args[p.p];
    case "is": return e === true;
    case "not": return e !== true;
    case "eqs": return e === p.s;
    case "nes": return e !== p.s;
    case "fin": return Number.isFinite(e);
    case "nfin": return !Number.isFinite(e);
  }
}
export function evalList(prog: ListProgram, args: readonly ListArg[], li: number): ListArg {
  const L = args[li] as readonly ListElem[];
  switch (prog.op) {
    case "length": return L.length;
    case "count": return L.filter((x) => evalPred(prog.pred, x, args)).length;
    case "filter": return L.filter((x) => evalPred(prog.pred, x, args));
    case "some": return L.some((x) => evalPred(prog.pred, x, args));
    case "every": return L.every((x) => evalPred(prog.pred, x, args));
    case "sum": return (prog.pred ? L.filter((x) => evalPred(prog.pred!, x, args)) : L).reduce<number>((n, x) => n + (get(x, prog.f) as number), 0);
    case "max": return L.reduce<number>((m, x, i) => (i === 0 || m <= (get(x, prog.f) as number) ? (get(x, prog.f) as number) : m), prog.empty);
    case "min": return L.reduce<number>((m, x, i) => (i === 0 || (get(x, prog.f) as number) <= m ? (get(x, prog.f) as number) : m), prog.empty);
    case "test": return L.map((x) => evalPred(prog.pred, x, args));
    case "label": return L.map((x) => (evalPred(prog.pred, x, args) ? prog.yes : prog.no));
    case "pluck": return (prog.pred ? L.filter((x) => evalPred(prog.pred!, x, args)) : L).map((x) => get(x, prog.f));
  }
}
const predSize = (p: ListPred): number => (p.op === "is" ? 1 : p.op === "not" || p.op === "nes" || p.op === "nep" || p.op === "nfin" ? 3 : 2);
export function listSize(prog: ListProgram): number {
  switch (prog.op) {
    case "length": return 1;
    case "count": case "filter": case "some": case "every": case "test": return 2 + predSize(prog.pred);
    case "sum": return 2 + (prog.pred ? 1 + predSize(prog.pred) : 0);
    case "max": case "min": return 3;
    case "label": return 3 + predSize(prog.pred);
    case "pluck": return 2 + (prog.pred ? 1 + predSize(prog.pred) : 0);
  }
}
/** Whether a predicate is well typed over the element and the scalar parameters. */
export function predOk(p: ListPred, params: readonly ListParam[]): boolean {
  const t = valueType(elemOf(params), p.f);
  if (!t) return false;
  switch (p.op) {
    case "le": case "ge": case "eqn": return t === "number" && isInt(p.c);
    case "lep": case "gep": case "ltp": case "gtp": return t === "number" && params[p.p]?.type === "number";
    case "eqp": case "nep": return t !== "boolean" && params[p.p]?.type === t;
    case "is": case "not": return t === "boolean";
    case "eqs": case "nes": return t === "string" && typeof p.s === "string" && p.s.length <= DERIVE_MAX_STRING;
    case "fin": case "nfin": return t === "number";
  }
}
/** The program's result type over these parameters, or null when it is ill typed. */
export function listProgramType(prog: ListProgram, params: readonly ListParam[]): ListParamType | null {
  const li = listIndex(params);
  if (li < 0) return null;
  const lt = params[li]!.type as ListType, elem = lt.list;
  switch (prog.op) {
    case "length": return "number";
    case "count": return predOk(prog.pred, params) ? "number" : null;
    case "filter": return predOk(prog.pred, params) ? lt : null;
    case "some": case "every": return predOk(prog.pred, params) ? "boolean" : null;
    case "sum": return valueType(elem, prog.f) === "number" && (!prog.pred || predOk(prog.pred, params)) ? "number" : null;
    case "max": case "min": return valueType(elem, prog.f) === "number" && isInt(prog.empty) ? "number" : null;
    case "test": return predOk(prog.pred, params) ? { list: "boolean" } : null;
    case "label": return predOk(prog.pred, params) && prog.yes !== prog.no && prog.yes.length <= DERIVE_MAX_STRING && prog.no.length <= DERIVE_MAX_STRING ? { list: "string" } : null;
    case "pluck": { const t = valueType(elem, prog.f); return t && typeof elem !== "string" && (!prog.pred || predOk(prog.pred, params)) ? { list: t } : null; }
  }
}
const sameType = (a: ListParamType, b: ListParamType): boolean => formatListType(a) === formatListType(b);
const predOf = (prog: ListProgram): ListPred | null => ("pred" in prog ? prog.pred : null);
/** The scalar parameter indexes a program reads. */
export function listParamsRead(prog: ListProgram): Set<number> {
  const p = predOf(prog);
  return new Set(p && "p" in p ? [p.p] : []);
}

// ---------------------------------------------------------------------------------------------------------------
// Compile and re-check

/** Local names the compiled program binds: the element, the accumulator and the index, none a parameter name. */
export function listLocals(names: readonly string[]): { v: string; acc: string; idx: string } {
  const pick = (opts: string[]) => opts.find((o) => !names.includes(o))!;
  return { v: pick(["x", "item", "el"]), acc: pick(["n", "acc", "total"]), idx: pick(["i", "j", "k"]) };
}
const numLit = (n: number) => String(n);
function compilePred(p: ListPred, v: string, names: readonly string[]): string {
  const e = p.f === null ? v : `${v}.${p.f}`;
  switch (p.op) {
    case "le": return `${e} <= ${numLit(p.c)}`;
    case "ge": return `${numLit(p.c)} <= ${e}`;
    case "eqn": return `${e} === ${numLit(p.c)}`;
    case "lep": return `${e} <= ${names[p.p]}`;
    case "gep": return `${names[p.p]} <= ${e}`;
    case "ltp": return `${e} < ${names[p.p]}`;
    case "gtp": return `${names[p.p]} < ${e}`;
    case "eqp": return `${e} === ${names[p.p]}`;
    case "nep": return `${e} !== ${names[p.p]}`;
    case "is": return e;
    case "not": return `!${e}`;
    case "eqs": return `${e} === ${JSON.stringify(p.s)}`;
    case "nes": return `${e} !== ${JSON.stringify(p.s)}`;
    case "fin": return `Number.isFinite(${e})`;
    case "nfin": return `!Number.isFinite(${e})`;
  }
}
/** The program as one TypeScript expression over the parameters. */
export function compileList(prog: ListProgram, names: readonly string[], li: number): string {
  const L = names[li]!;
  const { v, acc, idx } = listLocals(names);
  const P = (p: ListPred) => compilePred(p, v, names);
  const E = (f: string | null) => (f === null ? v : `${v}.${f}`);
  switch (prog.op) {
    case "length": return `${L}.length`;
    case "count": return `${L}.filter((${v}) => ${P(prog.pred)}).length`;
    case "filter": case "some": case "every": return `${L}.${prog.op}((${v}) => ${P(prog.pred)})`;
    case "sum": return `${prog.pred ? `${L}.filter((${v}) => ${P(prog.pred)})` : L}.reduce((${acc}, ${v}) => ${acc} + ${E(prog.f)}, 0)`;
    case "max": return `${L}.reduce((${acc}, ${v}, ${idx}) => (${idx} === 0 || ${acc} <= ${E(prog.f)} ? ${E(prog.f)} : ${acc}), ${numLit(prog.empty)})`;
    case "min": return `${L}.reduce((${acc}, ${v}, ${idx}) => (${idx} === 0 || ${E(prog.f)} <= ${acc} ? ${E(prog.f)} : ${acc}), ${numLit(prog.empty)})`;
    case "test": return `${L}.map((${v}) => ${P(prog.pred)})`;
    case "label": return `${L}.map((${v}) => (${P(prog.pred)} ? ${JSON.stringify(prog.yes)} : ${JSON.stringify(prog.no)}))`;
    case "pluck": return `${prog.pred ? `${L}.filter((${v}) => ${P(prog.pred)})` : L}.map((${v}) => ${E(prog.f)})`;
  }
}

/** Decompiles an expression the compiler could have written back into the DSL (loosely; the caller recompiles). */
function decompile(e: ts.Expression, names: readonly string[], li: number, nonFinite = false): ListProgram | null {
  const L = names[li]!;
  const isL = (n: ts.Node) => ts.isIdentifier(n) && n.text === L;
  const arrowBody = (n: ts.Node | undefined, arity: number): ts.Expression | null =>
    n && ts.isArrowFunction(n) && n.parameters.length === arity && !ts.isBlock(n.body) ? n.body : null;
  const strip = (n: ts.Expression): ts.Expression => (ts.isParenthesizedExpression(n) ? n.expression : n);
  const field = (n: ts.Expression): string | null | undefined => (ts.isIdentifier(n) ? null : ts.isPropertyAccessExpression(n) && ts.isIdentifier(n.expression) ? n.name.text : undefined);
  const num = (n: ts.Expression): number | undefined =>
    ts.isNumericLiteral(n) ? Number(n.text) : ts.isPrefixUnaryExpression(n) && n.operator === ts.SyntaxKind.MinusToken && ts.isNumericLiteral(n.operand) ? -Number(n.operand.text) : undefined;
  const param = (n: ts.Expression): number => (ts.isIdentifier(n) ? names.indexOf(n.text) : -1);
  // G17 (v6 only): `Number.isFinite(E)`, the one global call a v6 predicate makes (a parameter named Number would
  // shadow it, so then it is never read back).
  const fin = (n: ts.Expression): string | null | undefined =>
    nonFinite && !names.includes("Number") && ts.isCallExpression(n) && n.arguments.length === 1 && !n.questionDotToken && ts.isPropertyAccessExpression(n.expression) && ts.isIdentifier(n.expression.expression) && n.expression.expression.text === "Number" && n.expression.name.text === "isFinite" ? field(n.arguments[0]!) : undefined;
  const pred = (b: ts.Expression): ListPred | null => {
    if (nonFinite) {
      const g = fin(b);
      if (g !== undefined) return { op: "fin", f: g };
      if (ts.isPrefixUnaryExpression(b) && b.operator === ts.SyntaxKind.ExclamationToken) { const h = fin(b.operand); if (h !== undefined) return { op: "nfin", f: h }; }
    }
    if (ts.isPrefixUnaryExpression(b) && b.operator === ts.SyntaxKind.ExclamationToken) { const f = field(b.operand); return f === undefined ? null : { op: "not", f }; }
    if (ts.isBinaryExpression(b)) {
      const op = b.operatorToken.kind, l = b.left, r = b.right;
      if (op === ts.SyntaxKind.LessThanEqualsToken) {
        const fl = field(l), fr = field(r);
        if (fl !== undefined && num(r) !== undefined) return { op: "le", f: fl, c: num(r)! };
        if (fr !== undefined && num(l) !== undefined) return { op: "ge", f: fr, c: num(l)! };
        if (fl !== undefined && param(r) >= 0) return { op: "lep", f: fl, p: param(r) };
        if (fr !== undefined && param(l) >= 0) return { op: "gep", f: fr, p: param(l) };
        return null;
      }
      if (op === ts.SyntaxKind.LessThanToken) {
        const fl = field(l), fr = field(r);
        if (fl !== undefined && param(r) >= 0) return { op: "ltp", f: fl, p: param(r) };
        if (fr !== undefined && param(l) >= 0) return { op: "gtp", f: fr, p: param(l) };
        return null;
      }
      if (op === ts.SyntaxKind.EqualsEqualsEqualsToken || op === ts.SyntaxKind.ExclamationEqualsEqualsToken) {
        const f = field(l);
        if (f === undefined) return null;
        const eq = op === ts.SyntaxKind.EqualsEqualsEqualsToken;
        if (eq && num(r) !== undefined) return { op: "eqn", f, c: num(r)! };
        if (ts.isStringLiteral(r)) return { op: eq ? "eqs" : "nes", f, s: r.text };
        if (param(r) >= 0) return { op: eq ? "eqp" : "nep", f, p: param(r) };
      }
      return null;
    }
    const f = field(b);
    return f === undefined ? null : { op: "is", f };
  };
  const call = (n: ts.Expression): { on: ts.Expression; m: string; args: readonly ts.Expression[] } | null =>
    ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) ? { on: n.expression.expression, m: n.expression.name.text, args: n.arguments } : null;
  if (ts.isPropertyAccessExpression(e) && e.name.text === "length") {
    if (isL(e.expression)) return { op: "length" };
    const c = call(e.expression);
    const b = c && c.m === "filter" && isL(c.on) && c.args.length === 1 ? arrowBody(c.args[0], 1) : null;
    const p = b && pred(b);
    return p ? { op: "count", pred: p } : null;
  }
  const c = call(e);
  if (!c) return null;
  if (c.m === "map" && c.args.length === 1) {
    const b = arrowBody(c.args[0], 1);
    if (!b) return null;
    const inner = call(c.on);
    if (inner && inner.m === "filter" && isL(inner.on) && inner.args.length === 1) {
      const pb = arrowBody(inner.args[0], 1), p = pb && pred(pb), f = field(b);
      return p && typeof f === "string" ? { op: "pluck", f, pred: p } : null;
    }
    if (!isL(c.on)) return null;
    const sb = strip(b);
    if (ts.isConditionalExpression(sb) && ts.isStringLiteral(sb.whenTrue) && ts.isStringLiteral(sb.whenFalse)) {
      const p = pred(sb.condition);
      return p ? { op: "label", pred: p, yes: sb.whenTrue.text, no: sb.whenFalse.text } : null;
    }
    const f = field(b);
    if (typeof f === "string") return { op: "pluck", f, pred: null };
    const p = pred(b);
    return p ? { op: "test", pred: p } : null;
  }
  if (c.m === "reduce" && c.args.length === 2 && !isL(c.on)) {
    // sum of the kept elements: L.filter((x) => P).reduce((n, x) => n + x.f, 0)
    const inner = call(c.on), pb = inner && inner.m === "filter" && isL(inner.on) && inner.args.length === 1 ? arrowBody(inner.args[0], 1) : null, p = pb && pred(pb);
    const b = p ? arrowBody(c.args[0], 2) : null;
    if (!p || !b || !ts.isBinaryExpression(b) || b.operatorToken.kind !== ts.SyntaxKind.PlusToken) return null;
    const f = field(b.right);
    return f === undefined ? null : { op: "sum", f, pred: p };
  }
  if (!isL(c.on)) return null;
  if ((c.m === "filter" || c.m === "some" || c.m === "every") && c.args.length === 1) {
    const b = arrowBody(c.args[0], 1), p = b && pred(b);
    return p ? { op: c.m, pred: p } : null;
  }
  if (c.m === "reduce" && c.args.length === 2) {
    if (arrowBody(c.args[0], 2)) {
      const b = arrowBody(c.args[0], 2)!;
      if (ts.isBinaryExpression(b) && b.operatorToken.kind === ts.SyntaxKind.PlusToken) { const f = field(b.right); return f === undefined ? null : { op: "sum", f, pred: null }; }
      return null;
    }
    const b = arrowBody(c.args[0], 3), d = num(c.args[1]!);
    if (!b || d === undefined) return null;
    const sb = strip(b);
    if (!ts.isConditionalExpression(sb) || !ts.isBinaryExpression(sb.condition) || !ts.isBinaryExpression(sb.condition.right)) return null;
    const f = field(sb.whenTrue);
    if (f === undefined) return null;
    // max (acc <= E ? E : acc) or min (E <= acc ? E : acc): listExprProblem keeps whichever recompiles exactly.
    return { op: "max", f, empty: d };
  }
  return null;
}

/**
 * The emit and Job B check of a list expression: it parses as one expression, decompiles into a well-typed v4
 * program over these parameters whose type is `ret`, and recompiles to exactly the same text. Null when clean.
 */
export function listExprProblem(text: string, params: readonly ListParam[], ret: ListParamType, nonFinite = false): string | null {
  const names = params.map((p) => p.name);
  const li = listIndex(params);
  if (li < 0 || params.filter((p) => isListType(p.type)).length !== 1 || params.length > LIST_MAX_PARAMS) return "derive_list_signature";
  const sf = ts.createSourceFile("e.ts", `(${text});`, ts.ScriptTarget.Latest, true);
  const st = sf.statements[0];
  if ((sf as unknown as { parseDiagnostics: unknown[] }).parseDiagnostics.length || sf.statements.length !== 1 || !st || !ts.isExpressionStatement(st) || !ts.isParenthesizedExpression(st.expression)) return "derive_expr_parse";
  const prog = exactProgram(st.expression.expression, text, names, li, nonFinite);
  if (!prog) return "derive_list_expr";
  const t = listProgramType(prog, params);
  if (!t || !sameType(t, ret)) return "derive_list_expr";
  return null;
}
/** The decompiled program (max or min for a reduce) whose recompiled text is exactly `text`, or null. */
function exactProgram(e: ts.Expression, text: string, names: readonly string[], li: number, nonFinite = false): ListProgram | null {
  const prog = decompile(e, names, li, nonFinite);
  if (!prog) return null;
  const variants: ListProgram[] = prog.op === "max" ? [prog, { ...prog, op: "min" }] : [prog];
  return variants.find((p) => compileList(p, names, li) === text) ?? null;
}
/** The program behind an emitted expression (null unless listExprProblem passes). */
export function decompileList(text: string, params: readonly ListParam[], ret: ListParamType, nonFinite = false): ListProgram | null {
  if (listExprProblem(text, params, ret, nonFinite)) return null;
  const sf = ts.createSourceFile("e.ts", `(${text});`, ts.ScriptTarget.Latest, true);
  const e = ((sf.statements[0] as ts.ExpressionStatement).expression as ts.ParenthesizedExpression).expression;
  return exactProgram(e, text, params.map((p) => p.name), listIndex(params), nonFinite);
}

// ---------------------------------------------------------------------------------------------------------------
// Search

/** Problems with the examples themselves; null when usable. */
export function listExamplesProblem(input: ListInput): string | null {
  const { params, ret, examples } = input;
  if (params.length < 1 || params.length > LIST_MAX_PARAMS || params.filter((p) => isListType(p.type)).length !== 1) return "params";
  if (params.some((p) => !isListType(p.type) && p.type === "boolean")) return "params";
  if (examples.length < LIST_MIN_EXAMPLES || examples.length > LIST_MAX_EXAMPLES) return "count";
  const seen = new Map<string, string>();
  for (const ex of examples) {
    if (ex.args.length !== params.length) return "arity";
    if (ex.args.some((a, i) => !valueOk(a, params[i]!.type, !!input.nonFinite))) return "arg_type";
    if (!valueOk(ex.out, ret, !!input.nonFinite)) return "out_type";
    const k = valueKey(ex.args), o = valueKey(ex.out);
    if (seen.has(k) && seen.get(k) !== o) return "contradiction";
    seen.set(k, o);
  }
  if (new Set(examples.map((e) => valueKey(e.out))).size < 2) return "one_result";
  return null;
}

const uniq = <T>(xs: readonly T[]): T[] => [...new Set(xs)];
const elemsOfExamples = (examples: readonly ListExample[], li: number): ListElem[] => examples.flatMap((e) => e.args[li] as readonly ListElem[]);

/** Every candidate program of the right result type, in size order (then a fixed enumeration order). */
export function listCandidates(input: ListInput): ListProgram[] {
  const { params, ret, examples } = input;
  const li = listIndex(params);
  const elem = elemOf(params);
  const els = elemsOfExamples(examples, li);
  const preds: ListPred[] = [];
  for (const f of fieldsOf(elem)) {
    const t = valueType(elem, f)!;
    const vals = els.map((x) => get(x, f));
    if (t === "boolean") preds.push({ op: "is", f }, { op: "not", f });
    if (t === "number") {
      // Cuts and equalities come from the integer values only (G17: a NaN or an infinity is never a constant).
      const seenN = uniq((vals as number[]).filter(isInt)).sort((a, b) => a - b);
      const cs = uniq(seenN.flatMap((v) => [v - 1, v, v + 1])).filter(isInt).sort((a, b) => a - b);
      for (const c of cs) preds.push({ op: "le", f, c }, { op: "ge", f, c });
      for (const c of seenN) preds.push({ op: "eqn", f, c });
      // G17 (v6 only): the finite test, when an example element shows this field NaN, Infinity or -Infinity.
      if (input.nonFinite && vals.some(isNonFinite)) preds.push({ op: "fin", f }, { op: "nfin", f });
    }
    if (t === "string") for (const s of uniq(vals as string[]).sort()) preds.push({ op: "eqs", f, s }, { op: "nes", f, s });
    for (const [p, q] of params.entries()) {
      if (isListType(q.type) || (q.type !== t)) continue;
      if (t === "number") preds.push({ op: "lep", f, p }, { op: "gep", f, p }, { op: "ltp", f, p }, { op: "gtp", f, p });
      preds.push({ op: "eqp", f, p }, { op: "nep", f, p });
    }
  }
  const out: ListProgram[] = [];
  const empties = uniq(examples.filter((e) => (e.args[li] as readonly ListElem[]).length === 0 && isInt(e.out)).map((e) => e.out as number));
  const strs = uniq(examples.flatMap((e) => (Array.isArray(e.out) ? (e.out as ListElem[]).filter((v): v is string => typeof v === "string") : []))).sort();
  out.push({ op: "length" });
  for (const pred of preds) for (const op of ["count", "filter", "some", "every", "test"] as const) out.push({ op, pred });
  for (const f of fieldsOf(elem)) {
    out.push({ op: "sum", f, pred: null });
    for (const pred of preds) out.push({ op: "sum", f, pred });
    for (const empty of empties) out.push({ op: "max", f, empty }, { op: "min", f, empty });
    if (f !== null) { out.push({ op: "pluck", f, pred: null }); for (const pred of preds) out.push({ op: "pluck", f, pred }); }
  }
  for (const pred of preds) for (const yes of strs) for (const no of strs) if (yes !== no) out.push({ op: "label", pred, yes, no });
  const typed = out.filter((p) => { const t = listProgramType(p, params); return t !== null && sameType(t, ret); });
  return typed.map((p, i) => ({ p, i, s: listSize(p) })).sort((a, b) => a.s - b.s || a.i - b.i).map((x) => x.p);
}

/** The probe argument vectors of the ambiguity check (examples first), or null past LIST_MAX_PROBES. */
export function listProbes(input: ListInput): ListArg[][] | null {
  const { params, examples } = input;
  const li = listIndex(params);
  const elem = elemOf(params);
  const els = elemsOfExamples(examples, li);
  const numsSeen = uniq([...els.flatMap((x) => fieldsOf(elem).map((f) => get(x, f)).filter(isInt)), ...examples.flatMap((e) => e.args.filter(isInt))]);
  const numGrid = numsSeen.length ? uniq(numsSeen.flatMap((v) => [v - 1, v, v + 1])).filter(isInt) : [0, 1];
  const lo = Math.min(...numGrid), hi = Math.max(...numGrid);
  numGrid.push(lo - DERIVE_FAR, hi + DERIVE_FAR, 0);
  // G17 (v6 only): when the examples hold a non-finite number, every number slot is also probed with all three.
  if (input.nonFinite && hasNonFinite(examples)) numGrid.push(NaN, Infinity, -Infinity);
  const strsSeen = uniq([...els.flatMap((x) => fieldsOf(elem).map((f) => get(x, f)).filter((v): v is string => typeof v === "string")), ...examples.flatMap((e) => e.args.filter((v): v is string => typeof v === "string"))]);
  const strGrid = uniq(["", ...strsSeen, "zz probe"]);
  const grid = (t: DeriveType): DeriveValue[] => (t === "number" ? uniq(numGrid) : t === "string" ? strGrid : [false, true]);
  const base: ListElem = els[0] ?? (typeof elem === "string" ? grid(elem)[0]! : Object.fromEntries(elem.fields.map((f) => [f.name, grid(f.type)[0]!])));
  const probeEls: ListElem[] = [...els];
  for (const f of fieldsOf(elem)) for (const g of grid(valueType(elem, f)!)) probeEls.push(f === null ? g : { ...(base as ListRecord), [f]: g });
  const uniqEls = [...new Map(probeEls.map((e) => [valueKey(e), e])).values()];
  const lists: ListElem[][] = [[], ...examples.map((e) => [...(e.args[li] as readonly ListElem[])])];
  for (const e of uniqEls) lists.push([e]);
  // Pairs: every two example elements, and each field's smallest / largest grid values in both orders.
  const exEls = [...new Map(els.map((e) => [valueKey(e), e])).values()].slice(0, 40);
  for (const a of exEls) for (const b of exEls) if (a !== b) lists.push([a, b]);
  for (const f of fieldsOf(elem)) {
    const g = grid(valueType(elem, f)!);
    const at = (v: DeriveValue): ListElem => (f === null ? v : { ...(base as ListRecord), [f]: v });
    const a = at(g[0]!), b = at(g[g.length - 1]!), m = at(g[Math.floor(g.length / 2)]!);
    lists.push([a, b], [b, a], [a, m, b], [b, m, a], [m, m]);
  }
  const scalarVals = params.map((p, i): ListArg[] => (i === li ? [] : uniq([...examples.map((e) => e.args[i] as DeriveValue), ...grid(p.type as DeriveType)])));
  const out: ListArg[][] = examples.map((e) => [...e.args]);
  const si = params.findIndex((_, i) => i !== li);
  for (const L of lists) {
    if (si < 0) { out.push([L]); continue; }
    const first = examples[0]!.args[si]!;
    const vs = L.length === 1 || L.length === 0 ? scalarVals[si]! : [first];
    for (const v of vs) { const a: ListArg[] = []; a[li] = L; a[si] = v; out.push(a); }
    if (out.length > LIST_MAX_PROBES) return null;
  }
  return out.length > LIST_MAX_PROBES ? null : out;
}

const sameOut = (a: ListArg, b: ListArg): boolean => valueKey(a) === valueKey(b);

/** The gate the accepted program fails, or null. */
export function listGateProblem(input: ListInput, prog: ListProgram): { gate: ListGate; param?: string; detail: string; questions?: ListQuestion[] } | null {
  const { params, examples } = input;
  const li = listIndex(params);
  const elem = elemOf(params);
  const read = listParamsRead(prog);
  for (const [i, p] of params.entries()) if (i !== li && !read.has(i)) return { gate: "unread", param: p.name, detail: `the fitting program never reads ${p.name}` };
  const pred = predOf(prog);
  if (!pred) return seedProblem(input, prog);
  const pts = examples.flatMap((e) => (e.args[li] as readonly ListElem[]).map((x) => ({ x, args: e.args })));
  const name = pred.f ?? params[li]!.name;
  const yes = pts.filter((q) => evalPred(pred, q.x, q.args)).length, no = pts.length - yes;
  if (yes < DERIVE_MIN_REACH || no < DERIVE_MIN_REACH) return { gate: "branch", param: name, detail: `the condition holds for ${yes} and fails for ${no} example elements; each side needs at least ${DERIVE_MIN_REACH}` };
  if (pred.op === "eqs" || pred.op === "nes") {
    const vals = pts.map((q) => get(q.x, pred.f) as string);
    const others = uniq(vals.filter((v) => v !== pred.s));
    if (vals.filter((v) => v === pred.s).length < DERIVE_MIN_REACH || others.length < 2) return { gate: "branch", param: name, detail: `the compared value must appear in at least ${DERIVE_MIN_REACH} elements next to at least 2 other values` };
  }
  // A count, a kept list, a sum of the kept elements or their fields must be seen over 2 or more kept elements in one
  // example list: else "the largest kept" or "1 when any is kept" read the same examples as well (outside the DSL,
  // so the ambiguity check cannot see them).
  if ((prog.op === "count" || prog.op === "filter" || prog.op === "sum" || prog.op === "pluck") && !examples.some((e) => (e.args[li] as readonly ListElem[]).filter((x) => evalPred(pred, x, e.args)).length >= 2)) {
    const names = params.map((p) => p.name);
    return { gate: "kept", param: name, detail: `no example list has 2 or more elements where \`${compilePred(pred, listLocals(names).v, names)}\` holds; add one` };
  }
  const seed = seedProblem(input, prog);
  if (seed) return seed;
  // Threshold edges and far sides, as offsets from the edge (constant or the scalar parameter).
  // G17: a NaN or an infinity (element or scalar) is no evidence for an edge or a far side.
  const off = (q: { x: ListElem; args: readonly ListArg[] }): number | null => {
    const e = get(q.x, pred.f);
    if (typeof e !== "number" || !Number.isFinite(e)) return null;
    if (pred.op === "le" || pred.op === "ge" || pred.op === "eqn") return e - pred.c;
    if (pred.op === "lep" || pred.op === "gep" || pred.op === "ltp" || pred.op === "gtp") { const t = q.args[pred.p] as number; return Number.isFinite(t) ? e - t : null; }
    return null;
  };
  if (pred.op === "le" || pred.op === "ge" || pred.op === "eqn" || pred.op === "lep" || pred.op === "gep" || pred.op === "ltp" || pred.op === "gtp") {
    const offs = pts.map(off).filter((d): d is number => d !== null);
    const need = pred.op === "le" || pred.op === "lep" || pred.op === "gtp" ? [0, 1] : pred.op === "eqn" ? [-1, 0, 1] : [-1, 0];
    const what = "p" in pred ? `${pred.f ?? "the element"} minus ${params[pred.p]!.name}` : `${pred.f ?? "the element"} minus ${(pred as { c: number }).c}`;
    for (const d of need) if (!offs.includes(d)) return { gate: "edge", param: name, detail: `no example element shows ${what} = ${d}; add one on each side of the edge` };
    if (!offs.some((d) => d >= DERIVE_FAR) || !offs.some((d) => d <= -DERIVE_FAR)) return { gate: "far", param: name, detail: `no example element is at least ${DERIVE_FAR} past the edge on each side (${what} at or above ${DERIVE_FAR} and at or below -${DERIVE_FAR})` };
  }
  void elem;
  return null;
}

/**
 * The seed gate (Auditor #523 B1): a max / min seeded with a constant, a floored or a capped sum read the same
 * examples as the plain max / min / sum unless one non-empty example list shows the difference. Null when shown.
 */
export function seedProblem(input: ListInput, prog: ListProgram): { gate: ListGate; param?: string; detail: string; questions: ListQuestion[] } | null {
  if (prog.op !== "max" && prog.op !== "min" && prog.op !== "sum") return null;
  const { params, examples } = input;
  const li = listIndex(params);
  const D = prog.op === "sum" ? 0 : prog.empty;
  const nonEmpty = (a: readonly ListArg[]) => (a[li] as readonly ListElem[]).length > 0;
  const outs = examples.filter((e) => nonEmpty(e.args)).map((e) => evalList(prog, e.args, li) as number);
  const probes = listProbes(input);
  const name = prog.f ?? params[li]!.name;
  const names = params.map((p) => p.name);
  if (!probes) return { gate: "seed", param: name, detail: `more than ${LIST_MAX_PROBES} probe lists`, questions: [] };
  // Reach: the probe lists, and each example element with its summed field set to every value the probes hold
  // (so a sum of the kept elements reaches as far as a plain sum does).
  const reach: ListArg[][] = [...probes];
  if (prog.f !== null) {
    const f = prog.f;
    const G = uniq(probes.flatMap((a) => (a[li] as readonly ListElem[]).map((x) => get(x, f))).filter(isInt));
    const els = [...new Map(examples.flatMap((e) => (e.args[li] as readonly ListElem[]).map((x) => ({ x, args: e.args }))).map((q) => [valueKey([q.x, q.args]), q])).values()].slice(0, 40);
    for (const q of els) for (const g of G) { const a = [...q.args]; a[li] = [{ ...(q.x as ListRecord), [f]: g }]; reach.push(a); }
  }
  const vals = reach.filter(nonEmpty).map((a) => ({ a, v: evalList(prog, a, li) as number })).sort((x, y) => (x.a[li] as readonly ListElem[]).length - (y.a[li] as readonly ListElem[]).length);
  const sides: ("low" | "high")[] = prog.op === "max" ? ["low"] : prog.op === "min" ? ["high"] : ["low", "high"];
  for (const side of sides) {
    const tiers = side === "low" ? (prog.op === "sum" ? [D - DERIVE_FAR - 1, D - 1] : [D - 1]) : (prog.op === "sum" ? [D + DERIVE_FAR + 1, D + 1] : [D + 1]);
    const past = (v: number, t: number) => (side === "low" ? v <= t : v >= t);
    // A max / min is checked with no reach limit (Auditor #523 round 3): however far D is from the example values, a
    // non-empty example must be past it, else "the max but at least D" reads the same examples. A sum is checked on
    // the tiers its probe lists reach.
    const t = prog.op === "sum" ? tiers.find((t) => vals.some((x) => past(x.v, t))) : tiers[0];
    if (t === undefined || outs.some((o) => past(o, t))) continue;
    const q = vals.find((x) => past(x.v, t)) ?? oneElement(input, prog, t);
    const alt = D; // the floored / capped reading: the seed D itself
    const kind = prog.op === "max" ? `its largest ${name} below ${D}, the empty-list result` : prog.op === "min" ? `its smallest ${name} above ${D}, the empty-list result` : `a ${side === "low" ? "sum at or below" : "sum at or above"} ${t}`;
    return {
      gate: "seed", param: name, questions: [{ at: q.a, answers: [q.v, alt] }],
      detail: `no non-empty example list has ${kind} (a ${prog.op === "max" || (prog.op === "sum" && side === "low") ? "floor" : "cap"} would read the same examples as \`${compileList(prog, names, li)}\`); add one`,
    };
  }
  return null;
}

/** The seed gate's asked row when no probe list reaches past D: one example's arguments, its list one element whose (field) value is v. */
function oneElement(input: ListInput, prog: Extract<ListProgram, { op: "max" | "min" | "sum" }>, v: number): { a: ListArg[]; v: number } {
  const li = listIndex(input.params);
  const ex = input.examples.find((e) => (e.args[li] as readonly ListElem[]).length > 0)!;
  const x = (ex.args[li] as readonly ListElem[])[0]!;
  const a = [...ex.args];
  a[li] = [prog.f === null ? v : { ...(x as ListRecord), [prog.f]: v }] as ListArg;
  return { a, v: evalList(prog, a, li) as number };
}

/** Derives the list program, or refuses (see the head of this file). */
export function deriveListProgram(input: ListInput): ListResult {
  const maxC = input.maxCandidates ?? LIST_MAX_CANDIDATES, maxE = input.maxEvals ?? LIST_MAX_EVALS;
  const ep = listExamplesProblem(input);
  if (ep) return { ok: false, reason: "derive_examples", detail: ep, searched: 0 };
  const li = listIndex(input.params);
  const lens = input.examples.map((e) => (e.args[li] as readonly ListElem[]).length);
  const lname = input.params[li]!.name;
  if (!lens.includes(0)) return { ok: false, reason: "derive_under_specified", gate: "empty", param: lname, detail: "no example gives the result for the empty list", searched: 0 };
  if (!lens.some((n) => n >= 3)) return { ok: false, reason: "derive_under_specified", gate: "many", param: lname, detail: "no example has a list of at least 3 elements", searched: 0 };
  // Auditor #523 ruling: a predicate true on every example element (or false on every one) stays a rival, so a task
  // the examples cannot split is derive_ambiguous with a question. Only a constant cut at least DERIVE_FAR from 0 is
  // dropped: every example set has unsplit cuts at its own smallest and largest values, and asking past one only
  // moves it (the same distance the far gate asks for).
  const elems = input.examples.flatMap((e) => (e.args[li] as readonly ListElem[]).map((x) => ({ x, args: e.args })));
  const witnessed = (p: ListPred) => elems.some((q) => evalPred(p, q.x, q.args)) && elems.some((q) => !evalPred(p, q.x, q.args));
  const farCut = (p: ListPred) => (p.op === "le" || p.op === "ge") && Math.abs(p.c) >= DERIVE_FAR;
  const cands = listCandidates(input).filter((c) => { const p = predOf(c); return !p || witnessed(p) || !farCut(p); });
  if (cands.length > maxC) return { ok: false, reason: "derive_budget", detail: `${cands.length} candidate programs (limit ${maxC})`, searched: 0 };
  let evals = 0;
  const fits: ListProgram[] = [];
  for (const c of cands) {
    let ok = true;
    for (const ex of input.examples) { evals++; if (!sameOut(evalList(c, ex.args, li), ex.out)) { ok = false; break; } }
    if (ok) fits.push(c);
  }
  if (!fits.length) return { ok: false, reason: "derive_no_fit", detail: `none of ${cands.length} programs fits every example`, searched: cands.length };
  if (fits.length > 1) {
    const probes = listProbes(input);
    if (!probes) return { ok: false, reason: "derive_budget", detail: `more than ${LIST_MAX_PROBES} probe lists`, searched: cands.length };
    const first = fits[0]!;
    const ref = probes.map((a) => evalList(first, a, li));
    evals += probes.length;
    const rivals: ListProgram[] = [];
    for (const f of fits.slice(1)) {
      for (const [k, a] of probes.entries()) {
        if (++evals > maxE) return { ok: false, reason: "derive_budget", detail: `more than ${maxE} evaluations`, searched: cands.length };
        if (!sameOut(evalList(f, a, li), ref[k]!)) { rivals.push(f); break; }
      }
      if (rivals.length >= 3) break;
    }
    if (rivals.length) {
      const questions: ListQuestion[] = [];
      // The question for a rival: the shortest probe list where it disagrees, then the one holding the value
      // farthest from 0 (so answering it moves an unsplit cut past DERIVE_FAR at once, not one value at a time).
      const len = (a: readonly ListArg[]) => (a[li] as readonly ListElem[]).length;
      const far = (a: readonly ListArg[]) => Math.max(0, ...(a[li] as readonly ListElem[]).flatMap((x) => fieldsOf(elemOf(input.params)).map((f) => get(x, f))).filter(isInt).map((v) => Math.abs(v)));
      for (const r of rivals) {
        let k = -1;
        for (const [i, a] of probes.entries()) {
          if (sameOut(evalList(r, a, li), ref[i]!)) continue;
          if (k < 0 || len(a) < len(probes[k]!) || (len(a) === len(probes[k]!) && far(a) > far(probes[k]!))) k = i;
        }
        const answers = [ref[k]!, evalList(r, probes[k]!, li)];
        if (!questions.some((q) => valueKey(q.at) === valueKey(probes[k]))) questions.push({ at: probes[k]!, answers });
      }
      const names = input.params.map((p) => p.name);
      return {
        ok: false, reason: "derive_ambiguous", questions, searched: cands.length,
        detail: `${fits.length} programs fit every example and disagree: ${[first, ...rivals].slice(0, 3).map((p) => compileList(p, names, li)).join(" | ")}`,
      };
    }
  }
  const prog = fits[0]!;
  const gate = listGateProblem(input, prog);
  if (gate) return { ok: false, reason: "derive_under_specified", gate: gate.gate, ...(gate.param ? { param: gate.param } : {}), detail: gate.detail, ...(gate.questions ? { questions: gate.questions } : {}), searched: cands.length };
  return { ok: true, program: prog, size: listSize(prog), fits: fits.length, searched: cands.length };
}

// ---------------------------------------------------------------------------------------------------------------
// Literal values: the example lexer and the TypeScript spelling used in tests

/** A value in the spelling the generated test uses: `[1, 2]`, `{ part: "scan", ageDays: 3 }`, `"x"`, `-4`, `true`. */
export function listLit(v: ListArg | ListElem, t?: ListParamType | ListElemType): string {
  if (Array.isArray(v)) { const et = t && typeof t === "object" && "list" in t ? t.list : undefined; return `[${v.map((x) => listLit(x, et)).join(", ")}]`; }
  if (v && typeof v === "object") {
    const order = t && typeof t === "object" && "fields" in t ? t.fields.map((f) => f.name) : Object.keys(v);
    return `{ ${order.map((k) => `${k}: ${listLit((v as ListRecord)[k]!)}`).join(", ")} }`;
  }
  return typeof v === "string" ? JSON.stringify(v) : String(v);
}

type Tok = { k: "v"; v: DeriveValue } | { k: "id"; v: string } | { k: "p"; v: "[" | "]" | "{" | "}" | ":" | "," } | { k: "gives" };
function tokens(text: string, nonFinite = false): Tok[] | null {
  const toks: Tok[] = [];
  let s = text.trim().replace(/\.$/, "");
  while (s.length) {
    let m: RegExpExecArray | null;
    if ((m = /^"([ !#-[\]-~]*)"/.exec(s))) toks.push({ k: "v", v: m[1]! });
    else if ((m = /^-?(?:0|[1-9]\d{0,11})(?![\w.])/.exec(s))) toks.push({ k: "v", v: Number(m[0]) });
    else if ((m = /^(?:true|false)\b/.exec(s))) toks.push({ k: "v", v: m[0] === "true" });
    // G17 (v6 only): NaN, Infinity and -Infinity are number values, exactly so spelled.
    else if (nonFinite && (m = /^(?:NaN|-?Infinity)(?![\w$])/.exec(s))) toks.push({ k: "v", v: Number(m[0]) });
    else if ((m = /^gives\b/.exec(s))) toks.push({ k: "gives" });
    else if ((m = /^[A-Za-z_$][\w$]{0,63}/.exec(s))) toks.push({ k: "id", v: m[0] });
    else if ((m = /^[[\]{}:,]/.exec(s))) toks.push({ k: "p", v: m[0] as "[" });
    else return null;
    s = s.slice(m[0].length).replace(/^ +/, "");
  }
  return toks;
}
/**
 * One example line: `[3, 40], 30 gives 1`, `[{ part: "scan", ageDays: 3 }] gives [{ part: "scan", ageDays: 3 }]`.
 * Scalars as in v1 (integers, true / false, double-quoted strings), lists in brackets (at most one level), records
 * in braces with bare field names and scalar values. Null when the line is anything else.
 */
export function lexListValues(text: string, nonFinite = false): { values: ListArg[]; out: ListArg } | null {
  const toks = tokens(text, nonFinite);
  if (!toks) return null;
  let i = 0;
  const peek = () => toks[i];
  const punct = (v: string) => { const t = toks[i]; if (t?.k === "p" && t.v === v) { i++; return true; } return false; };
  const scalar = (): DeriveValue | undefined => { const t = toks[i]; if (t?.k === "v") { i++; return t.v; } return undefined; };
  const record = (): ListRecord | undefined => {
    if (!punct("{")) return undefined;
    const r: Record<string, DeriveValue> = {};
    for (;;) {
      const k = toks[i];
      if (k?.k !== "id" || Object.prototype.hasOwnProperty.call(r, k.v)) return undefined;
      i++;
      if (!punct(":")) return undefined;
      const v = scalar();
      if (v === undefined) return undefined;
      r[k.v] = v;
      if (punct("}")) return r;
      if (!punct(",")) return undefined;
      if (punct("}")) return r;
    }
  };
  const elem = (): ListElem | undefined => (peek()?.k === "p" && (peek() as { v: string }).v === "{" ? record() : scalar());
  const value = (): ListArg | undefined => {
    if (!punct("[")) return scalar();
    const xs: ListElem[] = [];
    if (punct("]")) return xs;
    for (;;) {
      const e = elem();
      if (e === undefined) return undefined;
      xs.push(e);
      if (punct("]")) return xs;
      if (!punct(",")) return undefined;
    }
  };
  const values: ListArg[] = [];
  for (;;) {
    const v = value();
    if (v === undefined) return null;
    values.push(v);
    if (peek()?.k === "gives") { i++; break; }
    if (!punct(",")) return null;
  }
  const out = value();
  if (out === undefined || i !== toks.length) return null;
  return { values, out };
}

/**
 * Reads a test-file literal back (the inverse of listLit), or undefined for anything else. With `nonFinite` (G17, v6
 * only) the identifiers NaN and Infinity and `-Infinity` read as those numbers.
 */
export function listLitValue(e: ts.Expression, nonFinite = false): ListArg | ListElem | undefined {
  if (nonFinite && ts.isIdentifier(e) && (e.text === "NaN" || e.text === "Infinity")) return Number(e.text);
  if (nonFinite && ts.isPrefixUnaryExpression(e) && e.operator === ts.SyntaxKind.MinusToken && ts.isIdentifier(e.operand) && e.operand.text === "Infinity") return -Infinity;
  if (ts.isNumericLiteral(e)) return Number(e.text);
  if (ts.isPrefixUnaryExpression(e) && e.operator === ts.SyntaxKind.MinusToken && ts.isNumericLiteral(e.operand)) return -Number(e.operand.text);
  if (ts.isStringLiteral(e)) return e.text;
  if (e.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (e.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (ts.isArrayLiteralExpression(e)) {
    const xs: ListElem[] = [];
    for (const x of e.elements) { const v = listLitValue(x, nonFinite); if (v === undefined || Array.isArray(v)) return undefined; xs.push(v as ListElem); }
    return xs;
  }
  if (ts.isObjectLiteralExpression(e)) {
    const r: Record<string, DeriveValue> = {};
    for (const p of e.properties) {
      if (!ts.isPropertyAssignment(p) || !ts.isIdentifier(p.name) || Object.prototype.hasOwnProperty.call(r, p.name.text)) return undefined;
      const v = listLitValue(p.initializer, nonFinite);
      if (v === undefined || typeof v === "object") return undefined;
      r[p.name.text] = v;
    }
    return r;
  }
  return undefined;
}

/** Rows of the probe table in a v4 review note: the program on lists the examples do not show. */
export function listProbeTable(prog: ListProgram, input: ListInput, limit = 24): { args: ListArg[]; out: ListArg }[] {
  const li = listIndex(input.params);
  const probes = listProbes(input) ?? [];
  const shown = new Set(input.examples.map((e) => valueKey(e.args)));
  const rows: { args: ListArg[]; out: ListArg }[] = [];
  const picked = new Set<string>();
  // Prefer far and edge lists: longest first among the unseen, then the rest, deterministically.
  const order = probes.filter((a) => !shown.has(valueKey(a)));
  const step = Math.max(1, Math.floor(order.length / limit));
  for (let k = 0; k < order.length && rows.length < limit; k += step) {
    const a = order[k]!, key = valueKey(a);
    if (picked.has(key)) continue;
    picked.add(key);
    rows.push({ args: a, out: evalList(prog, a, li) });
  }
  return rows;
}
