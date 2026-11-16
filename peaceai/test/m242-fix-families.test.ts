// Type tag, nil, head, and reverse. The admitting cases are toss/es-toolkit at
// 24e7a7b8cb8035fae1ea2e7b507aab96698a38b9. A passing log does not build a plan.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import ts from "typescript";
import { practiceSandboxReady, visibleNodeBin } from "../lib/practicemine.ts";
import { gradeBehavior } from "../lib/specgrade.ts";
import { scaffoldPlan } from "../lib/testspec.ts";

const PATTERN = "^src/.+\\.ts$";
const root = resolve(import.meta.dirname, "../..");
const fixture = resolve(import.meta.dirname, "fixtures/m242");
const COMMIT = "24e7a7b8cb8035fae1ea2e7b507aab96698a38b9";

const PIN = {
  license: "51f3674294d988d89dbebd31273baaeb3c697a15482d9699b14d1fded2e132a7",
  isBoolean: "7963cea4ed9f321ac0dde4ebc5c941f0e939a67747c26fc5f74e375256213200",
  isBooleanTest: "fb797338d56f16bfdc60c17858c9ca0656ad7d25c45309e2760413b17cc0899c",
  isString: "8e40bb2f01612ff04cea3ff3fca7e6c4b83fbf698782da13c6b12c48798dc046",
  isStringTest: "053b468f78a9b7400bfd6873554c3be6709ec4cfbcd9444088d824ecfa923e44",
  isNil: "a44292c39709b01d46c6605e575883a07cbfbd0aaa9344891e0ff656aaf94c8e",
  isNilTest: "f21f6b23baa2a30ca4b9acd9f8be275c35c4db2ae223329ef8ef73e8a815b38a",
  head: "f796f7f9512467b51f63bbe7c0dd8fd76595aa0c7735dc49f2bb6321131ff2bc",
  headTest: "bb47abafbd35b0b0474030d23d0ef7104e471a04b1a18f10950444915b924835",
  reverse: "826da28c6fe3405bd7a45d380cfbc44b3c0efbacae59f475f052d2c9559f682d",
  reverseTest: "8540fef27fcb2fd631a61b76d82161b414ae40b34744b4d230ed83a380f27899",
};

