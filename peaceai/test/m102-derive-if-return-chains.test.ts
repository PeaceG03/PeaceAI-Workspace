// M102 (if-return chains): the string-order form `s <= t` (op sle) and its order gate. The form is built only with
// ORDER_FORM_EVIDENCE.sle >= DERIVE_FORM_BAR (the Auditor #491 ruling); the gate refuses a program with an order test
// until the examples rule out every look-alike order (DERIVE_ORDER_LOOKALIKES), asking about each one not ruled out.
// The gate and ask-loop tests call deriveCandidate (search + witness gates, no form gate), like m99-derive-gates; the
// last test checks what deriveProgram emits under the round-3 form gate (ternary has no m99 evidence entries).
import { test } from "node:test";
import assert from "node:assert/strict";
import { compileProgram, DERIVE_FORM_BAR, DERIVE_MIN_REACH, DERIVE_ORDER_LOOKALIKES, deriveCandidate, deriveProgram, evalProgram, evidenceFormCounts, formsOf, unevidencedForms, gateProblem, ORDER_FORM_EVIDENCE, orderProblem, orderShownProblem, type DeriveExample, type DeriveInput, type DeriveNode, type DeriveParam } from "../lib/derive.ts";

const byCodeUnit = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const P: DeriveParam[] = [{ name: "a", type: "string" }, { name: "b", type: "string" }];
const K = (v: number): DeriveNode => ({ op: "lit", v });
// (a <= b) ? ((b <= a) ? 0 : -1) : 1
const CMP: DeriveNode = { op: "if", c: { op: "sle", i: 0, j: 1 }, t: { op: "if", c: { op: "sle", i: 1, j: 0 }, t: K(0), e: K(-1) }, e: K(1) };
const ex = (pairs: [string, string][]): DeriveExample[] => pairs.map(([a, b]) => ({ args: [a, b], out: byCodeUnit(a, b) }));
const input = (pairs: [string, string][]): DeriveInput => ({ params: P, ret: "number", examples: ex(pairs) });
const BASE: [string, string][] = [["a", "b"], ["b", "a"], ["abc", "abd"], ["x", "x"], ["hello", "help"], ["zz", "z"], ["m", "m"]];
const FULL: [string, string][] = [...BASE, ["10", "9"], ["a", "B"], ["b", "aa"], ["ac", "ab"], ["", "a"], [" Ab 9. ", "a"], ["a", " Ab 9. "]];

test("sle: evaluates and compiles as JS <= on strings; a look-alike order replaces it only when passed", () => {
  assert.equal(compileProgram(CMP, ["a", "b"]), "(a <= b) ? ((b <= a) ? 0 : (-1)) : 1");
  for (const [a, b] of FULL) assert.equal(evalProgram(CMP, [a, b]), byCodeUnit(a, b));
  const ci = DERIVE_ORDER_LOOKALIKES.find((L) => L.name.startsWith("case-insensitive"))!;
  assert.equal(evalProgram(CMP, ["a", "B"]), 1);
  assert.equal(evalProgram(CMP, ["a", "B"], undefined, ci.le), -1);
});

test("order gate: no examples where look-alikes differ -> refused, asking about each (at most 3 questions)", () => {
  const p = orderProblem(input(BASE.filter(([a, b]) => a !== b)), CMP);
  assert.ok(p);
  assert.equal(p.gate, "order");
  assert.ok(p.rivals && p.rivals.length >= 1 && p.rivals.length <= 3);
  for (const r of p.rivals!) assert.notEqual(r.values[0], r.values[1]);
});

test("order gate: the strict look-alike needs DERIVE_MIN_REACH equal pairs; each other look-alike one witness", () => {
  assert.equal(DERIVE_MIN_REACH, 2);
  const strict = DERIVE_ORDER_LOOKALIKES[0]!;
  assert.equal(strict.need, DERIVE_MIN_REACH);
  assert.equal(orderProblem(input(FULL), CMP), null, "every look-alike ruled out");
  // one equal pair only -> the strict look-alike is not ruled out
  const oneEq = FULL.filter(([a, b]) => !(a === "m" && b === "m"));
  const p = orderProblem(input(oneEq), CMP);
  assert.ok(p && /strict/.test(p.detail) && /only 1 example/.test(p.detail), p?.detail);
  // drop every witness of each single-witness look-alike in turn -> refused, and a question tells it apart
  for (const L of DERIVE_ORDER_LOOKALIKES.slice(1)) {
    const kept = FULL.filter(([a, b]) => evalProgram(CMP, [a, b], undefined, L.le) === evalProgram(CMP, [a, b]));
    const q = orderProblem(input(kept), CMP);
    assert.ok(q, L.name);
    assert.ok(q.rivals!.some((r) => evalProgram(CMP, r.at, undefined, L.le) !== evalProgram(CMP, r.at)), `${L.name}: no question tells it apart`);
  }
});

