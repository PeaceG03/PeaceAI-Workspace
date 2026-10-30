// G18 derive-wire v2 (public-derive-wire-v2, kind EXISTING_EDIT; peaceai/spec/derive-wire-v2.md). Like v1, the
// issue names an existing function or class method and states in prose plus data-only fake examples what must
// happen when a collaborator call fails; it holds no code (v1's parseWireTask and anti-copy guards, unchanged). Two
// asks, each its own closed template whose holes PeaceAI's search fills from the module, the repo's existing pure
// helpers, numbers stated in the prose and the examples (exactly one fit, else refuse):
//
//   "retry a failing call"            (retryEdit) the target's final `return this.F(..)` becomes a bounded loop:
//       every attempt re-runs the statements before it (signs again), calls F with its OWN timeout signal, and
//       retries only a rejected call (network error / timeout) or a response whose status the existing predicate S
//       accepts, while the existing limit predicate A(failed tries) allows, waiting the existing D(attempt, base)
//       through an injected `sleep` (the seam is added in the class's existing config-injection pattern if missing).
//       S, A, D: exported pure numeric helpers anywhere in the repo's in-scope source (numHelper); the timeout and
//       base wait: numbers stated in the Behavior prose. The examples pin S, A and D by simulation; twin programs
//       (no retry, retry every response, no limit) must each MISS the examples, so a no-op or always-retry program
//       cannot pass.
//   "record a failing call and go on" (recordEdit) one awaited call (statement or `const X = await ..`) directly in a
//       for-of loop of the target: a failure the filter matches is pushed to an existing local list of the target
//       and the loop moves to the next item (the item is NOT processed further, so it is not marked done); any other
//       failure is re-thrown. The filter (one closed error read compared with a word of the Behavior prose, equal or
//       prefix), the list and the record (closed error reads and the loop item) are pinned by the examples, which must
//       hold a skipped item with its record AND a non-matching error that propagates (G26: v1's bare
//       `catch { continue; }` swallowed everything and left no record; it is never used here).
//
// The derived edit is gated by Job B's own static check (gradeExistingEditProblem: retryEditShape / recordEditShape
// re-recognition, capability delta, hermetic walk before and after, test shape), then graded as every EXISTING_EDIT.
import ts from "typescript";
import { rawIssueProblem } from "./learned-derive.ts";
import { argValue, failureOf, injections, paramValue, parseWireTask, type ErrorInfo, WIRE_MAX_CANDIDATES, calleeName, callsIn, insideTry } from "./derive-wire.ts";
import { editablePath, emitFakeTest, evalNumHelper, evalWireHelper, existingEditSlug, findTarget, gradeExistingEditProblem, injectedKeyOf, isExcludedSource, isWire2Params, isWire2RethrowParams, numHelper, ownStatements, parseExpression, parseFakeTest, recordEdit, recordLists, recordSite, RETHROW_ARG_IDS, rethrowEdit, retryEdit, retryLoopOf, uniqueSplit, WIRE_ARG_FORMS, WIRE_FAKE_HARNESS, wireHelper, type ExistingEdit, type NumHelper, type Read, type RecordHoles, type RethrowHoles, type RetryHoles, type WireHelper } from "./learned-edit-existing.ts";
import { importStyle } from "./learned-test.ts";
import { MAX_OBJECTIVE_CHARS } from "./taskmap.ts";
import { createHash } from "node:crypto";

const NAME = String.raw`[A-Za-z_$][\w$]*`;
export const DERIVE_WIRE_V2_TRIGGER = String.raw`^in the existing (?:function (?<fn>${NAME})|method (?<method>${NAME}) of class (?<cls>${NAME})) in (?<file>src\/[\w./-]+\.ts) ?, (?<ask>retry a failing call|record a failing call and go on) ?\.?$`;
/**
 * G29 (public-derive-wire-rethrow-v1): its own spec and trigger (v1's header form, ask "handle a failing call"), so
 * public-derive-wire-v2's spec, trigger and approved hash stay byte for byte. It is reached only with the rethrow
 * vocabulary (isWire2RethrowParams); v1 (unapproved) keeps its own trigger and never reaches this code.
 */
export const DERIVE_WIRE_V2_RETHROW_TRIGGER = String.raw`^in the existing (?:function (?<fn>${NAME})|method (?<method>${NAME}) of class (?<cls>${NAME})) in (?<file>src\/[\w./-]+\.ts) ?, (?<ask>handle a failing call) ?\.?$`;
const RETRY_MAX_ATTEMPTS = 12;

