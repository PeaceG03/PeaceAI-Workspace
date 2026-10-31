// M164 fixtures (part B): small in-memory repositories written for plan-only-v4's named-test rule; they share nothing
// with any training or task repo.
//   SCHEMA: a flat validation library (pnpm lockfile, vitest). Its source src/struct.ts is imported directly by an
//           aggregate typings test (the one v3's import-based pick prefers), while the test named after the
//           function, test/api/create.test.ts, reaches it only through src/index.ts. A helper file is also named
//           after it (not a behavior test). `schemaWith` adds or drops files.
//   WS:     a pnpm workspace: packages/core holds the source and its direct test; the only test named after the
//           function is in another package (packages/legacy).
import type { IndexFile } from "../lib/symbols.ts";
import { LICENSE } from "./m153-fixtures.ts";

const json = (o: unknown) => JSON.stringify(o, null, 2) + "\n";
const vt = 'import { test, expect } from "vitest";\n';
const STRUCT = "export function create<T>(value: T, fallback?: T): T | undefined {\n  return value === undefined ? undefined : value;\n}\nexport function assertValid<T>(value: T): T {\n  if (value === null) throw new Error(\"invalid\");\n  return value;\n}\n";
const COERCE = "export function coerce(value: unknown): number {\n  return Number(value);\n}\n";

export const SCHEMA: IndexFile[] = [
  { path: "LICENSE", content: LICENSE },
  { path: "package.json", content: json({ name: "schema-fixture", scripts: { test: "vitest" }, devDependencies: { vitest: "1.0.0" } }) },
  { path: "pnpm-lock.yaml", content: "lockfileVersion: '9.0'\n" },
  { path: "src/struct.ts", content: STRUCT },
  { path: "src/coerce.ts", content: COERCE },
  { path: "src/index.ts", content: 'export * from "./struct.ts";\nexport * from "./coerce.ts";\n' },
  { path: "test/typings/struct.test.ts", content: `import { create, assertValid } from "../../src/struct.ts";\n${vt}test("types", () => { expect(create(1)).toBe(1); expect(create("a", "b")).toBe("a"); expect(assertValid(2)).toBe(2); expect(create(undefined, 3)).toBe(undefined); });\n` },
  { path: "test/api/create.test.ts", content: `import { create } from "../../src/index.ts";\n${vt}test("create", () => { expect(create(1)).toBe(1); });\n` },
  { path: "test/api/coerce.test.ts", content: `import { coerce } from "../../src/index.ts";\n${vt}test("coerce", () => { expect(coerce("1")).toBe(1); });\n` },
  { path: "test/helpers/create.ts", content: 'import { create } from "../../src/index.ts";\nexport const made = create(0);\n' },
];

/** SCHEMA with files added (or replaced) and optionally some removed. */
export function schemaWith(over: IndexFile[], drop: (p: string) => boolean = () => false): IndexFile[] {
  return [...SCHEMA.filter((f) => !drop(f.path) && !over.some((o) => o.path === f.path)), ...over];
}

export const WS: IndexFile[] = [
  { path: "LICENSE", content: LICENSE },
  { path: "package.json", content: json({ name: "ws-fixture", private: true, scripts: { test: "pnpm -r test" } }) },
  { path: "pnpm-lock.yaml", content: "lockfileVersion: '9.0'\n" },
  { path: "pnpm-workspace.yaml", content: "packages:\n  - packages/*\n" },
  { path: "packages/core/package.json", content: json({ name: "@ws/core", scripts: { test: "vitest" }, devDependencies: { vitest: "1.0.0" } }) },
  { path: "packages/core/src/struct.ts", content: STRUCT },
  { path: "packages/core/test/struct.test.ts", content: `import { create } from "../src/struct.ts";\n${vt}test("struct", () => { expect(create(1)).toBe(1); expect(create(2, 3)).toBe(2); });\n` },
  { path: "packages/legacy/package.json", content: json({ name: "@ws/legacy", scripts: { test: "vitest" }, devDependencies: { vitest: "1.0.0" } }) },
  { path: "packages/legacy/src/make.ts", content: "export function make(): number {\n  return 1;\n}\n" },
  { path: "packages/legacy/test/create.test.ts", content: `import { make } from "../src/make.ts";\n${vt}test("create", () => { expect(make()).toBe(1); });\n` },
];
