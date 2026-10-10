// M8: validation for the approval write path. Pure functions; the workflow passes GitHub's event data
// (via env only) and the repository files. An agent never calls this to approve: only Peace's
// `/approve-rule <hash>` comment, delivered by GitHub to the workflow, can produce a list entry.
import { APPROVER, validateEntry, type ApprovalEntry } from "./approved.ts";
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
