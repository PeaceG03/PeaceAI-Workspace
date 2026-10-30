// M8 CI guard (runs in the required tamper-proof job): every entry of the approved-rules list must trace to
// a real approval. Workspace entries: the cited comment exists, is by PeaceG03 (OWNER), says exactly
// `/approve-rule <hash>`, sits on a rule-proposal issue whose marker pins that id and hash, and the public
// spec file hashes to it. Results entries cannot be read from here (private); their format is checked and
// the sync job verified them against core and re-verified them against a fresh Results clone before opening
// its PR; here every core-sourced entry must carry a well-formed attestation reference (full Results commit
// sha, attestation path for the pinned hash, Results issue and comment id matching the comment URL).
// Delegated entries (source auditor-approve-rule, delegatedBy owner): the cited comment is by PeaceG03 (OWNER) and
// says exactly `/auditor-approve-rule <id> <pinned hash>`, on a rule-proposal issue labelled source:builder whose
// marker and spec block pin that id and hash, the only rule-proposal issue for that id; the spec file hashes to it,
// the proposal record says team-picked and 0 credit, and the rule stays inside the delegable kinds and words.
// They are listed apart (APPROVED LIST DELEGATED) and counted apart in the PASS line: never owner approvals.
// On a branch, the diff against main is checked too: an approval branch (peaceai-approve-rule/*) may change
// only the approved list, one commit ahead, and a new delegated entry must be the only change (one append);
// a revert branch (peaceai-revert-auditor-rule/<id>) may only remove that one delegated entry; any other branch
// may not change the list at all.
// Prints fixed strings and ids only.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { loadApprovedList } from "../lib/approved.ts";
import { APPROVAL_BRANCH_PREFIX, APPROVE_COMMAND, AUDITOR_APPROVE_COMMAND, attestationProblem, auditorPolicyProblem, branchProblem, LIST_PATH, oneAppendProblem, PROPOSAL_LABEL, REVERT_BRANCH, revertProblem, SOURCE_BUILDER_LABEL, teamPickedProblem } from "../lib/approval.ts";
import { AUDITOR_SOURCE } from "../lib/approved.ts";
import { specHash } from "../lib/learned.ts";
import { parseMarker, parseSpecBlock } from "../lib/propose.ts";

const listPath = resolve(process.env.PEACEAI_APPROVED_LIST ?? "peaceai/rules/approved.json");
const rulesDir = resolve(process.env.PEACEAI_RULES_DIR ?? "peaceai/rules/learned");
const recordsDir = resolve(process.env.PEACEAI_PROPOSAL_RECORDS_DIR ?? "peaceai/rules/proposals");
const gh = process.env.PEACEAI_GH ?? "gh";
// maxBuffer: a branch compare carries every file's patch; past the 1 MiB default execFileSync throws (ENOBUFS) and
// the branch check failed closed on a large but legitimate diff (#491 round 4: 1.1 MB). Still fails closed on any gh error.
// stderr is captured (never printed) so a failure can name a fixed cause: the HTTP status, and whether it was a rate limit.
const api = (path: string): Record<string, unknown> => JSON.parse(execFileSync(gh, ["api", path], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 256 * 1024 * 1024 }));
/** Every page of a list endpoint, flattened (gh api --paginate --slurp gives an array of pages). */
const apiAll = (path: string): Record<string, unknown>[] => (JSON.parse(execFileSync(gh, ["api", "--paginate", "--slurp", path], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 256 * 1024 * 1024 })) as Record<string, unknown>[][]).flat();
/** main's approved list, read through the API (the checkout may be the branch). */
const mainList = (): unknown => JSON.parse(Buffer.from(String(api(`repos/${repoName}/contents/${LIST_PATH}?ref=main`).content ?? ""), "base64").toString("utf8"));
const readJsonFile = (p: string): unknown => { try { return existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : null; } catch { return null; } };
let rateLimited = false;
const cause = (err: unknown): string => {
  const text = String((err as { stderr?: unknown })?.stderr ?? "");
  const status = /\(HTTP (\d{3})\)/.exec(text)?.[1];
  const limited = /rate limit/i.test(text);
  if (limited) rateLimited = true;
  const c = limited ? `rate limited${status ? ` (HTTP ${status})` : ""}` : status ? `HTTP ${status}` : "";
  return c ? ` (${c})` : "";
};

