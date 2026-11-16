// Drop, drop-right, take-right, capitalize, upper-first, lower-first, and strict
// undefined. The admitting cases are toss/es-toolkit at
// 24e7a7b8cb8035fae1ea2e7b507aab96698a38b9. Compact, uniq, flatten, sum, clamp,
// and isEmpty are not emitted. A passing log does not build a plan.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
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
const fixture = resolve(import.meta.dirname, "fixtures/m245");
const COMMIT = "24e7a7b8cb8035fae1ea2e7b507aab96698a38b9";

const PIN = {
  drop: "5c4579441945e6bf3289034f9069d6c71dcd4a56c02dcc437aad79ca3c78882e",
  dropTest: "81c93137683c2cfde23e55273403492649ff93dc61ae12381a86fd2abf24f93e",
  dropRight: "5eb748d9ee70c60419cfe5b64453c8207533450c74f4e2997d242237970ed8e5",
  dropRightTest: "666440fafb748ab3e9c0eee0f5a62d777eb04558dc98590b792171a433b3cfce",
  takeRight: "fcb383d481363d7ab0164c223e32977e940bf996d926a9e315d29fbe43cbf020",
  takeRightTest: "455ace54f70de6f69b6ebc664e24c77ffd107f5250c3ad38eef67a0961bc768c",
  capitalize: "20cc4e0267f1adb2dd92cfd323cce38dbc404613b911835ca45913efb2f74de4",
  capitalizeTest: "911e9e95197faad6f7928521518d277121010693a5928ad6f2a33931f91b35d8",
  upperFirst: "afc2584da491015b29b7bd1383dc8dfabae11671751c1c3c6da5b67953793162",
  upperFirstTest: "92be50abc731b174c9d9a5b14d6b592f92f38f5ec5545754d7e2d560dbc7ab77",
  lowerFirst: "ccb6e2498e4f918570eef4a80500c03a9b9456bc47b68c20463b91acc527b179",
  lowerFirstTest: "d71eb73afcbd84546205d8a15f6468113915e2c8579a302610be349766ba2791",
  isUndefined: "f68132c585572869b3b61c78d40e590b61d7101499ef19d8b501572951413e40",
  isUndefinedTest: "72a2e355b74e5e0485ad39556ecdf562b6eef9de02fcafdea6aca64e9a26e7ef",
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
  "  };",
  "  return api;",
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
  const dir = mkdtempSync(join(tmpdir(), "peaceai-m245-"));
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

test("toss/es-toolkit drop, dropRight, takeRight, case, and isUndefined are admitted", async () => {
  const cases = [
    { local: "drop", dir: "src/array", source: "es-toolkit-drop.ts.txt", spec: "es-toolkit-drop.spec.ts.txt", sourceSha: PIN.drop, specSha: PIN.dropTest, shape: "drop", body: /return a\.slice\(Math\.max\(b, 0\)\);/ },
    { local: "dropRight", dir: "src/array", source: "es-toolkit-dropRight.ts.txt", spec: "es-toolkit-dropRight.spec.ts.txt", sourceSha: PIN.dropRight, specSha: PIN.dropRightTest, shape: "dropright", body: /return Math\.min\(-b, 0\) === 0 \? a\.slice\(\) : a\.slice\(0, Math\.min\(-b, 0\)\);/ },
    { local: "takeRight", dir: "src/array", source: "es-toolkit-takeRight.ts.txt", spec: "es-toolkit-takeRight.spec.ts.txt", sourceSha: PIN.takeRight, specSha: PIN.takeRightTest, shape: "takeright", body: /return b <= 0 \? \[\] : a\.slice\(-b\);/ },
    { local: "capitalize", dir: "src/string", source: "es-toolkit-capitalize.ts.txt", spec: "es-toolkit-capitalize.spec.ts.txt", sourceSha: PIN.capitalize, specSha: PIN.capitalizeTest, shape: "capitalize", body: /return a\.charAt\(0\)\.toUpperCase\(\) \+ a\.slice\(1\)\.toLowerCase\(\);/ },
    { local: "upperFirst", dir: "src/string", source: "es-toolkit-upperFirst.ts.txt", spec: "es-toolkit-upperFirst.spec.ts.txt", sourceSha: PIN.upperFirst, specSha: PIN.upperFirstTest, shape: "upper", body: /return a\.charAt\(0\)\.toUpperCase\(\) \+ a\.slice\(1\);/ },
    { local: "lowerFirst", dir: "src/string", source: "es-toolkit-lowerFirst.ts.txt", spec: "es-toolkit-lowerFirst.spec.ts.txt", sourceSha: PIN.lowerFirst, specSha: PIN.lowerFirstTest, shape: "lower", body: /return a\.charAt\(0\)\.toLowerCase\(\) \+ a\.slice\(1\);/ },
    { local: "isUndefined", dir: "src/predicate", source: "es-toolkit-isUndefined.ts.txt", spec: "es-toolkit-isUndefined.spec.ts.txt", sourceSha: PIN.isUndefined, specSha: PIN.isUndefinedTest, shape: "undef", body: /return a === undefined;/ },
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
  const quiet = "import { quiet } from './quiet';\nexpect(quiet([1, 2], 1)).toEqual([2]);\nexpect(quiet([1, 2], -1)).toEqual([1, 2]);\n";
  assert.equal(scaffoldPlan("src/quiet.spec.ts", quiet, "ok\n", PATTERN, [], () => null), null);
});

test("a front drop, a back drop, and a back take are different slices", () => {
  const front = admit("src/front.spec.ts", [
    "import { front } from './front';",
    "expect(front([1, 2, 3], 1)).toEqual([2, 3]);",
    "expect(front(['a', 'b', 'c', 'd'], 2)).toEqual(['c', 'd']);",
    "expect(front([1, 2, 3], -1)).toEqual([1, 2, 3]);",
    "expect(front([1, 2, 3], 0)).toEqual([1, 2, 3]);",
  ].join("\n"), "src/front.ts");
  assert.match(bodyOf(front), /return a\.slice\(Math\.max\(b, 0\)\);/);
  const back = admit("src/back.spec.ts", [
    "import { back } from './back';",
    "expect(back([1, 2, 3], 1)).toEqual([1, 2]);",
    "expect(back(['a', 'b', 'c', 'd'], 2)).toEqual(['a', 'b']);",
    "expect(back([1, 2, 3], 0)).toEqual([1, 2, 3]);",
    "expect(back([1, 2, 3], -2)).toEqual([1, 2, 3]);",
  ].join("\n"), "src/back.ts");
  assert.match(bodyOf(back), /return Math\.min\(-b, 0\) === 0 \? a\.slice\(\) : a\.slice\(0, Math\.min\(-b, 0\)\);/);
  const tail = admit("src/end.spec.ts", [
    "import { end } from './end';",
    "expect(end([1, 2, 3, 4], 2)).toEqual([3, 4]);",
    "expect(end(['a', 'b', 'c'], 1)).toEqual(['c']);",
    "expect(end([1, 2, 3], 0)).toEqual([]);",
    "expect(end([1, 2, 3], -1)).toEqual([]);",
    "expect(end([1], 5)).toEqual([1]);",
  ].join("\n"), "src/end.ts");
  assert.match(bodyOf(tail), /return b <= 0 \? \[\] : a\.slice\(-b\);/);
  const prefix = admit("src/prefix.spec.ts", [
    "import { prefix } from './prefix';",
    "expect(prefix([1, 2, 3], 2)).toEqual([1, 2]);",
    "expect(prefix(['a', 'b', 'c'], 1)).toEqual(['a']);",
  ].join("\n"), "src/prefix.ts");
  assert.match(bodyOf(prefix), /return a\.slice\(0, b\);/);
  const word = admit("src/word.spec.ts", "import { word } from './word';\nexpect(word('abcd', 1)).toEqual('bcd');\nexpect(word('xy', -1)).toEqual('xy');\n", "src/word.ts");
  assert.equal(word?.ok, false);
  const positive = admit("src/positive.spec.ts", "import { positive } from './positive';\nexpect(positive([1, 2, 3], 1)).toEqual([2, 3]);\nexpect(positive([4, 5, 6], 2)).toEqual([6]);\n", "src/positive.ts");
  assert.equal(positive?.ok, false);
  const open = admit("src/open.spec.ts", "import { open } from './open';\nexpect(open([1, 2, 3], Infinity)).toEqual([]);\nexpect(open([1, 2, 3], 1)).toEqual([2, 3]);\n", "src/open.ts");
  assert.equal(open?.ok, false);
  const same = admit("src/same.spec.ts", "import { same } from './same';\nexpect(same([], -1)).toEqual([]);\nexpect(same([], 4)).toEqual([]);\n", "src/same.ts");
  assert.match(bodyOf(same), /return \[\];/);
});

const DROP_RIGHT = "  return Math.min(-b, 0) === 0 ? a.slice() : a.slice(0, Math.min(-b, 0));";
const TAKE_RIGHT = "  return b <= 0 ? [] : a.slice(-b);";

function runReturn(body: string, args: unknown[]): unknown {
  return new Function("a", "b", body)(...args);
}

function loadPublished(source: string, name: string): (a: unknown[], b: unknown) => unknown {
  const js = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    fileName: `${name}.ts`,
  }).outputText.replace(/^export /m, "");
  return new Function(`${js}\nreturn ${name};`)() as (a: unknown[], b: unknown) => unknown;
}

