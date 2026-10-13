// M8: deterministic edit-shape miner. Reads commits (pre/post file content + unified=0 hunks), finds the
// AST shape each small hunk makes, and counts how often each shape repeats (hunks, distinct commits,
// distinct files). No model of any kind: TypeScript's parser plus fixed structural rules.
import ts from "typescript";

export const MINER_VERSION = "peaceai-miner:v2" as const;
export const MAX_ADDED = 12;
export const MAX_REMOVED = 6;
export const SOURCE_FILE = /\.(ts|tsx|mts|cts)$/;
export const SKIP_FILE = /(\.test\.|\.spec\.|\.d\.ts$|(^|\/)(dist|node_modules|build)\/)/;

/** Shapes the miner recognizes. Covered ones already have an edit family in the kernel. */
export const SHAPES = {
  OBJECT_PROPERTY: { covered: "ADD_OBJECT_PROPERTY" },
  ARRAY_ITEM: { covered: "ADD_ARRAY_ITEM" },
  UNION_MEMBER: { covered: "ADD_UNION_MEMBER" },
  TYPE_FIELD: { covered: "ADD_TYPE_FIELD" },
  EXPORTED_CONSTANT: { covered: "ADD_EXPORTED_CONSTANT" },
  GUARD_CLAUSE: { covered: "ADD_GUARD_CLAUSE" },
  // M13: `if (cond) throw new Error(...)`; the kernel's ADD_GUARD_CLAUSE only returns a literal.
  THROW_GUARD: { covered: null },
  // M15: a new top-level exported function whose body is one return statement (kernel has no ADD_FUNCTION family).
  PURE_FUNCTION: { covered: null },
  TRY_CATCH: { covered: "WRAP_TRY_CATCH" },
  IMPORT: { covered: "native:import" },
  ENUM_MEMBER: { covered: null },
  SWITCH_CASE: { covered: null },
  NULLISH_DEFAULT: { covered: null },
  DEFAULT_PARAMETER: { covered: null },
  ENV_OPTION: { covered: null },
  LOG_LINE: { covered: null },
  LITERAL_CHANGE: { covered: null },
  // M12: a new test()/it() case in a test file (peaceai/lib/minetest.ts; public repositories only).
  TEST_CASE: { covered: null },
  // M14: a new case appended after every existing statement of an existing test file (also counted as TEST_CASE).
  TEST_CASE_APPEND: { covered: null },
} as const;
export type Shape = keyof typeof SHAPES;

export interface Hunk {
  /** 1-based post-image line range of added lines (count may be 0). */
  newStart: number;
  newCount: number;
  oldStart: number;
  oldCount: number;
  added: string[];
  removed: string[];
}

export interface Observation {
  shape: Shape;
  commit: string;
  path: string;
  line: number; // post-image line
  /** Shape-specific style facts used to learn the rule's parameters (no code text). */
  style: Record<string, string>;
}

/** Parses `git diff -U0` output for one file into hunks. */
export function parseHunks(diff: string): Hunk[] {
  const hunks: Hunk[] = [];
  let cur: Hunk | null = null;
  for (const line of diff.split("\n")) {
    const m = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (m) {
      cur = { oldStart: +m[1]!, oldCount: m[2] === undefined ? 1 : +m[2], newStart: +m[3]!, newCount: m[4] === undefined ? 1 : +m[4], added: [], removed: [] };
      hunks.push(cur);
      continue;
    }
    if (!cur || line.startsWith("+++") || line.startsWith("---")) continue;
    if (line.startsWith("+")) cur.added.push(line.slice(1));
    else if (line.startsWith("-")) cur.removed.push(line.slice(1));
  }
  return hunks;
}

const lineOf = (sf: ts.SourceFile, pos: number) => sf.getLineAndCharacterOfPosition(pos).line + 1;
const isLiteral = (n: ts.Node) =>
  ts.isStringLiteral(n) || ts.isNumericLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) ||
  n.kind === ts.SyntaxKind.TrueKeyword || n.kind === ts.SyntaxKind.FalseKeyword || n.kind === ts.SyntaxKind.NullKeyword ||
  (ts.isPrefixUnaryExpression(n) && ts.isNumericLiteral(n.operand)) || (ts.isArrayLiteralExpression(n) && n.elements.length === 0);
