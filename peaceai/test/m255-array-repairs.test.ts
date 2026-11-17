// Array repairs. The small modules are made up.
// The es-toolkit files are the published parent and the published test, copied unmodified.
// Third-party bytes run only inside the practice sandbox.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { normalizeNegativeSplice, repairRuntimeFailure, seedEmptyMax } from "../lib/arrayfix.ts";
import { gradeBehavior } from "../lib/specgrade.ts";
import { repairTypedFailure } from "../lib/sigfix.ts";
import { practiceSandboxReady, runInPracticeSandbox, visibleNodeBin } from "../lib/practicemine.ts";

const repoRoot = resolve(import.meta.dirname, "../..");
const fix = resolve(import.meta.dirname, "fixtures/m255");
const readFix = (name: string) => readFileSync(join(fix, name), "utf8");
const modules = resolve(repoRoot, "node_modules");

const slice = `export function pullAt<T>(arr: T[], indicesToRemove: readonly number[]): T[] {\n  const indices = new Set(indicesToRemove.slice().sort((x, y) => y - x));\n  for (const index of indices) arr.splice(index, 1);\n  return [];\n}\n`;
const max = `export function unzip<T>(target: T[][]): number {\n  return Math.max(...target.map(innerArray => innerArray.length));\n}\n`;

function place(root: string, files: Record<string, string>) {
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(root, path, ".."), { recursive: true });
    writeFileSync(join(root, path), content);
  }
}

