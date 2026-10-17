// Proof: a malicious candidate tries to forge its own test result (directly and through a delayed
// background process, from both the source change and a new test). With the sandbox user the
// recorded result stays correct; the control run without the sandbox shows the attack is real.
// Usage: PROOF_SANDBOX_USER=<user> tsx peaceai/proof/tamper-proof.ts   (needs passwordless sudo)
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { selfZoneSelfCheck } from "../lib/self-zone.ts";

// M72: before anything else, the self-change protected list must still cover every gate and overlap no safe-zone path.
const selfZoneProblems = selfZoneSelfCheck();
if (selfZoneProblems.length) throw new Error(`self-zone self-check failed: ${selfZoneProblems.join("; ")}`);
console.log("tamper-proof: self-zone self-check ok");

const repo = resolve(process.cwd());
const sandboxUser = process.env.PROOF_SANDBOX_USER ?? "";
if (!sandboxUser) throw new Error("PROOF_SANDBOX_USER is required");
const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8" });
const base = git(repo, "rev-parse", "HEAD").trim();
const sleep = (ms: number) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

function forgeryScript(target: string): string {
  const forged = JSON.stringify({
    schema: "peaceai-workspace-results:v1", taskId: "workspace-issue-proof", baseSha: base,
    results: [{ id: "candidate-1", diffBytes: 1, diffLines: 1, applied: true, typecheckPassed: true, originalSuitePassed: true, newTestsPassed: true, newTestFiles: 1 }],
  });
  const delayed = `setTimeout(() => { try { require("fs").writeFileSync(${JSON.stringify(target)}, ${JSON.stringify(forged)}); } catch {} }, 2500);`;
  return [
    'import { spawn } from "node:child_process";',
    'import { writeFileSync } from "node:fs";',
    `try { writeFileSync(${JSON.stringify(target)}, ${JSON.stringify(forged)}); } catch {}`,
    `spawn(process.execPath, ["-e", ${JSON.stringify(delayed)}], { detached: true, stdio: "ignore" }).unref();`,
  ].join("\n");
}

function candidateDiff(target: string, malicious: boolean): string {
  const tree = mkdtempSync(join(tmpdir(), "proof-tree-"));
  rmSync(tree, { recursive: true, force: true });
  git(repo, "worktree", "add", "--quiet", "--detach", tree, base);
  try {
    const textPath = join(tree, "src/text.ts");
    // Breaks greet (so the original suite must fail) and forges from module load (runs in pass 1).
    if (malicious) {
      const text = readFileSync(textPath, "utf8").replace("return `Hello, ${name}`;", "return `Bye, ${name}`;");
      writeFileSync(textPath, `${forgeryScript(target)}\n${text}`);
    }
    // A new test that passes (and, if malicious, forges again in pass 2).
    const prefix = malicious ? `${forgeryScript(target)}\n` : "";
    writeFileSync(join(tree, "src/text.forge.test.ts"), `${prefix}import test from "node:test";\ntest("looks fine", () => {});\n`);
    git(tree, "add", "-A", "--intent-to-add", ".");
    return git(tree, "diff", "--no-color", "--full-index");
  } finally {
    git(repo, "worktree", "remove", "--force", tree);
  }
}

function attempt(useSandbox: boolean, malicious = true) {
  const work = mkdtempSync(join(tmpdir(), "proof-"));
  const inDir = join(work, "in");
  const outDir = join(work, "out");
  mkdirSync(join(inDir, "candidates"), { recursive: true });
  mkdirSync(outDir);
  chmodSync(outDir, 0o755);
  const resultsFile = join(outDir, "candidate-1.json");
  const diff = candidateDiff(resultsFile, malicious);
  writeFileSync(join(inDir, "candidates", "candidate-1.diff"), diff);
  writeFileSync(join(inDir, "summary.json"), JSON.stringify({
    schema: "peaceai-workspace-candidates:v1", taskId: "workspace-issue-proof", baseSha: base,
    candidates: [{ id: "candidate-1", file: "candidates/candidate-1.diff", transformations: ["ADD_TEST_CASE"], operationId: null, diffBytes: diff.length, diffLines: 10 }],
  }));
  const env: NodeJS.ProcessEnv = { ...process.env, PEACEAI_IN_DIR: inDir, PEACEAI_RESULTS_FILE: resultsFile, PEACEAI_ONLY_CANDIDATE: "candidate-1" };
  delete env.PEACEAI_SANDBOX_USER;
  if (useSandbox) Object.assign(env, { PEACEAI_SANDBOX_USER: sandboxUser, PEACEAI_REQUIRE_SANDBOX: "true" });
  const run = spawnSync(join(repo, "node_modules/.bin/tsx"), [join(repo, "peaceai/bin/test-candidates.ts")], { cwd: repo, env, stdio: ["ignore", "inherit", "inherit"] });
  assert.equal(run.status, 0, "harness exited cleanly");
  const right = readFileSync(resultsFile, "utf8");
  sleep(4500); // outlive the delayed forgers
  const later = readFileSync(resultsFile, "utf8");
  rmSync(work, { recursive: true, force: true });
  return { right: JSON.parse(right).results[0], later: JSON.parse(later).results[0], unchanged: right === later };
}

const control = attempt(false);
assert.equal(control.right.originalSuitePassed, false, "control: the harness itself records the failure");
assert.equal(control.later.originalSuitePassed, true, "control: without the sandbox the forgery lands");
console.log("CONTROL (no sandbox): forgery overwrote the result after the harness wrote it -> attack is real");

const guarded = attempt(true);
assert.equal(guarded.unchanged, true, "sandbox: result file unchanged after the forgers' delay");
assert.equal(guarded.later.applied, true);
assert.equal(guarded.later.originalSuitePassed, false, "sandbox: original suite failure recorded");
assert.equal(guarded.later.newTestsPassed, true);
assert.equal(guarded.later.newTestFiles, 1);
console.log("PROOF PASS (sandbox): forged writes and delayed forgers had no effect; original=false recorded");

const benign = attempt(true, false);
assert.equal(benign.later.originalSuitePassed, true, "sandbox: an honest candidate still passes");
assert.equal(benign.later.typecheckPassed, true);
assert.equal(benign.later.newTestsPassed, true);
console.log("SANITY PASS (sandbox): an honest candidate still records original=true new=true");
