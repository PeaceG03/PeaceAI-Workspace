// M104 (Auditor NOT PASS #498 on b2f0f67, c8ad8ea and 3e6ef9a): a program that contains an if is keyed by its WHOLE
// expression skeleton (ternaryShapesOf): the full AST with every operator and operand order, parameters renamed p0,
// p1, ... by first appearance (listed with type and declared position), literals as <num> / <str> / <empty>. A ternary
// program is emitted only if >= 10 distinct evidence entries share its exact skeleton. One mechanism closes the
// surrounding join, a concat inside a branch, comparison direction, range, sibling ifs and depth. Each case below is
// refused under another case's ten fakes and unlocked by ten of its own (gate level and, batched, end to end).
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DERIVE_FORM_BAR, DERIVE_FORMS, deriveCandidate, evalProgram, evidenceTernaryShapeCounts, ternaryShapesOf, unevidencedForms, type DeriveNode, type DeriveType, type DeriveValue } from "../lib/derive.ts";

const root = resolve(import.meta.dirname, "../..");
const p = (i: number): DeriveNode => ({ op: "param", i });
const lit = (v: string): DeriveNode => ({ op: "lit", v });
const int = (v: number): DeriveNode => ({ op: "int", v });
const eqC = (i: number, b: DeriveNode): DeriveNode => ({ op: "eq", a: p(i), b });
const le = (a: DeriveNode, b: DeriveNode): DeriveNode => ({ op: "le", a, b });
const emp = (i: number): DeriveNode => ({ op: "empty", i });
const sle = (i: number, j: number): DeriveNode => ({ op: "sle", i, j });
const iff = (c: DeriveNode, t: DeriveNode, e: DeriveNode): DeriveNode => ({ op: "if", c, t, e });
const cat = (a: DeriveNode, b: DeriveNode): DeriveNode => ({ op: "cat", a, b });
const sfx = (k: number, s: string) => (k === 0 ? s : `${s}${k}`);

