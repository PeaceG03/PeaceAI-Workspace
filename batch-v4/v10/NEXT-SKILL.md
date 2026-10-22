# Next skill after v6 (census on PeaceSTOCKS 0ab37c8, Workspace main 1fbe917, v6 engine)

286 exported functions. The test-existing family takes 122 with v6: v1 34, v2 78, v3 92, v4 105, v5 112, v6 122.
Of the 164 still refused: 98 are test_target_signature and 66 are body refusals (24 date_local, 23 impure, 16 io,
3 async). The body refusals went up from 50 because v5/v6 cleared the signature of functions whose bodies then
fail. Those are correct refusals (clock, I/O, module state), so no signature widening unlocks them.

Method: `blockers.mts` is the v9 Part B script run against the v6 engine. For every function v6 still refuses with
test_target_signature, it lists every signature blocker and then re-runs the function with a numbers-only signature
to check whether the body alone passes. Output: blockers.txt and `/workspace/batch-v10/b/blockers.json`. Only 26
signature-refused functions have a body that passes, and that caps what any further signature work can add.

| rank | widening | est. safe unlock (sole blocker, body passes) | functions | notes |
|---:|---|---:|---|---|
| 1 | **Map / Set args and results** | **+4** (+1 more with typeof/unknown, +1 with a generic fn) | groupedDailySymbolIndex, dollarVolumeBySecurity, storedByFetchFrom, compatibleStoredFetches | Needs `new Map([[k, v], ...])` / `new Set([...])` in the check grammar (literal entries only), Map/Set-aware deepEqual in the generated test, and a Map/Set-aware stub. 18 functions mention Map/Set; 4 are blocked by nothing else. This is the biggest change of the options. |
| 2 | **void returns (assert functions)** | **+3** | requireMonth, assertObjectMetadata, assertCancelRunAccepted | Every task must include at least one `throws` check, because a void stub passes `is undefined`. Allow only `throws CODE` and `is undefined`. Small engine change, and it reuses the existing throws grading. |
| 3 | optional-member / cross-module `T["k"]` (v5 residual) | +1 to +3 | tenMinDatedIndexMadeProgress (sole); tenMinScanCheckFailure, tenMinRunOutcome (indexed + typeof) | v5 refuses `T["k"]` on optional members (`TenMinHistoryPlan["rangeEndCap"]` is `rangeEndCap?:`). DatedTickerDateReport["status"] needs a diagnosis first (probably import depth or a member past the bounds). |
| 4 | callbacks / method members | +2 / +2 | securitySymbols, assertPinnedZstdForWriting; intradaySessionSpec, rateLimitInfo | Function values in checks: unsafe for a plain-data rule. Not recommended. |
| 5 | bytes | +1 | sameBytes | Almost every bytes function also does I/O or zstd. |
| - | interface extends, untyped non-literal default, depth > 6, > 4 params, tuples | 0 to 1 each | tickerReferenceEntry, decideOneOffNext | Each is a single function or is also blocked by something else. |

## Recommendation
- **v7 = Map/Set** (+4, about 122 -> 126 of 286) is the largest safe single widening left. Ship **void/assert** (+3)
  in the same version or right after; it is small and independent.
- Together that is +7 (about 129 of 286). Everything after that adds at most one to three functions per skill.
- Beyond signature widenings, the coverage ceiling now comes from the 66 body refusals. Raising coverage further
  takes new task kinds (for example, more add-function / complex-function tasks on untested helpers) rather than
  wider test-existing targets.

Safety boundaries for Map/Set (follow the v4-v6 recipe: new spec public-test-case-existing-v7, not_needed chaining):
- Argument grammar: `new Map([["k", v], ...])` / `new Set([v, ...])`. Entries and members are plain-data literals
  under the v4 bounds (at most 32 entries), only the global `Map` / `Set` (no shadowing), and no `ReadonlyMap`
  mutation in the body (normal purity walk).
- Results: compare with `deepEqual` against the same literal form. node:assert/strict deepEqual already compares
  Map/Set contents. The stub returns an empty Map/Set (or undefined), so a check with at least one entry kills it.
- Map/Set inside nested plain types follows the v4 depth and member limits. WeakMap / WeakSet stay refused.

## Seen while drafting batch-v10 (not census gains, test-side limits)
- Check literals that set optional members: aggregateIntradayBars with a VALID_TRADED bar (`open?`, `high?`, `low?`, `close?`, `volume?` on
  CanonicalTenMinuteBar / AggregatedIntradayBar) is refused by v5 (`test_refused`); the same call with a HALTED bar (no optional members)
  is accepted. Bisected on the box (5 variants; not a length bound: a 620-character call without optional members passed). This is the
  value-side twin of row 3 and would widen what accepted functions can pin; it does not change the census count.
- Job B stub: reconstructFeatures (src/features.ts) builds one candidate that passes typecheck, suite and the new test, but the grader
  returns UNGRADABLE (not-test-only, before_fix=null): the stubbed copy could not be graded. No census change; a grader issue, not a skill.
