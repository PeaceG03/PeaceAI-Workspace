// Batch 13. The library files are the published parent and the published test.
// Third-party bytes run only inside the practice sandbox.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { allowList, mixedRgb, repairBatch13, unsafeFloat } from "../lib/batch13.ts";
import { gradeBehavior } from "../lib/specgrade.ts";
import { practiceSandboxReady, runInPracticeSandbox, visibleNodeBin } from "../lib/practicemine.ts";

const repoRoot = resolve(import.meta.dirname, "../..");
const fix = resolve(import.meta.dirname, "fixtures/m264");
const readFix = (name: string) => readFileSync(join(fix, name), "utf8");
const modules = resolve(repoRoot, "node_modules");

function placeMapped(root: string, rows: readonly (readonly [string, string])[]) {
  for (const [name, dest] of rows) {
    mkdirSync(join(root, dest, ".."), { recursive: true });
    writeFileSync(join(root, dest), readFix(name));
  }
}

const COLOR: readonly (readonly [string, string])[] = [
  ["co-src-index.ts.txt", "src/index.ts"],
  ["co-src-constants.ts.txt", "src/constants.ts"],
  ["co-src-extend.ts.txt", "src/extend.ts"],
  ["co-src-parse.ts.txt", "src/parse.ts"],
  ["co-src-colord.ts.txt", "src/colord.ts"],
  ["co-src-random.ts.txt", "src/random.ts"],
  ["co-src-helpers.ts.txt", "src/helpers.ts"],
  ["co-src-types.ts.txt", "src/types.ts"],
  ["co-src-colorModels-hsv.ts.txt", "src/colorModels/hsv.ts"],
  ["co-src-colorModels-hex.ts.txt", "src/colorModels/hex.ts"],
  ["co-src-colorModels-hslString.ts.txt", "src/colorModels/hslString.ts"],
  ["co-src-colorModels-rgb.ts.txt", "src/colorModels/rgb.ts"],
  ["co-src-colorModels-hsl.ts.txt", "src/colorModels/hsl.ts"],
  ["co-src-colorModels-rgbString.ts.txt", "src/colorModels/rgbString.ts"],
  ["co-src-manipulate-invert.ts.txt", "src/manipulate/invert.ts"],
  ["co-src-manipulate-changeAlpha.ts.txt", "src/manipulate/changeAlpha.ts"],
  ["co-src-manipulate-saturate.ts.txt", "src/manipulate/saturate.ts"],
  ["co-src-manipulate-lighten.ts.txt", "src/manipulate/lighten.ts"],
  ["co-src-get-getBrightness.ts.txt", "src/get/getBrightness.ts"],
  ["co-colord.test.ts.txt", "tests/colord.test.ts"],
  ["co-fixtures.ts.txt", "tests/fixtures.ts"],
];
const ULTRA: readonly (readonly [string, string])[] = [
  ["uh-index.ts.txt", "src/index.ts"],
  ["uh-sanitize.ts.txt", "src/transformers/sanitize.ts"],
  ["uh-sanitize.test.ts.txt", "test/transformers/sanitize.test.ts"],
];
const LOSS: readonly (readonly [string, string])[] = [
  ["ll-utils.ts.txt", "src/utils.ts"],
  ["ll-utils.test.ts.txt", "src/utils.test.ts"],
];

function gitInit(root: string) {
  const git = (args: string[]) => spawnSync("git", ["-C", root, ...args], { stdio: "ignore" });
  git(["init", "-q"]);
  git(["add", "-A"]);
  git(["-c", "user.email=t@example.com", "-c", "user.name=t", "commit", "-qm", "base"]);
}

function runtimeModules(extra: string[]): string {
  const dir = mkdtempSync(join(tmpdir(), "m264-mods-"));
  const nm = join(dir, "node_modules");
  mkdirSync(nm);
  for (const name of ["tsx", "esbuild", "@esbuild", ...extra]) {
    const copied = spawnSync("cp", ["-a", join(modules, name), join(nm, name)], { stdio: "ignore" });
    assert.equal(copied.status, 0, name);
  }
  mkdirSync(join(nm, "vitest"));
  writeFileSync(join(nm, "vitest/package.json"), `{"type":"module","exports":{".":"./index.js"}}\n`);
  writeFileSync(join(nm, "vitest/index.js"), readFileSync(join(import.meta.dirname, "m264-vitest-shim.js")));
  return nm;
}

