// M119 credit-truth fix (Auditor, 2026-10-26): the task source follows provenance, not the filer account.
// Before this, select.ts read only the `source:builder` label, so every PeaceG03-filed peace-task without it
// (team-picked #513-#516, #540, #541 among them) was recorded as source=peace in task.json.
// Round 2 (Auditor NOT PASS at 64748343): peace is an allow-match on the one credit line only, after
// normalization and stripping; every case Auditor listed has its own test below.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { SOURCE_PEACE } from "../../builder-log/coverage.ts";
import {
  BUILDER_LABEL, bodyAddOnlySinceLabel, bodyAtFirstLabel, CREDIT_KINDS, CREDIT_KINDS_HISTORICAL, CREDIT_LINE_ALLOWLIST, CREDIT_LINE_ALLOWLIST_SHA256, CREDIT_SLOT_DENY, CREDIT_TEMPLATES, creditLineAllowed, creditTemplatesFrom, loadCreditKinds, parseRuleKinds, NEW_TASK_CREDIT_LINE, parseCreditLineAllowlist, bodySha256, contextCreditLines, creditUnchangedSinceLabel, creditLineVisible, decodeEntities,
  hasRawHtml, hasUnknownEntity, normalizeProvenance, recordedTaskSource, SOURCE_PEACE_MARK, stripNonCredit, taskSource,
  TEAM_PICKED_MARK, visibleCreditText,
} from "../lib/policy.ts";
import { buildRecords, taskSourceOf } from "../lib/records.ts";

// Credit lines quoted from the real issue bodies (public PeaceAI-Workspace issues).
const CTX_540 =
  "Context (Builder pre-file, ADD_FUNCTION over a list, public-derive-from-behavior-v4, behavior only): Team-picked task " +
  "(Builder-drafted; not credited as source: peace unless Peace says so in his own words); the behavior follows Peace's own " +
  "answers quoted above. Slice 2 of Peace's scanner self-health-check system.";
const CTX_513 =
  "Context (Builder pre-file, behavior only): Peace's task (source: peace). Slice 1 of Peace's scanner self-health-check " +
  "system. On 2026-10-25 Peace asked the team to pick a real task itself (\"I don't can't you guys think of one?\"), and " +
  "this is the one picked.";
const BUILDER_LOG_TEAM = "Team-picked task PeaceAI-Workspace#513 (source: team-picked at Peace's request; spec and examples written by Builder)";
// Round 5: the credit line must be one of the 80 genuine whole lines (or the new-task template), so the fixtures
// use the real lines.
const GENUINE_ROWS = JSON.parse(readFileSync("peaceai/lib/credit-line-allowlist.json", "utf8")) as { issue: number; line: string }[];
const lineOf = (n: number): string => GENUINE_ROWS.find((r) => r.issue === n)!.line;
const CTX_GENUINE = lineOf(501); // "Context (Builder pre-file, ADD_FUNCTION, ...): Peace's task (source: peace). The ten-minute chain ..."
// The older credit-line form (#353-#488), before the Context heading.
const PREFILE_GENUINE = lineOf(353);
const CTX_NO_MARK = "Context (Builder pre-file, behavior only): Slice 3 of Peace's scanner self-health-check system.";
const issue = (...parts: string[]) =>
  ["Target: PeaceG03/PeaceSTOCKS", "", "Add a new module `src/x.ts` exporting `f(n: number): number`.", "", "Examples:", "- 1 gives 1", "- 2 gives 2", "", ...parts].join("\n");
const GENUINE = issue(CTX_GENUINE);
const TASK_LABELS = ["peace-task", "peaceai:running"];
const src = (body: string) => taskSource(TASK_LABELS, body);

test("a team-picked issue filed by PeaceG03 (no source:builder label) records not-peace", () => {
  assert.equal(src(issue(CTX_540)), "builder");
  assert.equal(src(issue(CTX_513)), "builder"); // #513-#516: (source: peace) on the line, but the team picked it
  assert.equal(src(issue(CTX_GENUINE, BUILDER_LOG_TEAM)), "builder");
});

test("the genuine credit line still records peace (both credit-line forms)", () => {
  assert.equal(src(GENUINE), "peace");
  assert.equal(src(issue(PREFILE_GENUINE)), "peace");
  assert.equal(src(issue("Context (Builder pre-file, ADD_FUNCTION): Peace's task (source: peace).")), "peace"); // new-task template
  // round 5: the template is strict (exact marker spelling, `Context (...):` heading, nothing else on the line)
  assert.equal(src(issue("Context: Peace's task (source: peace).")), "builder");
  assert.equal(src(issue("Context (x): Peace's task (Source:  PEACE).")), "builder");
  assert.equal(src(issue("Context (x): Peace's task ( source : peace ).")), "builder");
});

