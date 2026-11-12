// Experimental. credit is false. Turns one builder-log row into a Job A replay record.
// A pass is only a Job A summary that contains a candidate. Anything not run stays unmeasured.
import type { ReplayBind, ReplayRecord } from "./capabilityreport.ts";
import { COMPLEX_TRIGGER, DATE_TRIGGER, LOOP_TRIGGER, WHILE_TRIGGER } from "./learned-complex.ts";
import { DERIVE_APPEND_TRIGGER, DERIVE_LIST_TRIGGER, DERIVE_STRING_TRIGGER, DERIVE_TRIGGER } from "./learned-derive.ts";
import { EXISTING_EDIT_TRIGGER } from "./learned-edit-existing.ts";
import { FUNCTION_TRIGGER } from "./learned-function.ts";
import { GUARD_TOP_TRIGGER, GUARD_TRIGGER } from "./learned-guard.ts";
import { REPLACE_TRIGGER } from "./learned-body.ts";
import { TEST_TRIGGER } from "./learned-test.ts";
import { DERIVE_WIRE_TRIGGER } from "./derive-wire.ts";
import { DERIVE_WIRE_V2_TRIGGER } from "./derive-wire-v2.ts";
import { parseExistingTestTask, TEST_EXISTING_TRIGGER } from "./learned-test-existing.ts";
import { WORKFLOW_TRIGGER } from "./learned-workflow.ts";
import { ENV_FIX_TRIGGER } from "./env-fix.ts";
import { IMPORT_EDIT_V2_TRIGGER } from "./import-edit-v2.ts";
import { METHOD_GUARD_TRIGGER } from "./method-guard.ts";
import { TSCONFIG_SCRIPT_TRIGGER } from "./tsconfig-script.ts";
import { WORKFLOW_JOB_TRIGGER } from "./workflow-job.ts";
import { isCanonical } from "./nlparse.ts";
import { canonicalRequest, guessFamily, type RequestModel } from "./requestfamily.ts";
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

/** One learned-rule header. The source is that rule's own trigger, not a builder-log row. */
const TASK_HEADERS: readonly { family: string; source: string }[] = [
  { family: "TEST_CASE_EXISTING", source: TEST_EXISTING_TRIGGER },
  { family: "TEST_CASE", source: TEST_TRIGGER },
  { family: "THROW_GUARD", source: GUARD_TRIGGER },
  { family: "THROW_GUARD", source: GUARD_TOP_TRIGGER },
  { family: "METHOD_GUARD", source: METHOD_GUARD_TRIGGER },
  { family: "ADD_FUNCTION", source: FUNCTION_TRIGGER },
  { family: "COMPLEX_FUNCTION", source: COMPLEX_TRIGGER },
  { family: "COMPLEX_FUNCTION", source: DATE_TRIGGER },
  { family: "LOOP_FUNCTION", source: LOOP_TRIGGER },
  { family: "LOOP_FUNCTION", source: WHILE_TRIGGER },
  { family: "ENV_FIX", source: ENV_FIX_TRIGGER },
  { family: "IMPORT_EDIT", source: IMPORT_EDIT_V2_TRIGGER },
  { family: "DERIVE_FROM_BEHAVIOR", source: DERIVE_TRIGGER },
  { family: "DERIVE_FROM_BEHAVIOR", source: DERIVE_APPEND_TRIGGER },
  { family: "DERIVE_FROM_BEHAVIOR", source: DERIVE_LIST_TRIGGER },
  { family: "DERIVE_FROM_BEHAVIOR", source: DERIVE_STRING_TRIGGER },
  { family: "WORKFLOW_JOB", source: WORKFLOW_JOB_TRIGGER },
  { family: "WORKFLOW_STEP", source: WORKFLOW_TRIGGER },
  { family: "TSCONFIG_SCRIPT", source: TSCONFIG_SCRIPT_TRIGGER },
  { family: "MODIFY_LOGIC", source: REPLACE_TRIGGER },
  { family: "MODIFY_LOGIC", source: EXISTING_EDIT_TRIGGER },
  { family: "EXISTING_EDIT", source: DERIVE_WIRE_TRIGGER },
  { family: "EXISTING_EDIT", source: DERIVE_WIRE_V2_TRIGGER },
];

const NOT_A_NAME = /^(?:add|guard|function|complex|loop|date|pure|module|existing|append|change|edit|import|make|strict|throw|when|with|method|returning|body|test|workflow|step|script|replace|statement|condition|return|default|integer|flag|env|new|the|for|and|string|number|boolean|readonly|void|null|undefined|true|false|type|from|src)$/i;

