// M7: deterministic test-and-fix repair. PeaceAI's own rules only: no model of any kind, no network.
// 1. parse tsc (--pretty false) and node:test TAP output into structured errors,
// 2. sort them deterministically,
// 3. map each error to at most one repair edit (one edit per file per round, so positions stay valid).
// The tool output is candidate-influenced text: it is only matched by fixed patterns, every edit target is
// re-validated against the candidate scope, and existing (base) tests are never edited.
import { posix } from "node:path";
import ts from "typescript";
import { mutationsIn, type Site } from "./editpropose.ts";
import { definitions, type RepoIndex } from "./symbols.ts";

export type ErrorKind =
  | "unknown-identifier"
  | "misspelled-property"
  | "missing-export"
  | "missing-property"
  | "unknown-property"
  | "type-mismatch"
  | "missing-module"
  | "assertion"
  | "test-failure"
  | "other";

export interface RepairError {
  source: "tsc" | "test";
  kind: ErrorKind;
  code: string; // "TS2304", or "ASSERT_strictEqual", "TEST_FAIL"
  file: string; // repo-relative, "" when unknown
  line: number;
  col: number;
  message: string; // first line only, bounded
  name?: string; // the identifier or property the error is about
  suggestion?: string; // tsc "Did you mean 'y'?"
  typeName?: string; // the named type in the message
  literal?: string; // a literal type text such as "critical" (with quotes) or 7
  expected?: string; // assertion: scalar YAML text
  actual?: string;
}

const MAX_MESSAGE = 240;
const TSC_LINE = /^(.+?)\((\d+),(\d+)\): error (TS\d{4,5}): (.*)$/;

function relPath(file: string, root: string): string {
  let p = file.replace(/\\/g, "/");
  if (p.startsWith("file://")) p = p.slice(7);
  const r = root.replace(/\\/g, "/").replace(/\/+$/, "");
  if (r && p.startsWith(`${r}/`)) p = p.slice(r.length + 1);
  p = posix.normalize(p);
  return p.startsWith("..") || p.startsWith("/") ? "" : p;
}

function classify(code: string, message: string): Pick<RepairError, "kind" | "name" | "suggestion" | "typeName" | "literal"> {
  let m: RegExpMatchArray | null;
  switch (code) {
    case "TS2304":
      if ((m = message.match(/^Cannot find name '([A-Za-z_$][\w$]*)'\./))) return { kind: "unknown-identifier", name: m[1] };
      break;
    case "TS2552":
      if ((m = message.match(/^Cannot find name '([A-Za-z_$][\w$]*)'\. Did you mean '([A-Za-z_$][\w$]*)'\?/)))
        return { kind: "unknown-identifier", name: m[1], suggestion: m[2] };
      break;
    case "TS2551":
      if ((m = message.match(/^Property '([A-Za-z_$][\w$]*)' does not exist on type '(.+)'\. Did you mean '([A-Za-z_$][\w$]*)'\?/)))
        return { kind: "misspelled-property", name: m[1], typeName: m[2], suggestion: m[3] };
      break;
    case "TS2339":
      if ((m = message.match(/^Property '([A-Za-z_$][\w$]*)' does not exist on type '(.+)'\./)))
        return { kind: "misspelled-property", name: m[1], typeName: m[2] };
      break;
    case "TS2724":
      if ((m = message.match(/has no exported member named '([A-Za-z_$][\w$]*)'\. Did you mean '([A-Za-z_$][\w$]*)'\?/)))
        return { kind: "missing-export", name: m[1], suggestion: m[2] };
      break;
    case "TS2305":
      if ((m = message.match(/has no exported member '([A-Za-z_$][\w$]*)'\./))) return { kind: "missing-export", name: m[1] };
      break;
    case "TS2741":
      if ((m = message.match(/^Property '([A-Za-z_$][\w$]*)' is missing in type '.*' but required in type '([A-Za-z_$][\w$]*)'\./)))
        return { kind: "missing-property", name: m[1], typeName: m[2] };
      return { kind: "missing-property" };
    case "TS2353":
      if ((m = message.match(/^Object literal may only specify known properties, and '([A-Za-z_$][\w$]*)' does not exist in type '([A-Za-z_$][\w$]*)'\./)))
        return { kind: "unknown-property", name: m[1], typeName: m[2] };
      return { kind: "unknown-property" };
    case "TS2322":
    case "TS2345":
      if ((m = message.match(/^(?:Type|Argument of type) '("(?:[^"\\]|\\.){0,80}"|-?\d+(?:\.\d+)?)' is not assignable to (?:type|parameter of type) '([A-Za-z_$][\w$]*)'\./)))
        return { kind: "type-mismatch", literal: m[1], typeName: m[2] };
      return { kind: "type-mismatch" };
    case "TS2307":
      return { kind: "missing-module" };
  }
  return { kind: code === "TS2304" || code === "TS2552" ? "unknown-identifier" : "other" };
}

/** Parses `tsc --noEmit --pretty false` output. Continuation lines (indented) are ignored. */
export function parseTscOutput(output: string, root: string): RepairError[] {
  const errors: RepairError[] = [];
  for (const raw of output.split(/\r?\n/)) {
    const m = raw.match(TSC_LINE);
    if (!m) continue;
    const message = m[5]!.slice(0, MAX_MESSAGE);
    errors.push({ source: "tsc", code: m[4]!, file: relPath(m[1]!, root), line: Number(m[2]), col: Number(m[3]), message, ...classify(m[4]!, message) });
  }
  return errors;
}

const SCALAR = /^(?:-?\d+(?:\.\d+)?|true|false|null|'(?:[^']|'')*'|"(?:[^"\\]|\\.)*")$/;

/** Parses node:test TAP output: one error per failing leaf test, with expected/actual for scalar assertions. */
export function parseTapFailures(output: string, root: string): RepairError[] {
  const lines = output.split(/\r?\n/);
  const errors: RepairError[] = [];
  for (let i = 0; i < lines.length; i++) {
    const head = lines[i]!.match(/^(\s*)not ok \d+ - (.*)$/);
    if (!head) continue;
    const indent = head[1]!.length;
    const block: string[] = [];
    let j = i + 1;
    if (lines[j]?.trim() === "---") {
      for (j = j + 1; j < lines.length && lines[j]!.trim() !== "..."; j++) block.push(lines[j]!);
    }
    const field = (key: string): string | undefined => {
      const line = block.find((l) => l.trimStart().startsWith(`${key}:`));
      return line ? line.trimStart().slice(key.length + 1).trim() : undefined;
    };
    const failureType = field("failureType");
    if (failureType === "'subtestsFailed'" || failureType === "subtestsFailed") continue; // parents of failing leaves
    // The first stack frame inside the tree, else the test's own location.
    let file = "";
    let line = 0;
    let col = 0;
    for (const l of block) {
      const fm = l.match(/\(?((?:file:\/\/)?\/[^\s():]+\.[cm]?[jt]sx?):(\d+):(\d+)\)?\s*$/);
      if (!fm) continue;
      const rel = relPath(fm[1]!, root);
      if (rel && !rel.includes("node_modules/")) {
        file = rel;
        line = Number(fm[2]);
        col = Number(fm[3]);
        break;
      }
    }
    if (!file) {
      const loc = field("location")?.replace(/^'|'$/g, "").match(/^(.*):(\d+):(\d+)$/);
      if (loc) {
        file = relPath(loc[1]!, root);
        line = Number(loc[2]);
        col = Number(loc[3]);
      }
    }
    const operator = field("operator")?.replace(/^'|'$/g, "");
    const expected = field("expected");
    const actual = field("actual");
    const name = head[2]!.slice(0, MAX_MESSAGE);
    if (operator && expected !== undefined && actual !== undefined && SCALAR.test(expected) && SCALAR.test(actual)) {
      errors.push({ source: "test", kind: "assertion", code: `ASSERT_${operator}`, file, line, col, message: name, expected, actual });
    } else {
      errors.push({ source: "test", kind: "test-failure", code: "TEST_FAIL", file, line, col, message: name });
    }
    void indent;
    i = j;
  }
  return errors;
}

