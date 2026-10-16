// PeaceAI vs Builder coverage from the public Builder task log only (no box, no network by default).
// Of Builder's logged tasks PLUS PeaceAI real tasks, what % PeaceAI could do end-to-end using ONLY
// live-proven skills (Builder rows) or already-landed real tasks (PeaceAI rows).
// Live-proven = (a) a PeaceAI log entry whose `changed` lands a repo@sha on/before asOf, or (b) a skill
// listed in LIVE_PROVEN_SINCE whose `since` is on/before asOf (each map entry is validated in check.ts
// against a backing PeaceAI repo@sha seq). Approved-but-unproven skills do not count.
// PeaceAI real task (counts in BOTH numerator and denominator): by PeaceAI, asked contains
// "(source: peace)", PeaceSTOCKS@sha is on PeaceSTOCKS main (fail closed if unverifiable), and not
// coverage:none (optional field, or grandfather COVERAGE_NONE_SEQS 97/99/101). Both windows are
// bounded by asOf (all-time = every task with date <= asOf).
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import {
  APPROVED_SINCE,
  APPROVED_SKILLS,
  isCoverageNone,
  LIVE_LANDING_REF,
  LIVE_PROVEN_SINCE,
  LOG_PATH,
  retagTarget,
  validateLog,
  type Entry,
} from "./check.ts";

/** @deprecated use LIVE_LANDING_REF from check.ts */
export const LIVE_LANDING = LIVE_LANDING_REF;

