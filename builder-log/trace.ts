// Traces every by:PeaceAI repo@sha landing back to its verdict patch (Auditor residual after #216).
// M87: or, on the verdict PR route (#379, peacestocks-write), back to the bot-opened verdict PR: see tracePr.
// M89: a Workspace self-landing (reply without a PR URL) is found by its verdict branch: see traceByBranch.
// For each landing: the line's PeaceAI-Workspace#N must carry a PeaceAI verdict patch comment from
// github-actions[bot]; the patch must verify against PeaceAI-Results exactly as apply-verdict-patch.ts
// does (lib/patch.ts verifyPatch); and the patch applied to the landing's first parent must give a tree
// equal to the landing's own tree. Every failure is a coded error; nothing is exempt except the
// explicit, reviewed GRANDFATHERED list below.
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { effectiveVerdict, type TaskRecord, type VerdictRecord } from "../peaceai/lib/records.ts";
import { parsePatchComment, PATCH_MARKER, sha256, verifyPatch, type PatchComment } from "../peaceai/lib/patch.ts";
import { parseProvenance } from "../peaceai/lib/stacked.ts";
import { ghCoreProbe, ghSignal, RateLimitRetry, stderrOf } from "../peaceai/lib/gh-ratelimit.ts";
import { LANDING_REPOS, type Entry } from "./check.ts";

export const BOT = "github-actions[bot]";
export const WORKSPACE = "PeaceG03/PeaceAI-Workspace";

export type TraceCode =
  | "T_NO_ISSUE" // landing line names no PeaceAI-Workspace#N (or several)
  | "T_NO_PATCH_COMMENT" // issue has no bot verdict patch comment
  | "T_PATCH_MALFORMED" // bot comment does not parse
  | "T_TARGET_MISMATCH" // patch target is not the landing repo
  | "T_HASH_MISMATCH" // patch-sha256 / Results candidate check failed
  | "T_RESULTS_UNREADABLE" // Results lookup failed (fail closed)
  | "T_TREE_MISMATCH" // patch on first parent != landing tree
  | "T_APPLY_FAILED" // patch does not apply to first parent
  | "T_LOOKUP_FAILED" // comment / git lookup failed (fail closed)
  | "T_STACK_MISMATCH" // a `stacked:` provenance clause (lib/stacked.ts) does not match git
  | "T_PR_MISMATCH"; // M87 PR route: the verdict PR is not merged as the landing, not this issue's branch, or not named in `why`

