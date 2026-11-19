// Batch 24. The library files are the published parent and the published test.
// Third-party bytes run only inside the practice sandbox.
process.env.TZ = "UTC";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { annotatedDestructure, emptyCombine, repairBatch24, stringDefaults } from "../lib/batch24.ts";
import { gradeBehavior } from "../lib/specgrade.ts";
import { practiceSandboxReady, runInPracticeSandbox, visibleNodeBin } from "../lib/practicemine.ts";

const fix = resolve(import.meta.dirname, "fixtures/m275");
const place = JSON.parse(readFileSync(join(import.meta.dirname, "m275-place.json"), "utf8")) as Record<string, string>;
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
  const dir = mkdtempSync(join(tmpdir(), "m275-mods-"));
  const nm = join(dir, "node_modules");
  mkdirSync(nm, { recursive: true });
  for (const name of ["tsx", "esbuild", "@esbuild"]) {
    assert.equal(spawnSync("cp", ["-a", join(modules, name), join(nm, name)], { stdio: "ignore" }).status, 0, name);
  }
  mkdirSync(join(nm, "vitest"));
  writeFileSync(join(nm, "vitest/package.json"), `{"type":"module","exports":{".":"./index.js"}}\n`);
  writeFileSync(join(nm, "vitest/index.js"), readFileSync(join(import.meta.dirname, "m275-vitest-shim.js")));
  // unimport's regexp imports strip-literal; identity is enough for these cases.
  mkdirSync(join(nm, "strip-literal"), { recursive: true });
  writeFileSync(join(nm, "strip-literal/package.json"), `{"type":"module","exports":{".":"./index.js"}}\n`);
  writeFileSync(join(nm, "strip-literal/index.js"), `export function stripLiteral(s){return s}\nexport default stripLiteral\n`);
  return nm;
}

