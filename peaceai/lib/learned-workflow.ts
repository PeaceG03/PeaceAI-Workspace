// M19: the ADD_WORKFLOW_STEP learned rule. A spec of this kind carries the step style mined from Peace's own
// public workflow commits (peaceai/lib/mineworkflow.ts, shape WORKFLOW_STEP): a `- name:` + `run:` step appended
// at the end of an existing job's steps. The edit is fixed here and stricter than the evidence:
// - ONE step, exactly two lines: `- name: NAME` and `run: <npm|pnpm> run SCRIPT`. No `uses:` (no new actions),
//   no `env:`/`with:`/`if:`, no `${{ }}` expression anywhere in the step (so no secrets, tokens or contexts).
// - Only in a workflow the target opts in (targets.json `workflowPattern`), that already declares top-level
//   `permissions:` with read/none values only, and mentions no `secrets.`, no write permission, no `id-token`,
//   no `pull_request_target`/`workflow_run` trigger. The job must not set its own `permissions:`, `uses:`
//   (reusable workflow), `env:`, `container:` or `services:`, and must already install with the same package
//   manager. Triggers, permissions and every existing line are untouched (pure insertion; scope.ts re-checks).
// - SCRIPT must be an existing package.json script whose command is `tsc ... --noEmit` (Auditor: tsc only)
//   with plain arguments (no shell operators, variables, network, test runners, deploys).
// - Auditor (#107, change 2): the script text is exactly `tsc --noEmit` followed by plain flags (no &&, ;, |,
//   $(, backticks or redirects), and package.json must have no preSCRIPT/postSCRIPT hook for it.
// - Auditor (change 3): the candidate's diff is ONLY the two added workflow lines. No test file, and never
//   package.json, a lockfile, tsconfig* or a lint/prettier config in the same candidate (scope.ts enforces).
// - Auditor (change 4): Job B grades by running the step's script itself: exit 0 on the candidate tree, and
//   non-zero with a deliberately broken type input injected. That is necessary, not sufficient: the rule's
//   live proof also records two real Actions run ids (step passes; same step fails on the broken input);
//   see peaceai/proof/workflow-step-proof.md. Deterministic; no model; no YAML library.

export const WORKFLOW_PARAM_KEYS = ["grading", "placement", "run", "step", "test"] as const;
export const WORKFLOW_VOCAB: Record<(typeof WORKFLOW_PARAM_KEYS)[number], readonly string[]> = {
  grading: ["self-fail-before-pass-after"],
  placement: ["end-of-job"],
  run: ["package-script"],
  step: ["name-run"],
  test: ["new-file"],
};
export const WORKFLOW_FILE = /^\.github\/workflows\/[A-Za-z0-9][\w.-]*\.ya?ml$/;
export const STEP_NAME = String.raw`[A-Za-z0-9][A-Za-z0-9 ()_.,/-]{0,59}`;
const JOB = String.raw`[A-Za-z_][\w-]{0,40}`;
const SCRIPT = String.raw`[a-z][\w:-]{0,40}`;
/**
 * Header line (the rule's trigger). Backticks are optional:
 * add workflow step NAME to job JOB in .github/workflows/FILE.yml running pnpm run SCRIPT
 */
export const WORKFLOW_TRIGGER = String.raw`^add (?:a )?workflow step \x60?(?<name>${STEP_NAME}?)\x60? to job \x60?(?<job>${JOB})\x60? in \x60?(?<file>\.github/workflows/[\w.-]+\.ya?ml)\x60? running \x60?(?<pm>npm|pnpm) run (?<script>${SCRIPT})\x60?\.?$`;
/** Auditor (M19): tsc only (type-checking reads sources and writes nothing with --noEmit). */
export const SAFE_TOOLS = ["tsc"] as const;
const SAFE_ARG = /^[A-Za-z0-9][\w./:=@-]*$|^--?[a-z][\w-]*(?:=[\w./:@-]+)?$/;
const BAD_SCRIPT = /^(?:pre|post)|^(?:test|start|dev|serve|deploy|publish|release|prepare|install|scheduler|backfill)$/;
/** The two step lines (after the dash indent), as scope.ts accepts them. */
export const STEP_NAME_LINE = new RegExp(String.raw`^(\s+)- name: (${STEP_NAME})$`);
export const STEP_RUN_LINE = new RegExp(String.raw`^(\s+)run: (npm|pnpm) run (${SCRIPT})$`);

