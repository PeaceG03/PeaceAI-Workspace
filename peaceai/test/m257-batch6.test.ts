// Batch 6. The small modules are made up.
// The library files are the published parent and the published test, copied unmodified except
// that this file does not add personal data. Third-party bytes run only inside the practice sandbox.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { copyHooksBeforeCall, nullTryUse, plainAugmentation, repairBatch6 } from "../lib/batch6.ts";
import { gradeBehavior } from "../lib/specgrade.ts";
import { practiceSandboxReady, runInPracticeSandbox, visibleNodeBin } from "../lib/practicemine.ts";

const repoRoot = resolve(import.meta.dirname, "../..");
const fix = resolve(import.meta.dirname, "fixtures/m257");
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
function matchThrow(err, expected) {
  if (expected === undefined) return;
  if (expected instanceof RegExp) {
    const message = err && err.message ? String(err.message) : String(err);
    if (!expected.test(message) && !expected.test(String(err))) throw new Error("throw mismatch: " + message);
    return;
  }
  if (typeof expected === "string") {
    const message = err && err.message ? String(err.message) : String(err);
    if (!message.includes(expected)) throw new Error("throw mismatch: " + message);
    return;
  }
  if (err !== expected && (!err || !expected || err.message !== expected.message)) throw new Error("throw mismatch: " + err);
}
const jobs = [];
const stack = [[]];
export function describe(_n, fn) { const local = []; stack.push(local); fn(); stack.pop(); }
export function test(_n, fn) {
  const setup = stack.flat();
  jobs.push(async () => { for (const b of setup) await b(); await fn(); });
}
export function beforeEach(fn) { stack[stack.length - 1].push(fn); }
const it = test;
it.runIf = (cond) => (cond ? test : () => {});
export { it };
export const vi = { fn(impl) { const f = (...args) => { f.mock.calls.push(args); return impl ? impl(...args) : undefined; }; f.mock = { calls: [] }; return f; } };
function calledWith(actual, args) {
  const calls = actual && actual.mock ? actual.mock.calls : [];
  if (!calls.some((c) => eq(c, args))) throw new Error("not called with");
}
export function expect(actual) {
  return {
    toBe(expected) { if (!Object.is(actual, expected)) throw new Error("not same: " + JSON.stringify(actual)); },
    toEqual(expected) { if (!eq(actual, expected)) throw new Error("not equal: " + JSON.stringify(actual)); },
    toBeUndefined() { if (actual !== undefined) throw new Error("not undefined"); },
    toBeInstanceOf(ctor) { if (!(actual instanceof ctor)) throw new Error("not instance"); },
    toHaveLength(n) { if (!actual || actual.length !== n) throw new Error("length"); },
    toBeCalledWith(...args) { calledWith(actual, args); },
    toBeCalledTimes(n) { const calls = actual && actual.mock ? actual.mock.calls.length : 0; if (calls !== n) throw new Error("call count " + calls); },
    toHaveBeenCalledOnce() { this.toBeCalledTimes(1); },
    toMatchObject(expected) { if (!eq(actual, expected)) throw new Error("not match"); },
    toThrow(expected) { let threw = false, err; try { actual(); } catch (e) { threw = true; err = e; } if (!threw) throw new Error("expected throw"); matchThrow(err, expected); },
    toThrowError(expected) { this.toThrow(expected); },
    to: { equal(expected) { if (!eq(actual, expected)) throw new Error("not equal: " + JSON.stringify(actual)); } },
    rejects: { async toThrow(expected) { let threw = false, err; try { await (typeof actual === "function" ? actual() : actual); } catch (e) { threw = true; err = e; } if (!threw) throw new Error("expected rejection"); matchThrow(err, expected); } },
    not: {
      toThrow() { try { actual(); } catch (e) { throw new Error("unexpected throw: " + e); } },
      toBeCalled() { const calls = actual && actual.mock ? actual.mock.calls.length : 0; if (calls !== 0) throw new Error("was called"); },
    },
  };
}
expect.any = (ctor) => ({ __any: ctor });
queueMicrotask(async () => {
  try { for (const job of jobs) await job(); }
  catch (e) { writeSync(1, "Error: " + (e && e.stack ? e.stack : e) + "\\n"); process.exit(1); }
});
`;

function runtimeModules(): string {
  const dir = mkdtempSync(join(tmpdir(), "m257-mods-"));
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

test("a module augmentation drops commas, and a call that is not that generator is refused", () => {
  const next = plainAugmentation(readFix("knitwork-typescript.ts.txt"));
  assert.match(next ?? "", /false,/);
  assert.equal(plainAugmentation(next!), null);
  const other = readFix("knitwork-typescript.ts.txt").replace("export function genAugmentation(", "function kept(");
  assert.equal(plainAugmentation(other), null);
});

test("a hook list is copied when the file splices it, and a list that is not spliced is refused", () => {
  const next = copyHooksBeforeCall(readFix("hookable-core.ts.txt"));
  assert.match(next ?? "", /hooks\.slice\(\)/);
  assert.equal(copyHooksBeforeCall(next!), null);
  const bare = readFix("hookable-core.ts.txt").replaceAll("hooks.splice(index, 1)", "list.copy(index, 1)");
  assert.equal(copyHooksBeforeCall(bare), null);
});

test("an empty context becomes null, and a return that is not tryUse is refused", () => {
  const next = nullTryUse(readFix("unctx-index.ts.txt"));
  assert.match(next ?? "", /_getCurrentInstance\(\) \?\? null/);
  assert.equal(nullTryUse(next!), null);
  const bare = readFix("unctx-index.ts.txt").replaceAll("tryUse: () =>", "read: () =>");
  assert.equal(nullTryUse(bare), null);
});

test("deleting the new line is killed by the published check, in-process and inside bwrap", (t) => {
  if (!practiceSandboxReady()) { t.skip("bwrap is not installed"); return; }
  const node = visibleNodeBin();
  assert.ok(node);
  const nm = runtimeModules();
  const rows: { dest: string; files: Record<string, string>; pattern: string; cmd: string[]; fix: (text: string) => string | null; break: (text: string) => string }[] = [
    {
      dest: "src/typescript.ts",
      files: {
        "src/_utils.ts": readFix("knitwork-utils-internal.ts.txt"),
        "src/esm.ts": readFix("knitwork-esm.ts.txt"),
        "src/index.ts": readFix("knitwork-index.ts.txt"),
        "src/object.ts": readFix("knitwork-object.ts.txt"),
        "src/string.ts": readFix("knitwork-string.ts.txt"),
        "src/types.ts": readFix("knitwork-types.ts.txt"),
        "src/typescript.ts": readFix("knitwork-typescript.ts.txt"),
        "src/utils.ts": readFix("knitwork-utils.ts.txt"),
        "test/_utils.ts": readFix("knitwork-test-utils.ts.txt"),
        "test/typescript.test.ts": readFix("knitwork-typescript.test.ts.txt"),
        "package.json": `{ "type": "module" }\n`,
      },
      pattern: "^src/.+\\.ts$",
      cmd: [node!, "node_modules/tsx/dist/cli.mjs", "test/typescript.test.ts"],
      fix: plainAugmentation,
      break: (text) => text.replace("    undefined,\n    undefined,\n    false,\n", "    undefined,\n    undefined,\n    true,\n"),
    },
    {
      dest: "src/hookable.ts",
      files: {
        "src/debugger.ts": readFix("hookable-debugger.ts.txt"),
        "src/hookable.ts": readFix("hookable-core.ts.txt"),
        "src/index.ts": readFix("hookable-index.ts.txt"),
        "src/types.ts": readFix("hookable-types.ts.txt"),
        "src/utils.ts": readFix("hookable-utils.ts.txt"),
        "test/hookable.test.ts": readFix("hookable-core.test.ts.txt"),
        "package.json": `{ "type": "module" }\n`,
      },
      pattern: "^src/.+\\.ts$",
      cmd: [node!, "node_modules/tsx/dist/cli.mjs", "test/hookable.test.ts"],
      fix: copyHooksBeforeCall,
      break: (text) => text.replace("return callHooks(hooks.slice(), args, 0);", "return callHooks(hooks.slice(1), args, 0);"),
    },
    {
      dest: "src/index.ts",
      files: {
        "src/index.ts": readFix("unctx-index.ts.txt"),
        "test/index.test.ts": readFix("unctx-index.test.ts.txt"),
        "package.json": `{ "type": "module" }\n`,
      },
      pattern: "^src/.+\\.ts$",
      cmd: [node!, "node_modules/tsx/dist/cli.mjs", "test/index.test.ts"],
      fix: nullTryUse,
      break: (text) => text.replace("return _getCurrentInstance() ?? null;", "return _getCurrentInstance() ?? 0;"),
    },
  ];
  for (const row of rows) {
    const fixed = row.fix(row.files[row.dest]!);
    assert.ok(fixed, row.dest);
    const broken = row.break(fixed!);
    assert.notEqual(broken, fixed);
    const dir = mkdtempSync(join(tmpdir(), "m257-kill-"));
    place(dir, { ...row.files, [row.dest]: broken, ".gitignore": "node_modules\n" });
    symlinkSync(nm, join(dir, "node_modules"));
    gitInit(dir);
    const direct = spawnSync(row.cmd[0]!, row.cmd.slice(1), { cwd: dir, encoding: "utf8" });
    assert.notEqual(direct.status, 0, row.dest);
    const sand = runInPracticeSandbox(dir, row.cmd, 60_000, { capture: true, nodePath: node, nodeModules: nm });
    assert.notEqual(sand.code, 0, row.dest);
    assert.equal(repairBatch6({
      root: dir, output: `${direct.stdout}\n${direct.stderr}`, sourcePattern: row.pattern, nodePath: node!, nodeModules: nm, testCommand: row.cmd,
    }), null, row.dest);
    rmSync(dir, { recursive: true, force: true });
  }
  rmSync(resolve(nm, ".."), { recursive: true, force: true });
});

test("an any-cast that only matches the recorded empty context is test-only", (t) => {
  if (!practiceSandboxReady()) { t.skip("bwrap is not installed"); return; }
  const node = visibleNodeBin();
  assert.ok(node);
  const strict = `export function tryUse(kind: string): string {\n  return kind === "b" ? "B" : "A";\n}\n`;
  const over = `export function tryUse(kind: any): string {\n  return "A";\n}\n`;
  const make = (body: string) => {
    const dir = mkdtempSync(join(tmpdir(), "m257-grade-"));
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(join(dir, "src/try-use.ts"), body);
    return dir;
  };
  const left = make(over);
  const right = make(strict);
  try {
    const graded = gradeBehavior({
      candidateRoot: left, fixRoot: right, nodePath: node!,
      target: { symbol: "tryUse", file: "src/try-use.ts", form: "named", exportName: "tryUse", args: [["a"]] },
    });
    assert.equal(graded.behavior, "verified_test_only");
  } finally {
    rmSync(left, { recursive: true, force: true });
    rmSync(right, { recursive: true, force: true });
  }
});

test("the published knitwork, hookable, and unctx checks fail before the repair and pass after, inside the sandbox", (t) => {
  if (!practiceSandboxReady()) { t.skip("bwrap is not installed"); return; }
  const node = visibleNodeBin();
  assert.ok(node);
  const nm = runtimeModules();
  const knit = mkdtempSync(join(tmpdir(), "m257-knit-"));
  place(knit, {
    "src/_utils.ts": readFix("knitwork-utils-internal.ts.txt"),
    "src/esm.ts": readFix("knitwork-esm.ts.txt"),
    "src/index.ts": readFix("knitwork-index.ts.txt"),
    "src/object.ts": readFix("knitwork-object.ts.txt"),
    "src/string.ts": readFix("knitwork-string.ts.txt"),
    "src/types.ts": readFix("knitwork-types.ts.txt"),
    "src/typescript.ts": readFix("knitwork-typescript.ts.txt"),
    "src/utils.ts": readFix("knitwork-utils.ts.txt"),
    "test/_utils.ts": readFix("knitwork-test-utils.ts.txt"),
    "test/typescript.test.ts": readFix("knitwork-typescript.test.ts.txt"),
    "package.json": `{ "type": "module" }\n`,
  });
  gitInit(knit);
  const kcmd = [node!, "node_modules/tsx/dist/cli.mjs", "test/typescript.test.ts"];
  const before = runInPracticeSandbox(knit, kcmd, 60_000, { capture: true, nodePath: node, nodeModules: nm });
  assert.equal(before.unsafe, false, before.stdout);
  assert.notEqual(before.code, 0, before.stdout.slice(-500));
  const augmented = repairBatch6({ root: knit, output: before.stdout, sourcePattern: "^src/.+\\.ts$", nodePath: node!, nodeModules: nm, testCommand: kcmd });
  assert.ok(augmented, before.stdout.slice(-800));
  assert.match(augmented!.diff, /false,/);
  const hookRoot = mkdtempSync(join(tmpdir(), "m257-hookable-"));
  place(hookRoot, {
    "src/debugger.ts": readFix("hookable-debugger.ts.txt"),
    "src/hookable.ts": readFix("hookable-core.ts.txt"),
    "src/index.ts": readFix("hookable-index.ts.txt"),
    "src/types.ts": readFix("hookable-types.ts.txt"),
    "src/utils.ts": readFix("hookable-utils.ts.txt"),
    "test/hookable.test.ts": readFix("hookable-core.test.ts.txt"),
    "package.json": `{ "type": "module" }\n`,
  });
  gitInit(hookRoot);
  const hcmd = [node!, "node_modules/tsx/dist/cli.mjs", "test/hookable.test.ts"];
  const missed = runInPracticeSandbox(hookRoot, hcmd, 60_000, { capture: true, nodePath: node, nodeModules: nm });
  assert.notEqual(missed.code, 0, missed.stdout.slice(-800));
  const copied = repairBatch6({ root: hookRoot, output: missed.stdout, sourcePattern: "^src/.+\\.ts$", nodePath: node!, nodeModules: nm, testCommand: hcmd });
  assert.ok(copied, missed.stdout.slice(-800));
  assert.match(copied!.diff, /hooks\.slice\(\)/);
  const ctxRoot = mkdtempSync(join(tmpdir(), "m257-unctx-"));
  place(ctxRoot, {
    "src/index.ts": readFix("unctx-index.ts.txt"),
    "test/index.test.ts": readFix("unctx-index.test.ts.txt"),
    "package.json": `{ "type": "module" }\n`,
  });
  gitInit(ctxRoot);
  const ccmd = [node!, "node_modules/tsx/dist/cli.mjs", "test/index.test.ts"];
  const empty = runInPracticeSandbox(ctxRoot, ccmd, 60_000, { capture: true, nodePath: node, nodeModules: nm });
  assert.notEqual(empty.code, 0, empty.stdout.slice(-800));
  const nulled = repairBatch6({ root: ctxRoot, output: empty.stdout, sourcePattern: "^src/.+\\.ts$", nodePath: node!, nodeModules: nm, testCommand: ccmd });
  assert.ok(nulled, empty.stdout.slice(-800));
  assert.match(nulled!.diff, /\?\? null/);
  rmSync(knit, { recursive: true, force: true });
  rmSync(hookRoot, { recursive: true, force: true });
  rmSync(ctxRoot, { recursive: true, force: true });
  rmSync(resolve(nm, ".."), { recursive: true, force: true });
});