function pinned(name: string): string {
  return readFileSync(join(fixture, name), "utf8");
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function named(name: string, body: string) {
  const text = `import { ${name} } from "./${name}.ts";\n${body}\n`;
  return scaffoldPlan(`src/${name}.test.ts`, text, `Cannot find module '/work/src/${name}.ts'`, PATTERN, [], () => null);
}

function bodyOf(plan: ReturnType<typeof scaffoldPlan>): string {
  assert.equal(plan?.ok, true);
  if (!plan?.ok) return "";
  return plan.files[0]!.content;
}

test("a type tag is one true tag, and an object or a second tag is refused", () => {
  const flag = named("flag", [
    "assert.equal(flag(true), true);",
    "assert.equal(flag(false), true);",
    "assert.equal(flag(0), false);",
    "assert.equal(flag('abc'), false);",
    'assert.equal(flag({ a: 1 }), false);',
  ].join("\n"));
  assert.match(bodyOf(flag), /return typeof a === "boolean";/);
  const text = named("text", [
    "assert.equal(text('abc'), true);",
    "assert.equal(text(123), false);",
    "assert.equal(text(null), false);",
  ].join("\n"));
  assert.match(bodyOf(text), /return typeof a === "string";/);
  const both = named("both", "assert.equal(both(true), true);\nassert.equal(both('a'), true);\nassert.equal(both([1]), false);");
  assert.equal(both?.ok, false);
  const box = named("box", "assert.equal(box({ a: 1 }), true);\nassert.equal(box({}), true);\nassert.equal(box(0), false);");
  assert.equal(box?.ok, false);
  const mixed = named("mixed", "assert.equal(mixed(true), true);\nassert.equal(mixed(false), false);\nassert.equal(mixed(0), false);");
  assert.equal(mixed?.ok, false);
  const only = named("only", "assert.equal(only(true), true);\nassert.equal(only(false), true);");
  assert.match(bodyOf(only), /return true;/);
  assert.equal(bodyOf(only).includes("typeof"), false);
});

test("nil needs both nullish values true and one other value false", () => {
  const nil = named("nil", [
    "assert.equal(nil(null), true);",
    "assert.equal(nil(undefined), true);",
    "assert.equal(nil(''), false);",
    "assert.equal(nil(123), false);",
  ].join("\n"));
  assert.match(bodyOf(nil), /return a == null;/);
  const absent = named("absent", "assert.equal(absent(null), true);\nassert.equal(absent(0), false);");
  assert.equal(absent?.ok, false);
  const split = named("split", [
    "assert.equal(split(null), true);",
    "assert.equal(split(undefined), true);",
    "assert.equal(split(undefined), false);",
    "assert.equal(split(0), false);",
  ].join("\n"));
  assert.equal(split?.ok, false);
  const flipped = named("flipped", "assert.equal(flipped(null), false);\nassert.equal(flipped(undefined), true);\nassert.equal(flipped(0), false);");
  assert.match(bodyOf(flipped), /return a === undefined;/);
  const kept = named("kept", "assert.equal(kept(null), true);\nassert.equal(kept(undefined), true);\nassert.equal(kept(1), true);");
  assert.match(bodyOf(kept), /return true;/);
  assert.equal(bodyOf(kept).includes("== null"), false);
});

test("head is the first element, and a repeated first element stays a literal", () => {
  const first = named("first", [
    "assert.equal(first([1, 2, 3]), 1);",
    "assert.equal(first(['a', 'b']), 'a');",
    "assert.equal(first([]), undefined);",
  ].join("\n"));
  assert.match(bodyOf(first), /return a\[0\];/);
  const later = named("later", "assert.equal(later([1, 2]), 2);\nassert.equal(later([3, 4]), 4);");
  assert.match(bodyOf(later), /return a\[a\.length - 1\];/);
  const word = named("word", "assert.equal(word('ab'), 'a');\nassert.equal(word('cd'), 'c');");
  assert.equal(word?.ok, false);
  const same = named("same", "assert.equal(same([1, 2]), 1);\nassert.equal(same([1, 9]), 1);");
  assert.match(bodyOf(same), /return 1;/);
  assert.equal(bodyOf(same).includes("a[0]"), false);
});

test("reverse is the code-point reverse, and a palindrome stays the identity", () => {
  const back = named("back", "assert.equal(back('ab'), 'ba');\nassert.equal(back('foo'), 'oof');\nassert.equal(back(''), '');");
  assert.match(bodyOf(back), /return Array\.from\(a\)\.reverse\(\)\.join\(""\);/);
  const same = named("pal", "assert.equal(pal('aba'), 'aba');\nassert.equal(pal('cc'), 'cc');");
  assert.match(bodyOf(same), /return a;/);
  assert.equal(bodyOf(same).includes("reverse"), false);
  const wrong = named("wrong", "assert.equal(wrong('ab'), 'xx');\nassert.equal(wrong('cd'), 'yy');");
  assert.equal(wrong?.ok, false);
  const chars = named("chars", "assert.equal(chars(['a', 'b']), 'ba');\nassert.equal(chars(['c', 'd']), 'dc');");
  assert.equal(chars?.ok, false);
});

const EMPTY_HEAD = [
  'import { expect } from "vitest";',
  'import { empty } from "./empty.ts";',
  "expect(empty([7, 8])).toBe(7);",
  "expect(empty([])).toBeUndefined();",
  "",
].join("\n");

test("toBeUndefined is what keeps one filled array as head", () => {
  const plan = scaffoldPlan("src/empty.test.ts", EMPTY_HEAD, "Cannot find module '/work/src/empty.ts'", PATTERN, [], () => null);
  assert.match(bodyOf(plan), /return a\[0\];/);
  assert.equal(bodyOf(plan).includes("return 7"), false);
});

test("a passing log does not scaffold", () => {
  const quiet = scaffoldPlan("src/flag.test.ts", 'import { flag } from "./flag.ts";\nassert.equal(flag(true), true);\nassert.equal(flag(0), false);\n', "ok", PATTERN, [], () => null);
  assert.equal(quiet, null);
});

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
  const dir = mkdtempSync(join(tmpdir(), "peaceai-es-"));
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

test("toss/es-toolkit isBoolean, isString, isNil, head, and reverseString are admitted", async () => {
  const license = pinned("es-toolkit-LICENSE.txt");
  assert.equal(sha256(license), PIN.license);
  assert.match(license, /MIT License/);
  assert.match(license, /Permission is hereby granted/);
  const cases = [
    { local: "isBoolean", dir: "src/predicate", source: "es-toolkit-isBoolean.ts.txt", spec: "es-toolkit-isBoolean.spec.ts.txt", sourceSha: PIN.isBoolean, specSha: PIN.isBooleanTest, shape: "tag", body: /return typeof a === "boolean";/ },
    { local: "isString", dir: "src/predicate", source: "es-toolkit-isString.ts.txt", spec: "es-toolkit-isString.spec.ts.txt", sourceSha: PIN.isString, specSha: PIN.isStringTest, shape: "tag", body: /return typeof a === "string";/ },
    { local: "isNil", dir: "src/predicate", source: "es-toolkit-isNil.ts.txt", spec: "es-toolkit-isNil.spec.ts.txt", sourceSha: PIN.isNil, specSha: PIN.isNilTest, shape: "nil", body: /return a == null;/ },
    { local: "head", dir: "src/array", source: "es-toolkit-head.ts.txt", spec: "es-toolkit-head.spec.ts.txt", sourceSha: PIN.head, specSha: PIN.headTest, shape: "head", body: /return a\[0\];/ },
    { local: "reverseString", dir: "src/string", source: "es-toolkit-reverseString.ts.txt", spec: "es-toolkit-reverseString.spec.ts.txt", sourceSha: PIN.reverse, specSha: PIN.reverseTest, shape: "reverse", body: /return Array\.from\(a\)\.reverse\(\)\.join\(""\);/ },
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
    assert.equal(plan?.ok, true, row.local);
    if (!plan?.ok) continue;
    assert.equal(plan.fit.shape, row.shape, row.local);
    assert.match(plan.files[0]!.content, row.body, row.local);
    await runPublished(row.local, spec, plan.files[0]!.content);
  }
  assert.equal(COMMIT.length, 40);
});

const base = resolve(root, "peaceai/test/.m242-mutants");
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

test("deleting a fix-family guard admits the case it refused", async () => {
  const open = async (guard: string, file: string, body: string) => {
    const mod = await mutant(guard) as typeof import("../lib/testspec.ts");
    return mod.scaffoldPlan(file, body, `Cannot find module '/work/${file.replace(/\.test\.ts$/, ".ts")}'`, PATTERN, [], () => null);
  };
  const two = await open("tag-guard:one-tag", "src/both.test.ts", 'import { both } from "./both.ts";\nassert.equal(both(true), true);\nassert.equal(both("a"), true);\nassert.equal(both([1]), false);\n');
  assert.equal(two?.ok, true);
  if (two?.ok) assert.match(two.files[0]!.content, /return typeof a === "boolean";/);
  const mixed = await open("tag-guard:uniform", "src/mixed.test.ts", 'import { mixed } from "./mixed.ts";\nassert.equal(mixed(true), true);\nassert.equal(mixed(false), false);\nassert.equal(mixed(0), false);\n');
  assert.equal(mixed?.ok, true);
  if (mixed?.ok) assert.match(mixed.files[0]!.content, /return typeof a === "boolean";/);
  const box = await open("tag-guard:not-object", "src/box.test.ts", 'import { box } from "./box.ts";\nassert.equal(box({ a: 1 }), true);\nassert.equal(box({}), true);\nassert.equal(box(0), false);\n');
  assert.equal(box?.ok, true);
  if (box?.ok) assert.match(box.files[0]!.content, /return typeof a === "object";/);
  const only = await open("tag-guard:others-false", "src/only.test.ts", 'import { only } from "./only.ts";\nassert.equal(only(true), true);\nassert.equal(only(false), true);\n');
  assert.equal(only?.ok, false);

  const absent = await open("nil-guard:both", "src/absent.test.ts", 'import { absent } from "./absent.ts";\nassert.equal(absent(null), true);\nassert.equal(absent(0), false);\n');
  assert.equal(absent?.ok, true);
  if (absent?.ok) assert.match(absent.files[0]!.content, /return a == null;/);
  const split = await open("nil-guard:nullish-true", "src/split.test.ts", [
    'import { split } from "./split.ts";',
    "assert.equal(split(null), true);",
    "assert.equal(split(undefined), true);",
    "assert.equal(split(undefined), false);",
    "assert.equal(split(0), false);",
  ].join("\n"));
  assert.equal(split?.ok, true);
  if (split?.ok) assert.match(split.files[0]!.content, /return a == null;/);
  const kept = await open("nil-guard:others-false", "src/kept.test.ts", 'import { kept } from "./kept.ts";\nassert.equal(kept(null), true);\nassert.equal(kept(undefined), true);\nassert.equal(kept(1), true);\n');
  assert.equal(kept?.ok, false);

  const word = await open("head-guard:arrays", "src/word.test.ts", 'import { word } from "./word.ts";\nassert.equal(word("ab"), "a");\nassert.equal(word("cd"), "c");\n');
  assert.equal(word?.ok, true);
  if (word?.ok) assert.match(word.files[0]!.content, /return a\[0\];/);
  const later = await open("head-guard:index0", "src/later.test.ts", 'import { later } from "./later.ts";\nassert.equal(later([1, 9, 3]), 9);\nassert.equal(later([4, 8, 6]), 8);\n');
  assert.equal(later?.ok, true);
  if (later?.ok) assert.match(later.files[0]!.content, /return a\[0\];/);
  const same = await open("head-guard:varies", "src/same.test.ts", 'import { same } from "./same.ts";\nassert.equal(same([1, 2]), 1);\nassert.equal(same([1, 9]), 1);\n');
  assert.equal(same?.ok, false);

  const chars = await open("rev-guard:strings", "src/chars.test.ts", 'import { chars } from "./chars.ts";\nassert.equal(chars(["a", "b"]), "ba");\nassert.equal(chars(["c", "d"]), "dc");\n');
  assert.equal(chars?.ok, true);
  if (chars?.ok) assert.match(chars.files[0]!.content, /return Array\.from\(a\)\.reverse\(\)\.join\(""\);/);
  const wrong = await open("rev-guard:reversed", "src/wrong.test.ts", 'import { wrong } from "./wrong.ts";\nassert.equal(wrong("ab"), "xx");\nassert.equal(wrong("cd"), "yy");\n');
  assert.equal(wrong?.ok, true);
  if (wrong?.ok) assert.match(wrong.files[0]!.content, /return Array\.from\(a\)\.reverse\(\)\.join\(""\);/);
  const pal = await open("rev-guard:not-identity", "src/pal.test.ts", 'import { pal } from "./pal.ts";\nassert.equal(pal("aba"), "aba");\nassert.equal(pal("cc"), "cc");\n');
  assert.equal(pal?.ok, false);

  const dropped = await open("spec-guard:be-undefined", "src/empty.test.ts", EMPTY_HEAD);
  assert.equal(dropped?.ok, true);
  if (dropped?.ok) {
    assert.match(dropped.files[0]!.content, /return 7;/);
    assert.equal(dropped.files[0]!.content.includes("a[0]"), false);
  }
  rmSync(base, { recursive: true, force: true });
});

test("a === true || a === false is not verified_strict on the published isBoolean calls", (t) => {
  if (!practiceSandboxReady()) { t.skip("bwrap is not installed on this host"); return; }
  const nodePath = visibleNodeBin();
  if (!nodePath) { t.skip("no visible node"); return; }
  const tree = (text: string) => {
    const dir = mkdtempSync(join(tmpdir(), "peaceai-bool-"));
    mkdirSync(join(dir, "src/predicate"), { recursive: true });
    writeFileSync(join(dir, "src/predicate/isBoolean.ts"), text);
    return dir;
  };
  const candidate = tree("export function isBoolean(a: unknown): boolean {\n  return a === true || a === false;\n}\n");
  const fix = tree(pinned("es-toolkit-isBoolean.ts.txt"));
  // Every value the published spec passes to isBoolean, including arr.filter(isBoolean).
  const args = [[true], [false], [0], ["abc"], [123], [{ a: 1 }], [[1, 2, 3]], [1], [2], [4]];
  try {
    const grade = gradeBehavior({
      candidateRoot: candidate, fixRoot: fix, nodePath,
      target: { symbol: "isBoolean", file: "src/predicate/isBoolean.ts", form: "named", exportName: "isBoolean", args },
    });
    assert.equal(grade.behavior, "verified_test_only");
    assert.equal(grade.counterexample, undefined);
    assert.equal(grade.compared, 51);
  } finally {
    rmSync(candidate, { recursive: true, force: true });
    rmSync(fix, { recursive: true, force: true });
  }
});
