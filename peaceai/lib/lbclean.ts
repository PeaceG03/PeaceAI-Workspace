// Limit-breaker step 2: training-data cleaning in one deterministic pass over a fine-tune corpus (docs.jsonl {doc,text}
// + manifest.jsonl {doc,split,repo,path,function,..}, the format nl-pairs.ts, ft_prepare.py and eval_dedup.py share).
// Pure logic; peaceai/bin/lb-clean.ts does the file I/O. It extends the M147 pieces instead of a second framework: the
// task-set exclusion is nlpairs.ts's parseExclusions / isExcludedRepo / mentionsExcluded / namesHashedRepo (the hidden
// half is matched only by hashing a candidate's lowercased owner/repo), and the token rule is eval_dedup.py's.
// Per input doc, in doc-id order:
//   drop  taskset_repo, taskset_name, taskset_hidden_name, junk_path, junk_generated_header, junk_long_line,
//         junk_minified, junk_low_alnum, junk_long_token (a base64 / hex data run) (whole doc)
//   split at top-level function / class / interface / enum / type / namespace boundaries (TypeScript parser)
//   drop  taskset_near_dup, exact_dup, near_dup                                (per piece)
//   add   difficulty fields; best-code repeats; fill-in-the-middle examples   (kept train pieces)
// Every drop is a fixed rule code; the report holds counts only (never text, never a hidden name or hash).
import ts from "typescript";
import { createHash } from "node:crypto";
import { isExcludedRepo, mentionsExcluded, namesHashedRepo, type Exclusions } from "./nlpairs.ts";

/** Bump on any change to a rule or an output field: it is part of the fingerprint (Auditor). */
export const LB_CLEAN_VERSION = "peaceai-lb-clean:v1";
export const LB_CONFIG_SCHEMA = "peaceai-lb-clean-config:v1";
export const LB_FINGERPRINT_SCHEMA = "peaceai-lb-clean-fingerprint:v1";
export const DROP_RULES = [
  "taskset_repo", "taskset_name", "taskset_hidden_name", "junk_path", "junk_generated_header", "junk_long_line", "junk_minified",
  "junk_low_alnum", "junk_long_token", "taskset_near_dup", "exact_dup", "near_dup",
] as const;
export type DropRule = (typeof DROP_RULES)[number];
export const sha256 = (s: string | Buffer) => createHash("sha256").update(s).digest("hex");

export interface LbConfig {
  schema: string; salt: string;
  junk: { maxLineChars: number; maxMeanLineChars: number; minAlnumRatio: number; maxTokenChars: number; headerLines: number };
  dedup: { shingleTokens: number; numPerm: number; bands: number; nearJaccard: number };
  taskset: { shingleTokens: number; maxContainment: number };
  split: { minChars: number; maxChunkChars: number };
  best: { weight: number; maxDocs: number; textSha256: string[]; paths: { repo: string; pathPrefix: string }[] };
  fim: { rate: number; minChars: number; minLines: number; maxMiddleLines: number; prefix: string; suffix: string; middle: string };
  difficulty: { capChars: number; capNesting: number; capIdentifiers: number };
}
/** Config problems as fixed codes (empty = ok). */
export function configProblems(c: any): string[] {
  const p: string[] = [];
  const int = (v: unknown, lo: number, hi: number) => Number.isInteger(v) && (v as number) >= lo && (v as number) <= hi;
  const num = (v: unknown, lo: number, hi: number) => typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi;
  if (c?.schema !== LB_CONFIG_SCHEMA) p.push("config_schema");
  if (typeof c?.salt !== "string" || !c.salt) p.push("config_salt");
  const j = c?.junk, d = c?.dedup, t = c?.taskset, s = c?.split, b = c?.best, f = c?.fim, k = c?.difficulty;
  if (!j || !int(j.maxLineChars, 80, 100000) || !int(j.maxMeanLineChars, 20, 100000) || !num(j.minAlnumRatio, 0, 1) || !int(j.maxTokenChars, 20, 100000) || !int(j.headerLines, 1, 1000)) p.push("config_junk");
  if (!d || !int(d.shingleTokens, 1, 64) || !int(d.numPerm, 8, 1024) || !int(d.bands, 1, 1024) || d.numPerm % d.bands !== 0 || !num(d.nearJaccard, 0.5, 1)) p.push("config_dedup");
  if (!t || !int(t.shingleTokens, 4, 128) || !num(t.maxContainment, 0.01, 1)) p.push("config_taskset");
  if (!s || !int(s.minChars, 1, 10_000_000) || !int(s.maxChunkChars, 1, 10_000_000)) p.push("config_split");
  if (!b || !int(b.weight, 1, 8) || !int(b.maxDocs, 0, 10000) || !Array.isArray(b.textSha256) || !b.textSha256.every((h: unknown) => typeof h === "string" && /^[0-9a-f]{64}$/.test(h))
    || !Array.isArray(b.paths) || !b.paths.every((x: any) => typeof x?.repo === "string" && /^[\w.-]+\/[\w.-]+$/.test(x.repo) && typeof x.pathPrefix === "string" && x.pathPrefix.length > 0)) p.push("config_best");
  else if (b.textSha256.length + b.paths.length > b.maxDocs) p.push("config_best_over_cap");
  if (!f || !num(f.rate, 0, 1) || !int(f.minChars, 1, 10_000_000) || !int(f.minLines, 3, 100000) || !int(f.maxMiddleLines, 1, 100000)
    || ![f.prefix, f.suffix, f.middle].every((x) => typeof x === "string" && x.length >= 3) || new Set([f.prefix, f.suffix, f.middle]).size !== 3) p.push("config_fim");
  if (!k || !int(k.capChars, 1, 10_000_000) || !int(k.capNesting, 1, 1000) || !int(k.capIdentifiers, 1, 100000)) p.push("config_difficulty");
  return p;
}

