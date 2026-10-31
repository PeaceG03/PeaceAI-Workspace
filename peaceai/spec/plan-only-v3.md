# PLAN-ONLY mode v3 (planner `plan-only-v3`)

Status: DEFAULT (Builder, 2026-10-30; switched in `peaceai/lib/plandefault.ts`, see `peaceai/spec/plan-default.md`).
Files byte-identical to #649 (plannerSha256 f4999797...); v1 (plannerSha256 275e559b...) and v2 (fae6c0c4...) are
unchanged and still runnable. v3 runs via `peaceai/bin/plan.ts run <taskfile>` (default) or `peaceai/bin/plan-only-v3.ts`.
Hidden half (Auditor, 20/20 graded, v3 at c4dd914, plannerSha256 f4999797...): v3 mean 0.287 (runTests 0.300);
v1 0.229 (runTests 0.350); v2 0.223 (runTests 0.250). The evidence for the default is 20 hidden tasks with a noisy
+0.058 margin over v1. Dev 0.681 is not proof (v2 scored 1.000 on dev and 0.223 hidden). runTests is BELOW v1's even
though v3 always plans a test step: the planned test commands likely do not match what the tasks expect. Grader
`plan-grade-v2` (`plangrade.ts`) is unchanged.

Files: `peaceai/lib/plan3.ts` (planner), `peaceai/lib/plan3run.ts` (runner: fetch, plan, grade, log row; a
self-contained copy of the v2 runner so a v2 change cannot move v3), `peaceai/bin/plan-only-v3.ts` (CLI). Tests:
`peaceai/test/m153-plan-v3.test.ts` (+ `m153-cases.ts`, `m153-fixtures.ts`). No protected file is added or changed.

