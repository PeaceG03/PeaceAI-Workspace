# TEST_CASE_EXISTING v3 (`public-test-case-existing-v3`, M88)

Census of PeaceSTOCKS at 8b1f413 (batch-v6 triage): after v2, 39 of the 180 signature refusals name `Date`, and
Peace's self-zone tasks S1/S2 (`utcDayKey`, `minutesOfUtcDay` in `peaceai/self-tests/helpers/dates.ts`) were refused
`test_target_signature` on v1 and v2 for a `Date` parameter. Stress-v1 gap 1 (objects nested inside array
arguments fall back to the 200-character limit) is bundled. v3 is a NEW spec with its own hash; v1 and v2 keep their
hashes and their signatures.

## Shape

Same trigger, check grammar, output (one new test file next to the module, importing only the named function) and
fix-free grading as v1/v2. Only `params.target` differs: `exported-pure-function-v3`.

- Signature: everything v2 accepts, plus the global `Date` anywhere a v2 type may appear (a parameter, the return,
  an object member, an array element, a union member). A module-local or imported `Date` (type, interface, enum,
  class, function, const or import of that name) shadows the global and is analyzed like any other name.
- Body: the v1/v2 purity rules unchanged. `Date.now()`, `new Date()` without arguments, local-time getters,
  `Intl` and `toLocale*` stay `test_target_date_local`; `set*` on a Date stays `test_target_impure`.
- Checks: `new Date("<ISO date or UTC/offset date-time>")` literals (M35 `isDateLiteral`: <= 32 chars, real
  calendar values) as call arguments, inside array/object arguments and as expected values (`is new Date(...)` is
  rendered as `deepEqual`, also inside expected arrays/objects); bounded plain-data object literals anywhere in a
  call, including nested in array arguments (`objectArgsReason`, the M20 600-character bound). Internally this is
  the `plain-data-v3` args mode, which no spec's params can select.
- `not_needed`: a target v1 or v2 accepts is left to that spec, so two specs never both answer one task.

## Gap 1 for v2

A v2 task whose object literals sit only inside array arguments (`f([{ a: 1 }])`) now gets the same bounded object
grammar through the internal `nested-object-literal` args mode (no Dates). The M20 `object-literal` mode and its
direct-argument trigger are unchanged, so the M20 specs never start answering new tasks.

## Grading

Job B re-checks the target under the v3 analysis (v2 plus the global `Date`) only for a candidate whose operation
id names `public-test-case-existing-v3`, with the v2 sibling reads; such a candidate is graded with the v2
object-aware stub, so a `Date` return stubs to `{}` and `deepEqual(<Date>, {})` fails by assertion. Every other
candidate is re-checked exactly as before.

## Evidence

`peaceai/rules/proposals/m88-test-case-existing-v3-evidence.json`: see the record for the count, method and drops.
