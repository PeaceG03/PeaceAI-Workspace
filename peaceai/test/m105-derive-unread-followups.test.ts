// m105 (Auditor #497 review of afdd28a, repros /tmp/r497b/repro.mts, adv2.mts, adv2r.mts, u7.mts): a parameter the
// derived program does not read was taken as shown irrelevant where a program READING it also fits every example.
// A, B, M: a term cancelled by a value outside {0, 1, -1} (b * (a - 2) at a = 2, c * (a - b) at a = b, c * (b - 2));
// G, F, K: it varied only on one branch of a ternary; H: only positive, under a min(0, b) cap; J: only on one side of
// the cut b > 3; D, E, E2: the varied string was only whitespace or 1 character; U7, K: an unread boolean was refused
// with nothing asked. Each is now refused by gate unread with questions, and answering them never derives it wrong.
// The same cases are ledger entries m105-* in m99-derive-mistakes.json.
import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveCandidate, evalProgram, type DeriveInput, type DeriveValue } from "../lib/derive.ts";

type V = DeriveValue;
type Case = { id: string; names: string[]; types?: ("number" | "string" | "boolean")[]; ret: "number" | "string" | "boolean"; rows: V[][]; truth: (a: any[]) => V; grid: V[][]; param: string; rival?: RegExp; onMenu?: boolean };
const AV = [-300, -150, -20, -7, -2, -1, 0, 1, 2, 3, 4, 5, 6, 7, 9, 13, 50, 100, 450, 900];
const S = ["a", "B", "Hello World", " lead", "x.y", "Zz 9", "trail ", "MiXeD-2", "", "7"];
const x2 = (A: V[], B: V[]) => A.flatMap((a) => B.map((b) => [a, b]));
const x3 = (A: V[], B: V[], C: V[]) => A.flatMap((a) => B.flatMap((b) => C.map((c) => [a, b, c])));
const even = AV.filter((_, k) => k % 2 === 0);
const cases: Case[] = [
  { id: "A b * (a - 2), b varied only at a = 2", names: ["a", "b", "c"], ret: "number", rows: [...even.flatMap((a) => [-50, 8].map((c) => [a, 0, c, a + c])), ...[3, 5, 9, 11].map((b) => [2, b, 7, 9])], truth: ([a, b, c]) => a + c + b * (a - 2), grid: x3([-3, 0, 2, 5, 9], [-4, 0, 3, 8], [-50, 3, 8]), rival: /reads it/, param: "b", onMenu: true },
  { id: "B c * (a - b), c varied only at a = b", names: ["a", "b", "c"], ret: "number", rows: [...even.flatMap((a) => [-40, 5, 60].map((b) => [a, b, 0, a + b])), ...[2, 3, 9].flatMap((c) => [[5, 5, c, 10], [17, 17, c, 34]])], truth: ([a, b, c]) => a + b + c * (a - b), grid: x3([-3, 2, 5, 9], [-40, 2, 5, 17], [-4, 0, 3, 8]), rival: /reads it/, param: "c", onMenu: true },
  { id: "M c * (b - 2), c varied only at b = 2", names: ["a", "b", "c"], ret: "number", rows: [...[-150, -7, 3, 9, 50, 450].flatMap((a) => [-3, 2, 5, 11].map((b) => [a, b, 0, a * b])), ...[3, 7, 13].flatMap((c) => [[4, 2, c, 8], [9, 2, c, 18]])], truth: ([a, b, c]) => a * b + c * (b - 2), grid: x3([-3, 4, 9], [-3, 2, 5], [0, 3, 7]), rival: /reads it/, param: "c", onMenu: true },
  { id: "D s + t.trim(), t only whitespace", names: ["s", "t"], types: ["string", "string"], ret: "string", rows: S.flatMap((s) => [" ", "  ", "\t", "   "].map((t) => [s, t, s + t.trim()])), truth: ([s, t]) => s + t.trim(), grid: x2(S, [" ", "q", "Ab", "x y"]), param: "t" },
  { id: "E s + t.slice(1), t only 1 character", names: ["s", "t"], types: ["string", "string"], ret: "string", rows: S.flatMap((s) => ["q", "Z", " ", "9"].map((t) => [s, t, s + t.slice(1)])), truth: ([s, t]) => s + t.slice(1), grid: x2(S, ["q", "Ab", "x y"]), param: "t" },
  { id: "E2 s + t.trim().repeat(n), t only whitespace", names: ["s", "t", "n"], types: ["string", "string", "number"], ret: "string", rows: [...S.map((s) => [s, " ", 2, s]), ...[" ", "  ", "\t"].map((t) => ["ab", t, 3, "ab"]), ...[2, 3, 7].map((n) => ["ab", "  ", n, "ab"])], truth: ([s, t, n]) => s + t.trim().repeat(Math.max(0, n)), grid: x3(S, [" ", "q"], [0, 2, 3]), param: "t" },
  { id: "F s === \"ab\" ? s : s + t, t varied only at s = \"ab\"", names: ["s", "t"], types: ["string", "string"], ret: "string", rows: [...S.map((s) => [s, "", s]), ...["q", "Ab", "zz", "x y"].map((t) => ["ab", t, "ab"])], truth: ([s, t]) => (s === "ab" ? s : s + t), grid: x2(S, ["", "q", "Ab"]), rival: /reads it/, param: "t" },
  { id: "G a <= 5 ? a : a + b, b varied only at a <= 5", names: ["a", "b"], ret: "number", rows: [...AV.map((a) => [a, 0, a]), ...[2, 3, 9, 13].flatMap((b) => [[3, b, 3], [-7, b, -7]])], truth: ([a, b]) => (a <= 5 ? a : a + b), grid: x2(AV, [-4, 0, 3, 8]), rival: /reads it/, param: "b" },
  { id: "H a + c * min(0, b), b only positive", names: ["a", "b", "c"], ret: "number", rows: [...AV.map((a) => [a, 5, 3, a]), ...[2, 9, 13].map((b) => [7, b, 3, 7]), ...[2, 7, 11].map((c) => [7, 5, c, 7])], truth: ([a, b, c]) => a + c * Math.min(0, b), grid: x3([-3, 7, 50], [-5, -2, 0, 5], [2, 3, 7]), rival: /reads it/, param: "b" },
  { id: "J a > 5 && b > 3, b only above 3", names: ["a", "b"], ret: "boolean", rows: [...AV.map((a) => [a, 10, a > 5]), ...[4, 9, 100].flatMap((b) => [[6, b, true], [2, b, false], [50, b, true]])], truth: ([a, b]) => a > 5 && b > 3, grid: x2(AV, [-9, 0, 3, 4, 10]), rival: /reads it/, param: "b" },
  { id: "K f ? a + b : a, b varied only at f = false", names: ["a", "b", "f"], types: ["number", "number", "boolean"], ret: "number", rows: [...AV.map((a) => [a, 0, false, a]), ...[3, 9].flatMap((a) => [2, 3, 9].map((b) => [a, b, false, a])), [5, 0, true, 5], [9, 0, true, 9]], truth: ([a, b, f]) => (f ? a + b : a), grid: x3([-3, 5, 9], [0, 3, 8], [true, false]), rival: /reads it/, param: "b" },
  { id: "U7 f ? a * a : a, f varied only at a = 0 and a = 1", names: ["a", "f"], types: ["number", "boolean"], ret: "number", rows: [...AV.map((a) => [a, false, a]), [0, true, 0], [1, true, 1]], truth: ([a, f]) => (f ? a * a : a), grid: AV.flatMap((a) => [[a, false], [a, true]]), param: "f", onMenu: true },
  // Mutant kills (m105): whitespace of 2+ characters is not a shown string; a cancelling a = b at the extremes (only
  // the p - q term rival fits); a boolean branch with b of both signs at the extremes of a (only the f ? rival fits).
  { id: "D3 s + t.trim(), t only whitespace of 2+ characters", names: ["s", "t"], types: ["string", "string"], ret: "string", rows: S.flatMap((s) => ["  ", "\t\t", "   ", " \t"].map((t) => [s, t, s + t.trim()])), truth: ([s, t]) => s + t.trim(), grid: x2(S, ["  ", "q", "Ab", "x y"]), param: "t" },
  { id: "B2 c * (a - b), c of both signs only at a = b (5, 450, -300)", names: ["a", "b", "c"], ret: "number", rows: [...even.flatMap((a) => [-40, 5, 60].map((b) => [a, b, 0, a + b])), ...[2, -3, 9].flatMap((c) => [[5, 5, c, 10], [450, 450, c, 900], [-300, -300, c, -600]])], truth: ([a, b, c]) => a + b + c * (a - b), grid: x3([-3, 2, 5, 9], [-40, 2, 5, 17], [-4, 0, 3, 8]), param: "c", rival: /c \* \(a - b\)|\(a - b\)/, onMenu: true },
  { id: "K2 f ? a + b : a, b of both signs at the extremes of a, only at f = false", names: ["a", "b", "f"], types: ["number", "number", "boolean"], ret: "number", rows: [...AV.map((a) => [a, 0, false, a]), ...[-300, 3, 900].flatMap((a) => [2, -3, 9].map((b) => [a, b, false, a])), [5, 0, true, 5], [9, 0, true, 9]], truth: ([a, b, f]) => (f ? a + b : a), grid: x3([-3, 5, 9], [0, 3, -8], [true, false]), param: "b", rival: /\bf\b/ },
];

