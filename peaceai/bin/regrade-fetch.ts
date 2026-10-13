// M18 Job A: if the newest PeaceAI bot comment on the task is a regrade request (not yet answered by a
// review), write it to REGRADE_FILE for generate.ts. Reads the issue only; no keys.
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { pendingRegrade } from "../lib/regrade.ts";

const repo = process.env.GITHUB_REPOSITORY ?? "";
const issue = process.env.ISSUE_NUMBER ?? "";
if (!/^[\w.-]+\/[\w.-]+$/.test(repo) || !/^\d{1,9}$/.test(issue)) throw new Error("bad inputs");
const r = spawnSync("gh", ["api", "--paginate", `repos/${repo}/issues/${issue}/comments?per_page=100`, "--jq", ".[] | {user: .user.login, body: .body} | tojson"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
if (r.status !== 0) throw new Error("gh api failed");
const comments = r.stdout.split("\n").filter(Boolean).map((l) => JSON.parse(l) as { user: string; body: string });
const req = pendingRegrade(comments);
if (req) {
  writeFileSync(process.env.REGRADE_FILE ?? "", JSON.stringify(req));
  console.log(`regrade=pending of_run=${req.runId} candidate=${req.candidateId} old_base=${req.baseSha.slice(0, 12)} diff_sha256=${req.diffSha256}`);
} else console.log("regrade=none");
