// M169 behavior cases (deps-dir access, install-failure subcodes, inert pnpm-workspace keys, the depsFail row field),
// as data so m169-mutation.test.ts can replay them against each mutant of loopdeps.ts / looprow.ts / loop.ts. Each
// case throws (node:assert) on failure. Every m169 guard has a refused near-miss here. Cases that install need the
// stage-2 candidate uid and sudo: they carry `needsCand` and are SKIPPED (never passes) where it is missing.
// Synthetic fixtures only (the m151 stub package manager and stub vitest; no network, no task repo).
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type * as Deps from "../lib/loopdeps.ts";
import type * as Loop from "../lib/loop.ts";
import type * as Row from "../lib/looprow.ts";
import { ADD_FIXED, pkgJson, repo, type Ctx } from "./m151-fixtures.ts";

export interface Libs { deps: typeof Deps; loop: typeof Loop; row: typeof Row }
export interface Case { id: string; needsCand?: string; run: (l: Libs, ctx: Ctx) => void }
const CAND_SKIP = "needs the stage-2 candidate uid and sudo (box / private job): a real install as that uid";

let n = 0;
const dir = (ctx: Ctx, name: string) => join(ctx.base, "m169", `${name}-${n++}`);
const VDEP = { vitest: "1.0.0" };
function install(l: Libs, ctx: Ctx, base: string, o: Deps.DepsOptions = {}) {
  const d = repo(dir(ctx, "inst"), { "package.json": pkgJson({ test: "vitest run" }, VDEP), "package-lock.json": `{"m169":${n}}\n` });
  mkdirSync(base, { recursive: true });
  const cache = l.deps.openDepsCache(base);
  try { return l.deps.installDeps(d, ctx.cand!, cache, { tool: ctx.tool, timeoutMs: 60_000, ...o, extraEnv: { M151_STUB_VITEST_DIR: ctx.stubVitest, ...o.extraEnv } }); } finally { cache.close(); }
}
const loopOpts = (ctx: Ctx, stubPm: string) => ({
  root: ctx.root, fetcher: ctx.fetcher, maxAttempts: 1, runMs: 60_000, env: ctx.env, rules: [], training: new Set<string>(),
  proposer: { name: "fixed", next: () => ({ edits: [{ path: "src/calc.ts", content: ADD_FIXED }] }) } as Loop.Proposer,
  deps: { tool: ctx.tool, extraEnv: { M151_STUB_VITEST_DIR: ctx.stubVitest, M151_STUB_PM: stubPm } },
});

const row = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  schema: "peaceai-plan-loop:v4", at: "2026-11-02T18:00:00Z", set: "public", taskFileSha256: "a".repeat(64), taskKey: "0123456789abcdef", repo: "o/r", commit: "c".repeat(40),
  workspace: "d".repeat(40), loop: "loop-v2", loopSha256: "e".repeat(64), proposer: "repair-v2", lm: "not-loadable", planner: "plan-only-v1", plannerSha256: "f".repeat(64),
  modelManifestSha256: null, code: "DEPS_INSTALL_FAILED", maxAttempts: 2, attempts: 0, result: "refused", attemptCodes: [], tests: null,
  runner: "vitest", deps: null, baseline: null, ...over,
});
const INERT_OK = "packages:\n  - 'packages/*'\nallowBuilds:\n  '@scope/native': false\n  esbuild: true\nonlyBuiltDependencies:\n  - esbuild\nneverBuiltDependencies:\n  - fsevents\nignoredBuiltDependencies:\n  - core-js\nminimumReleaseAge: 10080\nminimumReleaseAgeExclude:\n  - tool@0.4.36\n  - '@scope/x'\n";

