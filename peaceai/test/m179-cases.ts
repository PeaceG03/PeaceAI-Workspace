// M179 behavior cases (batch 18) for repair-v2's anchored continuation (peaceai/lib/editpropose.ts anchorFor,
// composeOnAnchor and the M179 block of repairProposer.next). As data so m179-mutation.test.ts can replay the pure cases
// against each mutant. Each case throws (node:assert) on failure. The continuation is admitted on two unrelated code
// shapes (a class whose second method calls the first; two modules where one function imports the other), each a fix
// in two parts where one part alone changes no test result (a masked fault), so no single candidate and no pair of
// improving candidates is the fix; every m179 guard has a refused near miss; every proposal of the admits is checked
// against the loop's M175 gate (in-body). Fixtures are tiny synthetic repos written for these tests from general shapes
// (a rectangle, a mean and its centered values, a tiered fee): none is modeled on a dev-split task's code or on a
// reference diff, and none is a PeaceSTOCKS shape. The "tests" are an in-process oracle; the end-to-end case
// (needsCand) runs the real loop and needs M179_CAND (no fallback user). Spec: peaceai/spec/repair-v2-m179.md.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import vm from "node:vm";
import ts from "typescript";
import { openRepo } from "../lib/codesearch.ts";
import type * as Prop from "../lib/editpropose.ts";
import { repairProposer } from "../lib/editpropose.ts"; // the e2e case runs the real (unmutated) proposer
import * as loop from "../lib/loop.ts";
import type * as Loop from "../lib/loop.ts";
import { loopRowProblem, type LoopRow } from "../lib/looprow.ts";
import { STAGE2_CAND_ENV, stage2CandUid } from "../lib/selfpropose.ts";
import { e2eTask, opts as opts174 } from "./m174-cases.ts";
import { setup as setup151, teardown as teardown151 } from "./m151-fixtures.ts";

// The end-to-end case runs ONLY as the candidate uid named by M179_CAND (the box suite sets it explicitly); with none
// set it asserts the fail-closed CAND_UID_* refusal. It never falls back to another batch's candidate user.
const M179_CAND = process.env.M179_CAND ?? "";
export const m179Cand = (): boolean => stage2CandUid({ [STAGE2_CAND_ENV]: M179_CAND }).ok;

export interface Libs { prop: typeof Prop }
export interface Ctx { base: string }
export interface Case { id: string; needsCand?: boolean; run: (l: Libs, ctx: Ctx) => void }

export function setup(): Ctx { return { base: mkdtempSync(join(tmpdir(), "peaceai-m179-")) }; }
export function teardown(ctx: Ctx): void { rmSync(ctx.base, { recursive: true, force: true }); }

