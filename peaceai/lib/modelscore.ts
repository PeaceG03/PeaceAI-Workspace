// M167: model-v1's SCORING side (spec/edit-proposer-model-v1.md). Runs only in the `model-v1-score` job of
// .github/workflows/peace-model-v1-dev.yml, which holds the memchecked Results LM (pinned by its weights sha256 in
// peaceai/model/model-v1-proposer.json) and runs no candidate code: it rebuilds repair-v1's candidate lists for the
// public dev tasks (anonymous clones of the pinned commits, no team tests, no install, no test run), scores each
// candidate once (mean log P of its changed lines given the request and the lines before them: infer.py score), and
// emits one small ranking (index lists, sha256-bound to task key + candidate list + model manifest). Counts only are
// printed; nothing is uploaded. Each guard is a single line tagged "// m167-guard:<id>" (m167-model-proposer.test.ts).
import { networkInterfaces } from "node:os";
import { openRepo } from "./codesearch.ts";
import { locate, repairCandidates, type Candidate } from "./editpropose.ts";
import { indexFiles, type CopyFetcher } from "./loop.ts";
import { LM_FILES, LM_REPO } from "./lm.ts";
import { bindingSha256, candidatesSha256, MAX_RANKING_BYTES, RANKING_SCHEMA, type Ranking } from "./modelpropose.ts";
import { sha256, taskProblem, type PlanTaskFile } from "./plan.ts";
import { taskKey } from "./plangrade.ts";

export const SCORE_JOB = "model-v1-score";
export const SCORE_WORKFLOW = ".github/workflows/peace-model-v1-dev.yml";
export const CANDIDATES_SCHEMA = "peaceai-model-v1-candidates:v1";

/**
 * Stricter than lm.ts lmJobAllowed (which allows off Actions): the scoring job only, on Actions, in this repository,
 * from its own workflow on main, started by a manual dispatch, never where candidate code runs.
 */
export function scoringJobAllowed(env: Record<string, string | undefined>): boolean {
  if (env.PEACEAI_CANDIDATE_JOB === "true") return false; // m167-guard:job-candidate
  if (env.GITHUB_ACTIONS !== "true") return false; // m167-guard:job-actions
  if (env.GITHUB_JOB !== SCORE_JOB) return false; // m167-guard:job-id
  if (env.GITHUB_REPOSITORY !== LM_REPO) return false; // m167-guard:job-repo
  if (env.GITHUB_EVENT_NAME !== "workflow_dispatch") return false; // m167-guard:job-dispatch
  if (env.GITHUB_REF !== "refs/heads/main") return false; // m167-guard:job-main
  if (env.GITHUB_WORKFLOW_REF !== `${LM_REPO}/${SCORE_WORKFLOW}@refs/heads/main`) return false; // m167-guard:job-workflow
  return true; // runInfer then also requires lm.ts lmJobAllowed (LM_JOB_WORKFLOWS pins this job id to SCORE_WORKFLOW)
}

/** No network once scoring starts: the score step runs in its own network namespace, where only a loopback without
 *  addresses (or nothing) is left. Any other interface with an address refuses. */
export function offline(ifaces: ReturnType<typeof networkInterfaces> = networkInterfaces()): boolean {
  return Object.entries(ifaces).every(([name, addrs]) => name === "lo" || !addrs || addrs.length === 0);
}

/** The model manifest: one `<sha256>  <file>` line per LM file, in LM_FILES order (sha256sum format). */
export function modelManifest(shas: Record<string, string>): string | null {
  if (!LM_FILES.every((f) => /^[0-9a-f]{64}$/.test(shas[f] ?? ""))) return null;
  return LM_FILES.map((f) => `${shas[f]}  ${f}\n`).join("");
}
export function modelManifestSha256(shas: Record<string, string>): string | null {
  const m = modelManifest(shas);
  return m === null ? null : sha256(m);
}

/** One scoring item per candidate: its changed lines (target) after the request and up to 30 lines before them. */
export function changeItem(request: string, path: string, before: string, after: string): { context: string; target: string } {
  const a = before.split("\n"), b = after.split("\n");
  let p = 0;
  while (p < a.length && p < b.length && a[p] === b[p]) p++;
  let s = 0;
  while (s < a.length - p && s < b.length - p && a[a.length - 1 - s] === b[b.length - 1 - s]) s++;
  const target = b.slice(p, b.length - s).join("\n");
  const head = `// ${request.replace(/\s+/g, " ").trim().slice(0, 400)}\n// ${path}\n`;
  const lines = b.slice(Math.max(0, p - 30), p);
  return { context: head + lines.join("\n") + (lines.length ? "\n" : ""), target: target.slice(0, 2000) + "\n" };
}

