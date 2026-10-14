// M36: rebuilds the external pretraining docs from the committed provenance manifest on a public runner (no core
// access needed: every file was already core-checked on the box). Fetches each repo at its pinned commit and keeps a
// file only when its sha256 matches the manifest; any mismatch or missing file fails the whole build (exit 1).
//   ext-fetch.ts <workdir> <outdir>   writes <outdir>/docs.jsonl and <outdir>/manifest.jsonl
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { sha256Hex } from "../lib/heldout.ts";
import { EXT_MANIFEST_SCHEMA, type ExtManifestEntry } from "../lib/extcorpus.ts";

const [work, out] = process.argv.slice(2).map((p) => resolve(p));
const lines = readFileSync(resolve(import.meta.dirname, "../model/ext-manifest.jsonl"), "utf8").split("\n").filter(Boolean);
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
writeFileSync(join(out!, "manifest.jsonl"), lines.slice(1).join("\n") + "\n");
console.log(`ext-fetch docs=${entries.length} repos=${byRepo.size}`);
