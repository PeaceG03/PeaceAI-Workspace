// Lane v1: allowlist, frozen baseline, no-lost-passes ratchet, one change per PR, drift, credit time.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { APPROVED_SINCE, MISSING_SKILLS, validateEntry, type Entry } from "../../builder-log/check.ts";
import { approvedAt, countable, retagCountable, SELF_CHANGE_APPROVED_AT, SELF_CHANGE_SKILL } from "../../builder-log/coverage.ts";
import { MUST_BE_PROTECTED, selfZoneEditRefusal } from "../lib/self-zone.ts";
import {
  assessLaneDrift, checkLaneV1Diff, checkSelfChangeDiff, decideLaneV1, LANE_V1_BASELINE_COMMAND, LANE_V1_BASELINE_PATH,
  LANE_V1_DRIFT_PATH, LANE_V1_PATHS, LANE_V1_RATCHET_PATHS, measurementFromReports, parseLaneBaseline, parseLaneDrift,
  stage2PathRefusal, type LaneBaseline, type LaneDrift, type LaneMeasurement, type LaneV1Input,
} from "../lib/selfchange.ts";

const repo = resolve(import.meta.dirname, "../..");
const tsx = join(repo, "node_modules/.bin/tsx");
const A = "a".repeat(40);
const B = "b".repeat(40);
const FIX = "c".repeat(40);
const DEV = `acme/widget@${FIX}#text`;
const GUARDS = [
  "lane-guard: an uncertain path is refused",
  "lane-guard: the self lane cannot edit the baseline or the ratchet",
  "lane-guard: an off-allowlist path is refused",
  "lane-guard: a dropped pass count is refused even when other rows are gained",
  "lane-guard: more refusals than the frozen baseline are refused",
  "lane-guard: a baseline passing row that is no longer passing is refused",
  "lane-guard: the comparison is the frozen baseline",
  "lane-guard: one self-change per PR",
  "lane-guard: unresolved drift blocks the next self-change",
  "lane-guard: held-out diffs and reasons are not read or stored",
  "lane-guard: lane review stays on the self-change proposal path",
  "lane-guard: PEACEAI_SELF_CHANGE is approved only at or after the approval time",
  "lane-guard: a self-change retag is judged at the original task time",
  "lane-guard: a self-change counts only after approval and only when live-proven",
  "lane-guard: a self-change row counts only through countable, after approval and live-proven",
  "lane-guard: the baseline, the drift status and the lane bins stay protected",
];

const modify = (path: string, from: string, to: string) => `diff --git a/${path} b/${path}\nindex 1111111..2222222 100644\n--- a/${path}\n+++ b/${path}\n@@ -1 +1 @@\n-${from}\n+${to}\n`;
const bucket = (passing: string[], fail = 0, unmeasured = 0) => ({ passing, counts: { pass: passing.length, fail, unmeasured } });
const counts = (pass: number, fail = 0, unmeasured = 0) => ({ pass, fail, unmeasured });

function measure(sourceSha: string, passing = ["1", "2"], heldPass = 2, fail = 1, unmeasured = 0): LaneMeasurement {
  return {
    schema: "peaceai-lane-v1-measure:v1", sourceSha,
    builderLog: bucket(passing, fail, unmeasured),
    practiceDev: { text: bucket([DEV], fail, unmeasured), "test-as-spec": bucket([], fail, unmeasured) },
    heldOut: { text: counts(heldPass, fail, unmeasured), "test-as-spec": counts(heldPass, fail, unmeasured) },
  };
}
function baselineOf(m: LaneMeasurement): LaneBaseline {
  return { schema: "peaceai-lane-v1-baseline:v1", locked: true, sourceSha: m.sourceSha, lastGoodSha: m.sourceSha, generatedBy: LANE_V1_BASELINE_COMMAND, builderLog: m.builderLog, practiceDev: m.practiceDev, heldOut: m.heldOut };
}
function clearDrift(m: LaneMeasurement): LaneDrift {
  return assessLaneDrift(baselineOf(m), m);
}
function input(over: Partial<LaneV1Input> & { after?: LaneMeasurement } = {}): LaneV1Input {
  const before = measure(A);
  const after = over.after ?? measure(B);
  const base = baselineOf(before);
  return { diff: modify("peaceai/lib/derive.ts", "a", "b"), baseline: base, before, drift: clearDrift(before), commits: 1, parentSha: A, headSha: B, ...over, after };
}

