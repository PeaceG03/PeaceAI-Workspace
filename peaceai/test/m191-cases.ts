// M191 (batch 24) behavior cases for repair-v2's fail-to-pass promotion (peaceai/lib/editpropose.ts fixEvidence,
// fixSites and the promotion in repairProposer.next). As data so m191-mutation.test.ts can replay them against each
// mutant. Each case throws (node:assert) on failure. The promotion is admitted on two unrelated code shapes run against
// an in-process oracle with per-test names (a late-fee module, a thermostat module) and on a scripted many-candidate
// module; every m191 guard has a refused near miss. Fixtures are tiny synthetic repos written for these tests from
// general shapes: none is modelled on a practice task's code or on a reference diff, and none is a PeaceSTOCKS shape.
// Spec: peaceai/spec/repair-v2-m191.md.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import vm from "node:vm";
import ts from "typescript";
import { openRepo } from "../lib/codesearch.ts";
import type * as Prop from "../lib/editpropose.ts";

export interface Libs { prop: typeof Prop }
export interface Ctx { base: string }
export interface Case { id: string; run: (l: Libs, ctx: Ctx) => void }

export function setup(): Ctx { return { base: mkdtempSync(join(tmpdir(), "peaceai-m191-")) }; }
export function teardown(ctx: Ctx): void { rmSync(ctx.base, { recursive: true, force: true }); }

let n = 0;
function repoDir(ctx: Ctx, files: Record<string, string>): string {
  const d = join(ctx.base, `r${n++}`);
  for (const [p, c] of Object.entries(files)) { mkdirSync(dirname(join(d, p)), { recursive: true }); writeFileSync(join(d, p), c); }
  return d;
}
const tsFiles = (d: string, files: Record<string, string>) => Object.keys(files).filter((p) => /\.tsx?$/.test(p)).sort().map((p) => ({ path: p, content: readFileSync(join(d, p), "utf8") }));
function load(src: string): Record<string, any> {
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const mod = { exports: {} as Record<string, any> };
  vm.runInNewContext(js, { module: mod, exports: mod.exports }, { timeout: 1000 });
  return mod.exports;
}
type Check = readonly [string, (x: Record<string, any>) => boolean];
/** The failing tests' names (a module that does not load fails every test). */
const failingOf = (src: string, checks: readonly Check[]): string[] => {
  let x: Record<string, any>;
  try { x = load(src); } catch { return checks.map((c) => c[0]); }
  return checks.filter(([, f]) => { try { return !f(x); } catch { return true; } }).map(([name]) => name);
};
interface Step { attempt: number; site: number; failing: string[] }
interface Sim { steps: Step[]; result: "pass" | "NO_EDIT" | "NO_MORE_EDITS" | "limit" }
/** The loop's protocol in process, with per-test names (as node:test, or vitest / jest after M190) when `names`;
 *  without, names are [] on both sides (as vitest / jest before M190). */
function simulate(l: Libs, ctx: Ctx, path: string, src: string, request: string, checks: readonly Check[], o: { names: boolean; v2?: boolean; order?: boolean; max?: number }): Sim {
  const d = repoDir(ctx, { [path]: src });
  const sites = l.prop.locate(openRepo(d), { request, failing: [] }, (o.v2 ?? true) ? l.prop.CALLEE_DEPTH.v2 : l.prop.CALLEE_DEPTH.v1);
  const baseFailing = failingOf(src, checks);
  assert.ok(baseFailing.length > 0, "the fixture is not broken");
  const total = checks.length;
  const baseline = { total, passing: total - baseFailing.length, failing: baseFailing.length };
  const p = l.prop.repairProposer({ v2: o.v2 ?? true, ...(o.order ? { order: (q: readonly Prop.Candidate[]) => [...q] } : {}) });
  p.prepare(openRepo(d), { request, failing: [], baseFailing: o.names ? baseFailing : [] });
  const files = [{ path, content: src }];
  const siteOf = (t: string): number => { let i = 0; while (i < t.length && t[i] === src[i]) i++; return sites.findIndex((x) => i >= x.start && i < x.end); };
  const feedback: Prop.RepairFeedback[] = [];
  const steps: Step[] = [];
  for (let attempt = 1; attempt <= (o.max ?? 20); attempt++) {
    const r = p.next({ files, attempt, feedback, baseline });
    if ("refuse" in r) return { steps, result: r.refuse };
    const t = r.edits[0]!.content;
    const failing = failingOf(t, checks);
    steps.push({ attempt, site: siteOf(t), failing });
    if (failing.length === 0) return { steps, result: "pass" };
    feedback.push({ attempt, codes: ["TEST_FAIL"], failing: o.names ? failing : [], tests: { total, passedByPeaceAI: total - failing.length } });
  }
  return { steps, result: "limit" };
}
/** The first attempt whose result made a baseline-failing test pass, and its site. */
function firstFlip(s: Sim, baseFailing: readonly string[]): Step | undefined { return s.steps.find((x) => baseFailing.some((b) => !x.failing.includes(b))); }

