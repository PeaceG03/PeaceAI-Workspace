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
/** Task source from the issue labels at pick time. */
export const taskSource = (labels: readonly string[]): "peace" | "builder" => (labels.includes(BUILDER_LABEL) ? "builder" : "peace");
