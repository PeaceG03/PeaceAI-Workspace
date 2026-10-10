import type { SummaryCandidate } from "./gate.ts";
import { isHeldOut, isTestTask, taskRequiresTests } from "./policy.ts";
import { isPassing, rankCandidates, shuffle, type CandidateResult } from "./rank.ts";
import type { VerdictValue } from "./verdict.ts";

export const TASK_SCHEMA = "peaceai-results-task:v1";
export const RANKING_SCHEMA = "peaceai-results-ranking:v1";
export const VERDICT_SCHEMA = "peaceai-results-verdict:v1";
export const SUMMARY_SCHEMA = "peaceai-results-summary:v1";

/** JSON with recursively sorted keys and a trailing newline, so records are byte-stable. */
export function stableJson(value: unknown): string {
  const sort = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(sort);
    if (v && typeof v === "object")
      return Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, sort((v as Record<string, unknown>)[k])]));
    return v;
  };
  return JSON.stringify(sort(value), null, 2) + "\n";
}

export interface TaskRecord {
  schema: typeof TASK_SCHEMA;
  issue: number;
  runId: string;
  recordedAt: string;
  baseSha: string;
  title: string;
  body: string;
  test: boolean;
  heldOut: boolean;
  requiresTests: boolean;
}

export type RejectReason = "not-applied" | "typecheck" | "original-suite" | "new-tests" | "missing-required-test" | null;

export interface RankedCandidate {
  id: string;
  label: string | null; // presentation label; null when not shown
  diffFile: string;
  transformations: string[];
  operationId: string | null;
  diffLines: number;
  diffBytes: number;
  newTestFiles: number;
  applied: boolean;
  typecheckPassed: boolean;
  originalSuitePassed: boolean;
  newTestsPassed: boolean;
  eligible: boolean;
  rejectReason: RejectReason;
  rankPosition: number | null; // 1 = ranker's top pick among eligible candidates
}

export interface RankingRecord {
  schema: typeof RANKING_SCHEMA;
  issue: number;
  runId: string;
  ranker: "deterministic:original-suite-then-smallest-diff:v1";
  requiresTests: boolean;
  candidates: RankedCandidate[];
  rankerOrder: string[];
  rankerTop: string | null;
  presentation: { label: string; id: string }[];
}

export function rejectReason(c: CandidateResult, requiresTests: boolean): RejectReason {
  if (!c.applied) return "not-applied";
  if (!c.typecheckPassed) return "typecheck";
  if (!c.originalSuitePassed) return "original-suite";
  if (!c.newTestsPassed) return "new-tests";
  if (requiresTests && c.newTestFiles === 0) return "missing-required-test";
  return null;
}

export interface TaskInputs {
  issue: number;
  runId: string;
  recordedAt: string;
  baseSha: string;
  title: string;
  body: string;
}

export function buildRecords(
  task: TaskInputs,
  summary: readonly SummaryCandidate[],
  results: readonly CandidateResult[],
  seed: string,
): { task: TaskRecord; ranking: RankingRecord } {
  const requiresTests = taskRequiresTests(`${task.title}\n${task.body}`);
  const byId = new Map(results.map((r) => [r.id, r]));
  const evaluated = summary.map((s) => {
    const r = byId.get(s.id) ?? {
      id: s.id, diffBytes: s.diffBytes, diffLines: s.diffLines, applied: false, typecheckPassed: false,
      originalSuitePassed: false, newTestsPassed: false, newTestFiles: 0,
    };
    return { s, r, reason: rejectReason(r, requiresTests) };
  });
  const eligible = evaluated.filter((e) => e.reason === null && isPassing(e.r)).map((e) => e.r);
  const order = rankCandidates(eligible).map((c) => c.id);
  const shown = shuffle(eligible.map((c) => c.id).sort(), seed);
  const presentation = shown.map((id, i) => ({ label: String.fromCharCode(65 + i), id }));
  const labelOf = new Map(presentation.map((p) => [p.id, p.label]));
  const candidates: RankedCandidate[] = evaluated.map(({ s, r, reason }) => ({
    id: s.id,
    label: labelOf.get(s.id) ?? null,
    diffFile: `candidates/${s.id}.diff`,
    transformations: [...s.transformations],
    operationId: s.operationId,
    diffLines: s.diffLines,
    diffBytes: s.diffBytes,
    newTestFiles: r.newTestFiles,
    applied: r.applied,
    typecheckPassed: r.typecheckPassed,
    originalSuitePassed: r.originalSuitePassed,
    newTestsPassed: r.newTestsPassed,
    eligible: reason === null,
    rejectReason: reason,
    rankPosition: order.includes(s.id) ? order.indexOf(s.id) + 1 : null,
  }));
  return {
    task: {
      schema: TASK_SCHEMA,
      issue: task.issue,
      runId: task.runId,
      recordedAt: task.recordedAt,
      baseSha: task.baseSha,
      title: task.title,
      body: task.body,
      test: isTestTask(task.title),
      heldOut: isHeldOut(task.issue),
      requiresTests,
    },
    ranking: {
      schema: RANKING_SCHEMA,
      issue: task.issue,
      runId: task.runId,
      ranker: "deterministic:original-suite-then-smallest-diff:v1",
      requiresTests,
      candidates,
      rankerOrder: order,
      rankerTop: order[0] ?? null,
      presentation,
    },
  };
}

