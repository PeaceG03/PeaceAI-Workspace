import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { test } from "node:test";
import { NOREPLY_FROM, patchCommentBody, sha256 } from "../peaceai/lib/patch.ts";
import type { Entry } from "./check.ts";
import { GRANDFATHERED, RIGHT_REPLY, issueOf, makeGhDeps, traceAll, traceErrors, traceLine, type ResultsView, type TraceDeps } from "./trace.ts";

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

// ---- M87: verdict PR route (#379, peacestocks-write) ----
const PR_REPLY_BODY = (n = 11, repo = "PeaceG03/PeaceSTOCKS") => `Verdict recorded: A right. Opening a PR for A. https://github.com/${repo}/pull/${n}`;
const PR_VIEW = { merged: true, mergeCommit: "abcdef1" + "0".repeat(33), headRef: "peace-task/issue-500-candidate-1-0123abcd", diff: DIFF };
function prDeps(o: { comments?: string[]; pr?: Partial<typeof PR_VIEW>; view?: ResultsView | null; trees?: (patch: string) => { applied: string | null; landing: string } } = {}): TraceDeps {
  return {
    botComments: async (n) => (n === 500 ? (o.comments ?? [PR_REPLY_BODY()]) : []),
    results: o.view === null ? null : async () => o.view ?? VIEW,
    trees: async (_r, _s, patch) => (o.trees ? o.trees(patch) : { applied: "t1", landing: "t1" }),
    pullRequest: async () => ({ ...PR_VIEW, ...o.pr }),
  };
}
const prLine = (why = "landed through verdict PR PeaceSTOCKS#11 (squash) as PeaceSTOCKS@abcdef1") => line("PeaceAI-Workspace#500, PeaceSTOCKS@abcdef1", 900, why);

