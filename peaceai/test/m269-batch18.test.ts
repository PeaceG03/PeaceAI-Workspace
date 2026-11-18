// Batch 18. The library files are the published parent and the published test.
// Third-party bytes run only inside the practice sandbox.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { enotdirNotFound, indentFromContent, repairBatch18, skipInternalRoute } from "../lib/batch18.ts";
import { gradeBehavior } from "../lib/specgrade.ts";
import { practiceSandboxReady, runInPracticeSandbox, visibleNodeBin } from "../lib/practicemine.ts";

const fix = resolve(import.meta.dirname, "fixtures/m269");
const readFix = (name: string) => readFileSync(join(fix, name), "utf8");
const modules = resolve(import.meta.dirname, "../../node_modules");

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

function pkg(nm: string, name: string, manifest: string, files: Record<string, string>) {
  const root = join(nm, name);
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, "package.json"), manifest);
  for (const [rel, fixture] of Object.entries(files)) {
    mkdirSync(join(root, rel, ".."), { recursive: true });
    writeFileSync(join(root, rel), readFileSync(join(fix, fixture)));
  }
}

function runtime(kind: "ungh" | "confbox" | "local"): string {
  const dir = mkdtempSync(join(tmpdir(), "m269-mods-"));
  const nm = join(dir, "node_modules");
  mkdirSync(nm);
  for (const name of ["tsx", "esbuild", "@esbuild"]) {
    assert.equal(spawnSync("cp", ["-a", join(modules, name), join(nm, name)], { stdio: "ignore" }).status, 0, name);
  }
  mkdirSync(join(nm, "vitest"));
  writeFileSync(join(nm, "vitest/package.json"), `{"type":"module","exports":{".":"./index.js"}}\n`);
  writeFileSync(join(nm, "vitest/index.js"), readFileSync(join(import.meta.dirname, "m269-vitest-shim.js")));
  if (kind === "ungh") {
    mkdirSync(join(nm, "nitro"));
    writeFileSync(join(nm, "nitro/package.json"), `{"type":"module","exports":{"./h3":"./h3.js"}}\n`);
    writeFileSync(join(nm, "nitro/h3.js"), "export function defineMiddleware(fn){ return fn; }\nexport class HTTPError extends Error { constructor(o){ super(o && o.message || 'HTTPError'); this.statusCode = o && o.statusCode; } }\n");
  }
  if (kind === "confbox") {
    pkg(nm, "detect-indent", `{"type":"module","exports":"./index.js"}\n`, { "index.js": "di-index.js.txt" });
    pkg(nm, "ini", `{"main":"lib/ini.js"}\n`, { "lib/ini.js": "ini-lib-ini.js.txt" });
    pkg(nm, "js-yaml", `{"type":"module","exports":{".":"./dist/js-yaml.mjs"}}\n`, { "dist/js-yaml.mjs": "jy-dist-js-yaml.mjs.txt" });
    pkg(nm, "json5", `{"main":"lib/parse.js"}\n`, {
      "lib/parse.js": "j5-lib-parse.js.txt",
      "lib/stringify.js": "j5-lib-stringify.js.txt",
      "lib/unicode.js": "j5-lib-unicode.js.txt",
      "lib/util.js": "j5-lib-util.js.txt",
    });
    pkg(nm, "smol-toml", `{"type":"module","exports":{".":"./dist/index.js"}}\n`, {
      "dist/index.js": "st-dist-index.js.txt",
      "dist/parse.js": "st-dist-parse.js.txt",
      "dist/stringify.js": "st-dist-stringify.js.txt",
      "dist/date.js": "st-dist-date.js.txt",
      "dist/error.js": "st-dist-error.js.txt",
      "dist/extract.js": "st-dist-extract.js.txt",
      "dist/primitive.js": "st-dist-primitive.js.txt",
      "dist/struct.js": "st-dist-struct.js.txt",
      "dist/util.js": "st-dist-util.js.txt",
    });
    pkg(nm, "strip-json-comments", `{"type":"module","exports":"./index.js"}\n`, { "index.js": "sjc-index.js.txt" });
  }
  if (kind === "local") {
    pkg(nm, "mlly", `{"type":"module","exports":{".":"./index.js"}}\n`, {});
    writeFileSync(join(nm, "mlly/index.js"), [
      "import fs from 'node:fs';",
      "import path from 'node:path';",
      "export function interopDefault(mod){ return mod && mod.default !== undefined ? mod.default : mod; }",
      "export function resolvePathSync(id, opts={}){",
      "  const bases = [].concat(opts.url || []).filter(Boolean);",
      "  const list = bases.length ? bases : [process.cwd()];",
      "  let last;",
      "  for (const base of list) {",
      "    try { fs.statSync(path.join(base, ...String(id).split('/'))); }",
      "    catch (e) { last = e; }",
      "  }",
      "  throw last || Object.assign(new Error('MODULE_NOT_FOUND'), { code: 'MODULE_NOT_FOUND' });",
      "}",
      "",
    ].join("\n"));
    pkg(nm, "quansync", `{"type":"module","exports":{"./macro":"./macro.js"}}\n`, {});
    writeFileSync(join(nm, "quansync/macro.js"), "export function quansync(fn){ if (typeof fn==='function'){ const w=(...a)=>fn(...a); w.sync=fn; return w; } const w=(...a)=>fn.async(...a); w.sync=fn.sync; return w; }\n");
    pkg(nm, "find-up-simple", `{"type":"module","exports":{".":"./index.js"}}\n`, {});
    writeFileSync(join(nm, "find-up-simple/index.js"), "export function findUp(){return undefined}\nexport function findUpSync(){return undefined}\n");
  }
  return nm;
}

