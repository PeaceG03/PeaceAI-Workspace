// M104 (Auditor NOT PASS #498 on b2f0f67): the ternary gate keys every if by guard class (with the guard parameter's
// type and a separate empty-string test: eq-num-const / eq-str-empty / eq-str-const / le / sle / eq ...), the kind of
// each branch (lit / param / concat / nested), the result type, and the place of the if (top / concat / if / expr).
// Nested ifs and every if inside a concat each need their own fully keyed evidence. Here: 10 distinct plural-only
// entries ((n === 1) ? "" : "s...") unlock none of Auditor's four cases; 10 distinct entries of each case's own keys do.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DERIVE_FORM_BAR, DERIVE_FORMS, evalProgram, evidenceTernaryShapeCounts, ternaryShapesOf, unevidencedForms, type DeriveNode, type DeriveType, type DeriveValue } from "../lib/derive.ts";

const root = resolve(import.meta.dirname, "../..");
const p = (i: number): DeriveNode => ({ op: "param", i });
const lit = (v: string): DeriveNode => ({ op: "lit", v });
const int = (v: number): DeriveNode => ({ op: "int", v });
const eqC = (i: number, b: DeriveNode): DeriveNode => ({ op: "eq", a: p(i), b });
const iff = (c: DeriveNode, t: DeriveNode, e: DeriveNode): DeriveNode => ({ op: "if", c, t, e });
const cat = (a: DeriveNode, b: DeriveNode): DeriveNode => ({ op: "cat", a, b });

type Case = { name: string; types: DeriveType[]; make: (k: number) => DeriveNode; grid: DeriveValue[][]; keys: string[] };
const S = ["", "x", "ab", "Hello", " Ab 9. "];
const N = [-1, 0, 1, 2, 3, 7];
const pairs = <A, B>(as: A[], bs: B[]) => as.flatMap((a) => bs.map((b) => [a, b] as DeriveValue[]));
// make(0) is Auditor's program; make(k) varies only a literal (none to vary in the first), so every fake has the same
// keys; each fake has its own examples (and expression text).
const CASES: Case[] = [
  { name: '(s === "") ? t : s', types: ["string", "string"], make: () => iff({ op: "empty", i: 0 }, p(1), p(0)), grid: pairs(S, S), keys: ["eq-str-empty|param,param|string@top"] },
  { name: 's === "x" ? t : "y"', types: ["string", "string"], make: (k) => iff(eqC(0, lit(k === 0 ? "x" : `x${k}`)), p(1), lit(k === 0 ? "y" : `y${k}`)), grid: pairs([...S, "x1", "x2"], S), keys: ["eq-str-const|param,lit|string@top"] },
  { name: 'nested: (n === 0) ? "zero" : ((n === 1) ? "one" : "many")', types: ["number"], make: (k) => iff(eqC(0, int(0)), lit(k === 0 ? "zero" : `zero${k}`), iff(eqC(0, int(1)), lit("one"), lit("many"))), grid: N.map((n) => [n]), keys: ["eq-num-const|lit,lit|string@if", "eq-num-const|lit,nested|string@top"] },
  { name: 'two ifs in a concat: ((n === 1) ? "" : "s") + ((m === 1) ? "" : "es")', types: ["number", "number"], make: (k) => cat(iff(eqC(0, int(1)), lit(""), lit(k === 0 ? "s" : `s${k}`)), iff(eqC(1, int(1)), lit(""), lit("es"))), grid: pairs(N, N), keys: ["eq-num-const|lit,lit|string@concat"] },
];
const PLURAL: Case = { name: '(n === 1) ? "" : "s"', types: ["number"], make: (k) => iff(eqC(0, int(1)), lit(""), lit(k === 0 ? "s" : `s${k}`)), grid: N.map((n) => [n]), keys: ["eq-num-const|lit,lit|string@top"] };
const NAMES = ["s", "t"];

// One fake upstream entry: the program's recorded keys, its own expression text, examples from evaluating it.
const fake = (c: Case, k: number, salt = 0) => {
  const prog = c.make(k);
  const rows = c.grid.slice(0, c.grid.length - (k % 3)).map((args) => ({ args, out: evalProgram(prog, args) }));
  if (salt) rows.push({ args: c.grid[salt % c.grid.length], out: evalProgram(prog, c.grid[salt % c.grid.length]) });
  return { repo: `fake/${k}`, fn: `f${k}`, params: c.types.map((type, i) => ({ name: NAMES[i] ?? `p${i}`, type })), expr: `${JSON.stringify(prog)} /*${k}*/`, examples: rows, forms: ["ternary"], ternaryShapes: ternaryShapesOf(prog, c.types) };
};
const fakes = (c: Case, n: number) => Array.from({ length: n }, (_, k) => fake(c, k + 1, k));
const file = (es: unknown[]) => JSON.stringify({ examples: es });
const ALL = Object.fromEntries(DERIVE_FORMS.map((f) => [f, DERIVE_FORM_BAR])) as Parameters<typeof unevidencedForms>[1];

