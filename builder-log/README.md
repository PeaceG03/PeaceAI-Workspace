# Builder task log (public, append-only)

`tasks.jsonl` has one compact JSON object per line, one per task Builder did:

| field | meaning |
|---|---|
| seq | 1, 2, 3, ... with no gaps |
| date, time | America/Denver (MT) |
| asked | what was asked |
| changed | diff ref: `PeaceSTOCKS@<sha>`, `PeaceAI-Workspace@<sha>`, `PeaceAI-Workspace#<PR>` (comma-separated), or `none (reason)` |
| why | why it was done |
| skill | the PeaceAI edit kind it would have needed |
| mark | `PeaceAI-able today` (skill has an approved learned rule) or `missing skill <SKILL>` |
| by | `Builder` or `PeaceAI` (PeaceAI entries must use an approved skill) |
| coverage | optional; when present must be `none` (exclude from PeaceAI real-task credit) |

The skill lists live in `check.ts`. A mark follows the rules approved at the time the entry is written; old entries are never rewritten when a skill is approved later.

Rules: public data only. No secrets, no private-repo code, paths or diffs, no bar values, predictions or scores. PeaceSTOCKS changes are referred to by SHA and a plain description.

CI (`.github/workflows/builder-log.yml`) checks the schema and that the file at the PR base is a byte prefix of the new file: lines may only be appended.

## PeaceAI vs Builder coverage

`coverage.ts` (printed in the `builder-log` Actions job summary) measures, of **Builder's** logged tasks **plus PeaceAI real tasks**, what percentage PeaceAI could do end-to-end:

