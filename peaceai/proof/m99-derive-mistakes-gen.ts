// M99 (#491 round 3, Peace: every wrong pick Auditor finds becomes something PeaceAI permanently avoids).
// Usage: tsx peaceai/proof/m99-derive-mistakes-gen.ts (rewrites the ledger; the amb3 rows are the wrong picks Auditor's
// narrow generator found at d5ac588, re-found with peaceai/proof/m99-derive-ambiguity.ts narrow on that head).
// Builds peaceai/test/m99-derive-mistakes.json: each Auditor counterexample, replayed on the current engine,
// with the ask loop answered from the hidden truth (here only, never stored as code in the ledger).
import { writeFileSync } from "node:fs";
const W = process.env.W ?? new URL("../..", import.meta.url).pathname.replace(/\/$/, "");
const { deriveProgram, evalProgram } = await import(`${W}/peaceai/lib/derive.ts`);
type V = number | boolean | string;
type C = { id: string; source: string; names: string[]; types?: string[]; ret: "number" | "boolean"; rows: V[][]; wrong: string; at: V[]; why: string; truth?: (a: any[]) => V; grid?: V[][]; limit?: string };
const g1 = (lo = -1000, hi = 1000) => { const g: V[][] = []; for (let n = lo; n <= hi; n++) g.push([n]); return g; };
const g2 = (k: number) => { const g: V[][] = []; for (let a = -60; a <= 60; a += 2) for (let b = -60; b <= 60; b += 2) g.push([a, b]); for (let b = -60; b <= 60; b++) g.push([k, b]); return g; };
const S1 = [[429, true], [500, true], [502, true], [503, true], [504, true], [550, true], [599, true], [428, false], [430, false], [499, false], [600, false], [200, false], [204, false], [301, false], [400, false], [403, false], [404, false], [0, false]];
const S1FULL = [[429, true], [500, true], [502, true], [503, true], [504, true], [550, true], [599, true], [428, false], [430, false], [465, false], [499, false], [600, false], [700, false], [100, false], [200, false], [204, false], [301, false], [400, false], [403, false], [404, false], [0, false]];
const s1 = ([s]: number[]) => s === 429 || (500 <= s && s <= 599);
const cases: C[] = [
  { id: "r1-s1-without-600", source: "Auditor #491 round 1 (B1)", names: ["status"], ret: "boolean", rows: S1.filter(([a]) => a !== 600), wrong: "(status === 429) || (500 <= status)", at: [600], why: "nothing past 599 was shown, so the open end was assumed to stay true", truth: s1, grid: g1() },
  { id: "r2-hidden-island", source: "Auditor #491 round 2", names: ["n"], ret: "boolean", rows: [[10, true], [9, true], [11, false], [0, true], [-100, true], [15, false], [40, false], [49, false], [50, true], [51, true], [150, true]], wrong: "!(11 <= n && n <= 49)", at: [20], why: "only the ends of the false region were shown, so a true band inside it was never seen", truth: ([n]) => n <= 10 || (20 <= n && n <= 30) || n >= 50, grid: g1() },
  { id: "r2-unwitnessed-cap", source: "Auditor #491 round 2", names: ["n"], ret: "number", rows: [[-5], [0], [3], [24], [-1], [1], [2], [10]].map(([n]) => [n!, Math.min(1000, n! * n!)]), wrong: "n * n", at: [-50], why: "the inputs only went from -5 to 24, so a cap above 576 was never reached", truth: ([n]) => Math.min(1000, n * n), grid: g1() },
];
const amb = (shape: string, k: number, rows: number[][], wrong: string, at: number[], f: (a: number[]) => number, why: string) =>
  cases.push({ id: `r2-amb3-${shape.replace(/ /g, "-")}-k${k}-${cases.filter((c) => c.id.startsWith(`r2-amb3-${shape.replace(/ /g, "-")}-k${k}`)).length + 1}`, source: "Auditor #491 round 2 (amb3, narrow generator, seed 99)", names: ["a", "b"], ret: "number", rows, wrong, at, why, truth: f, grid: g2(k) });
const ifeq: [number, number[][]][] = [
  [15, [[14,5,19],[23,17,40],[14,14,28],[21,1,22],[16,21,37],[7,13,20],[16,-5,11],[16,15,31],[1,14,15]]],
  [14, [[13,13,26],[15,-5,10],[7,-3,4],[17,4,21]]],
  [5, [[23,7,30],[4,-5,-1],[1,-5,-4],[13,9,22]]],
  [14, [[5,15,20],[3,-3,0],[15,-5,10],[7,23,30],[-5,7,2],[19,15,34]]],
  [12, [[19,13,32],[9,17,26],[1,21,22],[13,12,25],[13,11,24],[-3,13,10]]],
  [15, [[3,19,22],[16,3,19],[9,16,25],[14,21,35],[16,14,30],[23,-5,18],[13,15,28]]],
  [10, [[23,21,44],[9,17,26],[11,-1,10],[-1,3,2],[9,9,18],[5,9,14],[19,23,42]]],
];
for (const [k, rows] of ifeq) amb("if eq", k, rows, "a + b", [k, -20], ([a, b]) => (a === k ? 0 : a + b), `no example had a = ${k}, so the special case there was never seen`);
for (const [k, rows] of [[15, [[16,9,144],[-5,16,-80],[-5,3,-15],[-1,13,-13],[9,11,99],[-5,-1,5]]], [10, [[-5,9,-45],[3,13,39],[3,10,30],[-1,-1,1]]]] as [number, number[][]][])
  amb("cap lin2", k, rows, "a * b", [-20, -20], ([a, b]) => Math.min(k * 10, a * b), `no example had a product above ${k * 10}, so the cap was never reached`);
