// Batch 27. The library files are the published parent and the published test.
// Third-party bytes run only inside the practice sandbox.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { abortListenerCleanup, killAllAggregate, parseJsoncManifest, repairBatch27 } from "../lib/batch27.ts";
import { gradeBehavior } from "../lib/specgrade.ts";
import { practiceSandboxReady, runInPracticeSandbox, visibleNodeBin } from "../lib/practicemine.ts";

const fix = resolve(import.meta.dirname, "fixtures/m278");
const place = JSON.parse(readFileSync(join(import.meta.dirname, "m278-place.json"), "utf8")) as Record<string, string>;
const npmFix = resolve(import.meta.dirname, "fixtures/m278-npm");

function childEnv(extra: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, ...extra };
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
  const dir = mkdtempSync(join(tmpdir(), "m278-mods-"));
  const nm = join(dir, "node_modules");
  mkdirSync(nm, { recursive: true });
  // Install pinned third-party deps from the lock-only fixture (registry needed once).
  const depDir = mkdtempSync(join(tmpdir(), "m278-npm-"));
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

test("killAll keeps going after a non-ESRCH error and raises AggregateError, and a check that is not killTree is refused", () => {
  const source = text("ps-src-main.ts.txt");
  const next = killAllAggregate(source);
  assert.match(next ?? "", /throw new AggregateError\(errors, 'Failed to kill one or more processes'\)/);
  assert.equal(killAllAggregate(next!), null);
  assert.equal(killAllAggregate(source.replace("export async function killTree", "export async function kept")), null);
});

test("withConcurrency removes its abort listener after every run, and a check that is not withConcurrency is refused", () => {
  const source = text("tb-src-concurrency.ts.txt");
  const next = abortListenerCleanup(source);
  assert.match(next ?? "", /signal\?\.removeEventListener\('abort', onAbort\)/);
  assert.equal(abortListenerCleanup(next!), null);
  assert.equal(abortListenerCleanup(source.replace("export const withConcurrency", "export const kept")), null);
});

test("getPackageJSON parses JSONC package manifests, and a check that is not getPackageJSON is refused", () => {
  const source = text("ni-src-fs.ts.txt");
  const next = parseJsoncManifest(source);
  assert.match(next ?? "", /stripJsonComments\(raw, \{ trailingCommas: true \}\)/);
  assert.equal(parseJsoncManifest(next!), null);
  assert.equal(parseJsoncManifest(source.replace("export function getPackageJSON", "export function kept")), null);
});

