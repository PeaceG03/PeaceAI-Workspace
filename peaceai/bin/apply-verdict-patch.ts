// M6 Builder-side apply script (run on the box, never in Actions). Usage:
//   apply-verdict-patch.sh <issue> [--worktree <PeaceSTOCKS clone>] [--check]
// 1. Fetches the latest PeaceAI patch comment on the Workspace issue (posted by github-actions[bot]).
// 2. Reads Results READ-ONLY through gh: the latest attempt, its verdicts (effective pick) and the
//    pick's candidate diff. Recomputes SHA-256 values and requires: patch hash = posted hash, posted
//    diff hash = Results diff hash, and the patch's own diff = the Results diff, byte for byte.
// 3. Requires the patch's From: line to be the noreply identity.
// 4. Runs `git am` in the worktree (which must be a clean PeaceSTOCKS clone). Never pushes.
// 5. M18: a worktree head past the task base is refused; stale bases are regraded only through Job B.
// 6. Stacked batch (lib/stacked.ts): with `--stacked-batch <n,n,...>` (the batch's issue numbers), a head
//    past the base is accepted ONLY when every commit since the base is a verified verdict patch of that
//    batch graded on the same base, the files are disjoint, the patch applies byte-identically and the full
//    suite passes on the result in a throwaway worktree. Otherwise the M18 refusal stands. Never pushes.
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { effectiveVerdict, type TaskRecord, type VerdictRecord } from "../lib/records.ts";
import { NOREPLY_EMAIL, NOREPLY_NAME, parsePatchComment, PATCH_MARKER, splitPatch, verifyPatch, type PatchComment } from "../lib/patch.ts";
import { checkStack, collectStack, provenanceClause, trialLand, type BatchMember } from "../lib/stacked.ts";
import { loadTargets } from "../lib/target.ts";

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
const sbIndex = args.indexOf("--stacked-batch");
const stackedBatch: number[] | null = sbIndex >= 0 ? (args[sbIndex + 1] ?? "").split(",").map((x) => (/^\d{1,9}$/.test(x) ? Number(x) : NaN)) : null;
if (stackedBatch && (stackedBatch.length === 0 || stackedBatch.some((n) => !Number.isInteger(n)))) die("--stacked-batch takes comma-separated issue numbers");

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

// Steps 1-2 for one issue: the landing issue and, in stacked mode, every other batch issue.
function verifyIssue(n: string): { comment: PatchComment; baseSha: string; target: string } {
  // 1. Latest patch comment from the workflow bot.
  const comments = gh("api", "--paginate", `repos/${WORKSPACE}/issues/${n}/comments?per_page=100`, "--jq", ".[] | {user: .user.login, body: .body}")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as { user: string; body: string });
  const posted = comments.filter((c) => c.user === BOT && c.body.replace(/\r\n/g, "\n").startsWith(PATCH_MARKER + "\n")).pop();
  if (!posted) die(`${n === issue ? "" : `#${n}: `}no PeaceAI patch comment on this issue`);
  const comment = parsePatchComment(posted.body);
  if (!comment) die(`${n === issue ? "" : `#${n}: `}patch comment is malformed`);

  // 2. Results, read-only.
  const runs = names(RESULTS, `tasks/${n}`).filter((n) => /^\d{1,20}$/.test(n));
  runs.sort((a, b) => (BigInt(a) < BigInt(b) ? -1 : 1));
  const latestRunId = runs[runs.length - 1] ?? null;
  let resultsDiff: string | null = null;
  let pick = { decided: false, candidateId: null as string | null };
  let baseSha = "";
  let target = "";
  if (latestRunId) {
    const dir = `tasks/${n}/${latestRunId}`;
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
  if (reasons.length) die(`${n === issue ? "" : `#${n}: `}${reasons.join("; ")}`);
  return { comment, baseSha, target };
}
const { comment, baseSha, target } = verifyIssue(issue);
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
let stackedVia: string[] | null = null;
let stackedTree = "";
if (head !== baseSha && stackedBatch) {
  const diff = (() => { const p = splitPatch(comment.patch); return "error" in p ? die(p.error) : p.diff; })();
  const members: BatchMember[] = stackedBatch.filter((n) => String(n) !== issue).map((n) => {
    const v = verifyIssue(String(n));
    if (v.target !== target) die(`#${n}: batch issue targets another repo`);
    const p = splitPatch(v.comment.patch);
    return { issue: n, baseSha: v.baseSha, diff: "error" in p ? die(`#${n}: ${p.error}`) : p.diff };
  });
  const decision = checkStack({ issue: Number(issue), base: baseSha, head, diff, members, commits: collectStack(worktree, baseSha, head) });
  if (!decision.ok) die(`stacked: ${decision.reason}: ${decision.detail}`);
  const install = loadTargets().targets[target]?.install ?? "npm";
  const suite = (dir: string) => {
    const pm = install === "pnpm" ? "pnpm" : "npm";
    const inst = spawnSync(pm, pm === "pnpm" ? ["install", "--frozen-lockfile"] : ["ci"], { cwd: dir, stdio: "inherit" });
    return inst.status === 0 && spawnSync(pm, ["test"], { cwd: dir, stdio: "inherit" }).status === 0;
  };
  const trial = trialLand({ worktree, head, patch: comment.patch, diff, identity: { name: NOREPLY_NAME, email: NOREPLY_EMAIL }, suite });
  if (!trial.ok) die(`stacked: ${trial.reason}: ${trial.detail}`);
  stackedVia = decision.via.map((v) => v.sha);
  stackedTree = trial.tree;
  console.log(`stacked: ${decision.via.length} intermediate verdict patch(es) of the batch (${decision.via.map((v) => "#" + v.issue).join(", ")}); files disjoint; byte-identical; full suite passed`);
}
if (head !== baseSha && !stackedVia)
  die(`stale base: worktree HEAD ${head.slice(0, 12)} is not the task base ${baseSha.slice(0, 12)}. Re-post the verdict after the stale-base regrade route (M18): it posts a regrade request; re-queue the task to regrade in Job B`);
const dir = mkdtempSync(join(tmpdir(), "peaceai-patch-"));
try {
  const file = join(dir, "verdict.patch");
  writeFileSync(file, comment.patch);
  const am = spawnSync("git", ["-C", worktree, "-c", `user.name=${NOREPLY_NAME}`, "-c", `user.email=${NOREPLY_EMAIL}`, "am", "--quiet", "--no-3way", file], { encoding: "utf8" });
  if (am.status !== 0) {
    spawnSync("git", ["-C", worktree, "am", "--abort"], { encoding: "utf8" });
    die("git am failed (aborted; worktree unchanged)");
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}
console.log(`applied: ${git("rev-parse", "HEAD")} (${git("log", "-1", "--format=%an <%ae>")}). Not pushed; pushing is a separate manual step.`);
if (stackedVia && git("rev-parse", "HEAD^{tree}") !== stackedTree) die("stacked: applied tree differs from the trial tree that passed the suite (commit left local, unpushed; drop it with git reset --keep HEAD^)");
if (stackedVia) console.log(`provenance (put in the builder-log why): ${provenanceClause(baseSha, head, stackedVia)}`);
