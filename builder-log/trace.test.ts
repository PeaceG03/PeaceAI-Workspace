import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { test } from "node:test";
import { NOREPLY_FROM, patchCommentBody, sha256 } from "../peaceai/lib/patch.ts";
import type { Entry } from "./check.ts";
import { GRANDFATHERED, issueOf, makeGhDeps, traceAll, traceErrors, traceLine, type ResultsView, type TraceDeps } from "./trace.ts";

const DIFF = "diff --git a/x.ts b/x.ts\nindex 0000000..1111111 100644\n--- a/x.ts\n+++ b/x.ts\n@@ -1 +1,2 @@\n a\n+b\n";
const PATCH = `From ${"a".repeat(40)} Mon Sep 17 00:00:00 2001\n${NOREPLY_FROM}\nSubject: [PATCH] t\n\n---\n${DIFF}`;
const comment = (patch = PATCH, target = "PeaceG03/PeaceSTOCKS") =>
  patchCommentBody({ candidateId: "candidate-1", runId: "7", target, diffSha256: sha256(DIFF), patchSha256: sha256(PATCH), patch }, "A");
const VIEW: ResultsView = { latestRunId: "7", target: "PeaceG03/PeaceSTOCKS", pick: { decided: true, candidateId: "candidate-1" }, resultsDiff: DIFF };

function deps(o: { comments?: Record<number, string[]>; view?: ResultsView; trees?: { applied: string | null; landing: string } } = {}): TraceDeps {
  return {
    botComments: async (n) => (o.comments ?? { 500: [comment()] })[n] ?? [],
    results: async () => o.view ?? VIEW,
    trees: async () => o.trees ?? { applied: "t1", landing: "t1" },
  };
}
const line = (changed: string, seq = 900, why = "w"): Entry =>
  ({ seq, date: "2026-10-15", time: "12:00", asked: "a", changed, why, skill: "THROW_GUARD", mark: "PeaceAI-able today", by: "PeaceAI" }) as Entry;

test("positive: comment + Results + tree all match", async () => {
  const [r] = await traceLine(line("PeaceAI-Workspace#500, PeaceSTOCKS@abcdef1"), deps());
  assert.equal(r!.status, "ok");
});

test("issue taken from why when changed has only repo@sha", async () => {
  assert.equal(issueOf(line("PeaceSTOCKS@abcdef1", 900, "PeaceAI-Workspace#500 candidate A")), 500);
  const [r] = await traceLine(line("PeaceSTOCKS@abcdef1", 900, "PeaceAI-Workspace#500 candidate A"), deps());
  assert.equal(r!.status, "ok");
});

test("wrong issue: no bot patch comment there -> T_NO_PATCH_COMMENT", async () => {
  const [r] = await traceLine(line("PeaceAI-Workspace#501, PeaceSTOCKS@abcdef1"), deps());
  assert.equal(r!.code, "T_NO_PATCH_COMMENT");
});

test("no issue named -> T_NO_ISSUE; two issues -> T_NO_ISSUE", async () => {
  assert.equal((await traceLine(line("PeaceSTOCKS@abcdef1"), deps()))[0]!.code, "T_NO_ISSUE");
  assert.equal((await traceLine(line("PeaceSTOCKS@abcdef1", 900, "PeaceAI-Workspace#1 and PeaceAI-Workspace#2"), deps()))[0]!.code, "T_NO_ISSUE");
});

test("hash mismatch: tampered patch vs posted patch-sha256", async () => {
  const body = comment().replace("+b\n", "+c\n");
  const [r] = await traceLine(line("PeaceAI-Workspace#500, PeaceSTOCKS@abcdef1"), deps({ comments: { 500: [body] } }));
  assert.equal(r!.code, "T_HASH_MISMATCH");
});

test("hash mismatch: Results candidate diff differs", async () => {
  const [r] = await traceLine(line("PeaceAI-Workspace#500, PeaceSTOCKS@abcdef1"), deps({ view: { ...VIEW, resultsDiff: DIFF + "+x\n" } }));
  assert.equal(r!.code, "T_HASH_MISMATCH");
  assert.match(r!.detail, /^H_RESULTS_VERIFY\(\d+\) patch-sha256 [0-9a-f]{64} diff-sha256 [0-9a-f]{64} results-diff-sha256 [0-9a-f]{64}$/);
  assert.ok(!r!.detail.includes("+x"));
});

test("tree mismatch and apply failure", async () => {
  const e = line("PeaceAI-Workspace#500, PeaceSTOCKS@abcdef1");
  assert.equal((await traceLine(e, deps({ trees: { applied: "t2", landing: "t1" } })))[0]!.code, "T_TREE_MISMATCH");
  assert.equal((await traceLine(e, deps({ trees: { applied: null, landing: "t1" } })))[0]!.code, "T_APPLY_FAILED");
});

