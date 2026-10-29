// PeaceAI vs Builder coverage from the public Builder task log only (no box, no network by default).
// Of Builder's logged tasks PLUS PeaceAI real tasks, what % PeaceAI could do end-to-end using ONLY
// live-proven skills (Builder rows) or already-landed real tasks (PeaceAI rows).
// Live-proven = (a) a PeaceAI log entry whose `changed` lands a repo@sha on/before asOf, or (b) a skill
// listed in LIVE_PROVEN_SINCE whose `since` is on/before asOf (each map entry is validated in check.ts
// against a backing PeaceAI repo@sha seq). Approved-but-unproven skills do not count.
// PeaceAI real task (counts in BOTH numerator and denominator): by PeaceAI, asked contains
// "(source: peace)", PeaceSTOCKS@sha is on PeaceSTOCKS main (fail closed if unverifiable), and not
// coverage:none (isCoverageNone in check.ts: the optional field, or the grandfathered COVERAGE_NONE_SEQS). Both windows are
// bounded by asOf (all-time = every task with date <= asOf).
// PeaceAI-Workspace real task (Auditor ruling (a), 2026-10-28): the same row rules plus a PeaceAI-Workspace@sha landing that
// carries the same proof as a PeaceSTOCKS landing, checked here (isWorkspaceRealTask): byte-identical to a candidate of a real
// derive run (the `ws-proof:` clause's diff sha256 = the recorded candidate diff, and that diff applied to the landing's first
// parent gives the landing tree), the sha on Workspace main, Peace's recorded /verdict picking that candidate, and nothing
// protected or never-zone touched. Rows dated before WORKSPACE_LANDING_SINCE never count (no backdating). Fail closed.
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { effectiveVerdict, type VerdictRecord } from "../peaceai/lib/records.ts";
import { computeNeverZone, NEVER_ZONE, type NeverZoneSet } from "../peaceai/lib/selfchange.ts";
import { selfProtectedReason } from "../peaceai/lib/self-zone.ts";
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
  /**
   * SECONDARY figure, never the official one: the same windows with PEACEAI_SELF_CHANGE tasks (protected by design,
   * PeaceAI may never edit itself) dropped from numerator and denominator. last7Days / allTime above stay official.
   */
  excludingSelfChange: { label: typeof EXCL_SELF_LABEL; last7Days: WindowStats; allTime: WindowStats };
}

export const SELF_CHANGE_SKILL = "PEACEAI_SELF_CHANGE";
export const EXCL_SELF_LABEL = "secondary: excluding PEACEAI_SELF_CHANGE (not the official figure)";

/** Injectable: true iff `sha` is an ancestor of PeaceSTOCKS main (or clone HEAD). */
export type OnMainChecker = (sha: string) => boolean;

export { isCoverageNone, COVERAGE_NONE, COVERAGE_NONE_SEQS } from "./check.ts";

export const SOURCE_PEACE = /\(source:\s*peace\)/i;
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

// ---- PeaceAI-Workspace landings (Auditor ruling (a)): same proof as PeaceSTOCKS, verified here, fail closed. ----

export const WORKSPACE_REPO = "PeaceG03/PeaceAI-Workspace";
/** No backdating: a Workspace row counts only when logged at or after this MT instant (rows 221-225 and every Builder PR stay out). */
export const WORKSPACE_LANDING_SINCE = "2026-10-29 00:00";
/** The proof a Workspace row must carry in `why`, exactly once: derive run, candidate, sha256 of its recorded diff, Peace's verdict comment. */
export const WS_PROOF = /\bws-proof: run (\d{1,20}) (candidate-\d{1,3}) diff-sha256 ([0-9a-f]{64}) verdict (\d{1,20})\b/g;
const WS_SHA = /PeaceAI-Workspace@([0-9a-f]{7,40})/g;
const WS_ISSUE = /PeaceAI-Workspace#(\d{1,9})/g;
const DRY_RUN = /\bdry[- ]?run\b/i;

/** What a real derive run recorded (Results tasks/<issue>/<run>/): read-only facts, compared in workspaceRefusal. */
export interface DeriveRunFacts {
  /** The latest recorded run for the issue (a later re-run supersedes an earlier one). */
  latestRunId: string;
  target: string;
  /** task.json source (M119 provenance): only "peace" counts. */
  source: string;
  /** The candidate's ranking entry: eligible after grading and generated by a learned rule (not hand-supplied). */
  candidate: { eligible: boolean; operationId: string } | null;
  /** sha256 of the candidate diff bytes exactly as the run recorded them; null when the diff is missing. */
  candidateDiffSha256: string | null;
  candidateDiff: string | null;
  /** Peace's verdicts on this run (the verdict job records only PeaceG03's comments). */
  verdicts: readonly VerdictRecord[];
}

