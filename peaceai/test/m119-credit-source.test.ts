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
  BUILDER_LABEL, bodySha256, bodyUnchangedSinceLabel, contextCreditLines, normalizeProvenance, recordedTaskSource,
  SOURCE_PEACE_MARK, stripNonCredit, taskSource, TEAM_PICKED_MARK,
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
const UNEDITED = { lastEditedAt: null, editTimes: [], editsComplete: true, taskLabeledAt: [LABELED] };
const sha = bodySha256(GENUINE);

test("Job C: pick-time value, the same body (sha256) and no body edit after the first peace-task label", () => {
  assert.equal(recordedTaskSource("peace", GENUINE, { pickBodySha256: sha, provenance: UNEDITED }), "peace");
  // edits before the label (the first userContentEdits entry is the original body) are fine
  const before = { lastEditedAt: "2026-10-26T19:38:51Z", editTimes: ["2026-10-26T19:38:51Z", "2026-10-26T19:30:00Z"], editsComplete: true, taskLabeledAt: [LABELED] };
  assert.equal(recordedTaskSource("peace", GENUINE, { pickBodySha256: sha, provenance: before }), "peace");
  // an edit after the first label event gives builder, even if the label was applied again later
  const after = { ...before, lastEditedAt: "2026-10-26T20:00:00Z", editTimes: ["2026-10-26T20:00:00Z", ...before.editTimes] };
  assert.equal(recordedTaskSource("peace", GENUINE, { pickBodySha256: sha, provenance: after }), "builder");
  assert.equal(recordedTaskSource("peace", GENUINE, { pickBodySha256: sha, provenance: { ...after, taskLabeledAt: [LABELED, "2026-10-26T21:00:00Z"] } }), "builder");
  assert.equal(recordedTaskSource("peace", GENUINE, { pickBodySha256: sha, provenance: { ...UNEDITED, lastEditedAt: "2026-10-26T20:00:00Z" } }), "builder");
  // missing, incomplete or malformed history
  for (const p of [undefined, null, {}, { ...UNEDITED, editsComplete: false }, { ...UNEDITED, taskLabeledAt: [] }, { ...UNEDITED, taskLabeledAt: ["yesterday"] }, { ...UNEDITED, editTimes: [5] }])
    assert.equal(recordedTaskSource("peace", GENUINE, { pickBodySha256: sha, provenance: p }), "builder", JSON.stringify(p));
  assert.equal(bodyUnchangedSinceLabel(UNEDITED), true);
  // the body changed between pick and record, or no pick-time sha
  assert.equal(recordedTaskSource("peace", GENUINE, { pickBodySha256: bodySha256(GENUINE + " "), provenance: UNEDITED }), "builder");
  assert.equal(recordedTaskSource("peace", GENUINE, { provenance: UNEDITED }), "builder");
  assert.equal(recordedTaskSource("peace", GENUINE), "builder");
  // pick-time value must be exactly peace and the fetched body must still give peace
  for (const pick of [undefined, "", "builder", "Peace", "peace "]) assert.equal(recordedTaskSource(pick, GENUINE, { pickBodySha256: sha, provenance: UNEDITED }), "builder", String(pick));
  const b540 = issue(CTX_540);
  assert.equal(recordedTaskSource("peace", b540, { pickBodySha256: bodySha256(b540), provenance: UNEDITED }), "builder");
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
  assert.match(record, /source: recordedTaskSource\(process\.env\.TASK_SOURCE, issue\.body, \{ pickBodySha256: process\.env\.TASK_BODY_SHA256, provenance: issue\.provenance \}\)/);
  assert.match(record, /bodySha256: bodySha256\(issue\.body\)/);
  const fetch = readFileSync("peaceai/bin/issue-fetch.ts", "utf8");
  assert.match(fetch, /userContentEdits\(first: 100\)/);
  assert.match(fetch, /LABELED_EVENT/);
  const wf = readFileSync(".github/workflows/peace-task.yml", "utf8");
  assert.match(wf, /body_sha256: \$\{\{ steps\.pick\.outputs\.body_sha256 \}\}/);
  assert.match(wf, /TASK_BODY_SHA256: \$\{\{ needs\.select\.outputs\.body_sha256 \}\}/);
  const jobC = wf.slice(wf.indexOf("Commit records and the blind ranking"));
  const fetchStep = wf.slice(0, wf.indexOf("Commit records and the blind ranking")).lastIndexOf("Fetch the task text");
  assert.match(wf.slice(fetchStep, fetchStep + 300), /ISSUE_PROVENANCE: "1"/);
  assert.ok(jobC.length > 0);
});
