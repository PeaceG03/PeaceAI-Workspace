// M59: why the approved learned rules produced no candidate. Each entry is a rule id and a reason code from
// lib/learned-guard.ts (optionally `code: name,name` for unsafe_condition). Everything is re-validated against a
// strict character set here before it reaches the run log, a job output or an issue comment: rule ids and
// identifiers only, never secrets, paths or file contents. Anything else becomes `refused`.
export type RuleRefusal = { id: string; reason: string };

const ID = /^[a-z0-9][a-z0-9.-]{0,79}$/;
const REASON = /^[a-z_]{1,40}(?:: [A-Za-z_$][\w$]{0,63}(?:,[A-Za-z_$][\w$]{0,63}){0,4})?$/;
const MAX_ENTRIES = 5;

export function cleanRefusals(list: readonly RuleRefusal[]): RuleRefusal[] {
  return list
    .filter((r) => ID.test(r.id))
    .slice(0, MAX_ENTRIES)
    .map((r) => ({ id: r.id, reason: REASON.test(r.reason) ? r.reason : "refused" }));
}

/** One line: `id=reason; id=reason` (empty when there is nothing to say). Safe for $GITHUB_OUTPUT (no newlines). */
export function formatRefusals(list: readonly RuleRefusal[]): string {
  return cleanRefusals(list).map((r) => `${r.id}=${r.reason}`).join("; ");
}

/** The issue comment body when the approved rules produced no candidate. */
export function noCandidateComment(line: string): string {
  const safe = /^[A-Za-z0-9_$.,:;= -]{0,600}$/.test(line) ? line : "";
  const why = safe ? ` Approved rules that matched the task refused it: \`${safe}\`.` : "";
  return `PeaceAI: no candidates generated for this task.${why} The attempt was recorded. Rephrase the issue, then remove \`peaceai:failed\` to retry.`;
}
