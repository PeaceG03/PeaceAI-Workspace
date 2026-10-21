import json, re
NOTE = ("(Builder pre-file, TEST_CASE_EXISTING, public-test-case-existing-{rule}): Peace's task (source: peace). {why} "
 "Production safety: test-only: one new src/*.test.ts file only: no source edits, no fix commit. Job B grades it fix-free: the test passes on the current code and fails with the function body stubbed. "
 "The running scanner chain is unchanged. {dry} Disjoint file: each task in this batch creates its own new test file. Expected COUNTS.)")
H = "a" * 0
T = [
 ("X1","v2","tenmin-redispatch","maxChainOf","src/tenmin-redispatch.ts","chain caps","characterization test for numeric and out-of-range chain caps",
  ['maxChainOf(7) is 7', 'maxChainOf(150) is 100', 'maxChainOf(-1) is 24', 'maxChainOf(2.5) is 24', 'maxChainOf("") is 24', 'maxChainOf("101") is 100'],
  "maxChainOf (TENMIN_REDISPATCH_MAX_CHAIN parsing) is tested only with string inputs \"500\", \"x\", \"0\" and undefined; a numeric value, the hard cap at 100 from a number or \"101\", a negative or fractional number and an empty string are untested; this pins them."),
 ("X2","v1","tenmin-range-reply-dust","isTenMinRangeAbortError","src/tenmin-range-reply-dust.ts","abort errors","characterization test for the range abort error classes",
  ['isTenMinRangeAbortError("MASSIVE_CREDENTIAL_REJECTED") is true', 'isTenMinRangeAbortError("MASSIVE_API_KEY_MISSING") is true',
   'isTenMinRangeAbortError("MASSIVE_HTTP_429") is true',
   'isTenMinRangeAbortError("OBJECT_STORE_REQUIRED") is true', 'isTenMinRangeAbortError("OBJECT_STORE_REQUIRED:x") is false',
   'isTenMinRangeAbortError("R2_PUT_FAILED") is true', 'isTenMinRangeAbortError("REPLY_DUST_ZSTD_FAILED") is true',
   'isTenMinRangeAbortError("MASSIVE_HTTP_500") is false'],
  "Only MASSIVE_HTTP_403 (true) and TENMIN_TICKER_FORBIDDEN (false) are tested; the credential, API key, 429, exact OBJECT_STORE_REQUIRED, R2_ and REPLY_DUST_ZSTD classes and a 5xx (not an abort) are untested; this pins them."),
 ("X3","v1","tenmin-range-reply-dust","tenMinRangeGapReason","src/tenmin-range-reply-dust.ts","gap reason codes","characterization test for gap reason code extraction edges",
  ['tenMinRangeGapReason("") is "TENMIN_RANGE_FETCH_FAILED"', 'tenMinRangeGapReason("A") is "TENMIN_RANGE_FETCH_FAILED"',
   'tenMinRangeGapReason("AB") is "AB"', 'tenMinRangeGapReason("a_CODE") is "TENMIN_RANGE_FETCH_FAILED"',
   'tenMinRangeGapReason("MASSIVE_NETWORK:ECONNRESET") is "MASSIVE_NETWORK"'],
  "The gap reason is tested with a lowercase message and the known codes only; an empty message, a one-letter code, the two-letter minimum, a lowercase first letter and a code cut at the colon are untested; this pins them."),
 ("X4","v1","ticker-reference-dated","datedTickerDatePrefix","src/ticker-reference-dated.ts","date prefixes","characterization test for valid dated ticker prefixes",
  ['datedTickerDatePrefix("2024-02-29") is "permanent/ticker-reference-dated/2024-02-29"', 'datedTickerDatePrefix("2026-06-30") is "permanent/ticker-reference-dated/2026-06-30"',
   'datedTickerDatePrefix("2026-04-31") throws INVALID_CALENDAR_DATE', 'datedTickerDatePrefix("2026-1-05") throws INVALID_SESSION_DATE'],
  "Only the INVALID_CALENDAR_DATE throws (month 13, Feb 30) are tested; the returned prefix for a valid date (including Feb 29 and a 30-day month end), April 31 and the INVALID_SESSION_DATE format guard are untested; this pins them."),
 ("X5","v1","tenmin-history","isTransientHistoryError","src/tenmin-history.ts","transient history errors","characterization test for more transient and permanent history errors",
  ['isTransientHistoryError("socket hang up") is true', 'isTransientHistoryError("HTTP 503 Service Unavailable") is true',
   'isTransientHistoryError("upstream returned 502") is true', 'isTransientHistoryError("Request timed out") is true',
   'isTransientHistoryError("ENOTFOUND api.example") is true', 'isTransientHistoryError("UND_ERR_CONNECT_TIMEOUT") is true',
   'isTransientHistoryError("HTTP 404") is false', 'isTransientHistoryError("status 5020") is false'],
  "The in-run retry rule is tested with fetch failed, MASSIVE_NETWORK:ECONNRESET and two config errors only; socket hang up, HTTP 5xx, a bare 502, timed out, ENOTFOUND, UND_ERR, a 404 and a 4-digit number are untested; this pins them."),
 ("X6","v2","host","hostRequiresObjectStore","src/host.ts","object store flag","characterization test for blank and padded object store flags",
  ['hostRequiresObjectStore("") is false', 'hostRequiresObjectStore(" 1 ") is true', 'hostRequiresObjectStore(" 0 ") is false',
   'hostRequiresObjectStore("01") throws PEACESTOCKS_REQUIRE_OBJECT_STORE_INVALID', 'hostRequiresObjectStore("1.0") throws PEACESTOCKS_REQUIRE_OBJECT_STORE_INVALID'],
  "The flag is tested with undefined, \"0\", \"1\" and three words; an empty string, padded \" 1 \" / \" 0 \" (trimmed) and the near-misses \"01\" / \"1.0\" (must throw, not turn on) are untested; this pins them."),
 ("X7","v1","tenmin-alert","alertMarker","src/tenmin-alert.ts","alert marker text","characterization test for the exact alert marker text",
  ['alertMarker("111:STOP_DONE") is "<!-- scanner-alert-key: 111:STOP_DONE -->"', 'alertMarker("a->b") is "<!-- scanner-alert-key: a->b -->"'],
  "The alert marker is only checked by length (41, 34) and through round trips; its literal text, which open alert issues are matched on, and a key with -> (allowed, only --> is refused) are untested; this pins them."),
 ("X8","v1","daily-reply-dust","dailyReplyDustFileKey","src/daily-reply-dust.ts","daily file keys","characterization test for the daily grouped file key",
  ['dailyReplyDustFileKey("2026-10-13") is "permanent/daily-reply-dust/2026-10-13/grouped-daily.rdust"', 'dailyReplyDustFileKey("2026-10-1") throws INVALID_SESSION_DATE'],
  "The daily grouped file key is only used round-trip through a store (get/head of the same key); its literal layout and the INVALID_SESSION_DATE guard are untested; this pins them."),
 ("X9","v1","tenmin-history","addCalendarYears","src/tenmin-history.ts","calendar years","characterization test for forward and zero calendar year shifts",
  ['addCalendarYears("2024-02-29", 4) is "2028-02-29"', 'addCalendarYears("2023-03-31", 1) is "2024-03-31"', 'addCalendarYears("2025-02-28", -1) is "2024-02-28"',
   'addCalendarYears("2026-10-13", 0) is "2026-10-13"', 'addCalendarYears("2026-1-05", 1) throws INVALID_SESSION_DATE'],
  "Year shifts are tested backwards (-2) and Feb 29 to a non-leap year only; Feb 29 to a leap year, a forward shift, a zero shift, Feb 28 back into a leap year and the INVALID_SESSION_DATE guard are untested; this pins them."),
 ("X10","v2","oct2024-tenmin-oneoff","parseChainIndex","src/oct2024-tenmin-oneoff.ts","chain index input","characterization test for chain index defaults and digit limits",
  ['parseChainIndex(undefined) is 1', 'parseChainIndex(" 7 ") is 7', 'parseChainIndex("999") is 999', 'parseChainIndex("01") is 1',
   'parseChainIndex("1000") throws ONEOFF_CHAIN_INDEX_INVALID', 'parseChainIndex("-1") throws ONEOFF_CHAIN_INDEX_INVALID'],
  "The chain index is tested with \"\", \"4\", \"0\" and \"1x\" only; undefined, a padded value, the 3-digit limit (999 ok, 1000 throws), a leading zero and a negative are untested; this pins them."),
 ("X11","v2","tenmin-history","estimateTenMinRangeRemaining","src/tenmin-history.ts","remaining clamps","characterization test for clamped counts and a zero-request budget hit",
  ['estimateTenMinRangeRemaining({ range: "2024-10", plannedFetches: 3, storedFetches: -1, gappedFetches: 0, groupedDailyRemaining: -2, budgetMs: 1000 }) is { range: "2024-10", plannedFetches: 3, storedFetches: 0, gappedFetches: 0, orphanFetches: 0, remainingFetches: 3, groupedDailyRemaining: 0, estimatedRemainingRequests: 3, estimatedRunsToSeal: 3 }',
   'estimateTenMinRangeRemaining({ range: "2024-11", plannedFetches: 10, storedFetches: 4, gappedFetches: 1, groupedDailyRemaining: 3, budgetMs: 60000, requestsPerMinute: 5, hitTimeBudget: true, actualRequestsThisRun: 0 }) is { range: "2024-11", plannedFetches: 10, storedFetches: 4, gappedFetches: 1, orphanFetches: 0, remainingFetches: 5, groupedDailyRemaining: 3, estimatedRemainingRequests: 8, estimatedRunsToSeal: 2 }'],
  "The seal estimate is tested with non-negative counts and a budget hit with 100 actual requests; negative stored / grouped-day counts (clamped to 0), a sub-minute budget (at least 1 request per run) and a budget hit with 0 actual requests (falls back to the budget rate) are untested; this pins them."),
 ("X12","v2","oct2024-tenmin-oneoff","readbackVerdict","src/oct2024-tenmin-oneoff.ts","short read-back","characterization test for a read-back short of the listed count",
  ['readbackVerdict({ listed: 5, verifiedOk: 4, failed: 0, sealed: true }) is "FAIL"', 'readbackVerdict({ listed: 5, verifiedOk: 6, failed: 0, sealed: true }) is "FAIL"',
   'readbackVerdict({ listed: 1, verifiedOk: 1, failed: 0, sealed: true }) is "PASS"'],
  "The post-seal read-back verdict is tested with 7188 listed (pass, unsealed, one failure) and an empty listing; a read-back that verifies fewer or more objects than listed with no failures, and the 1-object pass, are untested; this pins that the counts must match exactly."),
 ("X13","v1","num-utils","bandOf","src/num-utils.ts","band edges","characterization test for values on and just past the band edges",
  ['bandOf(0, 0, 10) is "inside"', 'bandOf(10, 0, 10) is "inside"', 'bandOf(10.5, 0, 10) is "above"', 'bandOf(-0.5, 0, 10) is "below"'],
  "bandOf is tested with 5, -1 and 11 in a 0-10 band and the two throws; values exactly on the lower and upper edges (inclusive) and just past them are untested; this pins them."),
]
tasks = []
DROP = {"X6", "X7"}  # X6 src/host.ts is a denied path; X7 expected text is an HTML comment (stripped by issue-text cleaning)
for (i, rule, mod, fn, f, short, tl, bul, why) in T:
    if i in DROP: continue
    body = f"Target: PeaceG03/PeaceSTOCKS\n\nadd a characterization test for {fn} in {f}: {short}\n" + "".join(f"- {b}\n" for b in bul) + "\n" + NOTE.format(rule=rule, why=why, dry="{DRY}")
    assert "\\u" not in body and not re.search(r"[\x00-\x08\x0b-\x1f\x7f]", body)
    tasks.append({"id": i, "rule": rule, "category": "test-existing", "skill": "TEST_CASE_EXISTING", "expect": "solve", "title": f"[{mod}] {fn}: {tl}", "body": body, "accept": {"mutate": {"file": f, "fn": fn}}})
json.dump({"schema": "peaceai-stress-suite:v1", "target": "PeaceG03/PeaceSTOCKS", "base": "663e31e7d8f930cd9c7cc3c66b555a1c14817756", "tasks": tasks}, open("tasks.json", "w"), indent=1)
print(len(tasks))
