// Job A: generate candidate diffs with the native kernel bundle. Prints counts only.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { parseDiff } from "../lib/diff.ts";
import { checkCandidateScope } from "../lib/scope.ts";
import { selectSources } from "../lib/sources.ts";
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
const selected = selectSources(cleanIssueText(task), candidatesForContext);
const sourcePaths = selected.map((f) => f.path);
const sources = selected.map(({ path, content }) => ({ path, content, fingerprint: kernel.sourceFingerprint(path, content) }));
const variants = buildVariants(task, sourcePaths, scope.isTest);

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
outer: for (const variant of variants) {
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
console.log(`sources=${sources.length} variants=${variants.length} calls=${calls} candidates=${candidates.length} scope_rejected=${scopeRejected}`);
