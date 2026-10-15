// PeaceAI vs Builder coverage: live-proven only (PeaceAI + repo@sha), 7d + all-time, top missing.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import {
  coverageReport,
  denverYmd,
  formatCoverageSummary,
  LIVE_LANDING,
  liveProvenSkills,
  parseLogEntries,
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
};

/** Canonical key order required by the log validator. */
const line = (e: Fields): string =>
  JSON.stringify({
    seq: e.seq,
    date: e.date ?? "2026-10-13",
    time: e.time ?? "12:00",
    asked: e.asked ?? `fixture asked text for seq ${e.seq}`,
    changed: e.changed ?? "none (fixture)",
    why: e.why ?? "fixture why text here",
    skill: e.skill,
    mark: e.mark,
    by: e.by,
  });

const LOG = [
  line({ seq: 1, skill: "OPS_ACTION", mark: "missing skill OPS_ACTION", by: "Builder", date: "2026-10-10" }),
  line({ seq: 2, skill: "IMPORT_EDIT", mark: "missing skill IMPORT_EDIT", by: "Builder", date: "2026-10-10", changed: "PeaceSTOCKS@abc1234" }),
  line({ seq: 3, skill: "THROW_GUARD", mark: "PeaceAI-able today", by: "PeaceAI", date: "2026-10-11", changed: "PeaceSTOCKS@def5678" }),
  line({ seq: 4, skill: "THROW_GUARD", mark: "PeaceAI-able today", by: "Builder", date: "2026-10-12", changed: "PeaceSTOCKS@aaa1111" }),
  line({ seq: 5, skill: "TEST_CASE", mark: "PeaceAI-able today", by: "PeaceAI", date: "2026-10-12", changed: "PeaceAI-Workspace#99" }), // issue only: not a live landing
  line({ seq: 6, skill: "COMPLEX_FUNCTION", mark: "missing skill COMPLEX_FUNCTION", by: "Builder", date: "2026-10-14", changed: "PeaceSTOCKS@bbb2222" }),
  line({ seq: 7, skill: "OPS_ACTION", mark: "missing skill OPS_ACTION", by: "Builder", date: "2026-10-14" }),
  line({ seq: 8, skill: "WORKFLOW_STEP", mark: "PeaceAI-able today", by: "Builder", date: "2026-10-14", changed: "PeaceAI-Workspace#125" }), // approved, no PeaceAI@sha for this skill
].join("\n") + "\n";

test("LIVE_LANDING matches repo@sha only, not issue refs", () => {
  assert.ok(LIVE_LANDING.test("PeaceSTOCKS@abc1234"));
  assert.ok(LIVE_LANDING.test("PeaceAI-Workspace@deadbee"));
  assert.ok(!LIVE_LANDING.test("PeaceAI-Workspace#99"));
  assert.ok(!LIVE_LANDING.test("none (fixture)"));
});

test("live-proven: PeaceAI + repo@sha only; approved-without-landing and issue-only do not count", () => {
  const entries = parseLogEntries(LOG);
  assert.deepEqual([...liveProvenSkills(entries)].sort(), ["THROW_GUARD"]);
});

test("coverage: all-time and last-7-days % of Builder tasks; top missing ranked by count", () => {
  const r = coverageReport(LOG, "2026-10-15");
  assert.deepEqual(r.liveProven, ["THROW_GUARD"]);
  // Builder seqs: 1,2,4,6,7,8 → 6 tasks; only seq4 THROW_GUARD is able → 1/6 ≈ 16.7%
  assert.equal(r.allTime.builderTasks, 6);
  assert.equal(r.allTime.peaceaiAble, 1);
  assert.equal(r.allTime.percent, 16.7);
  // 7d window 2026-10-09..15 includes all of the above
  assert.equal(r.last7Days.builderTasks, 6);
  assert.equal(r.last7Days.peaceaiAble, 1);
  assert.equal(r.last7Days.percent, 16.7);
  assert.deepEqual(
    r.topMissing.map((m) => [m.skill, m.count]),
    [
      ["OPS_ACTION", 2],
      ["COMPLEX_FUNCTION", 1],
      ["IMPORT_EDIT", 1],
      ["WORKFLOW_STEP", 1],
    ],
  );
});

