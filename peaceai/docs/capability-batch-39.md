# Capability batch 39

Three repairs for bugs the existing templates do not cover. The cap stays 20. No credit is claimed. Lane NONE.

## Families

`shallow-clone` passed `/\w+$/.exec(val)` straight to the RegExp constructor, so a regexp with no flags became `new RegExp(source, null)` and threw `SyntaxError: Invalid flags supplied to RegExp constructor 'null'`. `jonschlinkert/shallow-clone` at parent `fa62f9dfa131ba79bab0fe2b09d1e9a53121c48e` does that in `index.js`. Commit `fa957e2ea0611027a69f8ae71b87b9b9f2eb22e3` uses `undefined` when there are no flags. The published `test.js` (mocha) fails the flagless-regexp case, and passes after the edit.

`object-hash` treated `asyncfunction` as an unknown type, so hashing an async function threw `Error: Unknown object type "asyncfunction"`. `puleos/object-hash` at parent `9b84910d942cb881c5a47277ba471ca9b3bf8418` does that in `index.js`. Commit `e090f7e04fd9d5361a32295417c4f6e1ae9ef5a4` walks async functions the same way as ordinary functions. The published `test` suite (mocha) fails the async-function case, and passes after the edit.

`ansi-colors` reused a `/g` ANSI regexp without resetting `lastIndex`, so `hasColor` returned false on the second call for the same styled string. `doowb/ansi-colors` at parent `33f0b43d33c1e5ee189eac54e53d7d3c9d9b7c53` does that in `index.js`. Commit `a98a825c55c80aa81df71333e769722b4babb7e2` sets `re.lastIndex = 0` before `hasColor` and `unstyle`. The published `test.js` (mocha) fails the repeated-hasColor case, and passes after the edit.

## Soundness

The mutant for each family is that unmodified parent. The same published command fails in-process and inside the sandbox for the reason above, and the repair puts the parent file back to the fixed source. An `any` parameter that returns the recorded answer for every input is `verified_test_only` for `clone`, `hash`, and `hasColor`. A check that renames the flagless RegExp constructor, the asyncfunction type guard, or the hasColor lastIndex reset is refused. The cap stays 20. No credit is claimed. Held-out repositories were not opened.
