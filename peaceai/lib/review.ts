import { VERDICT_USAGE } from "./verdict.ts";

export interface Presented {
  label: string;
  id: string;
}

export function validatePresentation(value: unknown, candidateIds: readonly string[]): value is Presented[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 5) return false;
  const seen = new Set<string>();
  return value.every((p, i) => {
    const ok =
      p && typeof p === "object" && Object.keys(p).sort().join(",") === "id,label" &&
      p.label === String.fromCharCode(65 + i) && candidateIds.includes(p.id) && !seen.has(p.id);
    if (ok) seen.add(p.id);
    return ok;
  });
}

const MAX_DIFF_CHARS = 10_000;
export const PLACEHOLDER_NOTE = "placeholder value added by repair";

export function reviewBody(
  presentation: readonly Presented[],
  diffs: ReadonlyMap<string, string>,
  target: string | null = null,
  route: "pr" | "patch" = "pr",
  /** M7.1: neutral per-candidate notes (only "placeholder value added by repair" today). */
  notes: ReadonlyMap<string, string> = new Map(),
): string {
  // M6: a patch-route target (no write token) gets a format-patch comment instead of a PR.
  const outcome = route === "patch" ? "posts that candidate here as a `git format-patch` file" : "opens a PR for that candidate";
  const sections = presentation.map((p) => {
    let diff = diffs.get(p.id) ?? "";
    if (diff.length > MAX_DIFF_CHARS) diff = `${diff.slice(0, MAX_DIFF_CHARS)}\n... (truncated)`;
    const fence = diff.includes("```") ? "~~~~" : "```";
    const note = notes.get(p.id);
    return `### Candidate ${p.label}\n\n${note ? `Note: ${note}.\n\n` : ""}<details><summary>diff</summary>\n\n${fence}diff\n${diff}\n${fence}\n\n</details>`;
  });
  return [
    "PeaceAI review. Each candidate below passed the original suite (run alone) and its new tests (run separately).",
    "Order is random. No candidate is preferred.",
    ...(target ? [`Target repository: \`${target}\` (public). ${route === "patch" ? "A `right` verdict posts a patch file here (no PR)." : "A `right` verdict opens the PR there."}`] : []),
    "",
    ...sections,
    "",
    `Reply with a verdict. ${VERDICT_USAGE} \`/verdict <letter> right\` ${outcome}.`,
  ].join("\n");
}
