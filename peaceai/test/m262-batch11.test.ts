// Batch 11. The library files are the published parent and the published test.
// Third-party bytes run only inside the practice sandbox.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { digitToken, prefixSourceRoot, repairBatch11, zeroLimit } from "../lib/batch11.ts";
import { gradeBehavior } from "../lib/specgrade.ts";
import { practiceSandboxReady, runInPracticeSandbox, visibleNodeBin } from "../lib/practicemine.ts";

const repoRoot = resolve(import.meta.dirname, "../..");
const fix = resolve(import.meta.dirname, "fixtures/m262");
const readFix = (name: string) => readFileSync(join(fix, name), "utf8");
const readHarness = (name: string) => readFileSync(join(import.meta.dirname, name), "utf8");
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

const OUT_RUN = `import "vitest";
import "./src/format.test.ts";
`;

const TRACE_RUN = `import { writeSync } from "node:fs";
const jobs = [];
globalThis.describe = (_n, fn) => fn();
globalThis.it = (_n, fn) => jobs.push(fn);
await import("./test/resolve.test.ts");
let failed = 0;
for (const fn of jobs) {
  try { fn(); }
  catch (e) { failed++; writeSync(1, "Error: " + (e && e.stack ? e.stack : e) + "\\n"); }
}
if (failed) process.exit(1);
`;

function runtimeModules(): string {
  const dir = mkdtempSync(join(tmpdir(), "m262-mods-"));
  const nm = join(dir, "node_modules");
  mkdirSync(nm);
  for (const name of ["tsx", "esbuild", "@esbuild"]) {
    const copied = spawnSync("cp", ["-a", join(modules, name), join(nm, name)], { stdio: "ignore" });
    assert.equal(copied.status, 0, name);
  }
  const pkg = (dirName: string, body: string) => {
    mkdirSync(join(nm, dirName), { recursive: true });
    writeFileSync(join(nm, dirName, "package.json"), `{"type":"module","exports":{".":"./index.js"}}\n`);
    writeFileSync(join(nm, dirName, "index.js"), body);
  };
  pkg("vitest", readHarness("m262-vitest-shim.js"));
  pkg("domelementtype", readHarness("m262-element-stub.js"));
  pkg("domhandler", readHarness("m262-handler-stub.js"));
  pkg("htmlparser2", readHarness("m262-parser-stub.js"));
  mkdirSync(join(nm, "@jridgewell/resolve-uri"), { recursive: true });
  writeFileSync(join(nm, "@jridgewell/resolve-uri/package.json"), `{"name":"@jridgewell/resolve-uri","type":"module","exports":{".":"./index.js"}}\n`);
  writeFileSync(join(nm, "@jridgewell/resolve-uri/index.js"), readHarness("m262-resolve-stub.js"));
  return nm;
}

test("percent-i is a digit placeholder, and a check that is not format is refused", () => {
  const next = digitToken(readFix("out-format.ts.txt"));
  assert.match(next ?? "", /sdijo/);
  assert.equal(digitToken(next!), null);
  assert.equal(digitToken(readFix("out-format.ts.txt").replace("export function format(", "export function kept(")), null);
});