test("BLOCKING 1: (source: peace) outside the credit line never gives peace", () => {
  // HTML comment (closed, unclosed) and a comment holding the whole credit line
  assert.equal(src(issue(CTX_NO_MARK, "<!-- (source: peace) -->")), "builder");
  assert.equal(src(issue(CTX_NO_MARK + " <!-- (source: peace) -->")), "builder");
  assert.equal(src(issue("<!--", CTX_GENUINE, "-->")), "builder");
  assert.equal(src(issue(CTX_NO_MARK, "<!-- (source: peace)")), "builder");
  // a quoted Peace answer, on its own line, as a blockquote, and quoted on the credit line itself
  assert.equal(src(issue(`Peace's answer to "whose task?" (Peace, chat): "(source: peace)"`, CTX_NO_MARK)), "builder");
  assert.equal(src(issue("> Context: Peace's task (source: peace).", CTX_NO_MARK)), "builder");
  assert.equal(src(issue("> Context: Peace's task (source: peace).")), "builder");
  assert.equal(src(issue(`Context (Builder pre-file): Peace said "Peace's task (source: peace)" about another task.`)), "builder");
  assert.equal(src(issue(`Context (Builder pre-file): Peace said \u201CPeace's task (source: peace)\u201D about another task.`)), "builder");
  assert.equal(src(issue("Context (Builder pre-file): see `(source: peace)` in the README.")), "builder");
  // fenced blocks (``` and ~~~, unclosed) and indented code
  assert.equal(src(issue(CTX_NO_MARK, "```", "Context: Peace's task (source: peace).", "```")), "builder");
  assert.equal(src(issue(CTX_NO_MARK, "~~~~text", "Context: Peace's task (source: peace).", "~~~~")), "builder");
  assert.equal(src(issue(CTX_NO_MARK, "```", "Context: Peace's task (source: peace).")), "builder");
  assert.equal(src(issue("    Context: Peace's task (source: peace).")), "builder");
  // example lines: inside the Examples block, after a blank line in it, and as a list item elsewhere
  assert.equal(src(["Examples:", "- f(1) gives (source: peace)", "Context: Peace's task (source: peace)."].join("\n").replace("Context", "- Context")), "builder");
  assert.equal(src(["Target: x", "", "Examples:", "- 1 gives 1", "", "- Context: Peace's task (source: peace).", "", CTX_NO_MARK].join("\n")), "builder");
  assert.equal(src(issue(CTX_NO_MARK, "Example: Context: Peace's task (source: peace).")), "builder");
  assert.equal(src(issue(CTX_NO_MARK, "- Context: Peace's task (source: peace).")), "builder");
  // anywhere else in the body, or with no credit line at all
  assert.equal(src(issue(CTX_NO_MARK, "Peace's task (source: peace).")), "builder");
  assert.equal(src("Peace's task (source: peace): guard something real"), "builder");
  // two credit lines are ambiguous
  assert.equal(src(issue(CTX_GENUINE, CTX_GENUINE)), "builder");
  assert.equal(src(issue(CTX_GENUINE, PREFILE_GENUINE)), "builder");
});

test("BLOCKING 2: team wording that was missing from the old deny-list gives builder", () => {
  const cases = [
    "Builder-picked task",
    "Builder picked this one",
    "chosen by the team",
    "Chosen by Builder",
    "Peace asked us to pick one",
    "Peace asked the agents to choose one",
    "Team\u2011picked task", // U+2011 non-breaking hyphen
    "Team\u2010picked task", // U+2010 hyphen
    "Team\u2013picked task", // en dash
    "Team\u2212picked task", // minus sign
    "Team\u00ADpicked task", // soft hyphen (zero-width) gives "Teampicked"
    "Team\u200Bpicked task", // zero-width space
    "Teampicked task",
    "TEAM PICKED task",
    "the team picked it",
    "we picked it",
    "selected by the team",
    "not credited as Peace's",
  ];
  for (const c of cases) {
    assert.equal(src(issue(`Context (Builder pre-file): Peace's task (source: peace). ${c}.`)), "builder", c);
    assert.equal(src(issue(CTX_GENUINE, `Note: ${c}.`)), "builder", `elsewhere: ${c}`);
  }
});

test("BLOCKING 3: any non-peace (source ...: clause anywhere means builder", () => {
  const contrary = [
    "(source : builder)",
    "( source: builder)",
    "(  Source  :builder)",
    "(sou\u200Brce: builder)", // zero-width space inside 'source'
    "(sour\u200Dce: builder)", // zero-width joiner
    "(\uFEFFsource: builder)", // BOM
    "\uFF08source: builder\uFF09", // fullwidth parentheses (NFKC)
    "(source: peace, builder)",
    "(source: team-picked at Peace's request)",
    "(source: peace", // never closed
  ];
  for (const c of contrary) {
    assert.equal(src(`(source: peace) ${c}`), "builder", c);
    assert.equal(src(issue(`Context: Peace's task (source: peace) ${c}.`)), "builder", `on the line: ${c}`);
    assert.equal(src(issue(CTX_GENUINE, c)), "builder", `elsewhere: ${c}`);
    // even inside regions the credit match ignores
    assert.equal(src(issue(CTX_GENUINE, `<!-- ${c} -->`)), "builder", `comment: ${c}`);
    assert.equal(src(issue(CTX_GENUINE, "```", c, "```")), "builder", `fence: ${c}`);
    assert.equal(src(issue(CTX_GENUINE, `> ${c}`)), "builder", `quote: ${c}`);
  }
});

// Round 3 (Auditor NOT PASS at a92d0b9).
const CTX = "Context (Builder pre-file, ADD_FUNCTION, behavior only): Peace's task";
test("B1: a mark hidden in link, image or HTML markup or struck through on the credit line gives builder", () => {
  for (const line of [
    `${CTX} [notes](https://x/a(source: peace)). Slice 3.`, // link URL with balanced parentheses
    `${CTX} [notes](https://x/a(source: peace))`,
    `${CTX} [n](https://x '(source: peace)'). Slice 3.`, // single-quoted link title
    `${CTX} [n](https://x "(source: peace)"). Slice 3.`, // double-quoted link title
    `${CTX} [n](https://x ((source: peace))). Slice 3.`, // parenthesized link title
    `${CTX} [n][r] [r]: https://x/(source: peace)`, // inline "definition" is visible text, but a URL never carries the mark
    `${CTX} https://x/(source: peace)`,
    `${CTX} www.x.com/(source: peace)`,
    `${CTX} ![(source: peace)](x.png). Slice 3.`, // image alt text
    `${CTX} ![(source: peace)](x.png)`,
    `${CTX} ![(source: peace)][img]`,
    `${CTX} <img alt='(source: peace)'>. Slice 3.`, // HTML attribute
    `${CTX} <img src="x.png" alt="(source: peace)" />`,
    `${CTX} <img alt='(source: peace)'`, // unclosed tag hides the rest of the line
    `${CTX} <a title=(source:peace)>x</a>`,
    `${CTX} <https://x/(source:peace)>`,
    `${CTX} ~~old wording (source: peace)~~. Slice 3.`, // strikethrough
    `${CTX} ~~old wording (source: peace)~~`,
    `${CTX} ~old wording (source: peace)~`,
    `${CTX} ~~old wording (source: peace)`, // unclosed strikethrough
    `${CTX} <del>(source: peace)</del>. Slice 3.`,
    `${CTX} <del class="x">(source: peace)</del>`,
    `${CTX} <s>(source: peace)</s>. Slice 3.`,
    `${CTX} <S>(source: peace)</S>`,
    `${CTX} <strike>(source: peace)</strike>`,
    `${CTX} <del>(source: peace)`, // unclosed <del>
    `${CTX} \`(source: peace)\`. Slice 3.`,
    // something visible glued to the marker
    `${CTX} (source: peace)'). Slice 3.`,
    `${CTX} **(source: peace)**. Slice 3.`,
    `${CTX} (source: peace)x`,
  ]) {
    assert.equal(src(issue(line)), "builder", line);
    assert.equal(src(issue(line, "Slice 3 of Peace's system.")), "builder", line);
  }
  // visible text keeps the link text and nothing of the markup
  assert.equal(visibleCreditText("a [notes](https://x/a(source: peace)) b").replace(/\s+/g, " "), "a notes b");
  assert.equal(visibleCreditText("a ![(source: peace)](x.png) <img alt='(source: peace)'> b").replace(/\s+/g, " "), "a b");
  assert.equal(visibleCreditText("a ~~x (source: peace)~~ <del>y</del> <s>z</s> b").replace(/\s+/g, " "), "a b");
  // the genuine forms still give peace: end of line, sentence end, a visible link elsewhere on the line
  for (const line of [`${CTX} (source: peace)`, `${CTX} (source: peace).`, `${CTX} (source: peace) `])
    assert.equal(src(issue(line)), "peace", line);
});

