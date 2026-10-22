# TEST_CASE_EXISTING v4 (`public-test-case-existing-v4`, M90)

Census of PeaceSTOCKS at ef9778e: of 286 exported functions, v1 takes 34, v2 78 and v3 92; 160 are refused
`test_target_signature` under v3. The first failing reason of those 160: optional or defaulted parameters 34, bytes
23, generic references (Record, Map, ReadonlyArray, Pick, ...) 22, types nested deeper than 3 levels 22, objects with
more than 16 members 16, typeof 9, unknown/any 9, void 6, more than 4 parameters 6, method members 3, other small
counts. Imported named types were not a gap: v2 already follows plain-data interfaces and aliases in relative sibling
modules. v4 widens the plain-data part of that list and nothing else. It is a NEW spec with its own hash; v1, v2 and
v3 keep their hashes and their signatures.

## Shape

Same trigger, check grammar, output (one new test file next to the module, importing only the named function) and
fix-free grading as v3. Only `params.target` differs: `exported-pure-function-v4`.

- Parameters: everything v3 accepts, plus an optional parameter (`p?: T`, T plain data) or a parameter with a
  default (`p: T = EXPR`), never both on one parameter. An untyped parameter is accepted only with a string, number
  or boolean literal default (`n = 4`, `name = "imp"`, `flag = false`, `n = -1`). Rest parameters, destructuring
  and more than 4 parameters stay refused.
- Defaults: the initializer runs at call time, so it gets the body's rules: `new Date()`, `Date.now()`, local-time
  getters and `Intl` stay `test_target_date_local`, setters and assignment stay `test_target_impure`, and the purity
  walk (module consts, called helpers) applies. This walk runs for every target version, so a default in a followed
  helper is now analyzed for v1-v3 too; that only adds refusals.
- Generic references (global names only; a module-local or imported name of the same spelling shadows them and
  is refused as a generic): `Array<T>` and `ReadonlyArray<T>` as `T[]`; `Readonly<T>` and `Partial<T>` over plain
  data (not an array node); `Record<K, V>` with K `string`, `number` or a union of up to 12 string / number literals
  and V plain data; `Pick<T, K>` and `Omit<T, K>` with T plain data and K a string literal or literal union.
- Bounds: plain-data types nested up to depth 6 (v1-v3: 3) with up to 32 members per object (v1-v3: 16).
- Still refused: Map/Set/WeakMap, Uint8Array/Buffer and other bytes, classes, functions and method members,
  unknown/any/never/void parameters, typeof, intersections, index signatures, every other generic and generic
  functions.
- Checks: the v3 `plain-data-v3` args mode unchanged (bounded object literals anywhere, fixed Date literals). A check
  may omit an optional or defaulted argument.
- `not_needed`: a target v1, v2 or v3 accepts is left to that spec, so two specs never both answer one task.

## Grading

Job B re-checks the target under the v4 analysis only for a candidate whose operation id names
`public-test-case-existing-v4`, with the v2 sibling reads and the v3 Date-literal allowance in the graded test; the
candidate is graded with the v2 object-aware stub (an object return stubs to `{}`). Every other candidate is
re-checked exactly as before.

## Census gain

PeaceSTOCKS ef9778e: v4 takes 105 (v3 92, +13, none lost). The 13: providerRecords, replyDustObjectMetadata,
oneOffPauseReason, resolveSessionPredictionStatus, disabledScanGroupedReplyDustReport, resolveSpyBenchmarkId,
hasSealedMarker, holdActive, pairRangeForDate, tenMinRangeObjectMetadata, countOtherActiveScannerRuns,
priorConsecutiveFailures, datedTickerMonthStarts. Many defaulted-parameter functions take `SessionCalendar`, an
interface with methods, and stay refused by design; bytes, Map and unknown stay refused.

## Evidence

`peaceai/rules/proposals/m90-test-case-existing-v4-evidence.json`: see the record for the count, method and picks.
