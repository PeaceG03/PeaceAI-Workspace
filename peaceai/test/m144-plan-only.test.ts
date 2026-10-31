// M144 PLAN-ONLY mode v1 (peaceai/spec/plan-only-v1.md): task-file validation, the training-data exclusion
// (Auditor's condition), the lock requirement, the planner's can-do / missing marking on a fixture repository, the
// grader's math, the public log's row validator (no URL, no free text) and its add-only rule. Offline: the fetcher is
// a fixture, so no test touches the network. Also: plan-only from another cwd or a worktree with no node_modules.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { approvedRules, CAPABILITIES, planTask, sha256, taskFileProblem, trainingRepos, type Plan, type PlanTask, type PlanTaskFile } from "../lib/plan.ts";
import { addOnlyProblem, gradePlan, isLocked, LOCK_SCHEMA, logRowProblem, parseLog, RUN_LOG, RUN_SCHEMA, taskKey } from "../lib/plangrade.ts";
import { runFile, runTask, type Checkout, type Fetcher } from "../lib/planrun.ts";
import { loadTargets } from "../lib/target.ts";
import { typescriptEntry } from "../lib/tsresolve.ts";
import type { IndexFile } from "../lib/symbols.ts";

const repo = resolve(import.meta.dirname, "..", "..");
const read = (p: string) => readFileSync(join(repo, p), "utf8");
const PUBLIC = "peaceai/plan/tasks-public-v1.json";
const publicText = read(PUBLIC);
const publicFile = JSON.parse(publicText) as PlanTaskFile;
const H40 = "a".repeat(40);
const LICENSE = "MIT License\n";

const FIXTURE: IndexFile[] = [
  { path: "LICENSE", content: LICENSE },
  { path: "package.json", content: JSON.stringify({ scripts: { test: "vitest run" } }) },
  { path: "src/index.ts", content: "export { clampRange } from \"./range.ts\";\nexport { greet } from \"./greet.ts\";\n" },
  { path: "src/range.ts", content: "/** Clamps a number into [lo, hi]. */\nexport function clampRange(value: number, lo: number, hi: number): number {\n  if (value < lo) return lo;\n  return value;\n}\n" },
  { path: "src/greet.ts", content: "export function greet(name: string): string {\n  return `hello ${name}`;\n}\n" },
  { path: "test/range.test.ts", content: "import { clampRange } from \"../src/range.ts\";\nclampRange(1, 0, 2);\n" },
];
const fixtureTask = (over: Partial<PlanTask> = {}): PlanTask => ({
  id: "fixture-clamp", repo: "example-org/fixture-lib", license: "MIT", licensePath: "LICENSE", licenseSha256: sha256(LICENSE), commit: H40,
  request: "`clampRange` returns values above `hi` unchanged; it should clamp them to `hi` as well. Fix it and add a test.",
  tests: { command: "vitest run test/range.test.ts", files: ["test/range.test.ts"] },
  reference: { from: { pr: 1, merge: "b".repeat(40) }, files: [{ path: "src/range.ts", change: "modify" }, { path: "test/range.test.ts", change: "modify" }], steps: [{ action: "edit-source", file: "src/range.ts", symbols: ["clampRange"] }, { action: "edit-test", file: "test/range.test.ts" }, { action: "run-tests", file: null }], docs: [] },
  trainingCheck: { workspaceCommit: H40, sources: 1, inTraining: false },
  ...over,
});
let fetches = 0;
const fixtureFetcher = (files = FIXTURE, head = H40, dirty = false): Fetcher => () => {
  fetches++;
  return { head, files: files.filter((f) => /\.tsx?$/.test(f.path)), read: (p) => files.find((f) => f.path === p)?.content ?? null, unchanged: () => !dirty, close: () => {} } satisfies Checkout;
};
const opts = (over: Record<string, unknown> = {}) => ({ root: repo, fetcher: fixtureFetcher(), outDir: mkdtempSync(join(tmpdir(), "m144-out-")), rules: approvedRules(repo), training: new Set<string>(), ...over });

