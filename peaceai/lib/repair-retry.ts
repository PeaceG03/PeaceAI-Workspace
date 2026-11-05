// repair-retry-v1 (M203, batch 39; spec/repair-retry-v1.md). EXPERIMENTAL, opt-in, NOT the default, NOT for credit.
// When the loop's first attempt fails verification, the next attempt may be proposed from verifier-v1's per-case
// evidence (expected vs the value the candidate returned, or its error name) of ONE run, and retried, up to
// RETRY_MAX_ATTEMPTS attempts in all. Allowed only under VERDICT_MODE oop-v1 (refused in any in-process mode). Every
// attempt is judged by verifier-v1 on its own run alone; a prediction made here is never a verdict.
// Pure functions: nothing here runs code under test.
import { createHash } from "node:crypto";
import ts from "typescript";
import { EDIT_DANGEROUS, EDIT_NEW_WORDS, editClass, editGlobalWriteCount, editVocabOf, type Edit, type Feedback, type Proposal, type Proposer, type ProposeInput } from "./loop.ts";
import { EDIT_SCOPE_CLASSES } from "./looprow.ts";
import { valuesEqual, type CaseExpect, type CaseGot, type DataCase } from "./verifier.ts";

export const REPAIR_RETRY_V1 = "repair-retry-v1" as const;
export type RepairRetryMode = typeof REPAIR_RETRY_V1;
/** PINNED: attempts in all (attempt 1 is the base proposer's; at most two evidence-driven retries). */
export const RETRY_MAX_ATTEMPTS = 3;
/** The loop codes repair-retry-v1 can end a task with. */
export const RETRY_CODES = ["RETRY_INPROC_REFUSED", "RETRY_NO_VERDICT", "RETRY_VERDICT_FOREIGN", "RETRY_EVIDENCE_COMBINED"] as const;
export type RetryCode = (typeof RETRY_CODES)[number];

/** PINNED, separate from EDIT_SCOPE_POLICY (which is unchanged): the opt-in edit class repair-retry-v1 admits for an
 *  attempt after the first, under oop-v1 only. See spec/repair-retry-v1.md for the precise definition. */
export const RETRY_SCOPE_POLICY = Object.freeze({
  name: "rr-in-function-v1" as const,
  /** the classes admitted: M175's own (unchanged) plus one function body rewritten, optionally with one private helper */
  classes: Object.freeze(["export-keyword", "in-body", "rr-in-function", "rr-helper"] as const),
  /** at most this many characters added over the original file (a bounded edit, not a rewrite) */
  maxAddedChars: 600,
});
/** PINNED: words a retry edit may add beyond the original file's own words and EDIT_NEW_WORDS (plus names it declares
 *  locally). Keywords for multi-statement bodies, TS primitive types for a helper's parameters, and the pure Math /
 *  String operations the output transforms write. Never a dangerous word (EDIT_DANGEROUS is checked first). */
export const RETRY_NEW_WORDS: readonly string[] = Object.freeze(["const", "let", "else", "for", "of", "while", "break", "continue", "function",
  "number", "string", "boolean", "Math", "round", "floor", "ceil", "trunc", "abs", "min", "max", "trim"]);

// ---- per-run evidence (one verifier-v1 run, labelled)

export interface EvidenceCase { readonly id: string; readonly fn: string; readonly args: readonly unknown[]; readonly expect: CaseExpect; readonly pass: boolean; readonly got?: CaseGot; readonly run: string }
/** One verifier-v1 run's evidence: the module it loaded, and every case of THAT run tagged with the run's label. */
export interface RetryEvidence { readonly run: string; readonly module: string; readonly cases: readonly EvidenceCase[] }
/** A verifier-v1 verdict for one attempt, labelled with the run it came from. */
export interface RetryVerdict { readonly mode: string; readonly run: string; readonly code: string; readonly pass: number; readonly fail: number; readonly results: readonly { readonly id: string; readonly pass: boolean; readonly run: string }[] }

