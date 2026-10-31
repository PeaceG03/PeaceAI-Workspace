// M164 (part A) behavior cases for the loop's handling of a proposer whose next() throws, as data so
// m164-proposer-next.test.ts can replay them against a loop.ts mutant. A throw is the proposer's failure: the task ends
// PROPOSER_FAILED (a fixed code, the error text is dropped), at the first attempt or a later one; it is never
// FETCH_FAILED (the code a throw used to land on). Uses M152's synthetic window fixture (m152-fixtures.ts) and needs
// the stage-2 candidate uid; without it, the case asserts the fail-closed CAND_UID_* refusal.
import assert from "node:assert/strict";
import { loopRowProblem } from "../lib/looprow.ts";
import type * as Prop from "../lib/editpropose.ts";
import type * as Loop from "../lib/loop.ts";
import type { M152Ctx } from "./m152-fixtures.ts";

export interface Libs { prop: typeof Prop; loop: typeof Loop }
export interface Case { id: string; run: (l: Libs, ctx: M152Ctx) => void }

const SECRET = "m164-secret-error-text /tmp/should-never-reach-a-row";

/** The repair proposer, except that attempt `emptyAt` returns `empty` (undefined, a refusal, ...) instead of a proposal. */
function returning(l: Libs, emptyAt: number, empty: unknown, stall: boolean): Loop.Proposer {
  const base = proposer(l, null, stall);
  return { ...base, next: (i) => (i.attempt === emptyAt ? (empty as Loop.Proposal) : base.next(i)) };
}

/** The repair proposer, except that attempt `throwAt` throws (null: never). When `stall`, attempt 1 proposes a
 *  harmless edit (the same buggy source plus a comment) so that a second attempt happens, and attempt 2 proposes the
 *  fixture's one-line fix (so the near miss is deterministic). */
function proposer(l: Libs, throwAt: number | null, stall: boolean): Loop.Proposer {
  const inner = l.prop.repairProposer();
  return {
    name: inner.name,
    prepare: (search, input) => inner.prepare(search, input),
    next(i) {
      if (i.attempt === throwAt) throw new Error(SECRET);
      if (stall && i.attempt === 1) {
        const f = i.files.find((x) => x.path === "src/window.ts");
        assert.ok(f, "the fixture's source is in the proposer's input");
        return { edits: [{ path: f.path, content: `${f.content}// m164: no change in behavior\n` }] };
      }
      if (stall) {
        const f = i.files.find((x) => x.path === "src/window.ts")!;
        assert.ok(f.content.includes("xs.length - n + 1"), "the fixture's bug is still there");
        return { edits: [{ path: f.path, content: f.content.replace("xs.length - n + 1", "xs.length - n") }] };
      }
      return inner.next(i);
    },
  };
}

export const CASES: Case[] = [
  {
    id: "next-failed: a proposer whose next() throws at attempt 1 ends the task PROPOSER_FAILED (not FETCH_FAILED), no error text in the row; near miss: the same proposer not throwing passes",
    run(l, ctx) {
      const opts = (p: Loop.Proposer) => ({ root: ctx.root, fetcher: ctx.fetcher, proposer: p, maxAttempts: 5, runMs: 60_000, env: ctx.env, rules: [], training: new Set<string>() });
      if (!ctx.cand) { assert.match(l.loop.runLoopTask(ctx.task, "public", "a".repeat(64), opts(proposer(l, 1, false))).row.code, /^CAND_UID_/); return; }
      const bad = l.loop.runLoopTask(ctx.task, "public", "a".repeat(64), opts(proposer(l, 1, false)));
      assert.equal(bad.row.code, "PROPOSER_FAILED");
      assert.equal(bad.row.result, "refused");
      assert.equal(bad.row.attempts, 0);
      assert.ok(bad.row.baseline && bad.row.baseline.failing > 0, "the baseline still ran and is recorded");
      assert.equal(loopRowProblem(bad.row), null);
      assert.ok(!JSON.stringify(bad.row).includes("m164-secret"), "the error text reached the row");
      // near miss: the same proposer, not throwing
      assert.equal(l.loop.runLoopTask(ctx.task, "public", "a".repeat(64), opts(proposer(l, null, false))).row.code, "PASS");
    },
  },
  {
    id: "next-failed-later: a throw at attempt 2 (after a failing attempt 1) is PROPOSER_FAILED with attempt 1 recorded; near miss: attempt 2 not throwing passes",
    run(l, ctx) {
      const opts = (p: Loop.Proposer) => ({ root: ctx.root, fetcher: ctx.fetcher, proposer: p, maxAttempts: 5, runMs: 60_000, env: ctx.env, rules: [], training: new Set<string>() });
      if (!ctx.cand) { assert.match(l.loop.runLoopTask(ctx.task, "public", "a".repeat(64), opts(proposer(l, 2, true))).row.code, /^CAND_UID_/); return; }
      const bad = l.loop.runLoopTask(ctx.task, "public", "a".repeat(64), opts(proposer(l, 2, true)));
      assert.equal(bad.row.code, "PROPOSER_FAILED");
      assert.equal(bad.row.result, "refused");
      assert.equal(bad.row.attempts, 1, "attempt 1 ran and is recorded");
      assert.equal(loopRowProblem(bad.row), null);
      assert.ok(!JSON.stringify(bad.row).includes("m164-secret"), "the error text reached the row");
      const good = l.loop.runLoopTask(ctx.task, "public", "a".repeat(64), opts(proposer(l, null, true)));
      assert.equal(good.row.code, "PASS");
      assert.equal(good.row.attempts, 2, "near miss: the stalled attempt 1 really failed, attempt 2 passed");
    },
  },
  {
    id: "next-empty: a next() that returns undefined (attempt 1, or attempt 2 after a failing attempt 1) is PROPOSER_FAILED, not FETCH_FAILED; near miss: a next() returning a refusal object ends with that refusal",
    run(l, ctx) {
      const opts = (p: Loop.Proposer) => ({ root: ctx.root, fetcher: ctx.fetcher, proposer: p, maxAttempts: 5, runMs: 60_000, env: ctx.env, rules: [], training: new Set<string>() });
      if (!ctx.cand) { assert.match(l.loop.runLoopTask(ctx.task, "public", "a".repeat(64), opts(returning(l, 1, undefined, false))).row.code, /^CAND_UID_/); return; }
      const first = l.loop.runLoopTask(ctx.task, "public", "a".repeat(64), opts(returning(l, 1, undefined, false)));
      assert.equal(first.row.code, "PROPOSER_FAILED");
      assert.equal(first.row.result, "refused");
      assert.equal(first.row.attempts, 0);
      assert.equal(loopRowProblem(first.row), null);
      const later = l.loop.runLoopTask(ctx.task, "public", "a".repeat(64), opts(returning(l, 2, undefined, true)));
      assert.equal(later.row.code, "PROPOSER_FAILED");
      assert.equal(later.row.attempts, 1, "attempt 1 ran and is recorded");
      assert.equal(loopRowProblem(later.row), null);
      // near miss: a well-formed non-edit proposal is the proposer's own answer, not a failure
      const refused = l.loop.runLoopTask(ctx.task, "public", "a".repeat(64), opts(returning(l, 1, { refuse: "NO_EDIT" }, false)));
      assert.equal(refused.row.code, "NO_EDIT");
      assert.equal(loopRowProblem(refused.row), null);
    },
  },
];
