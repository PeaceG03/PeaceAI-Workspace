// Experimental CI watch. credit is always false. One ordinary program reads GitHub check
// runs and, only when a required set has settled, POSTs a small JSON body to a Builder
// webhook. No model call. HTTP 200 means the routine was accepted, not that it finished.
// The webhook server documents no idempotency contract, so a retry can deliver twice.
import { createHash } from "node:crypto";
import { renameSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, basename, join } from "node:path";

export const CI_WATCH_SCHEMA = "peaceai-ci-watch:v1" as const;
export const CI_WATCH_EVENT = "peaceai-ci-watch-event:v1" as const;
export const WATCH_WORKFLOWS = ["ci", "leak-check", "builder-log"] as const;
export type WatchWorkflow = (typeof WATCH_WORKFLOWS)[number];

const WORKFLOW_FILE: Record<WatchWorkflow, string> = {
  ci: "ci.yml",
  "leak-check": "leak-check.yml",
  "builder-log": "builder-log.yml",
};

export function workflowFile(name: string): string | null {
  return (WATCH_WORKFLOWS as readonly string[]).includes(name) ? WORKFLOW_FILE[name as WatchWorkflow] : null;
}

export type Overall = "pending" | "green" | "failed" | "closed" | "merged" | "deadline";
export type RunConclusion = "success" | "failure" | "cancelled" | "skipped" | "missing" | "pending";

export interface Watch {
  repo: string;
  pr: number;
  workflows: WatchWorkflow[];
  createdAt: string;
  deadlineAt: string;
  active: boolean;
  terminal: boolean;
  head: string | null;
  lastFingerprint: string | null;
  lastOverall: Overall | null;
}

export interface WatchFile {
  schema: typeof CI_WATCH_SCHEMA;
  experimental: true;
  credit: false;
  watches: Watch[];
}

export interface WorkflowReport {
  name: WatchWorkflow;
  conclusion: RunConclusion;
  runId: number | null;
  url: string | null;
}

export interface Assessment {
  head: string | null;
  prState: "open" | "closed";
  merged: boolean;
  workflows: WorkflowReport[];
  settled: boolean;
  overall: Overall;
  fingerprint: string;
}

export interface GhRun {
  id: number;
  head_sha: string;
  status: string;
  conclusion: string | null;
  html_url?: string;
}

export interface GhPr {
  state: "open" | "closed";
  merged: boolean;
  headSha: string;
}

const HEX40 = /^[0-9a-f]{40}$/;
const REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

export function notifyConfigProblem(url: string, key: string): "missing" | "bad-url" | null {
  if (!url || !key) return "missing";
  let parsed: URL;
  try { parsed = new URL(url); } catch { return "bad-url"; }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || !parsed.hostname) return "bad-url";
  return null;
}

export function emptyState(): WatchFile {
  return { schema: CI_WATCH_SCHEMA, experimental: true, credit: false, watches: [] };
}

function isIso(s: unknown): s is string {
  return typeof s === "string" && Number.isFinite(Date.parse(s));
}

function watchOk(w: unknown): w is Watch {
  if (!w || typeof w !== "object") return false;
  const row = w as Watch;
  if (!REPO.test(row.repo) || !Number.isInteger(row.pr) || row.pr <= 0) return false;
  if (!Array.isArray(row.workflows) || row.workflows.length === 0) return false;
  if (new Set(row.workflows).size !== row.workflows.length) return false;
  if (!row.workflows.every((n) => (WATCH_WORKFLOWS as readonly string[]).includes(n))) return false;
  if (!isIso(row.createdAt) || !isIso(row.deadlineAt)) return false;
  if (typeof row.active !== "boolean" || typeof row.terminal !== "boolean") return false;
  if (row.head !== null && !HEX40.test(row.head)) return false;
  if (row.lastFingerprint !== null && typeof row.lastFingerprint !== "string") return false;
  if (row.active && row.terminal) return false;
  return true;
}

/** Refuse a file we cannot trust. The bytes are left as they were. */
export function loadState(text: string): { ok: true; state: WatchFile } | { ok: false; code: "CORRUPT" } {
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { return { ok: false, code: "CORRUPT" }; }
  if (!parsed || typeof parsed !== "object") return { ok: false, code: "CORRUPT" };
  const doc = parsed as WatchFile;
  if (doc.schema !== CI_WATCH_SCHEMA || doc.experimental !== true || doc.credit !== false) return { ok: false, code: "CORRUPT" };
  if (!Array.isArray(doc.watches) || !doc.watches.every(watchOk)) return { ok: false, code: "CORRUPT" };
  const active = doc.watches.filter((w) => w.active).map((w) => `${w.repo}#${w.pr}`);
  if (new Set(active).size !== active.length) return { ok: false, code: "CORRUPT" };
  const all = doc.watches.map((w) => `${w.repo}#${w.pr}`);
  if (new Set(all).size !== all.length) return { ok: false, code: "CORRUPT" };
  return { ok: true, state: doc };
}

