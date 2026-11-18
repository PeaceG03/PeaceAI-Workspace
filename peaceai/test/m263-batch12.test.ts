// Batch 12. The library files are the published parent and the published test.
// Third-party bytes run only inside the practice sandbox.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { constructorName, literalDollar, plainMerge, repairBatch12 } from "../lib/batch12.ts";
import { gradeBehavior } from "../lib/specgrade.ts";
import { practiceSandboxReady, runInPracticeSandbox, visibleNodeBin } from "../lib/practicemine.ts";

const repoRoot = resolve(import.meta.dirname, "../..");
const fix = resolve(import.meta.dirname, "fixtures/m263");
const readFix = (name: string) => readFileSync(join(fix, name), "utf8");
const readHarness = (name: string) => readFileSync(join(import.meta.dirname, name), "utf8");
const modules = resolve(repoRoot, "node_modules");

function place(root: string, files: Record<string, string>) {
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(root, path, ".."), { recursive: true });
    writeFileSync(join(root, path), content);
  }
}

function gitInit(root: string) {
  const git = (args: string[]) => spawnSync("git", ["-C", root, ...args], { stdio: "ignore" });
  git(["init", "-q"]);
  git(["add", "-A"]);
  git(["-c", "user.email=t@example.com", "-c", "user.name=t", "commit", "-qm", "base"]);
}

const RESOLVE_RUN = `await import("./test/utils.ts");
await import("./test/index.ts");
if (process.exitCode) process.exit(process.exitCode);
`;

function runtimeModules(kind: "uvu" | "vitest"): string {
  const dir = mkdtempSync(join(tmpdir(), "m263-mods-"));
  const nm = join(dir, "node_modules");
  mkdirSync(nm);
  for (const name of ["tsx", "esbuild", "@esbuild"]) {
    const copied = spawnSync("cp", ["-a", join(modules, name), join(nm, name)], { stdio: "ignore" });
    assert.equal(copied.status, 0, name);
  }
  if (kind === "uvu") {
    mkdirSync(join(nm, "uvu/assert"), { recursive: true });
    writeFileSync(join(nm, "uvu/package.json"), `{"type":"module","exports":{".":"./index.js","./assert":"./assert/index.js"}}\n`);
    writeFileSync(join(nm, "uvu/index.js"), readHarness("m263-uvu.js"));
    writeFileSync(join(nm, "uvu/assert/index.js"), readHarness("m263-uvu-assert.js"));
  } else {
    mkdirSync(join(nm, "vitest"));
    writeFileSync(join(nm, "vitest/package.json"), `{"type":"module","exports":{".":"./index.js"}}\n`);
    writeFileSync(join(nm, "vitest/index.js"), readHarness("m263-vitest-shim.js"));
  }
  return nm;
}

test("a dollar in a subpath is literal, and a check that is not injects is refused", () => {
  const next = literalDollar(readFix("re-utils.ts.txt"));
  assert.match(next ?? "", /\(\) => value/);
  assert.equal(literalDollar(next!), null);
  assert.equal(literalDollar(readFix("re-utils.ts.txt").replace("export function injects(", "export function kept(")), null);
});

test("constructor.name is used only as a non-empty string, and a check that is not determineSpecificType is refused", () => {
  const next = constructorName(readFix("ex-errors.ts.txt"));
  assert.match(next ?? "", /typeof name === "string"/);
  assert.equal(constructorName(next!), null);
  assert.equal(constructorName(readFix("ex-errors.ts.txt").replace("function determineSpecificType(", "function kept(")), null);
});

test("a plain value is replaced by an incoming object, and a check that is not deepMerge is refused", () => {
  const next = plainMerge(readFix("au-object.ts.txt"));
  assert.match(next ?? "", /isMergableObject\(target\[key\]\)/);
  assert.equal(plainMerge(next!), null);
  assert.equal(plainMerge(readFix("au-object.ts.txt").replace("export function deepMerge<", "export function kept<")), null);
});

const mutantBase = resolve(repoRoot, "peaceai/test/.capability-mutants");
mkdirSync(mutantBase, { recursive: true });
let mutantN = 0;
async function mutant(guard: string) {
  const text = readFileSync(resolve(repoRoot, "peaceai/lib/batch12.ts"), "utf8");
  const lines = text.split("\n");
  const hits = lines.flatMap((line, i) => (line.includes(`// ${guard}`) ? [i] : []));
  assert.equal(hits.length, 1, guard);
  const next = lines.filter((_, i) => i !== hits[0]).join("\n").replace(/from "\.\/([A-Za-z0-9-]+\.ts)"/g, (_m, name: string) => `from ${JSON.stringify(pathToFileURL(resolve(repoRoot, "peaceai/lib", name)).href)}`);
  const out = join(mutantBase, `m263-${mutantN++}.ts`);
  writeFileSync(out, next);
  return import(pathToFileURL(out).href);
}

