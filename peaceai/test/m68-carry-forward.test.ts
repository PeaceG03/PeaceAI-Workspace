// Carry-forward verdicts, end to end: pending carry (verdict job) -> regrade (existing path) -> trusted carry check
// on Results/issue facts -> carry note + peace-verdict dispatch, re-validated against the owner's own /verdict.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  BOT, CARRY_MARKER, OWNER, carryComment, checkCarry, diffPaths, freshFromRecord, latestPending, parseCarryComment, parsePending,
  pendingCarryBlock, sha256, validateCarryDispatch, type CarryInput, type PendingCarry,
} from "../lib/carry.ts";
import { parseRegradeComment, pendingRegrade, regradeComment } from "../lib/regrade.ts";
import { PROTECTED_SELF } from "../lib/selfchange.ts";

const BASE = "a".repeat(40), HEAD = "b".repeat(40);
const DIFF = [
  "diff --git a/src/m.ts b/src/m.ts", "--- a/src/m.ts", "+++ b/src/m.ts", "@@ -1 +1,2 @@", " export const x = 1;", "+export function f(a: number): number { return a + 1; }",
  "diff --git a/src/m.f.test.ts b/src/m.f.test.ts", "new file mode 100644", "--- /dev/null", "+++ b/src/m.f.test.ts", "@@ -0,0 +1 @@", "+test", "",
].join("\n");
const H = sha256(DIFF);
const pending: PendingCarry = { schema: "peaceai-carry-pending:v1", issue: 7, verdictCommentId: "555", label: "B", runId: "100", candidateId: "candidate-2", oldBase: BASE, diffSha256: H };
const rec = { originalSuitePassed: true, newTestsPassed: true, newTestFiles: 1, testGrading: { beforeFix: false, stubFails: true, verdict: "COUNTS" } };
const task = { issue: 7, runId: "200", baseSha: HEAD, regradeOf: { runId: "100", candidateId: "candidate-2", oldBase: BASE, diffSha256: H } };
const good = (o: Partial<CarryInput> = {}): CarryInput => ({ pending, task, diff: DIFF, appliedByJobA: true, applyCheck: true, changedSinceBase: ["src/other.ts"], fresh: freshFromRecord(rec), ...o });
const no = (reason: string) => ({ carry: false, reason });

