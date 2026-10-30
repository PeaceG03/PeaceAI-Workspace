// G19+ derive-wire sizes (public-derive-wire-sizes-v1, kind EXISTING_EDIT; peaceai/spec/derive-wire-v2.md, section
// G19+). Same task language as derive-wire v2 (a header naming an existing class method, a `Behavior:` paragraph in
// plain words, `Examples:` bullets of data-only fakes and expects, no code anywhere, v1's anti-copy guards), its own
// spec and trigger so public-derive-wire-v2 / -rethrow-v1 stay byte for byte. Two asks, each a closed template of
// learned-edit-existing.ts whose holes the search below fills (exactly one fit, else refuse by name):
//
//   "list the sizes too"  (sizesListEdit) on a paging key listing (pagingListOf): adds the sibling sized listing N.
//       N is the one new method every example calls; the element E holding one key and the size tag F are the tags of
//       the examples' listing pages for which E's key and F's digits give every expected entry list (keys sorted, the
//       listing's own key decoding); the record's two field names come from the expected entries. The number of page
//       requests must be pinned (no request per key); an element without a size fails the call (never a silent 0).
//   "use the list sizes"  (sizesUseEdit) on a method that lists keys and then reads every key whole for its length:
//       N is the one OPTIONAL method of the receiver's declared interface that takes the listing's arguments and
//       answers `Promise<{ K: string; S: number }[]>`. The examples must inject N, pin it called with the listing's
//       arguments and pin the per-key read at 0 calls (no downloads); a failing N must fail the call (G26).
//
// The derived edit is gated by Job B's own static check (gradeExistingEditProblem -> gradeSizesProblem: rebuilt from
// the base token for token, hermetic walk, the v2 test shape), then graded as every EXISTING_EDIT.
import ts from "typescript";
import { createHash } from "node:crypto";
import { rawIssueProblem } from "./learned-derive.ts";
import { failureOf, injections, parseWireTask } from "./derive-wire.ts";
import { editablePath, emitFakeTest, existingEditSlug, findTarget, gradeExistingEditProblem, isExcludedSource, isWireSizesParams, pagingListOf, parseExpression, parseFakeTest, sizesListEdit, sizesUseEdit, sizesUseSiteOf, uniqueSplit, WIRE_FAKE_HARNESS, type ExistingEdit, type Read, type SizesListHoles, type SizesUseHoles } from "./learned-edit-existing.ts";
import { importStyle } from "./learned-test.ts";
import { MAX_OBJECTIVE_CHARS } from "./taskmap.ts";

const NAME = String.raw`[A-Za-z_$][\w$]*`;
export const DERIVE_WIRE_SIZES_TRIGGER = String.raw`^in the existing method (?<method>${NAME}) of class (?<cls>${NAME}) in (?<file>src\/[\w./-]+\.ts) ?, (?<ask>list the sizes too|use the list sizes) ?\.?$`;
/** Most tags of the examples' listing pages the search tries as element x size pairs. */
const SIZES_MAX_TAGS = 24;

type Value = string | number | boolean | null | Value[] | { [k: string]: Value };
// a data literal of the examples as a plain value (derive-wire-v2's valueOf, kept here so that file is untouched)
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
interface Expect { call: ts.CallExpression; kind: "resolves" | "returns" | "rejects" | "throws"; value: Value | undefined; message: string | null; inject: Map<string, { owner: string; outcomes: ts.Expression[] }[]> }
interface Examples { expects: Expect[]; counts: Map<string, number>; args: Map<string, Value> }
// the examples in v2's grammar (derive-wire-v2's examplesOf, kept here likewise)
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
    expects.push({ call: h.call, kind: h.kind, value: valueOf(h.re), message: ts.isStringLiteral(h.re) ? h.re.text : null, inject: injections(h.call, fakes, sf, i) });
  }
  return { expects, counts, args };
}

