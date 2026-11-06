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
/** M162: v3 rows are v2 rows that also say which planner made the loop's plan (picked by plandefault.selectPlanner)
 *  and its plannerSha256. The loop itself is still loop-v2. */
export const LOOP_SCHEMA_V3 = "peaceai-plan-loop:v3" as const;
/** M166: v4 rows are v3 rows (planner keys as today) plus `modelManifestSha256`: the sha256 of the model manifest
 *  (spec/edit-proposer-model-v1.md: one "<sha256>  <file>" line per LM file) whose ranking a model-backed proposer
 *  used, or null for a proposer that uses no model. v1 / v2 / v3 rows keep validating as before (the log is add-only). */
export const LOOP_SCHEMA_V4 = "peaceai-plan-loop:v4" as const;
/** Proposers that are backed by a model: their rows must be v4 and, once an attempt ran, name the model manifest. */
export const LOOP_MODEL_PROPOSERS = ["model-v1"] as const;
/** The planner names a v3 row can carry (plandefault.ts PLANNERS; kept here as data, since this module has no imports). */
export const LOOP_PLANNER_NAMES = ["plan-only-v1", "plan-only-v2", "plan-only-v3", "plan-only-v4"] as const;
export const LOOP_RUNNERS = ["node-test", "vitest", "jest", "mocha"] as const; // M172: mocha
export const LOOP_DEPS = ["none", "npm", "pnpm", "yarn"] as const;
/** M169: v4 public rows only, and only with code DEPS_INSTALL_FAILED: which install step failed, as a fixed code
 *  (never package-manager output). Optional: rows written before M169 have none. Same list as loopdeps.ts DEPS_FAILS. */
export const LOOP_DEPS_FAILS = ["CAND_NO_ACCESS", "CHOWN_TO_CAND", "KILL", "CHOWN_BACK", "PM_EXIT", "NO_MODULES"] as const;
/** M171: v4 public rows only, and only with code ISOLATION_UNAVAILABLE: which isolation check failed, as a fixed code.
 *  NO_NAMESPACES / MOUNT_FAILED: the runner wrapper exited 97 / 98; WORK_DIR: the private work dir could not be made
 *  (or is open to other users); CAND_NO_ACCESS: the candidate uid cannot reach the copy or its runner; PRIVATE_LINK: a
 *  symlink in the copy resolves into a private root (the runner's home, RUNNER_TEMP, the workspace checkout);
 *  PRIVATE_CONFIG: the copy's .git/config names a credential. Optional: rows written before M171 have none. */
