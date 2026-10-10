// Job B: apply each candidate to a clean checkout and test it. No secrets, no core.
import { spawnSync, execFileSync } from "node:child_process";
import { chmodSync, cpSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { parseDiff } from "../lib/diff.ts";
import { validateSummary } from "../lib/gate.ts";
import type { CandidateResult } from "../lib/rank.ts";
import { checkCandidateScope, TEST_FILE } from "../lib/scope.ts";

const inDir = resolve(process.env.PEACEAI_IN_DIR ?? "");
const resultsFile = resolve(process.env.PEACEAI_RESULTS_FILE ?? "");
const repo = resolve(process.env.PEACEAI_WORKSPACE_DIR ?? process.cwd());
const STEP_TIMEOUT_MS = 120_000;

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
function runCandidate(cwd: string, command: string, args: string[]): boolean {
  const envArgs = Object.entries(cleanEnv).map(([k, v]) => `${k}=${v}`);
  const result = sandboxUser
    ? spawnSync("sudo", ["-n", "-u", sandboxUser, "--", "/usr/bin/env", "-i", ...envArgs, command, ...args], {
        cwd, stdio: "ignore", timeout: STEP_TIMEOUT_MS, killSignal: "SIGKILL",
      })
    : spawnSync(command, args, { cwd, env: cleanEnv, stdio: "ignore", timeout: STEP_TIMEOUT_MS, killSignal: "SIGKILL" });
  killSandbox();
  return result.status === 0;
}

const summary = JSON.parse(readFileSync(join(inDir, "summary.json"), "utf8"));
if (!validateSummary(summary)) throw new Error("summary.json failed schema validation");
const baseFiles = new Set(git(repo, "ls-tree", "-r", "--name-only", "-z", summary.baseSha).split("\0").filter(Boolean));

// In CI each candidate runs in its own matrix job (fresh runner, own read-only tools copy).
const only = process.env.PEACEAI_ONLY_CANDIDATE ?? "";
if (only && !summary.candidates.some((c) => c.id === only)) throw new Error("unknown candidate");
const selected = only ? summary.candidates.filter((c) => c.id === only) : summary.candidates;

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
  results.push(result);
  // Defense in depth: re-check scope without the core.
  if (checkCandidateScope(files, baseFiles).length > 0) continue;
  // The tree is owned by this harness and only readable by the sandbox user; it gets its own tools copy.
  const tree = mkdtempSync(join(sandboxRoot, "peaceai-test-"));
  rmSync(tree, { recursive: true, force: true });
  git(repo, "worktree", "add", "--quiet", "--detach", tree, summary.baseSha);
  try {
    chmodSync(tree, 0o755);
    cpSync(join(repo, "node_modules"), join(tree, "node_modules"), { recursive: true, verbatimSymlinks: true });
    const tsx = join(tree, "node_modules", ".bin", "tsx");
    const tsc = join(tree, "node_modules", ".bin", "tsc");
    const originalTests = [...baseFiles].filter((path) => /^src\/.+\.test\.ts$/.test(path)).sort();
    if (!runTrusted(tree, "git", ["apply", "--check", "--whitespace=nowarn", diffPath])) continue;
    if (!runTrusted(tree, "git", ["apply", "--whitespace=nowarn", diffPath])) continue;
    result.applied = true;
    const newTests = files
      .filter((file) => file.isNew && file.newPath && TEST_FILE.test(file.newPath))
      .map((file) => file.newPath!)
      .sort();
    result.newTestFiles = newTests.length;
    result.typecheckPassed = runCandidate(tree, tsc, ["-p", "tsconfig.json", "--noEmit"]);
    // Pass 1: the original suite, with every new test file moved out of the tree.
    const parked = mkdtempSync(join(tmpdir(), "peaceai-parked-"));
    newTests.forEach((path, i) => renameSync(join(tree, path), join(parked, String(i))));
    result.originalSuitePassed = originalTests.length > 0 && runCandidate(tree, tsx, ["--test", ...originalTests]);
    newTests.forEach((path, i) => {
      mkdirSync(dirname(join(tree, path)), { recursive: true });
      renameSync(join(parked, String(i)), join(tree, path));
    });
    rmSync(parked, { recursive: true, force: true });
    // Pass 2: only the new tests, in a separate process.
    result.newTestsPassed = newTests.length === 0 ? true : runCandidate(tree, tsx, ["--test", ...newTests]);
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
for (const r of results)
  console.log(`${r.id} applied=${r.applied} typecheck=${r.typecheckPassed} original=${r.originalSuitePassed} new=${r.newTestsPassed} new_files=${r.newTestFiles}`);
