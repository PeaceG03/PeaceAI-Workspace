// M11: self-improvement sandbox. PeaceAI may PROPOSE a change to its own code (this repo's peaceai/), but the change
// is built and tested in a separate copy (a throwaway git worktree on this box or in a private repo's job), never
// in the live checkout. Nothing here pushes, merges or edits the live tree; promotion is a normal PR that a human
// lands after the gates below, and every self-change is recorded in private Results with a one-step rollback.
import { createHash } from "node:crypto";

export const SELF_SCHEMA = "peaceai-self-change:v1";
export const AUDITOR_LABEL = "self-change:auditor-passed";
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
  { pattern: /^\.github\//, why: "workflows, required checks and approval workflows" },
  { pattern: /^\.githooks\/|(^|\/)\.git\//, why: "git hooks" },
  { pattern: /^(package(-lock)?\.json|npm-shrinkwrap\.json|\.npmrc|tsconfig[^/]*\.json|\.gitignore|\.gitattributes)$/, why: "dependencies and build config" },
  { pattern: /^(README\.md|CONSTITUTION[^/]*|SECURITY[^/]*|CODEOWNERS|LICENSE[^/]*)$/, why: "governance documents" },
  { pattern: /^peaceai\/rules\//, why: "approved learned-rule list and rule specs" },
  { pattern: /^peaceai\/test\//, why: "the live test suite (new tests go under peaceai/self-tests/)" },
  { pattern: /^(?!peaceai\/self-tests\/)(.*\/)?[^/]*\.test\.ts$/, why: "existing tests anywhere (new tests go under peaceai/self-tests/)" },
  { pattern: /^peaceai\/bin\/(approve-rule[^/]*|check-approved-list\.ts|leak-scan\.ts|prepush-scan\.ts|core-scan\.ts|install-pre-push\.sh|push-proof-main\.sh|await-checks\.sh|clone-core\.sh|self-change\.ts|nl-refusal\.ts|regate\.ts|gate\.ts)$/, why: "approval, leak, scan, hook, gate and self-change tools" },
  { pattern: /^peaceai\/lib\/(leak|approval|approved|scope|prguard|kernelguard|coretext|coreindex|substr|policy|gate|selfchange|learned|results|verdict|trigger)\.ts$/, why: "gates, approvals, leak/scope scanners and the self-change rules" },
  { pattern: /^peaceai\/lib\/lm\.ts$|^peaceai\/model\//, why: "the model, its memcheck and job guard" },
  { pattern: /^peaceai\/self\//, why: "self-change records and configuration" },
];

/** Strings a self-change may not ADD anywhere: they reach the protected set or the credentials by content. */
const CONTENT_BANNED: readonly { pattern: RegExp; why: string }[] = [
  { pattern: /\.github\//, why: "names the workflow directory" },
  { pattern: /approved\.json|peaceai\/rules\//, why: "names the approved-rule list" },
  { pattern: /peaceai\/test\/|self-tests\/.*\.\.\//, why: "reaches into the live tests" },
  { pattern: /hooksPath|pre-push|--no-verify/, why: "touches git hooks" },
  { pattern: /GITHUB_TOKEN|GH_TOKEN|DEPLOY_KEY|PEACEAI_[A-Z_]*KEY|secrets\./, why: "names a credential" },
  { pattern: /\/approve-rule|\/promote-self-change|self-change:auditor-passed/, why: "names an approval command or label" },
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

/** The box (not Actions) or an Actions job in a private repo on the allowlist; never the public Workspace. */
export function selfChangeAllowedHere(env: Record<string, string | undefined>): { ok: boolean; reason?: string } {
  if (env.GITHUB_ACTIONS !== "true") return { ok: true };
  if (!(PRIVATE_RUNNERS as readonly string[]).includes(env.GITHUB_REPOSITORY ?? "")) return { ok: false, reason: "PUBLIC_RUNNER_REFUSED" };
  if (env.GITHUB_EVENT_NAME !== "workflow_dispatch" && env.GITHUB_EVENT_NAME !== "issues") return { ok: false, reason: "START_MANUALLY_OR_ON_PROPOSAL" };
  return { ok: true };
}

export function budgetMinutes(asked: string | undefined): number {
  const n = Number(asked ?? DEFAULT_BUDGET_MINUTES);
  return Number.isFinite(n) && n > 0 ? Math.min(n, MAX_BUDGET_MINUTES) : DEFAULT_BUDGET_MINUTES;
}

// ---- promotion

export interface TestRun { suite: "live" | "new"; files: string[]; filesSha256: string; exitCode: number; pass: number; fail: number }
export interface LabelEvent { label: string; actor: string; createdAt: string }
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

export interface PromotionDecision { ok: boolean; reasons: string[]; architectComment?: string }

/**
 * Promotion needs ALL of: a clean protected-set check; the LIVE version's existing test suite (the file list
 * taken from the base commit, unchanged) run against the candidate and passing; any new tests passing; Auditor's
 * label; and, after that label, Architect's command comment naming this change and its exact candidate sha.
 */
export function promotionDecision(rec: SelfChangeRecord, liveFilesAtBase: readonly string[], labels: readonly LabelEvent[], comments: readonly CommandComment[], approvers: { auditor: readonly string[]; architect: readonly string[] }): PromotionDecision {
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
  const label = labels.filter((l) => l.label === AUDITOR_LABEL && approvers.auditor.includes(l.actor)).sort((a, b) => a.createdAt.localeCompare(b.createdAt)).at(-1);
  if (!label) reasons.push("AUDITOR_REVIEW_MISSING");
  const want = `${PROMOTE_COMMAND} ${rec.id} ${rec.candidateSha}`;
  const cmd = comments.find((c) => c.body.trim() === want && approvers.architect.includes(c.author) && tracedComment(c) && ["OWNER", "MEMBER", "COLLABORATOR"].includes(c.association) && (!label || c.createdAt > label.createdAt));
  if (!cmd) reasons.push("ARCHITECT_APPROVAL_MISSING");
  return { ok: reasons.length === 0, reasons, ...(cmd ? { architectComment: cmd.url } : {}) };
}

/** The record's own check must still hold; a record cannot carry a passing check for refused paths. */
function checkOkAgain(rec: SelfChangeRecord): boolean {
  return rec.paths.every((p) => protectedReason(p) === null);
}
