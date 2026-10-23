// M99 (#491 round 3, Peace: every wrong pick Auditor finds becomes something PeaceAI permanently avoids).
// Usage: tsx peaceai/proof/m99-derive-mistakes-gen.ts (rewrites the ledger; the amb3 rows are the wrong picks Auditor's
// narrow generator found at d5ac588, re-found with peaceai/proof/m99-derive-ambiguity.ts narrow on that head).
// Builds peaceai/test/m99-derive-mistakes.json: each Auditor counterexample, replayed on the current engine,
// with the ask loop answered from the hidden truth (here only, never stored as code in the ledger).
import { writeFileSync } from "node:fs";
const W = process.env.W ?? new URL("../..", import.meta.url).pathname.replace(/\/$/, "");
const { deriveProgram, evalProgram } = await import(`${W}/peaceai/lib/derive.ts`);
type V = number | boolean | string;
type C = { id: string; source: string; names: string[]; types?: string[]; ret: "number" | "boolean" | "string"; rows: V[][]; wrong: string; at: V[]; why: string; truth?: (a: any[]) => V; grid?: V[][]; limit?: string };
const g1 = (lo = -1000, hi = 1000) => { const g: V[][] = []; for (let n = lo; n <= hi; n++) g.push([n]); return g; };
const g2 = (k: number) => { const g: V[][] = []; for (let a = -60; a <= 60; a += 2) for (let b = -60; b <= 60; b += 2) g.push([a, b]); for (let b = -60; b <= 60; b++) g.push([k, b]); return g; };
const S1 = [[429, true], [500, true], [502, true], [503, true], [504, true], [550, true], [510, true], [520, true], [530, true], [540, true], [560, true], [570, true], [580, true], [590, true], [438, false], [446, false], [454, false], [462, false], [470, false], [478, false], [486, false], [494, false], [599, true], [428, false], [430, false], [499, false], [600, false], [200, false], [204, false], [301, false], [400, false], [403, false], [404, false], [0, false]];
const S1FULL = [[429, true], [500, true], [502, true], [503, true], [504, true], [550, true], [510, true], [520, true], [530, true], [540, true], [560, true], [570, true], [580, true], [590, true], [438, false], [446, false], [454, false], [462, false], [470, false], [478, false], [486, false], [494, false], [599, true], [428, false], [430, false], [465, false], [499, false], [600, false], [700, false], [100, false], [200, false], [204, false], [301, false], [400, false], [403, false], [404, false], [0, false]];
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

