// M218 (batch 54): build a sandboxed-loop PlanTask from a failing self-zone self-test on PeaceAI's own
// SELF_ALLOW repos. Spec: peaceai/spec/self-loop-task-v1.md.
// EXPERIMENTAL, NOT default, NOT for credit. Reuses SELF_ALLOW / isSelfAllowForbiddenPath (loop.ts) and
// inSafeZone / SAFE_HELPERS (self-zone.ts); no duplicate protected lists.
//
// Why: #715 allowed the loop to target PeaceG03/PeaceAI-Workspace and PeaceAI; stage-2 is about to flip.
// The deepest local readiness step is a task *source* that turns a real failing self-test (safe-zone helper)
// into a PlanTask the loop can plan -> edit -> verify, while refusing protected / outside-safe paths.
import { createHash } from "node:crypto";
import { inSafeZone, SAFE_HELPERS, isSelfProtected } from "./self-zone.ts";
import { isLoopSelfTarget, isSelfAllowForbiddenPath, SELF_ALLOW } from "./loop.ts";
import { PLAN_LICENSES, PLAN_TASKS_SCHEMA, taskProblem, type PlanTask, type PlanTaskFile } from "./plan.ts";

export const SELF_LOOP_SCHEMA = "peaceai-self-loop-task:v1" as const;

/** Fixed refusal codes (no path text in the code itself beyond a fixed detail token). */
export const SELF_LOOP_REFUSALS = [
  "SELF_LOOP_REPO", // not on SELF_ALLOW (or still SELF_TARGET)
  "SELF_LOOP_PROTECTED", // edit or test path hits PROTECTED_SELF / never-zone
  "SELF_LOOP_OUTSIDE_SAFE", // edit path not in the self-zone safe surface
  "SELF_LOOP_TEST", // test path not a self-tests file the safe zone admits
  "SELF_LOOP_REQUEST", // request too short / too long / empty
  "SELF_LOOP_PIN", // commit / merge / license pin malformed
  "SELF_LOOP_ID", // bad task id
] as const;
export type SelfLoopRefuse = (typeof SELF_LOOP_REFUSALS)[number];

const HEX40 = /^[0-9a-f]{40}$/;
const HEX64 = /^[0-9a-f]{64}$/;
const ID = /^[a-z0-9][a-z0-9-]{0,40}$/;

export interface SelfLoopGap {
  /** PlanTask.id */
  readonly id: string;
  /** Plain-language request (as a person would file it). */
  readonly request: string;
  /** SELF_ALLOW repo, exact owner/name (case folded against SELF_ALLOW). */
  readonly repo: string;
  /** Source file the fix must edit: a SAFE_HELPERS path (or another inSafeZone non-test source). */
  readonly editPath: string;
  /** Failing self-test file under peaceai/self-tests/ (safe-zone test shape). */
  readonly testPath: string;
  /** Pinned pre-change commit (buggy helper). */
  readonly commit: string;
  /** Reference merge commit that holds the fixed helper + the team self-test. */
  readonly merge: string;
  readonly license?: (typeof PLAN_LICENSES)[number];
  readonly licensePath?: string;
  readonly licenseSha256: string;
  readonly testCommand?: string;
  readonly workspaceCommit?: string;
}

export type SelfLoopResult =
  | { readonly ok: true; readonly task: PlanTask }
  | { readonly ok: false; readonly code: SelfLoopRefuse; readonly detail?: string };

const sha256 = (t: string) => createHash("sha256").update(t).digest("hex");

/** Why an edit path is refused for a self-loop task (null = admitted). Tagged for mutation. */
export function selfLoopEditRefusal(path: string): SelfLoopRefuse | null {
  if (typeof path !== "string" || !path) return "SELF_LOOP_OUTSIDE_SAFE";
  if (isSelfAllowForbiddenPath(path) || isSelfProtected(path)) return "SELF_LOOP_PROTECTED"; // m218-guard:protected
  if (!inSafeZone(path)) return "SELF_LOOP_OUTSIDE_SAFE"; // m218-guard:safe
  // Source edits must be a named helper (not a test file): the team test is the proof, not the edit.
  if (/\.test\.ts$/i.test(path)) return "SELF_LOOP_OUTSIDE_SAFE";
  if (!(SAFE_HELPERS as readonly string[]).includes(path)) return "SELF_LOOP_OUTSIDE_SAFE"; // m218-guard:helper
  return null;
}

