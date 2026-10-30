// M147: build the English-to-code pair corpus (box only; see peaceai/lib/nlpairs.ts and peaceai/spec/nl-pairs-v1.md).
//   nl-pairs.ts --exclusions <file> --src <clone dir> --out <dir> [--only <committed manifest dir>]
//     Writes <out>/docs.jsonl + <out>/manifest.jsonl (fine-tune corpus format, input of ft_prepare.py) and
//     <out>/build-report.json (counts and codes only, plus the exclusion file's sha256). --only keeps exactly the
//     docs whose text sha256 the committed manifest lists (a rebuild; refuses when the exclusion sha differs).
//   nl-pairs.ts --write-manifest <final dir> --report-dir <work>
//     After ft_prepare.py and eval_dedup.py: writes the committed peaceai/model/nl-pairs-manifest/ (sha256s only)
//     and peaceai/model/nl-pairs-summary.json (counts only).
// Refuses without the exclusion file. Prints counts and fixed codes only: no text, no stderr, no URLs.
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathLeakKinds } from "../lib/extcorpus.ts";
import { readManifestBytes, writeParts } from "../lib/manifestparts.ts";
import {
  CHORE_SUBJECT, NL_KINDS, NL_MANIFEST_SCHEMA, cleanPatch, configProblems, diffFileProblem, extFileExclusionFor, ghCause, isExcludedRepo,
  forkHits, jsdocFunctions, licenseDirsOf, licenseProblem, mentionsExcluded, namesHashedRepo, pairText, parseExclusions, scrubCode, scrubEnglish, selectCapped, sha256,
  type Candidate, type NlConfig, type NlKind, type RepoMeta,
} from "../lib/nlpairs.ts";

const MODEL = new URL("../model/", import.meta.url).pathname;
const refuse = (code: string): never => { console.log(`nl-pairs refused: ${code}`); process.exit(1); };
const argv = process.argv.slice(2);
const opt = (k: string): string | null => { const i = argv.indexOf(k); if (i < 0) return null; const v = argv[i + 1]; if (!v || v.startsWith("--")) refuse(`arg_${k.slice(2)}`); argv.splice(i, 2); return v!; };

const writeDir = opt("--write-manifest");
if (writeDir !== null) { writeManifest(writeDir, opt("--report-dir") ?? refuse("arg_report-dir")); process.exit(0); }

