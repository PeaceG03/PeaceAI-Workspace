// Fills trigger slots the sentence left blank, from the repository at the base tree.
// A slot is filled only when exactly one candidate survives. Zero or two or more refuse.
// The line that comes out is one an already-approved rule can parse. This module adds no rule.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { relative, sep } from "node:path";
import ts from "typescript";
import { IMPORT_EDIT_V2_TRIGGER, parseImportEditV2Task } from "./import-edit-v2.ts";
import { TEST_EXISTING_TRIGGER } from "./learned-test-existing.ts";
import { parseTsconfigScriptTask, TSCONFIG_SCRIPT_TRIGGER } from "./tsconfig-script.ts";

export interface SlotFile { path: string; content: string }

/** One import diagnostic the type checker reported, plus the specifier it points at. */
export interface ImportHit { code: 5097 | 2307; file: string; specifier: string }

export interface SlotRepo {
  files: readonly SlotFile[];
  /** Present only when the sentence asks to fix a typecheck failure. */
  diagnostics?: readonly ImportHit[];
}

const SOURCE = /\.(?:tsx|mts|cts|ts)$/;
const TEST_FILE = /\.(?:test|spec)\.(?:tsx|mts|cts|ts)$/;
const SCRIPT_NAME = /^[a-z][a-z0-9-]{0,20}$/;
const RELATIVE = /^\.{1,2}\//;
const EXT = /\.(tsx|mts|cts|ts)$/;

/** The sentence asks to fix a type error, not to add a typecheck script. */
export function typecheckFailureWording(asked: string): boolean {
  if (/\btypecheck:[a-z][a-z0-9-]{0,20}\b/i.test(asked) || /\btsconfig\.[a-z][a-z0-9-]{0,20}\.json\b/i.test(asked)) return false;
  return /\b(?:fix|repair|resolve)\b[^.\n]{0,160}\btypecheck\b|\btypecheck failure\b|\bTS5097\b|\bTS2307\b/i.test(asked);
}

/** A characterization sentence that does not already name the file. */
export function testSlotWording(asked: string): boolean {
  if (!/\bcharacteri[sz]ation test\b/i.test(asked)) return false;
  return !/\bcharacteri[sz]ation test for [`']?[A-Za-z_$][\w$]*[`']? in [`']?[\w./-]+\.[cm]?[jt]sx?/i.test(asked);
}

/** A typecheck-script sentence that does not already name the mode. */
export function tsconfigSlotWording(asked: string): boolean {
  if (!(/\btypecheck:[a-z][a-z0-9-]{0,20}\b/i.test(asked) || /\btsconfig\.[a-z][a-z0-9-]{0,20}\.json\b/i.test(asked))) return false;
  return !/\bexcluding\b|\bchecking only\b|\bwith checkJs\b/i.test(asked);
}

/** The router should open the base tree before refusing these sentences. */
export function needsRepoSlots(asked: string): boolean {
  return typecheckFailureWording(asked) || testSlotWording(asked) || tsconfigSlotWording(asked);
}

function posix(path: string): string {
  return path.split(sep).join("/");
}

/** Source, test, package.json and root tsconfig files. Skips dependencies and build output. */
export function readSlotTree(root: string): SlotFile[] {
  const out: SlotFile[] = [];
  const skip = new Set(["node_modules", ".git", "dist", "coverage", ".next", "build"]);
  const walk = (dir: string): void => {
    let names: string[] = [];
    try { names = readdirSync(dir); } catch { return; }
    for (const name of names) {
      if (skip.has(name)) continue;
      const abs = `${dir}/${name}`;
      let st;
      try { st = statSync(abs); } catch { continue; }
      if (st.isDirectory()) { walk(abs); continue; }
      if (!st.isFile() || st.size > 1_000_000) continue;
      const rel = posix(relative(root, abs));
      if (rel === "package.json" || /^tsconfig(?:\.[A-Za-z0-9_-]+)?\.json$/.test(rel) || SOURCE.test(rel)) {
        try { out.push({ path: rel, content: readFileSync(abs, "utf8") }); } catch { /* unreadable */ }
      }
    }
  };
  walk(root);
  return out;
}

