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
 *  1. no `source:builder` label (compared trimmed and case-insensitive), and no raw HTML outside fenced code
 *     (hasRawHtml: `<` then a letter, `/`, `!` or `?`);
 *  2. after HTML-entity decoding and normalization (zero-width characters removed, NFKC, unicode hyphens -> "-")
 *     and after stripping HTML comments, fenced and indented code, blockquote lines and the Examples block, the
 *     body has exactly ONE credit line (a top-level line starting `Context ...:`, or the older
 *     `(Builder pre-file, ...):` form), and that line's VISIBLE text (visibleCreditText: no link or image
 *     destinations, titles or alt text, no HTML tags or attributes, no struck-through, code or quoted spans)
 *     carries `(source: peace)` closing the credit clause, followed by nothing, `.`, or `. ` and one of the
 *     pinned trailing texts of the 80 genuine tasks (creditTrailingAllowed; new tasks end the line with the mark);
 *  3. every `(source ...:` clause anywhere in the normalized body (raw and entity-decoded), stripped regions included, is exactly
 *     `(source: peace)` (so `(source : builder)`, `( source: builder)` or a zero-width-split `source` all
 *     give builder);
 *  4. no team-picked wording anywhere in the normalized body (Team-picked, Teampicked, Builder-picked,
 *     chosen by the team, Peace asked us / the team to pick, not credited as source ...).
 * Job C (recordedTaskSource) adds: the pick-time value was exactly `peace`, the labels re-read at record time
 * still allow it, no `source:builder` label was ever added, and the credit line's visible text at the first
 * `peace-task` label event (reconstructed from the userContentEdits revision strictly before it) is identical to
 * its visible text at record time, and the whole body is add-only since then (every labelled line still present,
 * in order), with complete history.
 *
 * Builder-log exception (ruling, not code): builder-log rows seq 98-122 (#233, #240, #248, #255, #259, #262,
 * #288-#290, #293-#295, #297-#299, #301, #319, #329) stay credited as Peace's real tasks although those issue
 * bodies carry no credit line. Source: Peace, Auditor chat, Oct 16 2026 8:06 PM MT, replying to the #329 question ('Go ahead that's fine'); relayed by Auditor; no public link.
 * (See README "Task source".) It does not apply to new tasks: a new task without a Context credit line is
 * recorded as `builder` here.
 */
const ZERO_WIDTH = /[\u00AD\u034F\u061C\u115F\u1160\u17B4\u17B5\u180B-\u180F\u200B-\u200F\u202A-\u202E\u2060-\u206F\u3164\uFE00-\uFE0F\uFEFF\uFFA0]/g;
const UNICODE_HYPHENS = /[\u2010-\u2015\u2043\u2212\u2E17\u2E1A\u2E3A\u2E3B\u2E40\u301C\u30A0\uFE31\uFE32\uFE58\uFE63\uFF0D]/g;
const UNICODE_SPACES = /[\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000]/g;

/**
 * HTML entities GitHub renders in an issue body. Any other named entity (for example `&sopf;`, which renders as
 * a letter) makes the task builder (`hasUnknownEntity`), so nothing can be spelled through an entity this table
 * does not decode.
 */
const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: "\u00A0", lpar: "(", rpar: ")", colon: ":", semi: ";",
  comma: ",", period: ".", excl: "!", quest: "?", num: "#", percnt: "%", dollar: "$", commat: "@", ast: "*",
  midast: "*", plus: "+", equals: "=", sol: "/", bsol: "\\", verbar: "|", vert: "|", VerticalLine: "|",
  lowbar: "_", UnderBar: "_", grave: "`", DiacriticalGrave: "`", Hat: "^", lsqb: "[", lbrack: "[", rsqb: "]",
  rbrack: "]", lcub: "{", lbrace: "{", rcub: "}", rbrace: "}", hyphen: "\u2010", dash: "\u2010", ndash: "\u2013",
  mdash: "\u2014", minus: "\u2212", shy: "\u00AD", ensp: "\u2002", emsp: "\u2003", thinsp: "\u2009",
  ZeroWidthSpace: "\u200B", zwnj: "\u200C", zwj: "\u200D", NoBreak: "\u2060", Tab: "\t", NewLine: "\n",
  lsquo: "\u2018", rsquo: "\u2019", ldquo: "\u201C", rdquo: "\u201D", hellip: "\u2026", middot: "\u00B7",
  times: "\u00D7", divide: "\u00F7", deg: "\u00B0", copy: "\u00A9", reg: "\u00AE", trade: "\u2122",
  rarr: "\u2192", larr: "\u2190", harr: "\u2194", uarr: "\u2191", darr: "\u2193", le: "\u2264", ge: "\u2265",
  ne: "\u2260", asymp: "\u2248", bull: "\u2022", sect: "\u00A7", para: "\u00B6", euro: "\u20AC", pound: "\u00A3",
};
const NAMED_ENTITY = /&([A-Za-z][A-Za-z0-9]{0,31});/g;
const codePoint = (n: number): string => (n > 0 && n <= 0x10ffff && (n < 0xd800 || n > 0xdfff) ? String.fromCodePoint(n) : "\uFFFD");

/**
 * Decodes HTML entities once, as GitHub renders them: `&#40;`, `&#x28;` and the named entities above.
 * `lenient` also decodes numeric references without the closing `;` (used only to find contrary clauses, so
 * more decoding can only give builder); the credit line uses the strict, rendered form.
 */
export function decodeEntities(text: string, lenient = false): string {
  const numeric = lenient ? /&#(?:[xX]([0-9a-fA-F]{1,6})|(\d{1,7}));?/g : /&#(?:[xX]([0-9a-fA-F]{1,6})|(\d{1,7}));/g;
  return text.replace(new RegExp(`${numeric.source}|${NAMED_ENTITY.source}`, "g"), (m, hex?: string, dec?: string, name?: string) =>
    hex !== undefined ? codePoint(parseInt(hex, 16)) : dec !== undefined ? codePoint(parseInt(dec, 10)) : name !== undefined && Object.hasOwn(NAMED_ENTITIES, name) ? NAMED_ENTITIES[name]! : m,
  );
}

/** True when the text holds a named entity `decodeEntities` does not know (fail closed: builder). */
export function hasUnknownEntity(text: string): boolean {
  for (const m of text.matchAll(NAMED_ENTITY)) if (!Object.hasOwn(NAMED_ENTITIES, m[1]!)) return true;
  return false;
}

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

/**
 * Raw HTML fails closed (Auditor, round 4): outside fenced code blocks (``` or ~~~, an unclosed fence running to
 * the end, as GitHub renders it), any `<` followed by a letter, `/`, `!` or `?` makes the task builder. That
 * covers every tag (also one split over several lines, such as a multi-line `<a href=...>` or `<img alt=...>`),
 * comments, `<?...?>`, `<![CDATA[...]]>` and `<!DOCTYPE ...>`, so no attribute, comment or processing
 * instruction can carry or hide provenance. Entity-escaped text (`&lt;b>`) renders as text and is not HTML.
 */
