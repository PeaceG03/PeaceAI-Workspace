// M226: headline real-pass report. A pass counts only when the replay record is bound to
// this head, tree, and log digest. Official coverage counts only with a real on-main ancestry check.
// EXPERIMENTAL. credit is false. No network.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { makeGitOnMainChecker } from "../../builder-log/coverage.ts";
import { bindingProblem, buildCapabilityReport, inputDigest, realPercent, type ReplayBind, type ReplayRecord } from "../lib/capabilityreport.ts";
import { loadReplay } from "../bin/capability-report.ts";

const log = readFileSync(resolve(import.meta.dirname, "../../builder-log/tasks.jsonl"), "utf8");
const HEAD = "a".repeat(40);
const TREE = "b".repeat(40);
const OTHER = "c".repeat(40);
const bind: ReplayBind = { head: HEAD, tree: TREE, input: inputDigest(log) };

function row(seq: number, over: Partial<ReplayRecord> = {}): ReplayRecord {
  return { seq, status: "pass", reason: "ran", head: HEAD, tree: TREE, input: bind.input, ...over };
}

test("a missing replay record is unmeasured, and a fail-closed count is not the official figure", () => {
  const r = buildCapabilityReport(log, "2026-11-10", null);
  assert.equal(r.credit, false);
  assert.equal(r.passes, 0);
  assert.equal(r.realPass, "unknown");
  assert.equal(r.official.ancestry, false);
  assert.equal(r.official.cloneHead, null);
  assert.equal(r.official.able, 2);
  assert.equal(r.official.tasks, 187);
  assert.match(r.official.note, /not the official on-main figure/);
  assert.ok(r.rows.every((x) => x.status !== "pass"));
});

test("a hex stub without a pinned clone is not labeled official", () => {
  const stub = (sha: string) => /^[0-9a-f]{7,40}$/.test(sha);
  const r = buildCapabilityReport(log, "2026-11-10", stub);
  assert.equal(r.official.ancestry, false);
  assert.match(r.official.note, /not the official on-main figure/);
});

test("stale head, old tree, forged digest, and a missing binding are unmeasured", () => {
  const base = buildCapabilityReport(log, "2026-11-10", null, [], null, bind);
  const seq = base.rows.find((x) => x.inSet)!.seq;
  const cases: [string, ReplayRecord][] = [
    ["STALE_HEAD", row(seq, { head: OTHER })],
    ["STALE_TREE", row(seq, { tree: OTHER })],
    ["FORGED_INPUT", row(seq, { input: "d".repeat(64) })],
    ["MISSING_BINDING", row(seq, { head: undefined, tree: undefined, input: undefined })],
  ];
  for (const [reason, rec] of cases) {
    assert.equal(bindingProblem(rec, bind), reason);
    const r = buildCapabilityReport(log, "2026-11-10", null, [rec], null, bind);
    assert.equal(r.passes, 0, reason);
    assert.equal(r.rows.find((x) => x.seq === seq)?.status, "unmeasured", reason);
    assert.equal(r.rows.find((x) => x.seq === seq)?.reason, reason);
  }
  const missing = buildCapabilityReport(log, "2026-11-10", null, [], null, bind);
  assert.equal(missing.rows.find((x) => x.seq === seq)?.reason, "NO_REPLAY");
  assert.equal(missing.passes, 0);
});

test("a pass counts only when head, tree, and the log digest all match", () => {
  const base = buildCapabilityReport(log, "2026-11-10", null, [], null, bind);
  const seq = base.rows.find((x) => x.inSet)!.seq;
  const forged = buildCapabilityReport(log, "2026-11-10", null, [{ seq, status: "pass", reason: "hand" }], null, bind);
  assert.equal(forged.passes, 0);
  const r = buildCapabilityReport(log, "2026-11-10", null, [row(seq)], null, bind);
  assert.equal(r.passes, 1);
  assert.equal(r.rows.filter((x) => x.status === "pass").length, 1);
  assert.equal(r.realPass, "unknown");
});

test("the percent is passes over the set only when every row was measured", () => {
  assert.equal(realPercent(83, 220, 0), 37.7);
  assert.equal(realPercent(91, 222, 0), 41);
  assert.equal(realPercent(0, 276, 276), null);
  assert.equal(realPercent(1, 276, 275), null);
});

test("on-main ancestry is git merge-base --is-ancestor, and a foreign clone does not yield the stub total", () => {
  const dir = mkdtempSync(join(tmpdir(), "peaceai-ancestry-"));
  const git = (...a: string[]) => execFileSync("git", a, { cwd: dir, stdio: "ignore" });
  try {
    git("init", "-q");
    git("config", "user.email", "301894882+PeaceG03@users.noreply.github.com");
    git("config", "user.name", "PeaceG03");
    writeFileSync(join(dir, "a.txt"), "a\n");
    git("add", "a.txt");
    git("commit", "-q", "-m", "a");
    const first = execFileSync("git", ["rev-parse", "HEAD"], { cwd: dir, encoding: "utf8" }).trim();
    writeFileSync(join(dir, "a.txt"), "b\n");
    git("add", "a.txt");
    git("commit", "-q", "-m", "b");
    const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: dir, encoding: "utf8" }).trim();
    git("branch", "side");
    git("reset", "--hard", "-q", first);
    const onMain = makeGitOnMainChecker(dir);
    assert.equal(onMain(first), true);
    assert.equal(onMain(head), false, "the side commit is not an ancestor of HEAD");
    assert.equal(onMain("e".repeat(40)), false);
    const r = buildCapabilityReport(log, "2026-11-10", onMain, [], null, null, first);
    assert.equal(r.official.ancestry, true);
    assert.equal(r.official.cloneHead, first);
    assert.equal(r.official.able, 2);
    assert.equal(r.official.tasks, 187);
    assert.match(r.official.note, /merge-base --is-ancestor/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("replay text with a hole or a bad status is refused", () => {
  assert.equal(loadReplay('{"seq":1,"status":"fail","reason":"NO_RULE"}\n')[0]?.reason, "NO_RULE");
  assert.throws(() => loadReplay('{"seq":1,"status":"pass","reason":""}\n'), /replay record invalid/);
  assert.throws(() => loadReplay('{"seq":1,"status":"yes","reason":"x"}\n'), /replay record invalid/);
  assert.equal(createHash("sha256").update(log).digest("hex"), inputDigest(log));
});
