// M19: mine finished workflow steps (the ADD_WORKFLOW_STEP rule's evidence). Reads `.github/workflows/*.yml`
// only, and only from the public repositories in TEST_MINING_REPOS (origin checked, Peace's noreply author
// only), like M12. Each observation is one whole step item (`- name:` / `- run:` / `- uses:` and its more-indented
// lines) that a commit ADDS to an existing workflow, described by style facts only (no YAML text). Line-based,
// deterministic; no model, no YAML library.
import { execFileSync } from "node:child_process";
import { parseHunks, type Hunk, type Observation } from "./mine.ts";
import { MAX_FILES_PER_COMMIT } from "./minegit.ts";
import { assertTestMiningAllowed, PEACE_AUTHOR } from "./minetest.ts";

export const WORKFLOW_FILE = /^\.github\/workflows\/[\w.-]+\.ya?ml$/;
const ITEM = /^(\s+)- (name|run|uses|id|if|with|env|shell|working-directory|timeout-minutes|continue-on-error):/;
const indentOf = (l: string) => /^\s*/.exec(l)![0].length;

/** Steps wholly inside one pure-addition hunk of a workflow file, with their style facts. */
export function observeWorkflow(commit: string, path: string, post: string, hunks: readonly Hunk[]): Observation[] {
  if (!WORKFLOW_FILE.test(path)) return [];
  const lines = post.split("\n");
  const out: Observation[] = [];
  for (const h of hunks) {
    if (h.removed.length > 0 || h.added.length === 0 || h.added.length > 40 || h.oldCount !== 0 || h.oldStart === 0) continue;
    const body = h.added.filter((l) => l.trim() !== "" && !/^\s*#/.test(l));
    const first = body.length ? ITEM.exec(body[0]!) : null;
    if (!first) continue;
    const dash = first[1]!.length;
    // Split into items at the same dash indent; every other line must be more indented (or blank).
    const items: string[][] = [];
    let ok = true;
    for (const l of body) {
      const m = ITEM.exec(l);
      if (m && m[1]!.length === dash) items.push([l]);
      else if (indentOf(l) > dash && items.length) items[items.length - 1]!.push(l);
      else { ok = false; break; }
    }
    if (!ok) continue;
    // The added lines must sit inside a `steps:` list: the line before the hunk is a step line or `steps:`.
    const before = lines.slice(0, h.newStart - 1).reverse().find((l) => l.trim() !== "" && !/^\s*#/.test(l)) ?? "";
    if (!(indentOf(before) > dash || (/^\s*steps:\s*$/.test(before) && indentOf(before) < dash)) && !(indentOf(before) === dash && ITEM.test(before))) continue;
    const after = lines.slice(h.newStart - 1 + h.newCount).find((l) => l.trim() !== "" && !/^\s*#/.test(l));
    const endOfJob = after === undefined || indentOf(after) < dash || (indentOf(after) === dash && !/^\s*- /.test(after));
    items.forEach((it, k) => {
      const text = it.join("\n");
      const keys = it.map((l) => /^\s*(?:- )?([\w-]+):/.exec(l)?.[1]).filter(Boolean);
      const run = /^\s*(?:- )?run:\s*(.*)$/m.exec(text)?.[1]?.trim() ?? null;
      out.push({
        shape: "WORKFLOW_STEP", commit, path, line: h.newStart,
        style: {
          step: keys.includes("uses") ? "uses" : keys.includes("name") && keys.includes("run") ? "name-run" : keys.includes("run") ? "run-only" : "other",
          extraKeys: keys.every((k) => k === "name" || k === "run") ? "none" : "some",
          run: run === null ? "none" : /^(?:npm|pnpm) run [a-z][\w:-]*$/.test(run) ? "package-script" : "other",
          expressions: /\$\{\{/.test(text) ? "yes" : "none",
          secrets: /secrets\./.test(text) ? "yes" : "none",
          placement: endOfJob && k === items.length - 1 ? "end-of-job" : "middle",
        },
      });
    });
  }
  return out;
}

/** Workflow-step observations for an allowed public repository (refuses any other). */
export function mineWorkflows(dir: string, rev: string, label: string): { commits: number; observations: Observation[] } {
  assertTestMiningAllowed(dir, label);
  const git = (...a: string[]) => execFileSync("git", a, { cwd: dir, encoding: "utf8", maxBuffer: 256 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] });
  const commits = git("rev-list", "--no-merges", "--reverse", `--author=${PEACE_AUTHOR}`, rev).split("\n").filter(Boolean);
  const observations: Observation[] = [];
  for (const c of commits) {
    let files: string[];
    try { files = git("diff-tree", "--no-commit-id", "--name-only", "-r", "--diff-filter=M", c).split("\n").filter((f) => WORKFLOW_FILE.test(f)); } catch { continue; }
    if (files.length === 0 || files.length > MAX_FILES_PER_COMMIT) continue;
    for (const f of files) {
      try {
        observations.push(...observeWorkflow(`${label}@${c.slice(0, 10)}`, f, git("show", `${c}:${f}`), parseHunks(git("diff", "-U0", "--no-color", "--no-renames", `${c}^`, c, "--", f))));
      } catch { /* root */ }
    }
  }
  return { commits: commits.length, observations };
}
