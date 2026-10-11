import type { CandidateResult } from "./rank.ts";

/**
 * M12: grading of a learned test (ADD_TEST_CASE) by the Job B harness. The new tests run on the fixed code
 * (the task's base) and on the code before the fix (the fix commit's non-test source change reversed), both
 * as the sandbox user; pass/fail is the captured exit code. Only pass-after AND fail-before counts.
 */
export const GRADING_VERDICTS = ["COUNTS", "REJECTED_PASSES_BOTH", "REJECTED_FAILS_BOTH", "REJECTED_FAILS_AFTER_FIX", "UNGRADABLE"] as const;
export type GradingVerdict = (typeof GRADING_VERDICTS)[number];
export const UNGRADABLE_REASONS = ["not-applied", "not-test-only", "fix-not-ancestor", "no-source-change", "revert-failed"] as const;
export interface TestGrading {
  fixSha: string;
  afterFix: boolean;
  beforeFix: boolean | null;
  verdict: GradingVerdict;
  reason: (typeof UNGRADABLE_REASONS)[number] | null;
}
export function gradingVerdict(afterFix: boolean, beforeFix: boolean): GradingVerdict {
  if (afterFix && !beforeFix) return "COUNTS";
  if (afterFix && beforeFix) return "REJECTED_PASSES_BOTH";
  if (!afterFix && !beforeFix) return "REJECTED_FAILS_BOTH";
  return "REJECTED_FAILS_AFTER_FIX";
}
export function validTestGrading(g: unknown): g is TestGrading {
  if (!g || typeof g !== "object") return false;
  const t = g as Record<string, unknown>;
  if (Object.keys(t).sort().join(",") !== "afterFix,beforeFix,fixSha,reason,verdict") return false;
  if (typeof t.fixSha !== "string" || !/^[0-9a-f]{40}$/.test(t.fixSha) || typeof t.afterFix !== "boolean") return false;
  if (t.verdict === "UNGRADABLE") return t.beforeFix === null && (UNGRADABLE_REASONS as readonly unknown[]).includes(t.reason);
  return typeof t.beforeFix === "boolean" && t.reason === null && t.verdict === gradingVerdict(t.afterFix, t.beforeFix);
}

export interface ResultsFile {
  schema: "peaceai-workspace-results:v1";
  taskId: string;
  baseSha: string;
  results: CandidateResult[];
}

export function validateResults(value: unknown): value is ResultsFile {
  if (!value || typeof value !== "object") return false;
  const r = value as Record<string, unknown>;
  if (r.schema !== "peaceai-workspace-results:v1" || typeof r.taskId !== "string" || typeof r.baseSha !== "string") return false;
  if (!/^[0-9a-f]{40}$/.test(r.baseSha) || !Array.isArray(r.results) || r.results.length > 5) return false;
  return r.results.every((item) => {
    const c = item as Record<string, unknown>;
    return (
      !!c &&
      typeof c.id === "string" &&
      /^candidate-[1-5]$/.test(c.id) &&
      Number.isInteger(c.diffBytes) &&
      Number.isInteger(c.diffLines) &&
      Number.isInteger(c.newTestFiles) &&
      ["applied", "typecheckPassed", "originalSuitePassed", "newTestsPassed"].every((key) => typeof c[key] === "boolean") &&
      (c.testGrading === undefined || validTestGrading(c.testGrading))
    );
  });
}
