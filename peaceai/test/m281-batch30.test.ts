// Batch 30. The library files are the published parent and the published test.
// Third-party bytes run only inside the practice sandbox.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { isolateSubscriptionObserverReads, brandNativeRequestInstance, skipScriptsWithoutPackageJson, repairBatch30 } from "../lib/batch30.ts";
import { gradeBehavior } from "../lib/specgrade.ts";
import { practiceSandboxReady, runInPracticeSandbox, visibleNodeBin } from "../lib/practicemine.ts";

process.env.TZ = "UTC";

const fix = resolve(import.meta.dirname, "fixtures/m281");
const place = JSON.parse(readFileSync(join(import.meta.dirname, "m281-place.json"), "utf8")) as Record<string, string>;
const npmFix = resolve(import.meta.dirname, "fixtures/m281-npm");

function childEnv(extra: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, TZ: "UTC", ...extra };
  delete env.NODE_TEST_CONTEXT;
  delete env.NODE_TEST_WORKER_ID;
  return env;
}

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

let cachedMods: string | null = null;
function runtime(): string {
  if (cachedMods) return cachedMods;
  const dir = mkdtempSync(join(tmpdir(), "m281-mods-"));
  const nm = join(dir, "node_modules");
  mkdirSync(nm, { recursive: true });
  const depDir = mkdtempSync(join(tmpdir(), "m281-npm-"));
  cpSync(npmFix, depDir, { recursive: true });
  const install = spawnSync("npm", ["ci", "--ignore-scripts", "--no-audit", "--no-fund", "--loglevel=error"], {
    cwd: depDir, encoding: "utf8", timeout: 300_000,
  });
  assert.equal(install.status, 0, install.stderr.slice(0, 800));
  for (const name of readdirSync(join(depDir, "node_modules"))) {
    if (name === ".bin") continue;
    const src = join(depDir, "node_modules", name);
    assert.equal(spawnSync("cp", ["-a", src, join(nm, name)], { stdio: "ignore" }).status, 0, name);
  }
  cachedMods = nm;
  rmSync(depDir, { recursive: true, force: true });
  return nm;
}

const STORE_VITEST_CJS = `module.exports = { test: { environment: "node" } };
`;
const REQUEST_VITEST_CJS = `module.exports = { test: { environment: "node", globals: true, setupFiles: ["./test/setup.ts"] } };
`;
const BUMPP_VITEST_CJS = `module.exports = { test: { environment: "node" } };
`;
const PRIVATE_PKG = `{ "type": "module", "private": true }
`;

test("createAtom isolates observer reads from the subscription, and a check that is not createAtom is refused", () => {
  const source = text("st-packages-store-src-atom.ts.txt");
  const next = isolateSubscriptionObserverReads(source);
  assert.match(next ?? "", /Observer reads must not become dependencies/);
  assert.equal(isolateSubscriptionObserverReads(next!), null);
  assert.equal(isolateSubscriptionObserverReads(source.replaceAll("export function createAtom", "export function kept")), null);
});

test("Request treats a native GlobalRequest as an instance of Request, and a check that is not Request is refused", () => {
  const source = text("ns-src-request.ts.txt");
  const next = brandNativeRequestInstance(source);
  assert.match(next ?? "", /Symbol\.hasInstance/);
  assert.equal(brandNativeRequestInstance(next!), null);
  assert.equal(brandNativeRequestInstance(source.replace("export class Request", "export class kept")), null);
});

test("runNpmScript skips lifecycle scripts when package.json is missing, and a check that is not runNpmScript is refused", () => {
  const source = text("bp-src-run-npm-script.ts.txt");
  const next = skipScriptsWithoutPackageJson(source);
  assert.match(next ?? "", /existsSync\(path\.join\(cwd, 'package\.json'\)\)/);
  assert.equal(skipScriptsWithoutPackageJson(next!), null);
  assert.equal(skipScriptsWithoutPackageJson(source.replace("export async function runNpmScript", "export async function kept")), null);
});

