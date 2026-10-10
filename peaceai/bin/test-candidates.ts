// Job B: apply each candidate to a clean checkout and test it. No secrets, no core.
import { spawnSync, execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
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

// Candidate code runs with a minimal environment: no tokens, no runner internals.
const cleanEnv = { PATH: process.env.PATH ?? "", HOME: tmpdir(), CI: "true", NODE_ENV: "test" };
function run(cwd: string, command: string, args: string[]): boolean {
  const result = spawnSync(command, args, { cwd, env: cleanEnv, stdio: "ignore", timeout: STEP_TIMEOUT_MS, killSignal: "SIGKILL" });
  return result.status === 0;
}

const summary = JSON.parse(readFileSync(join(inDir, "summary.json"), "utf8"));
if (!validateSummary(summary)) throw new Error("summary.json failed schema validation");
const baseFiles = new Set(git(repo, "ls-tree", "-r", "--name-only", "-z", summary.baseSha).split("\0").filter(Boolean));
const tsx = join(repo, "node_modules", ".bin", "tsx");
const tsc = join(repo, "node_modules", ".bin", "tsc");

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
  const tree = mkdtempSync(join(tmpdir(), "peaceai-test-"));
  rmSync(tree, { recursive: true, force: true });
  git(repo, "worktree", "add", "--quiet", "--detach", tree, summary.baseSha);
  try {
    symlinkSync(join(repo, "node_modules"), join(tree, "node_modules"), "dir");
    const originalTests = [...baseFiles].filter((path) => /^src\/.+\.test\.ts$/.test(path)).sort();
    if (!run(tree, "git", ["apply", "--check", "--whitespace=nowarn", diffPath])) continue;
    if (!run(tree, "git", ["apply", "--whitespace=nowarn", diffPath])) continue;
    result.applied = true;
    const newTests = files
      .filter((file) => file.isNew && file.newPath && TEST_FILE.test(file.newPath))
      .map((file) => file.newPath!)
      .sort();
    result.newTestFiles = newTests.length;
    result.typecheckPassed = run(tree, tsc, ["-p", "tsconfig.json", "--noEmit"]);
    // Pass 1: the original suite, with every new test file moved out of the tree.
    const parked = mkdtempSync(join(tmpdir(), "peaceai-parked-"));
    newTests.forEach((path, i) => renameSync(join(tree, path), join(parked, String(i))));
    result.originalSuitePassed = originalTests.length > 0 && run(tree, tsx, ["--test", ...originalTests]);
    newTests.forEach((path, i) => {
      mkdirSync(dirname(join(tree, path)), { recursive: true });
      renameSync(join(parked, String(i)), join(tree, path));
    });
    rmSync(parked, { recursive: true, force: true });
    // Pass 2: only the new tests, in a separate process.
    result.newTestsPassed = newTests.length === 0 ? true : run(tree, tsx, ["--test", ...newTests]);
  } finally {
    git(repo, "worktree", "remove", "--force", tree);
    if (existsSync(tree)) rmSync(tree, { recursive: true, force: true });
  }
}

writeFileSync(
  resultsFile,
  JSON.stringify({ schema: "peaceai-workspace-results:v1", taskId: summary.taskId, baseSha: summary.baseSha, results }, null, 2) + "\n",
);
for (const r of results)
  console.log(`${r.id} applied=${r.applied} typecheck=${r.typecheckPassed} original=${r.originalSuitePassed} new=${r.newTestsPassed} new_files=${r.newTestFiles}`);
