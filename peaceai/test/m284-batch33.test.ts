// Batch 33. The library files are the published parent and the published test.
// Third-party bytes run only inside the practice sandbox.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { treatNaNInputsAsEqual, skipDirectorySearchPlaces, returnMissingKeyIndexOnEmptyCache, repairBatch33 } from "../lib/batch33.ts";
import { gradeBehavior } from "../lib/specgrade.ts";
import { practiceSandboxReady, runInPracticeSandbox, visibleNodeBin } from "../lib/practicemine.ts";

process.env.TZ = "UTC";

const fix = resolve(import.meta.dirname, "fixtures/m284");
const place = JSON.parse(readFileSync(join(import.meta.dirname, "m284-place.json"), "utf8")) as Record<string, string>;
const npmFix = resolve(import.meta.dirname, "fixtures/m284-npm");

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
  const dir = mkdtempSync(join(tmpdir(), "m284-mods-"));
  const nm = join(dir, "node_modules");
  mkdirSync(nm, { recursive: true });
  const depDir = mkdtempSync(join(tmpdir(), "m284-npm-"));
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

const JEST_MO = `module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  testMatch: ["**/test/memoize-one.spec.ts"],
  coverageThreshold: {},
};
`;
const JEST_MM = `module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  testMatch: ["**/__tests__/Cache.ts"],
  coverageThreshold: {},
};
`;
const JEST_CC = `module.exports = {
  testEnvironment: "node",
  transform: { "^.+\\\\.(ts|js)$": "babel-jest" },
  testMatch: ["**/test/successful-directories.test.ts"],
  resetModules: true,
  resetMocks: true,
  restoreMocks: true,
};
`;
const BABEL_CC = `module.exports = {
  presets: [
    ["@babel/preset-env", { targets: { node: "20" } }],
    "@babel/preset-typescript",
  ],
};
`;
const PRIVATE_PKG = `{ "type": "commonjs", "private": true }
`;

test("areInputsEqual treats NaN as equal, and a check that is not areInputsEqual is refused", () => {
  const source = text("mo-src-are-inputs-equal.ts.txt");
  const next = treatNaNInputsAsEqual(source);
  assert.match(next ?? "", /ourIsNaN/);
  assert.equal(treatNaNInputsAsEqual(next!), null);
  assert.equal(treatNaNInputsAsEqual(source.replace("export default function areInputsEqual", "export default function kept")), null);
});

test("readFile treats EISDIR as a missing file, and a check that is not readFile is refused", () => {
  const source = text("cc-src-readFile.ts.txt");
  const next = skipDirectorySearchPlaces(source);
  assert.match(next ?? "", /error\.code === 'EISDIR'/);
  assert.equal(skipDirectorySearchPlaces(next!), null);
  assert.equal(skipDirectorySearchPlaces(source.replace("export { readFile, readFileSync }", "export { kept, readFileSync }")), null);
});

test("Cache.getKeyIndex returns -1 when empty, and a check that is not Cache is refused", () => {
  const source = text("mm-src-Cache.ts.txt");
  const next = returnMissingKeyIndexOnEmptyCache(source);
  assert.match(next ?? "", /if \(!keysLength\)/);
  assert.equal(returnMissingKeyIndexOnEmptyCache(next!), null);
  assert.equal(returnMissingKeyIndexOnEmptyCache(source.replace("export class Cache", "export class kept")), null);
});

function rows() {
  const node = visibleNodeBin()!;
  const mods = runtime();
  const jestBin = "node_modules/jest/bin/jest.js";
  return {
    mods,
    list: [
      {
        files: { ...filesOf("mo-"), "package.json": Buffer.from(PRIVATE_PKG), "jest.config.cjs": Buffer.from(JEST_MO) },
        pattern: "^src/are-inputs-equal\\.ts$",
        cmd: [node, jestBin, "--config", "jest.config.cjs", "--coverage=false"],
        why: /toHaveBeenCalledTimes|Expected number of calls|Received number of calls/,
        restores: /ourIsNaN/,
      },
      {
        files: { ...filesOf("cc-"), "package.json": Buffer.from(PRIVATE_PKG), "jest.config.cjs": Buffer.from(JEST_CC), "babel.config.cjs": Buffer.from(BABEL_CC) },
        pattern: "^src/readFile\\.ts$",
        cmd: [node, jestBin, "--config", "jest.config.cjs", "--coverage=false"],
        why: /EISDIR|illegal operation on a directory/,
        restores: /error\.code === 'EISDIR'/,
      },
      {
        files: { ...filesOf("mm-"), "package.json": Buffer.from(PRIVATE_PKG), "jest.config.cjs": Buffer.from(JEST_MM) },
        pattern: "^src/Cache\\.ts$",
        cmd: [node, jestBin, "--config", "jest.config.cjs", "--coverage=false"],
        why: /TypeError|Cannot read propert|length/,
        restores: /if \(!keysLength\)/,
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
    const dir = mkdtempSync(join(tmpdir(), "m284-kill-"));
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
    const repaired = repairBatch33({
      root: dir, output: directOut, sourcePattern: row.pattern, nodePath: node!, nodeModules: built.mods, testCommand: row.cmd,
    });
    assert.ok(repaired, directOut.slice(-1200));
    assert.match(repaired!.diff, row.restores);
    rmSync(dir, { recursive: true, force: true });
  }
});

test("an any-cast that only matches one recorded answer is test-only for each batch 33 family", (t) => {
  if (!practiceSandboxReady()) { t.skip("bwrap is not installed"); return; }
  const node = visibleNodeBin();
  assert.ok(node);
  for (const symbol of ["areInputsEqual", "readFile", "Cache"]) {
    const strict = `export function ${symbol}(kind: string): string {\n  return kind === "b" ? "B" : "A";\n}\n`;
    const over = `export function ${symbol}(kind: any): string {\n  return "A";\n}\n`;
    const make = (body: string) => {
      const dir = mkdtempSync(join(tmpdir(), "m284-grade-"));
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

test("the published memoize-one, cosmiconfig, and micro-memoize checks fail before the repair and pass after, inside the sandbox", (t) => {
  if (!practiceSandboxReady()) { t.skip("bwrap is not installed"); return; }
  const node = visibleNodeBin();
  assert.ok(node);
  const built = rows();
  for (const row of built.list) {
    const dir = mkdtempSync(join(tmpdir(), "m284-run-"));
    placeFiles(dir, { ...row.files, ".gitignore": "node_modules\n" });
    symlinkSync(built.mods, join(dir, "node_modules"));
    gitInit(dir);
    const before = runInPracticeSandbox(dir, row.cmd, 180_000, { capture: true, nodePath: node, nodeModules: built.mods });
    assert.equal(before.unsafe, false, before.stdout.slice(-400));
    assert.notEqual(before.code, 0, before.stdout.slice(-800));
    const repaired = repairBatch33({
      root: dir, output: before.stdout, sourcePattern: row.pattern, nodePath: node!, nodeModules: built.mods, testCommand: row.cmd,
    });
    assert.ok(repaired, before.stdout.slice(-1200));
    assert.match(repaired!.diff, row.restores);
    rmSync(dir, { recursive: true, force: true });
  }
});
