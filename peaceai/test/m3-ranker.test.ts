import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import type { SummaryCandidate } from "../lib/gate.ts";
import { isHeldOut, taskSource } from "../lib/policy.ts";
import type { CandidateResult } from "../lib/rank.ts";
import { EDIT_BUCKETS, extractFeatures, FEATURE_COUNT, FEATURE_NAMES, KEYWORD_BUCKETS } from "../lib/ranker/features.ts";
import { rankWithModel, train, validateModel } from "../lib/ranker/model.ts";
import {
  activeRanker, buildExamples, evaluate, isEvalExample, loadLatestModel, MIN_TRAIN_TASKS, pairsFor, promotion, runTraining,
  shadowRanking, trainExclusion, type Example,
} from "../lib/ranker/pipeline.ts";
import { buildRecords, stableJson, type TaskSource, type VerdictRecord } from "../lib/records.ts";
import { loadAll, taskDir, writeNew, writeSummary } from "../lib/store.ts";

const repo = resolve(import.meta.dirname, "../..");
const tsx = join(repo, "node_modules/.bin/tsx");
const BASE = "b".repeat(40);

// Synthetic diffs: candidate-1 is a tiny source-only change; candidate-2 is a different (distinct, M4.1)
// source edit plus a test file.
const smallDiff = "diff --git a/src/text.ts b/src/text.ts\n--- a/src/text.ts\n+++ b/src/text.ts\n@@ -1,1 +1,2 @@\n x\n+export const a = 1;\n";
const testedDiff =
  smallDiff.replace("+export const a = 1;\n", "+export const a = 1;\n+export const b = 2;\n") +
  "diff --git a/src/text.a.test.ts b/src/text.a.test.ts\nnew file mode 100644\n--- /dev/null\n+++ b/src/text.a.test.ts\n@@ -0,0 +1,4 @@\n" +
  '+import test from "node:test";\n+test("a", () => {\n+  assert.equal(a, 1);\n+});\n';
const sc = (id: string, lines: number, t: string[]): SummaryCandidate => ({ id, file: `candidates/${id}.diff`, transformations: t, operationId: null, diffBytes: lines * 20, diffLines: lines });
const res = (id: string, lines: number, newTestFiles: number): CandidateResult => ({ id, diffBytes: lines * 20, diffLines: lines, applied: true, typecheckPassed: true, originalSuitePassed: true, newTestsPassed: true, newTestFiles });
const verdict = (issue: number, runId: string, commentId: string, minute: number, label: string | null, candidateId: string | null, v: VerdictRecord["verdict"]): VerdictRecord => ({
  schema: "peaceai-results-verdict:v1", issue, runId, commentId, recordedAt: `2026-10-10T01:${String(minute).padStart(2, "0")}:00Z`, label, candidateId, verdict: v,
});

interface FixtureTask {
  issue: number;
  title?: string;
  runId?: string;
  source?: TaskSource;
  pick?: "tested" | "small" | "none" | null; // null = no verdict
  verdicts?: (labelOf: (id: string) => string) => [string | null, string | null, VerdictRecord["verdict"]][];
  single?: boolean;
}

/** Writes a Results checkout with one attempt per task; Peace prefers the candidate with tests. */
function fixture(tasks: readonly FixtureTask[]): string {
  const root = mkdtempSync(join(tmpdir(), "m3-results-"));
  for (const t of tasks) {
    const runId = t.runId ?? "1000";
    const summary = t.single ? [sc("candidate-1", 2, ["EDIT_ALPHA"])] : [sc("candidate-1", 2, ["EDIT_ALPHA"]), sc("candidate-2", 8, ["EDIT_ALPHA", "EDIT_BETA"])];
    const results = t.single ? [res("candidate-1", 2, 0)] : [res("candidate-1", 2, 0), res("candidate-2", 8, 1)];
    const rec = buildRecords(
      { issue: t.issue, runId, recordedAt: "2026-10-10T00:00:00Z", baseSha: BASE, title: t.title ?? `Add a helper number ${t.issue}`, body: "", source: t.source },
      summary, results, `seed-${t.issue}`,
    );
    const dir = taskDir(root, t.issue, runId);
    writeNew(join(dir, "task.json"), stableJson(rec.task));
    writeNew(join(dir, "ranking.json"), stableJson(rec.ranking));
    writeNew(join(dir, "candidates", "candidate-1.diff"), smallDiff);
    if (!t.single) writeNew(join(dir, "candidates", "candidate-2.diff"), testedDiff);
    const labelOf = (id: string) => rec.ranking.presentation.find((p) => p.id === id)!.label;
    let rows: [string | null, string | null, VerdictRecord["verdict"]][] = [];
    if (t.verdicts) rows = t.verdicts(labelOf);
    else if (t.pick === "tested") rows = [[labelOf("candidate-2"), "candidate-2", "right"]];
    else if (t.pick === "small") rows = [[labelOf("candidate-1"), "candidate-1", "right"]];
    else if (t.pick === "none") rows = [[null, null, "wrong"]];
    rows.forEach(([label, id, v], i) => writeNew(join(dir, "verdicts", `${t.issue}0${i}.json`), stableJson(verdict(t.issue, runId, `${t.issue}0${i}`, i, label, id, v))));
  }
  return root;
}

