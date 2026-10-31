// M151 behavior cases for loop v2 (peaceai/lib/loopdeps.ts and its use in peaceai/lib/loop.ts), as data so the
// mutation test can replay them against each mutant. Each case throws (node:assert) on failure. Every guard has a
// refused near-miss here. Cases that install need the stage-2 candidate uid (and sudo): they carry `needsCand` and
// are reported as SKIPPED (never as passes) where it is missing (the CI test job). The loop cases assert the
// fail-closed CAND_UID_* refusal there instead.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type * as Deps from "../lib/loopdeps.ts";
import type * as Loop from "../lib/loop.ts";
import { loopRowProblem } from "../lib/looprow.ts";
import { ADD_FIXED, ADD_FIXED_SUB_BROKEN, ESCAPEE, MIT, pkgJson, plain, repo, STUB_VITEST_CLI, type Ctx } from "./m151-fixtures.ts";

export interface Libs { deps: typeof Deps; loop: typeof Loop }
/** needsCand: the skip reason where the stage-2 candidate uid is missing (the case would test nothing there). */
export interface Case { id: string; needsCand?: string; run: (l: Libs, ctx: Ctx) => void }
const CAND_SKIP = "needs the stage-2 candidate uid and sudo (box / private job): a real install as that uid";

let n = 0;
const dir = (ctx: Ctx, name: string) => join(ctx.base, "c", `${name}-${n++}`);
const VDEP = { vitest: "1.0.0" };
const NO_CAND = /^CAND_UID_/;

/** Runs the shim directly (no isolation needed: the stub runner is ours) in a dir with the stub vitest installed. */
function shim(l: Libs, ctx: Ctx, mode: string, test: string): string {
  const d = plain(dir(ctx, "shim"), { "package.json": pkgJson({ test: "vitest run" }, VDEP), "test/a.test.mjs": test, "node_modules/vitest/package.json": JSON.stringify({ name: "vitest", version: "1.0.0", type: "module", bin: { vitest: "cli.mjs" } }), "node_modules/vitest/cli.mjs": STUB_VITEST_CLI });
  l.deps.installShim(d);
  const tmp = join(d, ".tmp");
  mkdirSync(tmp);
  const r = spawnSync(process.execPath, l.deps.shimArgs({ runner: "vitest", pkgDir: "", files: ["test/a.test.mjs"], hasDeps: true }), { cwd: d, encoding: "utf8", env: { PATH: process.env.PATH, TMPDIR: tmp, M151_STUB_RUNNER: mode }, timeout: 60_000 });
  return r.stdout ?? "";
}
const tail = (out: string) => out.trimEnd().split("\n").slice(-2).join("\n");

const loopOpts = (l: Libs, ctx: Ctx, proposer: Loop.Proposer, extra: Partial<Loop.LoopOptions> = {}) => ({
  root: ctx.root, fetcher: ctx.fetcher, proposer, maxAttempts: 2, runMs: 60_000, env: ctx.env, rules: [], training: new Set<string>(),
  deps: { tool: ctx.tool, extraEnv: { M151_STUB_VITEST_DIR: ctx.stubVitest } }, ...extra,
});
const seq = (contents: string[]): Loop.Proposer => { let i = 0; return { name: "fixed", next: () => ({ edits: [{ path: "src/calc.ts", content: contents[Math.min(i++, contents.length - 1)]! }] }) }; };

/** installDeps on a fresh git repo copy with the stub package manager. */
function install(l: Libs, ctx: Ctx, cache: Deps.DepsCache, files: Record<string, string>, o: Deps.DepsOptions = {}) {
  const d = repo(dir(ctx, "inst"), { "package.json": pkgJson({ test: "vitest run" }, VDEP), "package-lock.json": "{}\n", ...files });
  const r = l.deps.installDeps(d, ctx.cand!, cache, { tool: ctx.tool, timeoutMs: 60_000, ...o, extraEnv: { M151_STUB_VITEST_DIR: ctx.stubVitest, ...o.extraEnv } });
  return { d, r };
}
function withCache<T>(l: Libs, ctx: Ctx, f: (c: Deps.DepsCache) => T): T {
  const c = l.deps.openDepsCache(join(ctx.base));
  try { return f(c); } finally { c.close(); }
}

const REG = "https://registry.npmjs.org/";
const INT = "sha512-" + "A".repeat(86) + "==";
const PNPM_OK = [
  "lockfileVersion: '9.0'", "", "importers:", "", "  .:", "    dependencies:", "      b:", "        specifier: ^2.0.0", "        version: 2.0.0",
  "  packages/app:", "    dependencies:", "      lib:", "        specifier: workspace:*", "        version: link:../lib", "", "packages:", "",
  "  a@1.0.0:", `    resolution: {integrity: ${INT}}`, "    deprecated: moved, see https://example.com/notice", "", "  b@2.0.0:", `    resolution: {integrity: ${INT}}`, "    hasBin: true", "",
  "snapshots:", "", "  a@1.0.0: {}", "", "  b@2.0.0: {}", "",
].join("\n");
const YARN_OK = [
  "# yarn lockfile v1", "", '"a@^1.0.0", a@^1.1.0:', '  version "1.1.0"', `  resolved "${REG}a/-/a-1.1.0.tgz#${"0".repeat(40)}"`, `  integrity ${INT}`, "",
  '"@s/b@npm:c@^2":', '  version "2.0.0"', `  resolved "${REG}c/-/c-2.0.0.tgz"`, `  integrity ${INT}`, "", '"w@link:packages/w":', '  version "0.0.0"', "",
].join("\n");

