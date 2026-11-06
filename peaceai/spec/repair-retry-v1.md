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
- Under oop-v1 they also carry `verdictMode: "oop-v1"` (M212). A repair-retry request refused as `RETRY_INPROC_REFUSED`
  still carries `repairRetry` but omits `verdictMode` (effective mode was inproc). See `verifier-v1.md` M212.

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
- **Coverage residual (M202; closed by M204).**
  - Up to Batch 39, verifier-v1 judged only the cases the extractor recognised; a file with other assertions was judged
    on the extracted subset.
  - Since M204 the extractor is fail-closed: a file is admitted only if every assertion is extracted, else it refuses
    by name (see verifier-v1.md, "M204"). The Batch 39 admit cases (percentage, midpoint index, first line) are still
    admitted and still pass/fail as before. The fit treats only value expectations as fittable (`negate` / `any`
    cases do not fit).
  - The skill is still NOT for credit.
- **Bound by loopSha256 (M204).** loopSha256 now covers repair-retry.ts and the verifier files. Its rows are marked
  `repairRetry` and never logged.

## Not done / residuals

- ~~The proposer never writes a helper.~~ Closed by M208 (below): it writes one bounded private helper when an ordered
  pair of pinned transforms fits and no single one does. Helpers for other kinds of shared logic are still not written.
- Transforms wrap returned values only. Wrong constants and a bounded class of wrong branches are closed by M209
  (below). Wrong literal arguments to a same-file select helper are closed by M210 (below).
- Dev split (informational, no credit, no tuning):
  - Under oop-v1, 11 of the 12 public dev tasks' team tests yield no data-only cases: 7 OOP_CASES_EMPTY and 4
    OOP_CASES_NONLITERAL. repair-retry-v1 would refuse VERDICT_OOP_CASES at the baseline, before any attempt.
  - unjs/destr yielded 1 literal case under the Batch 39 extractor (its other assertions were skipped). Under M204 it
    refuses (`OOP_CASES_UNSUPPORTED_TEST:stmt:var`); all 13 dev files now refuse.
  - The module hint is a directory (`../src`). It was not run.
- Default unchanged on the dev split (public tasks-public-v1, 12 tasks, informational): plan-only-v4 mean devScore
  0.764, runTests 0.833 (same before and after this change); plan-only-v5 mean devScore 0.764, runTests 0.833. The
  plan-only-v4 run's 12 records are appended to runs.jsonl (add-only, M144); the v5 run's records were not kept.
- Controls in m203: on each admit shape, repair-v2 alone with the same 3 attempts does not pass, in the default mode or
  under oop-v1. The admit pass is the retry fit, judged by its own run.

## M208 (batch 44): a bounded private helper

Code: `fitPair`, `freshHelperName`, `applyHelper` in `peaceai/lib/repair-retry.ts`. Tests: `peaceai/test/m208-retry-helper.test.ts`.

- **When.** For an attempt k >= 2, on ONE run's evidence (same order as before: the last attempt's own run, else the
  baseline), only when `fitTransform` refuses `no-fit`. `fitPair` then looks for an ordered pair of two different
  pinned transforms of the same kind (number / string / boolean), first t1 then t2, that maps EVERY case of that run on
  the function to its expected value, with the same rules as the single fit (one run, at least one failing case, no
  error, failing cases on one function, value expectations only). A single fit always wins (`single-fits`).
- **What.** `applyHelper` routes every value the function returns (its own returns only) through ONE added top-level
  `function rrShared(v: T): T { return t2(t1(v)); }`, placed right after the function. The name is the first of
  `rrShared`, `rrShared2`, ... that no word of the file already uses, so it shadows nothing, top-level or inner.
- **Bound.** The edit is offered only if `retrySourceClass` admits it as `rr-helper` (the frozen rr-in-function-v1
  class: one file, one function body changed with its head unchanged, one helper with no modifier, at most 600 added
  characters, no new dangerous word or global write, no foreign word). Otherwise nothing is offered and the base
  proposer is asked, as before.