const literalKind = (n: ts.Node): string =>
  ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) ? "string"
    : ts.isNumericLiteral(n) || ts.isPrefixUnaryExpression(n) ? "number"
      : n.kind === ts.SyntaxKind.NullKeyword ? "null"
        : ts.isArrayLiteralExpression(n) ? "array" : "boolean";
const isExit = (s: ts.Statement): boolean =>
  ts.isReturnStatement(s) || ts.isThrowStatement(s) || ts.isContinueStatement(s) || ts.isBreakStatement(s) ||
  (ts.isBlock(s) && s.statements.length >= 1 && s.statements.length <= 2 && isExit(s.statements[s.statements.length - 1]!));
const isEnvRead = (n: ts.Node): boolean =>
  ts.isPropertyAccessExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === "env" &&
  ts.isIdentifier(n.expression.expression) && n.expression.expression.text === "process";
const isLogCall = (n: ts.Node): boolean =>
  ts.isExpressionStatement(n) && ts.isCallExpression(n.expression) && ts.isPropertyAccessExpression(n.expression.expression) &&
  ts.isIdentifier(n.expression.expression.expression) && /^(console|log|logger)$/.test(n.expression.expression.expression.text) &&
  /^(log|info|warn|error|debug)$/.test(n.expression.expression.name.text);
const caseName = (s: string) => (/^[A-Z0-9_]+$/.test(s) ? "upper" : /^[a-z][a-z0-9]*$/.test(s) ? "lower" : /^[A-Z][A-Za-z0-9]*$/.test(s) ? "pascal" : /^[a-z][A-Za-z0-9]*$/.test(s) ? "camel" : "other");

/** M13: style facts of a throw guard (no code text): braces, error form, message form, placement in its function. */
function throwGuardStyle(node: ts.IfStatement, t: ts.ThrowStatement, sf: ts.SourceFile): Record<string, string> {
  const e = t.expression;
  const isError = !!e && ts.isNewExpression(e) && ts.isIdentifier(e.expression) && e.expression.text === "Error";
  const arg = isError ? (e as ts.NewExpression).arguments?.[0] : undefined;
  const text = arg ? (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg) ? arg.text : ts.isTemplateExpression(arg) ? arg.head.text : "") : "";
  const coded = /^[A-Z][A-Z0-9_]{2,63}/.exec(text);
  const message = !arg ? "none" : !coded ? "other" : text === coded[0] && ts.isStringLiteral(arg) ? "code-only" : "code-detail";
  const body = node.parent && ts.isBlock(node.parent) && node.parent.parent && ts.isFunctionLike(node.parent.parent) ? node.parent : null;
  const idx = body ? body.statements.indexOf(node) : -1;
  const leading = body ? body.statements.slice(0, idx).every((s) => ts.isIfStatement(s) && !s.elseStatement && isExit(s.thenStatement)) : false;
  const oneLine = lineOf(sf, node.getStart(sf)) === lineOf(sf, node.getEnd());
  return {
    braces: ts.isBlock(node.thenStatement) ? "block" : "none",
    error: isError ? "Error" : "other",
    message,
    lines: oneLine ? "one" : "multi",
    placement: !body ? "nested" : idx === 0 || leading ? "function-entry" : "function-body",
  };
}

