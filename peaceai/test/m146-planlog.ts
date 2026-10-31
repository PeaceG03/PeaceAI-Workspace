// M146 plan-log guard: plan run rows legitimately land via PRs (e.g. #641, #644), so a branch may APPEND to
// peaceai/plan/runs.jsonl but never rewrite it. Each guard is one line tagged "// guard:<id>"; the M146 mutation
// test deletes each one in a copy and requires a case in m146-planlog-cases.ts to fail.
import { logRowProblem } from "../lib/plangrade.ts";

const parsed = (line: string): unknown => { try { return JSON.parse(line); } catch { return undefined; } };

/** null when `branch` is `main` plus whole lines each valid per the planrun row validator (logRowProblem). */
export function planLogAddOnlyProblem(main: string, branch: string): string | null {
  if (!branch.startsWith(main)) return "rewritten"; // guard:plan-log-prefix
  if (main.length > 0 && !main.endsWith("\n")) return "main_no_final_newline"; // guard:plan-log-main-newline
  const added = branch.slice(main.length);
  if (added.length > 0 && !added.endsWith("\n")) return "no_final_newline"; // guard:plan-log-newline
  const lines = added.split("\n").slice(0, -1);
  for (const line of lines) {
    const o = parsed(line);
    const p = o === undefined ? "json" : logRowProblem(o); // the planrun row validator
    if (p) return `row:${p}`; // guard:plan-log-rows
  }
  return null;
}