test("B2: entity-encoded contrary clauses and hidden entities give builder", () => {
  for (const extra of [
    "&#40;source: builder&#41;", "&lpar;source: builder&rpar;", "&#x28;source&colon; builder&#x29;", "&#40source: builder&#41",
    "(&#115;ource: builder)", "(source&#58; builder)", "(sou&#8203;rce: builder)", "Team&#8209;picked task", "Team&hyphen;picked",
    "&lpar;source: team-picked&rpar;",
  ]) {
    assert.equal(src(issue(CTX_GENUINE, extra)), "builder", extra);
    assert.equal(src(issue(`${CTX_GENUINE} ${extra}`)), "builder", extra);
  }
  // an entity this decoder does not know could spell a letter (&sopf; renders as a double-struck s)
  assert.equal(hasUnknownEntity("(&sopf;ource: builder)"), true);
  assert.equal(src(issue(CTX_GENUINE, "(&sopf;ource: builder)")), "builder");
  // an encoded marker on the credit line is what GitHub renders, so it is the visible marker
  assert.equal(src(issue(`${CTX} &#40;source: peace&#41;.`)), "peace");
  assert.equal(src(issue(`${CTX} &lpar;source&colon; peace&rpar;`)), "peace");
  // a semicolon-less reference is literal text when rendered: it is no credit, but it is a contrary clause
  assert.equal(src(issue(`${CTX} &#40source: peace). Slice 3.`)), "builder");
  assert.equal(decodeEntities("&#40;&lpar;&#x29;&rpar;&amp;lpar;&nosuch;"), "(())&lpar;&nosuch;");
  assert.equal(decodeEntities("&#40x", true), "(x");
  assert.equal(creditLineVisible(issue(`${CTX} &#40;source: peace&#41;.`)), `${CTX} (source: peace).`);
});

// Round 4 (Auditor NOT PASS at 40aaddb): allowlists instead of deny-lists.
test("R4.1/R5.1: raw HTML anywhere, code fences included, gives builder", () => {
  for (const extra of [
    '<a href="https://x"\n  title="(source: builder)">notes</a>', // multi-line <a href=...>
    "<img\n  alt='(source: peace)'\n  src=x.png>", // multi-line <img alt=...>
    "<?xml version=\"1.0\"?>",
    "<![CDATA[(source: builder)]]>",
    "<!DOCTYPE html>",
    "<!-- note -->",
    "</div>",
    "<br>",
    "<details><summary>more</summary>x</details>",
    "a<b",
    "<A HREF=x>y</A>",
    "<\u200Bimg alt=x>", // a zero-width character between < and the tag name
  ]) {
    assert.equal(src(issue(CTX_GENUINE, extra)), "builder", extra);
    assert.equal(src(issue(extra, CTX_GENUINE)), "builder", extra);
  }
  // inside fences too: what GitHub treats as a fence is subtle, so nothing is exempt
  for (const fenced of [["```html", "<img alt=x>", "```"], ["~~~", "</div>", "~~~"], ["```", "<b>"], ["    <b>"]]) {
    assert.equal(hasRawHtml(issue(CTX_GENUINE, ...fenced)), true, fenced.join("|"));
    assert.equal(src(issue(CTX_GENUINE, ...fenced)), "builder", fenced.join("|"));
  }
  // the round-5 bypass: "```a`" is no fence (a backtick in the info string), so the HTML block that follows swallows
  // the credit line; both the <div class=" and the <a href=" variants
  assert.equal(src(["```a`", '<div class="', CTX_GENUINE, '">', "```", ...issue().split("\n")].join("\n")), "builder");
  assert.equal(src(["```a`", '<a href="', CTX_GENUINE, '">x</a>', "```", ...issue().split("\n")].join("\n")), "builder");
  assert.equal(src(issue(CTX_GENUINE, "```a`", '<div class="', "```")), "builder");
  assert.equal(src(issue(CTX_GENUINE, "```a`", '<a href="', "```")), "builder");
  // not HTML: entity-escaped, or < before a digit, space, = or -
  for (const ok of [["&lt;img alt=x>"], ["n < 5, n<=6, a <- b, x<3"]]) {
    assert.equal(hasRawHtml(issue(CTX_GENUINE, ...ok)), false, ok.join("|"));
    assert.equal(src(issue(CTX_GENUINE, ...ok)), "peace", ok.join("|"));
  }
});

