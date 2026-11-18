// Batch 14. The library files are the published parent and the published test.
// Third-party bytes run only inside the practice sandbox.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { classOnlyCopy, parentComma, prototypeLoose, repairBatch14, timerChunk } from "../lib/batch14.ts";
import { gradeBehavior } from "../lib/specgrade.ts";
import { practiceSandboxReady, runInPracticeSandbox, visibleNodeBin } from "../lib/practicemine.ts";

const repoRoot = resolve(import.meta.dirname, "../..");
const fix = resolve(import.meta.dirname, "fixtures/m265");
const readFix = (name: string) => readFileSync(join(fix, name), "utf8");
const readHarness = (name: string) => readFileSync(join(import.meta.dirname, name), "utf8");
const modules = resolve(repoRoot, "node_modules");
const layout = JSON.parse(readFileSync(join(import.meta.dirname, "m265-layout.json"), "utf8")) as Record<string, { fixture: string; dest: string }[]>;

function filesOf(group: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const row of layout[group]!) out[row.dest] = readFix(row.fixture);
  return out;
}

function one(group: string, dest: string): string {
  return filesOf(group)[dest]!;
}

function place(root: string, files: Record<string, string>) {
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

function runtimeModules(extra: "vue" | "destr" | "none"): string {
  const dir = mkdtempSync(join(tmpdir(), "m265-mods-"));
  const nm = join(dir, "node_modules");
  mkdirSync(nm);
  for (const name of ["tsx", "esbuild", "@esbuild"]) {
    const copied = spawnSync("cp", ["-a", join(modules, name), join(nm, name)], { stdio: "ignore" });
    assert.equal(copied.status, 0, name);
  }
  mkdirSync(join(nm, "vitest"));
  writeFileSync(join(nm, "vitest/package.json"), `{"type":"module","exports":{".":"./index.js"}}\n`);
  writeFileSync(join(nm, "vitest/index.js"), readHarness("m265-vitest-shim.js"));
  if (extra === "vue") {
    mkdirSync(join(nm, "@vue/reactivity"), { recursive: true });
    writeFileSync(join(nm, "@vue/reactivity/package.json"), `{"type":"module"}\n`);
    writeFileSync(join(nm, "@vue/reactivity/index.js"), `export const ReactiveFlags = { IS_REF: Symbol("IS_REF"), SKIP: Symbol("SKIP") };\n`);
  }
  if (extra === "destr") {
    mkdirSync(join(nm, "destr"));
    writeFileSync(join(nm, "destr/package.json"), `{"type":"module"}\n`);
    writeFileSync(join(nm, "destr/index.js"), `export function destr(value) { if (typeof value !== "string") return value; try { return JSON.parse(value); } catch { return value; } }\n`);
  }
  return nm;
}

test("a prototype-less object is compared with hasOwn, and a check that is not looseEqual is refused", () => {
  const source = one("vue", "packages/shared/src/looseEqual.ts");
  const next = prototypeLoose(source);
  assert.match(next ?? "", /function toComparableString/);
  assert.equal(prototypeLoose(next!), null);
  assert.equal(prototypeLoose(source.replace("export function looseEqual(", "export function keptEqual(")), null);
});

test("a long timer delay is split into chunks, and a check that is not the memory driver is refused", () => {
  const source = one("us", "src/drivers/memory.ts");
  const next = timerChunk(source);
  assert.match(next ?? "", /MAX_TIMER_DELAY/);
  assert.equal(timerChunk(next!), null);
  assert.equal(timerChunk(source.replace("const DRIVER_NAME = \"memory\"", "const DRIVER_NAME = \"kept\"")), null);
});

test("class_only is honored by the constructor, and a check that is not the Immer class is refused", () => {
  const source = one("im", "src/core/immerClass.ts");
  const next = classOnlyCopy(source);
  assert.match(next ?? "", /class_only/);
  assert.equal(classOnlyCopy(next!), null);
  assert.equal(classOnlyCopy(source.replace("export class Immer ", "export class Kept ")), null);
});

test("a trailing comma stays on the parent container, and a check that is not jsonrepair is refused", () => {
  const source = one("jr", "src/regular/jsonrepair.ts");
  const next = parentComma(source);
  assert.match(next ?? "", /if \(!initial\)/);
  assert.equal(parentComma(next!), null);
  assert.equal(parentComma(source.replace("export function jsonrepair(", "export function keptrepair(")), null);
});

test("deleting the new line is killed by the published check, in-process and inside bwrap", (t) => {
  const loose = prototypeLoose(one("vue", "packages/shared/src/looseEqual.ts"));
  const memory = timerChunk(one("us", "src/drivers/memory.ts"));
  const immer = classOnlyCopy(one("im", "src/core/immerClass.ts"));
  const repair = parentComma(one("jr", "src/regular/jsonrepair.ts"));
  assert.ok(loose && memory && immer && repair);
  const mutants: Record<string, string> = {
    "packages/shared/src/looseEqual.ts": loose.replace("  return toComparableString(a) === toComparableString(b)\n", ""),
    "src/drivers/memory.ts": memory.replace("const MAX_TIMER_DELAY = 2 ** 31 - 1;\n", ""),
    "src/core/immerClass.ts": immer.replace("\t\t\tthis.setUseStrictShallowCopy(strictShallowCopy)\n", ""),
    "src/regular/jsonrepair.ts": repair.replace("        initial = false\n      }\n\n      if (text[i] === ']') {\n", "      }\n\n      if (text[i] === ']') {\n"),
  };
  assert.notEqual(mutants["packages/shared/src/looseEqual.ts"], loose);
  assert.notEqual(mutants["src/drivers/memory.ts"], memory);
  assert.notEqual(mutants["src/core/immerClass.ts"], immer);
  assert.notEqual(mutants["src/regular/jsonrepair.ts"], repair);

  const node = visibleNodeBin();
  assert.ok(node);
  const root = mkdtempSync(join(tmpdir(), "m265-miss-"));
  place(root, { "packages/shared/src/looseEqual.ts": one("vue", "packages/shared/src/looseEqual.ts"), "run.mjs": "process.exit(0)\n" });
  gitInit(root);
  assert.equal(repairBatch14({
    root, output: "Error: not equal", sourcePattern: "looseEqual\\.ts$", nodePath: node!, testCommand: [node!, "run.mjs"], bwrap: "/no/such/bwrap",
  }), null);
  if (!practiceSandboxReady()) { rmSync(root, { recursive: true, force: true }); t.skip("bwrap is not installed"); return; }
  const tsx = [node!, "node_modules/tsx/dist/cli.mjs"];
  const mods = { vue: runtimeModules("vue"), destr: runtimeModules("destr"), plain: runtimeModules("none") };
  const cases: { files: Record<string, string>; dest: string; body: string; cmd: string[]; pattern: string; modules: string }[] = [
    {
      files: { ...filesOf("vue"), "package.json": `{"type":"module"}\n`, "dev.mjs": "globalThis.__DEV__ = false;\nglobalThis.__BROWSER__ = false;\n", "run.mjs": "import \"./dev.mjs\";\nimport \"vitest\";\nimport \"./packages/shared/__tests__/looseEqual.spec.ts\";\n" },
      dest: "packages/shared/src/looseEqual.ts", body: mutants["packages/shared/src/looseEqual.ts"]!, cmd: [...tsx, "run.mjs"], pattern: "looseEqual\\.ts$", modules: mods.vue,
    },
    {
      files: { ...filesOf("us"), "package.json": `{"type":"module"}\n` },
      dest: "src/drivers/memory.ts", body: mutants["src/drivers/memory.ts"]!, cmd: [...tsx, "test/drivers/memory.test.ts"], pattern: "memory\\.ts$", modules: mods.destr,
    },
    {
      files: { ...filesOf("im"), "run.mjs": "import \"vitest\";\nimport \"./__tests__/not-strict-copy.ts\";\n" },
      dest: "src/core/immerClass.ts", body: mutants["src/core/immerClass.ts"]!, cmd: [...tsx, "run.mjs"], pattern: "immerClass\\.ts$", modules: mods.plain,
    },
    {
      files: { ...filesOf("jr"), "package.json": `{"type":"module"}\n` },
      dest: "src/regular/jsonrepair.ts", body: mutants["src/regular/jsonrepair.ts"]!, cmd: [...tsx, "src/index.test.ts"], pattern: "jsonrepair\\.ts$", modules: mods.plain,
    },
  ];
  for (const row of cases) {
    const dir = mkdtempSync(join(tmpdir(), "m265-kill-"));
    place(dir, { ...row.files, [row.dest]: row.body, ".gitignore": "node_modules\n" });
    symlinkSync(row.modules, join(dir, "node_modules"));
    const direct = spawnSync(row.cmd[0]!, row.cmd.slice(1), { cwd: dir, encoding: "utf8" });
    assert.notEqual(direct.status, 0, row.dest);
    const sand = runInPracticeSandbox(dir, row.cmd, 120_000, { capture: true, nodePath: node, nodeModules: row.modules });
    assert.equal(sand.unsafe, false, row.dest);
    assert.notEqual(sand.code, 0, row.dest);
    gitInit(dir);
    assert.equal(repairBatch14({
      root: dir, output: sand.stdout, sourcePattern: row.pattern, nodePath: node!, nodeModules: row.modules, testCommand: row.cmd,
    }), null, row.dest);
    rmSync(dir, { recursive: true, force: true });
  }
  rmSync(root, { recursive: true, force: true });
  for (const nm of Object.values(mods)) rmSync(resolve(nm, ".."), { recursive: true, force: true });
});

test("an any-cast that only matches one recorded answer is test-only for each batch 14 family", (t) => {
  if (!practiceSandboxReady()) { t.skip("bwrap is not installed"); return; }
  const node = visibleNodeBin();
  assert.ok(node);
  for (const symbol of ["looseEqual", "driver", "Immer", "jsonrepair"]) {
    const strict = `export function ${symbol}(kind: string): string {\n  return kind === "b" ? "B" : "A";\n}\n`;
    const over = `export function ${symbol}(kind: any): string {\n  return "A";\n}\n`;
    const make = (body: string) => {
      const dir = mkdtempSync(join(tmpdir(), "m265-grade-"));
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

test("the published vue, unstorage, immer, and jsonrepair checks fail before the repair and pass after, inside the sandbox", (t) => {
  if (!practiceSandboxReady()) { t.skip("bwrap is not installed"); return; }
  const node = visibleNodeBin();
  assert.ok(node);
  const tsx = [node!, "node_modules/tsx/dist/cli.mjs"];
  const vueModules = runtimeModules("vue");
  const destrModules = runtimeModules("destr");
  const plainModules = runtimeModules("none");

  const vue = mkdtempSync(join(tmpdir(), "m265-vue-"));
  place(vue, {
    ...filesOf("vue"),
    "package.json": `{"type":"module"}\n`,
    "dev.mjs": "globalThis.__DEV__ = false;\nglobalThis.__BROWSER__ = false;\n",
    "run.mjs": "import \"./dev.mjs\";\nimport \"vitest\";\nimport \"./packages/shared/__tests__/looseEqual.spec.ts\";\n",
  });
  gitInit(vue);
  const vcmd = [...tsx, "run.mjs"];
  const loose = runInPracticeSandbox(vue, vcmd, 120_000, { capture: true, nodePath: node, nodeModules: vueModules });
  assert.equal(loose.unsafe, false, loose.stdout.slice(-400));
  assert.notEqual(loose.code, 0, loose.stdout.slice(-700));
  const prototypes = repairBatch14({ root: vue, output: loose.stdout, sourcePattern: "looseEqual\\.ts$", nodePath: node!, nodeModules: vueModules, testCommand: vcmd });
  assert.ok(prototypes, loose.stdout.slice(-900));
  assert.match(prototypes!.diff, /toComparableString/);

  const storage = mkdtempSync(join(tmpdir(), "m265-us-"));
  place(storage, { ...filesOf("us"), "package.json": `{"type":"module"}\n` });
  gitInit(storage);
  const scmd = [...tsx, "test/drivers/memory.test.ts"];
  const timers = runInPracticeSandbox(storage, scmd, 120_000, { capture: true, nodePath: node, nodeModules: destrModules });
  assert.equal(timers.unsafe, false, timers.stdout.slice(-400));
  assert.notEqual(timers.code, 0, timers.stdout.slice(-700));
  const chunks = repairBatch14({ root: storage, output: timers.stdout, sourcePattern: "memory\\.ts$", nodePath: node!, nodeModules: destrModules, testCommand: scmd });
  assert.ok(chunks, timers.stdout.slice(-900));
  assert.match(chunks!.diff, /MAX_TIMER_DELAY/);

  const immer = mkdtempSync(join(tmpdir(), "m265-im-"));
  place(immer, {
    ...filesOf("im"),
    "run.mjs": "import \"vitest\";\nimport \"./__tests__/not-strict-copy.ts\";\n",
  });
  gitInit(immer);
  const icmd = [...tsx, "run.mjs"];
  const classes = runInPracticeSandbox(immer, icmd, 120_000, { capture: true, nodePath: node, nodeModules: plainModules });
  assert.equal(classes.unsafe, false, classes.stdout.slice(-400));
  assert.notEqual(classes.code, 0, classes.stdout.slice(-700));
  const options = repairBatch14({ root: immer, output: classes.stdout, sourcePattern: "immerClass\\.ts$", nodePath: node!, nodeModules: plainModules, testCommand: icmd });
  assert.ok(options, classes.stdout.slice(-900));
  assert.match(options!.diff, /class_only/);

  const repair = mkdtempSync(join(tmpdir(), "m265-jr-"));
  place(repair, { ...filesOf("jr"), "package.json": `{"type":"module"}\n` });
  gitInit(repair);
  const jcmd = [...tsx, "src/index.test.ts"];
  const commas = runInPracticeSandbox(repair, jcmd, 120_000, { capture: true, nodePath: node, nodeModules: plainModules });
  assert.equal(commas.unsafe, false, commas.stdout.slice(-400));
  assert.notEqual(commas.code, 0, commas.stdout.slice(-700));
  const parents = repairBatch14({ root: repair, output: commas.stdout, sourcePattern: "jsonrepair\\.ts$", nodePath: node!, nodeModules: plainModules, testCommand: jcmd });
  assert.ok(parents, commas.stdout.slice(-900));
  assert.match(parents!.diff, /if \(!initial\)/);

  rmSync(vue, { recursive: true, force: true });
  rmSync(storage, { recursive: true, force: true });
  rmSync(immer, { recursive: true, force: true });
  rmSync(repair, { recursive: true, force: true });
  rmSync(resolve(vueModules, ".."), { recursive: true, force: true });
  rmSync(resolve(destrModules, ".."), { recursive: true, force: true });
  rmSync(resolve(plainModules, ".."), { recursive: true, force: true });
});
