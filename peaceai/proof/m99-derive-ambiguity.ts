// M99 (Auditor #491 round 2): the ambiguity harness. For each shape, 40 random tasks: a hidden truth with a constant
// k, 4 to 12 distinct random example inputs (a third of the values near k), the truth's outputs as the examples.
// deriveProgram runs on the examples alone; an accepted program is compared with the truth on a grid. Reported per
// shape: tasks / accepted / accepted-but-wrong. The target is 0 wrong among accepted programs.
//   narrow  Auditor's amb3 generator exactly (values -5..24, grid -20..60, LCG seed 99, budget 1 000 000);
//   wide    the same shapes with inputs drawn from -150..149 (so the span gate does not refuse every task) and a
//           grid of -200..200 (two parameters: step 4). Shows what the other gates do once the examples are wide.
// Usage: tsx peaceai/proof/m99-derive-ambiguity.ts [narrow|wide] [shape filter] [runs]
import { deriveProgram, evalProgram } from "../lib/derive.ts";

type F = { name: string; np: number; ret: "number" | "boolean"; f: (a: number[], k: number) => number | boolean };
export const SHAPES: F[] = [
  { name: "cap sq", np: 1, ret: "number", f: ([n], k) => Math.min(k, n! * n!) },
  { name: "cap lin2", np: 2, ret: "number", f: ([a, b], k) => Math.min(k * 10, a! * b!) },
  { name: "floor at k", np: 1, ret: "number", f: ([n], k) => Math.max(k, n!) },
  { name: "range", np: 1, ret: "boolean", f: ([n], k) => k <= n! && n! <= k + 5 },
  { name: "ge", np: 1, ret: "boolean", f: ([n], k) => n! >= k },
  { name: "le2", np: 2, ret: "boolean", f: ([a, b]) => a! <= b! },
  { name: "eq or ge", np: 1, ret: "boolean", f: ([n], k) => n! === k || n! >= k + 10 },
  { name: "if eq", np: 2, ret: "number", f: ([a, b], k) => (a === k ? 0 : a! + b!) },
  { name: "backoff", np: 2, ret: "number", f: ([a, b], k) => Math.min(k * 100, b! * (a! + 1) * (a! + 1)) },
  // Auditor's two named repros as shapes: a band hidden inside a false region, and a cap the examples never reach.
  { name: "hidden island", np: 1, ret: "boolean", f: ([n], k) => n! <= k || (k + 10 <= n! && n! <= k + 20) || n! >= k + 40 },
  { name: "unwitnessed cap", np: 1, ret: "number", f: ([n], k) => Math.min(k * 10, n! * n!) },
];

export function runShapes(mode: "narrow" | "wide", filter = "", runs = 40, log: (s: string) => void = console.log): Record<string, [number, number, number]> {
  let rng = 99;
  const rnd = (m: number) => { rng = (rng * 1103515245 + 12345) & 0x7fffffff; return rng % m; };
  const lo = mode === "narrow" ? -5 : -150, width = mode === "narrow" ? 30 : 300;
  const stats: Record<string, [number, number, number]> = {};
  for (const F of SHAPES) {
    // A filtered-out shape still draws its tasks, so every shape sees the same tasks as in a full run.
    const on = !filter || F.name === filter;
    const s: [number, number, number] = [0, 0, 0];
    if (on) stats[F.name] = s;
    const g1: number[] = [];
    if (mode === "narrow") for (let a = -20; a <= 60; a++) g1.push(a); else for (let a = -200; a <= 200; a += F.np > 1 ? 4 : 1) g1.push(a);
    const grid: number[][] = F.np > 1 ? g1.flatMap((a) => g1.map((b) => [a, b])) : g1.map((a) => [a]);
    for (let t = 0; t < runs; t++) {
      const k = 2 + rnd(15);
      const pts = new Map<string, number[]>();
      const nex = 4 + rnd(9);
      while (pts.size < nex) { const a = Array.from({ length: F.np }, () => (rnd(3) === 0 ? k + rnd(3) - 1 : rnd(width) + lo)); pts.set(String(a), a); }
      const examples = [...pts.values()].map((a) => ({ args: a, out: F.f(a, k) }));
      if (!on) continue;
      const r = deriveProgram({ params: Array.from({ length: F.np }, (_, i) => ({ name: "ab"[i]!, type: "number" as const })), ret: F.ret, examples, budget: 1_000_000 });
      s[0]++;
      if (!r.ok) continue;
      s[1]++;
      const d = grid.find((a) => evalProgram(r.fit.program, a) !== F.f(a, k));
      if (!d) continue;
      s[2]++;
      log(`${mode} ${F.name} k=${k} ex ${JSON.stringify(examples.map((e) => [...e.args, e.out]))} -> ${r.fit.expr} | wrong at ${JSON.stringify(d)}`);
    }
  }
  return stats;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const mode = (process.argv[2] ?? "narrow") as "narrow" | "wide";
  const stats = runShapes(mode, process.argv[3] ?? "", Number(process.argv[4] ?? 40));
  console.log(`${mode}: shape: tasks / accepted / accepted-but-wrong`);
  for (const [k, v] of Object.entries(stats)) console.log(`${mode} ${k.padEnd(16)} ${v.join(" / ")}`);
}
