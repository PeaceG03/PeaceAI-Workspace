// M49: build the fine-tune corpus (docs.jsonl + manifest.jsonl, train.py format) from local clones of Peace's
// public repos. Usage: ft-pairs.ts <out dir> <repo>=<clone dir>@<head sha> ...  Prints counts only.
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { FT_AUTHOR, pairsOf, type FtCommit } from "../lib/ftpairs.ts";
const rd = (p: string) => JSON.parse(readFileSync(new URL(`../model/${p}`, import.meta.url), "utf8"));
const H = rd("heldout.json"), CX = rd("heldout-c-excluded.json"), C = rd("heldout-c.json"), T = rd("heldout-c-tasks.json"), S = rd("safety-tool-sha256.json");
const commits = new Set<string>([...["A", "B"].flatMap((k) => (H.sets[k] ?? []).map((e: { repo: string; sha: string }) => `${e.repo}@${e.sha}`)), ...CX.commits.map((e: { repo: string; sha: string }) => `${e.repo}@${e.sha}`)]);
const content = new Set<string>([...C.sets.C.flatMap((e: { contentSha256: string[] }) => e.contentSha256), ...T.tasks.map((t: { fileSha256: string }) => t.fileSha256), ...S.sha256]);
const paths = new Set<string>(["A", "B"].flatMap((k) => (H.sets[k] ?? []).flatMap((e: { repo: string; paths: string[] }) => e.paths.map((p) => `${e.repo}:${p}`))));
if (paths.size === 0 || commits.size === 0 || content.size === 0 || S.sha256.length === 0) throw new Error("exclusion lists empty: fail closed");
const [out, ...specs] = process.argv.slice(2);
const git = (d: string, ...a: string[]) => execFileSync("git", ["-C", d, ...a], { encoding: "utf8", maxBuffer: 1 << 30 });
const docs: string[] = [], man: string[] = []; let n = 0; const counts: Record<string, number> = {};
for (const s of specs) {
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
    for (const d of pairsOf(c, { commits, contentSha256: content, paths })) {
      docs.push(JSON.stringify({ doc: n, text: d.text })); man.push(JSON.stringify({ doc: n, split: d.split, repo, sha: d.sha, path: d.path, function: d.function }));
      counts[d.split] = (counts[d.split] ?? 0) + 1; n++;
    }
  }
}
mkdirSync(out!, { recursive: true });
writeFileSync(`${out}/docs.jsonl`, docs.join("\n") + "\n"); writeFileSync(`${out}/manifest.jsonl`, man.join("\n") + "\n");
console.log(`ft-pairs docs=${n} train=${counts.train ?? 0} heldout=${counts.heldout ?? 0}`);
if (!counts.train || !counts.heldout) { console.log("ft-pairs: empty split, refused"); process.exit(1); }
