# Capability batch 41

Three repairs for bugs the existing templates do not cover. The cap stays 20. No credit is claimed. Lane NONE.

## Families

`pascalcase` lowercased the interior of an already camel-cased string, so `fooBarBaz` became `Foobarbaz`. `jonschlinkert/pascalcase` at parent `f42590773dd8251a3317d708fad342fd3c8f45d1` does that in `index.js`. Commit `8a16aa9d0c3d74d729c8a203c8a4b3ef0f645bb9` inserts a space before each capital so the existing camelCase is preserved. The published `test.js` (mocha) fails the existing-camelcasing case, and passes after the edit.

`pad-left` used `.length` on a non-string first argument, so padding `123` to width 5 returned `123` instead of `  123`. `jonschlinkert/pad-left` at parent `f1266f603218f32ecec32a198f4d493b1b408bf1` does that in `index.js`. Commit `ca4de8fec9ea18d93384311dca0a742a07d179d6` coerces the first argument to a string before padding. The published `test.js` (mocha) fails the number-padding case, and passes after the edit.

`omit-empty` treated a Date as an empty object, so `{ d: new Date() }` dropped `d`. `jonschlinkert/omit-empty` at parent `558b4dfd4fe31c285030061bbaec500bc4e1a296` does that in `index.js`. Commit `07115c9c22f1c28301eb96fcc5bdf97847e2ae5a` keeps Date values instead of recursing into them. The published `test.js` (mocha) fails the Date case, and passes after the edit.

## Soundness

The mutant for each family is that unmodified parent. The same published command fails in-process and inside the sandbox for the reason above, and the repair puts the parent file back to the fixed source. An `any` parameter that returns the recorded answer for every input is `verified_test_only` for `pascalcase`, `padLeft`, and `omitEmpty`. A check that renames the camelCase spacing step, the pad-left coerce, or the Date keep is refused. The cap stays 20. No credit is claimed. Held-out repositories were not opened.
