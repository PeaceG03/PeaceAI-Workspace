// M143 (step 2 of the general coding-agent roadmap, Oct 30 2026): read-only code search and read tools PeaceAI uses
// to find the files that matter in a TypeScript repo it has never seen. Tools: tree (respects .gitignore), grep
// (literal or regex), symbol (definitions, references, imports and re-exports, default vs named), read (a file or
// a line range), testsFor (related tests by import graph and naming) and relevant (ranked files for a request
// broken into action / target / limits / doneCheck slots).
//
// Safety: deterministic (sorted walks, no clocks, no randomness, no network, no model calls); read-only (the only
// fs calls are readdir / realpath / stat / readFile); never executes repo code (files are parsed with
// ts.createSourceFile only, nothing is imported, required or run); never reads outside the repo root (every path is
// normalized, refused if absolute or escaping, and its realpath must stay under the root's realpath; symlinks are
// never followed by the walk); never reads .git internals or gitignored files (so an ignored .env stays unread).
// Definitions, references and BM25 text ranking reuse M6's index (symbols.ts); this module adds the import /
// export binding graph that M6 does not keep.
//
// Each safety or relevance filter is a single line tagged "filter:<id>". The m143 mutation test deletes each tagged
// line in turn and requires a behavior test to fail, so no filter is untested.
import { readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, posix, resolve, sep } from "node:path";
import ts from "typescript";
import { buildIndex, definitions, references, search as bm25, MAX_INDEX_FILE_BYTES, type RepoIndex, type SymbolKind } from "./symbols.ts";

export const CODESEARCH_SCHEMA = "peaceai-codesearch:v1";
export const TOOL_NAMES = ["tree", "grep", "symbol", "read", "tests_for", "relevant"] as const;
export type ToolName = (typeof TOOL_NAMES)[number];

export const LIMITS = {
  treeFiles: 20_000,
  depth: 48,
  readFileBytes: 1_000_000,
  readLines: 2_000,
  grepHits: 500,
  grepLineChars: 1_000,
  patternChars: 200,
  relevant: 15,
} as const;

export type Refusal = { ok: false; reason: string };
const refuse = (reason: string): Refusal => ({ ok: false, reason });

const CODE_FILE = /\.(?:[cm]?tsx?|[cm]?jsx?)$/;
const TEST_FILE = /(?:^|\/)(?:__tests__|__test__)\/|\.(?:test|spec)\.[cm]?[jt]sx?$|(?:^|\/)tests?\/[^\n]*\.[cm]?[jt]sx?$/;
const GENERATED = /(?:^|\/)(?:dist|build|out|coverage|node_modules|vendor)\/|\.min\.[cm]?js$|\.d\.[cm]?ts$/;
export const isTestPath = (p: string): boolean => TEST_FILE.test(p);
export const isGeneratedPath = (p: string): boolean => GENERATED.test(p);
const byStr = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

// ---------------------------------------------------------------- .gitignore

interface IgnoreRule { base: string; re: RegExp; negate: boolean; dirOnly: boolean; anchored: boolean }

function globToRegex(glob: string): string {
  let out = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]!;
    if (c === "*") {
      if (glob[i + 1] === "*") {
        const atStart = i === 0 || glob[i - 1] === "/";
        const atEnd = i + 2 === glob.length || glob[i + 2] === "/";
        if (atStart && atEnd) { out += glob[i + 2] === "/" ? "(?:[^/]*/)*" : ".*"; i += glob[i + 2] === "/" ? 2 : 1; continue; }
      }
      out += "[^/]*";
    } else if (c === "?") out += "[^/]";
    else if (c === "[") {
      const end = glob.indexOf("]", i + 2);
      if (end < 0) { out += "\\["; continue; }
      const body = glob.slice(i + 1, end).replace(/^!/, "^").replace(/\\/g, "\\\\");
      out += `[${body}]`;
      i = end;
    } else if (c === "\\" && i + 1 < glob.length) { out += glob[i + 1]!.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&"); i++; }
    else out += c.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
  }
  return out;
}

