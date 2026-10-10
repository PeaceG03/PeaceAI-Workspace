// M7: the repair record the Job B harness writes per candidate, checked before Job B2 and Job C use it.
import type { IterationRecord } from "./repairloop.ts";
import { RULES } from "./repair.ts";

export const REPAIR_STOPS = ["NOT_NEEDED", "GREEN", "NO_RULE", "NO_PROGRESS", "BUDGET_ITERATIONS", "BUDGET_TIME", "EDIT_REFUSED", "GATE_REJECTED"] as const;

export interface StoredRepairRecord {
  schema: "peaceai-repair:v1";
  id: string;
  stop: (typeof REPAIR_STOPS)[number];
  rounds: number;
  originalDiffSha256: string;
  repairedDiffSha256: string | null;
  jobBGate: string;
  original: { typecheckPassed: boolean; originalSuitePassed: boolean; newTestsPassed: boolean };
  originalNewTestFiles: number;
  iterations: IterationRecord[];
  regate?: "pass" | "core-gate-rejected" | "hash-mismatch";
}

const HEX64 = /^[0-9a-f]{64}$/;
const isBool = (v: unknown) => typeof v === "boolean";

export function validateRepairRecord(value: unknown): value is StoredRepairRecord {
  if (!value || typeof value !== "object") return false;
  const r = value as Record<string, unknown>;
  if (r.schema !== "peaceai-repair:v1" || typeof r.id !== "string" || !/^candidate-[1-5]$/.test(r.id)) return false;
  if (!REPAIR_STOPS.includes(r.stop as never) || !Number.isInteger(r.rounds) || (r.rounds as number) < 0 || (r.rounds as number) > 20) return false;
  if (typeof r.originalDiffSha256 !== "string" || !HEX64.test(r.originalDiffSha256)) return false;
  if (r.repairedDiffSha256 !== null && (typeof r.repairedDiffSha256 !== "string" || !HEX64.test(r.repairedDiffSha256))) return false;
  if (r.repairedDiffSha256 !== null && r.stop !== "GREEN") return false;
  if (typeof r.jobBGate !== "string" || !/^[a-z-]{1,20}$/.test(r.jobBGate)) return false;
  const o = r.original as Record<string, unknown> | undefined;
  if (!o || !isBool(o.typecheckPassed) || !isBool(o.originalSuitePassed) || !isBool(o.newTestsPassed)) return false;
  if (!Number.isInteger(r.originalNewTestFiles)) return false;
  if (r.regate !== undefined && !["pass", "core-gate-rejected", "hash-mismatch"].includes(r.regate as string)) return false;
  if (!Array.isArray(r.iterations) || r.iterations.length === 0 || r.iterations.length > 21) return false;
  return r.iterations.every((it: Record<string, unknown>, i: number) => {
    return (
      it.round === i &&
      isBool(it.typecheck) && isBool(it.originalSuite) && isBool(it.newTests) &&
      Number.isInteger(it.errorCount) &&
      Array.isArray(it.errors) && it.errors.length <= 20 &&
      Array.isArray(it.applied) &&
      (it.applied as Record<string, unknown>[]).every(
        (a) => RULES.includes(a.rule as never) && typeof a.path === "string" && Number.isInteger(a.line) && (a.placeholder === undefined || a.placeholder === true),
      )
    );
  });
}

/** M7.1: the shown diff is the repaired one (re-gated and used by Job B2). */
export const isRepaired = (r: Pick<StoredRepairRecord, "regate">): boolean => r.regate === "pass";
/** M7.1: the shown diff contains a placeholder value inserted by a repair rule. */
export const hasPlaceholder = (r: Pick<StoredRepairRecord, "regate" | "iterations">): boolean =>
  isRepaired(r) && r.iterations.some((it) => it.applied.some((a) => a.placeholder === true));
