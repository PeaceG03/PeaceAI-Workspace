import type { CandidateResult } from "./rank.ts";

/**
 * M12: grading of a learned test (ADD_TEST_CASE) by the Job B harness. The new tests run on the fixed code
 * (the task's base) and on the code before the fix (the fix commit's non-test source change reversed), both
 * as the sandbox user; pass/fail is the captured exit code. Only pass-after AND fail-before counts.
 */
export const GRADING_VERDICTS = ["COUNTS", "REJECTED_PASSES_BOTH", "REJECTED_FAILS_BOTH", "REJECTED_FAILS_AFTER_FIX", "UNGRADABLE", "REJECTED_PASSES_WITH_STUB"] as const;
export type GradingVerdict = (typeof GRADING_VERDICTS)[number];
export const UNGRADABLE_REASONS = ["not-applied", "not-test-only", "fix-invalid", "fix-not-on-main", "fix-not-ancestor", "fix-touches-non-source", "no-source-change", "revert-failed", "stub-not-reached", "real-not-stable"] as const;
export type UngradableReason = (typeof UNGRADABLE_REASONS)[number];

/** Paths a fix may never touch for grading: workflows, hooks, scripts, configs, lockfiles, env and infra files. */
export const FIX_FORBIDDEN = /(^|\/)(\.github|\.githooks|\.husky|scripts?|bin)\/|(^|\/)(package(-lock)?\.json|npm-shrinkwrap\.json|pnpm-(lock|workspace)\.yaml|yarn\.lock|tsconfig[^/]*\.json|jsconfig[^/]*\.json|\.npmrc|\.nvmrc|\.env[^/]*|wrangler\.toml|Dockerfile|Makefile|\.gitignore|\.gitattributes)$|\.(ya?ml|sh|bash|zsh|ps1|toml|ini|cfg|cjs|mjs)$|(^|\/)[^/]*\.config\.[cm]?[jt]s$/i;

export interface FixScope { isSource: (p: string) => boolean; isTest: (p: string) => boolean; isDenied: (p: string) => boolean }
/**
 * M12: checks a learned test's `Fix: <sha>` BEFORE any revert. `git` runs git in the target checkout and
 * returns stdout, or null when the command fails. The sha must be a full 40-hex commit present in the target,
 * reachable from the target's main (origin/main, else main) and from the task base, with a parent. A fix that
 * changes anything FIX_FORBIDDEN (workflows, configs, scripts...) or a denied path is refused. Only its non-test
 * source files are returned for the revert; its test files and docs are never touched.
 */
export function validateFix(fixSha: string, baseSha: string, git: (...args: string[]) => string | null, scope: FixScope): { ok: true; paths: string[] } | { ok: false; reason: UngradableReason } {
  if (!/^[0-9a-f]{40}$/.test(fixSha)) return { ok: false, reason: "fix-invalid" };
  if (git("cat-file", "-t", fixSha)?.trim() !== "commit") return { ok: false, reason: "fix-invalid" };
  const main = ["refs/remotes/origin/main", "refs/heads/main"].find((r) => git("rev-parse", "--verify", "--quiet", `${r}^{commit}`) !== null);
  if (!main || git("merge-base", "--is-ancestor", fixSha, main) === null) return { ok: false, reason: "fix-not-on-main" };
  if (git("merge-base", "--is-ancestor", fixSha, baseSha) === null) return { ok: false, reason: "fix-not-ancestor" };
  const changed = git("diff", "--name-only", "--no-renames", `${fixSha}^`, fixSha);
  if (changed === null) return { ok: false, reason: "fix-invalid" };
  const paths = changed.split("\n").filter(Boolean);
  // Test files the fix changed are never reverted (existing tests are never edited); everything else must be source or docs.
  if (paths.some((p) => FIX_FORBIDDEN.test(p) || (!scope.isTest(p) && scope.isDenied(p)))) return { ok: false, reason: "fix-touches-non-source" };
  const source = paths.filter((p) => scope.isSource(p) && !scope.isTest(p));
  return source.length ? { ok: true, paths: source } : { ok: false, reason: "no-source-change" };
}
export interface TestGrading {
  fixSha: string;
  afterFix: boolean;
  beforeFix: boolean | null;
  verdict: GradingVerdict;
  reason: (typeof UNGRADABLE_REASONS)[number] | null;
  /** M17 (ADD_FUNCTION only): the new tests FAILED with the function's body replaced by a type-default stub. */
  stubFails?: boolean;
  /** M23 (Auditor #129): the functions stubbed for the stub-body before-state (sorted as declared). */
  stubbed?: string[];
}
export function gradingVerdict(afterFix: boolean, beforeFix: boolean, stubFails?: boolean): GradingVerdict {
  if (afterFix && !beforeFix) return stubFails === false ? "REJECTED_PASSES_WITH_STUB" : "COUNTS";
  if (afterFix && beforeFix) return "REJECTED_PASSES_BOTH";
  if (!afterFix && !beforeFix) return "REJECTED_FAILS_BOTH";
  return "REJECTED_FAILS_AFTER_FIX";
}
export function validTestGrading(g: unknown): g is TestGrading {
  if (!g || typeof g !== "object") return false;
  const t = g as Record<string, unknown>;
  const keys = Object.keys(t).filter((k) => k !== "stubbed").sort().join(",");
  if (keys !== "afterFix,beforeFix,fixSha,reason,verdict" && keys !== "afterFix,beforeFix,fixSha,reason,stubFails,verdict") return false;
  if ("stubbed" in t && !(Array.isArray(t.stubbed) && t.stubbed.length > 0 && t.stubbed.length <= 50 && t.stubbed.every((n) => typeof n === "string" && /^[A-Za-z_$][\w$]{0,99}$/.test(n)))) return false;
  if ("stubFails" in t && typeof t.stubFails !== "boolean") return false;
  if (typeof t.fixSha !== "string" || !/^[0-9a-f]{40}$/.test(t.fixSha) || typeof t.afterFix !== "boolean") return false;
  if (t.verdict === "UNGRADABLE") return t.beforeFix === null && (UNGRADABLE_REASONS as readonly unknown[]).includes(t.reason);
  return typeof t.beforeFix === "boolean" && t.reason === null && t.verdict === gradingVerdict(t.afterFix, t.beforeFix, t.stubFails as boolean | undefined);
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
