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
//   - the dev-task rule (devTaskHits): no new TRAIN doc names, diagnoses or encodes the fix of a public dev task
//     (peaceai/plan/tasks-public-v1.json): a hit file is moved to heldout_v2 or dropped by a listed decision, and no
//     new train doc may hit (a hard post-condition of every build; Auditor #673 B1);
//   - the v2 fingerprint over the code, config, sources file, base pins, refs, drop files and output.
// Spec: peaceai/spec/lb-corpus2-v1.md. Counts and codes only; no text is ever printed.
import { clean, NearIndex, normKey, sha256, shingles, tokens, JUNK_PATH, type InDoc, type LbConfig, type TasksetRefs } from "./lbclean.ts";
import type { Exclusions } from "./nlpairs.ts";

/** Bump on any change to a rule or an output field: it is part of the fingerprint. */
export const LB_CORPUS2_VERSION = "peaceai-lb-corpus2:v2";
export const SOURCES_SCHEMA = "peaceai-lb-corpus2-sources:v2";
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
  devTasks: DevTasksPins;
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
  if (devPinsProblems(s?.devTasks, Array.isArray(s?.files) ? s.files.map((f: any) => f?.path) : []).length) p.push("sources_dev"); // c2-guard:sources-dev
  return p;
}

// ---- held-out slice
/** The new held-out slice: a per-FILE draw from sha256(salt, path), so every piece of one file lands on one side. */
export function sliceOf(path: string, salt: string, rate: number): "train" | typeof HELDOUT2 {
  const u = parseInt(sha256(`${salt}\nslice\n${path}`).slice(0, 8), 16) / 0x100000000;
  return u < rate ? HELDOUT2 : "train"; // c2-guard:slice-rate
}

// ---- the dev-task rule (Auditor #673 B1)
// The public dev tasks are peaceai/plan/tasks-public-v1.json (the set file is the authority, never a list in code).
// A new doc HITS a dev task when its text has any of, derived from the set and its reference fixes only:
//   dev_name  a repo name, owner/repo or task id of the set (case-insensitive, not inside a longer word);
//   dev_span  a back-quoted code span of a request with >= DEV_SPAN_TOKENS tokens, token for token;
//   dev_sha   a 7..40 hex run that starts a task's commit or reference merge sha;
//   dev_fix   a fix shingle: DEVFIX_K tokens of an added line run of a reference diff, as is, or with identifiers
//             abstracted when the window holds >= DEVFIX_MIN_KEYWORDS keywords (a renamed copy of the fix), kept only
//             when it occurs nowhere in the chain-1 base corpus (so it is specific to the fix, not common code).
// Fix shingles are committed as hashes (peaceai/model/lb-corpus2-devfix.json, built by lb-corpus2.ts --devfix).
export const DEVFIX_SCHEMA = "peaceai-lb-corpus2-devfix:v1";
export const DEV_SET_SCHEMA = "peaceai-plan-tasks:v1";
export const DEVFIX_K = 10;
export const DEVFIX_MIN_KEYWORDS = 2;
export const DEV_SPAN_TOKENS = 4;
export const DEV_DECISIONS = ["drop", HELDOUT2] as const;
/** JavaScript / TypeScript words kept by the abstraction (every other identifier becomes "I"). */
export const DEV_KEYWORDS: ReadonlySet<string> = new Set(("if else for while do return const let var function in of new typeof instanceof undefined null true false "
  + "await async yield throw try catch finally class extends this super import export from default switch case break continue void delete").split(" "));
