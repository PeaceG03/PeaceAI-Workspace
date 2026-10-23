// Auditor #491 (B1): wrong programs were accepted when the examples did not cover an edge (S1 without "600 gives
// false" derived `(status === 429) || (500 <= status)`). The witness gates (peaceai/lib/derive.ts gateProblem) accept
// a smallest fit only when the examples SHOW what it relies on. One test per gate, each shown to FAIL with that gate
// removed (peaceai/proof/m99-derive-mutation-proof.md), plus the far-probe review note.
import { test } from "node:test";
import assert from "node:assert/strict";
import { arithmeticParams, DERIVE_FAR, DERIVE_MIN_REACH, deriveProgram, evalProgram, farProbes, gateProblem, regionProblem, rivalProblem, type DeriveExample, type DeriveInput, type DeriveNode, type DeriveParam, type DeriveValue } from "../lib/derive.ts";
import { buildDeriveEdit, DERIVE_TRIGGER, DERIVE_VOCAB, deriveReviewNote, parseDeriveTask } from "../lib/learned-derive.ts";
import { reviewBody } from "../lib/review.ts";
import { cleanIssueText } from "../lib/taskmap.ts";

const num = (name: string): DeriveParam => ({ name, type: "number" });
const str = (name: string): DeriveParam => ({ name, type: "string" });
const P0: DeriveNode = { op: "param", i: 0 };
const P1: DeriveNode = { op: "param", i: 1 };
const lit = (v: number | string): DeriveNode => ({ op: "lit", v });
const ex = (rows: readonly (readonly (number | string | boolean)[])[]): DeriveExample[] => rows.map((r) => ({ args: r.slice(0, -1) as never, out: r[r.length - 1]! }));
/**
 * The first witness gate a program fails on these examples, with its parameter ("" = it passes every gate before the
 * rival search; the rival gate runs last and has its own test below, with example sets built for it).
 */
const gate = (params: DeriveParam[], ret: DeriveInput["ret"], program: DeriveNode, rows: Parameters<typeof ex>[0], size = 5) => {
  const g = gateProblem({ params, ret, examples: ex(rows) }, program, size);
  return !g || g.gate === "rival" ? "" : `${g.gate}${g.param ? `:${g.param}` : ""}`;
};

// S1 exactly as the PR head 235c99d had it (no 700).
const S1_235 = [[429, true], [500, true], [502, true], [503, true], [504, true], [550, true], [510, true], [520, true], [530, true], [540, true], [560, true], [570, true], [580, true], [590, true], [438, false], [446, false], [454, false], [462, false], [470, false], [478, false], [486, false], [494, false], [599, true], [428, false], [430, false], [499, false], [600, false], [200, false], [204, false], [301, false], [400, false], [403, false], [404, false], [0, false]] as const;
const status = [num("status")];

test("B1 repro: S1 without \"600 gives false\" is refused (gate far), not derived as `(status === 429) || (500 <= status)`", () => {
  const no600 = deriveProgram({ params: status, ret: "boolean", examples: ex(S1_235.filter(([a]) => a !== 600)) });
  assert.equal(no600.ok, false);
  assert.equal(!no600.ok && `${no600.reason}/${no600.gate}/${no600.param}`, "derive_under_specified/far/status");
  assert.match(!no600.ok ? no600.detail! : "", /`\(status === 429\) \|\| \(500 <= status\)` has its last edge at 500, but no example has status >= 600/);
  // The 235c99d S1 (with 600, no 700) is refused too: past 599 nothing is shown.
  const s235 = deriveProgram({ params: status, ret: "boolean", examples: ex(S1_235) });
  assert.equal(!s235.ok && `${s235.reason}/${s235.gate}`, "derive_under_specified/far");
  // "700 gives false" shows past 599; inside the false stretch 430 to 499 and below 428 the round-2 region gate
  // (Auditor #491) also wants 465 and 100, as the refile draft has them: derived.
  const s700 = deriveProgram({ params: status, ret: "boolean", examples: ex([...S1_235, [700, false]]) });
  assert.equal(!s700.ok && `${s700.reason}/${s700.gate}`, "derive_under_specified/region");
  const s1 = deriveProgram({ params: status, ret: "boolean", examples: ex([...S1_235, [700, false], [465, false], [100, false]]) });
  assert.equal(s1.ok && s1.fit.expr, "(status === 429) || (500 <= status && status <= 599)");
});

