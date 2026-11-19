# Capability batch 21

Based on `7d16bebc6f350b6ef543c8f037ea1096ee2a0b38`. No credit claim. Held-out diffs and reasons were not opened. The cap stays 20. `specgrade.ts`, `gate.ts`, `scope.ts`, and `capability-job.ts` were not edited. The self-change lane was not edited.

The libraries below were checked by name against the held-out list, the hidden set, the public exclusion list, the practice pairs, and the LM pair lists. None of those names is `unjs/upm`, `unjs/unwasm`, or `unjs/changelogen`. They are also not already a fixture, and they are not the libraries used in batches 1 through 20. Each notice omits one email address and records the hash of that redacted text.

## Families

`yaml` treated `? key` as an ordinary line, so a pnpm explicit key became part of the previous mapping. `unjs/upm` at parent `0dbc5903e8c484b1c79619dce41d98660ef59f8e` does that in `src/yaml.ts`. Commit `0dbc9ccd9b94c6807596db8ec81b614f9e9d7453` reads `?` as the key and the following `:` line as its value. The published `test/yaml.test.ts` fails because `pathe@2.0.3` is not the key, and passes after the edit.

`readFunctionNames` stored a name whose bytes ran past the subsection end, so an export id became the spilled string. `unjs/unwasm` at parent `51ad7128dc1c8bcdb5d97243daf2b1f66677eca0` does that in `src/tools/parser.ts`. Commit `7bea530031533661814f9f13c34c0d0bf90d1152` checks the subsection bound before the name is stored. The published `test/parse.test.ts` fails because the id is `AAAAA` where the check expects `0`, and passes after the edit.

`bumpVersion` read `commits[0].shortHash` when a suffix was requested and the commit list was empty. `unjs/changelogen` at parent `5f359c6f43f781189f5843d564c20037fdddaae9` does that in `src/semver.ts`. Commit `22b08b245db51bd87f5b6a84d57223258354045f` omits the hash when there is no commit. The published `test/semver.test.ts` fails while reading `shortHash`, and passes after the edit.

## Soundness

The mutant for each family is that unmodified parent. The same published command fails in-process and inside the sandbox for the reason above, and the repair puts the parent file back to the fixed source. An `any` parameter that returns the recorded answer for every input is `verified_test_only` for `yaml`, `parseWasm`, and `bumpVersion`. A check that renames `yaml`, `readFunctionNames`, or `bumpVersion` is refused. The cap stays 20. No credit is claimed. Held-out repositories were not opened.
