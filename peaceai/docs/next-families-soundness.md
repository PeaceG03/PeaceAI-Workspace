# Next families

These shapes read only the recorded calls. They do not copy a fix. A shape is kept only when every reduced call agrees with that one form. Two forms are `CANT_DO_YET_NO_BODY`. A call whose argument is not a literal, a sentinel, or a collection of those is not an example. A throw is still part of the spec when the assertion is `toThrow` or `toThrowError`. `toThrowErrorMatchingInlineSnapshot` is not that assertion, so a chunk size of zero does not refuse the body. The body still throws that error. A plan is built only from a missing-module, missing-export, or not-a-function error. A passing log does not build one.

## Inverse lerp

`a === b ? 0 : (c - a) / (b - a)`. Equal ends return `0`. The bare division is `NaN`. `0 === -0` is true, so both ends at zero return `0`. `NaN === NaN` is false, so a `NaN` end takes the division. This is not `lerp`. `lerp` agrees when `start` is `0` and `stop` is `1`, and when both ends are `0`. Some example has to disagree with `lerp`, and some example has to have equal ends.

`ilerp-guard:numbers` refuses a string. `ilerp-guard:line` refuses a different number. `ilerp-guard:flat` refuses a case with no equal ends. `ilerp-guard:apart` refuses a case `lerp` also fits.

## Hex color

Strip one leading `#`. Anything that is not 3 or 6 hex digits is `[0, 0, 0]`. Three digits are doubled, then `parseInt` and the three shifts. An empty string is black. A 4-digit string is black. Upper case is a hex digit. Some example has to be invalid, and some example has to be three digits, or a 6-digit-only parse also fits.

`phex-guard:rgb` refuses a different triple. `phex-guard:blank` refuses a case with no invalid string. `phex-guard:short` refuses a case with no three-digit color.

## zipObject

`for (let i = 0; i < a.length; i++) o[a[i]] = b[i]`. A hole is `a[i]`, which is `undefined`, the same read as the published loop. A `Set` has no `length`, so the loop does not run and the object stays empty. `Array.from` would walk the set's values instead. On `null` both throw a `TypeError` from reading `.length`. `b[i]` reads a hole in the values as `undefined`. A missing value is stored as `undefined`. Extra values are ignored. Assignment of a `__proto__` key sets the prototype. `Object.fromEntries` would keep that key as its own property. A symbol key is assigned. Some value has to be missing.

`zobj-guard:arrays` refuses a string. `zobj-guard:built` refuses a different object. `zobj-guard:missing` refuses a case where every value is present.

## Mean

Add `a[i]` while `i < a.length`, then divide by `a.length`. On `null` both throw a `TypeError` from reading `.length`. The empty list is `0 / 0`, which is `NaN`. A hole is read as `undefined`, and adding that is `NaN`. A `Set` has no length, so the sum stays `0` and the quotient is `NaN`; giving that set a `length` still reads `set[i]`, not the iterated values. A `reduce` that skips holes divides the dense sum by the full length. An empty string is `NaN`. The digit string `'5'` is `5`, because the published sum concatenates and the division coerces. Some example has to be empty.

`mean-guard:arrays` refuses a string. `mean-guard:avg` refuses a different number. `mean-guard:empty` refuses a case with no empty list.

## Red background

Open `\x1b[41m`, close `\x1b[49m`. A shared close is rewritten to close-then-open first. A newline, including `\r\n` as one unit, is then wrapped with close and open. The second step has to run after the first. `open + text + close` leaves the next line unstyled. Some example has to contain a newline. A color with one published call is also the literal, so it is not emitted.

`bg-guard:wrap` refuses a different string. `bg-guard:break` refuses a case with no newline.

## Chunk

A size that is not a positive integer throws `Size must be an integer greater than zero.` `-0` is an integer and is not positive, so it throws. `NaN` and `Infinity` throw. The pieces are `slice`, so a hole stays a hole. The last piece is shorter when the length is not a multiple. An empty list is `[]`. A string is sliced the same way. Some size has to be smaller than the length, and some last piece has to be shorter than the size.