const IDENT = /^[\p{L}_][\p{L}\p{N}_]*$/u;
export const devAbstract = (t: readonly string[]) => t.map((x) => (DEV_KEYWORDS.has(x) || !IDENT.test(x) ? x : "I"));
const fixHash = (kind: string, w: readonly string[]) => sha256(`${DEVFIX_SCHEMA}\n${kind}\n${w.join(" ")}`).slice(0, 16);
/** Every fix-shingle hash of one token run. */
export function fixShingles(toks: readonly string[]): Set<string> {
  const out = new Set<string>(), a = devAbstract(toks);
  for (let i = 0; i + DEVFIX_K <= toks.length; i++) {
    out.add(fixHash("exact", toks.slice(i, i + DEVFIX_K))); // c2-guard:fix-exact
    const w = a.slice(i, i + DEVFIX_K);
    if (w.filter((x) => DEV_KEYWORDS.has(x)).length >= DEVFIX_MIN_KEYWORDS) out.add(fixHash("abst", w)); // c2-guard:fix-abst
  }
  return out;
}
/** The added line runs of a unified diff (consecutive "+" lines, "+++" headers excluded), one string per run. */
export function addedRuns(diff: string): string[] {
  const runs: string[] = []; let cur: string[] = [];
  for (const l of diff.split("\n")) {
    if (l.startsWith("+") && !l.startsWith("+++ ")) { cur.push(l.slice(1)); continue; }
    if (cur.length) runs.push(cur.join("\n")); cur = []; // c2-guard:fix-runs
  }
  if (cur.length) runs.push(cur.join("\n"));
  return runs;
}
export interface DevTask { id: string; repo: string; commit: string; request: string; reference: { from: { pr: number; merge: string } } }
/** Problems with the dev task set file (empty = ok). */
export function devSetProblems(set: any): string[] {
  const hex40 = (v: unknown) => typeof v === "string" && /^[0-9a-f]{40}$/.test(v);
  if (set?.schema !== DEV_SET_SCHEMA || !Array.isArray(set?.tasks) || set.tasks.length === 0) return ["dev_set_schema"];
  if (!set.tasks.every((t: any) => typeof t?.id === "string" && t.id && typeof t?.repo === "string" && /^[\w.-]+\/[\w.-]+$/.test(t.repo) && hex40(t?.commit)
    && typeof t?.request === "string" && Number.isInteger(t?.reference?.from?.pr) && hex40(t?.reference?.from?.merge))) return ["dev_set_task"];
  if (new Set(set.tasks.map((t: any) => t.id)).size !== set.tasks.length) return ["dev_set_task"];
  return [];
}
export interface DevFixFile { schema: string; k: number; minKeywords: number; tasks: { id: string; repo: string; merge: string; diffSha256: string; hashes: string[] }[] }
/** Builds the devfix file: per task (set order), the fix shingles of its reference diff's added runs minus every
 * shingle that occurs in a base doc. `diffs`: task id -> the diff text of reference.from.merge against its parent. */
