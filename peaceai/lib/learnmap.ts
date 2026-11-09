// EXPERIMENTAL learn step 1: a program map of a repo PeaceAI has not studied.
// Read-only. credit is always false — nothing here is scored, graded, or wired into results.
// Reuses codesearch (tree, read, symbol, resolveSpecifier), symbols.buildIndex, and coreindex.TEXT_EXT.
// The CLI binds the typescript package through tsresolve before this module loads.
import ts from "typescript";
import { openRepo, isGeneratedPath, isTestPath, resolveSpecifier, type CodeRepo } from "./codesearch.ts";
import { TEXT_EXT } from "./coreindex.ts";
import { buildIndex, type IndexFile } from "./symbols.ts";

export const LEARN_MAP_SCHEMA = "peaceai-learn-map:v1" as const;
const CODE_EXT = /\.(?:[cm]?[jt]sx?)$/;
const byStr = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export interface ProgramModule {
  path: string;
  exports: string[];
  imports: string[];
  summary: string;
}
export interface ProgramEdge { from: string; to: string }
export interface ProgramTest { path: string; covers: string[] }
export interface ProgramMap {
  schema: typeof LEARN_MAP_SCHEMA;
  experimental: true;
  credit: false;
  modules: ProgramModule[];
  edges: ProgramEdge[];
  entryPoints: string[];
  tests: ProgramTest[];
}
export interface MapWrong { id: string; prompt: string; expected: string; actual: string }
export interface MapCheck { asked: number; correct: number; wrong: MapWrong[] }

interface SourceFile { path: string; content: string }

function readWhole(code: CodeRepo, path: string): string | null {
  let start = 1;
  let out = "";
  for (let guard = 0; guard < 100; guard++) {
    const r = code.read(path, { start, end: start + 1999 });
    if (!r.ok) return out ? out : null;
    out = out ? `${out}\n${r.text}` : r.text;
    if (!r.truncated) return out;
    start = r.endLine + 1;
  }
  return out;
}

