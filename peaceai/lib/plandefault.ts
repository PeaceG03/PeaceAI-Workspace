// PLAN-ONLY default planner selection (see peaceai/spec/plan-default.md). The ONE place "the default planner" is decided.
// Pure data, no imports: callers (bin/plan.ts) load the chosen runner. v1/v2/v3 files are not touched by a default
// change, so every planner's plannerSha256 stays as on main. Evidence for v3 as default: 20 hidden tasks, v3 0.287 vs
// v1 0.229 (+0.058, noisy margin); v3's runTests 0.300 is BELOW v1's 0.350.
export type PlannerName = "plan-only-v1" | "plan-only-v2" | "plan-only-v3";
export interface PlannerEntry { name: PlannerName; module: string; run: string; status: "DEFAULT" | "RUNNABLE" | "EXPERIMENTAL" }

/** Runner module (relative to peaceai/bin) and its exported run function, per planner. */
export const PLANNERS: Readonly<Record<PlannerName, PlannerEntry>> = Object.freeze({
  "plan-only-v1": { name: "plan-only-v1", module: "../lib/planrun.ts", run: "runFile", status: "RUNNABLE" },
  "plan-only-v2": { name: "plan-only-v2", module: "../lib/plan2run.ts", run: "runFileV2", status: "EXPERIMENTAL" },
  "plan-only-v3": { name: "plan-only-v3", module: "../lib/plan3run.ts", run: "runFileV3", status: "DEFAULT" },
});

export const DEFAULT_PLANNER: PlannerName = "plan-only-v3";

/** Exact short or full names only; anything else (case, spaces, "v4", "") is refused as null. */
const ALIASES: Readonly<Record<string, PlannerName>> = Object.freeze({
  v1: "plan-only-v1", v2: "plan-only-v2", v3: "plan-only-v3",
  "plan-only-v1": "plan-only-v1", "plan-only-v2": "plan-only-v2", "plan-only-v3": "plan-only-v3",
});

/** undefined (no --planner) selects the default; a given value must be an exact known name. */
export function selectPlanner(flag: string | undefined): PlannerEntry | null {
  if (flag === undefined) return PLANNERS[DEFAULT_PLANNER];
  const n = Object.prototype.hasOwnProperty.call(ALIASES, flag) ? ALIASES[flag] : undefined;
  return n ? PLANNERS[n] : null;
}
