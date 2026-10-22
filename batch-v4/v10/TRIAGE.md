# batch-v10 prep: PeaceSTOCKS characterization tests (2026-10-22, not filed)

Bases: PeaceSTOCKS main 0ab37c8 (0ab37c85f9d28791cfb7eaedbe56906885b74fab), PeaceAI-Workspace main 1fbe917 (live approved list: 28 rules,
v5 live; v6 merged as 8567c50, proposal #464, not approved). Node 22.
Status: **ready, NOT filed. Filing needs Peace's OK.** v5 tasks (Z11-Z15, Z17) can be filed on that OK. v6 tasks (Z1-Z10) are filable
only after Peace posts /approve-rule on #464 (until then Job A refuses them with public-test-case-existing-v6:NOT_APPROVED).

## How the tasks were picked
1. Census (blockers.mts, v6 engine, 0ab37c8): 286 exported functions, 122 accepted by v1-v6; v5 unlocks 112 vs 105 (+7), v6 unlocks
   122 vs 112 (+10), 0 lost.
2. All 17 newly unlocked functions were checked against landed tasks / filed issues / builder-log: none had a landed task
   (tenMinMassiveRequestsOf only appears in gaps.md). Three older v5-eligible functions with untested branches were added (Z15-Z17).
   Expected values were computed by running the real functions on 0ab37c8 (values.json).
3. Each task was graded locally with PeaceAI's Job A (generate.ts) and Job B (test-candidates.ts) and checked with run.py (diff applies,
   4 typechecks, full suite, new test passes and fails with the function stubbed). v5 tasks ran against the live 28-rule list
   (Workspace 1fbe917). v6 tasks ran against a box-only copy whose approved.json carries a simulated v6 entry (fake issue 999999);
   that copy is not a git repo and is not in this folder. The final bodies were re-run through Job A/B (run-final-v5.log,
   run-final-v6.log).

## Ready, v5 (filable on Peace's OK) (6)
| id | function | module | title | rule | cands | Job B |
|---|---|---|---|---|---:|---|
| Z11 | corporateActionCoverageRecords | src/corporate-action-coverage.ts | [corporate-action-coverage] corporateActionCoverageRecords: characterization test for deduped sorted sessions, action counts and datasets | v5 | 1 | COUNTS |
| Z12 | tenMinScanCheckStops | src/tenmin-redispatch.ts | [tenmin-redispatch] tenMinScanCheckStops: characterization test for prior counts and the reason prefix | v5 | 1 | COUNTS |
| Z13 | stopRecordForScanCancelled | src/tenmin-redispatch.ts | [tenmin-redispatch] stopRecordForScanCancelled: characterization test for a record without an outcome or run id | v5 | 1 | COUNTS |
| Z14 | isEmptyTenMinRangeManifest | src/tenmin-range-reply-dust.ts | [tenmin-range-reply-dust] isEmptyTenMinRangeManifest: characterization test for empty and non-empty manifests | v5 | 1 | COUNTS |
| Z15 | aggregateIntradayBars | src/intraday.ts | [intraday] aggregateIntradayBars: characterization test for interval guards, an empty list and a halted bar | v5 | 1 | COUNTS |
| Z17 | planTenMinAlert | src/tenmin-alert.ts | [tenmin-alert] planTenMinAlert: characterization test for paused job failures and failed or skipped steps | v5 | 1 | COUNTS |

