// M8: validation for the approval write path. Pure functions; the workflow passes GitHub's event data
// (via env only) and the repository files. An agent never calls this to approve: only Peace's
// `/approve-rule <hash>` comment, delivered by GitHub to the workflow, can produce a list entry.
import { APPROVER, AUDITOR_SOURCE, validateEntry, validateList, withEntry, type ApprovalEntry, type ApprovedList } from "./approved.ts";
import { canonicalJson, specHash, validateSpec } from "./learned.ts";
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

// ---- Delegated approval: `/auditor-approve-rule <id> <sha256>` (Peace, 2026-10-30 ~12:47 AM MT: "Yes I want it
// handed off to you and auditor as well the only input I should be giving is the end goal or a direction and things
// like that"). It adds an entry with source "auditor-approve-rule" and delegatedBy "owner": never an owner approval,
// no credit (policy.ts creditTemplatesFrom and builder-log/rule-skill.ts skip it), listed apart by
// check-approved-list.ts, revertible by Peace (revertProblem below). Peace's own /approve-rule above is unchanged.
// Every agent posts as PeaceG03 (one shared login), so the workflow cannot tell the Auditor's comment from
// another agent's: Builder must never post it, and what keeps it narrow is the checks below, not the author.

export const AUDITOR_APPROVE_COMMAND = /^\/auditor-approve-rule (public-[a-z0-9]+(?:-[a-z0-9]+)*-v[0-9]+) ([0-9a-f]{64})\s*$/;
/** The proposal issue must be Builder's: the same label policy.ts calls BUILDER_LABEL. */
export const SOURCE_BUILDER_LABEL = "source:builder";
/**
 * Kinds whose edits stay inside a target repo's source and tests. Anything else (workflow steps or jobs,
 * env / secret config, tsconfig or package scripts, a kind added later) is never delegable (fail closed).
 */
export const AUDITOR_DELEGABLE_KINDS: ReadonlySet<string> = new Set([
  "ADD_FUNCTION", "ADD_TEST_CASE", "ADD_THROW_GUARD", "COMPLEX_FUNCTION", "DERIVE_FROM_BEHAVIOR", "EXISTING_EDIT",
  "IMPORT_EDIT_V2", "METHOD_GUARD", "REPLACE_EXPRESSION", "SET_LITERAL", "TEST_EXISTING",
]);
/**
 * Words a delegated rule's spec may not name (case-insensitive, anywhere outside evidence.repos): never-zone and
 * protected paths, workflows, the leak / tamper / test gates, credit, tokens and secrets, the verdict, the
 * auditor-pass and approve-rule paths, stage 2 and self-change.
 */
export const AUDITOR_DENY_TERMS = /\.github|workflow|peaceai\/|never-?zone|protected|codeowners|leak|tamper|\bgates?\b|test:self|secret|token|credential|password|deploy.?key|credit|coverage|verdict|auditor|approve|approval|stage-?2|self-?change|package\.json|tsconfig|\.ya?ml\b|\.env\b|npmrc|results/i;

export type AuditorRefusal =
  | Refusal | "NOT_SOURCE_BUILDER" | "ID_NOT_PROPOSAL" | "BODY_SPEC_MISMATCH" | "ALREADY_LISTED" | "PROPOSAL_NOT_UNIQUE"
  | "NOT_TEAM_PICKED" | "KIND_NOT_DELEGABLE" | "TOUCHES_PROTECTED";

/** Why a spec is outside what the Auditor may approve (null = inside). */
export function auditorPolicyProblem(spec: unknown): "KIND_NOT_DELEGABLE" | "TOUCHES_PROTECTED" | null {
  const s = (spec ?? {}) as Record<string, unknown>;
  if (typeof s.kind !== "string" || !AUDITOR_DELEGABLE_KINDS.has(s.kind)) return "KIND_NOT_DELEGABLE";
  const scan: Record<string, unknown> = { ...s };
  if (s.evidence && typeof s.evidence === "object") {
    const ev = { ...(s.evidence as Record<string, unknown>) };
    delete ev.repos; // public repo names (owner/name), not paths this rule edits
    scan.evidence = ev;
  }
  return AUDITOR_DENY_TERMS.test(canonicalJson(scan)) ? "TOUCHES_PROTECTED" : null;
}

/** The proposal record on main (peaceai/rules/proposals/<id>.json) must say team-picked and 0 credit, as fields. */
export function teamPickedProblem(id: string, record: unknown): boolean {
  const r = (record ?? {}) as Record<string, unknown>;
  return !(r.id === id && r.teamPicked === true && r.credit === 0);
}

/** Rule-proposal issues as listed by the API (any state): number and body. */
export interface ProposalIssue { number: number; body: string; isPull: boolean }

/**
 * Validates `/auditor-approve-rule <id> <sha256>` against the proposal issue, the spec in its body, the spec file on
 * main, the proposal record on main, every rule-proposal issue (exactly one for the id) and the current list.
 */