test("M144: the public task file is valid, pinned, permissive, and about 8-12 tasks with no repo or org dominating", () => {
  assert.equal(taskFileProblem(publicFile), null);
  assert.equal(publicFile.set, "public");
  assert.ok(publicFile.tasks.length >= 8 && publicFile.tasks.length <= 12);
  const perRepo = new Map<string, number>();
  const perOrg = new Map<string, number>();
  for (const t of publicFile.tasks) {
    perRepo.set(t.repo, (perRepo.get(t.repo) ?? 0) + 1);
    perOrg.set(t.repo.split("/")[0]!, (perOrg.get(t.repo.split("/")[0]!) ?? 0) + 1);
    assert.match(t.commit, /^[0-9a-f]{40}$/);
    assert.match(t.reference.from.merge, /^[0-9a-f]{40}$/);
  }
  assert.ok(Math.max(...perRepo.values()) <= 2, "no repo has more than 2 tasks");
  assert.ok(Math.max(...perOrg.values()) <= Math.ceil(publicFile.tasks.length / 3), "no org has more than a third");
  assert.equal(/[^\x00-\x7f]/.test(publicText), false, "ASCII only");
});

test("M144 (Auditor's condition): no public task repo is in PeaceAI's training lists, checked live", () => {
  const { repos, sources } = trainingRepos(repo);
  assert.ok(sources > 10 && repos.size > 40, "the training lists were read");
  for (const id of ["peaceg03/peacestocks", "peaceg03/peaceai-workspace"]) assert.ok(repos.has(id), `${id} is a training source`);
  for (const t of publicFile.tasks) {
    assert.equal(repos.has(t.repo.toLowerCase()), false, `${t.repo} must not be a training source`);
    assert.equal(t.trainingCheck.inTraining, false);
  }
  // PeaceSTOCKS and the Workspace are training sources, so no task may target them.
  for (const t of publicFile.tasks) assert.equal(Object.prototype.hasOwnProperty.call(loadTargets().targets, t.repo), false);
});

