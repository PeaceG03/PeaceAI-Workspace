// Carry-forward verdicts (Architect-approved, for Auditor). Flow, end to end (no write token reaches Job B):
//  1. peace-verdict, patch route, stale base: the regrade request comment (M18) also carries a PENDING CARRY
//     (the owner's verdict comment id, label, candidate, old base, diff hash), and the task is re-queued
//     (peaceai:done removed, sweep dispatched): the existing regrade path.
//  2. peace-task: Job A re-applies exactly that diff on the current head; sandboxed Job B grades it; trusted
//     Job C records the attempt (with regradeOf) in Results; the review is posted. All existing steps.
//  3. peace-task `carry` job (trusted, read-only Results + issue): checkCarry() below on trusted outputs only.
//     If ALL four conditions hold it posts a carry comment and dispatches peace-verdict, which re-validates it
//     against the owner's original /verdict comment and records it on the new attempt (no second /verdict).
//     Anything else: nothing happens (today's behaviour: the owner gives a new verdict).
// The four conditions (first failure is the reason; everything else fails closed):
//   1. hash      - the regraded candidate's diff hashes to the pending carry's diffSha256 (= regradeOf's);
//   2. applies   - Job A applied it cleanly on the new head AND `git apply --check` is clean there now;
//   3. untouched - none of the candidate's files changed between the old base and the new head;
//   4. fresh     - its fresh Job B grade on the new head is COUNTS: original suite passes, the new test passes
//                  with the edit and fails on base, and the stub check passes.
import { createHash } from "node:crypto";
import { patchFiles } from "./rebase.ts";
import { parseVerdict } from "./verdict.ts";

const SHA = /^[0-9a-f]{40}$/;
const ID = /^\d{1,20}$/;
export const BOT = "github-actions[bot]";
export const OWNER = "PeaceG03";
export const sha256 = (s: string): string => createHash("sha256").update(s).digest("hex");

export type CarryReason =
  | "carry_none_pending" | "carry_pending_invalid" | "carry_already_applied" | "carry_not_regrade" | "carry_regrade_mismatch"
  | "carry_hash_mismatch" | "carry_not_clean" | "carry_files_changed" | "carry_no_fresh_grade" | "carry_grade_not_counts";
export type CarryDecision = { carry: true } | { carry: false; reason: CarryReason };

// ---------- pending carry (rides at the END of the M18 regrade request comment) ----------
export interface PendingCarry { schema: "peaceai-carry-pending:v1"; issue: number; verdictCommentId: string; label: string; runId: string; candidateId: string; oldBase: string; diffSha256: string }
export const PENDING_OPEN = "<!-- peaceai-carry-pending:v1";
const PENDING_RE = /\n<!-- peaceai-carry-pending:v1\n(.+)\npeaceai-carry-pending -->\n?$/;
export function validPending(p: unknown): p is PendingCarry {
  if (!p || typeof p !== "object") return false;
  const o = p as Record<string, unknown>;
  return Object.keys(o).sort().join(",") === "candidateId,diffSha256,issue,label,oldBase,runId,schema,verdictCommentId" &&
    o.schema === "peaceai-carry-pending:v1" && Number.isInteger(o.issue) && (o.issue as number) > 0 &&
    typeof o.verdictCommentId === "string" && ID.test(o.verdictCommentId) && typeof o.label === "string" && /^[A-Z]$/.test(o.label) &&
    typeof o.runId === "string" && ID.test(o.runId) && typeof o.candidateId === "string" && /^candidate-\d{1,3}$/.test(o.candidateId) &&
    typeof o.oldBase === "string" && SHA.test(o.oldBase) && typeof o.diffSha256 === "string" && /^[0-9a-f]{64}$/.test(o.diffSha256);
}
export function pendingCarryBlock(p: PendingCarry): string {
  if (!validPending(p)) throw new Error("bad pending carry");
  return `\n${PENDING_OPEN}\n${JSON.stringify(p)}\npeaceai-carry-pending -->\n`;
}
export function parsePending(body: string): PendingCarry | null {
  const m = PENDING_RE.exec(body.replace(/\r\n/g, "\n"));
  if (!m) return null;
  try { const p = JSON.parse(m[1]!); return validPending(p) ? p : null; } catch { return null; }
}

