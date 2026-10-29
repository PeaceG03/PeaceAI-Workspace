// PeaceAI vs Builder coverage: live-proven only (PeaceAI + repo@sha / validated LIVE_PROVEN_SINCE).
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
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
  isWorkspaceRealTask,
  makeWorkspaceProofChecker,
  WORKSPACE_LANDING_SINCE,
  workspaceRefusal,
  workspaceTouchRefusal,
  type DeriveRunFacts,
  type WorkspaceLandingFacts,
  type WorkspaceProofChecker,
  LIVE_LANDING,
  liveProvenSkills,
  parseLogEntries,
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

test("real log: 20/143 as of 2026-10-16, 32/159 as of 2026-10-17, 39/169 as of 2026-10-20, 61/192 as of 2026-10-21 and 74/205 then 89/226 on 2026-10-22, 91/276 today (S3 catch-up seq 282-333 + seq 334-335 for #575/#578) with PeaceAI real tasks (98/100/102-105, batch 106-115, 118, 122, 126-132, 134-138, 139-145, 226-236, 237-247, 248-260, 261-275, 276-277) + Builder rows incl. the seq 146-220 catch-up; seq 97/99/101 coverage:none allowlist; METHOD_GUARD 71/77 stay missing", () => {
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
  // Seq 146-163: Builder PRs merged the evening of 2026-10-15 MT (#217-#246), logged in the M88 catch-up.
  assert.equal(r15.allTime.builderTasks, 78);
  assert.equal(r15.allTime.peaceaiAble, 4);
  assert.equal(r15.last7Days.builderTasks, 78);
  assert.equal(r15.last7Days.peaceaiAble, 4);
  // asOf today: full 8/64 including IMPORT_EDIT live-proven and seq 102 in the 7-day window.
  const r = coverageReport(text, "2026-10-16", { onMain });
  assert.ok(r.liveProven.includes("IMPORT_EDIT"));
  // Retags (seq 88-96): 70/78 -> THROW_GUARD, 71/77 -> METHOD_GUARD, 8/12/17/19/22 -> LOOP_FUNCTION.
  // Denom: 58 Builder + 6 PeaceAI real (98, 100, 102, 103, 104, 105). Proof-worded rows are COVERAGE_NONE_SEQS (incl. 97/99/101).
  // M88 catch-up: + Builder PEACEAI_SELF_CHANGE rows dated 2026-10-15/16 (seq 146-190), denominator only.
  // + seq 213-220: 8 Builder tasks from 11 direct pushes to PeaceSTOCKS main 2026-10-16 01:19-02:05 MT (missing skill), denominator only.
  assert.equal(r.allTime.builderTasks, 143);
  // Counted: seq 26 TEST_CASE + seq 70 retag THROW_GUARD + PeaceAI real 98/100/102/103/104/105 + batch 106-115 (THROW_GUARD) + 118 (METHOD_GUARD) + 122 (ENV_FIX).
  // Not: 71/77 (before METHOD_GUARD approval), 78 (nothing landed), 10/13 (pre-approval WORKFLOW_STEP).
  assert.equal(r.allTime.peaceaiAble, 20);
  assert.equal(r.allTime.percent, 14);
  assert.equal(r.last7Days.builderTasks, 143);
  assert.equal(r.last7Days.peaceaiAble, 20);
  assert.equal(r.last7Days.percent, 14);
  assert.deepEqual(r.topMissing.find((m) => m.skill === "METHOD_GUARD"), { skill: "METHOD_GUARD", count: 2 });
  // Seq 213-220 add ENV_FIX x3, WORKFLOW_JOB x2, MODIFY_LOGIC x2, TSCONFIG_SCRIPT x1 (all pre-approval / no rule); THROW_GUARD's
  // single missing row (count 1) now ties below the top-10 cut behind CHECK_OBJECT_LITERAL_ARGS.
  assert.deepEqual(r.topMissing.find((m) => m.skill === "ENV_FIX"), { skill: "ENV_FIX", count: 4 });
  assert.deepEqual(r.topMissing.find((m) => m.skill === "MODIFY_LOGIC"), { skill: "MODIFY_LOGIC", count: 2 });
  assert.deepEqual(r.topMissing.find((m) => m.skill === "WORKFLOW_JOB"), { skill: "WORKFLOW_JOB", count: 6 });
  assert.ok(!r.topMissing.some((m) => m.skill === "THROW_GUARD"));
  assert.deepEqual(r.topMissing.find((m) => m.skill === "WORKFLOW_STEP"), { skill: "WORKFLOW_STEP", count: 2 }, "seq 10/13 logged before WORKFLOW_STEP approval");
  assert.deepEqual(r.topMissing.find((m) => m.skill === "LOOP_FUNCTION"), { skill: "LOOP_FUNCTION", count: 5 });
  assert.ok(!r.topMissing.some((m) => m.skill === "COMPLEX_FUNCTION"));
  const md = formatCoverageSummary(r);
  assert.match(md, /## PeaceAI vs Builder/);
  assert.match(md, /14% \(20\/143\)/);
  // Batch v4 coverage (seq 126-132, #353-#359 landed 2026-10-17 as PeaceSTOCKS@1a6e6cd..47cfaaf): +7 PeaceAI real tasks in
  // both numerator and denominator -> 27/83. Proof rows 123-125 (ops C, self-change A #341/#345, date B #350) are coverage:none.
  // TEST_CASE_EXISTING (seq 134-138, #370-#374 landed 2026-10-17 as PeaceSTOCKS@af3050f..5c41528, stacked on #368's 83904c3):
  // +5 PeaceAI real tasks -> 32/88. Proof row 133 (#368 landing, #369 refusal) is coverage:none.
  const r17 = coverageReport(text, "2026-10-17", { onMain });
  assert.equal(r17.allTime.builderTasks, 159);
  assert.equal(r17.allTime.peaceaiAble, 32);
  assert.equal(r17.allTime.percent, 20.1);
  // Batch v5 (seq 139-145, #390-#396 on public-test-case-existing-v2, landed 2026-10-20 through verdict PRs
  // PeaceSTOCKS#11-#17 as PeaceSTOCKS@cb6f257..8b1f413): +7 PeaceAI real tasks -> 39/95. #397 was refused (no row).
  const r20 = coverageReport(text, "2026-10-20", { onMain });
  // M88 Builder-log catch-up (seq 146-212): 67 Builder PRs merged on PeaceAI-Workspace main after seq 96 (#217-#398,
  // PEACEAI_SELF_CHANGE, missing skill), denominator only. Seq 213-220 (PeaceSTOCKS direct pushes, 2026-10-16) add 8 more: 39/169 as of
  // 2026-10-20 and 39/170 from 2026-10-21 (seq 212, #398).
  assert.equal(r20.allTime.builderTasks, 169);
  assert.equal(r20.allTime.peaceaiAble, 39);
  assert.equal(r20.allTime.percent, 23.1);
  assert.equal(r20.excludingSelfChange.allTime.builderTasks, 78);
  assert.equal(r20.excludingSelfChange.allTime.percent, 50);
  const today = coverageReport(text, denverYmd(), { onMain });
  // Seq 221-225 (#399-#403, PeaceAI TEST_CASE_EXISTING landings on PeaceAI-Workspace via verdict PRs #406-#410, 2026-10-21)
  // name no PeaceSTOCKS@sha, so isPeaceRealTask leaves them out (39/170 before batch v7).
  // Batch v7 (seq 226-236, #415-#425 on public-test-case-existing-v2/v3, landed 2026-10-21 through verdict PRs
  // PeaceSTOCKS#18-#28 as PeaceSTOCKS@e9cbc92..663e31e): +11 PeaceAI real tasks -> 50/181.
  // Batch v8 (seq 237-247, #427-#437 on public-test-case-existing-v1/v2, landed 2026-10-21 22:02 MT through verdict PRs
  // PeaceSTOCKS#29-#39 as merge commits 625acbf to ef9778e): +11 PeaceAI real tasks -> 61/192.
  const r21 = coverageReport(text, "2026-10-21", { onMain });
  assert.equal(r21.allTime.peaceaiAble, 61);
  assert.equal(r21.allTime.builderTasks, 192);
  assert.equal(r21.allTime.percent, 31.8);
  // Batch v9 (seq 248-260, #443-#455 on public-test-case-existing-v1/v3/v4, landed 2026-10-22 02:57 MT through verdict PRs
  // PeaceSTOCKS#40-#52 as merge commits 3ed589e to 0ab37c8): +13 PeaceAI real tasks -> 74/205.
  // Batch v10 (seq 261-275, #471-#485 on public-test-case-existing-v5/v6, landed 2026-10-22 18:33 MT through verdict PRs
  // PeaceSTOCKS#53-#67 as merge commits 6a41f91 to 8ff15d3): +15 PeaceAI real tasks -> 89/220.
  // S3 Builder catch-up (seq 282-333, Workspace PRs #462-#574 merged 2026-10-22..28 MT, PEACEAI_SELF_CHANGE, missing skill,
  // coverage:none): denominator only. Six are dated 2026-10-22 MT (#462, #463, #465, #466, #489, #492) -> 89/226.
  const r22 = coverageReport(text, "2026-10-22", { onMain });
  assert.equal(r22.allTime.peaceaiAble, 89);
  assert.equal(r22.allTime.builderTasks, 226);
  assert.equal(r22.allTime.percent, 39.4);
  // S1/S2 (seq 276-277, #501/#502 on public-derive-from-behavior-v1, DERIVE_FROM_BEHAVIOR, landed 2026-10-24 22:07 MT through
  // verdict PRs PeaceSTOCKS#70/#71 as merge commits d6f3da9 and 0bbb039): +2 PeaceAI real tasks -> 91/222.
  // + the S3 catch-up's 52 Builder rows (seq 282-333), denominator only: 91/274 (33.2%). The numerator and the secondary
  // figure excluding PEACEAI_SELF_CHANGE (91/130) do not move.
  // + seq 334 (#575, merged 2026-10-28 23:46 MT) and seq 335 (#578, merged 2026-10-29 00:09 MT), Builder
  // PEACEAI_SELF_CHANGE rows, denominator only: 91/275 (33.1%) on 2026-10-28 and 91/276 (33%) from 2026-10-29.
  assert.equal(coverageReport(text, "2026-10-28", { onMain }).allTime.builderTasks, 275);
  assert.equal(coverageReport(text, "2026-10-28", { onMain }).allTime.percent, 33.1);
  assert.equal(today.allTime.peaceaiAble, 91);
  assert.equal(today.allTime.builderTasks, 276);
  assert.equal(today.allTime.percent, 33);
  assert.equal(today.excludingSelfChange.allTime.peaceaiAble, 91);
  assert.equal(today.excludingSelfChange.allTime.builderTasks, 130);
  // Health-check slice 1 (seq 278-281, team-picked #513-#516 on DERIVE_FROM_BEHAVIOR v1/v1/v1/v2, landed 2026-10-26 01:09 MT
  // through verdict PRs PeaceSTOCKS#73/#72/#74/#75 as 24025a3, f01a60d, 6cdbc2b, 8dec076): recorded as team-picked, not
  // "(source: peace)" (Auditor), so they earn no real-task credit and the figure stays 91/222.
  for (const seq of [278, 279, 280, 281]) {
    const e = parseLogEntries(text).find((x) => x.seq === seq)!;
    assert.equal(isPeaceRealTask(e, onMain), false);
  }
  // Fail closed without an onMain checker: PeaceAI real tasks drop out → back to Builder-only 2/187 (133 + 52 S3 rows + seq 334-335).
  assert.equal(coverageReport(text, denverYmd()).allTime.peaceaiAble, 2);
  assert.equal(coverageReport(text, denverYmd()).allTime.builderTasks, 187);
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

// ---- PeaceAI-Workspace landings (Auditor ruling (a)) ----

const WS_DIFF = "diff --git a/docs/ws-note.md b/docs/ws-note.md\nnew file mode 100644\nindex 0000000000000000000000000000000000000000..e69de29bb2d1d6434b8b29ae775ad8c2e48c5391\n";
const WS_DIFF_SHA = createHash("sha256").update(WS_DIFF, "utf8").digest("hex");
const wsRow = (over: Partial<Fields> = {}): string =>
  line({
    seq: 1,
    date: "2026-10-29",
    time: "10:00",
    asked: "Peace's task PeaceAI-Workspace#950 (source: peace): add a docs note",
    changed: "PeaceAI-Workspace#950, PeaceAI-Workspace@abc1234",
    why: `PeaceAI derived and landed it; ws-proof: run 111 candidate-1 diff-sha256 ${WS_DIFF_SHA} verdict 555`,
    skill: "DERIVE_FROM_BEHAVIOR",
    mark: "PeaceAI-able today",
    by: "PeaceAI",
    ...over,
  });
const wsVerdict = (over: Record<string, unknown> = {}) =>
  ({ schema: "peaceai.verdict.v1", issue: 950, runId: "111", commentId: "555", recordedAt: "2026-10-29T16:00:00Z", label: "A", candidateId: "candidate-1", verdict: "right", ...over }) as never;
const emptyZone = () => ({ why: new Map<string, string>(), shadows: new Set<string>() });
type FakeOver = { derive?: Partial<DeriveRunFacts> | null; landing?: Partial<WorkspaceLandingFacts> | null };
const fakeWs = (o: FakeOver = {}): WorkspaceProofChecker => ({
  derive: (issue, runId, cand) =>
    o.derive === null || issue !== 950 || runId !== "111" || cand !== "candidate-1"
      ? null
      : { latestRunId: "111", target: "PeaceG03/PeaceAI-Workspace", source: "peace", candidate: { eligible: true, operationId: "learned:public-derive-from-behavior-v2@x" }, candidateDiffSha256: WS_DIFF_SHA, candidateDiff: WS_DIFF, verdicts: [wsVerdict()], ...o.derive },
  landing: (sha) =>
    o.landing === null || sha !== "abc1234"
      ? null
      : { onMain: true, appliedTree: "t1", landingTree: "t1", touched: [{ path: "docs/ws-note.md", status: "A" }], zone: emptyZone(), ...o.landing },
});
const wsEntry = (over: Partial<Fields> = {}) => parseLogEntries(wsRow(over) + "\n")[0]!;

test("Workspace landing: counts only with the full PeaceSTOCKS-equivalent proof (positive case)", () => {
  assert.equal(validateLog(wsRow() + "\n").length, 0, "the proof row is a valid log row");
  assert.equal(workspaceRefusal(wsEntry(), fakeWs()), null);
  assert.equal(isWorkspaceRealTask(wsEntry(), fakeWs()), true);
  const r = coverageReport(wsRow() + "\n", "2026-10-29", { workspace: fakeWs() });
  assert.equal(r.allTime.peaceaiAble, 1);
  assert.equal(r.allTime.builderTasks, 1);
  assert.equal(coverageReport(wsRow() + "\n", "2026-10-29").allTime.peaceaiAble, 0, "no checker: fail closed");
});

test("Workspace landing negatives: hash mismatch, not on main, missing verdict, protected/never-zone path, Builder row, dry run, live proof", () => {
  const no = (code: string, e: ReturnType<typeof wsEntry>, chk: WorkspaceProofChecker | null) => {
    assert.equal(workspaceRefusal(e, chk), code);
    assert.equal(isWorkspaceRealTask(e, chk), false);
  };
  // Hash mismatch: the clause's sha256 is not the recorded candidate diff, or the recorded bytes differ.
  no("W_HASH_MISMATCH", wsEntry({ why: `ws-proof: run 111 candidate-1 diff-sha256 ${"0".repeat(64)} verdict 555` }), fakeWs());
  no("W_HASH_MISMATCH", wsEntry(), fakeWs({ derive: { candidateDiff: WS_DIFF + " " } }));
  // Landing tree is not the candidate applied to the parent (not byte-identical).
  no("W_TREE_MISMATCH", wsEntry(), fakeWs({ landing: { appliedTree: "t2" } }));
  no("W_TREE_MISMATCH", wsEntry(), fakeWs({ landing: { appliedTree: null } }));
  // Sha not on Workspace main.
  no("W_NOT_ON_MAIN", wsEntry(), fakeWs({ landing: { onMain: false } }));
  // Verdict missing / not Peace's standing pick / names another comment.
  no("W_NO_VERDICT", wsEntry(), fakeWs({ derive: { verdicts: [] } }));
  no("W_NO_VERDICT", wsEntry(), fakeWs({ derive: { verdicts: [wsVerdict({ verdict: "wrong", candidateId: null, label: "none" })] } }));
  no("W_NO_VERDICT", wsEntry(), fakeWs({ derive: { verdicts: [wsVerdict(), wsVerdict({ commentId: "556", recordedAt: "2026-10-29T17:00:00Z", verdict: "unsure", label: "none", candidateId: null })] } }));
  no("W_NO_VERDICT", wsEntry({ why: `ws-proof: run 111 candidate-1 diff-sha256 ${WS_DIFF_SHA} verdict 999` }), fakeWs());
  // Protected / never-zone path touched.
  no("W_PROTECTED", wsEntry(), fakeWs({ landing: { touched: [{ path: "docs/ws-note.md", status: "A" }, { path: ".github/workflows/x.yml", status: "A" }] } }));
  no("W_PROTECTED", wsEntry(), fakeWs({ landing: { touched: [{ path: "builder-log/coverage.ts", status: "M" }] } }));
  no("W_PROTECTED", wsEntry(), fakeWs({ landing: { touched: [{ path: "src/text.test.ts", status: "M" }] } }));
  no("W_PROTECTED", wsEntry(), fakeWs({ landing: { touched: [{ path: "src/text.ts", status: "M" }], zone: { why: new Map([["src/text.ts", "imported by never-zone file x"]]), shadows: new Set() } } }));
  no("W_PROTECTED", wsEntry(), fakeWs({ landing: { touched: [{ path: "src/new.ts", status: "A" }], zone: { why: new Map(), shadows: new Set(["src/new.ts"]) } } }));
  // Builder-authored rows (and Builder PRs logged before the cutoff, e.g. seq 221-225) never count.
  no("W_NOT_PEACEAI", wsEntry({ by: "Builder" }), fakeWs());
  no("W_BEFORE_SINCE", wsEntry({ date: "2026-10-28", time: "23:59" }), fakeWs());
  assert.ok("2026-10-28 23:59" < WORKSPACE_LANDING_SINCE);
  // Dry run asked for / dry-run derive (no Results record for the run) / superseded run / not a learned candidate.
  no("W_DRY_RUN", wsEntry({ asked: "Peace's task PeaceAI-Workspace#950 (source: peace): dry run of the derive" }), fakeWs());
  no("W_NO_DERIVE_RUN", wsEntry(), fakeWs({ derive: null }));
  no("W_NO_DERIVE_RUN", wsEntry(), fakeWs({ derive: { latestRunId: "112" } }));
  no("W_NOT_REAL_DERIVE", wsEntry(), fakeWs({ derive: { candidate: { eligible: true, operationId: "supplied:hand" } } }));
  no("W_NOT_REAL_DERIVE", wsEntry(), fakeWs({ derive: { target: "PeaceG03/PeaceSTOCKS" } }));
  // Live proof / coverage:none.
  no("W_COVERAGE_NONE", wsEntry({ coverage: "none", why: `live proof row; ws-proof: run 111 candidate-1 diff-sha256 ${WS_DIFF_SHA} verdict 555` }), fakeWs());
  // Shape: no proof clause, no source tag, two landings, a PeaceSTOCKS landing mixed in, no checker, checker throws.
  no("W_NO_PROOF", wsEntry({ why: "PeaceAI derived and landed it, trust me" }), fakeWs());
  no("W_NOT_SOURCE_PEACE", wsEntry({ asked: "Peace's task PeaceAI-Workspace#950: add a docs note" }), fakeWs());
  no("W_LANDING", wsEntry({ changed: "PeaceAI-Workspace#950, PeaceAI-Workspace@abc1234, PeaceAI-Workspace@abc1235" }), fakeWs());
  no("W_LANDING", wsEntry({ changed: "PeaceAI-Workspace#950, PeaceAI-Workspace@abc1234, PeaceSTOCKS@abc1236" }), fakeWs());
  no("W_NO_CHECKER", wsEntry(), null);
  no("W_LOOKUP_FAILED", wsEntry(), { derive: () => { throw new Error("results missing"); }, landing: () => null });
  no("W_LOOKUP_FAILED", wsEntry(), fakeWs({ landing: null }));
});

test("workspaceTouchRefusal: new docs and new src modules/tests pass; protected, never-zone, existing tests and shadows refuse", () => {
  assert.equal(workspaceTouchRefusal("docs/ws-note.md", "A", emptyZone()), null);
  assert.equal(workspaceTouchRefusal("src/brand-new.ts", "A", emptyZone()), null);
  assert.equal(workspaceTouchRefusal("src/brand-new.test.ts", "A", emptyZone()), null);
  assert.match(workspaceTouchRefusal("src/theme.test.ts", "M", emptyZone()) ?? "", /existing test/);
  assert.match(workspaceTouchRefusal("peaceai/lib/derive.ts", "M", emptyZone()) ?? "", /protected|never-zone/);
  assert.match(workspaceTouchRefusal("package.json", "M", emptyZone()) ?? "", /protected|never-zone/);
});

test("Workspace landing with real git + Results dirs: byte-identical landing counts; altered landing or protected path refuses", () => {
  const root = mkdtempSync(join(tmpdir(), "cov-ws-test-"));
  try {
    const repo = join(root, "ws"), results = join(root, "results");
    const env = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@e", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@e", GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null" };
    const git = (...a: string[]) => execFileSync("git", ["-C", repo, ...a], { encoding: "utf8", env }).trim();
    mkdirSync(repo);
    git("init", "-q", "-b", "main");
    writeFileSync(join(repo, "README.md"), "hello\n");
    git("add", "-A");
    git("commit", "-qm", "base");
    const land = (files: Record<string, string>, extra: Record<string, string> = {}) => {
      git("checkout", "-q", "main");
      git("checkout", "-q", "-b", `c${Math.random().toString(36).slice(2)}`);
      for (const [f, t] of Object.entries(files)) { mkdirSync(dirname(join(repo, f)), { recursive: true }); writeFileSync(join(repo, f), t); }
      git("add", "-A");
      const diff = execFileSync("git", ["-C", repo, "diff", "--cached", "--binary", "--full-index", "--no-color", "--no-ext-diff", "--no-renames"], { encoding: "utf8", env });
      for (const [f, t] of Object.entries(extra)) writeFileSync(join(repo, f), t);
      git("add", "-A");
      git("commit", "-qm", "landing");
      const sha = git("rev-parse", "HEAD");
      git("checkout", "-q", "main");
      git("merge", "-q", "--ff-only", sha);
      return { diff, sha };
    };
    const record = (issue: number, run: string, diff: string) => {
      const d = join(results, "tasks", String(issue), run);
      mkdirSync(join(d, "candidates"), { recursive: true });
      mkdirSync(join(d, "verdicts"), { recursive: true });
      writeFileSync(join(d, "task.json"), JSON.stringify({ issue, runId: run, source: "peace", target: "PeaceG03/PeaceAI-Workspace" }));
      writeFileSync(join(d, "ranking.json"), JSON.stringify({ candidates: [{ id: "candidate-1", eligible: true, operationId: "learned:public-derive-from-behavior-v2@x" }] }));
      writeFileSync(join(d, "candidates", "candidate-1.diff"), diff);
      writeFileSync(join(d, "verdicts", "555.json"), JSON.stringify(wsVerdict({ issue, runId: run })));
      return createHash("sha256").update(diff, "utf8").digest("hex");
    };
    const row = (issue: number, run: string, sha: string, diffSha: string) =>
      wsEntry({ asked: `Peace's task PeaceAI-Workspace#${issue} (source: peace): docs`, changed: `PeaceAI-Workspace#${issue}, PeaceAI-Workspace@${sha}`, why: `ws-proof: run ${run} candidate-1 diff-sha256 ${diffSha} verdict 555` });
    const chk = makeWorkspaceProofChecker(repo, results);

    const good = land({ "docs/ws-note.md": "a note\n" });
    assert.equal(workspaceRefusal(row(950, "111", good.sha, record(950, "111", good.diff)), chk), null);

    const altered = land({ "docs/ws-two.md": "two\n" }, { "README.md": "edited by hand\n" });
    assert.equal(workspaceRefusal(row(951, "112", altered.sha, record(951, "112", altered.diff)), chk), "W_TREE_MISMATCH");

    const prot = land({ ".github/workflows/x.yml": "on: push\n" });
    assert.equal(workspaceRefusal(row(952, "113", prot.sha, record(952, "113", prot.diff)), chk), "W_PROTECTED");

    git("checkout", "-q", "-b", "side");
    const off = land({ "docs/ws-off.md": "off\n" });
    git("reset", "-q", "--hard", "HEAD~1");
    assert.equal(workspaceRefusal(row(953, "114", off.sha, record(953, "114", off.diff)), chk), "W_NOT_ON_MAIN");

    record(950, "120", good.diff);
    assert.equal(workspaceRefusal(row(950, "111", good.sha, createHash("sha256").update(good.diff, "utf8").digest("hex")), chk), "W_NO_DERIVE_RUN", "superseded by a later run");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("real log: the Workspace path changes nothing today (still 91 in the numerator); seq 221-225 never count even with an accept-all checker", () => {
  const text = readFileSync(resolve(import.meta.dirname, "tasks.jsonl"), "utf8");
  const acceptAll: WorkspaceProofChecker = {
    derive: (_i, runId, cand) => ({ latestRunId: runId, target: "PeaceG03/PeaceAI-Workspace", source: "peace", candidate: { eligible: true, operationId: "learned:x" }, candidateDiffSha256: null, candidateDiff: null, verdicts: [wsVerdict({ runId, candidateId: cand })] }),
    landing: () => ({ onMain: true, appliedTree: "t", landingTree: "t", touched: [{ path: "docs/x.md", status: "A" }], zone: emptyZone() }),
  };
  const onMain = () => true;
  const base = coverageReport(text, "2026-10-28", { onMain });
  const withWs = coverageReport(text, "2026-10-28", { onMain, workspace: acceptAll });
  assert.equal(withWs.allTime.peaceaiAble, base.allTime.peaceaiAble);
  assert.equal(withWs.allTime.builderTasks, base.allTime.builderTasks);
  for (const e of parseLogEntries(text)) assert.equal(isWorkspaceRealTask(e, acceptAll), false, `seq ${e.seq} must not count`);
});