const KIND_ORDER: readonly ErrorKind[] = [
  "missing-module",
  "unknown-identifier",
  "missing-export",
  "misspelled-property",
  "unknown-property",
  "missing-property",
  "type-mismatch",
  "other",
  "assertion",
  "test-failure",
];

/** Deterministic order: tsc before tests, then kind, file, line, col, code, message. Duplicates dropped. */
export function sortErrors(errors: readonly RepairError[]): RepairError[] {
  const key = (e: RepairError) => [e.source === "tsc" ? 0 : 1, KIND_ORDER.indexOf(e.kind), e.file, e.line, e.col, e.code, e.message] as const;
  const cmp = (a: RepairError, b: RepairError) => {
    const ka = key(a);
    const kb = key(b);
    for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return ka[i]! < kb[i]! ? -1 : 1;
    return 0;
  };
  const seen = new Set<string>();
  return [...errors].sort(cmp).filter((e) => {
    const k = JSON.stringify(key(e));
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** Position-free fingerprint: a round that leaves the same set of errors made no progress. */
export function errorFingerprint(errors: readonly RepairError[]): string {
  return sortErrors(errors)
    .map((e) => `${e.source}|${e.code}|${e.file}|${e.message}`)
    .sort()
    .join("\n");
}

// ---- repair rules

export type RuleId =
  | "ADD_MISSING_IMPORT"
  | "FIX_NAME_TYPO"
  | "FIX_PROPERTY_TYPO"
  | "FIX_IMPORT_NAME_TYPO"
  | "ADD_MISSING_REQUIRED_PROPERTY"
  | "ADD_FIELD_TO_TYPE"
  | "ADD_UNION_LITERAL"
  | "ALIGN_ADDED_CONSTANT"
  | "ALIGN_CALL_RESULT";

export const RULES: readonly RuleId[] = [
  "ADD_MISSING_IMPORT",
  "FIX_NAME_TYPO",
  "FIX_PROPERTY_TYPO",
  "FIX_IMPORT_NAME_TYPO",
  "ADD_MISSING_REQUIRED_PROPERTY",
  "ADD_FIELD_TO_TYPE",
  "ADD_UNION_LITERAL",
  "ALIGN_ADDED_CONSTANT",
  "ALIGN_CALL_RESULT",
];

export interface RepairContext {
  index: RepoIndex;
  read: (path: string) => string | null;
  /** Content at the base commit, or null for a file the candidate created. */
  base: (path: string) => string | null;
  isSource: (path: string) => boolean;
  isTest: (path: string) => boolean;
}

export interface RepairEdit {
  rule: RuleId;
  path: string;
  line: number;
  content: string; // whole new file content
  /** M7.1: the edit inserts a placeholder value ("", 0, false, null, [], first literal), not a real one. */
  placeholder?: boolean;
}

const isBaseTest = (ctx: RepairContext, path: string) => ctx.isTest(path) && ctx.base(path) !== null;
/** Source files the candidate may change: in scope, not a test. */
const editableSource = (ctx: RepairContext, path: string) => !!path && ctx.isSource(path) && !ctx.isTest(path);
/** Code-level (compile) fixes may also touch test files the candidate created; never existing tests. */
const editableForCompile = (ctx: RepairContext, path: string) => !!path && ctx.isSource(path) && !isBaseTest(ctx, path);

function parse(path: string, content: string): ts.SourceFile {
  return ts.createSourceFile(path, content, ts.ScriptTarget.Latest, true, path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
}

function offsetOf(sf: ts.SourceFile, line: number, col: number): number | null {
  if (line < 1 || line > sf.getLineStarts().length) return null;
  return sf.getPositionOfLineAndCharacter(line - 1, Math.max(0, col - 1));
}

function nodeAt(sf: ts.SourceFile, pos: number): ts.Node | null {
  let found: ts.Node | null = null;
  const visit = (n: ts.Node) => {
    if (pos >= n.getStart(sf) && pos < n.getEnd()) {
      found = n;
      n.forEachChild(visit);
    }
  };
  sf.forEachChild(visit);
  return found;
}

function identifierAt(sf: ts.SourceFile, line: number, col: number, name: string): ts.Identifier | null {
  const pos = offsetOf(sf, line, col);
  if (pos === null) return null;
  const n = nodeAt(sf, pos);
  return n && ts.isIdentifier(n) && n.text === name ? n : null;
}

function replaceRange(content: string, start: number, end: number, text: string): string {
  return content.slice(0, start) + text + content.slice(end);
}

function lineIndent(content: string, pos: number): string {
  const start = content.lastIndexOf("\n", pos - 1) + 1;
  return content.slice(start).match(/^[ \t]*/)![0];
}

/** Unique exported, module-level definition of `name` in an in-scope, non-test file. */
function uniqueExport(ctx: RepairContext, name: string, kinds?: readonly string[]) {
  const defs = definitions(ctx.index, name).filter(
    (d) => d.exported && d.scope === "module" && ctx.isSource(d.path) && !ctx.isTest(d.path) && (!kinds || kinds.includes(d.kind)),
  );
  return defs.length === 1 ? defs[0]! : null;
}

function relativeSpecifier(from: string, to: string, content: string): string {
  let spec = posix.relative(posix.dirname(from), to).replace(/\.tsx?$/, "");
  if (!spec.startsWith(".")) spec = `./${spec}`;
  // Follow the file's own convention for relative imports (with or without the .ts extension).
  const usesTs = /from\s+["']\.{1,2}\/[^"']+\.ts["']/.test(content);
  const usesBare = /from\s+["']\.{1,2}\/[^"']+(?<!\.ts)["']/.test(content);
  return usesTs && !usesBare ? `${spec}.ts` : spec;
}

function ruleAddMissingImport(e: RepairError, ctx: RepairContext): RepairEdit | null {
  if (e.kind !== "unknown-identifier" || !e.name || !editableForCompile(ctx, e.file)) return null;
  const def = uniqueExport(ctx, e.name, ["function", "const", "let", "var", "type", "interface", "enum", "class"]);
  if (!def || def.path === e.file) return null;
  const content = ctx.read(e.file);
  if (content === null) return null;
  const sf = parse(e.file, content);
  if (!identifierAt(sf, e.line, e.col, e.name)) return null;
  const typeOnly = def.kind === "type" || def.kind === "interface";
  const spec = relativeSpecifier(e.file, def.path, content);
  const imports = sf.statements.filter(ts.isImportDeclaration);
  // Already imported under that name? Then this is not a missing import.
  for (const imp of imports) {
    const nb = imp.importClause?.namedBindings;
    if (nb && ts.isNamedImports(nb) && nb.elements.some((el) => el.name.text === e.name)) return null;
  }
  const same = imports.find((imp) => ts.isStringLiteral(imp.moduleSpecifier) && imp.moduleSpecifier.text === spec);
  const nb = same?.importClause?.namedBindings;
  if (same && nb && ts.isNamedImports(nb) && !!same.importClause!.isTypeOnly === typeOnly) {
    const last = nb.elements[nb.elements.length - 1];
    if (!last) return null;
    return { rule: "ADD_MISSING_IMPORT", path: e.file, line: e.line, content: replaceRange(content, last.getEnd(), last.getEnd(), `, ${e.name}`) };
  }
  const quote = imports.length && content[imports[0]!.moduleSpecifier.getStart(sf)] === "'" ? "'" : '"';
  const statement = `import ${typeOnly ? "type " : ""}{ ${e.name} } from ${quote}${spec}${quote};\n`;
  const after = imports.length ? imports[imports.length - 1]!.getEnd() : 0;
  const insertAt = after === 0 ? 0 : content.indexOf("\n", after) + 1 || content.length;
  return { rule: "ADD_MISSING_IMPORT", path: e.file, line: e.line, content: replaceRange(content, insertAt, insertAt, after === 0 ? `${statement}\n` : statement) };
}

function ruleRenameAt(rule: RuleId, e: RepairError, ctx: RepairContext): RepairEdit | null {
  if (!e.name || !e.suggestion || !editableForCompile(ctx, e.file)) return null;
  const content = ctx.read(e.file);
  if (content === null) return null;
  const id = identifierAt(parse(e.file, content), e.line, e.col, e.name);
  if (!id) return null;
  return { rule, path: e.file, line: e.line, content: replaceRange(content, id.getStart(), id.getEnd(), e.suggestion) };
}

function ruleFixNameTypo(e: RepairError, ctx: RepairContext): RepairEdit | null {
  if (e.kind !== "unknown-identifier" || !e.suggestion) return null;
  return ruleRenameAt("FIX_NAME_TYPO", e, ctx);
}
/** Optimal string alignment distance (adjacent transpositions count as one edit). */
export function editDistance(a: string, b: string): number {
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0]![j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i]![j] = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i]![j] = Math.min(d[i]![j]!, d[i - 2]![j - 2]! + 1);
    }
  return d[a.length]![b.length]!;
}

function ruleFixPropertyTypo(e: RepairError, ctx: RepairContext): RepairEdit | null {
  if (e.kind !== "misspelled-property") return null;
  if (e.suggestion) return ruleRenameAt("FIX_PROPERTY_TYPO", e, ctx);
  // No compiler suggestion: look the type up in the index and take the single closest member name.
  if (!e.name || !e.typeName || !/^[A-Za-z_$][\w$]*$/.test(e.typeName)) return null;
  const type = namedObjectType(ctx, e.typeName);
  if (!type) return null;
  const names = type.members.flatMap((m) => (m.name && ts.isIdentifier(m.name) ? [m.name.text] : []));
  const limit = e.name.length <= 4 ? 1 : 2;
  const close = names.map((n) => [n, editDistance(e.name!, n)] as const).filter(([, d]) => d <= limit);
  const best = Math.min(...close.map(([, d]) => d));
  const winners = close.filter(([, d]) => d === best);
  if (winners.length !== 1) return null;
  return ruleRenameAt("FIX_PROPERTY_TYPO", { ...e, suggestion: winners[0]![0] }, ctx);
}
function ruleFixImportNameTypo(e: RepairError, ctx: RepairContext): RepairEdit | null {
  if (e.kind !== "missing-export" || !e.suggestion) return null;
  return ruleRenameAt("FIX_IMPORT_NAME_TYPO", e, ctx);
}

/** The declaration of a named object type (`type T = {...}` or `interface T {...}`) in scope. */
function namedObjectType(ctx: RepairContext, name: string) {
  const def = uniqueExport(ctx, name, ["type", "interface"]) ??
    (() => {
      const defs = definitions(ctx.index, name, ["type", "interface"]).filter((d) => d.scope === "module" && ctx.isSource(d.path) && !ctx.isTest(d.path));
      return defs.length === 1 ? defs[0]! : null;
    })();
  if (!def) return null;
  const content = ctx.read(def.path);
  if (content === null) return null;
  const sf = parse(def.path, content);
  for (const s of sf.statements) {
    if (ts.isInterfaceDeclaration(s) && s.name.text === name) return { def, content, sf, members: s.members, node: s as ts.Node };
    if (ts.isTypeAliasDeclaration(s) && s.name.text === name && ts.isTypeLiteralNode(s.type)) return { def, content, sf, members: s.type.members, node: s.type as ts.Node };
  }
  return null;
}

function defaultValueFor(type: ts.TypeNode | undefined, sf: ts.SourceFile): string | null {
  if (!type) return null;
  switch (type.kind) {
    case ts.SyntaxKind.StringKeyword:
      return '""';
    case ts.SyntaxKind.NumberKeyword:
      return "0";
    case ts.SyntaxKind.BooleanKeyword:
      return "false";
  }
  if (ts.isArrayTypeNode(type) || (ts.isTypeOperatorNode(type) && ts.isArrayTypeNode(type.type))) return "[]";
  if (ts.isLiteralTypeNode(type)) return type.literal.kind === ts.SyntaxKind.NullKeyword ? "null" : type.literal.getText(sf);
  if (ts.isUnionTypeNode(type)) {
    if (type.types.some((t) => ts.isLiteralTypeNode(t) && t.literal.kind === ts.SyntaxKind.NullKeyword)) return "null";
    const first = type.types[0];
    return first && ts.isLiteralTypeNode(first) ? first.literal.getText(sf) : null;
  }
  return null;
}

function insertProperty(content: string, sf: ts.SourceFile, literal: ts.ObjectLiteralExpression, text: string): string {
  const props = literal.properties;
  const last = props[props.length - 1];
  if (!last) {
    return replaceRange(content, literal.getStart(sf), literal.getEnd(), `{ ${text} }`);
  }
  const multiline = sf.getLineAndCharacterOfPosition(literal.getStart(sf)).line !== sf.getLineAndCharacterOfPosition(literal.getEnd()).line;
  const after = content.slice(last.getEnd(), literal.getEnd() - 1);
  const trailingComma = after.trimStart().startsWith(",");
  if (multiline) {
    const indent = lineIndent(content, last.getStart(sf));
    const at = trailingComma ? last.getEnd() + after.indexOf(",") + 1 : last.getEnd();
    return replaceRange(content, at, at, `${trailingComma ? "" : ","}\n${indent}${text}${trailingComma ? "," : ""}`);
  }
  const at = trailingComma ? last.getEnd() + after.indexOf(",") + 1 : last.getEnd();
  return replaceRange(content, at, at, `${trailingComma ? "" : ","} ${text}`);
}

function ruleAddMissingRequiredProperty(e: RepairError, ctx: RepairContext): RepairEdit | null {
  if (e.kind !== "missing-property" || !e.name || !e.typeName || !editableSource(ctx, e.file)) return null;
  const type = namedObjectType(ctx, e.typeName);
  if (!type) return null;
  const member = type.members.find((m) => ts.isPropertySignature(m) && m.name && ts.isIdentifier(m.name) && m.name.text === e.name) as ts.PropertySignature | undefined;
  if (!member || member.questionToken) return null;
  const value = defaultValueFor(member.type, type.sf);
  if (value === null) return null;
  const content = ctx.read(e.file);
  if (content === null) return null;
  const sf = parse(e.file, content);
  const pos = offsetOf(sf, e.line, e.col);
  if (pos === null) return null;
  let n = nodeAt(sf, pos);
  let literal: ts.ObjectLiteralExpression | null = null;
  if (n && ts.isIdentifier(n) && ts.isVariableDeclaration(n.parent) && n.parent.initializer && ts.isObjectLiteralExpression(n.parent.initializer))
    literal = n.parent.initializer;
  while (!literal && n) {
    if (ts.isObjectLiteralExpression(n)) literal = n;
    n = n.parent ?? null;
  }
  if (!literal) return null;
  if (literal.properties.some((p) => p.name && ts.isIdentifier(p.name) && p.name.text === e.name)) return null;
  return { rule: "ADD_MISSING_REQUIRED_PROPERTY", path: e.file, line: e.line, content: insertProperty(content, sf, literal, `${e.name}: ${value}`), placeholder: true };
}

function ruleAddFieldToType(e: RepairError, ctx: RepairContext): RepairEdit | null {
  if (e.kind !== "unknown-property" || !e.name || !e.typeName || !editableForCompile(ctx, e.file)) return null;
  const content = ctx.read(e.file);
  if (content === null) return null;
  const sf = parse(e.file, content);
  const id = identifierAt(sf, e.line, e.col, e.name);
  if (!id || !ts.isPropertyAssignment(id.parent)) return null;
  const init = id.parent.initializer;
  const fieldType = ts.isStringLiteral(init) || ts.isNoSubstitutionTemplateLiteral(init) ? "string"
    : ts.isNumericLiteral(init) || (ts.isPrefixUnaryExpression(init) && ts.isNumericLiteral(init.operand)) ? "number"
    : init.kind === ts.SyntaxKind.TrueKeyword || init.kind === ts.SyntaxKind.FalseKeyword ? "boolean"
    : null;
  if (!fieldType) return null;
  const type = namedObjectType(ctx, e.typeName);
  if (!type || !editableSource(ctx, type.def.path)) return null;
  if (type.members.some((m) => m.name && ts.isIdentifier(m.name) && m.name.text === e.name)) return null;
  const props = type.members.filter(ts.isPropertySignature);
  const readonly = props.length > 0 && props.every((p) => p.modifiers?.some((mod) => mod.kind === ts.SyntaxKind.ReadonlyKeyword));
  const field = `${readonly ? "readonly " : ""}${e.name}?: ${fieldType};`;
  const last = type.members[type.members.length - 1];
  const tc = type.content;
  let next: string;
  if (last) {
    const indent = lineIndent(tc, last.getStart(type.sf));
    const lastText = last.getText(type.sf);
    const end = last.getEnd();
    next = /[;,]$/.test(lastText) ? replaceRange(tc, end, end, `\n${indent}${field}`) : replaceRange(tc, end, end, `;\n${indent}${field}`);
  } else {
    const open = tc.indexOf("{", type.node.getStart(type.sf));
    if (open < 0) return null;
    next = replaceRange(tc, open + 1, open + 1, ` ${field} `);
  }
  return { rule: "ADD_FIELD_TO_TYPE", path: type.def.path, line: type.def.line, content: next };
}

function ruleAddUnionLiteral(e: RepairError, ctx: RepairContext): RepairEdit | null {
  if (e.kind !== "type-mismatch" || !e.literal || !e.typeName || !editableForCompile(ctx, e.file)) return null;
  const defs = definitions(ctx.index, e.typeName, ["type"]).filter((d) => d.scope === "module" && editableSource(ctx, d.path));
  if (defs.length !== 1) return null;
  const def = defs[0]!;
  const content = ctx.read(def.path);
  if (content === null) return null;
  const sf = parse(def.path, content);
  const alias = sf.statements.find((s): s is ts.TypeAliasDeclaration => ts.isTypeAliasDeclaration(s) && s.name.text === e.typeName);
  if (!alias) return null;
  const members = ts.isUnionTypeNode(alias.type) ? alias.type.types : [alias.type];
  const isString = e.literal.startsWith('"');
  const allLiterals = members.every(
    (t) => ts.isLiteralTypeNode(t) && (isString ? ts.isStringLiteral(t.literal) : ts.isNumericLiteral(t.literal) || ts.isPrefixUnaryExpression(t.literal)),
  );
  if (!allLiterals || members.length === 0) return null;
  if (members.some((t) => t.getText(sf) === e.literal)) return null;
  const end = alias.type.getEnd();
  return { rule: "ADD_UNION_LITERAL", path: def.path, line: def.line, content: replaceRange(content, end, end, ` | ${e.literal}`) };
}

function yamlScalarToTs(value: string): string | null {
  if (/^-?\d+(?:\.\d+)?$/.test(value) || value === "true" || value === "false" || value === "null") return value;
  if (value.startsWith("'")) return JSON.stringify(value.slice(1, -1).replace(/''/g, "'"));
  if (value.startsWith('"')) return value;
  return null;
}

const ASSERT_EQ = new Set(["equal", "strictEqual", "deepEqual", "deepStrictEqual"]);

/** A failing equality assertion on an exported constant the candidate itself added: align the constant. */
function ruleAlignAddedConstant(e: RepairError, ctx: RepairContext): RepairEdit | null {
  if (e.kind !== "assertion" || !e.expected || !e.file || !ctx.isTest(e.file)) return null;
  const operator = e.code.replace(/^ASSERT_/, "");
  if (!ASSERT_EQ.has(operator)) return null;
  const expected = yamlScalarToTs(e.expected);
  if (expected === null) return null;
  const testContent = ctx.read(e.file);
  if (testContent === null) return null;
  const tsf = parse(e.file, testContent);
  const pos = offsetOf(tsf, e.line, e.col);
  if (pos === null) return null;
  let n = nodeAt(tsf, pos);
  while (n && !ts.isCallExpression(n)) n = n.parent ?? null;
  if (!n || !ts.isCallExpression(n)) return null;
  const callee = n.expression;
  const method = ts.isPropertyAccessExpression(callee) ? callee.name.text : ts.isIdentifier(callee) ? callee.text : "";
  const [subject, expectedArg] = n.arguments;
  if (!ASSERT_EQ.has(method) || !subject || !expectedArg || !ts.isIdentifier(subject)) return null;
  // The test's expected argument must be the literal the runner reported (same text after normalising).
  const expText = expectedArg.getText(tsf);
  const norm = (s: string) => (s.startsWith("'") ? JSON.stringify(s.slice(1, -1)) : s);
  if (norm(expText) !== expected) return null;
  // The subject must be imported from a relative module, as an exported const with a literal initializer.
  let modulePath: string | null = null;
  for (const imp of tsf.statements.filter(ts.isImportDeclaration)) {
    const nb = imp.importClause?.namedBindings;
    if (!nb || !ts.isNamedImports(nb) || !ts.isStringLiteral(imp.moduleSpecifier)) continue;
    const el = nb.elements.find((x) => x.name.text === subject.text && !x.propertyName);
    if (!el) continue;
    const spec = imp.moduleSpecifier.text;
    if (!spec.startsWith(".")) return null;
    const baseSpec = posix.normalize(posix.join(posix.dirname(e.file), spec)).replace(/\.(?:js|ts)$/, "");
    modulePath = [`${baseSpec}.ts`, `${baseSpec}/index.ts`].find((p) => ctx.read(p) !== null) ?? null;
  }
  if (!modulePath || !editableSource(ctx, modulePath)) return null;
  const content = ctx.read(modulePath)!;
  const sf = parse(modulePath, content);
  for (const s of sf.statements) {
    if (!ts.isVariableStatement(s) || !(s.declarationList.flags & ts.NodeFlags.Const)) continue;
    if (!s.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) continue;
    for (const d of s.declarationList.declarations) {
      if (!ts.isIdentifier(d.name) || d.name.text !== subject.text || !d.initializer || d.type) continue;
      const init = d.initializer;
      const literal = ts.isStringLiteral(init) || ts.isNumericLiteral(init) || init.kind === ts.SyntaxKind.TrueKeyword || init.kind === ts.SyntaxKind.FalseKeyword || init.kind === ts.SyntaxKind.NullKeyword || (ts.isPrefixUnaryExpression(init) && ts.isNumericLiteral(init.operand));
      if (!literal) return null;
      // Only a constant the candidate added (its declaration line is not in the base file).
      const declLine = s.getText(sf);
      const base = ctx.base(modulePath);
      if (base !== null && base.split("\n").some((l) => l.trim() === declLine.trim())) return null;
      const lineNo = sf.getLineAndCharacterOfPosition(s.getStart(sf)).line + 1;
      return { rule: "ALIGN_ADDED_CONSTANT", path: modulePath, line: lineNo, content: replaceRange(content, init.getStart(sf), init.getEnd(), expected) };
    }
  }
  return null;
}

type Val = number | string | boolean | null | Val[];
const BAD = Symbol("bad");
type Res = Val | typeof BAD;

function sameVal(a: Val, b: Val): boolean {
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((x, i) => sameVal(x, b[i]!));
  }
  return Object.is(a, b);
}

