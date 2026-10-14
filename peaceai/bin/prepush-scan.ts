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
const tokens = readFileSync(0, "utf8").split(/\s+/).filter(Boolean);
const publicBase = process.env.PEACEAI_PUBLIC_BASE ?? "";
const core = indexGitTree(coreDir);
if (core.paths.size === 0) {
  console.log("PRE-PUSH FAIL core checkout has no tracked files; push blocked");
  process.exit(1);
}
const terms = parseTerms(process.env.PEACEAI_PRIVATE_TERMS);
const empty = emptyIndex();
const CONFIG = /^(?:package-lock\.json|package\.json|tsconfig[^/]*\.json)$/;
const SHARED_NAMES = ["README.md", "package.json", "tsconfig.json", ".gitignore", "LICENSE"];
const isAncestor = (a: string, b: string) => { try { execFileSync("git", ["merge-base", "--is-ancestor", a, b]); return true; } catch { return false; } };
const blobAt = (c: string, path: string) => { try { return git("rev-parse", "--verify", "-q", `${c}:${path}`).trim(); } catch { return null; } };
// Auditor #157 low note: author, committer and tagger names are also checked for core text.
const identityCore = (name: string) => { const h = findCoreText([name], core.text, empty); return h.lineHits + h.shingleHits > 0; };
let failures = 0;
let files = 0;
const fail = (sha: string, message: string) => {
  failures += 1;
  console.log(`PRE-PUSH FAIL ${sha.slice(0, 10)} ${message}`);
};

// M42 (Auditor #157 F7): every pushed object ("push:<sha>", from the hook) is typed. A commit expands to the
// commits not reachable from the remote's main; an annotated tag has its message and tagger scanned and is
// followed to its target; a pushed blob or tree is blocked. Bare 40-hex tokens are commits (direct callers).
const commitSet = new Set<string>();
const scanTag = (tag: string, depth = 0) => {
  const raw = git("cat-file", "tag", tag);
  const tagger = /^tagger (.*) <([^>]*)>/m.exec(raw);
  if (!tagger) fail(tag, "annotated tag has no tagger");
  else {
    if (!/@users\.noreply\.github\.com$|^noreply@github\.com$/i.test(tagger[2])) fail(tag, "tagger email is not a noreply address");
    for (const f of scanText(tagger[1], terms)) fail(tag, `tagger identity: ${f.kind}`);
    if (identityCore(tagger[1])) fail(tag, "tagger identity: core text");
  }
  const msg = raw.slice(raw.indexOf("\n\n") + 2);
  for (const f of scanText(msg, terms)) fail(tag, `tag message:${f.line}: ${f.kind}`);
  const hits = findCoreText(msg.split("\n"), core.text, empty);
  if (hits.lineHits + hits.shingleHits > 0) fail(tag, "tag message: core text");
  const target = /^object ([0-9a-f]{40})$/m.exec(raw)?.[1] ?? "";
  classify(target, depth + 1);
};
function classify(sha: string, depth = 0): void {
  let type = "";
  try { type = git("cat-file", "-t", sha).trim(); } catch { fail(sha, "pushed object is missing"); return; }
  if (depth > 8) { fail(sha, "tag chain too deep"); return; }
  if (type === "commit") {
    const range = /^[0-9a-f]{40}$/.test(publicBase) ? [sha, `^${publicBase}`] : ["-n", "1", sha];
    for (const c of git("rev-list", ...range).split("\n").filter(Boolean)) commitSet.add(c);
  } else if (type === "tag") scanTag(sha, depth);
  else fail(sha, `pushed ${type || "object"} (only commits and annotated tags may be pushed)`);
}
for (const t of tokens) {
  const m = /^(push:)?([0-9a-f]{40})$/.exec(t);
  if (!m) continue;
  if (m[1]) classify(m[2]);
  else commitSet.add(m[2]);
}
const commits = [...commitSet];
for (const sha of commits) {
  // Identities and message.
  for (const value of git("log", "-1", "--format=%ae%n%ce", sha).split("\n").filter(Boolean))
    if (!/@users\.noreply\.github\.com$|^noreply@github\.com$/i.test(value)) fail(sha, "commit email is not a noreply address");
  for (const value of git("log", "-1", "--format=%an%n%cn", sha).split("\n").filter(Boolean)) {
    for (const f of scanText(value, terms)) fail(sha, `commit identity: ${f.kind}`);
    if (identityCore(value)) fail(sha, "commit identity: core text");
  }
  const body = git("log", "-1", "--format=%B", sha);
  for (const f of scanText(body, terms)) fail(sha, `commit message:${f.line}: ${f.kind}`);
  { const h = findCoreText(body.split("\n"), core.text, empty); if (h.lineHits + h.shingleHits > 0) fail(sha, "commit message: core text"); }
  // Files this commit adds or modifies (root commits: all files; merge commits: the diff against the first parent).
  const changed = git("diff-tree", "--root", "--diff-merges=first-parent", "--no-commit-id", "-r", "-z", "--no-renames", "--diff-filter=d", "--name-only", sha)
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
    // Auditor #157 F3-F5: gitlinks and other non-blobs, files over 2 MB, and NUL-containing files are not
    // skipped. Non-blobs and oversize files block; binary content is still scanned for core text.
    let otype = "";
    try { otype = git("cat-file", "-t", `${sha}:${path}`).trim(); } catch { /* missing */ }
    if (otype !== "blob") { fail(sha, `${path}: not a regular blob (${otype || "missing"})`); continue; }
    const size = Number(git("cat-file", "-s", `${sha}:${path}`).trim());
    if (size > 2_000_000) { fail(sha, `${path}: over 2 MB (${size} bytes); push blocked`); continue; }
    const blob = execFileSync("git", ["cat-file", "blob", `${sha}:${path}`], { maxBuffer: 64 * 1024 * 1024 });
    // Auditor #157 N2: a NUL-containing file is scanned as NUL->newline, as NUL-stripped text, and as UTF-16
    // (BOM, or every other byte NUL), so core text stored as UTF-16LE/BE is still caught.
    let text = blob.toString("utf8");
    if (blob.includes(0)) {
      const views = [blob.toString("latin1").replace(/\0/g, "\n"), blob.toString("latin1").replace(/\0/g, "")];
      const le = blob[0] === 0xff && blob[1] === 0xfe, be = blob[0] === 0xfe && blob[1] === 0xff;
      const odd = (k: number) => { let n = 0, z = 0; for (let i = k; i < blob.length; i += 2) { n++; if (blob[i] === 0) z++; } return n > 0 && z === n; };
      if (le || odd(1)) views.push(blob.subarray(le ? 2 : 0).toString("utf16le"));
      if (be || odd(0)) { const b = Buffer.from(blob.subarray(be ? 2 : 0)); if (b.length % 2 === 0) b.swap16(); views.push(b.toString("utf16le")); }
      text = views.join("\n");
    }
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
