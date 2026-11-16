// Words, kebab, snake, camel, difference, intersection, at, and lerp.
// The admitting cases are toss/es-toolkit at
// 24e7a7b8cb8035fae1ea2e7b507aab96698a38b9. Compact, uniq, trim, clamp, and
// isEmpty are not emitted. A passing log does not build a plan. Published
// modules run inside the practice sandbox.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import ts from "typescript";
import { practiceSandboxReady, runInPracticeSandbox, visibleNodeBin } from "../lib/practicemine.ts";
import { gradeBehavior } from "../lib/specgrade.ts";
import { scaffoldPlan } from "../lib/testspec.ts";

const PATTERN = "^src/.+\\.ts$";
const root = resolve(import.meta.dirname, "../..");
const fixture = resolve(import.meta.dirname, "fixtures/m246");
const COMMIT = "24e7a7b8cb8035fae1ea2e7b507aab96698a38b9";

const PIN = {
  words: "612783f0021b254c934f25855ec0dd65bb5a9fd9688866fffa2b0d7b0343652b",
  wordsTest: "c6d676aa509a8f473bef5d5d60679a40b314b73c682523b31b9c4b5967cdf983",
  kebabCase: "4c0990f1db45254399e9d887bb4da7fba768c93e3cd6768e21400bb597bdc85d",
  kebabCaseTest: "2b2dd708ca7dbf53d475f5731255c5eee02dec3e31c903bf9cb8d02e0df21f4f",
  snakeCase: "fe05440ec8e3685ec6332d4ee289d95cc65fdf781ed196431cf6190dd706342e",
  snakeCaseTest: "09d492ee7b30eb3270eeb0a74977c4e69561bec96c9de33a8aebe06d182e72dd",
  camelCase: "189d485e620c4e8d6726b4f7975021b6e14ffc73598120287272f509d5b7387c",
  camelCaseTest: "7be65073d407859b5f15c5c35d80a34f7552fa16ad2f5f2933a6c9a773238dca",
  difference: "f97ab633402c509e5467190363b1e19c97b5996be6a75338f02127b234e1b553",
  differenceTest: "106f5446a60f7b79d55109434a8d4eaded30387783d4daf1fdaa8454c758c7cf",
  intersection: "4788b77752e7bcd518fedc2f65486473b1ea38927393651d76024fb3e8a260d8",
  intersectionTest: "13a4c055206ba0f9d4f0815abf8a30b6ae70a84030605adfe13dd88c3ae04d4a",
  at: "64368d9f84ad5b0987678cf2c3f92c58dc38ce692ab9e4f2dc967523cd4b7b9e",
  atTest: "cf877ed7460c78857a1ae726da0b6b88099d46048a3eb231598b33326be16e0e",
  lerp: "cff5090bbd24fa1d5cbcc93e79db8577edd89d6e345f1b56c369d7ee4a007650",
  lerpTest: "7360c7be41d0b968069804c45a08d4dfb4d1bf7d520dc8dd4ac724cfc8017187",
  capitalize: "20cc4e0267f1adb2dd92cfd323cce38dbc404613b911835ca45913efb2f74de4",
};

const WORD = "Array.from(a.match(/\\p{Lu}?\\p{Ll}+|[0-9]+|\\p{Lu}+(?!\\p{Ll})|\\p{Emoji_Presentation}|\\p{Extended_Pictographic}|\\p{L}+/gu) ?? [])";

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
  "    toBeCloseTo(expected, precision = 2) {",
  "      const limit = (10 ** -precision) / 2;",
  "      if (!(Math.abs(expected - actual) < limit)) throw new Error(String(actual) + ' not close to ' + String(expected));",
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

