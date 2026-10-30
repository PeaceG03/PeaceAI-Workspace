// PLAN-ONLY mode v1 (Peace, 2026-10-30): PeaceAI reads a plain-language coding task and a repository he has never
// seen, and writes a plan: the files that matter, the steps, what each step changes, and how to test it. Each step is
// marked `can-do` (an approved learned rule, named by id, would make that edit today) or `missing` (the capability he
// lacks, from a fixed vocabulary). Plan-only never writes to the target checkout; the runner proves it unchanged.
//
// Understanding is PeaceAI's own code only, built from the parts Job A already uses: the M10 clause splitter and
// naive Bayes intent model (nlparse.ts, peaceai/nl/model.json), the M6 symbol and keyword index (symbols.ts:
// resolveTargets, relatedFiles, search), and the hash-pinned approved rules (approved.ts admitRules, learned.ts
// applyRule). No outside model, no network, no training. Crude on purpose: the scores are meant to show the gaps.
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, posix } from "node:path";
import { classify, clauses, loadModel, parseTask, type NbModel } from "./nlparse.ts";
import { buildIndex, relatedFiles, resolveTargets, search, type IndexFile, type RepoIndex } from "./symbols.ts";
import { admitRules, loadApprovedList } from "./approved.ts";
import { applyRule, specHash, type RuleSpec } from "./learned.ts";
import { loadTargets } from "./target.ts";

export const PLAN_TASKS_SCHEMA = "peaceai-plan-tasks:v1" as const;
export const PLAN_SCHEMA = "peaceai-plan:v1" as const;
export const PLANNER_VERSION = "plan-only-v1" as const;
/** Licenses a task repo may carry (the training rule's list, as SPDX ids). */
export const PLAN_LICENSES = ["MIT", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "ISC"] as const;
export const STEP_ACTIONS = ["edit-source", "add-source", "edit-test", "add-test", "run-tests"] as const;
export type StepAction = (typeof STEP_ACTIONS)[number];
/** What a `missing` step names. Fixed vocabulary, so a plan or a log row never carries free text. */
export const CAPABILITIES = [
  "understand-request", // no clause of the request could be turned into an edit objective
  "locate-code", // no source file could be tied to the request
  "edit-existing-function", // change behaviour inside an existing function or method from a plain description
  "add-function-or-member", // add a new function, method, event or export to existing code
  "edit-constant", // change an existing constant or pattern (e.g. a regular expression)
  "extend-existing-test", // add cases to an existing test file for the described behaviour
  "add-test-file", // write a new test file for the described behaviour
  "run-target-tests", // install and run this repository's own test command (Job B runs only targets.json repos)
] as const;
export type Capability = (typeof CAPABILITIES)[number];

const HEX40 = /^[0-9a-f]{40}$/;
const HEX64 = /^[0-9a-f]{64}$/;
const REPO = /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/;
const REL_PATH = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[\w@+.\/-]{1,300}$/;

export interface RefStep { action: StepAction; file: string | null; symbols?: string[] }
export interface PlanTask {
  id: string;
  repo: string;
  license: (typeof PLAN_LICENSES)[number];
  licensePath: string;
  licenseSha256: string;
  /** The pinned pre-change commit the plan is made against. */
  commit: string;
  /** The plain-language request, as a person would file it. */
  request: string;
  /** The tests that prove the task done: the repo's test command and the test files the reference change touched. */
  tests: { command: string; files: string[] };
  /** The real change that resolved the task (for grading the plan): files, steps and where it came from. */
  reference: { from: { pr: number; merge: string }; files: { path: string; change: "modify" | "add" }[]; steps: RefStep[]; docs: string[] };
  /** Recorded check that the repo is not in PeaceAI's training data (see trainingRepos). */
  trainingCheck: { workspaceCommit: string; sources: number; inTraining: false };
}
export interface PlanTaskFile { schema: typeof PLAN_TASKS_SCHEMA; set: "public" | "hidden"; note?: string; tasks: PlanTask[] }

/** Validates a task file. Returns the problem as a fixed code (never task text), or null. */
export function taskFileProblem(o: unknown): string | null {
  if (!o || typeof o !== "object") return "not_object";
  const f = o as Record<string, unknown>;
  if (f.schema !== PLAN_TASKS_SCHEMA) return "schema";
  if (f.set !== "public" && f.set !== "hidden") return "set";
  if (!Array.isArray(f.tasks) || f.tasks.length === 0 || f.tasks.length > 200) return "tasks";
  if (Object.keys(f).some((k) => !["schema", "set", "note", "tasks"].includes(k))) return "keys";
  const ids = new Set<string>();
  for (const t of f.tasks) {
    const p = taskProblem(t);
    if (p) return p;
    const id = (t as PlanTask).id;
    if (ids.has(id)) return "duplicate_id";
    ids.add(id);
  }
  return null;
}

