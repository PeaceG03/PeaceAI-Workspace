# Array and nullish families: not-nil, initial, tail, take

These shapes read only the recorded calls. They do not copy a fix. A shape is kept only when every reduced call agrees with that one form. Two forms are `CANT_DO_YET_NO_BODY`. A call whose argument is not a literal, a sentinel, or a collection of those is not an example. A throw is still part of the spec, and the body is refused. A plan is built only from a missing-module, missing-export, or not-a-function error. A passing log does not build one.

## Not nil

`a != null` is emitted when `null` and `undefined` are both present and false, and every other example is true. Both nullish values true is nil (`a == null`). `null` true and `undefined` false is strict null (`a === null`). A false non-nullish example is not this function.

`notnil-guard:both` requires both nullish values. `notnil-guard:nullish-false` requires both to be false. `notnil-guard:others-true` requires every other example true.

## Initial

`a.slice(0, -1)` is emitted when every argument is an array and the expected value is every element but the last. An empty array and a one-element array are `[]`. Two different results are required. One repeated prefix stays the literal, because `return []` and `return a.slice(0, -1)` disagree on a longer array.

`init-guard:arrays` refuses a string. `init-guard:prefix` refuses a different slice. `init-guard:varies` refuses one repeated result.

## Tail

`a.slice(1)` is emitted when every argument is an array and the expected value is every element but the first. An empty array and a one-element array are `[]`. Two different results are required.

`tail-guard:arrays` refuses a string. `tail-guard:rest` refuses a different slice. `tail-guard:varies` refuses one repeated result.

## Take

`a.slice(0, b)` is emitted when the first argument is an array, the second is a finite number, and the expected value is that prefix. A count past the end is the whole array. A count of `0` is `[]`. Two different results are required.

`take-guard:arrays` refuses a string. `take-guard:count` refuses a different prefix. `take-guard:varies` refuses one repeated result.

## Opaque calls

The same parent-side decoder as the last-element scaffold reads the sandbox payload. It refuses a payload deeper than 32, more than 10000 nodes, a string longer than 100000, an object with more than 1000 keys, or a key `__proto__`, `constructor`, or `prototype`. A key is stored with `Object.defineProperty`, so a rejected name is not assigned through the prototype setter. The sandbox still only writes plain data. The parent still decides the check.

## Admitted

`toss/es-toolkit` at `24e7a7b8cb8035fae1ea2e7b507aab96698a38b9` (MIT). The bytes are pinned in `peaceai/test/m244-array-nullish.test.ts`.

- `isNotNil` is `x != null`. The scaffold emits `a != null`. The published filter tests pass on that body.
- `initial` is `arr.slice(0, -1)`. `nestedArray` is a const. The parent runs the body on the deserialized array.
- `tail` is `arr.slice(1)`.
- `take` is `arr.slice(0, count)`.

## Dropped

A bare integer comparison still keeps the first form in its class. `a > 5` and `a >= 6` agree on every integer the dev threshold tests record, and they disagree on the adjacent float. The real dev functions are the closed form, so those scaffolds stay `VERIFIED_TEST_ONLY`. `peaceai/test/m241-scaffold-families.test.ts` locks the first form. No published permissive test fails that open form and passes the closed form, because the two agree on every integer. The representative stays the first form.

A number-array `some` / `every` is not emitted. The one dev row whose calls are a number array and a boolean is `some` of one integer class (`item >= 1`, which is the same class as `item > 0` on those integers). `toss/es-toolkit` `some` and `every` take the predicate as an argument. That comparison is not a recorded call. No one-argument permissive test pins one comparison.

`Number.isFinite` stays out. `Object(1)` is still not plain data.

`unjs/defu` stays `GATE_NO_TARGET`. Scoring it would edit `targets.json`, `target.ts`, `gate.ts`, or `scope.ts`.

An Ava worker that stops on `TS2339` stays `CANT_DO_YET_AVA_EARLY_EXIT`.

Appending one property onto an existing default object stays out. `sindresorhus/is` still builds that object with `Object.assign`, and its published suite still imports jsdom, rxjs, and tempy.

A node:test line `error: 'is.name is not a function'` is not a `TypeError: name is not a function` line. Treating the dotted name as one missing property still lands on an existing default object, which this batch does not extend.

PeaceSTOCKS subjects that say a candidate was chosen in review stay `CANT_DO_YET_NO_EDIT`. The two object-store dev rows wrap a client method in a retry loop and rewrite a thrown error. That is not one expression over recorded calls.

`Add \`name\`` without the behavior stays `CANT_DO_YET_ADD_UNSPECIFIED`. A wider classifier cue for `make NAME strict` would only rename `CLASSIFIER_UNSURE` to `NO_SLOTS`. The two dev workflow rows still name a job and not `npm` or `pnpm run <script>`.

The attempt cap stays 20. `target.ts` was not edited. `capability-job.ts` was not edited.
