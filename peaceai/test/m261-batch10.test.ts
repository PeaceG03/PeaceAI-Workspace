// Batch 10. The library files are the published parent and the published test.
// Third-party bytes run only inside the practice sandbox.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { bracketHost, escapeIdent, repairBatch10, resolveMerge } from "../lib/batch10.ts";
import { gradeBehavior } from "../lib/specgrade.ts";
import { practiceSandboxReady, runInPracticeSandbox, visibleNodeBin } from "../lib/practicemine.ts";

const repoRoot = resolve(import.meta.dirname, "../..");
const fix = resolve(import.meta.dirname, "fixtures/m261");
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

function prefixed(prefix: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of readdirSync(fix)) {
    if (!name.startsWith(prefix) || !name.endsWith(".txt")) continue;
    const rel = name.slice(prefix.length, -".txt".length).split("--").join("/");
    out[rel] = readFix(name);
  }
  return out;
}

const VITEST = `
import { readFileSync, writeSync } from "node:fs";
function eq(a, b, seen = new WeakMap()) {
  if (Object.is(a, b)) return true;
  if (typeof a === "number" && typeof b === "number" && Number.isNaN(a) && Number.isNaN(b)) return true;
  if (a instanceof Error && b instanceof Error) return a.name === b.name && a.message === b.message;
  if (Array.isArray(a) && Array.isArray(b) && a.length === b.length) {
    if (seen.get(a) === b) return true;
    seen.set(a, b);
    return a.every((v, i) => eq(v, b[i], seen));
  }
  if (a instanceof Map && b instanceof Map && a.size === b.size) {
    for (const [k, v] of b) if (!eq(a.get(k), v, seen)) return false;
    return true;
  }
  if (a && b && typeof a === "object" && typeof b === "object") {
    if (seen.get(a) === b) return true;
    seen.set(a, b);
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of keys) {
      if (!eq(a[k], b[k], seen)) return false;
    }
    return true;
  }
  return false;
}
function subset(actual, expected) {
  if (Object.is(actual, expected)) return true;
  if (expected instanceof RegExp) return expected.test(actual);
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual) || actual.length !== expected.length) return false;
    return expected.every((v, i) => subset(actual[i], v));
  }
  if (expected instanceof Map) {
    if (!(actual instanceof Map)) return false;
    for (const [k, v] of expected) if (!subset(actual.get(k), v)) return false;
    return true;
  }
  if (expected && typeof expected === "object") {
    if (!actual || typeof actual !== "object") return false;
    for (const k of Object.keys(expected)) if (!subset(actual[k], expected[k])) return false;
    return true;
  }
  return eq(actual, expected);
}
function track(impl) {
  const wrapped = function (...args) {
    wrapped.mock.calls.push(args);
    return impl ? impl.apply(this, args) : undefined;
  };
  wrapped.mock = { calls: [] };
  return wrapped;
}
const jobs = [];
const stack = [[]];
function describe(_n, fn) { const local = []; stack.push(local); fn(); stack.pop(); }
let currentTitle = "";
function test(n, fn) {
  const setup = stack.flat();
  const title = [...names, n].join(" > ");
  jobs.push(async () => { currentTitle = title; for (const b of setup) await b(); await fn(); });
}
function beforeEach(fn) { stack[stack.length - 1].push(fn); }
function each(register) {
  return (cases) => (name, fn) => {
    for (const item of cases) {
      const args = Array.isArray(item) ? item : [item];
      let i = 0;
      const title = String(name).replace(/%[sdj]/g, () => String(args[i++]));
      register(title, () => fn(...args));
    }
  };
}
describe.each = each(describe);
const it = test;
it.each = each(it);
test.each = each(test);
const vi = { fn(impl) { return track(impl); } };
function expect(actual) {
  const calls = () => actual && actual.mock ? actual.mock.calls : [];
  const api = {
    toBe(e) { if (!Object.is(actual, e)) throw new Error("toBe " + JSON.stringify(actual) + " !== " + JSON.stringify(e)); },
    toEqual(e) { if (!eq(actual, e)) throw new Error("toEqual " + JSON.stringify(actual) + " vs " + JSON.stringify(e)); },
    toStrictEqual(e) { if (!eq(actual, e)) throw new Error("strict " + JSON.stringify(actual) + " vs " + JSON.stringify(e)); },
    toBeNull() { if (actual !== null) throw new Error("not null"); },
    toHaveLength(n) { if (!actual || actual.length !== n) throw new Error("length " + (actual && actual.length)); },
    toBeLessThan(n) { if (!(actual < n)) throw new Error("not <"); },
    toBeLessThanOrEqual(n) { if (!(actual <= n)) throw new Error("not <="); },
    toBeInstanceOf(c) { if (!(actual instanceof c)) throw new Error("not instance"); },
    toHaveProperty(k, v) {
      const parts = String(k).split(".");
      let cur = actual;
      for (const p of parts) cur = cur?.[p];
      if (arguments.length === 1) { if (cur === undefined) throw new Error("missing " + k); }
      else if (!eq(cur, v)) throw new Error("prop " + k);
    },
    toMatch(re) {
      const s = String(actual);
      if (re instanceof RegExp) { if (!re.test(s)) throw new Error("no match " + s); }
      else if (!s.includes(String(re))) throw new Error("no match " + s);
    },
    toMatchObject(e) { if (!subset(actual, e)) throw new Error("no match object " + JSON.stringify(actual).slice(0,180)); },
    toThrow(e) {
      let threw = false, err;
      try { actual(); } catch (ex) { threw = true; err = ex; }
      if (!threw) throw new Error("expected throw");
      if (e instanceof RegExp && !e.test(err.message)) throw new Error("throw mismatch " + err.message);
    },
    toHaveBeenCalled() { if (!calls().length) throw new Error("not called"); },
    toHaveBeenCalledTimes(n) { if (calls().length !== n) throw new Error("times " + calls().length); },
    toHaveBeenCalledWith(...args) { if (!calls().some((c) => eq(c, args))) throw new Error("not with"); },
    toHaveBeenNthCalledWith(n, ...args) { if (!eq(calls()[n - 1], args)) throw new Error("nth"); },
    toHaveBeenLastCalledWith(...args) { if (!eq(calls()[calls().length - 1], args)) throw new Error("last"); },
    get not() {
      return {
        toBe(e) { if (Object.is(actual, e)) throw new Error("was " + e); },
        toEqual(e) { if (eq(actual, e)) throw new Error("was equal"); },
        toThrow() { try { actual(); } catch { throw new Error("did throw"); } },
        toHaveBeenCalled() { if (calls().length) throw new Error("was called"); },
      };
    },
  };
  return api;
}
globalThis.describe = describe;
globalThis.it = it;
globalThis.test = test;
globalThis.beforeEach = beforeEach;
globalThis.expect = expect;
globalThis.vi = vi;
export { describe, it, test, expect, vi, beforeEach };

const names = [];
const snapCounts = new Map();
const origDescribe = describe;
describe = function (n, fn) { names.push(n); origDescribe(n, fn); names.pop(); };
globalThis.describe = describe;
function loadSnaps() {
  let text = "";
  try { text = readFileSync("src/__snapshots__/Tokenizer.spec.ts.snap", "utf8"); }
  catch { return new Map(); }
  const map = new Map();
  let i = 0;
  while (true) {
    const start = text.indexOf("exports[\`", i);
    if (start < 0) break;
    const keyStart = start + "exports[\`".length;
    const keyEnd = text.indexOf("\`] = \`", keyStart);
    const key = text.slice(keyStart, keyEnd);
    const valStart = keyEnd + "\`] = \`".length;
    const valEnd = text.indexOf("\`;", valStart);
    map.set(key, Function(\`"use strict"; return (\${text.slice(valStart, valEnd)});\`)());
    i = valEnd + 2;
  }
  return map;
}
const snaps = loadSnaps();
const origExpect = expect;
expect = function (actual) {
  const api = origExpect(actual);
  api.toMatchSnapshot = () => {
    const title = currentTitle;
    const n = (snapCounts.get(title) ?? 0) + 1;
    snapCounts.set(title, n);
    const key = \`\${title} \${n}\`;
    const expected = snaps.get(key);
    if (expected === undefined) throw new Error("missing snapshot " + key);
    if (!eq(actual, expected)) throw new Error("snapshot mismatch " + key + " " + JSON.stringify(actual).slice(0,120));
  };
  return api;
};
globalThis.expect = expect;
queueMicrotask(async () => {
  let failed = 0;
  for (const fn of jobs) {
    try { await fn(); }
    catch (e) { failed++; writeSync(1, "FAIL " + (e && e.stack ? e.stack : e) + "\\n"); }
  }
  if (failed) { writeSync(1, "Error: " + failed + " failed\\n"); process.exit(1); }
});
`;

