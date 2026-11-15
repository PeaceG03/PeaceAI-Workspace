// Concrete assertion arguments, the plain-object idiom, and the characterization direct rule.
// The admitting and refusing snippets below are copied from permissively licensed TypeScript.
// They are not practice-set rows and not held-out repos.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { idiomMutationsIn, parseSource, type PlainSpec, type Site } from "../lib/editpropose.ts";
import { characterizationReplay } from "../lib/nlparse.ts";
import { expectationsIn, scaffoldPlan } from "../lib/testspec.ts";

const PATTERN = "^src/.+\\.ts$";

function excluding(name: string): PlainSpec {
  return {
    failing: ["an array is not an object"],
    text: [
      `import { ${name} } from "./obj.ts";`,
      `import { expect, test } from "vitest";`,
      `test("an array is not an object", () => {`,
      `  expect(${name}([])).toBe(false);`,
      `});`,
    ].join("\n"),
  };
}

function plain(text: string, spec: PlainSpec | null = null): string[] {
  const site: Site = { path: "src/obj.ts", name: "isObject", start: 0, end: text.length, tier: 0 };
  return idiomMutationsIn(parseSource("src/obj.ts", text), site, 0, spec).filter((m) => m.template === "plain-object").map((m) => m.text);
}

function expectRows(body: string) {
  const text = [
    'import { toDisplayString, isPrimitive, flattenArrayable, parseAccept } from "./mod.ts";',
    'import { expect, test } from "vitest";',
    "test(\"values\", () => {",
    body,
    "});",
  ].join("\n");
  return expectationsIn("src/mod.test.ts", text, PATTERN, [], () => true);
}

test("vue isObject is left alone, and a longer chain stays a near miss", () => {
  // vuejs/core packages/shared/src/general.ts @ cbd95955a5362b44060908f6e28ad447c3031b8a (MIT).
  // Arrays are objects here: isPromise uses isObject, and isPlainObject is the check that excludes them.
  // There is no failing spec, so the proposer does not fire.
  const vue = [
    "export const isObject = (val: unknown): val is Record<any, any> =>",
    "  val !== null && typeof val === 'object'",
  ].join("\n");
  assert.deepEqual(plain(vue), []);
  const includes: PlainSpec = {
    failing: ["arrays are objects"],
    text: [
      'import { isObject } from "./obj.ts";',
      'import { expect, test } from "vitest";',
      'test("arrays are objects", () => { expect(isObject([])).toBe(true); });',
    ].join("\n"),
  };
  assert.deepEqual(plain(vue, includes), []);
  assert.deepEqual(plain("export function isRecord(val: unknown): boolean {\n  return val !== null && typeof val === \"object\";\n}\n"), []);
  // honojs/hono src/client/utils.ts @ f6fbaf0299c48eea9e656e03e2ffe7ac755e8823 (MIT): already excludes arrays
  const hono = "function isObject(item: unknown): item is object {\n  return typeof item === 'object' && item !== null && !Array.isArray(item)\n}\n";
  assert.deepEqual(plain(hono, excluding("isObject")), []);
  // vueuse/vueuse packages/shared/utils/is.ts @ bed1dce149ce6760fec13d4798c047f51a563180 (MIT): toString, not typeof
  const vueuse = "export const isObject = (val: any): val is object =>\n  toString.call(val) === '[object Object]'\n";
  assert.deepEqual(plain(vueuse, excluding("isObject")), []);
  // honojs/hono src/context.ts @ f6fbaf02: typeof alone, inside a ternary, is not the two-term predicate
  const html = [
    "export const respond = (html: unknown): unknown =>",
    "  typeof html === 'object'",
    "    ? html",
    "    : String(html)",
  ].join("\n");
  assert.deepEqual(plain(html, excluding("respond")), []);
  // unjs/ohash src/serialize.ts @ 764b0a3203308956ef07597612af5ad59f36c791 (MIT): the check is one arm of a sum
  const ohash = [
    "export function suffix(this: { $object(json: object): string; serialize(json: unknown): string }, objName: string, object: { toJSON(): unknown }): string {",
    "  if (\"toJSON\" in object && typeof object.toJSON === \"function\") {",
    "    const json = object.toJSON();",
    "    return (",
    "      objName +",
    "      (json !== null && typeof json === \"object\"",
    "        ? this.$object(json)",
    "        : `(${this.serialize(json)})`)",
    "    );",
    "  }",
    "  return objName;",
    "}",
  ].join("\n");
  assert.deepEqual(plain(ohash, excluding("suffix")), []);
  assert.deepEqual(plain("export const loose = (val: unknown) => val != null && typeof val === \"object\"\n", excluding("loose")), []);
  assert.deepEqual(plain("export const other = (a: unknown, b: unknown) => a !== null && typeof b === \"object\"\n", excluding("other")), []);
});

