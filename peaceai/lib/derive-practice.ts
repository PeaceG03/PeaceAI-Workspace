// M100 (option B judge, step 1; lm-retrain/PROPOSAL.md 3B): practice tasks for DERIVE_FROM_BEHAVIOR. A deterministic,
// seeded generator picks a TRUE program from the forms the derive skill is used for (if/eq, threshold, range, the S1
// shape, a hidden island, caps / floors / clamps, square, linear, the S2 backoff, string joins, the S3 conditional
// suffix, identity), then an example set: either one that shows every region, edge and cap ("full"), or one that
// deliberately leaves something unwitnessed, in the mistake categories of Auditor's #491 reviews (hidden island,
// unwitnessed cap, missing equality neighbour, missing far side, narrow span, missing characters, Auditor's amb3
// random sets, sparse random subsets). deriveProgram runs on the examples alone (the truth is never shown to it);
// the outcome is graded against the truth on a dense input grid: right / wrong / refused. A refusal's questions are
// graded too (is the truth's result among the answers; does answering rule something out), and optionally the ask
// loop is run, every question answered from the truth, to see where it ends. Every wrong accepted program is
// returned in the derive mistakes ledger's shape (peaceai-derive-mistakes:v1), so it can be added there.
// No model and no training: labels are exact, computed on the CPU. The engine's own budgets bound every search.
import { readFileSync } from "node:fs";
import { deriveProgram, derivedExprProblem, DERIVE_ORDER_LOOKALIKES, DERIVE_MAX_EXAMPLES, DERIVE_MAX_STRING, type DeriveExample, type DeriveInput, type DeriveNode, type DeriveParam, type DeriveType, type DeriveValue } from "./derive.ts";

export const PRACTICE_SCHEMA = "peaceai-derive-practice:v1";
export type Truth = (args: readonly DeriveValue[]) => DeriveValue;

/** The modes: how the example set is drawn. Every mode but "full" leaves something unwitnessed on purpose. */
export type PracticeMode =
  | "full"                  // every region, both sides of every edge, DERIVE_FAR past the outermost ones, caps reached on both sides
  | "hidden_island"         // no example inside a band the truth has inside a region (Auditor #491 round 2)
  | "unwitnessed_cap"       // no example reaches the cap (Auditor #491 round 2, amb3 cap lin2 / backoff)
  | "missing_eq_neighbour"  // p === k shown without k - 1 or k + 1
  | "missing_far_side"      // nothing at least DERIVE_FAR past the last edge on one side (Auditor #491 round 1, S1 without 600)
  | "missing_point"         // a single-input special case never shown (known limit: no example-only gate can see it)
  | "narrow_span"           // the computed-from parameter shown over less than DERIVE_FAR
  | "missing_chars"         // the string parameters show only some character classes
  | "missing_empty"         // the empty-string branch never shown
  | "missing_digits"        // a number written as text shown only with 3-digit values (M101 template joins)
  | "lookalike"             // string values that contain the template's own literal texts (M101 template joins); M102: a look-alike string order as the truth
  | "missing_equal"         // no example with equal string values (M102 if-return chains: < vs <=, the 0 branch)
  | "missing_order"         // no example where a look-alike string order (case-insensitive, natural, shorter-first, first character) differs (M102)
  | "amb3"                  // Auditor's amb3 sets: 4-12 random values in -5..24, a third near k
  | "sparse";               // 4-8 examples drawn from the full set

export interface PracticeTask {
  index: number;
  seed: number;
  form: string;
  mode: PracticeMode;
  category: string;
  /** A single-input exception no example shows (the known limit Auditor noted on S1 without 429): reported, not failed. */
  knownLimit: boolean;
  /** The truth's single-input special case, if any (see knownLimit). */
  point?: (a: readonly DeriveValue[]) => boolean;
  /**
   * The known limit "cap above every example": the truth caps its one number parameter at this value and no example
   * goes past it, so the uncapped program fits every example (undetectable from examples alone; the mitigation is the
   * review note's far-probe table, which shows the picked program's results far past the examples for the reviewer).
   */
  capAbove?: number;
  params: DeriveParam[];
  ret: DeriveType;
  examples: DeriveExample[];
  truth: Truth;
  truthText: string;
  /** What the mode left unwitnessed, in words (the ledger's `why`). */
  why: string;
  grid: DeriveValue[][];
}

// ---- deterministic randomness
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** The seed of task `index` under run seed `seed` (independent of the shard it runs in). */
export function taskSeed(seed: number, index: number): number {
  let h = Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(index + 1, 0xc2b2ae35);
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d); h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
  return (h ^ (h >>> 16)) >>> 0;
}
interface R { f: () => number; int: (lo: number, hi: number) => number; pick: <T>(xs: readonly T[]) => T; shuffle: <T>(xs: T[]) => T[] }
function rand(seed: number): R {
  const f = mulberry32(seed);
  const int = (lo: number, hi: number) => lo + Math.floor(f() * (hi - lo + 1));
  return {
    f, int,
    pick: (xs) => xs[Math.floor(f() * xs.length)]!,
    shuffle: (xs) => { for (let i = xs.length - 1; i > 0; i--) { const j = Math.floor(f() * (i + 1)); [xs[i], xs[j]] = [xs[j]!, xs[i]!]; } return xs; },
  };
}

// ---- example-set helpers
const FAR = 100;
const key = (a: readonly DeriveValue[]) => JSON.stringify(a);
const uniqInts = (xs: number[]) => [...new Set(xs.map((x) => Math.round(x)))].sort((a, b) => a - b);
/**
 * Points that show a number line cut at `cuts` (a cut c: the result may change between c and c + 1): both sides of
 * every cut, quarter points inside each finite region (so no gap is over half of it), and 50 / 100 / 150 past the
 * outermost cuts (open regions shown, gaps of 50).
 */
export function coverLine(cuts: readonly number[]): number[] {
  const cs = uniqInts([...cuts]);
  const pts: number[] = [];
  for (const c of cs) pts.push(c, c + 1);
  for (let k = 1; k < cs.length; k++) {
    const a = cs[k - 1]! + 1, b = cs[k]!, w = b - a;
    for (const q of [0.25, 0.5, 0.75]) pts.push(a + Math.round(w * q));
  }
  const lo = cs[0]!, hi = cs[cs.length - 1]! + 1;
  for (const d of [50, 100, 150]) pts.push(lo - d, hi + d);
  return uniqInts(pts);
}
/** A dense one-parameter grid: every integer from lo - 300 to hi + 300 (at most 6001 values), plus far values. */
function grid1(xs: readonly number[]): number[] {
  const lo = Math.min(...xs), hi = Math.max(...xs);
  const a = Math.max(lo - 300, Math.round((lo + hi) / 2) - 3000), b = Math.min(hi + 300, Math.round((lo + hi) / 2) + 3000);
  const out: number[] = [];
  for (let x = a; x <= b; x++) out.push(x);
  for (const f of [1e3, 1e4, 1e5, 1e6, 1e9]) out.push(f, -f);
  return uniqInts(out);
}
/** Values for one parameter of a two-parameter grid: about 90 values from lo - 60 to hi + 60, each constant +-3, far. */
function axis(xs: readonly number[], consts: readonly number[]): number[] {
  const lo = Math.min(...xs, ...consts), hi = Math.max(...xs, ...consts);
  const a = lo - 60, b = hi + 60, step = Math.max(1, Math.ceil((b - a) / 90));
  const out: number[] = [];
  for (let x = a; x <= b; x += step) out.push(x);
  for (const c of consts) for (let d = -3; d <= 3; d++) out.push(c + d);
  for (let d = -5; d <= 5; d++) out.push(d);
  out.push(...xs, 1e4, -1e4, 1e6, -1e6);
  return uniqInts(out);
}
const cross = (as: readonly DeriveValue[], bs: readonly DeriveValue[]) => as.flatMap((a) => bs.map((b) => [a, b]));
/** Strings for a string grid: every character class the chars gate names, empties and the example values. */
const STRING_GRID = ["", "a", "Z", "7", "-", "ab", "AB", "Ab", "a b", " a", "a ", " ", "x:y", "x=y", "a1", "Hello World", "  pad  ", "ERR_42", "tab\tx", "Ünï", "\"q\"", "a\\b"];

const num = (name: string): DeriveParam => ({ name, type: "number" });
const str = (name: string): DeriveParam => ({ name, type: "string" });
const N = (a: readonly DeriveValue[], i = 0) => a[i] as number;
const S = (a: readonly DeriveValue[], i = 0) => a[i] as string;