const RAW_HTML_START = /<[A-Za-z/!?]/;
export function hasRawHtml(text: string): boolean {
  let fence: { char: string; len: number } | null = null;
  for (const line of text.replace(/\r\n?/g, "\n").split("\n")) {
    const f = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (fence) {
      if (f && f[1]![0] === fence.char && f[1]!.length >= fence.len && /^ {0,3}(`{3,}|~{3,})\s*$/.test(line)) fence = null;
      continue;
    }
    if (f) {
      fence = { char: f[1]![0]!, len: f[1]!.length };
      continue;
    }
    if (RAW_HTML_START.test(line)) return true;
  }
  return false;
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

/** The Context credit line(s) of the stripped body (raw markup; see `visibleCreditText`). */
export function contextCreditLines(normalized: string): string[] {
  return stripNonCredit(normalized)
    .split("\n")
    .filter((l) => CONTEXT_LINE.test(l));
}

/** Cuts the line at `i` (an unclosed construct hides everything after it, so nothing after it counts). */
const cutAt = (s: string, i: number): string => (i < 0 ? s : s.slice(0, i));

/** Markdown links and images: an image is dropped whole (alt, destination, title); a link keeps only its text. */
function dropLinks(s: string): string {
  let out = "";
  let i = 0;
  while (i < s.length) {
    const image = s.startsWith("![", i);
    if (!image && s[i] !== "[") {
      out += s[i++];
      continue;
    }
    const open = image ? i + 1 : i;
    let depth = 0;
    let close = -1;
    for (let j = open; j < s.length; j++) {
      if (s[j] === "\\") j++;
      else if (s[j] === "[") depth++;
      else if (s[j] === "]" && --depth === 0) {
        close = j;
        break;
      }
    }
    if (close < 0) return out + s.slice(i, i + 1) + dropLinks(s.slice(i + 1)); // literal bracket
    const text = s.slice(open + 1, close);
    const next = s[close + 1];
    let end = -1;
    if (next === "(" || next === "[") {
      const [o, c] = next === "(" ? ["(", ")"] : ["[", "]"];
      let d = 0;
      for (let j = close + 1; j < s.length; j++) {
        if (s[j] === "\\") j++;
        else if (s[j] === o) d++;
        else if (s[j] === c && --d === 0) {
          end = j;
          break;
        }
      }
      if (end < 0) return out; // unclosed destination or title: hides the rest of the line
    } else end = close; // [text] with no destination: literal text
    out += image ? " " : ` ${dropLinks(text)} `;
    i = end + 1;
  }
  return out;
}

/**
 * The text a reader actually sees on the credit line: backticked spans, `~~` / `~` strikethrough, `<del>`,
 * `<s>` and `<strike>` with their content, HTML tags with all their attributes (so `<img alt=...>` is gone),
 * autolinks and bare URLs, image alt text and link destinations and titles are removed, and quoted spans are blanked. An
 * unclosed construct removes the rest of the line. Any markup left over after that (a stray `<tag`, `](`
 * or `~`) also removes the rest of the line.
 */
export function visibleCreditText(line: string): string {
  let s = line.replace(/`+[^`]*`+/g, " ");
  s = cutAt(s, s.indexOf("`"));
  s = s.replace(/<(del|s|strike)\b(?:\s[^>]*)?>[\s\S]*?<\/\1\s*>/gi, " ");
  s = cutAt(s, s.search(/<\s*(?:del|s|strike)\b/i));
  s = s.replace(/(~+)[^~]+\1/g, " ");
  s = cutAt(s, s.indexOf("~"));
  s = s.replace(/<[A-Za-z][A-Za-z0-9+.-]{1,31}:[^\s<>]*>/g, " ");
  s = s.replace(/<\/?[A-Za-z][A-Za-z0-9-]*(?:\s+[^\s"'=<>`/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*\s*\/?>/g, " ");
  s = cutAt(s, s.search(/<\/?[A-Za-z!?]/));
  s = dropLinks(s);
  s = cutAt(s, s.indexOf("]("));
  s = s.replace(/\b(?:https?:\/\/|www\.)[^\s<]*/gi, " "); // bare URLs (autolinked) never carry the mark
  return s.replace(/"[^"\n]*"?|\u201C[^\u201D\n]*\u201D?/g, " ");
}

/**
 * The credit marker as it must stand in the visible credit text: `(source: peace)` closing the credit clause,
 * followed only by the end of the line or a sentence end (`.` then a space or the end); anything glued to the
 * marker (`~~`, `)`, `'`, `*`, `]`, `>`) is not. What may follow the sentence end is allowlisted
 * (creditTrailingAllowed).
 */
const VISIBLE_PEACE_MARK = /\(\s*source\s*:\s*peace\s*\)(?=\s*$|\.(?:\s|$))/i;

/**
 * Trailing text is allowlisted (Auditor, round 4). On the credit line (entity-decoded and normalized, raw
 * markup kept), `(source: peace)` must appear exactly once and be followed by nothing, by `.` alone, or by `. `
 * and one of CREDIT_TRAILING_ALLOWLIST exactly (trailing whitespace ignored). Anything else after the mark
 * ("Actually Builder drafted it.", "Not Peace's task.", "source=builder.") is builder. New tasks put the mark at
 * the end of the line, so the list never grows.
 */
export function creditTrailingAllowed(creditLine: string): boolean {
  const marks = [...creditLine.matchAll(new RegExp(SOURCE_PEACE_MARK.source, "gi"))];
  if (marks.length !== 1) return false;
  const after = creditLine.slice(marks[0]!.index! + marks[0]![0].length).trimEnd();
  if (after === "" || after === ".") return true;
  return after.startsWith(". ") && CREDIT_TRAILING.has(after.slice(2));
}

/** The visible text of the body's single credit line, or null when there is not exactly one. */
export function creditLineVisible(body: unknown): string | null {
  const text = normalizeProvenance(decodeEntities(typeof body === "string" ? body : ""));
  const lines = contextCreditLines(text);
  return lines.length === 1 ? visibleCreditText(lines[0]!).replace(/\s+/g, " ").trim() : null;
}

/** Task source from provenance (see the block comment above). Anything unclear is `builder`. */
export function taskSource(labels: readonly unknown[], body: unknown): "peace" | "builder" {
  if (!Array.isArray(labels) || hasBuilderLabel(labels)) return "builder";
  const raw = typeof body === "string" ? body : "";
  if (hasUnknownEntity(raw) || hasRawHtml(raw) || hasRawHtml(normalizeProvenance(raw))) return "builder";
  for (const text of [normalizeProvenance(raw), normalizeProvenance(decodeEntities(raw, true))])
    if (TEAM_PICKED_MARK.test(text) || !clausesAllPeace(text)) return "builder";
  const credit = creditLineVisible(raw);
  if (credit === null || !VISIBLE_PEACE_MARK.test(credit)) return "builder";
  const lines = contextCreditLines(normalizeProvenance(decodeEntities(raw)));
  return lines.length === 1 && creditTrailingAllowed(lines[0]!) ? "peace" : "builder";
}

/** sha256 (hex) of the issue body exactly as fetched (UTF-8); recorded in task.json as `bodySha256`. */
export function bodySha256(body: unknown): string {
  return createHash("sha256").update(typeof body === "string" ? body : "", "utf8").digest("hex");
}

/**
 * Body edit history as fetched from the GitHub API (issue-fetch.ts, Job C). `edits` is every userContentEdits
 * entry with its full body text (`diff`; the oldest entry is the body as created), `editsComplete` is false when
 * either connection had more than one page, `taskLabeledAt` holds the createdAt of every `peace-task`
 * LabeledEvent, and `builderLabeled` is true when a `source:builder` label was ever added.
 */
export interface BodyProvenance {
  lastEditedAt: string | null;
  edits: { editedAt: string; deletedAt: string | null; body: string | null }[];
  editsComplete: boolean;
  taskLabeledAt: string[];
  builderLabeled: boolean;
}

const isoTime = (v: unknown): number | null => {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(v)) return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : null;
};

/**
 * The issue body as it stood at the FIRST `peace-task` label event, reconstructed from userContentEdits: the
 * latest edit strictly before that event (an edit with the same timestamp as the label is ambiguous: null) (an issue never edited has no entries, and its current body is the one
 * labelled). null when the history is incomplete or malformed (a deleted revision, a missing body text, a bad
 * timestamp, no label event, or edits that all postdate the label).
 */
export function bodyAtFirstLabel(p: unknown, currentBody: unknown): string | null {
  if (!p || typeof p !== "object") return null;
  const x = p as Partial<BodyProvenance>;
  if (x.editsComplete !== true || !Array.isArray(x.edits) || !Array.isArray(x.taskLabeledAt)) return null;
  const labeled = x.taskLabeledAt.map(isoTime);
  if (labeled.length === 0 || labeled.some((t) => t === null)) return null;
  const firstLabel = Math.min(...(labeled as number[]));
  if (x.edits.length === 0) return x.lastEditedAt === null && typeof currentBody === "string" ? currentBody : null;
  let best: { t: number; body: string } | null = null;
  for (const e of x.edits) {
    const t = isoTime(e?.editedAt);
    if (t === null || e.deletedAt !== null || typeof e.body !== "string" || t === firstLabel) return null;
    if (t < firstLabel && (best === null || t > best.t)) best = { t, body: e.body };
  }
  return best === null ? null : best.body;
}

/**
 * True only when the credit line's visible text at the first `peace-task` label (bodyAtFirstLabel) is identical
 * to its visible text in the body being recorded; an edited credit line, or incomplete history, is false. The rest
 * of the body is held to add-only by bodyAddOnlySinceLabel.
 */
export function creditUnchangedSinceLabel(p: unknown, currentBody: unknown): boolean {
  const atLabel = bodyAtFirstLabel(p, currentBody);
  if (atLabel === null) return false;
  const before = creditLineVisible(atLabel);
  return before !== null && before === creditLineVisible(currentBody);
}

/**
 * Add-only since the first `peace-task` label (Auditor, round 4): every line of the labelled body
 * (bodyAtFirstLabel) still appears, unchanged and in the same order, in the body being recorded. Lines may be
 * added anywhere; a removed, reworded or reordered line is false, and so is incomplete history.
 */
export function bodyAddOnlySinceLabel(p: unknown, currentBody: unknown): boolean {
  const atLabel = bodyAtFirstLabel(p, currentBody);
  if (atLabel === null || typeof currentBody !== "string") return false;
  const now = currentBody.replace(/\r\n?/g, "\n").split("\n");
  let i = 0;
  for (const line of atLabel.replace(/\r\n?/g, "\n").split("\n")) {
    while (i < now.length && now[i] !== line) i++;
    if (i === now.length) return false;
    i++;
  }
  return true;
}

/**
 * Job C: the source written to task.json. `peace` only when the pick-time source (select output) is exactly
 * `peace`, the labels re-read at record time and the full fetched body still give `peace` (taskSource), no
 * `source:builder` label was ever added, the credit line is unchanged since the first `peace-task` label
 * (creditUnchangedSinceLabel) and the whole body is add-only since then (bodyAddOnlySinceLabel). Anything else
 * is `builder`. The body's sha256 is recorded separately for
 * traceability (`bodySha256`).
 */
export function recordedTaskSource(
  pickTime: unknown,
  body: unknown,
  check: { labels?: unknown; provenance?: unknown } = {},
): "peace" | "builder" {
  if (pickTime !== "peace" || !Array.isArray(check.labels) || taskSource(check.labels, body) !== "peace") return "builder";
  const p = check.provenance as Partial<BodyProvenance> | null | undefined;
  if (!p || typeof p !== "object" || p.builderLabeled !== false) return "builder";
  return creditUnchangedSinceLabel(p, body) && bodyAddOnlySinceLabel(p, body) ? "peace" : "builder";
}

/**
 * The exact text after `(source: peace). ` on the credit lines of the 80 genuine Peace tasks (#353-#359,
 * #370-#374, #390-#397, #399-#403, #415-#425, #427-#437, #443-#455, #471-#488, #501, #502), one entry per
 * issue, taken from the bodies as GitHub serves them (entity-decoded, normalized). Pinned: the m119 test checks
 * the count and sha256, and this file is in PROTECTED_SELF. Add nothing: new tasks end the line with the mark.
 */
export const CREDIT_TRAILING_ALLOWLIST: readonly string[] = Object.freeze([
  // #353
  "The UTC date key `toISOString().slice(0, 10)` is written inline about a dozen times across src (tenmin-history, storage, daily-bars-coverage, gap-refill, us-calendar, session-open...). A named, tested helper gives one place for it. Production safety: additive only; one new exported pure function appended to src/et-time.ts, no existing code or caller changes, so the running scanner chain is unchanged. A box dry-run on PeaceSTOCKS bf284ed built exactly one candidate (public-date-function-v1); the new test passes with the function and fails at the base; suite 544/544, all 4 typechecks ok. Disjoint file: no other task in this batch touches src/et-time.ts. Expected COUNTS.)",
  // #354
  "Whole-day differences are computed inline from millisecond deltas (gap-refill-lib's session gap check, tenmin-range-entries' daysSinceEpoch). A UTC-only helper with tests (rounding, negative spans) gives one tested home for that arithmetic. Production safety: additive only; one new exported pure function appended to src/us-calendar.ts, no existing code or caller changes, so the running scanner chain is unchanged. A box dry-run on PeaceSTOCKS bf284ed built exactly one candidate (public-date-function-v1); the new test passes with the function and fails at the base; suite 544/544, all 4 typechecks ok. Disjoint file: no other task in this batch touches src/us-calendar.ts. Expected COUNTS.)",
  // #355
  "The backstop's slot logic works on UTC weekdays (getUTCDay), but there is no Date-level weekend check; tenmin-backfill's isWeekendIndex takes a bare index. This is the timezone-free Date version, tested at the UTC day edges. Production safety: additive only; one new exported pure function appended to src/scan-backstop.ts, no existing code or caller changes, so the running scanner chain is unchanged. A box dry-run on PeaceSTOCKS bf284ed built exactly one candidate (public-date-function-v1); the new test passes with the function and fails at the base; suite 544/544, all 4 typechecks ok. Disjoint file: no other task in this batch touches src/scan-backstop.ts. Expected COUNTS.)",
  // #356
  "Sums are written as ad-hoc `reduce((sum, v) => sum + v, 0)` in storage, reader, intraday and features. A small tested helper in the shared numeric module. Production safety: additive only; one new exported pure function appended to src/num-utils.ts, no existing code or caller changes, so the running scanner chain is unchanged. A box dry-run on PeaceSTOCKS bf284ed built exactly one candidate (public-loop-function-v1); the new test passes with the function and fails at the base; suite 544/544, all 4 typechecks ok. Disjoint file: no other task in this batch touches src/num-utils.ts. Expected COUNTS.)",
  // #357
  "sampleVolatility computes an n-1 variance inline with two reduces. This is a standalone, tested sampleVariance next to it (returns 0 under two values, matching how short series are treated as no signal). Production safety: additive only; one new exported pure function appended to src/features.ts, no existing code or caller changes, so the running scanner chain is unchanged. A box dry-run on PeaceSTOCKS bf284ed built exactly one candidate (public-loop-function-v1); the new test passes with the function and fails at the base; suite 544/544, all 4 typechecks ok. Disjoint file: no other task in this batch touches src/features.ts. Expected COUNTS.)",
  // #358
  "The YYYY-MM month key `sessionDate.slice(0, 7)` is written inline about ten times (daily-bars-coverage, object-storage, gap-refill-lib, daily-bar-sessions, ticker-reference-index). A named helper next to requireMonth. Production safety: additive only; one new exported pure function appended to src/daily-bar-sessions.ts, no existing code or caller changes, so the running scanner chain is unchanged. A box dry-run on PeaceSTOCKS bf284ed built exactly one candidate (public-add-function-v1); the new test passes with the function and fails at the base; suite 544/544, all 4 typechecks ok. Disjoint file: no other task in this batch touches src/daily-bar-sessions.ts. Expected COUNTS.)",
  // #359
  "storage.ts and object-storage.ts both compute targetUtilizationPercent inline as `((mbPerDay * 252) / 1024 / 10) * 100` (252 sessions a year against a 10 GB target). This is the same math as one tested helper (written as gbPerYear * 10 so the test values are exact). Production safety: additive only; one new exported pure function appended to src/storage.ts, no existing code or caller changes, so the running scanner chain is unchanged. A box dry-run on PeaceSTOCKS bf284ed built exactly one candidate (public-complex-function-v1); the new test passes with the function and fails at the base; suite 544/544, all 4 typechecks ok. Disjoint file: no other task in this batch touches src/storage.ts. Expected COUNTS.)",
  // #370
  "The content-addressed grouped-daily file name and its INVALID_REPLY_SHA256 guard have no test; this pins its current behaviour. Production safety: test-only: one new src/*.test.ts file only: no source edits, no fix commit. Job B grades it fix-free: the test passes on the current code and fails with the function body stubbed. The running scanner chain is unchanged. A box dry-run on PeaceSTOCKS 47cfaaf built exactly one candidate (public-test-case-existing-v1); a local Job B run graded it COUNTS (the new test passes on the current code and fails with dailyReplyDustHashedFileName stubbed); suite 556/556 with all six new tests of this batch, all 4 typechecks ok. Disjoint file: each task in this batch creates its own new test file. Expected COUNTS.)",
  // #371
  "The intraday manifest key (and its INVALID_SESSION_DATE guard through sessionPrefix) has no test; this pins its current behaviour. Production safety: test-only: one new src/*.test.ts file only: no source edits, no fix commit. Job B grades it fix-free: the test passes on the current code and fails with the function body stubbed. The running scanner chain is unchanged. A box dry-run on PeaceSTOCKS 47cfaaf built exactly one candidate (public-test-case-existing-v1); a local Job B run graded it COUNTS (the new test passes on the current code and fails with replyDustManifestKey stubbed); suite 556/556 with all six new tests of this batch, all 4 typechecks ok. Disjoint file: each task in this batch creates its own new test file. Expected COUNTS.)",
  // #372
  "The day-number to YYYY-MM-DD conversion used by the range entries (and its INVALID_RANGE guard) has no test; this pins its current behaviour. Production safety: test-only: one new src/*.test.ts file only: no source edits, no fix commit. Job B grades it fix-free: the test passes on the current code and fails with the function body stubbed. The running scanner chain is unchanged. A box dry-run on PeaceSTOCKS 47cfaaf built exactly one candidate (public-test-case-existing-v1); a local Job B run graded it COUNTS (the new test passes on the current code and fails with dateFromDaysSinceEpoch stubbed); suite 556/556 with all six new tests of this batch, all 4 typechecks ok. Disjoint file: each task in this batch creates its own new test file. Expected COUNTS.)",
  // #373
  "The range storage prefix (and the INVALID_RANGE ordering guard) has no test; this pins its current behaviour. Production safety: test-only: one new src/*.test.ts file only: no source edits, no fix commit. Job B grades it fix-free: the test passes on the current code and fails with the function body stubbed. The running scanner chain is unchanged. A box dry-run on PeaceSTOCKS 47cfaaf built exactly one candidate (public-test-case-existing-v1); a local Job B run graded it COUNTS (the new test passes on the current code and fails with tenMinRangePrefix stubbed); suite 556/556 with all six new tests of this batch, all 4 typechecks ok. Disjoint file: each task in this batch creates its own new test file. Expected COUNTS.)",
  // #374
  "The dated ticker page file name padding and its INVALID_DATED_TICKER_PAGE guard have no test; this pins its current behaviour. Production safety: test-only: one new src/*.test.ts file only: no source edits, no fix commit. Job B grades it fix-free: the test passes on the current code and fails with the function body stubbed. The running scanner chain is unchanged. A box dry-run on PeaceSTOCKS 47cfaaf built exactly one candidate (public-test-case-existing-v1); a local Job B run graded it COUNTS (the new test passes on the current code and fails with datedTickerPageFileName stubbed); suite 556/556 with all six new tests of this batch, all 4 typechecks ok. Disjoint file: each task in this batch creates its own new test file. Expected COUNTS.)",
  // #390
  "The R2 manifest key for a two-month ten-minute pair (built through tenmin-history's pairRangeForDate) and its INVALID_SESSION_DATE guard have no test anywhere; this pins its current behaviour. Production safety: test-only: one new src/*.test.ts file only: no source edits, no fix commit. Job B grades it fix-free: the test passes on the current code and fails with the function body stubbed. The running scanner chain is unchanged. A box dry-run on PeaceSTOCKS 5c41528 (Workspace main efd3f76, Node 22) built exactly one candidate (public-test-case-existing-v2); a local Job B run graded it COUNTS (the new test passes on the current code and fails with tenMinPairManifestKey stubbed); suite 564/564 with all eight new tests of this batch, all 4 typechecks ok. Disjoint file: each task in this batch creates its own new test file. Expected COUNTS.)",
  // #391
  "The check that decides which scanner.yml runs never call Massive or write R2 (restarter, or daily tick switched off) has no direct test; this pins its current behaviour. Production safety: test-only: one new src/*.test.ts file only: no source edits, no fix commit. Job B grades it fix-free: the test passes on the current code and fails with the function body stubbed. The running scanner chain is unchanged. A box dry-run on PeaceSTOCKS 5c41528 (Workspace main efd3f76, Node 22) built exactly one candidate (public-test-case-existing-v2); a local Job B run graded it COUNTS (the new test passes on the current code and fails with isIdleScannerRun stubbed); suite 564/564 with all eight new tests of this batch, all 4 typechecks ok. Disjoint file: each task in this batch creates its own new test file. Expected COUNTS.)",
  // #392
  "The gapped-fetch count behind the ten-minute range remaining estimate is never called directly by a test; this pins that a gap counts only when it matches a planned fetch and carries its fetch window. Production safety: test-only: one new src/*.test.ts file only: no source edits, no fix commit. Job B grades it fix-free: the test passes on the current code and fails with the function body stubbed. The running scanner chain is unchanged. A box dry-run on PeaceSTOCKS 5c41528 (Workspace main efd3f76, Node 22) built exactly one candidate (public-test-case-existing-v2); a local Job B run graded it COUNTS (the new test passes on the current code and fails with countGappedPlannedFetches stubbed); suite 564/564 with all eight new tests of this batch, all 4 typechecks ok. Disjoint file: each task in this batch creates its own new test file. Expected COUNTS.)",
  // #393
  "The orphan-fetch count (stored or gapped fetches that are no longer planned) is never called directly by a test; this pins its current behaviour. Production safety: test-only: one new src/*.test.ts file only: no source edits, no fix commit. Job B grades it fix-free: the test passes on the current code and fails with the function body stubbed. The running scanner chain is unchanged. A box dry-run on PeaceSTOCKS 5c41528 (Workspace main efd3f76, Node 22) built exactly one candidate (public-test-case-existing-v2); a local Job B run graded it COUNTS (the new test passes on the current code and fails with countOrphanFetches stubbed); suite 564/564 with all eight new tests of this batch, all 4 typechecks ok. Disjoint file: each task in this batch creates its own new test file. Expected COUNTS.)",
  // #394
  "The rule that only a guard-window wait triggers a heal dispatch has no direct test; this pins its current behaviour. Production safety: test-only: one new src/*.test.ts file only: no source edits, no fix commit. Job B grades it fix-free: the test passes on the current code and fails with the function body stubbed. The running scanner chain is unchanged. A box dry-run on PeaceSTOCKS 5c41528 (Workspace main efd3f76, Node 22) built exactly one candidate (public-test-case-existing-v2); a local Job B run graded it COUNTS (the new test passes on the current code and fails with shouldDispatchHeal stubbed); suite 564/564 with all eight new tests of this batch, all 4 typechecks ok. Disjoint file: each task in this batch creates its own new test file. Expected COUNTS.)",
  // #395
  "The plan for cancelling a dispatched tenmin_history run on SCAN_CANCELLED has no direct test; this pins which statuses cancel and the detail text otherwise. Production safety: test-only: one new src/*.test.ts file only: no source edits, no fix commit. Job B grades it fix-free: the test passes on the current code and fails with the function body stubbed. The running scanner chain is unchanged. A box dry-run on PeaceSTOCKS 5c41528 (Workspace main efd3f76, Node 22) built exactly one candidate (public-test-case-existing-v2); a local Job B run graded it COUNTS (the new test passes on the current code and fails with planCancelDispatchedRun stubbed); suite 564/564 with all eight new tests of this batch, all 4 typechecks ok. Disjoint file: each task in this batch creates its own new test file. Expected COUNTS.)",
  // #396
  "Plan-upgrade detection (an older window or a higher rate than the previous plan) has no direct test; this pins its current behaviour. Production safety: test-only: one new src/*.test.ts file only: no source edits, no fix commit. Job B grades it fix-free: the test passes on the current code and fails with the function body stubbed. The running scanner chain is unchanged. A box dry-run on PeaceSTOCKS 5c41528 (Workspace main efd3f76, Node 22) built exactly one candidate (public-test-case-existing-v2); a local Job B run graded it COUNTS (the new test passes on the current code and fails with planUpgraded stubbed); suite 564/564 with all eight new tests of this batch, all 4 typechecks ok. Disjoint file: each task in this batch creates its own new test file. Expected COUNTS.)",
  // #397
  "parseFetchIdentityKey has no test anywhere; this pins the NUL-separated four-part split and that malformed keys parse to undefined. Production safety: test-only: one new src/*.test.ts file only: no source edits, no fix commit. Job B grades it fix-free: the test passes on the current code and fails with the function body stubbed. The running scanner chain is unchanged. A box dry-run on PeaceSTOCKS 5c41528 (Workspace main efd3f76, Node 22) built exactly one candidate (public-test-case-existing-v2); a local Job B run graded it COUNTS (the new test passes on the current code and fails with parseFetchIdentityKey stubbed); suite 564/564 with all eight new tests of this batch, all 4 typechecks ok. Disjoint file: each task in this batch creates its own new test file. Expected COUNTS.)",
  // #399
  "The existing helpers test covers 1 and 3 only; this pins zero and negative counts. Self-zone task on PeaceAI-Workspace: one new peaceai/self-tests/helpers/*.test.ts file only. No gate, grading, approval, leak, rule or workflow file is touched. A box dry-run on PeaceAI-Workspace c7ba0a5 (Workspace main, Node 22) built exactly one candidate (public-test-case-existing-v1); a local Job B run graded it COUNTS (the new test passes on the current code and fails with plural stubbed); with all five new tests of this batch: typecheck ok, npm test 17/17, test:self 5/5, test:tools 1077/1078 (only the box-only m48 snapshot test). Disjoint file: each task in this batch creates its own new test file. Expected COUNTS.)",
  // #400
  "The existing helpers test does not cover max 1, an exact fit, a negative max or empty text; this pins them. Self-zone task on PeaceAI-Workspace: one new peaceai/self-tests/helpers/*.test.ts file only. No gate, grading, approval, leak, rule or workflow file is touched. A box dry-run on PeaceAI-Workspace c7ba0a5 (Workspace main, Node 22) built exactly one candidate (public-test-case-existing-v1); a local Job B run graded it COUNTS (the new test passes on the current code and fails with truncate stubbed); with all five new tests of this batch: typecheck ok, npm test 17/17, test:self 5/5, test:tools 1077/1078 (only the box-only m48 snapshot test). Disjoint file: each task in this batch creates its own new test file. Expected COUNTS.)",
  // #401
  "src/text.test.ts never reaches the maxLength <= 1 branch; this pins it (the negative-limit case is a separate bug task, not pinned here). Self-zone task on PeaceAI-Workspace: one new src/*.test.ts file only. No gate, grading, approval, leak, rule or workflow file is touched. A box dry-run on PeaceAI-Workspace c7ba0a5 (Workspace main, Node 22) built exactly one candidate (public-test-case-existing-v1); a local Job B run graded it COUNTS (the new test passes on the current code and fails with truncate stubbed); with all five new tests of this batch: typecheck ok, npm test 17/17, test:self 5/5, test:tools 1077/1078 (only the box-only m48 snapshot test). Disjoint file: each task in this batch creates its own new test file. Expected COUNTS.)",
  // #402
  "src/text.test.ts covers one title; this pins empty and punctuation-only input and digits. Self-zone task on PeaceAI-Workspace: one new src/*.test.ts file only. No gate, grading, approval, leak, rule or workflow file is touched. A box dry-run on PeaceAI-Workspace c7ba0a5 (Workspace main, Node 22) built exactly one candidate (public-test-case-existing-v1); a local Job B run graded it COUNTS (the new test passes on the current code and fails with slugify stubbed); with all five new tests of this batch: typecheck ok, npm test 17/17, test:self 5/5, test:tools 1077/1078 (only the box-only m48 snapshot test). Disjoint file: each task in this batch creates its own new test file. Expected COUNTS.)",
  // #403
  "src/config.test.ts covers 7, -2 and abc; this pins decimals, zero, padded and exponent input (Number() semantics). Self-zone task on PeaceAI-Workspace: one new src/*.test.ts file only. No gate, grading, approval, leak, rule or workflow file is touched. A box dry-run on PeaceAI-Workspace c7ba0a5 (Workspace main, Node 22) built exactly one candidate (public-test-case-existing-v1); a local Job B run graded it COUNTS (the new test passes on the current code and fails with parseQuantity stubbed); with all five new tests of this batch: typecheck ok, npm test 17/17, test:self 5/5, test:tools 1077/1078 (only the box-only m48 snapshot test). Disjoint file: each task in this batch creates its own new test file. Expected COUNTS.)",
  // #415
  "dueSlot (which slot a :47 backstop tick is responsible for: 30-89 min after 05:30Z or 09:30Z, Tue-Sat only) has no direct test, and its slot branch is never reached by the suite; this pins the window edges and the weekday rule. Production safety: test-only: one new src/*.test.ts file only: no source edits, no fix commit. Job B grades it fix-free: the test passes on the current code and fails with the function body stubbed. The running scanner chain is unchanged. A box dry-run on PeaceSTOCKS 8b1f413 (Workspace main 616c083, live 26-rule approved list, Node 22) built exactly one candidate (public-test-case-existing-v3); a local Job B run graded it COUNTS (the new test passes on the current code and fails with dueSlot stubbed); suite 574/574 with all eleven new tests of this batch, all 4 typechecks ok. Disjoint file: each task in this batch creates its own new test file. Expected COUNTS.)",
  // #416
  "lastScanSlot (the slot the open-ended backstop backs up) is only reached through planOpenScanAt and never asserted directly; this pins the at-slot case and the look-back over Sunday and Monday to Saturday 09:30Z. Production safety: test-only: one new src/*.test.ts file only: no source edits, no fix commit. Job B grades it fix-free: the test passes on the current code and fails with the function body stubbed. The running scanner chain is unchanged. A box dry-run on PeaceSTOCKS 8b1f413 (Workspace main 616c083, live 26-rule approved list, Node 22) built exactly one candidate (public-test-case-existing-v3); a local Job B run graded it COUNTS (the new test passes on the current code and fails with lastScanSlot stubbed); suite 574/574 with all eleven new tests of this batch, all 4 typechecks ok. Disjoint file: each task in this batch creates its own new test file. Expected COUNTS.)",
  // #417
  "The existing gap-refill test checks only 05:12, 05:11 and 10:15; the 09:12 start of the second window and the 06:14/06:15 end of the first are untested; this pins them. Production safety: test-only: one new src/*.test.ts file only: no source edits, no fix commit. Job B grades it fix-free: the test passes on the current code and fails with the function body stubbed. The running scanner chain is unchanged. A box dry-run on PeaceSTOCKS 8b1f413 (Workspace main 616c083, live 26-rule approved list, Node 22) built exactly one candidate (public-test-case-existing-v3); a local Job B run graded it COUNTS (the new test passes on the current code and fails with inRefillGuard stubbed); suite 574/574 with all eleven new tests of this batch, all 4 typechecks ok. Disjoint file: each task in this batch creates its own new test file. Expected COUNTS.)",
  // #418
  "The existing probe test never sends a 200 with an unparsable body (the catch branch) or a zero / non-numeric rate header, and never checks probedFrom and status pass through; this pins them. Production safety: test-only: one new src/*.test.ts file only: no source edits, no fix commit. Job B grades it fix-free: the test passes on the current code and fails with the function body stubbed. The running scanner chain is unchanged. A box dry-run on PeaceSTOCKS 8b1f413 (Workspace main 616c083, live 26-rule approved list, Node 22) built exactly one candidate (public-test-case-existing-v2); a local Job B run graded it COUNTS (the new test passes on the current code and fails with classifyPlanProbe stubbed); suite 574/574 with all eleven new tests of this batch, all 4 typechecks ok. Disjoint file: each task in this batch creates its own new test file. Expected COUNTS.)",
  // #419
  "The refused branch (STOP_REFUSAL / STOP_BOUNDED_MANUAL) of the shadow-mode outcome map is untested, as are a bare 429 reason and a missing reason or job result; this pins them. Production safety: test-only: one new src/*.test.ts file only: no source edits, no fix commit. Job B grades it fix-free: the test passes on the current code and fails with the function body stubbed. The running scanner chain is unchanged. A box dry-run on PeaceSTOCKS 8b1f413 (Workspace main 616c083, live 26-rule approved list, Node 22) built exactly one candidate (public-test-case-existing-v2); a local Job B run graded it COUNTS (the new test passes on the current code and fails with lastOutcomeFromRecord stubbed); suite 574/574 with all eleven new tests of this batch, all 4 typechecks ok. Disjoint file: each task in this batch creates its own new test file. Expected COUNTS.)",
  // #420
  "Only -1 (throws) and 20 (LEVEL_2) are tested; LEVEL_0, LEVEL_1, LEVEL_3, the 19/251/252 boundaries and a fractional count are not; this pins them. Production safety: test-only: one new src/*.test.ts file only: no source edits, no fix commit. Job B grades it fix-free: the test passes on the current code and fails with the function body stubbed. The running scanner chain is unchanged. A box dry-run on PeaceSTOCKS 8b1f413 (Workspace main 616c083, live 26-rule approved list, Node 22) built exactly one candidate (public-test-case-existing-v2); a local Job B run graded it COUNTS (the new test passes on the current code and fails with eligibilityForBarCount stubbed); suite 574/574 with all eleven new tests of this batch, all 4 typechecks ok. Disjoint file: each task in this batch creates its own new test file. Expected COUNTS.)",
  // #421
  "The seal coverage rule is tested only with COMPLETE requested; an unset or MISSING request with no open gaps is untested; this pins that only an explicit COMPLETE seals as COMPLETE. Production safety: test-only: one new src/*.test.ts file only: no source edits, no fix commit. Job B grades it fix-free: the test passes on the current code and fails with the function body stubbed. The running scanner chain is unchanged. A box dry-run on PeaceSTOCKS 8b1f413 (Workspace main 616c083, live 26-rule approved list, Node 22) built exactly one candidate (public-test-case-existing-v2); a local Job B run graded it COUNTS (the new test passes on the current code and fails with resolveTenMinDelistedCoverageForSeal stubbed); suite 574/574 with all eleven new tests of this batch, all 4 typechecks ok. Disjoint file: each task in this batch creates its own new test file. Expected COUNTS.)",
  // #422
  "The entries key is only compared with itself through the manifest; its literal layout and both guards (a non-hex sha256, a reversed range) are untested; this pins them. Production safety: test-only: one new src/*.test.ts file only: no source edits, no fix commit. Job B grades it fix-free: the test passes on the current code and fails with the function body stubbed. The running scanner chain is unchanged. A box dry-run on PeaceSTOCKS 8b1f413 (Workspace main 616c083, live 26-rule approved list, Node 22) built exactly one candidate (public-test-case-existing-v2); a local Job B run graded it COUNTS (the new test passes on the current code and fails with tenMinRangeEntriesObjectKey stubbed); suite 574/574 with all eleven new tests of this batch, all 4 typechecks ok. Disjoint file: each task in this batch creates its own new test file. Expected COUNTS.)",
  // #423
  "The daily index key is tested for one October 2026 date only; another two-month pair (a leap-year February end) and the INVALID_SESSION_DATE guard are untested; this pins them. Production safety: test-only: one new src/*.test.ts file only: no source edits, no fix commit. Job B grades it fix-free: the test passes on the current code and fails with the function body stubbed. The running scanner chain is unchanged. A box dry-run on PeaceSTOCKS 8b1f413 (Workspace main 616c083, live 26-rule approved list, Node 22) built exactly one candidate (public-test-case-existing-v2); a local Job B run graded it COUNTS (the new test passes on the current code and fails with tenMinDailyIndexKey stubbed); suite 574/574 with all eleven new tests of this batch, all 4 typechecks ok. Disjoint file: each task in this batch creates its own new test file. Expected COUNTS.)",
  // #424
  "The retry rule is tested for fetch failed and STOP_REFUSAL only; a 5xx or ETIMEDOUT stop, a 404 stop and the SCAN_CANCELLED / KILL_SWITCH exclusions on a failed job are untested; this pins them. Production safety: test-only: one new src/*.test.ts file only: no source edits, no fix commit. Job B grades it fix-free: the test passes on the current code and fails with the function body stubbed. The running scanner chain is unchanged. A box dry-run on PeaceSTOCKS 8b1f413 (Workspace main 616c083, live 26-rule approved list, Node 22) built exactly one candidate (public-test-case-existing-v2); a local Job B run graded it COUNTS (the new test passes on the current code and fails with isTransientFailure stubbed); suite 574/574 with all eleven new tests of this batch, all 4 typechecks ok. Disjoint file: each task in this batch creates its own new test file. Expected COUNTS.)",
  // #425
  "guardWindowState is tested only at 05:15 and 23:00; the first window's end (06:14/06:15), the second window and the wrap to the next day's 05:15 are untested; this pins them. Production safety: test-only: one new src/*.test.ts file only: no source edits, no fix commit. Job B grades it fix-free: the test passes on the current code and fails with the function body stubbed. The running scanner chain is unchanged. A box dry-run on PeaceSTOCKS 8b1f413 (Workspace main 616c083, live 26-rule approved list, Node 22) built exactly one candidate (public-test-case-existing-v3); a local Job B run graded it COUNTS (the new test passes on the current code and fails with guardWindowState stubbed); suite 574/574 with all eleven new tests of this batch, all 4 typechecks ok. Disjoint file: each task in this batch creates its own new test file. Expected COUNTS.)",
  // #427
  "maxChainOf (TENMIN_REDISPATCH_MAX_CHAIN parsing) is tested only with string inputs \"500\", \"x\", \"0\" and undefined; a numeric value, the hard cap at 100 from a number or \"101\", a negative or fractional number and an empty string are untested; this pins them. Production safety: test-only: one new src/*.test.ts file only: no source edits, no fix commit. Job B grades it fix-free: the test passes on the current code and fails with the function body stubbed. The running scanner chain is unchanged. A box dry-run on PeaceSTOCKS 663e31e (Workspace main 129a084, live 26-rule approved list, Node 22) built exactly one candidate (public-test-case-existing-v2); a local Job B run graded it COUNTS (the new test passes on the current code and fails with maxChainOf stubbed); suite 585/585 with all eleven new tests of this batch, all 4 typechecks ok. Disjoint file: each task in this batch creates its own new test file. Expected COUNTS.)",
  // #428
  "Only MASSIVE_HTTP_403 (true) and TENMIN_TICKER_FORBIDDEN (false) are tested; the credential, API key, 429, exact OBJECT_STORE_REQUIRED, R2_ and REPLY_DUST_ZSTD classes and a 5xx (not an abort) are untested; this pins them. Production safety: test-only: one new src/*.test.ts file only: no source edits, no fix commit. Job B grades it fix-free: the test passes on the current code and fails with the function body stubbed. The running scanner chain is unchanged. A box dry-run on PeaceSTOCKS 663e31e (Workspace main 129a084, live 26-rule approved list, Node 22) built exactly one candidate (public-test-case-existing-v1); a local Job B run graded it COUNTS (the new test passes on the current code and fails with isTenMinRangeAbortError stubbed); suite 585/585 with all eleven new tests of this batch, all 4 typechecks ok. Disjoint file: each task in this batch creates its own new test file. Expected COUNTS.)",
  // #429
  "The gap reason is tested with a lowercase message and the known codes only; an empty message, a one-letter code, the two-letter minimum, a lowercase first letter and a code cut at the colon are untested; this pins them. Production safety: test-only: one new src/*.test.ts file only: no source edits, no fix commit. Job B grades it fix-free: the test passes on the current code and fails with the function body stubbed. The running scanner chain is unchanged. A box dry-run on PeaceSTOCKS 663e31e (Workspace main 129a084, live 26-rule approved list, Node 22) built exactly one candidate (public-test-case-existing-v1); a local Job B run graded it COUNTS (the new test passes on the current code and fails with tenMinRangeGapReason stubbed); suite 585/585 with all eleven new tests of this batch, all 4 typechecks ok. Disjoint file: each task in this batch creates its own new test file. Expected COUNTS.)",
  // #430
  "Only the INVALID_CALENDAR_DATE throws (month 13, Feb 30) are tested; the returned prefix for a valid date (including Feb 29 and a 30-day month end), April 31 and the INVALID_SESSION_DATE format guard are untested; this pins them. Production safety: test-only: one new src/*.test.ts file only: no source edits, no fix commit. Job B grades it fix-free: the test passes on the current code and fails with the function body stubbed. The running scanner chain is unchanged. A box dry-run on PeaceSTOCKS 663e31e (Workspace main 129a084, live 26-rule approved list, Node 22) built exactly one candidate (public-test-case-existing-v1); a local Job B run graded it COUNTS (the new test passes on the current code and fails with datedTickerDatePrefix stubbed); suite 585/585 with all eleven new tests of this batch, all 4 typechecks ok. Disjoint file: each task in this batch creates its own new test file. Expected COUNTS.)",
  // #431
  "The in-run retry rule is tested with fetch failed, MASSIVE_NETWORK:ECONNRESET and two config errors only; socket hang up, HTTP 5xx, a bare 502, timed out, ENOTFOUND, UND_ERR, a 404 and a 4-digit number are untested; this pins them. Production safety: test-only: one new src/*.test.ts file only: no source edits, no fix commit. Job B grades it fix-free: the test passes on the current code and fails with the function body stubbed. The running scanner chain is unchanged. A box dry-run on PeaceSTOCKS 663e31e (Workspace main 129a084, live 26-rule approved list, Node 22) built exactly one candidate (public-test-case-existing-v1); a local Job B run graded it COUNTS (the new test passes on the current code and fails with isTransientHistoryError stubbed); suite 585/585 with all eleven new tests of this batch, all 4 typechecks ok. Disjoint file: each task in this batch creates its own new test file. Expected COUNTS.)",
  // #432
  "The daily grouped file key is only used round-trip through a store (get/head of the same key); its literal layout and the INVALID_SESSION_DATE guard are untested; this pins them. Production safety: test-only: one new src/*.test.ts file only: no source edits, no fix commit. Job B grades it fix-free: the test passes on the current code and fails with the function body stubbed. The running scanner chain is unchanged. A box dry-run on PeaceSTOCKS 663e31e (Workspace main 129a084, live 26-rule approved list, Node 22) built exactly one candidate (public-test-case-existing-v1); a local Job B run graded it COUNTS (the new test passes on the current code and fails with dailyReplyDustFileKey stubbed); suite 585/585 with all eleven new tests of this batch, all 4 typechecks ok. Disjoint file: each task in this batch creates its own new test file. Expected COUNTS.)",
  // #433
  "Year shifts are tested backwards (-2) and Feb 29 to a non-leap year only; Feb 29 to a leap year, a forward shift, a zero shift, Feb 28 back into a leap year and the INVALID_SESSION_DATE guard are untested; this pins them. Production safety: test-only: one new src/*.test.ts file only: no source edits, no fix commit. Job B grades it fix-free: the test passes on the current code and fails with the function body stubbed. The running scanner chain is unchanged. A box dry-run on PeaceSTOCKS 663e31e (Workspace main 129a084, live 26-rule approved list, Node 22) built exactly one candidate (public-test-case-existing-v1); a local Job B run graded it COUNTS (the new test passes on the current code and fails with addCalendarYears stubbed); suite 585/585 with all eleven new tests of this batch, all 4 typechecks ok. Disjoint file: each task in this batch creates its own new test file. Expected COUNTS.)",
  // #434
  "The chain index is tested with \"\", \"4\", \"0\" and \"1x\" only; undefined, a padded value, the 3-digit limit (999 ok, 1000 throws), a leading zero and a negative are untested; this pins them. Production safety: test-only: one new src/*.test.ts file only: no source edits, no fix commit. Job B grades it fix-free: the test passes on the current code and fails with the function body stubbed. The running scanner chain is unchanged. A box dry-run on PeaceSTOCKS 663e31e (Workspace main 129a084, live 26-rule approved list, Node 22) built exactly one candidate (public-test-case-existing-v2); a local Job B run graded it COUNTS (the new test passes on the current code and fails with parseChainIndex stubbed); suite 585/585 with all eleven new tests of this batch, all 4 typechecks ok. Disjoint file: each task in this batch creates its own new test file. Expected COUNTS.)",
  // #435
  "The seal estimate is tested with non-negative counts and a budget hit with 100 actual requests; negative stored / grouped-day counts (clamped to 0), a sub-minute budget (at least 1 request per run) and a budget hit with 0 actual requests (falls back to the budget rate) are untested; this pins them. Production safety: test-only: one new src/*.test.ts file only: no source edits, no fix commit. Job B grades it fix-free: the test passes on the current code and fails with the function body stubbed. The running scanner chain is unchanged. A box dry-run on PeaceSTOCKS 663e31e (Workspace main 129a084, live 26-rule approved list, Node 22) built exactly one candidate (public-test-case-existing-v2); a local Job B run graded it COUNTS (the new test passes on the current code and fails with estimateTenMinRangeRemaining stubbed); suite 585/585 with all eleven new tests of this batch, all 4 typechecks ok. Disjoint file: each task in this batch creates its own new test file. Expected COUNTS.)",
  // #436
  "The post-seal read-back verdict is tested with 7188 listed (pass, unsealed, one failure) and an empty listing; a read-back that verifies fewer or more objects than listed with no failures, and the 1-object pass, are untested; this pins that the counts must match exactly. Production safety: test-only: one new src/*.test.ts file only: no source edits, no fix commit. Job B grades it fix-free: the test passes on the current code and fails with the function body stubbed. The running scanner chain is unchanged. A box dry-run on PeaceSTOCKS 663e31e (Workspace main 129a084, live 26-rule approved list, Node 22) built exactly one candidate (public-test-case-existing-v2); a local Job B run graded it COUNTS (the new test passes on the current code and fails with readbackVerdict stubbed); suite 585/585 with all eleven new tests of this batch, all 4 typechecks ok. Disjoint file: each task in this batch creates its own new test file. Expected COUNTS.)",
  // #437
  "bandOf is tested with 5, -1 and 11 in a 0-10 band and the two throws; values exactly on the lower and upper edges (inclusive) and just past them are untested; this pins them. Production safety: test-only: one new src/*.test.ts file only: no source edits, no fix commit. Job B grades it fix-free: the test passes on the current code and fails with the function body stubbed. The running scanner chain is unchanged. A box dry-run on PeaceSTOCKS 663e31e (Workspace main 129a084, live 26-rule approved list, Node 22) built exactly one candidate (public-test-case-existing-v1); a local Job B run graded it COUNTS (the new test passes on the current code and fails with bandOf stubbed); suite 585/585 with all eleven new tests of this batch, all 4 typechecks ok. Disjoint file: each task in this batch creates its own new test file. Expected COUNTS.)",
  // #443
  "holdActive is tested with in_progress, queued, one completed run and an empty list; a waiting run, a null status (fails closed: holds), several completed runs and a mixed list are untested; this pins them. Production safety: test-only: one new src/*.test.ts file only: no source edits, no fix commit. Job B grades it fix-free: the test passes on the current code and fails with the function body stubbed. The running scanner chain is unchanged. A box dry-run on PeaceSTOCKS ef9778e (Workspace main 3670cd8, live 27-rule approved list, Node 22) built exactly one candidate (public-test-case-existing-v4); a local Job B run graded it COUNTS (the new test passes on the current code and fails with holdActive stubbed); suite 598/598 with all thirteen new tests of this batch, all 4 typechecks ok. Disjoint file: each task in this batch creates its own new test file. Expected COUNTS.)",
  // #444
  "hasSealedMarker is tested by varying one field of a single sealed run (status, conclusion, branch, title); an empty list, a schedule event, a missing display title and a sealed run behind a failed one are untested; this pins them. Production safety: test-only: one new src/*.test.ts file only: no source edits, no fix commit. Job B grades it fix-free: the test passes on the current code and fails with the function body stubbed. The running scanner chain is unchanged. A box dry-run on PeaceSTOCKS ef9778e (Workspace main 3670cd8, live 27-rule approved list, Node 22) built exactly one candidate (public-test-case-existing-v4); a local Job B run graded it COUNTS (the new test passes on the current code and fails with hasSealedMarker stubbed); suite 598/598 with all thirteen new tests of this batch, all 4 typechecks ok. Disjoint file: each task in this batch creates its own new test file. Expected COUNTS.)",
  // #445
  "countOtherActiveScannerRuns is tested with queued / in_progress runs and restarter titles; the waiting, pending and requested states, completed / cancelled / unknown states, a self id not in the list and a null title are untested; this pins them. Production safety: test-only: one new src/*.test.ts file only: no source edits, no fix commit. Job B grades it fix-free: the test passes on the current code and fails with the function body stubbed. The running scanner chain is unchanged. A box dry-run on PeaceSTOCKS ef9778e (Workspace main 3670cd8, live 27-rule approved list, Node 22) built exactly one candidate (public-test-case-existing-v4); a local Job B run graded it COUNTS (the new test passes on the current code and fails with countOtherActiveScannerRuns stubbed); suite 598/598 with all thirteen new tests of this batch, all 4 typechecks ok. Disjoint file: each task in this batch creates its own new test file. Expected COUNTS.)",
  // #446
  "priorConsecutiveFailures is tested with a self id and restarter titles; an empty list, a cancelled run ending the streak, a schedule run being skipped and the count with no self id are untested; this pins them. Production safety: test-only: one new src/*.test.ts file only: no source edits, no fix commit. Job B grades it fix-free: the test passes on the current code and fails with the function body stubbed. The running scanner chain is unchanged. A box dry-run on PeaceSTOCKS ef9778e (Workspace main 3670cd8, live 27-rule approved list, Node 22) built exactly one candidate (public-test-case-existing-v4); a local Job B run graded it COUNTS (the new test passes on the current code and fails with priorConsecutiveFailures stubbed); suite 598/598 with all thirteen new tests of this batch, all 4 typechecks ok. Disjoint file: each task in this batch creates its own new test file. Expected COUNTS.)",
  // #447
  "oneOffPauseReason is tested at 05:30Z and 02:00Z only; the window edges (05:14 open, 05:15 guarded, 06:15 open, 10:14 guarded), the guard window winning over a failed run check and a waiting run are untested; this pins them. Production safety: test-only: one new src/*.test.ts file only: no source edits, no fix commit. Job B grades it fix-free: the test passes on the current code and fails with the function body stubbed. The running scanner chain is unchanged. A box dry-run on PeaceSTOCKS ef9778e (Workspace main 3670cd8, live 27-rule approved list, Node 22) built exactly one candidate (public-test-case-existing-v4); a local Job B run graded it COUNTS (the new test passes on the current code and fails with oneOffPauseReason stubbed); suite 598/598 with all thirteen new tests of this batch, all 4 typechecks ok. Disjoint file: each task in this batch creates its own new test file. Expected COUNTS.)",
  // #448
  "pairRangeForDate is tested with the default anchor only (two dates); a custom firstRangeStart, the January to previous December wrap, an in-pair December and the INVALID_SESSION_DATE guards for both arguments are untested; this pins them. Production safety: test-only: one new src/*.test.ts file only: no source edits, no fix commit. Job B grades it fix-free: the test passes on the current code and fails with the function body stubbed. The running scanner chain is unchanged. A box dry-run on PeaceSTOCKS ef9778e (Workspace main 3670cd8, live 27-rule approved list, Node 22) built exactly one candidate (public-test-case-existing-v4); a local Job B run graded it COUNTS (the new test passes on the current code and fails with pairRangeForDate stubbed); suite 598/598 with all thirteen new tests of this batch, all 4 typechecks ok. Disjoint file: each task in this batch creates its own new test file. Expected COUNTS.)",
  // #449
  "datedTickerMonthStarts is tested with the default first month only; an explicit firstMonth, a firstMonth after now (empty), a year boundary and the INVALID_FIRST_MONTH guard are untested; this pins them. Production safety: test-only: one new src/*.test.ts file only: no source edits, no fix commit. Job B grades it fix-free: the test passes on the current code and fails with the function body stubbed. The running scanner chain is unchanged. A box dry-run on PeaceSTOCKS ef9778e (Workspace main 3670cd8, live 27-rule approved list, Node 22) built exactly one candidate (public-test-case-existing-v4); a local Job B run graded it COUNTS (the new test passes on the current code and fails with datedTickerMonthStarts stubbed); suite 598/598 with all thirteen new tests of this batch, all 4 typechecks ok. Disjoint file: each task in this batch creates its own new test file. Expected COUNTS.)",
  // #450
  "replyDustObjectMetadata has no direct test; its exact key set (rd-* fields, numbers as strings, no file sha or path) is what rebuilds manifests from the store; this pins it. Production safety: test-only: one new src/*.test.ts file only: no source edits, no fix commit. Job B grades it fix-free: the test passes on the current code and fails with the function body stubbed. The running scanner chain is unchanged. A box dry-run on PeaceSTOCKS ef9778e (Workspace main 3670cd8, live 27-rule approved list, Node 22) built exactly one candidate (public-test-case-existing-v4); a local Job B run graded it COUNTS (the new test passes on the current code and fails with replyDustObjectMetadata stubbed); suite 598/598 with all thirteen new tests of this batch, all 4 typechecks ok. Disjoint file: each task in this batch creates its own new test file. Expected COUNTS.)",
  // #451
  "disabledScanGroupedReplyDustReport has no direct test; its shape (enabled false, the reason, zero extra requests, no copies or warnings) is untested; this pins it. Production safety: test-only: one new src/*.test.ts file only: no source edits, no fix commit. Job B grades it fix-free: the test passes on the current code and fails with the function body stubbed. The running scanner chain is unchanged. A box dry-run on PeaceSTOCKS ef9778e (Workspace main 3670cd8, live 27-rule approved list, Node 22) built exactly one candidate (public-test-case-existing-v4); a local Job B run graded it COUNTS (the new test passes on the current code and fails with disabledScanGroupedReplyDustReport stubbed); suite 598/598 with all thirteen new tests of this batch, all 4 typechecks ok. Disjoint file: each task in this batch creates its own new test file. Expected COUNTS.)",
  // #452
  "tenMinRangeObjectMetadata is tested without link / origin; the TENMIN_RANGE_LINK_INVALID and TENMIN_RANGE_ORIGIN_INVALID guards and the rd-link / rd-origin keys are untested; this pins them. Production safety: test-only: one new src/*.test.ts file only: no source edits, no fix commit. Job B grades it fix-free: the test passes on the current code and fails with the function body stubbed. The running scanner chain is unchanged. A box dry-run on PeaceSTOCKS ef9778e (Workspace main 3670cd8, live 27-rule approved list, Node 22) built exactly one candidate (public-test-case-existing-v4); a local Job B run graded it COUNTS (the new test passes on the current code and fails with tenMinRangeObjectMetadata stubbed); suite 598/598 with all thirteen new tests of this batch, all 4 typechecks ok. Disjoint file: each task in this batch creates its own new test file. Expected COUNTS.)",
  // #453
  "dailyReplyDustHashedFileKey is only used round-trip through a store; its literal layout, the INVALID_REPLY_SHA256 guard (uppercase or short hex) and INVALID_SESSION_DATE are untested; this pins them. Production safety: test-only: one new src/*.test.ts file only: no source edits, no fix commit. Job B grades it fix-free: the test passes on the current code and fails with the function body stubbed. The running scanner chain is unchanged. A box dry-run on PeaceSTOCKS ef9778e (Workspace main 3670cd8, live 27-rule approved list, Node 22) built exactly one candidate (public-test-case-existing-v1); a local Job B run graded it COUNTS (the new test passes on the current code and fails with dailyReplyDustHashedFileKey stubbed); suite 598/598 with all thirteen new tests of this batch, all 4 typechecks ok. Disjoint file: each task in this batch creates its own new test file. Expected COUNTS.)",
  // #454
  "minutesUntilGuardWindowEnd is tested from 05:05Z / 09:05Z (inside the 10-minute lead) onward; times just before the lead (05:04Z, 05:04:30Z, 09:04Z) and a mid-lead time are untested; this pins them. Production safety: test-only: one new src/*.test.ts file only: no source edits, no fix commit. Job B grades it fix-free: the test passes on the current code and fails with the function body stubbed. The running scanner chain is unchanged. A box dry-run on PeaceSTOCKS ef9778e (Workspace main 3670cd8, live 27-rule approved list, Node 22) built exactly one candidate (public-test-case-existing-v3); a local Job B run graded it COUNTS (the new test passes on the current code and fails with minutesUntilGuardWindowEnd stubbed); suite 598/598 with all thirteen new tests of this batch, all 4 typechecks ok. Disjoint file: each task in this batch creates its own new test file. Expected COUNTS.)",
  // #455
  "resolveSessionPredictionStatus is tested with attemptedAt ordering and legacy ids; an empty list and the FROZEN-only tie-breaks without attemptedAt (newest recordedAt, then id ascending) are untested; this pins them. Production safety: test-only: one new src/*.test.ts file only: no source edits, no fix commit. Job B grades it fix-free: the test passes on the current code and fails with the function body stubbed. The running scanner chain is unchanged. A box dry-run on PeaceSTOCKS ef9778e (Workspace main 3670cd8, live 27-rule approved list, Node 22) built exactly one candidate (public-test-case-existing-v4); a local Job B run graded it COUNTS (the new test passes on the current code and fails with resolveSessionPredictionStatus stubbed); suite 598/598 with all thirteen new tests of this batch, all 4 typechecks ok. Disjoint file: each task in this batch creates its own new test file. Expected COUNTS.)",
  // #471
  "corporateActionCoverageRecords is tested with one session and no actions; duplicate and unsorted sessions, per-session action counts (actions on other dates ignored), a datasets override and no sessions are untested; this pins them. Production safety: test-only: one new src/*.test.ts file only: no source edits, no fix commit. Job B grades it fix-free: the test passes on the current code and fails with the function body stubbed. The running scanner chain is unchanged. A box dry-run on PeaceSTOCKS 0ab37c8 (Workspace main 1e8448a, live 30-rule approved list, Node 22) built exactly one candidate (public-test-case-existing-v5); a local Job B run graded it COUNTS (the new test passes on the current code and fails with corporateActionCoverageRecords stubbed); suite 613/613 with all fifteen new tests of this batch, all 4 typechecks ok. Disjoint file: each task in this batch creates its own new test file. Expected COUNTS.)",
  // #472
  "tenMinScanCheckStops is tested with prior 0 and 1; a larger prior, a negative or fractional prior (treated as 0) and a bare STOP_SCAN_CHECK_FAILED reason without the colon (0) are untested; this pins them. Production safety: test-only: one new src/*.test.ts file only: no source edits, no fix commit. Job B grades it fix-free: the test passes on the current code and fails with the function body stubbed. The running scanner chain is unchanged. A box dry-run on PeaceSTOCKS 0ab37c8 (Workspace main 1e8448a, live 30-rule approved list, Node 22) built exactly one candidate (public-test-case-existing-v5); a local Job B run graded it COUNTS (the new test passes on the current code and fails with tenMinScanCheckStops stubbed); suite 613/613 with all fifteen new tests of this batch, all 4 typechecks ok. Disjoint file: each task in this batch creates its own new test file. Expected COUNTS.)",
  // #473
  "stopRecordForScanCancelled is tested with records that have an outcome and a run id; a record with no outcome and an empty githubRunId (built outcome, runId unknown) and a string scan run id are untested; this pins them. Production safety: test-only: one new src/*.test.ts file only: no source edits, no fix commit. Job B grades it fix-free: the test passes on the current code and fails with the function body stubbed. The running scanner chain is unchanged. A box dry-run on PeaceSTOCKS 0ab37c8 (Workspace main 1e8448a, live 30-rule approved list, Node 22) built exactly one candidate (public-test-case-existing-v5); a local Job B run graded it COUNTS (the new test passes on the current code and fails with stopRecordForScanCancelled stubbed); suite 613/613 with all fifteen new tests of this batch, all 4 typechecks ok. Disjoint file: each task in this batch creates its own new test file. Expected COUNTS.)",
  // #474
  "isEmptyTenMinRangeManifest has no test; a zero securityCount, a non-zero count with no securities, and one listed security are untested; this pins them. Production safety: test-only: one new src/*.test.ts file only: no source edits, no fix commit. Job B grades it fix-free: the test passes on the current code and fails with the function body stubbed. The running scanner chain is unchanged. A box dry-run on PeaceSTOCKS 0ab37c8 (Workspace main 1e8448a, live 30-rule approved list, Node 22) built exactly one candidate (public-test-case-existing-v5); a local Job B run graded it COUNTS (the new test passes on the current code and fails with isEmptyTenMinRangeManifest stubbed); suite 613/613 with all fifteen new tests of this batch, all 4 typechecks ok. Disjoint file: each task in this batch creates its own new test file. Expected COUNTS.)",
  // #475
  "aggregateIntradayBars is tested with 60-minute aggregation of full sessions; the INVALID_AGGREGATION_INTERVAL guard (25, 5), an empty list, and a single halted bar (HALTED group, bucket index) are untested; this pins them. Production safety: test-only: one new src/*.test.ts file only: no source edits, no fix commit. Job B grades it fix-free: the test passes on the current code and fails with the function body stubbed. The running scanner chain is unchanged. A box dry-run on PeaceSTOCKS 0ab37c8 (Workspace main 1e8448a, live 30-rule approved list, Node 22) built exactly one candidate (public-test-case-existing-v5); a local Job B run graded it COUNTS (the new test passes on the current code and fails with aggregateIntradayBars stubbed); suite 613/613 with all fifteen new tests of this batch, all 4 typechecks ok. Disjoint file: each task in this batch creates its own new test file. Expected COUNTS.)",
  // #476
  "planTenMinAlert is tested for planned waits, stops and the fallback step failure; a paused chain whose history step failed (STOP_JOB_FAILURE), a cancelled or empty redispatch step, a skipped fallback step key and a fallback planned wait are untested; this pins them. Production safety: test-only: one new src/*.test.ts file only: no source edits, no fix commit. Job B grades it fix-free: the test passes on the current code and fails with the function body stubbed. The running scanner chain is unchanged. A box dry-run on PeaceSTOCKS 0ab37c8 (Workspace main 1e8448a, live 30-rule approved list, Node 22) built exactly one candidate (public-test-case-existing-v5); a local Job B run graded it COUNTS (the new test passes on the current code and fails with planTenMinAlert stubbed); suite 613/613 with all fifteen new tests of this batch, all 4 typechecks ok. Disjoint file: each task in this batch creates its own new test file. Expected COUNTS.)",
  // #477
  "canonicalJson is only compared with stableJson on decoded bars; its own output for nested objects in arrays, sorted keys at every depth, empty object / array, null, a string and a negative fraction is untested; this pins it. Production safety: test-only: one new src/*.test.ts file only: no source edits, no fix commit. Job B grades it fix-free: the test passes on the current code and fails with the function body stubbed. The running scanner chain is unchanged. A box dry-run on PeaceSTOCKS 0ab37c8 (Workspace main 1e8448a, live 30-rule approved list, Node 22) built exactly one candidate (public-test-case-existing-v6); a local Job B run graded it COUNTS (the new test passes on the current code and fails with canonicalJson stubbed); suite 613/613 with all fifteen new tests of this batch, all 4 typechecks ok. Disjoint file: each task in this batch creates its own new test file. Expected COUNTS.)",
  // #478
  "stableJson is used to build expected rows but its own output is never asserted; sorted keys, array order kept, nested arrays, quoted keys with spaces or dashes and scalars are untested; this pins them. Production safety: test-only: one new src/*.test.ts file only: no source edits, no fix commit. Job B grades it fix-free: the test passes on the current code and fails with the function body stubbed. The running scanner chain is unchanged. A box dry-run on PeaceSTOCKS 0ab37c8 (Workspace main 1e8448a, live 30-rule approved list, Node 22) built exactly one candidate (public-test-case-existing-v6); a local Job B run graded it COUNTS (the new test passes on the current code and fails with stableJson stubbed); suite 613/613 with all fifteen new tests of this batch, all 4 typechecks ok. Disjoint file: each task in this batch creates its own new test file. Expected COUNTS.)",
  // #479
  "errorCode has no direct test; the leading upper-case code, digits and underscores in the code, and the UNKNOWN fallback for lower-case, empty, numeric, digit-first and non-Error object values are untested; this pins them. Production safety: test-only: one new src/*.test.ts file only: no source edits, no fix commit. Job B grades it fix-free: the test passes on the current code and fails with the function body stubbed. The running scanner chain is unchanged. A box dry-run on PeaceSTOCKS 0ab37c8 (Workspace main 1e8448a, live 30-rule approved list, Node 22) built exactly one candidate (public-test-case-existing-v6); a local Job B run graded it COUNTS (the new test passes on the current code and fails with errorCode stubbed); suite 613/613 with all fifteen new tests of this batch, all 4 typechecks ok. Disjoint file: each task in this batch creates its own new test file. Expected COUNTS.)",
  // #480
  "tenMinMassiveRequestsOf has no test; a positive count, and zero for 0, negative, fractional, string, null and non-object values are untested; this pins them. Production safety: test-only: one new src/*.test.ts file only: no source edits, no fix commit. Job B grades it fix-free: the test passes on the current code and fails with the function body stubbed. The running scanner chain is unchanged. A box dry-run on PeaceSTOCKS 0ab37c8 (Workspace main 1e8448a, live 30-rule approved list, Node 22) built exactly one candidate (public-test-case-existing-v6); a local Job B run graded it COUNTS (the new test passes on the current code and fails with tenMinMassiveRequestsOf stubbed); suite 613/613 with all fifteen new tests of this batch, all 4 typechecks ok. Disjoint file: each task in this batch creates its own new test file. Expected COUNTS.)",
  // #481
  "tenMinDailyEnabled has no direct test; only exactly \"true\" enables, and \"TRUE\", \"1\", unset and an unrelated true flag do not; this pins it. Production safety: test-only: one new src/*.test.ts file only: no source edits, no fix commit. Job B grades it fix-free: the test passes on the current code and fails with the function body stubbed. The running scanner chain is unchanged. A box dry-run on PeaceSTOCKS 0ab37c8 (Workspace main 1e8448a, live 30-rule approved list, Node 22) built exactly one candidate (public-test-case-existing-v6); a local Job B run graded it COUNTS (the new test passes on the current code and fails with tenMinDailyEnabled stubbed); suite 613/613 with all fifteen new tests of this batch, all 4 typechecks ok. Disjoint file: each task in this batch creates its own new test file. Expected COUNTS.)",
  // #482
  "tenMinDailyRedispatchHold is tested with unset, \"false\" and \"true\"; an empty value, \"TRUE\", and other env keys next to or without TENMIN_AUTO_REDISPATCH are untested; this pins them. Production safety: test-only: one new src/*.test.ts file only: no source edits, no fix commit. Job B grades it fix-free: the test passes on the current code and fails with the function body stubbed. The running scanner chain is unchanged. A box dry-run on PeaceSTOCKS 0ab37c8 (Workspace main 1e8448a, live 30-rule approved list, Node 22) built exactly one candidate (public-test-case-existing-v6); a local Job B run graded it COUNTS (the new test passes on the current code and fails with tenMinDailyRedispatchHold stubbed); suite 613/613 with all fifteen new tests of this batch, all 4 typechecks ok. Disjoint file: each task in this batch creates its own new test file. Expected COUNTS.)",
  // #483
  "scanGroupedReplyDustEnabled is tested with single-key env objects; padded values (\" true\", \"true \"), an unrelated true flag, an empty env and \"true\" next to another key are untested; this pins them. Production safety: test-only: one new src/*.test.ts file only: no source edits, no fix commit. Job B grades it fix-free: the test passes on the current code and fails with the function body stubbed. The running scanner chain is unchanged. A box dry-run on PeaceSTOCKS 0ab37c8 (Workspace main 1e8448a, live 30-rule approved list, Node 22) built exactly one candidate (public-test-case-existing-v6); a local Job B run graded it COUNTS (the new test passes on the current code and fails with scanGroupedReplyDustEnabled stubbed); suite 613/613 with all fifteen new tests of this batch, all 4 typechecks ok. Disjoint file: each task in this batch creates its own new test file. Expected COUNTS.)",
  // #484
  "tickerIndexDatedEnabled is tested with {}, \"1\" and \"true\"; \"TRUE\", \"false\", TICKER_INDEX_DATED_FULL alone (does not enable) and true with FULL false are untested; this pins them. Production safety: test-only: one new src/*.test.ts file only: no source edits, no fix commit. Job B grades it fix-free: the test passes on the current code and fails with the function body stubbed. The running scanner chain is unchanged. A box dry-run on PeaceSTOCKS 0ab37c8 (Workspace main 1e8448a, live 30-rule approved list, Node 22) built exactly one candidate (public-test-case-existing-v6); a local Job B run graded it COUNTS (the new test passes on the current code and fails with tickerIndexDatedEnabled stubbed); suite 613/613 with all fifteen new tests of this batch, all 4 typechecks ok. Disjoint file: each task in this batch creates its own new test file. Expected COUNTS.)",
  // #485
  "tickerIndexDatedFullEnabled is tested with {} and \"true\"; TICKER_INDEX_DATED alone (does not enable FULL), \"1\", \"True\" and both flags true are untested; this pins them. Production safety: test-only: one new src/*.test.ts file only: no source edits, no fix commit. Job B grades it fix-free: the test passes on the current code and fails with the function body stubbed. The running scanner chain is unchanged. A box dry-run on PeaceSTOCKS 0ab37c8 (Workspace main 1e8448a, live 30-rule approved list, Node 22) built exactly one candidate (public-test-case-existing-v6); a local Job B run graded it COUNTS (the new test passes on the current code and fails with tickerIndexDatedFullEnabled stubbed); suite 613/613 with all fifteen new tests of this batch, all 4 typechecks ok. Disjoint file: each task in this batch creates its own new test file. Expected COUNTS.)",
  // #486
  "The ten-minute chain stopped on R2_PUT_500 (run 39451888891) and R2_GET_500 (run 39467160610) because R2ObjectClient.request never retries; this is the status test the future retry uses: 5xx and 429 retry, every other status does not. Production safety: one new pure function in a new module plus one new src/*.test.ts file only: nothing imports it yet, so the running scanner, the scan and the ten-minute chain are unchanged. Wiring it in is a separate task that needs a skill PeaceAI does not have yet (see batch-v4/scanner/DIAGNOSIS.md). Job B grades it against itself: the new test passes with the function and fails with the source put back. A box dry-run on PeaceSTOCKS 0ab37c8 (Workspace main 1e8448a, live 30-rule approved list, Node 20) built exactly one candidate (public-add-function-v2); a local Job B run graded it COUNTS (the new test passes with the function and fails with its body stubbed); suite 599/599, all 4 typechecks ok. Disjoint file: each task in this batch creates its own new module and test file. Expected COUNTS.)",
  // #487
  "The future R2 retry needs a wait that grows per attempt and never exceeds 30 s, so one retry cannot stall a scan; this pins that delay. Production safety: one new pure function in a new module plus one new src/*.test.ts file only: nothing imports it yet, so the running scanner, the scan and the ten-minute chain are unchanged. Wiring it in is a separate task that needs a skill PeaceAI does not have yet (see batch-v4/scanner/DIAGNOSIS.md). Job B grades it against itself: the new test passes with the function and fails with the source put back. A box dry-run on PeaceSTOCKS 0ab37c8 (Workspace main 1e8448a, live 30-rule approved list, Node 20) built exactly one candidate (public-add-function-v2); a local Job B run graded it COUNTS (the new test passes with the function and fails with its body stubbed); suite 599/599, all 4 typechecks ok. Disjoint file: each task in this batch creates its own new module and test file. Expected COUNTS.)",
  // #488
  "Every scheduled scan since 2026-10-14 ends with only MARKETS_SCHEDULER_HOST_FAILED:fetch failed because src/host.ts main().catch drops error.cause; this is the line the host will print once wired, with the cause code (never a URL) appended when there is one. Production safety: one new pure function in a new module plus one new src/*.test.ts file only: nothing imports it yet, so the running scanner, the scan and the ten-minute chain are unchanged. Wiring it in is a separate task that needs a skill PeaceAI does not have yet (see batch-v4/scanner/DIAGNOSIS.md). Job B grades it against itself: the new test passes with the function and fails with the source put back. A box dry-run on PeaceSTOCKS 0ab37c8 (Workspace main 1e8448a, live 30-rule approved list, Node 20) built exactly one candidate (public-add-function-v2); a local Job B run graded it COUNTS (the new test passes with the function and fails with its body stubbed); suite 599/599, all 4 typechecks ok. Disjoint file: each task in this batch creates its own new module and test file. Expected COUNTS.)",
  // #501
  "The ten-minute chain stopped on R2_PUT_500 (run 39451888891) and R2_GET_500 (run 39467160610) because R2ObjectClient.request never retries; this is the status check the future retry will use. This issue states only the wanted behavior and example cases; PeaceAI has to work out the implementation itself. Production safety: one new function in a new module plus one new test file under src/ only. Nothing imports it yet, so the running scanner, the scan and the ten-minute chain are unchanged. Wiring it in is a separate task (see batch-v4/scanner/DIAGNOSIS.md).",
  // #502
  "The future R2 retry needs a wait that grows per attempt and never exceeds 30 seconds, so one retry cannot stall a scan. This issue states only the wanted behavior and example cases; PeaceAI has to work out the implementation itself. Production safety: one new function in a new module plus one new test file under src/ only. Nothing imports it yet, so the running scanner, the scan and the ten-minute chain are unchanged. Wiring it in is a separate task (see batch-v4/scanner/DIAGNOSIS.md).",
]);
const CREDIT_TRAILING: ReadonlySet<string> = new Set(CREDIT_TRAILING_ALLOWLIST);
