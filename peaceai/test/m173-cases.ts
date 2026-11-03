// M173 behavior cases (batch 12) for repair-v2 (peaceai/lib/editpropose.ts, repairProposer({ v2: true })): module-scope
// constant sites and the const-value template. As data so m173-mutation.test.ts can replay them against each mutant.
// Each case throws (node:assert) on failure; every admitted condition has at least two different code shapes and every
// m173 guard has a refused near miss. Fixtures are tiny synthetic repos written for these tests from general bug
// shapes (a page size, a score table, a timeout map, a slug helper): none is modeled on a dev-split task's code or on a
// reference diff, and none is a PeaceSTOCKS shape. The "tests" are an in-process oracle (the edited module is
// transpiled and called), so these cases run anywhere. Spec: peaceai/spec/repair-v2-m173.md.
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

export function setup(): Ctx { return { base: mkdtempSync(join(tmpdir(), "peaceai-m173-")) }; }
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
  vm.runInNewContext(js, { module: mod, exports: mod.exports }, { timeout: 1000 });
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
interface Sim { proposals: Prop.RepairEdit[][]; result: "pass" | "NO_EDIT" | "NO_MORE_EDITS" | "limit"; attempts: number }
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
    if ("refuse" in r) return { proposals, result: r.refuse, attempts: attempt - 1 };
    proposals.push(r.edits);
    const m = new Map(orig);
    for (const e of r.edits) m.set(e.path, e.content);
    const pass = test(m);
    if (pass === total) return { proposals, result: "pass", attempts: attempt };
    feedback.push({ attempt, codes: ["TEST_FAIL"], failing: [], tests: { total, passedByPeaceAI: pass } });
  }
  return { proposals, result: "limit", attempts: max };
}
const located = (l: Libs, ctx: Ctx, files: Record<string, string>, request: string, v2 = true) =>
  l.prop.locate(openRepo(repoDir(ctx, files)), { request, failing: [] }, v2 ? l.prop.CALLEE_DEPTH.v2 : l.prop.CALLEE_DEPTH.v1).map((s) => `${s.path}#${s.name}:${s.tier}`);
/** const-value candidates for a whole file taken as one site: [replaced source, new text]. */
function constMuts(l: Libs, text: string): string[] {
  const sf = l.prop.parseSource("src/x.ts", text);
  return l.prop.constMutationsIn(sf, { path: "src/x.ts", name: "x", start: 0, end: text.length, tier: 3 }, 0).map((m) => `${text.slice(m.start, m.end)}->${m.text}`);
}

// fixtures (synthetic, general bug shapes)
const PAGES = "const PAGE_SIZE = 9;\nexport function pageOf<T>(items: T[], index: number): T[] {\n  const from = index * PAGE_SIZE;\n  return items.slice(from, from + PAGE_SIZE);\n}\n";
const PAGE_CHECKS: Check[] = [
  (x) => x.pageOf([...Array(25).keys()], 0).length === 10,
  (x) => x.pageOf([...Array(25).keys()], 1)[0] === 10,
  (x) => x.pageOf([...Array(25).keys()], 2).length === 5,
];
const GRADES = "const BOUNDS = [90, 80, 70, 61];\nconst NAMES = [\"A\", \"B\", \"C\", \"D\"];\nexport function letterFor(score: number): string {\n  for (let i = 0; i < BOUNDS.length; i++) if (score >= BOUNDS[i]!) return NAMES[i]!;\n  return \"F\";\n}\n";
const GRADE_CHECKS: Check[] = [(x) => x.letterFor(60) === "D", (x) => x.letterFor(59) === "F", (x) => x.letterFor(95) === "A", (x) => x.letterFor(85) === "B"];
const TIMEOUTS = "const TIMEOUTS = { connect: 5000, read: 30001 };\nexport function timeoutFor(kind: \"connect\" | \"read\"): number {\n  return TIMEOUTS[kind];\n}\n";
const TIMEOUT_CHECKS: Check[] = [(x) => x.timeoutFor("read") === 30000, (x) => x.timeoutFor("connect") === 5000];
const SLUG = [
  "const SLUG_RX = /[^a-z0-9]+/g;",
  "const MAX_LEN = 40;",
  "const UNUSED = 7;",
  "let counter = 0;",
  "declare const BUILD_ID = \"dev\";",
  "const fmt = (s: string) => s.trim();",
  "const WIDTH = 3;",
  "const SEP = \"_\";",
  "export function slugify(title: string, opts: { WIDTH?: number } = {}): string {",
  "  counter++;",
  "  const SEP = \"-\";",
  "  const f = fmt;",
  "  const s = f(title).toLowerCase().replace(SLUG_RX, SEP);",
  "  return s.slice(0, MAX_LEN) + String(opts.WIDTH ?? \"\") + BUILD_ID.slice(0, 0);",
  "}",
  "",
].join("\n");
const MANY = "const A = 1;\nconst B = 2;\nconst C = 3;\nconst D = 4;\nconst E = 5;\nexport function sumAll(): number {\n  return A + B + C + D + E;\n}\n";