function rows() {
  const node = visibleNodeBin()!;
  const mods = runtime();
  return {
    mods,
    list: [
      {
        files: { ...filesOf("st-"), "package.json": Buffer.from(PRIVATE_PKG), "vitest.config.cjs": Buffer.from(STORE_VITEST_CJS) },
        pattern: "^src/atom\\.ts$",
        cmd: [node, "node_modules/vitest/vitest.mjs", "run", "--config", "vitest.config.cjs", "tests/observer-isolation.test.ts"],
        why: /to deeply equal|toEqual|AssertionError/,
        restores: /Observer reads must not become dependencies/,
      },
      {
        files: { ...filesOf("ns-"), "package.json": Buffer.from(PRIVATE_PKG), "vitest.config.cjs": Buffer.from(REQUEST_VITEST_CJS) },
        pattern: "^src/request\\.ts$",
        cmd: [node, "node_modules/vitest/vitest.mjs", "run", "--config", "vitest.config.cjs", "test/request.test.ts"],
        why: /to be an instance of Request|AssertionError|hasInstance/,
        restores: /Symbol\.hasInstance/,
      },
      {
        files: { ...filesOf("bp-"), "package.json": Buffer.from(PRIVATE_PKG), "vitest.config.cjs": Buffer.from(BUMPP_VITEST_CJS) },
        pattern: "^src/run-npm-script\\.ts$",
        cmd: [node, "node_modules/vitest/vitest.mjs", "run", "--config", "vitest.config.cjs", "test/run-npm-script.test.ts"],
        why: /ENOENT|package\.json|AssertionError|resolves/,
        restores: /existsSync\(path\.join\(cwd, 'package\.json'\)\)/,
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
    const dir = mkdtempSync(join(tmpdir(), "m281-kill-"));
    placeFiles(dir, { ...row.files, ".gitignore": "node_modules\n" });
    symlinkSync(built.mods, join(dir, "node_modules"));
    gitInit(dir);
    const direct = spawnSync(row.cmd[0]!, row.cmd.slice(1), {
      cwd: dir, encoding: "utf8", timeout: 180_000, env: childEnv(),
    });
    const directOut = `${direct.stdout}\n${direct.stderr}`;
    assert.notEqual(direct.status, 0, directOut.slice(-1200));
    assert.match(directOut, row.why, directOut.slice(-1200));
    assert.doesNotMatch(directOut, /ReferenceError/, directOut.slice(-400));
    const sand = runInPracticeSandbox(dir, row.cmd, 180_000, { capture: true, nodePath: node, nodeModules: built.mods });
    assert.equal(sand.unsafe, false, sand.stdout.slice(-400));
    assert.notEqual(sand.code, 0, sand.stdout.slice(-1200));
    assert.match(sand.stdout, row.why, sand.stdout.slice(-1200));
    const repaired = repairBatch30({
      root: dir, output: directOut, sourcePattern: row.pattern, nodePath: node!, nodeModules: built.mods, testCommand: row.cmd,
    });
    assert.ok(repaired, directOut.slice(-1200));
    assert.match(repaired!.diff, row.restores);
    rmSync(dir, { recursive: true, force: true });
  }
});

test("an any-cast that only matches one recorded answer is test-only for each batch 30 family", (t) => {
  if (!practiceSandboxReady()) { t.skip("bwrap is not installed"); return; }
  const node = visibleNodeBin();
  assert.ok(node);
  for (const symbol of ["createAtom", "Request", "runNpmScript"]) {
    const strict = `export function ${symbol}(kind: string): string {\n  return kind === "b" ? "B" : "A";\n}\n`;
    const over = `export function ${symbol}(kind: any): string {\n  return "A";\n}\n`;
    const make = (body: string) => {
      const dir = mkdtempSync(join(tmpdir(), "m281-grade-"));
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

test("the published store, node-server, and bumpp checks fail before the repair and pass after, inside the sandbox", (t) => {
  if (!practiceSandboxReady()) { t.skip("bwrap is not installed"); return; }
  const node = visibleNodeBin();
  assert.ok(node);
  const built = rows();
  for (const row of built.list) {
    const dir = mkdtempSync(join(tmpdir(), "m281-run-"));
    placeFiles(dir, { ...row.files, ".gitignore": "node_modules\n" });
    symlinkSync(built.mods, join(dir, "node_modules"));
    gitInit(dir);
    const before = runInPracticeSandbox(dir, row.cmd, 180_000, { capture: true, nodePath: node, nodeModules: built.mods });
    assert.equal(before.unsafe, false, before.stdout.slice(-400));
    assert.notEqual(before.code, 0, before.stdout.slice(-800));
    const repaired = repairBatch30({
      root: dir, output: before.stdout, sourcePattern: row.pattern, nodePath: node!, nodeModules: built.mods, testCommand: row.cmd,
    });
    assert.ok(repaired, before.stdout.slice(-1200));
    assert.match(repaired!.diff, row.restores);
    rmSync(dir, { recursive: true, force: true });
  }
});
