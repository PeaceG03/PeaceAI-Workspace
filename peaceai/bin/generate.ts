// Job A: generate candidate diffs with the native kernel bundle. Prints counts only.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createRequire } from "node:module";
import { admitRules, loadApprovedList } from "../lib/approved.ts";
import { parseDiff } from "../lib/diff.ts";
import { applyRule } from "../lib/learned.ts";
import { checkCandidateScope } from "../lib/scope.ts";
import { indexBoost, selectSources } from "../lib/sources.ts";
import { buildIndex, indexStats, relatedFiles, resolveTargets, search } from "../lib/symbols.ts";
import { loadTargets, scopeOf } from "../lib/target.ts";
import { buildVariants, cleanIssueText } from "../lib/taskmap.ts";

const MAX_CANDIDATES = 5;
const MAX_CALLS = 40;

const bundle = process.env.PEACEAI_KERNEL_BUNDLE;
const outDir = process.env.PEACEAI_OUT_DIR;
const repo = process.env.PEACEAI_WORKSPACE_DIR ?? process.cwd();
if (!bundle || !outDir) throw new Error("PEACEAI_KERNEL_BUNDLE and PEACEAI_OUT_DIR are required");

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
const task = {
  title: String(fromFile?.title ?? process.env.ISSUE_TITLE ?? ""),
  body: String(fromFile?.body ?? process.env.ISSUE_BODY ?? ""),
};
const issueNumber = String(fromFile?.number ?? process.env.ISSUE_NUMBER ?? "local").replace(/[^0-9a-z-]/gi, "");
const taskId = `workspace-issue-${issueNumber}`;

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

const candidates: { id: string; diff: string; transformations: string[]; operationId: string | null }[] = [];
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
let learnedCandidates = 0;
for (const a of planSteps ? [] : admissions) {
  if (a.decision !== "APPROVED" || !a.spec || candidates.length >= MAX_CANDIDATES) continue;
  const edit = applyRule(a.spec, objectiveText, candidatesForContext);
  if (!edit) continue;
  const current = candidatesForContext.find((f) => f.path === edit.path)!;
  const diff = toDiff([{ operation: "EDIT_FILE", path: edit.path, expectedCurrentFingerprint: kernel.sourceFingerprint(current.path, current.content), content: edit.content, transformation: `LEARNED_${a.spec.kind}` }]);
  if (!diff) continue;
  const key = createHash("sha256").update(diff).digest("hex");
  if (seen.has(key)) continue;
  seen.add(key);
  if (checkCandidateScope(parseDiff(diff), baseFiles, scope).length > 0) {
    scopeRejected += 1;
    continue;
  }
  learnedCandidates += 1;
  candidates.push({ id: `candidate-${candidates.length + 1}`, diff, transformations: [`LEARNED_${a.spec.kind}`], operationId: `learned:${a.spec.id}` });
}
const refused = admissions.filter((a) => a.decision !== "APPROVED").map((a) => `${a.id}:${a.decision}`);
console.log(`learned rules=${admissions.length} approved=${admissions.length - refused.length} candidates=${learnedCandidates}${refused.length ? ` refused=${refused.join(",")}` : ""}`);
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
  })),
};
writeFileSync(join(outDir, "summary.json"), JSON.stringify(summary, null, 2) + "\n");
console.log(`sources=${sources.length} variants=${variants.length} plan=${planStatus} calls=${calls} candidates=${candidates.length} scope_rejected=${scopeRejected}`);