/** Classifies a node fully inside the added lines, given its parent. Null when it is not a known shape. */
function additiveShape(node: ts.Node, sf: ts.SourceFile): { shape: Shape; style: Record<string, string> } | null {
  const p = node.parent;
  if (ts.isEnumMember(node)) {
    const name = node.name.getText(sf).replace(/^["']|["']$/g, "");
    const init = node.initializer;
    let value = "none";
    if (init && ts.isStringLiteral(init)) value = init.text === name ? "string-same" : init.text === name.toLowerCase() ? "string-lower" : init.text === name.toLowerCase().replace(/_/g, "-") ? "string-kebab" : "string-other";
    else if (init && ts.isNumericLiteral(init)) value = "number";
    else if (init) value = "expression";
    return { shape: "ENUM_MEMBER", style: { value, name: caseName(name) } };
  }
  if (ts.isCaseClause(node)) {
    const body = node.statements;
    const style = body.length === 0 ? "fallthrough" : body.length === 1 && ts.isReturnStatement(body[0]!) && body[0]!.expression && isLiteral(body[0]!.expression) ? `return-${literalKind(body[0]!.expression)}` : body.length === 1 && ts.isReturnStatement(body[0]!) ? "return-expression" : "statements";
    return { shape: "SWITCH_CASE", style: { body: style, label: ts.isStringLiteral(node.expression) ? "string" : ts.isPropertyAccessExpression(node.expression) ? "member" : "other" } };
  }
  if (ts.isImportDeclaration(node)) return { shape: "IMPORT", style: {} };
  if (ts.isFunctionDeclaration(node) && p && ts.isSourceFile(p) && node.name && node.body && !node.asteriskToken && node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) {
    const st = node.body.statements;
    if (st.length !== 1 || !ts.isReturnStatement(st[0]!) || !st[0]!.expression) return null;
    const last = p.statements[p.statements.length - 1] === node;
    return { shape: "PURE_FUNCTION", style: {
      body: "single-return",
      params: node.parameters.length > 0 && node.parameters.every((x) => !!x.type && ts.isIdentifier(x.name) && !x.dotDotDotToken) ? "typed" : "other",
      returns: node.type ? "annotated" : "none",
      async: node.modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword) ? "yes" : "no",
      generic: node.typeParameters?.length ? "yes" : "no",
      placement: last ? "end-of-module" : "inside-module",
    } };
  }
  if (ts.isPropertyAssignment(node) && p && ts.isObjectLiteralExpression(p)) return { shape: "OBJECT_PROPERTY", style: {} };
  if (p && ts.isArrayLiteralExpression(p) && ts.isExpression(node)) return { shape: "ARRAY_ITEM", style: {} };
  if (ts.isLiteralTypeNode(node) && p && ts.isUnionTypeNode(p)) return { shape: "UNION_MEMBER", style: {} };
  if (ts.isPropertySignature(node)) return { shape: "TYPE_FIELD", style: {} };
  if (ts.isTryStatement(node)) return { shape: "TRY_CATCH", style: {} };
  if (ts.isIfStatement(node) && !node.elseStatement && isExit(node.thenStatement)) {
    const t = ts.isBlock(node.thenStatement) && node.thenStatement.statements.length === 1 ? node.thenStatement.statements[0]! : node.thenStatement;
    if (ts.isThrowStatement(t)) return { shape: "THROW_GUARD", style: throwGuardStyle(node, t, sf) };
    return { shape: "GUARD_CLAUSE", style: {} };
  }
  if (isLogCall(node)) return { shape: "LOG_LINE", style: { sink: ((node as ts.ExpressionStatement).expression as ts.CallExpression).expression.getText(sf).split(".")[0] === "console" ? "console" : "logger" } };
  if (ts.isVariableStatement(node)) {
    const decl = node.declarationList.declarations[0];
    const init = decl?.initializer;
    if (init && ts.isBinaryExpression(init) && (init.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken || init.operatorToken.kind === ts.SyntaxKind.BarBarToken) && isEnvRead(init.left)) {
      return { shape: "ENV_OPTION", style: { operator: init.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken ? "??" : "||", default: isLiteral(init.right) ? literalKind(init.right) : "expression", exported: node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) ? "yes" : "no" } };
    }
    const exported = node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
    if (exported && init && isLiteral(init) && node.parent && ts.isSourceFile(node.parent)) return { shape: "EXPORTED_CONSTANT", style: {} };
  }
  return null;
}