test("carry: all four conditions hold -> carries", () => {
  assert.deepEqual(checkCarry(good()), { carry: true });
  assert.deepEqual(diffPaths(DIFF), ["src/m.f.test.ts", "src/m.ts"]);
});
test("refusal: no / invalid / already-applied pending carry", () => {
  assert.deepEqual(checkCarry(good({ pending: null })), no("carry_none_pending"));
  assert.deepEqual(checkCarry(good({ pending: "invalid" })), no("carry_pending_invalid"));
  assert.deepEqual(checkCarry(good({ pending: "applied" })), no("carry_already_applied"));
});
test("refusal: the attempt is not the regrade of that pending carry", () => {
  assert.deepEqual(checkCarry(good({ task: { ...task, regradeOf: undefined } })), no("carry_not_regrade"));
  for (const rg of [{ runId: "101" }, { candidateId: "candidate-1" }, { oldBase: "c".repeat(40) }, { diffSha256: "d".repeat(64) }])
    assert.deepEqual(checkCarry(good({ task: { ...task, regradeOf: { ...task.regradeOf, ...rg } } })), no("carry_regrade_mismatch"), JSON.stringify(rg));
  assert.deepEqual(checkCarry(good({ task: { ...task, issue: 8 } })), no("carry_regrade_mismatch"));
  assert.deepEqual(checkCarry(good({ task: { ...task, baseSha: BASE } })), no("carry_regrade_mismatch"));
});
test("condition 1 (hash): the regraded diff must hash to the pending carry", () => {
  assert.deepEqual(checkCarry(good({ diff: DIFF.replace("a + 1", "a + 2") })), no("carry_hash_mismatch"));
  assert.deepEqual(checkCarry(good({ diff: "" })), no("carry_hash_mismatch"));
});
test("condition 2 (applies): Job A applied it AND git apply --check on the new head is clean", () => {
  assert.deepEqual(checkCarry(good({ appliedByJobA: false })), no("carry_not_clean"));
  assert.deepEqual(checkCarry(good({ applyCheck: false })), no("carry_not_clean"));
});
test("condition 3 (untouched): none of its files (incl. the new test) changed between old base and new head", () => {
  assert.deepEqual(checkCarry(good({ changedSinceBase: ["src/m.ts"] })), no("carry_files_changed"));
  assert.deepEqual(checkCarry(good({ changedSinceBase: ["src/m.f.test.ts"] })), no("carry_files_changed"));
  assert.deepEqual(checkCarry(good({ changedSinceBase: null })), no("carry_files_changed"));
});
test("condition 4 (fresh COUNTS): suite, passes after, fails on base, stub check", () => {
  assert.deepEqual(checkCarry(good({ fresh: null })), no("carry_no_fresh_grade"));
  assert.equal(freshFromRecord({ ...rec, testGrading: null }), null);
  for (const bad of [{ originalSuitePassed: false }, { newTestsPassed: false }, { newTestFiles: 0 }, { testGrading: { ...rec.testGrading, beforeFix: true } },
    { testGrading: { ...rec.testGrading, stubFails: false } }, { testGrading: { beforeFix: false, verdict: "COUNTS" } }, { testGrading: { ...rec.testGrading, verdict: "REJECTED_PASSES_BOTH" } }])
    assert.deepEqual(checkCarry(good({ fresh: freshFromRecord({ ...rec, ...bad }) })), no("carry_grade_not_counts"), JSON.stringify(bad));
});
test("pending carry rides at the end of the M18 regrade request without breaking it", () => {
  const meta = { runId: "100", candidateId: "candidate-2", baseSha: BASE, transformations: ["ADD_FUNCTION"], operationId: null };
  const body = regradeComment(meta, HEAD, DIFF)! + pendingCarryBlock(pending);
  assert.ok(parseRegradeComment(body), "regrade request still parses");
  assert.deepEqual(parsePending(body), pending);
  assert.ok(pendingRegrade([{ user: BOT, body }]) && pendingRegrade([{ user: BOT, body }]) !== "invalid");
  const review = { user: BOT, body: "PeaceAI review. ..." };
  assert.deepEqual(latestPending([{ user: BOT, body }, review]), pending);
  assert.equal(latestPending([{ user: BOT, body }, review, { user: BOT, body: carryComment({ schema: "peaceai-carry:v1", issue: 7, verdictCommentId: "555", fromRunId: "100", fromCandidate: "candidate-2", runId: "200", label: "A" }) }]), "applied");
  assert.equal(latestPending([{ user: OWNER, body }]), null, "only the bot's comments count");
  assert.equal(latestPending([{ user: BOT, body: regradeComment(meta, HEAD, DIFF)! }]), null, "a regrade without a pending carry");
  assert.equal(latestPending([{ user: BOT, body: body.replace('"label":"B"', '"label":"BB"') }]), "invalid");
  assert.throws(() => pendingCarryBlock({ ...pending, label: "bad" }));
});
test("peace-verdict re-validates a dispatched carry against the owner's own /verdict comment", () => {
  const meta = { runId: "100", candidateId: "candidate-2", baseSha: BASE, transformations: ["ADD_FUNCTION"], operationId: null };
  const reqBody = regradeComment(meta, HEAD, DIFF)! + pendingCarryBlock(pending);
  const note = { schema: "peaceai-carry:v1" as const, issue: 7, verdictCommentId: "555", fromRunId: "100", fromCandidate: "candidate-2", runId: "200", label: "A" };
  const carry = { id: "900", user: BOT, body: carryComment(note), issue: 7, createdAt: "2026-10-16T10:00:00Z" };
  const verdict = { id: "555", user: OWNER, body: "/verdict B right", issue: 7, createdAt: "2026-10-16T09:00:00Z" };
  const all = [{ user: BOT, body: reqBody }, { user: BOT, body: "PeaceAI review. x" }, { user: BOT, body: carry.body }];
  assert.deepEqual(validateCarryDispatch(carry, verdict, all), { ok: true, issue: 7, body: "/verdict A right", commentId: "900", createdAt: carry.createdAt, expectRun: "200" });
  const r = (c: typeof carry | null, v: typeof verdict | null, a = all) => (validateCarryDispatch(c, v, a) as { reason?: string }).reason;
  assert.equal(r({ ...carry, user: OWNER }, verdict), "carry_comment_not_bot");
  assert.equal(r(null, verdict), "carry_comment_not_bot");
  assert.equal(r({ ...carry, body: carry.body.replace(CARRY_MARKER, "<!-- x -->") }, verdict), "carry_comment_invalid");
  assert.equal(r({ ...carry, issue: 8 }, verdict), "carry_comment_invalid");
  assert.equal(r(carry, { ...verdict, user: "someone" }), "carry_verdict_not_owner");
  assert.equal(r(carry, { ...verdict, issue: 8 }), "carry_verdict_not_owner");
  assert.equal(r(carry, { ...verdict, id: "556" }), "carry_verdict_not_owner");
  assert.equal(r(carry, null), "carry_verdict_not_owner");
  assert.equal(r(carry, { ...verdict, body: "/verdict B wrong" }), "carry_verdict_not_right");
  assert.equal(r(carry, { ...verdict, body: "/verdict C right" }), "carry_pending_mismatch");
  assert.equal(r(carry, verdict, [{ user: BOT, body: carry.body }]), "carry_pending_mismatch");
  const twice = [all[0]!, all[1]!, { user: BOT, body: carryComment({ ...note, runId: "199" }) }, all[2]!];
  assert.equal(r(carry, verdict, twice), "carry_pending_mismatch", "a second carry for the same pending is refused");
  assert.equal(parseCarryComment(carryComment(note))?.runId, "200");
  assert.throws(() => carryComment({ ...note, runId: "100" }), "same run cannot carry to itself");
});