export function candidateItems(request: string, files: ReadonlyMap<string, string>, cands: readonly Candidate[]): { context: string; target: string }[] {
  return cands.map((c) => {
    const parts = c.edits.map((e) => changeItem(request, e.path, files.get(e.path) ?? "", e.content));
    return { context: parts[0]!.context, target: parts.map((x) => x.target).join("") };
  });
}

export interface TaskCandidates { taskKey: string; candidatesSha256: string; items: { context: string; target: string }[] }
export interface CandidatesFile { schema: typeof CANDIDATES_SCHEMA; taskFileSha256: string; entries: TaskCandidates[] }

/** repair-v1's candidate list for every task, exactly as the attempt job's model-v1 rebuilds it (request only). */
export function buildCandidates(file: PlanTaskFile, fileSha: string, fetcher: CopyFetcher): { out: CandidatesFile; refused: Record<string, number> } {
  const entries: TaskCandidates[] = [];
  const refused: Record<string, number> = {};
  const refuse = (code: string) => { refused[code] = (refused[code] ?? 0) + 1; };
  for (const task of file.tasks) {
    if (taskProblem(task)) { refuse("TASK_INVALID"); continue; }
    let c: ReturnType<CopyFetcher> | null = null;
    try {
      c = fetcher(task.repo, task.commit, task.commit, []); // the pinned commit only; no team test is read
      if (c.head !== task.commit) { refuse("COMMIT_MISMATCH"); continue; } // m167-guard:cands-commit
      const files = new Map(indexFiles(c.dir).map((f) => [f.path, f.content] as const));
      const sites = locate(openRepo(c.dir), { request: task.request, failing: [] });
      const cands = sites.length ? repairCandidates(sites, files) : [];
      entries.push({ taskKey: taskKey(fileSha, task.id), candidatesSha256: candidatesSha256(cands), items: candidateItems(task.request, files, cands) });
    } catch { refuse("FETCH_FAILED"); }
    finally { c?.close(); }
  }
  return { out: { schema: CANDIDATES_SCHEMA, taskFileSha256: fileSha, entries }, refused };
}

/** Indices sorted by mean log-probability, high first; a candidate without a score last; ties keep repair-v1's order. */
export function rankOrder(means: readonly (number | null)[]): number[] {
  const key = (m: number | null) => (m === null || !Number.isFinite(m) ? -Infinity : m);
  return means.map((m, i) => ({ m: key(m), i })).sort((a, b) => b.m - a.m || a.i - b.i).map((x) => x.i);
}

export type Scorer = (items: { id: string; context: string; target: string }[]) => { id: string; logprob: number; tokens: number }[] | null;

/** The ranking from the candidate lists and a scorer (infer.py score in the job; a fake in unit tests). */
export function buildRanking(c: CandidatesFile, scorer: Scorer, model: { weightsSha256: string; modelManifestSha256: string }): { ok: true; ranking: Ranking; text: string; sha256: string } | { ok: false; reason: string } {
  const entries: Ranking["entries"] = [];
  for (const e of c.entries) {
    let means: (number | null)[] = [];
    if (e.items.length) {
      const res = scorer(e.items.map((it, i) => ({ id: String(i), ...it })));
      if (!res) return { ok: false, reason: "INFER_FAILED" }; // m167-guard:score-failed
      if (res.length !== e.items.length || res.some((s, i) => s.id !== String(i))) return { ok: false, reason: "SCORES_MISMATCH" }; // m167-guard:score-ids
      means = res.map((s) => (s.tokens > 0 ? s.logprob / s.tokens : null));
    }
    const order = rankOrder(means);
    entries.push({ taskKey: e.taskKey, candidatesSha256: e.candidatesSha256, order, bindingSha256: bindingSha256(model.modelManifestSha256, e.taskKey, e.candidatesSha256, order) });
  }
  const ranking: Ranking = { schema: RANKING_SCHEMA, taskFileSha256: c.taskFileSha256, weightsSha256: model.weightsSha256, modelManifestSha256: model.modelManifestSha256, entries };
  const text = JSON.stringify(ranking);
  if (Buffer.byteLength(text) > MAX_RANKING_BYTES) return { ok: false, reason: "RANKING_TOO_LARGE" };
  return { ok: true, ranking, text, sha256: sha256(text) };
}
