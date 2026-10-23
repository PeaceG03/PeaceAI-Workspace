// M100: derive family census. Ranks shape families by how many PeaceSTOCKS functions a PeaceAI-credited derive task
// could newly cover, using the OFFICIAL coverage source (builder-log/tasks.jsonl through builder-log/coverage.ts).
// Two honest facts this tool reports rather than hides:
//  1. The official 89/220 is over TASKS (log rows), not functions. Its 131 uncovered rows are listed with the
//     PeaceSTOCKS functions they name (if any) and whether a derive family could ever earn them.
//  2. A PeaceAI real task counts in BOTH numerator and denominator, so derive raises the official figure by landing
//     NEW (source: peace) tasks on functions with no PeaceAI-credited task yet. "Covered" for a function = its name
//     appears in a PeaceAI real-task row (isPeaceRealTask, same onMain check as coverage.ts).
// Read-only; no network.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { countable, isPeaceRealTask, liveProvenSkills, parseLogEntries, retagCountable, coverageReport, type OnMainChecker } from "../../builder-log/coverage.ts";
import { retagTarget, type Entry } from "../../builder-log/check.ts";

/** The official uncovered rows: exactly the all-time denominator minus numerator of coverageReport. */
export function officialUncovered(logText: string, asOf: string, onMain: OnMainChecker | null): { covered: number; total: number; uncovered: Entry[]; peaceReal: Entry[] } {
  const entries = parseLogEntries(logText);
  const proven = liveProvenSkills(entries, asOf);
  const retag = new Map<number, Entry["skill"]>();
  for (const e of entries) { const t = retagTarget(e); if (t !== null) retag.set(t, e.skill); }
  const builder = entries.filter((e) => e.by === "Builder" && retagTarget(e) === null && e.date <= asOf).map((e) => {
    const skill = retag.get(e.seq);
    return skill === undefined ? e : { ...e, skill, mark: retagCountable(e, skill, entries) ? "PeaceAI-able today" : `missing skill ${skill}` };
  });
  const peaceReal = entries.filter((e) => e.date <= asOf && isPeaceRealTask(e, onMain));
  const uncovered = builder.filter((e) => !countable(e, proven));
  const r = coverageReport(logText, asOf, { onMain });
  const total = builder.length + peaceReal.length, covered = total - uncovered.length;
  if (r.allTime.builderTasks !== total || r.allTime.peaceaiAble !== covered) throw new Error(`census drifted from coverage.ts: ${covered}/${total} vs ${r.allTime.peaceaiAble}/${r.allTime.builderTasks}`);
  return { covered, total, uncovered, peaceReal };
}

export interface FamilyDef { name: string; kind: "family-1" | "staged" | "new"; effort: "none" | "small" | "large"; dsl: string }
export const FAMILY_DEFS: readonly FamilyDef[] = [
  { name: "family-1", kind: "family-1", effort: "none", dsl: "none (active)" },
  { name: "thresholds2", kind: "staged", effort: "none", dsl: "none (staged forms exist)" },
  { name: "outside-range", kind: "staged", effort: "none", dsl: "none (staged forms exist)" },
  { name: "nested-caps", kind: "staged", effort: "none", dsl: "none (staged forms exist)" },
  { name: "piecewise", kind: "staged", effort: "none", dsl: "none (staged forms exist)" },
  { name: "bool-combos", kind: "staged", effort: "none", dsl: "none (staged forms exist)" },
  { name: "prefix-joins", kind: "staged", effort: "none", dsl: "none (staged forms exist)" },
  { name: "NEW if-return-chains", kind: "new", effort: "small", dsl: "small: `ite` (if cond then a else b) over existing cmp/and/or, with literal leaves of the return type" },
  { name: "NEW template-joins", kind: "new", effort: "small", dsl: "small: n-ary `concat` + `str(num)` (String/template coercion)" },
  { name: "NEW lookup-switch", kind: "new", effort: "small", dsl: "small: `case` (eq-chain on one param to literal outputs, default leaf)" },
  { name: "NEW string-methods", kind: "new", effort: "large", dsl: "large: unary str ops (trim/toUpperCase/toLowerCase), predicates (startsWith/endsWith/includes), slice/padStart with literal args, plus a string example grammar" },
  { name: "NEW number-format", kind: "new", effort: "large", dsl: "large: toFixed/Math.round/floor/abs, Number(), String(n) with float-exact grading" },
];

