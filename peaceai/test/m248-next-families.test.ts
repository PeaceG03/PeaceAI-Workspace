// Inverse lerp, hex colors, zipObject, mean, red background, and chunk.
// The admitting cases are toss/es-toolkit at
// 24e7a7b8cb8035fae1ea2e7b507aab96698a38b9. Median stays out because those
// calls are also the mean. A passing log does not build a plan.
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
const fixture = resolve(import.meta.dirname, "fixtures/m248");
const COMMIT = "24e7a7b8cb8035fae1ea2e7b507aab96698a38b9";

const PIN = {
  inverseLerp: "051ac6156c7cc5fceeb5b2cc4983b7151d42dceed08b7fd3aa4a848990e12fad",
  inverseLerpTest: "afa87e13ec1c02f7a7b2a443f30cb9a4c765777fece70f4255e471e58cc0903d",
  parseHex: "c5e532f7c75d55be1b4bc92250a04965efe7f0a469791dec0291e4c9d916e947",
  parseHexTest: "6c57e0211bacb825bef2dde4d197db6d975606b6ed42a73d2482e088a96e81cc",
  zipObject: "185fc1a3f1abc0c5c7bf758841c77f1b0a0a0ef6cd4d182de45adaad6f1fa1e5",
  zipObjectTest: "10adc5a59d70f050f107c64a35196aad22b133bc363c64cabc8edc32a3a4f597",
  mean: "b0445d7e281b1e8b646c9729efa1d3d4806217c93dc9954cc434261690573ca7",
  meanTest: "27c1b2e5a4afd77e10c5f54549939d22a9abda2929b1543ec3f4dac324e69182",
  sum: "932fb45fe749f343a198e093a9c4fc1628aa8c21204957cf481e038903347507",
  bgRed: "ce4bf448730142410f343e4f5d7790b17275574d63174c9aea9fc6c225329615",
  bgRedTest: "91bb8c0af4065ea6776b468d01d69b2d5e4509bcada335701b6e103c9f66461e",
  wrapAnsiBg: "40cfc6b7f3af85662768cadae57848468f6528b0c5c954d2a096fb322969dbe5",
  chunk: "e30092d18a1bffa101f140168990b876b16d0e00c18a0dfd641166541350abbf",
  chunkTest: "0b6f267640c619b5b85ff7b2aa99bce84e50c33f97313b3aa86724b76e2722bb",
  lerp: "cff5090bbd24fa1d5cbcc93e79db8577edd89d6e345f1b56c369d7ee4a007650",
};

