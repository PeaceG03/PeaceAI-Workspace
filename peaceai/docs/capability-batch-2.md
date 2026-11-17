# Capability batch 2

Stacked on `0bfd9b311549ddfe878d521e1962bf955542056b`. No credit claim. Held-out practice repositories were checked by name only and were not opened. The cap stays 20. `specgrade.ts` was not edited.

## Env-fix admission

`public-env-fix-v1` was mined from PeaceSTOCKS and its checked-in fixtures were invented. This batch admits `colinhacks/zod` at `90bf57b8e96a3729d766fff3185d39b2ab3ba016` (MIT, not a fork). The pinned file is `packages/bench/compile-matrix.ts`. Its only read of `ZOD_BENCH_CHILD` is `process.env.ZOD_BENCH_CHILD === "1"`. The bytes are unchanged.

The rule refuses a path that does not start with `src/`, so the published path is `path_not_plain`. The same bytes at `src/compile-matrix.ts` take the flag edit: the comparison becomes `strictZodBenchChild(process.env.ZOD_BENCH_CHILD)` and the helper is appended. The object key `ZOD_BENCH_CHILD: "1"` is not a read and stays.

Inside the practice sandbox, the verbatim comparison returns true for `"1"` and false for `"true"`. The helper returns true for `"1"` and throws for `"true"`. A strict expectation therefore fails before the edit and passes after it. A helper that only returns `value === "1"` agrees on `"1"`, `""`, and `"0"` and disagrees when the strict helper throws. That pair is `verified_test_only`.

`admit-guard:verbatim` refuses a text that does not contain the pinned comparison. `admit-guard:bwrap` refuses a missing sandbox. Deleting it reports a strict pass when nothing ran. There is no in-process fallback. The integer guards are below.

## Seq 216 and 219

Seq 216 is `NO_SLOTS: ENV_FIX` because the slot filler only emitted a flag line, and the one read is not a flag. It is the v1 integer ternary, `Number(NAME) > 0 ? Number(NAME) : DEFAULT`, in one source file. The sentence states the range as `1 ms to 6 h`, and the name ends in `_MS`.

The filler now emits `integer 1..MAX` when all of these hold: exactly one non-test `src` file, that file's only reads of the name are one v1 ternary, the name ends in `_MS`, `_S`, `_SEC`, or `_SECS`, and the sentence has one `N <unit> to M <unit>` range whose floor is 1 in that unit. The ceiling is that duration converted into the name's unit. A second duration, a floor other than 1, a name with no unit suffix, or any other read shape refuses. No ceiling is invented. On the seq 216 parent this is `make env ONEOFF_BUDGET_MS strict in src/oct2024-tenmin-oneoff.ts as integer 1..21600000`, and `buildEnvFix` accepts that line. A Job A pass still needs the pinned kernel, which is not on this machine.

`slot-guard:int-shape` refuses a read that is not the ternary. Deleting it emits an integer line for `Number(NAME) || 5`. `slot-guard:one-int` refuses two files. Deleting it emits the first file. `slot-guard:int-bound` refuses a floor of 2. Deleting it emits the ceiling anyway.

Seq 219 stays `NO_SLOTS: ENV_FIX`. At the parent of the first commit in that task, the name is a flag read in four source files (`backfill`, `host`, `tenmin-daily-liquid`, and `tenmin-history`). The sentence names three of them. The approved rule edits one file and one header. A line for one of the three would leave the others loose. Several files stay a refusal.

## Seq 220

Seq 220 stays `NO_SLOTS: MODIFY_LOGIC`. The two commits replace an open listing loop with a counter that stops at 1000 and throws a new error. No approved trigger parses a loop bound, and the body is not a comparison, a guard header, or an env read. Emitting a line no rule can run would only rename the failure. The family stays, and there is still no canonical line.

## Still `CLASSIFIER_UNSURE`

None of these get a new family. A cue that does not also fill an approved line would only rename the failure.

| seq | why it stays unsure |
|---|---|
| 6 | The change is one `.ts` import specifier in an existing test. The import rule can rewrite a specifier, and the scope gate refuses an existing test. A line the gate cannot accept is not a fill. |
| 8, 12, 17, 19, 22 | The sentence names a new planner or walk and does not give a signature, a file, or examples. Add-function, complex-function, and derive all require one of those. |
| 10, 13, 20, 24 | `cron`, `job`, or `workflow` appears with no path or snake_case token beside it. The context rule is what keeps those words from matching prose. The workflow rules also need a file the target has opted in, and `targets.json` is not edited. |
| 26 | "Add a stem test file" is not a characterization, regression, or value test, and it names no checks. |
| 214 | `tests.yml` is a new workflow file. The sentence does not say `job` or `workflow`, and the job rule appends to an existing opted-in file. |
| 217 | `fail closed` has no path or snake_case token within 96 characters. Dropping that context requirement matches the prose holes the family tests already refuse. |

## What this does not change

Candidate order is unchanged. Derive-wire is unchanged. The attempt cap stays 20. Held-out rows were not scored and were not opened.
