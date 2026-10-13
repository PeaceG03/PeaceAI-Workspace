// Job B: apply each candidate to a clean checkout and test it. No secrets, no core.
import { spawnSync, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, cpSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { countDiffLines, parseDiff } from "../lib/diff.ts";
import { validateSummary, loadSummaryContext } from "../lib/gate.ts";
import { scanText } from "../lib/leak.ts";
import type { CandidateResult } from "../lib/rank.ts";
import { parseTapFailures, parseTscOutput, type RepairContext, type RepairEdit } from "../lib/repair.ts";
import { DEFAULT_BUDGET, runRepairLoop, type Evaluation, type LoopResult } from "../lib/repairloop.ts";
import { gradingVerdict, validateFix, type TestGrading } from "../lib/results.ts";
import { checkCandidateScope } from "../lib/scope.ts";
import { relatedTests } from "../lib/sources.ts";
import { buildIndex } from "../lib/symbols.ts";
import { loadTargets, scopeOf } from "../lib/target.ts";

const inDir = resolve(process.env.PEACEAI_IN_DIR ?? "");
const resultsFile = resolve(process.env.PEACEAI_RESULTS_FILE ?? "");
const repo = resolve(process.env.PEACEAI_WORKSPACE_DIR ?? process.cwd());
const STEP_TIMEOUT_MS = 120_000;
const RELATED_TIMEOUT_MS = 60_000;
const RELATED_LIMIT = 4;

// M5: per-target scope and original-suite mode.
const targets = loadTargets();
const targetConfig = targets.targets[process.env.PEACEAI_TARGET || targets.default];
if (!targetConfig) throw new Error("target has no scope config");
const scope = scopeOf(targetConfig);

const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

// Tamper-proofing: candidate code (type check and both test passes) runs as a separate unprivileged
// user (PEACEAI_SANDBOX_USER) with a minimal environment. That user cannot write the candidate tree,
// this harness's files, or the results path. Pass/fail comes only from the exit code captured here,
// every leftover process of that user is killed after each command, and only then does this harness
// write the result. CI sets PEACEAI_REQUIRE_SANDBOX=true so a missing sandbox fails closed.
const sandboxUser = process.env.PEACEAI_SANDBOX_USER ?? "";
if (sandboxUser && !/^[a-z][a-z0-9-]{0,30}$/.test(sandboxUser)) throw new Error("invalid sandbox user");
if (!sandboxUser && process.env.PEACEAI_REQUIRE_SANDBOX === "true") throw new Error("sandbox user required");
const sandboxRoot = process.env.PEACEAI_SANDBOX_ROOT ?? "/tmp";
const sandboxHome = sandboxUser ? mkdtempSync(join(sandboxRoot, "peaceai-home-")) : tmpdir();
if (sandboxUser) {
  execFileSync("sudo", ["-n", "chown", sandboxUser, sandboxHome]); // mkdtemp already made it 0700
}
const cleanEnv = { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: sandboxHome, TMPDIR: sandboxHome, CI: "true", NODE_ENV: "test" };

function killSandbox(): void {
  if (sandboxUser) spawnSync("sudo", ["-n", "pkill", "-KILL", "-u", sandboxUser], { stdio: "ignore" });
}

/** Trusted harness command (e.g. git apply), run as this user. */
function runTrusted(cwd: string, command: string, args: string[]): boolean {
  return spawnSync(command, args, { cwd, stdio: "ignore", timeout: STEP_TIMEOUT_MS, killSignal: "SIGKILL" }).status === 0;
}

/** Candidate-controlled command: sandbox user, clean env, exit code only, leftovers killed. */
function runCandidate(cwd: string, command: string, args: string[], timeout = STEP_TIMEOUT_MS): boolean {
  const envArgs = Object.entries(cleanEnv).map(([k, v]) => `${k}=${v}`);
  const result = sandboxUser
    ? spawnSync("sudo", ["-n", "-u", sandboxUser, "--", "/usr/bin/env", "-i", ...envArgs, command, ...args], {
        cwd, stdio: "ignore", timeout, killSignal: "SIGKILL",
      })
    : spawnSync(command, args, { cwd, env: cleanEnv, stdio: "ignore", timeout, killSignal: "SIGKILL" });
  killSandbox();
  return result.status === 0;
}

/**
 * Candidate-controlled command whose output the harness parses (M7 repair). Same sandbox; output capped.
 * `ok` is the exit code the harness captured, never anything the output says; the text only picks repairs.
 */
const MAX_CAPTURE = 2 * 1024 * 1024;
function runCandidateCapture(cwd: string, command: string, args: string[], timeout = STEP_TIMEOUT_MS): { ok: boolean; out: string } {
  const envArgs = Object.entries(cleanEnv).map(([k, v]) => `${k}=${v}`);
  const options = { cwd, encoding: "utf8" as const, timeout, killSignal: "SIGKILL" as const, maxBuffer: MAX_CAPTURE, stdio: ["ignore", "pipe", "pipe"] as ["ignore", "pipe", "pipe"] };
  const result = sandboxUser
    ? spawnSync("sudo", ["-n", "-u", sandboxUser, "--", "/usr/bin/env", "-i", ...envArgs, command, ...args], options)
    : spawnSync(command, args, { ...options, env: cleanEnv });
  killSandbox();
  return { ok: result.status === 0, out: `${result.stdout ?? ""}\n${result.stderr ?? ""}` };
}

// M7 repair budget (Job B timeout is 25 minutes; up to five candidates run in parallel jobs).
const REPAIR_ENABLED = process.env.PEACEAI_REPAIR !== "off";
const REPAIR_BUDGET = {
  maxRounds: Number(process.env.PEACEAI_REPAIR_ROUNDS ?? DEFAULT_BUDGET.maxRounds),
  deadlineMs: Number(process.env.PEACEAI_REPAIR_DEADLINE_MS ?? DEFAULT_BUDGET.deadlineMs),
};
const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");
const repairDir = join(dirname(resultsFile), "repair");

const summary = JSON.parse(readFileSync(join(inDir, "summary.json"), "utf8"));
if (!validateSummary(summary, loadSummaryContext())) throw new Error("summary.json failed schema validation");
const baseFiles = new Set(git(repo, "ls-tree", "-r", "--name-only", "-z", summary.baseSha).split("\0").filter(Boolean));

// In CI each candidate runs in its own matrix job (fresh runner, own read-only tools copy).
const only = process.env.PEACEAI_ONLY_CANDIDATE ?? "";
if (only && !summary.candidates.some((c) => c.id === only)) throw new Error("unknown candidate");
const selected = only ? summary.candidates.filter((c) => c.id === only) : summary.candidates;

// ---- M12: grading a learned test against its fix commit

/**
 * The candidate's new tests already ran on the fixed code (pass 2, `afterFix`). Here the harness reverses
 * the fix commit's non-test source change in the same tree (a patch it builds from git and applies itself)
 * and runs the new tests again as the sandbox user: `beforeFix` is that exit code. Anything that prevents a
 * faithful pre-fix tree is UNGRADABLE, which never counts.
 */
function gradeTest(tree: string, files: ReturnType<typeof parseDiff>, newTests: readonly string[], fixSha: string, afterFix: boolean, tsx: string): TestGrading {
  const ungradable = (reason: TestGrading["reason"]): TestGrading => ({ fixSha, afterFix, beforeFix: null, verdict: "UNGRADABLE", reason });
  if (newTests.length === 0 || !files.every((f) => (f.isNew || f.appendOnly) && f.newPath && scope.isTest(f.newPath))) return ungradable("not-test-only");
  // The fix commit is validated before anything is reverted (lib/results.ts validateFix).
  const fix = validateFix(fixSha, summary.baseSha, (...args) => { try { return git(repo, ...args); } catch { return null; } }, scope);
  if (!fix.ok) return ungradable(fix.reason);
  const paths = fix.paths;
  // M14: an appended test file is graded on its NEW cases only (the base file's imports + the appended lines),
  // so cases already in the file (possibly added by the fix itself) can never make it fail before the fix.
  for (const f of files.filter((x) => x.appendOnly && x.newPath)) {
    const imports = git(repo, "show", `${summary.baseSha}:${f.newPath}`).split("\n").filter((l) => /^import\s[^;]*;\s*$/.test(l));
    if (imports.length === 0 || f.addedLines.some((l) => /^import\s/.test(l))) return ungradable("not-test-only");
    writeFileSync(join(tree, f.newPath!), [...imports, "", ...f.addedLines, ""].join("\n"));
  }
  if (files.some((x) => x.appendOnly)) afterFix = afterFix && runCandidate(tree, tsx, ["--test", ...newTests]);
  const dir = mkdtempSync(join(tmpdir(), "peaceai-prefix-"));
  try {
    const patch = join(dir, "prefix.diff");
    writeFileSync(patch, git(repo, "diff", "--no-color", "--full-index", "--binary", "--no-renames", fixSha, `${fixSha}^`, "--", ...paths));
    if (!runTrusted(tree, "git", ["apply", "--check", "--whitespace=nowarn", patch]) || !runTrusted(tree, "git", ["apply", "--whitespace=nowarn", patch])) return ungradable("revert-failed");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  const beforeFix = runCandidate(tree, tsx, ["--test", ...newTests]);
  return { fixSha, afterFix, beforeFix, verdict: gradingVerdict(afterFix, beforeFix), reason: null };
}

/**
 * M13: grading of a learned guard against itself. Its new tests already ran with the guard (pass 2,
 * `afterFix`). Here the harness puts the candidate's non-test source files back to the task base (the code
 * without the guard) and runs the new tests again as the sandbox user. Only pass-with-guard AND
 * fail-without counts. `fixSha` records the task base the "before" tree was taken from.
 */
function gradeSelf(tree: string, files: ReturnType<typeof parseDiff>, newTests: readonly string[], afterFix: boolean, tsx: string): TestGrading {
  const base = summary.baseSha;
  const ungradable = (reason: TestGrading["reason"]): TestGrading => ({ fixSha: base, afterFix, beforeFix: null, verdict: "UNGRADABLE", reason });
  const source = files.filter((f) => !f.isNew && f.newPath && f.oldPath === f.newPath && scope.isSource(f.newPath) && !scope.isTest(f.newPath)).map((f) => f.newPath!);
  const tests = files.filter((f) => f.isNew && f.newPath && scope.isTest(f.newPath));
  if (newTests.length === 0 || source.length === 0 || source.length + tests.length !== files.length) return ungradable("not-test-only");
  if (!runTrusted(tree, "git", ["checkout", "-q", base, "--", ...source])) return ungradable("revert-failed");
  const beforeFix = runCandidate(tree, tsx, ["--test", ...newTests]);
  return { fixSha: base, afterFix, beforeFix, verdict: gradingVerdict(afterFix, beforeFix), reason: null };
}

// ---- M7 repair stage

interface RepairRecord {
  schema: "peaceai-repair:v1";
  stop: LoopResult["stop"] | "GATE_REJECTED";
  rounds: number;
  originalDiffSha256: string;
  repairedDiffSha256: string | null;
  jobBGate: string;
  iterations: LoopResult["iterations"];
}

function gitIn(tree: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd: tree, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 16 * 1024 * 1024 });
}