export interface VerdictRecord {
  schema: typeof VERDICT_SCHEMA;
  issue: number;
  runId: string;
  commentId: string;
  recordedAt: string;
  label: string | null;
  candidateId: string | null;
  verdict: VerdictValue;
}

/** The latest decisive verdict picks a candidate (`X right`) or none (`none wrong`); others never pick. */
export function peacePick(verdicts: readonly VerdictRecord[]): { decided: boolean; candidateId: string | null } {
  const sorted = [...verdicts].sort((a, b) => a.recordedAt.localeCompare(b.recordedAt) || a.commentId.localeCompare(b.commentId));
  let result = { decided: false, candidateId: null as string | null };
  for (const v of sorted) {
    if (v.verdict === "right" && v.candidateId) result = { decided: true, candidateId: v.candidateId };
    else if (v.verdict === "wrong" && v.candidateId === null) result = { decided: true, candidateId: null };
  }
  return result;
}

export interface TaskEntry {
  issue: number;
  runId: string;
  test: boolean;
  heldOut: boolean;
  requiresTests: boolean;
  candidates: number;
  eligible: number;
  rankerTop: string | null;
  peacePick: string | null;
  decided: boolean;
  verdicts: number;
  unsure: number;
  agree: boolean | null; // null when not comparable
  countsTowardAgreement: boolean;
  trainable: boolean;
}

export function taskEntry(task: TaskRecord, ranking: RankingRecord, verdicts: readonly VerdictRecord[]): TaskEntry {
  const pick = peacePick(verdicts);
  const eligible = ranking.candidates.filter((c) => c.eligible).length;
  const comparable = pick.decided && eligible >= 2;
  return {
    issue: task.issue,
    runId: task.runId,
    test: task.test,
    heldOut: task.heldOut,
    requiresTests: task.requiresTests,
    candidates: ranking.candidates.length,
    eligible,
    rankerTop: ranking.rankerTop,
    peacePick: pick.candidateId,
    decided: pick.decided,
    verdicts: verdicts.length,
    unsure: verdicts.filter((v) => v.verdict === "unsure").length,
    agree: comparable ? pick.candidateId === ranking.rankerTop : null,
    countsTowardAgreement: comparable && !task.test,
    trainable: !task.test && !task.heldOut && verdicts.some((v) => v.verdict !== "unsure"),
  };
}

export function buildSummary(entries: readonly TaskEntry[]) {
  const sorted = [...entries].sort((a, b) => a.issue - b.issue || a.runId.localeCompare(b.runId));
  const score = (list: readonly TaskEntry[]) => {
    const counted = list.filter((e) => e.countsTowardAgreement);
    const agree = counted.filter((e) => e.agree === true).length;
    return { counted: counted.length, agree, rate: counted.length ? Math.round((agree / counted.length) * 1000) / 1000 : null };
  };
  const real = sorted.filter((e) => !e.test);
  return {
    schema: SUMMARY_SCHEMA,
    tasks: sorted.length,
    testTasks: sorted.length - real.length,
    heldOutTasks: real.filter((e) => e.heldOut).length,
    reviewedTasks: real.filter((e) => e.verdicts > 0).length,
    trainableTasks: real.filter((e) => e.trainable).length,
    agreement: score(sorted),
    agreementHeldOut: score(sorted.filter((e) => e.heldOut)),
    entries: sorted,
  };
}
