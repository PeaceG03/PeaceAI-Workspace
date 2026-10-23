// m103 (Auditor #494 review): derive-practice was red on main 5c66982 with a NEW blocking kind, backoff/sparse | p1:
// from [[0,100,100],[7,0,0],[0,200,200],[0,0,0]] (attempt, baseMs -> delay; truth Math.min(10000, baseMs * (attempt + 1) ** 2))
// the engine accepted `baseMs`. The unread gate took attempt 7 vs 0 at baseMs = 0 (both 0) as showing attempt does
// not matter, but 0 annihilates the product. The pair must now have every number parameter the program reads non-zero,
// and no min / max cap of the program at or past its cap value (m102's variant: a held cap hides the parameter too).
// Auditor #497 generalised it (sibling degenerate witnesses, also on main): see the cases at the end.
import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveCandidate, deriveProgram, evalProgram, type DeriveInput } from "../lib/derive.ts";

const mk = (names: string[], rows: number[][]): DeriveInput => ({ params: names.map((name) => ({ name, type: "number" as const })), ret: "number", examples: rows.map((r) => ({ args: r.slice(0, -1), out: r[r.length - 1]! })) });

test("m103 backoff/sparse (Auditor repro /tmp/r494/backoff.mts): `baseMs` is refused by gate unread and the refusal asks at a non-zero baseMs", () => {
  const inp = mk(["attempt", "baseMs"], [[0, 100, 100], [7, 0, 0], [0, 200, 200], [0, 0, 0]]);
  const r = deriveProgram(inp);
  assert.equal(r.ok, false, JSON.stringify(r));
  if (r.ok) return;
  assert.equal(r.reason, "derive_under_specified");
  assert.equal(r.gate, "unread");
  assert.equal(r.param, "attempt");
  // Asked at baseMs 100 (not 0), until attempt takes 3 values; the true 6400 (baseMs * (attempt + 1) ** 2) is on
  // the menu (Auditor #497: a linear guess, [100, 800], left it off).
  assert.deepEqual(r.questions?.map((q) => q.at), [[7, 100], [2, 100]]);
  assert.ok(r.questions![0]!.answers.includes(6400) && r.questions![0]!.answers.includes(100), JSON.stringify(r.questions));
  assert.deepEqual(deriveCandidate(inp), r);
});

test("m103 backoff/sparse, capped (m102's disclosed limit m102-kind-backoff-sparse-p1-k-p1-k, now fixed): refused by gate unread", () => {
  const rows = [[7, 0, 0], [0, 0, 0], [0, 20400, 10400], [0, 500, 500], [3, 11400, 10400]];
  const r = deriveCandidate(mk(["attempt", "baseMs"], rows));
  assert.ok(!r.ok && r.gate === "unread" && r.param === "attempt", JSON.stringify(r));
  // It asks inside the cap (baseMs 500), not where the cap holds.
  assert.deepEqual(!r.ok && r.questions?.map((q) => q.at), [[7, 500], [3, 500]]);
  assert.ok(!r.ok && r.questions![0]!.answers.includes(10400) && r.questions![1]!.answers.includes(8000), JSON.stringify(!r.ok && r.questions));
  // A pair with baseMs non-zero but the result held at the cap (7 vs 0 at baseMs 20400, both 10400) shows nothing either.
  const held = deriveCandidate(mk(["attempt", "baseMs"], [...rows, [7, 20400, 10400]]));
  assert.ok(!held.ok && held.gate === "unread" && held.param === "attempt", JSON.stringify(held));
  // Exactly AT the cap counts as held: the pair (0,10)/(7,10) has min(baseMs, 10) at 10 on both sides.
  const exact = deriveCandidate(mk(["attempt", "baseMs"], [[0, 10, 10], [7, 10, 10], [0, 3, 3], [0, 20, 10]]));
  assert.ok(!exact.ok && exact.gate === "unread" && exact.param === "attempt", JSON.stringify(exact));
  assert.deepEqual(!exact.ok && exact.questions?.map((q) => q.at), [[7, 3], [2, 3]]);
});