test("non-bot / target mismatch / lookup failures fail closed", async () => {
  const e = line("PeaceAI-Workspace#500, PeaceSTOCKS@abcdef1");
  assert.equal((await traceLine(e, deps({ comments: { 500: [comment(PATCH, "PeaceG03/Other")] } })))[0]!.code, "T_TARGET_MISMATCH");
  const d = deps();
  assert.equal((await traceLine(e, { ...d, results: async () => { throw new Error("403"); } }))[0]!.code, "T_RESULTS_UNREADABLE");
  assert.equal((await traceLine(e, { ...d, botComments: async () => { throw new Error("x"); } }))[0]!.code, "T_LOOKUP_FAILED");
});

test("public mode (results null) still checks comment, self-hash and tree, and says so", async () => {
  const [r] = await traceLine(line("PeaceAI-Workspace#500, PeaceSTOCKS@abcdef1"), { ...deps(), results: null });
  assert.equal(r!.status, "ok");
  assert.match(r!.detail, /Results NOT checked/);
});

test("grandfathered lines are reported, lines without a landing produce no row, errors are coded", async () => {
  const seq = Number(Object.keys(GRANDFATHERED)[0]);
  const entries = [line("PeaceSTOCKS@abcdef1", seq), line("none (x)", 901), line("PeaceAI-Workspace#501, PeaceSTOCKS@abcdef1", 902)];
  const rows = await traceAll(entries, deps());
  assert.deepEqual(rows.map((r) => r.status), ["grandfathered", "fail"]);
  const errs = traceErrors(entries, rows);
  assert.ok(errs.some((x) => x.startsWith("T_NO_PATCH_COMMENT: seq 902")));
  assert.ok(errs.some((x) => x.startsWith("T_STALE_GRANDFATHER")), "other grandfather seqs absent here are flagged stale");
});

test("every grandfather entry carries a reason with its code", () => {
  for (const [s, why] of Object.entries(GRANDFATHERED)) assert.match(why, /^T_[A-Z_]+: .{20,}/, `seq ${s}`);
});

test("malformed Results file: coded error, its bytes never reach the row or errors", async () => {
  const dir = mkdtempSync(join(tmpdir(), "res-"));
  try {
    const SECRET = "SECRET-RESULTS-BYTES-42";
    mkdirSync(join(dir, "tasks/500/7/verdicts"), { recursive: true });
    writeFileSync(join(dir, "tasks/500/7/task.json"), `{"baseSha": "${SECRET}", oops`);
    const real = makeGhDeps({}, { dir });
    const d: TraceDeps = { ...deps(), results: real.results };
    const e = line("PeaceAI-Workspace#500, PeaceSTOCKS@abcdef1");
    const rows = await traceAll([e], d);
    assert.equal(rows[0]!.code, "T_RESULTS_UNREADABLE");
    const out = JSON.stringify(rows) + traceErrors([e], rows).join("\n");
    assert.ok(!out.includes(SECRET) && !out.includes("oops") && !/JSON|Unexpected|position/.test(rows[0]!.detail), out);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---- stacked-batch provenance (peaceai/lib/stacked.ts) ----
const X = "1".repeat(40), Y = "2".repeat(40), V1 = "3".repeat(40);
const STACKED = `PeaceAI-Workspace#500 landed; stacked: base ${X.slice(0, 12)} landed-on ${Y.slice(0, 12)} via ${V1.slice(0, 12)}`;
test("stacked provenance: matches git -> ok; mismatch, malformed, missing dep -> T_STACK_MISMATCH", async () => {
  const withStack = (st: { onto: string; via: string[] } | null): TraceDeps => ({ ...deps(), stack: async () => st });
  const ok = (await traceLine(line("PeaceAI-Workspace#500, PeaceSTOCKS@abcdef1", 900, STACKED), withStack({ onto: Y, via: [V1] })))[0]!;
  assert.equal(ok.status, "ok");
  assert.match(ok.detail, /stacked on 222222222222 via 1$/);
  assert.equal((await traceLine(line("PeaceAI-Workspace#500, PeaceSTOCKS@abcdef1", 900, STACKED), withStack({ onto: V1, via: [V1] })))[0]!.code, "T_STACK_MISMATCH");
  assert.equal((await traceLine(line("PeaceAI-Workspace#500, PeaceSTOCKS@abcdef1", 900, STACKED), withStack({ onto: Y, via: [V1, X] })))[0]!.code, "T_STACK_MISMATCH");
  assert.equal((await traceLine(line("PeaceAI-Workspace#500, PeaceSTOCKS@abcdef1", 900, STACKED), withStack(null)))[0]!.code, "T_STACK_MISMATCH");
  assert.equal((await traceLine(line("PeaceAI-Workspace#500, PeaceSTOCKS@abcdef1", 900, STACKED), deps()))[0]!.code, "T_STACK_MISMATCH");
  assert.equal((await traceLine(line("PeaceAI-Workspace#500, PeaceSTOCKS@abcdef1", 900, "#500 stacked: base zz"), withStack({ onto: Y, via: [V1] })))[0]!.code, "T_STACK_MISMATCH");
});