- **Class fixes (still rr-in-function-v1, narrower or equal, never wider):**
  - `class-helper-pick`: with the helper right after the changed function, either statement could be read as the
    added one. The added one is now the function declaration with a NEW top-level name. Before, a helper after the
    function was misread and refused (`rr-helper-modifier`), which is why no helper could ever be admitted there.
  - `class-helper-shadow`: a helper whose name is any word of the original file (a parameter, an inner local, a method
    name) is refused `rr-helper-shadow`. Before, only top-level names were refused.
- Unchanged: oop-v1 only (`RETRY_INPROC_REFUSED` otherwise), `RETRY_MAX_ATTEMPTS = 3`, credit only from the attempt's own
  verifier-v1 verdict written by the verifier uid (`retryCreditProblem`), EDIT_SCOPE_POLICY and the default mode.

### Evidence (m208)

- Two self-made fixtures (a tag key, a region code; nothing from PeaceSTOCKS, the dev tasks, the scanner or reference
  diffs): attempt 1 (repair-v2) fails, no single transform fits, attempt 2 adds the helper (trim+lower, trim+upper) and
  passes on its own oop-v1 verdict. Controls: repair-v2 alone with 3 attempts ends ATTEMPT_LIMIT in the default mode
  and under oop-v1.
- Refused end to end as EDIT_SCOPE before the attempt runs: a helper over the 600-character bound, an exported helper,
  a helper in another (new) file, a helper shadowing a name of the file. The cap: a helper fix offered at attempt 4 when
  10 are asked never runs (ATTEMPT_LIMIT at 3).
- Each `m208-guard` line has a case of its own that fails on a mutant with that line deleted.

### Soundness note (M208)

- The helper is a search output, not evidence. Whether it is right is decided only by the attempt's own verifier-v1
  verdict (verifier uid, out of process). The pair fit predicts from one run's literal cases and can be wrong elsewhere.
- The helper cannot widen what an edit may do: it is code inside the same frozen class (no modifier, no export, no new
  dangerous word, no global write, the size bound), and the class change only narrows it (shadowing) or reads the
  existing rule correctly (pick). The gate is defence in depth. The verdict's soundness is verifier-v1's (M202, M207).
- Residuals closed by M209 (below) for constants and guarded branches; argument fixes and other shared-logic helpers
  are still not synthesised. A pair is tried only when no single transform and no constant fits; still EXPERIMENTAL,
  opt-in, not the default and not for credit.

## M209 (batch 45): constant and guarded-branch fixes

Code: `fitConstant`, `applyConstant`, `fitBranch`, `applyBranch`, `litText`, `literalsInFn` in
`peaceai/lib/repair-retry.ts`. Tests: `peaceai/test/m209-retry-forms.test.ts`.

- **When.** For an attempt k >= 2, on ONE run's evidence (same order as before: the last attempt's own run, else the
  baseline), only when `fitTransform` refuses `no-fit`. The proposer then tries, in this pinned order:
  1. **constant (M209):** `fitConstant` — every failing case of the function returned the same number/string V and
     expects the same W ≠ V; no passing case expects V; the function body contains a number/string literal equal to V.
  2. **pair / helper (M208):** `fitPair` / `applyHelper` as before.
  3. **guarded branch (M209):** `fitBranch` — the cases split into exactly two groups of at least two cases each by one
     predicate on a single parameter, and each group fits one transform (pinned transforms, plus identity for an
     already-correct group). A one-case side is refused (it would only memorise that input). Predicates, per parameter
     left-to-right: `typeof p === <type observed on that arg in the cases>`; then `p === lit` / `p < lit` / `p > lit`
     for a literal taken from that argument in the cases.
- **What.**
  - Constant: replace every number/string literal equal to V inside the function's own body with the literal form of W.
  - Branch: wrap every value the function returns (its own returns only) as `(pred ? tThen(e) : tElse(e))`.