/** What a form builds for one mode: example inputs (outputs come from the truth), the why text, or null when the mode does not apply. */
interface Built { params: DeriveParam[]; ret: DeriveType; truth: Truth; truthText: string; inputs: DeriveValue[][]; why: string; grid: DeriveValue[][]; knownLimit?: boolean; /** An upper cap on parameter 0 (see PracticeTask.capAbove). */ capAbove?: number; /** The truth's single-input special case (p === k), if it has one: unshown, it is the known limit. */ point?: (a: readonly DeriveValue[]) => boolean }
type Form = { name: string; modes: readonly PracticeMode[]; build: (r: R, mode: PracticeMode) => Built };

/** Auditor's amb3 input sets: 4-12 distinct values, each in -5..24, a third of them k - 1..k + 1. */
function amb3(r: R, np: number, k: number): DeriveValue[][] {
  const m = new Map<string, number[]>(), n = r.int(4, 12);
  while (m.size < n) { const a = Array.from({ length: np }, () => (r.int(0, 2) === 0 ? k + r.int(-1, 1) : r.int(-5, 24))); m.set(key(a), a); }
  return [...m.values()];
}
const sparse = (r: R, full: DeriveValue[][]) => r.shuffle([...full]).slice(0, r.int(4, 8));
/** Drop every input matching `drop`; the why when something was dropped. */
const without = (xs: DeriveValue[][], drop: (a: readonly DeriveValue[]) => boolean) => xs.filter((a) => !drop(a));

function oneParamBool(name: string, truth: Truth, truthText: string, cuts: number[], r: R, mode: PracticeMode, extra: { island?: [number, number]; eq?: number } = {}): Built {
  const full = coverLine(cuts).map((x) => [x] as DeriveValue[]);
  const lo = Math.min(...cuts), hi = Math.max(...cuts) + 1;
  let inputs = full, why = "every region, edge and far side shown";
  let knownLimit = false;
  if (mode === "missing_far_side") {
    const up = r.f() < 0.5;
    inputs = up ? without(full, (a) => N(a) > hi) : without(full, (a) => N(a) < lo);
    why = up ? `nothing at least ${FAR} past the last edge (${hi - 1}) was shown, so the open end above it is assumed` : `nothing at least ${FAR} before the first edge (${lo}) was shown, so the open end below it is assumed`;
  } else if (mode === "missing_eq_neighbour" && extra.eq !== undefined) {
    const d = r.f() < 0.5 ? -1 : 1;
    inputs = without(full, (a) => N(a) === extra.eq! + d);
    why = `${name} = ${extra.eq} was shown but not ${name} = ${extra.eq + d}, so where the special case ends on that side is assumed`;
  } else if (mode === "missing_point" && extra.eq !== undefined) {
    inputs = without(full, (a) => N(a) === extra.eq);
    why = `no example had ${name} = ${extra.eq}, so the single-input special case there was never seen`;
    knownLimit = true;
  } else if (mode === "hidden_island" && extra.island) {
    const [b, c] = extra.island;
    inputs = without(full, (a) => N(a) >= b && N(a) <= c);
    // Auditor's shape: the false region around the island shown at its ends and a few points outside the island.
    why = `no example inside ${b}..${c}, so the band there was never seen`;
  } else if (mode === "sparse") { inputs = sparse(r, full); why = "a random handful of the examples"; }
  else if (mode === "amb3") { inputs = amb3(r, 1, lo); why = "Auditor's amb3 set: a few values in -5..24"; }
  const xs = [...inputs.map((a) => N(a)), ...cuts];
  return { params: [num(name)], ret: "boolean", truth, truthText, inputs, why, grid: grid1(xs).map((x) => [x]), knownLimit, ...(extra.eq !== undefined ? { point: (a: readonly DeriveValue[]) => N(a) === extra.eq } : {}) };
}