const RESOLVE_RUN = `import * as esbuild from "esbuild";
import { createRequire } from "node:module";
import { writeSync } from "node:fs";
await esbuild.build({
  entryPoints: ["src/resolve-uri.ts"],
  bundle: true,
  format: "cjs",
  platform: "node",
  outfile: "dist/resolve-uri.umd.js",
  footer: { js: "module.exports = module.exports.default;" },
});
const jobs = [];
globalThis.describe = (_n, fn) => fn();
globalThis.it = (_n, fn) => jobs.push(fn);
createRequire(import.meta.url)("./test/resolve/ipv6.test.js");
let failed = 0;
for (const fn of jobs) {
  try { fn(); }
  catch (e) { failed++; writeSync(1, "Error: " + (e && e.stack ? e.stack : e) + "\\n"); }
}
if (failed) process.exit(1);
`;

const YAML_RUN = `import "vitest";
import "./tests/doc/anchors.ts";
`;

const CSS_RUN = `import * as esbuild from "esbuild";
import { writeFileSync } from "node:fs";
await esbuild.build({
  entryPoints: ["src/stringify.spec.ts"],
  bundle: true,
  format: "esm",
  platform: "node",
  outfile: "src/bundled.mjs",
  absWorkingDir: process.cwd(),
  external: ["vitest"],
  banner: { js: "import { dirname as __cssDirname } from \\"node:path\\"; import { fileURLToPath as __cssFile } from \\"node:url\\"; const __dirname = __cssDirname(__cssFile(import.meta.url));" },
});
await import("./src/bundled.mjs");
`;

