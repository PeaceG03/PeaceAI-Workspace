# M174 (batch 13): compile-diagnostic feedback for a team suite that does not load

Code: peaceai/lib/loop.ts (loadDiagnostics, confinedHost, loadRepairDiags), peaceai/lib/editpropose.ts (repair-v2
load-repair candidates), peaceai/lib/looprow.ts (row field baselineLoad). No new lib file: the diagnostics live in
loop.ts, which is already in the protected lib closure of bin/loop.ts (selfchange.ts M167 entries, closure test m96)
and already hashed by loopSha256, so PROTECTED_DIGEST and the never-zone sets (m132) are unchanged.
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
new template does: load-export never writes a function body, an alias, a class member, an import or any new
logic; it only makes an existing declaration reachable. No TYPE_ERROR diagnostics and no
TS2339 (missing property / static) handling were added, because those would mirror that task's fix class. No
fixture, template or idiom is modelled on any dev task or reference diff; every fixture in m174-cases.ts is an
unrelated shape written for this test (an inventory restock helper, a week calendar class, a shapes barrel, a palette
module, a calendar helper, a unit-price table). No dev-task gain is expected or claimed; box runs never count for model-v1 results.

## Mechanism 1: load diagnostics (lib/loop.ts loadDiagnostics)

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

## Decision on Auditor's single-token condition: (i) T2 load-reexport dropped; T1 kept, behind an L0 gate

Auditor's binding condition: on vitest/jest, code in the test process can patch `expect` and forge a pass; that is
out of reach only while repair edits stay single-token in source files, so before edit scope widens an L0 edit-token
gate must land with a forging test, and a PASS from a wider edit does not count until then.

- T2 (load-reexport: append a whole `export { name } from "<spec>";` statement) is OUTSIDE that scope and is dropped
  from this batch (option (i)). It is not a template, not proposed, and no code for it remains (LOAD_TEMPLATES is
  ["load-export"]). A barrel that misses a re-export now gets no candidate (NO_EDIT; e2e near miss).
- T1 (load-export) is kept because it is in scope: each site is one inserted keyword token `export ` before a
  declaration that already exists in an existing, non-test source file. It adds no import, no statement, no
  expression and no body, so it cannot bring new code into the test process, and in particular cannot patch expect:
  the only effect is that an existing binding becomes importable. A candidate fixing k missing names inserts k tokens
  (k <= MAX_LOAD_DIAGS = 20), each one such site.
- The L0 edit gate (lib/loop.ts loadEditProblem / loadEditShape) enforces this in the loop, independent of the
  proposer: in load-repair mode every proposal is checked against the copy reset to the pinned commit, before the
  team's tests are put back and before anything runs (scope-gate). It is refused PROPOSER_FAILED (nothing run,
  attempts 0) unless it is non-empty (scope-nonempty) and every edit is to an existing (scope-exists) .ts/.tsx/.mts/
  .cts file that is not a declaration file (scope-source), not a test or generated path (scope-not-test), not a
  runner config or setup file (scope-not-infra: *config.*, vitest*/vite*/jest*/mocha*/ava*/karma*, *setup*), and
  whose new content is exactly the old content with 1..20 copies of `export ` inserted (scope-count, scope-token),
  each at the start of the file or after whitespace so it never joins an identifier (scope-boundary); nothing else may
  differ (scope-shape). Forging e2e: a load-repair proposer whose edit adds `import "./patch.ts"` (a file that
  replaces globalThis.expect), or adds a new file, or edits vitest.config.ts, is PROPOSER_FAILED with 0 attempts, and
  the same proposer with the single-token edit passes.
- Creditability: a PASS from an edit wider than single-token is non-creditable unless this gate is present. In M174
  such a PASS cannot be produced: every load-repair row (baselineLoad set) comes from the loop path that applies the
  gate before the first run, and loopSha256 (which hashes lib/loop.ts, where the gate lives) binds the row to a gated
  loop version. Rows from the non-load path are unchanged pre-M174 behaviour (the M152/M168 proposers, already
  reviewed). Any later widening (new templates, multi-token edits) must extend this gate and its forging test first.

## Mechanism 2: load-repair candidates (lib/editpropose.ts, repair-v2 only)

