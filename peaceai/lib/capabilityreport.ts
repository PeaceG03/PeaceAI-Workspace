// Experimental. credit is always false.
// Headline progress is how much of a logged Builder job PeaceAI can do himself, re-measured.
// A row is a pass only when a fresh execution record says so. A missing record is unmeasured, never a pass.
// The official coverage.ts figure is reported beside it and is not this headline.
import { createHash } from "node:crypto";
import {
  countable,
  coverageReport,
  isPeaceRealTask,
  isWorkspaceRealTask,
  liveProvenSkills,
  parseLogEntries,
  retagCountable,
  type CoverageReport,
  type OnMainChecker,
  type WorkspaceProofChecker,
} from "../../builder-log/coverage.ts";
import { retagTarget, type Entry } from "../../builder-log/check.ts";

export const CAPABILITY_SCHEMA = "peaceai-capability-report:v1";

export type RowStatus = "pass" | "fail" | "unmeasured";

export interface ReplayRecord {
  seq: number;
  status: "pass" | "fail" | "unmeasured";
  reason: string;
  /** 40-hex commit the execution ran on. */
  head?: string;
  /** 40-hex tree of that commit. */
  tree?: string;
  /** sha256 of the log text the execution read. */
  input?: string;
  /** Pinned core commit, when the row was a Job A replay. */
  coreCommit?: string;
  /** sha256 of the core archive, when the row was a Job A replay. */
  archiveSha256?: string;
}

export interface ReplayBind {
  head: string;
  tree: string;
  input: string;
  coreCommit?: string;
  archiveSha256?: string;
}

export interface CapabilityRow {
  seq: number;
  by: Entry["by"];
  skill: string;
  /** In the official all-time denominator (Builder non-retag + PeaceAI real tasks) at asOf. */
  inSet: boolean;
  /** coverage.ts would count this row. Not a fresh pass. */
  officialAble: boolean;
  status: RowStatus;
  reason: string;
}

export interface SkillGap {
  skill: string;
  /** Rows in the set that are not a fresh pass. */
  notPass: number;
  unmeasured: number;
  fail: number;
  pass: number;
  /** Of notPass, how many coverage.ts already leaves out. */
  officialMissing: number;
}

export interface CapabilityReport {
  schema: typeof CAPABILITY_SCHEMA;
  experimental: true;
  credit: false;
  asOf: string;
  logSha256: string;
  /** passes / set size, or null when any in-set row is unmeasured. Unmeasured is never a pass. */
  realPassPercent: number | null;
  realPass: string;
  passes: number;
  fails: number;
  unmeasured: number;
  setSize: number;
  outsideSet: number;
  official: { able: number; tasks: number; percent: number | null; ancestry: boolean; cloneHead: string | null; note: string };
  /** In-set rows that are not a fresh pass, ranked by count. */
  gaps: SkillGap[];
  rows: CapabilityRow[];
}

export function realPercent(passes: number, total: number, unmeasured: number): number | null {
  if (total <= 0 || unmeasured > 0) return null;
  return Math.round((1000 * passes) / total) / 10;
}

export function inputDigest(logText: string): string {
  return createHash("sha256").update(logText).digest("hex");
}

const HEX40 = /^[0-9a-f]{40}$/;
const HEX64 = /^[0-9a-f]{64}$/;

/** Why a record cannot count. Null means it is bound to this head, tree, and log. */
export function bindingProblem(rec: ReplayRecord, bind: ReplayBind | null): string | null {
  if (!bind || !HEX40.test(bind.head) || !HEX40.test(bind.tree) || !HEX64.test(bind.input)) return "MISSING_BINDING";
  if (!rec.head || !rec.tree || !rec.input) return "MISSING_BINDING";
  if (!HEX40.test(rec.head) || !HEX40.test(rec.tree) || !HEX64.test(rec.input)) return "FORGED_INPUT";
  if (rec.head !== bind.head) return "STALE_HEAD";
  if (rec.tree !== bind.tree) return "STALE_TREE";
  if (rec.input !== bind.input) return "FORGED_INPUT";
  if (bind.coreCommit || bind.archiveSha256) {
    if (rec.coreCommit !== bind.coreCommit || rec.archiveSha256 !== bind.archiveSha256) return "CORE_PIN";
  }
  return null;
}

function membership(logText: string, asOf: string, onMain: OnMainChecker | null, workspace: WorkspaceProofChecker | null): { tasks: Entry[]; proven: Set<string>; peaceReal: Set<number> } {
  const entries = parseLogEntries(logText);
  const proven = liveProvenSkills(entries, asOf);
  const retag = new Map<number, Entry["skill"]>();
  for (const e of entries) {
    const t = retagTarget(e);
    if (t !== null) retag.set(t, e.skill);
  }
  const builderAll = entries.filter((e) => e.by === "Builder" && retagTarget(e) === null).map((e) => {
    const skill = retag.get(e.seq);
    if (skill === undefined) return e;
    const mark = retagCountable(e, skill, entries) ? "PeaceAI-able today" : `missing skill ${skill}`;
    return { ...e, skill, mark };
  });
  const peaceReal = entries.filter((e) => isPeaceRealTask(e, onMain) || isWorkspaceRealTask(e, workspace));
  const tasks = [...builderAll, ...peaceReal].filter((e) => e.date <= asOf);
  return { tasks, proven, peaceReal: new Set(peaceReal.map((e) => e.seq)) };
}