test("M144: the training check fails closed on an unreadable list", () => {
  const root = mkdtempSync(join(tmpdir(), "m144-train-"));
  try {
    mkdirSync(join(root, "peaceai/model"), { recursive: true });
    writeFileSync(join(root, "peaceai/model/sources.json"), JSON.stringify({ sources: [{ name: "Some-Org/Some-Repo" }] }));
    assert.ok(trainingRepos(root).repos.has("some-org/some-repo"));
    writeFileSync(join(root, "peaceai/model/broken.json"), "{");
    assert.throws(() => trainingRepos(root), /training_list_unreadable/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("M144: the runner refuses a task whose repo is in the training lists, before fetching anything", () => {
  fetches = 0;
  const r = runTask(fixtureTask({ repo: "PeaceG03/PeaceSTOCKS" }), "public", "c".repeat(64), opts({ training: trainingRepos(repo).repos }));
  assert.equal(r.row.code, "TRAINING_OVERLAP");
  assert.equal(r.row.grade, null);
  assert.equal(fetches, 0);
  const r2 = runTask(fixtureTask({ repo: "Example-Org/Fixture-Lib" }), "public", "c".repeat(64), opts({ training: new Set(["example-org/fixture-lib"]) }));
  assert.equal(r2.row.code, "TRAINING_OVERLAP", "case-insensitive");
});

test("M144: a task file runs only when its sha256 lock row is in the committed log", () => {
  const dir = mkdtempSync(join(tmpdir(), "m144-lock-"));
  try {
    const file: PlanTaskFile = { schema: "peaceai-plan-tasks:v1", set: "hidden", tasks: [fixtureTask()] };
    const path = join(dir, "never-seen.json");
    const text = JSON.stringify(file);
    writeFileSync(path, text);
    const fileSha = sha256(text);
    const lock = JSON.stringify({ schema: LOCK_SCHEMA, at: "2026-10-30T00:00:00Z", set: "hidden", taskFileSha256: fileSha, tasks: 1 }) + "\n";
    assert.equal(runFile(path, { committed: "", root: dir }).code, "TASK_FILE_UNLOCKED");
    assert.equal(isLocked(lock, fileSha), true);
    // A locked file whose bytes changed is a different sha: unlocked again.
    writeFileSync(path, text + " ");
    assert.equal(runFile(path, { committed: lock, root: dir }).code, "TASK_FILE_UNLOCKED");
    // Locked and unchanged: runs, and the hidden row names no repo or commit.
    writeFileSync(path, text);
    mkdirSync(join(dir, "peaceai/plan"), { recursive: true });
    const out = runFile(path, { committed: lock, root: dir, fetcher: fixtureFetcher(), training: new Set(), rules: approvedRules(repo), outDir: join(dir, "out") });
    assert.equal(out.code, "OK");
    assert.equal(out.rows.length, 1);
    assert.equal(out.rows[0]!.code, "OK");
    assert.equal(out.rows[0]!.grader, "plan-grade-v2");
    assert.equal("repo" in out.rows[0]!, false);
    assert.equal("commit" in out.rows[0]!, false);
    assert.equal(out.rows[0]!.taskKey, taskKey(fileSha, "fixture-clamp"));
    const logged = readFileSync(join(dir, RUN_LOG), "utf8");
    assert.equal(logged.includes("fixture"), false, "the log never carries task text or ids");
    assert.equal("problem" in parseLog(lock + logged), false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("M144: the planner finds the files, marks missing steps by capability, and never claims an unverified can-do", () => {
  const plan = planTask("fixture-clamp", fixtureTask().request, { repo: "example-org/fixture-lib", files: FIXTURE.filter((f) => f.path.endsWith(".ts")), rules: approvedRules(repo), model: null, testCommand: "vitest run" });
  assert.deepEqual(plan.files.map((f) => [f.path, f.role]), [["src/range.ts", "source"], ["test/range.test.ts", "test"]]);
  assert.deepEqual(plan.steps.map((s) => s.action), ["edit-source", "edit-test", "run-tests"]);
  for (const s of plan.steps) {
    if (s.status === "missing") assert.ok((CAPABILITIES as readonly string[]).includes(s.missing!));
    else assert.ok(s.rule);
  }
  assert.equal(plan.steps[2]!.missing, "run-target-tests", "Job B runs only targets.json repos");
  // An add request names the add capability; an unfound source names locate-code.
  const add = planTask("x", "Add a new `greet` option for a custom greeting and export it from the package index.", { repo: "example-org/fixture-lib", files: FIXTURE.filter((f) => f.path.endsWith(".ts")), rules: [], model: null, testCommand: null });
  assert.equal(add.steps[0]!.missing, "add-function-or-member");
  assert.ok(add.files.some((f) => f.path === "src/index.ts"), "entry re-export");
  const none = planTask("y", "Make the frobnicator quieter when it is overloaded.", { repo: "o/r", files: [{ path: "a.ts", content: "export const x = 1;\n" }], rules: [], model: null, testCommand: null });
  assert.equal(none.steps.find((s) => s.action === "add-test")!.missing, "add-test-file");
});

test("M144: plan-only changes nothing in the target; a changed checkout is TARGET_CHANGED", () => {
  const ok = runTask(fixtureTask(), "public", "c".repeat(64), opts());
  assert.equal(ok.row.code, "OK");
  assert.equal(runTask(fixtureTask(), "public", "c".repeat(64), opts({ fetcher: fixtureFetcher(FIXTURE, H40, true) })).row.code, "TARGET_CHANGED");
  assert.equal(runTask(fixtureTask(), "public", "c".repeat(64), opts({ fetcher: fixtureFetcher(FIXTURE, "d".repeat(40)) })).row.code, "COMMIT_MISMATCH");
  assert.equal(runTask(fixtureTask({ licenseSha256: "e".repeat(64) }), "public", "c".repeat(64), opts()).row.code, "LICENSE_CHANGED");
});

// Grader v2 (plan-grade-v2): Auditor FAILed v1 at b90cddd for inflating the score.
const gTask = fixtureTask();
const gStep = (action: Plan["steps"][number]["action"], file: string | null, status: "can-do" | "missing", rule: string | null = null) => ({ n: 0, action, file, symbol: null, status, rule, objective: rule ? "obj" : null, missing: status === "missing" ? ("locate-code" as const) : null });
const gPlan = (steps: Plan["steps"], files: string[], tests: string[], command: string | null = null): Plan => ({ schema: "peaceai-plan:v1", planner: "plan-only-v1", taskId: gTask.id, understanding: { clauses: 1, intents: [], parse: "x", anchors: [] }, files: files.map((path) => ({ path, role: "source", reason: "" })), steps, tests: { files: tests, command } });
const EXACT = gPlan([gStep("edit-source", "src/range.ts", "missing"), gStep("edit-test", "test/range.test.ts", "missing"), gStep("run-tests", null, "missing")], ["src/range.ts", "test/range.test.ts"], ["test/range.test.ts"]);

test("M144: grader math (score over work steps, run-tests apart, can-do accuracy, own and team shares)", () => {
  const g = gradePlan(gPlan([gStep("edit-source", "src/range.ts", "missing"), gStep("edit-test", "test/wrong.test.ts", "missing"), gStep("run-tests", null, "can-do", "pipeline:job-b-tests")], ["src/range.ts", "test/wrong.test.ts"], ["test/wrong.test.ts"]), gTask, [], []);
  assert.equal(g.required, 2, "run-tests is not a work step");
  assert.equal(g.planned, 2);
  assert.equal(g.matched, 1);
  assert.equal(g.score, 0.5);
  assert.equal(g.recall, 0.5);
  assert.equal(g.precision, 0.5);
  assert.equal(g.fileRecall, 0.5);
  assert.equal(g.filePrecision, 0.5);
  assert.equal(g.testRecall, 0);
  assert.equal(g.runTests, 0, "run-tests without a reference test file or the task's command earns nothing");
  assert.equal(g.canDoClaimed, 1);
  assert.equal(g.canDoVerified, 0, "run-tests is verified only for a targets.json repo");
  assert.equal(g.canDoAccuracy, 0);
  assert.equal(g.ownShare, 0);
  assert.equal(g.teamShare, 1);
  const e = gradePlan(EXACT, gTask, [], []);
  assert.deepEqual([e.score, e.recall, e.precision, e.runTests], [1, 1, 1, 1], "names a reference test file");
  const cmd = gradePlan(gPlan([gStep("run-tests", null, "missing")], [], [], gTask.tests.command), gTask, [], []);
  assert.equal(cmd.runTests, 1, "or the task's exact test command");
  // A can-do naming a rule that is not approved (or does not edit that file) is not verified.
  const g2 = gradePlan(gPlan([gStep("edit-source", "src/range.ts", "can-do", "nope@" + "0".repeat(64))], ["src/range.ts"], []), gTask, approvedRules(repo), FIXTURE);
  assert.equal(g2.canDoVerified, 0);
  assert.equal(g2.canDoAccuracy, 0);
  assert.equal(gradePlan(gPlan([], [], []), gTask, [], []).canDoAccuracy, null);
});

test("M144: a padded plan (extra files and steps) scores strictly lower than the exact plan", () => {
  const exact = gradePlan(EXACT, gTask, [], []);
  const padded = gradePlan(gPlan([...EXACT.steps, gStep("edit-source", "src/greet.ts", "missing"), gStep("edit-source", "src/index.ts", "missing"), gStep("edit-test", "test/other.test.ts", "missing")], ["src/range.ts", "test/range.test.ts", "src/greet.ts", "src/index.ts", "test/other.test.ts"], ["test/range.test.ts", "test/other.test.ts"]), gTask, [], []);
  assert.equal(padded.matched, exact.matched, "same right steps");
  assert.ok(padded.score < exact.score, `padded ${padded.score} < exact ${exact.score}`);
  assert.equal(padded.score, 0.4);
  assert.ok(padded.filePrecision < exact.filePrecision);
});

test("M144: a run-tests-only plan scores 0", () => {
  const g = gradePlan(gPlan([gStep("run-tests", null, "missing")], [], []), gTask, [], []);
  assert.equal(g.score, 0);
  assert.equal(g.matched, 0);
  assert.equal(g.ownShare, 0);
  assert.equal(g.runTests, 0);
});

test("M144: log rows carry fixed codes and numbers only (no URL, no message text)", () => {
  const good = { schema: RUN_SCHEMA, at: "2026-10-30T00:00:00Z", set: "public", taskFileSha256: "c".repeat(64), taskKey: "0123456789abcdef", repo: "o/r", commit: H40, workspace: H40, planner: "plan-only-v1", plannerSha256: "f".repeat(64), planSha256: null, code: "FETCH_FAILED", grade: null };
  assert.equal(logRowProblem(good), null);
  assert.equal(logRowProblem({ ...good, code: "fatal: could not read from https://github.com/o/r" }), "code");
  assert.equal(logRowProblem({ ...good, error: "boom" }), "run_keys");
  assert.equal(logRowProblem({ ...good, repo: "https://github.com/o/r" }), "public_repo");
  assert.equal(logRowProblem({ ...good, set: "hidden" }), "hidden_names_repo");
  assert.equal(logRowProblem({ ...good, code: "OK" }), "grade_presence");
  assert.equal(logRowProblem({ ...good, planner: "see https://x" }), "planner");
  assert.equal(logRowProblem({ ...good, grader: "plan-grade-v2" }), null);
  assert.equal(logRowProblem({ ...good, grader: "v9 see https://x" }), "grader");
  // A v2 row must carry the v2 grade shape; an old v1-shaped grade only without the grader key.
  const v1Grade = { required: 3, matched: 2, stepShare: 0.667, fileRecall: 1, filePrecision: 1, testRecall: 1, canDoClaimed: 0, canDoVerified: 0, canDoAccuracy: null, ownShare: 0, teamShare: 1, missing: 3 };
  assert.equal(logRowProblem({ ...good, code: "OK", grade: v1Grade }), null);
  assert.equal(logRowProblem({ ...good, code: "OK", grade: v1Grade, grader: "plan-grade-v2" }), "grade_keys");
});

test("M144: the committed run log is valid and add-only against its git history", () => {
  const text = read(RUN_LOG);
  const p = parseLog(text);
  assert.equal("problem" in p, false, JSON.stringify(p));
  assert.ok(isLocked(text, sha256(publicText)), "the public task file is locked");
  // The public set has been run under the current grader (old v1 rows stay as history).
  if (!("problem" in p)) {
    const v2 = p.rows.filter((r) => r.schema === RUN_SCHEMA && r.grader === "plan-grade-v2" && r.taskFileSha256 === sha256(publicText));
    assert.ok(v2.length >= publicFile.tasks.length, "a plan-grade-v2 run of the public set is logged");
  }
  assert.equal(addOnlyProblem("a\n", "b\na\n"), "rewritten");
  let revs: string[] = [];
  try { revs = execFileSync("git", ["log", "--format=%H", "--", RUN_LOG], { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim().split("\n").filter(Boolean).reverse(); } catch { revs = []; }
  let prev = "";
  for (const rev of revs) {
    let cur = "";
    try { cur = execFileSync("git", ["show", `${rev}:${RUN_LOG}`], { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }); } catch { cur = ""; }
    assert.equal(addOnlyProblem(prev, cur), null, `add-only at ${rev.slice(0, 10)}`);
    prev = cur;
  }
  assert.equal(addOnlyProblem(prev, text), null, "working tree extends the last commit");
});

// Auditor (2026-10-30): plan-only must work when run from another directory, including a checkout with no
// node_modules of its own (a git worktree). Node resolves "typescript" from the importing file, never from the cwd.
const TSX = join(repo, "node_modules/.bin/tsx");
const spawn = (cwd: string, args: string[]) => { try { return { status: 0, out: execFileSync(TSX, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }) }; } catch (e: any) { return { status: e.status as number, out: `${e.stdout ?? ""}${e.stderr ?? ""}` }; } };
const synthHidden = (): string => JSON.stringify({ schema: publicFile.schema, set: "hidden", tasks: [fixtureTask()] });

test("M144: plan-only runs from a temp dir outside the repo (usage, and a refusal that needs the parser loaded)", () => {
  const out = mkdtempSync(join(tmpdir(), "m144-cwd-"));
  try {
    writeFileSync(join(out, "t.json"), synthHidden());
    const usage = spawn(out, [join(repo, "peaceai/bin/plan-only.ts")]);
    assert.equal(usage.status, 2, usage.out);
    assert.match(usage.out, /^usage: plan-only\.ts lock\|run <taskfile>/);
    // `run` on an unlocked file (path relative to the temp cwd): refused before any fetch, nothing written.
    const before = read(RUN_LOG);
    const r = spawn(out, [join(repo, "peaceai/bin/plan-only.ts"), "run", "t.json"]);
    assert.equal(r.status, 1, r.out);
    assert.match(r.out, /^refused [A-Z_]+\n$/);
    assert.doesNotMatch(r.out, /TASK_FILE_INVALID|TYPESCRIPT_NOT_FOUND|ERR_MODULE_NOT_FOUND/);
    assert.equal(read(RUN_LOG), before);
  } finally { rmSync(out, { recursive: true, force: true }); }
});

test("M144: plan-only in a git worktree with no node_modules, run from outside it, uses the main checkout's pinned typescript; the old static import fails there (near-miss)", (t) => {
  const base = mkdtempSync(join(tmpdir(), "m144-wt-"));
  const wt = join(base, "wt");
  const out = join(base, "cwd");
  mkdirSync(out);
  try {
    execFileSync("git", ["worktree", "add", "--detach", "-q", wt, "HEAD"], { cwd: repo, stdio: "ignore" });
    assert.equal(execFileSync("git", ["ls-files", "--", "node_modules"], { cwd: wt, encoding: "utf8" }), "", "node_modules is not checked in");
    if (!typescriptEntry(wt)) { t.skip("the main worktree has no pinned typescript"); return; }
    writeFileSync(join(out, "t.json"), synthHidden());
    // Fixed path: lock works from the outside cwd and appends one hidden lock row to the worktree's log.
    const r = spawn(out, [join(wt, "peaceai/bin/plan-only.ts"), "lock", "t.json"]);
    assert.equal(r.status, 0, r.out);
    assert.match(r.out, /^locked set=hidden tasks=1 sha256=[0-9a-f]{64}\n$/);
    assert.ok(isLocked(readFileSync(join(wt, RUN_LOG), "utf8"), sha256(synthHidden())));
    // The parser really runs there: after the redirect, symbols.ts (static `import ts from "typescript"`) indexes a file.
    const probe = join(out, "probe.mts");
    writeFileSync(probe, `import { typescriptEntry, useTypescript } from ${JSON.stringify(join(wt, "peaceai/lib/tsresolve.ts"))};\nuseTypescript(typescriptEntry()!);\nconst { buildIndex } = await import(${JSON.stringify(join(wt, "peaceai/lib/symbols.ts"))});\nconsole.log(buildIndex([{ path: "src/a.ts", content: "export function f(): number { return 1; }\\n" }]).defs.map((d: { name: string }) => d.name).join(","));\n`);
    const ok = spawn(out, [probe]);
    assert.equal(ok.status, 0, ok.out);
    assert.equal(ok.out.trim(), "f");
    // Near-miss: the same worktree, the planner imported directly with no redirect (the old plan-only.ts): typescript is not found.
    const old = join(out, "old.mts");
    writeFileSync(old, `await import(${JSON.stringify(join(wt, "peaceai/lib/planrun.ts"))});\nconsole.log("loaded");\n`);
    const bad = spawn(out, [old]);
    assert.notEqual(bad.status, 0);
    assert.match(bad.out, /Cannot find package 'typescript'/);
  } finally {
    try { execFileSync("git", ["worktree", "remove", "--force", wt], { cwd: repo, stdio: "ignore" }); } catch { /* removed below */ }
    rmSync(base, { recursive: true, force: true });
  }
});

test("M144: typescriptEntry takes only the pinned version and never walks above a candidate root (near-miss)", () => {
  const root = mkdtempSync(join(tmpdir(), "m144-pin-"));
  try {
    const pin = (JSON.parse(read("package.json")) as { devDependencies: Record<string, string> }).devDependencies.typescript!;
    writeFileSync(join(root, "package.json"), JSON.stringify({ devDependencies: { typescript: pin } }));
    assert.equal(typescriptEntry(root), null, "no node_modules: not found (no walk up to a parent's)");
    const dir = join(root, "node_modules", "typescript");
    mkdirSync(join(dir, "lib"), { recursive: true });
    writeFileSync(join(dir, "lib", "typescript.js"), "module.exports = {};\n");
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "typescript", version: "0.0.1", main: "./lib/typescript.js" }));
    assert.equal(typescriptEntry(root), null, "wrong version: refused");
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "typescript", version: pin, main: "./lib/typescript.js" }));
    assert.equal(typescriptEntry(root), join(dir, "lib", "typescript.js"));
    assert.ok(typescriptEntry(repo)?.startsWith(join(repo, "node_modules", "typescript")), "a full checkout uses its own copy first");
  } finally { rmSync(root, { recursive: true, force: true }); }
});