for (const b of [{ k: 7, rows: [[7, 6, 384], [5, 5, 180], [8, 1, 81], [8, 8, 648]], wrong: "b * ((a + 1) * (a + 1))", at: [-20, 2] }])
  amb("backoff", b.k, b.rows, b.wrong, b.at, ([a, x]) => Math.min(b.k * 100, x * (a + 1) * (a + 1)), `no example reached the cap of ${b.k * 100}`);
cases.push({ id: "r1-s1-drop-429", source: "Auditor #491 round 1 (not blocking)", names: ["status"], ret: "boolean", rows: S1FULL.filter(([a]) => a !== 429), wrong: "500 <= status && status <= 599", at: [429], why: "no example says 429 is true, so no program built from the examples can know it", limit: "known limit: the examples alone fit; the review note shows the derived expression and its table, so the missing 429 is visible to the reviewer" });
cases.push({ id: "scan-r3-sign", source: "upstream scan, round 3 (rcbyr/keen-slider sign)", names: ["x"], ret: "number", rows: [[-1, -1], [2, 1], [10, 1], [99, 1], [0, 0]], wrong: "x <= 1 ? x : 1", at: [-101], why: "nothing below -1 was shown, so the floor at -1 was never seen", truth: ([x]) => (x > 0 ? 1 : x < 0 ? -1 : 0), grid: g1(-3000, 3000) });

const key = (v: V[]) => JSON.stringify(v);
const out: any[] = [];
for (const c of cases) {
  const params = c.names.map((name, i) => ({ name, type: (c.types?.[i] ?? "number") as "number" }));
  const mk = (rows: V[][]) => ({ params, ret: c.ret, examples: rows.map((r) => ({ args: r.slice(0, -1), out: r[r.length - 1]! })) });
  const t0 = Date.now();
  let r: any = deriveProgram(mk(c.rows));
  const e: any = { id: c.id, source: c.source, params: c.names, ret: c.ret, examples: c.rows, wrongProgram: c.wrong, disagreeAt: c.at, correct: c.truth ? c.truth(c.at as number[]) : null, why: c.why };
  if (c.limit) { e.correct = true; e.expected = { outcome: "known-limit", program: r.ok ? r.fit.expr : null, note: c.limit }; out.push(e); console.log(c.id, "limit", r.ok && r.fit.expr); continue; }
  if (r.ok) { const bad = c.grid!.find((a) => evalProgram(r.fit.program, a) !== c.truth!(a as number[])); e.expected = { outcome: "derive", program: r.fit.expr, rightOnGrid: !bad }; out.push(e); console.log(c.id, "DERIVED", r.fit.expr, bad ? `WRONG ${bad}` : "right"); continue; }
  const first = { reason: r.reason, gate: r.gate ?? null, askAt: (r.questions ?? []).map((q: any) => q.at) };
  const rows = [...c.rows]; const answers: V[][] = []; let rounds = 0;
  while (!r.ok && r.questions?.length && rounds < 8) {
    for (const q of r.questions) { const row = [...q.at, c.truth!(q.at)]; rows.push(row); answers.push(row); }
    rounds++; r = deriveProgram(mk(rows));
  }
  const after = r.ok ? { program: r.fit.expr, rightOnGrid: !c.grid!.find((a) => evalProgram(r.fit.program, a) !== c.truth!(a as number[])) } : { refused: r.reason, gate: r.gate ?? null };
  if ("rightOnGrid" in after && !after.rightOnGrid) {
    const bad = c.grid!.find((a) => evalProgram(r.fit.program, a) !== c.truth!(a as number[]))!;
    (after as any).wrongAt = bad; (after as any).correctThere = c.truth!(bad as number[]);
    (after as any).limit = "known limit: the answers never touch the one input line where the truth is special, so the simplest fit is derived again (a single-input exception no example or question shows)";
  }
  e.expected = { outcome: "refuse-and-ask", ...first, answers, rounds, after };
  out.push(e); console.log(c.id, JSON.stringify(first), rounds, JSON.stringify(after), Date.now() - t0, "ms");
}
writeFileSync(process.env.OUT ?? `${W}/peaceai/test/m99-derive-mistakes.json`, JSON.stringify({ schema: "peaceai-derive-mistakes:v1", entries: out }, null, 1) + "\n");