function litNode(n: ts.Node): Val | typeof BAD {
  if (ts.isNumericLiteral(n)) return Number(n.text);
  if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) return n.text;
  if (n.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (n.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (n.kind === ts.SyntaxKind.NullKeyword) return null;
  if (ts.isPrefixUnaryExpression(n) && n.operator === ts.SyntaxKind.MinusToken && ts.isNumericLiteral(n.operand)) return -Number(n.operand.text);
  if (!ts.isArrayLiteralExpression(n)) return BAD;
  const xs: Val[] = [];
  for (const el of n.elements) {
    if (ts.isSpreadElement(el)) return BAD;
    const v = litNode(el);
    if (v === BAD) return BAD;
    xs.push(v);
  }
  return xs;
}

/**
 * Pure walk. Allowlisted string/array methods and regex literals only.
 * No eval, Function, or process. A step or size limit is BAD.
 */
const WALK_LIMIT = 4000;
const MAX_TEXT = 256;
const MAX_ITEMS = 64;
let walkSteps = 0;
function tick(): boolean {
  walkSteps += 1;
  return walkSteps > WALK_LIMIT;
}

const STRING_METHODS = new Set(["toLowerCase", "toUpperCase", "trim", "charAt", "slice", "substring", "split", "replace"]);
const ARRAY_METHODS = new Set(["map", "filter", "reduce", "join"]);

function compileLiteralRegex(text: string): RegExp | null {
  const m = /^\/([\s\S]*)\/([gimsuy]*)$/.exec(text);
  if (!m) return null;
  const body = m[1]!;
  const flags = m[2]!;
  if (body.length > 48 || !/^[gim]*$/.test(flags)) return null;
  if (/\\[1-9]/.test(body)) return null;
  if (/\([^)]*[+*][^)]*\)[+*{]/.test(body)) return null;
  try { return new RegExp(body, flags); } catch { return null; }
}

