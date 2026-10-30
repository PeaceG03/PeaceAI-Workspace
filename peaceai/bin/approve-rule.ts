// M8: the only writer of peaceai/rules/approved.json, run by .github/workflows/peace-approve-rule.yml.
//   workspace: from Peace's `/approve-rule <hash>` comment on a Workspace proposal issue (event data in env)
//   sync:      from Results attestations (written by the Results approval workflow) plus a core checkout;
//              writes the proposed list only (no PR). The landing job runs `reverify` first.
//   auditor:   from `/auditor-approve-rule <id> <sha256>` on a Builder (source:builder) Workspace proposal issue
//              (event data in env, every rule-proposal issue in PEACEAI_PROPOSALS_FILE); adds one delegated
//              entry (source auditor-approve-rule, delegatedBy owner). Never an owner approval, 0 credit.
//   check-append: the landing re-check for a delegated entry: the list to land must be main's list
//              (PEACEAI_MAIN_LIST) plus exactly that one entry (PEACEAI_AUDITOR_RULE); writes nothing.
//   reverify:  the landing job (Results key) compares the proposed list with main's list and re-reads every
//              new entry's attestation from a FRESH Results clone at its recorded commit; fail closed.
// Writes the new list in place and `ok`, `changed`, `reason`, `rules`, `approvals` to GITHUB_OUTPUT, plus the
// commit message (citing every approval comment) to PEACEAI_MESSAGE_FILE. Prints fixed strings only.
import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { APPROVED_SCHEMA, loadApprovedList, withEntry, type ApprovalEntry, type ApprovedList } from "../lib/approved.ts";
import { AUDITOR_APPROVE_COMMAND, approvalMessage, entryFromAttestation, oneAppendProblem, validateAuditorApproval, validateWorkspaceApproval, verifySyncChange, type AttestationRecord, type ProposalIssue } from "../lib/approval.ts";

const mode = process.argv[2];
const listPath = resolve(process.env.PEACEAI_APPROVED_LIST_OUT ?? "peaceai/rules/approved.json");
const out = (k: string, v: string) => process.env.GITHUB_OUTPUT && appendFileSync(process.env.GITHUB_OUTPUT, `${k}=${v}\n`);
const finish = (ok: boolean, reason: string, added: ApprovalEntry[] = []) => {
  out("ok", String(ok));
  out("reason", reason);
  out("changed", String(added.length > 0));
  out("rules", added.map((e) => e.id).join(","));
  console.log(`approve-rule ${mode} ok=${ok} reason=${reason} added=${added.length}`);
  process.exit(0);
};

// The current list must be valid; a corrupt list is never extended (fail closed).
const loaded = loadApprovedList(listPath);
if (!loaded.ok) finish(false, loaded.reason);
let list: ApprovedList = loaded.ok ? loaded.list : { schema: APPROVED_SCHEMA, rules: [] };
const readJson = (p: string): unknown => { try { return existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : null; } catch { return { invalid: true }; } };
const added: ApprovalEntry[] = [];

