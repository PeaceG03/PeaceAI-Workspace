# Capability batch 12

Based on `e855179088b7547aad5d806ca7490174b507e2f3`. No credit claim. Held-out diffs and reasons were not opened. The cap stays 20. `specgrade.ts`, `gate.ts`, `scope.ts`, and `capability-job.ts` were not edited. The self-change lane was not edited.

The libraries below were checked by name against the held-out list, the hidden set, the public exclusion list, the practice pairs, and the LM pair lists. None of those names is `lukeed/resolve.exports`, `unjs/exsolve`, or `antfu/utils`. They are also not already a fixture, and they are not the libraries used in batches 1 through 11. The resolve.exports and exsolve notices omit one email address each and record the hash of that redacted text. The antfu/utils license has no email address, so the pinned hash is the text as written.

## Counts

Builder-log on the merged batches is 88 pass / 163 fail / 25 unmeasured, of which 140 fails are self-change. Practice dev at the pre-repair head was test-as-spec 3/37/7 and text 0/40/7. Test-as-spec `VERIFIED_TEST_ONLY` is 14. Text `NO_EDIT` is 21 and `ADD_UNSPECIFIED` is 8. This batch does not claim those rows moved. The repairs are three different shapes, not a template copied from a dev pair. The core archive is not on this machine.

## Families

`injects` passed a subpath through `String.replace`, so `$` in that subpath was read as a replacement pattern. `lukeed/resolve.exports` at parent `6613167c0b4fc1511fc52171f4f52cb030c928c3` does that in `src/utils.ts`. Commit `beab56e8e3e70819073d04f3afc2db0216602158` passes the subpath through a replacer function, which keeps `$` literal. The published `test/utils.ts` and `test/index.ts` fail before that edit and pass after. A check that is not `injects` is refused. MIT. A literal replacement. The published tests import `uvu`. The real runner also imports `kleur`, so the sandbox supplies the suite and assert calls those tests use. The library source and the published tests are unchanged.

`determineSpecificType` interpolated `constructor.name` whenever it was truthy, and it read the accessors more than once. `unjs/exsolve` at parent `cad6769e49e58bc5d02fdc6042db01bbfdb85954` does that in `src/internal/errors.ts`. Commit `1e43e570ab236b5c8484323a700630862c8d5a7d` reads each accessor once and uses the name only when it is a non-empty string. The published `test/internal-errors.test.ts` fails before and passes after. A check that is not `determineSpecificType` is refused. MIT. A constructor name. The published test imports `vitest`, so the sandbox supplies that runner. The library has no other dependency.

`deepMerge` merged into the current value whenever the incoming value was an object, so a number already stored at that key stayed a number. `antfu/utils` at parent `c7bbe2d06242d8ec026b3e209e6e5d2fc5efe3be` does that in `src/object.ts`. Commit `34cbabfe51a070f6f914ecfebbe4c3aac11e5168` replaces the current value when it is not a mergable object. The published `src/object.test.ts` fails before and passes after. A check that is not `deepMerge` is refused. MIT. A plain-value replacement. The published test imports `vitest`, so the sandbox supplies that runner. The library files it loads have no other dependency.

## Soundness

Each edit is one shape. A subpath with no `$` is still written in place of `*`, because the replacer returns that same string. A class instance whose `constructor.name` is a non-empty string is still described with that name; a symbol, a number, or an empty name is inspected instead, and each accessor runs once. An object merged into an object still recurses; only a value that is not itself an object is replaced. Deleting each guard admits the near miss, with the sandbox and without it. An `any` parameter that returns the recorded answer for every input is `verified_test_only` for `injects`, `determineSpecificType`, and `deepMerge`. A review note that names no function, and `Add <name>` with no value, stay refusals.

## Dropped

A title-case package was already on an exclusion list, so it was not used. `planttheidea/fast-equals` `0fc6c89922` compares enumerable keys, and the published test imports React. `unjs/confbox` loads `js-yaml`, `json5`, `smol-toml`, and `ini`. `unjs/pkg-types` loads `confbox`, `exsolve`, and `pathe`. `unjs/mlly` loads `pathe` and `ufo`. `moment/luxon`, `ai/nanoid`, and `mrmlnc/fast-glob` are JavaScript. `antfu/utils` `e279526d55f4` changes a `then` signature and the new check does not fail at runtime. Libraries already named in the LM exclusion lists, and the libraries used in batches 1 through 11, were not reused.
