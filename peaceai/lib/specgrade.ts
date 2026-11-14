// Grader-owned behavioral check. credit: false.
// The solver never calls this. After a candidate has already passed the given test and the original
// suite, this loads that symbol and the fix's copy of the same symbol in separate sandboxes and
// compares them on the test's concrete arguments plus general mutations of those arguments.
//
// verified_strict means the return value, the arguments after the call, and any thrown error name
// and message agreed on the test's own inputs and on at least one mutated input. NaN matches NaN.
// -0 does not match 0, and Infinity does not match -Infinity. It does not prove every input, and it
// does not prove the source matches the fix. A constant that only matches the thin test comes back
// verified_test_only. A symbol that cannot be imported on its own, or that returns a function, a
// class instance, or any other opaque value, comes back diff_unavailable and is never treated as strict.
// The probe line carries a per-run nonce. A hardcoded sentinel printed by the candidate is ignored.
import { randomBytes } from "node:crypto";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { runInPracticeSandbox } from "./practicemine.ts";
import type { CallForm } from "./testspec.ts";

export const INPUT_CAP = 50;
/** Boundary probes do not compete with the mutant budget. */
export const PROBE_CAP = 48;
export const BEHAVIORS = ["verified_strict", "verified_test_only", "diff_unavailable"] as const;
export type Behavior = (typeof BEHAVIORS)[number];
/** Static prefix a candidate might print. The grader does not accept a line that has only this. */
export const PROBE_SENTINEL = "PEACEAI_BEHAVIOR_PROBE_v1 ";

export interface BehaviorTarget {
  symbol: string;
  file: string;
  form: CallForm;
  exportName: string;
  prop?: string;
  args: unknown[][];
}

export interface BehaviorCounterexample {
  args: string;
  candidate: string;
  fix: string;
}

export interface BehaviorGrade {
  behavior: Behavior;
  compared: number;
  counterexample?: BehaviorCounterexample;
}

interface ParamFlags { nulls: boolean; undef: boolean }

const PROBE = `
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
const spec = JSON.parse(readFileSync(process.argv[2], "utf8"));
const untag = (v) => {
  if (!v || typeof v !== "object" || !("k" in v)) return v;
  if (v.k === "nan") return NaN;
  if (v.k === "neg0") return -0;
  if (v.k === "pinf") return Infinity;
  if (v.k === "ninf") return -Infinity;
  if (v.k === "undef") return undefined;
  if (v.k === "null") return null;
  if (v.k === "a") return v.v.map(untag);
  if (v.k === "o") { const o = {}; for (const [key, val] of Object.entries(v.v)) o[key] = untag(val); return o; }
  if (v.k === "date") return new Date(v.v);
  if (v.k === "set") return new Set((v.v || []).map(untag));
  if (v.k === "map") return new Map((v.v || []).map((pair) => [untag(pair[0]), untag(pair[1])]));
  return v.v;
};
const seen = new WeakSet();
const pack = (value) => {
  if (typeof value === "undefined") return { k: "undef" };
  if (typeof value === "number" && Number.isNaN(value)) return { k: "nan" };
  if (typeof value === "number" && Object.is(value, -0)) return { k: "neg0" };
  if (value === Infinity) return { k: "pinf" };
  if (value === -Infinity) return { k: "ninf" };
  if (value === null) return { k: "null" };
  if (typeof value === "string" || typeof value === "boolean" || typeof value === "number") return { k: "v", v: value };
  if (typeof value === "function" || typeof value === "symbol" || typeof value === "bigint") return { k: "opaque", why: typeof value };
  if (typeof value !== "object") return { k: "opaque", why: typeof value };
  if (seen.has(value)) return { k: "opaque", why: "cycle" };
  seen.add(value);
  if (value instanceof Date) {
    const time = value.getTime();
    return { k: "date", v: Number.isNaN(time) ? null : time };
  }
  if (value instanceof Map) return { k: "map", v: [...value.entries()].map((pair) => [pack(pair[0]), pack(pair[1])]) };
  if (value instanceof Set) return { k: "set", v: [...value].map(pack) };
  if (Array.isArray(value)) return { k: "a", v: value.map(pack) };
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return { k: "opaque", why: "instance" };
  const o = {};
  for (const key of Object.keys(value).sort()) o[key] = pack(value[key]);
  return { k: "o", v: o };
};
const marker = String(spec.nonce || "") + " ";
if (marker.trim().length < 8) { process.exit(0); }
let mod;
try { mod = await import(pathToFileURL(spec.file).href); }
catch { console.log(marker + JSON.stringify({ load: "error" })); process.exit(0); }
let fn = spec.form === "default" || spec.form === "default-prop" ? mod.default : mod[spec.exportName];
if (spec.form === "default-prop" || spec.form === "named-prop") fn = fn?.[spec.prop];
if (typeof fn !== "function") { console.log(marker + JSON.stringify({ load: "not-a-function" })); process.exit(0); }
const thrownInfo = (err) => ({
  name: err && typeof err === "object" && "name" in err ? String(err.name) : "Error",
  message: err && typeof err === "object" && "message" in err ? String(err.message) : "",
});
const results = [];
for (const args of spec.inputs) {
  const values = args.map(untag);
  try {
    let value = fn(...values);
    for (let n = 0; n < 4 && value && typeof value.then === "function"; n++) value = await value;
    results.push({ thrown: false, value: pack(value), args: values.map(pack) });
  } catch (err) { results.push({ thrown: true, error: thrownInfo(err), args: values.map(pack) }); }
}
console.log(marker + JSON.stringify({ load: "ok", results }));
`;

