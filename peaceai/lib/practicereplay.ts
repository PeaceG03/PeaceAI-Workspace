// Mixed-practice replay grades. credit: false. A pass is only GATE PASS plus the recorded test
// going from fail to pass. Unmeasured is never a pass. Nothing from the core is stored here.
import { loadTargets } from "./target.ts";

export const REPLAY_SCHEMA = "peaceai-practice-replay:v1";

/**
 * The protected function a non-PeaceSTOCKS row would need.
 * peaceai/bin/gate.ts loads targets.json and, for any other name, prints
 * `GATE FAIL target has no scope config` and exits before gateCandidate.
 * checkCandidateScope is what then scores a diff, and its default WORKSPACE_SCOPE
 * only allows ^src/…\.ts$. Neither file is edited by this practice set.
 */
export const PROTECTED_GATE_FUNCTION = "checkCandidateScope";
export const PROTECTED_GATE_FILE = "peaceai/lib/scope.ts";
export const PROTECTED_GATE_WHY = "peaceai/bin/gate.ts refuses a target that is not in peaceai/targets.json before it calls gateCandidate. checkCandidateScope (peaceai/lib/scope.ts) is the function that would have to score any other repository; its default is WORKSPACE_SCOPE, which only allows ^src/…\\.ts$. generate.ts throws the same missing-target error, so Job A does not produce a candidate the gate can accept. Neither protected file was edited.";

export type RowStatus = "pass" | "fail" | "unmeasured";
/** Which task form this row was graded as. Text is the subject alone. Test-as-spec is the failing test. */
export type Understanding = "text" | "test-as-spec";

export interface GradeInput {
  /** True only when this repo is a key of peaceai/targets.json. */
  scorable: boolean;
  /** "ok" when the pinned core archive was built. Ignored when the row is not scorable. */
  core: "ok" | "missing";
  /** Job A classifyJobOutput result. Null when Job A was not started. */
  job: { status: RowStatus; reason: string } | null;
  /** True only when gate.ts printed GATE PASS. */
  gatePass: boolean;
  /** Recorded test on the base plus the test file, before the candidate. Null if not run. */
  beforeExit: number | null;
  /** Same test after the candidate was applied. */
  afterExit: number | null;
}

export interface GradedRow {
  repo: string;
  split: "dev" | "held-out";
  fixSha: string;
  status: RowStatus;
  reason: string;
  gap: boolean;
  /** Absent on a row built before test-as-spec. Those rows are the text form. */
  understanding?: Understanding;
}

/** One row. Unmeasured never comes back as pass. A pass requires GATE PASS and fail-before/pass-after. */
export function gradePracticeRow(input: GradeInput): { status: RowStatus; reason: string; gap: boolean } {
  if (!input.scorable) return { status: "unmeasured", reason: "GATE_NO_TARGET", gap: true };
  if (input.core !== "ok") return { status: "unmeasured", reason: "NO_CORE", gap: true };
  if (!input.job) return { status: "unmeasured", reason: "NOT_RUN", gap: true };
  if (input.job.status === "unmeasured") return { status: "unmeasured", reason: input.job.reason, gap: true };
  if (input.job.status === "fail") return { status: "fail", reason: input.job.reason, gap: true };
  if (!input.gatePass) return { status: "fail", reason: "GATE_FAIL", gap: false };
  if (input.beforeExit === null || input.afterExit === null) return { status: "unmeasured", reason: "TEST_NOT_RUN", gap: true };
  if (input.beforeExit === 0) return { status: "unmeasured", reason: "TEST_BASE_NOT_FAILING", gap: true };
  if (input.afterExit !== 0) return { status: "fail", reason: "TEST_STILL_FAILS", gap: false };
  return { status: "pass", reason: "GATE_PASS_AND_TEST", gap: false };
}

export function targetIsScorable(repo: string, names: readonly string[] = Object.keys(loadTargets().targets)): boolean {
  return names.some((name) => name.toLowerCase() === repo.toLowerCase());
}

export interface SplitCounts { pass: number; fail: number; unmeasured: number; reasons: Record<string, number> }

export function countBySplit(rows: readonly Pick<GradedRow, "split" | "status" | "reason">[]): { dev: SplitCounts; "held-out": SplitCounts } {
  const empty = (): SplitCounts => ({ pass: 0, fail: 0, unmeasured: 0, reasons: {} });
  const out = { dev: empty(), "held-out": empty() };
  for (const row of rows) {
    const bag = out[row.split];
    if (row.status === "pass") bag.pass++;
    else if (row.status === "fail") bag.fail++;
    else bag.unmeasured++;
    bag.reasons[row.reason] = (bag.reasons[row.reason] ?? 0) + 1;
  }
  return out;
}

/** Text rows and test-as-spec rows stay in separate counts. A row with no form is text. */
export function countsByUnderstanding(rows: readonly Pick<GradedRow, "split" | "status" | "reason" | "understanding">[]): Record<Understanding, ReturnType<typeof countBySplit>> {
  return {
    text: countBySplit(rows.filter((row) => (row.understanding ?? "text") === "text")),
    "test-as-spec": countBySplit(rows.filter((row) => row.understanding === "test-as-spec")),
  };
}

/** Public replay file. Counts, reasons, and the protected-function note. No diffs, subjects, or core text. */
export function replayDocument(rows: readonly GradedRow[]): {
  schema: typeof REPLAY_SCHEMA;
  experimental: true;
  credit: false;
  protectedFunction: string;
  protectedFile: string;
  protectedWhy: string;
  counts: ReturnType<typeof countsByUnderstanding>;
  rows: { repo: string; split: GradedRow["split"]; fixSha: string; understanding: Understanding; status: RowStatus; reason: string }[];
} {
  return {
    schema: REPLAY_SCHEMA,
    experimental: true,
    credit: false,
    protectedFunction: PROTECTED_GATE_FUNCTION,
    protectedFile: PROTECTED_GATE_FILE,
    protectedWhy: PROTECTED_GATE_WHY,
    counts: countsByUnderstanding(rows),
    rows: rows.map((row) => ({ repo: row.repo, split: row.split, fixSha: row.fixSha, understanding: row.understanding ?? "text", status: row.status, reason: row.reason })),
  };
}