if (mode === "workspace") {
  const e = process.env;
  let labels: string[] = [];
  try { labels = JSON.parse(e.ISSUE_LABELS ?? "[]"); } catch { finish(false, "BAD_EVENT"); }
  const marker = /<!-- peaceai-rule-proposal:v1 id=([a-z0-9-]+) /.exec(e.ISSUE_BODY ?? "");
  const specFile = marker ? readJson(join(resolve(process.env.PEACEAI_RULES_DIR ?? "peaceai/rules/learned"), `${marker[1]}.json`)) : null;
  const r = validateWorkspaceApproval(
    { repo: e.GITHUB_REPOSITORY ?? "", body: e.COMMENT_BODY ?? "", author: e.COMMENT_AUTHOR ?? "", association: e.COMMENT_ASSOCIATION ?? "", commentId: Number(e.COMMENT_ID), url: e.COMMENT_URL ?? "", createdAt: e.COMMENT_CREATED_AT ?? "", issue: Number(e.ISSUE_NUMBER), labels, issueBody: e.ISSUE_BODY ?? "" },
    specFile, list.rules,
  );
  if (!r.ok) finish(false, r.reason);
  if (r.ok) { list = withEntry(list, r.entry); added.push(r.entry); }
} else if (mode === "auditor") {
  const e = process.env;
  let labels: string[] = [];
  let proposals: ProposalIssue[] = [];
  try {
    labels = JSON.parse(e.ISSUE_LABELS ?? "[]");
    const raw = JSON.parse(readFileSync(resolve(e.PEACEAI_PROPOSALS_FILE ?? ""), "utf8")) as { number?: unknown; body?: unknown; pull_request?: unknown }[];
    if (!Array.isArray(raw)) throw new Error("proposals");
    proposals = raw.map((x) => ({ number: Number(x.number), body: typeof x.body === "string" ? x.body : "", isPull: x.pull_request !== undefined && x.pull_request !== null }));
  } catch { finish(false, "BAD_EVENT"); }
  // The id comes from the command (format-checked by the regex, so it is a plain file name).
  const cmd = AUDITOR_APPROVE_COMMAND.exec((e.COMMENT_BODY ?? "").replace(/\r\n/g, "\n"));
  const id = cmd ? cmd[1]! : null;
  const spec = id ? readJson(join(resolve(e.PEACEAI_RULES_DIR ?? "peaceai/rules/learned"), `${id}.json`)) : null;
  const record = id ? readJson(join(resolve(e.PEACEAI_PROPOSAL_RECORDS_DIR ?? "peaceai/rules/proposals"), `${id}.json`)) : null;
  const r = validateAuditorApproval(
    { repo: e.GITHUB_REPOSITORY ?? "", body: e.COMMENT_BODY ?? "", author: e.COMMENT_AUTHOR ?? "", association: e.COMMENT_ASSOCIATION ?? "", commentId: Number(e.COMMENT_ID), url: e.COMMENT_URL ?? "", createdAt: e.COMMENT_CREATED_AT ?? "", issue: Number(e.ISSUE_NUMBER), labels, issueBody: e.ISSUE_BODY ?? "" },
    { spec, record }, proposals, list.rules,
  );
  if (!r.ok) finish(false, r.reason);
  if (r.ok) { list = withEntry(list, r.entry); added.push(r.entry); }
} else if (mode === "check-append") {
  const why = oneAppendProblem(readJson(resolve(process.env.PEACEAI_MAIN_LIST ?? "")), list, process.env.PEACEAI_AUDITOR_RULE ?? "");
  console.log(`approve-rule check-append ${why ? `FAIL: ${why}` : "PASS"}`);
  finish(!why, why ? "NOT_ONE_APPEND" : "ONE_APPEND");
} else if (mode === "sync") {
  const dir = resolve(process.env.PEACEAI_ATTESTATIONS_DIR ?? "");
  const core = resolve(process.env.PEACEAI_CORE_DIR ?? "");
  for (const f of existsSync(dir) ? readdirSync(dir).filter((x) => /^[0-9a-f]{64}\.json$/.test(x)).sort() : []) {
    const att = readJson(join(dir, f)) as { id?: string; sha256?: string } | null;
    if (!att || list.rules.some((r) => r.sha256 === att.sha256)) continue;
    const meta = readJson(join(dir, f.replace(/\.json$/, ".commit.json"))) as { commit?: string; message?: string } | null;
    const id = typeof att.id === "string" && /^core-[a-z0-9-]+$/.test(att.id) ? att.id : null;
    const spec = id ? readJson(join(core, "packages/coding-kernel/learned-rules", `${id}.json`)) : null;
    const r = entryFromAttestation(att, String(meta?.commit ?? ""), String(meta?.message ?? ""), spec);
    if (!r.ok) { console.log(`approve-rule sync skip ${f.slice(0, 12)} reason=${r.reason}`); continue; }
    list = withEntry(list, r.entry);
    added.push(r.entry);
  }
} else if (mode === "reverify") {
  const proposed = loadApprovedList(resolve(process.env.PEACEAI_PROPOSED_LIST ?? ""));
  if (!proposed.ok) finish(false, "LIST_INVALID");
  const results = resolve(process.env.PEACEAI_RESULTS_DIR ?? "");
  const rgit = (...a: string[]) => execFileSync("git", ["-C", results, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  const read = (commit: string, path: string): AttestationRecord | null => {
    if (!/^[0-9a-f]{40}$/.test(commit) || !/^rules\/approvals\/[0-9a-f]{64}\.json$/.test(path)) return null;
    try {
      const content = rgit("show", `${commit}:${path}`);
      const message = rgit("log", "-1", "--format=%B", commit);
      let onMain = true;
      try { rgit("merge-base", "--is-ancestor", commit, "origin/main"); } catch { onMain = false; }
      return { content, message, onMain };
    } catch { return null; }
  };
  const r = proposed.ok ? verifySyncChange(list, proposed.list, read) : null;
  if (r && !r.ok) finish(false, r.reason);
  if (r?.ok && proposed.ok) { list = proposed.list; added.push(...r.added); }
} else throw new Error("usage: approve-rule.ts workspace|auditor|check-append|sync|reverify");

if (added.length === 0) finish(true, "NOTHING_NEW");
writeFileSync(listPath, JSON.stringify(list, null, 2) + "\n");
const msg = approvalMessage(added);
if (process.env.PEACEAI_MESSAGE_FILE) writeFileSync(process.env.PEACEAI_MESSAGE_FILE, msg + "\n");
finish(true, "ADDED", added);
