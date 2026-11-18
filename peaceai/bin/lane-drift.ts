// Lane v1 drift check. Re-measures a commit (main, on the box) against the frozen baseline and says
// any drop in plain words. A drop, an unlocked baseline, or a commit that is not the recorded last-good
// version is unresolved: the next self-change stays blocked until a human regenerates the baseline.
// This is not a public scheduled workflow. Public Workspace workflows do not run the self-change tool,
// and a public runner cannot re-measure held-out counts. Run it on the box before the next lane proposal:
//   tsx peaceai/bin/lane-drift.ts --baseline peaceai/self/lane-v1-baseline.json --capability <capability-report.json> --practice <replay.json> --source-sha <40-hex> --out peaceai/self/lane-v1-drift.json
// A pre-stripped measure file works instead of the two reports:
//   tsx peaceai/bin/lane-drift.ts --baseline peaceai/self/lane-v1-baseline.json --measure <lane-measure.json> --out peaceai/self/lane-v1-drift.json
// Exit 0 when the measure matches the baseline. Exit 2 when the next self-change stays blocked.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { assessLaneDrift, LANE_V1_DRIFT_COMMAND, measurementFromReports, parseLaneBaseline, parseLaneMeasurement } from "../lib/selfchange.ts";

const argv = process.argv.slice(2);
const opt = (name: string) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : undefined; };
const die = (code: number, msg: string): never => { console.log(msg); throw process.exit(code); };
const readJson = (flag: string): unknown => {
  const file = opt(flag);
  if (file === undefined) return die(1, `usage: ${LANE_V1_DRIFT_COMMAND}`);
  try { return JSON.parse(readFileSync(resolve(file), "utf8")); } catch { return die(1, `lane-drift: ${flag} is not json`); }
};

if (!opt("baseline") || !opt("out")) die(1, `usage: ${LANE_V1_DRIFT_COMMAND}`);
const measureFlag = opt("measure");
const reports = opt("capability") !== undefined || opt("practice") !== undefined || opt("source-sha") !== undefined;
if (measureFlag && reports) die(2, "lane-drift refused: pass either --measure or --capability/--practice/--source-sha, not both");
if (!measureFlag && !reports) die(1, `usage: ${LANE_V1_DRIFT_COMMAND}`);
const parsed = parseLaneBaseline(readJson("baseline"));
const baseline = parsed.ok ? parsed.baseline : die(2, `lane-drift blocked: ${parsed.reason}`);
const built = measureFlag ? parseLaneMeasurement(readJson("measure")) : measurementFromReports(readJson("capability"), readJson("practice"), opt("source-sha") ?? "");
const drift = assessLaneDrift(baseline, built.ok ? built.measurement : null);
if (!built.ok) drift.lines.unshift(`The measurement of main could not be read (${built.reason}). The next self-change stays blocked.`);
if (!built.ok) drift.status = "unresolved";
const file = resolve(opt("out")!);
mkdirSync(dirname(file), { recursive: true });
writeFileSync(file, JSON.stringify(drift, null, 1) + "\n");
die(drift.status === "clear" ? 0 : 2, drift.lines.join("\n"));
