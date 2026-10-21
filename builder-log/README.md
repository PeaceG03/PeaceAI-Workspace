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