test("space-separated rgb may mix units, and a check that is not parseRgbaString is refused", () => {
  const next = mixedRgb(readFix("co-src-colorModels-rgbString.ts.txt"));
  assert.match(next ?? "", /const commaMatch/);
  assert.equal(mixedRgb(next!), null);
  assert.equal(mixedRgb(readFix("co-src-colorModels-rgbString.ts.txt").replace("export const parseRgbaString", "export const kept")), null);
});

test("a non-empty allow list drops the rest, and a check that is not getAction is refused", () => {
  const next = allowList(readFix("uh-sanitize.ts.txt"));
  assert.match(next ?? "", /'drop' : 'allow'/);
  assert.equal(allowList(next!), null);
  assert.equal(allowList(readFix("uh-sanitize.ts.txt").replace("function getAction(", "function kept(")), null);
});

test("an unsafe integer written as a float is rejected, and a check that is not isSafeNumber is refused", () => {
  const next = unsafeFloat(readFix("ll-utils.ts.txt"));
  assert.match(next ?? "", /!Number\.isSafeInteger\(num\)/);
  assert.equal(unsafeFloat(next!), null);
  assert.equal(unsafeFloat(readFix("ll-utils.ts.txt").replace("export function isSafeNumber(", "export function kept(")), null);
});

test("deleting the new line is killed by the published check, in-process and inside bwrap", (t) => {
  const rgb = mixedRgb(readFix("co-src-colorModels-rgbString.ts.txt"));
  const allowed = allowList(readFix("uh-sanitize.ts.txt"));
  const safe = unsafeFloat(readFix("ll-utils.ts.txt"));
  assert.ok(rgb && allowed && safe);
  const rgbFile = rgb.replace("  const commaMatch = commaRgbaMatcher.exec(input);\n", "");
  const allowFile = allowed.replace("  return (sanitize.allowElements?.length > 0) ? 'drop' : 'allow';\n", "");
  const safeFile = safe.replace("  if (Number.isInteger(num) && !Number.isSafeInteger(num)) {\n    return false\n  }\n", "");
  assert.notEqual(rgbFile, rgb);
  assert.notEqual(allowFile, allowed);
  assert.notEqual(safeFile, safe);
  const node = visibleNodeBin();
  assert.ok(node);
  if (!practiceSandboxReady()) { t.skip("bwrap is not installed"); return; }
  const tsx = [node!, "node_modules/tsx/dist/cli.mjs"];
  const vitestModules = runtimeModules([]);
  const typedModules = runtimeModules(["typescript"]);
  const cases: { prepare: (dir: string) => void; dest: string; cmd: string[]; pattern: string; modules: string }[] = [
    {
      prepare: (dir) => { placeMapped(dir, COLOR); writeFileSync(join(dir, "src/colorModels/rgbString.ts"), rgbFile); writeFileSync(join(dir, "run.cjs"), readFileSync(join(import.meta.dirname, "m264-colord-run.cjs"))); },
      dest: "src/colorModels/rgbString.ts", cmd: [node!, "run.cjs"], pattern: "^src/colorModels/rgbString\\.ts$", modules: typedModules,
    },
    {
      prepare: (dir) => { placeMapped(dir, ULTRA); writeFileSync(join(dir, "src/transformers/sanitize.ts"), allowFile); writeFileSync(join(dir, "package.json"), `{"type":"module"}\n`); },
      dest: "src/transformers/sanitize.ts", cmd: [...tsx, "test/transformers/sanitize.test.ts"], pattern: "^src/transformers/sanitize\\.ts$", modules: vitestModules,
    },
    {
      prepare: (dir) => { placeMapped(dir, LOSS); writeFileSync(join(dir, "src/utils.ts"), safeFile); writeFileSync(join(dir, "package.json"), `{"type":"module"}\n`); },
      dest: "src/utils.ts", cmd: [...tsx, "src/utils.test.ts"], pattern: "^src/utils\\.ts$", modules: vitestModules,
    },
  ];
  for (const row of cases) {
    const dir = mkdtempSync(join(tmpdir(), "m264-kill-"));
    row.prepare(dir);
    writeFileSync(join(dir, ".gitignore"), "node_modules\n");
    symlinkSync(row.modules, join(dir, "node_modules"));
    const direct = spawnSync(row.cmd[0]!, row.cmd.slice(1), { cwd: dir, encoding: "utf8" });
    assert.notEqual(direct.status, 0, row.dest);
    const sand = runInPracticeSandbox(dir, row.cmd, 120_000, { capture: true, nodePath: node, nodeModules: row.modules });
    assert.equal(sand.unsafe, false, row.dest);
    assert.notEqual(sand.code, 0, row.dest);
    gitInit(dir);
    assert.equal(repairBatch13({
      root: dir, output: sand.stdout, sourcePattern: row.pattern, nodePath: node!, nodeModules: row.modules, testCommand: row.cmd,
    }), null, row.dest);
    rmSync(dir, { recursive: true, force: true });
  }
  rmSync(resolve(vitestModules, ".."), { recursive: true, force: true });
  rmSync(resolve(typedModules, ".."), { recursive: true, force: true });
});

