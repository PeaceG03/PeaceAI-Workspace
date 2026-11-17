# Capability batch 3

Stacked on `c21b1e633db4822b05929eb96348c1d26964c79a`. Dev rows only. Held-out diffs and reasons were not opened. The cap stays 20. No source file changed. `specgrade.ts`, `gate.ts`, `scope.ts`, and the capability-job entry points were not edited. The pinned core archive is not on this machine, so the full dev replay was not re-scored. The counts below are the frozen ones, and the one-row Ava check did not move a row off `AVA_EARLY_EXIT`.

## Type diagnostic as a failure

A practice run that exits with `TS2345`, `TS2322`, `TS2554`, `TS2339`, or `TS2769` is parsed into a file, a line, a column, a code, and, for `TS2345`, the argument type and the parameter type. The same lines are read from `tsc`, from tsx, and from an Ava worker that stops under `TSIMP_DIAG=error`.

`TS2345` and `TS2554` at one call of one function in a non-test source file become a signature edit. A readonly array or a readonly tuple of the parameter's element replaces `T[]` with `readonly T[]`. Any other safe argument type is added as a union. `TS2554` with extra literal arguments adds an optional parameter and keeps the old signature as an overload. The edit is kept only when `tsc --noEmit` on the project succeeds inside the practice sandbox and the original test command then exits 0. A signature that type-checks while the assertion still fails is not a repair.

Refused: the diagnostic is in a test helper; the function is a `.d.ts`, or under a vendored, generated, or fixture path; the type text contains `any` or is not a plain type; more than one function matches. Deleting each of those guards admits the near miss. A missing sandbox is a failed type-check. Deleting that guard reports success when nothing ran. An `any` parameter that returns the recorded answer and a different answer for another input is `verified_test_only`.

`toss/es-toolkit` `src/array/at.ts` at `8aab1978414d50f46e3e1acad326ed9d95c65b5b` takes `indices: number[]`. Commit `bec4905d01af1381709921a9e205e3c7b2c1c77e` changes that parameter to `readonly number[]` and does not change the body. A readonly tuple is `TS2345` before the edit and type-checks after it. The published examples still return the same elements, and a mutable caller still type-checks. The body already read the indices, so the runtime assertion passes.

A predicate-array argument, such as `((value: unknown) => value is string)[]`, is not a plain type, so this repair refuses it. That is the shape of the `TS2345` line from a type-checking Ava launch on one of the five dev rows. `runTestSpec` returns the diff when a repair exists, and returns `CANT_DO_YET_AVA_EARLY_EXIT` when a type diagnostic remains. `practice-replay.ts` already grades a diff. `capability-job.ts` does not need a change.

The pinned core archive (`caa7e8a9d835292c33becab4e9a3537ef452217f`, archive sha256 `64e5aa8edfd20e2245e776faafadacd7e4924bbf5e62e4907217ab961bdc259a`) is not on this machine, so the five rows were not re-scored through the gate. Expected dev change for those rows: they stay `CANT_DO_YET_AVA_EARLY_EXIT` when the diagnostic is the predicate-array `TS2345`. No new pass is claimed.

## Text `NO_EDIT`

Twenty of the measured sentences are a review note. The note names a pull request. It does not name a function, a wrong result, or an expected result. A route for that sentence would invent the edit. It stays `CANT_DO_YET_NO_EDIT`.

One other measured sentence is prose and names no symbol. It stays a refusal. Sentences that name a function and a wrong behavior already reach repair-v2. They are not this bucket. No new issue-to-edit family was added.

## `ADD_UNSPECIFIED` and `TEST_STILL_FAILS`

`ADD_UNSPECIFIED` is `Add <name>` with no value, no type, and no example. The name does not decide the body. That stays a refusal.

`TEST_STILL_FAILS` is a repair-v2 candidate the gate accepted while the recorded test still failed. The candidate is one of the existing templates. A new template matched to these sentences would be fitted to them. Neither bucket changed.

## `CANT_DO_YET_CAP`

The eleven rows edit an existing module. The recorded change is not one of the repair templates, and those rows do not share one predicate a new template could emit without being fitted to them. No template was added, and no third-party file was pinned.