type Case = { name: string; types: DeriveType[]; make: (k: number) => DeriveNode; grid: DeriveValue[][]; key: string };
const S = ["", "x", "ab", "Hello", " Ab 9. "];
const N = [-1, 0, 1, 2, 3, 5, 7];
const pairs = <A, B>(as: A[], bs: B[]) => as.flatMap((a) => bs.map((b) => [a, b] as DeriveValue[]));
const SS = pairs(S, S), SSS = S.flatMap((a) => SS.map((r) => [a, ...r] as DeriveValue[])), NN = pairs(N, N);
const S1 = S.map((x) => [x] as DeriveValue[]), N1 = N.map((n) => [n] as DeriveValue[]);
const STR2: DeriveType[] = ["string", "string"], NUM2: DeriveType[] = ["number", "number"];
// make(0) is the case's program; make(k) varies only a literal (where there is one), so every fake has the same skeleton;
// each fake has its own examples (and expression text).
const C: Record<string, Case> = {
  plural: { name: '(n === 1) ? "" : "s"', types: ["number"], make: (k) => iff(eqC(0, int(1)), lit(""), lit(sfx(k, "s"))), grid: N1, key: "[number@0] if(eq(p0,<num>),<empty>,<str>)" },
  numResult: { name: "(n === 1) ? 0 : 1", types: ["number"], make: (k) => iff(eqC(0, int(1)), int(k), int(k + 100)), grid: N1, key: "[number@0] if(eq(p0,<num>),<num>,<num>)" },
  fallback: { name: '(s === "") ? t : s', types: STR2, make: () => iff(emp(0), p(1), p(0)), grid: SS, key: "[string@0,string@1] if(empty(p0),p1,p0)" },
  strConst: { name: 's === "x" ? t : "y"', types: STR2, make: (k) => iff(eqC(0, lit(sfx(k, "x"))), p(1), lit(sfx(k, "y"))), grid: pairs([...S, "x1", "x2"], S), key: "[string@0,string@1] if(eq(p0,<str>),p1,<str>)" },
  swapped: { name: '(s === "") ? s : t', types: STR2, make: () => iff(emp(0), p(0), p(1)), grid: SS, key: "[string@0,string@1] if(empty(p0),p0,p1)" },
  otherGuard: { name: '(t === "") ? s : t', types: STR2, make: () => iff(emp(1), p(0), p(1)), grid: SS, key: "[string@1,string@0] if(empty(p0),p1,p0)" },
  tu: { name: '(s === "") ? t : u', types: ["string", "string", "string"], make: () => iff(emp(0), p(1), p(2)), grid: SSS, key: "[string@0,string@1,string@2] if(empty(p0),p1,p2)" },
  tt: { name: '(s === "") ? t : t', types: STR2, make: () => iff(emp(0), p(1), p(1)), grid: SS, key: "[string@0,string@1] if(empty(p0),p1,p1)" },
  // The join family (Auditor on 3e6ef9a): ten s + (((s === "") ? s : "/k") + t) fakes.
  join: { name: 's + (((s === "") ? s : "/") + t)', types: STR2, make: (k) => cat(p(0), cat(iff(emp(0), p(0), lit(sfx(k, "/"))), p(1))), grid: SS, key: "[string@0,string@1] cat(p0,cat(if(empty(p0),p0,<str>),p1))" },
  joinOtherGuard: { name: 's + (((t === "") ? s : "/") + t)', types: STR2, make: (k) => cat(p(0), cat(iff(emp(1), p(0), lit(sfx(k, "/"))), p(1))), grid: SS, key: "[string@0,string@1] cat(p0,cat(if(empty(p1),p0,<str>),p1))" },
  joinT1: { name: 't + ((s === "") ? s : "!")', types: STR2, make: (k) => cat(p(1), iff(emp(0), p(0), lit(sfx(k, "!")))), grid: SS, key: "[string@1,string@0] cat(p0,if(empty(p1),p1,<str>))" },
  joinT2: { name: 't + (((s === "") ? s : "/") + t)', types: STR2, make: (k) => cat(p(1), cat(iff(emp(0), p(0), lit(sfx(k, "/"))), p(1))), grid: SS, key: "[string@1,string@0] cat(p0,cat(if(empty(p1),p1,<str>),p0))" },
  joinT3: { name: 't + ((s === "") ? s : "/")', types: STR2, make: (k) => cat(p(1), iff(emp(0), p(0), lit(sfx(k, "/")))), grid: SS, key: "[string@1,string@0] cat(p0,if(empty(p1),p1,<str>))" },
  // Comparison direction against a constant, range, min / max (operand order).
  leN5: { name: "n <= 5 ? n : m", types: NUM2, make: (k) => iff(le(p(0), int(5 + k)), p(0), p(1)), grid: NN, key: "[number@0,number@1] if(le(p0,<num>),p0,p1)" },
  le5N: { name: "5 <= n ? n : m", types: NUM2, make: (k) => iff(le(int(5 + k), p(0)), p(0), p(1)), grid: NN, key: "[number@0,number@1] if(le(<num>,p0),p0,p1)" },
  range: { name: '(1 <= n && n <= 5) ? "in" : "out"', types: ["number"], make: (k) => iff({ op: "range", i: 0, lo: 1, hi: 5 + k }, lit("in"), lit("out")), grid: N1, key: "[number@0] if(range(<num>,p0,<num>),<str>,<str>)" },
  leIn: { name: 'n <= 5 ? "in" : "out"', types: ["number"], make: (k) => iff(le(p(0), int(5 + k)), lit("in"), lit("out")), grid: N1, key: "[number@0] if(le(p0,<num>),<str>,<str>)" },
  min: { name: "(a <= b) ? a : b (strings)", types: STR2, make: () => iff(sle(0, 1), p(0), p(1)), grid: SS, key: "[string@0,string@1] if(sle(p0,p1),p0,p1)" },
  max: { name: "(a <= b) ? b : a (strings)", types: STR2, make: () => iff(sle(0, 1), p(1), p(0)), grid: SS, key: "[string@0,string@1] if(sle(p0,p1),p1,p0)" },
  // Concat inside a branch vs a literal branch.
  concatBranch: { name: '(s === "") ? "-" : s + "!"', types: ["string"], make: (k) => iff(emp(0), lit(sfx(k, "-")), cat(p(0), lit("!"))), grid: S1, key: "[string@0] if(empty(p0),<str>,cat(p0,<str>))" },
  litBranch: { name: '(s === "") ? "-" : "!"', types: ["string"], make: (k) => iff(emp(0), lit(sfx(k, "-")), lit("!")), grid: S1, key: "[string@0] if(empty(p0),<str>,<str>)" },
  // "" vs a non-empty string literal.
  nonEmpty: { name: '(n === 1) ? "-" : "s"', types: ["number"], make: (k) => iff(eqC(0, int(1)), lit(sfx(k, "-")), lit(sfx(k, "s"))), grid: N1, key: "[number@0] if(eq(p0,<num>),<str>,<str>)" },
  // Sibling ifs and depth.
  inner: { name: '(n === 1) ? "one" : "many"', types: ["number"], make: (k) => iff(eqC(0, int(1)), lit(sfx(k, "one")), lit("many")), grid: N1, key: "[number@0] if(eq(p0,<num>),<str>,<str>)" },
  nested: { name: '(n === 0) ? "zero" : ((n === 1) ? "one" : "many")', types: ["number"], make: (k) => iff(eqC(0, int(0)), lit(sfx(k, "zero")), iff(eqC(0, int(1)), lit("one"), lit("many"))), grid: N1, key: "[number@0] if(eq(p0,<num>),<str>,if(eq(p0,<num>),<str>,<str>))" },
  depth3: { name: "three ifs deep", types: ["number"], make: (k) => iff(eqC(0, int(0)), lit(sfx(k, "a")), iff(eqC(0, int(1)), lit("b"), iff(eqC(0, int(2)), lit("c"), lit("d")))), grid: N1, key: "[number@0] if(eq(p0,<num>),<str>,if(eq(p0,<num>),<str>,if(eq(p0,<num>),<str>,<str>)))" },
  depth4: { name: "four ifs deep", types: ["number"], make: (k) => iff(eqC(0, int(0)), lit(sfx(k, "a")), iff(eqC(0, int(1)), lit("b"), iff(eqC(0, int(2)), lit("c"), iff(eqC(0, int(3)), lit("d"), lit("e"))))), grid: N1, key: "[number@0] if(eq(p0,<num>),<str>,if(eq(p0,<num>),<str>,if(eq(p0,<num>),<str>,if(eq(p0,<num>),<str>,<str>))))" },
  oneInCat: { name: '"n" + ((n === 1) ? "" : "s")', types: ["number"], make: (k) => cat(lit(sfx(k, "n")), iff(eqC(0, int(1)), lit(""), lit("s"))), grid: N1, key: "[number@0] cat(<str>,if(eq(p0,<num>),<empty>,<str>))" },
  twoInCat: { name: '((n === 1) ? "" : "s") + ((m === 1) ? "" : "es")', types: NUM2, make: (k) => cat(iff(eqC(0, int(1)), lit(""), lit(sfx(k, "s"))), iff(eqC(1, int(1)), lit(""), lit("es"))), grid: NN, key: "[number@0,number@1] cat(if(eq(p0,<num>),<empty>,<str>),if(eq(p1,<num>),<empty>,<str>))" },
  twoInCatSame: { name: '((n === 1) ? "" : "s") + ((n === 2) ? "" : "es")', types: ["number"], make: (k) => cat(iff(eqC(0, int(1)), lit(""), lit(sfx(k, "s"))), iff(eqC(0, int(2)), lit(""), lit("es"))), grid: N1, key: "[number@0] cat(if(eq(p0,<num>),<empty>,<str>),if(eq(p0,<num>),<empty>,<str>))" },
};
const NAMES = ["s", "t", "u"];

