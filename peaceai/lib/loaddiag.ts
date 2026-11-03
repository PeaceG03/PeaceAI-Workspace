// M174 (batch 13, spec: peaceai/spec/load-diagnostics-m174.md): compile diagnostics for a team test suite that does not
// load. PeaceAI reads the copy's files with the TypeScript compiler API (a program over the team's test files; nothing
// is executed, and the runner's own output, which candidate code can write, is never read) and keeps only filtered
// codes: which name a team test imports from a relative source module that does not export it (MISSING_EXPORT, from
// TS2305 / TS2459 / TS2614 / TS2724), or which relative module it imports that does not exist (MISSING_MODULE, TS2307). The
// name and module come from the test file's syntax tree and the module resolution, never from the message text.
// The program's host reads only files inside the copy (by realpath, never under node_modules) and TypeScript's own
// lib files. Each guard is a single line tagged "// m174-guard:<id>"; m174-mutation.test.ts deletes each in turn.
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, join, posix, relative, resolve, sep } from "node:path";
import ts from "typescript";
import { isGeneratedPath, isTestPath } from "./codesearch.ts";

export const LOAD_DIAG_KINDS = ["MISSING_EXPORT", "MISSING_MODULE"] as const;
export type LoadDiagKind = (typeof LOAD_DIAG_KINDS)[number];
/** One filtered diagnostic: the team test file, the repo-relative module and the imported name (identifiers only). */
export interface LoadDiag { kind: LoadDiagKind; test: string; module: string; name: string; spec: string }
/** TypeScript codes read (any other diagnostic is dropped). */
export const EXPORT_CODES: readonly number[] = [2305, 2459, 2614, 2724];
export const MODULE_CODES: readonly number[] = [2307];
export const MAX_LOAD_DIAGS = 20;
const IDENT = /^[A-Za-z_$][A-Za-z0-9_$]{0,99}$/;
const SRC = /\.(?:ts|tsx|mts|cts)$/;

/** The fixed options of the diagnostics program (the repo's tsconfig is not read: no paths, plugins or extends). */
export const LOAD_OPTIONS: ts.CompilerOptions = {
  noEmit: true, allowJs: true, checkJs: false, skipLibCheck: true, types: [], noResolve: false, strict: false,
  module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, target: ts.ScriptTarget.ES2022,
  allowImportingTsExtensions: true, resolveJsonModule: false, esModuleInterop: true, lib: ["lib.es2022.d.ts"],
};

/** A compiler host that reads only regular files inside `root` (realpath, outside node_modules) and TypeScript's lib dir. */
export function confinedHost(root: string, options: ts.CompilerOptions = LOAD_OPTIONS): ts.CompilerHost {
  const host = ts.createCompilerHost(options, true);
  const top = realpathSync(root);
  const libDir = realpathSync(dirname(ts.getDefaultLibFilePath(options)));
  const ok = (p: string): boolean => {
    let real: string;
    try { real = realpathSync(p); } catch { return false; }
    if (real.startsWith(libDir + sep)) return true; // TypeScript's own lib files
    if (!real.startsWith(top + sep)) return false; // m174-guard:host-inside
    if (/(?:^|\/)node_modules(?:\/|$)/.test(relative(top, real).split(sep).join("/"))) return false; // m174-guard:host-no-modules
    if (/(?:^|\/)node_modules(?:\/|$)/.test(relative(top, resolve(p)).split(sep).join("/"))) return false; // m174-guard:host-no-modules-lex
    try { return statSync(real).isFile(); } catch { return false; }
  };
  return {
    ...host,
    fileExists: (p) => ok(p),
    readFile: (p) => (ok(p) ? readFileSync(p, "utf8") : undefined),
    getSourceFile: (p, lang, onError) => { const text = ok(p) ? readFileSync(p, "utf8") : undefined; return text === undefined ? undefined : ts.createSourceFile(p, text, lang, true); },
    directoryExists: (d) => { try { const r = realpathSync(d); return (r === top || r.startsWith(top + sep) || r.startsWith(libDir)) && statSync(r).isDirectory(); } catch { return false; } },
    getDirectories: () => [],
    realpath: (p) => { try { return realpathSync(p); } catch { return p; } },
    writeFile: () => { /* never */ },
  };
}

