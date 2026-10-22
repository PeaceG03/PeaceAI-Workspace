import json, re, sys
NOTE = ("(Builder pre-file, TEST_CASE_EXISTING, public-test-case-existing-{rule}): Peace's task (source: peace). {why} "
 "Production safety: test-only: one new src/*.test.ts file only: no source edits, no fix commit. Job B grades it fix-free: the test passes on the current code and fails with the function body stubbed. "
 "The running scanner chain is unchanged. {dry} Disjoint file: each task in this batch creates its own new test file. Expected COUNTS.)")
DRY = {"v5": "A box dry-run on PeaceSTOCKS 0ab37c8 (Workspace main 1fbe917, live 28-rule approved list, Node 22) built exactly one candidate (public-test-case-existing-v5); ",
       "v6": "File only after public-test-case-existing-v6 is approved (#464). A box dry-run on PeaceSTOCKS 0ab37c8 (Workspace main 1fbe917 with a local-only simulated v6 approval, Node 22) built exactly one candidate (public-test-case-existing-v6); "}
DRY2 = "a local Job B run graded it COUNTS (the new test passes on the current code and fails with {fn} stubbed); suite {suite} with all {n} new tests of this batch, all 4 typechecks ok."
META = {
 "Z1": ("daily-bars-pack-decode", "key order and nesting", "characterization test for sorted keys, nesting and scalars",
        "canonicalJson is only compared with stableJson on decoded bars; its own output for nested objects in arrays, sorted keys at every depth, empty object / array, null, a string and a negative fraction is untested; this pins it."),
 "Z2": ("identity", "key order and nesting", "characterization test for sorted keys, nested arrays and scalars",
        "stableJson is used to build expected rows but its own output is never asserted; sorted keys, array order kept, nested arrays, quoted keys with spaces or dashes and scalars are untested; this pins them."),
 "Z3": ("daily-bars-sidecar", "error codes", "characterization test for leading-code extraction and the UNKNOWN fallback",
        "errorCode has no direct test; the leading upper-case code, digits and underscores in the code, and the UNKNOWN fallback for lower-case, empty, numeric, digit-first and non-Error object values are untested; this pins them."),
 "Z4": ("oct2024-tenmin-oneoff", "error classes", "characterization test for plain values, separators and the 60-character cap",
        "errorClass is tested with two Error messages only; a plain string, a plain object with a message, a leading separator or empty message (ERROR), null and the 60-character cap are untested; this pins them."),
 "Z5": ("tenmin-range-reply-dust", "request counts", "characterization test for valid, invalid and missing request counts",
        "tenMinMassiveRequestsOf has no test; a positive count, and zero for 0, negative, fractional, string, null and non-object values are untested; this pins them."),
 "Z6": ("tenmin-daily-liquid", "enable flag", "characterization test for the TENMIN_DAILY_ENABLED flag",
        "tenMinDailyEnabled has no direct test; only exactly \"true\" enables, and \"TRUE\", \"1\", unset and an unrelated true flag do not; this pins it."),
 "Z7": ("tenmin-daily-liquid", "redispatch hold values", "characterization test for empty, upper-case and unrelated values",
        "tenMinDailyRedispatchHold is tested with unset, \"false\" and \"true\"; an empty value, \"TRUE\", and other env keys next to or without TENMIN_AUTO_REDISPATCH are untested; this pins them."),
 "Z8": ("scan-grouped-reply-dust", "flag whitespace", "characterization test for padded values and unrelated keys",
        "scanGroupedReplyDustEnabled is tested with single-key env objects; padded values (\" true\", \"true \"), an unrelated true flag, an empty env and \"true\" next to another key are untested; this pins them."),
 "Z9": ("ticker-reference-dated", "dated flag", "characterization test for case, false and the FULL flag alone",
        "tickerIndexDatedEnabled is tested with {}, \"1\" and \"true\"; \"TRUE\", \"false\", TICKER_INDEX_DATED_FULL alone (does not enable) and true with FULL false are untested; this pins them."),
 "Z10": ("ticker-reference-dated", "full flag", "characterization test for the FULL flag against the dated flag",
        "tickerIndexDatedFullEnabled is tested with {} and \"true\"; TICKER_INDEX_DATED alone (does not enable FULL), \"1\", \"True\" and both flags true are untested; this pins them."),
 "Z11": ("corporate-action-coverage", "session dedupe and counts", "characterization test for deduped sorted sessions, action counts and datasets",
        "corporateActionCoverageRecords is tested with one session and no actions; duplicate and unsorted sessions, per-session action counts (actions on other dates ignored), a datasets override and no sessions are untested; this pins them."),
 "Z12": ("tenmin-redispatch", "prior stop counts", "characterization test for prior counts and the reason prefix",
        "tenMinScanCheckStops is tested with prior 0 and 1; a larger prior, a negative or fractional prior (treated as 0) and a bare STOP_SCAN_CHECK_FAILED reason without the colon (0) are untested; this pins them."),
 "Z13": ("tenmin-redispatch", "no outcome record", "characterization test for a record without an outcome or run id",
        "stopRecordForScanCancelled is tested with records that have an outcome and a run id; a record with no outcome and an empty githubRunId (built outcome, runId unknown) and a string scan run id are untested; this pins them."),
 "Z14": ("tenmin-range-reply-dust", "empty manifests", "characterization test for empty and non-empty manifests",
        "isEmptyTenMinRangeManifest has no test; a zero securityCount, a non-zero count with no securities, and one listed security are untested; this pins them."),
 "Z15": ("intraday", "interval guards and halted bars", "characterization test for interval guards, an empty list and a halted bar",
        "aggregateIntradayBars is tested with 60-minute aggregation of full sessions; the INVALID_AGGREGATION_INTERVAL guard (25, 5), an empty list, and a single halted bar (HALTED group, bucket index) are untested; this pins them."),
 "Z16": ("features", "short history", "characterization test for short histories and recipe versions",
        "reconstructFeatures is tested inside the scanner with long histories; the all-null feature values for an empty or one-bar history and the recipeVersions map are untested; this pins them."),
 "Z17": ("tenmin-alert", "pause and step failures", "characterization test for paused job failures and failed or skipped steps",
        "planTenMinAlert is tested for planned waits, stops and the fallback step failure; a paused chain whose history step failed (STOP_JOB_FAILURE), a cancelled or empty redispatch step, a skipped fallback step key and a fallback planned wait are untested; this pins them."),
}
SKIP = {"errorClass({ code: 5 })", "aggregateIntradayBars([{ securityId: \"sec_a\", sessionDate: \"2026-10-13\", intervalIndex: 7, state: \"VALID_TRADED\", open: 10, high: 12, low: 9, close: 11, volume: 100, observedAt: \"t\", ingestedAt: \"t\", dataQuality: \"GOOD\", corporateActionIds: [], flags: [], schemaVersion: \"foundation-d.1-10m-v1\", revision: 1, provenance: { provider: \"p\", dataset: \"d\", retrievalId: \"r\", ingestionVersion: \"i\", normalizerVersion: \"n\" } }], 30)"}  # Z15 traded bar: v5 refuses optional-member literals (test_refused)
ident = re.compile(r"^[A-Za-z_$][\w$]*$")
def lit(v):
    if v == "__undef": return "undefined"
    if v is None: return "null"
    if v is True: return "true"
    if v is False: return "false"
    if isinstance(v, int): return str(v)
    if isinstance(v, float): return str(int(v)) if v.is_integer() else repr(v)
    if isinstance(v, str): return ("'" + v + "'") if ('"' in v and "'" not in v and "\\" not in v) else json.dumps(v)
    if isinstance(v, list): return "[" + ", ".join(lit(x) for x in v) + "]"
    return "{ " + ", ".join(f"{k if ident.match(k) else json.dumps(k)}: {lit(x)}" for k, x in v.items()) + " }" if v else "{}"