/** The landing commit on the Workspace clone: read-only facts. */
export interface WorkspaceLandingFacts {
  onMain: boolean;
  /** Tree of the candidate diff applied to the landing's first parent (null: does not apply) and the landing's own tree. */
  appliedTree: string | null;
  landingTree: string;
  /** Paths touched by first-parent..landing (no rename detection), with git status letter. */
  touched: readonly { path: string; status: string }[];
  /** The never-zone computed from the landing's FIRST PARENT tree (computeNeverZone). */
  zone: NeverZoneSet;
}

export interface WorkspaceProofChecker {
  derive(issue: number, runId: string, candidateId: string): DeriveRunFacts | null;
  landing(sha: string, candidateDiff: string): WorkspaceLandingFacts | null;
}

export type WorkspaceRefusal =
  | "W_NOT_PEACEAI" | "W_NOT_SOURCE_PEACE" | "W_COVERAGE_NONE" | "W_DRY_RUN" | "W_BEFORE_SINCE" | "W_LANDING" | "W_NO_PROOF"
  | "W_NO_CHECKER" | "W_NO_DERIVE_RUN" | "W_NOT_REAL_DERIVE" | "W_HASH_MISMATCH" | "W_NO_VERDICT" | "W_NOT_ON_MAIN"
  | "W_TREE_MISMATCH" | "W_PROTECTED" | "W_LOOKUP_FAILED";

const TEST_FILE = /\.test\.(ts|mts|js|mjs)$/i;
/** Why a touched path disqualifies a Workspace landing, or null: stage-1 protected, never-zone (pattern or closure), or shadowing. */
export function workspaceTouchRefusal(path: string, status: string, zone: NeverZoneSet): string | null {
  const p = selfProtectedReason(path);
  if (p) return `protected: ${p}`;
  // selfProtectedReason leaves src/ tests to the scope gate (new src tests grade every ordinary candidate); an existing one is frozen.
  if (TEST_FILE.test(path) && status !== "A") return "protected: existing test modified or deleted";
  const n = NEVER_ZONE.find((z) => z.pattern.test(path));
  if (n) return `never-zone: ${n.why}`;
  const w = zone.why.get(path);
  if (w) return w;
  if (status === "A" && zone.shadows.has(path)) return "never-zone: a new file here would replace a module a never-zone file imports";
  return null;
}

/** null when the row is a counted PeaceAI-Workspace real task, else the first refusal code (in check order). */
export function workspaceRefusal(e: Entry, chk?: WorkspaceProofChecker | null): WorkspaceRefusal | null {
  if (e.by !== "PeaceAI") return "W_NOT_PEACEAI";
  if (!SOURCE_PEACE.test(e.asked)) return "W_NOT_SOURCE_PEACE";
  if (isCoverageNone(e)) return "W_COVERAGE_NONE";
  // A dry run asked for is not a landing. (A practice/dry derive run named in the proof also fails: derive-practice and local
  // runs write no Results task record, so the proof's run is not found -> W_NO_DERIVE_RUN.)
  if (DRY_RUN.test(e.asked)) return "W_DRY_RUN";
  if (`${e.date} ${e.time}` < WORKSPACE_LANDING_SINCE) return "W_BEFORE_SINCE";
  const shas = [...e.changed.matchAll(WS_SHA)].map((m) => m[1]!);
  const issues = [...new Set([...e.changed.matchAll(WS_ISSUE)].map((m) => Number(m[1])))];
  if (shas.length !== 1 || issues.length !== 1 || peaceStocksSha(e.changed) !== null) return "W_LANDING";
  const proofs = [...e.why.matchAll(WS_PROOF)];
  if (proofs.length !== 1) return "W_NO_PROOF";
  if (!chk) return "W_NO_CHECKER";
  const [, runId, candidateId, diffSha, commentId] = proofs[0]!;
  try {
    const d = chk.derive(issues[0]!, runId!, candidateId!);
    if (!d || d.latestRunId !== runId) return "W_NO_DERIVE_RUN";
    if (d.target.toLowerCase() !== WORKSPACE_REPO.toLowerCase() || d.source !== "peace" || !d.candidate || d.candidate.eligible !== true
      || !d.candidate.operationId.startsWith("learned:")) return "W_NOT_REAL_DERIVE";
    if (d.candidateDiff === null || d.candidateDiffSha256 !== diffSha || createHash("sha256").update(d.candidateDiff, "utf8").digest("hex") !== diffSha)
      return "W_HASH_MISMATCH";
    const pick = effectiveVerdict(d.verdicts).pick;
    const named = d.verdicts.find((v) => v.commentId === commentId);
    if (!pick.decided || pick.candidateId !== candidateId || !named || named.verdict !== "right" || named.candidateId !== candidateId || named.runId !== runId)
      return "W_NO_VERDICT";
    const l = chk.landing(shas[0]!, d.candidateDiff);
    if (!l) return "W_LOOKUP_FAILED";
    if (l.onMain !== true) return "W_NOT_ON_MAIN";
    if (l.appliedTree === null || l.appliedTree !== l.landingTree) return "W_TREE_MISMATCH";
    if (!l.touched.length || l.touched.some((t) => workspaceTouchRefusal(t.path, t.status, l.zone) !== null)) return "W_PROTECTED";
  } catch {
    return "W_LOOKUP_FAILED";
  }
  return null;
}

