// M3 pipeline: dataset from Results, trainable filter, training, held-out evaluation, promotion rule,
// shadow ranking. Everything is derived from Results records through effectiveVerdict().
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { effectiveVerdict, stableJson, taskSourceOf, type RankingRecord, type ShadowRanking, type TaskRecord, type TaskSource } from "../records.ts";
import type { StoredTask } from "../store.ts";
import { extractFeatures, FEATURE_VERSION, type CandidateFeatures } from "./features.ts";
import { rankWithModel, train, validateModel, type Model, type Pair } from "./model.ts";

export const METRICS_SCHEMA = "peaceai-ranker-metrics:v1";
export const MIN_TRAIN_TASKS = 10; // below this no model is trained: "insufficient data"
export const MIN_EVAL_TASKS = 5; // below this held-out agreement is reported as "insufficient data"
export const PROMOTION_RULE = { minTrainableTasks: 30, minHeldOutTasks: 10, mustBeatBaseline: true } as const;
export const DEFAULT_SEED = "peaceai-ranker:v1";

export interface Example {
  issue: number;
  runId: string;
  source: TaskSource;
  test: boolean;
  heldOut: boolean;
  withdrawn: boolean;
  decided: boolean;
  pick: string | null;
  eligible: string[];
  baselineOrder: string[];
  features: CandidateFeatures[]; // eligible candidates only
}

export type Exclusion = "test" | "held-out" | "withdrawn" | "undecided" | "picked-none" | "pick-not-eligible" | "under-2-eligible" | "superseded";

/** The latest attempt per issue, as examples. Older attempts are superseded and never used. */
export function buildExamples(root: string, stored: readonly StoredTask[]): { examples: Example[]; superseded: number } {
  const latest = new Map<number, StoredTask>();
  for (const t of stored) {
    const cur = latest.get(t.task.issue);
    if (!cur || BigInt(t.task.runId) > BigInt(cur.task.runId)) latest.set(t.task.issue, t);
  }
  const examples = [...latest.values()]
    .sort((a, b) => a.task.issue - b.task.issue)
    .map((t) => toExample(t.task, t.ranking, effectiveVerdict(t.verdicts), (id) => readDiff(root, t.task, id)));
  return { examples, superseded: stored.length - latest.size };
}

function readDiff(root: string, task: TaskRecord, id: string): string {
  const path = join(root, "tasks", String(task.issue), task.runId, "candidates", `${id}.diff`);
  return existsSync(path) ? readFileSync(path, "utf8") : "";
}

export function toExample(task: TaskRecord, ranking: RankingRecord, e: ReturnType<typeof effectiveVerdict>, diff: (id: string) => string): Example {
  const eligible = ranking.candidates.filter((c) => c.eligible);
  const diffs = new Map(eligible.map((c) => [c.id, diff(c.id)]));
  return {
    issue: task.issue,
    runId: task.runId,
    source: taskSourceOf(task),
    test: task.test,
    heldOut: task.heldOut,
    withdrawn: e.withdrawn,
    decided: e.pick.decided,
    pick: e.pick.candidateId,
    eligible: eligible.map((c) => c.id),
    baselineOrder: [...ranking.rankerOrder],
    features: extractFeatures(task, eligible, diffs),
  };
}

/** Why an example cannot be used for training (null = trainable). */
export function trainExclusion(x: Example): Exclusion | null {
  if (x.test) return "test";
  if (x.heldOut) return "held-out";
  return labelExclusion(x);
}

function labelExclusion(x: Example): Exclusion | null {
  if (x.withdrawn) return "withdrawn";
  if (!x.decided) return "undecided";
  if (x.pick === null) return "picked-none";
  if (!x.eligible.includes(x.pick)) return "pick-not-eligible";
  if (x.eligible.length < 2) return "under-2-eligible";
  return null;
}

/** Held-out evaluation set: held-out, non-test, decided (incl. `none wrong`), 2+ eligible, not withdrawn. */
export function isEvalExample(x: Example): boolean {
  return !x.test && x.heldOut && !x.withdrawn && x.decided && x.eligible.length >= 2;
}

export interface TrainOptions {
  seed?: string;
  sources?: readonly TaskSource[]; // filter (default both)
  weights?: Partial<Record<TaskSource, number>>; // weight (default 1 each)
}

export function pairsFor(examples: readonly Example[], weights: Partial<Record<TaskSource, number>> = {}): Pair[] {
  const pairs: Pair[] = [];
  for (const x of examples) {
    const best = x.features.find((f) => f.id === x.pick)!;
    for (const other of x.features) if (other.id !== x.pick) pairs.push({ better: best.x, worse: other.x, weight: weights[x.source] ?? 1 });
  }
  return pairs;
}

type Score = { counted: number; agree: number; rate: number | null };
const scoreOf = (hits: readonly boolean[]): Score => {
  const agree = hits.filter(Boolean).length;
  return { counted: hits.length, agree, rate: hits.length ? Math.round((agree / hits.length) * 1000) / 1000 : null };
};

export function modelTop(model: Model, x: Example): string | null {
  return rankWithModel(model, x.features, x.baselineOrder)[0]?.id ?? null;
}