test("m103 unread live pair: EVERY read number parameter is non-zero in the pair (one zero factor hides the parameter); a live pair passes", () => {
  const rows = [[2, 3, 0, 6], [5, 7, 0, 35], [-4, 6, 0, -24], [0, 5, 0, 0], [0, 5, 9, 0], [3, -2, 0, -6], [100, 1, 0, 100], [1, 100, 0, 100], [-100, 2, 0, -200], [2, -100, 0, -200], [1, 1, 0, 1], [-1, -1, 0, 1], [7, -3, 0, -21], [0, 0, 0, 0]];
  const r = deriveCandidate(mk(["a", "b", "c"], rows));
  assert.ok(!r.ok && r.gate === "unread" && r.param === "c", JSON.stringify(r));
  // The same examples plus c at three values with a and b not 0 / 1 / -1: c is shown not to matter.
  const ok = deriveCandidate(mk(["a", "b", "c"], [...rows, [2, 3, 9, 6], [2, 3, -5, 6]]));
  assert.ok(ok.ok ? true : ok.gate !== "unread", JSON.stringify(ok));
});

test("m103 unread live pair: a parameter the program ignores, shown at a non-zero read value, still derives (no new refusal of a live pair)", () => {
  const r = deriveCandidate(mk(["attempt", "baseMs"], [[0, 100, 100], [7, 100, 100], [0, 200, 200], [3, -150, -150], [0, -150, -150], [5, 1, 1], [0, 1, 1], [2, 37, 37], [9, -90, -90], [0, 0, 0], [11, 100, 100]]));
  assert.ok(r.ok ? true : r.gate !== "unread", JSON.stringify(r));
});