/** Mirrors isPeaceRealTask for PeaceAI-Workspace@sha landings. Fail closed when `chk` is null/undefined or throws. */
export function isWorkspaceRealTask(e: Entry, chk?: WorkspaceProofChecker | null): boolean {
  return workspaceRefusal(e, chk) === null;
}

/**
 * Offline checker: Workspace facts from a local clone (`git merge-base --is-ancestor <sha> HEAD`, so the clone should be on
 * main), derive-run facts from a read-only Results directory (tasks/<issue>/<run>/...). Any error is a refusal (fail closed).
 */
export function makeWorkspaceProofChecker(workspaceClone: string, resultsDir: string): WorkspaceProofChecker {
  if (!workspaceClone || !resultsDir) throw new Error("Workspace clone and Results dir are required");
  const git = (args: string[], env?: NodeJS.ProcessEnv): string =>
    execFileSync("git", ["-C", workspaceClone, ...args], { encoding: "utf8", env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "ignore"], maxBuffer: 256 * 1024 * 1024 });
  return {
    derive(issue, runId, candidateId) {
      const dir = join(resultsDir, "tasks", String(issue));
      if (!existsSync(dir)) return null;
      const runs = readdirSync(dir).filter((n) => /^\d{1,20}$/.test(n)).sort((a, b) => (BigInt(a) < BigInt(b) ? -1 : BigInt(a) > BigInt(b) ? 1 : 0));
      const latestRunId = runs[runs.length - 1];
      if (!latestRunId || !runs.includes(runId)) return null;
      const run = join(dir, runId);
      const json = <T>(p: string): T | null => (existsSync(p) ? (JSON.parse(readFileSync(p, "utf8")) as T) : null);
      const task = json<{ target?: string; source?: string }>(join(run, "task.json"));
      const ranking = json<{ candidates?: { id: string; eligible?: boolean; operationId?: string }[] }>(join(run, "ranking.json"));
      if (!task || !ranking) return null;
      const c = (ranking.candidates ?? []).find((x) => x.id === candidateId);
      const diffPath = join(run, "candidates", `${candidateId}.diff`);
      const candidateDiff = existsSync(diffPath) ? readFileSync(diffPath, "utf8") : null;
      const vdir = join(run, "verdicts");
      const verdicts = existsSync(vdir)
        ? readdirSync(vdir).filter((n) => /^\d{1,20}\.json$/.test(n)).map((n) => json<VerdictRecord>(join(vdir, n))).filter((v): v is VerdictRecord => v !== null)
        : [];
      return {
        latestRunId,
        target: task.target ?? WORKSPACE_REPO,
        source: task.source ?? "builder",
        candidate: c ? { eligible: c.eligible === true, operationId: String(c.operationId ?? "") } : null,
        candidateDiffSha256: candidateDiff === null ? null : createHash("sha256").update(candidateDiff, "utf8").digest("hex"),
        candidateDiff,
        verdicts,
      };
    },
    landing(sha, candidateDiff) {
      if (!/^[0-9a-f]{7,40}$/.test(sha)) return null;
      const full = git(["rev-parse", "--verify", `${sha}^{commit}`]).trim();
      const parent = git(["rev-parse", "--verify", `${full}^1`]).trim();
      const onMain = spawnSync("git", ["-C", workspaceClone, "merge-base", "--is-ancestor", full, "HEAD"], { stdio: "ignore" }).status === 0;
      const landingTree = git(["rev-parse", `${full}^{tree}`]).trim();
      const tmp = mkdtempSync(join(tmpdir(), "ws-coverage-"));
      let appliedTree: string | null = null;
      try {
        const file = join(tmp, "candidate.diff");
        writeFileSync(file, candidateDiff);
        const env = { GIT_INDEX_FILE: join(tmp, "index") };
        git(["read-tree", parent], env);
        const ap = spawnSync("git", ["-C", workspaceClone, "apply", "--cached", file], { stdio: "ignore", env: { ...process.env, ...env } });
        if (ap.status === 0) appliedTree = git(["write-tree"], env).trim();
      } finally {
        rmSync(tmp, { recursive: true, force: true });
      }
      const raw = git(["diff", "--name-status", "--no-renames", "-z", parent, full]).split("\0").filter((x) => x !== "");
      const touched: { path: string; status: string }[] = [];
      for (let i = 0; i + 1 < raw.length; i += 2) touched.push({ status: raw[i]!, path: raw[i + 1]! });
      const tracked = git(["ls-tree", "-r", "--name-only", "-z", parent]).split("\0").filter(Boolean);
      const read = (p: string): string | null => { try { return git(["show", `${parent}:${p}`]); } catch { return null; } };
      return { onMain, appliedTree, landingTree, touched, zone: computeNeverZone(tracked, read) };
    },
  };
}

