# Capability batch 3

Stacked on `c21b1e633db4822b05929eb96348c1d26964c79a`. Dev rows only. Held-out diffs and reasons were not opened. The cap stays 20. No source file changed. `specgrade.ts`, `gate.ts`, `scope.ts`, and the capability-job entry points were not edited. The pinned core archive is not on this machine, so the full dev replay was not re-scored. The counts below are the frozen ones, and the one-row Ava check did not move a row off `AVA_EARLY_EXIT`.

## Ava early exit

The five dev test-as-spec rows in this bucket use Ava with `environmentVariables.TSIMP_DIAG` set to `error`. Their tsconfig `include` does not cover the test file, so the repo's own `tsc` does not typecheck it. The overlaid test calls the base module with types the base source rejects. On one of those rows the worker's own line is `error TS2345` (an argument is not assignable), and `avaEarlyDetail` returns that line. The process exits before any assertion. That is the early exit. It is not a missing loader and not a missing `--config`.

The relaxed launch already rewrites an omitted test's `TSIMP_DIAG` from `error` to `ignore`. Doing the same on the graded launch was tried on that row, inside the practice sandbox and outside it. Ava then reports that the worker timed out and failed to exit. There is still no assertion and no failing test title. A direct `node --import=tsimp/import` of the module does not produce a result either. Silencing the diagnostic does not turn the row into a test failure the repair loop can read. The graded launch stays type-checking, and these five rows stay `CANT_DO_YET_AVA_EARLY_EXIT`.

## Text `NO_EDIT`

Twenty of the measured sentences are a review note. The note names a pull request. It does not name a function, a wrong result, or an expected result. A route for that sentence would invent the edit. It stays `CANT_DO_YET_NO_EDIT`.

One other measured sentence is prose and names no symbol. It stays a refusal. Sentences that name a function and a wrong behavior already reach repair-v2. They are not this bucket. No new issue-to-edit family was added.

## `ADD_UNSPECIFIED` and `TEST_STILL_FAILS`

`ADD_UNSPECIFIED` is `Add <name>` with no value, no type, and no example. The name does not decide the body. That stays a refusal.

`TEST_STILL_FAILS` is a repair-v2 candidate the gate accepted while the recorded test still failed. The candidate is one of the existing templates. A new template matched to these sentences would be fitted to them. Neither bucket changed.

## `CANT_DO_YET_CAP`

The eleven rows edit an existing module. The recorded change is not one of the repair templates, and those rows do not share one predicate a new template could emit without being fitted to them. No template was added, and no third-party file was pinned.
