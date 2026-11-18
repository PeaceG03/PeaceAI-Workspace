// Batch 13. The library files are the published parent and the published test.
// Third-party bytes run only inside the practice sandbox.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
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

const mutantBase = resolve(repoRoot, "peaceai/test/.capability-mutants");
mkdirSync(mutantBase, { recursive: true });
let mutantN = 0;
async function mutant(guard: string) {
  const text = readFileSync(resolve(repoRoot, "peaceai/lib/batch13.ts"), "utf8");
  const lines = text.split("\n");
  const hits = lines.flatMap((line, i) => (line.includes(`// ${guard}`) ? [i] : []));
  assert.equal(hits.length, 1, guard);
  const next = lines.filter((_, i) => i !== hits[0]).join("\n").replace(/from "\.\/([A-Za-z0-9-]+\.ts)"/g, (_m, name: string) => `from ${JSON.stringify(pathToFileURL(resolve(repoRoot, "peaceai/lib", name)).href)}`);
  const out = join(mutantBase, `m264-${mutantN++}.ts`);
  writeFileSync(out, next);
  return import(pathToFileURL(out).href);
}

test("deleting the batch 13 guards admits the near miss, with bwrap and without it", async () => {
  const otherRgb = readFix("co-src-colorModels-rgbString.ts.txt").replace("export const parseRgbaString", "export const kept");
  assert.equal(mixedRgb(otherRgb), null);
  const rgb = await mutant("rgb-guard:space") as { mixedRgb: typeof mixedRgb; repairBatch13: typeof repairBatch13 };
  assert.match(rgb.mixedRgb(otherRgb) ?? "", /commaMatch/);
  const otherAllow = readFix("uh-sanitize.ts.txt").replace("function getAction(", "function kept(");
  assert.equal(allowList(otherAllow), null);
  const allowed = await mutant("allow-guard:list") as { allowList: typeof allowList; repairBatch13: typeof repairBatch13 };
  assert.match(allowed.allowList(otherAllow) ?? "", /'drop' : 'allow'/);
  const otherSafe = readFix("ll-utils.ts.txt").replace("export function isSafeNumber(", "export function kept(");
  assert.equal(unsafeFloat(otherSafe), null);
  const safe = await mutant("safe-guard:float") as { unsafeFloat: typeof unsafeFloat; repairBatch13: typeof repairBatch13 };
  assert.match(safe.unsafeFloat(otherSafe) ?? "", /isSafeInteger/);
  const node = visibleNodeBin();
  assert.ok(node);
  const root = mkdtempSync(join(tmpdir(), "m264-miss-"));
  mkdirSync(join(root, "src/colorModels"), { recursive: true });
  writeFileSync(join(root, "src/colorModels/rgbString.ts"), readFix("co-src-colorModels-rgbString.ts.txt"));
  writeFileSync(join(root, "run.mjs"), "process.exit(0)\n");
  gitInit(root);
  assert.equal(repairBatch13({
    root, output: "Error: not equal", sourcePattern: "^src/colorModels/rgbString\\.ts$", nodePath: node!, testCommand: [node!, "run.mjs"], bwrap: "/no/such/bwrap",
  }), null);
  if (practiceSandboxReady()) {
    const run = (fn: typeof repairBatch13, dir: string, pattern: string) => fn({
      root: dir, output: "Error: not equal", sourcePattern: pattern, nodePath: node!, testCommand: [node!, "run.mjs"],
    });
    const rgbDir = mkdtempSync(join(tmpdir(), "m264-rgb-"));
    mkdirSync(join(rgbDir, "src/colorModels"), { recursive: true });
    writeFileSync(join(rgbDir, "src/colorModels/rgbString.ts"), otherRgb);
    writeFileSync(join(rgbDir, "run.mjs"), "process.exit(0)\n");
    gitInit(rgbDir);
    assert.equal(run(repairBatch13, rgbDir, "^src/colorModels/rgbString\\.ts$"), null);
    assert.match(run(rgb.repairBatch13, rgbDir, "^src/colorModels/rgbString\\.ts$")?.diff ?? "", /commaMatch/);
    const allowDir = mkdtempSync(join(tmpdir(), "m264-allow-"));
    mkdirSync(join(allowDir, "src/transformers"), { recursive: true });
    writeFileSync(join(allowDir, "src/transformers/sanitize.ts"), otherAllow);
    writeFileSync(join(allowDir, "run.mjs"), "process.exit(0)\n");
    gitInit(allowDir);
    assert.equal(run(repairBatch13, allowDir, "^src/transformers/sanitize\\.ts$"), null);
    assert.match(run(allowed.repairBatch13, allowDir, "^src/transformers/sanitize\\.ts$")?.diff ?? "", /drop/);
    const safeDir = mkdtempSync(join(tmpdir(), "m264-safe-"));
    mkdirSync(join(safeDir, "src"), { recursive: true });
    writeFileSync(join(safeDir, "src/utils.ts"), otherSafe);
    writeFileSync(join(safeDir, "run.mjs"), "process.exit(0)\n");
    gitInit(safeDir);
    assert.equal(run(repairBatch13, safeDir, "^src/utils\\.ts$"), null);
    assert.match(run(safe.repairBatch13, safeDir, "^src/utils\\.ts$")?.diff ?? "", /isSafeInteger/);
    rmSync(rgbDir, { recursive: true, force: true });
    rmSync(allowDir, { recursive: true, force: true });
    rmSync(safeDir, { recursive: true, force: true });
  }
  rmSync(root, { recursive: true, force: true });
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