/** Reviewed exemptions: line seq -> reason. Each one is reported, never silent. */
export const GRANDFATHERED: Readonly<Record<number, string>> = {
  9: "T_TREE_MISMATCH: PeaceSTOCKS@0e1b354 is PeaceAI's #82 test file plus Builder's own scanner.yml wiring in one commit (pre-M6 practice, 2026-10-13); the test file matches the patch, the commit as a whole does not",
  21: "T_NO_PATCH_COMMENT: #86 verdict patch build failed on a runner rm race; Builder applied Results candidate-1.diff (sha256 af1472fe...) directly, per the 6b1c1d3 commit message",
  27: "T_NO_PATCH_COMMENT: #90 verdict patch build failed again (PR #89); Builder applied Results candidate-1.diff (sha256 5d13821f...) directly, per the 58db153 commit message",
  31: "T_APPLY_FAILED: #97 patch (sha256 b2a4bc2a... verified) conflicted at end of module with #96 (landed first as 8a4310d); Builder hand-resolved by keeping both functions",
  85: "T_NO_ISSUE: WORKFLOW_STEP lands through a PeaceSTOCKS PR (#6, task #131), not a verdict patch; the line names no PeaceAI-Workspace#N and there is no patch to trace",
  119: "T_NO_PATCH_COMMENT: #306 is a WORKFLOW_JOB candidate; the verdict patch route refuses .github/workflows/** by design (run 38980914018), so it landed byte-identical to Results tasks/306/38971869061 candidate-1.diff (sha256 b3a43c45...) through reviewed PeaceSTOCKS PR #9 (merge 2f1ff83)",
  124: "T_NO_PATCH_COMMENT: #341 is a Workspace self-zone task; the Workspace verdict route is a bot PR, not a patch comment, so it landed as bot verdict PR #345 (branch peace-task/issue-341-candidate-1-92fc7276, head d98848a, diff identical to the review) merged as PeaceAI-Workspace@b0c412e with leak-check passing under the #351 self-zone exemption",
  221: "T_NO_PATCH_COMMENT: #399 is a Workspace self-zone task; the Workspace verdict route replies \"Opening a PR for A.\" without a PR URL (PR_REPLY needs one), so it landed as bot verdict PR #406 (branch peace-task/issue-399-candidate-1-38aa6c71, head d7770ba, Auditor PASS) merged as PeaceAI-Workspace@4eb6818",
  222: "T_NO_PATCH_COMMENT: #400 is a Workspace self-zone task; the Workspace verdict route replies \"Opening a PR for A.\" without a PR URL (PR_REPLY needs one), so it landed as bot verdict PR #407 (branch peace-task/issue-400-candidate-1-2ec273c0, head 72dcd88, Auditor PASS) merged as PeaceAI-Workspace@4d187f8",
  223: "T_NO_PATCH_COMMENT: #401 is a Workspace self-zone task; the Workspace verdict route replies \"Opening a PR for A.\" without a PR URL (PR_REPLY needs one), so it landed as bot verdict PR #408 (branch peace-task/issue-401-candidate-1-e11c431d, head db95067, Auditor PASS) merged as PeaceAI-Workspace@9af05b4",
  224: "T_NO_PATCH_COMMENT: #402 is a Workspace self-zone task; the Workspace verdict route replies \"Opening a PR for A.\" without a PR URL (PR_REPLY needs one), so it landed as bot verdict PR #409 (branch peace-task/issue-402-candidate-1-60b99439, head 084f22d, Auditor PASS) merged as PeaceAI-Workspace@4a69bef",
  225: "T_NO_PATCH_COMMENT: #403 is a Workspace self-zone task; the Workspace verdict route replies \"Opening a PR for A.\" without a PR URL (PR_REPLY needs one), so it landed as bot verdict PR #410 (branch peace-task/issue-403-candidate-1-58c86fa1, head abc1cb5, Auditor PASS) merged as PeaceAI-Workspace@c2c10e1",
};

export interface ResultsView {
  latestRunId: string | null;
  target: string;
  pick: { decided: boolean; candidateId: string | null };
  resultsDiff: string | null;
}

export interface TraceDeps {
  /** Bot-authored comment bodies on a Workspace issue, oldest first. */
  botComments(issue: number): Promise<string[]>;
  /** null = Results cross-check not run here (PR job: Results key is main-only); reported per row. */
  results: ((issue: number) => Promise<ResultsView>) | null;
  /** Tree of `patch` applied to `sha`'s first parent, or null if it does not apply; plus sha's own tree. */
  trees(repo: string, sha: string, patch: string): Promise<{ applied: string | null; landing: string }>;
  /** Stacked landings: the landing's first parent and the merge-free chain base..parent (full shas), or null. */
  stack?(repo: string, sha: string, base: string): Promise<{ onto: string; via: string[] } | null>;
  /** M87 PR route: a target-repo pull request (state, merge commit, head branch, and its diff). */
  pullRequest?(repo: string, n: number): Promise<PullView>;
  /** M89 Workspace self-landing: numbers of `repo` PRs (any state) whose head is peace-task/issue-<issue>-candidate-*. */
  verdictPulls?(repo: string, issue: number): Promise<number[]>;
}

export interface PullView {
  merged: boolean;
  mergeCommit: string | null;
  headRef: string;
  diff: string;
}

/** M87: the verdict job's reply on the PR route (prguard.ts planPr reply + the opened PR's URL), last line. */
export const PR_REPLY = /Opening a PR for ([A-Z])\. https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/pull\/(\d{1,9})\s*$/;
/** M87: the verdict branch prguard.ts prBranch names: peace-task/issue-<n>-<candidate id>-<8 hex>. */
const PR_BRANCH = /^peace-task\/issue-(\d{1,9})-(candidate-\d{1,3})-[0-9a-f]{8}$/;
/** M89: the Workspace verdict route's reply names no PR URL (prguard.ts planPr); a recorded `right` verdict is required. */
export const RIGHT_REPLY = /^Verdict recorded: [A-Z] right\./;