function asInt(v: Val): number | null {
  return typeof v === "number" && Number.isFinite(v) ? Math.trunc(v) : null;
}

function evalExpr(n: ts.Node, env: Map<string, Val>, sf: ts.SourceFile, depth: number): Res {
  if (depth > 8 || tick()) return BAD;
  if (ts.isParenthesizedExpression(n) || ts.isAsExpression(n) || ts.isTypeAssertionExpression(n) || ts.isNonNullExpression(n) || ts.isSatisfiesExpression(n)) return evalExpr(n.expression, env, sf, depth);
  const lit = litNode(n);
  if (lit !== BAD || ts.isNumericLiteral(n) || ts.isStringLiteral(n) || n.kind === ts.SyntaxKind.NullKeyword) return lit;
  if (ts.isIdentifier(n)) {
    if (n.text === "undefined") return null;
    return env.has(n.text) ? env.get(n.text)! : BAD;
  }
  if (ts.isPrefixUnaryExpression(n)) {
    const v = evalExpr(n.operand, env, sf, depth);
    if (v === BAD) return BAD;
    if (n.operator === ts.SyntaxKind.ExclamationToken) return !v;
    if (n.operator === ts.SyntaxKind.MinusToken && typeof v === "number") return -v;
    if (n.operator === ts.SyntaxKind.PlusToken && typeof v === "number") return v;
    return BAD;
  }
  if (ts.isBinaryExpression(n)) {
    const l = evalExpr(n.left, env, sf, depth);
    if (l === BAD) return BAD;
    const k = n.operatorToken.kind;
    if (k === ts.SyntaxKind.AmpersandAmpersandToken) return l ? evalExpr(n.right, env, sf, depth) : l;
    if (k === ts.SyntaxKind.BarBarToken) return l ? l : evalExpr(n.right, env, sf, depth);
    if (k === ts.SyntaxKind.QuestionQuestionToken) return l === null ? evalExpr(n.right, env, sf, depth) : l;
    const r = evalExpr(n.right, env, sf, depth);
    if (r === BAD) return BAD;
    if (k === ts.SyntaxKind.PlusToken) {
      if (typeof l === "string" || typeof r === "string") return String(l) + String(r);
      if (typeof l === "number" && typeof r === "number") return l + r;
      return BAD;
    }
    if (typeof l === "number" && typeof r === "number") {
      if (k === ts.SyntaxKind.MinusToken) return l - r;
      if (k === ts.SyntaxKind.AsteriskToken) return l * r;
      if (k === ts.SyntaxKind.SlashToken) return r === 0 ? BAD : l / r;
      if (k === ts.SyntaxKind.PercentToken) return r === 0 ? BAD : l % r;
    }
    if (k === ts.SyntaxKind.EqualsEqualsEqualsToken) return sameVal(l, r);
    if (k === ts.SyntaxKind.ExclamationEqualsEqualsToken) return !sameVal(l, r);
    if (typeof l === "number" && typeof r === "number") {
      if (k === ts.SyntaxKind.LessThanToken) return l < r;
      if (k === ts.SyntaxKind.LessThanEqualsToken) return l <= r;
      if (k === ts.SyntaxKind.GreaterThanToken) return l > r;
      if (k === ts.SyntaxKind.GreaterThanEqualsToken) return l >= r;
    }
    return BAD;
  }
  if (ts.isConditionalExpression(n)) {
    const c = evalExpr(n.condition, env, sf, depth);
    if (c === BAD) return BAD;
    return evalExpr(c ? n.whenTrue : n.whenFalse, env, sf, depth);
  }
  if (ts.isPropertyAccessExpression(n) && n.name.text === "length") {
    const v = evalExpr(n.expression, env, sf, depth);
    if (n.questionDotToken && v === null) return null;
    if (typeof v === "string" || Array.isArray(v)) return v.length;
    return BAD;
  }
  if (ts.isElementAccessExpression(n)) {
    const v = evalExpr(n.expression, env, sf, depth);
    const i = n.argumentExpression ? evalExpr(n.argumentExpression, env, sf, depth) : BAD;
    if (!Array.isArray(v) || typeof i !== "number") return BAD;
    return v[i] ?? null;
  }
  if (ts.isTemplateExpression(n)) {
    let out = n.head.text;
    for (const span of n.templateSpans) {
      const v = evalExpr(span.expression, env, sf, depth);
      if (v === BAD || (v !== null && typeof v !== "string" && typeof v !== "number" && typeof v !== "boolean")) return BAD;
      out += v === null ? "" : String(v);
      out += span.literal.text;
      if (out.length > MAX_TEXT || tick()) return BAD;
    }
    return out;
  }
  if (ts.isCallExpression(n)) return evalCall(n, env, sf, depth);
  if (ts.isArrayLiteralExpression(n)) {
    const xs: Val[] = [];
    for (const el of n.elements) {
      if (ts.isSpreadElement(el)) return BAD;
      const v = evalExpr(el, env, sf, depth);
      if (v === BAD) return BAD;
      xs.push(v);
    }
    return xs;
  }
  return BAD;
}

