import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { editKey, normalizedEdit } from "../lib/dedupe.ts";
import type { SummaryCandidate } from "../lib/gate.ts";
import { isHeldOut } from "../lib/policy.ts";
import type { CandidateResult } from "../lib/rank.ts";
import { train } from "../lib/ranker/model.ts";
import { shadowRanking, toExample, trainExclusion } from "../lib/ranker/pipeline.ts";
import { buildRecords, buildSummary, distinctEligible, effectiveVerdict, taskEntry, type VerdictRecord } from "../lib/records.ts";
import { taskDir } from "../lib/store.ts";

const repo = resolve(import.meta.dirname, "../..");
const tsx = join(repo, "node_modules/.bin/tsx");
const BASE = "c".repeat(40);

const src = (line: string) =>
  `diff --git a/src/config.ts b/src/config.ts\nindex 1111111..2222222 100644\n--- a/src/config.ts\n+++ b/src/config.ts\n@@ -2,3 +2,4 @@\n export const LIMITS = {\n   pageSize: 20,\n+  ${line}\n };\n`;
const withTest = (diff: string, name = "a") =>
  diff +
  `diff --git a/src/config.${name}.test.ts b/src/config.${name}.test.ts\nnew file mode 100644\nindex 0000000..3333333\n--- /dev/null\n+++ b/src/config.${name}.test.ts\n@@ -0,0 +1,3 @@\n+import test from "node:test";\n+test("${name}", () => {});\n+\n`;

const EDIT_A = src("timeoutMs: 3000,");
const EDIT_B = src("retries: 2,");
const sc = (id: string, lines: number): SummaryCandidate => ({ id, file: `candidates/${id}.diff`, transformations: ["EDIT_X"], operationId: null, diffBytes: lines * 30, diffLines: lines });
const res = (id: string, lines: number, newTestFiles: number): CandidateResult => ({ id, diffBytes: lines * 30, diffLines: lines, applied: true, typecheckPassed: true, originalSuitePassed: true, newTestsPassed: true, newTestFiles });
const trainIssue = (from: number) => { let i = from; while (isHeldOut(i)) i += 1; return i; };
const right = (issue: number, label: string, candidateId: string): VerdictRecord => ({
  schema: "peaceai-results-verdict:v1", issue, runId: "1", commentId: "10", recordedAt: "2026-10-10T08:00:00Z", label, candidateId, verdict: "right",
});

function records(issue: number, title: string, diffs: Record<string, string>, tests: Record<string, number>) {
  const ids = Object.keys(diffs);
  const lines = (id: string) => diffs[id]!.split("\n").filter((l) => /^[+-](?![+-]{2} )/.test(l)).length;
  return buildRecords(
    { issue, runId: "1", recordedAt: "2026-10-10T08:00:00Z", baseSha: BASE, title, body: "" },
    ids.map((id) => sc(id, lines(id))),
    ids.map((id) => res(id, lines(id), tests[id] ?? 0)),
    "seed",
    (id) => diffs[id] ?? "",
  );
}

test("editKey: the non-test src edit decides; test files, index lines and trailing spaces do not", () => {
  assert.equal(editKey(EDIT_A), editKey(withTest(EDIT_A)));
  assert.equal(editKey(withTest(EDIT_A, "a")), editKey(withTest(EDIT_A, "b")));
  assert.equal(editKey(EDIT_A), editKey(EDIT_A.replace("index 1111111..2222222", "index 9999999..8888888").replace("3000,", "3000,  ")));
  assert.notEqual(editKey(EDIT_A), editKey(EDIT_B));
  assert.equal(normalizedEdit(withTest(EDIT_A)).includes("test.ts"), false);
});

test("identical edit with and without a test collapses to one presented candidate", () => {
  const issue = trainIssue(300);
  const { ranking } = records(issue, "Add property timeoutMs with value 3000 to object LIMITS", { "candidate-1": EDIT_A, "candidate-2": withTest(EDIT_A) }, { "candidate-2": 1 });
  assert.equal(ranking.candidates.filter((c) => c.eligible).length, 2);
  assert.equal(ranking.distinctEdits, 1);
  assert.equal(ranking.presentation.length, 1);
  // Task did not ask for tests: deterministic representative = the ranking's first (smallest diff).
  assert.equal(ranking.presentation[0]!.id, "candidate-1");
  assert.deepEqual(ranking.editGroups, [{ key: editKey(EDIT_A), representative: "candidate-1", members: ["candidate-1", "candidate-2"] }]);
  const dup = ranking.candidates.find((c) => c.id === "candidate-2")!;
  assert.equal(dup.duplicateOf, "candidate-1");
  assert.equal(dup.label, null);
  assert.equal(dup.rankPosition, null);
  assert.deepEqual(ranking.rankerOrder, ["candidate-1"]);
  assert.deepEqual(distinctEligible(ranking).map((c) => c.id), ["candidate-1"]);
});

