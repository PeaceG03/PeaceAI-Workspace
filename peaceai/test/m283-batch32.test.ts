// Batch 32. The library files are the published parent and the published test.
// Third-party bytes run only inside the practice sandbox.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { preserveElementTypeOnClone, copyEmptySharedArrayBufferSubclass, skipExpiredMemoryStoreClients, repairBatch32 } from "../lib/batch32.ts";
import { gradeBehavior } from "../lib/specgrade.ts";
import { practiceSandboxReady, runInPracticeSandbox, visibleNodeBin } from "../lib/practicemine.ts";

process.env.TZ = "UTC";

const fix = resolve(import.meta.dirname, "fixtures/m283");
const place = JSON.parse(readFileSync(join(import.meta.dirname, "m283-place.json"), "utf8")) as Record<string, string>;
const npmFix = resolve(import.meta.dirname, "fixtures/m283-npm");

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
  const dir = mkdtempSync(join(tmpdir(), "m283-mods-"));
  const nm = join(dir, "node_modules");
  mkdirSync(nm, { recursive: true });
  const depDir = mkdtempSync(join(tmpdir(), "m283-npm-"));
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

const VITEST_CJS = `module.exports = { test: { environment: "node" } };
`;
const PRIVATE_PKG = `{ "type": "module", "private": true }
`;

test("cloneNode passes the element type, and a check that is not cloneNode is refused", () => {
  const source = text("dh-src-node.ts.txt");
  const next = preserveElementTypeOnClone(source);
  assert.match(next ?? "", /node\.type/);
  assert.equal(preserveElementTypeOnClone(next!), null);
  assert.equal(preserveElementTypeOnClone(source.replaceAll("export function cloneNode", "export function kept")), null);
});

test("copyArrayBuffer uses the value constructor for an empty SharedArrayBuffer, and a check that is not copyArrayBuffer is refused", () => {
  const source = text("fc-src-copier.ts.txt");
  const next = copyEmptySharedArrayBufferSubclass(source);
  assert.match(next ?? "", /new state\.Constructor\(0\)/);
  assert.equal(copyEmptySharedArrayBufferSubclass(next!), null);
  assert.equal(copyEmptySharedArrayBufferSubclass(source.replace("export function copyArrayBuffer", "export function kept")), null);
});

test("MemoryStore.get skips an expired client, and a check that is not MemoryStore is refused", () => {
  const source = text("er-source-memory-store.ts.txt");
  const next = skipExpiredMemoryStoreClients(source);
  assert.match(next ?? "", /resetTime\.getTime\(\) <= Date\.now\(\)/);
  assert.equal(skipExpiredMemoryStoreClients(next!), null);
  assert.equal(skipExpiredMemoryStoreClients(source.replace("export class MemoryStore", "export class Kept")), null);
});

