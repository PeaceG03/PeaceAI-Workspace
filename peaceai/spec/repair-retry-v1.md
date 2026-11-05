# repair-retry-v1 (M203, batch 39) - EXPERIMENTAL, opt-in, NOT the default, NOT for credit

Code: `peaceai/lib/repair-retry.ts`, wired in `peaceai/lib/loop.ts` (`runLoopTask` option `repairRetry`), row codes in
`peaceai/lib/looprow.ts`, per-case evidence in `peaceai/lib/verifier.ts` (`CaseResult.got`). Tests:
`peaceai/test/m203-repair-retry.test.ts`.

## What it does

When the loop's first edit attempt fails verification, a later attempt may be proposed from the failure evidence of ONE
verifier-v1 run and retried:

- Attempt 1 is the base proposer, unchanged (for example repair-v2). The wrapper `retryProposer(base)` passes it through.
- For attempt k >= 2, the wrapper first looks at the last attempt's own run. That evidence is applied to that
  attempt's code. If it does not fit, the wrapper looks at the baseline run, applied to the original code.
  - A run's evidence is, per case: id, function, literal args, expected value, pass, and for a failing case the value it
    returned or its error name. All of it comes from verifier-v1, and every case is tagged with the run's label.
  - The wrapper looks for an output transform from the pinned list (`RETRY_TRANSFORMS`, in this order: Math.round,
    floor, ceil, trunc, .trim(), .toLowerCase(), .toUpperCase(), boolean negation).
  - A transform fits only if it maps EVERY case of that one run on the function to its expected value. For a failing
    case it is applied to what the case returned; for a passing case, to its expected value, which it returned.
  - A fit needs at least one failing case and no error case, and every failing case must be on the same function.
  - The edit wraps every value that function returns (its own `return`s, not a nested function's).
- If nothing fits, or the edit was already tried, the wrapper asks the base proposer again. The base sees only its own
  attempts, renumbered 1..n, exactly as if it ran alone (its repair-v2 compositions continue).
- After a TAMPERED or LEFTOVERS run, the proposer stops (NO_MORE_EDITS).
- The cap is `RETRY_MAX_ATTEMPTS = 3` attempts in all, whatever `maxAttempts` asks for.
- The edits come from PeaceAI's own mechanisms: repair-v2, plus a general fit over the pinned transforms. Nothing is
  written per task.

## Where it is allowed

- Only under `verdictMode: "oop-v1"`. Any other mode, including the default `inproc`, ends the task with
  `RETRY_INPROC_REFUSED` before anything runs (attempts 0). The M199-M201 terminal decisions stand.
- Only through `runLoopTask` options. `runLoopFile` never sets it, so no committed loop log row is produced by it.
- Its rows carry `repairRetry: "repair-retry-v1"` and proposer `rr1-<base>`, so they never read as the default's.

## The opt-in edit class: RETRY_SCOPE_POLICY `rr-in-function-v1` (pinned, frozen)

EDIT_SCOPE_POLICY, INPROC_BOUNDED_SCOPE and the default verdict mode are unchanged. Attempt 1 is still gated by the M175
`editScopeProblem` with EDIT_SCOPE_POLICY. An attempt k >= 2 under repair-retry-v1 is gated by `retryScopeProblem`
instead, and is refused as `EDIT_SCOPE` before anything runs, unless all of the following hold:

1. At most one file the loop does not own changes. Edits outside the copy and team-test edits are left to applyEdits
   (EDIT_OUTSIDE_COPY / TEAM_TEST_EDIT), as in M175.
2. M175's `editClass` runs first.
   - Its file-kind refusals stand: test-file, lockfile, runner-infra, config (including .js), new-file.
   - Its admitted classes (export-keyword, in-body) stay admitted.
3. Any other M175 refusal is judged by `retrySourceClass(orig, next)`, which admits `rr-in-function` / `rr-helper`
   only when:
   - both texts parse;
   - next adds at most 600 characters;
   - every top-level statement is text-identical to the original except exactly one top-level function, which must
     keep its head unchanged and change only its body:
     - the function is `function f(...) {}`, or a `const f =` arrow or function expression, exported or not;
     - the head is all the text before the body: export, modifiers, name, parameters and return type;
   - optionally there is exactly one added top-level `function` declaration (the helper):
     - it has a body, a name the original's top level does not declare, and no modifier at all;
     - so it is never exported, async, declared or a generator, and never decorated;
   - no EDIT_DANGEROUS word appears more often than in the original. This is the same list and the same count as
     M175 (globalThis, require, process, Object.defineProperty, Symbol, ...), with comments and strings counted;
   - no more global writes than the original (M175 `editGlobalWrites`: an assignment, ++ / -- or delete rooted at a
     name the file never declares, e.g. `Object.is = ...`);
   - every word of next's code that the original lacks is one of these:
     - in EDIT_NEW_WORDS (M175);
     - in RETRY_NEW_WORDS (const let else for of while break continue function number string boolean Math round
       floor ceil trunc abs min max trim);
     - a name declared inside the changed function or the helper, used only as a plain name. Such a name is never
       a property name or a key, and never text inside a string, template or regex.

So the class is wider than M175 in exactly two ways: new local names and the pinned Math / trim / keyword words, and
one private helper. It is narrower in one: one function (and one file) per attempt.

## Credit: each attempt on its own verdict

- Every team run under oop-v1 is labelled. The baseline is `baseline`; attempt k is `attempt-k:<sha256 of exactly its
  edits>`. The label is stamped on the run's verdict and on every case result and evidence case.
- A repair-retry-v1 PASS needs `retryCreditProblem(verdict, attempt, edits) === null`. That means:
  - mode oop-v1, code OOP_OK, at least one case, no failure, and every result passing (otherwise RETRY_NO_VERDICT);
  - every result from the verdict's own run (otherwise RETRY_EVIDENCE_COMBINED);
  - the run being this attempt's own label (otherwise RETRY_VERDICT_FOREIGN).
- Evidence is never combined. The proposer reads one run at a time, and `evidenceProblem` / `fitTransform` refuse
  cases carrying another run's label or a case id twice.
- A prediction ("this transform fits") is never credit. Only the next attempt's own verifier-v1 run is.

## Soundness note

- **Verdict.** The verdict is verifier-v1's (M202). The candidate uid runs the fixed harness, one process per case.
  This process compares the returned JSON with primordials captured at load. Nothing the edit does in the candidate
  process can change the comparison.
  - H-Object.is offered as an attempt-2 edit is refused by the gate (global-write). In a mutant without the gate line
    (m203-guard:loop-gate), it reaches verifier-v1 and still fails (TEST_FAIL).
  - X-exit is refused by the gate (dangerous:process). Without the gate, verifier-v1 refuses the protocol
    (VERDICT_OOP_REFUSED). Neither is credited.
- **The gate is defence in depth.** It is not what makes the verdict sound. It also keeps the experiment's edits small
  and reviewable.
- **The cap.** It bounds how many verdicts one task can ask for.
- **Search, not proof.** The fit uses only one run's literal evidence, so a fitted transform can still be wrong on
  inputs the cases do not cover. The verdict, not the fit, is what decides. This is a search heuristic, not a proof.
- **Coverage residual (M202, inherited).**
  - verifier-v1 judges only the cases `extractCasesFromSource` extracts. It extracts `assert.equal` / `strictEqual` /
    `deepEqual` / `deepStrictEqual` and `expect(..).toBe` / `.toEqual`.
  - A test file whose other assertions use matchers it does not recognise is judged on the extracted subset only.
    Examples are `toStrictEqual`, `toMatchObject` and `toThrow` written as `expect(f(x)).toStrictEqual(y)`.
  - This matters to any oop-v1 pass, retry or not. It is one more reason the skill is NOT for credit.
- **Not bound by loopSha256.** loopSha256 does not cover repair-retry.ts. Its rows are marked `repairRetry` and never
  logged.

## Not done / residuals

- The proposer never writes a helper. The class admits one, as an opt-in for a later proposer, and it is tested only by
  pure class cases.
- Transforms wrap returned values only. Wrong arguments, wrong branches or constants are left to repair-v2.
- Dev split (informational, no credit, no tuning):
  - Under oop-v1, 11 of the 12 public dev tasks' team tests yield no data-only cases: 7 OOP_CASES_EMPTY and 4
    OOP_CASES_NONLITERAL. repair-retry-v1 would refuse VERDICT_OOP_CASES at the baseline, before any attempt.
  - unjs/destr yields 1 literal case. Its other assertions are `toStrictEqual`, which the extractor skips; see the
    coverage residual.
  - The module hint is a directory (`../src`). It was not run.
- Default unchanged on the dev split (public tasks-public-v1, 12 tasks, informational): plan-only-v4 mean devScore
  0.764, runTests 0.833 (same before and after this change); plan-only-v5 mean devScore 0.764, runTests 0.833. The run
  records were not committed to runs.jsonl.
- Controls in m203: on each admit shape, repair-v2 alone with the same 3 attempts does not pass, in the default mode or
  under oop-v1. The admit pass is the retry fit, judged by its own run.