export interface WindowStats {
  /** Tasks in the window (Builder non-retag + PeaceAI real tasks). */
  builderTasks: number;
  peaceaiAble: number;
  /** Percent 0..100 to one decimal, or null when there are no tasks in the window. */
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

/** Injectable: true iff `sha` is an ancestor of PeaceSTOCKS main (or clone HEAD). */
export type OnMainChecker = (sha: string) => boolean;

export { isCoverageNone, COVERAGE_NONE, COVERAGE_NONE_SEQS } from "./check.ts";

const SOURCE_PEACE = /\(source:\s*peace\)/i;
const PEACE_STOCKS_SHA = /PeaceSTOCKS@([0-9a-f]{7,40})/;

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

/** Skill approved at a MT "YYYY-MM-DD HH:MM" instant (APPROVED_SKILLS always; APPROVED_SINCE from its time). */
export function approvedAt(skill: string, at: string): boolean {
  if ((APPROVED_SKILLS as readonly string[]).includes(skill)) return true;
  const since = (APPROVED_SINCE as Readonly<Record<string, string>>)[skill];
  return since !== undefined && since <= at;
}

const ISSUE_REF = /PeaceAI-Workspace#(\d+)/g;

/** Auditor #216: may a retag of `task` to `skill` count? Never raises coverage without approval + evidence. */
export function retagCountable(task: Entry, skill: string, entries: readonly Entry[]): boolean {
  if (!approvedAt(skill, `${task.date} ${task.time}`)) return false;
  if (task.mark === "PeaceAI-able today") return true;
  const refs = [...task.changed.matchAll(ISSUE_REF)].map((m) => m[0]);
  if (!refs.length) return false;
  return entries.some((p) => p.by === "PeaceAI" && p.skill === skill && p.seq > task.seq && LIVE_LANDING_REF.test(p.changed)
    && refs.some((r) => new RegExp(`${r}(?!\\d)`).test(`${p.changed} ${p.why} ${p.asked}`)));
}

/**
 * Auditor #216: a Builder task counts only if its (latest-retagged) skill is live-proven AND its mark was
 * "PeaceAI-able today" when logged. A historical "missing skill X" entry stays uncounted even after X is
 * approved/proven (APPROVED_SINCE: history keeps the mark it had then); only an appended retag can change it.
 */
export function countable(e: Pick<Entry, "skill" | "mark">, proven: ReadonlySet<string>): boolean {
  return proven.has(e.skill) && !e.mark.startsWith("missing skill");
}

/** Extract the PeaceSTOCKS@sha from `changed`, if any. */
export function peaceStocksSha(changed: string): string | null {
  const m = PEACE_STOCKS_SHA.exec(changed);
  return m ? m[1]! : null;
}

/** @deprecated use isCoverageNone — wording heuristics removed. */
export function isProofOrNoCoverage(e: Pick<Entry, "seq" | "coverage">): boolean {
  return isCoverageNone(e);
}

/**
 * PeaceAI real task: source: peace, not coverage:none, PeaceSTOCKS@sha on main.
 * Fail closed when `onMain` is null/undefined or throws / returns false.
 */
export function isPeaceRealTask(e: Entry, onMain?: OnMainChecker | null): boolean {
  if (e.by !== "PeaceAI") return false;
  if (!SOURCE_PEACE.test(e.asked)) return false;
  if (isCoverageNone(e)) return false;
  const sha = peaceStocksSha(e.changed);
  if (!sha) return false;
  if (!onMain) return false;
  try {
    return onMain(sha) === true;
  } catch {
    return false;
  }
}

/**
 * Offline checker: `git -C clonePath merge-base --is-ancestor <sha> HEAD`.
 * Fail closed on any git error. Clone should be on main (or contain main history).
 */
export function makeGitOnMainChecker(clonePath: string): OnMainChecker {
  if (!clonePath) throw new Error("PeaceSTOCKS clone path is required");
  return (sha: string): boolean => {
    if (!/^[0-9a-f]{7,40}$/.test(sha)) return false;
    try {
      execFileSync("git", ["-C", clonePath, "merge-base", "--is-ancestor", sha, "HEAD"], {
        stdio: ["ignore", "ignore", "ignore"],
      });
      return true;
    } catch {
      return false;
    }
  };
}

/** Resolve PEACESTOCKS_CLONE → checker, or null (fail closed) when unset/unusable. */
export function defaultOnMainChecker(): OnMainChecker | null {
  const p = process.env.PEACESTOCKS_CLONE?.trim();
  if (!p) return null;
  try {
    return makeGitOnMainChecker(p);
  } catch {
    return null;
  }
}

function windowStats(
  tasks: readonly Entry[],
  proven: ReadonlySet<string>,
  peaceRealSeqs: ReadonlySet<number>,
): WindowStats {
  const able = tasks.filter((e) => (peaceRealSeqs.has(e.seq) ? true : countable(e, proven))).length;
  const n = tasks.length;
  return {
    builderTasks: n,
    peaceaiAble: able,
    percent: n === 0 ? null : Math.round((1000 * able) / n) / 10,
  };
}

export type CoverageOptions = {
  /** Max missing skills to list (default 10). */
  topN?: number;
  /**
   * PeaceSTOCKS@sha → on main? Omit/null = fail closed (no PeaceAI real task counts).
   * Pass a stub in unit tests; CLI uses PEACESTOCKS_CLONE via defaultOnMainChecker().
   */
  onMain?: OnMainChecker | null;
};

/**
 * @param asOfDate end date (MT, YYYY-MM-DD) of the rolling 7-day window (inclusive).
 * @param topNOrOpts max missing skills (default 10), or options including onMain.
 */
export function coverageReport(logText: string, asOfDate: string, topNOrOpts: number | CoverageOptions = 10): CoverageReport {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOfDate)) throw new Error(`bad asOf date: ${asOfDate}`);
  const opts: CoverageOptions = typeof topNOrOpts === "number" ? { topN: topNOrOpts } : topNOrOpts;
  const topN = opts.topN ?? 10;
  if (!Number.isInteger(topN) || topN < 1 || topN > 50) throw new Error("topN out of range");
  const onMain = opts.onMain === undefined ? null : opts.onMain;
  const entries = parseLogEntries(logText);
  const proven = liveProvenSkills(entries, asOfDate);
  // Retag lines are not tasks; each Builder task takes the skill of its latest retag (log order), if any.
  // Auditor #216: a retag may only lower or neutralize coverage. It becomes countable only if its skill was
  // approved at or before the ORIGINAL task's time AND (the original mark was already able OR a by:PeaceAI
  // repo@sha landing of that skill references the task's PeaceAI-Workspace#N). Otherwise it stays missing.
  const retag = new Map<number, Entry["skill"]>();
  for (const e of entries) { const t = retagTarget(e); if (t !== null) retag.set(t, e.skill); }
  const builderAll = entries.filter((e) => e.by === "Builder" && retagTarget(e) === null).map((e) => {
    const skill = retag.get(e.seq);
    if (skill === undefined) return e;
    const mark = retagCountable(e, skill, entries) ? "PeaceAI-able today" : `missing skill ${skill}`;
    return { ...e, skill, mark };
  });
  const peaceReal = entries.filter((e) => isPeaceRealTask(e, onMain));
  const peaceRealSeqs = new Set(peaceReal.map((e) => e.seq));
  const allTasks = [...builderAll, ...peaceReal];
  // Both windows are asOf-bounded (inclusive calendar date MT).
  const asOfTasks = allTasks.filter((e) => e.date <= asOfDate);
  const start7 = addDaysYmd(asOfDate, -6);
  const all7 = asOfTasks.filter((e) => e.date >= start7);
  const miss = new Map<string, number>();
  for (const e of builderAll) {
    if (e.date > asOfDate) continue;
    if (!countable(e, proven)) miss.set(e.skill, (miss.get(e.skill) ?? 0) + 1);
  }
  const topMissing = [...miss.entries()]
    .map(([skill, count]) => ({ skill, count }))
    .sort((a, b) => b.count - a.count || a.skill.localeCompare(b.skill))
    .slice(0, topN);
  return {
    asOf: asOfDate,
    liveProven: [...proven].sort(),
    last7Days: windowStats(all7, proven, peaceRealSeqs),
    allTime: windowStats(asOfTasks, proven, peaceRealSeqs),
    topMissing,
    logSha256: createHash("sha256").update(logText).digest("hex"),
  };
}

function pct(w: WindowStats): string {
  if (w.percent === null) return "n/a (0 tasks)";
  return `${w.percent}% (${w.peaceaiAble}/${w.builderTasks})`;
}

/** Markdown for Actions job summaries (builder-log workflow). */
export function formatCoverageSummary(r: CoverageReport): string {
  const rows = r.topMissing.map((m) => `| ${m.skill} | ${m.count} |`);
  return [
    "## PeaceAI vs Builder",
    "",
    `Of Builder's logged tasks plus PeaceAI **real tasks** (\`source: peace\`, PeaceSTOCKS@sha on main, not \`coverage:"none"\` / COVERAGE_NONE_SEQS), % PeaceAI could do end-to-end using **only live-proven skills** for Builder rows (PeaceAI \`repo@sha\` landing on/before asOf, or \`LIVE_PROVEN_SINCE\` backed by such a log seq; approved-but-unproven skills do not count). PeaceAI real tasks count in both the numerator and the denominator. All-time is bounded by asOf. asOf \`${r.asOf}\` MT; log sha256 \`${r.logSha256.slice(0, 16)}…\`.`,
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
  process.stdout.write(formatCoverageSummary(coverageReport(head, asOf, { onMain: defaultOnMainChecker() })));
}
