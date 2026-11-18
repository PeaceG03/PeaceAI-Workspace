// Batch 7. The library files are the published parent and the published test.
// Third-party bytes run only inside the practice sandbox.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { disposeFailedModel, keepForeignHangul, repairBatch7, strictDateParse } from "../lib/batch7.ts";
import { gradeBehavior } from "../lib/specgrade.ts";
import { practiceSandboxReady, runInPracticeSandbox, visibleNodeBin } from "../lib/practicemine.ts";

const repoRoot = resolve(import.meta.dirname, "../..");
const fix = resolve(import.meta.dirname, "fixtures/m258");
const readFix = (name: string) => readFileSync(join(fix, name), "utf8");
const modules = resolve(repoRoot, "node_modules");

const LAYOUT: Record<string, string> = {
  "tempo-src-__tests__-parse.spec.ts.txt": "src/__tests__/parse.spec.ts",
  "tempo-src-ap.ts.txt": "src/ap.ts",
  "tempo-src-applyOffset.ts.txt": "src/applyOffset.ts",
  "tempo-src-common.ts.txt": "src/common.ts",
  "tempo-src-date.ts.txt": "src/date.ts",
  "tempo-src-deviceLocale.ts.txt": "src/deviceLocale.ts",
  "tempo-src-deviceTZ.ts.txt": "src/deviceTZ.ts",
  "tempo-src-format.ts.txt": "src/format.ts",
  "tempo-src-formatStr.ts.txt": "src/formatStr.ts",
  "tempo-src-fourDigitYear.ts.txt": "src/fourDigitYear.ts",
  "tempo-src-iso8601.ts.txt": "src/iso8601.ts",
  "tempo-src-monthDays.ts.txt": "src/monthDays.ts",
  "tempo-src-monthEnd.ts.txt": "src/monthEnd.ts",
  "tempo-src-offset.ts.txt": "src/offset.ts",
  "tempo-src-parse.ts.txt": "src/parse.ts",
  "tempo-src-parts.ts.txt": "src/parts.ts",
  "tempo-src-range.ts.txt": "src/range.ts",
  "tempo-src-removeOffset.ts.txt": "src/removeOffset.ts",
  "tempo-src-types.ts.txt": "src/types.ts",
  "hangul-src-_internal-constants.ts.txt": "src/_internal/constants.ts",
  "hangul-src-_internal-hangul.ts.txt": "src/_internal/hangul.ts",
  "hangul-src-_internal-index.ts.txt": "src/_internal/index.ts",
  "hangul-src-core-assemble-assemble.spec.ts.txt": "src/core/assemble/assemble.spec.ts",
  "hangul-src-core-assemble-assemble.ts.txt": "src/core/assemble/assemble.ts",
  "hangul-src-core-canBeChoseong-canBeChoseong.ts.txt": "src/core/canBeChoseong/canBeChoseong.ts",
  "hangul-src-core-canBeChoseong-index.ts.txt": "src/core/canBeChoseong/index.ts",
  "hangul-src-core-canBeJongseong-canBeJongseong.ts.txt": "src/core/canBeJongseong/canBeJongseong.ts",
  "hangul-src-core-canBeJongseong-index.ts.txt": "src/core/canBeJongseong/index.ts",
  "hangul-src-core-canBeJungseong-canBeJungseong.ts.txt": "src/core/canBeJungseong/canBeJungseong.ts",
  "hangul-src-core-canBeJungseong-index.ts.txt": "src/core/canBeJungseong/index.ts",
  "hangul-src-core-combineCharacter-combineCharacter.ts.txt": "src/core/combineCharacter/combineCharacter.ts",
  "hangul-src-core-combineCharacter-index.ts.txt": "src/core/combineCharacter/index.ts",
  "hangul-src-core-combineVowels-combineVowels.ts.txt": "src/core/combineVowels/combineVowels.ts",
  "hangul-src-core-combineVowels-index.ts.txt": "src/core/combineVowels/index.ts",
  "hangul-src-core-disassemble-disassemble.ts.txt": "src/core/disassemble/disassemble.ts",
  "hangul-src-core-disassemble-index.ts.txt": "src/core/disassemble/index.ts",
  "hangul-src-core-disassembleCompleteCharacter-disassembleCompleteCharacter.ts.txt": "src/core/disassembleCompleteCharacter/disassembleCompleteCharacter.ts",
  "hangul-src-core-disassembleCompleteCharacter-index.ts.txt": "src/core/disassembleCompleteCharacter/index.ts",
  "hangul-src-core-disassembleToGroups-disassembleToGroups.ts.txt": "src/core/disassembleToGroups/disassembleToGroups.ts",
  "hangul-src-core-disassembleToGroups-index.ts.txt": "src/core/disassembleToGroups/index.ts",
  "hangul-src-core-hasBatchim-hasBatchim.ts.txt": "src/core/hasBatchim/hasBatchim.ts",
  "hangul-src-core-hasBatchim-index.ts.txt": "src/core/hasBatchim/index.ts",
  "hangul-src-core-removeLastCharacter-index.ts.txt": "src/core/removeLastCharacter/index.ts",
  "hangul-src-core-removeLastCharacter-removeLastCharacter.ts.txt": "src/core/removeLastCharacter/removeLastCharacter.ts",
  "signals-core-index.ts.txt": "packages/core/src/index.ts",
  "signals-core.test.tsx.txt": "packages/core/test/signal.test.tsx",
};

