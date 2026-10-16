// Carry-forward verdicts (Architect-approved, for Auditor). When the target moved after grading, the ORIGINAL
// verdict is accepted on the new head only when ALL of these hold; anything else fails closed to the M18
// regrade request (lib/regrade.ts):
//   1. hash      - the chosen diff still hashes to the graded candidate's diffSha256;
//   2. applies   - the diff applies cleanly (plain `git apply --check`, no 3-way) on the new head;
//   3. untouched - none of the candidate's files changed between the old base and the new head;
//   4. fresh     - a fresh Job B grade (M16/M17 regrade record) of THIS candidate on THIS new head is COUNTS:
//                  suite passes, the new test passes with the edit and fails on base, and the stub check passes.
import { createHash } from "node:crypto";
import { patchFiles, type RegradeRecord } from "./rebase.ts";

const SHA = /^[0-9a-f]{40}$/;
export const sha256 = (s: string): string => createHash("sha256").update(s).digest("hex");
export type CarryReason = "carry_hash_mismatch" | "carry_not_clean" | "carry_files_changed" | "carry_no_fresh_grade" | "carry_grade_mismatch" | "carry_grade_not_counts" | "carry_bad_inputs";
export type CarryDecision = { carry: true } | { carry: false; reason: CarryReason };

/** Every path the diff touches (both sides, new tests included). */
export function diffPaths(diff: string): string[] {
  const { newTests, others } = patchFiles(diff);
  const extra = [...diff.matchAll(/^(?:---|\+\+\+) [ab]\/(\S+)$/gm)].map((m) => m[1]!);
  return [...new Set([...newTests, ...others, ...extra])].sort();
}

export interface CarryInput {
  meta: { runId: string; candidateId: string; baseSha: string };
  newHead: string;
  diff: string;
  /** Hash of the candidate as graded (the regrade record's diffSha256, pinned at grading time). */
  gradedDiffSha256: string;
  appliesCleanly: boolean;
  /** `git diff --name-only <old base> <new head>` on the target. */
  changedSinceBase: readonly string[];
  /** The fresh regrade record, parsed JSON (unknown until checked). */
  fresh: unknown;
}

function freshOk(r: unknown, i: CarryInput): CarryReason | null {
  if (!r || typeof r !== "object") return "carry_no_fresh_grade";
  const x = r as Partial<RegradeRecord>;
  if (x.schema !== "peaceai-regrade:v1" || x.runId !== i.meta.runId || x.candidateId !== i.meta.candidateId || x.oldBase !== i.meta.baseSha || x.newHead !== i.newHead || x.diffSha256 !== i.gradedDiffSha256) return "carry_grade_mismatch";
  const g = x.grade;
  if (!g || typeof g !== "object") return "carry_grade_not_counts";
  const oneFn = [...i.diff.matchAll(/^\+export function [A-Za-z_$][\w$]*\(/gm)].length === 1;
  const ok = g.verdict === "COUNTS" && g.suite === true && Array.isArray(g.newTests) && g.newTests.length > 0 && g.afterPass === true && g.beforeFail === true &&
    (oneFn ? g.stubFail === true : g.stubFail === undefined || g.stubFail === true);
  return ok ? null : "carry_grade_not_counts";
}

/** Pure decision; checks run in the order above and the first failure is the reason. */
export function carryForward(i: CarryInput): CarryDecision {
  const no = (reason: CarryReason): CarryDecision => ({ carry: false, reason });
  if (!SHA.test(i.newHead) || !SHA.test(i.meta.baseSha) || i.newHead === i.meta.baseSha || !/^[0-9a-f]{64}$/.test(i.gradedDiffSha256) || !i.diff) return no("carry_bad_inputs");
  if (sha256(i.diff) !== i.gradedDiffSha256) return no("carry_hash_mismatch");
  if (i.appliesCleanly !== true) return no("carry_not_clean");
  const touched = new Set(diffPaths(i.diff));
  if (touched.size === 0 || i.changedSinceBase.some((f) => touched.has(f))) return no("carry_files_changed");
  const f = freshOk(i.fresh, i);
  return f ? no(f) : { carry: true };
}