export const FORMS: readonly Form[] = [
  {
    name: "identity", modes: ["full", "narrow_span", "missing_chars", "sparse"],
    build: (r, mode) => {
      const isStr = mode === "missing_chars" || (mode !== "narrow_span" && r.f() < 0.4);
      if (isStr) {
        const all = ["Hello World", "a", "x7", " lead", "trail ", "ERR_42", "MiXeD case", "id-9", "q", "Zed"];
        const lower = ["abc", "hello", "xyz", "q", "word", "lower"];
        const inputs = (mode === "missing_chars" ? lower : mode === "sparse" ? r.shuffle([...all]).slice(0, r.int(3, 6)) : all).map((s) => [s] as DeriveValue[]);
        const why = mode === "missing_chars" ? "the string values show only lower-case letters, so a case change, trim or escape would not show" : mode === "sparse" ? "a random handful of the examples" : "every character class shown";
        return { params: [str("s")], ret: "string", truth: (a) => S(a), truthText: "s", inputs, why, grid: STRING_GRID.map((s) => [s]) };
      }
      const full = uniqInts([-150, -100, -37, -1, 0, 1, 2, 5, 42, 99, 150, r.int(-300, 300)]).map((x) => [x] as DeriveValue[]);
      const narrow = uniqInts([0, 1, 2, 3, 5, 8, 13, r.int(14, 60)]).map((x) => [x] as DeriveValue[]);
      const inputs = mode === "narrow_span" ? narrow : mode === "sparse" ? sparse(r, full) : full;
      const why = mode === "narrow_span" ? `n only shown over ${Math.max(...inputs.map((a) => N(a))) - Math.min(...inputs.map((a) => N(a)))} values, so a cap or clamp would not show` : mode === "sparse" ? "a random handful of the examples" : "n shown over a wide stretch on both sides of 0";
      return { params: [num("n")], ret: "number", truth: (a) => N(a), truthText: "n", inputs, why, grid: grid1(inputs.map((a) => N(a))).map((x) => [x]) };
    },
  },
  {
    name: "threshold", modes: ["full", "missing_far_side", "sparse", "amb3"],
    build: (r, mode) => {
      const k = mode === "amb3" ? r.int(2, 16) : r.int(-50, 600), ge = r.f() < 0.5;
      const truth: Truth = ge ? (a) => N(a) >= k : (a) => N(a) <= k;
      return oneParamBool("n", truth, ge ? `n >= ${k}` : `n <= ${k}`, [ge ? k - 1 : k], r, mode);
    },
  },
  {
    name: "range", modes: ["full", "missing_far_side", "sparse", "amb3"],
    build: (r, mode) => {
      const lo = mode === "amb3" ? r.int(2, 16) : r.int(-50, 500), hi = lo + (mode === "amb3" ? 5 : r.int(2, 120));
      return oneParamBool("n", (a) => lo <= N(a) && N(a) <= hi, `${lo} <= n && n <= ${hi}`, [lo - 1, hi], r, mode);
    },
  },
  {
    name: "s1_shape", modes: ["full", "missing_eq_neighbour", "missing_far_side", "missing_point", "sparse"],
    build: (r, mode) => {
      const k = r.int(100, 450), lo = k + r.int(20, 120), hi = lo + r.int(10, 150);
      return oneParamBool("status", (a) => N(a) === k || (lo <= N(a) && N(a) <= hi), `status === ${k} || (${lo} <= status && status <= ${hi})`, [k - 1, k, lo - 1, hi], r, mode, { eq: k });
    },
  },
  {
    name: "eq_or_ge", modes: ["full", "missing_eq_neighbour", "missing_far_side", "missing_point", "sparse", "amb3"],
    build: (r, mode) => {
      const k = mode === "amb3" ? r.int(2, 16) : r.int(-40, 400), d = mode === "amb3" ? 10 : r.int(3, 60);
      return oneParamBool("n", (a) => N(a) === k || N(a) >= k + d, `n === ${k} || n >= ${k + d}`, [k - 1, k, k + d - 1], r, mode, { eq: k });
    },
  },
  {
    name: "island", modes: ["full", "hidden_island", "sparse", "amb3"],
    build: (r, mode) => {
      const a = mode === "amb3" ? r.int(2, 16) : r.int(-30, 200);
      const b = a + (mode === "amb3" ? 10 : r.int(4, 40)), c = b + (mode === "amb3" ? 10 : r.int(2, 30)), d = c + (mode === "amb3" ? 20 : r.int(4, 40));
      return oneParamBool("n", (x) => N(x) <= a || (b <= N(x) && N(x) <= c) || N(x) >= d, `n <= ${a} || (${b} <= n && n <= ${c}) || n >= ${d}`, [a, b - 1, c, d - 1], r, mode, { island: [b, c] });
    },
  },
  {
    name: "if_eq", modes: ["full", "missing_eq_neighbour", "missing_point", "sparse", "amb3"],
    build: (r, mode) => {
      const k = mode === "amb3" ? r.int(2, 16) : r.int(-20, 60);
      const truth: Truth = (x) => (N(x) === k ? 0 : N(x) + N(x, 1));
      // Few distinct values: the near rival search takes every example value as a constant (more values, more budget).
      let inputs: DeriveValue[][] = [[k - 1, 3], [k, 3], [k, 41], [k + 1, 3], [k - 100, -60], [k + 100, 90], [0, -7], [k + 50, 0]];
      for (const x of r.shuffle(cross([k - 1, k + 1, k - 100, k + 100, 0], [3, 41, -60, 90])).slice(0, r.int(0, 4))) inputs.push(x);
      let why = "a = k shown with a = k - 1 and k + 1, a and b shown over a wide stretch", knownLimit = false;
      if (mode === "missing_eq_neighbour") { const dd = r.f() < 0.5 ? -1 : 1; inputs = without(inputs, (x) => x[0] === k + dd); why = `a = ${k} was shown but not a = ${k + dd}`; }
      else if (mode === "missing_point") { inputs = without(inputs, (x) => x[0] === k); why = `no example had a = ${k}, so the special case there was never seen`; knownLimit = true; }
      else if (mode === "sparse") { inputs = sparse(r, inputs); why = "a random handful of the examples"; }
      else if (mode === "amb3") { inputs = amb3(r, 2, k); why = "Auditor's amb3 set: a few values in -5..24"; }
      const ax = axis(inputs.map((x) => N(x)), [k]), bx = axis(inputs.map((x) => N(x, 1)), [0]);
      return { params: [num("a"), num("b")], ret: "number", truth, truthText: `a === ${k} ? 0 : a + b`, inputs, why, grid: cross(ax, bx), knownLimit, point: (x) => N(x) === k };
    },
  },
  {
    name: "cap_sq", modes: ["full", "unwitnessed_cap", "missing_far_side", "sparse", "amb3"],
    build: (r, mode) => {
      const K = mode === "unwitnessed_cap" ? r.int(3200, 9000) : mode === "amb3" ? r.int(2, 16) : r.int(150, 2500);
      const root = Math.floor(Math.sqrt(K));
      const truth: Truth = (a) => Math.min(K, N(a) * N(a));
      let xs: number[];
      let why = "both sides of the cap shown, far past it";
      if (mode === "unwitnessed_cap") { xs = uniqInts([-root + 1, -20, -3, -1, 0, 1, 2, 5, 17, 30, root - 1, Math.min(root - 2, 50)]); why = `no example reached the cap ${K}`; }
      else if (mode === "missing_far_side") { xs = uniqInts([-root + 1, -3, 0, 1, 2, 5, root - 1, root + 1, -root - 1, root - 10]); why = `the cap ${K} was only reached just past it, never ${FAR} past`; }
      else xs = uniqInts([-root - 40, -root - 3, -root, -5, -1, 0, 1, 2, 3, root, root + 2, root + 30, root + 90, -root + 2]);
      let inputs = xs.map((x) => [x] as DeriveValue[]);
      if (mode === "sparse") { inputs = sparse(r, inputs); why = "a random handful of the examples"; }
      if (mode === "amb3") { inputs = amb3(r, 1, K); why = "Auditor's amb3 set: a few values in -5..24"; }
      return { params: [num("n")], ret: "number", truth, truthText: `Math.min(${K}, n * n)`, inputs, why, grid: grid1([...inputs.map((a) => N(a)), root * 3, -root * 3]).map((x) => [x]) };
    },
  },
  {
    name: "cap_lin2", modes: ["full", "unwitnessed_cap", "sparse", "amb3"],
    build: (r, mode) => {
      const K = mode === "amb3" ? 10 * r.int(2, 16) : mode === "unwitnessed_cap" ? r.int(5000, 9000) : r.int(100, 1500);
      const truth: Truth = (a) => Math.min(K, N(a) * N(a, 1));
      let inputs: DeriveValue[][];
      let why = "both sides of the cap shown, far past it";
      if (mode === "unwitnessed_cap") { inputs = [[-60, 3], [0, 5], [40, -2], [7, 9], [-5, -5], [12, 30], [50, 1], [-1, 60], [3, -70], [20, 20]]; why = `no example had a product above ${K}`; }
      else inputs = [[-60, 3], [0, 5], [40, -2], [7, 9], [-5, -5], [2, 2], [1, -90], [K, 1], [K, 2], [2 * K, 3], [-K, -3], [K + 200, 1], [60, 60], [-3, 70], [9, -9]];
      if (mode === "sparse") { inputs = sparse(r, inputs); why = "a random handful of the examples"; }
      if (mode === "amb3") { inputs = amb3(r, 2, K / 10); why = "Auditor's amb3 set: a few values in -5..24"; }
      const ax = axis(inputs.map((x) => N(x)), []), bx = axis(inputs.map((x) => N(x, 1)), []);
      return { params: [num("a"), num("b")], ret: "number", truth, truthText: `Math.min(${K}, a * b)`, inputs, why, grid: cross(ax, bx) };
    },
  },
  {
    name: "floor_clamp", modes: ["full", "unwitnessed_cap", "missing_far_side", "sparse", "amb3"],
    build: (r, mode) => {
      const kind = r.pick(["floor", "cap", "clamp"] as const);
      const lo = mode === "amb3" ? r.int(2, 16) : r.int(-100, 300), hi = lo + r.int(20, 300);
      const truth: Truth = kind === "floor" ? (a) => Math.max(lo, N(a)) : kind === "cap" ? (a) => Math.min(hi, N(a)) : (a) => Math.max(lo, Math.min(hi, N(a)));
      const truthText = kind === "floor" ? `Math.max(${lo}, n)` : kind === "cap" ? `Math.min(${hi}, n)` : `Math.max(${lo}, Math.min(${hi}, n))`;
      const cuts = kind === "floor" ? [lo] : kind === "cap" ? [hi] : [lo, hi];
      const full = coverLine(cuts);
      let xs = full, why = "both sides of every cap shown, far past it";
      if (mode === "unwitnessed_cap") {
        // the values on the capped side are dropped (the cap is never reached)
        xs = kind === "floor" ? full.filter((x) => x > lo) : full.filter((x) => x < hi);
        if (kind === "clamp") xs = full.filter((x) => x > lo && x < hi).concat([lo - 50, lo - 150, lo - 1]);
        why = kind === "floor" ? `no example went below the floor ${lo}` : `no example went above the cap ${hi}`;
      } else if (mode === "missing_far_side") {
        xs = kind === "floor" ? full.filter((x) => x >= lo - 1) : full.filter((x) => x <= hi + 1);
        why = kind === "floor" ? `nothing at least ${FAR} below the floor ${lo}` : `nothing at least ${FAR} past the cap ${hi}`;
      }
      let inputs = xs.map((x) => [x] as DeriveValue[]);
      if (mode === "sparse") { inputs = sparse(r, inputs); why = "a random handful of the examples"; }
      if (mode === "amb3") { inputs = amb3(r, 1, lo); why = "Auditor's amb3 set: a few values in -5..24"; }
      return { params: [num("n")], ret: "number", truth, truthText, inputs, why, grid: grid1([...inputs.map((a) => N(a)), lo, hi]).map((x) => [x]), ...(kind !== "floor" ? { capAbove: hi } : {}) };
    },
  },
  {
    name: "square", modes: ["full", "narrow_span", "sparse"],
    build: (r, mode) => {
      const off = r.pick([0, 0, 1, -1]);
      const truth: Truth = (a) => (N(a) + off) * (N(a) + off);
      const full = uniqInts([-150, -60, -7, -2, -1, 0, 1, 2, 3, 9, 33, 120, r.int(-200, 200)]);
      const narrow = uniqInts([-3, -1, 0, 1, 2, 4, 9, r.int(10, 40)]);
      const xs = mode === "narrow_span" ? narrow : full;
      let inputs = xs.map((x) => [x] as DeriveValue[]), why = mode === "narrow_span" ? "n only shown over a short stretch, so a cap would not show" : "n shown wide on both sides of 0";
      if (mode === "sparse") { inputs = sparse(r, inputs); why = "a random handful of the examples"; }
      return { params: [num("n")], ret: "number", truth, truthText: off ? `(n + ${off}) * (n + ${off})`.replace("+ -", "- ") : "n * n", inputs, why, grid: grid1(inputs.map((a) => N(a))).map((x) => [x]) };
    },
  },
  {
    name: "linear", modes: ["full", "narrow_span", "sparse"],
    build: (r, mode) => {
      const two = r.f() < 0.4;
      if (two) {
        const v = r.pick([["a + b", (a: readonly DeriveValue[]) => N(a) + N(a, 1)], ["a - b", (a: readonly DeriveValue[]) => N(a) - N(a, 1)], ["2 * a + b", (a: readonly DeriveValue[]) => 2 * N(a) + N(a, 1)]] as const);
        let inputs: DeriveValue[][] = mode === "narrow_span" ? [[0, 1], [1, 0], [2, 3], [5, 1], [3, 7], [8, 2], [4, 4]] : [[0, 1], [1, 0], [-120, 3], [5, 110], [33, -7], [-60, -60], [90, 2], [2, 90], [7, 7]];
        let why = mode === "narrow_span" ? "a and b only shown over a short stretch" : "a and b shown wide";
        if (mode === "sparse") { inputs = sparse(r, inputs); why = "a random handful of the examples"; }
        return { params: [num("a"), num("b")], ret: "number", truth: v[1], truthText: v[0], inputs, why, grid: cross(axis(inputs.map((x) => N(x)), []), axis(inputs.map((x) => N(x, 1)), [])) };
      }
      const s = r.int(1, 3), c = r.int(-2, 2);
      const truth: Truth = (a) => s * N(a) + c;
      const xs = mode === "narrow_span" ? uniqInts([0, 1, 2, 3, 5, 8, r.int(9, 50)]) : uniqInts([-150, -40, -1, 0, 1, 2, 7, 64, 150, r.int(-300, 300)]);
      let inputs = xs.map((x) => [x] as DeriveValue[]), why = mode === "narrow_span" ? "n only shown over a short stretch" : "n shown wide on both sides of 0";
      if (mode === "sparse") { inputs = sparse(r, inputs); why = "a random handful of the examples"; }
      return { params: [num("n")], ret: "number", truth, truthText: `${s} * n ${c < 0 ? "-" : "+"} ${Math.abs(c)}`, inputs, why, grid: grid1(inputs.map((a) => N(a))).map((x) => [x]) };
    },
  },
  {
    name: "backoff", modes: ["full", "unwitnessed_cap", "sparse", "amb3"],
    build: (r, mode) => {
      const K = mode === "amb3" ? 100 * r.int(2, 16) : r.pick([30000, 60000, 10000, 100 * r.int(20, 200)]);
      const truth: Truth = (a) => Math.min(K, N(a, 1) * (N(a) + 1) * (N(a) + 1));
      const base = r.pick([100, 250, 500, 1000]);
      const top = Math.ceil(Math.sqrt(K / base));
      let inputs: DeriveValue[][] = [[0, base], [1, base], [2, base], [3, base], [top, base], [top + 1, base], [top + 5, base], [100, base], [0, base * 2], [1, base * 2], [2, Math.round(base / 4)], [0, 0], [7, 0], [0, K + 10000], [3, K + 1000]];
      let why = `the cap ${K} reached on both sides, far past it`;
      if (mode === "unwitnessed_cap") { inputs = inputs.filter((x) => N(x, 1) * (N(x) + 1) * (N(x) + 1) < K); inputs.push([0, 150], [1, 7]); why = `no example reached the cap ${K}`; }
      if (mode === "sparse") { inputs = sparse(r, inputs); why = "a random handful of the examples"; }
      if (mode === "amb3") { inputs = amb3(r, 2, Math.round(K / 100)); why = "Auditor's amb3 set: a few values in -5..24"; }
      const ax = axis(inputs.map((x) => N(x)), [0, top]), bx = axis(inputs.map((x) => N(x, 1)), [0, base]);
      return { params: [num("attempt"), num("baseMs")], ret: "number", truth, truthText: `Math.min(${K}, baseMs * (attempt + 1) ** 2)`, inputs, why, grid: cross(ax, bx) };
    },
  },
  {
    name: "join", modes: ["full", "missing_chars", "sparse"],
    build: (r, mode) => {
      const prefix = r.pick(["ERR:", "id-", "MARK_", "[x] ", "tag="]);
      const two = r.f() < 0.5, sep = r.pick([":", " - ", "/", "="]);
      const rich = ["Hello World", "a", "x7", " lead", "trail ", "ERR_42", "MiXeD", "q.r", "", "Zz 9"];
      const lower = ["abc", "hello", "xyz", "q", "word", "lower", ""];
      const pool = mode === "missing_chars" ? lower : rich;
      let inputs: DeriveValue[][] = two ? r.shuffle(pool.flatMap((a) => pool.map((b) => [a, b] as DeriveValue[]))).slice(0, 14) : pool.map((s) => [s]);
      let why = mode === "missing_chars" ? "the string values show only lower-case letters" : "every character class shown";
      if (mode === "sparse") { inputs = sparse(r, inputs); why = "a random handful of the examples"; }
      const truth: Truth = two ? (a) => S(a) + sep + S(a, 1) : (a) => prefix + S(a);
      return { params: two ? [str("a"), str("b")] : [str("s")], ret: "string", truth, truthText: two ? `a + ${JSON.stringify(sep)} + b` : `${JSON.stringify(prefix)} + s`, inputs, why, grid: two ? cross(STRING_GRID, STRING_GRID) : STRING_GRID.map((s) => [s]) };
    },
  },
  {
    name: "cond_suffix", modes: ["full", "missing_empty", "missing_chars", "sparse"],
    build: (r, mode) => {
      const P = r.pick(["MARKETS_SCHEDULER_HOST_FAILED:", "HOST_DOWN:", "E:"]), mid = r.pick([":cause=", " (", "|code="]);
      const truth: Truth = (a) => (S(a, 1) === "" ? P + S(a) : P + S(a) + mid + S(a, 1));
      const ms = mode === "missing_chars" ? ["fetch failed", "boom", ""] : ["fetch failed", "R2_GET_500", "", " fetch failed ", "x9"];
      const cs = mode === "missing_chars" ? ["econnreset", "", "timeout"] : ["ECONNRESET", "", "UND_ERR_SOCKET", " err 42 ", "ETIMEDOUT"];
      let inputs: DeriveValue[][] = r.shuffle(cross(ms, cs)).slice(0, 16);
      for (const m of ms.slice(0, 2)) for (const c of ["", cs[0]!]) if (!inputs.some((x) => x[0] === m && x[1] === c)) inputs.push([m, c]);
      let why = mode === "missing_chars" ? "the strings show only lower-case letters and spaces" : "empty and non-empty causes shown with every character class";
      if (mode === "missing_empty") { inputs = inputs.filter((x) => x[1] !== ""); why = "no example had an empty cause, so the branch that adds nothing was never seen"; }
      if (mode === "sparse") { inputs = sparse(r, inputs); why = "a random handful of the examples"; }
      return { params: [str("message"), str("causeCode")], ret: "string", truth, truthText: `causeCode === "" ? ${JSON.stringify(P)} + message : ${JSON.stringify(P)} + message + ${JSON.stringify(mid)} + causeCode`, inputs, why, grid: cross(STRING_GRID, STRING_GRID) };
    },
  },
  // ---- M100 scale-up shapes (every one inside the derive DSL; modulo and startsWith are not: see SKIPPED_SHAPES)
  {
    name: "thresh2", modes: ["full", "missing_far_side", "sparse", "amb3"],
    build: (r, mode) => {
      // multi-parameter thresholds: a <= b (parameter against parameter) or a >= k1 && b <= k2
      const pp = r.f() < 0.35;
      if (pp) {
        let inputs: DeriveValue[][] = [];
        for (const x of uniqInts([-150, -40, -1, 0, 1, 7, 55, 160, r.int(-300, 300)])) inputs.push([x, x], [x, x - 1], [x - 1, x]);
        inputs.push([-200, 200], [200, -200], [0, 150], [150, 0]);
        let why = "a and b shown equal, one apart both ways, and far apart both ways";
        if (mode === "missing_far_side") { inputs = inputs.filter((x) => Math.abs(N(x) - N(x, 1)) <= 1); why = "a and b were only ever shown at most 1 apart"; }
        else if (mode === "sparse") { inputs = sparse(r, inputs); why = "a random handful of the examples"; }
        else if (mode === "amb3") { inputs = amb3(r, 2, 10); why = "Auditor's amb3 set: a few values in -5..24"; }
        const ax = axis(inputs.map((x) => N(x)), [0]), bx = axis(inputs.map((x) => N(x, 1)), [0]);
        return { params: [num("a"), num("b")], ret: "boolean", truth: (x) => N(x) <= N(x, 1), truthText: "a <= b", inputs, why, grid: cross(ax, bx) };
      }
      const k1 = mode === "amb3" ? r.int(2, 16) : r.int(-50, 400), k2 = mode === "amb3" ? r.int(2, 16) : r.int(-50, 400);
      const truth: Truth = (x) => N(x) >= k1 && N(x, 1) <= k2;
      const ca = coverLine([k1 - 1]), cb = coverLine([k2]);
      let inputs: DeriveValue[][] = [...ca.map((a) => [a, k2 - 10]), ...cb.map((b) => [k1 + 10, b]), [k1 - 50, k2 + 50], [k1 + 50, k2 + 50], [k1 - 50, k2 - 50]];
      let why = "each threshold shown on both sides and far past it, with the other one met";
      if (mode === "missing_far_side") { const up = r.f() < 0.5; inputs = up ? inputs.filter((x) => N(x) <= k1 + 10) : inputs.filter((x) => N(x, 1) >= k2 - 10); why = up ? `a was never shown more than 10 past ${k1}` : `b was never shown more than 10 below ${k2}`; }
      else if (mode === "sparse") { inputs = sparse(r, inputs); why = "a random handful of the examples"; }
      else if (mode === "amb3") { inputs = amb3(r, 2, k1); why = "Auditor's amb3 set: a few values in -5..24"; }
      const ax = axis(inputs.map((x) => N(x)), [k1]), bx = axis(inputs.map((x) => N(x, 1)), [k2]);
      return { params: [num("a"), num("b")], ret: "boolean", truth, truthText: `a >= ${k1} && b <= ${k2}`, inputs, why, grid: cross(ax, bx) };
    },
  },
  {
    name: "outside_range", modes: ["full", "missing_far_side", "hidden_island", "sparse", "amb3"],
    build: (r, mode) => {
      // two-sided range with open ends: true below lo and above hi
      const lo = mode === "amb3" ? r.int(2, 16) : r.int(-50, 500), hi = lo + (mode === "amb3" ? 5 : r.int(2, 120));
      return oneParamBool("n", (a) => N(a) < lo || N(a) > hi, `n < ${lo} || n > ${hi}`, [lo - 1, hi], r, mode, { island: [lo, hi] });
    },
  },
  {
    name: "nested_cap", modes: ["full", "unwitnessed_cap", "sparse", "amb3"],
    build: (r, mode) => {
      // min of max: Math.min(K2, Math.max(K1, a * b))
      const K1 = mode === "amb3" ? r.int(-5, 5) : r.int(-300, 50), K2 = K1 + (mode === "amb3" ? 10 * r.int(2, 8) : r.int(100, 2000));
      const truth: Truth = (x) => Math.min(K2, Math.max(K1, N(x) * N(x, 1)));
      const all: DeriveValue[][] = [[0, 5], [3, 7], [-2, 9], [1, K1 + 20], [2, Math.floor((K1 + K2) / 4)], [1, K2], [1, K2 + 1], [2, K2], [K2, 3], [1, K2 + 300], [-1, K2 + 300],
        [1, K1], [1, K1 - 1], [K1, 1], [1, K1 - 200], [K1 - 300, 1], [-60, 60], [60, 60], [7, -7], [-9, -9]];
      let inputs = all, why = "both caps reached on both sides, far past each";
      if (mode === "unwitnessed_cap") {
        const top = r.f() < 0.5;
        inputs = all.filter((x) => (top ? N(x) * N(x, 1) < K2 : N(x) * N(x, 1) > K1));
        why = top ? `no example reached the upper cap ${K2}` : `no example reached the floor ${K1}`;
      } else if (mode === "sparse") { inputs = sparse(r, all); why = "a random handful of the examples"; }
      else if (mode === "amb3") { inputs = amb3(r, 2, 3); why = "Auditor's amb3 set: a few values in -5..24"; }
      const ax = axis(inputs.map((x) => N(x)), [0, 1]), bx = axis(inputs.map((x) => N(x, 1)), [K1, K2]);
      return { params: [num("a"), num("b")], ret: "number", truth, truthText: `Math.min(${K2}, Math.max(${K1}, a * b))`, inputs, why, grid: cross(ax, bx) };
    },
  },
  {
    name: "piecewise", modes: ["full", "unwitnessed_cap", "missing_far_side", "narrow_span", "sparse"],
    build: (r, mode) => {
      // piecewise linear, 2 or 3 pieces: Math.max(K1, n + c), Math.min(K2, n + n), Math.min(K2, Math.max(K1, n + n))
      const v = r.pick(["max_lin", "min_dbl", "clamp_dbl"] as const);
      const c = r.pick([0, 1, 2, -1]);
      const K1 = 2 * r.int(-100, 100), K2 = K1 + 2 * r.int(20, 300);
      const truth: Truth = v === "max_lin" ? (a) => Math.max(K1, N(a) + c) : v === "min_dbl" ? (a) => Math.min(K2, 2 * N(a)) : (a) => Math.max(K1, Math.min(K2, 2 * N(a)));
      const lin = c === 0 ? "n" : c > 0 ? `n + ${c}` : `n - ${-c}`;
      const truthText = v === "max_lin" ? `Math.max(${K1}, ${lin})` : v === "min_dbl" ? `Math.min(${K2}, n + n)` : `Math.max(${K1}, Math.min(${K2}, n + n))`;
      const cuts = v === "max_lin" ? [K1 - c] : v === "min_dbl" ? [K2 / 2] : [K1 / 2, K2 / 2];
      const full = uniqInts([...coverLine(cuts), ...cuts.map((x) => x - 1), ...cuts.map((x) => x + 2)]);
      let xs = full, why = "every bend shown on both sides, far past the outermost";
      if (mode === "unwitnessed_cap") { xs = v === "max_lin" ? full.filter((x) => x > cuts[0]!) : full.filter((x) => x < cuts[cuts.length - 1]!); why = "no example reached the flat piece past the last bend"; }
      else if (mode === "missing_far_side") { const hi = Math.max(...cuts), lo = Math.min(...cuts); xs = full.filter((x) => x >= lo - 2 && x <= hi + 3); why = `nothing at least ${FAR} past the bends`; }
      else if (mode === "narrow_span") { const m = Math.round((Math.min(...cuts) + Math.max(...cuts)) / 2); xs = uniqInts([m - 3, m - 1, m, m + 1, m + 2, m + 4]); why = "n only shown over a short stretch between the bends"; }
      let inputs = xs.map((x) => [x] as DeriveValue[]);
      if (mode === "sparse") { inputs = sparse(r, inputs); why = "a random handful of the examples"; }
      return { params: [num("n")], ret: "number", truth, truthText, inputs, why, grid: grid1([...inputs.map((a) => N(a)), ...cuts]).map((x) => [x]) };
    },
  },
  {
    name: "prefix_join", modes: ["full", "missing_empty", "missing_chars", "sparse"],
    build: (r, mode) => {
      // startsWith-like joins the DSL can express: a prefix only when the value is non-empty, or a separator only between two non-empty parts
      const two = r.f() < 0.5, P = r.pick(["ERR:", "id-", "#", "v"]), sep = r.pick([":", "/", " - ", "."]);
      const rich = ["Hello World", "a", "x7", " lead", "trail ", "ERR_42", "MiXeD", "q.r", "", "Zz 9"], lower = ["abc", "hello", "xyz", "q", "word", ""];
      const pool = mode === "missing_chars" ? lower : rich;
      let inputs: DeriveValue[][] = two ? r.shuffle(pool.flatMap((a) => pool.map((b) => [a, b] as DeriveValue[]))).slice(0, 20) : pool.map((s) => [s]);
      if (two) for (const p of [["", "abc"], ["", "Q 1"], ["xy", "Z"], ["M n", "7"]] as DeriveValue[][]) inputs.push(p);
      let why = mode === "missing_chars" ? "the string values show only lower-case letters" : "empty and non-empty values shown with every character class";
      if (mode === "missing_empty") { inputs = inputs.filter((x) => x[0] !== ""); why = "no example had an empty first value, so the branch without the prefix/separator was never seen"; }
      else if (mode === "sparse") { inputs = sparse(r, inputs); why = "a random handful of the examples"; }
      const truth: Truth = two ? (a) => (S(a) === "" ? S(a, 1) : S(a) + sep + S(a, 1)) : (a) => (S(a) === "" ? "" : P + S(a));
      return { params: two ? [str("a"), str("b")] : [str("s")], ret: "string", truth, truthText: two ? `a === "" ? b : a + ${JSON.stringify(sep)} + b` : `s === "" ? "" : ${JSON.stringify(P)} + s`, inputs, why, grid: two ? cross(STRING_GRID, STRING_GRID) : STRING_GRID.map((s) => [s]) };
    },
  },
  {
    name: "bool_combo", modes: ["full", "missing_far_side", "missing_eq_neighbour", "sparse", "amb3"],
    build: (r, mode) => {
      // boolean combinations of 2-3 comparisons over two parameters
      const amb = mode === "amb3";
      const k1 = amb ? r.int(2, 16) : r.int(-50, 300), k2 = amb ? r.int(2, 16) : r.int(-50, 300), k3 = k1 - (amb ? 3 : r.int(5, 40));
      const v = r.pick(["and", "or", "and_or_eq"] as const);
      const truth: Truth = v === "and" ? (x) => N(x) >= k1 && N(x, 1) >= k2 : v === "or" ? (x) => N(x) <= k1 || N(x, 1) >= k2 : (x) => (N(x) >= k1 && N(x, 1) <= k2) || N(x) === k3;
      const truthText = v === "and" ? `a >= ${k1} && b >= ${k2}` : v === "or" ? `a <= ${k1} || b >= ${k2}` : `(a >= ${k1} && b <= ${k2}) || a === ${k3}`;
      const cutA = v === "or" ? [k1] : [k1 - 1, ...(v === "and_or_eq" ? [k3 - 1, k3] : [])], cutB = v === "and_or_eq" ? [k2] : [k2 - 1];
      // a small cover of each axis (both sides of every cut, between cuts, 100 past the ends), crossed: at most 40
      const small = (cs: number[]) => uniqInts([...cs.flatMap((c) => [c, c + 1]), Math.min(...cs) - FAR, Math.max(...cs) + 1 + FAR, ...cs.slice(1).map((c, i) => Math.round((c + cs[i]! + 1) / 2))]);
      const A = small(cutA), B = small(cutB);
      let inputs = cross(A, B);
      if (inputs.length > DERIVE_MAX_EXAMPLES) inputs = r.shuffle(inputs).slice(0, DERIVE_MAX_EXAMPLES);
      let why = "every comparison shown on both sides of its edge and far past it, across the other parameter's regions";
      if (mode === "missing_far_side") { const lo = Math.min(...cutA) - 5, hi = Math.max(...cutA) + 6; inputs = inputs.filter((x) => N(x) >= lo && N(x) <= hi); why = "a was never shown far from its edges"; }
      else if (mode === "missing_eq_neighbour") { const e = v === "and_or_eq" ? k3 : cutA[0]!; const d = v === "and_or_eq" && r.f() < 0.5 ? -1 : 1; inputs = inputs.filter((x) => N(x) !== e + d); why = `a = ${e} was shown but not a = ${e + d}`; }
      else if (mode === "sparse") { inputs = sparse(r, inputs); why = "a random handful of the examples"; }
      else if (amb) { inputs = amb3(r, 2, k1); why = "Auditor's amb3 set: a few values in -5..24"; }
      const ax = axis(inputs.map((x) => N(x)), [k1, k3]), bx = axis(inputs.map((x) => N(x, 1)), [k2]);
      return { params: [num("a"), num("b")], ret: "boolean", truth, truthText, inputs, why, grid: cross(ax, bx), ...(v === "and_or_eq" ? { point: (x: readonly DeriveValue[]) => N(x) === k3 } : {}) };
    },
  },
  // ---- M101 template joins (PeaceSTOCKS key builders: "permanent/…/base-" + asOf + "-" + sha + ".jsonl.zst")
  {
    name: "template_join", modes: ["full", "missing_chars", "missing_empty", "missing_digits", "lookalike", "sparse"],
    build: (r, mode) => {
      const k = r.int(1, 3);
      const kinds = Array.from({ length: k }, () => (r.f() < 0.3 ? "number" : "string") as "number" | "string");
      const names = kinds.map((t, i) => (t === "number" ? ["seq", "n", "count"][i]! : ["asOf", "sha", "month"][i]!));
      const order = r.shuffle(kinds.map((_, i) => i));
      const pad = kinds.includes("number") && r.f() < 0.2; // String(n).padStart(3, "0"): outside the DSL, must be refused
      const lits = [r.pick(["permanent/ticker-reference-index/base-", "permanent/daily-reply-dust/", "id-", "", "v", "manifest-"]),
        ...order.slice(1).map(() => r.pick(["-", "/", "_", ":", "-v", "", "/part-"])), r.pick(["", ".json", ".jsonl.zst", "/", "-x"])];
      const text = (a: readonly DeriveValue[], i: number) => (kinds[i] === "number" ? (pad ? String(N(a, i)).padStart(3, "0") : String(N(a, i))) : S(a, i));
      const truth: Truth = (a) => lits[0] + order.map((i, j) => text(a, i) + lits[j + 1]).join("");
      const slotText = (i: number) => (kinds[i] === "number" ? (pad ? `String(${names[i]}).padStart(3, "0")` : `String(${names[i]})`) : names[i]!);
      const truthText = [lits[0] ? JSON.stringify(lits[0]) : "", ...order.flatMap((i, j) => [slotText(i), lits[j + 1] ? JSON.stringify(lits[j + 1]) : ""])].filter(Boolean).join(" + ");
      const rich = ["2026-10-23", "Hello World", "a", "x7", " lead", "trail ", "ERR_42", "MiXeD", "q.r", "", "Zz 9", "deadbeef"];
      const look = [...rich.slice(0, 6), "", ...lits.filter(Boolean).map((l) => `${l}${l}`).slice(0, 3), "a-b", "x/y_z", "-", "v1.json"];
      const lower = ["abc", "hello", "xyz", "q", "word", "lower"];
      const spool = mode === "missing_chars" ? lower : mode === "lookalike" ? look : mode === "missing_empty" ? rich.filter((v) => v !== "") : rich;
      const npool = mode === "missing_digits" ? [100, 123, 250, 999, 404] : [0, 7, -3, 42, 123, 2026, 99999, -450];
      const pool = (i: number): DeriveValue[] => (kinds[i] === "number" ? npool : spool);
      const seen = new Set<string>();
      let inputs: DeriveValue[][] = [];
      // every value of every parameter shown at least once, the rest random
      const want = Math.max(...kinds.map((_, i) => pool(i).length)) + 4;
      for (let t = 0; inputs.length < want && t < 400; t++) {
        const a = kinds.map((_, i) => { const p = pool(i); return t < want ? p[(t + i * 3) % p.length]! : r.pick(p); });
        const key0 = JSON.stringify(a);
        if (!seen.has(key0)) { seen.add(key0); inputs.push(a); }
      }
      let why = mode === "missing_chars" ? "the string values show only lower-case letters (no empty value)" : mode === "missing_empty" ? "no example had an empty string value" : mode === "missing_digits" ? "the numbers were shown only with 3 digits" : mode === "lookalike" ? "string values containing the template's own literal texts" : "every character class, the empty string and 1- to 5-digit numbers shown";
      if (mode === "sparse") { inputs = sparse(r, inputs); why = "a random handful of the examples"; }
      const sg = k === 3 ? ["", "a", "Z", "-", "a b", " a", "x:y", "a1", "Hello World", "\"q\""] : STRING_GRID;
      const ng = [-1000, -450, -12, -7, -1, 0, 1, 2, 5, 7, 9, 10, 42, 99, 100, 101, 999, 1000, 1234, 2026, 99999, 1000000]; // >= 20 (the task-shape test), 1-7 digits
      const g = kinds.map((t) => (t === "number" ? ng : sg) as DeriveValue[]);
      const grid = g.reduce<DeriveValue[][]>((acc, xs) => acc.flatMap((a) => xs.map((x) => [...a, x])), [[]]);
      return { params: kinds.map((t, i) => (t === "number" ? num(names[i]!) : str(names[i]!))), ret: "string", truth, truthText, inputs, why, grid };
    },
  },
  // ---- M102 if-return chains (PeaceSTOCKS byCodeUnit: (a, b) => a < b ? -1 : a > b ? 1 : 0), over code-unit string order
  {
    name: "if_chain", modes: ["full", "missing_equal", "missing_order", "missing_chars", "lookalike", "sparse"],
    build: (r, mode) => {
      const v = r.pick(["cmp3", "cmp3", "cmp3", "lt", "le", "gt", "ge", "max", "min"] as const);
      const [lo, hi, eq] = r.pick([[-1, 1, 0], [1, -1, 0], [-1, 1, 0], [-2, 2, 0], [0, 2, 1]] as const);
      const names = r.pick([["a", "b"], ["left", "right"], ["x", "y"]] as const);
      // the truth's order: code-unit (JS < on strings), or in lookalike mode an order that only looks like it
      const look = mode === "lookalike" ? r.pick(DERIVE_ORDER_LOOKALIKES.slice(1)) : null;
      const le = (x: string, y: string) => (look ? look.le(x, y) : x <= y);
      const lt = (x: string, y: string) => !le(y, x);
      const truth: Truth = (a) => {
        const x = S(a, 0), y = S(a, 1);
        switch (v) {
          case "cmp3": return lt(x, y) ? lo : lt(y, x) ? hi : eq;
          case "lt": return lt(x, y);
          case "le": return le(x, y);
          case "gt": return lt(y, x);
          case "ge": return le(y, x);
          case "max": return lt(x, y) ? y : x;
          case "min": return lt(y, x) ? y : x;
        }
      };
      const [A, B] = names;
      const body = { cmp3: `${A} < ${B} ? ${lo} : ${A} > ${B} ? ${hi} : ${eq}`, lt: `${A} < ${B}`, le: `${A} <= ${B}`, gt: `${A} > ${B}`, ge: `${A} >= ${B}`, max: `${A} < ${B} ? ${B} : ${A}`, min: `${A} > ${B} ? ${B} : ${A}` }[v];
      const truthText = look ? `${body} (with ${look.name} in place of code-unit order)` : body;
      const rich = ["", "a", "B", "aa", "ab", "ac", "b", "10", "9", "Hello World", " lead", "trail ", "x.y", "MiXeD", "Zz 9", "2026-10-23", "2026-09-30"];
      const lower = ["abc", "abd", "bcd", "xyz", "q", "word"];
      const pool = mode === "missing_chars" ? lower : rich;
      const witness: [string, string][] = [["a", "B"], ["B", "a"], ["10", "9"], ["9", "10"], ["b", "aa"], ["aa", "b"], ["ac", "ab"], ["ab", "ac"]];
      const seen = new Set<string>();
      let inputs: DeriveValue[][] = [];
      const add = (x: string, y: string) => { const k0 = key([x, y]); if (!seen.has(k0)) { seen.add(k0); inputs.push([x, y]); } };
      if (mode !== "missing_chars") for (const [x, y] of witness) add(x, y);
      for (const x of pool.slice(0, 4)) add(x, x);
      for (let t = 0; inputs.length < 30 && t < 400; t++) add(r.pick(pool), r.pick(pool));
      const differs = (a: readonly DeriveValue[]) => DERIVE_ORDER_LOOKALIKES.slice(1).some((L) => L.le(S(a, 0), S(a, 1)) !== S(a, 0) <= S(a, 1));
      let why = mode === "missing_chars" ? "the string values show only lower-case letters (no empty value)" : look ? `the truth uses ${look.name}, not code-unit order` : "equal values, every look-alike order's differing pairs and every character class shown";
      if (mode === "missing_equal") { inputs = without(inputs, (a) => S(a, 0) === S(a, 1)); why = "no example had equal values, so < vs <= (the equal branch) was never seen"; }
      else if (mode === "missing_order") { inputs = without(inputs, differs); why = "no example where a case-insensitive, natural, shorter-first or first-character order differs from code-unit order"; }
      else if (mode === "sparse") { inputs = sparse(r, inputs); why = "a random handful of the examples"; }
      const sg = [...new Set([...rich, "A", "Ab", "aB", "b ", "a a", "09", "100", "~", "-", "Ünï", "ERR_42"])];
      return { params: [str(A), str(B)], ret: v === "max" || v === "min" ? "string" : v === "cmp3" ? "number" : "boolean", truth, truthText, inputs, why, grid: cross(sg, sg) };
    },
  },
];