function place(root: string, files: Record<string, string>) {
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(root, path, ".."), { recursive: true });
    writeFileSync(join(root, path), content);
  }
}

function placePrefix(root: string, prefix: string) {
  const files: Record<string, string> = {};
  for (const [name, path] of Object.entries(LAYOUT)) {
    if (name.startsWith(prefix)) files[path] = readFix(name);
  }
  place(root, files);
}

function gitInit(root: string) {
  const git = (args: string[]) => spawnSync("git", ["-C", root, ...args], { stdio: "ignore" });
  git(["init", "-q"]);
  git(["add", "-A"]);
  git(["-c", "user.email=t@example.com", "-c", "user.name=t", "commit", "-qm", "base"]);
}

const VITEST = `import { writeSync } from "node:fs";
let seq = 0;
function eq(a, b) {
  if (b && b.__any) return b.__any === Function ? typeof a === "function" : a instanceof b.__any;
  if (Object.is(a, b)) return true;
  if (typeof a === "number" && typeof b === "number" && Number.isNaN(a) && Number.isNaN(b)) return true;
  if (Array.isArray(a) && Array.isArray(b) && a.length === b.length) {
    for (let i = 0; i < a.length; i++) if (!eq(a[i], b[i])) return false;
    return true;
  }
  if (a && b && typeof a === "object" && typeof b === "object") {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of keys) {
      const ha = Object.prototype.hasOwnProperty.call(a, k);
      const hb = Object.prototype.hasOwnProperty.call(b, k);
      if (!ha && b[k] === undefined) continue;
      if (!hb && a[k] === undefined) continue;
      if (!eq(a[k], b[k])) return false;
    }
    return true;
  }
  return false;
}
function track(impl) {
  const wrapped = function (...args) {
    const order = ++seq;
    let value, threw = false, err;
    try { value = impl ? impl.apply(this, args) : undefined; }
    catch (e) { threw = true; err = e; }
    wrapped.mock.calls.push(args);
    wrapped.mock.results.push(threw ? { type: "throw", value: err } : { type: "return", value });
    wrapped.mock.invocationCallOrder.push(order);
    if (threw) throw err;
    return value;
  };
  wrapped.mock = { calls: [], results: [], invocationCallOrder: [] };
  wrapped.mockClear = () => {
    wrapped.mock.calls.length = 0;
    wrapped.mock.results.length = 0;
    wrapped.mock.invocationCallOrder.length = 0;
  };
  return wrapped;
}
function matchThrow(err, expected) {
  if (expected === undefined) return;
  const message = err && err.message ? String(err.message) : String(err);
  if (expected instanceof RegExp) { if (!expected.test(message) && !expected.test(String(err))) throw new Error("throw mismatch: " + message); return; }
  if (typeof expected === "string") { if (!message.includes(expected)) throw new Error("throw mismatch: " + message); return; }
  if (err !== expected && (!err || !expected || err.message !== expected.message)) throw new Error("throw mismatch: " + message);
}
function assertThrow(actual, expected) {
  let threw = false, err;
  try { if (typeof actual === "function") actual(); else throw actual; }
  catch (e) { threw = true; err = e; }
  if (!threw) throw new Error("expected throw");
  matchThrow(err, expected);
}
const jobs = [];
const stack = [[]];
export function describe(_n, fn) { const local = []; stack.push(local); fn(); stack.pop(); }
describe.runIf = (cond) => (cond ? describe : () => {});
export function test(_n, fn) {
  const setup = stack.flat();
  jobs.push(async () => { for (const b of setup) await b(); await fn(); });
}
export function beforeEach(fn) { stack[stack.length - 1].push(fn); }
export const it = test;
it.runIf = (cond) => (cond ? test : () => {});
export const vi = {
  fn(impl) { return track(impl); },
  spyOn(obj, key) {
    const orig = obj[key];
    const spy = track(function (...args) { return orig.apply(this, args); });
    obj[key] = spy;
    return spy;
  },
};
export function expect(actual) {
  const api = {
    equal(expected) { if (!eq(actual, expected)) throw new Error("not equal: " + JSON.stringify(actual)); },
    toBe(expected) { if (!Object.is(actual, expected)) throw new Error("not same: " + JSON.stringify(actual)); },
    toEqual(expected) { this.equal(expected); },
    toThrow(expected) { assertThrow(actual, expected); },
    toThrowError(expected) { assertThrow(actual, expected); },
    toHaveBeenCalled() { if (!actual.mock || actual.mock.calls.length === 0) throw new Error("not called"); },
    toHaveBeenCalledOnce() { this.toHaveBeenCalledTimes(1); },
    toHaveBeenCalledTimes(n) { const calls = actual && actual.mock ? actual.mock.calls.length : 0; if (calls !== n) throw new Error("call count " + calls); },
    toHaveBeenCalledWith(...args) { const calls = actual && actual.mock ? actual.mock.calls : []; if (!calls.some((c) => eq(c, args))) throw new Error("not called with"); },
    toHaveBeenCalledBefore(other) {
      const a = actual.mock.invocationCallOrder[0], b = other.mock.invocationCallOrder[0];
      if (!(a < b)) throw new Error("call order");
    },
    toReturnWith(expected) {
      const last = actual.mock.results[actual.mock.results.length - 1];
      if (!last || last.type !== "return" || !eq(last.value, expected)) throw new Error("return mismatch");
    },
  };
  api.to = {
    equal: (expected) => api.equal(expected),
    be: {
      instanceOf(ctor) { if (!(actual instanceof ctor)) throw new Error("not instance"); },
      a(kind) { if (typeof actual !== kind) throw new Error("not a " + kind); },
      get undefined() { if (actual !== undefined) throw new Error("not undefined"); },
    },
    deep: { equal: (expected) => api.equal(expected) },
    have: { property(name) { if (actual == null || !(name in actual)) throw new Error("missing " + name); } },
    throw: (expected) => assertThrow(actual, expected),
    not: { throw: () => { try { if (typeof actual === "function") actual(); } catch (e) { throw new Error("unexpected throw: " + e); } } },
  };
  api.not = {
    toHaveBeenCalled() { const calls = actual && actual.mock ? actual.mock.calls.length : 0; if (calls !== 0) throw new Error("was called"); },
    to: {
      throw: () => api.to.not.throw(),
      be: { get undefined() { if (actual === undefined) throw new Error("was undefined"); } },
    },
  };
  return api;
}
expect.any = (ctor) => ({ __any: ctor });
queueMicrotask(async () => {
  try { for (const job of jobs) await job(); }
  catch (e) { writeSync(1, "Error: " + (e && e.stack ? e.stack : e) + "\\n"); process.exit(1); }
});
`;

