// M49: build the fine-tune corpus (docs.jsonl + manifest.jsonl, train.py format) from local clones of Peace's
// public repos: all PeaceG03 public commits (Peace, Builder and agents share the noreply identity). Usage: ft-pairs.ts <out dir> <repo>=<clone dir>@<head sha> ...  Prints counts only.
// M119 list mode (LM retrain): ft-pairs.ts <out dir> --list <commits.txt> --list-sha256 <hex> <repo>=<clone dir>@<head sha> ...
//   Only the listed items, never the history walk: each `code` line is one merged PR taken as its merge commit's
//   first-parent diff (the Auditor-passed content; the branch's earlier NOT-PASS commits are never read), each `row`
//   line is one builder-log row (doc = that exact line, manifest carries `line`). Every merge must be on the pinned
//   head's first-parent line; every row must be byte-identical at its pinned commit and at the commit that added it.
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { FT_AUTHOR, FT_SOURCE_LABEL, pairsOf, type FtCommit } from "../lib/ftpairs.ts";
const rd = (p: string) => JSON.parse(readFileSync(new URL(`../model/${p}`, import.meta.url), "utf8"));
const H = rd("heldout.json"), CX = rd("heldout-c-excluded.json"), C = rd("heldout-c.json"), T = rd("heldout-c-tasks.json"), S = rd("safety-tool-sha256.json");
const commits = new Set<string>([...["A", "B"].flatMap((k) => (H.sets[k] ?? []).map((e: { repo: string; sha: string }) => `${e.repo}@${e.sha}`)), ...CX.commits.map((e: { repo: string; sha: string }) => `${e.repo}@${e.sha}`)]);
const content = new Set<string>([...C.sets.C.flatMap((e: { contentSha256: string[] }) => e.contentSha256), ...T.tasks.map((t: { fileSha256: string }) => t.fileSha256), ...S.sha256]);
const paths = new Set<string>(["A", "B"].flatMap((k) => (H.sets[k] ?? []).flatMap((e: { repo: string; paths: string[] }) => e.paths.map((p) => `${e.repo}:${p}`))));
// M49 BLOCKING (1): docs the box core-free proof flagged as core are dropped by text sha256 (peaceai/model/ft-corefree.json).
const FTC = rd("ft-corefree.json"); const coreDocs = new Set<string>(FTC.excludedDocSha256);
if (!Array.isArray(FTC.excludedDocSha256)) throw new Error("ft-corefree.json unreadable: fail closed");
const textSha = (t: string) => createHash("sha256").update(t).digest("hex");
if (paths.size === 0 || commits.size === 0 || content.size === 0 || S.sha256.length === 0) throw new Error("exclusion lists empty: fail closed");
const argv = process.argv.slice(2);
const opt = (k: string): string | null => { const i = argv.indexOf(k); if (i < 0) return null; const v = argv[i + 1]; argv.splice(i, 2); if (!v) throw new Error(`${k} needs a value`); return v; };
const listPath = opt("--list"), listSha = opt("--list-sha256");
if ((listPath === null) !== (listSha === null)) throw new Error("--list and --list-sha256 go together: fail closed");
const [out, ...specs] = argv;
const git = (d: string, ...a: string[]) => execFileSync("git", ["-C", d, ...a], { encoding: "utf8", maxBuffer: 1 << 30 });
const docs: string[] = [], man: string[] = []; let n = 0; const counts: Record<string, number> = {};
const ex = { commits, contentSha256: content, paths };
const emit = (repo: string, d: { sha: string; path: string; function: string; text: string; split: string }, line?: number) => {
  if (coreDocs.has(textSha(d.text))) { counts.coreExcluded = (counts.coreExcluded ?? 0) + 1; return; }
  docs.push(JSON.stringify({ doc: n, text: d.text }));
  man.push(JSON.stringify(line === undefined ? { doc: n, split: d.split, repo, sha: d.sha, path: d.path, function: d.function } : { doc: n, split: d.split, repo, sha: d.sha, path: d.path, function: d.function, line }));
  counts[d.split] = (counts[d.split] ?? 0) + 1; n++;
};
if (listPath !== null) {
  const listBytes = readFileSync(listPath);
  if (createHash("sha256").update(listBytes).digest("hex") !== listSha) { console.log("ft-pairs refused: commit list sha256 is not the pinned one"); process.exit(1); }
  const clones = new Map<string, { dir: string; head: string; firstParent: Set<string> }>();
  for (const s of specs) {
    const m = /^([\w.-]+\/[\w.-]+)=(.+)@([0-9a-f]{40})$/.exec(s); if (!m) throw new Error("bad spec " + s);
    if (git(m[2]!, "rev-parse", "HEAD").trim() !== m[3]) { console.log(`ft-pairs refused: ${m[1]} clone is not at its pinned head`); process.exit(1); }
    clones.set(m[1]!, { dir: m[2]!, head: m[3]!, firstParent: new Set(git(m[2]!, "rev-list", "--first-parent", m[3]!).split("\n").filter(Boolean)) });
  }
  const H40 = "([0-9a-f]{40})";
  const CODE = new RegExp(`^code ([\\w.-]+/[\\w.-]+) #(\\d+) head=${H40} merge=${H40}$`), ROW = new RegExp(`^row ([\\w.-]+/[\\w.-]+) (builder-log/tasks\\.jsonl) seq=(\\d+) line=(\\d+) at=${H40} added=${H40}$`);
  const seen = new Set<string>();
  for (const l of listBytes.toString("utf8").split("\n").filter(Boolean)) {
    if (seen.has(l)) throw new Error("duplicate list line: fail closed"); seen.add(l);
    const c = CODE.exec(l), r = ROW.exec(l);
    const cl = clones.get((c ?? r)?.[1] ?? "");
    if (!cl) { console.log("ft-pairs refused: list line for a repo with no clone, or unparseable"); process.exit(1); }
    if (c) {
      const [, repo, , head, merge] = c as unknown as [string, string, string, string, string];
      if (!cl.firstParent.has(merge)) { console.log(`ft-pairs refused: ${repo} merge not on the pinned head's first-parent line`); process.exit(1); }
      const parents = git(cl.dir, "show", "-s", "--format=%P", merge).trim().split(" ").filter(Boolean);
      if (parents.length < 1 || parents.length > 2 || (parents.length === 2 && parents[1] !== head)) { console.log(`ft-pairs refused: ${repo} merge parents do not match the listed head`); process.exit(1); }
      const base = parents[0]!;
      const email = git(cl.dir, "show", "-s", "--format=%ae", merge).trim();
      const files = git(cl.dir, "diff-tree", "--no-commit-id", "--name-status", "-r", base, merge).trim().split("\n").filter(Boolean).flatMap((x) => {
        const [st, p] = x.split("\t"); if (st !== "M" || !p) return [];
        return [{ path: p, before: git(cl.dir, "show", `${base}:${p}`), after: git(cl.dir, "show", `${merge}:${p}`) }];
      });
      // parents: 1 = this is the first-parent diff of the merged PR (one change), not a walk of the PR branch.
      for (const d of pairsOf({ repo, sha: merge, authorEmail: email, parents: 1, files }, ex)) emit(repo, d);
      counts.prs = (counts.prs ?? 0) + 1;
    } else {
      const [, repo, path, seqS, lineS, at, added] = r as unknown as [string, string, string, string, string, string, string];
      const seq = Number(seqS), line = Number(lineS);
      if (at !== cl.head || !cl.firstParent.has(added)) { console.log("ft-pairs refused: builder-log row not pinned to the head / added off main"); process.exit(1); }
      const text = git(cl.dir, "show", `${at}:${path}`).split("\n")[line - 1] ?? "";
      let parsed: { seq?: unknown } = {}; try { parsed = JSON.parse(text); } catch { parsed = {}; }
      const then = git(cl.dir, "show", `${added}:${path}`).split("\n").filter((x) => { try { return JSON.parse(x).seq === seq; } catch { return false; } });
      if (parsed.seq !== seq || then.length !== 1 || then[0] !== text) { console.log("ft-pairs refused: builder-log row changed since it was added (or seq/line mismatch)"); process.exit(1); }
      const fn = `builder-log seq ${seq}`;
      const split = parseInt(textSha(`peaceai-ft:v1\n${repo}\n${at}\n${path}\n${fn}`).slice(0, 8), 16) % 10 === 0 ? "heldout" : "train";
      emit(repo, { sha: at, path, function: fn, text, split }, line);
      counts.rows = (counts.rows ?? 0) + 1;
    }
  }
}
for (const s of listPath === null ? specs : []) {
  const m = /^([\w.-]+\/[\w.-]+)=(.+)@([0-9a-f]{40})$/.exec(s); if (!m) throw new Error("bad spec " + s);
  const [, repo, dir, head] = m as unknown as [string, string, string, string];
  for (const line of git(dir, "log", "--no-merges", `--author=${FT_AUTHOR}`, "--format=%H %P", head).trim().split("\n").filter(Boolean)) {
    const [sha, ...parents] = line.split(" ");
    const email = git(dir, "show", "-s", "--format=%ae", sha!).trim();
    const files = git(dir, "diff-tree", "--no-commit-id", "--name-status", "-r", sha!).trim().split("\n").filter(Boolean).flatMap((l) => {
      const [st, p] = l.split("\t"); if (st !== "M" || !p) return [];
      return [{ path: p, before: git(dir, "show", `${sha}^:${p}`), after: git(dir, "show", `${sha}:${p}`) }];
    });
    const c: FtCommit = { repo, sha: sha!, authorEmail: email, parents: parents.length, files };
    for (const d of pairsOf(c, ex)) emit(repo, d);
  }
}
mkdirSync(out!, { recursive: true });
writeFileSync(`${out}/docs.jsonl`, docs.join("\n") + "\n"); writeFileSync(`${out}/manifest.jsonl`, man.join("\n") + "\n");
console.log(`ft-pairs source: ${FT_SOURCE_LABEL}`);
console.log(`ft-pairs docs=${n} train=${counts.train ?? 0} heldout=${counts.heldout ?? 0} core_excluded=${counts.coreExcluded ?? 0}${listPath === null ? "" : ` list_prs=${counts.prs ?? 0} list_rows=${counts.rows ?? 0}`}`);
if (!counts.train || !counts.heldout) { console.log("ft-pairs: empty split, refused"); process.exit(1); }