export function saveState(path: string, state: WatchFile): void {
  const dir = dirname(path);
  mkdirSync(dir, { recursive: true });
  const tmp = join(dir, `.${basename(path)}.${process.pid}.tmp`);
  writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  renameSync(tmp, path);
}

export function addWatch(state: WatchFile, watch: Watch): { ok: true; state: WatchFile } | { ok: false; code: "ALREADY" } {
  if (state.watches.some((w) => w.repo === watch.repo && w.pr === watch.pr)) return { ok: false, code: "ALREADY" };
  return { ok: true, state: { ...state, watches: [...state.watches, watch] } };
}

function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

function conclusionOf(run: GhRun | undefined): RunConclusion {
  if (!run) return "missing";
  if (run.status !== "completed") return "pending";
  if (run.conclusion === "success") return "success";
  if (run.conclusion === "failure" || run.conclusion === "cancelled" || run.conclusion === "skipped") return run.conclusion;
  return "failure";
}

/** Latest run on this exact head. Older shas are ignored. */
export function latestOnHead(runs: readonly GhRun[], head: string): GhRun | undefined {
  return runs.filter((r) => r.head_sha === head).sort((a, b) => b.id - a.id)[0];
}

export function judge(
  pr: GhPr & { repo: string },
  workflows: readonly WatchWorkflow[],
  byName: Readonly<Record<string, readonly GhRun[]>>,
  nowMs: number,
  deadlineAt: string,
): Assessment {
  const workflowsOut: WorkflowReport[] = workflows.map((name) => {
    const run = latestOnHead(byName[name] ?? [], pr.headSha);
    const conclusion = conclusionOf(run);
    const settledRun = conclusion !== "missing" && conclusion !== "pending";
    const url = run && settledRun && REPO.test(pr.repo) ? `https://github.com/${pr.repo}/actions/runs/${run.id}` : null;
    return { name, conclusion, runId: run ? run.id : null, url };
  });
  const pastDeadline = nowMs >= Date.parse(deadlineAt);
  let overall: Overall;
  let settled = false;
  if (pr.merged) { overall = "merged"; settled = true; }
  else if (pr.state === "closed") { overall = "closed"; settled = true; }
  else if (pastDeadline) { overall = "deadline"; settled = true; }
  else if (workflowsOut.some((w) => w.conclusion === "missing" || w.conclusion === "pending")) { overall = "pending"; settled = false; }
  else if (workflowsOut.every((w) => w.conclusion === "success")) { overall = "green"; settled = true; }
  else { overall = "failed"; settled = true; }
  if (overall === "pending") settled = false;
  const fingerprint = sha256(JSON.stringify({
    head: pr.headSha,
    overall,
    pr: pr.state,
    merged: pr.merged,
    workflows: workflowsOut.map((w) => ({ name: w.name, conclusion: w.conclusion, runId: w.runId })),
  }));
  return { head: pr.headSha, prState: pr.state, merged: pr.merged, workflows: workflowsOut, settled, overall, fingerprint };
}

export function planNotify(watch: Watch, assessment: Assessment): boolean {
  return watch.active && !watch.terminal && assessment.settled && assessment.fingerprint !== watch.lastFingerprint;
}

export function applyResult(watch: Watch, assessment: Assessment, notified: boolean): Watch {
  if (!notified) return watch;
  const terminal = assessment.overall !== "pending";
  return {
    ...watch,
    head: assessment.head,
    lastFingerprint: assessment.fingerprint,
    lastOverall: assessment.overall,
    active: terminal ? false : watch.active,
    terminal,
  };
}

export interface EventBody {
  schema: typeof CI_WATCH_EVENT;
  experimental: true;
  credit: false;
  repo: string;
  pr: number;
  head: string | null;
  overall: Overall;
  settled: boolean;
  workflows: WorkflowReport[];
  duplicateDeliveryPossible: true;
}

