// M146 behavior cases for the sandboxed test-and-fix loop (peaceai/lib/loop.ts), as data so the mutation test can
// replay them against each mutant. Each case throws (node:assert) on failure. Cases that need the stage-2 candidate
// uid assert the fail-closed refusal instead where it is not available (the CI test job has no peaceai-cand).
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import type * as Loop from "../lib/loop.ts";
import { loopRowProblem } from "../lib/looprow.ts";
import { RUN_LOG } from "../lib/plangrade.ts";
import type { PlanTask } from "../lib/plan.ts";
import { CALC_FIXED, CALC_WRONG, FLAG_FIXED, SECRET_NAME, type Ctx } from "./m146-fixtures.ts";

type Lib = typeof Loop;
export interface Case { id: string; run: (lib: Lib, ctx: Ctx) => void }

const fixed = (edits: { path: string; content: string }[], calls = { n: 0 }): Loop.Proposer => ({ name: "fixed", next: () => { calls.n++; return { edits }; } });
const opts = (ctx: Ctx, proposer: Loop.Proposer, extra: Partial<Parameters<Lib["runLoopTask"]>[3]> = {}) =>
  ({ root: ctx.root, fetcher: ctx.fetcher, proposer, maxAttempts: 3, runMs: 60_000, env: ctx.env, rules: [], training: new Set<string>(), ...extra });
const run = (lib: Lib, ctx: Ctx, task: PlanTask, proposer: Loop.Proposer, extra = {}) => {
  const r = lib.runLoopTask(task, "public", "a".repeat(64), opts(ctx, proposer, extra));
  assert.equal(loopRowProblem(r.row), null, `row valid (${loopRowProblem(r.row)})`);
  return r;
};
const NO_CAND = /^CAND_UID_/;

