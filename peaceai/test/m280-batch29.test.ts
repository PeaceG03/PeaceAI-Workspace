// Batch 29. The library files are the published parent and the published test.
// Third-party bytes run only inside the practice sandbox.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { parseQuotedCacheControl, isolateAsyncWatchContext, lookupInheritedDescriptors, repairBatch29 } from "../lib/batch29.ts";
import { gradeBehavior } from "../lib/specgrade.ts";
import { practiceSandboxReady, runInPracticeSandbox, visibleNodeBin } from "../lib/practicemine.ts";

process.env.TZ = "UTC";

const fix = resolve(import.meta.dirname, "fixtures/m280");
const place = JSON.parse(readFileSync(join(import.meta.dirname, "m280-place.json"), "utf8")) as Record<string, string>;
const npmFix = resolve(import.meta.dirname, "fixtures/m280-npm");

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
  const dir = mkdtempSync(join(tmpdir(), "m280-mods-"));
  const nm = join(dir, "node_modules");
  mkdirSync(nm, { recursive: true });
  const depDir = mkdtempSync(join(tmpdir(), "m280-npm-"));
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

const VALTIO_VITEST_CJS = `const { resolve } = require("node:path");
module.exports = {
  resolve: {
    alias: [
      { find: /^valtio$/, replacement: resolve(__dirname, "src/index.ts") },
      { find: /^valtio(.*)$/, replacement: resolve(__dirname, "src/$1.ts") },
    ],
  },
  test: { environment: "node" },
};
`;

const IPX_VITEST_CJS = `module.exports = { test: { environment: "node" } };
`;

test("ipxHttpStorage parses a quoted or case-folded Cache-Control max-age, and a check that is not ipxHttpStorage is refused", () => {
  const source = text("ix-src-storage-http.ts.txt");
  const next = parseQuotedCacheControl(source);
  assert.match(next ?? "", /function parseCacheControlMaxAge/);
  assert.equal(parseQuotedCacheControl(next!), null);
  assert.equal(parseQuotedCacheControl(source.replace("export function ipxHttpStorage", "export function kept")), null);
});

test("watch restores its parent cleanup context before awaiting, and a check that is not watch is refused", () => {
  const source = text("va-src-vanilla-utils-watch.ts.txt");
  const next = isolateAsyncWatchContext(source);
  assert.match(next ?? "", /Restore the parent context before awaiting/);
  assert.equal(isolateAsyncWatchContext(next!), null);
  assert.equal(isolateAsyncWatchContext(source.replace("export function watch", "export function kept")), null);
});

test("TransformOperationExecutor looks up descriptors on the prototype chain, and a check that is not TransformOperationExecutor is refused", () => {
  const source = text("ct-src-TransformOperationExecutor.ts.txt");
  const next = lookupInheritedDescriptors(source);
  assert.match(next ?? "", /getPropertyDescriptor/);
  assert.equal(lookupInheritedDescriptors(next!), null);
  assert.equal(lookupInheritedDescriptors(source.replace("export class TransformOperationExecutor", "export class kept")), null);
});