export interface TraceRow {
  seq: number;
  landing: string;
  issue: number | null;
  status: "ok" | "grandfathered" | "fail";
  code?: TraceCode;
  detail: string;
}

const ISSUE_REF = /PeaceAI-Workspace#(\d{1,9})/g;
const LANDING = /\b(PeaceSTOCKS|PeaceAI-Workspace)@([0-9a-f]{7,40})\b/g;

/** The task issue: from `changed` if present, else the single one named in `why`. */
export function issueOf(e: Entry): number | null {
  const pick = (s: string) => [...new Set([...s.matchAll(ISSUE_REF)].map((m) => Number(m[1])))];
  const c = pick(e.changed);
  if (c.length) return c.length === 1 ? c[0]! : null;
  const w = pick(e.why);
  return w.length === 1 ? w[0]! : null;
}

export async function traceLine(e: Entry, deps: TraceDeps): Promise<TraceRow[]> {
  const rows: TraceRow[] = [];
  for (const m of e.changed.matchAll(LANDING)) {
    const label = m[1]!;
    const sha = m[2]!;
    const repo = LANDING_REPOS[label as keyof typeof LANDING_REPOS];
    const landing = `${label}@${sha}`;
    const issue = issueOf(e);
    const fail = (code: TraceCode, detail: string): TraceRow => ({ seq: e.seq, landing, issue, status: "fail", code, detail });
    const gf = GRANDFATHERED[e.seq];
    if (gf !== undefined) {
      rows.push({ seq: e.seq, landing, issue, status: "grandfathered", detail: gf });
      continue;
    }
    if (issue === null) {
      rows.push(fail("T_NO_ISSUE", "no single PeaceAI-Workspace#N on the line"));
      continue;
    }
    rows.push(await traceOne(e.seq, landing, repo, sha, issue, deps, e.why));
  }
  return rows;
}

export const NOT_ATTEMPTED = "not attempted after a GitHub API rate limit";

/**
 * Fixed-text cause of a gh lookup failure (never the raw error text: output stays codes and fixed details only).
 * gh ends an API error with "(HTTP nnn)"; GitHub's primary and secondary limits both say "rate limit".
 */
export function lookupCause(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (msg.startsWith(NOT_ATTEMPTED)) return NOT_ATTEMPTED;
  const status = /\(HTTP (\d{3})\)/.exec(msg)?.[1];
  if (/rate limit/i.test(msg)) return `rate limited${status ? ` (HTTP ${status})` : ""}`;
  return status ? `HTTP ${status}` : "";
}
const because = (err: unknown): string => {
  const c = lookupCause(err);
  return c ? `: ${c}` : "";
};
/**
 * After the first rate-limited GitHub lookup, every later GitHub lookup fails at once (fail closed) instead of
 * spending ~150 more calls that would fail the same way. Local git deps (trees, stack) are untouched.
 */
export function stopAfterRateLimit(deps: TraceDeps): TraceDeps {
  let hit = false;
  const guard = <A extends unknown[], R>(f: (...a: A) => Promise<R>) => async (...a: A): Promise<R> => {
    if (hit) throw new Error(NOT_ATTEMPTED);
    try {
      return await f(...a);
    } catch (err) {
      if (lookupCause(err).startsWith("rate limited")) hit = true;
      throw err;
    }
  };
  return {
    ...deps,
    botComments: guard((issue: number) => deps.botComments(issue)),
    results: deps.results && guard((issue: number) => deps.results!(issue)),
    ...(deps.pullRequest ? { pullRequest: guard((repo: string, n: number) => deps.pullRequest!(repo, n)) } : {}),
    ...(deps.verdictPulls ? { verdictPulls: guard((repo: string, issue: number) => deps.verdictPulls!(repo, issue)) } : {}),
  };
}

