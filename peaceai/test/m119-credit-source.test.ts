// M119 credit-truth fix (Auditor, 2026-10-26): the task source follows provenance, not the filer account.
// Before this, select.ts read only the `source:builder` label, so every PeaceG03-filed peace-task without it
// (team-picked #513-#516, #540, #541 among them) was recorded as source=peace in task.json.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { SOURCE_PEACE } from "../../builder-log/coverage.ts";
import { BUILDER_LABEL, recordedTaskSource, SOURCE_PEACE_MARK, taskSource, TEAM_PICKED_MARK } from "../lib/policy.ts";
import { buildRecords, taskSourceOf } from "../lib/records.ts";

// Credit lines quoted from the real issue bodies (public PeaceAI-Workspace issues).
const BODY_540 =
  "Context (Builder pre-file, ADD_FUNCTION over a list, public-derive-from-behavior-v4, behavior only): Team-picked task " +
  "(Builder-drafted; not credited as source: peace unless Peace says so in his own words); the behavior follows Peace's own " +
  "answers quoted above. Slice 2 of Peace's scanner self-health-check system.";
const BODY_513 =
  "Context (Builder pre-file, behavior only): Peace's task (source: peace). Slice 1 of Peace's scanner self-health-check " +
  "system. On 2026-10-25 Peace asked the team to pick a real task itself (\"I don't can't you guys think of one?\"), and " +
  "this is the one picked.";
const BUILDER_LOG_TEAM = "Team-picked task PeaceAI-Workspace#513 (source: team-picked at Peace's request; spec and examples written by Builder)";
const BODY_GENUINE =
  "Context (Builder pre-file, ADD_FUNCTION, public-add-function-v2): Peace's task (source: peace). The ten-minute chain " +
  "stopped on R2_PUT_500 because R2ObjectClient.request never retries; this is the status test the future retry uses.";
const TASK_LABELS = ["peace-task", "peaceai:running"];

test("a team-picked issue filed by PeaceG03 (no source:builder label) records not-peace", () => {
  assert.equal(taskSource(TASK_LABELS, BODY_540), "builder");
  assert.equal(taskSource(TASK_LABELS, BODY_540.replace("Team-picked", "team picked")), "builder");
  // #513-#516: the body claimed (source: peace) but its own provenance says the team picked it.
  assert.equal(taskSource(TASK_LABELS, BODY_513), "builder");
  // builder-log's team-picked clause is a (source: ...) clause that is not peace.
  assert.equal(taskSource(TASK_LABELS, BUILDER_LOG_TEAM), "builder");
  assert.equal(taskSource(TASK_LABELS, `${BODY_GENUINE}\n${BUILDER_LOG_TEAM}`), "builder");
});

test("the genuine (source: peace) path still records peace", () => {
  assert.equal(taskSource(TASK_LABELS, BODY_GENUINE), "peace");
  assert.equal(taskSource(["peace-task"], "Peace's task (Source:  PEACE): guard something real"), "peace");
  assert.equal(recordedTaskSource("peace", BODY_GENUINE), "peace");
});

test("unclear provenance fails closed to not-peace", () => {
  for (const body of [undefined, null, 42, "", "Add a helper in src/text.ts with focused tests.", "Peace's task source: peace without the clause"])
    assert.equal(taskSource(TASK_LABELS, body), "builder", String(body));
  assert.equal(taskSource(TASK_LABELS, "Peace's task (source: peace). Also (source: builder)."), "builder");
  assert.equal(taskSource([...TASK_LABELS, BUILDER_LABEL], BODY_GENUINE), "builder");
  // Job C needs both the pick-time value and the full fetched body to say peace.
  assert.equal(recordedTaskSource("peace", BODY_540), "builder");
  assert.equal(recordedTaskSource("peace", ""), "builder");
  for (const pick of [undefined, "", "builder", "Peace", "peace "]) assert.equal(recordedTaskSource(pick, BODY_GENUINE), "builder", String(pick));
});

test("records: missing or unknown source is builder, never peace", () => {
  assert.equal(taskSourceOf({}), "builder");
  assert.equal(taskSourceOf({ source: "builder" }), "builder");
  assert.equal(taskSourceOf({ source: "peace" }), "peace");
  assert.equal(taskSourceOf({ source: "PEACE" as never }), "builder");
  const base = { issue: 540, runId: "1", recordedAt: "2026-10-26T00:00:00Z", baseSha: "a".repeat(40), title: "t", body: BODY_540 };
  assert.equal(buildRecords(base, [], [], "seed").task.source, "builder");
  assert.equal(buildRecords({ ...base, source: "peace" }, [], [], "seed").task.source, "peace");
});

test("same credit marker as builder-log real-task credit", () => {
  assert.equal(SOURCE_PEACE_MARK.source, SOURCE_PEACE.source);
  assert.equal(SOURCE_PEACE_MARK.flags, SOURCE_PEACE.flags);
  assert.ok(TEAM_PICKED_MARK.test(BUILDER_LOG_TEAM));
});

test("select and Job C decide the source from provenance (wiring)", () => {
  const select = readFileSync("peaceai/bin/select.ts", "utf8");
  assert.match(select, /body: \(\.body \/\/ ""\)/);
  assert.match(select, /taskSource\(pickedIssue\.labels, pickedIssue\.body\)/);
  const record = readFileSync("peaceai/bin/record-task.ts", "utf8");
  assert.match(record, /source: recordedTaskSource\(process\.env\.TASK_SOURCE, issue\.body\)/);
  assert.doesNotMatch(record, /TASK_SOURCE === "builder" \? "builder" : "peace"/);
});
