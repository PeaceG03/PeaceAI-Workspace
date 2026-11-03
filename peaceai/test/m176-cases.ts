// M176 behavior cases (batch 15) for repair-v2's SStuB edit classes (peaceai/lib/editpropose.ts sstubMutationsIn:
// swap-statements, swap-args, swap-operands, change-identifier). As data so m176-mutation.test.ts can replay the pure
// cases against each mutant. Each case throws (node:assert) on failure. Every class is admitted on at least two
// unrelated code shapes, every m176 guard has a refused near miss, and every SStuB candidate on the admit fixtures is
// checked against the loop's M175 gate (in-body, nothing wider). Fixtures are tiny synthetic repos written for these
// tests from general simple-stupid-bug shapes (a meter, a record log, a clamp, an hours check, an elapsed time, an
// expiry check, an area, initials): none is modeled on a dev-split task's code or on a reference diff, and none is a
// PeaceSTOCKS shape. The "tests" are an in-process oracle (the edited module is transpiled and called), so the pure
// cases run anywhere; the end-to-end case (needsCand) runs the real loop and needs M176_CAND (no fallback user).
// Spec: peaceai/spec/repair-v2-m176.md.
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

// M176 runs ONLY as the candidate uid named by M176_CAND (peaceai-cand3 on the box); with none set it asserts the
// fail-closed CAND_UID_* refusal. It never falls back to another batch's candidate user.
const M176_CAND = process.env.M176_CAND ?? "";
export const m176Cand = (): boolean => stage2CandUid({ [STAGE2_CAND_ENV]: M176_CAND }).ok;

export interface Libs { prop: typeof Prop }
export interface Ctx { base: string }
export interface Case { id: string; needsCand?: boolean; run: (l: Libs, ctx: Ctx) => void }

export function setup(): Ctx { return { base: mkdtempSync(join(tmpdir(), "peaceai-m176-")) }; }
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
interface Sim { proposals: Prop.RepairEdit[][]; result: "pass" | "NO_EDIT" | "NO_MORE_EDITS" | "limit"; attempts: number; orig: Map<string, string> }
function simulate(l: Libs, ctx: Ctx, files: Record<string, string>, request: string, path: string, checks: readonly Check[], v2 = true, max = 60): Sim {
  const d = repoDir(ctx, files);
  const test = oracle(path, checks);
  const total = checks.length;
  const p = l.prop.repairProposer({ v2 });
  p.prepare(openRepo(d), { request, failing: [] });
  const fs = tsFiles(d, files);
  const orig = new Map(fs.map((f) => [f.path, f.content]));
  const basePass = test(orig);
  assert.ok(basePass < total, "the fixture is not broken");
  const baseline = { total, passing: basePass, failing: total - basePass };
  const feedback: Prop.RepairFeedback[] = [];
  const proposals: Prop.RepairEdit[][] = [];
  for (let attempt = 1; attempt <= max; attempt++) {
    const r = p.next({ files: fs, attempt, feedback, baseline });
    if ("refuse" in r) return { proposals, result: r.refuse, attempts: attempt - 1, orig };
    proposals.push(r.edits);
    const m = new Map(orig);
    for (const e of r.edits) m.set(e.path, e.content);
    const pass = test(m);
    if (pass === total) return { proposals, result: "pass", attempts: attempt, orig };
    feedback.push({ attempt, codes: ["TEST_FAIL"], failing: [], tests: { total, passedByPeaceAI: pass } });
  }
  return { proposals, result: "limit", attempts: max, orig };
}
/** SStuB candidates for a whole file taken as one site: "template: replaced -> new". */
function sstub(l: Libs, text: string): string[] {
  const sf = l.prop.parseSource("src/x.ts", text);
  return l.prop.sstubMutationsIn(sf, { path: "src/x.ts", name: "x", start: 0, end: text.length, tier: 0 }, 0).map((m) => `${m.template}: ${text.slice(m.start, m.end)} -> ${m.text}`);
}
const has = (got: string[], want: string) => assert.ok(got.includes(want), `missing "${want}" in ${JSON.stringify(got)}`);
const lacks = (got: string[], re: RegExp) => assert.ok(!got.some((g) => re.test(g)), `unexpected ${re} in ${JSON.stringify(got)}`);
const SSTUB = new Set<string>(["swap-statements", "swap-args", "swap-operands", "change-identifier"]);
/** The M175 gate on a candidate: the class the loop would give it before any run (in-body is the only one expected). */
function gate(orig: ReadonlyMap<string, string>, edits: readonly Prop.RepairEdit[]): string {
  const read = (p: string) => orig.get(p) ?? null;
  return loop.editScopeProblem(edits, read, () => false) ?? loop.editScopeOf(edits, read) ?? "none";
}
/** The passing proposal of an admit is an SStuB template's, and every SStuB candidate of that site list is in-body. */
function admitted(l: Libs, ctx: Ctx, s: Sim, files: Record<string, string>, request: string, template: string): void {
  assert.equal(s.result, "pass", `${s.result} after ${s.attempts}`);
  const d = repoDir(ctx, files);
  const sites = l.prop.locate(openRepo(d), { request, failing: [] }, l.prop.CALLEE_DEPTH.v2);
  const queue = l.prop.repairCandidates(sites, s.orig, new Set(), true);
  const last = s.proposals.at(-1)!;
  const winner = queue.find((c) => JSON.stringify(c.edits) === JSON.stringify(last));
  assert.ok(winner, "the passing edit is a queue candidate");
  assert.deepEqual(winner.muts.map((m) => m.template), [template]);
  const ss = queue.filter((c) => c.muts.some((m) => SSTUB.has(m.template)));
  assert.ok(ss.length > 0);
  for (const c of ss) assert.equal(gate(s.orig, c.edits), "in-body", `M175 gate on ${c.muts[0]!.template}`);
  // no regression: every earlier template's candidate comes before every SStuB candidate (SStuB is last in TEMPLATES_V2)
  const firstSs = queue.findIndex((c) => c.muts.some((m) => SSTUB.has(m.template)));
  assert.ok(queue.slice(firstSs).every((c) => c.muts.every((m) => SSTUB.has(m.template))), "an earlier template's candidate after an SStuB one");
}