`repairProposer({v2: true})` has loadRepair = true; repair-v1 and any reranked list (model-v1) have false
(lr-v2-only). Given load diagnostics, it proposes only load candidates (NO_EDIT if none, then NO_MORE_EDITS), at
most MAX_LOAD_CANDIDATES = 1:
- load-export: insert `export ` before the module's single top-level declaration of the name
  (le-one-decl: no overloads or merged declarations), which is a function, class, enum, interface, type alias or
  a variable statement (le-kind: not a namespace) with a single declarator (le-single), not declare / default /
  already exported (le-plain), a function with a body (le-body), and not already named in an export list
  (le-not-listed);
- MISSING_MODULE diagnostics produce no candidate (lc-export-only); the candidate must fix every missing name at once,
  else there is none (lc-all-fixed).

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
(row-reached-load): the baseline never ran the team's tests, even if the task later passes. loopSha256 already
hashes lib/loop.ts, where the diagnostics live, so a row binds the diagnostics version.

The planner runs before the baseline and gets no diagnostics; only the proposer does.

## Tests

Admitting shapes, unit and end to end (stub vitest, candidate uid), two unrelated shapes: a module-local inventory
helper function and a module-local week calendar class (load-export -> PASS each); unit also an enum, a const, and
one candidate fixing two names in two modules. Gate: admits one site, two sites, two files; near misses per condition
(empty, .js, .d.ts, test path, runner config, setup file, new file, added import, new statement, body edit, joined
identifier, unchanged, 21 sites vs 20, `export default`); forging e2e as above. Near misses, one per condition: each guard above has a
refused case in m174-cases.ts (the tag is named in the assertion message). End to end near misses: a proposer
without loadRepair, and a missing module only, both refuse BASELINE_SUITE_LOAD and the proposer is never asked; an edit
that keeps the suite unloaded is ATTEMPT_LIMIT with [["SUITE_LOAD","TEST_FAIL"]]; a loaded suite with a buggy function
ends NO_MORE_EDITS with [["TEST_FAIL"]]. Mutation: m174-mutation.test.ts deletes each of the 41 `// m174-guard:`
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
- What the diagnostics read: the copy's files after the baseline run. The copy is owned by the runner (0755, files
  not writable by the candidate uid; M171 write proof), node_modules is excluded by the host, and the result is only a
  list of identifiers and repo paths handed in-process to the proposer. They choose which edit is tried, never how it
  is scored.
- Public logs: a row (and so loop-log.jsonl / Results) gets only the fixed code `baselineLoad: "MISSING_EXPORT"`.
  Diagnostic names, modules, test paths and TypeScript message text are never written to a row, a log or stdout.
- A suite that never loaded is never scored PASS: the baseline that did not load is not a pass/fail comparison
  (`reachedTests` stays false for the row), and an attempt is PASS only with no attempt code at all, i.e. a real
  nonce report on fd 3 from the PeaceAI reporter (M173), exit 0 and >= 1 executed test. The M173 forging guards
  (loopdeps.ts launch.cjs nonce + fd3, reporter claim at preload, caller check, dot-dir refusal, mocha locks) are
  untouched, and in-process patching of expect is out of reach because load-repair edits are gated to single tokens: loopdeps.ts is not changed, and load-repair attempts go through the same runTests as every attempt.
- Relation to the Auditor ruling on run 41556098711 ("a suite that never loaded must not have edits scored
  against it"): M174 is a narrow, explicit exception that needs Auditor's ruling. Edits are tried only when the
  diagnostics name a missing export (a fail-before the team's own tests define), the row is marked baselineLoad and
  never counts as reaching the tests, and its PASS still needs the full M173 acceptance above. Without that ruling
  the exception can be switched off by refusing load-repair rows in crediting (reachedTests false already excludes
  them from any reached-tests count).
- Load repairs never write a body: load-export inserts only the keyword `export `, and the L0 gate refuses, before
  anything runs, any load-repair proposal whose content differs from the pinned file by anything else.
- Load-repair rows are validated downstream like every row: ci.yml test:tools -> m146 -> looprow loopRowProblem,
  which accepts baselineLoad only on v4 rows, only with the value MISSING_EXPORT, only with a post-baseline code, and
  only with the public row's baseline present.
