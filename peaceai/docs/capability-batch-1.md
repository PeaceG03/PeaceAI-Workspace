# Capability batch 1 triage

Measured on main after #779. Builder-log box replay: 87 pass / 164 fail / 25 unmeasured. Practice dev test-as-spec: 3 pass / 37 fail / 7 unmeasured. Practice dev text: 0 / 39 / 8. This note records why. It does not claim a new pass. Held-out practice rows were not opened. `unjs/defu` is the dev repository that is not a key of `targets.json`; those rows stay `GATE_NO_TARGET`. `targets.json`, `gate.ts`, and `scope.ts` were not edited.

The attempt cap stays 20. `specgrade.ts` was not edited. A candidate that disagrees with the fix on a probed input stays `verified_test_only`.

## Classifier: `CLASSIFIER_UNSURE`

`guessFamily` returns a family only when exactly one kept cue has a code token within 96 characters (a path, a `*.yml` name, a call, a backticked name, or a snake_case token). Zero cues, or two cues, leave the family empty. `none` was never set, so a non-code sentence was `CLASSIFIER_UNSURE` rather than `NOT_CODE_FAMILY`. `MODIFY_LOGIC` (`fail closed`) is dropped in training because one dev sentence is an env fix that also says `fail closed` next to a snake_case name. After that drop, a real `fail closed` sentence cannot match it.

| seq | logged skill | cues | why the family stays empty |
|---|---|---|---|
| 6 | IMPORT_EDIT | bare `typecheck`, no code token | The import cue is the word `import`, which this sentence does not use. `typecheck` is not `typecheck:name` and has no path beside it, so `TSCONFIG_SCRIPT` does not fire. The sentence is a typecheck-failure slot fill. The measured route is still `CLASSIFIER_UNSURE`, so that fill did not return a line. The earlier slot note still applies: the diagnostic that does exist sits in a test file the scope gate refuses. |
| 8 | COMPLEX_FUNCTION | none | "Add a pure … planner" is not `add a pure function`, `complex function`, or `date function`, and it has no signature. |
| 10 | WORKFLOW_STEP | bare `cron`, no code token | `cron` is the workflow-step cue. The context rule is what keeps "cron" in prose from matching. There is no workflow path to fill, and `targets.json` is not edited. |
| 12 | COMPLEX_FUNCTION | none | Same shape as seq 8: a planner, not a function signature. |
| 13 | WORKFLOW_STEP | bare `job`, no code token | `job` would be `WORKFLOW_JOB`, and the logged skill is `WORKFLOW_STEP`. Dropping the context rule would mislabel it. |
| 17 | COMPLEX_FUNCTION | none | "Add the read-only … walk" names no function, file, or family cue. |
| 19 | COMPLEX_FUNCTION | none | "Add the open-ended backstop planner" names no function cue. |
| 20 | WORKFLOW_JOB | bare `workflow`, no code token | The word is the cue. No `*.yml` or snake_case token sits within 96 characters. |
| 22 | COMPLEX_FUNCTION | none | "Add the logging-only … plan" names no function cue. |
| 24 | WORKFLOW_JOB | bare `job` and `workflow`, no code token | Both words are present. Neither has a code token beside it, so neither fires. One file-less workflow sentence must not become two families. |
| 26 | TEST_CASE | none | "Add a stem test file" is not `regression test`, `value test`, or `characterization test`. The slot note already records that this sentence names no export and no checks. |
| 65 | OPS_ACTION | none | "Rebase … PR #6 onto main" is an operational sentence. No edit family matches, and `none` was never set, so it was `CLASSIFIER_UNSURE` instead of `NOT_CODE_FAMILY`. |
| 214 | WORKFLOW_JOB | none | `tests.yml` is a code token, but the sentence does not say `workflow` or `job`, and `typechecks` is not the word `typecheck`. The existing job rule appends to a workflow the target has opted in. This row adds a new file. `targets.json` is not edited. |
| 216 | ENV_FIX | `fail closed` with `ONEOFF_BUDGET_MS` beside it | That hit is `MODIFY_LOGIC`. Training drops the family because the logged skill is `ENV_FIX`. The env cue is `make env` / `environment variable`, and the sentence says `Make ONEOFF_BUDGET_MS strict`. The read is `Number(X) > 0 ? Number(X) : DEFAULT`. The trigger also needs `integer 1..N`. The sentence does not give that max, so a line is not invented. |
| 217 | MODIFY_LOGIC | bare `fail closed`, no code token | The words are the cue. No path or snake_case token is within 96 characters. The context rule stays, because "fail closed" in prose is the hole the tests already refuse. |
| 218 | ENV_FIX | none | `Make TENMIN_REDISPATCH_DRY_RUN strict` does not say `env`. The parent tree has one source file and every read is `=== "1"` or `!== "1"`, which is the flag shape the approved rule already edits. |
| 219 | ENV_FIX | none | Same `Make NAME strict` shape. The sentence names three sites. The rule edits one file. Zero or several files stay unfilled. |
| 220 | MODIFY_LOGIC | `fail closed` with the page-cap names beside it | The cue matches, and the family was dropped because of seq 216. With that sentence excluded from the cue, this row is `MODIFY_LOGIC`. There is still no canonical line for an existing loop, so the route is `NO_SLOTS`. |

