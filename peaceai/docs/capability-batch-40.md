# Capability batch 40

Three repairs for bugs the existing templates do not cover. The cap stays 20. No credit is claimed. Lane NONE.

## Families

`is-extglob` treated `@(abc` as an extglob because it only looked for `[@?!+*](` and did not require a closing parenthesis, so `?(abc/xyz` was reported as an extglob. `jonschlinkert/is-extglob` at parent `2f993202b5a71752bd3bda564febf1624e5de197` does that in `index.js`. Commit `733822f4af14540f300f8672f7e15da3d9affe75` requires the closing `)` in the matcher. The published `test.js` (mocha) fails the unclosed-extglob case, and passes after the edit.

`relative` returned `path.relative` unchanged, so a path that did not already start with `.` lacked the `./` prefix (`bar.txt` instead of `./bar.txt`). `jonschlinkert/relative` at parent `9f8a3ff0652b20238965e70c85e7192905b4d696` does that in `index.js`. Commit `97edbbff8fd3e2ba318f1296215c90f637dfaca5` prefixes `./` when the first character is not a dot. The published `test.js` (mocha) fails the same-directory file case, and passes after the edit.

`to-regex-range` always emitted a dash in a two-endpoint character class, so adjacent digits became `[0-1]` instead of `[01]`. `jonschlinkert/to-regex-range` at parent `6bc3a6053b05827ed8dfa52e42f7458cd343e8c3` does that in `index.js`. Commit `60591f029886cd879d74df069380824b0a80ea43` omits the dash when the endpoints differ by one. The published `test/test.js` (mocha) fails the adjacent-class cases, and passes after the edit.

## Soundness

The mutant for each family is that unmodified parent. The same published command fails in-process and inside the sandbox for the reason above, and the repair puts the parent file back to the fixed source. An `any` parameter that returns the recorded answer for every input is `verified_test_only` for `isExtglob`, `relative`, and `toRegexRange`. A check that renames the unclosed-extglob regex, the `./` prefix, or the adjacent-class dash omit is refused. The cap stays 20. No credit is claimed. Held-out repositories were not opened.