function specifierAt(file: ts.SourceFile, start: number): string | null {
  let found: string | null = null;
  const visit = (n: ts.Node): void => {
    if (found) return;
    if (ts.isStringLiteral(n) && n.getStart(file) <= start && start < n.getEnd()) {
      const p = n.parent;
      if (p && (ts.isImportDeclaration(p) || ts.isExportDeclaration(p)) && p.moduleSpecifier === n) found = n.text;
    }
    ts.forEachChild(n, visit);
  };
  visit(file);
  return found;
}

/**
 * TS5097 and TS2307 from the repo's own tsconfig. A missing compiler config yields none.
 * Plugins are dropped: a missing plugin host must not hide the import diagnostic.
 */
export function readImportDiagnostics(root: string): ImportHit[] {
  const configPath = ts.findConfigFile(root, ts.sys.fileExists, "tsconfig.json");
  if (!configPath) return [];
  const read = ts.readConfigFile(configPath, ts.sys.readFile);
  if (read.error) return [];
  const parseHost: ts.ParseConfigHost = { useCaseSensitiveFileNames: true, readDirectory: ts.sys.readDirectory, fileExists: ts.sys.fileExists, readFile: ts.sys.readFile };
  const parsed = ts.parseJsonConfigFileContent(read.config, parseHost, root);
  const host = ts.createCompilerHost(parsed.options, true);
  const options: ts.CompilerOptions = { ...parsed.options };
  delete options.plugins; // slot-guard:no-plugin
  // A plugin host is not this process. Leaving the list on the program is not the repo's plain typecheck.
  const pluginsLeft = (options as { plugins?: readonly { name?: string }[] }).plugins;
  if (pluginsLeft?.length) return [];
  const program = ts.createProgram({ rootNames: parsed.fileNames, options, host });
  const out: ImportHit[] = [];
  for (const d of ts.getPreEmitDiagnostics(program)) {
    if ((d.code !== 5097 && d.code !== 2307) || !d.file || d.start === undefined) continue;
    const specifier = specifierAt(d.file, d.start);
    if (!specifier) continue;
    out.push({ code: d.code as 5097 | 2307, file: posix(relative(root, d.file.fileName)), specifier });
  }
  return out;
}

export function readSlotRepo(root: string, asked: string): SlotRepo {
  const files = readSlotTree(root);
  if (!typecheckFailureWording(asked)) return { files };
  return { files, diagnostics: readImportDiagnostics(root) };
}

function one<T>(items: readonly T[]): T | null {
  return items.length === 1 ? items[0]! : null;
}

function quoteOf(text: string, start: number): string {
  const q = text[start];
  return q === "'" || q === "`" ? q : '"';
}

