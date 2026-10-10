// M9: builds the training corpus and its license manifest from peaceai/model/sources.json.
// Runs on the box (private): it reads PeaceAI core. Writes into PEACEAI_LM_OUT only:
//   docs.jsonl     {"doc", "text"} per used file
//   manifest.jsonl ManifestEntry per used file (source, commit, path, sha256, license, split)
//   summary.json   counts by source, license, split, exclusion reason (no paths, no text)
// Prints counts only.
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { classifyLicense, fileExclusion, splitOf, type ManifestEntry } from "../lib/lmcorpus.ts";

const out = resolve(process.env.PEACEAI_LM_OUT ?? "");
const permissiveRoot = resolve(process.env.PEACEAI_LM_PERMISSIVE_DIR ?? "/workspace/lm-corpus");
const ownerDirs: Record<string, string> = JSON.parse(process.env.PEACEAI_LM_OWNER_DIRS ?? "{}");
const sources = JSON.parse(readFileSync(resolve(import.meta.dirname, "../model/sources.json"), "utf8"));
mkdirSync(out, { recursive: true });

const git = (dir: string, ...a: string[]) => execFileSync("git", ["-C", dir, ...a], { encoding: "utf8", maxBuffer: 1 << 28 }).trim();

function readTree(dir: string, commit: string): { path: string; text: string }[] {
  const entries = git(dir, "ls-tree", "-r", "-z", commit).split("\0").filter(Boolean).map((l) => {
    const [meta, path] = l.split("\t");
    const [, type, sha] = meta!.split(" ");
    return { type, sha: sha!, path: path! };
  }).filter((e) => e.type === "blob");
  const r = spawnSync("git", ["-C", dir, "cat-file", "--batch"], { input: entries.map((e) => e.sha).join("\n") + "\n", maxBuffer: 1 << 30 });
  const buf = r.stdout;
  const files: { path: string; text: string }[] = [];
  let at = 0;
  for (const e of entries) {
    const nl = buf.indexOf(10, at);
    const size = Number(buf.subarray(at, nl).toString().split(" ")[2]);
    files.push({ path: e.path, text: buf.subarray(nl + 1, nl + 1 + size).toString("utf8") });
    at = nl + 1 + size + 1;
  }
  return files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

const docs: string[] = [];
const manifest: ManifestEntry[] = [];
const summary = { schema: "peaceai-lm-corpus:v1", sources: [] as unknown[], refusedSources: [] as unknown[], totals: { files: 0, bytes: 0, train: 0, heldout: 0 }, byLicense: {} as Record<string, { files: number; bytes: number }> };

function addSource(name: string, dir: string, commit: string, visibility: "private" | "public", license: string, owner: boolean) {
  const files = readTree(dir, commit);
  const licenseDirs = owner ? [] : [...new Set(files.filter((f) => /(?:^|\/)(?:LICEN[CS]E|COPYING)(?:\.[a-z]+)?$/i.test(f.path) && f.path.includes("/")).map((f) => f.path.slice(0, f.path.lastIndexOf("/"))))];
  const excluded: Record<string, number> = {};
  let used = 0, bytes = 0;
  for (const f of files) {
    const why = fileExclusion(f.path, f.text, licenseDirs, owner);
    if (why) { excluded[why] = (excluded[why] ?? 0) + 1; continue; }
    const split = splitOf(name, f.path);
    const entry: ManifestEntry = { doc: manifest.length, source: name, visibility, commit, path: f.path, sha256: createHash("sha256").update(f.text).digest("hex"), bytes: Buffer.byteLength(f.text), license, split };
    manifest.push(entry);
    docs.push(JSON.stringify({ doc: entry.doc, text: f.text }));
    used += 1; bytes += entry.bytes;
    summary.totals[split] += 1;
    const l = (summary.byLicense[license] ??= { files: 0, bytes: 0 });
    l.files += 1; l.bytes += entry.bytes;
  }
  summary.totals.files += used; summary.totals.bytes += bytes;
  summary.sources.push({ name, visibility, commit, license, files: used, bytes, excluded });
}

for (const o of sources.owner) {
  const dir = ownerDirs[o.name];
  if (!dir) throw new Error(`no checkout for ${o.name}`);
  addSource(o.name, dir, git(dir, "rev-parse", o.ref), o.visibility, o.license, true);
}
for (const p of sources.permissive) {
  const dir = join(permissiveRoot, p.name.replace("/", "__"));
  const head = git(dir, "rev-parse", "HEAD");
  const licFile = git(dir, "ls-tree", "--name-only", p.commit).split("\n").find((n) => /^(?:LICEN[CS]E|COPYING)(?:\.[a-z]+)?$/i.test(n));
  const spdx = licFile ? classifyLicense(git(dir, "show", `${p.commit}:${licFile}`)) : null;
  if (head !== p.commit || spdx !== p.spdx) { summary.refusedSources.push({ name: p.name, expected: p.spdx, found: spdx, pinned: head === p.commit }); continue; }
  addSource(p.name, dir, p.commit, "public", p.spdx, false);
}
writeFileSync(join(out, "docs.jsonl"), docs.join("\n") + "\n");
writeFileSync(join(out, "manifest.jsonl"), manifest.map((m) => JSON.stringify(m)).join("\n") + "\n");
writeFileSync(join(out, "summary.json"), JSON.stringify(summary, null, 2) + "\n");
console.log(`corpus files=${summary.totals.files} bytes=${summary.totals.bytes} train=${summary.totals.train} heldout=${summary.totals.heldout} refused_sources=${summary.refusedSources.length}`);