// One fake upstream entry: the program's recorded skeleton, its own expression text, examples from evaluating it.
const fake = (c: Case, k: number, salt = 0) => {
  const prog = c.make(k);
  const rows = c.grid.slice(0, c.grid.length - (k % 3)).map((args) => ({ args, out: evalProgram(prog, args) }));
  if (salt) rows.push({ args: c.grid[salt % c.grid.length], out: evalProgram(prog, c.grid[salt % c.grid.length]) });
  return { repo: `fake/${k}`, fn: `f${k}`, params: c.types.map((type, i) => ({ name: NAMES[i] ?? `p${i}`, type })), expr: `${JSON.stringify(prog)} /*${k}*/`, examples: rows, forms: ["ternary"], ternaryShapes: ternaryShapesOf(prog, c.types) };
};
const fakes = (c: Case, n: number) => Array.from({ length: n }, (_, k) => fake(c, k + 1, k));
const file = (es: unknown[]) => JSON.stringify({ examples: es });
const ALL = Object.fromEntries(DERIVE_FORMS.map((f) => [f, DERIVE_FORM_BAR])) as Parameters<typeof unevidencedForms>[1];
// `c` is refused under ten of `base`'s fakes (which do unlock `base`), and unlocked by ten of its own (not by nine).
const refuses = (c: Case, base: Case, why: string) => {
  const counts = evidenceTernaryShapeCounts(file(fakes(base, DERIVE_FORM_BAR)));
  assert.deepEqual(unevidencedForms(base.make(0), ALL, base.types, counts), [], `${base.name} fakes unlock ${base.name}`);
  assert.deepEqual(unevidencedForms(c.make(0), ALL, c.types, counts), ["ternary"], `${why}: ${c.name} under ${base.name} fakes`);
  assert.deepEqual(unevidencedForms(c.make(0), ALL, c.types, evidenceTernaryShapeCounts(file(fakes(c, DERIVE_FORM_BAR)))), [], `10 of its own skeleton unlock ${c.name}`);
  assert.deepEqual(unevidencedForms(c.make(0), ALL, c.types, evidenceTernaryShapeCounts(file(fakes(c, DERIVE_FORM_BAR - 1)))), ["ternary"], `9 are not enough for ${c.name}`);
};
const both = (a: Case, b: Case, why: string) => { refuses(a, b, why); refuses(b, a, why); };