function tag(value: unknown): unknown {
  if (typeof value === "undefined") return { k: "undef" };
  if (typeof value === "number" && Number.isNaN(value)) return { k: "nan" };
  if (typeof value === "number" && Object.is(value, -0)) return { k: "neg0" };
  if (value === Infinity) return { k: "pinf" };
  if (value === -Infinity) return { k: "ninf" };
  if (value === null) return { k: "null" };
  if (typeof value === "string" || typeof value === "boolean" || typeof value === "number") return { k: "v", v: value };
  if (typeof value === "function" || typeof value === "symbol" || typeof value === "bigint") return { k: "opaque", why: typeof value };
  if (value instanceof Date) {
    const time = value.getTime();
    return { k: "date", v: Number.isNaN(time) ? null : time };
  }
  if (value instanceof Set) return { k: "set", v: [...value].map(tag) };
  if (value instanceof Map) return { k: "map", v: [...value.entries()].map((pair) => [tag(pair[0]), tag(pair[1])]) };
  if (Array.isArray(value)) return { k: "a", v: value.map(tag) };
  if (typeof value === "object") {
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) return { k: "opaque", why: "instance" };
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) out[key] = tag(item);
    return { k: "o", v: out };
  }
  return { k: "opaque", why: typeof value };
}

function seedOf(text: string): number {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
  return hash >>> 0;
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(items: readonly T[], seed: number): T[] {
  const out = [...items];
  const rand = mulberry32(seed);
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const swap = out[i]!;
    out[i] = out[j]!;
    out[j] = swap;
  }
  return out;
}

function keyOf(args: unknown[]): string {
  return JSON.stringify(args.map(tag));
}

function plainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function everyNumericIsInteger(examples: readonly (readonly unknown[])[]): boolean {
  const walk = (value: unknown): boolean => {
    if (typeof value === "number") return Number.isInteger(value);
    if (Array.isArray(value)) return value.every(walk);
    if (value && typeof value === "object") return Object.values(value as Record<string, unknown>).every(walk);
    return true;
  };
  return examples.every((args) => args.every(walk));
}

function mutants(value: unknown, flags: ParamFlags | undefined, depth = 0, fractional = false): unknown[] {
  const out: unknown[] = [];
  if (typeof value === "number" && Number.isFinite(value)) {
    // Classic mutants stay ahead of half-steps. Half-steps do not replace 0, negation, or NaN,
    // and they do not separate every pair of thresholds.
    out.push(value + 1, value - 1, 0, Object.is(value, 0) ? -0 : -Math.abs(value), Number.NaN);
    if (Object.is(value, 0)) out.push(-0);
    if (fractional && Number.isInteger(value)) out.push(value + 0.5, value - 0.5, value + 0.25, value - 0.25, 0.5);
  }
  else if (typeof value === "string") {
    const flipped = [...value].map((ch) => ch === ch.toLowerCase() ? ch.toUpperCase() : ch.toLowerCase()).join("");
    out.push("", flipped, `${value}x`);
    if (value.length > 0) out.push(value.slice(0, -1));
  } else if (Array.isArray(value)) {
    out.push([]);
    if (value.length > 0) out.push([value[0]], value.slice(1), [...value, value[value.length - 1]]);
    if (value.length > 1) out.push(value.slice(0, -1), [...value].reverse());
    if (depth < 2) {
      value.forEach((item, index) => {
        for (const next of mutants(item, undefined, depth + 1, fractional)) {
          const copy = [...value];
          copy[index] = next;
          out.push(copy);
        }
      });
    }
  } else if (plainObject(value) && depth < 2) {
    for (const [key, item] of Object.entries(value)) {
      for (const next of mutants(item, undefined, depth + 1, fractional)) out.push({ ...value, [key]: next });
    }
    out.push({});
  } else if (typeof value === "boolean") out.push(!value);
  if (flags?.nulls) out.push(null);
  if (flags?.undef) out.push(undefined);
  return out;
}

function paramFlags(source: string, symbol: string): ParamFlags[] {
  const sf = ts.createSourceFile("candidate.ts", source, ts.ScriptTarget.Latest, true);
  const flagsOf = (params: readonly ts.ParameterDeclaration[]): ParamFlags[] => params.map((param) => {
    const text = param.type ? param.type.getText(sf).replace(/\s+/g, "") : "";
    const loose = text === "any" || text === "unknown";
    return { nulls: loose || text.split("|").includes("null"), undef: Boolean(param.questionToken) || loose || text.split("|").includes("undefined") };
  });
  for (const st of sf.statements) {
    if (ts.isFunctionDeclaration(st) && st.name?.text === symbol) return flagsOf(st.parameters);
    if (ts.isVariableStatement(st)) for (const decl of st.declarationList.declarations) {
      if (!ts.isIdentifier(decl.name) || decl.name.text !== symbol || !decl.initializer) continue;
      const init = decl.initializer;
      if (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) return flagsOf(init.parameters);
    }
  }
  return [];
}

function numericLiteral(node: ts.Node): number | null {
  const cur = unwrapExpr(node);
  if (ts.isNumericLiteral(cur)) return Number(cur.text);
  if (ts.isPrefixUnaryExpression(cur) && cur.operator === ts.SyntaxKind.MinusToken && ts.isNumericLiteral(cur.operand)) return -Number(cur.operand.text);
  if (ts.isBinaryExpression(cur) && cur.operatorToken.kind === ts.SyntaxKind.SlashToken) {
    const left = numericLiteral(cur.left);
    const right = numericLiteral(cur.right);
    if (left !== null && right !== null && right !== 0 && Number.isFinite(left / right)) return left / right;
  }
  return null;
}