// ---------- carry comment (posted by the trusted carry job; read by peace-verdict) ----------
export interface CarryNote { schema: "peaceai-carry:v1"; issue: number; verdictCommentId: string; fromRunId: string; fromCandidate: string; runId: string; label: string }
export const CARRY_MARKER = "<!-- peaceai-carry:v1 -->";
export function validCarryNote(n: unknown): n is CarryNote {
  if (!n || typeof n !== "object") return false;
  const o = n as Record<string, unknown>;
  return Object.keys(o).sort().join(",") === "fromCandidate,fromRunId,issue,label,runId,schema,verdictCommentId" && o.schema === "peaceai-carry:v1" &&
    Number.isInteger(o.issue) && (o.issue as number) > 0 && typeof o.verdictCommentId === "string" && ID.test(o.verdictCommentId) &&
    typeof o.fromRunId === "string" && ID.test(o.fromRunId) && typeof o.fromCandidate === "string" && /^candidate-\d{1,3}$/.test(o.fromCandidate) &&
    typeof o.runId === "string" && ID.test(o.runId) && o.runId !== o.fromRunId && typeof o.label === "string" && /^[A-Z]$/.test(o.label);
}
export function carryComment(n: CarryNote): string {
  if (!validCarryNote(n)) throw new Error("bad carry note");
  return [CARRY_MARKER, `Verdict carried forward: the regraded candidate (run ${n.runId}, label ${n.label}) is the same diff, applies cleanly, touches no file that changed since the old base, and its fresh Job B grade on the new head is COUNTS. The owner's original verdict (comment ${n.verdictCommentId}) is recorded on this attempt; no second /verdict is needed.`, "", "<!-- carry-json", JSON.stringify(n), "carry-json -->", ""].join("\n");
}
export function parseCarryComment(body: string): CarryNote | null {
  const b = body.replace(/\r\n/g, "\n");
  if (!b.startsWith(CARRY_MARKER + "\n")) return null;
  const m = /\n<!-- carry-json\n(.+)\ncarry-json -->\n?$/.exec(b);
  if (!m) return null;
  try { const n = JSON.parse(m[1]!); return validCarryNote(n) ? n : null; } catch { return null; }
}

/** Newest bot regrade request's pending carry, unless a carry comment already followed it. */
export function latestPending(comments: readonly { user: string; body: string }[]): PendingCarry | "invalid" | "applied" | null {
  const mine = comments.filter((c) => c.user === BOT);
  for (let i = mine.length - 1; i >= 0; i--) {
    const b = mine[i]!.body.replace(/\r\n/g, "\n");
    if (b.startsWith(CARRY_MARKER)) return "applied";
    if (b.includes("peaceai-regrade-request")) return b.includes(PENDING_OPEN) ? (parsePending(b) ?? "invalid") : null;
  }
  return null;
}

// ---------- the decision (pure) ----------
export interface FreshGrade { suite: boolean; afterPass: boolean; beforeFail: boolean | null; stubFail?: boolean; verdict: string | null; newTests: number }
export interface CarryInput {
  pending: PendingCarry | "invalid" | "applied" | null;
  /** The new attempt's task record (trusted Job C output in Results). */
  task: { issue: number; runId: string; baseSha: string; regradeOf?: { runId: string; candidateId: string; oldBase: string; diffSha256: string } };
  /** The regraded candidate's recorded diff (Results). */
  diff: string;
  /** Job A applied it on the new head (Results `applied`) and `git apply --check` there now is clean. */
  appliedByJobA: boolean;
  applyCheck: boolean;
  /** `git diff --name-only <old base> <new head>` on the target; null when it could not be computed. */
  changedSinceBase: readonly string[] | null;
  fresh: FreshGrade | null;
}

export function diffPaths(diff: string): string[] {
  const { newTests, others } = patchFiles(diff);
  const extra = [...diff.matchAll(/^(?:---|\+\+\+) [ab]\/(\S+)$/gm)].map((m) => m[1]!);
  return [...new Set([...newTests, ...others, ...extra])].sort();
}

