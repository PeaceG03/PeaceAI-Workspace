// M182 behavior cases (batch 19) for repair-v2's member-callee localisation (peaceai/lib/editpropose.ts memberSites and
// its use at the end of locate). As data so m182-mutation.test.ts can replay the pure cases against each mutant. Each
// case throws (node:assert) on failure. The localisation is admitted on three unrelated class shapes (a private method
// call through `this`, getter reads through `this`, a static call through the class's own name), each a fault in a
// member the request does not name, so no located site before M182 holds the fix; every m182 guard has a refused near
// miss; every proposal of the admits is checked against the loop's M175 gate (in-body). Fixtures are tiny synthetic
// repos written for these tests from general shapes (a thermostat, an invoice, a grid, a meter, a tally, a label, a
// clock): none is modeled on a dev-split task's code or on a reference diff, and none is a PeaceSTOCKS shape. The "tests"
// are an in-process oracle; the end-to-end case (needsCand) runs the real loop and needs M182_CAND (no fallback user).
// Spec: peaceai/spec/repair-v2-m182.md.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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

// The end-to-end case runs ONLY as the candidate uid named by M182_CAND (the box suite sets it explicitly); with none
// set it asserts the fail-closed CAND_UID_* refusal. It never falls back to another batch's candidate user.
const M182_CAND = process.env.M182_CAND ?? "";
export const m182Cand = (): boolean => stage2CandUid({ [STAGE2_CAND_ENV]: M182_CAND }).ok;

export interface Libs { prop: typeof Prop }
export interface Ctx { base: string }
export interface Case { id: string; needsCand?: boolean; run: (l: Libs, ctx: Ctx) => void }

export function setup(): Ctx { return { base: mkdtempSync(join(tmpdir(), "peaceai-m182-")) }; }
export function teardown(ctx: Ctx): void { rmSync(ctx.base, { recursive: true, force: true }); }

let n = 0;
function repoDir(ctx: Ctx, files: Record<string, string>): string {
  const d = join(ctx.base, `r${n++}`);
  for (const [p, c] of Object.entries(files)) { mkdirSync(dirname(join(d, p)), { recursive: true }); writeFileSync(join(d, p), c); }
  return d;
}
const tsFiles = (files: Record<string, string>) => Object.keys(files).filter((p) => /\.tsx?$/.test(p)).sort().map((p) => ({ path: p, content: files[p]! }));
/** Loads `path` from the in-memory files as CommonJS (one module, no imports). */
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
const apply = (orig: ReadonlyMap<string, string>, edits: readonly Prop.RepairEdit[]) => { const m = new Map(orig); for (const e of edits) m.set(e.path, e.content); return m; };
const MAX_ATTEMPTS = loop.MAX_ATTEMPTS;
const key = (e: readonly Prop.RepairEdit[]) => JSON.stringify(e);
/** The M175 gate on a candidate: the class the loop would give it before any run. */
function gate(orig: ReadonlyMap<string, string>, edits: readonly Prop.RepairEdit[]): string {
  const read = (p: string) => orig.get(p) ?? null;
  return loop.editScopeProblem(edits, read, () => false) ?? loop.editScopeOf(edits, read) ?? "none";
}
const sitesOf = (l: Libs, ctx: Ctx, files: Record<string, string>, request: string, depth: number = l.prop.CALLEE_DEPTH.v2): Prop.Site[] => l.prop.locate(openRepo(repoDir(ctx, files)), { request, failing: [] }, depth);
/** The tier-4 (member-callee) sites as "name@line" (1-based line of the member's start). */
function members(l: Libs, ctx: Ctx, files: Record<string, string>, request: string): string[] {
  const sites = sitesOf(l, ctx, files, request);
  return sites.filter((s) => s.tier === 4).map((s) => `${s.name}@${files[s.path]!.slice(0, s.start).split("\n").length}`);
}