async function traceOne(seq: number, landing: string, repo: string, sha: string, issue: number, deps: TraceDeps, why = ""): Promise<TraceRow> {
  const fail = (code: TraceCode, detail: string): TraceRow => ({ seq, landing, issue, status: "fail", code, detail });
  let bodies: string[];
  try {
    bodies = await deps.botComments(issue);
  } catch (err) {
    return fail("T_LOOKUP_FAILED", `issue comments lookup failed${because(err)}`);
  }
  const posted = bodies.filter((b) => b.replace(/\r\n/g, "\n").startsWith(PATCH_MARKER + "\n")).pop();
  if (!posted) {
    const pr = bodies.map((b) => PR_REPLY.exec(b.trim())).filter((m): m is RegExpExecArray => m !== null).pop();
    if (pr) return tracePr(seq, landing, repo, sha, issue, deps, why, pr[2]!, Number(pr[3]));
    // M89: Workspace self-landing. The reply carries no PR URL, so find the verdict PR by its branch.
    if (repo.toLowerCase() === WORKSPACE.toLowerCase() && bodies.some((b) => RIGHT_REPLY.test(b.trim()))) return traceByBranch(seq, landing, repo, sha, issue, deps, why);
    return fail("T_NO_PATCH_COMMENT", `#${issue} has no bot verdict patch comment`);
  }
  const comment: PatchComment | null = parsePatchComment(posted);
  if (!comment) return fail("T_PATCH_MALFORMED", `#${issue} patch comment is malformed`);
  if (comment.target.toLowerCase() !== repo.toLowerCase()) return fail("T_TARGET_MISMATCH", `patch target ${comment.target} is not ${repo}`);
  if (sha256(comment.patch) !== comment.patchSha256) return fail("T_HASH_MISMATCH", "patch sha256 does not match the posted value");
  if (deps.results) {
    let view: ResultsView;
    try {
      view = await deps.results(issue);
    } catch (err) {
      void err;
      return fail("T_RESULTS_UNREADABLE", "Results record missing or unreadable");
    }
    const reasons = verifyPatch({ comment, resultsDiff: view.resultsDiff, effectivePick: view.pick, latestRunId: view.latestRunId });
    if (view.target.toLowerCase() !== comment.target.toLowerCase()) reasons.push("target");
    if (reasons.length) {
      // Codes and hashes only: never Results bytes or reason prose derived from them.
      const rs = view.resultsDiff === null ? "none" : sha256(view.resultsDiff);
      return fail("T_HASH_MISMATCH", `H_RESULTS_VERIFY(${reasons.length}) patch-sha256 ${comment.patchSha256} diff-sha256 ${comment.diffSha256} results-diff-sha256 ${rs}`);
    }
  }
  let t: { applied: string | null; landing: string };
  try {
    t = await deps.trees(repo, sha, comment.patch);
  } catch (err) {
    void err;
    return fail("T_LOOKUP_FAILED", "git tree lookup failed");
  }
  if (t.applied === null) return fail("T_APPLY_FAILED", `patch does not apply to ${sha}^1`);
  if (t.applied !== t.landing) return fail("T_TREE_MISMATCH", `patch on ${sha}^1 gives ${t.applied.slice(0, 12)}, landing tree ${t.landing.slice(0, 12)}`);
  let stackNote = "";
  if (/\bstacked:/.test(why)) {
    const pv = parseProvenance(why);
    if (!pv) return fail("T_STACK_MISMATCH", "malformed or repeated stacked provenance clause");
    let st: { onto: string; via: string[] } | null;
    try {
      st = deps.stack ? await deps.stack(repo, sha, pv.base) : null;
    } catch (err) {
      void err;
      st = null;
    }
    if (!st) return fail("T_STACK_MISMATCH", "stacked chain could not be resolved");
    if (!st.onto.startsWith(pv.onto) || st.via.length !== pv.via.length || st.via.some((v, k) => !v.startsWith(pv.via[k]!)))
      return fail("T_STACK_MISMATCH", `landing ${sha}^1 / chain from ${pv.base} does not match the stacked clause`);
    stackNote = `, stacked on ${pv.onto} via ${pv.via.length}`;
  }
  const res = deps.results ? "Results verified" : "Results NOT checked (public mode)";
  return { seq, landing, issue, status: "ok", detail: `${comment.candidateId} run ${comment.runId}, ${res}, tree ${t.landing.slice(0, 12)}${stackNote}` };
}