// ---- Auditor #497 (/tmp/r497/adv.mts): every parameter the program does not read is shown irrelevant at
// NON-DEGENERATE settings: (a) the other numbers not 0 / 1 / -1, the other strings non-empty, no cap held; (b) at least
// 3 distinct values of it (not a symmetric pair); (c) at both outcomes of a boolean result / each && || operand.
// Main and 0d619de emitted the wrong program on each of these; now each is refused by gate unread, asked at a setting
// meeting the same conditions, and never emits a wrong program after the questions are answered with the truth.
type Row = (number | string | boolean)[];
interface Adv { id: string; names: string[]; types?: ("number" | "string")[]; ret: "number" | "string" | "boolean"; rows: Row[]; truth: (...a: any[]) => any; grid: Row[]; param: string; onMenu?: boolean }
const g2 = (A: Row, B: Row): Row[] => A.flatMap((a) => B.map((b) => [a, b]));
const g3 = (A: Row, B: Row, C: Row): Row[] => A.flatMap((a) => B.flatMap((b) => C.map((c) => [a, b, c])));
const R = [-300, -150, -7, -2, -1, 0, 1, 2, 3, 7, 50, 100, 450, 900];
const ident = [-200, -100, -1, 0, 1, 2, 3, 10, 100, 250, 500, 1000];
const S = ["", "a", "B", "Hello World", " lead", "x.y", "Zz 9", "trail ", "MiXeD-2"];
const bool: Row[] = [-300, -100, -1, 0, 1, 4, 5, 6, 7, 105, 106, 300].map((a) => [a, 10, a > 5]);
bool.push([2, 0, false], [2, 100, false], [-50, -9, false]);
const bool3: Row[] = [...bool, [2, 10, false]];
const bor3: Row[] = [...[-300, -100, -1, 0, 1, 4, 5, 6, 7, 105, 106, 300].map((a) => [a, 0, a > 5]), [9, 0, true], [9, 100, true], [9, -9, true]];
// (c) on an && operand: c varied where 6 <= a && 4 <= b is true and where a <= 5, never where 4 <= b is false.
const and3: Row[] = [];
for (const a of [-100, 2, 5, 6, 7, 106]) for (const b of [-100, 2, 3, 4, 104]) and3.push([a, b, -5, a > 5 && b > 3]);
and3.push([7, 10, -5, true], [7, 10, 5, true], [7, 10, 9, true], [2, 10, -5, false], [2, 10, 5, false], [2, 10, 9, false]);
const bor: Row[] = [-300, -100, -1, 0, 1, 4, 5, 6, 7, 105, 106, 300].map((a) => [a, 0, a > 5]);
bor.push([9, 0, true], [9, 100, true], [200, -9, true]);
const M103_ADV: Adv[] = [
  { id: "a*b+c emits c (a varied at b=0, b at a=0)", names: ["a", "b", "c"], ret: "number", rows: [...ident.map((c) => [0, 0, c, c]), [3, 0, 5, 5], [9, 0, 5, 5], [-4, 0, 5, 5], [0, 4, 7, 7], [0, 8, 7, 7], [0, -3, 7, 7]], truth: (a, b, c) => a * b + c, grid: g3([-2, 0, 1, 3], [-2, 0, 1, 4], R), param: "a", onMenu: true },
  { id: "a+b*c emits a (zero in the other unread param)", names: ["a", "b", "c"], ret: "number", rows: [...ident.map((a) => [a, 0, 0, a]), [5, 3, 0, 5], [5, 9, 0, 5], [5, -4, 0, 5], [7, 0, 4, 7], [7, 0, 8, 7], [7, 0, -3, 7]], truth: (a, b, c) => a + b * c, grid: g3(R, [-2, 0, 1, 3], [-2, 0, 1, 4]), param: "b", onMenu: true },
  { id: "c+(a*b)**2 emits c (square of a zero product)", names: ["a", "b", "c"], ret: "number", rows: [...ident.map((c) => [0, 0, c, c]), [3, 0, 5, 5], [9, 0, 5, 5], [0, 4, 7, 7], [0, 8, 7, 7]], truth: (a, b, c) => c + (a * b) ** 2, grid: g3([-2, 0, 1, 3], [-2, 0, 1, 4], R), param: "a", onMenu: true },
  { id: "s+t.repeat(n) emits s (t varied at n=0, n at t='')", names: ["s", "t", "n"], types: ["string", "string", "number"], ret: "string", rows: [...S.map((s) => [s, "", 0, s]), ["ab", "q", 0, "ab"], ["ab", "zz", 0, "ab"], ["cd", "", 3, "cd"], ["cd", "", 7, "cd"]], truth: (s, t, n) => s + t.repeat(Math.max(0, n)), grid: S.flatMap((s) => ["", "q", "Ab"].flatMap((t) => [0, 1, 2].map((n) => [s, t, n]))), param: "t" },
  { id: "s===''?'':s+t emits s (t varied only at s='')", names: ["s", "t"], types: ["string", "string"], ret: "string", rows: [...S.map((s) => [s, "", s]), ["", "q", ""], ["", "Zz", ""]], truth: (s, t) => (s === "" ? "" : s + t), grid: S.flatMap((s) => ["", "q", "Ab"].map((t) => [s, t])), param: "t", onMenu: true },
  { id: "b**a emits b (a varied at b=1)", names: ["a", "b"], ret: "number", rows: [...ident.map((b) => [1, b, b]), [0, 1, 1], [5, 1, 1], [9, 1, 1]], truth: (a, b) => b ** a, grid: g2([0, 1, 2, 3], [-7, -2, -1, 0, 1, 2, 3, 10]), param: "a", onMenu: true },
  { id: "b*(a+1)**2 emits b (symmetric pair a=0/-2)", names: ["a", "b"], ret: "number", rows: [...ident.map((b) => [0, b, b]), [-2, 100, 100], [-2, 7, 7]], truth: (a, b) => b * (a + 1) ** 2, grid: g2([-3, -2, -1, 0, 1, 2, 5], R), param: "a", onMenu: true },
  { id: "a>5 && b>3 emitted 6 <= a after asking (b varied only at a<=5)", names: ["a", "b"], ret: "boolean", rows: bool, truth: (a, b) => a > 5 && b > 3, grid: g2(R, [-9, 0, 3, 4, 10, 100]), param: "b" },
  { id: "a>5 || b>3 emitted 6 <= a after asking (b varied only at a>5)", names: ["a", "b"], ret: "boolean", rows: bor, truth: (a, b) => a > 5 || b > 3, grid: g2(R, [-9, 0, 3, 4, 10, 100]), param: "b" },
  { id: "a>5 && b>3, b at 3 values only at a<=5 (boolean result shown only false)", names: ["a", "b"], ret: "boolean", rows: bool3, truth: (a, b) => a > 5 && b > 3, grid: g2(R, [-9, 0, 3, 4, 10, 100]), param: "b" },
  { id: "a>5 || b>3, b at 3 values only at a>5 (boolean result shown only true)", names: ["a", "b"], ret: "boolean", rows: bor3, truth: (a, b) => a > 5 || b > 3, grid: g2(R, [-9, 0, 3, 4, 10, 100]), param: "b" },
  { id: "a>5 && (b>3 || c>0): c varied only where the && operand 4 <= b is true", names: ["a", "b", "c"], ret: "boolean", rows: and3, truth: (a, b, c) => a > 5 && (b > 3 || c > 0), grid: g3([-7, 2, 6, 50], [-50, 2, 3, 4, 50], [-9, -5, 5, 9]), param: "c" },
  // G5 (Auditor #497 (4)): the max cap check. a varied only at b = -2000, where max(-1000, ...) holds.
  { id: "max(-1000, b*(a+1)): a varied only where the max cap holds", names: ["a", "b"], ret: "number", rows: [...[-5000, -2000, -1000, -999, -500, -1, 0, 1, 2, 100, 999, 5000].map((b) => [0, b, Math.max(-1000, b)]), [3, -2000, -1000], [8, -2000, -1000]], truth: (a, b) => Math.max(-1000, b * (a + 1)), grid: g2([0, 1, 2, 5], [-5000, -2000, -1000, -400, -1, 0, 1, 7, 400, 5000]), param: "a", onMenu: true },
];
const inputOf = (c: Adv, rows: Row[]): DeriveInput => ({ params: c.names.map((name, i) => ({ name, type: c.types?.[i] ?? "number" })), ret: c.ret, examples: rows.map((r) => ({ args: r.slice(0, -1), out: r[r.length - 1]! })) });
const degenerate = (v: unknown) => v === 0 || v === 1 || v === -1 || v === "";