/** The loop's attempt protocol in process: the oracle's count is the feedback (failing names empty, as for vitest / jest). */
function simulate(l: Libs, ctx: Ctx, files: Record<string, string>, request: string, path: string, checks: readonly Check[]) {
  const d = repoDir(ctx, files);
  const test = oracle(path, checks);
  const total = checks.length;
  const p = l.prop.repairProposer({ v2: true });
  p.prepare(openRepo(d), { request, failing: [] });
  const fs = tsFiles(files);
  const orig = new Map(fs.map((f) => [f.path, f.content]));
  const base = test(orig);
  assert.ok(base < total, "the fixture is not broken");
  const feedback: Prop.RepairFeedback[] = [];
  const proposals: Prop.RepairEdit[][] = [];
  let result = "limit";
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const r = p.next({ files: fs, attempt, feedback, baseline: { total, passing: base, failing: total - base } });
    if ("refuse" in r) { result = r.refuse; break; }
    proposals.push(r.edits);
    const pass = test(apply(orig, r.edits));
    if (pass === total) { result = "pass"; break; }
    feedback.push({ attempt, codes: ["TEST_FAIL"], failing: [], tests: { total, passedByPeaceAI: pass } });
  }
  return { proposals, result, base, orig };
}

// ---- fixtures (synthetic, general shapes)
// A: a private method called through `this`: the target temperature subtracts the boost instead of adding it
const THERMO = "export class Thermostat {\n  base: number;\n  boost: number;\n  constructor(base: number, boost: number) {\n    this.base = base;\n    this.boost = boost;\n  }\n  #target(): number {\n    return this.base - this.boost;\n  }\n  shouldHeat(now: number): boolean {\n    return now < this.#target();\n  }\n}\n";
const THERMOS = { "src/thermo.ts": THERMO };
const THERMO_REQ = "`shouldHeat` turns the heater on too late.";
const THERMO_CHECKS: Check[] = [(x) => new x.Thermostat(20, 2).shouldHeat(21) === true, (x) => new x.Thermostat(20, 2).shouldHeat(22) === false, (x) => new x.Thermostat(20, 2).shouldHeat(19) === true, (x) => new x.Thermostat(10, 0).shouldHeat(10) === false];
// B: getters read through `this`: the tax divides by the rate instead of multiplying
const INVOICE = "export class Invoice {\n  lines: number[];\n  rate: number;\n  constructor(lines: number[], rate: number) {\n    this.lines = lines;\n    this.rate = rate;\n  }\n  get subtotal(): number {\n    let s = 0;\n    for (const x of this.lines) s += x;\n    return s;\n  }\n  get tax(): number {\n    return this.subtotal / this.rate;\n  }\n  total(): number {\n    return this.subtotal + this.tax;\n  }\n}\n";
const INVOICES = { "src/invoice.ts": INVOICE };
const INVOICE_REQ = "`total` is wrong when a rate is set.";
const INVOICE_CHECKS: Check[] = [(x) => new x.Invoice([10, 30], 0.5).total() === 60, (x) => new x.Invoice([100], 0.25).total() === 125, (x) => new x.Invoice([], 0.5).total() === 0, (x) => new x.Invoice([8], 1).total() === 16];
// C: a static method called through the class's own name: the row-major index subtracts the column
const GRID = "export class Grid {\n  width: number;\n  cells: string[];\n  constructor(width: number, cells: string[]) {\n    this.width = width;\n    this.cells = cells;\n  }\n  static index(row: number, col: number, width: number): number {\n    return row * width - col;\n  }\n  at(row: number, col: number): string | undefined {\n    return this.cells[Grid.index(row, col, this.width)];\n  }\n}\n";
const GRIDS = { "src/grid.ts": GRID };
const GRID_REQ = "`at` returns the wrong cell.";
const g9 = (x: Record<string, any>) => new x.Grid(3, ["a", "b", "c", "d", "e", "f", "g", "h", "i"]);
const GRID_CHECKS: Check[] = [(x) => g9(x).at(0, 0) === "a", (x) => g9(x).at(1, 0) === "d", (x) => g9(x).at(0, 1) === "b", (x) => g9(x).at(2, 2) === "i"];

