// Batch 12. The library files are the published parent and the published test.
// Third-party bytes run only inside the practice sandbox.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
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

test("undoing the new token fails the published check, in-process and inside bwrap", (t) => {
  const dollars = literalDollar(readFix("re-utils.ts.txt"));
  const named = constructorName(readFix("ex-errors.ts.txt"));
  const merged = plainMerge(readFix("au-object.ts.txt"));
  assert.ok(dollars && named && merged);
  const dollarFile = dollars.replace("() => value", "value");
  const nameFile = named.replace(
    "const name: unknown = value.constructor?.name;\n      if (typeof name === \"string\" && name !== \"\") {\n        return `an instance of ${name}`;\n      }",
    "if (value.constructor && value.constructor.name) {\n        return `an instance of ${value.constructor.name}`;\n      }",
  );
  const mergeFile = merged.replace("          target[key] = source[key]\n", "");
  assert.equal(dollarFile, readFix("re-utils.ts.txt"));
  assert.equal(nameFile, readFix("ex-errors.ts.txt"));
  assert.notEqual(dollarFile, dollars);
  assert.notEqual(nameFile, named);
  assert.notEqual(mergeFile, merged);
  const node = visibleNodeBin();
  assert.ok(node);
  if (!practiceSandboxReady()) { t.skip("bwrap is not installed"); return; }
  const tsx = [node!, "node_modules/tsx/dist/cli.mjs"];
  const uvuModules = runtimeModules("uvu");
  const vitestModules = runtimeModules("vitest");
  const cases: { files: Record<string, string>; dest: string; cmd: string[]; pattern: string; modules: string; why: RegExp; restores: RegExp | null }[] = [
    {
      files: {
        "src/utils.ts": dollarFile, "src/index.ts": readFix("re-index.ts.txt"), "src/legacy.ts": readFix("re-legacy.ts.txt"),
        "test/utils.ts": readFix("re-test-utils.ts.txt"), "test/index.ts": readFix("re-test-index.ts.txt"), "test/legacy.ts": readFix("re-test-legacy.ts.txt"),
        "package.json": `{"type":"module"}\n`, "run.mjs": RESOLVE_RUN,
      },
      dest: "src/utils.ts", cmd: [...tsx, "run.mjs"], pattern: "^src/utils\\.ts$", modules: uvuModules, why: /test\$\$\.js|\$&/, restores: /\(\) => value/,
    },
    {
      files: { "src/internal/errors.ts": nameFile, "test/internal-errors.test.ts": readFix("ex-errors.test.ts.txt"), "package.json": `{"type":"module"}\n` },
      dest: "src/internal/errors.ts", cmd: [...tsx, "test/internal-errors.test.ts"], pattern: "^src/internal/errors\\.ts$", modules: vitestModules, why: /constructor|instance of|Received/, restores: /typeof name === "string"/,
    },
    {
      files: {
        "src/object.ts": mergeFile, "src/guards.ts": readFix("au-guards.ts.txt"), "src/is.ts": readFix("au-is.ts.txt"),
        "src/base.ts": readFix("au-base.ts.txt"), "src/types.ts": readFix("au-types.ts.txt"), "src/object.test.ts": readFix("au-object.test.ts.txt"),
        "package.json": `{"type":"module"}\n`,
      },
      dest: "src/object.ts", cmd: [...tsx, "src/object.test.ts"], pattern: "^src/object\\.ts$", modules: vitestModules, why: /toEqual|Expected/, restores: null,
    },
  ];
  for (const row of cases) {
    const dir = mkdtempSync(join(tmpdir(), "m263-kill-"));
    place(dir, { ...row.files, ".gitignore": "node_modules\n" });
    symlinkSync(row.modules, join(dir, "node_modules"));
    const direct = spawnSync(row.cmd[0]!, row.cmd.slice(1), { cwd: dir, encoding: "utf8" });
    const directOut = `${direct.stdout}\n${direct.stderr}`;
    assert.notEqual(direct.status, 0, directOut.slice(-800));
    assert.match(directOut, row.why, row.dest);
    assert.doesNotMatch(directOut, /ReferenceError|TransformError|SyntaxError/, row.dest);
    const sand = runInPracticeSandbox(dir, row.cmd, 120_000, { capture: true, nodePath: node, nodeModules: row.modules });
    assert.equal(sand.unsafe, false, row.dest);
    assert.notEqual(sand.code, 0, sand.stdout.slice(-800));
    assert.match(sand.stdout, row.why, row.dest);
    gitInit(dir);
    const repaired = repairBatch12({
      root: dir, output: sand.stdout, sourcePattern: row.pattern, nodePath: node!, nodeModules: row.modules, testCommand: row.cmd,
    });
    if (row.restores) {
      assert.ok(repaired, row.dest);
      assert.match(repaired!.diff, row.restores, row.dest);
    } else {
      assert.equal(repaired, null, row.dest);
    }
    rmSync(dir, { recursive: true, force: true });
  }
  rmSync(resolve(uvuModules, ".."), { recursive: true, force: true });
  rmSync(resolve(vitestModules, ".."), { recursive: true, force: true });
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
