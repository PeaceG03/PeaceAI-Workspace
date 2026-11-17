// Signature repair. The small modules are made up.
// The oaverify files are the published parent and the published test, copied unmodified.
// Third-party bytes run only inside the practice sandbox.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { parseTypeDiagnostics, proposedSignature, repairTypedFailure, typecheckRejected, widenParam } from "../lib/sigfix.ts";
import { gradeBehavior } from "../lib/specgrade.ts";
import { practiceSandboxReady, runInPracticeSandbox, visibleNodeBin } from "../lib/practicemine.ts";

const repoRoot = resolve(import.meta.dirname, "../..");
const errorsSrc = readFileSync(resolve(import.meta.dirname, "fixtures/m254/errors.ts.txt"), "utf8");
const errorsTest = readFileSync(resolve(import.meta.dirname, "fixtures/m254/errors.test.ts.txt"), "utf8");
const SOURCE_PIN = "44511f2b9daa20e9850c5a156c306f14a2180083";
const TEST_PIN = "888eb66ea0a386f01e507c48d1930fe9d2422121";
const SOURCE_SHA = "bea54ccb6d3c16c588747f5f43ef297b9538ab72acb5a3f73ab796d0ab97b901";
const TEST_SHA = "95758b2f21f3dbdd927a6d518026b157545aa39a799e994571c60fdaa8c76054";
const modules = resolve(repoRoot, "node_modules");
const VITEST_TYPES = `export function describe(name: string, fn: () => void): void;\nexport function it(name: string, fn: () => void | Promise<void>): void;\nexport namespace describe { function each<T>(cases: readonly T[]): (name: string, fn: (arg: T) => void) => void; }\nexport namespace it { function each<T>(cases: readonly T[]): (name: string, fn: (arg: T) => void) => void; }\nexport const expect: any;\nexport interface ExpectTypeOf<T> { toEqualTypeOf<U>(): void; toExtend<U>(): void; not: { toEqualTypeOf<U>(): void; toExtend<U>(): void }; }\nexport function expectTypeOf<T>(): ExpectTypeOf<T>;\n`;
const atSrc = `export function at<T>(arr: readonly T[], indices: number[]): T[] {\n  const result = new Array<T>(indices.length);\n  for (let i = 0; i < indices.length; i++) {\n    const index = indices[i]!;\n    result[i] = arr[index < 0 ? arr.length + index : index];\n  }\n  return result;\n}\n`;

function place(root: string, files: Record<string, string>) {
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(root, path, ".."), { recursive: true });
    writeFileSync(join(root, path), content);
  }
}

function atCall(name = "indices"): string {
  return `import { at } from "../src/array/at.ts";\nconst ${name} = [0, 2] as const;\nexport const out = at(["a", "b", "c"], ${name});\n`;
}

function diag(file: string, text: string, needle: string, message: string): string {
  const at = text.lastIndexOf(needle);
  const pre = text.slice(0, at);
  const line = pre.split("\n").length;
  const col = at - pre.lastIndexOf("\n");
  return `${file}(${line},${col}): error TS2345: ${message}`;
}

test("a type diagnostic records the file, the code, and the two types", () => {
  const rows = parseTypeDiagnostics([
    `test/call.ts(3,42): error TS2345: Argument of type 'readonly number[]' is not assignable to parameter of type 'number[]'.`,
    `src/a.ts:4:8 - error TS2554: Expected 1 arguments, but got 2.`,
    `src/a.ts(2,3): error TS2339: Property 'end' does not exist on type '{ start: number; }'.`,
    `src/a.ts(2,3): error TS2322: Type 'string' is not assignable to type 'number'.`,
    `not a diagnostic`,
  ].join("\n"));
  assert.equal(rows.length, 4);
  assert.equal(rows[0]!.code, "TS2345");
  assert.equal(rows[0]!.argument, "readonly number[]");
  assert.equal(rows[0]!.parameter, "number[]");
  assert.equal(rows[1]!.code, "TS2554");
  assert.equal(rows[1]!.expected, 1);
  assert.equal(rows[1]!.got, 2);
  assert.equal(rows[2]!.code, "TS2339");
  assert.equal(proposedSignature("/nope", rows.map((r) => `${r.file}(${r.line},${r.col}): error ${r.code}: ${r.message}`).join("\n")), null);
});

