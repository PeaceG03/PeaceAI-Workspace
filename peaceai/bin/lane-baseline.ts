// Lane v1 baseline generator. Fills peaceai/self/lane-v1-baseline.json from a box replay.
// It reads a capability report and a practice replay, keeps passing row ids for the builder-log
// replay and the dev practice set, and copies held-out pass/fail/unmeasured counts only.
// Held-out diffs and reasons are not read.
//
// Fill the real baseline from a box replay (this overwrites the unlocked placeholder):
//   tsx peaceai/bin/lane-baseline.ts --capability <capability-report.json> --practice <replay.json> --source-sha <40-hex> --out peaceai/self/lane-v1-baseline.json
// A pre-stripped measure file works instead of the two reports:
//   tsx peaceai/bin/lane-baseline.ts --measure <lane-measure.json> --out peaceai/self/lane-v1-baseline.json
// The measure's sourceSha becomes the recorded last-good commit. Do not invent the counts.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { LANE_V1_BASELINE_COMMAND, LANE_V1_BASELINE_SCHEMA, measurementFromReports, parseLaneMeasurement, type LaneBaseline } from "../lib/selfchange.ts";

const argv = process.argv.slice(2);
const opt = (name: string) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : undefined; };
const die = (code: number, msg: string): never => { console.log(msg); throw process.exit(code); };
const readJson = (flag: string): unknown => {
  const file = opt(flag);
  if (file === undefined) return die(1, `usage: ${LANE_V1_BASELINE_COMMAND}`);
  try { return JSON.parse(readFileSync(resolve(file), "utf8")); } catch { return die(1, `lane-baseline: ${flag} is not json`); }
};

const out = opt("out") ?? die(1, `usage: ${LANE_V1_BASELINE_COMMAND}`);
const measureFlag = opt("measure");
const reports = opt("capability") !== undefined || opt("practice") !== undefined || opt("source-sha") !== undefined;
if (measureFlag && reports) die(2, "lane-baseline refused: pass either --measure or --capability/--practice/--source-sha, not both");
const built = measureFlag ? parseLaneMeasurement(readJson("measure")) : measurementFromReports(readJson("capability"), readJson("practice"), opt("source-sha") ?? "");
const got = built.ok ? built.measurement : die(2, `lane-baseline refused: ${built.reason}`);
const baseline: LaneBaseline = {
  schema: LANE_V1_BASELINE_SCHEMA, locked: true, sourceSha: got.sourceSha, lastGoodSha: got.sourceSha,
  generatedBy: LANE_V1_BASELINE_COMMAND, builderLog: got.builderLog, practiceDev: got.practiceDev, heldOut: got.heldOut,
};
const file = resolve(out);
mkdirSync(dirname(file), { recursive: true });
writeFileSync(file, JSON.stringify(baseline, null, 1) + "\n");
die(0, `lane-baseline locked source=${baseline.sourceSha} builder-log-pass=${baseline.builderLog.counts.pass} dev-text-pass=${baseline.practiceDev.text.counts.pass} dev-spec-pass=${baseline.practiceDev["test-as-spec"].counts.pass} held-out-text-pass=${baseline.heldOut.text.pass} held-out-spec-pass=${baseline.heldOut["test-as-spec"].pass}`);