/**
 * M89 Workspace self-landing route: the bot verdict reply names no PR URL, so list the Workspace PRs on this
 * issue's verdict branches (peace-task/issue-<n>-candidate-*). Exactly one may be merged as the landing; it is
 * then checked exactly like the M87 PR route (why names it once, branch, tree, Results pick). Read-only.
 */
async function traceByBranch(seq: number, landing: string, repo: string, sha: string, issue: number, deps: TraceDeps, why: string): Promise<TraceRow> {
  const fail = (code: TraceCode, detail: string): TraceRow => ({ seq, landing, issue, status: "fail", code, detail });
  if (!deps.verdictPulls || !deps.pullRequest) return fail("T_LOOKUP_FAILED", "no verdict branch lookup");
  const hits: number[] = [];
  try {
    const ns = [...new Set(await deps.verdictPulls(repo, issue))].filter((n) => Number.isInteger(n) && n > 0).sort((a, b) => a - b);
    for (const n of ns) {
      const pr = await deps.pullRequest(repo, n);
      const br = PR_BRANCH.exec(pr.headRef);
      if (br && Number(br[1]) === issue && pr.merged && pr.mergeCommit !== null && pr.mergeCommit.startsWith(sha)) hits.push(n);
    }
  } catch (err) {
    return fail("T_LOOKUP_FAILED", `verdict branch lookup for #${issue} failed${because(err)}`);
  }
  if (hits.length === 0) return fail("T_PR_MISMATCH", `no verdict branch PR for #${issue} is merged as ${sha}`);
  if (hits.length > 1) return fail("T_PR_MISMATCH", `${hits.length} verdict branch PRs for #${issue} are merged as ${sha}`);
  return tracePr(seq, landing, repo, sha, issue, deps, why, repo, hits[0]!);
}

/**
 * M87 PR route (#379): the verdict job opened PR <n> on the target; the landing must be that PR merged
 * (its merge commit), from this issue's verdict branch, named in `why` as "verdict PR <Label>#<n>".
 * The PR's diff applied to the landing's first parent must give the landing tree (squash or merge). With
 * Results: the branch candidate is the effective `right` pick and the Results candidate diff gives the same tree.
 */
