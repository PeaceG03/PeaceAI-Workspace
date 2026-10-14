// Job A: generate candidate diffs with the native kernel bundle. Prints counts only.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createRequire } from "node:module";
import { admitRules, loadApprovedList } from "../lib/approved.ts";
import { parseDiff } from "../lib/diff.ts";
import { applyRule, specHash } from "../lib/learned.ts";
import { safeNewModuleOnDisk } from "../lib/learned-function.ts";
import { acceptFill, applyFill, fillOptions, parseFillTask } from "../lib/fill.ts";
import { lmFlags } from "../lib/lm.ts";
import { checkCandidateScope } from "../lib/scope.ts";
import { indexBoost, selectSources } from "../lib/sources.ts";
import { buildIndex, indexStats, relatedFiles, resolveTargets, search } from "../lib/symbols.ts";
import { loadTargets, scopeOf } from "../lib/target.ts";
import { buildVariants, cleanIssueText } from "../lib/taskmap.ts";
import { nlDecision } from "../lib/nlparse.ts";
import { regradeOf, type RegradeRequest } from "../lib/regrade.ts";
import { spawnSync } from "node:child_process";

const MAX_CANDIDATES = 5;
const MAX_CALLS = 40;

const bundle = process.env.PEACEAI_KERNEL_BUNDLE;
const outDir = process.env.PEACEAI_OUT_DIR;
const repo = process.env.PEACEAI_WORKSPACE_DIR ?? process.cwd();
if (!bundle || !outDir) throw new Error("PEACEAI_KERNEL_BUNDLE and PEACEAI_OUT_DIR are required");

function writeSummary(summary: object): void {
  writeFileSync(join(outDir!, "summary.json"), JSON.stringify(summary, null, 2) + "\n");
}
const writeOutput = (o: Record<string, string>) => {
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, Object.entries(o).map(([k, v]) => `${k}=${v}\n`).join(""));
};
const git = (cwd: string, ...args: string[]): string =>
  execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

const kernel = createRequire(import.meta.url)(bundle);
const synthesizer = new kernel.PeaceAINativeCodeSynthesizer();

const baseSha = git(repo, "rev-parse", "HEAD").trim();
const tracked = git(repo, "ls-files", "-z").split("\0").filter(Boolean);
const baseFiles = new Set(tracked);
// M5: the target's scope decides which files are sources; larger targets get a bounded, task-relevant set.
const targets = loadTargets();
const target = process.env.PEACEAI_TARGET || targets.default;
const targetConfig = targets.targets[target];
if (!targetConfig) throw new Error("target has no scope config");
const scope = scopeOf(targetConfig);

const fromFile = process.env.ISSUE_JSON ? JSON.parse(readFileSync(process.env.ISSUE_JSON, "utf8")) : null;
const issueTask = {
  title: String(fromFile?.title ?? process.env.ISSUE_TITLE ?? ""),
  body: String(fromFile?.body ?? process.env.ISSUE_BODY ?? ""),
};
const issueNumber = String(fromFile?.number ?? process.env.ISSUE_NUMBER ?? "local").replace(/[^0-9a-z-]/gi, "");
const taskId = `workspace-issue-${issueNumber}`;

const tooling = resolve(import.meta.dirname, "../..");
const readSpecs = (dir: string): unknown[] =>
  existsSync(dir)
    ? readdirSync(dir).filter((f) => f.endsWith(".json")).sort().map((f) => {
        try { return JSON.parse(readFileSync(join(dir, f), "utf8")); } catch { return { id: f }; }
      })
    : [];
const specs = [
  ...readSpecs(process.env.PEACEAI_RULES_DIR ?? join(tooling, "peaceai/rules/learned")),
  ...(process.env.PEACEAI_CORE_DIR ? readSpecs(join(process.env.PEACEAI_CORE_DIR, "packages/coding-kernel/learned-rules")) : []),
];
const admissions = admitRules(specs, loadApprovedList(process.env.PEACEAI_APPROVED_LIST ?? join(tooling, "peaceai/rules/approved.json")));
const refusedEarly = admissions.filter((a) => a.decision !== "APPROVED").map((a) => `${a.id}:${a.decision}`);
console.log(`learned admission rules=${admissions.length} approved=${admissions.length - refusedEarly.length}${refusedEarly.length ? ` refused=${refusedEarly.join(",")}` : ""}`);