`chunk-guard:pair` refuses a string. `chunk-guard:parts` refuses a different list of pieces. `chunk-guard:cut` refuses a case where every size covers the whole list. `chunk-guard:rest` refuses a case where every last piece is full.

## Admitted

`toss/es-toolkit` at `24e7a7b8cb8035fae1ea2e7b507aab96698a38b9` (MIT). The bytes are pinned in `peaceai/test/m248-next-families.test.ts`. `mean` imports `sum`. `bgRed` imports `wrapAnsiBg`. The `inverseLerp` test imports `lerp`, which is already pinned. `chunk`'s test imports the property runner. The harness replaces that runner the same way it replaces the test runner, and it runs the property on a fixed list of arrays and sizes. The published file is not edited.

- `inverseLerp` returns `0` when the ends are equal and the fraction otherwise.
- `parseHex` returns black for a bad string and the expanded color otherwise.
- `zipObject` assigns each key, including a missing value.
- `mean` divides the index sum by the length.
- `bgRed` wraps a red background, including a newline.
- `chunk` slices positive integer sizes and throws otherwise.

Each published test fails when the function throws and passes on the scaffold. The scaffold was compared with the published function inside the practice sandbox on `NaN`, `undefined`, `-0`, empty values, holes, out-of-range numbers, a `__proto__` key, and a symbol key. A near-miss that agrees on the recorded calls and disagrees with the published function is `verified_test_only`.

## Dropped

`median` stays out. A sort and a length branch can be one expression, and that expression matches the published function, including a hole kept by `slice`. Every published call is also the mean. Both bodies would fit, and neither spec would admit.

`union` stays out. The published spec has one call, so the literal also fits.

`without` stays out. The published calls pass the excluded values as rest arguments. The arities differ.

`isSubset` stays out. The published calls bind the arrays to consts and use `toBeTruthy` and `toBeFalsy`. Those calls are not literal examples.

`flatten` stays out. The published calls use one argument and two. Mixed arity is `CANT_DO_YET_SIGNATURE`.

`flattenDeep` stays out. The published expects name a const, so the call is not the assertion subject. `flat` also removes a hole, and the published loop keeps it as `undefined`.

`unzip` stays out. The published expects assign `const result` and then assert `result`. That call is not the assertion subject.

`zip` stays out. The published calls use more than one arity.

`windowed` stays out. The published calls use more than one arity.

`uniq` stays out. The published test builds a sparse array. The sandbox rejects a hole, so the unmodified spec does not admit.

`compact` stays out. The published test passes `0n`. A bigint is not a recorded argument.

`sum` stays out. The published expects assign `const result = sum(...)` and then assert `result`. That call is not the assertion subject.

`escape` stays out. The recorded calls are the same string, so `return a` also fits. The call that changes a character is a `let`.

`escapeRegExp` stays out. One published call is the same string. The other concatenates consts.

`identity` stays out. The recorded calls are `return a`. That also fits a one-character palindrome.

`eq`, `gt`, `gte`, `lt`, and `lte` stay out. On the published number calls they are the comparison that is already emitted. A string example's near-miss is that comparison, and the comparison family has no reciprocal guard.

One-call color wrappers stay out. `red`, `bold`, `green`, and the others each have one published call, so the literal also fits. `hex` and `rgb` return a function. The expect calls that function, so the color call is not the assertion subject.

`range`, `clamp`, `inRange`, `round`, `trim`, `pad`, `dedent`, and `percentile` stay out. The published calls use more than one arity, or a recorded throw refuses the body.

`deburr` stays out. The published function is a character map and a normalize pass. That is not one expression.

`isPrimitive` stays out. The published values include a symbol, a bigint, a `Date`, a `Map`, and a `Set`. The sandbox does not carry those.

A bare integer comparison still keeps the first form in its class. The attempt cap stays 20. `target.ts` was not edited. `capability-job.ts` was not edited.
