# PLAN-ONLY mode v2 (planner `plan-only-v2`)

Status: draft for Auditor review (Builder, 2026-10-30). Code: `peaceai/lib/plan2.ts` (planner). Runner:
`peaceai/lib/planrun.ts` + `peaceai/bin/plan-only.ts` gain a planner option (`run <taskfile> --planner plan-only-v2`);
the default stays `plan-only-v1`, byte-for-byte the same planner. Grader `plan-grade-v2` (`plangrade.ts`) is
unchanged. Tests: `peaceai/test/m149-plan-v2.test.ts` (+ `m149-cases.ts`, `m149-fixtures.ts`).

## Why

v1 always planned 2-4 steps and never claimed a can-do. Plans should be as long as the change: one step per distinct
file and change kind, plus the test steps, and no padding (the grader divides by max(required, planned), so an extra
step costs as much as a missing one). A can-do is claimed only where an existing approved rule really produces the
edit; every other step names the missing skill.

## How v2 plans

Everything comes from the request text and the #635 search tools (`codesearch.ts`: tree, read, testsFor, relevant)
over the read-only checkout, plus the M6 symbol index. No task, repository or project is named anywhere in plan2.ts
(checked by M149 against the public task file and PeaceSTOCKS).

1. Read the request (`readRequest`): code names in backticks (a name used only inside a code example, while the
   request also names something bare, is an *example* name and only a weak signal), code-shaped prose words, and
   fix phrases "fix|change|update... the <words> <component noun>" with English stems.
2. Rank source files (`rankSources`), each bonus a named signal:
   - the search tools' relevance (weak, 0..5);
   - a file named after a named function is its home; else the files defining it (at most three);
   - a fix phrase names a file when its words spell the file stem, the specifier words included, and only the most
     fully spelled stems count ("the cache loader" -> cache-loader.ts, never helpers/cache.ts; "the upload handler"
     never names the base handler.ts by the generic noun alone);
   - else a fix phrase names a function or constant it spells (longest run of words, then the head noun);
   - a named pattern moves the edit to the module constant that holds it (the user module anchors the tests).
3. Pick (`pickSources`): when a fix phrase locates the component, only phrase-located files compete (a name the
   symptom mentions does not add its file). A second file joins only with a strong signal of its own and at least
   `KEEP_RATIO` (0.6) of the top score; at most `MAX_SOURCES` (8).
4. Entry: when the request asks to export from the package entry, the index that lists the module by name
   (`export { x } from "./m"`) is a step; an `export *` entry is not.
5. Tests: the module's own test file (same stem) first, then testsFor and relevance; a test named after a named
   function when tests are asked for; the search tools' best test only when tests are asked for and nothing imports
   the module; a test harness (`tests/index.ts` without `.test`) is never a test. A new test file only when the
   request asks for a test of a name it states, no test file carries that name, and no existing test reaches the
   module (placed in the dominant test directory, in its naming style).
6. Steps: one `edit-source` per source (or `add-function-or-member` / `edit-constant` / `re-export-from-entry` as the
   missing skill), one `edit-test`/`add-test` per test file, then `run-tests` (`can-do` only for a `targets.json`
   repo, rule `pipeline:job-b-tests`, as in v1). `missingSkills` lists the distinct missing capabilities.

## Can-do (soundness)

A step is `can-do` only when an approved rule (`approvedRules`, `id@specHash`) run through `applyRule` on an
objective edits exactly that step's file (`edit.path` or an `extra` path). Objectives are the request's own
sentences, plus compositions into the rules' phrasings built only from names and literal values the request states
(`set X to LITERAL`, `X should throw CODE when cond`, `in X, replace condition|return A with B`) with the request's own
bullet lines (the rules' example grammar). Nothing is invented: no literal, code, condition or example is made up.
The grader re-runs the same rule on the same objective (`verifyCanDo`), so a claim it cannot reproduce counts against
accuracy. On the public dev set no request states its change in a rule's grammar, so v2 claims no can-do there (the
honest rate is 0); M149 shows a real claim on a fixture (a guard with its example), verified by the unchanged grader.
The test-writing rules need a fix commit or a characterization bullet list and write a new file, so they never cover
"extend this existing test": those steps stay `extend-existing-test`.

## What is measured, and the limits

The public dev score is a DEVELOPMENT score: v2 was built while reading the public wording (never the hidden half,
whose file the runner reads only to plan and grade). Overfit risk is real with 12 tasks; the M149 fixtures are two
code shapes unlike the public repos, and each condition has an admit case and a refused near miss. The hidden half
is the measure. The component-noun list and the stemmer are general English, not tuned to a project.

## Runner changes

- `Checkout.dir`: the git checkout directory (v2 searches it read-only; `unchanged()` still proves nothing was
  written). A fetcher without a directory (test fixtures) gets a temp copy of its files, removed after planning.
- `plannerSha256(planner)`: v1 covers plan.ts, plangrade.ts, planrun.ts as before (its value changes because
  planrun.ts changed); v2 adds plan2.ts. Rows carry `planner` = `plan-only-v1` | `plan-only-v2`; old rows are untouched
  (add-only log).
