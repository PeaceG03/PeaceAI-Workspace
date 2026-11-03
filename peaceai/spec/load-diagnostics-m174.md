# M174 (batch 13): compile-diagnostic feedback for a team suite that does not load

Code: peaceai/lib/loaddiag.ts (new), peaceai/lib/editpropose.ts (repair-v2 load-repair candidates),
peaceai/lib/loop.ts (loadRepairDiags, loopSha256), peaceai/lib/looprow.ts (row field baselineLoad).
Tests: m174-load.test.ts, m174-cases.ts, m174-mutation.test.ts (+ m174-mutant-runner.ts).
repair-v1, model-v1 (which ranks repair-v1's list), rules-v1 and every planner are unchanged.

## Decision: (a) only, (b) ava deferred

Scope offered: (a) structured compile diagnostics for a suite that fails to load, fed to the proposer; (b) an ava
runner. Only (a) is done. Why (b) was deferred:
- the one ava task seen (diagnosis only) has no lockfile, so an ava runner would only move its refusal from the
  runner refusal to DEPS_NO_LOCKFILE: no measurable change;
- a fourth shim runner needs its own report-forging test matrix (as jest, vitest and mocha have), which is large;
- the shim's forging fixes in #671 were still under review when this batch started.

## What was looked at (honest statement)

Diagnosis only: the M173 note that neverthrow's whole jest suite fails to compile (every attempt 0/1, no signal),
now refused BASELINE_SUITE_LOAD. That motivated a general gap: when a team suite does not load, PeaceAI learns
nothing about why. The neverthrow fix itself (it adds a new static method and an aliased export) is NOT what the
new templates do: load-export and load-reexport never write a function body, an alias, a class member or any new
logic; they only make an existing declaration or an existing export reachable. No TYPE_ERROR diagnostics and no
TS2339 (missing property / static) handling were added, because those would mirror that task's fix class. No
fixture, template or idiom is modelled on any dev task or reference diff; every fixture in m174-cases.ts is an
unrelated shape written for this test (an inventory restock helper, a shapes barrel, a palette module, a calendar
helper, a unit-price table). No dev-task gain is expected or claimed; box runs never count for model-v1 results.

## Mechanism 1: load diagnostics (lib/loaddiag.ts)

Source: the TypeScript compiler API over the copy (a program whose roots are the team's test files), run by the
runner, executing nothing. The runner's stdout is never parsed: candidate code can write it, so it would be a forging
channel, and it would carry raw message text. Only filtered codes leave the module; message text is never read or
logged. Compiler options are fixed (LOAD_OPTIONS: noEmit, allowJs, skipLibCheck, no @types, Bundler resolution);
the repo's tsconfig is not read.

The compiler host (`confinedHost`) answers only for regular files whose realpath is inside the copy and whose real and
lexical paths are outside node_modules (host-inside, host-no-modules, host-no-modules-lex), plus TypeScript's own lib
files; writeFile is a no-op. So a symlink out of the copy, or a package, is "not found".

A diagnostic is kept only when (guard tag in brackets):
- its code is TS2305 / TS2459 / TS2614 / TS2724 (MISSING_EXPORT) or TS2307 (MISSING_MODULE), on an import
  declaration of a team test file;
- the specifier is relative (relative), the import is not `import type` (type-only) and the name is not a `type`
  name (type-only-name);
- MISSING_MODULE: the specifier's lexical path stays inside the copy (module-lex-inside);
- MISSING_EXPORT: the module resolves to a .ts/.tsx/.mts/.cts source, not a declaration file or .js
  (module-source), that is not a test path (module-not-test), not a team file (module-not-team) and is not opaque
  (star-opaque): a module that `export *`s from something unresolved or outside the program (star-unknown) may
  export the name already, so nothing is claimed about it;
- the imported name is a plain identifier (name-ident);
- at most MAX_LOAD_DIAGS = 20, deduplicated and sorted (cap).
Each diagnostic is {kind, test, module, name, spec}: names and paths come from the syntax tree and module resolution.

## Mechanism 2: load-repair candidates (lib/editpropose.ts, repair-v2 only)

`repairProposer({v2: true})` has loadRepair = true; repair-v1 and any reranked list (model-v1) have false
(lr-v2-only). Given load diagnostics, it proposes only load candidates (NO_EDIT if none, then NO_MORE_EDITS), at
most MAX_LOAD_CANDIDATES = 2:
- load-export: insert `export ` before the module's single top-level declaration of the name
  (le-one-decl: no overloads or merged declarations), which is a function, class, enum, interface, type alias or
  a variable statement (le-kind: not a namespace) with a single declarator (le-single), not declare / default /
  already exported (le-plain), a function with a body (le-body), and not already named in an export list
  (le-not-listed);
- load-reexport: append `export { name } from "<spec>";` to the module when exactly one other non-test source
  file (re-not-test, re-unique) exports that name directly; the specifier style (.js / .ts / none) is taken from the
  module's own relative imports, else from the test's;
- MISSING_MODULE diagnostics produce no candidate (lc-export-only); a candidate must fix every missing name at once,
  else there is none (lc-all-fixed). The first candidate prefers load-export, the second prefers load-reexport.

## Mechanism 3: the loop and its rows (lib/loop.ts, lib/looprow.ts)

M173 rule 2 (a baseline that proves nothing refuses the task before the proposer is asked) holds unchanged except in
one case, `loadRepairDiags`: the baseline refusal is BASELINE_SUITE_LOAD (lm-suite-load-only), the proposer has
loadRepair = true (lm-proposer), and at least one MISSING_EXPORT diagnostic exists (lm-needs-export). Then the
proposer is asked with the diagnostics. BASELINE_NO_REPORT, NO_TESTS_RAN and BASELINE_EXIT_ONLY always refuse; so
does a load failure with only missing modules, or one the diagnostics cannot explain, or any proposer other than
repair-v2. A diagnostics crash is caught and treated as no diagnostics (refuse, as before).

Fail-closed: PASS is unchanged. It needs an attempt with no failure code: a real report, exit 0, >= 1 executed test,
no shim code. An edit after which the suite still does not load is scored SUITE_LOAD + TEST_FAIL and can never pass
(e2e case "fail-closed").

Rows: such a row carries `baselineLoad: "MISSING_EXPORT"` (v4 rows only, loop-row-load). loopRowProblem accepts it
only with that value (row-load-value), only on a post-baseline outcome code, never on a baseline refusal
(row-load-code), and a public row must keep its baseline (row-load-baseline). `reachedTests` is false for it
(row-reached-load): the baseline never ran the team's tests, even if the task later passes. loopSha256 hashes
lib/loaddiag.ts (sha-loaddiag), so a row binds the diagnostics version.

The planner runs before the baseline and gets no diagnostics; only the proposer does.

## Tests

Admitting shapes, unit and end to end (stub vitest, candidate uid): a module-local inventory helper (load-export ->
PASS), a shapes barrel missing a re-export (load-reexport -> PASS); unit also a class, an enum, a const, mixed
templates in one candidate, and three specifier styles. Near misses, one per condition: each guard above has a
refused case in m174-cases.ts (the tag is named in the assertion message). End to end near misses: a proposer
without loadRepair, and a missing module only, both refuse BASELINE_SUITE_LOAD and the proposer is never asked; an edit
that keeps the suite unloaded is ATTEMPT_LIMIT with [["SUITE_LOAD","TEST_FAIL"]]; a loaded suite with a buggy function
ends NO_MORE_EDITS with [["TEST_FAIL"]]. Mutation: m174-mutation.test.ts deletes each of the 34 `// m174-guard:`
lines in turn and requires at least one case to fail an assertion (a crash is not a failure); the tag list is pinned.

## Soundness

- Nothing new reaches a PASS without the unchanged acceptance rule; load repair only lets the loop try edits it
  would previously have refused, on a narrowly defined baseline, and the row says so (baselineLoad, not reachedTests).
- The diagnostics read only copy files through a confined host, execute nothing, and emit fixed codes plus names
  and paths from the syntax tree; no runner output and no message text is used.
- No existing validation is loosened: every pre-M174 row shape is validated as before; baselineLoad is optional.
- Limits / residuals: only relative imports of TS sources; JS sources, declaration files, packages and modules
  behind an opaque `export *` are not diagnosed; a missing module, a type error, a missing class member or a
  missing default export gets no candidate; the planner does not see diagnostics; no dev-task gain is claimed.