- **Bound.** Offered only if `retrySourceClass` admits the edit as `rr-in-function` (the frozen rr-in-function-v1 class;
  no new edit-class, EDIT_SCOPE_POLICY unchanged). Over the size bound, a foreign new word, a two-literal failure, a
  three-way typeof split, a predicate on two arguments, or a predicate literal not present in the cases: refused, and
  the next form in the order is tried (or the base proposer).
- Unchanged: oop-v1 only, `RETRY_MAX_ATTEMPTS = 3`, credit only from the attempt's own verifier-v1 verdict written by the
  verifier uid, EDIT_SCOPE_POLICY and the default mode.

### Evidence (m209)

- Two self-made fixtures per form (nothing from PeaceSTOCKS, the dev tasks, the scanner or reference diffs):
  - constant: a default port (`8080` -> `3000`) and a blank mark (`"?"` -> `""`); attempt 1 (repair-v2) fails, no single
    transform fits, attempt 2 applies the one-literal edit and passes on its own oop-v1 verdict. Controls: repair-v2
    alone with 3 attempts ends without PASS in the default mode and under oop-v1.
  - branch: a tidy value (`typeof` string trim vs number floor) and a band number (a comparison / equality split with
    ceil vs floor); same attempt pattern; only the branch form is offered.
- Refused near misses: two literals wrong; a three-way typeof split; a predicate that would need two arguments; a
  predicate literal not present in the cases; an edit over the size bound (EDIT_SCOPE end to end).
- Each `m209-guard` line has a case of its own that fails on a mutant with that line deleted.

### Soundness note (M209)

- The constant and the branch are search outputs, not evidence. Whether either is right is decided only by the attempt's
  own verifier-v1 verdict (verifier uid, out of process). Fitting the visible cases of one run is not generalisation: a
  constant or a predicate that matches those cases can still be wrong on inputs the cases do not cover. The feature stays
  EXPERIMENTAL, opt-in, not the default and not for credit.
- Neither form widens what an edit may do: both stay inside the frozen rr-in-function-v1 class (one file, one function
  body, head unchanged, size bound, no new dangerous word, no global write, no foreign word). No new edit-class tag. The
  gate is defence in depth. The verdict's soundness is verifier-v1's (M202, M207).
- Order is pinned and documented (single, constant, pair, branch); attempts never chain past the cap of 3.
- Residuals closed by M210 (below) for wrong literal arguments to a same-file select helper, and in part by M211 for
  catalog-transform projection helpers; arbitrary non-select bodies, non-literal wrong args, and other shared-logic
  helpers are still not synthesised; string constant replacements that introduce a new word are refused by the class
  (so only word-free replacements, or words already in the file, admit); still EXPERIMENTAL, opt-in, not the default and
  not for credit.

## M210 (batch 46): wrong-argument call-site fix

Code: `selectHelpers`, `wrongArgCalls`, `fitWrongArg`, `applyWrongArg` in `peaceai/lib/repair-retry.ts`. Tests:
`peaceai/test/m210-retry-arg.test.ts`.

- **When.** For an attempt k >= 2, on ONE run's evidence (same order as before: the last attempt's own run, else the
  baseline), only when every earlier form refuses (`fitTransform` / `fitConstant` / `fitPair` / `fitBranch`). The
  proposer then tries **wrong-arg (M210):** `fitWrongArg`.
- **What counts as a select helper.** A top-level same-file `function h(...)` (export allowed; no other modifier, no
  generator) whose body is exactly one `return <one of its parameters>` (optionally parenthesised). No other statements.
  The model predicts a call's return as the value passed at that parameter position, without running code.
- **What.** Inside the changed function's own body, a call to such a helper whose argument at the returned position is a
  number / string / boolean literal L. Replace that literal with one of the outer function's own parameter identifiers
  so that, for EVERY case of the run on that function, the predicted return equals the expected value; and under the
  current call the predicted return already matches what each case returned (the select model agrees with the evidence).
  The edit must change at least one case's prediction.