test("an any-cast that only matches one recorded answer is test-only for each batch 13 family", (t) => {
  if (!practiceSandboxReady()) { t.skip("bwrap is not installed"); return; }
  const node = visibleNodeBin();
  assert.ok(node);
  for (const symbol of ["parseRgbaString", "getAction", "isSafeNumber"]) {
    const strict = `export function ${symbol}(kind: string): string {\n  return kind === "b" ? "B" : "A";\n}\n`;
    const over = `export function ${symbol}(kind: any): string {\n  return "A";\n}\n`;
    const make = (body: string) => {
      const dir = mkdtempSync(join(tmpdir(), "m264-grade-"));
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

test("the published colord, ultrahtml, and lossless-json checks fail before the repair and pass after, inside the sandbox", (t) => {
  if (!practiceSandboxReady()) { t.skip("bwrap is not installed"); return; }
  const node = visibleNodeBin();
  assert.ok(node);
  const tsx = [node!, "node_modules/tsx/dist/cli.mjs"];
  const vitestModules = runtimeModules([]);
  const typedModules = runtimeModules(["typescript"]);

  const color = mkdtempSync(join(tmpdir(), "m264-color-"));
  placeMapped(color, COLOR);
  writeFileSync(join(color, "run.cjs"), readFileSync(join(import.meta.dirname, "m264-colord-run.cjs")));
  gitInit(color);
  const ccmd = [node!, "run.cjs"];
  const mixed = runInPracticeSandbox(color, ccmd, 120_000, { capture: true, nodePath: node, nodeModules: typedModules });
  assert.equal(mixed.unsafe, false, mixed.stdout.slice(-400));
  assert.notEqual(mixed.code, 0, mixed.stdout.slice(-700));
  const rgb = repairBatch13({ root: color, output: mixed.stdout, sourcePattern: "^src/colorModels/rgbString\\.ts$", nodePath: node!, nodeModules: typedModules, testCommand: ccmd });
  assert.ok(rgb, mixed.stdout.slice(-900));
  assert.match(rgb!.diff, /commaMatch/);

  const ultra = mkdtempSync(join(tmpdir(), "m264-ultra-"));
  placeMapped(ultra, ULTRA);
  writeFileSync(join(ultra, "package.json"), `{"type":"module"}\n`);
  gitInit(ultra);
  const ucmd = [...tsx, "test/transformers/sanitize.test.ts"];
  const listed = runInPracticeSandbox(ultra, ucmd, 120_000, { capture: true, nodePath: node, nodeModules: vitestModules });
  assert.equal(listed.unsafe, false, listed.stdout.slice(-400));
  assert.notEqual(listed.code, 0, listed.stdout.slice(-700));
  const allow = repairBatch13({ root: ultra, output: listed.stdout, sourcePattern: "^src/transformers/sanitize\\.ts$", nodePath: node!, nodeModules: vitestModules, testCommand: ucmd });
  assert.ok(allow, listed.stdout.slice(-900));
  assert.match(allow!.diff, /'drop' : 'allow'/);

  const loss = mkdtempSync(join(tmpdir(), "m264-loss-"));
  placeMapped(loss, LOSS);
  writeFileSync(join(loss, "package.json"), `{"type":"module"}\n`);
  gitInit(loss);
  const lcmd = [...tsx, "src/utils.test.ts"];
  const unsafe = runInPracticeSandbox(loss, lcmd, 120_000, { capture: true, nodePath: node, nodeModules: vitestModules });
  assert.equal(unsafe.unsafe, false, unsafe.stdout.slice(-400));
  assert.notEqual(unsafe.code, 0, unsafe.stdout.slice(-700));
  const floats = repairBatch13({ root: loss, output: unsafe.stdout, sourcePattern: "^src/utils\\.ts$", nodePath: node!, nodeModules: vitestModules, testCommand: lcmd });
  assert.ok(floats, unsafe.stdout.slice(-900));
  assert.match(floats!.diff, /isSafeInteger/);
  rmSync(color, { recursive: true, force: true });
  rmSync(ultra, { recursive: true, force: true });
  rmSync(loss, { recursive: true, force: true });
  rmSync(resolve(vitestModules, ".."), { recursive: true, force: true });
  rmSync(resolve(typedModules, ".."), { recursive: true, force: true });
});
