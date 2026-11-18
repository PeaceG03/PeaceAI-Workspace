// Batch 16. The library files are the published parent and the published test.
// Third-party bytes run only inside the practice sandbox.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { emptyInvalidDate, falseLockfile, negativePriority, repairBatch16 } from "../lib/batch16.ts";
import { gradeBehavior } from "../lib/specgrade.ts";
import { practiceSandboxReady, runInPracticeSandbox, visibleNodeBin } from "../lib/practicemine.ts";

const repoRoot = resolve(import.meta.dirname, "../..");
const fix = resolve(import.meta.dirname, "fixtures/m267");
const readFix = (name: string) => readFileSync(join(fix, name), "utf8");
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

function runtimeModules(kind: "plain" | "nypm"): string {
  const dir = mkdtempSync(join(tmpdir(), "m267-mods-"));
  const nm = join(dir, "node_modules");
  mkdirSync(nm);
  for (const name of ["tsx", "esbuild", "@esbuild"]) {
    const copied = spawnSync("cp", ["-a", join(modules, name), join(nm, name)], { stdio: "ignore" });
    assert.equal(copied.status, 0, name);
  }
  const stub = (name: string, body: string) => {
    mkdirSync(join(nm, name), { recursive: true });
    writeFileSync(join(nm, name, "package.json"), `{"type":"module","exports":{".":"./index.js"}}\n`);
    writeFileSync(join(nm, name, "index.js"), body);
  };
  stub("mlly", "export function findStaticImports(){return []}\nexport function parseStaticImport(){return {}}\nexport function resolvePathSync(){return ''}\n");
  stub("magic-string", "export default class MagicString { constructor(s){this.s=s} }\n");
  stub("pathe", "export { isAbsolute, relative, join, resolve, normalize, dirname, basename } from 'node:path';\n");
  mkdirSync(join(nm, "vitest"));
  writeFileSync(join(nm, "vitest/package.json"), `{"type":"module","exports":{".":"./index.js"}}\n`);
  writeFileSync(join(nm, "vitest/index.js"), readFileSync(join(import.meta.dirname, "m267-vitest-shim.js")));
  if (kind === "nypm") {
    mkdirSync(join(nm, "citty/dist/_chunks/libs"), { recursive: true });
    writeFileSync(join(nm, "citty/package.json"), `{"type":"module","exports":{".":"./dist/index.mjs"}}\n`);
    writeFileSync(join(nm, "citty/dist/index.mjs"), readFix("citty-dist-index.mjs.txt"));
    writeFileSync(join(nm, "citty/dist/_chunks/libs/scule.mjs"), readFix("citty-dist-scule.mjs.txt"));
    stub("tinyexec", "export async function x(){ throw new Error('executed'); }\n");
  }
  return nm;
}

const REGEXP_STUB = "export function stripCommentsAndStrings(code){ return code; }\n";

test("a negative priority stays below the default, and a check that is not dedupeImports is refused", () => {
  const source = readFix("ui-src-utils.ts.txt");
  const next = negativePriority(source);
  assert.match(next ?? "", /prevPriority/);
  assert.equal(negativePriority(next!), null);
  assert.equal(negativePriority(source.replace("export function dedupeImports(", "export function kept(")), null);
});

test("an invalid compatibility date is empty, and a check that is not formatDate is refused", () => {
  const source = readFix("cx-src-date.ts.txt");
  const next = emptyInvalidDate(source);
  assert.match(next ?? "", /Number\.isNaN\(d\.getDate\(\)\)/);
  assert.equal(emptyInvalidDate(next!), null);
  assert.equal(emptyInvalidDate(source.replace("export function formatDate(", "export function kept(")), null);
});

test("a string false does not recreate the lockfile, and a check that is not the dedupe command is refused", () => {
  const source = readFix("np-src-cli.ts.txt");
  const next = falseLockfile(source);
  assert.match(next ?? "", /=== "false"/);
  assert.equal(falseLockfile(next!), null);
  assert.equal(falseLockfile(source.replace("const dedupe = defineCommand(", "const kept = defineCommand(")), null);
});