export const CASES: Case[] = [
  // ---- the runner (guard:runner-other, guard:service, guard:runner-dep)
  {
    id: "runner: vitest / jest / node --test are picked from the test script; files are package-relative",
    run(l, ctx) {
      const d = plain(dir(ctx, "det"), { "package.json": pkgJson({ test: "vitest run" }, VDEP), "test/a.test.ts": "" });
      assert.deepEqual(l.deps.detectRunner(d, ["test/a.test.ts"]), { runner: "vitest", pkgDir: "", files: ["test/a.test.ts"], hasDeps: true });
      const ws = plain(dir(ctx, "det"), { "package.json": pkgJson({}, {}), "packages/p/package.json": pkgJson({ test: "jest --coverage" }, { jest: "1" }), "packages/p/t/x.test.ts": "" });
      assert.deepEqual(l.deps.detectRunner(ws, ["packages/p/t/x.test.ts"]), { runner: "jest", pkgDir: "packages/p", files: ["t/x.test.ts"], hasDeps: true });
      const nt = plain(dir(ctx, "det"), { "package.json": pkgJson({ test: "node --test" }), "t.test.ts": "" });
      assert.deepEqual(l.deps.detectRunner(nt, ["t.test.ts"]), { runner: "node-test", pkgDir: "", files: ["t.test.ts"], hasDeps: false });
      const viaDeps = plain(dir(ctx, "det"), { "package.json": pkgJson({ test: "npm run unit", unit: "tsc && vitest" }, VDEP) });
      assert.equal((l.deps.detectRunner(viaDeps, ["a.test.ts"]) as Deps.RunnerPick).runner, "vitest", "one level of named scripts");
    },
  },
  {
    id: "runner near-miss: another runner in the script (even with vitest installed) is refused",
    run(l, ctx) {
      const d = plain(dir(ctx, "det"), { "package.json": pkgJson({ test: "mocha --require x test" }, VDEP) });
      assert.deepEqual(l.deps.detectRunner(d, ["test/a.test.ts"]), { refuse: "TEST_RUNNER_UNSUPPORTED" });
      const ava = plain(dir(ctx, "det"), { "package.json": pkgJson({ test: "xo && ava" }, { ava: "1", vitest: "1" }) });
      assert.deepEqual(l.deps.detectRunner(ava, ["test.ts"]), { refuse: "TEST_RUNNER_UNSUPPORTED" });
    },
  },
  {
    id: "runner near-miss: a compose file (outside service) is refused with TEST_NEEDS_SERVICE",
    run(l, ctx) {
      const d = plain(dir(ctx, "det"), { "package.json": pkgJson({ test: "vitest run" }, VDEP), "docker-compose.yml": "services: {}\n" });
      assert.deepEqual(l.deps.detectRunner(d, ["test/a.test.ts"]), { refuse: "TEST_NEEDS_SERVICE" });
      const s = plain(dir(ctx, "det"), { "package.json": pkgJson({ test: "docker compose up -d && vitest run" }, VDEP) });
      assert.deepEqual(l.deps.detectRunner(s, ["test/a.test.ts"]), { refuse: "TEST_NEEDS_SERVICE" });
    },
  },
  {
    id: "runner near-miss: a runner named by the script but not in the dependencies, two runners, or none, is refused",
    run(l, ctx) {
      const d = plain(dir(ctx, "det"), { "package.json": pkgJson({ test: "vitest run" }, { jest: "1" }) });
      assert.deepEqual(l.deps.detectRunner(d, ["a.test.ts"]), { refuse: "TEST_RUNNER_UNSUPPORTED" });
      const both = plain(dir(ctx, "det"), { "package.json": pkgJson({ test: "vitest run && jest" }, { jest: "1", vitest: "1" }) });
      assert.deepEqual(l.deps.detectRunner(both, ["a.test.ts"]), { refuse: "TEST_RUNNER_UNSUPPORTED" });
      const none = plain(dir(ctx, "det"), { "package.json": pkgJson({ test: "tsc" }, { typescript: "1" }) });
      assert.deepEqual(l.deps.detectRunner(none, ["a.test.ts"]), { refuse: "TEST_RUNNER_UNSUPPORTED" });
    },
  },
  // ---- the lockfile (guard:deps-lockfile) and the install argv (guard:deps-frozen, guard:deps-ignore-scripts)
  {
    id: "lockfile: picked by file, pinned by packageManager; none -> DEPS_NO_LOCKFILE; yarn berry -> DEPS_PM_UNSUPPORTED",
    run(l, ctx) {
      assert.deepEqual(l.deps.pickLockfile(plain(dir(ctx, "lock"), { "package.json": pkgJson({}) })), { refuse: "DEPS_NO_LOCKFILE" });
      assert.deepEqual(l.deps.pickLockfile(plain(dir(ctx, "lock"), { "package.json": pkgJson({}), "package-lock.json": "{}" })), { pm: "npm", lockfile: "package-lock.json", version: null });
      assert.deepEqual(l.deps.pickLockfile(plain(dir(ctx, "lock"), { "package.json": pkgJson({}), "pnpm-lock.yaml": "lockfileVersion: '9.0'\n" })), { pm: "pnpm", lockfile: "pnpm-lock.yaml", version: "9.15.9" });
      const pinned = plain(dir(ctx, "lock"), { "package.json": JSON.stringify({ packageManager: "pnpm@8.6.0" }), "pnpm-lock.yaml": "lockfileVersion: '6.0'\n", "package-lock.json": "{}" });
      assert.deepEqual(l.deps.pickLockfile(pinned), { pm: "pnpm", lockfile: "pnpm-lock.yaml", version: "8.6.0" });
      assert.deepEqual(l.deps.pickLockfile(plain(dir(ctx, "lock"), { "package.json": pkgJson({}), "yarn.lock": "__metadata:\n  version: 6\n" })), { refuse: "DEPS_PM_UNSUPPORTED" });
      assert.deepEqual(l.deps.pickLockfile(plain(dir(ctx, "lock"), { "package.json": pkgJson({}), "pnpm-lock.yaml": "lockfileVersion: 4\n" })), { refuse: "DEPS_PM_UNSUPPORTED" });
    },
  },
  {
    id: "install argv: frozen lockfile and --ignore-scripts for every package manager; npm allows no git / url / file deps; pnpm ignores the pnpmfile",
    run(l) {
      const npm = l.deps.installArgv({ pm: "npm", lockfile: "package-lock.json", version: null }, null);
      assert.deepEqual(npm, ["npm", "ci", "--no-audit", "--no-fund", "--allow-git=none", "--allow-remote=none", "--allow-file=none", "--ignore-scripts"]);
      assert.deepEqual(l.deps.installArgv({ pm: "pnpm", lockfile: "pnpm-lock.yaml", version: "9.15.9" }, null), ["corepack", "pnpm@9.15.9", "install", "--ignore-pnpmfile", "--frozen-lockfile", "--ignore-scripts"]);
      assert.deepEqual(l.deps.installArgv({ pm: "yarn", lockfile: "yarn.lock", version: "1.22.22" }, null), ["corepack", "yarn@1.22.22", "install", "--non-interactive", "--frozen-lockfile", "--ignore-scripts"]);
    },
  },
  // ---- the install (guard:deps-cand, guard:deps-config, guard:deps-timeout, guard:deps-size)
  {
    id: "install: as the candidate uid, scripts off, config files stripped; the copy gets links into a runner-owned tree",
    needsCand: CAND_SKIP,
    run(l, ctx) {
      withCache(l, ctx, (cache) => {
        const { d, r } = install(l, ctx, cache, { ".npmrc": "registry=http://127.0.0.1:9/\n", ".corepack.env": "COREPACK_NPM_REGISTRY=http://127.0.0.1:9\n", "sub/.corepack.env": "COREPACK_INTEGRITY_KEYS=0\n" });
        assert.deepEqual(r, { pm: "npm" });
        assert.equal(readFileSync(join(d, "node_modules/.m151-uid"), "utf8"), String(ctx.cand!.uid), "the package manager ran as the candidate uid");
        assert.ok(JSON.parse(readFileSync(join(d, "node_modules/.m151-argv"), "utf8")).includes("--ignore-scripts"));
        assert.ok(!lstatSync(join(d, "node_modules")).isSymbolicLink(), "the copy's node_modules is its own dir");
        assert.ok(lstatSync(join(d, "node_modules/vitest")).isSymbolicLink());
        const staging = [...cache.entries.values()][0] as { staging: string };
        assert.equal(statSync(staging.staging).uid, process.getuid!(), "the installed tree is the runner's again");
        assert.equal(statSync(join(staging.staging, "node_modules")).mode & 0o022, 0, "and not group / world writable");
        assert.ok(!existsSync(join(staging.staging, ".npmrc")), "config files are not in the install tree");
        assert.ok(!existsSync(join(staging.staging, ".corepack.env")) && !existsSync(join(staging.staging, "sub/.corepack.env")), ".corepack.env (any depth) is not in the install tree");
        const env = JSON.parse(readFileSync(join(d, "node_modules/.m151-env"), "utf8"));
        assert.equal(env.registry, "https://registry.npmjs.org/", "the registry is pinned");
        assert.equal(env.corepackEnvFile, "0", "corepack reads no .corepack.env (COREPACK_ENV_FILE=0)");
        assert.equal(env.sudoVars, 0, "env -i: nothing from the caller's or sudo's environment");
      });
    },
  },
  {
    id: "install near-misses: a hung install -> DEPS_TIMEOUT, an oversized one -> DEPS_TOO_LARGE, a failing one -> DEPS_INSTALL_FAILED",
    needsCand: CAND_SKIP,
    run(l, ctx) {
      withCache(l, ctx, (cache) => {
        assert.deepEqual(install(l, ctx, cache, { "package-lock.json": "{\"n\":1}\n" }, { timeoutMs: 2_000, extraEnv: { M151_STUB_PM: "sleep" } }).r, { refuse: "DEPS_TIMEOUT" });
        assert.deepEqual(install(l, ctx, cache, { "package-lock.json": "{\"n\":2}\n" }, { maxBytes: 1 << 20, extraEnv: { M151_STUB_PM: "big" } }).r, { refuse: "DEPS_TOO_LARGE" });
        assert.deepEqual(install(l, ctx, cache, { "package-lock.json": "{\"n\":3}\n" }, { extraEnv: { M151_STUB_PM: "fail" } }).r, { refuse: "DEPS_INSTALL_FAILED" });
        assert.deepEqual(install(l, ctx, cache, { "package-lock.json": "{\"n\":4}\n" }, { extraEnv: { M151_STUB_PM: "none" } }).r, { refuse: "DEPS_INSTALL_FAILED" });
      });
    },
  },
  {
    id: "install cache: keyed by the lockfile sha256 within one run's cache; a new lockfile or a new run installs again",
    needsCand: CAND_SKIP,
    run(l, ctx) {
      const keys: string[] = [];
      const o = { onInstall: (k: string) => keys.push(k) };
      let first = "";
      withCache(l, ctx, (cache) => {
        first = cache.dir;
        assert.deepEqual(install(l, ctx, cache, {}, o).r, { pm: "npm" });
        assert.deepEqual(install(l, ctx, cache, { "src/other.ts": "x" }, o).r, { pm: "npm" }, "same lockfile + manifests: reused");
        assert.equal(keys.length, 1);
        assert.deepEqual(install(l, ctx, cache, { "package-lock.json": "{\"v\":2}\n" }, o).r, { pm: "npm" });
        assert.equal(keys.length, 2, "a different lockfile installs again");
      });
      assert.ok(!existsSync(first), "the run's cache is removed with the run");
      withCache(l, ctx, (cache) => { install(l, ctx, cache, {}, o); });
      assert.equal(keys.length, 3, "nothing is shared between runs");
    },
  },
  {
    id: "install near-misses: a setsid process left by the install is killed before the tree changes hands; a failed chown -> DEPS_INSTALL_FAILED",
    needsCand: CAND_SKIP,
    run(l, ctx) {
      const alive = () => spawnSync("pgrep", ["-u", ctx.cand!.name, "-f", ESCAPEE], { stdio: "ignore" }).status === 0;
      try {
        withCache(l, ctx, (cache) => {
          assert.deepEqual(install(l, ctx, cache, { "package-lock.json": "{\"e\":1}\n" }, { extraEnv: { M151_STUB_PM: "escape" } }).r, { pm: "npm" });
          assert.ok(!alive(), "no candidate-uid process outlives the install");
          assert.deepEqual(install(l, ctx, cache, { "package-lock.json": "{\"e\":2}\n" }, { chown: () => ["false"] }).r, { refuse: "DEPS_INSTALL_FAILED" });
        });
      } finally {
        // a mutant may have run the stub pm as this user (no sudo -u): its escapee is ours to kill too
        spawnSync("sudo", ["-n", "pkill", "-KILL", "-u", ctx.cand!.name, "-f", ESCAPEE], { stdio: "ignore" });
        spawnSync("pkill", ["-KILL", "-u", String(process.getuid!()), "-f", ESCAPEE], { stdio: "ignore" });
      }
    },
  },
  // ---- the lockfile scan (guard:deps-nonregistry, guard:lock-*): registry tarballs with integrity, or in-repo links
  {
    id: "lockfile scan (npm): registry + integrity, workspace dirs, in-repo links and bundled entries pass; git / url / file / outside entries -> refused",
    run(l) {
      const lock = (packages: Record<string, unknown>, deps?: Record<string, unknown>) => JSON.stringify({ lockfileVersion: deps ? 2 : 3, packages: { "": { name: "f" }, ...packages }, ...(deps ? { dependencies: deps } : {}) });
      const OKP = { "node_modules/a": { version: "1.0.0", resolved: `${REG}a/-/a-1.0.0.tgz`, integrity: INT }, "packages/w": { name: "w", version: "1.0.0" }, "node_modules/w": { resolved: "packages/w", link: true }, "node_modules/a/node_modules/b": { version: "1.0.0", inBundle: true } };
      const OKD = { a: { version: "1.0.0", resolved: `${REG}a/-/a-1.0.0.tgz`, integrity: INT, dependencies: { c: { version: "2.0.0", resolved: `${REG}c/-/c-2.0.0.tgz`, integrity: INT } } }, w: { version: "file:packages/w" }, b: { version: "1.0.0", bundled: true } };
      assert.equal(l.deps.npmLockAllowed(lock(OKP)), true);
      assert.equal(l.deps.npmLockAllowed(lock(OKP, OKD)), true);
      assert.equal(l.deps.npmLockAllowed("{}"), true, "no packages: nothing to fetch");
      const bad: [string, Record<string, unknown>, Record<string, unknown>?][] = [
        ["git", { "node_modules/g": { version: "1.0.0", resolved: "git+ssh://git@github.com/o/g.git#abc" } }],
        ["remote tarball with integrity", { "node_modules/r": { version: "1.0.0", resolved: "https://example.com/r-1.0.0.tgz", integrity: INT } }],
        ["look-alike registry host", { "node_modules/r": { version: "1.0.0", resolved: "https://registry.npmjs.org.example.com/r/-/r-1.0.0.tgz", integrity: INT } }],
        ["registry, no integrity", { "node_modules/r": { version: "1.0.0", resolved: `${REG}r/-/r-1.0.0.tgz` } }],
        ["file tarball", { "node_modules/f": { version: "1.0.0", resolved: "file:vendor/f.tgz", integrity: INT } }],
        ["link outside the repo", { "node_modules/o": { resolved: "../outside", link: true } }],
        ["installed outside the repo", { "../outside/node_modules/x": { version: "1.0.0", resolved: `${REG}x/-/x-1.0.0.tgz`, integrity: INT } }],
        ["v1 git dep", {}, { g: { version: "1.0.0", resolved: "git+https://github.com/o/g.git#abc" } }],
        ["v1 nested remote dep", {}, { a: { version: "1.0.0", resolved: `${REG}a/-/a-1.0.0.tgz`, integrity: INT, dependencies: { r: { version: "1.0.0", resolved: "https://example.com/r.tgz", integrity: INT } } } }],
        ["v1 file dep outside", {}, { w: { version: "file:../w" } }],
      ];
      for (const [why, p, d] of bad) assert.equal(l.deps.npmLockAllowed(lock({ ...OKP, ...p }, d ? { ...OKD, ...d } : undefined)), false, why);
    },
  },
  {
    id: "lockfile scan (pnpm): integrity-only resolutions and in-repo links pass; other hosts, git / directory / file sources, a missing resolution, outside links -> refused",
    run(l) {
      const ok = PNPM_OK;
      assert.equal(l.deps.pnpmLockAllowed(ok), true);
      assert.equal(l.deps.pnpmLockAllowed(ok.replace("resolution: {integrity: " + INT + "}", `resolution: {integrity: ${INT}, tarball: ${REG}b/-/b-2.0.0.tgz}`)), true, "a registry tarball url is fine");
      const bad: [string, string][] = [
        ["tarball from another host", ok.replace("resolution: {integrity: " + INT + "}", `resolution: {integrity: ${INT}, tarball: https://example.com/b.tgz}`)],
        ["git resolution", ok.replace("resolution: {integrity: " + INT + "}", "resolution: {commit: abc, repo: https://github.com/o/b, type: git}")],
        ["directory resolution", ok.replace("resolution: {integrity: " + INT + "}", "resolution: {directory: vendor/b, type: directory}")],
        ["an entry without a resolution", ok.replace("    resolution: {integrity: " + INT + "}\n", "")],
        ["a file: package key", ok.replace("  b@2.0.0:\n", "  'b@file:vendor/b':\n")],
        ["a file: snapshot key", ok.replace("  b@2.0.0: {}", "  'b@file:vendor/b': {}")],
        ["link outside the repo", ok.replace("version: link:../lib", "version: link:../../../outside")],
        ["git specifier", ok.replace("specifier: ^2.0.0", "specifier: git+https://github.com/o/b.git")],
      ];
      for (const [why, text] of bad) { assert.notEqual(text, ok, why); assert.equal(l.deps.pnpmLockAllowed(text), false, why); }
    },
  },
  {
    id: "lockfile scan (yarn v1): registry + integrity and in-repo links pass; another host, no integrity, git / file specs, outside links -> refused",
    run(l) {
      const ok = YARN_OK;
      assert.equal(l.deps.yarnLockAllowed(ok), true);
      assert.equal(l.deps.yarnLockAllowed(ok.replaceAll(REG, "https://registry.yarnpkg.com/")), true, "the yarn mirror host is allowed (Auditor ruling)");
      assert.equal(l.deps.yarnLockAllowed(ok.replace(`  integrity ${INT}\n`, "")), true, "yarn v1: the #sha1 on the resolved url stands in for integrity");
      const bad: [string, string][] = [
        ["no integrity and no #sha1", ok.replace(`  integrity ${INT}\n\n"w@`, `\n"w@`)],
        ["git spec behind a registry url", ok.replace('"a@^1.0.0"', '"a@git+https://github.com/o/a.git"')],
        ["file spec", ok.replace('"a@^1.0.0"', '"a@file:../a"')],
        ["link outside the repo", ok.replace('"w@link:packages/w"', '"w@link:../w"')],
      ];
      for (const [why, text] of bad) { assert.notEqual(text, ok, why); assert.equal(l.deps.yarnLockAllowed(text), false, why); }
    },
  },
  {
    id: "lockfile scan: installDeps refuses a non-registry lockfile with DEPS_NONREGISTRY before anything runs",
    run(l, ctx) {
      const fake = { name: "m151-no-such-user", uid: 2_000_000_000 };
      withCache(l, ctx, (cache) => {
        const lock = JSON.stringify({ lockfileVersion: 3, packages: { "": {}, "node_modules/g": { version: "1.0.0", resolved: "git+ssh://git@github.com/o/g.git#abc" } } });
        const d = repo(dir(ctx, "nonreg"), { "package.json": pkgJson({ test: "vitest run" }, VDEP), "package-lock.json": lock });
        let ran = 0;
        assert.deepEqual(l.deps.installDeps(d, fake as never, cache, { tool: ctx.tool, onInstall: () => { ran++; } }), { refuse: "DEPS_NONREGISTRY" });
        assert.equal(ran, 0);
      });
    },
  },
  // ---- the lockfile scan, round 3 (Auditor FAIL b273f29): layouts pnpm / yarn / npm read differently from a naive scan
  {
    id: "lockfile scan (pnpm subset): flow at the top levels, other indent steps, escapes, anchors / aliases / tags / merge keys, duplicate keys -> refused even when the content looks fine",
    run(l) {
      const ok = PNPM_OK;
      const head = "lockfileVersion: '9.0'\n\n";
      const bad: [string, string][] = [
        // Auditor's bypasses, verbatim
        ["flow mapping on the header line (Auditor)", head + "packages: {'a@1.0.0': {resolution: {tarball: 'https://evil.example/a.tgz'}}}\n"],
        ["4-space entry with escapes (Auditor)", head + 'packages:\n\n    "a@1.0.0":\n        "resoluti\\x6fn": {"tarb\\x61ll": "https\\x3a//evil.example/a.tgz"}\n'],
        ["escapes at the usual indent", ok.replace(`    resolution: {integrity: ${INT}}\n    hasBin`, `    "resoluti\\x6fn": {integrity: ${INT}}\n    resolution: {integrity: ${INT}}\n    hasBin`)],
        // the same layouts with harmless content: only the layout rule refuses these
        ["flow mapping on the header line, registry content", head + `packages: {'a@1.0.0': {resolution: {integrity: ${INT}}}}\n`],
        ["4-space indent steps, registry content", ok.split("\n").map((x) => x.replace(/^( +)/, (sp) => sp + sp)).join("\n")],
        ["an escape in a double-quoted value", ok.replace("specifier: ^2.0.0", 'specifier: "^2.0.\\x30"')],
        ["an anchor", ok.replace("        version: 2.0.0", "        version: &v 2.0.0")],
        ["an alias", ok.replace("        version: 2.0.0", "        version: *v")],
        ["a tag", ok.replace("        version: 2.0.0", "        version: !!str 2.0.0")],
        ["a merge key", ok.replace("    hasBin: true", "    hasBin: true\n    <<: {dev: true}")],
        ["a duplicate key", ok.replace("    hasBin: true", "    hasBin: true\n    hasBin: true")],
        ["a duplicate resolution, the second from another host", ok.replace("    hasBin: true", "    hasBin: true\n    resolution: {integrity: " + INT + ", tarball: https://evil.example/b.tgz}")],
        ["a block scalar", ok.replace("    hasBin: true", "    hasBin: |\n      true")],
        ["an inline comment", ok.replace("    hasBin: true", "    hasBin: true # x")],
        ["a tab", ok.replace("    hasBin: true", "    hasBin:\ttrue")],
        ["a second document", ok + "---\npackages: {}\n"],
      ];
      for (const [why, text] of bad) { assert.notEqual(text, ok, why); assert.equal(l.deps.pnpmLockAllowed(text), false, why); }
      assert.equal(l.deps.pnpmLockAllowed(ok.replace("    hasBin: true", "    hasBin: true\n    engines: {node: '>=18'}\n    cpu: [x64]\n    transitivePeerDependencies:\n      - supports-color")), true, "the flow / sequence forms pnpm writes are fine");
    },
  },
  {
    id: "lockfile scan (yarn v1): a duplicate or quoted field, another or look-alike host, http, an upper-case host, no hash -> refused",
    run(l) {
      const ok = YARN_OK;
      const good = `  resolved "${REG}a/-/a-1.1.0.tgz#${"0".repeat(40)}"`;
      const Y = "https://registry.yarnpkg.com/";
      const bad: [string, string][] = [
        ["a duplicate resolved, the last from another host (yarn reads the last)", ok.replace(good, `${good}\n  resolved "https://evil.example/a.tgz"`)],
        ["a duplicate resolved, both fine", ok.replace(good, `${good}\n${good}`)],
        ["a quoted field name", ok.replace(good, `${good}\n  "resolved" "https://evil.example/a.tgz"`)],
        ["a field with a colon", ok.replace(good, good.replace("  resolved ", "  resolved: "))],
        ["a look-alike yarn host", ok.replace(`"${REG}a/`, `"https://registry.yarnpkg.com.evil.example/a/`)],
        ["http yarn host", ok.replace(`"${REG}a/`, `"http://registry.yarnpkg.com/a/`)],
        ["upper-case yarn host", ok.replace(`"${REG}a/`, `"https://REGISTRY.YARNPKG.COM/a/`)],
        ["yarn host, no integrity and no #sha1", ok.replaceAll(REG, Y).replace(`#${"0".repeat(40)}`, "").replace(`  integrity ${INT}\n`, "")],
        ["yarn host, a short sha1", ok.replaceAll(REG, Y).replace(`#${"0".repeat(40)}`, `#${"0".repeat(39)}`).replace(`  integrity ${INT}\n`, "")],
      ];
      for (const [why, text] of bad) { assert.notEqual(text, ok, why); assert.equal(l.deps.yarnLockAllowed(text), false, why); }
    },
  },
  {
    id: "lockfile scan (root): npm-shrinkwrap.json + package-lock.json -> refused; every other lockfile at the root is scanned too; a lockfile over the cap -> DEPS_TOO_LARGE",
    run(l, ctx) {
      const npmOk = JSON.stringify({ lockfileVersion: 3, packages: { "": {}, "node_modules/a": { version: "1.0.0", resolved: `${REG}a/-/a-1.0.0.tgz`, integrity: INT } } });
      const npmBad = JSON.stringify({ lockfileVersion: 3, packages: { "": {}, "node_modules/a": { version: "1.0.0", resolved: "https://evil.example/a.tgz", integrity: INT } } });
      const at = (files: Record<string, string>) => { const d = plain(dir(ctx, "root"), { "package.json": pkgJson({}), ...files }); const p = l.deps.pickLockfile(d); assert.ok(!("refuse" in p)); return { d, p }; };
      const sw = at({ "npm-shrinkwrap.json": npmOk });
      assert.equal(sw.p.lockfile, "npm-shrinkwrap.json", "a shrinkwrap alone is the lockfile");
      assert.equal(l.deps.lockfileAllowed(sw.d, sw.p), true);
      const both = at({ "npm-shrinkwrap.json": npmOk, "package-lock.json": npmOk });
      assert.equal(l.deps.lockfileAllowed(both.d, both.p), false, "both npm lockfiles (even both fine): refused");
      const evilSw = at({ "npm-shrinkwrap.json": npmBad, "package-lock.json": npmOk });
      assert.equal(l.deps.lockfileAllowed(evilSw.d, evilSw.p), false, "the shrinkwrap npm ci would read is not trusted");
      const other = at({ "package.json": JSON.stringify({ packageManager: "pnpm@9.15.9" }), "pnpm-lock.yaml": PNPM_OK, "yarn.lock": YARN_OK.replace(`"${REG}a/`, '"https://evil.example/a/') });
      assert.equal(other.p.pm, "pnpm");
      assert.equal(l.deps.lockfileAllowed(other.d, other.p), false, "a bad lockfile next to the picked one: refused");
      const fine = at({ "package.json": JSON.stringify({ packageManager: "pnpm@9.15.9" }), "pnpm-lock.yaml": PNPM_OK, "yarn.lock": YARN_OK });
      assert.equal(l.deps.lockfileAllowed(fine.d, fine.p), true);
      assert.equal(l.deps.LOCK_MAX_BYTES, 64 * 1024 * 1024);
      const big = plain(dir(ctx, "root"), { "package.json": pkgJson({}), "package-lock.json": npmOk });
      assert.deepEqual(l.deps.pickLockfile(big, npmOk.length - 1), { refuse: "DEPS_TOO_LARGE" }, "over the cap: refused before it is read");
      assert.ok(!("refuse" in l.deps.pickLockfile(big, npmOk.length)));
      const side = plain(dir(ctx, "root"), { "package.json": pkgJson({}), "package-lock.json": npmOk, "yarn.lock": YARN_OK });
      assert.deepEqual(l.deps.pickLockfile(side, npmOk.length + 1), { refuse: "DEPS_TOO_LARGE" }, "the cap holds for every lockfile at the root");
      const fake = { name: "m151-no-such-user", uid: 2_000_000_000 };
      withCache(l, ctx, (cache) => {
        const d = repo(dir(ctx, "big"), { "package.json": pkgJson({ test: "vitest run" }, VDEP), "package-lock.json": npmOk });
        assert.deepEqual(l.deps.installDeps(d, fake as never, cache, { tool: ctx.tool, lockMaxBytes: 16 }), { refuse: "DEPS_TOO_LARGE" });
      });
    },
  },
  // ---- package-manager settings outside the root lockfile, round 4 (Auditor FAIL 886ee29)
  {
    id: "pm config: a lockfile below the root (any manager, any depth) or an unreadable dir -> DEPS_PM_CONFIG; look-alike names and lockfile-named dirs pass",
    run(l, ctx) {
      const npmOk = JSON.stringify({ lockfileVersion: 3, packages: { "": {}, "node_modules/a": { version: "1.0.0", resolved: `${REG}a/-/a-1.0.0.tgz`, integrity: INT } } });
      const base = { "package.json": pkgJson({}), "package-lock.json": npmOk, "packages/a/package.json": pkgJson({}) };
      const check = (files: Record<string, string>) => { const d = plain(dir(ctx, "nest"), files); const p = l.deps.pickLockfile(d); assert.ok(!("refuse" in p)); return { d, p, problem: l.deps.depsSourceProblem(d, p) }; };
      assert.equal(check(base).problem, null, "a workspace package without its own lockfile");
      assert.equal(check({ ...base, "packages/a/pnpm-lock.yaml.orig": "x", "packages/yarn.lock/keep": "" }).problem, null, "a look-alike name, a dir named like a lockfile");
      for (const f of ["packages/a/package-lock.json", "packages/a/npm-shrinkwrap.json", "packages/a/pnpm-lock.yaml", "packages/a/yarn.lock", "packages/a/bun.lock", "packages/a/bun.lockb", "x/y/z/yarn.lock"]) {
        const r = check({ ...base, [f]: npmOk });
        assert.equal(r.problem, "DEPS_PM_CONFIG", f);
        assert.equal(l.deps.lockfileAllowed(r.d, r.p), false, f);
      }
      // Auditor's first bypass, without the settings key (so only the nested-lockfile rule refuses it)
      const ws = check({ "package.json": JSON.stringify({ packageManager: "pnpm@9.15.9" }), "pnpm-lock.yaml": PNPM_OK, "pnpm-workspace.yaml": "packages:\n  - p\n", "p/package.json": pkgJson({}),
        "p/pnpm-lock.yaml": PNPM_OK.replace("resolution: {integrity: " + INT + "}", `resolution: {integrity: ${INT}, tarball: https://evil.example/b.tgz}`) });
      assert.equal(ws.p.pm, "pnpm");
      assert.equal(ws.problem, "DEPS_PM_CONFIG", "a workspace package's own pnpm lockfile");
      if (process.getuid?.() !== 0) {
        const u = check({ ...base, "secret/x": "" });
        chmodSync(join(u.d, "secret"), 0);
        try { assert.equal(l.deps.depsSourceProblem(u.d, u.p), "DEPS_PM_CONFIG", "a dir the scan cannot read is not vouched for"); } finally { chmodSync(join(u.d, "secret"), 0o755); }
      }
    },
  },
  {
    id: "pm config (pnpm-workspace.yaml): packages / catalog / catalogs in the plain subset pass; any other key, a parse failure, an outside glob, a protocol catalog entry -> refused",
    run(l) {
      const ok = "packages:\n  - 'packages/*'\n  - '!**/test/**'\n  - website\ncatalog:\n  vitest: ^3.0.0\n  b: 'npm:c@^2'\ncatalogs:\n  old:\n    vitest: ^2.0.0\n";
      assert.equal(l.deps.pnpmWorkspaceAllowed(ok), true);
      assert.equal(l.deps.pnpmWorkspaceAllowed("packages:\n  - 'packages/*'\n"), true);
      assert.equal(l.deps.pnpmWorkspaceAllowed(""), true, "an empty file");
      const bad: [string, string][] = [
        ["registries (Auditor)", ok + "registries:\n  default: https://evil.example/\n"],
        ["sharedWorkspaceLockfile (Auditor)", ok + "sharedWorkspaceLockfile: false\n"],
        ["a harmless-looking setting is still a setting", ok + "onlyBuiltDependencies:\n  - esbuild\n"],
        ["overrides", ok + "overrides:\n  a: 1.0.0\n"],
        ["pnpmfile", ok + "pnpmfile: x.cjs\n"],
        ["an inline comment (outside the subset)", ok.replace("  - website\n", "  - website # site\n")],
        ["a flow list at the top level (outside the subset)", "packages: ['packages/*']\n"],
        ["an anchor", ok.replace("vitest: ^3.0.0", "vitest: &v ^3.0.0")],
        ["a glob outside the repo", ok.replace("  - website\n", "  - ../outside\n")],
        ["a negated glob outside the repo", ok.replace("  - website\n", "  - '!../outside'\n")],
        ["an absolute glob", ok.replace("  - website\n", "  - /abs\n")],
        ["packages not a list", "packages:\n  a: b\n"],
        ["a glob with a leading ./", ok.replace("  - website\n", "  - './website'\n")],
        ["a glob with a brace set", ok.replace("  - website\n", "  - 'packages/{a,b}'\n")],
        ["a glob with ..", ok.replace("  - website\n", "  - 'packages/a/../b'\n")],
        ["a glob with ? / a class", ok.replace("  - website\n", "  - 'packages/[ab]?'\n")],
        ["a url catalog entry", ok.replace("vitest: ^3.0.0", "vitest: 'https://evil.example/v.tgz'")],
        ["a file: catalog entry", ok.replace("vitest: ^3.0.0", "vitest: 'file:vendor/v'")],
        ["a link: entry in a named catalog", ok.replace("vitest: ^2.0.0", "vitest: 'link:../v'")],
        ["a map as a catalog entry", ok.replace("  vitest: ^3.0.0\n", "  vitest:\n    x: y\n")],
      ];
      for (const [why, text] of bad) { assert.notEqual(text, ok, why); assert.equal(l.deps.pnpmWorkspaceAllowed(text), false, why); }
    },
  },
  {
    id: "pm config (pnpm repos): Auditor's registries bypass, a nested or .yml workspace file, a symlinked one, package.yaml / json5, any `pnpm` field -> DEPS_PM_CONFIG; npm repos are not judged on pnpm files",
    run(l, ctx) {
      const PM = JSON.stringify({ packageManager: "pnpm@9.15.9", devDependencies: VDEP });
      const base = { "package.json": PM, "pnpm-lock.yaml": PNPM_OK, "pnpm-workspace.yaml": "packages:\n  - 'packages/*'\n", "packages/app/package.json": JSON.stringify({ name: "app", dependencies: { pnpm: "9.0.0" }, scripts: { x: "pnpm -r build" } }) };
      const problem = (files: Record<string, string>, link?: [string, string]) => {
        const d = plain(dir(ctx, "pnpmcfg"), files);
        if (link) symlinkSync(link[1], join(d, link[0]));
        const p = l.deps.pickLockfile(d);
        assert.ok(!("refuse" in p));
        return l.deps.depsSourceProblem(d, p);
      };
      assert.equal(problem(base), null, "a plain workspace; a dependency or script named pnpm is not a pnpm field");
      const { "pnpm-workspace.yaml": _w, ...noWs } = base;
      assert.equal(problem(noWs), null, "no workspace file");
      const bad: [string, Record<string, string>][] = [
        ["registries in the workspace file + integrity-only lock (Auditor)", { ...base, "pnpm-workspace.yaml": "registries:\n  default: https://evil.example/\n" }],
        ["sharedWorkspaceLockfile in the workspace file (Auditor)", { ...base, "pnpm-workspace.yaml": "packages:\n  - 'packages/*'\nsharedWorkspaceLockfile: false\n" }],
        ["a workspace file below the root", { ...base, "packages/app/pnpm-workspace.yaml": "packages:\n  - x\n" }],
        ["pnpm-workspace.yml at the root", { ...noWs, "pnpm-workspace.yml": "packages:\n  - 'packages/*'\n" }],
        ["package.yaml in a workspace package", { ...base, "packages/lib/package.yaml": "name: lib\n" }],
        ["package.json5 in a workspace package", { ...base, "packages/lib/package.json5": "{name: 'lib'}\n" }],
        ["pnpm.overrides in the root package.json", { ...base, "package.json": JSON.stringify({ packageManager: "pnpm@9.15.9", devDependencies: VDEP, pnpm: { overrides: { b: "https://evil.example/b.tgz" } } }) }],
        ["an empty pnpm field", { ...base, "package.json": JSON.stringify({ packageManager: "pnpm@9.15.9", devDependencies: VDEP, pnpm: {} }) }],
        ["a pnpm field in a workspace package", { ...base, "packages/app/package.json": JSON.stringify({ name: "app", pnpm: { onlyBuiltDependencies: ["esbuild"] } }) }],
        ["a pnpm field behind a BOM", { ...base, "packages/app/package.json": "\ufeff" + JSON.stringify({ name: "app", pnpm: { overrides: {} } }) }],
        ["a package.json that is not JSON", { ...base, "packages/app/package.json": "{name: app}" }],
      ];
      for (const [why, files] of bad) assert.equal(problem(files), "DEPS_PM_CONFIG", why);
      assert.equal(problem({ ...base, "packages/app/package.json": "\ufeff" + JSON.stringify({ name: "app" }) }), null, "a BOM alone is fine");
      assert.equal(problem(noWs, ["pnpm-workspace.yaml", "packages/app/package.json"]), "DEPS_PM_CONFIG", "a symlinked workspace file");
      // npm never reads pnpm's files: an npm repo is judged on its own lockfile only
      const npmOk = JSON.stringify({ lockfileVersion: 3, packages: { "": {}, "node_modules/a": { version: "1.0.0", resolved: `${REG}a/-/a-1.0.0.tgz`, integrity: INT } } });
      assert.equal(problem({ "package.json": JSON.stringify({ pnpm: { overrides: {} } }), "package-lock.json": npmOk, "pnpm-workspace.yaml": "registries:\n  default: https://evil.example/\n" }), null);
      const fake = { name: "m151-no-such-user", uid: 2_000_000_000 };
      withCache(l, ctx, (cache) => {
        const d = repo(dir(ctx, "pnpmcfg-inst"), { ...base, "package.json": JSON.stringify({ packageManager: "pnpm@9.15.9", scripts: { test: "vitest run" }, devDependencies: VDEP }), "pnpm-workspace.yaml": "registries:\n  default: https://evil.example/\n" });
        let ran = 0;
        assert.deepEqual(l.deps.installDeps(d, fake as never, cache, { tool: ctx.tool, onInstall: () => { ran++; } }), { refuse: "DEPS_PM_CONFIG" });
        assert.equal(ran, 0);
      });
    },
  },
  // ---- corepack and yarn v1 manifests, round 5 (Auditor FAIL 71fff3d)
  {
    id: "pm config (corepack): packageManager only as name@x.y.z[+hash], no devEngines package manager / runtime, a root package.json that is JSON; .corepack.env is a stripped config file",
    run(l, ctx) {
      assert.ok((l.deps.PM_CONFIG_FILES as readonly string[]).includes(".corepack.env"));
      const npmOk = JSON.stringify({ lockfileVersion: 3, packages: { "": {}, "node_modules/a": { version: "1.0.0", resolved: `${REG}a/-/a-1.0.0.tgz`, integrity: INT } } });
      const problem = (pkg: string, more: Record<string, string> = {}) => { const d = plain(dir(ctx, "corepack"), { "package.json": pkg, "package-lock.json": npmOk, ...more }); const p = l.deps.pickLockfile(d); assert.ok(!("refuse" in p)); return l.deps.depsSourceProblem(d, p); };
      for (const pm of ["npm@10.9.2", "yarn@1.22.22+sha512.0123abcd", undefined]) assert.equal(problem(JSON.stringify({ packageManager: pm })), null, String(pm));
      assert.equal(problem(JSON.stringify({ devEngines: { os: { name: "linux" } } })), null, "devEngines without a package manager / runtime");
      assert.equal(problem(pkgJson({}), { "fixtures/broken/package.json": "{not json" }), null, "a nested package.json that is not JSON (corepack reads the root)");
      const bad: [string, string, Record<string, string>?][] = [
        ["a URL (corepack fetches it)", JSON.stringify({ packageManager: "yarn@https://evil.example/yarn-1.22.22.tgz" })],
        ["a range", JSON.stringify({ packageManager: "npm@^10" })],
        ["a tag", JSON.stringify({ packageManager: "pnpm@latest" })],
        ["another manager", JSON.stringify({ packageManager: "bun@1.1.0" })],
        ["not a string", JSON.stringify({ packageManager: 10 })],
        ["a hash with upper case / odd chars", JSON.stringify({ packageManager: "npm@10.9.2+sha512.XYZ" })],
        ["devEngines.packageManager", JSON.stringify({ devEngines: { packageManager: { name: "pnpm", version: "^10", onFail: "download" } } })],
        ["devEngines.runtime", JSON.stringify({ devEngines: { runtime: { name: "node", onFail: "download" } } })],
        ["a root package.json that is not JSON", "{packageManager: 'npm@10.9.2'}"],
        ["a bad packageManager in a nested package.json", pkgJson({}), { "packages/a/package.json": JSON.stringify({ packageManager: "pnpm@https://evil.example/p.tgz" }) }],
      ];
      for (const [why, pkg, more] of bad) assert.equal(problem(pkg, more), "DEPS_PM_CONFIG", why);
    },
  },
  {
    id: "pm config (yarn v1): every dependency spec of the root and the workspace packages must be a yarn.lock header (or a workspace package); resolutions, odd workspace globs, odd dependency maps -> DEPS_PM_CONFIG",
    run(l, ctx) {
      const lockAll = YARN_OK.replace('"a@^1.0.0", a@^1.1.0:', '"a@1", "a@^1.0.0", a@^1.1.0:');
      const root = (o: Record<string, unknown>) => JSON.stringify({ packageManager: "yarn@1.22.22", private: true, workspaces: ["packages/*"], dependencies: { a: "^1.0.0" }, ...o });
      const base: Record<string, string> = {
        "package.json": root({ devDependencies: { "@s/b": "npm:c@^2" }, optionalDependencies: { a: "^1.1.0" }, peerDependencies: { zzz: "^9" } }),
        "yarn.lock": lockAll,
        "packages/w/package.json": JSON.stringify({ name: "w", version: "1.0.0", dependencies: { a: "^1.1.0" } }),
        "packages/x/package.json": JSON.stringify({ name: "x", dependencies: { w: "^1.0.0", "@s/b": "npm:c@^2" } }),
        "test/fixtures/p/package.json": JSON.stringify({ name: "fixture", dependencies: { a: "^1.0.0" } }),
      };
      const problem = (files: Record<string, string>) => { const d = plain(dir(ctx, "yarnman"), files); const p = l.deps.pickLockfile(d); assert.ok(!("refuse" in p)); assert.equal(p.pm, "yarn"); return l.deps.depsSourceProblem(d, p); };
      assert.equal(problem(base), null, "locked specs (multi-spec and quoted headers), an npm: alias, a workspace dep, peers (not installed by yarn v1), a non-workspace fixture with locked deps");
      assert.equal(problem({ ...base, "package.json": root({ workspaces: { packages: ["packages/*"], nohoist: ["**/x"] } }) }), null, "workspaces as {packages, nohoist}");
      assert.equal(problem({ ...base, "package.json": root({ dependencies: { w: "link:packages/w" } }) }), null, "a locked link: spec");
      const evil = "https://evil.example/is-number-7.0.0.tgz";
      const bad: [string, Record<string, string>][] = [
        ["a URL dependency with a header-only yarn.lock (Auditor)", { "package.json": JSON.stringify({ packageManager: "yarn@1.22.22", dependencies: { "is-number": evil } }), "yarn.lock": "# yarn lockfile v1\n\n" }],
        ["a URL dependency in a workspace package (Auditor)", { ...base, "packages/w/package.json": JSON.stringify({ name: "w", dependencies: { "is-number": evil } }) }],
        ["a registry range with no lock entry", { ...base, "package.json": root({ dependencies: { "is-number": "^7.0.0" } }) }],
        ["a spec that differs from the header", { ...base, "package.json": root({ dependencies: { a: "^1.2.0" } }) }],
        ["an unlocked devDependency", { ...base, "package.json": root({ devDependencies: { c: "^2" } }) }],
        ["an unlocked optionalDependency", { ...base, "package.json": root({ optionalDependencies: { c: "^2" } }) }],
        ["a workspace name with a protocol", { ...base, "package.json": root({ dependencies: { w: "file:packages/w" } }) }],
        ["a ** workspace glob reaching a nested package", { ...base, "package.json": root({ workspaces: ["packages/**"] }), "packages/w/deep/package.json": JSON.stringify({ name: "deep", dependencies: { "is-number": evil } }) }],
        ["resolutions at the root", { ...base, "package.json": root({ resolutions: { a: "1.1.0" } }) }],
        ["resolutions in a workspace package", { ...base, "packages/w/package.json": JSON.stringify({ name: "w", resolutions: {} }) }],
        ["a dependency map that is a list", { ...base, "package.json": root({ dependencies: ["a@^1.0.0"] }) }],
        ["a non-string spec that would print as a locked one", { ...base, "package.json": root({ dependencies: { a: 1 } }) }],
        ["a workspace glob outside the repo", { ...base, "package.json": root({ workspaces: ["../*"] }) }],
        ["a workspace glob with a leading ./", { ...base, "package.json": root({ workspaces: ["./packages/*"] }) }],
        ["a workspace glob with a brace set", { ...base, "package.json": root({ workspaces: ["packages/{a,b}"] }) }],
        ["a workspace glob with ? / a class / a negation", { ...base, "package.json": root({ workspaces: ["packages/[wx]?", "!packages/x"] }) }],
        ["workspaces with another key", { ...base, "package.json": root({ workspaces: { packages: ["packages/*"], other: [] } }) }],
        ["a workspace package.json that is not JSON", { ...base, "packages/w/package.json": "{name: w}" }],
        ["a fixture outside the workspaces with a URL dep (every package.json is checked; Auditor FAIL e5f28a6)", { ...base, "test/fixtures/p/package.json": JSON.stringify({ dependencies: { "is-number": "https://evil.example/n.tgz" } }) }],
      ];
      for (const [why, files] of bad) assert.equal(problem(files), "DEPS_PM_CONFIG", why);
      assert.deepEqual(l.deps.yarnHeaderSpecs('"a@^1.0.0", a@^1.1.0:'), ["a@^1.0.0", "a@^1.1.0"]);
      assert.deepEqual(l.deps.yarnHeaderSpecs('"a@>=1 <2", "@s/b@npm:c@^2":'), ["a@>=1 <2", "@s/b@npm:c@^2"]);
      for (const h of ['"a@1:', 'a@1 2:', 'a@1,,b:', '"a@\\x31":', 'a@1']) assert.equal(l.deps.yarnHeaderSpecs(h), null, h);
    },
  },
  // ---- yarn v1, round 6 (Auditor FAIL 7e7a41d): the whole lock closure; headers / lines only in the subset yarn's own
  // parser reads the same way (it falls back to js-yaml FAILSAFE when its parser throws)
  {
    id: "lockfile scan (yarn v1): every dependency of every block must be a locked registry header; URL / link / unlocked transitive deps -> refused",
    run(l) {
      const blk = (h: string, v: string, extra: string[] = [], res = `${REG}x/-/x-${v}.tgz`) => ["", h, `  version "${v}"`, `  resolved "${res}"`, `  integrity ${INT}`, ...extra].join("\n");
      const isn = (deps: string[], field = "dependencies") => YARN_OK + blk('"is-number@7.0.0":', "7.0.0", [`  ${field}:`, ...deps.map((d) => "    " + d)]) + "\n";
      const B2 = blk('"b@^2.0.0":', "2.1.0") + "\n";
      assert.equal(l.deps.yarnLockAllowed(isn(['b "^2.0.0"']) + B2), true, "a transitive registry range with its own header");
      assert.equal(l.deps.yarnLockAllowed(isn(['"@s/b" "npm:c@^2"', 'a "^1.0.0"'])), true, "a quoted scoped name, an alias, a self-range: all locked");
      assert.equal(l.deps.yarnLockAllowed(isn(['b "^2.0.0"'], "optionalDependencies") + B2), true, "optionalDependencies too");
      const bad: [string, string][] = [
        ["Auditor: a transitive URL on the yarn host", isn(['evil "https://registry.yarnpkg.com/is-odd/-/is-odd-nope.tgz"'])],
        ["a transitive URL under optionalDependencies", isn(['evil "https://registry.yarnpkg.com/is-odd/-/is-odd-nope.tgz"'], "optionalDependencies")],
        ["a transitive registry range with no header (yarn resolves it fresh)", isn(['b "^2.0.0"'])],
        ["a transitive range that differs from the header", isn(['b "^2.1.0"']) + B2],
        ["a transitive link:, even to a locked in-repo link", isn(['w "link:packages/w"'])],
        ["a transitive git spec", isn(['b "git+https://github.com/o/b.git"']) + B2],
        ["a transitive bare (unquoted) range: yarn's tokenizer throws on ^", isn(["b ^2.0.0"]) + B2],
        ["a duplicate dependency name", isn(['b "^2.0.0"', 'b "^2.0.0"']) + B2],
        ["a dependency entry with a third token", isn(['b "^2.0.0" "x"']) + B2],
      ];
      for (const [why, text] of bad) assert.equal(l.deps.yarnLockAllowed(text), false, why);
    },
  },
  {
    id: "lockfile scan (yarn v1): unquoted headers with : or odd starts, lockfile v2 comments, unknown fields, odd lines, outdated entries, bad names -> refused",
    run(l) {
      const ok = YARN_OK;
      const alias = (h: string) => ok.replace('"@s/b@npm:c@^2":', h);
      assert.equal(l.deps.yarnLockAllowed(alias('"is-number@npm:is-odd@3.0.1":')), true, "the quoted alias header");
      assert.equal(l.deps.yarnLockAllowed(alias('"true-a@^2.0.0":')), true, "a quoted name starting with true");
      assert.equal(l.deps.yarnLockAllowed(alias('"@s/b@2":')), true, "a quoted scoped header");
      assert.equal(l.deps.yarnLockAllowed(ok.replace("# yarn lockfile v1", "# yarn lockfile v1\n# THIS IS AN AUTOGENERATED FILE.")), true, "other comments");
      assert.equal(l.deps.yarnLockAllowed(ok.replace('  version "1.1.0"', '  version "1.2.0"')), true, "a version inside every header range");
      const pre = (h: string, v: string) => ok.replace('"@s/b@npm:c@^2":\n  version "2.0.0"', `${h}\n  version "${v}"`);
      assert.equal(l.deps.yarnLockAllowed(pre('"p@^1.0.0-beta.2":', "1.0.0-beta.2")), true, "a prerelease on the range's tuple");
      assert.equal(l.deps.yarnLockAllowed(pre('"p@^2.0.0-next.3":', "2.0.0")), true, "a release above a prerelease range");
      const bad: [string, string][] = [
        ["Auditor: an unquoted header with : (yarn's parser throws, js-yaml reads another key)", alias("is-number@npm:is-odd@3.0.1:")],
        ["two unquoted specs joined by : (yarn reads a string redirect)", ok.replace('"a@^1.0.0", a@^1.1.0:', "a@^1.0.0:a@^1.1.0:")],
        ["an unquoted header starting with true (yarn: a boolean token)", alias("true-a@^2.0.0:")],
        ["an unquoted header starting with @ (yarn: invalid token)", alias("@s/b@2:")],
        ["# yarn lockfile v2 (yarn v1 throws)", ok.replace("# yarn lockfile v1", "# yarn lockfile v2")],
        ["a registry field", ok.replace('  version "1.1.0"', '  version "1.1.0"\n  registry "yarn"')],
        ["a name field", ok.replace('  version "1.1.0"', '  version "1.1.0"\n  name "x"')],
        ["a peerDependencies map", ok.replace('  version "1.1.0"', '  version "1.1.0"\n  peerDependencies:\n    b "^2"')],
        ["a whitespace-only line", ok.replace('  version "1.1.0"\n', '  version "1.1.0"\n  \n')],
        ["an odd indent", ok.replace('  version "1.1.0"', '   version "1.1.0"')],
        ["a field with a third token", ok.replace('  version "1.1.0"', '  version "1.1.0" "1.0.5"')],
        ["a field indented by four", ok.replace('  version "1.1.0"\n  resolved', '  version "1.1.0"\n    resolved')],
        ["a map entry with no map", ok.replace('  version "1.1.0"', '  version "1.1.0"\n    b "^2"')],
        ["a BOM", "\uFEFF" + ok],
        ["a tab", ok.replace('  version "1.1.0"', '  version\t"1.1.0"')],
        ["a trailing # comment on a field", ok.replace('  version "1.1.0"', '  version "1.1.0" # x')],
        ["an outdated entry (yarn resolves it fresh)", ok.replace('  version "1.1.0"', '  version "1.0.5"')],
        ["a version below a prerelease range", pre('"p@^1.0.0-beta.2":', "1.0.0-beta.1")],
        ["a prerelease on another tuple", pre('"p@^1.0.0-beta.2":', "1.0.1-beta.3")],
        ["an alias whose name is a git spec", alias('"git+x@npm:c@^2":')],
        ["an empty range", alias('"b@":')],
        ["a bare-name header (yarn's root lookup tries the bare name first)", alias('"b":')],
      ];
      for (const [why, text] of bad) { assert.notEqual(text, ok, why); assert.equal(l.deps.yarnLockAllowed(text), false, why); }
      assert.equal(l.deps.yarnHeaderSpecs("is-number@npm:is-odd@3.0.1:"), null);
      assert.deepEqual(l.deps.yarnHeaderSpecs('"is-number@npm:is-odd@3.0.1":'), ["is-number@npm:is-odd@3.0.1"]);
      // the semver subset (differentially fuzzed off-repo against yarn 1.22.22's semver; see the spec)
      const sat = (v: string, r: string) => { const p = l.deps.semverParse(v), q = l.deps.semverRange(r); return p && q ? l.deps.semverSatisfies(p, q) : null; };
      assert.deepEqual([sat("1.2.3", "^1.2.0"), sat("2.0.0", "^1.2.0"), sat("0.2.5", "^0.2.3"), sat("0.3.0", "^0.2.3"), sat("1.2.9", "~1.2.3"), sat("1.3.0", "~1.2.3")], [true, false, true, false, true, false]);
      assert.deepEqual([sat("4.5.0", ">= 4.0.0 < 5"), sat("5.0.0", ">= 4.0.0 < 5"), sat("3.9.0", "1 || 3.x"), sat("2.0.0", "*"), sat("2.0.0-a", "*")], [true, false, true, true, false]);
      assert.deepEqual([sat("v1.0.0", "1"), sat("1.0.0", "1.0.0 - 2.0.0"), sat("1.0.0", "~>1"), sat("01.0.0", "1")], [null, null, null, null], "outside the subset");
    },
  },
  {
    id: "pm config (yarn v1): a workspace dep must be satisfied by the workspace version; a package without a version is no workspace; bundledDependencies -> DEPS_PM_CONFIG",
    run(l, ctx) {
      const lock = YARN_OK.replace('"a@^1.0.0", a@^1.1.0:', '"a@1", "a@^1.0.0", a@^1.1.0:');
      const root = (o: Record<string, unknown>) => JSON.stringify({ packageManager: "yarn@1.22.22", private: true, workspaces: ["packages/*"], dependencies: { a: "^1.0.0" }, ...o });
      const w = (o: Record<string, unknown>) => JSON.stringify({ name: "w", version: "1.0.0", ...o });
      const x = (spec: string) => JSON.stringify({ name: "x", dependencies: { w: spec } });
      const base: Record<string, string> = { "package.json": root({}), "yarn.lock": lock, "packages/w/package.json": w({}), "packages/x/package.json": x("^1.0.0") };
      const problem = (files: Record<string, string>) => { const d = plain(dir(ctx, "yarnws"), files); const p = l.deps.pickLockfile(d); assert.ok(!("refuse" in p)); return l.deps.depsSourceProblem(d, p); };
      for (const s of ["^1.0.0", "1.0.0", "*", ">=0.5.0 <2", "1.x"]) assert.equal(problem({ ...base, "packages/x/package.json": x(s) }), null, s);
      assert.equal(problem({ ...base, "package.json": root({ bundledDependencies: [] }) }), null, "an empty bundledDependencies");
      assert.equal(problem({ ...base, "package.json": root({ dependencies: { a: "^1.0.0", w: "^2.0.0" } }), "yarn.lock": lock + '\n"w@^2.0.0":\n  version "2.0.0"\n  resolved "' + REG + 'w/-/w-2.0.0.tgz"\n  integrity ' + INT + "\n" }), null, "a non-satisfying workspace range that is itself locked");
      const bad: [string, Record<string, string>][] = [
        ["a workspace range the workspace version does not satisfy (yarn fetches it)", { ...base, "packages/x/package.json": x("^2.0.0") }],
        ["a workspace prerelease range", { ...base, "packages/x/package.json": x("^1.0.0-beta.1") , "packages/w/package.json": w({ version: "1.0.1-beta.1" }) }],
        ["a workspace without a version is no workspace", { ...base, "packages/w/package.json": JSON.stringify({ name: "w" }) }],
        ["a workspace with a loose version", { ...base, "packages/w/package.json": w({ version: "v1.0.0" }) }],
        ["a workspace dep with a tag", { ...base, "packages/x/package.json": x("latest") }],
        ["bundledDependencies at the root", { ...base, "package.json": root({ bundledDependencies: ["a"] }) }],
        ["bundleDependencies: true in a workspace", { ...base, "packages/w/package.json": w({ bundleDependencies: true }) }],
      ];
      for (const [why, files] of bad) assert.equal(problem(files), "DEPS_PM_CONFIG", why);
    },
  },
  // ---- yarn v1, round 7 (Auditor FAIL e5f28a6): workspace globs yarn normalises but the matcher did not
  {
    id: "pm config (yarn v1): empty / . segments and a trailing / in a glob, unchecked non-workspace manifests, dot and node_modules dirs counted as workspaces -> DEPS_PM_CONFIG",
    run(l, ctx) {
      const lock = ["# yarn lockfile v1", "", '"is-number@7.0.0":', '  version "7.0.0"', `  resolved "${REG}is-number/-/is-number-7.0.0.tgz"`, `  integrity ${INT}`, ""].join("\n");
      const evil = JSON.stringify({ name: "a", version: "1.0.0", dependencies: { evil: "https://registry.yarnpkg.com/is-odd/-/is-odd-nope.tgz" } });
      const fine = JSON.stringify({ name: "a", version: "1.0.0", dependencies: { "is-number": "7.0.0" } });
      const repo = (ws: string[], a: string, extra: Record<string, string> = {}, deps: Record<string, string> = { "is-number": "7.0.0" }) =>
        ({ "package.json": JSON.stringify({ packageManager: "yarn@1.22.22", private: true, workspaces: ws, dependencies: deps }), "yarn.lock": lock, "packages/a/package.json": a, ...extra });
      const problem = (files: Record<string, string>) => { const d = plain(dir(ctx, "yarnglob"), files); const p = l.deps.pickLockfile(d); assert.ok(!("refuse" in p)); assert.equal(p.pm, "yarn"); return l.deps.depsSourceProblem(d, p); };
      assert.equal(problem(repo(["packages/*"], fine)), null, "packages/* with a locked dep");
      assert.equal(problem(repo(["packages/**"], fine)), null, "packages/** with a locked dep");
      assert.equal(problem(repo(["packages/a"], fine)), null, "a literal dir");
      assert.equal(problem(repo(["packages/*"], fine, { "docs/example/package.json": JSON.stringify({ name: "ex", private: true }) })), null, "a fixture without deps");
      assert.equal(problem(repo(["packages/*"], fine, {}, { "is-number": "7.0.0", a: "^1.0.0" })), null, "a dep on a counted workspace");
      for (const g of ["packages//*", "packages/./*", "packages/*/.", "packages/*/", "#packages/*", "packages/*//", "./packages/*", ""]) {
        assert.equal(problem(repo([g], evil)), "DEPS_PM_CONFIG", `Auditor: ${JSON.stringify(g)} with a URL dep in packages/a`);
        assert.equal(problem(repo([g], fine)), "DEPS_PM_CONFIG", `${JSON.stringify(g)} even with harmless packages`);
      }
      const bad: [string, Record<string, string>][] = [
        ["packages/* with a URL dep in packages/a", repo(["packages/*"], evil)],
        ["a URL dep in a package.json no glob matches", repo(["packages/*"], fine, { "tools/x/package.json": evil.replace('"a"', '"x"') })],
        ["a URL dep in a package.json with no workspaces at all", { ...repo(["packages/*"], fine), "package.json": JSON.stringify({ packageManager: "yarn@1.22.22", dependencies: { "is-number": "7.0.0" } }), "packages/a/package.json": evil }],
        ["a dot dir is no workspace for yarn's glob (dot: false), so a dep on its name is unlocked", repo(["packages/*"], fine, { "packages/.h/package.json": JSON.stringify({ name: "h", version: "1.0.0" }) }, { "is-number": "7.0.0", h: "^1.0.0" })],
        ["a dot dir below ** likewise", repo(["packages/**"], fine, { "packages/x/.h/package.json": JSON.stringify({ name: "h", version: "1.0.0" }) }, { "is-number": "7.0.0", h: "^1.0.0" })],
        ["a node_modules dir likewise", repo(["packages/**"], fine, { "packages/x/node_modules/h/package.json": JSON.stringify({ name: "h", version: "1.0.0" }) }, { "is-number": "7.0.0", h: "^1.0.0" })],
        ["a non-JSON package.json anywhere (fail closed)", repo(["packages/*"], fine, { "test/fixtures/broken/package.json": "{ not json" })],
      ];
      for (const [why, files] of bad) assert.equal(problem(files), "DEPS_PM_CONFIG", why);
      for (const g of ["packages//*", "packages/./*", "packages/*/.", "packages/*/", ""]) assert.equal(l.deps.plainGlob(g), false, g);
      for (const g of ["packages/*", "packages/**", "a/b-c_d.e/*"]) assert.equal(l.deps.plainGlob(g), true, g);
    },
  },
  // ---- the shim (guard:shim-report, guard:shim-suites, guard:shim-exit)
  {
    id: "shim: counts come from the runner's JSON report and are printed last",
    run(l, ctx) {
      assert.equal(tail(shim(l, ctx, "", 'test("a", () => {});\ntest("b", () => { throw new Error("x"); });\n')), "# pass 1\n# fail 1");
      assert.equal(tail(shim(l, ctx, "", 'test("a", () => {});\n')), "# pass 1\n# fail 0");
    },
  },
  {
    id: "shim near-misses: no report, a failed suite with no failed test, a nonzero exit with no failures -> all fail",
    run(l, ctx) {
      const ok = 'test("a", () => {});\n';
      assert.equal(tail(shim(l, ctx, "noreport", ok)), "# pass 0\n# fail 1");
      assert.equal(tail(shim(l, ctx, "suitefail", ok)), "# pass 1\n# fail 1");
      assert.equal(tail(shim(l, ctx, "exitonly", ok)), "# pass 1\n# fail 1");
    },
  },
  // ---- end to end through runLoopTask (the stub pm installs the stub vitest; tests run in the stage-2 isolation)
  {
    id: "loop: a vitest task gets its deps, a baseline, then passes; the row says runner, deps and baseline",
    run(l, ctx) {
      const r = l.loop.runLoopTask(ctx.vitest, "public", "a".repeat(64), loopOpts(l, ctx, seq([ADD_FIXED])));
      assert.equal(loopRowProblem(r.row), null, String(loopRowProblem(r.row)));
      if (!ctx.cand) { assert.match(r.row.code, NO_CAND); assert.equal(r.row.baseline, null); return; }
      assert.equal(r.row.code, "PASS");
      assert.equal(r.row.runner, "vitest");
      assert.equal(r.row.deps, "npm");
      assert.deepEqual(r.row.baseline, { total: 2, passing: 1, failing: 1 });
      assert.deepEqual(r.row.tests, { total: 2, passedByPeaceAI: 2, filledByTeam: 0 });
    },
  },
  {
    id: "loop: an edit that passes the team's tests but breaks a related existing test (testsFor) gets RELATED_FAIL",
    run(l, ctx) {
      const r = l.loop.runLoopTask(ctx.vitest, "public", "a".repeat(64), loopOpts(l, ctx, seq([ADD_FIXED_SUB_BROKEN, ADD_FIXED])));
      assert.equal(loopRowProblem(r.row), null, String(loopRowProblem(r.row)));
      if (!ctx.cand) { assert.match(r.row.code, NO_CAND); return; }
      assert.equal(r.row.code, "PASS");
      assert.deepEqual(r.row.attemptCodes, [["RELATED_FAIL"], []]);
    },
  },
  {
    id: "loop: a hidden-set row carries the taskKey and scores only (no repo, commit, runner, deps or baseline)",
    needsCand: "needs the stage-2 candidate uid to reach the test stage (without it every row is CAND_UID_*, runner null)",
    run(l, ctx) {
      const r = l.loop.runLoopTask(ctx.vitest, "hidden", "a".repeat(64), loopOpts(l, ctx, seq([ADD_FIXED])));
      assert.equal(loopRowProblem(r.row), null, String(loopRowProblem(r.row)));
      assert.equal(r.row.code, "PASS", "it did reach the tests");
      assert.deepEqual([r.row.runner, r.row.deps, r.row.baseline, "repo" in r.row, "commit" in r.row], [null, null, null, false, false]);
      assert.deepEqual(r.row.tests, { total: 2, passedByPeaceAI: 2, filledByTeam: 0 });
    },
  },
  {
    id: "loop: refusals before any install or run: another runner, no lockfile (rows stay valid; no edit is asked for)",
    run(l, ctx) {
      let asked = 0;
      const p: Loop.Proposer = { name: "fixed", next: () => { asked++; return { edits: [{ path: "src/calc.ts", content: ADD_FIXED }] }; } };
      const m = l.loop.runLoopTask(ctx.mocha, "public", "a".repeat(64), loopOpts(l, ctx, p));
      assert.equal(loopRowProblem(m.row), null);
      const nl = l.loop.runLoopTask(ctx.nolock, "public", "a".repeat(64), loopOpts(l, ctx, p));
      assert.equal(loopRowProblem(nl.row), null);
      assert.equal(asked, 0);
      if (!ctx.cand) { assert.match(m.row.code, NO_CAND); assert.match(nl.row.code, NO_CAND); return; }
      assert.deepEqual([m.row.code, m.row.runner, m.row.deps, m.row.baseline], ["TEST_RUNNER_UNSUPPORTED", null, null, null]);
      assert.deepEqual([nl.row.code, nl.row.runner, nl.row.deps, nl.row.baseline], ["DEPS_NO_LOCKFILE", "vitest", null, null]);
    },
  },
];
void MIT; void writeFileSync;