/** An admit: PASS within MAX_ATTEMPTS, and the passing edit changes only code inside a tier-4 (member) site, outside every
 *  site located before M182, so no candidate of the earlier sites (alone, paired or anchored) can be it. */
const admit = (id: string, files: Record<string, string>, request: string, path: string, checks: Check[], member: string[], want: RegExp): Case => ({
  id, run(l, ctx) {
    const sites = sitesOf(l, ctx, files, request);
    const mem = sites.filter((s) => s.tier === 4);
    assert.deepEqual(mem.map((s) => s.name), member, "the members the entry reaches are located");
    const s = simulate(l, ctx, files, request, path, checks);
    assert.equal(s.result, "pass", `${s.result} after ${s.proposals.length}`);
    const last = s.proposals.at(-1)!;
    assert.equal(last.length, 1);
    const before = files[last[0]!.path]!, after = last[0]!.content;
    let a = 0; while (before[a] === after[a]) a++;
    let b = 0; while (b < before.length - a && before[before.length - 1 - b] === after[after.length - 1 - b]) b++;
    const end = before.length - b;
    assert.ok(mem.some((m) => m.path === last[0]!.path && m.start <= a && end <= m.end), "the fix is inside the member site");
    assert.ok(!sites.some((x) => x.tier !== 4 && x.path === last[0]!.path && x.start < end && a < x.end), "the fix is outside every earlier site");
    assert.match(after, want);
    assert.equal(new Set(s.proposals.map(key)).size, s.proposals.length, "a proposal repeated");
    for (const p of s.proposals) assert.equal(gate(s.orig, p), "in-body");
  },
});

const CLOCK = "export class Clock {\n  mins: number;\n  constructor(mins: number) {\n    this.mins = mins;\n  }\n  hours(): number {\n    return Math.floor(this.mins / 60);\n  }\n  label(): string {\n    return `${this.hours()}h`;\n  }\n}\n";