// ---- task-set exclusion (nlpairs.ts rules)
type ExSets = Pick<Exclusions, "repos" | "names" | "hashes">;
/** The task-set rule on one doc: its manifest repo, then its text (public names, then hash-listed names). */
export function tasksetDrop(repo: string, text: string, ex: ExSets): DropRule | null {
  if (isExcludedRepo(repo, ex)) return "taskset_repo"; // m150-guard:taskset-repo
  if (mentionsExcluded(text, ex)) return "taskset_name"; // m150-guard:taskset-name
  if (namesHashedRepo(text, ex)) return "taskset_hidden_name"; // m150-guard:taskset-hidden
  return null;
}

// ---- junk
/** Lockfiles, build output, bundles, minified files, source maps and snapshots, by path. */
export const JUNK_PATH: readonly RegExp[] = [
  /(?:^|\/)(?:package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.ya?ml|bun\.lockb?|deno\.lock|composer\.lock|cargo\.lock|gemfile\.lock|poetry\.lock)$|\.lock$|-lock\.(?:json|ya?ml)$/i, // m150-guard:junk-lockfile
  /(?:^|\/)(?:dist|build|out|bundle|bundles|umd|vendor|vendors|node_modules|third_party|coverage|lib-cov|__generated__|generated|\.next|\.nuxt|\.output|\.svelte-kit)\//i, // m150-guard:junk-dir
  /\.(?:min|bundle|umd|prod|production)\.[cm]?js$|\.(?:map|snap)$/i, // m150-guard:junk-file
];
/** Every path a doc carries: its manifest path and each file of an embedded git diff. */
export function docPaths(path: string, text: string): string[] {
  const out = new Set<string>([path]);
  for (const m of text.matchAll(/^diff --git a\/(\S+) b\/(\S+)$/gm)) { out.add(m[1]!); out.add(m[2]!); } // m150-guard:diff-paths
  for (const m of text.matchAll(/^\+\+\+ b\/(\S+)$/gm)) out.add(m[1]!); // m150-guard:patch-paths
  return [...out].filter(Boolean);
}
const GENERATED = /@generated\b|\bdo not edit\b|\bauto-?generated\b|\bcode generated by\b|\bthis file (?:was|is) (?:automatically )?generated\b/i;
/** A generated-file marker on a COMMENT line within the first `n` lines of the doc or of any diff file section (a
 * diff's +/-/space marker is ignored). The same words inside code (a generator's string literal) do not count. */