// Auditor #495 B1: one test per look-alike, each with its own copy of the order, so deleting (or weakening) any
// DERIVE_ORDER_LOOKALIKES entry fails a test. Examples are the truth `a <= b` at every pair of W where the look-alike
// agrees with code-unit order: the other look-alikes are each ruled out there, this one is not, so the engine must
// refuse naming it and ask at a pair where it differs (natural order: asks at ["10", "9"]); with all of W it derives.
const LOOKALIKE_COPIES: [string, (a: string, b: string) => boolean][] = [
  ["strict order (<, not <=): equal values", (a, b) => a < b],
  ["case-insensitive order", (a, b) => a.toLowerCase() <= b.toLowerCase()],
  ["natural (numeric) order", (a, b) => {
    const ca = a.match(/\d+|\D+/g) ?? [], cb = b.match(/\d+|\D+/g) ?? [];
    for (let k = 0; k < Math.min(ca.length, cb.length); k++) {
      const x = ca[k]!, y = cb[k]!;
      if (x === y) continue;
      if (/^\d/.test(x) && /^\d/.test(y) && Number(x) !== Number(y)) return Number(x) < Number(y);
      return x < y;
    }
    return ca.length <= cb.length;
  }],
  ["shorter-first order", (a, b) => (a.length !== b.length ? a.length < b.length : a <= b)],
  ["first-character order", (a, b) => a.slice(0, 1) <= b.slice(0, 1)],
];
const W: [string, string][] = [["a", "B"], ["B", "a"], ["Q", "q"], ["10", "9"], ["9", "10"], ["2", "10"], ["b", "aa"], ["aa", "b"], ["zz", "z"], ["ac", "ab"], ["ab", "ac"], ["x", "x"], ["m", "m"], ["ab", "ab"], ["a", "b"], ["b", "a"], ["", "a"], ["a", ""], [" Ab 9. ", "B"], ["B", " Ab 9. "], ["1", "2"], ["2", "1"], ["x.y", "x y"], ["2026-09-30", "2026-10-23"], [" Ab 9. ", "Zb 9. x"], ["Zb 9. x", " Ab 9. "], ["9a", "10"], ["10", "9a"]];
const LE_INPUT = (pairs: [string, string][]): DeriveInput => ({ params: P, ret: "boolean", examples: pairs.map(([a, b]) => ({ args: [a, b], out: a <= b })) });

test("order look-alikes: the list is exactly the five tested below, in order", () => {
  assert.deepEqual(DERIVE_ORDER_LOOKALIKES.map((L) => L.name), LOOKALIKE_COPIES.map(([n]) => n));
  assert.equal(DERIVE_ORDER_LOOKALIKES[0]!.need, DERIVE_MIN_REACH);
  for (const L of DERIVE_ORDER_LOOKALIKES.slice(1)) assert.equal(L.need, 1, L.name);
  const all = deriveCandidate(LE_INPUT(W));
  assert.ok(all.ok, JSON.stringify(all).slice(0, 300));
  assert.equal(compileProgram(all.fit.program, ["a", "b"]), "a <= b");
});

for (const [name, le] of LOOKALIKE_COPIES) {
  test(`order look-alike "${name}": examples that agree with it are refused, asking where it differs`, () => {
    const kept = W.filter(([a, b]) => le(a, b) === (a <= b));
    assert.ok(kept.length < W.length, "W has a witness for it");
    const p = orderProblem(LE_INPUT(kept), { op: "sle", i: 0, j: 1 });
    assert.ok(p && p.gate === "order" && p.detail.includes(name), p?.detail);
    assert.ok(p.rivals!.some((r) => le(r.at[0] as string, r.at[1] as string) !== ((r.at[0] as string) <= (r.at[1] as string))), "a question tells it apart");
    const r = deriveCandidate(LE_INPUT(kept));
    assert.equal(r.ok, false, `derived ${r.ok ? compileProgram(r.fit.program, ["a", "b"]) : ""} from examples that ${name} also fits`);
    const qs = (r as { questions?: { at: unknown[] }[] }).questions ?? [];
    assert.ok(qs.some((q) => le(q.at[0] as string, q.at[1] as string) !== ((q.at[0] as string) <= (q.at[1] as string))), JSON.stringify(qs));
    if (name.startsWith("natural")) assert.deepEqual(qs.map((q) => q.at), [["10", "9"]]);
  });
}

