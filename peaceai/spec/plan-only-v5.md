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
reported. A refused diagnosis is still v4's plan exactly. Fix (M194 defect found in the Batch 29 informational run): an
admitted plan's last step (v4's run-tests step) kept v4's step number, so two steps could share a number; it is now
numbered after the diagnose steps.

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

### Scores (M195, honest)

- Synthetic (written with M195, so not evidence of generalisation): the caught-and-reported task's fileRecall goes from
  v4 0.333 to v5 1; the four M194 synthetic rows are unchanged.
- Public DEV split (12 tasks, plan-grade-v2, no tuning; hidden half not touched): v4 devScore 0.764, runTests 0.833;
  v5 devScore 0.764, runTests 0.833, row-for-row identical. The family admits none of the 12 requests (9
  NO_FAILURE_REPORT, 3 NO_CODES, decided from the request text before any code search), so every v5 dev plan is v4's
  plan. The dev split has no failure-log requests; it neither supports nor contradicts M195.
- The motivating real request was re-run as an informational check only (not a test, fixture or score); results are in
  the Batch 29 PR description.

## Batch 31: `toplevel-catch` (a module-level `f().catch(..)` on a function of the same file)

A report written by a `.catch` handler hung directly on a top-level call (`main().catch((e) => log("X_FAILED", e))`)
has no enclosing function, so M195 planned it with symbol null at the `.catch` line: there was nothing to edit. The
fix belongs in the called function (it is what threw or rejected). v5 now plans that site at the called function's
declaration, with `shape: "toplevel-catch"` on the site and `(catch-log, toplevel-catch)` in the file reason. Every
other site, rule and refusal is unchanged; v4 stays the default and byte-identical, v5 stays not selectable.

Three tagged conditions in `toplevelCatch` (plan5.ts), all must hold:

- `rule:diag-toplevel-call`: the handler is the single argument of `.catch` (not `.then(_, fn)`), and the receiver
  (parens stripped) is a call of a plain identifier (not `obj.main()`, not a stored promise `pending.catch`).
- `rule:diag-toplevel-module`: the `.catch` is at module level: no function or class encloses it (not inside a
  `process.on(..)` callback, not a class field initialiser).
- `rule:diag-toplevel-local`: the called name is declared at the top level of the same file as a function
  declaration with a body, or a `const` bound directly to an arrow / function expression (not an import, not a
  factory result `const boot = makeBoot()`).

### Soundness note (Batch 31)

- The rule only re-points a site M195 already admitted (a report-via site with no enclosing symbol); it never adds a
  code, a site or a file the M195 rules did not find, so it cannot widen what v5 claims to diagnose.
- The target is the function the `.catch` is attached to, which is exactly the promise whose rejection is reported.
  When the name might not be that function (a method, an import whose body is elsewhere, a value built at runtime,
  a nested or class-scoped `.catch`), the rule does not fire and the M195 site is kept as it was (symbol null): an
  honest "report site only", never a guessed function.
- It does not claim the rejection originates in that function's own body (it may come from a callee); the plan's
  edit-source step names where the failure surfaces, as for the other report-via sites. Tracing further is still
  notYet (`fix-at-report-site`, `trace-unthrown-codes`).
- reproduce-v1 refuses a `toplevel-catch` site (`REPRO_NO_ENTRY`, detail `toplevel-catch`): such a function is a
  process entry with no parameter dependency to inject, so v1 has no sound trigger there.

### Tests (Batch 31)

Fixtures `MAIL_CLI` (async function declaration, `main().catch` with console.error) and `AGENT_DAEMON` (const arrow,
`void (boot()).catch` with a structured logger) in m195-fixtures.ts; two admit shapes per condition and six refused
near misses (`cli.main().catch`, `.then(undefined, fn)`, `pending.catch`, inside a SIGHUP callback, a class field,
an imported `main`, a factory-built `boot`), each expecting the unchanged M195 site. Two mutants per condition (removed
and loosened); m194 now also requires each M195 mutant to be caught by a case of its own condition.

### Scores (Batch 31, honest)

- Public DEV split (12 tasks, plan-grade-v2, no tuning; hidden half not touched): v4 devScore 0.764, runTests 0.833;
  v5 devScore 0.764, runTests 0.833, row-for-row identical (the dev split has no failure-log requests).
- The motivating real request was re-run as an informational check only (not a test, fixture or score); results are
  in the Batch 31 PR description.

## Batch 34 (M198): symptom-to-cause trace (`fix-at-probable-cause`)

Before Batch 34 every v5 edit-source step named where a failure code surfaces (the throw or report site). When
that site's condition reads a value from another function of the same package, the real fault is often in that
producer. M198 adds a bounded, static, conservative trace per diagnosed site (`Diagnosis.traces`) and plans each
traced producer as a ranked `edit-source` step ("probable cause") above the symptom step. All steps stay `missing`;
the trace never runs code. v4 stays the default and byte-identical (digest `b667d518...`), v5 stays unselectable,
`plandefault.ts` and `selfpropose.ts` are unchanged, and a refused diagnosis is still v4's plan exactly
(`traces: []`).

### What hop 1 reads (one tagged line per condition in plan5.ts)