function evalArg(a: ts.Expression, env: Map<string, Val>, sf: ts.SourceFile, depth: number): Val | RegExp | typeof BAD {
  if (ts.isRegularExpressionLiteral(a)) {
    const re = compileLiteralRegex(a.text);
    return re ?? BAD;
  }
  return evalExpr(a, env, sf, depth);
}

function boundText(s: string): string | typeof BAD {
  return s.length > MAX_TEXT ? BAD : s;
}

function replaceText(s: string, search: string | RegExp, repl: string | ((match: string) => Res)): Res {
  if (s.length > MAX_TEXT) return BAD;
  if (typeof search === "string") {
    const at = s.indexOf(search);
    if (at < 0) return s;
    const next = typeof repl === "string" ? repl : repl(search);
    if (typeof next !== "string" || next.includes("$")) return BAD;
    return boundText(s.slice(0, at) + next + s.slice(at + search.length));
  }
  const flags = search.flags.includes("g") ? search.flags : search.flags;
  const re = new RegExp(search.source, flags);
  if (!re.flags.includes("g")) {
    const found = re.exec(s);
    if (!found) return s;
    const next = typeof repl === "string" ? repl : repl(found[0] ?? "");
    if (typeof next !== "string" || next.includes("$")) return BAD;
    return boundText(s.slice(0, found.index) + next + s.slice(found.index + found[0].length));
  }
  let out = "";
  let last = 0;
  let count = 0;
  re.lastIndex = 0;
  let found: RegExpExecArray | null;
  while ((found = re.exec(s))) {
    if (tick() || ++count > MAX_ITEMS) return BAD;
    const next = typeof repl === "string" ? repl : repl(found[0] ?? "");
    if (typeof next !== "string" || next.includes("$")) return BAD;
    out += s.slice(last, found.index) + next;
    last = found.index + found[0].length;
    if (found[0].length === 0) re.lastIndex += 1;
    if (out.length > MAX_TEXT) return BAD;
  }
  return boundText(out + s.slice(last));
}

