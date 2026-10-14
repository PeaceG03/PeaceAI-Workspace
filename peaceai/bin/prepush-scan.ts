// Local pre-push scan (M4.1): every commit being pushed, not just HEAD. For each commit: the content of
// every file it adds or modifies is checked for core text (against a local core checkout) and for personal
// info / secrets; the commit's identities must be noreply and its message clean. Commit shas come on stdin.
// Prints short shas, workspace paths, line numbers and kinds only. Exit 1 blocks the push.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { indexGitTree } from "../lib/coreindex.ts";
import { emptyIndex, findCoreText } from "../lib/coretext.ts";
import { parseTerms, scanText } from "../lib/leak.ts";

const coreDir = process.env.PEACEAI_CORE_DIR ?? "";
if (!coreDir || !existsSync(coreDir)) {
  console.log("PRE-PUSH FAIL core checkout not found (set PEACEAI_CORE_DIR); push blocked");
  process.exit(1);
}
const git = (...args: string[]) => execFileSync("git", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
const commits = [...new Set(readFileSync(0, "utf8").split(/\s+/).filter((s) => /^[0-9a-f]{40}$/.test(s)))];
const core = indexGitTree(coreDir);
if (core.paths.size === 0) {
  console.log("PRE-PUSH FAIL core checkout has no tracked files; push blocked");
  process.exit(1);
}
const terms = parseTerms(process.env.PEACEAI_PRIVATE_TERMS);
const empty = emptyIndex();
const CONFIG = /^(?:package-lock\.json|package\.json|tsconfig[^/]*\.json)$/;
const SHARED_NAMES = ["README.md", "package.json", "tsconfig.json", ".gitignore", "LICENSE"];
const publicBase = process.env.PEACEAI_PUBLIC_BASE ?? "";
const isAncestor = (a: string, b: string) => { try { execFileSync("git", ["merge-base", "--is-ancestor", a, b]); return true; } catch { return false; } };
const blobAt = (c: string, path: string) => { try { return git("rev-parse", "--verify", "-q", `${c}:${path}`).trim(); } catch { return null; } };
let failures = 0;
let files = 0;
const fail = (sha: string, message: string) => {
  failures += 1;
  console.log(`PRE-PUSH FAIL ${sha.slice(0, 10)} ${message}`);
};

for (const sha of commits) {
  // Identities and message.
  for (const value of git("log", "-1", "--format=%ae%n%ce", sha).split("\n").filter(Boolean))
    if (!/@users\.noreply\.github\.com$|^noreply@github\.com$/i.test(value)) fail(sha, "commit email is not a noreply address");
  for (const value of git("log", "-1", "--format=%an%n%cn", sha).split("\n").filter(Boolean))
    for (const f of scanText(value, terms)) fail(sha, `commit identity: ${f.kind}`);
  for (const f of scanText(git("log", "-1", "--format=%B", sha), terms)) fail(sha, `commit message:${f.line}: ${f.kind}`);
  // Files this commit adds or modifies (root commits: all files; merge commits: the diff against the first parent).
  const changed = git("diff-tree", "--root", "--diff-merges=first-parent", "--no-commit-id", "-r", "-z", "--no-renames", "--diff-filter=AM", "--name-only", sha)
    .split("\0")
    .filter(Boolean);
  // M42: in a merge, a file whose content is byte-identical to a parent already reachable from origin/main
  // (PEACEAI_PUBLIC_BASE, set by the hook) came in verbatim from public history; anything else is scanned.
  const parents = git("rev-list", "--parents", "-n", "1", sha).trim().split(" ").slice(1);
  const publicParents = parents.length > 1 && /^[0-9a-f]{40}$/.test(publicBase) ? parents.filter((p) => isAncestor(p, publicBase)) : [];
  for (const path of changed) {
    if (publicParents.length && publicParents.some((p) => blobAt(p, path) === blobAt(sha, path))) continue;
    files += 1;
    for (const f of scanText(path, terms)) fail(sha, `path name ${path}: ${f.kind}`);
    if (core.paths.has(path) && !SHARED_NAMES.includes(path)) fail(sha, `${path}: same path as a core file`);
    const size = Number(git("cat-file", "-s", `${sha}:${path}`).trim());
    if (size > 2_000_000) continue;
    const blob = execFileSync("git", ["cat-file", "blob", `${sha}:${path}`], { maxBuffer: 64 * 1024 * 1024 });
    if (blob.includes(0)) continue; // binary
    const text = blob.toString("utf8");
    for (const f of scanText(text, terms)) fail(sha, `${path}:${f.line}: ${f.kind}`);
    if (CONFIG.test(path)) continue; // protected, owner-reviewed config: generic key/value lines are not core-scanned
    const hits = findCoreText(text.split("\n"), core.text, empty);
    if (hits.lineHits + hits.shingleHits > 0) fail(sha, `${path}: core text (${hits.lineHits} line, ${hits.shingleHits} shingle match(es))`);
  }
}
if (failures > 0) {
  console.log(`PRE-PUSH BLOCKED commits=${commits.length} files=${files} failures=${failures}`);
  process.exit(1);
}
console.log(`PRE-PUSH PASS commits=${commits.length} files=${files}`);