## `NO_SLOTS: WORKFLOW_JOB` (15, 215)

Seq 15 has `chain_followup` beside `job`. Seq 215 has `scanner-alert-test.yml` beside `job`. The family is already right. `canonicalRequest` has no workflow line. The job rule appends to a workflow `targets.json` opts in. That file is not edited here. These two rows stay `NO_SLOTS`.

## `NO_CANDIDATE` wire_trigger (228, 243, 246, 255)

The asked text and the cited issue are characterization tasks (`add a characterization test for …`). `adoptIssueBody` accepts each issue: one header, the logged symbol and file, and checks that name the symbol. `parseWireTask` returns `wire_trigger` when the objective does not contain exactly one `handle a failing call` header. That is the no-match reason, and it sorts ahead of `task_unparsed`. It is not evidence the task is a wire edit. Extending derive-wire to these four rows would teach a wire rule a characterization sentence. That is not general. No derive-wire change is in this batch.

## Practice dev test-as-spec

`GATE_NO_TARGET` (7) is `unjs/defu`. Scoring it would edit `targets.json` or the gate. Those files were not edited.

The other 40 dev rows are PeaceSTOCKS (20) and sindresorhus/is (20). PeaceSTOCKS contributes the strict passes, the `verified_test_only` rows, `CANT_DO_YET_NO_BODY`, and `CANT_DO_YET_ASSERTION_UNREDUCIBLE`. The is rows are existing-module edits. Their recorded diff is not a repair-v2 template, so reordering the 60 candidates cannot put that diff inside the 20. The 11 `CANT_DO_YET_CAP` rows are that case: twenty templates fail the test, and `next()` still has another template that is also not the recorded edit.

### What blocks strictness

A new missing module is scaffolded from the recorded calls. The grade then compares that function with the fix. These are the PeaceSTOCKS new-file rows (fix sha prefix):

| fix | scaffold | why it is or is not strict |
|---|---|---|
| 102f6274 | `"R2_REQUEST_FAILED:" + a + ":" + b` | Same concatenation as the fix. No comparison. A passing test can already be strict. |
| fdeb70f5 | `"MARKETS_SCHEDULER_HOST_FAILED:" + a + ":cause=" + b` | Same concatenation. |
| 0bf45cbf | `a + ": OK"` | Same concatenation. |
| 1266028f | `"SCAN_STAGE:" + a + ":" + b + ":" + c + "ms"` | The fix writes `("" + ms) + "ms"`. On the primitives the probes use, both concatenate. |
| ba2b2a3d | `a <= 2` | The fix is the same comparison. The literal bound is probed. |
| d881bef1 | `a === b` | Same comparison of the two parameters. `comparisonBounds` marks a non-literal equality `unprobed`, so the grade stays `verified_test_only` even when every probed call agrees. That flag lives in `specgrade.ts`, which this batch does not edit. |
| d3664892 | `a.split("/")[0]` | The fix adds `?? ""`. `split` is an unresolved binding, so the grade stays `verified_test_only`. The two agree on every string, because `split` always returns an element. Loosening `split` is out of scope. |
| fb0d4317 | filter `item.category === b`, then sum `size` | Same reduction. `item.category === b` is not a literal bound, so the file is `unprobed`. |
| e3a894b6 | `a > 5` | The fix is `6 <= reRuns`. They disagree on the adjacent float. The open form stays. |
| 08046b87 | `a > 2` | The fix is `3 <= failedDaysInARow`. Same open-versus-closed disagreement. |
| f6b9bfaa | `a && !b && c` | The fix is `a && b && !c`. The recorded calls can agree. Another triple does not. |
| 3a8d6f7c | `a && b` | Same expression as the fix. No comparison, so the unprobed flag does not apply. |
| 242d8a7c | `a && !b` | Same expression as the fix. |
| 9f74e54d | `item.done === false` | The fix is `!x.done`. They disagree when `done` is not a boolean. |
| 6e7a7466 | `item.complete === false` | The fix is `!x.complete`. Same disagreement. |
| ac3a1ccd | `item.attention === true` | The fix is `x.attention`. `1` is not `true`. |
| 16b8687d | `item.silent === true` | The fix is `x.silent`. Same disagreement. |
| 730a3b8e | none | `counts.some((x) => 1 <= x)` is not one of the emitted bodies. `CANT_DO_YET_NO_BODY`. A number-array `some` stays unemitted. |

