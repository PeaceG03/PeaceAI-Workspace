// Batch 5. The small modules are made up.
// The library files are the published parent and the published test, copied unmodified.
// Third-party bytes run only inside the practice sandbox.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { coerceArgValues, coerceCookieValue, preserveUncResolve, repairBatch5 } from "../lib/batch5.ts";
import { gradeBehavior } from "../lib/specgrade.ts";
import { practiceSandboxReady, runInPracticeSandbox, visibleNodeBin } from "../lib/practicemine.ts";

const repoRoot = resolve(import.meta.dirname, "../..");
const fix = resolve(import.meta.dirname, "fixtures/m256");
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

const VITEST = `function eq(a, b) {
  if (Object.is(a, b)) return true;
  if (Array.isArray(a) && Array.isArray(b) && a.length === b.length) {
    for (let i = 0; i < a.length; i++) if (!eq(a[i], b[i])) return false;
    return true;
  }
  if (a && b && typeof a === "object") {
    const ka = Object.keys(a), kb = Object.keys(b);
    return ka.length === kb.length && ka.every((k) => eq(a[k], b[k]));
  }
  return false;
}
function check(actual, expected) {
  const value = typeof expected === "function" ? expected() : expected;
  if (!eq(actual, value)) throw new Error("not equal: " + JSON.stringify(actual) + " !== " + JSON.stringify(value));
}
export const describe = (_n, fn) => fn();
export function it(_n, fn) { fn(); }
it.fails = (_n, fn) => { let threw = false; try { fn(); } catch { threw = true; } if (!threw) throw new Error("expected failure"); };
export const vi = { fn(impl) { return (...args) => (impl ? impl(...args) : undefined); } };
export function expect(actual) {
  return {
    toBe(expected) { if (!Object.is(actual, expected)) throw new Error("not same: " + JSON.stringify(actual)); },
    toEqual(expected) { check(actual, expected); },
    toThrow(expected) {
      let thrown = false, err;
      try { actual(); } catch (e) { thrown = true; err = e; }
      if (!thrown) throw new Error("expected throw");
      const message = err && err.message ? String(err.message) : String(err);
      if (expected instanceof RegExp && !expected.test(message) && !expected.test(String(err))) throw new Error("throw mismatch: " + message);
    },
    not: { toThrow() { try { actual(); } catch (e) { throw new Error("unexpected throw: " + e); } } },
    to: { equal(expected) { check(actual, expected); }, deep: { equal(expected) { check(actual, expected); } } },
  };
}
`;

