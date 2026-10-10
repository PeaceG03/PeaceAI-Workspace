import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { addText, emptyIndex, type TextIndex } from "./coretext.ts";

const MAX_FILE_BYTES = 1_000_000;
const TEXT_EXT = /\.(?:[cm]?[jt]sx?|json|md|ya?ml|ps1|psm1|sh|py|txt|html|css|toml)$/i;

export interface TreeIndex {
  text: TextIndex;
  paths: Set<string>;
  basenames: Set<string>;
}

/** Indexes the tracked text files of a git checkout. Reads files only; keeps hashes and paths in memory. */
export function indexGitTree(dir: string, filter: (path: string) => boolean = () => true): TreeIndex {
  const files = execFileSync("git", ["ls-files", "-z"], { cwd: dir, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
    .split("\0")
    .filter(Boolean)
    .filter(filter);
  const index: TreeIndex = { text: emptyIndex(), paths: new Set(), basenames: new Set() };
  for (const path of files) {
    index.paths.add(path);
    index.basenames.add(path.split("/").pop() ?? path);
    if (!TEXT_EXT.test(path)) continue;
    const full = join(dir, path);
    try {
      const stat = statSync(full);
      if (!stat.isFile() || stat.size > MAX_FILE_BYTES) continue;
      addText(index.text, readFileSync(full, "utf8"));
    } catch {
      // Unreadable files are skipped; they cannot be matched either way.
    }
  }
  return index;
}