export function generatedHeader(text: string, n: number): boolean {
  const lines = text.split("\n");
  const starts = [0];
  lines.forEach((l, i) => { if (l.startsWith("diff --git ")) starts.push(i + 1); });
  for (const s of starts) for (const raw of lines.slice(s, s + n)) {
    const l = (s > 0 ? raw.replace(/^[+\- ]/, "") : raw).trimStart();
    if (/^(?:\/\/|\/\*|\*|#)/.test(l) && GENERATED.test(l)) return true; // m150-guard:gen-header
  }
  return false;
}
/** Junk rules on the whole doc text and its paths, first hit wins (fixed order). */
export function junkDrop(path: string, text: string, j: LbConfig["junk"]): DropRule | null {
  if (docPaths(path, text).some((p) => JUNK_PATH.some((r) => r.test(p)))) return "junk_path"; // m150-guard:junk-path
  if (generatedHeader(text, j.headerLines)) return "junk_generated_header";
  const lines = text.split("\n");
  if (lines.some((l) => l.length > j.maxLineChars)) return "junk_long_line"; // m150-guard:long-line
  if (text.length / lines.length > j.maxMeanLineChars) return "junk_minified"; // m150-guard:minified
  const vis = text.replace(/\s+/g, ""), alnum = vis.replace(/[^\p{L}\p{N}]/gu, "").length;
  if (vis.length > 0 && alnum / vis.length < j.minAlnumRatio) return "junk_low_alnum"; // m150-guard:low-alnum
  if (new RegExp(`[A-Za-z0-9+/=]{${j.maxTokenChars + 1},}`).test(text)) return "junk_long_token"; // m150-guard:long-token
  return null;
}

// ---- tokens, shingles, MinHash
/** eval_dedup.py's token rule (\w+ or one punctuation char), with Python's Unicode \w. */
export const tokens = (t: string): string[] => t.match(/[\p{L}\p{N}_]+|[^\p{L}\p{N}_\s]/gu) ?? [];
/** sha256 of the whitespace-normalised token sequence (eval_dedup.py's "exact" form). */
export const normKey = (t: string) => sha256(tokens(t).join(" "));
const fnv32 = (s: string) => { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); } return h >>> 0; };
const fmix32 = (x: number) => { let h = x >>> 0; h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16; return h >>> 0; };
/** Sorted unique 32-bit hashes of every run of `k` tokens (one shingle of the whole sequence when it is shorter). */
export function shingles(toks: readonly string[], k: number): Uint32Array {
  const s = new Set<number>();
  if (toks.length === 0) return new Uint32Array(0);
  if (toks.length < k) s.add(fnv32(toks.join("\u0001")));
  else for (let i = 0; i + k <= toks.length; i++) s.add(fnv32(toks.slice(i, i + k).join("\u0001")));
  return Uint32Array.from([...s].sort((a, b) => a - b));
}
export function jaccard(a: Uint32Array, b: Uint32Array): number {
  if (a.length === 0 && b.length === 0) return 1;
  let i = 0, j = 0, inter = 0;
  while (i < a.length && j < b.length) { if (a[i] === b[j]) { inter++; i++; j++; } else if (a[i]! < b[j]!) i++; else j++; }
  return inter / (a.length + b.length - inter);
}
const seedCache = new Map<number, Uint32Array>();
function seeds(n: number): Uint32Array {
  let s = seedCache.get(n);
  if (!s) { s = Uint32Array.from({ length: n }, (_, i) => parseInt(sha256(`peaceai-lb-clean:minhash:v1:${i}`).slice(0, 8), 16)); seedCache.set(n, s); }
  return s;
}
export function minhash(sh: Uint32Array, numPerm: number): Uint32Array {
  const sd = seeds(numPerm), sig = new Uint32Array(numPerm).fill(0xffffffff);
  for (const h of sh) for (let i = 0; i < numPerm; i++) { const v = fmix32(h ^ sd[i]!); if (v < sig[i]!) sig[i] = v; }
  return sig;
}
/** Near-duplicate index: MinHash LSH bands find candidates, the exact shingle Jaccard decides (so the threshold is exact
 * for every candidate the bands surface). Only kept pieces are added. */