test("deleting the batch 12 guards admits the near miss, with bwrap and without it", async () => {
  const otherDollar = readFix("re-utils.ts.txt").replace("export function injects(", "export function kept(");
  assert.equal(literalDollar(otherDollar), null);
  const dollar = await mutant("dollar-guard:literal") as { literalDollar: typeof literalDollar; repairBatch12: typeof repairBatch12 };
  assert.match(dollar.literalDollar(otherDollar) ?? "", /\(\) => value/);
  const otherName = readFix("ex-errors.ts.txt").replace("function determineSpecificType(", "function kept(");
  assert.equal(constructorName(otherName), null);
  const named = await mutant("name-guard:string") as { constructorName: typeof constructorName; repairBatch12: typeof repairBatch12 };
  assert.match(named.constructorName(otherName) ?? "", /typeof name === "string"/);
  const otherMerge = readFix("au-object.ts.txt").replace("export function deepMerge<", "export function kept<");
  assert.equal(plainMerge(otherMerge), null);
  const merged = await mutant("merge-guard:plain") as { plainMerge: typeof plainMerge; repairBatch12: typeof repairBatch12 };
  assert.match(merged.plainMerge(otherMerge) ?? "", /isMergableObject/);
  const node = visibleNodeBin();
  assert.ok(node);
  const root = mkdtempSync(join(tmpdir(), "m263-miss-"));
  place(root, { "src/utils.ts": readFix("re-utils.ts.txt"), "run.mjs": "process.exit(0)\n" });
  gitInit(root);
  assert.equal(repairBatch12({
    root, output: "Error: not equal", sourcePattern: "^src/utils\\.ts$", nodePath: node!, testCommand: [node!, "run.mjs"], bwrap: "/no/such/bwrap",
  }), null);
  if (practiceSandboxReady()) {
    const run = (fn: typeof repairBatch12, dir: string, pattern: string) => fn({
      root: dir, output: "Error: not equal", sourcePattern: pattern, nodePath: node!, testCommand: [node!, "run.mjs"],
    });
    const dollarDir = mkdtempSync(join(tmpdir(), "m263-dollar-"));
    place(dollarDir, { "src/utils.ts": otherDollar, "run.mjs": "process.exit(0)\n" });
    gitInit(dollarDir);
    assert.equal(run(repairBatch12, dollarDir, "^src/utils\\.ts$"), null);
    assert.match(run(dollar.repairBatch12, dollarDir, "^src/utils\\.ts$")?.diff ?? "", /\(\) => value/);
    const nameDir = mkdtempSync(join(tmpdir(), "m263-name-"));
    place(nameDir, { "src/internal/errors.ts": otherName, "run.mjs": "process.exit(0)\n" });
    gitInit(nameDir);
    assert.equal(run(repairBatch12, nameDir, "^src/internal/errors\\.ts$"), null);
    assert.match(run(named.repairBatch12, nameDir, "^src/internal/errors\\.ts$")?.diff ?? "", /typeof name/);
    const mergeDir = mkdtempSync(join(tmpdir(), "m263-merge-"));
    place(mergeDir, { "src/object.ts": otherMerge, "run.mjs": "process.exit(0)\n" });
    gitInit(mergeDir);
    assert.equal(run(repairBatch12, mergeDir, "^src/object\\.ts$"), null);
    assert.match(run(merged.repairBatch12, mergeDir, "^src/object\\.ts$")?.diff ?? "", /isMergableObject/);
    rmSync(dollarDir, { recursive: true, force: true });
    rmSync(nameDir, { recursive: true, force: true });
    rmSync(mergeDir, { recursive: true, force: true });
  }
  rmSync(root, { recursive: true, force: true });
});

test("an any-cast that only matches one recorded answer is test-only for each batch 12 family", (t) => {
  if (!practiceSandboxReady()) { t.skip("bwrap is not installed"); return; }
  const node = visibleNodeBin();
  assert.ok(node);
  for (const symbol of ["injects", "determineSpecificType", "deepMerge"]) {
    const strict = `export function ${symbol}(kind: string): string {\n  return kind === "b" ? "B" : "A";\n}\n`;
    const over = `export function ${symbol}(kind: any): string {\n  return "A";\n}\n`;
    const make = (body: string) => {
      const dir = mkdtempSync(join(tmpdir(), "m263-grade-"));
      mkdirSync(join(dir, "src"), { recursive: true });
      writeFileSync(join(dir, "src/fn.ts"), body);
      return dir;
    };
    const left = make(over);
    const right = make(strict);
    try {
      const graded = gradeBehavior({
        candidateRoot: left, fixRoot: right, nodePath: node!,
        target: { symbol, file: "src/fn.ts", form: "named", exportName: symbol, args: [["a"]] },
      });
      assert.equal(graded.behavior, "verified_test_only", symbol);
    } finally {
      rmSync(left, { recursive: true, force: true });
      rmSync(right, { recursive: true, force: true });
    }
  }
});

