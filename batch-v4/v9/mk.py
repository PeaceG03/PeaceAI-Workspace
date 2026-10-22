import json, re, sys
NOTE = ("(Builder pre-file, TEST_CASE_EXISTING, public-test-case-existing-{rule}): Peace's task (source: peace). {why} "
 "Production safety: test-only: one new src/*.test.ts file only: no source edits, no fix commit. Job B grades it fix-free: the test passes on the current code and fails with the function body stubbed. "
 "The running scanner chain is unchanged. {dry} Disjoint file: each task in this batch creates its own new test file. Expected COUNTS.)")
DRY = ("A box dry-run on PeaceSTOCKS ef9778e (Workspace main 3670cd8, live 27-rule approved list, Node 22) built exactly one candidate (public-test-case-existing-{rule}); "
 "a local Job B run graded it COUNTS (the new test passes on the current code and fails with {fn} stubbed); suite {suite} with all {n} new tests of this batch, all 4 typechecks ok.")
META = {
 "Y1": ("tenmin-gate", "holding run states", "characterization test for waiting, null and mixed run lists",
        "holdActive is tested with in_progress, queued, one completed run and an empty list; a waiting run, a null status (fails closed: holds), several completed runs and a mixed list are untested; this pins them."),
 "Y2": ("tenmin-gate", "sealed marker edges", "characterization test for empty, non-dispatch and mixed run lists",
        "hasSealedMarker is tested by varying one field of a single sealed run (status, conclusion, branch, title); an empty list, a schedule event, a missing display title and a sealed run behind a failed one are untested; this pins them."),
 "Y3": ("tenmin-redispatch", "active run states", "characterization test for every active and inactive run state",
        "countOtherActiveScannerRuns is tested with queued / in_progress runs and restarter titles; the waiting, pending and requested states, completed / cancelled / unknown states, a self id not in the list and a null title are untested; this pins them."),
 "Y4": ("tenmin-redispatch", "failure streak edges", "characterization test for empty lists, cancelled runs and non-dispatch runs",
        "priorConsecutiveFailures is tested with a self id and restarter titles; an empty list, a cancelled run ending the streak, a schedule run being skipped and the count with no self id are untested; this pins them."),
 "Y5": ("oct2024-tenmin-oneoff", "guard window edges", "characterization test for guard window boundaries and precedence",
        "oneOffPauseReason is tested at 05:30Z and 02:00Z only; the window edges (05:14 open, 05:15 guarded, 06:15 open, 10:14 guarded), the guard window winning over a failed run check and a waiting run are untested; this pins them."),
 "Y6": ("tenmin-history", "custom anchors", "characterization test for custom anchors, year wrap and date guards",
        "pairRangeForDate is tested with the default anchor only (two dates); a custom firstRangeStart, the January to previous December wrap, an in-pair December and the INVALID_SESSION_DATE guards for both arguments are untested; this pins them."),
 "Y7": ("ticker-reference-dated", "first month option", "characterization test for the firstMonth option",
        "datedTickerMonthStarts is tested with the default first month only; an explicit firstMonth, a firstMonth after now (empty), a year boundary and the INVALID_FIRST_MONTH guard are untested; this pins them."),
 "Y8": ("intraday-reply-dust", "object metadata", "characterization test for the reply dust object metadata keys",
        "replyDustObjectMetadata has no direct test; its exact key set (rd-* fields, numbers as strings, no file sha or path) is what rebuilds manifests from the store; this pins it."),
 "Y9": ("scan-grouped-reply-dust", "disabled report", "characterization test for the disabled grouped reply dust report",
        "disabledScanGroupedReplyDustReport has no direct test; its shape (enabled false, the reason, zero extra requests, no copies or warnings) is untested; this pins it."),
 "Y10": ("tenmin-range-reply-dust", "link and origin", "characterization test for link and origin metadata",
        "tenMinRangeObjectMetadata is tested without link / origin; the TENMIN_RANGE_LINK_INVALID and TENMIN_RANGE_ORIGIN_INVALID guards and the rd-link / rd-origin keys are untested; this pins them."),
 "Y11": ("daily-reply-dust", "hashed file keys", "characterization test for hashed file key layout and guards",
        "dailyReplyDustHashedFileKey is only used round-trip through a store; its literal layout, the INVALID_REPLY_SHA256 guard (uppercase or short hex) and INVALID_SESSION_DATE are untested; this pins them."),
 "Y12": ("tenmin-redispatch", "lead edges", "characterization test for times just before the dispatch lead",
        "minutesUntilGuardWindowEnd is tested from 05:05Z / 09:05Z (inside the 10-minute lead) onward; times just before the lead (05:04Z, 05:04:30Z, 09:04Z) and a mid-lead time are untested; this pins them."),
 "Y13": ("prediction-status", "frozen tie-breaks", "characterization test for frozen record tie-breaks",
        "resolveSessionPredictionStatus is tested with attemptedAt ordering and legacy ids; an empty list and the FROZEN-only tie-breaks without attemptedAt (newest recordedAt, then id ascending) are untested; this pins them."),
 "Y14": ("daily-bars-pack-decode", "empty month", "characterization test for an empty month file",
        "monthFileFromLines is tested with three lines only; the empty month (no trailing newline, empty string) is untested; this pins it."),
}
REPLACE = {"minutesUntilGuardWindowEnd(new Date(\"2026-10-13T06:14:30Z\"))": "minutesUntilGuardWindowEnd(new Date(\"2026-10-13T05:10:00Z\"))"}
ident = re.compile(r"^[A-Za-z_$][\w$]*$")
def lit(v):
    if v == "__undef": return "undefined"
    if v is None: return "null"
    if v is True: return "true"
    if v is False: return "false"
    if isinstance(v, (int, float)): return repr(v) if isinstance(v, float) and not v.is_integer() else str(int(v)) if isinstance(v, (int,)) or v.is_integer() else repr(v)
    if isinstance(v, str): return json.dumps(v)
    if isinstance(v, list): return "[" + ", ".join(lit(x) for x in v) + "]"
    return "{ " + ", ".join(f"{k if ident.match(k) else json.dumps(k)}: {lit(x)}" for k, x in v.items()) + " }" if v else "{}"
