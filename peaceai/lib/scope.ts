import type { DiffFile } from "./diff.ts";

// Candidate diffs may only touch source under src/. Existing tests are frozen; new test files may be added.
export const TEST_FILE = /\.test\.ts$/;
const SAFE_PATH = /^src\/[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*\.ts$/;

/** Per-target scope (M5). The default is this Workspace's rules. */
export interface CandidateScope {
  isSource: (path: string) => boolean;
  isTest: (path: string) => boolean;
  isDenied: (path: string) => boolean;
}
export const WORKSPACE_SCOPE: CandidateScope = {
  isSource: (path) => isSafeCandidatePath(path),
  isTest: (path) => TEST_FILE.test(path),
  isDenied: () => false,
};

export interface ScopeViolation {
  path: string;
  reason: string;
}

export function isSafeCandidatePath(path: string): boolean {
  if (!SAFE_PATH.test(path)) return false;
  return !path.split("/").some((part) => part === ".." || part === "." || part.startsWith("."));
}

/**
 * Checks a parsed candidate diff against the scope rules.
 * baseFiles: every tracked path in the clean workspace at the base commit.
 */
export function checkCandidateScope(
  files: readonly DiffFile[],
  baseFiles: ReadonlySet<string>,
  scope: CandidateScope = WORKSPACE_SCOPE,
): ScopeViolation[] {
  const violations: ScopeViolation[] = [];
  if (files.length === 0) violations.push({ path: "(none)", reason: "empty diff" });
  for (const file of files) {
    const path = file.newPath ?? file.oldPath ?? "(unknown)";
    if (file.isDeleted) violations.push({ path, reason: "deletes a file" });
    if (file.isRename) violations.push({ path, reason: "renames or copies a file" });
    if (file.isBinary) violations.push({ path, reason: "binary change" });
    if (file.modeChange || (file.newMode !== null && file.newMode !== "100644"))
      violations.push({ path, reason: "file mode change" });
    if (file.oldPath !== null && file.newPath !== null && file.oldPath !== file.newPath)
      violations.push({ path, reason: "path mismatch" });
    if (!scope.isSource(path)) {
      violations.push({ path, reason: "outside allowed paths" });
      continue;
    }
    if (scope.isDenied(path)) {
      violations.push({ path, reason: "denied path for this target" });
      continue;
    }
    const exists = baseFiles.has(path);
    if (file.isNew && exists) violations.push({ path, reason: "creates a file that already exists" });
    if (!file.isNew && !exists) violations.push({ path, reason: "edits a file missing from base" });
    if (exists && scope.isTest(path)) violations.push({ path, reason: "modifies an existing test file" });
  }
  return violations;
}

/** Files a pull request may not change unless it is an owner PR from this repository. */
const PROTECTED = [
  /^\.github\//,
  /^package\.json$/,
  /^package-lock\.json$/,
  /^npm-shrinkwrap\.json$/,
  /^tsconfig[^/]*\.json$/,
  /^\.npmrc$/,
  /^\.gitignore$/,
  /^peaceai\//,
  /(^|\/)[^/]*\.test\.ts$/,
];

export function isProtectedPath(path: string): boolean {
  return PROTECTED.some((pattern) => pattern.test(path));
}

export interface PullRequestContext {
  author: string;
  headRepo: string;
  baseRepo: string;
  headRef: string;
}

/** Owner PRs from a non-bot branch in this repository may change protected files; everything else may not. */
export function mayChangeProtected(pr: PullRequestContext | null, owner: string): boolean {
  if (!pr) return false;
  return pr.author === owner && pr.headRepo === pr.baseRepo && !pr.headRef.startsWith("peace-task/");
}

export interface ChangedPath {
  status: string; // git name-status letter: A, M, D, R..., C..., T
  path: string;
}

export function checkPullRequestScope(
  changes: readonly ChangedPath[],
  pr: PullRequestContext | null,
  owner: string,
): ScopeViolation[] {
  const privileged = mayChangeProtected(pr, owner);
  const violations: ScopeViolation[] = [];
  for (const change of changes) {
    if (privileged) continue;
    const added = change.status === "A";
    if (TEST_FILE.test(change.path) && added && isSafeCandidatePath(change.path)) continue;
    if (isProtectedPath(change.path))
      violations.push({ path: change.path, reason: `protected path changed (${change.status}) by a non-owner PR` });
    else if (change.status !== "A" && change.status !== "M")
      violations.push({ path: change.path, reason: `delete/rename (${change.status}) by a non-owner PR` });
  }
  return violations;
}
