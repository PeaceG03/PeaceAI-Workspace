// M67 WORKFLOW_JOB (public-workflow-job-v1, un-drop batch). Adds ONE new job at the end of an existing, opted-in
// workflow (targets.json `workflowPattern`). The job is fixed text built here, never copied from the task:
//   NAME:
//     runs-on: ubuntu-24.04
//     timeout-minutes: 10
//     permissions:
//       contents: read
//     steps:
//       <the setup steps of an existing job in the same file, copied only when every one is allowed>
//       - name: STEP
//         run: <npm|pnpm> run SCRIPT
// Allowed setup steps: `uses:` actions/checkout, pnpm/action-setup or actions/setup-node (with: only version,
// node-version, cache) and `run: <pm> install|ci [--frozen-lockfile]`. SCRIPT is an existing package.json script whose
// command is a read-only `tsc ... --noEmit` (safeScript) or `tsx --test <plain paths>`.
// Refused (short codes): secrets anywhere in the file, any write permission, pull_request_target / workflow_run
// triggers, no top-level read/none permissions, `${{ }}` in the copied steps, an existing job name, an unsafe script.
// The candidate diff is only added lines at the end of the file; scope.ts re-checks it (workflowJobReason).
// Like WORKFLOW_STEP, PeaceAI's own push path never carries .github/workflows/** (pushPathRefusal): a landed
// WORKFLOW_JOB candidate goes in through a normal PR that Architect merges. Deterministic; no YAML library.
import { safeScript, WORKFLOW_FILE } from "./learned-workflow.ts";

export const WORKFLOW_JOB_FLAG = "PEACEAI_WORKFLOW_JOB";
export const workflowJobEnabled = (env: Record<string, string | undefined>): boolean => env[WORKFLOW_JOB_FLAG] === "true";
export const WORKFLOW_JOB_PARAM_KEYS = ["grading", "job", "permissions", "placement"] as const;
export const WORKFLOW_JOB_VOCAB: Record<(typeof WORKFLOW_JOB_PARAM_KEYS)[number], readonly string[]> = {
  grading: ["target-suite"],
  job: ["copied-setup-plus-script"],
  permissions: ["contents-read"],
  placement: ["end-of-file"],
};
const JOB = String.raw`[a-z][a-z0-9_-]{0,40}`;
const STEP = String.raw`[A-Za-z0-9][A-Za-z0-9 ()_.,/-]{0,59}`;
const SCRIPT = String.raw`[a-z][\w:-]{0,40}`;
/** add workflow job JOB to .github/workflows/FILE.yml running pnpm run SCRIPT (as step STEP) */
export const WORKFLOW_JOB_TRIGGER = String.raw`^add (?:a )?workflow job \x60?(?<job>${JOB})\x60? to \x60?(?<file>\.github/workflows/[\w.-]+\.ya?ml)\x60? running \x60?(?<pm>npm|pnpm) run (?<script>${SCRIPT})\x60?(?: as step \x60?(?<step>${STEP})\x60?)?\.?$`;
export interface WorkflowJobTask { job: string; file: string; pm: "npm" | "pnpm"; script: string; step: string }

export function parseWorkflowJobTask(trigger: string, objective: string): WorkflowJobTask | null {
  const re = new RegExp(trigger, "i");
  const heads = objective.split("\n").map((l) => l.trim()).filter((l) => re.test(l));
  if (heads.length !== 1) return null;
  const g = re.exec(heads[0]!)!.groups ?? {};
  if (!g.job || !g.file || !g.pm || !g.script || !WORKFLOW_FILE.test(g.file)) return null;
  return { job: g.job, file: g.file, pm: g.pm as "npm" | "pnpm", script: g.script, step: (g.step ?? g.script.replace(/:/g, " ")).trim() };
}

const indentOf = (l: string) => /^ */.exec(l)![0].length;
const meaningful = (l: string) => l.trim() !== "" && !/^\s*#/.test(l);

