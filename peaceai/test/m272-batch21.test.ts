// Batch 21. The library files are the published parent and the published test.
// Third-party bytes run only inside the practice sandbox.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { explicitKey, nameBounds, repairBatch21, suffixWithoutCommit } from "../lib/batch21.ts";
import { gradeBehavior } from "../lib/specgrade.ts";
import { practiceSandboxReady, runInPracticeSandbox, visibleNodeBin } from "../lib/practicemine.ts";

const fix = resolve(import.meta.dirname, "fixtures/m272");
const place = JSON.parse(readFileSync(join(import.meta.dirname, "m272-place.json"), "utf8")) as Record<string, string>;
const modules = resolve(import.meta.dirname, "../../node_modules");

function placeFiles(root: string, files: Record<string, string | Buffer>) {
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

function filesOf(prefix: string): Record<string, Buffer> {
  const out: Record<string, Buffer> = {};
  for (const [fixture, dest] of Object.entries(place)) {
    if (!fixture.startsWith(prefix)) continue;
    out[dest] = readFileSync(join(fix, fixture));
  }
  return out;
}

function text(name: string): string {
  return readFileSync(join(fix, name), "utf8");
}

function runtime(): string {
  const dir = mkdtempSync(join(tmpdir(), "m272-mods-"));
  const stage = mkdtempSync(join(tmpdir(), "m272-npm-"));
  const installed = spawnSync("npm", [
    "install", "--prefix", stage, "--no-package-lock", "--no-save",
    "wabt@1.0.39",
    "c12@4.0.0-rc.1", "confbox@0.3.1", "consola@3.4.2", "pathe@2.0.3", "std-env@4.2.0",
    "pkg-types@2.3.2", "semver@7.8.5", "scule@1.3.0", "convert-gitmoji@0.1.5",
  ], { encoding: "utf8" });
  assert.equal(installed.status, 0, (installed.stderr || installed.stdout).slice(-600));
  const nm = join(dir, "node_modules");
  cpSync(join(stage, "node_modules"), nm, { recursive: true });
  rmSync(stage, { recursive: true, force: true });
  for (const name of ["tsx", "esbuild", "@esbuild"]) {
    rmSync(join(nm, name), { recursive: true, force: true });
    assert.equal(spawnSync("cp", ["-a", join(modules, name), join(nm, name)], { stdio: "ignore" }).status, 0, name);
  }
  rmSync(join(nm, "vitest"), { recursive: true, force: true });
  mkdirSync(join(nm, "vitest"));
  writeFileSync(join(nm, "vitest/package.json"), `{"type":"module","exports":{".":"./index.js"}}\n`);
  writeFileSync(join(nm, "vitest/index.js"), readFileSync(join(import.meta.dirname, "m272-vitest-shim.js")));
  return nm;
}

test("an explicit YAML key is its own entry, and a check that is not yaml is refused", () => {
  const source = text("up-src-yaml.ts.txt");
  const next = explicitKey(source);
  assert.match(next ?? "", /startsWith\("\? "\)/);
  assert.equal(explicitKey(next!), null);
  assert.equal(explicitKey(source.replace("export function yaml", "export function kept")), null);
});

test("a name past the subsection end is discarded, and a check that is not readFunctionNames is refused", () => {
  const source = text("uw-src-tools-parser.ts.txt");
  const next = nameBounds(source);
  assert.match(next ?? "", /assertWithin/);
  assert.equal(nameBounds(next!), null);
  assert.equal(nameBounds(source.replace("function readFunctionNames", "function kept")), null);
});

test("a version suffix with no commits has no hash, and a check that is not bumpVersion is refused", () => {
  const source = text("cl-src-semver.ts.txt");
  const next = suffixWithoutCommit(source);
  assert.match(next ?? "", /commits\[0\]\?\.shortHash/);
  assert.equal(suffixWithoutCommit(next!), null);
  assert.equal(suffixWithoutCommit(source.replace("export async function bumpVersion", "export async function kept")), null);
});

function rows() {
  const node = visibleNodeBin()!;
  const tsx = [node, "node_modules/tsx/dist/cli.mjs"];
  const mods = runtime();
  const typed = (prefix: string) => ({ ...filesOf(prefix), "package.json": Buffer.from('{"type":"module"}\n') });
  return {
    mods,
    list: [
      {
        files: typed("up-"),
        pattern: "^src/yaml\\.ts$",
        cmd: [...tsx, "test/yaml.test.ts"],
        why: /pathe@2\.0\.3/,
        restores: /startsWith\("\? "\)/,
      },
      {
        files: typed("uw-"),
        pattern: "^src/tools/parser\\.ts$",
        cmd: [...tsx, "test/parse.test.ts"],
        why: /AAAAA/,
        restores: /assertWithin/,
      },
      {
        files: typed("cl-"),
        pattern: "^src/semver\\.ts$",
        cmd: [...tsx, "test/semver.test.ts"],
        why: /shortHash/,
        restores: /commits\[0\]\?\.shortHash/,
      },
    ],
  };
}

test("the parent file fails the published check because the repair is absent, in-process and inside bwrap", (t) => {
  if (!practiceSandboxReady()) { t.skip("bwrap is not installed"); return; }
  const node = visibleNodeBin();
  assert.ok(node);
  const built = rows();
  for (const row of built.list) {
    const dir = mkdtempSync(join(tmpdir(), "m272-kill-"));
    placeFiles(dir, { ...row.files, ".gitignore": "node_modules\n" });
    symlinkSync(built.mods, join(dir, "node_modules"));
    gitInit(dir);
    const direct = spawnSync(row.cmd[0]!, row.cmd.slice(1), { cwd: dir, encoding: "utf8" });
    const directOut = `${direct.stdout}\n${direct.stderr}`;
    assert.notEqual(direct.status, 0, directOut.slice(-900));
    assert.match(directOut, row.why, directOut.slice(-900));
    assert.doesNotMatch(directOut, /ReferenceError|SyntaxError|TransformError/, directOut.slice(-400));
    const sand = runInPracticeSandbox(dir, row.cmd, 120_000, { capture: true, nodePath: node, nodeModules: built.mods });
    assert.equal(sand.unsafe, false, sand.stdout.slice(-400));
    assert.notEqual(sand.code, 0, sand.stdout.slice(-900));
    assert.match(sand.stdout, row.why, sand.stdout.slice(-900));
    const repaired = repairBatch21({
      root: dir, output: directOut, sourcePattern: row.pattern, nodePath: node!, nodeModules: built.mods, testCommand: row.cmd,
    });
    assert.ok(repaired, directOut.slice(-900));
    assert.match(repaired!.diff, row.restores);
    rmSync(dir, { recursive: true, force: true });
  }
  rmSync(resolve(built.mods, ".."), { recursive: true, force: true });
});

test("an any-cast that only matches one recorded answer is test-only for each batch 21 family", (t) => {
  if (!practiceSandboxReady()) { t.skip("bwrap is not installed"); return; }
  const node = visibleNodeBin();
  assert.ok(node);
  for (const symbol of ["yaml", "parseWasm", "bumpVersion"]) {
    const strict = `export function ${symbol}(kind: string): string {\n  return kind === "b" ? "B" : "A";\n}\n`;
    const over = `export function ${symbol}(kind: any): string {\n  return "A";\n}\n`;
    const make = (body: string) => {
      const dir = mkdtempSync(join(tmpdir(), "m272-grade-"));
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

test("the published upm, unwasm, and changelogen checks fail before the repair and pass after, inside the sandbox", (t) => {
  if (!practiceSandboxReady()) { t.skip("bwrap is not installed"); return; }
  const node = visibleNodeBin();
  assert.ok(node);
  const built = rows();
  for (const row of built.list) {
    const dir = mkdtempSync(join(tmpdir(), "m272-run-"));
    placeFiles(dir, { ...row.files, ".gitignore": "node_modules\n" });
    symlinkSync(built.mods, join(dir, "node_modules"));
    gitInit(dir);
    const before = runInPracticeSandbox(dir, row.cmd, 120_000, { capture: true, nodePath: node, nodeModules: built.mods });
    assert.equal(before.unsafe, false, before.stdout.slice(-400));
    assert.notEqual(before.code, 0, before.stdout.slice(-500));
    const repaired = repairBatch21({
      root: dir, output: before.stdout, sourcePattern: row.pattern, nodePath: node!, nodeModules: built.mods, testCommand: row.cmd,
    });
    assert.ok(repaired, before.stdout.slice(-900));
    assert.match(repaired!.diff, row.restores);
    rmSync(dir, { recursive: true, force: true });
  }
  rmSync(resolve(built.mods, ".."), { recursive: true, force: true });
});
