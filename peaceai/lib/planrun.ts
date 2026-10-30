// PLAN-ONLY mode v1: the runner. Locks a task file (by sha256, in the add-only log) and runs a locked one.
// The task file can be any path, including one the Builder has never seen (Auditor's hidden half): the runner only
// needs its bytes, and what it logs about a hidden task is a key, codes and numbers. See peaceai/spec/plan-only-v1.md.
import { execFileSync } from "node:child_process";
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadModel } from "./nlparse.ts";
import { buildIndex, MAX_INDEX_FILE_BYTES, type IndexFile } from "./symbols.ts";
import type { RuleSpec } from "./learned.ts";
import { approvedRules, planTask, PLAN_LICENSES, PLANNER_VERSION, sha256, taskFileProblem, taskProblem, trainingRepos, type Plan, type PlanTask, type PlanTaskFile } from "./plan.ts";
import { committedLog, gradePlan, isLocked, LOCK_SCHEMA, logRowProblem, RUN_LOG, RUN_SCHEMA, taskKey, type Grade, type LockRow, type RunCode, type RunRow } from "./plangrade.ts";

export const ROOT = join(import.meta.dirname, "../..");
const now = (): string => new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
const git = (cwd: string, ...a: string[]): string => execFileSync("git", a, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 1 << 28 }).trim();

/** A read-only view of the target at the pinned commit. `unchanged` proves plan-only wrote nothing to it. */
export interface Checkout { head: string; files: IndexFile[]; read(path: string): string | null; unchanged(): boolean; close(): void }
export type Fetcher = (repo: string, commit: string) => Checkout;

/** Shallow-fetches exactly the pinned commit into a fresh temp dir (removed on close). */
export const gitFetcher: Fetcher = (repo, commit) => {
  const dir = mkdtempSync(join(tmpdir(), "peaceai-plan-"));
  try {
    git(dir, "init", "-q");
    let ok = false;
    for (let i = 0; i < 3 && !ok; i++) { try { git(dir, "fetch", "-q", "--depth", "1", `https://github.com/${repo}.git`, commit); ok = true; } catch { /* retry */ } }
    if (!ok) throw new RunError("FETCH_FAILED");
    git(dir, "checkout", "-q", "FETCH_HEAD");
    const files: IndexFile[] = [];
    for (const p of git(dir, "ls-files", "-z").split("\0").filter((x) => /\.tsx?$/.test(x))) {
      const content = readFileSync(join(dir, p), "utf8");
      if (Buffer.byteLength(content) <= MAX_INDEX_FILE_BYTES) files.push({ path: p, content });
    }
    return {
      head: git(dir, "rev-parse", "HEAD"),
      files,
      read: (p) => { try { return readFileSync(join(dir, p), "utf8"); } catch { return null; } },
      unchanged: () => git(dir, "status", "--porcelain", "--untracked-files=all") === "" && git(dir, "rev-parse", "HEAD") === commit,
      close: () => rmSync(dir, { recursive: true, force: true }),
    };
  } catch (e) {
    rmSync(dir, { recursive: true, force: true });
    throw e instanceof RunError ? e : new RunError("FETCH_FAILED");
  }
};

export class RunError extends Error { constructor(readonly code: RunCode) { super(code); } }

export function plannerSha256(): string {
  return sha256(["lib/plan.ts", "lib/plangrade.ts", "lib/planrun.ts"].map((f) => readFileSync(join(ROOT, "peaceai", f), "utf8")).join("\0"));
}

export function lockRow(fileText: string): LockRow {
  const parsed = JSON.parse(fileText) as PlanTaskFile;
  const p = taskFileProblem(parsed);
  if (p) throw new RunError("TASK_FILE_INVALID");
  return { schema: LOCK_SCHEMA, at: now(), set: parsed.set, taskFileSha256: sha256(fileText), tasks: parsed.tasks.length };
}

export interface RunOptions {
  root?: string;
  fetcher?: Fetcher;
  /** Where full plans go (never committed: .peaceai-out is gitignored). */
  outDir?: string;
  /** Committed log text to check the lock against (defaults to HEAD:peaceai/plan/runs.jsonl). */
  committed?: string;
  rules?: RuleSpec[];
  training?: Set<string>;
}
export interface TaskResult { row: RunRow; plan: Plan | null }

