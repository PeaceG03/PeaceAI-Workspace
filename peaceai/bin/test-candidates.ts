// Job B: apply each candidate to a clean checkout and test it. No secrets, no core.
import { spawnSync, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, closeSync, constants as fsConstants, cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, openSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
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
import { callsFunction, declaredFunctions, expectsThrow, gradedTestSourceProblem, countStubNotes, hasNonDeclarationCallables, importedBindings, moduleDataKeys, moduleImportsRepoFiles, newStubCode, stubAll, stubFailureCredited, stubFunction } from "../lib/learned-function.ts";
import { assertionFailuresOnly } from "../lib/learned-body.ts";
import { derivedModuleProblem } from "../lib/learned-derive.ts";
import { dateTestProblem, envArgProblem, existingTargetRefusal, mapSetTestProblem, moduleReadClosure, voidTestProblem } from "../lib/learned-test-existing.ts";
import { BROKEN_TYPE_LINE, workflowScript } from "../lib/learned-workflow.ts";
import { relatedTests } from "../lib/sources.ts";
import { buildIndex } from "../lib/symbols.ts";
import { loadTargets, scopeOf } from "../lib/target.ts";
import { protectedDigest, WORKSPACE_TARGET } from "../lib/self-zone.ts";

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
// M72: on this Workspace every candidate is checked against a digest of all protected files (self-zone.ts).
const digestProtected = (process.env.PEACEAI_TARGET || targets.default) === WORKSPACE_TARGET;

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
function runCandidateCapture(cwd: string, command: string, args: string[], timeout = STEP_TIMEOUT_MS, extraEnv: Record<string, string> = {}, stderrFd?: number): { ok: boolean; out: string } {
  const env = { ...cleanEnv, ...extraEnv };
  const envArgs = Object.entries(env).map(([k, v]) => `${k}=${v}`);
  const options = { cwd, encoding: "utf8" as const, timeout, killSignal: "SIGKILL" as const, maxBuffer: MAX_CAPTURE, stdio: ["ignore", "pipe", stderrFd ?? "pipe"] as ["ignore", "pipe", "pipe" | number] };
  const result = sandboxUser
    ? spawnSync("sudo", ["-n", "-u", sandboxUser, "--", "/usr/bin/env", "-i", ...envArgs, command, ...args], options)
    : spawnSync(command, args, { ...options, env });
  killSandbox();
  return { ok: result.status === 0, out: `${result.stdout ?? ""}\n${result.stderr ?? ""}` };
}

/**
 * Round 2/3 (Auditor #129): graded stub-body tests run under Node's permission model when the runtime has it
 * (Node >= 22, as in CI). Reads are narrowed to the test file, the module under test and node_modules; no fs
 * write, no child_process; worker threads only for tsx's loader; tsx cache off. Each test file runs directly
 * in its own process (not under `--test`, whose child would not inherit the note fd). With `notes`, the test's
 * stderr is a parent-only file opened write-only: the stub's "ran" notes land there and only the parent reads it.
 * Older runtimes run the same direct command without the permission flags (`confined: false` is logged).
 */
const PERMISSION_NODE_MAJOR = 22;
function runGradedTests(tree: string, tsx: string, tests: readonly string[], module: string, notes = false): { ok: boolean; out: string; confined: boolean; notes: number } {
  const confined = Number(process.versions.node.split(".")[0]) >= PERMISSION_NODE_MAJOR;
  const modules = realpathSync(join(tree, "node_modules"));
  const loader = join(modules, "tsx", "dist", "esm", "index.mjs");
  const outs: string[] = [];
  let ok = true, seen = 0;
  for (const t of tests) {
    const args = confined
      ? ["--permission", `--allow-fs-read=${realpathSync(join(tree, t))}`, `--allow-fs-read=${realpathSync(module)}`, `--allow-fs-read=${modules}`, "--allow-worker", "--import", loader, "--test-reporter=tap", t]
      : ["--import", loader, "--test-reporter=tap", t];
    let dir: string | null = null, fd: number | undefined;
    if (notes) {
      dir = mkdtempSync(join(tmpdir(), `${newStubCode()}-`)); // 0700, harness user only; the nonce never leaves the parent
      fd = openSync(join(dir, "channel"), fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_APPEND | fsConstants.O_EXCL, 0o600);
    }
    try {
      const r = runCandidateCapture(tree, process.execPath, args, STEP_TIMEOUT_MS, { TSX_DISABLE_CACHE: "1" }, fd);
      ok &&= r.ok;
      outs.push(r.out);
      if (dir) { closeSync(fd!); fd = undefined; seen += countStubNotes(readFileSync(join(dir, "channel"), "utf8")); }
    } finally {
      if (fd !== undefined) closeSync(fd);
      if (dir) rmSync(dir, { recursive: true, force: true });
    }
  }
  return { ok, out: outs.join("\n"), confined, notes: seen };
}
/** Round 2 (Auditor #129): the real code must pass this many runs (pass 2 plus these) before a stub is graded. */
const REAL_RUNS_REQUIRED = 3;
/**
 * M80 (TEST_CASE_EXISTING): runGradedTests's confined command with the tested module's relative import closure
 * (`reads`, tree-relative, the module included) and the `package.json` of every directory from those files up to the
 * tree root (module-type lookups; absent paths grant nothing) added to the read list. Everything else is the same:
 * no fs write, no child_process, worker threads only for tsx's loader, tsx cache off, one process per test file, the
 * stub's notes on a parent-only write-only channel. Node < 22 never reaches this (the caller is not-confined first).
 */
/** Auditor #466 (4th review): the zones every TEST_CASE_EXISTING test is run in after pass 2 (gradeExisting). */
export const EXISTING_TZ_RUNS = ["UTC", "America/Denver", "Asia/Tokyo"] as const;
function runExistingTests(tree: string, tests: readonly string[], reads: readonly string[], notes = false, tz?: string): { ok: boolean; out: string; confined: boolean; notes: number } {
  const modules = realpathSync(join(tree, "node_modules"));
  const loader = join(modules, "tsx", "dist", "esm", "index.mjs");
  const realTree = realpathSync(tree);
  const pkgs = new Set<string>();
  for (const r of [...reads, ...tests]) { let d = dirname(r); for (;;) { pkgs.add(join(realTree, d === "." ? "" : d, "package.json")); if (d === "." || d === "/" || d === "") break; d = dirname(d); } }
  const outs: string[] = [];
  let ok = true, seen = 0;
  for (const t of tests) {
    const args = ["--permission", `--allow-fs-read=${realpathSync(join(tree, t))}`, ...reads.map((r) => `--allow-fs-read=${realpathSync(join(tree, r))}`), ...[...pkgs].sort().map((p) => `--allow-fs-read=${p}`), `--allow-fs-read=${modules}`, "--allow-worker", "--import", loader, "--test-reporter=tap", t];
    let dir: string | null = null, fd: number | undefined;
    if (notes) {
      dir = mkdtempSync(join(tmpdir(), `${newStubCode()}-`));
      fd = openSync(join(dir, "channel"), fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_APPEND | fsConstants.O_EXCL, 0o600);
    }
    try {
      const r = runCandidateCapture(tree, process.execPath, args, STEP_TIMEOUT_MS, { TSX_DISABLE_CACHE: "1", ...(tz ? { TZ: tz } : {}) }, fd);
      ok &&= r.ok;
      outs.push(r.out);
      if (dir) { closeSync(fd!); fd = undefined; seen += countStubNotes(readFileSync(join(dir, "channel"), "utf8")); }
    } finally {
      if (fd !== undefined) closeSync(fd);
      if (dir) rmSync(dir, { recursive: true, force: true });
    }
  }
  return { ok, out: outs.join("\n"), confined: true, notes: seen };
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
    if (!runTrusted(tree, "git", ["apply", "--check", "--whitespace=nowarn", patch])) {
      // M23 (Auditor, #127): a fix that CREATED its one source module cannot be reverted once later commits
      // grew that file. Then "before" = today's file with the tested function's body stubbed; fail closed otherwise.
      // Round 3 (Auditor #129 F2): never graded unconfined. Without the permission model (Node < 22) the
      // stub-body route is ungradable.
      if (Number(process.versions.node.split(".")[0]) < PERMISSION_NODE_MAJOR) return ungradable("not-confined");
      // Round 3 (Auditor #129): a module that imports other repo files cannot load under the narrowed reads.
      if (paths.length === 1 && existsSync(join(tree, paths[0]!)) && moduleImportsRepoFiles(readFileSync(join(tree, paths[0]!), "utf8"))) return ungradable("module-imports-repo-files");
      // Round 2 (Auditor #129): the real code must pass REAL_RUNS_REQUIRED times in all (pass 2 was the first),
      // so a test whose outcome varies between runs cannot be credited for a "failure" under the stub.
      if (afterFix) for (let i = 1; i < REAL_RUNS_REQUIRED; i++) if (!runGradedTests(tree, tsx, newTests, join(tree, paths[0]!)).ok) return ungradable("real-not-stable");
      // Round 3 (Auditor #129): the stub is write-only and holds no code; only the parent reads its notes.
      const stubbed = stubBefore(tree, fixSha, paths, newTests);
      if (!stubbed) return ungradable("revert-failed");
      let run: { ok: boolean; out: string; confined: boolean; notes: number };
      try {
        run = runGradedTests(tree, tsx, newTests, stubbed.file, true);
      } finally {
        writeFileSync(stubbed.file, stubbed.real);
      }
      // Auditor (#129): a failure counts as "fails before" only when the runner reports every failing test as an
      // assertion failure or the stub's own throw (stubFailureCredited). Load/import errors, crashes, timeouts
      // and other errors prove nothing. No marker is printed: test code could read one from the stubbed file.
      const credited = !run.ok && stubFailureCredited(run.out, run.notes);
      console.log(`grading: stub-body before-state (stubbed ${stubbed.stubbed.join(",")}; tested ${stubbed.fn}; failure credited: ${credited}; stub notes: ${run.notes}; permission model: ${run.confined}) (fix ${fixSha.slice(0, 12)} created ${paths[0]})`);
      if (!run.ok && !credited) return { ...ungradable("stub-not-reached"), stubbed: stubbed.stubbed };
      return { fixSha, afterFix, beforeFix: run.ok, verdict: gradingVerdict(afterFix, run.ok, !run.ok), reason: null, stubFails: !run.ok, stubbed: stubbed.stubbed };
    }
    if (!runTrusted(tree, "git", ["apply", "--whitespace=nowarn", patch])) return ungradable("revert-failed");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  const beforeFix = runCandidate(tree, tsx, ["--test", ...newTests]);
  return { fixSha, afterFix, beforeFix, verdict: gradingVerdict(afterFix, beforeFix), reason: null };
}

/**
 * M23: writes the stub-body "before" state into the tree, or returns null (fail closed). Only when the fix
 * commit created exactly one source module, every new test imports exactly one function from it (the same one)
 * and calls it, the stub applies, and (for the throwing stub) no new test expects a throw or rejection.
 * Returns the original content so the caller restores it.
 */
function stubBefore(tree: string, fixSha: string, paths: readonly string[], newTests: readonly string[]): { file: string; real: string; fn: string; stubbed: string[] } | null {
  if (paths.length !== 1) return null;
  const path = paths[0]!;
  let added: string;
  try { added = git(repo, "diff", "--name-only", "--no-renames", "--diff-filter=A", `${fixSha}^`, fixSha); } catch { return null; }
  if (!added.split("\n").includes(path)) return null;
  const file = join(tree, path);
  try { if (lstatSync(file).isSymbolicLink() || relative(tree, realpathSync(file)).startsWith("..")) return null; } catch { return null; }
  const fns = new Set<string>();
  const tests = newTests.map((t) => readFileSync(join(tree, t), "utf8"));
  const real = readFileSync(file, "utf8");
  const moduleFunctions = declaredFunctions(real);
  const moduleKeys = moduleDataKeys(real); // Round 4 (Auditor #129 B1): members of values the module returns
  for (const [i, t] of newTests.entries()) {
    const rel = relative(dirname(t), path).replace(/\.ts$/, "");
    const spec = rel.startsWith(".") ? rel : `./${rel}`;
    // Of the names the test imports from the created module, exactly one is called: the tested function.
    // Auditor (#129): aliases (`{ f as g }`) are followed to the export name; namespace/default imports fail closed.
    // Auditor (#129): the test may only import the runner, strict assert and the created module, and cannot read
    // files/env/processes or name the stub code, so it cannot detect or forge the stub.
    if (gradedTestSourceProblem(tests[i]!, [spec, `${spec}.ts`], moduleFunctions, moduleKeys)) return null;
    const a = importedBindings(tests[i]!, spec);
    const b = importedBindings(tests[i]!, `${spec}.ts`);
    if (!a || !b) return null;
    const called = [...a, ...b].filter((x) => callsFunction(tests[i]!, x.local));
    if (called.length !== 1) return null;
    fns.add(called[0]!.imported);
  }
  if (fns.size !== 1) return null;
  const fn = [...fns][0]!;
  // Auditor (#129): stub EVERY function the fix commit created in the module, not only the tested one.
  let created: string[];
  let fixContent: string;
  try { fixContent = git(repo, "show", `${fixSha}:${path}`); created = declaredFunctions(fixContent); } catch { return null; }
  // Auditor (#129): any callable that is not a top-level `function` declaration (arrow, function expression,
  // class, method, accessor), in the fix's version or today's file, could escape the stubs: fail closed.
  if (hasNonDeclarationCallables(fixContent) || hasNonDeclarationCallables(real)) return null;
  if (!created.includes(fn)) return null;
  const stub = stubAll(real, created);
  if (!stub || (stub.throws && tests.some(expectsThrow))) return null;
  writeFileSync(file, stub.content);
  return { file, real, fn, stubbed: [...created] };
}

/**
 * M80: fix-free grading of a TEST_CASE_EXISTING candidate. The candidate is exactly one new test file; its run on
 * today's code is pass 2 (`afterFix`). It must pass REAL_RUNS_REQUIRED times in all (two more confined runs), then
 * it runs confined with the tested function's body replaced by the write-only type-default stub (M23 route). The
 * stub failure is credited only when the parent saw the stub run and every failing test failed by an assertion.
 * `fixSha` records the task base. Never graded unconfined (Node < 22: not-confined). The test may import only the
 * runner, strict assert and the one sibling module, and call exactly one of its functions (gradedTestSourceProblem,
 * as for the stub route); the target analysis is re-run on the real tree. Reads are narrowed to the test, the
 * module's relative import closure and node_modules.
 */
function gradeExisting(tree: string, files: ReturnType<typeof parseDiff>, newTests: readonly string[], afterFix: boolean, tsx: string, v2 = false, v3 = false, v4 = false, v5 = false, v6 = false, v7 = false): TestGrading {
  // M88: callers set v2 for v3 (public-test-case-existing-v3) candidates too; v3 only adds the global Date.
  // M90: and v2 + v3 for v4 (public-test-case-existing-v4) candidates; v4 only widens the target re-check.
  const base = summary.baseSha;
  const ungradable = (reason: TestGrading["reason"]): TestGrading => ({ fixSha: base, afterFix, beforeFix: null, verdict: "UNGRADABLE", reason });
  const f = files[0];
  if (files.length !== 1 || newTests.length !== 1 || !f || !f.isNew || !f.newPath || f.newPath !== newTests[0] || !scope.isTest(f.newPath) || baseFiles.has(f.newPath)) return ungradable("not-test-only");
  if (Number(process.versions.node.split(".")[0]) < PERMISSION_NODE_MAJOR) return ungradable("not-confined");
  const testPath = f.newPath;
  const test = readFileSync(join(tree, testPath), "utf8");
  const dir = dirname(testPath);
  const specs = [...test.matchAll(/^import [^;\n]* from "(\.\/[\w.-]+)";$/gm)].map((m) => m[1]!);
  if (specs.length !== 1) return ungradable("not-test-only");
  const spec = specs[0]!.replace(/\.ts$/, "");
  const modPath = join(dir, `${spec}.ts`);
  if (!baseFiles.has(modPath) || !scope.isSource(modPath) || scope.isTest(modPath)) return ungradable("not-test-only");
  const file = join(tree, modPath);
  try { if (lstatSync(file).isSymbolicLink() || !lstatSync(file).isFile() || relative(tree, realpathSync(file)).startsWith("..")) return ungradable("not-applied"); } catch { return ungradable("not-applied"); }
  const real = readFileSync(file, "utf8");
  // M88: v3 candidates may build fixed `new Date("<ISO literal>")` values (isDateLiteral); nothing else changes.
  if (gradedTestSourceProblem(test, [spec, `${spec}.ts`], declaredFunctions(real), moduleDataKeys(real), v3)) return ungradable("not-test-only");
  const a = importedBindings(test, spec);
  const b = importedBindings(test, `${spec}.ts`);
  if (!a || !b) return ungradable("not-test-only");
  const imported = [...a, ...b];
  const called = imported.filter((x) => callsFunction(test, x.local));
  if (imported.length !== 1 || called.length !== 1) return ungradable("not-test-only");
  const fn = called[0]!.imported;
  const regular = (rel: string): string | null => {
    try { const p = join(tree, rel); if (!lstatSync(p).isFile() || relative(tree, realpathSync(p)).startsWith("..")) return null; return readFileSync(p, "utf8"); } catch { return null; }
  };
  // M85: a public-test-case-existing-v2 candidate is re-checked under the v2 target (plain-data types, followed
  // sibling imports, sibling reads from the real tree); every other candidate under v1 exactly as before.
  // M88: a public-test-case-existing-v3 candidate is re-checked under the v3 target (v2 plus the global Date).
  // M91: a public-test-case-existing-v5 candidate under the v5 target (v4 plus literal-const typeof and T["k"] lookups).
  // M93: a public-test-case-existing-v6 candidate under the v6 target (v5 plus top-level unknown / NodeJS.ProcessEnv
  // params), and its test must pass an object literal for every `= process.env` default in every call (envArgProblem).
  // M90: a public-test-case-existing-v4 candidate under the v4 target (v3 plus optional / literal-default params,
  // the V4_GENERICS references and the v4 type bounds).
  // M97: a public-test-case-existing-v7 candidate under the v7 target (v6 plus Map / Set types and a void return, with
  // the v7 hardening for targets v6 refuses); its test is re-checked on the graded source, never only on the task text:
  // a void target only in `assert.throws(() => f(..), ..)` (at least once) or `assert.equal(f(..), undefined)`, and every
  // `new Map(..)` / `new Set(..)` a bounded literal.
  // Auditor #466 (3rd review): v1 gets the tree for the load-closure check only (`load`); v1's analysis still reads no sibling.
  if (existingTargetRefusal(modPath, real, fn, v2 ? { v2: { read: (rel) => (scope.isSource(rel) && !scope.isTest(rel) ? regular(rel) : null) }, dates: v3, v4, v5, v6, v7 } : { load: { read: (rel) => (scope.isSource(rel) && !scope.isTest(rel) ? regular(rel) : null) } }) !== null) return ungradable("not-test-only");
  if (v6 && envArgProblem(real, fn, test) !== null) return ungradable("not-test-only");
  if (v7 && (voidTestProblem(real, fn, test) !== null || mapSetTestProblem(test) !== null)) return ungradable("not-test-only");
  // Auditor #466 (4th review), every version: the test side of the fail-closed Date check (dateTestProblem).
  if (dateTestProblem(real, fn, test, called[0]!.local) !== null) return ungradable("not-test-only");
  const reads = moduleReadClosure(modPath, regular);
  if (!reads) return ungradable("module-imports-repo-files");
  // Auditor #466 (4th review), the zone BACKSTOP, every version: the further real runs are one per EXISTING_TZ_RUNS
  // zone (UTC, America/Denver, Asia/Tokyo; more than the REAL_RUNS_REQUIRED - 1 runs this replaces); a test whose
  // result depends on the process zone fails one of them (real-not-stable).
  if (afterFix) for (const tz of EXISTING_TZ_RUNS) if (!runExistingTests(tree, newTests, reads, false, tz).ok) return ungradable("real-not-stable");
  // M88: `v2` is also set for v3 candidates, so a Date return stubs to `{}` as an object return does under v2;
  // deepEqual against a Date literal then fails by assertion (ERR_ASSERTION), the only credited failure.
  const stub = stubAll(real, [fn], v2);
  if (!stub || stub.throws) return ungradable("revert-failed");
  let run: { ok: boolean; out: string; confined: boolean; notes: number };
  writeFileSync(file, stub.content);
  try {
    run = runExistingTests(tree, newTests, reads, true);
  } finally {
    writeFileSync(file, real);
  }
  const credited = !run.ok && stubFailureCredited(run.out, run.notes);
  console.log(`grading: test-existing stub (tested ${fn} in ${modPath}; failure credited: ${credited}; stub notes: ${run.notes}; permission model: ${run.confined}; reads: ${reads.length} module files)`);
  if (!run.ok && !credited) return { ...ungradable("stub-not-reached"), stubbed: [fn] };
  return { fixSha: base, afterFix, beforeFix: run.ok, verdict: gradingVerdict(afterFix, run.ok, !run.ok), reason: null, stubFails: !run.ok, stubbed: [fn] };
}

/**
 * M13: grading of a learned guard against itself. Its new tests already ran with the guard (pass 2,
 * `afterFix`). Here the harness puts the candidate's non-test source files back to the task base (the code
 * without the guard) and runs the new tests again as the sandbox user. Only pass-with-guard AND
 * fail-without counts. `fixSha` records the task base the "before" tree was taken from.
 */
function gradeSelf(tree: string, files: ReturnType<typeof parseDiff>, newTests: readonly string[], afterFix: boolean, tsx: string, addFunction = false, workflowStep = false, derive = false, replaceExpression = false): TestGrading {
  const base = summary.baseSha;
  const ungradable = (reason: TestGrading["reason"]): TestGrading => ({ fixSha: base, afterFix, beforeFix: null, verdict: "UNGRADABLE", reason });
  if (workflowStep) return gradeWorkflowStep(tree, files, ungradable);
  // M19: an opted-in workflow edited by the workflow-step rule is put back to the base like a source file.
  const source = files.filter((f) => !f.isNew && f.newPath && f.oldPath === f.newPath && ((scope.isSource(f.newPath) && !scope.isTest(f.newPath)) || (workflowStep && !!scope.isWorkflow?.(f.newPath)))).map((f) => f.newPath!);
  // M17: a new source module (ADD_FUNCTION new-module) is taken back out by removing it.
  const created = files.filter((f) => f.isNew && f.newPath && scope.isSource(f.newPath) && !scope.isTest(f.newPath)).map((f) => f.newPath!);
  const tests = files.filter((f) => f.isNew && f.newPath && scope.isTest(f.newPath));
  if (newTests.length === 0 || source.length + created.length === 0 || source.length + created.length + tests.length !== files.length) return ungradable("not-test-only");
  // M17 (Auditor), ADD_FUNCTION only: every new test must CALL the added function, and must also FAIL with the
  // function's body replaced by a type-default stub. Both run before the revert (on the candidate's own tree).
  let stubFails: boolean | undefined;
  if (addFunction) {
    const src = [...source, ...created];
    const added = files.flatMap((f) => f.addedLines).map((l) => /^export function ([A-Za-z_$][\w$]*)\(/.exec(l)?.[1]).filter((n): n is string => !!n);
    if (src.length !== 1 || added.length !== 1) return ungradable("not-test-only");
    const fn = added[0]!;
    const file = join(tree, src[0]!);
    if (lstatSync(file).isSymbolicLink() || relative(tree, realpathSync(file)).startsWith("..")) return ungradable("not-applied");
    if (!newTests.every((t) => callsFunction(readFileSync(join(tree, t), "utf8"), fn))) return ungradable("not-test-only");
    const real = readFileSync(file, "utf8");
    // M99, DERIVE_FROM_BEHAVIOR: the new module is exactly the derived function (re-checked against the DSL grammar),
    // and the new tests pass in every zone of EXISTING_TZ_RUNS (the candidate's tests read no clock, but prove it).
    if (derive) {
      if (created.length !== 1 || source.length !== 0 || derivedModuleProblem(real)) return ungradable("not-test-only");
      // Auditor #491: those runs are confined (Node's permission model: reads = the test file, the new module and
      // node_modules; no write, no child process), as TEST_CASE_EXISTING's are. Never graded unconfined.
      if (Number(process.versions.node.split(".")[0]) < PERMISSION_NODE_MAJOR) return ungradable("not-confined");
      if (afterFix) for (const tz of EXISTING_TZ_RUNS) if (!runExistingTests(tree, newTests, created, false, tz).ok) return ungradable("real-not-stable");
    }
    const stub = stubFunction(real, fn);
    if (stub === null) return ungradable("not-test-only");
    writeFileSync(file, stub);
    stubFails = !runCandidate(tree, tsx, ["--test", ...newTests]);
    writeFileSync(file, real);
  }
  if (source.length && !runTrusted(tree, "git", ["checkout", "-q", base, "--", ...source])) return ungradable("revert-failed");
  if (created.length && !runTrusted(tree, "rm", ["-f", "--", ...created])) return ungradable("revert-failed");
  if (replaceExpression) {
    // Auditor (#136, 2): the before-run must fail by assertions only (a value of the edited function), never by a
    // crash, load/import error or other throw.
    const run = runCandidateCapture(tree, tsx, ["--test", ...newTests]);
    if (!run.ok && !assertionFailuresOnly(run.out)) return ungradable("before-not-assertion");
    return { fixSha: base, afterFix, beforeFix: run.ok, verdict: gradingVerdict(afterFix, run.ok), reason: null };
  }
  const beforeFix = runCandidate(tree, tsx, ["--test", ...newTests]);
  return { fixSha: base, afterFix, beforeFix, verdict: gradingVerdict(afterFix, beforeFix, stubFails), reason: null, ...(stubFails === undefined ? {} : { stubFails }) };
}

/**
 * Auditor (#107, change 4): a workflow step is graded by running its own script, not by a test that finds the
 * line. afterFix = the script exits 0 on the candidate tree; beforeFix = the same script on the same tree with a
 * deliberately broken type input injected (must FAIL). COUNTS here is necessary only: the live proof also
 * records two real Actions run ids (peaceai/proof/workflow-step-proof.md).
 */
function gradeWorkflowStep(tree: string, files: ReturnType<typeof parseDiff>, ungradable: (r: TestGrading["reason"]) => TestGrading): TestGrading {
  const base = summary.baseSha;
  if (files.length !== 1 || !scope.isWorkflow?.(files[0]!.newPath ?? "")) return ungradable("not-test-only");
  const run = /run: (?:npm|pnpm) run ([a-z][\w:-]{0,40})$/.exec(files[0]!.addedLines[1] ?? "");
  if (!run) return ungradable("not-test-only");
  let scripts: Record<string, unknown>;
  try { scripts = (JSON.parse(readFileSync(join(tree, "package.json"), "utf8")) as { scripts?: Record<string, unknown> }).scripts ?? {}; } catch { return ungradable("not-test-only"); }
  const regularInTree = (p: string) => { try { const f = join(tree, p); return lstatSync(f).isFile() && !relative(tree, realpathSync(f)).startsWith(".."); } catch { return false; } };
  const words = workflowScript(scripts, run[1]!, regularInTree);
  if (!words) return ungradable("not-test-only");
  const tsc = join(tree, "node_modules", ".bin", "tsc");
  const afterFix = runCandidate(tree, tsc, words.slice(1));
  const listed = runCandidateCapture(tree, tsc, [...words.slice(1), "--listFilesOnly"]);
  const target = listed.out.split("\n").map((l) => l.trim()).find((l) => l && /\.tsx?$/.test(l) && !/\.d\.ts$/.test(l) && !relative(tree, l).startsWith("..") && !relative(tree, l).split("/").includes("node_modules"));
  if (!target) return ungradable("not-test-only");
  if (lstatSync(target).isSymbolicLink() || relative(tree, realpathSync(target)).startsWith("..")) return ungradable("not-applied");
  const real = readFileSync(target, "utf8");
  writeFileSync(target, real + BROKEN_TYPE_LINE);
  const beforeFix = runCandidate(tree, tsc, words.slice(1));
  writeFileSync(target, real);
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
    const digestBefore = digestProtected ? protectedDigest(tree) : "";
    if (!runTrusted(tree, "git", ["apply", "--check", "--whitespace=nowarn", diffPath])) continue;
    if (!runTrusted(tree, "git", ["apply", "--whitespace=nowarn", diffPath])) continue;
    // M72: applying the candidate must leave every protected file byte-identical; otherwise it never counts.
    if (digestProtected && protectedDigest(tree) !== digestBefore) { console.log(`${candidate.id} protected_digest=changed stage=apply`); continue; }
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
    if (candidate.selfGrade && candidate.transformations.includes("LEARNED_TEST_EXISTING")) result.testGrading = gradeExisting(tree, files, newTests, result.newTestsPassed, tsx, typeof candidate.operationId === "string" && (candidate.operationId.startsWith("learned:public-test-case-existing-v2@") || candidate.operationId.startsWith("learned:public-test-case-existing-v3@") || candidate.operationId.startsWith("learned:public-test-case-existing-v4@") || candidate.operationId.startsWith("learned:public-test-case-existing-v5@") || candidate.operationId.startsWith("learned:public-test-case-existing-v6@") || candidate.operationId.startsWith("learned:public-test-case-existing-v7@")), typeof candidate.operationId === "string" && (candidate.operationId.startsWith("learned:public-test-case-existing-v3@") || candidate.operationId.startsWith("learned:public-test-case-existing-v4@") || candidate.operationId.startsWith("learned:public-test-case-existing-v5@") || candidate.operationId.startsWith("learned:public-test-case-existing-v6@") || candidate.operationId.startsWith("learned:public-test-case-existing-v7@")), typeof candidate.operationId === "string" && (candidate.operationId.startsWith("learned:public-test-case-existing-v4@") || candidate.operationId.startsWith("learned:public-test-case-existing-v5@") || candidate.operationId.startsWith("learned:public-test-case-existing-v6@") || candidate.operationId.startsWith("learned:public-test-case-existing-v7@")), typeof candidate.operationId === "string" && (candidate.operationId.startsWith("learned:public-test-case-existing-v5@") || candidate.operationId.startsWith("learned:public-test-case-existing-v6@") || candidate.operationId.startsWith("learned:public-test-case-existing-v7@")), typeof candidate.operationId === "string" && (candidate.operationId.startsWith("learned:public-test-case-existing-v6@") || candidate.operationId.startsWith("learned:public-test-case-existing-v7@")), typeof candidate.operationId === "string" && candidate.operationId.startsWith("learned:public-test-case-existing-v7@"));
    else if (candidate.selfGrade) result.testGrading = gradeSelf(tree, files, newTests, result.newTestsPassed, tsx, candidate.transformations.includes("LEARNED_ADD_FUNCTION") || candidate.transformations.includes("LEARNED_DERIVE_FROM_BEHAVIOR"), candidate.transformations.includes("LEARNED_ADD_WORKFLOW_STEP"), candidate.transformations.includes("LEARNED_DERIVE_FROM_BEHAVIOR"), candidate.transformations.includes("LEARNED_REPLACE_EXPRESSION"));
    // M72: and after every pass (repair, type check, suites, grading) the protected files are still unchanged.
    if (digestProtected && protectedDigest(tree) !== digestBefore) {
      console.log(`${candidate.id} protected_digest=changed stage=tests`);
      Object.assign(result, { applied: false, typecheckPassed: false, originalSuitePassed: false, newTestsPassed: false });
      if (result.testGrading) result.testGrading = { ...result.testGrading, afterFix: false, beforeFix: null, verdict: "UNGRADABLE" };
    }
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
