// M82: scheduled catch-up for approval PRs whose landing job (approve-rule-pr.sh) gave up waiting, usually because
// Peace's "Approve and run" on the held pull_request runs came after its deadline. Run by the approval-catchup job
// of peace-approve-rule.yml on the hourly schedule (or a manual dispatch). For each open PR the bot opened from a
// peaceai-approve-rule/ branch it re-reads everything from the API and asks catchupDecision (lib/approval.ts):
// one bot commit changing only the list, exactly one commit ahead, main's list unchanged since, the single new
// entry re-verified from Peace's /approve-rule comment against the proposal and the spec sha on main, the commit
// message exactly what approve-rule.ts writes, the required check-runs (leak-check, tamper-proof, tests) green on
// the exact head and no pull_request run on it held, running or failed. Only then it squash-merges with
// --match-head-commit, at most one PR per pass. It never pushes, never updates a branch, never approves, cancels
// or re-runs a workflow run, never edits or closes a PR it refuses. Prints fixed strings and numbers only.
// Needs GH_TOKEN and GITHUB_REPOSITORY. PEACEAI_GH may name a stand-in gh binary (tests only).
import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { APPROVAL_BRANCH_PREFIX, BOT_LOGIN, LIST_PATH, catchupDecision, type CatchupInput } from "../lib/approval.ts";

const repo = process.env.GITHUB_REPOSITORY ?? "";
if (!/^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/.test(repo)) throw new Error("GITHUB_REPOSITORY is required");
const ghBin = process.env.PEACEAI_GH || "gh";
const rulesDir = resolve(process.env.PEACEAI_RULES_DIR ?? "peaceai/rules/learned");
const gh = (...args: string[]): string => execFileSync(ghBin, args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 32 << 20 });
const api = (path: string): any => JSON.parse(gh("api", path));
const raw = (path: string, ref: string): string => gh("api", "-H", "Accept: application/vnd.github.raw", `repos/${repo}/contents/${path}?ref=${encodeURIComponent(ref)}`);
const log = (line: string) => { console.log(line); if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `- ${line}\n`); };

const open = (api(`repos/${repo}/pulls?state=open&base=main&per_page=100`) as any[])
  .filter((p) => typeof p?.head?.ref === "string" && p.head.ref.startsWith(APPROVAL_BRANCH_PREFIX) && p?.user?.login === BOT_LOGIN)
  .sort((a, b) => a.number - b.number);
log(`approval catch-up: ${open.length} open approval PR(s)`);
let failed = false;
for (const p of open) {
  const n = Number(p.number);
  try {
    const sha = String(p.head.sha);
    if (!/^[0-9a-f]{40}$/.test(sha)) { log(`#${n}: refuse NOT_APPROVAL_PR`); continue; }
    const commits = (api(`repos/${repo}/pulls/${n}/commits?per_page=100`) as any[]).map((c) => ({
      sha: String(c.sha), parents: (c.parents ?? []).map((x: any) => String(x.sha)),
      authorName: String(c.commit?.author?.name ?? ""), authorEmail: String(c.commit?.author?.email ?? ""), committerEmail: String(c.commit?.committer?.email ?? ""), message: String(c.commit?.message ?? ""),
    }));
    const files = (api(`repos/${repo}/pulls/${n}/files?per_page=100`) as any[]).map((f) => String(f.filename));
    const compare = api(`repos/${repo}/compare/main...${sha}`);
    const parent = commits.length === 1 && commits[0]!.parents.length === 1 ? commits[0]!.parents[0]! : "";
    const input: CatchupInput = {
      repo, now: Date.now(),
      pr: { number: n, user: String(p.user?.login ?? ""), headRef: String(p.head.ref), headRepo: String(p.head?.repo?.full_name ?? ""), baseRef: String(p.base?.ref ?? ""), draft: p.draft === true, createdAt: String(p.created_at ?? ""), headSha: sha },
      commits, files, aheadBy: Number(compare.ahead_by),
      mainListText: raw(LIST_PATH, "main"),
      parentListText: /^[0-9a-f]{40}$/.test(parent) ? raw(LIST_PATH, parent) : "",
      headListText: raw(LIST_PATH, sha),
      approval: (id) => {
        if (!Number.isSafeInteger(id) || id <= 0) return null;
        try {
          const c = api(`repos/${repo}/issues/comments/${id}`);
          const m = /\/issues\/([1-9][0-9]*)$/.exec(String(c.issue_url ?? ""));
          if (!m) return null;
          const i = api(`repos/${repo}/issues/${m[1]}`);
          return {
            comment: { id: Number(c.id), body: String(c.body ?? ""), user: String(c.user?.login ?? ""), association: String(c.author_association ?? ""), url: String(c.html_url ?? ""), createdAt: String(c.created_at ?? ""), issue: Number(m[1]) },
            issue: { number: Number(i.number), labels: (i.labels ?? []).map((l: any) => String(l?.name ?? l)), body: String(i.body ?? ""), isPull: !!i.pull_request },
          };
        } catch { return null; }
      },
      spec: (id) => {
        if (!/^public-[a-z0-9-]+$/.test(id)) return null;
        const f = join(rulesDir, `${id}.json`);
        try { return existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : null; } catch { return null; }
      },
      checkRuns: ((api(`repos/${repo}/commits/${sha}/check-runs?per_page=100`).check_runs ?? []) as any[]).map((k) => ({ id: Number(k.id), name: String(k.name), status: String(k.status), conclusion: k.conclusion == null ? null : String(k.conclusion) })),
      prRuns: ((api(`repos/${repo}/actions/runs?head_sha=${sha}&event=pull_request&per_page=100`).workflow_runs ?? []) as any[]).map((k) => ({ id: Number(k.id), event: String(k.event), headSha: String(k.head_sha), headBranch: String(k.head_branch), status: String(k.status), conclusion: k.conclusion == null ? null : String(k.conclusion) })),
    };
    const d = catchupDecision(input);
    if (d.action !== "merge") { log(`#${n}: ${d.action} ${d.reason}`); continue; }
    try {
      gh("pr", "merge", String(n), "--repo", repo, "--squash", "--delete-branch", "--match-head-commit", d.sha, "--subject", d.subject, "--body", d.body);
    } catch { log(`#${n}: merge refused at ${d.sha.slice(0, 12)}; not merged`); failed = true; break; }
    log(`#${n}: merged ${d.entry.id} at ${d.sha.slice(0, 12)} by the scheduled catch-up`);
    try { gh("pr", "comment", String(n), "--repo", repo, "--body", `Landed by the scheduled approval catch-up: the landing job had given up, and this pass re-verified the approval (one bot commit changing only the list, main's list unchanged since, \`${d.entry.id}\` re-validated against its /approve-rule and the spec sha on main, required checks and pull_request runs green on ${d.sha}) before squash-merging this exact commit.`); } catch { log(`#${n}: could not comment`); }
    break; // main's list just changed: any other approval PR is stale until the next pass re-reads it.
  } catch { log(`#${n}: error reading the PR state; not merged`); }
}
if (failed) process.exit(1);