const HANGUL_RUN = VITEST.slice(0, VITEST.lastIndexOf("queueMicrotask")) + `globalThis.describe = describe;
globalThis.it = it;
globalThis.test = test;
globalThis.expect = expect;
await import("./src/core/assemble/assemble.spec.ts");
try { for (const job of jobs) await job(); }
catch (e) { writeSync(1, "Error: " + (e && e.stack ? e.stack : e) + "\\n"); process.exit(1); }
`;

function runtimeModules(): string {
  const dir = mkdtempSync(join(tmpdir(), "m258-mods-"));
  const nm = join(dir, "node_modules");
  mkdirSync(nm);
  for (const name of ["tsx", "esbuild", "@esbuild"]) {
    const copied = spawnSync("cp", ["-a", join(modules, name), join(nm, name)], { stdio: "ignore" });
    assert.equal(copied.status, 0, name);
  }
  mkdirSync(join(nm, "vitest"));
  writeFileSync(join(nm, "vitest/package.json"), `{"name":"vitest","type":"module"}\n`);
  writeFileSync(join(nm, "vitest/index.js"), VITEST);
  return nm;
}

function linkSignals(nm: string, work: string) {
  const dir = join(nm, "@preact", "signals-core");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "package.json"), `{"name":"@preact/signals-core","type":"module","exports":{".":"./index.js"}}\n`);
  writeFileSync(join(dir, "index.js"), `export * from ${JSON.stringify(join(work, "packages/core/src/index.ts"))};\n`);
}