let n = 0;
function repoDir(ctx: Ctx, files: Record<string, string>): string {
  const d = join(ctx.base, `r${n++}`);
  for (const [p, c] of Object.entries(files)) { mkdirSync(dirname(join(d, p)), { recursive: true }); writeFileSync(join(d, p), c); }
  return d;
}
const tsFiles = (files: Record<string, string>) => Object.keys(files).filter((p) => /\.tsx?$/.test(p)).sort().map((p) => ({ path: p, content: files[p]! }));
/** Loads `path` from the in-memory files as CommonJS; a relative import loads the other file from the same map. */
function load(m: ReadonlyMap<string, string>, path: string, cache = new Map<string, Record<string, unknown>>()): Record<string, unknown> {
  const hit = cache.get(path);
  if (hit) return hit;
  const js = ts.transpileModule(m.get(path)!, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const mod = { exports: {} as Record<string, unknown> };
  cache.set(path, mod.exports);
  const req = (spec: string) => { const p = join(dirname(path), spec); if (!m.has(p)) throw new Error(`no module ${spec}`); return load(m, p, cache); };
  vm.runInNewContext(js, { module: mod, exports: mod.exports, Math, require: req }, { timeout: 1000 });
  return mod.exports;
}
type Check = (x: Record<string, any>) => boolean;
const oracle = (path: string, checks: readonly Check[]) => (m: ReadonlyMap<string, string>): number => {
  let x: Record<string, any>;
  try { x = load(m, path); } catch { return 0; }
  let ok = 0;
  for (const c of checks) { try { if (c(x)) ok++; } catch { /* a failing test */ } }
  return ok;
};
const apply = (orig: ReadonlyMap<string, string>, edits: readonly Prop.RepairEdit[]) => { const m = new Map(orig); for (const e of edits) m.set(e.path, e.content); return m; };
interface Sim { proposals: Prop.RepairEdit[][]; counts: number[]; result: "pass" | "NO_EDIT" | "NO_MORE_EDITS" | "limit"; base: number; orig: Map<string, string>; queue: Prop.Candidate[] }
const MAX_ATTEMPTS = loop.MAX_ATTEMPTS;
/** The loop's attempt protocol in process: the oracle's count is the feedback (failing names empty, as for vitest / jest). */
function simulate(l: Libs, ctx: Ctx, files: Record<string, string>, request: string, path: string, checks: readonly Check[], o: Prop.RepairOptions = { v2: true }, max = MAX_ATTEMPTS): Sim {
  const d = repoDir(ctx, files);
  const test = oracle(path, checks);
  const total = checks.length;
  const p = l.prop.repairProposer(o);
  p.prepare(openRepo(d), { request, failing: [] });
  const fs = tsFiles(files);
  const orig = new Map(fs.map((f) => [f.path, f.content]));
  const base = test(orig);
  assert.ok(base < total, "the fixture is not broken");
  const sites = l.prop.locate(openRepo(d), { request, failing: [] }, o.v2 ? l.prop.CALLEE_DEPTH.v2 : l.prop.CALLEE_DEPTH.v1);
  const queue = l.prop.repairCandidates(sites, orig, new Set(), o.v2 === true);
  const baseline = { total, passing: base, failing: total - base };
  const feedback: Prop.RepairFeedback[] = [];
  const proposals: Prop.RepairEdit[][] = [];
  const counts: number[] = [];
  for (let attempt = 1; attempt <= max; attempt++) {
    const r = p.next({ files: fs, attempt, feedback, baseline });
    if ("refuse" in r) return { proposals, counts, result: r.refuse, base, orig, queue };
    proposals.push(r.edits);
    const pass = test(apply(orig, r.edits));
    counts.push(pass);
    if (pass === total) return { proposals, counts, result: "pass", base, orig, queue };
    feedback.push({ attempt, codes: ["TEST_FAIL"], failing: [], tests: { total, passedByPeaceAI: pass } });
  }
  return { proposals, counts, result: "limit", base, orig, queue };
}
const key = (e: readonly Prop.RepairEdit[]) => JSON.stringify(e);
/** The M175 gate on a candidate: the class the loop would give it before any run. */
function gate(orig: ReadonlyMap<string, string>, edits: readonly Prop.RepairEdit[]): string {
  const read = (p: string) => orig.get(p) ?? null;
  return loop.editScopeProblem(edits, read, () => false) ?? loop.editScopeOf(edits, read) ?? "none";
}
/** A synthetic candidate with one mutation per given offset (for the pure functions), on src/x.ts at site 0. */
const cand = (k: string, ...at: number[]): Prop.Candidate => ({ key: k, edits: [], muts: at.map((s) => ({ path: "src/x.ts", start: s, end: s + 1, text: "", template: "comparison", site: 0 })) });
const fb = (attempt: number, passedByPeaceAI: number, codes: string[] = ["TEST_FAIL"], total = 4): Prop.RepairFeedback => ({ attempt, codes, failing: [], tests: { total, passedByPeaceAI } });
const BASE = { total: 4, passing: 2, failing: 2 };

// ---- fixtures (synthetic, general shapes)
// A: a class whose `fits` calls `area`; area divides instead of multiplying, and fits compares with < instead of <=.
// fits' fix alone changes no test count (the wrong area masks it); area's fix alone raises the count.
const RECT = "export class Rect {\n  w: number;\n  h: number;\n  constructor(w: number, h: number) {\n    this.w = w;\n    this.h = h;\n  }\n  area(): number {\n    return this.w / this.h;\n  }\n  fits(limit: number): boolean {\n    return this.area() < limit;\n  }\n}\n";
const RECTS = { "src/rect.ts": RECT };
const RECT_REQ = "`area` and `fits` are wrong for a 2 by 3 rectangle.";
const RECT_CHECKS: Check[] = [(x) => new x.Rect(2, 3).area() === 6, (x) => new x.Rect(4, 5).area() === 20, (x) => new x.Rect(2, 3).fits(6) === true, (x) => new x.Rect(2, 3).fits(5) === false];
// B: two modules; `centered` imports `mean`; mean multiplies by the length instead of dividing, and centered subtracts
// the wrong way round. centered's fix alone changes no test count; mean's fix alone raises it.
const STATS = "export function mean(xs: number[]): number {\n  let s = 0;\n  for (const x of xs) s += x;\n  return s * xs.length;\n}\n";
const CENTER = "import { mean } from \"./stats.ts\";\nexport function centered(xs: number[]): number[] {\n  const m = mean(xs);\n  return xs.map((x) => m - x);\n}\n";
const MEANS = { "src/center.ts": CENTER, "src/stats.ts": STATS };
const MEAN_REQ = "`centered` gives the wrong values.";
const j = (a: number[]) => a.map((v) => v + 0).join(",");
const MEAN_CHECKS: Check[] = [(x) => j(x.centered([1, 2, 3])) === "-1,0,1", (x) => j(x.centered([5, 5])) === "0,0", (x) => j(x.centered([2, 4])) === "-1,1", (x) => x.centered([]).length === 0];
// C: nothing ever improves (the checks call nothing the request locates): no anchor, nothing moves
const NOISE: Check[] = [() => true, () => true, () => false];

/** The single candidates (of the static list over every located site) whose mutations make up `edits`, or null. */
function partsOf(l: Libs, ctx: Ctx, files: Record<string, string>, request: string, orig: ReadonlyMap<string, string>, edits: readonly Prop.RepairEdit[]): Prop.Candidate[] | null {
  const d = repoDir(ctx, files);
  const sites = l.prop.locate(openRepo(d), { request, failing: [] }, l.prop.CALLEE_DEPTH.v2);
  const all: Prop.Candidate[] = [];
  sites.forEach((_, i) => all.push(...l.prop.repairCandidates(sites, orig, new Set(), true, new Set(sites.map((_, k) => k).filter((k) => k !== i)))));
  for (let a = 0; a < all.length; a++) for (let b = a + 1; b < all.length; b++) {
    const c = l.prop.candidateFor(orig, [...all[a]!.muts, ...all[b]!.muts]);
    if (c && key(c.edits) === key(edits)) return [all[a]!, all[b]!];
  }
  return null;
}

/** An admit: the passing edit is two static candidates composed; one of them alone changes no test count, so neither a
 *  single candidate nor the improved-pair step (which pairs two improving candidates) can be it. */
const admit = (id: string, files: Record<string, string>, request: string, path: string, checks: Check[], want: RegExp[]): Case => ({
  id, run(l, ctx) {
    const s = simulate(l, ctx, files, request, path, checks);
    assert.equal(s.result, "pass", `${s.result} after ${s.proposals.length}`);
    const last = s.proposals.at(-1)!;
    const all = last.map((e) => e.content).join("\n");
    for (const w of want) assert.match(all, w);
    const parts = partsOf(l, ctx, files, request, s.orig, last);
    assert.ok(parts, "the passing edit is two candidates of the static list composed");
    const test = oracle(path, checks);
    const alone = parts.map((c) => test(apply(s.orig, c.edits)));
    assert.ok(alone.some((x) => x <= s.base), `a part alone raised no count (${alone} vs base ${s.base}): masked, so no improved pair has it`);
    assert.ok(alone.some((x) => x > s.base), `the other part alone is a clean partial fix (${alone} vs base ${s.base})`);
    assert.ok(!s.queue.some((c) => key(c.edits) === key(last)), "no single candidate is the fix");
    assert.ok(s.proposals.length <= MAX_ATTEMPTS);
    assert.equal(new Set(s.proposals.map(key)).size, s.proposals.length, "a proposal repeated");
    for (const p of s.proposals) assert.equal(gate(s.orig, p), "in-body");
  },
});

/** A scripted run on `files` (no oracle): `score` gives the passing count of each proposal (or "pass"). */
function scripted(l: Libs, ctx: Ctx, files: Record<string, string>, request: string, score: (edits: Prop.RepairEdit[], i: number) => number | "pass", total = 4, base = 2, max = 500) {
  const d = repoDir(ctx, files);
  const p = l.prop.repairProposer({ v2: true });
  p.prepare(openRepo(d), { request, failing: [] });
  const fs = tsFiles(files);
  const orig = new Map(fs.map((f) => [f.path, f.content]));
  const sites = l.prop.locate(openRepo(d), { request, failing: [] }, l.prop.CALLEE_DEPTH.v2);
  const queue = l.prop.repairCandidates(sites, orig, new Set(), true);
  const feedback: Prop.RepairFeedback[] = [];
  const proposals: Prop.RepairEdit[][] = [];
  let passed = false;
  for (let attempt = 1; attempt <= max; attempt++) {
    const r = p.next({ files: fs, attempt, feedback, baseline: { total, passing: base, failing: total - base } });
    if ("refuse" in r) break;
    proposals.push(r.edits);
    const sc = score(r.edits, attempt);
    if (sc === "pass") { passed = true; break; }
    feedback.push({ attempt, codes: ["TEST_FAIL"], failing: [], tests: { total, passedByPeaceAI: sc } });
  }
  return { proposals, passed, queue, sites, orig };
}

export const CASES: Case[] = [
  // ---- admits: two unrelated shapes, each a masked two-part fault fixed only by composing on the anchor
  admit("admit (a class: `fits` calls `area`): area's operator fix is the anchor; fits' comparison, unnoticed alone, is composed on it", RECTS, RECT_REQ, "src/rect.ts", RECT_CHECKS, [/return this\.w \* this\.h;/, /return this\.area\(\) <= limit;/]),
  admit("admit (two modules: `centered` imports `mean`): mean's operator fix is the anchor; centered's swapped operands, unnoticed alone, are composed on it", MEANS, MEAN_REQ, "src/center.ts", MEAN_CHECKS, [/return s \/ xs\.length;/, /xs\.map\(\(x\) => x - m\)/]),
  {
    id: "no anchor, no change: when nothing ever improves the proposals are the fixed order exactly (box behavior of the existing order)",
    run(l, ctx) {
      const s = simulate(l, ctx, MEANS, MEAN_REQ, "src/center.ts", NOISE);
      assert.ok(s.proposals.length > 2);
      assert.deepEqual(s.proposals.map(key), s.queue.slice(0, s.proposals.length).map((c) => key(c.edits)));
    },
  },
  {
    id: "order: up to the anchor the proposals are the fixed order; after it every proposal carries the anchor's edit",
    run(l, ctx) {
      const s = simulate(l, ctx, MEANS, MEAN_REQ, "src/center.ts", MEAN_CHECKS);
      const at = s.counts.findIndex((c) => c > s.base);
      assert.ok(at >= 0 && at < s.proposals.length - 1, "an anchor came before the fix");
      assert.deepEqual(s.proposals.slice(0, at + 1).map(key), s.queue.slice(0, at + 1).map((c) => key(c.edits)));
      assert.match(s.proposals[at]!.find((e) => e.path === "src/stats.ts")!.content, /return s \/ xs\.length;/);
      for (const p of s.proposals.slice(at + 1)) assert.match(p.find((e) => e.path === "src/stats.ts")?.content ?? "", /return s \/ xs\.length;/, "a proposal after the anchor dropped it");
    },
  },
  // ---- anchor (pure)
  {
    id: "anchor: the clean result with the highest count above the baseline is the anchor; a tie keeps the earliest",
    run(l) {
      const tried = [cand("a", 1), cand("b", 3), cand("c", 5), cand("d", 7)];
      assert.equal(l.prop.anchorFor(tried, [fb(1, 2), fb(2, 3), fb(3, 1), fb(4, 3)], BASE)?.key, "b");
      assert.equal(l.prop.anchorFor(tried, [fb(1, 2), fb(2, 3), fb(3, 4), fb(4, 3)], BASE)?.key, "c");
      assert.equal(l.prop.MAX_ANCHOR_MUTS, 3);
    },
  },
  {
    id: "anchor near miss (m179-guard:an-improves): results at or below the baseline give no anchor",
    run(l) {
      assert.equal(l.prop.anchorFor([cand("a", 1), cand("b", 3)], [fb(1, 2), fb(2, 1)], BASE), null);
      assert.equal(l.prop.anchorFor([cand("a", 1), cand("b", 3)], [fb(1, 3), fb(2, 2)], BASE)?.key, "a", "a later lower result does not replace the anchor");
    },
  },
  { id: "anchor near miss (no baseline): nothing is above an unknown baseline", run(l) { assert.equal(l.prop.anchorFor([cand("a", 1)], [fb(1, 4)], null), null); assert.equal(l.prop.anchorFor([cand("a", 1)], [fb(1, 4)], undefined), null); } },
  {
    id: "anchor near miss (m179-guard:an-clean): a higher count with a timeout, a load failure or leftovers is no anchor",
    run(l) { for (const c of [["TEST_FAIL", "TIMEOUT"], ["SUITE_LOAD", "TEST_FAIL"], ["LEFTOVERS"]]) assert.equal(l.prop.anchorFor([cand("a", 1)], [fb(1, 3, c)], BASE), null, c.join(",")); },
  },
  {
    id: "anchor near miss (m179-guard:an-total): a higher count with another total (tests lost or added), or no counts, is no anchor",
    run(l) {
      assert.equal(l.prop.anchorFor([cand("a", 1)], [fb(1, 3, ["TEST_FAIL"], 5)], BASE), null);
      assert.equal(l.prop.anchorFor([cand("a", 1)], [{ attempt: 1, codes: ["TEST_FAIL"], failing: [], tests: null }], BASE), null);
      assert.equal(l.prop.anchorFor([cand("a", 1)], [], BASE), null);
    },
  },
  {
    id: "anchor near miss (m179-guard:an-names): a higher count that breaks a test which passed before (a failing name outside the baseline's) is no anchor",
    run(l) {
      const names = (attempt: number, pass: number, failing: string[]): Prop.RepairFeedback => ({ attempt, codes: ["TEST_FAIL"], failing, tests: { total: 4, passedByPeaceAI: pass } });
      const baseFailing = ["t1", "t2"];
      assert.equal(l.prop.anchorFor([cand("a", 1)], [names(1, 3, ["t3"])], BASE, baseFailing), null, "t3 passed at baseline and fails now");
      assert.equal(l.prop.anchorFor([cand("a", 1), cand("b", 3)], [names(1, 3, ["t1"]), names(2, 4, ["t3"])], BASE, baseFailing)?.key, "a", "the later higher result breaks t3, so the earlier clean one stays the anchor");
      assert.equal(l.prop.anchorFor([cand("a", 1)], [names(1, 3, ["t2"])], BASE, baseFailing)?.key, "a", "a subset of the baseline's failing names is an anchor");
      assert.equal(l.prop.anchorFor([cand("a", 1)], [names(1, 3, [])], BASE, baseFailing)?.key, "a", "no names (vitest / jest) is an anchor, as before");
    },
  },
  { id: "anchor near miss (m179-guard:an-room): a candidate with MAX_ANCHOR_MUTS mutations is no anchor (no room for one more)", run(l) { assert.equal(l.prop.anchorFor([cand("abc", 1, 3, 5), cand("d", 7)], [fb(1, 4), fb(2, 3)], BASE)?.key, "d"); } },
  // ---- composition (pure)
  {
    id: "compose: the pick goes on top of the anchor (both mutations, marked anchored); near misses for overlap (m179-guard:co-overlap), the cap (co-cap), a result that does not parse (co-valid) and one already proposed (co-seen)",
    run(l) {
      const text = "export function f(a: number, b: number): number {\n  return a < b ? a + b : a - b;\n}\n";
      const files = new Map([["src/x.ts", text]]);
      const mu = (s: string, rep: string, nth = 0): Prop.Mutation => { let at = -1; for (let i = 0; i <= nth; i++) at = text.indexOf(s, at + 1); return { path: "src/x.ts", start: at, end: at + s.length, text: rep, template: "comparison", site: 0 }; };
      const c = (k: string, ...m: Prop.Mutation[]): Prop.Candidate => ({ key: k, muts: m, edits: [] });
      const A = c("A", mu("<", "<=")), B = c("B", mu("+", "-"));
      const got = l.prop.composeOnAnchor(A, B, files, new Set());
      assert.ok(got && got.anchored === true && got.muts.length === 2);
      assert.match(got.edits[0]!.content, /a <= b \? a - b : a - b/);
      assert.equal(l.prop.composeOnAnchor(A, c("A2", mu("<", ">")), files, new Set()), null, "overlap: tried alone instead");
      assert.equal(l.prop.composeOnAnchor(c("A12", mu("<", "<="), mu("-", "+")), c("B12", mu("+", "-"), mu("a", "b", 3)), files, new Set()), null, "4 mutations > MAX_ANCHOR_MUTS");
      assert.equal(l.prop.composeOnAnchor(c("P", mu("a + b", "(a + b")), c("Q", mu("a - b", "a - b)(")), files, new Set()), null, "does not parse");
      assert.equal(l.prop.composeOnAnchor(A, B, files, new Set([got.key])), null, "already proposed");
    },
  },
  {
    id: "evidence near miss (m179-guard:an-no-evidence): a composed candidate's result counts for no site in M178's demotion (here it would make site 1 live)",
    run(l) {
      const at = (k: string, site: number, anchored = false): Prop.Candidate => ({ key: k, edits: [], muts: [{ path: "src/x.ts", start: site, end: site, text: "", template: "comparison", site }], ...(anchored ? { anchored } : {}) });
      const tried = [at("a", 1), at("b", 0), at("c", 1, true), at("d", 1)];
      assert.deepEqual(l.prop.siteDemotions(tried, [fb(1, 2), fb(2, 1), fb(3, 3), fb(4, 2)], BASE, [], new Set()), [1]);
    },
  },
  {
    id: "near miss (m179-guard:an-v2-only): repair-v1 and a reranked list (model-v1's `order`) keep the fixed order on the same evidence and never compose",
    run(l, ctx) {
      for (const o of [{}, { order: (q: readonly Prop.Candidate[]) => [...q] }, { v2: true, order: (q: readonly Prop.Candidate[]) => [...q] }] as Prop.RepairOptions[]) {
        const s = simulate(l, ctx, RECTS, RECT_REQ, "src/rect.ts", RECT_CHECKS, o);
        assert.notEqual(s.result, "pass", JSON.stringify(Object.keys(o)));
        assert.ok(s.counts.some((c) => c > s.base), "the same evidence (a partial fix) was there");
        assert.deepEqual(s.proposals.map(key), s.queue.slice(0, s.proposals.length).map((c) => key(c.edits)));
      }
    },
  },
  {
    id: "deferred near misses (m179-guard:df-defer / df-tail): a queued candidate composed on a misleading anchor is still tried alone, after the queue (reorder, not drop)",
    run(l, ctx) {
      // scripted: the first proposal is a partial fix (the anchor); one later queued candidate is the whole fix ALONE,
      // and on top of the anchor it is not
      const files = MEANS;
      const s0 = scripted(l, ctx, files, MEAN_REQ, () => 2);
      assert.ok(s0.queue.length >= 4);
      const fix = key(s0.queue[3]!.edits);
      const first = key(s0.queue[0]!.edits);
      const s = scripted(l, ctx, files, MEAN_REQ, (e) => (key(e) === fix ? "pass" : key(e) === first ? 3 : 2));
      assert.ok(s.passed, `the standalone fix was never proposed (${s.proposals.length} proposals)`);
      const at = s.proposals.findIndex((p) => key(p) === fix);
      assert.ok(at > s.queue.length - 1, `the standalone form came at ${at + 1}, before the queue was used up`);
      assert.equal(new Set(s.proposals.map(key)).size, s.proposals.length, "a proposal repeated");
    },
  },
  {
    id: "rebuild near miss (m179-guard:rb-deferred): an M178 rebuild after an anchor does not bring a deferred candidate back (no proposal repeats)",
    run(l, ctx) {
      // alpha's first candidate is the anchor; alpha's other edits are live, beta's and gamma's inert (on their own)
      const cmp = (f: string, k: number) => `export function ${f}(a: number, b: number): boolean {\n${Array.from({ length: k }, (_, i) => `  if (a < b + ${i + 2}) return a > ${i + 3};\n`).join("")}  return false;\n}\n`;
      const alpha = `export function alpha(a: number, b: number): number {\n  if (a < b) return 0;\n  return ${Array.from({ length: 6 }, (_, i) => `a * ${i + 2}`).join(" + ")};\n}\n`;
      const text = alpha + cmp("beta", 6) + cmp("gamma", 6);
      const files = { "src/k.ts": text };
      const request = "`alpha`, `beta` and `gamma` disagree.";
      const s0 = scripted(l, ctx, files, request, () => 2);
      const first = key(s0.queue[0]!.edits);
      const alphaEnd = text.indexOf("export function beta");
      // the first changed offset of a proposal, on the original text
      const firstChange = (e: readonly Prop.RepairEdit[]): number => { const t = e[0]!.content; let i = 0; while (i < t.length && t[i] === text[i]) i++; return i; };
      const s = scripted(l, ctx, files, request, (e) => {
        if (key(e) === first) return 3;
        const t = e[0]!.content;
        if (t.includes("if (a <= b) return 0;")) return 2; // on the anchor: no further gain
        return firstChange(e) < alphaEnd ? 1 : 2;
      });
      assert.ok(s.proposals.length > s.queue.length + 5, `${s.proposals.length} proposals`);
      assert.equal(new Set(s.proposals.map(key)).size, s.proposals.length, "a proposal repeated");
    },
  },
  // ---- end to end (candidate uid): the real loop with repair-v2 fixes fixture A within the attempt budget; every
  // attempt went through the M175 gate, and the PASS row records editScope in-body
  {
    id: "loop e2e: repair-v2 anchors on area's fix and composes fits' comparison on it; the row is a valid PASS with editScope in-body",
    needsCand: true,
    run() {
      // batch 24: the fits tests use a 1 by 0.5 rectangle, so area's fix breaks no test that passed before and is a clean
      // anchor whether or not the run's failing names are known (with a 2 by 3 rectangle "fits at the limit" passed by
      // accident at the baseline and area's fix broke it, which m179-guard:an-names catches once names are known)
      const m151 = setup151();
      const scratch = mkdtempSync(join(tmpdir(), "peaceai-m179-e2e-"));
      try {
        const ctx = { m151, scratch };
        const test = 'import assert from "node:assert/strict";\nimport { Rect } from "../src/rect.ts";\n\ntest("area small", () => assert.equal(new Rect(2, 3).area(), 6));\ntest("area large", () => assert.equal(new Rect(4, 5).area(), 20));\ntest("fits at the limit", () => assert.equal(new Rect(1, 0.5).fits(0.5), true));\ntest("does not fit", () => assert.equal(new Rect(1, 0.5).fits(0.4), false));\n';
        const task = { ...e2eTask(ctx, `m179-rect-${Date.now() % 100000}`, RECTS, test), request: RECT_REQ };
        const r = loop.runLoopTask(task as never, "public", "a".repeat(64), { ...opts174(ctx, repairProposer({ v2: true }) as unknown as Loop.Proposer, MAX_ATTEMPTS), env: { ...m151.env, [STAGE2_CAND_ENV]: M179_CAND } } as never);
        assert.equal(loopRowProblem(r.row), null, `row valid (${loopRowProblem(r.row)})`);
        if (!m179Cand()) { assert.match(r.row.code, /^CAND_UID_/); return; }
        assert.equal(r.row.code, "PASS", `codes ${JSON.stringify(r.row.attemptCodes)}`);
        assert.equal((r.row as LoopRow).editScope, "in-body");
        assert.ok(r.row.attempts! >= 3 && r.row.attempts! <= MAX_ATTEMPTS, `attempts ${r.row.attempts}`);
      } finally { teardown151(m151); rmSync(scratch, { recursive: true, force: true }); }
    },
  },
];
