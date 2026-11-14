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
import ts from "typescript";
import { isGeneratedPath, isTestPath, type CodeRepo } from "./codesearch.ts";

/** The loop's proposer interface (structural copy of loop.ts Proposer / ProposeInput: no import cycle). */
/** M174: structural copy of loop.ts LoadDiag (one filtered load diagnostic). */
export interface LoadDiag { kind: "MISSING_EXPORT" | "MISSING_MODULE"; test: string; module: string; name: string; spec: string }
export interface RepairEdit { path: string; content: string }
export interface RepairFeedback { attempt: number; codes: readonly string[]; failing: readonly string[]; tests?: { total: number; passedByPeaceAI: number } | null }
export interface RepairInput { files: readonly { path: string; content: string }[]; attempt: number; feedback: readonly RepairFeedback[]; baseline?: { total: number; passing: number; failing: number } | null; loadDiagnostics?: readonly LoadDiag[] }
/** M190: `failing` feeds localisation (node:test names only); `baseFailing` (when given) is the baseline's failing test
 *  names for the outcome evidence (M178 / M179 / M191), vitest / jest names included. */
export interface PrepareInput { request: string; failing: readonly string[]; baseFailing?: readonly string[] }
export type RepairProposal = { edits: RepairEdit[]; kind?: string } | { refuse: "NO_EDIT" | "NO_MORE_EDITS" };

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
export const IDIOM_TEMPLATES = ["discarded-result", "case-predicate", "typeof-null", "proto-safe-copy", "undefined-keeps-key", "own-keys", "enum-values"] as const; // M172: + undefined-keeps-key
export type Idiom = (typeof IDIOM_TEMPLATES)[number];
/** M173 (spec: peaceai/spec/repair-v2-m173.md): repair-v2's module-scope constant template, tried after all others. */
export const CONST_TEMPLATES = ["const-value"] as const;
/** M174 (repair-v2 only, spec/load-diagnostics-m174.md): edits for a team suite that does not load because it imports a
 *  name its source module does not export; proposed only from the loop's load diagnostics, never beside the others. */
export const LOAD_TEMPLATES = ["load-export"] as const;
/** M176 (repair-v2 only): simple-stupid-bug edit classes that only rearrange or swap words already in the site. */
export const SSTUB_TEMPLATES = ["swap-statements", "swap-args", "swap-operands", "change-identifier"] as const;
/** M177 (repair-v2 only, spec: peaceai/spec/repair-v2-m177.md): statement-level edits built only from statements already in
 *  the file: copy an existing guard into another function, or delete one statement. */
export const STMT_TEMPLATES = ["copy-guard", "delete-statement"] as const;
export type Template = (typeof TEMPLATES)[number] | Idiom | (typeof CONST_TEMPLATES)[number] | (typeof LOAD_TEMPLATES)[number] | (typeof SSTUB_TEMPLATES)[number] | (typeof STMT_TEMPLATES)[number];
/** M168: repair-v2's full order (idioms first, then the v1 templates unchanged; M173: then const-value). */
export const TEMPLATES_V2: readonly Template[] = [...IDIOM_TEMPLATES, ...TEMPLATES, ...CONST_TEMPLATES, ...SSTUB_TEMPLATES, ...STMT_TEMPLATES]; // M176: + SStuB classes; M177: + statement edits last
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

// ---- plain-language aim
// A commit subject or issue sentence that does not fill an edit-family phrase can still name the
// symbol to repair. The phrase list stays strict. This reader only chooses symbols, then the
// existing repair-v2 proposer edits them. It does not invent a body, a new function, or a rename.
// A sentence is an aim only when it asks for a change: an edit verb with an object, or a subject
// that leads with a code name and says that name was chosen, added, fixed, or otherwise changed.
// Thanks, questions, and renames are not body repairs. A plain word is a symbol only when the
// repo defines it exactly once, so a vague noun is not a guess across the tree.

export const TEXT_REPAIR_REASONS = ["CANT_DO_YET_NO_EDIT", "CANT_DO_YET_EDIT_UNSPECIFIED", "CANT_DO_YET_ADD_UNSPECIFIED", "CANT_DO_YET_NOT_A_FAMILY"] as const;
/** How many repair-v2 candidates Job A may emit from a sentence. The proposer's own order, capped. */
export const TEXT_REPAIR_LIMIT = 8;

const AIM_VERBS = "fix|fixes|fixed|fixing|handle|handles|handled|handling|correct|corrects|corrected|correcting|support|supports|supported|supporting|add|adds|added|adding|implement|implements|implemented|implementing|allow|allows|allowed|allowing|enable|enables|enabled|enabling|expose|exposes|exposed|exposing|improve|improves|improved|improving|update|updates|updated|updating|change|changes|changed|changing|include|includes|included|including|accept|accepts|accepted|accepting|reject|rejects|rejected|rejecting|drop|drops|dropped|dropping|remove|removes|removed|removing|wrap|wraps|wrapped|wrapping|default|defaults|defaulted|defaulting|guard|guards|guarded|guarding|check|checks|checked|checking|validate|validates|validated|validating|keep|keeps|kept|keeping|give|gives|gave|given|giving";
const AIM_VERB = new RegExp(String.raw`\b(?:please |can you |could you |we need to )?(?<verb>${AIM_VERBS})\b`, "i");
const AIM_THANKS = /^(?:thanks|thank you|lgtm|nit|wip)\b/i;
const AIM_QUESTION = /\?\s*$/;
const AIM_BOUNDARY = /\b(?:when|if)\b/i;
const AIM_CUE = /\b(?:chosen|selected|picked|added|fixed|updated|removed|renamed|changed|handled|supported|implemented|returned|accepted|rejected|corrected|enabled|disabled|exposed|exported|replaced|dropped|skipped|included|excluded)\b/i;
const AIM_META = new Set(`${AIM_VERBS.replaceAll("|", " ")} option options flag flags setting settings mode modes helper helpers function functions method methods predicate predicates property properties field fields value values type types array arrays object objects case cases edge bug issue error errors message messages assertion assertions export exports named missing new existing better default empty blank whitespace numeric key keys name names expression expressions factory detection narrowing range review candidate patch the a an it this that when if so to of in for and or with from on by is are be was were been not as into please can could should must would will we you our their than too very just more most only same other whole focused extra optional required simple real current previous next first last single multiple wrong incorrect silent silently incorrectly minified surrounding`.split(/\s+/));
const AIM_SOURCE = /\.(?:ts|tsx|mts|cts)$/;

export interface EditAim { symbols: string[]; via: "verb" | "lead" }

