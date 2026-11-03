// M173 (Auditor ruling on CI run 41556098711) behavior cases, as data so m173-loop-mutation.test.ts can replay them
// against each mutant of loopdeps.ts / looprow.ts / loop.ts. Three general rules:
//   1. a task reached the team's tests only when its baseline ran with >= 1 executed test and a real report
//      (looprow reachedTests; bin/loop.ts prints that count); a baseline with 0 executed tests is NO_TESTS_RAN, the
//      shim's made-up 1/0/1 is BASELINE_NO_REPORT;
//   2. the shim's made-up counts carry the shim's own exit code (loopdeps SHIM_EXITS), which the loop turns into an
//      attempt code (NO_REPORT, SUITE_LOAD, EXIT_ONLY, always with TEST_FAIL) that loopRowProblem validates;
//   3. a baseline whose suite failed to load or run (BASELINE_SUITE_LOAD) or whose only failure is the exit status
//      (BASELINE_EXIT_ONLY) refuses the task before the proposer is asked: no edit is scored against it.
// Every fixture is synthetic (a temperature converter, a word counter, a fake runner reading its report from env);
// none is modelled on a public dev task or a reference diff. Spec: peaceai/spec/repair-v2-m173.md.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type * as Deps from "../lib/loopdeps.ts";
import type * as Loop from "../lib/loop.ts";
import type * as Row from "../lib/looprow.ts";
import { MIT, pkgJson, type Ctx as Ctx151 } from "./m151-fixtures.ts";

export interface Libs { deps: typeof Deps; loop: typeof Loop; row: typeof Row }
export interface Ctx { m151: Ctx151; scratch: string }
export interface Case { id: string; needsCand?: boolean; run(l: Libs, ctx: Ctx): void }

const put = (dir: string, files: Record<string, string>) => { for (const [p, c] of Object.entries(files)) { mkdirSync(dirname(join(dir, p)), { recursive: true }); writeFileSync(join(dir, p), c); } };
let seq = 0;

// ---- the shim, run directly (plain node, no candidate uid): a fake jest whose report and exit come from env
const FAKE_JEST = [
  'const fs = require("node:fs");',
  'const out = process.argv.find((a) => a.startsWith("--outputFile="))?.slice("--outputFile=".length);',
  'if (out && process.env.M173_REPORT) fs.writeFileSync(out, process.env.M173_REPORT);',
  'process.exit(Number(process.env.M173_EXIT || "0"));',
  "",
].join("\n");
function shimRun(l: Libs, ctx: Ctx, report: object | null, exit: number, withRunner = true): { tail: string; status: number | null } {
  const d = join(ctx.scratch, `shim-${seq++}`);
  put(d, { "package.json": JSON.stringify({ name: "wordcount", private: true }), "t/count.test.js": "// counted by the fake runner\n" });
  if (withRunner) put(d, { "node_modules/jest/package.json": JSON.stringify({ name: "jest", version: "29.7.0", bin: { jest: "bin/jest.js" } }), "node_modules/jest/bin/jest.js": FAKE_JEST });
  l.deps.installShim(d);
  const tmp = join(d, ".tmp");
  mkdirSync(tmp);
  const env: Record<string, string> = { PATH: process.env.PATH ?? "/usr/bin:/bin", TMPDIR: tmp, M173_EXIT: String(exit) };
  if (report) env.M173_REPORT = JSON.stringify(report);
  const r = spawnSync(process.execPath, l.deps.shimArgs({ runner: "jest", pkgDir: "", files: ["t/count.test.js"], hasDeps: true } as Deps.RunnerPick), { cwd: d, encoding: "utf8", env, timeout: 60_000 });
  return { tail: (r.stdout ?? "").trimEnd().split("\n").slice(-2).join("\n"), status: r.status };
}
const rep = (pass: number, fail: number, suites = 0, extra: object = {}) => ({ numPassedTests: pass, numFailedTests: fail, numFailedTestSuites: suites, success: fail === 0 && suites === 0, ...extra });

