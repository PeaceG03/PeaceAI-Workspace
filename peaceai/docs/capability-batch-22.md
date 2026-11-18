# Capability batch 22

Based on `cba73e7d8029fa70e04fc5257e29edd840f362f4`. No credit claim. Held-out diffs and reasons were not opened. The cap stays 20. `specgrade.ts`, `gate.ts`, `scope.ts`, and `capability-job.ts` were not edited. The self-change lane was not edited.

The libraries below were checked by name against the held-out list, the hidden set, the public exclusion list, the practice pairs, and the LM pair lists. None of those names is `unjs/get-port-please`, `unjs/nf3`, or `unjs/jup`. They are also not already a fixture, and they are not the libraries used in batches 1 through 21. Each notice omits one email address and records the hash of that redacted text.

## Families

`getPort` tried the default port before a caller-supplied list, so `{ ports: [8080] }` came back as `3000`. `unjs/get-port-please` at parent `6a2165dfc422d7a8e65e376dd153523ed303ae69` does that in `src/get-port.ts`. Commit `2586218066cf32ffdfeac07398de696f8913d9d9` leaves the port unset until the list is empty, then uses `3000`. The published `test/index.test.ts` fails on `3000` where the check expects `8080`, and passes after the edit.

`traceNodeModules` dropped a package-import pattern whose key has a trailer after `*`, so the traced output never contained that file. `unjs/nf3` at parent `a81bf79eace5b7df1398048ed7ba63a82597b127` does that in `src/trace.ts`. Commit `87ad23645951781c4226f01ca82e43900886423b` asks the Node resolver when the primary resolver misses. The published `test/trace.test.ts` fails because the wildcard marker is missing, and passes after the edit.

`reconcile` ignored a pinning member's `onFail`, so `ignore` still printed the advisory. `unjs/jup` at parent `77985daef480bab52e2b2dce404ff52a9762e387` does that in `src/project/manifest.ts`. Commit `0a69e19d804da948c79fcd16772ec1e40dded913` lets that `onFail` decide. The published `test/unit/manifest.test.ts` fails because the `devEngines.packageManager` advisory is still emitted, and passes after the edit.

## Soundness

The mutant for each family is that unmodified parent. The same published command fails in-process and inside the sandbox for the reason above, and the repair puts the parent file back to the fixed source. An `any` parameter that returns the recorded answer for every input is `verified_test_only` for `getPort`, `traceNodeModules`, and `reconcile`. A check that renames `getPort`, `traceNodeModules`, or `reconcile` is refused. The cap stays 20. No credit is claimed. Held-out repositories were not opened.
