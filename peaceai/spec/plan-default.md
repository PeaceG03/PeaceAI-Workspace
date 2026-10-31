# PLAN-ONLY default planner

Status: draft for Auditor review (Builder, 2026-10-30). The default planner is `plan-only-v3`.

## Where the default is decided

Only in `peaceai/lib/plandefault.ts` (`DEFAULT_PLANNER`, `PLANNERS`, `selectPlanner`). The entry point callers use
for "the default planner" is `peaceai/bin/plan.ts`:

- `tsx peaceai/bin/plan.ts run <taskfile>` runs the default (v3).
- `tsx peaceai/bin/plan.ts run --planner=v1|v2|v3 <taskfile>` (or the full `plan-only-vN` name) runs that planner.
  Any other value is refused `PLANNER_UNKNOWN` (exit 2) before anything is loaded or run.
- `tsx peaceai/bin/plan.ts lock <taskfile>` is the same lock as `plan-only.ts lock` (one lock serves every planner).

The per-planner CLIs are unchanged: `bin/plan-only.ts` (v1, and `lock`), `bin/plan-only-v2.ts`, `bin/plan-only-v3.ts`.

## Why this route

Making v3 the default by editing v1's files (lib/plan.ts, lib/plangrade.ts, lib/planrun.ts, bin/plan-only.ts) would
move v1's plannerSha256 or change what `plan-only.ts` means for every existing caller and row. A separate selection
module plus a new entry point changes no planner file: v1 275e559b..., v2 fae6c0c4..., v3 f4999797... are unchanged.

## Evidence (honest)

Hidden half (Auditor, 20/20 graded): v3 0.287 (runTests 0.300), v1 0.229 (runTests 0.350), v2 0.223 (runTests
0.250). The switch rests on 20 hidden tasks with a noisy +0.058 margin. v3's runTests is below v1's.

## Tests

`peaceai/test/m154-plan-default.test.ts`: the default is v3; v1/v2/v3 stay selectable; near-miss flags are refused;
the three plannerSha256 values are unchanged; a mutation check (each mutant of lib/plandefault.ts must fail a check).
