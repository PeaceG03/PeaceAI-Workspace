// M100 (option B judge, step 1): the DERIVE_FROM_BEHAVIOR practice tasks (peaceai/lib/derive-practice.ts). A fixed
// seed, every category, a few hundred tasks under a small search budget (the engine's own `budget` input), so it runs
// in about a minute on one CPU. Fails when deriveProgram accepts a program the hidden truth disagrees with anywhere on
// the dense grid (outside the known limit: a single-input special case no example shows). Every such case is printed
// in the derive mistakes ledger's shape, ready to add there. The scale run: peaceai/bin/derive-practice.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { CATEGORIES, capAboveUnshown, coverLine, familyCategories, evalJs, gradeTask, judge, ledgerEntry, practiceTask, tally, taskSeed, type PracticeGrade } from "../lib/derive-practice.ts";
import { compileProgram, deriveProgram, type DeriveNode } from "../lib/derive.ts";
import { KNOWN_LIMIT_KINDS } from "../lib/derive-practice-kinds.ts";

const SEED = 100100;
// CI grades the active families only (peaceai/lib/derive-practice-families.json); staged ones are graded with --family.
const ACTIVE = familyCategories("active");
const COUNT = 4 * ACTIVE.length;
const BUDGET = 100_000;

test("practice tasks are deterministic per (seed, index), fit the engine's example limits, and every example is the truth's", () => {
  for (let i = 0; i < CATEGORIES.length * 2; i++) {
    const a = practiceTask(SEED, i), b = practiceTask(SEED, i);
    assert.equal(JSON.stringify([a.examples, a.truthText, a.grid.length]), JSON.stringify([b.examples, b.truthText, b.grid.length]));
    assert.equal(a.category, `${CATEGORIES[i % CATEGORIES.length]!.form.name}/${CATEGORIES[i % CATEGORIES.length]!.mode}`);
    assert.ok(a.examples.length >= 1 && a.examples.length <= 40, a.category);
    for (const e of a.examples) assert.deepEqual(a.truth(e.args), e.out);
    assert.ok(a.grid.length >= 20, a.category);
  }
  assert.notEqual(taskSeed(1, 0), taskSeed(2, 0));
  assert.notEqual(taskSeed(1, 0), taskSeed(1, 1));
  // the full cover shows both sides of every cut, quarter points inside, and 50 / 100 / 150 past the outermost cuts
  assert.deepEqual(coverLine([9, 19]), [-141, -91, -41, 9, 10, 12, 15, 17, 19, 20, 70, 120, 170]);
});

test("the grader: evalJs is the compiled expression, and Auditor's hidden-island pick is graded wrong inside the examples", () => {
  const p: DeriveNode = { op: "not", a: { op: "range", i: 0, lo: 11, hi: 49 } };
  const island = practiceTask(SEED, CATEGORIES.findIndex((c) => c.form.name === "island" && c.mode === "full"));
  const fn = new Function("n", `return ${compileProgram(p, ["n"])};`) as (n: number) => boolean;
  for (const n of [-5, 10, 11, 30, 49, 50]) assert.equal(evalJs(p, [n]), fn(n));
  const truth = (a: readonly (number | string | boolean)[]) => (a[0] as number) <= 10 || (20 <= (a[0] as number) && (a[0] as number) <= 30) || (a[0] as number) >= 50;
  const task = { ...island, truth, examples: [[10, true], [11, false], [15, false], [40, false], [49, false], [50, true]].map(([n, o]) => ({ args: [n as number], out: o as boolean })), grid: Array.from({ length: 201 }, (_, k) => [k - 100]) };
  const j = judge(p, task);
  assert.ok(j.wrong && j.where === "inside" && !j.knownLimit);
  assert.deepEqual(j.wrongAt[0], [20]);
});

test("the known limit: a wrong pick whose every disagreement is the unshown single-input special case is reported apart", () => {
  const i = CATEGORIES.findIndex((c) => c.form.name === "s1_shape" && c.mode === "missing_point");
  const t = practiceTask(SEED, i);
  assert.ok(t.knownLimit && t.point && !t.examples.some((e) => t.point!(e.args)));
  const g = gradeTask(t, { budget: BUDGET });
  if (g.outcome === "wrong") assert.ok(g.knownLimit, `${g.expr} is wrong away from the special case`);
});

