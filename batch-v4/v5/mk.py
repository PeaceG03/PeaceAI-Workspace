import json
B = "5c41528a4e608d8f53de996e583a97776d232d08"
NOTE = ("(Builder pre-file, TEST_CASE_EXISTING, public-test-case-existing-v2): Peace's task (source: peace). {why} "
 "Production safety: test-only: one new src/*.test.ts file only: no source edits, no fix commit. Job B grades it fix-free: the test passes on the current code and fails with the function body stubbed. "
 "The running scanner chain is unchanged. {dry} Disjoint file: each task in this batch creates its own new test file. Expected COUNTS.)")
T = [
 ("tenmin-backfill","tenMinPairManifestKey","src/tenmin-backfill.ts","pair manifest keys","characterization test for the two-month pair manifest key",
  ['tenMinPairManifestKey("2024-10-15") is "permanent/tenmin-reply-dust/2024-09-01_2024-10-31/manifest.json"',
   'tenMinPairManifestKey("2024-01-01") is "permanent/tenmin-reply-dust/2024-01-01_2024-02-29/manifest.json"',
   'tenMinPairManifestKey("bad") throws INVALID_SESSION_DATE'],
  "The R2 manifest key for a two-month ten-minute pair (built through tenmin-history's pairRangeForDate) and its INVALID_SESSION_DATE guard have no test anywhere; this pins its current behaviour."),
 ("scan-yield","isIdleScannerRun","src/scan-yield.ts","idle scanner runs","characterization test for the idle scanner-run check",
  ['isIdleScannerRun({ display_title: "Scanner restarter" }) is true',
   'isIdleScannerRun({ display_title: "Scanner tenmin daily (off)" }) is true',
   'isIdleScannerRun({ display_title: "Scanner" }) is false',
   'isIdleScannerRun({ display_title: null }) is false'],
  "The check that decides which scanner.yml runs never call Massive or write R2 (restarter, or daily tick switched off) has no direct test; this pins its current behaviour."),
 ("tenmin-history","countGappedPlannedFetches","src/tenmin-history.ts","gapped planned fetches","characterization test for counting gapped planned fetches",
  ['countGappedPlannedFetches([{ securityId: "S1", symbol: "AAPL", fetchFrom: "2024-01-02", fetchTo: "2024-01-05" }], [{ securityId: "S1", symbol: "AAPL", reason: "EMPTY", at: "2024-01-06T00:00:00.000Z", fetchFrom: "2024-01-02", fetchTo: "2024-01-05" }]) is 1',
   'countGappedPlannedFetches([{ securityId: "S1", symbol: "AAPL", fetchFrom: "2024-01-02", fetchTo: "2024-01-05" }], [{ securityId: "S1", symbol: "MSFT", reason: "EMPTY", at: "2024-01-06T00:00:00.000Z", fetchFrom: "2024-01-02", fetchTo: "2024-01-05" }]) is 0',
   'countGappedPlannedFetches([{ securityId: "S1", symbol: "AAPL", fetchFrom: "2024-01-02", fetchTo: "2024-01-05" }], [{ securityId: "S1", symbol: "AAPL", reason: "EMPTY", at: "2024-01-06T00:00:00.000Z" }]) is 0'],
  "The gapped-fetch count behind the ten-minute range remaining estimate is never called directly by a test; this pins that a gap counts only when it matches a planned fetch and carries its fetch window."),
 ("tenmin-history","countOrphanFetches","src/tenmin-history.ts","orphan fetches","characterization test for counting orphan fetches",
  ['countOrphanFetches([{ securityId: "S1", symbol: "AAPL", fetchFrom: "2024-01-02", fetchTo: "2024-01-05" }], [], [{ securityId: "S1", symbol: "MSFT", reason: "EMPTY", at: "2024-01-06T00:00:00.000Z", fetchFrom: "2024-01-02", fetchTo: "2024-01-05" }]) is 1',
   'countOrphanFetches([{ securityId: "S1", symbol: "AAPL", fetchFrom: "2024-01-02", fetchTo: "2024-01-05" }], [], [{ securityId: "S1", symbol: "AAPL", reason: "EMPTY", at: "2024-01-06T00:00:00.000Z", fetchFrom: "2024-01-02", fetchTo: "2024-01-05" }]) is 0',
   'countOrphanFetches([], [], []) is 0'],
  "The orphan-fetch count (stored or gapped fetches that are no longer planned) is never called directly by a test; this pins its current behaviour."),
 ("tenmin-redispatch","shouldDispatchHeal","src/tenmin-redispatch.ts","heal dispatch","characterization test for the heal-dispatch decision",
  ['shouldDispatchHeal({ dispatch: false, nextAction: "wait", reason: "WAIT_GUARD_WINDOW", nextChain: 1 }) is true',
   'shouldDispatchHeal({ dispatch: false, nextAction: "wait", reason: "WAIT_NEAR_GUARD_WINDOW", nextChain: 1 }) is true',
   'shouldDispatchHeal({ dispatch: true, nextAction: "continue", reason: "WAIT_GUARD_WINDOW", nextChain: 1 }) is false',
   'shouldDispatchHeal({ dispatch: false, nextAction: "wait", reason: "OTHER", nextChain: 1 }) is false'],
  "The rule that only a guard-window wait triggers a heal dispatch has no direct test; this pins its current behaviour."),
 ("tenmin-redispatch","planCancelDispatchedRun","src/tenmin-redispatch.ts","cancel plan","characterization test for the dispatched-run cancel plan",
  ['planCancelDispatchedRun(undefined) is { action: "none", detail: "dispatched-run-not-found" }',
   'planCancelDispatchedRun({ id: 7, event: "workflow_dispatch", status: "in_progress", conclusion: null, created_at: "2024-01-01T00:00:00Z" }) is { action: "cancel", runId: 7 }',
   'planCancelDispatchedRun({ id: 8, event: "workflow_dispatch", status: "completed", conclusion: "success", created_at: "2024-01-01T00:00:00Z" }) is { action: "none", detail: "status=completed:conclusion=success" }'],
  "The plan for cancelling a dispatched tenmin_history run on SCAN_CANCELLED has no direct test; this pins which statuses cancel and the detail text otherwise."),
 ("tenmin-mode","planUpgraded","src/tenmin-mode.ts","plan upgrades","characterization test for plan-upgrade detection",
  ['planUpgraded({ windowStart: "2024-01-01", ratePerMin: 5 }, undefined) is false',
   'planUpgraded({ windowStart: "2023-01-01", ratePerMin: 5 }, { windowStart: "2024-01-01", ratePerMin: 5 }) is true',
   'planUpgraded({ windowStart: "2024-01-01", ratePerMin: 10 }, { windowStart: "2024-01-01", ratePerMin: 5 }) is true',
   'planUpgraded({ windowStart: "2025-01-01", ratePerMin: 5 }, { windowStart: "2024-01-01", ratePerMin: 10 }) is false'],
  "Plan-upgrade detection (an older window or a higher rate than the previous plan) has no direct test; this pins its current behaviour."),
 ("tenmin-range-reply-dust","parseFetchIdentityKey","src/tenmin-range-reply-dust.ts","malformed keys","characterization test for rejecting malformed fetch identity keys",
  ['parseFetchIdentityKey("a|b") is undefined',
   'parseFetchIdentityKey("") is undefined'],
  "parseFetchIdentityKey has no test anywhere; this pins that malformed fetch identity keys parse to undefined."),
]
tasks=[]
for i,(mod,fn,f,short,tl,bul,why) in enumerate(T,1):
    body = f"Target: PeaceG03/PeaceSTOCKS\n\nadd a characterization test for {fn} in {f}: {short}\n" + "".join(f"- {b}\n" for b in bul) + "\n" + NOTE.format(why=why, dry="{DRY}")
    tasks.append({"id":f"V{i}","category":"test-existing","skill":"TEST_CASE_EXISTING","expect":"solve","title":f"[{mod}] {fn}: {tl}","body":body,"accept":{"mutate":{"file":f,"fn":fn}}})
json.dump({"schema":"peaceai-stress-suite:v1","target":"PeaceG03/PeaceSTOCKS","base":B,"tasks":tasks},open("tasks.json","w"),indent=1)
print(len(tasks))