test("gate unread: a parameter the program ignores needs two examples differing only in it with the same result", () => {
  const ab = [num("a"), num("b")];
  assert.equal(gate(ab, "number", P0, [[1, 1, 1], [2, 2, 2], [3, 0, 3]]), "unread:b");
  assert.equal(gate(ab, "number", P0, [[1, 1, 1], [2, 2, 2], [3, 0, 3], [1, 7, 1], [101, 0, 101], [0, 3, 0]]), ""); // round 3: a = 0 shown (gate span, sign)
});

test("gate chars: a string parameter that is read needs upper, lower, digit, inner space, edge space and punctuation", () => {
  const s = [str("s")];
  const prog: DeriveNode = { op: "cat", a: lit("x:"), b: P0 };
  const base = [["ab", "x:ab"], ["cd", "x:cd"]] as const;
  assert.equal(gate(s, "string", prog, base), "chars:s");
  assert.equal(gate(s, "string", prog, [...base, ["Ab 1-x", "x:Ab 1-x"], [" pad ", "x: pad "]]), "chars:s"); // round 3: no empty s
  const noEmpty = deriveProgram({ params: s, ret: "string", examples: ex([...base, ["Ab 1-x", "x:Ab 1-x"], [" pad ", "x: pad "]]) });
  assert.ok(!noEmpty.ok && noEmpty.gate === "chars" && /the empty string/.test(noEmpty.detail ?? ""), JSON.stringify(noEmpty));
  assert.deepEqual(noEmpty.ok ? [] : noEmpty.questions?.map((q) => q.at), [[""]], "asks for s = \"\"");
  assert.equal(gate(s, "string", prog, [...base, ["Ab 1-x", "x:Ab 1-x"], [" pad ", "x: pad "], ["", "x:"]]), "");
});

test("gate edge: both sides of every threshold, and c - 1, c, c + 1 for an equality", () => {
  const n = [num("n")];
  const far = [[110, true], [-90, false]] as const;
  const ge10: DeriveNode = { op: "le", a: lit(10), b: P0 };
  // 10 <= n: needs n = 9 (false) and n = 10 (true).
  assert.equal(gate(n, "boolean", ge10, [[10, true], [11, true], [3, false], ...far]), "edge:n");
  assert.equal(gate(n, "boolean", ge10, [[10, true], [11, true], [3, false], [9, false], ...far]), "");
  // n <= 10: needs n = 10 (true) and n = 11 (false).
  const le10: DeriveNode = { op: "le", a: P0, b: lit(10) };
  assert.equal(gate(n, "boolean", le10, [[10, true], [3, true], [12, false], [110, false], [-90, true]]), "edge:n");
  // n === 5: needs 4, 5 and 6, each pair with different results.
  const eq5: DeriveNode = { op: "eq", a: P0, b: lit(5) };
  const farEq = [[105, false], [-95, false]] as const;
  assert.equal(gate(n, "boolean", eq5, [[5, true], [4, false], [0, false], ...farEq]), "edge:n");
  assert.equal(gate(n, "boolean", eq5, [[5, true], [6, false], [0, false], ...farEq]), "edge:n");
  assert.equal(gate(n, "boolean", eq5, [[5, true], [4, false], [6, false], ...farEq]), "");
  // a range: both ends.
  const rng: DeriveNode = { op: "range", i: 0, lo: 500, hi: 599 };
  const rows = [[500, true], [599, true], [550, true], [499, false], [700, false], [399, false]] as const;
  assert.equal(gate(n, "boolean", rng, rows), "edge:n"); // no 600: the upper end is not shown
  assert.equal(gate(n, "boolean", rng, [[500, true], [599, true], [550, true], [450, false], [600, false], [700, false], [0, false]]), "edge:n"); // no 499: the lower end
  assert.equal(gate(n, "boolean", rng, [...rows, [600, false]]), "region:n"); // round 3: 500..599 bare over an eighth
  assert.equal(gate(n, "boolean", rng, [...rows, [600, false], ...[510, 520, 530, 540, 560, 570, 580, 590].map((v) => [v, true] as const)]), "");
  // p === q: the delta edges -1 / 0 / +1.
  const ab = [num("a"), num("b")];
  const eqab: DeriveNode = { op: "eq", a: P0, b: P1 };
  const deltaFar = [[105, 5, false], [5, 105, false]] as const;
  assert.equal(gate(ab, "boolean", eqab, [[5, 5, true], [7, 7, true], [6, 5, false], ...deltaFar]), "edge:a");
  assert.equal(gate(ab, "boolean", eqab, [[5, 5, true], [7, 7, true], [6, 5, false], [4, 5, false], ...deltaFar]), "");
  // emptiness: "" and a non-empty value with different results.
  const s = [str("s")];
  const emp: DeriveNode = { op: "empty", i: 0 };
  const chars = [["Ab 1-x", false], [" pad ", false]] as const;
  assert.equal(gate(s, "boolean", emp, [["abc", false], ...chars]), "chars:s"); // round 3: the chars gate asks for "" first
  assert.equal(gate(s, "boolean", emp, [["", true], ["abc", false], ...chars]), "");
  // Round 3: "" shown (the chars gate passes) but never paired with a non-empty value under the same other arguments:
  // the emptiness test is still not shown (edge), until such a pair is added.
  const st = [str("s"), str("t")];
  const ifEmp: DeriveNode = { op: "if", c: emp, t: P1, e: P0 };
  const unpaired = [["", "Zq 9-z", "Zq 9-z"], ["", " t2 ", " t2 "], ["", "", ""], ["Ab 1-x", "k", "Ab 1-x"], [" pad ", "k", " pad "], ["abc", "k", "abc"]] as const;
  assert.equal(gate(st, "string", ifEmp, unpaired), "edge:s");
  assert.notEqual(gate(st, "string", ifEmp, [...unpaired, ["", "k", "k"]]), "edge:s");
});

