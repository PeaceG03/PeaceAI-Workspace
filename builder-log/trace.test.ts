import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import assert from "node:assert/strict";
import { test } from "node:test";
import ts from "typescript";
import { NOREPLY_FROM, patchCommentBody, sha256 } from "../peaceai/lib/patch.ts";
import type { Entry } from "./check.ts";
import { GRANDFATHERED, gitPlanInputs, NOT_ATTEMPTED, planTrace, TRACE_CODE_PATHS, RIGHT_REPLY, issueOf, lookupCause, makeGhDeps, traceAll, traceErrors, traceLine, type PullView, type ResultsView, type TraceDeps } from "./trace.ts";

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

test("lookup failures name a fixed cause; after a rate limit no further GitHub lookups are made (fail closed)", async () => {
  // Fixed text only: the status and "rate limited", never the raw gh stderr.
  assert.equal(lookupCause(new Error("gh api repos/x failed: gh: API rate limit exceeded for installation ID 9. (HTTP 403)")), "rate limited (HTTP 403)");
  assert.equal(lookupCause(new Error("gh api x failed: You have exceeded a secondary rate limit")), "rate limited");
  assert.equal(lookupCause(new Error("gh api x failed: gh: Not Found (HTTP 404)")), "HTTP 404");
  assert.equal(lookupCause(new Error("secret text")), "");
  const e = line("PeaceAI-Workspace#500, PeaceSTOCKS@abcdef1");
  const d = deps();
  assert.equal((await traceLine(e, { ...d, botComments: async () => { throw new Error("x"); } }))[0]!.detail, "issue comments lookup failed", "no cause: unchanged text");
  const entries = [1, 2, 3, 4].map((k) => line(`PeaceAI-Workspace#50${k}, PeaceSTOCKS@abcdef${k}`, 900 + k));
  let calls = 0;
  const rows = await traceAll(entries, {
    ...d,
    botComments: async (n) => {
      calls += 1;
      if (n === 501) return [comment()];
      throw new Error("gh api repos/x failed: gh: API rate limit exceeded for installation ID 9. (HTTP 403)");
    },
  });
  assert.equal(calls, 2, "stops calling GitHub after the rate-limited lookup");
  assert.deepEqual(rows.map((r) => [r.status, r.code ?? "", r.detail.replace(/^.*?failed: /, "")]), [
    ["ok", "", "candidate-1 run 7, Results verified, tree t1"],
    ["fail", "T_LOOKUP_FAILED", "rate limited (HTTP 403)"],
    ["fail", "T_LOOKUP_FAILED", NOT_ATTEMPTED],
    ["fail", "T_LOOKUP_FAILED", NOT_ATTEMPTED],
  ]);
  assert.equal(traceErrors(entries, rows).filter((x) => x.startsWith("T_LOOKUP_FAILED")).length, 3, "every unverified landing still fails");
  // A non-rate-limit error (e.g. 404) does not stop later lookups.
  let n404 = 0;
  await traceAll(entries, { ...d, botComments: async () => { n404 += 1; throw new Error("gh: Not Found (HTTP 404)"); } });
  assert.equal(n404, 4);
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
const WS_PR: PullView = { merged: true, mergeCommit: WS_SHA + "0".repeat(33), headRef: "peace-task/issue-500-candidate-1-0123abcd", diff: DIFF };
function wsDeps(o: { comments?: string[]; pulls?: Record<number, Partial<PullView>>; list?: number[] | (() => never); view?: ResultsView | null; trees?: { applied: string | null; landing: string } } = {}): TraceDeps {
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

// ---- PR mode: only appended rows (#590 follow-up: GITHUB_TOKEN quota) ----

const jl = (...es: Entry[]) => es.map((e) => JSON.stringify(e) + "\n").join("");
const BASE_LOG = jl(line("PeaceAI-Workspace#500, PeaceSTOCKS@abcdef1", 910), line("PeaceAI-Workspace#500, PeaceSTOCKS@abcdef1", 911));

test("planTrace: a log-only append traces rows after the base's last seq; anything uncertain traces in full", () => {
  const head = BASE_LOG + jl(line("PeaceAI-Workspace#501, PeaceSTOCKS@1234567", 912));
  const logOnly = ["builder-log/tasks.jsonl", "builder-log/README.md", "builder-log/coverage.test.ts"];
  assert.deepEqual(planTrace(BASE_LOG, head, logOnly), { full: false, afterSeq: 911 });
  assert.deepEqual(planTrace(null, head, logOnly), { full: true, reason: "base log unreadable" });
  assert.deepEqual(planTrace(BASE_LOG, head, null), { full: true, reason: "changed paths unknown" });
  // An edited, removed or reordered base row (the append-only step fails these too) traces everything.
  assert.equal(planTrace(BASE_LOG, BASE_LOG.replace("abcdef1", "abcdef2") + head.slice(BASE_LOG.length), logOnly).full, true);
  assert.equal(planTrace(BASE_LOG, jl(line("PeaceAI-Workspace#500, PeaceSTOCKS@abcdef1", 911)), logOnly).full, true);
  assert.equal(planTrace("{not json\n", "{not json\n", logOnly).full, true);
  for (const p of ["builder-log/trace.ts", "builder-log/check.ts", "builder-log/tsconfig.json", "peaceai/lib/patch.ts", "peaceai/lib/new/x.ts", "package.json", "package-lock.json", "tsconfig.json", ".github/workflows/builder-log.yml"])
    assert.deepEqual(planTrace(BASE_LOG, head, [...logOnly, p]), { full: true, reason: `trace code changed (${p})` }, p);
  assert.equal(planTrace(BASE_LOG, head, [...logOnly, "src/x.ts", "peaceai/bin/gate.ts", ".github/workflows/ci.yml"]).full, false);
});

test("PR mode: a fabricated or forged appended row is still traced and still fails; the stale-grandfather check stays on main", async () => {
  const head = BASE_LOG + jl(line("PeaceAI-Workspace#777, PeaceSTOCKS@1234567", 912));
  const plan = planTrace(BASE_LOG, head, ["builder-log/tasks.jsonl"]);
  assert.equal(plan.full, false);
  const all = head.split("\n").filter(Boolean).map((l) => JSON.parse(l) as Entry);
  const picked = plan.full ? all : all.filter((e) => e.seq > plan.afterSeq);
  assert.deepEqual(picked.map((e) => e.seq), [912]);
  const errs = traceErrors(picked, await traceAll(picked, deps()), false);
  assert.equal(errs.length, 1);
  assert.match(errs[0]!, /^T_NO_PATCH_COMMENT: seq 912 /);
  // A forged comment (patch bytes tampered after the hash was posted) on a new row fails as it does in full mode.
  const forged = comment().replace("+b\n", "+c\n");
  const r2 = await traceAll([line("PeaceAI-Workspace#500, PeaceSTOCKS@1234567", 912)], deps({ comments: { 500: [forged] } }));
  assert.match(traceErrors([], r2, false)[0] ?? "", /^T_HASH_MISMATCH: seq 912 /);
  // full=false only drops the stale-grandfather check (it needs every row); full=true keeps it.
  assert.ok(Object.keys(GRANDFATHERED).length > 0);
  assert.ok(traceErrors([], [], true).some((e) => /T_STALE_GRANDFATHER/.test(e)));
  assert.deepEqual(traceErrors([], [], false), []);
});

test("gitPlanInputs: base log and changed paths from git; a bad or non-sha base gives nulls (-> full trace)", () => {
  const dir = mkdtempSync(join(tmpdir(), "trace-plan-"));
  const g = (...a: string[]) => execFileSync("git", a, { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  try {
    g("init", "-q");
    mkdirSync(join(dir, "builder-log"));
    writeFileSync(join(dir, "builder-log/tasks.jsonl"), BASE_LOG);
    g("add", "-A");
    g("-c", "user.name=t", "-c", "user.email=t@example.com", "commit", "-qm", "base");
    const base = g("rev-parse", "HEAD");
    writeFileSync(join(dir, "builder-log/tasks.jsonl"), BASE_LOG + jl(line("PeaceAI-Workspace#501, PeaceSTOCKS@1234567", 912)));
    writeFileSync(join(dir, "builder-log/trace.ts"), "// changed\n");
    g("add", "-A");
    g("-c", "user.name=t", "-c", "user.email=t@example.com", "commit", "-qm", "head");
    assert.deepEqual(gitPlanInputs(dir, base), { baseLog: BASE_LOG, changed: ["builder-log/tasks.jsonl", "builder-log/trace.ts"] });
    assert.equal(planTrace(BASE_LOG, BASE_LOG, gitPlanInputs(dir, base).changed).full, true, "trace.ts changed -> full");
    assert.deepEqual(gitPlanInputs(dir, "f".repeat(40)), { baseLog: null, changed: null });
    assert.deepEqual(gitPlanInputs(dir, "HEAD~1"), { baseLog: null, changed: null }, "only a full sha is accepted");
    assert.deepEqual(gitPlanInputs(dir, "--output=/dev/null"), { baseLog: null, changed: null });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("TRACE_CODE_PATHS covers trace.ts's whole relative import graph", () => {
  const root = resolve(import.meta.dirname, "..");
  const seen = new Set<string>();
  const walk = (file: string) => {
    if (seen.has(file)) return;
    seen.add(file);
    // The TypeScript scanner lists real import/export/require/import() specifiers only (not strings in code).
    for (const { fileName } of ts.preProcessFile(readFileSync(file, "utf8"), true, true).importedFiles) {
      if (!fileName.startsWith(".")) continue; // node: builtins and packages: covered by package(-lock).json
      const raw = resolve(dirname(file), fileName);
      const next = [raw, raw.replace(/\.js$/, ".ts"), `${raw}.ts`, join(raw, "index.ts")].find((c) => existsSync(c) && /\.[cm]?[jt]s$/.test(c));
      assert.ok(next, `${relative(root, file)} imports ${fileName}`);
      walk(next);
    }
  };
  walk(join(root, "builder-log/trace.ts"));
  assert.ok(seen.size > 5);
  for (const f of seen) {
    const p = relative(root, f);
    assert.ok(TRACE_CODE_PATHS.some((c) => (c.endsWith("/") ? p.startsWith(c) : p === c)), `${p} must be in TRACE_CODE_PATHS`);
  }
});

test("workflow: PR trace uses --new-rows-since the PR base; main push skips the public trace only where results-crosscheck runs", () => {
  const wf = readFileSync(resolve(import.meta.dirname, "../.github/workflows/builder-log.yml"), "utf8");
  const cross = /results-crosscheck:[\s\S]*?\n {4}if: (.+)\n/.exec(wf)?.[1];
  assert.equal(cross, "github.event_name == 'push' && github.ref == 'refs/heads/main' && github.repository == 'PeaceG03/PeaceAI-Workspace'");
  const step = wf.slice(wf.indexOf("- name: PeaceAI landings trace to verdict patches (public part"), wf.indexOf("- name: PeaceAI vs Builder coverage"));
  assert.ok(step.includes(`if: \${{ !(${cross}) }}`), "exact negation of the crosscheck condition");
  assert.match(step, /BASE_SHA: \$\{\{ github\.event\.pull_request\.base\.sha \}\}/);
  assert.match(step, /if \[ "\$GITHUB_EVENT_NAME" = pull_request \]; then mode=\(--new-rows-since "\$BASE_SHA"\)/);
  const crossJob = wf.slice(wf.indexOf("results-crosscheck:"));
  assert.match(crossJob, /trace\.ts --results-dir "\$RUNNER_TEMP\/results" --clone/);
  assert.ok(!/new-rows-since/.test(crossJob), "main's Results trace is always full");
});
