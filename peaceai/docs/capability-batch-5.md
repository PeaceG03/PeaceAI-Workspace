# Capability batch 5

Stacked on `47593ff01ff5606c0bf392c8c7468ada0ef403ea`. No credit claim. Held-out diffs and reasons were not opened. The cap stays 20. `specgrade.ts`, `gate.ts`, `scope.ts`, and `capability-job.ts` were not edited.

The libraries below were checked by name against the held-out list, the hidden set, the public exclusion list, the practice pairs, and the LM pair lists. None of those names is `unjs/pathe`, `unjs/citty`, or `unjs/cookie-es`. They are also not already a fixture.

## Counts

Builder-log on the merged batches is 88 pass / 163 fail / 25 unmeasured, of which 140 fails are self-change. Practice dev at the pre-repair head was test-as-spec 3/37/7 and text 0/40/7. Text `NO_EDIT` is 21, `ADD_UNSPECIFIED` is 8, and `TEST_STILL_FAILS` is 7. This batch does not claim those rows moved. The core archive is not on this machine.

## Families

`path.resolve` drops a UNC prefix when it normalizes. `unjs/pathe` at parent `55a21be8a14b70ec67098d3f68f54a34f3796fd4` does that in `src/_path.ts`. Commit `b52fcacc59717a1e4a8783d4bbfae7fa81b4db07` records the UNC base and puts `//` back. The published `test/index.spec.ts` fails before that edit and passes after. A file that already records the flag is refused. MIT.

`parseRawArgs` copied a boolean option written as `--flag=false` through as the string `"false"`, and a bare string option through as `true`. `unjs/citty` at parent `ea428c76e46eb959a17cd62089fa28604fe22e0a` does that in `src/_parser.ts`. Commit `e6fa9ac717d5b175a67211311748df9825fe0ba0` coerces those two cases. The published `test/parser.test.ts` fails before and passes after. A file with no type helper is refused. MIT.

`serialize(name, null)` stored the string `"null"`, and `typeof null === "object"` made that value look like the options object. `unjs/cookie-es` at parent `26ea164c10fb0ba347e47697ac282ff12fe00d0b` does that in `src/cookie/serialize.ts`. Commit `55855c6ccef4370701268122dd817e382f9e14ca` uses `String(value ?? "")` and reads options from the first argument only when that argument is the cookie object. The published `test/cookie-serialize.test.ts` fails before that edit and passes after. A file that is not `serialize` is refused. MIT. The parser files are pinned too, because the published test imports the package index.

## Soundness

Each edit is one shape. The UNC flag is added only when the file already has the UNC regex and the resolve loop, and not when the flag is already there. Argument coercion is added only when the function already classifies options and still assigns the raw value. The cookie edit is added only when `serialize` still does `String(value)` and still treats an object value as the options object. `??` turns only `null` and `undefined` into `""`. `0`, `false`, and a string stay themselves, which is what the published suite checks. Deleting each of those guards admits the near miss, with the sandbox and without it. An `any` parameter that returns the recorded empty cookie for every value is `verified_test_only`.

## Dropped

`fabian-hiller/valibot` UUID `e90339fec658103adbfe0620ee12471603a24196` was dropped. Its published test imports the action harness for the rest of the library, so the check could not be run unmodified. `unjs/confbox` indent `0` needs `js-yaml` and `json5` to load the published suite, so it was not admitted here. A library already named in the LM exclusion lists was not reused. A repair that only matches one fixture's names was not added.
