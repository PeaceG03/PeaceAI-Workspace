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
  | "carry_hash_mismatch" | "carry_not_clean" | "carry_files_changed" | "carry_no_fresh_grade" | "carry_grade_not_counts"
  | "carry_rule_unknown" | "carry_grade_type_mismatch";
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
/** How the carry note words the fresh grade: by the grade type the rule declares (suite rules have no COUNTS verdict). */
export function freshGradeWords(grading: GradeType | undefined): string {
  return grading === "suite"
    ? "its fresh suite-only grade on the new head passed (typecheck, original suite and eligibility; this rule has no test grade)"
    : "its fresh Job B grade on the new head is COUNTS";
}
export function carryComment(n: CarryNote, grading?: GradeType): string {
  if (!validCarryNote(n)) throw new Error("bad carry note");
  return [CARRY_MARKER, `Verdict carried forward: the regraded candidate (run ${n.runId}, label ${n.label}) is the same diff, applies cleanly, touches no file that changed since the old base, and ${freshGradeWords(grading)}. The owner's original verdict (comment ${n.verdictCommentId}) is recorded on this attempt; no second /verdict is needed.`, "", "<!-- carry-json", JSON.stringify(n), "carry-json -->", ""].join("\n");
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
  /**
   * M71: the learned rule that produced the candidate, resolved by carry-check from main's approved list and
   * main's spec file (never from the candidate or the issue). `undefined` keeps the original (pre-M71) check for
   * non-learned candidates; `null` means the candidate names a learned rule that main does not approve (refused).
   */
  rule?: DeclaredRule | null;
  /** M71: the regraded candidate's own Job B gates on the new head (Results), for suite-graded rules. */
  suite?: SuiteGrade | null;
}

// ---------- M71: the grade type each approved rule declares ----------
/** The grader a learned rule declares (spec.params.grading on main). */
export type GradeType = "self" | "self-stub" | "suite" | "legacy";
export interface DeclaredRule { id: string; kind: string; grading: GradeType }
export interface SuiteGrade { applied: boolean; typecheck: boolean; suite: boolean; eligible: boolean; testGraded: boolean }
const GRADING: Record<string, GradeType> = {
  "self-fail-before-pass-after": "self",
  "self-fail-before-pass-after-and-stub": "self-stub",
  "target-suite": "suite",
};
/** Gradings with no M71 type (fix-commit tests, workflow-step, none) keep the original pre-M71 check ("legacy"). */
export const gradeTypeOf = (grading: unknown): GradeType => (typeof grading === "string" && Object.hasOwn(GRADING, grading) ? GRADING[grading]! : "legacy");
const OP = /^learned:([a-z0-9][a-z0-9.-]{0,79})@([0-9a-f]{64})$/;
/**
 * Resolve the declared rule for a candidate's `operationId` ("learned:<id>@<specHash>") against main's approved list
 * (id + exact hash) and main's spec (its hash must equal both). `undefined`: not a learned candidate. `null`:
 * a learned candidate whose rule main does not approve at that exact hash, or whose grading is unknown.
 */
export function declaredRule(operationId: string | null | undefined, transformations: readonly string[], approved: readonly { id: string; sha256: string }[], specOf: (id: string) => { spec: { id?: unknown; kind?: unknown; params?: { grading?: unknown } }; hash: string } | null): DeclaredRule | null | undefined {
  if (typeof operationId !== "string" || !operationId.startsWith("learned:")) return undefined;
  const m = OP.exec(operationId);
  if (!m) return null;
  const [, id, hash] = m;
  const entry = approved.find((r) => r.id === id);
  const loaded = specOf(id!);
  if (!entry || !loaded || entry.sha256 !== hash || loaded.hash !== hash || loaded.spec.id !== id || typeof loaded.spec.kind !== "string") return null;
  if (transformations.length !== 1 || transformations[0] !== `LEARNED_${loaded.spec.kind}`) return null;
  return { id: id!, kind: loaded.spec.kind, grading: gradeTypeOf(loaded.spec.params?.grading) };
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
  // M71: a learned candidate is graded by the type its approved rule declares on main.
  if (i.rule === null) return no("carry_rule_unknown");
  if (i.rule !== undefined && i.rule.grading !== "legacy") return ruleGrade(i.rule, i.fresh, i.suite ?? null);
  const g = i.fresh;
  if (!g) return no("carry_no_fresh_grade");
  const oneFn = [...i.diff.matchAll(/^\+export function [A-Za-z_$][\w$]*\(/gm)].length === 1;
  const counts = g.verdict === "COUNTS" && g.suite === true && g.newTests > 0 && g.afterPass === true && g.beforeFail === true && (oneFn ? g.stubFail === true : g.stubFail !== false);
  return counts ? { carry: true } : no("carry_grade_not_counts");
}

function ruleGrade(rule: DeclaredRule, g: FreshGrade | null, s: SuiteGrade | null): CarryDecision {
  const no = (reason: CarryReason): CarryDecision => ({ carry: false, reason });
  if (rule.grading === "suite") {
    // Suite-graded rules (WORKFLOW_JOB, TSCONFIG_SCRIPT): no test grade of its own; the fresh grade is the
    // candidate's own Job B gates on the new head. A test grade on such a candidate does not match its rule.
    if (!s || !s.applied) return no("carry_no_fresh_grade");
    if (s.testGraded || g) return no("carry_grade_type_mismatch");
    return s.typecheck && s.suite && s.eligible ? { carry: true } : no("carry_grade_not_counts");
  }
  if (!g) return s && s.applied && !s.testGraded ? no("carry_grade_type_mismatch") : no("carry_no_fresh_grade");
  const base = g.verdict === "COUNTS" && g.suite === true && g.newTests > 0 && g.afterPass === true && g.beforeFail === true;
  if (rule.grading === "self-stub") return base && g.stubFail === true ? { carry: true } : no("carry_grade_not_counts");
  return base && g.stubFail !== false ? { carry: true } : no("carry_grade_not_counts"); // "self": no stub step declared
}

/** M71: the regraded candidate's own Job B gates, from its Results record. */
export function suiteFromRecord(c: { applied: boolean; typecheckPassed: boolean; originalSuitePassed: boolean; eligible: boolean; testGrading?: unknown } | undefined): SuiteGrade | null {
  if (!c) return null;
  return { applied: c.applied === true, typecheck: c.typecheckPassed === true, suite: c.originalSuitePassed === true, eligible: c.eligible === true, testGraded: c.testGrading !== undefined && c.testGrading !== null };
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
