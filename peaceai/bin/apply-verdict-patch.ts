// M6 Builder-side apply script (run on the box, never in Actions). Usage:
//   apply-verdict-patch.sh <issue> [--worktree <PeaceSTOCKS clone>] [--check]
// 1. Fetches the latest PeaceAI patch comment on the Workspace issue (posted by github-actions[bot]).
// 2. Reads Results READ-ONLY through gh: the latest attempt, its verdicts (effective pick) and the
//    pick's candidate diff. Recomputes SHA-256 values and requires: patch hash = posted hash, posted
//    diff hash = Results diff hash, and the patch's own diff = the Results diff, byte for byte.
// 3. Requires the patch's From: line to be the noreply identity.
// 4. Runs `git am` in the worktree (which must be a clean PeaceSTOCKS clone). Never pushes.
// 5. M16: if the worktree head is past the task base, the candidate is re-applied cleanly (or refused) and
//    graded fresh on the new tree (lib/rebase.ts); the task-time grade is never carried forward.
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { effectiveVerdict, type TaskRecord, type VerdictRecord } from "../lib/records.ts";
import { rebaseAndRegrade, regradeRecord } from "../lib/rebase.ts";
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
if (head !== baseSha) console.log(`note: worktree HEAD ${head.slice(0, 12)} is not the task base ${baseSha.slice(0, 12)}: stale base, re-applying onto the current head and grading fresh (the task-time grade is not used)`);
const dir = mkdtempSync(join(tmpdir(), "peaceai-patch-"));
try {
  const file = join(dir, "verdict.patch");
  writeFileSync(file, comment.patch);
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("NODE_TEST")));
  const ok = (cmd: string, a: string[]) => spawnSync(cmd, a, { cwd: worktree, encoding: "utf8", env, stdio: "ignore" }).status === 0;
  const r = rebaseAndRegrade({
    worktree, patchFile: file, baseSha, identity: { name: NOREPLY_NAME, email: NOREPLY_EMAIL },
    run: { suite: (d) => ok("npm", ["test", "--prefix", d]), tests: (d, files) => ok(join(d, "node_modules/.bin/tsx"), ["--test", ...files]) },
  });
  if (!r.ok) die(`${r.reason} (worktree reset to ${head.slice(0, 12)})`);
  if (r.stale) {
    const g = r.grade;
    const trailer = `PeaceAI-Regrade: fresh on ${head.slice(0, 12)} (task base ${baseSha.slice(0, 12)}): suite=${g.suite ? "pass" : "fail"} new-tests=${g.newTests.length} after=${g.afterPass === null ? "n/a" : g.afterPass ? "pass" : "fail"} before=${g.beforeFail === null ? "n/a" : g.beforeFail ? "fail" : "pass"} verdict=${g.verdict}`;
    const msg = git("log", "-1", "--format=%B");
    // M17: the regrade record (old base -> new head -> fresh grade) rides in the commit as one JSON trailer, and
    // is written next to the clone's git dir for the verdict (results-land stays disabled; nothing is pushed).
    const record = regradeRecord({ issue: Number(issue), runId: comment.runId, candidateId: comment.candidateId, diffSha256: comment.diffSha256, patchSha256: comment.patchSha256, oldBase: baseSha, newHead: head, appliedCommit: null, grade: g });
    execFileSync("git", ["-C", worktree, "-c", `user.name=${NOREPLY_NAME}`, "-c", `user.email=${NOREPLY_EMAIL}`, "commit", "--quiet", "--amend", "-m", `${msg}\n\n${trailer}\nPeaceAI-Regrade-Record: ${JSON.stringify(record)}`], { stdio: "ignore" });
    const gitDir = resolve(worktree, git("rev-parse", "--git-dir"));
    mkdirSync(join(gitDir, "peaceai"), { recursive: true });
    writeFileSync(join(gitDir, "peaceai", `regrade-${issue}-${comment.runId}.json`), JSON.stringify({ ...record, appliedCommit: git("rev-parse", "HEAD") }, null, 2) + "\n");
    console.log(trailer);
    console.log(`regrade record: ${join(gitDir, "peaceai", `regrade-${issue}-${comment.runId}.json`)}`);
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}
console.log(`applied: ${git("rev-parse", "HEAD")} (${git("log", "-1", "--format=%an <%ae>")}). Not pushed; pushing is a separate manual step.`);