// Round 3: the practice generator (PR #493, m100/derive-practice @ 374a0e3, seed 100, budget 100000) against 80cf699;
// one representative per category it found accepted wrong (peaceai/test/m100-derive-practice-findings.json there).
const P = "m100 derive-practice (seed 100) vs m99 80cf699";
const g2b = (lo: number, hi: number, step: number) => { const g: V[][] = []; for (let a = lo; a <= hi; a += step) for (let b = lo; b <= hi; b += step) g.push([a, b]); return g; };
const STRS = ["", "x9", " err 42 ", "ECONNRESET", "fetch failed", "R2_GET_500"];
const strGrid = STRS.flatMap((a) => STRS.map((b) => [a, b] as V[]));
cases.push({ id: "m100-island-hidden-island-t24", source: `${P}, task 24 (island/hidden_island, 75 like it)`, names: ["n"], ret: "boolean", rows: [[-65, true], [-15, true], [35, true], [85, true], [86, false], [92, false], [99, false], [105, false], [111, false], [143, false], [145, false], [148, false], [150, false], [152, false], [153, true], [203, true], [253, true], [303, true]], wrong: "!(86 <= n && n <= 152)", at: [112], why: "no example inside 112..142, so the band there was never seen", truth: ([n]) => n <= 85 || (112 <= n && n <= 142) || n >= 153, grid: g1(-300, 600) });
cases.push({ id: "m100-cap-lin2-inside", source: `${P} (cap_lin2/sparse after the asks, 7 like it)`, names: ["a", "b"], ret: "number", rows: [[-3, 70, -210], [2, 2, 4], [1, -90, -90], [7, 9, 63], [97, 9, 873], [-93, 70, -6510]], wrong: "a * b", at: [-31, -30], why: "a product above 916 lies inside the examples' box, but no example shows one", truth: ([a, b]) => Math.min(916, a * b), grid: g2b(-93, 97, 5) });
cases.push({ id: "m100-cond-suffix-missing-empty", source: `${P} (cond_suffix/missing_empty, 79 like it, and cond_suffix/sparse, 6)`, names: ["message", "causeCode"], types: ["string", "string"], ret: "string", rows: [["", "UND_ERR_SOCKET", "HOST_DOWN::cause=UND_ERR_SOCKET"], ["", " err 42 ", "HOST_DOWN::cause= err 42 "], ["x9", "UND_ERR_SOCKET", "HOST_DOWN:x9:cause=UND_ERR_SOCKET"], ["R2_GET_500", "ECONNRESET", "HOST_DOWN:R2_GET_500:cause=ECONNRESET"], [" fetch failed ", "ETIMEDOUT", "HOST_DOWN: fetch failed :cause=ETIMEDOUT"], ["", "ETIMEDOUT", "HOST_DOWN::cause=ETIMEDOUT"], ["x9", "ETIMEDOUT", "HOST_DOWN:x9:cause=ETIMEDOUT"]], wrong: '"HOST_DOWN:" + (message + (":cause=" + causeCode))', at: ["x9", ""], why: "no example has an empty causeCode, so the suffix was assumed unconditional", truth: ([m, c]) => (c === "" ? "HOST_DOWN:" + m : "HOST_DOWN:" + m + ":cause=" + c), grid: strGrid });
cases.push({ id: "m100-floor-clamp-past", source: `${P} (floor_clamp, cap_lin2 past the examples, and their amb3 after the asks: 79 + 87 + 38)`, names: ["n"], ret: "number", rows: [[57, 57], [107, 107], [157, 157]].concat([[-143, -143], [7, 7]]), wrong: "n", at: [208], why: "every example is below the cap at 207, so nothing shows it", truth: ([n]) => Math.min(207, n), limit: "known limit: a cap or floor past every example fits every example; no gate can ask for it (the review note's far-probe table shows the program's values there)" });
cases.push({ id: "m100-floor-unshown", source: "m100 derive-practice (seed 100) vs m99 8004623 (floor_clamp, 76 like it)", names: ["n"], ret: "number", rows: [[61, 61], [62, 62], [112, 112], [162, 162], [212, 212]], wrong: "n", at: [0], why: "every example is at or above the floor at 61, so nothing shows it", truth: ([n]) => Math.max(61, n), grid: g1(-300, 600) });
// CI run 39927392501 (family 1, 60,000 tasks, m100 @ 365cf3a, seed 798586860): the NEW kinds printed by
// peaceai/bin/derive-practice-dedup.ts (m100 @ 173fbae) from its derive-practice-kinds.json, one per kind.
const C9 = "m100 derive-practice CI run 39927392501 (seed 798586860, engine 365cf3a)";
cases.push({ id: "m100-kind-floor-clamp-unwitnessed-cap-k-p0-p0-k", source: `${C9}, task 33936 (floor_clamp/unwitnessed_cap | K <= p0 ? p0 : K, 194 like it)`, names: ["n"], ret: "number", rows: [[5, 5], [45, 45], [85, 85], [124, 124], [-46, 4], [-146, 4], [3, 4]], wrong: "4 <= n ? n : 4", at: [165], why: "no example went above the cap 164", truth: ([n]) => Math.max(4, Math.min(164, n)), grid: g1(-300, 600), limit: "known limit: a cap past every example; no example-only check can see it, and the review note's far-probe table shows the derived value out there" });
cases.push({ id: "m100-kind-floor-clamp-sparse-k-p0-p0-k", source: `${C9}, task 25685 (floor_clamp/sparse | K <= p0 ? p0 : K, 7 like it)`, names: ["n"], ret: "number", rows: [[335, 335], [191, 191], [-4, 46], [-54, 46]], wrong: "46 <= n ? n : 46", at: [336], why: "a random handful of the examples, none above the cap 335", truth: ([n]) => Math.max(46, Math.min(335, n)), grid: g1(-300, 600), limit: "known limit: a cap past every example; no example-only check can see it, and the review note's far-probe table shows the derived value out there" });
cases.push({ id: "m100-kind-eq-or-ge-sparse-k-p0", source: `${C9}, task 14322 (eq_or_ge/sparse | K <= p0, 1 like it)`, names: ["n"], ret: "boolean", rows: [[537, true], [487, true], [339, false], [389, false], [390, true], [239, false], [437, true]], wrong: "390 <= n", at: [391], why: "a random handful of the examples: nothing between 390 and 437 was shown", truth: ([n]) => n === 390 || n >= 437, grid: g1(0, 800), limit: "known limit: the false band 391 to 436 lies past the program's last edge between examples under DERIVE_FAR (100) apart; holding open stretches to the bounded-region eighth refuses S1 and most fixtures (tried in round 3 and reverted), so the review note's table is the check here" });
cases.push({ id: "m100-kind-s1-shape-sparse-k-p0", source: `${C9}, task 34225 (s1_shape/sparse | K <= p0, 1 like it)`, names: ["status"], ret: "boolean", rows: [[284, false], [359, false], [417, true], [389, true], [360, true], [474, true], [182, false], [282, false]], wrong: "360 <= status", at: [283], why: "a random handful of the examples: 283 and everything past 474 unshown", truth: ([s]) => s === 283 || (360 <= s && s <= 474), grid: g1(0, 800), limit: "known limit: 283 is a single-input exception between the examples 282 and 284 (like S1 without 429), and the true band ends at the largest example 474, a cap past every example" });

