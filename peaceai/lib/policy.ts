import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

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
 *  1. no `source:builder` label (compared trimmed and case-insensitive), and no raw HTML anywhere, fences
 *     included (hasRawHtml: `<` then a letter, `/`, `!` or `?`, in the raw or normalized body);
 *  2. after HTML-entity decoding and normalization (zero-width characters removed, NFKC, unicode hyphens -> "-")
 *     and after stripping HTML comments, fenced and indented code, blockquote lines and the Examples block, the
 *     body has exactly ONE credit line (a top-level line starting `Context ...:`, or the older
 *     `(Builder pre-file, ...):` form), and that line's VISIBLE text (visibleCreditText: no link or image
 *     destinations, titles or alt text, no HTML tags or attributes, no struck-through, code or quoted spans)
 *     carries `(source: peace)` closing the credit clause, and the WHOLE line equals one of the 80 genuine credit
 *     lines (CREDIT_LINE_ALLOWLIST) or matches the new-task template NEW_TASK_CREDIT_LINE (creditLineAllowed);
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
 * Raw HTML fails closed (Auditor, rounds 4-5): any `<` followed by a letter, `/`, `!` or `?` ANYWHERE in the body,
 * code fences included, makes the task builder. Fences are not exempt because what GitHub treats as a fence is
 * subtle (a line "```a`" is no fence, since its info string holds a backtick, so a following `<div class="` opens
 * an HTML block that swallows the credit line). That covers every tag, also one split over several lines,
 * comments, `<?...?>`, `<![CDATA[...]]>` and `<!DOCTYPE ...>`. Write `&lt;` for a literal `<`. None of the 80
 * genuine bodies, or any of their revisions, contains one (or a ``` fence).
 */
const RAW_HTML_START = /<[A-Za-z/!?]/;
export function hasRawHtml(text: string): boolean {
  return RAW_HTML_START.test(text);
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
 * marker (`~~`, `)`, `'`, `*`, `]`, `>`) is not. The whole line is allowlisted on top (creditLineAllowed).
 */
const VISIBLE_PEACE_MARK = /\(\s*source\s*:\s*peace\s*\)(?=\s*$|\.(?:\s|$))/i;

/**
 * The credit line is a WHOLE-LINE match (Auditor, round 5). The single credit line (entity-decoded and normalized,
 * raw markup kept, trailing whitespace ignored) must either equal one of the 80 genuine credit lines exactly
 * (CREDIT_LINE_ALLOWLIST) or match the strict new-task template NEW_TASK_CREDIT_LINE. Nothing else on the line is
 * allowed, before or after the mark ("Context (...): Actually Builder drafted it. Peace's task (source: peace)" is
 * builder).
 *
 * The parenthetical is a fixed grammar (Auditor, after #544): `Builder pre-file, KIND` (KIND an upper-case family
 * name such as ADD_FUNCTION), then optionally `, public-...-vN` (a derive template name, optionally followed by
 * ` template join`), then optionally `, behavior only`. For example
 * `Context (Builder pre-file, ADD_FUNCTION, public-add-function-v2, behavior only): Peace's task (source: peace).`
 * Free text in the parentheses (`Context (Builder drafted this, not Peace): ...`) no longer matches. The two name
 * slots are words, so CREDIT_SLOT_DENY also refuses a KIND or template name that spells a contradiction
 * (`NOT_PEACE`, `public-builder-drafted-v1`).
 */
export const NEW_TASK_CREDIT_LINE =
  /^Context \(Builder pre-file, ([A-Z][A-Z_]*)(?:, (public-[a-z0-9]+(?:-[a-z0-9]+)*-v[0-9]+)(?: template join)?)?(?:, behavior only)?\): Peace's task \(source: peace\)\.?$/;
/**
 * Words that may not appear in the KIND or template-name slot of NEW_TASK_CREDIT_LINE (case-insensitive): longer
 * words anywhere in the slot, short ones as a whole `_`/`-`-separated part. No genuine family or template name
 * contains any of them.
 */
export const CREDIT_SLOT_DENY =
  /builder|team|peace|draft|pick|chose|chosen|select|credit|source|idea|auditor|architect|agent|grok|withdr|nobody|someone|fake|(?:^|[-_])(?:not|non|no|never|us|we|bot|ours)(?=$|[-_])/i;
export function creditLineAllowed(creditLine: string): boolean {
  const line = creditLine.trimEnd();
  if (CREDIT_LINES.has(line)) return true;
  const m = NEW_TASK_CREDIT_LINE.exec(line);
  return m !== null && !CREDIT_SLOT_DENY.test(m[1]!) && (m[2] === undefined || !CREDIT_SLOT_DENY.test(m[2]));
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
  return lines.length === 1 && creditLineAllowed(lines[0]!) ? "peace" : "builder";
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
 * The 80 genuine Peace credit lines (#353-#359, #370-#374, #390-#397, #399-#403, #415-#425, #427-#437, #443-#455,
 * #471-#488, #501, #502), whole, as GitHub serves them (entity-decoded, normalized), one `{issue, line}` row each
 * in `peaceai/lib/credit-line-allowlist.json` (PROTECTED_SELF). Pinned and add-only: the file's sha256 must equal
 * CREDIT_LINE_ALLOWLIST_SHA256 at run time, and every row must be well formed; a mismatch, or one malformed row,
 * allows nothing (fail closed). The m119 test pins the same sha256 and the 80 genuine rows. New tasks use
 * NEW_TASK_CREDIT_LINE instead of growing the list.
 */
export const CREDIT_LINE_ALLOWLIST_SHA256 = "687e9b04ab7b18ca0f1fecae2955cb604c112b2965e806839ececcd348d05263";
export function parseCreditLineAllowlist(text: string, pinnedSha256: string = CREDIT_LINE_ALLOWLIST_SHA256): string[] {
  if (typeof text !== "string" || createHash("sha256").update(text, "utf8").digest("hex") !== pinnedSha256) return [];
  try {
    const rows: unknown = JSON.parse(text);
    if (!Array.isArray(rows) || rows.length === 0) return [];
    const lines: string[] = [];
    for (const r of rows) {
      const row = r as { issue?: unknown; line?: unknown } | null;
      if (!row || typeof row !== "object" || Object.keys(row).length !== 2 || !Number.isInteger(row.issue) || typeof row.line !== "string" || row.line === "" || row.line !== row.line.trimEnd()) return [];
      lines.push(row.line);
    }
    return lines;
  } catch {
    return [];
  }
}
function loadCreditLineAllowlist(): string[] {
  try {
    return parseCreditLineAllowlist(readFileSync(new URL("./credit-line-allowlist.json", import.meta.url), "utf8"));
  } catch {
    return [];
  }
}
export const CREDIT_LINE_ALLOWLIST: readonly string[] = Object.freeze(loadCreditLineAllowlist());
const CREDIT_LINES: ReadonlySet<string> = new Set(CREDIT_LINE_ALLOWLIST);