test("the parent file fails the published check because the repair is absent, in-process and inside bwrap", (t) => {
  if (!practiceSandboxReady()) { t.skip("bwrap is not installed"); return; }
  const node = visibleNodeBin();
  assert.ok(node);
  const plain = runtimeModules("plain");
  const nypm = runtimeModules("nypm");
  const tsx = [node!, "node_modules/tsx/dist/cli.mjs"];
  const rows: { dest: string; files: Record<string, string>; pattern: string; cmd: string[]; modules: string; why: RegExp; restores: RegExp }[] = [
    {
      dest: "src/utils.ts",
      files: {
        "src/utils.ts": readFix("ui-src-utils.ts.txt"),
        "src/regexp.ts": REGEXP_STUB,
        "test/dedupe.test.ts": readFix("ui-test-dedupe.test.ts.txt"),
        "package.json": `{"type":"module"}\n`,
      },
      pattern: "^src/utils\\.ts$",
      cmd: [...tsx, "test/dedupe.test.ts"],
      modules: plain,
      why: /"priority":-1/,
      restores: /prevPriority/,
    },
    {
      dest: "src/date.ts",
      files: {
        "src/date.ts": readFix("cx-src-date.ts.txt"),
        "src/platforms.ts": readFix("cx-src-platforms.ts.txt"),
        "test/date.test.ts": readFix("cx-test-date.test.ts.txt"),
        "package.json": `{"type":"module"}\n`,
      },
      pattern: "^src/date\\.ts$",
      cmd: [...tsx, "test/date.test.ts"],
      modules: plain,
      why: /NaN-NaN-NaN/,
      restores: /isNaN/,
    },
    {
      dest: "src/cli.ts",
      files: {
        "src/cli.ts": readFix("np-src-cli.ts.txt"),
        "src/api.ts": readFix("np-src-api.ts.txt"),
        "src/_utils.ts": readFix("np-src-_utils.ts.txt"),
        "src/package-manager.ts": readFix("np-src-package-manager.ts.txt"),
        "test/cli.test.ts": readFix("np-test-cli.test.ts.txt"),
        "package.json": `{"name":"nypm","version":"0.0.0","description":"nypm","type":"module"}\n`,
      },
      pattern: "^src/cli\\.ts$",
      cmd: [...tsx, "test/cli.test.ts"],
      modules: nypm,
      why: /pnpm install/,
      restores: /=== "false"/,
    },
  ];
  for (const row of rows) {
    const dir = mkdtempSync(join(tmpdir(), "m267-kill-"));
    place(dir, { ...row.files, ".gitignore": "node_modules\n" });
    symlinkSync(row.modules, join(dir, "node_modules"));
    gitInit(dir);
    const direct = spawnSync(row.cmd[0]!, row.cmd.slice(1), { cwd: dir, encoding: "utf8" });
    const directOut = `${direct.stdout}\n${direct.stderr}`;
    assert.notEqual(direct.status, 0, directOut.slice(-700));
    assert.match(directOut, row.why, directOut.slice(-700));
    assert.doesNotMatch(directOut, /ReferenceError|SyntaxError|TransformError/, row.dest);
    const sand = runInPracticeSandbox(dir, row.cmd, 120_000, { capture: true, nodePath: node, nodeModules: row.modules });
    assert.equal(sand.unsafe, false, row.dest);
    assert.notEqual(sand.code, 0, sand.stdout.slice(-700));
    assert.match(sand.stdout, row.why, sand.stdout.slice(-700));
    const repaired = repairBatch16({
      root: dir, output: directOut, sourcePattern: row.pattern, nodePath: node!, nodeModules: row.modules, testCommand: row.cmd,
    });
    assert.ok(repaired, row.dest);
    assert.match(repaired!.diff, row.restores, row.dest);
    rmSync(dir, { recursive: true, force: true });
  }
  rmSync(resolve(plain, ".."), { recursive: true, force: true });
  rmSync(resolve(nypm, ".."), { recursive: true, force: true });
});

