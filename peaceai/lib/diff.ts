// Minimal parser for `git diff` output. Captures enough structure for the scope gate.
export interface DiffFile {
  oldPath: string | null;
  newPath: string | null;
  isNew: boolean;
  isDeleted: boolean;
  isRename: boolean;
  isBinary: boolean;
  modeChange: boolean;
  newMode: string | null;
  addedLines: string[];
  removedLines: string[];
  /** M14: an existing file changed only by lines added at its end (one hunk, nothing removed, no context after the additions). */
  appendOnly: boolean;
}

function stripPrefix(value: string, prefix: "a/" | "b/"): string | null {
  if (value === "/dev/null") return null;
  return value.startsWith(prefix) ? value.slice(prefix.length) : value;
}

export function parseDiff(text: string): DiffFile[] {
  const files: DiffFile[] = [];
  let current: DiffFile | null = null;
  let inHunk = false;
  const hunks = new Map<DiffFile, { count: number; contextAfterAdd: boolean }>();
  for (const line of text.split("\n")) {
    if (line.startsWith("diff --git ")) {
      const match = /^diff --git a\/(.+) b\/(.+)$/.exec(line);
      current = {
        oldPath: match?.[1] ?? null,
        newPath: match?.[2] ?? null,
        isNew: false,
        isDeleted: false,
        isRename: false,
        isBinary: false,
        modeChange: false,
        newMode: null,
        addedLines: [],
        removedLines: [],
        appendOnly: false,
      };
      hunks.set(current, { count: 0, contextAfterAdd: false });
      files.push(current);
      inHunk = false;
      continue;
    }
    if (!current) {
      if (line.trim() !== "") throw new Error("diff: content before first file header");
      continue;
    }
    if (line.startsWith("@@")) {
      inHunk = true;
      hunks.get(current)!.count += 1;
      continue;
    }
    if (inHunk) {
      if (line.startsWith(" ") || line.startsWith("\\")) { if (current.addedLines.length > 0) hunks.get(current)!.contextAfterAdd = true; }
      if (line.startsWith("+")) current.addedLines.push(line.slice(1));
      else if (line.startsWith("-")) current.removedLines.push(line.slice(1));
      continue;
    }
    if (line.startsWith("new file mode ")) {
      current.isNew = true;
      current.newMode = line.slice("new file mode ".length).trim();
    } else if (line.startsWith("deleted file mode ")) current.isDeleted = true;
    else if (line.startsWith("rename from ") || line.startsWith("rename to ") || line.startsWith("copy from ") || line.startsWith("copy to ")) current.isRename = true;
    else if (line.startsWith("old mode ")) current.modeChange = true;
    else if (line.startsWith("new mode ")) {
      current.modeChange = true;
      current.newMode = line.slice("new mode ".length).trim();
    } else if (line.startsWith("Binary files ") || line.startsWith("GIT binary patch")) current.isBinary = true;
    else if (line.startsWith("--- ")) current.oldPath = stripPrefix(line.slice(4).trim(), "a/");
    else if (line.startsWith("+++ ")) current.newPath = stripPrefix(line.slice(4).trim(), "b/");
  }
  for (const f of files) {
    const h = hunks.get(f)!;
    f.appendOnly = !f.isNew && !f.isDeleted && !f.isRename && !f.isBinary && !f.modeChange && h.count === 1 && f.removedLines.length === 0 && f.addedLines.length > 0 && !h.contextAfterAdd;
  }
  return files;
}

/** Changed-line count used for candidate summaries (same rule as generation). */
export function countDiffLines(diff: string): number {
  return diff.split("\n").filter((line) => /^[+-](?![+-]{2} )/.test(line)).length;
}