function isLengthAccess(node: ts.Expression): boolean {
  return ts.isPropertyAccessExpression(node) && node.name.text === "length";
}

function isNonNumericLiteral(node: ts.Node): boolean {
  return ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)
    || node.kind === ts.SyntaxKind.TrueKeyword || node.kind === ts.SyntaxKind.FalseKeyword
    || node.kind === ts.SyntaxKind.NullKeyword;
}

/** A string such as `"0.3"` hides the same number a numeric literal would. `"number"` does not. */
function numericText(text: string): number | null {
  const trimmed = text.trim();
  // The match must consume the whole string. "0.3abc" is not 0.3.
  const match = /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:e[+-]?\d+)?/i.exec(trimmed);
  if (!match || match[0].length !== trimmed.length) return null;
  const n = Number(match[0]);
  return Number.isFinite(n) ? n : null;
}

function numericString(node: ts.Node): number | null {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return numericText(node.text);
  return null;
}

function unwrapExpr(node: ts.Node): ts.Node {
  let cur = node;
  while (ts.isParenthesizedExpression(cur) || ts.isAsExpression(cur) || ts.isTypeAssertionExpression(cur) || ts.isSatisfiesExpression(cur)) cur = cur.expression;
  return cur;
}

function stringText(node: ts.Node): string | null {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  return null;
}

const TYPEOF_NAMES = new Set(["number", "string", "boolean", "undefined", "object", "function", "symbol", "bigint"]);

/** An import, a reassigned let, a destructure, or an unknown spread is not trusted. */
let importedNames = new Set<string>();
let unresolvedBinding = false;

function bindsName(name: ts.BindingName, target: string): boolean {
  if (ts.isIdentifier(name)) return name.text === target;
  if (ts.isObjectBindingPattern(name) || ts.isArrayBindingPattern(name)) {
    return name.elements.some((el) => !ts.isOmittedExpression(el) && bindsName(el.name, target));
  }
  return false;
}

function assignedLater(name: string, decl: ts.VariableDeclaration): boolean {
  let scope: ts.Node = decl;
  while (scope.parent && !ts.isFunctionLike(scope) && !ts.isSourceFile(scope)) scope = scope.parent;
  let found = false;
  const visit = (node: ts.Node) => {
    if (node === decl) return;
    if (ts.isBinaryExpression(node) && node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && node.operatorToken.kind <= ts.SyntaxKind.LastAssignment && ts.isIdentifier(node.left) && node.left.text === name) found = true;
    if ((ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) && (node.operator === ts.SyntaxKind.PlusPlusToken || node.operator === ts.SyntaxKind.MinusMinusToken) && ts.isIdentifier(node.operand) && node.operand.text === name) found = true;
    if (!found) ts.forEachChild(node, visit);
  };
  visit(scope);
  return found;
}

function bindingAt(at: ts.Node, name: string): { init: ts.Expression | null; opaque: boolean } | null {
  let cur: ts.Node | undefined = at.parent;
  while (cur) {
    const stmts = ts.isSourceFile(cur) || ts.isBlock(cur) || ts.isModuleBlock(cur) ? cur.statements : null;
    if (stmts) {
      for (const st of stmts) {
        if (!ts.isVariableStatement(st)) continue;
        for (const decl of st.declarationList.declarations) {
          if (ts.isIdentifier(decl.name) && decl.name.text === name) {
            const isConst = (st.declarationList.flags & ts.NodeFlags.Const) !== 0;
            if (!decl.initializer || (!isConst && assignedLater(name, decl))) return { init: null, opaque: true };
            return { init: decl.initializer, opaque: false };
          }
          if (!ts.isIdentifier(decl.name) && bindsName(decl.name, name)) return { init: null, opaque: true };
        }
      }
    }
    cur = cur.parent;
  }
  return null;
}

function remember(text: string, numbers: number[], strings: string[]): void {
  strings.push(text);
  if (text === "Infinity") numbers.push(Number.POSITIVE_INFINITY);
  else if (text === "-Infinity") numbers.push(Number.NEGATIVE_INFINITY);
  else if (text === "NaN") numbers.push(Number.NaN);
  else {
    const n = numericText(text);
    if (n !== null) numbers.push(n);
  }
}

