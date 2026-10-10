// M8: the hash-pinned approved-rules list and Job A's enforcement. Fail closed: a missing or corrupt list,
// an unlisted rule, or a rule whose content hash differs from the pinned one yields no learned candidate.
import { existsSync, readFileSync } from "node:fs";
import { RULE_ID, specHash, validateSpec, type RuleSpec } from "./learned.ts";

export const APPROVED_SCHEMA = "peaceai-approved-rules:v1" as const;
export const APPROVER = "PeaceG03";
const HEX64 = /^[0-9a-f]{64}$/;
const COMMENT_URL = /^https:\/\/github\.com\/PeaceG03\/(PeaceAI-Workspace|PeaceAI-Results)\/issues\/([1-9][0-9]*)#issuecomment-([1-9][0-9]*)$/;

export interface ApprovalEntry {
  id: string;
  sha256: string;
  source: "workspace" | "results";
  approval: { url: string; commentId: number; issue: number; repo: "PeaceG03/PeaceAI-Workspace" | "PeaceG03/PeaceAI-Results"; author: typeof APPROVER; approvedAt: string };
  /** Results approvals only: the Results commit holding the workflow-written attestation. */
  attestation?: { commit: string; path: string };
}
export interface ApprovedList { schema: typeof APPROVED_SCHEMA; rules: ApprovalEntry[] }

export function validateEntry(e: unknown): e is ApprovalEntry {
  if (!e || typeof e !== "object") return false;
  const x = e as Record<string, unknown>;
  const a = x.approval as Record<string, unknown> | undefined;
  if (typeof x.id !== "string" || !RULE_ID.test(x.id) || typeof x.sha256 !== "string" || !HEX64.test(x.sha256)) return false;
  if (x.source !== "workspace" && x.source !== "results") return false;
  if (!a || typeof a.url !== "string" || a.author !== APPROVER || typeof a.approvedAt !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(a.approvedAt)) return false;
  const m = COMMENT_URL.exec(a.url);
  if (!m || a.commentId !== Number(m[3]) || a.issue !== Number(m[2]) || a.repo !== `PeaceG03/${m[1]}`) return false;
  if ((x.source === "workspace") !== (m[1] === "PeaceAI-Workspace")) return false;
  if (x.source === "workspace" && !x.id.startsWith("public-")) return false; // core rules are approved in Results only
  if (x.source === "results" && !x.id.startsWith("core-")) return false; // Results approves core-mined rules only
  if (x.source === "results") {
    const t = x.attestation as Record<string, unknown> | undefined;
    if (!t || typeof t.commit !== "string" || !/^[0-9a-f]{40}$/.test(t.commit) || t.path !== `rules/approvals/${x.sha256}.json`) return false;
  } else if (x.attestation !== undefined) return false;
  return Object.keys(x).every((k) => ["id", "sha256", "source", "approval", "attestation"].includes(k));
}

export function validateList(o: unknown): o is ApprovedList {
  if (!o || typeof o !== "object") return false;
  const l = o as Record<string, unknown>;
  if (l.schema !== APPROVED_SCHEMA || !Array.isArray(l.rules) || Object.keys(l).some((k) => k !== "schema" && k !== "rules")) return false;
  if (!l.rules.every(validateEntry)) return false;
  const ids = (l.rules as ApprovalEntry[]).map((r) => r.id);
  const comments = (l.rules as ApprovalEntry[]).map((r) => r.approval.url);
  return new Set(ids).size === ids.length && new Set(comments).size === comments.length;
}

export type ListLoad = { ok: true; list: ApprovedList } | { ok: false; reason: "LIST_MISSING" | "LIST_CORRUPT" };
export function loadApprovedList(path: string): ListLoad {
  if (!existsSync(path)) return { ok: false, reason: "LIST_MISSING" };
  let o: unknown;
  try { o = JSON.parse(readFileSync(path, "utf8")); } catch { return { ok: false, reason: "LIST_CORRUPT" }; }
  return validateList(o) ? { ok: true, list: o } : { ok: false, reason: "LIST_CORRUPT" };
}

export type Decision = "APPROVED" | "NOT_APPROVED" | "HASH_CHANGED" | "SPEC_INVALID" | "LIST_MISSING" | "LIST_CORRUPT";
export interface Admission { id: string; decision: Decision; spec: RuleSpec | null }

/** Job A's gate. Only APPROVED rules may run. */
export function admitRules(specs: readonly unknown[], load: ListLoad): Admission[] {
  return specs.map((raw) => {
    const id = raw && typeof raw === "object" && typeof (raw as { id?: unknown }).id === "string" ? String((raw as { id: string }).id) : "(invalid)";
    if (!validateSpec(raw)) return { id, decision: "SPEC_INVALID" as const, spec: null };
    if (!load.ok) return { id, decision: load.reason, spec: null };
    const entry = load.list.rules.find((r) => r.id === raw.id);
    if (!entry) return { id, decision: "NOT_APPROVED" as const, spec: null };
    if (entry.sha256 !== specHash(raw)) return { id, decision: "HASH_CHANGED" as const, spec: null };
    if ((entry.source === "workspace") !== (raw.minedFrom === "public")) return { id, decision: "NOT_APPROVED" as const, spec: null };
    return { id, decision: "APPROVED" as const, spec: raw };
  });
}

/** Adds (or re-pins) one entry; returns a new list sorted by id. */
export function withEntry(list: ApprovedList, entry: ApprovalEntry): ApprovedList {
  return { schema: APPROVED_SCHEMA, rules: [...list.rules.filter((r) => r.id !== entry.id), entry].sort((a, b) => a.id.localeCompare(b.id)) };
}