export function evaluate(model: Model | null, examples: readonly Example[]) {
  const set = examples.filter(isEvalExample);
  const by = (src: TaskSource | null) => {
    const list = set.filter((x) => src === null || x.source === src);
    const baseline = scoreOf(list.map((x) => x.baselineOrder[0] === x.pick));
    const modelScore = model ? scoreOf(list.map((x) => modelTop(model, x) === x.pick)) : null;
    const status = list.length < MIN_EVAL_TASKS ? "insufficient data" : "ok";
    return { status, tasks: list.length, baseline, model: modelScore };
  };
  return { all: by(null), peace: by("peace"), builder: by("builder") };
}

export function promotion(trainableTasks: number, evalAll: ReturnType<typeof evaluate>["all"], hasModel: boolean) {
  const reasons: string[] = [];
  if (!hasModel) reasons.push("no model");
  if (trainableTasks < PROMOTION_RULE.minTrainableTasks) reasons.push(`trainable tasks ${trainableTasks} < ${PROMOTION_RULE.minTrainableTasks}`);
  if (evalAll.tasks < PROMOTION_RULE.minHeldOutTasks) reasons.push(`held-out tasks ${evalAll.tasks} < ${PROMOTION_RULE.minHeldOutTasks}`);
  const m = evalAll.model?.agree ?? 0;
  if (PROMOTION_RULE.mustBeatBaseline && !(hasModel && m > evalAll.baseline.agree)) reasons.push("model does not beat the baseline on held-out");
  return { rule: PROMOTION_RULE, eligible: reasons.length === 0, reasons };
}

/** Promotion takes effect only when the rule is met AND Peace set PEACEAI_RANKER=model. */
export function activeRanker(variable: string | undefined, promotionEligible: boolean): "deterministic" | "model" {
  return variable === "model" && promotionEligible ? "model" : "deterministic";
}

export function runTraining(examples: readonly Example[], superseded: number, options: TrainOptions = {}) {
  const seed = options.seed ?? DEFAULT_SEED;
  const sources = options.sources ?? (["peace", "builder"] as const);
  const exclusions: Record<string, number> = {};
  const trainable: Example[] = [];
  for (const x of examples) {
    const why = trainExclusion(x) ?? (sources.includes(x.source) ? null : "source-filtered");
    if (why) exclusions[why] = (exclusions[why] ?? 0) + 1;
    else trainable.push(x);
  }
  if (superseded) exclusions.superseded = superseded;
  const pairs = pairsFor(trainable, options.weights);
  const evalSet = examples.filter(isEvalExample);
  const dataHash = createHash("sha256")
    .update(stableJson({ seed, features: FEATURE_VERSION, sources, weights: options.weights ?? {}, train: trainable, eval: evalSet }))
    .digest("hex")
    .slice(0, 12);
  const version = `ranker-v1-${dataHash}`;
  const enough = trainable.length >= MIN_TRAIN_TASKS;
  const model = enough ? train(pairs, trainable.flatMap((x) => x.features.map((f) => f.x)), seed, version) : null;
  const heldOut = evaluate(model, examples);
  const bySource = (src: TaskSource) => trainable.filter((x) => x.source === src).length;
  const metrics = {
    schema: METRICS_SCHEMA,
    version,
    features: FEATURE_VERSION,
    status: enough ? "trained" : "insufficient data",
    minimumTrainTasks: MIN_TRAIN_TASKS,
    seed,
    sources: [...sources],
    weights: { peace: options.weights?.peace ?? 1, builder: options.weights?.builder ?? 1 },
    counts: {
      latestAttempts: examples.length,
      trainableTasks: trainable.length,
      trainableBySource: { peace: bySource("peace"), builder: bySource("builder") },
      pairs: pairs.length,
      heldOutEvalTasks: evalSet.length,
      excluded: exclusions,
    },
    heldOut,
    promotion: promotion(trainable.length, heldOut.all, model !== null),
  };
  return { model, metrics };
}

/** Shadow ranking for Job C: model order over eligible candidates, or null when there is no model. */
export function shadowRanking(model: Model | null, task: TaskRecord, ranking: RankingRecord, diff: (id: string) => string): ShadowRanking | null {
  if (!model) return null;
  const eligible = ranking.candidates.filter((c) => c.eligible);
  if (eligible.length === 0) return null;
  const features = extractFeatures(task, eligible, new Map(eligible.map((c) => [c.id, diff(c.id)])));
  const ranked = rankWithModel(model, features, ranking.rankerOrder);
  return { model: model.version, features: FEATURE_VERSION, order: ranked.map((r) => r.id), top: ranked[0]?.id ?? null, scores: ranked };
}

/** Latest trained model in a Results checkout, or null. */
export function loadLatestModel(root: string): { model: Model; promotionEligible: boolean } | null {
  const pointer = join(root, "models", "latest.json");
  if (!existsSync(pointer)) return null;
  const latest = JSON.parse(readFileSync(pointer, "utf8")) as { version?: string; hasModel?: boolean };
  if (!latest.hasModel || !/^ranker-v1-[0-9a-f]{12}$/.test(latest.version ?? "")) return null;
  const dir = join(root, "models", latest.version!);
  if (!existsSync(join(dir, "model.json"))) return null;
  const model = JSON.parse(readFileSync(join(dir, "model.json"), "utf8"));
  if (!validateModel(model)) return null;
  const metrics = existsSync(join(dir, "metrics.json")) ? JSON.parse(readFileSync(join(dir, "metrics.json"), "utf8")) : null;
  return { model, promotionEligible: metrics?.promotion?.eligible === true };
}