export const LOOP_ISOLATION_FAILS = ["NO_NAMESPACES", "MOUNT_FAILED", "WORK_DIR", "CAND_NO_ACCESS", "PRIVATE_LINK", "PRIVATE_CONFIG"] as const;
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
  "EDIT_OUTSIDE_COPY", "TEAM_TEST_EDIT", "SELF_PROTECTED", "ISOLATION_UNAVAILABLE",
  // v2 only: the repo's own runner and dependencies (M151)
  "TEST_NEEDS_SERVICE", "DEPS_NO_LOCKFILE", "DEPS_PM_UNSUPPORTED", "DEPS_NONREGISTRY", "DEPS_PM_CONFIG", "DEPS_INSTALL_FAILED", "DEPS_TIMEOUT", "DEPS_TOO_LARGE",
  // v2 only: the proposer's search (prepare) threw (M152); the error is dropped, only this code is kept
  "PROPOSER_FAILED",
  // v2 only (M175): a candidate edit was outside the pinned edit-scope policy (editScopeProblem), refused before any run
  "EDIT_SCOPE",
  // v2 only (M199): an edit scope wider than the M175 bound on a runner whose in-process verdict that bound protects
  // (vitest / jest, M200 node:test, M201 mocha: terminal), refused before any run. Under VERDICT_MODE oop-v1 the
  // gate is skipped because verdicts come from verifier-v1 (M202), not the in-process runner.
  "INPROC_VERDICT_TERMINAL", "INPROC_VERDICT_UNPROBED",
  // v2 only (M202): opt-in VERDICT_MODE oop-v1 could not derive data-only cases, or the verifier refused the protocol
  "VERDICT_OOP_CASES", "VERDICT_OOP_REFUSED",
  // v2 only (M203, experimental repair-retry-v1): asked for outside VERDICT_MODE oop-v1 (refused before anything ran);
  // a pass without this attempt's own verifier-v1 verdict, with another run's verdict, or with evidence mixing runs
  "RETRY_INPROC_REFUSED", "RETRY_NO_VERDICT", "RETRY_VERDICT_FOREIGN", "RETRY_EVIDENCE_COMBINED",
  // v4 only (M175): the load diagnostics compile (load-repair mode) exceeded its file / byte / wall-time bound; refused
  // fail-closed before any edit (attempts 0), only the code is kept (never which bound)
  "LOAD_DIAG_LIMIT",
  // v4 only (M173): the baseline ran but proved nothing, so no edit is scored against it: no test executed, the runner
  // shim had no usable report (its 1/0/1 counts are made up), a suite failed to load or run, or the only failure is the
  // runner's exit status (no failed test)
  "NO_TESTS_RAN", "BASELINE_NO_REPORT", "BASELINE_SUITE_LOAD", "BASELINE_EXIT_ONLY",
] as const;
/** M173: the task codes of a baseline that ran but proved nothing (attempts 0; a public row keeps its baseline). */
export const BASELINE_UNRUN_CODES = ["NO_TESTS_RAN", "BASELINE_NO_REPORT", "BASELINE_SUITE_LOAD", "BASELINE_EXIT_ONLY"] as const;
const V2_ONLY_CODES: readonly string[] = ["TEST_NEEDS_SERVICE", "DEPS_NO_LOCKFILE", "DEPS_PM_UNSUPPORTED", "DEPS_NONREGISTRY", "DEPS_PM_CONFIG", "DEPS_INSTALL_FAILED", "DEPS_TIMEOUT", "DEPS_TOO_LARGE", "RELATED_FAIL", "PROPOSER_FAILED", "EDIT_SCOPE", "LOAD_DIAG_LIMIT", "INPROC_VERDICT_TERMINAL", "INPROC_VERDICT_UNPROBED", "VERDICT_OOP_CASES", "VERDICT_OOP_REFUSED", "RETRY_INPROC_REFUSED", "RETRY_NO_VERDICT", "RETRY_VERDICT_FOREIGN", "RETRY_EVIDENCE_COMBINED"];
export type LoopCode = (typeof LOOP_CODES)[number];
/** Per-attempt failure codes (filtered: what kind of failure, never its text). */
export const ATTEMPT_CODES = ["TEST_FAIL", "TIMEOUT", "LEFTOVERS", "TAMPERED", "NO_TESTS_RAN", "RELATED_FAIL", "NO_REPORT", "SUITE_LOAD", "EXIT_ONLY"] as const;
/** M173 (v4 only): an attempt whose failure the runner shim made up (loopdeps.ts SHIM_EXITS), always with TEST_FAIL and
 *  at most one of them, so a row tells it apart from a real failing test. */
export const SHIM_SYNTH_CODES = ["NO_REPORT", "SUITE_LOAD", "EXIT_ONLY"] as const;
/** M174: v4 rows only (optional): the baseline suite did not load and the task went on in load-repair mode (the loop's
 *  load diagnostics named a missing export). Such a baseline ran no team test, so the row did not reach them. */
export const LOOP_BASELINE_LOADS = ["MISSING_EXPORT"] as const;
/** M175: the edit-scope class a PASS row ran under (optional, v4). The only scopes the pinned edit-scope policy
 *  (loop.ts EDIT_SCOPE_POLICY) admits today, so a future wider-scope PASS records a class not in this set and stands out. */
export const EDIT_SCOPE_CLASSES = ["export-keyword", "in-body"] as const;
export type EditScopeClass = (typeof EDIT_SCOPE_CLASSES)[number];
/** M212: non-inproc verdict modes that a loop row may tag. Default inproc is represented by omitting the key
 *  (backward compatible with every row written before M212). Explicit "inproc" on the field is refused. */
