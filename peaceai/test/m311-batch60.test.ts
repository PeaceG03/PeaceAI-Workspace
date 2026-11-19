// Batch 60. The library files are the published parent and the published test.
// Third-party bytes run only inside the practice sandbox.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { dropTildeFromDefaultListItemBullets, forwardRemainingArgsWithApplyInCollectionVisit, passKeyToIsMatchInFilterValues, repairBatch60 } from "../lib/batch60.ts";
import { gradeBehavior } from "../lib/specgrade.ts";
import { practiceSandboxReady, runInPracticeSandbox, visibleNodeBin } from "../lib/practicemine.ts";

process.env.TZ = "UTC";

const fix = resolve(import.meta.dirname, "fixtures/m311");
const place = JSON.parse(readFileSync(join(import.meta.dirname, "m311-place.json"), "utf8")) as Record<string, string>;
const npmFix = resolve(import.meta.dirname, "fixtures/m311-npm");

function childEnv(extra: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, TZ: "UTC", ...extra };
  delete env.NODE_TEST_CONTEXT;
  delete env.NODE_TEST_WORKER_ID;
  delete env.NO_COLOR;
  delete env.FORCE_COLOR;
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
  const dir = mkdtempSync(join(tmpdir(), "m311-mods-"));
  const nm = join(dir, "node_modules");
  mkdirSync(nm, { recursive: true });
  const depDir = mkdtempSync(join(tmpdir(), "m311-npm-"));
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

const PRIVATE_PKG = `{ "private": true }
`;

test("list-item drops the tilde from the default bullets, and a check that is not that default list is refused", () => {
  const source = text("li-index.js.txt");
  const next = dropTildeFromDefaultListItemBullets(source);
  assert.match(next ?? "", /opts\.chars \|\| \['-', '\*', '\+'\];/);
  assert.equal(dropTildeFromDefaultListItemBullets(next!), null);
  assert.equal(dropTildeFromDefaultListItemBullets(source.replace("  var chars = opts.chars || ['-', '*', '+', '~'];", "  var chars = opts.chars || ['-', '*', '+', '~']; ")), null);
});

test("collection-visit forwards remaining arguments with apply, and a check that is not that argument forwarding is refused", () => {
  const source = text("cv-index.js.txt");
  const next = forwardRemainingArgsWithApplyInCollectionVisit(source);
  assert.match(next ?? "", /mapVisit\.apply\(null, arguments\)/);
  assert.equal(forwardRemainingArgsWithApplyInCollectionVisit(next!), null);
  assert.equal(forwardRemainingArgsWithApplyInCollectionVisit(source.replace("    result = utils.mapVisit(collection, method, val);", "    result = utils.mapVisit(collection, method, val); ")), null);
});

test("filter-values passes the key to isMatch, and a check that is not that key argument is refused", () => {
  const source = text("fv-index.js.txt");
  const next = passKeyToIsMatchInFilterValues(source);
  assert.match(next ?? "", /isMatch\(val,key\)/);
  assert.equal(passKeyToIsMatchInFilterValues(next!), null);
  assert.equal(passKeyToIsMatchInFilterValues(source.replace("    if (isMatch(val)) {", "    if (isMatch(val)) { ")), null);
});

