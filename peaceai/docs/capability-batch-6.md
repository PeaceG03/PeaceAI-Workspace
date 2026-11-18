# Capability batch 6

Stacked on `7a9798d63c1ef6009f3ea51a28b67d2b12e1725f`. No credit claim. Held-out diffs and reasons were not opened. The cap stays 20. `specgrade.ts`, `gate.ts`, `scope.ts`, and `capability-job.ts` were not edited.

The libraries below were checked by name against the held-out list, the hidden set, the public exclusion list, the practice pairs, and the LM pair lists. None of those names is `unjs/knitwork`, `unjs/hookable`, or `unjs/unctx`. They are also not already a fixture.

## Counts

Builder-log on the merged batches is 88 pass / 163 fail / 25 unmeasured, of which 140 fails are self-change. Practice dev at the pre-repair head was test-as-spec 3/37/7 and text 0/40/7. Test-as-spec `VERIFIED_TEST_ONLY` is 14 and `CANT_DO_YET_CAP` is 11. Text `NO_EDIT` is 21 and `ADD_UNSPECIFIED` is 8. This batch does not claim those rows moved. The repairs are general shapes, not a template copied from a dev pair. The core archive is not on this machine.

## Families

`genAugmentation` joined interface declarations with commas because `wrapInDelimiters` defaults to commas. `unjs/knitwork` at parent `cfaa1be40fcb4fbdc903f565bb7b968d5140e84f` does that in `src/typescript.ts`. Commit `66d701b8fe69afccf20a38e40217b700691a9239` passes `false` for the comma flag. The published `test/typescript.test.ts` fails before that edit and passes after. A call that is not `genAugmentation` is refused. MIT.

`callHook` walked the live hook array. A hook that removed itself shifted the next hook out of the loop. `unjs/hookable` at parent `b77477c027039362ee0ec4f39b8998c4f1b21707` does that in `src/hookable.ts`. Commit `20fc8cd9f9f479693a76bf71b708005941b7e865` copies the list before dispatch. The published `test/hookable.test.ts` fails before and passes after. A file that does not splice the list is refused. MIT.

`tryUse` returned `undefined` when no context was set. `unjs/unctx` at parent `1627960d232326ba8810a5a5f6d5112ff681cad3` does that in `src/index.ts`. Commit `916484949a092a54b551efa9096d14aec65c48e7` returns `null` instead. The published `test/index.test.ts` fails before and passes after. A return that is not `tryUse` is refused. MIT. `??` changes only `null` and `undefined`. A stored `0`, `""`, or `false` stays itself.

## Soundness

Each edit is one shape. The augmentation edit is only the one-argument `wrapInDelimiters` call inside `genAugmentation`, so generators that want commas stay. The hook copy is only added when the same file splices that list. The `tryUse` edit is only the unset return. The unmodified parent fails the published check for that behavior, in-process and inside the sandbox, and the repair puts the token back. An `any` parameter that returns the recorded answer for every input is `verified_test_only`. A review note that names no function, and `Add <name>` with no value, stay refusals.

## Dropped

`unjs/pkg-types` needs `confbox`, `exsolve`, and `pathe` to load. `unjs/srvx` URL tests import the node adapter. `unjs/giget` `7f213d9b78bd` moves a hyphen in a character class, and the parent pattern already accepts the new cases, so the published check does not fail before the edit. The `unjs/unctx` transform needs `oxc-parser`, and its async suites need that transform, so those files are not the admission. Libraries already named in the LM exclusion lists were not reused. A repair that only matches one fixture's names was not added.