export const CASES: Case[] = [
  // ---- module-scope constant sites (localisation)
  {
    id: "const sites admit: the constants a located function reads (a regex and a number) are tier-3 sites after every other site, in source order",
    run(l, ctx) {
      assert.deepEqual(located(l, ctx, { "src/slug.ts": SLUG }, "`slugify` keeps the wrong characters"), ["src/slug.ts#slugify:0", "src/slug.ts#SLUG_RX:3", "src/slug.ts#MAX_LEN:3"]);
      assert.deepEqual(located(l, ctx, { "src/pages.ts": PAGES }, "`pageOf` returns short pages"), ["src/pages.ts#pageOf:0", "src/pages.ts#PAGE_SIZE:3"]);
      assert.deepEqual(located(l, ctx, { "src/grades.ts": GRADES }, "`letterFor` is wrong at the D boundary"), ["src/grades.ts#letterFor:0", "src/grades.ts#BOUNDS:3", "src/grades.ts#NAMES:3"]);
    },
  },
  {
    id: "const sites near misses (m173-guard:cs-read / cs-const / cs-declare / cs-not-fn / cs-ref-expr / cs-shadow): an unread const, a top-level let, a declare const, a const function read as a value, a const only named as a property, a const shadowed inside the function",
    run(l, ctx) {
      const got = located(l, ctx, { "src/slug.ts": SLUG }, "`slugify` keeps the wrong characters");
      for (const name of ["UNUSED", "counter", "BUILD_ID", "fmt", "WIDTH", "SEP"]) assert.ok(!got.some((s) => s.startsWith(`src/slug.ts#${name}:`)), `${name} located: ${got.join(" ")}`);
    },
  },
  {
    id: "const sites near miss (m173-guard:cs-cap): at most MAX_CONST_SITES constants are added (5 read, 4 kept, source order)",
    run(l, ctx) {
      assert.equal(l.prop.MAX_CONST_SITES, 4);
      assert.deepEqual(located(l, ctx, { "src/many.ts": MANY }, "`sumAll` is off"), ["src/many.ts#sumAll:0", "src/many.ts#A:3", "src/many.ts#B:3", "src/many.ts#C:3", "src/many.ts#D:3"]);
    },
  },
  {
    id: "const sites near miss (m173-guard:cs-v2-only): repair-v1's locate is unchanged (no tier-3 sites)",
    run(l, ctx) {
      assert.deepEqual(located(l, ctx, { "src/slug.ts": SLUG }, "`slugify` keeps the wrong characters", false), ["src/slug.ts#slugify:0"]);
      assert.deepEqual(located(l, ctx, { "src/pages.ts": PAGES }, "`pageOf` returns short pages", false), ["src/pages.ts#pageOf:0"]);
    },
  },
  // ---- const-value (template)
  {
    id: "const-value admit (whole initializer): a page size one too small is fixed through the constant the named function reads",
    run(l, ctx) {
      const s = simulate(l, ctx, { "src/pages.ts": PAGES }, "`pageOf` returns pages with one item too few: a page holds ten items.", "src/pages.ts", PAGE_CHECKS);
      assert.equal(s.result, "pass", `${s.result} after ${s.attempts}`);
      assert.match(s.proposals.at(-1)![0]!.content, /^const PAGE_SIZE = 10;$/m);
    },
  },
  {
    id: "const-value admit (array element): a score table entry off by one is fixed (other entries tried first, all refused by the tests)",
    run(l, ctx) {
      const s = simulate(l, ctx, { "src/grades.ts": GRADES }, "`letterFor` gives F for a score of 60; 60 is a D.", "src/grades.ts", GRADE_CHECKS);
      assert.equal(s.result, "pass", `${s.result} after ${s.attempts}`);
      assert.match(s.proposals.at(-1)![0]!.content, /^const BOUNDS = \[90, 80, 70, 60\];$/m);
    },
  },
  {
    id: "const-value admit (object property value): a timeout map entry off by one is fixed",
    run(l, ctx) {
      const s = simulate(l, ctx, { "src/net.ts": TIMEOUTS }, "`timeoutFor` returns the wrong read timeout; it is 30000 ms.", "src/net.ts", TIMEOUT_CHECKS);
      assert.equal(s.result, "pass", `${s.result} after ${s.attempts}`);
      assert.match(s.proposals.at(-1)![0]!.content, /read: 30000 \}/);
    },
  },
  {
    id: "const-value unit: whole, negated, array and object values give +1 and -1 (in source order)",
    run(l) {
      assert.deepEqual(constMuts(l, "const N = 0;\nconst M = -2;\n"), ["0->1", "0->-1", "-2->-1", "-2->-3"]);
      assert.deepEqual(constMuts(l, "const L = [1, 22];\nconst O = { a: 3, b: \"x\" };\n"), ["1->2", "1->0", "22->23", "22->21", "3->4", "3->2"]);
    },
  },
  {
    id: "const-value near misses (m173-guard:cv-int): a fraction, hex, exponent, separator, leading zero, or a 7-digit literal is not edited",
    run(l) {
      for (const v of ["0.5", "0x10", "1e3", "1_000", "1234567"]) assert.deepEqual(constMuts(l, `const V = ${v};\n`), [], v);
    },
  },
  {
    id: "const-value near misses (m173-guard:cv-const, structure): a top-level let, a const inside a function, a value nested two levels down, a literal inside a call",
    run(l) {
      assert.deepEqual(constMuts(l, "let LIMIT = 3;\nexport let L2 = [4];\n"), [], "let");
      assert.deepEqual(constMuts(l, "export function f(): number {\n  const n = 3;\n  return n;\n}\n"), [], "local const");
      assert.deepEqual(constMuts(l, "const T = { a: { b: 3 } };\nconst U = [[4]];\nconst W = Math.max(5, 6);\n"), [], "nested / call");
    },
  },
  {
    id: "const-value near miss (m173-guard:cv-v2-only, m173-guard:cv-array / cv-object via the admits): repair-v1 never proposes const-value, even when the request names the constant",
    run(l, ctx) {
      const s = simulate(l, ctx, { "src/pages.ts": PAGES }, "`PAGE_SIZE` is one too small for `pageOf`.", "src/pages.ts", PAGE_CHECKS, false);
      assert.notEqual(s.result, "pass", "repair-v1 passed");
      assert.ok(!s.proposals.some((p) => /const PAGE_SIZE = (?:10|8);/.test(p[0]!.content)), "repair-v1 edited the constant");
    },
  },
  {
    id: "order: const-value is the last v2 template, so the earlier templates' candidates and order are unchanged",
    run(l) {
      assert.deepEqual([...l.prop.CONST_TEMPLATES], ["const-value"]);
      assert.deepEqual([...l.prop.TEMPLATES_V2], [...l.prop.IDIOM_TEMPLATES, ...l.prop.TEMPLATES, "const-value", ...l.prop.SSTUB_TEMPLATES, ...l.prop.STMT_TEMPLATES]); // M176: the SStuB classes come after const-value; M177: then the statement edits
    },
  },
];
