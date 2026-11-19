# Capability batch 42

Three repairs for bugs the existing templates do not cover. The cap stays 20. No credit is claimed. Lane NONE.

## Families

`dashify` left a leading dash when the first character was already uppercase, so `Foo barBaz quux` became `-foo-bar-baz-quux`. `jonschlinkert/dashify` at parent `abaf7bcdec754008c972831d71ffa5c5ac91dd4f` does that in `index.js`. Commit `4fdc731e5d2522d0268460a51b554bd6c4f31f8e` strips the leading dash that the capital-to-dash step inserted. The published `test.js` (mocha) fails the leading-capital case, and passes after the edit.

`unixify` always stripped a trailing slash and left a leading `./` in place, so `unixify('one/two/three/', false)` returned `one/two/three` and `unixify('./one/two/three/')` returned `./one/two/three`. `jonschlinkert/unixify` at parent `0bb9598eae04009fe2702e8768194f11dc0cb7ea` does that in `index.js`. Commit `cdb49b4b2d116c5647397a2409cc87ce96baf70f` passes the trailing-slash flag through to `normalize-path` and also strips a leading `./`. The published `test.js` (mocha) fails those cases, and passes after the edit.

`array-last` only returned a bare element when the array itself had length 1, so `last(['a', 'b', 'c', 'd', 'e', 'f'], 1)` returned `['f']` instead of `'f'`. `jonschlinkert/array-last` at parent `5a747f1f3084fb68c3650961502df0735c2a4dd9` does that in `index.js`. Commit `4e9b368ea408768aa52b44660b564fa23d344781` returns the last element itself whenever `n` is 1. The published `test.js` (mocha) fails that case, and passes after the edit.

## Soundness

The mutant for each family is that unmodified parent. The same published command fails in-process and inside the sandbox for the reason above, and the repair puts the parent file back to the fixed source. An `any` parameter that returns the recorded answer for every input is `verified_test_only` for `dashify`, `unixify`, and `last`. A check that renames the leading-dash strip, the trailing-slash flag and `./` strip, or the n===1 return is refused. The cap stays 20. No credit is claimed. Held-out repositories were not opened.
