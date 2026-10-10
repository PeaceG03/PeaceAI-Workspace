// PR job: rank passing candidates, write the PR body and the chosen diff path for the workflow.
import { randomBytes } from "node:crypto";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { validateSummary } from "../lib/gate.ts";
import { planPullRequest, validateResults } from "../lib/prbody.ts";
import { parseDiff } from "../lib/diff.ts";
import { checkCandidateScope } from "../lib/scope.ts";
import { execFileSync } from "node:child_process";

const candidatesDir = resolve(process.env.PEACEAI_IN_DIR ?? "");
const resultsPath = resolve(process.env.PEACEAI_RESULTS_FILE ?? "");
const bodyPath = resolve(process.env.PEACEAI_BODY_FILE ?? "");
const issueNumber = (process.env.ISSUE_NUMBER ?? "").replace(/[^0-9]/g, "");

const summary = JSON.parse(readFileSync(join(candidatesDir, "summary.json"), "utf8"));
const results = JSON.parse(readFileSync(resultsPath, "utf8"));
if (!validateSummary(summary) || !validateResults(results) || results.baseSha !== summary.baseSha)
  throw new Error("candidate summary or results failed validation");
const diffs = new Map<string, string>();
for (const c of summary.candidates) diffs.set(c.id, readFileSync(join(candidatesDir, c.file), "utf8"));
// Defense in depth: every candidate shown or applied must still satisfy the scope rules.
const baseFiles = new Set(
  execFileSync("git", ["ls-tree", "-r", "--name-only", "-z", summary.baseSha], { encoding: "utf8" }).split("\0").filter(Boolean),
);
for (const [id, diff] of diffs)
  if (checkCandidateScope(parseDiff(diff), baseFiles).length > 0) throw new Error(`${id} failed the scope re-check`);
const plan = planPullRequest(results, diffs, issueNumber, randomBytes(16).toString("hex"));
writeFileSync(bodyPath, plan.body);
const outputs = [
  `passing=${plan.passing}`,
  `chosen_diff=${plan.chosenId ? join(candidatesDir, `candidates/${plan.chosenId}.diff`) : ""}`,
  `base_sha=${summary.baseSha}`,
];
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, outputs.join("\n") + "\n");
console.log(outputs.slice(0, 1).join(" "));