`plannerSha256V3` = sha256 over the bytes of `lib/plan3.ts`, `lib/plangrade.ts` and `lib/plan3run.ts`, in that order
(same construction as v2 with v3's files).

## Why v3

v2 scored 1.000 on dev and 0.223 on the hidden half (v1: 0.229): its rules fit the dev wording and did not
generalize. v3 starts again from two ideas that hold for any TypeScript/JavaScript repository, and nothing else:

1. The plan's size follows the task's scope: one source step per distinct file that defines a code name the request
   states, one test step per distinct test file that exercises those files, then one run-tests step. A request that
   names three functions in three files gets three source steps; one that names one gets one. Nothing pads.
2. Every plan that changes code ends in a real run-tests step whose command is the project's own, read from its
   package.json scripts, lockfile and runner config, scoped to the planned test files when the runner allows it.

How it was built (truth first): every rule below is written as a general rule with its reason, tested only on
synthetic fixtures (three code shapes: a pnpm+vitest library, a yarn workspace with a jest package and a mocha
package, plain npm packages). Dev task wording, repositories and files were not used to write or tune any rule
(M153 checks plan3.ts and plan3run.ts name no dev task id, repository, task file path, or project). The hidden half
was not seen or used.

## Rules (each is one `// rule:<id>` line in plan3.ts)

Reading the request:
- `tests-only`: a request that only asks to add/extend tests (and states no defect or new behaviour) gets test steps
  only. Reason: a test-only change touches no source file in any repo.

Scope (which source files):
- `source-filter`: only shipped code counts as a source file (not tests, generated output, declarations, docs,
  examples, scripts, fixtures, benches). Reason: a behaviour change lives in shipped code in every JS/TS project.
- `home-eponymous`: a name defined in several files lives in the file named after it. Reason: one-thing-per-file
  modules name the file after the thing in every common JS/TS style.
- `home-exported`: else it lives in the only file that exports it. Reason: a non-exported duplicate is a local
  helper; the public definition is the one callers (and the request) mean.
- `qualifier-home`: `A.b` with no definition of `b` of its own lives where `A` is defined. Reason: methods and
  members are defined inside their class/object, which is a module-scope definition.
- `example-fallback`: names that appear only inside a longer code example are used only when no bare name locates a
  file. Reason: an example shows usage (callers, literals); the subject is the bare name when there is one.
- `rank-fallback`: when no stated name locates a file, plan the single best search match (codesearch relevance).
  Reason: a request with no code name still needs one edit target; one best guess costs less than several (the
  grader divides by max(required, planned)).
- `max-sources` (6): a bound on runaway requests, not a target. Reason: files join only by a stated name, so the cap
  only limits a request listing many names.

Tests:
- `behavior-test`: only files with test cases count as tests (not fixtures, helpers, setup, type tests, benches).
  Reason: a helper or setup file is shared plumbing, not the test of a module, in every test runner.
- `test-direct`: the test for a source file is the first test that imports it, imports what it re-exports, or is
  named after it (codesearch testsFor score >= 2). Reason: a test that only reaches the file indirectly does not
  exercise its behaviour directly.
- `new-test-beside`: a source file with no such test gets a new test file named after it, in the directory holding
  most of the package's tests, in their suffix style. Reason: projects keep one test layout and naming convention.
- `new-test-same-package`: that directory is in the package that owns the source. Reason: in a monorepo each
  package runs its own tests with its own config.
- `test-step-always`: when no test file can be found or placed, the plan still has an add-test step (missing).
  Reason: a code change without a test is unverified in any repo.

The test command:
- `nearest-package`: the command runs in the deepest directory above the first source (or test) file that holds a
  package.json. Reason: in a workspace the package's own scripts and config govern its tests.
- `pm-lockfile`: the package manager is the one whose lockfile exists (package dir, then root). Reason: the
  lockfile is what the project installs with.
- `pm-field`: else the root package.json `packageManager` field (corepack). Reason: it is the declared manager.
  (Else npm.)
- `runner-script`: the runner is the one the package's `test` script names. Reason: `test` is what the project runs.
- `runner-config`: else a runner config file in the package dir or root (`vitest.config.*`, `jest.config.*`,
  `.mocharc.*`, `ava.config.*`, ...). Reason: a config file exists only for the runner in use.
- `runner-deps`: else a runner listed in (dev)dependencies. Reason: an installed runner is the one available.
- `targeted-runner`: when the runner takes file paths (vitest, jest, ava), the command is
  `[cd <pkg> && ]<npx|pnpm|yarn|bunx> <vitest run|jest|ava> <planned test files relative to pkg>`. Mocha is not
  targeted (its TypeScript setup often lives in script flags). Reason: running only the planned tests is the
  narrowest check those runners support directly.
- `script-fallback`: else `<pm> test` (bun: `bun run test`), else `<pm> run test:unit`, else the first `test:*`
  script; else no command. Reason: package scripts are the project's own documented way to run tests.

Can-do claims (as v2):
- `can-do-same-file`: a step is can-do only when an approved learned rule, run on an objective built only from the
  request's own words and values, edits exactly that step's file. Reason: a can-do must be a re-runnable edit, and
  the grader re-runs the same check.
- `run-tests-target`: run-tests is can-do only for repos in targets.json. Reason: only those have a test pipeline.

## Plan shape

`[edit-source missing(locate-code|understand-request) if nothing located] + edit-source per scope file +
(add-test missing if no test) + edit-test/add-test per test file + run-tests`, with `tests.files` = the planned test
files and `tests.command` = the command above. Extra fields: `understanding.scope {names, sources, tests}`,
`understanding.kind`, `understanding.testsOnly`, `testCommand {pm, runner, packageDir, form}`.

## Tests (M153)

- Cases: admit cases and refused near misses for every rule, on three code shapes; every tag has a refused case.
- Mutation: each of the 23 tagged rules is removed in turn (each anchor must occur exactly once); every mutant must
  fail at least one case.
- Generality: plan3.ts/plan3run.ts name no dev task id, repository, task file path or project.
- Grader: a can-do is verified by the unchanged grader; the named command is the fixture project's own.
- Fingerprints: v1 and v2 plannerSha256 equal main's; v3 differs; bin/plan-only.ts does not route to v3.
- Runner: v3 rows carry their own planner id and digest, pass the log validator; a hidden row names no repo/commit.

## Running

Dev (public) half: `npx tsx peaceai/bin/plan-only-v3.ts run peaceai/plan/tasks-public-v1.json` (rows appended to
peaceai/plan/runs.jsonl). The dev score is reported but is NOT proof of generalization.

Hidden half (Auditor only): `tsx peaceai/bin/plan-only-v3.ts run <hidden taskfile>`.
