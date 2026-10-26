// Queue sweep: MODE=select marks stale runs failed, picks the oldest queued owner task and marks it
// running. MODE=count reports how many tasks are still waiting. Uses the GitHub CLI with GH_TOKEN.
import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { isCandidateIssue, labeledByOwner, pickNext, STATE, staleRunning, type LabelEvent, type QueueIssue } from "../lib/queue.ts";
import { BUILDER_LABEL, taskSource } from "../lib/policy.ts";
import { TASK_LABEL } from "../lib/trigger.ts";

const repo = process.env.GITHUB_REPOSITORY ?? "";
const mode = process.env.MODE ?? "select";
const gh = (...args: string[]) => execFileSync("gh", args, { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
const jsonLines = <T>(text: string): T[] => text.split("\n").filter(Boolean).map((l) => JSON.parse(l) as T);
const output = (pairs: Record<string, string | number>) => {
  const lines = Object.entries(pairs).map(([k, v]) => `${k}=${v}`);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, lines.join("\n") + "\n");
  console.log(lines.join(" "));
};

const issues = jsonLines<QueueIssue>(
  gh("api", "--paginate", `repos/${repo}/issues?state=open&labels=${TASK_LABEL}&per_page=100`, "--jq",
    '.[] | {number, state, author: .user.login, labels: [.labels[].name], isPullRequest: (.pull_request != null), body: (.body // "")} | tojson'),
);

if (mode === "count") {
  output({ waiting: issues.filter(isCandidateIssue).length });
  process.exit(0);
}

for (const label of Object.values(STATE)) gh("label", "create", label, "--repo", repo, "--color", "ededed", "--force");
gh("label", "create", BUILDER_LABEL, "--repo", repo, "--color", "c5def5", "--force", "--description", "peace-task opened by the Builder agent");

for (const n of staleRunning(issues)) {
  gh("issue", "edit", String(n), "--repo", repo, "--remove-label", STATE.running, "--add-label", STATE.failed);
  gh("issue", "comment", String(n), "--repo", repo, "--body", "PeaceAI: the previous run for this task stopped before finishing. Marked failed; remove `peaceai:failed` to retry.");
  const issue = issues.find((i) => i.number === n)!;
  issue.labels = issue.labels.filter((l) => l !== STATE.running).concat(STATE.failed);
}

const verified = new Set<number>();
for (const issue of issues.filter(isCandidateIssue).sort((a, b) => a.number - b.number)) {
  const events = jsonLines<LabelEvent>(
    gh("api", "--paginate", `repos/${repo}/issues/${issue.number}/events?per_page=100`, "--jq",
      '.[] | {event, label: .label.name, actor: .actor.login} | tojson'),
  );
  if (labeledByOwner(events)) {
    verified.add(issue.number);
    break; // oldest verified issue wins; later ones wait for the next sweep
  }
}
const picked = pickNext(issues, verified);
if (picked !== null)
  gh("issue", "edit", String(picked), "--repo", repo, "--add-label", STATE.running, "--remove-label", STATE.queued);
// Provenance decides the source (labels and the issue body's credit line), never the filer account.
const pickedIssue = picked === null ? null : issues.find((i) => i.number === picked)!;
const source = pickedIssue === null ? "" : taskSource(pickedIssue.labels, pickedIssue.body);
output({ issue: picked ?? "", source, waiting: issues.filter(isCandidateIssue).length });