/** Relative specifiers in import / export / require / dynamic import, in source order, de-duplicated. */
function specifiersOf(path: string, content: string): string[] {
  const kind = path.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(path, content, ts.ScriptTarget.Latest, true, kind);
  const out: string[] = [];
  const add = (spec: string) => { if (!out.includes(spec)) out.push(spec); };
  const visit = (n: ts.Node): void => {
    if ((ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) && n.moduleSpecifier && ts.isStringLiteral(n.moduleSpecifier)) add(n.moduleSpecifier.text);
    if (ts.isCallExpression(n) && n.arguments.length >= 1 && ts.isStringLiteralLike(n.arguments[0]!)) {
      const dyn = n.expression.kind === ts.SyntaxKind.ImportKeyword;
      const req = ts.isIdentifier(n.expression) && n.expression.text === "require";
      if (dyn || req) add(n.arguments[0]!.text);
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

function resolvedImports(path: string, content: string, known: ReadonlySet<string>): string[] {
  const hits = new Set<string>();
  for (const spec of specifiersOf(path, content)) {
    const to = resolveSpecifier(path, spec, known);
    if (to) hits.add(to);
  }
  return [...hits].sort(byStr);
}

function hasExportKeyword(node: ts.Node): boolean {
  return ts.canHaveModifiers(node) && (ts.getModifiers(node) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
}

/** Names other files can import from this module, including re-exports. Sorted. */
function exportNames(path: string, content: string): string[] {
  const kind = path.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(path, content, ts.ScriptTarget.Latest, true, kind);
  const names = new Set<string>();
  for (const st of sf.statements) {
    if (ts.isExportDeclaration(st) && st.exportClause && ts.isNamedExports(st.exportClause)) {
      for (const el of st.exportClause.elements) names.add(el.name.text);
      continue;
    }
    if (ts.isExportAssignment(st) && !st.isExportEquals) { names.add("default"); continue; }
    if (!hasExportKeyword(st)) continue;
    if (ts.isVariableStatement(st)) {
      for (const d of st.declarationList.declarations) if (ts.isIdentifier(d.name)) names.add(d.name.text);
      continue;
    }
    const nm = (st as ts.DeclarationStatement).name;
    if (nm && ts.isIdentifier(nm)) names.add(nm.text);
    else names.add("default");
  }
  return [...names].sort(byStr);
}

/** One line from the file's comments, else the export names, else the declared names. No network. */
function moduleSummary(path: string, content: string, exports: readonly string[], declared: readonly string[]): string {
  const kind = path.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(path, content, ts.ScriptTarget.Latest, true, kind);
  const notes: string[] = [];
  const add = (raw: string | undefined) => {
    const sentence = raw ? commentSentence(raw) : null;
    if (sentence && !notes.includes(sentence)) notes.push(sentence);
  };
  for (const st of sf.statements) for (const r of ts.getLeadingCommentRanges(content, st.getFullStart()) ?? []) add(content.slice(r.pos, r.end));
  if (notes.length === 0) add(/^\uFEFF?\s*(?:\/\*\*?[\s\S]*?\*\/|\/\/[^\n]*)/.exec(content)?.[0]);
  const line = notes.length ? notes.join(" ") : exports.length ? `exports ${exports.join(", ")}` : declared.length ? `declares ${declared.join(", ")}` : `module ${path.slice(path.lastIndexOf("/") + 1)}`;
  const flat = line.replace(/\s+/g, " ").trim();
  return flat.length > 160 ? `${flat.slice(0, 157)}...` : flat;
}

function commentSentence(raw: string): string | null {
  const body = raw.startsWith("/*") ? raw.slice(2, raw.endsWith("*/") ? -2 : undefined) : raw.replace(/^\/\/\s?/, "");
  const text = body.replace(/^\s*\* ?/gm, "").replace(/\s+/g, " ").trim();
  if (!text) return null;
  return text.split(/(?<=[.!?])\s/)[0] ?? text;
}

function packageEntries(code: CodeRepo, modules: ReadonlySet<string>): string[] {
  const r = code.read("package.json");
  if (!r.ok || r.truncated) return [];
  let pkg: Record<string, unknown>;
  try { pkg = JSON.parse(r.text) as Record<string, unknown>; } catch { return []; }
  const raw: string[] = [];
  for (const k of ["main", "module"]) if (typeof pkg[k] === "string") raw.push(pkg[k] as string);
  if (typeof pkg.bin === "string") raw.push(pkg.bin);
  else if (pkg.bin && typeof pkg.bin === "object") for (const v of Object.values(pkg.bin as Record<string, unknown>)) if (typeof v === "string") raw.push(v);
  const out: string[] = [];
  for (const rel of raw) {
    const norm = rel.replace(/^\.\//, "").replace(/\\/g, "/");
    if (modules.has(norm)) out.push(norm);
    else if (modules.has(`${norm}.ts`)) out.push(`${norm}.ts`);
    else if (modules.has(`${norm}/index.ts`)) out.push(`${norm}/index.ts`);
  }
  return out;
}

interface Scan { modules: ProgramModule[]; edges: ProgramEdge[]; tests: ProgramTest[]; entryPoints: string[] }

function scanRepo(repoPath: string): Scan {
  const code = openRepo(repoPath);
  const tree = code.tree();
  if (!tree.ok) throw new Error(`learn-map: ${tree.reason}`);
  const codePaths = tree.files.filter((p) => TEXT_EXT.test(p) && CODE_EXT.test(p) && !isGeneratedPath(p)).sort(byStr);
  const files: SourceFile[] = [];
  for (const path of codePaths) {
    const content = readWhole(code, path);
    if (content !== null) files.push({ path, content });
  }
  const known = new Set(files.map((f) => f.path));
  const indexFiles: IndexFile[] = files.map((f) => ({ path: f.path, content: f.content }));
  const index = buildIndex(indexFiles);
  const moduleSet = new Set(files.filter((f) => !isTestPath(f.path)).map((f) => f.path));
  const modules: ProgramModule[] = [];
  for (const f of files) {
    if (!moduleSet.has(f.path)) continue;
    const declared = (index.fileSymbols.get(f.path) ?? []).slice().sort(byStr);
    const exports = [...new Set([...index.defs.filter((d) => d.path === f.path && d.exported && d.scope === "module").map((d) => d.name), ...exportNames(f.path, f.content)])].sort(byStr);
    const imports = resolvedImports(f.path, f.content, known).filter((p) => moduleSet.has(p));
    modules.push({ path: f.path, exports, imports, summary: moduleSummary(f.path, f.content, exports, declared) });
  }
  modules.sort((a, b) => byStr(a.path, b.path));
  const edges: ProgramEdge[] = [];
  for (const m of modules) for (const to of m.imports) edges.push({ from: m.path, to });
  edges.sort((a, b) => byStr(a.from, b.from) || byStr(a.to, b.to));
  const tests: ProgramTest[] = [];
  for (const f of files) {
    if (!isTestPath(f.path)) continue;
    const covers = resolvedImports(f.path, f.content, known).filter((p) => moduleSet.has(p));
    tests.push({ path: f.path, covers });
  }
  tests.sort((a, b) => byStr(a.path, b.path));
  const incoming = new Set(edges.map((e) => e.to));
  let entryPoints = [...new Set([...packageEntries(code, moduleSet), ...modules.filter((m) => !incoming.has(m.path)).map((m) => m.path)])].sort(byStr);
  if (entryPoints.length === 0) entryPoints = modules.filter((m) => /(?:^|\/)index\.[cm]?[jt]sx?$/.test(m.path)).map((m) => m.path).sort(byStr);
  return { modules, edges, tests, entryPoints };
}

/** Reads `repoPath` and returns a deterministic program map. Does not write. */
export function buildProgramMap(repoPath: string): ProgramMap {
  const scan = scanRepo(repoPath);
  return {
    schema: LEARN_MAP_SCHEMA,
    experimental: true,
    credit: false,
    modules: scan.modules,
    edges: scan.edges,
    entryPoints: scan.entryPoints,
    tests: scan.tests,
  };
}

interface Question { id: string; prompt: string; expected: string; answer(repoPath: string): string }

/** About ten questions taken from the map. Every claimed edge is asked, so a bad edge cannot hide. */
function questions(map: ProgramMap): Question[] {
  const edges: Question[] = map.edges.map((e) => ({
    id: `edge:${e.from}>${e.to}`,
    prompt: `does ${e.from} import ${e.to}?`,
    expected: "yes",
    answer: (repo) => (scanRepo(repo).edges.some((x) => x.from === e.from && x.to === e.to) ? "yes" : "no"),
  }));
  const rest: { q: Question; rank: number }[] = [];
  for (const m of map.modules) rest.push({ rank: 0, q: {
    id: `imports:${m.path}`,
    prompt: `what does ${m.path} import?`,
    expected: m.imports.join(","),
    answer: (repo) => scanRepo(repo).modules.find((x) => x.path === m.path)?.imports.join(",") ?? "absent",
  } });
  const covered = new Map<string, string[]>();
  for (const t of map.tests) for (const c of t.covers) {
    const list = covered.get(c) ?? [];
    list.push(t.path);
    covered.set(c, list);
  }
  for (const [mod, tests] of [...covered.entries()].sort((a, b) => byStr(a[0], b[0]))) rest.push({ rank: 1, q: {
    id: `covered:${mod}`,
    prompt: `which tests cover ${mod}?`,
    expected: tests.slice().sort(byStr).join(","),
    answer: (repo) => scanRepo(repo).tests.filter((t) => t.covers.includes(mod)).map((t) => t.path).sort(byStr).join(","),
  } });
  const byExport = new Map<string, string[]>();
  for (const m of map.modules) for (const name of m.exports) {
    const list = byExport.get(name) ?? [];
    list.push(m.path);
    byExport.set(name, list);
  }
  for (const [name, paths] of [...byExport.entries()].sort((a, b) => byStr(a[0], b[0]))) rest.push({ rank: 2, q: {
    id: `export:${name}`,
    prompt: `which module exports ${name}?`,
    expected: paths.slice().sort(byStr).join(","),
    answer: (repo) => exportersOf(repo, name).join(","),
  } });
  rest.sort((a, b) => a.rank - b.rank || byStr(a.q.id, b.q.id));
  const out = [...edges];
  for (const item of rest) {
    if (out.length >= 10 && edges.length <= 10) break;
    out.push(item.q);
  }
  return out;
}

/** Modules that really export `name`, from codesearch's symbol tool (definitions and re-exports). */
function exportersOf(repoPath: string, name: string): string[] {
  const code = openRepo(repoPath);
  const hit = code.symbol(name);
  if (!hit.ok) return [];
  const paths = new Set<string>();
  for (const d of hit.definitions) if (d.exported && !isTestPath(d.path)) paths.add(d.path);
  for (const e of hit.reexports) if (!isTestPath(e.path) && e.exported === name) paths.add(e.path);
  return [...paths].sort(byStr);
}

/**
 * Asks questions generated from `map` ("which module exports X", "what does Y import", "which tests cover Z")
 * and checks each answer against the files in `repoPath`. Trusted only when every answer is correct.
 */
export function checkMap(map: ProgramMap, repoPath: string): MapCheck {
  const wrong: MapWrong[] = [];
  const qs = questions(map);
  for (const q of qs) {
    const actual = q.answer(repoPath);
    if (actual !== q.expected) wrong.push({ id: q.id, prompt: q.prompt, expected: q.expected, actual });
  }
  return { asked: qs.length, correct: qs.length - wrong.length, wrong };
}
