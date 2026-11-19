// Batch 25. The library files are the published parent and the published test.
// Third-party bytes run only inside the practice sandbox.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { inheritedSpy, repairBatch25, undefinedDefaults, variadicArray } from "../lib/batch25.ts";
import { gradeBehavior } from "../lib/specgrade.ts";
import { practiceSandboxReady, runInPracticeSandbox, visibleNodeBin } from "../lib/practicemine.ts";

const fix = resolve(import.meta.dirname, "fixtures/m276");
const place = JSON.parse(readFileSync(join(import.meta.dirname, "m276-place.json"), "utf8")) as Record<string, string>;
const modules = resolve(import.meta.dirname, "../../node_modules");
const npmFix = resolve(import.meta.dirname, "fixtures/m276-npm");

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
  const dir = mkdtempSync(join(tmpdir(), "m276-mods-"));
  const nm = join(dir, "node_modules");
  mkdirSync(nm, { recursive: true });
  for (const name of ["tsx", "esbuild", "@esbuild"]) {
    assert.equal(spawnSync("cp", ["-a", join(modules, name), join(nm, name)], { stdio: "ignore" }).status, 0, name);
  }
  mkdirSync(join(nm, "vitest"));
  writeFileSync(join(nm, "vitest/package.json"), `{"type":"module","exports":{".":"./index.js"}}\n`);
  writeFileSync(join(nm, "vitest/index.js"), readFileSync(join(import.meta.dirname, "m276-vitest-shim.js")));
  // Install pinned third-party deps from the lock-only fixture (registry needed once).
  const depDir = mkdtempSync(join(tmpdir(), "m276-npm-"));
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
  return nm;
}

test("an inherited accessor is found on the prototype chain, and a check that is not spyOn is refused", () => {
  const source = text("ts-src-spyOn.ts.txt");
  const next = inheritedSpy(source);
  assert.match(next ?? "", /getPrototypeOf\(obj\)/);
  assert.equal(inheritedSpy(next!), null);
  assert.equal(inheritedSpy(source.replace("export function spyOn", "export function kept")), null);
});

test("undefined glob options keep truthy defaults, and a check that is not glob is refused", () => {
  const source = text("tg-src-index.ts.txt");
  const next = undefinedDefaults(source);
  assert.match(next ?? "", /=== undefined/);
  assert.equal(undefinedDefaults(next!), null);
  assert.equal(undefinedDefaults(source.replace("export async function glob", "export async function kept")), null);
});