test("when the task asks for tests, the member with tests represents the edit", () => {
  const { ranking } = records(trainIssue(310), "Add property timeoutMs with value 3000 to object LIMITS, with focused tests.",
    { "candidate-1": withTest(EDIT_A, "a"), "candidate-2": withTest(EDIT_A, "longer-name") }, { "candidate-1": 1, "candidate-2": 1 });
  assert.equal(ranking.requiresTests, true);
  assert.equal(ranking.distinctEdits, 1);
  const rep = ranking.presentation[0]!.id;
  assert.ok(ranking.candidates.find((c) => c.id === rep)!.newTestFiles > 0);
  // A group whose smaller member lacks tests still picks the tested one (the untested one is ineligible anyway).
  const mixed = records(trainIssue(320), "Add a thing, with focused tests.", { "candidate-1": EDIT_A, "candidate-2": withTest(EDIT_A) }, { "candidate-2": 1 }).ranking;
  assert.deepEqual(mixed.presentation.map((p) => p.id), ["candidate-2"]);
});

test("two distinct edits both count; one distinct edit is a single-candidate task for agreement and training", () => {
  const one = trainIssue(330);
  const two = trainIssue(one + 1);
  const single = records(one, "Add a setting", { "candidate-1": EDIT_A, "candidate-2": withTest(EDIT_A) }, { "candidate-2": 1 });
  const distinct = records(two, "Add a setting", { "candidate-1": EDIT_A, "candidate-2": withTest(EDIT_B) }, { "candidate-2": 1 });
  assert.equal(distinct.ranking.distinctEdits, 2);
  assert.equal(distinct.ranking.presentation.length, 2);

  const pickFirst = (r: typeof single) => [right(r.task.issue, r.ranking.presentation[0]!.label, r.ranking.presentation[0]!.id)];
  const e1 = taskEntry(single.task, single.ranking, pickFirst(single));
  const e2 = taskEntry(distinct.task, distinct.ranking, pickFirst(distinct));
  assert.equal(e1.eligible, 2);
  assert.equal(e1.distinctEdits, 1);
  assert.equal(e1.agree, null);
  assert.equal(e1.countsTowardAgreement, false);
  assert.equal(e2.distinctEdits, 2);
  assert.equal(e2.countsTowardAgreement, true);
  const summary = buildSummary([e1, e2]);
  assert.equal(summary.agreement.counted, 1);
  assert.equal(summary.singleEditTasks, 1);

  // Ranker: the single-edit task is excluded as under-2; the distinct one trains with exactly one pair.
  const x1 = toExample(single.task, single.ranking, effectiveVerdict(pickFirst(single)), (id) => ({ "candidate-1": EDIT_A, "candidate-2": withTest(EDIT_A) })[id] ?? "");
  const x2 = toExample(distinct.task, distinct.ranking, effectiveVerdict(pickFirst(distinct)), (id) => ({ "candidate-1": EDIT_A, "candidate-2": withTest(EDIT_B) })[id] ?? "");
  assert.equal(trainExclusion(x1), "under-2-eligible");
  assert.deepEqual(x1.eligible, ["candidate-1"]);
  assert.equal(trainExclusion(x2), null);
  assert.equal(x2.features.length, 2);

  // Shadow scoring ranks only distinct edits.
  const model = train([{ better: x2.features[0]!.x, worse: x2.features[1]!.x, weight: 1 }], x2.features.map((f) => f.x), "s", "ranker-v1-000000000000");
  const sh = shadowRanking(model, single.task, single.ranking, (id) => (id === "candidate-1" ? EDIT_A : withTest(EDIT_A)))!;
  assert.deepEqual(sh.order, ["candidate-1"]);
});

