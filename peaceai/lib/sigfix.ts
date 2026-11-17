// A TypeScript diagnostic is a failing test when it is the runner's only result.
// TS2345 and TS2554 at one call of a source function can widen that parameter, add an
// optional parameter, or add an overload. The project must still type-check, and the
// test must pass at runtime. An `any` widening is refused. Third-party code runs only
// in the practice sandbox.
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

/** The wider parameter type. A readonly array or tuple replaces a mutable array of that element. Anything else is a union. */
export function widenParam(param: string, arg: string): string {
  const p = param.trim();
  const a = arg.trim();
  const mut = /^(.+)\[\]$/.exec(p);
  if (mut) {
    const elem = mut[1]!;
    if (a === `readonly ${elem}[]`) return a;
    const tuple = /^readonly \[([^\]]*)\]$/.exec(a);
    if (tuple) {
      const parts = tuple[1]!.split(",").map((s) => s.trim()).filter(Boolean);
      const element = (part: string) => part === elem || (elem === "number" && /^-?\d+(?:\.\d+)?$/.test(part)) || (elem === "string" && /^"(?:[^"\\]|\\.)*"$/.test(part));
      if (parts.length > 0 && parts.every(element)) return `readonly ${elem}[]`;
    }
  }
  if (p.split("|").map((s) => s.trim()).includes(a)) return p;
  return `${p} | ${a}`;
}