function transpile(file: string, text: string): string {
  return ts.transpileModule(text, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    fileName: file,
  }).outputText.replace(/from (['"])(\.\/[^'"]+)\.ts\1/g, "from $1$2.mjs$1");
}

function publishedTest(text: string, local: string): string {
  return text
    .replaceAll("from 'vitest'", "from './shim.mjs'")
    .replaceAll('from "vitest"', 'from "./shim.mjs"')
    .replaceAll(`from './${local}'`, `from './${local}.mjs'`)
    .replaceAll(`from "./${local}"`, `from "./${local}.mjs"`);
}

function runBoxed(files: Record<string, string>, entry = "run.mjs"): { code: number | null; stdout: string } {
  const node = visibleNodeBin();
  assert.ok(node, "visible node");
  const dir = mkdtempSync(join(tmpdir(), "peaceai-m246-"));
  try {
    for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
    const ran = runInPracticeSandbox(dir, [node!, entry], 20_000, { capture: true, nodePath: node });
    assert.equal(ran.unsafe, false, ran.stdout);
    return { code: ran.code, stdout: ran.stdout };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function admit(specFile: string, spec: string, moduleFile: string) {
  return scaffoldPlan(specFile, spec, `Cannot find module '/work/${moduleFile}'`, PATTERN, [], () => null);
}

test("toss/es-toolkit words, case joins, difference, intersection, at, and lerp are admitted", () => {
  assert.equal(practiceSandboxReady(), true, "bwrap");
  const words = pinned("es-toolkit-words.ts.txt");
  const capitalize = readFileSync(resolve(import.meta.dirname, "fixtures/m245/es-toolkit-capitalize.ts.txt"), "utf8");
  assert.equal(sha256(capitalize), PIN.capitalize);
  const deps: Record<string, Record<string, string>> = {
    words: {},
    kebabCase: { "words.mjs": transpile("words.ts", words) },
    snakeCase: { "words.mjs": transpile("words.ts", words) },
    camelCase: { "words.mjs": transpile("words.ts", words), "capitalize.mjs": transpile("capitalize.ts", capitalize) },
    difference: {},
    intersection: {},
    at: {},
    lerp: {},
  };
  const cases = [
    { local: "words", dir: "src/string", source: "es-toolkit-words.ts.txt", spec: "es-toolkit-words.spec.ts.txt", sourceSha: PIN.words, specSha: PIN.wordsTest, shape: "words", body: `return ${WORD};` },
    { local: "kebabCase", dir: "src/string", source: "es-toolkit-kebabCase.ts.txt", spec: "es-toolkit-kebabCase.spec.ts.txt", sourceSha: PIN.kebabCase, specSha: PIN.kebabCaseTest, shape: "kebab", body: `return ${WORD}.map((word) => word.toLowerCase()).join("-");` },
    { local: "snakeCase", dir: "src/string", source: "es-toolkit-snakeCase.ts.txt", spec: "es-toolkit-snakeCase.spec.ts.txt", sourceSha: PIN.snakeCase, specSha: PIN.snakeCaseTest, shape: "snake", body: `return ${WORD}.map((word) => word.toLowerCase()).join("_");` },
    { local: "camelCase", dir: "src/string", source: "es-toolkit-camelCase.ts.txt", spec: "es-toolkit-camelCase.spec.ts.txt", sourceSha: PIN.camelCase, specSha: PIN.camelCaseTest, shape: "camel", body: `return ((words) => words.length === 0 ? "" : words[0].toLowerCase() + words.slice(1).map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()).join(""))(${WORD});` },
    { local: "difference", dir: "src/array", source: "es-toolkit-difference.ts.txt", spec: "es-toolkit-difference.spec.ts.txt", sourceSha: PIN.difference, specSha: PIN.differenceTest, shape: "diff", body: "return a.filter((item) => !b.includes(item));" },
    { local: "intersection", dir: "src/array", source: "es-toolkit-intersection.ts.txt", spec: "es-toolkit-intersection.spec.ts.txt", sourceSha: PIN.intersection, specSha: PIN.intersectionTest, shape: "inter", body: "return a.filter((item) => b.includes(item));" },
    { local: "at", dir: "src/array", source: "es-toolkit-at.ts.txt", spec: "es-toolkit-at.spec.ts.txt", sourceSha: PIN.at, specSha: PIN.atTest, shape: "at", body: "return b.map((i) => a[(n => n < 0 ? n + a.length : n)(Number.isInteger(i) ? i : Math.trunc(i) || 0)]);" },
    { local: "lerp", dir: "src/math", source: "es-toolkit-lerp.ts.txt", spec: "es-toolkit-lerp.spec.ts.txt", sourceSha: PIN.lerp, specSha: PIN.lerpTest, shape: "lerp", body: "return c === 1 ? b : a + (b - a) * c;" },
  ];
  for (const row of cases) {
    const source = pinned(row.source);
    const spec = pinned(row.spec);
    assert.equal(sha256(source), row.sourceSha, row.local);
    assert.equal(sha256(spec), row.specSha, row.local);
    const specJs = transpile(`${row.local}.spec.ts`, publishedTest(spec, row.local));
    const missing = `export function ${row.local}(..._args) {\n  throw new Error("missing");\n}\n`;
    const before = runBoxed({ "shim.mjs": SHIM, "run.mjs": specJs, [`${row.local}.mjs`]: missing, ...deps[row.local] });
    assert.notEqual(before.code, 0, row.local);
    const after = runBoxed({ "shim.mjs": SHIM, "run.mjs": specJs, [`${row.local}.mjs`]: transpile(`${row.local}.ts`, source), ...deps[row.local] });
    assert.equal(after.code, 0, `${row.local}\n${after.stdout}`);
    const plan = admit(`${row.dir}/${row.local}.spec.ts`, spec, `${row.dir}/${row.local}.ts`);
    assert.equal(plan?.ok, true, row.local);
    if (!plan?.ok) continue;
    assert.equal(plan.fit.shape, row.shape, row.local);
    assert.ok(plan.files[0]!.content.includes(row.body), row.local);
    const built = runBoxed({ "shim.mjs": SHIM, "run.mjs": specJs, [`${row.local}.mjs`]: transpile(`${row.local}.ts`, plan.files[0]!.content) });
    assert.equal(built.code, 0, `${row.local} scaffold\n${built.stdout}`);
  }
  assert.equal(COMMIT.length, 40);
  const quiet = "import { quiet } from './quiet';\nexpect(quiet('HTTPRequest')).toEqual('http-request');\nexpect(quiet('foo bar')).toEqual('foo-bar');\n";
  assert.equal(scaffoldPlan("src/quiet.spec.ts", quiet, "ok\n", PATTERN, [], () => null), null);
});

test("a word split, a hyphen join, a camel join, a filter, an index, and a lerp are different shapes", () => {
  const parts = admit("src/parts.spec.ts", [
    "import { parts } from './parts';",
    "expect(parts('HTTPRequest')).toEqual(['HTTP', 'Request']);",
    "expect(parts('foo2bar')).toEqual(['foo', '2', 'bar']);",
    "expect(parts('')).toEqual([]);",
  ].join("\n"), "src/parts.ts");
  assert.ok(bodyOf(parts).includes(`return ${WORD};`));
  const dashed = admit("src/dashed.spec.ts", [
    "import { dashed } from './dashed';",
    "expect(dashed('HTTPRequest')).toEqual('http-request');",
    "expect(dashed('some whitespace')).toEqual('some-whitespace');",
    "expect(dashed('')).toEqual('');",
  ].join("\n"), "src/dashed.ts");
  assert.ok(bodyOf(dashed).includes('.join("-");'));
  const scored = admit("src/scored.spec.ts", [
    "import { scored } from './scored';",
    "expect(scored('HTTPRequest')).toEqual('http_request');",
    "expect(scored('some whitespace')).toEqual('some_whitespace');",
  ].join("\n"), "src/scored.ts");
  assert.ok(bodyOf(scored).includes('.join("_");'));
  const hump = admit("src/hump.spec.ts", [
    "import { hump } from './hump';",
    "expect(hump('HTTPRequest')).toEqual('httpRequest');",
    "expect(hump('some whitespace')).toEqual('someWhitespace');",
    "expect(hump('')).toEqual('');",
  ].join("\n"), "src/hump.ts");
  assert.ok(bodyOf(hump).includes("words[0].toLowerCase()"));
  const gone = admit("src/gone.spec.ts", [
    "import { gone } from './gone';",
    "expect(gone([1, 2, 3, 4], [2, 4])).toEqual([1, 3]);",
    "expect(gone([1, 2, 3], [1])).toEqual([2, 3]);",
    "expect(gone([], [1])).toEqual([]);",
  ].join("\n"), "src/gone.ts");
  assert.ok(bodyOf(gone).includes("!b.includes(item)"));
  const both = admit("src/both.spec.ts", [
    "import { both } from './both';",
    "expect(both([1, 2], [1, 3])).toEqual([1]);",
    "expect(both([1, 2], [3, 4])).toEqual([]);",
  ].join("\n"), "src/both.ts");
  assert.ok(bodyOf(both).includes("b.includes(item)"));
  assert.equal(bodyOf(both).includes("!b.includes"), false);
  const picked = admit("src/picked.spec.ts", [
    "import { picked } from './picked';",
    "expect(picked(['a', 'b', 'c'], [0, 2])).toEqual(['a', 'c']);",
    "expect(picked(['a', 'b', 'c'], [-1])).toEqual(['c']);",
    "expect(picked(['a', 'b', 'c'], [4])).toEqual([undefined]);",
  ].join("\n"), "src/picked.ts");
  assert.ok(bodyOf(picked).includes("Math.trunc(i) || 0"));
  const blend = admit("src/blend.spec.ts", [
    "import { blend } from './blend';",
    "expect(blend(0, 100, 0.5)).toBe(50);",
    "expect(blend(0, 100, 1.5)).toBe(150);",
    "expect(blend(-7.219779231267269, 9.792664575659987, 1)).toBe(9.792664575659987);",
  ].join("\n"), "src/blend.ts");
  assert.ok(bodyOf(blend).includes("c === 1 ? b : a + (b - a) * c"));
  const either = admit("src/either.spec.ts", "import { either } from './either';\nexpect(either('FOO')).toEqual('foo');\nexpect(either('BAR')).toEqual('bar');\n", "src/either.ts");
  assert.equal(either?.ok, false);
});

const KILLS: { guard: string; file: string; spec: string; body: string }[] = [
  { guard: "words-guard:strings", file: "src/wstrings.spec.ts", spec: "import { wstrings } from './wstrings';\nexpect(wstrings(['FOO', 'BAR'])).toEqual(['FOO', 'BAR']);\nexpect(wstrings(['a', 'b'])).toEqual(['a', 'b']);\n", body: `return ${WORD};` },
  { guard: "words-guard:split", file: "src/wsplit.spec.ts", spec: "import { wsplit } from './wsplit';\nexpect(wsplit('HTTPRequest')).toEqual(['http', 'request']);\nexpect(wsplit('foo bar')).toEqual(['FOO', 'BAR']);\n", body: `return ${WORD};` },
  { guard: "words-guard:camel", file: "src/wcamel.spec.ts", spec: "import { wcamel } from './wcamel';\nexpect(wcamel('--FOO-BAR--')).toEqual(['FOO', 'BAR']);\nexpect(wcamel('a b c')).toEqual(['a', 'b', 'c']);\n", body: `return ${WORD};` },
  { guard: "kebab-guard:strings", file: "src/kstrings.spec.ts", spec: "import { kstrings } from './kstrings';\nexpect(kstrings(['HTTP', 'Request'])).toEqual('http-request');\nexpect(kstrings(['Foo', 'Bar'])).toEqual('foo-bar');\n", body: '.join("-");' },
  { guard: "kebab-guard:joined", file: "src/kjoined.spec.ts", spec: "import { kjoined } from './kjoined';\nexpect(kjoined('HTTPRequest')).toEqual('HTTP-Request');\nexpect(kjoined('foo bar')).toEqual('foo_bar');\n", body: '.join("-");' },
  { guard: "kebab-guard:hyphen", file: "src/khyphen.spec.ts", spec: "import { khyphen } from './khyphen';\nexpect(khyphen('Lunedì')).toEqual('lunedì');\nexpect(khyphen('FOO')).toEqual('foo');\n", body: '.join("-");' },
  { guard: "kebab-guard:camel", file: "src/kcamel.spec.ts", spec: "import { kcamel } from './kcamel';\nexpect(kcamel('foo-bar')).toEqual('foo-bar');\nexpect(kcamel('a b')).toEqual('a-b');\n", body: '.join("-");' },
  { guard: "snake-guard:strings", file: "src/sstrings.spec.ts", spec: "import { sstrings } from './sstrings';\nexpect(sstrings(['HTTP', 'Request'])).toEqual('http_request');\nexpect(sstrings(['Foo', 'Bar'])).toEqual('foo_bar');\n", body: '.join("_");' },
  { guard: "snake-guard:joined", file: "src/sjoined.spec.ts", spec: "import { sjoined } from './sjoined';\nexpect(sjoined('HTTPRequest')).toEqual('HTTP_Request');\nexpect(sjoined('foo bar')).toEqual('foo-bar');\n", body: '.join("_");' },
  { guard: "snake-guard:underscore", file: "src/sunder.spec.ts", spec: "import { sunder } from './sunder';\nexpect(sunder('Lunedì')).toEqual('lunedì');\nexpect(sunder('FOO')).toEqual('foo');\n", body: '.join("_");' },
  { guard: "snake-guard:camel", file: "src/scamel.spec.ts", spec: "import { scamel } from './scamel';\nexpect(scamel('foo_bar')).toEqual('foo_bar');\nexpect(scamel('a b')).toEqual('a_b');\n", body: '.join("_");' },
  { guard: "camel-guard:strings", file: "src/cstrings.spec.ts", spec: "import { cstrings } from './cstrings';\nexpect(cstrings(['foo', 'bar'])).toEqual('fooBar');\nexpect(cstrings(['HTTP', 'Request'])).toEqual('httpRequest');\n", body: "words[0].toLowerCase()" },
  { guard: "camel-guard:joined", file: "src/cjoined.spec.ts", spec: "import { cjoined } from './cjoined';\nexpect(cjoined('HTTPRequest')).toEqual('httprequest');\nexpect(cjoined('foo bar')).toEqual('foo-bar');\n", body: "words[0].toLowerCase()" },
  { guard: "camel-guard:hump", file: "src/chump.spec.ts", spec: "import { chump } from './chump';\nexpect(chump('Lunedì')).toEqual('lunedì');\nexpect(chump('FOO')).toEqual('foo');\n", body: "words[0].toLowerCase()" },
  { guard: "camel-guard:boundary", file: "src/cbound.spec.ts", spec: "import { cbound } from './cbound';\nexpect(cbound('foo bar')).toEqual('fooBar');\nexpect(cbound('hyphen-text')).toEqual('hyphenText');\n", body: "words[0].toLowerCase()" },
  { guard: "diff-guard:arrays", file: "src/darrays.spec.ts", spec: "import { darrays } from './darrays';\nexpect(darrays('abcd', 'b')).toEqual(['a', 'c', 'd']);\nexpect(darrays('xy', 'z')).toEqual(['x', 'y']);\n", body: "!b.includes(item)" },
  { guard: "diff-guard:rest", file: "src/drest.spec.ts", spec: "import { drest } from './drest';\nexpect(drest([1, 2, 3], [2])).toEqual([1, 2]);\nexpect(drest([4, 5], [4])).toEqual([5, 4]);\n", body: "!b.includes(item)" },
  { guard: "diff-guard:removed", file: "src/dkept.spec.ts", spec: "import { dkept } from './dkept';\nexpect(dkept([1, 2], [9])).toEqual([1, 2]);\nexpect(dkept([3], [4])).toEqual([3]);\n", body: "!b.includes(item)" },
  { guard: "inter-guard:arrays", file: "src/iarrays.spec.ts", spec: "import { iarrays } from './iarrays';\nexpect(iarrays('abcd', 'bd')).toEqual(['b', 'd']);\nexpect(iarrays('xy', 'y')).toEqual(['y']);\n", body: "return a.filter((item) => b.includes(item));" },
  { guard: "inter-guard:rest", file: "src/irest.spec.ts", spec: "import { irest } from './irest';\nexpect(irest([1, 2], [1, 2])).toEqual([1]);\nexpect(irest([3, 4], [4])).toEqual([4, 3]);\n", body: "return a.filter((item) => b.includes(item));" },
  { guard: "inter-guard:drops", file: "src/ikept.spec.ts", spec: "import { ikept } from './ikept';\nexpect(ikept([1, 2], [2, 1])).toEqual([1, 2]);\nexpect(ikept(['a'], ['a', 'b'])).toEqual(['a']);\n", body: "return a.filter((item) => b.includes(item));" },
  { guard: "at-guard:arrays", file: "src/aarrays.spec.ts", spec: "import { aarrays } from './aarrays';\nexpect(aarrays('abcd', [0, 2])).toEqual(['a', 'c']);\nexpect(aarrays('xy', [-1])).toEqual(['y']);\n", body: "Math.trunc(i) || 0" },
  { guard: "at-guard:picked", file: "src/apicked.spec.ts", spec: "import { apicked } from './apicked';\nexpect(apicked(['a', 'b', 'c'], [0])).toEqual(['b']);\nexpect(apicked(['a', 'b', 'c'], [-1])).toEqual(['a']);\n", body: "Math.trunc(i) || 0" },
  { guard: "at-guard:negative", file: "src/aneg.spec.ts", spec: "import { aneg } from './aneg';\nexpect(aneg(['a', 'b', 'c'], [0, 2])).toEqual(['a', 'c']);\nexpect(aneg(['a', 'b', 'c'], [1])).toEqual(['b']);\n", body: "Math.trunc(i) || 0" },
  { guard: "lerp-guard:numbers", file: "src/lnumbers.spec.ts", spec: "import { lnumbers } from './lnumbers';\nexpect(lnumbers('1', '20', 0)).toEqual('10');\nexpect(lnumbers('1', '20', 1)).toEqual('20');\n", body: "c === 1 ? b : a + (b - a) * c" },
  { guard: "lerp-guard:line", file: "src/lline.spec.ts", spec: "import { lline } from './lline';\nexpect(lline(0, 100, 0.5)).toBe(40);\nexpect(lline(-7.219779231267269, 9.792664575659987, 1)).toBe(9.792664575659987);\n", body: "c === 1 ? b : a + (b - a) * c" },
  { guard: "lerp-guard:exact", file: "src/lexact.spec.ts", spec: "import { lexact } from './lexact';\nexpect(lexact(0, 100, 1)).toBe(100);\nexpect(lexact(0, 100, 0.5)).toBe(50);\n", body: "c === 1 ? b : a + (b - a) * c" },
  { guard: "lerp-guard:span", file: "src/lspan.spec.ts", spec: "import { lspan } from './lspan';\nexpect(lspan(-7.219779231267269, 9.792664575659987, 1)).toBe(9.792664575659987);\nexpect(lspan(0, 100, 1)).toBe(100);\n", body: "c === 1 ? b : a + (b - a) * c" },
];

test("a near-miss each guard names is refused", () => {
  for (const row of KILLS) {
    const plan = admit(row.file, row.spec, row.file.replace(/\.spec\.ts$/, ".ts"));
    assert.equal(plan?.ok, false, row.guard);
  }
});

const base = resolve(root, "peaceai/test/.m246-mutants");
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

test("deleting a word, index, or lerp guard admits the case it refused", async () => {
  for (const row of KILLS) {
    const mod = await mutant(row.guard) as typeof import("../lib/testspec.ts");
    const plan = mod.scaffoldPlan(row.file, row.spec, `Cannot find module '/work/${row.file.replace(/\.spec\.ts$/, ".ts")}'`, PATTERN, [], () => null);
    assert.equal(plan?.ok, true, row.guard);
    if (plan?.ok) assert.ok(plan.files[0]!.content.includes(row.body), row.guard);
  }
  rmSync(base, { recursive: true, force: true });
});

test("the scaffold matches the published function on NaN, undefined, holes, fractions, and an empty input", () => {
  assert.equal(practiceSandboxReady(), true, "bwrap");
  const words = pinned("es-toolkit-words.ts.txt");
  const capitalize = readFileSync(resolve(import.meta.dirname, "fixtures/m245/es-toolkit-capitalize.ts.txt"), "utf8");
  const files: Record<string, string> = {
    "words.mjs": transpile("words.ts", words),
    "capitalize.mjs": transpile("capitalize.ts", capitalize),
    "kebabCase.mjs": transpile("kebabCase.ts", pinned("es-toolkit-kebabCase.ts.txt")),
    "snakeCase.mjs": transpile("snakeCase.ts", pinned("es-toolkit-snakeCase.ts.txt")),
    "camelCase.mjs": transpile("camelCase.ts", pinned("es-toolkit-camelCase.ts.txt")),
    "difference.mjs": transpile("difference.ts", pinned("es-toolkit-difference.ts.txt")),
    "intersection.mjs": transpile("intersection.ts", pinned("es-toolkit-intersection.ts.txt")),
    "at.mjs": transpile("at.ts", pinned("es-toolkit-at.ts.txt")),
    "lerp.mjs": transpile("lerp.ts", pinned("es-toolkit-lerp.ts.txt")),
  };
  const script = [
    "import { words } from './words.mjs';",
    "import { kebabCase } from './kebabCase.mjs';",
    "import { snakeCase } from './snakeCase.mjs';",
    "import { camelCase } from './camelCase.mjs';",
    "import { difference } from './difference.mjs';",
    "import { intersection } from './intersection.mjs';",
    "import { at } from './at.mjs';",
    "import { lerp } from './lerp.mjs';",
    "const RE = /\\p{Lu}?\\p{Ll}+|[0-9]+|\\p{Lu}+(?!\\p{Ll})|\\p{Emoji_Presentation}|\\p{Extended_Pictographic}|\\p{L}+/gu;",
    "const split = (s) => Array.from(String(s).match(RE) ?? []);",
    "const kebab = (s) => split(s).map((w) => w.toLowerCase()).join('-');",
    "const snake = (s) => split(s).map((w) => w.toLowerCase()).join('_');",
    "const camel = (s) => { const w = split(s); if (!w.length) return ''; return w[0].toLowerCase() + w.slice(1).map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()).join(''); };",
    "const diff = (a, b) => a.filter((item) => !b.includes(item));",
    "const inter = (a, b) => a.filter((item) => b.includes(item));",
    "const picked = (a, b) => b.map((i) => a[(n => n < 0 ? n + a.length : n)(Number.isInteger(i) ? i : Math.trunc(i) || 0)]);",
    "const blend = (a, b, c) => c === 1 ? b : a + (b - a) * c;",
    "function same(l, r) {",
    "  if (Object.is(l, r)) return true;",
    "  if (Array.isArray(l) && Array.isArray(r)) {",
    "    if (l.length !== r.length) return false;",
    "    for (let i = 0; i < l.length; i++) {",
    "      const left = Object.prototype.hasOwnProperty.call(l, i);",
    "      const right = Object.prototype.hasOwnProperty.call(r, i);",
    "      if (left !== right) return false;",
    "      if (left && !same(l[i], r[i])) return false;",
    "    }",
    "    return true;",
    "  }",
    "  return false;",
    "}",
    "let bad = 0; let seen = 0;",
    "const check = (name, pub, got) => { seen++; if (!same(pub, got)) { bad++; if (bad < 12) console.log('FAIL', name, pub, got); } };",
    "const strings = ['', ' ', 'a', 'FOO', 'HTTPRequest', 'camelCase', 'some whitespace', 'hyphen-text', '    leading and trailing whitespace    ', 'special@characters!', '__foo_bar___', 'FOO_BAR', 'Foo Bar', 'Keep unicode 😅', 'Lunedì 18 Set', 'foo2bar', '--FOO-BAR--', '🚀', 'camelCaseHTTPRequest🚀', 'XMLHttpRequest', 'İstanbul', 'foo\\nbar', '\\u00A0nbsp', '___', '123abc', 'e\\u0301', 'iOS', ''];",
    "for (const s of strings) {",
    "  check('words ' + JSON.stringify(s), words(s), split(s));",
    "  check('kebab ' + JSON.stringify(s), kebabCase(s), kebab(s));",
    "  check('snake ' + JSON.stringify(s), snakeCase(s), snake(s));",
    "  check('camel ' + JSON.stringify(s), camelCase(s), camel(s));",
    "}",
    "const o1 = { id: 1 }; const o2 = { id: 2 };",
    "const pairs = [[[], []], [[1, 2, 3], [1]], [[1, 2, 3, 4], [2, 4]], [[1, 1, 1], [1]], [[NaN, 1], [NaN]], [[NaN], [1]], [[0, -0], [0]], [[-0, 1], [0]], [[undefined, 1], [undefined]], [[1, undefined], [2]], [[o1, o2], [o1]], [[o1], [o2]], [[false, 0], [0]], [[false], [0]], [['a', 'b', 'a'], ['a']]];",
    "for (const [a, b] of pairs) { check('diff', difference(a, b), diff(a, b)); check('inter', intersection(a, b), inter(a, b)); }",
    "const hole = [1, , 2];",
    "check('hole diff', difference(hole, [undefined]), diff(hole, [undefined]));",
    "check('hole value', difference([undefined], hole), diff([undefined], hole));",
    "check('hole inter', intersection([1, undefined, 2], hole), inter([1, undefined, 2], hole));",
    "const idxs = [0, 1, -1, -2, 2, 4, -4, 1.5, -1.5, NaN, Infinity, -Infinity, 0.2, -0.2, undefined, 1.9, -1.1, 100, -100, -0, 0, null, '1', true];",
    "for (const a of [[], ['a'], ['a', 'b', 'c'], [1, 2, 3, 4], [undefined, 1], [NaN, 0]]) {",
    "  check('at', at(a, idxs), picked(a, idxs));",
    "  check('at empty', at(a, []), picked(a, []));",
    "}",
    "const nums = [0, 1, -1, 0.1, -7.219779231267269, 9.792664575659987, 5, NaN, undefined, Infinity, -Infinity, -0, 1.5, 0.5];",
    "for (const a of nums) for (const b of nums) for (const c of nums) check('lerp', lerp(a, b, c), blend(a, b, c));",
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
  const words = pinned("es-toolkit-words.ts.txt");
  const capitalize = readFileSync(resolve(import.meta.dirname, "fixtures/m245/es-toolkit-capitalize.ts.txt"), "utf8");
  const rows = [
    {
      symbol: "words", file: "src/string/words.ts", fix: pinned("es-toolkit-words.ts.txt"), extra: {},
      candidate: "export function words(a: string): string[] {\n  return a.split(/[^A-Za-z0-9]+/).filter((word) => word.length > 0);\n}\n",
      args: [["--FOO-BAR--"], ["foo2bar"], ["camelCaseHTTPRequest🚀"], ["Lunedì 18 Set"]],
    },
    {
      symbol: "kebabCase", file: "src/string/kebabCase.ts", fix: pinned("es-toolkit-kebabCase.ts.txt"),
      extra: { "src/string/words.ts": words },
      candidate: "export function kebabCase(a: string): string {\n  return a.toLowerCase();\n}\n",
      args: [["camelCase"], ["some whitespace"], ["HTTPRequest"], [""]],
    },
    {
      symbol: "snakeCase", file: "src/string/snakeCase.ts", fix: pinned("es-toolkit-snakeCase.ts.txt"),
      extra: { "src/string/words.ts": words },
      candidate: "export function snakeCase(a: string): string {\n  return a.toLowerCase();\n}\n",
      args: [["camelCase"], ["some whitespace"], ["HTTPRequest"], [""]],
    },
    {
      symbol: "camelCase", file: "src/string/camelCase.ts", fix: pinned("es-toolkit-camelCase.ts.txt"),
      extra: { "src/string/words.ts": words, "src/string/capitalize.ts": capitalize },
      candidate: "export function camelCase(a: string): string {\n  const parts = a.split(/[^A-Za-z0-9]+/).filter((word) => word.length > 0);\n  if (!parts.length) return '';\n  return parts[0]!.toLowerCase() + parts.slice(1).map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()).join('');\n}\n",
      args: [["camelCase"], ["some whitespace"], ["HTTPRequest"], ["Keep unicode 😅"], [""]],
    },
    {
      symbol: "difference", file: "src/array/difference.ts", fix: pinned("es-toolkit-difference.ts.txt"), extra: {},
      candidate: "export function difference<T>(a: readonly T[], b: readonly T[]): T[] {\n  return a.filter((item) => item !== b[0]);\n}\n",
      args: [[[1, 2, 3], [1]], [[], [1, 2, 3]], [[1, 2, 3, 4], [2, 4]]],
    },
    {
      symbol: "intersection", file: "src/array/intersection.ts", fix: pinned("es-toolkit-intersection.ts.txt"), extra: {},
      candidate: "export function intersection<T>(a: readonly T[], b: readonly T[]): T[] {\n  return a.filter((item) => item === b[0]);\n}\n",
      args: [[[1, 2], [1, 3]], [[1, 2], [3, 1]], [[1, 2], [3, 4]], [[], [1, 2]]],
    },
    {
      symbol: "at", file: "src/array/at.ts", fix: pinned("es-toolkit-at.ts.txt"), extra: {},
      candidate: "export function at<T>(a: readonly T[], b: readonly number[]): T[] {\n  return b.map((i) => a[i]);\n}\n",
      args: [[["a", "b", "c"], [0, 2]], [["a", "b", "c"], [-1, -2]], [["a", "b", "c"], [2, 4, 0, -4]]],
    },
    {
      symbol: "lerp", file: "src/math/lerp.ts", fix: pinned("es-toolkit-lerp.ts.txt"), extra: {},
      candidate: "export function lerp(a: number, b: number, c: number): number {\n  return a + (b - a) * c;\n}\n",
      args: [[0, 100, 0], [0, 100, 1], [-7.219779231267269, 9.792664575659987, 1], [0, 100, 0.5], [0, 100, 1.5]],
    },
  ];
  const trees: string[] = [];
  try {
    for (const row of rows) {
      const tree = (text: string) => {
        const dir = mkdtempSync(join(tmpdir(), "peaceai-m246-grade-"));
        mkdirSync(join(dir, row.file, ".."), { recursive: true });
        writeFileSync(join(dir, row.file), text);
        for (const [path, extra] of Object.entries(row.extra)) {
          mkdirSync(join(dir, path, ".."), { recursive: true });
          writeFileSync(join(dir, path), extra);
        }
        trees.push(dir);
        return dir;
      };
      const grade = gradeBehavior({
        candidateRoot: tree(row.candidate), fixRoot: tree(row.fix), nodePath,
        target: { symbol: row.symbol, file: row.file, form: "named", exportName: row.symbol, args: row.args },
      });
      assert.equal(grade.behavior, "verified_test_only", `${row.symbol} ${grade.behavior}`);
      assert.ok(grade.counterexample, row.symbol);
    }
  } finally {
    for (const dir of trees) rmSync(dir, { recursive: true, force: true });
  }
});
