// M152 (general coding-agent roadmap, the "edit proposer" gap after loop v2): PeaceAI's first general edit proposer.
// Project-agnostic and deterministic: no model, no network, no per-project rules. See peaceai/spec/edit-proposer-v1.md.
//
// Given the task request, the code search tools (#635, codesearch.ts) and the failing-test evidence the loop gives it
// (filtered codes, counts, and test names where the runner reports them), it
//   1. reads the symbols the request (and failing test names) names: identifiers in `code spans` and camelCase /
//      PascalCase / snake_case words,
//   2. locates their definitions with the search tools (symbol, then grep for methods / properties), never in a test
//      or generated file, plus same-file functions those definitions call (one level),
//   3. proposes single-site edits from a fixed list of typed repair templates (missing export, truthiness check to
//      null / undefined check, comparison and arithmetic operator, off-by-one literal, logical operator / dropped
//      condition, default value, missing null / undefined parameter guard, negated condition, boolean return),
//      one candidate per attempt, in a fixed order chosen before any task run (template, then located site, then
//      position),
//   4. reads each attempt's counts: two candidates that each raised the passing count without any other failure code
//      are combined into one edit next (still checked by the tests like any other).
// The loop applies every candidate in a fresh copy and keeps it only if the team's tests pass and the related tests
// do not regress (loop.ts). Nothing here runs code. The search tools are used only in prepare(), which the loop calls
// on the pinned commit without the team's test files, so the proposer never reads the tests it is graded by.
//
// Each guard is a single line tagged "guard:<id>"; the m152 mutation test deletes each tagged line in turn and
// requires a behavior case to fail.
//
// M168 (repair-v2, spec/edit-proposer-v2.md): an opt-in second proposer built on the same code. It adds four typed
// IDIOM templates for well-known JS/TS bug shapes that no single-token mutation reaches (a discarded result of a
// non-mutating method, an inverted letter-case predicate, a truthiness test that drops falsy primitives before a
// typeof "object" check, and an Object.assign copy into {} that runs the __proto__ setter), tried before the v1
// templates, and it locates one more level of same-file callees (depth 2). repair-v1 (and model-v1, which ranks
// repair-v1's list) is unchanged: every v2 path is behind an option repair-v1 never sets. v2 guards are tagged
// "m168-guard:<id>" (a separate tag, so the m152 guard list is unchanged); m168-mutation deletes each one.
import { createHash } from "node:crypto";
import { posix } from "node:path";
import ts from "typescript";
import { isGeneratedPath, isTestPath, type CodeRepo } from "./codesearch.ts";

/** The loop's proposer interface (structural copy of loop.ts Proposer / ProposeInput: no import cycle). */
/** M174: structural copy of loop.ts LoadDiag (one filtered load diagnostic). */
export interface LoadDiag { kind: "MISSING_EXPORT" | "MISSING_MODULE"; test: string; module: string; name: string; spec: string }
export interface RepairEdit { path: string; content: string }
export interface RepairFeedback { attempt: number; codes: readonly string[]; failing: readonly string[]; tests?: { total: number; passedByPeaceAI: number } | null }
export interface RepairInput { files: readonly { path: string; content: string }[]; attempt: number; feedback: readonly RepairFeedback[]; baseline?: { total: number; passing: number; failing: number } | null; loadDiagnostics?: readonly LoadDiag[] }
export interface PrepareInput { request: string; failing: readonly string[] }
export type RepairProposal = { edits: RepairEdit[] } | { refuse: "NO_EDIT" | "NO_MORE_EDITS" };

export const REPAIR_PROPOSER = "repair-v1";
export const REPAIR_PROPOSER_V2 = "repair-v2";
export const MAX_CANDIDATES = 60;
export const MAX_SYMBOLS = 8;
export const MAX_SITES = 12;
const MAX_FILES_PER_SYMBOL = 6;
const MAX_CALLEES = 6;
/** The fixed template order (rank = index). */
export const TEMPLATES = ["missing-export", "nullish-check", "comparison", "arithmetic", "off-by-one", "logical", "default-value", "null-guard", "negate-condition", "boolean-return"] as const;
/** M168: repair-v2's idiom templates, tried before TEMPLATES in this fixed order (decided before any dev-split run). */
export const IDIOM_TEMPLATES = ["discarded-result", "case-predicate", "typeof-null", "proto-safe-copy", "undefined-keeps-key"] as const; // M172: + undefined-keeps-key
export type Idiom = (typeof IDIOM_TEMPLATES)[number];
/** M173 (spec: peaceai/spec/repair-v2-m173.md): repair-v2's module-scope constant template, tried after all others. */
export const CONST_TEMPLATES = ["const-value"] as const;
/** M174 (repair-v2 only, spec/load-diagnostics-m174.md): edits for a team suite that does not load because it imports a
 *  name its source module does not export; proposed only from the loop's load diagnostics, never beside the others. */
export const LOAD_TEMPLATES = ["load-export", "load-reexport"] as const;
export type Template = (typeof TEMPLATES)[number] | Idiom | (typeof CONST_TEMPLATES)[number] | (typeof LOAD_TEMPLATES)[number];
/** M168: repair-v2's full order (idioms first, then the v1 templates unchanged; M173: then const-value). */
export const TEMPLATES_V2: readonly Template[] = [...IDIOM_TEMPLATES, ...TEMPLATES, ...CONST_TEMPLATES];
/** M173: at most this many module-scope constant sites (tier 3) are added after the located sites (repair-v2 only). */
export const MAX_CONST_SITES = 4;
/** M168: how many levels of same-file callees each proposer locates (v1: 1, unchanged; v2: 2). */
export const CALLEE_DEPTH = { v1: 1, v2: 2 } as const;

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const SOURCE = /\.(?:ts|tsx|mts|cts)$/;
const NOT_SYMBOLS = new Set([
  "true", "false", "null", "undefined", "NaN", "Infinity", "this", "new", "return", "typeof", "instanceof", "void", "const", "let", "var",
  "function", "class", "if", "else", "for", "while", "do", "in", "of", "async", "await", "yield", "import", "export", "default", "throw",
  "try", "catch", "finally", "switch", "case", "break", "continue", "delete", "super", "extends", "implements", "interface", "type",
  "JSON", "Object", "Array", "String", "Number", "Boolean", "Promise", "Math", "Date", "Error", "RegExp", "Map", "Set", "Symbol", "BigInt",
  "parse", "stringify", "console", "log", "length", "prototype", "constructor", "toString", "valueOf", "README", "API", "JS", "TS",
]);

/** Identifiers a text names: everything in `code spans`, then camelCase / PascalCase / snake_case words outside them. */
export function namedSymbols(text: string): string[] {
  const out: string[] = [];
  const add = (w: string) => { if (w.length >= 2 && !NOT_SYMBOLS.has(w) && !out.includes(w)) out.push(w); };
  for (const m of text.matchAll(/`([^`]{1,200})`/g)) {
    // string literals inside a span are values, not names
    let span = m[1]!;
    span = span.replace(/(["'])(?:\\.|(?!\1).)*\1/g, " "); // guard:span-strings
    for (const w of span.matchAll(/[A-Za-z_$][\w$]*/g)) add(w[0]);
  }
  const prose = text.replace(/`[^`]*`/g, " ");
  for (const w of prose.matchAll(/[A-Za-z_$][\w$]*/g)) if (/[a-z][A-Z]|^[A-Z][a-z]+[A-Z]|_/.test(w[0]) || /^[A-Z][A-Z0-9_]{2,}$/.test(w[0])) add(w[0]);
  return out;
}

