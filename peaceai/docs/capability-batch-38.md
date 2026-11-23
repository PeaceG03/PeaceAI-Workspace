# Capability batch 38

Three repairs for bugs the existing templates do not cover. The cap stays 20. No credit is claimed. Lane NONE.

## Families

`fast-deep-equal` treated `null` as an object because `typeof null == 'object'`, so comparing `null` with `{}` walked null and threw. `epoberezkin/fast-deep-equal` at parent `5a472bc5bde46f446d21138c5234cd101ce6d5e0` does that in `index.js`. Commit `787ba533350fd0620e14845b35f013253cc48e44` requires both values to be truthy before the object walk. The published `spec/index.spec.js` (via `spec/tests.js`) fails the null-vs-empty-object case, and passes after the edit.

`y18n` skipped falsy tagged-literal values because it used `if (arg)`, so `__\`Hi, ${'Ben'} ${''}!\`` dropped the empty argument and missed the locale string. `yargs/y18n` at parent `c66f8baa9165ded6c90fe909575f4b7643ec741e` does that in `index.js`. Commit `c92612347847fdaee53ba2f5dd23f51734c349bc` keeps any defined argument, including `0` or `""`. The published `test/y18n-test.js` fails the falsy-argument case, and passes after the edit.

`yargs-parser` started a new token on every space, so `foo  bar  "foo  bar"` produced empty entries instead of `['foo', 'bar', 'foo  bar']`. `yargs/yargs-parser` at parent `00bde7d60c433c188f2529a33bab187d40645f7d` does that in `lib/tokenize-arg-string.js`. Commit `d1372279d3fc574ecc67bf9b3a21d785dd33a5a4` increments the token index only when the previous character was not already a space. The published `test/*.js` suite fails the repeated-space case, and passes after the edit.

## Soundness

The mutant for each family is that unmodified parent. The same published command fails in-process and inside the sandbox for the reason above, and the repair puts the parent file back to the fixed source. An `any` parameter that returns the recorded answer for every input is `verified_test_only` for `equal`, `format`, and `tokenize`. A check that renames the fast-deep-equal object-typeof guard, the y18n truthy-arg test, or the yargs-parser repeated-space increment is refused. The cap stays 20. No credit is claimed. Held-out repositories were not opened.
