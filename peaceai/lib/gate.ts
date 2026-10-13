import { join, resolve } from "node:path";
import { loadApprovedList } from "./approved.ts";
import { corePathCollision, findCoreText, type TextIndex } from "./coretext.ts";
import { parseDiff } from "./diff.ts";
import { scanText } from "./leak.ts";
import { checkCandidateScope, WORKSPACE_SCOPE, type CandidateScope } from "./scope.ts";

export interface GateCore {
  text: TextIndex;
  paths: ReadonlySet<string>;
  basenames: ReadonlySet<string>;
}

export interface GateResult {
  ok: boolean;
  reasons: string[]; // safe to print: workspace paths and counts only
}

export function gateCandidate(
  diff: string,
  baseFiles: ReadonlySet<string>,
  baseline: TextIndex,
  core: GateCore,
  scope: CandidateScope = WORKSPACE_SCOPE,
  opts: { testAppend?: boolean } = {},
): GateResult {
  const reasons: string[] = [];
  let files;
  try {
    files = parseDiff(diff);
  } catch {
    return { ok: false, reasons: ["unparseable diff"] };
  }
  for (const violation of checkCandidateScope(files, baseFiles, scope, opts)) reasons.push(`scope: ${violation.path}: ${violation.reason}`);
  for (const file of files) {
    const path = file.newPath ?? file.oldPath;
    // Existing workspace files are already public; only new paths can import a core file name.
    if (path && !baseFiles.has(path) && corePathCollision(path, core.paths, core.basenames)) reasons.push(`core-path: ${path}`);
  }
  const added = files.flatMap((file) => file.addedLines);
  // Personal info and secrets in anything the candidate adds (any target).
  const pii = scanText(added.join("\n"));
  if (pii.length > 0) reasons.push(`personal-info: ${[...new Set(pii.map((f) => f.kind))].sort().join(",")}`);
  const hits = findCoreText(added, core.text, baseline);
  if (hits.lineHits > 0 || hits.shingleHits > 0)
    reasons.push(`core-text: ${hits.lineHits} line match(es), ${hits.shingleHits} shingle match(es)`);
  return { ok: reasons.length === 0, reasons };
}

export interface SummaryCandidate {
  id: string;
  file: string;
  transformations: string[];
  operationId: string | null;
  diffBytes: number;
  diffLines: number;
  /** M12: fix commit a learned test must fail before and pass after (Job B grades it). */
  fixSha?: string;
  /** M13: a learned guard: Job B grades its new tests with and without the candidate's own source edit. */
  selfGrade?: true;
}

export interface Summary {
  schema: "peaceai-workspace-candidates:v1";
  taskId: string;
  baseSha: string;
  candidates: SummaryCandidate[];
}

/**
 * What a summary may claim beyond kernel ids. `learned`: id -> sha256 of every rule in the hash-pinned
 * approved list; a learned candidate's operationId is `learned:<id>@<sha256>` and is accepted only when that
 * exact pair is pinned. `lmModels`: the verified LM model ids a `lm-fill:<model>` candidate may name. Empty
 * by default, so neither prefix is ever accepted on its own.
 */
export interface SummaryContext { learned: ReadonlyMap<string, string>; lmModels: ReadonlySet<string> }
export const NO_CLAIMS: SummaryContext = { learned: new Map(), lmModels: new Set() };
/** The context every job uses: this repository's hash-pinned approved list (fixed path except for local tests). */
export function loadSummaryContext(listPath = process.env.PEACEAI_APPROVED_LIST ?? join(resolve(import.meta.dirname, "../.."), "peaceai/rules/approved.json")): SummaryContext {
  const l = loadApprovedList(listPath);
  // No verified model id reaches these jobs (only the lm-fill job verifies one), so lm-fill is never accepted here.
  return { learned: new Map(l.ok ? l.list.rules.map((r) => [r.id, r.sha256] as const) : []), lmModels: new Set() };
}
export function operationIdAllowed(id: unknown, ctx: SummaryContext): boolean {
  if (id === null) return true;
  if (typeof id !== "string") return false;
  if (/^[A-Z_]{1,40}$/.test(id)) return true;
  const learned = /^learned:((?:public|core)-[a-z0-9-]{1,60})@([0-9a-f]{64})$/.exec(id);
  if (learned) return ctx.learned.get(learned[1]!) === learned[2];
  const fill = /^lm-fill:(lm-v1-[0-9a-f]{12})$/.exec(id);
  return !!fill && ctx.lmModels.has(fill[1]!);
}

/** Strict schema check so the artifact can only carry the expected fields. */
export function validateSummary(value: unknown, ctx: SummaryContext = NO_CLAIMS): value is Summary {
  if (!value || typeof value !== "object") return false;
  const summary = value as Record<string, unknown>;
  if (Object.keys(summary).sort().join(",") !== "baseSha,candidates,schema,taskId") return false;
  if (summary.schema !== "peaceai-workspace-candidates:v1") return false;
  if (typeof summary.taskId !== "string" || !/^workspace-issue-[A-Za-z0-9-]{1,32}$/.test(summary.taskId)) return false;
  if (typeof summary.baseSha !== "string" || !/^[0-9a-f]{40}$/.test(summary.baseSha)) return false;
  if (!Array.isArray(summary.candidates) || summary.candidates.length > 5) return false;
  return summary.candidates.every((item, index) => {
    if (!item || typeof item !== "object") return false;
    const c = item as Record<string, unknown>;
    const keys = Object.keys(c).sort().join(",");
    return (
      (keys === "diffBytes,diffLines,file,id,operationId,transformations" ||
        (keys === "diffBytes,diffLines,file,fixSha,id,operationId,transformations" && typeof c.fixSha === "string" && /^[0-9a-f]{40}$/.test(c.fixSha)) ||
        (keys === "diffBytes,diffLines,file,id,operationId,selfGrade,transformations" && c.selfGrade === true && typeof c.operationId === "string" && c.operationId.startsWith("learned:"))) &&
      c.id === `candidate-${index + 1}` &&
      c.file === `candidates/candidate-${index + 1}.diff` &&
      Array.isArray(c.transformations) &&
      c.transformations.every((t) => typeof t === "string" && /^[A-Z_]{1,40}$/.test(t)) &&
      // Kernel ids; learned and lm-fill ids only when bound to an approved rule hash / verified model id.
      operationIdAllowed(c.operationId, ctx) &&
      Number.isInteger(c.diffBytes) &&
      Number.isInteger(c.diffLines)
    );
  });
}
