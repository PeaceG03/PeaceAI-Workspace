// M6: CPU repo symbol and keyword index, built per target inside the job from the files in scope.
// Deterministic (sorted inputs, no clocks, no randomness), in memory only: nothing here is written to
// disk, uploaded, or printed beyond counts. Name-based (no type checker), which is enough to resolve
// task targets such as "function X", "type Y", "the config" and to find related files.
import { posix } from "node:path";
import ts from "typescript";

export type SymbolKind =
  | "function"
  | "const"
  | "let"
  | "var"
  | "type"
  | "interface"
  | "enum"
  | "class"
  | "method"
  | "property"
  | "parameter"
  | "local";

export interface SymbolDef {
  name: string;
  kind: SymbolKind;
  path: string;
  line: number;
  exported: boolean;
  /** "module" = top-level declaration; "local" = inside a function, class or block. */
  scope: "module" | "local";
  /** Enclosing top-level symbol for locals (e.g. the function a parameter belongs to). */
  container: string | null;
}

export interface SymbolRef {
  path: string;
  line: number;
}

export interface IndexFile {
  path: string;
  content: string;
}

export interface RepoIndex {
  files: string[];
  defs: SymbolDef[];
  /** name -> reference sites (identifier uses that are not the declaration itself), sorted. */
  refs: Map<string, SymbolRef[]>;
  /** path -> names declared at module scope in that file, sorted. */
  fileSymbols: Map<string, string[]>;
  /** path -> repo files it imports (relative imports resolved within the index), sorted. */
  imports: Map<string, string[]>;
  /** BM25 keyword index over identifiers (split into words), comments and string text. */
  bm25: Bm25;
}

interface Bm25 {
  docs: Map<string, Map<string, number>>;
  lengths: Map<string, number>;
  df: Map<string, number>;
  avgLength: number;
}

export const MAX_INDEX_FILES = 5000;
export const MAX_INDEX_FILE_BYTES = 400_000;

/** Lower-cased word tokens: identifiers are split on camelCase, PascalCase, snake_case and digits. */
export function tokenize(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.match(/[A-Za-z_$][\w$]*|\d+/g) ?? []) {
    const parts = raw
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
      .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
      .split(/[\s_$]+/)
      .filter(Boolean)
      .map((p) => p.toLowerCase());
    for (const p of parts) if (p.length >= 2 && !STOP.has(p)) out.push(p);
    const whole = raw.toLowerCase();
    if (parts.length > 1 && whole.length >= 3) out.push(whole);
  }
  return out;
}

const STOP = new Set(
  "the a an and or of to in on for is are be with as at by it this that from into const let var function return export import type interface new if else true false null undefined".split(
    " ",
  ),
);

function lineOf(file: ts.SourceFile, pos: number): number {
  return file.getLineAndCharacterOfPosition(pos).line + 1;
}

function hasExport(node: ts.Node): boolean {
  if (!ts.canHaveModifiers(node)) return false;
  const mods = ts.getModifiers(node);
  return mods !== undefined && mods.some((mod) => mod.kind === ts.SyntaxKind.ExportKeyword);
}

