// M146 (step 3 of the general coding-agent roadmap): the loop's own add-only log (peaceai/plan/loop-runs.jsonl) and its
// row. Loop rows live in their own log so the plan-only files (plangrade.ts, planrun.ts, runs.jsonl) stay as #634 merged
// them; the task-file lock is still read from runs.jsonl. No imports. See
// peaceai/spec/loop-v1.md. A loop row has fixed keys and shapes only: a task key, codes and numbers (plus the repo and
// commit for the public set). No test name, path, URL or message text can fit anywhere.

export const LOOP_SCHEMA = "peaceai-plan-loop:v1" as const;
export const LOOP_VERSION = "loop-v1" as const;
/** M151 (loop v2): rows also say which runner and package manager ran and what the unedited copy scored (baseline). */
export const LOOP_SCHEMA_V2 = "peaceai-plan-loop:v2" as const;
export const LOOP_VERSION_V2 = "loop-v2" as const;
export const LOOP_RUNNERS = ["node-test", "vitest", "jest"] as const;
export const LOOP_DEPS = ["none", "npm", "pnpm", "yarn"] as const;
/** The loop's add-only log (repo-relative). */
export const LOOP_LOG = "peaceai/plan/loop-runs.jsonl";
/** Task-level outcome codes (the one `code` of a row). Never message text. */
export const LOOP_CODES = [
  // stopped: pass, or the attempt limit
  "PASS", "ATTEMPT_LIMIT",
  // stopped: the proposer refused (no edit at all, or none left to revise with)
  "NO_EDIT", "NO_MORE_EDITS",
  // refused before any candidate code ran (task, lock, license, training: the same rules as plan-only)
  "TASK_INVALID", "LICENSE_NOT_ALLOWED", "TRAINING_OVERLAP", "FETCH_FAILED", "LICENSE_CHANGED", "COMMIT_MISMATCH", "PLAN_FAILED",
  "SELF_TARGET", "CAND_UID_REQUIRED", "CAND_UID_BAD_NAME", "CAND_UID_MISSING", "CAND_UID_NOT_SEPARATE", "CAND_UID_UNREACHABLE", "CAND_UID_HAS_SUDO",
  "TEST_RUNNER_UNSUPPORTED", "DEPS_UNSUPPORTED", "NO_TESTS", "BASELINE_PASSES",
  // stopped mid-loop by a safety guard
  "EDIT_OUTSIDE_COPY", "TEAM_TEST_EDIT", "ISOLATION_UNAVAILABLE",
  // v2 only: the repo's own runner and dependencies (M151)
  "TEST_NEEDS_SERVICE", "DEPS_NO_LOCKFILE", "DEPS_PM_UNSUPPORTED", "DEPS_NONREGISTRY", "DEPS_PM_CONFIG", "DEPS_INSTALL_FAILED", "DEPS_TIMEOUT", "DEPS_TOO_LARGE",
] as const;
const V2_ONLY_CODES: readonly string[] = ["TEST_NEEDS_SERVICE", "DEPS_NO_LOCKFILE", "DEPS_PM_UNSUPPORTED", "DEPS_NONREGISTRY", "DEPS_PM_CONFIG", "DEPS_INSTALL_FAILED", "DEPS_TIMEOUT", "DEPS_TOO_LARGE", "RELATED_FAIL"];
export type LoopCode = (typeof LOOP_CODES)[number];
/** Per-attempt failure codes (filtered: what kind of failure, never its text). */
export const ATTEMPT_CODES = ["TEST_FAIL", "TIMEOUT", "LEFTOVERS", "TAMPERED", "NO_TESTS_RAN", "RELATED_FAIL"] as const;
export type AttemptCode = (typeof ATTEMPT_CODES)[number];