/** Shapes made by changing existing lines (the hunk removes and adds). */
function modifiedShapes(post: ts.SourceFile, hunk: Hunk, from: number, to: number): { shape: Shape; line: number; style: Record<string, string> }[] {
  const removedText = hunk.removed.join("\n");
  const out: { shape: Shape; line: number; style: Record<string, string> }[] = [];
  const visit = (n: ts.Node) => {
    const a = lineOf(post, n.getStart(post));
    const b = lineOf(post, n.getEnd());
    if (b < from || a > to) return;
    if (a >= from && b <= to) {
      if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken && isLiteral(n.right) && !isEnvRead(n.left)) {
        const left = n.left.getText(post);
        const had = removedText.includes(left) && !removedText.includes(n.getText(post)) && (removedText.match(/\?\?/g) ?? []).length < (hunk.added.join("\n").match(/\?\?/g) ?? []).length;
        if (had) out.push({ shape: "NULLISH_DEFAULT", line: a, style: { default: literalKind(n.right), target: ts.isPropertyAccessExpression(n.left) ? "member" : ts.isIdentifier(n.left) ? "identifier" : "other" } });
      }
      if (ts.isParameter(n) && n.initializer && ts.isIdentifier(n.name)) {
        const name = n.name.text;
        const fn = n.parent;
        const fnName = fn && (ts.isFunctionDeclaration(fn) || ts.isMethodDeclaration(fn)) && fn.name ? fn.name.getText(post) : null;
        const re = new RegExp(`\\b${name}\\s*(\\?\\s*)?(:[^,)=]*)?[,)]`);
        if (fnName && removedText.includes(fnName) && re.test(removedText) && !new RegExp(`\\b${name}\\b[^,)]*=`).test(removedText)) {
          out.push({ shape: "DEFAULT_PARAMETER", line: a, style: { default: isLiteral(n.initializer) ? literalKind(n.initializer) : "expression", wasOptional: new RegExp(`\\b${name}\\s*\\?`).test(removedText) ? "yes" : "no", typed: n.type ? "yes" : "no" } });
        }
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(post);
  return out;
}

const LITERAL_TOKENS = new Set([ts.SyntaxKind.StringLiteral, ts.SyntaxKind.NumericLiteral, ts.SyntaxKind.NoSubstitutionTemplateLiteral, ts.SyntaxKind.TrueKeyword, ts.SyntaxKind.FalseKeyword]);
function tokens(line: string): { kind: ts.SyntaxKind; text: string }[] {
  const sc = ts.createScanner(ts.ScriptTarget.Latest, true, ts.LanguageVariant.Standard, line);
  const out: { kind: ts.SyntaxKind; text: string }[] = [];
  for (let k = sc.scan(); k !== ts.SyntaxKind.EndOfFileToken; k = sc.scan()) out.push({ kind: k, text: sc.getTokenText() });
  return out;
}
/** Index of the single literal token that differs between two lines with otherwise equal tokens, else -1. */
export function literalDelta(before: string, after: string): { index: number; kind: string } | null {
  const a = tokens(before);
  const b = tokens(after);
  if (a.length !== b.length || a.length === 0) return null;
  let diff: { index: number; kind: string } | null = null;
  for (let i = 0; i < a.length; i++) {
    if (a[i]!.kind === b[i]!.kind && a[i]!.text === b[i]!.text) continue;
    const bothLit = LITERAL_TOKENS.has(a[i]!.kind) && LITERAL_TOKENS.has(b[i]!.kind);
    const sameFamily = a[i]!.kind === b[i]!.kind || ((a[i]!.kind === ts.SyntaxKind.TrueKeyword || a[i]!.kind === ts.SyntaxKind.FalseKeyword) && (b[i]!.kind === ts.SyntaxKind.TrueKeyword || b[i]!.kind === ts.SyntaxKind.FalseKeyword));
    if (!bothLit || !sameFamily || diff) return null;
    const k = b[i]!.kind;
    diff = { index: i, kind: k === ts.SyntaxKind.NumericLiteral ? "number" : k === ts.SyntaxKind.TrueKeyword || k === ts.SyntaxKind.FalseKeyword ? "boolean" : "string" };
  }
  return diff;
}
/** Where the changed literal sits: an exported/top-level const, an object property, a call argument, or other. */
function literalContext(post: ts.SourceFile, line: number): string {
  let found = "other";
  const visit = (n: ts.Node) => {
    if (lineOf(post, n.getStart(post)) > line || lineOf(post, n.getEnd()) < line) return;
    if (isLiteral(n) && lineOf(post, n.getStart(post)) === line) {
      const p = n.parent;
      if (p && ts.isVariableDeclaration(p) && p.initializer === n) found = ts.isSourceFile(p.parent.parent.parent) ? "top-level-const" : "local-const";
      else if (p && ts.isPropertyAssignment(p) && p.initializer === n) found = "object-property";
      else if (p && ts.isCallExpression(p)) found = "call-argument";
      else if (p && ts.isParameter(p)) found = "parameter-default";
      return;
    }
    ts.forEachChild(n, visit);
  };
  visit(post);
  return found;
}

/** All shape observations for one file in one commit. Pure; deterministic. */
export function observeFile(commit: string, path: string, postContent: string, hunks: readonly Hunk[]): Observation[] {
  if (!SOURCE_FILE.test(path) || SKIP_FILE.test(path)) return [];
  const post = ts.createSourceFile(path, postContent, ts.ScriptTarget.Latest, true, path.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const out: Observation[] = [];
  for (const h of hunks) {
    // M17: a hunk that creates the file is checked (whatever its size) for new modules' pure functions only:
    // each top-level exported single-return function in it is one PURE_FUNCTION observation, placement new-module.
    if (h.oldStart === 0 && h.oldCount === 0 && h.newStart === 1 && h.removed.length === 0 && h.added.length > MAX_ADDED) {
      for (const st of post.statements) {
        const sh = additiveShape(st, post);
        if (sh?.shape === "PURE_FUNCTION") out.push({ shape: "PURE_FUNCTION", commit, path, line: lineOf(post, st.getStart(post)), style: { ...sh.style, placement: "new-module" } });
      }
      continue;
    }
    if (h.newCount === 0 || h.added.length > MAX_ADDED || h.removed.length > MAX_REMOVED) continue;
    if (h.added.every((l) => l.trim() === "" || /^\s*(\/\/|\*|\/\*)/.test(l))) continue;
    const from = h.newStart;
    const to = h.newStart + h.newCount - 1;
    const found: Observation[] = [];
    if (h.removed.length === 0) {
      // Maximal nodes whose whole span is inside the added lines.
      const visit = (n: ts.Node) => {
        const a = lineOf(post, n.getStart(post));
        const b = lineOf(post, n.getEnd());
        if (b < from || a > to) return;
        if (a >= from && b <= to && n.kind !== ts.SyntaxKind.SyntaxList) {
          const s = additiveShape(n, post);
          if (s) {
            found.push({ shape: s.shape, commit, path, line: a, style: s.style });
            return;
          }
        }
        ts.forEachChild(n, visit);
      };
      visit(post);
    } else {
      for (const m of modifiedShapes(post, h, from, to)) found.push({ shape: m.shape, commit, path, line: m.line, style: m.style });
      if (found.length === 0 && h.added.length === h.removed.length) {
        for (let i = 0; i < h.added.length; i++) {
          const d = literalDelta(h.removed[i]!, h.added[i]!);
          if (d) found.push({ shape: "LITERAL_CHANGE", commit, path, line: from + i, style: { kind: d.kind, context: literalContext(post, from + i) } });
        }
      }
    }
    // M17: a pure function in a hunk that creates the file (old side empty) was added as a new module.
    if (h.oldStart === 0 && h.oldCount === 0) for (const o of found) if (o.shape === "PURE_FUNCTION") o.style = { ...o.style, placement: "new-module" };
    out.push(...found);
  }
  return out;
}

export interface ShapeStats {
  shape: Shape;
  covered: string | null;
  hunks: number;
  commits: number;
  files: number;
  examples: { commit: string; path: string; line: number }[]; // first 3 by commit order given
  styles: Record<string, Record<string, number>>; // style key -> value -> count
}

/** Frequency table, sorted by distinct commits then hunks then name. */
export function tally(observations: readonly Observation[]): ShapeStats[] {
  const by = new Map<Shape, Observation[]>();
  for (const o of observations) by.set(o.shape, [...(by.get(o.shape) ?? []), o]);
  const stats = [...by.entries()].map(([shape, list]) => {
    const styles: Record<string, Record<string, number>> = {};
    for (const o of list) for (const [k, v] of Object.entries(o.style)) (styles[k] ??= {})[v] = (styles[k]![v] ?? 0) + 1;
    const exampleCommits: Observation[] = [];
    for (const o of list) if (!exampleCommits.some((e) => e.commit === o.commit) && exampleCommits.length < 3) exampleCommits.push(o);
    return {
      shape, covered: SHAPES[shape].covered, hunks: list.length,
      commits: new Set(list.map((o) => o.commit)).size,
      files: new Set(list.map((o) => o.path)).size,
      examples: exampleCommits.map((o) => ({ commit: o.commit, path: o.path, line: o.line })),
      styles: Object.fromEntries(Object.entries(styles).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)))])),
    };
  });
  return stats.sort((a, b) => b.commits - a.commits || b.hunks - a.hunks || a.shape.localeCompare(b.shape));
}

/** Majority value of a style key (ties broken by name), or null. */
export function majority(stats: ShapeStats, key: string): string | null {
  const v = Object.entries(stats.styles[key] ?? {}).sort(([a, x], [b, y]) => y - x || a.localeCompare(b));
  return v[0]?.[0] ?? null;
}