export class NearIndex {
  private bands = new Map<string, number[]>(); private sets: Uint32Array[] = [];
  constructor(private cfg: LbConfig["dedup"]) {}
  private keys(sh: Uint32Array): string[] {
    const sig = minhash(sh, this.cfg.numPerm), r = this.cfg.numPerm / this.cfg.bands;
    return Array.from({ length: this.cfg.bands }, (_, b) => `${b}:${Array.from(sig.subarray(b * r, (b + 1) * r)).join(",")}`);
  }
  /** Index of a kept piece at least nearJaccard similar, or -1. */
  find(sh: Uint32Array): number {
    const cand = new Set<number>();
    for (const k of this.keys(sh)) for (const i of this.bands.get(k) ?? []) cand.add(i);
    for (const i of [...cand].sort((a, b) => a - b)) if (jaccard(sh, this.sets[i]!) >= this.cfg.nearJaccard) return i; // m150-guard:near-dup
    return -1;
  }
  add(sh: Uint32Array): void {
    const i = this.sets.push(sh) - 1;
    for (const k of this.keys(sh)) { const l = this.bands.get(k); if (l) l.push(i); else this.bands.set(k, [i]); }
  }
}

// ---- task-set near duplicates (public task-set repos, by name)
export interface TasksetRefs { exact: Set<string>; shingles: Set<number>; k: number; files: number }
export function buildRefs(texts: Iterable<string>, k: number): TasksetRefs {
  const r: TasksetRefs = { exact: new Set(), shingles: new Set(), k, files: 0 };
  for (const t of texts) { r.files++; const tt = tokens(t); r.exact.add(sha256(tt.join(" "))); for (const h of shingles(tt, k)) r.shingles.add(h); }
  return r;
}
/** Share of a piece's k-token shingles found anywhere in the task-set repos' code (exact normalised copies count 1). */
export function tasksetContainment(text: string, refs: TasksetRefs): number {
  const tt = tokens(text);
  if (refs.exact.has(sha256(tt.join(" ")))) return 1; // m150-guard:taskset-exact
  if (tt.length < refs.k) return 0;
  const sh = shingles(tt, refs.k);
  let hit = 0; for (const h of sh) if (refs.shingles.has(h)) hit++;
  return sh.length ? hit / sh.length : 0;
}

// ---- split at function / class boundaries
const parseOk = (sf: ts.SourceFile) => ((sf as unknown as { parseDiagnostics?: unknown[] }).parseDiagnostics ?? []).length === 0;
function isUnit(s: ts.Statement): boolean {
  if (ts.isFunctionDeclaration(s) || ts.isClassDeclaration(s) || ts.isInterfaceDeclaration(s) || ts.isEnumDeclaration(s) || ts.isTypeAliasDeclaration(s) || ts.isModuleDeclaration(s)) return true;
  if (ts.isVariableStatement(s)) return s.declarationList.declarations.some((d) => !!d.initializer && (ts.isArrowFunction(d.initializer) || ts.isFunctionExpression(d.initializer) || ts.isClassExpression(d.initializer)));
  return false;
}
/** Pieces of a source text cut only before a top-level unit (its leading comments go with it), packed greedily up to
 * maxChunkChars (a unit larger than that stays whole). Lossless: the pieces join back to the text. A text under
 * minChars, one that does not parse (a diff), or one with fewer than two units is one piece. */
export function splitUnits(path: string, text: string, s: LbConfig["split"]): string[] {
  if (text.length < s.minChars) return [text]; // m150-guard:split-min
  const sf = ts.createSourceFile(/\.[cm]?[jt]sx$/.test(path) ? "x.tsx" : "x.ts", text, ts.ScriptTarget.Latest, true);
  if (!parseOk(sf)) return [text]; // m150-guard:split-parse
  const cuts = sf.statements.filter((st, i) => i > 0 && isUnit(st)).map((st) => st.getFullStart());
  if (cuts.length === 0) return [text];
  const bounds = [0, ...cuts, text.length];
  const out: string[] = [];
  let start = 0;
  for (let i = 1; i < bounds.length - 1; i++) {
    if (bounds[i + 1]! - start > s.maxChunkChars && bounds[i]! > start) { out.push(text.slice(start, bounds[i])); start = bounds[i]!; } // m150-guard:split-cut
  }
  out.push(text.slice(start));
  return out;
}