test("an annotated destructuring stays local, and a check that is not RE_EXCLUDE is refused", () => {
  const source = text("ui-src-regexp.ts.txt");
  const next = annotatedDestructure(source);
  assert.match(next ?? "", /\(\?::\[/);
  assert.equal(annotatedDestructure(next!), null);
  assert.equal(annotatedDestructure(source.replace("export const RE_EXCLUDE", "export const KEPT")), null);
});

test("a string defaults value becomes an object, and a check that is not resolveCompatibilityDates is refused", () => {
  const source = text("cx-src-date.ts.txt");
  const next = stringDefaults(source);
  assert.match(next ?? "", /typeof defaults === "string"/);
  assert.equal(stringDefaults(next!), null);
  assert.equal(stringDefaults(source.replace("export function resolveCompatibilityDates", "export function kept")), null);
});

test("zero streams end the combined stream, and a check that is not combineStreams is refused", () => {
  const source = text("tx-src-stream.ts.txt");
  const next = emptyCombine(source);
  assert.match(next ?? "", /streamCount === 0/);
  assert.equal(emptyCombine(next!), null);
  assert.equal(emptyCombine(source.replace("export const combineStreams", "export const kept")), null);
});

function rows() {
  const node = visibleNodeBin()!;
  const tsx = [node, "node_modules/tsx/dist/cli.mjs"];
  const mods = runtime();
  const typed = (prefix: string) => {
    const files: Record<string, Buffer> = { ...filesOf(prefix) };
    if (!files["package.json"]) files["package.json"] = Buffer.from('{"type":"module"}\n');
    return files;
  };
  return {
    mods,
    list: [
      {
        files: typed("ui-"),
        pattern: "^src/regexp\\.ts$",
        cmd: [...tsx, "test/existing-scanning.test.ts"],
        why: /toEqual|: Props|count: number/,
        restores: /\(\?::\[/,
      },
      {
        files: typed("cx-"),
        pattern: "^src/date\\.ts$",
        cmd: [...tsx, "test/date.test.ts"],
        why: /"0":"2"|character|toEqual.*default/,
        restores: /typeof defaults === "string"/,
      },
      {
        files: typed("tx-"),
        pattern: "^src/stream\\.ts$",
        cmd: [...tsx, "src/test/stream_test.ts"],
        why: /timeout|ends without input streams/,
        restores: /streamCount === 0/,
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
    const dir = mkdtempSync(join(tmpdir(), "m275-kill-"));
    placeFiles(dir, { ...row.files, ".gitignore": "node_modules\n" });
    symlinkSync(built.mods, join(dir, "node_modules"));
    gitInit(dir);
    const direct = spawnSync(row.cmd[0]!, row.cmd.slice(1), {
      cwd: dir, encoding: "utf8", timeout: 180_000, env: { ...process.env, TZ: "UTC" },
    });
    const directOut = `${direct.stdout}\n${direct.stderr}`;
    assert.notEqual(direct.status, 0, directOut.slice(-1200));
    assert.match(directOut, row.why, directOut.slice(-1200));
    assert.doesNotMatch(directOut, /ReferenceError|SyntaxError|TransformError/, directOut.slice(-400));
    const sand = runInPracticeSandbox(dir, row.cmd, 180_000, { capture: true, nodePath: node, nodeModules: built.mods });
    assert.equal(sand.unsafe, false, sand.stdout.slice(-400));
    assert.notEqual(sand.code, 0, sand.stdout.slice(-1200));
    assert.match(sand.stdout, row.why, sand.stdout.slice(-1200));
    const repaired = repairBatch24({
      root: dir, output: directOut, sourcePattern: row.pattern, nodePath: node!, nodeModules: built.mods, testCommand: row.cmd,
    });
    assert.ok(repaired, directOut.slice(-1200));
    assert.match(repaired!.diff, row.restores);
    rmSync(dir, { recursive: true, force: true });
  }
  rmSync(resolve(built.mods, ".."), { recursive: true, force: true });
});

test("an any-cast that only matches one recorded answer is test-only for each batch 24 family", (t) => {
  if (!practiceSandboxReady()) { t.skip("bwrap is not installed"); return; }
  const node = visibleNodeBin();
  assert.ok(node);
  for (const symbol of ["RE_EXCLUDE", "resolveCompatibilityDates", "combineStreams"]) {
    const strict = `export function ${symbol}(kind: string): string {\n  return kind === "b" ? "B" : "A";\n}\n`;
    const over = `export function ${symbol}(kind: any): string {\n  return "A";\n}\n`;
    const make = (body: string) => {
      const dir = mkdtempSync(join(tmpdir(), "m275-grade-"));
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

test("the published unimport, compatx, and tinyexec checks fail before the repair and pass after, inside the sandbox", (t) => {
  if (!practiceSandboxReady()) { t.skip("bwrap is not installed"); return; }
  const node = visibleNodeBin();
  assert.ok(node);
  const built = rows();
  for (const row of built.list) {
    const dir = mkdtempSync(join(tmpdir(), "m275-run-"));
    placeFiles(dir, { ...row.files, ".gitignore": "node_modules\n" });
    symlinkSync(built.mods, join(dir, "node_modules"));
    gitInit(dir);
    const before = runInPracticeSandbox(dir, row.cmd, 180_000, { capture: true, nodePath: node, nodeModules: built.mods });
    assert.equal(before.unsafe, false, before.stdout.slice(-400));
    assert.notEqual(before.code, 0, before.stdout.slice(-800));
    const repaired = repairBatch24({
      root: dir, output: before.stdout, sourcePattern: row.pattern, nodePath: node!, nodeModules: built.mods, testCommand: row.cmd,
    });
    assert.ok(repaired, before.stdout.slice(-1200));
    assert.match(repaired!.diff, row.restores);
    rmSync(dir, { recursive: true, force: true });
  }
  rmSync(resolve(built.mods, ".."), { recursive: true, force: true });
});
