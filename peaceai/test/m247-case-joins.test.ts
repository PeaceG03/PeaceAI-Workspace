// Pascal, constant, lower, upper, start, sentence, and symmetric difference.
// The admitting cases are toss/es-toolkit at
// 24e7a7b8cb8035fae1ea2e7b507aab96698a38b9. Union, mean, median, range,
// without, and a character map stay out. A passing log does not build a plan.
// Published modules run inside the practice sandbox.
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
const fixture = resolve(import.meta.dirname, "fixtures/m247");
const COMMIT = "24e7a7b8cb8035fae1ea2e7b507aab96698a38b9";

const PIN = {
  pascalCase: "bdcc55bcb0ac158064a56c2add61c18def50f9e3b666d08eba79d341858b6ac5",
  pascalCaseTest: "2d418ed339c87c53d0f57e402d0e0c4a22c66de7b9466db316186c3a57ae42bc",
  constantCase: "f482d820bb3801f65bdcab4270784e25c28275ddb8fa30ae34f7ad7d4eebaeea",
  constantCaseTest: "83be2fe170ddeb164b50b48f6db7051b6a7db2ff1eb06eedd803b968638e25fb",
  lowerCase: "ad35958766976989ea322ef2f02b3781d67250fe9996bbe9a013a6db04a8ff84",
  lowerCaseTest: "a2dfe06ed3d94005dfb664952e67e723ac89634eececed6aa1264c8c89458e96",
  upperCase: "7a4dd4efcccc9dcede10593542e5586a52b4ba87967f5d81d5ff7feeac374784",
  upperCaseTest: "4a8749cd5ddcef337d69b59e9a62d235c95e94105c3151b5d3393cd0562e5f0c",
  startCase: "9db95739cb7cf4efae23cf9b305b041fda8b00caaa133712b297b02d650f9f02",
  startCaseTest: "804b964c0b2af4cffa761f2c7faddeada4aa0524e6f2aa808a0a60e7cc27ecbd",
  sentenceCase: "8d66ff17febcd0677cb81ef7886250498ac8d94bc0b46474643b11b1c1fa6256",
  sentenceCaseTest: "71aa5a7bbe7b0e71b8baaf8af67127cc950da4d6c316c3b74e7dfd7ba8aa6732",
  xor: "41b750e0071a377dccde211e6594044dd4a14ae2ef318294cdbed121d5094db8",
  xorTest: "bc34a1f8d6468386cc8c359407efd3af562fce5d330456d0514eaabd511998db",
  union: "96f0f722229ff02ddd924dc1b2da7ca306b8c0b04681467b4ad0dd212b66aa96",
  uniq: "1a7a7920344f0315e6c0097a43e7c5fad91a674d6b8ddec93a0d84d6041ba854",
  words: "612783f0021b254c934f25855ec0dd65bb5a9fd9688866fffa2b0d7b0343652b",
  capitalize: "20cc4e0267f1adb2dd92cfd323cce38dbc404613b911835ca45913efb2f74de4",
  difference: "f97ab633402c509e5467190363b1e19c97b5996be6a75338f02127b234e1b553",
  intersection: "4788b77752e7bcd518fedc2f65486473b1ea38927393651d76024fb3e8a260d8",
};

const WORD = "Array.from(a.match(/\\p{Lu}?\\p{Ll}+|[0-9]+|\\p{Lu}+(?!\\p{Ll})|\\p{Emoji_Presentation}|\\p{Extended_Pictographic}|\\p{L}+/gu) ?? [])";
const CAP = "word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()";

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
  const dir = mkdtempSync(join(tmpdir(), "peaceai-m247-"));
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