- **Builder rows:** countable only with a **live-proven** skill and a non-`missing skill` mark (Auditor #216: history keeps the mark).
- **PeaceAI real tasks** count in **both** the numerator and the denominator when all of: `by: PeaceAI`, asked contains `(source: peace)`, `PeaceSTOCKS@<sha>` is an ancestor of PeaceSTOCKS main, and the entry is not `coverage: "none"`. New proof rows set that optional trailing field (validated by `check.ts`). Historical PeaceAI rows whose prose already says live proof / proof A / no coverage (seqs **28, 30, 31, 35, 59, 60, 85–87, 97, 99, 101**) are listed in `COVERAGE_NONE_SEQS` instead of rewriting the append-only log. New PeaceAI rows with that wording must set the field or `validateLog` fails. Sha-on-main is checked via `PEACESTOCKS_CLONE` (`git merge-base --is-ancestor`); without a clone the check **fails closed** (no real-task credit).
- **PeaceAI-Workspace real tasks** (Auditor ruling (a), 2026-10-28) count the same way, only with the same proof as a PeaceSTOCKS landing, checked by `isWorkspaceRealTask` in `coverage.ts` (fail closed):
  - the row: `by: PeaceAI`, `(source: peace)` in asked, not `coverage: "none"`, asked does not say dry run, dated at or after `WORKSPACE_LANDING_SINCE` (**2026-10-29 00:00 MT**, so seq 221-225 and every Builder-written PR stay at 0: no backdating), exactly one `PeaceAI-Workspace#N` and one `PeaceAI-Workspace@<sha>` in `changed` and no `PeaceSTOCKS@`, and exactly one proof clause in `why`: `ws-proof: run <runId> candidate-<n> diff-sha256 <64 hex> verdict <commentId>`;
  - the derive run (Results `tasks/<N>/<runId>/`, read-only): the latest run for the issue, target PeaceAI-Workspace, task source `peace`, the candidate eligible with a `learned:` operation, sha256 of its recorded diff bytes equal to the clause, and Peace's recorded verdict `<commentId>` = `right` on that candidate and still the standing pick (`effectiveVerdict`). A dry or practice derive writes no Results task record, so it cannot be named;
  - the landing (Workspace clone): `<sha>` is an ancestor of main, the candidate diff applied to `<sha>^1` gives exactly `<sha>`'s tree (byte-identical), and no touched path is stage-1 protected (`selfProtectedReason`, incl. `builder-log/`, `.github/`, `peaceai/`), an existing test, a `NEVER_ZONE` pattern, in `computeNeverZone(<sha>^1)`, or a new file shadowing a never-zone import.
  - Inputs: `WORKSPACE_CLONE` (on main) and `PEACEAI_RESULTS_DIR`. Without both, Workspace landings get no credit (the `builder-log` job sets neither today, so its summary counts none).
- A skill is live-proven if (a) the log has a `by: PeaceAI` entry with a `PeaceSTOCKS@<sha>` or `PeaceAI-Workspace@<sha>` landing on/before the asOf date, or (b) it is listed in `LIVE_PROVEN_SINCE` in `check.ts`.
- Every `LIVE_PROVEN_SINCE` entry must name a builder-log `seq` that backs it (`by: PeaceAI`, same skill, `repo@sha` in `changed`). `check.ts` / `validateLog` fail if a map entry is unbacked.
- Approved-but-unproven skills (`APPROVED_SINCE` only) do **not** count toward Builder rows.
- Windows: last 7 calendar days (MT, inclusive of asOf) and all-time (**also bounded by asOf**).
- Remaining Builder tasks are ranked by missing skill count (`top missing`).

Counting is over `tasks.jsonl` only; the optional PeaceSTOCKS clone is read-only ancestry, not a network call from the coverage math itself.

## Verdict PR route (M87)

Since #379 and the `peacestocks-write` environment (2026-10-20), a `/verdict X right` on a PeaceSTOCKS task can land through a
PR the verdict job opens on PeaceSTOCKS (Peace approves the environment run; the bot never merges) instead of a patch comment.
`trace.ts` traces such a landing when the issue has no patch comment but has the bot's reply `… Opening a PR for X. <PR URL>`:
the `why` must name it once as `verdict PR PeaceSTOCKS#<n>`; the PR must be merged with the landing as its merge commit; its head
branch must be this issue's `peace-task/issue-<N>-<candidate>-<hex>`; and its diff applied to the landing's first parent must give
the landing tree. In Results mode the branch candidate must be the effective `right` pick and the Results candidate diff must give
the same tree (`T_PR_MISMATCH` / `T_HASH_MISMATCH H_RESULTS_PR`, codes and hashes only). First landings: seq 139-145 (#390-#396 via
PeaceSTOCKS#11-#17).

## Builder catch-up (M88, 2026-10-21)

Seq 146-212 log the 67 Builder PRs merged on PeaceAI-Workspace main after seq 96 (2026-10-15 19:35 MT) through #398, dated by merge
time (MT): engine, grading, training-gate, workflow and builder-log code changes, all `PEACEAI_SELF_CHANGE` (`missing skill`, PeaceAI's
own protected tooling). Not logged as separate rows: PRs that only recorded existing rows (#216, #231, #235, #250, #252, #254, #264,
#313, #322, #324, #330, #360, #376), the bot's approval and verdict PRs, and #302 (architect branch).

Seq 213-220 log 8 Builder tasks from the 11 commits Builder pushed straight to PeaceSTOCKS main on 2026-10-16 01:19-02:05 MT
(07:19-08:05Z), dated by commit time, one row per task: typecheck:worker (f2200a7, TSCONFIG_SCRIPT), tests.yml (58d91a2, WORKFLOW_JOB),
alert-unit job (d201eb3, WORKFLOW_JOB), ONEOFF_BUDGET_MS (c1b8db6, ENV_FIX), store-path walk bound (3459cef, MODIFY_LOGIC),
TENMIN_REDISPATCH_DRY_RUN (f68de39, ENV_FIX), PEACESTOCKS_REQUIRE_OBJECT_STORE at three sites (4b6715b + 6253466 + ad42237, ENV_FIX)
and the two 1000-page listing caps (a59def2 + 27acba9, MODIFY_LOGIC). All are `missing skill`: each predates its rule's approval
(ENV_FIX 11:41, WORKFLOW_JOB 11:46, TSCONFIG_SCRIPT 12:17) or has no rule. Every other first-parent commit on PeaceSTOCKS main since
seq 96 is a PeaceAI landing with its own row; 2f1ff83 is the merge of PeaceSTOCKS#9 (PeaceAI's b5b9c4b, seq 119). Coverage becomes
39/170 (22.9%) from 2026-10-21; the secondary figure excluding PEACEAI_SELF_CHANGE is 39/78 (50%).

## PeaceAI Workspace landings (2026-10-21)

Seq 221-225 record Peace's self-zone tasks #399-#403 (public-test-case-existing-v1), landed by PeaceAI through bot verdict PRs #406-#410
(merge commits 4eb6818, 4d187f8, 9af05b4, 4a69bef, c2c10e1). The Workspace verdict reply names no PR URL, so trace.ts reports them as
GRANDFATHERED T_NO_PATCH_COMMENT (like seq 124). coverage.ts counts PeaceSTOCKS landings only, so they do not change the figure (39/170). The 2026-10-28 Workspace path does not count them
either: they predate `WORKSPACE_LANDING_SINCE` and carry no `ws-proof:` clause.

## Batch v7 PeaceSTOCKS landings (2026-10-21)

Seq 226-236 record Peace's tasks #415-#425 (TEST_CASE_EXISTING; #415-#417 and #425 ranked on public-test-case-existing-v3, the rest on
v2), each `/verdict A right`, landed by PeaceAI through bot verdict PRs PeaceSTOCKS#18-#28 (squash merges e9cbc92, d473c08, de1eea2,
b4b019e, 8088763, 387d094, 2edd3e3, afb8054, ddefb95, d3d012b, 663e31e; rows in merge order). trace.ts traces them on the M87 PR route
with no GRANDFATHERED entry. Coverage becomes 50/181 (27.6%) from 2026-10-21.

## Batch v8 PeaceSTOCKS landings (2026-10-21)

Seq 237-247 record Peace's tasks #427-#437 (TEST_CASE_EXISTING; #428-#433 and #437 on public-test-case-existing-v1, #427 and
#434-#436 on v2, per Results ranking), each `/verdict A right`. The peacestocks-write runs were approved by Builder at Peace's request
after Auditor PASS; PeaceAI landed them through bot verdict PRs PeaceSTOCKS#29-#39 (squash merges 625acbf, 0c91b97, 6f87c78, da05efb,
67ce5cb, aebe643, 4184452, 88932ea, 3bde245, 1a07238, ef9778e; rows in merge order). trace.ts traces them on the M87 PR route with no
GRANDFATHERED entry. Coverage becomes 61/192 (31.8%) from 2026-10-21.

