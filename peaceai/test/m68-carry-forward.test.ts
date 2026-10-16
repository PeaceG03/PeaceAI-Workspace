// Carry-forward verdicts: the original verdict is kept on a moved head ONLY when all four conditions hold.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { carryForward, diffPaths, sha256, type CarryInput } from "../lib/carry.ts";

const BASE = "a".repeat(40), HEAD = "b".repeat(40);
const DIFF = [
  "diff --git a/src/m.ts b/src/m.ts", "--- a/src/m.ts", "+++ b/src/m.ts", "@@ -1 +1,2 @@", " export const x = 1;", "+export function f(a: number): number { return a + 1; }",
  "diff --git a/src/m.f.test.ts b/src/m.f.test.ts", "new file mode 100644", "--- /dev/null", "+++ b/src/m.f.test.ts", "@@ -0,0 +1 @@", "+test", "",
].join("\n");
const meta = { runId: "123", candidateId: "candidate-1", baseSha: BASE };
const grade = { suite: true, newTests: ["src/m.f.test.ts"], afterPass: true, beforeFail: true, stubFail: true, verdict: "COUNTS" };
const fresh = (g: object = grade, over: object = {}) => ({ schema: "peaceai-regrade:v1", issue: 1, runId: "123", candidateId: "candidate-1", diffSha256: sha256(DIFF), patchSha256: "c".repeat(64), oldBase: BASE, newHead: HEAD, appliedCommit: null, gradedAt: "2026-10-16T09:00:00Z", grade: g, ...over });
const good = (o: Partial<CarryInput> = {}): CarryInput => ({ meta, newHead: HEAD, diff: DIFF, gradedDiffSha256: sha256(DIFF), appliesCleanly: true, changedSinceBase: ["src/other.ts", "README.md"], fresh: fresh(), ...o });

test("carry: all four conditions hold -> the original verdict carries", () => {
  assert.deepEqual(carryForward(good()), { carry: true });
  assert.deepEqual(diffPaths(DIFF), ["src/m.f.test.ts", "src/m.ts"]);
});
test("carry condition 1: candidate hash must still match", () => {
  assert.deepEqual(carryForward(good({ diff: DIFF.replace("a + 1", "a + 2") })), { carry: false, reason: "carry_hash_mismatch" });
});
test("carry condition 2: the patch must apply cleanly on the new head", () => {
  assert.deepEqual(carryForward(good({ appliesCleanly: false })), { carry: false, reason: "carry_not_clean" });
});
test("carry condition 3: none of the candidate's files (incl. its new test) changed between old base and new head", () => {
  assert.deepEqual(carryForward(good({ changedSinceBase: ["src/m.ts"] })), { carry: false, reason: "carry_files_changed" });
  assert.deepEqual(carryForward(good({ changedSinceBase: ["src/m.f.test.ts"] })), { carry: false, reason: "carry_files_changed" });
});
test("carry condition 4: a fresh Job B grade on the new head must be COUNTS (suite, fails on base, stub check)", () => {
  assert.deepEqual(carryForward(good({ fresh: null })), { carry: false, reason: "carry_no_fresh_grade" });
  for (const bad of [{ suite: false }, { afterPass: false }, { beforeFail: false }, { stubFail: false }, { verdict: "NO_NEW_TESTS", newTests: [] }]) {
    assert.deepEqual(carryForward(good({ fresh: fresh({ ...grade, ...bad }) })), { carry: false, reason: "carry_grade_not_counts" }, JSON.stringify(bad));
  }
  const { stubFail: _s, ...noStub } = grade; // one added exported function: the stub check must have run and passed
  assert.deepEqual(carryForward(good({ fresh: fresh(noStub) })), { carry: false, reason: "carry_grade_not_counts" });
  // The grade must be for THIS candidate on THIS new head from THIS old base.
  for (const over of [{ newHead: "d".repeat(40) }, { oldBase: "e".repeat(40) }, { candidateId: "candidate-2" }, { runId: "9" }, { schema: "x" }])
    assert.deepEqual(carryForward(good({ fresh: fresh(grade, over) })), { carry: false, reason: "carry_grade_mismatch" }, JSON.stringify(over));
});
test("carry: bad inputs fail closed", () => {
  assert.equal(carryForward(good({ newHead: BASE })).carry, false);
  assert.equal(carryForward(good({ gradedDiffSha256: "x" })).carry, false);
  assert.equal(carryForward(good({ diff: "" })).carry, false);
});
test("carry: verdict-stale only carries on stale=carry after carryForward; the workflow builds on the new head only then", () => {
  const bin = readFileSync(new URL("../bin/verdict-stale.ts", import.meta.url), "utf8");
  assert.match(bin, /if \(d\.carry\) \{ out\(\{ stale: "carry", head, ok: "true" \}\)/);
  assert.match(bin, /regradeComment\(meta, head, diff\)/, "anything else still falls through to the regrade request");
  const y = readFileSync(new URL("../../.github/workflows/peace-verdict.yml", import.meta.url), "utf8");
  assert.match(y, /CARRY_HEAD: \$\{\{ steps\.stale\.outputs\.stale == 'carry' && steps\.stale\.outputs\.head \|\| '' \}\}/);
  assert.match(y, /if: steps\.stale\.outputs\.stale == 'true' && steps\.stale\.outputs\.ok == 'true'\n/, "regrade request unchanged");
});
