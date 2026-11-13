// Mixed-practice replay grades. credit: false. A pass is only GATE PASS plus the recorded test
// going from fail to pass, and, for a test-as-spec candidate, a strict behavioral match.
// Unmeasured is never a pass. Held-out rows keep the shape and the counts, not the diff.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Behavior, BehaviorCounterexample } from "./specgrade.ts";
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
  /**
   * Set only after the given test and the original suite passed. verified_test_only and
   * diff_unavailable are not passes. Absent on text rows and on rows that produced no candidate.
   */
  behavior?: Behavior;
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
  /** Test-as-spec only. Sanitized runner facts. No host paths and no environment values. */
  diagnostic?: { kind: string; code: number | null; command: string[]; lines: string[] };
  /** Present when a candidate passed the given test and the original suite. */
  fit?: {
    shape: string;
    examples: number;
    behavior: Behavior;
    /** The candidate diff. Replay keeps it for dev rows and drops it for held-out rows. */
    diff?: string;
    /** One sanitized input where the candidate and the fix disagreed. Dev rows only. */
    counterexample?: BehaviorCounterexample;
  };
  /** Sanitized install log from the fingerprint install. Present when that install did not produce a tree. */
  lines?: string[];
  /** Recorded test exit before the candidate, when the row ran that test. */
  beforeExit?: number;
  /** Recorded test exit after the candidate. */
  afterExit?: number;
}

/** One row. Unmeasured never comes back as pass. A pass requires GATE PASS and fail-before/pass-after. */
export function gradePracticeRow(input: GradeInput): { status: RowStatus; reason: string; gap: boolean; beforeExit?: number; afterExit?: number } {
  const exits: { beforeExit?: number; afterExit?: number } = {};
  if (typeof input.beforeExit === "number") exits.beforeExit = input.beforeExit;
  if (typeof input.afterExit === "number") exits.afterExit = input.afterExit;
  const row = (status: RowStatus, reason: string, gap: boolean) => ({ status, reason, gap, ...exits });
  if (!input.scorable) return row("unmeasured", "GATE_NO_TARGET", true);
  if (input.core !== "ok") return row("unmeasured", "NO_CORE", true);
  if (!input.job) return row("unmeasured", "NOT_RUN", true);
  if (input.job.status === "unmeasured") return row("unmeasured", input.job.reason, true);
  if (input.job.status === "fail") return row("fail", input.job.reason, true);
  if (input.behavior === "verified_test_only") return row("fail", "VERIFIED_TEST_ONLY", true);
  if (input.behavior === "diff_unavailable") return row("fail", "DIFF_UNAVAILABLE", true);
  if (!input.gatePass) return row("fail", "GATE_FAIL", false);
  if (input.beforeExit === null || input.afterExit === null) return row("unmeasured", "TEST_NOT_RUN", true);
  if (input.beforeExit === 0) return row("unmeasured", "TEST_BASE_NOT_FAILING", true);
  if (input.afterExit !== 0) return row("fail", "TEST_STILL_FAILS", false);
  return row("pass", "GATE_PASS_AND_TEST", false);
}

/**
 * Public GATE_FAIL text is a short kind. URLs are removed and anything from `core-path:` on is dropped.
 * There is no local debug file for the full gate line, so the rest of the message is not kept.
 */
export function publishedReason(reason: string): string {
  if (!/^GATE[_ ]FAIL\b/.test(reason)) return reason;
  let msg = reason.replace(/^GATE[_ ]FAIL:?\s*/, "");
  msg = msg.replace(/https?:\/\/\S+/gi, " ");
  const cut = msg.search(/core-path:/i);
  if (cut >= 0) msg = msg.slice(0, cut);
  let kind = "";
  if (/no scope/i.test(msg)) kind = "no-scope";
  else {
    const known = msg.match(/\b(core-text|scope|core-index|leak)\b/i);
    kind = known ? known[1]!.toLowerCase() : "";
  }
  return kind ? `GATE_FAIL:${kind}` : "GATE_FAIL";
}

/** Held-out diagnostics keep kind and exit code. The command, test path, and failure lines stay on dev rows. */
export function publishedDiagnostic(row: Pick<GradedRow, "split" | "diagnostic">): GradedRow["diagnostic"] | { kind: string; code: number | null } | undefined {
  if (!row.diagnostic) return undefined;
  if (row.split === "dev") return row.diagnostic;
  return { kind: row.diagnostic.kind, code: row.diagnostic.code };
}