/** Shapes asked for in M100 that the derive DSL cannot express, so no practice form draws them. */
export const SKIPPED_SHAPES: readonly { shape: string; why: string }[] = [
  { shape: "modulo / parity (n % k)", why: "the DSL has no remainder operator" },
  { shape: "startsWith / prefix tests on a string", why: "a string parameter is only ever tested for emptiness (no literal comparison, slicing or calls); prefix_join covers the joins the DSL can build" },
];

/** Every (form, mode) category, in a fixed order; task i is category i mod this length. */
export const CATEGORIES: readonly { form: Form; mode: PracticeMode }[] = FORMS.flatMap((form) => form.modes.map((mode) => ({ form, mode })));
/** The practice families manifest (peaceai/lib/derive-practice-families.json): which forms CI grades (active) and which are staged. */
export interface PracticeFamily { name: string; status: "active" | "staged"; title: string; forms: string[] }
export const FAMILIES: readonly PracticeFamily[] = (JSON.parse(readFileSync(new URL("./derive-practice-families.json", import.meta.url), "utf8")) as { families: PracticeFamily[] }).families;
/** The categories of the named families ("active" = every active family; "all" = every family). Unknown names throw. */
export function familyCategories(spec: string): readonly { form: Form; mode: PracticeMode }[] {
  const names = spec === "active" ? FAMILIES.filter((f) => f.status === "active").map((f) => f.name) : spec === "all" ? FAMILIES.map((f) => f.name) : spec.split(",").map((s) => s.trim()).filter(Boolean);
  const forms = new Set<string>();
  for (const n of names) { const f = FAMILIES.find((x) => x.name === n); if (!f) throw new Error(`unknown practice family ${n}`); for (const x of f.forms) forms.add(x); }
  return CATEGORIES.filter((c) => forms.has(c.form.name));
}
export const categoryName = (form: string, mode: string) => `${form}/${mode}`;

