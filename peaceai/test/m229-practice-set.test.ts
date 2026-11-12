// Mixed practice set. credit is false. The held-out hash and the training-exclusion check live here
// because the corpus and pair source lists are in files this change does not edit.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { keptLicense } from "../lib/practicemine.ts";
import { existsSync, lstatSync, mkdtempSync, mkdirSync, readdirSync, readFileSync as readText, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import {
  GIT_LOCK_ARGS, cloneRootProblems, dependencyFingerprint, ensurePracticeInstall, exclusionHits, extManifestProblems, falseRootProblems, heldOutHash, heldOutPairHash, heldOutWatchProblems, installArgv, INSTALL_TIMEOUT_MS, installEnv, isSourceFile, isTestFile, manifestProblems, SANDBOX_RAN, sanitizeInstallLines,
  pairFiles, pairProblems, parseRepoToken, poisonChanges, poisonStamp, practiceGit, practiceGitEnv, practiceSandboxArgv, practiceWatchFiles, releaseWorktree, rootProblems, runInPracticeSandbox, sandboxHome, scrubEnv, testCommandFor, trainingSources, visibleNodeBin,
  type CorpusRoots, type PracticeManifest, type PracticePair, type PracticeRepo,
} from "../lib/practicemine.ts";
import { countBySplit, gradePracticeRow, replayDocument, targetIsScorable } from "../lib/practicereplay.ts";
import { loadTargets, scopeOf } from "../lib/target.ts";

const repo = join(import.meta.dirname, "../..");
const read = (path: string) => readFileSync(join(repo, path), "utf8");
const manifest = JSON.parse(read("practice/manifest.json")) as PracticeManifest;
const rootsFile = JSON.parse(read("practice/corpus-roots.json")) as CorpusRoots;

const repoOf = (over: Partial<PracticeRepo>): PracticeRepo => ({
  name: "example/lib", commit: "a".repeat(40), root: "b".repeat(40), license: "MIT", licenseFile: "LICENSE", split: "dev", upstreams: [], ...over,
});

test("a root LICENSE is kept only when it is one permissive license", () => {
  assert.equal(keptLicense(null), null);
  assert.equal(keptLicense("GNU GENERAL PUBLIC LICENSE Version 3"), null);
  assert.equal(keptLicense("MIT License\nPermission is hereby granted, free of charge, to any person obtaining a copy of this software. PROVIDED \"AS IS\""), "MIT");
  assert.equal(keptLicense("Apache License\n Version 2.0, January 2004\n http://www.apache.org/licenses/"), "Apache-2.0");
});

test("a candidate needs one test file and at least one non-test source", () => {
  assert.equal(isTestFile("src/a.test.ts"), true);
  assert.equal(isTestFile("test/a.ts"), true);
  assert.equal(isSourceFile("src/a.ts"), true);
  assert.equal(isSourceFile("src/a.test.ts"), false);
  assert.equal(isSourceFile("src/a.d.ts"), false);
  assert.deepEqual(pairFiles([{ status: "M", path: "src/a.ts" }, { status: "M", path: "src/a.test.ts" }]), { testFile: "src/a.test.ts", sources: ["src/a.ts"] });
  assert.equal(pairFiles([{ status: "M", path: "src/a.test.ts" }]), null);
  assert.equal(pairFiles([{ status: "M", path: "src/a.ts" }]), null);
  assert.equal(pairFiles([{ status: "D", path: "src/a.ts" }, { status: "M", path: "src/a.test.ts" }]), null);
  assert.equal(pairFiles([{ status: "M", path: "src/a.ts" }, { status: "M", path: "src/a.test.ts" }, { status: "A", path: "src/b.test.ts" }]), null);
});

test("the test command is an argv for one file, and install hooks are ignored", () => {
  assert.deepEqual(testCommandFor({ scripts: { test: "node --experimental-transform-types --test test/test.ts" } }, "test/test.ts"), ["node", "--experimental-transform-types", "--test", "test/test.ts"]);
  assert.deepEqual(testCommandFor({ devDependencies: { vitest: "^1" }, scripts: { test: "vitest run" } }, "test/a.test.ts"), ["./node_modules/.bin/vitest", "run", "test/a.test.ts"]);
  assert.equal(testCommandFor({ scripts: { test: "make test" } }, "test/a.test.ts"), null);
  assert.deepEqual(installArgv({ npm: true, pnpm: false, yarn: false }, true), ["npm", "ci", "--ignore-scripts", "--no-audit", "--no-fund"]);
  assert.deepEqual(installArgv({ npm: false, pnpm: true, yarn: false }, true), ["pnpm", "install", "--ignore-scripts"]);
  assert.deepEqual(installArgv({ npm: false, pnpm: false, yarn: true }, true, true), ["corepack", "yarn", "install", "--mode=skip-build"]);
  assert.equal(installArgv({ npm: false, pnpm: false, yarn: false }, false), null);
});

test("third-party env is an allowlist, and the sandbox is bubblewrap with no unshare fallback", () => {
  const env = scrubEnv({ PATH: "/usr/bin", HOME: "/home/user", GH_TOKEN: "secret", GITHUB_TOKEN: "secret", AWS_SECRET_ACCESS_KEY: "secret", NPM_TOKEN: "secret", NODE_OPTIONS: "--require pwn" }, "/work");
  assert.equal(env.PATH, "/usr/bin");
  assert.equal(env.HOME, "/home/user");
  assert.equal(env.PWD, "/work");
  assert.equal(env.GH_TOKEN, undefined);
  assert.equal(env.GITHUB_TOKEN, undefined);
  assert.equal(env.AWS_SECRET_ACCESS_KEY, undefined);
  assert.equal(env.NPM_TOKEN, undefined);
  assert.equal(env.NODE_OPTIONS, undefined);
  const argv = practiceSandboxArgv("/work/pair");
  assert.ok(argv);
  assert.equal(argv[0], "bwrap");
  assert.ok(argv.includes("--ro-bind") && argv.includes("/usr") && argv.includes("--unshare-net") && argv.includes("--unshare-pid"));
  assert.ok(argv.includes("--die-with-parent") && argv.includes("--new-session"));
  assert.equal(argv.includes("unshare"), false);
  assert.equal(argv.some((arg, i) => (argv[i - 1] === "--ro-bind" || argv[i - 1] === "--bind") && arg === "/"), false);
  assert.equal(practiceSandboxArgv("relative"), null);
});

test("the practice sandbox hides a fake home, refuses outside writes, and has no network", (t) => {
  if (spawnSync("bwrap", ["--version"], { stdio: "ignore" }).error) {
    t.skip("bwrap is not installed on this host");
    return;
  }
  const node = visibleNodeBin();
  assert.ok(node, "a node binary outside the covered paths");
  const realHome = mkdtempSync(join(tmpdir(), "practice-real-home-"));
  const work = mkdtempSync(join(tmpdir(), "practice-sbx-"));
  const outside = `/usr/practice-outside-${process.pid}`;
  try {
    mkdirSync(join(realHome, ".config"), { recursive: true });
    writeFileSync(join(realHome, ".config", "marker"), "SECRET-MARKER");
    const script = [
      "const fs = require('fs'); const http = require('http');",
      "const [home, outside] = process.argv.slice(1);",
      "let read = 'blocked';",
      "try { read = fs.readFileSync(home + '/.config/marker', 'utf8').trim(); } catch (e) { read = 'blocked'; }",
      "let wrote = 'blocked';",
      "try { fs.writeFileSync(outside, 'x'); wrote = 'wrote'; } catch (e) { wrote = 'blocked'; }",
      "try { fs.writeFileSync('/tmp/practice-host-leak', 'x'); } catch (e) {}",
      "const req = http.get('http://example.com', () => { console.log(JSON.stringify({ read, wrote, net: 'up', home: process.env.HOME })); });",
      "req.on('error', () => { console.log(JSON.stringify({ read, wrote, net: 'down', home: process.env.HOME })); });",
      "req.setTimeout(1500, () => { req.destroy(); });",
    ].join("\n");
    const ran = runInPracticeSandbox(work, [node, "-e", script, realHome, outside], 10_000, { capture: true });
    assert.equal(ran.unsafe, false);
    assert.equal(ran.code, 0, ran.stdout);
    const body = JSON.parse(ran.stdout.trim().split("\n").at(-1)!) as { read: string; wrote: string; net: string; home: string };
    assert.equal(body.read, "blocked");
    assert.equal(body.wrote, "blocked");
    assert.equal(body.net, "down");
    assert.equal(body.home, sandboxHome(work));
    assert.equal(existsSync("/tmp/practice-host-leak"), false);
  } finally {
    rmSync(realHome, { recursive: true, force: true });
    rmSync(work, { recursive: true, force: true });
    rmSync(outside, { force: true });
  }
});

function bwrapHere(): boolean {
  return !spawnSync("bwrap", ["--version"], { stdio: "ignore" }).error;
}

function tinyRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "practice-poison-"));
  spawnSync("git", ["init", "-q", dir], { stdio: "ignore" });
  writeFileSync(join(dir, "package.json"), "{\"name\":\"p\"}\n");
  spawnSync("git", ["-C", dir, "add", "package.json"], { stdio: "ignore" });
  spawnSync("git", ["-C", dir, "-c", "user.email=t@example.com", "-c", "user.name=t", "commit", "-qm", "init"], { stdio: "ignore" });
  return dir;
}

