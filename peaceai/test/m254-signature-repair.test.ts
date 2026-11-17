// Signature repair. The sentences and the small modules are made up.
// The pinned at() file is the published parent, copied unmodified.
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
const parent = readFileSync(resolve(import.meta.dirname, "fixtures/m254/at-parent.ts.txt"), "utf8");
const fixed = readFileSync(resolve(import.meta.dirname, "fixtures/m254/at-fix.ts.txt"), "utf8");
const PARENT = "8aab1978414d50f46e3e1acad326ed9d95c65b5b";
const modules = resolve(repoRoot, "node_modules");

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
  assert.equal(widenParam('"a"', '"b"'), '"a" | "b"');
  const root = mkdtempSync(join(tmpdir(), "sig-plan-"));
  const call = atCall();
  place(root, {
    "src/array/at.ts": parent,
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

test("an extra literal argument adds an optional parameter and an overload", () => {
  const root = mkdtempSync(join(tmpdir(), "sig-extra-"));
  const src = `export function label(kind: string): number {\n  return kind.length;\n}\n`;
  const call = `import { label } from "../src/label.ts";\nexport const n = label("ab", 1);\n`;
  place(root, { "src/label.ts": src, "test/call.ts": call });
  const at = call.indexOf("1");
  const pre = call.slice(0, at);
  const output = `test/call.ts(${pre.split("\n").length},${at - pre.lastIndexOf("\n")}): error TS2554: Expected 1 arguments, but got 2.`;
  const plan = proposedSignature(root, output, "^src/.+\\.ts$");
  assert.ok(plan);
  assert.match(plan!.content, /export function label\(kind: string\): number;/);
  assert.match(plan!.content, /extra1\?: number/);
  rmSync(root, { recursive: true, force: true });
});

function gitInit(root: string) {
  const git = (args: string[]) => spawnSync("git", ["-C", root, ...args], { stdio: "ignore" });
  git(["init", "-q"]);
  git(["add", "-A"]);
  git(["-c", "user.email=t@example.com", "-c", "user.name=t", "commit", "-qm", "base"]);
}

test("the published at() parent fails the readonly call and the widening passes, inside the sandbox", (t) => {
  if (!practiceSandboxReady()) { t.skip("bwrap is not installed"); return; }
  const node = visibleNodeBin();
  assert.ok(node);
  assert.equal(createHash("sha256").update(parent).digest("hex"), createHash("sha256").update(readFileSync(resolve(import.meta.dirname, "fixtures/m254/at-parent.ts.txt"))).digest("hex"));
  assert.equal(PARENT.length, 40);
  const root = mkdtempSync(join(tmpdir(), "sig-at-"));
  const call = `import assert from "node:assert/strict";\nimport { at } from "../src/array/at.ts";\nconst indices = [0, 2] as const;\nassert.deepEqual(at(["a", "b", "c"], indices), ["a", "c"]);\n`;
  place(root, {
    "src/array/at.ts": parent,
    "src/keep.ts": `import { at } from "./array/at.ts";\nexport const kept = at(["a", "b"], [1]);\n`,
    "test/call.ts": call,
    "tsconfig.json": `${JSON.stringify({ compilerOptions: { strict: true, target: "es2022", module: "nodenext", moduleResolution: "nodenext", noEmit: true, allowImportingTsExtensions: true }, include: ["src", "test"] })}\n`,
    "package.json": `{ "type": "module" }\n`,
    "run.mjs": `import { spawnSync } from "node:child_process";\nconst tsc = spawnSync(process.execPath, ["node_modules/typescript/lib/tsc.js", "--noEmit", "--pretty", "false", "--strict", "-p", "tsconfig.json"], { encoding: "utf8" });\nprocess.stdout.write(tsc.stdout); process.stderr.write(tsc.stderr);\nif (tsc.status) process.exit(tsc.status);\nconst run = spawnSync(process.execPath, ["--experimental-strip-types", "test/call.ts"], { encoding: "utf8" });\nprocess.stdout.write(run.stdout); process.stderr.write(run.stderr);\nprocess.exit(run.status ?? 1);\n`,
  });
  gitInit(root);
  const cmd = [node!, "run.mjs"];
  const before = runInPracticeSandbox(root, cmd, 60_000, { capture: true, nodePath: node, nodeModules: modules });
  assert.equal(before.unsafe, false);
  assert.notEqual(before.code, 0);
  assert.match(before.stdout, /error TS2345/);
  const repaired = repairTypedFailure({ root, output: before.stdout, sourcePattern: "^src/.+\\.ts$", nodePath: node!, nodeModules: modules, testCommand: cmd });
  assert.ok(repaired, before.stdout);
  assert.match(repaired!.diff, /readonly number\[\]/);
  assert.match(fixed, /indices: readonly number\[\]/);
  writeFileSync(join(root, "src/array/at.ts"), parent.replace("indices: number[]", "indices: readonly number[]"));
  const after = runInPracticeSandbox(root, cmd, 60_000, { capture: true, nodePath: node, nodeModules: modules });
  assert.equal(after.code, 0, after.stdout);
  const wrong = mkdtempSync(join(tmpdir(), "sig-wrong-"));
  const wrongSrc = `export function label(kind: "a"): string {\n  return "yes";\n}\n`;
  const wrongCall = `import assert from "node:assert/strict";\nimport { label } from "../src/label.ts";\nassert.equal(label("b" as "b"), "B");\n`;
  place(wrong, {
    "src/label.ts": wrongSrc,
    "test/call.ts": wrongCall,
    "tsconfig.json": `${JSON.stringify({ compilerOptions: { strict: true, target: "es2022", module: "nodenext", moduleResolution: "nodenext", noEmit: true, allowImportingTsExtensions: true }, include: ["src", "test"] })}\n`,
    "package.json": `{ "type": "module" }\n`,
    "run.mjs": readFileSync(join(root, "run.mjs"), "utf8"),
  });
  gitInit(wrong);
  const failed = runInPracticeSandbox(wrong, cmd, 60_000, { capture: true, nodePath: node, nodeModules: modules });
  assert.match(failed.stdout, /error TS2345/);
  assert.equal(repairTypedFailure({ root: wrong, output: failed.stdout, sourcePattern: "^src/.+\\.ts$", nodePath: node!, nodeModules: modules, testCommand: cmd }), null);
  rmSync(root, { recursive: true, force: true });
  rmSync(wrong, { recursive: true, force: true });
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
  place(root, { "src/array/at.ts": parent, "test/call.ts": call });
  const output = diag("test/call.ts", call, "indices", "Argument of type 'any' is not assignable to parameter of type 'number[]'.");
  assert.equal(proposedSignature(root, output, "^src/.+\\.ts$"), null);
  const opened = await mutant("sig-guard:any") as { proposedSignature: typeof proposedSignature };
  const lied = opened.proposedSignature(root, output, "^src/.+\\.ts$");
  assert.match(lied?.content ?? "", /any/);
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