// ---- sites

type FnLike = ts.FunctionDeclaration | ts.FunctionExpression | ts.ArrowFunction | ts.MethodDeclaration | ts.GetAccessorDeclaration | ts.SetAccessorDeclaration | ts.ConstructorDeclaration;
export interface Site { path: string; name: string; start: number; end: number; tier: number }

const nameOf = (n: ts.Node): string | null => {
  const nm = (n as { name?: ts.Node }).name;
  return nm && (ts.isIdentifier(nm) || ts.isStringLiteral(nm) || ts.isPrivateIdentifier(nm)) ? nm.text : null;
};
export const parseSource = (path: string, text: string): ts.SourceFile => ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, path.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);

/** Declarations named `name` in a file: functions, variables, methods, properties, accessors, classes. */
function declarationsNamed(sf: ts.SourceFile, name: string): ts.Node[] {
  const out: ts.Node[] = [];
  const visit = (n: ts.Node) => {
    if ((ts.isFunctionDeclaration(n) || ts.isVariableDeclaration(n) || ts.isMethodDeclaration(n) || ts.isPropertyDeclaration(n) || ts.isPropertyAssignment(n) || ts.isGetAccessorDeclaration(n) || ts.isSetAccessorDeclaration(n) || ts.isClassDeclaration(n)) && nameOf(n) === name) {
      out.push(ts.isVariableDeclaration(n) && ts.isVariableDeclarationList(n.parent) && ts.isVariableStatement(n.parent.parent) ? n.parent.parent : n);
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

/** Top-level functions (declarations and const arrow / function expressions) of a file, by name. */
function topFunctions(sf: ts.SourceFile): Map<string, ts.Node> {
  const m = new Map<string, ts.Node>();
  for (const st of sf.statements) {
    if (ts.isFunctionDeclaration(st) && st.name) m.set(st.name.text, st);
    if (ts.isVariableStatement(st)) for (const d of st.declarationList.declarations) if (ts.isIdentifier(d.name) && d.initializer && (ts.isArrowFunction(d.initializer) || ts.isFunctionExpression(d.initializer))) m.set(d.name.text, st);
  }
  return m;
}

/** M168: the request's words (any identifier-like word of 3+ letters, lower-cased), for file-name focus. */
export function requestWords(text: string): Set<string> {
  return new Set([...text.matchAll(/[A-Za-z][A-Za-z0-9]{2,}/g)].map((m) => m[0].toLowerCase()));
}
/** M168: a file's name stem, lower-cased (src/string.ts -> "string", lib/a.d.ts -> "a"). */
export const fileStem = (p: string): string => (p.split("/").pop() ?? "").replace(/\.(?:d\.)?[cm]?[jt]sx?$/, "").toLowerCase();
/** M168: files ordered by whether the request names their stem (stable); when some do, only those are kept. */
export function focusFiles(files: readonly string[], words: ReadonlySet<string>): string[] {
  const named = files.filter((p) => words.has(fileStem(p)));
  let out = [...files];
  if (named.length > 0) out = named; // m168-guard:focus-named
  return out;
}

/** M172 (spec: peaceai/spec/repair-v2-m172.md): a relative import specifier resolved to the repo path of a source file it can name (no I/O beyond `exists`). */
export function resolveImport(from: string, spec: string, exists: (p: string) => boolean): string | null {
  if (!spec.startsWith("./") && !spec.startsWith("../")) return null; // m172-guard:imp-relative
  const parts = from.split("/").slice(0, -1);
  let escapes = false;
  for (const seg of spec.split("/")) { if (seg === "." || seg === "") continue; if (seg !== "..") parts.push(seg); else if (parts.length) parts.pop(); else escapes = true; }
  if (escapes) return null; // m172-guard:imp-inside
  const base = parts.join("/");
  const stem = base.replace(/\.(?:[cm]?js|jsx)$/, "");
  for (const c of [base, `${stem}.ts`, `${stem}.tsx`, `${stem}.mts`, `${stem}.cts`, `${stem}/index.ts`, `${stem}/index.tsx`]) if (SOURCE.test(c) && exists(c)) return c;
  return null;
}
/** M172: the file's import bindings from relative modules: local name -> { spec, imported name } (named imports only). */
function relativeImports(sf: ts.SourceFile): Map<string, { spec: string; name: string }> {
  const m = new Map<string, { spec: string; name: string }>();
  for (const st of sf.statements) {
    if (!ts.isImportDeclaration(st) || !ts.isStringLiteral(st.moduleSpecifier) || !st.importClause) continue;
    if (st.importClause.isTypeOnly) continue; // m172-guard:imp-type-only
    const b = st.importClause.namedBindings;
    if (!b || !ts.isNamedImports(b)) continue;
    for (const e of b.elements) {
      if (e.isTypeOnly) continue; // m172-guard:imp-type-only-name
      m.set(e.name.text, { spec: st.moduleSpecifier.text, name: (e.propertyName ?? e.name).text });
    }
  }
  return m;
}

/** The located sites, computed once from the search tools (see prepare). */
export function locate(search: CodeRepo, input: PrepareInput, depth: number = CALLEE_DEPTH.v1): Site[] {
  const names = [...namedSymbols(input.request), ...input.failing.flatMap((n) => namedSymbols(n))].filter((n, i, a) => a.indexOf(n) === i).slice(0, MAX_SYMBOLS);
  const sites: Site[] = [];
  const words = requestWords(input.request);
  const texts = new Map<string, string | null>();
  const textOf = (p: string) => {
    if (!texts.has(p)) { const r = search.read(p); texts.set(p, r.ok && !r.truncated ? r.text : null); }
    return texts.get(p) ?? null;
  };
  const allowed = (p: string) => {
    if (!SOURCE.test(p) || p.endsWith(".d.ts")) return false;
    if (isTestPath(p)) return false; // guard:test-path
    if (isGeneratedPath(p)) return false; // guard:generated
    return true;
  };
  const push = (s: Site) => { if (sites.length < MAX_SITES && !sites.some((x) => x.path === s.path && x.start === s.start && x.end === s.end)) sites.push(s); };
  for (const name of names) {
    const files: string[] = [];
    const sym = search.symbol(name);
    if (sym.ok) for (const d of sym.definitions) if (!files.includes(d.path)) files.push(d.path);
    if (!files.length) {
      const g = search.grep(`\\b${name.replace(/\$/g, "\\$")}\\s*(?:[(:=<]|\\?\\s*:)`, { regex: true, limit: 50 });
      if (g.ok) for (const h of g.hits) if (!files.includes(h.path)) files.push(h.path);
    }
    let ok = files.filter(allowed);
    // M168 (repair-v2 only): files whose name the request's words name (`string` -> src/string.ts) go first, and when
    // any does, only the best-named ones are kept, so a method many files define is located where the request points
    if (depth >= 2) ok = focusFiles(ok, words); // m168-guard:focus-v2-only
    for (const p of ok.slice(0, MAX_FILES_PER_SYMBOL)) {
      const text = textOf(p);
      if (text === null) continue;
      const sf = parseSource(p, text);
      const tops = topFunctions(sf);
      const imports = relativeImports(sf);
      // M172 (repair-v2 only): a function called inside `node` that the file imports from a relative module is
      // located in its own file, one level, after the same-file sites (entry -> helper module is the common layout)
      const importedCallees = (node: ts.Node, tier: number) => {
        if (depth < 2) return; // m172-guard:imp-v2-only
        const seen: string[] = [];
        const w = (n: ts.Node) => {
          if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && imports.has(n.expression.text) && !seen.includes(n.expression.text)) seen.push(n.expression.text);
          ts.forEachChild(n, w);
        };
        w(node);
        for (const local of seen.slice(0, MAX_CALLEES)) {
          const im = imports.get(local)!;
          const target = resolveImport(p, im.spec, (q) => textOf(q) !== null);
          if (!target) continue;
          if (!allowed(target)) continue; // m172-guard:imp-allowed
          const tsf = parseSource(target, textOf(target)!);
          const fn = topFunctions(tsf).get(im.name);
          if (fn) push({ path: target, name: im.name, start: fn.getStart(tsf), end: fn.getEnd(), tier });
        }
      };
      for (const d of declarationsNamed(sf, name)) {
        push({ path: p, name, start: d.getStart(sf), end: d.getEnd(), tier: 0 });
        // one level of same-file callees (the fault is often one call below the named entry point)
        const callees: string[] = [];
        const walk = (n: ts.Node) => {
          if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text !== name && tops.has(n.expression.text) && !callees.includes(n.expression.text)) callees.push(n.expression.text);
          // M172 (repair-v2 only): a same-file function passed as a value to a call (a callback, an implementation
          // handed to a dispatcher) runs below the entry point just as a direct callee does
          if (depth >= 2 && ts.isIdentifier(n) && n.parent && ts.isCallExpression(n.parent) && n.parent.arguments.includes(n as ts.Expression) && n.text !== name && tops.has(n.text) && !callees.includes(n.text)) callees.push(n.text); // m172-guard:ref-arg
          ts.forEachChild(n, walk);
        };
        walk(d);
        for (const c of callees.slice(0, MAX_CALLEES)) {
          const t = tops.get(c)!;
          push({ path: p, name: c, start: t.getStart(sf), end: t.getEnd(), tier: 1 });
          // M168 (repair-v2 only): a second level, the same-file top-level functions that callee calls (the fault is
          // often in a worker below a factory: entry -> factory -> worker); v1 never passes depth 2
          if (depth < 2) continue; // m168-guard:depth-v1
          const deeper: string[] = [];
          const walk2 = (n: ts.Node) => {
            if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text !== name && n.expression.text !== c && !callees.includes(n.expression.text) && tops.has(n.expression.text) && !deeper.includes(n.expression.text)) deeper.push(n.expression.text);
            ts.forEachChild(n, walk2);
          };
          walk2(t);
          for (const c2 of deeper.slice(0, MAX_CALLEES)) { const t2 = tops.get(c2)!; push({ path: p, name: c2, start: t2.getStart(sf), end: t2.getEnd(), tier: 2 }); }
          importedCallees(t, 2);
        }
        importedCallees(d, 1);
      }
    }
  }
  const consts = constSites(sites, textOf);
  if (depth < 2) return sites; // m173-guard:cs-v2-only
  return [...sites, ...consts];
}

