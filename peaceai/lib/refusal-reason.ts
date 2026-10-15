// M59: why the approved learned rules produced no candidate. Each entry is a rule id and a reason code from
// lib/learned-guard.ts (optionally `code: name,name` for unsafe_condition). Everything is re-validated against a
// strict character set here before it reaches the run log, a job output or an issue comment: rule ids and
// identifiers only, never secrets, paths or file contents. Anything else becomes `refused`.
import { scanText } from "./leak.ts";

export type RuleRefusal = { id: string; reason: string };

const ID = /^[a-z0-9][a-z0-9.-]{0,79}$/;
const REASON = /^[a-z_]{1,40}(?:: [A-Za-z_$][\w$]{0,63}(?:,[A-Za-z_$][\w$]{0,63}){0,4})?$/;
const MAX_ENTRIES = 5;

/**
 * Allowlist for names echoed in a reason: at most 24 characters, `^[a-z][a-zA-Z]*$`, and no run of 4 or more
 * capitals (plus: no alternating case like `aBcD`, at most 4 capitals). If ANY name in a reason fails, the reason is cut to its code alone (a token split by the parser
 * into several names, e.g. `glpat-<body>`, so never prints a part of it). scanText is a second check.
 */
export function allowedName(n: string): boolean {
  // Also refused: alternating case such as `aBcDeF` (a capital, one lowercase letter, a capital), which
  // camelCase names do not use but random token bodies do, and more than 4 capitals in all.
  return n.length <= 24 && /^[a-z][a-zA-Z]*$/.test(n) && !/[A-Z]{4}/.test(n) && !/[A-Z][a-z][A-Z]/.test(n) && (n.match(/[A-Z]/g) ?? []).length <= 4;
}
function allowNames(reason: string): string {
  const i = reason.indexOf(": ");
  if (i < 0) return reason;
  const names = reason.slice(i + 2).split(",");
  return names.length > 0 && names.every(allowedName) ? reason : reason.slice(0, i);
}
const CODE = /^[a-z_]{1,40}$/;
/** True when `line` is exactly what formatRefusals emits from allowlisted parts. */
function validLine(line: string): boolean {
  if (!line || line.length > 600) return false;
  return line.split("; ").every((e) => {
    const eq = e.indexOf("=");
    if (eq < 0 || !ID.test(e.slice(0, eq))) return false;
    const reason = e.slice(eq + 1);
    const i = reason.indexOf(": ");
    if (i < 0) return CODE.test(reason);
    return CODE.test(reason.slice(0, i)) && reason.slice(i + 2).split(",").every(allowedName);
  });
}

export function cleanRefusals(list: readonly RuleRefusal[]): RuleRefusal[] {
  return list
    .filter((r) => ID.test(r.id))
    .slice(0, MAX_ENTRIES)
    .map((r) => ({ id: r.id, reason: REASON.test(r.reason) ? allowNames(r.reason) : "refused" }));
}

/** One line: `id=reason; id=reason` (empty when there is nothing to say). Safe for $GITHUB_OUTPUT (no newlines). */
export function formatRefusals(list: readonly RuleRefusal[]): string {
  return cleanRefusals(list).map((r) => `${r.id}=${r.reason}`).join("; ");
}

/** The issue comment body when the approved rules produced no candidate. */
export const NO_CANDIDATE_TEXT = "PeaceAI: no candidates generated for this task. The attempt was recorded. Rephrase the issue, then remove `peaceai:failed` to retry.";
export function noCandidateComment(line: string): string {
  const safe = validLine(line) ? line : "";
  if (!safe) return NO_CANDIDATE_TEXT;
  const body = `PeaceAI: no candidates generated for this task. Approved rules that matched the task refused it: \`${safe}\`. The attempt was recorded. Rephrase the issue, then remove \`peaceai:failed\` to retry.`;
  // The full body goes through the leak scanner; anything flagged posts the fixed text without the reason.
  return scanText(body).length ? NO_CANDIDATE_TEXT : body;
}