function rows() {
  const node = visibleNodeBin()!;
  const mods = runtime();
  return {
    mods,
    list: [
      {
        files: { ...filesOf("dh-"), "package.json": Buffer.from(PRIVATE_PKG), "vitest.config.cjs": Buffer.from(VITEST_CJS) },
        pattern: "^src/node\\.ts$",
        cmd: [node, "node_modules/vitest/vitest.mjs", "run", "--config", "vitest.config.cjs", "src/node.spec.ts"],
        why: /AssertionError|expected 'script'|expected 'style'|to be 'tag'/,
        restores: /node\.type/,
      },
      {
        files: { ...filesOf("fc-"), "package.json": Buffer.from(PRIVATE_PKG), "vitest.config.cjs": Buffer.from(VITEST_CJS) },
        pattern: "^src/copier\\.ts$",
        cmd: [node, "node_modules/vitest/vitest.mjs", "run", "--config", "vitest.config.cjs", "__tests__/index.test.ts"],
        why: /AssertionError|CustomSharedArrayBuffer|toBeInstanceOf|SharedArrayBuffer/,
        restores: /new state\.Constructor\(0\)/,
      },
      {
        files: { ...filesOf("er-"), "package.json": Buffer.from(PRIVATE_PKG) },
        pattern: "^source/memory-store\\.ts$",
        cmd: [node, "--experimental-vm-modules", "node_modules/jest/bin/jest.js", "--config", "jest.config.json", "--runInBand", "--coverage=false", "test/library/memory-store-test.ts"],
        why: /toBeUndefined|totalHits/,
        restores: /resetTime\.getTime\(\) <= Date\.now\(\)/,
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
    const dir = mkdtempSync(join(tmpdir(), "m283-kill-"));
    placeFiles(dir, { ...row.files, ".gitignore": "node_modules\n" });
    symlinkSync(built.mods, join(dir, "node_modules"));
    gitInit(dir);
    const direct = spawnSync(row.cmd[0]!, row.cmd.slice(1), {
      cwd: dir, encoding: "utf8", timeout: 180_000, env: childEnv(),
    });
    const directOut = `${direct.stdout}\\n${direct.stderr}`;
    assert.notEqual(direct.status, 0, directOut.slice(-1200));
    assert.match(directOut, row.why, directOut.slice(-1200));
    assert.doesNotMatch(directOut, /ReferenceError/, directOut.slice(-400));
    const sand = runInPracticeSandbox(dir, row.cmd, 180_000, { capture: true, nodePath: node, nodeModules: built.mods });
    assert.equal(sand.unsafe, false, sand.stdout.slice(-400));
    assert.notEqual(sand.code, 0, sand.stdout.slice(-1200));
    assert.match(sand.stdout, row.why, sand.stdout.slice(-1200));
    const repaired = repairBatch32({
      root: dir, output: directOut, sourcePattern: row.pattern, nodePath: node!, nodeModules: built.mods, testCommand: row.cmd,
    });
    assert.ok(repaired, directOut.slice(-1200));
    assert.match(repaired!.diff, row.restores);
    rmSync(dir, { recursive: true, force: true });
  }
});

test("an any-cast that only matches one recorded answer is test-only for each batch 32 family", (t) => {
  if (!practiceSandboxReady()) { t.skip("bwrap is not installed"); return; }
  const node = visibleNodeBin();
  assert.ok(node);
  for (const symbol of ["cloneNode", "copyArrayBuffer", "MemoryStore"]) {
    const strict = `export function ${symbol}(kind: string): string {
  return kind === "b" ? "B" : "A";
}
`;
    const over = `export function ${symbol}(kind: any): string {
  return "A";
}
`;
const make = (body: string) => {
      const dir = mkdtempSync(join(tmpdir(), "m283-grade-"));
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

test("the published domhandler, fast-copy, and express-rate-limit checks fail before the repair and pass after, inside the sandbox", (t) => {
  if (!practiceSandboxReady()) { t.skip("bwrap is not installed"); return; }
  const node = visibleNodeBin();
  assert.ok(node);
  const built = rows();
  for (const row of built.list) {
    const dir = mkdtempSync(join(tmpdir(), "m283-run-"));
    placeFiles(dir, { ...row.files, ".gitignore": "node_modules\n" });
    symlinkSync(built.mods, join(dir, "node_modules"));
    gitInit(dir);
    const before = runInPracticeSandbox(dir, row.cmd, 180_000, { capture: true, nodePath: node, nodeModules: built.mods });
    assert.equal(before.unsafe, false, before.stdout.slice(-400));
    assert.notEqual(before.code, 0, before.stdout.slice(-800));
    const repaired = repairBatch32({
      root: dir, output: before.stdout, sourcePattern: row.pattern, nodePath: node!, nodeModules: built.mods, testCommand: row.cmd,
    });
    assert.ok(repaired, before.stdout.slice(-1200));
    assert.match(repaired!.diff, row.restores);
    rmSync(dir, { recursive: true, force: true });
  }
});