// ---- fixtures (synthetic, general bug shapes)
const METER = "export class Meter {\n  total = 0;\n  peak = 0;\n  add(v: number): void {\n    this.peak = Math.max(this.peak, this.total);\n    this.total += v;\n  }\n}\n";
const METER_CHECKS: Check[] = [(x) => { const m = new x.Meter(); m.add(5); return m.peak === 5; }, (x) => { const m = new x.Meter(); m.add(2); m.add(3); return m.peak === 5 && m.total === 5; }];
const LOG = "export function record(log: { items: number[]; size: number }, v: number): number {\n  log.size = log.items.length;\n  log.items.push(v);\n  return log.size;\n}\n";
const LOG_CHECKS: Check[] = [(x) => x.record({ items: [], size: 0 }, 7) === 1, (x) => x.record({ items: [1, 2], size: 2 }, 3) === 3];
const CLAMP = "function clampTo(v: number, lo: number, hi: number): number {\n  return Math.min(Math.max(v, lo), hi);\n}\nexport function percent(v: number): number {\n  return clampTo(v, 100, 0);\n}\n";
const CLAMP_CHECKS: Check[] = [(x) => x.percent(50) === 50, (x) => x.percent(-3) === 0, (x) => x.percent(140) === 100];
const HOURS = "function between(x: number, lo: number, hi: number): boolean {\n  return lo <= x && x <= hi;\n}\nexport function inWorkHours(hour: number): boolean {\n  return between(9, hour, 17);\n}\n";
const HOURS_CHECKS: Check[] = [(x) => x.inWorkHours(10) === true, (x) => x.inWorkHours(8) === false, (x) => x.inWorkHours(18) === false, (x) => x.inWorkHours(9) === true, (x) => x.inWorkHours(17) === true];
const ELAPSED = "export function elapsed(start: number, end: number): number {\n  return start - end;\n}\n";
const ELAPSED_CHECKS: Check[] = [(x) => x.elapsed(2, 5) === 3, (x) => x.elapsed(0, 0) === 0, (x) => x.elapsed(10, 11) === 1];
const EXPIRY = "export function isExpired(now: number, deadline: number): boolean {\n  return deadline > now;\n}\n";
const EXPIRY_CHECKS: Check[] = [(x) => x.isExpired(10, 5) === true, (x) => x.isExpired(5, 10) === false, (x) => x.isExpired(5, 5) === false];
const AREA = "export function area(w: number, h: number): number {\n  return w * w;\n}\n";
const AREA_CHECKS: Check[] = [(x) => x.area(2, 3) === 6, (x) => x.area(4, 1) === 4];
const INITIALS = "export function initials(first: string, last: string): string {\n  const a = first.charAt(0);\n  const b = last.charAt(0);\n  return (a + a).toUpperCase();\n}\n";
const INITIALS_CHECKS: Check[] = [(x) => x.initials("ada", "lovelace") === "AL", (x) => x.initials("grace", "hopper") === "GH"];