export function eventBody(watch: Watch, assessment: Assessment): EventBody {
  return {
    schema: CI_WATCH_EVENT,
    experimental: true,
    credit: false,
    repo: watch.repo,
    pr: watch.pr,
    head: assessment.head,
    overall: assessment.overall,
    settled: assessment.settled,
    workflows: assessment.workflows,
    duplicateDeliveryPossible: true,
  };
}

export type PostResult = { ok: true; attempts: number } | { ok: false; attempts: number };

/** POST once per attempt. Non-200 and network errors retry. A 200 is acceptance, not completion. */
export async function postWebhook(opts: {
  url: string;
  key: string;
  body: EventBody;
  fetchImpl: typeof fetch;
  sleep: (ms: number) => Promise<void>;
  attempts?: number;
}): Promise<PostResult> {
  const problem = notifyConfigProblem(opts.url, opts.key);
  if (problem) return { ok: false, attempts: 0 };
  const limit = opts.attempts ?? 3;
  const payload = JSON.stringify(opts.body);
  for (let i = 1; i <= limit; i++) {
    try {
      const res = await opts.fetchImpl(opts.url, {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(10_000),
        headers: {
          Authorization: `Bearer ${opts.key}`,
          "Content-Type": "application/json",
          "User-Agent": "PeaceAI-ci-watch",
        },
        body: payload,
      });
      if (res.status === 200) return { ok: true, attempts: i };
    } catch {
      // redirect, timeout, or network. The message is dropped so a URL or key cannot leak.
    }
    if (i < limit) await opts.sleep(250 * 2 ** (i - 1));
  }
  return { ok: false, attempts: limit };
}

export function githubHeaders(token: string | undefined): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "PeaceAI-ci-watch",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

export async function githubGet(url: string, token: string | undefined, fetchImpl: typeof fetch): Promise<unknown> {
  let res: Response;
  try {
    res = await fetchImpl(url, { headers: githubHeaders(token), redirect: "error", signal: AbortSignal.timeout(10_000) });
  } catch {
    throw new Error("github request failed");
  }
  if (!res.ok) throw new Error(`github http ${res.status}`);
  try { return await res.json(); } catch { throw new Error("github request failed"); }
}

export function parsePr(body: unknown): (GhPr & { repo?: string }) | null {
  if (!body || typeof body !== "object") return null;
  const row = body as { state?: unknown; merged?: unknown; head?: { sha?: unknown } };
  if (row.state !== "open" && row.state !== "closed") return null;
  if (typeof row.merged !== "boolean") return null;
  if (!row.head || typeof row.head.sha !== "string" || !HEX40.test(row.head.sha)) return null;
  return { state: row.state, merged: row.merged, headSha: row.head.sha };
}

export function parseRuns(body: unknown): GhRun[] | null {
  if (!body || typeof body !== "object") return null;
  const runs = (body as { workflow_runs?: unknown }).workflow_runs;
  if (!Array.isArray(runs)) return null;
  const out: GhRun[] = [];
  for (const run of runs) {
    if (!run || typeof run !== "object") return null;
    const row = run as GhRun;
    if (!Number.isInteger(row.id) || typeof row.head_sha !== "string" || typeof row.status !== "string") return null;
    out.push({ id: row.id, head_sha: row.head_sha, status: row.status, conclusion: row.conclusion ?? null });
  }
  return out;
}

export async function assessWatch(watch: Watch, token: string | undefined, fetchImpl: typeof fetch, nowMs: number): Promise<Assessment | "github"> {
  let prBody: unknown;
  try { prBody = await githubGet(prUrl(watch.repo, watch.pr), token, fetchImpl); } catch { return "github"; }
  const pr = parsePr(prBody);
  if (!pr) return "github";
  const byName: Record<string, GhRun[]> = {};
  for (const name of watch.workflows) {
    let body: unknown;
    try { body = await githubGet(runsUrl(watch.repo, name, pr.headSha), token, fetchImpl); } catch { return "github"; }
    const runs = parseRuns(body);
    if (!runs) return "github";
    byName[name] = runs;
  }
  return judge({ ...pr, repo: watch.repo }, watch.workflows, byName, nowMs, watch.deadlineAt);
}

export function prUrl(repo: string, pr: number): string {
  return `https://api.github.com/repos/${repo}/pulls/${pr}`;
}

export function runsUrl(repo: string, workflow: WatchWorkflow, head: string): string {
  const file = WORKFLOW_FILE[workflow];
  return `https://api.github.com/repos/${repo}/actions/workflows/${file}/runs?head_sha=${head}&per_page=20`;
}
