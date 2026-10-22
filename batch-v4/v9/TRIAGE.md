# batch-v9 prep: PeaceSTOCKS characterization tests (2026-10-22, not filed)

Bases: PeaceSTOCKS main ef9778e (after batch-v8 #29-#39), PeaceAI-Workspace main 3670cd8 (live approved list: 27 rules, v4 live). Node 22.23.3.
Status: **ready to file, waiting for Peace's OK.** Nothing was filed.

## How the tasks were picked
1. Census (census.mts on ef9778e): 286 exported functions in src/, 105 accepted by the live test-existing targets (v1 34, v2 +44, v3 +14, v4 +13).
2. Priority: the 13 functions v4 newly unlocked, then other still-untested eligible functions. Untested behaviour from node --test
   coverage (lcov) of the full suite (585/585) plus a read of every existing direct call; functions already pinned by an earlier
   PeaceAI landing were skipped. Expected values were computed by running the real functions on ef9778e (compute.ts, values.json).
3. Each task was graded locally with PeaceAI's own Job A (generate.ts) and Job B (test-candidates.ts) against the live 27-rule list,
   then checked independently (run.py: diff applies, 4 typechecks, full suite, new test passes and fails with the function stubbed).
   The final bodies (dry-run note filled in) were re-run through Job A/B (run-final.log): same single candidate, byte-identical diffs.

## Ready to file (13)
| id | function | module | title | rule | cands | Job B |
|---|---|---|---|---|---:|---|
| Y1 | holdActive | src/tenmin-gate.ts | [tenmin-gate] holdActive: characterization test for waiting, null and mixed run lists | v4 | 1 | COUNTS |
| Y2 | hasSealedMarker | src/tenmin-gate.ts | [tenmin-gate] hasSealedMarker: characterization test for empty, non-dispatch and mixed run lists | v4 | 1 | COUNTS |
| Y3 | countOtherActiveScannerRuns | src/tenmin-redispatch.ts | [tenmin-redispatch] countOtherActiveScannerRuns: characterization test for every active and inactive run state | v4 | 1 | COUNTS |
| Y4 | priorConsecutiveFailures | src/tenmin-redispatch.ts | [tenmin-redispatch] priorConsecutiveFailures: characterization test for empty lists, cancelled runs and non-dispatch runs | v4 | 1 | COUNTS |
| Y5 | oneOffPauseReason | src/oct2024-tenmin-oneoff.ts | [oct2024-tenmin-oneoff] oneOffPauseReason: characterization test for guard window boundaries and precedence | v4 | 1 | COUNTS |
| Y6 | pairRangeForDate | src/tenmin-history.ts | [tenmin-history] pairRangeForDate: characterization test for custom anchors, year wrap and date guards | v4 | 1 | COUNTS |
| Y7 | datedTickerMonthStarts | src/ticker-reference-dated.ts | [ticker-reference-dated] datedTickerMonthStarts: characterization test for the firstMonth option | v4 | 1 | COUNTS |
| Y8 | replyDustObjectMetadata | src/intraday-reply-dust.ts | [intraday-reply-dust] replyDustObjectMetadata: characterization test for the reply dust object metadata keys | v4 | 1 | COUNTS |
| Y9 | disabledScanGroupedReplyDustReport | src/scan-grouped-reply-dust.ts | [scan-grouped-reply-dust] disabledScanGroupedReplyDustReport: characterization test for the disabled grouped reply dust report | v4 | 1 | COUNTS |
| Y10 | tenMinRangeObjectMetadata | src/tenmin-range-reply-dust.ts | [tenmin-range-reply-dust] tenMinRangeObjectMetadata: characterization test for link and origin metadata | v4 | 1 | COUNTS |
| Y11 | dailyReplyDustHashedFileKey | src/daily-reply-dust.ts | [daily-reply-dust] dailyReplyDustHashedFileKey: characterization test for hashed file key layout and guards | v1 | 1 | COUNTS |
| Y12 | minutesUntilGuardWindowEnd | src/tenmin-redispatch.ts | [tenmin-redispatch] minutesUntilGuardWindowEnd: characterization test for times just before the dispatch lead | v3 | 1 | COUNTS |
| Y13 | resolveSessionPredictionStatus | src/prediction-status.ts | [prediction-status] resolveSessionPredictionStatus: characterization test for frozen record tie-breaks | v4 | 1 | COUNTS |

All 13 together on ef9778e: suite 598/598 (585 + 13), typecheck, typecheck:scanner, typecheck:lib and typecheck:worker all ok. Each task
creates its own new test file (disjoint). Bodies: the `Builder pre-file` note, no `\u` escapes, no control characters, at most 8 checks;
proposal-gate (core text, core paths, personal info) PASS on all 13. 11 of the 13 use the new v4 rule: 11 of the 13 v4-unlocked functions (providerRecords and resolveSpyBenchmarkId not drafted, see below).

Projected coverage if all 13 land on PeaceSTOCKS: (61+13)/(192+13) = **74/205 = 36.1%** (from 61/192 = 31.8%).

## Dropped / notes
- Y14 monthFileFromLines([]) is "": Job B graded REJECTED_PASSES_BOTH (the string stub returns "", so the test cannot fail with the stub). Correct refusal; dropped.
- Y6 pairRangeForDate: the first independent run said WRONG only because run.py's stub inserted into the return-type literal
  `{ calendarFrom: string; calendarTo: string }`; with the body stubbed by hand the new test fails (0/1) and passes on the real code.
  run.py in this folder now finds the body brace; the final run grades Y6 SOLVED.
- providerRecords, resolveSpyBenchmarkId (v4-eligible): an argument needs a full SecurityMasterRecord (17 fields with nested
  eligibility / identities), past the 600-character object bound; not drafted. scanner.ts / gap-refill-lib.ts would also need a scope check.
- replyDustObjectMetadata, disabledScanGroupedReplyDustReport had no direct test; Y8 / Y9 pin their exact shapes.
- No apparent bugs were pinned: holdActive(null status) = true and the guard-window precedence are fail-closed by design.
- parseFetchIdentityKey: still gap 4 (NUL-joined key) as in v7/v8.

Files: issues/Y*.json (title + body to file), issues/Y*.md (bodies as gated), candidates/Y*.diff (graded candidate), tasks.json (final),
tasks-dry.json, mk.py, run.py, run.log, run-final.log, census.mts, checks.txt, compute.ts, values.json, titles.txt, dry.json.
Next skill: NEXT-SKILL.md (blockers.mts, blockers.txt).