export const CASES: Case[] = [
  // ---- admits: three unrelated class shapes, each a fault in a member the request does not name
  admit("admit (a private method called through this): Thermostat.shouldHeat -> this.#target(); the boost sign is fixed in #target", THERMOS, THERMO_REQ, "src/thermo.ts", THERMO_CHECKS, ["#target"], /return this\.base \+ this\.boost;/),
  admit("admit (getters read through this): Invoice.total reads this.subtotal and this.tax; the tax operator is fixed in the getter", INVOICES, INVOICE_REQ, "src/invoice.ts", INVOICE_CHECKS, ["subtotal", "tax"], /return this\.subtotal \* this\.rate;/),
  admit("admit (a static call through the class's own name): Grid.at -> Grid.index; the column sign is fixed in the static method", GRIDS, GRID_REQ, "src/grid.ts", GRID_CHECKS, ["index"], /return row \* width \+ col;/),
  {
    id: "order: member sites come after every other site, and the earlier sites and their numbers are unchanged",
    run(l, ctx) {
      for (const [files, req] of [[THERMOS, THERMO_REQ], [INVOICES, INVOICE_REQ], [GRIDS, GRID_REQ]] as const) {
        const sites = sitesOf(l, ctx, files, req);
        const at = sites.findIndex((s) => s.tier === 4);
        assert.ok(at > 0);
        assert.ok(sites.slice(at).every((s) => s.tier === 4), "nothing after the member sites");
        const v1 = sitesOf(l, ctx, files, req, l.prop.CALLEE_DEPTH.v1);
        assert.deepEqual(sites.slice(0, v1.length), v1, "the located sites are unchanged");
      }
    },
  },
  {
    id: "repair-v1 (and model-v1, which ranks repair-v1's list) locates no member site (M182 is behind m173-guard:cs-v2-only)",
    run(l, ctx) {
      for (const [files, req] of [[THERMOS, THERMO_REQ], [INVOICES, INVOICE_REQ], [GRIDS, GRID_REQ]] as const) assert.deepEqual(sitesOf(l, ctx, files, req, l.prop.CALLEE_DEPTH.v1).filter((s) => s.tier === 4), []);
    },
  },
  {
    id: "resolution: a static call to another top-level class of the same file is followed; an imported class and an inherited member are not (no cross-file or inheritance resolution)",
    run(l, ctx) {
      const units = "export class Units {\n  static toCm(inches: number): number {\n    return inches * 2;\n  }\n}\n";
      const shelf = "export class Shelf {\n  depth: number;\n  constructor(depth: number) {\n    this.depth = depth;\n  }\n  holds(inches: number): boolean {\n    return Units.toCm(inches) < this.depth;\n  }\n}\n";
      assert.deepEqual(members(l, ctx, { "src/shelf.ts": units + shelf }, "`holds` is wrong."), ["toCm@2"]);
      assert.deepEqual(members(l, ctx, { "src/units.ts": units, "src/shelf.ts": 'import { Units } from "./units.ts";\n' + shelf }, "`holds` is wrong."), []);
      const base = "export class Base {\n  helper(): number {\n    return 1;\n  }\n}\nexport class Kid extends Base {\n  run(): number {\n    return this.helper() + 1;\n  }\n}\n";
      assert.deepEqual(members(l, ctx, { "src/kid.ts": base }, "`run` is wrong."), []);
    },
  },
  // ---- near misses, one per guard
  {
    id: "near miss (m182-guard:mc-class): `this` in an object literal's method is not followed; the same shape as a class is",
    run(l, ctx) {
      const obj = "export const meter = {\n  factor: 2,\n  scale(x: number): number {\n    return x * this.factor;\n  },\n  read(x: number): number {\n    return this.scale(x) + 1;\n  },\n};\n";
      assert.deepEqual(members(l, ctx, { "src/meter.ts": obj }, "`read` is off by one."), []);
      const cls = "export class Meter {\n  factor = 2;\n  scale(x: number): number {\n    return x * this.factor;\n  }\n  read(x: number): number {\n    return this.scale(x) + 1;\n  }\n}\n";
      assert.deepEqual(members(l, ctx, { "src/meter.ts": cls }, "`read` is off by one."), ["scale@3"]);
    },
  },
  {
    id: "near miss (m182-guard:mc-rebind): `this` inside a nested function expression is another `this`; inside an arrow it is followed",
    run(l, ctx) {
      const t = "export class Tally {\n  n = 0;\n  bump(x: number): void {\n    this.n += x;\n  }\n  mark(x: number): void {\n    this.n -= x;\n  }\n  run(xs: number[]): void {\n    xs.forEach(function (x) { this.bump(x); });\n    xs.forEach((x) => this.mark(x));\n  }\n}\n";
      assert.deepEqual(members(l, ctx, { "src/tally.ts": t }, "`run` miscounts."), ["mark@6"]);
    },
  },
  {
    id: "near miss (m182-guard:mc-static): `this.norm()` in an instance method is the instance member, in a static method the static one",
    run(l, ctx) {
      const t = "export class Temp {\n  c: number;\n  constructor(c: number) {\n    this.c = c;\n  }\n  static norm(x: number): number {\n    return x / 10;\n  }\n  norm(): number {\n    return this.c + 1;\n  }\n  show(): number {\n    return this.norm() * 2;\n  }\n  static fromText(t: string): number {\n    return this.norm(t.length);\n  }\n}\n";
      assert.deepEqual(members(l, ctx, { "src/temp.ts": t }, "`show` is wrong."), ["norm@9"]);
      assert.deepEqual(members(l, ctx, { "src/temp.ts": t }, "`fromText` is wrong."), ["norm@6"]);
    },
  },
  {
    id: "near miss (m182-guard:mc-kind): a getter read is followed; a method read without a call (a reference) is not",
    run(l, ctx) {
      const t = "export class Label {\n  text: string;\n  constructor(text: string) {\n    this.text = text;\n  }\n  get upper(): string {\n    return this.text.toUpperCase();\n  }\n  fmt(): string {\n    return \"[\" + this.text + \"]\";\n  }\n  render(): string[] {\n    const f = this.fmt;\n    return [this.upper, typeof f];\n  }\n}\n";
      assert.deepEqual(members(l, ctx, { "src/label.ts": t }, "`render` is wrong."), ["upper@6"]);
    },
  },
  {
    id: "near miss (m182-guard:mc-body): an abstract method and overload signatures are not sites; the implementation is",
    run(l, ctx) {
      const t = "export abstract class Shape {\n  abstract area(): number;\n  scale(k: number): number;\n  scale(k: string): number;\n  scale(k: number | string): number {\n    return Number(k) * 2;\n  }\n  describe(): string {\n    return `${this.area()}:${this.scale(1)}`;\n  }\n}\n";
      assert.deepEqual(members(l, ctx, { "src/shape.ts": t }, "`describe` is wrong."), ["scale@5"]);
    },
  },
  {
    id: "near miss (m182-guard:mc-known): a member already located (named, or inside a located class) is not added again",
    run(l, ctx) {
      const f = { "src/clock.ts": CLOCK };
      assert.deepEqual(members(l, ctx, f, "`label` is wrong."), ["hours@6"]);
      assert.deepEqual(members(l, ctx, f, "`label` and `hours` disagree."), []);
      assert.deepEqual(members(l, ctx, f, "`Clock` and its `label` are wrong."), []);
    },
  },
  {
    id: "near miss (m182-guard:mc-cap): at most MAX_MEMBER_SITES member sites, the first ones in call order",
    run(l, ctx) {
      const names = ["ka", "kb", "kc", "kd", "ke", "kf"];
      const t = `export class Steps {\n${names.map((x, i) => `  ${x}(): number {\n    return ${i + 1};\n  }\n`).join("")}  go(): number {\n    return ${names.map((x) => `this.${x}()`).join(" + ")};\n  }\n}\n`;
      assert.equal(l.prop.MAX_MEMBER_SITES, 4);
      assert.deepEqual(members(l, ctx, { "src/steps.ts": t }, "`go` is wrong."), ["ka@2", "kb@5", "kc@8", "kd@11"]);
    },
  },
  // ---- end to end (candidate uid): the real loop with repair-v2 fixes fixture A within the attempt budget; every
  // attempt went through the M175 gate, and the PASS row records editScope in-body
  {
    id: "loop e2e: repair-v2 locates Thermostat's private #target through this and fixes it; the row is a valid PASS with editScope in-body",
    needsCand: true,
    run() {
      const m151 = setup151();
      const scratch = mkdtempSync(join(tmpdir(), "peaceai-m182-e2e-"));
      try {
        const ctx = { m151, scratch };
        const test = 'import assert from "node:assert/strict";\nimport { Thermostat } from "../src/thermo.ts";\n\ntest("heats below target", () => assert.equal(new Thermostat(20, 2).shouldHeat(21), true));\ntest("idle at target", () => assert.equal(new Thermostat(20, 2).shouldHeat(22), false));\ntest("heats when cold", () => assert.equal(new Thermostat(20, 2).shouldHeat(19), true));\ntest("no boost", () => assert.equal(new Thermostat(10, 0).shouldHeat(10), false));\n';
        const task = { ...e2eTask(ctx, `m182-thermo-${Date.now() % 100000}`, THERMOS, test), request: THERMO_REQ };
        const r = loop.runLoopTask(task as never, "public", "a".repeat(64), { ...opts174(ctx, repairProposer({ v2: true }) as unknown as Loop.Proposer, MAX_ATTEMPTS), env: { ...m151.env, [STAGE2_CAND_ENV]: M182_CAND } } as never);
        assert.equal(loopRowProblem(r.row), null, `row valid (${loopRowProblem(r.row)})`);
        if (!m182Cand()) { assert.match(r.row.code, /^CAND_UID_/); return; }
        assert.equal(r.row.code, "PASS", `codes ${JSON.stringify(r.row.attemptCodes)}`);
        assert.equal((r.row as LoopRow).editScope, "in-body");
        assert.ok(r.row.attempts! >= 1 && r.row.attempts! <= MAX_ATTEMPTS, `attempts ${r.row.attempts}`);
      } finally { teardown151(m151); rmSync(scratch, { recursive: true, force: true }); }
    },
  },
];