function wordIn(text: string, word: string): boolean {
  return new RegExp(`\\b${word.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&")}\\b`).test(text);
}

function hasPath(text: string, file: string): boolean {
  let from = 0;
  while (from <= text.length) {
    const i = text.indexOf(file, from);
    if (i < 0) return false;
    const before = i === 0 ? "" : text[i - 1]!;
    const after = text[i + file.length] ?? "";
    if (!/[\w.-]/.test(before) && !/[\w.-]/.test(after)) return true;
    from = i + 1;
  }
  return false;
}

interface TaskHit { family: string; file: string; symbol: string; line: string }

function headersIn(text: string): TaskHit[] {
  const out: TaskHit[] = [];
  for (const line of text.split("\n").map((l) => l.trim()).filter(Boolean)) {
    for (const h of TASK_HEADERS) {
      const m = new RegExp(h.source, "i").exec(line);
      if (!m) continue;
      const g = m.groups ?? {};
      const file = g.file || g.afile || "";
      const symbol = g.fn || g.method || g.symbol || g.name || g.job || g.target || "";
      if (!file) continue;
      out.push({ family: h.family, file, symbol, line });
    }
  }
  return out;
}

function sameTask(asked: string, hit: TaskHit): boolean {
  if (!hasPath(asked, hit.file)) return false;
  if (hit.symbol) return wordIn(asked, hit.symbol);
  const ids = hit.line.match(/\b[A-Za-z_$][\w$]{3,}\b/g) ?? [];
  const names = ids.filter((id) => !NOT_A_NAME.test(id) && (/[A-Z]/.test(id.slice(1)) || id.includes("_")));
  return names.some((id) => wordIn(asked, id));
}

/**
 * The cited issue is the task when its cleaned text is one learned-rule header and the summary
 * already names that header's file and symbol. A second header, a sliced body, or a different
 * target is not adopted. The raw body is what Job A cleans again.
 */
export function agreedIssue(asked: string, issueBody: string, seq: number): string | null {
  if (!issueBody.trim() || issueBody.length > 8000) return null;
  const cleaned = cleanIssueText({ title: replayIssueTitle(seq), body: issueBody });
  if (!cleaned || cleaned.length === MAX_OBJECTIVE_CHARS || !isCanonical(cleaned)) return null;
  const hits = headersIn(cleaned).filter((h) => sameTask(asked, h));
  const keys = new Set(hits.map((h) => `${h.family}\0${h.file}\0${h.symbol}`));
  if (keys.size !== 1) return null;
  return issueBody;
}

/** Every repo ref in the landing record is PeaceAI-Workspace: the change is to this repo's own code. */
export function ownWorkspaceChange(changed: string): boolean {
  const repos = [...changed.matchAll(/(PeaceSTOCKS|PeaceAI-Workspace)(?:@|#)/g)].map((m) => m[1]);
  return repos.length > 0 && repos.every((r) => r === "PeaceAI-Workspace");
}

export type ReplayRoute = { run: string } | { fail: string };

/**
 * What the production replay should do with one row. A cited issue that is the same learned
 * task is handed to Job A. PeaceAI's own tooling, with no such task, is a self-change refusal.
 * The characterization path keeps its own adoption check.
 */
export function routeReplay(o: { model: RequestModel; asked: string; changed: string; issueBody: string | null; seq: number }): ReplayRoute {
  const g = guessFamily(o.model, o.asked);
  const canon = g.family ? canonicalRequest(g.family, o.asked) : null;
  if (g.family === "TEST_CASE_EXISTING" && canon) {
    const adopted = o.issueBody ? adoptIssueBody(o.asked, o.issueBody, o.seq) : null;
    return { run: adopted ?? canon };
  }
  const adopted = o.issueBody ? agreedIssue(o.asked, o.issueBody, o.seq) : null;
  if (adopted) return { run: adopted };
  if (canon) return { run: canon };
  if (g.refusal === "SELF_CHANGE" || ownWorkspaceChange(o.changed)) return { fail: "SELF_CHANGE" };
  if (g.none) return { fail: "NOT_CODE_FAMILY" };
  if (!g.family) return { fail: "CLASSIFIER_UNSURE" };
  return { fail: `NO_SLOTS: ${g.family}` };
}

export function boundReplay(seq: number, status: ReplayRecord["status"], reason: string, bind: ReplayBind): ReplayRecord {
  return { seq, status, reason, head: bind.head, tree: bind.tree, input: bind.input, coreCommit: bind.coreCommit, archiveSha256: bind.archiveSha256 };
}