test("proxied arrays accept variadic push and open-ended splice, and a check that is not proxifyArrayElements is refused", () => {
  const source = text("ma-src-proxy-array.ts.txt");
  const next = variadicArray(source);
  assert.match(next ?? "", /push\(\.\.\.values/);
  assert.equal(variadicArray(next!), null);
  assert.equal(variadicArray(source.replace("export function proxifyArrayElements", "export function kept")), null);
});

function rows() {
  const node = visibleNodeBin()!;
  const tsx = [node, "node_modules/tsx/dist/cli.mjs"];
  const mods = runtime();
  const typed = (prefix: string) => {
    const files: Record<string, Buffer> = { ...filesOf(prefix) };
    if (!files["package.json"]) {
      if (prefix === "ts-") files["package.json"] = Buffer.from('{"name":"tinyspy","type":"module","exports":{".":"./src/index.ts"}}\n');
      else if (prefix === "tg-") files["package.json"] = Buffer.from('{"name":"tinyglobby","type":"module","exports":{".":"./src/index.ts"}}\n');
      else files["package.json"] = Buffer.from('{"name":"magicast","type":"module","exports":{".":"./src/index.ts","./helpers":"./src/helpers/index.ts"}}\n');
    }
    return files;
  };
  return {
    mods,
    list: [
      {
        files: typed("ts-"),
        pattern: "^src/spyOn\\.ts$",
        cmd: [...tsx, "test/class.test.ts"],
        why: /not\.toThrow|Cannot set property bar|inherited/,
        restores: /getPrototypeOf\(obj\)/,
      },
      {
        files: typed("tg-"),
        pattern: "^src/index\\.ts$",
        cmd: [node, "--import", "tsx", "--test", "test/index.test.ts"],
        why: /explicit undefined|call time|ERR_ASSERTION|AssertionError/,
        restores: /=== undefined/,
      },
      {
        files: typed("ma-"),
        pattern: "^src/proxy/array\\.ts$",
        cmd: [...tsx, "test/array.test.ts"],
        why: /push and unshift|splice without|toBe undefined|toEqual/,
        restores: /push\(\.\.\.values/,
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
    const dir = mkdtempSync(join(tmpdir(), "m276-kill-"));
    placeFiles(dir, { ...row.files, ".gitignore": "node_modules\n" });
    symlinkSync(built.mods, join(dir, "node_modules"));
    gitInit(dir);
    const direct = spawnSync(row.cmd[0]!, row.cmd.slice(1), {
      cwd: dir, encoding: "utf8", timeout: 180_000, env: childEnv(),
    });
    const directOut = `${direct.stdout}\n${direct.stderr}`;
    assert.notEqual(direct.status, 0, directOut.slice(-1200));
    assert.match(directOut, row.why, directOut.slice(-1200));
    assert.doesNotMatch(directOut, /ReferenceError|SyntaxError|TransformError/, directOut.slice(-400));
    const sand = runInPracticeSandbox(dir, row.cmd, 180_000, { capture: true, nodePath: node, nodeModules: built.mods });
    assert.equal(sand.unsafe, false, sand.stdout.slice(-400));
    assert.notEqual(sand.code, 0, sand.stdout.slice(-1200));
    assert.match(sand.stdout, row.why, sand.stdout.slice(-1200));
    const repaired = repairBatch25({
      root: dir, output: directOut, sourcePattern: row.pattern, nodePath: node!, nodeModules: built.mods, testCommand: row.cmd,
    });
    assert.ok(repaired, directOut.slice(-1200));
    assert.match(repaired!.diff, row.restores);
    rmSync(dir, { recursive: true, force: true });
  }
});

test("an any-cast that only matches one recorded answer is test-only for each batch 25 family", (t) => {
  if (!practiceSandboxReady()) { t.skip("bwrap is not installed"); return; }
  const node = visibleNodeBin();
  assert.ok(node);
  for (const symbol of ["spyOn", "glob", "proxifyArrayElements"]) {
    const strict = `export function ${symbol}(kind: string): string {\n  return kind === "b" ? "B" : "A";\n}\n`;
    const over = `export function ${symbol}(kind: any): string {\n  return "A";\n}\n`;
    const make = (body: string) => {
      const dir = mkdtempSync(join(tmpdir(), "m276-grade-"));
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

test("the published tinyspy, tinyglobby, and magicast checks fail before the repair and pass after, inside the sandbox", (t) => {
  if (!practiceSandboxReady()) { t.skip("bwrap is not installed"); return; }
  const node = visibleNodeBin();
  assert.ok(node);
  const built = rows();
  for (const row of built.list) {
    const dir = mkdtempSync(join(tmpdir(), "m276-run-"));
    placeFiles(dir, { ...row.files, ".gitignore": "node_modules\n" });
    symlinkSync(built.mods, join(dir, "node_modules"));
    gitInit(dir);
    const before = runInPracticeSandbox(dir, row.cmd, 180_000, { capture: true, nodePath: node, nodeModules: built.mods });
    assert.equal(before.unsafe, false, before.stdout.slice(-400));
    assert.notEqual(before.code, 0, before.stdout.slice(-800));
    const repaired = repairBatch25({
      root: dir, output: before.stdout, sourcePattern: row.pattern, nodePath: node!, nodeModules: built.mods, testCommand: row.cmd,
    });
    assert.ok(repaired, before.stdout.slice(-1200));
    assert.match(repaired!.diff, row.restores);
    rmSync(dir, { recursive: true, force: true });
  }
});