/** Numbers and strings written in an array, a Set or Map, an object key, or a same-file binding. */
function collectLiteralNumbers(node: ts.Node, numbers: number[], strings: string[], seen = new Set<string>()): void {
  const cur = unwrapExpr(node);
  if (ts.isIdentifier(cur)) {
    if (seen.has(cur.text)) return;
    if (importedNames.has(cur.text)) { unresolvedBinding = true; return; }
    const found = bindingAt(cur, cur.text);
    if (!found) return;
    if (found.opaque || !found.init) { unresolvedBinding = true; return; }
    seen.add(cur.text);
    collectLiteralNumbers(found.init, numbers, strings, seen);
    return;
  }
  if (ts.isPropertyAccessExpression(cur)) {
    const obj = unwrapExpr(cur.expression);
    const init = ts.isIdentifier(obj) ? bindingAt(obj, obj.text)?.init : null;
    const literal = init ? unwrapExpr(init) : obj;
    if (ts.isObjectLiteralExpression(literal)) {
      for (const prop of literal.properties) {
        if (!ts.isPropertyAssignment(prop)) continue;
        const key = ts.isIdentifier(prop.name) || ts.isStringLiteral(prop.name) || ts.isNumericLiteral(prop.name) ? prop.name.text : null;
        if (key === cur.name.text) collectLiteralNumbers(prop.initializer, numbers, strings, seen);
      }
      return;
    }
    unresolvedBinding = true;
    return;
  }
  if (ts.isSpreadElement(cur)) {
    const expr = unwrapExpr(cur.expression);
    const init = ts.isIdentifier(expr) ? bindingAt(expr, expr.text) : null;
    const literal = init?.init && !init.opaque ? unwrapExpr(init.init) : expr;
    if (ts.isArrayLiteralExpression(literal) || ts.isObjectLiteralExpression(literal)) {
      collectLiteralNumbers(literal, numbers, strings, seen);
      return;
    }
    unresolvedBinding = true;
    return;
  }
  const direct = numericLiteral(cur);
  if (direct !== null && Number.isFinite(direct)) { numbers.push(direct); return; }
  const text = stringText(cur);
  if (text !== null) { remember(text, numbers, strings); return; }
  if (ts.isArrayLiteralExpression(cur)) {
    for (const el of cur.elements) collectLiteralNumbers(el, numbers, strings, seen);
    return;
  }
  if (ts.isObjectLiteralExpression(cur)) {
    for (const prop of cur.properties) {
      if (!ts.isPropertyAssignment(prop)) continue;
      if (ts.isNumericLiteral(prop.name) || ts.isStringLiteral(prop.name) || ts.isIdentifier(prop.name)) remember(prop.name.text, numbers, strings);
      collectLiteralNumbers(prop.initializer, numbers, strings, seen);
    }
    return;
  }
  if (ts.isNewExpression(cur) && cur.arguments) {
    for (const arg of cur.arguments) collectLiteralNumbers(arg, numbers, strings, seen);
  }
}

function collectAllNumbers(node: ts.Node, numbers: number[]): void {
  const n = numericLiteral(node) ?? numericString(node);
  if (n !== null && Number.isFinite(n)) numbers.push(n);
  ts.forEachChild(node, (child) => collectAllNumbers(child, numbers));
}

function stripIntegerize(node: ts.Node): ts.Node {
  let cur = unwrapExpr(node);
  if (ts.isPrefixUnaryExpression(cur) && cur.operator === ts.SyntaxKind.TildeToken) {
    const inner = unwrapExpr(cur.operand);
    if (ts.isPrefixUnaryExpression(inner) && inner.operator === ts.SyntaxKind.TildeToken) return unwrapExpr(inner.operand);
  }
  if (ts.isCallExpression(cur) && ts.isPropertyAccessExpression(cur.expression) && ts.isIdentifier(cur.expression.name) && (cur.expression.name.text === "floor" || cur.expression.name.text === "trunc") && ts.isIdentifier(cur.expression.expression) && cur.expression.expression.text === "Math" && cur.arguments[0]) return unwrapExpr(cur.arguments[0]);
  if (ts.isBinaryExpression(cur) && (cur.operatorToken.kind === ts.SyntaxKind.BarToken || cur.operatorToken.kind === ts.SyntaxKind.GreaterThanGreaterThanToken) && numericLiteral(cur.right) === 0) return unwrapExpr(cur.left);
  return cur;
}

/** `(a * 10 | 0) === 3`, `~~(a * 10) === 3`, `Math.floor(a * 10) === 3`, `(a * 10) >> 0 === 3`, and `a * 10 === 3` stand for 0.3. */
function scaledProbe(node: ts.BinaryExpression): number | null {
  const core = stripIntegerize(node);
  if (!ts.isBinaryExpression(core) || core.operatorToken.kind !== ts.SyntaxKind.AsteriskToken) return null;
  const scale = numericLiteral(core.left) ?? numericLiteral(core.right);
  if (scale === null || scale === 0) return null;
  let parent: ts.Node = node.parent;
  while (ts.isParenthesizedExpression(parent) || (ts.isPrefixUnaryExpression(parent) && parent.operator === ts.SyntaxKind.TildeToken)) parent = parent.parent;
  if (ts.isCallExpression(parent)) parent = parent.parent;
  while (ts.isParenthesizedExpression(parent)) parent = parent.parent;
  if (!ts.isBinaryExpression(parent)) return null;
  const target = numericLiteral(parent.left) ?? numericLiteral(parent.right);
  if (target === null) return null;
  return target / scale;
}

/** The next representable float above or below `value`. A bound and these neighbors are the probe, not a fixed 1e-6 gap. */
export function adjacentFloat(value: number, direction: 1 | -1): number {
  if (!Number.isFinite(value)) return value;
  if (Object.is(value, 0)) return direction > 0 ? Number.MIN_VALUE : -Number.MIN_VALUE;
  const buf = new ArrayBuffer(8);
  const view = new DataView(buf);
  view.setFloat64(0, value);
  let bits = view.getBigUint64(0);
  const up = direction > 0;
  if (value > 0) bits += up ? 1n : -1n;
  else bits += up ? -1n : 1n;
  view.setBigUint64(0, bits);
  return view.getFloat64(0);
}

function mentionsSplit(node: ts.Node): boolean {
  let hit = false;
  const walk = (cur: ts.Node) => {
    if (ts.isCallExpression(cur) && ts.isPropertyAccessExpression(cur.expression) && ts.isIdentifier(cur.expression.name) && cur.expression.name.text === "split") hit = true;
    if (!hit) ts.forEachChild(cur, walk);
  };
  walk(node);
  return hit;
}

