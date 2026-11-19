# Capability batch 43

Three repairs for bugs the existing templates do not cover. The cap stays 20. No credit is claimed. Lane NONE.

## Families

`cwd` resolved the found package.json's directory against the start path, so `cwd('fixtures','a','b','c')` returned `fixtures/a/b/c` instead of `fixtures/a/b` when `fixtures/a/b/package.json` was the nearest manifest. `jonschlinkert/cwd` at parent `cb7b072f2ab5730f0f2a8dfdf0ae73724e456582` does that in `index.js`. Commit `b33b018a8053c7a9bf5a7710f9e77fb352e13041` returns the directory of the found package.json. The published `test.js` (mocha) fails that relative lookup, and passes after the edit.

`array-sort` compared property values with a raw `<` / `>` check, so objects whose sort key was `null` or `undefined` were placed first instead of last. `jonschlinkert/array-sort` at parent `0770421a96850a5dd9ebbf6ce5f92c3e6acd2213` does that in `index.js`. Commit `cb459d937a314390295dcf87adabf45010ad9aca` special-cases `null` and `undefined` in the default compare and sends them to the end. The published `test.js` (mocha) fails those cases, and passes after the edit.

`replace-nth` built `new RegExp('^' + num + '$')`, so an alternation such as `1|3|5` was a start-or-end pattern and replaced far more matches than the requested indexes. `jonschlinkert/replace-nth` at parent `21b127135f5f86263feb3340c4b0df7488840c5d` does that in `index.js`. Commit `c4d142feeb528cdde4f704d1a54b894614745b04` anchors the alternation as `^(?:…)$`. The published `test/test.js` (mocha `-R spec`) fails the alternation cases, and passes after the edit. The published parent source also `require`s `lodash` without listing it; the lock-only fixture pins that module so the file can load.

## Soundness

The mutant for each family is that unmodified parent. The same published command fails in-process and inside the sandbox for the reason above, and the repair puts the parent file back to the fixed source. An `any` parameter that returns the recorded answer for every input is `verified_test_only` for `cwd`, `arraySort`, and `replaceNth`. A check that renames the directory return, the null/undefined compare, or the anchored alternation is refused. The cap stays 20. No credit is claimed. Held-out repositories were not opened. They are not the M145 code-search fixture repositories.