test("an internal route is not rate limited, and a check that is not this middleware is refused", () => {
  const source = readFix("uh-middleware-ratelimit.ts.txt");
  const next = skipInternalRoute(source);
  assert.match(next ?? "", /startsWith\("\/_"\)/);
  assert.equal(skipInternalRoute(next!), null);
  assert.equal(skipInternalRoute(source.replace("export default defineMiddleware", "export default kept")), null);
});

test("indent starts at the first content line, and a check that is not detectFormat is refused", () => {
  const source = readFix("cb-src-_format.ts.txt");
  const next = indentFromContent(source);
  assert.match(next ?? "", /function indentSample/);
  assert.equal(indentFromContent(next!), null);
  assert.equal(indentFromContent(source.replace("export function detectFormat(", "export function kept(")), null);
});

test("ENOTDIR is a missing package, and a check that is not resolvePackage is refused", () => {
  const source = readFix("lp-src-index.ts.txt");
  const next = enotdirNotFound(source);
  assert.match(next ?? "", /ENOTDIR/);
  assert.equal(enotdirNotFound(next!), null);
  assert.equal(enotdirNotFound(source.replace("function resolvePackage(", "function kept(")), null);
});

function rows() {
  const node = visibleNodeBin()!;
  const tsx = [node, "node_modules/tsx/dist/cli.mjs"];
  const ungh = runtime("ungh");
  const confbox = runtime("confbox");
  const local = runtime("local");
  const confFiles: Record<string, string> = {
    "test/index.test.ts": readFix("cb-test-index.test.ts.txt"),
    "test/fixtures.mjs": readFix("cb-test-fixtures.mjs.txt"),
    "package.json": `{"type":"module"}\n`,
  };
  for (const name of ["_format.ts", "index.ts", "ini.ts", "json.ts", "json5.ts", "jsonc.ts", "toml.ts", "yaml.ts"]) {
    confFiles[`src/${name}`] = readFix(`cb-src-${name}.txt`);
  }
  return {
    mods: [ungh, confbox, local],
    list: [
      {
        files: {
          "middleware/ratelimit.ts": readFix("uh-middleware-ratelimit.ts.txt"),
          "test/ratelimit.test.ts": readFix("uh-test-ratelimit.test.ts.txt"),
          "utils/github_token.ts": "export function getAggregateRateLimit(){ return { remaining: 50, limit: 100, reset: Date.now()+1000 }; }\nexport function retryAfterSeconds(){ return 1; }\n",
          "tsconfig.json": `{"compilerOptions":{"baseUrl":".","paths":{"~/*":["./*"]}}}\n`,
          "package.json": `{"type":"module"}\n`,
        },
        pattern: "^middleware/ratelimit\\.ts$",
        cmd: [...tsx, "test/ratelimit.test.ts"],
        modules: ungh,
        why: /toBe true !== false/,
        restores: /\/_/,
      },
      {
        files: confFiles,
        pattern: "^src/_format\\.ts$",
        cmd: [...tsx, "test/index.test.ts"],
        modules: confbox,
        why: /meta:\\n     a: 1/,
        restores: /indentSample/,
      },
      {
        files: {
          "src/index.ts": readFix("lp-src-index.ts.txt"),
          "test/enotdir.test.ts": readFix("lp-test-enotdir.test.ts.txt"),
          "package.json": `{"type":"module"}\n`,
        },
        pattern: "^src/index\\.ts$",
        cmd: [...tsx, "test/enotdir.test.ts"],
        modules: local,
        why: /ENOTDIR/,
        restores: /ENOTDIR/,
      },
    ],
  };
}