// M18: stale-base regrade (Auditor option b). The verdict job asked for exactly one already-chosen candidate
// to be re-applied onto the target's CURRENT head (this checkout) and graded fresh by Job B. No synthesis,
// no rules run: the same diff (hash-pinned in the request) must apply cleanly with a plain `git apply`
// (no 3-way), stay in scope, and a learned candidate's rule must still be approved with the same hash.
// Anything else is refused with 0 candidates. regrade.json tells the record job which attempt this regrades.
if (process.env.PEACEAI_REGRADE_FILE && existsSync(process.env.PEACEAI_REGRADE_FILE)) {
  const raw = JSON.parse(readFileSync(process.env.PEACEAI_REGRADE_FILE, "utf8")) as Record<string, unknown>;
  const req = (raw.schema === "peaceai-regrade-request:v1" ? raw : { runId: "", candidateId: "" }) as unknown as RegradeRequest;
  mkdirSync(join(outDir, "candidates"), { recursive: true });
  const refuse = (why: string): never => {
    console.log(`regrade=refused reason=${why} of_run=${req.runId} candidate=${req.candidateId}`);
    writeOutput({ regrade: "refused", regrade_reason: why });
    writeSummary({ schema: "peaceai-workspace-candidates:v1", taskId, baseSha, candidates: [] });
    process.exit(0);
  };
  if (raw.schema !== "peaceai-regrade-request:v1" || typeof req.diff !== "string") refuse("invalid-request");
  if (createHash("sha256").update(req.diff).digest("hex") !== req.diffSha256) refuse("diff-hash");
  if (baseSha === req.baseSha) refuse("not-stale");
  if (req.operationId?.startsWith("learned:")) {
    const ok = admissions.some((a) => a.decision === "APPROVED" && a.spec && `learned:${a.spec.id}@${specHash(a.spec)}` === req.operationId);
    if (!ok) refuse("rule-not-approved");
  }
  const check = spawnSync("git", ["-C", repo, "apply", "--check", "--whitespace=nowarn", "-"], { input: req.diff, encoding: "utf8" });
  if (check.status !== 0) refuse("does-not-apply-cleanly");
  if (checkCandidateScope(parseDiff(req.diff), baseFiles, scope, { testAppend: !!req.fixSha }).length > 0) refuse("scope");
  writeFileSync(join(outDir, "candidates", "candidate-1.diff"), req.diff);
  writeSummary({
    schema: "peaceai-workspace-candidates:v1", taskId, baseSha,
    candidates: [{
      id: "candidate-1", file: "candidates/candidate-1.diff", transformations: req.transformations, operationId: req.operationId,
      diffBytes: Buffer.byteLength(req.diff), diffLines: req.diff.split("\n").filter((line) => /^[+-](?![+-]{2} )/.test(line)).length,
      ...(req.fixSha ? { fixSha: req.fixSha } : {}), ...(req.selfGrade ? { selfGrade: true } : {}),
    }],
  });
  writeFileSync(join(outDir, "regrade.json"), JSON.stringify(regradeOf(req)) + "\n");
  writeOutput({ regrade: "applied" });
  console.log(`regrade=applied of_run=${req.runId} candidate=${req.candidateId} old_base=${req.baseSha.slice(0, 12)} new_head=${baseSha.slice(0, 12)} candidates=1`);
  process.exit(0);
}

// M10: plain-language tasks. Canonical wording passes unchanged; plain wording becomes the canonical plan;
// anything unclear is refused here (no candidates, enum-only outputs) and the issue gets the phrasing list.
const nl = nlDecision(issueTask, process.env.PEACEAI_NL_PARSE, new Set(admissions.filter((a) => a.decision === "APPROVED" && a.spec).map((a) => a.spec!.kind)));
writeOutput({ nl: nl.status, nl_reason: nl.status === "unsure" ? nl.reason : "", nl_hint: nl.status === "unsure" ? nl.hint ?? "" : "", nl_steps: nl.status === "parsed" ? String(nl.steps.length) : "" });
console.log(`nl=${nl.status}${nl.status === "unsure" ? ` reason=${nl.reason}` : nl.status === "parsed" ? ` steps=${nl.steps.length} families=${nl.steps.map((s) => s.family).join(",")}` : ""}`);
if (nl.status === "unsure") {
  mkdirSync(join(outDir, "candidates"), { recursive: true });
  writeSummary({ schema: "peaceai-workspace-candidates:v1", taskId, baseSha, candidates: [] });
  process.exit(0);
}
const task = nl.status === "parsed" ? { title: "", body: nl.objective } : issueTask;

