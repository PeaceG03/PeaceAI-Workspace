// Two array repairs, each the edit a published test already required.
// A descending splice of raw indices normalizes negatives with the spliced array's length.
// Math.max of a mapped `.length` is seeded with 0, so an empty input is 0 rather than -Infinity.
// Anything else is left alone. The project test must pass afterwards, inside the sandbox.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { practiceGit, runInPracticeSandbox } from "./practicemine.ts";

export interface ArrayRepairInput {
  root: string;
  output: string;
  sourcePattern?: string;
  nodePath: string;
  nodeModules?: string | null;
  testCommand: readonly string[];
}

function readLocal(root: string, path: string): string | null {
  try { return readFileSync(join(root, path), "utf8"); } catch { return null; }
}

function filesOf(root: string, pattern: string | undefined): string[] {
  const listed = practiceGit(root, ["ls-files"]);
  if (!listed.ok) return [];
  return listed.out.split("\n").map((p) => p.trim()).filter((p) => p.endsWith(".ts") && !p.endsWith(".d.ts") && (!pattern || new RegExp(pattern).test(p)));
}

/** `Math.max(...xs.map(x => x.length))` becomes `Math.max(0, ...xs.map(x => x.length))`. */
export function seedEmptyMax(text: string): string | null {
  const sf = ts.createSourceFile("m.ts", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const hits: { start: number }[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === "max"
      && ts.isIdentifier(node.expression.expression) && node.expression.expression.text === "Math"
      && node.arguments.length === 1 && ts.isSpreadElement(node.arguments[0])) {
      const spread = node.arguments[0].expression;
      if (ts.isCallExpression(spread) && ts.isPropertyAccessExpression(spread.expression) && spread.expression.name.text === "map" && lengthArrow(spread.arguments[0])) {
        hits.push({ start: node.arguments[0].getStart(sf) });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  if (hits.length !== 1) return null;
  const at = hits[0]!.start;
  return text.slice(0, at) + "0, " + text.slice(at);
}

function lengthArrow(node: ts.Expression | undefined): boolean {
  if (!node || (!ts.isArrowFunction(node) && !ts.isFunctionExpression(node))) return false;
  const body = node.body;
  const ret = ts.isBlock(body) ? (body.statements.length === 1 && ts.isReturnStatement(body.statements[0]) ? body.statements[0].expression : undefined) : body;
  if (!ret || !ts.isPropertyAccessExpression(ret) || ret.name.text !== "length") return false; // arr-guard:length
  return true;
}

/** `new Set(xs.slice().sort((x, y) => y - x))` spliced into `arr` normalizes a negative index with `arr.length`. */
export function normalizeNegativeSplice(text: string): string | null {
  const sf = ts.createSourceFile("m.ts", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const hits: { start: number; end: number; arr: string }[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "Set" && node.arguments?.length === 1) {
      const built = descendingSlice(node.arguments[0]);
      const arr = built ? splicedArray(node) : null;
      if (built && arr) hits.push({ start: built.start, end: built.end, arr });
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  if (hits.length !== 1) return null;
  const hit = hits[0]!;
  return text.slice(0, hit.start) + `.map(index => (index < 0 ? index + ${hit.arr}.length : index))` + text.slice(hit.end);
}

function descendingSlice(node: ts.Expression | undefined): { start: number; end: number } | null {
  if (!node || !ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression) || node.expression.name.text !== "sort") return null;
  const cmp = node.arguments[0];
  if (!cmp || !descending(cmp)) return null; // arr-guard:descend
  const inner = node.expression.expression;
  if (!ts.isCallExpression(inner) || !ts.isPropertyAccessExpression(inner.expression) || inner.expression.name.text !== "slice" || inner.arguments.length !== 0) return null;
  const sf = node.getSourceFile();
  return { start: inner.expression.name.getStart(sf) - 1, end: inner.getEnd() };
}

function descending(node: ts.Expression): boolean {
  const body = ts.isArrowFunction(node) || ts.isFunctionExpression(node) ? node.body : undefined;
  const expr = body && ts.isBlock(body) ? (body.statements.length === 1 && ts.isReturnStatement(body.statements[0]) ? body.statements[0].expression : undefined) : body;
  if (!expr || !ts.isBinaryExpression(expr) || expr.operatorToken.kind !== ts.SyntaxKind.MinusToken) return false;
  return ts.isIdentifier(expr.left) && ts.isIdentifier(expr.right) && expr.left.text === "y" && expr.right.text === "x";
}

function splicedArray(setNode: ts.NewExpression): string | null {
  const id = setNode.parent && ts.isVariableDeclaration(setNode.parent) && ts.isIdentifier(setNode.parent.name) ? setNode.parent.name.text : null;
  if (!id) return null;
  let arr: string | null = null;
  const fn = enclosingFunction(setNode);
  if (!fn?.body) return null;
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === "splice"
      && node.arguments[0] && ts.isIdentifier(node.arguments[0]) && node.arguments[0].text === loopVariable(node, id)
      && ts.isIdentifier(node.expression.expression)) arr = node.expression.expression.text;
    ts.forEachChild(node, visit);
  };
  visit(fn.body);
  return arr;
}

function loopVariable(node: ts.Node, setName: string): string | null {
  let cur: ts.Node | undefined = node;
  while (cur) {
    if (ts.isForOfStatement(cur) && ts.isIdentifier(cur.expression) && cur.expression.text === setName && ts.isVariableDeclarationList(cur.initializer)) {
      const decl = cur.initializer.declarations[0];
      if (decl && ts.isIdentifier(decl.name)) return decl.name.text;
    }
    cur = cur.parent;
  }
  return null;
}

function enclosingFunction(node: ts.Node): ts.FunctionLikeDeclaration | null {
  let cur: ts.Node | undefined = node;
  while (cur) {
    if (ts.isFunctionDeclaration(cur) || ts.isFunctionExpression(cur) || ts.isArrowFunction(cur) || ts.isMethodDeclaration(cur)) return cur;
    cur = cur.parent;
  }
  return null;
}

export function repairRuntimeFailure(input: ArrayRepairInput): { diff: string; file: string } | null {
  const failed = /RangeError|AssertionError|not equal|not strict|Expected/.test(input.output);
  if (!failed) return null;
  const paths = filesOf(input.root, input.sourcePattern);
  const edits: { path: string; next: string; original: string }[] = [];
  for (const path of paths) {
    const original = readLocal(input.root, path);
    if (original === null) continue;
    const next = /RangeError/.test(input.output) ? seedEmptyMax(original) : normalizeNegativeSplice(original);
    if (next && next !== original) edits.push({ path, next, original });
  }
  if (edits.length !== 1) return null;
  const edit = edits[0]!;
  try {
    writeFileSync(join(input.root, edit.path), edit.next);
    const again = runInPracticeSandbox(input.root, input.testCommand, 60_000, {
      capture: true, nodePath: input.nodePath, nodeModules: input.nodeModules,
    });
    if (again.unsafe || again.code !== 0) return null;
    const diff = practiceGit(input.root, ["diff", "--no-color", "--no-ext-diff", "--no-renames", "--", edit.path]);
    if (!diff.ok || !diff.out.trim()) return null;
    return { diff: diff.out, file: edit.path };
  } finally {
    writeFileSync(join(input.root, edit.path), edit.original);
  }
}