/** Does `file` (repo-relative) export names TypeScript cannot know here (an `export *` from a module outside the copy)? */
function opaqueExports(program: ts.Program, host: ts.CompilerHost, abs: string, seen: Set<string> = new Set()): boolean {
  if (seen.has(abs)) return false;
  seen.add(abs);
  const sf = program.getSourceFile(abs);
  if (!sf) return false; // callers pass files of the program only
  for (const st of sf.statements) {
    if (!ts.isExportDeclaration(st) || st.exportClause || !st.moduleSpecifier || !ts.isStringLiteral(st.moduleSpecifier)) continue;
    const r = ts.resolveModuleName(st.moduleSpecifier.text, abs, program.getCompilerOptions(), host).resolvedModule;
    const target = r ? program.getSourceFile(r.resolvedFileName) : undefined;
    if (!target) return true; // m174-guard:star-unknown
    if (opaqueExports(program, host, target?.fileName ?? "", seen)) return true;
  }
  return false;
}

/**
 * The filtered load diagnostics of the team's test files in the copy `dir` (repo-relative paths), at most
 * MAX_LOAD_DIAGS, sorted. `teamTests`: the team's test files (never a module to edit). Nothing is executed.
 */
export function loadDiagnostics(dir: string, testFiles: readonly string[], teamTests: ReadonlySet<string> = new Set(testFiles)): LoadDiag[] {
  const top = realpathSync(dir);
  const host = confinedHost(top);
  const roots = [...testFiles].sort().map((f) => join(top, f)).filter((p) => existsSync(p));
  const program = ts.createProgram({ rootNames: roots, options: LOAD_OPTIONS, host });
  const out: LoadDiag[] = [];
  const key = new Set<string>();
  for (const abs of roots) {
    const sf = program.getSourceFile(abs);
    if (!sf) continue;
    const test = relative(top, abs).split(sep).join("/");
    for (const d of program.getSemanticDiagnostics(sf)) {
      const exp = EXPORT_CODES.includes(d.code), mod = MODULE_CODES.includes(d.code);
      if (!exp && !mod) continue;
      if (d.start === undefined) continue;
      for (const st of sf.statements) {
        if (!ts.isImportDeclaration(st) || !ts.isStringLiteral(st.moduleSpecifier) || !st.importClause) continue;
        const spec = st.moduleSpecifier.text;
        if (!spec.startsWith("./") && !spec.startsWith("../")) continue; // m174-guard:relative
        if (st.importClause.isTypeOnly) continue; // m174-guard:type-only (erased: cannot stop a suite loading)
        if (mod && d.start === st.moduleSpecifier.getStart(sf)) {
          const lex = posix.normalize(posix.join(posix.dirname(test), spec));
          if (lex.startsWith("../") || /(?:^|\/)node_modules(?:\/|$)/.test(lex)) continue; // m174-guard:module-lex-inside
          push({ kind: "MISSING_MODULE", test, module: lex, name: "", spec });
          continue;
        }
        const b = st.importClause.namedBindings;
        if (!exp || !b || !ts.isNamedImports(b)) continue;
        for (const e of b.elements) {
          const n = e.propertyName ?? e.name;
          if (d.start < n.getStart(sf) || d.start >= n.getEnd()) continue;
          if (e.isTypeOnly) continue; // m174-guard:type-only-name
          const r = ts.resolveModuleName(spec, abs, LOAD_OPTIONS, host).resolvedModule;
          if (!r) continue;
          const real = realpathSync(r.resolvedFileName);
          const module = relative(top, real).split(sep).join("/");
          if (module.startsWith("..") || !SRC.test(module) || /\.d\.[cm]?ts$/.test(module)) continue; // m174-guard:module-source
          if (isTestPath(module) || isGeneratedPath(module)) continue; // m174-guard:module-not-test
          if (teamTests.has(module)) continue; // m174-guard:module-not-team
          if (opaqueExports(program, host, real)) continue; // m174-guard:star-opaque
          push({ kind: "MISSING_EXPORT", test, module, name: n.text, spec });
        }
      }
    }
  }
  function push(x: LoadDiag): void {
    if (x.kind === "MISSING_EXPORT" && !IDENT.test(x.name)) return; // m174-guard:name-ident
    const k = `${x.kind}\0${x.module}\0${x.name}`;
    if (key.has(k)) return;
    key.add(k);
    out.push(x);
  }
  out.sort((a, b) => (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0) || (a.module < b.module ? -1 : a.module > b.module ? 1 : 0) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0) || (a.test < b.test ? -1 : 1));
  return out.slice(0, MAX_LOAD_DIAGS); // m174-guard:cap
}
