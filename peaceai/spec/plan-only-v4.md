# PLAN-ONLY mode v4 (planner `plan-only-v4`)

Status: EXPERIMENTAL (Builder, 2026-10-31). v3 stays the default (`peaceai/lib/plandefault.ts`, see
`plan-default.md`) and its files are byte-identical (plannerSha256 f4999797...). v4 runs via
`peaceai/bin/plan.ts run --planner=v4 <taskfile>`, `peaceai/bin/plan-only-v4.ts run <taskfile>`, or the loop's
`--planner v4`. Evidence: development set and synthetic fixtures only; v4 has NOT been run on the hidden half.

Files: `peaceai/lib/plan4.ts` (planner: a copy of plan3.ts plus one rule), `peaceai/lib/plan4run.ts` (runner: a copy
of plan3run.ts with v4's planner), `peaceai/bin/plan-only-v4.ts` (CLI). `plannerSha256V4` = sha256 over the bytes of
`lib/plan4.ts`, `lib/plangrade.ts` and `lib/plan4run.ts`, in that order (same construction as v3 with v4's files).
Grader `plan-grade-v2` is unchanged. No protected file is added or changed.

## Why v4 (what was wrong with v3's run-tests)

On the hidden half v3's runTests is 0.300, below v1's 0.350. The hidden rows were not read for this work. On the
development split (12 public tasks) v3's runTests is 0.667, the same as v1's. Looking at the dev rows: v3's test
COMMAND already has the reference's exact form on 7 of 12 tasks (the targeted vitest / jest / ava form; v1 matches
0 of 12 by command and gets its runTests from test files). Where v3 misses, the cause is the test FILE it picks, not
how it builds the command:

- v3 picks a source's test by imports (`testsFor`, `rule:test-direct`). When the request names a function whose test
  file is named after it, but an aggregate or typings test imports the source more directly, v3 picks the aggregate
  (2 of the 4 dev misses).
- The other 2 dev misses need a test file the request does not name (one does not exist at the pinned commit). No
  general rule fixes them, and none was added for them.
- Reference commands that are hand-written build chains (mocha behind a compile step) cannot be matched by a rule
  that reads the project; they are left alone.

## The rule (M164)

Before v3's import-based pick, v4 looks for existing behavior tests (`isBehaviorTest`, so helpers, fixtures, setup and
type tests never count) whose file stem equals a code name the request states, ignoring case and separators
(`rule:test-named`). Only a test in the package of one of the plan's sources counts (`rule:test-named-package`; any
package when the plan has no source), and only when exactly one file fits that name (`rule:test-named-unique`, so an
ambiguous name falls back to v3). Names the request states as plain names come first; a name that appears only
inside a code example is used only when no plain name fits (`rule:test-named-examples-last`). When a named test is
found it replaces v3's pick; otherwise v3's pick runs unchanged (`rule:test-named-first`). The test command is then
built exactly as v3 builds it, so it targets the named file. Nothing in the rule names a repository, task or file.

## Scores (honest)

Development split (12 public tasks, planned and graded offline; dev scores are development scores, not proof):

| planner | runTests | testRecall | score |
| --- | --- | --- | --- |
| v3 (before) | 0.667 | 0.667 | 0.681 |
| v4 (after) | 0.833 | 0.833 | 0.764 |

v4 gains 2 tasks and loses none; the other 10 plans' test files are identical. Synthetic (m164 fixtures, 7 tasks: 3
where the team's test is named after the stated function, 4 near misses where it is not): runTests v3 3/7, v4 7/7.
All 45 M153 cases (v3's rules on three code shapes) hold on v4. The hidden-half effect is unknown: the dev gain rests
on 2 tasks, and v2 (1.000 dev, 0.223 hidden) shows how far dev can mislead. A default switch needs a hidden run.

## Tests

`peaceai/test/m164-plan-v4.test.ts` (+ `m164-cases.ts`, `m164-fixtures.ts`): plan4.ts equals plan3.ts outside the
renames and the rule block (so M153's mutants keep covering every inherited line); every M153 case holds on v4; an
admit case and a refused near miss per new rule; a mutation check (each new tagged rule removed must fail a case);
a generality check; the synthetic runTests before/after; the wiring (v4 selectable and EXPERIMENTAL, v3 default and
byte-identical, own digest) and the runner's rows.
