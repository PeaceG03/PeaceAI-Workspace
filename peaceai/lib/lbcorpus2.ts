// lb-corpus v2 (chain 2 of the limit-breaker daily cycle): the chain-1 cleaned corpus VERBATIM (so the held-out split
// of days 1-3 is byte-identical and bpb stays comparable) plus new owner content from PeaceAI-Workspace main that is
// attributable to Auditor-PASSed pull requests only. Pure logic; peaceai/bin/lb-corpus2.ts does the git and file I/O.
// It extends lb-clean instead of a second framework: every new file goes through lbclean.ts clean() unchanged (junk,
// task-set, split, dedup, --drop-hashes, difficulty, FIM) with the committed lb-clean.json config; this module adds only
//   - the source rule (sourceProblem / attributable): which tree files are admitted, by path, text and git history;
//   - the new held-out slice (sliceOf): a per-file sha256 split, labelled heldout_v2 (train.py reads split == "heldout"
//     only, so the export eval stream of days 1-3 is unchanged);
//   - a cross-corpus dedup of every new piece against every chain-1 doc (exact normalised key, then NearIndex);
//   - the non-overlap check (overlapProblems): no new train text equals or near-duplicates an old held-out doc or a
//     heldout_v2 doc, and no chain-1 train doc does either with a heldout_v2 doc (by text sha256, normalised key and
//     shingle Jaccard), a hard post-condition of every build;
//   - the v2 fingerprint over the code, config, sources file, base pins, refs, drop files and output.
// Spec: peaceai/spec/lb-corpus2-v1.md. Counts and codes only; no text is ever printed.
import { clean, NearIndex, normKey, sha256, shingles, tokens, JUNK_PATH, type InDoc, type LbConfig, type TasksetRefs } from "./lbclean.ts";
import type { Exclusions } from "./nlpairs.ts";

/** Bump on any change to a rule or an output field: it is part of the fingerprint. */
export const LB_CORPUS2_VERSION = "peaceai-lb-corpus2:v1";
export const SOURCES_SCHEMA = "peaceai-lb-corpus2-sources:v1";
export const FINGERPRINT2_SCHEMA = "peaceai-lb-corpus2-fingerprint:v1";
export const HELDOUT2 = "heldout_v2";

// ---- source rule
/** Text and code files only (what lb-clean's splitter and tokenizer are for); no data, config or lock files. */
export const SOURCE_EXT = /\.(?:ts|mts|cts|js|mjs|cjs|py|sh|md)$/i;
/** Paths that are never admitted, whatever their history: test fixtures (copies or lockfiles of third-party
 * projects, or shapes modelled on tasks), workflows, and anything whose name is about held-out, hidden, Results,
 * task-set, exclusion or drop data. */