export type SizesDerivation = { kind: "list"; holes: SizesListHoles } | { kind: "use"; holes: SizesUseHoles };
type Refusal = { reason: string; detail?: string };
const callName = (e: ts.Expression): string | null => (ts.isCallExpression(e) && ts.isIdentifier(e.expression) ? e.expression.text : null);
/** `resolves(response(STATUS, "BODY"))` as { status, body }, else null. */
const pageOf = (o: ts.Expression): { status: number; body: string } | null => {
  if (callName(o) !== "resolves" || !ts.isCallExpression(o) || o.arguments.length !== 1) return null;
  const r = o.arguments[0]!;
  if (callName(r) !== "response" || !ts.isCallExpression(r) || r.arguments.length < 2 || !ts.isNumericLiteral(r.arguments[0]!) || !ts.isStringLiteral(r.arguments[1]!)) return null;
  return { status: Number((r.arguments[0] as ts.NumericLiteral).text), body: (r.arguments[1] as ts.StringLiteral).text };
};
const isResponse = (o: ts.Expression): boolean => ts.isCallExpression(o) && o.arguments.length === 1 && callName(o.arguments[0]!) === "response";
const escapeRe = (s: string): string => s.replace(/[\\^$.|?*+()[\]{}]/g, "\\$&");

// ---------------------------------------------------------------------------------------------------------------
// "list the sizes too"
// ---------------------------------------------------------------------------------------------------------------
function deriveSizesList(task: { target: string; file: string; bullets: string[] }, files: readonly { path: string; content: string }[]): SizesDerivation | Refusal {
  const file = files.find((f) => f.path === task.file)!;
  const sf = ts.createSourceFile(file.path, file.content, ts.ScriptTarget.Latest, true);
  const t = findTarget(sf, task.target);
  if (!t?.node.body || t.kind !== "method") return { reason: "sizes_target" };
  const p = pagingListOf(sf, t);
  if (!p) return { reason: "sizes_list_site" };
  const ex = examplesOf(task.bullets, sf);
  if (!ex || !ex.expects.length) return { reason: "sizes_examples" };
  // N: the one new method every example calls on `new C(..)`
  const names = new Set(ex.expects.map((e) => (ts.isPropertyAccessExpression(e.call.expression) && ts.isNewExpression(e.call.expression.expression) && ts.isIdentifier(e.call.expression.expression.expression) && e.call.expression.expression.expression.text === t.cls ? e.call.expression.name.text : "")));
  if (names.size !== 1 || names.has("")) return { reason: "sizes_entry" };
  const method = [...names][0]!;
  const exists = (ms: ts.NodeArray<ts.ClassElement | ts.TypeElement>) => ms.some((m) => !!m.name && (ts.isIdentifier(m.name) || ts.isStringLiteral(m.name)) && m.name.text === method);
  if (exists(t.classNode.members) || exists(p.iface.members)) return { reason: "sizes_exists" };
  if (!/^[A-Za-z][A-Za-z0-9]{0,39}$/.test(method)) return { reason: "sizes_entry" };
  type Ex = { pages: string[]; kind: Expect["kind"]; value: Value | undefined; message: string | null };
  const runs: Ex[] = [];
  for (const e of ex.expects) {
    const sites = [...e.inject.values()].flat().filter((x) => x.outcomes.some(isResponse));
    if (sites.length !== 1) return { reason: sites.length ? "sizes_fake_ambiguous" : "sizes_pages_unpinned" };
    const s = sites[0]!;
    const n = ex.counts.get(s.owner);
    // the page requests are counted, so a program that asks once per key misses (no download, no HEAD per key)
    if (n === undefined || n < 1) return { reason: "sizes_calls_unpinned" };
    const used = Array.from({ length: n }, (_, i) => s.outcomes[Math.min(i, s.outcomes.length - 1)]!);
    const pages = used.map(pageOf);
    if (pages.some((x) => x === null)) {
      // a page that fails (or is not a plain page) must fail the call: never answered as a partial or empty listing
      if (e.kind === "resolves" || e.kind === "returns") return { reason: used.some((o) => failureOf(o)) ? "sizes_swallow" : "sizes_examples" };
      continue;
    }
    if (pages.some((x) => x!.status !== 200)) { if (e.kind === "resolves" || e.kind === "returns") return { reason: "sizes_swallow" }; continue; }
    if (pages.some((x) => x!.body.includes("&"))) return { reason: "sizes_examples" };
    runs.push({ pages: pages.map((x) => x!.body), kind: e.kind, value: e.value, message: e.message });
  }
  // the record's fields: every expected entry has exactly one string and one number field, the same two names
  const answered = runs.filter((r) => r.kind === "resolves");
  if (!answered.some((r) => Array.isArray(r.value) && r.value.length >= 1)) return { reason: "sizes_unpinned" };
  let fields: { key: string; size: string } | null = null;
  for (const r of answered) {
    if (!Array.isArray(r.value)) return { reason: "sizes_fields" };
    for (const v of r.value) {
      if (!v || typeof v !== "object" || Array.isArray(v) || Object.keys(v).length !== 2) return { reason: "sizes_fields" };
      const ks = Object.keys(v).filter((k) => typeof v[k] === "string"), ns = Object.keys(v).filter((k) => typeof v[k] === "number");
      if (ks.length !== 1 || ns.length !== 1) return { reason: "sizes_fields" };
      const f = { key: ks[0]!, size: ns[0]! };
      if (!/^[A-Za-z][A-Za-z0-9]{0,39}$/.test(f.key) || !/^[A-Za-z][A-Za-z0-9]{0,39}$/.test(f.size)) return { reason: "sizes_fields" };
      if (fields && (fields.key !== f.key || fields.size !== f.size)) return { reason: "sizes_fields" };
      fields = f;
    }
  }
  if (!fields) return { reason: "sizes_unpinned" };
  const fk = fields.key, fs = fields.size;
  // the search: every (element, size tag) pair of the pages' tags
  const tags = [...new Set(runs.flatMap((r) => r.pages.flatMap((b) => [...b.matchAll(/<([A-Za-z][A-Za-z0-9]{0,31})>/g)].map((m) => m[1]!))))].filter((x) => x !== p.keyTag).sort();
  if (tags.length > SIZES_MAX_TAGS) return { reason: "sizes_search_too_large" };
  const keyRe = new RegExp(`<${escapeRe(p.keyTag)}>([^<]+)</${escapeRe(p.keyTag)}>`);
  const simulate = (el: string, sz: string, zeroIfMissing: boolean): boolean => runs.every((r) => {
    const out: { k: string; s: number }[] = [];
    let missing = false;
    for (const b of r.pages) for (const m of b.matchAll(new RegExp(`<${escapeRe(el)}>([\\s\\S]*?)</${escapeRe(el)}>`, "g"))) {
      const inner = m[1] ?? "";
      const k = keyRe.exec(inner)?.[1] ?? "";
      const d = new RegExp(`<${escapeRe(sz)}>(\\d{1,15})</${escapeRe(sz)}>`).exec(inner)?.[1];
      if (d === undefined) { if (zeroIfMissing) out.push({ k, s: 0 }); else missing = true; continue; }
      out.push({ k, s: Number(d) });
    }
    if (missing) return r.kind === "rejects" && r.message === `${p.prefix}_SIZE_MISSING`;
    if (r.kind !== "resolves") return false;
    const got = out.filter((x) => x.k !== "").sort((a, b) => (a.k < b.k ? -1 : a.k > b.k ? 1 : 0));
    const want = (r.value as { [k: string]: Value }[]).map((v) => ({ k: v[fk], s: v[fs] }));
    return JSON.stringify(got) === JSON.stringify(want);
  });
  const fits: { el: string; sz: string }[] = [];
  for (const el of tags) for (const sz of tags) if (el !== sz && simulate(el, sz, false)) fits.push({ el, sz });
  if (!fits.length) {
    // an element without its size counted as 0 would fit: that is a silent wrong total, refused by name
    for (const el of tags) for (const sz of tags) if (el !== sz && simulate(el, sz, true)) return { reason: "sizes_silent_zero" };
    return { reason: "sizes_no_fit" };
  }
  if (fits.length > 1) return { reason: "sizes_ambiguous", detail: String(fits.length) };
  // every clause the template emits is pinned by an example (Auditor #629: no clause unpinned): the missing-size throw,
  // the drop of an element without a key (the key listing's own filter) and the sort by key each change some expected
  // outcome when taken out, else the clause is refused by name
  const unpinned = clausesUnpinned(runs, fits[0]!.el, fits[0]!.sz, keyRe, p.prefix);
  if (unpinned) return { reason: "sizes_clause_unpinned", detail: unpinned };
  return { kind: "list", holes: { target: task.target, method, container: fits[0]!.el, size: fits[0]!.sz, keyField: fk, sizeField: fs } };
}