export interface WorkflowTask { name: string; job: string; file: string; pm: "npm" | "pnpm"; script: string }
export interface WorkflowEdit { path: string; content: string; extra: []; selfGrade: true }

export function parseWorkflowTask(trigger: string, objective: string): WorkflowTask | null {
  const heads = objective.split("\n").map((l) => l.trim()).filter((l) => new RegExp(trigger, "i").test(l));
  if (heads.length !== 1) return null;
  const g = new RegExp(trigger, "i").exec(heads[0]!)!.groups ?? {};
  const name = (g.name ?? "").replace(/\x60/g, "").trim();
  if (!name || !g.job || !g.file || !g.pm || !g.script || !WORKFLOW_FILE.test(g.file) || !new RegExp(`^${STEP_NAME}$`).test(name)) return null;
  return { name, job: g.job, file: g.file, pm: g.pm as "npm" | "pnpm", script: g.script };
}

const indentOf = (l: string) => /^ */.exec(l)![0].length;
const meaningful = (l: string) => l.trim() !== "" && !/^\s*#/.test(l);

/** Whole-file refusals: returns the reason, or null when the workflow may get a step. */
export function workflowRefusal(content: string): string | null {
  if (/\t/.test(content) || /\r/.test(content)) return "tabs or CR";
  if (/secrets\./i.test(content) || /\bsecrets\s*:\s*inherit/i.test(content)) return "uses secrets";
  if (/\bpull_request_target\b|\bworkflow_run\b/.test(content)) return "privileged trigger";
  if (/:\s*write\b|write-all|id-token/i.test(content)) return "write permission";
  if (/^\s*(?:<<|&|\*)|:\s*[&*!][\w]/m.test(content)) return "YAML anchors, aliases or tags";
  const lines = content.split("\n");
  const top = lines.findIndex((l) => /^permissions:\s*(?:read-all|\{\})?\s*(?:#.*)?$/.test(l));
  if (top < 0) return "no top-level permissions";
  for (let i = top + 1; i < lines.length && (!meaningful(lines[i]!) || indentOf(lines[i]!) > 0); i++) {
    const l = lines[i]!;
    if (meaningful(l) && !/^\s+[a-z-]+:\s*(?:read|none)\s*(?:#.*)?$/.test(l)) return "permission value not read/none";
  }
  return null;
}

/** Locates job `job` and the end of its steps list. Null when the layout is not the plain one. */
function locate(lines: readonly string[], job: string): { jobText: string; dash: number; insertAt: number; steps: string[][] } | null {
  const jobsAt = lines.findIndex((l) => /^jobs:\s*$/.test(l));
  if (jobsAt < 0) return null;
  const first = lines.slice(jobsAt + 1).find(meaningful);
  if (!first) return null;
  const ji = indentOf(first);
  if (ji === 0) return null;
  const starts = lines.map((l, i) => (i > jobsAt && meaningful(l) && indentOf(l) === ji ? i : -1)).filter((i) => i >= 0);
  const at = starts.filter((i) => new RegExp(`^ {${ji}}${job}:\\s*$`).test(lines[i]!));
  if (at.length !== 1) return null;
  const s = at[0]!;
  let e = lines.length;
  for (let i = s + 1; i < lines.length; i++) if (meaningful(lines[i]!) && indentOf(lines[i]!) <= ji) { e = i; break; }
  const body = lines.slice(s + 1, e);
  const keys = body.filter((l) => meaningful(l) && indentOf(l) === ji + 2).map((l) => /^\s*([\w-]+):/.exec(l)?.[1]);
  if (keys.some((k) => !k) || keys.filter((k) => k === "steps").length !== 1) return null;
  if (keys.some((k) => k === "permissions" || k === "uses" || k === "env" || k === "container" || k === "services" || k === "secrets" || k === "with")) return null;
  const st = s + 1 + body.findIndex((l) => new RegExp(`^ {${ji + 2}}steps:\\s*$`).test(l));
  // The steps list runs from st+1 to the next line at <= ji+2 indent (or the job end).
  let se = e;
  for (let i = st + 1; i < e; i++) if (meaningful(lines[i]!) && indentOf(lines[i]!) <= ji + 2) { se = i; break; }
  const items = lines.slice(st + 1, se).filter(meaningful);
  if (items.length === 0 || !/^\s*- /.test(items[0]!)) return null;
  const dash = indentOf(items[0]!);
  if (dash < ji + 2) return null;
  const steps: string[][] = [];
  for (const l of items) {
    if (indentOf(l) === dash && /^\s*- /.test(l)) steps.push([l]);
    else if (indentOf(l) > dash) steps[steps.length - 1]!.push(l);
    else return null;
  }
  let last = se - 1;
  while (last > st && !meaningful(lines[last]!)) last--;
  return { jobText: lines.slice(s, e).join("\n"), dash, insertAt: last + 1, steps };
}

/** The script command, if it is one safe tool with plain arguments. */
export function safeScript(cmd: unknown): string[] | null {
  if (typeof cmd !== "string" || cmd.length > 200) return null;
  // Auditor (change 2): no shell operators at all, and the text is exactly `tsc --noEmit` + plain flags.
  if (/[&;|`<>$\\\n\r\t"'*?(){}\[\]!#~]/.test(cmd) || cmd !== cmd.trim() || / {2}/.test(cmd)) return null;
  const words = cmd.split(" ");
  if (words[0] !== "tsc" || words[1] !== "--noEmit") return null;
  if (!(SAFE_TOOLS as readonly string[]).includes(words[0]!)) return null;
  if (!words.slice(1).every((w) => SAFE_ARG.test(w) && !w.includes("..") && !/^\//.test(w))) return null;
  // tsc must not emit or build: --noEmit required; no --build/-b, --watch/-w, --outDir/--outFile/--declarationDir, --plugins.
  if (!words.includes("--noEmit") || words.some((w) => /^(?:-b|--build|-w|--watch|--outDir|--outFile|--declarationDir|--generateTrace|--plugins)(?:=|$)/.test(w))) return null;
  if (/(^|[\s/])(secret|token|credential|wrangler|production|deploy)/i.test(cmd)) return null;
  return words;
}

export function buildWorkflowEdit(params: Record<string, string | string[]>, task: WorkflowTask, files: readonly { path: string; content: string }[], _isTest?: (p: string) => boolean): WorkflowEdit | null {
  if (WORKFLOW_PARAM_KEYS.some((k) => params[k] !== WORKFLOW_VOCAB[k][0])) return null;
  const wf = files.find((f) => f.path === task.file);
  const pkg = files.find((f) => f.path === "package.json");
  if (!wf || !pkg || workflowRefusal(wf.content)) return null;
  const lock = task.pm === "pnpm" ? "pnpm-lock.yaml" : "package-lock.json";
  if (!files.some((f) => f.path === lock)) return null;
  let scripts: Record<string, unknown>;
  try { scripts = (JSON.parse(pkg.content) as { scripts?: Record<string, unknown> }).scripts ?? {}; } catch { return null; }
  const words = workflowScript(scripts, task.script);
  if (!words) return null;
  const lines = wf.content.split("\n");
  const loc = locate(lines, task.job);
  if (!loc) return null;
  // The job must already install with this package manager, and must not already have this step.
  if (!new RegExp(`^\\s*(?:- )?run: ${task.pm} (?:install|ci)\\b`, "m").test(loc.jobText)) return null;
  const run = `${task.pm} run ${task.script}`;
  for (const st of loc.steps) {
    const t = st.join("\n");
    if (new RegExp(`(?:- |\\s)name: ${task.name.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}\\s*$`, "m").test(t) || new RegExp(`run: ${run}\\s*$`, "m").test(t)) return null;
  }
  const pad = " ".repeat(loc.dash);
  const step = [`${pad}- name: ${task.name}`, `${pad}  run: ${run}`];
  const content = [...lines.slice(0, loc.insertAt), ...step, ...lines.slice(loc.insertAt)].join("\n");
  return { path: task.file, content, extra: [], selfGrade: true };
}

export function applyWorkflowRule(trigger: string, params: Record<string, string | string[]>, objective: string, files: readonly { path: string; content: string }[], isTest?: (p: string) => boolean): WorkflowEdit | null {
  const task = parseWorkflowTask(trigger, objective);
  return task ? buildWorkflowEdit(params, task, files, isTest) : null;
}

/** Where the new test goes (one fixed file per workflow/job/script). */
export function buildTestPath(t: { file: string; job: string; script: string }): string {
  const slug = (x: string) => x.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `src/workflow-${slug(t.file.replace(/^\.github\/workflows\//, "").replace(/\.ya?ml$/, ""))}-${slug(t.job)}-${slug(t.script)}.test.ts`;
}

/** Auditor (change 2): the script's words when it is safe to run, else null. Also refuses pre/post hooks. */
export function workflowScript(scripts: Record<string, unknown>, name: string): string[] | null {
  const has = (k: string) => Object.prototype.hasOwnProperty.call(scripts, k);
  if (BAD_SCRIPT.test(name) || !has(name)) return null;
  if (has(`pre${name}`) || has(`post${name}`)) return null;
  return safeScript(scripts[name]);
}

/** Auditor (change 3): paths a workflow-step candidate may never touch alongside the step. */
export const WORKFLOW_STEP_FORBIDDEN = /(?:^|\/)(?:package\.json|package-lock\.json|npm-shrinkwrap\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml|yarn\.lock|bun\.lockb?|\.npmrc|tsconfig[^/]*|jsconfig[^/]*|\.eslintrc[^/]*|eslint\.config\.[^/]+|\.eslintignore|\.prettierrc[^/]*|prettier\.config\.[^/]+|\.prettierignore|biome\.jsonc?|\.editorconfig)$/;

/** Auditor (change 3): a candidate that touches a workflow is exactly one workflow file (the 2 added lines). */
export function workflowCandidateReason(paths: readonly string[], isWorkflow: (p: string) => boolean): string | null {
  const wf = paths.filter(isWorkflow);
  if (wf.length === 0) return null;
  const bad = paths.find((p) => WORKFLOW_STEP_FORBIDDEN.test(p));
  if (bad) return `workflow-step candidate may not change ${bad}`;
  if (paths.length !== 1) return "workflow-step candidate must be only the two added workflow lines";
  return null;
}

/** Auditor (change 4): the broken type input Job B injects to prove the step can fail. */
export const BROKEN_TYPE_LINE = "\nexport const __peaceaiBrokenTypeInput: number = \"not a number\";\n";

/** Auditor (change 5): PeaceAI's own push path never carries .github/workflows/** (normal Architect-merged PR only). */
export function pushPathRefusal(paths: readonly string[]): string | null {
  const bad = paths.find((p) => /^\.github\/workflows(?:\/|$)/.test(p.replace(/^\.\//, "")));
  return bad ? `refused: ${bad} goes in only through a normal PR that Architect merges` : null;
}