test("Job C records group membership and presents one candidate per distinct edit", () => {
  const work = mkdtempSync(join(tmpdir(), "m41-jobc-"));
  const root = join(work, "results");
  const inDir = join(work, "in");
  const testDir = join(work, "tests");
  mkdirSync(join(inDir, "candidates"), { recursive: true });
  mkdirSync(testDir);
  mkdirSync(root);
  const diffs: Record<string, string> = { "candidate-1": EDIT_A, "candidate-2": withTest(EDIT_A), "candidate-3": EDIT_B };
  for (const [id, d] of Object.entries(diffs)) writeFileSync(join(inDir, "candidates", `${id}.diff`), d);
  writeFileSync(join(inDir, "summary.json"), JSON.stringify({ schema: "peaceai-workspace-candidates:v1", taskId: "workspace-issue-5", baseSha: BASE, candidates: [sc("candidate-1", 1), sc("candidate-2", 4), sc("candidate-3", 1)] }));
  writeFileSync(join(testDir, "r.json"), JSON.stringify({ schema: "peaceai-workspace-results:v1", taskId: "workspace-issue-5", baseSha: BASE, results: [res("candidate-1", 1, 0), res("candidate-2", 4, 1), res("candidate-3", 1, 0)] }));
  writeFileSync(join(work, "issue.json"), JSON.stringify({ number: 5, title: "Add a setting", body: "" }));
  const out = join(work, "out");
  const r = spawnSync(tsx, [join(repo, "peaceai/bin/record-task.ts")], {
    cwd: repo, encoding: "utf8",
    env: { ...process.env, RESULTS_DIR: root, PEACEAI_IN_DIR: inDir, PEACEAI_TESTRESULTS_DIR: testDir, ISSUE_JSON: join(work, "issue.json"), RUN_ID: "3001", RECORDED_AT: "2026-10-10T08:00:00Z", GITHUB_OUTPUT: out },
  });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /eligible=3 distinct=2 /);
  const outputs = readFileSync(out, "utf8");
  assert.match(outputs, /^eligible=2$/m);
  const ranking = JSON.parse(readFileSync(join(taskDir(root, 5, "3001"), "ranking.json"), "utf8"));
  assert.equal(ranking.distinctEdits, 2);
  assert.deepEqual(ranking.presentation.map((p: { id: string }) => p.id).sort(), ["candidate-1", "candidate-3"]);
  assert.deepEqual(ranking.editGroups.find((g: { representative: string }) => g.representative === "candidate-1").members, ["candidate-1", "candidate-2"]);
  const summary = JSON.parse(readFileSync(join(root, "summary.json"), "utf8"));
  assert.equal(summary.entries[0].distinctEdits, 2);
});

test("pre-push scan covers every pushed commit: a core line in a middle commit blocks even if HEAD is clean", () => {
  const work = mkdtempSync(join(tmpdir(), "m41-prepush-"));
  const g = (cwd: string, ...args: string[]) => {
    const r = spawnSync("git", args, { cwd, encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    return r.stdout.trim();
  };
  const ident = ["-c", "user.name=T", "-c", "user.email=1+t@users.noreply.github.com"];
  const coreLine = "const fakeCoreMarkerValue = computeSomethingVeryDistinctive(alpha, beta, gamma);";
  const core = join(work, "core");
  mkdirSync(join(core, "lib"), { recursive: true });
  writeFileSync(join(core, "lib", "x.ts"), `${coreLine}\n`);
  g(core, "init", "-q");
  g(core, "add", ".");
  g(core, ...ident, "commit", "-qm", "core");
  const ws = join(work, "ws");
  mkdirSync(join(ws, "src"), { recursive: true });
  g(ws, "init", "-q");
  writeFileSync(join(ws, "src", "a.ts"), "export const a = 1;\n");
  g(ws, "add", ".");
  g(ws, ...ident, "commit", "-qm", "clean");
  const clean = g(ws, "rev-parse", "HEAD");
  writeFileSync(join(ws, "src", "a.ts"), `export const a = 1;\n${coreLine}\n`);
  g(ws, ...ident, "commit", "-qam", "leak");
  const leak = g(ws, "rev-parse", "HEAD");
  writeFileSync(join(ws, "src", "a.ts"), "export const a = 2;\n");
  g(ws, ...ident, "commit", "-qam", "fix");
  const fix = g(ws, "rev-parse", "HEAD");
  const scan = (shas: string[], extraEnv: Record<string, string> = {}) =>
    spawnSync(tsx, [join(repo, "peaceai/bin/prepush-scan.ts")], { cwd: ws, encoding: "utf8", input: shas.join("\n"), env: { ...process.env, PEACEAI_CORE_DIR: core, ...extraEnv } });
  const ok = scan([clean, fix]);
  assert.equal(ok.status, 0, ok.stdout);
  assert.match(ok.stdout, /PRE-PUSH PASS commits=2/);
  const blocked = scan([clean, leak, fix]);
  assert.equal(blocked.status, 1);
  assert.match(blocked.stdout, new RegExp(`PRE-PUSH FAIL ${leak.slice(0, 10)} src/a.ts: core text`));
  assert.doesNotMatch(blocked.stdout, /fakeCoreMarker/); // never prints the matched text
  // Non-noreply identity and a missing core checkout also block.
  writeFileSync(join(ws, "src", "b.ts"), "export const b = 1;\n");
  g(ws, "add", ".");
  g(ws, "-c", "user.name=T", "-c", "user.email=t@example.com", "commit", "-qm", "bad identity");
  assert.equal(scan([g(ws, "rev-parse", "HEAD")]).status, 1);
  assert.equal(scan([fix], { PEACEAI_CORE_DIR: join(work, "missing") }).status, 1);
});