function treeFiles(tree: string): string[] {
  return gitIn(tree, "ls-files", "-z", "--cached", "--others", "--exclude-standard")
    .split("\0")
    .filter((p) => p && scope.isSource(p) && !scope.isDenied(p));
}

function repairCandidate(
  tree: string,
  diffPath: string,
  originalDiff: string,
  files: ReturnType<typeof parseDiff>,
  baseTests: string[],
  judged: string[],
  newTestsIn: string[],
  tsx: string,
  tsc: string,
) {
  const baseCache = new Map<string, string | null>();
  const base = (path: string) => {
    if (!baseCache.has(path)) baseCache.set(path, baseFiles.has(path) ? git(repo, "show", `${summary.baseSha}:${path}`) : null);
    return baseCache.get(path)!;
  };
  const inTree = (path: string): string | null => {
    if (!scope.isSource(path)) return null;
    const full = resolve(tree, path);
    if (relative(tree, full).startsWith("..")) return null;
    try {
      if (!lstatSync(full).isFile()) return null;
    } catch {
      return null;
    }
    return full;
  };
  const read = (path: string) => {
    const full = inTree(path);
    return full ? readFileSync(full, "utf8") : null;
  };
  const evaluate = (): Evaluation => {
    const t = runCandidateCapture(tree, tsc, ["-p", "tsconfig.json", "--noEmit", "--pretty", "false"]);
    if (!t.ok) return { typecheck: false, originalSuite: false, newTests: false, errors: parseTscOutput(t.out, tree) };
    const errors = [];
    const suite = targetConfig.originalSuite === "full" ? baseTests : judged;
    let originalSuite = true;
    if (suite.length > 0) {
      const o = runCandidateCapture(tree, tsx, ["--test", "--test-reporter=tap", ...suite], targetConfig.originalSuite === "full" ? STEP_TIMEOUT_MS : RELATED_TIMEOUT_MS * suite.length);
      originalSuite = o.ok;
      if (!o.ok) errors.push(...parseTapFailures(o.out, tree));
    } else if (targetConfig.originalSuite === "full") originalSuite = false;
    let newOk = true;
    if (newTestsIn.length > 0) {
      const n = runCandidateCapture(tree, tsx, ["--test", "--test-reporter=tap", ...newTestsIn]);
      newOk = n.ok;
      if (!n.ok) errors.push(...parseTapFailures(n.out, tree));
    }
    return { typecheck: true, originalSuite, newTests: newOk, errors };
  };
  const context = (): RepairContext => {
    const indexed = treeFiles(tree)
      .map((path) => ({ path, content: read(path) }))
      .filter((f): f is { path: string; content: string } => f.content !== null);
    return { index: buildIndex(indexed), read, base, isSource: scope.isSource, isTest: scope.isTest };
  };
  const apply = (edit: RepairEdit): boolean => {
    // Harness-side checks: in scope, not denied, an existing regular file inside the tree, never a base test.
    if (!scope.isSource(edit.path) || scope.isDenied(edit.path)) return false;
    if (scope.isTest(edit.path) && baseFiles.has(edit.path)) return false;
    const full = inTree(edit.path);
    if (!full) return false;
    writeFileSync(full, edit.content);
    return true;
  };
  const loop = runRepairLoop({ evaluate, context, apply, now: Date.now }, REPAIR_BUDGET);
  const first = loop.iterations[0]!;
  const original = { typecheckPassed: first.typecheck, originalSuitePassed: first.originalSuite, newTestsPassed: first.newTests };
  const record: RepairRecord = {
    schema: "peaceai-repair:v1",
    stop: loop.stop,
    rounds: loop.rounds,
    originalDiffSha256: sha256(originalDiff),
    repairedDiffSha256: null,
    jobBGate: "not-run",
    iterations: loop.iterations,
  };
  const keep = () => ({ record, original, finalDiff: originalDiff, newTests: newTestsIn });
  // Only a loop that ended green yields a repaired candidate; anything else is tested exactly as generated.
  const revert = () => {
    gitIn(tree, "checkout", "-q", summary.baseSha, "--", ".");
    gitIn(tree, "clean", "-fdq", "-e", "node_modules");
    gitIn(tree, "apply", "--whitespace=nowarn", diffPath);
  };
  if (!loop.changed) return keep();
  if (loop.stop !== "GREEN") {
    revert();
    return keep();
  }
  const paths = [...new Set([...files.map((f) => f.newPath ?? f.oldPath ?? "").filter(Boolean), ...loop.iterations.flatMap((i) => i.applied.map((a) => a.path))])].sort();
  gitIn(tree, "add", "-A", "--", ...paths);
  const repaired = gitIn(tree, "diff", "--cached", "--no-color", "--full-index", "--no-renames", summary.baseSha, "--", ...paths);
  gitIn(tree, "reset", "-q");
  // Same gates available here (scope, personal info); the core-text gate runs again in Job B2 with the core.
  const repairedFiles = parseDiff(repaired);
  const violations = checkCandidateScope(repairedFiles, baseFiles, scope);
  const pii = scanText(repairedFiles.flatMap((f) => f.addedLines).join("\n"));
  if (violations.length > 0 || pii.length > 0) {
    record.stop = "GATE_REJECTED";
    record.jobBGate = violations.length > 0 ? "scope" : "personal-info";
    revert();
    return keep();
  }
  record.jobBGate = "pass";
  record.repairedDiffSha256 = sha256(repaired);
  const repairedNewTests = repairedFiles.filter((f) => f.isNew && f.newPath && scope.isTest(f.newPath)).map((f) => f.newPath!).sort();
  return { record, original, finalDiff: repaired, newTests: repairedNewTests };
}