for (const c of M103_ADV) {
  test(`m103 Auditor #497: ${c.id}: refused by gate unread, asked at a non-degenerate setting, never wrong after asking`, () => {
    const pi = c.names.indexOf(c.param);
    let rows = c.rows;
    assert.ok(rows.every((r) => c.truth(...r.slice(0, -1)) === r[r.length - 1]), "the examples fit the truth");
    const first = deriveCandidate(inputOf(c, rows));
    assert.ok(!first.ok && first.gate === "unread" && first.param === c.param, JSON.stringify(first));
    assert.ok(!first.ok && first.questions?.length, JSON.stringify(first));
    for (const q of (!first.ok && first.questions) || []) {
      // The ask point meets the same conditions: only the unread parameter may be degenerate.
      assert.ok(q.at.every((v, j) => j === pi || !degenerate(v)), JSON.stringify(q));
    }
    // ... and the truth itself depends on the parameter there (no other side decides alone: a > 5 && b > 3 asks at 6 <= a).
    const shows = (at: Row) => new Set(c.grid.map((g) => JSON.stringify(c.truth(...at.map((v, j) => (j === pi ? g[pi] : v)))))).size >= 2;
    assert.ok(!first.ok && first.questions!.some((q) => shows(q.at)), `the parameter shows at an ask point: ${JSON.stringify(!first.ok && first.questions)}`);
    if (c.onMenu) { const q = !first.ok && first.questions![0]!; assert.ok(q && q.answers.some((a) => a === c.truth(...q.at)), `truth on the menu: ${JSON.stringify(q)}`); }
    for (let round = 0; round < 3; round++) {
      const r = deriveCandidate(inputOf(c, rows));
      if (r.ok) {
        const wrong = c.grid.filter((g) => evalProgram(r.fit.program, g) !== c.truth(...g));
        assert.equal(wrong.length, 0, `emitted ${r.fit.expr} after ${round} rounds, wrong at ${JSON.stringify(wrong.slice(0, 3))}`);
        break;
      }
      const add = (r.questions ?? []).map((q) => [...q.at, c.truth(...q.at)]).filter((a) => !rows.some((e) => JSON.stringify(e.slice(0, -1)) === JSON.stringify(a.slice(0, -1))));
      if (!add.length) break;
      rows = [...rows, ...add];
    }
  });
}