function splitText(s: string, sep: string | RegExp): Res {
  if (s.length > MAX_TEXT) return BAD;
  if (typeof sep === "string") {
    const parts = sep === "" ? (s.length > MAX_ITEMS ? null : [...s]) : s.split(sep);
    if (!parts || parts.length > MAX_ITEMS) return BAD;
    return parts;
  }
  const re = new RegExp(sep.source, sep.flags);
  const parts = s.split(re);
  if (parts.length > MAX_ITEMS) return BAD;
  return parts;
}

function evalCallback(cb: ts.Expression, args: readonly Val[], env: Map<string, Val>, sf: ts.SourceFile, depth: number): Res {
  if (ts.isIdentifier(cb)) {
    const fn = findFn(sf, cb.text);
    return fn ? callFn(fn, args, sf, depth + 1) : BAD;
  }
  if (!ts.isArrowFunction(cb) && !ts.isFunctionExpression(cb)) return BAD;
  if (cb.parameters.some((p) => !ts.isIdentifier(p.name) || p.dotDotDotToken)) return BAD;
  return callFn(cb, args, sf, depth + 1, env);
}

function evalMethod(recv: Val, name: string, args: readonly ts.Expression[], env: Map<string, Val>, sf: ts.SourceFile, depth: number): Res {
  if (!STRING_METHODS.has(name) && !ARRAY_METHODS.has(name)) return BAD;
  if (typeof recv === "string" && STRING_METHODS.has(name)) {
    if (name === "toLowerCase" || name === "toUpperCase" || name === "trim") {
      if (args.length !== 0) return BAD;
      const next = name === "toLowerCase" ? recv.toLowerCase() : name === "toUpperCase" ? recv.toUpperCase() : recv.trim();
      return boundText(next);
    }
    if (name === "charAt" || name === "slice" || name === "substring") {
      const nums: number[] = [];
      for (const a of args) {
        const v = evalExpr(a, env, sf, depth);
        const i = v === BAD ? null : asInt(v);
        if (i === null) return BAD;
        nums.push(i);
      }
      if (name === "charAt") return nums.length === 1 ? recv.charAt(nums[0]!) : BAD;
      if (nums.length < 1 || nums.length > 2) return BAD;
      const next = name === "slice" ? recv.slice(nums[0], nums[1]) : recv.substring(nums[0], nums[1]);
      return boundText(next);
    }
    if (name === "split" || name === "replace") {
      if (name === "split" && (args.length < 1 || args.length > 2)) return BAD;
      if (name === "replace" && args.length !== 2) return BAD;
      const searchNode = args[0];
      if (!searchNode) return BAD;
      const search = evalArg(searchNode, env, sf, depth);
      if (search === BAD || (typeof search !== "string" && !(search instanceof RegExp))) return BAD;
      if (name === "split") {
        if (args.length === 2) return BAD;
        return splitText(recv, search);
      }
      const repNode = args[1];
      if (!repNode) return BAD;
      if (ts.isStringLiteral(repNode) || ts.isNoSubstitutionTemplateLiteral(repNode)) {
        if (repNode.text.includes("$")) return BAD;
        return replaceText(recv, search, repNode.text);
      }
      if (ts.isArrowFunction(repNode) || ts.isFunctionExpression(repNode) || ts.isIdentifier(repNode)) {
        return replaceText(recv, search, (match) => evalCallback(repNode, [match], env, sf, depth));
      }
      return BAD;
    }
  }
  if (Array.isArray(recv) && ARRAY_METHODS.has(name)) {
    if (recv.length > MAX_ITEMS) return BAD;
    if (name === "join") {
      const sepNode = args[0];
      const sep = sepNode ? evalExpr(sepNode, env, sf, depth) : "";
      if (typeof sep !== "string" || args.length > 1) return BAD;
      if (recv.some((x) => x !== null && typeof x !== "string" && typeof x !== "number" && typeof x !== "boolean")) return BAD;
      return boundText(recv.map((x) => (x === null ? "" : String(x))).join(sep));
    }
    const cb = args[0];
    if (!cb || (name !== "reduce" && args.length !== 1) || (name === "reduce" && args.length > 2)) return BAD;
    if (name === "map" || name === "filter") {
      const out: Val[] = [];
      for (let i = 0; i < recv.length; i++) {
        if (tick()) return BAD;
        const got = evalCallback(cb, [recv[i]!, i], env, sf, depth);
        if (got === BAD || got === undefined) return BAD;
        if (name === "map") out.push(got);
        else if (got) out.push(recv[i]!);
      }
      return out;
    }
    let acc: Val;
    let start = 0;
    if (args.length === 2) {
      const init = evalExpr(args[1]!, env, sf, depth);
      if (init === BAD) return BAD;
      acc = init;
    } else {
      if (recv.length === 0) return BAD;
      acc = recv[0]!;
      start = 1;
    }
    for (let i = start; i < recv.length; i++) {
      if (tick()) return BAD;
      const got = evalCallback(cb, [acc, recv[i]!], env, sf, depth);
      if (got === BAD || got === undefined) return BAD;
      acc = got;
    }
    return acc;
  }
  return BAD;
}