/**
 * M173 (repair-v2 only): the module-scope constants the located sites read. A top-level `const` (not `declare`, not a
 * function or class) whose name a located site reads as a value (not as a property name, not shadowed by a binding
 * inside the site) becomes a tier-3 site, in site order then source order, at most MAX_CONST_SITES, after every other
 * site, so the located sites and their order are unchanged. A wrong limit, table or pattern often lives in such a
 * constant, outside the function the request names.
 */
function constSites(sites: readonly Site[], textOf: (p: string) => string | null): Site[] {
  const out: Site[] = [];
  for (const site of sites) {
    const text = textOf(site.path);
    if (text === null) continue;
    const sf = parseSource(site.path, text);
    const consts: { name: string; st: ts.VariableStatement }[] = [];
    for (const st of sf.statements) {
      if (!ts.isVariableStatement(st)) continue;
      if (!(st.declarationList.flags & ts.NodeFlags.Const)) continue; // m173-guard:cs-const
      if (ts.getModifiers(st)?.some((m) => m.kind === ts.SyntaxKind.DeclareKeyword)) continue; // m173-guard:cs-declare
      for (const d of st.declarationList.declarations) {
        if (!ts.isIdentifier(d.name) || !d.initializer) continue;
        if (ts.isArrowFunction(d.initializer) || ts.isFunctionExpression(d.initializer) || ts.isClassExpression(d.initializer)) continue; // m173-guard:cs-not-fn
        consts.push({ name: d.name.text, st });
      }
    }
    const bound = new Set<string>();
    const read = new Set<string>();
    const visit = (n: ts.Node) => {
      if (n.getEnd() <= site.start || n.getStart(sf) >= site.end) return;
      const inside = n.getStart(sf) >= site.start && n.getEnd() <= site.end;
      if (inside && (ts.isParameter(n) || ts.isVariableDeclaration(n) || ts.isBindingElement(n) || ts.isFunctionDeclaration(n) || ts.isClassDeclaration(n)) && n.name && ts.isIdentifier(n.name)) bound.add(n.name.text);
      if (inside && ts.isIdentifier(n) && n.parent) {
        const p = n.parent;
        let isRead = !((p as { name?: ts.Node }).name === n && !ts.isShorthandPropertyAssignment(p) && !ts.isPropertyAccessExpression(p)); // a declared name is not a read
        if (ts.isPropertyAccessExpression(p) && p.name === n) isRead = false; // m173-guard:cs-ref-expr
        if (isRead) read.add(n.text);
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
    for (const { name, st } of consts) {
      if (!read.has(name)) continue; // m173-guard:cs-read
      if (bound.has(name)) continue; // m173-guard:cs-shadow
      const s = st.getStart(sf), e = st.getEnd();
      if (s >= site.start && e <= site.end) continue; // the constant is (inside) this site already
      if (sites.some((x) => x.path === site.path && x.start === s && x.end === e) || out.some((x) => x.path === site.path && x.start === s && x.end === e)) continue;
      if (out.length >= MAX_CONST_SITES) return out; // m173-guard:cs-cap
      out.push({ path: site.path, name, start: s, end: e, tier: 3 });
    }
  }
  return out;
}

// ---- templates

export interface Mutation { path: string; start: number; end: number; text: string; template: Template; site: number }

const COMPARE: Partial<Record<ts.SyntaxKind, string>> = {
  [ts.SyntaxKind.LessThanToken]: "<=", [ts.SyntaxKind.LessThanEqualsToken]: "<", [ts.SyntaxKind.GreaterThanToken]: ">=", [ts.SyntaxKind.GreaterThanEqualsToken]: ">",
  [ts.SyntaxKind.EqualsEqualsEqualsToken]: "!==", [ts.SyntaxKind.ExclamationEqualsEqualsToken]: "===", [ts.SyntaxKind.EqualsEqualsToken]: "!=", [ts.SyntaxKind.ExclamationEqualsToken]: "==",
};
const ARITH: Partial<Record<ts.SyntaxKind, string[]>> = {
  [ts.SyntaxKind.PlusToken]: ["-"], [ts.SyntaxKind.MinusToken]: ["+"], [ts.SyntaxKind.AsteriskToken]: ["/"], [ts.SyntaxKind.SlashToken]: ["*"],
};
const isRef = (e: ts.Node): e is ts.Identifier | ts.PropertyAccessExpression | ts.ElementAccessExpression => ts.isIdentifier(e) || ts.isPropertyAccessExpression(e) || ts.isElementAccessExpression(e);
const isFn = (n: ts.Node): n is FnLike => ts.isFunctionDeclaration(n) || ts.isFunctionExpression(n) || ts.isArrowFunction(n) || ts.isMethodDeclaration(n) || ts.isGetAccessorDeclaration(n) || ts.isSetAccessorDeclaration(n) || ts.isConstructorDeclaration(n);
const inCondition = (n: ts.Node): boolean => {
  const p = n.parent;
  if (!p) return false;
  if ((ts.isIfStatement(p) || ts.isWhileStatement(p) || ts.isDoStatement(p)) && p.expression === n) return true;
  if (ts.isConditionalExpression(p) && p.condition === n) return true;
  if (ts.isBinaryExpression(p) && (p.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken || p.operatorToken.kind === ts.SyntaxKind.BarBarToken)) return true;
  if (ts.isParenthesizedExpression(p)) return inCondition(p);
  return false;
};

/** Every single-site candidate the templates give inside one site (no I/O). */
export function mutationsIn(sf: ts.SourceFile, site: Site, siteIndex: number, exportedNames: ReadonlySet<string>): Mutation[] {
  const out: Mutation[] = [];
  const text = sf.text;
  const m = (start: number, end: number, rep: string, template: Template) => out.push({ path: site.path, start, end, text: rep, template, site: siteIndex });
  const src = (n: ts.Node) => text.slice(n.getStart(sf), n.getEnd());
  const visit = (n: ts.Node) => {
    const s = n.getStart(sf);
    if (s < site.start || n.getEnd() > site.end) { ts.forEachChild(n, visit); return; }
    // missing export: a named top-level declaration that nothing exports
    if (site.tier === 0 && n.parent === sf && (ts.isFunctionDeclaration(n) || ts.isVariableStatement(n) || ts.isClassDeclaration(n)) && !exportedNames.has(site.name) && !(ts.canHaveModifiers(n) && ts.getModifiers(n)?.some((x) => x.kind === ts.SyntaxKind.ExportKeyword || x.kind === ts.SyntaxKind.DeclareKeyword))) m(s, s, "export ", "missing-export");
    if (ts.isPrefixUnaryExpression(n) && n.operator === ts.SyntaxKind.ExclamationToken && isRef(n.operand)) m(s, n.getEnd(), `(${src(n.operand)} === undefined || ${src(n.operand)} === null)`, "nullish-check");
    if (isRef(n) && inCondition(n) && !(ts.isPrefixUnaryExpression(n.parent))) m(s, n.getEnd(), `(${src(n)} !== undefined && ${src(n)} !== null)`, "nullish-check");
    if (ts.isBinaryExpression(n)) {
      const k = n.operatorToken.kind;
      const op = n.operatorToken;
      const os = op.getStart(sf), oe = op.getEnd();
      if (k === ts.SyntaxKind.BarBarToken) m(os, oe, "??", "nullish-check");
      if (COMPARE[k]) m(os, oe, COMPARE[k]!, "comparison");
      for (const r of ARITH[k] ?? []) if (!(k === ts.SyntaxKind.PlusToken && (ts.isStringLiteral(n.left) || ts.isStringLiteral(n.right) || ts.isTemplateExpression(n.left) || ts.isTemplateExpression(n.right)))) m(os, oe, r, "arithmetic");
      if (k === ts.SyntaxKind.AmpersandAmpersandToken || k === ts.SyntaxKind.BarBarToken) {
        m(os, oe, k === ts.SyntaxKind.AmpersandAmpersandToken ? "||" : "&&", "logical");
        if (inCondition(n) || (n.parent && (ts.isIfStatement(n.parent) || ts.isReturnStatement(n.parent)))) { m(s, n.getEnd(), src(n.left), "logical"); m(s, n.getEnd(), src(n.right), "logical"); }
      }
    }
    if (ts.isNumericLiteral(n) && /^\d{1,4}$/.test(n.text)) {
      const p = n.parent;
      const v = Number(n.text);
      if (p && ((ts.isBinaryExpression(p) && (COMPARE[p.operatorToken.kind] || ARITH[p.operatorToken.kind])) || (ts.isElementAccessExpression(p) && p.argumentExpression === n) || ts.isCallExpression(p))) {
        m(s, n.getEnd(), String(v + 1), "off-by-one");
        if (v > 0) m(s, n.getEnd(), String(v - 1), "off-by-one");
      }
      if (p && ts.isParameter(p) && p.initializer === n) { m(s, n.getEnd(), String(v + 1), "default-value"); if (v > 0) m(s, n.getEnd(), String(v - 1), "default-value"); }
    }
    if ((n.kind === ts.SyntaxKind.TrueKeyword || n.kind === ts.SyntaxKind.FalseKeyword) && n.parent) {
      const flip = n.kind === ts.SyntaxKind.TrueKeyword ? "false" : "true";
      if (ts.isParameter(n.parent) || ts.isPropertyAssignment(n.parent) || ts.isBindingElement(n.parent) || (ts.isBinaryExpression(n.parent) && n.parent.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken)) m(s, n.getEnd(), flip, "default-value");
      if (ts.isReturnStatement(n.parent)) m(s, n.getEnd(), flip, "boolean-return");
    }
    if (isFn(n) && n.body && ts.isBlock(n.body)) {
      const body = n.body;
      for (const prm of n.parameters) {
        if (!ts.isIdentifier(prm.name)) continue;
        const pn = prm.name.text;
        let deref = false;
        const scan = (x: ts.Node) => { if ((ts.isPropertyAccessExpression(x) || ts.isElementAccessExpression(x)) && ts.isIdentifier(x.expression) && x.expression.text === pn) deref = true; if (!deref) ts.forEachChild(x, scan); };
        scan(body);
        if (deref) { const at = body.getStart(sf) + 1; m(at, at, ` if (${pn} === undefined || ${pn} === null) { return ${pn} as any; }`, "null-guard"); }
      }
    }
    if (ts.isIfStatement(n)) m(n.expression.getStart(sf), n.expression.getEnd(), `!(${src(n.expression)})`, "negate-condition");
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

// ---- M168 idiom templates (repair-v2 only)

/** Methods that return a new value and leave the receiver unchanged (Array / String); a call whose result is dropped
 *  does nothing. Mutating methods (sort, reverse, splice, push, fill, ...) are NOT here. */
export const PURE_METHODS: ReadonlySet<string> = new Set([
  "filter", "map", "concat", "slice", "flat", "flatMap", "toSorted", "toReversed", "toSpliced", "with",
  "trim", "trimStart", "trimEnd", "replace", "replaceAll", "toLowerCase", "toUpperCase", "padStart", "padEnd", "substring", "normalize",
]);

/** A side-effect-free reference: an identifier, `this`, or a non-optional property access chain of those. */
export function plainRef(e: ts.Node): boolean {
  if (ts.isIdentifier(e) || e.kind === ts.SyntaxKind.ThisKeyword) return true;
  return ts.isPropertyAccessExpression(e) && !e.questionDotToken && ts.isIdentifier(e.name) && plainRef(e.expression);
}

/** Names a file binds that cannot be assigned: const declarations and import bindings (any scope; conservative). */
export function fixedNames(sf: ts.SourceFile): Set<string> {
  const out = new Set<string>();
  const visit = (n: ts.Node) => {
    if (ts.isVariableDeclarationList(n) && (n.flags & ts.NodeFlags.Const)) for (const d of n.declarations) if (ts.isIdentifier(d.name)) out.add(d.name.text);
    if (ts.isImportClause(n) && n.name) out.add(n.name.text);
    if (ts.isNamespaceImport(n) || ts.isImportSpecifier(n) || ts.isImportEqualsDeclaration(n)) out.add(n.name.text);
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

/** discarded-result: `ref.m(...);` where m is a non-mutating method -> `ref = ref.m(...);`. */
function discardedResult(n: ts.Node, sf: ts.SourceFile, fixed: ReadonlySet<string>): string | null {
  const e = (n as { expression?: ts.Node }).expression;
  if (!ts.isExpressionStatement(n)) return null; // m168-guard:dr-statement
  if (!e || !ts.isCallExpression(e) || !ts.isPropertyAccessExpression(e.expression) || !ts.isIdentifier(e.expression.name)) return null;
  if (!PURE_METHODS.has(e.expression.name.text)) return null; // m168-guard:dr-method
  if (e.questionDotToken || e.expression.questionDotToken) return null; // m168-guard:dr-optional
  const recv = e.expression.expression;
  if (!plainRef(recv) || recv.kind === ts.SyntaxKind.ThisKeyword) return null; // m168-guard:dr-ref
  if (ts.isIdentifier(recv) && fixed.has(recv.text)) return null; // m168-guard:dr-const
  const r = sf.text.slice(recv.getStart(sf), recv.getEnd());
  return `${r} = ${sf.text.slice(e.getStart(sf), e.getEnd())}`;
}

/** case-predicate: `x.toUpperCase() === x` (true for every non-letter) -> `x !== x.toLowerCase()` (true only for a
 *  letter that has a lower-case form); the lower-case mirror and `!==` likewise. Either operand order. */
function casePredicate(n: ts.Node, sf: ts.SourceFile): string | null {
  if (!ts.isBinaryExpression(n)) return null;
  const k = n.operatorToken.kind;
  if (k !== ts.SyntaxKind.EqualsEqualsEqualsToken && k !== ts.SyntaxKind.ExclamationEqualsEqualsToken) return null; // m168-guard:cp-op
  const src = (x: ts.Node) => sf.text.slice(x.getStart(sf), x.getEnd());
  for (const [call, other] of [[n.left, n.right], [n.right, n.left]] as const) {
    if (!ts.isCallExpression(call) || !ts.isPropertyAccessExpression(call.expression) || call.expression.questionDotToken || call.questionDotToken) continue;
    const m = call.expression.name.text;
    if (m !== "toUpperCase" && m !== "toLowerCase") continue;
    if (call.arguments.length !== 0) continue; // m168-guard:cp-noargs
    const x = call.expression.expression;
    if (!plainRef(x)) continue; // m168-guard:cp-ref
    if (src(x) !== src(other)) continue; // m168-guard:cp-same
    const flip = m === "toUpperCase" ? "toLowerCase" : "toUpperCase";
    const op = k === ts.SyntaxKind.EqualsEqualsEqualsToken ? "!==" : "===";
    return `${src(x)} ${op} ${src(x)}.${flip}()`;
  }
  return null;
}

/** typeof-null: `x && typeof x !== "object"` (meant to let null through as a primitive, but also drops 0, "", false,
 *  NaN) -> `(x === null || typeof x !== "object")`. Either operand order. */
function typeofNull(n: ts.Node, sf: ts.SourceFile): string | null {
  if (!ts.isBinaryExpression(n)) return null;
  if (n.operatorToken.kind !== ts.SyntaxKind.AmpersandAmpersandToken) return null; // m168-guard:tn-and
  const src = (x: ts.Node) => sf.text.slice(x.getStart(sf), x.getEnd());
  for (const [ref, check] of [[n.left, n.right], [n.right, n.left]] as const) {
    if (!plainRef(ref)) continue; // m168-guard:tn-ref
    if (!ts.isBinaryExpression(check)) continue;
    const ck = check.operatorToken.kind;
    if (ck !== ts.SyntaxKind.ExclamationEqualsEqualsToken && ck !== ts.SyntaxKind.ExclamationEqualsToken) continue;
    const [t, lit] = ts.isTypeOfExpression(check.left) ? [check.left, check.right] : [check.right, check.left];
    if (!ts.isTypeOfExpression(t)) continue;
    if (!ts.isStringLiteral(lit) || lit.text !== "object") continue; // m168-guard:tn-object
    if (src(t.expression) !== src(ref)) continue; // m168-guard:tn-same
    return `(${src(ref)} === null || typeof ${src(ref)} !== "object")`;
  }
  return null;
}

/** proto-safe-copy: `Object.assign({}, a, ...)` ([[Set]]: an own "__proto__" key in a source, e.g. from JSON.parse, runs
 *  the setter and swaps the copy's prototype) -> `({ ...a, ... })` (own data properties, no setter). */
function protoSafeCopy(n: ts.Node, sf: ts.SourceFile): string | null {
  if (!ts.isCallExpression(n) || n.questionDotToken) return null;
  const c = n.expression;
  if (!ts.isPropertyAccessExpression(c) || !ts.isIdentifier(c.expression) || c.expression.text !== "Object" || c.name.text !== "assign") return null; // m168-guard:pc-object
  const [target, ...sources] = n.arguments;
  if (!target || !ts.isObjectLiteralExpression(target) || target.properties.length !== 0) return null; // m168-guard:pc-empty
  if (sources.length === 0) return null; // m168-guard:pc-sources
  if (sources.some((a) => ts.isSpreadElement(a))) return null; // m168-guard:pc-spread
  return `({ ${sources.map((a) => `...${sf.text.slice(a.getStart(sf), a.getEnd())}`).join(", ")} })`;
}

/** M172 undefined-keeps-key: the condition of `if (v !== undefined) o[k] = v` (no else; the assigned value is the
 *  checked variable; o a plain reference; k an identifier or literal, or `o.name = v`) -> `v !== undefined || k in o`:
 *  the skip is meant for an absent key, but it also leaves a stale value under a present key whose new value is
 *  undefined. The edit only adds assignments of undefined to keys `in` the object, so it cannot touch any other key. */
function undefinedKeepsKey(n: ts.Node, sf: ts.SourceFile): string | null {
  const st = n.parent;
  if (!st || !ts.isIfStatement(st) || st.expression !== n) return null;
  if (st.elseStatement) return null; // m172-guard:uk-no-else
  if (!ts.isBinaryExpression(n)) return null;
  const k = n.operatorToken.kind;
  if (k !== ts.SyntaxKind.ExclamationEqualsEqualsToken && k !== ts.SyntaxKind.ExclamationEqualsToken) return null;
  const isUndef = (e: ts.Expression) => ts.isIdentifier(e) && e.text === "undefined";
  let v: ts.Expression = n.left;
  if (isUndef(n.left)) v = n.right;
  else if (!isUndef(n.right)) return null; // m172-guard:uk-undefined
  if (!ts.isIdentifier(v)) return null;
  let body: ts.Statement = st.thenStatement;
  if (ts.isBlock(body) && body.statements.length === 1) body = body.statements[0]!;
  if (!ts.isExpressionStatement(body) || !ts.isBinaryExpression(body.expression) || body.expression.operatorToken.kind !== ts.SyntaxKind.EqualsToken) return null;
  const { left, right } = body.expression;
  if (!ts.isIdentifier(right) || right.text !== v.text) return null; // m172-guard:uk-same-value
  const src = (x: ts.Node) => sf.text.slice(x.getStart(sf), x.getEnd());
  let obj: ts.Expression, key: string;
  if (ts.isElementAccessExpression(left) && !left.questionDotToken) {
    const a = left.argumentExpression;
    if (!ts.isIdentifier(a) && !ts.isStringLiteral(a) && !ts.isNumericLiteral(a)) return null; // m172-guard:uk-key
    obj = left.expression; key = src(a);
  } else if (ts.isPropertyAccessExpression(left) && !left.questionDotToken && ts.isIdentifier(left.name)) {
    obj = left.expression; key = JSON.stringify(left.name.text);
  } else return null;
  if (!plainRef(obj)) return null; // m172-guard:uk-ref
  return `${src(n)} || ${key} in ${src(obj)}`;
}

/** M168: every idiom candidate inside one site (no I/O); repair-v2 only. */
export function idiomMutationsIn(sf: ts.SourceFile, site: Site, siteIndex: number): Mutation[] {
  const out: Mutation[] = [];
  const fixed = fixedNames(sf);
  const visit = (n: ts.Node) => {
    const s = n.getStart(sf);
    if (s < site.start || n.getEnd() > site.end) { ts.forEachChild(n, visit); return; }
    const add = (rep: string | null, template: Idiom) => { if (rep !== null) out.push({ path: site.path, start: s, end: n.getEnd(), text: rep, template, site: siteIndex }); };
    add(discardedResult(n, sf, fixed), "discarded-result");
    add(casePredicate(n, sf), "case-predicate");
    add(typeofNull(n, sf), "typeof-null");
    add(protoSafeCopy(n, sf), "proto-safe-copy");
    add(undefinedKeepsKey(n, sf), "undefined-keeps-key");
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

/**
 * M173 const-value (repair-v2 only): a decimal integer literal (0 or 1 to 6 digits, optionally negated) that is the
 * whole initializer of a top-level `const` inside the site, or one element / one property value directly inside that
 * initializer's array or object literal -> the value + 1 and - 1. A wrong limit, size or table entry is an off-by-one
 * that the v1 templates never reach (they edit literals only inside comparisons, arithmetic, indexes and calls).
 */
export function constMutationsIn(sf: ts.SourceFile, site: Site, siteIndex: number): Mutation[] {
  const out: Mutation[] = [];
  for (const st of sf.statements) {
    if (st.getStart(sf) < site.start || st.getEnd() > site.end || !ts.isVariableStatement(st)) continue;
    if (!(st.declarationList.flags & ts.NodeFlags.Const)) continue; // m173-guard:cv-const
    for (const d of st.declarationList.declarations) {
      if (!d.initializer) continue;
      const values: ts.Expression[] = [d.initializer];
      if (ts.isArrayLiteralExpression(d.initializer)) values.push(...d.initializer.elements); // m173-guard:cv-array
      if (ts.isObjectLiteralExpression(d.initializer)) for (const p of d.initializer.properties) if (ts.isPropertyAssignment(p)) values.push(p.initializer); // m173-guard:cv-object
      for (const e of values) {
        const neg = ts.isPrefixUnaryExpression(e) && e.operator === ts.SyntaxKind.MinusToken;
        const lit = neg ? (e as ts.PrefixUnaryExpression).operand : e;
        if (!ts.isNumericLiteral(lit)) continue;
        if (!/^(?:0|[1-9]\d{0,5})$/.test(lit.getText(sf))) continue; // m173-guard:cv-int
        const v = (neg ? -1 : 1) * Number(lit.text);
        for (const w of [v + 1, v - 1]) out.push({ path: site.path, start: e.getStart(sf), end: e.getEnd(), text: String(w), template: "const-value", site: siteIndex });
      }
    }
  }
  return out;
}

const parses = (path: string, text: string): boolean => ((parseSource(path, text) as unknown as { parseDiagnostics?: unknown[] }).parseDiagnostics ?? [1]).length === 0;
const applyAll = (text: string, ms: readonly Mutation[]): string => [...ms].sort((a, b) => b.start - a.start).reduce((t, x) => t.slice(0, x.start) + x.text + t.slice(x.end), text);
const overlaps = (a: Mutation, b: Mutation) => a.path === b.path && a.start < b.end && b.start < a.end || (a.path === b.path && a.start === b.start);

export interface Candidate { key: string; muts: Mutation[]; edits: RepairEdit[] }

/** Builds a candidate from mutations on the original files, or null when it is not a valid one-site (or combined) edit. */
export function candidateFor(files: ReadonlyMap<string, string>, muts: Mutation[]): Candidate | null {
  const edits: RepairEdit[] = [];
  for (const path of [...new Set(muts.map((x) => x.path))].sort()) {
    const orig = files.get(path);
    if (orig === undefined) return null;
    const next = applyAll(orig, muts.filter((x) => x.path === path));
    if (next === orig) return null; // guard:changed
    if (!parses(path, next)) return null; // guard:parse
    edits.push({ path, content: next });
  }
  return { key: sha(JSON.stringify(edits)), muts, edits };
}

/**
 * repair-v1's candidate list for located sites on the original files: every template mutation, in the fixed order
 * (template, then located site, then position), kept when it is a changed, parsing, new edit, at most MAX_CANDIDATES.
 * `seen` collects the keys (shared with the combination step). M167: model-v1's scoring job builds the same list.
 */
export function repairCandidates(sites: readonly Site[], files: ReadonlyMap<string, string>, seen: Set<string> = new Set(), v2 = false): Candidate[] {
  const all: Mutation[] = [];
  const exported = new Map<string, Set<string>>();
  sites.forEach((site, i) => {
    const text = files.get(site.path);
    if (text === undefined) return;
    const sf = parseSource(site.path, text);
    if (!exported.has(site.path)) {
      const ex = new Set<string>();
      for (const st of sf.statements) {
        if (ts.isExportDeclaration(st) && st.exportClause && ts.isNamedExports(st.exportClause)) for (const e of st.exportClause.elements) ex.add((e.propertyName ?? e.name).text);
        if (ts.isExportAssignment(st) && ts.isIdentifier(st.expression)) ex.add(st.expression.text);
      }
      exported.set(site.path, ex);
    }
    all.push(...mutationsIn(sf, site, i, exported.get(site.path)!));
    if (v2) all.push(...idiomMutationsIn(sf, site, i)); // m168-guard:idioms-v2-only
    if (v2) all.push(...constMutationsIn(sf, site, i)); // m173-guard:cv-v2-only
  });
  const order: readonly Template[] = v2 ? TEMPLATES_V2 : TEMPLATES;
  const rank = (x: Mutation) => order.indexOf(x.template);
  all.sort((a, b) => rank(a) - rank(b) || a.site - b.site || a.start - b.start || a.end - b.end || (a.text < b.text ? -1 : a.text > b.text ? 1 : 0));
  const queue: Candidate[] = [];
  for (const x of all) {
    if (queue.length >= MAX_CANDIDATES) break; // guard:cap
    const c = candidateFor(files, [x]);
    if (!c) continue;
    if (seen.has(c.key)) continue; // guard:dedupe
    seen.add(c.key);
    queue.push(c);
  }
  return queue;
}

// ---- M174: load-repair candidates (repair-v2 only)

export const MAX_LOAD_CANDIDATES = 2;
const DECL_KINDS = (n: ts.Node): boolean => ts.isFunctionDeclaration(n) || ts.isClassDeclaration(n) || ts.isInterfaceDeclaration(n) || ts.isTypeAliasDeclaration(n) || ts.isEnumDeclaration(n) || ts.isVariableStatement(n);
const mods = (n: ts.Node): readonly ts.ModifierLike[] => (ts.canHaveModifiers(n) ? ts.getModifiers(n) ?? [] : []);
/** The top-level statements of `sf` that declare `name` (a variable statement counts with its declarator names). */
function topDeclsNamed(sf: ts.SourceFile, name: string): { st: ts.Statement; single: boolean }[] {
  const out: { st: ts.Statement; single: boolean }[] = [];
  for (const st of sf.statements) {
    if (ts.isVariableStatement(st)) {
      const names = st.declarationList.declarations.map((d) => (ts.isIdentifier(d.name) ? d.name.text : null));
      if (names.includes(name)) out.push({ st, single: names.length === 1 });
    } else if ((ts.isFunctionDeclaration(st) || ts.isClassDeclaration(st) || ts.isInterfaceDeclaration(st) || ts.isTypeAliasDeclaration(st) || ts.isEnumDeclaration(st) || ts.isModuleDeclaration(st)) && st.name && ts.isIdentifier(st.name) && st.name.text === name) out.push({ st, single: true });
  }
  return out;
}
/** load-export: `name` is declared once at the top level of the module, by one plain declaration that nothing exports. */
export function loadExportAt(sf: ts.SourceFile, name: string): number | null {
  const ds = topDeclsNamed(sf, name);
  const [first] = ds;
  if (!first) return null;
  if (ds.length !== 1) return null; // m174-guard:le-one-decl (overloads, merged declarations: not one edit)
  const { st, single } = first;
  if (!DECL_KINDS(st)) return null; // m174-guard:le-kind
  if (!single) return null; // m174-guard:le-single (exporting `const a = 1, b = 2` would export more than the name)
  if (mods(st).some((m) => m.kind === ts.SyntaxKind.ExportKeyword || m.kind === ts.SyntaxKind.DeclareKeyword || m.kind === ts.SyntaxKind.DefaultKeyword)) return null; // m174-guard:le-plain
  if (ts.isFunctionDeclaration(st) && !st.body) return null; // m174-guard:le-body
  for (const x of sf.statements) if (ts.isExportDeclaration(x) && x.exportClause && ts.isNamedExports(x.exportClause) && x.exportClause.elements.some((e) => e.name.text === name || (e.propertyName ?? e.name).text === name)) return null; // m174-guard:le-not-listed
  return st.getStart(sf);
}
/** The names a module exports directly (an exported declaration, or a local `export { a }` list without a module). */
function directExports(sf: ts.SourceFile): Set<string> {
  const out = new Set<string>();
  for (const st of sf.statements) {
    if (ts.isExportDeclaration(st)) {
      if (!st.moduleSpecifier && !st.isTypeOnly && st.exportClause && ts.isNamedExports(st.exportClause)) for (const e of st.exportClause.elements) if (!e.isTypeOnly) out.add(e.name.text);
      continue;
    }
    if (!mods(st).some((m) => m.kind === ts.SyntaxKind.ExportKeyword) || mods(st).some((m) => m.kind === ts.SyntaxKind.DefaultKeyword || m.kind === ts.SyntaxKind.DeclareKeyword)) continue;
    if (ts.isVariableStatement(st)) { for (const d of st.declarationList.declarations) if (ts.isIdentifier(d.name)) out.add(d.name.text); }
    else if ((ts.isFunctionDeclaration(st) || ts.isClassDeclaration(st) || ts.isEnumDeclaration(st)) && st.name) out.add(st.name.text);
  }
  return out;
}
/** The specifier a module `from` uses for `to` (both repo paths), in the extension style its own relative imports use
 *  (".js", ".ts", or none); a module with no relative import takes the team test's style (`testSpec`). */
export function specFor(fromSf: ts.SourceFile, from: string, to: string, testSpec: string): string {
  const own: string[] = [];
  for (const st of fromSf.statements) if ((ts.isImportDeclaration(st) || ts.isExportDeclaration(st)) && st.moduleSpecifier && ts.isStringLiteral(st.moduleSpecifier) && /^\.\.?\//.test(st.moduleSpecifier.text)) own.push(st.moduleSpecifier.text);
  const style = (s: string) => (/\.[cm]?js$/.test(s) ? "js" : /\.[cm]?tsx?$/.test(s) ? "ts" : "none");
  const st = own.length ? style(own[0]!) : style(testSpec);
  let rel = posix.relative(posix.dirname(from), to);
  if (!rel.startsWith(".")) rel = `./${rel}`;
  return st === "ts" ? rel : st === "js" ? rel.replace(/\.(m|c)?tsx?$/, (_, k: string | undefined) => `.${k ?? ""}js`) : rel.replace(/\.[cm]?tsx?$/, "").replace(/\/index$/, "");
}
/** load-reexport: the one other non-test source file that exports `name` directly (null: none, or more than one). */
export function reexportFrom(files: ReadonlyMap<string, string>, module: string, name: string): string | null {
  const hits: string[] = [];
  for (const [p, text] of files) {
    if (p === module || !SOURCE.test(p) || /\.d\.[cm]?ts$/.test(p)) continue;
    if (isTestPath(p) || isGeneratedPath(p)) continue; // m174-guard:re-not-test
    if (directExports(parseSource(p, text)).has(name)) hits.push(p);
  }
  return hits.length === 1 ? hits[0]! : null; // m174-guard:re-unique
}
/**
 * The load-repair candidates for the loop's MISSING_EXPORT diagnostics: one edit that fixes every missing name at once
 * (each by load-export when the module declares it, else by load-reexport), then the same with load-reexport where
 * both apply. None when any name has no fix (a suite missing one name still does not load). Nothing is ever invented:
 * an existing declaration is exported, or an existing export is re-exported.
 */
export function loadCandidates(diags: readonly LoadDiag[], files: ReadonlyMap<string, string>): Candidate[] {
  const wanted = new Map<string, { module: string; name: string; spec: string }>();
  for (const d of diags) if (d.kind === "MISSING_EXPORT") wanted.set(`${d.module}\0${d.name}`, d); // m174-guard:lc-export-only
  if (wanted.size === 0) return [];
  const fixes: { local: Mutation | null; re: Mutation | null }[] = [];
  const appends = new Map<string, number>();
  for (const w of [...wanted.values()].sort((a, b) => (a.module + "\0" + a.name < b.module + "\0" + b.name ? -1 : 1))) {
    const text = files.get(w.module);
    if (text === undefined) return [];
    const sf = parseSource(w.module, text);
    const at = loadExportAt(sf, w.name);
    const local: Mutation | null = at === null ? null : { path: w.module, start: at, end: at, text: "export ", template: "load-export", site: 0 };
    const from = reexportFrom(files, w.module, w.name);
    const k = (appends.get(w.module) ?? 0) + 1;
    const re: Mutation | null = from === null ? null : { path: w.module, start: text.length, end: text.length, text: `export { ${w.name} } from ${JSON.stringify(specFor(sf, w.module, from, w.spec))};\n`, template: "load-reexport", site: k };
    if (re) appends.set(w.module, k);
    if (!local && !re) return []; // m174-guard:lc-all-fixed
    fixes.push({ local, re });
  }
  const out: Candidate[] = [];
  const seen = new Set<string>();
  for (const pick of [(f: (typeof fixes)[number]) => f.local ?? f.re, (f: (typeof fixes)[number]) => f.re ?? f.local]) {
    const chosen = fixes.map(pick).filter((m): m is Mutation => m !== null);
    // the re-export lines of one module become one append at its end, in name order
    const merged: Mutation[] = chosen.filter((m) => m.template === "load-export");
    for (const path of [...new Set(chosen.map((m) => m.path))]) {
      const tail = chosen.filter((m) => m.path === path && m.template === "load-reexport").sort((a, b) => a.site - b.site);
      if (tail.length) merged.push({ ...tail[0]!, text: (files.get(path)!.endsWith("\n") ? "" : "\n") + tail.map((m) => m.text).join(""), site: 0 });
    }
    const c = candidateFor(files, merged);
    if (c && !seen.has(c.key)) { seen.add(c.key); out.push(c); }
  }
  return out.slice(0, MAX_LOAD_CANDIDATES);
}

/** M167: options for a proposer built on repair-v1 (model-v1): its row name, and a reorder of the first candidate
 *  list (called once, also with [] when nothing was located; a throw is the proposer's failure, PROPOSER_FAILED). */
export interface RepairOptions { name?: string; order?: (queue: readonly Candidate[]) => Candidate[]; v2?: boolean }

/**
 * The general repair proposer (repair-v1). prepare() is called once per task by the loop with the search tools on the
 * pinned commit (no team tests) and the baseline's failing test names (node:test only; [] for vitest / jest).
 */
export function repairProposer(opts: RepairOptions = {}): { name: string; readonly loadRepair: boolean; prepare(search: CodeRepo, input: PrepareInput): void; next(input: RepairInput): RepairProposal } {
  let sites: Site[] | null = null;
  let queue: Candidate[] | null = null;
  let loadQueue: Candidate[] | null = null;
  const tried: Candidate[] = [];
  const seen = new Set<string>();
  const combined = new Set<string>();
  return {
    name: opts.name ?? (opts.v2 ? REPAIR_PROPOSER_V2 : REPAIR_PROPOSER),
    // M174: repair-v2 only (never repair-v1 or a reranked list such as model-v1's): the loop may then ask it for a
    // suite that does not load, giving only its load diagnostics
    loadRepair: opts.v2 === true && !opts.order, // m174-guard:lr-v2-only
    prepare(search, input) { sites = locate(search, input, opts.v2 ? CALLEE_DEPTH.v2 : CALLEE_DEPTH.v1); },
    next(input) {
      if (input.loadDiagnostics && opts.v2 === true) {
        // a suite that did not load: only load-repair candidates, one per attempt (the other templates have no signal)
        if (!loadQueue) { loadQueue = loadCandidates(input.loadDiagnostics, new Map(input.files.map((f) => [f.path, f.content] as const))); if (loadQueue.length === 0) return { refuse: "NO_EDIT" }; }
        const pick = loadQueue.shift();
        return pick ? { edits: pick.edits } : { refuse: "NO_MORE_EDITS" };
      }
      if (opts.order && !queue && (!sites || sites.length === 0)) { queue = opts.order([]); } // M167: the ranking must hold for "nothing located" too
      if (!sites || sites.length === 0) return { refuse: "NO_EDIT" }; // nothing the request names was located: no edit anywhere
      const files = new Map(input.files.map((f) => [f.path, f.content] as const));
      if (!queue) {
        queue = repairCandidates(sites, files, seen, opts.v2 === true);
        if (opts.order) queue = opts.order(queue);
        if (queue.length === 0) return { refuse: "NO_EDIT" };
      }
      const last = input.feedback[input.feedback.length - 1];
      if (last && last.codes.some((c) => c === "TAMPERED" || c === "LEFTOVERS")) return { refuse: "NO_MORE_EDITS" }; // guard:stop-unsafe
      // evidence from the counts: candidates that raised the passing count with no other failure code
      const base = input.baseline?.passing ?? null;
      const improved = base === null ? [] : tried
        .map((c, i) => ({ c, fb: input.feedback.find((f) => f.attempt === i + 1) }))
        .filter(({ fb }) => fb && fb.tests && fb.tests.passedByPeaceAI > base && fb.codes.every((x) => x === "TEST_FAIL")) // guard:combine-improved
        .sort((a, b) => b.fb!.tests!.passedByPeaceAI - a.fb!.tests!.passedByPeaceAI || tried.indexOf(a.c) - tried.indexOf(b.c))
        .map((x) => x.c);
      let pick: Candidate | null = null;
      for (let i = 0; i < improved.length && !pick; i++) {
        for (let j = i + 1; j < improved.length && !pick; j++) {
          const a = improved[i]!, b = improved[j]!;
          const pair = [a.key, b.key].sort().join("+");
          if (combined.has(pair) || a.muts.some((x) => b.muts.some((y) => overlaps(x, y)))) continue;
          combined.add(pair);
          const c = candidateFor(files, [...a.muts, ...b.muts]);
          if (c && !seen.has(c.key)) { seen.add(c.key); pick = c; }
        }
      }
      pick ??= queue.shift() ?? null;
      if (!pick) return { refuse: "NO_MORE_EDITS" };
      tried.push(pick);
      return { edits: pick.edits };
    },
  };
}
