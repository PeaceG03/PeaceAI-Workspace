// M6 Builder-side apply script (run on the box, never in Actions). Usage:
//   apply-verdict-patch.sh <issue> [--worktree <PeaceSTOCKS clone>] [--check]
// 1. Fetches the latest PeaceAI patch comment on the Workspace issue (posted by github-actions[bot]).
// 2. Reads Results READ-ONLY through gh: the latest attempt, its verdicts (effective pick) and the
//    pick's candidate diff. Recomputes SHA-256 values and requires: patch hash = posted hash, posted
//    diff hash = Results diff hash, and the patch's own diff = the Results diff, byte for byte.
// 3. Requires the patch's From: line to be the noreply identity.
// 4. Runs `git am` in the worktree (which must be a clean PeaceSTOCKS clone). Never pushes.
// 5. M18: a worktree head past the task base is refused; stale bases are regraded only through Job B.
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { effectiveVerdict, type TaskRecord, type VerdictRecord } from "../lib/records.ts";
import { NOREPLY_EMAIL, NOREPLY_NAME, parsePatchComment, PATCH_MARKER, verifyPatch } from "../lib/patch.ts";

const WORKSPACE = "PeaceG03/PeaceAI-Workspace";
const RESULTS = "PeaceG03/PeaceAI-Results";
const BOT = "github-actions[bot]";

function die(message: string): never {
  console.error(`apply-verdict-patch: REFUSED: ${message}`);
  process.exit(1);
}

const args = process.argv.slice(2);
const issue = args[0] ?? "";
if (!/^\d{1,9}$/.test(issue)) die("usage: apply-verdict-patch.sh <issue> [--worktree DIR] [--check]");
const wtIndex = args.indexOf("--worktree");
const worktree = resolve(wtIndex >= 0 ? (args[wtIndex + 1] ?? "") : process.cwd());
const checkOnly = args.includes("--check");

const gh = (...a: string[]): string => {
  const r = spawnSync("gh", a, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) die(`gh ${a[0]} ${a[1] ?? ""} failed`);
  return r.stdout;
};
const raw = (repo: string, path: string): string | null => {
  const r = spawnSync("gh", ["api", "-H", "Accept: application/vnd.github.raw+json", `repos/${repo}/contents/${path}`], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return r.status === 0 ? r.stdout : null;
};
const names = (repo: string, path: string): string[] => {
  const r = spawnSync("gh", ["api", `repos/${repo}/contents/${path}`, "--jq", ".[].name"], { encoding: "utf8" });
  return r.status === 0 ? r.stdout.split("\n").filter(Boolean) : [];
};

// 1. Latest patch comment from the workflow bot.
const comments = gh("api", "--paginate", `repos/${WORKSPACE}/issues/${issue}/comments?per_page=100`, "--jq", ".[] | {user: .user.login, body: .body}")
  .split("\n")
  .filter(Boolean)
  .map((line) => JSON.parse(line) as { user: string; body: string });
const posted = comments.filter((c) => c.user === BOT && c.body.replace(/\r\n/g, "\n").startsWith(PATCH_MARKER + "\n")).pop();
if (!posted) die("no PeaceAI patch comment on this issue");
const comment = parsePatchComment(posted.body);
if (!comment) die("patch comment is malformed");

// 2. Results, read-only.
const runs = names(RESULTS, `tasks/${issue}`).filter((n) => /^\d{1,20}$/.test(n));
runs.sort((a, b) => (BigInt(a) < BigInt(b) ? -1 : 1));
const latestRunId = runs[runs.length - 1] ?? null;
let resultsDiff: string | null = null;
let pick = { decided: false, candidateId: null as string | null };
let baseSha = "";
let target = "";
if (latestRunId) {
  const dir = `tasks/${issue}/${latestRunId}`;
  const task = JSON.parse(raw(RESULTS, `${dir}/task.json`) ?? "null") as TaskRecord | null;
  if (!task) die("Results task record missing");
  baseSha = task.baseSha;
  target = task.target ?? WORKSPACE;
  const verdicts = names(RESULTS, `${dir}/verdicts`)
    .filter((n) => /^\d{1,20}\.json$/.test(n))
    .map((n) => JSON.parse(raw(RESULTS, `${dir}/verdicts/${n}`) ?? "null") as VerdictRecord)
    .filter(Boolean);
  pick = effectiveVerdict(verdicts).pick;
  if (pick.candidateId && /^candidate-\d{1,3}$/.test(pick.candidateId)) resultsDiff = raw(RESULTS, `${dir}/candidates/${pick.candidateId}.diff`);
}
const reasons = verifyPatch({ comment, resultsDiff, effectivePick: pick, latestRunId });
if (comment.target !== target) reasons.push("patch target does not match the Results task target");
if (reasons.length) die(reasons.join("; "));
console.log(`verified: issue #${issue} run ${comment.runId} ${comment.candidateId} diff-sha256 ${comment.diffSha256} patch-sha256 ${comment.patchSha256}`);
if (checkOnly) {
  console.log("check only: not applied");
  process.exit(0);
}

// 4. git am in a clean clone of the target. No push, ever.
const git = (...a: string[]) => execFileSync("git", ["-C", worktree, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
let origin = "";
try {
  origin = git("remote", "get-url", "origin");
} catch {
  die("worktree is not a git clone with an origin");
}
const repoOf = /github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?\/?$/i.exec(origin)?.[1] ?? "";
if (repoOf.toLowerCase() !== target.toLowerCase()) die(`worktree origin is not ${target}`);
if (git("status", "--porcelain")) die("worktree has uncommitted changes");
const head = git("rev-parse", "HEAD");
// M18: a stale base is never regraded here any more. Its patch was built on the old base, and the only
// accepted regrade is the one through sandboxed Job B with a Results record (lib/regrade.ts). Refused.
if (head !== baseSha)
  die(`stale base: worktree HEAD ${head.slice(0, 12)} is not the task base ${baseSha.slice(0, 12)}. Re-post the verdict after the stale-base regrade route (M18): it posts a regrade request; re-queue the task to regrade in Job B`);
const dir = mkdtempSync(join(tmpdir(), "peaceai-patch-"));
try {
  const file = join(dir, "verdict.patch");
  writeFileSync(file, comment.patch);
  const am = spawnSync("git", ["-C", worktree, "-c", `user.name=${NOREPLY_NAME}`, "-c", `user.email=${NOREPLY_EMAIL}`, "am", "--quiet", file], { encoding: "utf8" });
  if (am.status !== 0) {
    spawnSync("git", ["-C", worktree, "am", "--abort"], { encoding: "utf8" });
    die("git am failed (aborted; worktree unchanged)");
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}
console.log(`applied: ${git("rev-parse", "HEAD")} (${git("log", "-1", "--format=%an <%ae>")}). Not pushed; pushing is a separate manual step.`);