- **Bound.** Offered only if `retrySourceClass` admits the edit as `rr-in-function` (frozen rr-in-function-v1; no new
  edit-class, EDIT_SCOPE_POLICY unchanged). The replacement is a parameter name already in the function head, so it
  does not invent string words (Batch 45's refuse of new-word string constants stands). A non-select helper, a helper
  with another modifier, a call with no literal at the returned position, a stale span, a model that disagrees with the
  evidence, or an edit the class would refuse: nothing is offered.
- **Why last.** Earlier forms only wrap returned values, replace a return-equal literal, or add a pair-helper. Wrong-arg
  rewrites a call argument under an identity/select-helper assumption (a stronger structural claim), so it is tried only
  when those refuse.
- Unchanged: oop-v1 only, `RETRY_MAX_ATTEMPTS = 3`, credit only from the attempt's own verifier-v1 verdict written by the
  verifier uid, EDIT_SCOPE_POLICY and the default mode.

### Evidence (m210)

- Two self-made fixtures (nothing from PeaceSTOCKS, the dev tasks, the scanner or reference diffs): a numeric `take` /
  `prefer` select (literal `0` should have been the outer parameter) and a string `head` / `label` select (literal `"?"`
  should have been the outer parameter). Attempt 1 (repair-v2) fails; no earlier form fits; attempt 2 replaces the
  call-site literal with the parameter and passes on its own oop-v1 verdict. Controls: repair-v2 alone with 3 attempts
  ends without PASS in the default mode and under oop-v1.
- Refused near misses: a non-select helper (body is not `return <param>`); a helper with a non-export modifier; no
  call-site literal at the returned position; evidence the select model disagrees with; a foreign / stale span; a
  replacement that would introduce a new word (class refuse).
- Each `m210-guard` line has a case of its own that fails on a mutant with that line deleted.

### Soundness note (M210)

- The call-site edit is a search output, not evidence. Whether it is right is decided only by the attempt's own
  verifier-v1 verdict (verifier uid, out of process). The select-helper model is a syntactic restriction used only to
  predict from literal evidence without running the candidate; a helper that is not a pure select is refused, and a
  model that disagrees with the observed returns is refused. Fitting the visible cases of one run is not generalisation.
- The form does not widen what an edit may do: it stays inside the frozen rr-in-function-v1 class (one file, one function
  body, head unchanged, size bound, no new dangerous word, no global write, no foreign word). No new edit-class tag. The
  gate is defence in depth. The verdict's soundness is verifier-v1's (M202, M207).
- Order is pinned and documented (single, constant, pair, branch, wrong-arg); attempts never chain past the cap of 3.
- Residuals closed in part by M211 (below) for non-select callees whose body is exactly one closed-catalog unary
  transform of a parameter; wrong arguments that are not literals, arbitrary non-select bodies, and other shared-logic
  helpers are still not synthesised; string constant replacements that introduce a new word are still refused by the
  class; still EXPERIMENTAL, opt-in, not the default and not for credit.

## M211 (batch 47): wrong-argument for catalog-transform helpers

Code: `argHelpers`, `matchParamTransform` / `catalogTransform`, `predictArg` (generalising M210's select prediction) in
`peaceai/lib/repair-retry.ts`. Tests: `peaceai/test/m211-retry-argxform.test.ts`.

- **When.** Same slot as M210: attempt k >= 2, one run's evidence, only after single / constant / pair / branch refuse.
  `fitWrongArg` now also admits calls to a same-file **projection helper** whose body is exactly one closed-catalog
  unary transform of a parameter (not only `return <param>`).
- **What counts as a projection helper.** A top-level same-file `function h(...)` (export allowed; no other modifier, no
  generator) whose body is exactly one `return` of either (a) one of its parameters (M210 select / identity), or (b) a
  RETRY_TRANSFORMS wrap of one parameter: `Math.round|floor|ceil|trunc(param)`, `(param).trim|toLowerCase|toUpperCase()`,
  or `!(param)`. No other statements, no other callees, no free identifiers. The model predicts a call's return by
  applying that transform's pure `f` to the value at that parameter position, without running candidate code.
- **What.** Same call-site edit as M210: replace the returned-position number/string/boolean literal with one of the
  outer function's own parameters so every case of the run fits, the current call's prediction matches the observed
  returns, and at least one case's prediction changes. Bound still `rr-in-function` (no EDIT_SCOPE_POLICY widen).
- **Why this and not arbitrary non-select.** An arbitrary helper body has no closed pure predictor: fitting it would
  require executing the candidate (forbidden for search) or inventing semantics. Non-literal wrong arguments are left
  residual (higher risk: the edit is no longer "evidence uniquely determines which literal to replace with a param").
  Arrow / const select forms were left residual in Batch 47 (declaration-form only; same model as M210) and are
  closed by M213 (below).
- Unchanged: oop-v1 only, cap 3, credit only from the attempt's own verifier-v1 verdict, order (single, constant, pair,
  branch, wrong-arg), default mode, EDIT_SCOPE_POLICY.

### Evidence (m211)

- Two self-made fixtures (nothing from PeaceSTOCKS, the dev tasks, the scanner or reference diffs): a numeric `scale` /
  `units` floor helper (literal `0` should have been the outer parameter) and a string `norm` / `key` lower helper
  (literal `"X"` should have been the outer parameter). Attempt 1 (repair-v2) fails; no earlier form fits; attempt 2
  replaces the call-site literal with the parameter and passes on its own oop-v1 verdict. Controls: repair-v2 alone
  with 3 attempts ends without PASS in the default mode and under oop-v1. M210 select fixtures still admit via the same
  path (regression).
- Refused near misses: an arbitrary non-select body (`return a + 1`, `Math.abs`, unknown callee); a helper with a
  non-export modifier; no literal at the returned position; evidence the projection model disagrees with; a foreign /
  stale span; a new-word class refuse; earlier form (constant) still wins over wrong-arg.
- Each `m211-guard` line has a case of its own that fails on a mutant with that line deleted.

### Soundness note (M211)

- The call-site edit is a search output, not evidence. Whether it is right is decided only by the attempt's own
  verifier-v1 verdict (verifier uid, out of process). The projection model is a syntactic restriction over the closed
  RETRY_TRANSFORMS catalog (plus identity) used only to predict from literal evidence without running the candidate; a
  helper whose body is not exactly one catalog wrap of a parameter is refused, and a model that disagrees with the
  observed returns is refused. Fitting the visible cases of one run is not generalisation.
- The form does not widen what an edit may do: it stays inside the frozen rr-in-function-v1 class. No new edit-class
  tag. The gate is defence in depth. The verdict's soundness is verifier-v1's (M202, M207).
- Order is pinned and documented (single, constant, pair, branch, wrong-arg); attempts never chain past the cap of 3.
- Residuals closed in part by M213 (below) for arrow/const/function-expression declaration forms of the same
  projection shape; wrong arguments that are not literals; arbitrary non-select helper bodies (no closed pure model);
  other shared-logic helpers; string constant replacements that introduce a new word (class refuse); still EXPERIMENTAL,
  opt-in, not the default and not for credit.

### Terminality (arbitrary non-select / non-literal)

- **Arbitrary non-select body:** without a closed pure predictor, the search cannot uniquely determine the call's
  return from arguments without executing candidate code. Execution is out of scope for the proposer (predictions are
  never a verdict; verifier-v1 alone runs the candidate). Therefore this residual is closed only for the catalog-
  transform subset above; the rest stays refused.
- **Non-literal wrong args:** replacing a non-literal argument is not "evidence uniquely determines the literal"; it
  needs a second model of the current expression. Left residual rather than widen.

## M213 (batch 49): wrong-argument for const/arrow/function-expression helpers

Code: `argHelpers` (via `matchArgHelper`) in `peaceai/lib/repair-retry.ts` now also admits top-level
`[export] const|let h = (p) => <expr>` (expression or single-return block body) and
`[export] const|let h = function (p) { return <expr>; }` whose `<expr>` is exactly a parameter or one closed-catalog
unary transform of a parameter. Tests: `peaceai/test/m213-retry-argdecl.test.ts`.

- **When.** Same slot as M210/M211: attempt k >= 2, one run's evidence, only after single / constant / pair / branch
  refuse. `fitWrongArg` already used `argHelpers`; M213 only widens which declaration forms `argHelpers` recognises.
- **What counts.** Same projection model as M211 (identity or RETRY_TRANSFORMS wrap of one parameter). New declaration
  forms: const/let arrow (expression body or single-return block) and const/let function expression. Export on the
  variable statement is allowed; any other statement modifier (`declare`, ...) is refused; async / other modifiers on
  the arrow or function expression are refused; generators are refused. Multi-statement block bodies stay refused.
- **What.** Same call-site edit as M210/M211: replace the returned-position number/string/boolean literal with one of
  the outer function's own parameters so every case of the run fits, the current call's prediction matches the observed
  returns, and at least one case's prediction changes. Bound still `rr-in-function` (no EDIT_SCOPE_POLICY widen).
- **Why this and not non-literal / arbitrary bodies.** Declaration form only: the predictor is unchanged. Non-literal
  wrong args and arbitrary non-select bodies keep the Batch 47 terminality (no closed pure model without executing the
  candidate; non-literal replacement is not uniquely determined by evidence).
- Unchanged: oop-v1 only, cap 3, credit only from the attempt's own verifier-v1 verdict, order (single, constant, pair,
  branch, wrong-arg), default mode, EDIT_SCOPE_POLICY. Function-declaration helpers (M210/M211) stay admitted.

