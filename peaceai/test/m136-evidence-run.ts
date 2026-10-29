// M136 / G17 evidence check (public-derive-from-behavior-v6): the committed, deterministic re-run of
// peaceai/rules/proposals/m136-derive-nonfinite-evidence.json. Each recorded function carries its upstream source
// text (pinned by repo@commit, path, blob and sha256 in the file); this module rebuilds the seed-136 example grid,
// re-runs PeaceAI's v6 search on the training slice extended only by its own refusals (each asked row answered by
// the upstream function), and recomputes the held-out right / wrong / non-finite counts. The upstream body is a
// one-expression pure function; it is transpiled with the repo's TypeScript and run in a fresh node:vm context
// holding only Math, Number, Boolean, isFinite and isNaN (no require, process, timers or I/O).
//   check:      peaceai/test/m136-derive-nonfinite.test.ts recomputes every record and the totals with rerunEntry
//   regenerate: node_modules/.bin/tsx peaceai/test/m136-evidence-run.ts   (rewrites only the function records)
import ts from "typescript";
import vm from "node:vm";
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { compileList, deriveListProgram, evalList, hasNonFinite, lexListValues, listIndex, listLit, listProbes, nonFiniteProbes, parseListType, valueKey, type ListArg, type ListElem, type ListRecord, type ListExample, type ListParam, type ListParamType, type ListResult } from "../lib/derive-list.ts";
import type { DeriveValue } from "../lib/derive.ts";

export const M136_SEED = 136;
/** The number pool of the grid: -150..150 with 0's and the far sides' neighbours, plus NaN, Infinity and -Infinity. */
export const M136_NUMS: readonly number[] = [-150, -101, -40, -2, -1, 0, 1, 2, 3, 7, 30, 99, 101, 150, NaN, Infinity, -Infinity];
/** List lengths of the grid rows, cycled. */
export const M136_LENS: readonly number[] = [3, 0, 1, 2, 4, 1, 5, 2, 6, 3];
export const M136_GRID_ROWS = 48;
export const M136_TRAIN = 6;
export const M136_MAX_ROWS = 40;

export interface M136Entry { fn: string; upstream: string; params: { name: string; type: string }[]; ret: string; strings?: Record<string, string[]> }
export interface M136Record {
  examples: string[]; addedForGates: string[];
  expr?: string; shape?: string; heldOut?: { right: number; wrong: number; nonFinite: number }; wrongAt?: string[];
  refused?: string; detail?: string;
}