/** Practice task `index` of run `seed` (deterministic; independent of shards). Categories filter by name prefix. */
export function practiceTask(seed: number, index: number, cats: readonly { form: Form; mode: PracticeMode }[] = CATEGORIES): PracticeTask {
  const { form, mode } = cats[index % cats.length]!;
  const s = taskSeed(seed, index);
  const b = form.build(rand(s), mode);
  const seen = new Set<string>();
  const examples: DeriveExample[] = [];
  for (const a of b.inputs) {
    const k = key(a);
    if (seen.has(k)) continue;
    const out = b.truth(a);
    if (typeof out === "number" && (!Number.isSafeInteger(out) || Math.abs(out) > 1e12)) continue;
    if (typeof out === "string" && out.length > DERIVE_MAX_STRING) continue;
    seen.add(k);
    examples.push({ args: [...a], out });
  }
  const shown = examples.slice(0, DERIVE_MAX_EXAMPLES);
  // The known limit (Auditor, S1 without 429): a single-input special case no example shows; any mode can draw it.
  const knownLimit = !!b.knownLimit || (!!b.point && !shown.some((e) => b.point!(e.args))) || capAboveUnshown(b.capAbove, shown);
  return { index, seed: s, form: form.name, mode, category: categoryName(form.name, mode), knownLimit, ...(b.point ? { point: b.point } : {}), ...(b.capAbove !== undefined ? { capAbove: b.capAbove } : {}), params: b.params, ret: b.ret, examples: shown, truth: b.truth, truthText: b.truthText, why: b.why, grid: b.grid };
}

