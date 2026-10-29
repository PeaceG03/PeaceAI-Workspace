// M8 CI guard (runs in the required tamper-proof job): every entry of the approved-rules list must trace to
// a real approval. Workspace entries: the cited comment exists, is by PeaceG03 (OWNER), says exactly
// `/approve-rule <hash>`, sits on a rule-proposal issue whose marker pins that id and hash, and the public
// spec file hashes to it. Results entries cannot be read from here (private); their format is checked and
// the sync job verified them against core and re-verified them against a fresh Results clone before opening
// its PR; here every core-sourced entry must carry a well-formed attestation reference (full Results commit
// sha, attestation path for the pinned hash, Results issue and comment id matching the comment URL).
// On a branch, the diff against main is checked too: an approval branch (peaceai-approve-rule/*) may change
// only the approved list, one commit ahead; any other branch may not change the list at all.
// Off main (pull requests), PEACEAI_VERIFIED_BASE may name main's commit (the tamper-proof job fetches it
// anonymously): when the approved list, the spec files, this checker, its libraries, the dependency set and the
// workflow are byte-identical to that commit, every Workspace entry is one main already verified with the full
// API check (the PR that added it ran this check in full, and every push to main runs it in full), so each
// entry's spec hash is re-checked locally and the two comment/issue API calls are skipped. Any difference, an
// unreadable base, or a run on main itself means the full API check.
// Prints fixed strings and ids only.
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { loadApprovedList } from "../lib/approved.ts";
import { APPROVE_COMMAND, attestationProblem, branchProblem, PROPOSAL_LABEL } from "../lib/approval.ts";
import { specHash } from "../lib/learned.ts";
import { parseMarker } from "../lib/propose.ts";

const listPath = resolve(process.env.PEACEAI_APPROVED_LIST ?? "peaceai/rules/approved.json");
const rulesDir = resolve(process.env.PEACEAI_RULES_DIR ?? "peaceai/rules/learned");
const gh = process.env.PEACEAI_GH ?? "gh";
// maxBuffer: a branch compare carries every file's patch; past the 1 MiB default execFileSync throws (ENOBUFS) and
// the branch check failed closed on a large but legitimate diff (#491 round 4: 1.1 MB). Still fails closed on any gh error.
// stderr is captured (never printed) so a failure can name a fixed cause: the HTTP status, and whether it was a rate limit.
const api = (path: string): Record<string, unknown> => JSON.parse(execFileSync(gh, ["api", path], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 256 * 1024 * 1024 }));
let rateLimited = false;
const cause = (err: unknown): string => {
  const text = String((err as { stderr?: unknown })?.stderr ?? "");
  const status = /\(HTTP (\d{3})\)/.exec(text)?.[1];
  const limited = /rate limit/i.test(text);
  if (limited) rateLimited = true;
  const c = limited ? `rate limited${status ? ` (HTTP ${status})` : ""}` : status ? `HTTP ${status}` : "";
  return c ? ` (${c})` : "";
};

/** Paths whose bytes decide this check's verdict (besides the list, the specs and the GitHub comments). */
const M8_INPUT_PATHS = ["peaceai/lib/", "peaceai/bin/check-approved-list.ts", "package.json", "package-lock.json", "tsconfig.json", ".github/workflows/ci.yml"];
const onMain = !process.env.GITHUB_HEAD_REF && (process.env.GITHUB_REF_NAME ?? "") === "main";
const verifiedBase = (() => {
  const base = process.env.PEACEAI_VERIFIED_BASE ?? "";
  if (onMain || !/^[0-9a-f]{40}$/.test(base)) return null;
  const git = (...a: string[]) => spawnSync("git", a, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  if (git("cat-file", "-e", `${base}^{commit}`).status !== 0) return null;
  // Exit 0 = no difference; 1 = differences; anything else (path outside the repo, bad object) = unknown. Only 0 skips.
  const d = git("diff", "--quiet", "--no-renames", base, "HEAD", "--", listPath, rulesDir, ...M8_INPUT_PATHS);
  return d.status === 0 ? base : null;
})();

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
}
const load = loadApprovedList(listPath);
if (!load.ok) {
  console.log(`APPROVED LIST FAIL ${load.reason}`);
  process.exit(1);
}
let notChecked = 0;
for (const e of load.list.rules) {
  if (e.source === "results") { console.log(`APPROVED LIST NOTE ${e.id}: Results approval (private), attestation ${e.attestation!.commit.slice(0, 12)}`); continue; }
  if (verifiedBase) {
    const specPath = join(rulesDir, `${e.id}.json`);
    if (!existsSync(specPath) || specHash(JSON.parse(readFileSync(specPath, "utf8"))) !== e.sha256) fail(e.id, "spec file does not hash to the pinned hash");
    else console.log(`APPROVED LIST OK-LOCAL ${e.id}: list and spec identical to main ${verifiedBase.slice(0, 12)}, whose approval was verified via the API`);
    continue;
  }
  // After a rate limit every further call fails the same way: stop calling, still fail (counted below).
  if (rateLimited) { notChecked += 1; continue; }
  let comment: Record<string, unknown>;
  let issue: Record<string, unknown>;
  try {
    comment = api(`repos/${e.approval.repo}/issues/comments/${e.approval.commentId}`);
    issue = api(`repos/${e.approval.repo}/issues/${e.approval.issue}`);
  } catch (err) { fail(e.id, `approval comment or issue not readable${cause(err)}`); continue; }
  const user = (comment.user as { login?: string } | undefined)?.login;
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
console.log(`APPROVED LIST PASS rules=${load.list.rules.length}${verifiedBase ? ` (approvals unchanged from main ${verifiedBase.slice(0, 12)}: checked locally)` : ""}`);
