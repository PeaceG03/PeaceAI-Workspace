// M153 fixtures: small in-memory repositories of three shapes that share nothing with any training or task repo.
//   GEO:   a flat geometry library (pnpm lockfile, `vitest` in the test script, src/*.ts, test/*.test.ts, a test
//          helper, an examples/ copy of a function, duplicate names).
//   MONO:  a yarn workspace (packages/core with jest in devDependencies, packages/cli with mocha + .mocharc.json).
//   PLAIN: a repo with no lockfile, configured by `withPkg` (packageManager field, runner config files, scripts).
import { sha256 } from "../lib/plan.ts";
import type { IndexFile } from "../lib/symbols.ts";

export const LICENSE = "MIT License\n";
export const LICENSE_SHA = sha256(LICENSE);
const json = (o: unknown) => JSON.stringify(o, null, 2) + "\n";
const vt = 'import { test, expect } from "vitest";\n';

export const GEO: IndexFile[] = [
  { path: "LICENSE", content: LICENSE },
  { path: "package.json", content: json({ name: "geo-fixture", scripts: { test: "vitest", lint: "eslint ." } }) },
  { path: "pnpm-lock.yaml", content: "lockfileVersion: '9.0'\n" },
  { path: "src/index.ts", content: 'export * from "./area.ts";\nexport * from "./round.ts";\nexport * from "./units.ts";\nexport * from "./vec.ts";\n' },
  { path: "src/area.ts", content: "/** Area of a circle. */\nexport function area(r: number): number {\n  return Math.PI * r * r;\n}\nexport function perimeter(r: number): number {\n  return 2 * Math.PI * r;\n}\n" },
  { path: "examples/area.ts", content: "export function area(): number {\n  return 0;\n}\n" },
  { path: "src/round.ts", content: "export function round(x: number, digits: number): number {\n  const f = 10 ** digits;\n  return Math.round(x * f) / f;\n}\n" },
  { path: "src/format.ts", content: "/** A display helper with its own `round`. */\nexport function round(x: number): string {\n  return x.toFixed(0);\n}\nexport function label(x: number): string {\n  return `${round(x)} units`;\n}\n" },
  { path: "src/units.ts", content: "export const CM_PER_INCH = 2.54;\nexport function toCm(inches: number): number {\n  return inches * CM_PER_INCH;\n}\n" },
  { path: "src/vector.ts", content: "export function scale(v: number[], k: number): number[] {\n  return v.map((x) => x * k);\n}\n" },
  { path: "src/matrix.ts", content: "function scale(m: number[][], k: number): number[][] {\n  return m.map((r) => r.map((x) => x * k));\n}\nexport function identity2(): number[][] {\n  return scale([[1, 0], [0, 1]], 1);\n}\n" },
  { path: "src/vec.ts", content: "export class Vec {\n  constructor(public x: number, public y: number) {}\n  len(): number {\n    return Math.abs(this.x) + Math.abs(this.y);\n  }\n}\n" },
  { path: "src/core.ts", content: "export function sum(xs: number[]): number {\n  return xs.reduce((a, b) => a + b, 0);\n}\n" },
  { path: "src/api.ts", content: 'import { sum } from "./core.ts";\nexport function mean(xs: number[]): number {\n  return sum(xs) / xs.length;\n}\n' },
  { path: "src/clamp.ts", content: "/** Clamps a number into [lo, hi]. */\nexport function clamp(value: number, lo: number, hi: number): number {\n  if (value < lo) return lo;\n  return value;\n}\n" },
  { path: "src/hue.ts", content: "export function hue(h: number): number {\n  return h % 360;\n}\n" },
  { path: "src/tint.ts", content: "export function tint(c: number): number {\n  return c + 1;\n}\n" },
  { path: "src/shade.ts", content: "export function shade(c: number): number {\n  return c - 1;\n}\n" },
  { path: "src/split.ts", content: "function part(a: number): number {\n  return a / 2;\n}\nexport function halve(a: number): number {\n  return part(a);\n}\n" },
  { path: "src/merge.ts", content: "function part(a: number): number {\n  return a * 2;\n}\nexport function twice(a: number): number {\n  return part(a);\n}\n" },
  { path: "test/helpers.ts", content: 'import { toCm } from "../src/units.ts";\nexport const ONE_INCH = toCm(1);\n' },
  { path: "test/area.test.ts", content: `import { area, perimeter } from "../src/area.ts";\n${vt}test("area", () => { expect(area(1)).toBeCloseTo(Math.PI); expect(perimeter(1)).toBeGreaterThan(0); });\n` },
  { path: "test/round.test.ts", content: `import { round } from "../src/round.ts";\n${vt}test("round", () => { expect(round(1.234, 1)).toBe(1.2); });\n` },
  { path: "test/scale.test.ts", content: `import { scale } from "../src/vector.ts";\n${vt}test("scale", () => { expect(scale([1], 2)).toEqual([2]); });\n` },
  { path: "test/vec.test.ts", content: `import { Vec } from "../src/vec.ts";\n${vt}test("len", () => { expect(new Vec(1, 1).len()).toBe(2); });\n` },
  { path: "test/api.test.ts", content: `import { mean } from "../src/api.ts";\nimport { ONE_INCH } from "./helpers.ts";\n${vt}test("mean", () => { expect(mean([1, 3])).toBe(2); expect(ONE_INCH).toBe(2.54); });\n` },
  { path: "test/clamp.test.ts", content: `import { clamp } from "../src/clamp.ts";\n${vt}test("clamp", () => { expect(clamp(-1, 0, 2)).toBe(0); });\n` },
  { path: "test/color.test.ts", content: `import { hue } from "../src/hue.ts";\nimport { tint } from "../src/tint.ts";\nimport { shade } from "../src/shade.ts";\n${vt}test("color", () => { expect(hue(370)).toBe(10); expect(tint(1)).toBe(2); expect(shade(1)).toBe(0); });\n` },
];

