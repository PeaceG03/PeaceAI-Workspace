// Not-nil, initial, tail, and take. The admitting cases are toss/es-toolkit at
// 24e7a7b8cb8035fae1ea2e7b507aab96698a38b9. A bare integer comparison keeps the
// first form. A one-argument some/every is not emitted. A passing log does not build a plan.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import ts from "typescript";
import { practiceSandboxReady } from "../lib/practicemine.ts";
import { decodeTagged, OPAQUE_DECODE_LIMITS, scaffoldPlan } from "../lib/testspec.ts";

const PATTERN = "^src/.+\\.ts$";
const root = resolve(import.meta.dirname, "../..");
const fixture = resolve(import.meta.dirname, "fixtures/m244");
const COMMIT = "24e7a7b8cb8035fae1ea2e7b507aab96698a38b9";

const PIN = {
  isNotNil: "a17ec962c08ca2479cfeea8baead7d931c4d656a745fbeca6a474906ad4c8554",
  isNotNilTest: "242d3cb931e2dcae4650ac8a8a04ddb40081801893127da132a6b045676c6fac",
  initial: "0c12f85a5f45251c16a1512ee26a4b52908c19c2105fe915785d28b3b19a8987",
  initialTest: "c3a04a7b4940dff8f18278fb857277ccf25f2031c5f970908736e330a201f16a",
  tail: "702f87a09c5fa48fa95cdaba7121a5293b62722d31532b7d2fb52966a4451681",
  tailTest: "dde7de188061ef6e9684cdf58f94931a2b41713fbc778e6ba27c62e0c426c4cd",
  take: "8f2527f0e2f1579f01f6efb22ea75ff3f0fdce43a2b18034077a921487f55444",
  takeTest: "a2843d4f87920b93b35074961670450716a9f491d451a39464e17c1fa7f2e234",
};