const PRIM = new Set([ts.SyntaxKind.NumberKeyword, ts.SyntaxKind.StringKeyword, ts.SyntaxKind.BooleanKeyword]);
const CMP = new Set([ts.SyntaxKind.LessThanToken, ts.SyntaxKind.LessThanEqualsToken, ts.SyntaxKind.GreaterThanToken, ts.SyntaxKind.GreaterThanEqualsToken, ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken]);
const STR_M = new Set(["trim", "trimStart", "trimEnd", "toUpperCase", "toLowerCase", "startsWith", "endsWith", "includes", "slice", "substring", "padStart", "padEnd", "replace", "replaceAll", "split", "join", "at", "charAt", "indexOf", "repeat"]);
const NUM_F = new Set(["Math.round", "Math.floor", "Math.ceil", "Math.abs", "Math.trunc", "Number", "String", "toFixed", "Number.isFinite", "Number.isInteger"]);
const strip = (e: ts.Node): ts.Node => (ts.isParenthesizedExpression(e) ? strip(e.expression) : e);

/** Smallest family the body needs, or "out-of-scope" (loops, objects, other calls, IO, Date ...). */
export function classifyBody(fn: ts.FunctionLikeDeclaration, params: ReadonlySet<string>): string {
  const body = fn.body!;
  let guards = 0, out = false, ifs = 0, conds = 0, cmps = 0, logic = 0, arith = 0, minmax = 0, tmpl = false, concat = false, switches = 0, strM = false, numF = false;
  const locals = new Set<string>();
  const visit = (n: ts.Node): void => {
    if (ts.isIterationStatement(n, false) || ts.isObjectLiteralExpression(n) || ts.isArrayLiteralExpression(n) || ts.isNewExpression(n) || ts.isAwaitExpression(n) || ts.isThrowStatement(n) || ts.isTryStatement(n) || ts.isArrowFunction(n) || ts.isFunctionExpression(n) || ts.isElementAccessExpression(n) || (ts.isVariableDeclarationList(n) && !(n.flags & ts.NodeFlags.Const))) { out = true; return; }
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name)) locals.add(n.name.text);
    if (ts.isIfStatement(n)) ifs++;
    else if (ts.isSwitchStatement(n)) switches++;
    else if (ts.isConditionalExpression(n)) conds++;
    else if (ts.isTemplateExpression(n) || ts.isNoSubstitutionTemplateLiteral(n)) tmpl = true;
    else if (ts.isBinaryExpression(n)) {
      const k = n.operatorToken.kind;
      if (CMP.has(k)) cmps++;
      else if (k === ts.SyntaxKind.AmpersandAmpersandToken || k === ts.SyntaxKind.BarBarToken) logic++;
      else if (k === ts.SyntaxKind.PlusToken && (ts.isStringLiteral(strip(n.left)) || ts.isStringLiteral(strip(n.right)) || ts.isTemplateExpression(strip(n.left)) || ts.isTemplateExpression(strip(n.right)))) concat = true;
      else if ([ts.SyntaxKind.PlusToken, ts.SyntaxKind.MinusToken, ts.SyntaxKind.AsteriskToken].includes(k)) arith++;
      else if ([ts.SyntaxKind.SlashToken, ts.SyntaxKind.PercentToken, ts.SyntaxKind.AsteriskAsteriskToken].includes(k)) { numF = true; arith++; }
      else if (k === ts.SyntaxKind.EqualsToken || k === ts.SyntaxKind.QuestionQuestionToken || (k >= ts.SyntaxKind.FirstCompoundAssignment && k <= ts.SyntaxKind.LastCompoundAssignment)) { out = true; return; }
    } else if (ts.isCallExpression(n)) {
      const callee = n.expression.getText();
      const meth = ts.isPropertyAccessExpression(n.expression) ? n.expression.name.text : "";
      if (callee === "Math.min" || callee === "Math.max") minmax++;
      else if (NUM_F.has(callee) || meth === "toFixed") numF = true;
      else if (ts.isPropertyAccessExpression(n.expression) && STR_M.has(meth) && (ts.isCallExpression(strip(n.expression.expression)) || ts.isIdentifier(strip(n.expression.expression)) && (params.has((strip(n.expression.expression) as ts.Identifier).text) || locals.has((strip(n.expression.expression) as ts.Identifier).text)))) strM = true;
      else { out = true; return; }
    } else if (ts.isPropertyAccessExpression(n) && !ts.isCallExpression(n.parent)) {
      if (n.name.text === "length" && ts.isIdentifier(n.expression) && (params.has(n.expression.text) || locals.has(n.expression.text))) strM = true;
      else if (!/^Number\.(MAX|MIN)_SAFE_INTEGER$|^Number\.(POSITIVE|NEGATIVE)_INFINITY$/.test(n.getText())) { out = true; return; }
    } else if (ts.isIdentifier(n) && !ts.isPropertyAccessExpression(n.parent) && !ts.isParameter(n.parent) && !ts.isVariableDeclaration(n.parent) && n !== (fn as { name?: ts.Node }).name) {
      if (!params.has(n.text) && !locals.has(n.text) && !/^[A-Z][A-Z0-9_]*$/.test(n.text) && !["undefined", "Math", "Number", "String", "Infinity", "NaN"].includes(n.text)) { out = true; return; }
    }
    ts.forEachChild(n, visit);
  };
  // Leading `if (...) throw new Error("CODE")` guards are THROW_GUARD's job (live-proven); the census classifies what follows.
  const isGuard = (st: ts.Statement) => ts.isIfStatement(st) && !st.elseStatement && (ts.isThrowStatement(st.thenStatement) || (ts.isBlock(st.thenStatement) && st.thenStatement.statements.length === 1 && ts.isThrowStatement(st.thenStatement.statements[0]!)));
  if (ts.isBlock(body)) { let i = 0; while (i < body.statements.length && isGuard(body.statements[i]!)) { guards++; i++; } body.statements.slice(i).forEach(visit); } else visit(body);
  if (out) return "out-of-scope";
  void guards;
  if (numF) return "NEW number-format";
  if (strM) return "NEW string-methods";
  if (switches) return "NEW lookup-switch";
  if (tmpl) return "NEW template-joins";
  const branches = ifs + conds;
  if (minmax >= 2 && !arith && params.size === 1 && !branches) return "family-1"; // floor_clamp
  if (branches === 1 && arith >= 2 && !logic && !concat) return "piecewise"; // e.g. n >= 0 ? 2n : -2n - 1
  if (minmax >= 2) return params.size >= 2 ? "nested-caps" : "piecewise";
  if (minmax === 1) return arith > 1 ? "piecewise" : "family-1";
  if (branches >= 2) return "NEW if-return-chains";
  if (concat) return branches === 1 ? "prefix-joins" : "family-1";
  if (branches === 1) return cmps <= 2 && !logic ? "family-1" : "NEW if-return-chains";
  if (cmps >= 3 || (cmps === 2 && logic >= 1 && params.size >= 2)) return params.size >= 2 && cmps === 2 ? "thresholds2" : "bool-combos";
  if (cmps === 2 && logic === 1) { const t = ts.isBlock(body) ? body.statements[body.statements.length - 1]!.getText() : body.getText(); return /\|\|/.test(t) ? (/===|!==/.test(t) ? "bool-combos" : "outside-range") : "family-1"; }
  if (cmps === 1 && params.size >= 2) return "thresholds2";
  return "family-1";
}