export interface LoopTests {
  /** Team tests the task is graded by (named test cases in the reference change's test files). */
  total: number;
  /** Of those, passing after PeaceAI's last edit. */
  passedByPeaceAI: number;
  /** The rest: the team has to fill these (by teaching a skill), credited to the team. */
  filledByTeam: number;
}
/** v2: the team's tests on the unedited copy (they must fail there for the task to mean anything). */
export interface LoopBaseline { total: number; passing: number; failing: number }
export interface LoopRow {
  schema: typeof LOOP_SCHEMA | typeof LOOP_SCHEMA_V2;
  at: string;
  set: "public" | "hidden";
  taskFileSha256: string;
  taskKey: string;
  repo?: string;
  commit?: string;
  workspace: string;
  loop: typeof LOOP_VERSION | typeof LOOP_VERSION_V2;
  loopSha256: string;
  proposer: string;
  lm: "not-loadable" | "loaded";
  code: LoopCode;
  maxAttempts: number;
  attempts: number;
  result: "pass" | "fail" | "refused";
  /** Per attempt, its failure codes (sorted, unique; [] = that attempt passed). */
  attemptCodes: AttemptCode[][];
  /** null when no test ran. */
  tests: LoopTests | null;
  /** v2 only: the runner picked for the team's tests (null: refused before one was picked). */
  runner?: (typeof LOOP_RUNNERS)[number] | null;
  /** v2 only: how dependencies were installed ("none": nothing to install; null: not reached or refused). */
  deps?: (typeof LOOP_DEPS)[number] | null;
  /** v2 only: the baseline run on the unedited copy (null: it did not run). */
  baseline?: LoopBaseline | null;
}

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const H64 = /^[0-9a-f]{64}$/;
const H40 = /^[0-9a-f]{40}$/;
const KEYS = ["schema", "at", "set", "taskFileSha256", "taskKey", "repo", "commit", "workspace", "loop", "loopSha256", "proposer", "lm", "code", "maxAttempts", "attempts", "result", "attemptCodes", "tests"];
const KEYS_V2 = [...KEYS, "runner", "deps", "baseline"];
const nat = (v: unknown, max = 1_000_000): boolean => Number.isInteger(v) && (v as number) >= 0 && (v as number) <= max;

