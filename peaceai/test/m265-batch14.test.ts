// Batch 14. The library files are the published parent and the published test.
// Third-party bytes run only inside the practice sandbox.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
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

const mutantBase = resolve(repoRoot, "peaceai/test/.capability-mutants");
mkdirSync(mutantBase, { recursive: true });
let mutantN = 0;
async function mutant(guard: string) {
  const text = readFileSync(resolve(repoRoot, "peaceai/lib/batch14.ts"), "utf8");
  const lines = text.split("\n");
  const hits = lines.flatMap((line, i) => (line.includes(`// ${guard}`) ? [i] : []));
  assert.equal(hits.length, 1, guard);
  const next = lines.filter((_, i) => i !== hits[0]).join("\n").replace(/from "\.\/([A-Za-z0-9-]+\.ts)"/g, (_m, name: string) => `from ${JSON.stringify(pathToFileURL(resolve(repoRoot, "peaceai/lib", name)).href)}`);
  const out = join(mutantBase, `m265-${mutantN++}.ts`);
  writeFileSync(out, next);
  return import(pathToFileURL(out).href);
}

test("deleting the batch 14 guards admits the near miss, with bwrap and without it", async () => {
  const loose = one("vue", "packages/shared/src/looseEqual.ts");
  const otherLoose = loose.replace("export function looseEqual(", "export function keptEqual(");
  assert.equal(prototypeLoose(otherLoose), null);
  const looseMut = await mutant("loose-guard:prototype") as { prototypeLoose: typeof prototypeLoose; repairBatch14: typeof repairBatch14 };
  assert.match(looseMut.prototypeLoose(otherLoose) ?? "", /toComparableString/);

  const memory = one("us", "src/drivers/memory.ts");
  const otherMemory = memory.replace("const DRIVER_NAME = \"memory\"", "const DRIVER_NAME = \"kept\"");
  assert.equal(timerChunk(otherMemory), null);
  const timerMut = await mutant("timer-guard:chunk") as { timerChunk: typeof timerChunk; repairBatch14: typeof repairBatch14 };
  assert.match(timerMut.timerChunk(otherMemory) ?? "", /MAX_TIMER_DELAY/);

  const immer = one("im", "src/core/immerClass.ts");
  const otherImmer = immer.replace("export class Immer ", "export class Kept ");
  assert.equal(classOnlyCopy(otherImmer), null);
  const classMut = await mutant("class-guard:option") as { classOnlyCopy: typeof classOnlyCopy; repairBatch14: typeof repairBatch14 };
  assert.match(classMut.classOnlyCopy(otherImmer) ?? "", /class_only/);

  const repair = one("jr", "src/regular/jsonrepair.ts");
  const otherRepair = repair.replace("export function jsonrepair(", "export function keptrepair(");
  assert.equal(parentComma(otherRepair), null);
  const commaMut = await mutant("comma-guard:parent") as { parentComma: typeof parentComma; repairBatch14: typeof repairBatch14 };
  assert.match(commaMut.parentComma(otherRepair) ?? "", /if \(!initial\)/);

  const node = visibleNodeBin();
  assert.ok(node);
  const root = mkdtempSync(join(tmpdir(), "m265-miss-"));
  place(root, { "packages/shared/src/looseEqual.ts": loose, "run.mjs": "process.exit(0)\n" });
  gitInit(root);
  assert.equal(repairBatch14({
    root, output: "Error: not equal", sourcePattern: "looseEqual\\.ts$", nodePath: node!, testCommand: [node!, "run.mjs"], bwrap: "/no/such/bwrap",
  }), null);
  if (practiceSandboxReady()) {
    const run = (fn: typeof repairBatch14, dir: string, pattern: string) => fn({
      root: dir, output: "Error: not equal", sourcePattern: pattern, nodePath: node!, testCommand: [node!, "run.mjs"],
    });
    const cases: [typeof repairBatch14, string, string, string, RegExp][] = [
      [looseMut.repairBatch14, "packages/shared/src/looseEqual.ts", otherLoose, "looseEqual\\.ts$", /toComparableString/],
      [timerMut.repairBatch14, "src/drivers/memory.ts", otherMemory, "memory\\.ts$", /MAX_TIMER_DELAY/],
      [classMut.repairBatch14, "src/core/immerClass.ts", otherImmer, "immerClass\\.ts$", /class_only/],
      [commaMut.repairBatch14, "src/regular/jsonrepair.ts", otherRepair, "jsonrepair\\.ts$", /if \(!initial\)/],
    ];
    for (const [fn, dest, body, pattern, mark] of cases) {
      const dir = mkdtempSync(join(tmpdir(), "m265-near-"));
      place(dir, { [dest]: body, "run.mjs": "process.exit(0)\n" });
      gitInit(dir);
      assert.equal(run(repairBatch14, dir, pattern), null);
      assert.match(run(fn, dir, pattern)?.diff ?? "", mark);
      rmSync(dir, { recursive: true, force: true });
    }
  }
  rmSync(root, { recursive: true, force: true });
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
