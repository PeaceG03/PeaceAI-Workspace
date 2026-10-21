# batch-v8 prep: PeaceSTOCKS characterization tests (2026-10-21, not filed)

Bases: PeaceSTOCKS main 663e31e (after batch-v7 #18-#28), PeaceAI-Workspace main 129a084 (live approved list: 26 rules). Node 22.23.3.
Status: **ready to file, waiting for Peace's OK.** Nothing was filed.

## How the tasks were picked
1. Census (census.mts on 663e31e): 286 exported functions in src/, 92 accepted by the live test-existing targets (v1 34, v2 +44, v3 +14).
2. Untested behaviour: node --test coverage (lcov, an.py) of the full suite (574/574) plus a read of every existing direct call of each of
   the 92, skipping every function already logged as a PeaceAI landing (batches v4, TE, v5, v7: 26 functions). lcov was only a hint (it
   reports some lines as unhit that tests do hit, e.g. dueSlot after W1); every gap below was confirmed by reading the existing tests.
3. Expected values were computed by running the real functions on 663e31e (not hand-derived).
4. Each task was graded locally with PeaceAI's own Job A (generate.ts) and Job B (test-candidates.ts) against the live 26-rule list, then
   checked independently (run.py: diff applies, 4 typechecks, full suite, new test passes and fails with the function stubbed). The final
   bodies (with the dry-run note filled in) were re-run through Job A/B (runs-final) to confirm the same single candidate.

## Ready to file (11)
| id | function | rule | cands | Job B | untested behaviour pinned |
|---|---|---|---:|---|---|
| X1 | tenmin-redispatch maxChainOf | v2 | 1 | COUNTS | numeric input, hard cap 100 from a number / "101", negative / fractional number, "" |
| X2 | tenmin-range-reply-dust isTenMinRangeAbortError | v1 | 1 | COUNTS | credential / API key / 429 / exact OBJECT_STORE_REQUIRED / R2_ / REPLY_DUST_ZSTD classes, 5xx not an abort |
| X3 | tenmin-range-reply-dust tenMinRangeGapReason | v1 | 1 | COUNTS | empty, one-letter, two-letter minimum, lowercase first letter, code cut at the colon |
| X4 | ticker-reference-dated datedTickerDatePrefix | v1 | 1 | COUNTS | returned prefix (never asserted), Feb 29, Apr 31, INVALID_SESSION_DATE guard |
| X5 | tenmin-history isTransientHistoryError | v1 | 1 | COUNTS | socket hang up, HTTP 5xx, bare 502, timed out, ENOTFOUND, UND_ERR, 404 and 5020 not transient |
| X8 | daily-reply-dust dailyReplyDustFileKey | v1 | 1 | COUNTS | literal key layout, INVALID_SESSION_DATE |
| X9 | tenmin-history addCalendarYears | v1 | 1 | COUNTS | Feb 29 to a leap year, forward / zero shift, Feb 28 back, INVALID_SESSION_DATE |
| X10 | oct2024-tenmin-oneoff parseChainIndex | v2 | 1 | COUNTS | undefined, padded, 999 / 1000 digit limit, leading zero, negative |
| X11 | tenmin-history estimateTenMinRangeRemaining | v2 | 1 | COUNTS | negative counts clamped, sub-minute budget (min 1 req/run), budget hit with 0 actual requests |
| X12 | oct2024-tenmin-oneoff readbackVerdict | v2 | 1 | COUNTS | verifiedOk short of / above listed with no failures, 1-object pass |
| X13 | num-utils bandOf | v1 | 1 | COUNTS | inclusive lower / upper edges and just past them |

All 11 together on 663e31e: suite 585/585 (574 + 11), typecheck, typecheck:scanner, typecheck:lib and typecheck:worker all ok. Each task
creates its own new test file (disjoint). Bodies: the `Builder pre-file` note, no `\u` escapes, no control characters, at most 8 checks;
proposal-gate (core text, core paths, personal info) PASS on all 11.

Projected coverage if all 11 land on PeaceSTOCKS: (50+11)/(181+11) = **61/192 = 31.8%** (from 50/181 = 27.6%).

## Dropped
- X6 hostRequiresObjectStore (src/host.ts): every test-existing rule refuses with `denied_path` (host.ts is protected). Not a gap to fix.
- X7 alertMarker: the expected value is an HTML comment (`<!-- scanner-alert-key: ... -->`); issue-text cleaning strips it, so the
  candidate asserted `" "` and Job B graded it REJECTED_FAILS_BOTH (correctly refused). Gap: HTML comments in expected string values.
- First X2 draft had 9 checks: no candidate (learned-test MAX_CHECKS = 8); trimmed to 8.
- parseFetchIdentityKey: still gap 4 (NUL-joined key) as in v7.
- bandOf zero-width band / NaN: bandOf(4, 5, 5) and bandOf(6, 5, 5) return "inside", bandOf(NaN, 0, 10) returns "above". These look like
  bugs, so they are NOT pinned by X13 (a characterization test would lock them in). Candidate MODIFY_LOGIC task for Peace to decide.
- Everything else among the 92: existing direct tests cover the branches and edges (asOfVerdict, refillPauseReason, parseOneOffBudgetMs,
  sortTenMinRangeEntries, ...), or already landed in an earlier batch.

## Top skill gaps (census on 663e31e, 194 of 286 exported functions refused by every test-existing target)
- test_target_signature 160. By signature content (a function can have several):
  - imported named types / interfaces (e.g. SessionCalendar, CanonicalTenMinuteBar, DailyBarSessionIndex): 115
  - Uint8Array / Buffer (bytes) params or returns: 32
  - no type annotation (inferred return or param): 30
  - Map / Set: 15
  - unknown / any (canonicalJson, errorCode, stableJson, fingerprint): 13
  - Record<...>: 8; NodeJS.ProcessEnv: 6; callbacks: 4; generics: 1
- test_target_impure 14, test_target_date_local 11, test_target_io 6, test_target_async 3.
Suggested next skill: named-type (imported interface) args/returns as plain-data object literals, then Uint8Array / Map / Set
(matches the queued "Byte, Map/Set and Record signatures" idea). The 6 ProcessEnv ones (e.g. tenMinDailyEnabled) are a small, easy win.

Files: issues/X*.json (title + body to file), issues/X*.md (bodies as gated), candidates/X*.diff (graded candidate), tasks.json, mk.py,
run.py, run.log, run-final.log, census.mts, an.py, sigs.mts.