function rows() {
  const node = visibleNodeBin()!;
  const mods = runtime();
  return {
    mods,
    list: [
      {
        files: { ...filesOf("li-"), "package.json": Buffer.from(PRIVATE_PKG) },
        pattern: "^index\\.js$",
        cmd: [node, "node_modules/mocha/bin/mocha.js", "test.js"],
        why: /~ a' to be '/,
        restores: /opts\.chars \|\| \['-', '\*', '\+'\];/,
      },
      {
        files: { ...filesOf("cv-"), "package.json": Buffer.from(PRIVATE_PKG) },
        pattern: "^index\\.js$",
        cmd: [node, "node_modules/mocha/bin/mocha.js", "test.js"],
        why: /'undefined' == 'function'/,
        restores: /mapVisit\.apply\(null, arguments\)/,
      },
      {
        files: { ...filesOf("fv-"), "package.json": Buffer.from(PRIVATE_PKG) },
        pattern: "^index\\.js$",
        cmd: [node, "node_modules/mocha/bin/mocha.js", "test.js"],
        why: /expected Object \{\} to equal Object \{ b: 'b' \}/,
        restores: /isMatch\(val,key\)/,
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
    const dir = mkdtempSync(join(tmpdir(), "m311-kill-"));
    placeFiles(dir, { ...row.files, ".gitignore": "node_modules\n" });
    symlinkSync(built.mods, join(dir, "node_modules"));
    gitInit(dir);
    const direct = spawnSync(row.cmd[0]!, row.cmd.slice(1), {
      cwd: dir, encoding: "utf8", timeout: 180_000, env: childEnv({ HOME: join(dir, ".home") }),
    });
    const directOut = `${direct.stdout}\n${direct.stderr}`;
    assert.notEqual(direct.status, 0, directOut.slice(-1200));
    assert.match(directOut, row.why, directOut.slice(-1200));
    assert.doesNotMatch(directOut, /ReferenceError/, directOut.slice(-400));
    const sand = runInPracticeSandbox(dir, row.cmd, 180_000, { capture: true, nodePath: node, nodeModules: built.mods });
    assert.equal(sand.unsafe, false, sand.stdout.slice(-400));
    assert.notEqual(sand.code, 0, sand.stdout.slice(-1200));
    assert.match(sand.stdout, row.why, sand.stdout.slice(-1200));
    const repaired = repairBatch60({
      root: dir, output: directOut, sourcePattern: row.pattern, nodePath: node!, nodeModules: built.mods, testCommand: row.cmd,
    });
    assert.ok(repaired, directOut.slice(-1200));
    assert.match(repaired!.diff, row.restores);
    rmSync(dir, { recursive: true, force: true });
  }
});

test("an any-cast that only matches one recorded answer is test-only for each batch 60 family", (t) => {
  if (!practiceSandboxReady()) { t.skip("bwrap is not installed"); return; }
  const node = visibleNodeBin();
  assert.ok(node);
  for (const symbol of ["listitem", "collectionVisit", "filterValues"]) {
    const strict = `export function ${symbol}(kind: string): string {\n  return kind === "b" ? "B" : "A";\n}\n`;
    const over = `export function ${symbol}(kind: any): string {\n  return "A";\n}\n`;
    const make = (body: string) => {
      const dir = mkdtempSync(join(tmpdir(), "m311-grade-"));
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

test("the published list-item, collection-visit, and filter-values checks fail before the repair and pass after, inside the sandbox", (t) => {
  if (!practiceSandboxReady()) { t.skip("bwrap is not installed"); return; }
  const node = visibleNodeBin();
  assert.ok(node);
  const built = rows();
  for (const row of built.list) {
    const dir = mkdtempSync(join(tmpdir(), "m311-run-"));
    placeFiles(dir, { ...row.files, ".gitignore": "node_modules\n" });
    symlinkSync(built.mods, join(dir, "node_modules"));
    gitInit(dir);
    const before = runInPracticeSandbox(dir, row.cmd, 180_000, { capture: true, nodePath: node, nodeModules: built.mods });
    assert.equal(before.unsafe, false, before.stdout.slice(-400));
    assert.notEqual(before.code, 0, before.stdout.slice(-800));
    const repaired = repairBatch60({
      root: dir, output: before.stdout, sourcePattern: row.pattern, nodePath: node!, nodeModules: built.mods, testCommand: row.cmd,
    });
    assert.ok(repaired, before.stdout.slice(-1200));
    assert.match(repaired!.diff, row.restores);
    rmSync(dir, { recursive: true, force: true });
  }
});
