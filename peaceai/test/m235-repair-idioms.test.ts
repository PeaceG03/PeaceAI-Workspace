// Repair-v2 idioms for patterns the attempt cap was spending on other edits.
// Synthetic fixtures. Each case fails when its producer is removed or its formula changes.
import assert from "node:assert/strict";
import test from "node:test";
import { idiomMutationsIn, namedSymbols, parseSource, repairCandidates, type Site } from "../lib/editpropose.ts";

function hits(text: string, template: string): string[] {
  const site: Site = { path: "src/x.ts", name: "x", start: 0, end: text.length, tier: 0 };
  return idiomMutationsIn(parseSource("src/x.ts", text), site, 0).filter((m) => m.template === template).map((m) => m.text);
}

test("a dotted keyword names the compound function, and two plain-keys edits are tried together", () => {
  assert.deepEqual(namedSymbols("Fix `is.class` for a minified class"), ["is", "isClass"]);
  assert.deepEqual(namedSymbols("`inRange(5, 1, 5)` is false"), ["inRange"]);
  const text = [
    "export function isEmpty(value: object): boolean {",
    "  return isObject(value) && Object.keys(value).length === 0;",
    "}",
    "export function isFull(value: object): boolean {",
    "  return isObject(value) && Object.keys(value).length > 0;",
    "}",
  ].join("\n");
  const site: Site = { path: "src/x.ts", name: "x", start: 0, end: text.length, tier: 0 };
  const files = new Map([["src/x.ts", text]]);
  const queued = repairCandidates([site], files, new Set(), true);
  assert.ok(queued.length >= 2);
  assert.equal(queued[0]!.muts.length, 2);
  assert.ok(queued[0]!.muts.every((m) => m.template === "plain-keys"));
  assert.equal(queued[0]!.edits.length, 1);
  assert.match(queued[0]!.edits[0]!.content, /function isEmpty[\s\S]*Array\.isArray\(value\)/);
  assert.match(queued[0]!.edits[0]!.content, /function isFull[\s\S]*Array\.isArray\(value\)/);
});

test("own-keys rewrites for-in of a plain reference and leaves a for-of alone", () => {
  const text = "export function copy(src: Record<string, number>): Record<string, number> {\n  const out: Record<string, number> = {};\n  for (const key in src) out[key] = src[key]!;\n  return out;\n}\n";
  const got = hits(text, "own-keys");
  assert.equal(got.length, 1);
  assert.match(got[0]!, /for \(const key of Object\.keys\(src\)\) out\[key\] = src\[key\]!/);
  assert.deepEqual(hits("export function already(src: object) { for (const key of Object.keys(src)) return key; }", "own-keys"), []);
  const inherited = Object.create({ polluted: 1 });
  inherited.own = 2;
  const viaIn: string[] = [];
  for (const key in inherited) viaIn.push(key);
  const viaKeys = Object.keys(inherited);
  assert.deepEqual(viaIn.sort(), ["own", "polluted"]);
  assert.deepEqual(viaKeys, ["own"]);
});

test("trimmed-number requires the trimmed text before Number, and only on a string check", () => {
  const text = "export function numeric(value: unknown): boolean {\n  return isString(value) && !isEmpty(value) && !Number.isNaN(Number(value));\n}\n";
  const got = hits(text, "trimmed-number");
  assert.equal(got.length, 1);
  assert.match(got[0]!, /value\.trim\(\) === value && !Number\.isNaN\(Number\(value\)\)/);
  assert.deepEqual(hits("export function n(value: number) { return !Number.isNaN(Number(value)); }\n", "trimmed-number"), []);
  const accept = (value: string) => value.trim() === value && !Number.isNaN(Number(value));
  assert.equal(accept("5"), true);
  assert.equal(accept(" 5"), false);
  assert.equal(accept("5 "), false);
  assert.equal(accept("\t3"), false);
  assert.equal(accept("Infinity"), true);
});

test("class-keyword accepts a minified class body", () => {
  const text = "export function isClass(value: unknown): boolean {\n  return typeof value === \"function\" && value.toString().startsWith(\"class \");\n}\n";
  const got = hits(text, "class-keyword");
  assert.equal(got.length, 1);
  assert.match(got[0]!, /startsWith\("class "\)/);
  assert.match(got[0]!, /\.startsWith\("class\{"\)/);
  const minified = new Function("return class{};") as () => { toString(): string };
  const ctor = minified();
  assert.equal(ctor.toString().startsWith("class "), false);
  assert.equal(ctor.toString().startsWith("class ") || ctor.toString().startsWith("class{"), true);
  assert.equal(class Named {}.toString().startsWith("class "), true);
});

