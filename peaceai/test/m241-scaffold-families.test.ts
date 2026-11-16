// Integer conjunction. The admitting case is nkzw-tech/core isPositiveInteger
// at e2f272e057cd87c4a0fcc650dd508ea40d4a62dc. A bare comparison keeps the first form.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import ts from "typescript";
import { scaffoldPlan } from "../lib/testspec.ts";

const PATTERN = "^src/.+\\.ts$";
const root = resolve(import.meta.dirname, "../..");
const fixture = resolve(import.meta.dirname, "fixtures/m241");

const NKZW = {
  repo: "nkzw-tech/core",
  commit: "e2f272e057cd87c4a0fcc650dd508ea40d4a62dc",
  source: "src/isPositiveInteger.ts",
  test: "src/__tests__/isPositiveInteger.test.ts",
  license: "LICENSE",
  sourceSha256: "10c6b32ac665b43e6eede19f80e8ed5a3a77cc08ec93c4be172b3979a9167af4",
  testSha256: "eb29a4526fd86e08d08449f6ac2a40b7c0c356bc3e452f4abbdb36ca14fb5301",
  licenseSha256: "089bb3c5097231756c1ca66bda8b2ad0d934dc9b6402c2eead08710e8702ed34",
};

function pinned(name: string): string {
  return readFileSync(join(fixture, name), "utf8");
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function named(name: string, body: string) {
  const text = `import { ${name} } from "./${name}.ts";\n${body}\n`;
  return scaffoldPlan(`src/${name}.test.ts`, text, `Cannot find module '/work/src/${name}.ts'`, PATTERN, [], () => null);
}

test("a bare integer class keeps the first form", () => {
  const above = named("above", [
    "assert.equal(above(-3), false);",
    "assert.equal(above(3), false);",
    "assert.equal(above(4), true);",
    "assert.equal(above(7), true);",
  ].join("\n"));
  assert.equal(above?.ok, true);
  if (above?.ok) {
    assert.match(above.files[0]!.content, /return a > 3;/);
    assert.equal(above.files[0]!.content.includes(">="), false);
    assert.equal(above.files[0]!.content.includes("Number.isInteger"), false);
  }
  const wide = named("wide", "assert.equal(wide(3), false);\nassert.equal(wide(7), true);");
  assert.equal(wide?.ok, false);
});

test("a rejected non-integer conjoins Number.isInteger, and a true fraction does not", () => {
  const whole = named("whole", [
    "assert.equal(whole(-4), false);",
    "assert.equal(whole(8), false);",
    "assert.equal(whole(9), true);",
    "assert.equal(whole(12), true);",
    "assert.equal(whole(9.5), false);",
  ].join("\n"));
  assert.equal(whole?.ok, true);
  if (whole?.ok) assert.match(whole.files[0]!.content, /return Number\.isInteger\(a\) && a >= 9;/);
  const fraction = named("fraction", [
    "assert.equal(fraction(-4), false);",
    "assert.equal(fraction(8), false);",
    "assert.equal(fraction(9.5), true);",
    "assert.equal(fraction(9), true);",
    "assert.equal(fraction(12), true);",
  ].join("\n"));
  assert.equal(fraction?.ok, false);
  const hole = named("hole", "assert.equal(hole(8), false);\nassert.equal(hole(12), true);\nassert.equal(hole(9.5), false);");
  assert.equal(hole?.ok, false);
});

function publishedTest(): string {
  return pinned("nkzw-isPositiveInteger.test.ts.txt")
    .replace("from 'vitest'", "from './shim.mjs'")
    .replace("from '../isPositiveInteger.ts'", "from './isPositiveInteger.mjs'");
}

async function runPublished(moduleText: string): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "peaceai-nkzw-"));
  const shim = [
    "export function expect(actual) {",
    "  return { toBe(expected) { if (!Object.is(actual, expected)) throw new Error(String(actual) + ' !== ' + String(expected)); } };",
    "}",
    "export function test(_name, fn) { fn(); }",
    "",
  ].join("\n");
  const js = (file: string, text: string) => ts.transpileModule(text, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    fileName: file,
  }).outputText;
  writeFileSync(join(dir, "shim.mjs"), shim);
  writeFileSync(join(dir, "isPositiveInteger.mjs"), js("isPositiveInteger.ts", moduleText));
  writeFileSync(join(dir, "run.mjs"), js("isPositiveInteger.test.ts", publishedTest()));
  try {
    await import(`${pathToFileURL(join(dir, "run.mjs")).href}?t=${Date.now()}-${Math.random()}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("nkzw-tech/core isPositiveInteger is admitted from the pinned test", async () => {
  const source = pinned("nkzw-isPositiveInteger.ts.txt");
  const spec = pinned("nkzw-isPositiveInteger.test.ts.txt");
  const license = pinned("nkzw-LICENSE.txt");
  assert.equal(sha256(source), NKZW.sourceSha256);
  assert.equal(sha256(spec), NKZW.testSha256);
  assert.equal(sha256(license), NKZW.licenseSha256);
  assert.match(license, /MIT License/);
  assert.match(license, /Permission is hereby granted/);
  assert.match(source, /Number\.isInteger\(number\) && \(number as number\) > 0/);
  const missing = "export default function isPositiveInteger(_number: unknown): boolean {\n  throw new Error(\"missing\");\n}\n";
  await assert.rejects(() => runPublished(missing));
  await runPublished(source);
  const plan = scaffoldPlan(
    "src/__tests__/isPositiveInteger.test.ts",
    spec,
    "Error [ERR_MODULE_NOT_FOUND]: Cannot find module '../isPositiveInteger.ts'",
    PATTERN,
    [],
    () => null,
  );
  assert.equal(plan?.ok, true);
  if (!plan?.ok) return;
  assert.equal(plan.fit.shape, "integer");
  assert.match(plan.files[0]!.content, /return Number\.isInteger\(a\) && a >= 1;/);
  assert.equal(plan.files[0]!.content.includes("> 0"), false);
  await runPublished(plan.files[0]!.content);
});

const base = resolve(root, "peaceai/test/.m241-mutants");
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

test("deleting a scaffold guard admits the case it refused", async () => {
  const opened = await mutant("cmp-guard:closed-bound") as typeof import("../lib/testspec.ts");
  const whole = opened.scaffoldPlan(
    "src/whole.test.ts",
    'import { whole } from "./whole.ts";\nassert.equal(whole(-4), false);\nassert.equal(whole(8), false);\nassert.equal(whole(9), true);\nassert.equal(whole(12), true);\nassert.equal(whole(9.5), false);\n',
    "Cannot find module '/work/src/whole.ts'",
    PATTERN, [], () => null,
  );
  assert.equal(whole?.ok, true);
  if (whole?.ok) assert.match(whole.files[0]!.content, /return Number\.isInteger\(a\) && a > 8;/);

  const fraction = await mutant("int-guard:needs-fraction") as typeof import("../lib/testspec.ts");
  const bare = fraction.scaffoldPlan(
    "src/above.test.ts",
    'import { above } from "./above.ts";\nassert.equal(above(-3), false);\nassert.equal(above(3), false);\nassert.equal(above(4), true);\nassert.equal(above(7), true);\n',
    "Cannot find module '/work/src/above.ts'",
    PATTERN, [], () => null,
  );
  assert.equal(bare?.ok, false);

  const accepted = await mutant("int-guard:others-false") as typeof import("../lib/testspec.ts");
  const half = accepted.scaffoldPlan(
    "src/fraction.test.ts",
    'import { fraction } from "./fraction.ts";\nassert.equal(fraction(-4), false);\nassert.equal(fraction(8), false);\nassert.equal(fraction(9.5), true);\nassert.equal(fraction(9), true);\nassert.equal(fraction(12), true);\n',
    "Cannot find module '/work/src/fraction.ts'",
    PATTERN, [], () => null,
  );
  assert.equal(half?.ok, true);
  if (half?.ok) assert.match(half.files[0]!.content, /Number\.isInteger/);

  const classes = await mutant("int-guard:one-class") as typeof import("../lib/testspec.ts");
  const hole = classes.scaffoldPlan(
    "src/hole.test.ts",
    'import { hole } from "./hole.ts";\nassert.equal(hole(8), false);\nassert.equal(hole(12), true);\nassert.equal(hole(9.5), false);\n',
    "Cannot find module '/work/src/hole.ts'",
    PATTERN, [], () => null,
  );
  assert.equal(hole?.ok, true);
  rmSync(base, { recursive: true, force: true });
});
