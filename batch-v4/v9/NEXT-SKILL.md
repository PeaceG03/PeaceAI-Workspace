# Next skill after v4 (census on PeaceSTOCKS ef9778e, Workspace main 3670cd8, 27 live rules)

286 exported functions; the test-existing family (v1-v4) takes 105. Of the 181 refused: 131 test_target_signature,
20 test_target_impure, 18 test_target_date_local, 9 test_target_io, 3 test_target_async.

Method (blockers.mts, blockers.json): for every refused function, collect EVERY signature blocker under the v4 rules
(not only the first), then re-analyze the same function with its signature neutralized to numbers to see whether the
body alone passes. Of the 131 signature refusals only 43 have a body that passes; the other 88 would still be refused
as impure 42 / io 26 / date_local 17 / async 3, so no signature widening can unlock them. Body refusals (50) are
correct refusals (clock, I/O, module state); widening them would make tests flaky or unsafe.

"Safe unlock" = the blocker is the only one left and the body passes (an upper bound; Job A still needs real checks).

| rank | blocker | functions blocked (any) | sole blocker | sole + body passes = est. safe unlock | notes |
|---:|---|---:|---:|---:|---|
| 1 | `typeof CONST` literal types + `T["key"]` property lookups | 43 typeof, 9 lookup | 16 | **9** | every typeof reached by these 9 names an `export const X = "..." as const` schema marker (CORPORATE_ACTION_COVERAGE_SCHEMA, MARKET_SCHEMA_VERSION, INTRADAY_SCHEMA_VERSION, TENMIN_OUTCOME_SCHEMA, TENMIN_HISTORY_RUN_SCHEMA, TENMIN_NO_DAILY_BAR, TENMIN_SECURITY_LINK, TENMIN_SKIPPED_BEFORE_FIRST_RANGE); the lookups are `DatedTickerDateReport["status"]`, `TenMinHistoryPlan["rangeEndCap"]`, `CanonicalTenMinuteBar["state"]`. Unlocks corporateActionCoverageRecords, reconstructFeatures, planTenMinAlert, tenMinScanCheckStops, stopRecordForScanCancelled, aggregateIntradayBars, tenMinDatedIndexMadeProgress, tenMinScanCheckFailure, tenMinRunOutcome. 4 more also need depth > 6 or another widening |
| 2 | `unknown` / `any` params | 16 | 9 | 5 | canonicalJson, stableJson, errorCode, errorClass, tenMinMassiveRequestsOf. Args limited to plain literals (no `new Error`), so errorCode / errorClass checks are weaker |
| 3 | `NodeJS.ProcessEnv` | 6 | 5 | 2 now, 5 with a `= process.env` default rule | tenMinDailyEnabled, tenMinDailyRedispatchHold; scanGroupedReplyDustEnabled, tickerIndexDatedEnabled, tickerIndexDatedFullEnabled default to `process.env` (refused as io by the v4 default walk unless every check passes env explicitly) |
| 4 | Map / Set | 18 | 6 | 4 | groupedDailySymbolIndex, dollarVolumeBySecurity, storedByFetchFrom, compatibleStoredFetches. Needs `new Map([...])` / `new Set([...])` in the check grammar, Map-aware deepEqual and stub; larger change |
| 5 | `void` returns (assert functions) | 8 | 7 | 3 | requireMonth, assertObjectMetadata, assertCancelRunAccepted. Checks must include a `throws` (a void stub passes `is undefined`) |
| 6 | callbacks / method members | 6 / 27 | 2 / 15 | 2 / 2 | securitySymbols (returns a function), assertPinnedZstdForWriting, intradaySessionSpec (SessionCalendar default), rateLimitInfo. Needs function values: unsafe for a plain-data rule |
| 7 | bytes (Uint8Array / Buffer) | 32 | 7 | 1 | sameBytes; almost every bytes function also does I/O or zstd (body refused) |
| - | > 4 params, tuples, generics, intersections, classes | 6 / 3 / 2 / 1 / 1 | | 0 | each also blocked by something else |

## Recommendation: v5 = `typeof` of literal consts + `T["key"]` property lookups on plain types

Expected gain: about +9 eligible functions (105 -> ~114 of 286), the largest safe single widening. It also
removes the most common blocker overall (43 functions), so later widenings (unknown, depth) stack on it.

Safety boundaries (follow the v4 recipe: new spec version public-test-case-existing-v5, not_needed chaining, no
parallel framework):
- `typeof N` in a type position is plain data only when N resolves (same module or a followed relative sibling, the
  v2 import rules) to a top-level `const` (never `let`/`var`, never a function, class, import of a package or
  parameter) whose initializer is a string / number / boolean literal, `"..." as const`, or an `as const` array /
  object of such literals (bounded by the v4 depth / member limits). Then `typeof N` is that literal type.
- `T["k"]` (indexed access) only when T is a type v4 already accepts as a plain object (interface / alias / type literal, followed with the v2 import rules) and k is a string literal naming one of its property signatures; the result is that member's type, analyzed recursively. `(typeof X)[number]` over an `as const` array of literals may be added under the same rule (none needed on PeaceSTOCKS today). `keyof`, non-literal keys, `typeof fetch` / any function or value of non-literal type stay test_target_signature.
- A shadowed or re-assigned name, a `const` without a literal initializer, or `typeof` of an imported non-sibling
  name is refused. Job B re-checks under v5 like v4.
- Stub, args grammar and grading unchanged (literals of those types are already expressible).

Second pick (small, stackable into the same version or a v6): `unknown` parameters accepting only plain-data
literal arguments (+5), and `NodeJS.ProcessEnv` as `Record<string, string | undefined>` with a `= process.env`
default allowed only when every check passes the env argument (+5). Map/Set (+4) needs grammar and stub work and
should be its own step.
