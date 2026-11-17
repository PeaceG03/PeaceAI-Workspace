# Case-join families

These shapes read only the recorded calls. They do not copy a fix. A shape is kept only when every reduced call agrees with that one form. Two forms are `CANT_DO_YET_NO_BODY`. A call whose argument is not a literal, a sentinel, or a collection of those is not an example. A throw is still part of the spec, and the body is refused. A plan is built only from a missing-module, missing-export, or not-a-function error. A passing log does not build one.

The word split is the one the word-index batch already emits. The bodies call that expression. They do not carry a second copy of the pattern. `trim` removes characters the pattern does not match, so `startCase` and `sentenceCase` agree with the split of the untrimmed string, including on `""`.

## Pascal

Each word is capitalized with `charAt(0)` and `slice(1).toLowerCase()`, then joined with nothing. An empty word list is `""`. One word is the published `capitalize` of that word, so some example has two words. A first word with no cased letter is camel, so some example has to show that letter. `HTTPRequest` is two words. A separator split leaves it as one.

`pascal-guard:strings` refuses an array of words. `pascal-guard:joined` refuses a different string. `pascal-guard:hump` refuses a one-word list. `pascal-guard:camel` refuses a case camel also fits.

## Constant

The words are uppercased and joined with `_`. One word is the same string as the space join, so some example has two words. A word with no cased letter is snake, so some example has to change case. `HTTPRequest` is `HTTP_REQUEST`. A separator split leaves it as one word.

`constant-guard:strings` refuses an array of words. `constant-guard:joined` refuses a different string. `constant-guard:space` refuses a case the space join also fits. `constant-guard:snake` refuses a case snake also fits.

## Lower and upper

Lower joins the lowercased words with a space. Upper joins the uppercased words with a space. The published upper function writes that join in a loop. The join agrees, including on `""`. One lower word is kebab, snake, and camel, so some example has two words. A first word with no cased letter is sentence case. A word with no cased letter makes upper and lower the same string, so upper requires a letter that changes. `HTTPRequest` is `http request` and `HTTP REQUEST`. A separator split leaves it as one word.

`lcase-guard:strings` and `ucase-guard:strings` refuse an array of words. `lcase-guard:joined` and `ucase-guard:joined` refuse a different string. `lcase-guard:hyphen` refuses a one-word list. `lcase-guard:sentence` refuses a case sentence case also fits. `lcase-guard:boundary` and `ucase-guard:boundary` refuse a case the separator split already fits. `ucase-guard:score` refuses a one-word list. `ucase-guard:lower` refuses a case lower case also fits.

## Start and sentence

Start capitalizes every word and joins with a space. Sentence capitalizes the first word, lowercases the later words, and joins with a space. A later word with no cased letter makes those two the same string. A first word with no cased letter makes sentence case and lower case the same string. One word is both of them, and it is also pascal. `XMLHttpRequest` is `Xml Http Request` and `Xml http request`.

`start-guard:strings` and `sentence-guard:strings` refuse an array of words. `start-guard:joined` and `sentence-guard:joined` refuse a different string. `start-guard:sentence` refuses a case sentence case also fits. `sentence-guard:start` refuses a case start case also fits. `sentence-guard:lower` refuses a case lower case also fits. `start-guard:boundary` and `sentence-guard:boundary` refuse a case the separator split already fits.

## Xor

`((u, both) => u.filter((item) => !both.includes(item)))([...new Set(a.concat(b))], a.filter((item) => b.includes(item)))` is `difference(union(a, b), intersection(a, b))`. `Set` and `includes` are SameValueZero for `NaN`, `-0`, and object identity. `filter` skips a hole. `includes` reads that hole as `undefined`. One `includes` test of the concatenation is a different function on a hole. A disjoint pair is the union, so some shared item has to be removed. Order is the first array, then items that appear only in the second. Duplicates collapse to the first occurrence.

`xor-guard:arrays` refuses a string. `xor-guard:rest` refuses a different filter. `xor-guard:shared` refuses a case where nothing was removed.

## Admitted

`toss/es-toolkit` at `24e7a7b8cb8035fae1ea2e7b507aab96698a38b9` (MIT). The bytes are pinned in `peaceai/test/m247-case-joins.test.ts`. `pascalCase` imports `capitalize` and `words`. The other case joins import `words`. `xor` imports `difference`, `intersection`, and `union`.

- `pascalCase` capitalizes every word and joins with nothing.
- `constantCase` uppercases every word and joins with `_`.
- `lowerCase` lowercases every word and joins with a space.
- `upperCase` uppercases every word and joins with a space.
- `startCase` capitalizes every word and joins with a space.
- `sentenceCase` capitalizes the first word, lowercases the rest, and joins with a space.
- `xor` removes the intersection from the set-union.

Each published test fails when the function throws and passes on the scaffold. The scaffold was compared with the published function inside the practice sandbox on Unicode, emoji, acronyms, digits, empty strings, `NaN`, `-0`, duplicates, order, and holes. A near-miss that agrees on the recorded calls and disagrees with the published function is `verified_test_only`.

## Dropped

`union` stays out. The published spec has one call, so the literal also fits.

`without` stays out. The published calls pass the excluded values as rest arguments. The arities differ.

`isSubset` stays out. The published calls bind the arrays to consts and use `toBeTruthy` and `toBeFalsy`. Those calls are not literal examples.

`mean` is emitted by the next batch. `Array.from` visits a hole, so the division matches `sum`. See `peaceai/docs/next-families-soundness.md`.

`median` stays out. A sort and a length branch can be one expression, and that expression matches the published function, including a hole. Every published call is also the mean, so the two bodies would both fit and neither spec would admit.

`range` and `rangeRight` stay out. The published calls use more than one arity, and a step of zero throws.

`deburr` stays out. The published function is a character map and a normalize pass. That is not one expression.

`zipObject` is emitted by the next batch. The body assigns each key, so a missing value is `undefined` and a `__proto__` key sets the prototype. See `peaceai/docs/next-families-soundness.md`.

`unzip` stays out. The published function is two loops, and a short row reads `undefined`.

`isPrimitive` stays out. The published values include a symbol, a bigint, a `Date`, a `Map`, and a `Set`. The sandbox does not carry those.

`dedent` stays out. The published function is not one expression.

`escapeRegExp` stays out. One published call concatenates consts. The other call is one string, so the literal also fits.

A bare integer comparison still keeps the first form in its class. A number-array `some` / `every` is not emitted. The attempt cap stays 20. `target.ts` was not edited. `capability-job.ts` was not edited.