test("dropRight and takeRight follow the published count on NaN, undefined, fractions, and a long count", () => {
  const back = admit("src/nanback.spec.ts", [
    "import { nanback } from './nanback';",
    "expect(nanback([1, 2, 3, 4], 1)).toEqual([1, 2, 3]);",
    "expect(nanback([1.2, 2.3, 3.4], 1.5)).toEqual([1.2, 2.3]);",
    "expect(nanback([1, 2, 3], 0)).toEqual([1, 2, 3]);",
    "expect(nanback([1, 2, 3], -1)).toEqual([1, 2, 3]);",
    "expect(nanback([1, 2, 3], 4)).toEqual([]);",
    "expect(nanback([1, 2, 3], NaN)).toEqual([]);",
    "expect(nanback([1, 2, 3], undefined)).toEqual([]);",
  ].join("\n"), "src/nanback.ts");
  const backBody = bodyOf(back);
  assert.match(backBody, /return Math\.min\(-b, 0\) === 0 \? a\.slice\(\) : a\.slice\(0, Math\.min\(-b, 0\)\);/);
  const end = admit("src/nanend.spec.ts", [
    "import { nanend } from './nanend';",
    "expect(nanend([1, 2, 3, 4], 2)).toEqual([3, 4]);",
    "expect(nanend([1, 2, 3, 4], 1.5)).toEqual([4]);",
    "expect(nanend([1, 2, 3], 0)).toEqual([]);",
    "expect(nanend([1, 2, 3], -1)).toEqual([]);",
    "expect(nanend([1, 2, 3], 5)).toEqual([1, 2, 3]);",
    "expect(nanend([1, 2, 3], NaN)).toEqual([1, 2, 3]);",
    "expect(nanend([1, 2, 3], undefined)).toEqual([1, 2, 3]);",
  ].join("\n"), "src/nanend.ts");
  const endBody = bodyOf(end);
  assert.match(endBody, /return b <= 0 \? \[\] : a\.slice\(-b\);/);
  const publishedDrop = loadPublished(pinned("es-toolkit-dropRight.ts.txt"), "dropRight");
  const publishedTake = loadPublished(pinned("es-toolkit-takeRight.ts.txt"), "takeRight");
  const counts: unknown[] = [1, 1.5, 0, -1, 4, 5, Number.NaN, undefined, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY];
  for (const count of counts) {
    const arr = [1, 2, 3];
    assert.deepEqual(runReturn(DROP_RIGHT, [arr, count]), publishedDrop(arr, count), `dropRight ${String(count)}`);
    assert.deepEqual(runReturn(TAKE_RIGHT, [arr, count]), publishedTake(arr, count), `takeRight ${String(count)}`);
    assert.deepEqual(runReturn(DROP_RIGHT, [[], count]), publishedDrop([], count), `dropRight empty ${String(count)}`);
    assert.deepEqual(runReturn(TAKE_RIGHT, [[], count]), publishedTake([], count), `takeRight empty ${String(count)}`);
  }
  const kept = admit("src/keptnan.spec.ts", [
    "import { keptnan } from './keptnan';",
    "expect(keptnan([1, 2, 3], 1)).toEqual([1, 2]);",
    "expect(keptnan([1, 2, 3], 0)).toEqual([1, 2, 3]);",
    "expect(keptnan([1, 2, 3], NaN)).toEqual([1, 2, 3]);",
    "expect(keptnan([1, 2, 3], undefined)).toEqual([1, 2, 3]);",
  ].join("\n"), "src/keptnan.ts");
  assert.equal(kept?.ok, false);
  const emptied = admit("src/emptied.spec.ts", [
    "import { emptied } from './emptied';",
    "expect(emptied([1, 2, 3, 4], 2)).toEqual([3, 4]);",
    "expect(emptied([1, 2, 3], 0)).toEqual([]);",
    "expect(emptied([1, 2, 3], NaN)).toEqual([]);",
    "expect(emptied([1, 2, 3], undefined)).toEqual([]);",
  ].join("\n"), "src/emptied.ts");
  assert.equal(emptied?.ok, false);
});

