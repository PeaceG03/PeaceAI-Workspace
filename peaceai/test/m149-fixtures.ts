// M149 fixtures: small in-memory repositories of two code shapes that share nothing with any training or task repo.
//   KIT: a flat utility library (src/*.ts, test/*.test.ts, a named-export entry plus one `export *`).
//   SVC: a nested service (src/<area>/<name>.ts, tests/<area>/<name>.spec.ts, a test harness tests/index.ts).
import { sha256 } from "../lib/plan.ts";
import type { IndexFile } from "../lib/symbols.ts";

export const LICENSE = "MIT License\n";
const pkg = (test: string) => JSON.stringify({ name: "fixture", scripts: { test } });

export const KIT: IndexFile[] = [
  { path: "LICENSE", content: LICENSE },
  { path: "package.json", content: pkg("vitest run") },
  { path: "src/index.ts", content: 'export { clamp } from "./clamp.ts";\nexport { pad } from "./pad.ts";\nexport { slugify } from "./slug.ts";\nexport { MAX_RETRIES } from "./limits.ts";\nexport { pipe } from "./pipe.ts";\nexport * from "./misc.ts";\n' },
  { path: "src/clamp.ts", content: "/** Clamps a number into [lo, hi]. */\nexport function clamp(value: number, lo: number, hi: number): number {\n  if (value < lo) return lo;\n  return value;\n}\n" },
  { path: "src/pad.ts", content: "/** Pads a string on the left to width n. */\nexport function pad(text: string, n: number): string {\n  const width = Math.min(n, 10);\n  return text.padStart(width);\n}\n" },
  { path: "src/slug.ts", content: "/** Lower-cases and dashes a title. */\nexport function slugify(title: string): string {\n  return title.toLowerCase().replace(/[^a-z0-9]+/g, \"-\");\n}\n" },
  { path: "src/format.ts", content: "/** Two-digit zero padding for clock fields (a different `pad`). */\nexport function pad(n: number): string {\n  return String(n).padStart(2, \"0\");\n}\n" },
  { path: "src/limits.ts", content: "export const MAX_RETRIES = 3;\nexport const TIMEOUT_MS = 1000;\n" },
  { path: "src/misc.ts", content: "export function noop(): void {}\nexport function identity<T>(x: T): T {\n  return x;\n}\n" },
  { path: "src/pipe.ts", content: "export function pipe<T>(value: T, ...fns: ((x: any) => any)[]): any {\n  return fns.reduce((acc, f) => f(acc), value);\n}\n" },
  { path: "src/pick.ts", content: "export function pick<T extends object>(keys: string[]) {\n  return (obj: T) => Object.fromEntries(Object.entries(obj).filter(([k]) => keys.includes(k)));\n}\n" },
  { path: "test/clamp.test.ts", content: 'import { clamp } from "../src/clamp.ts";\nimport { test, expect } from "vitest";\ntest("clamp", () => { expect(clamp(-1, 0, 2)).toBe(0); });\n' },
  { path: "test/misc.test.ts", content: 'import { identity } from "../src/misc.ts";\nimport { test, expect } from "vitest";\ntest("identity", () => { expect(identity(1)).toBe(1); });\n' },
  { path: "test/pad.test.ts", content: 'import { pad } from "../src/pad.ts";\nimport { test, expect } from "vitest";\ntest("pad", () => { expect(pad("a", 3)).toBe("  a"); });\n' },
  { path: "test/pick.test.ts", content: 'import { pick } from "../src/pick.ts";\nimport { pipe } from "../src/pipe.ts";\nimport { test, expect } from "vitest";\ntest("pick", () => { expect(pipe({ a: 1 }, pick(["a"]))).toEqual({ a: 1 }); });\n' },
  { path: "test/pipe.test.ts", content: 'import { pipe } from "fixture";\nimport { test, expect } from "vitest";\ntest("pipe", () => { expect(pipe(1, (x: number) => x + 1)).toBe(2); });\n' },
];

export const SVC: IndexFile[] = [
  { path: "LICENSE", content: LICENSE },
  { path: "package.json", content: pkg("mocha") },
  { path: "src/index.ts", content: 'export * from "./cache/cache-loader.ts";\nexport * from "./http/request-handler.ts";\n' },
  { path: "src/cache/cache-loader.ts", content: 'import { cacheKey } from "../helpers/cache.ts";\nexport class CacheLoader {\n  private store = new Map<string, string>();\n  load(id: string): string | undefined {\n    return this.store.get(cacheKey(id));\n  }\n}\n' },
  { path: "src/helpers/cache.ts", content: 'export function cacheKey(id: string): string {\n  return "k:" + id;\n}\n' },
  { path: "src/http/request-handler.ts", content: 'import { EMAIL_REGEX } from "../patterns.ts";\nexport function handle(body: string): number {\n  return validateEmail(body) ? 200 : 400;\n}\nexport function validateEmail(s: string): boolean {\n  return EMAIL_REGEX.test(s);\n}\n' },
  { path: "src/patterns.ts", content: "export const EMAIL_REGEX = /^[^@]+@[^@]+$/;\nexport const PHONE_REGEX = /^\\+?[0-9]+$/;\n" },
  { path: "src/http/retry.ts", content: "export function retryHelper<T>(f: () => T, n: number): T {\n  for (let i = 0; i < n - 1; i++) { try { return f(); } catch { /* again */ } }\n  return f();\n}\n" },
  { path: "src/http/handler.ts", content: "export abstract class Handler {\n  abstract run(body: string): number;\n}\n" },
  { path: "src/http/upload.ts", content: 'import { Handler } from "./handler.ts";\nexport class Upload extends Handler {\n  run(body: string): number {\n    return body.length > 0 ? 201 : 400;\n  }\n}\n' },
  { path: "tests/http/upload.spec.ts", content: 'import { Upload } from "../../src/http/upload.ts";\nimport assert from "node:assert";\ndescribe("Upload", () => { it("201", () => { assert.equal(new Upload().run("x"), 201); }); });\n' },
  { path: "tests/index.ts", content: 'import { cacheKey } from "../src/helpers/cache.ts";\nexport const warm = cacheKey("warm");\nimport "./cache/cache-loader.spec.ts";\nimport "./http/request-handler.spec.ts";\nimport "./http/retry.spec.ts";\n' },
  { path: "tests/cache/cache-loader.spec.ts", content: 'import { CacheLoader } from "../../src/cache/cache-loader.ts";\nimport assert from "node:assert";\ndescribe("CacheLoader", () => { it("misses", () => { assert.equal(new CacheLoader().load("x"), undefined); }); });\n' },
  { path: "tests/http/request-handler.spec.ts", content: 'import { handle } from "../../src/http/request-handler.ts";\nimport assert from "node:assert";\ndescribe("handle", () => { it("400", () => { assert.equal(handle("x"), 400); }); });\n' },
  { path: "tests/http/retry.spec.ts", content: 'import { retryHelper } from "../../src/http/retry.ts";\nimport assert from "node:assert";\ndescribe("retryHelper", () => { it("returns", () => { assert.equal(retryHelper(() => 1, 2), 1); }); });\n' },
];

export const LICENSE_SHA = sha256(LICENSE);
