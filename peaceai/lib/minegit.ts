// M8: walk a local git repository's history (read-only) and collect shape observations.
import { execFileSync } from "node:child_process";
import { observeFile, parseHunks, SKIP_FILE, SOURCE_FILE, type Observation } from "./mine.ts";

export const MAX_FILES_PER_COMMIT = 25;

/** Observations for every non-merge commit reachable from `rev`. Commit ids are `<label>@<sha10>`. */
export function mineRepo(dir: string, rev: string, label: string): { commits: number; observations: Observation[] } {
  const git = (...a: string[]) => execFileSync("git", a, { cwd: dir, encoding: "utf8", maxBuffer: 256 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] });
  const commits = git("rev-list", "--no-merges", "--reverse", rev).split("\n").filter(Boolean);
  const observations: Observation[] = [];
  for (const c of commits) {
    let files: string[];
    try {
      files = git("diff-tree", "--no-commit-id", "--name-only", "-r", "--diff-filter=M", c).split("\n").filter((f) => SOURCE_FILE.test(f) && !SKIP_FILE.test(f));
    } catch { continue; }
    if (files.length === 0 || files.length > MAX_FILES_PER_COMMIT) continue;
    for (const f of files) {
      try {
        const diff = git("diff", "-U0", "--no-color", "--no-renames", `${c}^`, c, "--", f);
        observations.push(...observeFile(`${label}@${c.slice(0, 10)}`, f, git("show", `${c}:${f}`), parseHunks(diff)));
      } catch { /* root commit */ }
    }
  }
  return { commits: commits.length, observations };
}

/** The -U0 hunk text of one observation (for private core proposals only). */
export function exampleHunk(dir: string, sha: string, path: string, line: number): string {
  const git = (...a: string[]) => execFileSync("git", a, { cwd: dir, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] });
  const diff = git("diff", "-U0", "--no-color", "--no-renames", `${sha}^`, sha, "--", path);
  const hunks = diff.split(/\n(?=@@ )/).slice(1);
  const hit = hunks.find((h) => {
    const m = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(h);
    if (!m) return false;
    const start = +m[1]!;
    const count = m[2] === undefined ? 1 : +m[2];
    return line >= start && line < start + Math.max(count, 1);
  });
  return `${path} @ ${sha}\n${(hit ?? "").split("\n").slice(0, 16).join("\n")}`;
}
