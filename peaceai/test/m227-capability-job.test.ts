// M227: Job A replay records. A pass is a candidate count from a run, bound to head+tree+log.
// EXPERIMENTAL. credit is false. No network, no kernel.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { buildCapabilityReport, type ReplayBind } from "../lib/capabilityreport.ts";
import { CORE_ENTRY, boundReplay, classifyJobOutput, commitRef, rowUnrunnable } from "../lib/capabilityjob.ts";
import { indexGitTree } from "../lib/coreindex.ts";
import { archiveSha256, coreStillPinned, extractPinnedCore, gitTreeSha, pinnedKernel, readCorePin, type CorePin } from "../bin/capability-job.ts";

const repo = resolve(import.meta.dirname, "../..");
const tsx = join(repo, "node_modules/.bin/tsx");

const log = readFileSync(resolve(import.meta.dirname, "../../builder-log/tasks.jsonl"), "utf8");
const HEAD = "a".repeat(40);
const TREE = "b".repeat(40);
const INPUT = "c".repeat(64);
const bind: ReplayBind = { head: HEAD, tree: TREE, input: INPUT, coreCommit: "c".repeat(40), archiveSha256: "d".repeat(64) };

test("a row with no repo sha cannot be run, and a candidate is the only pass", () => {
  assert.equal(commitRef("none (no code)"), null);
  assert.match(rowUnrunnable("none (no code)") ?? "", /NO_COMMIT/);
  assert.deepEqual(commitRef("PeaceAI-Workspace#1, PeaceSTOCKS@abcdef1"), { repo: "PeaceSTOCKS", sha: "abcdef1" });
  assert.deepEqual(classifyJobOutput({ timedOut: false, code: 0, candidates: 1, stdout: "" }), { status: "pass", reason: "JOB_A_CANDIDATES:1" });
  assert.equal(classifyJobOutput({ timedOut: false, code: 0, candidates: 0, stdout: "nl=unsure reason=no_family\n" }).status, "fail");
  const line = classifyJobOutput({ timedOut: false, code: 0, candidates: 0, stdout: "learned refusals: public-derive-wire-rethrow-v1=wire_trigger; public-test-case-existing-v1=task_unparsed\n" });
  assert.equal(line.status, "fail");
  assert.match(line.reason, /wire_trigger/);
  assert.match(line.reason, /task_unparsed/);
  assert.equal(classifyJobOutput({ timedOut: true, code: null, candidates: null, stdout: "" }).reason, "TIMEOUT");
  assert.equal(classifyJobOutput({ timedOut: false, code: null, candidates: null, stdout: "" }).reason, "SPAWN_FAILED");
});

test("a Job A pass counts only when it is bound to the head, tree, and log", () => {
  const seq = buildCapabilityReport(log, "2026-11-10", null, [], null, bind).rows.find((r) => r.inSet)!.seq;
  const stale = buildCapabilityReport(log, "2026-11-10", null, [boundReplay(seq, "pass", "JOB_A_CANDIDATES:1", { ...bind, head: "d".repeat(40) })], null, bind);
  assert.equal(stale.passes, 0);
  assert.equal(stale.rows.find((r) => r.seq === seq)?.reason, "STALE_HEAD");
  const hand = buildCapabilityReport(log, "2026-11-10", null, [{ seq, status: "pass", reason: "hand" }], null, bind);
  assert.equal(hand.passes, 0);
  assert.equal(hand.rows.find((r) => r.seq === seq)?.status, "unmeasured");
  const ok = buildCapabilityReport(log, "2026-11-10", null, [boundReplay(seq, "pass", "JOB_A_CANDIDATES:1", bind)], null, bind);
  assert.equal(ok.passes, 1);
  assert.equal(ok.rows.find((r) => r.seq === seq)?.status, "pass");
  const dropped = buildCapabilityReport(log, "2026-11-10", null, [{ seq, status: "pass", reason: "JOB_A_CANDIDATES:1", head: bind.head, tree: bind.tree, input: bind.input }], null, bind);
  assert.equal(dropped.passes, 0);
  assert.equal(dropped.rows.find((r) => r.seq === seq)?.reason, "CORE_PIN");
});

