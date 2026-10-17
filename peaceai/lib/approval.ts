// M8: validation for the approval write path. Pure functions; the workflow passes GitHub's event data
// (via env only) and the repository files. An agent never calls this to approve: only Peace's
// `/approve-rule <hash>` comment, delivered by GitHub to the workflow, can produce a list entry.
import { APPROVER, validateEntry, validateList, withEntry, type ApprovalEntry, type ApprovedList } from "./approved.ts";
import { specHash, validateSpec } from "./learned.ts";
import { parseMarker, parseSpecBlock } from "./propose.ts";

export const PROPOSAL_LABEL = "rule-proposal";
export const APPROVE_COMMAND = /^\/approve-rule ([0-9a-f]{64})\s*$/;

export type Refusal =
  | "NOT_A_PROPOSAL" | "BAD_COMMAND" | "WRONG_AUTHOR" | "NOT_OWNER" | "NO_MARKER" | "HASH_NOT_PROPOSAL"
  | "SPEC_MISSING" | "SPEC_INVALID" | "SPEC_HASH_MISMATCH" | "WRONG_SOURCE" | "ALREADY_APPROVED" | "BAD_EVENT";

export interface CommentEvent {
  repo: string; // owner/name of the repository the comment is in
  body: string;
  author: string; // comment.user.login
  association: string; // comment.author_association
  commentId: number;
  url: string; // comment.html_url
  createdAt: string;
  issue: number;
  labels: readonly string[];
  issueBody: string;
}

/** Validates a Workspace approval comment against the proposal issue and the public spec file. */
export function validateWorkspaceApproval(ev: CommentEvent, specFile: unknown, current: readonly ApprovalEntry[]): { ok: true; entry: ApprovalEntry } | { ok: false; reason: Refusal } {
  if (!ev.labels.includes(PROPOSAL_LABEL)) return { ok: false, reason: "NOT_A_PROPOSAL" };
  const cmd = APPROVE_COMMAND.exec(ev.body.replace(/\r\n/g, "\n"));
  if (!cmd) return { ok: false, reason: "BAD_COMMAND" };
  if (ev.author !== APPROVER) return { ok: false, reason: "WRONG_AUTHOR" };
  if (ev.association !== "OWNER") return { ok: false, reason: "NOT_OWNER" };
  const marker = parseMarker(ev.issueBody);
  if (!marker) return { ok: false, reason: "NO_MARKER" };
  if (marker.sha256 !== cmd[1]) return { ok: false, reason: "HASH_NOT_PROPOSAL" };
  if (marker.source !== "public" || ev.repo !== "PeaceG03/PeaceAI-Workspace") return { ok: false, reason: "WRONG_SOURCE" };
  if (specFile === null || specFile === undefined) return { ok: false, reason: "SPEC_MISSING" };
  if (!validateSpec(specFile) || specFile.id !== marker.id || specFile.minedFrom !== "public") return { ok: false, reason: "SPEC_INVALID" };
  if (specHash(specFile) !== cmd[1]) return { ok: false, reason: "SPEC_HASH_MISMATCH" };
  if (current.some((e) => e.id === marker.id && e.sha256 === cmd[1])) return { ok: false, reason: "ALREADY_APPROVED" };
  const entry: ApprovalEntry = {
    id: marker.id, sha256: cmd[1]!, source: "workspace",
    approval: { url: ev.url, commentId: ev.commentId, issue: ev.issue, repo: "PeaceG03/PeaceAI-Workspace", author: APPROVER, approvedAt: ev.createdAt.replace(/\.\d+Z$/, "Z") },
  };
  return validateEntry(entry) ? { ok: true, entry } : { ok: false, reason: "BAD_EVENT" };
}

/** What the Results approval workflow writes (rules/approvals/<sha>.json in PeaceAI-Results). */
export interface Attestation {
  schema: "peaceai-rule-approval:v1";
  id: string;
  sha256: string;
  issue: number;
  commentId: number;
  commentUrl: string;
  author: typeof APPROVER;
  approvedAt: string;
}