/** The import statement with only its specifier replaced. Null when the specifier is not unique in the file. */
function rewrittenImport(content: string, from: string, to: string, tsx: boolean): string | null {
  const sf = ts.createSourceFile(tsx ? "m.tsx" : "m.ts", content, ts.ScriptTarget.Latest, true, tsx ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const hits = sf.statements.filter((s): s is ts.ImportDeclaration => ts.isImportDeclaration(s) && ts.isStringLiteral(s.moduleSpecifier) && s.moduleSpecifier.text === from);
  const hit = one(hits);
  if (!hit || !ts.isStringLiteral(hit.moduleSpecifier)) return null;
  const lit = hit.moduleSpecifier;
  const q = quoteOf(content, lit.getStart(sf));
  const next = content.slice(0, lit.getStart(sf)) + q + to + q + content.slice(lit.getEnd());
  const nsf = ts.createSourceFile(tsx ? "n.tsx" : "n.ts", next, ts.ScriptTarget.Latest, true, tsx ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const again = nsf.statements.filter((s): s is ts.ImportDeclaration => ts.isImportDeclaration(s) && ts.isStringLiteral(s.moduleSpecifier) && s.moduleSpecifier.text === to);
  const kept = one(again);
  return kept ? kept.getText(nsf).trim() : null;
}

function resolves(file: string, spec: string, files: ReadonlySet<string>): boolean {
  if (!RELATIVE.test(spec)) return false;
  const dir = file.split("/").slice(0, -1);
  const parts = spec.split("/");
  const stack = [...dir];
  for (const part of parts) {
    if (part === "." || part === "") continue;
    if (part === "..") stack.pop();
    else stack.push(part);
  }
  const joined = stack.join("/");
  if (!joined || joined.startsWith("..")) return false;
  const bare = joined.replace(EXT, "");
  return ["", ".ts", ".tsx", ".mts", ".cts", "/index.ts", "/index.tsx"].some((ext) => files.has(bare + ext) || files.has(joined + ext));
}

interface ImportCandidate { file: string; from: string; to: string }

function importCandidates(repo: SlotRepo): ImportCandidate[] {
  const paths = new Set(repo.files.map((f) => f.path));
  const byFile = new Map(repo.files.map((f) => [f.path, f.content]));
  const seen = new Set<string>();
  const out: ImportCandidate[] = [];
  for (const hit of repo.diagnostics ?? []) {
    if (!RELATIVE.test(hit.specifier) || !SOURCE.test(hit.file) || hit.file.endsWith(".d.ts")) continue;
    const content = byFile.get(hit.file);
    if (content === undefined) continue;
    let next = "";
    if (hit.code === 5097 && EXT.test(hit.specifier)) next = hit.specifier.replace(EXT, "");
    else if (hit.code === 2307) {
      const choices = [".ts", ".tsx", ".mts", ".cts", "/index.ts"].map((ext) => hit.specifier + ext).filter((spec) => resolves(hit.file, spec, paths));
      const choice = one(choices);
      if (!choice) continue;
      next = choice;
    } else continue;
    if (!next || next === hit.specifier || !resolves(hit.file, next, paths)) continue; // slot-guard:resolves
    const key = `${hit.file}\0${hit.specifier}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const statement = rewrittenImport(content, hit.specifier, next, hit.file.endsWith(".tsx"));
    if (!statement) continue;
    out.push({ file: hit.file, from: hit.specifier, to: statement });
  }
  return out;
}

/** `fix the import of SPEC in FILE to: import ...` when the type checker names exactly one. */
export function importLine(asked: string, repo: SlotRepo): string | null {
  if (!typecheckFailureWording(asked) || !repo.diagnostics) return null;
  const cands = importCandidates(repo);
  if (cands.length !== 1) return null; // slot-guard:one-import
  const hit = cands[0]!;
  const line = `fix the import of ${hit.from} in ${hit.file} to: ${hit.to}`;
  if (!parseImportEditV2Task(IMPORT_EDIT_V2_TRIGGER, line)) return null; // slot-guard:import-trigger
  return line;
}

interface ExportHit { name: string; file: string }

function hasModifier(n: ts.Node, kind: ts.SyntaxKind): boolean {
  return ts.canHaveModifiers(n) && (ts.getModifiers(n) ?? []).some((m) => m.kind === kind);
}

function hasExport(n: ts.Node): boolean {
  return hasModifier(n, ts.SyntaxKind.ExportKeyword);
}

/** `export default function name` is not a named export. The characterization import would be wrong. */
function isDefaultExport(n: ts.Node): boolean {
  return hasModifier(n, ts.SyntaxKind.DefaultKeyword);
}

function exportedFunctions(files: readonly SlotFile[]): ExportHit[] {
  const out: ExportHit[] = [];
  for (const f of files) {
    if (!SOURCE.test(f.path) || f.path.endsWith(".d.ts") || TEST_FILE.test(f.path)) continue;
    const tsx = f.path.endsWith(".tsx");
    const sf = ts.createSourceFile(tsx ? "m.tsx" : "m.ts", f.content, ts.ScriptTarget.Latest, true, tsx ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    for (const s of sf.statements) {
      if (ts.isFunctionDeclaration(s) && s.name && hasExport(s) && !isDefaultExport(s) && s.body) out.push({ name: s.name.text, file: f.path });
      if (ts.isVariableStatement(s) && hasExport(s)) {
        for (const d of s.declarationList.declarations) {
          if (!ts.isIdentifier(d.name) || !d.initializer) continue;
          if (ts.isArrowFunction(d.initializer) || ts.isFunctionExpression(d.initializer)) out.push({ name: d.name.text, file: f.path });
        }
      }
    }
  }
  return out;
}

function wordsIn(asked: string): Set<string> {
  return new Set(asked.match(/[A-Za-z_$][\w$]*/g) ?? []);
}

function bulletLines(asked: string): string[] {
  return asked.split("\n").map((l) => l.trim()).filter((l) => /^[-*] /.test(l));
}

/** Characterization header for the one exported function the sentence names. */
export function testLine(asked: string, repo: SlotRepo): string | null {
  if (!/\bcharacteri[sz]ation test\b/i.test(asked)) return null;
  const words = wordsIn(asked);
  const hits = exportedFunctions(repo.files).filter((e) => words.has(e.name));
  const keys = [...new Map(hits.map((h) => [`${h.name}\0${h.file}`, h])).values()];
  if (keys.length !== 1) return null; // slot-guard:one-export
  const hit = keys[0]!;
  const title = /characteri[sz]ation test for [`']?[A-Za-z_$][\w$]*[`']?(?: in [`']?[\w./-]+\.[cm]?[jt]sx?[`']?)?: ([^#\n]{1,80})/i.exec(asked);
  const header = `add a characterization test for ${hit.name} in ${hit.file}${title ? `: ${title[1]!.trim()}` : ""}`;
  const line = [header, ...bulletLines(asked)].join("\n");
  return new RegExp(TEST_EXISTING_TRIGGER, "i").test(header) ? line : null;
}

function scriptNames(asked: string): string | null {
  const names = new Set<string>();
  for (const m of asked.matchAll(/\btypecheck:([a-z][a-z0-9-]{0,20})\b/gi)) names.add(m[1]!.toLowerCase());
  for (const m of asked.matchAll(/\btsconfig\.([a-z][a-z0-9-]{0,20})\.json\b/gi)) names.add(m[1]!.toLowerCase());
  const name = one([...names]);
  return name && SCRIPT_NAME.test(name) ? name : null;
}

/** The request points at one entry, not at the whole library. "read-only" is not that cue. */
function singleEntry(asked: string): boolean {
  return /\bover\b/i.test(asked) || /\bchecking only\b/i.test(asked) || /\b[\w./-]+\.(?:tsx|mts|ts)\b/.test(asked);
}

function stemTokens(path: string): string[] {
  const base = path.split("/").pop() ?? "";
  const stem = base.replace(EXT, "");
  return stem.split(/[^A-Za-z0-9]+/).filter(Boolean).map((t) => t.toLowerCase());
}

function globToReg(glob: string): RegExp | null {
  if (!/^[A-Za-z0-9_*./-]+$/.test(glob)) return null;
  const body = glob
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*\//g, "(?:.*/)?")
    .replace(/\*\*/g, ".*")
    .replace(/\*/g, "[^/]*");
  return new RegExp(`^${body}$`);
}

function matchGlob(glob: string, path: string): boolean {
  const re = globToReg(glob);
  return !!re && re.test(path);
}

interface TsCandidate { name: string; mode: "exclude" | "files" | "checkjs"; pattern: string }

function fileCandidates(name: string, files: readonly SlotFile[]): string[] {
  return files.filter((f) => SOURCE.test(f.path) && !TEST_FILE.test(f.path) && !f.path.endsWith(".d.ts") && (stemTokens(f.path).includes(name) || f.path.split("/").pop()?.replace(EXT, "").toLowerCase() === name)).map((f) => f.path);
}

function namedPaths(asked: string, files: ReadonlySet<string>): string[] {
  const paths = asked.match(/\b[\w./-]+\.(?:tsx|mts|ts)\b/g) ?? [];
  return [...new Set(paths.filter((p) => files.has(p) && SOURCE.test(p) && !TEST_FILE.test(p)))];
}

function includeGlobs(content: string): string[] | null {
  try {
    const inc = (JSON.parse(content) as { include?: unknown }).include;
    if (!Array.isArray(inc) || inc.length !== 1 || typeof inc[0] !== "string") return null;
    return [inc[0]];
  } catch { return null; }
}

function excludeCandidates(files: readonly SlotFile[]): string[] {
  const base = files.find((f) => f.path === "tsconfig.json");
  if (!base) return [];
  const includes = includeGlobs(base.content);
  const include = includes?.[0];
  if (!include || !/\.(?:tsx|mts|ts)$/.test(include)) return [];
  const suffixes = [".test.ts", ".spec.ts"];
  const globs = suffixes.map((s) => include.replace(/\.(?:tsx|mts|ts)$/, s));
  return globs.filter((g) => files.some((f) => matchGlob(g, f.path)));
}

function tsconfigCandidates(asked: string, repo: SlotRepo): TsCandidate[] {
  const name = scriptNames(asked);
  if (!name) return [];
  const out: TsCandidate[] = [];
  const paths = new Set(repo.files.map((f) => f.path));
  const named = namedPaths(asked, paths);
  const byToken = fileCandidates(name, repo.files);
  if (singleEntry(asked)) {
    const files = named.length ? named : byToken;
    const file = one(named.length && byToken.length ? [...new Set([...named, ...byToken])] : files);
    // Two different pointers (a path in the sentence, and a different token match) are not one file.
    if (named.length && byToken.length && new Set([...named, ...byToken]).size !== 1) return [];
    if (file) out.push({ name, mode: "files", pattern: file });
    return out; // slot-guard:single-entry
  }
  const fullStem = byToken.filter((p) => p.split("/").pop()?.replace(EXT, "").toLowerCase() === name);
  const stem = one(fullStem);
  if (stem) out.push({ name, mode: "files", pattern: stem });
  const excluded = excludeCandidates(repo.files);
  const exclude = one(excluded);
  if (exclude && !stem) out.push({ name, mode: "exclude", pattern: exclude });
  if (/\bcheckJs\b|\bjavascript\b/i.test(asked)) {
    const js = repo.files.map((f) => f.path).filter((p) => /\.(?:mjs|js)$/.test(p) && !/\.(?:test|spec)\./.test(p));
    const file = one(js);
    if (file) out.push({ name, mode: "checkjs", pattern: file });
  }
  return out;
}

/** The typecheck-script line when the repo structure leaves exactly one mode. */
export function tsconfigLine(asked: string, repo: SlotRepo): string | null {
  if (!scriptNames(asked) || /\bexcluding\b|\bchecking only\b|\bwith checkJs\b/i.test(asked)) return null;
  const cands = tsconfigCandidates(asked, repo);
  if (cands.length !== 1) return null; // slot-guard:one-tsconfig
  const hit = cands[0]!;
  const how = hit.mode === "exclude" ? `excluding ${hit.pattern}` : hit.mode === "files" ? `checking only ${hit.pattern}` : `checking ${hit.pattern} with checkJs`;
  const line = `add a typecheck script typecheck:${hit.name} with a new tsconfig.${hit.name}.json ${how}`;
  if (!parseTsconfigScriptTask(TSCONFIG_SCRIPT_TRIGGER, line)) return null; // slot-guard:tsconfig-trigger
  return line;
}
