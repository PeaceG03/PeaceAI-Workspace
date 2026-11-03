// M171 behavior cases (spec loop-isolation-v1.md): the per-task private work dir under os.tmpdir(), the isolation
// checks before candidate code runs (work dir mode, copy inside it, no credential in .git/config, no symlink into a
// private root, candidate access) and the isolationFail row subcode. As data so m171-mutation.test.ts can replay them
// against each mutant of loopdeps.ts / looprow.ts / loop.ts. Each case throws (node:assert) on failure; every
// m171-guard has a refused near-miss here. Cases that run the loop need the stage-2 candidate uid and sudo: they carry
// `needsCand` and are SKIPPED (never passes) where it is missing (the CI test job).
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { appendFileSync, chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, relative } from "node:path";
import type * as Deps from "../lib/loopdeps.ts";
import type * as Loop from "../lib/loop.ts";
import type * as Row from "../lib/looprow.ts";
import type { PlanTask } from "../lib/plan.ts";
import { CLAMP_FIXED, STACK_FIXED, type Ctx } from "./m171-fixtures.ts";
import { ADD_FIXED, type Ctx as Ctx151 } from "./m151-fixtures.ts";

export interface Libs { deps: typeof Deps; loop: typeof Loop; row: typeof Row }
export interface Both { m171: Ctx; m151: Ctx151 }
export interface Case { id: string; needsCand?: string; run: (l: Libs, ctx: Both) => void }
const CAND_SKIP = "needs the stage-2 candidate uid and sudo (box / private job): a real loop run as that uid";

const fixed = (path: string, content: string, calls = { n: 0 }): Loop.Proposer => ({ name: "fixed", next: () => { calls.n++; return { edits: [{ path, content }] }; } });
const EDIT: Record<string, [string, string]> = { "m171-clamp": ["src/clamp.ts", CLAMP_FIXED], "m171-stack": ["src/stack.ts", STACK_FIXED] };
type Extra = Partial<Parameters<Libs["loop"]["runLoopTask"]>[3]>;
function run(l: Libs, ctx: Ctx, t: PlanTask, extra: Extra = {}, set: "public" | "hidden" = "public") {
  const calls = { n: 0 };
  const proposer = fixed(...EDIT[t.id]!, calls);
  const r = l.loop.runLoopTask(t, set, "a".repeat(64), { root: ctx.root, fetcher: ctx.fetcher, proposer, maxAttempts: 2, runMs: 60_000, env: ctx.env, rules: [], training: new Set<string>(), ...extra });
  assert.equal(l.row.loopRowProblem(JSON.parse(JSON.stringify(r.row))), null, `row valid (${l.row.loopRowProblem(r.row)})`);
  return { ...r, calls: calls.n };
}
/** A fetcher that hands the real copy to `edit` (given the work dir it was asked to use) before the loop sees it. */
const tamper = (ctx: Ctx, edit: (copy: string, base: string | undefined) => void, where?: (base: string | undefined) => string | undefined): Loop.CopyFetcher =>
  (repo, commit, merge, files, base) => { const c = ctx.fetcher(repo, commit, merge, files, where ? where(base) : base); edit(c.dir, base); return c; };
/** Refused before anything ran: no plan, no baseline, no attempt, no proposal, nothing in the marker dir. */
function refusedEarly(ctx: Ctx, r: ReturnType<typeof run>, fail: string) {
  assert.equal(r.row.code, "ISOLATION_UNAVAILABLE");
  assert.equal(r.row.isolationFail, fail);
  assert.equal(r.row.result, "refused");
  assert.equal(r.row.attempts, 0);
  assert.equal(r.row.baseline, null);
  assert.equal(r.row.tests, null);
  assert.equal(r.plan, null, "refused before the plan (the first check runs right after the fetch)");
  assert.equal(r.calls, 0, "no proposal asked for");
  assert.deepEqual(readdirSync(ctx.marker), [], "nothing ran outside the isolation");
}
/** This candidate's work dirs under os.tmpdir() (by group: another worker's candidate uid has its own). */
const workDirs = (gid: number) => new Set(readdirSync(tmpdir()).filter((d) => { if (!d.startsWith("peaceai-work-")) return false; try { return statSync(join(tmpdir(), d)).gid === gid; } catch { return false; } }));

