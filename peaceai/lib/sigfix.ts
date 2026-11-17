// A TypeScript diagnostic is a failing test when it is the runner's only result.
// TS2345 at one call of a source function can widen a mutable array parameter to
// `readonly`. A union, and an extra optional parameter, are not edits: a union still
// type-checks bodies that do not handle the new member, and an optional parameter
// changes Function.length. The project must still type-check, and the test must pass.
// An `any` widening is refused. Third-party code runs only in the practice sandbox.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, normalize } from "node:path";
import ts from "typescript";
import { practiceGit, runInPracticeSandbox } from "./practicemine.ts";

export interface TypeDiagnostic {
  file: string;
  line: number;
  col: number;
  code: string;
  message: string;
  /** TS2345 argument type text, when the message names one. */
  argument?: string;
  /** TS2345 parameter type text, when the message names one. */
  parameter?: string;
  /** TS2554. */
  expected?: number;
  got?: number;
}

const DIAG = /^(?:(?<fileA>[^\s()][^\n()]*?)\((?<lineA>\d+),(?<colA>\d+)\): error (?<codeA>TS\d+): (?<msgA>.*)|(?<fileB>[^\s:][^\n:]*):(?<lineB>\d+):(?<colB>\d+) - error (?<codeB>TS\d+): (?<msgB>.*))$/;
const CODES = new Set(["TS2345", "TS2322", "TS2554", "TS2339", "TS2769", "TS2741", "TS2322"]);

/** Every TypeScript diagnostic line in a runner log. Follow-up lines are not diagnostics. */
export function parseTypeDiagnostics(output: string): TypeDiagnostic[] {
  const out: TypeDiagnostic[] = [];
  for (const raw of output.split("\n")) {
    const line = raw.trim();
    const m = DIAG.exec(line);
    if (!m || !m.groups) continue;
    const g = m.groups;
    const code = g.codeA ?? g.codeB ?? "";
    if (!CODES.has(code)) continue;
    const message = (g.msgA ?? g.msgB ?? "").trim();
    const row: TypeDiagnostic = {
      file: (g.fileA ?? g.fileB ?? "").replace(/\\/g, "/"),
      line: Number(g.lineA ?? g.lineB),
      col: Number(g.colA ?? g.colB),
      code,
      message,
    };
    const arg = /Argument of type '(.*)' is not assignable to parameter of type '(.*)'\./.exec(message);
    if (arg) { row.argument = arg[1]; row.parameter = arg[2]; }
    const count = /Expected (\d+)(?:-(\d+))? arguments?, but got (\d+)\./.exec(message);
    if (count) { row.expected = Number(count[2] ?? count[1]); row.got = Number(count[3]); }
    out.push(row);
  }
  return out;
}

const HELPER = /(?:^|\/)(?:helpers?|__helpers__|support|test-utils|__testutils__)(?:\/|$|\.tsx?$)/i;
const BAD_TARGET = /(?:^|\/)(?:vendor|vendored|third_party|third-party|generated|__generated__|dist|build|coverage|fixtures?|node_modules)(?:\/|$)|\.d\.ts$|\.(?:generated|gen)\.ts$/i;
const TEST_FILE = /\.(?:test|spec)\.tsx?$|(?:^|\/)(?:__tests__|tests?)(?:\/|$)/i;

function safeType(text: string): boolean {
  const t = text.trim();
  if (!t || t.length > 240) return false;
  const stripped = t
    .replace(/"(?:[^"\\]|\\.)*"/g, "")
    .replace(/'(?:[^'\\]|\\.)*'/g, "")
    .replace(/\b(?:readonly|string|number|boolean|bigint|symbol|undefined|null|void|never|unknown|object)\b/g, "")
    .replace(/[A-Za-z_$][\w$]*/g, "")
    .replace(/[0-9]+/g, "")
    .replace(/[\[\]()<>{},|&?.\s]/g, "");
  return stripped.length === 0;
}

