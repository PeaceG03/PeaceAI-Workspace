// M178 behavior cases (batch 17) for repair-v2's inert-site demotion (peaceai/lib/editpropose.ts siteEvidence,
// siteDemotions and the rebuild in repairProposer.next). As data so m178-mutation.test.ts can replay the pure cases
// against each mutant. Each case throws (node:assert) on failure. The demotion is admitted on two unrelated code shapes
// (a method many files define where the tests exercise one; a module whose request names three functions and whose
// tests exercise one), every m178 guard has a refused near miss, and every proposal of the admits is checked against
// the loop's M175 gate (in-body). Fixtures are tiny synthetic repos written for these tests from general shapes (a
// pipe, a wall, a sheet, a cart): none is modeled on a dev-split task's code or on a reference diff, and none is a
// PeaceSTOCKS shape. The "tests" are an in-process oracle; the end-to-end case (needsCand) runs the real loop and needs
// M178_CAND (no fallback user). Spec: peaceai/spec/repair-v2-m178.md.
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

// M178 runs ONLY as the candidate uid named by M178_CAND (peaceai-cand3 on the box); with none set it asserts the
// fail-closed CAND_UID_* refusal. It never falls back to another batch's candidate user.
const M178_CAND = process.env.M178_CAND ?? "";
export const m178Cand = (): boolean => stage2CandUid({ [STAGE2_CAND_ENV]: M178_CAND }).ok;

export interface Libs { prop: typeof Prop }
export interface Ctx { base: string }
export interface Case { id: string; needsCand?: boolean; run: (l: Libs, ctx: Ctx) => void }

export function setup(): Ctx { return { base: mkdtempSync(join(tmpdir(), "peaceai-m178-")) }; }
export function teardown(ctx: Ctx): void { rmSync(ctx.base, { recursive: true, force: true }); }