- `trace-condition` / `trace-depends`: a throw site in a branch of an `if` reads the condition's producers: a
  `const`-bound call result named in it (also destructured, `const [a] = f()` / `const { a } = f()`, also inside a
  predicate's arguments), or a call used as a receiver (`load().length`). Not a parameter, a field, a `let`, a
  catch variable or a predicate call's own result: those give `TRACE_INDEPENDENT`.
- `trace-rethrow`: a throw inside a `catch` block reads the try block's failing calls (via `caught`); a throw in the
  try block or a `finally` has no condition (`TRACE_NO_CONDITION`).
- `trace-caught`: an M195 report site (catch-log, catch-push, catch-result, toplevel-catch) reads its try block's
  failing calls, or the base call of its `.catch`/`.then` chain.
- `trace-own-body`: only a function's own calls count; calls inside a nested callback (`forEach((x) => f(x))`) do not.
- `trace-can-fail`: in a try block an in-repo call counts only when it can fail (its body throws, rejects, builds an
  `*Error`, awaits, or returns a call); a library call counts only when awaited or returned.
- `trace-resolve-this` (class style only), `trace-resolve-import`: a call resolves to a method of the enclosing class
  (`this.m()`), a top-level function of the same file, or a named ESM import / destructured `require` of a relative
  module's top-level function. Anything else (a field's method, an inherited method, a namespace require, a barrel
  re-export, a library) is opaque: `TRACE_UNRESOLVED` at hop 1, the end of the trace after it.
- `trace-workspace-name`, `trace-same-package`: a bare specifier naming a workspace package, or a relative target whose
  nearest package.json differs from the site's, is `TRACE_CROSS_PACKAGE`; the trace never crosses a package boundary.

### Hops, refusals and planning

- `trace-unique`: more than one producer at hop 1 is `TRACE_AMBIGUOUS` (no cause planned; no guess between them).
- `trace-delegate` / `trace-delegate-all`: from a producer, hop 2 is the one in-repo function that EVERY `return`
  hands back the result of (`return g(..)`, `return await g(..)`, or a const bound to such a call). An early
  literal return ends the trace (no hop 2); two different delegates are `TRACE_AMBIGUOUS` with hop 1 kept.
- `trace-depth`: at most `MAX_TRACE_HOPS` = 2 causes; a third delegate is `TRACE_DEPTH` and is not planned.
- `trace-not-planned`: a producer that is itself a diagnosed site (or already in the trace) is not added again
  (`TRACE_ALREADY_PLANNED` at hop 1).
- `trace-plan-cause`: each cause is an `edit-source` step placed before the symptom step of its file (hop 1 first);
  a cause shared by several codes is stepped once; cause files are listed after the symptom sources with reason
  `probable cause of CODE (via, hop N)` and count against MAX_SOURCES_V4. `notYet` gains `fix-at-probable-cause`
  when any trace has a cause. Tests are unchanged (chosen from the symptom sources).
- Stops: `TRACE_NO_CONDITION`, `TRACE_INDEPENDENT`, `TRACE_UNRESOLVED`, `TRACE_AMBIGUOUS`, `TRACE_CROSS_PACKAGE`,
  `TRACE_ALREADY_PLANNED`, `TRACE_DEPTH`; null when the trace ran out of in-repo producers.

### Soundness note (Batch 34)

- A cause step is a "probable cause", not a proven one: the trace shows only that the site's condition (or caught
  error) syntactically depends on that function's result, not that the function is wrong. The symptom step is
  always kept, so a wrong cause adds one step and never removes the right one.
- Every case the static reading cannot pin to a single in-repo function refuses with an explicit stop rather than
  guessing: several producers, opaque calls (fields, inherited methods, namespace requires, re-exports, libraries),
  other packages, and anything past two hops. A refused trace leaves the plan as it was before Batch 34.
- Known under-approximations (missed causes, never wrong ones): a sync library call in a try block is not counted
  (it may throw); a predicate call in a condition is not a producer; module-level consts, `let` reassignments,
  fields and parameters are not followed (no inter-procedural data flow); dynamic dispatch is not resolved.
- Granularity: edit-source steps are per file for symptoms (as before) and per function for causes; causes are
  capped with the sources by MAX_SOURCES_V4.
- The trace adds steps only to plans v5 already diagnoses; it does not change which requests v5 diagnoses or
  refuses, so it cannot widen what v5 claims to diagnose.

### Tests (Batch 34)

m198-fixtures.ts: `BILLING` (pnpm + jest workspace, TypeScript ESM, class-based service with a sibling package) and
`ETL` (flat npm + vitest, CommonJS functional pipeline with a nested package). m198-cases.ts: for each of the 16
`rule:trace-*` lines, admit cases (both shapes, except `trace-resolve-this`, which is class-only) and refused near
misses, including ambiguous producers, cross-package producers (workspace name and relative path), depth exceeded,
and a condition not depending on the producer. m198-plan-v5-trace.test.ts runs these with every M194/M195 case,
checks tag coverage, and runs 22 mutants (one removal per tag plus loosening mutants); each must fail a case of its
own condition. It also has a generality check on the fixtures and the wiring check (v4 digest, v5 unselectable,
plandefault.ts hash). Two M195 cases (`mail-site-is-the-try`, `agent-site-is-the-chain`) changed expectations on
purpose: their fixtures now trace to a cause (`fetchInbox`, `runSteps`). m194's tag check now covers only `diag-*`.

### Scores (Batch 34, honest)

- Public DEV split (12 tasks, plan-grade-v2, no tuning; hidden half not touched): v4 devScore 0.764, runTests 0.833;
  v5 devScore 0.764, runTests 0.833 (the dev split has no failure-log requests, so the trace never fires there).
- The motivating real request was re-run as an informational check only (not a test, fixture or score); results are
  in the Batch 34 PR description.
