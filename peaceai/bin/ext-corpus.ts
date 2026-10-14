// M36: builds the external pretraining corpus and set C v2 from peaceai/model/ext-corpus.json. Runs on the box
// (it reads PeaceAI core to exclude core files by content and to scan the whole corpus for core text).
//   PEACEAI_EXT_DIR      clones of the external repos (<owner>__<name>)
//   PEACEAI_OWNER_CLONES full clones of PeaceSTOCKS and PeaceAI-Workspace (authorship filter needs history)
//   PEACEAI_CORE_DIR     PeaceAI core checkout
//   PEACEAI_LM_OUT       docs.jsonl + manifest.jsonl + summary.json (text never leaves this dir)
// --write: also writes the committed provenance manifest (peaceai/model/ext-manifest.jsonl) and set C v2
// (peaceai/model/heldout-c.json). Prints counts only.
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { indexGitTree } from "../lib/coreindex.ts";
import { addText, emptyIndex, findCoreText } from "../lib/coretext.ts";
import { buildSubstringIndex, countCoreSubstrings } from "../lib/substr.ts";
import { COREFREE_MIN_RUN } from "../lib/lm.ts";
import { classifyLicense, CODE_FILE, heldOutHashes } from "../lib/lmcorpus.ts";
import { agentMade, builderLogRefs, excludedForC, sha256Hex } from "../lib/heldout.ts";
import { EXT_C_RULE, EXT_MANIFEST_SCHEMA, EXT_REPO_CAP_BYTES, extCRepos, extFileExclusion, validExtConfig, type ExtExclusion, type ExtManifestEntry, type ExtRepo } from "../lib/extcorpus.ts";

const model = resolve(import.meta.dirname, "../model");
const cfg = JSON.parse(readFileSync(join(model, "ext-corpus.json"), "utf8"));
const bad = validExtConfig(cfg);
if (bad) throw new Error(`bad ext-corpus.json: ${bad}`);
const extDir = resolve(process.env.PEACEAI_EXT_DIR ?? "/workspace/ext");
const ownerDir = resolve(process.env.PEACEAI_OWNER_CLONES ?? "/tmp/fresh");
const coreDir = resolve(process.env.PEACEAI_CORE_DIR ?? "");
const out = resolve(process.env.PEACEAI_LM_OUT ?? "");
const write = process.argv.includes("--write");
mkdirSync(out, { recursive: true });

const git = (dir: string, ...a: string[]) => execFileSync("git", ["-C", dir, ...a], { encoding: "utf8", maxBuffer: 1 << 30 }).trim();
function readTree(dir: string, commit: string): { path: string; text: string }[] {
  const entries = git(dir, "ls-tree", "-r", "-z", commit).split("\0").filter(Boolean).map((l) => { const [m, p] = l.split("\t"); const [, t, s] = m!.split(" "); return { t, s: s!, p: p! }; }).filter((e) => e.t === "blob" && (CODE_FILE.test(e.p) || /(?:^|\/)(?:LICEN[CS]E|COPYING)(?:\.[a-z]+)?$/i.test(e.p)));
  const buf = spawnSync("git", ["-C", dir, "cat-file", "--batch"], { input: entries.map((e) => e.s).join("\n") + "\n", maxBuffer: 2 ** 31 - 1 }).stdout;
  const files: { path: string; text: string }[] = [];
  let at = 0;
  for (const e of entries) { const nl = buf.indexOf(10, at); const size = Number(buf.subarray(at, nl).toString().split(" ")[2]); files.push({ path: e.p, text: buf.subarray(nl + 1, nl + 1 + size).toString("utf8") }); at = nl + 2 + size; }
  return files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}
const licenseDirsOf = (files: { path: string }[]) => [...new Set(files.filter((f) => /(?:^|\/)(?:LICEN[CS]E|COPYING)(?:\.[a-z]+)?$/i.test(f.path) && f.path.includes("/")).map((f) => f.path.slice(0, f.path.lastIndexOf("/"))))];

// Exclusions by content: core files, held-out A/B (Peace commits; still never trained).
const tree = indexGitTree(coreDir, () => true, true);
if (!tree.raw?.length) throw new Error("no core checkout (fail closed)");
const coreShas = new Set(tree.raw.map((t) => sha256Hex(t)));
const coreSub = buildSubstringIndex(tree.raw, COREFREE_MIN_RUN);
const ab = heldOutHashes(JSON.parse(readFileSync(join(model, "heldout.json"), "utf8")));
const empty = emptyIndex();

const summary = { schema: "peaceai-ext-summary:v1", stage: cfg.stage, repos: [] as unknown[], refused: [] as unknown[], excluded: {} as Record<string, number>, train: { files: 0, bytes: 0 }, setC: { repos: 0, files: 0 }, memcheck: { scannedDocs: 0, droppedCoreText: 0, remainingHits: 0 } };
const byRepo: Record<string, Record<string, number>> = {};
let curRepo = "";
const bump = (w: ExtExclusion) => { summary.excluded[w] = (summary.excluded[w] ?? 0) + 1; const m = (byRepo[curRepo] ??= {}); m[w] = (m[w] ?? 0) + 1; };

// Verify every repo's license at its pinned commit; a mismatch refuses the whole repo.
const pool: ExtRepo[] = [];
for (const r of cfg.repos as ExtRepo[]) {
  const d = join(extDir, r.name.replace("/", "__"));
  let ok = false;
  try { const t = git(d, "show", `${r.commit}:${r.licenseFile}`); ok = classifyLicense(t) === r.spdx && sha256Hex(t) === r.licenseSha256; } catch { ok = false; }
  if (ok) pool.push(r); else summary.refused.push({ name: r.name, reason: "license-or-pin" });
}
const cNames = new Set(extCRepos(pool.map((r) => r.name)));

