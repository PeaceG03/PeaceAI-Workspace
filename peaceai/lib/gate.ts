import { corePathCollision, findCoreText, type TextIndex } from "./coretext.ts";
import { parseDiff } from "./diff.ts";
import { checkCandidateScope } from "./scope.ts";

export interface GateCore {
  text: TextIndex;
  paths: ReadonlySet<string>;
  basenames: ReadonlySet<string>;
}

export interface GateResult {
  ok: boolean;
  reasons: string[]; // safe to print: workspace paths and counts only
}

export function gateCandidate(diff: string, baseFiles: ReadonlySet<string>, baseline: TextIndex, core: GateCore): GateResult {
  const reasons: string[] = [];
  let files;
  try {
    files = parseDiff(diff);
  } catch {
    return { ok: false, reasons: ["unparseable diff"] };
  }
  for (const violation of checkCandidateScope(files, baseFiles)) reasons.push(`scope: ${violation.path}: ${violation.reason}`);
  for (const file of files) {
    const path = file.newPath ?? file.oldPath;
    // Existing workspace files are already public; only new paths can import a core file name.
    if (path && !baseFiles.has(path) && corePathCollision(path, core.paths, core.basenames)) reasons.push(`core-path: ${path}`);
  }
  const added = files.flatMap((file) => file.addedLines);
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
}

export interface Summary {
  schema: "peaceai-workspace-candidates:v1";
  taskId: string;
  baseSha: string;
  candidates: SummaryCandidate[];
}

/** Strict schema check so the artifact can only carry the expected fields. */
export function validateSummary(value: unknown): value is Summary {
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
    return (
      Object.keys(c).sort().join(",") === "diffBytes,diffLines,file,id,operationId,transformations" &&
      c.id === `candidate-${index + 1}` &&
      c.file === `candidates/candidate-${index + 1}.diff` &&
      Array.isArray(c.transformations) &&
      c.transformations.every((t) => typeof t === "string" && /^[A-Z_]{1,40}$/.test(t)) &&
      (c.operationId === null || (typeof c.operationId === "string" && /^[A-Z_]{1,40}$/.test(c.operationId))) &&
      Number.isInteger(c.diffBytes) &&
      Number.isInteger(c.diffLines)
    );
  });
}