/** The label of attempt `attempt`'s own run: its number and the sha256 of exactly the edits it applied. */
export function retryRunLabel(attempt: number, edits: readonly Edit[] | null): string {
  if (edits === null) return "baseline";
  const h = createHash("sha256");
  for (const e of [...edits].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))) h.update(e.path + "\0" + e.content + "\0");
  return `attempt-${attempt}:${h.digest("hex").slice(0, 16)}`;
}
/** Why `ev` is not one run's evidence (null: it is). */
export function evidenceProblem(ev: RetryEvidence | null | undefined): RetryCode | null {
  if (!ev || typeof ev.run !== "string" || !Array.isArray(ev.cases) || ev.cases.length === 0) return "RETRY_NO_VERDICT";
  if (ev.cases.some((c) => c.run !== ev.run)) return "RETRY_EVIDENCE_COMBINED"; // m203-guard:ev-combined
  if (new Set(ev.cases.map((c) => c.id)).size !== ev.cases.length) return "RETRY_EVIDENCE_COMBINED"; // m203-guard:ev-dup
  return null;
}
/**
 * Why attempt `attempt` (applying `edits`) may NOT be credited as a pass (null: it may). Credit needs this attempt's own
 * verifier-v1 verdict: mode oop-v1, OOP_OK, every case passing, no failure, and every result from this attempt's own
 * run label. A verdict from another attempt, another edit, the baseline, or one that mixes runs is never credit.
 */
export function retryCreditProblem(verdict: RetryVerdict | null | undefined, attempt: number, edits: readonly Edit[]): RetryCode | null {
  if (!verdict || verdict.mode !== "oop-v1" || verdict.code !== "OOP_OK") return "RETRY_NO_VERDICT"; // m203-guard:credit-verdict
  if (verdict.results.length === 0 || verdict.fail !== 0 || verdict.pass !== verdict.results.length || verdict.results.some((r) => r.pass !== true)) return "RETRY_NO_VERDICT"; // m203-guard:credit-pass
  const own = retryRunLabel(attempt, edits);
  if (verdict.results.some((r) => r.run !== verdict.run)) return "RETRY_EVIDENCE_COMBINED"; // m203-guard:credit-combined
  if (verdict.run !== own) return "RETRY_VERDICT_FOREIGN"; // m203-guard:credit-own
  return null;
}
/** repair-retry-v1 only under oop-v1: any in-process verdict mode is refused (the M199-M201 terminal decisions stand). */
export function retryModeProblem(mode: string | undefined, verdictMode: string): RetryCode | null {
  if (mode === undefined) return null;
  if (mode !== REPAIR_RETRY_V1) return "RETRY_INPROC_REFUSED";
  if (verdictMode !== "oop-v1") return "RETRY_INPROC_REFUSED"; // m203-guard:mode-oop
  return null;
}

// ---- the opt-in edit class (rr-in-function-v1)