/** Literal bounds, including a literal on the left and a negative literal, plus `.length` bounds and inequality literals. */
export function comparisonBounds(source: string): { thresholds: number[]; lengthThresholds: number[]; strings: string[]; unprobed: boolean } {
  const sf = ts.createSourceFile("candidate.ts", source, ts.ScriptTarget.Latest, true);
  importedNames = new Set();
  unresolvedBinding = false;
  for (const st of sf.statements) {
    if (ts.isImportDeclaration(st) && st.importClause && !st.importClause.isTypeOnly) {
      if (st.importClause.name) importedNames.add(st.importClause.name.text);
      const named = st.importClause.namedBindings;
      if (named && ts.isNamespaceImport(named)) importedNames.add(named.name.text);
      if (named && ts.isNamedImports(named)) for (const el of named.elements) if (!el.isTypeOnly) importedNames.add(el.name.text);
    }
  }
  const thresholds: number[] = [];
  const lengthThresholds: number[] = [];
  const strings: string[] = [];
  let unprobed = false;
  const noteSide = (side: ts.Node, other: ts.Node) => {
    const text = stringText(side);
    if (text === null) return;
    if ((ts.isTypeOfExpression(side) || ts.isTypeOfExpression(other)) && TYPEOF_NAMES.has(text)) return;
    remember(text, thresholds, strings);
    const call = unwrapExpr(other);
    const name = ts.isCallExpression(call) && ts.isPropertyAccessExpression(call.expression) && ts.isIdentifier(call.expression.name) ? call.expression.name.text : "";
    if (name === "toLowerCase") strings.push(text.toUpperCase());
    else if (name === "trim") strings.push(` ${text} `, `\t${text}\n`);
    else if (name === "split") unresolvedBinding = true;
  };
  const visit = (node: ts.Node) => {
    if (ts.isBinaryExpression(node)) {
      const kind = node.operatorToken.kind;
      const ordered = kind === ts.SyntaxKind.GreaterThanToken || kind === ts.SyntaxKind.GreaterThanEqualsToken
        || kind === ts.SyntaxKind.LessThanToken || kind === ts.SyntaxKind.LessThanEqualsToken;
      const inequality = kind === ts.SyntaxKind.EqualsEqualsToken || kind === ts.SyntaxKind.EqualsEqualsEqualsToken
        || kind === ts.SyntaxKind.ExclamationEqualsToken || kind === ts.SyntaxKind.ExclamationEqualsEqualsToken;
      if (ordered || inequality) {
        const bound = numericLiteral(node.left) ?? numericLiteral(node.right) ?? numericString(node.left) ?? numericString(node.right);
        if (bound !== null && Number.isFinite(bound)) {
          thresholds.push(bound);
          if (ordered && (isLengthAccess(node.left) || isLengthAccess(node.right))) lengthThresholds.push(bound);
        } else if (ordered || !(isNonNumericLiteral(node.left) || isNonNumericLiteral(node.right))) unprobed = true;
        noteSide(node.left, node.right);
        noteSide(node.right, node.left);
        if (mentionsSplit(node.left) || mentionsSplit(node.right)) unresolvedBinding = true;
        if (ordered) {
          const interesting = (side: ts.Node) => /Math\.abs|\*\*/.test(side.getText(sf));
          if (interesting(node.left)) collectAllNumbers(node.left, thresholds);
          if (interesting(node.right)) collectAllNumbers(node.right, thresholds);
        }
      }
      if (kind === ts.SyntaxKind.InKeyword) collectLiteralNumbers(node.right, thresholds, strings);
      const scaled = scaledProbe(node);
      if (scaled !== null && Number.isFinite(scaled)) thresholds.push(scaled);
    }
    if (ts.isRegularExpressionLiteral(node)) {
      const src = node.text.replace(/\[\.\]/g, ".").replace(/\\\./g, ".");
      for (const match of src.match(/[+-]?(?:\d+\.\d+|\.\d+|\d+)(?:e[+-]?\d+)?/gi) ?? []) {
        const n = numericText(match);
        if (n !== null) thresholds.push(n);
      }
    }
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && ts.isIdentifier(node.expression.name)) {
      const called = node.expression.name.text;
      const objectIs = called === "is" && ts.isIdentifier(node.expression.expression) && node.expression.expression.text === "Object";
      const mathAbs = called === "abs" && ts.isIdentifier(node.expression.expression) && node.expression.expression.text === "Math";
      const lookup = called === "includes" || called === "indexOf" || called === "has" || called === "get" || called === "startsWith" || called === "endsWith";
      if (mathAbs && node.arguments[0]) collectAllNumbers(node.arguments[0], thresholds);
      if (objectIs || lookup) {
        const args = objectIs ? [...node.arguments] : node.arguments.slice(0, 1);
        const found: number[] = [];
        for (const arg of args) {
          const n = numericLiteral(arg);
          if (n !== null && Number.isFinite(n)) found.push(n);
          const text = stringText(arg);
          if (text !== null) remember(text, found, strings);
        }
        if (lookup) collectLiteralNumbers(node.expression.expression, found, strings);
        if (found.length) for (const n of found) thresholds.push(n);
        else if ((objectIs || called === "includes") && args.some((arg) => numericLiteral(arg) === null && stringText(arg) === null && !isNonNumericLiteral(arg))) unprobed = true;
      }
    }
    if (ts.isElementAccessExpression(node) && node.argumentExpression) {
      collectLiteralNumbers(node.expression, thresholds, strings);
      const idx = numericLiteral(node.argumentExpression);
      if (idx !== null && Number.isFinite(idx)) thresholds.push(idx);
      const idxText = stringText(node.argumentExpression);
      if (idxText !== null) remember(idxText, thresholds, strings);
    }
    if (ts.isCaseClause(node)) {
      const bound = numericLiteral(node.expression);
      const text = stringText(node.expression);
      if (bound !== null && Number.isFinite(bound)) thresholds.push(bound);
      else if (text !== null) remember(text, thresholds, strings);
      else if (!isNonNumericLiteral(node.expression)) unprobed = true;
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  if (unresolvedBinding) unprobed = true;
  return { thresholds: [...new Set(thresholds)], lengthThresholds: [...new Set(lengthThresholds)], strings: [...new Set(strings)], unprobed };
}

type NumPath = (string | number)[];

function plainObjectPaths(value: unknown, prefix: NumPath = []): NumPath[] {
  const out: NumPath[] = [];
  if (Array.isArray(value)) value.forEach((item, index) => out.push(...plainObjectPaths(item, [...prefix, index])));
  else if (value && typeof value === "object" && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)) {
    out.push(prefix);
    for (const key of Object.keys(value)) out.push(...plainObjectPaths((value as Record<string, unknown>)[key], [...prefix, key]));
  }
  return out;
}

