// M59: why the approved learned rules produced no candidate. Each entry is a rule id and a reason code from
// lib/learned-guard.ts (optionally `code: name,name` for unsafe_condition). Everything is re-validated against a
// strict character set here before it reaches the run log, a job output or an issue comment: rule ids and
// identifiers only, never secrets, paths or file contents. Anything else becomes `refused`.
import { scanText } from "./leak.ts";

export type RuleRefusal = { id: string; reason: string };

const ID = /^[a-z0-9][a-z0-9.-]{0,79}$/;
const REASON = /^[a-z_]{1,40}(?:: [A-Za-z_$][\w$]{0,63}(?:,[A-Za-z_$][\w$]{0,63}){0,4})?$/;
const MAX_ENTRIES = 5;

/** A name that looks like a credential (GitHub, AWS, Slack tokens) or a long hex string is never echoed. */
export const SECRET_NAME = /ghp_|gh[ousr]_|github_pat_|AKIA|xox|[0-9a-fA-F]{32,}/;

/** Drops secret-looking names from a reason (a reason left with no names keeps just its code). */
function dropSecretNames(reason: string): string {
  const i = reason.indexOf(": ");
  if (i < 0) return reason;
  const names = reason.slice(i + 2).split(",").filter((n) => !SECRET_NAME.test(n));
  return names.length ? `${reason.slice(0, i)}: ${names.join(",")}` : reason.slice(0, i);
}

export function cleanRefusals(list: readonly RuleRefusal[]): RuleRefusal[] {
  return list
    .filter((r) => ID.test(r.id) && !SECRET_NAME.test(r.id))
    .slice(0, MAX_ENTRIES)
    .map((r) => ({ id: r.id, reason: REASON.test(r.reason) ? dropSecretNames(r.reason) : "refused" }));
}

/** One line: `id=reason; id=reason` (empty when there is nothing to say). Safe for $GITHUB_OUTPUT (no newlines). */
export function formatRefusals(list: readonly RuleRefusal[]): string {
  return cleanRefusals(list).map((r) => `${r.id}=${r.reason}`).join("; ");
}

/** The issue comment body when the approved rules produced no candidate. */
export const NO_CANDIDATE_TEXT = "PeaceAI: no candidates generated for this task. The attempt was recorded. Rephrase the issue, then remove `peaceai:failed` to retry.";
export function noCandidateComment(line: string): string {
  const safe = /^[A-Za-z0-9_$.,:;= -]{0,600}$/.test(line) && !SECRET_NAME.test(line) ? line : "";
  if (!safe) return NO_CANDIDATE_TEXT;
  const body = `PeaceAI: no candidates generated for this task. Approved rules that matched the task refused it: \`${safe}\`. The attempt was recorded. Rephrase the issue, then remove \`peaceai:failed\` to retry.`;
  // The full body goes through the leak scanner; anything flagged posts the fixed text without the reason.
  return scanText(body).length ? NO_CANDIDATE_TEXT : body;
}
