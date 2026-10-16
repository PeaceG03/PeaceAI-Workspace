// PeaceAI vs Builder coverage from the public Builder task log only (no box, no network).
// Of Builder's logged tasks, what % PeaceAI could do end-to-end using ONLY live-proven skills.
// Live-proven = (a) a PeaceAI log entry whose `changed` lands a repo@sha on/before asOf, or (b) a skill
// listed in LIVE_PROVEN_SINCE whose `since` is on/before asOf (each map entry is validated in check.ts
// against a backing PeaceAI repo@sha seq). Approved-but-unproven skills do not count.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { LIVE_LANDING_REF, LIVE_PROVEN_SINCE, LOG_PATH, retagTarget, validateLog, type Entry } from "./check.ts";

/** @deprecated use LIVE_LANDING_REF from check.ts */
export const LIVE_LANDING = LIVE_LANDING_REF;

export interface WindowStats {
  builderTasks: number;
  peaceaiAble: number;
  /** Percent 0..100 to one decimal, or null when there are no Builder tasks in the window. */
  percent: number | null;
}

export interface MissingSkillCount {
  skill: string;
  count: number;
}

export interface CoverageReport {
  asOf: string; // YYYY-MM-DD (America/Denver), end of the 7-day window
  liveProven: string[];
  last7Days: WindowStats;
  allTime: WindowStats;
  /** Builder tasks whose skill is not live-proven, ranked by count desc then name. */
  topMissing: MissingSkillCount[];
  logSha256: string;
}

export function parseLogEntries(logText: string): Entry[] {
  const errors = validateLog(logText);
  if (errors.length) throw new Error(`builder-log invalid: ${errors[0]}`);
  return logText.split("\n").filter(Boolean).map((l) => JSON.parse(l) as Entry);
}

/**
 * Live-proven skills as of end-of-day asOfDate (MT). Omit asOfDate to use every validated proof in the log/map.
 * Log landings and LIVE_PROVEN_SINCE are both gated by time so a later proof does not rewrite earlier windows.
 */
export function liveProvenSkills(entries: readonly Entry[], asOfDate?: string): Set<string> {
  const end = asOfDate ? `${asOfDate} 23:59` : null;
  const out = new Set<string>();
  for (const e of entries) {
    if (e.by !== "PeaceAI" || !LIVE_LANDING_REF.test(e.changed)) continue;
    if (end !== null && `${e.date} ${e.time}` > end) continue;
    out.add(e.skill);
  }
  for (const [skill, ref] of Object.entries(LIVE_PROVEN_SINCE)) {
    if (end === null || ref.since <= end) out.add(skill);
  }
  return out;
}

function addDaysYmd(ymd: string, deltaDays: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) throw new Error(`bad asOf date: ${ymd}`);
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + deltaDays);
  const d = new Date(t);
  const y = d.getUTCFullYear();
  const mo = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${mo}-${day}`;
}

function windowStats(builder: readonly Entry[], proven: ReadonlySet<string>): WindowStats {
  const able = builder.filter((e) => proven.has(e.skill)).length;
  const n = builder.length;
  return {
    builderTasks: n,
    peaceaiAble: able,
    percent: n === 0 ? null : Math.round((1000 * able) / n) / 10,
  };
}

/**
 * @param asOfDate end date (MT, YYYY-MM-DD) of the rolling 7-day window (inclusive).
 * @param topN max missing skills to list (default 10).
 */
export function coverageReport(logText: string, asOfDate: string, topN = 10): CoverageReport {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOfDate)) throw new Error(`bad asOf date: ${asOfDate}`);
  if (!Number.isInteger(topN) || topN < 1 || topN > 50) throw new Error("topN out of range");
  const entries = parseLogEntries(logText);
  const proven = liveProvenSkills(entries, asOfDate);
  // Retag lines are not tasks; each Builder task takes the skill of its latest retag (log order), if any.
  const retag = new Map<number, Entry["skill"]>();
  for (const e of entries) { const t = retagTarget(e); if (t !== null) retag.set(t, e.skill); }
  const builderAll = entries.filter((e) => e.by === "Builder" && retagTarget(e) === null).map((e) => (retag.has(e.seq) ? { ...e, skill: retag.get(e.seq)! } : e));
  const start7 = addDaysYmd(asOfDate, -6);
  const builder7 = builderAll.filter((e) => e.date >= start7 && e.date <= asOfDate);
  const miss = new Map<string, number>();
  for (const e of builderAll) {
    if (!proven.has(e.skill)) miss.set(e.skill, (miss.get(e.skill) ?? 0) + 1);
  }
  const topMissing = [...miss.entries()]
    .map(([skill, count]) => ({ skill, count }))
    .sort((a, b) => b.count - a.count || a.skill.localeCompare(b.skill))
    .slice(0, topN);
  return {
    asOf: asOfDate,
    liveProven: [...proven].sort(),
    last7Days: windowStats(builder7, proven),
    allTime: windowStats(builderAll, proven),
    topMissing,
    logSha256: createHash("sha256").update(logText).digest("hex"),
  };
}

function pct(w: WindowStats): string {
  if (w.percent === null) return "n/a (0 Builder tasks)";
  return `${w.percent}% (${w.peaceaiAble}/${w.builderTasks})`;
}

/** Markdown for Actions job summaries (builder-log workflow). */
export function formatCoverageSummary(r: CoverageReport): string {
  const rows = r.topMissing.map((m) => `| ${m.skill} | ${m.count} |`);
  return [
    "## PeaceAI vs Builder",
    "",
    `Of Builder's logged tasks, % PeaceAI could do end-to-end using **only live-proven skills** (PeaceAI \`repo@sha\` landing on/before asOf, or \`LIVE_PROVEN_SINCE\` backed by such a log seq; approved-but-unproven skills do not count). asOf \`${r.asOf}\` MT; log sha256 \`${r.logSha256.slice(0, 16)}…\`.`,
    "",
    `| window | PeaceAI-able |`,
    `|---|---|`,
    `| last 7 days | ${pct(r.last7Days)} |`,
    `| all-time | ${pct(r.allTime)} |`,
    "",
    `Live-proven skills: ${r.liveProven.length ? r.liveProven.map((s) => `\`${s}\``).join(", ") : "(none)"}.`,
    "",
    "### Top missing skills (remaining Builder tasks)",
    "",
    "| skill | count |",
    "|---|---:|",
    ...(rows.length ? rows : ["| _(none)_ | 0 |"]),
    "",
  ].join("\n");
}

/** America/Denver calendar date for "today" from an instant (default: now). */
export function denverYmd(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Denver", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const head = readFileSync(LOG_PATH, "utf8");
  const asOf = process.argv[2] && /^\d{4}-\d{2}-\d{2}$/.test(process.argv[2]) ? process.argv[2]! : denverYmd();
  process.stdout.write(formatCoverageSummary(coverageReport(head, asOf)));
}
