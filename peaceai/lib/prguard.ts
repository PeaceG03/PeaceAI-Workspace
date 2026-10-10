// Verdict PRs: at most one open PeaceAI PR per issue, and never one holding a candidate other than
// the counted verdict. Branches are peace-task/issue-<n>-<candidate id>-<8 hex>; older branches
// (peace-task/issue-<n>-<hex>) hold an unknown candidate and are treated as different.
export interface OpenPr {
  number: number;
  headRefName: string;
}

export interface IssuePr {
  number: number;
  candidateId: string | null;
}

export const prBranch = (issue: number, candidateId: string, suffix: string) => `peace-task/issue-${issue}-${candidateId}-${suffix}`;

/** Open PeaceAI PRs for one issue, with the candidate each holds (null when unknown). */
export function openPeacePrs(prs: readonly OpenPr[], issue: number): IssuePr[] {
  const prefix = `peace-task/issue-${issue}-`;
  return prs
    .filter((pr) => pr.headRefName.startsWith(prefix))
    .map((pr) => {
      const m = /^(candidate-\d{1,3})-[0-9a-f]{8}$/.exec(pr.headRefName.slice(prefix.length));
      return { number: pr.number, candidateId: m ? m[1]! : null };
    })
    .sort((a, b) => a.number - b.number);
}

/** M2.5 helper kept for callers: first open PeaceAI PR for an issue. */
export function findOpenPeacePr(prs: readonly OpenPr[], issue: number): number | null {
  return openPeacePrs(prs, issue)[0]?.number ?? null;
}

export interface VerdictInput {
  label: string; // letter or "none"
  verdict: "right" | "wrong" | "unsure";
  candidateId: string | null; // candidate of this verdict (null for none)
}

export interface PrPlan {
  close: number[];
  open: boolean;
  reply: string;
}

export function planPr(v: VerdictInput, open: readonly IssuePr[]): PrPlan {
  const recorded = `Verdict recorded: ${v.label} ${v.verdict}.`;
  const list = (ns: readonly number[]) => ns.map((n) => `#${n}`).join(", ");
  if (v.verdict === "right" && v.candidateId) {
    const same = open.find((pr) => pr.candidateId === v.candidateId);
    const close = open.filter((pr) => pr !== same).map((pr) => pr.number);
    const closed = close.length ? ` Closed ${list(close)} (a different candidate).` : "";
    if (same) return { close, open: false, reply: `${recorded}${closed} PR #${same.number} already holds this candidate, so no new PR was opened.` };
    return { close, open: true, reply: `${recorded}${closed} Opening a PR for ${v.label}.` };
  }
  if (v.verdict === "wrong" && v.candidateId === null) {
    const close = open.map((pr) => pr.number);
    return { close, open: false, reply: close.length ? `${recorded} Closed ${list(close)}: no candidate is acceptable.` : recorded };
  }
  if (v.verdict === "unsure") {
    const note = open.length ? ` ${list(open.map((p) => p.number))} left open; close it if you no longer want it.` : "";
    return { close: [], open: false, reply: `${recorded} This withdraws the earlier verdict: the issue is excluded from training and agreement until a new verdict.${note}` };
  }
  return { close: [], open: false, reply: recorded };
}
