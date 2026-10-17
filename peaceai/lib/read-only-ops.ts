// M73 READ_ONLY_OPS: a bounded allowlist of read-only GitHub actions PeaceAI may take to look at CI state
// (run status, failed jobs, recent runs, check runs for a commit). Every op is a single GET on a path built here
// from validated arguments; there is no write, dispatch, rerun, cancel, comment or log download. Every attempted
// action, allowed or refused, is logged. Off until peaceai/read-only-ops.json sets "enabled": true (its own
// reviewed one-commit approval PR).
import { readFileSync } from "node:fs";
import { join } from "node:path";

export const OPS_SCHEMA = "peaceai-read-only-ops:v1";
/** Repositories ops may read: PeaceAI's public targets only. */
export const OPS_REPOS = ["PeaceG03/PeaceAI-Workspace", "PeaceG03/PeaceSTOCKS"] as const;
export const MAX_ITEMS = 50;

export type OpName = "run_status" | "failed_jobs" | "recent_runs" | "check_runs";
export type OpArgs = Record<string, string>;
/** The only transport: one GET of an API path (no method, body or headers can be chosen by the caller). */
export type Getter = (path: string) => Promise<unknown>;
export interface OpLogEntry { at: string; op: string; repo: string | null; args: OpArgs; ok: boolean; reason: string | null; path: string | null; items: number | null }
export type OpResult = { ok: true; op: OpName; data: unknown } | { ok: false; op: string; reason: string };

const RUN_ID = /^[1-9][0-9]{0,19}$/;
const SHA = /^[0-9a-f]{40}$/;
const BRANCH = /^(?!.*\.\.)(?!\/)(?!.*\/$)[A-Za-z0-9._\/-]{1,100}$/;
const WORKFLOW = /^[A-Za-z0-9._-]{1,80}\.ya?ml$/;
const STATUS = ["failure", "success", "in_progress", "queued", "completed", "cancelled"] as const;

interface OpDef { args: Record<string, { re?: RegExp; values?: readonly string[]; optional?: boolean }>; path: (repo: string, a: OpArgs) => string; project: (body: unknown) => { data: unknown; items: number } }

const obj = (x: unknown): Record<string, unknown> => (x && typeof x === "object" && !Array.isArray(x) ? (x as Record<string, unknown>) : {});
const pick = (x: unknown, keys: readonly string[]) => Object.fromEntries(keys.map((k) => [k, obj(x)[k] ?? null]));
const list = (x: unknown, key: string) => { const v = obj(x)[key]; return Array.isArray(v) ? v.slice(0, MAX_ITEMS) : []; };
const RUN_KEYS = ["id", "name", "status", "conclusion", "event", "head_branch", "head_sha", "run_attempt", "created_at", "updated_at", "html_url"] as const;
const JOB_KEYS = ["id", "name", "status", "conclusion", "started_at", "completed_at", "html_url"] as const;
const CHECK_KEYS = ["id", "name", "status", "conclusion", "started_at", "completed_at", "html_url"] as const;

/** The allowlist. Output is projected to fixed fields (no logs, no step output, no secrets-bearing payloads). */
export const READ_ONLY_OPS: Readonly<Record<OpName, OpDef>> = {
  run_status: {
    args: { run: { re: RUN_ID } },
    path: (repo, a) => `repos/${repo}/actions/runs/${a.run}`,
    project: (b) => ({ data: pick(b, RUN_KEYS), items: 1 }),
  },
  failed_jobs: {
    args: { run: { re: RUN_ID } },
    path: (repo, a) => `repos/${repo}/actions/runs/${a.run}/jobs?filter=latest&per_page=${MAX_ITEMS}`,
    project: (b) => { const jobs = list(b, "jobs").filter((j) => ["failure", "timed_out", "cancelled"].includes(String(obj(j).conclusion))).map((j) => ({ ...pick(j, JOB_KEYS), failed_steps: (Array.isArray(obj(j).steps) ? (obj(j).steps as unknown[]) : []).filter((s) => obj(s).conclusion === "failure").map((s) => String(obj(s).name ?? "")).slice(0, 20) })); return { data: jobs, items: jobs.length }; },
  },
  recent_runs: {
    args: { workflow: { re: WORKFLOW, optional: true }, branch: { re: BRANCH, optional: true }, status: { values: STATUS, optional: true } },
    path: (repo, a) => {
      const q = [`per_page=${20}`, ...(a.branch ? [`branch=${encodeURIComponent(a.branch)}`] : []), ...(a.status ? [`status=${a.status}`] : [])].join("&");
      return a.workflow ? `repos/${repo}/actions/workflows/${a.workflow}/runs?${q}` : `repos/${repo}/actions/runs?${q}`;
    },
    project: (b) => { const runs = list(b, "workflow_runs").map((r) => pick(r, RUN_KEYS)); return { data: runs, items: runs.length }; },
  },
  check_runs: {
    args: { sha: { re: SHA } },
    path: (repo, a) => `repos/${repo}/commits/${a.sha}/check-runs?per_page=${MAX_ITEMS}`,
    project: (b) => { const checks = list(b, "check_runs").map((c) => pick(c, CHECK_KEYS)); return { data: checks, items: checks.length }; },
  },
};

