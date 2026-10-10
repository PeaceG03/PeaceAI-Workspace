// M3 features: deterministic, versioned, computed only from Results records (task.json, ranking.json,
// candidates/*.diff). Never from the core. Edit-kind and keyword names are hashed into buckets so no
// kernel vocabulary is written into this public repository or into feature names.
import { createHash } from "node:crypto";
import { parseDiff } from "../diff.ts";
import type { RankedCandidate, TaskRecord } from "../records.ts";
import { TEST_FILE } from "../scope.ts";

// v2 (M7.1): adds `repaired` (the recorded diff came from the test-and-fix loop).
export const FEATURE_VERSION = "features:v2";
export const EDIT_BUCKETS = 32;
export const KEYWORD_BUCKETS = 16;

const NUMERIC = [
  "bias",
  "log_diff_lines",
  "log_diff_bytes",
  "log_added",
  "log_removed",
  "files_touched",
  "new_files",
  "src_files_touched",
  "has_new_tests",
  "new_test_files",
  "test_cases_added",
  "assertions_added",
  "typecheck",
  "original_suite",
  "new_tests",
  "edit_count",
  "is_smallest",
  "diff_ratio_to_smallest",
  "requires_tests_x_has_tests",
  "repaired",
] as const;

export const FEATURE_NAMES: readonly string[] = [
  ...NUMERIC,
  ...Array.from({ length: EDIT_BUCKETS }, (_, i) => `edit_${i}`),
  ...Array.from({ length: KEYWORD_BUCKETS }, (_, i) => `kw_x_edit_${i}`),
];
export const FEATURE_COUNT = FEATURE_NAMES.length;

export const bucket = (text: string, buckets: number): number =>
  createHash("sha256").update(text).digest().readUInt32BE(0) % buckets;

const STOP = new Set(["the", "and", "with", "that", "will", "for", "add", "src", "from", "into", "this", "helper"]);
export function taskKeywords(task: Pick<TaskRecord, "title" | "body">): string[] {
  const words = `${task.title} ${task.body}`.toLowerCase().match(/[a-z][a-z0-9]{2,}/g) ?? [];
  return [...new Set(words.filter((w) => !STOP.has(w)))].sort().slice(0, 40);
}

export interface CandidateFeatures {
  id: string;
  x: number[];
}

/** Features for every candidate of one task. `diffs` maps candidate id to its diff text (may be missing). */
export function extractFeatures(
  task: Pick<TaskRecord, "title" | "body" | "requiresTests">,
  candidates: readonly RankedCandidate[],
  diffs: ReadonlyMap<string, string>,
): CandidateFeatures[] {
  const keywords = taskKeywords(task);
  const minLines = Math.max(1, Math.min(...candidates.map((c) => c.diffLines), Number.MAX_SAFE_INTEGER));
  return candidates.map((c) => {
    const files = parseDiff(diffs.get(c.id) ?? "");
    const added = files.flatMap((f) => f.addedLines);
    const removed = files.flatMap((f) => f.removedLines);
    const testAdded = files.filter((f) => f.newPath && TEST_FILE.test(f.newPath)).flatMap((f) => f.addedLines);
    const v: Record<string, number> = {
      bias: 1,
      log_diff_lines: Math.log1p(c.diffLines),
      log_diff_bytes: Math.log1p(c.diffBytes),
      log_added: Math.log1p(added.length),
      log_removed: Math.log1p(removed.length),
      files_touched: files.length,
      new_files: files.filter((f) => f.isNew).length,
      src_files_touched: files.filter((f) => f.newPath && !TEST_FILE.test(f.newPath)).length,
      has_new_tests: c.newTestFiles > 0 ? 1 : 0,
      new_test_files: c.newTestFiles,
      test_cases_added: testAdded.filter((l) => /\b(test|it)\s*\(/.test(l)).length,
      assertions_added: testAdded.filter((l) => /\bassert\b|\bexpect\s*\(/.test(l)).length,
      typecheck: c.typecheckPassed ? 1 : 0,
      original_suite: c.originalSuitePassed ? 1 : 0,
      new_tests: c.newTestsPassed ? 1 : 0,
      edit_count: c.transformations.length,
      is_smallest: c.diffLines === minLines ? 1 : 0,
      diff_ratio_to_smallest: c.diffLines / minLines,
      requires_tests_x_has_tests: task.requiresTests && c.newTestFiles > 0 ? 1 : 0,
      repaired: c.repaired === true ? 1 : 0,
    };
    const x = NUMERIC.map((name) => v[name]!);
    const edits = new Array<number>(EDIT_BUCKETS).fill(0);
    for (const t of c.transformations) edits[bucket(`edit:${t}`, EDIT_BUCKETS)]! += 1;
    const kwx = new Array<number>(KEYWORD_BUCKETS).fill(0);
    for (const t of c.transformations) for (const k of keywords) kwx[bucket(`kw:${k}|${t}`, KEYWORD_BUCKETS)]! += 1;
    return { id: c.id, x: [...x, ...edits, ...kwx] };
  });
}
