import { createHash } from "node:crypto";

/** True when the task text asks for tests (and does not say "without tests"). */
export function taskRequiresTests(text: string): boolean {
  if (/\b(?:without|no|skip(?:ping)?)\s+(?:any\s+)?(?:new\s+)?tests?\b/i.test(text)) return false;
  return (
    /\b(?:with|add|adding|include|including|write|writing|plus|and)\s+(?:a\s+|an\s+|some\s+)?(?:focused\s+|unit\s+|new\s+|regression\s+)?tests?\b/i.test(text) ||
    /\b(?:focused|unit|regression)\s+tests?\b/i.test(text) ||
    /\btests?\s+(?:for|covering|that)\b/i.test(text)
  );
}

export const HELD_OUT_SALT = "peaceai-heldout:v1";
export const HELD_OUT_RATE = 0.2;

/** Deterministic ~20% held-out split by issue number. Held-out tasks are never used for training. */
export function isHeldOut(issue: number): boolean {
  const digest = createHash("sha256").update(`${HELD_OUT_SALT}:${issue}`).digest();
  return digest.readUInt32BE(0) / 0x1_0000_0000 < HELD_OUT_RATE;
}

/** Test tasks are marked by a "[test]" title prefix and excluded from training and agreement. */
export function isTestTask(title: string): boolean {
  return /^\s*\[test\]/i.test(title);
}

export const BUILDER_LABEL = "source:builder";

/**
 * Credit line marker for a task that is Peace's own (same pattern as builder-log/coverage.ts SOURCE_PEACE,
 * which decides real-task credit from a builder-log row's `asked`). Every parenthesised `(source: ...)`
 * clause in the body must be this one.
 */
export const SOURCE_PEACE_MARK = /\(source:\s*peace\)/i;
/** Any parenthesised `(source: ...)` clause, e.g. builder-log's "(source: team-picked at Peace's request; ...)". */
const SOURCE_CLAUSE = /\(source:[^)]*\)/gi;
/**
 * Provenance wording that means the team (not Peace in his own words) picked the task: the issue-body credit
 * line "Team-picked task (Builder-drafted; not credited as source: peace ...)", builder-log's
 * "(source: team-picked at Peace's request; ...)", and the slice-1 wording "Peace asked the team to pick".
 */
export const TEAM_PICKED_MARK = /team[- ]picked|picked by the team|asked the team to pick|not credited as source:\s*peace/i;

/**
 * Task source from provenance, not from the account that filed the issue (Peace and Builder both file as
 * PeaceG03). `peace` only when the issue is not labelled `source:builder`, its body carries the
 * `(source: peace)` credit line, every `(source: ...)` clause in it says peace, and nothing in it says the
 * task was team-picked. Anything else, including no credit line at all or no body, fails closed to
 * `builder` (not Peace's). M119 credit-truth fix: this used to read the label only, so every PeaceG03 task
 * without `source:builder` was recorded as `peace`.
 */
export function taskSource(labels: readonly string[], body: unknown): "peace" | "builder" {
  if (labels.includes(BUILDER_LABEL)) return "builder";
  const text = typeof body === "string" ? body : "";
  if (TEAM_PICKED_MARK.test(text)) return "builder";
  const clauses = text.match(SOURCE_CLAUSE) ?? [];
  if (clauses.length === 0 || !clauses.every((c) => SOURCE_PEACE_MARK.test(c))) return "builder";
  return "peace";
}

/**
 * Job C: the source written to task.json. `peace` only when the pick-time source (select output) is exactly
 * `peace` and the full fetched issue body still carries a peace-only credit line; anything else (missing or
 * unknown pick-time value, an edited body, no body) fails closed to `builder`.
 */
export function recordedTaskSource(pickTime: unknown, body: unknown): "peace" | "builder" {
  return pickTime === "peace" && taskSource([], body) === "peace" ? "peace" : "builder";
}