export function taskProblem(o: unknown): string | null {
  if (!o || typeof o !== "object") return "task_not_object";
  const t = o as Record<string, any>;
  const keys = ["id", "repo", "license", "licensePath", "licenseSha256", "commit", "request", "tests", "reference", "trainingCheck"];
  if (Object.keys(t).sort().join(",") !== [...keys].sort().join(",")) return "task_keys";
  if (typeof t.id !== "string" || !/^[a-z0-9][a-z0-9-]{0,40}$/.test(t.id)) return "task_id";
  if (typeof t.repo !== "string" || !REPO.test(t.repo)) return "task_repo";
  if (!(PLAN_LICENSES as readonly string[]).includes(t.license)) return "task_license";
  if (typeof t.licensePath !== "string" || !REL_PATH.test(t.licensePath) || typeof t.licenseSha256 !== "string" || !HEX64.test(t.licenseSha256)) return "task_license_pin";
  if (typeof t.commit !== "string" || !HEX40.test(t.commit)) return "task_commit";
  if (typeof t.request !== "string" || t.request.trim().length < 20 || t.request.length > 2000) return "task_request";
  const tests = t.tests;
  if (!tests || typeof tests.command !== "string" || !tests.command || !Array.isArray(tests.files) || tests.files.length === 0 || !tests.files.every((p: unknown) => typeof p === "string" && REL_PATH.test(p))) return "task_tests";
  const r = t.reference;
  if (!r || !r.from || !Number.isInteger(r.from.pr) || typeof r.from.merge !== "string" || !HEX40.test(r.from.merge)) return "task_reference_from";
  if (!Array.isArray(r.files) || r.files.length === 0 || !r.files.every((x: any) => x && REL_PATH.test(x.path) && (x.change === "modify" || x.change === "add"))) return "task_reference_files";
  if (!Array.isArray(r.docs) || !r.docs.every((p: unknown) => typeof p === "string" && REL_PATH.test(p))) return "task_reference_docs";
  if (!Array.isArray(r.steps) || r.steps.length === 0) return "task_reference_steps";
  const refPaths = new Set(r.files.map((x: any) => x.path));
  for (const s of r.steps) {
    if (!s || !(STEP_ACTIONS as readonly string[]).includes(s.action)) return "task_step_action";
    if (s.action === "run-tests" ? s.file !== null : !refPaths.has(s.file)) return "task_step_file";
    if (s.symbols !== undefined && !(Array.isArray(s.symbols) && s.symbols.every((x: unknown) => typeof x === "string"))) return "task_step_symbols";
  }
  if (!r.steps.some((s: RefStep) => s.action === "run-tests")) return "task_step_run_tests";
  if (!tests.files.every((p: string) => refPaths.has(p))) return "task_tests_not_in_reference";
  const c = t.trainingCheck;
  if (!c || typeof c.workspaceCommit !== "string" || !HEX40.test(c.workspaceCommit) || !Number.isInteger(c.sources) || c.inTraining !== false) return "task_training_check";
  return null;
}

export const sha256 = (text: string | Buffer): string => createHash("sha256").update(text).digest("hex");

// ---- the training-data check (Auditor's condition, 2026-10-30): no task repo may be in PeaceAI's training data

const ROOT = join(import.meta.dirname, "../..");
const REPO_KEYS = new Set(["name", "repo", "repos"]);
function collectRepos(o: unknown, out: Set<string>): void {
  if (Array.isArray(o)) { for (const x of o) collectRepos(x, out); return; }
  if (!o || typeof o !== "object") return;
  for (const [k, v] of Object.entries(o)) {
    if (REPO_KEYS.has(k)) for (const x of Array.isArray(v) ? v : [v]) if (typeof x === "string" && REPO.test(x)) out.add(x.toLowerCase());
    collectRepos(v, out);
  }
}
const jsonFiles = (dir: string, ext: RegExp): string[] => (existsSync(dir) ? readdirSync(dir).filter((f) => ext.test(f)).sort().map((f) => join(dir, f)) : []);
/**
 * Every repository identifier PeaceAI learned from, lower-cased: each `name` / `repo` / `repos` value in the LM
 * corpus and training lists (peaceai/model/*.json, the pretraining manifest parts), and the repositories named as
 * evidence by every learned rule and rule proposal (peaceai/rules). Read from the existing lists, never copied, so a
 * future retrain source or rule that names a task repo makes that task refused (and m142 fails for a public task).
 * Over-inclusive on purpose: a repository that was only refused or held out also counts.
 */