const exPath = opt("--exclusions"), src = opt("--src"), out = opt("--out"), only = opt("--only");
if (exPath === null) refuse("exclusions_missing");
const exBuf = existsSync(exPath!) ? readFileSync(exPath!) : null;
const ex = parseExclusions(exBuf);
if ("code" in ex) refuse(ex.code);
if (!("repos" in ex)) throw new Error("unreachable");
if (src === null || out === null || argv.length) refuse("usage");
const cfgBuf = readFileSync(join(MODEL, "nl-pairs.json"));
const cfg = JSON.parse(cfgBuf.toString("utf8")) as NlConfig;
const setC = JSON.parse(readFileSync(join(MODEL, "heldout-c.json"), "utf8")).sets.C.map((e: { repo: string }) => e.repo) as string[];
const retrain = JSON.parse(readFileSync(join(MODEL, "lm-retrain.json"), "utf8"));
const probs = configProblems(cfg, setC, retrain.replay.trainMaxBytes);
if (probs.length) refuse(probs.join(","));
const hits = cfg.repos.filter((r) => isExcludedRepo(r.name, ex)).length;
if (hits) refuse(`config_repo_excluded count=${hits}`); // count only: the hidden list's entries are never named
// forks and mirrors: one repos/{owner}/{repo} call per pinned repo; the parent and source names stay in memory only and
// are never printed or written (a hit is a count). Any failure fails closed.
{
  const metas: RepoMeta[] = [];
  for (const r of cfg.repos) {
    const m = spawnSync("gh", ["api", "-X", "GET", `repos/${r.name}`, "--jq", "{fork: .fork, parent: (.parent.full_name // null), source: (.source.full_name // null)}"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    if (m.status !== 0) refuse(`repo_meta_${ghCause(m.stderr ?? "").code}`);
    try { const j = JSON.parse(m.stdout); metas.push({ fork: j.fork === true, parent: typeof j.parent === "string" ? j.parent : null, source: typeof j.source === "string" ? j.source : null }); }
    catch { refuse("repo_meta_bad_json"); }
  }
  const fh = forkHits(metas, ex);
  if (fh) refuse(`config_repo_excluded count=${fh}`);
  console.log(`nl-pairs repo meta checked repos=${metas.length} forks=${metas.filter((m) => m.fork).length}`);
}
let onlySet: Set<string> | null = null;
if (only !== null) {
  const lines = readManifestBytes(only, "nl-pairs-manifest").toString("utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  if (lines[0]?.schema !== NL_MANIFEST_SCHEMA) refuse("only_manifest_schema");
  if (lines[0].exclusionsSha256 !== ex.fileSha256) refuse("only_exclusions_sha_differs");
  onlySet = new Set(lines.slice(1).map((e: { textSha256: string }) => e.textSha256));
}

const git = (d: string, ...a: string[]) => execFileSync("git", ["-C", d, ...a], { encoding: "utf8", maxBuffer: 1 << 30, stdio: ["ignore", "pipe", "ignore"] });
const gitBuf = (d: string, ...a: string[]): Buffer | null => { const r = spawnSync("git", ["-C", d, ...a], { maxBuffer: 1 << 30, stdio: ["ignore", "pipe", "ignore"] }); return r.status === 0 ? r.stdout : null; };
const drops: Record<string, number> = {}; const drop = (c: string) => { drops[c] = (drops[c] ?? 0) + 1; };
let ghCalls = 0, rateLimited = false;
const ghJson = (path: string, jq: string): unknown[] | null => {
  if (rateLimited) { drop("gh_not_called_after_rate_limit"); return null; }
  ghCalls++;
  const r = spawnSync("gh", ["api", "-X", "GET", path, "--jq", jq], { encoding: "utf8", maxBuffer: 1 << 28, stdio: ["ignore", "pipe", "pipe"] });
  if (r.status !== 0) { const c = ghCause(r.stderr ?? ""); if (c.rateLimited) rateLimited = true; drop(c.code); return null; }
  try { return JSON.parse(r.stdout) as unknown[]; } catch { drop("gh_bad_json"); return null; }
};

const cands: Candidate[] = [];
const repoStats: Record<string, Record<string, number>> = {};
mkdirSync(src!, { recursive: true });
for (const r of cfg.repos) {
  const dir = join(src!, r.name.replace("/", "__"));
  if (!existsSync(dir)) { const c = spawnSync("git", ["clone", "--quiet", "--single-branch", `https://github.com/${r.name}.git`, dir], { stdio: "ignore" }); if (c.status !== 0) refuse(`clone_failed ${r.name}`); }
  if (spawnSync("git", ["-C", dir, "cat-file", "-e", `${r.commit}^{commit}`], { stdio: "ignore" }).status !== 0) {
    spawnSync("git", ["-C", dir, "fetch", "--quiet", "origin"], { stdio: "ignore" });
    if (spawnSync("git", ["-C", dir, "cat-file", "-e", `${r.commit}^{commit}`], { stdio: "ignore" }).status !== 0) refuse(`pinned_commit_missing ${r.name}`);
  }
  const lp = licenseProblem(gitBuf(dir, "show", `${r.commit}:${r.licenseFile}`), r);
  if (lp) refuse(`${lp} ${r.name}`);
  const tree = git(dir, "ls-tree", "-r", "--name-only", r.commit).split("\n").filter(Boolean);
  const ld = licenseDirsOf(tree);
  const firstParent = new Set(git(dir, "rev-list", "--first-parent", r.commit).split("\n").filter(Boolean));
  const st: Record<string, number> = (repoStats[r.name] = {});
  const diffOf = (base: string, head: string): { code: string; path: string } | string => {
    const raw = gitBuf(dir, "diff", "--no-color", "--no-ext-diff", "-M", "-U3", base, head);
    if (raw === null) return "diff_failed";
    const files = raw.toString("utf8").split(/^(?=diff --git )/m).filter((x) => x.startsWith("diff --git "));
    const keep: { path: string; patch: string }[] = [];
    for (const f of files) {
      if (/^Binary files /m.test(f) || /^GIT binary patch/m.test(f)) continue;
      const path = /^\+\+\+ b\/(.+)$/m.exec(f)?.[1] ?? /^--- a\/(.+)$/m.exec(f)?.[1];
      if (!path) continue;
      const p = diffFileProblem({ path, status: "", patch: f });
      if (p === "not_code") continue;
      if (p) return p;
      if (ld.some((d) => path.startsWith(d + "/"))) return "file_nested_license";
      keep.push({ path, patch: cleanPatch(f) });
    }
    if (!keep.length) return "no_code_files";
    if (keep.length > cfg.caps.maxDiffFiles) return "diff_too_many_files";
    const code = keep.map((k) => k.patch).join("");
    if (Buffer.byteLength(code) > cfg.caps.maxDiffBytes) return "diff_too_large";
    return { code, path: [...keep.map((k) => k.path)].sort()[0]! };
  };
  const addDiffPair = (kind: "pr" | "commit", sha: string, base: string, ref: string, englishRaw: string) => {
    const d = diffOf(base, sha);
    if (typeof d === "string") { drop(d); return; }
    if (mentionsExcluded(englishRaw + "\n" + d.code, ex)) { drop("mentions_excluded_repo"); return; }
    if (namesHashedRepo(englishRaw + "\n" + d.code, ex)) { drop("hidden_name_drop"); return; }
    let english = scrubEnglish(englishRaw);
    if (english === null) { drop("english_leak"); return; }
    if (english.length < cfg.caps.minPromptChars) { drop("english_short"); return; }
    if (english.length > cfg.caps.maxPromptChars) english = english.slice(0, cfg.caps.maxPromptChars).replace(/\s+\S*$/, "") + " ...";
    const code = scrubCode(d.code);
    if (code === null) { drop("code_leak"); return; }
    if (pathLeakKinds(d.path).length) { drop("path_leak"); return; }
    cands.push({ kind, repo: r.name, sha, ref, path: d.path, english, code, text: pairText(kind, english, code), diffKey: sha256(code.replace(/\s+/g, " ")) });
    st[kind] = (st[kind] ?? 0) + 1;
  };
  // pr: merged PRs whose merge commit is on the pinned head's first-parent line
  const prMerge = new Set<string>();
  for (let page = 1; page <= cfg.caps.maxPrPages; page++) {
    const rows = ghJson(`repos/${r.name}/pulls?state=closed&sort=created&direction=desc&per_page=100&page=${page}`, "[.[] | select(.merged_at != null) | {n: .number, t: .title, b: (.body // \"\"), m: .merge_commit_sha}]") as { n: number; t: string; b: string; m: string }[] | null;
    if (rows === null) break;
    for (const p of rows) {
      if (!p.m || !firstParent.has(p.m)) { drop("pr_merge_not_on_pinned_line"); continue; }
      prMerge.add(p.m);
      const parents = git(dir, "show", "-s", "--format=%P", p.m).trim().split(" ").filter(Boolean);
      if (parents.length < 1 || parents.length > 2) { drop("pr_parents"); continue; }
      addDiffPair("pr", p.m, parents[0]!, `#${p.n}`, `${p.t}\n\n${p.b.slice(0, cfg.caps.maxBodyChars)}`);
    }
    if (rows.length === 0) break;
  }
  if (rateLimited) refuse("gh_rate_limited"); // M8: stop calling and fail closed
  // commit: non-merge commits reachable from the pinned head, newest first, that are not a PR's merge commit
  for (const sha of git(dir, "rev-list", "--no-merges", `--max-count=${cfg.caps.maxCommits}`, r.commit).split("\n").filter(Boolean)) {
    if (prMerge.has(sha)) { drop("commit_is_pr_merge"); continue; }
    const msg = git(dir, "show", "-s", "--format=%B", sha).trim();
    const subject = msg.split("\n")[0] ?? "";
    if (CHORE_SUBJECT.test(subject)) { drop("commit_chore"); continue; }
    const parents = git(dir, "show", "-s", "--format=%P", sha).trim().split(" ").filter(Boolean);
    if (parents.length !== 1) { drop("commit_parents"); continue; }
    addDiffPair("commit", sha, parents[0]!, sha.slice(0, 12), msg.replace(/\s*\(#\d+\)\s*$/m, ""));
  }
  // jsdoc: documented functions at the pinned head
  for (const path of tree) {
    if (!/\.(?:ts|tsx|mts|cts)$/.test(path) || path.endsWith(".d.ts") || /(?:\.test\.|\.spec\.|(?:^|\/)(?:test|tests|__tests__|examples?|docs?|website|benchmarks?)\/)/.test(path)) continue;
    if (ld.some((d) => path.startsWith(d + "/"))) { drop("file_nested_license"); continue; }
    const buf = gitBuf(dir, "show", `${r.commit}:${path}`);
    if (buf === null) continue;
    const text = buf.toString("utf8");
    const why = extFileExclusionFor(path, text, ld);
    if (why) { drop(`file_${why}`); continue; }
    if (pathLeakKinds(path).length) { drop("path_leak"); continue; }
    for (const f of jsdocFunctions(path, text, 30, 4000)) {
      if (mentionsExcluded(f.span, ex)) { drop("mentions_excluded_repo"); continue; }
      if (namesHashedRepo(f.span, ex)) { drop("hidden_name_drop"); continue; }
      const code = scrubCode(f.span);
      if (code === null) { drop("code_leak"); continue; }
      cands.push({ kind: "jsdoc", repo: r.name, sha: r.commit, ref: `${path}#${f.name}`, path, english: f.doc, code, text: pairText("jsdoc", "", code) });
      st.jsdoc = (st.jsdoc ?? 0) + 1;
    }
  }
}
// exact duplicates: one doc per diff (a PR's diff first, then commits) and per text
const seenDiff = new Set<string>(), seenText = new Set<string>();
const order: Record<NlKind, number> = { pr: 0, commit: 1, jsdoc: 2 };
const uniq = [...cands].sort((a, b) => order[a.kind] - order[b.kind]).filter((c) => {
  if (c.diffKey) { if (seenDiff.has(c.diffKey)) { drop("dup_diff"); return false; } seenDiff.add(c.diffKey); }
  const t = sha256(c.text); if (seenText.has(t)) { drop("dup_text"); return false; } seenText.add(t); return true;
});
let chosen: Candidate[];
if (onlySet) { chosen = uniq.filter((c) => onlySet!.has(sha256(c.text))); drops.only_missing = onlySet.size - chosen.length; }
else { const s = selectCapped(uniq, cfg.repos.map((r) => r.name), cfg.caps, cfg.salt); chosen = s.kept; for (const [k, v] of Object.entries(s.dropped)) drops[k] = (drops[k] ?? 0) + v; }
chosen.sort((a, b) => (a.repo < b.repo ? -1 : a.repo > b.repo ? 1 : order[a.kind] - order[b.kind] || (a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : 0)));
rmSync(out!, { recursive: true, force: true }); mkdirSync(out!, { recursive: true });
const lic = new Map(cfg.repos.map((r) => [r.name, r.spdx]));
writeFileSync(join(out!, "docs.jsonl"), chosen.map((c, i) => JSON.stringify({ doc: i, text: c.text }) + "\n").join(""));
writeFileSync(join(out!, "manifest.jsonl"), chosen.map((c, i) => JSON.stringify({ doc: i, split: "train", repo: c.repo, sha: c.sha, path: c.path, function: c.kind === "jsdoc" ? c.ref.slice(c.ref.lastIndexOf("#") + 1) : `${c.kind}:${c.ref}`, kind: c.kind, ref: c.ref, license: lic.get(c.repo), englishSha256: sha256(c.english), codeSha256: sha256(c.code) }) + "\n").join(""));
const byKind = Object.fromEntries(NL_KINDS.map((k) => [k, { pairs: chosen.filter((c) => c.kind === k).length, bytes: chosen.filter((c) => c.kind === k).reduce((s, c) => s + Buffer.byteLength(c.text), 0) }]));
const rep = { schema: "peaceai-nl-pairs-build:v1", configSha256: sha256(cfgBuf), exclusionsSha256: ex.fileSha256, exclusionFileEntries: ex.fileEntries, exclusionFileHashes: ex.hashes.size, ghCalls, repoMetaCalls: cfg.repos.length,
  candidates: cands.length, kept: chosen.length, byKind, candidatesByRepo: repoStats, drops: Object.fromEntries(Object.entries(drops).sort()) };
writeFileSync(join(out!, "build-report.json"), JSON.stringify(rep, null, 1) + "\n");
console.log(`hidden_name_drop count=${drops.hidden_name_drop ?? 0}`);
console.log(`nl-pairs built candidates=${cands.length} kept=${chosen.length} ${NL_KINDS.map((k) => `${k}=${byKind[k]!.pairs}`).join(" ")} ghCalls=${ghCalls} drops=${Object.entries(drops).sort().map(([k, v]) => `${k}:${v}`).join(",")}`);

function writeManifest(finalDir: string, workDir: string): void {
  const docs = readFileSync(join(finalDir, "docs.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as { doc: number; text: string });
  const man = readFileSync(join(finalDir, "manifest.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const text = new Map(docs.map((d) => [d.doc, d.text]));
  if (text.size !== man.length || man.some((m) => !text.has(m.doc))) refuse("final_docs_manifest_differ");
  const build = JSON.parse(readFileSync(join(workDir, "nl-pairs", "build-report.json"), "utf8"));
  const prep = JSON.parse(readFileSync(join(workDir, "nl-prepare.json"), "utf8"));
  const dd = JSON.parse(readFileSync(join(workDir, "nl-dedup.json"), "utf8"));
  const cfgB = readFileSync(join(MODEL, "nl-pairs.json"));
  if (build.configSha256 !== sha256(cfgB)) refuse("config_changed_since_build");
  const head = { schema: NL_MANIFEST_SCHEMA, configSha256: build.configSha256, exclusionsSha256: build.exclusionsSha256, entries: man.length };
  const lines = [JSON.stringify(head), ...man.map((m) => JSON.stringify({ doc: m.doc, kind: m.kind, split: m.split, repo: m.repo, sha: m.sha, ref: m.ref, path: m.path, license: m.license,
    textSha256: sha256(text.get(m.doc)!), bytes: Buffer.byteLength(text.get(m.doc)!), englishSha256: m.englishSha256, codeSha256: m.codeSha256 }))];
  const buf = Buffer.from(lines.join("\n") + "\n");
  rmSync(join(MODEL, "nl-pairs-manifest"), { recursive: true, force: true });
  const ix = writeParts(MODEL, "nl-pairs-manifest", buf);
  const count = (f: (m: any) => boolean) => man.filter(f).length;
  const bytes = (f: (m: any) => boolean) => man.filter(f).reduce((s, m) => s + Buffer.byteLength(text.get(m.doc)!), 0);
  const sum = { schema: "peaceai-nl-pairs-summary:v1", manifestSha256: ix.combinedSha256, configSha256: build.configSha256, exclusionsSha256: build.exclusionsSha256,
    pairs: man.length, bytes: bytes(() => true),
    byKind: Object.fromEntries(NL_KINDS.map((k) => [k, { pairs: count((m) => m.kind === k), bytes: bytes((m) => m.kind === k), train: count((m) => m.kind === k && m.split === "train"), heldout: count((m) => m.kind === k && m.split === "heldout") }])),
    byRepo: Object.fromEntries([...new Set(man.map((m) => m.repo as string))].sort().map((r) => [r, { license: man.find((m) => m.repo === r).license, ...Object.fromEntries(NL_KINDS.map((k) => [k, count((m) => m.repo === r && m.kind === k)])) }])),
    build: { candidates: build.candidates, kept: build.kept, ghCalls: build.ghCalls, repoMetaCalls: build.repoMetaCalls, exclusionFileEntries: build.exclusionFileEntries, exclusionFileHashes: build.exclusionFileHashes, drops: build.drops },
    ftPrepare: Object.fromEntries(["docsIn", "olderVersionsDropped", "heldoutSharedLineDropped", "docsOut", "train", "heldout"].map((k) => [k, prep[k]])),
    evalDedup: Object.fromEntries(Object.entries(dd).filter(([k, v]) => typeof v === "number" || (v && typeof v === "object" && !Array.isArray(v) && Object.values(v).every((x) => typeof x === "number")))) };
  writeFileSync(join(MODEL, "nl-pairs-summary.json"), JSON.stringify(sum, null, 1) + "\n");
  console.log(`nl-pairs manifest entries=${man.length} ${NL_KINDS.map((k) => `${k}=${sum.byKind[k]!.pairs}`).join(" ")} bytes=${sum.bytes}`);
}