export const CASES: Case[] = [
  {
    id: "a known-correct edit passes on the first attempt (team tests run in the stage-2 isolation)",
    run(lib, ctx) {
      const r = run(lib, ctx, ctx.calc, fixed([{ path: "src/calc.ts", content: CALC_FIXED }]));
      if (!ctx.cand) { assert.match(r.row.code, NO_CAND); assert.equal(r.row.attempts, 0); return; }
      assert.equal(r.row.code, "PASS");
      assert.equal(r.row.result, "pass");
      assert.equal(r.row.attempts, 1);
      assert.deepEqual(r.row.attemptCodes, [[]]);
      assert.deepEqual(r.row.tests, { total: 2, passedByPeaceAI: 2, filledByTeam: 0 });
      assert.ok(r.plan && r.context.includes("src/calc.ts"), "planned, and the search tools found the file");
    },
  },
  {
    id: "a wrong edit fails, is revised with codes + test names, and stops at the attempt limit",
    run(lib, ctx) {
      const calls = { n: 0 };
      const seen: Loop.Feedback[][] = [];
      const p: Loop.Proposer = { name: "wrong", next: (i) => { calls.n++; seen.push([...i.feedback]); return { edits: [{ path: "src/calc.ts", content: CALC_WRONG }] }; } };
      const r = run(lib, ctx, ctx.calc, p);
      if (!ctx.cand) { assert.match(r.row.code, NO_CAND); assert.equal(calls.n, 0); return; }
      assert.equal(r.row.code, "ATTEMPT_LIMIT");
      assert.equal(r.row.result, "fail");
      assert.equal(r.row.attempts, 3);
      assert.equal(calls.n, 3);
      assert.deepEqual(r.row.attemptCodes, [["TEST_FAIL"], ["TEST_FAIL"], ["TEST_FAIL"]]);
      assert.deepEqual(r.row.tests, { total: 2, passedByPeaceAI: 0, filledByTeam: 2 });
      assert.deepEqual(seen[2]!.map((f) => f.failing), [["add sums two numbers", "add keeps the other number for zero"], ["add sums two numbers", "add keeps the other number for zero"]]);
      assert.ok(!JSON.stringify(r.row).includes("add sums"), "test names stay out of the log row");
    },
  },
  {
    id: "isolation: writes outside the copy fail, no network (loopback or outside), no env secrets",
    run(lib, ctx) {
      process.env[SECRET_NAME] = "m146-not-a-real-secret";
      ctx.env[SECRET_NAME] = "m146-not-a-real-secret";
      ctx.env.GITHUB_TOKEN = "m146-not-a-real-token";
      try {
        const r = run(lib, ctx, ctx.jail, fixed([{ path: "src/flag.ts", content: FLAG_FIXED }]));
        if (!ctx.cand) { assert.match(r.row.code, NO_CAND); return; }
        assert.equal(r.row.code, "PASS", JSON.stringify(r.attempts));
        assert.deepEqual(r.row.tests, { total: 6, passedByPeaceAI: 6, filledByTeam: 0 });
      } finally { delete process.env[SECRET_NAME]; delete ctx.env[SECRET_NAME]; delete ctx.env.GITHUB_TOKEN; }
      assert.deepEqual(readdirSync(ctx.marker), [], "nothing created in the runner's dir");
      for (const p of ["/tmp/peaceai-m146-escape", "/var/tmp/peaceai-m146-escape", "/dev/shm/peaceai-m146-escape"]) assert.ok(!existsSync(p), p);
      assert.equal(ctx.hits(), 0, "the loopback server was never reached");
    },
  },
  {
    id: "without namespaces (no network isolation) the loop fails closed with ISOLATION_UNAVAILABLE",
    run(lib, ctx) {
      const path = process.env.PATH;
      process.env.PATH = `${ctx.noNs}:${path}`;
      try {
        const r = run(lib, ctx, ctx.calc, fixed([{ path: "src/calc.ts", content: CALC_FIXED }]));
        if (!ctx.cand) { assert.match(r.row.code, NO_CAND); return; }
        assert.equal(r.row.code, "ISOLATION_UNAVAILABLE");
        assert.equal(r.row.attempts, 0);
      } finally { process.env.PATH = path; }
    },
  },
  {
    id: "without the candidate uid the loop refuses before fetching, proposing or running anything",
    run(lib, ctx) {
      let fetched = 0;
      const calls = { n: 0 };
      const env = { ...ctx.env };
      delete env.PEACEAI_STAGE2_CAND;
      const r = run(lib, ctx, ctx.calc, fixed([{ path: "src/calc.ts", content: CALC_FIXED }], calls), { env, fetcher: (...a: Parameters<Loop.CopyFetcher>) => { fetched++; return ctx.fetcher(...a); } });
      assert.equal(r.row.code, "CAND_UID_REQUIRED");
      assert.equal(r.row.result, "refused");
      assert.equal(fetched + calls.n, 0);
      const bad = run(lib, ctx, ctx.calc, fixed([]), { env: { ...env, PEACEAI_STAGE2_CAND: "root" } });
      assert.match(bad.row.code, /^CAND_UID_(?:NOT_SEPARATE|UNREACHABLE|HAS_SUDO)$/);
    },
  },
  {
    id: "PeaceAI's own repos are never a loop target (SELF_TARGET, nothing fetched)",
    run(lib, ctx) {
      let fetched = 0;
      for (const repo of ["PeaceG03/PeaceAI-Workspace", "peaceg03/PeaceAI-Results"]) {
        const r = run(lib, ctx, { ...ctx.calc, repo }, fixed([]), { fetcher: (...a: Parameters<Loop.CopyFetcher>) => { fetched++; return ctx.fetcher(...a); } });
        assert.equal(r.row.code, "SELF_TARGET");
      }
      assert.equal(fetched, 0);
    },
  },
  {
    id: "the same task rules as plan-only: invalid task, license, training overlap",
    run(lib, ctx) {
      assert.equal(run(lib, ctx, { ...ctx.calc, request: "short" }, fixed([])).row.code, "TASK_INVALID");
      assert.equal(run(lib, ctx, ctx.calc, fixed([]), { training: new Set(["m146-fixture/calc"]) }).row.code, "TRAINING_OVERLAP");
      const lic = run(lib, ctx, { ...ctx.calc, licenseSha256: "b".repeat(64) }, fixed([])).row.code;
      if (ctx.cand) assert.equal(lic, "LICENSE_CHANGED"); else assert.match(lic, NO_CAND);
    },
  },
  {
    id: "edit paths: absolute, .., .git, node_modules, symlinks and realpath escapes are refused; plain paths in the copy are fine",
    run(lib, ctx) {
      const d = ctx.edits;
      assert.equal(lib.safeEditPath(d, "src/calc.ts"), join(d, "src/calc.ts"));
      assert.equal(lib.safeEditPath(d, "src/new/deep.ts"), join(d, "src/new/deep.ts"));
      assert.equal(lib.safeEditPath(d, "src/../src/calc.ts"), join(d, "src/calc.ts"));
      for (const bad of [join(d, "src/calc.ts"), "/etc/passwd", `../${basename(d)}/src/calc.ts`, "../x.ts", ".git/config", "src/.git/x", "node_modules/.bin/tsx", "link-in", "out/x.ts", "", "a\\b.ts"]) assert.equal(lib.safeEditPath(d, bad), null, bad);
    },
  },
  {
    id: "a bad edit writes nothing anywhere: EDIT_OUTSIDE_COPY / TEAM_TEST_EDIT stop the loop",
    run(lib, ctx) {
      const copy = { dir: ctx.edits, head: "", teamTests: new Map([["test/t.test.ts", "x"]]), close() {} };
      assert.equal(lib.applyEdits(copy, [{ path: "src/ok.ts", content: "x" }, { path: "out/escape.ts", content: "x" }]), "EDIT_OUTSIDE_COPY");
      assert.ok(!existsSync(join(ctx.edits, "src/ok.ts")) && readdirSync(ctx.marker).length === 0, "all-or-nothing");
      assert.equal(lib.applyEdits(copy, [{ path: "test/t.test.ts", content: "x" }]), "TEAM_TEST_EDIT");
      assert.ok(!existsSync(join(ctx.edits, "test")));
      const r = run(lib, ctx, ctx.calc, fixed([{ path: "../m146-escape.ts", content: "x" }]));
      if (!ctx.cand) { assert.match(r.row.code, NO_CAND); return; }
      assert.equal(r.row.code, "EDIT_OUTSIDE_COPY");
      assert.equal(r.row.attempts, 0);
      assert.equal(run(lib, ctx, ctx.calc, fixed([{ path: "test/calc.test.ts", content: "import test from 'node:test'; test('x', () => {});\n" }])).row.code, "TEAM_TEST_EDIT");
    },
  },
  {
    id: "the rules-only proposer never invents an edit: no approved rule for the plan means NO_EDIT before any run",
    run(lib, ctx) {
      const r = run(lib, ctx, ctx.calc, lib.rulesProposer([]));
      if (!ctx.cand) { assert.match(r.row.code, NO_CAND); return; }
      assert.equal(r.row.code, "NO_EDIT");
      assert.equal(r.row.proposer, "rules-v1");
      assert.equal(r.row.lm, "not-loadable");
      assert.equal(r.row.tests, null);
    },
  },
  {
    id: "a task file not locked in the committed log runs nothing and appends nothing (TASK_FILE_UNLOCKED)",
    run(lib, ctx) {
      const root = join(ctx.base, "lockcase");
      mkdirSync(join(root, "peaceai/plan"), { recursive: true });
      writeFileSync(join(root, RUN_LOG), "");
      const file = join(ctx.base, "lockcase-tasks.json");
      writeFileSync(file, JSON.stringify(ctx.file) + "\n");
      const calls = { n: 0 };
      const r = lib.runLoopFile(file, { root, committed: "", fetcher: ctx.fetcher, proposer: fixed([{ path: "src/calc.ts", content: CALC_FIXED }], calls), env: ctx.env, rules: [], training: new Set<string>(), outDir: join(root, "out") });
      assert.equal(r.code, "TASK_FILE_UNLOCKED");
      assert.equal(r.results.length, 0);
      assert.equal(calls.n, 0, "nothing proposed");
      assert.equal(readFileSync(join(root, RUN_LOG), "utf8"), "", "nothing appended");
      assert.ok(!existsSync(join(root, "out")), "nothing written");
    },
  },
];
