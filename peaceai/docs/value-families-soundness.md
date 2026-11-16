# Value families: finite, last, strict null

These shapes read only the recorded calls. They do not copy a fix. A shape is kept only when every reduced call agrees with that one form. Two forms are `CANT_DO_YET_NO_BODY`. A call whose argument is not a literal, a sentinel, or a collection of those is not an example. A throw is still part of the spec, and the body is refused. A plan is built only from a missing-module, missing-export, or not-a-function error. A passing log does not build one.

## Finite

`Number.isFinite(a)` is emitted when every example matches that test and some number example is `Infinity`, `-Infinity`, or `NaN` and false. A true non-finite example is not this function. Without a non-finite example the number tag already says the same thing on the finite numbers, so finite stays out.

`finite-guard:match` is the agreement check. `finite-guard:witness` requires the non-finite false example.

## Last

`a[a.length - 1]` is emitted when every argument is an array, the expected value is the last element, and an empty array's expected value is `undefined`. Two different results are required. One repeated last element stays the literal, because `return 2` and `return a[a.length - 1]` disagree on an array that ends with something else. A one-element array agrees with the first-element shape, so a spec that is only one-element arrays is two forms and is refused.

`last-guard:arrays` refuses a string. `last-guard:index` refuses an earlier element. `last-guard:varies` refuses one repeated result.

## Strict null

`a === null` is emitted when `null` is true, `undefined` is present and false, and every other example is false. `undefined` that was not in the spec also agrees with `a == null`, so the body is refused. Both nullish values true is nil (`a == null`), not this. A true non-null example is not this function.

`null-guard:null-true` requires `null` to be true. `null-guard:undef-false` requires `undefined` present and false. `null-guard:others-false` requires every other example false.

## Opaque calls

`spec-guard:opaque-call` drops a recorded call whose argument is not concrete. Deleting it restores the refusal of any such call. The published test still runs that call, so a body that is wrong on it is not kept.

## Admitted

`toss/es-toolkit` at `24e7a7b8cb8035fae1ea2e7b507aab96698a38b9` (MIT). The bytes are pinned in `peaceai/test/m243-value-families.test.ts`.

- compat `isFinite` is `Number.isFinite(value)`. The published test fails when the function throws and passes on `Number.isFinite(a)`. `Object(1)` is not a concrete argument, so it is not an example. The test still checks it.
- `last` is `arr[arr.length - 1]`. The scaffold emits `a[a.length - 1]`, and `last([])` is `undefined`.
- `isNull` is `x === null`. `undefined` is false in the published test, so nil does not fit.

## Not in this batch

Appending one property onto an existing default object is not emitted. `sindresorhus/is` builds that object with `Object.assign` and a second typed `assert` object. Its published suite imports jsdom, rxjs, and tempy. Those installs are network, which these tests do not do. An existing file with a default-property call stays `CANT_DO_YET_NO_BODY`.

`unjs/defu` is not a key of `targets.json`. Scoring it would edit `targets.json`, `target.ts`, `gate.ts`, or `scope.ts`. Those files were not edited. The rows stay `GATE_NO_TARGET`.

An Ava worker that stops on `TS2339` stays `CANT_DO_YET_AVA_EARLY_EXIT`. The line names a type mismatch. It does not say whether the test or the declaration should change, and there is no assertion value yet.

A sentence that says `make NAME strict` without a `.ts` path and without `flag` or `integer 1..N` does not become an env-fix line. A wider cue would only rename `CLASSIFIER_UNSURE` to `NO_SLOTS`. The two dev workflow rows name a job and not `npm` or `pnpm run <script>`. The workflow file is the file being created, so the tree cannot fill that slot.

PeaceSTOCKS subjects that say a candidate was chosen in review do not name an edit. They stay `CANT_DO_YET_NO_EDIT`. `Add \`name\`` without the behavior stays `CANT_DO_YET_ADD_UNSPECIFIED` on the sentence. The behavior is the failing test, and only a missing module is scaffolded from it.

The attempt cap stays 20. `target.ts` was not edited. `capability-job.ts` was not edited.