export function trainingRepos(root = ROOT): { repos: Set<string>; sources: number } {
  const files = [
    ...jsonFiles(join(root, "peaceai/model"), /\.json$/),
    ...jsonFiles(join(root, "peaceai/model/ext-manifest"), /\.jsonl?$/),
    ...jsonFiles(join(root, "peaceai/rules/learned"), /\.json$/),
    ...jsonFiles(join(root, "peaceai/rules/proposals"), /\.json$/),
    ...jsonFiles(join(root, "peaceai/rules/evidence"), /\.json$/),
  ];
  const repos = new Set<string>();
  for (const f of files) {
    const text = readFileSync(f, "utf8");
    const docs = f.endsWith(".jsonl") ? text.split("\n").filter((l) => l.trim()) : [text];
    for (const d of docs) {
      try { collectRepos(JSON.parse(d), repos); } catch { throw new Error("training_list_unreadable"); } // fail closed
    }
  }
  return { repos, sources: files.length };
}

// ---- the planner

export interface PlanStep {
  n: number;
  action: StepAction;
  file: string | null;
  symbol: string | null;
  status: "can-do" | "missing";
  /** can-do only: the approved rule (id@sha256) and the objective it would run. */
  rule: string | null;
  objective: string | null;
  /** missing only. */
  missing: Capability | null;
}
export interface Plan {
  schema: typeof PLAN_SCHEMA;
  planner: typeof PLANNER_VERSION;
  taskId: string;
  understanding: { clauses: number; intents: string[]; parse: string; anchors: string[] };
  files: { path: string; role: "source" | "test"; reason: string }[];
  steps: PlanStep[];
  tests: { files: string[]; command: string | null };
}
export interface PlanContext {
  repo: string;
  files: IndexFile[];
  /** Approved rule specs (admitRules APPROVED only). */
  rules: RuleSpec[];
  model: NbModel | null;
  /** The target's own test command, read from its package.json (null when none). */
  testCommand: string | null;
}

const TEST_PATH = /(?:^|\/)(?:__tests__|tests?)\/|\.(?:test|spec|test-d)\.[cm]?tsx?$/;
const NOT_SOURCE = /(?:^|\/)(?:node_modules|dist|build|coverage|benchmarks?|docs?|examples?|scripts?|website|playground|fixtures?)\/|\.d\.ts$/;
export const isTestPath = (p: string): boolean => TEST_PATH.test(p);
const isSourcePath = (p: string): boolean => /\.tsx?$/.test(p) && !isTestPath(p) && !NOT_SOURCE.test(p);

/** Loads the approved learned rules exactly as Job A does (hash-pinned list; anything else is left out). */
export function approvedRules(root = ROOT): RuleSpec[] {
  const dir = join(root, "peaceai/rules/learned");
  const specs = jsonFiles(dir, /\.json$/).map((f) => { try { return JSON.parse(readFileSync(f, "utf8")); } catch { return { id: f }; } });
  return admitRules(specs, loadApprovedList(join(root, "peaceai/rules/approved.json"))).filter((a) => a.decision === "APPROVED" && a.spec).map((a) => a.spec!);
}

function kindOfChange(request: string): "add" | "edit" {
  return /\b(?:add|adds|adding|introduce|new|support for|expose|export)\b/i.test(request) && !/\b(?:fix|bug|wrong|incorrect|instead|should not|shouldn't|doesn't|does not|ignores|drops|accepts|leaves|treats)\b/i.test(request) ? "add" : "edit";
}

/** Tries every approved rule on the objective; the first that yields an edit of `file` makes the step can-do. */
function ruleFor(ctx: PlanContext, objective: string, file: string): RuleSpec | null {
  const src = ctx.files.filter((f) => isSourcePath(f.path) || isTestPath(f.path));
  for (const spec of ctx.rules) {
    try {
      const edit = applyRule(spec, objective, src, isTestPath, ctx.repo);
      if (edit && (edit.path === file || (edit.extra ?? []).some((x) => x.path === file))) return spec;
    } catch { /* an engine error is a refusal */ }
  }
  return null;
}

