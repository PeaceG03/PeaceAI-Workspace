// M5 target repositories. A task names its target with a `target:<owner>/<repo>` label or a
// `Target: <owner>/<repo>` line in the body; the default is this Workspace. Every run checks the
// target's visibility through the GitHub API. Anything other than a confirmed PUBLIC repository is
// treated as PRIVATE and fails closed: its content is never fetched into a public run. Only targets
// with a scope config in peaceai/targets.json run at all.
import { WORKFLOW_FILE } from "./learned-workflow.ts";
import { readFileSync } from "node:fs";
import { join } from "node:path";

export interface TargetConfig {
  /** Paths a candidate may create or edit (non-test sources and new tests). */
  sourcePattern: string;
  /** Test files: existing ones are frozen; new ones may be added. */
  testPattern: string;
  /** Paths never touched even when they match sourcePattern (secrets, production config, helpers). */
  denyPatterns: string[];
  install: "npm" | "pnpm";
  /** "full": the whole existing suite must pass. "related": existing tests related to the touched files,
   * run on the base and on the candidate; a candidate fails if any of them regresses. */
  originalSuite: "full" | "related";
  /** GitHub environment holding TARGET_PR_TOKEN for PRs on this target; null = this repository. */
  writeEnvironment: string | null;
  /** M6: what a `right` verdict does. "pr": open a PR (needs write access). "patch": post the chosen
   * candidate as a `git format-patch` file on the Workspace issue; the owner applies it (no token). */
  verdictRoute?: "pr" | "patch";
  /** M19: workflow files ADD_WORKFLOW_STEP may append a step to (must also match .github/workflows/*.yml). */
  workflowPattern?: string;
  /** M67: TSCONFIG_SCRIPT candidates (package.json + one new root tsconfig.NAME.json) allowed on this target. */
  tsconfigScript?: boolean;
}

export interface TargetsFile {
  schema: "peaceai-targets:v1";
  default: string;
  targets: Record<string, TargetConfig>;
}

const REPO = /^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}$/;
export const isRepoName = (name: string): boolean => REPO.test(name) && !name.split("/")[1]!.startsWith(".");

export function loadTargets(path = join(import.meta.dirname, "..", "targets.json")): TargetsFile {
  const file = JSON.parse(readFileSync(path, "utf8")) as TargetsFile;
  if (file.schema !== "peaceai-targets:v1" || !isRepoName(file.default) || !file.targets[file.default])
    throw new Error("invalid targets file");
  for (const [name, c] of Object.entries(file.targets)) {
    if (!isRepoName(name)) throw new Error("invalid target name");
    for (const p of [c.sourcePattern, c.testPattern, ...c.denyPatterns]) new RegExp(p); // must compile
    if (!["npm", "pnpm"].includes(c.install) || !["full", "related"].includes(c.originalSuite)) throw new Error("invalid target config");
    if (c.writeEnvironment !== null && !/^[a-z0-9-]{1,60}$/.test(c.writeEnvironment)) throw new Error("invalid write environment");
    if (c.verdictRoute !== undefined && !["pr", "patch"].includes(c.verdictRoute)) throw new Error("invalid verdict route");
    // M19: opt-in only, anchored under .github/workflows/, and never for this Workspace (its workflows are protected).
    if (c.workflowPattern !== undefined && (typeof c.workflowPattern !== "string" || !c.workflowPattern.startsWith("^\\.github/workflows/") || !c.workflowPattern.endsWith("$") || name === "PeaceG03/PeaceAI-Workspace")) throw new Error("invalid workflow pattern");
    if (c.workflowPattern !== undefined) new RegExp(c.workflowPattern);
    if (c.tsconfigScript !== undefined && (c.tsconfigScript !== true || name === "PeaceG03/PeaceAI-Workspace")) throw new Error("invalid tsconfigScript");
  }
  return file;
}

export type Resolution = { ok: true; target: string } | { ok: false; reason: "conflicting-targets" | "invalid-target" };

/** Target from labels (`target:<owner>/<repo>`) and/or a body line (`Target: <owner>/<repo>`). */
export function resolveTarget(labels: readonly string[], body: string, fallback: string): Resolution {
  const named = new Set<string>();
  for (const l of labels) if (/^target:/i.test(l)) named.add(l.slice(7).trim());
  for (const m of body.matchAll(/^[ \t]*target:[ \t]*(\S+)[ \t]*$/gim)) named.add(m[1]!.trim());
  if (named.size === 0) return { ok: true, target: fallback };
  if (named.size > 1) {
    const lower = new Set([...named].map((n) => n.toLowerCase()));
    if (lower.size > 1) return { ok: false, reason: "conflicting-targets" };
  }
  const name = [...named][0]!;
  return isRepoName(name) ? { ok: true, target: name } : { ok: false, reason: "invalid-target" };
}

/**
 * Visibility from a `GET /repos/{owner}/{repo}` response. Public only when the API says so on every field
 * and names the same repository; a missing, failed, mismatched or forced-failed check means private.
 */
export function visibilityOf(target: string, api: unknown, forceFail = false): "public" | "private" {
  if (forceFail || !api || typeof api !== "object") return "private";
  const r = api as Record<string, unknown>;
  const same = typeof r.full_name === "string" && r.full_name.toLowerCase() === target.toLowerCase();
  return same && r.private === false && r.visibility === "public" ? "public" : "private";
}

export type Decision =
  | { run: true; target: string; config: TargetConfig; isDefault: boolean }
  | { run: false; reason: "conflicting-targets" | "invalid-target" | "not-public" | "not-configured" };

export function decide(resolution: Resolution, visibility: "public" | "private" | null, targets: TargetsFile): Decision {
  if (!resolution.ok) return { run: false, reason: resolution.reason };
  if (visibility !== "public") return { run: false, reason: "not-public" };
  const key = Object.keys(targets.targets).find((k) => k.toLowerCase() === resolution.target.toLowerCase());
  if (!key) return { run: false, reason: "not-configured" };
  return { run: true, target: key, config: targets.targets[key]!, isDefault: key === targets.default };
}

/** Generic, content-free messages for the issue. They never name files or echo target content. */
export const DECISION_MESSAGE: Record<Exclude<Decision, { run: true }>["reason"], string> = {
  "conflicting-targets": "PeaceAI: this task names more than one target. Keep one `target:` label or body line, then remove `peaceai:failed` to retry.",
  "invalid-target": "PeaceAI: the task's target is not a valid `owner/repo` name. Fix it, then remove `peaceai:failed` to retry.",
  "not-public":
    "PeaceAI: this task's target is not confirmed public, so nothing was fetched or run. Private targets do not run in this public repository; a private flow is not set up yet.",
  "not-configured": "PeaceAI: this task's target has no scope config in `peaceai/targets.json`, so nothing was run.",
};

/** Per-target scope helpers. */
export function scopeOf(config: TargetConfig) {
  const source = new RegExp(config.sourcePattern);
  const test = new RegExp(config.testPattern);
  const deny = config.denyPatterns.map((p) => new RegExp(p, "i"));
  const workflow = typeof config.workflowPattern === "string" ? new RegExp(config.workflowPattern) : null;
  return {
    isSource: (path: string) => source.test(path) && !path.split("/").some((p) => p === "" || p.startsWith(".")),
    isTest: (path: string) => test.test(path),
    isDenied: (path: string) => deny.some((d) => d.test(path)),
    isWorkflow: (path: string) => !!workflow && workflow.test(path) && WORKFLOW_FILE.test(path),
    tsconfigScript: config.tsconfigScript === true,
  };
}
