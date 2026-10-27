// Fetches the task issue live and checks it is still an open, owner-authored, running peace-task.
// Removing the label (or closing the issue) therefore cancels the task before any core access.
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { STATE } from "../lib/queue.ts";
import { OWNER, TASK_LABEL } from "../lib/trigger.ts";
import { BUILDER_LABEL, type BodyProvenance } from "../lib/policy.ts";

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
// M119 (Job C only, ISSUE_PROVENANCE=1): the body's edit history (each revision's full text) and the label
// events, so the task source fails closed to builder when the credit line changed after the task was first
// labeled, or a source:builder label was ever added (lib/policy.ts recordedTaskSource). Any API failure records
// null, which also reads as builder. The labels are re-read here, at record time.
const PROVENANCE_QUERY = `query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) { issue(number: $number) {
    lastEditedAt
    userContentEdits(first: 100) { totalCount nodes { editedAt deletedAt diff } }
    timelineItems(itemTypes: [LABELED_EVENT], first: 100) { totalCount nodes { ... on LabeledEvent { createdAt label { name } } } }
  } } }`;
function provenance(): BodyProvenance | null {
  try {
    const [owner, name] = repo.split("/");
    const raw = JSON.parse(execFileSync("gh", ["api", "graphql", "-f", `query=${PROVENANCE_QUERY}`, "-F", `owner=${owner}`, "-F", `name=${name}`, "-F", `number=${number}`], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }));
    const i = raw?.data?.repository?.issue;
    if (!i) return null;
    const edits = i.userContentEdits, labels = i.timelineItems;
    const events: { createdAt: string; label?: { name?: string } }[] = labels?.nodes ?? [];
    return {
      lastEditedAt: i.lastEditedAt ?? null,
      edits: (edits?.nodes ?? []).map((n: { editedAt: string; deletedAt: string | null; diff: string | null }) => ({ editedAt: n?.editedAt, deletedAt: n?.deletedAt ?? null, body: typeof n?.diff === "string" ? n.diff : null })),
      editsComplete: Number.isInteger(edits?.totalCount) && edits.totalCount === (edits.nodes ?? []).length && Number.isInteger(labels?.totalCount) && labels.totalCount === events.length,
      taskLabeledAt: events.filter((n) => n?.label?.name === TASK_LABEL).map((n) => n.createdAt),
      builderLabeled: events.some((n) => typeof n?.label?.name === "string" && n.label.name.normalize("NFKC").replace(/[\u200B-\u200F\u2060\uFEFF]/g, "").trim().toLowerCase() === BUILDER_LABEL),
    };
  } catch {
    return null;
  }
}
const withProvenance = process.env.ISSUE_PROVENANCE === "1" ? { provenance: provenance() } : {};
writeFileSync(process.env.ISSUE_JSON ?? "", JSON.stringify({ number: issue.number, title: issue.title ?? "", body: issue.body ?? "", labels, ...withProvenance }));
if (process.env.ISSUE_PROVENANCE === "1") console.log(`body history ${withProvenance.provenance ? "fetched" : "unavailable (source fails closed to builder)"}`);
console.log(`task #${issue.number} is live`);
