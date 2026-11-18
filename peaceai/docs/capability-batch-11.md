# Capability batch 11

Based on `d24dfb66da62bf8c12c24b81c448715284d41f8c`. No credit claim. Held-out diffs and reasons were not opened. The cap stays 20. `specgrade.ts`, `gate.ts`, `scope.ts`, and `capability-job.ts` were not edited. The self-change lane was not edited.

The libraries below were checked by name against the held-out list, the hidden set, the public exclusion list, the practice pairs, and the LM pair lists. None of those names is `open-draft/outvariant`, `jridgewell/trace-mapping`, or `fb55/domutils`. They are also not already a fixture, and they are not the libraries used in batches 1 through 10. The outvariant and domutils licenses have no email address, so the pinned hash is the text as written. The trace-mapping notice omits one email address and records the hash of that redacted text.

## Counts

Builder-log on the merged batches is 88 pass / 163 fail / 25 unmeasured, of which 140 fails are self-change. Practice dev at the pre-repair head was test-as-spec 3/37/7 and text 0/40/7. Test-as-spec `VERIFIED_TEST_ONLY` is 14. Text `NO_EDIT` is 21 and `ADD_UNSPECIFIED` is 8. This batch does not claim those rows moved. The repairs are three different shapes, not a template copied from a dev pair. The core archive is not on this machine.

## Families

`format` left `%i` in the output, because the placeholder pattern accepted `s`, `d`, `j`, and `o` and not `i`. `open-draft/outvariant` at parent `acc313435c973a09e3aba3fc6512407a4b8f0ad9` does that in `src/format.ts`. Commit `d165cdbe1cc02408ab2cbe7e929b7e28fedc0ccf` adds `i` to that class. The published `src/format.test.ts` fails before that edit and passes after. A check that is not `format` is refused. MIT. A missing format token.

`resolve` joined a source to the map URL and ignored `sourceRoot`. `jridgewell/trace-mapping` at parent `f8a42ebfcb57c1f2769ae784ef7135532447d1c0` does that in `src/resolve.ts`. Commit `99b6a471b8ceeb9e5afda30cb40437b21f5621a4` returns `resolver`, which prefixes `sourceRoot` and then resolves against the map URL with its filename removed. The published `test/resolve.test.ts` fails before and passes after. A check that does not import the path resolver is refused. MIT. A sourceRoot prefix. The sandbox supplies a path joiner for that import; the published assertions are unchanged.

`find` walked the tree when `limit` was zero or negative, so the predicate ran and the whole match list came back. `fb55/domutils` at parent `595fe52c210e3533af61d20b6904f0924e0f1634` does that in `src/querying.ts`. Commit `78d0f55277df7a1d1e80bc5a3986bca72ef3936f` returns the empty list before the walk when `limit` is not positive. The published `src/querying.spec.ts` fails before and passes after. A check that is not `find` is refused. BSD-2-Clause. A non-positive limit.

## Soundness

Each edit is one shape. `%i` becomes a number the same way `%d` already did, and `%s`, `%d`, `%j`, and `%o` stay on the same branch. `sourceRoot` is joined in front of the source, then that string is resolved against the directory of the map URL; an empty map URL leaves the prefixed source as it is, and a source that is already absolute stays absolute when `sourceRoot` is absent. A non-positive `limit` returns before the predicate runs, so a positive limit still walks. Deleting each guard admits the near miss, with the sandbox and without it. An `any` parameter that returns the recorded answer for every input is `verified_test_only` for `format`, `resolver`, and `find`. A review note that names no function, and `Add <name>` with no value, stay refusals.

## Dropped

`sindresorhus/ow` `f200d60b4b8f` changes a type and the published runtime checks still pass. `sindresorhus/p-limit`, `wooorm/bcp-47`, `micromatch/picomatch`, `fastify/fast-json-stringify`, `lukeed/klona`, and `sindresorhus/matcher` are JavaScript. `unjs/consola` changes an example rather than a unit check. `floating-ui` needs a document and `ResizeObserver`. `fb55/htmlparser2` needs a generated decoder whose bytes the leak scan treats as an email address, so that file was not copied. `cacjs/cac` also launches snapshot commands. `vuejs/pinia` needs Vue. Libraries already named in the LM exclusion lists, and the libraries used in batches 1 through 10, were not reused.
