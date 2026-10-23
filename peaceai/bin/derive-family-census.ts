// M100: rank the STAGED derive practice families (peaceai/lib/derive-practice-families.json) by how many real
// PeaceSTOCKS functions they would cover. There is no function-level census for derive in the Workspace (the
// test-case-existing v1-v7 evidence lists fits by hand), so this counts body shapes directly: every function or
// arrow in src/**/*.ts (tests excluded) with 1-3 parameters typed number / string / boolean, a number / string /
// boolean result and a single-expression body (an arrow expression or one `return`), not yet covered (its name is
// never mentioned in a *.test.ts file), classified into the family whose shape it has. Read-only; no network.
// Usage: tsx peaceai/bin/derive-family-census.ts <PeaceSTOCKS checkout> [--json]
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { FAMILIES } from "../lib/derive-practice.ts";

const root = process.argv[2];
if (!root) { console.error("usage: derive-family-census.ts <PeaceSTOCKS checkout> [--json]"); process.exit(2); }
const walk = (d: string): string[] => readdirSync(d).flatMap((f) => { const p = join(d, f); return f === "node_modules" || f.startsWith(".") ? [] : statSync(p).isDirectory() ? walk(p) : p.endsWith(".ts") && !p.endsWith(".d.ts") ? [p] : []; });
const files = walk(root).filter((f) => !f.includes("/node_modules/"));
const tests = files.filter((f) => /\.test\.ts$|\/test\//.test(f)).map((f) => readFileSync(f, "utf8")).join("\n");
const PRIM = new Set([ts.SyntaxKind.NumberKeyword, ts.SyntaxKind.StringKeyword, ts.SyntaxKind.BooleanKeyword]);
const CMP = new Set([ts.SyntaxKind.LessThanToken, ts.SyntaxKind.LessThanEqualsToken, ts.SyntaxKind.GreaterThanToken, ts.SyntaxKind.GreaterThanEqualsToken, ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken]);
const strip = (e: ts.Expression): ts.Expression => (ts.isParenthesizedExpression(e) ? strip(e.expression) : e);
const isLit = (e: ts.Expression) => { e = strip(e); return ts.isNumericLiteral(e) || (ts.isPrefixUnaryExpression(e) && ts.isNumericLiteral(e.operand)) || ts.isIdentifier(e) && /^[A-Z][A-Z0-9_]+$/.test(e.text); };
const isEmptyTest = (e: ts.Expression, strs: Set<string>) => { e = strip(e); if (ts.isPrefixUnaryExpression(e) && e.operator === ts.SyntaxKind.ExclamationToken) return ts.isIdentifier(strip(e.operand)) && strs.has((strip(e.operand) as ts.Identifier).text); if (!ts.isBinaryExpression(e)) return false; const t = e.getText(); return /^\w+(\.length)?\s*[!=]==?\s*(""|''|0)$/.test(t); };

/** The family whose shape this body has, or null (family-1 or not a derive shape). */
function classify(body: ts.Expression, params: Map<string, string>): string | null {
  const e = strip(body);
  const strs = new Set([...params].filter(([, t]) => t === "string").map(([n]) => n));
  const cmps: ts.BinaryExpression[] = [];
  let logic = 0, mathCalls: string[] = [], other = false, concat = false, conds = 0;
  const visit = (n: ts.Node) => {
    if (ts.isBinaryExpression(n)) {
      if (CMP.has(n.operatorToken.kind)) cmps.push(n);
      else if (n.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken || n.operatorToken.kind === ts.SyntaxKind.BarBarToken) logic++;
      else if (n.operatorToken.kind === ts.SyntaxKind.PlusToken && (ts.isStringLiteral(n.left) || ts.isStringLiteral(n.right) || strs.has(n.left.getText()) || strs.has(n.right.getText()))) concat = true;
    } else if (ts.isTemplateExpression(n)) concat = true;
    else if (ts.isConditionalExpression(n)) conds++;
    else if (ts.isCallExpression(n)) { const t = n.expression.getText(); if (t === "Math.min" || t === "Math.max") mathCalls.push(t); else other = true; }
    ts.forEachChild(n, visit);
  };
  visit(e);
  if (other) return null;
  const paramOf = (x: ts.Expression) => { x = strip(x); return ts.isIdentifier(x) && params.has(x.text) ? x.text : null; };
  if (ts.isConditionalExpression(e) && isEmptyTest(e.condition, strs) && concat) return "prefix-joins";
  // Math.min / Math.max over a bare parameter (a floor, cap or clamp) is family-1 (floor_clamp), not a staged family.
  if (mathCalls.length && !/[+\-*]/.test(e.getText().replace(/-?\d+/g, "K"))) return null;
  if (mathCalls.length >= 2 && mathCalls.includes("Math.min") && mathCalls.includes("Math.max")) {
    const ps = new Set(params.keys()); const used = [...ps].filter((p) => new RegExp(`\\b${p}\\b`).test(e.getText()));
    return used.length >= 2 ? "nested-caps" : "piecewise";
  }
  if (mathCalls.length === 1 && /[+\-*]/.test(e.getText().replace(/^Math\.(min|max)\(/, "")) && params.size === 1) return "piecewise";
  if (cmps.length >= 1 && cmps.every((c) => (paramOf(c.left) && (isLit(c.right) || paramOf(c.right))) || (paramOf(c.right) && isLit(c.left)))) {
    if (cmps.length === 1 && !logic && paramOf(cmps[0]!.left) && paramOf(cmps[0]!.right)) return "thresholds2";
    if (cmps.length === 2 && logic === 1 && ts.isBinaryExpression(e) && e.operatorToken.kind === ts.SyntaxKind.BarBarToken) {
      const [a, b] = cmps; const pa = paramOf(a!.left) ?? paramOf(a!.right), pb = paramOf(b!.left) ?? paramOf(b!.right);
      const out = (c: ts.BinaryExpression) => [ts.SyntaxKind.LessThanToken, ts.SyntaxKind.GreaterThanToken, ts.SyntaxKind.LessThanEqualsToken, ts.SyntaxKind.GreaterThanEqualsToken].includes(c.operatorToken.kind);
      if (pa && pa === pb && out(a!) && out(b!)) return "outside-range";
    }
    const usedParams = new Set(cmps.map((c) => paramOf(c.left) ?? paramOf(c.right)));
    if (cmps.length >= 2 && logic >= 1 && usedParams.size >= 2) return cmps.length === 2 && ts.isBinaryExpression(e) && e.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken ? "thresholds2" : "bool-combos";
    if (cmps.length === 3 && logic >= 2) return "bool-combos";
  }
  return null;
}

const counts = new Map<string, string[]>();
let candidates = 0;
for (const f of files.filter((f) => !/\.test\.ts$|\/test\//.test(f))) {
  const sf = ts.createSourceFile(f, readFileSync(f, "utf8"), ts.ScriptTarget.Latest, true);
  const visit = (n: ts.Node) => {
    let name: string | undefined, fn: ts.FunctionLikeDeclaration | undefined;
    if (ts.isFunctionDeclaration(n) && n.name) { name = n.name.text; fn = n; }
    else if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer && (ts.isArrowFunction(n.initializer) || ts.isFunctionExpression(n.initializer))) { name = n.name.text; fn = n.initializer; }
    else if (ts.isMethodDeclaration(n) && ts.isIdentifier(n.name)) { name = n.name.text; fn = n; }
    if (fn && name && fn.body && fn.parameters.length >= 1 && fn.parameters.length <= 3 && fn.parameters.every((p) => p.type && PRIM.has(p.type.kind) && ts.isIdentifier(p.name))) {
      let expr: ts.Expression | undefined;
      if (!ts.isBlock(fn.body)) expr = fn.body;
      else if (fn.body.statements.length === 1 && ts.isReturnStatement(fn.body.statements[0]!)) expr = (fn.body.statements[0] as ts.ReturnStatement).expression;
      if (expr && (!fn.type || PRIM.has(fn.type.kind))) {
        candidates++;
        const covered = !process.argv.includes("--include-covered") && new RegExp(`\\b${name}\\b`).test(tests);
        if (process.argv.includes("--list")) console.error(`${covered ? "covered  " : "uncovered"} ${f.slice(root.length + 1)}:${name}: ${expr.getText().replace(/\s+/g, " ").slice(0, 120)}`);
        const fam = covered ? null : classify(expr, new Map(fn.parameters.map((p) => [(p.name as ts.Identifier).text, ts.tokenToString(p.type!.kind)!])));
        if (fam) counts.set(fam, [...(counts.get(fam) ?? []), `${f.slice(root.length + 1)}:${name}`]);
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
}
const staged = FAMILIES.filter((f) => f.status === "staged");
const rank = staged.map((f) => ({ family: f.name, title: f.title, functions: (counts.get(f.name) ?? []).length, examples: (counts.get(f.name) ?? []).slice(0, 5) })).sort((a, b) => b.functions - a.functions || (a.family < b.family ? -1 : 1));
if (process.argv.includes("--json")) console.log(JSON.stringify({ candidates, rank }, null, 1));
else {
  console.log(`${candidates} single-expression functions over number/string/boolean parameters; uncovered ones by staged family:`);
  rank.forEach((r, i) => console.log(`${i + 1}. ${r.family} (${r.title}): ${r.functions}${r.examples.length ? `  e.g. ${r.examples.join(", ")}` : ""}`));
}