const candidatesForContext = tracked
  .filter((path) => scope.isSource(path) && !scope.isDenied(path))
  .map((path) => ({ path, content: readFileSync(join(repo, path), "utf8") }));
// M6: symbol and keyword index over the target's in-scope files. Built here, in memory, after the
// visibility gate (select job + re-check) has passed; only counts are logged and nothing is saved.
const objectiveText = cleanIssueText(task);
const index = buildIndex(candidatesForContext);
const resolved = resolveTargets(index, objectiveText, scope.isTest).map((t) => t.path);
const related = relatedFiles(index, resolved);
const keywordHits = search(index, objectiveText, 10).map((hit) => hit.path);
const selected = selectSources(objectiveText, candidatesForContext, indexBoost(resolved, related, keywordHits));
const sourcePaths = selected.map((f) => f.path);
const sources = selected.map(({ path, content }) => ({ path, content, fingerprint: kernel.sourceFingerprint(path, content) }));
const variants = buildVariants(task, sourcePaths, scope.isTest, resolved);
console.log(`${indexStats(index)} resolved=${resolved.length} related=${related.length}`);

const worktree = mkdtempSync(join(tmpdir(), "peaceai-gen-"));
rmSync(worktree, { recursive: true, force: true });
git(repo, "worktree", "add", "--quiet", "--detach", worktree, baseSha);

interface Operation {
  operation: "CREATE_FILE" | "EDIT_FILE";
  path: string;
  expectedCurrentFingerprint: string | null;
  content: string;
  transformation: string;
}

function toDiff(operations: readonly Operation[]): string | null {
  try {
    for (const op of operations) {
      const target = join(worktree, op.path);
      if (!target.startsWith(worktree + "/")) return null;
      if (op.operation === "EDIT_FILE") {
        const current = readFileSync(target, "utf8");
        if (op.expectedCurrentFingerprint && kernel.sourceFingerprint(op.path, current) !== op.expectedCurrentFingerprint) return null;
      }
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, op.content);
    }
    git(worktree, "add", "-A", "--intent-to-add", ".");
    const diff = git(worktree, "diff", "--no-color", "--no-ext-diff", "--no-renames", "--full-index");
    return diff.trim() ? diff : null;
  } catch {
    return null;
  } finally {
    git(worktree, "reset", "--quiet", "--hard", baseSha);
    git(worktree, "clean", "-fdqx");
  }
}

const candidates: { id: string; diff: string; transformations: string[]; operationId: string | null; fixSha?: string; selfGrade?: true }[] = [];
const seen = new Set<string>();
let calls = 0;
let scopeRejected = 0;

// M6: a task written as numbered steps is a multi-step plan. It runs once through the bundled planner
// (DevelopmentPlanGraph + CrossLayerPlanExecutor over the edit families) and yields at most one combined
// candidate; single-step variants are not tried, so a partial chain is never offered.
const planSteps = typeof kernel.parsePlanSteps === "function" ? kernel.parsePlanSteps(objectiveText) : null;
let planStatus = "none";
if (planSteps) {
  calls += 1;
  let plan;
  try {
    plan = await kernel.synthesizePlan({ taskId, objective: objectiveText, targetPath: resolved[0] ?? null, sources });
  } catch {
    plan = { status: "BLOCKED" };
  }
  planStatus = `${String(plan.status).toLowerCase()}:${planSteps.length}`;
  if (plan.status === "MATERIALIZED") {
    const diff = toDiff(plan.operations);
    if (diff && checkCandidateScope(parseDiff(diff), baseFiles, scope).length === 0) {
      candidates.push({
        id: "candidate-1",
        diff,
        transformations: [...new Set<string>(plan.steps.flatMap((step: { transformations: string[] }) => step.transformations))],
        operationId: plan.operationId,
      });
    } else if (diff) scopeRejected += 1;
  }
}