/** A small seeded generator (mulberry32), restarted at M136_SEED for every function. */
function rng(seed: number): () => number {
  let s = seed;
  return () => { s = (s + 0x6d2b79f5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
export function typedParams(e: M136Entry): { params: ListParam[]; ret: ListParamType } {
  const params = e.params.map((p) => ({ name: p.name, type: parseListType(p.type)! }));
  const ret = parseListType(e.ret)!;
  if (params.some((p) => !p.type) || !ret) throw new Error(`type ${e.fn}`);
  return { params, ret };
}
/** The seed-136 grid of one function: 48 argument vectors, lists of the cycled lengths, values from the pools. */
export function m136Grid(e: M136Entry): ListArg[][] {
  const { params } = typedParams(e);
  const rnd = rng(M136_SEED);
  const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)]!;
  const li = listIndex(params);
  const elemT = (params[li]!.type as { list: unknown }).list;
  const strs = (f: string) => e.strings?.[f] ?? ["a", "b", "c"];
  const val = (t: string, f: string): DeriveValue => (t === "number" ? pick(M136_NUMS) : t === "boolean" ? rnd() < 0.5 : pick(strs(f)));
  const elem = (): ListElem => (typeof elemT === "string" ? val(elemT, "") : (Object.fromEntries((elemT as { fields: { name: string; type: string }[] }).fields.map((f) => [f.name, val(f.type, f.name)])) as ListRecord));
  const grid: ListArg[][] = [];
  for (let k = 0; k < M136_GRID_ROWS; k++) {
    const n = M136_LENS[k % M136_LENS.length]!;
    grid.push(params.map((p, i) => (i === li ? Array.from({ length: n }, elem) : val(p.type as string, p.name))));
  }
  return grid;
}
/** The upstream function, transpiled and run in a context with only Math, Number, Boolean, isFinite and isNaN. */
export function upstreamFn(e: M136Entry): (...a: unknown[]) => unknown {
  const js = ts.transpileModule(e.upstream.replace(/^export\s+/, ""), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  return vm.runInNewContext(`${js}\n;${e.fn}`, { Math, Number, Boolean, isFinite, isNaN }, { timeout: 1000 }) as (...a: unknown[]) => unknown;
}
const exampleLine = (x: ListExample, params: ListParam[], ret: ListParamType) => `${x.args.map((a, i) => listLit(a, params[i]!.type)).join(", ")} gives ${listLit(x.out, ret)}`;

/** Re-runs one function: training rows (and why each was added), the derivation or refusal, the held-out counts. */
export function rerunEntry(e: M136Entry): M136Record {
  const { params, ret } = typedParams(e);
  const li = listIndex(params);
  const grid = m136Grid(e);
  const run = upstreamFn(e);
  const call = (args: ListArg[]) => structuredClone(run(...structuredClone(args))) as ListArg;
  const ex = (args: ListArg[]): ListExample => ({ args, out: call(args) });
  const line = (x: ListExample) => exampleLine(x, params, ret);
  const train: ListExample[] = grid.slice(0, M136_TRAIN).map(ex);
  const added: string[] = [];
  let next = M136_TRAIN;
  // A v6 task holds a non-finite example (else v6 answers not_needed): take grid rows until one shows.
  while (!hasNonFinite(train) && next < grid.length) { const x = ex(grid[next++]!); train.push(x); added.push(`not_needed (no non-finite example yet): next grid row ${line(x)}`); }
  const input = (xs: ListExample[]) => ({ params, ret, examples: xs, nonFinite: true });
  let res: ListResult = deriveListProgram(input(train));
  for (let guard = 0; !res.ok && guard < 34 && train.length < M136_MAX_ROWS; guard++) {
    if ((res.reason === "derive_ambiguous" || res.reason === "derive_under_specified") && res.questions?.length) {
      const x = ex(res.questions[0]!.at); train.push(x);
      added.push(`${res.reason === "derive_ambiguous" ? "derive_ambiguous" : `derive_under_specified_${res.gate}`}: ${line(x)}`);
    } else if (res.reason === "derive_under_specified" && res.gate === "kept") {
      // The kept gate names its condition (PeaceAI's own compiled predicate); answer with two grid elements where it holds.
      const cond = /where `(.*)` holds/.exec(res.detail)![1]!;
      const holds = new Function("x", ...params.map((p) => p.name), `return ${cond};`) as (...a: unknown[]) => boolean;
      const two = grid.flatMap((g) => (g[li] as ListElem[]).map((x) => ({ x, g }))).filter((q) => holds(q.x, ...q.g)).slice(0, 2);
      if (two.length < 2) break;
      const x = ex(params.map((_, i) => (i === li ? two.map((q) => q.x) : two[0]!.g[i]!)) as ListArg[]); train.push(x);
      added.push(`derive_under_specified_kept (two grid elements where ${cond}): ${line(x)}`);
    } else if (res.reason === "derive_under_specified" || res.reason === "derive_no_fit" || res.reason === "derive_examples") {
      if (next >= grid.length) break;
      const x = ex(grid[next++]!); train.push(x);
      added.push(`${res.reason}${res.gate ? "_" + res.gate : ""}: next grid row ${line(x)}`);
    } else break;
    res = deriveListProgram(input(train));
  }
  const examples = train.map(line);
  // The recorded lines read back (v6 lexer) to exactly the examples.
  examples.forEach((l, i) => { const v = lexListValues(l, true); if (!v || valueKey(v.values) !== valueKey(train[i]!.args) || valueKey(v.out) !== valueKey(train[i]!.out)) throw new Error(`roundtrip ${e.fn}: ${l}`); });
  if (!res.ok) return { examples, addedForGates: added, refused: res.reason + (res.gate ? "_" + res.gate : ""), detail: res.detail };
  // Held out: the other grid rows, v4's probe lists and v6's non-finite twin probes, minus the training rows.
  const trainKeys = new Set(train.map((x) => valueKey(x.args)));
  const held = [...grid, ...(listProbes(input(train)) ?? []), ...(nonFiniteProbes(input(train), res.program) ?? [])].filter((a) => !trainKeys.has(valueKey(a)));
  let right = 0, wrong = 0, nonFinite = 0; const wrongAt: string[] = [];
  for (const a of new Map(held.map((a) => [valueKey(a), a])).values()) {
    if (hasNonFinite([{ args: a, out: 0 }])) nonFinite++;
    const want = call(a);
    if (valueKey(evalList(res.program, a, li)) === valueKey(want)) right++; else { wrong++; if (wrongAt.length < 3) wrongAt.push(line({ args: a, out: want })); }
  }
  const p = res.program;
  return {
    examples, addedForGates: added, expr: compileList(p, params.map((q) => q.name), li), shape: p.op + ("pred" in p && p.pred ? "-" + p.pred.op : ""),
    heldOut: { right, wrong, nonFinite }, ...(wrong ? { wrongAt } : {}),
  };
}

export const M136_EVIDENCE = "peaceai/rules/proposals/m136-derive-nonfinite-evidence.json";
const RECORD_KEYS = ["examples", "addedForGates", "expr", "shape", "heldOut", "wrongAt", "refused", "detail"] as const;

// Regenerate: rewrites each function's re-run fields in place (pinning fields, notes and beforeNonFiniteGate kept).
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const path = join(resolve(fileURLToPath(import.meta.url), "..", "..", ".."), M136_EVIDENCE);
  const ev = JSON.parse(readFileSync(path, "utf8")) as { functions: (M136Entry & Record<string, unknown>)[] };
  for (const f of ev.functions) {
    const r = rerunEntry(f) as unknown as Record<string, unknown>;
    for (const k of RECORD_KEYS) delete f[k];
    const keep = Object.entries(f);
    for (const k of Object.keys(f)) delete f[k];
    const [head, tail] = [keep.filter(([k]) => k !== "outOfVocabulary" && k !== "beforeNonFiniteGate"), keep.filter(([k]) => k === "outOfVocabulary" || k === "beforeNonFiniteGate")];
    Object.assign(f, Object.fromEntries(head), Object.fromEntries(RECORD_KEYS.filter((k) => r[k] !== undefined).map((k) => [k, r[k]])), Object.fromEntries(tail));
    console.log(`${f.fn}: ${r.expr ?? `REFUSED ${String(r.refused)}`} ${JSON.stringify(r.heldOut ?? {})}`);
  }
  writeFileSync(path, JSON.stringify(ev, null, 1) + "\n");
}
