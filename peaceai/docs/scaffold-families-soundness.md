# Scaffold families: integer predicates

These shapes read only the recorded calls. They do not copy a fix. A shape is kept only when every reduced call agrees with that one form. Two forms are `CANT_DO_YET_NO_BODY`.

## Integer conjunction

`Number.isInteger(a) && <comparison>` is emitted when every example that is not an integer is false and the integer examples have one class. A string, a boolean, `NaN`, `Infinity`, or a fraction is false under `Number.isInteger`. A non-integer the examples accept is not this shape. A gap such as `8` false and `12` true, with no `9`, is two classes and is refused. No non-integer example, no conjunction: the bare comparison already says the same thing on those integers. A numeric literal may contain `_` separators. `1_832_923` is the integer 1832923.

Inside that conjunction, `a > n` and `a >= n+1` are one class on safe integers, and so are `a < n` and `a <= n-1`. The emitted comparison is the closed form whose literal is an example (`a >= 9`, not `a > 8`). On the integers the conjunction matches that closed comparison. On anything that is not an integer it is false. `Number.isInteger(a) && a > 0` and `Number.isInteger(a) && a >= 1` are the same function: a non-integer never reaches the comparison, and the next integer after 0 is 1.

A bare comparison does not use that replacement. It keeps the first form in the integer class, which is the open bound when `>` is stored before `>=`.

`cmp-guard:closed-bound` is the replacement inside the conjunction. Deleting it leaves `Number.isInteger(a) && a > n`. `int-guard:needs-fraction` refuses the conjunction when every example is already an integer, so it does not compete with the bare comparison. `int-guard:others-false` refuses it when a non-integer example is true. `int-guard:one-class` refuses two integer classes.

## Admitted

`nkzw-tech/core` `isPositiveInteger` at `e2f272e057cd87c4a0fcc650dd508ea40d4a62dc` (MIT). The function is `Number.isInteger(number) && (number as number) > 0`. The published test is `src/__tests__/isPositiveInteger.test.ts`. The bytes of that file, the function, and `LICENSE` are pinned by sha256 in `peaceai/test/m241-scaffold-families.test.ts`. The published test fails when the function throws, and it passes on the published function and on the scaffold `Number.isInteger(a) && a >= 1`. The plan shape is `integer`. `comparisonBody` does not fit, because the published test includes the string `'1'`. `kevva/is-positive` is still `CANT_DO_YET_SIGNATURE` on its own test, and its `1` / `0` / `-1` assertions are still `CANT_DO_YET_NO_BODY`.

## Not in this batch

The bare comparison does not emit the closed bound. That emit had no admission of its own: the nkzw plan is shape `integer` only.

The number-array `some` / `every` family is not emitted. Permissive TypeScript tests did not pin one comparison.

Adding one property onto an existing default object is not in this batch. A missing module still builds its own default object, as before.

No second family was added. The remaining dev test-as-spec reasons are `VERIFIED_TEST_ONLY` 14, `CANT_DO_YET_CAP` 11, `AVA_EARLY_EXIT` 5, `ASSERTION_UNREDUCIBLE` 2, `NO_VERIFY` 2, and `NO_BODY` 1. The cap and the behavior grader are unchanged. A bounded look for one more scaffold shape that a real permissive test pins, with a fail before and a pass after, did not find one.
