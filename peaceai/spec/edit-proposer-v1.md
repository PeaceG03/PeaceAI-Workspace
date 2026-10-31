# General edit proposer v1 (M152, repair-v1)

Status: draft for Auditor review (Builder, 2026-10-30). Stacked on loop v2 (#647). Code: `peaceai/lib/editpropose.ts`
(new), small hooks in `peaceai/lib/loop.ts`, `--proposer` in `peaceai/bin/loop.ts`. Tests:
`peaceai/test/m152-edit-proposer.test.ts`, `peaceai/test/m152-mutation.test.ts` (cases `m152-cases.ts`, fixtures
`m152-fixtures.ts`, mutant runner `m152-mutant-runner.ts`). `loopdeps.ts`, `selfpropose.ts` and the m146 / m151
guard lists are unchanged.

## What it does

Project-agnostic, deterministic, offline: no model, no network, no process, no file writes, no per-project or
per-task rules. One candidate edit per loop attempt; the loop applies it in a fresh copy and keeps it only if the
team's tests pass and the related tests do not regress (loop v2, unchanged).

1. Names: identifiers in the request's `code spans` (string literals inside a span are values and are skipped), then
   camelCase / PascalCase / snake_case / UPPER_CASE words; plus the same from the baseline's failing test names
   (node:test only; vitest / jest report counts, no names). Keywords and common globals are dropped. At most 8.
2. Locate (search tools, #635): `symbol` definitions, else `grep` for a method / property definition shape; never a
   test file or a generated file (dist/, build/, .d.ts, ...); plus same-file top-level functions the located
   definition calls (one level). At most 12 sites. Nothing located -> `NO_EDIT`.
3. Typed templates, in this fixed order (decided before any scorecard run): missing-export, nullish-check
   (`!x` / `if (x)` -> explicit null / undefined check, `||` -> `??`), comparison (`<`/`<=`, `>`/`>=`, `===`/`!==`,
   `==`/`!=`), arithmetic (`+`/`-`, `*`/`/`), off-by-one (an integer literal in a comparison, arithmetic, index or
   call +-1), logical (`&&`/`||`, drop one side of a condition), default-value (boolean / integer parameter and
   fallback defaults), null-guard (early return for a dereferenced parameter that is null / undefined),
   negate-condition, boolean-return. Candidates are ordered template, then site, then position; each must parse and
   change the file; duplicates are dropped; at most 60.
4. Feedback (codes and counts from the loop): after an attempt with TAMPERED or LEFTOVERS the proposer stops
   (`NO_MORE_EDITS`). Two earlier candidates that each raised the passing count above the baseline with no failure
   code other than TEST_FAIL are combined (non-overlapping) and proposed next; the combination is tested like any
   other candidate.

## Loop hooks (loop.ts)

- `Proposer.prepare?(search, { request, failing })`: called once per task after the baseline, on the copy reset to
  the pinned commit, so the search tools never see the team's test files the task is graded by
  (`// m152-guard:prepare-clean`; separate tag so the m146 guard list is unchanged). The proposer searches only here.
- If `prepare` throws, the task ends as `PROPOSER_FAILED` (a v2-only code; `// m152-guard:prepare-failed`). The
  error is caught without binding it, so no message text can reach the row. (Before, the loop's outer catch called
  this FETCH_FAILED.)
- (M164) The same holds for `next()`: every proposal is asked through one helper whose catch has no binding, and a
  throw at any attempt ends the task as `PROPOSER_FAILED` (`// m164-guard:next-failed`; attempts already run stay
  recorded). Before, a throwing `next()` also landed on the outer catch as FETCH_FAILED. Tests:
  `peaceai/test/m164-proposer-next.test.ts` (cases in `m164-loop-cases.ts`: a throw at attempt 1 and at attempt 2,
  no error text in the row, near misses that pass; static checks; mutants that drop the guard, map it to
  FETCH_FAILED or rethrow must each fail a case; the cases need the stage-2 candidate uid).
- (after #658, Auditor's note) A `next()` that returns no proposal at all (undefined, or any other non-object) also
  ends the task as `PROPOSER_FAILED` (`// m164-guard:next-empty`), at attempt 1 or a later one. Before, the
  `"refuse" in p` check threw a TypeError on it and the outer catch called it FETCH_FAILED. A malformed object (one
  with neither `refuse` nor `edits`) is not covered by this guard. Tests: the `next-empty` case in
  `m164-loop-cases.ts` (undefined at attempt 1 and at attempt 2; near miss: a `{ refuse: "NO_EDIT" }` proposal still
  ends NO_EDIT) and the mutants `drop-next-empty` and `empty-code-fetch-failed` in `m164-proposer-next.test.ts`.
- `loopSha256()` hashes lib/editpropose.ts as well as loop.ts, looprow.ts and loopdeps.ts, so every row binds the
  proposer version it ran with (`// m152-guard:sha-proposer`). Rows written before this change carry the older hash.
- `Feedback.tests` (the attempt's counts) and `ProposeInput.baseline`.
- `LoopOptions.makeProposer`: a fresh proposer per task in `runLoopFile`.
- `bin/loop.ts --proposer rules-v1|repair-v1` (default rules-v1, unchanged behavior).

## Guards

Single lines tagged `// guard:<id>` in editpropose.ts: span-strings, test-path, generated, changed, parse, cap,
dedupe, stop-unsafe, combine-improved; plus `loop-prepare-clean`, `loop-prepare-failed` and `loop-sha-proposer`
in loop.ts. m152-mutation deletes each and requires
a case to fail with an assertion; every guard has a refused near-miss case.

## Limits

- Single-site templates (plus one pairwise combination): changes that need new code (a new function, a new regex,
  a new branch) are out of reach.
- vitest / jest give counts only, so the failing-name evidence works for node:test only.
- Template order is fixed; it is not tuned on the scorecard tasks.
