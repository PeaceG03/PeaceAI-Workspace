// PLAN-ONLY default planner selection (see peaceai/spec/plan-default.md). The ONE place "the default planner" is decided.
// Pure data, no imports: callers (bin/plan.ts) load the chosen runner. v1/v2/v3/v4 files are not touched by a default
// change, so every planner's plannerSha256 stays as on main. Evidence for v4 as default (switch after #658): hidden 0.337 vs 0.287,
// gain on 3 of 20 tasks (Auditor, 20 hidden tasks at eb4d135; v4 runTests 0.450, v3 0.300, v1 0.350; v4 wins 3,
// loses 0, ties 17), so the margin rests on 3 tasks out of 20. v3 (the default from #650 until this switch) stays selectable.
export type PlannerName = "plan-only-v1" | "plan-only-v2" | "plan-only-v3" | "plan-only-v4";
export interface PlannerEntry { name: PlannerName; module: string; run: string; status: "DEFAULT" | "RUNNABLE" | "EXPERIMENTAL" }

/** Runner module (relative to peaceai/bin) and its exported run function, per planner. */
export const PLANNERS: Readonly<Record<PlannerName, PlannerEntry>> = Object.freeze({
  "plan-only-v1": { name: "plan-only-v1", module: "../lib/planrun.ts", run: "runFile", status: "RUNNABLE" },
  "plan-only-v2": { name: "plan-only-v2", module: "../lib/plan2run.ts", run: "runFileV2", status: "EXPERIMENTAL" },
  "plan-only-v3": { name: "plan-only-v3", module: "../lib/plan3run.ts", run: "runFileV3", status: "RUNNABLE" },
  "plan-only-v4": { name: "plan-only-v4", module: "../lib/plan4run.ts", run: "runFileV4", status: "DEFAULT" },
});

export const DEFAULT_PLANNER: PlannerName = "plan-only-v4";

/** Exact short or full names only; anything else (case, spaces, "v5", "") is refused as null. */
const ALIASES: Readonly<Record<string, PlannerName>> = Object.freeze({
  v1: "plan-only-v1", v2: "plan-only-v2", v3: "plan-only-v3", v4: "plan-only-v4",
  "plan-only-v1": "plan-only-v1", "plan-only-v2": "plan-only-v2", "plan-only-v3": "plan-only-v3", "plan-only-v4": "plan-only-v4",
});

/** undefined (no --planner) selects the default; a given value must be an exact known name. */
export function selectPlanner(flag: string | undefined): PlannerEntry | null {
  if (flag === undefined) return PLANNERS[DEFAULT_PLANNER];
  const n = Object.prototype.hasOwnProperty.call(ALIASES, flag) ? ALIASES[flag] : undefined;
  return n ? PLANNERS[n] : null;
}