test("a readonly array widens the parameter, and the near misses refuse", () => {
  assert.equal(widenParam("number[]", "readonly number[]"), "readonly number[]");
  assert.equal(widenParam("PathSegment[]", "readonly PathSegment[]"), "readonly PathSegment[]");
  assert.equal(widenParam("string", "number"), null);
  assert.equal(widenParam('"a"', '"b"'), null);
  const root = mkdtempSync(join(tmpdir(), "sig-plan-"));
  const call = atCall();
  place(root, {
    "src/array/at.ts": atSrc,
    "test/call.ts": call,
    "src/keep.ts": `import { at } from "./array/at.ts";\nexport const kept = at(["a", "b"], [1]);\n`,
  });
  const output = diag("test/call.ts", call, "indices)", "Argument of type 'readonly [0, 2]' is not assignable to parameter of type 'number[]'.");
  const plan = proposedSignature(root, output, "^src/.+\\.ts$");
  assert.ok(plan);
  assert.equal(plan!.path, "src/array/at.ts");
  assert.match(plan!.content, /indices: readonly number\[\]/);
  assert.equal(proposedSignature(root, diag("test/helpers.ts", `import { at } from "../src/array/at.ts";\nexport const out = at([1], indices);\n`, "indices", "Argument of type 'readonly number[]' is not assignable to parameter of type 'number[]'.")), null);
  const vendor = `export function at<T>(arr: readonly T[], indices: number[]): T[] { return []; }\n`;
  place(root, { "vendor/box.ts": vendor, "test/vend.ts": `import { at } from "../vendor/box.ts";\nconst indices = [0] as const;\nexport const out = at([1], indices);\n` });
  const vendText = readFileSync(join(root, "test/vend.ts"), "utf8");
  assert.equal(proposedSignature(root, diag("test/vend.ts", vendText, "indices", "Argument of type 'readonly [0]' is not assignable to parameter of type 'number[]'.")), null);
  const two = `export function at<T>(arr: readonly T[], indices: number[]): T[] { return []; }\nexport function at<T>(arr: readonly T[], indices: number[]): T[] { return []; }\n`;
  place(root, { "src/two.ts": two, "test/two.ts": `import { at } from "../src/two.ts";\nconst indices = [0] as const;\nexport const out = at([1], indices);\n` });
  const twoText = readFileSync(join(root, "test/two.ts"), "utf8");
  assert.equal(proposedSignature(root, diag("test/two.ts", twoText, "indices", "Argument of type 'readonly [0]' is not assignable to parameter of type 'number[]'.")), null);
  const anyCall = `import { at } from "../src/array/at.ts";\nexport const out = at(["a"], flag);\n`;
  place(root, { "test/any.ts": anyCall });
  assert.equal(proposedSignature(root, diag("test/any.ts", anyCall, "flag", "Argument of type 'any' is not assignable to parameter of type 'number[]'.")), null);
  const pred = `import { check } from "../src/check.ts";\nexport const out = check([isString]);\n`;
  place(root, { "src/check.ts": `export function check(value: string): boolean { return value.length > 0; }\n`, "test/pred.ts": pred });
  assert.equal(proposedSignature(root, diag("test/pred.ts", pred, "[isString]", "Argument of type '((value: unknown) => value is string)[]' is not assignable to parameter of type 'string'.")), null);
  rmSync(root, { recursive: true, force: true });
});

test("a union is refused when the body only stringifies, concatenates, json-encodes, or ignores the value", () => {
  const cases = [
    ["show-string.ts", `export function show(x: string): string { return String(x); }\n`, "number", "string"],
    ["show-plus.ts", `export function show(x: string): string { return "x:" + x; }\n`, "number", "string"],
    ["show-json.ts", `export function show(x: string): string { return JSON.stringify(x); }\n`, "number", "string"],
    ["show-unused.ts", `export function show(x: string): number { return 1; }\n`, "number", "string"],
  ] as const;
  const root = mkdtempSync(join(tmpdir(), "sig-union-"));
  for (const [file, src, arg, param] of cases) {
    const call = `import { show } from "../src/${file}";\nexport const out = show(1);\n`;
    place(root, { [`src/${file}`]: src, "test/call.ts": call });
    const output = diag("test/call.ts", call, "1)", `Argument of type '${arg}' is not assignable to parameter of type '${param}'.`);
    assert.equal(proposedSignature(root, output, "^src/.+\\.ts$"), null, file);
  }
  rmSync(root, { recursive: true, force: true });
});

function typecheckModules(): string {
  const dir = mkdtempSync(join(tmpdir(), "sig-mods-"));
  const nm = join(dir, "node_modules");
  mkdirSync(join(nm, "@types"), { recursive: true });
  mkdirSync(join(nm, "vitest"), { recursive: true });
  for (const [from, to] of [[join(modules, "typescript"), join(nm, "typescript")], [join(modules, "@types/node"), join(nm, "@types/node")]] as const) {
    const copied = spawnSync("cp", ["-a", from, to], { stdio: "ignore" });
    assert.equal(copied.status, 0, from);
  }
  writeFileSync(join(nm, "vitest/package.json"), `{"name":"vitest","types":"index.d.ts"}\n`);
  writeFileSync(join(nm, "vitest/index.d.ts"), VITEST_TYPES);
  return nm;
}