function withProp(value: unknown, path: NumPath, key: string, prop: unknown): unknown {
  if (path.length === 0) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return value;
    return { ...(value as Record<string, unknown>), [key]: prop };
  }
  const [head, ...rest] = path;
  if (Array.isArray(value) && typeof head === "number") {
    const copy = [...value];
    copy[head] = withProp(value[head], rest, key, prop);
    return copy;
  }
  if (value && typeof value === "object") {
    return { ...(value as Record<string, unknown>), [String(head)]: withProp((value as Record<string, unknown>)[String(head)], rest, key, prop) };
  }
  return value;
}

function stringPaths(value: unknown, prefix: NumPath = []): NumPath[] {
  if (typeof value === "string") return [prefix];
  if (Array.isArray(value)) return value.flatMap((item, index) => stringPaths(item, [...prefix, index]));
  if (value && typeof value === "object" && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)) {
    return Object.keys(value).flatMap((key) => stringPaths((value as Record<string, unknown>)[key], [...prefix, key]));
  }
  return [];
}

function setAtAny(value: unknown, path: NumPath, next: unknown): unknown {
  if (path.length === 0) return next;
  const [head, ...rest] = path;
  if (Array.isArray(value) && typeof head === "number") {
    const copy = [...value];
    copy[head] = setAtAny(value[head], rest, next);
    return copy;
  }
  if (value && typeof value === "object") {
    return { ...(value as Record<string, unknown>), [String(head)]: setAtAny((value as Record<string, unknown>)[String(head)], rest, next) };
  }
  return value;
}

function numberPaths(value: unknown, prefix: NumPath = []): NumPath[] {
  if (typeof value === "number" && Number.isFinite(value)) return [prefix];
  if (Array.isArray(value)) return value.flatMap((item, index) => numberPaths(item, [...prefix, index]));
  if (value && typeof value === "object" && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)) {
    return Object.keys(value).flatMap((key) => numberPaths((value as Record<string, unknown>)[key], [...prefix, key]));
  }
  return [];
}

function setAt(value: unknown, path: NumPath, next: number): unknown {
  if (path.length === 0) return next;
  const [head, ...rest] = path;
  if (Array.isArray(value) && typeof head === "number") {
    const copy = [...value];
    copy[head] = setAt(value[head], rest, next);
    return copy;
  }
  if (value && typeof value === "object") {
    return { ...(value as Record<string, unknown>), [String(head)]: setAt((value as Record<string, unknown>)[String(head)], rest, next) };
  }
  return value;
}

/** The bound, the adjacent floats on either side, and the midpoint between neighboring example numbers. */
function boundaryValues(thresholds: readonly number[], samples: readonly number[]): number[] {
  const out: number[] = [];
  for (const bound of thresholds) out.push(adjacentFloat(bound, -1), bound, adjacentFloat(bound, 1));
  const sorted = [...new Set(samples.filter((n) => Number.isFinite(n)))].sort((a, b) => a - b);
  for (let i = 1; i < sorted.length; i++) out.push((sorted[i - 1]! + sorted[i]!) / 2);
  return out;
}

function containsOpaque(value: unknown): boolean {
  if (value === null || typeof value !== "object") return typeof value === "function" || typeof value === "symbol" || typeof value === "bigint";
  if (value instanceof Date) return false;
  if (value instanceof Set) return [...value].some(containsOpaque);
  if (value instanceof Map) return [...value.entries()].some((pair) => containsOpaque(pair[0]) || containsOpaque(pair[1]));
  if (Array.isArray(value)) return value.some(containsOpaque);
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return true;
  return Object.values(value as object).some(containsOpaque);
}

function readAt(value: unknown, path: NumPath): unknown {
  let cur = value;
  for (const step of path) {
    if (Array.isArray(cur) && typeof step === "number") cur = cur[step];
    else if (cur && typeof cur === "object") cur = (cur as Record<string, unknown>)[String(step)];
    else return undefined;
  }
  return cur;
}

function collectionPaths(value: unknown, prefix: NumPath = []): NumPath[] {
  const out: NumPath[] = [];
  if (typeof value === "string" || Array.isArray(value)) out.push(prefix);
  if (Array.isArray(value)) value.forEach((item, index) => out.push(...collectionPaths(item, [...prefix, index])));
  else if (value && typeof value === "object" && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)) {
    for (const key of Object.keys(value)) out.push(...collectionPaths((value as Record<string, unknown>)[key], [...prefix, key]));
  }
  return out;
}

