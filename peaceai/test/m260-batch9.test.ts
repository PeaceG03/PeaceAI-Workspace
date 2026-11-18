// Batch 9. The library files are the published parent and the published test.
// Third-party bytes run only inside the practice sandbox.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { atomicUpdate, carryNsecs, rejectSignless, repairBatch9 } from "../lib/batch9.ts";
import { gradeBehavior } from "../lib/specgrade.ts";
import { practiceSandboxReady, runInPracticeSandbox, visibleNodeBin } from "../lib/practicemine.ts";

const repoRoot = resolve(import.meta.dirname, "../..");
const fix = resolve(import.meta.dirname, "fixtures/m260");
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
const jobs = [];
const stack = [];
function describe(name, fn) { stack.push(name); try { fn(); } finally { stack.pop(); } }
function it(name, fn) { const title = [...stack, name].join(" > "); jobs.push([title, fn]); }
const test = it;
function eq(a, b) {
  if (Object.is(a, b)) return true;
  if (typeof a !== "object" || typeof b !== "object" || !a || !b) return false;
  if (a instanceof Error || b instanceof Error) return a instanceof Error && b instanceof Error && a.name === b.name && a.message === b.message;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((v, i) => eq(v, b[i]));
  }
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) if (!eq(a[k], b[k])) return false;
  return true;
}
function matchThrow(err, expected) {
  if (expected instanceof RegExp) return expected.test(String(err)) || expected.test(err && err.message || "");
  if (typeof expected === "string") return String(err).includes(expected) || (err && err.message || "").includes(expected);
  if (typeof expected === "function") return err instanceof expected;
  return false;
}
function assertThrows(fn, expected) {
  let threw = false, err;
  try { fn(); } catch (e) { threw = true; err = e; }
  if (!threw) throw new Error("expected throw");
  if (expected && !matchThrow(err, expected)) throw new Error("throw mismatch: " + (err && err.message));
}
export const assert = {
  equal(a, b, msg) { if (!Object.is(a, b) && a !== b) throw new Error((msg ? msg + ": " : "") + "not equal " + JSON.stringify(a) + " !== " + JSON.stringify(b)); },
  strictEqual(a, b, msg) { if (!Object.is(a, b)) throw new Error((msg ? msg + ": " : "") + "not same " + String(a) + " !== " + String(b)); },
  deepEqual(a, b, msg) { if (!eq(a, b)) throw new Error((msg || "not deep equal") + " " + JSON.stringify(a) + " vs " + JSON.stringify(b)); },
  throws: assertThrows,
  notMatch(s, re) { if (re.test(s)) throw new Error("matched " + re); },
};
export { describe, it, test };
export function expect(actual) {
  return {
    toBe(e) { if (!Object.is(actual, e)) throw new Error("toBe " + actual + " !== " + e); },
    toEqual(e) { if (!eq(actual, e)) throw new Error("toEqual " + JSON.stringify(actual) + " vs " + JSON.stringify(e)); },
    toStrictEqual(e) { if (!eq(actual, e)) throw new Error("strict " + JSON.stringify(actual) + " vs " + JSON.stringify(e)); },
    toThrowError(expected) { assertThrows(actual, expected === undefined ? Error : expected); },
    toThrow(expected) { assertThrows(actual, expected); },
  };
}
queueMicrotask(() => {
  let failed = 0;
  for (const [title, fn] of jobs) {
    try { fn(); }
    catch (e) { failed++; writeSync(1, "FAIL " + title + "\\n" + (e && e.stack) + "\\n"); }
  }
  if (failed) { writeSync(1, "Error: " + failed + " failed\\n"); process.exit(1); }
});
`;

const RUNNER = `import * as esbuild from "esbuild";
import { writeFileSync } from "node:fs";
const entry = process.argv[2];
const result = await esbuild.build({
  entryPoints: [entry],
  bundle: true,
  format: "esm",
  platform: "node",
  define: { DEBUG: "true" },
  write: false,
  absWorkingDir: process.cwd(),
  external: ["vitest"],
});
writeFileSync(new URL("./bundled.mjs", import.meta.url), result.outputFiles[0].text);
await import("./bundled.mjs");
`;

const CODEC = `export function encode() { return ""; }
export function encodeRangeMappings() { return ""; }
`;

function runtimeModules(): string {
  const dir = mkdtempSync(join(tmpdir(), "m260-mods-"));
  const nm = join(dir, "node_modules");
  mkdirSync(nm);
  for (const name of ["tsx", "esbuild", "@esbuild"]) {
    const copied = spawnSync("cp", ["-a", join(modules, name), join(nm, name)], { stdio: "ignore" });
    assert.equal(copied.status, 0, name);
  }
  mkdirSync(join(nm, "vitest"));
  writeFileSync(join(nm, "vitest/package.json"), `{"name":"vitest","type":"module","exports":{".":"./index.js"}}\n`);
  writeFileSync(join(nm, "vitest/index.js"), VITEST);
  mkdirSync(join(nm, "@jridgewell/sourcemap-codec"), { recursive: true });
  writeFileSync(join(nm, "@jridgewell/sourcemap-codec/package.json"), `{"name":"@jridgewell/sourcemap-codec","type":"module","exports":{".":"./index.js"}}\n`);
  writeFileSync(join(nm, "@jridgewell/sourcemap-codec/index.js"), CODEC);
  return nm;
}

test("a signless integer after An is rejected, and a check that is not parse is refused", () => {
  const next = rejectSignless(readFix("nth-parse.ts.txt"));
  assert.match(next ?? "", /signChar !== "\+"/);
  assert.equal(rejectSignless(next!), null);
  assert.equal(rejectSignless(readFix("nth-parse.ts.txt").replace("export function parse(", "export function kept(")), null);
});

test("nsecs carry out of time_low, and a check that is not v1Bytes is refused", () => {
  const next = carryNsecs(readFix("uuid-v1.ts.txt"));
  assert.match(next ?? "", /const t = \(msecs & 0xfffffff\) \* 10000 \+ nsecs/);
  assert.equal(carryNsecs(next!), null);
  assert.equal(carryNsecs(readFix("uuid-v1.ts.txt").replace("function v1Bytes(", "function kept(")), null);
});

test("update checks the range before editing it, and a check that is not update is refused", () => {
  const next = atomicUpdate(readFix("magic-MagicString.ts.txt"));
  assert.match(next ?? "", /chunk = first\n      while \(chunk !== last\)/);
  assert.equal(atomicUpdate(next!), null);
  assert.equal(atomicUpdate(readFix("magic-MagicString.ts.txt").replace("update(start: number, end: number, content: string", "kept(start: number, end: number, content: string")), null);
});

test("the parent file fails the published check because the repair is absent, in-process and inside bwrap", (t) => {
  if (!practiceSandboxReady()) { t.skip("bwrap is not installed"); return; }
  const node = visibleNodeBin();
  assert.ok(node);
  const nm = runtimeModules();
  const tsx = [node!, "node_modules/tsx/dist/cli.mjs"];
  const magicFiles: Record<string, string> = { "package.json": `{ "type": "module" }\n`, "run.mjs": RUNNER };
  for (const [path, name] of Object.entries(MAGIC)) magicFiles[path] = readFix(name);
  const rows: { dest: string; files: Record<string, string>; pattern: string; cmd: string[]; why: RegExp; restores: RegExp; absent: string }[] = [
    {
      dest: "src/parse.ts",
      files: {
        "src/parse.ts": readFix("nth-parse.ts.txt"),
        "src/__fixtures__/rules.ts": readFix("nth-rules.ts.txt"),
        "src/parse.spec.ts": readFix("nth-parse.spec.ts.txt"),
        "package.json": `{ "type": "module" }\n`,
      },
      pattern: "^src/parse\\.ts$",
      cmd: [...tsx, "src/parse.spec.ts"],
      why: /couldn't be parsed|expected throw|toThrow/, restores: /signChar/, absent: "signChar",
    },
    {
      dest: "src/v1.ts",
      files: {
        "src/v1.ts": readFix("uuid-v1.ts.txt"),
        "src/rng.ts": readFix("uuid-rng.ts.txt"),
        "src/stringify.ts": readFix("uuid-stringify.ts.txt"),
        "src/parse.ts": readFix("uuid-parse.ts.txt"),
        "src/validate.ts": readFix("uuid-validate.ts.txt"),
        "src/regex.ts": readFix("uuid-regex.ts.txt"),
        "src/test/v1.test.ts": readFix("uuid-v1.test.ts.txt"),
        "package.json": `{ "type": "module" }\n`,
      },
      pattern: "^src/v1\\.ts$",
      cmd: [...tsx, "--test", "src/test/v1.test.ts"],
      why: /toEqual|not equal|AssertionError/, restores: /const t = /, absent: "const t = (msecs",
    },
    {
      dest: "src/MagicString.ts",
      files: magicFiles,
      pattern: "^src/MagicString\\.ts$",
      cmd: [node!, "run.mjs", "tests/MagicString/update.test.ts"],
      why: /not equal|toBe|toEqual|Error/, restores: /chunk = first/, absent: "      chunk = first\n",
    },
  ];
  for (const row of rows) {
    assert.equal(row.files[row.dest]!.includes(row.absent), false, row.dest);
    const dir = mkdtempSync(join(tmpdir(), "m260-kill-"));
    place(dir, { ...row.files, ".gitignore": "node_modules\n" });
    symlinkSync(nm, join(dir, "node_modules"));
    gitInit(dir);
    const env = { ...process.env };
    delete env.NODE_TEST_CONTEXT;
    const direct = spawnSync(row.cmd[0]!, row.cmd.slice(1), { cwd: dir, encoding: "utf8", env });
    const directOut = `${direct.stdout}\n${direct.stderr}`;
    assert.notEqual(direct.status, 0, directOut.slice(-700));
    assert.match(directOut, row.why, directOut.slice(-700));
    assert.doesNotMatch(directOut, /ReferenceError|SyntaxError|TransformError/, row.dest);
    const sand = runInPracticeSandbox(dir, row.cmd, 120_000, { capture: true, nodePath: node, nodeModules: nm });
    assert.notEqual(sand.code, 0, sand.stdout.slice(-700));
    assert.match(sand.stdout, row.why, sand.stdout.slice(-700));
    const repaired = repairBatch9({
      root: dir, output: directOut, sourcePattern: row.pattern, nodePath: node!, nodeModules: nm, testCommand: row.cmd,
    });
    assert.ok(repaired, row.dest);
    assert.match(repaired!.diff, row.restores, row.dest);
    rmSync(dir, { recursive: true, force: true });
  }
  rmSync(resolve(nm, ".."), { recursive: true, force: true });
});

test("an any-cast that only matches one recorded answer is test-only for each batch 9 family", (t) => {
  if (!practiceSandboxReady()) { t.skip("bwrap is not installed"); return; }
  const node = visibleNodeBin();
  assert.ok(node);
  for (const symbol of ["parse", "v1Bytes", "update"]) {
    const strict = `export function ${symbol}(kind: string): string {\n  return kind === "b" ? "B" : "A";\n}\n`;
    const over = `export function ${symbol}(kind: any): string {\n  return "A";\n}\n`;
    const make = (body: string) => {
      const dir = mkdtempSync(join(tmpdir(), "m260-grade-"));
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

const MAGIC: Record<string, string> = {
  "src/BitSet.ts": "magic-BitSet.ts.txt",
  "src/Bundle.ts": "magic-Bundle.ts.txt",
  "src/Chunk.ts": "magic-Chunk.ts.txt",
  "src/MagicString.ts": "magic-MagicString.ts.txt",
  "src/MagicStringError.ts": "magic-MagicStringError.ts.txt",
  "src/SourceMap.ts": "magic-SourceMap.ts.txt",
  "src/index.ts": "magic-index.ts.txt",
  "src/utils/Mappings.ts": "magic-Mappings.ts.txt",
  "src/utils/MappingsEncoder.ts": "magic-MappingsEncoder.ts.txt",
  "src/utils/Stats.ts": "magic-Stats.ts.txt",
  "src/utils/getLocator.ts": "magic-getLocator.ts.txt",
  "src/utils/getRelativePath.ts": "magic-getRelativePath.ts.txt",
  "src/utils/guessIndent.ts": "magic-guessIndent.ts.txt",
  "src/utils/isObject.ts": "magic-isObject.ts.txt",
  "tests/__utils/IntegrityCheckingMagicString.ts": "magic-IntegrityCheckingMagicString.ts.txt",
  "tests/MagicString/update.test.ts": "magic-update.test.ts.txt",
};

test("the published nth-check, uuid, and magic-string checks fail before the repair and pass after, inside the sandbox", (t) => {
  if (!practiceSandboxReady()) { t.skip("bwrap is not installed"); return; }
  const node = visibleNodeBin();
  assert.ok(node);
  const nm = runtimeModules();
  const tsx = [node!, "node_modules/tsx/dist/cli.mjs"];

  const nth = mkdtempSync(join(tmpdir(), "m260-nth-"));
  place(nth, {
    "src/parse.ts": readFix("nth-parse.ts.txt"),
    "src/__fixtures__/rules.ts": readFix("nth-rules.ts.txt"),
    "src/parse.spec.ts": readFix("nth-parse.spec.ts.txt"),
    "package.json": `{ "type": "module" }\n`,
  });
  gitInit(nth);
  const ncmd = [...tsx, "src/parse.spec.ts"];
  const unsigned = runInPracticeSandbox(nth, ncmd, 120_000, { capture: true, nodePath: node, nodeModules: nm });
  assert.equal(unsigned.unsafe, false, unsigned.stdout.slice(-400));
  assert.notEqual(unsigned.code, 0, unsigned.stdout.slice(-700));
  const signed = repairBatch9({ root: nth, output: unsigned.stdout, sourcePattern: "^src/parse\\.ts$", nodePath: node!, nodeModules: nm, testCommand: ncmd });
  assert.ok(signed, unsigned.stdout.slice(-900));
  assert.match(signed!.diff, /signChar/);

  const uuid = mkdtempSync(join(tmpdir(), "m260-uuid-"));
  place(uuid, {
    "src/v1.ts": readFix("uuid-v1.ts.txt"),
    "src/rng.ts": readFix("uuid-rng.ts.txt"),
    "src/stringify.ts": readFix("uuid-stringify.ts.txt"),
    "src/parse.ts": readFix("uuid-parse.ts.txt"),
    "src/validate.ts": readFix("uuid-validate.ts.txt"),
    "src/regex.ts": readFix("uuid-regex.ts.txt"),
    "src/test/v1.test.ts": readFix("uuid-v1.test.ts.txt"),
    "package.json": `{ "type": "module" }\n`,
  });
  gitInit(uuid);
  const ucmd = [...tsx, "--test", "src/test/v1.test.ts"];
  const low = runInPracticeSandbox(uuid, ucmd, 120_000, { capture: true, nodePath: node, nodeModules: nm });
  assert.equal(low.unsafe, false, low.stdout.slice(-400));
  assert.notEqual(low.code, 0, low.stdout.slice(-700));
  const carried = repairBatch9({ root: uuid, output: low.stdout, sourcePattern: "^src/v1\\.ts$", nodePath: node!, nodeModules: nm, testCommand: ucmd });
  assert.ok(carried, low.stdout.slice(-900));
  assert.match(carried!.diff, /const t = /);

  const magic = mkdtempSync(join(tmpdir(), "m260-magic-"));
  const magicFiles: Record<string, string> = { "package.json": `{ "type": "module" }\n`, "run.mjs": RUNNER };
  for (const [path, name] of Object.entries(MAGIC)) magicFiles[path] = readFix(name);
  place(magic, magicFiles);
  gitInit(magic);
  const mcmd = [node!, "run.mjs", "tests/MagicString/update.test.ts"];
  const partial = runInPracticeSandbox(magic, mcmd, 120_000, { capture: true, nodePath: node, nodeModules: nm });
  assert.equal(partial.unsafe, false, partial.stdout.slice(-400));
  assert.notEqual(partial.code, 0, partial.stdout.slice(-700));
  const atomic = repairBatch9({ root: magic, output: partial.stdout, sourcePattern: "^src/MagicString\\.ts$", nodePath: node!, nodeModules: nm, testCommand: mcmd });
  assert.ok(atomic, partial.stdout.slice(-900));
  assert.match(atomic!.diff, /chunk = first/);
  rmSync(nth, { recursive: true, force: true });
  rmSync(uuid, { recursive: true, force: true });
  rmSync(magic, { recursive: true, force: true });
  rmSync(resolve(nm, ".."), { recursive: true, force: true });
});