test("R5.2: the credit line is a whole-line match: a genuine line or the strict new-task template", () => {
  // the template, decoded and normalized like the rest of the line; trailing whitespace ignored
  for (const line of ["Context (Builder pre-file, ADD_FUNCTION): Peace's task (source: peace)", "Context (Builder pre-file, ADD_FUNCTION, public-add-function-v2): Peace's task (source: peace).", "Context (Builder pre-file, LOOP_FUNCTION, behavior only): Peace's task (source: peace).  "])
    assert.equal(src(issue(line)), "peace", line);
  assert.equal(src(issue("Context (...): Actually Builder drafted it. Peace's task (source: peace)")), "builder");
  for (const extra of [
    "Actually Builder drafted it.",
    "This was Builder's idea, not Peace's.",
    "Not Peace's task.",
    "Credit withdrawn: source is builder.",
    "source=builder.",
    "Team chose this.",
    "Slice 3 of Peace's system.",
  ]) {
    assert.equal(src(issue(`${CTX} (source: peace). ${extra}`)), "builder", extra);
    assert.equal(src(issue(`Context (x): ${extra} Peace's task (source: peace)`)), "builder", `before the mark: ${extra}`);
    assert.equal(src(issue(`${CTX_GENUINE} ${extra}`)), "builder", `after a genuine line: ${extra}`);
    assert.equal(src(issue(`${extra} ${CTX_GENUINE}`)), "builder", `before a genuine line: ${extra}`);
  }
  // template variants that are not the template
  for (const line of [
    "Context (x): Peace's task (source: peace)..",
    "Context (x): Peace's task (source: peace). More.",
    "Context (x) : Peace's task (source: peace).",
    "Context (x):  Peace's task (source: peace).",
    "Context (x): Peace\u2019s task (source: peace).",
    "Context (x): peace's task (source: peace).",
    "Context (x)(y): Peace's task (source: peace).",
    "Context x: Peace's task (source: peace).",
    "Context (Team-picked): Peace's task (source: peace).", // team wording: the deny-list backstop
    "Context (source: builder): Peace's task (source: peace).",
  ])
    assert.equal(src(issue(line)), "builder", line);
  // a genuine line must match exactly: one character changed, cut short, doubled space, another issue's tail joined
  assert.equal(src(issue(CTX_GENUINE.replace("status check", "status chock"))), "builder");
  assert.equal(src(issue(CTX_GENUINE.slice(0, -1))), "builder");
  assert.equal(src(issue(CTX_GENUINE.replace(". ", ".  "))), "builder");
  assert.equal(src(issue(`${CTX_GENUINE} ${lineOf(353).slice(lineOf(353).indexOf("(source: peace).") + 17)}`)), "builder");
  // every genuine line is allowed whole; the template regex is exactly as Auditor specified
  for (const r of GENUINE_ROWS) assert.equal(creditLineAllowed(r.line), true, String(r.issue));
  assert.equal(NEW_TASK_CREDIT_LINE.source, String.raw`^Context \(Builder pre-file, ([A-Z][A-Z0-9_]*)(?:, (public-[a-z0-9]+(?:-[a-z0-9]+)*-v[0-9]+)(?: template join)?)?(?:, behavior only)?\): Peace's task \(source: peace\)\.?$`);
});

test("M119 follow-up: the template's parenthetical is a fixed grammar; a contradiction inside it gives builder", () => {
  const T = (paren: string) => `Context (${paren}): Peace's task (source: peace).`;
  // every slot combination of the grammar gives peace
  for (const paren of [
    "Builder pre-file, ADD_FUNCTION",
    "Builder pre-file, TEST_CASE_EXISTING, public-test-case-existing-v6",
    "Builder pre-file, DATE_FUNCTION, public-date-function-v1, behavior only",
    "Builder pre-file, DERIVE_FROM_BEHAVIOR, public-derive-from-behavior-v1 template join",
    "Builder pre-file, DERIVE_FROM_BEHAVIOR, public-derive-from-behavior-v2 template join, behavior only",
    "Builder pre-file, IMPORT_EDIT_V2, public-import-edit-v2",
    "Builder pre-file, THROW_GUARD, public-throw-guard-top-v1",
    "Builder pre-file, COMPLEX_FUNCTION, behavior only",
  ])
    assert.equal(src(issue(T(paren))), "peace", paren);
  // the genuine parentheticals in the template form: every KIND and template name of the 80 is accepted
  for (const r of GENUINE_ROWS) {
    const paren = /^(?:Context )?\((Builder pre-file, [^)]*)\):/.exec(r.line)![1]!;
    if (/refile of/.test(paren)) continue; // #489/#490 (refile of #486/#487): free text, allowed only as their genuine lines
    assert.equal(creditLineAllowed(T(paren)), true, `${r.issue}: ${paren}`);
  }
  // contradictions inside the parentheses: free text, or a slot that spells one
  for (const paren of [
    "Builder drafted this, not Peace",
    "Builder pre-file, ADD_FUNCTION, not Peace's",
    "Builder pre-file, ADD_FUNCTION, Builder drafted this",
    "Builder pre-file, ADD_FUNCTION, behavior only, not Peace's",
    "Builder pre-file, ADD_FUNCTION, behavior only; Builder's idea",
    "Builder pre-file, NOT_PEACE",
    "Builder pre-file, BUILDER_DRAFTED",
    "Builder pre-file, TEAM_TASK",
    "Builder pre-file, ADD_FUNCTION, public-builder-drafted-v1",
    "Builder pre-file, ADD_FUNCTION, public-not-peaces-v1",
    "Builder pre-file, ADD_FUNCTION, public-team-picked-v1",
    "Builder pre-file, ADD_FUNCTION, public-credit-withdrawn-v1 template join",
    "Builder pre-file, ADD_FUNCTION, public-add-function-v1, Auditor chose it",
    "Builder pre-file, ADD_FUNCTION, not-peace",
    "Builder pre-file, ADD_FUNCTION, builder-drafted",
    "Builder pre-file, ADD_FUNCTION, public-add-function-v1 not template join",
    "Builder pre-file, ADD_FUNCTION, behavior only, behavior only",
    "Builder pre-file, add_function",
    "Builder pre-file,  ADD_FUNCTION",
    "Builder pre-file, ADD_FUNCTION (Builder's)",
    "Builder pre-file",
    "x",
    "",
  ])
    assert.equal(src(issue(T(paren))), "builder", paren);
  // a contradiction on a SEPARATE line: team-picked wording and contrary (source ...) clauses are caught by the
  // deny-list backstop anywhere in the body ...
  const OK = T("Builder pre-file, ADD_FUNCTION");
  for (const other of [
    "Team-picked task.", "Builder-picked.", "Picked by the team.", "We chose this one.", "Peace asked us to pick.",
    "(source: builder)", "( source: builder)", "&#40;source: builder&#41;",
  ])
    for (const body of [issue(OK, other), issue(other, OK)]) assert.equal(src(body), "builder", other);
  // ... while free prose on another line ("Builder drafted this, not Peace.") is out of scope for the parser: it
  // still reads peace here, and is covered by Auditor's pre-filing review (README, PR #544 scope note).
  assert.equal(src(issue(OK, "Builder drafted this, not Peace.")), "peace");
});

