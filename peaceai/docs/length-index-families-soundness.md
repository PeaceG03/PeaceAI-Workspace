# Length-index families

Zip and mean now use the published index loop. `for (let i = 0; i < a.length; i++)` reads `a[i]`. A hole is `undefined`. A `Set` has no `length`, so the loop does not run: zip stays `{}`, and mean is `0 / undefined`, which is `NaN`. Assigning `length` on that set still reads `set[i]`, not the values the set iterates. `Array.from` walks those values instead, so `Set(['a','b'])` became `{ a: 1, b: 2 }` and a set of `[10, 20]` with `length` 1 became `30`.

On `null`, both sides throw a `TypeError` from reading `.length`.

## toLength

An integer clamped to `0..4294967295`. `null` and `undefined` are `0`. A negative number is `0`. `'12px'` is `0`, not `12`, because `Number('12px')` is `NaN`. `1.1` is `1`. `-0` becomes `0`. A value above `2^32 - 1` is that cap.

`tlen-guard:fit` refuses a different number. `tlen-guard:neg` refuses a case with no negative input. `tlen-guard:junk` refuses a case with no non-numeric string. `tlen-guard:cut` refuses a case with no fractional number.

## toKey

A string or a symbol is returned as itself. `-0` is `'-0'`. `String(-0)` is `'0'`, so that sign has to be recorded. Without it, `'aba'` is this function and also the identity string.

`tkey-guard:fit` refuses a different key. `tkey-guard:sign` refuses a case with no `-0`.

## zipObjectDeep

Array-like keys and values, then each key is a path. `'a.b[0].c'` builds nested objects and arrays. A missing value is stored as `undefined`. `null` keys produce `{}`. A string of digits is array-like, so `'12'` sets keys `'1'` and `'2'`. A flat zip would keep `'a.b'` as one key.

`zde-guard:built` refuses a different object. `zde-guard:nest` refuses a case with no `.` or `[` in a key. `zde-guard:miss` refuses a case where every value is present.

## identity

The argument comes back unchanged. A number, a string, and a boolean all have to be recorded, and `null` or `undefined` must not be. `clone` and `deepFreeze` return those nullish values unchanged, and `return a` would not freeze or copy. A string-only identity stays the string concatenation.

`idn-guard:fit` refuses a different result. `idn-guard:num`, `idn-guard:str`, and `idn-guard:bool` each refuse a case missing that kind. `idn-guard:value` refuses a case that passes `null`.

## unescape

`&amp;`, `&lt;`, `&gt;`, `&quot;`, and `&#39;` become the characters. Zeros before `39`, as in `&#039;`, are still an apostrophe. `&amp;lt;` becomes `&lt;` because `&amp;` is replaced first. Some argument has to contain `&amp;`. `&#39;` alone is this function, and that argument is not a piece of the result, so it is not the string concatenation.

`uesc-guard:fit` refuses a different string. `uesc-guard:amp` refuses a case with no `&amp;`.

## dedent

A blank first line and a blank last line are dropped, then the shared run of spaces or tabs is removed. `\r\n` becomes `\n`. A newline has to appear. One line of indent is this function too, and the indented argument is not a piece of the result. Called as a template tag, the opening and closing lines may hold only whitespace; otherwise the call throws `TypeError`. A function argument returns a tag that dedents the static parts first.

`dden-guard:fit` refuses a different string. `dden-guard:line` refuses a case with no newline.

## gt and lt

`a > b` and `a < b`. A string argument has to appear. On numbers alone, `>` and `<` are the comparison already emitted, and the two bodies are the same text. The published functions coerce through `toNumber` unless both arguments are strings. The recorded calls are numbers and strings, and `>` / `<` match those calls.

`gt-guard:fit` and `lt-guard:fit` refuse a different boolean. `gt-guard:text` and `lt-guard:text` refuse a case with no string.

## Admitted

`toss/es-toolkit` at `24e7a7b8cb8035fae1ea2e7b507aab96698a38b9` (MIT). The bytes are pinned in `peaceai/test/m250-pins.json`.

The eight families are `toLength`, `toKey`, `zipObjectDeep`, `identity`, `unescape`, `dedent`, `gt`, and `lt`. Each published test fails when the function throws and passes on the scaffold. The scaffold was compared with the published function inside the practice sandbox, including a `Set`, a set with `length`, and a generator. A near-miss that agrees on the recorded calls and disagrees with the published function is `verified_test_only`.

## Dropped

`median` stays out. Every published call is also the mean.

`uniq` stays out. The spec builds a hole, and that replay is rejected.

`compact` stays out. The spec passes a bigint.

`deburr` stays out. The spec imports a second function with the same name, so one missing-module error selects both.

`escape` and `escapeRegExp` stay out. The concrete calls are strings that do not change, so the literal and the string concatenation both fit.

`isNumber`, `isFinite`, `isIterable`, `isPrimitive`, `isJSON`, `isPlainObject`, and `getTag` stay out. A `new`, a symbol, or a regexp is a reduced argument the sandbox cannot replay.

`range`, `clamp`, `round`, `inRange`, `flatten`, `windowed`, `zip`, `fill`, `without`, `pad`, `trim`, `slice`, `nth`, `join`, and `repeat` stay out. The calls use more than one arity. `repeat('abc', MAX_SAFE_INTEGER + 1)` also names a constant the sandbox cannot see.

`gte` stays out. It is the same string comparison as `gt` and `lt`. `lte` stays the literal `true`: every direct `lte` call expects `true`, and the `lt` calls in that file are a different function.

`union` stays out. One published result means the literal also fits.

`toSnakeCaseKeys` and the other key-case copies stay out. The recorded calls are values that do not change, so every case converter would fit.

A bare integer comparison still keeps the first form in its class. The attempt cap stays 20. `target.ts` was not edited. `capability-job.ts` was not edited.
