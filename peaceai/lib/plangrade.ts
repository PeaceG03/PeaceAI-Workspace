// PLAN-ONLY mode v1: grading a plan against the task's reference change, and the add-only public run log
// (peaceai/plan/runs.jsonl). See peaceai/spec/plan-only-v1.md.
//
// Score, per task:
//   stepShare      = required reference steps the plan matched / required steps  (did he plan the right work)
//   canDoAccuracy  = can-do claims that were verified / can-do claims             (null when he claimed none)
//   ownShare       = required steps he matched AND could do (verified) / required steps
//   teamShare      = 1 - ownShare: the steps the team has to fill by teaching skills, credited to the team
// A plan step matches a reference step when the action class agrees (source: edit/add-source; test: edit/add-test;
// run-tests) and the file is the same (run-tests matches by presence). A can-do claim is verified by re-running the
// named approved rule on that file (the rule must still be approved and still produce an edit of that file) and by
// the step matching a reference step; run-tests is verified only for a targets.json repo.
import { existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { applyRule, specHash, type RuleSpec, type SourceFile } from "./learned.ts";
import { loadTargets } from "./target.ts";
import { LOOP_SCHEMA, loopRowProblem } from "./looprow.ts";
import { isTestPath, sha256, type Plan, type PlanStep, type PlanTask, type RefStep, type StepAction } from "./plan.ts";

export const RUN_SCHEMA = "peaceai-plan-run:v1" as const;
export const LOCK_SCHEMA = "peaceai-plan-lock:v1" as const;
export const RUN_LOG = "peaceai/plan/runs.jsonl";
/** The only codes a run row may carry. Never message text. */
export const RUN_CODES = ["OK", "TASK_FILE_UNLOCKED", "TASK_FILE_INVALID", "TASK_INVALID", "LICENSE_NOT_ALLOWED", "TRAINING_OVERLAP", "FETCH_FAILED", "LICENSE_CHANGED", "COMMIT_MISMATCH", "TARGET_CHANGED", "PLAN_FAILED", "TRAINING_LIST_UNREADABLE"] as const;
export type RunCode = (typeof RUN_CODES)[number];

const cls = (a: StepAction): "source" | "test" | "run" => (a === "run-tests" ? "run" : a.endsWith("-test") ? "test" : "source");

export interface Grade {
  required: number;
  matched: number;
  stepShare: number;
  fileRecall: number;
  filePrecision: number;
  testRecall: number;
  canDoClaimed: number;
  canDoVerified: number;
  canDoAccuracy: number | null;
  ownShare: number;
  teamShare: number;
  missing: number;
}

const r3 = (x: number): number => Math.round(x * 1000) / 1000;

export function stepMatches(p: PlanStep, r: RefStep): boolean {
  if (cls(p.action) !== cls(r.action)) return false;
  return r.action === "run-tests" ? true : p.file !== null && p.file === r.file;
}

/** Re-checks one can-do claim. `rules` are the approved specs at grading time. */
export function verifyCanDo(step: PlanStep, task: Pick<PlanTask, "repo">, rules: readonly RuleSpec[], files: readonly SourceFile[]): boolean {
  if (step.status !== "can-do" || !step.rule) return false;
  if (step.action === "run-tests") return step.rule === "pipeline:job-b-tests" && Object.prototype.hasOwnProperty.call(loadTargets().targets, task.repo);
  const spec = rules.find((s) => `${s.id}@${specHash(s)}` === step.rule);
  if (!spec || !step.objective || !step.file) return false;
  try {
    const edit = applyRule(spec, step.objective, files, isTestPath, task.repo);
    return !!edit && (edit.path === step.file || (edit.extra ?? []).some((x) => x.path === step.file));
  } catch { return false; }
}

export function gradePlan(plan: Plan, task: PlanTask, rules: readonly RuleSpec[], files: readonly SourceFile[]): Grade {
  const ref = task.reference.steps;
  const used = new Set<number>();
  let matched = 0;
  let own = 0;
  let claimed = 0;
  let verified = 0;
  for (const p of plan.steps) {
    const ok = p.status === "can-do" && verifyCanDo(p, task, rules, files);
    const i = ref.findIndex((r, j) => !used.has(j) && stepMatches(p, r));
    if (p.status === "can-do") claimed++;
    if (i >= 0) {
      used.add(i);
      matched++;
      if (ok) { own++; verified++; }
    }
  }
  const refFiles = new Set(task.reference.files.map((f) => f.path));
  const planFiles = new Set(plan.files.map((f) => f.path));
  const hit = [...planFiles].filter((p) => refFiles.has(p)).length;
  const testHit = task.tests.files.filter((p) => plan.tests.files.includes(p)).length;
  const required = ref.length;
  return {
    required,
    matched,
    stepShare: r3(matched / required),
    fileRecall: r3(hit / refFiles.size),
    filePrecision: r3(planFiles.size ? hit / planFiles.size : 0),
    testRecall: r3(testHit / task.tests.files.length),
    canDoClaimed: claimed,
    canDoVerified: verified,
    canDoAccuracy: claimed ? r3(verified / claimed) : null,
    ownShare: r3(own / required),
    teamShare: r3(1 - own / required),
    missing: plan.steps.filter((s) => s.status === "missing").length,
  };
}

// ---- the add-only public log

export interface LockRow { schema: typeof LOCK_SCHEMA; at: string; set: "public" | "hidden"; taskFileSha256: string; tasks: number }
export interface RunRow {
  schema: typeof RUN_SCHEMA;
  at: string;
  set: "public" | "hidden";
  taskFileSha256: string;
  /** sha256(taskFileSha256 + ":" + task id), first 16 hex: identifies a task without naming it. */
  taskKey: string;
  /** Public set only. A hidden-set row never names its repository or commit. */
  repo?: string;
  commit?: string;
  workspace: string;
  planner: string;
  plannerSha256: string;
  planSha256: string | null;
  code: RunCode;
  grade: Grade | null;
}
export type LogRow = LockRow | RunRow;

export const taskKey = (fileSha: string, id: string): string => sha256(`${fileSha}:${id}`).slice(0, 16);

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const H40 = /^[0-9a-f]{40}$/;
const H64 = /^[0-9a-f]{64}$/;
const GRADE_KEYS = ["required", "matched", "stepShare", "fileRecall", "filePrecision", "testRecall", "canDoClaimed", "canDoVerified", "canDoAccuracy", "ownShare", "teamShare", "missing"];

/** Validates one log row. Fixed keys and shapes only: no URL, no message text can fit anywhere. */
export function logRowProblem(o: unknown): string | null {
  if (!o || typeof o !== "object" || Array.isArray(o)) return "not_object";
  const r = o as Record<string, any>;
  const keys = Object.keys(r);
  if (typeof r.at !== "string" || !ISO.test(r.at)) return "at";
  if (r.set !== "public" && r.set !== "hidden") return "set";
  if (typeof r.taskFileSha256 !== "string" || !H64.test(r.taskFileSha256)) return "file_sha";
  if (r.schema === LOCK_SCHEMA) {
    if (keys.sort().join(",") !== "at,schema,set,taskFileSha256,tasks") return "lock_keys";
    return Number.isInteger(r.tasks) && r.tasks > 0 ? null : "lock_tasks";
  }
  if (r.schema === LOOP_SCHEMA) return loopRowProblem(r); // M146: loop rows (peaceai/lib/looprow.ts)
  if (r.schema !== RUN_SCHEMA) return "schema";
  const allowed = new Set(["schema", "at", "set", "taskFileSha256", "taskKey", "repo", "commit", "workspace", "planner", "plannerSha256", "planSha256", "code", "grade"]);
  if (keys.some((k) => !allowed.has(k))) return "run_keys";
  if (typeof r.taskKey !== "string" || !/^[0-9a-f]{16}$/.test(r.taskKey)) return "task_key";
  if (r.set === "hidden" && ("repo" in r || "commit" in r)) return "hidden_names_repo";
  if (r.set === "public" && (typeof r.repo !== "string" || !/^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/.test(r.repo) || typeof r.commit !== "string" || !H40.test(r.commit))) return "public_repo";
  if (typeof r.workspace !== "string" || !H40.test(r.workspace)) return "workspace";
  if (typeof r.planner !== "string" || !/^[a-z0-9-]{1,40}$/.test(r.planner)) return "planner";
  if (typeof r.plannerSha256 !== "string" || !H64.test(r.plannerSha256)) return "planner_sha";
  if (!(r.planSha256 === null || (typeof r.planSha256 === "string" && H64.test(r.planSha256)))) return "plan_sha";
  if (!(RUN_CODES as readonly string[]).includes(r.code)) return "code";
  if (r.code === "OK" ? !r.grade : r.grade !== null) return "grade_presence";
  if (r.grade) {
    const g = r.grade as Record<string, unknown>;
    if (Object.keys(g).sort().join(",") !== [...GRADE_KEYS].sort().join(",")) return "grade_keys";
    if (!Object.entries(g).every(([k, v]) => (k === "canDoAccuracy" && v === null) || (typeof v === "number" && Number.isFinite(v) && v >= 0))) return "grade_values";
  }
  return null;
}

/** Parses log text; returns rows or the first problem (as a code with its 1-based line). */
export function parseLog(text: string): { rows: LogRow[] } | { problem: string; line: number } {
  const rows: LogRow[] = [];
  const lines = text.split("\n");
  if (text.length && !text.endsWith("\n")) return { problem: "no_final_newline", line: lines.length };
  for (let i = 0; i < lines.length - 1; i++) {
    let o: unknown;
    try { o = JSON.parse(lines[i]!); } catch { return { problem: "json", line: i + 1 }; }
    const p = logRowProblem(o);
    if (p) return { problem: p, line: i + 1 };
    rows.push(o as LogRow);
  }
  return { rows };
}

/** Add-only: the older text must be a byte prefix of the newer one (and both must parse). */
export function addOnlyProblem(older: string, newer: string): string | null {
  if (!newer.startsWith(older)) return "rewritten";
  const p = parseLog(newer);
  return "problem" in p ? `row:${p.problem}` : null;
}

/** The log as committed at HEAD of `root` (a run must be locked in a commit, not just in the working tree). */
export function committedLog(root: string): string {
  try { return execFileSync("git", ["show", `HEAD:${RUN_LOG}`], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }); } catch { return ""; }
}

export function isLocked(logText: string, fileSha: string): boolean {
  const p = parseLog(logText);
  return !("problem" in p) && p.rows.some((r) => r.schema === LOCK_SCHEMA && r.taskFileSha256 === fileSha);
}

export function readLog(root: string): string {
  const p = join(root, RUN_LOG);
  return existsSync(p) ? readFileSync(p, "utf8") : "";
}