/** Same checks the Results workflow makes, from the Results side (kept identical in results-approve.mjs). */
export function attestationFor(ev: CommentEvent): { ok: true; attestation: Attestation } | { ok: false; reason: Refusal } {
  if (!ev.labels.includes(PROPOSAL_LABEL)) return { ok: false, reason: "NOT_A_PROPOSAL" };
  const cmd = APPROVE_COMMAND.exec(ev.body.replace(/\r\n/g, "\n"));
  if (!cmd) return { ok: false, reason: "BAD_COMMAND" };
  if (ev.author !== APPROVER) return { ok: false, reason: "WRONG_AUTHOR" };
  if (ev.association !== "OWNER") return { ok: false, reason: "NOT_OWNER" };
  const marker = parseMarker(ev.issueBody);
  if (!marker) return { ok: false, reason: "NO_MARKER" };
  if (marker.sha256 !== cmd[1]) return { ok: false, reason: "HASH_NOT_PROPOSAL" };
  if (marker.source !== "core" || ev.repo !== "PeaceG03/PeaceAI-Results") return { ok: false, reason: "WRONG_SOURCE" };
  const spec = parseSpecBlock(ev.issueBody);
  if (!validateSpec(spec) || spec.id !== marker.id || spec.minedFrom !== "core") return { ok: false, reason: "SPEC_INVALID" };
  if (specHash(spec) !== cmd[1]) return { ok: false, reason: "SPEC_HASH_MISMATCH" };
  return { ok: true, attestation: { schema: "peaceai-rule-approval:v1", id: marker.id, sha256: cmd[1]!, issue: ev.issue, commentId: ev.commentId, commentUrl: ev.url, author: APPROVER, approvedAt: ev.createdAt.replace(/\.\d+Z$/, "Z") } };
}

/**
 * Workspace sync of a Results attestation into the list. The core spec file (read from a core checkout)
 * must hash to the attested hash, and the Results commit that added the attestation must cite the comment.
 */
export function entryFromAttestation(att: unknown, commit: string, commitMessage: string, coreSpec: unknown): { ok: true; entry: ApprovalEntry } | { ok: false; reason: Refusal } {
  const a = att as Partial<Attestation> | null;
  if (!a || a.schema !== "peaceai-rule-approval:v1" || a.author !== APPROVER || typeof a.sha256 !== "string" || typeof a.id !== "string" || typeof a.commentUrl !== "string") return { ok: false, reason: "BAD_EVENT" };
  if (!commitMessage.includes(a.commentUrl)) return { ok: false, reason: "BAD_EVENT" };
  if (coreSpec === null || coreSpec === undefined) return { ok: false, reason: "SPEC_MISSING" };
  if (!validateSpec(coreSpec) || coreSpec.id !== a.id || coreSpec.minedFrom !== "core") return { ok: false, reason: "SPEC_INVALID" };
  if (specHash(coreSpec) !== a.sha256) return { ok: false, reason: "SPEC_HASH_MISMATCH" };
  const entry: ApprovalEntry = {
    id: a.id, sha256: a.sha256, source: "results",
    approval: { url: a.commentUrl, commentId: Number(a.commentId), issue: Number(a.issue), repo: "PeaceG03/PeaceAI-Results", author: APPROVER, approvedAt: String(a.approvedAt) },
    attestation: { commit, path: `rules/approvals/${a.sha256}.json` },
  };
  return validateEntry(entry) ? { ok: true, entry } : { ok: false, reason: "BAD_EVENT" };
}

// ---- M8 hardening: the Results sync may only add entries that match a Results attestation.

export const APPROVAL_BRANCH_PREFIX = "peaceai-approve-rule/";
export const LIST_PATH = "peaceai/rules/approved.json";

/** One attestation as read from a fresh Results clone: file content at the recorded commit. */
export interface AttestationRecord {
  content: string; // `git show <commit>:<path>`
  message: string; // that commit's message
  onMain: boolean; // the commit is reachable from Results main
}

export type SyncRefusal =
  | "BASE_ENTRY_CHANGED" | "NOT_A_RESULTS_ENTRY" | "ATTESTATION_MISSING" | "ATTESTATION_NOT_ON_RESULTS_MAIN"
  | "ATTESTATION_MISMATCH" | "ATTESTATION_NOT_CITED" | "LIST_INVALID";

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Compares the list the sync wants to land with the list on main. Workspace entries must be untouched,
 * and every new or re-pinned entry must be a Results entry whose attestation, read from Results at the
 * recorded commit (on Results main, commit message citing the comment), matches it field by field.
 */