/** One public row. Held-out rows keep counts, reasons, exit codes, and diagnostic.kind plus code. */
export function gapRecord(row: GradedRow): Record<string, unknown> {
  const fit = publishedFit(row);
  const diagnostic = publishedDiagnostic(row);
  const dev = row.split === "dev";
  return {
    repo: row.repo, split: row.split, fixSha: row.fixSha, understanding: row.understanding ?? "text", status: row.status, reason: publishedReason(row.reason),
    ...(typeof row.beforeExit === "number" ? { beforeExit: row.beforeExit } : {}),
    ...(typeof row.afterExit === "number" ? { afterExit: row.afterExit } : {}),
    ...(dev && row.lines && row.lines.length ? { lines: row.lines } : {}),
    ...(diagnostic ? { diagnostic } : {}),
    ...(fit ? { shape: fit.shape, examples: fit.examples, behavior: fit.behavior, ...(fit.diff ? { diff: fit.diff } : {}), ...(fit.counterexample ? { counterexample: fit.counterexample } : {}) } : {}),
  };
}

/** Write replay.json and gaps.jsonl. Both go through gapRecord, so a held-out row cannot keep lines or a command. */
export function writePracticeOutputs(out: string, rows: readonly GradedRow[]): void {
  const doc = replayDocument(rows);
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, "replay.json"), JSON.stringify(doc, null, 2) + "\n");
  const gaps = rows.filter((row) => row.gap || row.fit).map((row) => JSON.stringify(gapRecord(row)));
  writeFileSync(join(out, "gaps.jsonl"), gaps.join("\n") + (gaps.length ? "\n" : ""));
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
    const reason = publishedReason(row.reason);
    bag.reasons[reason] = (bag.reasons[reason] ?? 0) + 1;
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

export interface BehaviorCounts { verified_strict: number; verified_test_only: number; diff_unavailable: number }

/** Headline passes stay in `counts`. These are the behavioral outcomes, reported separately. */
export function behaviorBySplit(rows: readonly Pick<GradedRow, "split" | "fit">[]): { dev: BehaviorCounts; "held-out": BehaviorCounts } {
  const empty = (): BehaviorCounts => ({ verified_strict: 0, verified_test_only: 0, diff_unavailable: 0 });
  const out = { dev: empty(), "held-out": empty() };
  for (const row of rows) {
    const behavior = row.fit?.behavior;
    if (behavior) out[row.split][behavior] += 1;
  }
  return out;
}

/** Fields safe to publish. Held-out rows keep the shape and the counts, not the diff or a counterexample. */
export function publishedFit(row: Pick<GradedRow, "split" | "fit">): { shape: string; examples: number; behavior: Behavior; diff?: string; counterexample?: BehaviorCounterexample } | undefined {
  if (!row.fit) return undefined;
  const dev = row.split === "dev";
  return {
    shape: row.fit.shape,
    examples: row.fit.examples,
    behavior: row.fit.behavior,
    ...(dev && row.fit.diff ? { diff: row.fit.diff } : {}),
    ...(dev && row.fit.counterexample ? { counterexample: row.fit.counterexample } : {}),
  };
}

/** Public replay file. Counts, reasons, and the protected-function note. No subjects or core text. */
export function replayDocument(rows: readonly GradedRow[]): {
  schema: typeof REPLAY_SCHEMA;
  experimental: true;
  credit: false;
  protectedFunction: string;
  protectedFile: string;
  protectedWhy: string;
  counts: ReturnType<typeof countsByUnderstanding>;
  behavior: ReturnType<typeof behaviorBySplit>;
  rows: { repo: string; split: GradedRow["split"]; fixSha: string; understanding: Understanding; status: RowStatus; reason: string; diagnostic?: GradedRow["diagnostic"]; shape?: string; examples?: number; behavior?: Behavior; diff?: string; counterexample?: BehaviorCounterexample; lines?: string[] }[];
} {
  return {
    schema: REPLAY_SCHEMA,
    experimental: true,
    credit: false,
    protectedFunction: PROTECTED_GATE_FUNCTION,
    protectedFile: PROTECTED_GATE_FILE,
    protectedWhy: PROTECTED_GATE_WHY,
    counts: countsByUnderstanding(rows),
    behavior: behaviorBySplit(rows),
    rows: rows.map((row) => gapRecord(row) as {
      repo: string; split: GradedRow["split"]; fixSha: string; understanding: Understanding; status: RowStatus; reason: string;
      diagnostic?: GradedRow["diagnostic"]; shape?: string; examples?: number; behavior?: Behavior; diff?: string; counterexample?: BehaviorCounterexample; lines?: string[];
    }),
  };
}