export const CASES: Case[] = [
  {
    id: "subcodes: loopdeps DEPS_FAILS and looprow LOOP_DEPS_FAILS are the same fixed list",
    run(l) { assert.deepEqual([...l.deps.DEPS_FAILS], [...l.row.LOOP_DEPS_FAILS]); },
  },
  {
    id: "row: depsFail is optional on v4 public DEPS_INSTALL_FAILED rows; an unknown code, another row code, a hidden row or a pre-v4 row -> refused",
    run(l) {
      const p = l.row.loopRowProblem;
      assert.equal(p(row()), null, "a v4 row without depsFail (rows before M169) still validates");
      for (const f of l.row.LOOP_DEPS_FAILS) assert.equal(p(row({ depsFail: f })), null, f);
      assert.equal(p(row({ depsFail: "EACCES: permission denied, open '/x'" })), "deps_fail", "message text is never a subcode");
      assert.equal(p(row({ depsFail: "PM_EXIT", code: "DEPS_TIMEOUT" })), "deps_fail_code");
      const { repo: _r, commit: _c, ...hidden } = row({ set: "hidden", runner: null, depsFail: "PM_EXIT" });
      assert.equal(p(hidden), "hidden_detail", "hidden rows carry no install detail");
      const { modelManifestSha256: _m, ...v3 } = row({ schema: "peaceai-plan-loop:v3", depsFail: "PM_EXIT" });
      assert.equal(p(v3), "loop_keys", "depsFail is v4 only");
      assert.equal(p(row({ other: "x" })), "loop_keys", "other extra keys are still refused");
    },
  },
  {
    id: "pnpm-workspace.yaml: the build / release-age keys pass in their documented shapes; a bad shape of each -> refused",
    run(l) {
      const ok = l.deps.pnpmWorkspaceAllowed;
      assert.equal(ok(INERT_OK), true);
      assert.equal(ok("minimumReleaseAge: 0\n"), true);
      const bad: [string, string][] = [
        ["allowBuilds with a non-boolean value", "allowBuilds:\n  esbuild: always\n"],
        ["allowBuilds as a list", "allowBuilds:\n  - esbuild\n"],
        ["allowBuilds with a url key", "allowBuilds:\n  'https://evil.example/x': true\n"],
        ["minimumReleaseAge not a minute count", "minimumReleaseAge: 7d\n"],
        ["minimumReleaseAge as a list", "minimumReleaseAge:\n  - 1\n"],
        ["onlyBuiltDependencies not a list", "onlyBuiltDependencies:\n  esbuild: true\n"],
        ["neverBuiltDependencies with a path", "neverBuiltDependencies:\n  - ../x\n"],
        ["minimumReleaseAgeExclude with a url", "minimumReleaseAgeExclude:\n  - 'https://evil.example/x.tgz'\n"],
        ["ignoredBuiltDependencies with a protocol", "ignoredBuiltDependencies:\n  - 'git:x'\n"],
        ["an unlisted key next to them", INERT_OK + "overrides:\n  a: 1.0.0\n"],
      ];
      for (const [why, text] of bad) assert.equal(ok(text), false, why);
    },
  },
  {
    id: "install: a deps dir the candidate uid cannot reach -> DEPS_INSTALL_FAILED / CAND_NO_ACCESS before the package manager runs; a reachable one installs",
    needsCand: CAND_SKIP,
    run(l, ctx) {
      const locked = dir(ctx, "locked");
      mkdirSync(locked, { recursive: true });
      chmodSync(locked, 0o700); // like a home dir the candidate uid cannot enter
      let ran = 0;
      assert.deepEqual(install(l, ctx, join(locked, "deps"), { onInstall: () => { ran++; } }), { refuse: "DEPS_INSTALL_FAILED", fail: "CAND_NO_ACCESS" });
      assert.equal(ran, 1);
      const open = dir(ctx, "open");
      mkdirSync(open, { recursive: true });
      chmodSync(open, 0o755);
      assert.deepEqual(install(l, ctx, join(open, "deps")), { pm: "npm" }, "near miss: a traversable deps dir");
      assert.deepEqual(install(l, ctx, join(open, "deps2"), { extraEnv: { M151_STUB_PM: "fail" } }), { refuse: "DEPS_INSTALL_FAILED", fail: "PM_EXIT" }, "a failing install keeps its own subcode");
    },
  },
  {
    id: "loop: a public DEPS_INSTALL_FAILED row carries the subcode and validates; a hidden one and other codes carry none",
    needsCand: CAND_SKIP,
    run(l, ctx) {
      const pub = l.loop.runLoopTask(ctx.vitest, "public", "a".repeat(64), loopOpts(ctx, "fail")).row;
      assert.equal(pub.code, "DEPS_INSTALL_FAILED");
      assert.equal(pub.depsFail, "PM_EXIT");
      assert.equal(l.row.loopRowProblem(JSON.parse(JSON.stringify(pub))), null);
      const none = l.loop.runLoopTask(ctx.vitest, "public", "a".repeat(64), loopOpts(ctx, "none")).row;
      assert.equal(none.depsFail, "NO_MODULES");
      const hid = l.loop.runLoopTask(ctx.vitest, "hidden", "a".repeat(64), loopOpts(ctx, "fail")).row;
      assert.equal(hid.code, "DEPS_INSTALL_FAILED");
      assert.ok(!("depsFail" in hid), "hidden rows: no install detail");
      const ok = l.loop.runLoopTask(ctx.vitest, "public", "a".repeat(64), loopOpts(ctx, "")).row;
      assert.notEqual(ok.code, "DEPS_INSTALL_FAILED");
      assert.ok(!("depsFail" in ok));
    },
  },
];

