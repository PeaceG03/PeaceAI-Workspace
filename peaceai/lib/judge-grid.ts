// Judge set v2 (Auditor, after the identity-gap audit of 2026-10-26 and PR #549): the v1 judge set (Results
// lm-judge/items.json on notes/lm-judge-eval, 364 = 276 right + 88 wrong) labelled a derived program "right" when it
// matched upstream on the miner's held-out input grid. 256 of the 364 derived programs were the identity
// (`return <param>;`), and 181 of those were "right" only because no grid input made the upstream function change its
// input (e.g. a "strip a 0x prefix" function never saw an input starting with 0x).
// v2 keeps every v1 item's text (context, derived, reference) and re-labels it on a WIDER held-out grid built from the
// upstream function's own behaviour:
//   - the miner's grid (the same small domains, so the training slice the program was derived from is unchanged),
//   - plus the literals written in the upstream function's own body (numbers n-1, n, n+1; strings as written and
//     with text around them), and a few wide numbers,
//   - every row run through the upstream function itself (empty vm context, 50 ms); rows it does not answer with a
//     valid value of its return type are skipped, never guessed.
// An item is kept only when, for every parameter whose type is the return type, some held-out row has an upstream
// result different from that parameter's value (so returning the parameter is wrong somewhere on the grid); otherwise
// it is dropped as identity_indistinguishable. A kept item is "right" when the derived program equals upstream on
// every held-out row, else "wrong". Pure functions only; the IO is in peaceai/bin/judge-v2-build.ts.
import vm from "node:vm";
import ts from "typescript";

export type JV = number | string | boolean;
export type JType = "number" | "string" | "boolean";
export interface JParam { name: string; type: JType }
export interface JRow { args: JV[]; out: JV }

/** The miner's string domain (Workspace /workspace/mine99c/miner3.mts, M99 rescan). */
export const MINER_STR: readonly string[] = ["", "a", "ab", "abc", "Hello", "x y", "hello world", "A-B", "foo.bar", "123", " pad "];
/** The miner's base integers. */
export const MINER_NUMS: readonly number[] = [-1, 0, 1, 2, 3, 5, 10, 100];
/** Wide integers added in v2 (a cap, a threshold or a sign test past the miner's 100 shows here). */
export const WIDE_NUMS: readonly number[] = [-1000, -100, -7, 7, 42, 255, 1000, 65536, 100000];
export const GRID_MAX = 3000;
export const STR_LIT_MAX = 40;
const ARGS_KEY = (a: readonly JV[]) => JSON.stringify(a);

/** The miner's describedConstants: the integers a doc comment writes. */
export function describedNumbers(prose: string): number[] {
  const s = new Set<number>();
  for (const m of prose.matchAll(/(?<![\w]|\d\.)\d{1,9}(?![\w]|\.\d)/g)) s.add(Number(m[0]));
  return [...s].sort((a, c) => a - c);
}

/** Cartesian grid over the domains, thinned deterministically to at most GRID_MAX rows (miner rule). */
export function cartesian(domains: readonly (readonly JV[])[]): JV[][] {
  let grid: JV[][] = [[]];
  for (const d of domains) grid = grid.flatMap((g) => d.map((v) => [...g, v]));
  if (grid.length > GRID_MAX) { const step = Math.ceil(grid.length / GRID_MAX); grid = grid.filter((_, i) => i % step === 0); }
  return grid;
}

/** The miner's grid for these parameters and doc comment. */
export function minerGrid(params: readonly JParam[], described: readonly number[]): JV[][] {
  const nums = [...new Set([...MINER_NUMS, ...described.flatMap((d) => [d - 1, d, d + 1])])].sort((a, b) => a - b);
  return cartesian(params.map((p) => (p.type === "number" ? nums : p.type === "string" ? [...MINER_STR] : [true, false])));
}

/** The miner's training slice: every 3rd valid row, at most 14. */
export function trainSlice<T>(rows: readonly T[]): T[] { return rows.filter((_, i) => i % 3 === 0).slice(0, 14); }

