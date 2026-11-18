# Capability batch 8

Stacked on `ef4149a92a9cf3c873492501cd2a00d651599234`. No credit claim. Held-out diffs and reasons were not opened. The cap stays 20. `specgrade.ts`, `gate.ts`, `scope.ts`, and `capability-job.ts` were not edited. The self-change lane was not edited.

The libraries below were checked by name against the held-out list, the hidden set, the public exclusion list, the practice pairs, and the LM pair lists. None of those names is `pillarjs/path-to-regexp`, `vueuse/vueuse`, or `TanStack/virtual`. They are also not already a fixture.

## Counts

Builder-log on the merged batches is 88 pass / 163 fail / 25 unmeasured, of which 140 fails are self-change. Practice dev at the pre-repair head was test-as-spec 3/37/7 and text 0/40/7. Test-as-spec `VERIFIED_TEST_ONLY` is 14. Text `NO_EDIT` is 21 and `ADD_UNSPECIFIED` is 8. This batch does not claim those rows moved. The repairs are general shapes from three different authors, not a template copied from a dev pair. The core archive is not on this machine.

## Families

`stringifyName` read `next.value[0]`, which is only the leading surrogate of an astral character. `pillarjs/path-to-regexp` at parent `bd12a33e7e18c994e9cf0f7e6175fcd0ba41db22` does that in `src/index.ts`. Commit `8877f41873e37a30258d3935feaf1d2679321735` reads the first code point, matching the parser, and quotes the name when that character is `ID_Continue`. The published `src/index.spec.ts`, with the cases that commit added, fails before that edit and passes after. A check that is not `stringifyName` is refused. MIT. The license notice omits one email address.

`useArrayDifference` treated only a string third argument as a property key, so `0` and a symbol were used as comparators. `vueuse/vueuse` at parent `043da374d683e5193fc684b0b2bcae7dd9340314` does that in `packages/shared/useArrayDifference/index.ts`. Commit `8d5cb9ea9bab7e816187d89f5ac0541ebe1b41e4` treats every non-function as a key. The published `packages/shared/useArrayDifference/index.test.ts` fails before and passes after. A check that is not `useArrayDifference` is refused. MIT. A function comparator is unchanged.

`getOffsetForIndex` read `measurementsCache`, which is rebuilt only on the next measurement read, so a size change was invisible until something else rebuilt it. `TanStack/virtual` at parent `0a368c76950610227af7a5d3695e53877f9ad914` does that in `packages/virtual-core/src/index.ts`. Commit `acaef5ef7fc2ed86f10fad660b2e21c9285027b5` reads `getMeasurements()`. The published `packages/virtual-core/tests/measurement.test.ts` fails before and passes after. A cache read that is not `getOffsetForIndex` is refused. MIT.

## Soundness

Each edit is one shape. The name is quoted only when `stringifyName` sees text after the name, and the character tested is the first code point, so a BMP character and an astral character follow the same `ID_Continue` rule. A function passed to `useArrayDifference` stays the comparator. `0`, a symbol, and a string become keys. `getOffsetForIndex` is the only call switched to `getMeasurements()`, so other reads of the cache stay as they are. Deleting the new line from the repaired file makes the published check fail, in-process and inside the sandbox, so that mutant is rejected. An `any` parameter that returns the recorded answer for every input is `verified_test_only` for each family. A review note that names no function, and `Add <name>` with no value, stay refusals.

## Dropped

`ai/nanoid` and `iamkun/dayjs` are JavaScript. `markedjs/marked` `04f1c6e51890` checks image-alt encoding through the built `lib/marked.esm.js`, not the TypeScript source. `arktypeio/arktype` `326cdce3b188` prints `undefined` through its own snapshot harness. `vuejs/petite-vue` checks custom delimiters from an HTML page. Libraries already named in the LM exclusion lists, and the libraries used in earlier batches, were not reused.
