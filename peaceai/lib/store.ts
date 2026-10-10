import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  buildSummary,
  effectiveVerdict as effectiveFromRows,
  type EffectiveVerdict,
  stableJson,
  taskEntry,
  type RankingRecord,
  type TaskRecord,
  type VerdictRecord,
} from "./records.ts";

// File layout in the private Results repository (append-only except summary.json, which is derived):
//   tasks/<issue>/<runId>/task.json
//   tasks/<issue>/<runId>/ranking.json
//   tasks/<issue>/<runId>/candidates/<candidate>.diff
//   tasks/<issue>/<runId>/verdicts/<commentId>.json
//   index.jsonl   one line per task record and per verdict
//   summary.json  recomputed from the records on every write

const SAFE_SEGMENT = /^[A-Za-z0-9_-]{1,40}$/;

export function taskDir(root: string, issue: number, runId: string): string {
  if (!Number.isInteger(issue) || issue <= 0 || !SAFE_SEGMENT.test(runId)) throw new Error("invalid task key");
  return join(root, "tasks", String(issue), runId);
}

/** Creates a file that must not exist yet (records are never rewritten). */
export function writeNew(path: string, content: string): void {
  if (existsSync(path)) throw new Error(`record already exists: ${path.split("/").slice(-3).join("/")}`);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, { flag: "wx" });
}

export function appendIndex(root: string, entry: Record<string, unknown>): void {
  appendFileSync(join(root, "index.jsonl"), JSON.stringify(Object.fromEntries(Object.entries(entry).sort())) + "\n");
}

const readJson = <T>(path: string): T => JSON.parse(readFileSync(path, "utf8")) as T;
const listDirs = (path: string) => (existsSync(path) ? readdirSync(path, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name) : []);

export interface StoredTask {
  task: TaskRecord;
  ranking: RankingRecord;
  verdicts: VerdictRecord[];
}

export function loadAll(root: string): StoredTask[] {
  const out: StoredTask[] = [];
  for (const issue of listDirs(join(root, "tasks"))) {
    for (const run of listDirs(join(root, "tasks", issue))) {
      const dir = join(root, "tasks", issue, run);
      if (!existsSync(join(dir, "task.json")) || !existsSync(join(dir, "ranking.json"))) continue;
      const vdir = join(dir, "verdicts");
      const verdicts = existsSync(vdir)
        ? readdirSync(vdir).filter((f) => f.endsWith(".json")).sort().map((f) => readJson<VerdictRecord>(join(vdir, f)))
        : [];
      out.push({ task: readJson(join(dir, "task.json")), ranking: readJson(join(dir, "ranking.json")), verdicts });
    }
  }
  return out;
}

/** The most recent attempt (highest run id) for an issue. */
export function latestAttempt(root: string, issue: number): StoredTask | null {
  const attempts = loadAll(root).filter((t) => t.task.issue === issue);
  attempts.sort((a, b) => (BigInt(a.task.runId) < BigInt(b.task.runId) ? -1 : 1));
  return attempts[attempts.length - 1] ?? null;
}

/**
 * The one reader M3 must use: the effective verdict for an issue, from its latest attempt only.
 * Returns null when the issue has no recorded attempt.
 */
export function effectiveVerdict(root: string, issue: number): (EffectiveVerdict & { task: TaskRecord; ranking: RankingRecord }) | null {
  const attempt = latestAttempt(root, issue);
  if (!attempt) return null;
  return { ...effectiveFromRows(attempt.verdicts), task: attempt.task, ranking: attempt.ranking };
}

export function writeSummary(root: string): ReturnType<typeof buildSummary> {
  const summary = buildSummary(loadAll(root).map((t) => taskEntry(t.task, t.ranking, t.verdicts)));
  writeFileSync(join(root, "summary.json"), stableJson(summary));
  return summary;
}
