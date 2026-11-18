// Batch 8. The library files are the published parent and the published test.
// Third-party bytes run only inside the practice sandbox.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { compareAnyKey, freshMeasurements, quoteAstralName, repairBatch8 } from "../lib/batch8.ts";
import { gradeBehavior } from "../lib/specgrade.ts";
import { practiceSandboxReady, runInPracticeSandbox, visibleNodeBin } from "../lib/practicemine.ts";

const repoRoot = resolve(import.meta.dirname, "../..");
const fix = resolve(import.meta.dirname, "fixtures/m259");
const readFix = (name: string) => readFileSync(join(fix, name), "utf8");
const modules = resolve(repoRoot, "node_modules");

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

const VITEST = `import { writeSync } from "node:fs";
function eq(a, b) {
  if (b && b.__any) return b.__any === Function ? typeof a === "function" : a instanceof b.__any;
  if (Object.is(a, b)) return true;
  if (typeof a === "number" && typeof b === "number" && Number.isNaN(a) && Number.isNaN(b)) return true;
  if (a instanceof Error && b instanceof Error) return a.name === b.name && a.message === b.message;
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
    let value, threw = false, err;
    try { value = impl ? impl.apply(this, args) : undefined; }
    catch (e) { threw = true; err = e; }
    wrapped.mock.calls.push(args);
    if (threw) throw err;
    return value;
  };
  wrapped.mock = { calls: [] };
  wrapped.mockClear = () => { wrapped.mock.calls.length = 0; };
  return wrapped;
}
function matchThrow(err, expected) {
  if (expected === undefined) return;
  const message = err && err.message ? String(err.message) : String(err);
  if (expected instanceof RegExp) { if (!expected.test(message)) throw new Error("throw mismatch: " + message); return; }
  if (typeof expected === "string") { if (!message.includes(expected)) throw new Error("throw mismatch: " + message); return; }
  if (expected instanceof Error) { if (!err || err.name !== expected.name || err.message !== expected.message) throw new Error("throw mismatch: " + message); return; }
}
function assertThrow(actual, expected) {
  let threw = false, err;
  try { if (typeof actual === "function") actual(); else throw new Error("not a function"); }
  catch (e) { threw = true; err = e; }
  if (!threw) throw new Error("expected throw");
  matchThrow(err, expected);
}
const jobs = [];
const stack = [[]];
export function describe(_n, fn) { const local = []; stack.push(local); fn(); stack.pop(); }
export function test(_n, fn) {
  const setup = stack.flat();
  jobs.push(async () => { for (const b of setup) await b(); await fn(); });
}
export function beforeEach(fn) { stack[stack.length - 1].push(fn); }
function each(register) {
  return (cases) => (name, fn) => {
    for (const item of cases) register(String(name), () => fn(item));
  };
}
describe.each = each(describe);
export const it = test;
it.each = each(it);
test.each = each(test);
const stubs = [];
export const vi = {
  fn(impl) { return track(impl); },
  spyOn(obj, key) { const orig = obj[key]; const spy = track(function (...args) { return orig.apply(this, args); }); obj[key] = spy; return spy; },
  stubGlobal(name, value) {
    stubs.push([name, globalThis[name], Object.prototype.hasOwnProperty.call(globalThis, name)]);
    globalThis[name] = value;
  },
  unstubAllGlobals() {
    while (stubs.length) {
      const [name, value, had] = stubs.pop();
      if (had) globalThis[name] = value;
      else delete globalThis[name];
    }
  },
};
export function expect(actual) {
  const calls = () => actual && actual.mock ? actual.mock.calls : [];
  return {
    toBe(expected) { if (!Object.is(actual, expected)) throw new Error("not same: " + JSON.stringify(actual) + " !== " + JSON.stringify(expected)); },
    toEqual(expected) { if (!eq(actual, expected)) throw new Error("not equal: " + JSON.stringify(actual)); },
    toBeDefined() { if (actual === undefined) throw new Error("not defined"); },
    toBeUndefined() { if (actual !== undefined) throw new Error("not undefined"); },
    toBeNull() { if (actual !== null) throw new Error("not null"); },
    toBeGreaterThan(n) { if (!(actual > n)) throw new Error("not greater"); },
    toBeInstanceOf(ctor) { if (!(actual instanceof ctor)) throw new Error("not instance"); },
    toContain(expected) {
      const ok = typeof actual === "string" ? actual.includes(expected) : Array.isArray(actual) && actual.some((item) => Object.is(item, expected));
      if (!ok) throw new Error("not contain");
    },
    toThrow(expected) { assertThrow(actual, expected); },
    toHaveBeenCalled() { if (!calls().length) throw new Error("not called"); },
    toHaveBeenCalledTimes(n) { if (calls().length !== n) throw new Error("call count " + calls().length); },
    toHaveBeenCalledWith(...args) { if (!calls().some((c) => eq(c, args))) throw new Error("not called with"); },
    toHaveBeenLastCalledWith(...args) { const last = calls()[calls().length - 1]; if (!last || !eq(last, args)) throw new Error("last call"); },
    not: {
      toThrow() { try { if (typeof actual === "function") actual(); } catch (e) { throw new Error("unexpected throw: " + e); } },
      toBe(expected) { if (Object.is(actual, expected)) throw new Error("was same"); },
      toBeNull() { if (actual === null) throw new Error("was null"); },
      toHaveBeenCalled() { if (calls().length) throw new Error("was called"); },
      toContain(expected) {
        const ok = typeof actual === "string" ? actual.includes(expected) : Array.isArray(actual) && actual.some((item) => Object.is(item, expected));
        if (ok) throw new Error("did contain");
      },
    },
  };
}
expect.hasAssertions = () => {};
queueMicrotask(async () => {
  try { for (const job of jobs) await job(); }
  catch (e) { writeSync(1, "Error: " + (e && e.stack ? e.stack : e) + "\\n"); process.exit(1); }
});
`;