test("order gate runs inside gateProblem (after chars, before edge)", () => {
  const p = gateProblem(input(BASE.filter(([a, b]) => a !== b).concat([["", "a"], ["a", ""], [" Ab 9. ", "a"], ["a", " Ab 9. "]])), CMP, 11);
  assert.ok(p);
  assert.equal(p.gate, "order");
});

test("byCodeUnit (PeaceSTOCKS x3): refused under the bar; with the form at the bar the ask loop derives it", () => {
  let inp = input(BASE);
  let r = deriveCandidate(inp);
  if (ORDER_FORM_EVIDENCE.sle < DERIVE_FORM_BAR) {
    assert.equal(r.ok, false, "sle off: no order test can be built");
    return;
  }
  for (let round = 0; round < 6 && !r.ok; round++) {
    const qs = (r as { questions?: { at: unknown[] }[] }).questions ?? [];
    assert.ok(qs.length, JSON.stringify(r).slice(0, 300));
    inp = { ...inp, examples: [...inp.examples, ...qs.map((q) => ({ args: q.at as string[], out: byCodeUnit(q.at[0] as string, q.at[1] as string) }))] };
    r = deriveCandidate(inp);
  }
  assert.ok(r.ok);
  for (const [a, b] of FULL) assert.equal(evalProgram(r.fit.program, [a, b]), byCodeUnit(a, b));
});

test("order gate: a look-alike that cannot change the program on any input tried is not asked (equality via two order tests)", () => {
  // (a <= b) && (b <= a): code-unit equality; shorter-first order has the same equal pairs, so it is never asked
  const EQ: DeriveNode = { op: "and", a: { op: "sle", i: 0, j: 1 }, b: { op: "sle", i: 1, j: 0 } };
  const pairs: [string, string][] = [["a", "b"], ["x", "x"], ["m", "m"], ["", "a"], ["a", ""], [" Ab 9. ", "a"], ["a", " Ab 9. "]];
  const inp = (ps: [string, string][]): DeriveInput => ({ params: P, ret: "boolean", examples: ps.map(([a, b]) => ({ args: [a, b], out: a === b })) });
  const p = orderProblem(inp(pairs), EQ);
  assert.ok(p && /case-insensitive/.test(p.detail), p?.detail);
  const shorter = DERIVE_ORDER_LOOKALIKES.find((L) => L.name.startsWith("shorter-first"))!;
  for (const r of p!.rivals!) assert.ok(r.values[0] !== r.values[1]);
  assert.ok(!p!.rivals!.some((r) => evalProgram(EQ, r.at, undefined, shorter.le) !== evalProgram(EQ, r.at)));
  // answered: case (a, A) and first character (ac, ab) -> accepted by the order gate
  assert.equal(orderProblem(inp([...pairs, ["a", "A"], ["ac", "ab"]]), EQ), null);
});

/** The ask loop: answer every question from the truth until the engine derives (or 8 rounds). */
const askLoop = (params: DeriveParam[], ret: DeriveInput["ret"], examples: DeriveExample[], truth: (a: string[]) => string | number) => {
  let inp: DeriveInput = { params, ret, examples };
  let r = deriveCandidate(inp);
  const firsts: string[] = [];
  for (let round = 0; round < 8 && !r.ok; round++) {
    const f = r as { gate?: string; questions?: { at: unknown[] }[] };
    firsts.push(f.gate ?? "");
    const qs = f.questions ?? [];
    assert.ok(qs.length, "a refusal with no question: " + JSON.stringify(r).slice(0, 300));
    inp = { ...inp, examples: [...inp.examples, ...qs.map((q) => ({ args: q.at as string[], out: truth(q.at as string[]) }))] };
    r = deriveCandidate(inp);
  }
  return { r, gates: firsts };
};