test("skeletons: every case's key is its whole AST (operators, operand order, parameters by first appearance with type and position, <num> / <str> / <empty>)", () => {
  for (const c of Object.values(C)) assert.deepEqual(ternaryShapesOf(c.make(0), c.types), [c.key], c.name);
  // Literal values and parameter names do not matter; a program without an if has no key.
  assert.deepEqual(ternaryShapesOf(C.join.make(7), STR2), [C.join.key]);
  assert.deepEqual(ternaryShapesOf(cat(p(0), lit("x")), ["string"]), []);
  assert.deepEqual(ternaryShapesOf(C.fallback.make(0)), ["[unknown@0,unknown@1] if(empty(p0),p1,p0)"], "untyped parameters are unknown (never covered)");
});

test("skeletons: Auditor's earlier cases (plural-only fakes; (p0 === \"\") ? p1 : p0 fakes) still refuse; each unlocks with its own", () => {
  for (const c of [C.fallback, C.strConst, C.nested, C.twoInCat]) refuses(c, C.plural, "plural-only fakes must not unlock");
  for (const c of [C.swapped, C.otherGuard, C.tu, C.tt]) refuses(c, C.fallback, 'ten (p0 === "") ? p1 : p0 entries must not unlock');
  both(C.tu, C.tt, "t : u and t : t");
  both(C.concatBranch, C.litBranch, "a concat branch is not a literal");
  both(C.numResult, C.plural, "number and string results");
  both(C.plural, C.nonEmpty, '"" is not a non-empty string');
});