test("last 7 days excludes Builder tasks older than the window", () => {
  const older =
    [
      line({ seq: 1, skill: "OPS_ACTION", mark: "missing skill OPS_ACTION", by: "Builder", date: "2026-10-01" }),
      line({ seq: 2, skill: "THROW_GUARD", mark: "PeaceAI-able today", by: "PeaceAI", date: "2026-10-02", changed: "PeaceSTOCKS@abc1234" }),
      line({ seq: 3, skill: "THROW_GUARD", mark: "PeaceAI-able today", by: "Builder", date: "2026-10-14", changed: "PeaceSTOCKS@abc1235" }),
      line({ seq: 4, skill: "IMPORT_EDIT", mark: "missing skill IMPORT_EDIT", by: "Builder", date: "2026-10-14", changed: "PeaceSTOCKS@abc1236" }),
    ].join("\n") + "\n";
  const r = coverageReport(older, "2026-10-15");
  assert.equal(r.allTime.builderTasks, 3);
  assert.equal(r.allTime.peaceaiAble, 1);
  assert.equal(r.allTime.percent, 33.3);
  assert.equal(r.last7Days.builderTasks, 2); // seq 3,4 only (Oct 9..15)
  assert.equal(r.last7Days.peaceaiAble, 1);
  assert.equal(r.last7Days.percent, 50);
});

test("empty Builder window yields null percent; invalid inputs refused", () => {
  const onlyPeace =
    line({ seq: 1, skill: "THROW_GUARD", mark: "PeaceAI-able today", by: "PeaceAI", date: "2026-10-14", changed: "PeaceSTOCKS@abc1234" }) + "\n";
  const r = coverageReport(onlyPeace, "2026-10-15");
  assert.equal(r.allTime.builderTasks, 0);
  assert.equal(r.allTime.percent, null);
  assert.equal(r.last7Days.percent, null);
  assert.throws(() => coverageReport(LOG, "bad"), /bad asOf/);
  assert.throws(() => coverageReport(LOG, "2026-10-15", 0), /topN/);
  assert.throws(() => coverageReport('{"seq":1}\n', "2026-10-15"), /builder-log invalid/);
});

test("formatCoverageSummary names the metric and lists missing skills", () => {
  const md = formatCoverageSummary(coverageReport(LOG, "2026-10-15"));
  assert.match(md, /## PeaceAI vs Builder/);
  assert.match(md, /live-proven/);
  assert.match(md, /last 7 days \| 16\.7% \(1\/6\)/);
  assert.match(md, /all-time \| 16\.7% \(1\/6\)/);
  assert.match(md, /`THROW_GUARD`/);
  assert.match(md, /\| OPS_ACTION \| 2 \|/);
  assert.doesNotMatch(md, /TEST_CASE/); // issue-only PeaceAI entry must not invent a live-proven skill
});

test("real log: live-proven excludes APPROVED_SINCE skills without a PeaceAI@sha landing", () => {
  const text = readFileSync(resolve(import.meta.dirname, "tasks.jsonl"), "utf8");
  const r = coverageReport(text, denverYmd());
  assert.ok(r.liveProven.includes("THROW_GUARD"));
  assert.ok(!r.liveProven.includes("WORKFLOW_STEP"), "approved-but-unproven");
  assert.ok(!r.liveProven.includes("CHECK_OBJECT_LITERAL_ARGS"), "approved-but-unproven");
  assert.ok(r.allTime.builderTasks > 0);
  assert.ok(r.topMissing.length > 0);
  assert.match(formatCoverageSummary(r), /PeaceAI vs Builder/);
});