function resolveRelative(from: string, specifier: string, known: ReadonlySet<string>): string | null {
  if (!specifier.startsWith(".")) return null;
  const base = posix.normalize(posix.join(posix.dirname(from), specifier)).replace(/\.(?:js|mjs|cjs)$/, "");
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`]) if (known.has(candidate)) return candidate;
  return null;
}

/** Builds the index. Files over the size cap, or beyond the file cap, are skipped (counted, not read). */
export function buildIndex(input: readonly IndexFile[]): RepoIndex & { skipped: number } {
  const sorted = [...input].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const files = sorted.filter((f) => Buffer.byteLength(f.content) <= MAX_INDEX_FILE_BYTES).slice(0, MAX_INDEX_FILES);
  const skipped = sorted.length - files.length;
  const known = new Set(files.map((f) => f.path));
  const defs: SymbolDef[] = [];
  const refs = new Map<string, SymbolRef[]>();
  const fileSymbols = new Map<string, string[]>();
  const imports = new Map<string, string[]>();
  const docs = new Map<string, Map<string, number>>();
  const lengths = new Map<string, number>();

  for (const f of files) {
    const sf = ts.createSourceFile(f.path, f.content, ts.ScriptTarget.Latest, true, f.path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const declared = new Set<ts.Node>();
    const top: string[] = [];
    const add = (name: ts.Identifier, kind: SymbolKind, exported: boolean, scope: "module" | "local", container: string | null) => {
      declared.add(name);
      defs.push({ name: name.text, kind, path: f.path, line: lineOf(sf, name.getStart(sf)), exported, scope, container });
      if (scope === "module") top.push(name.text);
    };
    const exportedNames = new Set<string>();
    for (const s of sf.statements)
      if (ts.isExportDeclaration(s) && !s.moduleSpecifier && s.exportClause && ts.isNamedExports(s.exportClause))
        for (const el of s.exportClause.elements) exportedNames.add((el.propertyName ?? el.name).text);
    const fileImports = new Set<string>();

    const visit = (node: ts.Node, container: string | null, depth: number) => {
      const scope = depth === 0 ? "module" : "local";
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
        const hit = resolveRelative(f.path, node.moduleSpecifier.text, known);
        if (hit) fileImports.add(hit);
        if (ts.isImportDeclaration(node) && node.importClause) {
          // Imported names are bindings, not definitions or references.
          node.importClause.name && declared.add(node.importClause.name);
          const nb = node.importClause.namedBindings;
          if (nb && ts.isNamedImports(nb)) for (const el of nb.elements) { declared.add(el.name); if (el.propertyName) declared.add(el.propertyName); }
          if (nb && ts.isNamespaceImport(nb)) declared.add(nb.name);
        }
      }
      let next = container;
      if (ts.isFunctionDeclaration(node) && node.name) {
        add(node.name, depth === 0 ? "function" : "local", depth === 0 && (hasExport(node) || exportedNames.has(node.name.text)), scope, container);
        next = container ?? node.name.text;
      } else if (ts.isClassDeclaration(node) && node.name) {
        add(node.name, depth === 0 ? "class" : "local", depth === 0 && (hasExport(node) || exportedNames.has(node.name.text)), scope, container);
        next = container ?? node.name.text;
      } else if (ts.isInterfaceDeclaration(node)) {
        add(node.name, depth === 0 ? "interface" : "local", depth === 0 && (hasExport(node) || exportedNames.has(node.name.text)), scope, container);
        next = container ?? node.name.text;
      } else if (ts.isTypeAliasDeclaration(node)) {
        add(node.name, depth === 0 ? "type" : "local", depth === 0 && (hasExport(node) || exportedNames.has(node.name.text)), scope, container);
        next = container ?? node.name.text;
      } else if (ts.isEnumDeclaration(node)) {
        add(node.name, depth === 0 ? "enum" : "local", depth === 0 && (hasExport(node) || exportedNames.has(node.name.text)), scope, container);
        next = container ?? node.name.text;
      } else if (ts.isVariableStatement(node)) {
        const flags = node.declarationList.flags;
        const kind: SymbolKind = depth > 0 ? "local" : flags & ts.NodeFlags.Const ? "const" : flags & ts.NodeFlags.Let ? "let" : "var";
        for (const d of node.declarationList.declarations)
          if (ts.isIdentifier(d.name)) {
            add(d.name, kind, depth === 0 && (hasExport(node) || exportedNames.has(d.name.text)), scope, container);
            if (depth === 0) {
              for (const c of d.getChildren(sf)) visit(c, container ?? d.name.text, 1);
              declared.add(d.name);
            }
          }
        if (depth === 0) return;
      } else if (ts.isVariableDeclaration(node) && depth > 0 && ts.isIdentifier(node.name) && !declared.has(node.name)) {
        add(node.name, "local", false, "local", container);
      } else if (ts.isParameter(node) && ts.isIdentifier(node.name)) {
        add(node.name, "parameter", false, "local", container);
      } else if ((ts.isMethodDeclaration(node) || ts.isMethodSignature(node)) && ts.isIdentifier(node.name)) {
        add(node.name, "method", false, "local", container);
      } else if ((ts.isPropertyDeclaration(node) || ts.isPropertySignature(node)) && ts.isIdentifier(node.name)) {
        add(node.name, "property", false, "local", container);
      } else if (ts.isIdentifier(node) && !declared.has(node)) {
        const parent = node.parent;
        // `obj.name` property accesses and object-literal keys are not references to a symbol `name`.
        const isMember = parent && ts.isPropertyAccessExpression(parent) && parent.name === node;
        const isKey = parent && ts.isPropertyAssignment(parent) && parent.name === node;
        if (!isMember && !isKey) {
          const list = refs.get(node.text) ?? [];
          list.push({ path: f.path, line: lineOf(sf, node.getStart(sf)) });
          refs.set(node.text, list);
        }
      }
      node.forEachChild((child) => visit(child, next, depth + 1));
    };
    sf.forEachChild((child) => visit(child, null, 0));
    fileSymbols.set(f.path, [...new Set(top)].sort());
    imports.set(f.path, [...fileImports].sort());

    // BM25 document: path words + identifiers + comments + string text.
    const terms = new Map<string, number>();
    const words = [...tokenize(f.path.replace(/\.[jt]sx?$/, "")), ...tokenize(f.content)];
    for (const w of words) terms.set(w, (terms.get(w) ?? 0) + 1);
    docs.set(f.path, terms);
    lengths.set(f.path, words.length);
  }
  const df = new Map<string, number>();
  for (const terms of docs.values()) for (const t of terms.keys()) df.set(t, (df.get(t) ?? 0) + 1);
  const total = [...lengths.values()].reduce((a, b) => a + b, 0);
  for (const list of refs.values()) list.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : a.line - b.line));
  defs.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : a.line - b.line || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)));
  return {
    files: files.map((f) => f.path),
    defs,
    refs,
    fileSymbols,
    imports,
    bm25: { docs, lengths, df, avgLength: files.length ? total / files.length : 0 },
    skipped,
  };
}

/** Okapi BM25 (k1 = 1.2, b = 0.75). Ties break by path, so results are stable. */
export function search(index: RepoIndex, query: string, limit = 10): { path: string; score: number }[] {
  const terms = [...new Set(tokenize(query))];
  const n = index.files.length;
  const out: { path: string; score: number }[] = [];
  for (const path of index.files) {
    const doc = index.bm25.docs.get(path)!;
    const len = index.bm25.lengths.get(path)!;
    let score = 0;
    for (const t of terms) {
      const tf = doc.get(t) ?? 0;
      if (!tf) continue;
      const df = index.bm25.df.get(t) ?? 0;
      const idf = Math.log(1 + (n - df + 0.5) / (df + 0.5));
      score += (idf * tf * 2.2) / (tf + 1.2 * (1 - 0.75 + (0.75 * len) / (index.bm25.avgLength || 1)));
    }
    if (score > 0) out.push({ path, score: Math.round(score * 1e6) / 1e6 });
  }
  return out.sort((a, b) => b.score - a.score || (a.path < b.path ? -1 : 1)).slice(0, limit);
}

export function definitions(index: RepoIndex, name: string, kinds?: readonly SymbolKind[]): SymbolDef[] {
  return index.defs.filter((d) => d.name === name && d.scope === "module" && (!kinds || kinds.includes(d.kind)));
}

export function references(index: RepoIndex, name: string): SymbolRef[] {
  return index.refs.get(name) ?? [];
}

export interface ResolvedTarget {
  path: string;
  symbol: string | null;
  kind: SymbolKind | "file" | "config";
  reason: string;
}

const KIND_WORDS: Record<string, SymbolKind[]> = {
  function: ["function"],
  helper: ["function", "const"],
  method: ["function"],
  type: ["type", "interface"],
  interface: ["interface", "type"],
  enum: ["enum", "type"],
  union: ["type"],
  class: ["class"],
  const: ["const"],
  constant: ["const"],
  object: ["const"],
  array: ["const"],
  list: ["const"],
  config: ["const"],
  map: ["const"],
  variable: ["const", "let", "var"],
};

const CONFIG_FILE = /(?:^|\/)(?:config|configuration|settings|defaults|options)(?:\.[\w-]+)?\.tsx?$/i;

/**
 * Resolves what a task points at: files named by path, "<kind> <Name>" phrases ("function parseCount",
 * "type Profile", "object DEFAULTS"), bare identifiers with exactly one module-level definition, and
 * "the config". Ordered by strength of the match, deduplicated by path. Test files are never targets.
 */
export function resolveTargets(index: RepoIndex, objective: string, isTest: (path: string) => boolean): ResolvedTarget[] {
  const out: ResolvedTarget[] = [];
  const seen = new Set<string>();
  const push = (t: ResolvedTarget) => {
    if (isTest(t.path) || seen.has(t.path)) return;
    seen.add(t.path);
    out.push(t);
  };
  for (const path of objective.match(/\b[\w./-]+\.tsx?\b/g) ?? []) if (index.files.includes(path)) push({ path, symbol: null, kind: "file", reason: "named file" });
  for (const m of objective.matchAll(/\b(function|helper|method|type|interface|enum|union|class|const|constant|object|array|list|config|map|variable)\s+`?([A-Za-z_$][\w$]{0,63})`?/gi)) {
    const kinds = KIND_WORDS[m[1]!.toLowerCase()]!;
    const hits = definitions(index, m[2]!, kinds).filter((d) => !isTest(d.path));
    if (hits.length === 1) push({ path: hits[0]!.path, symbol: hits[0]!.name, kind: hits[0]!.kind, reason: `${m[1]!.toLowerCase()} ${m[2]}` });
  }
  for (const id of new Set(objective.match(/[A-Za-z_$][\w$]{2,63}/g) ?? [])) {
    if (!/[a-z][A-Z]|^[A-Z][a-z]+[A-Z]|_|^[A-Z][A-Z0-9]{2,}$|^[A-Z][a-z]{2,}$/.test(id)) continue;
    const hits = definitions(index, id).filter((d) => !isTest(d.path));
    if (hits.length === 1) push({ path: hits[0]!.path, symbol: id, kind: hits[0]!.kind, reason: `symbol ${id}` });
  }
  if (/\bthe (?:config|configuration|settings|defaults)\b/i.test(objective)) {
    const configs = index.files.filter((p) => CONFIG_FILE.test(p) && !isTest(p));
    // Shallowest config file first (src/config.ts before src/a/b/config.ts).
    configs.sort((a, b) => a.split("/").length - b.split("/").length || (a < b ? -1 : 1));
    if (configs[0]) push({ path: configs[0], symbol: null, kind: "config", reason: "the config" });
  }
  return out;
}

/**
 * Files related to the given ones: files they import, files importing them, and files referencing the
 * symbols they define (in that order of strength), each group sorted. The inputs are excluded.
 */
export function relatedFiles(index: RepoIndex, paths: readonly string[], limit = 12): string[] {
  const given = new Set(paths);
  const scored = new Map<string, number>();
  const bump = (p: string, s: number) => {
    if (!given.has(p)) scored.set(p, (scored.get(p) ?? 0) + s);
  };
  for (const p of paths) {
    for (const dep of index.imports.get(p) ?? []) bump(dep, 4);
    for (const [file, deps] of index.imports) if (deps.includes(p)) bump(file, 3);
    for (const name of index.fileSymbols.get(p) ?? []) for (const r of references(index, name)) if (r.path !== p) bump(r.path, 1);
  }
  return [...scored.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, limit).map(([p]) => p);
}

/** Counts only: what the job may log about the index. */
export function indexStats(index: RepoIndex & { skipped?: number }): string {
  const exported = index.defs.filter((d) => d.exported).length;
  const local = index.defs.filter((d) => d.scope === "local").length;
  const refCount = [...index.refs.values()].reduce((a, l) => a + l.length, 0);
  return `index_files=${index.files.length} index_skipped=${index.skipped ?? 0} symbols=${index.defs.length} exported=${exported} local=${local} refs=${refCount} terms=${index.bm25.df.size}`;
}
