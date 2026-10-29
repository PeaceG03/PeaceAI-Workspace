// G18: the derive-wire rule (public-derive-wire-v1, kind EXISTING_EDIT). The issue names an EXISTING exported
// function or class method and states, in prose plus fake-driven examples, how a failing collaborator call must be
// handled; it holds no code. PeaceAI's own search picks the edit: which ONE existing call statement of that function
// to wrap in try / catch, and what the catch does, built only from a closed grammar:
//   rethrow   catch (error) { throw new Error(H(a1, .., an), { cause: error }); }
//             H an existing exported string-line helper of the same module (wireHelper: 1-4 string params, a body
//             that only joins string literals and those params), each ai one of WIRE_ARG_FORMS (the caught error's
//             message, name, code, cause.code, cause.name, cause.message; G21) or a string parameter of the target
//   continue  catch { continue; }  (the call sits inside a loop of the target: skip the rest of that iteration)
// The examples pick it: every candidate is evaluated against the scenarios whose injected fake fails at the site, and
// exactly one must fit (none or several refuse; wire_no_fit / wire_ambiguous). The derived edit then goes through the
// M98 gates unchanged (gateWireEdit: path, grammar, site, capability delta with the catch as `throw error;`, hermetic
// walk before and after, target reached) and its new test is the fake test PeaceAI emits from the data-described
// fakes (G20) in the wire fake language (errors with code / name / cause fields). Job B grades it as every
// EXISTING_EDIT: confined edit, wireEditShape re-recognised on the graded tree, fail before / pass after.
//
// Task shape (after issue cleaning):
//   In the existing method request of class R2ObjectClient in src/object-store.ts, handle a failing call.
//   Behavior: <plain prose, no code>
//   Examples ...:
//   - fake fetchA = rejects("fetch failed", { cause: { code: "ECONNRESET" } })
//   - expect new R2ObjectClient({ .., fetchImpl: fetchA }).get("k") rejects with "R2_REQUEST_FAILED:GET:fetch failed:cause=ECONNRESET"
//
// Out of scope in v1 (refused, never faked; peaceai/spec/derive-wire-v1.md): retry (a bounded loop re-signing and
// timing out each attempt needs a clock, a timer and per-attempt signing, none of which the hermetic M98 walk admits),
// wrapping a declaration statement, a helper in another module, and a call site the examples do not fail.
import ts from "typescript";
import { behaviorCodeProblem, rawIssueProblem, STRONG_CODE } from "./learned-derive.ts";
import { callName, evalWireHelper, findTarget, gateWireEdit, isExcludedSource, isWireParams, OUTCOMES, ownStatements, parseExpression, uniqueSplit, wireEditShape, gradeExistingEditProblem, WIRE_ARG_FORMS, wireHelper, type ExistingEdit, type Read, type Target } from "./learned-edit-existing.ts";