test("a strict date parse rejects a bad separator, and a file that is not parseParts is refused", () => {
  const next = strictDateParse(readFix("tempo-src-parse.ts.txt"));
  assert.match(next ?? "", /normalizeLiteral/);
  assert.equal(strictDateParse(next!), null);
  assert.equal(strictDateParse(readFix("tempo-src-parse.ts.txt").replace("export function parseParts(", "function kept(")), null);
});

test("a non-Hangul character is appended, and a join that is not binaryAssemble is refused", () => {
  const next = keepForeignHangul(readFix("hangul-src-_internal-hangul.ts.txt"));
  assert.match(next ?? "", /isHangulAlphabet\(nextCharacter\)/);
  assert.equal(keepForeignHangul(next!), null);
  assert.equal(keepForeignHangul(readFix("hangul-src-_internal-hangul.ts.txt").replace("export function binaryAssemble(", "export function kept(")), null);
});

test("a failed model disposes captured effects, and a catch that is not createModel is refused", () => {
  const next = disposeFailedModel(readFix("signals-core-index.ts.txt"));
  assert.match(next ?? "", /effects\[i\]\.dispose\(\)/);
  assert.equal(disposeFailedModel(next!), null);
  assert.equal(disposeFailedModel(readFix("signals-core-index.ts.txt").replace("function createModel<", "function kept<")), null);
});

const mutantBase = resolve(repoRoot, "peaceai/test/.capability-mutants");
mkdirSync(mutantBase, { recursive: true });
let mutantN = 0;
async function mutant(guard: string) {
  const text = readFileSync(resolve(repoRoot, "peaceai/lib/batch7.ts"), "utf8");
  const lines = text.split("\n");
  const hits = lines.flatMap((line, i) => (line.includes(`// ${guard}`) ? [i] : []));
  assert.equal(hits.length, 1, guard);
  const next = lines.filter((_, i) => i !== hits[0]).join("\n").replace(/from "\.\/([A-Za-z0-9-]+\.ts)"/g, (_m, name: string) => `from ${JSON.stringify(pathToFileURL(resolve(repoRoot, "peaceai/lib", name)).href)}`);
  const out = join(mutantBase, `m258-${mutantN++}.ts`);
  writeFileSync(out, next);
  return import(pathToFileURL(out).href);
}

