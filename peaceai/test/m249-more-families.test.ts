// Combinations, percentile, whole-string case, and an undefined-skipping sum.
// The admitting cases are toss/es-toolkit at
// 24e7a7b8cb8035fae1ea2e7b507aab96698a38b9. Median stays out because those
// calls are also the mean. A passing log does not build a plan.
// Published modules run inside the practice sandbox.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import ts from "typescript";
import { practiceSandboxReady, runInPracticeSandbox, visibleNodeBin } from "../lib/practicemine.ts";
import { gradeBehavior } from "../lib/specgrade.ts";
import { scaffoldPlan } from "../lib/testspec.ts";

const PATTERN = "^src/.+\\.ts$";
const root = resolve(import.meta.dirname, "../..");
const fixture = resolve(import.meta.dirname, "fixtures/m249");
const COMMIT = "24e7a7b8cb8035fae1ea2e7b507aab96698a38b9";
const pins = JSON.parse(readFileSync(resolve(import.meta.dirname, "m249-pins.json"), "utf8")) as { path: string; sha256: string; fixture: string }[];

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function pinned(rel: string): string {
  return readFileSync(join(fixture, `${rel}.txt`), "utf8");
}

const SHIM = [
  "function same(left, right) {",
  "  if (Object.is(left, right)) return true;",
  "  if (Array.isArray(left) && Array.isArray(right) && left.length === right.length) return left.every((item, i) => same(item, right[i]));",
  "  if (left && right && typeof left === 'object' && typeof right === 'object') {",
  "    const keys = Object.keys(left);",
  "    return keys.length === Object.keys(right).length && keys.every((key) => same(left[key], right[key]));",
  "  }",
  "  return false;",
  "}",
  "export function expect(actual) {",
  "  const api = {",
  "    toBe(expected) { if (!Object.is(actual, expected)) throw new Error(String(actual) + ' !== ' + String(expected)); return api; },",
  "    toEqual(expected) { if (!same(actual, expected)) throw new Error('not equal'); return api; },",
  "    toStrictEqual(expected) { if (!same(actual, expected)) throw new Error('not strict'); return api; },",
  "    toBeNaN() { if (!Number.isNaN(actual)) throw new Error('not nan'); return api; },",
  "    toHaveLength(expected) { if (!actual || actual.length !== expected) throw new Error('bad length'); return api; },",
  "    toBeCloseTo(expected, precision = 2) { if (!(Math.abs(actual - expected) < 0.5 * (10 ** -precision))) throw new Error('not close'); return api; },",
  "    toThrow(expected) {",
  "      let err;",
  "      try { actual(); } catch (e) { err = e; }",
  "      if (!err) throw new Error('did not throw');",
  "      if (typeof expected === 'string' && !String(err.message).includes(expected)) throw new Error(err.message);",
  "      return api;",
  "    },",
  "    toThrowErrorMatchingInlineSnapshot() {",
  "      let thrown = false;",
  "      try { actual(); } catch { thrown = true; }",
  "      if (!thrown) throw new Error('did not throw');",
  "      return api;",
  "    },",
  "  };",
  "  return api;",
  "}",
  "export function test(_name, fn) { fn(); }",
  "export function it(_name, fn) { fn(); }",
  "export function describe(_name, fn) { fn(); }",
  "",
].join("\n");