test("deleting any lane guard line fails this test", () => {
  const src = ["peaceai/lib/selfchange.ts", "peaceai/bin/self-change.ts", "peaceai/lib/self-zone.ts", "builder-log/coverage.ts"].map((f) => readFileSync(join(repo, f), "utf8")).join("\n");
  for (const g of GUARDS) assert.equal(src.split(g).length - 1, 1, g);
});

test("the four allowlist paths are real files, and the old gates still refuse them", () => {
  assert.deepEqual([...LANE_V1_PATHS], ["peaceai/bin/generate.ts", "peaceai/bin/test-candidates.ts", "peaceai/lib/derive.ts", "peaceai/lib/editpropose.ts"]);
  for (const p of LANE_V1_PATHS) {
    assert.equal(existsSync(join(repo, p)), true, p);
    assert.equal(checkLaneV1Diff(modify(p, "a", "b")).ok, true, p);
    assert.equal(checkSelfChangeDiff(modify(p, "a", "b")).ok, false, p);
    assert.equal(selfZoneEditRefusal([p]), "self_protected_path", p);
  }
});

test("a proposal outside the allowlist is refused, including the baseline and the ratchet", () => {
  const outside = [
    "builder-log/coverage.ts", "peaceai/lib/leak.ts", "peaceai/lib/specgrade.ts", "peaceai/bin/gate.ts",
    ".github/workflows/ci.yml", "peaceai/test/m257-self-change-lane.test.ts", "peaceai/lib/credit-line-allowlist.json",
    ...LANE_V1_RATCHET_PATHS,
  ];
  for (const p of outside) {
    const r = checkLaneV1Diff(modify(p, "a", "b"));
    assert.equal(r.ok, false, p);
    assert.ok(r.refusals.some((x) => x.path === p), p);
  }
  for (const p of [LANE_V1_BASELINE_PATH, LANE_V1_DRIFT_PATH, "peaceai/lib/selfchange.ts", "peaceai/bin/lane-baseline.ts"]) {
    const r = checkLaneV1Diff(modify(p, "a", "b"));
    assert.ok(r.refusals.some((x) => x.reason === "the self lane cannot edit the baseline or the ratchet"), p);
  }
  assert.equal(stage2PathRefusal(LANE_V1_BASELINE_PATH)?.startsWith("never-zone"), true);
  assert.equal(stage2PathRefusal("peaceai/bin/lane-drift.ts")?.includes("drift check"), true);
  const mixed = checkLaneV1Diff(modify("peaceai/lib/derive.ts", "a", "b") + modify("peaceai/lib/leak.ts", "a", "b"));
  assert.equal(mixed.ok, false);
  assert.equal(checkLaneV1Diff(modify("peaceai/bin/../lib/derive.ts", "a", "b")).ok, false);
  assert.equal(checkLaneV1Diff("").ok, false);
  for (const p of [LANE_V1_BASELINE_PATH, LANE_V1_DRIFT_PATH, "peaceai/bin/lane-baseline.ts", "peaceai/bin/lane-drift.ts"]) assert.ok((MUST_BE_PROTECTED as readonly string[]).includes(p), p);
});

test("a proposal that drops one passing row is refused even when it gains another", () => {
  const dropped = measure(B, ["2", "3"]);
  const d = decideLaneV1(input({ after: dropped }));
  assert.equal(d.ok, false);
  assert.ok(d.refusals.some((r) => r === "Builder-log replay lost passing row 1."), d.refusals.join("\n"));
  assert.equal(d.scorecard.against, "frozen-baseline");
  assert.equal(d.scorecard.revert, `git revert ${B}`);
  assert.equal(d.scorecard.commits, 1);
  const gained = measure(B, ["1", "2", "9"]);
  assert.equal(decideLaneV1(input({ after: gained })).ok, true);
});

