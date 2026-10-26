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
  BUILDER_LABEL, bodyAtFirstLabel, bodySha256, contextCreditLines, creditUnchangedSinceLabel, creditLineVisible, decodeEntities,
  hasUnknownEntity, normalizeProvenance, recordedTaskSource, SOURCE_PEACE_MARK, stripNonCredit, taskSource,
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
const CTX_GENUINE =
  "Context (Builder pre-file, ADD_FUNCTION, public-add-function-v2): Peace's task (source: peace). The ten-minute chain " +
  "stopped on R2_PUT_500 because R2ObjectClient.request never retries; this is the status test the future retry uses.";
// The older credit-line form (#353-#488), before the Context heading.
const PREFILE_GENUINE = "(Builder pre-file, DATE_FUNCTION, public-date-function-v1): Peace's task (source: peace). The UTC date key is written inline.";
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
  assert.equal(src(issue("Context: Peace's task (Source:  PEACE). Guard something real.")), "peace");
  assert.equal(src(issue("Context: Peace's task ( source : peace ). Guard something real.")), "peace");
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
const CTX = "Context (Builder pre-file, behavior only): Peace's task";
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
  for (const line of [`${CTX} (source: peace)`, `${CTX} (source: peace).`, `${CTX} (source: peace). See [the log](https://x/y(z)).`, `${CTX} (source: peace) `])
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
  assert.equal(src(issue(`${CTX} &#40;source: peace&#41;. Slice 3.`)), "peace");
  assert.equal(src(issue(`${CTX} &lpar;source&colon; peace&rpar;. Slice 3.`)), "peace");
  // a semicolon-less reference is literal text when rendered: it is no credit, but it is a contrary clause
  assert.equal(src(issue(`${CTX} &#40source: peace). Slice 3.`)), "builder");
  assert.equal(decodeEntities("&#40;&lpar;&#x29;&rpar;&amp;lpar;&nosuch;"), "(())&lpar;&nosuch;");
  assert.equal(decodeEntities("&#40x", true), "(x");
  assert.equal(creditLineVisible(issue(`${CTX} &#40;source: peace&#41;.`)), `${CTX} (source: peace).`);
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
  // an edit before the label is the labelled body
  const p0 = edited(rev(LABELED, GENUINE), rev(CREATED, issue(CTX_NO_MARK)));
  assert.equal(job(GENUINE, p0), "peace");
  // an edited credit line gives builder: the mark added, the mark reworded, context changed, or a second line
  const noMark = issue(CTX_NO_MARK);
  assert.equal(job(GENUINE, edited(rev("2026-10-26T20:00:00Z", GENUINE), rev(CREATED, noMark))), "builder");
  const reworded = GENUINE.replace("this is the status test", "this is the test");
  assert.equal(job(reworded, edited(rev("2026-10-26T20:00:00Z", reworded), rev(CREATED, GENUINE))), "builder");
  const hidden = GENUINE.replace(CTX_GENUINE, `${CTX_GENUINE} <del>old</del>`); // markup-only edit: same visible text
  assert.equal(job(hidden, edited(rev("2026-10-26T20:00:00Z", hidden), rev(CREATED, GENUINE))), "peace");
  // the first label counts: relabelling after a credit-line edit does not reset it
  const relabel = { ...edited(rev("2026-10-26T20:00:00Z", GENUINE), rev(CREATED, noMark)), taskLabeledAt: ["2026-10-26T21:00:00Z", LABELED] };
  assert.equal(job(GENUINE, relabel), "builder");
  assert.equal(creditUnchangedSinceLabel(UNEDITED, GENUINE), true);
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
