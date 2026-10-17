// PeaceAI vs Builder coverage: live-proven only (PeaceAI + repo@sha / validated LIVE_PROVEN_SINCE).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import {
  appendOnly,
  COVERAGE_NONE_SEQS,
  isCoverageNone,
  LIVE_LANDING_REF,
  LIVE_PROVEN_SINCE,
  retagTarget,
  validateLiveProven,
  validateLog,
  validateRetags,
  type Entry,
} from "./check.ts";
import {
  approvedAt,
  countable,
  coverageReport,
  retagCountable,
  denverYmd,
  formatCoverageSummary,
  EXCL_SELF_LABEL,
  isPeaceRealTask,
  isProofOrNoCoverage,
  LIVE_LANDING,
  liveProvenSkills,
  peaceStocksSha,
} from "./coverage.ts";

type Fields = {
  seq: number;
  date?: string;
  time?: string;
  asked?: string;
  changed?: string;
  why?: string;
  skill: string;
  mark: string;
  by: "Builder" | "PeaceAI";
  coverage?: "none";
};

const line = (e: Fields): string => {
  const o: Record<string, unknown> = {
    seq: e.seq,
    date: e.date ?? "2026-10-13",
    time: e.time ?? "12:00",
    asked: e.asked ?? `fixture asked text for seq ${e.seq}`,
    changed: e.changed ?? "none (fixture)",
    why: e.why ?? "fixture why text here",
    skill: e.skill,
    mark: e.mark,
    by: e.by,
  };
  if (e.coverage !== undefined) o.coverage = e.coverage;
  return JSON.stringify(o);
};

const entriesOf = (text: string): Entry[] => text.split("\n").filter(Boolean).map((l) => JSON.parse(l) as Entry);

const FIXTURE = [
  line({ seq: 1, skill: "OPS_ACTION", mark: "missing skill OPS_ACTION", by: "Builder", date: "2026-10-10" }),
  line({ seq: 2, skill: "IMPORT_EDIT", mark: "missing skill IMPORT_EDIT", by: "Builder", date: "2026-10-10", changed: "PeaceSTOCKS@abc1234" }),
  line({ seq: 3, skill: "THROW_GUARD", mark: "PeaceAI-able today", by: "PeaceAI", date: "2026-10-11", changed: "PeaceSTOCKS@def5678" }),
  line({ seq: 4, skill: "THROW_GUARD", mark: "PeaceAI-able today", by: "Builder", date: "2026-10-12", changed: "PeaceSTOCKS@aaa1111" }),
  line({ seq: 5, skill: "TEST_CASE", mark: "PeaceAI-able today", by: "PeaceAI", date: "2026-10-12", changed: "PeaceAI-Workspace#99" }),
  line({ seq: 6, skill: "WORKFLOW_JOB", mark: "missing skill WORKFLOW_JOB", by: "Builder", date: "2026-10-14", changed: "PeaceSTOCKS@bbb2222" }),
  line({ seq: 7, skill: "OPS_ACTION", mark: "missing skill OPS_ACTION", by: "Builder", date: "2026-10-14" }),
  line({ seq: 8, skill: "WORKFLOW_STEP", mark: "PeaceAI-able today", by: "Builder", date: "2026-10-14", changed: "PeaceAI-Workspace#125" }),
].join("\n") + "\n";

test("LIVE_LANDING matches repo@sha only, not issue refs", () => {
  assert.equal(LIVE_LANDING, LIVE_LANDING_REF);
  assert.ok(LIVE_LANDING.test("PeaceSTOCKS@abc1234"));
  assert.ok(LIVE_LANDING.test("PeaceAI-Workspace@deadbee"));
  assert.ok(!LIVE_LANDING.test("PeaceAI-Workspace#99"));
  assert.ok(!LIVE_LANDING.test("none (fixture)"));
});

test("liveProvenSkills: PeaceAI@sha landings + LIVE_PROVEN_SINCE.since gate; issue-only ignored", () => {
  const entries = entriesOf(FIXTURE);
  assert.deepEqual([...liveProvenSkills(entries, "2026-10-14")].sort(), ["THROW_GUARD"]);
  assert.deepEqual([...liveProvenSkills(entries, "2026-10-15")].sort(), ["COMPLEX_FUNCTION", "LOOP_FUNCTION", "METHOD_GUARD", "THROW_GUARD", "WORKFLOW_STEP"]);
  // asOf before the THROW_GUARD landing time excludes it
  assert.deepEqual([...liveProvenSkills(entries, "2026-10-10")].sort(), []);
});