test("a dropped count is refused even when another bucket gains, and more refusals are refused", () => {
  const held = measure(B);
  held.heldOut.text = counts(1, 1, 0);
  held.builderLog = bucket(["1", "2", "9"]);
  const d = decideLaneV1(input({ after: held }));
  assert.equal(d.ok, false);
  assert.ok(d.refusals.some((r) => r === "Held-out text pass count dropped from 2 to 1."), d.refusals.join("\n"));
  const refused = measure(B);
  refused.heldOut["test-as-spec"] = counts(2, 2, 0);
  const more = decideLaneV1(input({ after: refused }));
  assert.equal(more.ok, false);
  assert.ok(more.refusals.some((r) => r.includes("more refusals")));
});

test("the comparison is the frozen baseline, not the previous scorecard", () => {
  const before = measure(A, ["1"]);
  before.builderLog.counts.pass = 1;
  const after = measure(B, ["1", "2"]);
  const d = decideLaneV1(input({ before, after }));
  assert.equal(d.ok, true, d.refusals.join("\n"));
  const worse = measure(B, ["1"]);
  assert.equal(decideLaneV1(input({ after: worse })).ok, false);
});

test("one self-change per PR, and an unresolved or planted drop on main blocks the next one", () => {
  assert.equal(decideLaneV1(input({ commits: 2 })).ok, false);
  const dir = mkdtempSync(join(tmpdir(), "lane-drift-gate-"));
  const put = (name: string, value: unknown) => {
    const file = join(dir, name);
    writeFileSync(file, JSON.stringify(value));
    const parsed = parseLaneDrift(JSON.parse(readFileSync(file, "utf8")));
    assert.equal(parsed.ok, true, parsed.ok ? name : parsed.reason);
    return parsed.ok ? parsed.drift : null;
  };
  const unchecked = put("unchecked.json", { schema: "peaceai-lane-v1-drift:v1", status: "unchecked", sourceSha: "", lines: ["Main was not measured against the baseline. The next self-change stays blocked."] });
  assert.equal(decideLaneV1(input({ drift: unchecked })).ok, false);
  const planted = put("planted.json", assessLaneDrift(baselineOf(measure(A)), measure(A, ["2"])));
  assert.equal(planted?.status, "unresolved");
  assert.ok(planted?.lines.some((l) => l === "Builder-log replay lost passing row 1."));
  assert.equal(decideLaneV1(input({ drift: planted })).ok, false);
  const C = "d".repeat(40);
  const other = put("other-sha.json", { schema: "peaceai-lane-v1-drift:v1", status: "clear", sourceSha: B, lines: ["No drop against the frozen baseline."] });
  const otherDecision = decideLaneV1(input({ drift: other, parentSha: B, headSha: C, before: measure(B), after: measure(C) }));
  assert.equal(otherDecision.ok, false);
  assert.ok(otherDecision.refusals.some((r) => r === "the parent is not the recorded last-good version"), otherDecision.refusals.join("\n"));
  const clear = put("clear.json", clearDrift(measure(A)));
  assert.equal(clear?.status, "clear");
  assert.equal(clear?.sourceSha, A);
  const passed = decideLaneV1(input({ drift: clear }));
  assert.equal(passed.ok, true, passed.refusals.join("\n"));
  const committedBase = parseLaneBaseline(JSON.parse(readFileSync(join(repo, LANE_V1_BASELINE_PATH), "utf8")));
  const committedDrift = parseLaneDrift(JSON.parse(readFileSync(join(repo, LANE_V1_DRIFT_PATH), "utf8")));
  assert.equal(committedBase.ok, true);
  assert.equal(committedDrift.ok, true);
  if (committedBase.ok && committedDrift.ok) {
    assert.equal(committedDrift.drift.status, "clear");
    assert.equal(committedDrift.drift.sourceSha, committedBase.baseline.lastGoodSha);
  }
});