test(`gate far: an example at least DERIVE_FAR (${DERIVE_FAR}) past the last edge and before the first`, () => {
  const n = [num("n")];
  const ge10: DeriveNode = { op: "le", a: lit(10), b: P0 };
  const near = [[10, true], [11, true], [3, false], [9, false]] as const;
  assert.equal(gate(n, "boolean", ge10, [...near, [-90, false]]), "far:n");
  assert.equal(gate(n, "boolean", ge10, [...near, [109, true], [-90, false]]), "far:n");
  assert.equal(gate(n, "boolean", ge10, [...near, [110, true]]), "far:n");
  assert.equal(gate(n, "boolean", ge10, [...near, [110, true], [-90, false]]), "");
  // Two compared parameters: a - b >= DERIVE_FAR and <= -DERIVE_FAR.
  const ab = [num("a"), num("b")];
  const le: DeriveNode = { op: "le", a: P0, b: P1 };
  const rows = [[5, 5, true], [6, 5, false], [7, 9, true], [9, 2, false]] as const;
  assert.equal(gate(ab, "boolean", le, rows), "far:a");
  assert.equal(gate(ab, "boolean", le, [...rows, [105, 5, false]]), "far:a"); // a - b >= 100 only
  assert.equal(gate(ab, "boolean", le, [...rows, [5, 105, true]]), "far:a"); // a - b <= -100 only
  assert.equal(gate(ab, "boolean", le, [...rows, [105, 5, false], [5, 105, true]]), "");
});

test(`gate branch / cap: each branch and each side of a cap is reached by at least DERIVE_MIN_REACH (${DERIVE_MIN_REACH}) examples`, () => {
  const ab = [num("a"), num("b")];
  // if (a === b) 1 else a: the true branch is reached by one example only.
  const prog: DeriveNode = { op: "if", c: { op: "eq", a: P0, b: P1 }, t: { op: "int", v: 1 }, e: P0 };
  const rows = [[5, 5, 1], [4, 5, 4], [6, 5, 6], [105, 5, 105], [5, 105, 5], [0, 5, 0]] as const; // a = 0: gate span, sign
  assert.equal(gate(ab, "number", prog, rows, 6), "branch");
  assert.equal(gate(ab, "number", prog, [...rows, [7, 7, 1]], 6) === "branch", false);
  // One parameter, `n === c`: its true branch holds for one input only, so one example is enough there.
  const n = [num("n")];
  const pt: DeriveNode = { op: "if", c: { op: "eq", a: P0, b: lit(5) }, t: { op: "int", v: 1 }, e: P0 };
  assert.equal(gate(n, "number", pt, [[5, 1], [4, 4], [6, 6], [105, 105], [-95, -95], [0, 0]], 6) === "branch", false);
  // min(100, x): one example past the cap is not enough. (x shown down to -105: the round-3 sign check.)
  const x = [num("x")];
  const cap: DeriveNode = { op: "min", c: 100, a: P0 };
  assert.equal(gate(x, "number", cap, [[1, 1], [2, 2], [-105, -105], [200, 100]], 2), "cap");
  assert.equal(gate(x, "number", cap, [[1, 1], [2, 2], [-105, -105], [200, 100], [300, 100]], 2) === "cap", false);
  assert.equal(gate(x, "number", cap, [[-105, -105], [200, 100], [300, 100]], 2), "cap");
});

