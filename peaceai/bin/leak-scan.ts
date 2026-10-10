// Per-PR / scheduled leak check (no core access). Prints paths, line numbers and kinds only.
import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { parseTerms, scanText } from "../lib/leak.ts";
import { checkPullRequestScope, type ChangedPath, type PullRequestContext } from "../lib/scope.ts";
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
  const pr: PullRequestContext | null = process.env.PR_AUTHOR
    ? {
        author: process.env.PR_AUTHOR,
        headRepo: process.env.PR_HEAD_REPO ?? "",
        baseRepo: process.env.PR_BASE_REPO ?? "",
        headRef: process.env.PR_HEAD_REF ?? "",
      }
    : null;
  for (const violation of checkPullRequestScope(changes, pr, OWNER)) fail(`scope ${violation.path}: ${violation.reason}`);
  }
} else if (process.env.LEAK_REQUIRE_BASE === "true") {
  fail("missing base commit for PR range");
}

if (failures > 0) process.exit(1);
console.log(`LEAK PASS files=${tracked.length} private_terms=${terms.length > 0 ? "on" : "off"}`);
