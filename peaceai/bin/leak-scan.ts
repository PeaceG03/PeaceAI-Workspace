// Per-PR / scheduled leak check (no core access). Prints paths, line numbers and kinds only.
import { execFileSync, spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { readFileSync, statSync } from "node:fs";
import { parseTerms, scanText } from "../lib/leak.ts";
import { APPROVE_BRANCH_PREFIX, approvalExemptionProblem, checkPullRequestScope, PEACE_TASK_BRANCH, type ApprovalFacts, type ChangedPath, type PullRequestContext, type SelfZoneFacts } from "../lib/scope.ts";
import { inSafeZone, WORKSPACE_TARGET } from "../lib/self-zone.ts";
import { OWNER } from "../lib/trigger.ts";

const git = (...args: string[]) => execFileSync("git", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
const base = process.env.LEAK_BASE_SHA ?? "";
const terms = parseTerms(process.env.PEACEAI_PRIVATE_TERMS);
let failures = 0;
const fail = (message: string) => {
  failures += 1;
  console.log(`LEAK FAIL ${message}`);
};

// 1. Full tracked tree: personal info, secrets, optional private terms.
const tracked = git("ls-files", "-z").split("\0").filter(Boolean);
for (const path of tracked) {
  if (!statSync(path).isFile() || statSync(path).size > 2_000_000) continue;
  const content = readFileSync(path);
  if (content.includes(0)) continue; // binary
  for (const finding of scanText(content.toString("utf8"), terms)) fail(`${path}:${finding.line}: ${finding.kind}`);
}
for (const path of tracked) for (const finding of scanText(path, terms)) fail(`path name ${path}: ${finding.kind}`);

if (/^[0-9a-f]{40}$/.test(base)) {
  // 2. Commit metadata in the PR range must use noreply addresses.
  const identities = git("log", "--format=%ae%n%ce%n%an%n%cn", `${base}..HEAD`).split("\n").filter(Boolean);
  for (const value of identities) {
    if (value.includes("@") && !/@users\.noreply\.github\.com$|^noreply@github\.com$/i.test(value)) fail("commit email is not a noreply address");
    else if (!value.includes("@")) for (const finding of scanText(value, terms)) fail(`commit identity: ${finding.kind}`);
  }
  // 3. Scope: protected files may only change in an owner PR from this repository.
  // Pushes to main were already reviewed as PRs, so only identities are checked there.
  if (process.env.LEAK_SKIP_SCOPE !== "true") {
  const changes: ChangedPath[] = git("diff", "--name-status", "--no-renames", "-z", `${base}...HEAD`)
    .split("\0")
    .filter(Boolean)
    .reduce<ChangedPath[]>((acc, token, index, all) => {
      if (index % 2 === 0) acc.push({ status: token.charAt(0), path: all[index + 1] ?? "" });
      return acc;
    }, []);
  const pr: PullRequestContext | null = process.env.PR_AUTHOR || process.env.PR_HEAD_REF
    ? {
        author: process.env.PR_AUTHOR ?? "",
        headRepo: process.env.PR_HEAD_REPO ?? "",
        baseRepo: process.env.PR_BASE_REPO ?? "",
        headRef: process.env.PR_HEAD_REF ?? "",
      }
    : null;
  // M8: facts for the approved-list exemption, gathered here (never taken from the PR): commits ahead, files in
  // the range, and check-approved-list.ts from main (this scanner checkout) run on the branch's list.
  let approval: ApprovalFacts | null = null;
  if (pr?.headRef.startsWith(APPROVE_BRANCH_PREFIX)) {
    const files = git("diff", "--name-only", "--no-renames", "-z", `${base}...HEAD`).split("\0").filter(Boolean);
    const ahead = Number(git("rev-list", "--count", `${base}..HEAD`).trim());
    const checker = join(dirname(import.meta.dirname), "bin", "check-approved-list.ts");
    const tsx = join(dirname(dirname(import.meta.dirname)), "node_modules", ".bin", "tsx");
    const listCheckPassed = spawnSync(tsx, [checker], { encoding: "utf8", env: { ...process.env, GITHUB_HEAD_REF: pr.headRef }, stdio: ["ignore", "inherit", "inherit"] }).status === 0;
    approval = { ahead, files, listCheckPassed, repository: process.env.GITHUB_REPOSITORY ?? "" };
    const why = approvalExemptionProblem(changes, pr, approval);
    console.log(why ? `approval-branch exemption refused: ${why}` : "approval-branch exemption: all conditions hold");
  }
  // M78: a verdict branch (peace-task/issue-*) may add/modify exactly the self-zone safe paths (inSafeZone), only when
  // the BASE commit's targets.json enables selfZone and this is the Workspace (the PR's own targets.json is never read).
  let zone: SelfZoneFacts | null = null;
  if (pr && PEACE_TASK_BRANCH.test(pr.headRef)) {
    let on = false;
    try {
      const t = JSON.parse(git("show", `${base}:peaceai/targets.json`)) as { targets?: Record<string, { selfZone?: unknown }> };
      on = t.targets?.[WORKSPACE_TARGET]?.selfZone === true;
    } catch { on = false; }
    const here = (process.env.GITHUB_REPOSITORY ?? "") === WORKSPACE_TARGET && pr.baseRepo === WORKSPACE_TARGET && pr.headRepo === WORKSPACE_TARGET;
    zone = { enabled: on && here, allowed: inSafeZone };
    console.log(`self-zone exemption: ${zone.enabled ? "on" : "off"} (base selfZone ${on}, workspace ${here})`);
  }
  for (const violation of checkPullRequestScope(changes, pr, OWNER, approval, zone)) fail(`scope ${violation.path}: ${violation.reason}`);
  }
} else if (process.env.LEAK_REQUIRE_BASE === "true") {
  fail("missing base commit for PR range");
}

if (failures > 0) process.exit(1);
console.log(`LEAK PASS files=${tracked.length} private_terms=${terms.length > 0 ? "on" : "off"}`);