function evalCall(n: ts.CallExpression, env: Map<string, Val>, sf: ts.SourceFile, depth: number): Res {
  if (ts.isPropertyAccessExpression(n.expression)) {
    const recv = evalExpr(n.expression.expression, env, sf, depth);
    if (n.expression.questionDotToken && recv === null) return null;
    if (recv === BAD) return BAD;
    return evalMethod(recv, n.expression.name.text, [...n.arguments], env, sf, depth);
  }
  if (!ts.isIdentifier(n.expression)) return BAD;
  const args: Val[] = [];
  for (const a of n.arguments) {
    const v = evalArg(a, env, sf, depth);
    if (v === BAD || v instanceof RegExp) return BAD;
    args.push(v);
  }
  const fn = findFn(sf, n.expression.text);
  if (!fn) return BAD;
  return callFn(fn, args, sf, depth + 1, env);
}

type FnNode = ts.FunctionDeclaration | ts.ArrowFunction | ts.FunctionExpression;

function findFn(sf: ts.SourceFile, name: string): FnNode | null {
  for (const st of sf.statements) {
    if (ts.isFunctionDeclaration(st) && st.name?.text === name && st.body) return st;
    if (!ts.isVariableStatement(st)) continue;
    for (const d of st.declarationList.declarations) {
      if (ts.isIdentifier(d.name) && d.name.text === name && d.initializer && (ts.isArrowFunction(d.initializer) || ts.isFunctionExpression(d.initializer))) return d.initializer;
    }
  }
  return null;
}

function callFn(fn: FnNode, args: readonly Val[], sf: ts.SourceFile, depth: number, parent?: ReadonlyMap<string, Val>): Res {
  if (depth === 0) walkSteps = 0;
  if (depth > 8 || tick()) return BAD;
  const env = new Map(parent ?? []);
  fn.parameters.forEach((p, i) => { if (ts.isIdentifier(p.name)) env.set(p.name.text, args[i] ?? null); });
  if (!fn.body) return BAD;
  if (!ts.isBlock(fn.body)) return evalExpr(fn.body, env, sf, depth);
  const step = (nodes: readonly ts.Statement[]): Res | undefined => {
    for (const st of nodes) {
      if (ts.isReturnStatement(st)) return st.expression ? evalExpr(st.expression, env, sf, depth) : undefined;
      if (ts.isIfStatement(st)) {
        const c = evalExpr(st.expression, env, sf, depth);
        if (c === BAD) return BAD;
        const branch = c ? st.thenStatement : st.elseStatement;
        if (!branch) continue;
        const inner = ts.isBlock(branch) ? step(branch.statements) : step([branch as ts.Statement]);
        if (inner !== undefined) return inner;
        continue;
      }
      if (ts.isBlock(st)) {
        const inner = step(st.statements);
        if (inner !== undefined) return inner;
        continue;
      }
      if (ts.isVariableStatement(st)) {
        for (const d of st.declarationList.declarations) {
          if (!ts.isIdentifier(d.name) || !d.initializer) return BAD;
          const v = evalExpr(d.initializer, env, sf, depth);
          if (v === BAD) return BAD;
          env.set(d.name.text, v);
        }
        continue;
      }
      if (ts.isExpressionStatement(st)) {
        if (evalExpr(st.expression, env, sf, depth) === BAD) return BAD;
        continue;
      }
      return BAD;
    }
    return undefined;
  };
  const out = step(fn.body.statements);
  return out === undefined ? undefined as unknown as Res : out;
}

