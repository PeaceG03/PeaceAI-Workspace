// M11: self-improvement sandbox. PeaceAI may PROPOSE a change to its own code (this repo's peaceai/), but the change
// is built and tested in a fresh clone inside an ephemeral GitHub-hosted job of a private repo (no box mode), never
// in the live checkout. Nothing here pushes, merges or edits the live tree; promotion is a normal PR that a human
// lands after the gates below, and every self-change is recorded in private Results with a one-step rollback.
import { createHash } from "node:crypto";

export const SELF_SCHEMA = "peaceai-self-change:v1";
export const AUDITOR_COMMAND = "/auditor-pass";
export const PROMOTE_COMMAND = "/promote-self-change";
export const MAX_BUDGET_MINUTES = 30;
export const DEFAULT_BUDGET_MINUTES = 15;
/** Repositories whose Actions jobs may run a self-change. Workspace (public) is not one of them. */
export const PRIVATE_RUNNERS = ["PeaceG03/PeaceAI-Results", "PeaceG03/PeaceAI"] as const;

/**
 * The protected set: paths a self-change may never touch (create, modify, delete, rename to or from, copy to,
 * mode-change or symlink). It holds the gates, the approval path, the checks, the hooks, the rules, the live
 * tests and the self-change machinery itself, so PeaceAI can never weaken what judges it.
 */
