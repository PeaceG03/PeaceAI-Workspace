# TEST_CASE_EXISTING v5 (`public-test-case-existing-v5`, M91)

Census of PeaceSTOCKS at ef9778e under v4: of 286 exported functions, v4 takes 105; 131 are refused
`test_target_signature`. Re-checking each of those with the signature neutralized, only 43 would pass the body rules
(the rest are impure, io, local-date or async anyway). Of those 43, the largest single-blocker group is `typeof` of a
literal const plus `T["k"]` property lookups (9), then unknown/any (5), Map/Set (4), NodeJS.ProcessEnv (2), void
returns (3), callbacks (2), method members (2), bytes (1). v5 widens only the first group. It is a NEW spec with its
own hash; v1-v4 keep their hashes and their signatures.

## Shape

Same trigger, check grammar, output (one new test file next to the module, importing only the named function) and
fix-free grading as v4. Only `params.target` differs: `exported-pure-function-v5`.

- `typeof N`: accepted only when N names a top-level `const` binding of the module (or a named import from a
  relative sibling followed under the v2 import rules), never reassigned or mutated, that is not also a function,
  type or enum name, and whose initializer is a string, number (incl. `-n`) or boolean literal, optionally
  parenthesized or `as const`. A type annotation alone never qualifies (M92: `const N: number = Date.now()` is
  refused); an annotation next to a literal initializer must itself be plain data under v4. A `typeof` naming one of
  the function's own parameters is that parameter's type and is refused.
- `T["k"]`: accepted only when k is a single string literal and T is a type literal, or a non-generic interface
  without heritage clauses, or an alias of a type literal (local or a followed sibling), that v4 accepts as plain
  data, and k names one of its required property signatures; the property type must be plain data.
- Still refused: `typeof` of a `let`, a function, an object / array const, a global (`fetch`, `process`) or a
  parameter; `keyof`, union or non-literal indexes, numeric indexes, optional or missing properties, method members;
  and every v4 refusal (Map/Set, bytes, classes, functions, unknown/any, intersections, other generics).
- Checks: the v3 `plain-data-v3` args mode unchanged.
- `not_needed`: a target v1, v2, v3 or v4 accepts is left to that spec, so two specs never both answer one task.

## Grading

Job B re-checks the target under the v5 analysis only for a candidate whose operation id names
`public-test-case-existing-v5` (with v2, v3 and v4 set); the candidate is graded with the v2 object-aware stub.
Every other candidate is re-checked exactly as before.

## Census gain

PeaceSTOCKS ef9778e: v5 takes 112 (v4 105, +7, none lost). The 7: corporateActionCoverageRecords,
reconstructFeatures, aggregateIntradayBars, planTenMinAlert, isEmptyTenMinRangeManifest, tenMinScanCheckStops,
stopRecordForScanCancelled. tenMinDatedIndexMadeProgress, tenMinScanCheckFailure and tenMinRunOutcome stay refused
for other reasons in their report types (Pick over a wide report, nested unsupported members).

## Evidence

`peaceai/rules/proposals/m91-test-case-existing-v5-evidence.json`: see the record for the count, method and picks.