// ---- a valid v4 public row to vary
function row(l: Libs, over: Record<string, unknown>): Record<string, unknown> {
  return {
    schema: l.row.LOOP_SCHEMA_V4, at: "2026-11-02T18:00:00Z", set: "public", taskFileSha256: "a".repeat(64), taskKey: "0123456789abcdef",
    repo: "example/wordcount", commit: "b".repeat(40), workspace: "c".repeat(40), loop: l.row.LOOP_VERSION_V2, loopSha256: "d".repeat(64),
    proposer: "repair-v2", lm: "not-loadable", code: "ATTEMPT_LIMIT", maxAttempts: 2, attempts: 2, result: "fail",
    attemptCodes: [["TEST_FAIL"], ["TEST_FAIL"]], tests: { total: 3, passedByPeaceAI: 2, filledByTeam: 1 }, runner: "jest", deps: "npm",
    baseline: { total: 3, passing: 2, failing: 1 }, planner: "plan-only-v4", plannerSha256: "e".repeat(64), modelManifestSha256: null, ...over,
  };
}
const unrunRow = (l: Libs, code: string, over: Record<string, unknown> = {}) => row(l, { code, attempts: 0, result: "refused", attemptCodes: [], tests: null, ...over });

// ---- end to end (candidate uid): small vitest-stub repos built from the M151 stub runner and stub package manager
const VITEST_LOCK = JSON.stringify({ name: "fixture", lockfileVersion: 3, requires: true, packages: { "": { name: "fixture", devDependencies: { vitest: "1.0.0" } } } }, null, 1) + "\n";
const G = ["-c", "user.name=PeaceG03", "-c", "user.email=301894882+PeaceG03@users.noreply.github.com", "-c", "commit.gpgsign=false"];
function e2eTask(ctx: Ctx, name: string, src: Record<string, string>, teamTest: string): ReturnType<typeof taskOf> {
  const dir = join(ctx.m151.base, "repos", name);
  const git = (...a: string[]) => execFileSync("git", [...G, ...a], { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  mkdirSync(dir, { recursive: true });
  git("init", "-q", "-b", "main");
  put(dir, { "package.json": pkgJson({ test: "vitest run" }, { vitest: "1.0.0" }), "package-lock.json": VITEST_LOCK, LICENSE: MIT, ...src });
  git("add", "-A"); git("commit", "-q", "-m", "base");
  execFileSync("chmod", ["-R", "a+rX", dir]);
  const commit = git("rev-parse", "HEAD");
  put(dir, { "src/temp.ts": TEMP_SRC["src/temp.ts"] + "// reference\n", "test/unit.test.ts": teamTest }); git("add", "-A"); git("commit", "-q", "-m", "reference");
  return taskOf(ctx, name, commit, git("rev-parse", "HEAD"));
}
function taskOf(ctx: Ctx, name: string, commit: string, merge: string) {
  const src = "src/temp.ts", test = "test/unit.test.ts";
  return { ...ctx.m151.vitest, id: `m173-${name}`.slice(0, 40), repo: `m151-fixture/${name}`, commit,
    request: "Fix the temperature conversion in src/temp.ts so that the team tests pass.",
    tests: { command: "vitest run", files: [test] },
    reference: { from: { pr: 1, merge }, files: [{ path: src, change: "modify" as const }, { path: test, change: "add" as const }],
      steps: [{ action: "edit-source" as const, file: src }, { action: "add-test" as const, file: test }, { action: "run-tests" as const, file: null }], docs: [] } };
}
const counting = () => { let calls = 0; const p: Loop.Proposer = { name: "count", next: () => { calls++; return { refuse: "NO_EDIT" as const }; } }; return { p, calls: () => calls }; };
const opts = (ctx: Ctx, proposer: Loop.Proposer, maxAttempts = 1) => ({
  root: ctx.m151.root, fetcher: ctx.m151.fetcher, proposer, maxAttempts, runMs: 60_000, env: ctx.m151.env, rules: [], training: new Set<string>(),
  deps: { tool: ctx.m151.tool, extraEnv: { M151_STUB_VITEST_DIR: ctx.m151.stubVitest } },
});
const TEMP_SRC = { "src/temp.ts": "export function fahrenheit(c) {\n  return c * 9 / 5 + 32;\n}\n" };

export const CASES: readonly Case[] = [
  // ---- 2: the shim's own exit codes (m173-loop-guard:shim-suite-load, shim-exit-only)
  {
    id: "shim: a real report keeps exit 0 / 1 (a real failing test is exit 1 even when the runner exits with a shim code)",
    run(l, ctx) {
      assert.deepEqual(shimRun(l, ctx, rep(3, 0), 0), { tail: "# pass 3\n# fail 0", status: 0 });
      assert.deepEqual(shimRun(l, ctx, rep(3, 1, 1), 1), { tail: "# pass 3\n# fail 1", status: 1 });
      assert.deepEqual(shimRun(l, ctx, rep(3, 1, 1), 95), { tail: "# pass 3\n# fail 1", status: 1 }, "near miss: the runner exits 95 itself");
      assert.deepEqual(shimRun(l, ctx, rep(3, 1, 1), 94), { tail: "# pass 3\n# fail 1", status: 1 }, "near miss: the runner exits 94 itself");
    },
  },
  {
    id: "shim: no runner, or no report -> 0/1 with the shim's NO_REPORT exit",
    run(l, ctx) {
      const e = l.deps.SHIM_EXITS;
      assert.deepEqual(shimRun(l, ctx, null, 1), { tail: "# pass 0\n# fail 1", status: e.NO_REPORT });
      assert.deepEqual(shimRun(l, ctx, null, 0), { tail: "# pass 0\n# fail 1", status: e.NO_REPORT }, "exit 0 but no report");
      assert.deepEqual(shimRun(l, ctx, rep(1, 0), 0, false), { tail: "# pass 0\n# fail 1", status: e.NO_REPORT }, "no runner package");
    },
  },
  {
    id: "shim: a suite that failed to load or run -> the shim's SUITE_LOAD exit (with or without other failures)",
    run(l, ctx) {
      const e = l.deps.SHIM_EXITS;
      assert.deepEqual(shimRun(l, ctx, rep(0, 0, 1, { numRuntimeErrorTestSuites: 1 }), 1), { tail: "# pass 0\n# fail 1", status: e.SUITE_LOAD });
      assert.deepEqual(shimRun(l, ctx, rep(2, 1, 2, { numRuntimeErrorTestSuites: 1 }), 1), { tail: "# pass 2\n# fail 1", status: e.SUITE_LOAD }, "one suite did not load");
      assert.deepEqual(shimRun(l, ctx, rep(2, 0, 1), 1), { tail: "# pass 2\n# fail 1", status: e.SUITE_LOAD }, "a failed suite with no failed test");
      assert.deepEqual(shimRun(l, ctx, rep(2, 1, 1, { numRuntimeErrorTestSuites: 0 }), 1).status, 1, "near miss: a failed suite that holds a failing test");
    },
  },
  {
    id: "shim: the only failure is the exit status or success:false -> the shim's EXIT_ONLY exit",
    run(l, ctx) {
      const e = l.deps.SHIM_EXITS;
      assert.deepEqual(shimRun(l, ctx, rep(2, 0), 1), { tail: "# pass 2\n# fail 1", status: e.EXIT_ONLY });
      assert.deepEqual(shimRun(l, ctx, { ...rep(2, 0), success: false }, 0), { tail: "# pass 2\n# fail 1", status: e.EXIT_ONLY });
      assert.equal(shimRun(l, ctx, rep(2, 0), 0).status, 0, "near miss: exit 0, success");
    },
  },
  {
    id: "shimSynth reads only the shim's codes, only for a shim runner (m173-loop-guard:synth-json-only)",
    run(l) {
      const e = l.deps.SHIM_EXITS;
      assert.equal(l.loop.shimSynth(true, e.NO_REPORT), "NO_REPORT");
      assert.equal(l.loop.shimSynth(true, e.SUITE_LOAD), "SUITE_LOAD");
      assert.equal(l.loop.shimSynth(true, e.EXIT_ONLY), "EXIT_ONLY");
      for (const c of [0, 1, 2, 97, 98, 124, 137]) assert.equal(l.loop.shimSynth(true, c), null, `exit ${c}`);
      for (const c of [e.NO_REPORT, e.SUITE_LOAD, e.EXIT_ONLY]) assert.equal(l.loop.shimSynth(false, c), null, `node:test exit ${c}`);
      assert.equal(new Set(Object.values(e)).size, 3);
      for (const c of Object.values(e)) assert.ok(![0, 1, 97, 98, 124, 137].includes(c), "no clash with a real, wrapper or timeout exit");
    },
  },
  // ---- 1 / 3: which baselines prove nothing (m173-loop-guard:base-*)
  {
    id: "baselineRefusal: no report, a suite that did not load, 0 executed, exit-only -> a fixed code; real runs -> null",
    run(l) {
      const b = l.loop.baselineRefusal;
      assert.equal(b({ synth: "NO_REPORT", executed: 0 }), "BASELINE_NO_REPORT");
      assert.equal(b({ synth: "NO_REPORT", executed: 1 }), "BASELINE_NO_REPORT", "the 1/0/1 counts are not executed tests");
      assert.equal(b({ synth: "SUITE_LOAD", executed: 0 }), "BASELINE_SUITE_LOAD");
      assert.equal(b({ synth: "SUITE_LOAD", executed: 4 }), "BASELINE_SUITE_LOAD", "partly loaded is not loaded");
      assert.equal(b({ synth: null, executed: 0 }), "NO_TESTS_RAN");
      assert.equal(b({ synth: "EXIT_ONLY", executed: 0 }), "NO_TESTS_RAN");
      assert.equal(b({ synth: "EXIT_ONLY", executed: 3 }), "BASELINE_EXIT_ONLY");
      assert.equal(b({ synth: null, executed: 1 }), null);
      assert.equal(b({ synth: null, executed: 7 }), null);
    },
  },
  // ---- rows (m173-loop-guard:row-*)
  {
    id: "rows: each baseline-unrun code is a v4 refusal with 0 attempts and (public) its baseline; hidden rows keep none",
    run(l) {
      const p = l.row.loopRowProblem;
      assert.equal(p(row(l, {})), null, "the base row is valid");
      assert.equal(p(unrunRow(l, "NO_TESTS_RAN", { baseline: { total: 2, passing: 0, failing: 2 } })), null);
      assert.equal(p(unrunRow(l, "BASELINE_NO_REPORT", { baseline: { total: 1, passing: 0, failing: 1 } })), null);
      assert.equal(p(unrunRow(l, "BASELINE_SUITE_LOAD", { baseline: { total: 1, passing: 0, failing: 1 } })), null);
      assert.equal(p(unrunRow(l, "BASELINE_EXIT_ONLY", { baseline: { total: 3, passing: 2, failing: 1 } })), null);
      const hidden = { set: "hidden", repo: undefined, commit: undefined, runner: null, deps: null, baseline: null };
      const h = unrunRow(l, "BASELINE_SUITE_LOAD", hidden); delete h.repo; delete h.commit;
      assert.equal(p(h), null, "a hidden row names no baseline");
      // near misses
      const v3 = unrunRow(l, "NO_TESTS_RAN", { schema: l.row.LOOP_SCHEMA_V3 }); delete v3.modelManifestSha256;
      assert.equal(p({ ...v3, code: "BASELINE_PASSES" }), null, "the same v3 row with an older code is valid");
      assert.equal(p(v3), "code", "v3 row");
      assert.equal(p(row(l, { code: "BASELINE_SUITE_LOAD", result: "refused", attempts: 1, attemptCodes: [["TEST_FAIL"]] })), "baseline_unrun_attempts");
      assert.equal(p(unrunRow(l, "NO_TESTS_RAN", { baseline: null })), "baseline_presence", "public with no baseline");
      assert.equal(p(unrunRow(l, "BASELINE_NO_REPORT", { baseline: { total: 3, passing: 2, failing: 1 } })), "baseline_no_report", "real-looking counts");
    },
  },
  {
    id: "rows: a made-up attempt failure is one code beside TEST_FAIL, v4 only",
    run(l) {
      const p = l.row.loopRowProblem;
      for (const s of ["NO_REPORT", "SUITE_LOAD", "EXIT_ONLY"]) assert.equal(p(row(l, { attemptCodes: [[s, "TEST_FAIL"].sort(), ["TEST_FAIL"]] })), null, s);
      assert.equal(p(row(l, { attemptCodes: [["SUITE_LOAD"], ["TEST_FAIL"]] })), "attempt_synth", "without TEST_FAIL");
      assert.equal(p(row(l, { attemptCodes: [["NO_REPORT", "SUITE_LOAD", "TEST_FAIL"], ["TEST_FAIL"]] })), "attempt_synth", "two made-up codes");
      const v3 = row(l, { schema: l.row.LOOP_SCHEMA_V3, attemptCodes: [["SUITE_LOAD", "TEST_FAIL"], ["TEST_FAIL"]] }); delete v3.modelManifestSha256;
      assert.equal(p(v3), "attempt_synth", "v3 row");
    },
  },
  {
    id: "reachedTests: only a baseline that ran a real report with >= 1 executed test",
    run(l) {
      const r = l.row.reachedTests as (x: unknown) => boolean;
      assert.equal(r(row(l, {})), true);
      assert.equal(r(row(l, { code: "BASELINE_PASSES" })), true);
      for (const c of l.row.BASELINE_UNRUN_CODES) assert.equal(r(unrunRow(l, c, { baseline: { total: 1, passing: 0, failing: 1 } })), false, c);
      assert.equal(r(row(l, { baseline: null })), false);
    },
  },
  // ---- end to end (candidate uid)
  {
    id: "loop: a team test whose suite does not load refuses BASELINE_SUITE_LOAD before the proposer is asked",
    needsCand: true,
    run(l, ctx) {
      const t = e2eTask(ctx, `m173-load-${seq++}`, TEMP_SRC, 'import assert from "node:assert/strict";\nimport { celsius } from "../src/temp.ts";\n\ntest("celsius from fahrenheit", () => assert.equal(celsius(212), 100));\n');
      const c = counting();
      const r = l.loop.runLoopTask(t as never, "public", "a".repeat(64), opts(ctx, c.p) as never);
      assert.equal(r.row.code, "BASELINE_SUITE_LOAD");
      assert.equal(r.row.attempts, 0);
      assert.equal(c.calls(), 0, "the proposer was asked");
      assert.equal(l.row.loopRowProblem(r.row), null);
      assert.equal(l.row.reachedTests(r.row), false);
    },
  },
  {
    id: "loop: a team test file with no test refuses NO_TESTS_RAN before the proposer is asked",
    needsCand: true,
    run(l, ctx) {
      const t = e2eTask(ctx, `m173-none-${seq++}`, TEMP_SRC, 'import { fahrenheit } from "../src/temp.ts";\n\nexport const boiling = fahrenheit(100);\n');
      const c = counting();
      const r = l.loop.runLoopTask(t as never, "public", "a".repeat(64), opts(ctx, c.p) as never);
      assert.equal(r.row.code, "NO_TESTS_RAN");
      assert.equal(r.row.attempts, 0);
      assert.equal(c.calls(), 0, "the proposer was asked");
      assert.equal(l.row.loopRowProblem(r.row), null);
      assert.equal(l.row.reachedTests(r.row), false);
    },
  },
  {
    id: "loop: a real failing baseline reaches the proposer; an edit that breaks loading is a SUITE_LOAD attempt, not a plain failure",
    needsCand: true,
    run(l, ctx) {
      const t = e2eTask(ctx, `m173-fail-${seq++}`, TEMP_SRC, 'import assert from "node:assert/strict";\nimport { fahrenheit } from "../src/temp.ts";\n\ntest("freezing", () => assert.equal(fahrenheit(0), 32));\ntest("body", () => assert.equal(fahrenheit(37), 98));\n');
      let calls = 0;
      const p: Loop.Proposer = { name: "break", next: () => { calls++; return { edits: [{ path: "src/temp.ts", content: "export function fahrenheit(c) {\n  return (\n}\n" }] }; } };
      const r = l.loop.runLoopTask(t as never, "public", "a".repeat(64), opts(ctx, p) as never);
      assert.equal(calls, 1);
      assert.equal(r.row.code, "ATTEMPT_LIMIT");
      assert.deepEqual(r.row.baseline, { total: 2, passing: 1, failing: 1 });
      assert.deepEqual(r.row.attemptCodes, [["SUITE_LOAD", "TEST_FAIL"]]);
      assert.equal(l.row.loopRowProblem(r.row), null);
      assert.equal(l.row.reachedTests(r.row), true);
    },
  },
];

/** Pins outside the mutated libs: bin/loop.ts counts reachedTests through looprow's helper. */
export function binPin(root: string): void {
  const bin = readFileSync(join(root, "peaceai/bin/loop.ts"), "utf8");
  assert.match(bin, /reachedTests=\$\{out\.results\.filter\(\(x\) => reachedTests\(x\.row\)\)\.length\}/);
  assert.doesNotMatch(bin, /x\.row\.baseline\)\.length/);
}
