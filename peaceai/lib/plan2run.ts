// PLAN-ONLY v2 runner (planner plan-only-v2, peaceai/spec/plan-only-v2.md). Kept apart from planrun.ts so v1's
// files (plan.ts, plangrade.ts, planrun.ts) stay byte-identical and every v1 row keeps its plannerSha256. Same lock
// check, same training exclusion, same license and pinned-commit checks, same grader, same add-only log and row
// validator as v1; the only differences are the planner and a checkout that keeps its directory, which v2's
// read-only search tools (codesearch.ts) open. What it logs about a hidden task is a key, codes and numbers.
import { execFileSync } from "node:child_process";
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openRepo } from "./codesearch.ts";
import { loadModel } from "./nlparse.ts";
import { MAX_INDEX_FILE_BYTES, type IndexFile } from "./symbols.ts";
import type { RuleSpec } from "./learned.ts";
import { approvedRules, PLAN_LICENSES, sha256, taskFileProblem, taskProblem, trainingRepos, type Plan, type PlanTask, type PlanTaskFile } from "./plan.ts";
import { planTaskV2, PLANNER_V2, repoFromFiles, type PlanV2 } from "./plan2.ts";
import { committedLog, GRADER_VERSION, gradePlan, isLocked, logRowProblem, RUN_LOG, RUN_SCHEMA, taskKey, type Grade, type RunCode, type RunRow } from "./plangrade.ts";
import { ROOT, RunError, type Checkout } from "./planrun.ts";

const now = (): string => new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
const git = (cwd: string, ...a: string[]): string => execFileSync("git", a, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 1 << 28 }).trim();

/** A v1 Checkout plus its directory (absent for an in-memory fixture: planning then uses a temp copy of `files`). */
export interface CheckoutV2 extends Checkout { dir?: string }
export type FetcherV2 = (repo: string, commit: string) => CheckoutV2;

/** v2's digest: its planner, the shared grader and this runner. v1's digest (planrun.plannerSha256) is untouched. */
export function plannerSha256V2(root = ROOT): string {
  return sha256(["lib/plan2.ts", "lib/plangrade.ts", "lib/plan2run.ts"].map((f) => readFileSync(join(root, "peaceai", f), "utf8")).join("\0"));
}

/** Shallow-fetches exactly the pinned commit into a fresh temp dir (removed on close), as v1's gitFetcher, keeping `dir`. */
export const gitFetcherV2: FetcherV2 = (repo, commit) => {
  const dir = mkdtempSync(join(tmpdir(), "peaceai-plan2-"));
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
      dir,
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

export interface RunOptionsV2 { root?: string; fetcher?: FetcherV2; outDir?: string; committed?: string; rules?: RuleSpec[]; training?: Set<string> }
export interface TaskResultV2 { row: RunRow; plan: PlanV2 | null }

/** Plans (v2) and grades one task. Never throws: every failure is a row with a fixed code (v1's codes). */
export function runTaskV2(task: PlanTask, set: "public" | "hidden", fileSha: string, o: Required<Omit<RunOptionsV2, "committed">>): TaskResultV2 {
  const base = { schema: RUN_SCHEMA, at: now(), set, taskFileSha256: fileSha, taskKey: taskKey(fileSha, task.id) } as const;
  const names = set === "public" ? { repo: task.repo, commit: task.commit } : {};
  const workspace = (() => { try { return git(o.root, "rev-parse", "HEAD"); } catch { return "0".repeat(40); } })();
  const row = (code: RunCode, plan: PlanV2 | null, grade: Grade | null): RunRow => ({ ...base, ...names, workspace, planner: PLANNER_V2, plannerSha256: plannerSha256V2(o.root), planSha256: plan ? sha256(JSON.stringify(plan)) : null, grader: GRADER_VERSION, code, grade });
  if (taskProblem(task)) return { row: row("TASK_INVALID", null, null), plan: null };
  if (!(PLAN_LICENSES as readonly string[]).includes(task.license)) return { row: row("LICENSE_NOT_ALLOWED", null, null), plan: null };
  if (o.training.has(task.repo.toLowerCase())) return { row: row("TRAINING_OVERLAP", null, null), plan: null };
  let co: CheckoutV2 | null = null;
  try {
    co = o.fetcher(task.repo, task.commit);
    if (co.head !== task.commit) return { row: row("COMMIT_MISMATCH", null, null), plan: null };
    const lic = co.read(task.licensePath);
    if (lic === null || sha256(lic) !== task.licenseSha256) return { row: row("LICENSE_CHANGED", null, null), plan: null };
    let testCommand: string | null = null;
    try { testCommand = JSON.parse(co.read("package.json") ?? "{}").scripts?.test ?? null; } catch { testCommand = null; }
    let plan: PlanV2;
    try {
      const tmp = co.dir ? null : repoFromFiles(co.files);
      try { plan = planTaskV2(task.id, task.request, { repo: task.repo, files: co.files, rules: o.rules, model: loadModel(), testCommand }, tmp ? tmp.code : openRepo(co.dir!)); } finally { tmp?.close(); }
    } catch { return { row: row("PLAN_FAILED", null, null), plan: null }; }
    if (!co.unchanged()) return { row: row("TARGET_CHANGED", plan, null), plan };
    // The grader reads only steps (action, file, status, rule, objective) and tests: fields v1 and v2 plans share.
    const grade = gradePlan(plan as unknown as Plan, task, o.rules, co.files);
    return { row: row("OK", plan, grade), plan };
  } catch (e) {
    return { row: row(e instanceof RunError ? e.code : "FETCH_FAILED", null, null), plan: null };
  } finally {
    co?.close();
  }
}

/** Runs a locked task file with v2. Appends one row per task to the log, writes full plans to outDir. */
export function runFileV2(path: string, opts: RunOptionsV2 = {}): { code: RunCode; rows: RunRow[] } {
  const root = opts.root ?? ROOT;
  const text = readFileSync(path, "utf8");
  const fileSha = sha256(text);
  if (!isLocked(opts.committed ?? committedLog(root), fileSha)) return { code: "TASK_FILE_UNLOCKED", rows: [] };
  let parsed: PlanTaskFile;
  try { parsed = JSON.parse(text); } catch { return { code: "TASK_FILE_INVALID", rows: [] }; }
  if (taskFileProblem(parsed)) return { code: "TASK_FILE_INVALID", rows: [] };
  let training = opts.training;
  if (!training) { try { training = trainingRepos(root).repos; } catch { return { code: "TRAINING_LIST_UNREADABLE", rows: [] }; } }
  const o = { root, fetcher: opts.fetcher ?? gitFetcherV2, outDir: opts.outDir ?? join(root, ".peaceai-out/plan"), rules: opts.rules ?? approvedRules(root), training };
  mkdirSync(o.outDir, { recursive: true });
  const rows: RunRow[] = [];
  for (const task of parsed.tasks) {
    const r = runTaskV2(task, parsed.set, fileSha, o);
    if (logRowProblem(r.row)) throw new Error("log_row_invalid");
    rows.push(r.row);
    appendFileSync(join(root, RUN_LOG), JSON.stringify(r.row) + "\n");
    if (r.plan) writeFileSync(join(o.outDir, `${r.row.taskKey}.json`), JSON.stringify({ row: r.row, plan: r.plan }, null, 1) + "\n");
  }
  return { code: "OK", rows };
}