/** Validates one loop row (null = fine). */
export function loopRowProblem(o: unknown): string | null {
  if (!o || typeof o !== "object" || Array.isArray(o)) return "not_object";
  const r = o as Record<string, any>;
  const v2 = r.schema === LOOP_SCHEMA_V2;
  if (r.schema !== LOOP_SCHEMA && !v2) return "schema";
  if (Object.keys(r).some((k) => !(v2 ? KEYS_V2 : KEYS).includes(k))) return "loop_keys";
  if (v2 && !KEYS_V2.every((k) => k === "repo" || k === "commit" || k in r)) return "loop_keys";
  if (typeof r.at !== "string" || !ISO.test(r.at)) return "at";
  if (r.set !== "public" && r.set !== "hidden") return "set";
  if (typeof r.taskFileSha256 !== "string" || !H64.test(r.taskFileSha256)) return "file_sha";
  if (typeof r.taskKey !== "string" || !/^[0-9a-f]{16}$/.test(r.taskKey)) return "task_key";
  if (r.set === "hidden" && ("repo" in r || "commit" in r)) return "hidden_names_repo";
  if (r.set === "public" && (typeof r.repo !== "string" || !/^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/.test(r.repo) || typeof r.commit !== "string" || !H40.test(r.commit))) return "public_repo";
  if (typeof r.workspace !== "string" || !H40.test(r.workspace)) return "workspace";
  if (r.loop !== (v2 ? LOOP_VERSION_V2 : LOOP_VERSION)) return "loop";
  if (typeof r.loopSha256 !== "string" || !H64.test(r.loopSha256)) return "loop_sha";
  if (typeof r.proposer !== "string" || !/^[a-z0-9-]{1,40}$/.test(r.proposer)) return "proposer";
  if (r.lm !== "not-loadable" && r.lm !== "loaded") return "lm";
  if (!(LOOP_CODES as readonly string[]).includes(r.code) || (!v2 && V2_ONLY_CODES.includes(r.code))) return "code";
  if (!nat(r.maxAttempts, 20) || r.maxAttempts < 1) return "max_attempts";
  if (!nat(r.attempts, 20) || r.attempts > r.maxAttempts) return "attempts";
  const result = r.code === "PASS" ? "pass" : r.code === "ATTEMPT_LIMIT" ? "fail" : "refused";
  if (r.result !== result) return "result";
  if (r.code === "ATTEMPT_LIMIT" && r.attempts !== r.maxAttempts) return "limit_attempts";
  if (!Array.isArray(r.attemptCodes) || r.attemptCodes.length !== r.attempts) return "attempt_codes";
  for (const [i, a] of (r.attemptCodes as unknown[]).entries()) {
    if (!Array.isArray(a) || !a.every((c) => (ATTEMPT_CODES as readonly string[]).includes(c as string) && (v2 || !V2_ONLY_CODES.includes(c as string))) || new Set(a).size !== a.length || [...a].sort().join() !== a.join()) return "attempt_codes";
    if ((a.length === 0) !== (r.code === "PASS" && i === r.attempts - 1)) return "attempt_codes_pass";
  }
  if (r.tests !== null) {
    const t = r.tests as Record<string, unknown>;
    if (!t || typeof t !== "object" || Object.keys(t).sort().join() !== "filledByTeam,passedByPeaceAI,total") return "tests_keys";
    if (!nat(t.total) || !nat(t.passedByPeaceAI) || !nat(t.filledByTeam) || (t.passedByPeaceAI as number) + (t.filledByTeam as number) !== t.total) return "tests_values";
  }
  if (r.code === "PASS" && (r.tests === null || r.tests.filledByTeam !== 0 || r.tests.total === 0)) return "pass_tests";
  if (r.attempts > 0 && r.tests === null) return "tests_presence";
  if (v2) {
    // a hidden row is a taskKey plus scores: which runner / package manager and the exact baseline counts could
    // together identify the repo, so they are never written for the hidden set
    if (r.set === "hidden" && (r.runner !== null || r.deps !== null || r.baseline !== null)) return "hidden_detail";
    if (r.runner !== null && !(LOOP_RUNNERS as readonly string[]).includes(r.runner)) return "runner";
    if (r.deps !== null && !(LOOP_DEPS as readonly string[]).includes(r.deps)) return "deps";
    if (r.baseline !== null) {
      const b = r.baseline as Record<string, unknown>;
      if (!b || typeof b !== "object" || Object.keys(b).sort().join() !== "failing,passing,total") return "baseline_keys";
      if (!nat(b.total) || !nat(b.passing) || !nat(b.failing) || (b.passing as number) + (b.failing as number) !== b.total) return "baseline_values";
      if (r.runner === null || r.deps === null) return "baseline_without_runner";
    }
    if (r.set === "public" && r.attempts > 0 && r.baseline === null) return "baseline_presence";
    if (r.deps !== null && r.runner === null) return "deps_without_runner";
  }
  return null;
}

/** Parses loop-log text; returns rows or the first problem (as a code with its 1-based line). */
export function parseLoopLog(text: string): { rows: LoopRow[] } | { problem: string; line: number } {
  const rows: LoopRow[] = [];
  const lines = text.split("\n");
  if (text.length && !text.endsWith("\n")) return { problem: "no_final_newline", line: lines.length };
  for (let i = 0; i < lines.length - 1; i++) {
    let o: unknown;
    try { o = JSON.parse(lines[i]!); } catch { return { problem: "json", line: i + 1 }; }
    const p = loopRowProblem(o);
    if (p) return { problem: p, line: i + 1 };
    rows.push(o as LoopRow);
  }
  return { rows };
}

/** Add-only: the older loop-log text must be a byte prefix of the newer one (and both must parse). */
export function loopAddOnlyProblem(older: string, newer: string): string | null {
  if (!newer.startsWith(older)) return "rewritten";
  const p = parseLoopLog(newer);
  return "problem" in p ? `row:${p.problem}` : null;
}