function assertSpecs(sf: ts.SourceFile, fnName: string): { args: Val[]; expected: Val }[] | null {
  const out: { args: Val[]; expected: Val }[] = [];
  let bad = false;
  const visit = (n: ts.Node) => {
    if (bad) return;
    if (ts.isCallExpression(n)) {
      const callee = n.expression;
      const method = ts.isPropertyAccessExpression(callee) ? callee.name.text : ts.isIdentifier(callee) ? callee.text : "";
      if (ASSERT_EQ.has(method) && n.arguments.length >= 2) {
        const [subject, exp] = n.arguments;
        if (subject && ts.isCallExpression(subject) && ts.isIdentifier(subject.expression) && subject.expression.text === fnName) {
          const args: Val[] = [];
          for (const a of subject.arguments) {
            const v = litNode(a);
            if (v === BAD) { bad = true; return; }
            args.push(v);
          }
          const expected = exp ? litNode(exp) : BAD;
          if (expected === BAD) { bad = true; return; }
          out.push({ args, expected });
          return;
        }
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return bad ? null : out;
}

/**
 * A failing equality assertion calls a function. Try the existing single-site mutation catalog
 * and keep an edit only when exactly one candidate in the whole catalog makes every literal
 * assertion hold. Stopping after a prefix can hide a later candidate, so a prefix is not unique.
 * The base file is not read. One assertion is not enough.
 */
function ruleAlignCallResult(e: RepairError, ctx: RepairContext): RepairEdit | null {
  if (e.kind !== "assertion" || !e.file || !ctx.isTest(e.file)) return null;
  const operator = e.code.replace(/^ASSERT_/, "");
  if (!ASSERT_EQ.has(operator)) return null;
  const testContent = ctx.read(e.file);
  if (testContent === null) return null;
  const tsf = parse(e.file, testContent);
  const pos = offsetOf(tsf, e.line, e.col);
  if (pos === null) return null;
  let n: ts.Node | null = nodeAt(tsf, pos);
  while (n && !ts.isCallExpression(n)) n = n.parent ?? null;
  if (!n || !ts.isCallExpression(n)) return null;
  const callee = n.expression;
  const method = ts.isPropertyAccessExpression(callee) ? callee.name.text : ts.isIdentifier(callee) ? callee.text : "";
  const subject = n.arguments[0];
  if (!ASSERT_EQ.has(method) || !subject || !ts.isCallExpression(subject) || !ts.isIdentifier(subject.expression)) return null;
  const fnName = subject.expression.text;
  let modulePath: string | null = null;
  for (const imp of tsf.statements.filter(ts.isImportDeclaration)) {
    const nb = imp.importClause?.namedBindings;
    if (!nb || !ts.isNamedImports(nb) || !ts.isStringLiteral(imp.moduleSpecifier)) continue;
    const el = nb.elements.find((x) => x.name.text === fnName && !x.propertyName);
    if (!el) continue;
    const spec = imp.moduleSpecifier.text;
    if (!spec.startsWith(".")) return null;
    const baseSpec = posix.normalize(posix.join(posix.dirname(e.file), spec)).replace(/\.(?:js|ts)$/, "");
    modulePath = [`${baseSpec}.ts`, `${baseSpec}/index.ts`].find((p) => ctx.read(p) !== null) ?? null;
  }
  if (!modulePath || !editableSource(ctx, modulePath)) return null;
  const specs = assertSpecs(tsf, fnName);
  if (!specs || specs.length < 2) return null;
  const content = ctx.read(modulePath)!;
  const sf = parse(modulePath, content);
  const decided = decideCallCatalog(content, modulePath, fnName, specs);
  if (!decided || !("hit" in decided)) return null;
  return { rule: "ALIGN_CALL_RESULT", path: modulePath, line: decided.line, content: decided.hit };
}

/**
 * Catalog edits the pure walker cannot judge. Empty when the walker already accepted or
 * rejected them. A caller may run those edits and keep one only when it is the unique pass.
 * This does not compose sites and does not read a base file.
 */
export function uncheckedCatalog(source: string, fnName: string, testSource: string): string[] {
  const tsf = parse("leaf.test.ts", testSource);
  const specs = assertSpecs(tsf, fnName);
  if (!specs || specs.length < 2) return [];
  const decided = decideCallCatalog(source, "leaf.ts", fnName, specs);
  return decided && "unchecked" in decided ? decided.unchecked : [];
}

function decideCallCatalog(content: string, path: string, fnName: string, specs: { args: Val[]; expected: Val }[]): { hit: string; line: number } | { unchecked: string[] } | null {
  const sf = parse(path, content);
  const fn = findFn(sf, fnName);
  if (!fn) return null;
  const site: Site = { path, name: fnName, start: fn.getStart(sf), end: fn.getEnd(), tier: 0 };
  const hits: string[] = [];
  const unchecked: string[] = [];
  for (const mut of mutationsIn(sf, site, 0, new Set())) {
    const next = replaceRange(content, mut.start, mut.end, mut.text);
    if (next === content || hits.includes(next) || unchecked.includes(next)) continue;
    const parsed = parse(path, next);
    const body = findFn(parsed, fnName);
    if (!body) continue;
    let ok = true;
    let unknown = false;
    for (const spec of specs) {
      const got = callFn(body, spec.args, parsed, 0);
      if (got === BAD || got === undefined) { unknown = true; break; }
      if (!sameVal(got, spec.expected)) { ok = false; break; }
    }
    if (unknown) { unchecked.push(next); continue; }
    if (ok) hits.push(next);
    if (hits.length > 1) return null;
  }
  const line = sf.getLineAndCharacterOfPosition(fn.getStart(sf)).line + 1;
  if (unchecked.length > 0) return { unchecked };
  if (hits.length === 1) return { hit: hits[0]!, line };
  return null;
}

const RULE_FNS: readonly ((e: RepairError, ctx: RepairContext) => RepairEdit | null)[] = [
  ruleAddMissingImport, // exact name exists elsewhere beats a typo guess
  ruleFixNameTypo,
  ruleFixPropertyTypo,
  ruleFixImportNameTypo,
  ruleAddFieldToType,
  ruleAddMissingRequiredProperty,
  ruleAddUnionLiteral,
  ruleAlignAddedConstant,
  ruleAlignCallResult,
];

/** First applicable rule for one error, or null. */
export function repairFor(e: RepairError, ctx: RepairContext): RepairEdit | null {
  for (const fn of RULE_FNS) {
    const edit = fn(e, ctx);
    if (edit && edit.content !== ctx.read(edit.path)) return edit;
  }
  return null;
}

/** One round: sorted errors, at most one edit per file. Base tests are never edited. */
export function planRepairs(errors: readonly RepairError[], ctx: RepairContext): RepairEdit[] {
  const edits: RepairEdit[] = [];
  const touched = new Set<string>();
  for (const e of sortErrors(errors)) {
    const edit = repairFor(e, ctx);
    if (!edit || touched.has(edit.path) || isBaseTest(ctx, edit.path) || !ctx.isSource(edit.path)) continue;
    touched.add(edit.path);
    edits.push(edit);
  }
  return edits;
}