type Value = string | number | boolean | null | Value[] | { [k: string]: Value };
/** A data literal of the examples as a plain value (strings, numbers, booleans, null, arrays, objects), else undefined. */
function valueOf(e: ts.Expression): Value | undefined {
  if (ts.isStringLiteral(e)) return e.text;
  if (ts.isNumericLiteral(e)) return Number(e.text);
  if (ts.isPrefixUnaryExpression(e) && e.operator === ts.SyntaxKind.MinusToken && ts.isNumericLiteral(e.operand)) return -Number(e.operand.text);
  if (e.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (e.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (e.kind === ts.SyntaxKind.NullKeyword) return null;
  if (ts.isArrayLiteralExpression(e)) { const xs = e.elements.map((x) => valueOf(x)); return xs.every((x) => x !== undefined) ? (xs as Value[]) : undefined; }
  if (ts.isObjectLiteralExpression(e)) {
    const o: { [k: string]: Value } = {};
    for (const p of e.properties) { if (!ts.isPropertyAssignment(p) || !(ts.isIdentifier(p.name) || ts.isStringLiteral(p.name))) return undefined; const v = valueOf(p.initializer); if (v === undefined) return undefined; o[p.name.text] = v; }
    return o;
  }
  return undefined;
}
const arraysIn = (v: Value | undefined, out: string[] = []): string[] => {
  if (Array.isArray(v)) { out.push(JSON.stringify(v)); v.forEach((x) => arraysIn(x, out)); }
  else if (v && typeof v === "object") Object.values(v).forEach((x) => arraysIn(x, out));
  return out;
};

interface Expect { bullet: number; call: ts.CallExpression; kind: "resolves" | "returns" | "rejects" | "throws"; value: Value | undefined; message: string | null; inject: Map<string, { owner: string; outcomes: ts.Expression[] }[]> }
interface Examples { expects: Expect[]; counts: Map<string, number>; args: Map<string, Value>; uses: Map<string, number> }
function examplesOf(bullets: readonly string[], sf: ts.SourceFile): Examples | null {
  const fakes = new Map<string, ts.Expression>();
  const expects: Expect[] = [];
  const counts = new Map<string, number>(), args = new Map<string, Value>();
  for (const [i, b] of bullets.entries()) {
    const m = /^- fake ([A-Za-z][\w$]*) = (.+)$/.exec(b);
    if (m) { const e = parseExpression(m[2]!); if (!e) return null; fakes.set(m[1]!, e); continue; }
    const rest = b.slice("- expect ".length);
    const cnt = /^([A-Za-z][\w$]*(?:\.[A-Za-z_$][\w$]*)?) is called (\d{1,3}) times?$/.exec(rest);
    if (cnt) { if (counts.has(cnt[1]!)) return null; counts.set(cnt[1]!, Number(cnt[2])); continue; }
    const cw = /^([A-Za-z][\w$]*) is called with (\[.*\])$/.exec(rest);
    if (cw) { const e = parseExpression(`[${cw[2]!}]`); const v = e ? valueOf(e) : undefined; if (v === undefined || args.has(cw[1]!)) return null; args.set(cw[1]!, v); continue; }
    const kinds = [[" resolves to ", "resolves"], [" returns ", "returns"], [" rejects with ", "rejects"], [" throws ", "throws"]] as const;
    const hits = kinds.map(([sep, kind]) => uniqueSplit(rest, sep, (l, r) => {
      const ce = parseExpression(l), re = parseExpression(r);
      return ce && re && ts.isCallExpression(ce) ? { call: ce, kind, re } : null;
    })).filter((x) => x !== null);
    if (hits.length !== 1) return null;
    const h = hits[0]!;
    expects.push({ bullet: i, call: h.call, kind: h.kind, value: valueOf(h.re), message: ts.isStringLiteral(h.re) ? h.re.text : null, inject: injections(h.call, fakes, sf, i) });
  }
  const uses = new Map<string, number>();
  for (const s of expects) for (const owner of new Set([...s.inject.values()].flat().map((x) => x.owner))) uses.set(owner, (uses.get(owner) ?? 0) + 1);
  return { expects, counts, args, uses };
}

/** Every exported pure numeric helper of the in-scope source, with the module it lives in. */
function helperPool(files: readonly { path: string; content: string }[], isTest: (p: string) => boolean): { h: NumHelper; path: string }[] {
  const out: { h: NumHelper; path: string }[] = [];
  for (const f of files) {
    if (isTest(f.path) || isExcludedSource(f.path) || !/^src\/[\w./-]+\.ts$/.test(f.path) || f.path.endsWith(".d.ts")) continue;
    const sf = ts.createSourceFile(f.path, f.content, ts.ScriptTarget.Latest, true);
    for (const s of sf.statements) if (ts.isFunctionDeclaration(s) && s.name) { const h = numHelper(sf, s.name.text); if (h) out.push({ h, path: f.path }); }
  }
  return out.sort((a, b) => (a.path + a.h.name < b.path + b.h.name ? -1 : 1));
}
const relSpec = (from: string, to: string, style: "ts" | "none"): string => {
  const a = from.split("/").slice(0, -1), b = to.split("/");
  let i = 0;
  while (i < a.length && i < b.length - 1 && a[i] === b[i]) i++;
  const up = a.length - i;
  const rest = b.slice(i).join("/");
  const spec = `${up ? "../".repeat(up) : "./"}${rest}`;
  return style === "ts" ? spec : spec.replace(/\.ts$/, "");
};

const prose = (behavior: string, re: RegExp): number[] => [...behavior.matchAll(re)].map((m) => Number(m[1]) * (/^s/i.test(m[2]!) ? 1000 : 1));

export type V2Derivation = { kind: "retry"; holes: RetryHoles } | { kind: "record"; holes: RecordHoles } | { kind: "rethrow"; holes: RethrowHoles };
type Refusal = { reason: string; detail?: string };

// ---------------------------------------------------------------------------------------------------------------
// retry
// ---------------------------------------------------------------------------------------------------------------
type Outcome = { fail: true } | { fail: false; status: number };
const outcomeOf = (o: ts.Expression): Outcome | null => {
  if (failureOf(o)) return { fail: true };
  if (!ts.isCallExpression(o) || !ts.isIdentifier(o.expression) || o.expression.text !== "resolves" || o.arguments.length !== 1) return null;
  const r = o.arguments[0]!;
  return ts.isCallExpression(r) && ts.isIdentifier(r.expression) && r.expression.text === "response" && r.arguments[0] && ts.isNumericLiteral(r.arguments[0]) ? { fail: false, status: Number(r.arguments[0].text) } : null;
};
type Policy = { retryStatus: (s: number) => boolean; allowed: (failed: number) => boolean; delay: (a: number) => number };
function simulate(p: Policy, outs: readonly Outcome[]): { calls: number; sleeps: number[] } | null {
  const sleeps: number[] = [];
  for (let a = 0; a < RETRY_MAX_ATTEMPTS; a++) {
    const o = outs[Math.min(a, outs.length - 1)]!;
    if (!o.fail && !p.retryStatus(o.status)) return { calls: a + 1, sleeps };
    if (!p.allowed(a + 1)) return { calls: a + 1, sleeps };
    const d = p.delay(a);
    if (!Number.isFinite(d) || d < 0) return null;
    sleeps.push(d);
  }
  return null; // never stops within RETRY_MAX_ATTEMPTS: not a bounded retry
}

function deriveRetry(task: { target: string; file: string; behavior: string; bullets: string[] }, files: readonly { path: string; content: string }[], isTest: (p: string) => boolean): V2Derivation | Refusal {
  const file = files.find((f) => f.path === task.file)!;
  const sf = ts.createSourceFile(file.path, file.content, ts.ScriptTarget.Latest, true);
  const t = findTarget(sf, task.target);
  if (!t?.node.body) return { reason: "wire_target" };
  if (t.kind !== "method") return { reason: "wire_retry_target" };
  const stmts = t.node.body.statements;
  const last = stmts[stmts.length - 1];
  const callee = last && ts.isReturnStatement(last) && last.expression && ts.isCallExpression(last.expression) ? last.expression.expression : null;
  if (!callee || !ts.isPropertyAccessExpression(callee) || callee.expression.kind !== ts.SyntaxKind.ThisKeyword) return { reason: "wire_retry_site" };
  const site = callee.name.text;
  const key = injectedKeyOf(sf, t.classNode, site);
  if (!key) return { reason: "wire_retry_seam" };
  const timeouts = prose(task.behavior, /\btimes? out after (\d{1,6}) ?(seconds?|ms|milliseconds?)\b/gi);
  const bases = prose(task.behavior, /\bbase wait of (\d{1,6}) ?(seconds?|ms|milliseconds?)\b/gi);
  if (timeouts.length !== 1) return { reason: "wire_retry_timeout_unstated" };
  if (bases.length !== 1) return { reason: "wire_retry_base_unstated" };
  const ex = examplesOf(task.bullets, sf);
  if (!ex || !ex.expects.length) return { reason: "wire_examples" };
  // per example: the site fake's outcomes and its sleep fake; the counts / sleep arguments the examples expect
  type Row = { outs: Outcome[]; siteOwner: string; sleepOwner: string | null };
  const rows: Row[] = [];
  for (const e of ex.expects) {
    const s = e.inject.get(key) ?? [];
    if (s.length > 1) return { reason: "wire_fake_ambiguous" };
    if (!s.length) continue;
    const outs = s[0]!.outcomes.map(outcomeOf);
    if (outs.some((o) => o === null)) return { reason: "wire_retry_examples" };
    const sl = e.inject.get("sleep") ?? [];
    if (sl.length > 1) return { reason: "wire_fake_ambiguous" };
    for (const o of [s[0]!.owner, sl[0]?.owner].filter((x): x is string => !!x)) if ((ex.uses.get(o) ?? 0) > 1) return { reason: "wire_fake_shared" };
    rows.push({ outs: outs as Outcome[], siteOwner: s[0]!.owner, sleepOwner: sl[0]?.owner ?? null });
  }
  if (!rows.some((r) => ex.counts.has(r.siteOwner))) return { reason: "wire_retry_unpinned" };
  const fits = (p: Policy): boolean => rows.every((r) => {
    const sim = simulate(p, r.outs);
    if (!sim) return false;
    if (ex.counts.has(r.siteOwner) && ex.counts.get(r.siteOwner) !== sim.calls) return false;
    if (r.sleepOwner && ex.counts.has(r.sleepOwner) && ex.counts.get(r.sleepOwner) !== sim.sleeps.length) return false;
    if (r.sleepOwner && ex.args.has(r.sleepOwner) && JSON.stringify(ex.args.get(r.sleepOwner)) !== JSON.stringify(sim.sleeps.map((d) => [d]))) return false;
    if (!r.sleepOwner && sim.sleeps.length) return false; // a retry with no injected sleep would wait for real
    return true;
  });
  const pool = helperPool(files, isTest);
  const preds = pool.filter((x) => x.h.returns === "boolean" && x.h.params.length === 1);
  const delays = pool.filter((x) => x.h.returns === "number" && x.h.params.length === 2);
  if (preds.length * preds.length * delays.length > WIRE_MAX_CANDIDATES) return { reason: "wire_search_too_large" };
  const base = bases[0]!;
  const found: { S: (typeof pool)[number]; A: (typeof pool)[number]; D: (typeof pool)[number] }[] = [];
  for (const S of preds) for (const A of preds) for (const D of delays) {
    const p: Policy = { retryStatus: (s) => evalNumHelper(S.h, [s]) === true, allowed: (n) => evalNumHelper(A.h, [n]) === true, delay: (a) => evalNumHelper(D.h, [a, base]) as number };
    if (fits(p)) found.push({ S, A, D });
  }
  if (!found.length) return { reason: "wire_no_fit" };
  if (found.length > 1) return { reason: "wire_ambiguous", detail: String(found.length) };
  const { S, A, D } = found[0]!;
  // twin checks: each simpler program must MISS the examples (no retry at all; retry every response; no limit)
  const chosen: Policy = { retryStatus: (s) => evalNumHelper(S.h, [s]) === true, allowed: (n) => evalNumHelper(A.h, [n]) === true, delay: (a) => evalNumHelper(D.h, [a, base]) as number };
  const twins: [string, Policy][] = [
    ["no-retry", { ...chosen, allowed: () => false }],
    ["retry-every-response", { ...chosen, retryStatus: () => true }],
    ["no-limit", { ...chosen, allowed: () => true }],
  ];
  for (const [name, p] of twins) if (fits(p)) return { reason: "wire_twin_fits", detail: name };
  // the module's own import style: the repo's source imports when it has relative ones, else its tests' style
  const srcRel = files.some((f) => !isTest(f.path) && /^import [^;]*? from "\.{1,2}\//m.test(f.content));
  const style = srcRel ? importStyle(files, (p) => !isTest(p)) : importStyle(files, isTest);
  const imports = [...new Map([S, A, D].filter((x) => x.path !== file.path).map((x) => [x.h.name, { name: x.h.name, from: relSpec(file.path, x.path, style) }])).values()];
  return { kind: "retry", holes: { target: task.target, site, status: S.h.name, allowed: A.h.name, delay: D.h.name, timeoutMs: timeouts[0]!, baseMs: base, imports } };
}

// ---------------------------------------------------------------------------------------------------------------
// recorded skip
const paramNames = (fn: ts.FunctionLikeDeclaration): Set<string> => new Set(fn.parameters.flatMap((p) => (ts.isIdentifier(p.name) ? [p.name.text] : ts.isObjectBindingPattern(p.name) ? p.name.elements.flatMap((e) => (ts.isIdentifier(e.name) ? [e.name.text] : [])) : [])));
function hasSeam(c: ts.CallExpression, fn: ts.FunctionLikeDeclaration): boolean {
  const ps = paramNames(fn);
  if (ts.isIdentifier(c.expression)) return ps.has(c.expression.text);
  if (!ts.isPropertyAccessExpression(c.expression)) return false;
  let root: ts.Expression = c.expression.expression;
  while (ts.isPropertyAccessExpression(root)) root = root.expression;
  if (!ts.isIdentifier(root)) return false;
  if (ps.has(root.text)) return true;
  const name = root.text;
  let init: ts.Expression | undefined;
  const v = (n: ts.Node): void => { if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === name) init = n.initializer; else ts.forEachChild(n, v); };
  if (fn.body) v(fn.body);
  if (!init) return false;
  let e: ts.Expression = init;
  if (ts.isBinaryExpression(e) && e.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken) e = e.left;
  while (ts.isPropertyAccessExpression(e)) e = e.expression;
  return ts.isIdentifier(e) && ps.has(e.text);
}
// ---------------------------------------------------------------------------------------------------------------
const readValue = (id: string, e: ErrorInfo): string => argValue(id, e, new Map())!;
/** argValue plus the G29-only network-message read (RETHROW_NETWORK_MESSAGE, simulated on the example's error). */
const NETWORK_WORDS = new Set(["TimeoutError", "AbortError"]);
const rethrowArgValue = (a: string, e: ErrorInfo, params: ReadonlyMap<string, string | null>): string | null =>
  a === "message.network" ? (e.message === "fetch failed" || NETWORK_WORDS.has(e.name ?? "Error") ? e.message : e.name ?? "Error") : argValue(a, e, params);
function deriveRecord(task: { target: string; file: string; behavior: string; bullets: string[] }, files: readonly { path: string; content: string }[]): V2Derivation | Refusal {
  const file = files.find((f) => f.path === task.file)!;
  const sf = ts.createSourceFile(file.path, file.content, ts.ScriptTarget.Latest, true);
  const t = findTarget(sf, task.target);
  if (!t?.node.body) return { reason: "wire_target" };
  if (!t.node.modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword)) return { reason: "wire_record_not_async" };
  const ex = examplesOf(task.bullets, sf);
  if (!ex || !ex.expects.length) return { reason: "wire_examples" };
  const failingKeys = new Set<string>();
  for (const s of ex.expects) for (const [k, injs] of s.inject) if (injs.some((x) => x.outcomes.some((o) => failureOf(o)))) failingKeys.add(k);
  const sites = ownStatements(t.node.body).filter((s) => (ts.isExpressionStatement(s) || ts.isVariableStatement(s)) && !insideTry(s, t.node.body!) && callsIn(s).some((c) => failingKeys.has(calleeName(c) ?? "")));
  if (!sites.length) return { reason: "wire_site_none" };
  // the failing collaborator must come in through the target's own parameters (the seam the fakes use): its receiver
  // is a parameter, or a local initialised from a parameter's property (`P.k` / `P.k ?? default`); a collaborator the
  // target builds itself (`new Scanner(..)`) has no seam: refused by name, never faked through a module mock
  const seamed = sites.filter((s) => callsIn(s).some((c) => failingKeys.has(calleeName(c) ?? "") && hasSeam(c, t.node)));
  if (!seamed.length) return { reason: "wire_no_seam" };
  if (seamed.length > 1 || sites.length > 1) return { reason: "wire_site_ambiguous" };
  const siteText = sites[0]!.getText(sf);
  const rs = recordSite(sf, t, siteText);
  if (!rs) return { reason: "wire_record_site" };
  const keys = new Set(callsIn(sites[0]!).map((c) => calleeName(c)).filter((k): k is string => !!k && failingKeys.has(k)));
  if (keys.size !== 1) return { reason: "wire_site_ambiguous" };
  const key = [...keys][0]!;
  // the loop runs over a parameter of the target; each example calls the target directly with that list as data
  const over = rs.loop.expression;
  const pIdx = ts.isIdentifier(over) ? t.node.parameters.findIndex((p) => ts.isIdentifier(p.name) && p.name.text === over.text) : -1;
  if (pIdx < 0) return { reason: "wire_record_loop" };
  const direct = (c: ts.CallExpression): boolean => (t.kind === "function" ? ts.isIdentifier(c.expression) && c.expression.text === t.name : ts.isPropertyAccessExpression(c.expression) && c.expression.name.text === t.name && ts.isNewExpression(c.expression.expression) && c.expression.expression.expression.getText() === t.cls);
  type Run = { items: Value[]; outs: (ErrorInfo | null)[]; e: Expect };
  const runs: Run[] = [];
  for (const e of ex.expects) {
    const s = e.inject.get(key) ?? [];
    if (s.length > 1) return { reason: "wire_fake_ambiguous" };
    if (!s.length) continue;
    if ((ex.uses.get(s[0]!.owner) ?? 0) > 1) return { reason: "wire_fake_shared" };
    if (!direct(e.call)) return { reason: "wire_record_entry" };
    const arg = e.call.arguments[pIdx];
    const items = arg ? valueOf(arg) : undefined;
    if (!Array.isArray(items)) return { reason: "wire_record_entry" };
    runs.push({ items, outs: s[0]!.outcomes.map((o) => failureOf(o)), e });
  }
  if (!runs.length) return { reason: "wire_no_failing_example" };
  // the examples' split: a failure inside a run that settles normally is MATCHING (recorded); the failure a rejecting
  // run ends with (its own message) is NON-MATCHING (must propagate)
  const outAt = (r: Run, i: number) => r.outs[Math.min(i, r.outs.length - 1)] ?? null;
  const matching: ErrorInfo[] = [], nonMatching: ErrorInfo[] = [];
  for (const r of runs) {
    const fails = r.items.map((_, i) => outAt(r, i)).filter((x): x is ErrorInfo => x !== null);
    if (r.e.kind === "resolves" || r.e.kind === "returns") matching.push(...fails);
    else { const first = fails[0]; if (!first || r.e.message !== first.message) return { reason: "wire_no_fit" }; nonMatching.push(first); }
  }
  if (!nonMatching.length) return { reason: "wire_filter_unpinned" };
  if (!runs.some((r) => (r.e.kind === "resolves" || r.e.kind === "returns") && r.items.some((_, i) => outAt(r, i) !== null && r.items.slice(i + 1).some((__, j) => outAt(r, i + 1 + j) === null)))) return { reason: "wire_skip_unpinned" };
  // candidates: filter (closed read, = or prefix, literal a word of the Behavior prose), list, record
  const words = new Set(task.behavior.split(/\s+/).map((w) => w.replace(/^[,.:()]+|[,.:()]+$/g, "")).filter((w) => /^[\w-]{1,80}$/.test(w)));
  const filters: RecordHoles["filter"][] = [];
  for (const f of WIRE_ARG_FORMS) for (const w of words) for (const op of ["eq", "prefix"] as const) {
    const test = (e: ErrorInfo) => { const v = readValue(f.id, e); return op === "eq" ? v === w : v.startsWith(w); };
    if (matching.every(test) && !nonMatching.some(test)) filters.push({ read: f.id, op, lit: w });
  }
  if (!filters.length) return { reason: "wire_no_fit", detail: "filter" };
  const lists = recordLists(sf, t, rs.loop);
  const records: { list: string; record: RecordHoles["record"] }[] = [];
  const pool = [...WIRE_ARG_FORMS.map((f) => f.id), "item"];
  for (const l of lists) {
    if (!l.fields) { for (const v of pool) records.push({ list: l.name, record: { kind: "line", value: v } }); continue; }
    const idx = new Array<number>(l.fields.length).fill(0);
    for (;;) {
      records.push({ list: l.name, record: { kind: "object", fields: l.fields.map((k, i) => [k, pool[idx[i]!]!] as [string, string]) } });
      let d = l.fields.length - 1;
      while (d >= 0 && ++idx[d]! === pool.length) { idx[d] = 0; d -= 1; }
      if (d < 0) break;
    }
  }
  if (filters.length * records.length > WIRE_MAX_CANDIDATES) return { reason: "wire_search_too_large" };
  const valueFor = (v: string, e: ErrorInfo, item: Value): Value | undefined => (v === "item" ? (typeof item === "string" ? item : undefined) : readValue(v, e));
  const recOf = (r: RecordHoles["record"], e: ErrorInfo, item: Value): Value | undefined => {
    if (r.kind === "line") return valueFor(r.value, e, item);
    const o: { [k: string]: Value } = {};
    for (const [k, v] of r.fields) { const x = valueFor(v, e, item); if (x === undefined) return undefined; o[k] = x; }
    return o;
  };
  const found: RecordHoles[] = [];
  for (const filter of filters) for (const { list, record } of records) {
    const ok = runs.every((r) => {
      if (r.e.kind !== "resolves" && r.e.kind !== "returns") return true;
      const recs: Value[] = [];
      for (const [i, item] of r.items.entries()) { const e = outAt(r, i); if (!e) continue; const v = recOf(record, e, item); if (v === undefined) return false; recs.push(v); }
      return !recs.length || arraysIn(r.e.value).includes(JSON.stringify(recs));
    });
    if (ok) found.push({ target: task.target, site: siteText, filter, list, record });
  }
  if (!found.length) return { reason: "wire_no_fit" };
  // G31 (Auditor, Oct 30): a record never holds the plain message or the cause's message; a fit that needs one is
  // refused by name (recordFilteredFits), never emitted
  const kept = recordFilteredFits(found);
  if (typeof kept === "string") return { reason: kept };
  if (kept.length > 1) return { reason: "wire_ambiguous", detail: String(kept.length) };
  return { kind: "record", holes: kept[0]! };
}

// ---------------------------------------------------------------------------------------------------------------
// G29: rethrow at the retry limit ("handle a failing call" on a method that is already the v2 retry template)
// ---------------------------------------------------------------------------------------------------------------
/** A pure numeric helper the template names: declared in the module, or the single-name relative import of it. */
function templateHelper(sf: ts.SourceFile, path: string, name: string, files: readonly { path: string; content: string }[]): NumHelper | null {
  const local = numHelper(sf, name);
  if (local) return local;
  const d = sf.statements.find((s): s is ts.ImportDeclaration => ts.isImportDeclaration(s) && !!s.importClause?.namedBindings && ts.isNamedImports(s.importClause.namedBindings) && !s.importClause.isTypeOnly && s.importClause.namedBindings.elements.some((e) => e.name.text === name && !e.propertyName));
  if (!d || !ts.isStringLiteral(d.moduleSpecifier) || !/^\.{1,2}\//.test(d.moduleSpecifier.text)) return null;
  const parts = path.split("/").slice(0, -1);
  for (const seg of d.moduleSpecifier.text.split("/")) { if (seg === "." || !seg) continue; if (seg === "..") { if (!parts.length) return null; parts.pop(); } else parts.push(seg); }
  const rel = parts.join("/");
  const f = files.find((x) => x.path === (rel.endsWith(".ts") ? rel : `${rel}.ts`));
  return f ? numHelper(ts.createSourceFile(f.path, f.content, ts.ScriptTarget.Latest, true), name) : null;
}

/** Every exported string-line helper (wireHelper) of the in-scope source, with the module it lives in. */
function stringHelperPool(files: readonly { path: string; content: string }[], isTest: (p: string) => boolean): { h: WireHelper; path: string }[] {
  const out: { h: WireHelper; path: string }[] = [];
  for (const f of files) {
    if (isTest(f.path) || isExcludedSource(f.path) || !/^src\/[\w./-]+\.ts$/.test(f.path) || f.path.endsWith(".d.ts")) continue;
    const sf = ts.createSourceFile(f.path, f.content, ts.ScriptTarget.Latest, true);
    for (const s of sf.statements) if (ts.isFunctionDeclaration(s) && s.name) { const h = wireHelper(sf, s.name.text); if (h) out.push({ h, path: f.path }); }
  }
  return out.sort((a, b) => (a.path + a.h.name < b.path + b.h.name ? -1 : 1));
}

function deriveRethrow(task: { target: string; file: string; behavior: string; bullets: string[] }, files: readonly { path: string; content: string }[], isTest: (p: string) => boolean): V2Derivation | Refusal {
  const file = files.find((f) => f.path === task.file)!;
  const sf = ts.createSourceFile(file.path, file.content, ts.ScriptTarget.Latest, true);
  const t = findTarget(sf, task.target);
  if (!t?.node.body) return { reason: "wire_target" };
  if (t.kind !== "method") return { reason: "wire_rethrow_target" };
  // the target must already be the v2 retry template; its one `throw error;` (the failure left after the last
  // allowed try) is the only site. A method without it is refused (retry it first: "retry a failing call").
  const loop = retryLoopOf(sf, t);
  if (!loop) return { reason: "wire_rethrow_site" };
  const key = injectedKeyOf(sf, t.classNode, loop.site);
  if (!key) return { reason: "wire_retry_seam" };
  const S = templateHelper(sf, file.path, loop.status, files), A = templateHelper(sf, file.path, loop.allowed, files), D = templateHelper(sf, file.path, loop.delay, files);
  if (!S || !A || !D || S.returns !== "boolean" || S.params.length !== 1 || A.returns !== "boolean" || A.params.length !== 1 || D.returns !== "number" || D.params.length !== 2) return { reason: "wire_rethrow_site" };
  const policy: Policy = { retryStatus: (x) => evalNumHelper(S, [x]) === true, allowed: (n) => evalNumHelper(A, [n]) === true, delay: (a) => evalNumHelper(D, [a, loop.baseMs]) as number };
  const ex = examplesOf(task.bullets, sf);
  if (!ex || !ex.expects.length) return { reason: "wire_examples" };
  const sp = t.node.parameters.map((p, i) => ({ p, i })).filter(({ p }) => ts.isIdentifier(p.name) && p.type?.kind === ts.SyntaxKind.StringKeyword && !p.questionToken && !p.dotDotDotToken);
  // every example run through the template as it stands: the counts must be what the template already does
  type Failing = { e: ErrorInfo; message: string | null; kind: Expect["kind"]; params: Map<string, string | null> };
  const failing: Failing[] = [];
  let answered = 0, pinnedAtLimit = 0;
  for (const e of ex.expects) {
    const s = e.inject.get(key) ?? [];
    if (s.length > 1) return { reason: "wire_fake_ambiguous" };
    if (!s.length) continue;
    const outs = s[0]!.outcomes.map(outcomeOf);
    if (outs.some((o) => o === null)) return { reason: "wire_retry_examples" };
    const sl = e.inject.get("sleep") ?? [];
    if (sl.length > 1) return { reason: "wire_fake_ambiguous" };
    for (const o of [s[0]!.owner, sl[0]?.owner].filter((x): x is string => !!x)) if ((ex.uses.get(o) ?? 0) > 1) return { reason: "wire_fake_shared" };
    const sim = simulate(policy, outs as Outcome[]);
    if (!sim) return { reason: "wire_retry_examples" };
    const owner = s[0]!.owner, sleepOwner = sl[0]?.owner ?? null;
    if (ex.counts.has(owner) && ex.counts.get(owner) !== sim.calls) return { reason: "wire_no_fit", detail: "count" };
    if (sleepOwner && ex.counts.has(sleepOwner) && ex.counts.get(sleepOwner) !== sim.sleeps.length) return { reason: "wire_no_fit", detail: "sleep" };
    if (sleepOwner && ex.args.has(sleepOwner) && JSON.stringify(ex.args.get(sleepOwner)) !== JSON.stringify(sim.sleeps.map((d) => [d]))) return { reason: "wire_no_fit", detail: "sleep" };
    if (!sleepOwner && sim.sleeps.length) return { reason: "wire_no_fit", detail: "sleep" }; // a retry with no injected sleep would wait for real
    const last = s[0]!.outcomes[Math.min(sim.calls, s[0]!.outcomes.length) - 1]!;
    const fail = failureOf(last);
    if (!fail) { answered += 1; continue; } // the last try got an answer: the template returns it, unchanged
    // a failure left after the last try may not be swallowed (G26): its example must expect a rejection
    if (e.kind !== "rejects" && e.kind !== "throws") return { reason: "wire_rethrow_swallow" };
    if (ex.counts.get(owner) === sim.calls) pinnedAtLimit += 1;
    failing.push({ e: fail, message: e.message, kind: e.kind, params: new Map(sp.map(({ p, i }) => [(p.name as ts.Identifier).text, paramValue(sf, t, e.call, i)])) });
  }
  if (!failing.length) return { reason: "wire_no_failing_example" };
  // the examples must pin the call count at the retry limit and show an answer the edit leaves alone
  if (!pinnedAtLimit) return { reason: "wire_rethrow_unpinned" };
  if (!answered) return { reason: "wire_rethrow_answer_unpinned" };
  if (failing.every((f) => f.message === f.e.message)) return { reason: "wire_not_needed" };
  if (failing.some((f) => f.message === null)) return { reason: "wire_no_fit" };
  // the search: every string-line helper of the in-scope source x every argument tuple of the closed pool
  const helpers = stringHelperPool(files, isTest);
  const argPool = (ids: readonly string[]) => [...ids, ...sp.map(({ p }) => `param:${(p.name as ts.Identifier).text}`)];
  const search = (ids: readonly string[]): { h: { h: WireHelper; path: string }; args: string[] }[] | "too_large" => {
    const pool = argPool(ids);
    const fits: { h: { h: WireHelper; path: string }; args: string[] }[] = [];
    let tried = 0;
    for (const h of helpers) {
      const n = h.h.params.length;
      const idx = new Array<number>(n).fill(0);
      for (;;) {
        if (++tried > WIRE_MAX_CANDIDATES) return "too_large";
        const args = idx.map((j) => pool[j]!);
        if (failing.every((f) => { const vals = args.map((a) => rethrowArgValue(a, f.e, f.params)); return vals.every((v) => v !== null) && evalWireHelper(h.h, vals as string[]) === f.message; })) fits.push({ h, args });
        let d = n - 1;
        while (d >= 0 && ++idx[d]! === pool.length) { idx[d] = 0; d -= 1; }
        if (d < 0) break;
      }
    }
    return fits;
  };
  const found0 = search(RETHROW_ARG_IDS);
  if (found0 === "too_large") return { reason: "wire_search_too_large" };
  // Auditor #601: the cause's name only where the cause has no code
  const found = found0.filter((x) => !(x.args.includes("cause.name") && failing.some((f) => f.e.cause?.code !== undefined)));
  if (!found.length) {
    const leak = search(WIRE_ARG_FORMS.map((f) => f.id));
    if (leak !== "too_large" && leak.some((x) => x.args.includes("cause.message"))) return { reason: "wire_cause_message" };
    // Auditor #623: the error's plain message is never passed (uncontrolled text at a network site); only the filter
    if (leak !== "too_large" && leak.some((x) => x.args.includes("message"))) return { reason: "wire_message_unfiltered" };
    if (found0.length) return { reason: "wire_cause_name" };
    return { reason: "wire_no_fit" };
  }
  if (found.length > 1) return { reason: "wire_ambiguous", detail: String(found.length) };
  const { h, args } = found[0]!;
  const srcRel = files.some((f) => !isTest(f.path) && /^import [^;]*? from "\.{1,2}\//m.test(f.content));
  const style = srcRel ? importStyle(files, (p) => !isTest(p)) : importStyle(files, isTest);
  return { kind: "rethrow", holes: { target: task.target, helper: h.h.name, args, import: h.path === file.path ? null : { name: h.h.name, from: relSpec(file.path, h.path, style) } } };
}

// ---------------------------------------------------------------------------------------------------------------
// entry
// ---------------------------------------------------------------------------------------------------------------
export function deriveWireV2Detail(trigger: string, params: Record<string, unknown>, objective: string, files: readonly { path: string; content: string }[], isTest: (p: string) => boolean = (p) => /\.test\.ts$/.test(p), raw?: string): { edit: ExistingEdit | null; reason: string | null; derivation?: V2Derivation; detail?: string } {
  const no = (reason: string, detail?: string) => ({ edit: null, reason, ...(detail ? { detail } : {}) });
  const rethrowSpec = isWire2RethrowParams(params) && trigger === DERIVE_WIRE_V2_RETHROW_TRIGGER;
  if (!rethrowSpec && (!isWire2Params(params) || trigger !== DERIVE_WIRE_V2_TRIGGER)) return no("wire_params");
  if (raw !== undefined && rawIssueProblem(raw)) return no("wire_behavior_code");
  // the objective is cut at MAX_OBJECTIVE_CHARS: a task that reaches it may have lost bullets, so it is refused, not half-read
  if (objective.length >= MAX_OBJECTIVE_CHARS) return no("wire_task_truncated");
  const task = parseWireTask(trigger, objective);
  if ("reason" in task) return no(task.reason);
  const ask = new RegExp(trigger, "i").exec(task.header)!.groups!.ask!.toLowerCase();
  const file = files.find((f) => f.path === task.file);
  if (!file) return no("target_file_not_found");
  if (!editablePath(file.path, isTest)) return no("edit_path");
  const d = rethrowSpec ? deriveRethrow(task, files, isTest) : ask.startsWith("retry") ? deriveRetry(task, files, isTest) : deriveRecord(task, files);
  if ("reason" in d) return no(d.reason, d.detail);
  const content = d.kind === "retry" ? retryEdit(file.path, file.content, d.holes) : d.kind === "record" ? recordEdit(file.path, file.content, d.holes) : rethrowEdit(file.path, file.content, d.holes);
  if (content === null) return no("wire_shape");
  const fakeTest = parseFakeTest(task.bullets, { wire: true, calledWith: true });
  if (!fakeTest) return no("edit_test_grammar");
  const dir = file.path.slice(0, file.path.lastIndexOf("/") + 1);
  const stem = file.path.slice(dir.length).replace(/\.ts$/, "");
  const id7 = createHash("sha256").update(`${task.header}\n${task.bullets.join("\n")}`).digest("hex").slice(0, 7);
  const testPath = `${dir}${stem}.${existingEditSlug(task.target)}-${id7}.test.ts`;
  if (files.some((f) => f.path === testPath)) return no("new_test_path_exists");
  const test = emitFakeTest(file.path, testPath, `PeaceAI G18 derive-wire v2: ${task.target} in ${file.path} (derived ${d.kind === "retry" ? "retry" : d.kind === "record" ? "recorded skip" : "rethrow at the retry limit"}, injected fakes)`, fakeTest, importStyle(files, isTest), WIRE_FAKE_HARNESS);
  // the gate: Job B's own static check on the derived tree (shape re-recognised, capability delta, hermetic walk
  // before and after, the test in the v2 language)
  const read: Read = (rel) => (rel === file.path ? content : ((f) => (f && !isTest(rel) && !isExcludedSource(rel) ? f.content : null))(files.find((x) => x.path === rel)));
  const jb = gradeExistingEditProblem(file.path, file.content, content, testPath, test, read);
  if (jb) return { ...no(jb), derivation: d };
  return { edit: { path: file.path, content, extra: [{ path: testPath, content: test, create: true }], selfGrade: true }, reason: null, derivation: d };
}

export function runDeriveWireV2Rule(trigger: string, params: Record<string, unknown>, objective: string, files: readonly { path: string; content: string }[], isTest: (p: string) => boolean = (p) => /\.test\.ts$/.test(p), why?: { reason?: string }, raw?: string): ExistingEdit | null {
  const r = deriveWireV2Detail(trigger, params, objective, files, isTest, raw);
  if (!r.edit && why) why.reason = r.reason ?? "wire_refused";
  return r.edit;
}

// ---------------------------------------------------------------------------------------------------------------
// G31 (Auditor, Oct 30, w02b): the filtered per-day record. The fits that record only the loop item and closed reads
// with no free text (name, code, cause.code, cause.name) are kept; when none is left, the refused read is named
// (wire_cause_message before wire_message_unfiltered). Job B refuses the same records (recordLeakReason).
// ---------------------------------------------------------------------------------------------------------------
import { RECORD_LEAK_READS, recordLeakReason } from "./learned-edit-existing.ts";
function recordFilteredFits(found: readonly RecordHoles[]): RecordHoles[] | string {
  const kept = found.filter((h) => recordLeakReason(h.record) === null);
  if (kept.length) return kept;
  const reasons = new Set(found.map((h) => recordLeakReason(h.record)!));
  return RECORD_LEAK_READS.map(([, reason]) => reason).find((r) => reasons.has(r)) ?? "wire_record_unfiltered";
}
