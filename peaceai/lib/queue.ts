import { OWNER, TASK_LABEL } from "./trigger.ts";

export const STATE = {
  queued: "peaceai:queued",
  running: "peaceai:running",
  done: "peaceai:done",
  failed: "peaceai:failed",
} as const;

export interface QueueIssue {
  number: number;
  state: string; // "open" | "closed"
  author: string;
  labels: string[];
  isPullRequest: boolean;
}

export interface LabelEvent {
  event: string; // "labeled" | "unlabeled" | ...
  label: string | undefined;
  actor: string | undefined;
}

/** The task label must currently be present and its most recent application must be by the owner. */
export function labeledByOwner(events: readonly LabelEvent[]): boolean {
  const applied = events.filter((e) => e.event === "labeled" && e.label === TASK_LABEL);
  return applied.length > 0 && applied[applied.length - 1]!.actor === OWNER;
}

export function isCandidateIssue(issue: QueueIssue): boolean {
  return (
    issue.state === "open" &&
    !issue.isPullRequest &&
    issue.author === OWNER &&
    issue.labels.includes(TASK_LABEL) &&
    !issue.labels.includes(STATE.running) &&
    !issue.labels.includes(STATE.done) &&
    !issue.labels.includes(STATE.failed)
  );
}

/**
 * Runs are serialized by one concurrency group, so any issue still marked running when a new
 * run starts belongs to a run that died; it is marked failed rather than silently retried.
 */
export function staleRunning(issues: readonly QueueIssue[]): number[] {
  return issues.filter((i) => i.state === "open" && i.labels.includes(STATE.running)).map((i) => i.number).sort((a, b) => a - b);
}

/** Oldest eligible issue first. `verified` holds issues whose label events were checked. */
export function pickNext(issues: readonly QueueIssue[], verified: ReadonlySet<number>): number | null {
  const ready = issues.filter((i) => isCandidateIssue(i) && verified.has(i.number)).map((i) => i.number);
  ready.sort((a, b) => a - b);
  return ready[0] ?? null;
}

export function remainingAfter(issues: readonly QueueIssue[], picked: number | null): number {
  return issues.filter((i) => isCandidateIssue(i) && i.number !== picked).length;
}