/** A string a row may carry (the miner's output rule, used for inputs too): short, no quote, backslash or control. */
export function plainString(s: string): boolean {
  // eslint-disable-next-line no-control-regex
  return s.length <= 120 && !/["\\\u0000-\u001f]/.test(s);
}

/** Integer and string literals written in the function's own text (TypeScript AST; sorted, unique). */
export function literalsOf(text: string): { numbers: number[]; strings: string[] } {
  const sf = ts.createSourceFile("f.ts", text, ts.ScriptTarget.Latest, true);
  const nums = new Set<number>(), strs = new Set<string>();
  const walk = (n: ts.Node): void => {
    if (ts.isNumericLiteral(n)) { const v = Number(n.text); if (Number.isSafeInteger(v)) nums.add(v); }
    else if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) { if (n.text.length > 0 && n.text.length <= STR_LIT_MAX && plainString(n.text)) strs.add(n.text); }
    else if (ts.isTemplateExpression(n)) { for (const t of [n.head, ...n.templateSpans.map((s) => s.literal)]) if (t.text.length > 0 && t.text.length <= STR_LIT_MAX && plainString(t.text)) strs.add(t.text); }
    ts.forEachChild(n, walk);
  };
  walk(sf);
  return { numbers: [...nums].sort((a, b) => a - b), strings: [...strs].sort() };
}

/** v2 domains: the miner's plus the function's own literals (and text around each string literal) and WIDE_NUMS. */
export function wideDomains(params: readonly JParam[], described: readonly number[], text: string): JV[][] {
  const lit = literalsOf(text);
  const nums = [...new Set([...MINER_NUMS, ...WIDE_NUMS, ...[...described, ...lit.numbers].flatMap((d) => [d - 1, d, d + 1])])].filter(Number.isSafeInteger).sort((a, b) => a - b);
  const around = lit.strings.flatMap((s) => [s, `${s}abc`, `abc${s}`, `x${s}y`, `${s}${s}`, s.toUpperCase(), s.toLowerCase()]);
  const strs = [...new Set([...MINER_STR, ...around, ...lit.numbers.map(String)])].filter(plainString);
  return params.map((p) => (p.type === "number" ? nums : p.type === "string" ? strs : [true, false]));
}

/** The miner's row rule: a value of the return type; integers safe; strings plain. */
export function validOut(o: unknown, ret: JType): o is JV {
  if (typeof o !== ret) return false;
  if (typeof o === "number") return Number.isSafeInteger(o);
  if (typeof o === "string") return plainString(o);
  return true;
}