test("M119 follow-up (#546): both name slots are closed sets: KIND from learned.ts RULE_KINDS + the historical families, template = an existing rules/learned/<name>.json", async () => {
  const { RULE_KINDS } = await import("../lib/learned.ts");
  const { readdirSync } = await import("node:fs");
  const T = (paren: string) => `Context (${paren}): Peace's task (source: peace).`;
  // the KIND set is RULE_KINDS (read from learned.ts's source, so it follows any change there) plus exactly the historical four
  assert.deepEqual([...CREDIT_KINDS].sort(), [...RULE_KINDS, "THROW_GUARD", "DATE_FUNCTION", "LOOP_FUNCTION", "TEST_CASE_EXISTING"].sort());
  assert.deepEqual([...CREDIT_KINDS_HISTORICAL], ["THROW_GUARD", "DATE_FUNCTION", "LOOP_FUNCTION", "TEST_CASE_EXISTING"]);
  assert.deepEqual(parseRuleKinds(readFileSync("peaceai/lib/learned.ts", "utf8")), [...RULE_KINDS]);
  // the template set is exactly the rule files on disk that are also in approved.json (Auditor, after #546)
  // a delegated /auditor-approve-rule entry earns no credit, so it is never a template (#626, policy.ts creditTemplatesFrom)
  const approvedRules = JSON.parse(readFileSync("peaceai/rules/approved.json", "utf8")).rules as { id: string; source?: string }[];
  const approvedIds = new Set(approvedRules.filter((r) => r.source !== "auditor-approve-rule").map((r) => r.id));
  for (const r of approvedRules) if (r.source === "auditor-approve-rule") assert.equal(CREDIT_TEMPLATES.has(r.id), false, `${r.id}: delegated, 0 credit`);
  assert.deepEqual([...CREDIT_TEMPLATES].sort(), readdirSync("peaceai/rules/learned").filter((f) => f.startsWith("public-") && f.endsWith(".json")).map((f) => f.slice(0, -5)).filter((id) => approvedIds.has(id)).sort());
  // every RULE_KIND, every historical family and every rule file gives peace in the template
  for (const k of CREDIT_KINDS) assert.equal(src(issue(T(`Builder pre-file, ${k}`))), "peace", k);
  for (const t of CREDIT_TEMPLATES) {
    assert.equal(src(issue(T(`Builder pre-file, ADD_FUNCTION, ${t}`))), "peace", t);
    assert.equal(src(issue(T(`Builder pre-file, ADD_FUNCTION, ${t} template join, behavior only`))), "peace", t);
  }
  // Auditor's examples, a short-word-only KIND, and lookalikes outside the sets give builder
  for (const k of ["UNREQUESTED", "UNASKED_TASK", "DIDNT_ASK", "RETRACTED", "FALSE_CLAIM", "HUMAN_WROTE_IT", "NO_ASK", "ADD_FUNCTIONS", "ADD_FUNCTION_X", "TEST_CASE", "DERIVE"])
    for (const paren of [`Builder pre-file, ${k}`, `Builder pre-file, ${k}, public-add-function-v1`, `Builder pre-file, ${k}, behavior only`])
      assert.equal(src(issue(T(paren))), "builder", paren);
  for (const t of ["public-unasked-v1", "public-didnt-ask-v1", "public-false-claim-v1", "public-add-function-v3", "public-add-function-v10", "public-add-function"])
    for (const paren of [`Builder pre-file, ADD_FUNCTION, ${t}`, `Builder pre-file, ADD_FUNCTION, ${t} template join`])
      assert.equal(src(issue(T(paren))), "builder", paren);
  // a rule file on disk that is not approved is not a template
  for (const t of ["public-existing-function-edit-v1", "public-set-literal-v1", "public-test-case-dateargs-v1"]) {
    assert.ok(readdirSync("peaceai/rules/learned").includes(`${t}.json`) && !approvedIds.has(t), `${t}: on disk, not approved`);
    assert.equal(CREDIT_TEMPLATES.has(t), false, t);
    for (const paren of [`Builder pre-file, ADD_FUNCTION, ${t}`, `Builder pre-file, ADD_FUNCTION, ${t} template join, behavior only`])
      assert.equal(src(issue(T(paren))), "builder", paren);
  }
  // creditTemplatesFrom: on disk AND approved; an approved id with no file is not a template; a malformed list approves nothing
  const okList = (ids: unknown[]) => JSON.stringify({ schema: "peaceai-approved-rules:v1", rules: ids.map((id) => ({ id, sha256: "x" })) });
  assert.deepEqual([...creditTemplatesFrom(["public-a-v1.json", "public-b-v1.json", "core-c-v1.json", "public-d-v1.txt"], okList(["public-a-v1", "public-e-v1", "core-c-v1"]))], ["public-a-v1"]);
  for (const bad of [null, "", "not json", "[]", "{}", JSON.stringify({ schema: "other", rules: [{ id: "public-a-v1" }] }), JSON.stringify({ schema: "peaceai-approved-rules:v1", rules: {} }), okList(["public-a-v1", 7]), okList(["public-a-v1", null])])
    assert.equal(creditTemplatesFrom(["public-a-v1.json"], bad).size, 0, String(bad));
  // the deny list is still a backstop on both slots, independently of the sets
  for (const w of ["NO_ASK", "NOT_PEACE", "BUILDER_DRAFTED", "public-team-picked-v1", "public-not-peaces-v1"]) assert.equal(CREDIT_SLOT_DENY.test(w), true, w);
  for (const k of CREDIT_KINDS) assert.equal(CREDIT_SLOT_DENY.test(k), false, k);
  for (const t of CREDIT_TEMPLATES) assert.equal(CREDIT_SLOT_DENY.test(t), false, t);
  // the RULE_KINDS parse fails closed: no declaration, two declarations, or a malformed entry gives no kinds at all
  const decl = 'export const RULE_KINDS = ["SET_LITERAL", "ADD_FUNCTION"] as const;';
  assert.deepEqual(parseRuleKinds(decl), ["SET_LITERAL", "ADD_FUNCTION"]);
  for (const bad of ["", "const X = 1;", `${decl}\n${decl}`, 'export const RULE_KINDS = ["SET_LITERAL", ...MORE] as const;', 'export const RULE_KINDS = ["SET_LITERAL", "add_function"] as const;', 'export const RULE_KINDS = [] as const;', 'export const RULE_KINDS = ["A","B"] as const;'])
    assert.deepEqual(parseRuleKinds(bad), [], bad);
  // a failed RULE_KINDS parse at load time falls back ONLY to the 4 historical kinds (Auditor, after #546)
  const HIST4 = ["DATE_FUNCTION", "LOOP_FUNCTION", "TEST_CASE_EXISTING", "THROW_GUARD"];
  for (const bad of ["", "const X = 1;", `${decl}\n${decl}`, 'export const RULE_KINDS = ["SET_LITERAL", "add_function"] as const;'])
    assert.deepEqual([...loadCreditKinds(() => bad)].sort(), HIST4, bad);
  assert.deepEqual([...loadCreditKinds(() => { throw new Error("ENOENT: learned.ts"); })].sort(), HIST4);
  assert.deepEqual([...loadCreditKinds(() => decl)].sort(), [...HIST4, "ADD_FUNCTION", "SET_LITERAL"].sort());
  assert.deepEqual([...loadCreditKinds()].sort(), [...CREDIT_KINDS].sort()); // the default reader is what loaded CREDIT_KINDS
  // re-verified: every genuine KIND and template is in the sets, and all 80 genuine lines stay peace
  for (const r of GENUINE_ROWS) {
    const m = /\(Builder pre-file, ([A-Z][A-Z0-9_]*), (public-[a-z0-9-]+)\):/.exec(r.line);
    if (m) {
      assert.ok(CREDIT_KINDS.has(m[1]!), `${r.issue}: ${m[1]}`);
      assert.ok(CREDIT_TEMPLATES.has(m[2]!), `${r.issue}: ${m[2]}`);
    } else assert.match(r.line, /refile of #48[67]/, String(r.issue));
    assert.equal(src(issue(r.line)), "peace", String(r.issue));
  }
});

test("R5.2/R5.3: the whole-line allowlist is pinned, add-only and protected; one bad row or a sha mismatch allows nothing", async () => {
  const { createHash } = await import("node:crypto");
  const { protectedReason } = await import("../lib/selfchange.ts");
  const FILE = "peaceai/lib/credit-line-allowlist.json";
  const text = readFileSync(FILE, "utf8");
  const sha = (t: string) => createHash("sha256").update(t, "utf8").digest("hex");
  assert.equal(sha(text), "687e9b04ab7b18ca0f1fecae2955cb604c112b2965e806839ececcd348d05263");
  assert.equal(CREDIT_LINE_ALLOWLIST_SHA256, sha(text)); // the runtime pin in policy.ts
  // add-only: the 80 genuine rows stay first and unchanged
  assert.deepEqual(GENUINE_ROWS.slice(0, 80).map((r) => r.issue), [
    ...[353, 354, 355, 356, 357, 358, 359, 370, 371, 372, 373, 374], ...Array.from({ length: 8 }, (_, i) => 390 + i), 399, 400, 401, 402, 403,
    ...Array.from({ length: 11 }, (_, i) => 415 + i), ...Array.from({ length: 11 }, (_, i) => 427 + i), ...Array.from({ length: 13 }, (_, i) => 443 + i),
    ...Array.from({ length: 18 }, (_, i) => 471 + i), 501, 502,
  ]);
  assert.equal(sha(JSON.stringify(GENUINE_ROWS.slice(0, 80))), "831d046312c416eb29a530f474d7510c0882aff2107637ba522a1b369887b70e");
  assert.equal(CREDIT_LINE_ALLOWLIST.length, 80);
  assert.equal(new Set(CREDIT_LINE_ALLOWLIST).size, 80);
  assert.ok(Object.isFrozen(CREDIT_LINE_ALLOWLIST));
  assert.ok(protectedReason(FILE), FILE);
  assert.ok(protectedReason("peaceai/lib/policy.ts"));
  // runtime sha256 check: the pinned file parses to 80 lines; any other text (even valid rows) allows nothing
  assert.equal(parseCreditLineAllowlist(text).length, 80);
  const appended = text.replace(/\n\]\n$/, ',\n  {"issue":999,"line":"Context (x): anything (source: peace)."}\n]\n');
  assert.deepEqual(parseCreditLineAllowlist(appended), []);
  assert.equal(parseCreditLineAllowlist(appended, sha(appended)).length, 81); // well formed once re-pinned
  assert.deepEqual(parseCreditLineAllowlist(text, "0".repeat(64)), []);
  // ONE malformed row empties the whole list (with a matching sha, so only the row check can refuse it)
  const rows = JSON.parse(text) as unknown[];
  for (const bad of [{ issue: 999 }, { issue: "999", line: "x" }, { issue: 999, line: "" }, { issue: 999, line: "x " }, { issue: 999, line: 7 }, { issue: 999, line: "x", extra: 1 }, null, "x", 999]) {
    const t = JSON.stringify([...rows.slice(0, 40), bad, ...rows.slice(40)]);
    assert.deepEqual(parseCreditLineAllowlist(t, sha(t)), [], JSON.stringify(bad));
  }
  for (const t of ["", "{}", "[]", "not json"]) assert.deepEqual(parseCreditLineAllowlist(t, sha(t)), [], t);
});