// Set C v2 first: every passing file of a held-out repo, by content.
const cEntries: { repo: string; sha: string; spdx: string; contentSha256: string[] }[] = [];
const cHashes = new Set<string>();
for (const r of pool.filter((p) => cNames.has(p.name))) {
  const files = readTree(join(extDir, r.name.replace("/", "__")), r.commit);
  const ld = licenseDirsOf(files);
  const hs = new Set<string>();
  for (const f of files) if (!extFileExclusion(f.path, f.text, ld)) hs.add(sha256Hex(f.text));
  for (const h of hs) cHashes.add(h);
  cEntries.push({ repo: r.name, sha: r.commit, spdx: r.spdx, contentSha256: [...hs].sort() });
  summary.setC.repos += 1; summary.setC.files += hs.size;
}

const seen = new Set<string>();
const docs: string[] = [];
const manifest: ExtManifestEntry[] = [];
function admit(repo: string, commit: string, license: string, origin: ExtManifestEntry["origin"], files: { path: string; text: string }[], keep: (p: string, t: string) => ExtExclusion | null) {
  let bytes = 0, used = 0;
  curRepo = repo;
  for (const f of files) {
    const sha256 = sha256Hex(f.text);
    let why: ExtExclusion | null = keep(f.path, f.text);
    if (!why && coreShas.has(sha256)) why = "core";
    if (!why && (ab.has(sha256) || cHashes.has(sha256))) why = "held-out";
    if (!why && seen.has(sha256)) why = "duplicate";
    const n = Buffer.byteLength(f.text);
    if (!why && bytes + n > EXT_REPO_CAP_BYTES) why = "repo-cap";
    if (!why) {
      // Whole-corpus memcheck: no core line/shingle and no 64+ character run of core text, or the file is dropped.
      summary.memcheck.scannedDocs += 1;
      const hits = findCoreText(f.text.split("\n"), tree.text, empty);
      if (hits.lineHits + hits.shingleHits + countCoreSubstrings(f.text, coreSub) > 0) why = "core-text";
    }
    if (why) { bump(why); if (why === "core-text") summary.memcheck.droppedCoreText += 1; continue; }
    seen.add(sha256);
    const e: ExtManifestEntry = { doc: manifest.length, stage: cfg.stage, repo, commit, license, path: f.path, sha256, bytes: n, origin };
    manifest.push(e); docs.push(JSON.stringify({ doc: e.doc, text: f.text }));
    bytes += n; used += 1;
  }
  summary.train.files += used; summary.train.bytes += bytes;
  summary.repos.push({ name: repo, commit, license, origin, files: used, bytes, excluded: byRepo[repo] ?? {} });
}

// Peace's public code under the authorship filter: a file is used only when every commit that touched it is
// Peace's own (not agent-made, not in heldout-c-excluded.json, not in the unknown-authorship window).
const refs = builderLogRefs(git(join(ownerDir, "PeaceAI-Workspace"), "show", `${cfg.owner.find((o: any) => o.name === "PeaceG03/PeaceAI-Workspace").commit}:builder-log/tasks.jsonl`));
const excluded = JSON.parse(readFileSync(join(model, "heldout-c-excluded.json"), "utf8")).commits;
for (const o of cfg.owner) {
  const d = join(ownerDir, o.name.split("/")[1]);
  const touched = new Map<string, boolean>();
  let cur = true;
  for (const line of git(d, "log", "--no-renames", "--name-only", "--format=%x01%H%x00%cI%x00%s", o.commit).split("\n")) {
    if (line.startsWith("\x01")) { const [sha, at, subj] = line.slice(1).split("\0"); cur = !agentMade(o.name, sha!, at!, subj!, refs) && !excludedForC(o.name, sha!, at!, excluded); }
    else if (line) touched.set(line, (touched.get(line) ?? true) && cur);
  }
  const files = readTree(d, o.commit);
  const ld = licenseDirsOf(files);
  admit(o.name, o.commit, o.license, "owner-public", files, (p, t) => (touched.get(p) === false ? "authorship" : extFileExclusion(p, t, ld)));
}
for (const r of pool.filter((p) => !cNames.has(p.name))) {
  const files = readTree(join(extDir, r.name.replace("/", "__")), r.commit);
  const ld = licenseDirsOf(files);
  admit(r.name, r.commit, r.spdx, "external", files, (p, t) => extFileExclusion(p, t, ld));
}

const manifestText = manifest.map((m) => JSON.stringify(m)).join("\n") + "\n";
writeFileSync(join(out, "docs.jsonl"), docs.join("\n") + "\n");
writeFileSync(join(out, "manifest.jsonl"), manifestText);
writeFileSync(join(out, "summary.json"), JSON.stringify(summary, null, 2) + "\n");
if (write) {
  writeFileSync(join(model, "ext-manifest.jsonl"), JSON.stringify({ schema: EXT_MANIFEST_SCHEMA, config: sha256Hex(readFileSync(join(model, "ext-corpus.json"))), entries: manifest.length }) + "\n" + manifestText);
  writeFileSync(join(model, "heldout-c.json"), JSON.stringify({ schema: "peaceai-heldout-c:v2", rule: EXT_C_RULE, wiredAsEval: false, sets: { C: cEntries } }, null, 1) + "\n");
}
console.log(`ext corpus stage=${cfg.stage} repos=${pool.length} refused=${summary.refused.length} train_files=${summary.train.files} train_bytes=${summary.train.bytes} setC_repos=${summary.setC.repos} setC_files=${summary.setC.files} memcheck_scanned=${summary.memcheck.scannedDocs} memcheck_dropped=${summary.memcheck.droppedCoreText} excluded=${JSON.stringify(summary.excluded)}`);
