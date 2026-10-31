// Cases for the plan-log add-only guard (m146-planlog.ts): admits, and refused near misses. Shared by the M146 test
// and its mutation check, which runs them against copies of the guard with one guard line deleted.
import assert from "node:assert/strict";

type Check = (main: string, branch: string) => string | null;
const H = (c: string, n: number) => c.repeat(n);
const lock = (at: string) => JSON.stringify({ schema: "peaceai-plan-lock:v1", at, set: "public", taskFileSha256: H("a", 64), tasks: 2 });
const run = (at: string, key: string, over: Record<string, unknown> = {}) => JSON.stringify({ schema: "peaceai-plan-run:v1", at, set: "public", taskFileSha256: H("a", 64), taskKey: key, repo: "example-org/example-lib", commit: H("b", 40), workspace: H("c", 40), planner: "plan-only-v1", plannerSha256: H("d", 64), planSha256: null, grader: "plan-grade-v2", code: "FETCH_FAILED", grade: null, ...over });
const L = (...rows: string[]) => rows.map((r) => r + "\n").join("");
const A = lock("2026-10-30T10:00:00Z");
const B = run("2026-10-30T10:01:00Z", "0123456789abcdef");
const C = run("2026-10-30T10:02:00Z", "fedcba9876543210");
const MAIN = L(A, B);

export const PLANLOG_CASES: { id: string; main: string; branch: string; want: string | null }[] = [
  { id: "admit: unchanged", main: MAIN, branch: MAIN, want: null },
  { id: "admit: valid run rows appended", main: MAIN, branch: MAIN + L(C, run("2026-10-30T10:03:00Z", "00112233445566ff", { planner: "plan-only-v2" })), want: null },
  { id: "admit: a lock row appended", main: MAIN, branch: MAIN + L(lock("2026-10-30T10:04:00Z")), want: null },
  { id: "admit: empty main, rows appended", main: "", branch: L(A, B), want: null },
  { id: "refuse: an earlier row edited in place (same length, no row appended)", main: MAIN, branch: L(A, B.replace("FETCH_FAILED", "PLAN_FAILED_")), want: "rewritten" },
  { id: "refuse: an earlier row edited and a valid row appended", main: MAIN, branch: L(A, B.replace("0123456789abcdef", "0123456789abcdee"), C), want: "rewritten" },
  { id: "refuse: an earlier row removed", main: MAIN, branch: L(A), want: "rewritten" },
  { id: "refuse: an earlier row removed and replaced by a valid one", main: MAIN, branch: L(A, C), want: "rewritten" },
  { id: "refuse: rows reordered", main: MAIN, branch: L(B, A), want: "rewritten" },
  { id: "refuse: main without a final newline (an append would join its last line)", main: L(A, B).slice(0, -1), branch: L(A, B).slice(0, -1) + L(C), want: "main_no_final_newline" },
  { id: "refuse: appended row without a final newline", main: MAIN, branch: MAIN + C, want: "no_final_newline" },
  { id: "refuse: appended line is not JSON", main: MAIN, branch: MAIN + "not json\n", want: "row:json" },
  { id: "refuse: appended row fails the row validator (unknown key)", main: MAIN, branch: MAIN + L(run("2026-10-30T10:05:00Z", "aaaaaaaaaaaaaaaa", { note: "x" })), want: "row:run_keys" },
  { id: "refuse: appended hidden row names its repo", main: MAIN, branch: MAIN + L(run("2026-10-30T10:06:00Z", "bbbbbbbbbbbbbbbb", { set: "hidden" })), want: "row:hidden_names_repo" },
];

/** Runs every case; returns the ids that did not get their expected answer. */
export function failingPlanLogCases(check: Check): string[] {
  return PLANLOG_CASES.filter((c) => { try { assert.equal(check(c.main, c.branch), c.want); return false; } catch { return true; } }).map((c) => c.id);
}