/** The "cap above every example" known limit applies: the truth has an upper cap on parameter 0 and no example goes past it. */
export function capAboveUnshown(cap: number | undefined, examples: readonly DeriveExample[]): boolean {
  return cap !== undefined && examples.every((e) => typeof e.args[0] === "number" && (e.args[0] as number) <= cap);
}

// ---- grading
/** A program evaluated with plain JavaScript semantics (what the compiled TypeScript does; no integer-range cut-off). */
export function evalJs(n: DeriveNode, a: readonly DeriveValue[]): DeriveValue {
  const e = (x: DeriveNode) => evalJs(x, a);
  switch (n.op) {
    case "param": return a[n.i]!;
    case "int": case "lit": return n.v;
    case "add": return (e(n.a) as number) + (e(n.b) as number);
    case "sub": return (e(n.a) as number) - (e(n.b) as number);
    case "mul": return (e(n.a) as number) * (e(n.b) as number);
    case "sq": { const v = e(n.a) as number; return v * v; }
    case "min": { const v = e(n.a) as number; return v <= n.c ? v : n.c; }
    case "max": { const v = e(n.a) as number; return n.c <= v ? v : n.c; }
    case "cat": return (e(n.a) as string) + (e(n.b) as string);
    case "str": return "" + (e(n.a) as number);
    case "tmpl": return n.parts.map((q) => e(q) as string).join("");
    case "eq": return e(n.a) === e(n.b);
    case "le": return (e(n.a) as number) <= (e(n.b) as number);
    case "range": return n.lo <= (a[n.i] as number) && (a[n.i] as number) <= n.hi;
    case "empty": return a[n.i] === "";
    case "sle": return (a[n.i] as string) <= (a[n.j] as string);
    case "and": return (e(n.a) as boolean) && (e(n.b) as boolean);
    case "or": return (e(n.a) as boolean) || (e(n.b) as boolean);
    case "not": return !(e(n.a) as boolean);
    case "if": return e(n.c) ? e(n.t) : e(n.e);
  }
}
const same = (x: DeriveValue, y: DeriveValue) => x === y || (typeof x === "number" && typeof y === "number" && Math.abs(x) > 2 ** 53 && Math.abs(x - y) <= Math.abs(x) * 1e-12);
/** The grid points where a program and the truth disagree, nearest the origin first. */
export function disagreements(program: DeriveNode, task: Pick<PracticeTask, "grid" | "truth">): DeriveValue[][] {
  const bad = task.grid.filter((a) => !same(evalJs(program, a), task.truth(a)));
  const mag = (a: readonly DeriveValue[]) => a.reduce<number>((s, v) => s + (typeof v === "number" ? Math.abs(v) : typeof v === "string" ? v.length : 0), 0);
  return bad.sort((x, y) => mag(x) - mag(y));
}
/** Inside the examples' box: every number argument within the examples' smallest and largest value, every other one an example value. */
export function insideExamples(examples: readonly DeriveExample[], a: readonly DeriveValue[]): boolean {
  return a.every((v, i) => {
    const vs = examples.map((e) => e.args[i]!);
    return typeof v === "number" ? Math.min(...(vs as number[])) <= v && v <= Math.max(...(vs as number[])) : vs.includes(v);
  });
}
/**
 * A program's grade against the truth: right, or wrong with where (inside the examples' box, or only past it) and
 * whether it is the known limit (every disagreement at the truth's single-input special case, which no example shows).
 */
