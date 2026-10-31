// M151 behavior cases for loop v2 (peaceai/lib/loopdeps.ts and its use in peaceai/lib/loop.ts), as data so the
// mutation test can replay them against each mutant. Each case throws (node:assert) on failure. Every guard has a
// refused near-miss here. Cases that install need the stage-2 candidate uid (and sudo); where it is missing they
// assert the fail-closed CAND_UID_* refusal instead (the CI test job).
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type * as Deps from "../lib/loopdeps.ts";
import type * as Loop from "../lib/loop.ts";
import { loopRowProblem } from "../lib/looprow.ts";
import { ADD_FIXED, ADD_FIXED_SUB_BROKEN, MIT, pkgJson, plain, repo, STUB_VITEST_CLI, type Ctx } from "./m151-fixtures.ts";

export interface Libs { deps: typeof Deps; loop: typeof Loop }
export interface Case { id: string; run: (l: Libs, ctx: Ctx) => void }

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
    id: "install argv: frozen lockfile and --ignore-scripts for every package manager",
    run(l) {
      const npm = l.deps.installArgv({ pm: "npm", lockfile: "package-lock.json", version: null }, null);
      assert.deepEqual(npm, ["npm", "ci", "--no-audit", "--no-fund", "--ignore-scripts"]);
      assert.deepEqual(l.deps.installArgv({ pm: "pnpm", lockfile: "pnpm-lock.yaml", version: "9.15.9" }, null), ["corepack", "pnpm@9.15.9", "install", "--ignore-pnpmfile", "--frozen-lockfile", "--ignore-scripts"]);
      assert.deepEqual(l.deps.installArgv({ pm: "yarn", lockfile: "yarn.lock", version: "1.22.22" }, null), ["corepack", "yarn@1.22.22", "install", "--non-interactive", "--frozen-lockfile", "--ignore-scripts"]);
    },
  },
  // ---- the install (guard:deps-cand, guard:deps-config, guard:deps-timeout, guard:deps-size)
  {
    id: "install: as the candidate uid, scripts off, config files stripped; the copy gets links into a runner-owned tree",
    run(l, ctx) {
      if (!ctx.cand) return;
      withCache(l, ctx, (cache) => {
        const { d, r } = install(l, ctx, cache, { ".npmrc": "registry=http://127.0.0.1:9/\n" });
        assert.deepEqual(r, { pm: "npm" });
        assert.equal(readFileSync(join(d, "node_modules/.m151-uid"), "utf8"), String(ctx.cand!.uid), "the package manager ran as the candidate uid");
        assert.ok(JSON.parse(readFileSync(join(d, "node_modules/.m151-argv"), "utf8")).includes("--ignore-scripts"));
        assert.ok(!lstatSync(join(d, "node_modules")).isSymbolicLink(), "the copy's node_modules is its own dir");
        assert.ok(lstatSync(join(d, "node_modules/vitest")).isSymbolicLink());
        const staging = [...cache.entries.values()][0] as { staging: string };
        assert.equal(statSync(staging.staging).uid, process.getuid!(), "the installed tree is the runner's again");
        assert.equal(statSync(join(staging.staging, "node_modules")).mode & 0o022, 0, "and not group / world writable");
        assert.ok(!existsSync(join(staging.staging, ".npmrc")), "config files are not in the install tree");
      });
    },
  },
  {
    id: "install near-misses: a hung install -> DEPS_TIMEOUT, an oversized one -> DEPS_TOO_LARGE, a failing one -> DEPS_INSTALL_FAILED",
    run(l, ctx) {
      if (!ctx.cand) return;
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
    run(l, ctx) {
      if (!ctx.cand) return;
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
