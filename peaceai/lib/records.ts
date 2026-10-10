import { editKey } from "./dedupe.ts";
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
  /** Who opened the task: Peace, or the Builder agent (`source:builder` label at pick time). Absent = peace. */
  source?: TaskSource;
  /** M5: target repository (`owner/repo`) the diffs apply to. Absent on older records = this Workspace. */
  target?: string;
}

export type TaskSource = "peace" | "builder";
export const taskSourceOf = (task: Pick<TaskRecord, "source">): TaskSource => (task.source === "builder" ? "builder" : "peace");

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
  rankPosition: number | null; // 1 = ranker's top pick among distinct eligible edits
  /** M4.1: key of the normalized non-test src edit (eligible candidates only; absent on older records). */
  editKey?: string | null;
  /** M4.1: id of the presented candidate making the same edit; null when this one stands for its edit. */
  duplicateOf?: string | null;
  /** M7.1: the recorded diff is the test-and-fix loop's repaired diff. Absent on older records (= false). */
  repaired?: boolean;
}

export interface EditGroup {
  key: string;
  representative: string;
  members: string[];
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
  /** M4.1: eligible candidates grouped by distinct edit. Absent on older records (every eligible is distinct). */
  editGroups?: EditGroup[];
  /** M4.1: number of distinct eligible edits (= presentation length). */
  distinctEdits?: number;
  /** M3: model ranking recorded alongside, never shown. Absent when no model existed at ranking time. */
  shadow?: ShadowRanking;
  /** M3: which ranker is authoritative for this record. Absent = deterministic. */
  active?: "deterministic" | "model";
  /** M3: top pick of the active ranker (equals rankerTop unless the model is active). */
  activeTop?: string | null;
}

export interface ShadowRanking {
  model: string; // model version
  features: string; // feature version
  order: string[];
  top: string | null;
  scores: { id: string; score: number }[];
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
  source?: TaskSource;
  target?: string;
}

/**
 * Eligible candidates that stand for a distinct edit: the presented representative of each edit group.
 * Older records without groups count every eligible candidate. Agreement, training, pairs and shadow
 * scoring all use this one helper.
 */
export function distinctEligible(ranking: Pick<RankingRecord, "candidates">): RankedCandidate[] {
  return ranking.candidates.filter((c) => c.eligible && (c.duplicateOf ?? null) === null);
}

/**
 * Groups eligible candidates by distinct edit. Representative: when the task asks for tests, a member with
 * new test files first; then the deterministic ranking order (original suite, smallest diff, id).
 */
export function groupEdits(eligible: readonly CandidateResult[], requiresTests: boolean, diffOf: (id: string) => string): EditGroup[] {
  const order = rankCandidates(eligible);
  const byKey = new Map<string, CandidateResult[]>();
  for (const c of order) {
    const key = editKey(diffOf(c.id));
    byKey.set(key, [...(byKey.get(key) ?? []), c]);
  }
  return [...byKey.entries()].map(([key, members]) => {
    const preferred = requiresTests ? members.filter((m) => m.newTestFiles > 0) : [];
    return { key, representative: (preferred[0] ?? members[0]!).id, members: members.map((m) => m.id).sort() };
  });
}

