// M227: Job A replay records. A pass is a candidate count from a run, bound to head+tree+log.
// EXPERIMENTAL. credit is false. No network, no kernel.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { buildCapabilityReport, type ReplayBind } from "../lib/capabilityreport.ts";
import { CORE_ENTRY, boundReplay, classifyJobOutput, commitRef, rowUnrunnable } from "../lib/capabilityjob.ts";
import { archiveSha256, coreStillPinned, extractPinnedCore, gitTreeSha, pinnedKernel, readCorePin, type CorePin } from "../bin/capability-job.ts";

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

function packCore(): { archive: string; pin: CorePin; caller: string } {
  const caller = mkdtempSync(join(tmpdir(), "peaceai-src-"));
  const entry = join(caller, "packages/coding-kernel/src");
  mkdirSync(entry, { recursive: true });
  writeFileSync(join(entry, "ActionsKernel.ts"), "export const kernel = 1;\n");
  const tree = gitTreeSha(caller);
  const archive = join(tmpdir(), `peaceai-core-${process.pid}.tar`);
  execFileSync("tar", ["-cf", archive, "-C", caller, "."]);
  return { archive, caller, pin: { schema: "peaceai-core-pin:v1", commit: "a".repeat(40), archiveSha256: archiveSha256(archive), tree } };
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