test("skeletons (Auditor #498 on 3e6ef9a): the surrounding join, comparison direction, range, min / max, sibling ifs and depth", () => {
  for (const c of [C.joinT1, C.joinT2, C.joinT3, C.joinOtherGuard]) refuses(c, C.join, "ten s + ((s === \"\") ? s : \"/k\") + t entries must not unlock");
  both(C.leN5, C.le5N, "comparison direction against a constant");
  both(C.range, C.leIn, "range is not a single comparison");
  both(C.min, C.max, "min and max (operand order of the branches)");
  both(C.nested, C.inner, "a nested chain and its inner if");
  both(C.depth3, C.depth4, "depth 3 and depth 4");
  both(C.oneInCat, C.plural, "an if inside a join and the same if alone");
  both(C.twoInCat, C.twoInCatSame, "sibling ifs on two parameters and on one");
  both(C.twoInCat, C.oneInCat, "two ifs in a join and one");
});

// The child processes get a minimal environment (PATH and a scratch HOME only).
const childEnv = (home: string) => ({ PATH: process.env.PATH ?? "", HOME: home });
const EV = () => JSON.parse(readFileSync(resolve(root, "peaceai/rules/proposals/m99-derive-from-behavior-evidence.json"), "utf8")) as { examples: unknown[] };
const rows = (f: (a: string[]) => string, args: string[][]) => args.map((a) => ({ args: a, out: f(a) }));
const SEVEN = [["", ""], ["", " Ab 9. "], ["a", "Hello"], ["ab", "ab"], ["Hello", "a"], [" Ab 9. ", ""], [" Ab 9. ", " Ab 9. "]];
const ORDER: [string, string][] = [["a", "b"], ["b", "a"], ["abc", "abd"], ["x", "x"], ["hello", "help"], ["zz", "z"], ["m", "m"], ["10", "9"], ["a", "B"], ["b", "aa"], ["ac", "ab"], ["", "a"], [" Ab 9. ", "a"], ["a", " Ab 9. "], ["Zz 9", "a"], ["a", "a"], ["", ""], ["b", "b"]];
const P2 = [{ name: "s", type: "string" }, { name: "t", type: "string" }];
const P3 = [...P2, { name: "u", type: "string" }];
const AB = [{ name: "a", type: "string" }, { name: "b", type: "string" }];
type Spec = { expr: string; key: string; params: { name: string; type: string }[]; ret: string; examples: { args: unknown[]; out: unknown }[] };
const spec = (c: Case, expr: string, params: Spec["params"], examples: Spec["examples"]): Spec => ({ expr, key: c.key, params, ret: "string", examples });
const VALUE_FALLBACK: Spec = spec(C.fallback, '(value === "") ? fallback : value', [{ name: "value", type: "string" }, { name: "fallback", type: "string" }], rows(([v, f]) => (v === "" ? f : v), [["", "a"], ["a", "ab"], ["ab", "Hello"], ["Hello", ""], [" Ab 9. ", "a"], ["", " Ab 9. "]]));