/** Classifies every log row. Does not run a task and does not write. */
export function buildCapabilityReport(logText: string, asOf: string, onMain: OnMainChecker | null, replay: readonly ReplayRecord[] = [], workspace: WorkspaceProofChecker | null = null, bind: ReplayBind | null = null, cloneHead: string | null = null): CapabilityReport {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) throw new Error("bad asOf date");
  const official: CoverageReport = coverageReport(logText, asOf, { onMain, workspace });
  const { tasks, proven, peaceReal } = membership(logText, asOf, onMain, workspace);
  if (tasks.length !== official.allTime.builderTasks) throw new Error(`set drifted from coverage.ts: ${tasks.length} vs ${official.allTime.builderTasks}`);
  const bySeq = new Map<number, ReplayRecord>();
  for (const r of replay) {
    if (!Number.isInteger(r.seq) || (r.status !== "pass" && r.status !== "fail" && r.status !== "unmeasured") || !r.reason) throw new Error("replay record invalid");
    if (bySeq.has(r.seq)) throw new Error("replay seq repeated");
    bySeq.set(r.seq, r);
  }
  const inSet = new Set(tasks.map((e) => e.seq));
  const rows: CapabilityRow[] = [];
  for (const e of tasks) {
    const officialAble = peaceReal.has(e.seq) ? true : countable(e, proven);
    const rec = bySeq.get(e.seq);
    const unbound = rec ? bindingProblem(rec, bind) : "NO_REPLAY";
    const status: RowStatus = unbound || !rec || rec.status === "unmeasured" ? "unmeasured" : rec.status;
    const reason = unbound ?? rec!.reason;
    rows.push({ seq: e.seq, by: e.by, skill: e.skill, inSet: true, officialAble, status, reason });
  }
  const entries = parseLogEntries(logText);
  for (const e of entries) {
    if (inSet.has(e.seq) || e.date > asOf) continue;
    rows.push({ seq: e.seq, by: e.by, skill: e.skill, inSet: false, officialAble: false, status: "unmeasured", reason: "OUTSIDE_SET" });
  }
  rows.sort((a, b) => a.seq - b.seq);
  const inset = rows.filter((r) => r.inSet);
  const passes = inset.filter((r) => r.status === "pass").length;
  const fails = inset.filter((r) => r.status === "fail").length;
  const unmeasured = inset.filter((r) => r.status === "unmeasured").length;
  const officialAbleCount = inset.filter((r) => r.officialAble).length;
  if (officialAbleCount !== official.allTime.peaceaiAble) throw new Error(`official able drifted: ${officialAbleCount} vs ${official.allTime.peaceaiAble}`);
  const gapMap = new Map<string, SkillGap>();
  for (const r of inset) {
    if (r.status === "pass") continue;
    const g = gapMap.get(r.skill) ?? { skill: r.skill, notPass: 0, unmeasured: 0, fail: 0, pass: 0, officialMissing: 0 };
    g.notPass++;
    if (r.status === "fail") g.fail++;
    else g.unmeasured++;
    if (!r.officialAble) g.officialMissing++;
    gapMap.set(r.skill, g);
  }
  const gaps = [...gapMap.values()].sort((a, b) => b.notPass - a.notPass || a.skill.localeCompare(b.skill));
  const percent = realPercent(passes, inset.length, unmeasured);
  return {
    schema: CAPABILITY_SCHEMA,
    experimental: true,
    credit: false,
    asOf,
    logSha256: createHash("sha256").update(logText).digest("hex"),
    realPassPercent: percent,
    realPass: percent === null ? "unknown" : `${percent}% (${passes}/${inset.length})`,
    passes,
    fails,
    unmeasured,
    setSize: inset.length,
    outsideSet: rows.length - inset.length,
    official: {
      able: official.allTime.peaceaiAble,
      tasks: official.allTime.builderTasks,
      percent: official.allTime.percent,
      ancestry: onMain !== null && cloneHead !== null && HEX40.test(cloneHead),
      cloneHead: onMain !== null ? cloneHead : null,
      note: onMain !== null && cloneHead !== null && HEX40.test(cloneHead)
        ? `on-main ancestry via git merge-base --is-ancestor against clone ${cloneHead}. Not a fresh execution, and not the headline.`
        : "fail-closed: no PeaceSTOCKS ancestry check, so this count is not the official on-main figure.",
    },
    gaps,
    rows,
  };
}