test("git outside the sandbox ignores hooks and fsmonitor, and poison files refuse the next step", () => {
  assert.ok(GIT_LOCK_ARGS.includes("core.hooksPath=/dev/null"));
  assert.ok(GIT_LOCK_ARGS.includes("core.fsmonitor=false"));
  const env = practiceGitEnv();
  assert.equal(env.GIT_CONFIG_NOSYSTEM, "1");
  assert.ok(env.GIT_CONFIG_GLOBAL && env.GIT_CONFIG_GLOBAL.length > 0);
  const dir = tinyRepo();
  try {
    const hook = join(dir, ".git", "hooks", "post-checkout");
    mkdirSync(join(dir, ".git", "hooks"), { recursive: true });
    const marker = join(dir, "hook-ran");
    writeFileSync(hook, `#!/bin/sh\necho ran > ${JSON.stringify(marker)}\n`);
    spawnSync("chmod", ["+x", hook], { stdio: "ignore" });
    const monitor = join(dir, "fsmonitor");
    writeFileSync(monitor, `#!/bin/sh\necho ran > ${JSON.stringify(join(dir, "monitor-ran"))}\n`);
    spawnSync("chmod", ["+x", monitor], { stdio: "ignore" });
    practiceGit(dir, ["config", "core.fsmonitor", monitor]);
    assert.equal(practiceGit(dir, ["checkout", "-f", "HEAD"]).ok, true);
    assert.equal(existsSync(marker), false);
    assert.equal(existsSync(join(dir, "monitor-ran")), false);
    const before = poisonStamp(dir);
    writeFileSync(join(dir, ".pnpmfile.cjs"), "throw new Error('poison')\n");
    writeFileSync(join(dir, ".npmrc"), "ignore-scripts=false\n");
    writeFileSync(join(dir, ".yarnrc.yml"), "yarnPath: ./evil.js\n");
    writeFileSync(join(dir, "package.json"), "{\"name\":\"changed\"}\n");
    const changes = poisonChanges(before, poisonStamp(dir));
    assert.ok(changes.includes(".pnpmfile.cjs"));
    assert.ok(changes.includes(".npmrc"));
    assert.ok(changes.includes(".yarnrc.yml"));
    assert.ok(changes.includes("package.json"));
    const released = releaseWorktree(dir, before);
    assert.ok(released.poison.includes(".pnpmfile.cjs"));
    assert.equal(released.clean, true);
    assert.equal(existsSync(join(dir, ".pnpmfile.cjs")), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a renamed fork with a false corpus root fails closed", () => {
  const held = [{ name: "gcanti/fp-ts", root: "a".repeat(40) }];
  const recorded = { "renamed/fp-ts": "b".repeat(40) };
  assert.ok(falseRootProblems(held, recorded, { "renamed/fp-ts": null }).some((p) => p.startsWith("CLONE_UNVERIFIED")));
  const lied = falseRootProblems(held, recorded, {
    "renamed/fp-ts": {
      remoteUrl: "https://github.com/renamed/fp-ts.git",
      root: "a".repeat(40),
      parent: "gcanti/fp-ts",
      source: "gcanti/fp-ts",
      upstreamRoot: "a".repeat(40),
    },
  });
  assert.deepEqual(lied, ["FORK_FALSE_ROOT:renamed/fp-ts"]);
  assert.ok(falseRootProblems(held, { "missing/repo": "c".repeat(40) }, {}).some((p) => p === "CLONE_UNVERIFIED:missing/repo"));
  const parent = falseRootProblems([], { "good/lib": "c".repeat(40) }, {
    "good/lib": { remoteUrl: "https://github.com/other/lib.git", root: "c".repeat(40), parent: "someone/up", source: null, upstreamRoot: "c".repeat(40) },
  });
  assert.deepEqual(parent, ["REMOTE_NAME:good/lib"]);
  const mismatch = falseRootProblems([], { "good/lib": "b".repeat(40) }, {
    "good/lib": { remoteUrl: "https://github.com/good/lib.git", root: "c".repeat(40), parent: null, source: null, upstreamRoot: null },
  });
  assert.deepEqual(mismatch, ["ROOT_MISMATCH:good/lib"]);
  const forkRoot = falseRootProblems([], { "good/lib": "c".repeat(40) }, {
    "good/lib": { remoteUrl: "https://github.com/good/lib.git", root: "c".repeat(40), parent: "someone/up", source: null, upstreamRoot: "d".repeat(40) },
  });
  assert.deepEqual(forkRoot, ["FORK_ROOT:good/lib"]);
  assert.deepEqual(cloneRootProblems("a/b", "c".repeat(40), { root: "c".repeat(40), upstream: "other/up", upstreamRoot: "d".repeat(40) }), ["FORK_ROOT:a/b"]);
  const through = heldOutWatchProblems(
    [{ name: "gcanti/fp-ts", root: "a".repeat(40), upstreams: [] }],
    [],
    { "renamed/fp-ts": "b".repeat(40) },
    {},
    { "renamed/fp-ts": { remoteUrl: "https://github.com/renamed/fp-ts.git", root: "a".repeat(40), parent: "gcanti/fp-ts", source: "gcanti/fp-ts", upstreamRoot: "a".repeat(40) } },
  );
  assert.deepEqual(through, ["FORK_FALSE_ROOT:renamed/fp-ts"]);
});

test("install logs hide a home directory, and a fingerprint includes the lockfile", () => {
  const sample = "/" + "ho" + "me/" + "ubuntu/proj";
  const cleaned = sanitizeInstallLines(`npm ERR! ${sample}\nadded 1\nEUSAGE lock out of date`);
  assert.ok(cleaned.some((line) => line.includes("EUSAGE")));
  assert.ok(cleaned.findIndex((line) => line.includes("EUSAGE")) < cleaned.findIndex((line) => line.includes("added")));
  assert.equal(cleaned.join("\n").includes("ubuntu"), false);
  const tool = { manager: "npm" as const, managerVersion: "10.9.9", nodeVersion: "v22.23.4" };
  assert.notEqual(dependencyFingerprint("{}\n", "lock-a", tool), dependencyFingerprint("{}\n", "lock-b", tool));
  assert.equal(INSTALL_TIMEOUT_MS, 180_000);
  const home = mkdtempSync(join(tmpdir(), "practice-home-"));
  try {
    const node = visibleNodeBin();
    assert.ok(node);
    const env = installEnv(node, home, join(home, "store"), "npm");
    assert.equal(env.HOME, home);
    assert.equal(env.GIT_SSH_COMMAND, "false");
    assert.equal(env.HOME === process.env.HOME, false);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
  const mine = read("peaceai/bin/practice-mine.ts");
  const installFn = mine.slice(mine.indexOf("function install("), mine.indexOf("function runTest("));
  assert.equal(installFn.includes("installEnv("), true);
  assert.equal(installFn.includes("mkdtempSync("), true);
  assert.equal(installFn.includes("scrubEnv("), false);
  const body = ensurePracticeInstall.toString();
  assert.equal(body.includes("SANDBOX_RAN"), true);
  assert.equal(body.includes("is not in the base commit"), false);
});

test("a fifo or socket named like package-manager config is poison and is not read", { timeout: 5_000 }, () => {
  const dir = tinyRepo();
  try {
    assert.equal(spawnSync("mkfifo", [join(dir, ".npmrc")]).status, 0);
    const sock = join(dir, "yarn.lock");
    assert.equal(spawnSync("python3", ["-c", "import socket,sys; s=socket.socket(socket.AF_UNIX); s.bind(sys.argv[1])", sock]).status, 0);
    const device = join(dir, "package.json");
    const knotted = spawnSync("mknod", [device, "c", "1", "3"]);
    const stamp = poisonStamp(dir);
    assert.equal(stamp[".npmrc"], "special");
    assert.equal(stamp["yarn.lock"], "special");
    if (knotted.status === 0) assert.equal(stamp["package.json"], "special");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the sandbox argv covers a .git file with a file and mounts node_modules read-only", () => {
  const node = visibleNodeBin();
  assert.ok(node);
  const dir = mkdtempSync(join(tmpdir(), "practice-argv-"));
  try {
    writeFileSync(join(dir, ".git"), "gitdir: /tmp/real\n");
    mkdirSync(join(dir, "node_modules"));
    const argv = practiceSandboxArgv(dir, { nodePath: node, nodeModules: join(dir, "node_modules") });
    assert.ok(argv);
    const gitAt = argv.indexOf(join(dir, ".git"));
    assert.equal(argv[gitAt - 2], "--ro-bind");
    assert.equal(lstatSync(argv[gitAt - 1]!).isFile(), true);
    const modulesAt = argv.lastIndexOf(join(dir, "node_modules"));
    assert.equal(argv[modulesAt - 2], "--ro-bind");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("release restores a tracked file, a hook change is poison, and a sandboxed install dir is not reused", () => {
  const dir = tinyRepo();
  const cache = mkdtempSync(join(tmpdir(), "practice-ran-"));
  try {
    const hook = join(dir, ".git", "hooks", "post-checkout");
    mkdirSync(join(dir, ".git", "hooks"), { recursive: true });
    writeFileSync(hook, "#!/bin/sh\n");
    const before = poisonStamp(dir);
    writeFileSync(hook, "#!/bin/sh\necho changed\n");
    writeFileSync(join(dir, "package.json"), "{\"name\":\"changed\"}\n");
    assert.ok(poisonChanges(before, poisonStamp(dir)).includes(".git/hooks/post-checkout"));
    const released = releaseWorktree(dir, before);
    assert.equal(released.clean, true);
    assert.equal(readText(join(dir, "package.json"), "utf8"), "{\"name\":\"p\"}\n");
    const node = visibleNodeBin();
    assert.ok(node);
    const sha = spawnSync("git", ["-C", dir, "rev-parse", "HEAD"], { encoding: "utf8" }).stdout.trim();
    const tool = { nodePath: node, nodeVersion: "v22.23.4", manager: "none" as const, managerVersion: "none" };
    const first = ensurePracticeInstall(dir, { repo: "example/fresh", baseSha: sha, toolchain: tool }, cache, { npm: false, pnpm: false, yarn: false }, false);
    assert.equal(first.ok, true, first.lines.join("\n"));
    writeFileSync(join(cache, "installs", first.fingerprint!, SANDBOX_RAN), "1\n");
    const again = ensurePracticeInstall(dir, { repo: "example/fresh", baseSha: sha, toolchain: tool }, cache, { npm: false, pnpm: false, yarn: false }, false);
    assert.equal(again.reason, "SANDBOX_POISON");
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(cache, { recursive: true, force: true });
  }
});

test("the sandbox cannot write git metadata or package-manager config, and cannot read /opt or /var/lib", (t) => {
  if (!bwrapHere()) { t.skip("bwrap is not installed on this host"); return; }
  const node = visibleNodeBin();
  assert.ok(node);
  const dir = tinyRepo();
  const outside = mkdtempSync(join(tmpdir(), "practice-nm-"));
  try {
    writeFileSync(join(outside, "helper.js"), "module.exports = { answer: 7 };\n");
    spawnSync("ln", ["-s", outside, join(dir, "node_modules")], { stdio: "ignore" });
    const script = [
      "const fs = require('fs');",
      "const out = {};",
      "function see(p){ try { return fs.readFileSync(p,'utf8').slice(0,20); } catch(e){ return e.code; } }",
      "out.opt = see('/opt/sand-managed/marker');",
      "out.varlib = see('/var/lib/sand-box-runtime/marker');",
      "try { fs.mkdirSync('.git/hooks',{recursive:true}); fs.writeFileSync('.git/hooks/post-checkout','#!/bin/sh\\n'); out.hook='wrote'; } catch(e){ out.hook=e.code; }",
      "try { fs.appendFileSync('.git/config','\\n[core]\\n\\tfsmonitor=/tmp/evil\\n'); out.monitor='wrote'; } catch(e){ out.monitor=e.code; }",
      "fs.writeFileSync('.pnpmfile.cjs','throw 1\\n');",
      "fs.writeFileSync('.yarnrc.yml','yarnPath: ./evil.js\\n');",
      "fs.writeFileSync('.npmrc','ignore-scripts=false\\n');",
      "out.helper = require('helper').answer;",
      "console.log(JSON.stringify(out));",
    ].join("\n");
    const before = poisonStamp(dir);
    const ran = runInPracticeSandbox(dir, [node, "-e", script], 15_000, { capture: true, nodePath: node, nodeModules: join(dir, "node_modules") });
    assert.equal(ran.unsafe, false, ran.stdout);
    assert.equal(ran.code, 0, ran.stdout);
    const body = JSON.parse(ran.stdout.trim().split("\n").at(-1)!) as { opt: string; varlib: string; hook: string; monitor: string; helper: number };
    assert.equal(body.opt, "ENOENT");
    assert.equal(body.varlib, "ENOENT");
    assert.notEqual(body.hook, "wrote");
    assert.notEqual(body.monitor, "wrote");
    assert.equal(body.helper, 7);
    const changes = poisonChanges(before, poisonStamp(dir));
    assert.ok(changes.includes(".pnpmfile.cjs") && changes.includes(".yarnrc.yml") && changes.includes(".npmrc"));
    assert.equal(changes.some((p) => p.startsWith(".git")), false);
    const released = releaseWorktree(dir, before);
    assert.ok(released.poison.length > 0);
    assert.equal(existsSync(join(dir, ".pnpmfile.cjs")), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test("a correct candidate passes through the sandbox when node_modules is a symlink outside the work tree", (t) => {
  if (!bwrapHere()) { t.skip("bwrap is not installed on this host"); return; }
  const node = visibleNodeBin();
  assert.ok(node);
  const dir = tinyRepo();
  const outside = mkdtempSync(join(tmpdir(), "practice-nm-"));
  try {
    writeFileSync(join(outside, "helper.js"), "module.exports = { add: (a, b) => a + b };\n");
    spawnSync("ln", ["-s", outside, join(dir, "node_modules")], { stdio: "ignore" });
    writeFileSync(join(dir, "src.js"), "module.exports = () => 0;\n");
    writeFileSync(join(dir, "src.test.js"), "const test = require('node:test'); const assert = require('node:assert'); const fn = require('./src'); test('adds', () => assert.equal(fn(), require('helper').add(1, 1)));\n");
    const fail = runInPracticeSandbox(dir, [node, "--test", "src.test.js"], 15_000, { nodePath: node, nodeModules: join(dir, "node_modules") });
    assert.equal(fail.unsafe, false);
    assert.notEqual(fail.code, 0);
    writeFileSync(join(dir, "src.js"), "module.exports = () => 2;\n");
    const pass = runInPracticeSandbox(dir, [node, "--test", "src.test.js"], 15_000, { nodePath: node, nodeModules: join(dir, "node_modules") });
    assert.equal(pass.unsafe, false);
    assert.equal(pass.code, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test("the sandbox covers a .git directory and a worktree .git file", (t) => {
  if (!bwrapHere()) { t.skip("bwrap is not installed on this host"); return; }
  const node = visibleNodeBin();
  assert.ok(node);
  const repoDir = tinyRepo();
  const wt = mkdtempSync(join(tmpdir(), "practice-wt-"));
  rmSync(wt, { recursive: true, force: true });
  try {
    assert.equal(lstatSync(join(repoDir, ".git")).isDirectory(), true);
    const asDir = runInPracticeSandbox(repoDir, [node, "-e", "process.exit(0)"], 15_000, { capture: true, nodePath: node });
    assert.equal(asDir.unsafe, false, asDir.stdout);
    assert.equal(asDir.code, 0, asDir.stdout);
    const added = spawnSync("git", ["-C", repoDir, "worktree", "add", "--detach", wt, "HEAD"], { encoding: "utf8" });
    assert.equal(added.status, 0, added.stderr);
    assert.equal(lstatSync(join(wt, ".git")).isFile(), true);
    const asFile = runInPracticeSandbox(wt, [node, "-e", "process.exit(0)"], 15_000, { capture: true, nodePath: node });
    assert.equal(asFile.unsafe, false, asFile.stdout);
    assert.equal(asFile.code, 0, asFile.stdout);
  } finally {
    spawnSync("git", ["-C", repoDir, "worktree", "remove", "--force", wt], { stdio: "ignore" });
    rmSync(repoDir, { recursive: true, force: true });
    rmSync(wt, { recursive: true, force: true });
  }
});

test("a fresh clone with no node_modules is installed from the pinned base and the test runs", () => {
  const node = visibleNodeBin();
  assert.ok(node);
  const origin = tinyRepo();
  const fresh = mkdtempSync(join(tmpdir(), "practice-fresh-"));
  const cache = mkdtempSync(join(tmpdir(), "practice-install-cache-"));
  rmSync(fresh, { recursive: true, force: true });
  try {
    writeFileSync(join(origin, "package.json"), JSON.stringify({ name: "fresh-practice", dependencies: { "has-flag": "4.0.0" } }) + "\n");
    writeFileSync(join(origin, "add.test.js"), "const test = require('node:test'); const assert = require('node:assert'); test('dep', () => { assert.equal(typeof require('has-flag'), 'function'); });\n");
    spawnSync("git", ["-C", origin, "add", "package.json", "add.test.js"], { stdio: "ignore" });
    const committed = spawnSync("git", ["-C", origin, "-c", "user.email=t@example.com", "-c", "user.name=t", "commit", "-qm", "base"], { encoding: "utf8" });
    assert.equal(committed.status, 0, committed.stderr);
    const base = spawnSync("git", ["-C", origin, "rev-parse", "HEAD"], { encoding: "utf8" }).stdout.trim();
    writeFileSync(join(origin, "add.test.js"), "const test = require('node:test'); const assert = require('node:assert'); test('dep', () => { assert.equal(typeof require('has-flag'), 'function'); });\n// same deps\n");
    spawnSync("git", ["-C", origin, "add", "add.test.js"], { stdio: "ignore" });
    spawnSync("git", ["-C", origin, "-c", "user.email=t@example.com", "-c", "user.name=t", "commit", "-qm", "same lock"], { stdio: "ignore" });
    const same = spawnSync("git", ["-C", origin, "rev-parse", "HEAD"], { encoding: "utf8" }).stdout.trim();
    writeFileSync(join(origin, "package.json"), JSON.stringify({ name: "fresh-practice", dependencies: { "has-flag": "4.0.0", "left-pad": "1.3.0" } }) + "\n");
    spawnSync("git", ["-C", origin, "add", "package.json"], { stdio: "ignore" });
    spawnSync("git", ["-C", origin, "-c", "user.email=t@example.com", "-c", "user.name=t", "commit", "-qm", "fix deps"], { stdio: "ignore" });
    const cloned = spawnSync("git", ["clone", "--quiet", origin, fresh], { encoding: "utf8" });
    assert.equal(cloned.status, 0, cloned.stderr);
    assert.equal(existsSync(join(fresh, "node_modules")), false);
    const installed = ensurePracticeInstall(fresh, {
      repo: "example/fresh", baseSha: base,
      toolchain: { nodePath: node, nodeVersion: "v22.23.4", manager: "npm", managerVersion: "10.9.9" },
    }, cache, { npm: false, pnpm: false, yarn: false }, false);
    assert.equal(installed.ok, true, installed.lines.join("\n"));
    assert.ok(installed.modules);
    assert.equal(installed.modules.startsWith(join(cache, "installs")), true);
    const cachedPkg = JSON.parse(readText(join(installed.modules, "..", "package.json"), "utf8")) as { dependencies: Record<string, string> };
    assert.equal(cachedPkg.dependencies["left-pad"], undefined);
    assert.equal(cachedPkg.dependencies["has-flag"], "4.0.0");
    const again = ensurePracticeInstall(fresh, {
      repo: "example/fresh", baseSha: same,
      toolchain: { nodePath: node, nodeVersion: "v22.23.4", manager: "npm", managerVersion: "10.9.9" },
    }, cache, { npm: false, pnpm: false, yarn: false }, false);
    assert.equal(again.modules, installed.modules);
    assert.equal(readdirSync(join(cache, "installs")).length, 1);
    if (!bwrapHere()) return;
    const ran = runInPracticeSandbox(fresh, [node, "--test", "add.test.js"], 20_000, { capture: true, nodePath: node, nodeModules: installed.modules });
    assert.equal(ran.unsafe, false, ran.stdout || "sandbox did not start");
    assert.equal(ran.code, 0, ran.stdout);
  } finally {
    rmSync(origin, { recursive: true, force: true });
    rmSync(fresh, { recursive: true, force: true });
    rmSync(cache, { recursive: true, force: true });
  }
});

test("a full install cache is skipped per row, and the least recently used install is pruned", () => {
  const node = visibleNodeBin();
  assert.ok(node);
  const origin = tinyRepo();
  const cache = mkdtempSync(join(tmpdir(), "practice-prune-"));
  const tool = { nodePath: node, nodeVersion: "v22.23.4", manager: "none" as const, managerVersion: "none" };
  const commit = (name: string) => {
    writeFileSync(join(origin, "package.json"), JSON.stringify({ name }) + "\n");
    spawnSync("git", ["-C", origin, "add", "package.json"], { stdio: "ignore" });
    spawnSync("git", ["-C", origin, "-c", "user.email=t@example.com", "-c", "user.name=t", "commit", "-qm", name], { stdio: "ignore" });
    return spawnSync("git", ["-C", origin, "rev-parse", "HEAD"], { encoding: "utf8" }).stdout.trim();
  };
  try {
    const skipped = ensurePracticeInstall(origin, { repo: "example/fresh", baseSha: commit("low"), toolchain: tool }, cache, { npm: false, pnpm: false, yarn: false }, false, {
      space: () => ({ freeBytes: 1, freeInodes: 1 }),
    });
    assert.equal(skipped.reason, "INSTALL_SKIPPED_NO_SPACE");
    assert.equal(skipped.ok, false);
    assert.equal(existsSync(join(cache, "installs")), false);
    const first = commit("one");
    const second = commit("two");
    const third = commit("three");
    const a = ensurePracticeInstall(origin, { repo: "example/fresh", baseSha: first, toolchain: tool }, cache, { npm: false, pnpm: false, yarn: false }, false, { maxInstalls: 2 });
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
    const b = ensurePracticeInstall(origin, { repo: "example/fresh", baseSha: second, toolchain: tool }, cache, { npm: false, pnpm: false, yarn: false }, false, { maxInstalls: 2 });
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
    ensurePracticeInstall(origin, { repo: "example/fresh", baseSha: first, toolchain: tool }, cache, { npm: false, pnpm: false, yarn: false }, false, { maxInstalls: 2 });
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
    const c = ensurePracticeInstall(origin, { repo: "example/fresh", baseSha: third, toolchain: tool }, cache, { npm: false, pnpm: false, yarn: false }, false, { maxInstalls: 2 });
    assert.equal(a.ok && b.ok && c.ok, true);
    const names = readdirSync(join(cache, "installs"));
    assert.equal(names.length, 2);
    assert.equal(names.includes(b.fingerprint!), false);
    assert.equal(names.includes(a.fingerprint!), true);
    assert.equal(names.includes(c.fingerprint!), true);
    rmSync(join(cache, "installs", a.fingerprint!, ".practice-complete"));
    writeFileSync(join(cache, "installs", a.fingerprint!, "stale"), "old\n");
    const rebuilt = ensurePracticeInstall(origin, { repo: "example/fresh", baseSha: first, toolchain: tool }, cache, { npm: false, pnpm: false, yarn: false }, false, { maxInstalls: 2 });
    assert.equal(rebuilt.ok, true);
    assert.equal(existsSync(join(cache, "installs", a.fingerprint!, ".practice-complete")), true);
    assert.equal(existsSync(join(cache, "installs", a.fingerprint!, "stale")), false);
    const heldLock = join(cache, "locks", `${c.fingerprint}.lock`);
    mkdirSync(join(cache, "locks"), { recursive: true });
    writeFileSync(heldLock, `${process.pid} ${Date.now()}\n`);
    const fourth = commit("four");
    const d = ensurePracticeInstall(origin, { repo: "example/fresh", baseSha: fourth, toolchain: tool }, cache, { npm: false, pnpm: false, yarn: false }, false, { maxInstalls: 1 });
    assert.equal(d.ok, true);
    assert.equal(existsSync(join(cache, "installs", c.fingerprint!)), true);
    rmSync(heldLock, { force: true });
  } finally {
    rmSync(origin, { recursive: true, force: true });
    rmSync(cache, { recursive: true, force: true });
  }
});

test("an install that exceeds the timeout is INSTALL_TIMEOUT, and a git+ssh dependency is network_required", { timeout: 60_000 }, () => {
  const node = visibleNodeBin();
  assert.ok(node);
  const origin = tinyRepo();
  const cache = mkdtempSync(join(tmpdir(), "practice-timeout-"));
  const tool = { nodePath: node, nodeVersion: "v22.23.4", manager: "npm" as const, managerVersion: "10.9.9" };
  const commit = (pkg: string) => {
    writeFileSync(join(origin, "package.json"), pkg);
    spawnSync("git", ["-C", origin, "add", "package.json"], { stdio: "ignore" });
    spawnSync("git", ["-C", origin, "-c", "user.email=t@example.com", "-c", "user.name=t", "commit", "-qm", "pkg"], { stdio: "ignore" });
    return spawnSync("git", ["-C", origin, "rev-parse", "HEAD"], { encoding: "utf8" }).stdout.trim();
  };
  try {
    const slow = commit(JSON.stringify({ name: "slow-practice", dependencies: { "has-flag": "4.0.0" } }) + "\n");
    const timed = ensurePracticeInstall(origin, { repo: "example/fresh", baseSha: slow, toolchain: tool }, cache, { npm: false, pnpm: false, yarn: false }, false, { timeoutMs: 1 });
    assert.equal(timed.reason, "INSTALL_TIMEOUT", timed.lines.join("\n"));
    const sshSha = commit(JSON.stringify({ name: "ssh-practice", dependencies: { missing: "git+ssh://git@github.com/peaceg03/does-not-exist.git" } }) + "\n");
    const ssh = ensurePracticeInstall(origin, { repo: "example/fresh", baseSha: sshSha, toolchain: tool }, join(cache, "ssh"), { npm: false, pnpm: false, yarn: false }, false, { timeoutMs: 20_000 });
    assert.equal(ssh.reason, "network_required", ssh.lines.join("\n"));
  } finally {
    rmSync(origin, { recursive: true, force: true });
    rmSync(cache, { recursive: true, force: true });
  }
});

test("a missing bwrap is UNSAFE_ENV", () => {
  const work = mkdtempSync(join(tmpdir(), "practice-nobwrap-"));
  try {
    const ran = runInPracticeSandbox(work, ["/bin/true"], 5_000, { bwrap: "bwrap-does-not-exist" });
    assert.equal(ran.unsafe, true);
    assert.equal(ran.code, null);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});

test("the held-out hash changes when a pin changes, and the committed manifest matches", () => {
  const problems = manifestProblems(manifest);
  assert.deepEqual(problems, [], problems.join(","));
  assert.equal(manifest.credit, false);
  assert.equal(manifest.repos.filter((r) => r.split === "held-out").length >= 2, true);
  assert.equal(manifest.repos.find((r) => r.name === "PeaceG03/PeaceSTOCKS")?.split, "dev");
  assert.equal(manifest.repos.find((r) => r.name === "PeaceG03/PeaceSTOCKS")?.license, "owner");
  const ownerOnly = structuredClone(manifest);
  ownerOnly.repos.find((r) => r.name === "PeaceG03/PeaceSTOCKS")!.license = null;
  assert.equal(heldOutHash(ownerOnly.repos), manifest.heldOutHash, "an owner repo is outside the held-out hash");
  const moved = structuredClone(manifest);
  const held = moved.repos.find((r) => r.split === "held-out")!;
  held.commit = "c".repeat(40);
  assert.ok(manifestProblems(moved).includes("heldout_hash_mismatch"));
  moved.heldOutHash = heldOutHash(moved.repos);
  assert.equal(manifestProblems(moved).includes("heldout_hash_mismatch"), false);
  const dev = moved.repos.find((r) => r.split === "dev" && r.name !== "PeaceG03/PeaceSTOCKS")!;
  dev.commit = "d".repeat(40);
  assert.equal(heldOutHash(moved.repos), moved.heldOutHash, "a dev pin is not part of the held-out hash");
  const pairs = read("practice/pairs.jsonl").split("\n").filter((line) => line.trim()).map((line) => JSON.parse(line) as PracticePair);
  const recorded = JSON.parse(read("practice/manifest.json")) as { heldOutPairHash?: string };
  assert.equal(recorded.heldOutPairHash, heldOutPairHash(pairs));
  assert.equal(recorded.heldOutPairHash === manifest.heldOutHash, false);
});

test("a held-out repo, or a fork with the same root, fails the training-exclusion check", () => {
  const sources = [
    { name: "PeaceG03/PeaceSTOCKS", file: "peaceai/model/sources.json", kind: "corpus" as const },
    { name: "axios/axios", file: "peaceai/model/ext-corpus.json", kind: "corpus" as const },
    { name: "colinhacks/zod", file: "peaceai/model/nl-pairs.json", kind: "pairs" as const },
  ];
  const rootMap = { "PeaceG03/PeaceSTOCKS": "1".repeat(40), "axios/axios": "2".repeat(40), "colinhacks/zod": "3".repeat(40) };
  assert.deepEqual(exclusionHits([{ name: "unjs/ufo", root: "9".repeat(40) }], sources, rootMap), []);
  const named = exclusionHits([{ name: "axios/axios", root: "9".repeat(40) }], sources, rootMap);
  assert.equal(named[0]?.why, "name");
  const forked = exclusionHits([{ name: "someone/axios-fork", root: "2".repeat(40) }], sources, rootMap);
  assert.equal(forked[0]?.why, "root");
  assert.equal(forked[0]?.source, "axios/axios");
  assert.equal(exclusionHits([{ name: "PeaceG03/PeaceSTOCKS", root: "1".repeat(40) }], sources, rootMap)[0]?.why, "name");
});

test("the committed held-out repos and their upstreams are absent from corpus, the LM manifest, learned rules, plans, specs, docs, and dev pairs", () => {
  const sources = trainingSources((path) => { try { return read(path); } catch { return null; } });
  assert.ok(!("error" in sources), "error" in sources ? sources.error : "");
  if ("error" in sources) return;
  assert.deepEqual(rootProblems(sources, rootsFile), []);
  const held = manifest.repos.filter((r) => r.split === "held-out").map((r) => ({ name: r.name, root: r.root, upstreams: r.upstreams ?? [] }));
  const hits = exclusionHits(held, sources, rootsFile.roots);
  assert.deepEqual(hits, []);
  const watched = heldOutWatchProblems(held, practiceWatchFiles(repo), rootsFile.roots);
  const named = watched.filter((problem) => !problem.startsWith("CLONE_UNVERIFIED:"));
  assert.deepEqual(named, [], named.join("\n"));
  assert.ok(watched.some((problem) => problem.startsWith("CLONE_UNVERIFIED:")), "a root with no clone identity fails closed");
  const devInCorpus = sources.filter((s) => s.name === "PeaceG03/PeaceSTOCKS");
  assert.ok(devInCorpus.length > 0, "PeaceSTOCKS stays a corpus source; it is dev, not held out");
});

test("a GitHub URL is a repo, a malformed one is rejected, and a wrong clone root fails closed", () => {
  assert.deepEqual(parseRepoToken("https://github.com/axios/axios.git"), { name: "axios/axios" });
  assert.deepEqual(parseRepoToken("git@github.com:axios/axios.git"), { name: "axios/axios" });
  assert.ok("bad" in (parseRepoToken("https://github.com/") ?? {}));
  const mentioned = heldOutWatchProblems(
    [{ name: "someone/hidden", root: "a".repeat(40) }],
    [{ path: "peaceai/spec/note.md", text: "see https://github.com/someone/hidden/blob/main/src/a.ts" }],
    {},
  );
  assert.ok(mentioned.some((p) => p.includes("someone/hidden")));
  const bad = heldOutWatchProblems([], [{ path: "peaceai/model/sources.json", text: '{"name":"https://github.com/"}' }], {});
  assert.ok(bad.some((p) => p.startsWith("BAD_REPO_FORM")));
  const dev = heldOutWatchProblems(
    [{ name: "someone/hidden", root: "a".repeat(40) }],
    [{ path: "practice/pairs.jsonl", text: `${JSON.stringify({ split: "dev", repo: "someone/hidden" })}\n` }],
    {},
  );
  assert.ok(dev.some((p) => p.startsWith("HELD_OUT_MENTION")));
  assert.deepEqual(cloneRootProblems("a/b", "c".repeat(40), null), ["CLONE_UNVERIFIED:a/b"]);
  assert.deepEqual(cloneRootProblems("a/b", "c".repeat(40), { root: "d".repeat(40), upstream: null, upstreamRoot: null }), ["ROOT_MISMATCH:a/b"]);
  assert.ok(cloneRootProblems("a/b", "c".repeat(40), { root: "c".repeat(40), upstream: "other/up", upstreamRoot: null }).includes("UPSTREAM_ROOT_UNVERIFIED:a/b"));
});

test("the LM manifest matches the repo field exactly, so a path that merely contains the name does not count", () => {
  const part = [
    JSON.stringify({ repo: "rollup/rollup", path: "test/form/samples/side-effects-pattern-assignment/_config.js" }),
    JSON.stringify({ repo: "gcanti/fp-ts", path: "src/Option.ts" }),
  ].join("\n") + "\n";
  const pathHit = extManifestProblems("peaceai/model/ext-manifest/part-000.jsonl", part, [
    { name: "gvergnaud/ts-pattern", upstreams: [] },
  ]);
  assert.deepEqual(pathHit, []);
  const repoHit = heldOutWatchProblems(
    [{ name: "gcanti/fp-ts", root: "a".repeat(40), upstreams: ["sodiray/radash"] }],
    [{ path: "peaceai/model/ext-manifest/part-000.jsonl", text: part }],
    {},
  );
  assert.ok(repoHit.some((p) => p === "HELD_OUT_MANIFEST:peaceai/model/ext-manifest/part-000.jsonl:gcanti/fp-ts"), repoHit.join("\n"));
  assert.equal(repoHit.some((p) => p.includes("ts-pattern") || p.includes("side-effects")), false);
  const upstream = heldOutWatchProblems(
    [{ name: "radashi-org/radashi", root: "b".repeat(40), upstreams: ["sodiray/radash"] }],
    [{ path: "peaceai/model/ext-manifest/part-001.jsonl", text: `${JSON.stringify({ repo: "sodiray/radash", path: "src/index.ts" })}\n` }],
    {},
  );
  assert.ok(upstream.some((p) => p.includes("sodiray/radash")), upstream.join("\n"));
});

test("a held-out repo whose upstream appears in docs fails the exclusion check", () => {
  const problems = heldOutWatchProblems(
    [{ name: "radashi-org/radashi", root: "a".repeat(40), upstreams: ["sodiray/radash"] }],
    [{ path: "docs/learn-steps-1-4-evidence.md", text: "PeaceAI learned on sodiray/radash.\n" }],
    {},
  );
  assert.ok(problems.some((p) => p.includes("docs/learn-steps-1-4-evidence.md") && p.includes("sodiray/radash")), problems.join("\n"));
});

test("a verified pair records the fail-before and pass-after exits", () => {
  const pair: PracticePair = {
    schema: "peaceai-practice-pair:v1", credit: false, repo: "unjs/ufo", license: "MIT", split: "held-out",
    baseSha: "a".repeat(40), fixSha: "b".repeat(40), testFile: "test/a.test.ts", testCommand: ["node", "--test", "test/a.test.ts"],
    beforeExit: 1, afterExit: 0, files: ["src/a.ts", "test/a.test.ts"], subject: "Fix the parser",
    toolchain: { nodePath: "/usr/bin/node", nodeVersion: "v22.23.4", manager: "npm", managerVersion: "10.0.0" },
  };
  assert.deepEqual(pairProblems(pair), []);
  const bad = { ...pair, beforeExit: 0 };
  assert.ok(pairProblems(bad).includes("pair_before"));
  const owned = { ...pair, repo: "PeaceG03/PeaceSTOCKS", license: "owner" as const, split: "dev" as const };
  assert.deepEqual(pairProblems(owned), []);
  assert.ok(pairProblems({ ...pair, license: "owner" }).includes("pair_license"));
});

test("replay passes only on GATE PASS plus a failing-then-passing test, and an unknown repo is unmeasured", () => {
  const names = ["PeaceG03/PeaceSTOCKS", "PeaceG03/PeaceAI-Workspace"];
  assert.equal(targetIsScorable("PeaceG03/PeaceSTOCKS", names), true);
  assert.equal(targetIsScorable("unjs/ufo", names), false);
  assert.equal(gradePracticeRow({ scorable: false, core: "ok", job: { status: "pass", reason: "JOB_A_CANDIDATES:1" }, gatePass: true, beforeExit: 1, afterExit: 0 }).reason, "GATE_NO_TARGET");
  const pass = gradePracticeRow({ scorable: true, core: "ok", job: { status: "pass", reason: "JOB_A_CANDIDATES:1" }, gatePass: true, beforeExit: 1, afterExit: 0 });
  assert.equal(pass.status, "pass");
  assert.equal(pass.gap, false);
  assert.equal(gradePracticeRow({ scorable: true, core: "ok", job: { status: "pass", reason: "JOB_A_CANDIDATES:1" }, gatePass: false, beforeExit: 1, afterExit: 0 }).reason, "GATE_FAIL");
  assert.equal(gradePracticeRow({ scorable: true, core: "ok", job: { status: "pass", reason: "JOB_A_CANDIDATES:1" }, gatePass: true, beforeExit: 1, afterExit: 1 }).status, "fail");
  const refused = gradePracticeRow({ scorable: true, core: "missing", job: { status: "fail", reason: "NO_CANDIDATE" }, gatePass: false, beforeExit: null, afterExit: null });
  assert.equal(refused.status, "unmeasured");
  assert.equal(refused.reason, "NO_CORE");
  const gap = gradePracticeRow({ scorable: true, core: "ok", job: { status: "fail", reason: "NO_CANDIDATE" }, gatePass: false, beforeExit: null, afterExit: null });
  assert.equal(gap.gap, true);
  assert.match(gap.reason, /NO_CANDIDATE/);
  const rows = [
    { repo: "unjs/ufo", split: "held-out" as const, fixSha: "b".repeat(40), status: "unmeasured" as const, reason: "GATE_NO_TARGET", gap: true },
    { repo: "sindresorhus/is", split: "dev" as const, fixSha: "c".repeat(40), status: "pass" as const, reason: "GATE_PASS_AND_TEST", gap: false },
  ];
  const doc = replayDocument(rows);
  assert.equal(doc.credit, false);
  assert.equal(doc.protectedFunction, "checkCandidateScope");
  assert.equal(doc.protectedFile, "peaceai/lib/scope.ts");
  assert.equal(doc.counts["held-out"].unmeasured, 1);
  assert.equal(doc.counts["held-out"].pass, 0);
  assert.equal(doc.counts.dev.pass, 1);
  assert.equal(JSON.stringify(doc).includes("diff"), false);
  const counts = countBySplit(rows);
  assert.equal(counts["held-out"].reasons.GATE_NO_TARGET, 1);
});

test("each practice repo has a scope, and a third-party target posts a patch instead of opening a PR", () => {
  const targets = loadTargets();
  const publicTask = new Set(["unjs/defu", "unjs/scule"]);
  const sample: Record<string, { source: string; test: string }> = {
    "sindresorhus/is": { source: "source/index.ts", test: "test/test.ts" },
    "gcanti/fp-ts": { source: "src/Option.ts", test: "test/Option.ts" },
    "unjs/listhen": { source: "src/index.ts", test: "test/index.test.ts" },
    "blakeembrey/change-case": { source: "packages/change-case/src/index.ts", test: "packages/change-case/src/index.spec.ts" },
    "gvergnaud/ts-pattern": { source: "src/match.ts", test: "tests/chainable.test.ts" },
  };
  for (const row of manifest.repos) {
    if (publicTask.has(row.name)) {
      assert.equal(targets.targets[row.name], undefined, row.name);
      assert.equal(targetIsScorable(row.name), false, row.name);
      continue;
    }
    const config = targets.targets[row.name];
    assert.ok(config, row.name);
    assert.equal(targetIsScorable(row.name), true, row.name);
    if (row.name === "PeaceG03/PeaceSTOCKS") continue;
    assert.equal(config.verdictRoute, "patch", row.name);
    assert.equal(config.writeEnvironment, null, row.name);
    assert.equal(config.selfZone, undefined, row.name);
    const scope = scopeOf(config);
    const paths = sample[row.name]!;
    assert.equal(scope.isSource(paths.source), true, paths.source);
    assert.equal(scope.isTest(paths.test), true, paths.test);
    assert.equal(scope.isDenied("test/fixtures/index.ts"), true, row.name);
    assert.equal(scope.isDenied("src/.env.ts"), true, row.name);
  }
});

test("PeaceG03 repos are recorded as owner, and any other repo still needs a permissive LICENSE", () => {
  const bad = manifestProblems({
    schema: "peaceai-practice-manifest:v1", credit: false, heldOutHash: "ab".repeat(32),
    repos: [repoOf({ name: "PeaceG03/PeaceSTOCKS", split: "dev", license: "owner", licenseFile: null }), repoOf({ name: "a/b", split: "held-out" }), repoOf({ name: "c/d", split: "held-out", commit: "e".repeat(40), root: "f".repeat(40) })],
  });
  assert.equal(bad.includes("peacestocks_not_dev"), false);
  assert.equal(bad.includes("repo_license:PeaceG03/PeaceSTOCKS"), false);
  assert.ok(bad.includes("heldout_hash_mismatch"));
  assert.ok(manifestProblems({
    schema: "peaceai-practice-manifest:v1", credit: false, heldOutHash: manifest.heldOutHash,
    repos: [...manifest.repos, repoOf({ name: "other/lib", license: "owner", licenseFile: null })],
  }).includes("repo_license:other/lib"));
});