outer: for (const variant of planSteps ? [] : variants) {
  const rejected: string[] = [];
  for (let attempt = 0; attempt < 4; attempt += 1) {
    if (calls >= MAX_CALLS || candidates.length >= MAX_CANDIDATES) break outer;
    calls += 1;
    let result;
    try {
      result = synthesizer.synthesize({
        protocolVersion: kernel.NATIVE_CODE_SYNTHESIS_PROTOCOL_VERSION,
        taskId,
        objective: variant.objective,
        strategy: "workspace-issue",
        targetPath: variant.targetPath,
        sources,
        architectureConstraints: [],
        acceptanceCriteria: [],
        priorRejectedCandidateIdentities: rejected,
      });
    } catch {
      break;
    }
    if (result.status !== "MATERIALIZED") break;
    rejected.push(result.candidateIdentity);
    const diff = toDiff(result.operations);
    if (!diff) continue;
    const key = createHash("sha256").update(diff).digest("hex");
    if (seen.has(key)) continue;
    seen.add(key);
    if (checkCandidateScope(parseDiff(diff), baseFiles, scope).length > 0) {
      scopeRejected += 1;
      continue;
    }
    candidates.push({
      id: `candidate-${candidates.length + 1}`,
      diff,
      transformations: [...new Set<string>(result.operations.map((op: Operation) => op.transformation))],
      operationId: result.operationId ?? null,
    });
  }
}
// M8: learned edit rules. Public rules live in this repository, core-mined rules in core. Each one runs
// only when the hash-pinned approved list names its id with the exact content hash; anything else, or a
// missing/corrupt list, refuses it (no candidate). The list path is fixed except for local tests.
let learnedCandidates = 0;
for (const a of planSteps ? [] : admissions) {
  if (a.decision !== "APPROVED" || !a.spec || candidates.length >= MAX_CANDIDATES) continue;
  // M19: a workflow-step rule also sees the opted-in workflow files, package.json and the lockfile names.
  const workflowFiles = a.spec.kind === "ADD_WORKFLOW_STEP"
    ? [...tracked.filter((p) => scope.isWorkflow?.(p) || p === "package.json").map((p) => ({ path: p, content: readFileSync(join(repo, p), "utf8") })), ...tracked.filter((p) => p === "pnpm-lock.yaml" || p === "package-lock.json" || (/^(?:[\w-]+\/)*tsconfig[\w.-]*\.json$/.test(p) && !lstatSync(join(repo, p)).isSymbolicLink() && lstatSync(join(repo, p)).isFile())).map((p) => ({ path: p, content: "" }))]
    : [];
  const edit = applyRule(a.spec, objectiveText, [...candidatesForContext, ...workflowFiles], scope.isTest, target);
  if (!edit) continue;
  // M12: a test rule creates a new file only (never an existing one) and carries the fix commit to grade against.
  // M17: ...except a self-graded function rule creating a new source module (with its new tests in `extra`).
  const newModule = !!(edit.create && edit.selfGrade && edit.extra && a.spec.kind === "ADD_FUNCTION" && !edit.fixSha && !baseFiles.has(edit.path) && scope.isSource(edit.path) && !scope.isTest(edit.path) && safeNewModuleOnDisk(repo, edit.path));
  if (edit.create && !newModule && (baseFiles.has(edit.path) || !edit.fixSha || !/^[0-9a-f]{40}$/.test(edit.fixSha))) continue;
  // M13: a guard rule edits one existing source file and creates new test files only; it is graded against itself.
  if (edit.extra && a.spec.kind !== "ADD_WORKFLOW_STEP" && ((edit.create && !newModule) || !edit.selfGrade || edit.extra.length === 0 || edit.extra.some((x) => x.create !== true || baseFiles.has(x.path) || !scope.isTest(x.path) || x.path === edit.path))) continue;
  if (edit.selfGrade && !edit.extra) continue;
  // M19: a workflow edit only from the workflow-step rule, on an existing opted-in workflow, self-graded.
  if (!scope.isSource(edit.path) && !(a.spec.kind === "ADD_WORKFLOW_STEP" && scope.isWorkflow?.(edit.path) && baseFiles.has(edit.path) && !edit.create && edit.selfGrade && edit.extra?.length === 0)) continue;
  if (a.spec.kind === "ADD_WORKFLOW_STEP" && edit.extra?.length !== 0) continue;
  // M14: a test rule that appends edits an existing test file only by adding lines at its end.
  if (!edit.create && edit.fixSha !== undefined) {
    const cur = candidatesForContext.find((f) => f.path === edit.path);
    if (!/^[0-9a-f]{40}$/.test(edit.fixSha) || !cur || !scope.isTest(edit.path) || !edit.content.startsWith(cur.content) || edit.extra) continue;
  }
  const current = edit.create ? null : candidatesForContext.find((f) => f.path === edit.path)!;
  const diff = toDiff([current
    ? { operation: "EDIT_FILE", path: edit.path, expectedCurrentFingerprint: kernel.sourceFingerprint(current.path, current.content), content: edit.content, transformation: `LEARNED_${a.spec.kind}` }
    : { operation: "CREATE_FILE", path: edit.path, expectedCurrentFingerprint: null, content: edit.content, transformation: `LEARNED_${a.spec.kind}` },
    ...(edit.extra ?? []).map((x): Operation => ({ operation: "CREATE_FILE", path: x.path, expectedCurrentFingerprint: null, content: x.content, transformation: `LEARNED_${a.spec!.kind}` }))]);
  if (!diff) continue;
  const key = createHash("sha256").update(diff).digest("hex");
  if (seen.has(key)) continue;
  seen.add(key);
  if (checkCandidateScope(parseDiff(diff), baseFiles, scope, { testAppend: !!edit.fixSha }).length > 0) {
    scopeRejected += 1;
    continue;
  }
  learnedCandidates += 1;
  candidates.push({ id: `candidate-${candidates.length + 1}`, diff, transformations: [`LEARNED_${a.spec.kind}`], operationId: `learned:${a.spec.id}@${specHash(a.spec)}`, ...(edit.fixSha ? { fixSha: edit.fixSha } : {}), ...(edit.selfGrade ? { selfGrade: true as const } : {}) });
}
const refused = admissions.filter((a) => a.decision !== "APPROVED").map((a) => `${a.id}:${a.decision}`);
console.log(`learned rules=${admissions.length} approved=${admissions.length - refused.length} candidates=${learnedCandidates}${refused.length ? ` refused=${refused.join(",")}` : ""}`);
// M9: template gap fill (flag PEACEAI_LM_FILL, off by default). The lm-fill job chose a value among the
// template's options; it is accepted only if it is one of the options derived here from the same target.
// The candidate is then gated, scoped, tested and repaired like any other. Never uses learned rules.
let fillStatus = "off";
const fillTask = lmFlags(process.env).fill && !planSteps ? parseFillTask(objectiveText) : null;
if (fillTask && process.env.PEACEAI_LM_FILLS && existsSync(process.env.PEACEAI_LM_FILLS) && candidates.length < MAX_CANDIDATES) {
  let raw: unknown = null;
  try { raw = JSON.parse(readFileSync(process.env.PEACEAI_LM_FILLS, "utf8")); } catch { raw = null; }
  const value = acceptFill(raw, fillTask, fillOptions(fillTask, candidatesForContext));
  const current = candidatesForContext.find((f) => f.path === fillTask.path);
  const content = value && current ? applyFill(fillTask, current.content, value) : null;
  const diff = content && current ? toDiff([{ operation: "EDIT_FILE", path: current.path, expectedCurrentFingerprint: kernel.sourceFingerprint(current.path, current.content), content, transformation: "LM_FILL_CONSTANT" }]) : null;
  fillStatus = "refused";
  if (diff && !seen.has(createHash("sha256").update(diff).digest("hex")) && checkCandidateScope(parseDiff(diff), baseFiles, scope).length === 0) {
    fillStatus = "candidate";
    candidates.push({ id: `candidate-${candidates.length + 1}`, diff, transformations: ["LM_FILL_CONSTANT"], operationId: `lm-fill:${(raw as { model: string }).model}` });
  }
} else if (fillTask) fillStatus = "no-fill";
console.log(`lm fill=${fillStatus}`);
git(repo, "worktree", "remove", "--force", worktree);

mkdirSync(join(outDir, "candidates"), { recursive: true });
for (const candidate of candidates) writeFileSync(join(outDir, "candidates", `${candidate.id}.diff`), candidate.diff);
const summary = {
  schema: "peaceai-workspace-candidates:v1",
  taskId,
  baseSha,
  candidates: candidates.map((candidate) => ({
    id: candidate.id,
    file: `candidates/${candidate.id}.diff`,
    transformations: candidate.transformations,
    operationId: candidate.operationId,
    diffBytes: Buffer.byteLength(candidate.diff),
    diffLines: candidate.diff.split("\n").filter((line) => /^[+-](?![+-]{2} )/.test(line)).length,
    ...(candidate.fixSha ? { fixSha: candidate.fixSha } : {}),
    ...(candidate.selfGrade ? { selfGrade: true } : {}),
  })),
};
writeSummary(summary);
console.log(`sources=${sources.length} variants=${variants.length} plan=${planStatus} calls=${calls} candidates=${candidates.length} scope_rejected=${scopeRejected}`);
