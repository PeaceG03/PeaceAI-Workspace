import { createHash } from "node:crypto";
import type { TestGrading } from "./results.ts";

export interface CandidateResult {
  id: string;
  diffBytes: number;
  diffLines: number;
  applied: boolean;
  typecheckPassed: boolean;
  originalSuitePassed: boolean;
  newTestsPassed: boolean;
  newTestFiles: number;
  /** M12: a learned test's grading against its fix commit (written by the Job B harness). */
  testGrading?: TestGrading;
}

export function isPassing(candidate: CandidateResult): boolean {
  return candidate.applied && candidate.typecheckPassed && candidate.originalSuitePassed && candidate.newTestsPassed;
}

/** Deterministic ranking: original suite first, then smallest diff, then id for a stable tie-break. */
export function rankCandidates(candidates: readonly CandidateResult[]): CandidateResult[] {
  return [...candidates].sort(
    (left, right) =>
      Number(right.originalSuitePassed) - Number(left.originalSuitePassed) ||
      left.diffLines - right.diffLines ||
      left.diffBytes - right.diffBytes ||
      left.id.localeCompare(right.id),
  );
}

/** Seeded Fisher-Yates shuffle so the PR body order is not the ranking order. */
export function shuffle<T>(items: readonly T[], seed: string): T[] {
  const out = [...items];
  let counter = 0;
  const next = (): number => {
    const digest = createHash("sha256").update(`${seed}:${counter++}`).digest();
    return digest.readUInt32BE(0) / 0x1_0000_0000;
  };
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(next() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}
