// M167: model-v1, the model-backed edit proposer (spec/edit-proposer-model-v1.md). Rerank only: its candidates are
// repair-v1's (editpropose.ts repairCandidates, at most MAX_CANDIDATES = 60), in the order a SEPARATE scoring job gave
// them (bin/model-v1-score.ts, the only place a model runs). This module is what the attempt job runs: it holds no
// weights, imports no model code, and only checks and applies a ranking:
//   - the ranking text must hash to the sha256 the scoring job gave next to it (its job output), be exactly the
//     ranking schema, for this task file and the pinned weights, with a well-formed model manifest sha256;
//   - this task must have exactly one entry, and the entry's binding sha256 must be the one recomputed from this
//     task's key, the candidate list THIS job rebuilt (its sha256) and the index list;
//   - the index list must be a permutation of 0..n-1 for this candidate list.
// Any failure throws inside prepare / next, which the loop turns into PROPOSER_FAILED (never a fallback to repair-v1's
// order: the row would then claim a model ranking that was not used). Each guard is a single line tagged
// "// m167-guard:<id>"; m167-model-proposer.test.ts deletes each in turn and requires a case to fail.
import { createHash } from "node:crypto";
import { MAX_CANDIDATES, repairProposer, type Candidate } from "./editpropose.ts";
import { resolve } from "node:path";
import type { CodeRepo } from "./codesearch.ts";

export const MODEL_PROPOSER = "model-v1";
export const RANKING_SCHEMA = "peaceai-model-v1-ranking:v1";
/** The ranking travels as a job output: a hard cap well under GitHub's 1 MB per job. */
export const MAX_RANKING_BYTES = 64 * 1024;
export const MAX_RANKING_ENTRIES = 50;

export interface RankingEntry { taskKey: string; candidatesSha256: string; order: number[]; bindingSha256: string }
export interface Ranking { schema: typeof RANKING_SCHEMA; taskFileSha256: string; weightsSha256: string; modelManifestSha256: string; entries: RankingEntry[] }

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const H64 = /^[0-9a-f]{64}$/;
const TASK_KEY = /^[0-9a-f]{16}$/;

/** The sha256 of a candidate list: its candidate keys (each the sha256 of the candidate's edits) in list order. */
export function candidatesSha256(cands: readonly Pick<Candidate, "key">[]): string {
  return sha256(JSON.stringify(cands.map((c) => c.key)));
}

/** The index list's binding to the task and the candidate list (and the model that ranked it). */
export function bindingSha256(modelManifestSha256: string, taskKey: string, candsSha: string, order: readonly number[]): string {
  return sha256(`${RANKING_SCHEMA}\n${modelManifestSha256}\n${taskKey}\n${candsSha}\n${order.join(",")}\n`);
}

/** order is a permutation of 0..n-1. */
export function isPermutation(order: unknown, n: number): boolean {
  if (!Array.isArray(order) || order.length !== n) return false;
  const seen = new Set<number>();
  for (const i of order) {
    if (!Number.isInteger(i) || i < 0 || i >= n || seen.has(i)) return false;
    seen.add(i);
  }
  return true;
}

const exactKeys = (o: unknown, keys: string[]): o is Record<string, unknown> =>
  !!o && typeof o === "object" && !Array.isArray(o) && Object.keys(o).sort().join() === [...keys].sort().join();

export type RankingRefusal = "RANKING_MISSING" | "RANKING_SHA_MISMATCH" | "RANKING_TOO_LARGE" | "RANKING_INVALID" | "RANKING_OTHER_TASK_FILE" | "RANKING_OTHER_WEIGHTS";

/**
 * Reads the ranking the attempt job received. `expectSha256` is the scoring job's second output; `pin` is the weights
 * sha256 pinned in peaceai/model/model-v1-proposer.json; `taskFileSha256` the task file this run reads.
 */
export function parseRanking(text: string | null, expectSha256: string | null, pin: { weightsSha256: string }, taskFileSha256: string): { ok: true; ranking: Ranking } | { ok: false; reason: RankingRefusal } {
  if (text === null || text === "") return { ok: false, reason: "RANKING_MISSING" };
  if (Buffer.byteLength(text) > MAX_RANKING_BYTES) return { ok: false, reason: "RANKING_TOO_LARGE" }; // m167-guard:rank-size
  if (typeof expectSha256 !== "string" || !H64.test(expectSha256) || sha256(text) !== expectSha256) return { ok: false, reason: "RANKING_SHA_MISMATCH" }; // m167-guard:rank-sha
  let r: unknown;
  try { r = JSON.parse(text); } catch { return { ok: false, reason: "RANKING_INVALID" }; }
  if (!exactKeys(r, ["schema", "taskFileSha256", "weightsSha256", "modelManifestSha256", "entries"]) || r.schema !== RANKING_SCHEMA) return { ok: false, reason: "RANKING_INVALID" }; // m167-guard:rank-schema
  if (typeof r.modelManifestSha256 !== "string" || !H64.test(r.modelManifestSha256)) return { ok: false, reason: "RANKING_INVALID" }; // m167-guard:rank-manifest
  if (r.taskFileSha256 !== taskFileSha256) return { ok: false, reason: "RANKING_OTHER_TASK_FILE" }; // m167-guard:rank-task-file
  if (!H64.test(pin.weightsSha256) || r.weightsSha256 !== pin.weightsSha256) return { ok: false, reason: "RANKING_OTHER_WEIGHTS" }; // m167-guard:rank-weights
  if (!Array.isArray(r.entries) || r.entries.length > MAX_RANKING_ENTRIES) return { ok: false, reason: "RANKING_INVALID" };
  const keys = new Set<string>();
  for (const e of r.entries as unknown[]) {
    if (!exactKeys(e, ["taskKey", "candidatesSha256", "order", "bindingSha256"])) return { ok: false, reason: "RANKING_INVALID" };
    if (typeof e.taskKey !== "string" || !TASK_KEY.test(e.taskKey) || keys.has(e.taskKey)) return { ok: false, reason: "RANKING_INVALID" }; // m167-guard:rank-entry-key
    keys.add(e.taskKey);
    if (typeof e.candidatesSha256 !== "string" || !H64.test(e.candidatesSha256) || typeof e.bindingSha256 !== "string" || !H64.test(e.bindingSha256)) return { ok: false, reason: "RANKING_INVALID" };
    if (!Array.isArray(e.order) || e.order.length > MAX_CANDIDATES || !isPermutation(e.order, e.order.length)) return { ok: false, reason: "RANKING_INVALID" }; // m167-guard:rank-entry-order
  }
  return { ok: true, ranking: r as unknown as Ranking };
}

