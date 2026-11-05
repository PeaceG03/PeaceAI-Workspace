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
  to v4 (no worse than v4).
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