test(`practice run (seed ${SEED}, ${COUNT} tasks, budget ${BUDGET}): no wrong program accepted`, () => {
  const grades: PracticeGrade[] = [];
  for (let i = 0; i < COUNT; i++) grades.push(gradeTask(practiceTask(SEED, i, ACTIVE), { budget: BUDGET }));
  const table = tally(grades);
  assert.equal(Object.keys(table).length, ACTIVE.length);
  assert.ok(grades.some((g) => g.outcome === "right"), "some task is derived right");
  assert.ok(grades.every((g) => !g.unsafe), "every accepted expression passes derivedExprProblem");
  const wrong = grades.filter((g) => g.outcome === "wrong" && !g.knownLimit);
  const entries = wrong.map((g) => ledgerEntry(practiceTask(SEED, g.index, ACTIVE), g, "test", SEED));
  const LEDGER_KEYS = ["id", "source", "params", "ret", "examples", "wrongProgram", "disagreeAt", "correct", "why"];
  for (const e of entries) assert.deepEqual(Object.keys(e).filter((k) => LEDGER_KEYS.includes(k)), LEDGER_KEYS, "the derive mistakes ledger's entry keys (peaceai-derive-mistakes:v1)");
  assert.equal(wrong.length, 0, `wrong programs accepted (ledger shape):\n${entries.map((e) => JSON.stringify(e)).join("\n")}`);
});

test("deriveProgram never sees the truth: the same examples give the same result whatever the truth", () => {
  const t = practiceTask(SEED, 0);
  const a = deriveProgram({ params: t.params, ret: t.ret, examples: t.examples, budget: BUDGET });
  const b = deriveProgram({ params: t.params, ret: t.ret, examples: t.examples.map((e) => ({ ...e })), budget: BUDGET });
  assert.equal(JSON.stringify(a), JSON.stringify(b));
});

test("the known limit 'cap above every example': the uncapped pick is known-limit only while no example passes the cap and every disagreement is past it", () => {
  const i = CATEGORIES.findIndex((c) => c.form.name === "floor_clamp" && c.mode === "unwitnessed_cap");
  // m100z finding: truth Math.max(202, Math.min(440, n)), examples all at or below 381, pick `202 <= n ? n : 202`
  const t = { ...practiceTask(SEED, i), truth: (a: readonly (number | string | boolean)[]) => Math.max(202, Math.min(440, a[0] as number)), capAbove: 440, point: undefined, grid: Array.from({ length: 801 }, (_, k) => [k - 100]) };
  const ex = (xs: number[]) => xs.map((n) => ({ args: [n], out: Math.max(202, Math.min(440, n)) }));
  const floorOnly: DeriveNode = { op: "max", a: { op: "param", i: 0 }, c: 202 };
  const shown = ex([52, 152, 201, 202, 203, 300, 381]);
  assert.ok(capAboveUnshown(440, shown));
  const j = judge(floorOnly, t, shown);
  assert.ok(j.wrong && j.where === "past" && j.knownLimit);
  assert.deepEqual(j.wrongAt[0], [441]);
  // an example past the cap: the same pick is blocking
  const past = ex([52, 152, 201, 202, 203, 300, 381, 500]);
  assert.ok(!capAboveUnshown(440, past) && !judge(floorOnly, t, past).knownLimit);
  // a pick wrong below the cap too (inside the examples) stays blocking
  const wrongFloor: DeriveNode = { op: "max", a: { op: "param", i: 0 }, c: 250 };
  assert.ok(!judge(wrongFloor, t, shown).knownLimit);
  // without a declared cap nothing is known-limit
  assert.ok(!judge(floorOnly, { ...t, capAbove: undefined }, shown).knownLimit);
  assert.ok(KNOWN_LIMIT_KINDS.some((k) => k.name === "cap above every example" && k.categories.includes("floor_clamp/unwitnessed_cap") && /far-probe/.test(k.mitigation)));
  // the generator declares the cap on cap and clamp floor_clamp tasks, never on a floor
  for (let k = 0; k < 40; k++) {
    const u = practiceTask(SEED, i + k * CATEGORIES.length);
    if (/^Math\.max\(-?\d+, n\)$/.test(u.truthText)) assert.equal(u.capAbove, undefined); else assert.equal(typeof u.capAbove, "number", u.truthText);
  }
});