test("deleting the batch 7 guards admits the near miss, with bwrap and without it", async () => {
  const otherParse = readFix("tempo-src-parse.ts.txt").replace("export function parseParts(", "function kept(");
  assert.equal(strictDateParse(otherParse), null);
  const opened = await mutant("parse-guard:literal") as { strictDateParse: typeof strictDateParse; repairBatch7: typeof repairBatch7 };
  assert.match(opened.strictDateParse(otherParse) ?? "", /normalizeLiteral/);
  const otherJoin = readFix("hangul-src-_internal-hangul.ts.txt").replace("export function binaryAssemble(", "export function kept(");
  assert.equal(keepForeignHangul(otherJoin), null);
  const hangul = await mutant("hangul-guard:assemble") as { keepForeignHangul: typeof keepForeignHangul; repairBatch7: typeof repairBatch7 };
  assert.match(hangul.keepForeignHangul(otherJoin) ?? "", /isHangulAlphabet\(nextCharacter\)/);
  const otherModel = readFix("signals-core-index.ts.txt").replace("function createModel<", "function kept<");
  assert.equal(disposeFailedModel(otherModel), null);
  const model = await mutant("model-guard:dispose") as { disposeFailedModel: typeof disposeFailedModel; repairBatch7: typeof repairBatch7 };
  assert.match(model.disposeFailedModel(otherModel) ?? "", /effects\[i\]\.dispose\(\)/);
  const node = visibleNodeBin();
  assert.ok(node);
  const root = mkdtempSync(join(tmpdir(), "m258-miss-"));
  place(root, { "src/parse.ts": readFix("tempo-src-parse.ts.txt"), "run.mjs": "process.exit(0)\n" });
  gitInit(root);
  assert.equal(repairBatch7({
    root, output: "Error: not equal", sourcePattern: "^src/.+\\.ts$", nodePath: node!, testCommand: [node!, "run.mjs"], bwrap: "/no/such/bwrap",
  }), null);
  if (practiceSandboxReady()) {
    const run = (fn: typeof repairBatch7, dir: string) => fn({
      root: dir, output: "Error: not equal", sourcePattern: "^src/.+\\.ts$", nodePath: node!, testCommand: [node!, "run.mjs"],
    });
    const parseDir = mkdtempSync(join(tmpdir(), "m258-parse-"));
    place(parseDir, { "src/parse.ts": otherParse, "run.mjs": "process.exit(0)\n" });
    gitInit(parseDir);
    assert.equal(run(repairBatch7, parseDir), null);
    assert.match(run(opened.repairBatch7, parseDir)?.diff ?? "", /normalizeLiteral/);
    const hangulDir = mkdtempSync(join(tmpdir(), "m258-hangul-"));
    place(hangulDir, { "src/hangul.ts": otherJoin, "run.mjs": "process.exit(0)\n" });
    gitInit(hangulDir);
    assert.equal(run(repairBatch7, hangulDir), null);
    assert.match(run(hangul.repairBatch7, hangulDir)?.diff ?? "", /isHangulAlphabet/);
    const modelDir = mkdtempSync(join(tmpdir(), "m258-model-"));
    place(modelDir, { "src/index.ts": otherModel, "run.mjs": "process.exit(0)\n" });
    gitInit(modelDir);
    assert.equal(run(repairBatch7, modelDir), null);
    assert.match(run(model.repairBatch7, modelDir)?.diff ?? "", /dispose\(\)/);
    rmSync(parseDir, { recursive: true, force: true });
    rmSync(hangulDir, { recursive: true, force: true });
    rmSync(modelDir, { recursive: true, force: true });
  }
  rmSync(root, { recursive: true, force: true });
});

function overfit(symbol: string) {
  const strict = `export function ${symbol}(kind: string): string {\n  return kind === "b" ? "B" : "A";\n}\n`;
  const over = `export function ${symbol}(kind: any): string {\n  return "A";\n}\n`;
  const make = (body: string) => {
    const dir = mkdtempSync(join(tmpdir(), "m258-grade-"));
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(join(dir, "src/fn.ts"), body);
    return dir;
  };
  return { strict, over, make };
}

