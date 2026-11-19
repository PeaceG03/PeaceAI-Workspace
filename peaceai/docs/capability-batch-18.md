# Capability batch 18

Stacked on `35b39b7dcdd0f4af39d399e90ae2932b932dfeaa`. No credit claim. Held-out diffs and reasons were not opened. The cap stays 20. `specgrade.ts`, `gate.ts`, `scope.ts`, and `capability-job.ts` were not edited.

The libraries below were checked by name against the held-out list, the hidden set, the public exclusion list, the practice pairs, and the LM pair lists. None of those names is `unjs/ungh`, `unjs/confbox`, or `antfu/local-pkg`. They are also not already a fixture, and they are not the libraries used in batches 1 through 17. A notice omits an email address when the license text contains one and records the hash of that redacted text. A license with no email keeps the hash of the text as written.

## What landed

The rate-limit middleware skips a pathname that starts with `/_`. `unjs/ungh` at parent `ff11ddfc57c285beb6634463da0c0a1af525312c` looks for a pathname that starts with `_`, so `/_metrics` is still limited and the response carries rate-limit headers. Commit `469eaa6d35ac780fa0740324704b5d88754a5251` matches `/_`. The published `test/ratelimit.test.ts` fails because those headers are present, and passes after the edit.

`detectFormat` takes its indent sample from the first line that has content and drops whitespace-only lines. `unjs/confbox` at parent `65f414f6eb04eec7a8cd4fa2e94aceb0e34101e4` counts leading padding, so a nested value comes back indented with that padding. Commit `0b8a5603812fab9f256eb17b99d9cf0bdd926819` skips the padding. The published `test/index.test.ts` fails on `meta:\n     a: 1` where the check expects two spaces, and passes after the edit.

`resolvePackage` treats `ENOTDIR` as a package that is not installed. `antfu/local-pkg` at parent `3da6302e7a97093a3a1e927c29ef044de33ce2e1` logs that error. Commit `51e5920cdc8b6288bc7c13f4b5a76c4b83d6d25a` returns not-found without logging. The published `test/enotdir.test.ts` fails because `console.error` received `ENOTDIR`, and passes after the edit.

The mutant for each family is that unmodified parent. The same published command fails in-process and inside the sandbox for the reason above, and the repair puts the token back. An `any` parameter that returns the recorded answer for every input is `verified_test_only` for `skipInternalRoute`, `detectFormat`, and `isPackageExists`.

## What this does not change

Candidate order is unchanged. The attempt cap stays 20. Held-out rows were not scored and were not opened.