The two PeaceSTOCKS edits of an existing client (`c617e634`, `7ecaaba3`) assert through `settle(() => new Client(...).get(...))`. That call is not a direct call of an imported function, so no expectation is reduced. They are the `CANT_DO_YET_ASSERTION_UNREDUCIBLE` rows. They are characterization-shaped wire tests, not a missing wire grammar.

The 14 `verified_test_only` rows are the scaffolds in this table that are not the three strict passes and not `NO_BODY`. Rows whose scaffold disagrees with the fix on a float, a swapped argument, or `=== false` versus `!` stay test-only. Rows marked unprobed stay test-only because that flag is in `specgrade.ts`. This batch did not re-run the practice sandbox: bubblewrap is not installed here, and the pinned core archive is not in the tree. Promoting a disagreement would call an overfit strict. This batch does not.

### What puts the right candidate past 20

sindresorhus/is dev rows edit `source/index.ts` (and sometimes a sibling). The repair list was built for each row. The recorded source text is not one of the 60 candidates. The shapes are:

| fix | recorded edit | why rank cannot help |
|---|---|---|
| cb4ee0e9 | numeric-enum `Object.entries` filter | Not a one-token template. |
| 54fc0940 | new predicates `negativeInteger`, `nonNegativeInteger`, `arrayOf`, `oneOf` | A new function is not `missing-export`. |
| 63be5c0c | new predicates `finiteNumber`, `nonNegativeNumber`, `positiveInteger` | Same. |
| ac46b540 | throw `TypeError` when a range contains `NaN` | No template inserts that throw. |
| 47415dc4 | `&& value === value.trim()` | The trim candidate was removed because it copied one library. It is not reintroduced. |
| 3b40955b | `&& !isFunction(value) && !isArray(value)` on two predicates | Not the plain-object `Array.isArray` template. |
| 9bdcd9b5 | predicate-factory mode on `is.any` / `is.all` | New control flow, not a template. |
| e7c84fcb | `/^class(\s+\|{)/` replaced `startsWith('class ')` | A regex rewrite is not a template. |
| 1f2440ae | new `is.optional` | A new function. |
| ef35cc35 | `tagType !== 'Object'` and a moved `keysOf` | Two files, not one template site. |
| bcec30d7 | rename `domElement` to `htmlElement` | A rename is not a template. |
| 85c89925 | assertion messages via `Intl.ListFormat` | Not a template. |
| 5044c912 | named exports, a thousand-line move | Not a template. |
| 1284da08 | new `positiveNumber` / `negativeNumber` | A new function. |
| e503a9ec | new `weakRef` | A new function. |
| c68ad760 | `UrlString` brand on an existing predicate | A type change. The repair list does not edit types. |
| c408f5a2 | `Number.isNaN(value) ? 'NaN' : 'number'` | Not a comparison-operator swap. |
| 5b7ea154 | new `blob` | A new function. |
| 23cf074a | new `nonEmptyStringAndNotWhitespace` | A new function. |
| a5b4017d | new `enumCase` | A new function. |

Eleven of these exhaust the 20 attempts with templates still left. The right edit is not waiting at position 21. It was never proposed. Changing template order would only change which non-fix is tried first. That can turn a later overfit into the candidate the test accepts. This batch does not reorder.

`CANT_DO_YET_AVA_EARLY_EXIT` (5) is still a worker stop, including `TS2339`, with no result for the target test. The line does not say whether the test or the declaration should change. No early-exit change is in this batch.

## Text mode

Text dev is 21 `CANT_DO_YET_NO_EDIT`, 7 `ADD_UNSPECIFIED`, 7 `TEST_STILL_FAILS`, 2 `VERIFIED_TEST_ONLY`, and one each of `NAME_SHAPE`, `NOT_A_FAMILY`, plus 7 `GATE_NO_TARGET` and 1 `TIMEOUT` unmeasured. A subject that says a candidate was chosen in review names no edit. `Add name` without the behavior stays unspecified. Text mode has no path back to `verified_strict`. This batch does not add one.