export const SOURCE_DENY: readonly { code: string; re: RegExp }[] = [
  { code: "src_fixture", re: /(?:^|\/)fixtures?\// }, // c2-guard:deny-fixture
  { code: "src_workflow", re: /^\.github\// }, // c2-guard:deny-workflow
  { code: "src_eval_adjacent", re: /hidden|held-?out|results|taskset|tasks-|exclusion|drop-hash|nl-pairs|verdict/i }, // c2-guard:deny-eval
];
/** Why a tree file is not admitted (a fixed code), or null. `text` is the blob as UTF-8. */
export function sourceProblem(path: string, text: string): string | null {
  if (!SOURCE_EXT.test(path)) return "src_not_code_or_text"; // c2-guard:src-ext
  if (JUNK_PATH.some((r) => r.test(path))) return "src_junk_path"; // c2-guard:src-junk
  for (const d of SOURCE_DENY) if (d.re.test(path)) return d.code; // c2-guard:src-deny
  // a 40-64 hex run is a commit, blob or content hash: pinned data, possibly of evaluation material (conservative)
  if (/(?<![0-9a-f])[0-9a-f]{40,64}(?![0-9a-f])/i.test(text)) return "src_hash_literal"; // c2-guard:src-hex
  if (text.includes("\uFFFD") || text.includes("\u0000")) return "src_not_utf8_text"; // c2-guard:src-utf8
  return null;
}
/** A path is attributable when it has history and EVERY commit that touched it is one of the passed squash merges. */
export function attributable(commits: readonly string[], passed: ReadonlySet<string>): boolean {
  if (commits.length === 0) return false; // c2-guard:attr-empty
  return commits.every((c) => passed.has(c)); // c2-guard:attr-every
}

export interface PassedPr { pr: number; mergeCommit: string; passedHead: string; evidence: string }
export interface Sources {
  schema: string; repo: string; tip: string; license: string; rule: string;
  passed: PassedPr[];
  base: { docs: string; manifest: string; fingerprint: string; builtAt: string };
  slice: { salt: string; rate: number };
  files: { path: string; blob: string; prs: number[] }[];
}
/** Problems with a sources file as fixed codes (empty = ok). */
export function sourcesProblems(s: any): string[] {
  const p: string[] = [];
  const hex = (v: unknown, n: number) => typeof v === "string" && new RegExp(`^[0-9a-f]{${n}}$`).test(v);
  if (s?.schema !== SOURCES_SCHEMA) p.push("sources_schema");
  if (s?.repo !== "PeaceG03/PeaceAI-Workspace" || !hex(s?.tip, 40) || s?.license !== "owner:PeaceG03" || typeof s?.rule !== "string") p.push("sources_head");
  if (!Array.isArray(s?.passed) || !s.passed.length || !s.passed.every((x: any) => Number.isInteger(x?.pr) && hex(x?.mergeCommit, 40) && hex(x?.passedHead, 40) && typeof x?.evidence === "string" && x.evidence.length > 0)
    || new Set(s.passed.map((x: any) => x.mergeCommit)).size !== s.passed.length) p.push("sources_passed"); // c2-guard:sources-passed
  const b = s?.base;
  if (!b || !hex(b.docs, 64) || !hex(b.manifest, 64) || !hex(b.fingerprint, 64) || !hex(b.builtAt, 40)) p.push("sources_base");
  if (!s?.slice || typeof s.slice.salt !== "string" || !s.slice.salt || typeof s.slice.rate !== "number" || !(s.slice.rate > 0 && s.slice.rate < 0.5)) p.push("sources_slice");
  const prs = new Set(Array.isArray(s?.passed) ? s.passed.map((x: any) => x.pr) : []);
  if (!Array.isArray(s?.files) || !s.files.length || !s.files.every((f: any, i: number, a: any[]) => typeof f?.path === "string" && hex(f?.blob, 40) && (i === 0 || a[i - 1].path < f.path)
    && Array.isArray(f.prs) && f.prs.length > 0 && f.prs.every((n: unknown) => prs.has(n)))) p.push("sources_files"); // c2-guard:sources-files
  return p;
}

// ---- held-out slice
/** The new held-out slice: a per-FILE draw from sha256(salt, path), so every piece of one file lands on one side. */
export function sliceOf(path: string, salt: string, rate: number): "train" | typeof HELDOUT2 {
  const u = parseInt(sha256(`${salt}\nslice\n${path}`).slice(0, 8), 16) / 0x100000000;
  return u < rate ? HELDOUT2 : "train"; // c2-guard:slice-rate
}

// ---- the append pass
export interface BaseDoc { text: string; split: string }
export interface NewDoc { text: string; man: Record<string, unknown> & { doc: number; split: string; textSha256: string } }
/** New input docs (one per admitted file, split train or heldout_v2) -> cleaned new docs appended after the base.
 * lb-clean sees heldout_v2 as "heldout" (no FIM, no repeats), and the label is restored on output. A new piece whose
 * normalised key equals, or whose shingles near-duplicate, any base doc is dropped with its FIM / repeats. */
export function appendCorpus(base: readonly BaseDoc[], input: readonly InDoc[], cfg: LbConfig, ex: Pick<Exclusions, "repos" | "names" | "hashes">, refs: TasksetRefs | null, drop: ReadonlySet<string> = new Set()) {
  for (const d of input) if (d.man.split !== "train" && d.man.split !== HELDOUT2) throw new Error("input_split"); // c2-guard:input-split
  const res = clean(input.map((d) => ({ ...d, man: { ...d.man, split: d.man.split === HELDOUT2 ? "heldout" : d.man.split } })), cfg, ex, refs, drop);
  const seen = new Set<string>(), near = new NearIndex(cfg.dedup);
  for (const b of base) { seen.add(normKey(b.text)); near.add(shingles(tokens(b.text), cfg.dedup.shingleTokens)); }
  const cross = { cross_exact_dup: 0, cross_near_dup: 0, cross_followers: 0 };
  const out: NewDoc[] = [];
  let keepGroup = true;
  for (const o of res.out) {
    const follower = "fimOf" in o.man || "repeatOf" in o.man; // FIM and best repeats follow their piece (clean() pushes them right after it)
    if (follower) { if (!keepGroup) { cross.cross_followers++; continue; } } // c2-guard:cross-follow
    else {
      keepGroup = true;
      if (seen.has(normKey(o.text))) { cross.cross_exact_dup++; keepGroup = false; continue; } // c2-guard:cross-exact
      if (near.find(shingles(tokens(o.text), cfg.dedup.shingleTokens)) >= 0) { cross.cross_near_dup++; keepGroup = false; continue; } // c2-guard:cross-near
    }
    const split = o.man.split === "heldout" ? HELDOUT2 : o.man.split; // c2-guard:relabel
    out.push({ text: o.text, man: { ...o.man, split, doc: base.length + out.length, textSha256: sha256(o.text) } });
  }
  const report = {
    schema: "peaceai-lb-corpus2-report:v1", version: LB_CORPUS2_VERSION, baseDocs: base.length,
    baseTrain: base.filter((b) => b.split === "train").length, baseHeldout: base.filter((b) => b.split === "heldout").length,
    newFiles: input.length, newFilesHeldoutV2: input.filter((d) => d.man.split === HELDOUT2).length, clean: res.report, cross,
    newDocs: out.length, newTrain: out.filter((o) => o.man.split === "train").length, newHeldoutV2: out.filter((o) => o.man.split === HELDOUT2).length,
    newTrainBytes: out.filter((o) => o.man.split === "train").reduce((n, o) => n + Buffer.byteLength(o.text), 0),
    newHeldoutV2Bytes: out.filter((o) => o.man.split === HELDOUT2).reduce((n, o) => n + Buffer.byteLength(o.text), 0),
    docsOut: base.length + out.length,
  };
  return { out, report };
}

// ---- non-overlap (a hard post-condition of every build, and the test of condition 4)
/** Overlap counts between training text and held-out text of the v2 corpus, all of which must be 0:
 *   new_train_vs_old_heldout, new_train_vs_heldout_v2, base_train_vs_heldout_v2, each split into exact (text sha256),
 *   norm (normalised token key) and near (shingle Jaccard >= nearJaccard). `baseCount`: docs [0, baseCount) are the base. */
export function overlapProblems(docs: readonly BaseDoc[], baseCount: number, dedup: LbConfig["dedup"]): Record<string, number> {
  const r: Record<string, number> = {};
  const pairs: [string, (i: number) => boolean, (i: number) => boolean][] = [
    ["new_train_vs_old_heldout", (i) => i >= baseCount && docs[i]!.split === "train", (i) => i < baseCount && docs[i]!.split === "heldout"],
    ["new_train_vs_heldout_v2", (i) => i >= baseCount && docs[i]!.split === "train", (i) => docs[i]!.split === HELDOUT2],
    ["base_train_vs_heldout_v2", (i) => i < baseCount && docs[i]!.split === "train", (i) => docs[i]!.split === HELDOUT2],
  ];
  const idx = docs.map((_, i) => i);
  for (const [name, isTrain, isHeld] of pairs) {
    const held = idx.filter(isHeld), train = idx.filter(isTrain);
    const ex = new Set(held.map((i) => sha256(docs[i]!.text))), nk = new Set(held.map((i) => normKey(docs[i]!.text)));
    const near = new NearIndex(dedup);
    for (const i of held) near.add(shingles(tokens(docs[i]!.text), dedup.shingleTokens));
    let e = 0, n = 0, m = 0;
    for (const i of train) {
      const t = docs[i]!.text;
      if (ex.has(sha256(t))) e++; // c2-guard:ov-exact
      else if (nk.has(normKey(t))) n++; // c2-guard:ov-norm
      else if (near.find(shingles(tokens(t), dedup.shingleTokens)) >= 0) m++; // c2-guard:ov-near
    }
    r[`${name}_exact`] = e; r[`${name}_norm`] = n; r[`${name}_near`] = m;
  }
  return r;
}

// ---- fingerprint
export interface Fingerprint2Parts {
  version: string; codeSha256: Record<string, string>; typescriptVersion: string; configSha256: string; exclusionsSha256: string; sourcesSha256: string;
  base: { docs: string; manifest: string; fingerprint: string }; newInput: { docsSha256: string; manifestSha256: string };
  refs: { docsSha256: string; manifestSha256: string } | null; dropHashesSha256: string[]; out: { docs: string; manifest: string };
}
export function fingerprint2Of(p: Fingerprint2Parts): string {
  if (p.version !== LB_CORPUS2_VERSION) throw new Error("fingerprint_version"); // c2-guard:fp-version
  const all = [p.configSha256, p.exclusionsSha256, p.sourcesSha256, p.base.docs, p.base.manifest, p.base.fingerprint, p.newInput.docsSha256, p.newInput.manifestSha256, p.out.docs, p.out.manifest, ...Object.values(p.codeSha256)];
  if (Object.keys(p.codeSha256).length === 0 || !all.every((h) => /^[0-9a-f]{64}$/.test(h))) throw new Error("fingerprint_sha"); // c2-guard:fp-sha
  const canon = (v: unknown): unknown => v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, canon((v as Record<string, unknown>)[k])])) : v;
  return sha256(JSON.stringify(canon({ schema: FINGERPRINT2_SCHEMA, ...p }))); // c2-guard:fp-hash
}
