// M3 model: pairwise logistic regression (a linear RankNet) trained on CPU with seeded SGD.
// P(a preferred over b) = sigmoid(w · (z(a) - z(b))), z = standardized features. No GPU, no services.
import { createHash } from "node:crypto";
import { FEATURE_COUNT, FEATURE_VERSION } from "./features.ts";

export const MODEL_SCHEMA = "peaceai-ranker-model:v1";
export const HYPER = { epochs: 300, learningRate: 0.05, l2: 0.01 } as const;

export interface Pair {
  better: number[];
  worse: number[];
  weight: number;
}

export interface Model {
  schema: typeof MODEL_SCHEMA;
  version: string;
  features: typeof FEATURE_VERSION;
  featureCount: number;
  seed: string;
  hyper: typeof HYPER;
  mean: number[];
  std: number[];
  weights: number[];
}

/** Deterministic PRNG from a string seed (sha256 -> mulberry32). */
export function rng(seed: string): () => number {
  let a = createHash("sha256").update(seed).digest().readUInt32BE(0);
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const round = (x: number) => Math.round(x * 1e9) / 1e9;
const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));

export function standardizer(rows: readonly number[][]): { mean: number[]; std: number[] } {
  const mean = new Array<number>(FEATURE_COUNT).fill(0);
  const std = new Array<number>(FEATURE_COUNT).fill(1);
  if (rows.length === 0) return { mean, std };
  for (let j = 0; j < FEATURE_COUNT; j += 1) {
    const m = rows.reduce((s, r) => s + r[j]!, 0) / rows.length;
    const v = rows.reduce((s, r) => s + (r[j]! - m) ** 2, 0) / rows.length;
    mean[j] = round(m);
    std[j] = v > 1e-12 ? round(Math.sqrt(v)) : 1;
  }
  return { mean, std };
}

const z = (x: readonly number[], mean: readonly number[], std: readonly number[]) => x.map((v, j) => (v - mean[j]!) / std[j]!);

export function train(pairs: readonly Pair[], rows: readonly number[][], seed: string, version: string): Model {
  const { mean, std } = standardizer(rows);
  const w = new Array<number>(FEATURE_COUNT).fill(0);
  // Each pair is used in both directions so the model has no side bias.
  const samples = pairs.flatMap((p) => {
    const worse = z(p.worse, mean, std);
    const d = z(p.better, mean, std).map((v, j) => v - worse[j]!);
    return [
      { d, y: 1, weight: p.weight },
      { d: d.map((v) => -v), y: 0, weight: p.weight },
    ];
  });
  const next = rng(seed);
  const order = samples.map((_, i) => i);
  for (let epoch = 0; epoch < HYPER.epochs; epoch += 1) {
    for (let i = order.length - 1; i > 0; i -= 1) {
      const k = Math.floor(next() * (i + 1));
      [order[i], order[k]] = [order[k]!, order[i]!];
    }
    for (const i of order) {
      const { d, y, weight } = samples[i]!;
      const p = sigmoid(d.reduce((s, v, j) => s + v * w[j]!, 0));
      const g = (p - y) * weight;
      for (let j = 0; j < FEATURE_COUNT; j += 1) w[j] = w[j]! - HYPER.learningRate * (g * d[j]! + HYPER.l2 * w[j]!);
    }
  }
  return { schema: MODEL_SCHEMA, version, features: FEATURE_VERSION, featureCount: FEATURE_COUNT, seed, hyper: HYPER, mean, std, weights: w.map(round) };
}

export function score(model: Model, x: readonly number[]): number {
  return round(z(x, model.mean, model.std).reduce((s, v, j) => s + v * model.weights[j]!, 0));
}

/** Rank by model score (high first); ties keep the deterministic baseline order. */
export function rankWithModel(model: Model, items: readonly { id: string; x: number[] }[], baselineOrder: readonly string[]) {
  const pos = (id: string) => (baselineOrder.includes(id) ? baselineOrder.indexOf(id) : Number.MAX_SAFE_INTEGER);
  const scored = items.map((c) => ({ id: c.id, score: score(model, c.x) }));
  scored.sort((a, b) => b.score - a.score || pos(a.id) - pos(b.id) || a.id.localeCompare(b.id));
  return scored;
}

export function validateModel(m: unknown): m is Model {
  const o = m as Model;
  return (
    !!o && o.schema === MODEL_SCHEMA && o.features === FEATURE_VERSION && o.featureCount === FEATURE_COUNT &&
    [o.mean, o.std, o.weights].every((a) => Array.isArray(a) && a.length === FEATURE_COUNT && a.every(Number.isFinite))
  );
}