interface Plan {
  path: string;
  content: string;
  symbol: string;
  args: unknown[][];
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

function argTypeOf(node: ts.Expression): string | null {
  const v = literalArg(node);
  if (typeof v === "string") return "string";
  if (typeof v === "number") return "number";
  if (typeof v === "boolean") return "boolean";
  if (v === null) return "null";
  if (Array.isArray(v) && v.every((x) => typeof x === "number")) return "readonly number[]";
  if (Array.isArray(v) && v.every((x) => typeof x === "string")) return "readonly string[]";
  return null;
}

function relImport(fromFile: string, spec: string): string | null {
  if (!spec.startsWith(".")) return null;
  const base = normalize(join(dirname(fromFile), spec)).replace(/\\/g, "/");
  if (base.endsWith(".ts")) return base;
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

function signatureBeforeBody(hit: FnHit): { start: number; end: number } | null {
  const node = hit.node;
  if (!ts.isFunctionDeclaration(node) && !ts.isMethodDeclaration(node)) return null;
  if (!node.body) return null;
  return { start: node.getStart(hit.sf), end: node.body.getStart(hit.sf) };
}

function listed(root: string, diag: TypeDiagnostic, local: string, sourceOk: (path: string) => boolean): FnHit[] {
  const text = readLocal(root, diag.file);
  if (text === null) return [];
  return resolveFns(root, diag.file, text, local).filter((h) => sourceOk(h.path) || BAD_TARGET.test(h.path));
}

function onlyOne(hits: FnHit[]): FnHit | null {
  if (hits.length !== 1) return null; // sig-guard:one
  return hits[0] ?? null;
}

function rejectedTarget(hit: FnHit, sourceOk: (path: string) => boolean): boolean {
  if (BAD_TARGET.test(hit.path) || !sourceOk(hit.path)) return true; // sig-guard:target
  return false;
}

function rejectedType(types: readonly (string | null | undefined)[]): boolean {
  if (types.some((t) => !t || !safeType(t) || /\bany\b/.test(t))) return true; // sig-guard:any
  return false;
}

function planCall(root: string, diag: TypeDiagnostic, sourceOk: (path: string) => boolean): Plan | null {
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
  if (diag.code === "TS2345") {
    if (rejectedType([diag.argument, diag.parameter])) return null;
    const pos = offsetAt(sf, diag.line, diag.col);
    let index = call.arguments.findIndex((a) => a.getStart(sf) <= pos && pos <= a.getEnd());
    if (index < 0) return null;
    const param = hit.node.parameters[index];
    if (!param?.type) return null;
    const current = param.type.getText(hit.sf);
    if (current.replace(/\s+/g, "") !== diag.parameter!.replace(/\s+/g, "")) return null;
    const next = widenParam(current, diag.argument!);
    if (next === current) return null;
    const content = hit.text.slice(0, param.type.getStart(hit.sf)) + next + hit.text.slice(param.type.getEnd());
    return { path: hit.path, content, symbol: hit.name, args: concrete };
  }
  if (diag.code === "TS2554" && diag.expected !== undefined && diag.got !== undefined && diag.got > diag.expected) {
    const extra = call.arguments.slice(diag.expected);
    if (extra.length !== diag.got - diag.expected) return null;
    const types = extra.map(argTypeOf);
    if (rejectedType(types)) return null;
    if (hit.node.parameters.some((p) => p.dotDotDotToken)) return null;
    if ((!ts.isFunctionDeclaration(hit.node) && !ts.isMethodDeclaration(hit.node)) || !hit.node.body) return null;
    const from = hit.node.parameters.length ? hit.node.parameters[hit.node.parameters.length - 1]!.getEnd() : hit.node.getStart(hit.sf);
    const paren = hit.text.indexOf(")", from);
    if (paren < 0) return null;
    const names = new Set(hit.node.parameters.map((p) => p.name.getText(hit.sf)));
    const added = types.map((t, i) => { let n = `extra${i + 1}`; while (names.has(n)) n += "_"; names.add(n); return `${n}?: ${t}`; }).join(", ");
    const joiner = hit.node.parameters.length ? ", " : "";
    const content = hit.text.slice(0, paren) + joiner + added + hit.text.slice(paren);
    const span = signatureBeforeBody(hit);
    if (!span) return { path: hit.path, content, symbol: hit.name, args: concrete };
    const head = hit.text.slice(span.start, span.end).trimEnd() + ";";
    const withOver = content.slice(0, span.start) + head + "\n" + content.slice(span.start);
    return { path: hit.path, content: withOver, symbol: hit.name, args: concrete };
  }
  return null;
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
export function proposedSignature(root: string, output: string, sourcePattern?: string, denyPatterns?: readonly string[]): Plan | null {
  const diags = parseTypeDiagnostics(output).filter((d) => d.code === "TS2345" || d.code === "TS2554");
  const plans: Plan[] = [];
  for (const d of diags) {
    const plan = planCall(root, d, (path) => sourceOk(path, sourcePattern, denyPatterns));
    if (plan) plans.push(plan);
  }
  const unique = new Map<string, Plan>();
  for (const p of plans) unique.set(`${p.path}\0${p.symbol}\0${p.content}`, p);
  if (unique.size !== 1) return null;
  return [...unique.values()][0]!;
}

export function repairTypedFailure(input: RepairInput): { diff: string; symbol: string; file: string; args: unknown[][] } | null {
  const plan = proposedSignature(input.root, input.output, input.sourcePattern, input.denyPatterns);
  if (!plan) return null;
  const original = readLocal(input.root, plan.path);
  if (original === null || original === plan.content) return null;
  writeFileSync(join(input.root, plan.path), plan.content);
  try {
    if (typecheckRejected(input)) return null;
    const again = runInPracticeSandbox(input.root, input.testCommand, 60_000, {
      capture: true, nodePath: input.nodePath, nodeModules: input.nodeModules, ...(input.bwrap ? { bwrap: input.bwrap } : {}),
    });
    if (again.unsafe || again.code !== 0) return null;
    const diff = practiceGit(input.root, ["diff", "--no-color", "--no-ext-diff", "--no-renames", "--", plan.path]);
    if (!diff.ok || !diff.out.trim()) return null;
    return { diff: diff.out, symbol: plan.symbol, file: plan.path, args: plan.args };
  } finally {
    writeFileSync(join(input.root, plan.path), original);
  }
}