/** Why a self-test path is refused (null = admitted as the loop's team test file). */
export function selfLoopTestRefusal(path: string): SelfLoopRefuse | null {
  if (typeof path !== "string" || !path) return "SELF_LOOP_TEST";
  if (isSelfAllowForbiddenPath(path) || isSelfProtected(path)) return "SELF_LOOP_PROTECTED"; // m218-guard:test-protected
  if (!inSafeZone(path) || !/\.test\.ts$/i.test(path)) return "SELF_LOOP_TEST"; // m218-guard:test-safe
  if (!path.startsWith("peaceai/self-tests/")) return "SELF_LOOP_TEST";
  return null;
}

/** Why a repo is refused for self-loop (null = on SELF_ALLOW). */
export function selfLoopRepoRefusal(repo: string): SelfLoopRefuse | null {
  if (typeof repo !== "string" || !repo) return "SELF_LOOP_REPO";
  if (isLoopSelfTarget(repo)) return "SELF_LOOP_REPO"; // lookalikes / other peaceg03 still refused
  if (!SELF_ALLOW.has(repo.toLowerCase())) return "SELF_LOOP_REPO"; // m218-guard:allow
  return null;
}

/**
 * Build one PlanTask for the sandboxed loop from a failing self-zone self-test gap.
 * Fail closed: every path and the repo are checked before a task is returned.
 */
export function buildSelfLoopTask(gap: SelfLoopGap): SelfLoopResult {
  if (!gap || typeof gap !== "object") return { ok: false, code: "SELF_LOOP_REQUEST" };
  if (typeof gap.id !== "string" || !ID.test(gap.id)) return { ok: false, code: "SELF_LOOP_ID" };
  if (typeof gap.request !== "string" || gap.request.trim().length < 20 || gap.request.length > 2000) {
    return { ok: false, code: "SELF_LOOP_REQUEST" };
  }
  const repoRefuse = selfLoopRepoRefusal(gap.repo);
  if (repoRefuse) return { ok: false, code: repoRefuse };
  const editRefuse = selfLoopEditRefusal(gap.editPath);
  if (editRefuse) return { ok: false, code: editRefuse, detail: "edit" };
  const testRefuse = selfLoopTestRefusal(gap.testPath);
  if (testRefuse) return { ok: false, code: testRefuse, detail: "test" };
  if (typeof gap.commit !== "string" || !HEX40.test(gap.commit)) return { ok: false, code: "SELF_LOOP_PIN", detail: "commit" };
  if (typeof gap.merge !== "string" || !HEX40.test(gap.merge)) return { ok: false, code: "SELF_LOOP_PIN", detail: "merge" };
  if (typeof gap.licenseSha256 !== "string" || !HEX64.test(gap.licenseSha256)) return { ok: false, code: "SELF_LOOP_PIN", detail: "license" };
  const license = gap.license ?? "MIT";
  if (!(PLAN_LICENSES as readonly string[]).includes(license)) return { ok: false, code: "SELF_LOOP_PIN", detail: "license-id" };
  const licensePath = gap.licensePath ?? "LICENSE";
  const testCommand = gap.testCommand ?? "node --test";
  const workspaceCommit = gap.workspaceCommit ?? "0".repeat(40);

  const task: PlanTask = {
    id: gap.id,
    repo: gap.repo,
    license,
    licensePath,
    licenseSha256: gap.licenseSha256,
    commit: gap.commit,
    request: gap.request.trim(),
    tests: { command: testCommand, files: [gap.testPath] },
    reference: {
      from: { pr: 1, merge: gap.merge },
      files: [
        { path: gap.editPath, change: "modify" },
        { path: gap.testPath, change: "add" },
      ],
      steps: [
        { action: "edit-source", file: gap.editPath },
        { action: "add-test", file: gap.testPath },
        { action: "run-tests", file: null },
      ],
      docs: [],
    },
    trainingCheck: { workspaceCommit, sources: 0, inTraining: false },
  };
  const p = taskProblem(task);
  if (p) return { ok: false, code: "SELF_LOOP_PIN", detail: p };
  return { ok: true, task };
}

/** A one-task public file for runLoopFile / locking. */
export function selfLoopTaskFile(task: PlanTask, note = "M218 self-loop task (experimental)"): PlanTaskFile {
  return { schema: PLAN_TASKS_SCHEMA, set: "public", note, tasks: [task] };
}

export const selfLoopTaskFileSha = (file: PlanTaskFile): string => sha256(JSON.stringify(file) + "\n");