function withLength(value: unknown, path: NumPath, length: number): unknown {
  if (length < 0 || !Number.isFinite(length)) return value;
  const size = Math.floor(length);
  if (path.length === 0) {
    if (typeof value === "string") return value.length >= size ? value.slice(0, size) : value + "x".repeat(size - value.length);
    if (Array.isArray(value)) {
      if (value.length >= size) return value.slice(0, size);
      const pad = value.length ? value[value.length - 1] : 0;
      return [...value, ...Array.from({ length: size - value.length }, () => pad)];
    }
    return value;
  }
  const [head, ...rest] = path;
  if (Array.isArray(value) && typeof head === "number") {
    const copy = [...value];
    copy[head] = withLength(value[head], rest, size);
    return copy;
  }
  if (value && typeof value === "object") {
    const key = String(head);
    return { ...(value as Record<string, unknown>), [key]: withLength((value as Record<string, unknown>)[key], rest, size) };
  }
  return value;
}

export interface BehaviorInputSet { inputs: unknown[][]; truncated: boolean }

/** Originals and mutants share INPUT_CAP. Probes use PROBE_CAP and do not push mutants out. */
export function behaviorInputSet(examples: readonly (readonly unknown[])[], flags: readonly ParamFlags[], seedText: string, thresholds: readonly number[] = [], lengthThresholds: readonly number[] = [], stringThresholds: readonly string[] = []): BehaviorInputSet {
  const originals: unknown[][] = [];
  const seen = new Set<string>();
  const add = (bucket: unknown[][], args: unknown[]) => {
    const key = keyOf(args);
    if (seen.has(key)) return;
    seen.add(key);
    bucket.push(args);
  };
  for (const example of examples) add(originals, [...example]);
  const varied: unknown[][] = [];
  const fractional = everyNumericIsInteger(originals);
  for (const example of originals) {
    example.forEach((value, index) => {
      for (const next of mutants(value, flags[index], 0, fractional)) {
        const args = [...example];
        args[index] = next;
        add(varied, args);
      }
    });
  }
  const room = Math.max(0, INPUT_CAP - originals.length);
  const keptMutants = varied.slice(0, room);
  const probed: unknown[][] = [];
  for (const example of originals) {
    for (const path of numberPaths(example)) {
      const samples = originals.flatMap((args) => {
        const cur = readAt(args, path);
        return typeof cur === "number" ? [cur] : [];
      });
      for (const next of boundaryValues(thresholds, samples)) add(probed, setAt(example, path, next) as unknown[]);
    }
    for (const path of collectionPaths(example)) {
      for (const bound of lengthThresholds) for (const length of [bound - 1, bound, bound + 1]) {
        if (length < 0) continue;
        add(probed, withLength(example, path, length) as unknown[]);
      }
    }
    for (const path of stringPaths(example)) {
      for (const text of stringThresholds) add(probed, setAtAny(example, path, text) as unknown[]);
    }
    for (const path of plainObjectPaths(example)) {
      const obj = readAt(example, path);
      if (numberPaths(obj).length > 0) continue;
      for (const n of thresholds) {
        if (!Number.isFinite(n)) continue;
        add(probed, withProp(example, path, String(n), true) as unknown[]);
      }
    }
    for (const path of numberPaths(example)) {
      for (const text of stringThresholds) {
        if (text === "Infinity") add(probed, setAt(example, path, Number.POSITIVE_INFINITY) as unknown[]);
        else if (text === "-Infinity") add(probed, setAt(example, path, Number.NEGATIVE_INFINITY) as unknown[]);
        else if (text === "NaN") add(probed, setAt(example, path, Number.NaN) as unknown[]);
        else add(probed, setAtAny(example, path, text) as unknown[]);
      }
    }
  }
  const keptProbes = probed.slice(0, PROBE_CAP);
  return { inputs: [...originals, ...keptMutants, ...keptProbes], truncated: varied.length > keptMutants.length || probed.length > keptProbes.length };
}

/** The test's own argument lists, then mutants, then probes. Mutants are not sliced away to make room for probes. */
export function behaviorInputs(examples: readonly (readonly unknown[])[], flags: readonly ParamFlags[], seedText: string, thresholds: readonly number[] = [], lengthThresholds: readonly number[] = [], stringThresholds: readonly string[] = []): unknown[][] {
  return behaviorInputSet(examples, flags, seedText, thresholds, lengthThresholds, stringThresholds).inputs;
}

interface ProbeBody {
  load: string;
  results?: { thrown: boolean; value?: unknown; args?: unknown; error?: { name: string; message: string } }[];
}

/** Accept only the line that starts with this run's nonce. A static sentinel, or more than one nonce line, is refused. */
export function parseProbe(stdout: string, nonce: string): ProbeBody | null {
  if (!nonce || nonce.length < 8) return null;
  const marker = `${nonce} `;
  const hits: string[] = [];
  for (const line of stdout.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith(marker)) hits.push(trimmed.slice(marker.length));
  }
  if (hits.length !== 1) return null;
  try { return JSON.parse(hits[0]!) as ProbeBody; } catch { return null; }
}

function show(value: unknown): string {
  try { return JSON.stringify(value); } catch { return "\"unserializable\""; }
}