## Batch v9 PeaceSTOCKS landings (2026-10-22)

Seq 248-260 record Peace's tasks #443-#455 (TEST_CASE_EXISTING; #453 on public-test-case-existing-v1, #454 on v3 and the other 11 on
v4, per Results ranking), each `/verdict A right`. The peacestocks-write runs were approved by Builder at Peace's request after Auditor
PASS; PeaceAI landed them through bot verdict PRs PeaceSTOCKS#40-#52 (squash merges 3ed589e, 2734b82, f206f1d, f76b89b, 686a3b9,
d87d400, ce912aa, 5b76256, 9cfacfd, c361ad5, b8e9ea8, ef228e7, 0ab37c8; rows in merge order). trace.ts traces them on the M87 PR route
with no GRANDFATHERED entry. Coverage becomes 74/205 (36.1%) from 2026-10-22.

## Batch v10 PeaceSTOCKS landings (2026-10-22)

Seq 261-275 record Peace's tasks #471-#485 (TEST_CASE_EXISTING; #471-#476 on public-test-case-existing-v5 and #477-#485 on v6, per
Results ranking), each `/verdict A right`. The peacestocks-write runs were approved by Builder at Peace's request after Auditor PASS;
PeaceAI landed them through bot verdict PRs PeaceSTOCKS#53-#67 (squash merges 6a41f91, 5de4649, 3518b08, 4bea9e9, f590ed0, 0c21b96,
3d206b0, 4d0fb8a, a35c2d5, a421bd4, 9c88c0c, 20ea663, acd4c67, 97eb684, 8ff15d3; rows in merge order). trace.ts traces them on the M87
PR route with no GRANDFATHERED entry. Coverage becomes 89/220 (40.5%) from 2026-10-22.

## S1/S2 DERIVE_FROM_BEHAVIOR landings (2026-10-24)

Seq 276-277 record Peace's tasks #501 (isRetryableR2Status) and #502 (r2RetryDelayMs), behavior-only refiles of #486/#487, the first
PeaceAI landings on DERIVE_FROM_BEHAVIOR (public-derive-from-behavior-v1, approved via #499 as 8d60a96; added to APPROVED_SINCE from
2026-10-23 18:22 MT). PeaceAI derived each new function from the issue's examples, including Peace's own answers to the deriver's
questions (comment 6388142538 and his 699/464/30000 answers on the issues); PeaceAI review comments 6389128432 and
6383886641, each `/verdict A right`. The peacestocks-write runs were approved by Builder with
Peace's explicit permission; after Auditor byte-check PASS PeaceAI's verdict PRs PeaceSTOCKS#70/#71 were squash-merged as d6f3da9 and
0bbb039 (rows in merge order). Coverage becomes 91/222 (41.0%) from 2026-10-24.

## Scanner health-check slice 1 landings (2026-10-26)

Seq 278-281 record team-picked tasks #513 (checkinLine), #514 (isCheckinSilent), #515 (isCheckinExpired) and #516 (partState),
slice 1 of Peace's scanner self-health-check. Provenance (Auditor): on 2026-10-25 Peace asked the team to pick a real task; the spec
and examples were written by Builder's helper after a derive dry-run disclosed to Auditor, PeaceAI derived each body
(DERIVE_FROM_BEHAVIOR) and Peace gave each `/verdict A right`. The rows therefore say `source: team-picked`, not `(source: peace)`,
and earn no real-task coverage credit. #513-#515 used public-derive-from-behavior-v1; for #516 v1 refused (derive_no_fit), and
public-derive-from-behavior-v2 (approved via #518, landed as #519 2e04d3d) was taught for the gap #516 exposed and proven offline on
#516 before PeaceAI derived it live. PeaceAI review comments 6404211332, 6404256176, 6404297936 and 6407944873. The peacestocks-write
runs were approved by Builder under Peace's standing permission, after Auditor PASS; after Auditor byte-check PASS PeaceAI's verdict
PRs PeaceSTOCKS#73/#72/#74/#75 were squash-merged as 24025a3, f01a60d, 6cdbc2b and 8dec076 (rows in merge order). Coverage stays
91/222 (41.0%).