export function verifySyncChange(
  base: { rules: readonly ApprovalEntry[] },
  proposed: { rules: readonly ApprovalEntry[] },
  read: (commit: string, path: string) => AttestationRecord | null,
): { ok: true; added: ApprovalEntry[] } | { ok: false; reason: SyncRefusal; id: string } {
  for (const b of base.rules) {
    const p = proposed.rules.find((r) => r.id === b.id);
    if (same(p, b)) continue;
    if (!p || b.source !== "results" || p.source !== "results") return { ok: false, reason: "BASE_ENTRY_CHANGED", id: b.id };
  }
  const added: ApprovalEntry[] = [];
  for (const p of proposed.rules) {
    if (base.rules.some((b) => same(b, p))) continue;
    if (p.source !== "results" || !p.id.startsWith("core-") || !p.attestation) return { ok: false, reason: "NOT_A_RESULTS_ENTRY", id: p.id };
    const rec = read(p.attestation.commit, p.attestation.path);
    if (!rec) return { ok: false, reason: "ATTESTATION_MISSING", id: p.id };
    if (!rec.onMain) return { ok: false, reason: "ATTESTATION_NOT_ON_RESULTS_MAIN", id: p.id };
    let a: Partial<Attestation>;
    try { a = JSON.parse(rec.content); } catch { return { ok: false, reason: "ATTESTATION_MISMATCH", id: p.id }; }
    const matches = a.schema === "peaceai-rule-approval:v1" && a.id === p.id && a.sha256 === p.sha256 && a.author === APPROVER &&
      a.commentUrl === p.approval.url && Number(a.commentId) === p.approval.commentId && Number(a.issue) === p.approval.issue &&
      a.approvedAt === p.approval.approvedAt && p.attestation.path === `rules/approvals/${p.sha256}.json`;
    if (!matches) return { ok: false, reason: "ATTESTATION_MISMATCH", id: p.id };
    if (!rec.message.includes(p.approval.url)) return { ok: false, reason: "ATTESTATION_NOT_CITED", id: p.id };
    added.push(p);
  }
  return { ok: true, added };
}

/** Why a raw list entry for a core-mined rule lacks a valid attestation reference (null = fine). */
export function attestationProblem(raw: unknown): string | null {
  const e = (raw ?? {}) as Record<string, unknown>;
  const id = typeof e.id === "string" ? e.id : "";
  const coreSourced = id.startsWith("core-") || e.source === "results";
  if (!coreSourced) return null;
  if (!id.startsWith("core-")) return "Results entry for a non-core rule";
  if (e.source !== "results") return "core rule not approved through Results";
  const a = (e.approval ?? {}) as Record<string, unknown>;
  const t = e.attestation as Record<string, unknown> | undefined;
  if (!t) return "no attestation reference";
  if (typeof t.commit !== "string" || !/^[0-9a-f]{40}$/.test(t.commit)) return "attestation commit is not a full Results sha";
  if (typeof e.sha256 !== "string" || t.path !== `rules/approvals/${e.sha256}.json`) return "attestation path does not match the pinned hash";
  const m = /^https:\/\/github\.com\/PeaceG03\/PeaceAI-Results\/issues\/([1-9][0-9]*)#issuecomment-([1-9][0-9]*)$/.exec(String(a.url ?? ""));
  if (!m) return "approval URL is not a PeaceAI-Results issue comment";
  if (!Number.isInteger(a.issue) || a.issue !== Number(m[1])) return "issue number missing or does not match the URL";
  if (!Number.isInteger(a.commentId) || a.commentId !== Number(m[2])) return "comment id missing or does not match the URL";
  if (a.repo !== "PeaceG03/PeaceAI-Results" || a.author !== APPROVER) return "approval repo or author is wrong";
  return null;
}

/** An approval PR (or any PR) diff check: files changed against main on this branch. */
export function branchProblem(branch: string, files: readonly string[], aheadBy: number): string | null {
  const touchesList = files.includes(LIST_PATH);
  if (branch.startsWith(APPROVAL_BRANCH_PREFIX)) {
    if (files.length !== 1 || !touchesList) return "approval branch changes files other than the approved list";
    if (aheadBy !== 1) return "approval branch must be exactly one commit ahead of main";
    return null;
  }
  if (touchesList) return "approved list changed outside the approval workflow";
  return null;
}

