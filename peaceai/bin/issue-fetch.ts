// Fetches the task issue live and checks it is still an open, owner-authored, running peace-task.
// Removing the label (or closing the issue) therefore cancels the task before any core access.
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { STATE } from "../lib/queue.ts";
import { OWNER, TASK_LABEL } from "../lib/trigger.ts";

const repo = process.env.GITHUB_REPOSITORY ?? "";
const number = String(process.env.ISSUE_NUMBER ?? "");
if (!/^\d{1,9}$/.test(number)) throw new Error("invalid issue number");
const issue = JSON.parse(execFileSync("gh", ["api", `repos/${repo}/issues/${number}`], { encoding: "utf8" }));
const labels: string[] = (issue.labels ?? []).map((l: { name: string }) => l.name);
const live = issue.state === "open" && !issue.pull_request && issue.user?.login === OWNER && labels.includes(TASK_LABEL) && labels.includes(STATE.running);
if (!live) {
  console.log("task is no longer an open, owner-labeled, running peace-task; stopping");
  process.exit(1);
}
writeFileSync(process.env.ISSUE_JSON ?? "", JSON.stringify({ number: issue.number, title: issue.title ?? "", body: issue.body ?? "" }));
console.log(`task #${issue.number} is live`);