// M101: the template-joins miner (an engine copy with the tmpl/str forms on and the digits gate at 3 digits) derived
// ("" + n) for OrangeproAI/orangepro-mcp src/local/viz/reportTheme.ts fmt, n.toLocaleString("en-US"): wrong at 1230.
// The gate now needs a 4+-digit example (asks at 1234); the forms stay off under DERIVE_FORM_BAR evidence.
cases.push({ id: "m101-str-grouped-digits", source: "m101 template-joins miner (OrangeproAI/orangepro-mcp@405209f fmt, engine 293f584 with the forms on)", names: ["n"], types: ["number"], ret: "string", rows: [[-1, "-1"], [2, "2"], [10, "10"], [123, "123"]], wrong: '("" + n)', at: [1230], why: "no example had 4 or more digits, so the grouping separator (toLocaleString) was never seen", truth: ([n]) => n.toLocaleString("en-US"), grid: g1(-3000, 3000) });

const key = (v: V[]) => JSON.stringify(v);
const out: any[] = [];
for (const c of cases) {
  const params = c.names.map((name, i) => ({ name, type: (c.types?.[i] ?? "number") as "number" }));
  const typed = c.types ? { types: c.types } : {};
  const mk = (rows: V[][]) => ({ params, ret: c.ret, examples: rows.map((r) => ({ args: r.slice(0, -1), out: r[r.length - 1]! })) });
  const t0 = Date.now();
  let r: any = deriveProgram(mk(c.rows));
  const e: any = { id: c.id, source: c.source, params: c.names, ...typed, ret: c.ret, examples: c.rows, wrongProgram: c.wrong, disagreeAt: c.at, correct: c.truth ? c.truth(c.at as number[]) : null, why: c.why };
  if (c.limit && r.ok) { e.correct = c.truth ? c.truth(c.at as any[]) : true; e.expected = { outcome: "known-limit", program: r.ok ? r.fit.expr : null, note: c.limit }; out.push(e); console.log(c.id, "limit", r.ok && r.fit.expr); continue; }
  if (r.ok) { const bad = c.grid!.find((a) => evalProgram(r.fit.program, a) !== c.truth!(a as any[])); e.expected = { outcome: "derive", program: r.fit.expr, rightOnGrid: !bad }; out.push(e); console.log(c.id, "DERIVED", r.fit.expr, bad ? `WRONG ${bad}` : "right"); continue; }
  const first = { reason: r.reason, gate: r.gate ?? null, askAt: (r.questions ?? []).map((q: any) => q.at) };
  const rows = [...c.rows]; const answers: V[][] = []; let rounds = 0;
  while (!r.ok && r.questions?.length && rounds < 8) {
    for (const q of r.questions) { const row = [...q.at, c.truth!(q.at)]; rows.push(row); answers.push(row); }
    rounds++; r = deriveProgram(mk(rows));
  }
  const after = r.ok ? { program: r.fit.expr, rightOnGrid: !c.grid!.find((a) => evalProgram(r.fit.program, a) !== c.truth!(a as any[])) } : { refused: r.reason, gate: r.gate ?? null };
  if ("rightOnGrid" in after && !after.rightOnGrid) {
    const bad = c.grid!.find((a) => evalProgram(r.fit.program, a) !== c.truth!(a as any[]))!;
    (after as any).wrongAt = bad; (after as any).correctThere = c.truth!(bad as number[]);
    (after as any).limit = "known limit: the answers never touch the one input line where the truth is special, so the simplest fit is derived again (a single-input exception no example or question shows)";
  }
  e.expected = { outcome: "refuse-and-ask", ...first, answers, rounds, after };
  out.push(e); console.log(c.id, JSON.stringify(first), rounds, JSON.stringify(after), Date.now() - t0, "ms");
}
writeFileSync(process.env.OUT ?? `${W}/peaceai/test/m99-derive-mistakes.json`, JSON.stringify({ schema: "peaceai-derive-mistakes:v1", entries: out }, null, 1) + "\n");
