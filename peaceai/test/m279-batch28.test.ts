// Batch 28. The library files are the published parent and the published test.
// Third-party bytes run only inside the practice sandbox.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { deniedImportEveryTime, interopNamedDefault, rejectJoinedAlias, repairBatch28 } from "../lib/batch28.ts";
import { gradeBehavior } from "../lib/specgrade.ts";
import { practiceSandboxReady, runInPracticeSandbox, visibleNodeBin } from "../lib/practicemine.ts";

process.env.TZ = "UTC";

const fix = resolve(import.meta.dirname, "fixtures/m279");
const place = JSON.parse(readFileSync(join(import.meta.dirname, "m279-place.json"), "utf8")) as Record<string, string>;
const npmFix = resolve(import.meta.dirname, "fixtures/m279-npm");

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
  const dir = mkdtempSync(join(tmpdir(), "m279-mods-"));
  const nm = join(dir, "node_modules");
  mkdirSync(nm, { recursive: true });
  // Install pinned third-party deps from the lock-only fixture (registry needed once).
  const depDir = mkdtempSync(join(tmpdir(), "m279-npm-"));
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

test("ImpoundPlugin reports a denied import on every request, and a check that is not ImpoundPlugin is refused", () => {
  const source = text("ip-src-index.ts.txt");
  const next = deniedImportEveryTime(source);
  assert.match(next ?? "", /options\.error === false && options\.warn !== 'always'/);
  assert.equal(deniedImportEveryTime(next!), null);
  assert.equal(deniedImportEveryTime(source.replace("export const ImpoundPlugin", "export const kept")), null);
});

test("interopDefault skips a named export that is the default value, and a check that is not interopDefault is refused", () => {
  const source = text("uc-packages-unconfig-src-interop.ts.txt");
  const next = interopNamedDefault(source);
  assert.match(next ?? "", /key === 'default' \|\| \(mod as any\)\[key\] === defaultValue/);
  assert.equal(interopNamedDefault(next!), null);
  assert.equal(interopNamedDefault(source.replace("export function interopDefault", "export function kept")), null);
});

test("CronExpressionParser rejects a month or day-of-week name that is not on its own, and a check that is not CronExpressionParser is refused", () => {
  const source = text("cp-src-CronExpressionParser.ts.txt");
  const next = rejectJoinedAlias(source);
  assert.match(next ?? "", /Invalid alias, got value: \$\{value\}/);
  assert.equal(rejectJoinedAlias(next!), null);
  assert.equal(rejectJoinedAlias(source.replace("export class CronExpressionParser", "export class kept")), null);
});

function rows() {
  const node = visibleNodeBin()!;
  const mods = runtime();
  const typed = (prefix: string, pkg: string, extra: Record<string, Buffer> = {}) => {
    const files: Record<string, Buffer> = { ...filesOf(prefix), ...extra };
    if (!files["package.json"]) {
      files["package.json"] = Buffer.from(`{"name":${JSON.stringify(pkg)},"private":true,"type":"module"}\n`);
    }
    return files;
  };
  const unconfigConfig = Buffer.from(
    'const { resolve } = require("node:path");\n' +
    'let Quansync = require("unplugin-quansync/vite");\n' +
    'if (Quansync && Quansync.default) Quansync = Quansync.default;\n' +
    'const { defaultClientConditions, defaultServerConditions } = require("vite");\n' +
    "module.exports = {\n" +
    "  resolve: {\n" +
    '    alias: { "unconfig-core": resolve(__dirname, "packages/core/src/index.ts") },\n' +
    '    conditions: ["dev", ...defaultClientConditions],\n' +
    "  },\n" +
    "  environments: { ssr: { resolve: { conditions: [\"dev\", ...defaultServerConditions] } } },\n" +
    "  plugins: [Quansync()],\n" +
    "};\n",
  );
  const impoundConfig = Buffer.from(
    'module.exports = { test: { environment: "node" } };\n',
  );
  return {
    mods,
    list: [
      {
        files: typed("ip-", "impound", { "vitest.config.cjs": impoundConfig }),
        pattern: "^src/index\\.ts$",
        cmd: [node, "node_modules/vitest/vitest.mjs", "run", "test/index.test.ts"],
        why: /to throw an error|AssertionError|expected \[Function\] to throw/,
        restores: /options\.error === false && options\.warn !== 'always'/,
      },
      {
        files: typed("uc-", "unconfig-monorepo", { "vitest.config.cjs": unconfigConfig }),
        pattern: "^packages/unconfig/src/interop\\.ts$",
        cmd: [node, "node_modules/vitest/vitest.mjs", "run", "--config", "vitest.config.cjs", "packages/unconfig/test/run.test.ts"],
        why: /Maximum call stack size exceeded|RangeError/,
        restores: /key === 'default' \|\| \(mod as any\)\[key\] === defaultValue/,
      },
      {
        files: typed("cp-", "cron-parser", { "package.json": Buffer.from('{"name":"cron-parser","private":true,"type":"commonjs"}\n') }),
        pattern: "^src/CronExpressionParser\\.ts$",
        cmd: [node, "node_modules/jest/bin/jest.js", "tests/CronExpressionParser.test.ts", "--coverage=false"],
        why: /Invalid alias|toThrow|Constraint error/,
        restores: /Invalid alias, got value: \$\{value\}/,
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
    const dir = mkdtempSync(join(tmpdir(), "m279-kill-"));
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
    const repaired = repairBatch28({
      root: dir, output: directOut, sourcePattern: row.pattern, nodePath: node!, nodeModules: built.mods, testCommand: row.cmd,
    });
    assert.ok(repaired, directOut.slice(-1200));
    assert.match(repaired!.diff, row.restores);
    rmSync(dir, { recursive: true, force: true });
  }
});

test("an any-cast that only matches one recorded answer is test-only for each batch 28 family", (t) => {
  if (!practiceSandboxReady()) { t.skip("bwrap is not installed"); return; }
  const node = visibleNodeBin();
  assert.ok(node);
  for (const symbol of ["ImpoundPlugin", "interopDefault", "CronExpressionParser"]) {
    const strict = `export function ${symbol}(kind: string): string {\n  return kind === "b" ? "B" : "A";\n}\n`;
    const over = `export function ${symbol}(kind: any): string {\n  return "A";\n}\n`;
    const make = (body: string) => {
      const dir = mkdtempSync(join(tmpdir(), "m279-grade-"));
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

test("the published impound, unconfig, and cron-parser checks fail before the repair and pass after, inside the sandbox", (t) => {
  if (!practiceSandboxReady()) { t.skip("bwrap is not installed"); return; }
  const node = visibleNodeBin();
  assert.ok(node);
  const built = rows();
  for (const row of built.list) {
    const dir = mkdtempSync(join(tmpdir(), "m279-run-"));
    placeFiles(dir, { ...row.files, ".gitignore": "node_modules\n" });
    symlinkSync(built.mods, join(dir, "node_modules"));
    gitInit(dir);
    const before = runInPracticeSandbox(dir, row.cmd, 180_000, { capture: true, nodePath: node, nodeModules: built.mods });
    assert.equal(before.unsafe, false, before.stdout.slice(-400));
    assert.notEqual(before.code, 0, before.stdout.slice(-800));
    const repaired = repairBatch28({
      root: dir, output: before.stdout, sourcePattern: row.pattern, nodePath: node!, nodeModules: built.mods, testCommand: row.cmd,
    });
    assert.ok(repaired, before.stdout.slice(-1200));
    assert.match(repaired!.diff, row.restores);
    rmSync(dir, { recursive: true, force: true });
  }
});
