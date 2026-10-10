// Job C: write the task record, candidates, test results and the blind ranking to a Results checkout.
// Runs no candidate code. Prints counts only; outputs the presentation (labels -> candidate ids, shuffled).
import { randomBytes } from "node:crypto";
import { appendFileSync, existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { validateSummary } from "../lib/gate.ts";
import { validateResults } from "../lib/results.ts";
import type { CandidateResult } from "../lib/rank.ts";
import { activeRanker, loadLatestModel, shadowRanking } from "../lib/ranker/pipeline.ts";
import { buildRecords, stableJson } from "../lib/records.ts";
import { validateRepairRecord } from "../lib/repairrecord.ts";
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

const diffOf = (id: string): string => {
  const c = summary.candidates.find((x) => x.id === id);
  return c ? readFileSync(join(inDir, c.file), "utf8") : "";
};
const issue = JSON.parse(readFileSync(issueFile, "utf8"));
const issueNumber = Number(issue.number);
// M5: the target is recorded with the task; the verdict job opens the PR there.
const targetName = /^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}$/.test(process.env.TASK_TARGET ?? "") ? process.env.TASK_TARGET! : "";
const records = buildRecords(
  {
    issue: issueNumber,
    runId,
    recordedAt,
    baseSha: summary.baseSha,
    title: String(issue.title ?? "").slice(0, 300),
    body: String(issue.body ?? "").slice(0, 4000),
    source: process.env.TASK_SOURCE === "builder" ? "builder" : "peace",
    ...(targetName ? { target: targetName } : {}),
  },
  summary.candidates,
  results,
  randomBytes(16).toString("hex"),
  diffOf,
);

// M3 shadow ranking: recorded next to the deterministic ranking, before any review output. Never shown.
const loaded = loadLatestModel(resultsRoot);
const shadow = loaded ? shadowRanking(loaded.model, records.task, records.ranking, diffOf) : null;
if (shadow) {
  records.ranking.shadow = shadow;
  records.ranking.active = activeRanker(process.env.PEACEAI_RANKER, loaded!.promotionEligible);
  records.ranking.activeTop = records.ranking.active === "model" ? shadow.top : records.ranking.rankerTop;
}

const dir = taskDir(resultsRoot, issueNumber, runId);
writeNew(join(dir, "task.json"), stableJson(records.task));
for (const c of summary.candidates) writeNew(join(dir, c.file), readFileSync(join(inDir, c.file), "utf8"));
writeNew(join(dir, "ranking.json"), stableJson(records.ranking));
// M7: repair iterations (and the diff as generated, when a repaired diff replaced it), recorded with the task.
let repairRecords = 0;
const repairIn = join(testDir, "repair");
for (const c of summary.candidates) {
  const p = join(repairIn, `${c.id}.json`);
  if (!existsSync(p)) continue;
  const r = JSON.parse(readFileSync(p, "utf8"));
  if (!validateRepairRecord(r) || r.id !== c.id) throw new Error(`${c.id}: repair record failed validation`);
  writeNew(join(dir, "repair", `${c.id}.json`), stableJson(r));
  const orig = join(repairIn, `${c.id}.original.diff`);
  if (existsSync(orig)) writeNew(join(dir, "repair", `${c.id}.original.diff`), readFileSync(orig, "utf8"));
  repairRecords++;
}
appendIndex(resultsRoot, { type: "task", issue: issueNumber, runId, at: recordedAt, test: records.task.test, heldOut: records.task.heldOut });
writeSummary(resultsRoot);

const eligible = records.ranking.presentation.length;
const outputs = [`eligible=${eligible}`, `presentation=${JSON.stringify(records.ranking.presentation)}`];
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, outputs.join("\n") + "\n");
const eligibleAll = records.ranking.candidates.filter((c) => c.eligible).length;
console.log(`recorded candidates=${summary.candidates.length} eligible=${eligibleAll} distinct=${eligible} test=${records.task.test} held_out=${records.task.heldOut} requires_tests=${records.task.requiresTests} source=${records.task.source} shadow=${shadow ? "recorded" : "none"} repair_records=${repairRecords}`);