test("the source:builder label check is trimmed and case-insensitive", () => {
  for (const l of [BUILDER_LABEL, "Source:Builder", " source:builder ", "SOURCE:BUILDER\t", "source\u200B:builder"])
    assert.equal(taskSource([...TASK_LABELS, l], GENUINE), "builder", JSON.stringify(l));
  assert.equal(taskSource(TASK_LABELS, GENUINE), "peace");
  assert.equal(taskSource("peace-task" as never, GENUINE), "builder");
});

test("normalization and stripping helpers", () => {
  assert.equal(normalizeProvenance("Team\u2011picked\u200B (sou\u00ADrce\u00A0: x)\r\n"), "Team-picked (source : x)\n");
  assert.equal(stripNonCredit("a\n<!-- b\nc -->d\n```\ne\n```\n> f\nExamples:\n- g\n\n- h\ni"), "a\nd\ni");
  assert.deepEqual(contextCreditLines(normalizeProvenance(GENUINE)).length, 1);
});

test("unclear provenance fails closed to not-peace", () => {
  for (const body of [undefined, null, 42, "", "Add a helper in src/text.ts with focused tests.", "Peace's task source: peace without the clause", issue(CTX_NO_MARK)])
    assert.equal(taskSource(TASK_LABELS, body), "builder", String(body));
});

