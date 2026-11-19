// Batch 20. The library files are the published parent and the published test.
// Third-party bytes run only inside the practice sandbox.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { endCallback, escapeSvgColor, repairBatch20, safeImageSize } from "../lib/batch20.ts";
import { gradeBehavior } from "../lib/specgrade.ts";
import { practiceSandboxReady, runInPracticeSandbox, visibleNodeBin } from "../lib/practicemine.ts";

const fix = resolve(import.meta.dirname, "fixtures/m271");
const place = JSON.parse(readFileSync(join(import.meta.dirname, "m271-place.json"), "utf8")) as Record<string, string>;
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
  const dir = mkdtempSync(join(tmpdir(), "m271-mods-"));
  const nm = join(dir, "node_modules");
  mkdirSync(nm);
  for (const name of ["tsx", "esbuild", "@esbuild"]) {
    assert.equal(spawnSync("cp", ["-a", join(modules, name), join(nm, name)], { stdio: "ignore" }).status, 0, name);
  }
  mkdirSync(join(nm, "vitest"));
  writeFileSync(join(nm, "vitest/package.json"), `{"type":"module","exports":{".":"./index.js"}}\n`);
  writeFileSync(join(nm, "vitest/index.js"), readFileSync(join(import.meta.dirname, "m271-vitest-shim.js")));
  return nm;
}

test("the end callback follows finish, and a check that is not Writable is refused", () => {
  const source = text("nm-src-stream-writable.ts.txt");
  const next = endCallback(source);
  assert.match(next ?? "", /if \(callback\)/);
  assert.equal(endCallback(next!), null);
  assert.equal(endCallback(source.replace("export class Writable", "export class Kept")), null);
});

test("a size that is not a safe integer is corrupt, and a check that is not imageMeta is refused", () => {
  const source = text("im-src-index.ts.txt");
  const next = safeImageSize(source);
  assert.match(next ?? "", /isSafeInteger/);
  assert.equal(safeImageSize(next!), null);
  assert.equal(safeImageSize(source.replace("export function imageMeta", "export function kept")), null);
});

test("an SVG color is escaped, and a check that is not renderSVG is refused", () => {
  const source = text("uq-src-svg.ts.txt");
  const next = escapeSvgColor(source);
  assert.match(next ?? "", /escapeAttr/);
  assert.equal(escapeSvgColor(next!), null);
  assert.equal(escapeSvgColor(source.replace("export function renderSVG", "export function kept")), null);
});

function rows() {
  const node = visibleNodeBin()!;
  const tsx = [node, "node_modules/tsx/dist/cli.mjs"];
  const mods = runtime();
  const nmh = filesOf("nm-");
  nmh["dist/_polyfill/events/node.mjs"] = Buffer.from('export { EventEmitter } from "node:events";\n');
  nmh["dist/_polyfill/buffer/node.mjs"] = Buffer.from('export { Buffer } from "node:buffer";\n');
  const typed = (prefix: string) => ({ ...filesOf(prefix), "package.json": Buffer.from('{"type":"module"}\n') });
  return {
    mods,
    list: [
      {
        files: nmh,
        pattern: "^src/stream/writable\\.ts$",
        cmd: [...tsx, "test/index.test.ts"],
        why: /\["finish"\] vs \["finish","callback"\]/,
        restores: /if \(callback\)/,
      },
      {
        files: typed("im-"),
        pattern: "^src/index\\.ts$",
        cmd: [...tsx, "test/index.test.ts"],
        why: /toThrow did not throw/,
        restores: /isSafeInteger/,
      },
      {
        files: typed("uq-"),
        pattern: "^src/svg\\.ts$",
        cmd: [...tsx, "test/index.test.ts"],
        why: /<script>/,
        restores: /escapeAttr/,
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
    const dir = mkdtempSync(join(tmpdir(), "m271-kill-"));
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
    const repaired = repairBatch20({
      root: dir, output: directOut, sourcePattern: row.pattern, nodePath: node!, nodeModules: built.mods, testCommand: row.cmd,
    });
    assert.ok(repaired, directOut.slice(-900));
    assert.match(repaired!.diff, row.restores);
    rmSync(dir, { recursive: true, force: true });
  }
  rmSync(resolve(built.mods, ".."), { recursive: true, force: true });
});

test("an any-cast that only matches one recorded answer is test-only for each batch 20 family", (t) => {
  if (!practiceSandboxReady()) { t.skip("bwrap is not installed"); return; }
  const node = visibleNodeBin();
  assert.ok(node);
  for (const symbol of ["fetchNodeRequestHandler", "imageMeta", "renderSVG"]) {
    const strict = `export function ${symbol}(kind: string): string {\n  return kind === "b" ? "B" : "A";\n}\n`;
    const over = `export function ${symbol}(kind: any): string {\n  return "A";\n}\n`;
    const make = (body: string) => {
      const dir = mkdtempSync(join(tmpdir(), "m271-grade-"));
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

test("the published node-mock-http, image-meta, and uqr checks fail before the repair and pass after, inside the sandbox", (t) => {
  if (!practiceSandboxReady()) { t.skip("bwrap is not installed"); return; }
  const node = visibleNodeBin();
  assert.ok(node);
  const built = rows();
  for (const row of built.list) {
    const dir = mkdtempSync(join(tmpdir(), "m271-run-"));
    placeFiles(dir, { ...row.files, ".gitignore": "node_modules\n" });
    symlinkSync(built.mods, join(dir, "node_modules"));
    gitInit(dir);
    const before = runInPracticeSandbox(dir, row.cmd, 120_000, { capture: true, nodePath: node, nodeModules: built.mods });
    assert.equal(before.unsafe, false, before.stdout.slice(-400));
    assert.notEqual(before.code, 0, before.stdout.slice(-500));
    const repaired = repairBatch20({
      root: dir, output: before.stdout, sourcePattern: row.pattern, nodePath: node!, nodeModules: built.mods, testCommand: row.cmd,
    });
    assert.ok(repaired, before.stdout.slice(-900));
    assert.match(repaired!.diff, row.restores);
    rmSync(dir, { recursive: true, force: true });
  }
  rmSync(resolve(built.mods, ".."), { recursive: true, force: true });
});
