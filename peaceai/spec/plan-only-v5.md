# PLAN-ONLY mode v5 (planner `plan-only-v5`): diagnose from failure codes (M194)

Status: EXPERIMENTAL (Builder, 2026-11-04, Batch 27). v4 stays the DEFAULT and is byte-identical (plannerSha256
b667d518...). v5 is NOT registered in `lib/plandefault.ts` (`selectPlanner("v5")` stays refused) until it is scored;
it runs via `peaceai/bin/plan-only-v5.ts run <taskfile>` or `planTaskV5` directly. No v1-v4 file, grader, loop or
protected file is changed; `selfpropose.ts` is untouched.

Files: `peaceai/lib/plan5.ts` (planner: imports v4 and adds one family), `peaceai/lib/plan5run.ts` (runner: plan4run.ts
with the v5 renames), `peaceai/bin/plan-only-v5.ts` (CLI). `plannerSha256V5` = sha256 over `lib/plan4.ts`,
`lib/plan5.ts`, `lib/plangrade.ts`, `lib/plan5run.ts` in that order (v4's planner is part of v5, so it is in v5's digest).

## Why (the gap)

The first plan-only run on a real failing job (a Peace project's scheduled job, Batch 24 scratch run, unlocked and
ungraded) got a request of the shape "the scheduled job fails; runs end with CODE_A (timeout) and CODE_B:detail, then a
later check reports CODE_C". v4 parsed `unsure:NO_FAMILY`, located only the name it could find as a definition (a
downstream check's report constant, CODE_C) and planned `edit-constant` there. The real causes were the sites that
THROW CODE_A and CODE_B. v4 has no family for "a job fails with code X": it reads codes only as code names, so a symptom
constant that is defined by name beats the origin that is only a string in a `throw`. This is a general gap (any
error-code / failure-log report), not a property of that project. No code, fixture, request wording or reference diff
of that project (or of any task set) was used to build or test M194; Batch 28 re-runs the plan-only comparison.

## The family (M194), one tagged line per condition

Admit (all of):
- `diag-failure-report`: the request reports a failure (fails / error / throws / crash / aborted / rejected / timed out /
  ends|exits|stops|dies with ...). Otherwise `NO_FAILURE_REPORT`.
- `diag-code-shape`: it states error codes: CONSTANT_CASE with at least one underscore, length >= 5, in order, at most 8.
  `CODE:detail` keeps the detail, and the detail is never a code of its own. Otherwise `NO_CODES`.
- `diag-needs-site`: at least one stated code has a throwing site (below). Otherwise `NO_THROW_SITE`.

A throwing site of CODE is, in a shipped source file only (`diag-source-only`: `isSourceFile`, so no tests, fixtures,
examples, docs, scripts, generated files), a string or template literal holding CODE as a whole token, or a
CONSTANT_CASE name bound to exactly CODE (`diag-alias`: a const, object property, class property or enum member whose
value is CODE; lower-case names never alias, so `{ code: "X" }` does not make every `code` an alias), whose value
leaves as a failure (`diag-alias-use` for the alias uses). "Leaves as a failure" walks up the expression from the
literal or name and stops at the first statement, function or class (`diag-statement-bound`, so a logged, compared,
returned or callback-only literal never counts) and admits only:
- `diag-throw`: inside a `throw` expression (including `throw Object.assign(new Error(..), { code: "X" })`);
- `diag-error-new`: an argument of `new <Name>Error(..)` / `new <Name>Exception(..)` (thrown, returned or passed on);
- `diag-reject`: an argument of `reject(..)` / `Promise.reject(..)` (not `resolve`);
- `diag-error-class`: an argument of `super(..)` in a class that extends `<Name>Error` / `<Name>Exception`. The class is
  then followed to where it is constructed in a throw / reject / error context (`diag-class-follow`); when nothing
  visible throws it, the class declaration itself is the site (nothing is invented).

Deciding and planning:
- `diag-ambiguous`: a code thrown in more than 3 files (or whose text search is truncated) is `ambiguous` and not planned.
- Codes with no site are listed `not-thrown` (downstream symptoms or codes built at run time) and not planned.
- `diag-plan-sites`: one `edit-source` step per throwing file, in the request's code order, symbol = the innermost
  named function, method or class around the site, reason `throws CODE` / `rejects with CODE`; at most 6 files.
