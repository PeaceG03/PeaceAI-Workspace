// Experimental. credit is false. Turns one builder-log row into a Job A replay record.
// A pass is only a Job A summary that contains a candidate. Anything not run stays unmeasured.
import type { ReplayBind, ReplayRecord } from "./capabilityreport.ts";

export const CORE_ENTRY = "packages/coding-kernel/src/ActionsKernel.ts";
const SHA_REF = /(PeaceSTOCKS|PeaceAI-Workspace)@([0-9a-f]{7,40})/g;

export interface CommitRef { repo: "PeaceSTOCKS" | "PeaceAI-Workspace"; sha: string }

export function commitRef(changed: string): CommitRef | null {
  const found = [...changed.matchAll(SHA_REF)];
  const first = found[0];
  if (!first) return null;
  return { repo: first[1] as CommitRef["repo"], sha: first[2]! };
}

/** Why this row cannot be handed to Job A. Null means the row has a repo@sha. */
export function rowUnrunnable(changed: string): string | null {
  if (commitRef(changed)) return null;
  return "NO_COMMIT: changed has no PeaceSTOCKS@sha or PeaceAI-Workspace@sha";
}

export function classifyJobOutput(o: { timedOut: boolean; code: number | null; candidates: number | null; stdout: string }): { status: "pass" | "fail" | "unmeasured"; reason: string } {
  if (o.timedOut) return { status: "unmeasured", reason: "TIMEOUT" };
  if (o.code === null) return { status: "unmeasured", reason: "SPAWN_FAILED" };
  if (o.candidates === null) return { status: "unmeasured", reason: `NO_SUMMARY: exit ${o.code}` };
  if (o.candidates > 0) return { status: "pass", reason: `JOB_A_CANDIDATES:${o.candidates}` };
  const nl = /nl=unsure reason=(\S+)/.exec(o.stdout);
  if (nl) return { status: "fail", reason: `NL_${nl[1]}` };
  const refused = /learned refusals: (\S+)/.exec(o.stdout);
  if (refused) return { status: "fail", reason: `NO_CANDIDATE:${refused[1]!.slice(0, 120)}` };
  return { status: "fail", reason: "NO_CANDIDATE" };
}

export function boundReplay(seq: number, status: ReplayRecord["status"], reason: string, bind: ReplayBind): ReplayRecord {
  return { seq, status, reason, head: bind.head, tree: bind.tree, input: bind.input };
}