const trainIssues = (n: number, from = 100) => {
  const out: number[] = [];
  for (let i = from; out.length < n; i += 1) if (!isHeldOut(i)) out.push(i);
  return out;
};
const heldIssues = (n: number, from = 100) => {
  const out: number[] = [];
  for (let i = from; out.length < n; i += 1) if (isHeldOut(i)) out.push(i);
  return out;
};

test("features: deterministic, versioned width, values from records and diffs only, no vocabulary in names", () => {
  const rec = buildRecords({ issue: 7, runId: "1", recordedAt: "x", baseSha: BASE, title: "Normalize a title with focused tests", body: "" },
    [sc("candidate-1", 2, ["EDIT_ALPHA"]), sc("candidate-2", 8, ["EDIT_ALPHA", "EDIT_BETA"])], [res("candidate-1", 2, 0), res("candidate-2", 8, 1)], "s");
  const diffs = new Map([["candidate-1", smallDiff], ["candidate-2", testedDiff]]);
  const a = extractFeatures(rec.task, rec.ranking.candidates, diffs);
  const b = extractFeatures(rec.task, rec.ranking.candidates, diffs);
  assert.deepEqual(a, b);
  assert.equal(FEATURE_COUNT, FEATURE_NAMES.length);
  assert.equal(FEATURE_COUNT, 19 + EDIT_BUCKETS + KEYWORD_BUCKETS);
  for (const f of a) assert.equal(f.x.length, FEATURE_COUNT);
  const get = (id: string, name: string) => a.find((f) => f.id === id)!.x[FEATURE_NAMES.indexOf(name)];
  assert.equal(get("candidate-1", "files_touched"), 1);
  assert.equal(get("candidate-2", "files_touched"), 2);
  assert.equal(get("candidate-2", "new_files"), 1);
  assert.equal(get("candidate-2", "has_new_tests"), 1);
  assert.equal(get("candidate-2", "test_cases_added"), 1);
  assert.equal(get("candidate-2", "assertions_added"), 1);
  assert.equal(get("candidate-1", "is_smallest"), 1);
  assert.equal(get("candidate-2", "is_smallest"), 0);
  assert.equal(get("candidate-2", "diff_ratio_to_smallest"), 4);
  assert.equal(get("candidate-2", "requires_tests_x_has_tests"), 1);
  assert.equal(get("candidate-2", "log_added"), Math.log1p(6));
  assert.equal(get("candidate-1", "edit_count"), 1);
  assert.ok(FEATURE_NAMES.every((n) => /^[a-z_0-9]+$/.test(n) && !/alpha|beta/i.test(n)));
  // Missing diff (e.g. absent file) degrades to zero diff-derived counts, never throws.
  assert.equal(extractFeatures(rec.task, rec.ranking.candidates, new Map())[0]!.x[FEATURE_NAMES.indexOf("files_touched")], 0);
});

