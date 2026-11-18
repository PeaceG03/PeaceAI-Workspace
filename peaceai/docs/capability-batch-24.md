# Capability batch 24

Based on `4aaff542952dafb8ccd63564cf08b0d97ade75ae`. No credit claim. Held-out diffs and reasons were not opened. The cap stays 20. `specgrade.ts`, `gate.ts`, `scope.ts`, and `capability-job.ts` were not edited. The self-change lane was not edited.

The libraries below were checked by name against the held-out list, the hidden set, the public exclusion list, the practice pairs, and the LM pair lists. None of those names is `unjs/unimport`, `unjs/compatx`, or `tinylibs/tinyexec`. They are also not already a fixture, and they are not the libraries used in batches 1 through 23. `unjs/ufo`, `unjs/defu`, `unjs/scule`, and `unjs/destr` were evaluated and dropped: each is named on the public exclusion list. `unjs/nypm` was evaluated and dropped: its CLI path needs packages already attributed in earlier notice groups. `unjs/perfect-debounce` was evaluated and dropped: the control-method cases fail with a TypeError when methods are absent. `unjs/ofetch` was evaluated and dropped: the published case hits the network. Each notice omits email addresses when the license text contains them and records the hash of that redacted text. A license with no email keeps the hash of the text as written.

## Families

`RE_EXCLUDE`'s local-variable pattern treated a TypeScript annotation as more of the binding, so `const { a }: Props = ...` stretched to a later bracket and hid names used in between. `unjs/unimport` at parent `8f84905a6ac775a0b80709ffe8f75360cc55ec84` does that in `src/regexp.ts`. Commit `6bbb566559a1ca7572454e31448311ccf97c4b24` allows an optional `:...` run before the terminator. The published `test/existing-scanning.test.ts` fails the annotated-destructuring cases, and passes after the edit.

`resolveCompatibilityDates` spread a string defaults value into character keys, so `defaults: "2021-01-01"` never set `default`. `unjs/compatx` at parent `ed1fbf4d68ee4e9db9579b7d0c76f47fc7ca70f6` does that in `src/date.ts`. Commit `9526a1d2cdab4ce429b3927eb436ead7db9cad02` wraps a string as `{ default }`. The published `test/date.test.ts` fails that case (under `TZ=UTC`), and passes after the edit.

`combineStreams` left an empty input list open, so async iteration never finished. `tinylibs/tinyexec` at parent `9f44cd6cb9427ce41d96c9423835f098a5c238c9` does that in `src/stream.ts`. Commit `4a2aca1cf11943445c7bae6c767086a8c61291ef` ends immediately when there are no streams. The published `src/test/stream_test.ts` fails the empty-input case, and passes after the edit.

## Soundness

The mutant for each family is that unmodified parent. The same published command fails in-process and inside the sandbox for the reason above, and the repair puts the parent file back to the fixed source. An `any` parameter that returns the recorded answer for every input is `verified_test_only` for `RE_EXCLUDE`, `resolveCompatibilityDates`, and `combineStreams`. A check that renames `RE_EXCLUDE`, `resolveCompatibilityDates`, or `combineStreams` is refused. The cap stays 20. No credit is claimed. Held-out repositories were not opened.