function gitInit(root: string) {
  const git = (args: string[]) => spawnSync("git", ["-C", root, ...args], { stdio: "ignore" });
  git(["init", "-q"]);
  git(["add", "-A"]);
  git(["-c", "user.email=t@example.com", "-c", "user.name=t", "commit", "-qm", "base"]);
}

test("the published oaverify errors test is TS2345 before the readonly widening and clean after, inside the sandbox", (t) => {
  if (!practiceSandboxReady()) { t.skip("bwrap is not installed"); return; }
  const node = visibleNodeBin();
  assert.ok(node);
  assert.equal(SOURCE_PIN.length, 40);
  assert.equal(TEST_PIN.length, 40);
  assert.equal(createHash("sha256").update(errorsSrc).digest("hex"), SOURCE_SHA);
  assert.equal(createHash("sha256").update(errorsTest).digest("hex"), TEST_SHA);
  const root = mkdtempSync(join(tmpdir(), "sig-oav-"));
  const typeModules = typecheckModules();
  const tsconfig = {
    compilerOptions: {
      target: "ES2022", module: "ESNext", moduleResolution: "Bundler", lib: ["ES2022"], types: ["node"],
      strict: true, noUncheckedIndexedAccess: true, skipLibCheck: true, noEmit: true, moduleDetection: "force",
    },
    include: ["packages/core/src/errors.ts", "packages/core/test/errors.test.ts"],
  };
  place(root, {
    "packages/core/src/errors.ts": errorsSrc,
    "packages/core/test/errors.test.ts": errorsTest,
    "tsconfig.json": JSON.stringify(tsconfig) + "\n",
    "package.json": `{ "type": "module" }\n`,
    "run.mjs": `import { spawnSync } from "node:child_process";\nconst tsc = spawnSync(process.execPath, ["node_modules/typescript/lib/tsc.js", "--noEmit", "--pretty", "false", "-p", "tsconfig.json"], { encoding: "utf8" });\nprocess.stdout.write(tsc.stdout); process.stderr.write(tsc.stderr);\nprocess.exit(tsc.status ?? 1);\n`,
  });
  gitInit(root);
  const cmd = [node!, "run.mjs"];
  const before = runInPracticeSandbox(root, cmd, 60_000, { capture: true, nodePath: node, nodeModules: typeModules });
  assert.equal(before.unsafe, false);
  assert.notEqual(before.code, 0);
  assert.match(before.stdout, /packages\/core\/test\/errors\.test\.ts\(\d+,\d+\): error TS2345/);
  const repaired = repairTypedFailure({
    root, output: before.stdout, sourcePattern: "^packages/core/src/.+\\.ts$", nodePath: node!, nodeModules: typeModules, testCommand: cmd,
  });
  assert.ok(repaired, before.stdout);
  assert.match(repaired!.diff, /readonly PathSegment\[\]/);
  assert.equal(repaired!.file, "packages/core/src/errors.ts");
  writeFileSync(join(root, "packages/core/src/errors.ts"), errorsSrc.replaceAll("  path: PathSegment[],\n  message: string,\n", "  path: readonly PathSegment[],\n  message: string,\n"));
  const after = runInPracticeSandbox(root, cmd, 60_000, { capture: true, nodePath: node, nodeModules: typeModules });
  assert.equal(after.code, 0, after.stdout);
  rmSync(root, { recursive: true, force: true });
  rmSync(resolve(typeModules, ".."), { recursive: true, force: true });
});

test("an any-cast that only matches the recorded call is test-only", (t) => {
  if (!practiceSandboxReady()) { t.skip("bwrap is not installed"); return; }
  const node = visibleNodeBin();
  assert.ok(node);
  const strict = `export function label(kind: "a" | "b"): string {\n  return kind === "b" ? "B" : "A";\n}\n`;
  const over = `export function label(kind: any): string {\n  return "A";\n}\n`;
  const make = (body: string) => {
    const dir = mkdtempSync(join(tmpdir(), "sig-grade-"));
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
    assert.ok(graded.counterexample);
  } finally {
    rmSync(left, { recursive: true, force: true });
    rmSync(right, { recursive: true, force: true });
  }
});

const mutantBase = resolve(repoRoot, "peaceai/test/.capability-mutants");
mkdirSync(mutantBase, { recursive: true });
let mutantN = 0;
async function mutant(guard: string) {
  const text = readFileSync(resolve(repoRoot, "peaceai/lib/sigfix.ts"), "utf8");
  const lines = text.split("\n");
  const hits = lines.flatMap((line, i) => (line.includes(`// ${guard}`) ? [i] : []));
  assert.equal(hits.length, 1, guard);
  const next = lines.filter((_, i) => i !== hits[0]).join("\n").replace(/from "\.\/([A-Za-z0-9-]+\.ts)"/g, (_m, f: string) => `from ${JSON.stringify(pathToFileURL(resolve(repoRoot, "peaceai/lib", f)).href)}`);
  const file = join(mutantBase, `mutant-${mutantN++}.ts`);
  writeFileSync(file, next);
  return import(pathToFileURL(file).href);
}