test("an empty length max is seeded with 0, and a value max is not", () => {
  const next = seedEmptyMax(max);
  assert.match(next ?? "", /Math\.max\(0, \.\.\.target\.map/);
  assert.equal(seedEmptyMax(`export const n = Math.max(...xs.map(x => x));\n`), null);
  assert.equal(seedEmptyMax(`export const n = Math.max(1, 2);\n`), null);
});

test("a descending splice normalizes a negative index, and an ascending sort does not", () => {
  const next = normalizeNegativeSplice(slice);
  assert.match(next ?? "", /index < 0 \? index \+ arr\.length : index/);
  const up = slice.replace("(x, y) => y - x", "(x, y) => x - y");
  assert.equal(normalizeNegativeSplice(up), null);
});

const mutantBase = resolve(repoRoot, "peaceai/test/.capability-mutants");
mkdirSync(mutantBase, { recursive: true });
let mutantN = 0;
async function mutant(file: string, guard: string) {
  const text = readFileSync(resolve(repoRoot, file), "utf8");
  const lines = text.split("\n");
  const hits = lines.flatMap((line, i) => (line.includes(`// ${guard}`) ? [i] : []));
  assert.equal(hits.length, 1, guard);
  const next = lines.filter((_, i) => i !== hits[0]).join("\n").replace(/from "\.\/([A-Za-z0-9-]+\.ts)"/g, (_m, name: string) => `from ${JSON.stringify(pathToFileURL(resolve(repoRoot, "peaceai/lib", name)).href)}`);
  const out = join(mutantBase, `m255-${mutantN++}.ts`);
  writeFileSync(out, next);
  return import(pathToFileURL(out).href);
}

test("deleting an array guard admits the near miss", async () => {
  const opened = await mutant("peaceai/lib/arrayfix.ts", "arr-guard:length") as { seedEmptyMax: typeof seedEmptyMax };
  assert.match(opened.seedEmptyMax(`export const n = Math.max(...xs.map(x => x));\n`) ?? "", /Math\.max\(0,/);
  const order = await mutant("peaceai/lib/arrayfix.ts", "arr-guard:descend") as { normalizeNegativeSplice: typeof normalizeNegativeSplice };
  const up = slice.replace("(x, y) => y - x", "(x, y) => x - y");
  assert.match(order.normalizeNegativeSplice(up) ?? "", /index < 0/);
});

function gitInit(root: string) {
  const git = (args: string[]) => spawnSync("git", ["-C", root, ...args], { stdio: "ignore" });
  git(["init", "-q"]);
  git(["add", "-A"]);
  git(["-c", "user.email=t@example.com", "-c", "user.name=t", "commit", "-qm", "base"]);
}

const VITEST_JS = `function eq(a, b) {\n  if (Object.is(a, b)) return true;\n  if (Array.isArray(a) && Array.isArray(b) && a.length === b.length) {\n    for (let i = 0; i < a.length; i++) if (!eq(a[i], b[i])) return false;\n    return true;\n  }\n  if (a && b && typeof a === "object" && typeof b === "object") {\n    const ka = Object.keys(a), kb = Object.keys(b);\n    return ka.length === kb.length && ka.every((k) => eq(a[k], b[k]));\n  }\n  return false;\n}\nexport const describe = (_n, fn) => fn();\nexport const it = (_n, fn) => fn();\nexport function expect(actual) {\n  return {\n    toEqual(expected) { if (!eq(actual, expected)) throw new Error("not equal"); },\n    toStrictEqual(expected) { if (!eq(actual, expected)) throw new Error("not strict"); },\n    toBe(expected) { if (!Object.is(actual, expected)) throw new Error("not same"); },\n  };\n}\nexport function expectTypeOf() { return { toEqualTypeOf() {}, not: { toEqualTypeOf() {} } }; }\n`;

function runtimeModules(): string {
  const dir = mkdtempSync(join(tmpdir(), "m255-mods-"));
  const nm = join(dir, "node_modules");
  mkdirSync(nm);
  for (const name of ["tsx", "esbuild", "@esbuild"]) {
    const copied = spawnSync("cp", ["-a", join(modules, name), join(nm, name)], { stdio: "ignore" });
    assert.equal(copied.status, 0, name);
  }
  mkdirSync(join(nm, "vitest"));
  writeFileSync(join(nm, "vitest/package.json"), `{"name":"vitest","type":"module"}\n`);
  writeFileSync(join(nm, "vitest/index.js"), VITEST_JS);
  return nm;
}

test("the published pullAt and unzipWith checks fail before the edit and pass after, inside the sandbox", (t) => {
  if (!practiceSandboxReady()) { t.skip("bwrap is not installed"); return; }
  const node = visibleNodeBin();
  assert.ok(node);
  const typeModules = runtimeModules();
  const root = mkdtempSync(join(tmpdir(), "m255-run-"));
  const spec = "src/array/pullAt.spec.ts";
  place(root, {
    "src/array/pullAt.ts": readFix("pullAt.ts.txt"),
    "src/array/at.ts": readFix("at.ts.txt"),
    [spec]: readFix("pullAt.spec.ts.txt"),
    "package.json": `{ "type": "module" }\n`,
  });
  gitInit(root);
  const cmd = [node!, "node_modules/tsx/dist/cli.mjs", spec];
  const before = runInPracticeSandbox(root, cmd, 60_000, { capture: true, nodePath: node, nodeModules: typeModules });
  assert.equal(before.unsafe, false, before.stdout);
  assert.notEqual(before.code, 0);
  const repaired = repairRuntimeFailure({ root, output: before.stdout, sourcePattern: "^src/.+\\.ts$", nodePath: node!, nodeModules: typeModules, testCommand: cmd });
  assert.ok(repaired, before.stdout);
  assert.match(repaired!.diff, /index < 0/);
  assert.equal(repaired!.file, "src/array/pullAt.ts");
  const unzip = mkdtempSync(join(tmpdir(), "m255-unzip-"));
  place(unzip, {
    "src/array/unzipWith.ts": readFix("unzipWith.ts.txt"),
    "src/array/zip.ts": readFix("zip-parent.ts.txt"),
    "src/array/unzipWith.spec.ts": readFix("unzipWith.spec.ts.txt"),
    "package.json": `{ "type": "module" }\n`,
  });
  gitInit(unzip);
  const uz = [node!, "node_modules/tsx/dist/cli.mjs", "src/array/unzipWith.spec.ts"];
  const failed = runInPracticeSandbox(unzip, uz, 60_000, { capture: true, nodePath: node, nodeModules: typeModules });
  assert.notEqual(failed.code, 0);
  assert.match(failed.stdout, /RangeError/);
  const seeded = repairRuntimeFailure({ root: unzip, output: failed.stdout, sourcePattern: "^src/.+\\.ts$", nodePath: node!, nodeModules: typeModules, testCommand: uz });
  assert.ok(seeded, failed.stdout);
  assert.match(seeded!.diff, /Math\.max\(0,/);
  rmSync(root, { recursive: true, force: true });
  rmSync(unzip, { recursive: true, force: true });
  rmSync(resolve(typeModules, ".."), { recursive: true, force: true });
});

test("the published partition type check is TS2769 before the callback return is unknown", (t) => {
  if (!practiceSandboxReady()) { t.skip("bwrap is not installed"); return; }
  const node = visibleNodeBin();
  assert.ok(node);
  const dir = mkdtempSync(join(tmpdir(), "m255-tsc-"));
  const nm = join(dir, "node_modules");
  mkdirSync(join(nm, "@types"), { recursive: true });
  spawnSync("cp", ["-a", join(modules, "typescript"), join(nm, "typescript")], { stdio: "ignore" });
  spawnSync("cp", ["-a", join(modules, "@types/node"), join(nm, "@types/node")], { stdio: "ignore" });
  mkdirSync(join(nm, "vitest"));
  writeFileSync(join(nm, "vitest/package.json"), `{"name":"vitest","types":"index.d.ts"}\n`);
  writeFileSync(join(nm, "vitest/index.d.ts"), `export function describe(name: string, fn: () => void): void;\nexport function it(name: string, fn: () => void): void;\nexport const expect: any;\nexport interface ExpectTypeOf<T> { toEqualTypeOf<U>(): void; not: { toEqualTypeOf<U>(): void } }\nexport function expectTypeOf<T>(...args: unknown[]): ExpectTypeOf<T>;\n`);
  const root = mkdtempSync(join(tmpdir(), "m255-part-"));
  const tsconfig = { compilerOptions: { target: "ES2022", module: "ESNext", moduleResolution: "Bundler", strict: true, skipLibCheck: true, noEmit: true }, include: ["src/array/partition.ts", "src/array/partition.spec.ts"] };
  place(root, {
    "src/array/partition.ts": readFix("partition.ts.txt"),
    "src/array/partition.spec.ts": readFix("partition.spec.ts.txt"),
    "tsconfig.json": JSON.stringify(tsconfig) + "\n",
    "package.json": `{ "type": "module" }\n`,
    "run.mjs": `import { spawnSync } from "node:child_process";\nconst tsc = spawnSync(process.execPath, ["node_modules/typescript/lib/tsc.js", "--noEmit", "--pretty", "false", "-p", "tsconfig.json"], { encoding: "utf8" });\nprocess.stdout.write(tsc.stdout); process.stderr.write(tsc.stderr);\nprocess.exit(tsc.status ?? 1);\n`,
  });
  gitInit(root);
  const cmd = [node!, "run.mjs"];
  const before = runInPracticeSandbox(root, cmd, 60_000, { capture: true, nodePath: node, nodeModules: nm });
  assert.notEqual(before.code, 0, before.stdout);
  assert.match(before.stdout, /error TS2769/);
  const repaired = repairTypedFailure({ root, output: before.stdout, sourcePattern: "^src/.+\\.ts$", nodePath: node!, nodeModules: nm, testCommand: cmd });
  assert.ok(repaired, before.stdout);
  assert.match(repaired!.diff, /=> unknown/);
  rmSync(root, { recursive: true, force: true });
  rmSync(dir, { recursive: true, force: true });
});

test("a predicate that always returns the recorded group is test-only", (t) => {
  if (!practiceSandboxReady()) { t.skip("bwrap is not installed"); return; }
  const node = visibleNodeBin();
  assert.ok(node);
  const strict = `export function label(kind: "a" | "b"): string {\n  return kind === "b" ? "B" : "A";\n}\n`;
  const over = `export function label(kind: any): string {\n  return "A";\n}\n`;
  const make = (body: string) => {
    const dir = mkdtempSync(join(tmpdir(), "m255-grade-"));
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(join(dir, "src/label.ts"), body);
    return dir;
  };
  const left = make(over);
  const right = make(strict);
  try {
    const graded = gradeBehavior({
      candidateRoot: left, fixRoot: right, nodePath: node!,
      target: { symbol: "label", file: "src/label.ts", form: "named", exportName: "label", args: [["a"]] },
    });
    assert.equal(graded.behavior, "verified_test_only");
  } finally {
    rmSync(left, { recursive: true, force: true });
    rmSync(right, { recursive: true, force: true });
  }
});
