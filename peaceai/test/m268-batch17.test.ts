// Batch 17. The library files are the published parent and the published test.
// Third-party bytes run only inside the practice sandbox.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { ensureConfigDir, quoteDigitKey, repairBatch17, safeTarName } from "../lib/batch17.ts";
import { gradeBehavior } from "../lib/specgrade.ts";
import { practiceSandboxReady, runInPracticeSandbox, visibleNodeBin } from "../lib/practicemine.ts";

const repoRoot = resolve(import.meta.dirname, "../..");
const fix = resolve(import.meta.dirname, "fixtures/m268");
const readFix = (name: string) => readFileSync(join(fix, name), "utf8");
const modules = resolve(repoRoot, "node_modules");

function place(root: string, files: Record<string, string | Buffer>) {
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

function runtimeModules(kind: "plain" | "untyped" | "rc9"): string {
  const dir = mkdtempSync(join(tmpdir(), "m268-mods-"));
  const nm = join(dir, "node_modules");
  mkdirSync(nm);
  for (const name of ["tsx", "esbuild", "@esbuild"]) {
    const copied = spawnSync("cp", ["-a", join(modules, name), join(nm, name)], { stdio: "ignore" });
    assert.equal(copied.status, 0, name);
  }
  const stub = (name: string, body: string) => {
    mkdirSync(join(nm, name), { recursive: true });
    writeFileSync(join(nm, name, "package.json"), `{"type":"module","exports":{".":"./index.js"}}\n`);
    writeFileSync(join(nm, name, "index.js"), body);
  };
  mkdirSync(join(nm, "vitest"));
  writeFileSync(join(nm, "vitest/package.json"), `{"type":"module","exports":{".":"./index.js"}}\n`);
  writeFileSync(join(nm, "vitest/index.js"), readFileSync(join(import.meta.dirname, "m268-vitest-shim.js")));
  if (kind === "untyped") {
    stub("scule", "export function pascalCase(s){return String(s).replace(/(^|[^A-Za-z0-9]+)([A-Za-z0-9])/g,(_,a,c)=>c.toUpperCase()).replace(/[^A-Za-z0-9]/g,'')}\n");
    mkdirSync(join(nm, "knitwork/dist"), { recursive: true });
    writeFileSync(join(nm, "knitwork/package.json"), `{"type":"module","exports":{".":"./dist/index.mjs"}}\n`);
    writeFileSync(join(nm, "knitwork/dist/index.mjs"), readFix("knitwork-dist-index.mjs.txt"));
  }
  if (kind === "rc9") {
    stub("destr", "export default function destr(v){ if (typeof v!=='string') return v; const s=v.trim(); if (s==='') return ''; try { return JSON.parse(s); } catch { return v; } }\n");
    stub("flat", "export function flatten(obj, prefix=''){ const out={}; if (!obj||typeof obj!=='object') return out; for (const [k,v] of Object.entries(obj)) { const key=prefix?prefix+'.'+k:k; if (v&&typeof v==='object'&&!Array.isArray(v)) Object.assign(out, flatten(v, key)); else out[key]=v; } return out; }\nexport function unflatten(obj){ const out={}; for (const [k,v] of Object.entries(obj||{})) { const parts=k.split('.'); let cur=out; for (let i=0;i<parts.length-1;i++){ if (!cur[parts[i]]||typeof cur[parts[i]]!=='object') cur[parts[i]]={}; cur=cur[parts[i]]; } cur[parts[parts.length-1]]=v; } return out; }\n");
    stub("defu", "export function defu(a,b){ const out={...(b||{})}; for (const [k,v] of Object.entries(a||{})) { if (v&&typeof v==='object'&&!Array.isArray(v)&&out[k]&&typeof out[k]==='object'&&!Array.isArray(out[k])) out[k]=defu(v,out[k]); else out[k]=v; } return out; }\n");
  }
  return nm;
}

const rows = () => {
  const plain = runtimeModules("plain");
  const untyped = runtimeModules("untyped");
  const rc9 = runtimeModules("rc9");
  const node = visibleNodeBin()!;
  const tsx = [node, "node_modules/tsx/dist/cli.mjs"];
  return {
    plain, untyped, rc9,
    list: [
      {
        dest: "src/parse.ts",
        files: {
          "src/parse.ts": readFix("nt-src-parse.ts.txt"),
          "src/create.ts": readFix("nt-src-create.ts.txt"),
          "src/index.ts": readFix("nt-src-index.ts.txt"),
          "src/item-types.ts": readFix("nt-src-item-types.ts.txt"),
          "src/types.ts": readFix("nt-src-types.ts.txt"),
          "test/parse.test.ts": readFix("nt-test-parse.test.ts.txt"),
          "test/fixtures/out/gnu.tar": readFileSync(join(fix, "nt-fixture-gnu.tar")),
          "test/fixtures/out/pax.tar": readFileSync(join(fix, "nt-fixture-pax.tar")),
          "test/fixtures/out/ustar.tar": readFileSync(join(fix, "nt-fixture-ustar.tar")),
          "test/fixtures/out/v7.tar": readFileSync(join(fix, "nt-fixture-v7.tar")),
          "package.json": `{"type":"module"}\n`,
        } as Record<string, string | Buffer>,
        pattern: "^src/parse\\.ts$",
        cmd: [...tsx, "test/parse.test.ts"],
        modules: plain,
        why: /\.\.\/\.\.\/etc\/passwd/,
        restores: /_sanitizePath/,
      },
      {
        dest: "src/generator/dts.ts",
        files: {
          "src/index.ts": readFix("ut-src-index.ts.txt"),
          "src/schema.ts": readFix("ut-src-schema.ts.txt"),
          "src/utils.ts": readFix("ut-src-utils.ts.txt"),
          "src/types.ts": readFix("ut-src-types.ts.txt"),
          "src/generator/dts.ts": readFix("ut-src-generator-dts.ts.txt"),
          "src/generator/md.ts": readFix("ut-src-generator-md.ts.txt"),
          "test/types.test.ts": readFix("ut-test-types.test.ts.txt"),
          "package.json": `{"type":"module"}\n`,
        } as Record<string, string | Buffer>,
        pattern: "^src/generator/dts\\.ts$",
        cmd: [...tsx, "test/types.test.ts"],
        modules: untyped,
        why: /2ndKey: string/,
        restores: /genObjectKey/,
      },
      {
        dest: "src/index.ts",
        files: {
          "src/index.ts": readFix("rc-src-index.ts.txt"),
          "test/index.test.ts": readFix("rc-test-index.test.ts.txt"),
          "package.json": `{"private":true}\n`,
        } as Record<string, string | Buffer>,
        pattern: "^src/index\\.ts$",
        cmd: [...tsx, "test/index.test.ts"],
        modules: rc9,
        why: /ENOENT/,
        restores: /mkdirSync/,
      },
    ],
  };
};

test("a tar name cannot climb out, and a check that is not parseTar is refused", () => {
  const source = readFix("nt-src-parse.ts.txt");
  const next = safeTarName(source);
  assert.match(next ?? "", /function _sanitizePath/);
  assert.equal(safeTarName(next!), null);
  assert.equal(safeTarName(source.replace("export function parseTar<", "export function kept<")), null);
});

test("a digit-leading key is quoted, and a check that is not generateTypes is refused", () => {
  const source = readFix("ut-src-generator-dts.ts.txt");
  const next = quoteDigitKey(source);
  assert.match(next ?? "", /genObjectKey/);
  assert.equal(quoteDigitKey(next!), null);
  assert.equal(quoteDigitKey(source.replace("export function generateTypes(", "export function kept(")), null);
});

test("a missing config directory is created, and a check that is not this writer is refused", () => {
  const source = readFix("rc-src-index.ts.txt");
  const next = ensureConfigDir(source);
  assert.match(next ?? "", /mkdirSync/);
  assert.equal(ensureConfigDir(next!), null);
  assert.equal(ensureConfigDir(source.replace("export function write<", "export function kept<")), null);
});

test("the parent file fails the published check because the repair is absent, in-process and inside bwrap", (t) => {
  if (!practiceSandboxReady()) { t.skip("bwrap is not installed"); return; }
  const node = visibleNodeBin();
  assert.ok(node);
  const built = rows();
  for (const row of built.list) {
    const dir = mkdtempSync(join(tmpdir(), "m268-kill-"));
    place(dir, { ...row.files, ".gitignore": "node_modules\n" });
    symlinkSync(row.modules, join(dir, "node_modules"));
    gitInit(dir);
    const direct = spawnSync(row.cmd[0]!, row.cmd.slice(1), { cwd: dir, encoding: "utf8" });
    const directOut = `${direct.stdout}\n${direct.stderr}`;
    assert.notEqual(direct.status, 0, directOut.slice(-700));
    assert.match(directOut, row.why, directOut.slice(-700));
    assert.doesNotMatch(directOut, /ReferenceError|SyntaxError|TransformError/, row.dest);
    const sand = runInPracticeSandbox(dir, row.cmd, 120_000, { capture: true, nodePath: node, nodeModules: row.modules });
    assert.equal(sand.unsafe, false, row.dest);
    assert.notEqual(sand.code, 0, sand.stdout.slice(-700));
    assert.match(sand.stdout, row.why, sand.stdout.slice(-700));
    const repaired = repairBatch17({
      root: dir, output: directOut, sourcePattern: row.pattern, nodePath: node!, nodeModules: row.modules, testCommand: row.cmd,
    });
    assert.ok(repaired, row.dest);
    assert.match(repaired!.diff, row.restores, row.dest);
    rmSync(dir, { recursive: true, force: true });
  }
  for (const dir of [built.plain, built.untyped, built.rc9]) rmSync(resolve(dir, ".."), { recursive: true, force: true });
});

test("an any-cast that only matches one recorded answer is test-only for each batch 17 family", (t) => {
  if (!practiceSandboxReady()) { t.skip("bwrap is not installed"); return; }
  const node = visibleNodeBin();
  assert.ok(node);
  for (const symbol of ["parseTar", "generateTypes", "write"]) {
    const strict = `export function ${symbol}(kind: string): string {\n  return kind === "b" ? "B" : "A";\n}\n`;
    const over = `export function ${symbol}(kind: any): string {\n  return "A";\n}\n`;
    const make = (body: string) => {
      const dir = mkdtempSync(join(tmpdir(), "m268-grade-"));
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

test("the published nanotar, untyped, and rc9 checks fail before the repair and pass after, inside the sandbox", (t) => {
  if (!practiceSandboxReady()) { t.skip("bwrap is not installed"); return; }
  const node = visibleNodeBin();
  assert.ok(node);
  const built = rows();
  for (const row of built.list) {
    const dir = mkdtempSync(join(tmpdir(), "m268-run-"));
    place(dir, { ...row.files, ".gitignore": "node_modules\n" });
    symlinkSync(row.modules, join(dir, "node_modules"));
    gitInit(dir);
    const before = runInPracticeSandbox(dir, row.cmd, 120_000, { capture: true, nodePath: node, nodeModules: row.modules });
    assert.equal(before.unsafe, false, before.stdout.slice(-400));
    assert.notEqual(before.code, 0, before.stdout.slice(-400));
    const repaired = repairBatch17({
      root: dir, output: before.stdout, sourcePattern: row.pattern, nodePath: node!, nodeModules: row.modules, testCommand: row.cmd,
    });
    assert.ok(repaired, before.stdout.slice(-800));
    assert.match(repaired!.diff, row.restores);
    rmSync(dir, { recursive: true, force: true });
  }
  for (const dir of [built.plain, built.untyped, built.rc9]) rmSync(resolve(dir, ".."), { recursive: true, force: true });
});