test("capitalize, upper first, and lower first need a tail that tells them apart", () => {
  const cap = admit("src/cap.spec.ts", [
    "import { cap } from './cap';",
    "expect(cap('fred')).toEqual('Fred');",
    "expect(cap('FRED')).toEqual('Fred');",
    "expect(cap('')).toEqual('');",
  ].join("\n"), "src/cap.ts");
  assert.match(bodyOf(cap), /return a\.charAt\(0\)\.toUpperCase\(\) \+ a\.slice\(1\)\.toLowerCase\(\);/);
  const upper = admit("src/upper.spec.ts", [
    "import { upper } from './upper';",
    "expect(upper('fred')).toEqual('Fred');",
    "expect(upper('FRED')).toEqual('FRED');",
    "expect(upper('')).toEqual('');",
  ].join("\n"), "src/upper.ts");
  assert.match(bodyOf(upper), /return a\.charAt\(0\)\.toUpperCase\(\) \+ a\.slice\(1\);/);
  assert.equal(bodyOf(upper).includes("toLowerCase"), false);
  const lower = admit("src/lower.spec.ts", [
    "import { lower } from './lower';",
    "expect(lower('Fred')).toEqual('fred');",
    "expect(lower('FRED')).toEqual('fRED');",
    "expect(lower('')).toEqual('');",
  ].join("\n"), "src/lower.ts");
  assert.match(bodyOf(lower), /return a\.charAt\(0\)\.toLowerCase\(\) \+ a\.slice\(1\);/);
  const either = admit("src/either.spec.ts", [
    "import { either } from './either';",
    "expect(either('fred')).toEqual('Fred');",
    "expect(either('blue')).toEqual('Blue');",
  ].join("\n"), "src/either.ts");
  assert.equal(either?.ok, false);
  const whole = admit("src/whole.spec.ts", "import { whole } from './whole';\nexpect(whole('Fred')).toEqual('fred');\nexpect(whole('Blue')).toEqual('blue');\n", "src/whole.ts");
  assert.equal(whole?.ok, false);
  const repeated = admit("src/repeated.spec.ts", "import { repeated } from './repeated';\nexpect(repeated('AA')).toEqual('Aa');\nexpect(repeated('Aa')).toEqual('Aa');\n", "src/repeated.ts");
  assert.match(bodyOf(repeated), /return "Aa";/);
});

