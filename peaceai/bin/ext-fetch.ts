// M36: rebuilds the external pretraining docs from the committed provenance manifest on a public runner (no core
// access needed: every file was already core-checked on the box). Fetches each repo at its pinned commit and keeps a
// file only when its sha256 matches the manifest; any mismatch or missing file fails the whole build (exit 1).
//   ext-fetch.ts <workdir> <outdir>           writes <outdir>/docs.jsonl and <outdir>/manifest.jsonl
//   ext-fetch.ts <workdir> <outdir> --set-c   M37: instead fetches set C v2 (heldout-c.json) for eval: every file of
//     each held-out repo whose sha256 is listed; every listed hash must be found (else exit 1). Never a training input.
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { sha256Hex } from "../lib/heldout.ts";
import { splitOf } from "../lib/lmcorpus.ts";
import { EXT_MANIFEST_SCHEMA, manifestRepoProblems, manifestShaPinProblem, type ExtManifestEntry } from "../lib/extcorpus.ts";

const [work, out] = process.argv.slice(2, 4).map((p) => resolve(p));
const manifestBytes = readFileSync(resolve(import.meta.dirname, "../model/ext-manifest.jsonl"));
const pinProblem = manifestShaPinProblem(process.argv, manifestBytes);
if (pinProblem) { console.log(`ext-fetch refused: ${pinProblem}`); process.exit(1); }
const lines = manifestBytes.toString("utf8").split("\n").filter(Boolean);
// Validate every manifest (and set C) repo name and commit against ^[\w.-]+/[\w.-]+$ and the committed config
// BEFORE any work dir is created or any fetch runs (Auditor #153).
const cfgAll = JSON.parse(readFileSync(resolve(import.meta.dirname, "../model/ext-corpus.json"), "utf8"));
const cAll = JSON.parse(readFileSync(resolve(import.meta.dirname, "../model/heldout-c.json"), "utf8"));
const pairs = [...lines.slice(1).map((l) => JSON.parse(l) as ExtManifestEntry).map((e) => ({ repo: e.repo, commit: e.commit })), ...(cAll.sets?.C ?? []).map((e: { repo: string; sha: string }) => ({ repo: e.repo, commit: e.sha }))];
const repoProblems = manifestRepoProblems(pairs, cfgAll);
if (repoProblems.length) { for (const p of repoProblems.slice(0, 5)) console.log(`ext-fetch refused: ${p}`); process.exit(1); }
const fetchRepo = (repo: string, commit: string): string => {
  const d = join(work!, repo.replace("/", "__"));
  if (!existsSync(d)) { execFileSync("git", ["init", "-q", d]); execFileSync("git", ["-C", d, "fetch", "-q", "--depth", "1", `https://github.com/${repo}.git`, commit]); }
  return d;
};
if (process.argv.includes("--set-c")) {
  const c = JSON.parse(readFileSync(resolve(import.meta.dirname, "../model/heldout-c.json"), "utf8"));
  if (c.schema !== "peaceai-heldout-c:v2") throw new Error("bad set C file");
  mkdirSync(out!, { recursive: true });
  const docs: string[] = [];
  for (const e of c.sets.C as { repo: string; sha: string; contentSha256: string[] }[]) {
    const d = fetchRepo(e.repo, e.sha);
    const want = new Set(e.contentSha256), found = new Set<string>();
    // Blobs only (no submodule or symlink-as-commit entries), by object id, in path order.
    const blobs = execFileSync("git", ["-C", d, "ls-tree", "-r", "-z", e.sha], { encoding: "utf8", maxBuffer: 1 << 28 }).split("\0").filter(Boolean)
      .map((l) => { const [m, p] = l.split("\t"); const [, t, id] = m!.split(" "); return { t, id: id!, p: p! }; }).filter((x) => x.t === "blob").sort((a, b) => (a.p < b.p ? -1 : a.p > b.p ? 1 : 0));
    const paths = blobs.map((b) => b.p);
    const r = spawnSync("git", ["-C", d, "cat-file", "--batch"], { input: blobs.map((b) => b.id).join("\n") + "\n", maxBuffer: 2 ** 31 - 1 });
    let at = 0;
    for (const p of paths) {
      const nl = r.stdout.indexOf(10, at); const head = r.stdout.subarray(at, nl).toString();
      const size = Number(head.split(" ")[2]); const text = r.stdout.subarray(nl + 1, nl + 1 + size).toString("utf8"); at = nl + 2 + size;
      const h = sha256Hex(text);
      if (want.has(h) && !found.has(h)) { found.add(h); docs.push(JSON.stringify({ doc: docs.length, text })); }
    }
    if (found.size !== want.size) throw new Error(`set C ${e.repo}: ${want.size - found.size} listed hashes not found`);
  }
  writeFileSync(join(out!, "docs.jsonl"), docs.join("\n") + "\n");
  console.log(`ext-fetch set C v2 files=${docs.length} repos=${c.sets.C.length}`);
  process.exit(0);
}
if (JSON.parse(lines[0]!).schema !== EXT_MANIFEST_SCHEMA) throw new Error("bad manifest header");
const entries: ExtManifestEntry[] = lines.slice(1).map((l) => JSON.parse(l));
mkdirSync(out!, { recursive: true });
const docs: string[] = [];
const byRepo = new Map<string, ExtManifestEntry[]>();
for (const e of entries) byRepo.set(`${e.repo}@${e.commit}`, [...(byRepo.get(`${e.repo}@${e.commit}`) ?? []), e]);
for (const [key, es] of byRepo) {
  const [repo, commit] = key.split("@");
  const d = join(work!, repo!.replace("/", "__"));
  if (!existsSync(d)) { execFileSync("git", ["init", "-q", d]); execFileSync("git", ["-C", d, "fetch", "-q", "--depth", "1", `https://github.com/${repo}.git`, commit!]); }
  const r = spawnSync("git", ["-C", d, "cat-file", "--batch"], { input: es.map((e) => `${commit}:${e.path}`).join("\n") + "\n", maxBuffer: 2 ** 31 - 1 });
  let at = 0;
  for (const e of es) {
    const nl = r.stdout.indexOf(10, at); const head = r.stdout.subarray(at, nl).toString();
    if (head.endsWith("missing")) throw new Error(`missing ${repo} ${e.path}`);
    const size = Number(head.split(" ")[2]); const text = r.stdout.subarray(nl + 1, nl + 1 + size).toString("utf8"); at = nl + 2 + size;
    if (sha256Hex(text) !== e.sha256) throw new Error(`sha256 mismatch ${repo} ${e.path}`);
    docs[e.doc] = JSON.stringify({ doc: e.doc, text });
  }
}
writeFileSync(join(out!, "docs.jsonl"), docs.join("\n") + "\n");
// M37: train.py needs a validation split; the same deterministic per-file split as M9 (about 5%).
writeFileSync(join(out!, "manifest.jsonl"), entries.map((e) => JSON.stringify({ ...e, split: splitOf(e.repo, e.path) })).join("\n") + "\n");
console.log(`ext-fetch docs=${entries.length} repos=${byRepo.size}`);
