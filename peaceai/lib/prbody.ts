import { isPassing, rankCandidates, shuffle, type CandidateResult } from "./rank.ts";

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

export interface PrPlan {
  passing: number;
  chosenId: string | null;
  body: string;
}

const MAX_DIFF_CHARS = 12_000;

export function planPullRequest(
  results: ResultsFile,
  diffs: ReadonlyMap<string, string>,
  issueNumber: string,
  seed: string,
): PrPlan {
  const passing = results.results.filter(isPassing);
  if (passing.length === 0) return { passing: 0, chosenId: null, body: "" };
  const chosen = rankCandidates(passing)[0]!;
  const shown = shuffle(passing, seed);
  const sections = shown.map((candidate, index) => {
    const label = String.fromCharCode(65 + index);
    let diff = diffs.get(candidate.id) ?? "";
    if (diff.length > MAX_DIFF_CHARS) diff = `${diff.slice(0, MAX_DIFF_CHARS)}\n... (truncated)`;
    const fence = diff.includes("```") ? "~~~~" : "```";
    return `### Candidate ${label}\n\n<details><summary>diff</summary>\n\n${fence}diff\n${diff}\n${fence}\n\n</details>`;
  });
  const body = [
    `Automated PeaceAI task for #${issueNumber}.`,
    "",
    `${passing.length} candidate(s) passed the original suite (run alone) and their new tests (run separately).`,
    "They are listed below in shuffled order, without scores. This branch applies one of them.",
    "",
    ...sections,
  ].join("\n");
  return { passing: passing.length, chosenId: chosen.id, body };
}
