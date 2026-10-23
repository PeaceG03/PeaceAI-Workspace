import {
  STATUS,
  STATUS_ORDER,
  type Issue,
  type StatusKey,
} from "@/fixtures/seed";

export interface Column {
  key: StatusKey;
  label: string;
  /** CSS color token for the status dot, e.g. "var(--accent)". */
  dot: string;
  count: number;
  issues: Issue[];
}

/** Group issues into the four board columns in fixed order. */
export function groupByStatus(issues: Issue[]): Column[] {
  return STATUS_ORDER.map((key) => {
    const list = issues.filter((i) => i.status === key);
    return {
      key,
      label: STATUS[key].label,
      dot: STATUS[key].dot,
      count: list.length,
      issues: list,
    };
  });
}

/** GitHub issue URL for the demo repository (static until live data in G5). */
export function issueUrl(issueNumber: number): string {
  return `https://github.com/acme/platform/issues/${issueNumber}`;
}