/**
 * bin/loop.ts's catch (M169, Auditor): a task file that is missing, a directory or unreadable -> TASK_FILE_INVALID; a
 * throw from anything else (here openDepsCache on a --deps-dir that is a regular file, after the locked public task
 * file was read and validated, before any task ran) -> "refused LOOP_CRASHED <code>", a fixed code, never message
 * text; nothing is appended to the loop log. `bin` is bin/loop.ts or a mutant of it; `tsx` the tsx binary.
 */
export function binChecks(tsx: string, bin: string, root: string, scratch: string): void {
  const run = (args: string[], extra: Record<string, string> = {}) => {
    const r = spawnSync(tsx, [bin, "run", ...args], { cwd: scratch, encoding: "utf8", env: { ...process.env, PEACEAI_STAGE2_CAND: "", ...extra }, timeout: 120_000 });
    return { out: (r.stdout ?? "").trim(), status: r.status };
  };
  mkdirSync(scratch, { recursive: true });
  const log = join(root, "peaceai/plan/loop-runs.jsonl");
  const before = readFileSync(log, "utf8");
  assert.deepEqual(run([join(scratch, "missing.json")]), { out: "refused TASK_FILE_INVALID", status: 1 }, "a missing task file");
  const asDir = join(scratch, "dir.json");
  mkdirSync(asDir, { recursive: true });
  assert.deepEqual(run([asDir]), { out: "refused TASK_FILE_INVALID", status: 1 }, "a directory as the task file");
  const junk = join(scratch, "junk.json");
  writeFileSync(junk, "{not json");
  assert.deepEqual(run([junk]), { out: "refused TASK_FILE_UNLOCKED", status: 1 }, "an unlocked file is still refused by its own code");
  const notDir = join(scratch, "deps-is-a-file");
  writeFileSync(notDir, "x");
  const crash = run([join(root, "peaceai/plan/tasks-public-v1.json"), "--deps-dir", notDir]);
  assert.match(crash.out, /^refused LOOP_CRASHED (?:EEXIST|ENOTDIR)$/, "a crash that is not the task file's");
  assert.equal(crash.status, 1);
  assert.ok(!crash.out.includes(notDir) && !crash.out.includes(":"), "a code only, no message text");
  // near miss: a real upper-case system code that is not on the allow-list (ENAMETOOLONG from a 300-char --deps-dir
  // component) prints OTHER, never the raw token
  const longDir = join(scratch, "d".repeat(300));
  const near = run([join(root, "peaceai/plan/tasks-public-v1.json"), "--deps-dir", longDir]);
  assert.deepEqual(near, { out: "refused LOOP_CRASHED OTHER", status: 1 }, "a code off the allow-list prints OTHER");
  // near miss (Auditor #667): a non-builtin Error subclass with its own name and no code (thrown from openDepsCache's
  // mkdtemp by a preload) prints OTHER, never its class name or message
  const pre = join(scratch, "leaky-name-preload.mjs");
  writeFileSync(pre, [
    'import fs from "node:fs"; import { syncBuiltinESMExports } from "node:module";',
    "const orig = fs.mkdtempSync;",
    'class LeakyNameError extends Error { constructor() { super("leak-message"); this.name = "LeakyNameError"; } }',
    'fs.mkdtempSync = (p, ...r) => { if (String(p).includes("peaceai-loopdeps-")) throw new LeakyNameError(); return orig(p, ...r); };',
    "syncBuiltinESMExports();",
  ].join("\n"));
  const named = run([join(root, "peaceai/plan/tasks-public-v1.json"), "--deps-dir", join(scratch, "deps-named")], { NODE_OPTIONS: `--import=${pathToFileURL(pre).href}` });
  assert.deepEqual(named, { out: "refused LOOP_CRASHED OTHER", status: 1 }, "a custom Error class name prints OTHER");
  assert.equal(readFileSync(log, "utf8"), before, "no task ran, no row appended");
}
