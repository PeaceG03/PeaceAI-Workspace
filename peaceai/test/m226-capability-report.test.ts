// M226: headline real-pass report. A row with no fresh execution is unmeasured, never a pass.
// EXPERIMENTAL. credit is false. Reads the committed log. No network, no writes.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { buildCapabilityReport, realPercent } from "../lib/capabilityreport.ts";
import { loadReplay } from "../bin/capability-report.ts";

const log = readFileSync(resolve(import.meta.dirname, "../../builder-log/tasks.jsonl"), "utf8");
const onMain = (sha: string) => /^[0-9a-f]{7,40}$/.test(sha);

test("unmeasured is not a pass, and the headline stays unknown", () => {
  const r = buildCapabilityReport(log, "2026-11-10", onMain);
  assert.equal(r.credit, false);
  assert.equal(r.experimental, true);
  assert.equal(r.passes, 0);
  assert.equal(r.fails, 0);
  assert.equal(r.unmeasured, r.setSize);
  assert.equal(r.realPassPercent, null);
  assert.equal(r.realPass, "unknown");
  assert.equal(r.official.able, 91);
  assert.equal(r.official.tasks, 276);
  assert.equal(r.official.percent, 33);
  assert.ok(r.rows.every((row) => row.status !== "pass"));
  assert.equal(r.gaps[0]?.skill, "PEACEAI_SELF_CHANGE");
  assert.equal(r.gaps[0]?.officialMissing, 146);
});

test("a fresh pass counts, and one pass does not turn the rest into passes", () => {
  const base = buildCapabilityReport(log, "2026-11-10", onMain);
  const seq = base.rows.find((row) => row.inSet && row.officialAble)!.seq;
  const r = buildCapabilityReport(log, "2026-11-10", onMain, [{ seq, status: "pass", reason: "replayed" }]);
  assert.equal(r.passes, 1);
  assert.equal(r.unmeasured, r.setSize - 1);
  assert.equal(r.realPass, "unknown");
  assert.equal(r.rows.find((row) => row.seq === seq)?.status, "pass");
  assert.equal(r.rows.filter((row) => row.status === "pass").length, 1);
});

test("the percent is passes over the set only when every row was measured", () => {
  assert.equal(realPercent(83, 220, 0), 37.7);
  assert.equal(realPercent(91, 222, 0), 41);
  assert.equal(realPercent(0, 276, 276), null);
  assert.equal(realPercent(1, 276, 275), null);
});

test("replay text with a hole or a bad status is refused", () => {
  assert.deepEqual(loadReplay('{"seq":1,"status":"fail","reason":"NO_RULE"}\n'), [{ seq: 1, status: "fail", reason: "NO_RULE" }]);
  assert.throws(() => loadReplay('{"seq":1,"status":"pass","reason":""}\n'), /replay record invalid/);
  assert.throws(() => loadReplay('{"seq":1,"status":"yes","reason":"x"}\n'), /replay record invalid/);
});