function packCore(source = "export const kernel = 1;\n"): { archive: string; pin: CorePin; caller: string } {
  const caller = mkdtempSync(join(tmpdir(), "peaceai-src-"));
  const entry = join(caller, "packages/coding-kernel/src");
  mkdirSync(entry, { recursive: true });
  writeFileSync(join(entry, "ActionsKernel.ts"), source);
  const tree = gitTreeSha(caller);
  const archive = join(tmpdir(), `peaceai-core-${process.pid}-${Math.random().toString(16).slice(2)}.tar`);
  execFileSync("tar", ["-cf", archive, "-C", caller, "."]);
  return { archive, caller, pin: { schema: "peaceai-core-pin:v1", commit: "a".repeat(40), archiveSha256: archiveSha256(archive), tree } };
}

function editDiff(added: string): string {
  return [
    "diff --git a/src/text.ts b/src/text.ts",
    "index 1111111..2222222 100644",
    "--- a/src/text.ts",
    "+++ b/src/text.ts",
    "@@ -1 +1,2 @@",
    " export const a = 1;",
    `+${added}`,
    "",
  ].join("\n");
}

/** Run gate.ts against a core directory and one synthetic candidate. */
function scoreGate(coreDir: string, diff: string): { status: number | null; stdout: string; stderr: string } {
  const ws = mkdtempSync(join(tmpdir(), "peaceai-gate-ws-"));
  const out = mkdtempSync(join(tmpdir(), "peaceai-gate-out-"));
  try {
    mkdirSync(join(ws, "src"));
    writeFileSync(join(ws, "src/text.ts"), "export const a = 1;\n");
    execFileSync("git", ["init", "-q"], { cwd: ws, stdio: "ignore" });
    execFileSync("git", ["add", "-A"], { cwd: ws, stdio: "ignore" });
    execFileSync("git", ["-c", "user.name=PeaceG03", "-c", "user.email=301894882+PeaceG03@users.noreply.github.com", "-c", "commit.gpgsign=false", "commit", "-qm", "base"], { cwd: ws, stdio: "ignore" });
    const baseSha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ws, encoding: "utf8" }).trim();
    mkdirSync(join(out, "candidates"));
    writeFileSync(join(out, "candidates", "candidate-1.diff"), diff);
    writeFileSync(join(out, "summary.json"), JSON.stringify({
      schema: "peaceai-workspace-candidates:v1",
      taskId: "workspace-issue-1",
      baseSha,
      candidates: [{ id: "candidate-1", file: "candidates/candidate-1.diff", transformations: ["EDIT_FILE"], operationId: null, diffBytes: Buffer.byteLength(diff), diffLines: diff.split("\n").length }],
    }) + "\n");
    const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("NODE_TEST") && !/^GIT_(DIR|WORK_TREE|INDEX_FILE|COMMON_DIR|OBJECT_DIRECTORY|ALTERNATE_OBJECT_DIRECTORIES|NAMESPACE|PREFIX)$/.test(k)));
    const ran = spawnSync(tsx, [join(repo, "peaceai/bin/gate.ts")], {
      cwd: repo, encoding: "utf8",
      env: { ...env, PEACEAI_OUT_DIR: out, PEACEAI_WORKSPACE_DIR: ws, PEACEAI_CORE_DIR: coreDir, PEACEAI_TARGET: "PeaceG03/PeaceAI-Workspace" },
    });
    return { status: ran.status, stdout: ran.stdout ?? "", stderr: ran.stderr ?? "" };
  } finally {
    rmSync(ws, { recursive: true, force: true });
    rmSync(out, { recursive: true, force: true });
  }
}