function runtimeModules(): string {
  const dir = mkdtempSync(join(tmpdir(), "m261-mods-"));
  const nm = join(dir, "node_modules");
  mkdirSync(nm);
  for (const name of ["tsx", "esbuild", "@esbuild"]) {
    const copied = spawnSync("cp", ["-a", join(modules, name), join(nm, name)], { stdio: "ignore" });
    assert.equal(copied.status, 0, name);
  }
  mkdirSync(join(nm, "vitest"));
  writeFileSync(join(nm, "vitest/package.json"), `{"name":"vitest","type":"module","exports":{".":"./index.js"}}\n`);
  writeFileSync(join(nm, "vitest/index.js"), VITEST);
  return nm;
}

test("a bracketed IPv6 host stays one host, and a check that is not resolve is refused", () => {
  const next = bracketHost(readFix("resolve-uri.ts.txt"));
  assert.match(next ?? "", /\[\^\\\]\]/);
  assert.equal(bracketHost(next!), null);
  assert.equal(bracketHost(readFix("resolve-uri.ts.txt").replace("export default function resolve(", "export default function kept(")), null);
});

test("a merge source is resolved before it is copied, and a check that is not MergeKey is refused", () => {
  const next = resolveMerge(readFix("yaml--src--schema--yaml-1.1--merge.ts.txt"));
  assert.match(next ?? "", /source instanceof YAMLMap/);
  assert.equal(resolveMerge(next!), null);
  assert.equal(resolveMerge(readFix("yaml--src--schema--yaml-1.1--merge.ts.txt").replace("export class MergeKey", "export class Kept")), null);
});

test("selector characters in an identifier are escaped, and a check that is not stringify is refused", () => {
  const next = escapeIdent(readFix("css-stringify.ts.txt"));
  assert.match(next ?? "", /"&"/);
  assert.equal(escapeIdent(next!), null);
  assert.equal(escapeIdent(readFix("css-stringify.ts.txt").replace("export function stringify(", "export function kept(")), null);
});

const mutantBase = resolve(repoRoot, "peaceai/test/.capability-mutants");
mkdirSync(mutantBase, { recursive: true });
let mutantN = 0;
async function mutant(guard: string) {
  const text = readFileSync(resolve(repoRoot, "peaceai/lib/batch10.ts"), "utf8");
  const lines = text.split("\n");
  const hits = lines.flatMap((line, i) => (line.includes(`// ${guard}`) ? [i] : []));
  assert.equal(hits.length, 1, guard);
  const next = lines.filter((_, i) => i !== hits[0]).join("\n").replace(/from "\.\/([A-Za-z0-9-]+\.ts)"/g, (_m, name: string) => `from ${JSON.stringify(pathToFileURL(resolve(repoRoot, "peaceai/lib", name)).href)}`);
  const out = join(mutantBase, `m261-${mutantN++}.ts`);
  writeFileSync(out, next);
  return import(pathToFileURL(out).href);
}