/** The ranking's index list for one task's candidate list, or a throw (PROPOSER_FAILED in the loop). */
export function applyRanking(ranking: Ranking, taskKey: string, queue: readonly Candidate[]): Candidate[] {
  const mine = ranking.entries.filter((e) => e.taskKey === taskKey);
  if (mine.length !== 1) throw new Error("ranking: no entry for this task"); // m167-guard:apply-entry
  const e = mine[0]!;
  const candsSha = candidatesSha256(queue);
  if (e.candidatesSha256 !== candsSha) throw new Error("ranking: another candidate list"); // m167-guard:apply-cands
  if (e.bindingSha256 !== bindingSha256(ranking.modelManifestSha256, taskKey, candsSha, e.order)) throw new Error("ranking: binding mismatch"); // m167-guard:apply-binding
  if (!isPermutation(e.order, queue.length)) throw new Error("ranking: not a permutation of this list"); // m167-guard:apply-permutation
  return e.order.map((i) => queue[i]!);
}

export interface ModelProposer {
  name: string;
  readonly modelManifestSha256: string | null;
  prepare(search: CodeRepo, input: { request: string; failing: readonly string[] }): void;
  next: ReturnType<typeof repairProposer>["next"];
}

/**
 * model-v1 for one task. `ranking` is the parsed ranking (null when parseRanking refused: every task then ends
 * PROPOSER_FAILED with no model named in the row). prepare runs repair-v1's search on the request alone (failing: [],
 * because the scoring job runs no tests and so cannot know failing test names; the candidate lists must be equal).
 */
export function modelProposer(task: { taskKey: string }, ranking: Ranking | null): ModelProposer {
  const inner = repairProposer({ name: MODEL_PROPOSER, order: (q) => applyRanking(ranking!, task.taskKey, q) });
  return {
    name: MODEL_PROPOSER,
    modelManifestSha256: ranking ? ranking.modelManifestSha256 : null,
    prepare(search, input) {
      if (!ranking) throw new Error("ranking: none usable"); // m167-guard:prepare-no-ranking
      if (ranking.entries.filter((e) => e.taskKey === task.taskKey).length !== 1) throw new Error("ranking: no entry for this task"); // m167-guard:prepare-entry
      inner.prepare(search, { request: input.request, failing: [] }); // request only, as the scoring job
    },
    next: (input) => inner.next(input),
  };
}

// ---- the pin (peaceai/model/model-v1-proposer.json)

export const MODEL_V1_PIN_SCHEMA = "peaceai-model-v1-proposer:v1";
export const MODEL_V1_PIN = "peaceai/model/model-v1-proposer.json";
export interface ModelV1Pin { schema: typeof MODEL_V1_PIN_SCHEMA; note: string; version: string; runId: string; weightsSha256: string; maxAttempts: number; maxCandidates: number; taskFile: string }

/** The pin, or null when it is not exactly the pinned shape (version = lm-v1-<first 12 hex of the weights sha256>). */
export function modelV1PinProblem(o: unknown): string | null {
  if (!exactKeys(o, ["schema", "note", "version", "runId", "weightsSha256", "maxAttempts", "maxCandidates", "taskFile"])) return "keys";
  if (o.schema !== MODEL_V1_PIN_SCHEMA) return "schema";
  if (typeof o.weightsSha256 !== "string" || !H64.test(o.weightsSha256)) return "weights";
  if (o.version !== `lm-v1-${o.weightsSha256.slice(0, 12)}`) return "version"; // m167-guard:pin-version
  if (typeof o.runId !== "string" || !/^[1-9][0-9]{5,19}$/.test(o.runId)) return "run";
  if (!Number.isInteger(o.maxAttempts) || (o.maxAttempts as number) < 1 || (o.maxAttempts as number) > 20) return "max";
  if (o.maxCandidates !== MAX_CANDIDATES) return "candidates";
  if (o.taskFile !== "peaceai/plan/tasks-public-v1.json") return "task_file"; // m167-guard:pin-public
  return null;
}

/** bin/loop.ts --proposer model-v1: only the pre-registered dev run (the pinned public task file, at the pinned --max).
 *  `file` is resolved against the working directory as the bin does; `root` is the workspace root. */
export function modelV1RunProblem(pin: unknown, file: string, max: number, root: string, cwd: string = process.cwd()): string | null {
  if (modelV1PinProblem(pin)) return "MODEL_V1_PIN_INVALID";
  const p = pin as ModelV1Pin;
  if (resolve(cwd, file) !== resolve(root, p.taskFile)) return "MODEL_V1_DEV_TASK_FILE_ONLY"; // m167-guard:run-task-file
  if (max !== p.maxAttempts) return "MODEL_V1_MAX_NOT_PREREGISTERED"; // m167-guard:run-max
  return null;
}