const repairs: (RepairRecord & { id: string; original: Record<string, boolean>; originalNewTestFiles: number })[] = [];
const repairedDiffs = new Map<string, string>();
const results: CandidateResult[] = [];
for (const candidate of selected) {
  const diffPath = join(inDir, candidate.file);
  const diff = readFileSync(diffPath, "utf8");
  const files = parseDiff(diff);
  const result: CandidateResult = {
    id: candidate.id,
    diffBytes: Buffer.byteLength(diff),
    diffLines: candidate.diffLines,
    applied: false,
    typecheckPassed: false,
    originalSuitePassed: false,
    newTestsPassed: false,
    newTestFiles: 0,
  };
  // M12: a learned test is UNGRADABLE (never counts) until the harness has graded it below.
  if (candidate.fixSha) result.testGrading = { fixSha: candidate.fixSha, afterFix: false, beforeFix: null, verdict: "UNGRADABLE", reason: "not-applied" };
  if (candidate.selfGrade) result.testGrading = { fixSha: summary.baseSha, afterFix: false, beforeFix: null, verdict: "UNGRADABLE", reason: "not-applied" };
  results.push(result);
  // Defense in depth: re-check scope without the core.
  if (checkCandidateScope(files, baseFiles, scope, { testAppend: !!candidate.fixSha }).length > 0) continue;
  // The tree is owned by this harness and only readable by the sandbox user; it gets its own tools copy.
  const tree = mkdtempSync(join(sandboxRoot, "peaceai-test-"));
  rmSync(tree, { recursive: true, force: true });
  git(repo, "worktree", "add", "--quiet", "--detach", tree, summary.baseSha);
  try {
    chmodSync(tree, 0o755);
    cpSync(join(repo, "node_modules"), join(tree, "node_modules"), { recursive: true, verbatimSymlinks: true });
    const tsx = join(tree, "node_modules", ".bin", "tsx");
    const tsc = join(tree, "node_modules", ".bin", "tsc");
    const baseTests = [...baseFiles].filter((path) => scope.isSource(path) && scope.isTest(path)).sort();
    const touched = files.map((f) => f.newPath ?? "").filter((p) => p && !scope.isTest(p));
    const related =
      targetConfig.originalSuite === "related"
        ? relatedTests(touched, baseTests.map((path) => ({ path, content: git(repo, "show", `${summary.baseSha}:${path}`) })), RELATED_LIMIT)
        : [];
    // "related" mode: each related existing test runs on the untouched base first; only those that pass
    // there are judged on the candidate (a regression fails it). Base failures are environment noise.
    const judged = related.filter((path) => runCandidate(tree, tsx, ["--test", path], RELATED_TIMEOUT_MS));
    if (targetConfig.originalSuite === "related") console.log(`${candidate.id} related_tests=${related.length} judged=${judged.length}`);
    if (!runTrusted(tree, "git", ["apply", "--check", "--whitespace=nowarn", diffPath])) continue;
    if (!runTrusted(tree, "git", ["apply", "--whitespace=nowarn", diffPath])) continue;
    result.applied = true;
    // M14: a graded learned test may also append cases to an existing test file (scope allows it only with fixSha).
    const appended = candidate.fixSha ? files.filter((file) => file.appendOnly && file.newPath && scope.isTest(file.newPath)).map((file) => file.newPath!).sort() : [];
    const newTests = [...files
      .filter((file) => file.isNew && file.newPath && scope.isTest(file.newPath))
      .map((file) => file.newPath!), ...appended]
      .sort();
    result.newTestFiles = newTests.length;
    // M7: bounded test-and-fix loop before the final passes. Edits come only from the deterministic rules in
    // lib/repair.ts; the harness writes every file (the sandbox user cannot), and the final passes below run
    // on whatever tree the loop leaves, exactly as for an unrepaired candidate.
    // A learned test is graded exactly as generated: no repair.
    if (REPAIR_ENABLED && !candidate.fixSha && !candidate.selfGrade) {
      const repair = repairCandidate(tree, diffPath, diff, files, baseTests, judged, newTests, tsx, tsc);
      result.diffBytes = Buffer.byteLength(repair.finalDiff);
      result.diffLines = countDiffLines(repair.finalDiff);
      const originalNewTestFiles = result.newTestFiles;
      result.newTestFiles = repair.newTests.length;
      newTests.splice(0, newTests.length, ...repair.newTests);
      repairs.push({ id: candidate.id, ...repair.record, original: repair.original, originalNewTestFiles });
      if (repair.record.repairedDiffSha256) repairedDiffs.set(candidate.id, repair.finalDiff);
    }
    result.typecheckPassed = runCandidate(tree, tsc, ["-p", "tsconfig.json", "--noEmit"]);
    // Pass 1: the original suite, with every new test file moved out of the tree.
    const parked = mkdtempSync(join(tmpdir(), "peaceai-parked-"));
    newTests.forEach((path, i) => renameSync(join(tree, path), join(parked, String(i))));
    // An appended test file runs in pass 1 exactly as it is on the base (its new cases parked).
    for (const path of appended) writeFileSync(join(tree, path), git(repo, "show", `${summary.baseSha}:${path}`));
    result.originalSuitePassed =
      targetConfig.originalSuite === "full"
        ? baseTests.length > 0 && runCandidate(tree, tsx, ["--test", ...baseTests])
        : judged.every((path) => runCandidate(tree, tsx, ["--test", path], RELATED_TIMEOUT_MS));
    newTests.forEach((path, i) => {
      mkdirSync(dirname(join(tree, path)), { recursive: true });
      if (appended.includes(path)) rmSync(join(tree, path), { force: true });
      renameSync(join(parked, String(i)), join(tree, path));
    });
    rmSync(parked, { recursive: true, force: true });
    // Pass 2: only the new tests, in a separate process.
    result.newTestsPassed = newTests.length === 0 ? true : runCandidate(tree, tsx, ["--test", ...newTests]);
    // Pass 3 (M12, learned tests only): the same new tests on the code before the fix.
    if (candidate.fixSha) result.testGrading = gradeTest(tree, files, newTests, candidate.fixSha, result.newTestsPassed, tsx);
    // Pass 3 (M13, learned guards only): the same new tests without the candidate's own source edit.
    if (candidate.selfGrade) result.testGrading = gradeSelf(tree, files, newTests, result.newTestsPassed, tsx);
  } finally {
    killSandbox();
    // The tools copy may be read-only (Job B makes them so); restore write access before removing.
    spawnSync("chmod", ["-R", "u+w", tree], { stdio: "ignore" });
    rmSync(tree, { recursive: true, force: true });
    git(repo, "worktree", "prune");
  }
}