export const LOOP_VERDICT_MODES_TAGGED = ["oop-v1"] as const;
export type LoopVerdictModeTagged = (typeof LOOP_VERDICT_MODES_TAGGED)[number];
/** M174: the task codes a load-repair row can end with (after the baseline: the proposer, an attempt, or a crash). */
export const LOAD_REPAIR_CODES = ["PASS", "ATTEMPT_LIMIT", "NO_EDIT", "NO_MORE_EDITS", "PROPOSER_FAILED", "EDIT_OUTSIDE_COPY", "TEAM_TEST_EDIT", "ISOLATION_UNAVAILABLE", "FETCH_FAILED"] as const;
/** M173: a row whose task reached the team's tests: a baseline ran with at least one executed test and a real report. */
export function reachedTests(row: Pick<LoopRow, "baseline" | "code" | "baselineLoad">): boolean {
  if (row.baselineLoad !== undefined) return false; // m174-guard:row-reached-load
  return row.baseline != null && !(BASELINE_UNRUN_CODES as readonly string[]).includes(row.code); // m173-loop-guard:row-reached
}
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
  schema: typeof LOOP_SCHEMA | typeof LOOP_SCHEMA_V2 | typeof LOOP_SCHEMA_V3 | typeof LOOP_SCHEMA_V4;
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
  /** v3 only: the planner that made the loop's plan, and its digest. */
  planner?: (typeof LOOP_PLANNER_NAMES)[number];
  plannerSha256?: string;
  /** v4 only: the model manifest sha256 behind a model-backed proposer's ranking (null: no model, or none was usable). */
  modelManifestSha256?: string | null;
  /** Absent on a model-backed proposer's row (M167: the attempt job never loads the model; the manifest names it). */
  lm?: "not-loadable" | "loaded";
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
  /** M169, v4 public DEPS_INSTALL_FAILED rows only (optional): the failed install step, a fixed code. */
  depsFail?: (typeof LOOP_DEPS_FAILS)[number];
  /** M171, v4 public ISOLATION_UNAVAILABLE rows only (optional): the failed isolation check, a fixed code. */
  isolationFail?: (typeof LOOP_ISOLATION_FAILS)[number];
  /** M174, v4 rows only (optional): the baseline suite did not load; load-repair mode (LOOP_BASELINE_LOADS). */
  baselineLoad?: (typeof LOOP_BASELINE_LOADS)[number];
  /** M175, v4 edit-mode PASS rows only (optional): the edit-scope class the passing edit ran under (EDIT_SCOPE_CLASSES). */
  editScope?: EditScopeClass;
  /** M203 (optional): the row came from the experimental, opt-in repair-retry-v1 (never the default, never credit). */
  repairRetry?: "repair-retry-v1";
  /** M212 (optional, v4): non-inproc verdict mode used for this row. Omitted for the default inproc path so existing
   *  digests/pins and pre-M212 rows stay valid. Present only when the loop ran under a tagged mode (today: oop-v1). */
  verdictMode?: LoopVerdictModeTagged;
}

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const H64 = /^[0-9a-f]{64}$/;
const H40 = /^[0-9a-f]{40}$/;
const KEYS = ["schema", "at", "set", "taskFileSha256", "taskKey", "repo", "commit", "workspace", "loop", "loopSha256", "proposer", "lm", "code", "maxAttempts", "attempts", "result", "attemptCodes", "tests"];
const KEYS_V2 = [...KEYS, "runner", "deps", "baseline"];
const KEYS_V3 = [...KEYS_V2, "planner", "plannerSha256"];
const KEYS_V4 = [...KEYS_V3, "modelManifestSha256"];
const OPTIONAL_V4 = ["depsFail", "isolationFail", "baselineLoad", "editScope", "repairRetry", "verdictMode"]; // M169 / M171 / M174 / M203 / M212: optional, so rows written before them still validate
const nat = (v: unknown, max = 1_000_000): boolean => Number.isInteger(v) && (v as number) >= 0 && (v as number) <= max;