test("a synthetic plain-object bug is edited only when its spec rejects arrays", async () => {
  // Labeled synthetic. The pre-image treats an array as an object. The spec says it must not.
  const source = [
    "// synthetic buggy pre-image: the spec says an array is not plain data, and this check treats it as one",
    "export function isPlainData(value: unknown): boolean {",
    "  return value !== null && typeof value === \"object\";",
    "}",
    "",
  ].join("\n");
  const spec = [
    'import { isPlainData } from "./plain.ts";',
    'import assert from "node:assert/strict";',
    'import test from "node:test";',
    'test("an array is not plain data", () => {',
    "  assert.equal(isPlainData([]), false);",
    "  assert.equal(isPlainData({ a: 1 }), true);",
    "  assert.equal(isPlainData(null), false);",
    "});",
    "",
  ].join("\n");
  const evidence: PlainSpec = { text: spec, failing: ["an array is not plain data"] };
  assert.deepEqual(plain(source), []);
  const site: Site = { path: "src/plain.ts", name: "isPlainData", start: 0, end: source.length, tier: 0 };
  const hits = idiomMutationsIn(parseSource("src/plain.ts", source), site, 0, evidence).filter((m) => m.template === "plain-object");
  assert.equal(hits.length, 1);
  const hit = hits[0]!;
  const edited = source.slice(0, hit.start) + hit.text + source.slice(hit.end);
  assert.match(edited, /return value !== null && typeof value === "object" && !Array\.isArray\(value\);/);
  const dir = mkdtempSync(join(tmpdir(), "peaceai-m239-plain-"));
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.startsWith("NODE_TEST") || key.startsWith("NODE_CHANNEL")) delete env[key];
  const run = (body: string) => new Promise<number>((done, fail) => {
    writeFileSync(join(dir, "plain.ts"), body);
    writeFileSync(join(dir, "plain.test.ts"), spec);
    const child = spawn(process.execPath, ["--experimental-strip-types", "--test", "plain.test.ts"], { cwd: dir, env, stdio: ["ignore", "pipe", "pipe"] });
    let err = "";
    child.stderr.on("data", (chunk) => { err += chunk; });
    child.on("error", fail);
    child.on("close", (code) => (code === null ? fail(new Error(err.slice(-500))) : done(code)));
  });
  try {
    assert.notEqual(await run(source), 0);
    assert.equal(await run(edited), 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("real assertions keep sentinels and collections, and drop calls and bigints", () => {
  // vuejs/core packages/shared/__tests__/toDisplayString.spec.ts @ cbd95955 (MIT)
  // @antfu/utils src/is.test.ts and src/array.test.ts @ 91f8cf73bebddae8f7ebcac82e47c9bcba9805e2 (MIT)
  // honojs/hono src/utils/accept.test.ts @ f6fbaf02 (MIT)
  const rows = expectRows([
    "  expect(toDisplayString(NaN)).toBe('NaN');",
    "  expect(toDisplayString(undefined)).toBe('');",
    "  expect(isPrimitive([])).toBe(false);",
    "  expect(isPrimitive({})).toBe(false);",
    "  expect(isPrimitive(undefined)).toBe(true);",
    "  expect(flattenArrayable([])).toEqual([]);",
    "  expect(flattenArrayable([1, [1, 2]])).toEqual([1, 1, 2]);",
    "  expect(parseAccept(undefined as any)).toEqual([]);",
    "  expect(isPrimitive(Symbol('foo'))).toBe(true);",
    "  expect(isPrimitive(1n)).toBe(true);",
    "  expect(flattenArrayable([...[1]])).toEqual([1]);",
  ].join("\n"));
  assert.ok(rows.some((row) => row.symbol === "toDisplayString" && row.input === "NaN" && row.expected === "'NaN'"));
  assert.ok(rows.some((row) => row.symbol === "toDisplayString" && row.input === "undefined" && row.expected === "''"));
  assert.ok(rows.some((row) => row.symbol === "isPrimitive" && row.input === "[]" && row.expected === "false"));
  assert.ok(rows.some((row) => row.symbol === "isPrimitive" && row.input === "{}" && row.expected === "false"));
  assert.ok(rows.some((row) => row.symbol === "flattenArrayable" && row.input === "[]"));
  assert.ok(rows.some((row) => row.symbol === "flattenArrayable" && row.input === "[1, [1, 2]]"));
  assert.ok(rows.some((row) => row.symbol === "parseAccept" && row.input === "undefined as any"));
  assert.equal(rows.some((row) => row.input.includes("Symbol") || row.input.includes("1n") || row.input.includes("...")), false);
  const refused = expectRows([
    "  expect(flattenArrayable({ a })).toEqual([]);",
    "  expect(flattenArrayable({ undefined })).toEqual([]);",
    "  expect(flattenArrayable({ __proto__: 1 })).toEqual([]);",
    '  expect(flattenArrayable({ "__proto__": 1 })).toEqual([]);',
    "  expect(flattenArrayable({ b: 1 })).toEqual([1]);",
  ].join("\n"));
  assert.equal(refused.some((row) => row.input.includes("{ a }") || row.input.includes("undefined") || row.input.includes("__proto__")), false);
  assert.ok(refused.some((row) => row.symbol === "flattenArrayable" && row.input === "{ b: 1 }"));
  const protoOnly = [
    'import { flattenArrayable } from "./mod.ts";',
    'import { expect, test } from "vitest";',
    "test(\"values\", () => { expect(flattenArrayable({ __proto__: 1 })).toEqual([]); });",
  ].join("\n");
  const protoPlan = scaffoldPlan("src/mod.test.ts", protoOnly, "TypeError: flattenArrayable is not a function", PATTERN, [], () => null);
  const protoInputs = protoPlan?.ok ? protoPlan.expectations.map((row) => row.input) : [];
  assert.equal(protoInputs.some((input) => input === "{}" || input.includes("__proto__")), false);
  const kept = [
    'import { flattenArrayable } from "./mod.ts";',
    'import { expect, test } from "vitest";',
    "test(\"values\", () => { expect(flattenArrayable({ b: 1 })).toEqual([1]); });",
  ].join("\n");
  const keptPlan = scaffoldPlan("src/mod.test.ts", kept, "TypeError: flattenArrayable is not a function", PATTERN, [], () => null);
  assert.equal(keptPlan?.ok, true);
  if (keptPlan?.ok) assert.ok(keptPlan.expectations.some((row) => row.input === '{"b":1}'));
  const text = [
    'import { toDisplayString } from "./display.ts";',
    'import { expect, test } from "vitest";',
    "test(\"primitive values\", () => { expect(toDisplayString(NaN)).toBe('NaN'); });",
  ].join("\n");
  const plan = scaffoldPlan("src/display.test.ts", text, "TypeError: toDisplayString is not a function", PATTERN, [], () => null);
  assert.equal(plan?.ok, true);
  if (plan?.ok) assert.match(plan.files[0]!.content, /return "NaN"/);
});

test("a characterization line skips the synthesizer, and a lookalike sentence does not", () => {
  const header = "add a characterization test for tenMinDailyIndexKey in src/tenmin-daily-liquid.ts";
  const asked = "Peace's task PeaceAI-Workspace#423 (source: peace): add a characterization test for tenMinDailyIndexKey in src/tenmin-daily-liquid.ts";
  assert.equal(characterizationReplay("builder-log seq 235", asked), true);
  assert.equal(characterizationReplay("builder-log seq 235", header), true);
  assert.equal(characterizationReplay("builder-log seq 235", `Please ${header}`), false);
  assert.equal(characterizationReplay("builder-log seq 235", "Peace's task PeaceAI-Workspace#423 (source: peace): make env FLAG strict in src/a.ts as a flag"), false);
  assert.equal(characterizationReplay("fix", "make env FLAG strict in src/a.ts as a flag"), false);
  assert.equal(characterizationReplay("add", "Add `is.blob`"), false);
  const generate = readFileSync(resolve(import.meta.dirname, "../bin/generate.ts"), "utf8");
  assert.match(generate, /directRule = textBatches\.length === 0 && process\.env\.PEACEAI_TEST_EXISTING === "true" && characterizationReplay/);
  assert.match(generate, /planSteps \|\| directRule \? \[\] : variants/);
});

test("deleting the characterization kind guard makes the header look ordinary", async () => {
  const lib = resolve(import.meta.dirname, "../lib/nlparse.ts");
  const lines = readFileSync(lib, "utf8").split("\n");
  const at = lines.findIndex((line) => line.includes("gen-guard:char-kind"));
  assert.ok(at >= 0);
  const dir = mkdtempSync(join(tmpdir(), "peaceai-m239-"));
  const file = join(dir, "nlparse.ts");
  const tsPath = createRequire(lib).resolve("typescript");
  const body = lines.filter((_, i) => i !== at).join("\n")
    .replace(/from "\.\/([a-z0-9-]+\.ts)"/g, (_, name: string) => `from ${JSON.stringify(pathToFileURL(join(resolve(import.meta.dirname, "../lib"), name)).href)}`)
    .replace(/from "typescript"/, `from ${JSON.stringify(pathToFileURL(tsPath).href)}`);
  writeFileSync(file, body);
  const runner = join(dir, "run.ts");
  const asked = "Peace's task PeaceAI-Workspace#423 (source: peace): add a characterization test for tenMinDailyIndexKey in src/tenmin-daily-liquid.ts";
  writeFileSync(runner, `import { characterizationReplay } from ${JSON.stringify(pathToFileURL(file).href)};\nconsole.log(characterizationReplay("builder-log seq 235", ${JSON.stringify(asked)}) ? "true" : "false");\n`);
  try {
    const child = spawn(resolve(import.meta.dirname, "../../node_modules/.bin/tsx"), [runner], { stdio: ["ignore", "pipe", "pipe"] });
    const out = await new Promise<string>((done, fail) => {
      let text = "";
      let err = "";
      child.stdout.on("data", (chunk) => { text += chunk; });
      child.stderr.on("data", (chunk) => { err += chunk; });
      child.on("close", (code) => code === 0 ? done(text.trim()) : fail(new Error(err.slice(-500))));
    });
    assert.equal(out, "false");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