let failures = 0;
const fail = (id: string, why: string) => { failures += 1; console.log(`APPROVED LIST FAIL ${id}: ${why}`); };
try {
  const raw = JSON.parse(readFileSync(listPath, "utf8")) as { rules?: unknown[] };
  for (const e of Array.isArray(raw.rules) ? raw.rules : []) {
    const why = attestationProblem(e);
    if (why) fail(String((e as { id?: unknown })?.id ?? "(no id)"), why);
  }
} catch { /* reported as LIST_MISSING / LIST_CORRUPT below */ }
const repoName = process.env.GITHUB_REPOSITORY ?? "PeaceG03/PeaceAI-Workspace";
const branch = process.env.GITHUB_HEAD_REF || process.env.GITHUB_REF_NAME || "";
if (branch && branch !== "main" && !/^\d+\/merge$/.test(branch)) {
  try {
    const cmp = api(`repos/${repoName}/compare/main...${encodeURIComponent(branch)}`);
    const files = ((cmp.files as { filename: string }[] | undefined) ?? []).map((f) => f.filename);
    const why = branchProblem(branch, files, Number(cmp.ahead_by));
    if (why) fail(`branch ${branch}`, why);
  } catch (err) { fail(`branch ${branch}`, `cannot compare the branch with main${cause(err)}`); }
  const local = readJsonFile(listPath) as { rules?: { id?: unknown; source?: unknown }[] } | null;
  const delegated = Array.isArray(local?.rules) ? local.rules.filter((r) => r?.source === AUDITOR_SOURCE) : [];
  try {
    if (REVERT_BRANCH.test(branch)) {
      const why = revertProblem(branch, mainList(), local);
      if (why) fail(`branch ${branch}`, why);
    } else if (branch.startsWith(APPROVAL_BRANCH_PREFIX) && delegated.length > 0) {
      // A new delegated entry must be the approval branch's only change: main's list plus exactly that entry.
      const main = mainList() as { rules?: { id?: unknown }[] };
      const fresh = delegated.filter((r) => !(main.rules ?? []).some((m) => m.id === r.id));
      if (fresh.length > 1) fail(`branch ${branch}`, "more than one new delegated entry");
      else if (fresh.length === 1) { const why = oneAppendProblem(main, local, String(fresh[0]!.id)); if (why) fail(`branch ${branch}`, `delegated entry: ${why}`); }
    }
  } catch (err) { fail(`branch ${branch}`, `cannot read main's approved list${cause(err)}`); }
}
const load = loadApprovedList(listPath);
if (!load.ok) {
  console.log(`APPROVED LIST FAIL ${load.reason}`);
  process.exit(1);
}
let notChecked = 0;
const delegatedOk: string[] = [];
for (const e of load.list.rules) {
  if (e.source === "results") { console.log(`APPROVED LIST NOTE ${e.id}: Results approval (private), attestation ${e.attestation!.commit.slice(0, 12)}`); continue; }
  // After a rate limit every further call fails the same way: stop calling, still fail (counted below).
  if (rateLimited) { notChecked += 1; continue; }
  let comment: Record<string, unknown>;
  let issue: Record<string, unknown>;
  try {
    comment = api(`repos/${e.approval.repo}/issues/comments/${e.approval.commentId}`);
    issue = api(`repos/${e.approval.repo}/issues/${e.approval.issue}`);
  } catch (err) { fail(e.id, `approval comment or issue not readable${cause(err)}`); continue; }
  const user = (comment.user as { login?: string } | undefined)?.login;
  if (e.source === AUDITOR_SOURCE) {
    const labels = ((issue.labels as { name: string }[] | undefined) ?? []).map((l) => l.name);
    const acmd = AUDITOR_APPROVE_COMMAND.exec(String(comment.body ?? "").replace(/\r\n/g, "\n"));
    const m = parseMarker(String(issue.body ?? ""));
    const body = parseSpecBlock(String(issue.body ?? ""));
    const spec = readJsonFile(join(rulesDir, `${e.id}.json`));
    if (user !== "PeaceG03" || comment.author_association !== "OWNER") fail(e.id, "comment author is not PeaceG03 (OWNER)");
    else if (!acmd || acmd[1] !== e.id || acmd[2] !== e.sha256) fail(e.id, "comment is not exactly /auditor-approve-rule <id> <pinned hash>");
    else if (comment.html_url !== e.approval.url || !String(comment.issue_url ?? "").endsWith(`/issues/${e.approval.issue}`)) fail(e.id, "comment URL or issue does not match");
    else if (!labels.includes(PROPOSAL_LABEL) || !labels.includes(SOURCE_BUILDER_LABEL)) fail(e.id, "issue is not a source:builder rule proposal");
    else if (!m || m.id !== e.id || m.sha256 !== e.sha256 || m.source !== "public") fail(e.id, "proposal marker does not pin this id and hash");
    else if (body === null || specHash(body) !== e.sha256) fail(e.id, "proposal spec block does not hash to the pinned hash");
    else if (spec === null || specHash(spec) !== e.sha256) fail(e.id, "spec file does not hash to the pinned hash");
    else if (teamPickedProblem(e.id, readJsonFile(join(recordsDir, `${e.id}.json`)))) fail(e.id, "proposal record does not say team-picked and 0 credit");
    else if (auditorPolicyProblem(spec)) fail(e.id, `rule is not delegable (${auditorPolicyProblem(spec)})`);
    else {
      let same: number;
      try {
        same = apiAll(`repos/${e.approval.repo}/issues?labels=${PROPOSAL_LABEL}&state=all&per_page=100`).filter((i) => !i.pull_request && parseMarker(String(i.body ?? ""))?.id === e.id).length;
      } catch (err) { fail(e.id, `rule-proposal issues not readable${cause(err)}`); continue; }
      if (same !== 1) fail(e.id, "not exactly one rule-proposal issue for this id");
      else { delegatedOk.push(e.id); console.log(`APPROVED LIST OK ${e.id} (delegated)`); }
    }
    continue;
  }
  const cmd = APPROVE_COMMAND.exec(String(comment.body ?? "").replace(/\r\n/g, "\n"));
  if (user !== "PeaceG03" || comment.author_association !== "OWNER") fail(e.id, "comment author is not PeaceG03 (OWNER)");
  else if (!cmd || cmd[1] !== e.sha256) fail(e.id, "comment is not exactly /approve-rule <pinned hash>");
  else if (comment.html_url !== e.approval.url || !String(comment.issue_url ?? "").endsWith(`/issues/${e.approval.issue}`)) fail(e.id, "comment URL or issue does not match");
  else if (!((issue.labels as { name: string }[] | undefined) ?? []).some((l) => l.name === PROPOSAL_LABEL)) fail(e.id, "issue is not a rule proposal");
  else {
    const m = parseMarker(String(issue.body ?? ""));
    const specPath = join(rulesDir, `${e.id}.json`);
    if (!m || m.id !== e.id || m.sha256 !== e.sha256) fail(e.id, "proposal marker does not pin this id and hash");
    else if (!existsSync(specPath) || specHash(JSON.parse(readFileSync(specPath, "utf8"))) !== e.sha256) fail(e.id, "spec file does not hash to the pinned hash");
    else console.log(`APPROVED LIST OK ${e.id}`);
  }
}
if (notChecked > 0) fail("rate limited", `GitHub API rate limit hit; ${notChecked} more entr${notChecked === 1 ? "y" : "ies"} not checked (fail closed)`);
if (failures > 0) process.exit(1);
// Delegated approvals are listed apart: never owner approvals, 0 credit, revertible by Peace.
for (const id of delegatedOk) console.log(`APPROVED LIST DELEGATED ${id}: auditor-approve-rule, delegatedBy owner (not an owner approval, 0 credit)`);
const delegatedCount = load.list.rules.filter((r) => r.source === AUDITOR_SOURCE).length;
console.log(`APPROVED LIST PASS rules=${load.list.rules.length} owner=${load.list.rules.length - delegatedCount} delegated=${delegatedCount}`);