function pinned(name: string): string {
  return readFileSync(join(fixture, name), "utf8");
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function bodyOf(plan: ReturnType<typeof scaffoldPlan>): string {
  assert.equal(plan?.ok, true);
  if (!plan?.ok) return "";
  return plan.files[0]!.content;
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
  "    not: { toBe(expected) { if (Object.is(actual, expected)) throw new Error('same'); } },",
  "  };",
  "  return api;",
  "}",
  "export function expectTypeOf(_value) { return { toEqualTypeOf() {} }; }",
  "export function test(_name, fn) { fn(); }",
  "export function it(_name, fn) { fn(); }",
  "export function describe(_name, fn) { fn(); }",
  "",
].join("\n");

function publishedTest(text: string, local: string): string {
  return text
    .replaceAll("from 'vitest'", "from './shim.mjs'")
    .replaceAll('from "vitest"', 'from "./shim.mjs"')
    .replaceAll(`from './${local}'`, `from './${local}.mjs'`)
    .replaceAll(`from "./${local}"`, `from "./${local}.mjs"`);
}

async function runPublished(local: string, spec: string, moduleText: string): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "peaceai-m244-"));
  const js = (file: string, text: string) => ts.transpileModule(text, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    fileName: file,
  }).outputText;
  writeFileSync(join(dir, "shim.mjs"), SHIM);
  writeFileSync(join(dir, `${local}.mjs`), js(`${local}.ts`, moduleText));
  writeFileSync(join(dir, "run.mjs"), js(`${local}.test.ts`, publishedTest(spec, local)));
  try {
    await import(`${pathToFileURL(join(dir, "run.mjs")).href}?t=${Date.now()}-${Math.random()}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function admit(specFile: string, spec: string, moduleFile: string, sandbox?: { bwrap?: string }) {
  return scaffoldPlan(specFile, spec, `Cannot find module '/work/${moduleFile}'`, PATTERN, [], () => null, sandbox);
}

test("toss/es-toolkit not-nil, initial, tail, and take are admitted", async () => {
  const cases = [
    { local: "isNotNil", dir: "src/predicate", source: "es-toolkit-isNotNil.ts.txt", spec: "es-toolkit-isNotNil.spec.ts.txt", sourceSha: PIN.isNotNil, specSha: PIN.isNotNilTest, shape: "notnil", body: /return a != null;/, sandbox: false },
    { local: "initial", dir: "src/array", source: "es-toolkit-initial.ts.txt", spec: "es-toolkit-initial.spec.ts.txt", sourceSha: PIN.initial, specSha: PIN.initialTest, shape: "initial", body: /return a\.slice\(0, -1\);/, sandbox: true },
    { local: "tail", dir: "src/array", source: "es-toolkit-tail.ts.txt", spec: "es-toolkit-tail.spec.ts.txt", sourceSha: PIN.tail, specSha: PIN.tailTest, shape: "tail", body: /return a\.slice\(1\);/, sandbox: false },
    { local: "take", dir: "src/array", source: "es-toolkit-take.ts.txt", spec: "es-toolkit-take.spec.ts.txt", sourceSha: PIN.take, specSha: PIN.takeTest, shape: "take", body: /return a\.slice\(0, b\);/, sandbox: false },
  ];
  for (const row of cases) {
    const source = pinned(row.source);
    const spec = pinned(row.spec);
    assert.equal(sha256(source), row.sourceSha, row.local);
    assert.equal(sha256(spec), row.specSha, row.local);
    const missing = `export function ${row.local}(..._args: unknown[]): never {\n  throw new Error("missing");\n}\n`;
    await assert.rejects(() => runPublished(row.local, spec, missing), row.local);
    await runPublished(row.local, spec, source);
    const plan = admit(`${row.dir}/${row.local}.spec.ts`, spec, `${row.dir}/${row.local}.ts`);
    if (row.sandbox && !practiceSandboxReady()) {
      assert.equal(plan?.ok, false, row.local);
      continue;
    }
    assert.equal(plan?.ok, true, row.local);
    if (!plan?.ok) continue;
    assert.equal(plan.fit.shape, row.shape, row.local);
    assert.match(plan.files[0]!.content, row.body, row.local);
    await runPublished(row.local, spec, plan.files[0]!.content);
  }
  assert.equal(COMMIT.length, 40);
});

test("not-nil needs both nullish values false, and nil stays the other polarity", () => {
  const present = admit("src/present.spec.ts", [
    "import { present } from './present';",
    "expect(present(null)).toBe(false);",
    "expect(present(undefined)).toBe(false);",
    "expect(present(0)).toBe(true);",
    "expect(present(false)).toBe(true);",
  ].join("\n"), "src/present.ts");
  assert.match(bodyOf(present), /return a != null;/);
  const nil = admit("src/nil.spec.ts", [
    "import { nil } from './nil';",
    "expect(nil(null)).toBe(true);",
    "expect(nil(undefined)).toBe(true);",
    "expect(nil(0)).toBe(false);",
  ].join("\n"), "src/nil.ts");
  assert.match(bodyOf(nil), /return a == null;/);
  assert.equal(bodyOf(nil).includes("!="), false);
  const onlyNull = admit("src/only.spec.ts", "import { only } from './only';\nexpect(only(null)).toBe(false);\nexpect(only(0)).toBe(true);\n", "src/only.ts");
  assert.equal(onlyNull?.ok, false);
  const otherFalse = admit("src/zero.spec.ts", [
    "import { zero } from './zero';",
    "expect(zero(null)).toBe(false);",
    "expect(zero(undefined)).toBe(false);",
    "expect(zero(0)).toBe(false);",
    "expect(zero(1)).toBe(true);",
    "expect(zero('x')).toBe(true);",
  ].join("\n"), "src/zero.ts");
  assert.equal(otherFalse?.ok, false);
});

test("a prefix, a suffix, and a counted prefix are different slices", () => {
  const prefix = admit("src/prefix.spec.ts", [
    "import { prefix } from './prefix';",
    "expect(prefix([1, 2, 3])).toEqual([1, 2]);",
    "expect(prefix(['a', 'b'])).toEqual(['a']);",
    "expect(prefix([])).toEqual([]);",
  ].join("\n"), "src/prefix.ts");
  assert.match(bodyOf(prefix), /return a\.slice\(0, -1\);/);
  const rest = admit("src/rest.spec.ts", [
    "import { rest } from './rest';",
    "expect(rest([1, 2, 3])).toEqual([2, 3]);",
    "expect(rest([true, false])).toEqual([false]);",
    "expect(rest([])).toEqual([]);",
  ].join("\n"), "src/rest.ts");
  assert.match(bodyOf(rest), /return a\.slice\(1\);/);
  const head = admit("src/head.spec.ts", [
    "import { head } from './head';",
    "expect(head([1, 2, 3], 2)).toEqual([1, 2]);",
    "expect(head(['a', 'b', 'c'], 1)).toEqual(['a']);",
    "expect(head([1, 2, 3], 0)).toEqual([]);",
    "expect(head([1], 5)).toEqual([1]);",
  ].join("\n"), "src/head.ts");
  assert.match(bodyOf(head), /return a\.slice\(0, b\);/);
  const word = admit("src/word.spec.ts", "import { word } from './word';\nexpect(word('ab')).toEqual('a');\nexpect(word('cd')).toEqual('c');\n", "src/word.ts");
  assert.equal(word?.ok, false);
  const same = admit("src/same.spec.ts", "import { same } from './same';\nexpect(same([1])).toEqual([]);\nexpect(same([2])).toEqual([]);\n", "src/same.ts");
  assert.match(bodyOf(same), /return \[\];/);
  const open = admit("src/above.spec.ts", [
    "import { above } from './above';",
    "expect(above(-3)).toBe(false);",
    "expect(above(3)).toBe(false);",
    "expect(above(4)).toBe(true);",
    "expect(above(7)).toBe(true);",
  ].join("\n"), "src/above.ts");
  assert.match(bodyOf(open), /return a > 3;/);
  assert.equal(bodyOf(open).includes(">="), false);
  const quant = admit("src/quant.spec.ts", [
    "import { quant } from './quant';",
    "expect(quant([0, 0])).toBe(false);",
    "expect(quant([0, 1])).toBe(true);",
    "expect(quant([])).toBe(false);",
  ].join("\n"), "src/quant.ts");
  assert.equal(quant?.ok, false);
});

test("a tagged payload refuses depth, size, and prototype keys", () => {
  const num = (v: number) => ({ t: "n", v });
  const nested = (depth: number): unknown => depth <= 0 ? num(1) : { t: "a", v: [nested(depth - 1)] };
  assert.equal(decodeTagged(nested(4)).ok, true);
  assert.equal(decodeTagged(nested(OPAQUE_DECODE_LIMITS.depth + 2)).ok, false);
  const wide = { t: "a", v: Array.from({ length: OPAQUE_DECODE_LIMITS.nodes + 1 }, () => num(1)) };
  assert.equal(decodeTagged(wide).ok, false);
  const long = { t: "s", v: "x".repeat(OPAQUE_DECODE_LIMITS.string + 1) };
  assert.equal(decodeTagged(long).ok, false);
  const plain = decodeTagged({ t: "o", v: { a: num(1), b: { t: "s", v: "ok" } } });
  assert.equal(plain.ok, true);
  if (plain.ok) assert.deepEqual(plain.value, { a: 1, b: "ok" });
  for (const key of ["__proto__", "constructor", "prototype"]) {
    const payload = JSON.parse(JSON.stringify({ t: "o", v: { [key]: num(1), kept: num(2) } }));
    const before = Object.prototype as unknown as Record<string, unknown>;
    const mark = `peaceai-decode-${key}`;
    assert.equal(before[mark], undefined);
    const decoded = decodeTagged(payload);
    assert.equal(decoded.ok, false, key);
    assert.equal(before[mark], undefined, key);
    assert.equal(({} as Record<string, unknown>)[mark], undefined, key);
  }
});

test("decodeTagged takes the exact depth and key bounds", () => {
  const num = (v: number) => ({ t: "n", v });
  const nested = (depth: number): unknown => depth <= 0 ? num(1) : { t: "a", v: [nested(depth - 1)] };
  const atDepth = decodeTagged(nested(32));
  assert.equal(atDepth.ok, true);
  const pastDepth = decodeTagged(nested(33));
  assert.equal(pastDepth.ok, false);
  const keys = (count: number) => {
    const v: Record<string, unknown> = {};
    for (let i = 0; i < count; i++) v[`k${i}`] = num(i);
    return { t: "o", v };
  };
  const atKeys = decodeTagged(keys(1000));
  assert.equal(atKeys.ok, true);
  if (atKeys.ok) assert.equal(Object.keys(atKeys.value as object).length, 1000);
  assert.equal(decodeTagged(keys(1001)).ok, false);
  const nestedProto = JSON.parse('{"t":"o","v":{"kept":{"t":"n","v":1},"inner":{"t":"o","v":{"__proto__":{"t":"n","v":2}}}}}');
  assert.equal(decodeTagged(nestedProto).ok, false);
  assert.equal(Object.getOwnPropertyDescriptor(Object.prototype, "peaceaiNestedProto"), undefined);
});

const base = resolve(root, "peaceai/test/.m244-mutants");
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

test("deleting an array or nullish guard admits the case it refused", async () => {
  const open = async (guard: string, file: string, body: string) => {
    const mod = await mutant(guard) as typeof import("../lib/testspec.ts");
    return mod.scaffoldPlan(file, body, `Cannot find module '/work/${file.replace(/\.spec\.ts$/, ".ts")}'`, PATTERN, [], () => null);
  };
  const hidden = await open("notnil-guard:both", "src/hidden.spec.ts", "import { hidden } from './hidden';\nexpect(hidden(undefined)).toBe(false);\nexpect(hidden(0)).toBe(true);\n");
  assert.equal(hidden?.ok, true);
  if (hidden?.ok) assert.match(hidden.files[0]!.content, /return a != null;/);
  const flipped = await open("notnil-guard:nullish-false", "src/flipped.spec.ts", [
    "import { flipped } from './flipped';",
    "expect(flipped(null)).toBe(true);",
    "expect(flipped(undefined)).toBe(false);",
    "expect(flipped(1)).toBe(true);",
  ].join("\n"));
  assert.equal(flipped?.ok, true);
  if (flipped?.ok) assert.match(flipped.files[0]!.content, /return a != null;/);
  const other = await open("notnil-guard:others-true", "src/other.spec.ts", [
    "import { other } from './other';",
    "expect(other(null)).toBe(false);",
    "expect(other(undefined)).toBe(false);",
    "expect(other(0)).toBe(false);",
    "expect(other(1)).toBe(true);",
    "expect(other('x')).toBe(true);",
  ].join("\n"));
  assert.equal(other?.ok, true);
  if (other?.ok) assert.match(other.files[0]!.content, /return a != null;/);

  const chars = await open("init-guard:arrays", "src/chars.spec.ts", "import { chars } from './chars';\nexpect(chars('abc')).toEqual('ab');\nexpect(chars('xy')).toEqual('x');\n");
  assert.equal(chars?.ok, true);
  if (chars?.ok) assert.match(chars.files[0]!.content, /return a\.slice\(0, -1\);/);
  const middle = await open("init-guard:prefix", "src/middle.spec.ts", "import { middle } from './middle';\nexpect(middle([1, 2, 3])).toEqual([2]);\nexpect(middle([4, 5, 6])).toEqual([5]);\n");
  assert.equal(middle?.ok, true);
  if (middle?.ok) assert.match(middle.files[0]!.content, /return a\.slice\(0, -1\);/);
  const one = await open("init-guard:varies", "src/one.spec.ts", "import { one } from './one';\nexpect(one([1])).toEqual([]);\nexpect(one([2])).toEqual([]);\n");
  assert.equal(one?.ok, false);

  const letters = await open("tail-guard:arrays", "src/letters.spec.ts", "import { letters } from './letters';\nexpect(letters('abc')).toEqual('bc');\nexpect(letters('xy')).toEqual('y');\n");
  assert.equal(letters?.ok, true);
  if (letters?.ok) assert.match(letters.files[0]!.content, /return a\.slice\(1\);/);
  const skip = await open("tail-guard:rest", "src/skip.spec.ts", "import { skip } from './skip';\nexpect(skip([1, 2, 3])).toEqual([1]);\nexpect(skip([4, 5, 6])).toEqual([4]);\n");
  assert.equal(skip?.ok, true);
  if (skip?.ok) assert.match(skip.files[0]!.content, /return a\.slice\(1\);/);
  const empty = await open("tail-guard:varies", "src/empty.spec.ts", "import { empty } from './empty';\nexpect(empty([1])).toEqual([]);\nexpect(empty([2])).toEqual([]);\n");
  assert.equal(empty?.ok, false);

  const text = await open("take-guard:arrays", "src/text.spec.ts", "import { text } from './text';\nexpect(text('abcd', 2)).toEqual('ab');\nexpect(text('xy', 1)).toEqual('x');\n");
  assert.equal(text?.ok, true);
  if (text?.ok) assert.match(text.files[0]!.content, /return a\.slice\(0, b\);/);
  const last = await open("take-guard:count", "src/lastn.spec.ts", "import { lastn } from './lastn';\nexpect(lastn([1, 2, 3], 1)).toEqual([3]);\nexpect(lastn([4, 5, 6], 1)).toEqual([6]);\n");
  assert.equal(last?.ok, true);
  if (last?.ok) assert.match(last.files[0]!.content, /return a\.slice\(0, b\);/);
  const zeros = await open("take-guard:varies", "src/zeros.spec.ts", "import { zeros } from './zeros';\nexpect(zeros([1, 2], 0)).toEqual([]);\nexpect(zeros([3, 4], 0)).toEqual([]);\n");
  assert.equal(zeros?.ok, false);

  const opened = await mutant("decode-guard:keys") as typeof import("../lib/testspec.ts");
  const payload = JSON.parse('{"t":"o","v":{"__proto__":{"t":"n","v":1}}}');
  const decoded = opened.decodeTagged(payload);
  assert.equal(decoded.ok, true);
  if (decoded.ok) assert.equal((decoded.value as Record<string, unknown>).__proto__, 1);
  assert.equal(({} as Record<string, unknown>).peaceaiAdmin, undefined);
  const deep = await mutant("decode-guard:budget") as typeof import("../lib/testspec.ts");
  const chain = (depth: number): unknown => depth <= 0 ? { t: "n", v: 1 } : { t: "a", v: [chain(depth - 1)] };
  assert.equal(deep.decodeTagged(chain(OPAQUE_DECODE_LIMITS.depth + 2)).ok, true);
  rmSync(base, { recursive: true, force: true });
});