test("the published resolve.exports, exsolve, and utils checks fail before the repair and pass after, inside the sandbox", (t) => {
  if (!practiceSandboxReady()) { t.skip("bwrap is not installed"); return; }
  const node = visibleNodeBin();
  assert.ok(node);
  const tsx = [node!, "node_modules/tsx/dist/cli.mjs"];
  const uvuModules = runtimeModules("uvu");
  const vitestModules = runtimeModules("vitest");

  const resolveDir = mkdtempSync(join(tmpdir(), "m263-resolve-"));
  place(resolveDir, {
    "src/utils.ts": readFix("re-utils.ts.txt"),
    "src/index.ts": readFix("re-index.ts.txt"),
    "src/legacy.ts": readFix("re-legacy.ts.txt"),
    "test/utils.ts": readFix("re-test-utils.ts.txt"),
    "test/index.ts": readFix("re-test-index.ts.txt"),
    "test/legacy.ts": readFix("re-test-legacy.ts.txt"),
    "package.json": `{"type":"module"}\n`,
    "run.mjs": RESOLVE_RUN,
  });
  gitInit(resolveDir);
  const rcmd = [...tsx, "run.mjs"];
  const plain = runInPracticeSandbox(resolveDir, rcmd, 120_000, { capture: true, nodePath: node, nodeModules: uvuModules });
  assert.equal(plain.unsafe, false, plain.stdout.slice(-400));
  assert.notEqual(plain.code, 0, plain.stdout.slice(-700));
  const dollars = repairBatch12({ root: resolveDir, output: plain.stdout, sourcePattern: "^src/utils\\.ts$", nodePath: node!, nodeModules: uvuModules, testCommand: rcmd });
  assert.ok(dollars, plain.stdout.slice(-900));
  assert.match(dollars!.diff, /\(\) => value/);

  const ex = mkdtempSync(join(tmpdir(), "m263-ex-"));
  place(ex, {
    "src/internal/errors.ts": readFix("ex-errors.ts.txt"),
    "test/internal-errors.test.ts": readFix("ex-errors.test.ts.txt"),
    "package.json": `{"type":"module"}\n`,
  });
  gitInit(ex);
  const ecmd = [...tsx, "test/internal-errors.test.ts"];
  const named = runInPracticeSandbox(ex, ecmd, 120_000, { capture: true, nodePath: node, nodeModules: vitestModules });
  assert.equal(named.unsafe, false, named.stdout.slice(-400));
  assert.notEqual(named.code, 0, named.stdout.slice(-700));
  const names = repairBatch12({ root: ex, output: named.stdout, sourcePattern: "^src/internal/errors\\.ts$", nodePath: node!, nodeModules: vitestModules, testCommand: ecmd });
  assert.ok(names, named.stdout.slice(-900));
  assert.match(names!.diff, /typeof name === "string"/);

  const utils = mkdtempSync(join(tmpdir(), "m263-utils-"));
  place(utils, {
    "src/object.ts": readFix("au-object.ts.txt"),
    "src/guards.ts": readFix("au-guards.ts.txt"),
    "src/is.ts": readFix("au-is.ts.txt"),
    "src/base.ts": readFix("au-base.ts.txt"),
    "src/types.ts": readFix("au-types.ts.txt"),
    "src/object.test.ts": readFix("au-object.test.ts.txt"),
    "package.json": `{"type":"module"}\n`,
  });
  gitInit(utils);
  const ucmd = [...tsx, "src/object.test.ts"];
  const merged = runInPracticeSandbox(utils, ucmd, 120_000, { capture: true, nodePath: node, nodeModules: vitestModules });
  assert.equal(merged.unsafe, false, merged.stdout.slice(-400));
  assert.notEqual(merged.code, 0, merged.stdout.slice(-700));
  const plains = repairBatch12({ root: utils, output: merged.stdout, sourcePattern: "^src/object\\.ts$", nodePath: node!, nodeModules: vitestModules, testCommand: ucmd });
  assert.ok(plains, merged.stdout.slice(-900));
  assert.match(plains!.diff, /isMergableObject\(target\[key\]\)/);
  rmSync(resolveDir, { recursive: true, force: true });
  rmSync(ex, { recursive: true, force: true });
  rmSync(utils, { recursive: true, force: true });
  rmSync(resolve(uvuModules, ".."), { recursive: true, force: true });
  rmSync(resolve(vitestModules, ".."), { recursive: true, force: true });
});