test("sourceRoot is prefixed before resolution, and a check that does not import resolve-uri is refused", () => {
  const next = prefixSourceRoot(readFix("trace-resolve.ts.txt"));
  assert.match(next ?? "", /function resolver\(/);
  assert.equal(prefixSourceRoot(next!), null);
  assert.equal(prefixSourceRoot(readFix("trace-resolve.ts.txt").replace("from '@jridgewell/resolve-uri'", "from './kept'")), null);
});

test("a zero query limit returns nothing, and a check that is not find is refused", () => {
  const next = zeroLimit(readFix("dom-querying.ts.txt"));
  assert.match(next ?? "", /limit <= 0/);
  assert.equal(zeroLimit(next!), null);
  assert.equal(zeroLimit(readFix("dom-querying.ts.txt").replace("export function find(", "export function kept(")), null);
});

test("undoing the new token fails the published check, in-process and inside bwrap", (t) => {
  const digits = digitToken(readFix("out-format.ts.txt"));
  const rooted = prefixSourceRoot(readFix("trace-resolve.ts.txt"));
  const limited = zeroLimit(readFix("dom-querying.ts.txt"));
  assert.ok(digits && rooted && limited);
  const digitFile = digits.replace("[sdijo]", "[sdjo]");
  const rootFile = rooted
    .replace("  const prefix = sourceRoot ? sourceRoot + '/' : '';\n\n", "")
    .replace("resolveUri(prefix + (source || ''), from)", "resolveUri(source || '', from)");
  const limitFile = limited.replace("    if (limit <= 0) return result;\n", "");
  assert.equal(digitFile, readFix("out-format.ts.txt"));
  assert.equal(limitFile, readFix("dom-querying.ts.txt"));
  assert.equal(rootFile.includes("prefix"), false);
  assert.notEqual(rootFile, rooted);
  const node = visibleNodeBin();
  assert.ok(node);
  if (!practiceSandboxReady()) { t.skip("bwrap is not installed"); return; }
  const nm = runtimeModules();
  const tsx = [node!, "node_modules/tsx/dist/cli.mjs"];
  const cases: { files: Record<string, string>; dest: string; cmd: string[]; pattern: string; why: RegExp; restores: RegExp | null }[] = [
    {
      files: { "src/format.ts": digitFile, "src/format.test.ts": readFix("out-format.test.ts.txt"), "package.json": `{"type":"module"}\n`, "run.mjs": OUT_RUN },
      dest: "src/format.ts", cmd: [...tsx, "run.mjs"], pattern: "^src/format\\.ts$", why: /%i/, restores: /\[sdijo\]/,
    },
    {
      files: { "src/resolve.ts": rootFile, "src/strip-filename.ts": readFix("trace-strip-filename.ts.txt"), "test/resolve.test.ts": readFix("trace-resolve.test.ts.txt"), "package.json": `{"type":"module"}\n`, "run.mjs": TRACE_RUN },
      dest: "src/resolve.ts", cmd: [...tsx, "run.mjs"], pattern: "^src/resolve\\.ts$", why: /foo\/input\.js/, restores: null,
    },
    {
      files: { "src/querying.ts": limitFile, "src/querying.spec.ts": readFix("dom-querying.spec.ts.txt"), "package.json": `{"type":"module"}\n` },
      dest: "src/querying.ts", cmd: [...tsx, "src/querying.spec.ts"], pattern: "^src/querying\\.ts$", why: /predicateCalls|toEqual|Expected/, restores: /limit <= 0/,
    },
  ];
  for (const row of cases) {
    const dir = mkdtempSync(join(tmpdir(), "m262-kill-"));
    place(dir, { ...row.files, ".gitignore": "node_modules\n" });
    symlinkSync(nm, join(dir, "node_modules"));
    const direct = spawnSync(row.cmd[0]!, row.cmd.slice(1), { cwd: dir, encoding: "utf8" });
    const directOut = `${direct.stdout}\n${direct.stderr}`;
    assert.notEqual(direct.status, 0, directOut.slice(-800));
    assert.match(directOut, row.why, row.dest);
    assert.doesNotMatch(directOut, /ReferenceError|TransformError|SyntaxError/, row.dest);
    const sand = runInPracticeSandbox(dir, row.cmd, 120_000, { capture: true, nodePath: node, nodeModules: nm });
    assert.equal(sand.unsafe, false, row.dest);
    assert.notEqual(sand.code, 0, sand.stdout.slice(-800));
    assert.match(sand.stdout, row.why, row.dest);
    gitInit(dir);
    const repaired = repairBatch11({
      root: dir, output: sand.stdout, sourcePattern: row.pattern, nodePath: node!, nodeModules: nm, testCommand: row.cmd,
    });
    if (row.restores) {
      assert.ok(repaired, row.dest);
      assert.match(repaired!.diff, row.restores, row.dest);
    } else {
      assert.equal(repaired, null, row.dest);
    }
    rmSync(dir, { recursive: true, force: true });
  }
  rmSync(resolve(nm, ".."), { recursive: true, force: true });
});

test("an any-cast that only matches one recorded answer is test-only for each batch 11 family", (t) => {
  if (!practiceSandboxReady()) { t.skip("bwrap is not installed"); return; }
  const node = visibleNodeBin();
  assert.ok(node);
  for (const symbol of ["format", "resolver", "find"]) {
    const strict = `export function ${symbol}(kind: string): string {\n  return kind === "b" ? "B" : "A";\n}\n`;
    const over = `export function ${symbol}(kind: any): string {\n  return "A";\n}\n`;
    const make = (body: string) => {
      const dir = mkdtempSync(join(tmpdir(), "m262-grade-"));
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

test("the published outvariant, trace-mapping, and domutils checks fail before the repair and pass after, inside the sandbox", (t) => {
  if (!practiceSandboxReady()) { t.skip("bwrap is not installed"); return; }
  const node = visibleNodeBin();
  assert.ok(node);
  const nm = runtimeModules();
  const tsx = [node!, "node_modules/tsx/dist/cli.mjs"];

  const out = mkdtempSync(join(tmpdir(), "m262-out-"));
  place(out, {
    "src/format.ts": readFix("out-format.ts.txt"),
    "src/format.test.ts": readFix("out-format.test.ts.txt"),
    "package.json": `{"type":"module"}\n`,
    "run.mjs": OUT_RUN,
  });
  gitInit(out);
  const ocmd = [...tsx, "run.mjs"];
  const plain = runInPracticeSandbox(out, ocmd, 120_000, { capture: true, nodePath: node, nodeModules: nm });
  assert.equal(plain.unsafe, false, plain.stdout.slice(-400));
  assert.notEqual(plain.code, 0, plain.stdout.slice(-700));
  const digits = repairBatch11({ root: out, output: plain.stdout, sourcePattern: "^src/format\\.ts$", nodePath: node!, nodeModules: nm, testCommand: ocmd });
  assert.ok(digits, plain.stdout.slice(-900));
  assert.match(digits!.diff, /sdijo/);

  const trace = mkdtempSync(join(tmpdir(), "m262-trace-"));
  place(trace, {
    "src/resolve.ts": readFix("trace-resolve.ts.txt"),
    "src/strip-filename.ts": readFix("trace-strip-filename.ts.txt"),
    "test/resolve.test.ts": readFix("trace-resolve.test.ts.txt"),
    "package.json": `{"type":"module"}\n`,
    "run.mjs": TRACE_RUN,
  });
  gitInit(trace);
  const tcmd = [...tsx, "run.mjs"];
  const direct = runInPracticeSandbox(trace, tcmd, 120_000, { capture: true, nodePath: node, nodeModules: nm });
  assert.equal(direct.unsafe, false, direct.stdout.slice(-400));
  assert.notEqual(direct.code, 0, direct.stdout.slice(-700));
  const prefixed = repairBatch11({ root: trace, output: direct.stdout, sourcePattern: "^src/resolve\\.ts$", nodePath: node!, nodeModules: nm, testCommand: tcmd });
  assert.ok(prefixed, direct.stdout.slice(-900));
  assert.match(prefixed!.diff, /function resolver/);

  const dom = mkdtempSync(join(tmpdir(), "m262-dom-"));
  place(dom, {
    "src/querying.ts": readFix("dom-querying.ts.txt"),
    "src/querying.spec.ts": readFix("dom-querying.spec.ts.txt"),
    "package.json": `{"type":"module"}\n`,
  });
  gitInit(dom);
  const dcmd = [...tsx, "src/querying.spec.ts"];
  const unlimited = runInPracticeSandbox(dom, dcmd, 120_000, { capture: true, nodePath: node, nodeModules: nm });
  assert.equal(unlimited.unsafe, false, unlimited.stdout.slice(-400));
  assert.notEqual(unlimited.code, 0, unlimited.stdout.slice(-700));
  const limited = repairBatch11({ root: dom, output: unlimited.stdout, sourcePattern: "^src/querying\\.ts$", nodePath: node!, nodeModules: nm, testCommand: dcmd });
  assert.ok(limited, unlimited.stdout.slice(-900));
  assert.match(limited!.diff, /limit <= 0/);
  rmSync(out, { recursive: true, force: true });
  rmSync(trace, { recursive: true, force: true });
  rmSync(dom, { recursive: true, force: true });
  rmSync(resolve(nm, ".."), { recursive: true, force: true });
});