test("trainable filter: excludes held-out, test, withdrawn (unsure), superseded, none-wrong, single-candidate, undecided", () => {
  const [t1, t2, t3, t4, t5, t6, t7] = trainIssues(7);
  const [h1] = heldIssues(1);
  const root = fixture([
    { issue: t1!, pick: "tested" },
    { issue: t2!, title: "[test] Add x", pick: "tested" },
    { issue: t3!, verdicts: (l) => [[l("candidate-2"), "candidate-2", "right"], [l("candidate-2"), "candidate-2", "unsure"]] },
    { issue: t4!, pick: "none" },
    { issue: t5!, single: true, verdicts: () => [["A", "candidate-1", "right"]] },
    { issue: t6!, pick: null },
    { issue: t7!, runId: "900", pick: "tested" },
    { issue: t7!, runId: "1000", pick: null }, // newer attempt supersedes the reviewed one
    { issue: h1!, pick: "tested" },
  ]);
  const { examples, superseded } = buildExamples(root, loadAll(root));
  assert.equal(superseded, 1);
  const why = new Map(examples.map((x) => [x.issue, trainExclusion(x)]));
  assert.equal(why.get(t1!), null);
  assert.equal(why.get(t2!), "test");
  assert.equal(why.get(t3!), "withdrawn");
  assert.equal(why.get(t4!), "picked-none");
  assert.equal(why.get(t5!), "under-2-eligible");
  assert.equal(why.get(t6!), "undecided");
  assert.equal(why.get(t7!), "undecided");
  assert.equal(why.get(h1!), "held-out");
  const { metrics, model } = runTraining(examples, superseded);
  assert.equal(model, null);
  assert.equal(metrics.status, "insufficient data");
  assert.equal(metrics.counts.trainableTasks, 1);
  assert.deepEqual(metrics.counts.excluded, { test: 1, withdrawn: 1, "picked-none": 1, "under-2-eligible": 1, undecided: 2, "held-out": 1, superseded: 1 });
  // The summary agrees with the filter on what is trainable.
  // Summary trainable = latest decisive verdict standing; the ranker additionally needs a pairable pick.
  assert.equal(writeSummary(root).trainableTasks, 3); // t1, t4 (none wrong), t5 (single candidate)
});

test("training: seeded and reproducible; learns Peace's preference; beats the baseline on held-out", () => {
  const tasks: FixtureTask[] = [
    ...trainIssues(14).map((issue) => ({ issue, pick: "tested" as const })),
    ...trainIssues(4, 400).map((issue) => ({ issue, pick: "small" as const })),
    ...heldIssues(8).map((issue) => ({ issue, pick: "tested" as const })),
  ];
  const root = fixture(tasks);
  const { examples, superseded } = buildExamples(root, loadAll(root));
  const a = runTraining(examples, superseded);
  const b = runTraining(examples, superseded);
  assert.equal(a.metrics.status, "trained");
  assert.ok(a.metrics.counts.trainableTasks >= MIN_TRAIN_TASKS);
  assert.equal(stableJson(a.model), stableJson(b.model));
  assert.equal(stableJson(a.metrics), stableJson(b.metrics));
  assert.match(a.model!.version, /^ranker-v1-[0-9a-f]{12}$/);
  const c = runTraining(examples, superseded, { seed: "other" });
  assert.notEqual(c.model!.version, a.model!.version);
  assert.ok(validateModel(a.model));
  const held = a.metrics.heldOut.all;
  assert.equal(held.tasks, 8);
  assert.equal(held.status, "ok");
  assert.deepEqual(held.baseline, { counted: 8, agree: 0, rate: 0 }); // baseline picks the smallest diff
  assert.deepEqual(held.model, { counted: 8, agree: 8, rate: 1 });
  assert.equal(a.metrics.promotion.eligible, false); // too few trainable tasks for the rule
  assert.ok(a.metrics.promotion.reasons.some((r) => r.startsWith("trainable tasks")));
});

test("held-out eval: only 2+ eligible decided tasks count; none wrong counts as a miss; insufficient data below minimum", () => {
  const [h1, h2, h3, h4] = heldIssues(4);
  const root = fixture([
    { issue: h1!, pick: "tested" },
    { issue: h2!, pick: "none" },
    { issue: h3!, single: true, verdicts: () => [["A", "candidate-1", "right"]] },
    { issue: h4!, verdicts: (l) => [[l("candidate-1"), "candidate-1", "right"], [null, null, "unsure"]] },
  ]);
  const { examples } = buildExamples(root, loadAll(root));
  assert.deepEqual(examples.filter(isEvalExample).map((x) => x.issue), [h1, h2]);
  const e = evaluate(null, examples);
  assert.equal(e.all.status, "insufficient data");
  assert.deepEqual(e.all.baseline, { counted: 2, agree: 0, rate: 0 });
  assert.equal(e.all.model, null);
});

