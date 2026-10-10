// Job C: write the task record, candidates, test results and the blind ranking to a Results checkout.
// Runs no candidate code. Prints counts only; outputs the presentation (labels -> candidate ids, shuffled).
import { randomBytes } from "node:crypto";
import { appendFileSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { validateSummary } from "../lib/gate.ts";
import { validateResults } from "../lib/results.ts";
import type { CandidateResult } from "../lib/rank.ts";
import { buildRecords, stableJson } from "../lib/records.ts";
import { appendIndex, taskDir, writeNew, writeSummary } from "../lib/store.ts";

const env = (name: string) => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
};
const resultsRoot = resolve(env("RESULTS_DIR"));
const inDir = resolve(env("PEACEAI_IN_DIR"));
const testDir = resolve(env("PEACEAI_TESTRESULTS_DIR"));
const issueFile = resolve(env("ISSUE_JSON"));
const runId = env("RUN_ID");
const recordedAt = env("RECORDED_AT");

const summary = JSON.parse(readFileSync(join(inDir, "summary.json"), "utf8"));
if (!validateSummary(summary)) throw new Error("candidate summary failed validation");
const results: CandidateResult[] = [];
for (const file of readdirSync(testDir).filter((f) => f.endsWith(".json")).sort()) {
  const parsed = JSON.parse(readFileSync(join(testDir, file), "utf8"));
  if (!validateResults(parsed) || parsed.baseSha !== summary.baseSha) throw new Error(`${file} failed validation`);
  results.push(...parsed.results);
}
const ids = new Set(summary.candidates.map((c) => c.id));
if (results.some((r) => !ids.has(r.id)) || new Set(results.map((r) => r.id)).size !== results.length)
  throw new Error("test results do not match the candidates");

const issue = JSON.parse(readFileSync(issueFile, "utf8"));
const issueNumber = Number(issue.number);
const records = buildRecords(
  {
    issue: issueNumber,
    runId,
    recordedAt,
    baseSha: summary.baseSha,
    title: String(issue.title ?? "").slice(0, 300),
    body: String(issue.body ?? "").slice(0, 4000),
  },
  summary.candidates,
  results,
  randomBytes(16).toString("hex"),
);

const dir = taskDir(resultsRoot, issueNumber, runId);
writeNew(join(dir, "task.json"), stableJson(records.task));
for (const c of summary.candidates) writeNew(join(dir, c.file), readFileSync(join(inDir, c.file), "utf8"));
writeNew(join(dir, "ranking.json"), stableJson(records.ranking));
appendIndex(resultsRoot, { type: "task", issue: issueNumber, runId, at: recordedAt, test: records.task.test, heldOut: records.task.heldOut });
writeSummary(resultsRoot);

const eligible = records.ranking.presentation.length;
const outputs = [`eligible=${eligible}`, `presentation=${JSON.stringify(records.ranking.presentation)}`];
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, outputs.join("\n") + "\n");
console.log(`recorded candidates=${summary.candidates.length} eligible=${eligible} test=${records.task.test} held_out=${records.task.heldOut} requires_tests=${records.task.requiresTests}`);