test("strict undefined needs null present and false, and nil stays the other polarity", () => {
  const missing = admit("src/missing.spec.ts", [
    "import { missing } from './missing';",
    "expect(missing(undefined)).toBe(true);",
    "expect(missing(null)).toBe(false);",
    "expect(missing(0)).toBe(false);",
    "expect(missing('')).toBe(false);",
  ].join("\n"), "src/missing.ts");
  assert.match(bodyOf(missing), /return a === undefined;/);
  const nil = admit("src/nil.spec.ts", [
    "import { nil } from './nil';",
    "expect(nil(null)).toBe(true);",
    "expect(nil(undefined)).toBe(true);",
    "expect(nil(0)).toBe(false);",
  ].join("\n"), "src/nil.ts");
  assert.match(bodyOf(nil), /return a == null;/);
  const present = admit("src/present.spec.ts", [
    "import { present } from './present';",
    "expect(present(null)).toBe(false);",
    "expect(present(undefined)).toBe(false);",
    "expect(present(0)).toBe(true);",
  ].join("\n"), "src/present.ts");
  assert.match(bodyOf(present), /return a != null;/);
  const noNull = admit("src/nonull.spec.ts", "import { nonull } from './nonull';\nexpect(nonull(undefined)).toBe(true);\nexpect(nonull(0)).toBe(false);\n", "src/nonull.ts");
  assert.equal(noNull?.ok, false);
  const other = admit("src/other.spec.ts", [
    "import { other } from './other';",
    "expect(other(undefined)).toBe(true);",
    "expect(other(null)).toBe(false);",
    "expect(other(1)).toBe(true);",
  ].join("\n"), "src/other.ts");
  assert.equal(other?.ok, false);
});