/**
 * The first clause of the "list the sizes too" template that no example exercises, or null. A clause is exercised when
 * some example's expected outcome differs from what the template would give with that clause taken out: "size-missing"
 * (a rejecting example whose page holds an element without its size), "empty-key" (an answered example whose page holds
 * an element without a key, dropped), "sort" (an answered example whose elements arrive out of key order).
 */
function clausesUnpinned(runs: readonly { pages: string[]; kind: string; message: string | null }[], el: string, sz: string, keyRe: RegExp, prefix: string): string | null {
  const elements = (r: { pages: string[] }) => r.pages.flatMap((b) => [...b.matchAll(new RegExp(`<${escapeRe(el)}>([\\s\\S]*?)</${escapeRe(el)}>`, "g"))].map((m) => m[1] ?? ""));
  const sizeRe = new RegExp(`<${escapeRe(sz)}>(\\d{1,15})</${escapeRe(sz)}>`);
  const keyOf = (inner: string) => keyRe.exec(inner)?.[1] ?? "";
  if (!runs.some((r) => r.kind === "rejects" && r.message === `${prefix}_SIZE_MISSING` && elements(r).some((x) => !sizeRe.test(x)))) return "size-missing";
  const answered = runs.filter((r) => r.kind === "resolves");
  if (!answered.some((r) => elements(r).some((x) => sizeRe.test(x) && keyOf(x) === ""))) return "empty-key";
  if (!answered.some((r) => { const ks = elements(r).map(keyOf).filter(Boolean); return ks.some((k, i) => i > 0 && ks[i - 1]! > k); })) return "sort";
  return null;
}

