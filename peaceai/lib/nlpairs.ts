// M147 (general-agent roadmap step 4): English-to-code training pairs for the next LM retrain. Pure selection and
// filter logic; peaceai/bin/nl-pairs.ts does the git / GitHub I/O. Three pair kinds, all from permissively licensed
// TypeScript repos pinned in peaceai/model/nl-pairs.json:
//   pr      merged PR title + description  -> the merge commit's first-parent diff (code files only)
//   commit  commit message                 -> that commit's diff (commits that are not a PR's merge commit)
//   jsdoc   a /** doc comment */ + signature -> the function body, at the pinned head
// The docs are the fine-tune corpus format (docs.jsonl {doc,text} + manifest.jsonl {doc,split,repo,sha,path,function,..})
// so the retrain's own ft_prepare.py and eval_dedup.py run on them unchanged. Text never leaves the box out dir; the
// committed artifact is a manifest of sha256s and counts only.
import ts from "typescript";
import { createHash } from "node:crypto";
import { ALLOWED_SPDX, CODE_FILE, classifyLicense, type Spdx } from "./lmcorpus.ts";
import { HEX_SECRET, extFileExclusion } from "./extcorpus.ts";
import { scanText } from "./leak.ts";

export const NL_SCHEMA = "peaceai-nl-pairs:v1";
export const NL_MANIFEST_SCHEMA = "peaceai-nl-pairs-manifest:v1";
export const NL_KINDS = ["pr", "commit", "jsdoc"] as const;
export type NlKind = (typeof NL_KINDS)[number];
export const sha256 = (s: string | Buffer) => createHash("sha256").update(s).digest("hex");

/** Repos no pair may come from, whatever the exclusion file says: the 11 public plan-only task repos
 * (tasks-public-v1.json), unjs/ufo and toss/es-toolkit, and the #635 search fixtures by repo NAME (any owner). */
export const BUILTIN_EXCLUDED_REPOS: readonly string[] = [
  "unjs/defu", "unjs/destr", "unjs/scule", "unjs/ohash", "jquense/yup", "kysely-org/kysely", "ianstormtaylor/superstruct",
  "open-circle/valibot", "sindresorhus/p-queue", "remeda/remeda", "supermacro/neverthrow", "unjs/ufo", "toss/es-toolkit",
];
export const BUILTIN_EXCLUDED_NAMES: readonly string[] = ["is-what", "code-block-writer"];

export interface Exclusions { repos: Set<string>; names: Set<string>; fileSha256: string; fileEntries: number }
/** The required exclusion file (Auditor supplies the hidden-half list here; Builder never sees it). Text, one entry
 * per line: `owner/repo` or `*\/name` (any owner); blank lines and `#` comments allowed. Matching is case-insensitive.
 * Any other line, or no entry at all, refuses (null + code), so a truncated or wrong file never runs. */