test("deleting the signature guards admits the near miss, with the sandbox and without it", async (t) => {
  if (!practiceSandboxReady()) { t.skip("bwrap is not installed"); return; }
  const node = visibleNodeBin();
  assert.ok(node);
  const root = mkdtempSync(join(tmpdir(), "sig-mut-"));
  const call = atCall();
  const anySrc = `export function ids(xs: any[]): number { return xs.length; }\n`;
  const anyCall = `import { ids } from "../src/ids.ts";\nexport const out = ids(flag);\n`;
  place(root, { "src/array/at.ts": atSrc, "src/ids.ts": anySrc, "test/call.ts": call, "test/any.ts": anyCall });
  const output = diag("test/any.ts", anyCall, "flag", "Argument of type 'readonly any[]' is not assignable to parameter of type 'any[]'.");
  assert.equal(proposedSignature(root, output, "^src/.+\\.ts$"), null);
  const opened = await mutant("sig-guard:any") as { proposedSignature: typeof proposedSignature };
  const lied = opened.proposedSignature(root, output, "^src/.+\\.ts$");
  assert.match(lied?.content ?? "", /readonly any\[\]/);
  const helper = `import { at } from "../src/array/at.ts";\nconst indices = [0] as const;\nexport const out = at([1], indices);\n`;
  place(root, { "test/helpers.ts": helper });
  const helperOut = diag("test/helpers.ts", helper, "indices", "Argument of type 'readonly [0]' is not assignable to parameter of type 'number[]'.");
  assert.equal(proposedSignature(root, helperOut, "^src/.+\\.ts$"), null);
  const help = await mutant("sig-guard:helper") as { proposedSignature: typeof proposedSignature };
  assert.match(help.proposedSignature(root, helperOut, "^src/.+\\.ts$")?.content ?? "", /readonly number\[\]/);
  const vendor = `export function at<T>(arr: readonly T[], indices: number[]): T[] { return []; }\n`;
  const vendCall = `import { at } from "../vendor/box.ts";\nconst indices = [0] as const;\nexport const out = at([1], indices);\n`;
  place(root, { "vendor/box.ts": vendor, "test/vend.ts": vendCall });
  const vendOut = diag("test/vend.ts", vendCall, "indices)", "Argument of type 'readonly [0]' is not assignable to parameter of type 'number[]'.");
  assert.equal(proposedSignature(root, vendOut, "^src/.+\\.ts$"), null);
  const vend = await mutant("sig-guard:target") as { proposedSignature: typeof proposedSignature };
  assert.match(vend.proposedSignature(root, vendOut, "^src/.+\\.ts$")?.content ?? "", /readonly number\[\]/);
  const twoSrc = `export function at<T>(arr: readonly T[], indices: number[]): T[] { return []; }\nexport function at<T>(arr: readonly T[], indices: number[]): T[] { return []; }\n`;
  const twoCall = `import { at } from "../src/two.ts";\nconst indices = [0] as const;\nexport const out = at([1], indices);\n`;
  place(root, { "src/two.ts": twoSrc, "test/two.ts": twoCall });
  const twoOut = diag("test/two.ts", twoCall, "indices)", "Argument of type 'readonly [0]' is not assignable to parameter of type 'number[]'.");
  assert.equal(proposedSignature(root, twoOut, "^src/.+\\.ts$"), null);
  const many = await mutant("sig-guard:one") as { proposedSignature: typeof proposedSignature };
  assert.ok(many.proposedSignature(root, twoOut, "^src/.+\\.ts$"));
  const missing = typecheckRejected({ root, output: "", sourcePattern: "^src/.+\\.ts$", nodePath: node!, nodeModules: modules, testCommand: [node!, "-e", ""], bwrap: "/no/such/bwrap" });
  assert.equal(missing, true);
  const sand = await mutant("sig-guard:bwrap") as { typecheckRejected: typeof typecheckRejected };
  const live = sand.typecheckRejected({ root, output: "", sourcePattern: "^src/.+\\.ts$", nodePath: node!, nodeModules: modules, testCommand: [node!, "-e", ""], bwrap: "/no/such/bwrap" });
  assert.equal(live, false);
  const kept = typecheckRejected({ root, output: "", sourcePattern: "^src/.+\\.ts$", nodePath: node!, nodeModules: modules, testCommand: [node!, "-e", ""] });
  assert.equal(typeof kept, "boolean");
  rmSync(root, { recursive: true, force: true });
});