### Evidence (m213)

- Two self-made fixtures (nothing from PeaceSTOCKS, the dev tasks, the scanner or reference diffs): a numeric `clip` /
  `bound` const-arrow ceil helper (literal `0` should have been the outer parameter) and a string `tidy` / `mark` const
  function-expression trim helper (literal `" "` should have been the outer parameter). Attempt 1 (repair-v2) fails; no
  earlier form fits; attempt 2 replaces the call-site literal with the parameter and passes on its own oop-v1 verdict.
  Controls: repair-v2 alone with 3 attempts ends without PASS in the default mode and under oop-v1. M210 select and
  M211 catalog function-declaration fixtures still admit via the same path (regression). A single-return block-body
  arrow also admits.
- Refused near misses: an async arrow; a multi-statement block body; a `declare` modifier on the const; evidence the
  projection model disagrees with; a foreign / stale span; a new-word class refuse; earlier form (constant) still wins
  over wrong-arg.
- Each `m213-guard` line has a case of its own that fails on a mutant with that line deleted.

### Soundness note (M213)

- The call-site edit is a search output, not evidence. Whether it is right is decided only by the attempt's own
  verifier-v1 verdict (verifier uid, out of process). The projection model is unchanged from M211; only the surface
  syntax that names a helper is widened. Fitting the visible cases of one run is not generalisation.
- The form does not widen what an edit may do: it stays inside the frozen rr-in-function-v1 class. No new edit-class
  tag. The gate is defence in depth. The verdict's soundness is verifier-v1's (M202, M207).
- Order is pinned and documented (single, constant, pair, branch, wrong-arg); attempts never chain past the cap of 3.
- Residuals: wrong arguments that are not literals; arbitrary non-select helper bodies (no closed pure model); other
  shared-logic helpers; string constant replacements that introduce a new word (class refuse); still EXPERIMENTAL,
  opt-in, not the default and not for credit.

### Terminality (unchanged from M211)

- **Arbitrary non-select body:** without a closed pure predictor, the search cannot uniquely determine the call's
  return from arguments without executing candidate code. Execution is out of scope for the proposer (predictions are
  never a verdict; verifier-v1 alone runs the candidate). Therefore this residual stays refused outside the catalog-
  transform subset.
- **Non-literal wrong args:** replacing a non-literal argument is not "evidence uniquely determines the literal"; it
  needs a second model of the current expression. Left residual rather than widen.