export function buildRecords(
  task: TaskInputs,
  summary: readonly SummaryCandidate[],
  results: readonly CandidateResult[],
  seed: string,
  /** Candidate diff by id. When given (Job C always does), eligible candidates are deduplicated by edit. */
  diffOf?: (id: string) => string,
  /** M7.1: candidates whose final diff is a repaired one. When given, every candidate records `repaired`. */
  repairedIds?: ReadonlySet<string>,
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
  const groups = diffOf ? groupEdits(eligible, requiresTests, diffOf) : null;
  const representatives = new Set(groups ? groups.map((g) => g.representative) : eligible.map((c) => c.id));
  const keyOf = new Map(groups?.flatMap((g) => g.members.map((m) => [m, g] as const)) ?? []);
  const order = rankCandidates(eligible).map((c) => c.id).filter((id) => representatives.has(id));
  const shown = shuffle([...representatives].sort(), seed);
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
    ...(groups
      ? {
          editKey: keyOf.get(s.id)?.key ?? null,
          duplicateOf: keyOf.has(s.id) && keyOf.get(s.id)!.representative !== s.id ? keyOf.get(s.id)!.representative : null,
        }
      : {}),
    ...(repairedIds ? { repaired: repairedIds.has(s.id) } : {}),
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
      source: task.source === "builder" ? "builder" : "peace",
      ...(task.target ? { target: task.target } : {}),
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
      ...(groups ? { editGroups: groups, distinctEdits: groups.length } : {}),
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

/** Verdict rows in the order they were given (raw rows stay append-only; this only orders them). */
export function orderVerdicts(verdicts: readonly VerdictRecord[]): VerdictRecord[] {
  const id = (v: VerdictRecord) => (/^\d+$/.test(v.commentId) ? BigInt(v.commentId) : 0n);
  return [...verdicts].sort(
    (a, b) => a.recordedAt.localeCompare(b.recordedAt) || (id(a) < id(b) ? -1 : id(a) > id(b) ? 1 : a.commentId.localeCompare(b.commentId)),
  );
}

export interface EffectiveVerdict {
  /** Latest verdict still standing: the one training uses. null when none, or when withdrawn by `unsure`. */
  latest: VerdictRecord | null;
  /** Latest decisive verdict still standing, for agreement: `<letter> right` picks it, `none wrong` picks none. */
  pick: { decided: boolean; candidateId: string | null };
  /** True after a withdrawal with no decisive verdict since: excluded from training and agreement. */
  withdrawn: boolean;
  /** Raw counts, for reporting only. */
  total: number;
  unsure: number;
}

/**
 * Latest verdict wins. The single rule every reader (summary, agreement, M3 training) must use.
 * Rows are applied in the order they were given:
 * - `<letter> right` / `none wrong` become the standing pick (agreement) and `latest` (training);
 * - `none unsure`, or `<letter> unsure` / `<letter> wrong` naming the standing `right` pick, withdraws:
 *   pick and latest are cleared and the issue is excluded until the next decisive verdict;
 * - `<letter> wrong` on any other letter becomes `latest` and leaves the pick as it is;
 * - any other `<letter> unsure` is only a label for that candidate: nothing changes.
 */
export function effectiveVerdict(verdicts: readonly VerdictRecord[]): EffectiveVerdict {
  const ordered = orderVerdicts(verdicts);
  let latest: VerdictRecord | null = null;
  let pick = { decided: false, candidateId: null as string | null };
  let withdrawn = false;
  for (const v of ordered) {
    if (withdraws(v, pick)) {
      latest = null;
      pick = { decided: false, candidateId: null };
      withdrawn = true;
      continue;
    }
    if (v.verdict === "unsure") continue;
    latest = v;
    if (v.verdict === "right" && v.candidateId) pick = { decided: true, candidateId: v.candidateId };
    else if (v.verdict === "wrong" && v.candidateId === null) pick = { decided: true, candidateId: null };
    if (pick.decided) withdrawn = false;
  }
  const unsure = ordered.filter((v) => v.verdict === "unsure").length;
  return { latest, pick, withdrawn, total: ordered.length, unsure };
}

/**
 * Does this row withdraw the standing verdict? `none unsure`, or `<letter> unsure` / `<letter> wrong`
 * on the letter currently picked with `right`. `none wrong` is a decisive pick, never a withdrawal.
 */
export function withdraws(v: Pick<VerdictRecord, "verdict" | "candidateId">, pick: { decided: boolean; candidateId: string | null }): boolean {
  if (v.verdict === "right") return false;
  if (v.candidateId === null) return v.verdict === "unsure";
  return pick.decided && pick.candidateId === v.candidateId;
}

/** Kept for callers of the M2 API; same rule as effectiveVerdict().pick. */
export function peacePick(verdicts: readonly VerdictRecord[]): { decided: boolean; candidateId: string | null } {
  return effectiveVerdict(verdicts).pick;
}

export interface TaskEntry {
  issue: number;
  runId: string;
  source: TaskSource;
  /** M5: null = this Workspace. */
  target: string | null;
  test: boolean;
  heldOut: boolean;
  requiresTests: boolean;
  candidates: number;
  eligible: number;
  /** M4.1: distinct eligible edits; a task needs 2+ to count toward agreement and training. */
  distinctEdits: number;
  rankerTop: string | null;
  peacePick: string | null;
  decided: boolean;
  verdicts: number;
  unsure: number;
  withdrawn: boolean;
  latestVerdict: { label: string | null; candidateId: string | null; verdict: VerdictValue } | null;
  agree: boolean | null; // null when not comparable
  countsTowardAgreement: boolean;
  trainable: boolean;
}

export function taskEntry(task: TaskRecord, ranking: RankingRecord, verdicts: readonly VerdictRecord[]): TaskEntry {
  const effective = effectiveVerdict(verdicts);
  const pick = effective.pick;
  const eligible = ranking.candidates.filter((c) => c.eligible).length;
  const distinctEdits = distinctEligible(ranking).length;
  const comparable = pick.decided && distinctEdits >= 2;
  return {
    issue: task.issue,
    runId: task.runId,
    source: taskSourceOf(task),
    target: task.target ?? null,
    test: task.test,
    heldOut: task.heldOut,
    requiresTests: task.requiresTests,
    candidates: ranking.candidates.length,
    eligible,
    distinctEdits,
    rankerTop: ranking.rankerTop,
    peacePick: pick.candidateId,
    decided: pick.decided,
    verdicts: effective.total,
    unsure: effective.unsure,
    withdrawn: effective.withdrawn,
    latestVerdict: effective.latest ? { label: effective.latest.label, candidateId: effective.latest.candidateId, verdict: effective.latest.verdict } : null,
    agree: comparable ? pick.candidateId === ranking.rankerTop : null,
    countsTowardAgreement: comparable && !task.test,
    // Latest decisive verdict still standing (not withdrawn). The M3 ranker additionally needs a pairable pick.
    trainable: !task.test && !task.heldOut && pick.decided,
  };
}

export function buildSummary(input: readonly TaskEntry[]) {
  // Only the latest attempt per issue counts toward agreement and training; older attempts are listed.
  const latestRun = new Map<number, bigint>();
  for (const e of input) {
    const run = BigInt(e.runId);
    if (!latestRun.has(e.issue) || run > latestRun.get(e.issue)!) latestRun.set(e.issue, run);
  }
  const entries = input.map((e) =>
    BigInt(e.runId) === latestRun.get(e.issue)
      ? { ...e, superseded: false }
      : { ...e, superseded: true, countsTowardAgreement: false, trainable: false },
  );
  const sorted = [...entries].sort((a, b) => a.issue - b.issue || (BigInt(a.runId) < BigInt(b.runId) ? -1 : BigInt(a.runId) > BigInt(b.runId) ? 1 : 0));
  const score = (list: readonly (TaskEntry & { superseded: boolean })[]) => {
    const counted = list.filter((e) => e.countsTowardAgreement);
    const agree = counted.filter((e) => e.agree === true).length;
    return { counted: counted.length, agree, rate: counted.length ? Math.round((agree / counted.length) * 1000) / 1000 : null };
  };
  const real = sorted.filter((e) => !e.test && !e.superseded);
  return {
    schema: SUMMARY_SCHEMA,
    tasks: sorted.length,
    testTasks: sorted.length - real.length,
    heldOutTasks: real.filter((e) => e.heldOut).length,
    reviewedTasks: real.filter((e) => e.verdicts > 0).length,
    trainableTasks: real.filter((e) => e.trainable).length,
    agreement: score(sorted),
    agreementHeldOut: score(sorted.filter((e) => e.heldOut)),
    agreementBySource: { peace: score(sorted.filter((e) => e.source === "peace")), builder: score(sorted.filter((e) => e.source === "builder")) },
    withdrawnTasks: real.filter((e) => e.withdrawn).length,
    singleEditTasks: real.filter((e) => e.distinctEdits === 1).length,
    entries: sorted,
  };
}