/** Whole-file refusal with a short code, or null. */
export function workflowJobFileProblem(content: string): string | null {
  if (/\t|\r/.test(content)) return "workflow_job_layout";
  if (/secrets\./i.test(content) || /\bsecrets\s*:/i.test(content)) return "workflow_job_secrets";
  if (/\bpull_request_target\b|\bworkflow_run\b/.test(content)) return "workflow_job_privileged_trigger";
  if (/:\s*write\b|write-all|id-token/i.test(content)) return "workflow_job_write_permission";
  if (/^\s*(?:<<|&|\*)|:\s*[&*!][\w]/m.test(content)) return "workflow_job_layout";
  const lines = content.split("\n");
  const top = lines.findIndex((l) => /^permissions:\s*(?:read-all|\{\})?\s*(?:#.*)?$/.test(l));
  if (top < 0) return "workflow_job_no_read_permissions";
  for (let i = top + 1; i < lines.length && (!meaningful(lines[i]!) || indentOf(lines[i]!) > 0); i++)
    if (meaningful(lines[i]!) && !/^\s+[a-z-]+:\s*(?:read|none)\s*(?:#.*)?$/.test(lines[i]!)) return "workflow_job_no_read_permissions";
  return null;
}

const SETUP_USES = /^(?:actions\/checkout|pnpm\/action-setup|actions\/setup-node)@[\w.-]{1,64}$/;
/** One setup step's lines (dash line first), checked; null when it is not an allowed setup step. */
function allowedSetupStep(step: readonly string[], pm: string): boolean {
  const text = step.join("\n");
  if (/\$\{\{|secret|token/i.test(text)) return false;
  const dash = indentOf(step[0]!);
  const body = step.map((l, i) => (i === 0 ? l.slice(dash + 2) : l.slice(dash + 2)));
  const uses = /^uses: (\S+)(?: # [\w. -]{1,30})?$/.exec(body[0]!.trim());
  if (uses) {
    if (!SETUP_USES.test(uses[1]!)) return false;
    const rest = body.slice(1);
    if (rest.length === 0) return true;
    if (rest[0]!.trim() !== "with:") return false;
    return rest.slice(1).every((l) => /^\s+(?:(?:version|node-version|cache): [\w.-]{1,20}|persist-credentials: false)$/.test(l));
  }
  return body.length === 1 && new RegExp(`^run: ${pm} (?:install|ci|i)(?: --frozen-lockfile)?$`).test(body[0]!.trim());
}

/** Jobs (name -> lines) under `jobs:` at a uniform indent; null for any other layout. */
function jobsOf(lines: readonly string[]): { ji: number; jobs: Map<string, string[]> } | null {
  const at = lines.findIndex((l) => /^jobs:\s*$/.test(l));
  if (at < 0 || lines.slice(at + 1).some((l) => meaningful(l) && indentOf(l) === 0)) return null;
  const first = lines.slice(at + 1).find(meaningful);
  if (!first) return null;
  const ji = indentOf(first);
  const jobs = new Map<string, string[]>();
  let cur: string[] | null = null;
  for (const l of lines.slice(at + 1)) {
    if (meaningful(l) && indentOf(l) === ji) {
      const m = /^ *([\w-]+):\s*$/.exec(l);
      if (!m) return null;
      cur = [];
      jobs.set(m[1]!, cur);
    } else if (cur && meaningful(l)) cur.push(l);
  }
  return { ji, jobs };
}

/** The setup steps (before the first non-setup step) of the first job that installs with pm, all allowed. */
function setupSteps(job: readonly string[], ji: number, pm: string): string[][] | null {
  const st = job.findIndex((l) => indentOf(l) === ji + 2 && /^\s*steps:\s*$/.test(l));
  if (st < 0) return null;
  const items = job.slice(st + 1).filter((l) => indentOf(l) > ji + 2);
  if (!items.length || !/^\s*- /.test(items[0]!)) return null;
  const dash = indentOf(items[0]!);
  const steps: string[][] = [];
  for (const l of items) {
    if (indentOf(l) === dash && /^\s*- /.test(l)) steps.push([l]);
    else if (indentOf(l) > dash && steps.length) steps[steps.length - 1]!.push(l);
    else return null;
  }
  const out: string[][] = [];
  for (const s of steps) {
    if (!allowedSetupStep(s, pm)) break;
    out.push(s.map((l) => l.slice(dash)));
    if (new RegExp(`run: ${pm} (?:install|ci|i)\\b`).test(s.join("\n"))) return out;
  }
  return null;
}

/** Script command allowed in the new job: read-only tsc, or `tsx --test` over plain paths. */
export function jobScriptOk(cmd: unknown): boolean {
  if (typeof cmd !== "string") return false;
  if (safeScript(cmd)) return true;
  return /^tsx --test(?: [A-Za-z0-9_./*-]{1,120}){1,8}$/.test(cmd) && !/\.\.|(^|\s)\//.test(cmd);
}

export function buildWorkflowJob(task: WorkflowJobTask, files: readonly { path: string; content: string }[], why?: { reason?: string }): { path: string; content: string } | null {
  const no = (r: string) => { if (why) why.reason = r; return null; };
  const wf = files.find((f) => f.path === task.file);
  if (!wf) return no("target_missing");
  const fileProblem = workflowJobFileProblem(wf.content);
  if (fileProblem) return no(fileProblem);
  const pkg = files.find((f) => f.path === "package.json");
  if (!pkg) return no("workflow_job_script_unsafe");
  let scripts: Record<string, unknown>;
  try { scripts = (JSON.parse(pkg.content) as { scripts?: Record<string, unknown> }).scripts ?? {}; } catch { return no("workflow_job_script_unsafe"); }
  const has = (k: string) => Object.prototype.hasOwnProperty.call(scripts, k);
  if (!has(task.script) || has(`pre${task.script}`) || has(`post${task.script}`) || !jobScriptOk(scripts[task.script])) return no("workflow_job_script_unsafe");
  const lines = wf.content.replace(/\n+$/, "").split("\n");
  const parsed = jobsOf(lines);
  if (!parsed) return no("workflow_job_layout");
  if (parsed.jobs.has(task.job)) return no("workflow_job_exists");
  let setup: string[][] | null = null;
  for (const job of parsed.jobs.values()) { setup = setupSteps(job, parsed.ji, task.pm); if (setup) break; }
  if (!setup) return no("workflow_job_no_setup");
  const p = " ".repeat(parsed.ji);
  const s = p + "    ";
  const block = [
    `${p}${task.job}:`,
    `${p}  runs-on: ubuntu-24.04`,
    `${p}  timeout-minutes: 10`,
    `${p}  permissions:`,
    `${p}    contents: read`,
    `${p}  steps:`,
    ...setup.flat().map((l) => s + l),
    `${s}- name: ${task.step}`,
    `${s}  run: ${task.pm} run ${task.script}`,
  ];
  return { path: task.file, content: [...lines, ...block].join("\n") + "\n" };
}

/** scope.ts: the added lines of a WORKFLOW_JOB candidate (one new job block; nothing removed). Null when allowed. */
export function workflowJobLinesReason(added: readonly string[]): string | null {
  if (added.length < 8) return "not a job block";
  const head = /^( +)([a-z][a-z0-9_-]{0,40}):$/.exec(added[0]!);
  if (!head) return "not a job block";
  const p = head[1]!;
  const fixed = [`${p}  runs-on: ubuntu-24.04`, `${p}  timeout-minutes: 10`, `${p}  permissions:`, `${p}    contents: read`, `${p}  steps:`];
  if (fixed.some((l, i) => added[i + 1] !== l)) return "job header is not the fixed read-only header";
  const text = added.join("\n");
  if (/\$\{\{|secrets|token|write|pull_request_target|workflow_run|environment:|container:|services:/i.test(text)) return "expression, secret or privilege";
  const rest = added.slice(6);
  if (rest.some((l) => !l.startsWith(`${p}    `))) return "line outside the job";
  // Auditor (#266 NOT PASS): accept only what buildWorkflowJob emits. Every step before the final name/run is an allowed
  // setup step (allowlisted uses: with only version/node-version/cache/persist-credentials:false, or `run: <pm> install`),
  // the install step comes last, and the final step is exactly `- name:` + `run: <pm> run <script>`.
  const last2 = rest.slice(-2);
  const fin = /^ +run: (npm|pnpm) run [a-z][\w:-]{0,40}$/.exec(last2[1] ?? "");
  if (last2[0] !== undefined && !last2[0].startsWith(`${p}    - name: `)) return "last step is not a name/run package-script step";
  if (!/^ +- name: [A-Za-z0-9][A-Za-z0-9 ()_.,/-]{0,59}$/.test(last2[0] ?? "") || !fin || !last2[1]!.startsWith(`${p}      run: `)) return "last step is not a name/run package-script step";
  const pm = fin[1]!;
  const dash = `${p}    - `;
  const steps: string[][] = [];
  for (const l of rest.slice(0, -2)) {
    if (l.startsWith(dash)) steps.push([l]);
    else if (steps.length && l.startsWith(`${p}      `)) steps[steps.length - 1]!.push(l);
    else return "step outside the setup grammar";
  }
  if (!steps.length) return "no setup steps";
  const install = new RegExp(`^ +- run: ${pm} (?:install|ci|i)(?: --frozen-lockfile)?$`);
  for (const [i, st] of steps.entries()) {
    if (!allowedSetupStep(st, pm)) return "setup step outside the allowlist";
    if (install.test(st[0]!) !== (i === steps.length - 1)) return "install step is not the last setup step";
  }
  return null;
}

const validParams = (params: Record<string, string | string[]>) => WORKFLOW_JOB_PARAM_KEYS.every((k) => typeof params[k] === "string" && WORKFLOW_JOB_VOCAB[k].includes(params[k] as string));
/** Job A entry: admitted only via the hash-pinned approved list. */
export function runWorkflowJobRule(trigger: string, params: Record<string, string | string[]>, objective: string, files: readonly { path: string; content: string }[], why?: { reason?: string }): { path: string; content: string } | null {
  if (!validParams(params)) { if (why) why.reason = "bad_rule_params"; return null; }
  const task = parseWorkflowJobTask(trigger, objective);
  if (!task) { if (why) why.reason = "task_unparsed"; return null; }
  return buildWorkflowJob(task, files, why);
}
/** Dev path: OFF unless PEACEAI_WORKFLOW_JOB is exactly "true". */
export function applyWorkflowJobRule(trigger: string, params: Record<string, string | string[]>, objective: string, files: readonly { path: string; content: string }[], env: Record<string, string | undefined> = process.env, why?: { reason?: string }): { path: string; content: string } | null {
  return workflowJobEnabled(env) ? runWorkflowJobRule(trigger, params, objective, files, why) : null;
}
