// Batch 26. The library files are the published parent and the published test.
// Third-party bytes run only inside the practice sandbox.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { corsOriginSearch, emptyTildeSelector, parserResetStack, repairBatch26 } from "../lib/batch26.ts";
import { gradeBehavior } from "../lib/specgrade.ts";
import { practiceSandboxReady, runInPracticeSandbox, visibleNodeBin } from "../lib/practicemine.ts";

const fix = resolve(import.meta.dirname, "fixtures/m277");
const place = JSON.parse(readFileSync(join(import.meta.dirname, "m277-place.json"), "utf8")) as Record<string, string>;
const npmFix = resolve(import.meta.dirname, "fixtures/m277-npm");

function childEnv(extra: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, ...extra };
  delete env.NODE_TEST_CONTEXT;
  delete env.NODE_TEST_WORKER_ID;
  return env;
}

function placeFiles(root: string, files: Record<string, string | Buffer>) {
  for (const [path, content] of Object.entries(files)) {
    const dest = path.replaceAll("__SCOPE__", "@");
    mkdirSync(join(root, dest, ".."), { recursive: true });
    writeFileSync(join(root, dest), content);
  }
}

function gitInit(root: string) {
  const git = (args: string[]) => spawnSync("git", ["-C", root, ...args], { stdio: "ignore" });
  git(["init", "-q"]);
  git(["add", "-A"]);
  git(["-c", "user.email=t@example.com", "-c", "user.name=t", "commit", "-qm", "base"]);
}

function filesOf(prefix: string): Record<string, Buffer> {
  const out: Record<string, Buffer> = {};
  for (const [fixture, dest] of Object.entries(place)) {
    if (!fixture.startsWith(prefix)) continue;
    out[dest] = readFileSync(join(fix, fixture));
  }
  return out;
}

function text(name: string): string {
  return readFileSync(join(fix, name), "utf8");
}

let cachedMods: string | null = null;
function runtime(): string {
  if (cachedMods) return cachedMods;
  const dir = mkdtempSync(join(tmpdir(), "m277-mods-"));
  const nm = join(dir, "node_modules");
  mkdirSync(nm, { recursive: true });
  // Install pinned third-party deps from the lock-only fixture (registry needed once).
  const depDir = mkdtempSync(join(tmpdir(), "m277-npm-"));
  cpSync(npmFix, depDir, { recursive: true });
  const install = spawnSync("npm", ["ci", "--ignore-scripts", "--no-audit", "--no-fund", "--loglevel=error"], {
    cwd: depDir, encoding: "utf8", timeout: 300_000,
  });
  assert.equal(install.status, 0, install.stderr.slice(0, 800));
  for (const name of readdirSync(join(depDir, "node_modules"))) {
    if (name === ".bin") continue;
    const src = join(depDir, "node_modules", name);
    assert.equal(spawnSync("cp", ["-a", src, join(nm, name)], { stdio: "ignore" }).status, 0, name);
  }
  cachedMods = nm;
  rmSync(depDir, { recursive: true, force: true });
  return nm;
}

test("a reset inside onclosetag stops further implicit closes, and a check that is not Parser is refused", () => {
  const source = text("hp-src-Parser.ts.txt");
  const next = parserResetStack(source);
  assert.match(next ?? "", /while \(this\.stack\.length > pos \+ 1\)/);
  assert.equal(parserResetStack(next!), null);
  assert.equal(parserResetStack(source.replace("export class Parser", "export class kept")), null);
});

test("an empty ~= selector compiles to a never-match, and a check that is not attributeRules is refused", () => {
  const source = text("cs-src-attributes.ts.txt");
  const next = emptyTildeSelector(source);
  assert.match(next ?? "", /!value \|\| whitespaceRe\.test\(value\)/);
  assert.equal(emptyTildeSelector(next!), null);
  assert.equal(emptyTildeSelector(source.replace("export const attributeRules", "export const kept")), null);
});

test("stateful CORS origin regexes are checked without consuming lastIndex, and a check that is not isCorsOriginAllowed is refused", () => {
  const source = text("h3-src-utils-internal-cors.ts.txt");
  const next = corsOriginSearch(source);
  assert.match(next ?? "", /origin\.search\(_origin\) !== -1/);
  assert.equal(corsOriginSearch(next!), null);
  assert.equal(corsOriginSearch(source.replace("export function isCorsOriginAllowed", "export function kept")), null);
});