async function tracePr(seq: number, landing: string, repo: string, sha: string, issue: number, deps: TraceDeps, why: string, prRepo: string, n: number): Promise<TraceRow> {
  const fail = (code: TraceCode, detail: string): TraceRow => ({ seq, landing, issue, status: "fail", code, detail });
  if (prRepo.toLowerCase() !== repo.toLowerCase()) return fail("T_TARGET_MISMATCH", `verdict PR repo ${prRepo} is not ${repo}`);
  const label = landing.split("@")[0]!;
  const named = [...why.matchAll(/\bverdict PR ([\w-]+)#(\d{1,9})\b/g)];
  if (named.length !== 1 || named[0]![1] !== label || Number(named[0]![2]) !== n) return fail("T_PR_MISMATCH", `why must name the verdict PR once as "verdict PR ${label}#${n}"`);
  if (!deps.pullRequest) return fail("T_LOOKUP_FAILED", "no pull request lookup");
  let pr: PullView;
  try {
    pr = await deps.pullRequest(repo, n);
  } catch (err) {
    return fail("T_LOOKUP_FAILED", `${label}#${n} lookup failed${because(err)}`);
  }
  if (!pr.merged || !pr.mergeCommit || !pr.mergeCommit.startsWith(sha)) return fail("T_PR_MISMATCH", `${label}#${n} is not merged as ${sha}`);
  const br = PR_BRANCH.exec(pr.headRef);
  if (!br || Number(br[1]) !== issue) return fail("T_PR_MISMATCH", `${label}#${n} head branch is not a verdict branch for #${issue}`);
  const tree = async (patch: string): Promise<TraceRow | string> => {
    let t: { applied: string | null; landing: string };
    try {
      t = await deps.trees(repo, sha, patch);
    } catch (err) {
      void err;
      return fail("T_LOOKUP_FAILED", "git tree lookup failed");
    }
    if (t.applied === null) return fail("T_APPLY_FAILED", `diff does not apply to ${sha}^1`);
    if (t.applied !== t.landing) return fail("T_TREE_MISMATCH", `diff on ${sha}^1 gives ${t.applied.slice(0, 12)}, landing tree ${t.landing.slice(0, 12)}`);
    return t.landing;
  };
  const prTree = await tree(pr.diff);
  if (typeof prTree !== "string") return prTree;
  if (deps.results) {
    let view: ResultsView;
    try {
      view = await deps.results(issue);
    } catch (err) {
      void err;
      return fail("T_RESULTS_UNREADABLE", "Results record missing or unreadable");
    }
    // Codes and hashes only: never Results bytes.
    if (view.target.toLowerCase() !== repo.toLowerCase() || !view.pick.decided || view.pick.candidateId !== br[2] || view.resultsDiff === null)
      return fail("T_HASH_MISMATCH", `H_RESULTS_PR pick/target does not match ${pr.headRef}`);
    const rt = await tree(view.resultsDiff);
    if (typeof rt !== "string") return { ...rt, code: "T_HASH_MISMATCH", detail: `H_RESULTS_PR results-diff-sha256 ${sha256(view.resultsDiff)}` };
  }
  const res = deps.results ? "Results verified" : "Results NOT checked (public mode)";
  return { seq, landing, issue, status: "ok", detail: `${br[2]} via ${label}#${n} (${pr.headRef}), ${res}, tree ${prTree.slice(0, 12)}` };
}

export async function traceAll(entries: readonly Entry[], deps: TraceDeps): Promise<TraceRow[]> {
  const rows: TraceRow[] = [];
  const guarded = stopAfterRateLimit(deps);
  for (const e of entries) if (e.by === "PeaceAI") rows.push(...(await traceLine(e, guarded)));
  return rows;
}

/** Errors: every failing row, plus any grandfather entry that names no landing line (stale list). */
export function traceErrors(entries: readonly Entry[], rows: readonly TraceRow[]): string[] {
  const errs = rows.filter((r) => r.status === "fail").map((r) => `${r.code}: seq ${r.seq} ${r.landing}${r.issue ? ` (#${r.issue})` : ""}: ${r.detail}`);
  for (const s of Object.keys(GRANDFATHERED).map(Number)) {
    if (!rows.some((r) => r.seq === s && r.status === "grandfathered")) errs.push(`T_STALE_GRANDFATHER: seq ${s} is not a by:PeaceAI landing line`);
  }
  void entries;
  return errs;
}

// ---- Real deps (gh CLI + local git clones). ----

// A rate-limited gh call is waited out and retried by the shared helper (peaceai/lib/gh-ratelimit.ts); any other
// failure, or a limit that cannot be waited out, throws the same error as before (and stopAfterRateLimit still stops).
const ghLimit = (err: unknown) => ghSignal(stderrOf(err), ghCoreProbe("gh"));
function gh(args: string[], retry: RateLimitRetry): string {
  return retry.runSync(() => {
    const r = spawnSync("gh", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    if (r.status !== 0) throw Object.assign(new Error(`gh ${args.slice(0, 2).join(" ")} failed: ${r.stderr.trim().slice(0, 200)}`), { stderr: r.stderr });
    return r.stdout;
  }, ghLimit);
}

/** results: "gh" reads Results read-only through gh (box), a directory reads a local clone (CI main job), null skips. */
export function makeGhDeps(clones: Record<string, string>, results: "gh" | { dir: string } | null, resultsRepo = "PeaceG03/PeaceAI-Results", retry: RateLimitRetry = new RateLimitRetry()): TraceDeps {
  const raw = (path: string): string | null => {
    if (results && results !== "gh") return existsSync(join(results.dir, path)) ? readFileSync(join(results.dir, path), "utf8") : null;
    try {
      return retry.runSync(() => {
        const r = spawnSync("gh", ["api", "-H", "Accept: application/vnd.github.raw+json", `repos/${resultsRepo}/contents/${path}`], {
          encoding: "utf8",
          maxBuffer: 64 * 1024 * 1024,
        });
        if (r.status !== 0) throw Object.assign(new Error("gh raw read failed"), { stderr: r.stderr });
        return r.stdout;
      }, ghLimit);
    } catch {
      return null;
    }
  };
  const names = (path: string): string[] => {
    if (results && results !== "gh") {
      const d = join(results.dir, path);
      if (!existsSync(d)) throw new Error(`Results path ${path} missing`);
      return readdirSync(d);
    }
    return gh(["api", `repos/${resultsRepo}/contents/${path}`, "--jq", ".[].name"], retry).split("\n").filter(Boolean);
  };
  return {
    async botComments(issue) {
      return gh(["api", "--paginate", `repos/${WORKSPACE}/issues/${issue}/comments?per_page=100`, "--jq", ".[] | {user: .user.login, body: .body}"], retry)
        .split("\n")
        .filter(Boolean)
        .map((l) => JSON.parse(l) as { user: string; body: string })
        .filter((c) => c.user === BOT)
        .map((c) => c.body);
    },
    results: results === null ? null : async (issue) => {
      const runs = names(`tasks/${issue}`).filter((n) => /^\d{1,20}$/.test(n));
      runs.sort((a, b) => (BigInt(a) < BigInt(b) ? -1 : 1));
      const latestRunId = runs[runs.length - 1] ?? null;
      if (!latestRunId) return { latestRunId, target: "", pick: { decided: false, candidateId: null }, resultsDiff: null };
      const dir = `tasks/${issue}/${latestRunId}`;
      const parse = <T>(text: string | null): T | null => {
        try {
          return JSON.parse(text ?? "null") as T;
        } catch {
          throw new Error("Results JSON malformed");
        }
      };
      const task = parse<TaskRecord>(raw(`${dir}/task.json`));
      if (!task) throw new Error("Results task record missing");
      const verdicts = names(`${dir}/verdicts`)
        .filter((n) => /^\d{1,20}\.json$/.test(n))
        .map((n) => parse<VerdictRecord>(raw(`${dir}/verdicts/${n}`)))
        .filter((v): v is VerdictRecord => v !== null);
      const pick = effectiveVerdict(verdicts).pick;
      const resultsDiff = pick.candidateId && /^candidate-\d{1,3}$/.test(pick.candidateId) ? raw(`${dir}/candidates/${pick.candidateId}.diff`) : null;
      return { latestRunId, target: task.target ?? WORKSPACE, pick, resultsDiff };
    },
    async stack(repo, sha, base) {
      const dir = clones[repo];
      if (!dir) throw new Error(`no local clone for ${repo}`);
      const g = (args: string[]) => execFileSync("git", ["-C", dir, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
      const full = g(["rev-parse", "--verify", `${base}^{commit}`]);
      const onto = g(["rev-parse", `${sha}^1`]);
      if (spawnSync("git", ["-C", dir, "merge-base", "--is-ancestor", full, onto]).status !== 0 || full === onto) return null;
      const all = g(["rev-list", "--reverse", `${full}..${onto}`]).split("\n").filter(Boolean);
      const fp = g(["rev-list", "--reverse", "--first-parent", `${full}..${onto}`]).split("\n").filter(Boolean);
      return all.join() === fp.join() ? { onto, via: all } : null;
    },
    async pullRequest(repo, n) {
      const j = JSON.parse(gh(["api", `repos/${repo}/pulls/${n}`, "--jq", "{merged: .merged, mergeCommit: .merge_commit_sha, headRef: .head.ref}"], retry)) as Omit<PullView, "diff">;
      const diff = gh(["api", "-H", "Accept: application/vnd.github.diff", `repos/${repo}/pulls/${n}`], retry);
      return { merged: j.merged === true, mergeCommit: j.mergeCommit ?? null, headRef: String(j.headRef), diff };
    },
    async verdictPulls(repo, issue) {
      // Read-only: closed and open PRs, filtered by the exact verdict-branch prefix for this issue.
      const prefix = `peace-task/issue-${issue}-candidate-`;
      return gh(["api", "--paginate", `repos/${repo}/pulls?state=all&per_page=100`, "--jq", ".[] | [.number, .head.ref] | @tsv"], retry)
        .split("\n")
        .filter(Boolean)
        .map((l) => l.split("\t"))
        .filter(([, ref]) => typeof ref === "string" && ref.startsWith(prefix))
        .map(([n]) => Number(n));
    },
    async trees(repo, sha, patch) {
      const dir = clones[repo];
      if (!dir) throw new Error(`no local clone for ${repo}`);
      const git = (args: string[], env?: NodeJS.ProcessEnv) =>
        execFileSync("git", ["-C", dir, ...args], { encoding: "utf8", env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] }).trim();
      const landing = git(["rev-parse", `${sha}^{tree}`]);
      const tmp = mkdtempSync(join(tmpdir(), "trace-"));
      try {
        const file = join(tmp, "p.patch");
        writeFileSync(file, patch);
        const env = { GIT_INDEX_FILE: join(tmp, "index") };
        git(["read-tree", `${sha}^1`], env);
        const ap = spawnSync("git", ["-C", dir, "apply", "--cached", file], { encoding: "utf8", env: { ...process.env, ...env } });
        if (ap.status !== 0) return { applied: null, landing };
        return { applied: git(["write-tree"], env), landing };
      } finally {
        rmSync(tmp, { recursive: true, force: true });
      }
    },
  };
}

// ---- CLI: tsx builder-log/trace.ts --clone owner/repo=DIR ... [--results-dir DIR | --no-results] ----
// Default reads Results through gh (box). CI: PR job runs --no-results (the Results key is main-only and
// every row says "Results NOT checked"); the push-to-main job clones Results read-only and passes --results-dir.
async function main(): Promise<void> {
  const entries = readFileSync(new URL("./tasks.jsonl", import.meta.url), "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Entry);
  const clones: Record<string, string> = {};
  process.argv.forEach((a, i) => {
    if (a === "--clone") {
      const [repo, dir] = (process.argv[i + 1] ?? "").split("=");
      if (repo && dir) clones[repo] = dir;
    }
  });
  // M89: Workspace self-landings trace against this checkout unless a Workspace clone is given.
  if (!clones[WORKSPACE]) clones[WORKSPACE] = fileURLToPath(new URL("..", import.meta.url));
  const ri = process.argv.indexOf("--results-dir");
  const results = process.argv.includes("--no-results") ? null : ri > 0 ? { dir: process.argv[ri + 1]! } : "gh";
  const rows = await traceAll(entries, makeGhDeps(clones, results));
  const untraced = entries.filter((e) => e.by === "PeaceAI" && !rows.some((r) => r.seq === e.seq));
  console.log("| seq | landing | issue | status | code | detail |\n|---|---|---|---|---|---|");
  for (const r of rows) console.log(`| ${r.seq} | ${r.landing} | ${r.issue ? `#${r.issue}` : "-"} | ${r.status} | ${r.code ?? ""} | ${r.detail.replace(/\|/g, "\\|")} |`);
  for (const e of untraced) console.log(`| ${e.seq} | (no repo@sha landing) | - | no landing | | ${e.changed.replace(/\|/g, "\\|")} |`);
  const errs = traceErrors(entries, rows);
  const skipped = rows.filter((r) => r.detail.endsWith(`: ${NOT_ATTEMPTED}`)).length;
  if (skipped) errs.unshift(`T_LOOKUP_FAILED: GitHub API rate limit hit; ${skipped} later landing lookup${skipped === 1 ? "" : "s"} not attempted (fail closed)`);
  if (errs.length) {
    console.error(errs.join("\n"));
    process.exit(1);
  }
  console.log(`\ntrace OK: ${rows.filter((r) => r.status === "ok").length} traced, ${rows.filter((r) => r.status === "grandfathered").length} grandfathered`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    void err;
    console.error("T_LOOKUP_FAILED: trace aborted");
    process.exit(1);
  });
}