test("the committed baseline is locked at one last-good commit", () => {
  const raw = JSON.parse(readFileSync(join(repo, LANE_V1_BASELINE_PATH), "utf8"));
  const parsed = parseLaneBaseline(raw);
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.baseline.schema, "peaceai-lane-v1-baseline:v1");
  assert.equal(parsed.baseline.locked, true);
  assert.match(parsed.baseline.sourceSha, /^[0-9a-f]{40}$/);
  assert.equal(parsed.baseline.sourceSha, parsed.baseline.lastGoodSha);
  assert.equal(parsed.baseline.builderLog.passing.length, parsed.baseline.builderLog.counts.pass);
  for (const form of ["text", "test-as-spec"] as const) assert.equal(parsed.baseline.practiceDev[form].passing.length, parsed.baseline.practiceDev[form].counts.pass, form);
});

test("an unlocked baseline fixture makes lane1 refuse", () => {
  const dir = mkdtempSync(join(tmpdir(), "lane1-unlocked-"));
  const before = measure(A);
  writeFileSync(join(dir, "base.json"), JSON.stringify({ ...baselineOf(before), locked: false }));
  writeFileSync(join(dir, "before.json"), JSON.stringify(before));
  writeFileSync(join(dir, "after.json"), JSON.stringify(measure(B)));
  writeFileSync(join(dir, "drift.json"), JSON.stringify(clearDrift(before)));
  writeFileSync(join(dir, "edit.diff"), modify("peaceai/lib/derive.ts", "a", "b"));
  const offActions: NodeJS.ProcessEnv = { ...process.env };
  delete offActions.GITHUB_ACTIONS;
  const run = spawnSync(tsx, [join(repo, "peaceai/bin/self-change.ts"), "lane1", "--patch", join(dir, "edit.diff"), "--baseline", join(dir, "base.json"), "--before", join(dir, "before.json"), "--after", join(dir, "after.json"), "--drift", join(dir, "drift.json"), "--parent", A, "--head", B, "--commits", "1", "--out", join(dir, "scorecard.json")], { cwd: repo, encoding: "utf8", env: offActions });
  assert.equal(run.status, 2, run.stdout + run.stderr);
  assert.match(run.stdout ?? "", /baseline is not locked/);
});

test("the generator stores passing rows and held-out counts, never held-out diffs or reasons", () => {
  const sha = "d".repeat(40);
  const capability = {
    schema: "peaceai-capability-report:v1", passes: 1, fails: 0, unmeasured: 0,
    rows: [{ seq: 7, inSet: true, status: "pass", reason: "CAP-REASON-SENTINEL", diff: "CAP-DIFF-SENTINEL" }, { seq: 8, inSet: false, status: "fail", reason: "OUT-SENTINEL" }],
  };
  const practice = {
    schema: "peaceai-practice-replay:v1",
    counts: {
      text: { dev: { pass: 1, fail: 0, unmeasured: 0, reasons: { DEV_REASON: 1 } }, "held-out": { pass: 2, fail: 3, unmeasured: 4, reasons: { HELD_REASON: 9 } } },
      "test-as-spec": { dev: { pass: 0, fail: 1, unmeasured: 0 }, "held-out": { pass: 5, fail: 6, unmeasured: 7 } },
    },
    rows: [
      { repo: "acme/widget", split: "dev", fixSha: FIX, understanding: "text", status: "pass", reason: "DEV-REASON-SENTINEL", diff: "DEV-DIFF-SENTINEL" },
      { repo: "acme/widget", split: "dev", fixSha: "e".repeat(40), understanding: "test-as-spec", status: "fail" },
      { repo: "hidden/row", split: "held-out", fixSha: "f".repeat(40), understanding: "text", status: "pass", reason: "HELD-OUT-REASON-SENTINEL", diff: "HELD-OUT-DIFF-SENTINEL" },
    ],
  };
  const built = measurementFromReports(capability, practice, sha);
  assert.equal(built.ok, true, built.ok ? "" : built.reason);
  if (!built.ok) return;
  const text = JSON.stringify(built.measurement);
  for (const secret of ["CAP-REASON-SENTINEL", "CAP-DIFF-SENTINEL", "OUT-SENTINEL", "DEV-REASON-SENTINEL", "DEV-DIFF-SENTINEL", "HELD-OUT-REASON-SENTINEL", "HELD-OUT-DIFF-SENTINEL", "HELD_REASON", "hidden/row"]) assert.equal(text.includes(secret), false, secret);
  assert.deepEqual(built.measurement.builderLog.passing, ["7"]);
  assert.deepEqual(built.measurement.practiceDev.text.passing, [DEV]);
  assert.deepEqual(built.measurement.heldOut.text, counts(2, 3, 4));
  assert.deepEqual(built.measurement.heldOut["test-as-spec"], counts(5, 6, 7));
  assert.equal(measurementFromReports(capability, practice, "short").ok, false);
});