// ---- shape A: a late-fee module (four functions, the fee last; the request names the fee, the other three are its helpers)
const FEE_PATH = "src/fees.ts";
const FEE_SRC = [
  "export function graceDays(plan: string): number {\n  return plan === \"gold\" ? 10 : 5;\n}",
  "export function isOverdue(days: number, grace: number): boolean {\n  return days > grace;\n}",
  "export function capFee(fee: number, cap: number): number {\n  return fee > cap ? cap : fee;\n}",
  "export function lateFee(days: number, waived: boolean): number {\n  if (days > 30 && waived) return days * 2;\n  return 0;\n}",
].join("\n") + "\n";
const FEE_REQ = "Fix lateFee in src/fees.ts (it uses graceDays, isOverdue and capFee).";
const FEE_CHECKS: readonly Check[] = [
  ["fee when not waived", (x) => x.lateFee(40, false) === 80], ["no fee when waived", (x) => x.lateFee(40, true) === 0],
  ["no fee early", (x) => x.lateFee(10, false) === 0], ["no fee early waived", (x) => x.lateFee(10, true) === 0],
  ["gold grace", (x) => x.graceDays("gold") === 10], ["basic grace", (x) => x.graceDays("basic") === 5],
  ["overdue", (x) => x.isOverdue(6, 5)], ["not overdue", (x) => !x.isOverdue(5, 5)], ["capped", (x) => x.capFee(50, 30) === 30], ["uncapped", (x) => x.capFee(20, 30) === 20],
];
// ---- shape B: a thermostat module (a boolean rule and three helpers)
const HEAT_PATH = "src/heat.ts";
const HEAT_SRC = [
  "export function heaterOn(temp: number, away: boolean): boolean {\n  return temp < 18 && away;\n}",
  "export function setPoint(mode: string): number {\n  return mode === \"eco\" ? 16 : 20;\n}",
  "export function clamp(t: number, lo: number, hi: number): number {\n  return t < lo ? lo : t > hi ? hi : t;\n}",
  "export function isCold(temp: number, target: number): boolean {\n  return temp < target - 1;\n}",
].join("\n") + "\n";
const HEAT_REQ = "Fix heaterOn in src/heat.ts; setPoint, clamp and isCold are its helpers.";
const HEAT_CHECKS: readonly Check[] = [
  ["heats when home", (x) => x.heaterOn(10, false) === true], ["off when away", (x) => x.heaterOn(10, true) === false],
  ["off when warm", (x) => x.heaterOn(25, false) === false], ["off when warm away", (x) => x.heaterOn(25, true) === false],
  ["eco", (x) => x.setPoint("eco") === 16], ["comfort", (x) => x.setPoint("x") === 20], ["clamp lo", (x) => x.clamp(1, 5, 9) === 5],
  ["clamp hi", (x) => x.clamp(12, 5, 9) === 9], ["clamp mid", (x) => x.clamp(7, 5, 9) === 7], ["cold", (x) => x.isCold(10, 20)], ["not cold", (x) => !x.isCold(19.5, 20)],
];
const SHAPES = [["late fee", FEE_PATH, FEE_SRC, FEE_REQ, FEE_CHECKS], ["thermostat", HEAT_PATH, HEAT_SRC, HEAT_REQ, HEAT_CHECKS]] as const;

