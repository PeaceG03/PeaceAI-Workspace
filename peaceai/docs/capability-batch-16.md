# Capability batch 16

Stacked on `35b39b7dcdd0f4af39d399e90ae2932b932dfeaa`. No credit claim. Held-out diffs and reasons were not opened. The cap stays 20. `specgrade.ts`, `gate.ts`, `scope.ts`, and `capability-job.ts` were not edited.

The libraries below were checked by name against the held-out list, the hidden set, the public exclusion list, the practice pairs, and the LM pair lists. None of those names is `unjs/unimport`, `unjs/compatx`, or `unjs/nypm`. They are also not already a fixture, and they are not the libraries used in batches 1 through 15. The unimport license has no email address, so the pinned hash is the text as written. The compatx and nypm notices omit one email address each and record the hash of that redacted text.

## What landed

`dedupeImports` treats a missing priority as 1 and leaves 0 and -1 below that default. A later import wins only when its priority is strictly higher. `unjs/unimport` at parent `10a9ef35a344b660cedeb97a9028a31489c122c8` uses `|| 1`, so 0 and -1 collapse to the default and the later import replaces the earlier one. Commit `4f462cb6c177ed95c413e192cfbd90c6670f006d` uses `?? 1` and takes the higher of a value import and its type complement. The published `test/dedupe.test.ts` fails on the parent with the later import still selected at `priority: -1`, and passes after the edit.

`formatDate` returns `""` for a date that does not parse, and `resolveCompatibilityDates` normalizes a default the same way it normalizes an input. `unjs/compatx` at parent `3bd47ef45e1a57c377f56c6b889b0b98648dcf28` formats an invalid date as `NaN-NaN-NaN` and leaves a present default unformatted. Commit `aaf7e4a95bb5abb9dbfe16dd89bf057abcbf5acd` returns `""` and formats the default. The published `test/date.test.ts` fails on that `NaN-NaN-NaN` string and passes after the edit.

`--recreateLockfile=false` is the boolean false. `unjs/nypm` at parent `9357ac261a489cb0d60d4b2f0d5d72672693e7fd` leaves the undeclared `=false` as the string `"false"`, which is truthy, so dedupe recreates the lockfile. Commit `7d028c8f50794845e62a98302acc2ddfde8ca111` stores false. The published `test/cli.test.ts` fails on the parent because the dry run prints `pnpm install`, and passes after the edit.

The mutant for each family is that unmodified parent. The same published command fails in-process and inside the sandbox for the reason above, and the repair puts the token back. An `any` parameter that returns the recorded answer for every input is `verified_test_only` for `dedupeImports`, `formatDate`, and `dedupeDependencies`. A review note that names no function, and `Add <name>` with no value, stay refusals.

## What this does not change

Candidate order is unchanged. The attempt cap stays 20. Held-out rows were not scored and were not opened.