test("PR route: bot PR reply + merged verdict PR + tree + Results pick -> ok", async () => {
  const [r] = await traceLine(prLine(), prDeps());
  assert.equal(r!.status, "ok", r!.detail);
  assert.match(r!.detail, /^candidate-1 via PeaceSTOCKS#11 \(peace-task\/issue-500-candidate-1-0123abcd\), Results verified, tree t1$/);
  const [p] = await traceLine(prLine(), prDeps({ view: null }));
  assert.equal(p!.status, "ok");
  assert.match(p!.detail, /Results NOT checked/);
});

test("PR route: why must name the same verdict PR exactly once", async () => {
  assert.equal((await traceLine(prLine("landed as PeaceSTOCKS@abcdef1"), prDeps()))[0]!.code, "T_PR_MISMATCH");
  assert.equal((await traceLine(prLine("verdict PR PeaceSTOCKS#12"), prDeps()))[0]!.code, "T_PR_MISMATCH");
  assert.equal((await traceLine(prLine("verdict PR PeaceSTOCKS#11 and verdict PR PeaceSTOCKS#11"), prDeps()))[0]!.code, "T_PR_MISMATCH");
});

test("PR route: PR in another repo -> T_TARGET_MISMATCH; no bot reply -> T_NO_PATCH_COMMENT", async () => {
  assert.equal((await traceLine(prLine(), prDeps({ comments: [PR_REPLY_BODY(11, "evil/PeaceSTOCKS")] })))[0]!.code, "T_TARGET_MISMATCH");
  assert.equal((await traceLine(prLine(), prDeps({ comments: [] })))[0]!.code, "T_NO_PATCH_COMMENT");
  assert.equal((await traceLine(prLine(), prDeps({ comments: ["Verdict recorded: A right."] })))[0]!.code, "T_NO_PATCH_COMMENT");
});

test("PR route: unmerged, merged as another commit, or foreign branch -> T_PR_MISMATCH", async () => {
  assert.equal((await traceLine(prLine(), prDeps({ pr: { merged: false } })))[0]!.code, "T_PR_MISMATCH");
  assert.equal((await traceLine(prLine(), prDeps({ pr: { mergeCommit: "1234567" + "0".repeat(33) } })))[0]!.code, "T_PR_MISMATCH");
  assert.equal((await traceLine(prLine(), prDeps({ pr: { headRef: "peace-task/issue-501-candidate-1-0123abcd" } })))[0]!.code, "T_PR_MISMATCH");
  assert.equal((await traceLine(prLine(), prDeps({ pr: { headRef: "feature/x" } })))[0]!.code, "T_PR_MISMATCH");
});

test("PR route: PR diff not the landing -> T_TREE_MISMATCH / T_APPLY_FAILED", async () => {
  assert.equal((await traceLine(prLine(), prDeps({ trees: () => ({ applied: "t2", landing: "t1" }) })))[0]!.code, "T_TREE_MISMATCH");
  assert.equal((await traceLine(prLine(), prDeps({ trees: () => ({ applied: null, landing: "t1" }) })))[0]!.code, "T_APPLY_FAILED");
});

test("PR route: Results pick differs from the branch candidate, or the Results diff is not the landing -> T_HASH_MISMATCH (codes only)", async () => {
  const other = await traceLine(prLine(), prDeps({ view: { ...VIEW, pick: { decided: true, candidateId: "candidate-2" } } }));
  assert.equal(other[0]!.code, "T_HASH_MISMATCH");
  const undecided = await traceLine(prLine(), prDeps({ view: { ...VIEW, pick: { decided: false, candidateId: null } } }));
  assert.equal(undecided[0]!.code, "T_HASH_MISMATCH");
  const RD = DIFF + "+x\n";
  const diffd = await traceLine(prLine(), prDeps({ view: { ...VIEW, resultsDiff: RD }, trees: (p) => ({ applied: p === RD ? "t9" : "t1", landing: "t1" }) }));
  assert.equal(diffd[0]!.code, "T_HASH_MISMATCH");
  assert.match(diffd[0]!.detail, /^H_RESULTS_PR results-diff-sha256 [0-9a-f]{64}$/);
  assert.ok(!diffd[0]!.detail.includes("+x"));
});

test("PR route: a patch comment, when present, still takes the patch route", async () => {
  const d = prDeps({ comments: [PR_REPLY_BODY(), comment()] });
  const [r] = await traceLine(line("PeaceAI-Workspace#500, PeaceSTOCKS@abcdef1"), d);
  assert.equal(r!.status, "ok");
  assert.doesNotMatch(r!.detail, /via PeaceSTOCKS#/);
});

// ---- M89: Workspace self-landing found by its verdict branch (reply has no PR URL) ----
const WS_REPLY = "Verdict recorded: A right. Opening a PR for A.";
const WS_SHA = "4eb6818";
const WS_PR = { merged: true, mergeCommit: WS_SHA + "0".repeat(33), headRef: "peace-task/issue-500-candidate-1-0123abcd", diff: DIFF };
function wsDeps(o: { comments?: string[]; pulls?: Record<number, Partial<typeof WS_PR>>; list?: number[] | (() => never); view?: ResultsView | null; trees?: { applied: string | null; landing: string } } = {}): TraceDeps {
  const pulls = o.pulls ?? { 406: {} };
  return {
    botComments: async (n) => (n === 500 ? (o.comments ?? [WS_REPLY]) : []),
    results: o.view === null ? null : async () => o.view ?? { ...VIEW, target: "PeaceG03/PeaceAI-Workspace" },
    trees: async () => o.trees ?? { applied: "t1", landing: "t1" },
    pullRequest: async (_r, n) => {
      if (!(n in pulls)) throw new Error("404");
      return { ...WS_PR, ...pulls[n] };
    },
    verdictPulls: async () => (typeof o.list === "function" ? o.list() : (o.list ?? Object.keys(pulls).map(Number))),
  };
}
const wsLine = (why = "landed through bot verdict PR PeaceAI-Workspace#406 (branch x) merged as PeaceAI-Workspace@4eb6818") =>
  line(`PeaceAI-Workspace#500, PeaceAI-Workspace@${WS_SHA}`, 900, why);

test("M89: RIGHT_REPLY matches the Workspace route reply (prguard planPr) and not other verdicts", () => {
  assert.ok(RIGHT_REPLY.test(WS_REPLY));
  assert.ok(RIGHT_REPLY.test("Verdict recorded: B right. PR #7 already holds this candidate, so no new PR was opened."));
  for (const b of ["Verdict recorded: A wrong.", "Verdict recorded: A unsure. Stored as a label for A; your pick still counts.", "PeaceAI review.", "/verdict A right"]) assert.ok(!RIGHT_REPLY.test(b), b);
});

test("M89: Workspace self-landing traced by branch -> ok (Results and public mode)", async () => {
  const [r] = await traceLine(wsLine(), wsDeps());
  assert.equal(r!.status, "ok", r!.detail);
  assert.match(r!.detail, /^candidate-1 via PeaceAI-Workspace#406 \(peace-task\/issue-500-candidate-1-0123abcd\), Results verified, tree t1$/);
  const [p] = await traceLine(wsLine(), wsDeps({ view: null }));
  assert.equal(p!.status, "ok");
  assert.match(p!.detail, /Results NOT checked/);
});

test("M89: only the PR merged as the landing counts; closed siblings and other issues are ignored", async () => {
  const pulls = { 404: { merged: false, mergeCommit: null }, 405: { headRef: "peace-task/issue-501-candidate-1-0123abcd" }, 406: {} };
  const [r] = await traceLine(wsLine(), wsDeps({ pulls }));
  assert.equal(r!.status, "ok", r!.detail);
  assert.match(r!.detail, /via PeaceAI-Workspace#406 /);
});

test("M89: none or several merged as the landing -> T_PR_MISMATCH; why must name the found PR", async () => {
  assert.equal((await traceLine(wsLine(), wsDeps({ pulls: { 406: { merged: false } } })))[0]!.code, "T_PR_MISMATCH");
  assert.equal((await traceLine(wsLine(), wsDeps({ pulls: { 406: { mergeCommit: "1234567" + "0".repeat(33) } } })))[0]!.code, "T_PR_MISMATCH");
  assert.equal((await traceLine(wsLine(), wsDeps({ pulls: { 406: { headRef: "feature/x" } } })))[0]!.code, "T_PR_MISMATCH");
  assert.equal((await traceLine(wsLine(), wsDeps({ list: [] })))[0]!.code, "T_PR_MISMATCH");
  const two = await traceLine(wsLine(), wsDeps({ pulls: { 406: {}, 407: { headRef: "peace-task/issue-500-candidate-2-0123abcd" } } }));
  assert.equal(two[0]!.code, "T_PR_MISMATCH");
  assert.match(two[0]!.detail, /^2 verdict branch PRs/);
  assert.equal((await traceLine(wsLine("landed as PeaceAI-Workspace@4eb6818"), wsDeps()))[0]!.code, "T_PR_MISMATCH");
  assert.equal((await traceLine(wsLine("verdict PR PeaceAI-Workspace#407"), wsDeps()))[0]!.code, "T_PR_MISMATCH");
});

test("M89: tree, Results pick and lookup failures fail closed", async () => {
  assert.equal((await traceLine(wsLine(), wsDeps({ trees: { applied: "t2", landing: "t1" } })))[0]!.code, "T_TREE_MISMATCH");
  assert.equal((await traceLine(wsLine(), wsDeps({ view: { ...VIEW, target: "PeaceG03/PeaceAI-Workspace", pick: { decided: true, candidateId: "candidate-2" } } })))[0]!.code, "T_HASH_MISMATCH");
  assert.equal((await traceLine(wsLine(), wsDeps({ list: () => { throw new Error("403"); } })))[0]!.code, "T_LOOKUP_FAILED");
  assert.equal((await traceLine(wsLine(), wsDeps({ list: [999] })))[0]!.code, "T_LOOKUP_FAILED");
  const d = wsDeps();
  delete d.verdictPulls;
  assert.equal((await traceLine(wsLine(), d))[0]!.code, "T_LOOKUP_FAILED");
});

test("M89: no right-verdict reply -> T_NO_PATCH_COMMENT; branch lookup is Workspace-only", async () => {
  assert.equal((await traceLine(wsLine(), wsDeps({ comments: [] })))[0]!.code, "T_NO_PATCH_COMMENT");
  assert.equal((await traceLine(wsLine(), wsDeps({ comments: ["Verdict recorded: A wrong."] })))[0]!.code, "T_NO_PATCH_COMMENT");
  const stocks = line("PeaceAI-Workspace#500, PeaceSTOCKS@4eb6818", 900, "verdict PR PeaceSTOCKS#406");
  assert.equal((await traceLine(stocks, wsDeps()))[0]!.code, "T_NO_PATCH_COMMENT", "PeaceSTOCKS still needs the reply URL");
});

test("M89: grandfathered 221-225 stay exempt and are reported, not re-traced", async () => {
  for (const s of [221, 222, 223, 224, 225]) assert.match(GRANDFATHERED[s]!, /^T_NO_PATCH_COMMENT: #\d+ is a Workspace self-zone task/);
  const rows = await traceAll([{ ...wsLine(), seq: 221 }], wsDeps());
  assert.equal(rows[0]!.status, "grandfathered");
});