vals = json.load(open("values.json")); T = json.load(open("calls.json"))
dry = json.load(open("dry.json")) if len(sys.argv) > 1 else None
tasks = []
for t in T:
    mod, short, tl, why = META[t["id"]]
    bul = [f"{v['call']} throws {v['err']}" if not v["ok"] else f"{v['call']} is {lit(v['v'])}" for v in vals if v["id"] == t["id"] and v["call"] not in SKIP]
    assert len(bul) <= 8
    d = (DRY[t["rule"]] + DRY2.format(fn=t["fn"], suite=dry["suite"], n=dry["n"])) if dry else "{DRY}"
    body = f"Target: PeaceG03/PeaceSTOCKS\n\nadd a characterization test for {t['fn']} in {t['file']}: {short}\n" + "".join(f"- {s}\n" for s in bul) + "\n" + NOTE.format(rule=t["rule"], why=why, dry=d)
    assert "\\u" not in body and not re.search(r"[\x00-\x08\x0b-\x1f\x7f]", body)
    tasks.append({"id": t["id"], "rule": t["rule"], "category": "test-existing", "skill": "TEST_CASE_EXISTING", "expect": "solve", "title": f"[{mod}] {t['fn']}: {tl}", "body": body, "accept": {"mutate": {"file": t["file"], "fn": t["fn"]}}})
DROP = set(dry["drop"]) if dry else set()
tasks = [t for t in tasks if t["id"] not in DROP]
json.dump({"schema": "peaceai-stress-suite:v1", "target": "PeaceG03/PeaceSTOCKS", "base": "0ab37c85f9d28791cfb7eaedbe56906885b74fab", "tasks": tasks}, open("tasks.json", "w"), indent=1)
print(len(tasks))
