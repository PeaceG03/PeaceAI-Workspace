# Fix families: type tag, nil, head, reverse

These shapes read only the recorded calls. They do not copy a fix. A shape is kept only when every reduced call agrees with that one form. Two forms are `CANT_DO_YET_NO_BODY`. A plan is built only from a missing-module, missing-export, or not-a-function error. A passing log does not build one.

## Type tag

One tag is true and every other tag that appears is false. The tags are `boolean`, `number`, `string`, `array`, and `object`. An array is not an object. `null` and `undefined` are not tags. `typeof a === "object"` is not emitted: in JavaScript that test is also true for `null` and for arrays. A function, a symbol, or a bigint is not a tag, and the scaffold refuses. A tag whose examples disagree is refused. Two true tags are refused. No false tag is refused, so a constant `true` stays the literal.

`tag-guard:uniform` is the disagreement check. `tag-guard:one-tag` refuses a second true tag and then emits the first tag in the order above. `tag-guard:not-object` refuses the object tag. `tag-guard:others-false` refuses a tag with no false example.

## Nil

`a == null` is emitted when `null` and `undefined` are both present and true, and every other example is false. One of those two is refused: `a === null` and `a == null` disagree on `undefined`, and neither formula is emitted. A true non-nullish example is not this function. Every example true stays the literal `return true`.

`nil-guard:both` requires both nullish values. `nil-guard:nullish-true` requires both to be true. `nil-guard:others-false` requires a false example that is neither.

## Head

`a[0]` is emitted when every argument is an array, the expected value is the element at index 0, and an empty array's expected value is `undefined`. `toBeUndefined()` is that expected value. Two different results are required. One repeated first element stays the literal, because `return 1` and `return a[0]` disagree on an array that starts with something else.

`head-guard:arrays` refuses a string. `head-guard:index0` refuses a later element. `head-guard:varies` refuses one repeated result.

## Reverse

`Array.from(a).reverse().join("")` is the code-point reverse. It is emitted when every argument and every result is a string, the result is that reverse, and some argument is not a palindrome. A palindrome agrees with `return a`, which the string shape already emits, so reverse stays out and the identity wins. An array of strings is not a string argument.

`rev-guard:strings` refuses a non-string. `rev-guard:reversed` refuses a result that is not the reverse. `rev-guard:not-identity` refuses an all-palindrome example.

## Admitted

`toss/es-toolkit` at `24e7a7b8cb8035fae1ea2e7b507aab96698a38b9` (MIT). The bytes are pinned in `peaceai/test/m242-fix-families.test.ts`.

- `isBoolean` is `typeof x === "boolean"`. The published test fails when the function throws and passes on `typeof a === "boolean"`. `isString` is the same shape for `"string"`.
- `isNil` is `x == null`. The scaffold emits `a == null`.
- `head` is `arr[0]`. The scaffold emits `a[0]`, and `head([])` is `undefined`.
- `reverseString` is `Array.from(value).reverse().join("")`, including the published non-BMP character.

## Not in this batch

`isNumber` calls `new Number(42)`. That argument is not concrete, so the file stays unreduced. `isEmptyObject` calls another function and constructs objects the recorder does not evaluate. A number-array `some` / `every` still has no pinned permissive test of one comparison. One property on an existing default object still has no pin. The attempt cap stays 20. `target.ts` was not edited.

The replay wrappers in `peaceai/bin/capability-job.ts` wait 90s for generate and 120s for the gate spawn. Those stops were `GENERATE_TIMEOUT` and `GATE_TIMEOUT`. `generate.ts` and `gate.ts` were not edited.
