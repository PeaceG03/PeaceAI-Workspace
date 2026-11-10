// M227: Job A replay records. A pass is a candidate count from a run, bound to head+tree+log.
// EXPERIMENTAL. credit is false. No network, no kernel.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { buildCapabilityReport, type ReplayBind } from "../lib/capabilityreport.ts";
import { boundReplay, classifyJobOutput, commitRef, rowUnrunnable } from "../lib/capabilityjob.ts";
import { archiveSha256, coreProblem, gitTreeSha, readCorePin } from "../bin/capability-job.ts";

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

test("the committed pin is the only core that is accepted", () => {
  const reviewed = readCorePin(readFileSync(join(process.cwd(), "peaceai/core-pin.json"), "utf8"));
  assert.equal(reviewed?.commit, "caa7e8a9d835292c33becab4e9a3537ef452217f");
  assert.equal(reviewed?.archiveSha256, "64e5aa8edfd20e2245e776faafadacd7e4924bbf5e62e4907217ab961bdc259a");
  assert.equal(reviewed?.tree.length, 40);
  const dir = mkdtempSync(join(tmpdir(), "peaceai-core-"));
  try {
    assert.match(coreProblem(dir, join(dir, "missing.tar"), reviewed) ?? "", /CORE_ENTRY_MISSING/);
    assert.match(coreProblem(join(dir, "missing"), join(dir, "missing.tar"), reviewed) ?? "", /CORE_MISSING/);
    const entry = join(dir, "packages/coding-kernel/src");
    mkdirSync(entry, { recursive: true });
    writeFileSync(join(entry, "ActionsKernel.ts"), "export {}\n");
    const archive = join(dir, "core.tar");
    writeFileSync(archive, "not-a-real-archive\n");
    assert.match(coreProblem(dir, archive, reviewed) ?? "", /CORE_ARCHIVE_MISMATCH/);
    const tree = gitTreeSha(dir);
    const pin = { schema: "peaceai-core-pin:v1" as const, commit: reviewed!.commit, archiveSha256: archiveSha256(archive), tree };
    assert.equal(coreProblem(dir, archive, pin), null);
    writeFileSync(join(entry, "ActionsKernel.ts"), "export const extra = 1;\n");
    assert.match(coreProblem(dir, archive, pin) ?? "", /CORE_TREE_MISMATCH/);
    assert.equal(readCorePin("{\"commit\":\"aa\"}"), null);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