/** Parses one .gitignore (git's rules: last match wins, "!" re-includes, trailing "/" = directories only). */
export function parseGitignore(text: string, base: string): IgnoreRule[] {
  const rules: IgnoreRule[] = [];
  for (let line of text.split(/\r?\n/)) {
    if (!line || line.startsWith("#")) continue;
    line = line.replace(/(?<!\\)\s+$/, "");
    if (!line) continue;
    let negate = false;
    if (line.startsWith("!")) { negate = true; line = line.slice(1); }
    else if (line.startsWith("\\!") || line.startsWith("\\#")) line = line.slice(1);
    const dirOnly = line.endsWith("/");
    if (dirOnly) line = line.replace(/\/+$/, "");
    const anchored = line.includes("/");
    line = line.replace(/^\//, "");
    if (!line) continue;
    rules.push({ base, re: new RegExp(`^${globToRegex(line)}$`), negate, dirOnly, anchored });
  }
  return rules;
}

function ignoredBy(rules: readonly IgnoreRule[], path: string, isDir: boolean): boolean {
  let ignored = false;
  for (const r of rules) {
    if (r.base && !path.startsWith(`${r.base}/`)) continue;
    const rel = r.base ? path.slice(r.base.length + 1) : path;
    if (r.dirOnly && !isDir) continue;
    const subject = r.anchored ? rel : rel.slice(rel.lastIndexOf("/") + 1);
    if (r.re.test(subject)) ignored = !r.negate;
  }
  return ignored;
}

// ---------------------------------------------------------------- repo view

export interface ImportSite {
  path: string;
  line: number;
  specifier: string;
  /** Repo file the specifier resolves to, or null (a package or an unresolved path). */
  resolved: string | null;
  kind: "default" | "named" | "namespace" | "side-effect" | "dynamic" | "require";
  /** Exported name taken from the module: "default", "*" for a namespace, or the named export. */
  imported: string;
  /** Local binding name ("" for side-effect, dynamic and require). */
  local: string;
  typeOnly: boolean;
}

export interface ExportSite {
  path: string;
  line: number;
  /** Name other modules import: "default" for a default export. */
  exported: string;
  /** Local declaration name, the re-exported name ("*" for export * / export * as ns), or null for an anonymous default. */
  local: string | null;
  /** Re-export source: resolved repo file (null if a package), or undefined for a local export. */
  from?: string | null;
  specifier?: string;
  /** True when the export is the declaration itself (export function f, export default class C). */
  declaration?: true;
}

interface FileInfo { imports: ImportSite[]; exports: ExportSite[]; reexportAll: { line: number; from: string | null; specifier: string }[] }

export interface TreeResult { ok: true; files: string[]; truncated: boolean; ignored: number; symlinksSkipped: number }

export interface CodeRepo {
  readonly root: string;
  tree(opts?: { under?: string; limit?: number }): TreeResult | Refusal;
  grep(pattern: string, opts?: { regex?: boolean; ignoreCase?: boolean; under?: string; limit?: number }): GrepResult | Refusal;
  symbol(name: string): SymbolResult | Refusal;
  read(path: string, opts?: { start?: number; end?: number }): ReadResult | Refusal;
  testsFor(path: string): TestsForResult | Refusal;
  relevant(request: string | RequestSlots, opts?: { limit?: number }): RelevantResult | Refusal;
}

export interface GrepHit { path: string; line: number; column: number; text: string }
export interface GrepResult { ok: true; hits: GrepHit[]; truncated: boolean; filesSearched: number }

export interface SymbolDefOut { path: string; line: number; kind: SymbolKind; exported: boolean; defaultExport: boolean }
export interface SymbolResult {
  ok: true;
  name: string;
  definitions: SymbolDefOut[];
  /** Identifier uses outside declarations and import bindings (name-based, from M6's index). Never comments or strings. */
  references: { path: string; line: number }[];
  /** Import sites that bind this symbol: by name, by default import of a module whose default export is it, or through re-exports. */
  imports: (ImportSite & { definedIn: string | null })[];
  /** Export sites that re-export or alias this symbol (export { x } from, export { x as y }, export default x). */
  reexports: ExportSite[];
}

export interface ReadResult { ok: true; path: string; startLine: number; endLine: number; totalLines: number; text: string; truncated: boolean }

export interface RelatedTest { path: string; score: number; reasons: string[] }
export interface TestsForResult { ok: true; path: string; tests: RelatedTest[] }

/** The request breakdown the planner fills (step 1): what to do, what it is about, limits, and how we know it is done. */
export interface RequestSlots { action?: string; target?: string; limits?: string | string[]; doneCheck?: string }
export interface RankedFile { path: string; score: number; reasons: string[] }
export interface RelevantResult {
  ok: true;
  /** Ranked candidate files to read or edit (no tests, no files the limits protect). */
  files: RankedFile[];
  /** Tests related to the top files, and test files the request itself points at. */
  tests: RankedFile[];
  /** Files the limits slot names: keep them unchanged. */
  keep: RankedFile[];
  /** Slots the planner must fill or rephrase: action when empty; target and doneCheck when empty or matching nothing here. */
  unresolved: ("action" | "target" | "doneCheck")[];
}

const toPosix = (p: string) => p.split(sep).join("/");

export function openRepo(rootDir: string): CodeRepo {
  const rootReal = realpathSync(rootDir);
  if (!statSync(rootReal).isDirectory()) throw new Error("codesearch: root is not a directory");
  const inside = (real: string) => real === rootReal || real.startsWith(rootReal + sep);
  let rules: IgnoreRule[] | null = null;
  let cachedTree: TreeResult | null = null;
  let index: (RepoIndex & { skipped: number }) | null = null;
  let infos: Map<string, FileInfo> | null = null;

  const readText = (rel: string): string | null => {
    const real = realpathSync(resolve(rootReal, rel));
    if (!inside(real)) return null; // filter:read-realpath
    const st = statSync(real);
    if (!st.isFile() || st.size > LIMITS.readFileBytes) return null;
    const buf = readFileSync(real);
    if (buf.includes(0)) return null; // filter:binary
    return buf.toString("utf8");
  };

  const loadRules = (dir: string): IgnoreRule[] => {
    const out: IgnoreRule[] = [];
    for (const name of dir ? [".gitignore"] : [".git/info/exclude", ".gitignore"]) {
      const rel = dir ? `${dir}/${name}` : name;
      let text: string | null = null;
      try { text = readText(rel); } catch { /* absent */ }
      if (text !== null) out.push(...parseGitignore(text, dir));
    }
    return out;
  };

  const walk = (): TreeResult => {
    if (cachedTree) return cachedTree;
    rules = loadRules("");
    const files: string[] = [];
    let ignored = 0;
    let symlinks = 0;
    let truncated = false;
    const visit = (dir: string, depth: number) => {
      if (depth > LIMITS.depth || truncated) return;
      if (dir) rules!.push(...loadRules(dir));
      const entries = readdirSync(resolve(rootReal, dir), { withFileTypes: true }).sort((a, b) => byStr(a.name, b.name));
      for (const e of entries) {
        const rel = dir ? `${dir}/${e.name}` : e.name;
        if (e.name === ".git") continue; // filter:git-dir
        if (e.isSymbolicLink()) { symlinks++; continue; } // filter:symlink-walk
        const isDir = e.isDirectory();
        if (!isDir && !e.isFile() && !e.isSymbolicLink()) continue; // sockets, fifos, devices (symlinks: the filter above)
        if (ignoredBy(rules!, rel, isDir)) { ignored++; continue; } // filter:gitignore
        if (isDir) visit(rel, depth + 1);
        else if (files.length >= LIMITS.treeFiles) { truncated = true; return; }
        else files.push(rel);
      }
    };
    visit("", 0);
    cachedTree = { ok: true, files, truncated, ignored, symlinksSkipped: symlinks };
    return cachedTree;
  };

  /** Normalizes a caller path and proves it stays in the repo; returns the repo-relative posix path. */
  const safeRel = (input: unknown, mustExist = true): string | Refusal => {
    if (typeof input !== "string" || !input || input.length > 4096 || input.includes("\0")) return refuse("bad_path");
    const slashed = input.replace(/\\/g, "/");
    if (isAbsolute(input) || slashed.startsWith("/") || /^[A-Za-z]:/.test(slashed)) return refuse("absolute_path"); // filter:absolute
    const norm = posix.normalize(slashed).replace(/^\.\/+/, "").replace(/\/+$/, "");
    if (norm === ".." || norm.startsWith("../")) return refuse("path_traversal"); // filter:dotdot
    if (norm === "." || norm === "") return "";
    if (!mustExist) return norm;
    let real: string;
    try { real = realpathSync(resolve(rootReal, norm)); } catch { return refuse("not_found"); }
    if (!inside(real)) return refuse("outside_root"); // filter:realpath
    const real2 = toPosix(real.slice(rootReal.length + 1));
    if (real2 === ".git" || real2.startsWith(".git/")) return refuse("git_internal"); // filter:git-real
    return norm;
  };

  const isListed = (rel: string) => walk().files.includes(rel);

  const codeIndex = () => {
    if (index && infos) return { index, infos };
    const files = walk().files.filter((p) => CODE_FILE.test(p));
    const contents: { path: string; content: string }[] = [];
    for (const p of files) {
      const text = readText(p);
      if (text !== null && Buffer.byteLength(text) <= MAX_INDEX_FILE_BYTES) contents.push({ path: p, content: text });
    }
    index = buildIndex(contents);
    const known = new Set(index.files);
    infos = new Map(contents.filter((c) => known.has(c.path)).map((c) => [c.path, fileInfo(c.path, c.content, known)]));
    return { index, infos };
  };

  /** Follows an export of `name` from `file` through re-exports to the declaring file and local name. */
  const resolveExport = (file: string, name: string, seen = new Set<string>()): { path: string; local: string } | null => {
    const key = `${file}\0${name}`;
    if (seen.has(key) || seen.size > 64) return null;
    seen.add(key);
    const info = codeIndex().infos.get(file);
    if (!info) return null;
    for (const e of info.exports) {
      if (e.exported !== name) continue;
      if (e.from === undefined) return e.local ? { path: file, local: e.local } : { path: file, local: "default" };
      if (e.from === null) return null;
      if (e.local === "*") return { path: e.from, local: "*" };
      return resolveExport(e.from, e.local!, seen);
    }
    if (name !== "default") for (const r of info.reexportAll) if (r.from) { const hit = resolveExport(r.from, name, seen); if (hit) return hit; }
    return null;
  };

  const definedIn = (s: ImportSite): { path: string; local: string } | null => {
    if (!s.resolved) return null;
    if (s.kind === "named" || s.kind === "default") return resolveExport(s.resolved, s.imported);
    return null;
  };

  const repo: CodeRepo = {
    root: rootReal,

    tree(opts = {}) {
      const t = walk();
      let under = "";
      if (opts.under !== undefined) { const r = safeRel(opts.under); if (typeof r !== "string") return r; under = r; }
      const limit = clampInt(opts.limit, 1, LIMITS.treeFiles, LIMITS.treeFiles);
      const files = t.files.filter((p) => !under || p.startsWith(`${under}/`));
      return { ok: true, files: files.slice(0, limit), truncated: t.truncated || files.length > limit, ignored: t.ignored, symlinksSkipped: t.symlinksSkipped };
    },

    grep(pattern, opts = {}) {
      if (typeof pattern !== "string" || !pattern) return refuse("empty_pattern");
      if (pattern.length > LIMITS.patternChars) return refuse("pattern_too_long");
      let re: RegExp;
      if (opts.regex) {
        if (/\((?:[^()\\]|\\.)*[+*}](?:[^()\\]|\\.)*\)\s*[+*{]/.test(pattern)) return refuse("regex_nested_quantifier"); // filter:redos
        try { re = new RegExp(pattern, opts.ignoreCase ? "gi" : "g"); } catch { return refuse("bad_regex"); }
      } else re = new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), opts.ignoreCase ? "gi" : "g");
      let under = "";
      if (opts.under !== undefined) { const r = safeRel(opts.under); if (typeof r !== "string") return r; under = r; }
      const limit = clampInt(opts.limit, 1, LIMITS.grepHits, 200);
      const hits: GrepHit[] = [];
      let searched = 0;
      let truncated = false;
      for (const p of walk().files) {
        if (under && p !== under && !p.startsWith(`${under}/`)) continue;
        const text = readText(p);
        if (text === null) continue;
        searched++;
        const lines = text.split(/\r?\n/);
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (line.length > LIMITS.grepLineChars) continue; // filter:long-line
          re.lastIndex = 0;
          const m = re.exec(line);
          if (!m) continue;
          if (hits.length >= limit) { truncated = true; break; }
          hits.push({ path: p, line: i + 1, column: m.index + 1, text: line.trim().slice(0, 300) });
        }
        if (truncated) break;
      }
      return { ok: true, hits, truncated, filesSearched: searched };
    },

    symbol(name) {
      if (typeof name !== "string" || !/^[A-Za-z_$][\w$]{0,127}$/.test(name)) return refuse("bad_symbol");
      const { index: ix, infos: inf } = codeIndex();
      const defaults = new Set<string>();
      for (const [p, info] of inf) for (const e of info.exports) if (e.exported === "default" && e.from === undefined && e.local === name) defaults.add(p);
      const defs = definitions(ix, name).map((d) => ({ path: d.path, line: d.line, kind: d.kind, exported: d.exported, defaultExport: defaults.has(d.path) }));
      const defPaths = new Set(defs.map((d) => d.path));
      const imports: SymbolResult["imports"] = [];
      const reexports: ExportSite[] = [];
      for (const [, info] of inf) {
        for (const s of info.imports) {
          if (s.kind === "side-effect" || s.kind === "dynamic" || s.kind === "require") continue;
          const target = definedIn(s);
          if (target) { if (target.local === name && defPaths.has(target.path)) imports.push({ ...s, definedIn: target.path }); continue; }
          if (!s.resolved && s.kind === "named" && s.imported === name) imports.push({ ...s, definedIn: null }); // filter:external-named
        }
        for (const e of info.exports) {
          if (e.from === undefined && e.declaration) continue; // filter:alias-not-decl
          if (e.from === undefined) { if (e.local === name && e.exported !== name) reexports.push(e); continue; }
          if (e.local === "*" || !e.from) { if (e.exported === name) reexports.push(e); continue; }
          const target = resolveExport(e.from, e.local!);
          if (target && target.local === name && defPaths.has(target.path)) reexports.push(e);
        }
      }
      imports.sort((a, b) => byStr(a.path, b.path) || a.line - b.line);
      reexports.sort((a, b) => byStr(a.path, b.path) || a.line - b.line);
      return { ok: true, name, definitions: defs, references: references(ix, name).map((r) => ({ path: r.path, line: r.line })), imports, reexports };
    },

    read(path, opts = {}) {
      const rel = safeRel(path);
      if (typeof rel !== "string") return rel;
      if (!rel) return refuse("not_a_file");
      if (!isListed(rel)) return refuse("ignored_or_not_listed"); // filter:read-listed
      const text = readText(rel);
      if (text === null) return refuse("unreadable_or_binary");
      const lines = text.split(/\r?\n/);
      if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
      const total = lines.length;
      const start = clampInt(opts.start, 1, Math.max(total, 1), 1);
      const wantEnd = clampInt(opts.end, start, Math.max(total, start), total);
      const end = Math.min(wantEnd, start + LIMITS.readLines - 1);
      return { ok: true, path: rel, startLine: start, endLine: end, totalLines: total, text: lines.slice(start - 1, end).join("\n"), truncated: end < wantEnd };
    },

    testsFor(path) {
      const rel = safeRel(path);
      if (typeof rel !== "string") return rel;
      if (!isListed(rel)) return refuse("ignored_or_not_listed");
      const { infos: inf } = codeIndex();
      const scores = new Map<string, { score: number; reasons: Set<string> }>();
      const bump = (p: string, s: number, why: string) => {
        if (p === rel) return;
        const cur = scores.get(p) ?? { score: 0, reasons: new Set<string>() };
        cur.score += s;
        cur.reasons.add(why);
        scores.set(p, cur);
      };
      const tests = [...inf.keys()].filter(isTestPath);
      const directImporters = new Set<string>();
      for (const [p, info] of inf) if (!isTestPath(p) && info.imports.some((s) => s.resolved === rel)) directImporters.add(p);
      for (const t of tests) {
        for (const s of inf.get(t)!.imports) {
          if (!s.resolved) continue;
          if (s.resolved === rel) { bump(t, 5, "imports it"); continue; }
          const d = definedIn(s);
          if (d && d.path === rel) { bump(t, 4, `imports ${s.imported === "default" ? "its default export" : s.imported} via ${s.resolved}`); continue; } // filter:test-reexport
          if (s.kind === "namespace" && reexportsAllFrom(s.resolved, rel)) { bump(t, 2, `imports * from ${s.resolved}`); continue; }
          if (directImporters.has(s.resolved)) bump(t, 1, `imports ${s.resolved}, which imports it`);
        }
        if (stem(t) === stem(rel) && stem(rel) !== "index") bump(t, 2, "same name"); // filter:test-name
      }
      const out = [...scores.entries()].map(([p, v]) => ({ path: p, score: v.score, reasons: [...v.reasons].sort() }));
      out.sort((a, b) => b.score - a.score || byStr(a.path, b.path));
      return { ok: true, path: rel, tests: out };
    },

    relevant(request, opts = {}) {
      const slots: RequestSlots = typeof request === "string" ? { target: request } : request ?? {};
      if (typeof slots !== "object") return refuse("bad_request");
      const str = (v: unknown) => (typeof v === "string" ? v : Array.isArray(v) ? v.filter((x) => typeof x === "string").join("\n") : "");
      const action = str(slots.action), target = str(slots.target), limitsText = str(slots.limits), done = str(slots.doneCheck);
      if ([action, target, limitsText, done].some((s) => s.length > 4000)) return refuse("request_too_long");
      const { index: ix, infos: inf } = codeIndex();
      const all = walk().files;
      const limit = clampInt(opts.limit, 1, 100, LIMITS.relevant);
      const scored = new Map<string, { score: number; reasons: Set<string> }>();
      const bump = (p: string, s: number, why: string) => {
        const cur = scored.get(p) ?? { score: 0, reasons: new Set<string>() };
        cur.score += s;
        cur.reasons.add(why);
        scored.set(p, cur);
      };
      const named = (text: string) => namedFiles(text, all);
      // Identifiers the text names: `backticked`, or shaped like code (camelCase, PascalCase, snake_case, CONSTANT).
      const symbolsIn = (text: string) => {
        const ids = new Set<string>();
        for (const m of text.matchAll(/`([A-Za-z_$][\w$]{0,63})`/g)) ids.add(m[1]!);
        for (const m of text.matchAll(/(?<![\w$.\/])([A-Za-z_$][\w$]{2,63})(?![\w$])/g)) if (/[a-z][A-Z]|^[A-Z][a-z]+[A-Z]|[a-z]_[a-z]|^[A-Z][A-Z0-9_]{2,}$/.test(m[1]!)) ids.add(m[1]!);
        return [...ids].sort(byStr);
      };
      // Limits name files and symbols to keep unchanged.
      const keep = new Map<string, Set<string>>();
      const keepAdd = (p: string, why: string) => { const s = keep.get(p) ?? new Set<string>(); s.add(why); keep.set(p, s); };
      for (const p of named(limitsText)) keepAdd(p, "named in limits");
      for (const id of symbolsIn(limitsText)) for (const d of definitions(ix, id)) keepAdd(d.path, `defines ${id} (named in limits)`);
      let targetHits = 0;
      for (const p of named(target)) { bump(p, 10, "named in target"); targetHits++; }
      for (const id of symbolsIn(target)) {
        const defs = definitions(ix, id);
        for (const d of defs) { bump(d.path, 8, `defines ${id}`); targetHits++; }
        if (defs.length) {
          const sym = repo.symbol(id);
          if (sym.ok) for (const s of sym.imports) bump(s.path, 2, `imports ${id}`);
        }
      }
      for (const lit of quoted(target)) {
        const g = repo.grep(lit, { limit: 50 });
        if (g.ok) for (const p of new Set(g.hits.map((h) => h.path))) { bump(p, 4, `contains "${lit.slice(0, 40)}"`); targetHits++; }
      }
      const text = (q: string, weight: number, why: string) => {
        if (!q.trim()) return 0;
        const hits = bm25(ix, q, 20);
        const top = hits[0]?.score ?? 0;
        for (const h of hits) bump(h.path, Math.round((weight * h.score * 1000) / top) / 1000, why);
        return hits.length;
      };
      targetHits += text(target, 3, "text matches target");
      text(action, 1, "text matches action");
      const doneHits = text(done, 1, "text matches doneCheck") + named(done).length;
      for (const p of named(done)) bump(p, 3, "named in doneCheck");
      const ranked = [...scored.entries()].map(([p, v]) => {
        let score = v.score;
        if (isGeneratedPath(p)) score = score / 10; // filter:generated
        return { path: p, score: Math.round(score * 1000) / 1000, reasons: [...v.reasons].sort() };
      });
      ranked.sort((a, b) => b.score - a.score || byStr(a.path, b.path));
      let pool = ranked;
      pool = pool.filter((f) => !isTestPath(f.path)); // filter:edit-candidates
      pool = pool.filter((f) => !keep.has(f.path)); // filter:keep-out
      const files = pool.slice(0, limit);
      const tests = new Map<string, RankedFile>();
      for (const f of ranked) if (isTestPath(f.path) && !keep.has(f.path)) tests.set(f.path, { ...f });
      for (const f of files.slice(0, 5)) {
        const r = repo.testsFor(f.path);
        if (!r.ok) continue;
        for (const t of r.tests) {
          const cur = tests.get(t.path) ?? { path: t.path, score: 0, reasons: [] };
          cur.score = Math.round((cur.score + t.score) * 1000) / 1000;
          cur.reasons = [...new Set([...cur.reasons, `tests ${f.path}`])].sort();
          tests.set(t.path, cur);
        }
      }
      const testList = [...tests.values()].sort((a, b) => b.score - a.score || byStr(a.path, b.path)).slice(0, limit);
      const keepList = [...keep.entries()].map(([p, w]) => ({ path: p, score: 0, reasons: [...w].sort() })).sort((a, b) => byStr(a.path, b.path));
      const unresolved: RelevantResult["unresolved"] = [];
      if (!action.trim()) unresolved.push("action");
      if (!target.trim() || !targetHits) unresolved.push("target");
      if (!done.trim() || !doneHits) unresolved.push("doneCheck");
      return { ok: true, files, tests: testList, keep: keepList, unresolved };
    },
  };

  const reexportsAllFrom = (barrel: string, file: string): boolean => {
    const info = codeIndex().infos.get(barrel);
    return !!info && (info.reexportAll.some((r) => r.from === file) || info.exports.some((e) => e.from === file));
  };

  return repo;
}