export function checkCarry(i: CarryInput): CarryDecision {
  const no = (reason: CarryReason): CarryDecision => ({ carry: false, reason });
  if (i.pending === null) return no("carry_none_pending");
  if (i.pending === "invalid") return no("carry_pending_invalid");
  if (i.pending === "applied") return no("carry_already_applied");
  const p = i.pending, rg = i.task.regradeOf;
  if (!rg) return no("carry_not_regrade");
  if (p.issue !== i.task.issue || rg.runId !== p.runId || rg.candidateId !== p.candidateId || rg.oldBase !== p.oldBase || rg.diffSha256 !== p.diffSha256 || !SHA.test(i.task.baseSha) || i.task.baseSha === p.oldBase) return no("carry_regrade_mismatch");
  if (!i.diff || sha256(i.diff) !== p.diffSha256) return no("carry_hash_mismatch");
  if (i.appliedByJobA !== true || i.applyCheck !== true) return no("carry_not_clean");
  const touched = new Set(diffPaths(i.diff));
  if (i.changedSinceBase === null || touched.size === 0 || i.changedSinceBase.some((f) => touched.has(f))) return no("carry_files_changed");
  const g = i.fresh;
  if (!g) return no("carry_no_fresh_grade");
  const oneFn = [...i.diff.matchAll(/^\+export function [A-Za-z_$][\w$]*\(/gm)].length === 1;
  const counts = g.verdict === "COUNTS" && g.suite === true && g.newTests > 0 && g.afterPass === true && g.beforeFail === true && (oneFn ? g.stubFail === true : g.stubFail !== false);
  return counts ? { carry: true } : no("carry_grade_not_counts");
}

/** The fresh grade from the regraded candidate's Results record (Job B's results, recorded by trusted Job C). */
export function freshFromRecord(c: { originalSuitePassed: boolean; newTestsPassed: boolean; newTestFiles: number; testGrading?: { beforeFix: boolean | null; stubFails?: boolean; verdict: string } | null } | undefined): FreshGrade | null {
  if (!c || !c.testGrading) return null;
  const g = c.testGrading;
  return { suite: c.originalSuitePassed === true, afterPass: c.newTestsPassed === true, beforeFail: g.beforeFix === null ? null : !g.beforeFix, ...(g.stubFails === undefined ? {} : { stubFail: g.stubFails }), verdict: g.verdict, newTests: c.newTestFiles };
}

// ---------- peace-verdict side: re-validate a dispatched carry against the owner's own comment ----------
export interface GhComment { id: string; user: string; body: string; issue: number; createdAt: string }
export type CarryVerdict = { ok: true; issue: number; body: string; commentId: string; createdAt: string; expectRun: string } | { ok: false; reason: string };
export function validateCarryDispatch(carry: GhComment | null, verdict: GhComment | null, issueComments: readonly { user: string; body: string }[]): CarryVerdict {
  const no = (reason: string): CarryVerdict => ({ ok: false, reason });
  if (!carry || carry.user !== BOT) return no("carry_comment_not_bot");
  const n = parseCarryComment(carry.body);
  if (!n || n.issue !== carry.issue) return no("carry_comment_invalid");
  if (!verdict || verdict.id !== n.verdictCommentId || verdict.user !== OWNER || verdict.issue !== n.issue) return no("carry_verdict_not_owner");
  const v = parseVerdict(verdict.body);
  if (!v.ok || v.command.verdict !== "right" || v.command.label === null) return no("carry_verdict_not_right");
  // The newest pending carry on the issue (before this carry comment) must be for exactly this verdict.
  const before = issueComments.filter((c) => !(c.user === BOT && c.body === carry.body));
  const p = latestPending(before);
  if (!p || typeof p === "string" || p.verdictCommentId !== n.verdictCommentId || p.runId !== n.fromRunId || p.candidateId !== n.fromCandidate || p.label !== v.command.label) return no("carry_pending_mismatch");
  if (!/^\d{4}-\d\d-\d\dT/.test(carry.createdAt)) return no("carry_comment_invalid");
  return { ok: true, issue: n.issue, body: `/verdict ${n.label} right`, commentId: carry.id, createdAt: carry.createdAt, expectRun: n.runId };
}
