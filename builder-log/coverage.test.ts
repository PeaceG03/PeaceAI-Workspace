// PeaceAI vs Builder coverage: live-proven only (PeaceAI + repo@sha / validated LIVE_PROVEN_SINCE).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { LIVE_LANDING_REF, LIVE_PROVEN_SINCE, validateLiveProven, validateLog, type Entry } from "./check.ts";
import {
  coverageReport,
  denverYmd,
  formatCoverageSummary,
  LIVE_LANDING,
  liveProvenSkills,
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

const entriesOf = (text: string): Entry[] => text.split("\n").filter(Boolean).map((l) => JSON.parse(l) as Entry);

const FIXTURE = [
  line({ seq: 1, skill: "OPS_ACTION", mark: "missing skill OPS_ACTION", by: "Builder", date: "2026-10-10" }),
  line({ seq: 2, skill: "IMPORT_EDIT", mark: "missing skill IMPORT_EDIT", by: "Builder", date: "2026-10-10", changed: "PeaceSTOCKS@abc1234" }),
  line({ seq: 3, skill: "THROW_GUARD", mark: "PeaceAI-able today", by: "PeaceAI", date: "2026-10-11", changed: "PeaceSTOCKS@def5678" }),
  line({ seq: 4, skill: "THROW_GUARD", mark: "PeaceAI-able today", by: "Builder", date: "2026-10-12", changed: "PeaceSTOCKS@aaa1111" }),
  line({ seq: 5, skill: "TEST_CASE", mark: "PeaceAI-able today", by: "PeaceAI", date: "2026-10-12", changed: "PeaceAI-Workspace#99" }),
  line({ seq: 6, skill: "COMPLEX_FUNCTION", mark: "missing skill COMPLEX_FUNCTION", by: "Builder", date: "2026-10-14", changed: "PeaceSTOCKS@bbb2222" }),
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
  assert.deepEqual([...liveProvenSkills(entries, "2026-10-15")].sort(), ["THROW_GUARD", "WORKFLOW_STEP"]);
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

test("real log: 3/58 = 5.2%; WORKFLOW_STEP live-proven via seq 85; CHECK_OBJECT_LITERAL_ARGS not", () => {
  const text = readFileSync(resolve(import.meta.dirname, "tasks.jsonl"), "utf8");
  assert.deepEqual(validateLog(text), []);
  assert.equal(LIVE_PROVEN_SINCE.WORKFLOW_STEP.seq, 85);
  assert.equal(LIVE_PROVEN_SINCE.WORKFLOW_STEP.since, "2026-10-15 12:02");
  const r = coverageReport(text, "2026-10-15");
  assert.ok(r.liveProven.includes("THROW_GUARD"));
  assert.ok(r.liveProven.includes("WORKFLOW_STEP"));
  assert.ok(!r.liveProven.includes("CHECK_OBJECT_LITERAL_ARGS"));
  assert.equal(r.allTime.builderTasks, 58);
  assert.equal(r.allTime.peaceaiAble, 3);
  assert.equal(r.allTime.percent, 5.2);
  assert.equal(r.last7Days.builderTasks, 58);
  assert.equal(r.last7Days.peaceaiAble, 3);
  assert.equal(r.last7Days.percent, 5.2);
  assert.ok(!r.topMissing.some((m) => m.skill === "WORKFLOW_STEP"));
  const md = formatCoverageSummary(r);
  assert.match(md, /## PeaceAI vs Builder/);
  assert.match(md, /5\.2% \(3\/58\)/);
  assert.equal(coverageReport(text, denverYmd()).allTime.percent, 5.2);
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
