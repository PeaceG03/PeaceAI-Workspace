// M56 proposal: IMPORT_EDIT v2, a NEW kind beside IMPORT_EDIT v1 (v1 is unchanged). Spec: peaceai/spec/import-edit-v2.md.
// M66 wiring: kind IMPORT_EDIT_V2 in learned.ts RULE_KINDS (public-import-edit-v2); Job A runs it only when the
// hash-pinned approved list names it (Peace /approve-rule; not in approved.json). The dev path (applyImportEditV2Rule)
// stays OFF unless PEACEAI_IMPORT_EDIT_V2 is exactly "true". Builder never approves.
// v2 widens v1 in two mechanical ways, on ONE existing top-level import with every other byte identical:
//  - names: add or remove named bindings (or flip a `type` modifier) while the default/namespace binding is kept;
//  - bare specifiers: the specifier may be bare when it is unchanged, or toggles only the `node:` prefix of a
//    Node builtin. A new package name is never introduced, swapped, or turned from/to a relative path.
import ts from "typescript";
import { builtinModules } from "node:module";
import { PROTECTED_SELF } from "./selfchange.ts";
import { importResolveProblem } from "./learned-config.ts";
import { posix } from "node:path";
const RESOLVE_EXT = ["", ".ts", ".tsx", ".mts", "/index.ts"]; // same order as learned-config.ts importResolveProblem

export const IMPORT_EDIT_V2_FLAG = "PEACEAI_IMPORT_EDIT_V2";
export const importEditV2Enabled = (env: Record<string, string | undefined>): boolean => env[IMPORT_EDIT_V2_FLAG] === "true";
export const V2_MAX_NAMES = 5;

const isProtected = (path: string) => PROTECTED_SELF.some((p) => p.pattern.test(path));
const plainPath = (p: string) => !p.startsWith("/") && !p.split("/").some((s) => s === "" || s === "." || s === "..");
const RELATIVE = /^\.{1,2}\/[\w./-]{1,200}$/;
const BARE = /^(?:@[a-z0-9][\w.-]{0,100}\/)?[a-z0-9][\w.-]{0,100}(?:\/[\w.-]{1,100}){0,4}$/;
const IDENT = /^[A-Za-z_$][\w$]{0,100}$/;
const RESERVED = new Set(["__proto__", "constructor", "prototype", "default", "eval", "arguments"]);
const stem = (s: string) => s.replace(/\.(ts|tsx|js|mjs|cjs)$/, "");
const BUILTINS = new Set(builtinModules.filter((m) => !m.startsWith("_")));