export function devFixOf(set: { tasks: DevTask[] }, diffs: ReadonlyMap<string, string>, baseTexts: Iterable<string>): DevFixFile {
  const per = set.tasks.map((t) => {
    const d = diffs.get(t.id); if (d === undefined) throw new Error("devfix_diff_missing"); // c2-guard:fix-diff
    const h = new Set<string>(); for (const r of addedRuns(d)) for (const x of fixShingles(tokens(r))) h.add(x);
    return { t, d, h };
  });
  const all = new Set<string>(); for (const p of per) for (const x of p.h) all.add(x);
  const common = new Set<string>();
  for (const b of baseTexts) for (const x of fixShingles(tokens(b))) if (all.has(x)) common.add(x); // c2-guard:fix-base
  return { schema: DEVFIX_SCHEMA, k: DEVFIX_K, minKeywords: DEVFIX_MIN_KEYWORDS,
    tasks: per.map(({ t, d, h }) => ({ id: t.id, repo: t.repo, merge: t.reference.from.merge, diffSha256: sha256(d), hashes: [...h].filter((x) => !common.has(x)).sort() })) };
}
export interface DevSet { names: string[]; spans: string[]; shas: string[]; fix: Set<string> }
/** The matchers of a dev task set and its devfix file. Throws a fixed code when they do not belong together. */
export function devSetOf(set: any, fix: any): DevSet {
  if (devSetProblems(set).length) throw new Error("dev_set_invalid"); // c2-guard:dev-set
  const ok = fix?.schema === DEVFIX_SCHEMA && fix.k === DEVFIX_K && fix.minKeywords === DEVFIX_MIN_KEYWORDS && Array.isArray(fix.tasks) && fix.tasks.length === set.tasks.length
    && set.tasks.every((t: DevTask, i: number) => fix.tasks[i]?.id === t.id && fix.tasks[i]?.repo === t.repo && fix.tasks[i]?.merge === t.reference.from.merge
      && Array.isArray(fix.tasks[i]?.hashes) && fix.tasks[i].hashes.length > 0 && fix.tasks[i].hashes.every((h: unknown) => typeof h === "string" && /^[0-9a-f]{16}$/.test(h)));
  if (!ok) throw new Error("devfix_differs"); // c2-guard:dev-fix-file
  const names = new Set<string>(), spans = new Set<string>(), shas = new Set<string>(), hashes = new Set<string>();
  for (const t of set.tasks as DevTask[]) {
    for (const n of [t.repo, t.repo.split("/")[1]!, t.id]) names.add(n.toLowerCase()); // c2-guard:dev-names
    for (const m of t.request.matchAll(/`([^`]+)`/g)) { const k = tokens(m[1]!); if (k.length >= DEV_SPAN_TOKENS) spans.add(k.join(" ")); } // c2-guard:dev-spans
    shas.add(t.commit); shas.add(t.reference.from.merge);
  }
  for (const f of fix.tasks) for (const h of f.hashes) hashes.add(h);
  return { names: [...names].sort(), spans: [...spans].sort(), shas: [...shas].sort(), fix: hashes };
}
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
/** The dev-task hit codes of one text (empty = no hit). */
export function devTaskHits(text: string, d: DevSet): string[] {
  const hits: string[] = [], low = text.toLowerCase();
  if (d.names.some((n) => new RegExp(`(?<![\\p{L}\\p{N}_])${esc(n)}(?![\\p{L}\\p{N}_])`, "u").test(low))) hits.push("dev_name"); // c2-guard:hit-name
  const toks = tokens(text), joined = ` ${toks.join(" ")} `;
  if (d.spans.some((s) => joined.includes(` ${s} `))) hits.push("dev_span"); // c2-guard:hit-span
  const hex = low.match(/(?<![0-9a-f])[0-9a-f]{7,40}(?![0-9a-f])/g) ?? [];
  if (hex.some((h) => d.shas.some((s) => s.startsWith(h)))) hits.push("dev_sha"); // c2-guard:hit-sha
  for (const x of fixShingles(toks)) if (d.fix.has(x)) { hits.push("dev_fix"); break; } // c2-guard:hit-fix
  return hits;
}
export interface DevDecision { path: string; to: (typeof DEV_DECISIONS)[number]; hits: string[]; why: string }
export interface DevTasksPins { set: string; setSha256: string; fix: string; fixSha256: string; diffs: string; decisions: DevDecision[] }
/** Problems with the sources' devTasks block (empty = ok). `paths`: the sources' file paths. */
export function devPinsProblems(p: any, paths: readonly string[]): string[] {
  const hex = (v: unknown) => typeof v === "string" && /^[0-9a-f]{64}$/.test(v);
  if (!p || typeof p.set !== "string" || !hex(p.setSha256) || typeof p.fix !== "string" || !hex(p.fixSha256) || typeof p.diffs !== "string" || !Array.isArray(p.decisions)) return ["dev_pins"];
  const known = new Set(paths), codes = new Set(["dev_name", "dev_span", "dev_sha", "dev_fix"]);
  if (!p.decisions.every((d: any, i: number, a: any[]) => typeof d?.path === "string" && known.has(d.path) && (i === 0 || a[i - 1].path < d.path) // c2-guard:dev-decision-paths
    && (DEV_DECISIONS as readonly string[]).includes(d.to) && Array.isArray(d.hits) && d.hits.length > 0 && d.hits.every((h: unknown) => codes.has(h as string)) // c2-guard:dev-decision-to
    && typeof d.why === "string" && d.why.length > 0)) return ["dev_decisions"];
  return [];
}
/** Decision problems for the admitted files' hits: every hit file has a decision whose hits are exactly its hits,
 * and every decision is for a hit file. `hitsOf`: path -> hit codes (all admitted files). */
export function devDecisionProblems(hitsOf: ReadonlyMap<string, string[]>, decisions: readonly DevDecision[]): string[] {
  const p: string[] = [], dec = new Map(decisions.map((d) => [d.path, d]));
  for (const [path, h] of hitsOf) {
    const d = dec.get(path);
    if (h.length && !d) p.push(`devtask_undecided:${path}`); // c2-guard:dec-undecided
    else if (d && JSON.stringify(d.hits) !== JSON.stringify(h)) p.push(`devtask_decision_stale:${path}`); // c2-guard:dec-stale
  }
  for (const d of decisions) if (!hitsOf.has(d.path)) p.push(`devtask_decision_stale:${d.path}`);
  return p;
}
/** How many TRAIN docs of a new doc list hit a dev task (must be 0). */
export function devTrainHits(docs: readonly { text: string; split: string }[], d: DevSet): number {
  return docs.filter((o) => o.split === "train" && devTaskHits(o.text, d).length > 0).length; // c2-guard:dev-train
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
