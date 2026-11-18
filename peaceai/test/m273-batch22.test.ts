// Batch 22. The library files are the published parent and the published test.
// Third-party bytes run only inside the practice sandbox.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { listedPortFirst, onFailIgnore, repairBatch22, wildcardTrailer } from "../lib/batch22.ts";
import { gradeBehavior } from "../lib/specgrade.ts";
import { practiceSandboxReady, runInPracticeSandbox, visibleNodeBin } from "../lib/practicemine.ts";

const fix = resolve(import.meta.dirname, "fixtures/m273");
const place = JSON.parse(readFileSync(join(import.meta.dirname, "m273-place.json"), "utf8")) as Record<string, string>;
const modules = resolve(import.meta.dirname, "../../node_modules");

function placeFiles(root: string, files: Record<string, string | Buffer>) {
  for (const [path, content] of Object.entries(files)) {
    const dest = path.replaceAll("__SCOPE__", "@");
    mkdirSync(join(root, dest, ".."), { recursive: true });
    writeFileSync(join(root, dest), content);
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
  const dir = mkdtempSync(join(tmpdir(), "m273-mods-"));
  const stage = mkdtempSync(join(tmpdir(), "m273-npm-"));
  const installed = spawnSync("npm", [
    "install", "--prefix", stage, "--no-package-lock", "--no-save",
    "@vercel/nft@1.10.2", "pathe@2.0.3", "semver@7.8.5", "exsolve@1.1.1",
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
  writeFileSync(join(nm, "vitest/index.js"), readFileSync(join(import.meta.dirname, "m273-vitest-shim.js")));
  return nm;
}

test("a listed port is tried before the default, and a check that is not getPort is refused", () => {
  const source = text("gp-src-get-port.ts.txt");
  const next = listedPortFirst(source);
  assert.match(next ?? "", /portsToCheck\.push\(3000\)/);
  assert.equal(listedPortFirst(next!), null);
  assert.equal(listedPortFirst(source.replace("export async function getPort", "export async function kept")), null);
});

test("a wildcard import with a trailer still resolves, and a check that is not traceNodeModules is refused", () => {
  const source = text("nf-src-trace.ts.txt");
  const next = wildcardTrailer(source);
  assert.match(next ?? "", /nftResolve/);
  assert.equal(wildcardTrailer(next!), null);
  assert.equal(wildcardTrailer(source.replace("export async function traceNodeModules", "export async function kept")), null);
});

test("onFail ignore does not warn, and a check that is not reconcile is refused", () => {
  const source = text("ju-src-project-manifest.ts.txt");
  const next = onFailIgnore(source);
  assert.match(next ?? "", /onFail === "ignore"/);
  assert.equal(onFailIgnore(next!), null);
  assert.equal(onFailIgnore(source.replace("export function reconcile", "export function kept")), null);
});

function rows() {
  const node = visibleNodeBin()!;
  const tsx = [node, "node_modules/tsx/dist/cli.mjs"];
  const mods = runtime();
  const typed = (prefix: string, pkg = true) => {
    const files: Record<string, Buffer> = { ...filesOf(prefix) };
    if (pkg) files["package.json"] = Buffer.from('{"type":"module"}\n');
    return files;
  };
  return {
    mods,
    list: [
      {
        files: typed("gp-"),
        pattern: "^src/get-port\\.ts$",
        cmd: [...tsx, "test/index.test.ts"],
        why: /3000 vs 8080/,
        restores: /portsToCheck\.push\(3000\)/,
      },
      {
        files: typed("nf-"),
        pattern: "^src/trace\\.ts$",
        cmd: [...tsx, "test/trace.test.ts"],
        why: /imports-wildcard/,
        restores: /nftResolve/,
      },
      {
        files: typed("ju-", false),
        pattern: "^src/project/manifest\\.ts$",
        cmd: [...tsx, "test/unit/manifest.test.ts"],
        why: /devEngines\.packageManager/,
        restores: /onFail === "ignore"/,
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
    const dir = mkdtempSync(join(tmpdir(), "m273-kill-"));
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
    const repaired = repairBatch22({
      root: dir, output: directOut, sourcePattern: row.pattern, nodePath: node!, nodeModules: built.mods, testCommand: row.cmd,
    });
    assert.ok(repaired, directOut.slice(-900));
    assert.match(repaired!.diff, row.restores);
    rmSync(dir, { recursive: true, force: true });
  }
  rmSync(resolve(built.mods, ".."), { recursive: true, force: true });
});

test("an any-cast that only matches one recorded answer is test-only for each batch 22 family", (t) => {
  if (!practiceSandboxReady()) { t.skip("bwrap is not installed"); return; }
  const node = visibleNodeBin();
  assert.ok(node);
  for (const symbol of ["getPort", "traceNodeModules", "reconcile"]) {
    const strict = `export function ${symbol}(kind: string): string {\n  return kind === "b" ? "B" : "A";\n}\n`;
    const over = `export function ${symbol}(kind: any): string {\n  return "A";\n}\n`;
    const make = (body: string) => {
      const dir = mkdtempSync(join(tmpdir(), "m273-grade-"));
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

test("the published get-port-please, nf3, and jup checks fail before the repair and pass after, inside the sandbox", (t) => {
  if (!practiceSandboxReady()) { t.skip("bwrap is not installed"); return; }
  const node = visibleNodeBin();
  assert.ok(node);
  const built = rows();
  for (const row of built.list) {
    const dir = mkdtempSync(join(tmpdir(), "m273-run-"));
    placeFiles(dir, { ...row.files, ".gitignore": "node_modules\n" });
    symlinkSync(built.mods, join(dir, "node_modules"));
    gitInit(dir);
    const before = runInPracticeSandbox(dir, row.cmd, 120_000, { capture: true, nodePath: node, nodeModules: built.mods });
    assert.equal(before.unsafe, false, before.stdout.slice(-400));
    assert.notEqual(before.code, 0, before.stdout.slice(-500));
    const repaired = repairBatch22({
      root: dir, output: before.stdout, sourcePattern: row.pattern, nodePath: node!, nodeModules: built.mods, testCommand: row.cmd,
    });
    assert.ok(repaired, before.stdout.slice(-900));
    assert.match(repaired!.diff, row.restores);
    rmSync(dir, { recursive: true, force: true });
  }
  rmSync(resolve(built.mods, ".."), { recursive: true, force: true });
});
