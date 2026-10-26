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
 * Task source (M119 credit truth). Provenance decides, never the filer account: Peace and Builder both file
 * as PeaceG03, so the account says nothing about whose task it is, and body edits can't be attributed either.
 *
 * `peace` is an ALLOW-match: only when ALL of these hold, otherwise `builder` (fail closed):
 *  1. no `source:builder` label (compared trimmed and case-insensitive);
 *  2. after normalization (zero-width characters removed, NFKC, unicode hyphens -> "-") and after stripping
 *     HTML comments, fenced and indented code, blockquote lines and the Examples block, the body has exactly
 *     ONE credit line (a top-level line starting `Context ...:`, or the older `(Builder pre-file, ...):`
 *     form), and that line itself, outside any quoted or backticked span, carries `(source: peace)`;
 *  3. every `(source ...:` clause anywhere in the normalized body, stripped regions included, is exactly
 *     `(source: peace)` (so `(source : builder)`, `( source: builder)` or a zero-width-split `source` all
 *     give builder);
 *  4. no team-picked wording anywhere in the normalized body (Team-picked, Teampicked, Builder-picked,
 *     chosen by the team, Peace asked us / the team to pick, not credited as source ...).
 * Job C (recordedTaskSource) adds: the pick-time value was exactly `peace`, the body did not change between
 * pick and record (sha256), and the body was not edited after the first `peace-task` label event.
 *
 * Builder-log exception (ruling, not code): builder-log rows seq 98-122 (#233, #240, #248, #255, #259, #262,
 * #288-#290, #293-#295, #297-#299, #301, #319, #329) stay credited as Peace's real tasks although those issue
 * bodies carry no credit line. That rests on Peace's own Oct 16 2026 confirmation that Builder-drafted tasks
 * filed as Peace's tasks count toward PeaceAI coverage, with the "Builder pre-file" note kept in the issue body
 * (see README "Task source"). It does not apply to new tasks: a new task without a Context credit line is
 * recorded as `builder` here.
 */
const ZERO_WIDTH = /[\u00AD\u034F\u061C\u115F\u1160\u17B4\u17B5\u180B-\u180F\u200B-\u200F\u202A-\u202E\u2060-\u206F\u3164\uFE00-\uFE0F\uFEFF\uFFA0]/g;
const UNICODE_HYPHENS = /[\u2010-\u2015\u2043\u2212\u2E17\u2E1A\u2E3A\u2E3B\u2E40\u301C\u30A0\uFE31\uFE32\uFE58\uFE63\uFF0D]/g;
const UNICODE_SPACES = /[\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000]/g;

/** Text as compared for provenance: zero-width characters removed, NFKC, unicode hyphens and spaces folded. */
export function normalizeProvenance(text: string): string {
  return text
    .replace(ZERO_WIDTH, "")
    .normalize("NFKC")
    .replace(ZERO_WIDTH, "")
    .replace(UNICODE_HYPHENS, "-")
    .replace(UNICODE_SPACES, " ")
    .replace(/\r\n?/g, "\n");
}

/**
 * Removes the regions that can never hold the credit line: HTML comments (an unclosed one runs to the end),
 * fenced code blocks (``` or ~~~; an unclosed fence runs to the end), indented code lines, blockquote lines,
 * and the Examples block (an `Example...` line plus the list items and blank lines after it).
 */
export function stripNonCredit(normalized: string): string {
  const noComments = normalized.replace(/<!--[\s\S]*?(?:-->|$)/g, "");
  const out: string[] = [];
  let fence: { char: string; len: number } | null = null;
  let inExamples = false;
  for (const line of noComments.split("\n")) {
    const f = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (fence) {
      if (f && f[1]![0] === fence.char && f[1]!.length >= fence.len && /^ {0,3}(`{3,}|~{3,})\s*$/.test(line)) fence = null;
      continue;
    }
    if (f) {
      fence = { char: f[1]![0]!, len: f[1]!.length };
      continue;
    }
    if (/^\s*Examples?\b/i.test(line)) {
      inExamples = true;
      continue;
    }
    if (inExamples) {
      if (line.trim() === "" || /^\s*(?:[-*+]|\d+[.)])(?:\s|$)/.test(line)) continue;
      inExamples = false;
    }
    if (/^\s*>/.test(line) || /^(?: {4}|\t)/.test(line)) continue;
    out.push(line);
  }
  return out.join("\n");
}

/** The credit marker, as it must appear on the Context credit line. */
export const SOURCE_PEACE_MARK = /\(\s*source\s*:\s*peace\s*\)/i;
/** The start of any `(source ...:` clause; every one in the body must be exactly the peace marker. */
export const SOURCE_CLAUSE_START = /\(\s*source\s*:/gi;
const SOURCE_PEACE_EXACT = /^\(\s*source\s*:\s*peace\s*\)$/i;
/**
 * The credit line: a top-level line starting `Context` (optionally with a parenthetical) then `:`, or the
 * older pre-file form `(Builder pre-file, ...):` used by issues filed before the Context heading (#353-#488).
 */
const CONTEXT_LINE = /^(?:Context\b[^\n:]*|\(Builder pre-file\b[^\n)]*\)):/;
/**
 * Wording that means the team, not Peace in his own words, picked the task. Matched on the normalized body
 * (unicode hyphens folded to "-", zero-width characters removed).
 */
export const TEAM_PICKED_MARK = new RegExp(
  [
    String.raw`\b(?:team|builder|auditor|architect|agents?|grok\s*bot)\s*-?\s*(?:picked|chosen|selected)\b`,
    String.raw`\b(?:picked|chosen|chose|selected)\s+by\s+(?:the\s+)?(?:team|builder|auditor|architect|agents?|us|grok\s*bot)\b`,
    String.raw`\basked\s+(?:us|the\s+team|the\s+agents?|builder|auditor|architect|you\s+guys|grok\s*bot)\s+to\s+(?:pick|choose|select|think\s+of|come\s+up)\b`,
    String.raw`\b(?:we|the\s+team)\s+(?:picked|chose|selected)\b`,
    String.raw`\byou\s+guys\s+think\s+of\s+one\b`,
    String.raw`\bnot\s+credited\s+as\b`,
  ].join("|"),
  "i",
);

const hasBuilderLabel = (labels: readonly unknown[]): boolean =>
  labels.some((l) => typeof l === "string" && normalizeProvenance(l).trim().toLowerCase() === BUILDER_LABEL);

/** True when every `(source ...:` clause in the (normalized) text is exactly `(source: peace)`. */
function clausesAllPeace(normalized: string): boolean {
  for (const m of normalized.matchAll(SOURCE_CLAUSE_START)) {
    const close = normalized.indexOf(")", m.index!);
    if (close < 0 || !SOURCE_PEACE_EXACT.test(normalized.slice(m.index!, close + 1))) return false;
  }
  return true;
}

/** The Context credit line(s) of the stripped body, with quoted and backticked spans removed. */
export function contextCreditLines(normalized: string): string[] {
  return stripNonCredit(normalized)
    .split("\n")
    .filter((l) => CONTEXT_LINE.test(l))
    .map((l) => l.replace(/"[^"\n]*"?|\u201C[^\u201D\n]*\u201D?|`[^`\n]*`?/g, " "));
}

/** Task source from provenance (see the block comment above). Anything unclear is `builder`. */
export function taskSource(labels: readonly unknown[], body: unknown): "peace" | "builder" {
  if (!Array.isArray(labels) || hasBuilderLabel(labels)) return "builder";
  const text = normalizeProvenance(typeof body === "string" ? body : "");
  if (TEAM_PICKED_MARK.test(text) || !clausesAllPeace(text)) return "builder";
  const credit = contextCreditLines(text);
  return credit.length === 1 && SOURCE_PEACE_MARK.test(credit[0]!) ? "peace" : "builder";
}

/** sha256 (hex) of the issue body exactly as fetched (UTF-8); recorded in task.json as `bodySha256`. */
export function bodySha256(body: unknown): string {
  return createHash("sha256").update(typeof body === "string" ? body : "", "utf8").digest("hex");
}

/**
 * Body edit history as fetched from the GitHub API (issue-fetch.ts, Job C): the issue's `lastEditedAt`, the
 * `editedAt` of every userContentEdits entry (`editsComplete` false when there were more than one page), and
 * the createdAt of every `peace-task` LabeledEvent.
 */
export interface BodyProvenance {
  lastEditedAt: string | null;
  editTimes: string[];
  editsComplete: boolean;
  taskLabeledAt: string[];
}

const isoTime = (v: unknown): number | null => {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(v)) return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : null;
};

/**
 * True only when the edit history is complete and well-formed, the issue has a `peace-task` label event, and
 * no body edit is later than the FIRST `peace-task` label event. Missing or malformed history is false.
 */
export function bodyUnchangedSinceLabel(p: unknown): boolean {
  if (!p || typeof p !== "object") return false;
  const x = p as Partial<BodyProvenance>;
  if (x.editsComplete !== true || !Array.isArray(x.editTimes) || !Array.isArray(x.taskLabeledAt)) return false;
  const labeled = x.taskLabeledAt.map(isoTime);
  if (labeled.length === 0 || labeled.some((t) => t === null)) return false;
  const firstLabel = Math.min(...(labeled as number[]));
  const edits = [...x.editTimes, ...(x.lastEditedAt === null || x.lastEditedAt === undefined ? [] : [x.lastEditedAt])].map(isoTime);
  if (edits.some((t) => t === null)) return false;
  return (edits as number[]).every((t) => t <= firstLabel);
}

/**
 * Job C: the source written to task.json. `peace` only when the pick-time source (select output) is exactly
 * `peace`, the full fetched body still gives `peace` (taskSource), its sha256 equals the pick-time sha256, and
 * the body was not edited after the first `peace-task` label event. Anything else is `builder`.
 */
export function recordedTaskSource(
  pickTime: unknown,
  body: unknown,
  check: { pickBodySha256?: unknown; provenance?: unknown } = {},
): "peace" | "builder" {
  if (pickTime !== "peace" || taskSource([], body) !== "peace") return "builder";
  if (typeof check.pickBodySha256 !== "string" || check.pickBodySha256 !== bodySha256(body)) return "builder";
  return bodyUnchangedSinceLabel(check.provenance) ? "peace" : "builder";
}