function rows() {
  const node = visibleNodeBin()!;
  const mods = runtime();
  return {
    mods,
    list: [
      {
        files: { ...filesOf("ix-"), "vitest.config.cjs": Buffer.from(IPX_VITEST_CJS) },
        pattern: "^src/storage/http\\.ts$",
        cmd: [node, "node_modules/vitest/vitest.mjs", "run", "--config", "vitest.config.cjs", "test/storage/http.test.ts"],
        why: /to match object|AssertionError|maxAge/,
        restores: /function parseCacheControlMaxAge/,
      },
      {
        files: { ...filesOf("va-"), "vitest.config.cjs": Buffer.from(VALTIO_VITEST_CJS) },
        pattern: "^src/vanilla/utils/watch\\.ts$",
        cmd: [node, "node_modules/vitest/vitest.mjs", "run", "--config", "vitest.config.cjs", "tests/watch.test.tsx"],
        why: /toBeCalledTimes|AssertionError|#1183/,
        restores: /Restore the parent context before awaiting/,
      },
      {
        files: filesOf("ct-"),
        pattern: "^src/TransformOperationExecutor\\.ts$",
        cmd: [node, "node_modules/jest/bin/jest.js", "test/functional/basic-functionality.spec.ts", "--coverage=false", "--cache=false", "--runInBand"],
        why: /TypeError|only a getter|getPropertyDescriptor|inherited/,
        restores: /getPropertyDescriptor/,
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
    const dir = mkdtempSync(join(tmpdir(), "m280-kill-"));
    placeFiles(dir, { ...row.files, ".gitignore": "node_modules\n" });
    symlinkSync(built.mods, join(dir, "node_modules"));
    gitInit(dir);
    const direct = spawnSync(row.cmd[0]!, row.cmd.slice(1), {
      cwd: dir, encoding: "utf8", timeout: 180_000, env: childEnv(),
    });
    const directOut = `${direct.stdout}\n${direct.stderr}`;
    assert.notEqual(direct.status, 0, directOut.slice(-1200));
    assert.match(directOut, row.why, directOut.slice(-1200));
    assert.doesNotMatch(directOut, /ReferenceError|TransformError/, directOut.slice(-400));
    const sand = runInPracticeSandbox(dir, row.cmd, 180_000, { capture: true, nodePath: node, nodeModules: built.mods });
    assert.equal(sand.unsafe, false, sand.stdout.slice(-400));
    assert.notEqual(sand.code, 0, sand.stdout.slice(-1200));
    assert.match(sand.stdout, row.why, sand.stdout.slice(-1200));
    const repaired = repairBatch29({
      root: dir, output: directOut, sourcePattern: row.pattern, nodePath: node!, nodeModules: built.mods, testCommand: row.cmd,
    });
    assert.ok(repaired, directOut.slice(-1200));
    assert.match(repaired!.diff, row.restores);
    rmSync(dir, { recursive: true, force: true });
  }
});

test("an any-cast that only matches one recorded answer is test-only for each batch 29 family", (t) => {
  if (!practiceSandboxReady()) { t.skip("bwrap is not installed"); return; }
  const node = visibleNodeBin();
  assert.ok(node);
  for (const symbol of ["ipxHttpStorage", "watch", "TransformOperationExecutor"]) {
    const strict = `export function ${symbol}(kind: string): string {\n  return kind === "b" ? "B" : "A";\n}\n`;
    const over = `export function ${symbol}(kind: any): string {\n  return "A";\n}\n`;
    const make = (body: string) => {
      const dir = mkdtempSync(join(tmpdir(), "m280-grade-"));
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

test("the published ipx, valtio, and class-transformer checks fail before the repair and pass after, inside the sandbox", (t) => {
  if (!practiceSandboxReady()) { t.skip("bwrap is not installed"); return; }
  const node = visibleNodeBin();
  assert.ok(node);
  const built = rows();
  for (const row of built.list) {
    const dir = mkdtempSync(join(tmpdir(), "m280-run-"));
    placeFiles(dir, { ...row.files, ".gitignore": "node_modules\n" });
    symlinkSync(built.mods, join(dir, "node_modules"));
    gitInit(dir);
    const before = runInPracticeSandbox(dir, row.cmd, 180_000, { capture: true, nodePath: node, nodeModules: built.mods });
    assert.equal(before.unsafe, false, before.stdout.slice(-400));
    assert.notEqual(before.code, 0, before.stdout.slice(-800));
    const repaired = repairBatch29({
      root: dir, output: before.stdout, sourcePattern: row.pattern, nodePath: node!, nodeModules: built.mods, testCommand: row.cmd,
    });
    assert.ok(repaired, before.stdout.slice(-1200));
    assert.match(repaired!.diff, row.restores);
    rmSync(dir, { recursive: true, force: true });
  }
});