// Auditor #491 round 2 (wrong programs passed the witness gates): the hidden island `!(11 <= n && n <= 49)` was
// accepted with only the range's ends shown inside (wrong at 20), and `n * n` from inputs -5..24 (an unwitnessed cap,
// wrong at -50). Gate region: an example inside every region the constants cut a compared parameter into; gate span:
// a number parameter the result is computed from is shown over DERIVE_FAR, and every result sign the program reaches
// inside the examples' range is shown.
test("gate region: no example-free stretch over half a finite region, or over DERIVE_FAR in an open one", () => {
  const n = [num("n")];
  const island: DeriveNode = { op: "not", a: { op: "range", i: 0, lo: 11, hi: 49 } };
  const outside = [[10, true], [11, false], [49, false], [50, true], [150, true], [-90, true]] as const;
  assert.equal(gate(n, "boolean", island, outside, 5), "region:n");
  const r = regionProblem(island, n, ex(outside));
  assert.match(r!.detail, /inside the region 11 to 49 no example has n between 11 and 49 \(more than an eighth of the region\); add one there \(e\.g\. n = 30\)/);
  assert.equal(gate(n, "boolean", island, [...outside, [30, false]], 5), "region:n"); // round 3: 30 leaves 19 bare, over 39 / 8
  assert.equal(gate(n, "boolean", island, [...outside, ...[15, 19, 23, 27, 31, 35, 39, 43, 47].map((v) => [v, false] as const)], 5), "");
  // 21 inside leaves 21..49 (28 > 19) bare: still refused.
  assert.equal(gate(n, "boolean", island, [...outside, [21, false]], 5), "region:n");
  // Open region: past 10 <= n, 11 to 130 is bare for more than DERIVE_FAR.
  const ge10: DeriveNode = { op: "le", a: lit(10), b: P0 };
  const open = [[10, true], [11, true], [3, false], [9, false], [130, true], [-90, false]] as const;
  assert.equal(gate(n, "boolean", ge10, open), "region:n");
  assert.match(regionProblem(ge10, n, ex(open))!.detail, /past the program's last edge no example has n between 11 and 130/);
  assert.equal(gate(n, "boolean", ge10, [...open, [70, true]]), "");
  // Before the first edge too.
  const low = [[10, true], [11, true], [3, false], [9, false], [110, true], [-190, false]] as const;
  assert.equal(gate(n, "boolean", ge10, low), "region:n");
  assert.equal(gate(n, "boolean", ge10, [...low, [-90, false]]), "");
});

test("gate span: a computed-from parameter shown over DERIVE_FAR; every result sign the program reaches is shown", () => {
  const n = [num("n")];
  const sq: DeriveNode = { op: "sq", a: P0 };
  const small = [[-5, 25], [0, 0], [3, 9], [24, 576]] as const;
  assert.equal(gate(n, "number", sq, small), "span:n");
  assert.equal(gate(n, "number", sq, [...small, [100, 10000]]), "");
  // a * b shown only negative (Auditor's cap lin2: min(150, a * b) was derived as a * b, wrong at (-200, -200)).
  const ab = [num("a"), num("b")];
  const mul: DeriveNode = { op: "mul", a: P0, b: P1 };
  const neg = [[16, -46, -736], [-90, 16, -1440], [-150, 38, -5700], [94, -102, -9588], [134, -74, -9916], [-30, 94, -2820]] as const;
  assert.equal(gate(ab, "number", mul, neg), "span");
  assert.match(gateProblem({ params: ab, ret: "number", examples: ex(neg) }, mul, 3)!.detail, /no example has a positive result/);
  assert.equal(gate(ab, "number", mul, [...neg, [-150, -102, 15300]]), "span"); // round 3: the corner (-150, 94) gives -14100, below every result
  assert.deepEqual(gateProblem({ params: ab, ret: "number", examples: ex([...neg, [-150, -102, 15300]]) }, mul, 3)!.at, [[-150, 94]]);
  assert.equal(gate(ab, "number", mul, [...neg, [-150, -102, 15300], [-150, 94, -14100]]), "");
  // round 3 (practice generator, cap_lin2 inside): min(916, a * b) shown up to 873 was derived as a * b, wrong at (-31, -30).
  const capIn = deriveProgram({ params: ab, ret: "number", examples: ex([[-3, 70, -210], [2, 2, 4], [1, -90, -90], [7, 9, 63], [97, 9, 873], [-93, 70, -6510]]) });
  assert.ok(!capIn.ok && capIn.gate === "span" && /corner|inside the examples' range of every parameter/.test(capIn.detail ?? ""), JSON.stringify(capIn));
  // round 3, span sign (m100 practice floor_clamp): `n` for max(61, n) shown from 61 to 212 is refused, asking at n = 0;
  // shown negative only down to -43, it asks at -DERIVE_FAR; a floor already shown (flat there) is not asked about.
  const pos = [[61, 61], [62, 62], [112, 112], [162, 162], [212, 212]] as const;
  assert.equal(gate(n, "number", P0, pos), "span:n");
  assert.deepEqual(gateProblem({ params: n, ret: "number", examples: ex(pos) }, P0, 1)!.at, [[0]]);
  const neg43 = [[57, 57], [107, 107], [157, 157], [-43, -43], [7, 7]] as const;
  assert.equal(gate(n, "number", P0, neg43), "span:n");
  assert.deepEqual(gateProblem({ params: n, ret: "number", examples: ex(neg43) }, P0, 1)!.at, [[-DERIVE_FAR]]);
  assert.equal(gate(n, "number", P0, [...neg43, [-143, -143]]), "");
  const floored: DeriveNode = { op: "if", c: { op: "le", a: lit(61), b: P0 }, t: P0, e: lit(61) };
  assert.notEqual(gate(n, "number", floored, [...pos, [10, 61], [-90, 61]]), "span:n"); // (edge still asks: 60 and 61 both give 61)
  // Compared-only parameters are not "computed from"; string parameters have no span.
  assert.deepEqual([...arithmeticParams({ op: "le", a: P0, b: lit(5) })], []);
  assert.deepEqual([...arithmeticParams({ op: "if", c: { op: "le", a: P0, b: lit(5) }, t: P1, e: { op: "add", a: P0, b: { op: "int", v: 1 } } })].sort(), [0, 1]);
  assert.equal(gate([str("s")], "string", { op: "cat", a: lit("x:"), b: P0 }, [["Ab 1-x", "x:Ab 1-x"], [" pad ", "x: pad "], ["", "x:"]]), "");
});

// Round 3: through deriveProgram, the rival gate alone refuses this (m100 practice seed 100 task 96, cap_sq
// unwitnessed cap): n * n passes every other gate, and `min(6724, n * n)` fits every example too but differs past them.
test("gate rival through deriveProgram: a far rival refuses and asks past the examples", () => {
  // (Scaled to the cap 10000 = 100 * 100 so n is shown down to -100, as the sign check asks.)
  const rows = [[-100, 10000], [-20, 400], [-3, 9], [-1, 1], [0, 0], [1, 1], [2, 4], [5, 25], [17, 289], [30, 900], [50, 2500], [100, 10000]] as const;
  const r = deriveProgram({ params: [num("n")], ret: "number", examples: ex(rows) });
  assert.equal(!r.ok && `${r.reason}/${r.gate}`, "derive_under_specified/rival", JSON.stringify(r).slice(0, 300));
  assert.ok(!r.ok && r.questions?.some((q) => (q.at[0] as number) < -100 || (q.at[0] as number) > 100), JSON.stringify(!r.ok && r.questions));
});

test("gate rival (size + 2): near pass (every example value a constant, probes inside the examples) and far pass (witnessed edges, far probes past them)", () => {
  // Near: `min(3, a - b)` fits all 14 rows and differs from `a - b` at (3, -1), inside the examples.
  const ab = [num("actual"), num("reference")];
  const rows = [[-1, -1, 0], [-1, 2, -3], [-1, 10, -11], [0, 0, 0], [0, 3, -3], [0, 100, -100], [1, 1, 0], [1, 5, -4], [2, -1, 3], [2, 2, 0], [2, 10, -8], [3, 0, 3], [3, 3, 0], [3, 100, -97]] as const;
  // (deriveProgram stops earlier on these rows, at gate span: actual is shown from -1 to 3 only.)
  const viaDerive = deriveProgram({ params: ab, ret: "number", examples: ex(rows) });
  assert.equal(!viaDerive.ok && `${viaDerive.reason}/${viaDerive.gate}`, "derive_under_specified/span");
  const near = rivalProblem({ params: ab, ret: "number", examples: ex(rows) }, { op: "sub", a: P0, b: P1 }, 3);
  assert.equal(near?.gate, "rival");
  assert.match(near!.detail, /also fits every example but differs from `actual - reference` at \(3, -1\): 3 vs 4; add/);
  assert.doesNotMatch(near!.detail, /far probe/);
  // Far: x * x on 0, 2, -2: `min(x, 4) * min(x, 4)` (4 a repeated result) differs at the far probe 20.
  const x = [num("x")];
  const sq = { params: x, ret: "number" as const, examples: ex([[0, 0], [2, 4], [-2, 4]]) };
  const far = rivalProblem(sq, { op: "mul", a: P0, b: P0 }, 3);
  assert.equal(far?.gate, "rival");
  assert.match(far!.detail, /at \(20\): 16 vs 400 \(a far probe, past the examples\)/);
  assert.ok(farProbes(x, sq.examples).some((a) => a[0] === 20));
  assert.equal(rivalProblem({ ...sq, examples: [...sq.examples, { args: [20], out: 400 }] }, { op: "mul", a: P0, b: P0 }, 3), null);
  // A spent rival budget refuses (rival_budget), never accepts.
  assert.equal(rivalProblem(sq, { op: "mul", a: P0, b: P0 }, 3, 10)?.gate, "rival_budget");
  // Negative far probes count only when some example is negative (S2 has none: no rival at (0, -1)).
  const pos = { params: x, ret: "number" as const, examples: ex([[0, 0], [1, 1], [2, 4], [30, 900]]) };
  assert.equal(rivalProblem(pos, { op: "mul", a: P0, b: P0 }, 3), null);
  // S2 (attempt, baseMs >= 0 in every example) derives; with negative far probes it would be asked for negative waits.
  const s2 = deriveProgram({ params: [num("attempt"), num("baseMs")], ret: "number", examples: ex([[0, 1000, 1000], [1, 1000, 4000], [2, 1000, 9000], [3, 1000, 16000], [4, 1000, 25000], [5, 1000, 30000], [10, 1000, 30000], [100, 1000, 30000], [0, 500, 500], [1, 500, 2000], [2, 250, 2250], [0, 0, 0], [7, 0, 0], [0, 40000, 30000]]) });
  assert.equal(s2.ok, true, s2.ok ? "" : `${s2.reason} ${s2.detail ?? ""}`);
});

test("refusal through the rule names the gate and the parameter; the detail says what to add", () => {
  const PARAMS = Object.fromEntries(Object.entries(DERIVE_VOCAB).map(([k, v]) => [k, v[0]]));
  const FILES = [{ path: "src/host.ts", content: "export const x = 1;\n" }];
  const body = `Add a new module \`src/r2-retry-status.ts\` exporting \`isRetryableR2Status(status: number): boolean\`.\n\nBehavior: true for 429 and server errors.\n\nExamples:\n${S1_235.filter(([a]) => a !== 600).map(([a, b]) => `- ${a} gives ${b}`).join("\n")}`;
  const p = parseDeriveTask(DERIVE_TRIGGER, cleanIssueText({ title: "t", body } as never));
  assert.ok("task" in p);
  const b = buildDeriveEdit(PARAMS, p.task, FILES);
  assert.ok("reason" in b);
  assert.equal(b.reason, "derive_under_specified_far: status");
  assert.match(b.detail ?? "", /no example has status >= 600/);
});

// ---- The far-probe review note (Auditor #491 B1: the derived expression and a far-probe table for the reviewer)

const S1_BODY = `Add a new module \`src/r2-retry-status.ts\` exporting \`isRetryableR2Status(status: number): boolean\`.\n\nBehavior: true for 429 and server errors 500 through 599.\n\nExamples:\n${[...S1_235, [700, false], [465, false], [100, false]].map(([a, b]) => `- ${a} gives ${b}`).join("\n")}`;
const asDiff = (files: { path: string; content: string }[]) => files.map((f) => {
  const lines = f.content.replace(/\n$/, "").split("\n");
  return `diff --git a/${f.path} b/${f.path}\nnew file mode 100644\nindex 0000000..1111111\n--- /dev/null\n+++ b/${f.path}\n@@ -0,0 +1,${lines.length} @@\n${lines.map((l) => `+${l}`).join("\n")}\n`;
}).join("");

test("review note: a DERIVE candidate shows its expression and far-probe outputs, rebuilt from its diff; anything else gets none", () => {
  const PARAMS = Object.fromEntries(Object.entries(DERIVE_VOCAB).map(([k, v]) => [k, v[0]]));
  const FILES = [{ path: "src/host.ts", content: "export const x = 1;\n" }];
  const p = parseDeriveTask(DERIVE_TRIGGER, cleanIssueText({ title: "t", body: S1_BODY } as never));
  assert.ok("task" in p);
  const b = buildDeriveEdit(PARAMS, p.task, FILES);
  assert.ok("edit" in b);
  const files = [{ path: b.edit.path, content: b.edit.content }, ...b.edit.extra];
  const note = deriveReviewNote(asDiff(files));
  assert.ok(note);
  assert.match(note, /^Derived by PeaceAI from the 37 examples/);
  assert.ok(note.includes("return (status === 429) || (500 <= status && status <= 599);"));
  // Far probes: past the outermost edges (+-10 / +-100) and 10x the largest example value.
  for (const line of ["isRetryableR2Status(610) = false", "isRetryableR2Status(328) = false", "isRetryableR2Status(7000) = false", "isRetryableR2Status(-7000) = false"]) assert.ok(note.includes(line), line);
  assert.match(note, /isRetryableR2Status\(5\d\d\) = true/); // a probe inside 500..599 (round 3: 590 is now an example)
  // Shown above the diff in the review comment, as written.
  const body = reviewBody([{ label: "A", id: "c1" }], new Map([["c1", "diff"]]), null, "pr", new Map([["c1", note]]));
  assert.ok(body.includes(`### Candidate A\n\n${note}\n\n<details>`));
  // A module whose expression is not what the examples derive, a test that is not literal assert.equal lines, or a
  // non-derive diff: no note.
  assert.equal(deriveReviewNote(asDiff([{ ...files[0]!, content: files[0]!.content.replace("599", "598") }, files[1]!])), null);
  assert.equal(deriveReviewNote(asDiff([files[0]!, { ...files[1]!, content: files[1]!.content.replace(/assert\.equal\(isRetryableR2Status\(0\), false\);/, "assert.equal(isRetryableR2Status(Number(\"0\")), false);") }])), null);
  assert.equal(deriveReviewNote(asDiff([files[0]!])), null);
  // Exactly one created module: a second new source file means it is not a DERIVE candidate.
  assert.equal(deriveReviewNote(asDiff([...files, { path: "src/extra.ts", content: "export const y = 2;\n" }])), null);
  // The literal-only check holds on its own (a search that would accept anything still gets no non-literal test).
  const anything: typeof deriveProgram = (input) => deriveProgram({ ...input, examples: input.examples.filter((e) => e.args.every((a) => a !== undefined)) });
  assert.ok(deriveReviewNote(asDiff(files), anything));
  assert.equal(deriveReviewNote(asDiff([files[0]!, { ...files[1]!, content: files[1]!.content.replace(/assert\.equal\(isRetryableR2Status\(0\), false\);/, "assert.equal(isRetryableR2Status(Number(\"0\")), false);") }]), anything), null);
  assert.equal(deriveReviewNote("diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1 +1 @@\n-a\n+b\n"), null);
});

// Auditor #491 (non-blocking): a parameter or function named `eval` (or another reserved / global name) is refused
// cleanly at parse time, before any search or module text.
test("reserved names: a parameter or function named eval, arguments or globalThis is derive_reserved_name", () => {
  const body = (sig: string) => S1_BODY.replace("isRetryableR2Status(status: number): boolean", sig);
  for (const sig of ["isRetryableR2Status(eval: number): boolean", "isRetryableR2Status(arguments: number): boolean", "isRetryableR2Status(globalThis: number): boolean", "eval(status: number): boolean"]) {
    const p = parseDeriveTask(DERIVE_TRIGGER, cleanIssueText({ title: "t", body: body(sig) } as never));
    assert.deepEqual(p, { reason: "derive_reserved_name" }, sig);
  }
  const ok = parseDeriveTask(DERIVE_TRIGGER, cleanIssueText({ title: "t", body: S1_BODY } as never));
  assert.ok("task" in ok);
});

// Upstream scan, round 3 (rcbyr/keen-slider sign: -1, 0, 2, 10, 99 gave `min(x, 1)`, wrong at every x < -1): a min /
// max cap is an edge on the value it caps, so that value is shown DERIVE_FAR past the cap on each side a probe reaches.
test("gate far, caps: the capped value is shown DERIVE_FAR past the cap on each side the program reaches", () => {
  const x = [num("x")];
  const cap: DeriveNode = { op: "min", c: 1, a: P0 };
  const sign = [[-1, -1], [0, 0], [2, 1], [10, 1], [99, 1]] as const;
  assert.equal(gate(x, "number", cap, sign, 2), "far"); // nothing at x >= 101
  assert.equal(gate(x, "number", cap, [...sign, [990, 1]], 2), "far"); // nothing at x <= -99
  assert.equal(gate(x, "number", cap, [...sign, [990, 1], [-100, -100]], 2) === "far", false);
  const r = deriveProgram({ params: x, ret: "number", examples: sign.map(([a, o]) => ({ args: [a], out: o })) });
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.gate, "far");
    assert.deepEqual(r.questions, [{ at: [990], answers: [1, 990] }]); // the cap lifted past the examples gives 990
  }
  // A floor the program cannot reach past is not asked for: max(0, x) capped at 1 (clamp to [0, 1]).
  const clamp: DeriveNode = { op: "min", c: 1, a: { op: "max", c: 0, a: P0 } };
  const rows = [[-500, 0], [-100, 0], [-3, 0], [0, 0], [1, 1], [2, 1], [150, 1], [900, 1]] as const;
  assert.notEqual(gate(x, "number", clamp, rows, 2), "far");
  // The upstream function, asked: 990 -> 1, -100 -> -1, -101 -> -1; then the floor is derived (right everywhere).
  const up = (v: number) => Math.sign(v);
  const ex = [...sign, [990, 1], [-100, -1], [-101, -1]].map(([a, o]) => ({ args: [a!], out: o! }));
  const d = deriveProgram({ params: x, ret: "number", examples: ex });
  assert.ok(d.ok);
  if (d.ok) for (let v = -2000; v <= 2000; v++) assert.equal(evalProgram(d.fit.program, [v]), up(v) || 0, String(v));
});

