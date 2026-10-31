# PLAN-ONLY default planner

Status: draft for Auditor review (Builder, 2026-10-30; default switched to v4 2026-10-31). The default planner is
`plan-only-v4`. It was `plan-only-v3` from #650 until this switch; v3 stays selectable (`--planner=v3`, status RUNNABLE).

## Where the default is decided

Only in `peaceai/lib/plandefault.ts` (`DEFAULT_PLANNER`, `PLANNERS`, `selectPlanner`). The entry point callers use
for "the default planner" is `peaceai/bin/plan.ts`:

- `tsx peaceai/bin/plan.ts run <taskfile>` runs the default (v4).
- `tsx peaceai/bin/plan.ts run --planner=v1|v2|v3|v4 <taskfile>` (or the full `plan-only-vN` name) runs that planner.
  Any other value is refused `PLANNER_UNKNOWN` (exit 2) before anything is loaded or run.
- `tsx peaceai/bin/plan.ts lock <taskfile>` is the same lock as `plan-only.ts lock` (one lock serves every planner).

The per-planner CLIs are unchanged: `bin/plan-only.ts` (v1, and `lock`), `bin/plan-only-v2.ts`, `bin/plan-only-v3.ts`; (M164)
`bin/plan-only-v4.ts` for v4 (`plan-only-v4.md`). Adding v4 changed no v1/v2/v3 file, and making it the default
changed no planner file: v4's plannerSha256 b667d518... is the digest the Auditor scored on the hidden half.

## Why this route

Making v3 the default by editing v1's files (lib/plan.ts, lib/plangrade.ts, lib/planrun.ts, bin/plan-only.ts) would
move v1's plannerSha256 or change what `plan-only.ts` means for every existing caller and row. A separate selection
module plus a new entry point changes no planner file: v1 275e559b..., v2 fae6c0c4..., v3 f4999797..., v4 b667d518... are unchanged.

## Evidence (honest)

Hidden half (Auditor, 20/20 graded): v3 0.287 (runTests 0.300), v1 0.229 (runTests 0.350), v2 0.223 (runTests
0.250). The switch rests on 20 hidden tasks with a noisy +0.058 margin. v3's runTests is below v1's.
That switch (v1 -> v3) rested on 20 hidden tasks with a noisy +0.058 margin.

v4 is the default since the switch after #658: hidden 0.337 vs 0.287, gain on 3 of 20 tasks. Hidden half (Auditor, 20/20 graded at eb4d135, v4
plannerSha256 b667d518...): v4 mean 0.337 (runTests 0.450), v3 rerun 0.287 (runTests 0.300; it reproduces v3's
committed hidden rows exactly), v1 0.229 (runTests 0.350). Per task v4 wins 3, loses 0 and ties 17: the margin rests
on 3 tasks out of 20, so it is small and could be noise. Dev (public split): v4 runTests 0.833 vs v3's 0.667.

## Tests

`peaceai/test/m154-plan-default.test.ts`: the default is v4; v1/v2/v3/v4 stay selectable (v3 RUNNABLE); near-miss flags are refused;
the four plannerSha256 values are unchanged; a mutation check (each mutant of lib/plandefault.ts must fail a check).