/** WORKSPACE_CLONE + PEACEAI_RESULTS_DIR → checker, or null (fail closed: no Workspace credit) when either is unset/unusable. */
export function defaultWorkspaceChecker(): WorkspaceProofChecker | null {
  const ws = process.env.WORKSPACE_CLONE?.trim();
  const res = process.env.PEACEAI_RESULTS_DIR?.trim();
  if (!ws || !res) return null;
  try {
    return makeWorkspaceProofChecker(ws, res);
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
  /** PeaceAI-Workspace@sha proof checker. Omit/null = fail closed (no Workspace landing counts). CLI: defaultWorkspaceChecker(). */
  workspace?: WorkspaceProofChecker | null;
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
  const workspace = opts.workspace ?? null;
  const peaceReal = entries.filter((e) => isPeaceRealTask(e, onMain) || isWorkspaceRealTask(e, workspace));
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
    excludingSelfChange: {
      label: EXCL_SELF_LABEL,
      last7Days: windowStats(all7.filter(notSelf), proven, peaceRealSeqs),
      allTime: windowStats(asOfTasks.filter(notSelf), proven, peaceRealSeqs),
    },
  };
}

const notSelf = (e: { skill: string }) => e.skill !== SELF_CHANGE_SKILL;

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
    `Of Builder's logged tasks plus PeaceAI **real tasks** (\`source: peace\`, PeaceSTOCKS@sha on main, not \`coverage:"none"\` / COVERAGE_NONE_SEQS), % PeaceAI could do end-to-end using **only live-proven skills** for Builder rows (PeaceAI \`repo@sha\` landing on/before asOf, or \`LIVE_PROVEN_SINCE\` backed by such a log seq; approved-but-unproven skills do not count). PeaceAI-Workspace landings count only with the same proof (\`ws-proof:\` clause: a real derive run's candidate, byte-identical landing on Workspace main, Peace's /verdict, nothing protected or never-zone touched; rows from ${WORKSPACE_LANDING_SINCE} MT on). PeaceAI real tasks count in both the numerator and the denominator. All-time is bounded by asOf. asOf \`${r.asOf}\` MT; log sha256 \`${r.logSha256.slice(0, 16)}…\`.`,
    "",
    `| window | PeaceAI-able |`,
    `|---|---|`,
    `| last 7 days | ${pct(r.last7Days)} |`,
    `| all-time | ${pct(r.allTime)} |`,
    "",
    `Official figure: the table above. Below, ${EXCL_SELF_LABEL}:`,
    "",
    `| window (excl. ${SELF_CHANGE_SKILL}) | PeaceAI-able |`,
    `|---|---|`,
    `| last 7 days | ${pct(r.excludingSelfChange.last7Days)} |`,
    `| all-time | ${pct(r.excludingSelfChange.allTime)} |`,
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
  process.stdout.write(formatCoverageSummary(coverageReport(head, asOf, { onMain: defaultOnMainChecker(), workspace: defaultWorkspaceChecker() })));
}