test("toss/es-toolkit pascal, constant, lower, upper, start, sentence, and xor are admitted", (t) => {
  if (!practiceSandboxReady()) { t.skip("bwrap is not installed on this host"); return; }
  const words = readFileSync(resolve(import.meta.dirname, "fixtures/m246/es-toolkit-words.ts.txt"), "utf8");
  const capitalize = readFileSync(resolve(import.meta.dirname, "fixtures/m245/es-toolkit-capitalize.ts.txt"), "utf8");
  const difference = readFileSync(resolve(import.meta.dirname, "fixtures/m246/es-toolkit-difference.ts.txt"), "utf8");
  const intersection = readFileSync(resolve(import.meta.dirname, "fixtures/m246/es-toolkit-intersection.ts.txt"), "utf8");
  assert.equal(sha256(words), PIN.words);
  assert.equal(sha256(capitalize), PIN.capitalize);
  assert.equal(sha256(difference), PIN.difference);
  assert.equal(sha256(intersection), PIN.intersection);
  const wordDeps = { "words.mjs": transpile("words.ts", words) };
  const deps: Record<string, Record<string, string>> = {
    pascalCase: { ...wordDeps, "capitalize.mjs": transpile("capitalize.ts", capitalize) },
    constantCase: wordDeps,
    lowerCase: wordDeps,
    upperCase: wordDeps,
    startCase: wordDeps,
    sentenceCase: wordDeps,
    xor: {
      "difference.mjs": transpile("difference.ts", difference),
      "intersection.mjs": transpile("intersection.ts", intersection),
      "union.mjs": transpile("union.ts", pinned("es-toolkit-union.ts.txt")),
      "uniq.mjs": transpile("uniq.ts", pinned("es-toolkit-uniq.ts.txt")),
    },
  };
  const cases = [
    { local: "pascalCase", dir: "src/string", source: "es-toolkit-pascalCase.ts.txt", spec: "es-toolkit-pascalCase.spec.ts.txt", sourceSha: PIN.pascalCase, specSha: PIN.pascalCaseTest, shape: "pascal", body: `return ((words) => words.map((word) => ${CAP}).join(""))(${WORD});` },
    { local: "constantCase", dir: "src/string", source: "es-toolkit-constantCase.ts.txt", spec: "es-toolkit-constantCase.spec.ts.txt", sourceSha: PIN.constantCase, specSha: PIN.constantCaseTest, shape: "constant", body: `return ${WORD}.map((word) => word.toUpperCase()).join("_");` },
    { local: "lowerCase", dir: "src/string", source: "es-toolkit-lowerCase.ts.txt", spec: "es-toolkit-lowerCase.spec.ts.txt", sourceSha: PIN.lowerCase, specSha: PIN.lowerCaseTest, shape: "lcase", body: `return ${WORD}.map((word) => word.toLowerCase()).join(" ");` },
    { local: "upperCase", dir: "src/string", source: "es-toolkit-upperCase.ts.txt", spec: "es-toolkit-upperCase.spec.ts.txt", sourceSha: PIN.upperCase, specSha: PIN.upperCaseTest, shape: "ucase", body: `return ${WORD}.map((word) => word.toUpperCase()).join(" ");` },
    { local: "startCase", dir: "src/string", source: "es-toolkit-startCase.ts.txt", spec: "es-toolkit-startCase.spec.ts.txt", sourceSha: PIN.startCase, specSha: PIN.startCaseTest, shape: "start", body: `return ${WORD}.map((word) => ${CAP}).join(" ");` },
    { local: "sentenceCase", dir: "src/string", source: "es-toolkit-sentenceCase.ts.txt", spec: "es-toolkit-sentenceCase.spec.ts.txt", sourceSha: PIN.sentenceCase, specSha: PIN.sentenceCaseTest, shape: "sentence", body: `return ((words) => words.map((word, i) => i === 0 ? ${CAP} : word.toLowerCase()).join(" "))(${WORD});` },
    { local: "xor", dir: "src/array", source: "es-toolkit-xor.ts.txt", spec: "es-toolkit-xor.spec.ts.txt", sourceSha: PIN.xor, specSha: PIN.xorTest, shape: "xor", body: "return ((u, both) => u.filter((item) => !both.includes(item)))([...new Set(a.concat(b))], a.filter((item) => b.includes(item)));" },
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
  assert.equal(sha256(pinned("es-toolkit-union.ts.txt")), PIN.union);
  assert.equal(sha256(pinned("es-toolkit-uniq.ts.txt")), PIN.uniq);
  assert.equal(COMMIT.length, 40);
  const quiet = "import { quiet } from './quiet';\nexpect(quiet('HTTPRequest')).toEqual('HttpRequest');\nexpect(quiet('foo bar')).toEqual('FooBar');\n";
  assert.equal(scaffoldPlan("src/quiet.spec.ts", quiet, "ok\n", PATTERN, [], () => null), null);
});

test("the new joins stay apart from kebab, snake, and camel", () => {
  const pascal = admit("src/pascal.spec.ts", [
    "import { pascal } from './pascal';",
    "expect(pascal('HTTPRequest')).toEqual('HttpRequest');",
    "expect(pascal('some whitespace')).toEqual('SomeWhitespace');",
  ].join("\n"), "src/pascal.ts");
  assert.equal(pascal?.ok && pascal.fit.shape, "pascal");
  const constant = admit("src/constant.spec.ts", [
    "import { constant } from './constant';",
    "expect(constant('HTTPRequest')).toEqual('HTTP_REQUEST');",
    "expect(constant('some whitespace')).toEqual('SOME_WHITESPACE');",
  ].join("\n"), "src/constant.ts");
  assert.equal(constant?.ok && constant.fit.shape, "constant");
  const lower = admit("src/lower.spec.ts", [
    "import { lower } from './lower';",
    "expect(lower('HTTPRequest')).toEqual('http request');",
    "expect(lower('some whitespace')).toEqual('some whitespace');",
  ].join("\n"), "src/lower.ts");
  assert.equal(lower?.ok && lower.fit.shape, "lcase");
  const upper = admit("src/upper.spec.ts", [
    "import { upper } from './upper';",
    "expect(upper('HTTPRequest')).toEqual('HTTP REQUEST');",
    "expect(upper('some whitespace')).toEqual('SOME WHITESPACE');",
  ].join("\n"), "src/upper.ts");
  assert.equal(upper?.ok && upper.fit.shape, "ucase");
  const start = admit("src/start.spec.ts", [
    "import { start } from './start';",
    "expect(start('HTTPRequest')).toEqual('Http Request');",
    "expect(start('some whitespace')).toEqual('Some Whitespace');",
  ].join("\n"), "src/start.ts");
  assert.equal(start?.ok && start.fit.shape, "start");
  const sentence = admit("src/sentence.spec.ts", [
    "import { sentence } from './sentence';",
    "expect(sentence('HTTPRequest')).toEqual('Http request');",
    "expect(sentence('some whitespace')).toEqual('Some whitespace');",
  ].join("\n"), "src/sentence.ts");
  assert.equal(sentence?.ok && sentence.fit.shape, "sentence");
  const either = admit("src/either.spec.ts", [
    "import { either } from './either';",
    "expect(either([1, 2, 3, 4], [3, 4, 5, 6])).toEqual([1, 2, 5, 6]);",
    "expect(either([1, 2, 3], [1, 2, 3])).toEqual([]);",
  ].join("\n"), "src/either.ts");
  assert.equal(either?.ok && either.fit.shape, "xor");
  const dashed = admit("src/dashed.spec.ts", [
    "import { dashed } from './dashed';",
    "expect(dashed('HTTPRequest')).toEqual('http-request');",
    "expect(dashed('some whitespace')).toEqual('some-whitespace');",
  ].join("\n"), "src/dashed.ts");
  assert.equal(dashed?.ok && dashed.fit.shape, "kebab");
  const scored = admit("src/scored.spec.ts", [
    "import { scored } from './scored';",
    "expect(scored('HTTPRequest')).toEqual('http_request');",
    "expect(scored('some whitespace')).toEqual('some_whitespace');",
  ].join("\n"), "src/scored.ts");
  assert.equal(scored?.ok && scored.fit.shape, "snake");
  const hump = admit("src/hump.spec.ts", [
    "import { hump } from './hump';",
    "expect(hump('HTTPRequest')).toEqual('httpRequest');",
    "expect(hump('some whitespace')).toEqual('someWhitespace');",
  ].join("\n"), "src/hump.ts");
  assert.equal(hump?.ok && hump.fit.shape, "camel");
  assert.ok(bodyOf(pascal).includes('.join("")'));
  assert.equal(bodyOf(dashed).includes("word.toUpperCase()"), false);
});

const KILLS: { guard: string; file: string; spec: string; body: string }[] = [
  { guard: "pascal-guard:strings", file: "src/pstrings.spec.ts", spec: "import { pstrings } from './pstrings';\nexpect(pstrings(['foo', 'bar'])).toEqual('FooBar');\nexpect(pstrings(['HTTP', 'Request'])).toEqual('HttpRequest');\n", body: '.join("")' },
  { guard: "pascal-guard:joined", file: "src/pjoined.spec.ts", spec: "import { pjoined } from './pjoined';\nexpect(pjoined('HTTPRequest')).toEqual('HTTP-Request');\nexpect(pjoined('some whitespace')).toEqual('some_whitespace');\n", body: '.join("")' },
  { guard: "pascal-guard:hump", file: "src/phump.spec.ts", spec: "import { phump } from './phump';\nexpect(phump('foo')).toEqual('Foo');\nexpect(phump('bar')).toEqual('Bar');\n", body: '.join("")' },
  { guard: "pascal-guard:camel", file: "src/pcamel.spec.ts", spec: "import { pcamel } from './pcamel';\nexpect(pcamel('12 34')).toEqual('1234');\nexpect(pcamel('98 76')).toEqual('9876');\n", body: '.join("")' },
  { guard: "constant-guard:strings", file: "src/cstrings.spec.ts", spec: "import { cstrings } from './cstrings';\nexpect(cstrings(['foo', 'bar'])).toEqual('FOO_BAR');\nexpect(cstrings(['HTTP', 'Request'])).toEqual('HTTP_REQUEST');\n", body: '.join("_")' },
  { guard: "constant-guard:joined", file: "src/cjoined.spec.ts", spec: "import { cjoined } from './cjoined';\nexpect(cjoined('HTTPRequest')).toEqual('http_request');\nexpect(cjoined('some whitespace')).toEqual('some whitespace');\n", body: '.join("_")' },
  { guard: "constant-guard:space", file: "src/cspace.spec.ts", spec: "import { cspace } from './cspace';\nexpect(cspace('foo')).toEqual('FOO');\nexpect(cspace('bar')).toEqual('BAR');\n", body: '.join("_")' },
  { guard: "constant-guard:snake", file: "src/csnake.spec.ts", spec: "import { csnake } from './csnake';\nexpect(csnake('12 34')).toEqual('12_34');\nexpect(csnake('8 9')).toEqual('8_9');\n", body: '.join("_")' },
  { guard: "lcase-guard:strings", file: "src/lstrings.spec.ts", spec: "import { lstrings } from './lstrings';\nexpect(lstrings(['HTTP', 'Request'])).toEqual('http request');\nexpect(lstrings(['Foo', 'Bar'])).toEqual('foo bar');\n", body: '.join(" ")' },
  { guard: "lcase-guard:joined", file: "src/ljoined.spec.ts", spec: "import { ljoined } from './ljoined';\nexpect(ljoined('HTTPRequest')).toEqual('HTTP-Request');\nexpect(ljoined('foo bar')).toEqual('foo_bar');\n", body: '.join(" ")' },
  { guard: "lcase-guard:hyphen", file: "src/lhyphen.spec.ts", spec: "import { lhyphen } from './lhyphen';\nexpect(lhyphen('Lunedì')).toEqual('lunedì');\nexpect(lhyphen('FOO')).toEqual('foo');\n", body: '.join(" ")' },
  { guard: "lcase-guard:sentence", file: "src/lsent.spec.ts", spec: "import { lsent } from './lsent';\nexpect(lsent('12HTTP')).toEqual('12 http');\nexpect(lsent('8XML')).toEqual('8 xml');\n", body: '.join(" ")' },
  { guard: "lcase-guard:boundary", file: "src/lbound.spec.ts", spec: "import { lbound } from './lbound';\nexpect(lbound('FOO BAR')).toEqual('foo bar');\nexpect(lbound('A B')).toEqual('a b');\n", body: '.join(" ")' },
  { guard: "ucase-guard:strings", file: "src/ustrings.spec.ts", spec: "import { ustrings } from './ustrings';\nexpect(ustrings(['HTTP', 'Request'])).toEqual('HTTP REQUEST');\nexpect(ustrings(['Foo', 'Bar'])).toEqual('FOO BAR');\n", body: '.join(" ")' },
  { guard: "ucase-guard:joined", file: "src/ujoined.spec.ts", spec: "import { ujoined } from './ujoined';\nexpect(ujoined('HTTPRequest')).toEqual('http-request');\nexpect(ujoined('foo bar')).toEqual('foo_bar');\n", body: '.join(" ")' },
  { guard: "ucase-guard:score", file: "src/uscore.spec.ts", spec: "import { uscore } from './uscore';\nexpect(uscore('lunedì')).toEqual('LUNEDÌ');\nexpect(uscore('café')).toEqual('CAFÉ');\n", body: '.join(" ")' },
  { guard: "ucase-guard:lower", file: "src/ulower.spec.ts", spec: "import { ulower } from './ulower';\nexpect(ulower('12-🚀')).toEqual('12 🚀');\nexpect(ulower('8_🔥')).toEqual('8 🔥');\n", body: '.join(" ")' },
  { guard: "ucase-guard:boundary", file: "src/ubound.spec.ts", spec: "import { ubound } from './ubound';\nexpect(ubound('foo bar')).toEqual('FOO BAR');\nexpect(ubound('a b')).toEqual('A B');\n", body: '.join(" ")' },
  { guard: "start-guard:strings", file: "src/sstrings.spec.ts", spec: "import { sstrings } from './sstrings';\nexpect(sstrings(['foo', 'bar'])).toEqual('Foo Bar');\nexpect(sstrings(['HTTP', 'Request'])).toEqual('Http Request');\n", body: '.join(" ")' },
  { guard: "start-guard:joined", file: "src/sjoined.spec.ts", spec: "import { sjoined } from './sjoined';\nexpect(sjoined('HTTPRequest')).toEqual('http-request');\nexpect(sjoined('foo bar')).toEqual('foo_bar');\n", body: '.join(" ")' },
  { guard: "start-guard:sentence", file: "src/ssent.spec.ts", spec: "import { ssent } from './ssent';\nexpect(ssent('HTTP12')).toEqual('Http 12');\nexpect(ssent('XML3')).toEqual('Xml 3');\n", body: '.join(" ")' },
  { guard: "start-guard:boundary", file: "src/sbound.spec.ts", spec: "import { sbound } from './sbound';\nexpect(sbound('foo bar')).toEqual('Foo Bar');\nexpect(sbound('a b')).toEqual('A B');\n", body: '.join(" ")' },
  { guard: "sentence-guard:strings", file: "src/nstrings.spec.ts", spec: "import { nstrings } from './nstrings';\nexpect(nstrings(['foo', 'bar'])).toEqual('Foo bar');\nexpect(nstrings(['HTTP', 'Request'])).toEqual('Http request');\n", body: '.join(" ")' },
  { guard: "sentence-guard:joined", file: "src/njoined.spec.ts", spec: "import { njoined } from './njoined';\nexpect(njoined('HTTPRequest')).toEqual('http-request');\nexpect(njoined('foo bar')).toEqual('foo_bar');\n", body: '.join(" ")' },
  { guard: "sentence-guard:start", file: "src/nstart.spec.ts", spec: "import { nstart } from './nstart';\nexpect(nstart('HTTP12')).toEqual('Http 12');\nexpect(nstart('XML3')).toEqual('Xml 3');\n", body: '.join(" ")' },
  { guard: "sentence-guard:lower", file: "src/nlower.spec.ts", spec: "import { nlower } from './nlower';\nexpect(nlower('12HTTP')).toEqual('12 http');\nexpect(nlower('8XML')).toEqual('8 xml');\n", body: '.join(" ")' },
  { guard: "sentence-guard:boundary", file: "src/nbound.spec.ts", spec: "import { nbound } from './nbound';\nexpect(nbound('foo-bar')).toEqual('Foo bar');\nexpect(nbound('a-b-c')).toEqual('A b c');\n", body: '.join(" ")' },
  { guard: "xor-guard:arrays", file: "src/xarrays.spec.ts", spec: "import { xarrays } from './xarrays';\nexpect(xarrays('abcd', 'bd')).toEqual(['a', 'c']);\nexpect(xarrays('xy', 'y')).toEqual(['x']);\n", body: "new Set(a.concat(b))" },
  { guard: "xor-guard:rest", file: "src/xrest.spec.ts", spec: "import { xrest } from './xrest';\nexpect(xrest([1, 2, 3], [2, 4])).toEqual([1, 4]);\nexpect(xrest([5, 6], [6, 7])).toEqual([5]);\n", body: "new Set(a.concat(b))" },
  { guard: "xor-guard:shared", file: "src/xshared.spec.ts", spec: "import { xshared } from './xshared';\nexpect(xshared([1, 2], [3, 4])).toEqual([1, 2, 3, 4]);\nexpect(xshared([5], [6])).toEqual([5, 6]);\n", body: "new Set(a.concat(b))" },
];

test("a near-miss each new guard names is refused", () => {
  for (const row of KILLS) {
    const plan = admit(row.file, row.spec, row.file.replace(/\.spec\.ts$/, ".ts"));
    assert.equal(plan?.ok, false, row.guard);
  }
});

const base = resolve(root, "peaceai/test/.m247-mutants");
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

test("deleting a case-join or xor guard admits the case it refused", async () => {
  for (const row of KILLS) {
    const mod = await mutant(row.guard) as typeof import("../lib/testspec.ts");
    const plan = mod.scaffoldPlan(row.file, row.spec, `Cannot find module '/work/${row.file.replace(/\.spec\.ts$/, ".ts")}'`, PATTERN, [], () => null);
    assert.equal(plan?.ok, true, row.guard);
    if (plan?.ok) assert.ok(plan.files[0]!.content.includes(row.body), row.guard);
  }
  rmSync(base, { recursive: true, force: true });
});

test("the scaffold matches the published function on unicode, emoji, acronyms, digits, empty strings, NaN, -0, duplicates, order, and holes", (t) => {
  if (!practiceSandboxReady()) { t.skip("bwrap is not installed on this host"); return; }
  const words = readFileSync(resolve(import.meta.dirname, "fixtures/m246/es-toolkit-words.ts.txt"), "utf8");
  const capitalize = readFileSync(resolve(import.meta.dirname, "fixtures/m245/es-toolkit-capitalize.ts.txt"), "utf8");
  const files: Record<string, string> = {
    "words.mjs": transpile("words.ts", words),
    "capitalize.mjs": transpile("capitalize.ts", capitalize),
    "pascalCase.mjs": transpile("pascalCase.ts", pinned("es-toolkit-pascalCase.ts.txt")),
    "constantCase.mjs": transpile("constantCase.ts", pinned("es-toolkit-constantCase.ts.txt")),
    "lowerCase.mjs": transpile("lowerCase.ts", pinned("es-toolkit-lowerCase.ts.txt")),
    "upperCase.mjs": transpile("upperCase.ts", pinned("es-toolkit-upperCase.ts.txt")),
    "startCase.mjs": transpile("startCase.ts", pinned("es-toolkit-startCase.ts.txt")),
    "sentenceCase.mjs": transpile("sentenceCase.ts", pinned("es-toolkit-sentenceCase.ts.txt")),
    "difference.mjs": transpile("difference.ts", readFileSync(resolve(import.meta.dirname, "fixtures/m246/es-toolkit-difference.ts.txt"), "utf8")),
    "intersection.mjs": transpile("intersection.ts", readFileSync(resolve(import.meta.dirname, "fixtures/m246/es-toolkit-intersection.ts.txt"), "utf8")),
    "union.mjs": transpile("union.ts", pinned("es-toolkit-union.ts.txt")),
    "uniq.mjs": transpile("uniq.ts", pinned("es-toolkit-uniq.ts.txt")),
    "xor.mjs": transpile("xor.ts", pinned("es-toolkit-xor.ts.txt")),
  };
  const script = [
    "import { pascalCase } from './pascalCase.mjs';",
    "import { constantCase } from './constantCase.mjs';",
    "import { lowerCase } from './lowerCase.mjs';",
    "import { upperCase } from './upperCase.mjs';",
    "import { startCase } from './startCase.mjs';",
    "import { sentenceCase } from './sentenceCase.mjs';",
    "import { xor } from './xor.mjs';",
    "const RE = /\\p{Lu}?\\p{Ll}+|[0-9]+|\\p{Lu}+(?!\\p{Ll})|\\p{Emoji_Presentation}|\\p{Extended_Pictographic}|\\p{L}+/gu;",
    "const split = (s) => Array.from(String(s).match(RE) ?? []);",
    "const cap = (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();",
    "const pascal = (s) => split(s).map(cap).join('');",
    "const constant = (s) => split(s).map((w) => w.toUpperCase()).join('_');",
    "const lower = (s) => split(s).map((w) => w.toLowerCase()).join(' ');",
    "const upper = (s) => split(s).map((w) => w.toUpperCase()).join(' ');",
    "const start = (s) => split(s).map(cap).join(' ');",
    "const sentence = (s) => split(s).map((w, i) => i === 0 ? cap(w) : w.toLowerCase()).join(' ');",
    "const xorOf = (a, b) => ((u, both) => u.filter((item) => !both.includes(item)))([...new Set(a.concat(b))], a.filter((item) => b.includes(item)));",
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
    "const strings = ['', ' ', 'a', 'FOO', 'HTTPRequest', 'camelCase', 'some whitespace', 'hyphen-text', '    leading and trailing whitespace    ', 'special@characters!', '__foo_bar___', 'FOO_BAR', 'Foo Bar', 'Keep unicode 😅', 'Lunedì 18 Set', 'foo2bar', '--FOO-BAR--', '🚀', 'camelCaseHTTPRequest🚀', 'XMLHttpRequest', 'İstanbul', 'foo\\nbar', '\\u00A0nbsp', '___', '123abc', 'e\\u0301', 'iOS', '12abc 12ABC', 'ABC', 'ABCdef', 'a1B2c3', '123ABC', 'hello world', 'HELLO WORLD', 'iPhone', 'ß', 'ﬁ', '12 34', '12 HTTPRequest', '🚀🔥', '3 café', 'Lunedì 12'];",
    "for (const s of strings) {",
    "  check('pascal ' + JSON.stringify(s), pascalCase(s), pascal(s));",
    "  check('constant ' + JSON.stringify(s), constantCase(s), constant(s));",
    "  check('lower ' + JSON.stringify(s), lowerCase(s), lower(s));",
    "  check('upper ' + JSON.stringify(s), upperCase(s), upper(s));",
    "  check('start ' + JSON.stringify(s), startCase(s), start(s));",
    "  check('sentence ' + JSON.stringify(s), sentenceCase(s), sentence(s));",
    "}",
    "const o1 = { id: 1 }; const o2 = { id: 2 };",
    "const pairs = [[[], []], [[1, 2, 3, 4], [3, 4, 5, 6]], [['a', 'b'], ['b', 'c']], [[1, 2, 3], [4, 5, 6]], [[1, 2, 3], [1, 2, 3]], [[], [1, 2, 3]], [[1, 2, 3], []], [[1, 1, 2], [2, 2, 3]], [[1, 1, 1], [1]], [[NaN, 1], [NaN]], [[NaN], [1]], [[1], [NaN]], [[0, -0], [0]], [[-0], [0]], [[-0, 1], [0]], [[0], [-0]], [[undefined, 1], [undefined]], [[1, undefined], [2]], [[o1, o2], [o1]], [[o1], [o2]], [[false, 0], [0]], [[false], [0]], [['a', 'b', 'a'], ['a']], [[3, 1], [2, 1]], [[2, 2], [2]], [[1], [1, 1]]];",
    "for (const [a, b] of pairs) check('xor', xor(a, b), xorOf(a, b));",
    "const hole = [1, , 2];",
    "check('hole', xor(hole, [2]), xorOf(hole, [2]));",
    "check('hole undef', xor(hole, [undefined]), xorOf(hole, [undefined]));",
    "check('hole right', xor([undefined], hole), xorOf([undefined], hole));",
    "check('hole both', xor(hole, [, 1]), xorOf(hole, [, 1]));",
    "check('hole tail', xor([1, ,], [1]), xorOf([1, ,], [1]));",
    "check('hole dup', xor([1, , 1], [1]), xorOf([1, , 1], [1]));",
    "check('hole nan', xor([NaN, , 1], [NaN]), xorOf([NaN, , 1], [NaN]));",
    "check('hole zero', xor([-0, , 0], [0]), xorOf([-0, , 0], [0]));",
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
  const words = readFileSync(resolve(import.meta.dirname, "fixtures/m246/es-toolkit-words.ts.txt"), "utf8");
  const capitalize = readFileSync(resolve(import.meta.dirname, "fixtures/m245/es-toolkit-capitalize.ts.txt"), "utf8");
  const difference = readFileSync(resolve(import.meta.dirname, "fixtures/m246/es-toolkit-difference.ts.txt"), "utf8");
  const intersection = readFileSync(resolve(import.meta.dirname, "fixtures/m246/es-toolkit-intersection.ts.txt"), "utf8");
  const stringExtra = { "src/string/words.ts": words };
  const rows = [
    {
      symbol: "pascalCase", file: "src/string/pascalCase.ts", fix: pinned("es-toolkit-pascalCase.ts.txt"),
      extra: { ...stringExtra, "src/string/capitalize.ts": capitalize },
      candidate: "export function pascalCase(a: string): string {\n  const parts = a.split(/[^A-Za-z0-9]+/).filter((word) => word.length > 0);\n  return parts.map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()).join('');\n}\n",
      args: [["pascalCase"], ["some whitespace"], ["HTTPRequest"], ["FOO_BAR"], [""]],
    },
    {
      symbol: "constantCase", file: "src/string/constantCase.ts", fix: pinned("es-toolkit-constantCase.ts.txt"), extra: stringExtra,
      candidate: "export function constantCase(a: string): string {\n  return a.split(/[^A-Za-z0-9]+/).filter((word) => word.length > 0).map((word) => word.toUpperCase()).join('_');\n}\n",
      args: [["camelCase"], ["some whitespace"], ["HTTPRequest"], [""]],
    },
    {
      symbol: "lowerCase", file: "src/string/lowerCase.ts", fix: pinned("es-toolkit-lowerCase.ts.txt"), extra: stringExtra,
      candidate: "export function lowerCase(a: string): string {\n  return a.toLowerCase();\n}\n",
      args: [["camelCase"], ["some whitespace"], ["HTTPRequest"], ["FOO_BAR"], [""]],
    },
    {
      symbol: "upperCase", file: "src/string/upperCase.ts", fix: pinned("es-toolkit-upperCase.ts.txt"), extra: stringExtra,
      candidate: "export function upperCase(a: string): string {\n  return a.toUpperCase();\n}\n",
      args: [["camelCase"], ["some whitespace"], ["HTTPRequest"], [""]],
    },
    {
      symbol: "startCase", file: "src/string/startCase.ts", fix: pinned("es-toolkit-startCase.ts.txt"), extra: stringExtra,
      candidate: "export function startCase(a: string): string {\n  return a.split(/[^A-Za-z0-9]+/).filter((word) => word.length > 0).map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()).join(' ');\n}\n",
      args: [["--foo-bar--"], ["fooBar"], ["XMLHttpRequest"], ["12abc 12ABC"], [""]],
    },
    {
      symbol: "sentenceCase", file: "src/string/sentenceCase.ts", fix: pinned("es-toolkit-sentenceCase.ts.txt"), extra: stringExtra,
      candidate: "export function sentenceCase(a: string): string {\n  const parts = a.split(/[^A-Za-z0-9]+/).filter((word) => word.length > 0);\n  return parts.map((word, i) => i === 0 ? word.charAt(0).toUpperCase() + word.slice(1).toLowerCase() : word.toLowerCase()).join(' ');\n}\n",
      args: [["hello world"], ["fooBar"], ["XMLHttpRequest"], ["lunedì 18 SET"], [""]],
    },
    {
      symbol: "xor", file: "src/array/xor.ts", fix: pinned("es-toolkit-xor.ts.txt"),
      extra: {
        "src/array/difference.ts": difference,
        "src/array/intersection.ts": intersection,
        "src/array/union.ts": pinned("es-toolkit-union.ts.txt"),
        "src/array/uniq.ts": pinned("es-toolkit-uniq.ts.txt"),
      },
      candidate: "export function xor<T>(a: readonly T[], b: readonly T[]): T[] {\n  return a.filter((item) => !b.includes(item));\n}\n",
      args: [[[1, 2, 3, 4], [3, 4, 5, 6]], [["a", "b"], ["b", "c"]], [[1, 2, 3], [4, 5, 6]], [[1, 2, 3], [1, 2, 3]], [[], [1, 2, 3]], [[1, 2, 3], []]],
    },
  ];
  const trees: string[] = [];
  try {
    for (const row of rows) {
      const tree = (text: string) => {
        const dir = mkdtempSync(join(tmpdir(), "peaceai-m247-grade-"));
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
