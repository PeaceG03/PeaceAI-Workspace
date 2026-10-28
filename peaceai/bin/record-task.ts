// Job C: write the task record, candidates, test results and the blind ranking to a Results checkout.
// Runs no candidate code. Prints counts only; outputs the presentation (labels -> candidate ids, shuffled).
import { randomBytes } from "node:crypto";
import { appendFileSync, existsSync, readdirSync, readFileSync } from "node:fs";
import { regradeMismatch } from "../lib/regrade.ts";
import { join, resolve } from "node:path";
import { validateSummary, loadSummaryContext } from "../lib/gate.ts";
import { validateResults } from "../lib/results.ts";
import type { CandidateResult } from "../lib/rank.ts";
import { activeRanker, loadLatestModel, shadowRanking } from "../lib/ranker/pipeline.ts";
import { activeWithLm, latestLmDir, lmEvaluate, lmFlags, lmShadowRanking } from "../lib/lm.ts";
import { buildRecords, stableJson } from "../lib/records.ts";
import { bodySha256, recordedTaskSource } from "../lib/policy.ts";
import { isRepaired, validateRepairRecord, type StoredRepairRecord } from "../lib/repairrecord.ts";
import { appendIndex, loadAll, taskDir, writeNew, writeSummary } from "../lib/store.ts";

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
if (!validateSummary(summary, loadSummaryContext())) throw new Error("candidate summary failed validation");
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
// M7.1: which candidates carry a repaired diff (re-gated and used in Job B2).
const repairIn = join(testDir, "repair");
const repairRecords = new Map<string, StoredRepairRecord>();
for (const c of summary.candidates) {
  const p = join(repairIn, `${c.id}.json`);
  if (!existsSync(p)) continue;
  const r = JSON.parse(readFileSync(p, "utf8"));
  if (!validateRepairRecord(r) || r.id !== c.id) throw new Error(`${c.id}: repair record failed validation`);
  repairRecords.set(c.id, r);
}
const repairedIds = new Set([...repairRecords.values()].filter(isRepaired).map((r) => r.id));
const issue = JSON.parse(readFileSync(issueFile, "utf8"));
// M18: a regrade attempt records which attempt/candidate it regrades (old base -> this base, fresh grade below).
const regradeFile = join(inDir, "regrade.json");
const regradeRaw = existsSync(regradeFile) ? JSON.parse(readFileSync(regradeFile, "utf8")) : null;
// The candidate diff at Job A time is the original one (a repaired diff is not a regrade of the chosen diff).
const originalDiff = (f: string): string => {
  const orig = join(testDir, "repair", `${f.replace(/^candidates\//, "").replace(/\.diff$/, "")}.original.diff`);
  return readFileSync(existsSync(orig) ? orig : join(inDir, f), "utf8");
};
const regradeWhy = regradeRaw === null ? null : regradeMismatch(regradeRaw, summary, originalDiff);
if (regradeWhy) throw new Error(`regrade.json: ${regradeWhy}`);
const regrade = regradeRaw ? { regradeOf: regradeRaw } : {};
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
    // M119: the pick-time source, the labels re-read at record time and the full fetched body must all say peace,
    // no source:builder label ever, and the credit line unchanged since the first peace-task label; else builder.
    source: recordedTaskSource(process.env.TASK_SOURCE, issue.body, { labels: issue.labels, provenance: issue.provenance }),
    bodySha256: bodySha256(issue.body),
    ...(targetName ? { target: targetName } : {}),
    ...regrade,
  },
  summary.candidates,
  results,
  randomBytes(16).toString("hex"),
  diffOf,
  repairedIds,
);

// M3 shadow ranking: recorded next to the deterministic ranking, before any review output. Never shown.
const loaded = loadLatestModel(resultsRoot);
const shadow = loaded ? shadowRanking(loaded.model, records.task, records.ranking, diffOf) : null;
if (shadow) {
  records.ranking.shadow = shadow;
  records.ranking.active = activeRanker(process.env.PEACEAI_RANKER, loaded!.promotionEligible);
  records.ranking.activeTop = records.ranking.active === "model" ? shadow.top : records.ranking.rankerTop;
}

// M9: LM shadow score (flag PEACEAI_LM_SHADOW, off by default). Only a memcheck-verified model is used;
// any failure records nothing. Never shown; "lm" becomes active only with PEACEAI_RANKER=lm AND the rule met.
let lmStatus = "off";
if (lmFlags(process.env).shadow) {
  const lmDir = latestLmDir(resultsRoot);
  const lmShadow = lmDir ? lmShadowRanking(lmDir, records.ranking, diffOf) : null;
  lmStatus = lmShadow ? "recorded" : "none";
  if (lmShadow) {
    records.ranking.lmShadow = lmShadow;
    const active = activeWithLm(process.env.PEACEAI_RANKER, lmEvaluate(loadAll(resultsRoot), lmShadow.model).eligible, records.ranking.active ?? "deterministic");
    if (active === "lm") {
      records.ranking.active = "lm";
      records.ranking.activeTop = lmShadow.top;
    }
  }
}

const dir = taskDir(resultsRoot, issueNumber, runId);
writeNew(join(dir, "task.json"), stableJson(records.task));
for (const c of summary.candidates) writeNew(join(dir, c.file), readFileSync(join(inDir, c.file), "utf8"));
writeNew(join(dir, "ranking.json"), stableJson(records.ranking));
// M7: repair iterations (and the diff as generated, when a repaired diff replaced it), recorded with the task.
for (const [id, r] of repairRecords) {
  writeNew(join(dir, "repair", `${id}.json`), stableJson(r));
  const orig = join(repairIn, `${id}.original.diff`);
  if (existsSync(orig)) writeNew(join(dir, "repair", `${id}.original.diff`), readFileSync(orig, "utf8"));
}
appendIndex(resultsRoot, { type: "task", issue: issueNumber, runId, at: recordedAt, test: records.task.test, heldOut: records.task.heldOut });
writeSummary(resultsRoot);

const eligible = records.ranking.presentation.length;
const outputs = [`eligible=${eligible}`, `presentation=${JSON.stringify(records.ranking.presentation)}`];
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, outputs.join("\n") + "\n");
const eligibleAll = records.ranking.candidates.filter((c) => c.eligible).length;
console.log(`recorded candidates=${summary.candidates.length} eligible=${eligibleAll} distinct=${eligible} test=${records.task.test} held_out=${records.task.heldOut} requires_tests=${records.task.requiresTests} source=${records.task.source} shadow=${shadow ? "recorded" : "none"} lm_shadow=${lmStatus} repair_records=${repairRecords.size} repaired=${repairedIds.size}`);