/** GEO with one file replaced or added (and optionally some removed). */
export function geoWith(over: IndexFile[], drop: (p: string) => boolean = () => false): IndexFile[] {
  const out = GEO.filter((f) => !drop(f.path) && !over.some((o) => o.path === f.path));
  return [...out, ...over];
}

export const MONO: IndexFile[] = [
  { path: "LICENSE", content: LICENSE },
  { path: "package.json", content: json({ name: "mono-fixture", private: true, workspaces: ["packages/*"], scripts: { test: "yarn workspaces run test" } }) },
  { path: "yarn.lock", content: "# yarn lockfile v1\n" },
  { path: "tools/release.ts", content: "export function releaseTag(v: string): string {\n  return `v${v}`;\n}\n" },
  { path: "packages/core/package.json", content: json({ name: "@mono/core", scripts: { test: "tsc -b && node run-tests.js" }, devDependencies: { jest: "29.0.0" } }) },
  { path: "packages/core/src/queue.ts", content: "export class Queue<T> {\n  private items: T[] = [];\n  push(x: T): void {\n    this.items.push(x);\n  }\n  drain(): T[] {\n    return this.items.splice(0, this.items.length - 1);\n  }\n}\n" },
  { path: "packages/core/src/backoff.ts", content: "export function backoffDelay(attempt: number): number {\n  return 100 * attempt;\n}\n" },
  { path: "packages/core/__tests__/queue.test.ts", content: 'import { Queue } from "../src/queue";\ntest("drain", () => { const q = new Queue<number>(); q.push(1); expect(q.drain()).toEqual([1]); });\n' },
  { path: "packages/core/__tests__/backoff.test.ts", content: 'import { backoffDelay } from "../src/backoff";\ntest("delay", () => { expect(backoffDelay(1)).toBe(100); });\n' },
  { path: "packages/cli/package.json", content: json({ name: "@mono/cli", scripts: { test: "mocha" }, devDependencies: { mocha: "10.0.0" } }) },
  { path: "packages/cli/.mocharc.json", content: json({ require: "tsx", spec: "test/**/*.spec.ts" }) },
  { path: "packages/cli/src/argv.ts", content: "export function parseFlags(argv: string[]): Record<string, boolean> {\n  return Object.fromEntries(argv.filter((a) => a.startsWith(\"--\")).map((a) => [a.slice(2), true]));\n}\n" },
  { path: "packages/cli/test/argv.spec.ts", content: 'import assert from "node:assert";\nimport { parseFlags } from "../src/argv.ts";\nit("flags", () => { assert.deepEqual(parseFlags(["--x"]), { x: true }); });\n' },
];

/** PLAIN: no lockfile; `pkg` is its package.json, `extra` adds files (runner configs). */
export function plainWith(pkg: Record<string, unknown>, extra: IndexFile[] = []): IndexFile[] {
  return [
    { path: "LICENSE", content: LICENSE },
    { path: "package.json", content: json({ name: "plain-fixture", ...pkg }) },
    { path: "lib/slug.js", content: "export function slugify(s) {\n  return s.toLowerCase().replace(/\\s+/g, \"-\");\n}\n" },
    { path: "spec/slug.spec.js", content: 'import { slugify } from "../lib/slug.js";\nimport assert from "node:assert";\nassert.equal(slugify("A B"), "a-b");\n' },
    ...extra,
  ];
}

/** A repo with code and no test files at all. */
export const BARE: IndexFile[] = [
  { path: "LICENSE", content: LICENSE },
  { path: "package.json", content: json({ name: "bare-fixture" }) },
  { path: "src/hash.ts", content: "export function djb2(s: string): number {\n  let h = 5381;\n  for (const c of s) h = (h * 33) ^ c.charCodeAt(0);\n  return h >>> 0;\n}\n" },
];