function transpile(rel: string, text: string): string {
  const depth = rel.split("/").length - 1;
  const shim = `${"../".repeat(depth)}shim.mjs`;
  return ts.transpileModule(text, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    fileName: rel,
  }).outputText
    .replaceAll("from 'vitest'", `from '${shim}'`)
    .replaceAll('from "vitest"', `from "${shim}"`)
    .replace(/from (['"])(\.[^'"]+?)(?:\.ts)?\1/g, (_m, q: string, spec: string) => spec.endsWith(".mjs") ? `from ${q}${spec}${q}` : `from ${q}${spec}.mjs${q}`);
}

function runBoxed(files: Record<string, string>, entry: string): { code: number | null; stdout: string } {
  const node = visibleNodeBin();
  assert.ok(node, "visible node");
  const dir = mkdtempSync(join(tmpdir(), "peaceai-m249-"));
  try {
    for (const [name, text] of Object.entries(files)) {
      const path = join(dir, name);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, text);
    }
    const ran = runInPracticeSandbox(dir, [node!, entry], 20_000, { capture: true, nodePath: node });
    assert.equal(ran.unsafe, false, ran.stdout);
    return { code: ran.code, stdout: ran.stdout };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function tree(): Record<string, string> {
  const files: Record<string, string> = { "shim.mjs": SHIM };
  for (const row of pins) {
    if (!row.path.endsWith(".ts")) continue;
    files[row.path.replace(/\.ts$/, ".mjs")] = transpile(row.path, pinned(row.path));
  }
  return files;
}

function admit(specFile: string, spec: string, moduleFile: string) {
  return scaffoldPlan(specFile, spec, `Cannot find module '/work/${moduleFile}'`, PATTERN, [], () => null);
}

test("the m249 pins match the copied bytes", () => {
  assert.equal(pins.length >= 6, true);
  for (const row of pins) assert.equal(sha256(pinned(row.path)), row.sha256, row.path);
  assert.equal(COMMIT.length, 40);
});

test("toss/es-toolkit combinations, percentile, case, and sum are admitted", (t) => {
  if (!practiceSandboxReady()) { t.skip("bwrap is not installed on this host"); return; }
  const cases = [
    { spec: "array/combinations.spec.ts", source: "array/combinations.ts", symbol: "combinations", shape: "combo", body: "r must be a non-negative integer" },
    { spec: "math/percentile.spec.ts", source: "math/percentile.ts", symbol: "percentile", shape: "pct", body: "Expected percentile to be a number" },
    { spec: "compat/string/toUpper.spec.ts", source: "compat/string/toUpper.ts", symbol: "toUpper", shape: "toupr", body: ".toUpperCase()" },
    { spec: "compat/string/toLower.spec.ts", source: "compat/string/toLower.ts", symbol: "toLower", shape: "tolow", body: ".toLowerCase()" },
    { spec: "compat/math/sum.spec.ts", source: "compat/math/sum.ts", symbol: "sum", shape: "csum", body: "current === undefined" },
  ];
  const base = tree();
  for (const row of cases) {
    const spec = pinned(row.spec);
    const source = pinned(row.source);
    const entry = row.spec.replace(/\.ts$/, ".mjs");
    const impl = row.source.replace(/\.ts$/, ".mjs");
    const missing = `export function ${row.symbol}(..._args) {\n  throw new Error("missing");\n}\n`;
    const before = runBoxed({ ...base, [impl]: missing }, entry);
    assert.notEqual(before.code, 0, row.symbol);
    const after = runBoxed({ ...base, [impl]: transpile(row.source, source) }, entry);
    assert.equal(after.code, 0, `${row.symbol}\n${after.stdout}`);
    const plan = admit(`src/${row.spec}`, spec, `src/${row.source}`);
    assert.equal(plan?.ok, true, row.symbol);
    if (!plan?.ok) continue;
    assert.equal(plan.fit.shape, row.shape, row.symbol);
    assert.ok(plan.files[0]!.content.includes(row.body), row.symbol);
    const built = runBoxed({ ...base, [impl]: transpile(row.source, plan.files[0]!.content) }, entry);
    assert.equal(built.code, 0, `${row.symbol} scaffold\n${built.stdout}`);
  }
  const quiet = "import { quiet } from './quiet';\nexpect(quiet([1, 2], 1)).toEqual([[1], [2]]);\n";
  assert.equal(scaffoldPlan("src/quiet.spec.ts", quiet, "ok\n", PATTERN, [], () => null), null);
});

test("the new shapes stay apart from one another", () => {
  const combo = admit("src/array/combo.spec.ts", [
    "import { combo } from './combo';",
    "expect(combo(['A', 'B', 'C'], 2)).toEqual([['A', 'B'], ['A', 'C'], ['B', 'C']]);",
    "expect(combo([1, 2, 3], 0)).toEqual([[]]);",
    "expect(combo([1], 5)).toEqual([]);",
  ].join("\n"), "src/array/combo.ts");
  assert.equal(combo?.ok && combo.fit.shape, "combo");
  const pct = admit("src/math/pct.spec.ts", [
    "import { pct } from './pct';",
    "expect(pct([5, 1, 4, 2, 3], 0)).toBe(1);",
    "expect(pct([5, 1, 4, 2, 3], 100)).toBe(5);",
    "expect(pct([NaN, 1, 100], 75)).toBe(100);",
  ].join("\n"), "src/math/pct.ts");
  assert.equal(pct?.ok && pct.fit.shape, "pct");
  const upper = admit("src/compat/string/upper.spec.ts", [
    "import { upper } from './upper';",
    "expect(upper('hello   world')).toBe('HELLO   WORLD');",
    "expect(upper('--foo-bar--')).toBe('--FOO-BAR--');",
  ].join("\n"), "src/compat/string/upper.ts");
  assert.equal(upper?.ok && upper.fit.shape, "toupr");
  const lower = admit("src/compat/string/lower.spec.ts", [
    "import { lower } from './lower';",
    "expect(lower('--Foo-Bar--')).toBe('--foo-bar--');",
    "expect(lower('FOO BAR')).toBe('foo bar');",
  ].join("\n"), "src/compat/string/lower.ts");
  assert.equal(lower?.ok && lower.fit.shape, "tolow");
  const sum = admit("src/compat/math/sum.spec.ts", [
    "import { sum } from './sum';",
    "expect(sum([1, undefined])).toBe(1);",
    "expect(sum(['1', '2'])).toBe('12');",
    "expect(sum([1, NaN])).toEqual(NaN);",
  ].join("\n"), "src/compat/math/sum.ts");
  assert.equal(sum?.ok && sum.fit.shape, "csum");
});

const KILLS = [
  { guard: "combo-guard:pair", file: "src/cpair.spec.ts", spec: "import { cpair } from './cpair';\nexpect(cpair('ABCD', 2)).toEqual([['A', 'B'], ['A', 'C'], ['A', 'D'], ['B', 'C'], ['B', 'D'], ['C', 'D']]);\nexpect(cpair('AB', 5)).toEqual([]);\nexpect(cpair('', 0)).toEqual([[]]);\n", body: "function comb" },
  { guard: "combo-guard:rows", file: "src/crows.spec.ts", spec: "import { crows } from './crows';\nexpect(crows(['A', 'B', 'C'], 2)).toEqual([]);\nexpect(crows([1, 2, 3], 0)).toEqual([[]]);\nexpect(crows([1], 5)).toEqual([]);\n", body: "function comb" },
  { guard: "combo-guard:zero", file: "src/czero.spec.ts", spec: "import { czero } from './czero';\nexpect(czero(['A', 'B', 'C'], 2)).toEqual([['A', 'B'], ['A', 'C'], ['B', 'C']]);\nexpect(czero([1], 5)).toEqual([]);\n", body: "function comb" },
  { guard: "combo-guard:over", file: "src/cover.spec.ts", spec: "import { cover } from './cover';\nexpect(cover(['A', 'B', 'C'], 2)).toEqual([['A', 'B'], ['A', 'C'], ['B', 'C']]);\nexpect(cover([1, 2, 3], 0)).toEqual([[]]);\n", body: "function comb" },
  { guard: "combo-guard:pick", file: "src/cpick.spec.ts", spec: "import { cpick } from './cpick';\nexpect(cpick([1, 2, 3], 0)).toEqual([[]]);\nexpect(cpick([1], 5)).toEqual([]);\n", body: "function comb" },
  { guard: "pct-guard:rank", file: "src/prank.spec.ts", spec: "import { prank } from './prank';\nexpect(prank([5, 1, 4, 2, 3], 0)).toBe(9);\nexpect(prank([NaN, 1, 100], 75)).toBe(100);\n", body: "Expected percentile" },
  { guard: "pct-guard:ends", file: "src/pends.spec.ts", spec: "import { pends } from './pends';\nexpect(pends([1, 2, 3, 4, 5], 50)).toBe(3);\nexpect(pends([NaN, 1, 100], 75)).toBe(100);\n", body: "Expected percentile" },
  { guard: "pct-guard:nan", file: "src/pnan.spec.ts", spec: "import { pnan } from './pnan';\nexpect(pnan([5, 1, 4, 2, 3], 0)).toBe(1);\nexpect(pnan([5, 1, 4, 2, 3], 100)).toBe(5);\n", body: "Expected percentile" },
  { guard: "toupr-guard:case", file: "src/tucase.spec.ts", spec: "import { tucase } from './tucase';\nexpect(tucase('hello---')).toBe('hello---');\nexpect(tucase('--foo-bar--')).toBe('--FOO-BAR--');\n", body: ".toUpperCase()" },
  { guard: "toupr-guard:rise", file: "src/turise.spec.ts", spec: "import { turise } from './turise';\nexpect(turise(null)).toBe('');\nexpect(turise('  ')).toBe('  ');\nexpect(turise('---')).toBe('---');\n", body: ".toUpperCase()" },
  { guard: "toupr-guard:mark", file: "src/tumark.spec.ts", spec: "import { tumark } from './tumark';\nexpect(tumark('foo')).toBe('FOO');\nexpect(tumark('bar')).toBe('BAR');\n", body: ".toUpperCase()" },
  { guard: "tolow-guard:case", file: "src/tlcase.spec.ts", spec: "import { tlcase } from './tlcase';\nexpect(tlcase('HELLO---')).toBe('HELLO---');\nexpect(tlcase('--FOO-BAR--')).toBe('--foo-bar--');\n", body: ".toLowerCase()" },
  { guard: "tolow-guard:sink", file: "src/tlsink.spec.ts", spec: "import { tlsink } from './tlsink';\nexpect(tlsink(null)).toBe('');\nexpect(tlsink('  ')).toBe('  ');\nexpect(tlsink('---')).toBe('---');\n", body: ".toLowerCase()" },
  { guard: "tolow-guard:mark", file: "src/tlmark.spec.ts", spec: "import { tlmark } from './tlmark';\nexpect(tlmark('FOO')).toBe('foo');\nexpect(tlmark('BAR')).toBe('bar');\n", body: ".toLowerCase()" },
  { guard: "csum-guard:lists", file: "src/clists.spec.ts", spec: "import { clists } from './clists';\nexpect(clists({ 0: undefined, 1: 'a', length: 2 })).toBe('a');\nexpect(clists({ 0: '1', 1: '2', length: 2 })).toBe('12');\n", body: "current === undefined" },
  { guard: "csum-guard:total", file: "src/ctotal.spec.ts", spec: "import { ctotal } from './ctotal';\nexpect(ctotal([1, undefined])).toBe(9);\nexpect(ctotal(['1', '2'])).toBe('12');\n", body: "current === undefined" },
  { guard: "csum-guard:skip", file: "src/cskip.spec.ts", spec: "import { cskip } from './cskip';\nexpect(cskip([1, 2, 3])).toBe(6);\nexpect(cskip(['1', '2'])).toBe('12');\n", body: "current === undefined" },
  { guard: "csum-guard:text", file: "src/ctext.spec.ts", spec: "import { ctext } from './ctext';\nexpect(ctext([1, undefined])).toBe(1);\nexpect(ctext([4, 5])).toBe(9);\n", body: "current === undefined" },
];

test("a near-miss each new guard names is refused", () => {
  for (const row of KILLS) {
    const plan = admit(row.file, row.spec, row.file.replace(/\.spec\.ts$/, ".ts"));
    assert.equal(plan?.ok, false, row.guard);
  }
});

const base = resolve(root, "peaceai/test/.m249-mutants");
mkdirSync(base, { recursive: true });
let n = 0;
async function mutant(guard: string) {
  const text = readFileSync(resolve(root, "peaceai/lib/testspec.ts"), "utf8");
  const lines = text.split("\n");
  const hits = lines.flatMap((line, i) => (line.includes(`// ${guard}`) ? [i] : []));
  assert.equal(hits.length, 1, guard);
  const next = lines.filter((_, i) => i !== hits[0]).join("\n").replace(/from "\.\/([A-Za-z0-9-]+\.ts)"/g, (_m, file: string) => `from ${JSON.stringify(pathToFileURL(resolve(root, "peaceai/lib", file)).href)}`);
  const file = join(base, `mutant-${n++}.ts`);
  writeFileSync(file, next);
  return import(`${pathToFileURL(file).href}?m=${n}`);
}

test("deleting a more-family guard admits the case it refused", async () => {
  try {
    for (const row of KILLS) {
      const mod = await mutant(row.guard) as typeof import("../lib/testspec.ts");
      const plan = mod.scaffoldPlan(row.file, row.spec, `Cannot find module '/work/${row.file.replace(/\.spec\.ts$/, ".ts")}'`, PATTERN, [], () => null);
      assert.equal(plan?.ok, true, row.guard);
      if (plan?.ok) assert.ok(plan.files[0]!.content.includes(row.body), row.guard);
    }
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("the scaffold matches the published function on NaN, undefined, -0, empty, holes, and out of range", (t) => {
  if (!practiceSandboxReady()) { t.skip("bwrap is not installed on this host"); return; }
  const files = tree();
  const script = [
    "import { combinations } from './array/combinations.mjs';",
    "import { percentile } from './math/percentile.mjs';",
    "import { toUpper } from './compat/string/toUpper.mjs';",
    "import { toLower } from './compat/string/toLower.mjs';",
    "import { sum } from './compat/math/sum.mjs';",
    "const comb = (a, b) => ((function comb(arr, r) { if (!Number.isInteger(r) || r < 0) throw new Error('r must be a non-negative integer.'); const items = Array.from(arr); if (r > items.length) return []; if (r === 0) return [[]]; return items.flatMap((item, i) => comb(items.slice(i + 1), r - 1).map((rest) => [item].concat(rest))); })(a, b));",
    "const pct = (a, p) => { if (Number.isNaN(Number(p))) throw new Error('Expected percentile to be a number but got \"' + p + '\".'); if (p < 0) throw new Error('Expected percentile to be >= 0 but got \"' + p + '\".'); if (p > 100) throw new Error('Expected percentile to be <= 100 but got \"' + p + '\".'); if (a.length === 0) return NaN; const sorted = a.slice().sort((x, y) => (Number.isNaN(x) ? -Infinity : x) - (Number.isNaN(y) ? -Infinity : y)); return p === 0 ? sorted[0] : sorted[Math.ceil(sorted.length * (p / 100)) - 1]; };",
    "const base = function base(value) { if (typeof value === 'string') return value; if (Array.isArray(value)) { let result = ''; for (let i = 0; i < value.length; i++) { if (i > 0) result += ','; result += base(value[i]); } return result; } if (typeof value === 'symbol' || value instanceof Symbol) return value.toString(); const result = value + ''; return result === '0' && Object.is(Number(value), -0) ? '-0' : result; };",
    "const up = (a) => a == null ? '' : base(a).toUpperCase();",
    "const low = (a) => a == null ? '' : base(a).toLowerCase();",
    "const csum = (a) => (!a || !a.length) ? 0 : Array.from(a).reduce((result, current) => current === undefined ? result : result === undefined ? current : result + current, undefined);",
    "function same(l, r) {",
    "  if (Object.is(l, r)) return true;",
    "  if (Array.isArray(l) && Array.isArray(r)) return l.length === r.length && l.every((item, i) => same(item, r[i]));",
    "  return false;",
    "}",
    "let bad = 0; let seen = 0;",
    "const check = (name, pub, got) => { seen++; if (!same(pub, got)) { bad++; if (bad < 8) console.log('FAIL', name, pub, got); } };",
    "const checkThrow = (name, pub, ours) => { let pe, oe; try { pub(); } catch (e) { pe = e; } try { ours(); } catch (e) { oe = e; } seen++; if (!pe || !oe || pe.name !== oe.name || pe.message !== oe.message) { bad++; console.log('THROW', name, pe && pe.message, oe && oe.message); } };",
    "const hole = [1,,2];",
    "for (const [a, r] of [[['A','B','C','D'], 2], [[0,1,2,3], 3], [[1,2,3], 0], [[], 0], [[1,2], 5], [[1,2,3], 3], [['a','b','c'], 1], [[1,1,2], 2], [hole, 2], ['abc', 2]]) check('combo', combinations(a, r), comb(a, r));",
    "for (const r of [-1, 1.5, NaN, Infinity]) checkThrow('combo ' + r, () => combinations([1, 2, 3], r), () => comb([1, 2, 3], r));",
    "for (const [a, p] of [[[5,1,4,2,3], 0], [[5,1,4,2,3], 100], [[1,2,3,4,5], 50], [[-1,-2,-3,-4,-5], 50], [[NaN,NaN,1,100], 75], [[], 50], [hole, 50]]) check('pct', percentile(a, p), pct(a, p));",
    "for (const p of [NaN, -1, 101, Infinity]) checkThrow('pct ' + p, () => percentile([1, 2, 3], p), () => pct([1, 2, 3], p));",
    "const values = [null, undefined, '', 'aba', 'ABA', 'café', -0, 0, NaN, Infinity, [1, 2, 3], ['a', 'b'], hole, [], Symbol('test'), { toString() { return 'custom'; } }, {}];",
    "for (const value of values) { check('up', toUpper(value), up(value)); check('low', toLower(value), low(value)); }",
    "for (const value of [[6, 4, 2], [1, undefined], [undefined, 1, 2, 3], [1, NaN], ['1', '2'], [], null, undefined, [undefined], hole, '12', 1]) check('sum', sum(value), csum(value));",
    "if (bad) { console.log('mismatches', bad, 'of', seen); process.exit(1); }",
    "console.log('grid', seen);",
    "",
  ].join("\n");
  const ran = runBoxed({ ...files, "grid.mjs": script }, "grid.mjs");
  assert.equal(ran.code, 0, ran.stdout);
  assert.match(ran.stdout, /grid \d+/);
});

test("a near-miss that the published calls accept is verified_test_only", (t) => {
  if (!practiceSandboxReady()) { t.skip("bwrap is not installed on this host"); return; }
  const nodePath = visibleNodeBin();
  if (!nodePath) { t.skip("no visible node"); return; }
  const copy = (dir: string, rel: string) => {
    const path = join(dir, "src", rel);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, pinned(rel));
  };
  const rows = [
    {
      symbol: "combinations", file: "src/array/combinations.ts",
      candidate: "export function combinations<T>(a: readonly T[], b: number): T[][] {\n  if (!Number.isInteger(b) || b < 0) throw new Error('r must be a non-negative integer.');\n  if (b === 0) return [];\n  return [[...a]];\n}\n",
      args: [[["A", "B", "C", "D"], 2], [[1, 2, 3], 0]],
      deps: [] as string[],
    },
    {
      symbol: "percentile", file: "src/math/percentile.ts",
      candidate: "export function percentile(a: readonly number[], b: number): number {\n  const sorted = a.slice().sort((x, y) => x - y);\n  return sorted[Math.floor(sorted.length * (b / 100))];\n}\n",
      args: [[[5, 1, 4, 2, 3], 100], [[1, 2, 3, 4, 5], 50]],
      deps: [] as string[],
    },
    {
      symbol: "toUpper", file: "src/compat/string/toUpper.ts",
      candidate: "export function toUpper(a: string): string { return a.toUpperCase(); }\n",
      args: [["hello   world"], [null]],
      deps: ["compat/util/toString.ts", "compat/_internal/baseToString.ts", "compat/predicate/isSymbol.ts"],
    },
    {
      symbol: "toLower", file: "src/compat/string/toLower.ts",
      candidate: "export function toLower(a: string): string { return a.toLowerCase(); }\n",
      args: [["--Foo-Bar--"], [null]],
      deps: ["compat/util/toString.ts", "compat/_internal/baseToString.ts", "compat/predicate/isSymbol.ts"],
    },
    {
      symbol: "sum", file: "src/compat/math/sum.ts",
      candidate: "export function sum(a: readonly unknown[]): unknown {\n  return Array.from(a ?? []).reduce((total, item) => (total as number) + (item as number), 0);\n}\n",
      args: [[[1, undefined]], [["1", "2"]]],
      deps: pins.map((row) => row.path).filter((path) => path.endsWith(".ts") && !path.endsWith(".spec.ts") && path !== "compat/math/sum.ts"),
    },
  ];
  const trees: string[] = [];
  try {
    for (const row of rows) {
      const make = (text: string) => {
        const dir = mkdtempSync(join(tmpdir(), "peaceai-m249-grade-"));
        mkdirSync(join(dir, row.file, ".."), { recursive: true });
        writeFileSync(join(dir, row.file), text);
        for (const dep of row.deps) copy(dir, dep);
        trees.push(dir);
        return dir;
      };
      const grade = gradeBehavior({
        candidateRoot: make(row.candidate), fixRoot: make(pinned(row.file.slice("src/".length))), nodePath,
        target: { symbol: row.symbol, file: row.file, form: "named", exportName: row.symbol, args: row.args },
      });
      assert.equal(grade.behavior, "verified_test_only", `${row.symbol} ${grade.behavior} ${grade.counterexample ? JSON.stringify(grade.counterexample) : ""}`);
      assert.ok(grade.counterexample, row.symbol);
    }
  } finally {
    for (const dir of trees) rmSync(dir, { recursive: true, force: true });
  }
});