function rows() {
  const node = visibleNodeBin()!;
  const mods = runtime();
  const typed = (prefix: string, pkg: string) => {
    const files: Record<string, Buffer> = { ...filesOf(prefix) };
    if (!files["package.json"]) {
      files["package.json"] = Buffer.from(`{"name":${JSON.stringify(pkg)},"type":"module"}\n`);
    }
    // The published css-select suite lives at test/attributes.ts, which is not a *.test.ts
    // or *.spec.ts path. A CommonJS config is written here so Vitest includes it without
    // writing a bundled ESM config into node_modules (that path is read-only in bwrap).
    if (prefix === "cs-" && !files["vitest.config.cjs"]) {
      files["vitest.config.cjs"] = Buffer.from(
        'module.exports = { test: { include: ["test/*.ts", "**/*.spec.ts"], environment: "node" } };\n',
      );
    }
    return files;
  };
  return {
    mods,
    list: [
      {
        files: typed("hp-", "htmlparser2"),
        pattern: "^src/Parser\\.ts$",
        cmd: [node, "node_modules/vitest/vitest.mjs", "run", "src/Parser.spec.ts"],
        why: /stop closing elements after reset|to strictly equal|undefined/,
        restores: /while \(this\.stack\.length > pos \+ 1\)/,
      },
      {
        files: typed("cs-", "css-select"),
        pattern: "^src/attributes\\.ts$",
        cmd: [node, "node_modules/vitest/vitest.mjs", "run", "test/attributes.ts"],
        why: /empty value|falseFunc|AssertionError/,
        restores: /!value \|\| whitespaceRe\.test\(value\)/,
      },
      {
        files: typed("h3-", "h3"),
        pattern: "^src/utils/internal/cors\\.ts$",
        cmd: [node, "node_modules/vitest/vitest.mjs", "run", "test/unit/cors.test.ts"],
        why: /stateful origin regex|expected false to be true|AssertionError/,
        restores: /origin\.search\(_origin\) !== -1/,
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
    const dir = mkdtempSync(join(tmpdir(), "m277-kill-"));
    placeFiles(dir, { ...row.files, ".gitignore": "node_modules\n" });
    symlinkSync(built.mods, join(dir, "node_modules"));
    gitInit(dir);
    const direct = spawnSync(row.cmd[0]!, row.cmd.slice(1), {
      cwd: dir, encoding: "utf8", timeout: 180_000, env: childEnv(),
    });
    const directOut = `${direct.stdout}\n${direct.stderr}`;
    assert.notEqual(direct.status, 0, directOut.slice(-1200));
    assert.match(directOut, row.why, directOut.slice(-1200));
    assert.doesNotMatch(directOut, /ReferenceError|SyntaxError|TransformError/, directOut.slice(-400));
    const sand = runInPracticeSandbox(dir, row.cmd, 180_000, { capture: true, nodePath: node, nodeModules: built.mods });
    assert.equal(sand.unsafe, false, sand.stdout.slice(-400));
    assert.notEqual(sand.code, 0, sand.stdout.slice(-1200));
    assert.match(sand.stdout, row.why, sand.stdout.slice(-1200));
    const repaired = repairBatch26({
      root: dir, output: directOut, sourcePattern: row.pattern, nodePath: node!, nodeModules: built.mods, testCommand: row.cmd,
    });
    assert.ok(repaired, directOut.slice(-1200));
    assert.match(repaired!.diff, row.restores);
    rmSync(dir, { recursive: true, force: true });
  }
});

test("an any-cast that only matches one recorded answer is test-only for each batch 26 family", (t) => {
  if (!practiceSandboxReady()) { t.skip("bwrap is not installed"); return; }
  const node = visibleNodeBin();
  assert.ok(node);
  for (const symbol of ["Parser", "attributeRules", "isCorsOriginAllowed"]) {
    const strict = `export function ${symbol}(kind: string): string {\n  return kind === "b" ? "B" : "A";\n}\n`;
    const over = `export function ${symbol}(kind: any): string {\n  return "A";\n}\n`;
    const make = (body: string) => {
      const dir = mkdtempSync(join(tmpdir(), "m277-grade-"));
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

test("the published htmlparser2, css-select, and h3 checks fail before the repair and pass after, inside the sandbox", (t) => {
  if (!practiceSandboxReady()) { t.skip("bwrap is not installed"); return; }
  const node = visibleNodeBin();
  assert.ok(node);
  const built = rows();
  for (const row of built.list) {
    const dir = mkdtempSync(join(tmpdir(), "m277-run-"));
    placeFiles(dir, { ...row.files, ".gitignore": "node_modules\n" });
    symlinkSync(built.mods, join(dir, "node_modules"));
    gitInit(dir);
    const before = runInPracticeSandbox(dir, row.cmd, 180_000, { capture: true, nodePath: node, nodeModules: built.mods });
    assert.equal(before.unsafe, false, before.stdout.slice(-400));
    assert.notEqual(before.code, 0, before.stdout.slice(-800));
    const repaired = repairBatch26({
      root: dir, output: before.stdout, sourcePattern: row.pattern, nodePath: node!, nodeModules: built.mods, testCommand: row.cmd,
    });
    assert.ok(repaired, before.stdout.slice(-1200));
    assert.match(repaired!.diff, row.restores);
    rmSync(dir, { recursive: true, force: true });
  }
});
