// Fetches the task issue live and checks it is still an open, owner-authored, running peace-task.
// Removing the label (or closing the issue) therefore cancels the task before any core access.
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { STATE } from "../lib/queue.ts";
import { OWNER, TASK_LABEL } from "../lib/trigger.ts";
import type { BodyProvenance } from "../lib/policy.ts";

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
// M119 (Job C only, ISSUE_PROVENANCE=1): the body's edit history and the peace-task label events, so the task
// source fails closed to builder when the body was edited after the task was labeled (lib/policy.ts
// bodyUnchangedSinceLabel). Any API failure records null, which also reads as builder.
const PROVENANCE_QUERY = `query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) { issue(number: $number) {
    lastEditedAt
    userContentEdits(first: 100) { totalCount nodes { editedAt } }
    timelineItems(itemTypes: [LABELED_EVENT], first: 100) { totalCount nodes { ... on LabeledEvent { createdAt label { name } } } }
  } } }`;
function provenance(): BodyProvenance | null {
  try {
    const [owner, name] = repo.split("/");
    const raw = JSON.parse(execFileSync("gh", ["api", "graphql", "-f", `query=${PROVENANCE_QUERY}`, "-F", `owner=${owner}`, "-F", `name=${name}`, "-F", `number=${number}`], { encoding: "utf8" }));
    const i = raw?.data?.repository?.issue;
    if (!i) return null;
    const edits = i.userContentEdits, labels = i.timelineItems;
    return {
      lastEditedAt: i.lastEditedAt ?? null,
      editTimes: (edits?.nodes ?? []).map((n: { editedAt: string }) => n?.editedAt),
      editsComplete: Number.isInteger(edits?.totalCount) && edits.totalCount === (edits.nodes ?? []).length && Number.isInteger(labels?.totalCount) && labels.totalCount === (labels.nodes ?? []).length,
      taskLabeledAt: (labels?.nodes ?? []).filter((n: { label?: { name?: string } }) => n?.label?.name === TASK_LABEL).map((n: { createdAt: string }) => n.createdAt),
    };
  } catch {
    return null;
  }
}
const withProvenance = process.env.ISSUE_PROVENANCE === "1" ? { provenance: provenance() } : {};
writeFileSync(process.env.ISSUE_JSON ?? "", JSON.stringify({ number: issue.number, title: issue.title ?? "", body: issue.body ?? "", ...withProvenance }));
if (process.env.ISSUE_PROVENANCE === "1") console.log(`body history ${withProvenance.provenance ? "fetched" : "unavailable (source fails closed to builder)"}`);
console.log(`task #${issue.number} is live`);
