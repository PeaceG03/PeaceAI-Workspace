# Capability batch 9

Stacked on `ef4149a92a9cf3c873492501cd2a00d651599234`. No credit claim. Held-out diffs and reasons were not opened. The cap stays 20. `specgrade.ts`, `gate.ts`, `scope.ts`, and `capability-job.ts` were not edited. The self-change lane was not edited.

The libraries below were checked by name against the held-out list, the hidden set, the public exclusion list, the practice pairs, and the LM pair lists. None of those names is `fb55/nth-check`, `uuidjs/uuid`, or `Rich-Harris/magic-string`. They are also not already a fixture. None of the three license texts contains an email address, so the pinned hash is the text as written.

## Counts

Builder-log on the merged batches is 88 pass / 163 fail / 25 unmeasured, of which 140 fails are self-change. Practice dev at the pre-repair head was test-as-spec 3/37/7 and text 0/40/7. Test-as-spec `VERIFIED_TEST_ONLY` is 14. Text `NO_EDIT` is 21 and `ADD_UNSPECIFIED` is 8. This batch does not claim those rows moved. The repairs are general shapes from three different authors, not a template copied from a dev pair. The core archive is not on this machine.

## Families

`parse` accepted `2n3` and `n1`, because a digit after `n` was read as `B` without a sign. `fb55/nth-check` at parent `1df5171127f56e0274e6b22ab6387b5b8a7ae52c` does that in `src/parse.ts`. Commit `ecbb7ebf4f421d63fdc90342f9204e21a3cf9186` requires `+` or `-` before that integer. The published `src/parse.spec.ts`, with the invalid formulas that commit added, fails before that edit and passes after. A check that is not `parse` is refused. BSD-2-Clause.

`v1Bytes` added `nsecs` only inside the low 32 bits, so a value near a `time_low` overflow was not carried into `time_mid`. `uuidjs/uuid` at parent `ea83515d6a4de13a8f9d253fe772752c9dd7bbbe` does that in `src/v1.ts`. Commit `6adcc1d81bfaeb653c49d9b7ca7b0579244ae60c` folds the high bits of that sum into `time_mid`. The published `src/test/v1.test.ts` fails before and passes after. A check that is not `v1Bytes` is refused. MIT. A timestamp that does not overflow stays on the same bytes, which is what the older cases check.

`update` emptied chunks in the same loop that looks for a split point, so a throw left part of the range edited. `Rich-Harris/magic-string` at parent `b28c233b7b6ee67a96c6eeb9322d5c86e71a9385` does that in `src/MagicString.ts`. Commit `f815ec4e2fd010fc47f09ebb2d1c2935cda0be8c` walks the range once to check it, then walks it again to edit. The published `tests/MagicString/update.test.ts` fails before and passes after. The suite defines `DEBUG`, and the sandbox runner defines it the same way. A check that is not `update` is refused. MIT.

## Soundness

Each edit is one shape. The sign is required only when `parse` still has text after `n`, so `even`, `odd`, and a formula that ends at `n` stay valid. The carry is the same 60-bit timestamp, split so a low-half overflow increments the high half; `0` through `4383` at the pinned millisecond do not change `time_mid`. The second walk edits only after the first walk has seen a continuous range, so a throw happens before `chunk.edit`. The unmodified parent fails the published check for that behavior, in-process and inside the sandbox, and the repair puts the token back. An `any` parameter that returns the recorded answer for every input is `verified_test_only` for each family. A review note that names no function, and `Add <name>` with no value, stay refusals.

## Dropped

`cacjs/cac` `26938a28aaed` leaves an omitted array option absent. Its published file also launches snapshot commands, so the check is not the unit assertion alone. `privatenumber/get-tsconfig` `b09052cfaba1` keeps `files` when `include` is set, and the published test compares the result with `tsc` through its fixture harness. `sindresorhus/nano-spawn`, `sveltejs/devalue`, `sindresorhus/query-string`, `fastify/light-my-request`, `chalk/slice-ansi`, and `jsdom/whatwg-url` fixes in this search are JavaScript. Libraries already named in the LM exclusion lists, and the libraries used in earlier batches, were not reused.