let n = 0;
function repoDir(ctx: Ctx, files: Record<string, string>): string {
  const d = join(ctx.base, `r${n++}`);
  for (const [p, c] of Object.entries(files)) { mkdirSync(dirname(join(d, p)), { recursive: true }); writeFileSync(join(d, p), c); }
  return d;
}
const tsFiles = (d: string, files: Record<string, string>) => Object.keys(files).filter((p) => /\.tsx?$/.test(p)).sort().map((p) => ({ path: p, content: readFileSync(join(d, p), "utf8") }));
function load(m: ReadonlyMap<string, string>, path: string): Record<string, unknown> {
  const js = ts.transpileModule(m.get(path)!, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const mod = { exports: {} as Record<string, unknown> };
  vm.runInNewContext(js, { module: mod, exports: mod.exports, Math }, { timeout: 1000 });
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
interface Sim { proposals: Prop.RepairEdit[][]; result: "pass" | "NO_EDIT" | "NO_MORE_EDITS" | "limit"; attempts: number; orig: Map<string, string>; queue: Prop.Candidate[] }
const MAX_ATTEMPTS = loop.MAX_ATTEMPTS;
/** The loop's attempt protocol in process: the oracle's count is the feedback (failing names empty, as for vitest / jest). */
function simulate(l: Libs, ctx: Ctx, files: Record<string, string>, request: string, path: string, checks: readonly Check[], v2 = true, max = MAX_ATTEMPTS): Sim {
  const d = repoDir(ctx, files);
  const test = oracle(path, checks);
  const total = checks.length;
  const p = l.prop.repairProposer({ v2 });
  p.prepare(openRepo(d), { request, failing: [] });
  const fs = tsFiles(d, files);
  const orig = new Map(fs.map((f) => [f.path, f.content]));
  const basePass = test(orig);
  assert.ok(basePass < total, "the fixture is not broken");
  const sites = l.prop.locate(openRepo(d), { request, failing: [] }, v2 ? l.prop.CALLEE_DEPTH.v2 : l.prop.CALLEE_DEPTH.v1);
  const queue = l.prop.repairCandidates(sites, orig, new Set(), v2);
  const baseline = { total, passing: basePass, failing: total - basePass };
  const feedback: Prop.RepairFeedback[] = [];
  const proposals: Prop.RepairEdit[][] = [];
  for (let attempt = 1; attempt <= max; attempt++) {
    const r = p.next({ files: fs, attempt, feedback, baseline });
    if ("refuse" in r) return { proposals, result: r.refuse, attempts: attempt - 1, orig, queue };
    proposals.push(r.edits);
    const m = new Map(orig);
    for (const e of r.edits) m.set(e.path, e.content);
    const pass = test(m);
    if (pass === total) return { proposals, result: "pass", attempts: attempt, orig, queue };
    feedback.push({ attempt, codes: ["TEST_FAIL"], failing: [], tests: { total, passedByPeaceAI: pass } });
  }
  return { proposals, result: "limit", attempts: max, orig, queue };
}
const key = (e: readonly Prop.RepairEdit[]) => JSON.stringify(e);
/** The M175 gate on a candidate: the class the loop would give it before any run. */
function gate(orig: ReadonlyMap<string, string>, edits: readonly Prop.RepairEdit[]): string {
  const read = (p: string) => orig.get(p) ?? null;
  return loop.editScopeProblem(edits, read, () => false) ?? loop.editScopeOf(edits, read) ?? "none";
}
/** A synthetic tried candidate at the given site numbers (for the pure evidence functions). */
const cand = (k: string, ...sites: number[]): Prop.Candidate => ({ key: k, edits: [], muts: sites.map((site) => ({ path: "src/x.ts", start: site, end: site, text: "", template: "comparison", site })) });
const fb = (attempt: number, passedByPeaceAI: number, codes: string[] = ["TEST_FAIL"], failing: string[] = [], total = 4): Prop.RepairFeedback => ({ attempt, codes, failing, tests: { total, passedByPeaceAI } });
const BASE = { total: 4, passing: 2, failing: 2 };

// ---- fixtures (synthetic, general shapes)
// A: a method many files define (`thickness`); the tests exercise the pipe's only; the fix swaps two operands
const PIPE = "export class Pipe {\n  outer: number;\n  inner: number;\n  constructor(outer: number, inner: number) {\n    this.outer = outer;\n    this.inner = inner;\n  }\n  thickness(): number {\n    if (this.outer < 0 || this.inner < 0) return 0;\n    return this.inner - this.outer;\n  }\n}\n";
const WALL = "export class Wall {\n  layers: number[];\n  constructor(layers: number[]) {\n    this.layers = layers;\n  }\n  thickness(): number {\n    let t = 0;\n    for (let i = 0; i < this.layers.length; i++) if (this.layers[i]! > 0) t += this.layers[i]! * 1;\n    return t > 100 ? 100 : t;\n  }\n}\n";
const SHEET = "export class Sheet {\n  plies: number;\n  ply: number;\n  constructor(plies: number, ply: number) {\n    this.plies = plies;\n    this.ply = ply;\n  }\n  thickness(): number {\n    if (this.plies <= 1) return this.ply;\n    return this.plies * this.ply + (this.plies - 1) * 0.5;\n  }\n}\n";
const PIPES = { "src/pipe.ts": PIPE, "src/wall.ts": WALL, "src/sheet.ts": SHEET };
const PIPE_REQ = "`thickness` is negative.";
const PIPE_CHECKS: Check[] = [(x) => new x.Pipe(10, 8).thickness() === 2, (x) => new x.Pipe(5, 5).thickness() === 0, (x) => new x.Pipe(-1, 2).thickness() === 0, (x) => new x.Pipe(7, 3).thickness() === 4];
// B: a module whose request names three functions; the tests exercise addItem only; the fix swaps two statements
const CART = "const TAX = 0.2;\nconst FREE_OVER = 50;\ntype Line = { price: number; qty: number };\nexport function shipping(total: number, express: boolean): number {\n  if (total >= FREE_OVER && !express) return 0;\n  return express ? 15 : 5;\n}\nfunction byPrice(a: Line, b: Line): number {\n  return a.price - b.price;\n}\nexport function addItem(items: Line[], item: Line): Line[] {\n  const next = items.slice();\n  if (item.qty < 1) return next;\n  next.sort(byPrice);\n  next.push(item);\n  return next;\n}\nexport function withTax(total: number): number {\n  return Math.round(total * (1 + TAX) * 100) / 100;\n}\n";
const CARTS = { "src/cart.ts": CART };
const CART_REQ = "`addItem` leaves the list out of price order; `shipping` and `withTax` look right.";
const prices = (l: { price: number }[]) => l.map((x) => x.price).join(",");
const CART_CHECKS: Check[] = [(x) => prices(x.addItem([{ price: 5, qty: 1 }], { price: 2, qty: 1 })) === "2,5", (x) => x.addItem([], { price: 2, qty: 0 }).length === 0, (x) => x.addItem([], { price: 2, qty: 1 }).length === 1, (x) => prices(x.addItem([{ price: 1, qty: 1 }], { price: 3, qty: 1 })) === "1,3"];
// C: everything inert (the checks call nothing the request locates): no site is ever live, nothing moves
const NOISE: Check[] = [() => true, () => true, () => false];

/** An admit: the fixed candidate order would not reach the fix within the attempt budget; with M178 it does. */
const admit = (id: string, files: Record<string, string>, request: string, path: string, checks: Check[], template: string, want: RegExp): Case => ({
  id, run(l, ctx) {
    const s = simulate(l, ctx, files, request, path, checks);
    assert.equal(s.result, "pass", `${s.result} after ${s.attempts}`);
    assert.match(s.proposals.at(-1)![0]!.content, want);
    const last = s.proposals.at(-1)!;
    const at = s.queue.findIndex((c) => key(c.edits) === key(last));
    assert.ok(at === -1 || at >= MAX_ATTEMPTS, `the fixed order reaches the fix at ${at + 1}: no demotion needed`);
    // the fix is the named template's, nothing new is written (a full list over the same sites has it)
    const d = repoDir(ctx, files);
    const sites = l.prop.locate(openRepo(d), { request, failing: [] }, l.prop.CALLEE_DEPTH.v2);
    const all: Prop.Candidate[] = [];
    sites.forEach((_, i) => all.push(...l.prop.repairCandidates(sites, s.orig, new Set(), true, new Set(sites.map((_, j) => j).filter((j) => j !== i)))));
    const w = all.find((c) => key(c.edits) === key(last));
    assert.ok(w, "the passing edit is a candidate of one located site");
    assert.deepEqual(w.muts.map((m) => m.template), [template]);
    // no proposal repeats, and every proposal is in-body under the M175 gate
    assert.equal(new Set(s.proposals.map(key)).size, s.proposals.length, "a proposal repeated");
    for (const p of s.proposals) assert.equal(gate(s.orig, p), "in-body");
  },
});

export const CASES: Case[] = [
  // ---- admits: two unrelated shapes, each fixed within the attempt budget only because inert sites were demoted
  admit("admit (one method name in three files, the tests exercise one): the wall's and sheet's `thickness` go behind; the pipe's operands are swapped", PIPES, PIPE_REQ, "src/pipe.ts", PIPE_CHECKS, "swap-operands", /return this\.outer - this\.inner;/),
  admit("admit (request names three functions, the tests exercise one; module constants located): shipping, withTax and the constants go behind; addItem's two statements are swapped", CARTS, CART_REQ, "src/cart.ts", CART_CHECKS, "swap-statements", /next\.push\(item\);\n {2}next\.sort\(byPrice\);/),
  {
    id: "no evidence, no change: when no site is ever live the proposals are the fixed order exactly (box behavior of the existing order)",
    run(l, ctx) {
      const s = simulate(l, ctx, CARTS, CART_REQ, "src/cart.ts", NOISE, true, MAX_ATTEMPTS);
      assert.equal(s.result, "limit");
      assert.deepEqual(s.proposals.map(key), s.queue.slice(0, MAX_ATTEMPTS).map((c) => key(c.edits)));
    },
  },
  {
    id: "order: before the first demotion the proposals are the fixed order; after it no demoted site's candidate precedes a kept one",
    run(l, ctx) {
      const s = simulate(l, ctx, PIPES, PIPE_REQ, "src/pipe.ts", PIPE_CHECKS);
      const ix = s.proposals.map((p) => s.queue.findIndex((c) => key(c.edits) === key(p)));
      const firstOff = ix.findIndex((v, i) => v !== i);
      assert.ok(firstOff > 0, "the demotion fired");
      assert.deepEqual(ix.slice(0, firstOff), [...Array(firstOff).keys()]);
      const siteOf = (p: Prop.RepairEdit[]) => p[0]!.path;
      assert.ok(s.proposals.slice(firstOff).every((p) => siteOf(p) === "src/pipe.ts"), "a demoted file's candidate came back first");
    },
  },
  // ---- evidence (pure)
  {
    id: "evidence: a clean result with the baseline's counts and names is inert; other counts are live",
    run(l) {
      assert.equal(l.prop.siteEvidence(fb(1, 2), BASE, []), "inert");
      assert.equal(l.prop.siteEvidence(fb(1, 1), BASE, []), "live");
      assert.equal(l.prop.siteEvidence(fb(1, 3), BASE, []), "live");
      assert.equal(l.prop.INERT_AFTER, 2);
    },
  },
  { id: "evidence near miss (m178-guard:ev-baseline): no baseline proves nothing", run(l) { assert.equal(l.prop.siteEvidence(fb(1, 3), null, []), null); assert.equal(l.prop.siteEvidence(fb(1, 3), undefined, []), null); } },
  { id: "evidence near miss (m178-guard:ev-tests): a result without counts proves nothing", run(l) { assert.equal(l.prop.siteEvidence({ attempt: 1, codes: ["TEST_FAIL"], failing: [], tests: null }, BASE, []), null); assert.equal(l.prop.siteEvidence(undefined, BASE, []), null); } },
  {
    id: "evidence near miss (m178-guard:ev-clean): a timeout, a load failure or leftovers prove nothing, even with other counts",
    run(l) {
      for (const c of [["TEST_FAIL", "TIMEOUT"], ["SUITE_LOAD", "TEST_FAIL"], ["LEFTOVERS"]]) assert.equal(l.prop.siteEvidence(fb(1, 0, c), BASE, []), null, c.join(","));
    },
  },
  { id: "evidence near miss (m178-guard:ev-counts): another total is live, though the passing count matches", run(l) { assert.equal(l.prop.siteEvidence(fb(1, 2, ["TEST_FAIL"], [], 5), BASE, []), "live"); assert.equal(l.prop.siteEvidence(fb(1, 1), BASE, []), "live"); } },
  {
    id: "evidence near miss (m178-guard:ev-names): the same counts with other failing test names are live (one test was broken, another fixed); the same names in another order are inert",
    run(l) {
      assert.equal(l.prop.siteEvidence(fb(1, 2, ["TEST_FAIL"], ["a", "c"]), BASE, ["a", "b"]), "live");
      assert.equal(l.prop.siteEvidence(fb(1, 2, ["TEST_FAIL"], ["b", "a"]), BASE, ["a", "b"]), "inert");
    },
  },
  // ---- demotion (pure)
  {
    id: "demotion: a site with two inert results and no live one is demoted while another site is live",
    run(l) {
      const tried = [cand("a", 1), cand("b", 0), cand("c", 1)];
      assert.deepEqual(l.prop.siteDemotions(tried, [fb(1, 2), fb(2, 1), fb(3, 2)], BASE, [], new Set()), [1]);
    },
  },
  { id: "demotion near miss (m178-guard:dm-threshold): one inert result is not enough", run(l) { assert.deepEqual(l.prop.siteDemotions([cand("a", 1), cand("b", 0)], [fb(1, 2), fb(2, 1)], BASE, [], new Set()), []); } },
  { id: "demotion near miss (m178-guard:dm-no-live): a site with a live result stays, however many inert ones it has", run(l) { assert.deepEqual(l.prop.siteDemotions([cand("a", 1), cand("b", 1), cand("c", 1), cand("d", 0)], [fb(1, 2), fb(2, 2), fb(3, 3), fb(4, 1)], BASE, [], new Set()), []); } },
  { id: "demotion near miss (m178-guard:dm-live-elsewhere): when no site is live nothing is demoted", run(l) { assert.deepEqual(l.prop.siteDemotions([cand("a", 1), cand("b", 1), cand("c", 2), cand("d", 2)], [fb(1, 2), fb(2, 2), fb(3, 2), fb(4, 2)], BASE, [], new Set()), []); } },
  { id: "demotion near miss (m178-guard:dm-once): a site demoted already is not returned again", run(l) { assert.deepEqual(l.prop.siteDemotions([cand("a", 1), cand("b", 0), cand("c", 1), cand("d", 2), cand("e", 2)], [fb(1, 2), fb(2, 1), fb(3, 2), fb(4, 2), fb(5, 2)], BASE, [], new Set([1])), [2]); } },
  {
    id: "demotion near miss (m178-guard:ev-single): a combined candidate's result counts for no site (here it would make site 1 live)",
    run(l) {
      const tried = [cand("a", 1), cand("b", 0), cand("c", 1), cand("ab", 0, 1)];
      assert.deepEqual(l.prop.siteDemotions(tried, [fb(1, 2), fb(2, 1), fb(3, 2), fb(4, 3)], BASE, [], new Set()), [1]);
    },
  },
  {
    id: "near miss (m178-guard:dm-v2-only): repair-v1 (and so model-v1) keeps the fixed order on the same evidence",
    run(l, ctx) {
      const s = simulate(l, ctx, PIPES, PIPE_REQ, "src/pipe.ts", PIPE_CHECKS, false);
      assert.deepEqual(s.proposals.map(key), s.queue.slice(0, s.proposals.length).map((c) => key(c.edits)));
      // the same evidence would demote: the pure function says so
      const v2 = simulate(l, ctx, PIPES, PIPE_REQ, "src/pipe.ts", PIPE_CHECKS);
      assert.equal(v2.result, "pass");
    },
  },
  {
    id: "rebuild near misses (m178-guard:rb-skip / rb-tried / rb-cap): after each demotion the demoted sites' candidates go behind, no tried candidate comes again, and the rest of the run is at most MAX_CANDIDATES proposals",
    run(l, ctx) {
      // alpha (exercised by the scripted tests: every edit there is live) has one comparison and many arithmetic
      // operators; beta and gamma (never exercised: inert) have many comparisons, so they fill the fixed queue first
      const cmp = (f: string, k: number) => `export function ${f}(a: number, b: number): boolean {\n${Array.from({ length: k }, (_, i) => `  if (a < b + ${i + 2}) return a > ${i + 3};\n`).join("")}  return false;\n}\n`;
      const alpha = `export function alpha(a: number, b: number): number {\n  if (a < b) return 0;\n  return ${Array.from({ length: 40 }, (_, i) => `a * ${i + 2}`).join(" + ")};\n}\n`;
      const text = alpha + cmp("beta", 12) + cmp("gamma", 12);
      const files = { "src/k.ts": text };
      const d = repoDir(ctx, files);
      const request = "`alpha`, `beta` and `gamma` disagree.";
      const p = l.prop.repairProposer({ v2: true });
      p.prepare(openRepo(d), { request, failing: [] });
      const fs = tsFiles(d, files);
      const orig = new Map(fs.map((f) => [f.path, f.content]));
      const sites = l.prop.locate(openRepo(d), { request, failing: [] }, l.prop.CALLEE_DEPTH.v2);
      assert.deepEqual(sites.map((x) => x.name), ["alpha", "beta", "gamma"]);
      // the site of a proposal: the located site holding its first changed offset
      const siteOf = (e: readonly Prop.RepairEdit[]): number => { const t = e[0]!.content; let i = 0; while (i < t.length && t[i] === text[i]) i++; return sites.findIndex((x) => i >= x.start && i < x.end); };
      const feedback: Prop.RepairFeedback[] = [];
      const tried: Prop.Candidate[] = [];
      const demoted = new Set<number>();
      let lastDemotion = 0;
      for (let attempt = 1; attempt <= 500; attempt++) {
        const now = l.prop.siteDemotions(tried, feedback, BASE, [], demoted);
        for (const x of now) demoted.add(x);
        if (now.length) lastDemotion = attempt;
        const r = p.next({ files: fs, attempt, feedback, baseline: BASE });
        if ("refuse" in r) break;
        const at = siteOf(r.edits);
        assert.ok(at >= 0, "a proposal is inside one located site");
        const c = cand(key(r.edits), at);
        assert.ok(!tried.some((t) => t.key === c.key), `attempt ${attempt}: a tried candidate was proposed again`);
        // m178-guard:rb-skip: right after a demotion, no demoted site's candidate is proposed while a kept site has one
        if (attempt === lastDemotion) assert.ok(!demoted.has(c.muts[0]!.site), `attempt ${attempt}: a demoted site's candidate first`);
        tried.push(c);
        feedback.push(fb(attempt, c.muts[0]!.site === 0 ? 1 : 2));
      }
      assert.ok(lastDemotion > 0 && demoted.has(1) && demoted.has(2), `demoted ${[...demoted]}`);
      assert.ok(tried.length - (lastDemotion - 1) <= l.prop.MAX_CANDIDATES, `${tried.length - (lastDemotion - 1)} proposals after the last demotion (cap ${l.prop.MAX_CANDIDATES})`);
    },
  },
  // ---- end to end (candidate uid): the real loop with repair-v2 fixes fixture A within the attempt budget; every
  // attempt went through the M175 gate, and the PASS row records editScope in-body
  {
    id: "loop e2e: repair-v2 demotes the inert `thickness` sites and swaps the pipe's operands; the row is a valid PASS with editScope in-body",
    needsCand: true,
    run() {
      const m151 = setup151();
      const scratch = mkdtempSync(join(tmpdir(), "peaceai-m178-e2e-"));
      try {
        const ctx = { m151, scratch };
        const test = 'import assert from "node:assert/strict";\nimport { Pipe } from "../src/pipe.ts";\n\ntest("wall", () => assert.equal(new Pipe(10, 8).thickness(), 2));\ntest("equal", () => assert.equal(new Pipe(5, 5).thickness(), 0));\ntest("negative", () => assert.equal(new Pipe(-1, 2).thickness(), 0));\ntest("thick", () => assert.equal(new Pipe(7, 3).thickness(), 4));\n';
        const task = { ...e2eTask(ctx, `m178-pipe-${Date.now() % 100000}`, PIPES, test), request: PIPE_REQ };
        const r = loop.runLoopTask(task as never, "public", "a".repeat(64), { ...opts174(ctx, repairProposer({ v2: true }) as unknown as Loop.Proposer, MAX_ATTEMPTS), env: { ...m151.env, [STAGE2_CAND_ENV]: M178_CAND } } as never);
        assert.equal(loopRowProblem(r.row), null, `row valid (${loopRowProblem(r.row)})`);
        if (!m178Cand()) { assert.match(r.row.code, /^CAND_UID_/); return; }
        assert.equal(r.row.code, "PASS", `codes ${JSON.stringify(r.row.attemptCodes)}`);
        assert.equal((r.row as LoopRow).editScope, "in-body");
        assert.ok(r.row.attempts! <= MAX_ATTEMPTS);
      } finally { teardown151(m151); rmSync(scratch, { recursive: true, force: true }); }
    },
  },
];