test("lane1 writes a before/after scorecard and refuses a one-row drop", () => {
  const dir = mkdtempSync(join(tmpdir(), "lane1-"));
  const before = measure(A);
  const base = baselineOf(before);
  const drift = clearDrift(before);
  const write = (name: string, value: unknown) => writeFileSync(join(dir, name), JSON.stringify(value));
  write("base.json", base);
  write("before.json", before);
  write("after.json", measure(B, ["2"]));
  write("drift.json", drift);
  writeFileSync(join(dir, "edit.diff"), modify("peaceai/bin/generate.ts", "a", "b"));
  const cli = join(repo, "peaceai/bin/self-change.ts");
  const args = [cli, "lane1", "--patch", join(dir, "edit.diff"), "--baseline", join(dir, "base.json"), "--before", join(dir, "before.json"), "--after", join(dir, "after.json"), "--drift", join(dir, "drift.json"), "--parent", A, "--head", B, "--commits", "1", "--out", join(dir, "scorecard.json")];
  // m108: GITHUB_ACTIONS is never copied into the child. The CLI refuses every mode on a public Actions runner before lane1 runs.
  const offActions: NodeJS.ProcessEnv = { ...process.env };
  delete offActions.GITHUB_ACTIONS;
  const run = spawnSync(tsx, args, { cwd: repo, encoding: "utf8", env: offActions });
  assert.equal(run.status, 2, run.stdout + run.stderr);
  const pub = spawnSync(tsx, args, { cwd: repo, encoding: "utf8", env: { ...offActions, GITHUB_ACTIONS: "true", GITHUB_REPOSITORY: "PeaceG03/PeaceAI-Workspace", CI: "true" } });
  assert.equal(pub.status, 3, pub.stdout + pub.stderr);
  assert.match(pub.stdout ?? "", /self-change refused reason=PUBLIC_RUNNER_REFUSED/);
  const card = JSON.parse(readFileSync(join(dir, "scorecard.json"), "utf8"));
  assert.equal(card.schema, "peaceai-lane-v1-scorecard:v1");
  assert.equal(card.ok, false);
  assert.equal(card.against, "frozen-baseline");
  assert.equal(card.lastGoodSha, A);
  assert.ok(card.refusals.some((r: string) => r.includes("lost passing row 1")));
});