/**
 * `T[]` becomes `readonly T[]` when the argument is already that readonly array,
 * or a readonly tuple whose elements are that element type. Every other pair is
 * refused, including a union such as `string | number`.
 */
export function widenParam(param: string, arg: string): string | null {
  const p = param.trim();
  const a = arg.trim();
  const mut = /^(.+)\[\]$/.exec(p);
  if (!mut) return null;
  const elem = mut[1]!;
  if (a === `readonly ${elem}[]`) return a;
  const tuple = /^readonly \[([^\]]*)\]$/.exec(a);
  if (!tuple) return null;
  const parts = tuple[1]!.split(",").map((s) => s.trim()).filter(Boolean);
  const element = (part: string) => part === elem || (elem === "number" && /^-?\d+(?:\.\d+)?$/.test(part)) || (elem === "string" && /^"(?:[^"\\]|\\.)*"$/.test(part));
  if (parts.length > 0 && parts.every(element)) return `readonly ${elem}[]`;
  return null;
}

interface Plan {
  path: string;
  content: string;
  symbol: string;
  args: unknown[][];
}

interface Span {
  path: string;
  start: number;
  end: number;
  insert: string;
  symbol: string;
  args: unknown[][];
  text: string;
}

function offsetAt(sf: ts.SourceFile, line: number, col: number): number {
  const lc = Math.min(line - 1, sf.getLineStarts().length - 1);
  return sf.getPositionOfLineAndCharacter(Math.max(0, lc), Math.max(0, col - 1));
}

function callAt(sf: ts.SourceFile, pos: number): ts.CallExpression | null {
  function visit(node: ts.Node): ts.CallExpression | null {
    if (pos < node.getStart(sf) || pos > node.getEnd()) return null;
    let nested: ts.CallExpression | null = null;
    ts.forEachChild(node, (child) => { const hit = visit(child); if (hit) nested = hit; });
    if (nested) return nested;
    return ts.isCallExpression(node) ? node : null;
  }
  return visit(sf);
}

function calleeName(call: ts.CallExpression): { local: string; imported?: string } | null {
  const e = call.expression;
  if (ts.isIdentifier(e)) return { local: e.text };
  if (ts.isPropertyAccessExpression(e) && (ts.isIdentifier(e.expression) || e.expression.kind === ts.SyntaxKind.ThisKeyword)) return { local: e.name.text };
  return null;
}

function literalArg(node: ts.Expression): unknown {
  if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isTypeAssertionExpression(node) || ts.isSatisfiesExpression(node)) return literalArg(node.expression);
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isNumericLiteral(node)) return Number(node.text);
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (node.kind === ts.SyntaxKind.NullKeyword) return null;
  if (ts.isArrayLiteralExpression(node)) {
    const items: unknown[] = [];
    for (const el of node.elements) {
      if (ts.isSpreadElement(el)) return undefined;
      const v = literalArg(el);
      if (v === undefined && !ts.isIdentifier(el)) return undefined;
      if (v === undefined) return undefined;
      items.push(v);
    }
    return items;
  }
  return undefined;
}

function relImport(fromFile: string, spec: string): string | null {
  if (!spec.startsWith(".")) return null;
  const base = normalize(join(dirname(fromFile), spec)).replace(/\\/g, "/");
  if (base.endsWith(".ts")) return base;
  if (base.endsWith(".js")) return `${base.slice(0, -3)}.ts`;
  return `${base}.ts`;
}

interface FnHit { path: string; name: string; node: ts.FunctionDeclaration | ts.MethodDeclaration | ts.ArrowFunction | ts.FunctionExpression; sf: ts.SourceFile; text: string }