const LABELED = "2026-10-26T19:38:52Z";
const sha = bodySha256(GENUINE);
const CREATED = "2026-10-26T19:38:51Z";
// An issue labelled right after it was created; GitHub lists userContentEdits newest first, the oldest entry being
// the body as created.
const rev = (editedAt: string, body: string) => ({ editedAt, deletedAt: null, body });
const UNEDITED = { lastEditedAt: null, edits: [], editsComplete: true, taskLabeledAt: [LABELED], builderLabeled: false };
const edited = (...edits: { editedAt: string; deletedAt: string | null; body: string | null }[]) =>
  ({ lastEditedAt: edits[0]!.editedAt, edits, editsComplete: true, taskLabeledAt: [LABELED], builderLabeled: false });
const job = (body: string, provenance: unknown, labels: unknown = TASK_LABELS) => recordedTaskSource("peace", body, { labels, provenance });

test("Job C: the credit line at the first peace-task label must equal the credit line at record time", () => {
  assert.equal(job(GENUINE, UNEDITED), "peace");
  // the #501/#502 pattern: examples added after labelling, credit line untouched, keeps peace
  const withMore = issue(CTX_GENUINE).replace("- 2 gives 2", "- 2 gives 2\n- 3 gives 3\n\nExamples 3 was answered by Peace in https://x/1");
  const p501 = edited(rev("2026-10-26T20:52:13Z", withMore), rev("2026-10-26T20:36:23Z", withMore.replace("- 3 gives 3\n", "")), rev(CREATED, GENUINE));
  assert.equal(bodyAtFirstLabel(p501, withMore), GENUINE);
  assert.equal(job(withMore, p501), "peace");
  // an edit before the label is the labelled body; an edit at the label's own timestamp is ambiguous (strict <)
  const p0 = edited(rev(CREATED, GENUINE), rev("2026-10-26T19:38:50Z", issue(CTX_NO_MARK)));
  assert.equal(job(GENUINE, p0), "peace");
  assert.equal(job(GENUINE, edited(rev(LABELED, GENUINE), rev(CREATED, issue(CTX_NO_MARK)))), "builder");
  assert.equal(job(GENUINE, edited(rev("2026-10-26T20:00:00Z", GENUINE), rev(LABELED, GENUINE), rev(CREATED, GENUINE))), "builder");
  assert.equal(bodyAtFirstLabel(edited(rev(LABELED, GENUINE), rev(CREATED, GENUINE)), GENUINE), null);
  // an edited credit line gives builder: the mark added, the mark reworded, context changed, or a second line
  const noMark = issue(CTX_NO_MARK);
  assert.equal(job(GENUINE, edited(rev("2026-10-26T20:00:00Z", GENUINE), rev(CREATED, noMark))), "builder");
  const reworded = GENUINE.replace("this is the status check", "this is the check");
  assert.equal(job(reworded, edited(rev("2026-10-26T20:00:00Z", reworded), rev(CREATED, GENUINE))), "builder");
  const hidden = GENUINE.replace(CTX_GENUINE, `${CTX_GENUINE} <del>old</del>`); // round 4: raw HTML is builder
  assert.equal(job(hidden, edited(rev("2026-10-26T20:00:00Z", hidden), rev(CREATED, GENUINE))), "builder");
  const imaged = GENUINE.replace(CTX_GENUINE, CTX_GENUINE.replace("(source: peace).", "(source: peace). ![](x.png)")); // same visible text, line changed
  assert.equal(job(imaged, edited(rev("2026-10-26T20:00:00Z", imaged), rev(CREATED, GENUINE))), "builder");
  // the first label counts: relabelling after a credit-line edit does not reset it
  const relabel = { ...edited(rev("2026-10-26T20:00:00Z", GENUINE), rev(CREATED, noMark)), taskLabeledAt: ["2026-10-26T21:00:00Z", LABELED] };
  assert.equal(job(GENUINE, relabel), "builder");
  assert.equal(creditUnchangedSinceLabel(UNEDITED, GENUINE), true);
});

test("R4.3: the whole body is add-only since the first label: every labelled line still there, in order", () => {
  const at = (now: string) => job(now, edited(rev("2026-10-26T20:00:00Z", now), rev(CREATED, GENUINE)));
  assert.equal(at(GENUINE.replace("- 2 gives 2", "- 2 gives 2\n- 3 gives 3")), "peace"); // a line added
  assert.equal(at(`Note first.\n${GENUINE}\nNote last.`), "peace"); // lines added at both ends
  assert.equal(at(GENUINE.replace("- 2 gives 2\n", "")), "builder"); // an example removed
  assert.equal(at(GENUINE.replace("- 2 gives 2", "- 2 gives 3")), "builder"); // an example reworded
  assert.equal(at(GENUINE.replace("- 1 gives 1\n- 2 gives 2", "- 2 gives 2\n- 1 gives 1")), "builder"); // reordered
  assert.equal(at(GENUINE.replace("Target: PeaceG03/PeaceSTOCKS", "Target: PeaceG03/PeaceAI-Workspace")), "builder"); // target changed
  assert.equal(at(GENUINE.replace("\n\nExamples:", "\nExamples:")), "builder"); // a blank line removed
  assert.equal(at(GENUINE.replace(/\n/g, "\r\n")), "peace"); // line endings only
  assert.equal(bodyAddOnlySinceLabel(UNEDITED, GENUINE), true);
  assert.equal(bodyAddOnlySinceLabel(UNEDITED, 42), false);
});

