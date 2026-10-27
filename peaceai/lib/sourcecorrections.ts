// M119 add-only source corrections for Results task records. Results records are written only by the
// workflows and are never edited or deleted; a record that was written with the wrong `source` is corrected by
// ADDING a line to peaceai/source-corrections.jsonl, which the records reader applies (records.ts taskEntry and
// the ranker's toExample). A correction can only lower a record to `builder` (not Peace's own task); nothing in
// this file can make a record `peace`. The file is add-only: the base revision must be a byte prefix of the
// head (checked in CI by peaceai/bin/source-corrections-check.ts --base, like the builder-log).
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const SOURCE_CORRECTION_SCHEMA = "peaceai-source-correction:v1";
export const SOURCE_CORRECTIONS_FILE = "peaceai/source-corrections.jsonl";
const DEFAULT_PATH = fileURLToPath(new URL("../source-corrections.jsonl", import.meta.url));

export interface SourceCorrection {
  schema: typeof SOURCE_CORRECTION_SCHEMA;
  /** The Results record corrected: tasks/<issue>/<runId>/task.json. */
  issue: number;
  runId: string;
  /** What the record says today; only `peace` records are ever corrected. */
  recorded: "peace";
  /** What the reader uses instead; always `builder`. */
  source: "builder";
  /** Why, from the issue body's own provenance. */
  reason: string;
  filedAt: string;
  filedBy: string;
}

const KEYS = ["filedAt", "filedBy", "issue", "reason", "recorded", "runId", "schema", "source"];
export const correctionKey = (issue: number, runId: string): string => `${issue}/${runId}`;

/** Validates every line; any error makes the whole file unusable (callers fail loudly). */
export function parseSourceCorrections(text: string): { corrections: SourceCorrection[]; errors: string[] } {
  const corrections: SourceCorrection[] = [];
  const errors: string[] = [];
  const seen = new Set<string>();
  if (text !== "" && !text.endsWith("\n")) errors.push("file must end with a newline");
  text.split("\n").forEach((line, i) => {
    if (line === "") return;
    const at = `line ${i + 1}`;
    let x: Record<string, unknown>;
    try {
      x = JSON.parse(line);
    } catch {
      errors.push(`${at}: not JSON`);
      return;
    }
    if (!x || typeof x !== "object" || Array.isArray(x)) return void errors.push(`${at}: not an object`);
    const keys = Object.keys(x).sort();
    if (keys.join(",") !== KEYS.join(",")) return void errors.push(`${at}: keys must be exactly ${KEYS.join(", ")}`);
    if (x.schema !== SOURCE_CORRECTION_SCHEMA) errors.push(`${at}: schema`);
    if (!Number.isInteger(x.issue) || (x.issue as number) < 1) errors.push(`${at}: issue`);
    if (typeof x.runId !== "string" || !/^[1-9]\d{0,19}$/.test(x.runId)) errors.push(`${at}: runId`);
    if (x.recorded !== "peace") errors.push(`${at}: recorded must be "peace"`);
    if (x.source !== "builder") errors.push(`${at}: source must be "builder" (a correction never credits Peace)`);
    if (typeof x.reason !== "string" || x.reason.trim().length < 10 || x.reason.length > 600) errors.push(`${at}: reason`);
    if (typeof x.filedAt !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(x.filedAt)) errors.push(`${at}: filedAt`);
    if (typeof x.filedBy !== "string" || x.filedBy.trim() === "") errors.push(`${at}: filedBy`);
    const key = correctionKey(x.issue as number, String(x.runId));
    if (seen.has(key)) errors.push(`${at}: duplicate correction for ${key}`);
    seen.add(key);
    corrections.push(x as unknown as SourceCorrection);
  });
  return { corrections, errors };
}

/** Add-only: the base file must be a byte prefix of the head file. */
export function correctionsAddOnly(base: string, head: string): string[] {
  return head.startsWith(base) ? [] : ["an existing correction was modified or removed (source corrections are add-only)"];
}

let cached: ReadonlyMap<string, SourceCorrection> | null = null;

/** The corrections in force, by issue/runId. Throws on an invalid file, so a bad correction is never half-read. */
export function loadSourceCorrections(path: string = DEFAULT_PATH): ReadonlyMap<string, SourceCorrection> {
  if (path === DEFAULT_PATH && cached) return cached;
  const text = existsSync(path) ? readFileSync(path, "utf8") : "";
  const { corrections, errors } = parseSourceCorrections(text);
  if (errors.length) throw new Error(`${SOURCE_CORRECTIONS_FILE}: ${errors.join("; ")}`);
  const map = new Map(corrections.map((c) => [correctionKey(c.issue, c.runId), c]));
  if (path === DEFAULT_PATH) cached = map;
  return map;
}

/** The source the reader uses: `builder` when a correction exists for this record, else the recorded source. */
export function correctedSource<S extends "peace" | "builder">(
  task: { issue: number; runId: string },
  recorded: S,
  corrections: ReadonlyMap<string, SourceCorrection> = loadSourceCorrections(),
): S | "builder" {
  return corrections.has(correctionKey(task.issue, String(task.runId))) ? "builder" : recorded;
}