// ---------- wiring ----------
const wf = (f: string) => readFileSync(new URL(`../../.github/workflows/${f}`, import.meta.url), "utf8");
const bin = (f: string) => readFileSync(new URL(`../bin/${f}`, import.meta.url), "utf8");
const job = (y: string, name: string) => { const a = y.indexOf(`\n  ${name}:\n`); assert.ok(a > 0, name); const b = y.slice(a + 3).search(/\n  [a-z][\w-]*:\n/); return b < 0 ? y.slice(a) : y.slice(a, a + 3 + b); };

test("wiring 1: the verdict job records a pending carry with the regrade request and re-queues the existing path", () => {
  const s = bin("verdict-stale.ts");
  assert.match(s, /pendingCarryBlock\(\{ schema: "peaceai-carry-pending:v1", issue, verdictCommentId: vid, label/);
  assert.match(s, /const ownVerdict = process\.env\.VERDICT_SOURCE === "comment";/, "a carried verdict is never re-carried");
  const tp = job(wf("peace-verdict.yml"), "target-patch");
  assert.match(tp, /VERDICT_COMMENT_ID: \$\{\{ needs\.parse\.outputs\.comment_id \}\}/);
  assert.match(tp, /--remove-label peaceai:done[^\n]*\n\s+gh workflow run peace-task\.yml/);
  assert.match(tp, /actions: write/);
  assert.ok(!/contents: write|secrets\./.test(tp), "the patch job still has no write token");
});
test("wiring 2: the carry job is trusted, read-only, after Job C and the review; Job B is untouched", () => {
  const y = wf("peace-task.yml");
  const c = job(y, "carry");
  assert.match(c, /needs: \[select, record, review\]/);
  assert.match(c, /permissions:\n\s+contents: read\n\s+issues: read\n/);
  assert.match(c, /results-write\.sh "carry check #\$ISSUE_NUMBER \(writes nothing\)"/);
  assert.match(c, /tsx peaceai\/bin\/carry-check\.ts/);
  const a = job(y, "carry-apply");
  assert.match(a, /needs: \[select, carry\]/);
  assert.match(a, /permissions:\n\s+issues: write\n\s+actions: write\n/);
  assert.ok(!/secrets\.|environment:|actions\/checkout/.test(a), "apply job runs no repo code and holds no secret");
  assert.match(a, /gh workflow run peace-verdict\.yml [^\n]*-f carry_comment_id="\$id"/);
  assert.ok(!/carry/.test(job(y, "test")), "Job B (sandboxed) is not changed");
  const cc = bin("carry-check.ts");
  assert.match(cc, /attempt\.task\.runId !== runId\) stop\("carry_not_this_run"\)/);
  assert.match(cc, /checkCarry\(\{ pending, task: attempt!\.task, diff, appliedByJobA: cand\?\.applied === true, applyCheck, changedSinceBase, fresh: freshFromRecord\(cand\) \}\)/);
  assert.ok(!/writeNew|appendIndex|writeSummary/.test(cc), "carry-check writes nothing to Results");
});
test("wiring 3: peace-verdict accepts a dispatch only from the bot, re-validated, and records it on that exact attempt", () => {
  const y = wf("peace-verdict.yml");
  assert.match(y, /workflow_dispatch:\n\s+inputs:\n\s+carry_comment_id:/);
  assert.match(y, /github\.event_name == 'workflow_dispatch' && github\.actor == 'github-actions\[bot\]' && github\.triggering_actor == 'github-actions\[bot\]'/);
  assert.match(y, /tsx peaceai\/bin\/carry-verdict\.ts/);
  assert.match(y, /EXPECT_RUN_ID: \$\{\{ needs\.parse\.outputs\.expect_run \}\}/);
  assert.match(y, /github\.event\.comment\.user\.login == 'PeaceG03' &&\n\s+github\.event\.sender\.login == 'PeaceG03'/, "owner checks for comments unchanged");
  assert.match(bin("carry-verdict.ts"), /validateCarryDispatch\(carry, verdict, all\)/);
  assert.match(bin("record-verdict.ts"), /if \(expectRun && attempt\.task\.runId !== expectRun\) \{\n\s+out\(\{ status: "carry-stale" \}\);/);
});
test("protected: carry lib and both carry bins are PROTECTED_SELF (pinned digest in m12)", () => {
  for (const f of ["peaceai/lib/carry.ts", "peaceai/bin/carry-check.ts", "peaceai/bin/carry-verdict.ts", "peaceai/bin/verdict-stale.ts"])
    assert.ok(PROTECTED_SELF.some((p) => p.pattern.test(f)), f);
});
