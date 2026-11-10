// Experimental. credit: false. Read-only.
//   tsx peaceai/bin/capability-report.ts [--as-of YYYY-MM-DD] [--replay records.jsonl] [--out <dir>]
// Prints the headline real-pass figure. A row is a pass only when --replay records a fresh execution.
// Without that record the row is unmeasured and the headline is unknown. Does not edit the log,
// Results, or credit. --out must be outside this repo.
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { LOG_PATH } from "../../builder-log/check.ts";
import { defaultOnMainChecker, defaultWorkspaceChecker, denverYmd } from "../../builder-log/coverage.ts";
import { buildCapabilityReport, type ReplayRecord } from "../lib/capabilityreport.ts";

function insideRepo(root: string, target: string): boolean {
  const repo = realpathSync(resolve(root));
  let cur = resolve(target);
  const rest: string[] = [];
  while (!existsSync(cur)) {
    const parent = resolve(cur, "..");
    if (parent === cur) break;
    rest.push(cur.slice(parent.length + 1));
    cur = parent;
  }
  const base = realpathSync(cur);
  const full = rest.length ? resolve(base, ...rest.reverse()) : base;
  const rel = relative(repo, full);
  return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !rel.startsWith("..") && !isAbsolute(rel));
}

const USAGE = "usage: capability-report.ts [--as-of YYYY-MM-DD] [--replay records.jsonl] [--out <dir>]";

function flag(name: string, args: string[]): string | undefined {
  const i = args.indexOf(name);
  if (i < 0) return undefined;
  const v = args[i + 1];
  if (!v || v.startsWith("--")) throw new Error(USAGE);
  return v;
}

export function loadReplay(text: string): ReplayRecord[] {
  const out: ReplayRecord[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    const r = JSON.parse(line) as ReplayRecord;
    if (!Number.isInteger(r.seq) || (r.status !== "pass" && r.status !== "fail") || typeof r.reason !== "string" || !r.reason) throw new Error("replay record invalid");
    out.push({ seq: r.seq, status: r.status, reason: r.reason });
  }
  return out;
}

function main(): void {
  const args = process.argv.slice(2);
  if (args.includes("-h") || args.includes("--help")) { console.log(USAGE); return; }
  const asOf = flag("--as-of", args) ?? denverYmd();
  const replayPath = flag("--replay", args);
  const out = flag("--out", args);
  const repo = resolve(import.meta.dirname, "../..");
  if (out && insideRepo(repo, resolve(out))) { console.log("refused WRITE_IN_TARGET"); process.exit(2); }
  const logText = readFileSync(resolve(repo, LOG_PATH), "utf8");
  const replay = replayPath ? loadReplay(readFileSync(replayPath, "utf8")) : [];
  const report = buildCapabilityReport(logText, asOf, defaultOnMainChecker(), replay, defaultWorkspaceChecker());
  const body = JSON.stringify(report, null, 2) + "\n";
  if (out) {
    mkdirSync(out, { recursive: true });
    writeFileSync(resolve(out, "capability-report.json"), body);
  }
  const top = report.gaps.slice(0, 12).map((g) => `${g.skill} notPass=${g.notPass} officialMissing=${g.officialMissing} unmeasured=${g.unmeasured} fail=${g.fail}`).join("; ");
  console.log(`experimental credit=false asOf=${report.asOf}`);
  console.log(`realPass=${report.realPass} passes=${report.passes} fails=${report.fails} unmeasured=${report.unmeasured} set=${report.setSize}`);
  console.log(`official=${report.official.percent}% (${report.official.able}/${report.official.tasks}) note=${report.official.note}`);
  console.log(`onMain=${process.env.PEACESTOCKS_CLONE ? "clone" : "unset-fail-closed"} workspace=${process.env.WORKSPACE_CLONE && process.env.PEACEAI_RESULTS_DIR ? "set" : "unset-fail-closed"}`);
  console.log(`gaps ${top}`);
  if (out) console.log(`wrote ${resolve(out, "capability-report.json")}`);
}

if (process.argv[1] && process.argv[1].endsWith("capability-report.ts")) main();