test("R4.4: a deleted revision (deletedAt set) gives builder", () => {
  // identical history except deletedAt: only the deletion check separates peace from builder
  const later = issue(CTX_GENUINE, "Note: more examples soon.");
  const kept = edited(rev("2026-10-26T20:00:00Z", later), rev(CREATED, GENUINE));
  const deleted = edited(rev("2026-10-26T20:00:00Z", later), { editedAt: CREATED, deletedAt: "2026-10-26T20:05:00Z", body: GENUINE });
  const deletedLater = edited({ editedAt: "2026-10-26T20:00:00Z", deletedAt: "2026-10-26T20:05:00Z", body: later }, rev(CREATED, GENUINE));
  assert.equal(job(later, kept), "peace");
  assert.equal(job(later, deleted), "builder");
  assert.equal(job(later, deletedLater), "builder"); // a deleted revision after the label too
  assert.equal(bodyAtFirstLabel(deleted, later), null);
});

test("Job C: incomplete or malformed history gives builder", () => {
  for (const p of [
    undefined, null, {}, "x",
    { ...UNEDITED, editsComplete: false },
    { ...UNEDITED, taskLabeledAt: [] },
    { ...UNEDITED, taskLabeledAt: ["yesterday"] },
    { ...UNEDITED, lastEditedAt: "2026-10-26T20:00:00Z" }, // edited, but no revisions listed
    { ...UNEDITED, builderLabeled: undefined },
    edited(rev("2026-10-26T20:00:00Z", GENUINE)), // every revision after the label: the labelled body is unknown
    edited(rev("2026-10-26T20:00:00Z", GENUINE), { editedAt: CREATED, deletedAt: "2026-10-26T20:01:00Z", body: null }), // deleted revision
    edited(rev("2026-10-26T20:00:00Z", GENUINE), { editedAt: CREATED, deletedAt: null, body: null }),
    edited(rev("2026-10-26T20:00:00Z", GENUINE), rev("not a time", GENUINE)),
  ])
    assert.equal(job(GENUINE, p), "builder", JSON.stringify(p));
});

test("Job C: labels are re-read at record time; a source:builder label ever added gives builder", () => {
  assert.equal(job(GENUINE, UNEDITED, [...TASK_LABELS, "source:builder"]), "builder"); // on the issue at record time
  assert.equal(job(GENUINE, UNEDITED, [...TASK_LABELS, " Source:Builder "]), "builder");
  assert.equal(job(GENUINE, { ...UNEDITED, builderLabeled: true }), "builder"); // added before record time, since removed
  assert.equal(job(GENUINE, UNEDITED, null), "builder"); // labels not re-read
  assert.equal(recordedTaskSource("peace", GENUINE, { provenance: UNEDITED }), "builder");
  assert.equal(recordedTaskSource("peace", GENUINE), "builder");
  // pick-time value must be exactly peace and the fetched body must still give peace
  for (const pick of [undefined, "", "builder", "Peace", "peace "]) assert.equal(recordedTaskSource(pick, GENUINE, { labels: TASK_LABELS, provenance: UNEDITED }), "builder", String(pick));
  assert.equal(job(issue(CTX_540), UNEDITED), "builder");
});

test("records: bodySha256 recorded; missing or unknown source is builder, never peace", () => {
  assert.equal(bodySha256("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  assert.equal(taskSourceOf({}), "builder");
  assert.equal(taskSourceOf({ source: "builder" }), "builder");
  assert.equal(taskSourceOf({ source: "peace" }), "peace");
  assert.equal(taskSourceOf({ source: "PEACE" as never }), "builder");
  const base = { issue: 540, runId: "1", recordedAt: "2026-10-26T00:00:00Z", baseSha: "a".repeat(40), title: "t", body: CTX_540 };
  assert.equal(buildRecords(base, [], [], "seed").task.source, "builder");
  assert.equal(buildRecords(base, [], [], "seed").task.bodySha256, undefined);
  assert.equal(buildRecords({ ...base, source: "peace", bodySha256: sha }, [], [], "seed").task.source, "peace");
  assert.equal(buildRecords({ ...base, bodySha256: sha }, [], [], "seed").task.bodySha256, sha);
  assert.equal(buildRecords({ ...base, bodySha256: "nothex" }, [], [], "seed").task.bodySha256, undefined);
});

test("credit marker: everything builder-log credits as (source: peace) is the policy marker too", () => {
  for (const s of ["(source: peace)", "(Source:PEACE)", "(source:   peace)"]) {
    assert.ok(SOURCE_PEACE.test(s), s);
    assert.ok(SOURCE_PEACE_MARK.test(s), s);
  }
  assert.ok(TEAM_PICKED_MARK.test(normalizeProvenance(BUILDER_LOG_TEAM)));
});

test("select, issue-fetch and Job C decide the source from provenance (wiring)", () => {
  const select = readFileSync("peaceai/bin/select.ts", "utf8");
  assert.match(select, /body: \(\.body \/\/ ""\)/);
  assert.match(select, /taskSource\(pickedIssue\.labels, pickedIssue\.body\)/);
  assert.match(select, /body_sha256: bodySha/);
  const record = readFileSync("peaceai/bin/record-task.ts", "utf8");
  assert.match(record, /source: recordedTaskSource\(process\.env\.TASK_SOURCE, issue\.body, \{ labels: issue\.labels, provenance: issue\.provenance \}\)/);
  assert.match(record, /bodySha256: bodySha256\(issue\.body\)/);
  const fetch = readFileSync("peaceai/bin/issue-fetch.ts", "utf8");
  assert.match(fetch, /userContentEdits\(first: 100\) \{ totalCount nodes \{ editedAt deletedAt diff \} \}/);
  assert.match(fetch, /body: issue\.body \?\? "", labels, \.\.\.withProvenance/);
  assert.match(fetch, /builderLabeled:/);
  assert.match(fetch, /LABELED_EVENT/);
  const wf = readFileSync(".github/workflows/peace-task.yml", "utf8");
  assert.match(wf, /body_sha256: \$\{\{ steps\.pick\.outputs\.body_sha256 \}\}/);
  assert.doesNotMatch(wf, /TASK_BODY_SHA256/); // round 3: edits elsewhere in the body no longer change credit
  const jobC = wf.slice(wf.indexOf("Commit records and the blind ranking"));
  const fetchStep = wf.slice(0, wf.indexOf("Commit records and the blind ranking")).lastIndexOf("Fetch the task text");
  assert.match(wf.slice(fetchStep, fetchStep + 300), /ISSUE_PROVENANCE: "1"/);
  assert.ok(jobC.length > 0);
});
