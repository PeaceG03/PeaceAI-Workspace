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
import { createHash } from "node:crypto";
import ts from "typescript";
import { isGeneratedPath, isTestPath, type CodeRepo } from "./codesearch.ts";

/** The loop's proposer interface (structural copy of loop.ts Proposer / ProposeInput: no import cycle). */
export interface RepairEdit { path: string; content: string }
export interface RepairFeedback { attempt: number; codes: readonly string[]; failing: readonly string[]; tests?: { total: number; passedByPeaceAI: number } | null }
export interface RepairInput { files: readonly { path: string; content: string }[]; attempt: number; feedback: readonly RepairFeedback[]; baseline?: { total: number; passing: number; failing: number } | null }
export interface PrepareInput { request: string; failing: readonly string[] }
export type RepairProposal = { edits: RepairEdit[] } | { refuse: "NO_EDIT" | "NO_MORE_EDITS" };

export const REPAIR_PROPOSER = "repair-v1";
export const MAX_CANDIDATES = 60;
export const MAX_SYMBOLS = 8;
export const MAX_SITES = 12;
const MAX_FILES_PER_SYMBOL = 6;
const MAX_CALLEES = 6;
/** The fixed template order (rank = index). */
export const TEMPLATES = ["missing-export", "nullish-check", "comparison", "arithmetic", "off-by-one", "logical", "default-value", "null-guard", "negate-condition", "boolean-return"] as const;
export type Template = (typeof TEMPLATES)[number];

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

/** The located sites, computed once from the search tools (see prepare). */
export function locate(search: CodeRepo, input: PrepareInput): Site[] {
  const names = [...namedSymbols(input.request), ...input.failing.flatMap((n) => namedSymbols(n))].filter((n, i, a) => a.indexOf(n) === i).slice(0, MAX_SYMBOLS);
  const sites: Site[] = [];
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
    for (const p of files.filter(allowed).slice(0, MAX_FILES_PER_SYMBOL)) {
      const text = textOf(p);
      if (text === null) continue;
      const sf = parseSource(p, text);
      const tops = topFunctions(sf);
      for (const d of declarationsNamed(sf, name)) {
        push({ path: p, name, start: d.getStart(sf), end: d.getEnd(), tier: 0 });
        // one level of same-file callees (the fault is often one call below the named entry point)
        const callees: string[] = [];
        const walk = (n: ts.Node) => {
          if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text !== name && tops.has(n.expression.text) && !callees.includes(n.expression.text)) callees.push(n.expression.text);
          ts.forEachChild(n, walk);
        };
        walk(d);
        for (const c of callees.slice(0, MAX_CALLEES)) { const t = tops.get(c)!; push({ path: p, name: c, start: t.getStart(sf), end: t.getEnd(), tier: 1 }); }
      }
    }
  }
  return sites;
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
export function repairCandidates(sites: readonly Site[], files: ReadonlyMap<string, string>, seen: Set<string> = new Set()): Candidate[] {
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
  });
  const rank = (x: Mutation) => TEMPLATES.indexOf(x.template);
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

/** M167: options for a proposer built on repair-v1 (model-v1): its row name, and a reorder of the first candidate
 *  list (called once, also with [] when nothing was located; a throw is the proposer's failure, PROPOSER_FAILED). */
export interface RepairOptions { name?: string; order?: (queue: readonly Candidate[]) => Candidate[] }

/**
 * The general repair proposer (repair-v1). prepare() is called once per task by the loop with the search tools on the
 * pinned commit (no team tests) and the baseline's failing test names (node:test only; [] for vitest / jest).
 */
export function repairProposer(opts: RepairOptions = {}): { name: string; prepare(search: CodeRepo, input: PrepareInput): void; next(input: RepairInput): RepairProposal } {
  let sites: Site[] | null = null;
  let queue: Candidate[] | null = null;
  const tried: Candidate[] = [];
  const seen = new Set<string>();
  const combined = new Set<string>();
  return {
    name: opts.name ?? REPAIR_PROPOSER,
    prepare(search, input) { sites = locate(search, input); },
    next(input) {
      if (opts.order && !queue && (!sites || sites.length === 0)) { queue = opts.order([]); } // M167: the ranking must hold for "nothing located" too
      if (!sites || sites.length === 0) return { refuse: "NO_EDIT" }; // nothing the request names was located: no edit anywhere
      const files = new Map(input.files.map((f) => [f.path, f.content] as const));
      if (!queue) {
        queue = repairCandidates(sites, files, seen);
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
