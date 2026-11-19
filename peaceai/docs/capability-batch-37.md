# Capability batch 37

Three repairs for bugs the existing templates do not cover. The cap stays 20. No credit is claimed. Lane NONE.

## Families

`is-glob` treated a lone `@` or `+` as a glob character, so a valid path such as `abc/@.js` was classified as a glob. `jonschlinkert/is-glob` at parent `722a6e9f14cb370aa8cc5976d1319bc5ce8dfdfe` does that in `index.js`. Commit `a1654f060b19a322103b9d0155d5d22dd63dfd12` keeps `@` and `+` out of the generic character class and uses `is-extglob` for real extglobs. The published `test.js` fails the valid-path cases (`abc/@.js` and `abc/+.js` expected false), and passes after the edit.

`is-number` treated a whitespace-only string as a number because `+'   '` is `0` and the empty-string check did not trim. `jonschlinkert/is-number` at parent `204c885659b8ee1946534c61db91603b9a16d661` does that in `index.js`. Commit `12749e3c411750f754d50f093471234c7ab270b0` trims strings and rejects a whitespace-only value. The published `test.js` fails the whitespace-only cases (`"   "` and `"\r\n\t"` expected not to be a number), and passes after the edit.

`validate-npm-package-name` accepted a name that starts with a hyphen, such as `-start-with-hyphen`. `npm/validate-npm-package-name` at parent `52ff0f181afeb60126ec0e623991130dd94785e2` does that in `lib/index.js`. Commit `23f220dad912024af5f3a48501f8f1bfbf8fa311` rejects a leading hyphen. The published `test/index.js` fails the leading-hyphen cases (`name cannot start with a hyphen`), and passes after the edit.

## Soundness

The mutant for each family is that unmodified parent. The same published command fails in-process and inside the sandbox for the reason above, and the repair puts the parent file back to the fixed source. An `any` parameter that returns the recorded answer for every input is `verified_test_only` for `isGlob`, `isNumber`, and `validate`. A check that renames the is-glob `@`/`+` character class, the is-number untrimmed empty-string return, or the validator's period-then-underscore sequence is refused. The cap stays 20. No credit is claimed. Held-out repositories were not opened.