test("sources: filter and weight by source; metrics split by source", () => {
  const tasks: FixtureTask[] = [
    ...trainIssues(10).map((issue) => ({ issue, pick: "tested" as const, source: "builder" as const })),
    ...trainIssues(6, 500).map((issue) => ({ issue, pick: "tested" as const })),
    ...heldIssues(6).map((issue, i) => ({ issue, pick: "tested" as const, source: (i % 2 ? "builder" : "peace") as TaskSource })),
  ];
  const root = fixture(tasks);
  const { examples, superseded } = buildExamples(root, loadAll(root));
  const both = runTraining(examples, superseded);
  assert.deepEqual(both.metrics.counts.trainableBySource, { peace: 6, builder: 10 });
  assert.equal(both.metrics.heldOut.peace.tasks, 3);
  assert.equal(both.metrics.heldOut.builder.tasks, 3);
  const peaceOnly = runTraining(examples, superseded, { sources: ["peace"] });
  assert.equal(peaceOnly.metrics.counts.trainableTasks, 6);
  assert.equal(peaceOnly.metrics.counts.excluded["source-filtered"], 10);
  assert.equal(peaceOnly.metrics.status, "insufficient data");
  const weighted = pairsFor(examples.filter((x) => trainExclusion(x) === null), { builder: 0.5 });
  assert.ok(weighted.some((p) => p.weight === 0.5) && weighted.some((p) => p.weight === 1));
  assert.equal(taskSource(["peace-task", "source:builder"]), "builder");
  assert.equal(taskSource(["peace-task"]), "peace");
  const summary = writeSummary(root);
  assert.equal(summary.entries.filter((e) => e.source === "builder").length, 13);
  assert.ok("builder" in summary.agreementBySource && "peace" in summary.agreementBySource);
});

test("promotion rule: off unless every condition holds AND Peace sets PEACEAI_RANKER=model", () => {
  const ok = { status: "ok", tasks: 10, baseline: { counted: 10, agree: 4, rate: 0.4 }, model: { counted: 10, agree: 6, rate: 0.6 } };
  assert.equal(promotion(30, ok, true).eligible, true);
  assert.equal(promotion(29, ok, true).eligible, false);
  assert.equal(promotion(30, { ...ok, tasks: 9 }, true).eligible, false);
  assert.equal(promotion(30, { ...ok, model: { counted: 10, agree: 4, rate: 0.4 } }, true).eligible, false); // tie is not a win
  assert.equal(promotion(30, ok, false).eligible, false);
  assert.equal(activeRanker(undefined, true), "deterministic");
  assert.equal(activeRanker("", true), "deterministic");
  assert.equal(activeRanker("model", false), "deterministic");
  assert.equal(activeRanker("model", true), "model");
});

function jobCInputs(root: string, issue: number) {
  const work = mkdtempSync(join(tmpdir(), "m3-jobc-"));
  const inDir = join(work, "in");
  const testDir = join(work, "tests");
  mkdirSync(join(inDir, "candidates"), { recursive: true });
  mkdirSync(testDir);
  writeFileSync(join(inDir, "candidates", "candidate-1.diff"), smallDiff);
  writeFileSync(join(inDir, "candidates", "candidate-2.diff"), testedDiff);
  writeFileSync(join(inDir, "summary.json"), JSON.stringify({ schema: "peaceai-workspace-candidates:v1", taskId: `workspace-issue-${issue}`, baseSha: BASE, candidates: [sc("candidate-1", 2, ["EDIT_ALPHA"]), sc("candidate-2", 8, ["EDIT_ALPHA", "EDIT_BETA"])] }));
  writeFileSync(join(testDir, "c.json"), JSON.stringify({ schema: "peaceai-workspace-results:v1", taskId: `workspace-issue-${issue}`, baseSha: BASE, results: [res("candidate-1", 2, 0), res("candidate-2", 8, 1)] }));
  writeFileSync(join(work, "issue.json"), JSON.stringify({ number: issue, title: "Add a helper", body: "" }));
  const run = (extra: Record<string, string> = {}) => {
    const out = join(work, `out-${Math.random()}`);
    const r = spawnSync(tsx, [join(repo, "peaceai/bin/record-task.ts")], {
      cwd: repo, encoding: "utf8",
      env: { ...process.env, RESULTS_DIR: root, PEACEAI_IN_DIR: inDir, PEACEAI_TESTRESULTS_DIR: testDir, ISSUE_JSON: join(work, "issue.json"), RECORDED_AT: "2026-10-10T02:00:00Z", GITHUB_OUTPUT: out, ...extra },
    });
    assert.equal(r.status, 0, r.stderr);
    return { stdout: r.stdout, outputs: readFileSync(out, "utf8") };
  };
  return run;
}