// ---- scripted: a module with many candidates (so the queue cap binds); the feedback is scripted per site
const cmp = (f: string, k: number) => `export function ${f}(a: number, b: number): boolean {\n${Array.from({ length: k }, (_, i) => `  if (a < b + ${i + 2}) return a > ${i + 3};\n`).join("")}  return false;\n}\n`;
const SCRIPT_TEXT = `export function alpha(a: number, b: number): number {\n  if (a < b) return 0;\n  return ${Array.from({ length: 40 }, (_, i) => `a * ${i + 2}`).join(" + ")};\n}\n` + cmp("beta", 12) + cmp("gamma", 12);
const SCRIPT_REQ = "`alpha`, `beta` and `gamma` disagree.";
const SBASE = { total: 5, passing: 3, failing: 2 };
const SNAMES = ["joins rows", "keeps order"];
type Fb = (attempt: number, site: number, nth: number) => Prop.RepairFeedback;
/** Every edit breaks one more test (live, no flip) ... */
const live: Fb = (attempt) => ({ attempt, codes: ["TEST_FAIL"], failing: [...SNAMES, "splits rows"], tests: { total: 5, passedByPeaceAI: 2 } });
/** ... except the first edit at `site`, which makes "joins rows" pass and breaks "splits rows" (fail to pass). */
const flipAt = (site: number, over: Partial<Prop.RepairFeedback> = {}): Fb => (attempt, s, nth) =>
  s === site && nth === 0 ? { attempt, codes: ["TEST_FAIL"], failing: ["keeps order", "splits rows"], tests: { total: 5, passedByPeaceAI: 3 }, ...over } : live(attempt, s, nth);
interface Script { sites: number[]; keys: string[]; flipAttempt: number }
function scripted(l: Libs, ctx: Ctx, feedbackOf: Fb, o: { baseFailing?: string[]; v2?: boolean; order?: boolean; max?: number } = {}): Script {
  const files = { "src/k.ts": SCRIPT_TEXT };
  const d = repoDir(ctx, files);
  const sites = l.prop.locate(openRepo(d), { request: SCRIPT_REQ, failing: [] }, l.prop.CALLEE_DEPTH.v2);
  assert.deepEqual(sites.map((x) => x.name), ["alpha", "beta", "gamma"]);
  const p = l.prop.repairProposer({ v2: o.v2 ?? true, ...(o.order ? { order: (q: readonly Prop.Candidate[]) => [...q] } : {}) });
  p.prepare(openRepo(d), { request: SCRIPT_REQ, failing: [], baseFailing: o.baseFailing ?? SNAMES });
  const fs = tsFiles(d, files);
  const siteOf = (t: string): number => { let i = 0; while (i < t.length && t[i] === SCRIPT_TEXT[i]) i++; return sites.findIndex((x) => i >= x.start && i < x.end); };
  const feedback: Prop.RepairFeedback[] = [];
  const out: Script = { sites: [], keys: [], flipAttempt: 0 };
  const perSite = new Map<number, number>();
  for (let attempt = 1; attempt <= (o.max ?? 500); attempt++) {
    const r = p.next({ files: fs, attempt, feedback, baseline: SBASE });
    if ("refuse" in r) break;
    const s = siteOf(r.edits[0]!.content);
    const nth = perSite.get(s) ?? 0;
    perSite.set(s, nth + 1);
    out.sites.push(s);
    out.keys.push(JSON.stringify(r.edits));
    const f = feedbackOf(attempt, s, nth);
    if (!out.flipAttempt && f.failing.length === 2 && f.failing[0] === "keeps order") out.flipAttempt = attempt;
    feedback.push(f);
  }
  return out;
}
const cand = (k: string, ...sites: number[]): Prop.Candidate => ({ key: k, edits: [], muts: sites.map((site) => ({ path: "src/x.ts", start: site, end: site, text: "", template: "comparison", site })) });
const fb = (attempt: number, failing: string[], passed: number, codes: string[] = ["TEST_FAIL"], total = 5): Prop.RepairFeedback => ({ attempt, codes, failing, tests: { total, passedByPeaceAI: passed } });