interface Named { local: string; imported: string; type: boolean }
interface Imp { text: string; spec: string; clauseType: boolean; def: string | null; ns: string | null; named: Named[] | null; hasClause: boolean }
function parse(text: string, tsx: boolean): { imps: Imp[]; rest: string; bad: boolean } | null {
  const sf = ts.createSourceFile(tsx ? "m.tsx" : "m.ts", text, ts.ScriptTarget.Latest, true, tsx ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const bad = ((sf as unknown as { parseDiagnostics?: unknown[] }).parseDiagnostics ?? []).length > 0;
  const imps: Imp[] = []; let rest = ""; let last = 0;
  for (const s of sf.statements) {
    if (!ts.isImportDeclaration(s) || !ts.isStringLiteral(s.moduleSpecifier)) continue;
    if (s.attributes) return null; // import attributes (`with { ... }`) are out of scope
    rest += text.slice(last, s.getStart(sf)); last = s.getEnd();
    const c = s.importClause;
    const nb = c?.namedBindings;
    imps.push({
      text: s.getText(sf), spec: s.moduleSpecifier.text, hasClause: !!c, clauseType: !!c?.isTypeOnly,
      def: c?.name ? c.name.text : null,
      ns: nb && ts.isNamespaceImport(nb) ? nb.name.text : null,
      named: nb && ts.isNamedImports(nb) ? nb.elements.map((e) => ({ local: e.name.text, imported: (e.propertyName ?? e.name).getText(sf), type: e.isTypeOnly })) : null,
    });
  }
  return { imps, rest: rest + text.slice(last), bad };
}
/** Identifiers used in code (comments and string literals do not count), by the TypeScript scanner. */
function words(s: string, tsx = false): Set<string> {
  const sc = ts.createScanner(ts.ScriptTarget.Latest, true, tsx ? ts.LanguageVariant.JSX : ts.LanguageVariant.Standard, s);
  const out = new Set<string>();
  for (let k = sc.scan(); k !== ts.SyntaxKind.EndOfFileToken; k = sc.scan()) if (k === ts.SyntaxKind.Identifier) out.add(sc.getTokenValue());
  return out;
}

/** Specifier rule. null = allowed. */
export function v2SpecProblem(path: string, from: string, to: string, repoFiles: ReadonlySet<string>): string | null {
  if (from === to) return RELATIVE.test(to) || BARE.test(to) ? null : "specifier not a plain relative or bare name";
  const nodeOf = (s: string) => s.replace(/^node:/, "");
  if (!RELATIVE.test(from) && !RELATIVE.test(to)) {
    if (nodeOf(from) === nodeOf(to) && BUILTINS.has(nodeOf(to)) && (from.startsWith("node:") !== to.startsWith("node:"))) return null;
    return "a bare package may not be introduced or swapped";
  }
  if (!RELATIVE.test(from) || !RELATIVE.test(to)) return "relative and bare specifiers may not be exchanged";
  if (stem(from) !== stem(to) && from.split("/").pop() !== to.split("/").pop()) return "specifier must keep its module (extension or directory move only)";
  const toProblem = importResolveProblem(path, to, repoFiles);
  if (toProblem) return toProblem;
  // Auditor #226: no relative change may switch modules. Old and new must resolve to the SAME repo file, or the old
  // specifier must resolve to nothing (a real move). Covers extension-only (./x -> ./x.tsx beside x.ts; ./x.ts -> ./x.js;
  // ./x -> ./x.js beside x/index.ts) and directory moves alike.
  const oldHit = resolvedFile(path, from, repoFiles);
  if (oldHit !== null && oldHit !== resolvedFile(path, to, repoFiles)) return "specifier resolves to a different file than before";
  return null;
}

/** The repo file a relative specifier resolves to, in importResolveProblem's own order (null when none). */
export function resolvedFile(path: string, spec: string, repoFiles: ReadonlySet<string>): string | null {
  if (!RELATIVE.test(spec)) return null;
  const joined = posix.normalize(posix.join(posix.dirname(path), spec));
  if (joined.startsWith("../") || joined === ".." || joined.startsWith("/")) return null;
  const bases = [joined, joined.replace(/\.(js|mjs|cjs)$/, "")];
  return bases.flatMap((b) => RESOLVE_EXT.map((e) => b + e)).find((c) => repoFiles.has(c)) ?? null;
}

/** Auditor #226 (1): every name declared anywhere in the file outside its imports (variables, parameters, destructuring,
 *  functions, classes, types, interfaces, enums, namespaces, type parameters, catch variables). */
function declaredNames(text: string, tsx: boolean): Set<string> {
  const sf = ts.createSourceFile(tsx ? "d.tsx" : "d.ts", text, ts.ScriptTarget.Latest, true, tsx ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const out = new Set<string>();
  const visit = (n: ts.Node): void => {
    if (ts.isImportDeclaration(n)) return;
    if ((ts.isVariableDeclaration(n) || ts.isParameter(n) || ts.isBindingElement(n) || ts.isFunctionDeclaration(n) || ts.isFunctionExpression(n) || ts.isClassDeclaration(n) || ts.isClassExpression(n) || ts.isInterfaceDeclaration(n) || ts.isTypeAliasDeclaration(n) || ts.isEnumDeclaration(n) || ts.isModuleDeclaration(n) || ts.isTypeParameterDeclaration(n) || ts.isImportEqualsDeclaration(n)) && n.name && ts.isIdentifier(n.name)) out.add(n.name.text);
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}
/** Auditor #226 (1): globals an added import would shadow (the running engine's globals plus TypeScript lib/DOM names). */
const LIB_GLOBALS = new Set(["globalThis", "window", "document", "self", "navigator", "location", "fetch", "Request", "Response", "Headers", "URL", "URLSearchParams", "AbortController", "AbortSignal", "Blob", "File", "FormData", "TextEncoder", "TextDecoder", "structuredClone", "queueMicrotask", "setTimeout", "clearTimeout", "setInterval", "clearInterval", "setImmediate", "clearImmediate", "console", "process", "Buffer", "require", "module", "exports", "__dirname", "__filename", "JSON", "Math", "Reflect", "Proxy", "Promise", "Symbol", "Error", "Date", "RegExp", "Map", "Set", "WeakMap", "WeakSet", "Array", "Object", "String", "Number", "Boolean", "BigInt", "Function", "Intl", "Atomics", "SharedArrayBuffer", "ArrayBuffer", "DataView", "crypto", "performance", "EventTarget", "Event", "undefined", "NaN", "Infinity", "isNaN", "isFinite", "parseInt", "parseFloat", "encodeURIComponent", "decodeURIComponent", "encodeURI", "decodeURI", "escape", "unescape"]);
const DOM_GLOBALS = new Set(["Element", "Node", "NodeList", "HTMLCollection", "Window", "Document", "DocumentFragment", "ShadowRoot", "Text", "Comment", "Range", "Selection", "CustomEvent", "KeyboardEvent", "MouseEvent", "PointerEvent", "FocusEvent", "InputEvent", "TouchEvent", "WheelEvent", "UIEvent", "MutationObserver", "ResizeObserver", "IntersectionObserver", "Storage", "localStorage", "sessionStorage", "DOMParser", "DOMRect", "CSSStyleDeclaration", "XMLHttpRequest", "WebSocket", "Worker", "Image", "Audio", "history", "screen", "alert", "confirm", "prompt", "requestAnimationFrame", "cancelAnimationFrame", "getComputedStyle", "matchMedia", "customElements", "CanvasRenderingContext2D", "ImageData", "FileReader", "Notification", "IDBDatabase", "indexedDB"]);
const isGlobal = (name: string) => LIB_GLOBALS.has(name) || DOM_GLOBALS.has(name) || /^(?:HTML|SVG)\w*Element$/.test(name) || name in globalThis;

/** IMPORT_EDIT v2: exactly one existing import changes its specifier (v2SpecProblem) and/or its named bindings. */
export function importEditV2Problem(path: string, before: string, after: string, repoFiles: ReadonlySet<string>): string | null {
  if (!plainPath(path) || !/\.(ts|mts|tsx)$/.test(path) || path.endsWith(".d.ts")) return "not a plain .ts path";
  if (isProtected(path)) return "protected path";
  const tsx = path.endsWith(".tsx");
  const a = parse(before, tsx), b = parse(after, tsx);
  if (!a || !b) return "import attributes";
  if (a.bad || b.bad) return "syntax error";
  if (a.rest !== b.rest) return "text outside the imports changed";
  if (a.imps.length !== b.imps.length) return "imports added or removed";
  const ch = a.imps.map((x, i) => [x, b.imps[i]!] as const).filter(([x, y]) => x.text !== y.text);
  if (ch.length !== 1) return ch.length ? "more than one import changed" : "no import changed";
  const [x, y] = ch[0]!;
  if (!x.hasClause || !y.hasClause) return "side-effect import changed";
  if (x.def !== y.def || x.ns !== y.ns) return "default or namespace binding changed";
  if (x.clauseType !== y.clauseType && (x.named === null || y.named === null)) return "type-only flip without named bindings";
  const sp = v2SpecProblem(path, x.spec, y.spec, repoFiles);
  if (sp) return sp;
  const xn = x.named ?? [], yn = y.named ?? [];
  for (const n of [...xn, ...yn]) if (!IDENT.test(n.local) || !IDENT.test(n.imported) || RESERVED.has(n.local) || RESERVED.has(n.imported)) return "binding name not allowed";
  const key = (n: Named) => `${n.imported} as ${n.local}`;
  const xs = new Map(xn.map((n) => [key(n), n])), ys = new Map(yn.map((n) => [key(n), n]));
  if (xs.size !== xn.length || ys.size !== yn.length) return "duplicate binding";
  const removed = [...xs.keys()].filter((k) => !ys.has(k)), added = [...ys.keys()].filter((k) => !xs.has(k));
  const flipped = [...xs.keys()].filter((k) => ys.has(k) && xs.get(k)!.type !== ys.get(k)!.type);
  if (x.spec === y.spec && x.clauseType === y.clauseType && !removed.length && !added.length && !flipped.length) return "formatting or order only";
  if (removed.length + added.length + flipped.length + (x.clauseType !== y.clauseType ? 1 : 0) > V2_MAX_NAMES) return "too many binding changes";
  const restWords = words(a.rest, tsx);
  const otherLocals = new Set(a.imps.filter((i) => i !== x).flatMap((i) => [i.def, i.ns, ...(i.named ?? []).map((n) => n.local)]).filter((n): n is string => !!n));
  for (const k of removed) { const n = xs.get(k)!; if (restWords.has(n.local)) return `removed binding still used: ${n.local}`; }
  const declared = declaredNames(before, tsx);
  for (const k of added) {
    const n = ys.get(k)!;
    if (otherLocals.has(n.local) || n.local === x.def || n.local === x.ns || xn.some((m) => m.local === n.local)) return `added binding already bound: ${n.local}`;
    if (declared.has(n.local)) return `added binding shadows a local declaration: ${n.local}`;
    if (isGlobal(n.local)) return `added binding shadows a global: ${n.local}`;
    if (!restWords.has(n.local)) return `added binding unused: ${n.local}`;
  }
  return null;
}

// ---- M66 wiring: task phrase, spec parameters and the Job A / dev entries.
export const IMPORT_EDIT_V2_PARAM_KEYS = ["grading", "scope", "specifier"] as const;
export const IMPORT_EDIT_V2_VOCAB: Record<(typeof IMPORT_EDIT_V2_PARAM_KEYS)[number], readonly string[]> = {
  grading: ["target-suite"], // no new test: Job B grades the candidate with the target's own checks, like SET_LITERAL
  scope: ["one-existing-import"],
  specifier: ["same-node-toggle-or-relative-move"],
};
const SPEC_TEXT = String.raw`[\w@./:-]{1,200}`;
const TS_FILE = String.raw`[\w./-]+\.(?:ts|mts|tsx)`;
/** `change import of SPEC in FILE to: import ...` (the whole new import statement; one line). */
export const IMPORT_EDIT_V2_TRIGGER = String.raw`^(?:change|edit|fix) (?:the )?import (?:of|from) \x60?(?<from>${SPEC_TEXT})\x60? in \x60?(?<file>${TS_FILE})\x60? to:? \x60?(?<to>import [^\n\x60]{1,400}?)\x60?\.?$`;
export interface ImportEditV2Task { from: string; file: string; to: string }
export function parseImportEditV2Task(trigger: string, objective: string): ImportEditV2Task | null {
  const heads = objective.split("\n").map((l) => l.trim()).filter((l) => new RegExp(trigger, "i").test(l));
  if (heads.length !== 1) return null;
  const g = new RegExp(trigger, "i").exec(heads[0]!)!.groups ?? {};
  return g.from && g.file && g.to ? { from: g.from, file: g.file, to: g.to.trim() } : null;
}
/** Builds the one-import edit, then runs the v2 checks on the real before/after text. Reasons feed the M59 refusal line. */
export function buildImportEditV2(task: ImportEditV2Task, files: readonly { path: string; content: string }[], why?: { reason?: string }): { path: string; content: string } | null {
  const no = (r: string) => { if (why) why.reason = r; return null; };
  if (!plainPath(task.file)) return no("path_not_plain");
  if (isProtected(task.file)) return no("protected_path");
  const cur = files.find((f) => f.path === task.file);
  if (!cur) return no("target_missing");
  const tsx = task.file.endsWith(".tsx");
  const sf = ts.createSourceFile(tsx ? "m.tsx" : "m.ts", cur.content, ts.ScriptTarget.Latest, true, tsx ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const hits = sf.statements.filter((s): s is ts.ImportDeclaration => ts.isImportDeclaration(s) && ts.isStringLiteral(s.moduleSpecifier) && s.moduleSpecifier.text === task.from);
  if (!hits.length) return no("import_not_found");
  const nsf = ts.createSourceFile(tsx ? "n.tsx" : "n.ts", task.to, ts.ScriptTarget.Latest, true, tsx ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  if (nsf.statements.length !== 1 || !ts.isImportDeclaration(nsf.statements[0]!) || ((nsf as unknown as { parseDiagnostics?: unknown[] }).parseDiagnostics ?? []).length) return no("new_import_unparsed");
  const repoFiles = new Set(files.map((f) => f.path));
  // Several imports may share the specifier (e.g. `import type` beside a value import): exactly one of them must give a
  // v2-valid edit, otherwise the task is ambiguous (import_not_unique) or refused with the v2 reason.
  const tries = hits.map((h) => {
    const old = h.getText(sf);
    const text = old.endsWith(";") && !task.to.endsWith(";") ? task.to + ";" : task.to;
    const content = cur.content.slice(0, h.getStart(sf)) + text + cur.content.slice(h.getEnd());
    return { content, problem: importEditV2Problem(task.file, cur.content, content, repoFiles) };
  });
  const ok = tries.filter((t) => t.problem === null);
  if (ok.length === 1) return { path: task.file, content: ok[0]!.content };
  if (ok.length > 1) return no("import_not_unique");
  return hits.length === 1 ? no(`import_edit_refused: ${tries[0]!.problem}`) : no("import_not_unique");
}
const validParams = (params: Record<string, string | string[]>) => IMPORT_EDIT_V2_PARAM_KEYS.every((k) => typeof params[k] === "string" && IMPORT_EDIT_V2_VOCAB[k].includes(params[k] as string));
/** Job A entry: admitted only via the hash-pinned approved list, so no flag here. */
export function runImportEditV2Rule(trigger: string, params: Record<string, string | string[]>, objective: string, files: readonly { path: string; content: string }[], why?: { reason?: string }): { path: string; content: string } | null {
  if (!validParams(params)) { if (why) why.reason = "bad_rule_params"; return null; }
  const task = parseImportEditV2Task(trigger, objective);
  if (!task) { if (why) why.reason = "task_unparsed"; return null; }
  return buildImportEditV2(task, files, why);
}
/** Dev path: OFF unless PEACEAI_IMPORT_EDIT_V2 is exactly "true". */
export function applyImportEditV2Rule(trigger: string, params: Record<string, string | string[]>, objective: string, files: readonly { path: string; content: string }[], env: Record<string, string | undefined> = process.env, why?: { reason?: string }): { path: string; content: string } | null {
  return importEditV2Enabled(env) ? runImportEditV2Rule(trigger, params, objective, files, why) : null;
}