test("new self-change tasks count only after the approval time and only when live-proven", () => {
  assert.equal(SELF_CHANGE_APPROVED_AT, "2026-11-17 13:48");
  assert.equal(APPROVED_SINCE.PEACEAI_SELF_CHANGE, SELF_CHANGE_APPROVED_AT);
  assert.equal((MISSING_SKILLS as readonly string[]).includes(SELF_CHANGE_SKILL), false);
  assert.equal(approvedAt(SELF_CHANGE_SKILL, "2026-11-17 13:47"), false);
  assert.equal(approvedAt(SELF_CHANGE_SKILL, "2026-11-17 13:48"), true);
  const proven = new Set<string>([SELF_CHANGE_SKILL]);
  const able = { skill: "PEACEAI_SELF_CHANGE" as const, mark: "PeaceAI-able today" as const };
  assert.equal(countable({ ...able, date: "2026-11-17", time: "13:48" }, proven), true);
  assert.equal(countable({ ...able, date: "2026-11-17", time: "13:47" }, proven), false);
  assert.equal(countable({ skill: SELF_CHANGE_SKILL, mark: "missing skill PEACEAI_SELF_CHANGE", date: "2026-11-17", time: "13:48" }, proven), false);
  assert.equal(countable({ ...able, date: "2026-11-17", time: "13:48" }, new Set()), false);
  assert.equal(countable(able, proven), false);
  const log = readFileSync(join(repo, "builder-log/tasks.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as Entry);
  const old = log.filter((e) => e.skill === SELF_CHANGE_SKILL);
  assert.ok(old.length >= 140, String(old.length));
  for (const e of old) {
    assert.ok(`${e.date} ${e.time}` < SELF_CHANGE_APPROVED_AT, String(e.seq));
    assert.equal(countable(e, proven), false, String(e.seq));
    assert.equal(retagCountable(e, SELF_CHANGE_SKILL, log), false, String(e.seq));
  }
  const row = (mark: string, date: string, time: string) => ({ seq: 1, date, time, asked: "Teach a lane edit after approval", changed: "none (local note only)", why: "The lane was not approved yet", skill: SELF_CHANGE_SKILL, mark, by: "Builder" });
  assert.deepEqual(validateEntry(row("missing skill PEACEAI_SELF_CHANGE", "2026-10-13", "00:40"), 1), []);
  assert.ok(validateEntry(row("PeaceAI-able today", "2026-10-13", "00:40"), 1).some((e) => e.includes("mark")));
  assert.deepEqual(validateEntry(row("PeaceAI-able today", "2026-11-17", "13:48"), 1), []);
  assert.ok(validateEntry(row("missing skill PEACEAI_SELF_CHANGE", "2026-11-17", "13:48"), 1).some((e) => e.includes("mark")));
});

test("lane-drift flags a planted drop and leaves the placeholder blocking", () => {
  mkdirSync(join(repo, "peaceai/self"), { recursive: true });
  const dir = mkdtempSync(join(tmpdir(), "lane-drift-"));
  const before = measure(A);
  writeFileSync(join(dir, "base.json"), JSON.stringify(baselineOf(before)));
  writeFileSync(join(dir, "drop.json"), JSON.stringify(measure(A, ["2"])));
  const bin = join(repo, "peaceai/bin/lane-drift.ts");
  const run = spawnSync(tsx, [bin, "--baseline", join(dir, "base.json"), "--measure", join(dir, "drop.json"), "--out", join(dir, "drift.json")], { cwd: repo, encoding: "utf8" });
  assert.equal(run.status, 2, run.stdout + run.stderr);
  assert.match(run.stdout, /Builder-log replay lost passing row 1\./);
  const clean = spawnSync(tsx, [bin, "--baseline", join(dir, "base.json"), "--measure", join(dir, "base-measure.json"), "--out", join(dir, "clear.json")], { cwd: repo, encoding: "utf8" });
  writeFileSync(join(dir, "base-measure.json"), JSON.stringify(before));
  const again = spawnSync(tsx, [bin, "--baseline", join(dir, "base.json"), "--measure", join(dir, "base-measure.json"), "--out", join(dir, "clear.json")], { cwd: repo, encoding: "utf8" });
  assert.equal(again.status, 0, again.stdout + again.stderr);
  assert.match(again.stdout, /No drop against the frozen baseline\./);
  assert.equal(clean.status, 1);
});