test("skeletons end to end: deriveProgram refuses (s === \"\") ? t : s with plural-only evidence and emits it with its own", () => {
  const dir = mkdtempSync(join(tmpdir(), "m104-keys-"));
  try {
    mkdirSync(join(dir, "peaceai/lib"), { recursive: true });
    mkdirSync(join(dir, "peaceai/rules/proposals"), { recursive: true });
    symlinkSync(resolve(root, "node_modules"), join(dir, "node_modules"));
    writeFileSync(join(dir, "peaceai/lib/derive.ts"), readFileSync(resolve(root, "peaceai/lib/derive.ts"), "utf8"));
    writeFileSync(join(dir, "probe.ts"), `import { deriveProgram } from "./peaceai/lib/derive.ts";\nprocess.stdout.write(JSON.stringify(deriveProgram(${JSON.stringify(VALUE_FALLBACK)} as never)));\n`);
    const probe = (extra: unknown[]) => {
      writeFileSync(join(dir, "peaceai/rules/proposals/m99-derive-from-behavior-evidence.json"), JSON.stringify({ ...EV(), examples: [...EV().examples, ...extra] }));
      const out = spawnSync(process.execPath, [resolve(root, "node_modules/tsx/dist/cli.mjs"), "probe.ts"], { cwd: dir, encoding: "utf8", env: childEnv(dir) });
      assert.equal(out.status, 0, out.stderr);
      return JSON.parse(out.stdout) as { ok: boolean; reason?: string; forms?: string[]; detail?: string; fit?: { expr: string } };
    };
    const plural = fakes(C.plural, DERIVE_FORM_BAR);
    const r = probe(plural);
    assert.equal(r.ok, false, JSON.stringify(r).slice(0, 300));
    assert.equal(r.reason, "derive_unevidenced_form");
    assert.deepEqual(r.forms, ["ternary"]);
    assert.ok(r.detail!.includes(`but the program skeleton ${C.fallback.key} has 0 distinct ones)`), r.detail);
    const ok = probe([...plural, ...fakes(C.fallback, DERIVE_FORM_BAR)]);
    assert.equal(ok.ok, true, JSON.stringify(ok).slice(0, 300));
    assert.equal(ok.fit!.expr, VALUE_FALLBACK.expr);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("skeletons end to end (Auditor #498 on c8ad8ea and 3e6ef9a): one child process, two evidence files; each case is refused naming its skeleton, controls are emitted", () => {
  // Evidence A: main + ten (p0 === "") ? p1 : p0, ten s + ((s === "") ? s : "/k") + t, ten string min fakes and ten
  // n <= 5 ? n : m fakes. Evidence B: main + ten string max fakes and ten 5 <= n ? n : m fakes. Each is read by its
  // own copy of derive.ts (its own module, its own cache), both imported by one probe.
  const refusedA: Spec[] = [
    spec(C.swapped, '(s === "") ? s : t', P2, rows(([s, t]) => (s === "" ? s : t), SEVEN)),
    spec(C.otherGuard, '(t === "") ? s : t', P2, rows(([s, t]) => (t === "" ? s : t), SEVEN)),
    spec(C.tu, '(s === "") ? t : u', P3, rows(([s, t, u]) => (s === "" ? t : u), [["", "a", "b"], ["", "Hello", " Ab 9. "], ["", " Ab 9. ", "x"], ["a", "b", "c"], ["ab", " Ab 9. ", "Hello"], ["Hello", "a", " Ab 9. "], [" Ab 9. ", "", ""], ["x", "a", "b"], ["", "", "ab"], [" Ab 9. ", "ab", "a"]])),
    spec(C.joinOtherGuard, 's + (((t === "") ? s : "/") + t)', P2, rows(([s, t]) => s + ((t === "" ? s : "/") + t), SEVEN)),
    spec(C.joinT1, 't + ((s === "") ? s : "!")', P2, rows(([s, t]) => t + (s === "" ? s : "!"), SEVEN)),
    spec(C.joinT2, 't + (((s === "") ? s : "/") + t)', P2, rows(([s, t]) => t + ((s === "" ? s : "/") + t), SEVEN)),
    spec(C.joinT3, 't + ((s === "") ? s : "/")', P2, rows(([s, t]) => t + (s === "" ? s : "/"), SEVEN)),
    spec(C.max, "(a <= b) ? b : a", AB, rows(([a, b]) => (a <= b ? b : a), ORDER)),
  ];
  const controlsA: Spec[] = [VALUE_FALLBACK, spec(C.join, 's + (((s === "") ? s : "/") + t)', P2, rows(([s, t]) => s + ((s === "" ? s : "/") + t), SEVEN)), spec(C.min, "(a <= b) ? a : b", AB, rows(([a, b]) => (a <= b ? a : b), ORDER))];
  const refusedB: Spec[] = [controlsA[2]];
  const controlsB: Spec[] = [refusedA[7]];
  // The search alone fits each (so a refusal is the skeleton gate) to the expected skeleton.
  for (const c of [...refusedA, ...controlsA]) {
    const r = deriveCandidate({ params: c.params as never, ret: "string", examples: c.examples as never });
    assert.ok(r.ok && r.fit.expr === c.expr, `${c.expr}: ${JSON.stringify(r).slice(0, 200)}`);
    assert.deepEqual(ternaryShapesOf(r.fit.program, c.params.map((q) => q.type as DeriveType)), [c.key], c.expr);
  }
  // n <= 5 ? n : m and 5 <= n ? n : m: the search does not build them (no fit / budget), so nothing can emit them; the
  // probe still asks, under the other's fakes (gate level above: they refuse each other).
  const NM = [{ name: "n", type: "number" }, { name: "m", type: "number" }];
  const nm = (f: (n: number, m: number) => number): Spec => ({ expr: "", key: "", params: NM, ret: "number", examples: [[5, 9], [6, 9], [-3, 2], [100, -7], [0, 1], [7, 1], [2, 8]].map(([n, m]) => ({ args: [n, m], out: f(n, m) })) });
  const dir = mkdtempSync(join(tmpdir(), "m104-keys2-"));
  try {
    for (const [sub, extra] of [["a", [...fakes(C.fallback, DERIVE_FORM_BAR), ...fakes(C.join, DERIVE_FORM_BAR), ...fakes(C.min, DERIVE_FORM_BAR), ...fakes(C.leN5, DERIVE_FORM_BAR)]], ["b", [...fakes(C.max, DERIVE_FORM_BAR), ...fakes(C.le5N, DERIVE_FORM_BAR)]]] as const) {
      mkdirSync(join(dir, sub, "peaceai/lib"), { recursive: true });
      mkdirSync(join(dir, sub, "peaceai/rules/proposals"), { recursive: true });
      writeFileSync(join(dir, sub, "peaceai/lib/derive.ts"), readFileSync(resolve(root, "peaceai/lib/derive.ts"), "utf8"));
      writeFileSync(join(dir, sub, "peaceai/rules/proposals/m99-derive-from-behavior-evidence.json"), JSON.stringify({ ...EV(), examples: [...EV().examples, ...extra] }));
    }
    symlinkSync(resolve(root, "node_modules"), join(dir, "node_modules"));
    const strip = (s: Spec) => ({ params: s.params, ret: s.ret, examples: s.examples });
    const A = [...controlsA, ...refusedA, nm((n, m) => (5 <= n ? n : m))].map(strip), B = [...controlsB, ...refusedB, nm((n, m) => (n <= 5 ? n : m))].map(strip);
    writeFileSync(join(dir, "probe.ts"), `import { deriveProgram as a } from "./a/peaceai/lib/derive.ts";\nimport { deriveProgram as b } from "./b/peaceai/lib/derive.ts";\nprocess.stdout.write(JSON.stringify([${JSON.stringify(A)}.map((s) => a(s as never)), ${JSON.stringify(B)}.map((s) => b(s as never))]));\n`);
    const out = spawnSync(process.execPath, [resolve(root, "node_modules/tsx/dist/cli.mjs"), "probe.ts"], { cwd: dir, encoding: "utf8", env: childEnv(dir) });
    assert.equal(out.status, 0, out.stderr);
    type R = { ok: boolean; reason?: string; forms?: string[]; detail?: string; fit?: { expr: string } };
    const [ra, rb] = JSON.parse(out.stdout) as [R[], R[]];
    const check = (got: R[], controls: Spec[], refused: Spec[], side: string) => {
      controls.forEach((c, i) => assert.equal(got[i].ok && got[i].fit!.expr, c.expr, `${side}: control ${c.expr} is emitted: ${JSON.stringify(got[i]).slice(0, 200)}`));
      refused.forEach((c, i) => {
        const r = got[controls.length + i];
        assert.equal(r.ok, false, `${side}: ${c.expr} must not be emitted: ${JSON.stringify(r).slice(0, 200)}`);
        assert.equal(r.reason, "derive_unevidenced_form", c.expr);
        assert.deepEqual(r.forms, ["ternary"], c.expr);
        assert.ok(r.detail!.includes(`but the program skeleton ${c.key} has 0 distinct ones)`), `${side}: ${c.expr}: ${r.detail}`);
      });
      assert.equal(got[controls.length + refused.length].ok, false, `${side}: the n / m comparison is not emitted`);
    };
    check(ra, controlsA, refusedA, "evidence A");
    check(rb, controlsB, refusedB, "evidence B");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