// ---------------------------------------------------------------------------------------------------------------
// "use the list sizes"
// ---------------------------------------------------------------------------------------------------------------
/** The interface a receiver (`this.F` or a parameter) is declared with, in this module or one relative import. */
function receiverInterface(sf: ts.SourceFile, path: string, t: ReturnType<typeof findTarget> & object, recv: string, files: readonly { path: string; content: string }[]): { iface: ts.InterfaceDeclaration; sf: ts.SourceFile } | null {
  let type: ts.TypeNode | undefined;
  if (recv.startsWith("this.") && t.kind === "method") {
    const f = recv.slice(5);
    const ctor = t.classNode.members.find(ts.isConstructorDeclaration);
    const pp = ctor?.parameters.find((x) => ts.isIdentifier(x.name) && x.name.text === f && ts.isParameterPropertyDeclaration(x, ctor));
    const pd = t.classNode.members.find((m): m is ts.PropertyDeclaration => ts.isPropertyDeclaration(m) && ts.isIdentifier(m.name) && m.name.text === f);
    type = pp?.type ?? pd?.type;
  } else type = t.node.parameters.find((x) => ts.isIdentifier(x.name) && x.name.text === recv)?.type;
  if (!type || !ts.isTypeReferenceNode(type) || !ts.isIdentifier(type.typeName) || type.typeArguments) return null;
  const name = type.typeName.text;
  const local = sf.statements.filter((s): s is ts.InterfaceDeclaration => ts.isInterfaceDeclaration(s) && s.name.text === name);
  if (local.length) return local.length === 1 ? { iface: local[0]!, sf } : null;
  for (const s of sf.statements) {
    if (!ts.isImportDeclaration(s) || !ts.isStringLiteral(s.moduleSpecifier) || !s.importClause?.namedBindings || !ts.isNamedImports(s.importClause.namedBindings)) continue;
    const el = s.importClause.namedBindings.elements.find((x) => x.name.text === name && !x.propertyName);
    if (!el) continue;
    const spec = s.moduleSpecifier.text;
    if (!/^\.\.?\//.test(spec)) return null;
    const parts = [...path.split("/").slice(0, -1), ...spec.split("/")];
    const out: string[] = [];
    for (const x of parts) { if (x === "." || x === "") continue; if (x === "..") { if (!out.length) return null; out.pop(); } else out.push(x); }
    const rel = out.join("/").replace(/\.(?:js|ts)$/, "") + ".ts";
    const f = files.find((x) => x.path === rel);
    if (!f) return null;
    const isf = ts.createSourceFile(f.path, f.content, ts.ScriptTarget.Latest, true);
    const hits = isf.statements.filter((x): x is ts.InterfaceDeclaration => ts.isInterfaceDeclaration(x) && x.name.text === name && !!x.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword));
    return hits.length === 1 ? { iface: hits[0]!, sf: isf } : null;
  }
  return null;
}
/** `Promise<{ K: string; S: number }[]>` as { K, S }, else null. */
function sizedType(n: ts.TypeNode | undefined): { key: string; size: string } | null {
  if (!n || !ts.isTypeReferenceNode(n) || !ts.isIdentifier(n.typeName) || n.typeName.text !== "Promise" || n.typeArguments?.length !== 1) return null;
  const a = n.typeArguments[0]!;
  if (!ts.isArrayTypeNode(a) || !ts.isTypeLiteralNode(a.elementType) || a.elementType.members.length !== 2) return null;
  let key: string | null = null, size: string | null = null;
  for (const m of a.elementType.members) {
    if (!ts.isPropertySignature(m) || m.questionToken || !m.type || !ts.isIdentifier(m.name)) return null;
    if (m.type.kind === ts.SyntaxKind.StringKeyword && key === null) key = m.name.text;
    else if (m.type.kind === ts.SyntaxKind.NumberKeyword && size === null) size = m.name.text;
    else return null;
  }
  return key && size ? { key, size } : null;
}

