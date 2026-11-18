# Capability batch 17

Stacked on `35b39b7dcdd0f4af39d399e90ae2932b932dfeaa`. No credit claim. Held-out diffs and reasons were not opened. The cap stays 20. `specgrade.ts`, `gate.ts`, `scope.ts`, and `capability-job.ts` were not edited.

The libraries below were checked by name against the held-out list, the hidden set, the public exclusion list, the practice pairs, and the LM pair lists. None of those names is `unjs/nanotar`, `unjs/untyped`, or `unjs/rc9`. They are also not already a fixture, and they are not the libraries used in batches 1 through 16. Each notice omits one email address and records the hash of that redacted text.

## What landed

`parseTar` removes `..`, a leading slash, a backslash, and a drive letter from an entry name before the name is stored. `unjs/nanotar` at parent `a52e49ec17ed078818de3ffb716d944bab7574fb` keeps `../../etc/passwd`. Commit `322f9677f12c4a5c15eea223bd51542f35a31219` stores `etc/passwd`. The published `test/parse.test.ts` fails on that parent name and passes after the edit.

`generateTypes` quotes an object key that is not an identifier, including one that starts with a digit. `unjs/untyped` at parent `dc3e9823f1445b15ad3df8b5cb8cb74044616747` leaves `2ndKey` bare because `\w` includes digits. Commit `776c59ddc235b42d9b25993c672c6e6b8603d714` quotes it. The published `test/types.test.ts` fails on the bare `2ndKey` and passes after the edit.

`write` creates the directory before it writes the file, and a user config file is owner-readable only. `unjs/rc9` at parent `19b1e019d479e53c6abe2c9057129cab56aa2677` calls `writeFileSync` on a path whose directory may not exist, so the open fails with `ENOENT`. Commit `8b642a4f2af7b332d0a22167f6c8af8da8d2e6d4` creates that directory first. The published `test/index.test.ts` fails on that `ENOENT` and passes after the edit.

The mutant for each family is that unmodified parent. The same published command fails in-process and inside the sandbox for the reason above, and the repair puts the token back. An `any` parameter that returns the recorded answer for every input is `verified_test_only` for `parseTar`, `generateTypes`, and `write`.

## What this does not change

Candidate order is unchanged. The attempt cap stays 20. Held-out rows were not scored and were not opened.