function clampInt(v: unknown, lo: number, hi: number, dflt: number): number {
  if (typeof v !== "number" || !Number.isFinite(v)) return dflt;
  return Math.min(hi, Math.max(lo, Math.trunc(v)));
}

function stem(p: string): string {
  const base = p.slice(p.lastIndexOf("/") + 1);
  return base.replace(/\.[cm]?[jt]sx?$/, "").replace(/\.(?:test|spec)$/, "").replace(/\.d$/, "");
}

function quoted(text: string): string[] {
  return [...new Set([...text.matchAll(/"([^"\n]{3,80})"|'([^'\n]{3,80})'/g)].map((m) => m[1] ?? m[2]!))];
}

/** Repo files the text names: by path (src/a.ts, ./src/a) or by a basename that is unique in the repo. */
function namedFiles(text: string, files: readonly string[]): string[] {
  const out = new Set<string>();
  const set = new Set(files);
  for (const raw of text.match(/[\w@.-]*(?:\/[\w@.-]+)+|\b[\w@-]+\.[cm]?[jt]sx?\b/g) ?? []) {
    const p = posix.normalize(raw.replace(/^\.\//, "").replace(/^\/+/, ""));
    if (set.has(p)) { out.add(p); continue; }
    for (const ext of [".ts", ".tsx", "/index.ts"]) if (set.has(p + ext)) { out.add(p + ext); break; }
    if (!p.includes("/")) {
      const hits = files.filter((f) => f === p || f.endsWith(`/${p}`));
      if (hits.length === 1) out.add(hits[0]!);
    }
  }
  return [...out].sort(byStr);
}

/** Resolves a relative specifier to a repo file (TypeScript's extension rules for .js/.mjs/.cjs, index files). */
export function resolveSpecifier(from: string, specifier: string, known: ReadonlySet<string>): string | null {
  if (!specifier.startsWith(".")) return null;
  const joined = posix.normalize(posix.join(posix.dirname(from), specifier));
  if (joined.startsWith("../") || joined === "..") return null;
  const swapped = joined.replace(/\.js$/, ".ts").replace(/\.jsx$/, ".tsx").replace(/\.mjs$/, ".mts").replace(/\.cjs$/, ".cts");
  const cands = [joined, swapped, swapped.replace(/\.ts$/, ".tsx"), ...[".ts", ".tsx", ".d.ts", ".mts", ".cts", ".js", ".jsx", ".mjs"].map((e) => joined + e), ...["index.ts", "index.tsx", "index.js"].map((i) => `${joined}/${i}`)];
  for (const c of cands) if (known.has(c)) return c;
  return null;
}

function fileInfo(path: string, content: string, known: ReadonlySet<string>): FileInfo {
  const kind = path.endsWith("x") ? ts.ScriptKind.TSX : /\.[cm]?js$/.test(path) ? ts.ScriptKind.JS : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(path, content, ts.ScriptTarget.Latest, true, kind);
  const line = (n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
  const imports: ImportSite[] = [];
  const exports: ExportSite[] = [];
  const reexportAll: FileInfo["reexportAll"] = [];
  const mods = (n: ts.Node) => (ts.canHaveModifiers(n) ? ts.getModifiers(n) ?? [] : []);
  const has = (n: ts.Node, k: ts.SyntaxKind) => mods(n).some((m) => m.kind === k);
  for (const st of sf.statements) {
    if (ts.isImportDeclaration(st) && ts.isStringLiteral(st.moduleSpecifier)) {
      const spec = st.moduleSpecifier.text;
      const resolved = resolveSpecifier(path, spec, known);
      const base = { path, line: line(st), specifier: spec, resolved };
      const clause = st.importClause;
      if (!clause) { imports.push({ ...base, kind: "side-effect", imported: "", local: "", typeOnly: false }); continue; }
      const typeOnly = clause.isTypeOnly;
      if (clause.name) imports.push({ ...base, kind: "default", imported: "default", local: clause.name.text, typeOnly });
      const nb = clause.namedBindings;
      if (nb && ts.isNamespaceImport(nb)) imports.push({ ...base, kind: "namespace", imported: "*", local: nb.name.text, typeOnly });
      if (nb && ts.isNamedImports(nb))
        for (const el of nb.elements) {
          const imported = (el.propertyName ?? el.name).text;
          imports.push({ ...base, line: line(el), kind: imported === "default" ? "default" : "named", imported, local: el.name.text, typeOnly: typeOnly || el.isTypeOnly });
        }
      continue;
    }
    if (ts.isExportDeclaration(st)) {
      const spec = st.moduleSpecifier && ts.isStringLiteral(st.moduleSpecifier) ? st.moduleSpecifier.text : undefined;
      const from = spec === undefined ? undefined : resolveSpecifier(path, spec, known);
      if (!st.exportClause) { if (spec !== undefined) reexportAll.push({ line: line(st), from: from ?? null, specifier: spec }); continue; }
      if (ts.isNamespaceExport(st.exportClause)) { exports.push({ path, line: line(st), exported: st.exportClause.name.text, local: "*", from: from ?? null, specifier: spec }); continue; }
      for (const el of st.exportClause.elements) {
        const e: ExportSite = { path, line: line(el), exported: el.name.text, local: (el.propertyName ?? el.name).text };
        if (spec !== undefined) { e.from = from ?? null; e.specifier = spec; }
        exports.push(e);
      }
      continue;
    }
    if (ts.isExportAssignment(st) && !st.isExportEquals) {
      exports.push({ path, line: line(st), exported: "default", local: ts.isIdentifier(st.expression) ? st.expression.text : null });
      continue;
    }
    if (!has(st, ts.SyntaxKind.ExportKeyword)) continue;
    const isDefault = has(st, ts.SyntaxKind.DefaultKeyword);
    if (ts.isVariableStatement(st)) {
      for (const d of st.declarationList.declarations) if (ts.isIdentifier(d.name)) exports.push({ path, line: line(d), exported: d.name.text, local: d.name.text, declaration: true });
      continue;
    }
    const nm = (st as ts.DeclarationStatement).name;
    const local = nm && ts.isIdentifier(nm) ? nm.text : null;
    exports.push({ path, line: line(st), exported: isDefault ? "default" : local ?? "default", local, declaration: true });
  }
  // dynamic import("./x") and require("./x"): graph edges only, never evaluated.
  const visit = (n: ts.Node): void => {
    if (ts.isCallExpression(n) && n.arguments.length === 1 && ts.isStringLiteralLike(n.arguments[0]!)) {
      const isImport = n.expression.kind === ts.SyntaxKind.ImportKeyword;
      const isRequire = ts.isIdentifier(n.expression) && n.expression.text === "require";
      if (isImport || isRequire) {
        const spec = (n.arguments[0] as ts.StringLiteral).text;
        imports.push({ path, line: line(n), specifier: spec, resolved: resolveSpecifier(path, spec, known), kind: isImport ? "dynamic" : "require", imported: "*", local: "", typeOnly: false });
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return { imports, exports, reexportAll };
}

/** One JSON-in, JSON-out entry point for the planner and the CLI. Unknown tools and bad arguments are refusals. */
export function runTool(repo: CodeRepo, tool: string, args: Record<string, unknown> = {}): { schema: string; tool: string; result: unknown } {
  const a = args && typeof args === "object" ? args : {};
  const num = (k: string) => (typeof a[k] === "number" ? (a[k] as number) : undefined);
  const s = (k: string) => (typeof a[k] === "string" ? (a[k] as string) : undefined);
  let result: unknown;
  switch (tool) {
    case "tree": result = repo.tree({ under: s("under"), limit: num("limit") }); break;
    case "grep": result = repo.grep(s("pattern") ?? "", { regex: a.regex === true, ignoreCase: a.ignoreCase === true, under: s("under"), limit: num("limit") }); break;
    case "symbol": result = repo.symbol(s("name") ?? ""); break;
    case "read": result = repo.read(s("path") ?? "", { start: num("start"), end: num("end") }); break;
    case "tests_for": result = repo.testsFor(s("path") ?? ""); break;
    case "relevant": result = repo.relevant(typeof a.request === "string" ? a.request : ((a.request ?? {}) as RequestSlots), { limit: num("limit") }); break;
    default: result = refuse("unknown_tool");
  }
  return { schema: CODESEARCH_SCHEMA, tool: String(tool).slice(0, 40), result };
}