function sanitize(text: string, roots: readonly string[]): string {
  let out = text;
  for (const root of roots) out = out.split(root).join("<work>");
  return out.replace(/\/(?:tmp|home|opt|usr|var|exec-daemon|Users)\/[^\s'")]+/g, "<path>").slice(0, 240);
}

function opaque(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const packed = value as { k?: string; v?: unknown };
  if (packed.k === "opaque") return true;
  if ((packed.k === "a" || packed.k === "set") && Array.isArray(packed.v)) return packed.v.some(opaque);
  if (packed.k === "map" && Array.isArray(packed.v)) return packed.v.some((pair) => Array.isArray(pair) && (opaque(pair[0]) || opaque(pair[1])));
  if (packed.k === "o" && packed.v && typeof packed.v === "object") return Object.values(packed.v as Record<string, unknown>).some(opaque);
  return false;
}

function loadSide(root: string, file: string, target: BehaviorTarget, inputs: unknown[][], nodePath: string, nodeModules: string | null, nonce: string): ProbeBody | null {
  const probe = join(root, ".practice-behavior.mjs");
  const spec = join(root, ".practice-behavior.json");
  try {
    writeFileSync(probe, PROBE);
    writeFileSync(spec, JSON.stringify({
      file: join(root, file),
      form: target.form,
      exportName: target.exportName,
      prop: target.prop ?? "",
      nonce,
      inputs: inputs.map((args) => args.map(tag)),
    }));
    const ran = runInPracticeSandbox(root, [nodePath, "--experimental-strip-types", probe, spec], 20_000, { capture: true, nodePath, nodeModules });
    if (ran.unsafe || ran.code === null) return null;
    return parseProbe(ran.stdout, nonce);
  } finally {
    rmSync(probe, { force: true });
    rmSync(spec, { force: true });
  }
}

function sameResult(left: NonNullable<ProbeBody["results"]>[number], right: NonNullable<ProbeBody["results"]>[number]): boolean {
  if (left.thrown !== right.thrown) return false;
  if (JSON.stringify(left.args) !== JSON.stringify(right.args)) return false;
  if (left.thrown) return left.error?.name === right.error?.name && left.error?.message === right.error?.message;
  return JSON.stringify(left.value) === JSON.stringify(right.value);
}

/**
 * Compare the candidate symbol with the fix's symbol. Neither tree is modified except for a probe
 * file that is removed before this returns. A load failure is diff_unavailable.
 * verified_strict requires at least one mutated input, not only the test's own arguments.
 */
export function gradeBehavior(input: {
  candidateRoot: string;
  fixRoot: string;
  target: BehaviorTarget;
  nodePath: string;
  nodeModules?: string | null;
}): BehaviorGrade {
  let source = "";
  let fixSource = "";
  try { source = readFileSync(join(input.candidateRoot, input.target.file), "utf8"); } catch { source = ""; }
  try { fixSource = readFileSync(join(input.fixRoot, input.target.file), "utf8"); } catch { fixSource = ""; }
  if (input.target.args.some((args) => args.some(containsOpaque))) return { behavior: "diff_unavailable", compared: 0 };
  const candidateBounds = comparisonBounds(source);
  const fixBounds = comparisonBounds(fixSource);
  const flags = paramFlags(source, input.target.form === "named" ? input.target.exportName : input.target.symbol);
  const planned = behaviorInputSet(
    input.target.args,
    flags,
    `${input.target.symbol}\0${input.target.file}\0${JSON.stringify(input.target.args.map(tag))}`,
    [...candidateBounds.thresholds, ...fixBounds.thresholds],
    [...candidateBounds.lengthThresholds, ...fixBounds.lengthThresholds],
    [...candidateBounds.strings, ...fixBounds.strings],
  );
  const inputs = planned.inputs;
  if (!inputs.length) return { behavior: "diff_unavailable", compared: 0 };
  const modules = input.nodeModules ?? null;
  const nonce = randomBytes(16).toString("hex");
  const candidate = loadSide(input.candidateRoot, input.target.file, input.target, inputs, input.nodePath, modules, nonce);
  const fix = loadSide(input.fixRoot, input.target.file, input.target, inputs, input.nodePath, modules, nonce);
  if (!candidate || candidate.load !== "ok" || !candidate.results || !fix || fix.load !== "ok" || !fix.results) return { behavior: "diff_unavailable", compared: 0 };
  if (candidate.results.length !== inputs.length || fix.results.length !== inputs.length) return { behavior: "diff_unavailable", compared: 0 };
  const originalKeys = new Set(input.target.args.map((args) => keyOf([...args])));
  let mutated = 0;
  for (let i = 0; i < inputs.length; i++) {
    const left = candidate.results[i]!;
    const right = fix.results[i]!;
    if ((!left.thrown && opaque(left.value)) || (!right.thrown && opaque(right.value)) || opaque(left.args) || opaque(right.args)) return { behavior: "diff_unavailable", compared: i };
    const same = sameResult(left, right);
    if (!same) {
      const roots = [input.candidateRoot, input.fixRoot];
      return {
        behavior: "verified_test_only",
        compared: inputs.length,
        counterexample: {
          args: sanitize(show(inputs[i]), roots),
          candidate: sanitize(left.thrown ? "thrown" : show(left.value), roots),
          fix: sanitize(right.thrown ? "thrown" : show(right.value), roots),
        },
      };
    }
    if (!originalKeys.has(keyOf(inputs[i]!))) mutated += 1;
  }
  if (mutated < 1) return { behavior: "verified_test_only", compared: inputs.length };
  if (candidateBounds.unprobed || fixBounds.unprobed || planned.truncated) return { behavior: "verified_test_only", compared: inputs.length };
  return { behavior: "verified_strict", compared: inputs.length };
}
