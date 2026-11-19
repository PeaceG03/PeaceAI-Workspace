# Capability batch 36

Three repairs for bugs the existing templates do not cover. The cap stays 20. No credit is claimed. Lane NONE.

## Families

`qs` decoded percent-encoded dots in keys only when the escape was uppercase `%2E`, so a lowercase `%2e` was left encoded. `ljharb/qs` at parent `234d5051f5071efaa025a7ca9e4d34a56a460a1b` does that in `lib/parse.js`. Commit `05a875552a31829825c3ebf8899f280011aa06be` uses a case-insensitive replacement. The published `test/parse.js` fails the mixed-case escape case (`'name%2eobj'` vs `'name.obj'`), and passes after the edit.

`js-yaml` tested `noCompatMode` with `&&` against one deprecated form and `||` against base60, so `noCompatMode: true` still quoted `1:23`. `nodeca/js-yaml` at parent `a00312147f287a1703bf6b7e104d27c8a0caacee` does that in `lib/dumper.js`. Commit `dc44dd37ed34c57a1d04e5b8d161fc09031c9e30` applies `noCompatMode` to both checks. The published `test/issues/0027.js` fails the base60 noCompatMode case (`Expected ... "'1:23'\n" / '1:23\n'`), and passes after the edit.

`braces` treated an opening quote as the start of a quoted span even when no matching closer existed, so an unpaired quote swallowed the rest of the pattern. `micromatch/braces` at parent `977c75a38a1045ee95cf3e6b433cea613cbec4f2` does that in `lib/parse.js`. Commit `ac60bdb94870afd675baca7ec71c903cc708687e` treats an unpaired quote as ordinary text. The published `test/bash-spec.js` fails the unpaired-quote cases (deep-equal mismatches such as `"a'b{x,y}\'"` vs the expanded pair), and passes after the edit.

## Soundness

The mutant for each family is that unmodified parent. The same published command fails in-process and inside the sandbox for the reason above, and the repair puts the parent file back to the fixed source. An `any` parameter that returns the recorded answer for every input is `verified_test_only` for `parse`, `dump`, and `parseObject`. A check that renames the qs `decodeDotInKeys` replacement, the dumper's `DEPRECATED_BASE60_SYNTAX` marker, or the braces quote-character test is refused. The cap stays 20. No credit is claimed. Held-out repositories were not opened.