export function parseExclusions(buf: Buffer | null): Exclusions | { code: string } {
  if (buf === null) return { code: "exclusions_missing" };
  const repos = new Set(BUILTIN_EXCLUDED_REPOS.map((r) => r.toLowerCase())), names = new Set(BUILTIN_EXCLUDED_NAMES.map((n) => n.toLowerCase()));
  let n = 0;
  for (const raw of buf.toString("utf8").split(/\r?\n/)) {
    const l = raw.replace(/#.*$/, "").trim();
    if (!l) continue;
    const m = /^([\w.-]+|\*)\/([\w.-]+)$/.exec(l);
    if (!m) return { code: "exclusions_bad_line" };
    if (m[1] === "*") names.add(m[2]!.toLowerCase()); else repos.add(l.toLowerCase());
    n++;
  }
  if (n === 0) return { code: "exclusions_empty" };
  return { repos, names, fileSha256: sha256(buf), fileEntries: n };
}
export function isExcludedRepo(repo: string, ex: Pick<Exclusions, "repos" | "names">): boolean {
  const r = repo.toLowerCase();
  return ex.repos.has(r) || ex.names.has(r.split("/")[1] ?? "");
}
/** A pair whose text names an excluded repo (owner/repo, or a github path to it) is dropped: no vendored or ported
 * copy of a task repo rides in through another repo's PR. Checked on the raw text, before URL scrubbing. */
export function mentionsExcluded(text: string, ex: Pick<Exclusions, "repos" | "names">): boolean {
  const t = text.toLowerCase();
  for (const r of ex.repos) if (t.includes(r)) return true;
  for (const n of ex.names) if (new RegExp(`[\\w.-]+/${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w.-])`).test(t)) return true;
  return false;
}

export interface NlRepo { name: string; commit: string; spdx: Spdx; licenseFile: string; licenseSha256: string }
export interface NlCaps { maxBytes: number; perKindBytes: Record<NlKind, number>; maxPrPages: number; maxCommits: number;
  maxDiffBytes: number; maxDiffFiles: number; maxPromptChars: number; minPromptChars: number; maxBodyChars: number }
export interface NlConfig { schema: string; repos: NlRepo[]; caps: NlCaps; salt: string }
const HEX40 = /^[0-9a-f]{40}$/, HEX64 = /^[0-9a-f]{64}$/, REPO = /^[\w.-]+\/[\w.-]+$/;
/** Config problems as fixed codes. The pretrain ext corpus's budget (replay.trainMaxBytes 6,000,000) bounds maxBytes. */
export function configProblems(c: any, setCRepos: readonly string[], replayMaxBytes: number): string[] {
  const p: string[] = [];
  if (c?.schema !== NL_SCHEMA) p.push("config_schema");
  if (!Array.isArray(c?.repos) || c.repos.length === 0) return [...p, "config_repos"];
  const seen = new Set<string>();
  for (const r of c.repos) {
    if (typeof r?.name !== "string" || !REPO.test(r.name)) { p.push("repo_name"); continue; }
    if (seen.has(r.name.toLowerCase())) p.push("repo_duplicate"); seen.add(r.name.toLowerCase());
    if (!HEX40.test(r.commit ?? "")) p.push("repo_commit");
    if (!(ALLOWED_SPDX as readonly string[]).includes(r.spdx)) p.push("repo_license_not_allowed");
    if (typeof r.licenseFile !== "string" || !r.licenseFile || !HEX64.test(r.licenseSha256 ?? "")) p.push("repo_license_pin");
    if (/^peaceg03\//i.test(r.name)) p.push("repo_owner_peaceg03");
    if (setCRepos.some((s) => s.toLowerCase() === r.name.toLowerCase())) p.push("repo_set_c");
    if (isExcludedRepo(r.name, { repos: new Set(BUILTIN_EXCLUDED_REPOS.map((x) => x.toLowerCase())), names: new Set(BUILTIN_EXCLUDED_NAMES) })) p.push("repo_builtin_excluded");
  }
  const k = c.caps;
  const pos = (v: unknown) => Number.isInteger(v) && (v as number) > 0;
  if (!k || !pos(k.maxBytes) || !NL_KINDS.every((x) => pos(k.perKindBytes?.[x])) || !["maxPrPages", "maxCommits", "maxDiffBytes", "maxDiffFiles", "maxPromptChars", "minPromptChars", "maxBodyChars"].every((x) => pos(k[x]))) p.push("caps");
  else {
    if (k.maxBytes > replayMaxBytes) p.push("caps_over_budget");
    if (NL_KINDS.reduce((s, x) => s + k.perKindBytes[x], 0) > k.maxBytes) p.push("caps_kinds_over_total");
  }
  if (typeof c.salt !== "string" || !c.salt) p.push("salt");
  return [...new Set(p)];
}

/** License gate per repo at its pinned commit: the file must be present, classify as the pinned SPDX id (GPL, MPL,
 * Blue Oak, mixed or unknown text classify as null) and match the pinned sha256. */
export function licenseProblem(text: Buffer | null, r: Pick<NlRepo, "spdx" | "licenseSha256">): string | null {
  if (text === null) return "license_missing";
  const s = classifyLicense(text.toString("utf8"));
  if (s === null) return "license_not_permissive";
  if (s !== r.spdx) return "license_spdx_mismatch";
  if (sha256(text) !== r.licenseSha256) return "license_sha_mismatch";
  return null;
}

/** Secret-like content anywhere in a pair: the leak scanner's key/token/private-key kinds and the hex-secret rule.
 * Such a pair is dropped whole, never "fixed". */
export function hasSecret(text: string): boolean {
  if (HEX_SECRET.test(text)) return true;
  return scanText(text).some((f) => /key|token|jwt/.test(f.kind));
}
/** Scrub English text (PR title/body, commit message, doc comments): HTML comments (PR templates), images, URLs,
 * emails, @mentions, co-author/sign-off trailers and checkbox lists go; whitespace is normalised. Returns null when the
 * result still trips the leak scanner (phone numbers, home paths, private keys: drop, never guess). */
export function scrubEnglish(raw: string): string | null {
  let t = raw.replace(/\r\n?/g, "\n").replace(/<!--[\s\S]*?(?:-->|$)/g, "");
  t = t.replace(/!\[[^\]]*\]\([^)]*\)/g, "").replace(/<img\b[^>]*>/gi, "");
  t = t.replace(/\[([^\]]*)\]\((?:https?:|mailto:)[^)]*\)/gi, "$1");
  t = t.replace(/\b(?:https?|ftp|wss?):\/\/[^\s<>()"'`]+/gi, "<url>").replace(/\bwww\.[^\s<>()"'`]+/gi, "<url>");
  t = t.split("\n").filter((l) => !/^\s*(?:Signed-off-by|Co-authored-by|Reviewed-by|Acked-by|Reported-by|Tested-by|Cc):/i.test(l) && !/^\s*[-*] \[[ xX]\]/.test(l)).join("\n");
  t = t.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "<email>");
  t = t.replace(/(^|[^\w@/.`-])@[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\b(?!\/)/g, "$1@user");
  t = t.replace(/[ \t]+$/gm, "").replace(/\n{3,}/g, "\n\n").trim();
  if (scanText(t).length > 0 || hasSecret(t)) return null;
  return t;
}
/** Code-side scrub: a URL inside code (comments, strings) becomes <url>; a pair whose code trips the leak scanner is
 * dropped. */
export function scrubCode(raw: string): string | null {
  const t = raw.replace(/\b(?:https?|ftp|wss?):\/\/[^\s<>()"'`\\]+/gi, "<url>");
  if (hasSecret(t) || scanText(t).length > 0) return null;
  return t;
}

export interface DiffFile { path: string; status: string; patch: string }
/** Which changed files of a commit become the diff side: code files only (lmcorpus CODE_FILE, no .d.ts), each patch
 * passing the ext-corpus file filter (generated/vendored paths, minified, licence headers, personal info, secrets). */
export function diffFileProblem(f: DiffFile): string | null {
  if (!CODE_FILE.test(f.path) || f.path.endsWith(".d.ts")) return "not_code";
  if (/(?:^|\/)(?:dist|build|vendor|node_modules|third_party)\//.test(f.path)) return "generated_path";
  const why = extFileExclusion(f.path, f.patch, []);
  return why === null ? null : `file_${why}`;
}
/** git diff text of one file, with the `index` line dropped (blob ids are not code). */
export function cleanPatch(p: string): string { return p.split("\n").filter((l) => !/^index [0-9a-f]+\.\.[0-9a-f]+/.test(l) && !/^similarity index|^dissimilarity index/.test(l)).join("\n").replace(/\n+$/, "") + "\n"; }

/** The doc text of one pair. The English is a block comment, so the doc stays code-shaped for the code LM. */
export function pairText(kind: NlKind, english: string, code: string): string {
  const e = english.replace(/\*\//g, "* /");
  if (kind === "jsdoc") return `// peaceai-nl-pair:v1 kind=jsdoc\n${code}\n`;
  return `// peaceai-nl-pair:v1 kind=${kind}\n/* Request:\n${e}\n*/\n${code}`;
}

export interface JsdocFn { name: string; doc: string; prompt: string; body: string; span: string }
/** Functions and methods with a leading /** doc comment of at least `minDoc` characters of prose: prompt = the doc
 * comment + the declaration up to the body, target = the body block. Overloads and bodies over maxBody are skipped. */
export function jsdocFunctions(path: string, text: string, minDoc: number, maxBody: number): JsdocFn[] {
  const sf = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
  if (((sf as unknown as { parseDiagnostics?: unknown[] }).parseDiagnostics ?? []).length) return [];
  const out: JsdocFn[] = [];
  const seen = new Map<string, number>();
  const take = (n: ts.Node, name: string, body: ts.Block, host: ts.Node) => {
    const full = host.getFullText(sf), lead = ts.getLeadingCommentRanges(full, 0) ?? [];
    const jd = lead.filter((r) => full.slice(r.pos, r.end).startsWith("/**")).pop();
    if (!jd) return;
    const doc = full.slice(jd.pos, jd.end);
    const prose = doc.replace(/^\/\*\*|\*\/$/g, "").split("\n").map((l) => l.replace(/^\s*\*\s?/, "")).filter((l) => !/^\s*@/.test(l)).join(" ").replace(/\{@link\s+([^}]*)\}/g, "$1").trim();
    if (prose.length < minDoc) return;
    const b = body.getText(sf);
    if (b.length > maxBody || b.length < 40) return;
    const start = host.getStart(sf), declHead = text.slice(start, body.getStart(sf));
    seen.set(name, (seen.get(name) ?? 0) + 1);
    out.push({ name, doc, prompt: `${doc}\n${declHead}`, body: b, span: `${doc}\n${declHead}${b}` });
    void n;
  };
  const v = (n: ts.Node) => {
    if (ts.isFunctionDeclaration(n) && n.body && n.name) take(n, n.name.text, n.body, n);
    else if (ts.isMethodDeclaration(n) && n.body && n.name && ts.isIdentifier(n.name)) take(n, n.name.text, n.body, n);
    else if (ts.isVariableStatement(n)) for (const d of n.declarationList.declarations) {
      if (ts.isIdentifier(d.name) && d.initializer && (ts.isArrowFunction(d.initializer) || ts.isFunctionExpression(d.initializer)) && ts.isBlock(d.initializer.body)) take(d, d.name.text, d.initializer.body, n);
    }
    ts.forEachChild(n, v);
  };
  v(sf);
  return out.filter((f) => seen.get(f.name) === 1); // overloads / same-name methods in one file: ambiguous, skipped
}

export interface Candidate { kind: NlKind; repo: string; sha: string; ref: string; path: string; english: string; code: string; text: string; diffKey?: string }
/** Deterministic capped selection: candidates in salted-sha order; each (repo, kind) gets an equal share of its
 * kind's byte budget, unused share is NOT redistributed (so one large repo cannot dominate), and the total cap holds. */
export function selectCapped(cands: readonly Candidate[], repos: readonly string[], caps: Pick<NlCaps, "maxBytes" | "perKindBytes">, salt: string): { kept: Candidate[]; dropped: Record<string, number> } {
  const key = (c: Candidate) => sha256(`${salt}\n${c.kind}\n${c.repo}\n${c.ref}`);
  const sorted = [...cands].sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
  const used = new Map<string, number>(); let total = 0;
  const kept: Candidate[] = []; const dropped: Record<string, number> = {};
  for (const c of sorted) {
    const share = Math.floor(caps.perKindBytes[c.kind] / repos.length), k = `${c.repo}\0${c.kind}`, b = Buffer.byteLength(c.text);
    if ((used.get(k) ?? 0) + b > share) { dropped.cap_repo_kind = (dropped.cap_repo_kind ?? 0) + 1; continue; }
    if (total + b > caps.maxBytes) { dropped.cap_total = (dropped.cap_total ?? 0) + 1; continue; }
    used.set(k, (used.get(k) ?? 0) + b); total += b; kept.push(c);
  }
  return { kept, dropped };
}

/** M8 lookup rule for gh calls: a failure names a fixed cause only (HTTP status, rate limit), never stderr text. */
export function ghCause(stderr: string): { code: string; rateLimited: boolean } {
  const status = /\(HTTP (\d{3})\)/.exec(stderr)?.[1] ?? /\bHTTP (\d{3})\b/.exec(stderr)?.[1];
  const rateLimited = /rate limit/i.test(stderr);
  return { code: rateLimited ? "gh_rate_limited" : status ? `gh_http_${status}` : "gh_failed", rateLimited };
}

/** Directories holding a nested LICENSE (vendored code with its own licence): their files are excluded (ext-corpus rule). */
export const licenseDirsOf = (paths: readonly string[]) => [...new Set(paths.filter((p) => /(?:^|\/)(?:LICEN[CS]E|COPYING)(?:\.[a-z]+)?$/i.test(p) && p.includes("/")).map((p) => p.slice(0, p.lastIndexOf("/"))))];
/** Commit subjects that carry no request (releases, version bumps, dependency bots, merges). */
export const CHORE_SUBJECT = /^(?:v?\d+\.\d+\.\d+\S*$|release\b|version packages|merge (?:branch|pull request|remote)|revert "|chore\(deps|chore\(release|build\(deps|bump\b|\[ci\]|ci:|ci\()/i;
/** The ext-corpus file filter on a whole source file (jsdoc pairs), returning the exclusion code or null. */
export function extFileExclusionFor(path: string, text: string, licenseDirs: readonly string[]): string | null { return extFileExclusion(path, text, licenseDirs); }
