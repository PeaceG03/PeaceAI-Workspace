
## v5 skill (M91, public-test-case-existing-v5) — checkpoint 1

- Branch `m91/test-existing-v5` (from Workspace main 3670cd8), worktree /workspace/te5/ws. Pushed 2 commits
  (engine 477f4e3, spec/evidence/tests on top). No PR yet; no proposal issue.
- Engine: `v5` flag in V2Ctx; `typeof N` of a literal const (local or followed sibling import, never mutated, literal
  init or plain annotation; parameter-name typeof refused) and `T["k"]` on a plain object type (type literal,
  non-generic interface without heritage, alias of a type literal; required property, string-literal key).
  Job B gradeExisting gets `v5`. PROTECTED_SELF M91 entry, digest re-pinned.
- Census (PeaceSTOCKS ef9778e): v1 34, v2 78, v3 92, v4 105, **v5 112 (+7, 0 lost)**: corporateActionCoverageRecords,
  reconstructFeatures, aggregateIntradayBars, planTenMinAlert, isEmptyTenMinRangeManifest, tenMinScanCheckStops,
  stopRecordForScanCancelled. Script: /workspace/te5/census5.mts.
- Evidence: 14 examples / 10 repos (mining in /workspace/te5/mine: mine5.mts, build-te5.mts, corecheck.mts,
  notices.mts, ev.mts). 10 candidates dropped by the pre-push core-text scan (run corecheck.mts before committing).
- Sim: /workspace/te5/sim (tar copy, NOT a git repo, fake approval 999999; never commit). Z1-Z3 (v5 targets) SOLVED,
  1 candidate each, COUNTS.
- Next: stress-v1 baseline (/workspace/stress/runs-m91) + sim (runs-m91-sim), full suite, then open the PR (do not
  merge, no proposal issue).

## v5 checkpoint 2 (after interruption)

- Branch m91/test-existing-v5 at 32b8cca (pushed). No PR yet.
- Sim stress (/workspace/te5/stress, final hash ad677b36): Z1-Z3 v5 SOLVED/COUNTS; regression Y1 -> v4, Y11 -> v1,
  Y12 -> v3 (one candidate each, COUNTS): not_needed chaining holds.
- Box checks on 32b8cca: approved list PASS rules=27, leak PASS, builder-log 61/61, typecheck OK, test 17/17,
  self 5/5, tools 1106/1111 with 1 fail = m48 snapshot rebuild (box-only, fails identically on main 3670cd8; 4 skipped).
- Running: stress-v1 baseline -> /workspace/stress/runs-m91 (log runs-m91.log). Next: sim run -> runs-m91-sim with
  WS=/workspace/te5/sim, score with /workspace/stress/score.py, then open the PR.

## v5 checkpoint 3 (PR opened)

- Stress v1 done: baseline runs-m91 59/66 (29/36, 30/30, 0 wrong, 0 crash); sim v5 runs-m91-sim 59/66, 0 wrong; both identical to M90 task by task.
- PR #442 opened from m91/test-existing-v5 at 32b8cca. NOT merged, NO rule-proposal issue. Next: Auditor review.
## 2026-10-22 ~02:15 MDT: pnpm retry PR + v6 (M93) started

- Job 1 DONE: PR #459 (branch fix/pnpm-download-retry, worktree /workspace/pr1, head b805d0a): install-target.sh retries 3x
  (15s/45s), test peaceai/test/install-target-retry.test.ts. Not merged.
- Job 2 v6 (public-test-case-existing-v6): branch m93/test-existing-v6, worktree /workspace/te7/ws from main 4adef5a.
  Plan: `unknown` as a top-level param type; `NodeJS.ProcessEnv` param (Record<string,string|undefined>), default
  exactly `process.env` only on the target and only if every check call passes an object literal for it (Job A + Job B
  test-source check). Not pushed yet.

## v6 checkpoint 1 (M93, branch m93/test-existing-v6, worktree /workspace/te7/ws)

- Pushed: engine d88751f, spec/evidence e0e1753, record/doc/proofs/selfchange on top. No PR yet.
- Spec public-test-case-existing-v6 sha 358edf11b157db360c801406a4be102f2d6258f06287dfc165dc8a2e8a55e51a.
- Census PeaceSTOCKS ef9778e: v5 112 -> v6 122 (+10, 0 lost) (/workspace/te7/census6.mts).
- Evidence 19 examples / 17 repos (11 ProcessEnv, 8 unknown); mining scripts /workspace/te7/mine (mine6, build-te6, ev6, notices6, corecheck).
- Box checks green (tools 1116/1121, only m48 box-only fail). Next: sim (/workspace/te7/sim) + stress v1 baseline runs-m93 and sim runs-m93-sim, then PR.

## #466 Date-setter ruling checkpoint (11:10 MDT 2026-10-22)
- e938b8c pushed on m97/test-case-existing-v7: freshDateSetters + dateRefusalTE (TE-only), Date-to-string refusal, m97-te7-datesetter test. TE suites 180/180.
- Census head (0ab37c8): v1 35 v2 76 v3 87 v4 102 v5 109 v6 118 v7 123; gains vs 035d215 = addCalendarDays chain (7 fns). /tmp/w466y/cen.json, main /tmp/w466y/cen-main.json.
- ONEOFF 12 NOT recovered: us-calendar nyseClosedDates mutates goodFriday = easterSunday(year) (Date returned then mutated by caller = required refusal). Experiment /tmp/oo (copy patched) -> /tmp/w466y/cen-oo.json.
- Head-not-main: the 7 addCalendarDays-chain fns (fresh new Date(`${date}T00:00:00Z`).setUTCDate) — conflicts with the subset requirement; reporting.
- Next: subset probes, landed, v10, ev, box, CI, PR body, stress.
