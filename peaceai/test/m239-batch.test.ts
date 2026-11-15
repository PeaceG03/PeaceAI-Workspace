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
import { idiomMutationsIn, parseSource, type Site } from "../lib/editpropose.ts";
import { characterizationReplay } from "../lib/nlparse.ts";
import { expectationsIn, scaffoldPlan } from "../lib/testspec.ts";

const PATTERN = "^src/.+\\.ts$";

function plain(text: string): string[] {
  const site: Site = { path: "src/obj.ts", name: "isObject", start: 0, end: text.length, tier: 0 };
  return idiomMutationsIn(parseSource("src/obj.ts", text), site, 0).filter((m) => m.template === "plain-object").map((m) => m.text);
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

test("a returned null-and-object check gains an array exclusion, and a longer chain does not", () => {
  // vuejs/core packages/shared/src/general.ts @ cbd95955a5362b44060908f6e28ad447c3031b8a (MIT)
  const vue = [
    "export const isObject = (val: unknown): val is Record<any, any> =>",
    "  val !== null && typeof val === 'object'",
  ].join("\n");
  const got = plain(vue);
  assert.equal(got.length, 1);
  assert.equal(got[0], "val !== null && typeof val === 'object' && !Array.isArray(val)");
  const block = "export function isRecord(val: unknown): boolean {\n  return val !== null && typeof val === \"object\";\n}\n";
  assert.equal(plain(block)[0], "val !== null && typeof val === \"object\" && !Array.isArray(val)");
  // honojs/hono src/client/utils.ts @ f6fbaf0299c48eea9e656e03e2ffe7ac755e8823 (MIT): already excludes arrays
  const hono = "function isObject(item: unknown): item is object {\n  return typeof item === 'object' && item !== null && !Array.isArray(item)\n}\n";
  assert.deepEqual(plain(hono), []);
  // vueuse/vueuse packages/shared/utils/is.ts @ bed1dce149ce6760fec13d4798c047f51a563180 (MIT): toString, not typeof
  const vueuse = "export const isObject = (val: any): val is object =>\n  toString.call(val) === '[object Object]'\n";
  assert.deepEqual(plain(vueuse), []);
  // honojs/hono src/context.ts @ f6fbaf02: typeof alone, inside a ternary, is not the two-term predicate
  const html = [
    "export const respond = (html: unknown): unknown =>",
    "  typeof html === 'object'",
    "    ? html",
    "    : String(html)",
  ].join("\n");
  assert.deepEqual(plain(html), []);
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
  assert.deepEqual(plain(ohash), []);
  assert.deepEqual(plain("export const loose = (val: unknown) => val != null && typeof val === \"object\"\n"), []);
  assert.deepEqual(plain("export const other = (a: unknown, b: unknown) => a !== null && typeof b === \"object\"\n"), []);
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
  assert.equal(characterizationReplay("builder-log seq 235", header), true);
  assert.equal(characterizationReplay("builder-log seq 235", `Please ${header}`), false);
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
  writeFileSync(runner, `import { characterizationReplay } from ${JSON.stringify(pathToFileURL(file).href)};\nconsole.log(characterizationReplay("builder-log seq 235", "add a characterization test for tenMinDailyIndexKey in src/tenmin-daily-liquid.ts") ? "true" : "false");\n`);
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
