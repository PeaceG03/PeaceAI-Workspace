// Finite, last, and strict null. The admitting cases are toss/es-toolkit at
// 24e7a7b8cb8035fae1ea2e7b507aab96698a38b9. A passing log does not build a plan.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import ts from "typescript";
import { practiceSandboxReady } from "../lib/practicemine.ts";
import { scaffoldPlan } from "../lib/testspec.ts";

const PATTERN = "^src/.+\\.ts$";
const root = resolve(import.meta.dirname, "../..");
const fixture = resolve(import.meta.dirname, "fixtures/m243");
const COMMIT = "24e7a7b8cb8035fae1ea2e7b507aab96698a38b9";

const PIN = {
  isFinite: "1416443317d9b3613ffba63d3e68e2340b27377b02f1fc457dc097630db76e78",
  isFiniteTest: "f0772e3b9e6d2e5bc335e9b3d34a6b863ffefa817bd107e9df24f123f88fdda2",
  isNull: "f12f0fb080f4713d5ddd8875cc793dda5e48ef757e736f5668c71ee6a93f0c3f",
  isNullTest: "ad5df0edb7e274f3467f59548554b6f2459ae538f41f6896d5940c6f6a113bd1",
  last: "dd7db6526a5a7e212cf18d6be64849b6d33ea54aa14daa9ce747b0ba11914a2b",
  lastTest: "1c3ba1491240c80346563e2e71e03954674ee45492d9296d1dd7c910155db9f6",
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
  "  return {",
  "    toBe(expected) { if (!Object.is(actual, expected)) throw new Error(String(actual) + ' !== ' + String(expected)); },",
  "    toEqual(expected) { if (!same(actual, expected)) throw new Error('not equal'); },",
  "    toStrictEqual(expected) { if (!same(actual, expected)) throw new Error('not strict'); },",
  "    toBeUndefined() { if (actual !== undefined) throw new Error('not undefined'); },",
  "    toBeNull() { if (actual !== null) throw new Error('not null'); },",
  "  };",
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
  const dir = mkdtempSync(join(tmpdir(), "peaceai-m243-"));
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

function admit(specFile: string, spec: string, moduleFile: string) {
  return scaffoldPlan(specFile, spec, `Cannot find module '/work/${moduleFile}'`, PATTERN, [], () => null);
}

test("toss/es-toolkit isFinite, last, and isNull are admitted", async () => {
  const cases = [
    { local: "isFinite", dir: "src/compat/predicate", source: "es-toolkit-isFinite.ts.txt", spec: "es-toolkit-isFinite.spec.ts.txt", sourceSha: PIN.isFinite, specSha: PIN.isFiniteTest, shape: "finite", body: /return Number\.isFinite\(a\);/ },
    { local: "last", dir: "src/array", source: "es-toolkit-last.ts.txt", spec: "es-toolkit-last.spec.ts.txt", sourceSha: PIN.last, specSha: PIN.lastTest, shape: "last", body: /return a\[a\.length - 1\];/ },
    { local: "isNull", dir: "src/predicate", source: "es-toolkit-isNull.ts.txt", spec: "es-toolkit-isNull.spec.ts.txt", sourceSha: PIN.isNull, specSha: PIN.isNullTest, shape: "null", body: /return a === null;/ },
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
    const needsSandbox = row.local !== "isNull";
    if (needsSandbox && !practiceSandboxReady()) {
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

test("a finite number needs a false non-finite example, and a string is not last", () => {
  const finite = admit("src/finite.spec.ts", [
    "import { finite } from './finite';",
    "expect(finite(1)).toBe(true);",
    "expect(finite(1.5)).toBe(true);",
    "expect(finite(Infinity)).toBe(false);",
    "expect(finite('x')).toBe(false);",
  ].join("\n"), "src/finite.ts");
  assert.match(bodyOf(finite), /return Number\.isFinite\(a\);/);
  const witnessed = admit("src/wide.spec.ts", [
    "import { wide } from './wide';",
    "expect(wide(1)).toBe(true);",
    "expect(wide(1.5)).toBe(true);",
    "expect(wide([1])).toBe(false);",
  ].join("\n"), "src/wide.ts");
  assert.match(bodyOf(witnessed), /return typeof a === "number";/);
  assert.equal(bodyOf(witnessed).includes("Number.isFinite"), false);
  const word = admit("src/word.spec.ts", "import { word } from './word';\nexpect(word('ab')).toBe('b');\nexpect(word('cd')).toBe('d');\n", "src/word.ts");
  assert.equal(word?.ok, false);
  const lie = admit("src/foo.spec.ts", [
    "import { foo } from './foo';",
    "expect(foo(1)).toBe(true);",
    "expect(foo(1.5)).toBe(true);",
    "expect(foo(-1)).toBe(true);",
    "expect(foo(Infinity)).toBe(false);",
    "expect(foo(NaN)).toBe(false);",
    "expect(foo('x')).toBe(false);",
    "expect(foo(Object(1))).toBe(true);",
  ].join("\n"), "src/foo.ts");
  assert.equal(lie?.ok, false);
  const repeated = admit("src/same.spec.ts", "import { same } from './same';\nexpect(same([1, 2])).toBe(2);\nexpect(same([9, 2])).toBe(2);\n", "src/same.ts");
  assert.match(bodyOf(repeated), /return 2;/);
  assert.equal(bodyOf(repeated).includes("a.length"), false);
  const only = admit("src/only.spec.ts", "import { only } from './only';\nexpect(only([7])).toBe(7);\nexpect(only([8])).toBe(8);\n", "src/only.ts");
  assert.equal(only?.ok, false);
});

test("strict null needs undefined false, and both nullish values true stay nil", () => {
  const eq = admit("src/eq.spec.ts", [
    "import { eq } from './eq';",
    "expect(eq(null)).toBe(true);",
    "expect(eq(undefined)).toBe(false);",
    "expect(eq(0)).toBe(false);",
  ].join("\n"), "src/eq.ts");
  assert.match(bodyOf(eq), /return a === null;/);
  const both = admit("src/both.spec.ts", [
    "import { both } from './both';",
    "expect(both(null)).toBe(true);",
    "expect(both(undefined)).toBe(true);",
    "expect(both(0)).toBe(false);",
  ].join("\n"), "src/both.ts");
  assert.match(bodyOf(both), /return a == null;/);
  assert.equal(bodyOf(both).includes("==="), false);
  const unseen = admit("src/unseen.spec.ts", "import { unseen } from './unseen';\nexpect(unseen(null)).toBe(true);\nexpect(unseen(0)).toBe(false);\n", "src/unseen.ts");
  assert.equal(unseen?.ok, false);
  const flipped = admit("src/flipped.spec.ts", "import { flipped } from './flipped';\nexpect(flipped(null)).toBe(false);\nexpect(flipped(undefined)).toBe(false);\nexpect(flipped(1)).toBe(true);\n", "src/flipped.ts");
  assert.equal(flipped?.ok, false);
});

const base = resolve(root, "peaceai/test/.m243-mutants");
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

test("deleting a value-family guard admits the case it refused", async () => {
  const open = async (guard: string, file: string, body: string) => {
    const mod = await mutant(guard) as typeof import("../lib/testspec.ts");
    return mod.scaffoldPlan(file, body, `Cannot find module '/work/${file.replace(/\.spec\.ts$/, ".ts")}'`, PATTERN, [], () => null);
  };
  const disagree = await open("finite-guard:match", "src/bad.spec.ts", [
    "import { bad } from './bad';",
    "expect(bad(1)).toBe(true);",
    "expect(bad(Infinity)).toBe(true);",
    "expect(bad(NaN)).toBe(false);",
    "expect(bad('z')).toBe(false);",
  ].join("\n"));
  assert.equal(disagree?.ok, true);
  if (disagree?.ok) assert.match(disagree.files[0]!.content, /return Number\.isFinite\(a\);/);
  const noWitness = await open("finite-guard:witness", "src/wide.spec.ts", [
    "import { wide } from './wide';",
    "expect(wide(1)).toBe(true);",
    "expect(wide(1.5)).toBe(true);",
    "expect(wide([1])).toBe(false);",
  ].join("\n"));
  assert.equal(noWitness?.ok, false);

  const chars = await open("last-guard:arrays", "src/chars.spec.ts", "import { chars } from './chars';\nexpect(chars('ab')).toBe('b');\nexpect(chars('cd')).toBe('d');\n");
  assert.equal(chars?.ok, true);
  if (chars?.ok) assert.match(chars.files[0]!.content, /return a\[a\.length - 1\];/);
  const middle = await open("last-guard:index", "src/middle.spec.ts", "import { middle } from './middle';\nexpect(middle([1, 9, 3])).toBe(9);\nexpect(middle([4, 8, 6])).toBe(8);\n");
  assert.equal(middle?.ok, true);
  if (middle?.ok) assert.match(middle.files[0]!.content, /return a\[a\.length - 1\];/);
  const same = await open("last-guard:varies", "src/same.spec.ts", "import { same } from './same';\nexpect(same([1, 2])).toBe(2);\nexpect(same([9, 2])).toBe(2);\n");
  assert.equal(same?.ok, false);

  const hiddenUndef = await open("null-guard:undef-false", "src/hidden.spec.ts", "import { hidden } from './hidden';\nexpect(hidden(null)).toBe(true);\nexpect(hidden(0)).toBe(false);\n");
  assert.equal(hiddenUndef?.ok, true);
  if (hiddenUndef?.ok) assert.match(hiddenUndef.files[0]!.content, /return a === null;/);
  const other = await open("null-guard:others-false", "src/other.spec.ts", "import { other } from './other';\nexpect(other(null)).toBe(true);\nexpect(other(undefined)).toBe(false);\nexpect(other(1)).toBe(true);\n");
  assert.equal(other?.ok, true);
  if (other?.ok) assert.match(other.files[0]!.content, /return a === null;/);
  const notNull = await open("null-guard:null-true", "src/notnull.spec.ts", "import { notnull } from './notnull';\nexpect(notnull(null)).toBe(false);\nexpect(notnull(undefined)).toBe(false);\nexpect(notnull(0)).toBe(false);\n");
  assert.equal(notNull?.ok, false);

  const lie = await open("spec-guard:opaque-call", "src/foo.spec.ts", [
    "import { foo } from './foo';",
    "expect(foo(1)).toBe(true);",
    "expect(foo(1.5)).toBe(true);",
    "expect(foo(-1)).toBe(true);",
    "expect(foo(Infinity)).toBe(false);",
    "expect(foo(NaN)).toBe(false);",
    "expect(foo('x')).toBe(false);",
    "expect(foo(Object(1))).toBe(true);",
  ].join("\n"));
  assert.equal(lie?.ok, true);
  if (lie?.ok) assert.match(lie.files[0]!.content, /return Number\.isFinite\(a\);/);
  rmSync(base, { recursive: true, force: true });
});

function finiteSpec(expr: string, expected: "true" | "false"): string {
  return [
    "import { foo } from './foo';",
    "expect(foo(1)).toBe(true);",
    "expect(foo(1.5)).toBe(true);",
    "expect(foo(-1)).toBe(true);",
    "expect(foo(Infinity)).toBe(false);",
    "expect(foo(NaN)).toBe(false);",
    "expect(foo('x')).toBe(false);",
    `expect(foo(${expr})).toBe(${expected});`,
  ].join("\n");
}

function writeCanary(path: string): string {
  return `(() => { const run = ({}).constructor.constructor; const proc = run("return process")(); proc.getBuiltinModule("fs").writeFileSync(${JSON.stringify(path)}, "x"); return Object(1); })()`;
}

test("a hostile opaque argument does not touch the host", () => {
  const canary = join(tmpdir(), `peaceai-opaque-canary-${process.pid}`);
  rmSync(canary, { force: true });
  const secret = `host-secret-${process.pid}`;
  process.env.PEACEAI_OPAQUE_SECRET = secret;
  try {
    const wrote = admit("src/foo.spec.ts", finiteSpec(writeCanary(canary), "true"), "src/foo.ts");
    assert.equal(wrote?.ok, false);
    assert.equal(existsSync(canary), false);
    const read = `(process.env.PEACEAI_OPAQUE_SECRET === ${JSON.stringify(secret)} ? Object(1) : 1)`;
    const leaked = admit("src/foo.spec.ts", finiteSpec(read, "false"), "src/foo.ts");
    assert.equal(leaked?.ok, false);
  } finally {
    delete process.env.PEACEAI_OPAQUE_SECRET;
    rmSync(canary, { force: true });
  }
});

test("missing bwrap refuses an opaque call without running it", () => {
  const canary = join(tmpdir(), `peaceai-opaque-nobwrap-${process.pid}`);
  rmSync(canary, { force: true });
  const saved = process.env.PATH;
  process.env.PATH = "/no/such/bin";
  try {
    const plan = admit("src/foo.spec.ts", finiteSpec(writeCanary(canary), "true"), "src/foo.ts");
    assert.equal(plan?.ok, false);
  } finally {
    if (saved === undefined) delete process.env.PATH;
    else process.env.PATH = saved;
    rmSync(canary, { force: true });
  }
  assert.equal(existsSync(canary), false);
});