export function opsEnabled(path = join(import.meta.dirname, "..", "read-only-ops.json")): boolean {
  try {
    const c = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    return c.schema === OPS_SCHEMA && Object.keys(c).sort().join(",") === "enabled,schema" && c.enabled === true;
  } catch { return false; }
}

/** Validates an op request; returns the GET path or a named refusal. Pure. */
export function planOp(op: string, repo: string, args: OpArgs): { ok: true; path: string } | { ok: false; reason: string } {
  if (!Object.prototype.hasOwnProperty.call(READ_ONLY_OPS, op)) return { ok: false, reason: "op_not_allowlisted" };
  if (!(OPS_REPOS as readonly string[]).includes(repo)) return { ok: false, reason: "repo_not_allowlisted" };
  const def = READ_ONLY_OPS[op as OpName];
  for (const k of Object.keys(args)) if (!Object.prototype.hasOwnProperty.call(def.args, k)) return { ok: false, reason: `unknown_arg:${k}`.slice(0, 60).replace(/[^a-z_:0-9-]/gi, "?") };
  for (const [k, spec] of Object.entries(def.args)) {
    const v = args[k];
    if (v === undefined) { if (spec.optional) continue; return { ok: false, reason: `missing_arg:${k}` }; }
    if (typeof v !== "string" || (spec.re && !spec.re.test(v)) || (spec.values && !spec.values.includes(v))) return { ok: false, reason: `bad_arg:${k}` };
  }
  const path = def.path(repo, args);
  if (!/^repos\/PeaceG03\/[A-Za-z0-9._-]+\/(actions|commits)\//.test(path) || /\.\.|\s/.test(path)) return { ok: false, reason: "bad_path" };
  return { ok: true, path };
}

const safeArgs = (args: OpArgs): OpArgs => Object.fromEntries(Object.entries(args).slice(0, 8).map(([k, v]) => [String(k).slice(0, 40), String(v).slice(0, 120)]));

/** Runs one op through the injected GET; logs exactly one entry per call, whatever happens. */
export async function runOp(op: string, repo: string, args: OpArgs, get: Getter, log: (e: OpLogEntry) => void, opts: { enabled?: boolean; now?: () => Date } = {}): Promise<OpResult> {
  const at = (opts.now ?? (() => new Date()))().toISOString();
  const entry = (ok: boolean, reason: string | null, path: string | null, items: number | null): OpLogEntry => ({ at, op: String(op).slice(0, 40), repo: typeof repo === "string" ? repo.slice(0, 120) : null, args: safeArgs(args), ok, reason, path, items });
  if (!(opts.enabled ?? opsEnabled())) { log(entry(false, "ops_disabled", null, null)); return { ok: false, op, reason: "ops_disabled" }; }
  const plan = planOp(op, repo, args);
  if (!plan.ok) { log(entry(false, plan.reason, null, null)); return { ok: false, op, reason: plan.reason }; }
  let body: unknown;
  try { body = await get(plan.path); } catch { log(entry(false, "get_failed", plan.path, null)); return { ok: false, op, reason: "get_failed" }; }
  const { data, items } = READ_ONLY_OPS[op as OpName].project(body);
  log(entry(true, null, plan.path, items));
  return { ok: true, op: op as OpName, data };
}