## Ready, v6 (filable only after Peace posts /approve-rule on #464) (10)
| id | function | module | title | rule | cands | Job B |
|---|---|---|---|---|---:|---|
| Z1 | canonicalJson | src/daily-bars-pack-decode.ts | [daily-bars-pack-decode] canonicalJson: characterization test for sorted keys, nesting and scalars | v6 | 1 | COUNTS |
| Z2 | stableJson | src/identity.ts | [identity] stableJson: characterization test for sorted keys, nested arrays and scalars | v6 | 1 | COUNTS |
| Z3 | errorCode | src/daily-bars-sidecar.ts | [daily-bars-sidecar] errorCode: characterization test for leading-code extraction and the UNKNOWN fallback | v6 | 1 | COUNTS |
| Z4 | errorClass | src/oct2024-tenmin-oneoff.ts | [oct2024-tenmin-oneoff] errorClass: characterization test for plain values, separators and the 60-character cap | v6 | 1 | COUNTS |
| Z5 | tenMinMassiveRequestsOf | src/tenmin-range-reply-dust.ts | [tenmin-range-reply-dust] tenMinMassiveRequestsOf: characterization test for valid, invalid and missing request counts | v6 | 1 | COUNTS |
| Z6 | tenMinDailyEnabled | src/tenmin-daily-liquid.ts | [tenmin-daily-liquid] tenMinDailyEnabled: characterization test for the TENMIN_DAILY_ENABLED flag | v6 | 1 | COUNTS |
| Z7 | tenMinDailyRedispatchHold | src/tenmin-daily-liquid.ts | [tenmin-daily-liquid] tenMinDailyRedispatchHold: characterization test for empty, upper-case and unrelated values | v6 | 1 | COUNTS |
| Z8 | scanGroupedReplyDustEnabled | src/scan-grouped-reply-dust.ts | [scan-grouped-reply-dust] scanGroupedReplyDustEnabled: characterization test for padded values and unrelated keys | v6 | 1 | COUNTS |
| Z9 | tickerIndexDatedEnabled | src/ticker-reference-dated.ts | [ticker-reference-dated] tickerIndexDatedEnabled: characterization test for case, false and the FULL flag alone | v6 | 1 | COUNTS |
| Z10 | tickerIndexDatedFullEnabled | src/ticker-reference-dated.ts | [ticker-reference-dated] tickerIndexDatedFullEnabled: characterization test for the FULL flag against the dated flag | v6 | 1 | COUNTS |

All 16 together on 0ab37c8: suite 614/614 (598 + 16), typecheck, typecheck:scanner, typecheck:lib and typecheck:worker all ok. Each task
creates its own new test file (disjoint). Bodies: the `Builder pre-file` note, no `\u` escapes, no control characters, at most 8 checks;
proposal-gate (core text, core paths, personal info) PASS on all 16. Final bodies re-run: 16/16 SOLVED, one candidate each of the
listed version, Job B COUNTS, diffs byte-identical to candidates/*.diff.

Projected coverage (official now 74/205 = 36.1%):
- all 16 land: (74+16)/(205+16) = **90/221 = 40.7%**
- only the 6 v5 tasks (before #464 is approved): 80/211 = 37.9%

## Dropped / notes
- Z16 reconstructFeatures (src/features.ts, v5): one candidate, typecheck / suite / new test ok, but Job B grades it UNGRADABLE
  (not-test-only, before_fix=null): the stubbed copy could not be graded. Would not count; dropped (calls kept in dropped.json).
- Z15 aggregateIntradayBars: the single VALID_TRADED bar check was removed: v5 refuses check literals that set optional members
  (open/high/low/close/volume), test_refused; bisected on the box, not a length bound. The 4 kept checks (interval guards 25 and 5,
  empty list, a halted bar) solve. See NEXT-SKILL.md.
- Z4 errorClass: the call errorClass({ code: 5 }) returns "[object" (String(value) cut at the first space); not pinned (SKIP in mk.py),
  it looks unintended and should not be locked in by a characterization test.
- Z1 / Z2: values containing `"` are written single-quoted; backslash-escaped quotes make the check grammar return task_unparsed.
- Approval-section wording in #464 still says "Architect posts /approve-rule" (inherited from #457 / #440); only Peace posts it.

Files: issues/Z*.json (title + body to file), issues/Z*.md (bodies as gated), candidates/Z*.diff (graded candidate), tasks.json (final),
tasks-dry.json, dry.json, mk.py, run.py, run-*.log, calls.json, dropped.json, values.json, titles.txt, filed.txt.
Next skill: NEXT-SKILL.md (blockers.mts, blockers.txt).