test("ternary keys: each Auditor case has its own fully keyed ifs (guard class with type, branch kinds, result, place)", () => {
  assert.deepEqual(ternaryShapesOf(PLURAL.make(0), PLURAL.types), PLURAL.keys);
  for (const c of CASES) assert.deepEqual(ternaryShapesOf(c.make(0), c.types), c.keys, c.name);
  // A guard parameter of another type, an empty-string test, and a non-empty constant are all different guards.
  assert.deepEqual(ternaryShapesOf(iff(eqC(0, lit("")), p(1), p(0)), ["string", "string"]), ["eq-str-empty|param,param|string@top"]);
  assert.deepEqual(ternaryShapesOf(iff(eqC(0, int(1)), lit(""), lit("s")), ["number"]), ["eq-num-const|lit,lit|string@top"]);
  assert.deepEqual(ternaryShapesOf(iff(eqC(0, lit("1")), lit(""), lit("s")), ["string"]), ["eq-str-const|lit,lit|string@top"]);
  // The same if on top and inside a concat are different keys.
  assert.deepEqual(ternaryShapesOf(cat(p(0), PLURAL.make(0)), ["number"]), ["eq-num-const|lit,lit|string@concat"]);
});

test("ternary keys: 10 distinct plural-only entries unlock none of Auditor's cases; 10 distinct same-key entries unlock each", () => {
  const plural = fakes(PLURAL, DERIVE_FORM_BAR);
  const pc = evidenceTernaryShapeCounts(file(plural));
  assert.deepEqual(pc, { [PLURAL.keys[0]]: DERIVE_FORM_BAR }, "10 distinct plural entries");
  assert.deepEqual(unevidencedForms(PLURAL.make(0), ALL, PLURAL.types, pc), [], "they unlock the plural shape itself");
  for (const c of CASES) {
    assert.deepEqual(unevidencedForms(c.make(0), ALL, c.types, pc), ["ternary"], `plural-only fakes must not unlock ${c.name}`);
    const own = evidenceTernaryShapeCounts(file([...plural, ...fakes(c, DERIVE_FORM_BAR)]));
    for (const key of c.keys) assert.equal(own[key], DERIVE_FORM_BAR, `${c.name}: ${key}`);
    assert.deepEqual(unevidencedForms(c.make(0), ALL, c.types, own), [], `10 distinct same-key fakes unlock ${c.name}`);
    const short = evidenceTernaryShapeCounts(file([...plural, ...fakes(c, DERIVE_FORM_BAR - 1)]));
    assert.deepEqual(unevidencedForms(c.make(0), ALL, c.types, short), ["ternary"], `9 are not enough for ${c.name}`);
  }
  // Nested: evidence for only one of the two ifs is not enough (each needs its own).
  const nest = CASES[2];
  for (const key of nest.keys) assert.deepEqual(unevidencedForms(nest.make(0), ALL, nest.types, { [key]: DERIVE_FORM_BAR }), ["ternary"], key);
  // Two ifs in a concat: top-level plural evidence (same guard and branches, other place) does not count.
  const two = CASES[3];
  assert.deepEqual(unevidencedForms(two.make(0), ALL, two.types, { [PLURAL.keys[0]]: 99 }), ["ternary"]);
});

test("ternary keys end to end: deriveProgram refuses (s === \"\") ? t : s with plural-only evidence and emits it with its own", () => {
  const EV = JSON.parse(readFileSync(resolve(root, "peaceai/rules/proposals/m99-derive-from-behavior-evidence.json"), "utf8")) as { examples: unknown[] };
  const params = [{ name: "value", type: "string" }, { name: "fallback", type: "string" }];
  const examples = [[["", "a"], "a"], [["a", "ab"], "a"], [["ab", "Hello"], "ab"], [["Hello", ""], "Hello"], [[" Ab 9. ", "a"], " Ab 9. "], [["", " Ab 9. "], " Ab 9. "]].map(([args, out]) => ({ args, out }));
  const dir = mkdtempSync(join(tmpdir(), "m104-keys-"));
  try {
    mkdirSync(join(dir, "peaceai/lib"), { recursive: true });
    mkdirSync(join(dir, "peaceai/rules/proposals"), { recursive: true });
    symlinkSync(resolve(root, "node_modules"), join(dir, "node_modules"));
    writeFileSync(join(dir, "peaceai/lib/derive.ts"), readFileSync(resolve(root, "peaceai/lib/derive.ts"), "utf8"));
    writeFileSync(join(dir, "probe.ts"), `import { deriveProgram } from "./peaceai/lib/derive.ts";\nprocess.stdout.write(JSON.stringify(deriveProgram(${JSON.stringify({ params, ret: "string", examples })})));\n`);
    const probe = (extra: unknown[]) => {
      writeFileSync(join(dir, "peaceai/rules/proposals/m99-derive-from-behavior-evidence.json"), JSON.stringify({ ...EV, examples: [...EV.examples, ...extra] }));
      const out = spawnSync(process.execPath, [resolve(root, "node_modules/tsx/dist/cli.mjs"), "probe.ts"], { cwd: dir, encoding: "utf8" });
      assert.equal(out.status, 0, out.stderr);
      return JSON.parse(out.stdout) as { ok: boolean; reason?: string; forms?: string[]; detail?: string; fit?: { expr: string } };
    };
    const plural = fakes(PLURAL, DERIVE_FORM_BAR);
    const r = probe(plural);
    assert.equal(r.ok, false, JSON.stringify(r).slice(0, 300));
    assert.equal(r.reason, "derive_unevidenced_form");
    assert.deepEqual(r.forms, ["ternary"]);
    assert.match(r.detail!, /but the if key eq-str-empty\|param,param\|string@top has 0 distinct ones\)/);
    const ok = probe([...plural, ...fakes(CASES[0], DERIVE_FORM_BAR)]);
    assert.equal(ok.ok, true, JSON.stringify(ok).slice(0, 300));
    assert.equal(ok.fit!.expr, '(value === "") ? fallback : value');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
