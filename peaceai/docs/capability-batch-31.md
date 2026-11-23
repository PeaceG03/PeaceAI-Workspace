# Capability batch 31

Based on `d42485b4aa4cb47b77ed929d0c49947e30898a42`. No credit claim. Held-out diffs and reasons were not opened. The cap stays 20. `specgrade.ts`, `gate.ts`, `scope.ts`, and `capability-job.ts` were not edited. The self-change lane was not edited.

The libraries below were checked by name against the held-out list, the hidden set, the public exclusion list, the practice pairs, and the LM pair lists. None of those names is `quansync-dev/quansync`, `mesqueeb/copy-anything`, or `antfu/birpc`. They are also not already a fixture, and they are not the libraries used in batches 1 through 30. Previously excluded or already-used libraries, including `TanStack/store`, `honojs/node-server`, `antfu/bumpp`, `unjs/ipx`, `pmndrs/valtio`, `typestack/class-transformer`, `unjs/impound`, `antfu/unconfig`, `harrisiirak/cron-parser`, `Hexagon/croner`, `tinylibs/tinypool`, `tinylibs/tinyps`, `tinylibs/tinybench`, `antfu/ni`, `antfu/strip-literal`, `typicode/steno`, `unjs/ufo`, `unjs/defu`, `unjs/scule`, and `unjs/destr`, were not reused.

`mesqueeb/merge-anything` was evaluated and dropped: its candidate was the same prototype-key skip as `copy-anything`. `microsoft/tsyringe` was evaluated and dropped: the 2018 singleton decorator fix lives in an old Jest-plus-reflect-metadata graph. `nicojs/typed-inject` was evaluated and dropped: its unit tests run against compiled `dist/` Mocha output. `unjs/crossws` was evaluated and dropped: the candidate tests need WebSocket adapters and server upgrades. `jeffijoe/awilix` was not needed once three families with different shapes already reproduced. The quansync, copy-anything, and birpc licenses contain no email address, so each notice keeps the hash of the text as written. The lock-only install fixture contains no email address.

## Families

`quansync` attached only the fulfillment callback when someone called the returned thenable's `then`, so `expect(fn()).rejects` never saw an async rejection. `quansync-dev/quansync` at parent `7efea90f0c0c4b98c7d238909dfea981744d2dad` does that in `src/index.ts`. Commit `c96154e6b5d6c25bfddc5528489dbb34e2efed95` forwards every `then` argument. The published `test/index.test.ts` fails the handle-errors case (`Error: async error`), and passes after the edit.

`copy` assigned a `__proto__` key onto the clone, so a payload such as `{"__proto__": {"polluted": true}}` gave the clone a crafted prototype. `mesqueeb/copy-anything` at parent `e5276772768819e749463610aac435b9eff4dd71` does that in `src/index.ts`. Commit `32fd83f8468105a5a6346553c8a1e0347250eee2` skips the `__proto__` key. The published `test/index.test.ts` fails the prototype-pollution case (AssertionError on the clone's prototype), and passes after the edit.

`$close` rejected pending calls with the caller's custom error and dropped the original closed-rpc message, so `err.cause` was missing. `antfu/birpc` at parent `3a78f95f7e7f04b3d7b111540ff4ba41ea1a010f` does that in `src/index.ts`. Commit `40ee074dad5a29743173404d58dbb0cd2184ced0` stores that original error on `customError.cause` when the caller did not already set one. The published `test/close.test.ts` fails the custom-message case (TypeError reading `err.cause.message`), and passes after the edit.

## Soundness

The mutant for each family is that unmodified parent. The same published command fails in-process and inside the sandbox for the reason above, and the repair puts the parent file back to the fixed source. An `any` parameter that returns the recorded answer for every input is `verified_test_only` for `quansync`, `copy`, and `createBirpc`. A check that renames `quansync`, `copy`, or `createBirpc` is refused. The cap stays 20. No credit is claimed. Held-out repositories were not opened.