vals = json.load(open("values.json")); blocks = json.load(open("blocks.json"))
cen = {(x["f"], x["fn"]): x for x in json.load(open("../census.json"))}
dry = json.load(open("dry.json")) if len(sys.argv) > 1 else None
tasks = []
for b in blocks:
    x = cen[(b["file"], b["fn"])]; rule = "v4" if x["v3"] else "v3" if x["v2"] else "v2" if x["v1"] else "v1"
    mod, short, tl, why = META[b["id"]]
    bul = []
    for v in vals:
        if v["id"] != b["id"]: continue
        call = v["call"]
        if call in REPLACE: continue
        bul.append(f"{call} throws {v['err']}" if not v["ok"] else f"{call} is {lit(v['v'])}")
    if b["id"] == "Y12": bul.append('minutesUntilGuardWindowEnd(new Date("2026-10-13T05:10:00Z")) is 65')
    assert len(bul) <= 8
    d = DRY.format(rule=rule, fn=b["fn"], suite=dry["suite"], n=dry["n"]) if dry else "{DRY}"
    body = f"Target: PeaceG03/PeaceSTOCKS\n\nadd a characterization test for {b['fn']} in {b['file']}: {short}\n" + "".join(f"- {s}\n" for s in bul) + "\n" + NOTE.format(rule=rule, why=why, dry=d)
    assert "\\u" not in body and not re.search(r"[\x00-\x08\x0b-\x1f\x7f]", body)
    tasks.append({"id": b["id"], "rule": rule, "category": "test-existing", "skill": "TEST_CASE_EXISTING", "expect": "solve", "title": f"[{mod}] {b['fn']}: {tl}", "body": body, "accept": {"mutate": {"file": b["file"], "fn": b["fn"]}}})
DROP = set(dry["drop"]) if dry else set()
tasks = [t for t in tasks if t["id"] not in DROP]
json.dump({"schema": "peaceai-stress-suite:v1", "target": "PeaceG03/PeaceSTOCKS", "base": "ef9778e611f4d4d62f37eeb52f7e0a739ac0cf36", "tasks": tasks}, open("tasks.json", "w"), indent=1)
print(len(tasks))