test("order-shown gate (practice seed 100 #809): a bare string parameter from examples that always had x >= y is refused, asking at y before x; the ask loop derives max", () => {
  const XY: DeriveParam[] = [{ name: "x", type: "string" }, { name: "y", type: "string" }];
  const max = (a: string[]) => (a[0]! < a[1]! ? a[1]! : a[0]!);
  const rows: [string, string][] = [["trail ", "Zz 9"], ["Zz 9", ""], ["x.y", "2026-10-23"], ["9", "10"], ["", ""], ["ab", "10"], ["b", "aa"], ["b", "Hello World"]];
  const examples = rows.map((a) => ({ args: a, out: max(a) }));
  const p = orderShownProblem({ params: XY, ret: "string", examples }, { op: "param", i: 0 });
  if (ORDER_FORM_EVIDENCE.sle < DERIVE_FORM_BAR) { assert.equal(p, null, "off with the order atom off"); return; }
  assert.ok(p && p.gate === "order", JSON.stringify(p));
  assert.ok(p.at?.some((a) => (a[0] as string) < (a[1] as string)), "asks at x before y");
  const { r, gates } = askLoop(XY, "string", examples, max);
  assert.ok(gates.includes("order"));
  assert.ok(r.ok, JSON.stringify(r).slice(0, 300));
  for (const a of [["a", "b"], ["b", "a"], ["", "a"], ["a", "a"]]) assert.equal(evalProgram(r.fit.program, a), max(a));
});

test("order-shown + branch gate (practice seed 100 #1343, stuck with no question): a comparator from examples with no a < b asks there, then on the short branch; the ask loop derives it", () => {
  const rev = (a: string[]) => byCodeUnit(a[1]!, a[0]!);
  const rows: [string, string][] = [["Zz 9", ""], ["aa", "aa"], ["MiXeD", "2026-09-30"], ["9", "10"], ["ab", "10"]];
  const examples = rows.map((a) => ({ args: a, out: rev(a) }));
  const sub: DeriveNode = { op: "if", c: { op: "sle", i: 0, j: 1 }, t: K(0), e: K(-1) };
  const p = orderShownProblem({ params: P, ret: "number", examples }, sub);
  if (ORDER_FORM_EVIDENCE.sle < DERIVE_FORM_BAR) { assert.equal(p, null); return; }
  assert.ok(p?.at?.length === 1 && (p.at[0]![0] as string) < (p.at[0]![1] as string), JSON.stringify(p));
  const { r, gates } = askLoop(P, "number", examples, rev);
  assert.ok(gates.includes("order") && gates.includes("branch"), gates.join());
  assert.ok(r.ok, JSON.stringify(r).slice(0, 300));
  for (const [a, b] of FULL) assert.equal(evalProgram(r.fit.program, [a, b]), rev([a, b]));
});

test("form gate (main 5c66982, round 3; M104): with sle on, a comparator or min / max uses the ternary form, emitted only with >= 10 ternary entries (M104: 12); an order test alone, or two joined by && (range), is emitted", () => {
  const P2: DeriveParam[] = [{ name: "a", type: "string" }, { name: "b", type: "string" }];
  const rows: [string, string][] = [...FULL, ["Zz 9", "a"], ["a", "a"], ["", ""], ["b", "b"]];
  const mk = (f: (a: string, b: string) => string | number | boolean, ret: DeriveInput["ret"]): DeriveInput => ({ params: P2, ret, examples: rows.map(([a, b]) => ({ args: [a, b], out: f(a, b) })) });
  const cmp = deriveCandidate(mk(byCodeUnit, "number"));
  if (ORDER_FORM_EVIDENCE.sle < DERIVE_FORM_BAR) return;
  assert.ok(cmp.ok, JSON.stringify(cmp).slice(0, 300));
  assert.ok(cmp.ok && formsOf(cmp.fit.program).includes("ternary"));
  // One ternary entry short of the bar, the comparator would be refused by name (the m99 test checks this end to end).
  assert.ok(cmp.ok && unevidencedForms(cmp.fit.program, { ...evidenceFormCounts(), ternary: DERIVE_FORM_BAR - 1 }).includes("ternary"));
  assert.ok(evidenceFormCounts().ternary >= DERIVE_FORM_BAR);
  const p = deriveProgram(mk(byCodeUnit, "number"));
  assert.ok(p.ok && cmp.ok && p.fit.expr === cmp.fit.expr, JSON.stringify(p).slice(0, 300));
  for (const [a, b] of rows) assert.equal(p.ok && evalProgram(p.fit.program, [a, b]), byCodeUnit(a, b));
  const le = deriveProgram(mk((a, b) => a <= b, "boolean"));
  assert.ok(le.ok && compileProgram(le.fit.program, ["a", "b"]) === "a <= b", JSON.stringify(le).slice(0, 300));
});