/** Plans and grades one task. Never throws: every failure is a row with a fixed code. */
export function runTask(task: PlanTask, set: "public" | "hidden", fileSha: string, o: Required<Omit<RunOptions, "committed">>): TaskResult {
  const base = { schema: RUN_SCHEMA, at: now(), set, taskFileSha256: fileSha, taskKey: taskKey(fileSha, task.id) } as const;
  const names = set === "public" ? { repo: task.repo, commit: task.commit } : {};
  const workspace = (() => { try { return git(o.root, "rev-parse", "HEAD"); } catch { return "0".repeat(40); } })();
  const row = (code: RunCode, plan: Plan | null, grade: Grade | null): RunRow => ({ ...base, ...names, workspace, planner: PLANNER_VERSION, plannerSha256: plannerSha256(), planSha256: plan ? sha256(JSON.stringify(plan)) : null, code, grade });
  if (taskProblem(task)) return { row: row("TASK_INVALID", null, null), plan: null };
  if (!(PLAN_LICENSES as readonly string[]).includes(task.license)) return { row: row("LICENSE_NOT_ALLOWED", null, null), plan: null };
  if (o.training.has(task.repo.toLowerCase())) return { row: row("TRAINING_OVERLAP", null, null), plan: null };
  let co: Checkout | null = null;
  try {
    co = o.fetcher(task.repo, task.commit);
    if (co.head !== task.commit) return { row: row("COMMIT_MISMATCH", null, null), plan: null };
    const lic = co.read(task.licensePath);
    if (lic === null || sha256(lic) !== task.licenseSha256) return { row: row("LICENSE_CHANGED", null, null), plan: null };
    let testCommand: string | null = null;
    try { testCommand = JSON.parse(co.read("package.json") ?? "{}").scripts?.test ?? null; } catch { testCommand = null; }
    let plan: Plan;
    try { plan = planTask(task.id, task.request, { repo: task.repo, files: co.files, rules: o.rules, model: loadModel(), testCommand }, buildIndex(co.files)); }
    catch { return { row: row("PLAN_FAILED", null, null), plan: null }; }
    if (!co.unchanged()) return { row: row("TARGET_CHANGED", plan, null), plan };
    const grade = gradePlan(plan, task, o.rules, co.files);
    return { row: row("OK", plan, grade), plan };
  } catch (e) {
    return { row: row(e instanceof RunError ? e.code : "FETCH_FAILED", null, null), plan: null };
  } finally {
    co?.close();
  }
}

/** Runs a locked task file. Appends one row per task to the log, writes full plans to outDir. */
export function runFile(path: string, opts: RunOptions = {}): { code: RunCode; rows: RunRow[] } {
  const root = opts.root ?? ROOT;
  const text = readFileSync(path, "utf8");
  const fileSha = sha256(text);
  if (!isLocked(opts.committed ?? committedLog(root), fileSha)) return { code: "TASK_FILE_UNLOCKED", rows: [] };
  let parsed: PlanTaskFile;
  try { parsed = JSON.parse(text); } catch { return { code: "TASK_FILE_INVALID", rows: [] }; }
  if (taskFileProblem(parsed)) return { code: "TASK_FILE_INVALID", rows: [] };
  let training = opts.training;
  if (!training) { try { training = trainingRepos(root).repos; } catch { return { code: "TRAINING_LIST_UNREADABLE", rows: [] }; } }
  const o = { root, fetcher: opts.fetcher ?? gitFetcher, outDir: opts.outDir ?? join(root, ".peaceai-out/plan"), rules: opts.rules ?? approvedRules(root), training };
  mkdirSync(o.outDir, { recursive: true });
  const rows: RunRow[] = [];
  for (const task of parsed.tasks) {
    const r = runTask(task, parsed.set, fileSha, o);
    if (logRowProblem(r.row)) throw new Error("log_row_invalid"); // a bug: never write a row the validator rejects
    rows.push(r.row);
    appendFileSync(join(root, RUN_LOG), JSON.stringify(r.row) + "\n");
    if (r.plan) writeFileSync(join(o.outDir, `${r.row.taskKey}.json`), JSON.stringify({ row: r.row, plan: r.plan }, null, 1) + "\n");
  }
  return { code: "OK", rows };
}

export function appendLock(path: string, root = ROOT): LockRow {
  const row = lockRow(readFileSync(path, "utf8"));
  appendFileSync(join(root, RUN_LOG), JSON.stringify(row) + "\n");
  return row;
}
