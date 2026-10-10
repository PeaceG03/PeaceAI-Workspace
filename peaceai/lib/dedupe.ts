// M4.1: candidates that make the same non-test source edit are one distinct edit. A candidate that adds a
// test file next to the same edit is a duplicate of the edit, not a second choice.
import { createHash } from "node:crypto";
import { parseDiff } from "./diff.ts";

export const isTestPath = (path: string): boolean => /\.(test|spec)\.tsx?$/.test(path);

/** Normalized non-test part of a candidate diff: per file (sorted by path), its kind and changed lines. */
export function normalizedEdit(diff: string): string {
  const files = parseDiff(diff)
    .map((f) => ({ f, path: f.newPath ?? f.oldPath ?? "" }))
    .filter(({ path }) => path !== "" && !isTestPath(path))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return files
    .map(({ f, path }) => {
      const kind = f.isNew ? "new" : f.isDeleted ? "deleted" : "modified";
      const trim = (l: string) => l.replace(/\s+$/, "");
      return [`${kind} ${path}`, ...f.removedLines.map((l) => `-${trim(l)}`), ...f.addedLines.map((l) => `+${trim(l)}`)].join("\n");
    })
    .join("\n");
}

/** Short stable key for the distinct edit a candidate makes. */
export function editKey(diff: string): string {
  return createHash("sha256").update(normalizedEdit(diff)).digest("hex").slice(0, 16);
}