test("liveProvenSkills window math for Builder able % (unit, no validateLog)", () => {
  const entries = entriesOf(FIXTURE);
  const proven = liveProvenSkills(entries, "2026-10-15");
  const builder = entries.filter((e) => e.by === "Builder");
  const able = builder.filter((e) => proven.has(e.skill));
  // Builder: 1,2,4,6,7,8 → 6; able: seq4 THROW_GUARD + seq8 WORKFLOW_STEP → 2/6 = 33.3%
  assert.equal(builder.length, 6);
  assert.equal(able.length, 2);
  assert.equal(Math.round((1000 * able.length) / builder.length) / 10, 33.3);
});

test("invalid asOf refused; validateLog on the real log enforces LIVE_PROVEN_SINCE backing", () => {
  assert.throws(() => coverageReport(FIXTURE, "bad"), /bad asOf|builder-log invalid/);
  // Short fixtures skip LIVE_PROVEN_SINCE (log shorter than named seqs); the committed log must pass.
  assert.deepEqual(validateLog(FIXTURE), []);
  assert.deepEqual(validateLog(readFileSync(resolve(import.meta.dirname, "tasks.jsonl"), "utf8")), []);
});

test("real log: 20/76 as of 2026-10-16, 32/88 as of 2026-10-17 with PeaceAI real tasks (98/100/102-105, batch 106-115, 118, 122, 126-132, 134-138) + Builder 26/70; seq 97/99/101 coverage:none allowlist; METHOD_GUARD 71/77 stay missing", () => {
  const text = readFileSync(resolve(import.meta.dirname, "tasks.jsonl"), "utf8");
  assert.deepEqual(validateLog(text), []);
  assert.equal(LIVE_PROVEN_SINCE.WORKFLOW_STEP.seq, 85);
  assert.equal(LIVE_PROVEN_SINCE.WORKFLOW_STEP.since, "2026-10-15 12:02");
  assert.deepEqual(LIVE_PROVEN_SINCE.METHOD_GUARD, { since: "2026-10-15 17:28", seq: 86 });
  assert.deepEqual(LIVE_PROVEN_SINCE.COMPLEX_FUNCTION, { since: "2026-10-15 18:57", seq: 87 });
  assert.deepEqual(LIVE_PROVEN_SINCE.LOOP_FUNCTION, { since: "2026-10-15 21:52", seq: 97 }); // #229 -> PeaceSTOCKS@22b0f3d
  assert.deepEqual(LIVE_PROVEN_SINCE.IMPORT_EDIT, { since: "2026-10-16 00:17", seq: 101 }); // #237 (A1) -> PeaceSTOCKS@eb8aadc; asOf 2026-10-15 below excludes it
  // Allow every PeaceSTOCKS@sha that appears in the committed log (unit test of the formula; git ancestry is separate).
  const onMain = (sha: string) => /^[0-9a-f]{7,40}$/.test(sha);
  assert.deepEqual([...COVERAGE_NONE_SEQS].sort((a, b) => a - b), [28, 30, 31, 35, 59, 60, 85, 86, 87, 97, 99, 101]);
  // asOf 2026-10-15: IMPORT_EDIT not yet live-proven; all-time is now asOf-bounded so seq 102 drops out.
  const r15 = coverageReport(text, "2026-10-15", { onMain });
  for (const s of ["THROW_GUARD", "WORKFLOW_STEP", "METHOD_GUARD", "COMPLEX_FUNCTION", "LOOP_FUNCTION"]) assert.ok(r15.liveProven.includes(s), s);
  assert.ok(r15.liveProven.includes("CHECK_OBJECT_LITERAL_ARGS"));
  assert.equal(r15.allTime.builderTasks, 60);
  assert.equal(r15.allTime.peaceaiAble, 4);
  assert.equal(r15.last7Days.builderTasks, 60);
  assert.equal(r15.last7Days.peaceaiAble, 4);
  // asOf today: full 8/64 including IMPORT_EDIT live-proven and seq 102 in the 7-day window.
  const r = coverageReport(text, "2026-10-16", { onMain });
  assert.ok(r.liveProven.includes("IMPORT_EDIT"));
  // Retags (seq 88-96): 70/78 -> THROW_GUARD, 71/77 -> METHOD_GUARD, 8/12/17/19/22 -> LOOP_FUNCTION.
  // Denom: 58 Builder + 6 PeaceAI real (98, 100, 102, 103, 104, 105). Proof-worded rows are COVERAGE_NONE_SEQS (incl. 97/99/101).
  assert.equal(r.allTime.builderTasks, 76);
  // Counted: seq 26 TEST_CASE + seq 70 retag THROW_GUARD + PeaceAI real 98/100/102/103/104/105 + batch 106-115 (THROW_GUARD) + 118 (METHOD_GUARD) + 122 (ENV_FIX).
  // Not: 71/77 (before METHOD_GUARD approval), 78 (nothing landed), 10/13 (pre-approval WORKFLOW_STEP).
  assert.equal(r.allTime.peaceaiAble, 20);
  assert.equal(r.allTime.percent, 26.3);
  assert.equal(r.last7Days.builderTasks, 76);
  assert.equal(r.last7Days.peaceaiAble, 20);
  assert.equal(r.last7Days.percent, 26.3);
  assert.deepEqual(r.topMissing.find((m) => m.skill === "METHOD_GUARD"), { skill: "METHOD_GUARD", count: 2 });
  assert.deepEqual(r.topMissing.find((m) => m.skill === "THROW_GUARD"), { skill: "THROW_GUARD", count: 1 });
  assert.deepEqual(r.topMissing.find((m) => m.skill === "WORKFLOW_STEP"), { skill: "WORKFLOW_STEP", count: 2 }, "seq 10/13 logged before WORKFLOW_STEP approval");
  assert.deepEqual(r.topMissing.find((m) => m.skill === "LOOP_FUNCTION"), { skill: "LOOP_FUNCTION", count: 5 });
  assert.ok(!r.topMissing.some((m) => m.skill === "COMPLEX_FUNCTION"));
  const md = formatCoverageSummary(r);
  assert.match(md, /## PeaceAI vs Builder/);
  assert.match(md, /26\.3% \(20\/76\)/);
  // Batch v4 coverage (seq 126-132, #353-#359 landed 2026-10-17 as PeaceSTOCKS@1a6e6cd..47cfaaf): +7 PeaceAI real tasks in
  // both numerator and denominator -> 27/83. Proof rows 123-125 (ops C, self-change A #341/#345, date B #350) are coverage:none.
  // TEST_CASE_EXISTING (seq 134-138, #370-#374 landed 2026-10-17 as PeaceSTOCKS@af3050f..5c41528, stacked on #368's 83904c3):
  // +5 PeaceAI real tasks -> 32/88. Proof row 133 (#368 landing, #369 refusal) is coverage:none.
  const r17 = coverageReport(text, "2026-10-17", { onMain });
  assert.equal(r17.allTime.builderTasks, 88);
  assert.equal(r17.allTime.peaceaiAble, 32);
  assert.equal(r17.allTime.percent, 36.4);
  assert.equal(coverageReport(text, denverYmd(), { onMain }).allTime.percent, 36.4);
  // Fail closed without an onMain checker: PeaceAI real tasks drop out → back to Builder-only 2/58.
  assert.equal(coverageReport(text, denverYmd()).allTime.peaceaiAble, 2);
  assert.equal(coverageReport(text, denverYmd()).allTime.builderTasks, 58);
});

test("unbacked LIVE_PROVEN_SINCE entry fails validation", () => {
  const text = readFileSync(resolve(import.meta.dirname, "tasks.jsonl"), "utf8");
  const entries = entriesOf(text);
  assert.deepEqual(validateLiveProven(entries), [], "committed map is backed by seq 85");
  assert.ok(
    validateLiveProven(entries, { WORKFLOW_STEP: { since: "2026-10-15 12:02", seq: 99999 } }).some((e) =>
      /no builder-log seq 99999/.test(e),
    ),
  );
  assert.ok(
    validateLiveProven(entries, { TEST_CASE: { since: "2026-10-13 07:00", seq: 26 } }).some((e) => /by must be PeaceAI/.test(e)),
  );
  assert.ok(
    validateLiveProven(entries, { THROW_GUARD: { since: "2026-10-15 12:02", seq: 85 } }).some((e) => /skill is WORKFLOW_STEP/.test(e)),
  );
  assert.ok(
    validateLiveProven(entries, { TEST_CASE_APPEND: { since: "2026-10-13 22:36", seq: 59 } }).some((e) => /repo@sha/.test(e)),
  );
});

const R = (seq: number, target: number, skill: string, mark: string, by: "Builder" | "PeaceAI" = "Builder") =>
  line({ seq, skill, mark, by, date: "2026-10-15", time: "19:35", changed: `none (retag seq ${target})` });

test("retag: coverage uses the latest tag; retag lines are not tasks", () => {
  const text = FIXTURE + [
    R(9, 6, "THROW_GUARD", "PeaceAI-able today"),
    R(10, 7, "LOOP_FUNCTION", "missing skill LOOP_FUNCTION"),
    R(11, 7, "WORKFLOW_JOB", "missing skill WORKFLOW_JOB"),
  ].join("\n") + "\n";
  assert.deepEqual(validateLog(text), []);
  assert.equal(retagTarget({ changed: "none (retag seq 6)" }), 6);
  assert.equal(retagTarget({ changed: "none (fixture)" }), null);
  const r = coverageReport(text, "2026-10-15");
  assert.equal(r.allTime.builderTasks, 6, "the three retag lines are not counted as tasks");
  // seq 6 WORKFLOW_JOB -> THROW_GUARD: no able mark and no PeaceAI landing, so the retag cannot raise it (stays 2)
  assert.equal(r.allTime.peaceaiAble, 2);
  // seq 7 retagged twice: the latest (WORKFLOW_JOB) wins, LOOP_FUNCTION does not appear
  assert.ok(!r.topMissing.some((m) => m.skill === "LOOP_FUNCTION"));
  assert.deepEqual(r.topMissing.find((m) => m.skill === "WORKFLOW_JOB"), { skill: "WORKFLOW_JOB", count: 1 });
});

test("retag: the referenced seq must exist, be earlier, be a Builder task and not itself a retag", () => {
  const bad = (extra: string[]) => validateLog(FIXTURE + extra.join("\n") + "\n");
  assert.ok(bad([R(9, 42, "THROW_GUARD", "PeaceAI-able today")]).some((e) => /missing or later seq 42/.test(e)));
  assert.ok(bad([R(9, 9, "THROW_GUARD", "PeaceAI-able today")]).some((e) => /missing or later seq 9/.test(e)));
  assert.ok(bad([R(9, 3, "THROW_GUARD", "PeaceAI-able today")]).some((e) => /must be a Builder task/.test(e)));
  assert.ok(bad([R(9, 6, "THROW_GUARD", "PeaceAI-able today"), R(10, 9, "OPS_ACTION", "missing skill OPS_ACTION")]).some((e) => /references another retag/.test(e)));
  assert.ok(validateRetags(entriesOf(FIXTURE + R(9, 6, "THROW_GUARD", "PeaceAI-able today", "PeaceAI") + "\n")).some((e) => /must be by Builder/.test(e)));
});

test("retag: appending keeps the log append-only; editing the retagged line instead is refused", () => {
  const withRetag = FIXTURE + R(9, 6, "THROW_GUARD", "PeaceAI-able today") + "\n";
  assert.deepEqual(appendOnly(FIXTURE, withRetag), []);
  const edited = FIXTURE.replace('"skill":"WORKFLOW_JOB","mark":"missing skill WORKFLOW_JOB"', '"skill":"THROW_GUARD","mark":"PeaceAI-able today"');
  assert.notEqual(edited, FIXTURE);
  assert.equal(appendOnly(FIXTURE, edited).length, 1);
});

test("historical missing-skill entry for a now-approved, live-proven skill stays uncounted (APPROVED_SINCE)", () => {
  // seq 9: WORKFLOW_STEP logged before its approval (APPROVED_SINCE 2026-10-13 22:41), so marked missing.
  const text = FIXTURE + line({ seq: 9, skill: "WORKFLOW_STEP", mark: "missing skill WORKFLOW_STEP", by: "Builder", date: "2026-10-13", time: "10:00" }) + "\n";
  assert.deepEqual(validateLog(text), []);
  const r = coverageReport(text, "2026-10-15");
  assert.ok(r.liveProven.includes("WORKFLOW_STEP"), "skill is live-proven by asOf");
  assert.equal(r.allTime.builderTasks, 7);
  assert.equal(r.allTime.peaceaiAble, 2, "the old missing entry is not counted by name alone");
  assert.deepEqual(r.topMissing.find((m) => m.skill === "WORKFLOW_STEP"), { skill: "WORKFLOW_STEP", count: 1 });
  assert.equal(countable({ skill: "WORKFLOW_STEP", mark: "missing skill WORKFLOW_STEP" }, new Set(["WORKFLOW_STEP"])), false);
  assert.equal(countable({ skill: "WORKFLOW_STEP", mark: "PeaceAI-able today" }, new Set(["WORKFLOW_STEP"])), true);
  // Even an appended retag cannot raise it: WORKFLOW_STEP was approved after seq 9's own time.
  const retagged = text + R(10, 9, "WORKFLOW_STEP", "PeaceAI-able today") + "\n";
  assert.deepEqual(validateLog(retagged), []);
  assert.equal(coverageReport(retagged, "2026-10-15").allTime.peaceaiAble, 2);
});

test("retag never raises: approval must predate the ORIGINAL task, and the task needs an able mark or a PeaceAI landing", () => {
  const base = (extra: string[]) => FIXTURE + extra.join("\n") + "\n";
  // (a) approved AFTER the original task: WORKFLOW_STEP since 2026-10-13 22:41, task at 2026-10-13 12:00, even with a landing.
  const a = base([
    line({ seq: 9, skill: "OPS_ACTION", mark: "missing skill OPS_ACTION", by: "Builder", date: "2026-10-13", changed: "PeaceAI-Workspace#901" }),
    line({ seq: 10, skill: "WORKFLOW_STEP", mark: "PeaceAI-able today", by: "PeaceAI", date: "2026-10-14", changed: "PeaceAI-Workspace#901, PeaceSTOCKS@abcdef1" }),
    R(11, 9, "WORKFLOW_STEP", "PeaceAI-able today"),
  ]);
  assert.deepEqual(validateLog(a), []);
  assert.equal(approvedAt("WORKFLOW_STEP", "2026-10-13 12:00"), false);
  assert.equal(coverageReport(a, "2026-10-15").allTime.peaceaiAble, 2, "approval after the task: not counted");
  // (b) approved before, but the original mark was missing and no PeaceAI landing references the task.
  const b = base([
    line({ seq: 9, skill: "OPS_ACTION", mark: "missing skill OPS_ACTION", by: "Builder", date: "2026-10-14", changed: "PeaceAI-Workspace#902" }),
    R(10, 9, "THROW_GUARD", "PeaceAI-able today"),
  ]);
  assert.deepEqual(validateLog(b), []);
  assert.equal(coverageReport(b, "2026-10-15").allTime.peaceaiAble, 2, "no able mark, no landing: not counted");
  // A landing of a different issue, or a different skill, is not evidence either.
  const b2 = base([
    line({ seq: 9, skill: "OPS_ACTION", mark: "missing skill OPS_ACTION", by: "Builder", date: "2026-10-14", changed: "PeaceAI-Workspace#902" }),
    line({ seq: 10, skill: "THROW_GUARD", mark: "PeaceAI-able today", by: "PeaceAI", date: "2026-10-14", changed: "PeaceAI-Workspace#9021, PeaceSTOCKS@abcdef2" }),
    line({ seq: 11, skill: "TEST_CASE", mark: "PeaceAI-able today", by: "PeaceAI", date: "2026-10-14", changed: "PeaceAI-Workspace#902, PeaceSTOCKS@abcdef3" }),
    R(12, 9, "THROW_GUARD", "PeaceAI-able today"),
  ]);
  assert.deepEqual(validateLog(b2), []);
  assert.equal(coverageReport(b2, "2026-10-15").allTime.peaceaiAble, 2);
  // Positive control: approved before + a by:PeaceAI landing of that skill referencing the task's issue.
  const ok = base([
    line({ seq: 9, skill: "OPS_ACTION", mark: "missing skill OPS_ACTION", by: "Builder", date: "2026-10-14", changed: "PeaceAI-Workspace#902" }),
    line({ seq: 10, skill: "THROW_GUARD", mark: "PeaceAI-able today", by: "PeaceAI", date: "2026-10-14", changed: "PeaceSTOCKS@abcdef4", why: "PeaceAI-Workspace#902 candidate landed" }),
    R(11, 9, "THROW_GUARD", "PeaceAI-able today"),
  ]);
  assert.deepEqual(validateLog(ok), []);
  assert.equal(coverageReport(ok, "2026-10-15").allTime.peaceaiAble, 3);
  assert.equal(retagCountable(entriesOf(ok)[8]!, "THROW_GUARD", entriesOf(ok)), true);
});

test("PeaceAI real task: source: peace + on-main sha counts in num and denom", () => {
  const text = FIXTURE + line({
    seq: 9,
    skill: "THROW_GUARD",
    mark: "PeaceAI-able today",
    by: "PeaceAI",
    date: "2026-10-14",
    asked: "Peace's task PeaceAI-Workspace#900 (source: peace): guard something real",
    changed: "PeaceAI-Workspace#900, PeaceSTOCKS@abcd123",
    why: "PeaceAI produced the candidate for Peace's task #900 and it landed",
  }) + "\n";
  assert.deepEqual(validateLog(text), []);
  const deny = coverageReport(text, "2026-10-15");
  assert.equal(deny.allTime.builderTasks, 6);
  assert.equal(deny.allTime.peaceaiAble, 2, "fail closed without onMain");
  const allow = coverageReport(text, "2026-10-15", { onMain: (sha) => sha === "abcd123" });
  assert.equal(allow.allTime.builderTasks, 7);
  assert.equal(allow.allTime.peaceaiAble, 3);
  assert.equal(isPeaceRealTask(entriesOf(text)[8]!, (sha) => sha === "abcd123"), true);
});

test("PeaceAI coverage:none field excludes even with source: peace; wording without field fails validateLog", () => {
  const withField = FIXTURE + line({
    seq: 9,
    skill: "THROW_GUARD",
    mark: "PeaceAI-able today",
    by: "PeaceAI",
    date: "2026-10-14",
    asked: "Peace's task PeaceAI-Workspace#901 (source: peace): mechanism only",
    changed: "PeaceAI-Workspace#901, PeaceSTOCKS@abcd124",
    why: "mechanism landing recorded",
    coverage: "none",
  }) + "\n";
  assert.deepEqual(validateLog(withField), []);
  assert.equal(isCoverageNone(entriesOf(withField)[8]!), true);
  assert.equal(isProofOrNoCoverage(entriesOf(withField)[8]!), true);
  const r = coverageReport(withField, "2026-10-15", { onMain: () => true });
  assert.equal(r.allTime.builderTasks, 6);
  assert.equal(r.allTime.peaceaiAble, 2);

  // Auditor: proof wording without coverage:"none" (and not grandfathered) fails validateLog.
  const wordingOnly = FIXTURE + line({
    seq: 9,
    skill: "THROW_GUARD",
    mark: "PeaceAI-able today",
    by: "PeaceAI",
    date: "2026-10-14",
    asked: "Peace's task PeaceAI-Workspace#902 (source: peace): live proof wording only",
    changed: "PeaceAI-Workspace#902, PeaceSTOCKS@abcd125",
    why: "behavior-neutral mechanism proof, no coverage credit in prose",
  }) + "\n";
  assert.ok(validateLog(wordingOnly).some((e) => /proof wording requires coverage:"none"/.test(e)));
});

test("all-time window is bounded by asOf (later PeaceAI real tasks drop out)", () => {
  const text = FIXTURE + line({
    seq: 9,
    skill: "THROW_GUARD",
    mark: "PeaceAI-able today",
    by: "PeaceAI",
    date: "2026-10-16",
    asked: "Peace's task PeaceAI-Workspace#910 (source: peace): later real task",
    changed: "PeaceAI-Workspace#910, PeaceSTOCKS@abcd910",
    why: "PeaceAI produced the candidate for Peace's task #910 and it landed",
  }) + "\n";
  assert.deepEqual(validateLog(text), []);
  const onMain = (sha: string) => sha === "abcd910";
  assert.equal(coverageReport(text, "2026-10-15", { onMain }).allTime.builderTasks, 6);
  assert.equal(coverageReport(text, "2026-10-15", { onMain }).allTime.peaceaiAble, 2);
  assert.equal(coverageReport(text, "2026-10-16", { onMain }).allTime.builderTasks, 7);
  assert.equal(coverageReport(text, "2026-10-16", { onMain }).allTime.peaceaiAble, 3);
});

test("PeaceAI entry without source: peace is excluded from real-task credit", () => {
  const text = FIXTURE + line({
    seq: 9,
    skill: "THROW_GUARD",
    mark: "PeaceAI-able today",
    by: "PeaceAI",
    date: "2026-10-14",
    asked: "Guard planBackfillRanges against non-positive maxRanges, landed",
    changed: "PeaceSTOCKS@abcd126",
    why: "candidate chosen in review and landed on main",
  }) + "\n";
  assert.deepEqual(validateLog(text), []);
  assert.equal(isPeaceRealTask(entriesOf(text)[8]!, () => true), false);
  assert.equal(coverageReport(text, "2026-10-15", { onMain: () => true }).allTime.builderTasks, 6);
  assert.equal(coverageReport(text, "2026-10-15", { onMain: () => true }).allTime.peaceaiAble, 2);
});

test("PeaceAI real task: sha not on main is excluded (fail closed)", () => {
  const text = FIXTURE + line({
    seq: 9,
    skill: "THROW_GUARD",
    mark: "PeaceAI-able today",
    by: "PeaceAI",
    date: "2026-10-14",
    asked: "Peace's task PeaceAI-Workspace#903 (source: peace): guard something",
    changed: "PeaceAI-Workspace#903, PeaceSTOCKS@deadbee",
    why: "PeaceAI produced the candidate for Peace's task #903 and it landed",
  }) + "\n";
  assert.deepEqual(validateLog(text), []);
  assert.equal(peaceStocksSha("PeaceSTOCKS@deadbee"), "deadbee");
  assert.equal(isPeaceRealTask(entriesOf(text)[8]!, (sha) => sha === "onmain1"), false);
  assert.equal(isPeaceRealTask(entriesOf(text)[8]!, null), false, "null checker fails closed");
  const r = coverageReport(text, "2026-10-15", { onMain: (sha) => sha === "onmain1" });
  assert.equal(r.allTime.builderTasks, 6);
  assert.equal(r.allTime.peaceaiAble, 2);
  // Checker throw also fails closed.
  assert.equal(
    isPeaceRealTask(entriesOf(text)[8]!, () => {
      throw new Error("git missing");
    }),
    false,
  );
});

test("secondary figure excludes PEACEAI_SELF_CHANGE, is labelled, and never replaces the official figure (which stays first)", () => {
  const row = (seq: number, skill: string, mark: string) => JSON.stringify({ seq, date: "2026-10-16", time: "01:00", asked: "A synthetic coverage task", changed: "none (synthetic)", why: "Synthetic row for the secondary figure test", skill, mark, by: "Builder" });
  const log = [row(1, "PEACEAI_SELF_CHANGE", "missing skill PEACEAI_SELF_CHANGE"), row(2, "PEACEAI_SELF_CHANGE", "missing skill PEACEAI_SELF_CHANGE"), row(3, "ENV_FIX", "missing skill ENV_FIX"), row(4, "ENV_FIX", "missing skill ENV_FIX")].join("\n") + "\n";
  const r = coverageReport(log, "2026-10-16");
  assert.equal(r.allTime.builderTasks, 4, "official denominator unchanged");
  assert.equal(r.excludingSelfChange.allTime.builderTasks, 2);
  assert.equal(r.excludingSelfChange.last7Days.builderTasks, 2);
  assert.equal(r.excludingSelfChange.label, EXCL_SELF_LABEL);
  assert.match(EXCL_SELF_LABEL, /secondary: excluding PEACEAI_SELF_CHANGE \(not the official figure\)/);
  const md = formatCoverageSummary(r);
  const official = md.indexOf("| all-time | 0% (0/4) |"), secondary = md.indexOf("| window (excl. PEACEAI_SELF_CHANGE) |");
  assert.ok(official > 0 && secondary > official, "official first, secondary after");
  assert.match(md, /\| all-time \| 0% \(0\/2\) \|/);
  // Real log: the official figure is exactly what it was; the secondary only ever drops tasks.
  const text = readFileSync(resolve(import.meta.dirname, "tasks.jsonl"), "utf8");
  const real = coverageReport(text, "2026-10-16");
  assert.ok(real.excludingSelfChange.allTime.builderTasks < real.allTime.builderTasks);
  assert.equal(real.excludingSelfChange.allTime.peaceaiAble, real.allTime.peaceaiAble);
});
