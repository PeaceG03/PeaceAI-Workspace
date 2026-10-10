// M7.1: green comes only from harness-captured exit codes; dedupe runs on Job B2's final set; repaired
// candidates and placeholder values are flagged (review note, Results `repaired`, ranker feature).
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { buildRecords, distinctEligible, taskEntry } from "../lib/records.ts";
import { parseTapFailures } from "../lib/repair.ts";
import { runRepairLoop } from "../lib/repairloop.ts";
import { hasPlaceholder, isRepaired } from "../lib/repairrecord.ts";
import { extractFeatures, FEATURE_NAMES, FEATURE_VERSION } from "../lib/ranker/features.ts";
import { PLACEHOLDER_NOTE, reviewBody } from "../lib/review.ts";
import { WORKSPACE_SCOPE } from "../lib/scope.ts";
import { taskDir } from "../lib/store.ts";
import { buildIndex } from "../lib/symbols.ts";
import { b2Fixture, harnessFixture, repo, runB2, runJobB, THEME, tsx } from "./m7-fixtures.ts";

// ---- 1. green is the exit code, not the text

const FAKE_PASS_TEST = [
  'import test from "node:test";',
  "// Prints a convincing pass, then fails through the exit code only.",
  'process.stdout.write("TAP version 13\\nok 1 - everything passes\\n1..1\\n# tests 1\\n# pass 1\\n# fail 0\\n");',
  'test("looks fine", () => {',
  '  console.log("ok 2 - also fine\\n# pass 2\\n# fail 0");',
  "  process.exitCode = 1;",
  "});",
  "",
].join("\n");

test("a new test that prints a fake pass but exits non-zero is never green, never repaired-to-green", () => {
  const fx = harnessFixture();
  const diff = fx.candidate({ "src/theme.ts": `${THEME}export const RETRIES = 3;\n`, "src/theme.RETRIES.test.ts": FAKE_PASS_TEST });
  const { results, repairOf, out, stdout } = runJobB(fx, [diff]);
  assert.equal(results[0].typecheckPassed, true);
  assert.equal(results[0].newTestsPassed, false, "final pass: exit code decides");
  const rec = repairOf("candidate-1");
  assert.notEqual(rec.stop, "GREEN");
  assert.notEqual(rec.stop, "NOT_NEEDED");
  assert.equal(rec.repairedDiffSha256, null);
  assert.equal(rec.iterations[0].newTests, false);
  assert.match(stdout, /candidate-1 repair stop=NO_RULE/);
  assert.equal(JSON.stringify(readFileSync(join(out, "r.json"), "utf8")).includes('"newTestsPassed": true'), false);
});

test("the loop's green is the Evaluation booleans only: pass-looking text with a failing exit code stays red", () => {
  const fakeText = "TAP version 13\nok 1 - fine\n# pass 1\n# fail 0\n";
  assert.deepEqual(parseTapFailures(fakeText, "/x"), []); // no "pass" signal is ever produced from text
  const r = runRepairLoop({
    evaluate: () => ({ typecheck: true, originalSuite: true, newTests: false, errors: parseTapFailures(fakeText, "/x") }),
    context: () => ({ index: buildIndex([]), read: () => null, base: () => null, isSource: WORKSPACE_SCOPE.isSource, isTest: WORKSPACE_SCOPE.isTest }),
    apply: () => true,
    now: () => 0,
  }, { maxRounds: 3, deadlineMs: 1000 });
  assert.equal(r.stop, "NO_RULE");
  assert.equal(r.changed, false);
});

// ---- 2. dedupe on the final (post-repair) set

test("two candidates that become the same edit after repair are ONE distinct edit for review, training and agreement", () => {
  const b = b2Fixture('accent: "",', { twin: true });
  const final = runB2(b);
  assert.equal(final.rec.regate, "pass");
  const finalDiff2 = readFileSync(join(b.final, "candidates", "candidate-2.diff"), "utf8");
  assert.equal(final.diff, finalDiff2, "after repair both diffs are the same edit");
  assert.notEqual(readFileSync(join(b.inDir, "candidates", "candidate-1.diff"), "utf8"), finalDiff2, "they differed as generated");
  const work = b.fx.dir;
  const root = join(work, "results");
  mkdirSync(root);
  writeFileSync(join(work, "issue.json"), JSON.stringify({ number: 8, title: "Add a field accent of type string to type Theme", body: "" }));
  const r = spawnSync(tsx, [join(repo, "peaceai/bin/record-task.ts")], {
    cwd: repo, encoding: "utf8",
    env: { ...process.env, RESULTS_DIR: root, PEACEAI_IN_DIR: b.final, PEACEAI_TESTRESULTS_DIR: join(b.final, "testresults"), ISSUE_JSON: join(work, "issue.json"), RUN_ID: "8001", RECORDED_AT: "2026-10-10T23:00:00Z", GITHUB_OUTPUT: join(work, "out") },
  });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /eligible=2 distinct=1 /);
  assert.match(r.stdout, /repaired=1/);
  const dir = taskDir(root, 8, "8001");
  const ranking = JSON.parse(readFileSync(join(dir, "ranking.json"), "utf8"));
  const task = JSON.parse(readFileSync(join(dir, "task.json"), "utf8"));
  assert.equal(ranking.distinctEdits, 1);
  assert.equal(ranking.presentation.length, 1); // review shows one
  assert.deepEqual(ranking.editGroups[0].members, ["candidate-1", "candidate-2"]);
  assert.equal(distinctEligible(ranking).length, 1); // training and shadow scoring use this helper
  assert.equal(taskEntry(task, ranking, []).distinctEdits, 1); // agreement
  // 3. every candidate's Results record says whether it is repaired
  assert.deepEqual(ranking.candidates.map((c: { id: string; repaired: boolean }) => [c.id, c.repaired]), [["candidate-1", true], ["candidate-2", false]]);
});