/** The commit message approve-rule.ts writes for the entries it added (one source of truth for the catch-up pass). */
export function approvalMessage(added: readonly ApprovalEntry[]): string {
  return [
    `approve learned rule${added.length > 1 ? "s" : ""}: ${added.map((e) => e.id).join(", ")}`,
    "",
    ...added.flatMap((e) => [`Rule: ${e.id}`, `SHA-256: ${e.sha256}`, `Approval: ${e.approval.url}`, `Approval-Author: ${e.approval.author}`, ...(e.attestation ? [`Attestation: PeaceG03/PeaceAI-Results@${e.attestation.commit}:${e.attestation.path}`] : []), ""]),
    "Written by the peace-approve-rule workflow from the approval comment(s) above.",
  ].join("\n");
}

// ---- M82: scheduled catch-up for an approval PR whose landing job gave up.
// approve-rule-pr.sh waits <=25 min for the dispatched checks and <=25 min for Peace to "Approve and run" the
// held pull_request runs, then exits and leaves the PR open. The scheduled pass re-checks such a PR from
// scratch and squash-merges it with --match-head-commit only when every guard below holds again. It never
// updates the branch, never approves/cancels/re-runs a run, never edits the list and never lands a Results
// (core) entry; a refusal leaves the PR untouched for Peace.

export const BOT_LOGIN = "github-actions[bot]";
export const BOT_EMAIL = "41898282+github-actions[bot]@users.noreply.github.com";
export const CATCHUP_REQUIRED_CHECKS = ["leak-check", "tamper-proof", "tests"] as const;
/** The landing job's own timeout is 60 min; a younger PR may still be handled by it. */
export const CATCHUP_MIN_AGE_MS = 65 * 60_000;
const CATCHUP_BRANCH = /^peaceai-approve-rule\/[0-9a-f]{12}-[0-9a-f]{6}$/;

export type CatchupReason =
  | "NOT_APPROVAL_PR" | "TOO_YOUNG" | "NOT_ONE_COMMIT" | "NOT_BOT_COMMIT" | "BRANCH" | "STALE_LIST" | "LIST_INVALID"
  | "NOT_ONE_ENTRY" | "NOT_WORKSPACE" | "HEAD_LIST_MISMATCH" | "MESSAGE_MISMATCH" | "COMMENT_MISSING" | "CHECKS_PENDING"
  | "CHECK_FAILED" | "HELD_RUNS" | "RUN_FAILED" | Refusal;

export interface CatchupInput {
  repo: string;
  now: number;
  pr: { number: number; user: string; headRef: string; headRepo: string; baseRef: string; draft: boolean; createdAt: string; headSha: string };
  commits: readonly { sha: string; parents: readonly string[]; authorName: string; authorEmail: string; committerEmail: string; message: string }[];
  files: readonly string[];
  /** main...head compare: commits on head not on main. */
  aheadBy: number;
  /** approved.json text on main, at the approval commit's parent, and at the PR head. */
  mainListText: string;
  parentListText: string;
  headListText: string;
  /** The approval comment (by id) and its issue, re-read from the API; null when unreadable or deleted. */
  approval: (commentId: number) => { comment: { id: number; body: string; user: string; association: string; url: string; createdAt: string; issue: number }; issue: { number: number; labels: readonly string[]; body: string; isPull: boolean } } | null;
  /** The public spec file on main for a rule id (null when absent). */
  spec: (id: string) => unknown;
  checkRuns: readonly { id: number; name: string; status: string; conclusion: string | null }[];
  prRuns: readonly { id: number; event: string; headSha: string; headBranch: string; status: string; conclusion: string | null }[];
}
export type CatchupDecision = { action: "merge"; sha: string; subject: string; body: string; entry: ApprovalEntry } | { action: "wait" | "refuse"; reason: CatchupReason };

const parseList = (text: string): ApprovedList | null => { try { const o = JSON.parse(text); return validateList(o) ? o : null; } catch { return null; } };