// ---- difficulty (for staged training): TypeScript scanner, so strings and comments do not count as nesting
export interface Difficulty { score: number; level: "easy" | "medium" | "hard"; chars: number; lines: number; nesting: number; identifiers: number; tokens: number }
export function difficulty(text: string, c: LbConfig["difficulty"]): Difficulty {
  const sc = ts.createScanner(ts.ScriptTarget.Latest, true, ts.LanguageVariant.Standard, text);
  const ids = new Set<string>();
  let depth = 0, nesting = 0, n = 0;
  for (let k = sc.scan(), guard = 0; k !== ts.SyntaxKind.EndOfFileToken && guard <= text.length + 1; k = sc.scan(), guard++) {
    n++;
    if (k === ts.SyntaxKind.Identifier) ids.add(sc.getTokenText()); // m150-guard:diff-ids
    else if (k === ts.SyntaxKind.OpenBraceToken || k === ts.SyntaxKind.OpenParenToken || k === ts.SyntaxKind.OpenBracketToken) nesting = Math.max(nesting, ++depth); // m150-guard:diff-nest
    else if (k === ts.SyntaxKind.CloseBraceToken || k === ts.SyntaxKind.CloseParenToken || k === ts.SyntaxKind.CloseBracketToken) depth = Math.max(0, depth - 1);
  }
  const f = (v: number, cap: number) => Math.min(1, v / cap);
  const score = Math.round(100 * (0.4 * f(text.length, c.capChars) + 0.3 * f(nesting, c.capNesting) + 0.3 * f(ids.size, c.capIdentifiers))); // m150-guard:diff-score
  return { score, level: score < 34 ? "easy" : score < 67 ? "medium" : "hard", chars: text.length, lines: text.split("\n").length, nesting, identifiers: ids.size, tokens: n };
}

// ---- best-code set and fill-in-the-middle
export function isBest(m: { repo: string; path: string }, srcTextSha: string, b: LbConfig["best"]): boolean {
  return b.textSha256.includes(srcTextSha) || b.paths.some((p) => p.repo.toLowerCase() === m.repo.toLowerCase() && m.path.startsWith(p.pathPrefix));
}
const u32 = (h: string, at: number) => parseInt(h.slice(at, at + 8), 16);
/** A fill-in-the-middle example (prefix-suffix-middle order) of a piece, or a skip code. Selection and the two cut
 * lines come from sha256(salt, piece text), so the same corpus always gives the same examples. */
export function fimExample(text: string, salt: string, f: LbConfig["fim"]): { text: string } | { skip: string } {
  if (text.length < f.minChars) return { skip: "fim_short" }; // m150-guard:fim-min
  const lines = text.split("\n");
  if (lines.length < f.minLines) return { skip: "fim_short" };
  const h = sha256(`${salt}\nfim\n${text}`);
  if (u32(h, 0) / 0x100000000 >= f.rate) return { skip: "fim_not_selected" }; // m150-guard:fim-rate
  if ([f.prefix, f.suffix, f.middle].some((s) => text.includes(s))) return { skip: "fim_sentinel_in_text" }; // m150-guard:fim-sentinel
  const i = 1 + (u32(h, 8) % (lines.length - 2));
  const j = i + 1 + (u32(h, 16) % Math.min(f.maxMiddleLines, lines.length - 1 - i));
  const pre = lines.slice(0, i).join("\n") + "\n", mid = lines.slice(i, j).join("\n") + "\n", suf = lines.slice(j).join("\n");
  return { text: `${f.prefix}${pre}${f.suffix}${suf}${f.middle}${mid}` };
}