test("an any-cast that only matches one recorded answer is test-only for each batch 7 family", (t) => {
  if (!practiceSandboxReady()) { t.skip("bwrap is not installed"); return; }
  const node = visibleNodeBin();
  assert.ok(node);
  for (const symbol of ["parseDate", "assemble", "createModel"]) {
    const made = overfit(symbol);
    const left = made.make(made.over);
    const right = made.make(made.strict);
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

test("the published tempo, es-hangul, and signals checks fail before the repair and pass after, inside the sandbox", (t) => {
  if (!practiceSandboxReady()) { t.skip("bwrap is not installed"); return; }
  const node = visibleNodeBin();
  assert.ok(node);
  const nm = runtimeModules();
  const savedTz = process.env.TZ;
  process.env.TZ = "America/New_York";
  try {
    const tempo = mkdtempSync(join(tmpdir(), "m258-tempo-"));
    placePrefix(tempo, "tempo-");
    place(tempo, { "package.json": `{ "type": "module" }\n` });
    gitInit(tempo);
    const tcmd = [node!, "node_modules/tsx/dist/cli.mjs", "src/__tests__/parse.spec.ts"];
    const before = runInPracticeSandbox(tempo, tcmd, 120_000, { capture: true, nodePath: node, nodeModules: nm });
    assert.equal(before.unsafe, false, before.stdout.slice(-400));
    assert.notEqual(before.code, 0, before.stdout.slice(-600));
    const parsed = repairBatch7({ root: tempo, output: before.stdout, sourcePattern: "^src/.+\\.ts$", nodePath: node!, nodeModules: nm, testCommand: tcmd });
    assert.ok(parsed, before.stdout.slice(-800));
    assert.match(parsed!.diff, /normalizeLiteral/);

    const hangul = mkdtempSync(join(tmpdir(), "m258-es-hangul-"));
    placePrefix(hangul, "hangul-");
    place(hangul, {
      "package.json": `{ "type": "module" }\n`,
      "tsconfig.json": `{ "compilerOptions": { "baseUrl": ".", "paths": { "@/*": ["src/*"] }, "module": "ESNext", "moduleResolution": "Bundler", "target": "ES2022" } }\n`,
      "run.mjs": HANGUL_RUN,
    });
    gitInit(hangul);
    const hcmd = [node!, "node_modules/tsx/dist/cli.mjs", "run.mjs"];
    const raw = runInPracticeSandbox(hangul, hcmd, 120_000, { capture: true, nodePath: node, nodeModules: nm });
    assert.notEqual(raw.code, 0, raw.stdout.slice(-800));
    const joined = repairBatch7({ root: hangul, output: raw.stdout, sourcePattern: "^src/.+\\.ts$", nodePath: node!, nodeModules: nm, testCommand: hcmd });
    assert.ok(joined, raw.stdout.slice(-800));
    assert.match(joined!.diff, /isHangulAlphabet/);

    const signals = mkdtempSync(join(tmpdir(), "m258-signals-"));
    placePrefix(signals, "signals-");
    place(signals, { "package.json": `{ "type": "module" }\n` });
    linkSignals(nm, signals);
    gitInit(signals);
    const scmd = [node!, "node_modules/tsx/dist/cli.mjs", "packages/core/test/signal.test.tsx"];
    const leaked = runInPracticeSandbox(signals, scmd, 120_000, { capture: true, nodePath: node, nodeModules: nm });
    assert.notEqual(leaked.code, 0, leaked.stdout.slice(-800));
    const disposed = repairBatch7({ root: signals, output: leaked.stdout, sourcePattern: "^packages/core/src/.+\\.ts$", nodePath: node!, nodeModules: nm, testCommand: scmd });
    assert.ok(disposed, leaked.stdout.slice(-800));
    assert.match(disposed!.diff, /effects\[i\]\.dispose\(\)/);
    rmSync(tempo, { recursive: true, force: true });
    rmSync(hangul, { recursive: true, force: true });
    rmSync(signals, { recursive: true, force: true });
  } finally {
    if (savedTz === undefined) delete process.env.TZ;
    else process.env.TZ = savedTz;
    rmSync(resolve(nm, ".."), { recursive: true, force: true });
  }
});