// ---- 3. placeholders and the repaired flag

test("review: a neutral placeholder note for that candidate only; everything else identical", () => {
  const presentation = [{ label: "A", id: "candidate-1" }, { label: "B", id: "candidate-2" }];
  const diffs = new Map([["candidate-1", "d1"], ["candidate-2", "d2"]]);
  const plain = reviewBody(presentation, diffs);
  const noted = reviewBody(presentation, diffs, null, "pr", new Map([["candidate-2", PLACEHOLDER_NOTE]]));
  assert.equal(PLACEHOLDER_NOTE, "placeholder value added by repair");
  assert.equal((noted.match(/placeholder value added by repair/g) ?? []).length, 1);
  assert.match(noted, /### Candidate B\n\nNote: placeholder value added by repair\.\n\n<details>/);
  assert.equal(noted.replace("Note: placeholder value added by repair.\n\n", ""), plain);
  assert.ok(!/repair/i.test(plain));
});

test("review-comment: the note comes from a re-gated repair record with a placeholder edit", () => {
  const b = b2Fixture('accent: "",', { twin: true });
  runB2(b);
  const body = join(b.fx.dir, "review.md");
  const r = spawnSync(tsx, [join(repo, "peaceai/bin/review-comment.ts")], {
    cwd: repo, encoding: "utf8",
    env: { ...process.env, PEACEAI_IN_DIR: b.final, PEACEAI_BODY_FILE: body, PRESENTATION: JSON.stringify([{ label: "A", id: "candidate-2" }, { label: "B", id: "candidate-1" }]), PEACEAI_TARGET: "" },
  });
  assert.equal(r.status, 0, r.stderr);
  const text = readFileSync(body, "utf8");
  assert.match(text, /### Candidate B\n\nNote: placeholder value added by repair\.\n\n/);
  assert.match(text, /### Candidate A\n\n<details>/);
});

test("placeholder and repaired helpers: only a re-gated repair counts; ALIGN/import edits are not placeholders", () => {
  const it = (applied: { rule: string; placeholder?: true }[]) => [{ round: 0, applied }];
  const rec = (regate: string | undefined, applied: { rule: string; placeholder?: true }[]) => ({ regate, iterations: it(applied) }) as never;
  assert.equal(hasPlaceholder(rec("pass", [{ rule: "ADD_MISSING_REQUIRED_PROPERTY", placeholder: true }])), true);
  assert.equal(hasPlaceholder(rec("core-gate-rejected", [{ rule: "ADD_MISSING_REQUIRED_PROPERTY", placeholder: true }])), false);
  assert.equal(hasPlaceholder(rec("pass", [{ rule: "ALIGN_ADDED_CONSTANT" }, { rule: "ADD_MISSING_IMPORT" }])), false);
  assert.equal(isRepaired(rec("pass", [])), true);
  assert.equal(isRepaired(rec(undefined, [])), false);
});

test("ranker features v2 carry a `repaired` flag; records carry repaired true|false when Job C knows it", () => {
  assert.equal(FEATURE_VERSION, "features:v2");
  const sc = (id: string) => ({ id, file: `candidates/${id}.diff`, transformations: ["EDIT_X"], operationId: null, diffBytes: 30, diffLines: 1 });
  const res = (id: string) => ({ id, diffBytes: 30, diffLines: 1, applied: true, typecheckPassed: true, originalSuitePassed: true, newTestsPassed: true, newTestFiles: 0 });
  const recs = buildRecords({ issue: 9, runId: "1", recordedAt: "x", baseSha: "c".repeat(40), title: "t", body: "" }, [sc("candidate-1"), sc("candidate-2")], [res("candidate-1"), res("candidate-2")], "s", undefined, new Set(["candidate-2"]));
  assert.deepEqual(recs.ranking.candidates.map((c) => c.repaired), [false, true]);
  const f = extractFeatures(recs.task, recs.ranking.candidates, new Map());
  const i = FEATURE_NAMES.indexOf("repaired");
  assert.ok(i >= 0);
  assert.deepEqual(f.map((x) => x.x[i]), [0, 1]);
  // Older records (no flag) read as not repaired.
  const old = buildRecords({ issue: 9, runId: "1", recordedAt: "x", baseSha: "c".repeat(40), title: "t", body: "" }, [sc("candidate-1")], [res("candidate-1")], "s");
  assert.equal("repaired" in old.ranking.candidates[0]!, false);
  assert.equal(extractFeatures(old.task, old.ranking.candidates, new Map())[0]!.x[i], 0);
});