test("gate far, caps: a clamp's floor hidden past its ceiling still asks (every cap lifted), and answering closes it", () => {
  // tinycolor clamp01 / wavesurfer clampToUnit / recharts clampRatio: min(1, max(0, v)) from four rows. At the reaching
  // input the outer ceiling hides lifting the floor alone (both give 1), so the other answer lifts every cap.
  const x = [num("val")];
  const up = (v: number) => Math.min(1, Math.max(0, v));
  const ex = [-1, 2, 10, -2].map((v) => ({ args: [v] as DeriveValue[], out: up(v) as DeriveValue }));
  const first = deriveProgram({ params: x, ret: "number", examples: ex });
  assert.equal(first.ok, false);
  if (!first.ok) { assert.equal(first.gate, "far"); assert.deepEqual(first.questions, [{ at: [100], answers: [1, 100] }]); }
  let rounds = 0;
  for (; rounds < 8; rounds++) {
    const r = deriveProgram({ params: x, ret: "number", examples: ex });
    if (r.ok) break;
    const q = (r.questions ?? []).find((q) => !ex.some((e) => e.args[0] === q.at[0]));
    assert.ok(q, `refusal ${r.reason}/${r.gate ?? ""} asks nothing`);
    ex.push({ args: q!.at, out: up(q!.at[0] as number) }); // answered by the upstream function, never by the program
  }
  const d = deriveProgram({ params: x, ret: "number", examples: ex });
  assert.ok(d.ok, `still refused after ${rounds} rounds`);
  if (d.ok) for (let v = -2000; v <= 2000; v++) assert.equal(evalProgram(d.fit.program, [v]), up(v), String(v));
});