/** Validates one loop row (null = fine). */
export function loopRowProblem(o: unknown): string | null {
  if (!o || typeof o !== "object" || Array.isArray(o)) return "not_object";
  const r = o as Record<string, any>;
  const v4 = r.schema === LOOP_SCHEMA_V4;
  const v3 = r.schema === LOOP_SCHEMA_V3 || v4;
  const v2 = r.schema === LOOP_SCHEMA_V2 || v3;
  if (r.schema !== LOOP_SCHEMA && !v2) return "schema";
  const keys = v4 ? KEYS_V4 : v3 ? KEYS_V3 : v2 ? KEYS_V2 : KEYS;
  let optional: string[] = [];
  if (v4) optional = OPTIONAL_V4; // m169-guard:row-depsfail-v4
  if (Object.keys(r).some((k) => !keys.includes(k) && !optional.includes(k))) return "loop_keys";
  const model = (LOOP_MODEL_PROPOSERS as readonly string[]).includes(r.proposer);
  if (v2 && !keys.every((k) => k === "repo" || k === "commit" || (k === "lm" && model) || k in r)) return "loop_keys";
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
  if (v3 && !(LOOP_PLANNER_NAMES as readonly string[]).includes(r.planner)) return "planner"; // m162-guard:row-planner
  if (v3 && (typeof r.plannerSha256 !== "string" || !H64.test(r.plannerSha256))) return "planner_sha"; // m162-guard:row-planner-sha
  if (model && !v4) return "model_needs_v4"; // m166-guard:row-model-v4
  if (v4 && r.modelManifestSha256 !== null && (typeof r.modelManifestSha256 !== "string" || !H64.test(r.modelManifestSha256))) return "model_sha"; // m166-guard:row-model-sha
  if (v4 && !model && r.modelManifestSha256 !== null) return "model_sha_unexpected"; // m166-guard:row-model-unexpected
  if (v4 && model && r.modelManifestSha256 === null && r.attempts !== 0) return "model_sha_missing"; // m166-guard:row-model-missing
  if (model && "lm" in r) return "lm"; // m167-guard:row-model-no-lm
  if (!model && r.lm !== "not-loadable" && r.lm !== "loaded") return "lm";
  if (!(LOOP_CODES as readonly string[]).includes(r.code) || (!v2 && V2_ONLY_CODES.includes(r.code))) return "code";
  const unrun = (BASELINE_UNRUN_CODES as readonly string[]).includes(r.code);
  if (unrun && !v4) return "code"; // m173-loop-guard:row-unrun-v4
  if (!nat(r.maxAttempts, 20) || r.maxAttempts < 1) return "max_attempts";
  if (!nat(r.attempts, 20) || r.attempts > r.maxAttempts) return "attempts";
  const result = r.code === "PASS" ? "pass" : r.code === "ATTEMPT_LIMIT" ? "fail" : "refused";
  if (r.result !== result) return "result";
  if (r.code === "ATTEMPT_LIMIT" && r.attempts !== r.maxAttempts) return "limit_attempts";
  if (!Array.isArray(r.attemptCodes) || r.attemptCodes.length !== r.attempts) return "attempt_codes";
  for (const [i, a] of (r.attemptCodes as unknown[]).entries()) {
    if (!Array.isArray(a) || !a.every((c) => (ATTEMPT_CODES as readonly string[]).includes(c as string) && (v2 || !V2_ONLY_CODES.includes(c as string))) || new Set(a).size !== a.length || [...a].sort().join() !== a.join()) return "attempt_codes";
    const synth = a.filter((c) => (SHIM_SYNTH_CODES as readonly string[]).includes(c as string));
    if (synth.length && !v4) return "attempt_synth"; // m173-loop-guard:row-synth-v4
    if (synth.length > 1 || (synth.length && !a.includes("TEST_FAIL"))) return "attempt_synth"; // m173-loop-guard:row-synth-shape
    if ((a.length === 0) !== (r.code === "PASS" && i === r.attempts - 1)) return "attempt_codes_pass";
  }
  if (r.tests !== null) {
    const t = r.tests as Record<string, unknown>;
    if (!t || typeof t !== "object" || Object.keys(t).sort().join() !== "filledByTeam,passedByPeaceAI,total") return "tests_keys";
    if (!nat(t.total) || !nat(t.passedByPeaceAI) || !nat(t.filledByTeam) || (t.passedByPeaceAI as number) + (t.filledByTeam as number) !== t.total) return "tests_values";
  }
  if (r.code === "PASS" && (r.tests === null || r.tests.filledByTeam !== 0 || r.tests.total === 0)) return "pass_tests";
  if (r.attempts > 0 && r.tests === null) return "tests_presence";
  if (unrun && r.attempts !== 0) return "baseline_unrun_attempts"; // m173-loop-guard:row-unrun-attempts
  if (r.code === "LOAD_DIAG_LIMIT" && !v4) return "code"; // m175-guard:row-limit-v4
  if (r.code === "LOAD_DIAG_LIMIT" && r.attempts !== 0) return "load_limit_attempts"; // m175-guard:row-limit-attempts
  if (r.code === "LOAD_DIAG_LIMIT" && r.set === "public" && r.baseline === null) return "baseline_presence"; // m175-guard:row-limit-baseline
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
    if (r.set === "public" && unrun && r.baseline === null) return "baseline_presence"; // m173-loop-guard:row-unrun-baseline
    if (r.code === "BASELINE_NO_REPORT" && r.baseline !== null && (r.baseline.total !== 1 || r.baseline.passing !== 0)) return "baseline_no_report"; // m173-loop-guard:row-no-report-shape
    if (r.deps !== null && r.runner === null) return "deps_without_runner";
  }
  if ("depsFail" in r) {
    if (!(LOOP_DEPS_FAILS as readonly string[]).includes(r.depsFail)) return "deps_fail"; // m169-guard:row-depsfail-code
    if (r.code !== "DEPS_INSTALL_FAILED") return "deps_fail_code"; // m169-guard:row-depsfail-only
    if (r.set !== "public") return "hidden_detail"; // m169-guard:row-depsfail-public
  }
  if ("isolationFail" in r) {
    if (!(LOOP_ISOLATION_FAILS as readonly string[]).includes(r.isolationFail)) return "isolation_fail"; // m171-guard:row-isofail-code
    if (r.code !== "ISOLATION_UNAVAILABLE") return "isolation_fail_code"; // m171-guard:row-isofail-only
    if (r.set !== "public") return "hidden_detail"; // m171-guard:row-isofail-public
  }
  if ("baselineLoad" in r) {
    if (!(LOOP_BASELINE_LOADS as readonly string[]).includes(r.baselineLoad)) return "baseline_load"; // m174-guard:row-load-value
    if (!(LOAD_REPAIR_CODES as readonly string[]).includes(r.code)) return "baseline_load_code"; // m174-guard:row-load-code
    if (r.set === "public" && r.baseline === null) return "baseline_presence"; // m174-guard:row-load-baseline
  }
  if ("repairRetry" in r && r.repairRetry !== "repair-retry-v1") return "repair_retry"; // M203
  if ("verdictMode" in r) {
    // only tagged non-inproc modes (today: oop-v1); explicit "inproc", unknown strings, and wrong types are refused.
    // Default inproc is the absent key (backward compatible).
    if (!(LOOP_VERDICT_MODES_TAGGED as readonly string[]).includes(r.verdictMode)) return "verdict_mode"; // m212-guard:row-tag-value
  }
  if ("editScope" in r) {
    if (!(EDIT_SCOPE_CLASSES as readonly string[]).includes(r.editScope)) return "edit_scope"; // m175-guard:row-scope-value
    if (r.code !== "PASS") return "edit_scope_code"; // m175-guard:row-scope-pass
    if ("baselineLoad" in r) return "edit_scope_mode"; // m175-guard:row-scope-edit-mode (a load-repair PASS never records it)
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

/** M212: effective verdict mode of a row. Absent key means the default inproc; a tagged value is returned as-is.
 *  Never invents oop-v1. For-credit analysis must refuse any row whose effective mode is not inproc (and must not
 *  silently treat a tagged oop-v1 row as inproc). This helper does not enable for-credit. */
export function rowVerdictMode(row: Pick<LoopRow, "verdictMode">): "inproc" | LoopVerdictModeTagged {
  return row.verdictMode ?? "inproc"; // m212-guard:row-effective
}