function pinned(name: string): string {
  return readFileSync(join(fixture, name), "utf8");
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
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
  "    toBeCloseTo(expected, precision = 2) { if (!(Math.abs(actual - expected) < 0.5 * (10 ** -precision))) throw new Error('not close'); return api; },",
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

const FAST_CHECK = [
  "function integer(opts) { return { kind: 'int', min: opts && opts.min !== undefined ? opts.min : -5, max: opts && opts.max !== undefined ? opts.max : 5 }; }",
  "function array(of) { return { kind: 'array', of }; }",
  "function property(arbA, arbB, fn) { return { arbA, arbB, fn }; }",
  "function assert(prop) {",
  "  const samples = [[], [1], [1, 2], [1, 2, 3, 4, 5], [9, 8, 7, 6, 5, 4, 3], [0, -0, 4]];",
  "  const sizes = [1, 2, 3, 50];",
  "  for (const array of samples) for (const size of sizes) prop.fn(array, size);",
  "}",
  "export default { assert, property, array, integer };",
  "",
].join("\n");

function transpile(file: string, text: string): string {
  return ts.transpileModule(text, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    fileName: file,
  }).outputText.replace(/from (['"])(\.\/[^'"]+)\.ts\1/g, "from $1$2.mjs$1").replaceAll("./_internal/wrapAnsiBg.mjs", "./wrapAnsiBg.mjs");
}

function publishedTest(text: string, local: string): string {
  return text
    .replaceAll("from 'vitest'", "from './shim.mjs'")
    .replaceAll('from "vitest"', 'from "./shim.mjs"')
    .replaceAll("from 'fast-check'", "from './fc.mjs'")
    .replaceAll('from "fast-check"', 'from "./fc.mjs"')
    .replaceAll(`from './${local}'`, `from './${local}.mjs'`)
    .replaceAll(`from "./${local}"`, `from "./${local}.mjs"`)
    .replaceAll("from './lerp'", "from './lerp.mjs'")
    .replaceAll('from "./lerp"', 'from "./lerp.mjs"');
}

function runBoxed(files: Record<string, string>, entry = "run.mjs"): { code: number | null; stdout: string } {
  const node = visibleNodeBin();
  assert.ok(node, "visible node");
  const dir = mkdtempSync(join(tmpdir(), "peaceai-m248-"));
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

test("toss/es-toolkit inverseLerp, parseHex, zipObject, mean, bgRed, and chunk are admitted", (t) => {
  if (!practiceSandboxReady()) { t.skip("bwrap is not installed on this host"); return; }
  const lerp = readFileSync(resolve(import.meta.dirname, "fixtures/m246/es-toolkit-lerp.ts.txt"), "utf8");
  assert.equal(sha256(lerp), PIN.lerp);
  assert.equal(sha256(pinned("es-toolkit-sum.ts.txt")), PIN.sum);
  assert.equal(sha256(pinned("es-toolkit-wrapAnsiBg.ts.txt")), PIN.wrapAnsiBg);
  const deps: Record<string, Record<string, string>> = {
    inverseLerp: { "lerp.mjs": transpile("lerp.ts", lerp) },
    parseHex: {},
    zipObject: {},
    mean: { "sum.mjs": transpile("sum.ts", pinned("es-toolkit-sum.ts.txt")) },
    bgRed: { "wrapAnsiBg.mjs": transpile("wrapAnsiBg.ts", pinned("es-toolkit-wrapAnsiBg.ts.txt")) },
    chunk: { "fc.mjs": FAST_CHECK },
  };
  const cases = [
    { local: "inverseLerp", dir: "src/math", source: "es-toolkit-inverseLerp.ts.txt", spec: "es-toolkit-inverseLerp.spec.ts.txt", sourceSha: PIN.inverseLerp, specSha: PIN.inverseLerpTest, shape: "ilerp", body: "return a === b ? 0 : (c - a) / (b - a);" },
    { local: "parseHex", dir: "src/server/colors/_internal", source: "es-toolkit-parseHex.ts.txt", spec: "es-toolkit-parseHex.spec.ts.txt", sourceSha: PIN.parseHex, specSha: PIN.parseHexTest, shape: "phex", body: "parseInt(full, 16)" },
    { local: "zipObject", dir: "src/array", source: "es-toolkit-zipObject.ts.txt", spec: "es-toolkit-zipObject.spec.ts.txt", sourceSha: PIN.zipObject, specSha: PIN.zipObjectTest, shape: "zobj", body: "return Array.from(a).reduce((o, k, i) => (o[k] = b[i], o), {});" },
    { local: "mean", dir: "src/math", source: "es-toolkit-mean.ts.txt", spec: "es-toolkit-mean.spec.ts.txt", sourceSha: PIN.mean, specSha: PIN.meanTest, shape: "mean", body: "return Array.from(a).reduce((s, n) => s + n, 0) / a.length;" },
    { local: "bgRed", dir: "src/server/colors", source: "es-toolkit-bgRed.ts.txt", spec: "es-toolkit-bgRed.spec.ts.txt", sourceSha: PIN.bgRed, specSha: PIN.bgRedTest, shape: "bg", body: "\\x1b[41m" },
    { local: "chunk", dir: "src/array", source: "es-toolkit-chunk.ts.txt", spec: "es-toolkit-chunk.spec.ts.txt", sourceSha: PIN.chunk, specSha: PIN.chunkTest, shape: "chunk", body: "Size must be an integer greater than zero." },
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
    const built = runBoxed({ "shim.mjs": SHIM, "run.mjs": specJs, [`${row.local}.mjs`]: transpile(`${row.local}.ts`, plan.files[0]!.content), ...deps[row.local] });
    assert.equal(built.code, 0, `${row.local} scaffold\n${built.stdout}`);
  }
  assert.equal(COMMIT.length, 40);
  const quiet = "import { quiet } from './quiet';\nexpect(quiet(0, 10, 5)).toBe(0.5);\nexpect(quiet(5, 5, 5)).toBe(0);\n";
  assert.equal(scaffoldPlan("src/quiet.spec.ts", quiet, "ok\n", PATTERN, [], () => null), null);
});

test("the new shapes stay apart from lerp and from each other", () => {
  const ilerp = admit("src/math/ilerp.spec.ts", [
    "import { ilerp } from './ilerp';",
    "expect(ilerp(0, 100, 100)).toBe(1);",
    "expect(ilerp(5, 5, 5)).toBe(0);",
    "expect(ilerp(0, 100, 50)).toBe(0.5);",
  ].join("\n"), "src/math/ilerp.ts");
  assert.equal(ilerp?.ok && ilerp.fit.shape, "ilerp");
  const hex = admit("src/server/colors/_internal/hex.spec.ts", [
    "import { hex } from './hex';",
    "expect(hex('#f00')).toEqual([255, 0, 0]);",
    "expect(hex('#00ff00')).toEqual([0, 255, 0]);",
    "expect(hex('#xyz')).toEqual([0, 0, 0]);",
  ].join("\n"), "src/server/colors/_internal/hex.ts");
  assert.equal(hex?.ok && hex.fit.shape, "phex");
  const zobj = admit("src/array/zobj.spec.ts", [
    "import { zobj } from './zobj';",
    "expect(zobj(['a', 'b', 'c'], [1, 2, 3])).toEqual({ a: 1, b: 2, c: 3 });",
    "expect(zobj(['a', 'b', 'c'], [1, 2])).toEqual({ a: 1, b: 2, c: undefined });",
  ].join("\n"), "src/array/zobj.ts");
  assert.equal(zobj?.ok && zobj.fit.shape, "zobj");
  const mean = admit("src/math/mean.spec.ts", [
    "import { mean } from './mean';",
    "expect(mean([1, 2, 3, 4, 5])).toEqual(3);",
    "expect(mean([])).toEqual(NaN);",
  ].join("\n"), "src/math/mean.ts");
  assert.equal(mean?.ok && mean.fit.shape, "mean");
  const bg = admit("src/server/colors/bg.spec.ts", [
    "import { bg } from './bg';",
    "expect(bg('x')).toBe('\\x1b[41mx\\x1b[49m');",
    "expect(bg('a\\nb')).toBe('\\x1b[41ma\\x1b[49m\\n\\x1b[41mb\\x1b[49m');",
  ].join("\n"), "src/server/colors/bg.ts");
  assert.equal(bg?.ok && bg.fit.shape, "bg");
  const chunk = admit("src/array/chunk.spec.ts", [
    "import { chunk } from './chunk';",
    "expect(chunk([1, 2, 3, 4, 5, 6], 3)).toEqual([[1, 2, 3], [4, 5, 6]]);",
    "expect(chunk([1, 2, 3, 4, 5, 6, 7], 2)).toEqual([[1, 2], [3, 4], [5, 6], [7]]);",
    "expect(chunk([1, 2, 3, 4], 6)).toEqual([[1, 2, 3, 4]]);",
  ].join("\n"), "src/array/chunk.ts");
  assert.equal(chunk?.ok && chunk.fit.shape, "chunk");
});

function bgWrapped(text: string): string {
  const open = "\u001b[41m";
  const close = "\u001b[49m";
  const nested = text.includes(close) ? text.replaceAll(close, close + open) : text;
  const lined = nested.includes("\n") ? nested.replaceAll(/\r?\n/g, (match) => close + match + open) : nested;
  return open + lined + close;
}

const KILLS = [
  { guard: "ilerp-guard:numbers", file: "src/ilnum.spec.ts", spec: "import { ilnum } from './ilnum';\nexpect(ilnum('0', '100', '50')).toBe(0.5);\nexpect(ilnum('5', '5', '9')).toBe(0);\n", body: "a === b ? 0" },
  { guard: "ilerp-guard:line", file: "src/illine.spec.ts", spec: "import { illine } from './illine';\nexpect(illine(0, 100, 50)).toBe(1);\nexpect(illine(5, 5, 5)).toBe(0);\n", body: "a === b ? 0" },
  { guard: "ilerp-guard:flat", file: "src/ilflat.spec.ts", spec: "import { ilflat } from './ilflat';\nexpect(ilflat(0, 100, 50)).toBe(0.5);\nexpect(ilflat(0, 100, 150)).toBe(1.5);\n", body: "a === b ? 0" },
  { guard: "ilerp-guard:apart", file: "src/ilapart.spec.ts", spec: "import { ilapart } from './ilapart';\nexpect(ilapart(0, 0, 9)).toBe(0);\nexpect(ilapart(0, 1, 0.5)).toBe(0.5);\n", body: "a === b ? 0" },
  { guard: "phex-guard:rgb", file: "src/prgb.spec.ts", spec: "import { prgb } from './prgb';\nexpect(prgb('#ff0000')).toEqual([1, 2, 3]);\nexpect(prgb('#f00')).toEqual([255, 0, 0]);\nexpect(prgb('#xyz')).toEqual([0, 0, 0]);\n", body: "parseInt(full, 16)" },
  { guard: "phex-guard:blank", file: "src/pblank.spec.ts", spec: "import { pblank } from './pblank';\nexpect(pblank('#f00')).toEqual([255, 0, 0]);\nexpect(pblank('#00ff00')).toEqual([0, 255, 0]);\n", body: "parseInt(full, 16)" },
  { guard: "phex-guard:short", file: "src/pshort.spec.ts", spec: "import { pshort } from './pshort';\nexpect(pshort('#ff0000')).toEqual([255, 0, 0]);\nexpect(pshort('#xyzxyz')).toEqual([0, 0, 0]);\n", body: "parseInt(full, 16)" },
  { guard: "zobj-guard:arrays", file: "src/zarr.spec.ts", spec: "import { zarr } from './zarr';\nexpect(zarr('abc', 'x')).toEqual({ a: 'x', b: undefined, c: undefined });\nexpect(zarr('de', 'yz')).toEqual({ d: 'y', e: 'z' });\n", body: "Array.from(a).reduce" },
  { guard: "zobj-guard:built", file: "src/zbuilt.spec.ts", spec: "import { zbuilt } from './zbuilt';\nexpect(zbuilt(['a', 'b'], [1])).toEqual({ a: 1, b: 9 });\nexpect(zbuilt(['c'], [3])).toEqual({ c: 3 });\n", body: "Array.from(a).reduce" },
  { guard: "zobj-guard:missing", file: "src/zmiss.spec.ts", spec: "import { zmiss } from './zmiss';\nexpect(zmiss(['a', 'b'], [1, 2])).toEqual({ a: 1, b: 2 });\nexpect(zmiss(['c'], [3])).toEqual({ c: 3 });\n", body: "Array.from(a).reduce" },
  { guard: "mean-guard:arrays", file: "src/marr.spec.ts", spec: "import { marr } from './marr';\nexpect(marr('')).toBe(NaN);\nexpect(marr('5')).toBe(5);\n", body: "Array.from(a).reduce" },
  { guard: "mean-guard:avg", file: "src/mavg.spec.ts", spec: "import { mavg } from './mavg';\nexpect(mavg([1, 2, 3, 4, 5])).toBe(0);\nexpect(mavg([])).toBe(NaN);\n", body: "Array.from(a).reduce" },
  { guard: "mean-guard:empty", file: "src/mempty.spec.ts", spec: "import { mempty } from './mempty';\nexpect(mempty([1, 2, 3, 4, 5])).toBe(3);\nexpect(mempty([-1, -2, -3, 4])).toBe(-0.5);\n", body: "Array.from(a).reduce" },
  { guard: "bg-guard:wrap", file: "src/bwrap.spec.ts", spec: "import { bwrap } from './bwrap';\nexpect(bwrap('a\\nb')).toBe('no');\nexpect(bwrap('x')).toBe('also');\n", body: "\\x1b[41m" },
  { guard: "bg-guard:break", file: "src/bbreak.spec.ts", spec: `import { bbreak } from './bbreak';\nexpect(bbreak(${JSON.stringify("a\u001b[49mb")})).toBe(${JSON.stringify(bgWrapped("a\u001b[49mb"))});\nexpect(bbreak(${JSON.stringify("c\u001b[49md")})).toBe(${JSON.stringify(bgWrapped("c\u001b[49md"))});\n`, body: "\\x1b[41m" },
  { guard: "chunk-guard:pair", file: "src/cpair.spec.ts", spec: "import { cpair } from './cpair';\nexpect(cpair('abcde', 2)).toEqual(['ab', 'cd', 'e']);\nexpect(cpair('xy', 3)).toEqual(['xy']);\n", body: "Size must be an integer greater than zero." },
  { guard: "chunk-guard:parts", file: "src/cparts.spec.ts", spec: "import { cparts } from './cparts';\nexpect(cparts([1, 2, 3, 4, 5, 6, 7], 2)).toEqual([[1]]);\nexpect(cparts([1, 2, 3], 6)).toEqual([[9]]);\n", body: "Size must be an integer greater than zero." },
  { guard: "chunk-guard:cut", file: "src/ccut.spec.ts", spec: "import { ccut } from './ccut';\nexpect(ccut([1, 2, 3], 6)).toEqual([[1, 2, 3]]);\nexpect(ccut([4], 2)).toEqual([[4]]);\n", body: "Size must be an integer greater than zero." },
  { guard: "chunk-guard:rest", file: "src/crest.spec.ts", spec: "import { crest } from './crest';\nexpect(crest([1, 2, 3, 4, 5, 6], 3)).toEqual([[1, 2, 3], [4, 5, 6]]);\nexpect(crest([1, 2], 1)).toEqual([[1], [2]]);\n", body: "Size must be an integer greater than zero." },
];

test("a near-miss each new guard names is refused", () => {
  for (const row of KILLS) {
    const plan = admit(row.file, row.spec, row.file.replace(/\.spec\.ts$/, ".ts"));
    assert.equal(plan?.ok, false, row.guard);
  }
});

const base = resolve(root, "peaceai/test/.m248-mutants");
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

test("deleting a next-family guard admits the case it refused", async () => {
  try {
    for (const row of KILLS) {
      const mod = await mutant(row.guard) as typeof import("../lib/testspec.ts");
      const plan = mod.scaffoldPlan(row.file, row.spec, `Cannot find module '/work/${row.file.replace(/\.spec\.ts$/, ".ts")}'`, PATTERN, [], () => null);
      assert.equal(plan?.ok, true, row.guard);
      if (plan?.ok) assert.ok(plan.files[0]!.content.includes(row.body), `${row.guard}\n${plan.ok ? plan.files[0]!.content : ""}`);
    }
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("the scaffold matches the published function on NaN, undefined, -0, empty, holes, and out of range", (t) => {
  if (!practiceSandboxReady()) { t.skip("bwrap is not installed on this host"); return; }
  const files: Record<string, string> = {
    "inverseLerp.mjs": transpile("inverseLerp.ts", pinned("es-toolkit-inverseLerp.ts.txt")),
    "parseHex.mjs": transpile("parseHex.ts", pinned("es-toolkit-parseHex.ts.txt")),
    "zipObject.mjs": transpile("zipObject.ts", pinned("es-toolkit-zipObject.ts.txt")),
    "sum.mjs": transpile("sum.ts", pinned("es-toolkit-sum.ts.txt")),
    "mean.mjs": transpile("mean.ts", pinned("es-toolkit-mean.ts.txt")),
    "wrapAnsiBg.mjs": transpile("wrapAnsiBg.ts", pinned("es-toolkit-wrapAnsiBg.ts.txt")),
    "bgRed.mjs": transpile("bgRed.ts", pinned("es-toolkit-bgRed.ts.txt")),
    "chunk.mjs": transpile("chunk.ts", pinned("es-toolkit-chunk.ts.txt")),
  };
  const script = [
    "import { inverseLerp } from './inverseLerp.mjs';",
    "import { parseHex } from './parseHex.mjs';",
    "import { zipObject } from './zipObject.mjs';",
    "import { mean } from './mean.mjs';",
    "import { bgRed } from './bgRed.mjs';",
    "import { chunk } from './chunk.mjs';",
    "const ilerp = (a, b, c) => a === b ? 0 : (c - a) / (b - a);",
    "const phex = (a) => ((raw) => /^[0-9a-fA-F]{3}$|^[0-9a-fA-F]{6}$/.test(raw) ? ((full) => ((n) => [(n >> 16) & 255, (n >> 8) & 255, n & 255])(parseInt(full, 16)))(raw.length === 3 ? raw[0] + raw[0] + raw[1] + raw[1] + raw[2] + raw[2] : raw) : [0, 0, 0])(a.startsWith('#') ? a.slice(1) : a);",
    "const zobj = (a, b) => Array.from(a).reduce((o, k, i) => (o[k] = b[i], o), {});",
    "const avg = (a) => Array.from(a).reduce((s, n) => s + n, 0) / a.length;",
    "const bg = (a) => ((open, close, text) => open + ((t) => t.includes('\\n') ? t.replaceAll(/\\r?\\n/g, (m) => close + m + open) : t)(text.includes(close) ? text.replaceAll(close, close + open) : text) + close)('\\x1b[41m', '\\x1b[49m', a);",
    "const parts = (a, b) => (!Number.isInteger(b) || b <= 0) ? (() => { throw new Error('Size must be an integer greater than zero.'); })() : Array.from({ length: Math.ceil(a.length / b) }, (_, i) => a.slice(i * b, i * b + b));",
    "function same(l, r) {",
    "  if (Object.is(l, r)) return true;",
    "  if (typeof l === 'object' && l && typeof r === 'object' && r) {",
    "    if (Array.isArray(l) || Array.isArray(r)) {",
    "      if (!Array.isArray(l) || !Array.isArray(r) || l.length !== r.length) return false;",
    "      for (let i = 0; i < l.length; i++) {",
    "        const left = Object.prototype.hasOwnProperty.call(l, i);",
    "        const right = Object.prototype.hasOwnProperty.call(r, i);",
    "        if (left !== right) return false;",
    "        if (left && !same(l[i], r[i])) return false;",
    "      }",
    "      return true;",
    "    }",
    "    const lk = Reflect.ownKeys(l), rk = Reflect.ownKeys(r);",
    "    if (lk.length !== rk.length || Object.getPrototypeOf(l) !== Object.getPrototypeOf(r)) return false;",
    "    return lk.every((k) => same(l[k], r[k]));",
    "  }",
    "  return false;",
    "}",
    "let bad = 0; let seen = 0;",
    "const check = (name, pub, got) => { seen++; if (!same(pub, got)) { bad++; if (bad < 12) console.log('FAIL', name, JSON.stringify(pub), JSON.stringify(got)); } };",
    "const checkThrow = (name, pub, ours) => {",
    "  let pe, oe;",
    "  try { pub(); } catch (e) { pe = e; }",
    "  try { ours(); } catch (e) { oe = e; }",
    "  seen++;",
    "  if (!pe || !oe || pe.name !== oe.name || pe.message !== oe.message) { bad++; console.log('THROW', name, pe && pe.message, oe && oe.message); }",
    "};",
    "const nums = [0, 1, -1, 0.5, -0, NaN, Infinity, -Infinity, 5, 10, 100, 7.5, undefined];",
    "for (const a of nums) for (const b of nums) for (const c of [0, 1, 0.5, 50, -5, NaN, -0, a]) check('ilerp', inverseLerp(a, b, c), ilerp(a, b, c));",
    "const hexes = ['#ff0000', '#00ff00', '#0000ff', '#f00', '#0f0', 'ff0000', 'f00', '', '#ab', '#abcde', 'a', '#xyz', '#xxyyzz', '#abcxyz', '#1g0000', '#12x', 'fg0000', '#FF00aa', 'ABC', '#abcd', '#aabbccdd', '#', 'fff', 'FFFFFF', '#00', '#000', '000', '#000000', 'gg', '#fffF', '  ff0000'];",
    "for (const h of hexes) check('hex ' + h, parseHex(h), phex(h));",
    "const hole = [1,,2];",
    "const keys = [[], ['a'], ['a', 'b', 'c'], ['a', 'b'], ['__proto__', 'a'], ['constructor'], [1, 2], ['x', undefined], hole, ['a', 'a'], ['-0', 'NaN']];",
    "const vals = [[], [1], [1, 2, 3], [1, 2], ['p', 1], ['c'], ['v'], [undefined, 1], [9, 8, 7], [1, 2], [-0, NaN]];",
    "for (const a of keys) for (const b of vals) check('zobj', zipObject(a, b), zobj(a, b));",
    "check('zobj hole', zipObject(hole, [9, 8, 7]), zobj(hole, [9, 8, 7]));",
    "check('zobj symbol', zipObject([Symbol.for('k'), 'a'], [1]), zobj([Symbol.for('k'), 'a'], [1]));",
    "const arrays = [[], [1, 2, 3, 4, 5], [1, 2, 3, 4], [-1, -2, -3, 4], [42], [NaN], [1, NaN], [0, -0], [-0], [1,,2], [undefined, 1], hole, [1, 2, undefined], [Infinity], [-Infinity], [1, undefined, 2]];",
    "for (const a of arrays) check('mean', mean(a), avg(a));",
    "check('mean empty string', mean(''), avg(''));",
    "check('mean digit', mean('5'), avg('5'));",
    "check('mean digits', mean('12'), avg('12'));",
    "const texts = ['x', 'a\\nb', '', 'a\\r\\nb', 'a\\nb\\r\\nc', '\\nabc', 'abc\\n', 'a\\tb', 'hi', '\\x1b[49m', 'a\\x1b[49mb', 'a\\n\\nb', 'a\\r\\n\\nb'];",
    "for (const text of texts) check('bg', bgRed(text), bg(text));",
    "const chunks = [[[], 3], [[1, 2, 3, 4, 5, 6], 3], [[1, 2, 3, 4], 6], [[1, 2, 3, 4, 5, 6, 7], 2], [[1,,3, 4], 2], [[1, 2, 3], 1], [hole, 1], [[1, 2, 3], 3], ['abcde', 2], ['', 1], [[1], 50]];",
    "for (const [a, b] of chunks) check('chunk ' + b, chunk(a, b), parts(a, b));",
    "for (const b of [0, -1, -0, 0.5, NaN, Infinity, -Infinity]) checkThrow('chunk ' + b, () => chunk([1, 2, 3], b), () => parts([1, 2, 3], b));",
    "checkThrow('chunk null', () => chunk(null, 1), () => parts(null, 1));",
    "const bothThrow = (name, pub, ours) => { let pe, oe; try { pub(); } catch (e) { pe = e; } try { ours(); } catch (e) { oe = e; } seen++; if (!pe || !oe || pe.name !== oe.name) { bad++; console.log('THROW', name, pe && pe.name, oe && oe.name); } };",
    "bothThrow('mean null', () => mean(null), () => avg(null));",
    "checkThrow('hex null', () => parseHex(null), () => phex(null));",
    "checkThrow('bg null', () => bgRed(null), () => bg(null));",
    "bothThrow('zobj null', () => zipObject(null, []), () => zobj(null, []));",
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
  const rows = [
    {
      symbol: "inverseLerp", file: "src/math/inverseLerp.ts", fix: pinned("es-toolkit-inverseLerp.ts.txt"), extra: {},
      candidate: "export function inverseLerp(a: number, b: number, c: number): number {\n  return (c - a) / (b - a);\n}\n",
      args: [[0, 100, 50], [5, 5, 5], [0, 100, 150]],
    },
    {
      symbol: "parseHex", file: "src/server/colors/_internal/parseHex.ts", fix: pinned("es-toolkit-parseHex.ts.txt"), extra: {},
      candidate: "export function parseHex(a: string): number[] {\n  const raw = a.startsWith('#') ? a.slice(1) : a;\n  if (!/^[0-9a-fA-F]{3}$|^[0-9a-fA-F]{6}$/.test(raw)) return [0, 0, 0];\n  const n = parseInt(raw, 16);\n  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];\n}\n",
      args: [["#ff0000"], ["#f00"], ["#xyz"]],
    },
    {
      symbol: "zipObject", file: "src/array/zipObject.ts", fix: pinned("es-toolkit-zipObject.ts.txt"), extra: {},
      candidate: "export function zipObject(a: readonly string[], b: readonly unknown[]): Record<string, unknown> {\n  return Array.from(a).reduce<Record<string, unknown>>((o, k, i) => { const v = Array.from(b)[i]; if (v !== undefined) o[k] = v; return o; }, {});\n}\n",
      args: [[["a", "b", "c"], [1, 2, 3]], [["a", "b", "c"], [1, 2]], [["a", "b"], [1, 2, 3]]],
    },
    {
      symbol: "mean", file: "src/math/mean.ts", fix: pinned("es-toolkit-mean.ts.txt"),
      extra: { "src/math/sum.ts": pinned("es-toolkit-sum.ts.txt") },
      candidate: "export function mean(a: readonly number[]): number {\n  return a.reduce((s, n) => s + n, 0) / (a.length - 1);\n}\n",
      args: [[[1, 2, 3, 4, 5]], [[]]],
    },
    {
      symbol: "bgRed", file: "src/server/colors/bgRed.ts", fix: pinned("es-toolkit-bgRed.ts.txt"),
      extra: { "src/server/colors/_internal/wrapAnsiBg.ts": pinned("es-toolkit-wrapAnsiBg.ts.txt") },
      candidate: "export function bgRed(a: string): string {\n  return '\\x1b[41m' + a + '\\x1b[49m';\n}\n",
      args: [["x"], ["a\nb"]],
    },
    {
      symbol: "chunk", file: "src/array/chunk.ts", fix: pinned("es-toolkit-chunk.ts.txt"), extra: {},
      candidate: "export function chunk<T>(a: readonly T[], b: number): T[][] {\n  if (!Number.isInteger(b) || b <= 0) throw new Error('Size must be an integer greater than zero.');\n  return Array.from({ length: Math.floor(a.length / b) }, (_, i) => a.slice(i * b, i * b + b));\n}\n",
      args: [[[1, 2, 3, 4, 5, 6], 3], [[1, 2, 3, 4, 5, 6, 7], 2], [[1, 2, 3, 4], 6]],
    },
  ];
  const trees: string[] = [];
  try {
    for (const row of rows) {
      const tree = (text: string) => {
        const dir = mkdtempSync(join(tmpdir(), "peaceai-m248-grade-"));
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
      assert.equal(grade.behavior, "verified_test_only", `${row.symbol} ${grade.behavior} ${grade.counterexample ? JSON.stringify(grade.counterexample) : ""}`);
      assert.ok(grade.counterexample, row.symbol);
    }
  } finally {
    for (const dir of trees) rmSync(dir, { recursive: true, force: true });
  }
});