/** Runs a function declaration / const arrow (TypeScript text) named `name` in an empty vm context, 50 ms per call. */
export function runner(text: string, name: string): (args: readonly JV[]) => unknown {
  const js = ts.transpileModule(text, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const ctx = vm.createContext(Object.create(null));
  return (args) => { try { return vm.runInContext(`(() => { ${js}\n; return ${name}(...${JSON.stringify(args)}); })()`, ctx, { timeout: 50 }); } catch { return undefined; } };
}

/** The derived program's compiled expression as a function of the parameters (empty vm context). */
export function exprRunner(expr: string, params: readonly JParam[]): (args: readonly JV[]) => unknown {
  const ctx = vm.createContext(Object.create(null));
  const f = vm.runInContext(`(function (${params.map((p) => p.name).join(", ")}) { return (${expr}); })`, ctx, { timeout: 50 }) as (...a: JV[]) => unknown;
  return (args) => { try { return f(...args); } catch { return undefined; } };
}

/** Parameters from a v1 item context line `export function name(a: number, b: string): ret {`. */
export function paramsOfContext(context: string): { fn: string; params: JParam[]; ret: JType } | null {
  const m = /^export function (\w+)\(([^)]*)\): (number|string|boolean) \{$/m.exec(context);
  if (!m) return null;
  const params: JParam[] = [];
  for (const part of m[2]!.split(",").map((s) => s.trim()).filter(Boolean)) {
    const p = /^(\w+): (number|string|boolean)$/.exec(part);
    if (!p) return null;
    params.push({ name: p[1]!, type: p[2] as JType });
  }
  return params.length ? { fn: m[1]!, params, ret: m[3] as JType } : null;
}

export interface V1Counts { heldRight: number; heldWrong: number }
export type RebuildResult =
  | { kept: true; label: "right" | "wrong"; heldRight: number; heldWrong: number; held: number; train: number; skipped: number; identityWitnesses: Record<string, number>; firstWrong: JRow & { derived: unknown } | null }
  | { kept: false; reason: "context_unparsed" | "upstream_not_reproduced" | "identity_indistinguishable"; detail: string };

/**
 * Re-labels one v1 item. `up` is the upstream function, `derived` the derived program. The v1 miner grid is rebuilt
 * first and must reproduce the v1 held-out counts exactly (else upstream_not_reproduced: the text found is not the
 * function v1 ran). Held-out rows = the wide grid's valid rows minus the training slice.
 */
export function rebuildItem(
  sig: { params: JParam[]; ret: JType }, described: readonly number[], text: string, v1: V1Counts,
  up: (a: readonly JV[]) => unknown, derived: (a: readonly JV[]) => unknown,
): RebuildResult {
  const { params, ret } = sig;
  const mrows: JRow[] = [];
  for (const a of minerGrid(params, described)) { const o = up(a); if (!validOut(o, ret)) return { kept: false, reason: "upstream_not_reproduced", detail: `upstream gives no valid ${ret} at ${ARGS_KEY(a)} on the v1 grid` }; mrows.push({ args: a, out: o }); }
  const train = trainSlice(mrows);
  const trainKeys = new Set(train.map((r) => ARGS_KEY(r.args)));
  const mheld = mrows.filter((r) => !trainKeys.has(ARGS_KEY(r.args)));
  const v1Right = mheld.filter((r) => derived(r.args) === r.out).length;
  if (v1Right !== v1.heldRight || mheld.length - v1Right !== v1.heldWrong) return { kept: false, reason: "upstream_not_reproduced", detail: `v1 grid gives ${v1Right} right / ${mheld.length - v1Right} wrong, v1 recorded ${v1.heldRight} / ${v1.heldWrong}` };
  let skipped = 0;
  const held: JRow[] = [];
  for (const a of cartesian(wideDomains(params, described, text))) {
    if (trainKeys.has(ARGS_KEY(a))) continue;
    const o = up(a);
    if (!validOut(o, ret)) { skipped++; continue; }
    held.push({ args: a, out: o });
  }
  const identityWitnesses: Record<string, number> = {};
  for (const [i, p] of params.entries()) {
    if (p.type !== ret) continue;
    const n = held.filter((r) => r.out !== r.args[i]).length;
    identityWitnesses[p.name] = n;
    if (n === 0) return { kept: false, reason: "identity_indistinguishable", detail: `no held-out row of ${held.length} has an upstream result different from ${p.name}` };
  }
  let right = 0, firstWrong: (JRow & { derived: unknown }) | null = null;
  for (const r of held) { const d = derived(r.args); if (d === r.out) right++; else if (!firstWrong) firstWrong = { ...r, derived: d }; }
  return { kept: true, label: right === held.length ? "right" : "wrong", heldRight: right, heldWrong: held.length - right, held: held.length, train: train.length, skipped, identityWitnesses, firstWrong };
}

/** The upstream function's full text (declaration or exported const) from a module's source, `export` removed. */
export function functionText(src: string, file: string, fn: string): string | null {
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true);
  for (const st of sf.statements) {
    if (ts.isFunctionDeclaration(st) && st.name?.text === fn) return st.getText(sf).replace(/^export\s+/, "");
    if (ts.isVariableStatement(st)) for (const d of st.declarationList.declarations) if (ts.isIdentifier(d.name) && d.name.text === fn) return st.getText(sf).replace(/^export\s+/, "");
  }
  return null;
}