test("shadow ranking: Job C records it with the model and nothing extra without one; the blind presentation is unchanged", () => {
  const empty = fixture([]);
  const issue = trainIssues(1, 700)[0]!;
  const noModel = jobCInputs(empty, issue)({ RUN_ID: "2001", TASK_SOURCE: "builder" });
  assert.match(noModel.stdout, /source=builder shadow=none/);
  const plain = JSON.parse(readFileSync(join(taskDir(empty, issue, "2001"), "ranking.json"), "utf8"));
  assert.equal("shadow" in plain, false);
  assert.equal("active" in plain, false);
  assert.equal(JSON.parse(readFileSync(join(taskDir(empty, issue, "2001"), "task.json"), "utf8")).source, "builder");

  // Train a model into a Results checkout via the training entry point, then rank again.
  const root = fixture([...trainIssues(12).map((i) => ({ issue: i, pick: "tested" as const })), ...heldIssues(5).map((i) => ({ issue: i, pick: "tested" as const }))]);
  const t = spawnSync(tsx, [join(repo, "peaceai/bin/train.ts")], { cwd: repo, encoding: "utf8", env: { ...process.env, RESULTS_DIR: root } });
  assert.equal(t.status, 0, t.stderr);
  assert.match(t.stdout, /^status=trained version=ranker-v1-[0-9a-f]{12} /);
  assert.doesNotMatch(t.stdout, /helper|EDIT_/); // logs carry counts only
  const loaded = loadLatestModel(root)!;
  assert.ok(loaded);
  const run = jobCInputs(root, issue);
  const withModel = run({ RUN_ID: "2002" });
  assert.match(withModel.stdout, /shadow=recorded/);
  const ranking = JSON.parse(readFileSync(join(taskDir(root, issue, "2002"), "ranking.json"), "utf8"));
  assert.equal(ranking.shadow.model, loaded.model.version);
  assert.equal(ranking.shadow.top, "candidate-2"); // learned: Peace prefers the tested candidate
  assert.equal(ranking.rankerTop, "candidate-1"); // deterministic stays authoritative
  assert.equal(ranking.active, "deterministic");
  assert.equal(ranking.activeTop, "candidate-1");
  // Even with the variable set, promotion needs the rule (not met here).
  const forced = run({ RUN_ID: "2003", PEACEAI_RANKER: "model" });
  assert.match(forced.stdout, /shadow=recorded/);
  assert.equal(JSON.parse(readFileSync(join(taskDir(root, issue, "2003"), "ranking.json"), "utf8")).active, "deterministic");
  // The public presentation output has labels and ids only: no scores, no shadow.
  const presentation = /presentation=(.*)/.exec(withModel.outputs)![1]!;
  assert.deepEqual(Object.keys(JSON.parse(presentation)[0]).sort(), ["id", "label"]);
  assert.doesNotMatch(withModel.outputs, /shadow|score/);
});

test("training entry point on an empty or sparse Results: insufficient data, metrics written, no model, no crash", () => {
  const root = fixture([{ issue: trainIssues(1)[0]!, pick: "tested" }]);
  const t = spawnSync(tsx, [join(repo, "peaceai/bin/train.ts")], { cwd: repo, encoding: "utf8", env: { ...process.env, RESULTS_DIR: root } });
  assert.equal(t.status, 0, t.stderr);
  assert.match(t.stdout, /^status=insufficient data /);
  const latest = JSON.parse(readFileSync(join(root, "models", "latest.json"), "utf8"));
  assert.equal(latest.hasModel, false);
  const metrics = JSON.parse(readFileSync(join(root, "models", latest.version, "metrics.json"), "utf8"));
  assert.equal(metrics.status, "insufficient data");
  assert.equal(metrics.heldOut.all.status, "insufficient data");
  assert.equal(existsSync(join(root, "models", latest.version, "model.json")), false);
  assert.equal(loadLatestModel(root), null);
  const bad = spawnSync(tsx, [join(repo, "peaceai/bin/train.ts")], { cwd: repo, encoding: "utf8", env: { ...process.env, RESULTS_DIR: root, PEACEAI_TRAIN_SOURCES: "everyone" } });
  assert.notEqual(bad.status, 0);
});

test("model ranking ties fall back to the deterministic order", () => {
  const m = train([], [], "s", "ranker-v1-000000000000");
  const items = [{ id: "candidate-2", x: new Array(FEATURE_COUNT).fill(0) }, { id: "candidate-1", x: new Array(FEATURE_COUNT).fill(0) }];
  assert.deepEqual(rankWithModel(m, items, ["candidate-1", "candidate-2"]).map((r) => r.id), ["candidate-1", "candidate-2"]);
  const ex = { features: items, baselineOrder: ["candidate-2", "candidate-1"] } as unknown as Example;
  assert.equal(rankWithModel(m, ex.features, ex.baselineOrder)[0]!.id, "candidate-2");
  assert.equal(shadowRanking(null, {} as never, {} as never, () => ""), null);
});