test("an any-cast that only matches one recorded answer is test-only for each batch 16 family", (t) => {
  if (!practiceSandboxReady()) { t.skip("bwrap is not installed"); return; }
  const node = visibleNodeBin();
  assert.ok(node);
  for (const symbol of ["dedupeImports", "formatDate", "dedupeDependencies"]) {
    const strict = `export function ${symbol}(kind: string): string {\n  return kind === "b" ? "B" : "A";\n}\n`;
    const over = `export function ${symbol}(kind: any): string {\n  return "A";\n}\n`;
    const make = (body: string) => {
      const dir = mkdtempSync(join(tmpdir(), "m267-grade-"));
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

test("the published unimport, compatx, and nypm checks fail before the repair and pass after, inside the sandbox", (t) => {
  if (!practiceSandboxReady()) { t.skip("bwrap is not installed"); return; }
  const node = visibleNodeBin();
  assert.ok(node);
  const plain = runtimeModules("plain");
  const nypm = runtimeModules("nypm");
  const tsx = [node!, "node_modules/tsx/dist/cli.mjs"];
  const rows: { files: Record<string, string>; pattern: string; cmd: string[]; modules: string; mark: RegExp }[] = [
    {
      files: {
        "src/utils.ts": readFix("ui-src-utils.ts.txt"),
        "src/regexp.ts": REGEXP_STUB,
        "test/dedupe.test.ts": readFix("ui-test-dedupe.test.ts.txt"),
        "package.json": `{"type":"module"}\n`,
      },
      pattern: "^src/utils\\.ts$",
      cmd: [...tsx, "test/dedupe.test.ts"],
      modules: plain,
      mark: /prevPriority/,
    },
    {
      files: {
        "src/date.ts": readFix("cx-src-date.ts.txt"),
        "src/platforms.ts": readFix("cx-src-platforms.ts.txt"),
        "test/date.test.ts": readFix("cx-test-date.test.ts.txt"),
        "package.json": `{"type":"module"}\n`,
      },
      pattern: "^src/date\\.ts$",
      cmd: [...tsx, "test/date.test.ts"],
      modules: plain,
      mark: /isNaN/,
    },
    {
      files: {
        "src/cli.ts": readFix("np-src-cli.ts.txt"),
        "src/api.ts": readFix("np-src-api.ts.txt"),
        "src/_utils.ts": readFix("np-src-_utils.ts.txt"),
        "src/package-manager.ts": readFix("np-src-package-manager.ts.txt"),
        "test/cli.test.ts": readFix("np-test-cli.test.ts.txt"),
        "package.json": `{"name":"nypm","version":"0.0.0","description":"nypm","type":"module"}\n`,
      },
      pattern: "^src/cli\\.ts$",
      cmd: [...tsx, "test/cli.test.ts"],
      modules: nypm,
      mark: /=== "false"/,
    },
  ];
  for (const row of rows) {
    const dir = mkdtempSync(join(tmpdir(), "m267-run-"));
    place(dir, { ...row.files, ".gitignore": "node_modules\n" });
    symlinkSync(row.modules, join(dir, "node_modules"));
    gitInit(dir);
    const before = runInPracticeSandbox(dir, row.cmd, 120_000, { capture: true, nodePath: node, nodeModules: row.modules });
    assert.equal(before.unsafe, false, before.stdout.slice(-400));
    assert.notEqual(before.code, 0, before.stdout.slice(-400));
    const repaired = repairBatch16({
      root: dir, output: before.stdout, sourcePattern: row.pattern, nodePath: node!, nodeModules: row.modules, testCommand: row.cmd,
    });
    assert.ok(repaired, before.stdout.slice(-800));
    assert.match(repaired!.diff, row.mark);
    rmSync(dir, { recursive: true, force: true });
  }
  rmSync(resolve(plain, ".."), { recursive: true, force: true });
  rmSync(resolve(nypm, ".."), { recursive: true, force: true });
});