function runtimeModules(): string {
  const dir = mkdtempSync(join(tmpdir(), "m256-mods-"));
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

test("a null cookie value becomes empty, and a file that is not serialize is refused", () => {
  const next = coerceCookieValue(readFix("cookie-es-serialize.ts.txt"));
  assert.match(next ?? "", /String\(_val \?\? ""\)/);
  assert.match(next ?? "", /typeof _name === "object"/);
  assert.equal(coerceCookieValue(next!), null);
  const bare = `const cookie = { value: String(_val) };\nconst options = typeof _val === "object" ? _val : _opts;\n`;
  assert.equal(coerceCookieValue(bare), null);
});

test("a resolve without a UNC flag keeps the prefix, and one that already has it is refused", () => {
  const next = preserveUncResolve(readFix("pathe-path.ts.txt"));
  assert.match(next ?? "", /resolvedUNC = _UNC_REGEX\.test\(path\)/);
  assert.equal(preserveUncResolve(next!), null);
});

test("a raw argv assignment is coerced, and a file without a type helper is refused", () => {
  const next = coerceArgValues(readFix("citty-parser.ts.txt"));
  assert.match(next ?? "", /value !== "false"/);
  assert.equal(coerceArgValues(`const strings = new Set<string>();\n  // Add parsed values\n  (out as any)[key] = value;\n`), null);
});

const mutantBase = resolve(repoRoot, "peaceai/test/.capability-mutants");
mkdirSync(mutantBase, { recursive: true });
let mutantN = 0;
async function mutant(guard: string) {
  const text = readFileSync(resolve(repoRoot, "peaceai/lib/batch5.ts"), "utf8");
  const lines = text.split("\n");
  const hits = lines.flatMap((line, i) => (line.includes(`// ${guard}`) ? [i] : []));
  assert.equal(hits.length, 1, guard);
  const next = lines.filter((_, i) => i !== hits[0]).join("\n").replace(/from "\.\/([A-Za-z0-9-]+\.ts)"/g, (_m, name: string) => `from ${JSON.stringify(pathToFileURL(resolve(repoRoot, "peaceai/lib", name)).href)}`);
  const out = join(mutantBase, `m256-${mutantN++}.ts`);
  writeFileSync(out, next);
  return import(pathToFileURL(out).href);
}

test("deleting the batch 5 guards admits the near miss, with bwrap and without it", async () => {
  const bareCookie = `const cookie = { value: String(_val) };\nconst options = typeof _val === "object" ? _val : _opts;\n`;
  assert.equal(coerceCookieValue(bareCookie), null);
  const opened = await mutant("cookie-guard:serialize") as { coerceCookieValue: typeof coerceCookieValue; repairBatch5: typeof repairBatch5 };
  assert.match(opened.coerceCookieValue(bareCookie) ?? "", /String\(_val \?\? ""\)/);
  const fixed = preserveUncResolve(readFix("pathe-path.ts.txt"))!;
  assert.equal(preserveUncResolve(fixed), null);
  const unc = await mutant("path-guard:unc") as { preserveUncResolve: typeof preserveUncResolve };
  assert.ok((unc.preserveUncResolve(fixed) ?? "").split("let resolvedUNC").length > 2);
  const bare = `const strings = new Set<string>();\n  // Add parsed values\n  (out as any)[key] = value;\n`;
  assert.equal(coerceArgValues(bare), null);
  const arg = await mutant("arg-guard:typed") as { coerceArgValues: typeof coerceArgValues };
  assert.match(arg.coerceArgValues(bare) ?? "", /value !== "false"/);
  const node = visibleNodeBin();
  assert.ok(node);
  const root = mkdtempSync(join(tmpdir(), "m256-miss-"));
  place(root, { "src/serialize.ts": bareCookie, "run.mjs": "process.exit(0)\n" });
  gitInit(root);
  const missing = repairBatch5({
    root, output: "Error: not equal", sourcePattern: "^src/.+\\.ts$", nodePath: node!, testCommand: [node!, "run.mjs"], bwrap: "/no/such/bwrap",
  });
  assert.equal(missing, null);
  if (practiceSandboxReady()) {
    const admitted = opened.repairBatch5({
      root, output: "Error: not equal", sourcePattern: "^src/.+\\.ts$", nodePath: node!, testCommand: [node!, "run.mjs"],
    });
    assert.match(admitted?.diff ?? "", /_val \?\? ""/);
    assert.equal(repairBatch5({
      root, output: "Error: not equal", sourcePattern: "^src/.+\\.ts$", nodePath: node!, testCommand: [node!, "run.mjs"],
    }), null);
  }
  rmSync(root, { recursive: true, force: true });
});

test("an any-cast that only matches the recorded null cookie is test-only", (t) => {
  if (!practiceSandboxReady()) { t.skip("bwrap is not installed"); return; }
  const node = visibleNodeBin();
  assert.ok(node);
  const strict = `export function serialize(name: string, val: unknown): string {\n  return name + "=" + String(val ?? "");\n}\n`;
  const over = `export function serialize(name: string, val: any): string {\n  return "foo=";\n}\n`;
  const make = (body: string) => {
    const dir = mkdtempSync(join(tmpdir(), "m256-grade-"));
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(join(dir, "src/serialize.ts"), body);
    return dir;
  };
  const left = make(over);
  const right = make(strict);
  try {
    const graded = gradeBehavior({
      candidateRoot: left, fixRoot: right, nodePath: node!,
      target: { symbol: "serialize", file: "src/serialize.ts", form: "named", exportName: "serialize", args: [["foo", null]] },
    });
    assert.equal(graded.behavior, "verified_test_only");
  } finally {
    rmSync(left, { recursive: true, force: true });
    rmSync(right, { recursive: true, force: true });
  }
});

test("the published pathe, citty, and cookie-es checks fail before the repair and pass after, inside the sandbox", (t) => {
  if (!practiceSandboxReady()) { t.skip("bwrap is not installed"); return; }
  const node = visibleNodeBin();
  assert.ok(node);
  const nm = runtimeModules();
  const pathe = mkdtempSync(join(tmpdir(), "m256-pathe-"));
  place(pathe, {
    "src/_path.ts": readFix("pathe-path.ts.txt"),
    "src/_internal.ts": readFix("pathe-internal.ts.txt"),
    "src/_glob.ts": readFix("pathe-glob.ts.txt"),
    "src/index.ts": readFix("pathe-index.ts.txt"),
    "src/utils.ts": readFix("pathe-utils.ts.txt"),
    "test/index.spec.ts": readFix("pathe-index.spec.ts.txt"),
    "package.json": `{ "type": "module" }\n`,
  });
  gitInit(pathe);
  const pcmd = [node!, "node_modules/tsx/dist/cli.mjs", "test/index.spec.ts"];
  const before = runInPracticeSandbox(pathe, pcmd, 60_000, { capture: true, nodePath: node, nodeModules: nm });
  assert.equal(before.unsafe, false, before.stdout);
  assert.notEqual(before.code, 0);
  const repaired = repairBatch5({ root: pathe, output: before.stdout, sourcePattern: "^src/.+\\.ts$", nodePath: node!, nodeModules: nm, testCommand: pcmd });
  assert.ok(repaired, before.stdout.slice(-500));
  assert.match(repaired!.diff, /resolvedUNC/);
  const citty = mkdtempSync(join(tmpdir(), "m256-citty-"));
  place(citty, {
    "src/_parser.ts": readFix("citty-parser.ts.txt"),
    "test/parser.test.ts": readFix("citty-parser.test.ts.txt"),
    "package.json": `{ "type": "module" }\n`,
  });
  gitInit(citty);
  const ccmd = [node!, "node_modules/tsx/dist/cli.mjs", "test/parser.test.ts"];
  const failed = runInPracticeSandbox(citty, ccmd, 60_000, { capture: true, nodePath: node, nodeModules: nm });
  assert.notEqual(failed.code, 0, failed.stdout.slice(-500));
  const coerced = repairBatch5({ root: citty, output: failed.stdout, sourcePattern: "^src/.+\\.ts$", nodePath: node!, nodeModules: nm, testCommand: ccmd });
  assert.ok(coerced, failed.stdout.slice(-800));
  assert.match(coerced!.diff, /value !== "false"/);
  const cookie = mkdtempSync(join(tmpdir(), "m256-cookie-"));
  place(cookie, {
    "src/_utils.ts": readFix("cookie-es-utils.ts.txt"),
    "src/index.ts": readFix("cookie-es-index.ts.txt"),
    "src/cookie/parse.ts": readFix("cookie-es-parse.ts.txt"),
    "src/cookie/serialize.ts": readFix("cookie-es-serialize.ts.txt"),
    "src/cookie/types.ts": readFix("cookie-es-types.ts.txt"),
    "src/set-cookie/parse.ts": readFix("cookie-es-set-parse.ts.txt"),
    "src/set-cookie/split.ts": readFix("cookie-es-set-split.ts.txt"),
    "src/set-cookie/types.ts": readFix("cookie-es-set-types.ts.txt"),
    "test/cookie-serialize.test.ts": readFix("cookie-es-serialize.test.ts.txt"),
    "package.json": `{ "type": "module" }\n`,
  });
  gitInit(cookie);
  const kcmd = [node!, "node_modules/tsx/dist/cli.mjs", "test/cookie-serialize.test.ts"];
  const raw = runInPracticeSandbox(cookie, kcmd, 60_000, { capture: true, nodePath: node, nodeModules: nm });
  assert.notEqual(raw.code, 0, raw.stdout.slice(-800));
  const emptied = repairBatch5({ root: cookie, output: raw.stdout, sourcePattern: "^src/.+\\.ts$", nodePath: node!, nodeModules: nm, testCommand: kcmd });
  assert.ok(emptied, raw.stdout.slice(-800));
  assert.match(emptied!.diff, /_val \?\? ""/);
  rmSync(pathe, { recursive: true, force: true });
  rmSync(citty, { recursive: true, force: true });
  rmSync(cookie, { recursive: true, force: true });
  rmSync(resolve(nm, ".."), { recursive: true, force: true });
});
