export interface OpenPr {
  number: number;
  headRefName: string;
}

/** Open PeaceAI PR for an issue, if any. Branches are named peace-task/issue-<n>-<suffix>. */
export function findOpenPeacePr(prs: readonly OpenPr[], issue: number): number | null {
  const prefix = `peace-task/issue-${issue}-`;
  const match = prs.filter((pr) => pr.headRefName.startsWith(prefix)).sort((a, b) => a.number - b.number);
  return match[0]?.number ?? null;
}

export function verdictReply(label: string, verdict: string, existingPr: number | null, wantsPr: boolean): string {
  const recorded = `Verdict recorded: ${label} ${verdict}.`;
  if (!wantsPr || existingPr === null) return recorded;
  return `${recorded} PR #${existingPr} is already open for this issue, so no new PR was opened. To switch candidates, close #${existingPr} and send the verdict again.`;
}
