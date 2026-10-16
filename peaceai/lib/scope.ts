import ts from "typescript";
import type { DiffFile } from "./diff.ts";
import { STEP_NAME_LINE, STEP_RUN_LINE, WORKFLOW_FILE, workflowCandidateReason } from "./learned-workflow.ts";
import { workflowJobLinesReason } from "./workflow-job.ts";
import { tsconfigScriptCandidateReason } from "./tsconfig-script.ts";

// Candidate diffs may only touch source under src/. Existing tests are frozen; new test files may be added.
export const TEST_FILE = /\.test\.ts$/;
const SAFE_PATH = /^src\/[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*\.ts$/;

/** Per-target scope (M5). The default is this Workspace's rules. */
export interface CandidateScope {
  isSource: (path: string) => boolean;
  isTest: (path: string) => boolean;
  isDenied: (path: string) => boolean;
  /** M19: workflow files the target opts in for ADD_WORKFLOW_STEP (targets.json `workflowPattern`). */
  isWorkflow?: (path: string) => boolean;
  /** M67: the target opts in to TSCONFIG_SCRIPT candidates (targets.json `tsconfigScript: true`). */
  tsconfigScript?: boolean;
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
  /** M14: `testAppend` only for a graded learned test (summary `fixSha`): new cases appended at the end of an existing test file. */
  opts: { testAppend?: boolean } = {},
): ScopeViolation[] {
  const violations: ScopeViolation[] = [];
  if (files.length === 0) violations.push({ path: "(none)", reason: "empty diff" });
  // Auditor (#107, change 3): a workflow-step candidate is only its two workflow lines, nothing else.
  if (scope.isWorkflow) {
    const paths = files.map((f) => f.newPath ?? f.oldPath ?? "(unknown)");
    const why = workflowCandidateReason(paths, (p) => !scope.isSource(p) && !!scope.isWorkflow?.(p));
    if (why) violations.push({ path: paths.join(","), reason: why });
  }
  // M67 TSCONFIG_SCRIPT: on an opted-in target, package.json + one new root tsconfig.NAME.json, both re-checked.
  const tsPaths = new Set<string>();
  if (scope.tsconfigScript && files.some((f) => /^(?:package\.json|tsconfig\.[^/]+\.json)$/.test(f.newPath ?? ""))) {
    const why = tsconfigScriptCandidateReason(files.map((f) => ({ path: f.newPath ?? f.oldPath ?? "(unknown)", isNew: f.isNew, addedLines: f.addedLines, removedLines: f.removedLines })));
    if (why) violations.push({ path: "package.json", reason: `tsconfig script: ${why}` });
    else {
      for (const f of files) tsPaths.add(f.newPath!);
      if (baseFiles.has(files.find((f) => f.isNew)!.newPath!)) violations.push({ path: "tsconfig", reason: "creates a file that already exists" });
      if (!baseFiles.has("package.json")) violations.push({ path: "package.json", reason: "edits a file missing from base" });
    }
  }
  for (const file of files) {
    const path = file.newPath ?? file.oldPath ?? "(unknown)";
    if (tsPaths.has(path) && !file.isDeleted && !file.isRename && !file.isBinary && !file.modeChange && (file.newMode === null || file.newMode === "100644")) continue;
    if (file.isDeleted) violations.push({ path, reason: "deletes a file" });
    if (file.isRename) violations.push({ path, reason: "renames or copies a file" });
    if (file.isBinary) violations.push({ path, reason: "binary change" });
    if (file.modeChange || (file.newMode !== null && file.newMode !== "100644"))
      violations.push({ path, reason: "file mode change" });
    if (file.oldPath !== null && file.newPath !== null && file.oldPath !== file.newPath)
      violations.push({ path, reason: "path mismatch" });
    if (!scope.isSource(path) && scope.isWorkflow?.(path)) {
      const why = workflowStepReason(file, baseFiles.has(path));
      if (why) violations.push({ path, reason: `workflow step: ${why}` });
      continue;
    }
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
    if (exists && scope.isTest(path) && !(opts.testAppend && file.appendOnly)) violations.push({ path, reason: "modifies an existing test file" });
    else if (exists && scope.isTest(path)) {
      const why = appendedCaseReason(file.addedLines);
      if (why) violations.push({ path, reason: `appended test: ${why}` });
    }
  }
  return violations;
}

const HOOKS = new Set(["before", "beforeEach", "after", "afterEach", "mock"]);

/**
 * M14 shared-setup guard (Auditor): appended lines must be exactly one top-level `test("…", () => {…})`, with
 * no options argument, no .skip/.only/.todo, no hooks or mock.* anywhere, and nothing else at top level.
 * Returns the refusal reason, or null when the append is one plain case.
 */
export function appendedCaseReason(lines: readonly string[]): string | null {
  const sf = ts.createSourceFile("append.ts", lines.join("\n"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  if ((sf as unknown as { parseDiagnostics?: unknown[] }).parseDiagnostics?.length) return "does not parse";
  const stmts = sf.statements.filter((st) => !ts.isEmptyStatement(st));
  if (stmts.length !== 1) return "must be exactly one top-level statement";
  const st = stmts[0]!;
  if (!ts.isExpressionStatement(st) || !ts.isCallExpression(st.expression)) return "not a test() call";
  const call = st.expression;
  if (!ts.isIdentifier(call.expression) || call.expression.text !== "test") return "callee must be plain test (no .skip/.only/.todo)";
  if (call.arguments.length !== 2) return "test() takes exactly a name and a body (no options)";
  const [name, body] = call.arguments;
  if (!ts.isStringLiteral(name!) && !ts.isNoSubstitutionTemplateLiteral(name!)) return "test name must be a string literal";
  if (!ts.isArrowFunction(body!) || body.parameters.length !== 0 || !ts.isBlock(body.body)) return "body must be () => { ... }";
  let bad: string | null = null;
  const walk = (n: ts.Node): void => {
    if (bad) return;
    if (ts.isIdentifier(n) && HOOKS.has(n.text)) { bad = `uses ${n.text}`; return; }
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && (n.expression.text === "test" || n.expression.text === "describe" || n.expression.text === "it")) { bad = "nested test/describe"; return; }
    ts.forEachChild(n, walk);
  };
  walk(body.body);
  return bad;
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

/** M8 approval landing: facts the leak check gathers about an approval branch (never trusted from the PR). */
export interface ApprovalFacts {
  /** Commits on the branch ahead of the base. */
  ahead: number;
  /** Files changed by those commits (the whole range). */
  files: readonly string[];
  /** check-approved-list.ts (from main) passed on the branch's list. */
  listCheckPassed: boolean;
  /** The repository the check runs in (github.repository). */
  repository: string;
}
export const APPROVED_LIST_PATH = "peaceai/rules/approved.json";
export const APPROVE_BRANCH_PREFIX = "peaceai-approve-rule/";

/** Why the approved-list exemption does not apply, or null when every condition holds. */
export function approvalExemptionProblem(changes: readonly ChangedPath[], pr: PullRequestContext | null, facts: ApprovalFacts | null): string | null {
  if (!pr || !facts) return "no pull request context";
  if (!facts.repository || pr.headRepo !== facts.repository || pr.baseRepo !== facts.repository) return "head repository is not this repository (fork)";
  if (!pr.headRef.startsWith(APPROVE_BRANCH_PREFIX)) return "head branch is not an approval branch";
  if (facts.ahead !== 1) return "approval branch must be exactly one commit ahead of the base";
  if (facts.files.length !== 1 || facts.files[0] !== APPROVED_LIST_PATH) return "approval branch changes files other than the approved list";
  if (changes.length !== 1 || changes[0]!.path !== APPROVED_LIST_PATH || changes[0]!.status !== "M") return "approval branch must only modify the approved list";
  if (!facts.listCheckPassed) return "check-approved-list did not pass";
  return null;
}

export function checkPullRequestScope(
  changes: readonly ChangedPath[],
  pr: PullRequestContext | null,
  owner: string,
  approval: ApprovalFacts | null = null,
): ScopeViolation[] {
  const privileged = mayChangeProtected(pr, owner);
  // The approved list may change outside an owner PR only on a verified approval branch (Auditor's conditions).
  const listExempt = !privileged && approvalExemptionProblem(changes, pr, approval) === null;
  const violations: ScopeViolation[] = [];
  for (const change of changes) {
    if (privileged) continue;
    if (listExempt && change.path === APPROVED_LIST_PATH) continue;
    const added = change.status === "A";
    if (TEST_FILE.test(change.path) && added && isSafeCandidatePath(change.path)) continue;
    if (isProtectedPath(change.path))
      violations.push({ path: change.path, reason: `protected path changed (${change.status}) by a non-owner PR` });
    else if (change.status !== "A" && change.status !== "M")
      violations.push({ path: change.path, reason: `delete/rename (${change.status}) by a non-owner PR` });
  }
  return violations;
}

/**
 * M19: the only change a candidate may make to an opted-in workflow: exactly two ADDED lines forming one
 * `- name:` / `run: <npm|pnpm> run SCRIPT` step (the run line two spaces deeper than the dash), nothing removed,
 * an existing file. Anything else (uses, env, expressions, permissions, triggers, removals) is a violation.
 */
export function workflowStepReason(file: DiffFile, exists: boolean): string | null {
  if (!WORKFLOW_FILE.test(file.newPath ?? "")) return "not a workflow file";
  if (file.isNew || !exists) return "workflow must already exist";
  if (file.removedLines.length) return "removes or changes lines";
  // M67 WORKFLOW_JOB: one new job block appended at the end of the file (fixed read-only header; workflow-job.ts).
  if (file.addedLines.length !== 2) {
    const job = file.appendOnly ? workflowJobLinesReason(file.addedLines) : "not appended at the end";
    return job === null ? null : `must add exactly one two-line step (or one read-only job block: ${job})`;
  }
  const n = STEP_NAME_LINE.exec(file.addedLines[0]!);
  const r = STEP_RUN_LINE.exec(file.addedLines[1]!);
  if (!n || !r || r[1]!.length !== n[1]!.length + 2) return "not a name/run package-script step";
  if (/\$\{\{|secrets|token/i.test(file.addedLines.join("\n"))) return "expression or secret";
  return null;
}