const base = resolve(root, "peaceai/test/.m245-mutants");
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

test("deleting a slice or case guard admits the case it refused", async () => {
  const open = async (guard: string, file: string, body: string) => {
    const mod = await mutant(guard) as typeof import("../lib/testspec.ts");
    return mod.scaffoldPlan(file, body, `Cannot find module '/work/${file.replace(/\.spec\.ts$/, ".ts")}'`, PATTERN, [], () => null);
  };
  const chars = await open("drop-guard:arrays", "src/chars.spec.ts", "import { chars } from './chars';\nexpect(chars('abcd', 1)).toEqual('bcd');\nexpect(chars('xy', -1)).toEqual('xy');\n");
  assert.equal(chars?.ok, true);
  if (chars?.ok) assert.match(chars.files[0]!.content, /return a\.slice\(Math\.max\(b, 0\)\);/);
  const middle = await open("drop-guard:rest", "src/middle.spec.ts", "import { middle } from './middle';\nexpect(middle([1, 2, 3], 1)).toEqual([1]);\nexpect(middle([4, 5, 6], -1)).toEqual([6]);\n");
  assert.equal(middle?.ok, true);
  if (middle?.ok) assert.match(middle.files[0]!.content, /return a\.slice\(Math\.max\(b, 0\)\);/);
  const later = await open("drop-guard:negative", "src/later.spec.ts", "import { later } from './later';\nexpect(later([1, 2, 3], 1)).toEqual([2, 3]);\nexpect(later(['a', 'b', 'c'], 2)).toEqual(['c']);\n");
  assert.equal(later?.ok, true);
  if (later?.ok) assert.match(later.files[0]!.content, /return a\.slice\(Math\.max\(b, 0\)\);/);
  const empty = await open("drop-guard:varies", "src/empty.spec.ts", "import { empty } from './empty';\nexpect(empty([], -1)).toEqual([]);\nexpect(empty([], 4)).toEqual([]);\n");
  assert.equal(empty?.ok, false);

  const letters = await open("dright-guard:arrays", "src/letters.spec.ts", "import { letters } from './letters';\nexpect(letters('abcd', 1)).toEqual('abc');\nexpect(letters('xy', -1)).toEqual('xy');\n");
  assert.equal(letters?.ok, true);
  if (letters?.ok) assert.match(letters.files[0]!.content, /return Math\.min\(-b, 0\) === 0 \? a\.slice\(\) : a\.slice\(0, Math\.min\(-b, 0\)\);/);
  const head = await open("dright-guard:rest", "src/headn.spec.ts", "import { headn } from './headn';\nexpect(headn([1, 2, 3], 1)).toEqual([3]);\nexpect(headn([4, 5, 6], 0)).toEqual([4]);\n");
  assert.equal(head?.ok, true);
  if (head?.ok) assert.match(head.files[0]!.content, /return Math\.min\(-b, 0\) === 0 \? a\.slice\(\) : a\.slice\(0, Math\.min\(-b, 0\)\);/);
  const onlyPos = await open("dright-guard:nonpos", "src/onlypos.spec.ts", "import { onlypos } from './onlypos';\nexpect(onlypos([1, 2, 3], 1)).toEqual([1, 2]);\nexpect(onlypos(['a', 'b', 'c', 'd'], 2)).toEqual(['a', 'b']);\n");
  assert.equal(onlyPos?.ok, true);
  if (onlyPos?.ok) assert.match(onlyPos.files[0]!.content, /return Math\.min\(-b, 0\) === 0 \? a\.slice\(\) : a\.slice\(0, Math\.min\(-b, 0\)\);/);
  const blanks = await open("dright-guard:varies", "src/blanks.spec.ts", "import { blanks } from './blanks';\nexpect(blanks([], 0)).toEqual([]);\nexpect(blanks([], -2)).toEqual([]);\n");
  assert.equal(blanks?.ok, false);

  const text = await open("tright-guard:arrays", "src/text.spec.ts", "import { text } from './text';\nexpect(text('abcd', 2)).toEqual('cd');\nexpect(text('xy', 0)).toEqual([]);\n");
  assert.equal(text?.ok, true);
  if (text?.ok) assert.match(text.files[0]!.content, /return b <= 0 \? \[\] : a\.slice\(-b\);/);
  const front = await open("tright-guard:rest", "src/frontn.spec.ts", "import { frontn } from './frontn';\nexpect(frontn([1, 2, 3], 1)).toEqual([1]);\nexpect(frontn([4, 5, 6], -1)).toEqual([4, 5, 6]);\n");
  assert.equal(front?.ok, true);
  if (front?.ok) assert.match(front.files[0]!.content, /return b <= 0 \? \[\] : a\.slice\(-b\);/);
  const counted = await open("tright-guard:nonpos", "src/counted.spec.ts", "import { counted } from './counted';\nexpect(counted([1, 2, 3, 4], 2)).toEqual([3, 4]);\nexpect(counted(['a', 'b', 'c'], 1)).toEqual(['c']);\n");
  assert.equal(counted?.ok, true);
  if (counted?.ok) assert.match(counted.files[0]!.content, /return b <= 0 \? \[\] : a\.slice\(-b\);/);
  const zeros = await open("tright-guard:varies", "src/zeros.spec.ts", "import { zeros } from './zeros';\nexpect(zeros([1], 0)).toEqual([]);\nexpect(zeros([2], -3)).toEqual([]);\n");
  assert.equal(zeros?.ok, false);

  const shouted = await open("cap-guard:cased", "src/shouted.spec.ts", "import { shouted } from './shouted';\nexpect(shouted('fred')).toEqual('FRED');\nexpect(shouted('blue')).toEqual('BLUE');\n");
  assert.equal(shouted?.ok, true);
  if (shouted?.ok) assert.match(shouted.files[0]!.content, /return a\.charAt\(0\)\.toUpperCase\(\) \+ a\.slice\(1\)\.toLowerCase\(\);/);
  const already = await open("cap-guard:lowered", "src/already.spec.ts", "import { already } from './already';\nexpect(already('fred')).toEqual('Fred');\nexpect(already('blue')).toEqual('Blue');\n");
  assert.equal(already?.ok, true);
  if (already?.ok) assert.match(already.files[0]!.content, /toLowerCase\(\)/);
  const oneCap = await open("cap-guard:varies", "src/onecap.spec.ts", "import { onecap } from './onecap';\nexpect(onecap('AA')).toEqual('Aa');\nexpect(onecap('Aa')).toEqual('Aa');\n");
  assert.equal(oneCap?.ok, false);

  const allUp = await open("upper-guard:cased", "src/allup.spec.ts", "import { allup } from './allup';\nexpect(allup('fred')).toEqual('FRED');\nexpect(allup('blue')).toEqual('BLUE');\n");
  assert.equal(allUp?.ok, true);
  if (allUp?.ok) assert.match(allUp.files[0]!.content, /return a\.charAt\(0\)\.toUpperCase\(\) \+ a\.slice\(1\);/);
  const soft = await open("upper-guard:kept", "src/soft.spec.ts", "import { soft } from './soft';\nexpect(soft('fred')).toEqual('Fred');\nexpect(soft('blue')).toEqual('Blue');\n");
  assert.equal(soft?.ok, true);
  if (soft?.ok) assert.match(soft.files[0]!.content, /return a\.charAt\(0\)\.toUpperCase\(\) \+ a\.slice\(1\);/);
  const oneUpper = await open("upper-guard:varies", "src/oneupper.spec.ts", "import { oneupper } from './oneupper';\nexpect(oneupper('FRED')).toEqual('FRED');\nexpect(oneupper('FRED')).toEqual('FRED');\n");
  assert.equal(oneUpper?.ok, false);

  const allDown = await open("lower-guard:cased", "src/alldown.spec.ts", "import { alldown } from './alldown';\nexpect(alldown('FRED')).toEqual('fred');\nexpect(alldown('Ab')).toEqual('AB');\n");
  assert.equal(allDown?.ok, true);
  if (allDown?.ok) assert.match(allDown.files[0]!.content, /return a\.charAt\(0\)\.toLowerCase\(\) \+ a\.slice\(1\);/);
  const flat = await open("lower-guard:kept", "src/flat.spec.ts", "import { flat } from './flat';\nexpect(flat('Fred')).toEqual('fred');\nexpect(flat('Blue')).toEqual('blue');\n");
  assert.equal(flat?.ok, true);
  if (flat?.ok) assert.match(flat.files[0]!.content, /return a\.charAt\(0\)\.toLowerCase\(\) \+ a\.slice\(1\);/);
  const oneLower = await open("lower-guard:varies", "src/onelower.spec.ts", "import { onelower } from './onelower';\nexpect(onelower('FRED')).toEqual('fRED');\nexpect(onelower('FRED')).toEqual('fRED');\n");
  assert.equal(oneLower?.ok, false);

  const hidden = await open("undef-guard:null-false", "src/hidden.spec.ts", "import { hidden } from './hidden';\nexpect(hidden(undefined)).toBe(true);\nexpect(hidden(0)).toBe(false);\nexpect(hidden('')).toBe(false);\n");
  assert.equal(hidden?.ok, true);
  if (hidden?.ok) assert.match(hidden.files[0]!.content, /return a === undefined;/);
  const keptTrue = await open("undef-guard:others-false", "src/kept.spec.ts", "import { kept } from './kept';\nexpect(kept(undefined)).toBe(true);\nexpect(kept(null)).toBe(false);\nexpect(kept(1)).toBe(true);\nexpect(kept(0)).toBe(false);\n");
  assert.equal(keptTrue?.ok, true);
  if (keptTrue?.ok) assert.match(keptTrue.files[0]!.content, /return a === undefined;/);
  const flipped = await open("undef-guard:undef-true", "src/flipped.spec.ts", "import { flipped } from './flipped';\nexpect(flipped(undefined)).toBe(false);\nexpect(flipped(null)).toBe(false);\nexpect(flipped(0)).toBe(false);\n");
  assert.equal(flipped?.ok, false);
  rmSync(base, { recursive: true, force: true });
});

