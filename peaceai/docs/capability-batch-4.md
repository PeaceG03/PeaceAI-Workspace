# Capability batch 4

Stacked on `7030e9f4c40042ae462ec3c9f62e4abbb0ca8360`. No credit claim. Held-out diffs and reasons were not opened. The cap stays 20. `specgrade.ts`, `gate.ts`, `scope.ts`, and `capability-job.ts` were not edited.

The box measure on main is builder-log 88 pass / 163 fail / 25 unmeasured. 140 of those fails are `PEACEAI_SELF_CHANGE` and stay off limits until that lane is approved. That leaves 23 fails and 25 unmeasured. Practice dev at the pre-repair head was test-as-spec 3/37/7 and text 0/40/7.

## Ranking

Rows-moved per unit of work, from the batch 1-3 triage and the non-self-change builder-log reasons. A family that would invent an edit, edit a protected file, or fit one dev project is not work.

| rank | gap | rows | decision |
|---|---|---:|---|
| 1 | `PEACEAI_SELF_CHANGE` | 140 | Off limits. No edit. |
| 2 | Test-as-spec `CANT_DO_YET_CAP` on existing-module edits | 11 | The recorded diffs do not share one predicate. A template for one of them would be fitted. Dropped. |
| 3 | `verified_test_only` scaffolds that already match on the recorded calls | about 14 | Promoting them edits `specgrade.ts`. Dropped. |
| 4 | Text `NO_EDIT`, `ADD_UNSPECIFIED`, `TEST_STILL_FAILS` | 21 + 7 + 7 | A review note, a bare `Add name`, and a template the test still fails. None of those is a new family. Dropped. |
| 5 | `CANT_DO_YET_AVA_EARLY_EXIT` predicate-array `TS2345` | 5 | The argument is a function array, not a readonly array and not a `=> boolean` callback used only as a condition. Still refused. |
| 6 | Builder-log `CLASSIFIER_UNSURE` planners, file-less workflow words, a test import, a stem test, and a bare `fail closed` | 13 | No signature, no path, or a context rule that is already correct. Dropped. |
| 7 | `NO_SLOTS` workflow, multi-file env, duration integer, and the 1000-page loop | 5 | `targets.json` stays, one file stays the env rule, the duration fill was removed, and a loop bound would be fitted to one project. Dropped. |
| 8 | Characterization sentences routed as wire | 4 | Extending derive-wire would teach it the wrong sentence. Dropped. |
| 9 | `GATE_NO_TARGET` | 7 unmeasured on each dev mode | Scoring it edits `targets.json`. Dropped. |
| 10 | Callback `=> boolean` used only as a condition, negative splice indices, and `Math.max` of a mapped length | 0 measured rows share the shape | Implemented. Each has a published es-toolkit check that fails before and passes after. Expected measured movement is none. |

## What landed

`bwrap` is resolved on the caller's PATH. A relative PATH entry is ignored. The spawn uses the real path of the absolute entry.

`TS2345` whose parameter is `=> boolean` and whose callback is used only as a condition widens that return to `unknown`. A returned or compared result is refused. `toss/es-toolkit` `src/array/partition.ts` at `953920b2b6f84aab17cedbc9c3f5f74d5023380b` takes `=> boolean`. Commit `b854e154b107836afe3dd2e6de9c98c702979531` changes it to `=> unknown` and adds the truthy-predicate case to `src/array/partition.spec.ts`. That published file is `TS2769` before the edit: no overload matches a callback that returns `boolean | undefined`.

`pullAt` at `658bc937f9678f3d0a7741512bae82431f38a8e4` splices `indices.slice().sort((x, y) => y - x)`. Commit `6d18625796a93b1df527775c9631f92c48162bf3` normalizes a negative index with the array length and adds those cases to `src/array/pullAt.spec.ts`. The published spec fails before and passes after. An ascending sort is not rewritten.

`unzipWith` at `58ecef5dbff23b71c4e2ba41725a11b96d8e62b7` uses `Math.max(...target.map(inner => inner.length))`, which is `-Infinity` on an empty input and then throws `RangeError`. Commit `e77ab9a65f89f307a94390afb23d02134986bbb2` seeds the max with 0. The published spec fails before and passes after. A max of values that are not lengths is not seeded.

## Expected movement

None of the measured dev rows. The five Ava rows stay `CANT_DO_YET_AVA_EARLY_EXIT`. The cap, text, and builder-log refusals above stay refusals. The core archive is not on this machine, so this is an expectation, not a new measurement.