/** Makes the plan. Pure: reads only the context it is given, writes nothing. */
export function planTask(taskId: string, request: string, ctx: PlanContext, index: RepoIndex = buildIndex(ctx.files)): Plan {
  const parts = clauses(request);
  const intents = ctx.model ? parts.map((c) => { const p = classify(ctx.model!, c); return Object.entries(p).sort((a, b) => b[1] - a[1])[0]![0]; }) : [];
  const approvedKinds = new Set(ctx.rules.map((r) => r.kind as string));
  const parsed = parseTask({ title: "", body: request }, { model: ctx.model, approvedKinds });
  const objective = parsed.status === "canonical" || parsed.status === "parsed" ? parsed.objective : null;

  // 1. Source files: what the request names (resolveTargets), else the best keyword match among source files.
  const targets = resolveTargets(index, request, (p) => !isSourcePath(p));
  const files: Plan["files"] = [];
  const sources: { path: string; symbol: string | null }[] = [];
  for (const t of targets.slice(0, 3)) { sources.push({ path: t.path, symbol: t.symbol }); files.push({ path: t.path, role: "source", reason: t.reason }); }
  if (sources.length === 0) {
    const hit = search(index, request, 50).find((h) => isSourcePath(h.path));
    if (hit) { sources.push({ path: hit.path, symbol: null }); files.push({ path: hit.path, role: "source", reason: "keyword match" }); }
  }
  // An export from the package entry: the request asks for it and an index file re-exports the source.
  if (/\bexport(?:ed)?\b.*\b(?:index|entry|package)\b|\b(?:index|entry|package)\b.*\bexport/i.test(request)) {
    for (const s of [...sources]) {
      const entry = [...index.imports.entries()].filter(([p, deps]) => /(?:^|\/)index\.ts$/.test(p) && isSourcePath(p) && deps.includes(s.path)).map(([p]) => p).sort((a, b) => a.length - b.length)[0];
      if (entry && !sources.some((x) => x.path === entry)) { sources.push({ path: entry, symbol: null }); files.push({ path: entry, role: "source", reason: "entry re-export" }); }
    }
  }
  // 2. Test files: tests related to each source file (imports, references), else by name, else by keywords.
  const testFiles: string[] = [];
  for (const s of sources) {
    const base = posix.basename(s.path).replace(/\.tsx?$/, "");
    const related = relatedFiles(index, [s.path], 200).filter(isTestPath);
    const byName = index.files.filter((p) => isTestPath(p) && posix.basename(p).replace(/\.(?:test|spec)\.tsx?$|\.tsx?$/, "") === base);
    const byWords = search(index, request, 200).map((h) => h.path).filter(isTestPath);
    const pick = [...byName.filter((p) => related.includes(p)), ...related.filter((p) => byWords.slice(0, 5).includes(p)), ...byName, ...related, ...byWords][0];
    if (pick && !testFiles.includes(pick)) { testFiles.push(pick); files.push({ path: pick, role: "test", reason: related.includes(pick) ? "imports or references the source" : byName.includes(pick) ? "same name" : "keyword match" }); }
  }
  // 3. Steps.
  const steps: PlanStep[] = [];
  const change = kindOfChange(request);
  const push = (s: Omit<PlanStep, "n">) => steps.push({ n: steps.length + 1, ...s });
  if (sources.length === 0) push({ action: "edit-source", file: null, symbol: null, status: "missing", rule: null, objective: null, missing: "locate-code" });
  for (const s of sources) {
    const spec = objective ? ruleFor(ctx, objective, s.path) : null;
    const isConst = s.symbol !== null && /^[A-Z][A-Z0-9_]+$|(?:Rx|Regex|RE)$/.test(s.symbol) && index.defs.some((d) => d.path === s.path && d.name === s.symbol && d.kind === "const");
    const missing: Capability = !objective && parts.length === 0 ? "understand-request" : change === "add" ? "add-function-or-member" : isConst ? "edit-constant" : "edit-existing-function";
    push(spec ? { action: "edit-source", file: s.path, symbol: s.symbol, status: "can-do", rule: `${spec.id}@${specHash(spec)}`, objective, missing: null }
      : { action: "edit-source", file: s.path, symbol: s.symbol, status: "missing", rule: null, objective: null, missing });
  }
  if (testFiles.length === 0) push({ action: "add-test", file: null, symbol: null, status: "missing", rule: null, objective: null, missing: "add-test-file" });
  for (const t of testFiles) {
    const spec = objective ? ruleFor(ctx, objective, t) : null;
    push(spec ? { action: "edit-test", file: t, symbol: null, status: "can-do", rule: `${spec.id}@${specHash(spec)}`, objective, missing: null }
      : { action: "edit-test", file: t, symbol: null, status: "missing", rule: null, objective: null, missing: "extend-existing-test" });
  }
  // Job B runs a target's own suite only for repositories in targets.json.
  const runnable = Object.prototype.hasOwnProperty.call(loadTargets().targets, ctx.repo);
  push(runnable ? { action: "run-tests", file: null, symbol: null, status: "can-do", rule: "pipeline:job-b-tests", objective: null, missing: null }
    : { action: "run-tests", file: null, symbol: null, status: "missing", rule: null, objective: null, missing: "run-target-tests" });
  return {
    schema: PLAN_SCHEMA, planner: PLANNER_VERSION, taskId,
    understanding: { clauses: parts.length, intents, parse: parsed.status === "unsure" ? `unsure:${parsed.reason}` : parsed.status, anchors: targets.map((t) => t.symbol ?? t.path).slice(0, 8) },
    files, steps, tests: { files: testFiles, command: ctx.testCommand },
  };
}
