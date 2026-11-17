# Word, index, and lerp families

These shapes read only the recorded calls. They do not copy a fix. A shape is kept only when every reduced call agrees with that one form. Two forms are `CANT_DO_YET_NO_BODY`. A call whose argument is not a literal, a sentinel, or a collection of those is not an example. A throw is still part of the spec, and the body is refused. A plan is built only from a missing-module, missing-export, or not-a-function error. A passing log does not build one.

The word split is the published pattern `\p{Lu}?\p{Ll}+|[0-9]+|\p{Lu}+(?!\p{Ll})|\p{Emoji_Presentation}|\p{Extended_Pictographic}|\p{L}+` with the `u` and `g` flags. `String.prototype.match` resets `lastIndex`, so a shared pattern and a fresh literal agree.

## Words

`Array.from(a.match(CASE_SPLIT) ?? [])` is emitted when every argument is a string and the expected value is that split. An empty string is `[]`. A separator-only split, `a.split(/[^A-Za-z0-9]+/)`, agrees until a camel boundary, an acronym, a digit inside a word, or a letter outside ASCII. One of those has to be present.

`words-guard:strings` refuses an array of words. `words-guard:split` refuses a different list. `words-guard:camel` refuses a list the ASCII split already explains.

## Kebab and snake

Kebab is the words, lowercased, joined with `-`. Snake joins the same words with `_`. A one-word string makes those two joins equal, so each body requires an example the other join misses. Each also requires an example the ASCII split misses, so `HTTPRequest` is not treated as one word.

`kebab-guard:strings` and `snake-guard:strings` refuse an array of words. `kebab-guard:joined` and `snake-guard:joined` refuse a different string. `kebab-guard:hyphen` and `snake-guard:underscore` refuse a case the other join also fits. `kebab-guard:camel` and `snake-guard:camel` refuse a case the ASCII split already fits.

## Camel

The first word is lowercased and every later word is capitalized with `charAt(0)` and `slice(1).toLowerCase()`, which is the published `capitalize` of one word. The words are joined with nothing. An empty word list is `""`. A single word is only `toLowerCase()`, which kebab and snake also are, so some example has to contain two words. A separator split leaves `HTTPRequest` as one word, so some example has to show that boundary.

`camel-guard:strings` refuses an array of words. `camel-guard:joined` refuses a different string. `camel-guard:hump` refuses a one-word list. `camel-guard:boundary` refuses a case the separator split already fits.

## Difference and intersection

Difference is `a.filter((item) => !b.includes(item))`. Intersection is `a.filter((item) => b.includes(item))`. `includes` is SameValueZero, which is what `Set.has` does for `NaN`, `-0`, and object identity. A hole in the second array is `undefined` for both. `filter` skips a hole in the first array for both. Something has to be removed, because a second array that shares nothing with the first is `a` for difference, and a second array that contains the first is `a` for intersection.

`diff-guard:arrays` and `inter-guard:arrays` refuse a string. `diff-guard:rest` and `inter-guard:rest` refuse a different filter. `diff-guard:removed` and `inter-guard:drops` refuse a case where every element is kept.

## At

`b.map((i) => a[(n => n < 0 ? n + a.length : n)(Number.isInteger(i) ? i : Math.trunc(i) || 0)])` is the published index read. `Math.trunc(NaN) || 0` is `0`. `Infinity` stays out of range and reads `undefined`. A negative index counts from the end, including a fractional index after truncation. A negative index has to be present, because `b.map((i) => a[i])` agrees while every index is already non-negative.

`at-guard:arrays` refuses a string. `at-guard:picked` refuses a different selection. `at-guard:negative` refuses a case with no negative index.

## Lerp

`c === 1 ? b : a + (b - a) * c` is the published function. The multiply is a different function when `c === 1` and `a + (b - a) * 1` is not `b`. `NaN` and `undefined` are not `=== 1`, so they take the multiply, which is `NaN`. A fraction other than `1` has to be present. The recorded `toBeCloseTo` calls are not examples. The body is the published function, so those calls still pass.

`lerp-guard:numbers` refuses a string. `lerp-guard:line` refuses a different value. `lerp-guard:exact` refuses a case where the multiply already equals `stop` at `1`. `lerp-guard:span` refuses a case that is only `c === 1`.

## Admitted

`toss/es-toolkit` at `24e7a7b8cb8035fae1ea2e7b507aab96698a38b9` (MIT). The bytes are pinned in `peaceai/test/m246-word-index.test.ts`. `camelCase` imports `capitalize`, pinned with the slice-and-case batch, and `words`.

- `words` is `Array.from(str.match(CASE_SPLIT) ?? [])`.
- `kebabCase` lowercases those words and joins them with `-`.
- `snakeCase` joins them with `_`.
- `camelCase` lowercases the first word and capitalizes the rest.
- `difference` filters with `!Set.has`. The scaffold uses `includes`.
- `intersection` filters with `Set.has`. The scaffold uses `includes`.
- `at` truncates each index and wraps a negative one.
- `lerp` returns `stop` when `fraction === 1`, otherwise `start + (stop - start) * fraction`.

Each published test fails when the function throws and passes on the scaffold. The scaffold was compared with the published function inside the practice sandbox on strings, `NaN`, `undefined`, `-0`, infinities, holes, empty arrays, fractions, and out-of-range indexes. A near-miss that agrees on the recorded calls and disagrees with the published function is `verified_test_only`.

## Not emitted

`pascalCase`, `constantCase`, `lowerCase`, `upperCase`, `startCase`, `sentenceCase`, and `xor` are emitted by the case-join batch. See `peaceai/docs/case-join-soundness.md`.

## Dropped

`compact` stays out. The published array removes every falsy value, and its test passes `0n`. A bigint is not a recorded argument, and the sandbox carries no bigint.

`uniq` is `[...new Set(a)]`. The published test builds a sparse array and stores `undefined`. The sandbox rejects a hole and an undefined element, so that call is not plain data and the file does not admit.

`flatten` stays out. The published calls use one argument and two. Mixed arity is `CANT_DO_YET_SIGNATURE`.

`sum` stays out. The published expects assign `const result = sum(...)` and then assert `result`. That call is not the assertion subject.

`clamp`, `inRange`, and `round` stay out. The published calls use more than one arity, and a recorded throw refuses the body.

`isEmpty` stays out. The published values include a class, a `Map`, a `Date`, or `Object.create(null)`. That is not one expression.

`trim`, `trimStart`, `trimEnd`, and `pad` take an optional argument. The published calls use more than one arity. `trimStart` throws when the character string is longer than one character.

`escape` and `unescape` stay out. The published calls pass a `let` binding and a nested call. Those arguments are not literals, and the sandbox replay has no binding for them. `unescape('&#00039;')` is `'`, which a chain of the five named entities does not cover by itself.

`inverseLerp` stays out. Its published spec imports `lerp`, so the file is not one module. The function itself is `a === b ? 0 : (c - a) / (b - a)`.

`fill`, `toFilled`, `windowed`, and `chunk` stay out. The published calls use more than one arity, or the function throws.

`union` stays out. The published spec has one call, so the literal also fits.

A bare integer comparison still keeps the first form in its class. A number-array `some` / `every` is not emitted. The attempt cap stays 20. `target.ts` was not edited. `capability-job.ts` was not edited.