for (const c of cases) test(`m105 Auditor #497 ${c.id}: refused by gate unread with questions; answering them never derives it wrong`, () => {
  const params = c.names.map((name, i) => ({ name, type: c.types?.[i] ?? ("number" as const) }));
  const mk = (rows: V[][]): DeriveInput => ({ params, ret: c.ret, examples: rows.map((r) => ({ args: r.slice(0, -1), out: r[r.length - 1]! })) });
  assert.ok(c.rows.every((r) => c.truth(r.slice(0, -1)) === r[r.length - 1]), "rows follow the truth");
  const first = deriveCandidate(mk(c.rows));
  let r: ReturnType<typeof deriveCandidate> = first;
  assert.ok(!first.ok && first.gate === "unread" && (first.questions?.length ?? 0) > 0, JSON.stringify(first.ok ? first.fit.expr : first));
  if (first.ok) return;
  if (c.rival) assert.match(first.detail ?? "", c.rival);
  const pi = c.names.indexOf(c.param);
  assert.equal(first.param, c.param);
  // Asked at a non-degenerate setting (the other numbers not 0 / 1 / -1, the other strings non-empty).
  for (const q of first.questions ?? []) assert.ok(q.at.every((v, j) => j === pi || !(v === 0 || v === 1 || v === -1 || v === "")), JSON.stringify(q));
  // The truth is on the menu of the first question (the rival that reads the parameter is offered).
  if (c.onMenu) { const q = first.questions![0]!; assert.ok(q.answers.some((a) => a === c.truth(q.at)), `truth on the menu: ${JSON.stringify(q)}`); }
  const rows = [...c.rows];
  for (let round = 0; round < 3 && !r.ok && r.questions?.length; round++) {
    for (const q of r.questions) rows.push([...q.at, c.truth(q.at)]);
    r = deriveCandidate(mk(rows));
  }
  if (r.ok) {
    const fit = r.fit;
    const bad = c.grid.find((a) => evalProgram(fit.program, a) !== c.truth(a));
    assert.equal(bad, undefined, `derived ${fit.expr}, wrong at ${JSON.stringify(bad)}`);
  }
});