export function judge(program: DeriveNode, task: Pick<PracticeTask, "grid" | "truth" | "point" | "capAbove" | "examples">, examples: readonly DeriveExample[] = task.examples): { wrong: boolean; wrongAt: DeriveValue[][]; where?: "inside" | "past"; knownLimit: boolean } {
  const bad = disagreements(program, task);
  if (!bad.length) return { wrong: false, wrongAt: [], knownLimit: false };
  const unshownPoint = !!task.point && !examples.some((e) => task.point!(e.args));
  // the known limit "cap above every example": every disagreement past the unshown cap (and past every example)
  const pastCap = capAboveUnshown(task.capAbove, examples) && bad.every((a) => (a[0] as number) > task.capAbove! && !insideExamples(examples, a));
  const knownLimit = (unshownPoint && bad.every((a) => task.point!(a))) || pastCap;
  const inside = bad.filter((a) => insideExamples(examples, a));
  return { wrong: true, wrongAt: [...inside, ...bad.filter((a) => !insideExamples(examples, a))].slice(0, 3), where: inside.length ? "inside" : "past", knownLimit };
}

export type Outcome = "right" | "wrong" | "refused";
export interface QuestionGrade { asked: number; truthInAnswers: number; offMenu: number; rulesOut: number }
export interface AskGrade { rounds: number; outcome: Outcome | "stuck"; expr?: string; wrongAt?: DeriveValue[]; where?: "inside" | "past"; knownLimit?: boolean; reason?: string; /** The examples with the answers, when the loop ended on a wrong program. */ examples?: DeriveValue[][] }
export interface PracticeGrade {
  index: number; category: string; form: string; mode: PracticeMode; knownLimit: boolean;
  outcome: Outcome; expr?: string; unsafe?: string | null; wrongAt?: DeriveValue[][]; where?: "inside" | "past";
  reason?: string; questions?: QuestionGrade; ask?: AskGrade; ms: number; searched: number;
}
export interface GradeOptions { budget?: number; maxKeptCells?: number; askRounds?: number }