const VUE = `export function toValue(v) {
  if (typeof v === "function") return v();
  if (v && typeof v === "object" && "value" in v) return v.value;
  return v;
}
export function computed(getter) { return { get value() { return getter(); } }; }
export function ref(value) { return { value }; }
`;

function runtimeModules(): string {
  const dir = mkdtempSync(join(tmpdir(), "m259-mods-"));
  const nm = join(dir, "node_modules");
  mkdirSync(nm);
  for (const name of ["tsx", "esbuild", "@esbuild"]) {
    const copied = spawnSync("cp", ["-a", join(modules, name), join(nm, name)], { stdio: "ignore" });
    assert.equal(copied.status, 0, name);
  }
  mkdirSync(join(nm, "vitest"));
  writeFileSync(join(nm, "vitest/package.json"), `{"name":"vitest","type":"module","exports":{".":"./index.js"}}\n`);
  writeFileSync(join(nm, "vitest/index.js"), VITEST);
  mkdirSync(join(nm, "vue"));
  writeFileSync(join(nm, "vue/package.json"), `{"name":"vue","type":"module","exports":{".":"./index.js"}}\n`);
  writeFileSync(join(nm, "vue/index.js"), VUE);
  return nm;
}

test("an astral ID_Continue character quotes the name, and a check that is not stringifyName is refused", () => {
  const next = quoteAstralName(readFix("p2r-index.ts.txt"));
  assert.match(next ?? "", /const \[first = ""\] = next\.value/);
  assert.equal(quoteAstralName(next!), null);
  assert.equal(quoteAstralName(readFix("p2r-index.ts.txt").replace("function stringifyName(", "function kept(")), null);
});

test("a non-function key is a property name, and a check that is not useArrayDifference is refused", () => {
  const next = compareAnyKey(readFix("vueuse-array-difference.ts.txt"));
  assert.match(next ?? "", /typeof compareFn !== 'function'/);
  assert.equal(compareAnyKey(next!), null);
  assert.equal(compareAnyKey(readFix("vueuse-array-difference.ts.txt").replaceAll("useArrayDifference", "kept")), null);
});

test("an offset reads fresh measurements, and a cache read that is not getOffsetForIndex is refused", () => {
  const next = freshMeasurements(readFix("virtual-core-index.ts.txt"));
  assert.match(next ?? "", /getMeasurements\(\)\[index\]/);
  assert.equal(freshMeasurements(next!), null);
  assert.equal(freshMeasurements(readFix("virtual-core-index.ts.txt").replace("getOffsetForIndex =", "kept =")), null);
});

