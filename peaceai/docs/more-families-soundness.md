# More families

These shapes read only the recorded calls. They do not copy a fix. A shape is kept only when every reduced call agrees with that one form. Two forms are `CANT_DO_YET_NO_BODY`. A call whose argument is not a literal, a sentinel, or a collection of those is not an example. `toThrow` inside an arrow is not recorded when the method is `toThrowErrorMatchingInlineSnapshot`, and `toBeNaN` is not a reduced equal. The body still throws, or returns `NaN`, where the published function does. A plan is built only from a missing-module, missing-export, or not-a-function error. A passing log does not build one.

The leading `a.length,` in the zip and mean bodies was removed. It did not change the returned value. On `null`, both the published loop and `Array.from` throw a `TypeError`, and the messages differ.

## Combinations

Index combinations. `Array.from` visits a hole as `undefined`, and the published index loop reads that hole the same way. `r === 0` is `[[]]`. A larger `r` is `[]`. A negative or fractional `r` throws `r must be a non-negative integer.` Order is the first index, then the combinations of the tail.

`combo-guard:pair` refuses a string. `combo-guard:rows` refuses a different list. `combo-guard:zero` refuses a case with no zero length. `combo-guard:over` refuses a case where every length fits. `combo-guard:pick` refuses a case that never chooses a shorter middle.

## Percentile

Nearest rank. The list is copied with `slice` and sorted with `NaN` treated as `-Infinity`. Rank `0` is the first sorted value. Otherwise the index is `ceil(length * rank / 100) - 1`. An empty list is `NaN`. A rank outside `0..100`, or a rank that is not a number, throws the published message.

`pct-guard:rank` refuses a different number. `pct-guard:ends` refuses a case that never uses `0` or `100`. `pct-guard:nan` refuses a case with no `NaN`.

## Whole-string case

`null` and `undefined` are `""`. An array is joined by the same conversion, and a hole is the word `undefined`. A symbol uses `toString`. `-0` stays `"-0"` because `value + ""` would hide the sign. Upper and lower then change that whole string. They do not split words. `'aba'` does not change under lower case, so a palindrome stays the identity string.

`toupr-guard:case` and `tolow-guard:case` refuse a different string. `toupr-guard:rise` refuses an already-upper string. `tolow-guard:sink` refuses an already-lower string. `toupr-guard:mark` and `tolow-guard:mark` refuse a string of letters and single spaces. A hyphen, a digit, or a repeated space has to remain, so a one-word or single-space case change stays with the word-join families.

## Undefined-skipping sum

`undefined` elements are skipped. A hole is `undefined`, so it is skipped too. The first defined value starts the total, and later values use `+`, so `['1', '2']` is `'12'`. `null` and an empty list are `0`. An array of only `undefined` is `undefined`.

`csum-guard:lists` refuses a value that is not an array. `csum-guard:total` refuses a different total. `csum-guard:skip` refuses a case with no `undefined` element. `csum-guard:text` refuses a case with no string element.

## Admitted

`toss/es-toolkit` at `24e7a7b8cb8035fae1ea2e7b507aab96698a38b9` (MIT). The bytes are pinned in `peaceai/test/m249-pins.json`.

- `combinations` returns the index combinations.
- `percentile` returns the nearest rank.
- `toUpper` and `toLower` change the whole converted string.
- compat `sum` skips `undefined`.

Each published test fails when the function throws and passes on the scaffold. The scaffold was compared with the published function inside the practice sandbox on `NaN`, `undefined`, `-0`, empty values, holes, and out-of-range numbers. A near-miss that agrees on the recorded calls and disagrees with the published function is `verified_test_only`.

## Dropped

`median` stays out. Every published call is also the mean, so both bodies would fit.

`union`, one-call color wrappers, and `noop` stay out. One published result means the literal also fits.

`without`, `flatten`, `zip`, `windowed`, `range`, `clamp`, `inRange`, `round`, `trim`, `pad`, `repeat`'s third argument, and `toInteger` stay out. The calls use more than one arity. `repeat('abc', MAX_SAFE_INTEGER + 1)` is also not a value the sandbox can replay, because the name is not bound there.

`dedent` and `unescape` stay out. On `'aba'` and `'cc'` they are the identity string, and the guard that would refuse that case is not killed by one deletion.

`uniq` stays out. The published spec builds a hole, and the sandbox rejects that replay.

`compact` and the compat `head` stay out. The spec passes `args`, which is not a recorded value.

`eq`, `gt`, `gte`, `lt`, and `lte` stay out. On the number calls they are the comparison already emitted.

`sha256` stays out. The published expects call another function, so no literal example is recorded.

`deburr` stays out. The spec also imports a second function with the same name. A missing-module error for one of them selects both, and the second has no recorded example, so the plan has no body.

`isJSON`, `toUpper` of a symbol written as a direct call, and `serialize` stay out when a `Date`, a symbol, or another non-plain value is a reduced argument. The whole-string case here is admitted because those calls are written as `(toUpper as any)(...)`, which is not a call of the imported name.

A bare integer comparison still keeps the first form in its class. The attempt cap stays 20. `target.ts` was not edited. `capability-job.ts` was not edited.