const row = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  schema: "peaceai-plan-loop:v4", at: "2026-11-02T18:00:00Z", set: "public", taskFileSha256: "a".repeat(64), taskKey: "0123456789abcdef", repo: "o/r", commit: "c".repeat(40),
  workspace: "d".repeat(40), loop: "loop-v2", loopSha256: "e".repeat(64), proposer: "repair-v2", lm: "not-loadable", planner: "plan-only-v1", plannerSha256: "f".repeat(64),
  modelManifestSha256: null, code: "ISOLATION_UNAVAILABLE", maxAttempts: 2, attempts: 0, result: "refused", attemptCodes: [], tests: null,
  runner: "node-test", deps: "none", baseline: null, ...over,
});

export const CASES: Case[] = [
  {
    id: "row: isolationFail is optional on v4 public ISOLATION_UNAVAILABLE rows; an unknown code, another row code, a hidden row or a pre-v4 row -> refused",
    run(l) {
      const p = l.row.loopRowProblem;
      assert.equal(p(row()), null, "a v4 row without isolationFail (rows before M171) still validates");
      for (const f of l.row.LOOP_ISOLATION_FAILS) assert.equal(p(row({ isolationFail: f })), null, f);
      assert.equal(p(row({ isolationFail: "EACCES: permission denied, scandir '/home/runner/work/_temp'" })), "isolation_fail", "message text is never a subcode");
      assert.equal(p(row({ isolationFail: "WORK_DIR", code: "COMMIT_MISMATCH" })), "isolation_fail_code");
      const { repo: _r, commit: _c, ...hidden } = row({ set: "hidden", runner: null, deps: null, isolationFail: "WORK_DIR" });
      assert.equal(p(hidden), "hidden_detail", "hidden rows carry no isolation detail");
      const { modelManifestSha256: _m, ...v3 } = row({ schema: "peaceai-plan-loop:v3", isolationFail: "WORK_DIR" });
      assert.equal(p(v3), "loop_keys", "isolationFail is v4 only");
    },
  },
  {
    id: "reaches tests: workspace, RUNNER_TEMP and sources under a 0750 dir the candidate cannot enter; both code shapes (a function, a class method) run their baseline and PASS",
    needsCand: CAND_SKIP,
    run(l, { m171: ctx }) {
      const gid = Number(execFileSync("id", ["-g", ctx.cand!.name], { encoding: "utf8" }).trim());
      const before = workDirs(gid);
      const seen: string[] = [];
      const rows = [ctx.clamp, ctx.stack].map((t) => {
        const r = run(l, ctx, t, { fetcher: tamper(ctx, (copy, base) => {
          assert.ok(base, "the loop passes the fetcher a work dir");
          const st = statSync(base!);
          assert.equal(st.mode & 0o777, 0o750, "work dir 0750");
          assert.equal(relative(tmpdir(), base!).startsWith("peaceai-work-"), true, "a fresh mktemp dir directly under os.tmpdir()");
          assert.ok(copy.startsWith(base! + "/"), "the copy is inside it");
          assert.equal(st.gid, gid, "group: the candidate's");
          assert.doesNotMatch(readFileSync(join(copy, ".git/config"), "utf8"), /extraheader|credential|@/i, "no credential in the copy's git config");
          seen.push(base!);
        }) });
        assert.equal(r.row.code, "PASS", `${t.id}: ${r.row.code}/${r.row.isolationFail ?? "-"}`);
        assert.ok(r.row.baseline && r.row.baseline.total === 2 && r.row.baseline.failing >= 1, `${t.id}: baseline ran`);
        assert.ok(!("isolationFail" in r.row));
        return r.row;
      });
      const reachedTests = rows.filter((r) => l.row.reachedTests(r)).length; // as bin/loop.ts counts it (M173: looprow.reachedTests)
      assert.equal(reachedTests, 2);
      assert.equal(seen.length, 2);
      for (const d of seen) assert.ok(!existsSync(d), "the work dir is removed after the task");
      assert.deepEqual([...workDirs(gid)].filter((d) => !before.has(d)), [], "no work dir left behind");
      assert.deepEqual(readdirSync(ctx.marker), [], "the team tests could not write outside the isolation");
    },
  },
  {
    id: "near miss: a work dir the candidate uid cannot reach (under the 0750 dir) -> ISOLATION_UNAVAILABLE / WORK_DIR before fetching, 0 attempts, no fallback",
    needsCand: CAND_SKIP,
    run(l, { m171: ctx }) {
      let fetched = 0;
      const r = run(l, ctx, ctx.clamp, { workBase: join(ctx.home, "work"), fetcher: (...a: Parameters<Loop.CopyFetcher>) => { fetched++; return ctx.fetcher(...a); } });
      refusedEarly(ctx, r, "WORK_DIR");
      assert.equal(fetched, 0, "nothing fetched");
      assert.deepEqual(readdirSync(join(ctx.home, "work")).filter((d) => d.startsWith("peaceai-work-")), [], "the unusable work dir was removed");
    },
  },
  {
    id: "a copy the candidate uid cannot enter (a 0700 dir inside the work dir) -> ISOLATION_UNAVAILABLE / CAND_NO_ACCESS before the plan; the same copy one level up runs",
    needsCand: CAND_SKIP,
    run(l, { m171: ctx }) {
      const sealed = (base: string | undefined) => { const d = join(base!, "sealed"); mkdirSync(d, { mode: 0o700 }); chmodSync(d, 0o700); return d; };
      refusedEarly(ctx, run(l, ctx, ctx.stack, { fetcher: tamper(ctx, () => {}, sealed) }), "CAND_NO_ACCESS");
      const open = (base: string | undefined) => { const d = join(base!, "open"); mkdirSync(d); chmodSync(d, 0o755); return d; };
      assert.equal(run(l, ctx, ctx.stack, { fetcher: tamper(ctx, () => {}, open) }).row.code, "PASS", "near miss: a reachable sub dir");
    },
  },
  {
    id: "a symlink in the copy into a private root (the workspace, RUNNER_TEMP, the runner's home; lexical or resolved) -> PRIVATE_LINK; links inside the copy or to other /tmp files run",
    needsCand: CAND_SKIP,
    run(l, { m171: ctx }) {
      const bad: [string, (copy: string) => string][] = [
        ["workspace file", () => join(ctx.root, "secret.txt")],
        ["RUNNER_TEMP credentials", () => join(ctx.runnerTemp, "git-credentials-m171.config")],
        ["runner home (dangling)", () => join(homedir(), ".git-credentials-m171-absent")],
        ["relative into the workspace", (copy) => relative(join(copy, "src"), join(ctx.root, "secret.txt"))],
      ];
      for (const [why, target] of bad) {
        const r = run(l, ctx, ctx.clamp, { fetcher: tamper(ctx, (copy) => symlinkSync(target(copy), join(copy, "src", "leak"))) });
        assert.equal(r.row.isolationFail, "PRIVATE_LINK", why);
        refusedEarly(ctx, r, "PRIVATE_LINK");
      }
      const outside = join(ctx.base, "public.txt");
      writeFileSync(outside, "x\n");
      const ok = run(l, ctx, ctx.clamp, { fetcher: tamper(ctx, (copy) => { symlinkSync("clamp.ts", join(copy, "src", "alias.ts")); symlinkSync(outside, join(copy, "public.txt")); }) });
      assert.equal(ok.row.code, "PASS", "near miss: links inside the copy or to a non-private /tmp file");
    },
  },
  {
    id: "a credential in the copy's .git/config (an auth extraheader, a credential helper, a user:token@ url) -> PRIVATE_CONFIG; a plain config runs",
    needsCand: CAND_SKIP,
    run(l, { m171: ctx }) {
      for (const text of [
        '[http "https://github.com/"]\n\textraheader = AUTHORIZATION: basic bTE3MA==\n',
        "[credential]\n\thelper = store\n",
        `[remote "origin"]\n\turl = https://${["x-access-token:m171", "github.com"].join("@")}/o/r\n`,
      ]) refusedEarly(ctx, run(l, ctx, ctx.stack, { fetcher: tamper(ctx, (copy) => appendFileSync(join(copy, ".git/config"), text)) }), "PRIVATE_CONFIG");
      const ok = run(l, ctx, ctx.stack, { fetcher: tamper(ctx, (copy) => appendFileSync(join(copy, ".git/config"), "[core]\n\tautocrlf = false\n")) });
      assert.equal(ok.row.code, "PASS", "near miss: a config without credentials");
    },
  },
  {
    id: "a work dir others can enter, or a copy made outside it -> WORK_DIR before the plan",
    needsCand: CAND_SKIP,
    run(l, { m171: ctx }) {
      refusedEarly(ctx, run(l, ctx, ctx.clamp, { fetcher: tamper(ctx, (_c, base) => chmodSync(base!, 0o755)) }), "WORK_DIR");
      refusedEarly(ctx, run(l, ctx, ctx.clamp, { fetcher: tamper(ctx, () => {}, () => undefined) }), "WORK_DIR");
    },
  },
  {
    id: "a private link that appears during the install (after the first check) -> PRIVATE_LINK at the second check, before the baseline; the same install without it runs",
    needsCand: CAND_SKIP,
    run(l, { m151: ctx }) {
      let copy = "";
      const fetcher: Loop.CopyFetcher = (...a) => { const c = ctx.fetcher(...a); copy = c.dir; return c; };
      const opts = (onInstall?: () => void) => ({
        root: ctx.root, fetcher, maxAttempts: 1, runMs: 60_000, env: ctx.env, rules: [], training: new Set<string>(),
        proposer: { name: "fixed", next: () => ({ edits: [{ path: "src/calc.ts", content: ADD_FIXED }] }) } as Loop.Proposer,
        deps: { tool: ctx.tool, extraEnv: { M151_STUB_VITEST_DIR: ctx.stubVitest, M151_STUB_PM: "" }, onInstall },
      });
      const r = l.loop.runLoopTask(ctx.vitest, "public", "a".repeat(64), opts(() => symlinkSync(join(homedir(), ".git-credentials-m171-absent"), join(copy, "leak"))));
      assert.equal(r.row.code, "ISOLATION_UNAVAILABLE");
      assert.equal(r.row.isolationFail, "PRIVATE_LINK");
      assert.equal(r.row.attempts, 0);
      assert.equal(r.row.baseline, null, "the baseline never ran");
      assert.notEqual(r.plan, null, "the first check passed (the link came later)");
      const ok = l.loop.runLoopTask(ctx.vitest, "public", "a".repeat(64), opts()).row;
      assert.notEqual(ok.code, "ISOLATION_UNAVAILABLE", "near miss: the same install without the link");
      assert.notEqual(ok.baseline, null);
    },
  },
  {
    id: "no namespaces (unshare fails, wrapper exit 97) -> NO_NAMESPACES; a failing mount (exit 98) -> MOUNT_FAILED; 0 attempts, no baseline, nothing ran as this uid; hidden rows carry no subcode",
    needsCand: CAND_SKIP,
    run(l, { m171: ctx }) {
      const path = process.env.PATH;
      try {
        for (const [dir, fail] of [[ctx.noNs, "NO_NAMESPACES"], [ctx.noMount, "MOUNT_FAILED"]] as const) {
          process.env.PATH = `${dir}:${path}`;
          const r = run(l, ctx, ctx.stack);
          assert.equal(r.row.code, "ISOLATION_UNAVAILABLE");
          assert.equal(r.row.isolationFail, fail);
          assert.equal(r.row.attempts, 0);
          assert.equal(r.row.baseline, null);
          assert.equal(r.calls, 0);
          assert.deepEqual(readdirSync(ctx.marker), [], "no fallback: the team test never ran outside the isolation");
          const h = run(l, ctx, ctx.stack, {}, "hidden");
          assert.equal(h.row.code, "ISOLATION_UNAVAILABLE");
          assert.ok(!("isolationFail" in h.row), "hidden rows: no isolation detail");
        }
      } finally { process.env.PATH = path; }
    },
  },
];