test("deleting the new line is killed by the published check, in-process and inside bwrap", (t) => {
  if (!practiceSandboxReady()) { t.skip("bwrap is not installed"); return; }
  const node = visibleNodeBin();
  assert.ok(node);
  const nm = runtimeModules();
  const rows: { dest: string; files: Record<string, string>; pattern: string; cmd: string[]; fix: (text: string) => string | null; break: (text: string) => string }[] = [
    {
      dest: "src/index.ts",
      files: {
        "src/index.ts": readFix("p2r-index.ts.txt"),
        "src/cases.spec.ts": readFix("p2r-cases.spec.ts.txt"),
        "src/index.spec.ts": readFix("p2r-index.spec.ts.txt"),
        "package.json": `{ "type": "module" }\n`,
      },
      pattern: "^src/.+\\.ts$",
      cmd: [node!, "node_modules/tsx/dist/cli.mjs", "src/index.spec.ts"],
      fix: quoteAstralName,
      break: (text) => text.replace('    const [first = ""] = next.value;\n', ""),
    },
    {
      dest: "index.ts",
      files: {
        "index.ts": readFix("vueuse-array-difference.ts.txt"),
        "index.test.ts": readFix("vueuse-array-difference.test.ts.txt"),
        "package.json": `{ "type": "module" }\n`,
      },
      pattern: "index\\.ts$",
      cmd: [node!, "node_modules/tsx/dist/cli.mjs", "index.test.ts"],
      fix: compareAnyKey,
      break: (text) => text.replace("if (typeof compareFn !== 'function') {", "if (typeof compareFn === 'boolean') {"),
    },
    {
      dest: "packages/virtual-core/src/index.ts",
      files: {
        "packages/virtual-core/src/index.ts": readFix("virtual-core-index.ts.txt"),
        "packages/virtual-core/src/utils.ts": readFix("virtual-core-utils.ts.txt"),
        "packages/virtual-core/src/ios-gesture.ts": readFix("virtual-core-ios-gesture.ts.txt"),
        "packages/virtual-core/src/scroll-classifier.ts": readFix("virtual-core-scroll-classifier.ts.txt"),
        "packages/virtual-core/src/lazy-measurements.ts": readFix("virtual-core-lazy-measurements.ts.txt"),
        "packages/virtual-core/tests/measurement.test.ts": readFix("virtual-core-measurement.test.ts.txt"),
        "package.json": `{ "type": "module" }\n`,
      },
      pattern: "^packages/virtual-core/src/.+\\.ts$",
      cmd: [node!, "node_modules/tsx/dist/cli.mjs", "packages/virtual-core/tests/measurement.test.ts"],
      fix: freshMeasurements,
      break: (text) => text.replace("this.getMeasurements()[index]", "this.getSize()[index]"),
    },
  ];
  for (const row of rows) {
    const fixed = row.fix(row.files[row.dest]!);
    assert.ok(fixed, row.dest);
    const broken = row.break(fixed!);
    assert.notEqual(broken, fixed);
    const dir = mkdtempSync(join(tmpdir(), "m259-kill-"));
    place(dir, { ...row.files, [row.dest]: broken, ".gitignore": "node_modules\n" });
    symlinkSync(nm, join(dir, "node_modules"));
    gitInit(dir);
    const direct = spawnSync(row.cmd[0]!, row.cmd.slice(1), { cwd: dir, encoding: "utf8" });
    assert.notEqual(direct.status, 0, `${row.dest}\n${direct.stdout}\n${direct.stderr}`.slice(-800));
    const sand = runInPracticeSandbox(dir, row.cmd, 120_000, { capture: true, nodePath: node, nodeModules: nm });
    assert.notEqual(sand.code, 0, row.dest);
    assert.equal(repairBatch8({
      root: dir, output: `${direct.stdout}\n${direct.stderr}`, sourcePattern: row.pattern, nodePath: node!, nodeModules: nm, testCommand: row.cmd,
    }), null, row.dest);
    rmSync(dir, { recursive: true, force: true });
  }
  rmSync(resolve(nm, ".."), { recursive: true, force: true });
});

