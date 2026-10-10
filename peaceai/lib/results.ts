import type { CandidateResult } from "./rank.ts";

export interface ResultsFile {
  schema: "peaceai-workspace-results:v1";
  taskId: string;
  baseSha: string;
  results: CandidateResult[];
}

export function validateResults(value: unknown): value is ResultsFile {
  if (!value || typeof value !== "object") return false;
  const r = value as Record<string, unknown>;
  if (r.schema !== "peaceai-workspace-results:v1" || typeof r.taskId !== "string" || typeof r.baseSha !== "string") return false;
  if (!/^[0-9a-f]{40}$/.test(r.baseSha) || !Array.isArray(r.results) || r.results.length > 5) return false;
  return r.results.every((item) => {
    const c = item as Record<string, unknown>;
    return (
      !!c &&
      typeof c.id === "string" &&
      /^candidate-[1-5]$/.test(c.id) &&
      Number.isInteger(c.diffBytes) &&
      Number.isInteger(c.diffLines) &&
      Number.isInteger(c.newTestFiles) &&
      ["applied", "typecheckPassed", "originalSuitePassed", "newTestsPassed"].every((key) => typeof c[key] === "boolean")
    );
  });
}
