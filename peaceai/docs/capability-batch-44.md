# Capability batch 44

Three repairs for bugs the existing templates do not cover. The cap stays 20. No credit is claimed. Lane NONE.

## Families

`strip-comments` removed every occurrence of a comment string with `split`/`join`, so a later comment that contained an earlier one as a substring was corrupted. `jonschlinkert/strip-comments` at parent `fda8826750a2901e1775fa8d0c66c636aedbfabc` does that in `index.js`. Commit `2c70437dd7cfbbcb2ac2f227ab4db38719493a0e` replaces only the first occurrence. The published `test/test.js` (mocha) fails that substring case, and passes after the edit.

`index-of` walked `length` steps from the start index, so a `fromIndex` search could read past the end of the array and treat a hole as `undefined`. `jonschlinkert/index-of` at parent `3284f7b6b29ac2b6e9e3c2d185d49274339f83c4` does that in `index.js`. Commit `0219979a887624123d67e06a1024ac141ed4ad02` stops the walk at the array length. The published `test.js` (mocha) fails `indexOf(['a', undefined, 'b', 'c', 'a'], undefined, 2)` (it returned `5` instead of `-1`), and passes after the edit.

`falsey` looked up keywords with `val.toLoweCase`, a typo, so the lower-case branch never ran and mixed-case keywords such as `NIL` were not recognized. `jonschlinkert/falsey` at parent `ec6a83a7c70f8dc460f8b725108f0f820f619c39` does that in `index.js`. Commit `6e043084b60302c5d8237c0c88718952e967008c` calls `toLowerCase`. The published `test.js` (mocha) fails those mixed-case keyword cases, and passes after the edit.

## Soundness

The mutant for each family is that unmodified parent. The same published command fails in-process and inside the sandbox for the reason above, and the repair puts the parent file back to the fixed source. An `any` parameter that returns the recorded answer for every input is `verified_test_only` for `strip`, `indexOf`, and `falsey`. A check that renames the first-occurrence replace, the bounded indexOf walk, or the toLowerCase typo fix is refused. The cap stays 20. No credit is claimed. Held-out repositories were not opened. They are not the M145 code-search fixture repositories.
