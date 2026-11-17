// toLength, toKey, and zipObjectDeep. Zip and mean use the published index loop,
// so a Set is not walked by Array.from. A passing log does not build a plan.
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
const fixture = resolve(import.meta.dirname, "fixtures/m250");
const pins = JSON.parse(readFileSync(resolve(import.meta.dirname, "m250-pins.json"), "utf8")) as { path: string; sha256: string; fixture: string }[];

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}
function pinned(rel: string): string {
  return readFileSync(join(fixture, `${rel}.txt`), "utf8");
}

const SHIM = [
  "function same(left, right) {",
  "  if (Object.is(left, right)) return true;",
  "  if (Array.isArray(left) && Array.isArray(right) && left.length === right.length) {",
  "    for (let i = 0; i < left.length; i++) if (!same(left[i], right[i])) return false;",
  "    return true;",
  "  }",
  "  if (left && right && typeof left === 'object' && typeof right === 'object' && !Array.isArray(left) && !Array.isArray(right)) {",
  "    const keys = Reflect.ownKeys(left);",
  "    return keys.length === Reflect.ownKeys(right).length && keys.every((key) => same(left[key], right[key]));",
  "  }",
  "  return false;",
  "}",
  "export function expect(actual) {",
  "  const api = {",
  "    toBe(expected) { if (!Object.is(actual, expected)) throw new Error(String(actual) + ' !== ' + String(expected)); return api; },",
  "    toEqual(expected) { if (!same(actual, expected)) throw new Error('not equal'); return api; },",
  "    toStrictEqual(expected) { if (!same(actual, expected)) throw new Error('not strict'); return api; },",
  "    toBeTruthy() { if (!actual) throw new Error('not truthy'); return api; },",
  "    toBeFalsy() { if (actual) throw new Error('not falsy'); return api; },",
  "    toThrow(err) { let threw; try { actual(); } catch (e) { threw = e; } if (!threw) throw new Error('did not throw'); if (err && !(threw instanceof err)) throw new Error('wrong throw'); return api; },",
  "    not: { toThrow() { try { actual(); } catch (e) { throw new Error('threw'); } return api; }, toBe() { return api; } },",
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
  assert.ok(node);
  const dir = mkdtempSync(join(tmpdir(), "peaceai-m250-"));
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

test("the m250 pins match the copied bytes", () => {
  for (const row of pins) assert.equal(sha256(pinned(row.path)), row.sha256, row.path);
});

test("toss/es-toolkit length, identity, unescape, dedent, and string comparisons are admitted", (t) => {
  if (!practiceSandboxReady()) { t.skip("bwrap is not installed on this host"); return; }
  const cases = [
    { spec: "compat/util/toLength.spec.ts", source: "compat/util/toLength.ts", symbol: "toLength", shape: "tlen", body: "4294967295" },
    { spec: "compat/_internal/toKey.spec.ts", source: "compat/_internal/toKey.ts", symbol: "toKey", shape: "tkey", body: "\"-0\"" },
    { spec: "compat/array/zipObjectDeep.spec.ts", source: "compat/array/zipObjectDeep.ts", symbol: "zipObjectDeep", shape: "zde", body: "like(keys)" },
    { spec: "function/identity.spec.ts", source: "function/identity.ts", symbol: "identity", shape: "idn", body: "return a;" },
    { spec: "compat/function/identity.spec.ts", source: "compat/function/identity.ts", symbol: "identity", shape: "idn", body: "return a;" },
    { spec: "string/unescape.spec.ts", source: "string/unescape.ts", symbol: "unescape", shape: "uesc", body: "&amp;" },
    { spec: "string/dedent.spec.ts", source: "string/dedent.ts", symbol: "dedent", shape: "dden", body: "Invalid opening line" },
    { spec: "compat/util/gt.spec.ts", source: "compat/util/gt.ts", symbol: "gt", shape: "gt", body: "a > b" },
    { spec: "compat/util/lt.spec.ts", source: "compat/util/lt.ts", symbol: "lt", shape: "lt", body: "a < b" },
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
});

const KILLS = [
  { guard: "tlen-guard:fit", file: "src/tfit.spec.ts", spec: "import { tfit } from './tfit';\nexpect(tfit(-1)).toBe(0);\nexpect(tfit('a')).toBe(0);\nexpect(tfit(1.1)).toBe(9);\n", body: "4294967295" },
  { guard: "tlen-guard:neg", file: "src/tneg.spec.ts", spec: "import { tneg } from './tneg';\nexpect(tneg('a')).toBe(0);\nexpect(tneg(1.1)).toBe(1);\nexpect(tneg(3)).toBe(3);\n", body: "4294967295" },
  { guard: "tlen-guard:junk", file: "src/tjunk.spec.ts", spec: "import { tjunk } from './tjunk';\nexpect(tjunk(-1)).toBe(0);\nexpect(tjunk(1.1)).toBe(1);\nexpect(tjunk(3)).toBe(3);\n", body: "4294967295" },
  { guard: "tlen-guard:cut", file: "src/tcut.spec.ts", spec: "import { tcut } from './tcut';\nexpect(tcut(-1)).toBe(0);\nexpect(tcut('a')).toBe(0);\nexpect(tcut(3)).toBe(3);\n", body: "4294967295" },
  { guard: "tkey-guard:fit", file: "src/kfit.spec.ts", spec: "import { kfit } from './kfit';\nexpect(kfit(-0)).toBe('zero');\nexpect(kfit(0)).toBe('0');\n", body: "\"-0\"" },
  { guard: "tkey-guard:sign", file: "src/ksign.spec.ts", spec: "import { ksign } from './ksign';\nexpect(ksign(0)).toBe('0');\nexpect(ksign(1)).toBe('1');\nexpect(ksign(null)).toBe('null');\n", body: "\"-0\"" },
  { guard: "zde-guard:built", file: "src/zbuilt2.spec.ts", spec: "import { zbuilt2 } from './zbuilt2';\nexpect(zbuilt2(['a.b', 'c'], [1])).toEqual({ a: 1 });\nexpect(zbuilt2(['d.e'], [3])).toEqual({ d: { e: 3 } });\n", body: "like(keys)" },
  { guard: "zde-guard:nest", file: "src/znest.spec.ts", spec: "import { znest } from './znest';\nexpect(znest('ab', [1])).toEqual({ a: 1, b: undefined });\nexpect(znest(['c'], [3])).toEqual({ c: 3 });\n", body: "like(keys)" },
  { guard: "zde-guard:miss", file: "src/zmiss2.spec.ts", spec: "import { zmiss2 } from './zmiss2';\nexpect(zmiss2(['a.b', 'c'], [1, 2])).toEqual({ a: { b: 1 }, c: 2 });\nexpect(zmiss2(['d.e'], [3])).toEqual({ d: { e: 3 } });\n", body: "like(keys)" },
  { guard: "idn-guard:fit", file: "src/ifit.spec.ts", spec: "import { ifit } from './ifit';\nexpect(ifit(5)).toBe(6);\nexpect(ifit('hello')).toBe('hello');\nexpect(ifit(true)).toBe(true);\nexpect(ifit(false)).toBe(false);\n", body: "return a;" },
  { guard: "idn-guard:num", file: "src/inum.spec.ts", spec: "import { inum } from './inum';\nexpect(inum('ab')).toBe('ab');\nexpect(inum(true)).toBe(true);\nexpect(inum(false)).toBe(false);\n", body: "return a;" },
  { guard: "idn-guard:str", file: "src/istr.spec.ts", spec: "import { istr } from './istr';\nexpect(istr(1)).toBe(1);\nexpect(istr(2)).toBe(2);\nexpect(istr(true)).toBe(true);\nexpect(istr(false)).toBe(false);\n", body: "return a;" },
  { guard: "idn-guard:bool", file: "src/ibool.spec.ts", spec: "import { ibool } from './ibool';\nexpect(ibool(1)).toBe(1);\nexpect(ibool(2)).toBe(2);\nexpect(ibool('a')).toBe('a');\n", body: "return a;" },
  { guard: "idn-guard:value", file: "src/ival.spec.ts", spec: "import { ival } from './ival';\nexpect(ival(1)).toBe(1);\nexpect(ival('a')).toBe('a');\nexpect(ival(true)).toBe(true);\nexpect(ival(null)).toBe(null);\n", body: "return a;" },
  { guard: "uesc-guard:fit", file: "src/ufit.spec.ts", spec: "import { ufit } from './ufit';\nexpect(ufit('&amp;')).toBe('NO');\nexpect(ufit('abc')).toBe('abc');\n", body: "&amp;" },
  { guard: "uesc-guard:amp", file: "src/uamp.spec.ts", spec: "import { uamp } from './uamp';\nexpect(uamp('&#39;')).toBe(\"'\");\nexpect(uamp('&lt;')).toBe('<');\n", body: "&amp;" },
  { guard: "dden-guard:fit", file: "src/dfit.spec.ts", spec: "import { dfit } from './dfit';\nexpect(dfit('  hello')).toBe('HELLO');\nexpect(dfit('  a\\n  b')).toBe('a\\nb');\n", body: "Invalid opening line" },
  { guard: "dden-guard:line", file: "src/dline.spec.ts", spec: "import { dline } from './dline';\nexpect(dline('  hello')).toBe('hello');\nexpect(dline('   x')).toBe('x');\n", body: "Invalid opening line" },
  { guard: "gt-guard:fit", file: "src/gfit.spec.ts", spec: "import { gfit } from './gfit';\nexpect(gfit(3, 1)).toBe(true);\nexpect(gfit(1, 3)).toBe(false);\nexpect(gfit('def', 'abc')).toBe(false);\n", body: "a > b" },
  { guard: "gt-guard:text", file: "src/gtext.spec.ts", spec: "import { gtext } from './gtext';\nexpect(gtext(3, 1)).toBe(true);\nexpect(gtext(1, 3)).toBe(false);\nexpect(gtext(3, 3)).toBe(false);\n", body: "a > b" },
  { guard: "lt-guard:fit", file: "src/lfit.spec.ts", spec: "import { lfit } from './lfit';\nexpect(lfit(1, 3)).toBe(true);\nexpect(lfit(3, 1)).toBe(false);\nexpect(lfit('abc', 'def')).toBe(false);\n", body: "a < b" },
  { guard: "lt-guard:text", file: "src/ltext.spec.ts", spec: "import { ltext } from './ltext';\nexpect(ltext(1, 3)).toBe(true);\nexpect(ltext(3, 1)).toBe(false);\nexpect(ltext(3, 3)).toBe(false);\n", body: "a < b" },
];

test("a near-miss each length-index guard names is refused", () => {
  for (const row of KILLS) assert.equal(admit(row.file, row.spec, row.file.replace(/\.spec\.ts$/, ".ts"))?.ok, false, row.guard);
});

const base = resolve(root, "peaceai/test/.m250-mutants");
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

test("deleting a length-index guard admits the case it refused", async () => {
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

test("zip and mean agree with the published index loop on sets and generators", (t) => {
  if (!practiceSandboxReady()) { t.skip("bwrap is not installed on this host"); return; }
  const node = visibleNodeBin();
  assert.ok(node);
  const dirFiles: Record<string, string> = {
    "shim.mjs": SHIM,
    "zipObject.mjs": transpile("zipObject.ts", readFileSync(resolve(root, "peaceai/test/fixtures/m248/es-toolkit-zipObject.ts.txt"), "utf8")),
    "sum.mjs": transpile("sum.ts", readFileSync(resolve(root, "peaceai/test/fixtures/m248/es-toolkit-sum.ts.txt"), "utf8")),
    "mean.mjs": transpile("mean.ts", readFileSync(resolve(root, "peaceai/test/fixtures/m248/es-toolkit-mean.ts.txt"), "utf8")),
  };
  const script = [
    "import { zipObject } from './zipObject.mjs';",
    "import { mean } from './mean.mjs';",
    "const zobj = (a, b) => ((o) => { for (let i = 0; i < a.length; i++) o[a[i]] = b[i]; return o; })({});",
    "const avg = (a) => ((n) => { let s = 0; for (let i = 0; i < n; i++) s += a[i]; return s / n; })(a.length);",
    "function same(l, r) {",
    "  if (Object.is(l, r)) return true;",
    "  if (l && r && typeof l === 'object' && typeof r === 'object') {",
    "    const lk = Reflect.ownKeys(l), rk = Reflect.ownKeys(r);",
    "    return lk.length === rk.length && lk.every((k) => same(l[k], r[k]));",
    "  }",
    "  return false;",
    "}",
    "let bad = 0;",
    "const check = (name, pub, got) => { if (!same(pub, got)) { bad++; console.log('FAIL', name, pub, got); } };",
    "const checkThrow = (name, pub, ours) => { let pe, oe; try { pub(); } catch (e) { pe = e; } try { ours(); } catch (e) { oe = e; } if (!pe || !oe || pe.message !== oe.message) { bad++; console.log('THROW', name, pe && pe.message, oe && oe.message); } };",
    "check('zobj set', zipObject(new Set(['a', 'b']), [1, 2]), zobj(new Set(['a', 'b']), [1, 2]));",
    "check('mean set', mean(new Set([1, 3])), avg(new Set([1, 3])));",
    "const tagged = new Set([10, 20]); tagged.length = 1;",
    "check('mean tagged', mean(tagged), avg(tagged));",
    "function* gen() { yield 4; yield 8; }",
    "check('mean gen', mean(gen()), avg(gen()));",
    "check('mean hole', mean([1,,2]), avg([1,,2]));",
    "check('zobj hole', zipObject(['a',,'c'], [1, 2, 3]), zobj(['a',,'c'], [1, 2, 3]));",
    "check('mean digit', mean('5'), avg('5'));",
    "check('zobj chars', zipObject('ab', 'xy'), zobj('ab', 'xy'));",
    "checkThrow('mean null', () => mean(null), () => avg(null));",
    "checkThrow('zobj null', () => zipObject(null, []), () => zobj(null, []));",
    "if (bad) process.exit(1);",
    "console.log('grid ok');",
    "",
  ].join("\n");
  const ran = runBoxed({ ...dirFiles, "grid.mjs": script }, "grid.mjs");
  assert.equal(ran.code, 0, ran.stdout);
});

test("a near-miss that the published calls accept is verified_test_only", (t) => {
  if (!practiceSandboxReady()) { t.skip("bwrap is not installed on this host"); return; }
  const nodePath = visibleNodeBin();
  if (!nodePath) { t.skip("no visible node"); return; }
  const rows = [
    {
      symbol: "toLength", file: "src/compat/util/toLength.ts",
      candidate: "export function toLength(a: unknown): number { return a == null || typeof a !== 'number' ? 0 : Math.max(0, Math.trunc(a)); }\n",
      args: [[1.1], ["12px"], [4294967296]],
      deps: ["compat/util/toInteger.ts", "compat/util/toFinite.ts", "compat/util/toNumber.ts", "compat/predicate/isSymbol.ts", "compat/math/clamp.ts", "compat/_internal/MAX_ARRAY_LENGTH.ts"],
    },
    {
      symbol: "toKey", file: "src/compat/_internal/toKey.ts",
      candidate: "export function toKey(a: unknown): string { return String(a); }\n",
      args: [[-0], [0]],
      deps: [] as string[],
    },
    {
      symbol: "zipObjectDeep", file: "src/compat/array/zipObjectDeep.ts",
      candidate: "export function zipObjectDeep(a: readonly PropertyKey[], b: readonly unknown[]): Record<PropertyKey, unknown> {\n  const o: Record<PropertyKey, unknown> = {};\n  for (let i = 0; i < a.length; i++) o[a[i]!] = b[i];\n  return o;\n}\n",
      args: [[["a.b.c", "d.e.f"], [1, 2]], [["a", "b", "c"], [1, 2]]],
      deps: pins.map((row) => row.path).filter((path) => path.endsWith(".ts") && !path.endsWith(".spec.ts") && path !== "compat/array/zipObjectDeep.ts"),
    },
    {
      symbol: "identity", file: "src/function/identity.ts",
      candidate: "export function identity<T>(a: T): T { return (typeof a === \"object\" ? null : a) as T; }\n",
      args: [[5], [{ a: 1 }]],
      deps: [] as string[],
    },
    {
      symbol: "unescape", file: "src/string/unescape.ts",
      candidate: "export function unescape(a: string): string { return a.replaceAll(\"&amp;\", \"&\").replaceAll(\"&lt;\", \"<\").replaceAll(\"&gt;\", \">\").replaceAll(\"&quot;\", '\"').replaceAll(\"&#39;\", \"'\"); }\n",
      args: [["&amp;lt;"], ["&#039;"]],
      deps: [] as string[],
    },
    {
      symbol: "dedent", file: "src/string/dedent.ts",
      candidate: "export function dedent(a: string): string { return a.trim(); }\n",
      args: [["  hello\n  world"], ["hello"]],
      deps: [] as string[],
    },
    {
      symbol: "gt", file: "src/compat/util/gt.ts",
      candidate: "export function gt(a: unknown, b: unknown): boolean { return (a as number) >= (b as number); }\n",
      args: [[3, 1], [3, 3]],
      deps: ["compat/util/toNumber.ts", "compat/predicate/isSymbol.ts"],
    },
    {
      symbol: "lt", file: "src/compat/util/lt.ts",
      candidate: "export function lt(a: unknown, b: unknown): boolean { return (a as number) <= (b as number); }\n",
      args: [[1, 3], [3, 3]],
      deps: ["compat/util/toNumber.ts", "compat/predicate/isSymbol.ts"],
    },
  ];
  const trees: string[] = [];
  try {
    for (const row of rows) {
      const make = (text: string) => {
        const dir = mkdtempSync(join(tmpdir(), "peaceai-m250-grade-"));
        mkdirSync(join(dir, row.file, ".."), { recursive: true });
        writeFileSync(join(dir, row.file), text);
        for (const dep of row.deps) {
          const path = join(dir, "src", dep);
          mkdirSync(dirname(path), { recursive: true });
          writeFileSync(path, pinned(dep));
        }
        trees.push(dir);
        return dir;
      };
      const grade = gradeBehavior({
        candidateRoot: make(row.candidate), fixRoot: make(pinned(row.file.slice("src/".length))), nodePath,
        target: { symbol: row.symbol, file: row.file, form: "named", exportName: row.symbol, args: row.args },
      });
      assert.equal(grade.behavior, "verified_test_only", `${row.symbol} ${grade.behavior}`);
    }
  } finally {
    for (const dir of trees) rmSync(dir, { recursive: true, force: true });
  }
});