function deriveSizesUse(task: { target: string; file: string; bullets: string[] }, files: readonly { path: string; content: string }[]): SizesDerivation | Refusal {
  const file = files.find((f) => f.path === task.file)!;
  const sf = ts.createSourceFile(file.path, file.content, ts.ScriptTarget.Latest, true);
  const t = findTarget(sf, task.target);
  if (!t?.node.body) return { reason: "sizes_target" };
  const s = sizesUseSiteOf(sf, t);
  if (!s) return { reason: "sizes_use_site" };
  const ri = receiverInterface(sf, file.path, t, s.recv, files);
  if (!ri) return { reason: "sizes_receiver" };
  const listSig = ri.iface.members.filter((m): m is ts.MethodSignature => ts.isMethodSignature(m) && ts.isIdentifier(m.name) && m.name.text === s.list);
  if (listSig.length !== 1) return { reason: "sizes_receiver" };
  const arity = listSig[0]!.parameters.length;
  // N: the one OPTIONAL member answering the sized listing for the listing's own arguments
  const cands = ri.iface.members.flatMap((m) => (ts.isMethodSignature(m) && ts.isIdentifier(m.name) && m.questionToken && m.name.text !== s.list && m.name.text !== s.get && m.parameters.length === arity && m.parameters.every((x, i) => x.type?.getText(ri.sf) === listSig[0]!.parameters[i]!.type?.getText(ri.sf)) ? ((st) => (st ? [{ name: (m.name as ts.Identifier).text, ...st }] : []))(sizedType(m.type)) : []));
  if (!cands.length) return { reason: "sizes_no_listing" };
  if (cands.length > 1) return { reason: "sizes_ambiguous", detail: String(cands.length) };
  const n = cands[0]!;
  const ex = examplesOf(task.bullets, sf);
  if (!ex || !ex.expects.length) return { reason: "sizes_examples" };
  const listArgs = JSON.stringify(s.argv);
  let pinned = 0;
  for (const e of ex.expects) {
    const ns = e.inject.get(n.name) ?? [];
    if (!ns.length) continue; // a receiver without the sized listing: the method is unchanged, read for read
    if (ns.length > 1) return { reason: "sizes_fake_ambiguous" };
    const owner = ns[0]!.owner;
    // a failing sized listing must fail the call (G26): a measuring failure is never answered as a size
    if (ns[0]!.outcomes.some((o) => failureOf(o)) && (e.kind === "resolves" || e.kind === "returns")) return { reason: "sizes_swallow" };
    if (e.kind !== "resolves") continue;
    const gets = e.inject.get(s.get) ?? [], lists = e.inject.get(s.list) ?? [];
    if (gets.length !== 1) return { reason: "sizes_unpinned" };
    const gc = ex.counts.get(gets[0]!.owner);
    if (gc === undefined) return { reason: "sizes_unpinned" };
    if (gc !== 0) return { reason: "sizes_download" };
    if (lists.length === 1 && ex.counts.has(lists[0]!.owner) && ex.counts.get(lists[0]!.owner) !== 0) return { reason: "sizes_no_fit", detail: "list" };
    const a = ex.args.get(owner);
    if (a === undefined) return { reason: "sizes_unpinned" };
    if (JSON.stringify(a) !== `[${listArgs}]`) return { reason: "sizes_no_fit", detail: "args" };
    pinned += 1;
  }
  if (!pinned) return { reason: "sizes_unpinned" };
  // the other arm of the template (a client without the sized listing is read as before) is pinned too (Auditor #629):
  // an answered example without N whose listing and per-key read are both counted at least once
  const fallback = ex.expects.some((e) => {
    if (e.kind !== "resolves" || (e.inject.get(n.name) ?? []).length) return false;
    const gets = e.inject.get(s.get) ?? [], lists = e.inject.get(s.list) ?? [];
    return gets.length === 1 && lists.length === 1 && (ex.counts.get(gets[0]!.owner) ?? 0) >= 1 && (ex.counts.get(lists[0]!.owner) ?? 0) >= 1;
  });
  if (!fallback) return { reason: "sizes_clause_unpinned", detail: "no-sized-listing" };
  return { kind: "use", holes: { target: task.target, sized: n.name, keyField: n.key, sizeField: n.size } };
}