test("an any-cast that only matches one recorded answer is test-only for each batch 8 family", (t) => {
  if (!practiceSandboxReady()) { t.skip("bwrap is not installed"); return; }
  const node = visibleNodeBin();
  assert.ok(node);
  for (const symbol of ["stringifyName", "useArrayDifference", "getOffsetForIndex"]) {
    const strict = `export function ${symbol}(kind: string): string {\n  return kind === "b" ? "B" : "A";\n}\n`;
    const over = `export function ${symbol}(kind: any): string {\n  return "A";\n}\n`;
    const make = (body: string) => {
      const dir = mkdtempSync(join(tmpdir(), "m259-grade-"));
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

test("the published path-to-regexp, vueuse, and virtual checks fail before the repair and pass after, inside the sandbox", (t) => {
  if (!practiceSandboxReady()) { t.skip("bwrap is not installed"); return; }
  const node = visibleNodeBin();
  assert.ok(node);
  const nm = runtimeModules();
  const p2r = mkdtempSync(join(tmpdir(), "m259-p2r-"));
  place(p2r, {
    "src/index.ts": readFix("p2r-index.ts.txt"),
    "src/cases.spec.ts": readFix("p2r-cases.spec.ts.txt"),
    "src/index.spec.ts": readFix("p2r-index.spec.ts.txt"),
    "package.json": `{ "type": "module" }\n`,
  });
  gitInit(p2r);
  const pcmd = [node!, "node_modules/tsx/dist/cli.mjs", "src/index.spec.ts"];
  const named = runInPracticeSandbox(p2r, pcmd, 120_000, { capture: true, nodePath: node, nodeModules: nm });
  assert.equal(named.unsafe, false, named.stdout.slice(-400));
  assert.notEqual(named.code, 0, named.stdout.slice(-700));
  const quoted = repairBatch8({ root: p2r, output: named.stdout, sourcePattern: "^src/.+\\.ts$", nodePath: node!, nodeModules: nm, testCommand: pcmd });
  assert.ok(quoted, named.stdout.slice(-900));
  assert.match(quoted!.diff, /const \[first/);

  const vue = mkdtempSync(join(tmpdir(), "m259-vueuse-"));
  place(vue, {
    "index.ts": readFix("vueuse-array-difference.ts.txt"),
    "index.test.ts": readFix("vueuse-array-difference.test.ts.txt"),
    "package.json": `{ "type": "module" }\n`,
  });
  gitInit(vue);
  const vcmd = [node!, "node_modules/tsx/dist/cli.mjs", "index.test.ts"];
  const keyed = runInPracticeSandbox(vue, vcmd, 60_000, { capture: true, nodePath: node, nodeModules: nm });
  assert.notEqual(keyed.code, 0, keyed.stdout.slice(-700));
  const compared = repairBatch8({ root: vue, output: keyed.stdout, sourcePattern: "index\\.ts$", nodePath: node!, nodeModules: nm, testCommand: vcmd });
  assert.ok(compared, keyed.stdout.slice(-900));
  assert.match(compared!.diff, /!== 'function'/);

  const virt = mkdtempSync(join(tmpdir(), "m259-virtual-"));
  place(virt, {
    "packages/virtual-core/src/index.ts": readFix("virtual-core-index.ts.txt"),
    "packages/virtual-core/src/utils.ts": readFix("virtual-core-utils.ts.txt"),
    "packages/virtual-core/src/ios-gesture.ts": readFix("virtual-core-ios-gesture.ts.txt"),
    "packages/virtual-core/src/scroll-classifier.ts": readFix("virtual-core-scroll-classifier.ts.txt"),
    "packages/virtual-core/src/lazy-measurements.ts": readFix("virtual-core-lazy-measurements.ts.txt"),
    "packages/virtual-core/tests/measurement.test.ts": readFix("virtual-core-measurement.test.ts.txt"),
    "package.json": `{ "type": "module" }\n`,
  });
  gitInit(virt);
  const mcmd = [node!, "node_modules/tsx/dist/cli.mjs", "packages/virtual-core/tests/measurement.test.ts"];
  const stale = runInPracticeSandbox(virt, mcmd, 120_000, { capture: true, nodePath: node, nodeModules: nm });
  assert.notEqual(stale.code, 0, stale.stdout.slice(-800));
  const fresh = repairBatch8({ root: virt, output: stale.stdout, sourcePattern: "^packages/virtual-core/src/.+\\.ts$", nodePath: node!, nodeModules: nm, testCommand: mcmd });
  assert.ok(fresh, stale.stdout.slice(-900));
  assert.match(fresh!.diff, /getMeasurements\(\)/);
  rmSync(p2r, { recursive: true, force: true });
  rmSync(vue, { recursive: true, force: true });
  rmSync(virt, { recursive: true, force: true });
  rmSync(resolve(nm, ".."), { recursive: true, force: true });
});