test("deleting the batch 10 guards admits the near miss, with bwrap and without it", async () => {
  const otherHost = readFix("resolve-uri.ts.txt").replace("export default function resolve(", "export default function kept(");
  assert.equal(bracketHost(otherHost), null);
  const host = await mutant("host-guard:bracket") as { bracketHost: typeof bracketHost; repairBatch10: typeof repairBatch10 };
  assert.match(host.bracketHost(otherHost) ?? "", /\[\^\\\]\]/);
  const otherMerge = readFix("yaml--src--schema--yaml-1.1--merge.ts.txt").replace("export class MergeKey", "export class Kept");
  assert.equal(resolveMerge(otherMerge), null);
  const merged = await mutant("merge-guard:resolve") as { resolveMerge: typeof resolveMerge; repairBatch10: typeof repairBatch10 };
  assert.match(merged.resolveMerge(otherMerge) ?? "", /instanceof YAMLMap/);
  const otherIdent = readFix("css-stringify.ts.txt").replace("export function stringify(", "export function kept(");
  assert.equal(escapeIdent(otherIdent), null);
  const ident = await mutant("ident-guard:escape") as { escapeIdent: typeof escapeIdent; repairBatch10: typeof repairBatch10 };
  assert.match(ident.escapeIdent(otherIdent) ?? "", /"&"/);
  const node = visibleNodeBin();
  assert.ok(node);
  const root = mkdtempSync(join(tmpdir(), "m261-miss-"));
  place(root, { "src/resolve-uri.ts": readFix("resolve-uri.ts.txt"), "run.mjs": "process.exit(0)\n" });
  gitInit(root);
  assert.equal(repairBatch10({
    root, output: "Error: not equal", sourcePattern: "^src/resolve-uri\\.ts$", nodePath: node!, testCommand: [node!, "run.mjs"], bwrap: "/no/such/bwrap",
  }), null);
  if (practiceSandboxReady()) {
    const run = (fn: typeof repairBatch10, dir: string, pattern: string) => fn({
      root: dir, output: "Error: not equal", sourcePattern: pattern, nodePath: node!, testCommand: [node!, "run.mjs"],
    });
    const hostDir = mkdtempSync(join(tmpdir(), "m261-host-"));
    place(hostDir, { "src/resolve-uri.ts": otherHost, "run.mjs": "process.exit(0)\n" });
    gitInit(hostDir);
    assert.equal(run(repairBatch10, hostDir, "^src/resolve-uri\\.ts$"), null);
    assert.match(run(host.repairBatch10, hostDir, "^src/resolve-uri\\.ts$")?.diff ?? "", /\[\^\\\]\]/);
    const mergeDir = mkdtempSync(join(tmpdir(), "m261-merge-"));
    place(mergeDir, { "src/merge.ts": otherMerge, "run.mjs": "process.exit(0)\n" });
    gitInit(mergeDir);
    assert.equal(run(repairBatch10, mergeDir, "^src/merge\\.ts$"), null);
    assert.match(run(merged.repairBatch10, mergeDir, "^src/merge\\.ts$")?.diff ?? "", /YAMLMap/);
    const cssDir = mkdtempSync(join(tmpdir(), "m261-css-"));
    place(cssDir, { "src/stringify.ts": otherIdent, "run.mjs": "process.exit(0)\n" });
    gitInit(cssDir);
    assert.equal(run(repairBatch10, cssDir, "^src/stringify\\.ts$"), null);
    assert.match(run(ident.repairBatch10, cssDir, "^src/stringify\\.ts$")?.diff ?? "", /"&"/);
    rmSync(hostDir, { recursive: true, force: true });
    rmSync(mergeDir, { recursive: true, force: true });
    rmSync(cssDir, { recursive: true, force: true });
  }
  rmSync(root, { recursive: true, force: true });
});

