# Slice and case families: drop, drop-right, take-right, capitalize, upper-first, lower-first, strict undefined

These shapes read only the recorded calls. They do not copy a fix. A shape is kept only when every reduced call agrees with that one form. Two forms are `CANT_DO_YET_NO_BODY`. A call whose argument is not a literal, a sentinel, or a collection of those is not an example. A throw is still part of the spec, and the body is refused. A plan is built only from a missing-module, missing-export, or not-a-function error. A passing log does not build one.

## Drop

`a.slice(Math.max(b, 0))` is emitted when every first argument is an array, every second argument is a finite number, and the expected value is that clamped prefix-drop. A negative count keeps the whole array. `a.slice(b)` does the same thing when every count is already non-negative, so a negative count has to be present. A count past the end is `[]`. Two different results are required. One repeated result stays the literal.

`drop-guard:arrays` refuses a string. `drop-guard:rest` refuses a different slice. `drop-guard:negative` refuses a case with no negative count. `drop-guard:varies` refuses one repeated result.

`NaN` is not a finite count, so it is not an example. The published test does not pass `NaN`.

## Drop right

`b > 0 ? a.slice(0, -b) : a.slice()` is emitted when the first argument is an array, the second is a finite number, and the expected value is that suffix-drop. A count of `0` or less copies the array. `a.slice(0, -b)` at `0` is `[]`, so a non-positive count has to be present. A fractional count is truncated by `slice`, which is what `1.5` shows.

`dright-guard:arrays` refuses a string. `dright-guard:rest` refuses a different slice. `dright-guard:nonpos` refuses a case with no non-positive count. `dright-guard:varies` refuses one repeated result.

## Take right

`b > 0 ? a.slice(-b) : []` is emitted when the first argument is an array, the second is a finite number, and the expected value is that suffix, or `[]` when the count is not positive. `a.slice(-b)` at `0` is the whole array, and at a negative count it reads from the front, so a non-positive count has to be present. A count past the length is the whole array.

`tright-guard:arrays` refuses a string. `tright-guard:rest` refuses a different slice. `tright-guard:nonpos` refuses a case with no non-positive count. `tright-guard:varies` refuses one repeated result.

`NaN` is not in the published test. `NaN > 0` is false, and the published function's `count <= 0` is also false for `NaN`, so this expression does not claim that case.

## Capitalize, upper first, lower first

Capitalize is `a.charAt(0).toUpperCase() + a.slice(1).toLowerCase()`. Upper first is `a.charAt(0).toUpperCase() + a.slice(1)`. Lower first is `a.charAt(0).toLowerCase() + a.slice(1)`.

Capitalize is emitted only when some later character changes case. Without that, upper first agrees on every example. Upper first is emitted only when some later character stays upper. Without that, capitalize agrees. Lower first is emitted only when some later character stays upper, so `toLowerCase()` of the whole string is a different function. Two different results are required. One repeated result stays the literal. A case the two expressions both fit is refused.

`cap-guard:cased`, `upper-guard:cased`, and `lower-guard:cased` refuse a different string. `cap-guard:lowered` refuses a tail that is already lower. `upper-guard:kept` and `lower-guard:kept` refuse a tail that does not stay upper. `cap-guard:varies`, `upper-guard:varies`, and `lower-guard:varies` refuse one repeated result.

## Strict undefined

`a === undefined` is emitted when `undefined` is true, `null` is present and false, and every other example is false. Missing `null` is also `a == null`. Both nullish values true is nil. Both nullish values false is not-nil. `null` true is strict null.

`undef-guard:undef-true` requires `undefined` true. `undef-guard:null-false` requires `null` present and false. `undef-guard:others-false` requires every other example false.

## Admitted

`toss/es-toolkit` at `24e7a7b8cb8035fae1ea2e7b507aab96698a38b9` (MIT). The bytes are pinned in `peaceai/test/m245-slice-case.test.ts`.

- `drop` is `arr.slice(Math.max(itemsCount, 0))`. The scaffold emits `a.slice(Math.max(b, 0))`.
- `dropRight` copies the array when the count is not positive and otherwise drops that many from the end. The scaffold emits `b > 0 ? a.slice(0, -b) : a.slice()`.
- `takeRight` is empty when the count is not positive and otherwise `arr.slice(-count)`. The scaffold emits `b > 0 ? a.slice(-b) : []`.
- `capitalize` lowercases the tail. The scaffold emits `a.charAt(0).toUpperCase() + a.slice(1).toLowerCase()`.
- `upperFirst` leaves the tail. The scaffold emits `a.charAt(0).toUpperCase() + a.slice(1)`.
- `lowerFirst` leaves the tail. The scaffold emits `a.charAt(0).toLowerCase() + a.slice(1)`.
- `isUndefined` is `x === undefined`. The scaffold emits `a === undefined`. The published filter test passes on that body.

Each published test fails when the function throws and passes on the scaffold. A near-miss that agrees on the recorded calls and disagrees with the published function is `verified_test_only`.

## Dropped

`compact` stays out. The published array removes every falsy value, and its test passes `0n`. A bigint is not a recorded argument, and the sandbox carries no bigint. A nullish-only filter is a different function.

`uniq` stays out. The published test builds a sparse array and stores `undefined`. The sandbox rejects a hole and an undefined element. `indexOf` also keeps every `NaN`, and `Set` keeps one.

`flatten` stays out. The published calls use one argument and two. Mixed arity is `CANT_DO_YET_SIGNATURE`. One level and a deeper flatten are not one expression those calls share.

`sum` stays out. The published expects assign `const result = sum(...)` and then assert `result`. That call is not the assertion subject, so no example is recorded. A callback sum and a bigint sum are not this shape. `mean` imports `./sum.ts`, so the published module is not one file.

`clamp`, `inRange`, and `round` stay out. The published calls use more than one arity, and a recorded throw refuses the body.

`isEmpty` and `isEmptyObject` stay out. The published values include a class, a `Map`, a `Date`, or `Object.create(null)` together with arrays and strings. That is not one expression, and a `Date` is not plain data.

`isNumber` is the number tag the type-tag family already emits. Its published `new Number(42)` is not plain data. `isFunction` passes functions, which the sandbox does not carry. `isArray` is the array tag already emitted when the other tags are false. `isLength` maps over a const, so the call is not the assertion subject.

`pad` and `trim` take an optional argument, so the published calls have more than one arity. `escapeRegExp`'s published argument is a concatenation of consts. The sandbox does not see those names.

`radashi-org/radashi` at `0487352eadca0b45039acba073b7841982b3443f` (MIT) was read and not admitted. Its tests import `* as _ from 'radashi'`, which does not name a source file. `unique` and `sum` take a callback. `clamp` records a throw. `flat` has one call, so the literal also fits. `isEmpty` uses `toBeTruthy`, a class, a bigint, a `Map`, and a `Date`.

`remeda/remeda` at `3baf05ffdb3c366ccebd733cb4dab6f2991ad92b` (MIT) was read and not admitted. The published tests call `sum()` and `flat(1)` as well as the data-first forms, and they throw and pass bigints.

`blakeembrey/change-case` title case walks a word list. `swapCase` calls the function on a loop binding, which is not a literal. `vueuse/vueuse` shared utils and `unjs/scule` test many functions in one file.

A bare integer comparison still keeps the first form in its class. A number-array `some` / `every` is not emitted. The attempt cap stays 20. `target.ts` was not edited. `capability-job.ts` was not edited.