export function validateAuditorApproval(
  ev: CommentEvent,
  files: { spec: unknown; record: unknown },
  proposals: readonly ProposalIssue[],
  current: readonly ApprovalEntry[],
): { ok: true; entry: ApprovalEntry } | { ok: false; reason: AuditorRefusal } {
  const no = (reason: AuditorRefusal) => ({ ok: false as const, reason });
  if (!ev.labels.includes(PROPOSAL_LABEL)) return no("NOT_A_PROPOSAL");
  if (!ev.labels.includes(SOURCE_BUILDER_LABEL)) return no("NOT_SOURCE_BUILDER");
  const cmd = AUDITOR_APPROVE_COMMAND.exec(ev.body.replace(/\r\n/g, "\n"));
  if (!cmd) return no("BAD_COMMAND");
  const [, id, sha] = cmd as unknown as [string, string, string];
  if (ev.author !== APPROVER) return no("WRONG_AUTHOR");
  if (ev.association !== "OWNER") return no("NOT_OWNER");
  if (ev.repo !== "PeaceG03/PeaceAI-Workspace") return no("WRONG_SOURCE");
  const marker = parseMarker(ev.issueBody);
  if (!marker) return no("NO_MARKER");
  if (marker.source !== "public") return no("WRONG_SOURCE");
  if (marker.id !== id) return no("ID_NOT_PROPOSAL");
  if (marker.sha256 !== sha) return no("HASH_NOT_PROPOSAL");
  const body = parseSpecBlock(ev.issueBody);
  if (!validateSpec(body) || body.id !== id || body.minedFrom !== "public" || specHash(body) !== sha) return no("BODY_SPEC_MISMATCH");
  if (files.spec === null || files.spec === undefined) return no("SPEC_MISSING");
  if (!validateSpec(files.spec) || files.spec.id !== id || files.spec.minedFrom !== "public") return no("SPEC_INVALID");
  if (specHash(files.spec) !== sha) return no("SPEC_HASH_MISMATCH");
  if (current.some((e) => e.id === id)) return no("ALREADY_LISTED");
  const same = proposals.filter((p) => !p.isPull && parseMarker(p.body)?.id === id);
  if (same.length !== 1 || same[0]!.number !== ev.issue) return no("PROPOSAL_NOT_UNIQUE");
  if (teamPickedProblem(id, files.record)) return no("NOT_TEAM_PICKED");
  const policy = auditorPolicyProblem(files.spec);
  if (policy) return no(policy);
  const entry: ApprovalEntry = {
    id, sha256: sha, source: AUDITOR_SOURCE, delegatedBy: "owner",
    approval: { url: ev.url, commentId: ev.commentId, issue: ev.issue, repo: "PeaceG03/PeaceAI-Workspace", author: APPROVER, approvedAt: ev.createdAt.replace(/\.\d+Z$/, "Z") },
  };
  return validateEntry(entry) ? { ok: true, entry } : no("BAD_EVENT");
}

/**
 * (d) The landing re-check: the list to land equals main's list plus exactly one new entry, the delegated entry for
 * `id`; nothing else added, removed, re-pinned or reordered beyond withEntry's sort. null = fine.
 */
export function oneAppendProblem(mainList: unknown, landing: unknown, id: string): string | null {
  if (!validateList(mainList) || !validateList(landing)) return "list invalid";
  const added = landing.rules.filter((r) => !mainList.rules.some((m) => JSON.stringify(m) === JSON.stringify(r)));
  const kept = mainList.rules.filter((m) => landing.rules.some((r) => JSON.stringify(m) === JSON.stringify(r)));
  if (kept.length !== mainList.rules.length) return "an existing entry was changed or removed";
  if (added.length !== 1 || landing.rules.length !== mainList.rules.length + 1) return "not exactly one new entry";
  const e = added[0]!;
  if (e.id !== id || e.source !== AUDITOR_SOURCE || e.delegatedBy !== "owner") return "the new entry is not the delegated entry for this id";
  if (mainList.rules.some((m) => m.id === id)) return "the id is already listed";
  if (JSON.stringify(withEntry(mainList, e)) !== JSON.stringify(landing)) return "the list is not main's list plus this one entry";
  return null;
}

/** Peace's revert of a delegated entry lands from this branch prefix; Peace merges it (no workflow does). */
export const REVERT_BRANCH = /^peaceai-revert-auditor-rule\/(public-[a-z0-9]+(?:-[a-z0-9]+)*-v[0-9]+)$/;
/** A revert branch's list must be main's list minus exactly that one delegated entry (null = fine). */
export function revertProblem(branch: string, mainList: unknown, headList: unknown): string | null {
  const m = REVERT_BRANCH.exec(branch);
  if (!m) return "not a revert branch";
  if (!validateList(mainList) || !validateList(headList)) return "list invalid";
  const target = mainList.rules.find((r) => r.id === m[1]);
  if (!target || target.source !== AUDITOR_SOURCE) return "the id is not a delegated (auditor-approve-rule) entry on main";
  const rest = mainList.rules.filter((r) => r !== target);
  return JSON.stringify(rest) === JSON.stringify(headList.rules) ? null : "the list is not main's list minus that one delegated entry";
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
  // A revert branch may change only the list, one commit ahead; check-approved-list.ts also checks its content (revertProblem).
  if (REVERT_BRANCH.test(branch)) {
    if (files.length !== 1 || !touchesList) return "revert branch changes files other than the approved list";
    if (aheadBy !== 1) return "revert branch must be exactly one commit ahead of main";
    return null;
  }
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
    ...added.flatMap((e) => [`Rule: ${e.id}`, `SHA-256: ${e.sha256}`, `Approval: ${e.approval.url}`, `Approval-Author: ${e.approval.author}`, ...(e.source === AUDITOR_SOURCE ? ["Approval-Source: auditor-approve-rule (delegated by the owner; not an owner approval; 0 credit)"] : []), ...(e.attestation ? [`Attestation: PeaceG03/PeaceAI-Results@${e.attestation.commit}:${e.attestation.path}`] : []), ""]),
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