/** A refusal's questions graded against the truth: is the truth's result among the answers; does it rule an answer out. */
export function gradeQuestions(qs: readonly { at: DeriveValue[]; answers: DeriveValue[] }[] | undefined, truth: Truth): QuestionGrade {
  const g: QuestionGrade = { asked: 0, truthInAnswers: 0, offMenu: 0, rulesOut: 0 };
  for (const q of qs ?? []) {
    g.asked++;
    const t = truth(q.at);
    if (q.answers.some((v) => same(v, t))) g.truthInAnswers++; else g.offMenu++;
    if (q.answers.some((v) => !same(v, t))) g.rulesOut++;
  }
  return g;
}

/** Runs deriveProgram on a task's examples (never the truth) and grades the outcome; optionally the ask loop. */
export function gradeTask(task: PracticeTask, opt: GradeOptions = {}): PracticeGrade {
  const t0 = Date.now();
  const input: DeriveInput = { params: task.params, ret: task.ret, examples: task.examples, ...(opt.budget ? { budget: opt.budget } : {}), ...(opt.maxKeptCells ? { maxKeptCells: opt.maxKeptCells } : {}) };
  const r = deriveProgram(input);
  const base = { index: task.index, category: task.category, form: task.form, mode: task.mode };
  if (r.ok) {
    const j = judge(r.fit.program, task);
    return { ...base, knownLimit: j.knownLimit, outcome: j.wrong ? "wrong" : "right", expr: r.fit.expr, unsafe: derivedExprProblem(r.fit.expr, task.params.map((p) => p.name)), ...(j.wrong ? { wrongAt: j.wrongAt, where: j.where } : {}), ms: Date.now() - t0, searched: r.searched };
  }
  const reason = r.reason === "derive_under_specified" ? `${r.reason}/${r.gate}` : r.reason;
  const g: PracticeGrade = { ...base, knownLimit: false, outcome: "refused", reason, questions: gradeQuestions(r.questions, task.truth), ms: 0, searched: r.searched };
  if (opt.askRounds && opt.askRounds > 0) g.ask = askLoop(task, input, r.questions, opt.askRounds);
  g.ms = Date.now() - t0;
  return g;
}

/** Peace's ask loop: every question answered from the truth (the issue author), then derive again, up to `rounds`. */
export function askLoop(task: PracticeTask, input: DeriveInput, first: readonly { at: DeriveValue[] }[] | undefined, rounds: number): AskGrade {
  const examples = [...input.examples];
  let qs = first;
  for (let round = 1; round <= rounds; round++) {
    if (!qs?.length) return { rounds: round - 1, outcome: "stuck", reason: "no question" };
    for (const q of qs) if (!examples.some((e) => key(e.args) === key(q.at))) examples.push({ args: [...q.at], out: task.truth(q.at) });
    if (examples.length > DERIVE_MAX_EXAMPLES) return { rounds: round, outcome: "stuck", reason: "too many examples" };
    const r = deriveProgram({ ...input, examples });
    if (r.ok) {
      const j = judge(r.fit.program, task, examples);
      return { rounds: round, outcome: j.wrong ? "wrong" : "right", expr: r.fit.expr, ...(j.wrong ? { wrongAt: j.wrongAt[0], where: j.where, knownLimit: j.knownLimit, examples: examples.map((e) => [...e.args, e.out]) } : {}) };
    }
    if (round === rounds) return { rounds: round, outcome: "refused", reason: r.reason === "derive_under_specified" ? `${r.reason}/${r.gate}` : r.reason };
    qs = r.questions;
  }
  return { rounds, outcome: "refused" };
}

/** A wrong accepted program in the derive mistakes ledger's entry shape (peaceai-derive-mistakes:v1), plus the practice provenance. */
export function ledgerEntry(task: PracticeTask, grade: PracticeGrade, engine: string, runSeed: number) {
  const at = grade.wrongAt?.[0] ?? [];
  const types = task.params.map((p) => p.type);
  return {
    id: `m100-practice-${task.form}-${task.mode}-s${runSeed}-t${task.index}`.replace(/_/g, "-"),
    source: `m100 derive-practice (seed ${runSeed}, task ${task.index}, engine ${engine})`,
    params: task.params.map((p) => p.name),
    ...(types.some((t) => t !== "number") ? { types } : {}),
    ret: task.ret,
    examples: task.examples.map((e) => [...e.args, e.out]),
    wrongProgram: grade.expr!,
    disagreeAt: at,
    correct: task.truth(at),
    why: task.why,
    practice: { category: task.category, knownLimit: grade.knownLimit, where: grade.where, truth: task.truthText, picked: grade.expr, alsoWrongAt: (grade.wrongAt ?? []).slice(1) },
  };
}

// ---- aggregation
export interface CategoryCounts { tasks: number; right: number; wrong: number; wrongInside: number; wrongPast: number; wrongKnownLimit: number; refused: number; refusedBy: Record<string, number>; withQuestions: number; questions: number; truthInAnswers: number; offMenu: number; ask: Record<string, number>; ms: number }
export function tally(grades: readonly PracticeGrade[]): Record<string, CategoryCounts> {
  const out: Record<string, CategoryCounts> = {};
  for (const g of grades) {
    const c = (out[g.category] ??= { tasks: 0, right: 0, wrong: 0, wrongInside: 0, wrongPast: 0, wrongKnownLimit: 0, refused: 0, refusedBy: {}, withQuestions: 0, questions: 0, truthInAnswers: 0, offMenu: 0, ask: {}, ms: 0 });
    c.tasks++; c[g.outcome]++; c.ms += g.ms;
    if (g.outcome === "wrong") { if (g.knownLimit) c.wrongKnownLimit++; else if (g.where === "inside") c.wrongInside++; else c.wrongPast++; }
    if (g.outcome === "refused") {
      c.refusedBy[g.reason!] = (c.refusedBy[g.reason!] ?? 0) + 1;
      if (g.questions!.asked) c.withQuestions++;
      c.questions += g.questions!.asked; c.truthInAnswers += g.questions!.truthInAnswers; c.offMenu += g.questions!.offMenu;
      if (g.ask) c.ask[g.ask.outcome] = (c.ask[g.ask.outcome] ?? 0) + 1;
    }
  }
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => (a < b ? -1 : 1)));
}
