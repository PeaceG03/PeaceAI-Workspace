// Experimental. credit is false. Turns one builder-log row into a Job A replay record.
// A pass is only a Job A summary that contains a candidate. Anything not run stays unmeasured.
import type { ReplayBind, ReplayRecord } from "./capabilityreport.ts";
import { parseExistingTestTask, TEST_EXISTING_TRIGGER } from "./learned-test-existing.ts";
import { isCanonical } from "./nlparse.ts";
import { canonicalRequest } from "./requestfamily.ts";
import { cleanIssueText, MAX_OBJECTIVE_CHARS } from "./taskmap.ts";

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
  // formatRefusals joins reasons with "; ", so the line is not one token. Keep every reason on that line.
  const refused = /learned refusals: ([^\n]+)/.exec(o.stdout);
  if (refused) return { status: "fail", reason: `NO_CANDIDATE:${refused[1]!.trim().slice(0, 400)}` };
  return { status: "fail", reason: "NO_CANDIDATE" };
}

/** The one PeaceAI-Workspace issue the row cites. Two numbers, or none, stay unset. */
export function citedIssue(asked: string): number | null {
  const ns = [...new Set([...asked.matchAll(/PeaceAI-Workspace#(\d+)/g)].map((m) => Number(m[1])))];
  return ns.length === 1 ? ns[0]! : null;
}

/**
 * The tree the landing commit was applied to. Job A replayed the result commit, where the new test
 * file is already present, so an approved create-file rule refused it. A non-sha is not a parent.
 */
export function landingParent(sha: string): string | null {
  if (!/^[0-9a-f]{7,40}$/.test(sha)) return null;
  return `${sha}^1`;
}

const TASK_HEADER = new RegExp(TEST_EXISTING_TRIGGER, "i");

/** The ISSUE_TITLE Job A passes for this row. generate.ts spends it inside the objective budget. */
export function replayIssueTitle(seq: number): string {
  return `builder-log seq ${seq}`;
}

/**
 * The issue body Job A should read, only when it is the same characterization task the log already
 * named and the approved rule can parse its checks. Anything else is refused and the log line stands.
 * Validation uses the same title generate will see. A cleaned text that fills the objective budget
 * may have sliced a check into a different value, so it is refused. The raw body is returned only
 * when that titled text is uncut and the same task.
 */
export function adoptIssueBody(asked: string, issueBody: string, seq: number): string | null {
  if (!issueBody.trim() || issueBody.length > 8000) return null;
  const header = canonicalRequest("TEST_CASE_EXISTING", asked);
  const named = header ? TASK_HEADER.exec(header)?.groups : undefined;
  if (!named?.symbol || !named.file) return null;
  const cleaned = cleanIssueText({ title: replayIssueTitle(seq), body: issueBody });
  if (cleaned.length === MAX_OBJECTIVE_CHARS) return null;
  if (!isCanonical(cleaned)) return null;
  const task = parseExistingTestTask(TEST_EXISTING_TRIGGER, cleaned);
  if (!task || task.symbol !== named.symbol || task.file !== named.file || task.checks.length < 1) return null;
  // A check that never names the logged function is a different task. Substring matches (`total` inside `totality`) do not count.
  const sym = new RegExp(`\\b${named.symbol.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&")}\\b`);
  if (!task.checks.every((c) => sym.test(c.expr))) return null;
  return issueBody;
}

export function boundReplay(seq: number, status: ReplayRecord["status"], reason: string, bind: ReplayBind): ReplayRecord {
  return { seq, status, reason, head: bind.head, tree: bind.tree, input: bind.input, coreCommit: bind.coreCommit, archiveSha256: bind.archiveSha256 };
}