export function catchupDecision(x: CatchupInput): CatchupDecision {
  const refuse = (reason: CatchupReason): CatchupDecision => ({ action: "refuse", reason });
  const wait = (reason: CatchupReason): CatchupDecision => ({ action: "wait", reason });
  const p = x.pr;
  // 1. Only a PR the bot itself opened from its own approval branch in this repository, against main.
  if (p.user !== BOT_LOGIN || p.headRepo !== x.repo || p.baseRef !== "main" || p.draft || !CATCHUP_BRANCH.test(p.headRef) || !/^[0-9a-f]{40}$/.test(p.headSha)) return refuse("NOT_APPROVAL_PR");
  const created = Date.parse(p.createdAt);
  if (!Number.isFinite(created)) return refuse("NOT_APPROVAL_PR");
  if (x.now - created < CATCHUP_MIN_AGE_MS) return wait("TOO_YOUNG");
  // 2. Exactly one bot commit, at the head, changing only the list, exactly one commit ahead of main (same rule as tamper-proof).
  if (x.commits.length !== 1 || x.commits[0]!.sha !== p.headSha || x.commits[0]!.parents.length !== 1) return refuse("NOT_ONE_COMMIT");
  const c = x.commits[0]!;
  if (c.authorName !== BOT_LOGIN || c.authorEmail !== BOT_EMAIL || c.committerEmail !== BOT_EMAIL) return refuse("NOT_BOT_COMMIT");
  if (branchProblem(p.headRef, x.files, x.aheadBy)) return refuse("BRANCH");
  // 3. The list on main is byte-identical to the one the approval commit was cut from, so the squash lands exactly the head list.
  if (x.parentListText !== x.mainListText) return refuse("STALE_LIST");
  const main = parseList(x.mainListText);
  const head = parseList(x.headListText);
  if (!main || !head) return refuse("LIST_INVALID");
  // 4. Re-verification: exactly one new or re-pinned entry, from a Workspace /approve-rule that validates again now
  //    against the proposal issue and the spec file on main (its sha must still match).
  const changed = head.rules.filter((r) => !main.rules.some((m) => JSON.stringify(m) === JSON.stringify(r)));
  if (changed.length !== 1) return refuse("NOT_ONE_ENTRY");
  const claimed = changed[0]!;
  if (claimed.source !== "workspace") return refuse("NOT_WORKSPACE");
  const got = x.approval(claimed.approval.commentId);
  if (!got || got.issue.isPull || got.comment.id !== claimed.approval.commentId || got.issue.number !== got.comment.issue) return refuse("COMMENT_MISSING");
  const r = validateWorkspaceApproval(
    { repo: x.repo, body: got.comment.body, author: got.comment.user, association: got.comment.association, commentId: got.comment.id, url: got.comment.url, createdAt: got.comment.createdAt, issue: got.issue.number, labels: got.issue.labels, issueBody: got.issue.body },
    (() => { const m = parseMarker(got.issue.body); return m ? x.spec(m.id) : null; })(), main.rules,
  );
  if (!r.ok) return refuse(r.reason);
  if (JSON.stringify(r.entry) !== JSON.stringify(claimed)) return refuse("HEAD_LIST_MISMATCH");
  if (x.headListText !== JSON.stringify(withEntry(main, r.entry), null, 2) + "\n") return refuse("HEAD_LIST_MISMATCH");
  const msg = approvalMessage([r.entry]);
  if (c.message.replace(/\s+$/, "") !== msg) return refuse("MESSAGE_MISMATCH");
  // 5. Every required check-run on the exact head succeeded (latest run of each name), as approve-rule-pr.sh requires.
  for (const name of CATCHUP_REQUIRED_CHECKS) {
    const latest = x.checkRuns.filter((k) => k.name === name).sort((a, b) => b.id - a.id)[0];
    if (!latest || latest.status !== "completed") return wait("CHECKS_PENDING");
    if (latest.conclusion !== "success") return refuse("CHECK_FAILED");
  }
  // 6. The PR's own pull_request runs on that head: none still held or running, none failed.
  const runs = x.prRuns.filter((k) => k.event === "pull_request" && k.headSha === p.headSha && k.headBranch === p.headRef);
  if (runs.some((k) => k.conclusion === "action_required" || k.status !== "completed")) return wait("HELD_RUNS");
  if (runs.some((k) => k.conclusion !== "success" && k.conclusion !== "skipped")) return refuse("RUN_FAILED");
  const lines = msg.split("\n");
  return { action: "merge", sha: p.headSha, subject: `${lines[0]} (#${p.number})`, body: lines.slice(2).join("\n").replace(/\s+$/, ""), entry: r.entry };
}
