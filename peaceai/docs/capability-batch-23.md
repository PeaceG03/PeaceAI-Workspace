# Capability batch 23

Based on `cba73e7d8029fa70e04fc5257e29edd840f362f4`. No credit claim. Held-out diffs and reasons were not opened. The cap stays 20. `specgrade.ts`, `gate.ts`, `scope.ts`, and `capability-job.ts` were not edited. The self-change lane was not edited.

The libraries below were checked by name against the held-out list, the hidden set, the practice pairs, and the LM pair lists. None of those names is `unjs/ohash`, `unjs/ocache`, or `unjs/radix3`. They are also not already a fixture, and they are not the libraries used in batches 1 through 22. `unjs/giget` was evaluated and dropped: after email redaction its license text no longer classifies as solely MIT. Each notice omits one email address and records the hash of that redacted text.

## Families

`diff` treated a falsy primitive as an empty object, so `diff(true, false)` reported a change to `{}`. `unjs/ohash` at parent `1d9402ecaa40b2e20ab1fd58bd67de9b2d5a46b9` does that in `src/utils/diff.ts`. Commit `a5004f7175236d7d44864e77bc7ce20a93b77130` checks `obj === null || typeof obj !== "object"` so `false`, `0`, and `""` stay values. The published `test/utils.test.ts` fails where the snapshot expects `false` and sees `{}`, and passes after the edit.

`defineCachedFunction` released its dedup slot before a slow storage write landed, so a follower that missed storage resolved again. `unjs/ocache` at parent `ec49ef68747bd2bc68762198d0d9932b0f4b3bc4` does that in `src/cache.ts`. Commit `c295b13a3c4345f324e7559115614f13d67be0b4` keeps a `holdUntil` bound on the pending slot until the write settles. The published holdUntil cases from `test/index.test.ts` (vendored as `test/holduntil.test.ts` so the HTTP entry module that trips the core-text scan is not required) fail the landing-dedup cases, and pass after the edit.

`findOverlappingRoutes` deduped by data reference alone, so distinct routes that shared one object collapsed and optional expansions with primitive data were reported more than once. `unjs/radix3` at parent `68fc0173a9f4148988db83fb820e906c805a2ab2` does that in `src/operations/overlap.ts`. Commit `a560d1652f347647216afc78dbc5a88f4c3616b8` keys the seen set by registration identity and data. The published `test/overlap.test.ts` fails the registration-dedupe cases, and passes after the edit.

## Soundness

The mutant for each family is that unmodified parent. The same published command fails in-process and inside the sandbox for the reason above, and the repair puts the parent file back to the fixed source. An `any` parameter that returns the recorded answer for every input is `verified_test_only` for `diff`, `defineCachedFunction`, and `findOverlappingRoutes`. A check that renames `diff`, `defineCachedFunction`, or `findOverlappingRoutes` is refused. The cap stays 20. No credit is claimed. Held-out repositories were not opened.