function rows() {
  const node = visibleNodeBin()!;
  const mods = runtime();
  const typed = (prefix: string, pkg: string) => {
    const files: Record<string, Buffer> = { ...filesOf(prefix) };
    if (!files["package.json"]) {
      files["package.json"] = Buffer.from(`{"name":${JSON.stringify(pkg)},"type":"module"}\n`);
    }
    // Vitest ESM config would compile into read-only node_modules inside bwrap.
    // A CommonJS config in the writable project root avoids that, as in batch 26.
    if (prefix === "ps-" && !files["vitest.config.cjs"]) {
      files["vitest.config.cjs"] = Buffer.from(
        'module.exports = { test: { globalSetup: ["./test/warmup.ts"], include: ["src/**/*.test.ts"] } };\n',
      );
    }
    if (prefix === "tb-" && !files["vitest.config.cjs"]) {
      files["vitest.config.cjs"] = Buffer.from(
        'module.exports = { test: { testTimeout: 10000, environment: "node" } };\n',
      );
    }
    return files;
  };
  return {
    mods,
    list: [
      {
        files: typed("ps-", "tinyps"),
        pattern: "^src/main\\.ts$",
        cmd: [node, "node_modules/vitest/vitest.mjs", "run", "src/main.test.ts"],
        why: /AggregateError|Operation not permitted|EPERM/,
        restores: /throw new AggregateError\(errors, 'Failed to kill one or more processes'\)/,
        syntaxOk: true,
      },
      {
        files: typed("tb-", "tinybench"),
        pattern: "^src/concurrency\\.ts$",
        cmd: [node, "node_modules/vitest/vitest.mjs", "run", "test/with-concurrency.test.ts"],
        why: /onAbort|to deeply equal \[\]|AssertionError/,
        restores: /signal\?\.removeEventListener\('abort', onAbort\)/,
        syntaxOk: true,
      },
      {
        files: typed("ni-", "ni"),
        pattern: "^src/fs\\.ts$",
        cmd: [node, "node_modules/vitest/vitest.mjs", "run", "test/package-json.spec.ts"],
        // The parent throws JSON.parse SyntaxError on a JSONC manifest. That is the missing
        // repair, not a broken SUT (the source file itself type-checks and loads).
        why: /JSON\.parse|Expected property name|trailing comma|SyntaxError/,
        restores: /stripJsonComments\(raw, \{ trailingCommas: true \}\)/,
        syntaxOk: false,
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
    const dir = mkdtempSync(join(tmpdir(), "m278-kill-"));
    placeFiles(dir, { ...row.files, ".gitignore": "node_modules\n" });
    symlinkSync(built.mods, join(dir, "node_modules"));
    gitInit(dir);
    const direct = spawnSync(row.cmd[0]!, row.cmd.slice(1), {
      cwd: dir, encoding: "utf8", timeout: 180_000, env: childEnv(),
    });
    const directOut = `${direct.stdout}\n${direct.stderr}`;
    assert.notEqual(direct.status, 0, directOut.slice(-1200));
    assert.match(directOut, row.why, directOut.slice(-1200));
    if (row.syntaxOk) {
      assert.doesNotMatch(directOut, /ReferenceError|SyntaxError|TransformError/, directOut.slice(-400));
    } else {
      assert.doesNotMatch(directOut, /ReferenceError|TransformError/, directOut.slice(-400));
    }
    const sand = runInPracticeSandbox(dir, row.cmd, 180_000, { capture: true, nodePath: node, nodeModules: built.mods });
    assert.equal(sand.unsafe, false, sand.stdout.slice(-400));
    assert.notEqual(sand.code, 0, sand.stdout.slice(-1200));
    assert.match(sand.stdout, row.why, sand.stdout.slice(-1200));
    const repaired = repairBatch27({
      root: dir, output: directOut, sourcePattern: row.pattern, nodePath: node!, nodeModules: built.mods, testCommand: row.cmd,
    });
    assert.ok(repaired, directOut.slice(-1200));
    assert.match(repaired!.diff, row.restores);
    rmSync(dir, { recursive: true, force: true });
  }
});

test("an any-cast that only matches one recorded answer is test-only for each batch 27 family", (t) => {
  if (!practiceSandboxReady()) { t.skip("bwrap is not installed"); return; }
  const node = visibleNodeBin();
  assert.ok(node);
  for (const symbol of ["killTree", "withConcurrency", "getPackageJSON"]) {
    const strict = `export function ${symbol}(kind: string): string {\n  return kind === "b" ? "B" : "A";\n}\n`;
    const over = `export function ${symbol}(kind: any): string {\n  return "A";\n}\n`;
    const make = (body: string) => {
      const dir = mkdtempSync(join(tmpdir(), "m278-grade-"));
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

test("the published tinyps, tinybench, and ni checks fail before the repair and pass after, inside the sandbox", (t) => {
  if (!practiceSandboxReady()) { t.skip("bwrap is not installed"); return; }
  const node = visibleNodeBin();
  assert.ok(node);
  const built = rows();
  for (const row of built.list) {
    const dir = mkdtempSync(join(tmpdir(), "m278-run-"));
    placeFiles(dir, { ...row.files, ".gitignore": "node_modules\n" });
    symlinkSync(built.mods, join(dir, "node_modules"));
    gitInit(dir);
    const before = runInPracticeSandbox(dir, row.cmd, 180_000, { capture: true, nodePath: node, nodeModules: built.mods });
    assert.equal(before.unsafe, false, before.stdout.slice(-400));
    assert.notEqual(before.code, 0, before.stdout.slice(-800));
    const repaired = repairBatch27({
      root: dir, output: before.stdout, sourcePattern: row.pattern, nodePath: node!, nodeModules: built.mods, testCommand: row.cmd,
    });
    assert.ok(repaired, before.stdout.slice(-1200));
    assert.match(repaired!.diff, row.restores);
    rmSync(dir, { recursive: true, force: true });
  }
});
