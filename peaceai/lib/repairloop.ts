// M7: the bounded test-and-fix loop. Pure orchestration: evaluation (sandboxed tsc and tests), applying
// edits and the clock are injected, so the stop conditions are unit-testable without a sandbox.
import { errorFingerprint, planRepairs, sortErrors, type RepairContext, type RepairEdit, type RepairError, type RuleId } from "./repair.ts";

export interface Evaluation {
  typecheck: boolean;
  originalSuite: boolean;
  newTests: boolean;
  errors: RepairError[];
}

export type StopReason = "GREEN" | "NOT_NEEDED" | "NO_RULE" | "NO_PROGRESS" | "BUDGET_ITERATIONS" | "BUDGET_TIME" | "EDIT_REFUSED";

export interface Budget {
  maxRounds: number; // repair rounds (each followed by a re-evaluation)
  deadlineMs: number; // wall-clock budget for the whole loop
}

export const DEFAULT_BUDGET: Budget = { maxRounds: 4, deadlineMs: 300_000 };
export const MAX_RECORDED_ERRORS = 20;

export interface IterationRecord {
  round: number; // 0 = the candidate as generated
  typecheck: boolean;
  originalSuite: boolean;
  newTests: boolean;
  errorCount: number;
  errors: RepairError[];
  applied: { rule: RuleId; path: string; line: number; placeholder?: true }[];
}

export interface LoopResult {
  stop: StopReason;
  rounds: number;
  changed: boolean;
  iterations: IterationRecord[];
}

export interface LoopIO {
  evaluate: () => Evaluation;
  context: () => RepairContext;
  /** Applies one edit; returns false if the harness refuses it (path checks). */
  apply: (edit: RepairEdit) => boolean;
  now: () => number;
}

// M7.1: "green" is decided only by the exit-code booleans the harness captured (Evaluation.typecheck,
// .originalSuite, .newTests); parsed tsc/TAP text (Evaluation.errors) only chooses repairs, never green.
const green = (e: Evaluation) => e.typecheck && e.originalSuite && e.newTests;

function record(round: number, e: Evaluation, applied: IterationRecord["applied"]): IterationRecord {
  const sorted = sortErrors(e.errors);
  return {
    round,
    typecheck: e.typecheck,
    originalSuite: e.originalSuite,
    newTests: e.newTests,
    errorCount: sorted.length,
    errors: sorted.slice(0, MAX_RECORDED_ERRORS),
    applied,
  };
}

export function runRepairLoop(io: LoopIO, budget: Budget = DEFAULT_BUDGET): LoopResult {
  const start = io.now();
  const iterations: IterationRecord[] = [];
  let evaluation = io.evaluate();
  iterations.push(record(0, evaluation, []));
  if (green(evaluation)) return { stop: "NOT_NEEDED", rounds: 0, changed: false, iterations };
  const seen = new Set<string>([errorFingerprint(evaluation.errors)]);
  let changed = false;
  for (let round = 1; ; round++) {
    if (round > budget.maxRounds) return { stop: "BUDGET_ITERATIONS", rounds: round - 1, changed, iterations };
    if (io.now() - start >= budget.deadlineMs) return { stop: "BUDGET_TIME", rounds: round - 1, changed, iterations };
    const edits = planRepairs(evaluation.errors, io.context());
    if (edits.length === 0) return { stop: "NO_RULE", rounds: round - 1, changed, iterations };
    const applied: IterationRecord["applied"] = [];
    for (const edit of edits) {
      if (!io.apply(edit)) return { stop: "EDIT_REFUSED", rounds: round - 1, changed, iterations };
      applied.push({ rule: edit.rule, path: edit.path, line: edit.line, ...(edit.placeholder ? { placeholder: true as const } : {}) });
      changed = true;
    }
    if (io.now() - start >= budget.deadlineMs) {
      iterations[iterations.length - 1]!.applied = applied;
      return { stop: "BUDGET_TIME", rounds: round, changed, iterations };
    }
    evaluation = io.evaluate();
    iterations[iterations.length - 1]!.applied = applied;
    iterations.push(record(round, evaluation, []));
    if (green(evaluation)) return { stop: "GREEN", rounds: round, changed, iterations };
    const fp = errorFingerprint(evaluation.errors);
    if (seen.has(fp)) return { stop: "NO_PROGRESS", rounds: round, changed, iterations };
    seen.add(fp);
  }
}