const parse = (s: string): ts.SourceFile | null => {
  const sf = ts.createSourceFile("rr.tsx", s, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const d = (sf as unknown as { parseDiagnostics?: readonly ts.Diagnostic[] }).parseDiagnostics;
  return d && d.length ? null : sf;
};
const counts = (s: string): Map<string, number> => {
  const m = new Map<string, number>();
  for (const w of s.match(/[A-Za-z_$][\w$]*/g) ?? []) m.set(w, (m.get(w) ?? 0) + 1);
  return m;
};
interface FnShape { name: string; head: string; body: ts.Node; node: ts.Node }
/** A top-level function: `[export] function f(...) {...}`, or `[export] const f = (...) => ... | function (...) {...}`. */
function fnShape(st: ts.Statement, sf: ts.SourceFile): FnShape | null {
  if (ts.isFunctionDeclaration(st) && st.name && st.body) return { name: st.name.text, head: sf.text.slice(st.getStart(sf), st.body.getStart(sf)), body: st.body, node: st };
  if (ts.isVariableStatement(st) && st.declarationList.declarations.length === 1) {
    const d = st.declarationList.declarations[0]!;
    if (ts.isIdentifier(d.name) && d.initializer && (ts.isArrowFunction(d.initializer) || ts.isFunctionExpression(d.initializer))) {
      const body = d.initializer.body;
      return { name: d.name.text, head: sf.text.slice(st.getStart(sf), body.getStart(sf)), body, node: st };
    }
  }
  return null;
}
/** Names a function declares inside itself (parameters, variables, inner functions). */
function localsOf(n: ts.Node): Set<string> {
  const out = new Set<string>();
  const bind = (b: ts.BindingName): void => { if (ts.isIdentifier(b)) out.add(b.text); else for (const e of b.elements) if (!ts.isOmittedExpression(e)) bind(e.name); };
  const visit = (x: ts.Node): void => {
    if (ts.isVariableDeclaration(x) || ts.isParameter(x) || ts.isBindingElement(x)) bind(x.name);
    if (ts.isFunctionDeclaration(x) && x.name) out.add(x.name.text);
    ts.forEachChild(x, visit);
  };
  visit(n);
  return out;
}
/** Is identifier `id` used as a plain name (a declaration or a reference), not a property name or a key? */
const plainName = (id: ts.Identifier): boolean => {
  const p = id.parent;
  if (ts.isPropertyAccessExpression(p) && p.name === id) return false;
  if ((ts.isPropertyAssignment(p) || ts.isMethodDeclaration(p) || ts.isPropertyDeclaration(p) || ts.isPropertySignature(p) || ts.isShorthandPropertyAssignment(p)) && p.name === id) return false;
  if (ts.isQualifiedName(p) || ts.isBindingElement(p) && p.propertyName === id) return false;
  return true;
};

/**
 * The rr-in-function-v1 class of one edit to an existing source file whose M175 class is a refusal (orig -> next), or a
 * refusal reason. Admitted ("rr-in-function" / "rr-helper") only when ALL hold:
 *  1. both texts parse; next adds at most RETRY_SCOPE_POLICY.maxAddedChars characters;
 *  2. every top-level statement is text-identical to the original's, except exactly one top-level function whose head
 *     (export / modifiers / name / parameters / return type: the text before its body) is unchanged and whose body
 *     differs; plus, optionally, exactly one ADDED top-level `function` declaration (a helper): a body, a name no
 *     top-level statement of the original declares, no modifier at all (so never exported, async or declared);
 *  3. no dangerous word (EDIT_DANGEROUS) appears more often than in the original (comments and strings counted);
 *  4. no more global writes (an assignment / ++ / -- / delete rooted at an undeclared name) than the original;
 *  5. every word of next's code the original lacks is in EDIT_NEW_WORDS or RETRY_NEW_WORDS, or is a name declared
 *     inside the changed function or the helper and used only as a plain name (never a property name, a key, or text
 *     inside a string / template / regex).
 */
export function retrySourceClass(orig: string, next: string): "rr-in-function" | "rr-helper" | string {
  const sa = parse(orig), sb = parse(next);
  if (!sa || !sb) return "rr-parse"; // m203-guard:class-parse
  if (next.length - orig.length > RETRY_SCOPE_POLICY.maxAddedChars) return "rr-too-large"; // m203-guard:class-size
  const a = [...sa.statements], b = [...sb.statements];
  const text = (s: ts.Statement, sf: ts.SourceFile) => sf.text.slice(s.getStart(sf), s.end);
  let helper: ts.FunctionDeclaration | null = null;
  let bb = b;
  if (b.length === a.length + 1) {
    // the one added statement: the first index whose removal leaves at most one statement differing from the original
    const aText = new Set(a.map((s) => text(s, sa)));
    const topNames = new Set<string>();
    for (const s of a) { if ((ts.isFunctionDeclaration(s) || ts.isClassDeclaration(s)) && s.name) topNames.add(s.name.text); if (ts.isVariableStatement(s)) for (const d of s.declarationList.declarations) if (ts.isIdentifier(d.name)) topNames.add(d.name.text); }
    const valid: number[] = [];
    for (let k = 0; k < b.length; k++) {
      if (aText.has(text(b[k]!, sb))) continue;
      const rest = [...b.slice(0, k), ...b.slice(k + 1)];
      if (rest.filter((s, i) => text(s, sb) !== text(a[i]!, sa)).length <= 1) valid.push(k);
    }
    if (valid.length === 0) return "rr-top-level-count";
    // M208: when the changed function and the helper are adjacent either placement is a valid "added" statement; the
    // added one is the function declaration with a NEW top-level name (the changed function keeps its existing name)
    let pick = valid[0]!;
    const fresh = valid.find((k) => { const x = b[k]!; return ts.isFunctionDeclaration(x) && !!x.name && !topNames.has(x.name.text); });
    if (fresh !== undefined) pick = fresh; // m208-guard:class-helper-pick
    const h = b[pick]!;
    if (!ts.isFunctionDeclaration(h) || !h.name || !h.body) return "rr-helper-shape"; // m203-guard:class-helper-fn
    if ((ts.getModifiers(h) ?? []).length || (ts.canHaveDecorators(h) && (ts.getDecorators(h)?.length ?? 0) > 0) || h.asteriskToken) return "rr-helper-modifier"; // m203-guard:class-helper-private
    if (topNames.has(h.name.text)) return "rr-helper-name"; // m203-guard:class-helper-name
    if (counts(orig).has(h.name.text)) return "rr-helper-shadow"; // m208-guard:class-helper-shadow
    helper = h;
    bb = [...b.slice(0, pick), ...b.slice(pick + 1)];
  }
  if (bb.length !== a.length) return "rr-top-level-count"; // m203-guard:class-count
  const diffs: number[] = [];
  for (let i = 0; i < a.length; i++) if (text(a[i]!, sa) !== text(bb[i]!, sb)) diffs.push(i);
  if (diffs.length > 1) return "rr-two-functions"; // m203-guard:class-one-fn
  if (diffs.length === 0 && !helper) return "rr-unchanged";
  if (diffs.length === 0) return "rr-helper-unused";
  const fa = fnShape(a[diffs[0]!]!, sa), fb = fnShape(bb[diffs[0]!]!, sb);
  if (!fa || !fb || fa.name !== fb.name) return "rr-not-function"; // m203-guard:class-fn
  if (fa.head !== fb.head) return "rr-head-changed"; // m203-guard:class-head
  // 3. dangerous words, 4. global writes (the M175 checks, unchanged, on the full texts)
  const ca = counts(orig), cb = counts(next);
  for (const w of EDIT_DANGEROUS) if ((cb.get(w) ?? 0) > (ca.get(w) ?? 0)) return "dangerous:" + w; // m203-guard:class-dangerous
  if ((editGlobalWriteCount(next) ?? 0) > (editGlobalWriteCount(orig) ?? 0)) return "global-write"; // m203-guard:class-global
  // 5. new words
  const vocab = editVocabOf(orig, true);
  const locals = localsOf(fb.node);
  if (helper) { for (const n of localsOf(helper)) locals.add(n); locals.add(helper.name!.text); }
  const plainOnly = new Map<string, boolean>();
  const visit = (x: ts.Node): void => {
    if (ts.isIdentifier(x)) plainOnly.set(x.text, (plainOnly.get(x.text) ?? true) && plainName(x));
    ts.forEachChild(x, visit);
  };
  visit(sb);
  for (const w of editVocabOf(next, true)) {
    if (vocab.has(w) || EDIT_NEW_WORDS.includes(w) || RETRY_NEW_WORDS.includes(w)) continue;
    if (locals.has(w) && plainOnly.get(w) === true && !textWords(sb).has(w)) continue; // m203-guard:class-local
    return "new-word:" + w; // m203-guard:class-new-word
  }
  return helper ? "rr-helper" : "rr-in-function";
}
/** Words inside string / template / regex literals of a parsed file. */
function textWords(sf: ts.SourceFile): Set<string> {
  const out = new Set<string>();
  const visit = (x: ts.Node): void => {
    if (ts.isStringLiteral(x) || ts.isNoSubstitutionTemplateLiteral(x) || ts.isRegularExpressionLiteral(x) || ts.isTemplateHead(x) || ts.isTemplateMiddle(x) || ts.isTemplateTail(x)) for (const w of x.getText(sf).match(/[A-Za-z_$][\w$]*/g) ?? []) out.add(w);
    ts.forEachChild(x, visit);
  };
  visit(sf);
  return out;
}
/** The class of one retry-attempt edit: M175's editClass first (its file-kind refusals stand; its admitted classes
 *  stay admitted); a structural / lexical M175 refusal is then judged by retrySourceClass. */
export function retryEditClass(path: string, content: string, original: (p: string) => string | null): string {
  const c = editClass(path, content, original);
  if ((EDIT_SCOPE_CLASSES as readonly string[]).includes(c)) return c;
  if (["test-file", "lockfile", "runner-infra", "config", "new-file"].includes(c)) return c; // m203-guard:class-filekind
  return retrySourceClass(original(path) ?? "", content);
}
/** Why a retry attempt's proposal is outside RETRY_SCOPE_POLICY (null: inside). Exactly one file may change; edits the
 *  loop owns (outside the copy, team tests) are left to applyEdits as in M175. */
export function retryScopeProblem(edits: readonly Edit[], original: (p: string) => string | null, skip: (p: string) => boolean): string | null {
  const own = edits.filter((e) => !skip(e.path));
  if (new Set(own.map((e) => e.path)).size > 1) return "rr-files"; // m203-guard:scope-one-file
  for (const e of own) {
    const c = retryEditClass(e.path, e.content, original);
    if (!(RETRY_SCOPE_POLICY.classes as readonly string[]).includes(c)) return c; // m203-guard:scope-policy
  }
  return null;
}

// ---- the evidence-driven proposer

/** Output transforms, in this pinned order: what the next attempt may wrap a function's returned value in. */
const M = { round: Math.round, floor: Math.floor, ceil: Math.ceil, trunc: Math.trunc };
const strTrim = String.prototype.trim, strLower = String.prototype.toLowerCase, strUpper = String.prototype.toUpperCase;
const apply = Reflect.apply;
interface Transform { name: string; wrap: (e: string) => string; f: (v: unknown) => { ok: boolean; v?: unknown } }
const num = (g: (x: number) => number) => (v: unknown) => (typeof v === "number" ? { ok: true, v: g(v) } : { ok: false });
const str = (g: (x: string) => string) => (v: unknown) => (typeof v === "string" ? { ok: true, v: g(v) } : { ok: false });
export const RETRY_TRANSFORMS: readonly Transform[] = Object.freeze([
  { name: "round", wrap: (e: string) => `Math.round(${e})`, f: num((x) => M.round(x)) },
  { name: "floor", wrap: (e: string) => `Math.floor(${e})`, f: num((x) => M.floor(x)) },
  { name: "ceil", wrap: (e: string) => `Math.ceil(${e})`, f: num((x) => M.ceil(x)) },
  { name: "trunc", wrap: (e: string) => `Math.trunc(${e})`, f: num((x) => M.trunc(x)) },
  { name: "trim", wrap: (e: string) => `(${e}).trim()`, f: str((x) => apply(strTrim, x, []) as string) },
  { name: "lower", wrap: (e: string) => `(${e}).toLowerCase()`, f: str((x) => apply(strLower, x, []) as string) },
  { name: "upper", wrap: (e: string) => `(${e}).toUpperCase()`, f: str((x) => apply(strUpper, x, []) as string) },
  { name: "not", wrap: (e: string) => `!(${e})`, f: (v: unknown) => (typeof v === "boolean" ? { ok: true, v: !v } : { ok: false }) },
]);

/** Which transform maps EVERY case of this one run to its expected value (failing cases: from what they returned;
 *  passing cases: from their expected value, which they returned), with at least one failing case and no error. */
export function fitTransform(ev: RetryEvidence): { transform: Transform; fn: string } | { refuse: string } {
  const p = evidenceProblem(ev);
  if (p) return { refuse: p }; // m203-guard:fit-one-run
  const failing = ev.cases.filter((c) => !c.pass);
  if (failing.length === 0) return { refuse: "no-failing" };
  const fns = new Set(failing.map((c) => c.fn));
  if (fns.size !== 1) return { refuse: "many-functions" };
  const fn = failing[0]!.fn;
  for (const t of RETRY_TRANSFORMS) {
    let fits = true;
    for (const c of ev.cases) {
      if (c.fn !== fn) continue; // other functions are not touched by the edit
      if (!c.expect.ok || c.expect.negate || c.expect.any) { fits = false; break; } // M204: only value expectations fit
      const from = c.pass ? { ok: true as const, value: c.expect.value } : c.got;
      if (!from || !from.ok) { fits = false; break; }
      const out = t.f(from.value);
      if (!out.ok || !valuesEqual(out.v, c.expect.value)) { fits = false; break; } // m203-guard:fit-all
    }
    if (fits) return { transform: t, fn };
  }
  return { refuse: "no-fit" };
}
/** `src` with every value function `fn` returns wrapped by `t` (its own returns only, not a nested function's). */
export function applyTransform(src: string, fn: string, t: Transform): string | null {
  const sf = parse(src);
  if (!sf) return null;
  let shape: FnShape | null = null;
  for (const st of sf.statements) { const s = fnShape(st, sf); if (s && s.name === fn) { shape = s; break; } }
  if (!shape) return null;
  const spans: [number, number][] = [];
  if (!ts.isBlock(shape.body)) spans.push([shape.body.getStart(sf), shape.body.end]);
  else {
    const visit = (x: ts.Node): void => {
      if (ts.isFunctionLike(x)) return; // nested functions return their own values
      if (ts.isReturnStatement(x)) { if (!x.expression) { spans.length = 0; spans.push([-1, -1]); return; } spans.push([x.expression.getStart(sf), x.expression.end]); }
      ts.forEachChild(x, visit);
    };
    ts.forEachChild(shape.body, visit);
  }
  if (spans.length === 0 || spans.some(([s]) => s < 0)) return null;
  let out = src;
  for (const [s, e] of spans.sort((x, y) => y[0] - x[0])) out = out.slice(0, s) + t.wrap(out.slice(s, e)) + out.slice(e);
  return out;
}

// ---- M208 (batch 44): a bounded private helper, when the fix is logic shared by every return of the function

/** The pinned transform kinds, by the TS type of the value they read and write (for the helper's signature). */
const KIND: Readonly<Record<string, string>> = Object.freeze({ round: "number", floor: "number", ceil: "number", trunc: "number", trim: "string", lower: "string", upper: "string", not: "boolean" });
/**
 * Which ordered pair of two different pinned transforms (first t1, then t2) maps EVERY case of this one run on the
 * function to its expected value, when no single transform does. Same rules as fitTransform: one run, at least one
 * failing case, no error, failing cases on one function, value expectations only. A prediction, never a verdict.
 */
export function fitPair(ev: RetryEvidence): { pair: readonly [Transform, Transform]; fn: string } | { refuse: string } {
  const one = fitTransform(ev);
  if (!("refuse" in one)) return { refuse: "single-fits" }; // m208-guard:pair-single-first
  if (one.refuse !== "no-fit") return { refuse: one.refuse }; // m208-guard:pair-one-run
  const fn = ev.cases.find((c) => !c.pass)!.fn;
  for (const t1 of RETRY_TRANSFORMS) for (const t2 of RETRY_TRANSFORMS) {
    if (t1 === t2 || KIND[t1.name] !== KIND[t2.name]) continue;
    let fits = true;
    for (const c of ev.cases) {
      if (c.fn !== fn) continue;
      const from = c.pass ? { ok: true as const, value: c.expect.value } : c.got;
      if (!from || !from.ok || !c.expect.ok) { fits = false; break; }
      const a = t1.f(from.value);
      const b = a.ok ? t2.f(a.v) : a;
      if (!b.ok || !valuesEqual(b.v, c.expect.value)) { fits = false; break; } // m208-guard:pair-all
    }
    if (fits) return { pair: [t1, t2] as const, fn };
  }
  return { refuse: "no-fit" };
}
/** A helper name that no word of `src` already uses (so it shadows nothing, top-level or inner). */
export function freshHelperName(src: string): string {
  const used = counts(src);
  let n = "rrShared", k = 1;
  while (used.has(n)) n = `rrShared${++k}`; // m208-guard:helper-fresh
  return n;
}
/**
 * `src` with ONE added private helper `function rrShared(v: T): T { return t2(t1(v)); }` placed right after function
 * `fn`, and every value `fn` returns (its own returns only) passed through it. Emitted only if the result is inside
 * rr-in-function-v1 as class "rr-helper" (else null): the proposer never offers an edit its own gate would refuse.
 */
export function applyHelper(src: string, fn: string, pair: readonly [Transform, Transform]): string | null {
  const sf = parse(src);
  if (!sf) return null;
  let shape: FnShape | null = null;
  for (const st of sf.statements) { const s = fnShape(st, sf); if (s && s.name === fn) { shape = s; break; } }
  if (!shape) return null;
  const name = freshHelperName(src), ty = KIND[pair[0].name]!;
  const call: Transform = { name: "helper", wrap: (e: string) => `${name}(${e})`, f: () => ({ ok: false }) };
  const wrapped = applyTransform(src, fn, call);
  if (wrapped === null) return null;
  const end = shape.node.end + (wrapped.length - src.length); // the function grew by the wraps; it ends there now
  const out = wrapped.slice(0, end) + `\n\nfunction ${name}(v: ${ty}): ${ty} {\n  return ${pair[1].wrap(pair[0].wrap("v"))};\n}` + wrapped.slice(end);
  if (retrySourceClass(src, out) !== "rr-helper") return null; // m208-guard:helper-class
  return out;
}

/** ProposeInput as the loop gives it under repair-retry-v1: each feedback entry carries its own run's evidence. */
export type RetryFeedback = Feedback & { evidence?: RetryEvidence };
export type RetryProposeInput = ProposeInput & { feedback: readonly RetryFeedback[]; retryBaseline?: RetryEvidence | null };

/**
 * repair-retry-v1's proposer: attempt 1 is `base` (e.g. repair-v2) unchanged. A later attempt first tries an output
 * transform fitted to ONE run's evidence (the last attempt's own run, applied to that attempt's code; else the baseline
 * run, applied to the original code), never a mix; if none fits it asks `base` again, which sees only its own attempts
 * (renumbered), as if run alone. Stops on a tampered or leftover run. Its predictions are never a verdict.
 */
export function retryProposer(base: Proposer): Proposer & { readonly transforms: string[] } {
  const mine = new Map<number, Edit[]>(); // attempt -> edits proposed
  const byBase = new Set<number>();
  const tried = new Set<string>();
  const transforms: string[] = [];
  const self: Proposer & { transforms: string[] } = {
    name: ("rr1-" + base.name).slice(0, 40),
    modelManifestSha256: base.modelManifestSha256 ?? null,
    transforms,
    prepare: base.prepare ? (search, input) => base.prepare!(search, input) : undefined,
    next(input0: ProposeInput): Proposal {
      const input = input0 as RetryProposeInput;
      const askBase = (): Proposal => {
        const fb = input.feedback.filter((f) => byBase.has(f.attempt)).map((f, i) => ({ attempt: i + 1, codes: f.codes, failing: f.failing, tests: f.tests }));
        const p = base.next({ ...input, attempt: fb.length + 1, feedback: fb });
        if ("edits" in p) { byBase.add(input.attempt); mine.set(input.attempt, p.edits); tried.add(retryRunLabel(0, p.edits)); }
        return p;
      };
      if (input.attempt === 1) return askBase();
      const last = input.feedback[input.feedback.length - 1];
      if (last && (last.codes.includes("TAMPERED") || last.codes.includes("LEFTOVERS"))) return { refuse: "NO_MORE_EDITS" }; // m203-guard:prop-stop
      const orig = new Map(input.files.map((f) => [f.path, f.content] as const));
      const runs: { ev: RetryEvidence | null | undefined; code: (p: string) => string | undefined }[] = [];
      if (last) { const ed = mine.get(last.attempt) ?? []; runs.push({ ev: last.evidence, code: (p) => ed.find((e) => e.path === p)?.content ?? orig.get(p) }); }
      runs.push({ ev: input.retryBaseline, code: (p) => orig.get(p) });
      for (const r of runs) {
        if (!r.ev) continue;
        const fit = fitTransform(r.ev);
        const src = r.code(r.ev.module);
        if (src === undefined) continue;
        let next: string | null, what: string;
        if (!("refuse" in fit)) { next = applyTransform(src, fit.fn, fit.transform); what = fit.transform.name; }
        else {
          const pf = fitPair(r.ev); // M208: no single transform fits -> one bounded private helper, if a pair fits
          if ("refuse" in pf) continue;
          next = applyHelper(src, pf.fn, pf.pair); what = `helper(${pf.pair[0].name}+${pf.pair[1].name})`;
        }
        if (next === null || next === src) continue;
        const edits = [{ path: r.ev.module, content: next }];
        const key = retryRunLabel(0, edits);
        if (tried.has(key)) continue;
        tried.add(key);
        mine.set(input.attempt, edits);
        transforms.push(`${input.attempt}:${what}@${r.ev.run.split(":")[0]}`);
        return { edits };
      }
      return askBase();
    },
  };
  if (!base.prepare) delete (self as { prepare?: unknown }).prepare;
  return self;
}