- Tests: v4's picks unchanged (a test named by the request, else the site's direct test, else a new test beside it);
  the test command is v4's `testCommandFor` anchored at the first site. The run-tests step is v4's.
- `diag-fallback-v4`: a refused diagnosis returns v4's plan exactly (only `planner` and `diagnosis` differ).
- Every diagnose step is `missing` (`edit-existing-function`, `extend-existing-test` / `add-test-file`): no approved rule
  edits a throwing site. `diagnosis.notYet` (fixed vocabulary) says what v5 cannot do yet:
  `reproduce-reported-failure` (plan-only never runs the failing job), `fix-at-throw-site` (no rule writes the retry /
  recovery), and `trace-unthrown-codes` when some stated code had no site.

The plan gains one field, `diagnosis: { family, refused, codes[{code, detail, status, sites[{path, line, symbol, via}]}],
notYet }`. It carries codes the request stated and repo paths, as v4's `anchors` and `files` do; no free text.

## Soundness note

- What an admit claims: "this file contains code that raises the reported code". It does not claim the site is the
  root cause (a site can rethrow a lower failure) or that the fix belongs only there; `notYet` says so.
- False site risks, bounded: a literal inside a throw expression that only mentions the code (e.g. a wrapper's message)
  counts; a CONSTANT_CASE alias name shared by unrelated modules can add sites (each counted file is bounded by the
  ambiguity cap). Codes built at run time (`${prefix}_FAILED`), errors returned as values (`{ ok: false, code }`),
  codes thrown inside dependencies, files over 2000 lines and non-JS/TS sources are NOT found: those requests fall back
  to v4 (no worse than v4). (M195 below adds caught-and-reported codes and `PREFIX_${x}` templates; the rest stands.)
- It never upgrades a step to `can-do`, adds no rule, executes nothing (read-only `codesearch` + TypeScript syntax
  parse, no type checker), and writes nothing. Refusal reasons and log rows are unchanged (m59, m119); the loop does not
  use v5.

## Tests

`peaceai/test/m194-plan-v5.test.ts` (+ `m194-cases.ts`, `m194-fixtures.ts`): every M153 and M164 case holds on v5;
15 tagged conditions, each with an admit case and a refused near miss (30 cases) on two shapes written for M194 (a
flat npm + vitest package with a template-literal throw and a returned symptom constant; a pnpm + jest workspace with
an Error subclass followed to a `reject`, and a cross-file CONSTANT_CASE alias); a mutation check (each of the 15
tagged lines mutated must fail a case); a generality check (plan5.ts, plan5run.ts and the M194 fixtures/cases name no
task, task repository, task file or Peace project term); synthetic grade before/after (fileRecall v4 0/0/1/1 -> v5
1/1/1/1 on 2 diagnose tasks and 2 refused tasks; refused tasks grade exactly as v4); wiring (v4 default and
byte-identical, v5 not selectable, own CLI and digest, plan5run.ts = plan4run.ts outside the renames); runner rows.

## Scores (honest)

Synthetic only (written with the family, so not evidence of generalisation). Not run on the public dev split or the
hidden half yet; no claim about either. The one real-world motivating request is re-run in Batch 28.

## M195 (Batch 29): caught-and-reported codes, template prefixes, detail trim

Why: the Batch 28 re-run on the motivating real request showed that M194 only finds codes that are THROWN, while the
most common shape in a real job log is a failure that is CAUGHT AND THEN REPORTED (logged in a catch, pushed into a
warnings list, returned as a failed result) or a code BUILT AT RUN TIME from a template. M195 adds those shapes,
generally. As in M194, no code, fixture, name, request wording or reference diff of that project or of any task set was
used to build or test M195; the fixtures (`m195-fixtures.ts`) are two shapes written for it (`mail`: flat npm + vitest;
`agent`: pnpm + jest workspace).

New tagged conditions (each with admit cases on BOTH shapes, at least one refused near miss, and two mutants: one
removing the guard, which fails an admit case, and one loosening it, which fails a near miss):
- `diag-report-log`: the code (literal, template or CONSTANT_CASE alias) is an argument, possibly inside an object or
  a concatenation, of a logging call: `console.error|warn|log|info|debug|trace`, `<log|logger|Log|Logger|xLogger>.<level>`
  (also `this.logger.<level>`), or `process.stderr|stdout.write`. Near misses: an unrelated string in the catch (a
  metrics key, a map key), a code only in a comment, a code logged only in a test file.
- `diag-report-push`: an argument of `.push(..)` / `.unshift(..)` on an array named errors / warnings / failures /
  problems / issues (or camelCase ending in one, e.g. `this.problems`, `writeWarnings`). Near miss: a push into any other
  array (`retried.push(..)`).
- `diag-report-result`: a property value of an object literal with `ok|success|succeeded: false` that is returned, is an
  arrow's result, or is passed to `resolve(..)`. Near misses: `ok: true`, a failed object kept in a variable and not
  returned, and a failed result returned OUTSIDE a catch (a check's symptom report; see `diag-report-caught`).
- `diag-report-caught`: each report above counts only inside a catch block, a `.catch(fn)` handler or a `.then(_, fn)`
  rejection handler; the walk from the sink stops at any other function (a success handler, a forEach callback) and a
  try block or finally block is not a catch. The SITE is the try statement or the `.catch` / `.then` call (line and
  enclosing function), where the fix belongs, not the logging line. Near misses: a log in the try block, in a success
  handler, in a plain callback.
- `diag-template-prefix`: a reported `A_B_<SEGMENT>` (the last segment plain [A-Z0-9]+) matches a template that builds
  `A_B_${x}`; the prefix must itself be CONSTANT_CASE with at least two segments and 5+ characters. Near misses:
  `STATUS_${x}` (one segment), `E_X_${x}` (too short), a reported code with two built segments.
- `diag-template-boundary`: in the template the prefix starts the code (start of the template or after a non-word
  character, never glued to letters or right after another hole) and the hole ends it (the next text does not continue
  the code). Near misses: `MYA_B_${x}`, `A_B_${x}_RETRY`, `${k}A_B_${x}`.
- `diag-detail-trim` (the Batch 28 parse defect): `CODE:detail.` drops the sentence's trailing full stop(s)
  (`CODE:24.` -> `24`); inner dots stay (`v2.1`), and a detail that is only dots is no detail.

Deciding and planning (changed lines of existing conditions): a code whose sites are all reports has status
`reported` (`thrown` when any site throws); `diag-needs-site` admits on `thrown` or `reported`; the 3-file ambiguity
cap counts every site; step reasons say `catches and reports CODE (catch-log|catch-push|catch-result)` and
`(template)`; each site in `diagnosis.codes[].sites` carries `via` and `match` (`token` | `template-prefix`), so the
plan says which shape matched. Reported steps are `missing` (`edit-existing-function`); `notYet` gains
`fix-at-report-site` (no rule writes the retry / recovery around a caught failure) next to `reproduce-reported-failure`;
`fix-at-throw-site` is listed only when some site throws; `trace-unthrown-codes` when some code is neither thrown nor
reported. A refused diagnosis is still v4's plan exactly.

### Soundness note (M195)

- What a reported admit claims: only "this file catches a failure and reports the code there"; not that the try or
  chain is the root cause (the failure may come from a callee; `reproduce-reported-failure` and `fix-at-report-site`
  stay in `notYet`).
- False site risks, bounded: a catch that logs a code for a failure it did not catch itself (e.g. logs a stale state
  code) counts; a problems-named array that is not really a problem list counts; a template prefix shared by two
  unrelated families counts both (each bounded by the 3-file cap, so a widely shared prefix becomes `ambiguous`).
- Not found (falls back to v4 or lists the code `not-thrown`, no worse than before): reports outside a catch (a check
  result is a symptom by design), reports inside a nested callback within a catch, logging through a wrapper not named
  like a logger, suffix templates (`${x}_FAILED`), prefixes followed by more than one built segment, and everything
  M194 already excludes.
- It still never upgrades a step to `can-do`, adds no rule, executes nothing (read-only `codesearch` + syntax parse),
  writes nothing; refusal reasons and log rows are unchanged (m59, m119); the loop does not use v5; v4's file and digest
  are unchanged; v5 stays out of `plandefault.ts`; `selfpropose.ts` is untouched.

### Tests (M195)

`peaceai/test/m195-cases.ts` + `m195-fixtures.ts`, run by `m194-plan-v5.test.ts` with M194's cases: 25 M195 cases (14
admit on the two shapes, 11 near misses); the tag check now covers 22 conditions and requires both shapes and two
mutants for each M195 condition; the mutation check runs every mutant (15 + 14) against all 55 cases; the generality
check covers the M195 files; the synthetic grade gains one caught-and-reported task (`mail`, fileRecall v4 0.333 ->
v5 1).