export const CASES: readonly Case[] = [
  // ---- the pure rule
  {
    id: "fixEvidence: a baseline-failing test that passes now is evidence, even when another test broke (two name shapes)",
    run(l) {
      const e = l.prop.fixEvidence;
      assert.equal(e(fb(1, ["keeps order", "splits rows"], 3), SBASE, SNAMES), true, "one flipped, one broken");
      assert.equal(e(fb(1, ["keeps order"], 4), SBASE, SNAMES), true, "one flipped, nothing broken");
      // vitest / jest names after M190 (suite > test)
      assert.equal(e(fb(1, ["csv > quotes"], 2, ["TEST_FAIL"], 3), { total: 3, passing: 1, failing: 2 }, ["csv > quotes", "csv > tabs"]), true);
      assert.equal(e(fb(1, SNAMES, 3), SBASE, SNAMES), false, "the same failing tests: no flip");
      assert.equal(e(fb(1, [...SNAMES, "splits rows"], 2), SBASE, SNAMES), false, "only a break");
      // names counted as a multiset (two tests with one name)
      assert.equal(e(fb(1, ["dup", "dup"], 3), SBASE, ["dup", "dup"]), false);
      assert.equal(e(fb(1, ["dup", "other"], 3), SBASE, ["dup", "dup"]), true);
    },
  },
  {
    id: "fixEvidence near misses: another code, another total, unknown baseline names, unknown attempt names (m191-guard:fx-clean, fx-total, fx-base-known, fx-known)",
    run(l) {
      const e = l.prop.fixEvidence;
      const flip = ["keeps order", "splits rows"];
      assert.equal(e(fb(1, flip, 3, ["TEST_FAIL", "TIMEOUT"]), SBASE, SNAMES), false, "a timeout proves nothing");
      assert.equal(e(fb(1, flip, 3, ["SUITE_LOAD", "TEST_FAIL"]), SBASE, SNAMES), false, "made-up counts");
      assert.equal(e(fb(1, flip, 4, ["TEST_FAIL"], 6), SBASE, SNAMES), false, "another total");
      assert.equal(e({ attempt: 1, codes: ["TEST_FAIL"], failing: flip, tests: null }, SBASE, SNAMES), false, "no counts");
      assert.equal(e(fb(1, flip, 3), null, SNAMES), false, "no baseline");
      assert.equal(e(fb(1, flip, 3), SBASE, []), false, "baseline names unknown (vitest / jest without M190 names)");
      assert.equal(e(fb(1, flip, 3), SBASE, ["joins rows"]), false, "baseline names do not account for every baseline failure");
      assert.equal(e(fb(1, [], 3), SBASE, SNAMES), false, "attempt names unknown: [] is not 'everything passes'");
      assert.equal(e(fb(1, ["splits rows"], 3), SBASE, SNAMES), false, "fewer names than failures");
    },
  },
  {
    id: "fixSites: single-site results only, each site once (m191-guard:fs-single, fs-once)",
    run(l) {
      const tried = [cand("a", 0), cand("b", 1, 2), cand("c", 2)];
      const flip = fb(0, ["keeps order", "splits rows"], 3);
      const feedback = [{ ...flip, attempt: 1 }, { ...flip, attempt: 2 }, fb(3, [...SNAMES, "x"], 2)];
      assert.deepEqual(l.prop.fixSites(tried, feedback, SBASE, SNAMES, new Set()), [0], "the combined candidate (sites 1 and 2) says nothing");
      assert.deepEqual(l.prop.fixSites(tried, feedback, SBASE, SNAMES, new Set([0])), [], "already promoted");
      assert.deepEqual(l.prop.fixSites([cand("c", 2), cand("a", 0)], [{ ...flip, attempt: 1 }, { ...flip, attempt: 2 }], SBASE, SNAMES, new Set()), [0, 2], "sorted");
    },
  },
  // ---- the proposer on the two oracle shapes
  ...SHAPES.map(([name, path, src, req, checks]): Case => ({
    id: `promotion, ${name}: after an edit flips a failing test, the next edit is at the same site; without names the fixed order goes on`,
    run(l, ctx) {
      const base = failingOf(src, checks);
      const on = simulate(l, ctx, path, src, req, checks, { names: true });
      const off = simulate(l, ctx, path, src, req, checks, { names: false });
      const flip = firstFlip(on, base)!;
      assert.ok(flip, "some edit flips a failing test");
      assert.equal(firstFlip(off, base)?.attempt, flip.attempt, "the same edits up to the flip");
      assert.deepEqual(on.steps.slice(0, flip.attempt).map((s) => s.site), off.steps.slice(0, flip.attempt).map((s) => s.site));
      // names: the following edits stay at the flipped site; without: the fixed order moves to another site first
      const nextOn = on.steps.slice(flip.attempt, flip.attempt + 3).map((s) => s.site);
      assert.deepEqual(nextOn, [flip.site, flip.site, flip.site], `${name}: ${JSON.stringify(on.steps.map((s) => s.site))}`);
      const firstAway = (s: Sim) => s.steps.findIndex((x, i) => i >= flip.attempt && x.site !== flip.site);
      assert.ok(firstAway(off) >= 0 && (firstAway(on) < 0 || firstAway(on) > firstAway(off)), `${name}: names keep the flipped site longer`);
      // repair-v1 and a reranked list (model-v1) never promote
      for (const o of [{ v2: false }, { order: true }]) {
        const a = simulate(l, ctx, path, src, req, checks, { names: true, ...o }), b = simulate(l, ctx, path, src, req, checks, { names: false, ...o });
        assert.deepEqual(a.steps.map((s) => s.site), b.steps.map((s) => s.site), `${name} ${JSON.stringify(o)}: names change nothing`);
      }
    },
  })),
  // ---- the proposer, scripted
  {
    id: "promotion, scripted: the flipped site's candidates come next, no tried candidate comes again, the rest is at most MAX_CANDIDATES (m191-guard:pr-tried, pr-cap)",
    run(l, ctx) {
      const s = scripted(l, ctx, flipAt(2));
      assert.ok(s.flipAttempt > 0, "gamma was tried");
      assert.equal(new Set(s.keys).size, s.keys.length, "a tried candidate was proposed again");
      const after = s.sites.slice(s.flipAttempt);
      const gammaLeft = after.filter((x) => x === 2).length;
      assert.ok(gammaLeft >= 5, `gamma has candidates left (${gammaLeft})`);
      assert.deepEqual(after.slice(0, gammaLeft), Array(gammaLeft).fill(2), "every remaining gamma candidate first");
      assert.ok(after.length <= l.prop.MAX_CANDIDATES, `${after.length} proposals after the promotion (cap ${l.prop.MAX_CANDIDATES})`);
      // control: no flip, the fixed order (gamma's candidates stay behind the others)
      const c = scripted(l, ctx, live);
      const at = s.flipAttempt;
      assert.deepEqual(c.sites.slice(0, at), s.sites.slice(0, at), "the same edits up to the flip");
      assert.notDeepEqual(c.sites.slice(at, at + gammaLeft), Array(gammaLeft).fill(2), "without the flip gamma's candidates do not all come next");
    },
  },
  {
    id: "promotion near misses, scripted: a flip under another code, another total, unknown names, repair-v1 or a reranked list promotes nothing (m191-guard:v2-only)",
    run(l, ctx) {
      const plain = scripted(l, ctx, live);
      const same = (s: Script, why: string) => assert.deepEqual(s.sites, plain.sites, why);
      same(scripted(l, ctx, flipAt(2, { codes: ["TEST_FAIL", "TIMEOUT"] })), "another code");
      same(scripted(l, ctx, flipAt(2, { tests: { total: 6, passedByPeaceAI: 4 } })), "another total");
      same(scripted(l, ctx, flipAt(2), { baseFailing: [] }), "baseline names unknown");
      same(scripted(l, ctx, flipAt(2, { failing: [] })), "attempt names unknown");
      const v1 = scripted(l, ctx, live, { v2: false }), v1f = scripted(l, ctx, flipAt(2), { v2: false });
      assert.deepEqual(v1f.sites, v1.sites, "repair-v1");
      const ord = scripted(l, ctx, live, { order: true }), ordf = scripted(l, ctx, flipAt(2), { order: true });
      assert.deepEqual(ordf.sites, ord.sites, "a reranked list");
    },
  },
];