test("a near-miss that the published calls accept is verified_test_only", (t) => {
  if (!practiceSandboxReady()) { t.skip("bwrap is not installed on this host"); return; }
  const nodePath = visibleNodeBin();
  if (!nodePath) { t.skip("no visible node"); return; }
  const rows = [
    {
      symbol: "drop", file: "src/array/drop.ts",
      fix: pinned("es-toolkit-drop.ts.txt"),
      candidate: "export function drop<T>(a: readonly T[], b: number): T[] {\n  return a.slice(b);\n}\n",
      args: [[[1.2, 2.3, 3.4], 1], [["a", "b", "c", "d"], 2], [[1.2, 2.3, 3.4], 0], [[1.2, 2.3, 3.4], -1], [[1.2, 2.3, 3.4], 1.5], [[1.2, 2.3, 3.4], 4]],
    },
    {
      symbol: "dropRight", file: "src/array/dropRight.ts",
      fix: pinned("es-toolkit-dropRight.ts.txt"),
      candidate: "export function dropRight<T>(a: readonly T[], b: number): T[] {\n  return a.slice(0, -b);\n}\n",
      args: [[[1.2, 2.3, 3.4], 1], [["a", "b", "c", "d"], 2], [[1.2, 2.3, 3.4], 0], [[1.2, 2.3, 3.4], -1], [[1.2, 2.3, 3.4], 1.5], [[1.2, 2.3, 3.4], 4]],
    },
    {
      symbol: "takeRight", file: "src/array/takeRight.ts",
      fix: pinned("es-toolkit-takeRight.ts.txt"),
      candidate: "export function takeRight<T>(a: readonly T[], b: number): T[] {\n  return a.slice(-b);\n}\n",
      args: [[[1, 2, 3, 4, 5], 2], [["a", "b", "c", "d"], 2], [[true, false, true], 1], [[1, 2, 3], 5], [[1, 2, 3], 0], [[], 3], [[1, 2, 3], -1], [[1, 2, 3], -5]],
    },
    {
      symbol: "capitalize", file: "src/string/capitalize.ts",
      fix: pinned("es-toolkit-capitalize.ts.txt"),
      candidate: "export function capitalize(a: string): string {\n  return a.charAt(0).toUpperCase() + a.slice(1);\n}\n",
      args: [["fred"], ["FRED"], ["special@characters!"], ["hyphen-text"], [" fred"], ["Fred"], [""]],
    },
    {
      symbol: "upperFirst", file: "src/string/upperFirst.ts",
      fix: pinned("es-toolkit-upperFirst.ts.txt"),
      candidate: "export function upperFirst(a: string): string {\n  return a.toUpperCase();\n}\n",
      args: [["fred"], ["Fred"], ["FRED"], [""], ["  fred"]],
    },
    {
      symbol: "lowerFirst", file: "src/string/lowerFirst.ts",
      fix: pinned("es-toolkit-lowerFirst.ts.txt"),
      candidate: "export function lowerFirst(a: string): string {\n  return a.toLowerCase();\n}\n",
      args: [["Fred"], ["fred"], ["FRED"], [""], ["  fred"]],
    },
    {
      symbol: "isUndefined", file: "src/predicate/isUndefined.ts",
      fix: pinned("es-toolkit-isUndefined.ts.txt"),
      candidate: "export function isUndefined(a: unknown): boolean {\n  return a == null;\n}\n",
      args: [[undefined], [null], [""], [123]],
    },
  ];
  const trees: string[] = [];
  try {
    for (const row of rows) {
      const tree = (text: string) => {
        const dir = mkdtempSync(join(tmpdir(), "peaceai-m245-grade-"));
        mkdirSync(join(dir, row.file, ".."), { recursive: true });
        writeFileSync(join(dir, row.file), text);
        trees.push(dir);
        return dir;
      };
      const grade = gradeBehavior({
        candidateRoot: tree(row.candidate), fixRoot: tree(row.fix), nodePath,
        target: { symbol: row.symbol, file: row.file, form: "named", exportName: row.symbol, args: row.args },
      });
      assert.equal(grade.behavior, "verified_test_only", row.symbol);
      assert.ok(grade.counterexample, row.symbol);
    }
  } finally {
    for (const dir of trees) rmSync(dir, { recursive: true, force: true });
  }
});