export interface FnInfo { file: string; name: string; family: string }
/** Every function / arrow / method in src (tests excluded) with 1-3 number/string/boolean params and a primitive or inferred result. */
export function scanFunctions(root: string): FnInfo[] {
  const walk = (d: string): string[] => readdirSync(d).flatMap((f) => { const p = join(d, f); return f === "node_modules" || f.startsWith(".") ? [] : statSync(p).isDirectory() ? walk(p) : p.endsWith(".ts") && !p.endsWith(".d.ts") ? [p] : []; });
  const out: FnInfo[] = [];
  for (const f of walk(root).filter((f) => !/\.test\.ts$|\/test\//.test(f))) {
    const sf = ts.createSourceFile(f, readFileSync(f, "utf8"), ts.ScriptTarget.Latest, true);
    const visit = (n: ts.Node): void => {
      let name: string | undefined, fn: ts.FunctionLikeDeclaration | undefined;
      if (ts.isFunctionDeclaration(n) && n.name) { name = n.name.text; fn = n; }
      else if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer && (ts.isArrowFunction(n.initializer) || ts.isFunctionExpression(n.initializer))) { name = n.name.text; fn = n.initializer; }
      else if (ts.isMethodDeclaration(n) && ts.isIdentifier(n.name)) { name = n.name.text; fn = n; }
      if (fn && name && fn.body && fn.parameters.length >= 1 && fn.parameters.length <= 3 && fn.parameters.every((p) => p.type && PRIM.has(p.type.kind) && ts.isIdentifier(p.name) && !p.initializer) && (!fn.type || PRIM.has(fn.type.kind))) {
        out.push({ file: f.slice(root.length + 1), name, family: classifyBody(fn, new Set(fn.parameters.map((p) => (p.name as ts.Identifier).text))) });
        return;
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }
  return out;
}

const mentions = (rows: readonly Entry[], name: string) => { const re = new RegExp(`\\b${name}\\b`); return rows.some((e) => re.test(`${e.asked} ${e.why} ${e.changed}`)); };

export function census(logText: string, asOf: string, onMain: OnMainChecker | null, stocksRoot: string) {
  const off = officialUncovered(logText, asOf, onMain);
  const fns = scanFunctions(stocksRoot);
  const pool = fns.filter((f) => !mentions(off.peaceReal, f.name));
  const officialRows = off.uncovered.map((e) => {
    const named = [...new Set(fns.filter((f) => /[a-z][A-Z]/.test(f.name) && new RegExp(`\\b${f.name}\\b`).test(e.asked)).map((f) => f.name))];
    return { seq: e.seq, skill: e.skill, named, family: named.length ? fns.find((f) => f.name === named[0])!.family : "not a function task" };
  });
  const rank = FAMILY_DEFS.map((d) => {
    const hit = pool.filter((f) => f.family === d.name);
    return { family: d.name, kind: d.kind, functions: hit.length, official: officialRows.filter((r) => r.family === d.name).length, dsl: d.effort, dslNeeded: d.dsl, examples: hit.slice(0, 3).map((f) => `${f.file}:${f.name}`) };
  }).sort((a, b) => b.functions - a.functions || a.family.localeCompare(b.family));
  const bySkill: Record<string, number> = {};
  for (const r of officialRows) bySkill[r.skill] = (bySkill[r.skill] ?? 0) + 1;
  return { official: { covered: off.covered, total: off.total, uncovered: off.uncovered.length, uncoveredBySkill: bySkill, functionNamingRows: officialRows.filter((r) => r.named.length) }, scanned: fns.length, credited: fns.length - pool.length, outOfScope: pool.filter((f) => f.family === "out-of-scope").length, rank };
}