// Written only after every sandbox process is dead, via a private temp file and an atomic rename.
killSandbox();
if (sandboxUser) spawnSync("sudo", ["-n", "rm", "-rf", sandboxHome], { stdio: "ignore" });
const tmpResult = `${resultsFile}.${process.pid}.tmp`;
writeFileSync(
  tmpResult,
  JSON.stringify({ schema: "peaceai-workspace-results:v1", taskId: summary.taskId, baseSha: summary.baseSha, results }, null, 2) + "\n",
  { mode: 0o644 },
);
renameSync(tmpResult, resultsFile);
// M7: repair records (and repaired diffs) next to the results, written by the harness after the sandbox is dead.
if (repairs.length > 0) {
  mkdirSync(repairDir, { recursive: true });
  for (const r of repairs) {
    writeFileSync(join(repairDir, `${r.id}.json`), JSON.stringify(r, null, 2) + "\n", { mode: 0o644 });
    const d = repairedDiffs.get(r.id);
    if (d !== undefined) writeFileSync(join(repairDir, `${r.id}.diff`), d, { mode: 0o644 });
  }
}
for (const r of repairs)
  console.log(`${r.id} repair stop=${r.stop} rounds=${r.rounds} rules=${r.iterations.flatMap((i) => i.applied.map((a) => a.rule)).join(",") || "none"} gate=${r.jobBGate}`);
for (const r of results)
  console.log(`${r.id} applied=${r.applied} typecheck=${r.typecheckPassed} original=${r.originalSuitePassed} new=${r.newTestsPassed} new_files=${r.newTestFiles}${r.testGrading ? ` grading=${r.testGrading.verdict} after_fix=${r.testGrading.afterFix} before_fix=${r.testGrading.beforeFix}${r.testGrading.reason ? ` reason=${r.testGrading.reason}` : ""}` : ""}`);