test("the committed pin is the only core that is accepted", () => {
  const reviewed = readCorePin(readFileSync(join(process.cwd(), "peaceai/core-pin.json"), "utf8"));
  assert.equal(reviewed?.commit, "caa7e8a9d835292c33becab4e9a3537ef452217f");
  assert.equal(reviewed?.archiveSha256, "64e5aa8edfd20e2245e776faafadacd7e4924bbf5e62e4907217ab961bdc259a");
  assert.equal(reviewed?.tree.length, 40);
  const missing = extractPinnedCore(join(tmpdir(), "missing.tar"), reviewed);
  assert.match("error" in missing ? missing.error : "", /CORE_ARCHIVE_MISSING/);
  const made = packCore();
  try {
    assert.match((extractPinnedCore(made.archive, reviewed) as { error: string }).error, /CORE_ARCHIVE_MISMATCH/);
    const opened = extractPinnedCore(made.archive, made.pin);
    assert.ok(!("error" in opened));
    if ("error" in opened) return;
    try {
      assert.equal(statSync(opened.dir).mode & 0o777, 0o700);
      assert.equal(coreStillPinned(opened.root, made.pin), null);
      assert.equal(readFileSync(join(opened.root, CORE_ENTRY), "utf8").includes("poisoned"), false);
      writeFileSync(join(made.caller, CORE_ENTRY), "export const poisoned = 1;\n");
      assert.equal(readFileSync(join(opened.root, CORE_ENTRY), "utf8").includes("poisoned"), false);
      const refused = pinnedKernel(made.archive, made.pin, process.cwd(), (root) => writeFileSync(join(root, CORE_ENTRY), "export const poisoned = 1;\n"));
      assert.match(("error" in refused ? refused.error : ""), /CORE_TREE_MISMATCH/);
    } finally { opened.dispose(); }
    assert.equal(readCorePin("{\"commit\":\"aa\"}"), null);
  } finally {
    rmSync(made.caller, { recursive: true, force: true });
    rmSync(made.archive, { force: true });
  }
});

test("a pin-checked extract is a git checkout of the pin tree, so gate.ts scores a raw archive", () => {
  const copied = "export function pinBoundMarker(alpha: number, beta: number): number { return alpha + beta; }";
  assert.ok(copied.length >= 60);
  const made = packCore(`${copied}\n`);
  try {
    const listing = execFileSync("tar", ["-tf", made.archive], { encoding: "utf8" });
    assert.equal(listing.includes(".git"), false);
    const raw = scoreGate(made.caller, editDiff("export const freshMarker = 1;"));
    assert.notEqual(raw.status, 0);
    assert.match(`${raw.stdout}\n${raw.stderr}`, /not a git repository/);
    assert.doesNotMatch(raw.stdout, /GATE PASS/);
    const opened = extractPinnedCore(made.archive, made.pin);
    assert.equal("error" in opened, false);
    if ("error" in opened) return;
    try {
      assert.equal(statSync(join(opened.root, ".git")).isDirectory(), true);
      const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("GIT_")));
      assert.equal(execFileSync("git", ["write-tree"], { cwd: opened.root, env, encoding: "utf8" }).trim(), made.pin.tree);
      assert.equal(gitTreeSha(opened.root), made.pin.tree);
      assert.equal(coreStillPinned(opened.root, made.pin), null);
      assert.equal(indexGitTree(opened.root).paths.has(CORE_ENTRY), true);
      const accepted = scoreGate(opened.root, editDiff("export const freshMarker = 1;"));
      assert.equal(accepted.status, 0, `${accepted.stdout}\n${accepted.stderr}`);
      assert.match(accepted.stdout, /GATE PASS candidates=1/);
      assert.doesNotMatch(`${accepted.stdout}\n${accepted.stderr}`, /not a git repository/);
      const rejected = scoreGate(opened.root, editDiff(copied));
      assert.notEqual(rejected.status, 0);
      assert.match(rejected.stdout, /GATE FAIL candidate-1: core-text: 1 line match\(es\), 0 shingle match\(es\)/);
      assert.doesNotMatch(`${rejected.stdout}\n${rejected.stderr}`, /not a git repository/);
    } finally { opened.dispose(); }
  } finally {
    rmSync(made.caller, { recursive: true, force: true });
    rmSync(made.archive, { force: true });
  }
});
