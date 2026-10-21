# batch-v7 prep: PeaceSTOCKS characterization tests (2026-10-21, not filed)

Bases: PeaceSTOCKS main 8b1f413, PeaceAI-Workspace main 616c083 (live approved list: 26 rules, including public-test-case-existing-v3@b31df045). Node 22.23.3.
Status: **ready to file, waiting for Peace's OK.** Nothing was filed.

## How the tasks were picked
1. Census (census3.mts on 8b1f413): exported functions the v1 target refuses and the v2/v3 target accepts. That gives 58: 14 newly eligible under v3 (Date in the signature) and 44 v2-only. All 34 v1-eligible functions already have tests.
2. Untested behaviour: node --test coverage (lcov) of the full suite, plus a read of every existing direct call of each function. The "18 v2-eligible with no direct call" figure from the v6 triage is now 5, and all 5 are covered: 3 `*RequiresObjectStore` (dynamic-import tests from the Oct 16 Builder pushes), isTransientHistoryError (an aliased import) and parseFetchIdentityKey (see below). So this batch targets **untested branches and boundaries** of eligible functions instead. Each task's note says what the existing tests leave out.
3. Expected values were computed by running the real functions on 8b1f413. They are not hand-derived.
4. Each task was graded locally with PeaceAI's own Job A (generate.ts) and Job B (test-candidates.ts) against the live 26-rule list, then checked independently (batch-v5 run.py: the diff applies, 4 typechecks pass, the full suite passes, the new test passes and fails with the function stubbed).

## Ready to file (11)
| id | function | rule | candidates | Job B | untested behaviour pinned |
|---|---|---|---:|---|---|
| W1 | scan-backstop dueSlot | v3 | 1 | COUNTS | no direct test; slot branch never reached by the suite: 30/89-min window edges, Tue-Sat rule |
| W2 | scan-backstop lastScanSlot | v3 | 1 | COUNTS | no direct test: at-slot, same-day 09:30, look-back over Sun/Mon to Sat |
| W3 | gap-refill inRefillGuard | v3 | 1 | COUNTS | second-window start 09:12, first-window end 06:14/06:15, 10:14 |
| W4 | massive-plan-probe classifyPlanProbe | v2 | 1 | COUNTS | unparsable 200 body (catch branch), zero / non-numeric rate header, pass-through fields |
| W5 | tenmin-mode lastOutcomeFromRecord | v2 | 1 | COUNTS | refused branch (STOP_REFUSAL, STOP_BOUNDED_MANUAL), bare 429, missing reason / job result |
| W6 | universe eligibilityForBarCount | v2 | 1 | COUNTS | LEVEL_0/1/3, 19/251/252 boundaries, fractional count |
| W7 | tenmin-range-reply-dust resolveTenMinDelistedCoverageForSeal | v2 | 1 | COUNTS | unset or MISSING request with no open gaps |
| W8 | tenmin-range-entries tenMinRangeEntriesObjectKey | v2 | 1 | COUNTS | literal key layout, INVALID_ENTRIES_SHA256, INVALID_RANGE |
| W9 | tenmin-daily-liquid tenMinDailyIndexKey | v2 | 1 | COUNTS | another pair (Jan-Feb 2024), INVALID_SESSION_DATE |
| W10 | tenmin-redispatch isTransientFailure | v2 | 1 | COUNTS | 5xx / ETIMEDOUT / 404 stops, SCAN_CANCELLED and KILL_SWITCH on a failed job |
| W11 | tenmin-redispatch guardWindowState | v3 | 1 | COUNTS | first-window end, second window, wrap to the next day |

All 11 together on 8b1f413: suite 574/574 (563 + 11), typecheck, typecheck:scanner, typecheck:lib and typecheck:worker all ok. Each task creates its own new test file (disjoint).
Bodies: the `Builder pre-file` note, no `\u` escapes, no control characters; proposal-gate (core text, core paths, personal info) PASS on all 11.
W11 note: the batch-v5 harness's own stub inserts after the first `{`, which for guardWindowState is its object return type, so the harness showed "kills_stub=False". A manual body stub makes the new test fail (0/1). PeaceAI's Job B (object-aware stub) graded it COUNTS. Harness artefact, not a task problem.

Projected coverage if all 11 land on PeaceSTOCKS: (39+11)/(170+11) = **50/181 = 27.6%** (from 39/170 = 22.9%).

## Left out
- parseFetchIdentityKey: a positive check needs a NUL-joined key (gap 4, #397); malformed-only checks pass against an undefined-returning stub.
- The other v3-eligible functions (et-time utcMinuteOfDay/utcDateKey, us-calendar utcDaysBetween, scan-yield/scan-backstop inScanGuardWindow, inOneOffGuardWindow, refillPauseReason, minutesUntilGuardWindowEnd, healWaitSeconds, isUtcWeekend) already have boundary tests covering every branch, so a new test would duplicate them.
- The remaining v2-only functions have direct tests on every branch (lcov plus a read of the calls).

Files: issues/W*.json (title + body to file), issues/W*.md (bodies as gated), candidates/W*.diff (graded candidate), tasks.json, mk.py, run.py, run.log.
