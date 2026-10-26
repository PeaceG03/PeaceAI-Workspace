// M114 random harness for the v5 string-parser engine (Auditor #530): a measurement script, not a test and not run by CI.
//
//   node_modules/.bin/tsx peaceai/bin/derive-string-harness.ts [seeds] [tasks]
//     seeds  a seed or a range, default 1-9;  tasks  tasks per seed, default 200
//   e.g.  node_modules/.bin/tsx peaceai/bin/derive-string-harness.ts 1-9 200
//
// Each task draws a random in-vocabulary reference (field indices 0-3 or q, delimiters | , : / space = ; _, defaults
// none / ? / 99 / 7, lines padded left, right or both, and one task in ten whose example lines have a single field),
// draws examples until they take every path of the reference, then derives, answering asked rows with the reference
// (8 rounds at most). A derived program is checked on 300 fresh lines plus, for 120 of them and every example, each
// first-k-fields cut (bare, padded left / right / both, with a trailing delimiter) and the line re-joined on every
// other delimiter. A wrong program counts as UNRECOVERABLE when the reference splits on a delimiter that splits no
// example or asked row (no search over the examples can see it), else as WRONG. Prints one line per wrong program,
// one JSON line per seed and a total line. Deterministic for a given engine, seed and task count.
import { readsQ, compileStr, deriveStringProgram, evalStr, outKey, validProgram, type StrArg, type StrParam, type StrProgram, type StrRet, type XNode } from "../lib/derive-string.ts";
const rng = (seed: number) => () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const [lo, hi] = (process.argv[2] ?? "1-9").split("-").map(Number) as [number, number?];
const N = Number(process.argv[3] ?? 200);
const total = { ok: 0, refused: 0, wrong: 0, unrecoverable: 0, unwitnessed: 0 };
let R = rng(0);
const pick = <T>(a: readonly T[]): T => a[Math.floor(R() * a.length)]!;
const TOK = ["scan", "r2", "tenmin", "ok", "error", "late", "12", "0", "-3", "45", "x", "", " ok", "ok ", "#slow", "part:scan", "7x", "daily"];
const DELIMS = ["|", ",", ":", "/", " ", "=", ";", "_"];
let ONE = false;
function line(d: string): string { const k = ONE ? 1 : 1 + Math.floor(R() * 5); const pad = R(); const core = Array.from({ length: k }, () => pick(TOK)).join(d); return pad < 0.12 ? ` ${core}` : pad < 0.24 ? `${core} ` : pad < 0.32 ? ` ${core} ` : core; }
function x(d: string, q: "number" | "string" | null, strips: boolean): XNode {
  const r = R();
  const piece = r < 0.15 ? { k: "whole" as const } : r < 0.55 ? { k: "field" as const, d, i: q === "number" && R() < 0.4 ? "q" as const : Math.floor(R() * 4) } : r < 0.65 ? { k: "last" as const, d } : r < 0.8 || !strips ? { k: "rest" as const, d, i: 1 + Math.floor(R() * 2) } : { k: "strip" as const, side: pick(["prefix", "suffix"] as const), p: q === "string" && R() < 0.4 ? "q" as const : pick(["part:", "#", "x", "ok"]) };
  return { trim: R() < 0.3, piece, post: piece.k !== "whole" && R() < 0.4 };
}
function truth(): { prog: StrProgram; ret: StrRet; params: StrParam[] } {
  const d = pick(DELIMS);
  const ret = pick(["string", "string", "number", "boolean", "boolean", "string[]"] as const);
  const q = ret !== "string[]" && R() < 0.25 ? (ret === "boolean" || ret === "string" ? pick(["number", "string"] as const) : "number") : null;
  const params: StrParam[] = [{ name: "line", type: "string" }, ...(q ? [{ name: "q", type: q }] : [])];
  let prog: StrProgram;
  for (;;) {
  if (ret === "string") prog = { op: "str", x: x(d, q, true), dflt: pick(["", "none", "unknown", "?"]) };
  else if (ret === "number") { const r = R(); prog = r < 0.6 ? { op: "int", x: x(d, q, false), lenient: R() < 0.3, dflt: pick([0, -1, 99, 7]) } : r < 0.8 ? { op: "count", trim: R() < 0.3, d } : { op: "len", x: x(d, q, false) }; }
  else if (ret === "boolean") prog = R() < 0.85 ? { op: "test", x: x(d, q, false), test: pick(["starts", "ends", "has", "eq"] as const), c: q === "string" && R() < 0.4 ? "q" : pick(["ok", "error", "#", "scan", "1", ""]), neg: R() < 0.3 } : { op: "isint", x: x(d, q, false), neg: R() < 0.3 };
  else prog = { op: "split", trim: R() < 0.3, d, each: R() < 0.5, drop: R() < 0.3 };
  if (prog.op === "str" && (!("x" in prog) || !["field", "rest"].includes(prog.x.piece.k) || (prog.x.piece.k === "field" && prog.x.piece.i === 0))) prog.dflt = "";
  if (prog.op === "test" && prog.c === "" && prog.test !== "eq") prog.c = "ok";
  if (!q || readsQ(prog)) break;
  }
  return { prog, ret, params };
}
const args = (t: ReturnType<typeof truth>, d: string): StrArg[] => {
  const a: StrArg[] = [line(d)];
  if (t.params[1]) a.push(t.params[1].type === "number" ? Math.floor(R() * 4) : pick(["ok", "#", "scan", "part:", "x", "error"]));
  return a;
};
for (let seed = lo; seed <= (hi ?? lo); seed++) {
R = rng(seed);
let unwitnessed = 0, unrecoverable = 0; let ok = 0, refused = 0, wrong = 0, invalid = 0; const reasons: Record<string, number> = {}; const asks: number[] = [];
for (let n = 0; n < N; n++) {
  const t = truth(); ONE = R() < 0.1;
  if (!validProgram(t.prog, t.params)) { invalid++; continue; }
  const d = "d" in t.prog ? t.prog.d : "x" in t.prog && "d" in t.prog.x.piece ? t.prog.x.piece.d : pick(DELIMS);
  if (t.params[1] && !readsQ(t.prog)) { invalid++; continue; }
  let ex: StrArg[][] = [];
  let witnessed = false;
  for (let tries = 0; tries < 30 && !witnessed; tries++) {
    ex = Array.from({ length: 6 + Math.floor(R() * 8) }, () => args(t, d));
    const seen = new Set<string>(), outs = ex.map((a) => outKey(evalStr(t.prog, a, (p) => seen.add(p))));
    const need = pathsNeeded(t.prog);
    const tc = outs.filter((o) => o === "true").length, fc = outs.filter((o) => o === "false").length;
    witnessed = need.every((p) => seen.has(p)) && (t.ret === "boolean" ? tc >= 2 && fc >= 2 : new Set(outs).size >= 2);
  }
  if (!witnessed) { unwitnessed++; continue; }
  let res; let asked = 0;
  for (let r = 0; r < 8; r++) {
    res = deriveStringProgram({ params: t.params, ret: t.ret, examples: ex.map((a) => ({ args: a, out: evalStr(t.prog, a) })) });
    if (res.ok || !res.questions?.length) break;
    for (const q of res.questions) { ex.push(q.at); asked++; }
  }
  if (!res!.ok) { refused++; const k = res!.reason + ("gate" in res! ? "_" + res!.gate : ""); reasons[k] = (reasons[k] ?? 0) + 1; continue; }
  asks.push(asked);
  ONE = false;
  const base = Array.from({ length: 300 }, () => args(t, R() < 0.8 ? d : pick(DELIMS)));
  const fresh: StrArg[][] = [...base];
  for (const a of [...base.slice(0, 120), ...ex]) {
    const l = a[0] as string, f = l.split(d);
    for (let k = 1; k <= f.length; k++) { const c = f.slice(0, k).join(d); for (const v of [c, ` ${c}`, `${c} `, ` ${c} `, `${c}${d}`, `${c}${d} `]) fresh.push([v, ...a.slice(1)]); }
    for (const o of DELIMS) fresh.push([l.split(d).join(o), ...a.slice(1)]);
  }
  const bad = fresh.find((a) => outKey(evalStr(res!.program, a)) !== outKey(evalStr(t.prog, a)));
  const tsd = "d" in t.prog ? { trim: t.prog.trim, d: t.prog.d } : "x" in t.prog && "d" in t.prog.x.piece ? { trim: t.prog.x.trim, d: t.prog.x.piece.d } : null;
  const unreach = !!tsd && ex.every((a) => (tsd.trim ? (a[0] as string).trim() : (a[0] as string)).split(tsd.d).length === 1);
  if (bad && unreach) { unrecoverable++; console.log("UNRECOVERABLE", seed, JSON.stringify(t.prog), "->", compileStr(res!.program, t.params.map((p) => p.name))); }
  else if (bad) { wrong++; console.log("WRONG", seed, JSON.stringify(t.prog), "->", compileStr(res!.program, t.params.map((p) => p.name)), "at", JSON.stringify(bad), outKey(evalStr(res!.program, bad)), "vs", outKey(evalStr(t.prog, bad))); }
  else ok++;
}
console.log(JSON.stringify({ seed, ok, refused, wrong, unrecoverable, invalid, unwitnessed, reasons, meanAsked: Math.round((asks.reduce((a, b) => a + b, 0) / Math.max(1, asks.length)) * 100) / 100 }));
total.ok += ok; total.refused += refused; total.wrong += wrong; total.unrecoverable += unrecoverable; total.unwitnessed += unwitnessed;
}
console.log(JSON.stringify({ seeds: `${lo}-${hi ?? lo}`, tasks: N, ...total }));

function pathsNeeded(p: StrProgram): string[] {
  const out: string[] = [];
  if ("x" in p) { const c = p.x.piece; if ((c.k === "field" && c.i !== 0) || c.k === "rest") out.push("miss", "have"); if (c.k === "strip") out.push("strip-yes", "strip-no"); }
  if (p.op === "int") out.push("int-ok", "int-fail");
  return out;
}
