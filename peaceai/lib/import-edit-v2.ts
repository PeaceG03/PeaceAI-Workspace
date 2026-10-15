// M56 proposal (OFF until approved): IMPORT_EDIT v2, a NEW kind beside IMPORT_EDIT v1 (v1 is unchanged).
// Spec: peaceai/spec/import-edit-v2.md. Not wired into learned.ts RULE_KINDS, not in approved.json; OFF unless
// PEACEAI_IMPORT_EDIT_V2 is exactly "true". Builder never approves.
// v2 widens v1 in two mechanical ways, on ONE existing top-level import with every other byte identical:
//  - names: add or remove named bindings (or flip a `type` modifier) while the default/namespace binding is kept;
//  - bare specifiers: the specifier may be bare when it is unchanged, or toggles only the `node:` prefix of a
//    Node builtin. A new package name is never introduced, swapped, or turned from/to a relative path.
import ts from "typescript";
import { builtinModules } from "node:module";
import { PROTECTED_SELF } from "./selfchange.ts";
import { importResolveProblem } from "./learned-config.ts";

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
  return importResolveProblem(path, to, repoFiles);
}

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
  for (const k of added) {
    const n = ys.get(k)!;
    if (otherLocals.has(n.local) || n.local === x.def || n.local === x.ns || xn.some((m) => m.local === n.local)) return `added binding already bound: ${n.local}`;
    if (!restWords.has(n.local)) return `added binding unused: ${n.local}`;
  }
  return null;
}