/** The same conventional-commit and issue-number cleanup the phrase reader applies, plus a bang (`feat!:`). */
export function aimSource(text: string): string {
  return text.replace(/\s+/g, " ").trim()
    .replace(/^(?:fix|feat|chore|docs|refactor|test|perf|style)(?:\([^)]{0,40}\))?!?:\s+/i, (m) => /^fix/i.test(m) ? "fix " : "")
    .replace(/\s*\(#\d+\)/g, "")
    .replace(/\s+#\d+\b/g, "")
    .trim();
}

function aimCodeName(word: string): boolean {
  const named = namedSymbols(word);
  return named.length === 1 && named[0] === word;
}

function pushAim(out: string[], word: string): void {
  if (word.length >= 2 && word.length <= 64 && !out.includes(word)) out.push(word);
}

/**
 * Symbols a sentence asks to change, or null when it is not that kind of sentence.
 * `verb`: an edit verb, and the code names (or, if there are none, the plain nouns) before when/if.
 * `lead`: the subject starts with a code name and a change word (selected, added, fixed, ...).
 */
export function editAim(text: string): EditAim | null {
  const source = aimSource(text);
  if (!source) return null;
  if (AIM_THANKS.test(source)) return null; // text-guard:thanks
  if (AIM_QUESTION.test(source)) return null; // text-guard:question
  if (/\brenam(?:e|ed|ing)\b/i.test(source) && /\bto\b/i.test(source)) return null; // text-guard:rename
  let verb: RegExpExecArray | null = null;
  verb = AIM_VERB.exec(source); // text-guard:verb
  if (verb) {
    let region = source;
    const rest = source.slice(verb.index + verb[0].length);
    const boundary = AIM_BOUNDARY.exec(rest);
    if (boundary) region = source.slice(0, verb.index + verb[0].length + boundary.index); // text-guard:when-object
    const symbols: string[] = [];
    for (const m of region.matchAll(/`([^`]{1,80})`/g)) {
      for (const w of m[1]!.matchAll(/[A-Za-z_$][\w$]*/g)) if (!AIM_META.has(w[0].toLowerCase())) pushAim(symbols, w[0]); // text-guard:backtick
    }
    const prose = region.replace(/`[^`]*`/g, " ");
    for (const w of prose.matchAll(/[A-Za-z_$][\w$]*/g)) if (aimCodeName(w[0])) pushAim(symbols, w[0]); // text-guard:code-shape
    let plain = false;
    plain = symbols.length === 0; // text-guard:plain-fallback
    if (plain) {
      for (const w of prose.matchAll(/[A-Za-z_$][\w$]*/g)) {
        if (aimCodeName(w[0]) || w[0].length < 3 || AIM_META.has(w[0].toLowerCase())) continue; // text-guard:meta
        pushAim(symbols, w[0]);
      }
    }
    return symbols.length ? { symbols, via: "verb" } : null;
  }
  const lead = /^([A-Za-z_$][\w$]*)/.exec(source);
  if (!lead || !aimCodeName(lead[1]!)) return null; // text-guard:lead-symbol
  if (!AIM_CUE.test(source)) return null; // text-guard:no-cue
  const extras = [...source.matchAll(/[A-Za-z_$][\w$]*/g)].map((m) => m[0]).filter((w) => w !== lead[1] && aimCodeName(w));
  let symbols = [lead[1]!, ...extras];
  symbols = symbols.slice(0, 1); // text-guard:lead-only
  return { symbols, via: "lead" };
}

/** Keep a code-shaped name even when several files define it. Keep a plain name only when one source file defines it. */
export function resolvableSymbols(search: CodeRepo, symbols: readonly string[]): string[] {
  const out: string[] = [];
  for (const name of symbols) {
    if (aimCodeName(name)) { out.push(name); continue; } // text-guard:shaped-keep
    const sym = search.symbol(name);
    if (!sym.ok) continue;
    const defs = sym.definitions.filter((d) => AIM_SOURCE.test(d.path) && !d.path.endsWith(".d.ts") && !isTestPath(d.path) && !isGeneratedPath(d.path));
    if (defs.length !== 1) continue; // text-guard:plain-unique
    out.push(name);
  }
  return out;
}

/** The request the repair proposer reads: the sentence, with every code name except the aim blanked, and the aim in code spans. */
export function textRepairRequest(text: string, symbols: readonly string[]): string {
  const keep = new Set(symbols);
  const prose = aimSource(text).replace(/`[^`]*`/g, " ").replace(/[A-Za-z_$][\w$]*/g, (w) => {
    if (keep.has(w)) return w;
    if (aimCodeName(w)) return " "; // text-guard:hide-other
    return w;
  });
  return `${prose}\n${symbols.map((s) => `\`${s}\``).join(" ")}`;
}

/**
 * Repair-v2 candidates for a sentence, in the proposer's own order, at most `limit`.
 * An empty list means the sentence named nothing this repo defines, or the proposer has no edit there.
 */
export function proposeTextEdits(search: CodeRepo, request: string, limit = TEXT_REPAIR_LIMIT): RepairEdit[][] {
  const sites = locate(search, { request, failing: [] }, CALLEE_DEPTH.v2);
  const files: { path: string; content: string }[] = [];
  const seenPath = new Set<string>();
  for (const site of sites) {
    if (seenPath.has(site.path)) continue;
    seenPath.add(site.path);
    const read = search.read(site.path);
    if (!read.ok || read.truncated) continue;
    files.push({ path: site.path, content: read.text });
  }
  const proposer = repairProposer({ v2: true });
  proposer.prepare(search, { request, failing: [] }); // text-guard:proposer
  const out: RepairEdit[][] = [];
  const feedback: RepairFeedback[] = [];
  for (let attempt = 1; attempt <= MAX_CANDIDATES; attempt++) {
    if (out.length >= limit) break; // text-guard:limit
    const proposal = proposer.next({ files, attempt, feedback, baseline: null });
    if ("refuse" in proposal) break;
    out.push(proposal.edits);
    feedback.push({ attempt, codes: ["TEST_FAIL"], failing: [], tests: null });
  }
  return out;
}

/** The sentence's aim, resolved against this repo, handed to repair-v2. */
export function textRepairBatches(search: CodeRepo, text: string, limit = TEXT_REPAIR_LIMIT): RepairEdit[][] {
  const aim = editAim(text);
  if (!aim) return [];
  const symbols = resolvableSymbols(search, aim.symbols);
  if (symbols.length === 0) return [];
  return proposeTextEdits(search, textRepairRequest(text, symbols), limit);
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

/**
 * Where a property or assignment named `name` actually runs, in this file.
 * An object literal `{ name: fn }` and `obj.name = fn` do not contain the body when `fn` is another
 * binding. A const arrow and an inline function do. Repair-v2 follows these; the property alias itself
 * has nothing to edit.
 */
function aliasBodies(sf: ts.SourceFile, name: string): ts.Node[] {
  const tops = topFunctions(sf);
  const out: ts.Node[] = [];
  const add = (node: ts.Node) => { if (!out.includes(node)) out.push(node); };
  const follow = (expr: ts.Expression) => {
    if (ts.isIdentifier(expr)) { const fn = tops.get(expr.text); if (fn) add(fn); return; }
    if (ts.isArrowFunction(expr) || ts.isFunctionExpression(expr)) add(expr);
  };
  const visit = (n: ts.Node) => {
    if (ts.isPropertyAssignment(n) && propName(n.name) === name) follow(n.initializer);
    else if (ts.isShorthandPropertyAssignment(n) && n.name.text === name) { const fn = tops.get(n.name.text); if (fn) add(fn); }
    else if (ts.isMethodDeclaration(n) && propName(n.name) === name && n.parent && ts.isObjectLiteralExpression(n.parent)) add(n);
    else if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isPropertyAccessExpression(n.left) && propName(n.left.name) === name) follow(n.right);
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}
function propName(name: ts.Node | undefined): string | null {
  if (!name) return null;
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) return name.text;
  return null;
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
/** M172: the file's import bindings from relative modules: local name -> { spec, imported name } (named imports; M186:
 *  and the default import, as the name "default"; never a namespace import). */
function relativeImports(sf: ts.SourceFile): Map<string, { spec: string; name: string }> {
  const m = new Map<string, { spec: string; name: string }>();
  for (const st of sf.statements) {
    if (!ts.isImportDeclaration(st) || !ts.isStringLiteral(st.moduleSpecifier) || !st.importClause) continue;
    if (st.importClause.isTypeOnly) continue; // m172-guard:imp-type-only
    // M186 (spec: repair-v2-m186.md): a default import binds the module's default export, looked up as "default"
    if (st.importClause.name) m.set(st.importClause.name.text, { spec: st.moduleSpecifier.text, name: "default" });
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
  const parsed = new Map<string, ts.SourceFile | null>();
  const sfOf: SfOf = (p) => {
    if (!parsed.has(p)) { const t = textOf(p); parsed.set(p, t === null ? null : parseSource(p, t)); }
    return parsed.get(p) ?? null;
  };
  const allowed = (p: string) => {
    if (!SOURCE.test(p) || p.endsWith(".d.ts")) return false;
    if (isTestPath(p)) return false; // guard:test-path
    if (isGeneratedPath(p)) return false; // guard:generated
    return true;
  };
  const push = (s: Site) => { if (sites.length < MAX_SITES && !sites.some((x) => x.path === s.path && x.start === s.start && x.end === s.end)) sites.push(s); };
  // M184: functions reached through a barrel's re-exports; tier 5, appended after every other site
  const barrel: Site[] = [];
  const viaReExport = (mod: string, name: string) => {
    const r = reExportedDecl(mod, name, "function", MAX_REEXPORT_HOPS, sfOf);
    if (!r) return;
    if (!allowed(r.path)) return; // m184-guard:rx-allowed
    if (barrel.some((x) => x.path === r.path && x.start === r.start)) return;
    if (barrel.length >= MAX_REEXPORT_SITES) return; // m184-guard:rx-cap
    barrel.push({ path: r.path, name: r.name, start: r.start, end: r.end, tier: 5 });
  };
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
          // M184 (repair-v2 only, behind imp-v2-only): the module is a barrel that re-exports the name from another file;
          // M186: a default import ("default") is resolved there too, so its site is appended (tier 5), never in place
          else viaReExport(target, im.name);
        }
      };
      const decls = declarationsNamed(sf, name);
      // A property `{ name: other }` or `obj.name = other` does not contain the function. Follow it
      // only when that body sits outside every declaration of `name` (an inline arrow is already inside
      // the property, and counting it twice would spend a site).
      if (depth >= 2) for (const body of aliasBodies(sf, name)) {
        const start = body.getStart(sf);
        const end = body.getEnd();
        if (decls.some((d) => start >= d.getStart(sf) && end <= d.getEnd())) continue;
        push({ path: p, name, start, end, tier: 0 });
      }
      for (const d of decls) {
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
  // M182 (repair-v2 only, behind the line above): the class members the located members call, after every other site
  const members = memberSites(sites, sfOf, allowed);
  // M184 (repair-v2 only): the barrel-resolved imported functions, after every other site; one already inside a site is
  // not added again
  const earlier = [...sites, ...consts, ...members];
  const known = (b: Site) => earlier.some((x) => x.path === b.path && x.start <= b.start && b.end <= x.end);
  return [...earlier, ...barrel.filter((b) => !known(b))]; // m184-guard:rx-known
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

// ---- M182 member callees (repair-v2 only; spec: peaceai/spec/repair-v2-m182.md)

/** M182: at most this many class-member sites (tier 4) are added after every other site (repair-v2 only). */
export const MAX_MEMBER_SITES = 4;
type ClassMember = ts.MethodDeclaration | ts.GetAccessorDeclaration | ts.SetAccessorDeclaration | ts.ConstructorDeclaration | ts.PropertyDeclaration;
const isMember = (n: ts.Node): n is ClassMember => ts.isMethodDeclaration(n) || ts.isGetAccessorDeclaration(n) || ts.isSetAccessorDeclaration(n) || ts.isConstructorDeclaration(n) || ts.isPropertyDeclaration(n);
const isStaticMember = (n: ts.Node): boolean => (ts.canHaveModifiers(n) ? ts.getModifiers(n) ?? [] : []).some((m) => m.kind === ts.SyntaxKind.StaticKeyword);
/** The members of a class, or of an object literal (read only so that the mc-class guard is what refuses the latter). */
const membersOf = (n: ts.Node): readonly ts.Node[] => (ts.isClassLike(n) ? n.members : ts.isObjectLiteralExpression(n) ? n.properties : []);
/** A member that runs when called: a method, or a property initialised with an arrow / function expression. */
const callableMember = (m: ts.Node): boolean => ts.isMethodDeclaration(m) || (ts.isPropertyDeclaration(m) && !!m.initializer && (ts.isArrowFunction(m.initializer) || ts.isFunctionExpression(m.initializer)));
/** A member with code: a body (not an overload signature, not abstract), or a function initializer. */
const memberHasBody = (m: ts.Node): boolean => (ts.isPropertyDeclaration(m) ? callableMember(m) : !!(m as { body?: ts.Node }).body);

/**
 * M182 (repair-v2 only): the class members a located class member reaches, one level. Inside a located member of a
 * class, `this.m(...)` (also `this.#m(...)`), a read `this.g` of a get accessor, and `C.m(...)` where C is a top-level
 * class of the same file resolve to the member of that class DECLARED there (M183: or, when that class does not declare
 * the name, in its nearest `extends` ancestor; `super.m` starts at the base; M185: an ancestor may be a class the file
 * imports from a relative module, resolved in the file that names it), with the same static-ness
 * as the access (`this` in a static member is the class), with a body. `this` inside a nested non-arrow function or a
 * nested class is another `this` and is not followed. The members become tier-4 sites in located-site order, then
 * source order, at most MAX_MEMBER_SITES, after every other site (so the located sites, the const sites and their
 * numbers are unchanged), skipping any that is already inside a site. The fault is often one call below the entry in
 * class code too; the M152 / M168 / M172 walks follow only plain-identifier calls to functions.
 */
function memberSites(sites: readonly Site[], sfOf: SfOf, allowed: (p: string) => boolean): Site[] {
  const out: Site[] = [];
  for (const site of sites) {
    const sf = sfOf(site.path);
    if (!sf) continue;
    let member: ClassMember | null = null;
    const find = (n: ts.Node) => { if (member) return; if (isMember(n) && n.getStart(sf) === site.start && n.getEnd() === site.end) member = n; else ts.forEachChild(n, find); };
    find(sf);
    const self = member as ClassMember | null;
    if (!self?.parent) continue;
    if (!ts.isClassLike(self.parent)) continue; // m182-guard:mc-class
    const own: ClassAt = { node: self.parent, path: site.path, sf };
    const classes = topClasses(sf);
    const refs: { n: ts.PropertyAccessExpression; own: boolean }[] = [];
    const walk = (n: ts.Node, own: boolean) => {
      // a nested function (not an arrow) or class has its own `this`
      const rebinds = n !== self && ((isFn(n) && !ts.isArrowFunction(n)) || ts.isClassLike(n));
      if (ts.isPropertyAccessExpression(n)) refs.push({ n, own });
      ts.forEachChild(n, (c) => walk(c, own && !rebinds));
    };
    walk(self, true);
    for (const { n, own: ownThis } of refs) {
      const isThis = n.expression.kind === ts.SyntaxKind.ThisKeyword;
      const isSuper = n.expression.kind === ts.SyntaxKind.SuperKeyword;
      if ((isThis || isSuper) && !ownThis) continue; // m182-guard:mc-rebind
      const named = ts.isIdentifier(n.expression) ? classes.get(n.expression.text) : undefined;
      let from: ClassAt | undefined = isThis ? own : named ? { node: named, path: site.path, sf } : undefined;
      // M183: `super.m` starts at the class the member's own class extends, never at the own class
      if (isSuper) from = baseOf(own, sfOf, allowed); // m183-guard:ih-super
      const call = ts.isCallExpression(n.parent) && n.parent.expression === n;
      const wantStatic = isThis || isSuper ? isStaticMember(self) : true;
      // M183: the nearest class in the extends chain that declares the name (M182 alone: the start class only)
      const owner = from ? ownerOf(from, n.name.text, wantStatic, sfOf, allowed) : undefined;
      if (!owner) continue;
      for (const m of membersOf(owner.node)) {
        if (nameOf(m) !== n.name.text) continue;
        if (isStaticMember(m) !== wantStatic) continue; // m182-guard:mc-static
        if (!(call ? callableMember(m) : ts.isGetAccessorDeclaration(m))) continue; // m182-guard:mc-kind
        if (!memberHasBody(m)) continue; // m182-guard:mc-body
        const s = m.getStart(owner.sf), e = m.getEnd();
        if (sites.some((x) => x.path === owner.path && x.start <= s && e <= x.end) || out.some((x) => x.path === owner.path && x.start === s && x.end === e)) continue; // m182-guard:mc-known
        if (out.length >= MAX_MEMBER_SITES) return out; // m182-guard:mc-cap
        out.push({ path: owner.path, name: n.name.text, start: s, end: e, tier: 4 });
      }
    }
  }
  return out;
}

// ---- M184 barrel re-exports (repair-v2 only; spec: peaceai/spec/repair-v2-m184.md)

/** M184: at most this many re-export steps are followed from the module an import names. */
export const MAX_REEXPORT_HOPS = 3;
/** M184: at most this many barrel-resolved sites (tier 5) are added after every other site. */
export const MAX_REEXPORT_SITES = 4;
/** A parsed repo file by path (cached per locate call, so a declaration is the same node wherever it is reached), or null. */
type SfOf = (p: string) => ts.SourceFile | null;
/** What a module-level lookup finds: functions (M184 / M186) or classes (M185). */
type DeclKind = "function" | "class";
/** A declaration found by a module-level lookup, with the file it is in. */
interface Found { path: string; name: string; start: number; end: number; node: ts.Node; sf: ts.SourceFile }
const hasModifier = (n: ts.Node, k: ts.SyntaxKind): boolean => (ts.canHaveModifiers(n) ? ts.getModifiers(n) ?? [] : []).some((m) => m.kind === k);
/** M185: the named top-level class declarations of a file, by name (a class expression bound to a const is not one). */
function topClasses(sf: ts.SourceFile): Map<string, ts.Node> {
  const m = new Map<string, ts.Node>();
  for (const st of sf.statements) if (ts.isClassDeclaration(st) && st.name) m.set(st.name.text, st);
  return m;
}
const topDecls = (sf: ts.SourceFile, kind: DeclKind): Map<string, ts.Node> => (kind === "function" ? topFunctions(sf) : topClasses(sf));
/** M184: does the file export its top-level declaration `name` under that same name (an export modifier or a local `export { name }`)? */
function exportsOwn(sf: ts.SourceFile, name: string, fn: ts.Node): boolean {
  let named = hasModifier(fn, ts.SyntaxKind.ExportKeyword);
  // M186: `export default function f` / `export default class C` exports the default, not the name f / C
  if (hasModifier(fn, ts.SyntaxKind.DefaultKeyword)) named = false; // m186-guard:dx-not-named
  if (named) return true;
  return sf.statements.some((st) => ts.isExportDeclaration(st) && !st.moduleSpecifier && !st.isTypeOnly && !!st.exportClause && ts.isNamedExports(st.exportClause) && st.exportClause.elements.some((e) => !e.isTypeOnly && e.name.text === name && (e.propertyName ?? e.name).text === name));
}
/**
 * M184 (repair-v2 only): the top-level declaration a module that M172 resolved (but which does not declare the imported
 * name) re-exports under `name`: `export { name } from './x'` / `export { impl as name } from './x'` (followed first, as
 * in ES, an explicit export shadows `export *`), else `export * from './x'` when exactly one star module exports the
 * name (ES leaves an ambiguous star name unexported). Relative modules only (M172's resolveImport), value exports only
 * (no `export type`), at most `hops` steps, a cycle stops. In a module reached by a step, the declaration must be
 * exported under the name (a non-exported helper of the same name is not what the barrel re-exports). M186: the name
 * "default" is the module's default export (defaultDecl), including in the module the import names; `export *` never
 * carries a default. M185: for kind "class" the module the import names is searched too (M172 handles only functions).
 */
function reExportedDecl(mod: string, name: string, kind: DeclKind, hops: number, sfOf: SfOf, seen: Set<string> = new Set(), step = 0): Found | null {
  if (seen.has(mod)) return null;
  seen.add(mod);
  const sf = sfOf(mod);
  if (!sf) return null;
  const at = (n: ts.Node): Found => ({ path: mod, name: nameOf(n) ?? name, start: n.getStart(sf), end: n.getEnd(), node: n, sf });
  if (name === "default") { const d = defaultDecl(sf, kind); if (d) return at(d); }
  const own = name === "default" ? undefined : topDecls(sf, kind).get(name);
  if (own && (step > 0 || kind === "class")) {
    if (!exportsOwn(sf, name, own)) return null; // m184-guard:rx-exported
    return at(own);
  }
  if (own) return null; // the importer's own module: M172 already handles a function it declares
  if (step >= hops) return null; // m184-guard:rx-hops
  const next = (spec: string) => resolveImport(mod, spec, (q) => sfOf(q) !== null);
  const stars: string[] = [];
  for (const st of sf.statements) {
    if (!ts.isExportDeclaration(st) || !st.moduleSpecifier || !ts.isStringLiteral(st.moduleSpecifier)) continue;
    if (st.isTypeOnly) continue; // m184-guard:rx-type-only
    if (!st.exportClause) { stars.push(st.moduleSpecifier.text); continue; }
    if (!ts.isNamedExports(st.exportClause)) continue;
    const e = st.exportClause.elements.find((x) => x.name.text === name);
    if (!e || e.isTypeOnly) continue;
    const t = next(st.moduleSpecifier.text);
    return t ? reExportedDecl(t, (e.propertyName ?? e.name).text, kind, hops, sfOf, seen, step + 1) : null; // m184-guard:rx-named-first
  }
  // M186: ES `export * from` re-exports every name except the default
  if (name === "default") return null; // m186-guard:dx-star
  const hits: Found[] = [];
  for (const spec of stars) {
    const t = next(spec);
    const r = t ? reExportedDecl(t, name, kind, hops, sfOf, new Set(seen), step + 1) : null;
    if (r) hits.push(r);
  }
  if (hits.length !== 1) return null; // m184-guard:rx-star-unique
  return hits[0]!;
}

// ---- M183 inherited members (repair-v2 only; spec: peaceai/spec/repair-v2-m183.md)

/** M183: at most this many `extends` steps are followed above the class an access starts at (M185: across files too). */
export const MAX_BASE_DEPTH = 3;
/** M185: a class declaration and the file it is in (its own `extends` and imports resolve in that file). */
interface ClassAt { node: ts.Node; path: string; sf: ts.SourceFile }
/** M183: the class a class `extends` by a plain name: a top-level class of the same file, else (M185) a class the file
 *  imports from a relative module, or undefined (`implements` is not inheritance; a mixin call or a property-access base
 *  is not resolved). */
function baseOf(c: ClassAt, sfOf: SfOf, allowed: (p: string) => boolean): ClassAt | undefined {
  if (!ts.isClassLike(c.node)) return undefined;
  for (const h of c.node.heritageClauses ?? []) {
    if (h.token !== ts.SyntaxKind.ExtendsKeyword) continue; // m183-guard:ih-extends
    const e = h.types[0]?.expression;
    if (!e || !ts.isIdentifier(e)) return undefined;
    const local = topClasses(c.sf).get(e.text);
    return local ? { node: local, path: c.path, sf: c.sf } : importedClass(c, e.text, sfOf, allowed);
  }
  return undefined;
}
/**
 * M183 (repair-v2 only): the class whose own declaration an access `x.name` starting at class `from` reaches: `from`
 * itself when it declares `name` with the access's static-ness, else the nearest ancestor that does, at most
 * MAX_BASE_DEPTH `extends` steps up. The nearest declaration wins even when it is not followable code (a data field or
 * an abstract member shadows the base's method; M182's mc-kind / mc-body then refuse it). A private `#name` is lexically
 * scoped to the class that declares it and is never looked up in a base. A cyclic chain (broken code) stops at the
 * first repeated class.
 */
function ownerOf(from: ClassAt, name: string, wantStatic: boolean, sfOf: SfOf, allowed: (p: string) => boolean): ClassAt | undefined {
  const seen = new Set<ts.Node>();
  let c: ClassAt | undefined = from;
  for (let up = 0; c && !seen.has(c.node); up++) {
    seen.add(c.node);
    const declares = membersOf(c.node).some((m) => nameOf(m) === name && isStaticMember(m) === wantStatic);
    if (declares) return c; // m183-guard:ih-nearest
    if (name.startsWith("#")) return undefined; // m183-guard:ih-private
    if (up >= MAX_BASE_DEPTH) return undefined; // m183-guard:ih-depth
    c = baseOf(c, sfOf, allowed);
  }
  return undefined;
}

// ---- M185 imported base classes (repair-v2 only; spec: peaceai/spec/repair-v2-m185.md)

/**
 * M185 (repair-v2 only): the class a file's `extends <local>` names through a value import from a relative module (a
 * named import, `{ X as local }`, or M186's default import), resolved by M172's resolveImport and M184's re-export walk
 * (named before star, ambiguous star dropped, type-only skipped, MAX_REEXPORT_HOPS, cycle stop): the module must
 * export a class declaration under the imported name (or as its default). The declaring file must pass the same test /
 * generated filters as any site. The base is then an ordinary link of M183's chain: its own `extends` resolves in its
 * own file, and the steps count toward MAX_BASE_DEPTH.
 */
function importedClass(c: ClassAt, local: string, sfOf: SfOf, allowed: (p: string) => boolean): ClassAt | undefined {
  const im = relativeImports(c.sf).get(local);
  if (!im) return undefined;
  const target = resolveImport(c.path, im.spec, (q) => sfOf(q) !== null);
  const r = target ? reExportedDecl(target, im.name, "class", MAX_REEXPORT_HOPS, sfOf) : null;
  if (!r) return undefined;
  if (!allowed(r.path)) return undefined; // m185-guard:xb-allowed
  return { node: r.node, path: r.path, sf: r.sf };
}

// ---- M186 default exports (repair-v2 only; spec: peaceai/spec/repair-v2-m186.md)

/**
 * M186 (repair-v2 only): the module's own default export of the given kind, or null. A default is claimed by
 * `export default function [f]` / `export default class [C]`, by `export default f` naming a top-level declaration of
 * the module (or, for a function, an inline arrow / function expression), or by a local `export { f as default }`.
 * Exactly one claim must exist (two are broken code; neither is followed); a claim of another kind or of something that
 * is not a top-level declaration (an object, a call, an imported binding) yields null. `export =` (CommonJS interop,
 * whose meaning depends on compiler flags the syntactic resolver cannot see) and type-only export lists are not claims.
 */
function defaultDecl(sf: ts.SourceFile, kind: DeclKind): ts.Node | null {
  const tops = topDecls(sf, kind);
  const claims: (ts.Node | null)[] = [];
  for (const st of sf.statements) {
    if ((ts.isFunctionDeclaration(st) || ts.isClassDeclaration(st)) && hasModifier(st, ts.SyntaxKind.DefaultKeyword)) claims.push(ts.isFunctionDeclaration(st) === (kind === "function") ? st : null);
    else if (ts.isExportAssignment(st)) {
      if (st.isExportEquals) continue; // m186-guard:dx-equals
      const e = st.expression;
      claims.push(ts.isIdentifier(e) ? tops.get(e.text) ?? null : kind === "function" && (ts.isArrowFunction(e) || ts.isFunctionExpression(e)) ? st : null);
    } else if (ts.isExportDeclaration(st) && !st.moduleSpecifier && st.exportClause && ts.isNamedExports(st.exportClause)) {
      if (st.isTypeOnly) continue; // m186-guard:dx-type-only
      for (const x of st.exportClause.elements) if (x.name.text === "default" && !x.isTypeOnly) claims.push(tops.get((x.propertyName ?? x.name).text) ?? null);
    }
  }
  if (claims.length !== 1) return null; // m186-guard:dx-unique
  return claims[0]!;
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

const srcOf = (sf: ts.SourceFile, n: ts.Node): string => sf.text.slice(n.getStart(sf), n.getEnd());

/** A call that already asks whether a property is the object's own. */
function isOwnProbe(expr: ts.Node): boolean {
  if (ts.isPropertyAccessExpression(expr) && expr.name.text === "hasOwnProperty") return true; // cap-guard:own-hasown
  if (ts.isPropertyAccessExpression(expr) && expr.name.text === "hasOwn" && ts.isIdentifier(expr.expression) && expr.expression.text === "Object") return true; // cap-guard:own-object-hasown
  if (ts.isPropertyAccessExpression(expr) && expr.name.text === "call") {
    const recv = expr.expression;
    if (!ts.isPropertyAccessExpression(recv) || recv.name.text !== "hasOwnProperty") return false;
    const proto = recv.expression;
    return ts.isPropertyAccessExpression(proto) && ts.isIdentifier(proto.expression) && proto.expression.text === "Object" && proto.name.text === "prototype"; // cap-guard:own-proto-call
  }
  return false;
}

/** True when the loop body already skips inherited names. A nested function does not count. */
function ownPropertyGuard(stmt: ts.Node): boolean {
  let found = false;
  const walk = (node: ts.Node, top: boolean): void => {
    if (found) return;
    if (!top && (ts.isFunctionLike(node) || ts.isClassLike(node))) return; // cap-guard:own-nested
    if (ts.isCallExpression(node) && isOwnProbe(node.expression)) found = true;
    else ts.forEachChild(node, (child) => walk(child, false));
  };
  walk(stmt, true);
  return found;
}

/**
 * own-keys: `for (k in obj)` also visits enumerable names inherited from the prototype.
 * Insert an own-property guard. The loop variable and the body stay. A loop that already
 * calls `hasOwnProperty`, `Object.hasOwn`, or `Object.prototype.hasOwnProperty.call` is left alone.
 */
function ownKeys(n: ts.Node, sf: ts.SourceFile): string | null {
  if (!ts.isForInStatement(n)) return null; // cap-guard:own-forin
  let binding = "";
  let key = "";
  if (ts.isVariableDeclarationList(n.initializer)) {
    if (n.initializer.declarations.length !== 1) return null; // cap-guard:own-decl
    const decl = n.initializer.declarations[0]!;
    if (!ts.isIdentifier(decl.name) || decl.initializer) return null; // cap-guard:own-name
    const flags = n.initializer.flags;
    const keyword = flags & ts.NodeFlags.Const ? "const" : flags & ts.NodeFlags.Let ? "let" : "var";
    key = decl.name.text;
    binding = `${keyword} ${key}`;
  } else if (ts.isIdentifier(n.initializer)) {
    key = n.initializer.text;
    binding = key;
  } else return null;
  if (!plainRef(n.expression)) return null; // cap-guard:own-ref
  if (ownPropertyGuard(n.statement)) return null; // cap-guard:own-guarded
  const obj = srcOf(sf, n.expression);
  const guard = `if (!Object.hasOwn(${obj}, ${key})) continue;`;
  const stmt = n.statement;
  const body = ts.isBlock(stmt) ? `{ ${guard}${srcOf(sf, stmt).slice(1)}` : `{ ${guard} ${srcOf(sf, stmt)} }`;
  return `for (${binding} in ${obj}) ${body}`;
}

/**
 * enum-values: `Object.values(table).includes(member)` on a numeric enum also accepts the reverse-mapped
 * member name (`0` stores `"Draft"` and `"Draft"` stores `0`). Drop a string only when it round-trips
 * through a numeric property. Numbers and string-enum values stay.
 */
function enumValues(n: ts.Node, sf: ts.SourceFile): string | null {
  if (!ts.isCallExpression(n) || n.arguments.length !== 1 || n.questionDotToken) return null; // cap-guard:enum-argc
  const callee = n.expression;
  if (!ts.isPropertyAccessExpression(callee) || callee.name.text !== "includes" || callee.questionDotToken) return null; // cap-guard:enum-includes
  const values = callee.expression;
  if (!ts.isCallExpression(values) || values.arguments.length !== 1 || values.questionDotToken) return null; // cap-guard:enum-values-call
  const head = values.expression;
  if (!ts.isPropertyAccessExpression(head) || head.questionDotToken || !ts.isIdentifier(head.expression) || head.expression.text !== "Object" || head.name.text !== "values") return null; // cap-guard:enum-object-values
  const bare = (e: ts.Node): ts.Node => {
    let cur = e;
    while (ts.isAsExpression(cur) || ts.isTypeAssertionExpression(cur) || ts.isParenthesizedExpression(cur) || ts.isSatisfiesExpression(cur)) cur = cur.expression;
    return cur;
  };
  const target = bare(values.arguments[0]!);
  const item = bare(n.arguments[0]!);
  if (!plainRef(target) || !plainRef(item)) return null; // cap-guard:enum-ref
  const e = srcOf(sf, target);
  const v = srcOf(sf, item);
  const box = `(${e} as Record<PropertyKey, unknown>)`;
  return `Object.values(${e}).filter((member) => typeof member !== "string" || typeof ${box}[member] !== "number" || ${box}[${box}[member] as PropertyKey] !== member).includes(${v})`;
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
    add(ownKeys(n, sf), "own-keys");
    add(enumValues(n, sf), "enum-values");
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

// ---- M176 SStuB templates (repair-v2 only; spec: peaceai/spec/repair-v2-m176.md)

/** A side-effect-free operand: a plain reference (identifier, `this`, non-optional property chain) or a literal. Two
 *  such operands can trade places without changing what is evaluated, only where each value goes. */
export function simpleOperand(e: ts.Node): boolean {
  if (plainRef(e)) return true;
  return ts.isNumericLiteral(e) || ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e) || e.kind === ts.SyntaxKind.TrueKeyword || e.kind === ts.SyntaxKind.FalseKeyword || e.kind === ts.SyntaxKind.NullKeyword;
}
/** Operators whose operands may not trade places (a - b is not b - a); + and * (also string +), ==, && etc. are left out. */
export const NON_COMMUTATIVE: ReadonlySet<ts.SyntaxKind> = new Set([
  ts.SyntaxKind.MinusToken, ts.SyntaxKind.SlashToken, ts.SyntaxKind.PercentToken, ts.SyntaxKind.AsteriskAsteriskToken,
  ts.SyntaxKind.LessThanToken, ts.SyntaxKind.LessThanEqualsToken, ts.SyntaxKind.GreaterThanToken, ts.SyntaxKind.GreaterThanEqualsToken,
]);
/** A function's own value bindings: identifier parameters, and identifier declarators of variable statements directly in
 *  its block body, each with the offset from which a read may use it (a parameter: the body start; a local: the end of
 *  its declaration statement, so never its own initializer and never before it is declared). */
function ownBindings(fn: FnLike, sf: ts.SourceFile): Map<string, number> {
  const out = new Map<string, number>();
  const body = fn.body!;
  for (const p of fn.parameters) if (ts.isIdentifier(p.name)) out.set(p.name.text, body.getStart(sf));
  if (ts.isBlock(body)) for (const st of body.statements) {
    if (!ts.isVariableStatement(st)) continue;
    for (const d of st.declarationList.declarations) if (ts.isIdentifier(d.name) && !out.has(d.name.text)) out.set(d.name.text, st.getEnd());
  }
  return out;
}
/** change-identifier: every read of one of `fn`'s own bindings, inside `fn` but not inside a nested function, gets each
 *  other own binding usable there. Returns [start, end, replacement]. */
function changeIdentifier(fn: FnLike, sf: ts.SourceFile): [number, number, string][] {
  const out: [number, number, string][] = [];
  if (!fn.body) return out;
  const own = ownBindings(fn, sf);
  if (own.size < 2) return out;
  const walk = (n: ts.Node) => {
    // a nested function's names are its own; its own visit handles it
    if (n !== fn.body && isFn(n)) return; // m176-guard:ci-inner
    if (ts.isIdentifier(n) && own.has(n.text) && n.parent) {
      const p = n.parent;
      let read = true;
      // a declared or property name is not a read; this also covers a shorthand property ({ a } -> { b } would rename the key)
      if ((p as { name?: ts.Node }).name === n) read = false; // m176-guard:ci-decl
      if (ts.isBinaryExpression(p) && p.left === n && p.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && p.operatorToken.kind <= ts.SyntaxKind.LastAssignment) read = false; // m176-guard:ci-write
      if ((ts.isPrefixUnaryExpression(p) || ts.isPostfixUnaryExpression(p)) && (p.operator === ts.SyntaxKind.PlusPlusToken || p.operator === ts.SyntaxKind.MinusMinusToken)) read = false; // m176-guard:ci-incdec
      if ((ts.isCallExpression(p) || ts.isNewExpression(p)) && p.expression === n) read = false; // m176-guard:ci-callee
      // a name in a type is erased: no runtime change
      if (ts.isTypeQueryNode(p) || ts.isTypeReferenceNode(p)) read = false; // m176-guard:ci-type
      if (read) for (const [b, from] of own) {
        if (b === n.text) continue;
        if (from > n.getStart(sf)) continue; // m176-guard:ci-before
        out.push([n.getStart(sf), n.getEnd(), b]);
      }
    }
    ts.forEachChild(n, walk);
  };
  walk(fn.body);
  return out;
}
/** swap-operands applies: a non-commutative operator between two side-effect-free operands. */
function swappableOperands(n: ts.BinaryExpression): boolean {
  if (!NON_COMMUTATIVE.has(n.operatorToken.kind)) return false; // m176-guard:so-op
  if (!simpleOperand(n.left) || !simpleOperand(n.right)) return false; // m176-guard:so-simple
  return true;
}
/** M176: every SStuB candidate inside one site (no I/O); repair-v2 only. Each only moves or swaps text already in the
 *  site: no new word, no new statement, no new write target (the loop's M175 gate re-checks every candidate). */
export function sstubMutationsIn(sf: ts.SourceFile, site: Site, siteIndex: number): Mutation[] {
  const out: Mutation[] = [];
  const text = sf.text;
  const src = (x: ts.Node) => text.slice(x.getStart(sf), x.getEnd());
  const add = (start: number, end: number, rep: string, template: (typeof SSTUB_TEMPLATES)[number]) => out.push({ path: site.path, start, end, text: rep, template, site: siteIndex });
  /** a and b (a before b) trade places; whatever lies between them (commas, operator, whitespace) stays. */
  const swap = (a: ts.Node, b: ts.Node, template: (typeof SSTUB_TEMPLATES)[number]) => add(a.getStart(sf), b.getEnd(), src(b) + text.slice(a.getEnd(), b.getStart(sf)) + src(a), template);
  const visit = (n: ts.Node) => {
    if (n.getStart(sf) < site.start || n.getEnd() > site.end) { ts.forEachChild(n, visit); return; }
    // swap-statements: two adjacent expression statements of a block, both ending in `;` (no ASI change)
    if (ts.isBlock(n)) for (let i = 0; i + 1 < n.statements.length; i++) {
      const a = n.statements[i]!, b = n.statements[i + 1]!;
      if (!ts.isExpressionStatement(a) || !ts.isExpressionStatement(b)) continue; // m176-guard:ss-expr
      if (!src(a).endsWith(";") || !src(b).endsWith(";")) continue; // m176-guard:ss-semi
      swap(a, b, "swap-statements");
    }
    // swap-args: two adjacent side-effect-free arguments of a call or `new`
    if ((ts.isCallExpression(n) || ts.isNewExpression(n)) && n.arguments) for (let i = 0; i + 1 < n.arguments.length; i++) {
      const a = n.arguments[i]!, b = n.arguments[i + 1]!;
      if (!simpleOperand(a) || !simpleOperand(b)) continue; // m176-guard:sa-simple
      swap(a, b, "swap-args");
    }
    // swap-operands: the side-effect-free operands of a non-commutative operator
    if (ts.isBinaryExpression(n) && swappableOperands(n)) swap(n.left, n.right, "swap-operands");
    // change-identifier: a read of one of the function's own bindings -> another one usable there
    if (isFn(n) && n.body) for (const [s, e, b] of changeIdentifier(n, sf)) add(s, e, b, "change-identifier");
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

// ---- M177 statement-level templates (repair-v2 only; spec: peaceai/spec/repair-v2-m177.md)

/** Globals a copied guard may read without a binding in the file (values and error classes; read only, never written:
 *  the loop's M175 gate refuses a new write to an undeclared root and every dangerous word anyway). */
export const GUARD_GLOBALS: ReadonlySet<string> = new Set(["undefined", "NaN", "Infinity", "Math", "Number", "String", "Array", "Error", "TypeError", "RangeError", "isNaN", "isFinite"]);
/** At most this many copy-guard candidates per site. */
export const MAX_COPY_GUARDS = 6;
const exitStatement = (st: ts.Statement): boolean => ts.isReturnStatement(st) || ts.isThrowStatement(st);
/** A guard: `if (cond) return ...;` / `if (cond) throw ...;` (or the same inside a one-statement block), with no else. */
export function guardShape(st: ts.Statement): boolean {
  if (!ts.isIfStatement(st) || st.elseStatement) return false;
  const t = st.thenStatement;
  return exitStatement(t) || (ts.isBlock(t) && t.statements.length === 1 && exitStatement(t.statements[0]!));
}
/** The names a node reads (identifier references; not property names, object keys or names inside a type), or null when
 *  it uses `this`, `super`, `arguments`, `await`, `yield`, a function or a class (what they mean depends on where they are). */
export function readNames(n: ts.Node): Set<string> | null {
  const out = new Set<string>();
  let bad = false;
  const walk = (x: ts.Node) => {
    if (bad) return;
    if (x.kind === ts.SyntaxKind.ThisKeyword || x.kind === ts.SyntaxKind.SuperKeyword || ts.isAwaitExpression(x) || ts.isYieldExpression(x) || isFn(x) || ts.isClassLike(x)) { bad = true; return; }
    if (ts.isTypeNode(x)) return; // erased
    if (ts.isIdentifier(x)) {
      const p = x.parent;
      if (x.text === "arguments") { bad = true; return; }
      if (p && ts.isPropertyAccessExpression(p) && p.name === x) return;
      if (p && (ts.isPropertyAssignment(p) || ts.isPropertySignature(p)) && p.name === x) return;
      out.add(x.text);
      return;
    }
    ts.forEachChild(x, walk);
  };
  walk(n);
  return bad ? null : out;
}
const bindingNames = (b: ts.BindingName, out: Set<string>): void => { if (ts.isIdentifier(b)) out.add(b.text); else for (const e of b.elements) if (!ts.isOmittedExpression(e)) bindingNames(e.name, out); };
/** Every name declared anywhere inside a node (variables, parameters, binding patterns, functions, classes, enums), nested
 *  functions included (conservative: a copy is refused when any of them could shadow what the guard reads). */
function declaredIn(n: ts.Node): Set<string> {
  const out = new Set<string>();
  const walk = (x: ts.Node) => {
    if (ts.isVariableDeclaration(x) || ts.isParameter(x)) bindingNames(x.name, out);
    if ((ts.isFunctionDeclaration(x) || ts.isClassDeclaration(x) || ts.isEnumDeclaration(x)) && x.name) out.add(x.name.text);
    ts.forEachChild(x, walk);
  };
  walk(n);
  return out;
}
/** The module-scope names of a file: its top-level declarations and imports. */
function moduleNames(sf: ts.SourceFile): Set<string> {
  const out = new Set<string>();
  for (const st of sf.statements) {
    if (ts.isImportDeclaration(st) && st.importClause) {
      const c = st.importClause;
      if (c.name) out.add(c.name.text);
      if (c.namedBindings && ts.isNamespaceImport(c.namedBindings)) out.add(c.namedBindings.name.text);
      if (c.namedBindings && ts.isNamedImports(c.namedBindings)) for (const e of c.namedBindings.elements) out.add(e.name.text);
    } else if (ts.isVariableStatement(st)) { for (const d of st.declarationList.declarations) bindingNames(d.name, out); }
    else if ((ts.isFunctionDeclaration(st) || ts.isClassDeclaration(st) || ts.isEnumDeclaration(st)) && st.name) out.add(st.name.text);
  }
  return out;
}
/** A statement whose end cannot join the next statement under automatic semicolon insertion: it ends in `;`, or it is
 *  (or ends in) a block. */
function closedStatement(st: ts.Statement, sf: ts.SourceFile): boolean {
  if (sf.text.slice(st.getStart(sf), st.getEnd()).endsWith(";")) return true;
  if (ts.isBlock(st) || ts.isFunctionDeclaration(st) || ts.isClassDeclaration(st) || ts.isTryStatement(st) || ts.isSwitchStatement(st)) return true;
  if (ts.isIfStatement(st)) return closedStatement(st.elseStatement ?? st.thenStatement, sf);
  if (ts.isForStatement(st) || ts.isForOfStatement(st) || ts.isForInStatement(st) || ts.isWhileStatement(st)) return closedStatement(st.statement, sf);
  return false;
}
/** copy-guard sources: every guard that is a direct statement of a function's block body in the file, with what it reads. */
function guardIngredients(sf: ts.SourceFile): { st: ts.IfStatement; fn: FnLike; reads: Set<string> }[] {
  const out: { st: ts.IfStatement; fn: FnLike; reads: Set<string> }[] = [];
  const visit = (n: ts.Node) => {
    if (isFn(n) && n.body && ts.isBlock(n.body)) for (const st of n.body.statements) {
      if (!guardShape(st)) continue; // m177-guard:cg-shape
      const reads = readNames(st);
      if (!reads) continue; // m177-guard:cg-ctx
      out.push({ st: st as ts.IfStatement, fn: n, reads: reads ?? new Set<string>() }); // (the empty set never reaches a copy: cg-ctx alone bars it)
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}
/** M177: every statement-level candidate inside one site (no I/O); repair-v2 only. A copy writes a statement that is
 *  already in the file; a delete removes one. No new word, no new top-level statement (the M175 gate re-checks each). */
export function stmtMutationsIn(sf: ts.SourceFile, site: Site, siteIndex: number): Mutation[] {
  const out: Mutation[] = [];
  const text = sf.text;
  const src = (x: ts.Node) => text.slice(x.getStart(sf), x.getEnd());
  const add = (start: number, end: number, rep: string, template: (typeof STMT_TEMPLATES)[number]) => out.push({ path: site.path, start, end, text: rep, template, site: siteIndex });
  const inSite = (x: ts.Node) => x.getStart(sf) >= site.start && x.getEnd() <= site.end;
  const ingredients = guardIngredients(sf);
  const modNames = moduleNames(sf);
  let copies = 0;
  const visit = (n: ts.Node) => {
    if (!inSite(n)) { ts.forEachChild(n, visit); return; }
    // copy-guard: a guard of another function, as the first statement of this function's block body
    if (isFn(n) && n.body && ts.isBlock(n.body)) {
      const fn = n, body = n.body;
      let kindOk = true;
      if (ts.isConstructorDeclaration(fn) || ts.isSetAccessorDeclaration(fn) || (fn as { asteriskToken?: ts.Node }).asteriskToken) kindOk = false; // m177-guard:cg-target-kind
      const params = new Set<string>();
      for (const p of fn.parameters) bindingNames(p.name, params);
      const inner = declaredIn(body);
      const have = new Set(body.statements.map((st) => src(st)));
      const first = body.statements[0];
      const indent = first ? (/[ \t]*$/.exec(text.slice(text.lastIndexOf("\n", first.getStart(sf) - 1) + 1, first.getStart(sf)))?.[0] ?? "") : "";
      if (kindOk) for (const g of ingredients) {
        // (a function's own guard is never copied to its top: it is a direct statement of the same body, so cg-dup bars it)
        const gt = src(g.st);
        if (have.has(gt)) continue; // m177-guard:cg-dup
        if (![...g.reads].every((r) => params.has(r) || modNames.has(r) || GUARD_GLOBALS.has(r))) continue; // m177-guard:cg-bound
        if ([...g.reads].some((r) => inner.has(r))) continue; // m177-guard:cg-shadow
        if (copies >= MAX_COPY_GUARDS) break; // m177-guard:cg-cap
        copies++;
        have.add(gt); // two functions with the same guard give one copy
        const at = body.getStart(sf) + 1;
        add(at, at, first ? `\n${indent}${gt}` : ` ${gt} `, "copy-guard");
      }
    }
    // delete-statement: one expression statement or else-less if of a block, never the only one, never a declaration
    if (ts.isBlock(n)) n.statements.forEach((st, i) => {
      if (n.statements.length < 2) return; // m177-guard:ds-only
      if (!ts.isExpressionStatement(st) && !ts.isIfStatement(st)) return; // m177-guard:ds-kind
      if (ts.isIfStatement(st) && st.elseStatement) return; // m177-guard:ds-no-else
      // the deleted statement itself never joins anything; its predecessor could join its successor
      const prev = n.statements[i - 1];
      if (prev && !closedStatement(prev, sf)) return; // m177-guard:ds-asi
      add(st.getStart(sf), st.getEnd(), "", "delete-statement");
    });
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

const parses = (path: string, text: string): boolean => ((parseSource(path, text) as unknown as { parseDiagnostics?: unknown[] }).parseDiagnostics ?? [1]).length === 0;
const applyAll = (text: string, ms: readonly Mutation[]): string => [...ms].sort((a, b) => b.start - a.start).reduce((t, x) => t.slice(0, x.start) + x.text + t.slice(x.end), text);
const overlaps = (a: Mutation, b: Mutation) => a.path === b.path && a.start < b.end && b.start < a.end || (a.path === b.path && a.start === b.start);

export interface Candidate { key: string; muts: Mutation[]; edits: RepairEdit[]; anchored?: boolean }

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
export function repairCandidates(sites: readonly Site[], files: ReadonlyMap<string, string>, seen: Set<string> = new Set(), v2 = false, skip: ReadonlySet<number> = new Set()): Candidate[] {
  const all: Mutation[] = [];
  const exported = new Map<string, Set<string>>();
  sites.forEach((site, i) => {
    // M178: a demoted site is skipped; site numbers stay the located ones
    if (skip.has(i)) return; // m178-guard:rb-skip
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
    if (v2) all.push(...sstubMutationsIn(sf, site, i)); // m176-guard:sstub-v2-only
    if (v2) all.push(...stmtMutationsIn(sf, site, i)); // m177-guard:stmt-v2-only
  });
  const order: readonly Template[] = v2 ? TEMPLATES_V2 : TEMPLATES;
  const rank = (x: Mutation) => order.indexOf(x.template);
  all.sort((a, b) => rank(a) - rank(b) || a.site - b.site || a.start - b.start || a.end - b.end || (a.text < b.text ? -1 : a.text > b.text ? 1 : 0));
  const queue: Candidate[] = [];
  if (v2) return reachReserved(all, sites, files, seen); // m189-guard:v2-only
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

/** M189: the first site tier reached through the code rather than named by the request (M182 class members, M184 /
 *  M186 barrel and default re-exports). */
export const REACH_TIER = 4;
/** M189: candidate slots kept for reach sites (tier >= REACH_TIER) when the located sites alone would fill the cap. */
export const REACH_RESERVED = 12;
/**
 * M189 (repair-v2 only; repair-v1 and model-v1's scoring list are unchanged): the same fixed-order walk as above, but the
 * cap no longer lets the located sites' many template mutations push every reach-site candidate out (Auditor note,
 * batch 22). Candidates are collected per side (located: tier < REACH_TIER; reach: the rest), up to MAX_CANDIDATES
 * each; the reach side keeps what fits after the located side, and at least REACH_RESERVED; the located side keeps the
 * rest. The kept candidates stay in the walk's order. When the cap does not bind, or there is no reach site, the list
 * is exactly the plain walk's.
 */
function reachReserved(all: readonly Mutation[], sites: readonly Site[], files: ReadonlyMap<string, string>, seen: Set<string>): Candidate[] {
  const low: { c: Candidate; i: number }[] = [], high: { c: Candidate; i: number }[] = [];
  const local = new Set<string>();
  for (let i = 0; i < all.length; i++) {
    if (low.length >= MAX_CANDIDATES && high.length >= MAX_CANDIDATES) break;
    const x = all[i]!;
    const side = (sites[x.site]?.tier ?? 0) >= REACH_TIER ? high : low;
    if (side.length >= MAX_CANDIDATES) continue;
    const c = candidateFor(files, [x]);
    if (!c || seen.has(c.key) || local.has(c.key)) continue;
    local.add(c.key);
    side.push({ c, i });
  }
  let nHigh = Math.min(high.length, Math.max(0, MAX_CANDIDATES - low.length));
  nHigh = Math.max(nHigh, Math.min(high.length, REACH_RESERVED)); // m189-guard:reserve
  const nLow = Math.min(low.length, MAX_CANDIDATES - nHigh);
  const kept = [...low.slice(0, nLow), ...high.slice(0, nHigh)];
  kept.sort((a, b) => a.i - b.i); // m189-guard:order
  for (const k of kept) seen.add(k.c.key);
  // One idiom often has to land in every function the test names. A single edit leaves the other failing.
  const bundled = idiomBundles(all, files, seen);
  const list = [...bundled, ...kept.map((k) => k.c)];
  if (list.length > MAX_CANDIDATES) list.length = MAX_CANDIDATES; // cap-guard:bundle-cap
  return list;
}

const BUNDLE_IDIOMS = new Set<string>(["own-keys", "enum-values"]);

/** Every non-overlapping hit of one new idiom, as one candidate. Two to four hits. */
function idiomBundles(all: readonly Mutation[], files: ReadonlyMap<string, string>, seen: Set<string>): Candidate[] {
  const out: Candidate[] = [];
  for (const template of BUNDLE_IDIOMS) {
    const group = all.filter((m) => m.template === template);
    if (group.length < 2 || group.length > 4) continue; // cap-guard:bundle-size
    const disjoint: Mutation[] = [];
    for (const m of group) {
      if (disjoint.some((d) => overlaps(d, m))) continue; // cap-guard:bundle-overlap
      disjoint.push(m);
    }
    if (disjoint.length < 2) continue;
    const c = candidateFor(files, disjoint);
    if (!c || seen.has(c.key)) continue; // cap-guard:bundle-new
    seen.add(c.key);
    out.push(c);
  }
  return out;
}

// ---- M174: load-repair candidates (repair-v2 only)

export const MAX_LOAD_CANDIDATES = 1;
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
/**
 * The load-repair candidate for the loop's MISSING_EXPORT diagnostics: one edit that fixes every missing name at once,
 * each by load-export (the keyword `export ` inserted before the module's one plain declaration of the name). None when
 * any name has no such declaration (a suite missing one name still does not load). Nothing is ever invented: every
 * site is a single inserted keyword token in a source file (Auditor's single-token scope; M174 dropped load-reexport,
 * a new statement, as outside it). The loop checks the same shape again before any run (loop.ts loadEditProblem).
 */
export function loadCandidates(diags: readonly LoadDiag[], files: ReadonlyMap<string, string>): Candidate[] {
  const wanted = new Map<string, { module: string; name: string }>();
  for (const d of diags) if (d.kind === "MISSING_EXPORT") wanted.set(`${d.module}\0${d.name}`, d); // m174-guard:lc-export-only
  if (wanted.size === 0) return [];
  const muts: Mutation[] = [];
  for (const w of wanted.values()) {
    const text = files.get(w.module);
    const at = text === undefined ? null : loadExportAt(parseSource(w.module, text), w.name);
    if (at === null) return []; // m174-guard:lc-all-fixed
    muts.push({ path: w.module, start: at, end: at, text: "export ", template: "load-export", site: 0 });
  }
  const c = candidateFor(files, muts);
  return c ? [c].slice(0, MAX_LOAD_CANDIDATES) : [];
}

// ---- M178 inert-site demotion (repair-v2 only; spec: peaceai/spec/repair-v2-m178.md)

/** M178: how many INERT results (and no live one) a site needs before its remaining candidates are demoted. */
export const INERT_AFTER = 2;
export type SiteEvidence = "inert" | "live";
const sameNames = (a: readonly string[], b: readonly string[]): boolean => { const x = [...a].sort(), y = [...b].sort(); return x.length === y.length && x.every((v, i) => v === y[i]); };
/**
 * M178: what one attempt's result says about the code its edit changed (mutation-based fault localization): INERT when
 * it ran cleanly (no code but TEST_FAIL) with exactly the baseline's counts and failing test names (the tests did not
 * notice the edit), LIVE when it ran cleanly and the counts or names differ (the tests execute that code), null when
 * it proves neither (no baseline, no counts, or another code: a timeout, a load failure, a refusal...). Only counts and
 * test names are read, never a message.
 */
export function siteEvidence(fb: RepairFeedback | undefined, baseline: RepairInput["baseline"], baseFailing: readonly string[]): SiteEvidence | null {
  if (!baseline) return null; // m178-guard:ev-baseline
  if (!fb?.tests) return null; // m178-guard:ev-tests
  if (fb?.codes.some((c) => c !== "TEST_FAIL")) return null; // m178-guard:ev-clean
  if (fb?.tests?.total !== baseline?.total || fb?.tests?.passedByPeaceAI !== baseline?.passing) return "live"; // m178-guard:ev-counts
  if (!sameNames(fb?.failing ?? [], baseFailing)) return "live"; // m178-guard:ev-names
  return "inert";
}
/**
 * M178: the located sites (by number) to demote now: a site with at least INERT_AFTER inert results and no live one,
 * not demoted already, and only while some other site has a live result (so a suite that notices nothing reorders
 * nothing). Evidence comes only from single-site candidates; a combined one says nothing about which site mattered.
 * tried[i] is attempt i + 1.
 */
export function siteDemotions(tried: readonly Candidate[], feedback: readonly RepairFeedback[], baseline: RepairInput["baseline"], baseFailing: readonly string[], already: ReadonlySet<number>): number[] {
  const ev = new Map<number, { inert: number; live: number }>();
  tried.forEach((c, i) => {
    const e = siteEvidence(feedback.find((f) => f.attempt === i + 1), baseline, baseFailing);
    if (e === null) return;
    // M179: a composed candidate's counts are relative to its anchor, not to the original code
    if (c.anchored) return; // m179-guard:an-no-evidence
    const at = [...new Set(c.muts.map((m) => m.site))];
    if (at.length !== 1) return; // m178-guard:ev-single
    for (const s of at) { const x = ev.get(s) ?? { inert: 0, live: 0 }; x[e]++; ev.set(s, x); }
  });
  if (![...ev.values()].some((x) => x.live > 0)) return []; // m178-guard:dm-live-elsewhere
  const out: number[] = [];
  for (const [s, x] of [...ev].sort((a, b) => a[0] - b[0])) {
    if (already.has(s)) continue; // m178-guard:dm-once
    if (x.inert < INERT_AFTER) continue; // m178-guard:dm-threshold
    if (x.live > 0) continue; // m178-guard:dm-no-live
    out.push(s);
  }
  return out;
}

// ---- M191 fail-to-pass promotion (repair-v2 only; spec: peaceai/spec/repair-v2-m191.md)

const countNames = (xs: readonly string[]): Map<string, number> => { const m = new Map<string, number>(); for (const x of xs) m.set(x, (m.get(x) ?? 0) + 1); return m; };
/**
 * M191: whether one attempt made a baseline-failing test pass (Metallaxis / MUSE-style mutation-based fault
 * localization: a change that flips a failing test is at the fault): a result with no code but TEST_FAIL, the
 * baseline's total, failing names known on both sides (one name per failing test: node:test always, vitest / jest when
 * M190 could read them), and some baseline-failing name failing fewer times than at the baseline. Only counts and
 * names are read, never a message; a broken passing test does not cancel it (the edit was at the right code, the
 * wrong way).
 */
export function fixEvidence(fb: RepairFeedback | undefined, baseline: RepairInput["baseline"], baseFailing: readonly string[]): boolean {
  if (fb?.codes.some((c) => c !== "TEST_FAIL")) return false; // m191-guard:fx-clean
  if (fb?.tests?.total !== baseline?.total) return false; // m191-guard:fx-total (no counts, or no baseline: undefined is not a total)
  if (baseFailing.length !== baseline?.failing) return false; // m191-guard:fx-base-known
  if ((fb?.failing ?? []).length !== (fb?.tests?.total ?? 0) - (fb?.tests?.passedByPeaceAI ?? 0)) return false; // m191-guard:fx-known
  const now = countNames(fb?.failing ?? []);
  return [...countNames(baseFailing)].some(([n, k]) => (now.get(n) ?? 0) < k);
}
/** M191: the located sites (by number) to promote now: a single-site candidate's result is fix evidence, the site not
 *  promoted already. tried[i] is attempt i + 1. */
export function fixSites(tried: readonly Candidate[], feedback: readonly RepairFeedback[], baseline: RepairInput["baseline"], baseFailing: readonly string[], already: ReadonlySet<number>): number[] {
  const out = new Set<number>();
  tried.forEach((c, i) => {
    if (!fixEvidence(feedback.find((f) => f.attempt === i + 1), baseline, baseFailing)) return;
    const at = [...new Set(c.muts.map((m) => m.site))];
    if (at.length !== 1) return; // m191-guard:fs-single (a combined edit says nothing about which site mattered)
    if (already.has(at[0]!)) return; // m191-guard:fs-once
    out.add(at[0]!);
  });
  return [...out].sort((a, b) => a - b);
}

// ---- M179 anchored continuation (repair-v2 only; spec: peaceai/spec/repair-v2-m179.md)

/** M179: the most mutations an anchored (composed) candidate may carry. */
export const MAX_ANCHOR_MUTS = 3;
/**
 * M179: the anchor, the tried candidate that is the best clean partial fix so far, or null: a result with no code but
 * TEST_FAIL, the baseline's total, and a passing count above the baseline's and above every earlier anchor's (ties keep
 * the earliest), carrying fewer than MAX_ANCHOR_MUTS mutations (room for one more), whose failing test names are all
 * among the baseline's (no previously passing test broken; as M178's ev-names). The same counts and names the loop
 * already gives; never a message. tried[i] is attempt i + 1.
 */
export function anchorFor(tried: readonly Candidate[], feedback: readonly RepairFeedback[], baseline: RepairInput["baseline"], baseFailing: readonly string[] = []): Candidate | null {
  let best: Candidate | null = null;
  let bestPass = baseline?.passing ?? Infinity; // no baseline: nothing is above it
  tried.forEach((c, i) => {
    const fb = feedback.find((f) => f.attempt === i + 1);
    if (fb?.codes.some((x) => x !== "TEST_FAIL")) return; // m179-guard:an-clean
    // no counts, or no baseline, also stop here (undefined is not a total)
    if (fb?.tests?.total !== baseline?.total) return; // m179-guard:an-total
    if (c.muts.length >= MAX_ANCHOR_MUTS) return; // m179-guard:an-room
    // batch 19 (Auditor #680): a test that passed before must not fail now (failing names a subset of the baseline's)
    if (!(fb?.failing ?? []).every((x) => baseFailing.includes(x))) return; // m179-guard:an-names
    if ((fb?.tests?.passedByPeaceAI ?? -1) <= bestPass) return; // m179-guard:an-improves
    best = c;
    bestPass = fb?.tests?.passedByPeaceAI ?? bestPass;
  });
  return best;
}
/**
 * M179: `pick` applied on top of `anchor` (both on the original files), or null when it cannot be: an overlapping edit
 * (the pick changes what the anchor changed: it is tried alone instead), more than MAX_ANCHOR_MUTS mutations, a result
 * that does not parse, or a composition already proposed.
 */
export function composeOnAnchor(anchor: Candidate, pick: Candidate, files: ReadonlyMap<string, string>, seen: ReadonlySet<string>): Candidate | null {
  if (anchor.muts.some((x) => pick.muts.some((y) => overlaps(x, y)))) return null; // m179-guard:co-overlap
  if (anchor.muts.length + pick.muts.length > MAX_ANCHOR_MUTS) return null; // m179-guard:co-cap
  const c = candidateFor(files, [...anchor.muts, ...pick.muts]);
  if (!c) return null; // m179-guard:co-valid
  if (seen.has(c?.key ?? "")) return null; // m179-guard:co-seen
  return { key: c?.key ?? "", muts: c?.muts ?? [], edits: c?.edits ?? [], anchored: true };
}
/** M167: options for a proposer built on repair-v1 (model-v1): its row name, and a reorder of the first candidate
 *  list (called once, also with [] when nothing was located; a throw is the proposer's failure, PROPOSER_FAILED). */
export interface RepairOptions { name?: string; order?: (queue: readonly Candidate[]) => Candidate[]; v2?: boolean }

/**
 * The general repair proposer (repair-v1). prepare() is called once per task by the loop with the search tools on the
 * pinned commit (no team tests) and the baseline's failing test names (node:test only; [] for vitest / jest).
 */
function editKind(candidate: Candidate): string {
  const names = [...new Set(candidate.muts.map((mut) => mut.template))];
  return names.join("+") || "repair";
}

export function repairProposer(opts: RepairOptions = {}): { name: string; readonly loadRepair: boolean; prepare(search: CodeRepo, input: PrepareInput): void; next(input: RepairInput): RepairProposal } {
  let sites: Site[] | null = null;
  let queue: Candidate[] | null = null;
  let loadQueue: Candidate[] | null = null;
  const tried: Candidate[] = [];
  const seen = new Set<string>();
  const combined = new Set<string>();
  const demoted = new Set<number>(); // M178
  const promoted = new Set<number>(); // M191
  const deferred: Candidate[] = []; // M179: standalone forms of queued candidates tried on an anchor
  let redo: Candidate[] = []; // M179: tried candidates to try again on the current anchor
  let anchorKey: string | null = null;
  let baseFailing: readonly string[] = [];
  return {
    name: opts.name ?? (opts.v2 ? REPAIR_PROPOSER_V2 : REPAIR_PROPOSER),
    // M174: repair-v2 only (never repair-v1 or a reranked list such as model-v1's): the loop may then ask it for a
    // suite that does not load, giving only its load diagnostics
    loadRepair: opts.v2 === true && !opts.order, // m174-guard:lr-v2-only
    prepare(search, input) { sites = locate(search, { request: input.request, failing: input.failing }, opts.v2 ? CALLEE_DEPTH.v2 : CALLEE_DEPTH.v1); baseFailing = [...(input.baseFailing ?? input.failing)]; },
    next(input) {
      if (input.loadDiagnostics && opts.v2 === true) {
        // a suite that did not load: only load-repair candidates, one per attempt (the other templates have no signal)
        if (!loadQueue) { loadQueue = loadCandidates(input.loadDiagnostics, new Map(input.files.map((f) => [f.path, f.content] as const))); if (loadQueue.length === 0) return { refuse: "NO_EDIT" }; }
        const pick = loadQueue.shift();
        return pick ? { edits: pick.edits, kind: editKind(pick) } : { refuse: "NO_MORE_EDITS" };
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
      // M178 (repair-v2 only; never repair-v1 or a reranked list such as model-v1's): sites whose edits the tests do not
      // notice, while another site's do, go behind the rest; the queue is rebuilt from the other sites in the same
      // fixed order (so later templates there come within reach), the demoted sites' queued candidates after them
      let fresh = siteDemotions(tried, input.feedback, input.baseline, baseFailing, demoted);
      if (opts.v2 !== true || opts.order) fresh = []; // m178-guard:dm-v2-only
      if (fresh.length) {
        for (const s of fresh) demoted.add(s);
        const skipKeys = new Set<string>();
        for (const c of tried) skipKeys.add(c.key); // m178-guard:rb-tried
        for (const c of deferred) skipKeys.add(c.key); // m179-guard:rb-deferred
        const live = repairCandidates(sites, files, skipKeys, true, demoted);
        const rest = queue.filter((c) => !live.some((x) => x.key === c.key));
        const next = [...live, ...rest];
        if (next.length > MAX_CANDIDATES) next.length = MAX_CANDIDATES; // m178-guard:rb-cap
        for (const c of next) seen.add(c.key);
        queue = next;
      }
      // M191 (repair-v2 only, like M178): a site where one edit made a baseline-failing test pass is where the fault
      // most likely is (even when that edit broke another test); its other candidates go to the front of the queue
      let fixAt = fixSites(tried, input.feedback, input.baseline, baseFailing, promoted);
      if (opts.v2 !== true || opts.order) fixAt = []; // m191-guard:v2-only
      if (fixAt.length) {
        for (const s of fixAt) promoted.add(s);
        const skipKeys = new Set<string>();
        for (const c of tried) skipKeys.add(c.key); // m191-guard:pr-tried
        for (const c of deferred) skipKeys.add(c.key);
        const others = new Set<number>(sites.map((_, i) => i).filter((i) => !fixAt.includes(i)));
        const front = repairCandidates(sites, files, skipKeys, true, others);
        const rest = queue.filter((c) => !front.some((x) => x.key === c.key));
        const next = [...front, ...rest];
        if (next.length > MAX_CANDIDATES) next.length = MAX_CANDIDATES; // m191-guard:pr-cap
        for (const c of next) seen.add(c.key);
        queue = next;
      }
      // M179 (repair-v2 only, like M178): after a clean partial fix (the anchor), the next candidates are tried ON TOP of
      // it: first every candidate tried so far, in the order it was tried (an edit the tests did not notice on the
      // original code may be masked by the anchor's fault), then the queue; a queued candidate's standalone form goes to
      // the end (deferred, not dropped). A composed result that improves further becomes the next anchor.
      let anchor = anchorFor(tried, input.feedback, input.baseline, baseFailing);
      if (opts.v2 !== true || opts.order) anchor = null; // m179-guard:an-v2-only
      if (anchor && anchor.key !== anchorKey) { anchorKey = anchor.key; redo = [...tried]; }
      if (!anchor) redo = [];
      while (!pick && anchor && redo.length) pick = composeOnAnchor(anchor, redo.shift()!, files, seen);
      if (!pick) {
        const q = queue.shift() ?? null;
        const c = q && anchor ? composeOnAnchor(anchor, q, files, seen) : null;
        if (c && q) deferred.push(q); // m179-guard:df-defer
        pick = c ?? q;
      }
      if (!pick) pick = deferred.shift() ?? null; // m179-guard:df-tail
      if (!pick) return { refuse: "NO_MORE_EDITS" };
      if (pick.anchored) seen.add(pick.key);
      tried.push(pick);
      return { edits: pick.edits, kind: editKind(pick) };
    },
  };
}