const admit = (id: string, files: Record<string, string>, request: string, path: string, checks: Check[], template: string, want: RegExp): Case => ({
  id, run(l, ctx) {
    const s = simulate(l, ctx, files, request, path, checks);
    admitted(l, ctx, s, files, request, template);
    assert.match(s.proposals.at(-1)![0]!.content, want);
  },
});

export const CASES: Case[] = [
  // ---- admits: two unrelated shapes per class, each fixed by the class, each candidate in-body under the M175 gate
  admit("swap-statements admit (class method): a peak read before the total it should include is fixed by swapping the two statements", { "src/meter.ts": METER }, "`Meter` keeps its peak one step behind the total.", "src/meter.ts", METER_CHECKS, "swap-statements", /this\.total \+= v;\n {4}this\.peak = Math\.max/),
  admit("swap-statements admit (function, object param): a size read before the push is fixed", { "src/log.ts": LOG }, "`record` returns the size before the new item.", "src/log.ts", LOG_CHECKS, "swap-statements", /log\.items\.push\(v\);\n {2}log\.size = log\.items\.length;/),
  admit("swap-args admit (callee in the same file): clamp bounds passed high-first are fixed", { "src/pct.ts": CLAMP }, "`percent` does not clamp into 0..100.", "src/pct.ts", CLAMP_CHECKS, "swap-args", /clampTo\(v, 0, 100\)/),
  admit("swap-args admit (literal and reference): a range check called with the value in the wrong slot is fixed", { "src/hours.ts": HOURS }, "`inWorkHours` is wrong for most hours.", "src/hours.ts", HOURS_CHECKS, "swap-args", /between\(hour, 9, 17\)/),
  admit("swap-operands admit (arithmetic): a negative elapsed time is fixed", { "src/time.ts": ELAPSED }, "`elapsed` comes out negative.", "src/time.ts", ELAPSED_CHECKS, "swap-operands", /return end - start;/),
  admit("swap-operands admit (comparison): an expiry check that is backwards is fixed", { "src/expiry.ts": EXPIRY }, "`isExpired` is backwards.", "src/expiry.ts", EXPIRY_CHECKS, "swap-operands", /return now > deadline;/),
  admit("change-identifier admit (parameter): an area that squares the width is fixed", { "src/area.ts": AREA }, "`area` ignores the height.", "src/area.ts", AREA_CHECKS, "change-identifier", /return w \* h;|return h \* w;/),
  admit("change-identifier admit (function-top local): initials that repeat the first letter are fixed", { "src/names.ts": INITIALS }, "`initials` repeats the first initial.", "src/names.ts", INITIALS_CHECKS, "change-identifier", /\(a \+ b\)\.toUpperCase\(\)/),
  {
    id: "unit: one small function gives exactly its swaps and substitutions, in visit order (a function's substitutions, then what lies inside it)",
    run(l) {
      assert.deepEqual(sstub(l, "function f(a: number, b: number): number {\n  return a - b;\n}\n"), ["change-identifier: a -> b", "change-identifier: b -> a", "swap-operands: a - b -> b - a"]);
      assert.deepEqual(sstub(l, "function g(o: number[], v: number): void {\n  o.push(v, 1);\n  o.sort();\n}\n"), ["change-identifier: o -> v", "change-identifier: v -> o", "change-identifier: o -> v", "swap-statements: o.push(v, 1);\n  o.sort(); -> o.sort();\n  o.push(v, 1);", "swap-args: v, 1 -> 1, v"]);
    },
  },
  // ---- near misses: one per guard (the refused shape next to an admitted one in the same file)
  {
    id: "swap-statements near misses (m176-guard:ss-expr / ss-semi): a declaration or a return beside an expression statement, or statements without semicolons, are not swapped",
    run(l) {
      const decl = sstub(l, "function f(o: { n: number }): number {\n  const x = o.n;\n  o.n++;\n  return x;\n}\n");
      lacks(decl, /^swap-statements/);
      const semi = sstub(l, "function g(o: { a: number; b: number }) {\n  o.a = 1\n  o.b = 2\n  o.a = 3;\n  o.b = 4;\n}\n");
      assert.deepEqual(semi.filter((g) => g.startsWith("swap-statements")), ["swap-statements: o.a = 3;\n  o.b = 4; -> o.b = 4;\n  o.a = 3;"]);
    },
  },
  {
    id: "swap-args near miss (m176-guard:sa-simple): a call, a spread or an object argument is not moved; the simple pair beside it is",
    run(l) {
      const got = sstub(l, "function f(g: () => number, xs: number[], y: number) {\n  return h(g(), y, 2, ...xs, { y }, y);\n}\ndeclare function h(...a: unknown[]): number;\n");
      assert.deepEqual(got.filter((g) => g.startsWith("swap-args")), ["swap-args: y, 2 -> 2, y"]);
    },
  },
  {
    id: "swap-operands near misses (m176-guard:so-op / so-simple): + * === && are not swapped; a call or a nested binary operand is not moved",
    run(l) {
      const op = sstub(l, "function f(a: number, b: number) {\n  return [a + b, a * b, a === b, a && b, a % b];\n}\n");
      assert.deepEqual(op.filter((g) => g.startsWith("swap-operands")), ["swap-operands: a % b -> b % a"]);
      const simple = sstub(l, "function g(a: number, b: number, c: number) {\n  return [Math.abs(a) - b, a - b * c, a / b];\n}\n");
      assert.deepEqual(simple.filter((g) => g.startsWith("swap-operands")), ["swap-operands: a / b -> b / a"]);
    },
  },
  {
    id: "change-identifier near misses (m176-guard:ci-decl, which also covers a shorthand key / ci-callee / ci-type): a property name, a declared name, a shorthand key, a callee, a name in a type are not substituted; reads are",
    run(l) {
      const got = sstub(l, "function f(a: { a: number }, b: (x: unknown) => number) {\n  const c: typeof a = a;\n  return [c.a, { b }, b(c)];\n}\n");
      const ci = got.filter((g) => g.startsWith("change-identifier"));
      // reads: `a` (initializer of c), `c` (twice). Not: the param names, `c` declared, `.a`, `{ b }`, the callee `b`, `typeof a`
      assert.deepEqual(ci, ["change-identifier: a -> b", "change-identifier: c -> a", "change-identifier: c -> b", "change-identifier: c -> a", "change-identifier: c -> b"]);
    },
  },
  {
    id: "change-identifier near misses (m176-guard:ci-write / ci-incdec): an assignment target and a ++/-- operand are not substituted; the read on the right is",
    run(l) {
      const got = sstub(l, "function f(a: number, b: number) {\n  a = b;\n  a += 1;\n  b++;\n  --a;\n}\n");
      assert.deepEqual(got.filter((g) => g.startsWith("change-identifier")), ["change-identifier: b -> a"]);
    },
  },
  {
    id: "change-identifier near misses (m176-guard:ci-before / ci-inner): a local is not used before its declaration ends (nor in its own initializer); a nested function's names are left to that function",
    run(l) {
      const before = sstub(l, "function f(a: number) {\n  const r = a + 1;\n  const s = 2;\n  return r;\n}\n");
      assert.deepEqual(before.filter((g) => g.startsWith("change-identifier")), ["change-identifier: r -> a", "change-identifier: r -> s"]);
      const inner = sstub(l, "function g(a: number, b: number) {\n  return [a].map((a) => a * 2);\n}\n");
      // the outer read [a] -> [b]; the inner arrow has one own name, so nothing; never `b * 2` for the inner `a`
      assert.deepEqual(inner.filter((g) => g.startsWith("change-identifier")), ["change-identifier: a -> b"]);
      lacks(inner.filter((g) => g.startsWith("swap")), /a \* 2/);
    },
  },
  {
    id: "near miss (m176-guard:sstub-v2-only): repair-v1's candidate list has no SStuB template and does not fix the elapsed fixture",
    run(l, ctx) {
      const s = simulate(l, ctx, { "src/time.ts": ELAPSED }, "`elapsed` comes out negative.", "src/time.ts", ELAPSED_CHECKS, false);
      assert.notEqual(s.result, "pass", "repair-v1 passed");
      assert.ok(!s.proposals.some((p) => /return end - start;/.test(p[0]!.content)), "repair-v1 swapped the operands");
      const d = repoDir(ctx, { "src/time.ts": ELAPSED });
      const sites = l.prop.locate(openRepo(d), { request: "`elapsed` comes out negative.", failing: [] }, l.prop.CALLEE_DEPTH.v1);
      assert.ok(!l.prop.repairCandidates(sites, s.orig, new Set(), false).some((c) => c.muts.some((m) => SSTUB.has(m.template))));
    },
  },
  {
    id: "order: the SStuB templates are the last v2 templates; repair-v1's list and the earlier v2 order are unchanged",
    run(l) {
      assert.deepEqual([...l.prop.SSTUB_TEMPLATES], ["swap-statements", "swap-args", "swap-operands", "change-identifier"]);
      assert.deepEqual([...l.prop.TEMPLATES_V2], [...l.prop.IDIOM_TEMPLATES, ...l.prop.TEMPLATES, ...l.prop.CONST_TEMPLATES, ...l.prop.SSTUB_TEMPLATES]);
      assert.deepEqual([...l.prop.TEMPLATES], ["missing-export", "nullish-check", "comparison", "arithmetic", "off-by-one", "logical", "default-value", "null-guard", "negate-condition", "boolean-return"]);
    },
  },
  // ---- end to end (candidate uid): the real loop with repair-v2 passes a backwards subtraction through swap-operands,
  // the M175 gate admits the multi-token edit as in-body before the run, and the PASS row records editScope in-body
  {
    id: "loop e2e: repair-v2 fixes a backwards subtraction with swap-operands; the row is a valid PASS with editScope in-body",
    needsCand: true,
    run() {
      const m151 = setup151();
      const scratch = mkdtempSync(join(tmpdir(), "peaceai-m176-e2e-"));
      try {
        const ctx = { m151, scratch };
        const test = 'import assert from "node:assert/strict";\nimport { elapsed } from "../src/span.ts";\n\ntest("forward", () => assert.equal(elapsed(2, 5), 3));\ntest("same", () => assert.equal(elapsed(4, 4), 0));\n';
        const task = { ...e2eTask(ctx, `m176-span-${Date.now() % 100000}`, { "src/span.ts": "export function elapsed(start: number, end: number): number {\n  return start - end;\n}\n" }, test), request: "`elapsed` comes out negative." };
        const r = loop.runLoopTask(task as never, "public", "a".repeat(64), { ...opts174(ctx, repairProposer({ v2: true }) as unknown as Loop.Proposer, 4), env: { ...m151.env, [STAGE2_CAND_ENV]: M176_CAND } } as never);
        assert.equal(loopRowProblem(r.row), null, `row valid (${loopRowProblem(r.row)})`);
        if (!m176Cand()) { assert.match(r.row.code, /^CAND_UID_/); return; }
        assert.equal(r.row.code, "PASS", `codes ${JSON.stringify(r.row.attemptCodes)}`);
        assert.equal((r.row as LoopRow).editScope, "in-body");
        assert.equal(r.row.attempts, 2, "arithmetic (- -> +) first, then swap-operands");
      } finally { teardown151(m151); rmSync(scratch, { recursive: true, force: true }); }
    },
  },
];