const NAME = String.raw`[A-Za-z_$][\w$]*`;
/** The header line: the existing target and the module; its own words ("handle a failing call"). */
export const DERIVE_WIRE_TRIGGER = String.raw`^in the existing (?:function (?<fn>${NAME})|method (?<method>${NAME}) of class (?<cls>${NAME})) in (?<file>src\/[\w./-]+\.ts) ?, handle a failing call ?\.?$`;
const EXAMPLES_HEAD = /^examples\b[^:\n]{0,80}:$/i;
const BEHAVIOR_HEAD = /^behaviou?r:\s*/i;
const BULLET = /^[-*] /;
/** Code a wire issue may never carry, anywhere (the inserted code is PeaceAI's; anti-copy guard on top of STRONG_CODE). */
const WIRE_CODE = /\b(?:try|catch)\s*[({]|\bthrow\s+new\b|\bnew\s+Error\b|\bcause\s*:\s*error\b|\binstanceof\b|\bcontinue\s*;|\bawait\b/;
export const WIRE_MAX_CANDIDATES = 20000;

export interface WireTask { target: string; file: string; behavior: string; bullets: string[]; header: string }

export function parseWireTask(trigger: string, objective: string): WireTask | { reason: string } {
  const lines = objective.split("\n").map((l) => l.trim()).filter(Boolean);
  const re = new RegExp(trigger, "i");
  const heads = lines.map((l, i) => (re.test(l) ? i : -1)).filter((i) => i >= 0);
  if (heads.length !== 1) return { reason: "wire_trigger" };
  const g = re.exec(lines[heads[0]!]!)!.groups ?? {};
  const target = g.fn ?? (g.cls && g.method ? `${g.cls}.${g.method}` : null);
  if (!target || !g.file) return { reason: "wire_trigger" };
  const bIdx = lines.map((l, i) => (BEHAVIOR_HEAD.test(l) ? i : -1)).filter((i) => i >= 0);
  const eIdx = lines.map((l, i) => (EXAMPLES_HEAD.test(l) ? i : -1)).filter((i) => i >= 0);
  if (bIdx.length !== 1 || eIdx.length !== 1 || !(heads[0]! < bIdx[0]! && bIdx[0]! < eIdx[0]!)) return { reason: "wire_sections" };
  const behavior = [lines[bIdx[0]!]!.replace(BEHAVIOR_HEAD, ""), ...lines.slice(bIdx[0]! + 1, eIdx[0]!)].join(" ").trim();
  if (behavior.length < 20) return { reason: "wire_sections" };
  if (behaviorCodeProblem(behavior)) return { reason: "wire_behavior_code" };
  const bullets: string[] = [];
  let k = eIdx[0]! + 1;
  for (; k < lines.length && BULLET.test(lines[k]!); k++) {
    if (!/^- (?:fake|expect) /.test(lines[k]!)) return { reason: "wire_examples" };
    bullets.push(lines[k]!);
  }
  if (!bullets.length) return { reason: "wire_examples" };
  for (const [i, l] of lines.entries()) {
    if (WIRE_CODE.test(l)) return { reason: "wire_behavior_code" };
    if (i === heads[0] || (i >= bIdx[0]! && i < k)) continue;
    if (STRONG_CODE.test(l)) return { reason: "wire_behavior_code" };
    if (i >= k && BULLET.test(l)) return { reason: "wire_examples" };
  }
  return { target, file: g.file, behavior, bullets, header: lines[heads[0]!]! };
}

// ---------------------------------------------------------------------------------------------------------------
// the examples as scenarios
// ---------------------------------------------------------------------------------------------------------------
export type ErrorInfo = { message: string; code?: string; name?: string; cause?: { code?: string; name?: string; message?: string } };
type Injected = { owner: string; outcomes: ts.Expression[] };
interface Scenario { bullet: number; call: ts.CallExpression; kind: "resolves" | "returns" | "rejects" | "throws"; message: string | null; inject: Map<string, Injected[]> }

export const outcomesOf = (e: ts.Expression): ts.Expression[] | null => {
  const n = callName(e);
  if (n === "sequence" && ts.isCallExpression(e)) return [...e.arguments];
  return n && OUTCOMES.has(n) ? [e] : null;
};
const fieldsOf = (e: ts.Expression | undefined): Omit<ErrorInfo, "message"> => {
  const out: Record<string, unknown> = {};
  if (!e || !ts.isObjectLiteralExpression(e)) return out;
  for (const p of e.properties) {
    if (!ts.isPropertyAssignment(p) || !ts.isIdentifier(p.name)) continue;
    if (ts.isStringLiteral(p.initializer)) out[p.name.text] = p.initializer.text;
    else if (p.name.text === "cause") out.cause = fieldsOf(p.initializer);
  }
  return out as Omit<ErrorInfo, "message">;
};
export const failureOf = (o: ts.Expression): ErrorInfo | null => {
  const n = callName(o);
  if ((n !== "rejects" && n !== "throws") || !ts.isCallExpression(o) || !o.arguments[0] || !ts.isStringLiteral(o.arguments[0])) return null;
  return { message: o.arguments[0].text, ...fieldsOf(o.arguments[1]) };
};

/** Parameter names of the entry an expect call drives (for a bare outcome fake passed as an argument). */
function entryParams(sf: ts.SourceFile, call: ts.CallExpression): { ctor: string[]; method: string[] } {
  const names = (ps: readonly ts.ParameterDeclaration[]) => ps.map((p) => (ts.isIdentifier(p.name) ? p.name.text : ""));
  const callee = call.expression;
  if (ts.isIdentifier(callee)) {
    const f = sf.statements.find((s): s is ts.FunctionDeclaration => ts.isFunctionDeclaration(s) && s.name?.text === callee.text && !!s.body);
    return { ctor: [], method: f ? names(f.parameters) : [] };
  }
  if (ts.isPropertyAccessExpression(callee) && ts.isNewExpression(callee.expression) && ts.isIdentifier(callee.expression.expression)) {
    const cls = sf.statements.find((s): s is ts.ClassDeclaration => ts.isClassDeclaration(s) && s.name?.text === (callee.expression as ts.NewExpression).expression.getText());
    const ctor = cls?.members.find((m): m is ts.ConstructorDeclaration => ts.isConstructorDeclaration(m) && !!m.body);
    const m = cls?.members.find((x): x is ts.MethodDeclaration => ts.isMethodDeclaration(x) && ts.isIdentifier(x.name) && x.name.text === callee.name.text && !!x.body);
    return { ctor: ctor ? names(ctor.parameters) : [], method: m ? names(m.parameters) : [] };
  }
  return { ctor: [], method: [] };
}

/** Every injected outcome fake an expect call reaches, by the key (or parameter name) it is injected under. */
export function injections(call: ts.CallExpression, fakes: ReadonlyMap<string, ts.Expression>, sf: ts.SourceFile, bullet: number): Map<string, Injected[]> {
  const out = new Map<string, Injected[]>();
  const add = (k: string, v: Injected) => out.set(k, [...(out.get(k) ?? []), v]);
  const fromObject = (o: ts.ObjectLiteralExpression, owner: string, depth: number): void => {
    for (const p of o.properties) {
      if (!ts.isPropertyAssignment(p) || !(ts.isIdentifier(p.name) || ts.isStringLiteral(p.name))) continue;
      const k = p.name.text;
      const v = p.initializer;
      const inline = outcomesOf(v);
      if (inline) { add(k, { owner: `${owner}.${k}`, outcomes: inline }); continue; }
      if (ts.isIdentifier(v) && fakes.has(v.text)) {
        const f = fakes.get(v.text)!;
        const os = outcomesOf(f);
        if (os) add(k, { owner: v.text, outcomes: os });
        else if (ts.isObjectLiteralExpression(f) && depth < 3) fromObject(f, v.text, depth + 1);
      } else if (ts.isObjectLiteralExpression(v) && depth < 3) fromObject(v, `${owner}.${k}`, depth + 1);
    }
  };
  const params = entryParams(sf, call);
  const fromArgs = (args: readonly ts.Expression[], names: string[]): void => args.forEach((a, i) => {
    if (ts.isObjectLiteralExpression(a)) fromObject(a, `#${bullet}.${i}`, 0);
    else if (ts.isIdentifier(a) && fakes.has(a.text)) {
      const f = fakes.get(a.text)!;
      const os = outcomesOf(f);
      if (os) { if (names[i]) add(names[i]!, { owner: a.text, outcomes: os }); }
      else if (ts.isObjectLiteralExpression(f)) fromObject(f, a.text, 1);
    }
  });
  if (ts.isPropertyAccessExpression(call.expression) && ts.isNewExpression(call.expression.expression)) fromArgs(call.expression.expression.arguments ?? [], params.ctor);
  fromArgs(call.arguments, params.method);
  return out;
}

function scenariosOf(bullets: readonly string[], sf: ts.SourceFile): { scenarios: Scenario[]; uses: Map<string, number> } | null {
  const fakes = new Map<string, ts.Expression>();
  const scenarios: Scenario[] = [];
  for (const [i, b] of bullets.entries()) {
    const m = /^- fake ([A-Za-z][\w$]*) = (.+)$/.exec(b);
    if (m) { const e = parseExpression(m[2]!); if (!e) return null; fakes.set(m[1]!, e); continue; }
    const rest = b.slice("- expect ".length);
    if (/ is called \d{1,3} times?$/.test(rest)) continue;
    const kinds = [[" resolves to ", "resolves"], [" returns ", "returns"], [" rejects with ", "rejects"], [" throws ", "throws"]] as const;
    const hits = kinds.map(([sep, kind]) => uniqueSplit(rest, sep, (l, r) => {
      const ce = parseExpression(l), re = parseExpression(r);
      return ce && re && ts.isCallExpression(ce) ? { call: ce, kind, message: ts.isStringLiteral(re) ? re.text : null } : null;
    })).filter((x) => x !== null);
    if (hits.length !== 1) return null;
    const h = hits[0]!;
    scenarios.push({ bullet: i, call: h.call, kind: h.kind, message: h.message, inject: injections(h.call, fakes, sf, i) });
  }
  // how many expect calls reach each outcome fake (a fake shared by two calls has no known per-call first outcome)
  const uses = new Map<string, number>();
  for (const s of scenarios) for (const owner of new Set([...s.inject.values()].flat().map((x) => x.owner))) uses.set(owner, (uses.get(owner) ?? 0) + 1);
  return { scenarios, uses };
}

/** The value a string parameter of the target has in one scenario: a literal argument of the expect call, or one hop through the entry. */
function paramValue(sf: ts.SourceFile, t: Target, call: ts.CallExpression, index: number): string | null {
  const lit = (args: readonly ts.Expression[]) => { const a = args[index]; return a && ts.isStringLiteral(a) ? a.text : null; };
  const callee = call.expression;
  let entry: ts.FunctionLikeDeclaration | undefined;
  if (ts.isIdentifier(callee)) {
    if (t.kind === "function" && t.name === callee.text) return lit(call.arguments);
    entry = sf.statements.find((s): s is ts.FunctionDeclaration => ts.isFunctionDeclaration(s) && s.name?.text === callee.text && !!s.body);
  } else if (ts.isPropertyAccessExpression(callee) && ts.isNewExpression(callee.expression) && ts.isIdentifier(callee.expression.expression)) {
    const cls = callee.expression.expression.text, method = callee.name.text;
    if (t.kind === "method" && t.cls === cls && t.name === method) return lit(call.arguments);
    const c = sf.statements.find((s): s is ts.ClassDeclaration => ts.isClassDeclaration(s) && s.name?.text === cls);
    entry = c?.members.find((m): m is ts.MethodDeclaration => ts.isMethodDeclaration(m) && ts.isIdentifier(m.name) && m.name.text === method && !!m.body);
  }
  if (!entry?.body) return null;
  const hops: ts.CallExpression[] = [];
  const v = (n: ts.Node): void => {
    if (n !== entry && (ts.isFunctionLike(n) || ts.isClassLike(n))) return;
    if (ts.isCallExpression(n)) {
      const e = n.expression;
      if (t.kind === "function" && ts.isIdentifier(e) && e.text === t.name) hops.push(n);
      if (t.kind === "method" && ts.isPropertyAccessExpression(e) && e.expression.kind === ts.SyntaxKind.ThisKeyword && e.name.text === t.name) hops.push(n);
    }
    ts.forEachChild(n, v);
  };
  v(entry.body);
  return hops.length === 1 ? lit(hops[0]!.arguments) : null;
}

// ---------------------------------------------------------------------------------------------------------------
// the search
// ---------------------------------------------------------------------------------------------------------------
export const calleeName = (c: ts.CallExpression): string | null => {
  const e = c.expression;
  return ts.isIdentifier(e) ? e.text : ts.isPropertyAccessExpression(e) && ts.isIdentifier(e.name) ? e.name.text : null;
};
/** Calls of a statement (never inside a nested function or class). */
export const callsIn = (s: ts.Node): ts.CallExpression[] => {
  const out: ts.CallExpression[] = [];
  const v = (n: ts.Node): void => { if (n !== s && (ts.isFunctionLike(n) || ts.isClassLike(n))) return; if (ts.isCallExpression(n)) out.push(n); ts.forEachChild(n, v); };
  v(s);
  return out;
};
export const insideTry = (s: ts.Node, root: ts.Node): boolean => { for (let p = s.parent; p && p !== root; p = p.parent) if (ts.isTryStatement(p) || ts.isCatchClause(p)) return true; return false; };
const insideLoop = (s: ts.Node, root: ts.Node): boolean => { for (let p = s.parent; p && p !== root; p = p.parent) if (ts.isForOfStatement(p) || ts.isForStatement(p) || ts.isForInStatement(p) || ts.isWhileStatement(p) || ts.isDoStatement(p)) return true; return false; };

export type WireCandidate = { kind: "continue" } | { kind: "rethrow"; helper: string; args: string[] };
export type WireDerivation = { site: string; candidate: WireCandidate; oldText: string; newText: string; formatted: (indent: string) => string } | { reason: string; detail?: string };

const argText = (a: string): string => (a.startsWith("param:") ? a.slice(6) : WIRE_ARG_FORMS.find((f) => f.id === a)!.text);
export const argValue = (a: string, e: ErrorInfo, params: ReadonlyMap<string, string | null>): string | null => {
  switch (a) {
    case "message": return e.message;
    case "name": return e.name ?? "Error";
    case "code": return e.code ?? "";
    case "cause.code": return e.cause?.code ?? "";
    case "cause.name": return e.cause?.name ?? "";
    case "cause.message": return e.cause?.message ?? "";
    default: return params.get(a.slice(6)) ?? null;
  }
};

/** Job A search: one site, one catch, from the examples; refusal codes otherwise. */
export function deriveWire(task: WireTask, source: string): WireDerivation {
  const sf = ts.createSourceFile(task.file, source, ts.ScriptTarget.Latest, true);
  const t = findTarget(sf, task.target);
  if (!t?.node.body) return { reason: "wire_target" };
  const isAsync = !!t.node.modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword);
  const sc = scenariosOf(task.bullets, sf);
  if (!sc || !sc.scenarios.length) return { reason: "wire_examples" };
  // the keys under which some example injects a failing fake
  const failingKeys = new Set<string>();
  for (const s of sc.scenarios) for (const [k, injs] of s.inject) if (injs.some((x) => x.outcomes.some((o) => failureOf(o)))) failingKeys.add(k);
  // the site: the unique own expression / return statement calling a failing key, not already inside a try
  const sites = ownStatements(t.node.body).filter((s) => (ts.isExpressionStatement(s) || ts.isReturnStatement(s)) && !insideTry(s, t.node.body!) && callsIn(s).some((c) => failingKeys.has(calleeName(c) ?? "")));
  if (!sites.length) return { reason: "wire_site_none" };
  if (sites.length > 1) return { reason: "wire_site_ambiguous" };
  const site = sites[0]!;
  const siteCalls = callsIn(site).filter((c) => failingKeys.has(calleeName(c) ?? ""));
  const keys = new Set(siteCalls.map((c) => calleeName(c)!));
  if (keys.size !== 1) return { reason: "wire_site_ambiguous" };
  const key = [...keys][0]!;
  // an async target's failing call must settle inside the try: awaited, or the returned value (we add the await)
  if (isAsync && ts.isExpressionStatement(site) && !ts.isAwaitExpression(site.expression)) return { reason: "wire_site_unawaited" };
  // scenarios failing at the site: the injected fake's FIRST outcome fails (only known when that fake drives one call)
  const stringParams = t.node.parameters.map((p, i) => ({ p, i })).filter(({ p }) => ts.isIdentifier(p.name) && p.type?.kind === ts.SyntaxKind.StringKeyword);
  const failing: { s: Scenario; e: ErrorInfo; params: Map<string, string | null> }[] = [];
  for (const s of sc.scenarios) {
    const injs = s.inject.get(key) ?? [];
    if (injs.length > 1) return { reason: "wire_fake_ambiguous" };
    if (!injs.length) continue;
    const first = failureOf(injs[0]!.outcomes[0]!);
    if (!first) continue;
    if ((sc.uses.get(injs[0]!.owner) ?? 0) > 1) return { reason: "wire_fake_shared" };
    failing.push({ s, e: first, params: new Map(stringParams.map(({ p, i }) => [(p.name as ts.Identifier).text, paramValue(sf, t, s.call, i)])) });
  }
  if (!failing.length) return { reason: "wire_no_failing_example" };
  // v1 has no retry: outside a loop, the failing fake (driving its one example) expected to be called more than once
  // asks for a retry, which v1 never derives (see spec/derive-wire-v1.md)
  if (!insideLoop(site, t.node.body)) {
    // ... or a failing fake with a later outcome, whose example still expects to settle normally (fail, then answer)
    if (failing.some(({ s }) => (s.kind === "resolves" || s.kind === "returns") && s.inject.get(key)![0]!.outcomes.length > 1)) return { reason: "wire_retry_not_in_v1" };
    const owners = new Set(failing.map(({ s }) => s.inject.get(key)![0]!.owner));
    for (const l of task.bullets) {
      const m = /^- expect ([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)?) is called (\d+) times?$/.exec(l);
      if (m && Number(m[2]) > 1 && [...owners].some((o) => o === m[1] || o === m[1]!.split(".")[0] || m[1] === o.split(".")[0])) return { reason: "wire_retry_not_in_v1" };
    }
  }
  // the edit is needed: some failing scenario expects something other than the call's own error passing through
  if (failing.every(({ s, e }) => (s.kind === "rejects" || s.kind === "throws") && s.message === e.message)) return { reason: "wire_not_needed" };
  const fits: WireCandidate[] = [];
  // continue: inside a loop, every failing scenario settles normally
  if (insideLoop(site, t.node.body) && failing.every(({ s }) => s.kind === "resolves" || s.kind === "returns")) fits.push({ kind: "continue" });
  // rethrow: every eligible helper of the module, every argument tuple from the fixed pool
  const pool = [...WIRE_ARG_FORMS.map((f) => f.id), ...stringParams.map(({ p }) => `param:${(p.name as ts.Identifier).text}`)];
  const helpers = sf.statements.filter((s): s is ts.FunctionDeclaration => ts.isFunctionDeclaration(s) && !!s.name && s.name.text !== (t.kind === "function" ? t.name : "")).map((s) => wireHelper(sf, s.name!.text)).filter((h) => h !== null);
  let tried = 0;
  if (failing.every(({ s }) => (s.kind === "rejects" || s.kind === "throws") && s.message !== null)) {
    for (const h of helpers) {
      const n = h.params.length;
      const idx = new Array<number>(n).fill(0);
      for (;;) {
        if (++tried > WIRE_MAX_CANDIDATES) return { reason: "wire_search_too_large" };
        const args = idx.map((j) => pool[j]!);
        const ok = failing.every(({ s, e, params }) => {
          const vals = args.map((a) => argValue(a, e, params));
          return vals.every((v) => v !== null) && evalWireHelper(h, vals as string[]) === s.message;
        });
        if (ok) fits.push({ kind: "rethrow", helper: h.name, args });
        let d = n - 1;
        while (d >= 0 && ++idx[d]! === pool.length) { idx[d] = 0; d -= 1; }
        if (d < 0) break;
      }
    }
  }
  if (!fits.length) return { reason: "wire_no_fit" };
  if (fits.length > 1) return { reason: "wire_ambiguous", detail: String(fits.length) };
  const c = fits[0]!;
  const oldText = site.getText(sf);
  const inner = isAsync && ts.isReturnStatement(site) && site.expression && !ts.isAwaitExpression(site.expression) ? `return await ${site.expression.getText(sf)};` : oldText;
  const catchHead = c.kind === "continue" ? "catch" : "catch (error)";
  const catchBody = c.kind === "continue" ? "continue;" : `throw new Error(${c.helper}(${c.args.map(argText).join(", ")}), { cause: error });`;
  const newText = `try { ${inner} } ${catchHead} { ${catchBody} }`;
  const formatted = (indent: string): string => {
    const i2 = `${indent}  `;
    const body = c.kind === "continue" || catchBody.length + i2.length <= 120
      ? `${i2}${catchBody}`
      : [`${i2}throw new Error(`, `${i2}  ${c.helper}(`, ...c.args.map((a, j) => `${i2}    ${argText(a)}${j < c.args.length - 1 ? "," : ""}`), `${i2}  ),`, `${i2}  { cause: error }`, `${i2});`].join("\n");
    return [`try {`, `${i2}${inner}`, `${indent}} ${catchHead} {`, body, `${indent}}`].join("\n");
  };
  return { site: oldText, candidate: c, oldText, newText, formatted };
}

/** Job A entry for a derive-wire spec: refusal code in `why.reason`; null when there is no candidate. */
export function runDeriveWireRule(trigger: string, params: Record<string, unknown>, objective: string, files: readonly { path: string; content: string }[], isTest: (p: string) => boolean = (p) => /\.test\.ts$/.test(p), why?: { reason?: string }, raw?: string): ExistingEdit | null {
  const r = deriveWireDetail(trigger, params, objective, files, isTest, raw);
  if (!r.edit && why) why.reason = r.reason ?? "wire_refused";
  return r.edit;
}

export function deriveWireDetail(trigger: string, params: Record<string, unknown>, objective: string, files: readonly { path: string; content: string }[], isTest: (p: string) => boolean = (p) => /\.test\.ts$/.test(p), raw?: string): { edit: ExistingEdit | null; reason: string | null; derivation?: WireDerivation } {
  const no = (reason: string) => ({ edit: null, reason });
  if (!isWireParams(params) || trigger !== DERIVE_WIRE_TRIGGER) return no("wire_params");
  if (raw !== undefined && rawIssueProblem(raw)) return no("wire_behavior_code");
  const task = parseWireTask(trigger, objective);
  if ("reason" in task) return no(task.reason);
  const file = files.find((f) => f.path === task.file);
  if (!file) return no("target_file_not_found");
  const d = deriveWire(task, file.content);
  if ("reason" in d) return no(d.reason);
  const g = gateWireEdit(task.target, task.file, { oldText: d.oldText, newText: d.newText }, [task.header, ...task.bullets], files, isTest);
  if (!g.edit) return { ...g, derivation: d };
  // readable layout: the same tokens, one statement per line; re-checked with the Job B static check itself
  const sf = ts.createSourceFile(file.path, file.content, ts.ScriptTarget.Latest, true);
  const t = findTarget(sf, task.target)!;
  const site = ownStatements(t.node.body!).find((s) => s.getText(sf) === d.oldText)!;
  const start = site.getStart(sf);
  const indent = /^[ \t]*/.exec(file.content.slice(file.content.lastIndexOf("\n", start - 1) + 1, start))![0];
  const content = file.content.slice(0, start) + d.formatted(indent) + file.content.slice(site.getEnd());
  const read: Read = (rel) => (rel === file.path ? content : ((f) => (f && !isTest(rel) && !isExcludedSource(rel) ? f.content : null))(files.find((x) => x.path === rel)));
  const test = g.edit.extra[0]!;
  if (!wireEditShape(file.path, file.content, content, task.target)) return no("wire_shape");
  const jb = gradeExistingEditProblem(file.path, file.content, content, test.path, test.content, read);
  if (jb) return no(jb);
  return { edit: { ...g.edit, content }, reason: null, derivation: d };
}