export const PROTECTED_SELF: readonly { pattern: RegExp; why: string }[] = [
  { pattern: /(^|\/)[^/]*public-origin[^/]*$/i, why: "the public-origin allowlist (leak gate): core's docs/peaceai-public-origin.json and any copy, test or reader of it" },
  { pattern: /^\.github\//, why: "workflows, required checks and approval workflows" },
  { pattern: /^\.githooks\/|(^|\/)\.git\//, why: "git hooks" },
  { pattern: /^(package(-lock)?\.json|npm-shrinkwrap\.json|\.npmrc|tsconfig[^/]*\.json|\.gitignore|\.gitattributes)$/, why: "dependencies and build config" },
  { pattern: /^(README\.md|CONSTITUTION[^/]*|SECURITY[^/]*|CODEOWNERS|LICENSE[^/]*)$/, why: "governance documents" },
  { pattern: /^peaceai\/rules\//, why: "approved learned-rule list and rule specs" },
  { pattern: /^peaceai\/test\//, why: "the live test suite (new tests go under peaceai/self-tests/)" },
  { pattern: /^(?!peaceai\/self-tests\/)(.*\/)?[^/]*\.test\.ts$/, why: "existing tests anywhere (new tests go under peaceai/self-tests/)" },
  { pattern: /^peaceai\/bin\/(approve-rule[^/]*|check-approved-list\.ts|leak-scan\.ts|prepush-scan\.ts|core-scan\.ts|install-pre-push\.sh|push-proof-main\.sh|await-checks\.sh|clone-core\.sh|self-change\.ts|nl-refusal\.ts|regate\.ts|gate\.ts)$/, why: "approval, leak, scan, hook, gate and self-change tools" },
  { pattern: /^peaceai\/lib\/(leak|approval|approved|scope|prguard|kernelguard|coretext|coreindex|substr|policy|gate|selfchange|selfpropose|learned|learned-test|learned-guard|minetest|results|verdict|trigger)\.ts$/, why: "gates, approvals, leak/scope scanners and the self-change rules" },
  { pattern: /^peaceai\/lib\/lm\.ts$|^peaceai\/model\//, why: "the model, its memcheck and job guard" },
  { pattern: /^peaceai\/self\//, why: "self-change records and configuration" },
];

/** Strings a self-change may not ADD anywhere: they reach the protected set or the credentials by content. */
const CONTENT_BANNED: readonly { pattern: RegExp; why: string }[] = [
  { pattern: /public-origin|PUBLIC_ORIGIN|parsePublicOrigin|publicOrigin/i, why: "names the public-origin allowlist (leak gate)" },
  { pattern: /\.github\//, why: "names the workflow directory" },
  { pattern: /approved\.json|peaceai\/rules\//, why: "names the approved-rule list" },
  { pattern: /peaceai\/test\/|self-tests\/.*\.\.\//, why: "reaches into the live tests" },
  { pattern: /hooksPath|pre-push|--no-verify/, why: "touches git hooks" },
  { pattern: /GITHUB_TOKEN|GH_TOKEN|DEPLOY_KEY|PEACEAI_[A-Z_]*KEY|secrets\./, why: "names a credential" },
  { pattern: /\/approve-rule|\/promote-self-change|\/auditor-pass/, why: "names an approval command" },
  { pattern: /\b(isProtectedPath|PROTECTED_SELF|checkSelfChangeDiff|promotionDecision|mayChangeProtected|lmJobAllowed|scanText)\b/, why: "names a gate function" },
  { pattern: /\beval\s*\(|new Function\s*\(|require\(\s*[^"'`]/, why: "dynamic code loading" },
  { pattern: /process\.env\.(PEACEAI_|GITHUB_)/, why: "reads a gate/runner variable" },
];

export interface DiffFile { oldPath: string | null; newPath: string | null; status: "A" | "M" | "D" | "R" | "C"; oldMode?: string; newMode?: string; binary: boolean; added: string[] }

/** Parses `git diff --find-renames --find-copies --binary` output. Unknown structure is reported, not skipped. */
export function parseGitDiff(diff: string): { files: DiffFile[]; malformed: boolean } {
  const files: DiffFile[] = [];
  let cur: DiffFile | null = null;
  let malformed = false;
  const unq = (p: string) => (p.startsWith('"') ? JSON.parse(p) : p);
  for (const line of diff.split("\n")) {
    const head = /^diff --git (\S+|"[^"]*") (\S+|"[^"]*")$/.exec(line);
    if (head) {
      cur = { oldPath: unq(head[1]!).replace(/^a\//, ""), newPath: unq(head[2]!).replace(/^b\//, ""), status: "M", binary: false, added: [] };
      files.push(cur);
      continue;
    }
    if (!cur) { if (line.trim()) malformed = true; continue; }
    let m: RegExpExecArray | null;
    if ((m = /^new file mode (\d+)$/.exec(line))) { cur.status = "A"; cur.newMode = m[1]; cur.oldPath = null; }
    else if ((m = /^deleted file mode (\d+)$/.exec(line))) { cur.status = "D"; cur.oldMode = m[1]; cur.newPath = null; }
    else if ((m = /^old mode (\d+)$/.exec(line))) cur.oldMode = m[1];
    else if ((m = /^new mode (\d+)$/.exec(line))) cur.newMode = m[1];
    else if ((m = /^rename from (.+)$/.exec(line))) { cur.status = "R"; cur.oldPath = unq(m[1]!); }
    else if ((m = /^rename to (.+)$/.exec(line))) cur.newPath = unq(m[1]!);
    else if ((m = /^copy from (.+)$/.exec(line))) { cur.status = "C"; cur.oldPath = unq(m[1]!); }
    else if ((m = /^copy to (.+)$/.exec(line))) cur.newPath = unq(m[1]!);
    else if (/^(GIT binary patch|Binary files )/.test(line)) cur.binary = true;
    else if (line.startsWith("+") && !line.startsWith("+++")) cur.added.push(line.slice(1));
  }
  return { files, malformed: malformed || files.length === 0 };
}

export function protectedReason(path: string | null): string | null {
  if (path === null) return null;
  const norm = path.replace(/\\/g, "/");
  if (norm.startsWith("/") || norm.split("/").some((s) => s === ".." || s === "." || s === "")) return "path is not a plain relative path";
  if (PROTECTED_SELF[0]!.pattern.test(norm)) return PROTECTED_SELF[0]!.why; // the public-origin allowlist, wherever it sits
  if (!norm.startsWith("peaceai/")) return "outside peaceai/ (self-changes edit PeaceAI's own code only)";
  return PROTECTED_SELF.find((p) => p.pattern.test(norm))?.why ?? null;
}

export interface SelfDiffCheck { ok: boolean; refusals: { path: string; reason: string }[]; paths: string[] }

/** Refuses any self-change that touches the protected set, by path (every side of a rename/copy) and by content. */
export function checkSelfChangeDiff(diff: string): SelfDiffCheck {
  const { files, malformed } = parseGitDiff(diff);
  const refusals: { path: string; reason: string }[] = [];
  if (malformed) refusals.push({ path: "-", reason: "diff is empty or not a git diff" });
  const paths = new Set<string>();
  for (const f of files) {
    for (const p of [f.oldPath, f.newPath]) {
      if (p === null) continue;
      paths.add(p);
      const r = protectedReason(p);
      if (r) refusals.push({ path: p, reason: `protected: ${r}` });
    }
    const where = f.newPath ?? f.oldPath ?? "-";
    if (f.binary) refusals.push({ path: where, reason: "binary change" });
    for (const mode of [f.newMode, f.oldMode]) if (mode && mode !== "100644") refusals.push({ path: where, reason: `file mode ${mode} (symlinks, submodules and executables are refused)` });
    if (f.status === "D") refusals.push({ path: where, reason: "deletes a file" });
    if (f.status === "C") refusals.push({ path: where, reason: "copies a file" });
    if (f.newPath && !/^peaceai\/(lib|bin|self-tests|nl|ranker)\//.test(f.newPath)) refusals.push({ path: f.newPath, reason: "outside the editable areas (peaceai/lib, bin, nl, ranker, self-tests)" });
    f.added.forEach((line) => {
      for (const b of CONTENT_BANNED) if (b.pattern.test(line)) refusals.push({ path: where, reason: `content: ${b.why}` });
    });
  }
  const seen = new Set<string>();
  const uniq = refusals.filter((r) => { const k = `${r.path}\0${r.reason}`; if (seen.has(k)) return false; seen.add(k); return true; });
  return { ok: uniq.length === 0, refusals: uniq, paths: [...paths].sort() };
}

// ---- where it may run

/** Variables that carry credentials or a route to them; a proposal's environment must have none. */
const CREDENTIAL_ENV = /^(GH_TOKEN|GITHUB_TOKEN|GH_ENTERPRISE_TOKEN|GIT_ASKPASS|SSH_ASKPASS|SSH_AUTH_SOCK|GIT_SSH|GIT_SSH_COMMAND|GIT_CONFIG_GLOBAL|GIT_CONFIG_SYSTEM|GIT_CONFIG_PARAMETERS|GIT_CONFIG_COUNT|NPM_TOKEN|NODE_AUTH_TOKEN|ACTIONS_RUNTIME_TOKEN|ACTIONS_ID_TOKEN_REQUEST_TOKEN|AWS_[A-Z_]+|.*_(TOKEN|SECRET|KEY|PASSWORD))$/;

/**
 * A proposal runs new or changed code, so it runs in exactly one place: an ephemeral GitHub-hosted Actions job
 * in a private repo on the allowlist (Results or core), started manually (workflow_dispatch) or by a proposal
 * (issues), with no credential variables in its environment. There is no box or local mode.
 */
export function selfChangeAllowedHere(env: Record<string, string | undefined>): { ok: boolean; reason?: string } {
  if (env.GITHUB_ACTIONS !== "true") return { ok: false, reason: "PRIVATE_ACTIONS_ONLY" };
  if (!(PRIVATE_RUNNERS as readonly string[]).includes(env.GITHUB_REPOSITORY ?? "")) return { ok: false, reason: "PUBLIC_RUNNER_REFUSED" };
  if (env.GITHUB_EVENT_NAME !== "workflow_dispatch" && env.GITHUB_EVENT_NAME !== "issues") return { ok: false, reason: "START_MANUALLY_OR_ON_PROPOSAL" };
  if (env.RUNNER_ENVIRONMENT !== "github-hosted") return { ok: false, reason: "RUNNER_NOT_EPHEMERAL" };
  if (Object.keys(env).some((k) => CREDENTIAL_ENV.test(k) && env[k])) return { ok: false, reason: "CREDENTIALS_IN_ENV" };
  return { ok: true };
}

export function budgetMinutes(asked: string | undefined): number {
  const n = Number(asked ?? DEFAULT_BUDGET_MINUTES);
  return Number.isFinite(n) && n > 0 ? Math.min(n, MAX_BUDGET_MINUTES) : DEFAULT_BUDGET_MINUTES;
}

// ---- promotion

export interface TestRun { suite: "live" | "new"; files: string[]; filesSha256: string; exitCode: number; pass: number; fail: number }
/** A command comment, traced: its GitHub comment id and URL (issuecomment-<id>) on the promotion PR/issue. */
export interface CommandComment { id?: number; url?: string; body: string; author: string; association: string; createdAt: string }
export const WORKSPACE_REPO = "PeaceG03/PeaceAI-Workspace";
export function tracedComment(c: CommandComment): boolean {
  return Number.isSafeInteger(c.id) && (c.id ?? 0) > 0 && typeof c.url === "string" && new RegExp(`^https://github\\.com/${WORKSPACE_REPO}/(pull|issues)/\\d+#issuecomment-${c.id}$`).test(c.url);
}

export interface SelfChangeRecord {
  schema: typeof SELF_SCHEMA;
  id: string;
  baseSha: string;
  candidateSha: string;
  diffSha256: string;
  paths: string[];
  check: SelfDiffCheck;
  liveSuite: { baseSha: string; filesSha256: string };
  tests: TestRun[];
  status: "refused" | "tested-failing" | "awaiting-review" | "promoted" | "rolled-back";
  promotion?: { decision: PromotionDecision; prUrl?: string; mergeSha?: string };
  rollback: { kind: "revert"; of: string | null; command: string };
  createdAt: string;
}

export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
export const listSha = (files: readonly string[]) => sha256([...files].sort().join("\n"));

export interface PromotionDecision { ok: boolean; reasons: string[]; auditorComment?: string; architectComment?: string }

/**
 * Promotion needs ALL of: a clean protected-set check; the LIVE version's existing test suite (the file list
 * taken from the base commit, unchanged) run against the candidate and passing; any new tests passing; and two
 * traced comments on the promotion PR (comment id + URL), each naming this change and ONE commit:
 *   Auditor   `/auditor-pass <id> <sha>`
 *   Architect `/promote-self-change <id> <sha>`, posted after that pass.
 * Both SHAs must equal the PR's current head, which must be the tested candidate commit. Any new push moves the
 * head, so it needs a fresh proposal run, a fresh pass and a fresh promote. Labels count for nothing.
 */
export function promotionDecision(rec: SelfChangeRecord, liveFilesAtBase: readonly string[], prHeadSha: string, comments: readonly CommandComment[], approvers: { auditor: readonly string[]; architect: readonly string[] }): PromotionDecision {
  const reasons: string[] = [];
  if (rec.schema !== SELF_SCHEMA) reasons.push("BAD_RECORD");
  if (!rec.check.ok || !checkOkAgain(rec)) reasons.push("PROTECTED_SET");
  const live = rec.tests.find((t) => t.suite === "live");
  if (!live) reasons.push("LIVE_TESTS_NOT_RUN");
  else {
    if (liveFilesAtBase.length === 0 || live.filesSha256 !== listSha(liveFilesAtBase) || rec.liveSuite.filesSha256 !== listSha(liveFilesAtBase)) reasons.push("LIVE_SUITE_MISMATCH");
    if (live.exitCode !== 0 || live.fail !== 0 || live.pass === 0) reasons.push("LIVE_TESTS_FAILED");
  }
  for (const t of rec.tests.filter((x) => x.suite === "new")) if (t.exitCode !== 0 || t.fail !== 0) reasons.push("NEW_TESTS_FAILED");
  const head = /^[0-9a-f]{40}$/.test(prHeadSha) ? prHeadSha : "";
  if (!head || head !== rec.candidateSha) reasons.push("HEAD_NOT_TESTED_CANDIDATE");
  const valid = (c: CommandComment, who: readonly string[]) => tracedComment(c) && who.includes(c.author) && ["OWNER", "MEMBER", "COLLABORATOR"].includes(c.association);
  const pass = comments.filter((c) => valid(c, approvers.auditor) && c.body.trim() === `${AUDITOR_COMMAND} ${rec.id} ${head}`).sort((a, b) => a.createdAt.localeCompare(b.createdAt)).at(-1);
  if (!head || !pass) reasons.push(comments.some((c) => valid(c, approvers.auditor) && c.body.trim().startsWith(`${AUDITOR_COMMAND} ${rec.id} `)) ? "AUDITOR_PASS_STALE_OR_SHA_MISMATCH" : "AUDITOR_PASS_MISSING");
  const promote = pass && comments.find((c) => valid(c, approvers.architect) && c.body.trim() === `${PROMOTE_COMMAND} ${rec.id} ${head}` && c.createdAt > pass.createdAt);
  if (!promote) reasons.push(comments.some((c) => valid(c, approvers.architect) && c.body.trim().startsWith(`${PROMOTE_COMMAND} ${rec.id} `)) ? "ARCHITECT_PROMOTE_STALE_OR_SHA_MISMATCH" : "ARCHITECT_APPROVAL_MISSING");
  return { ok: reasons.length === 0, reasons, ...(pass && promote ? { auditorComment: pass.url, architectComment: promote.url } : {}) };
}

/** The record's own check must still hold; a record cannot carry a passing check for refused paths. */
function checkOkAgain(rec: SelfChangeRecord): boolean {
  return rec.paths.every((p) => protectedReason(p) === null);
}