// ---------------------------------------------------------------------------------------------------------------
// entry
// ---------------------------------------------------------------------------------------------------------------
export function deriveWireSizesDetail(trigger: string, params: Record<string, unknown>, objective: string, files: readonly { path: string; content: string }[], isTest: (p: string) => boolean = (p) => /\.test\.ts$/.test(p), raw?: string): { edit: ExistingEdit | null; reason: string | null; derivation?: SizesDerivation; detail?: string } {
  const no = (reason: string, detail?: string) => ({ edit: null, reason, ...(detail ? { detail } : {}) });
  if (!isWireSizesParams(params) || trigger !== DERIVE_WIRE_SIZES_TRIGGER) return no("wire_params");
  if (raw !== undefined && rawIssueProblem(raw)) return no("wire_behavior_code");
  // the objective is cut at MAX_OBJECTIVE_CHARS: a task that reaches it may have lost bullets, so it is refused, not half-read
  if (objective.length >= MAX_OBJECTIVE_CHARS) return no("wire_task_truncated");
  const task = parseWireTask(trigger, objective);
  if ("reason" in task) return no(task.reason);
  const ask = new RegExp(trigger, "i").exec(task.header)!.groups!.ask!.toLowerCase();
  const file = files.find((f) => f.path === task.file);
  if (!file) return no("target_file_not_found");
  if (!editablePath(file.path, isTest)) return no("edit_path");
  const d = ask.startsWith("list") ? deriveSizesList(task, files) : deriveSizesUse(task, files);
  if ("reason" in d) return no(d.reason, d.detail);
  const content = d.kind === "list" ? sizesListEdit(file.path, file.content, d.holes) : sizesUseEdit(file.path, file.content, d.holes);
  if (content === null) return no("sizes_shape");
  const fakeTest = parseFakeTest(task.bullets, { wire: true, calledWith: true });
  if (!fakeTest) return no("edit_test_grammar");
  const dir = file.path.slice(0, file.path.lastIndexOf("/") + 1);
  const stem = file.path.slice(dir.length).replace(/\.ts$/, "");
  const id7 = createHash("sha256").update(`${task.header}\n${task.bullets.join("\n")}`).digest("hex").slice(0, 7);
  const slugTarget = d.kind === "list" ? `${task.target.split(".")[0]}.${d.holes.method}` : task.target;
  const testPath = `${dir}${stem}.${existingEditSlug(slugTarget)}-${id7}.test.ts`;
  if (files.some((f) => f.path === testPath)) return no("new_test_path_exists");
  const test = emitFakeTest(file.path, testPath, `PeaceAI G19+ derive-wire sizes: ${slugTarget} in ${file.path} (derived ${d.kind === "list" ? "sized listing" : "sizes from the listing"}, injected fakes)`, fakeTest, importStyle(files, isTest), WIRE_FAKE_HARNESS);
  // the gate: Job B's own static check on the derived tree
  const read: Read = (rel) => (rel === file.path ? content : ((f) => (f && !isTest(rel) && !isExcludedSource(rel) ? f.content : null))(files.find((x) => x.path === rel)));
  const jb = gradeExistingEditProblem(file.path, file.content, content, testPath, test, read);
  if (jb) return { ...no(jb), derivation: d };
  return { edit: { path: file.path, content, extra: [{ path: testPath, content: test, create: true }], selfGrade: true }, reason: null, derivation: d };
}

export function runDeriveWireSizesRule(trigger: string, params: Record<string, unknown>, objective: string, files: readonly { path: string; content: string }[], isTest: (p: string) => boolean = (p) => /\.test\.ts$/.test(p), why?: { reason?: string }, raw?: string): ExistingEdit | null {
  const r = deriveWireSizesDetail(trigger, params, objective, files, isTest, raw);
  if (!r.edit && why) why.reason = r.reason ?? "wire_refused";
  return r.edit;
}