// ---- the pass
export interface InDoc { doc: number; text: string; man: Record<string, unknown> & { doc: number; split: string; repo: string; path: string; function?: string } }
export interface OutDoc { text: string; man: Record<string, unknown> & { doc: number; split: string; textSha256: string } }
export interface CleanResult { out: OutDoc[]; report: Record<string, any> }
export function clean(docs: readonly InDoc[], cfg: LbConfig, ex: ExSets, refs: TasksetRefs | null): CleanResult {
  const drops: Record<string, number> = Object.fromEntries(DROP_RULES.map((r) => [r, 0]));
  const skips: Record<string, number> = {};
  const out: { text: string; man: Record<string, unknown> & { split: string } }[] = [];
  const near = new NearIndex(cfg.dedup), seen = new Set<string>();
  let pieces = 0, splitDocs = 0, repeats = 0, fims = 0, bestDocs = 0, kept = 0;
  const levels: Record<string, number> = { easy: 0, medium: 0, hard: 0 };
  for (const d of [...docs].sort((a, b) => a.doc - b.doc)) {
    const whole = tasksetDrop(d.man.repo, d.text, ex) ?? junkDrop(d.man.path, d.text, cfg.junk);
    if (whole) { drops[whole]!++; continue; }
    const parts = splitUnits(d.man.path, d.text, cfg.split);
    if (parts.length > 1) splitDocs++;
    const srcSha = sha256(d.text), best = d.man.split === "train" && isBest(d.man, srcSha, cfg.best) && bestDocs < cfg.best.maxDocs;
    if (best) bestDocs++;
    parts.forEach((text, pi) => {
      pieces++;
      if (refs && tasksetContainment(text, refs) >= cfg.taskset.maxContainment) { drops.taskset_near_dup!++; return; } // m150-guard:taskset-near
      const key = normKey(text);
      if (seen.has(key)) { drops.exact_dup!++; return; } // m150-guard:exact-dup
      const sh = shingles(tokens(text), cfg.dedup.shingleTokens);
      if (near.find(sh) >= 0) { drops.near_dup!++; return; }
      seen.add(key); near.add(sh); kept++;
      const fn = String(d.man.function ?? ""), base = parts.length > 1 ? `${fn}#p${pi + 1}of${parts.length}` : fn;
      const diff = difficulty(text, cfg.difficulty); levels[diff.level]!++;
      const man = { ...d.man, function: base, src: d.doc, ...(parts.length > 1 ? { part: pi + 1, parts: parts.length } : {}), difficulty: diff };
      out.push({ text, man });
      if (d.man.split !== "train") return;
      if (best) for (let r = 2; r <= cfg.best.weight; r++) { out.push({ text, man: { ...man, function: `${base}#rep${r}`, repeatOf: d.doc, best: true } }); repeats++; } // m150-guard:best-repeat
      const fx = fimExample(text, cfg.salt, cfg.fim);
      if ("text" in fx) { out.push({ text: fx.text, man: { ...man, function: `${base}#fim`, fimOf: d.doc } }); fims++; }
      else skips[fx.skip] = (skips[fx.skip] ?? 0) + 1;
    });
  }
  const outMan: OutDoc[] = out.map((o, i) => ({ text: o.text, man: { ...o.man, doc: i, textSha256: sha256(o.text) } }));
  const report = {
    schema: "peaceai-lb-clean-report:v1", cleanerVersion: LB_CLEAN_VERSION, docsIn: docs.length, piecesChecked: pieces, splitDocs, keptPieces: kept,
    drops, bestDocs, repeats, fim: fims, fimSkips: Object.fromEntries(Object.entries(skips).sort()), docsOut: outMan.length,
    train: outMan.filter((o) => o.man.split === "train").length, heldout: outMan.filter((o) => o.man.split === "heldout").length,
    difficultyLevels: levels, tasksetRefFiles: refs?.files ?? 0, exclusionHashes: ex.hashes.size,
  };
  return { out: outMan, report };
}

/** The output fingerprint: sha256 over the cleaner code version and code sha256s, the config and the input manifest
 * (docs + manifest sha256s, the exclusion file and task-set refs). Refuses without a code version (Auditor). */
export interface FingerprintParts { cleanerVersion: string; codeSha256: Record<string, string>; typescriptVersion: string; configSha256: string; exclusionsSha256: string;
  input: { docsSha256: string; manifestSha256: string }; refs: { docsSha256: string; manifestSha256: string } | null }
export function fingerprintOf(p: FingerprintParts): string {
  if (!p.cleanerVersion || p.cleanerVersion !== LB_CLEAN_VERSION) throw new Error("fingerprint_cleaner_version"); // m150-guard:fp-version
  if (Object.keys(p.codeSha256).length === 0 || !Object.values(p.codeSha256).every((h) => /^[0-9a-f]{64}$/.test(h))) throw new Error("fingerprint_code_sha");
  const canon = (v: unknown): unknown => v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, canon((v as Record<string, unknown>)[k])])) : v;
  return sha256(JSON.stringify(canon({ schema: LB_FINGERPRINT_SCHEMA, ...p }))); // m150-guard:fp-hash
}
