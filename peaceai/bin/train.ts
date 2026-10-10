// Training job: reads a Results checkout, trains the shadow ranker, writes models/<version>/ back.
// Prints status and counts only (Actions logs are public); task text and features never leave Results.
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { runTraining, buildExamples, type TrainOptions } from "../lib/ranker/pipeline.ts";
import { stableJson, type TaskSource } from "../lib/records.ts";
import { lmEvaluate } from "../lib/lm.ts";
import { loadAll } from "../lib/store.ts";

const root = resolve(process.env.RESULTS_DIR ?? "");
const sources = (process.env.PEACEAI_TRAIN_SOURCES || "peace,builder").split(",").map((s) => s.trim()).filter(Boolean);
if (sources.length === 0 || sources.some((s) => s !== "peace" && s !== "builder")) throw new Error("PEACEAI_TRAIN_SOURCES must list peace and/or builder");
const weights: Partial<Record<TaskSource, number>> = {};
for (const part of (process.env.PEACEAI_SOURCE_WEIGHTS ?? "").split(",").filter(Boolean)) {
  const [k, v] = part.split("=");
  const n = Number(v);
  if ((k !== "peace" && k !== "builder") || !Number.isFinite(n) || n < 0 || n > 10) throw new Error("bad PEACEAI_SOURCE_WEIGHTS");
  weights[k] = n;
}
const options: TrainOptions = { sources: sources as TaskSource[], weights };
const stored = loadAll(root);
const { examples, superseded } = buildExamples(root, stored);
const trained = runTraining(examples, superseded, options);
const model = trained.model;
// M9: the LM shadow score's held-out agreement and promotion rule, next to the M3 model's.
const metrics = { ...trained.metrics, lm: lmEvaluate(stored) };

const dir = join(root, "models", metrics.version);
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, "metrics.json"), stableJson(metrics));
if (model) writeFileSync(join(dir, "model.json"), stableJson(model));
writeFileSync(join(root, "models", "latest.json"), stableJson({ version: metrics.version, hasModel: model !== null, status: metrics.status }));

const h = metrics.heldOut.all;
console.log(
  `status=${metrics.status} version=${metrics.version} trainable=${metrics.counts.trainableTasks} ` +
    `(peace=${metrics.counts.trainableBySource.peace} builder=${metrics.counts.trainableBySource.builder}) pairs=${metrics.counts.pairs} ` +
    `heldout=${h.tasks} heldout_status=${h.status} baseline=${h.baseline.agree}/${h.baseline.counted} ` +
    `model=${h.model ? `${h.model.agree}/${h.model.counted}` : "none"} promotion_eligible=${metrics.promotion.eligible} lm_heldout=${metrics.lm.tasks} lm=${metrics.lm.lmAgree}/${metrics.lm.tasks} lm_promotion_eligible=${metrics.lm.eligible}`,
);