test("enum-values drops a numeric enum's reverse-mapped keys and keeps string values", () => {
  const text = "export function isCase(value: unknown, target: object): boolean {\n  return Object.values(target as any).includes(value as string);\n}\n";
  const got = hits(text, "enum-values");
  assert.equal(got.length, 1);
  assert.match(got[0]!, /Object\.values\(target\)\.filter\(\(item\) => typeof item !== "string" \|\| Number\.isNaN\(Number\(\(target as Record<PropertyKey, unknown>\)\[item as PropertyKey\]\)\)\)\.includes\(value\)/);
  const numeric: Record<string, string | number> = { Key1: 0, Key2: 1, 0: "Key1", 1: "Key2" };
  const textual: Record<string, string> = { Key1: "key1", 0: "zero", "01": "padded" };
  const keep = (e: Record<string, unknown>, item: unknown) => typeof item !== "string" || Number.isNaN(Number(e[item as string]));
  const values = (e: Record<string, unknown>) => Object.values(e).filter((item) => keep(e, item));
  assert.deepEqual(values(numeric).filter((item) => typeof item === "number").sort(), [0, 1]);
  assert.equal(values(numeric).includes("Key1"), false);
  assert.deepEqual(values(textual).sort(), ["key1", "padded", "zero"]);
  assert.equal(Object.values(textual).includes("zero"), true);
});

test("nan-bounds throws when a spread min and max share one NaN bound", () => {
  const text = "export function inRange(value: number, range: number[]): boolean {\n  if (range.length === 2) {\n    return value >= Math.min(...range) && value <= Math.max(...range);\n  }\n  throw new TypeError(\"bad\");\n}\n";
  const got = hits(text, "nan-bounds");
  assert.equal(got.length, 1);
  assert.match(got[0]!, /range\.some\(\(item\) => Number\.isNaN\(item\)\)\) throw new TypeError\(\)/);
  assert.match(got[0]!, /Math\.min\(\.\.\.range\)/);
  const run = (range: number[]) => {
    if (range.some((item) => Number.isNaN(item))) throw new TypeError();
    return 5 >= Math.min(...range) && 5 <= Math.max(...range);
  };
  assert.throws(() => run([NaN, 10]), TypeError);
  assert.throws(() => run([0, NaN]), TypeError);
  assert.equal(run([0, 10]), true);
  assert.deepEqual(hits("export function lo(xs: number[]) { return Math.min(...xs); }\n", "nan-bounds"), []);
});

test("plain-keys excludes an array and a function from an Object.keys length check", () => {
  const text = "export function empty(value: object): boolean {\n  return isObject(value) && !isMap(value) && Object.keys(value).length === 0;\n}\n";
  const got = hits(text, "plain-keys");
  assert.equal(got.length, 1);
  assert.match(got[0]!, /Object\.keys\(value\)\.length === 0 && !Array\.isArray\(value\) && typeof value !== "function"/);
  const empty = (value: object) => !Array.isArray(value) && typeof value !== "function" && Object.keys(value).length === 0;
  assert.equal(empty({}), true);
  assert.equal(empty([]), false);
  assert.equal(empty(function note() {}), false);
  assert.equal(empty({ a: 1 }), false);
  assert.deepEqual(hits("export function len(value: object) { return Object.keys(value).length === 0 && !Array.isArray(value); }\n", "plain-keys"), []);
});

test("nan-tag names NaN before the number tag of a typeof switch", () => {
  const text = "export function name(value: unknown): string {\n  switch (typeof value) {\n    case \"number\":\n      return \"number\";\n    default:\n      return \"other\";\n  }\n}\n";
  const got = hits(text, "nan-tag");
  assert.equal(got.length, 1);
  assert.equal(got[0], "return Number.isNaN(value) ? \"NaN\" : \"number\";");
  const name = (value: unknown) => typeof value === "number" ? (Number.isNaN(value) ? "NaN" : "number") : "other";
  assert.equal(name(Number.NaN), "NaN");
  assert.equal(name(1), "number");
  assert.equal(name("1"), "other");
});

test("array-merge keeps both arrays in an object merge that otherwise replaces", () => {
  const text = "function merge(base: Record<string, unknown>, defaults: Record<string, unknown>): Record<string, unknown> {\n  const obj = { ...defaults };\n  for (const key of Object.keys(base)) {\n    const val = base[key];\n    if (isObject(val) && isObject(obj[key])) {\n      obj[key] = merge(val as Record<string, unknown>, obj[key] as Record<string, unknown>);\n    } else {\n      obj[key] = val;\n    }\n  }\n  return obj;\n}\n";
  const got = hits(text, "array-merge");
  assert.equal(got.length, 1);
  assert.match(got[0]!, /Array\.isArray\(val\) && Array\.isArray\(obj\[key\]\) \? \[\.\.\.val, \.\.\.obj\[key\]\] : val/);
  const step = (val: unknown, prev: unknown) => Array.isArray(val) && Array.isArray(prev) ? [...val, ...prev] : val;
  assert.deepEqual(step(["a"], ["b", "c"]), ["a", "b", "c"]);
  assert.deepEqual(step(1, ["b"]), 1);
  const handled = "function merge(obj: Record<string, unknown>, key: string, val: unknown) {\n  if (Array.isArray(val)) obj[key] = val;\n  else obj[key] = val;\n}\n";
  assert.deepEqual(hits(handled, "array-merge"), []);
});
