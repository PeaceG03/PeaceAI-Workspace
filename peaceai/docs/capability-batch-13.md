# Capability batch 13

Based on `00f4f47b916a578a9982c628876e58cae9973c31`. No credit claim. Held-out diffs and reasons were not opened. The cap stays 20. `specgrade.ts`, `gate.ts`, `scope.ts`, and `capability-job.ts` were not edited. The self-change lane was not edited.

The libraries below were checked by name against the held-out list, the hidden set, the public exclusion list, the practice pairs, and the LM pair lists. None of those names is `omgovich/colord`, `natemoo-re/ultrahtml`, or `josdejong/lossless-json`. They are also not already a fixture, and they are not the libraries used in batches 1 through 12. A notice omits an email address when the license text contains one and records the hash of that redacted text. A license with no email keeps the hash of the text as written.

## Counts

Builder-log on the merged batches is 88 pass / 163 fail / 25 unmeasured, of which 140 fails are self-change. Practice dev at the pre-repair head was test-as-spec 3/37/7 and text 0/40/7. Test-as-spec `VERIFIED_TEST_ONLY` is 14. Text `NO_EDIT` is 21 and `ADD_UNSPECIFIED` is 8. This batch does not claim those rows moved. The repairs are three different shapes, not a template copied from a dev pair. The core archive is not on this machine.

## Families

`parseRgbaString` rejected every mix of numbers and percentages, including the space-separated form. `omgovich/colord` at parent `0d5902befb533c55e33adce760821556252bca63` does that in `src/colorModels/rgbString.ts`. Commit `f05d4520ebbeb7541f7cfeb552b16e3dd644d556` keeps that rejection for the comma form and lets the space-separated form mix the two. The published `tests/colord.test.ts` fails before that edit and passes after. A check that is not `parseRgbaString` is refused. MIT. Mixed units. The published test uses jest globals and the sources re-export types, so the sandbox compiles with TypeScript and supplies `it` and `expect`. The library source and the published test are unchanged.

`getAction` allowed an element that was not named in `allowElements`. `natemoo-re/ultrahtml` at parent `7db9a1d1ae560e25c1aae3937401210d27f5ae2b` does that in `src/transformers/sanitize.ts`. Commit `5715bc35588c4e3533ba82eb030a60d660f687ea` drops every element outside a non-empty allow list. The published `test/transformers/sanitize.test.ts` fails before and passes after. A check that is not `getAction` is refused. MIT. An allow list. The published test imports `vitest`, so the sandbox supplies that runner. The two library files it loads have no other dependency.

`isSafeNumber` treated `9007199254740992.0` as safe because `isInteger` does not see the decimal point. `josdejong/lossless-json` at parent `b8c3a8465ff422a9011dd0cef04002134cf80367` does that in `src/utils.ts`. Commit `82bd9e33c2189a8a7399050eb77e1251883b5adf` rejects a parsed integer that is not a safe integer, and the approximate check no longer also requires `isInteger` to be false. The published `src/utils.test.ts` fails before and passes after. A check that is not `isSafeNumber` is refused. MIT. An unsafe float. The published test imports `vitest`, so the sandbox supplies that runner. The library file has no other dependency.

## Soundness

Each edit is one shape. A comma `rgb()` that mixes a number and a percentage is still rejected. A space-separated `rgb()` whose channels are all numbers, or all percentages, still parses as it did. An empty allow list still uses the drop and block lists. A name that is in a non-empty allow list is still kept. An integer inside the safe range is still safe, and an approximate float with 14 matching digits is still approximate. Putting the new token back makes the published check fail for that behavior, in-process and inside the sandbox. The old `rgb()` source is repaired again. An allow list that returns allow, and a safe-number check without the unsafe-integer guard, fail that check and are not repaired. An `any` parameter that returns the recorded answer for every input is `verified_test_only` for `parseRgbaString`, `getAction`, and `isSafeNumber`. A review note that names no function, and `Add <name>` with no value, stay refusals.

## Dropped

`unjs/rou3` `1c8aaa375b` changes the compiler and several operations together, so it is not one edit. `solidjs/solid` signal fixes pull the web package. `mobily/ts-belt` `235f223a87` changes a ReScript file. `ProseMirror/prosemirror-model` `524e5b5108` does not change a published test. `microsoft/node-jsonc-parser` `164a8e9eb1` is a `__proto__` check. Libraries already named in the LM exclusion lists, and the libraries used in batches 1 through 12, were not reused.