test("the parent file fails the published check because the repair is absent, in-process and inside bwrap", (t) => {
  if (!practiceSandboxReady()) { t.skip("bwrap is not installed"); return; }
  const node = visibleNodeBin();
  assert.ok(node);
  const built = rows();
  for (const row of built.list) {
    const dir = mkdtempSync(join(tmpdir(), "m269-kill-"));
    place(dir, { ...row.files, ".gitignore": "node_modules\n" });
    symlinkSync(row.modules, join(dir, "node_modules"));
    gitInit(dir);
    const direct = spawnSync(row.cmd[0]!, row.cmd.slice(1), { cwd: dir, encoding: "utf8" });
    const directOut = `${direct.stdout}\n${direct.stderr}`;
    assert.notEqual(direct.status, 0, directOut.slice(-800));
    assert.match(directOut, row.why, directOut.slice(-800));
    assert.doesNotMatch(directOut, /ReferenceError|SyntaxError|TransformError/, directOut.slice(-400));
    const sand = runInPracticeSandbox(dir, row.cmd, 120_000, { capture: true, nodePath: node, nodeModules: row.modules });
    assert.equal(sand.unsafe, false);
    assert.notEqual(sand.code, 0, sand.stdout.slice(-800));
    assert.match(sand.stdout, row.why, sand.stdout.slice(-800));
    const repaired = repairBatch18({
      root: dir, output: directOut, sourcePattern: row.pattern, nodePath: node!, nodeModules: row.modules, testCommand: row.cmd,
    });
    assert.ok(repaired, directOut.slice(-800));
    assert.match(repaired!.diff, row.restores);
    rmSync(dir, { recursive: true, force: true });
  }
  for (const dir of built.mods) rmSync(resolve(dir, ".."), { recursive: true, force: true });
});

test("an any-cast that only matches one recorded answer is test-only for each batch 18 family", (t) => {
  if (!practiceSandboxReady()) { t.skip("bwrap is not installed"); return; }
  const node = visibleNodeBin();
  assert.ok(node);
  for (const symbol of ["skipInternalRoute", "detectFormat", "isPackageExists"]) {
    const strict = `export function ${symbol}(kind: string): string {\n  return kind === "b" ? "B" : "A";\n}\n`;
    const over = `export function ${symbol}(kind: any): string {\n  return "A";\n}\n`;
    const make = (body: string) => {
      const dir = mkdtempSync(join(tmpdir(), "m269-grade-"));
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

test("the published ungh, confbox, and local-pkg checks fail before the repair and pass after, inside the sandbox", (t) => {
  if (!practiceSandboxReady()) { t.skip("bwrap is not installed"); return; }
  const node = visibleNodeBin();
  assert.ok(node);
  const built = rows();
  for (const row of built.list) {
    const dir = mkdtempSync(join(tmpdir(), "m269-run-"));
    place(dir, { ...row.files, ".gitignore": "node_modules\n" });
    symlinkSync(row.modules, join(dir, "node_modules"));
    gitInit(dir);
    const before = runInPracticeSandbox(dir, row.cmd, 120_000, { capture: true, nodePath: node, nodeModules: row.modules });
    assert.equal(before.unsafe, false, before.stdout.slice(-400));
    assert.notEqual(before.code, 0, before.stdout.slice(-400));
    const repaired = repairBatch18({
      root: dir, output: before.stdout, sourcePattern: row.pattern, nodePath: node!, nodeModules: row.modules, testCommand: row.cmd,
    });
    assert.ok(repaired, before.stdout.slice(-800));
    assert.match(repaired!.diff, row.restores);
    rmSync(dir, { recursive: true, force: true });
  }
  for (const dir of built.mods) rmSync(resolve(dir, ".."), { recursive: true, force: true });
});