test("an any-cast that only matches one recorded answer is test-only for each batch 10 family", (t) => {
  if (!practiceSandboxReady()) { t.skip("bwrap is not installed"); return; }
  const node = visibleNodeBin();
  assert.ok(node);
  for (const symbol of ["resolve", "MergeKey", "stringify"]) {
    const strict = `export function ${symbol}(kind: string): string {\n  return kind === "b" ? "B" : "A";\n}\n`;
    const over = `export function ${symbol}(kind: any): string {\n  return "A";\n}\n`;
    const make = (body: string) => {
      const dir = mkdtempSync(join(tmpdir(), "m261-grade-"));
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

test("the published resolve-uri, yaml, and css-what checks fail before the repair and pass after, inside the sandbox", (t) => {
  if (!practiceSandboxReady()) { t.skip("bwrap is not installed"); return; }
  const node = visibleNodeBin();
  assert.ok(node);
  const nm = runtimeModules();

  const uri = mkdtempSync(join(tmpdir(), "m261-uri-"));
  place(uri, {
    "src/resolve-uri.ts": readFix("resolve-uri.ts.txt"),
    "test/resolve/ipv6.test.js": readFix("resolve-ipv6.test.js.txt"),
    "package.json": `{"type":"commonjs","main":"dist/resolve-uri.umd.js"}\n`,
    "run.mjs": RESOLVE_RUN,
  });
  gitInit(uri);
  const ucmd = [node!, "run.mjs"];
  const bare = runInPracticeSandbox(uri, ucmd, 120_000, { capture: true, nodePath: node, nodeModules: nm });
  assert.equal(bare.unsafe, false, bare.stdout.slice(-400));
  assert.notEqual(bare.code, 0, bare.stdout.slice(-700));
  const bracketed = repairBatch10({ root: uri, output: bare.stdout, sourcePattern: "^src/resolve-uri\\.ts$", nodePath: node!, nodeModules: nm, testCommand: ucmd });
  assert.ok(bracketed, bare.stdout.slice(-900));
  assert.match(bracketed!.diff, /\[\^\\\]\]/);

  const yaml = mkdtempSync(join(tmpdir(), "m261-yaml-"));
  place(yaml, { ...prefixed("yaml--"), "package.json": `{"name":"yaml","type":"module","exports":{".":"./src/index.ts"}}\n`, "run.mjs": YAML_RUN });
  gitInit(yaml);
  const ycmd = [node!, "node_modules/tsx/dist/cli.mjs", "run.mjs"];
  const circular = runInPracticeSandbox(yaml, ycmd, 120_000, { capture: true, nodePath: node, nodeModules: nm });
  assert.equal(circular.unsafe, false, circular.stdout.slice(-400));
  assert.notEqual(circular.code, 0, circular.stdout.slice(-700));
  const resolved = repairBatch10({ root: yaml, output: circular.stdout, sourcePattern: "^src/schema/yaml-1\\.1/merge\\.ts$", nodePath: node!, nodeModules: nm, testCommand: ycmd });
  assert.ok(resolved, circular.stdout.slice(-900));
  assert.match(resolved!.diff, /instanceof YAMLMap/);

  const css = mkdtempSync(join(tmpdir(), "m261-css-"));
  place(css, {
    "src/stringify.ts": readFix("css-stringify.ts.txt"),
    "src/parse.ts": readFix("css-parse.ts.txt"),
    "src/types.ts": readFix("css-types.ts.txt"),
    "src/index.ts": readFix("css-index.ts.txt"),
    "src/__fixtures__/tests.ts": readFix("css-tests.ts.txt"),
    "src/__fixtures__/out.json": readFix("css-out.json.txt"),
    "src/stringify.spec.ts": readFix("css-stringify.spec.ts.txt"),
    "package.json": `{"type":"module"}\n`,
    "run.mjs": CSS_RUN,
  });
  gitInit(css);
  const ccmd = [node!, "run.mjs"];
  const raw = runInPracticeSandbox(css, ccmd, 120_000, { capture: true, nodePath: node, nodeModules: nm });
  assert.equal(raw.unsafe, false, raw.stdout.slice(-400));
  assert.notEqual(raw.code, 0, raw.stdout.slice(-700));
  const escaped = repairBatch10({ root: css, output: raw.stdout, sourcePattern: "^src/stringify\\.ts$", nodePath: node!, nodeModules: nm, testCommand: ccmd });
  assert.ok(escaped, raw.stdout.slice(-900));
  assert.match(escaped!.diff, /"&"/);
  rmSync(uri, { recursive: true, force: true });
  rmSync(yaml, { recursive: true, force: true });
  rmSync(css, { recursive: true, force: true });
  rmSync(resolve(nm, ".."), { recursive: true, force: true });
});
