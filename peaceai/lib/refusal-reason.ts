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
  // Real reasons first (stable), task_unparsed last, so truncation to MAX_ENTRIES never drops a real reason.
  const valid = list.filter((r) => ID.test(r.id));
  return [...valid.filter((r) => r.reason !== "task_unparsed"), ...valid.filter((r) => r.reason === "task_unparsed")]
    .slice(0, MAX_ENTRIES)
    .map((r) => ({ id: r.id, reason: REASON.test(r.reason) ? allowNames(r.reason) : "refused" }));
}

/** One line: `id=reason; id=reason` (empty when there is nothing to say). Safe for $GITHUB_OUTPUT (no newlines). */
export function formatRefusals(list: readonly RuleRefusal[]): string {
  return cleanRefusals(list).map((r) => `${r.id}=${r.reason}`).join("; ");
}

/**
 * M99 round 3 (Peace: rule programs out by asking, not only refusing). A DERIVE refusal's questions travel as ONE
 * line, `fn(arg,arg)=answer|answer; ...`: the function name passes allowedName, every argument and answer is a safe
 * integer or true / false (a question with a string in it is dropped: issue text is never echoed), at most 3
 * questions, 2 to 4 answers each. Re-validated on the comment side; the comment words them in plain language.
 */
const Q_VALUE = "(?:-?(?:0|[1-9]\\d{0,14})|true|false)";
const Q_ENTRY = new RegExp(`^([a-z][a-zA-Z]{0,23})\\((${Q_VALUE}(?:,${Q_VALUE}){0,4})\\)=(${Q_VALUE}(?:\\|${Q_VALUE}){1,3})$`);
const MAX_QUESTIONS = 3;
type QValue = number | string | boolean;
const qValue = (v: QValue): string | null => (typeof v === "boolean" ? String(v) : typeof v === "number" && Number.isSafeInteger(v) && Math.abs(v) < 1e15 ? String(v) : null);
export function formatDeriveQuestions(fn: string, questions: readonly { at: readonly QValue[]; answers: readonly QValue[] }[]): string {
  if (!allowedName(fn)) return "";
  const out: string[] = [];
  for (const q of questions) {
    const at = q.at.map(qValue), ans = q.answers.map(qValue);
    if (at.some((v) => v === null) || ans.some((v) => v === null) || ans.length < 2 || ans.length > 4 || at.length === 0 || at.length > 5) continue;
    const e = `${fn}(${at.join(",")})=${ans.join("|")}`;
    if (Q_ENTRY.test(e) && !out.includes(e)) out.push(e);
    if (out.length >= MAX_QUESTIONS) break;
  }
  return out.join("; ");
}
/** True when `line` is exactly what formatDeriveQuestions emits. */
export function validQuestionLine(line: string): boolean {
  if (!line || line.length > 400) return false;
  const es = line.split("; ");
  return es.length <= MAX_QUESTIONS && es.every((e) => Q_ENTRY.test(e) && allowedName(Q_ENTRY.exec(e)![1]!));
}
/** The questions in plain words (no code): "What should f(20) give? One program that fits every example gives true, another gives false." */
export function questionWords(line: string): string {
  if (!validQuestionLine(line)) return "";
  const qs = line.split("; ").map((e) => {
    const m = Q_ENTRY.exec(e)!;
    const call = `${m[1]}(${m[2]!.split(",").join(", ")})`, ans = m[3]!.split("|");
    const says = ans.length === 2 ? `one program that fits every example gives ${ans[0]}, another gives ${ans[1]}` : `programs that fit every example give ${ans.slice(0, -1).join(", ")} or ${ans[ans.length - 1]}`;
    return `What should ${call} give? ${says[0]!.toUpperCase()}${says.slice(1)}.`;
  });
  return `The examples do not yet tell these programs apart; adding the right result for each input below as a new example tells PeaceAI which one you mean: ${qs.join(" ")}`;
}

/** The issue comment body when the approved rules produced no candidate. */
export const NO_CANDIDATE_TEXT = "PeaceAI: no candidates generated for this task. The attempt was recorded. Rephrase the issue, then remove `peaceai:failed` to retry.";
export function noCandidateComment(line: string, questions = ""): string {
  const safe = validLine(line) ? line : "";
  if (!safe) return NO_CANDIDATE_TEXT;
  // M99 round 3: a DERIVE refusal's questions, in plain words, when they pass validation and the leak scan.
  const asked = questionWords(questions);
  if (asked) {
    const withQ = `PeaceAI: no candidates generated for this task. Approved rules that matched the task refused it: \`${safe}\`. ${asked} The attempt was recorded. Add the examples (or rephrase the issue), then remove \`peaceai:failed\` to retry.`;
    if (!scanText(withQ).length) return withQ;
  }
  const body = `PeaceAI: no candidates generated for this task. Approved rules that matched the task refused it: \`${safe}\`. The attempt was recorded. Rephrase the issue, then remove \`peaceai:failed\` to retry.`;
  // The full body goes through the leak scanner; anything flagged posts the fixed text without the reason.
  return scanText(body).length ? NO_CANDIDATE_TEXT : body;
}