function functionsIn(path: string, text: string, name: string): FnHit[] {
  const sf = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const out: FnHit[] = [];
  const addFn = (node: ts.Node, fnName: string | undefined) => {
    if (fnName !== name) return;
    if (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node)) out.push({ path, name, node, sf, text });
  };
  const visit = (node: ts.Node): void => {
    if (ts.isFunctionDeclaration(node)) addFn(node, node.name?.text);
    else if (ts.isMethodDeclaration(node)) addFn(node, node.name && ts.isIdentifier(node.name) ? node.name.text : undefined);
    else if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))) addFn(node.initializer, node.name.text);
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

function readLocal(root: string, path: string): string | null {
  try { return readFileSync(join(root, path), "utf8"); } catch { return null; }
}

function resolveFns(root: string, from: string, text: string, local: string, imported?: string): FnHit[] {
  const sf = ts.createSourceFile(from, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const hits: FnHit[] = [];
  const want = imported ?? local;
  if (!TEST_FILE.test(from)) hits.push(...functionsIn(from, text, want));
  for (const st of sf.statements) {
    if (!ts.isImportDeclaration(st) || !st.importClause || !ts.isStringLiteral(st.moduleSpecifier)) continue;
    const spec = st.moduleSpecifier.text;
    const named = st.importClause.namedBindings;
    let importedName: string | undefined;
    if (named && ts.isNamedImports(named)) {
      for (const el of named.elements) if (el.name.text === local) importedName = (el.propertyName ?? el.name).text;
    } else if (st.importClause.name?.text === local) importedName = "default";
    if (!importedName) continue;
    const path = relImport(from, spec);
    if (!path) continue;
    const body = readLocal(root, path);
    if (body === null) continue;
    if (importedName === "default") {
      const psf = ts.createSourceFile(path, body, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
      for (const s of psf.statements) if (ts.isFunctionDeclaration(s) && s.modifiers?.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword)) hits.push({ path, name: s.name?.text ?? "default", node: s, sf: psf, text: body });
    } else hits.push(...functionsIn(path, body, importedName));
  }
  return hits;
}

function listed(root: string, diag: TypeDiagnostic, local: string, sourceOk: (path: string) => boolean): FnHit[] {
  const text = readLocal(root, diag.file);
  if (text === null) return [];
  return resolveFns(root, diag.file, text, local).filter((h) => sourceOk(h.path) || BAD_TARGET.test(h.path));
}

function onlyOne(hits: FnHit[]): FnHit | null {
  const bodies = hits.filter((h) => h.node.body);
  if (bodies.length !== 1) return null; // sig-guard:one
  const body = bodies[0]!;
  if (hits.some((h) => h.name !== body.name || h.path !== body.path)) return null;
  return body;
}

function rejectedTarget(hit: FnHit, sourceOk: (path: string) => boolean): boolean {
  if (BAD_TARGET.test(hit.path) || !sourceOk(hit.path)) return true; // sig-guard:target
  return false;
}

function rejectedType(types: readonly (string | null | undefined)[]): boolean {
  if (types.some((t) => !t || !safeType(t) || /\bany\b/.test(t))) return true; // sig-guard:any
  return false;
}

function planCall(root: string, diag: TypeDiagnostic, sourceOk: (path: string) => boolean): Span[] | null {
  if (HELPER.test(diag.file)) return null; // sig-guard:helper
  const text = readLocal(root, diag.file);
  if (text === null) return null;
  const sf = ts.createSourceFile(diag.file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const call = callAt(sf, offsetAt(sf, diag.line, diag.col));
  if (!call) return null;
  const name = calleeName(call);
  if (!name) return null;
  const args = call.arguments.map(literalArg);
  const concrete = args.every((a) => a !== undefined) ? [args as unknown[]] : [];
  const hit = onlyOne(listed(root, diag, name.local, sourceOk));
  if (!hit || rejectedTarget(hit, sourceOk)) return null;
  if (diag.code === "TS2345" || diag.code === "TS2769") {
    const pos = offsetAt(sf, diag.line, diag.col);
    const index = call.arguments.findIndex((a) => a.getStart(sf) <= pos && pos <= a.getEnd());
    if (index < 0) return null;
    if (diag.code === "TS2769" || ((diag.argument ?? "").includes("=>") && (diag.parameter ?? "").includes("=>"))) {
      if (/\bany\b/.test(`${diag.argument ?? ""} ${diag.parameter ?? ""}`)) return null;
      return predicateSpans(root, hit, index, concrete);
    }
    if (rejectedType([diag.argument, diag.parameter])) return null;
    const param = hit.node.parameters[index];
    if (!param?.type) return null;
    const current = param.type.getText(hit.sf);
    if (current.replace(/\s+/g, "") !== diag.parameter!.replace(/\s+/g, "")) return null;
    const next = widenParam(current, diag.argument!);
    if (!next || next === current) return null;
    return [{ path: hit.path, start: param.type.getStart(hit.sf), end: param.type.getEnd(), insert: next, symbol: hit.name, args: concrete, text: hit.text }];
  }
  return null;
}

/** A `=> boolean` callback used only as a condition may return `unknown`. A returned or compared result may not. */
function predicateSpans(root: string, hit: FnHit, index: number, concrete: unknown[][]): Span[] | null {
  if (!hit.node.body || !truthyOnly(hit.node, hit.node.parameters[index]?.name)) return null; // sig-guard:predicate
  const text = readLocal(root, hit.path);
  if (text === null) return null;
  const sf = ts.createSourceFile(hit.path, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const spans: Span[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isFunctionDeclaration(node) && node.name?.text === hit.name && node.parameters[index]?.type) {
      const ret = booleanReturn(node.parameters[index]!.type!);
      if (ret) spans.push({ path: hit.path, start: ret.getStart(sf), end: ret.getEnd(), insert: "unknown", symbol: hit.name, args: concrete, text });
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return spans.length ? spans : null;
}

function booleanReturn(type: ts.TypeNode): ts.Node | null {
  if (!ts.isFunctionTypeNode(type) || !type.type || type.type.kind !== ts.SyntaxKind.BooleanKeyword) return null;
  return type.type;
}

function truthyOnly(fn: ts.FunctionLikeDeclaration, name: ts.BindingName | undefined): boolean {
  if (!name || !ts.isIdentifier(name) || !fn.body) return false;
  const id = name.text;
  let seen = 0;
  let ok = true;
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node) && node.text === id && !(ts.isParameter(node.parent) && node.parent.name === node)) {
      seen += 1;
      const call = node.parent;
      if (!ts.isCallExpression(call) || call.expression !== node || !isTruthyUse(call)) ok = false;
    }
    ts.forEachChild(node, visit);
  };
  visit(fn.body);
  return ok && seen > 0;
}

function isTruthyUse(call: ts.CallExpression): boolean {
  let node: ts.Node = call;
  if (ts.isPrefixUnaryExpression(node.parent) && node.parent.operator === ts.SyntaxKind.ExclamationToken && node.parent.operand === node) node = node.parent;
  while (ts.isParenthesizedExpression(node.parent) && node.parent.expression === node) node = node.parent;
  while (ts.isBinaryExpression(node.parent) && (node.parent.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken || node.parent.operatorToken.kind === ts.SyntaxKind.BarBarToken) && (node.parent.left === node || node.parent.right === node)) node = node.parent;
  const parent = node.parent;
  if (ts.isIfStatement(parent) && parent.expression === node) return true;
  if (ts.isWhileStatement(parent) && parent.expression === node) return true;
  if (ts.isDoStatement(parent) && parent.expression === node) return true;
  if (ts.isForStatement(parent) && parent.condition === node) return true;
  if (ts.isConditionalExpression(parent) && parent.condition === node) return true;
  return false;
}

function applySpans(text: string, spans: readonly Span[]): string {
  let out = text;
  for (const span of [...spans].sort((a, b) => b.start - a.start)) out = out.slice(0, span.start) + span.insert + out.slice(span.end);
  return out;
}

export interface RepairInput {
  root: string;
  output: string;
  sourcePattern?: string;
  denyPatterns?: readonly string[];
  nodePath: string;
  nodeModules?: string | null;
  testCommand: readonly string[];
  bwrap?: string;
}

function sourceOk(path: string, pattern: string | undefined, deny: readonly string[] | undefined): boolean {
  if (TEST_FILE.test(path) || BAD_TARGET.test(path)) return false;
  if (pattern && !new RegExp(pattern).test(path)) return false;
  if (deny?.some((d) => new RegExp(d).test(path))) return false;
  return true;
}

function projectCheck(input: RepairInput): { unsafe: boolean; code: number | null; stdout: string } {
  return runInPracticeSandbox(input.root, [input.nodePath, "node_modules/typescript/lib/tsc.js", "--noEmit", "--pretty", "false", "--strict", "-p", "tsconfig.json"], 60_000, {
    capture: true, nodePath: input.nodePath, nodeModules: input.nodeModules, ...(input.bwrap ? { bwrap: input.bwrap } : {}),
  });
}

/** True when the project type-check did not succeed. A missing sandbox is a failure. */
export function typecheckRejected(input: RepairInput): boolean {
  const checked = projectCheck(input);
  let bad = checked.code !== 0 && checked.code !== null;
  if (checked.unsafe) bad = true; // sig-guard:bwrap
  return bad;
}

/**
 * One signature edit for a type-diagnostic failure, then `tsc` and the test, both in the sandbox.
 * Null when the diagnostic is not a single safe widening, the project no longer type-checks, or the test still fails.
 */
function readonlySpans(root: string, output: string, sourcePattern?: string, denyPatterns?: readonly string[]): Span[] | null {
  const diags = parseTypeDiagnostics(output).filter((d) => d.code === "TS2345" || d.code === "TS2769");
  if (!diags.length) return null;
  const spans: Span[] = [];
  for (const diag of diags) {
    const planned = planCall(root, diag, (path) => sourceOk(path, sourcePattern, denyPatterns));
    if (!planned?.length) return null;
    spans.push(...planned);
  }
  return spans;
}

export function proposedSignature(root: string, output: string, sourcePattern?: string, denyPatterns?: readonly string[]): Plan | null {
  const spans = readonlySpans(root, output, sourcePattern, denyPatterns);
  if (!spans || spans.length !== 1) return null;
  const span = spans[0]!;
  return { path: span.path, content: applySpans(span.text, spans), symbol: span.symbol, args: span.args };
}

export function repairTypedFailure(input: RepairInput): { diff: string; symbol: string; file: string; args: unknown[][] } | null {
  const spans = readonlySpans(input.root, input.output, input.sourcePattern, input.denyPatterns);
  if (!spans) return null;
  const byPath = new Map<string, Span[]>();
  for (const span of spans) byPath.set(span.path, [...(byPath.get(span.path) ?? []), span]);
  const originals = new Map<string, string>();
  try {
    for (const [path, group] of byPath) {
      const original = readLocal(input.root, path);
      if (original === null) return null;
      originals.set(path, original);
      const content = applySpans(group[0]!.text, group);
      if (content === original) return null;
      writeFileSync(join(input.root, path), content);
    }
    if (typecheckRejected(input)) return null;
    const again = runInPracticeSandbox(input.root, input.testCommand, 60_000, {
      capture: true, nodePath: input.nodePath, nodeModules: input.nodeModules, ...(input.bwrap ? { bwrap: input.bwrap } : {}),
    });
    if (again.unsafe || again.code !== 0) return null;
    const paths = [...byPath.keys()];
    const diff = practiceGit(input.root, ["diff", "--no-color", "--no-ext-diff", "--no-renames", "--", ...paths]);
    if (!diff.ok || !diff.out.trim()) return null;
    const first = spans[0]!;
    return { diff: diff.out, symbol: first.symbol, file: first.path, args: first.args };
  } finally {
    for (const [path, original] of originals) writeFileSync(join(input.root, path), original);
  }
}
