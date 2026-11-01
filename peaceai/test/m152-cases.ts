// M152 behavior cases for the general edit proposer (peaceai/lib/editpropose.ts), as data so the mutation test can
// replay them against each mutant. Each case throws (node:assert) on failure. Every guard has a refused near-miss.
// The fixtures are tiny synthetic repos written for these tests (not modeled on any scorecard task). Most cases are
// pure: the "tests" are an in-process oracle (the edited module is transpiled and called on fixed inputs), so they
// run anywhere. The loop case runs the real loop (node:test in the stage-2 isolation) and needs the candidate uid;
// without it, it asserts the fail-closed CAND_UID_* refusal.
import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import vm from "node:vm";
import ts from "typescript";
import { openRepo } from "../lib/codesearch.ts";
import { loopRowProblem } from "../lib/looprow.ts";
import type * as Prop from "../lib/editpropose.ts";
import type * as Loop from "../lib/loop.ts";
import type { M152Ctx } from "./m152-fixtures.ts";

export interface Libs { prop: typeof Prop; loop: typeof Loop }
export interface Case { id: string; run: (l: Libs, ctx: M152Ctx) => void }

let n = 0;
function repoDir(ctx: M152Ctx, files: Record<string, string>): string {
  const d = join(ctx.base, "p", `r${n++}`);
  for (const [p, c] of Object.entries(files)) { mkdirSync(dirname(join(d, p)), { recursive: true }); writeFileSync(join(d, p), c); }
  return d;
}
const tsFiles = (d: string, files: Record<string, string>) => Object.keys(files).filter((p) => /\.tsx?$/.test(p)).sort().map((p) => ({ path: p, content: readFileSync(join(d, p), "utf8") }));

/** Calls `fn` of a transpiled module on each input; the count of outputs equal to the expected ones. */
type Vec = [unknown[], unknown];
function score(content: string, fn: string, vecs: readonly Vec[]): number {
  const js = ts.transpileModule(content, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const mod = { exports: {} as Record<string, unknown> };
  try { vm.runInNewContext(js, { module: mod, exports: mod.exports }, { timeout: 1000 }); } catch { return 0; }
  let ok = 0;
  for (const [args, want] of vecs) { try { const f = mod.exports[fn] as (...a: unknown[]) => unknown; if (typeof f === "function" && JSON.stringify(f(...args)) === JSON.stringify(want)) ok++; } catch { /* a failing test */ } }
  return ok;
}

interface Sim { proposals: Prop.RepairEdit[][]; result: "pass" | "NO_EDIT" | "NO_MORE_EDITS" | "limit"; attempts: number; searched: string[] }
/** The loop in miniature: prepare on the repo, then propose / apply / test (the oracle) / feed back, up to max. */
function simulate(l: Libs, d: string, files: Record<string, string>, request: string, oracle: (edited: Map<string, string>) => number, total: number, max = 20, codes: (attempt: number) => string[] = () => []): Sim {
  const p = l.prop.repairProposer();
  const search = openRepo(d);
  const searched: string[] = [];
  const spy = new Proxy(search, { get: (t, k) => (k === "read" ? (path: string) => { searched.push(path); return t.read(path); } : (t as any)[k]) });
  p.prepare(spy, { request, failing: [] });
  const fs = tsFiles(d, files);
  const orig = new Map(fs.map((f) => [f.path, f.content]));
  const basePass = oracle(orig);
  const baseline = { total, passing: basePass, failing: total - basePass };
  const feedback: Prop.RepairFeedback[] = [];
  const proposals: Prop.RepairEdit[][] = [];
  for (let attempt = 1; attempt <= max; attempt++) {
    const r = p.next({ files: fs, attempt, feedback, baseline });
    if ("refuse" in r) return { proposals, result: r.refuse, attempts: attempt - 1, searched };
    proposals.push(r.edits);
    const m = new Map(orig);
    for (const e of r.edits) m.set(e.path, e.content);
    const pass = oracle(m);
    const extra = codes(attempt);
    if (pass === total && extra.length === 0) return { proposals, result: "pass", attempts: attempt, searched };
    feedback.push({ attempt, codes: [...new Set(["TEST_FAIL", ...extra])].sort(), failing: [], tests: { total, passedByPeaceAI: pass } });
  }
  return { proposals, result: "limit", attempts: max, searched };
}

const RANGE = "export function inRange(x: number, lo: number, hi: number): boolean {\n  return x >= lo && x < hi;\n}\n";
const RANGE_VECS: Vec[] = [[[1, 1, 5], true], [[3, 1, 5], true], [[5, 1, 5], true], [[0, 1, 5], false], [[6, 1, 5], false]];
const PICK = "export function pick(o: Record<string, unknown>, k: string, d: unknown): unknown {\n  return o[k] || d;\n}\n";
const PICK_VECS: Vec[] = [[[{ a: 0 }, "a", 5], 0], [[{ a: "" }, "a", "x"], ""], [[{}, "a", 5], 5], [[{ a: 2 }, "a", 5], 2]];
// two independent faults: both bounds exclusive where both must be inclusive (each fix alone turns some tests green)
const BOUNDS = "export function clampOk(x: number, lo: number, hi: number): boolean {\n  return x > lo && x < hi;\n}\n";
const BOUNDS_VECS: Vec[] = [[[1, 1, 5], true], [[5, 1, 5], true], [[3, 1, 5], true], [[0, 1, 5], false], [[6, 1, 5], false]];
const BIG = "export function many(a: number, b: number, c: number): number {\n" + Array.from({ length: 30 }, (_, i) => `  if (a > ${i} && b < ${i} || c >= ${i}) a = a + ${i};\n`).join("") + "  return a;\n}\n";

const oracleOf = (path: string, fn: string, vecs: Vec[]) => (m: Map<string, string>) => score(m.get(path)!, fn, vecs);

export const CASES: Case[] = [
  {
    id: "names: code spans and camelCase / snake_case words are symbols; keywords, globals and string values are not",
    run(l) {
      assert.deepEqual(l.prop.namedSymbols("`inRange(5, 1, 5)` is false; `JSON.parse('{\"__a\":1}')` and parseFoo_bar in MAX_SIZE. the Plain words"), ["inRange", "parseFoo_bar", "MAX_SIZE"]);
      assert.deepEqual(l.prop.namedSymbols("Fix it so that it works."), []);
    },
  },
  {
    id: "repair: a wrong boundary comparison named by the request is fixed and checked by the tests (comparison template)",
    run(l, ctx) {
      const files = { "src/range.ts": RANGE, "package.json": "{}" };
      const d = repoDir(ctx, files);
      const s = simulate(l, d, files, "`inRange(5, 1, 5)` returns false, but the upper bound is inclusive.", oracleOf("src/range.ts", "inRange", RANGE_VECS), RANGE_VECS.length);
      assert.equal(s.result, "pass");
      assert.match(s.proposals.at(-1)![0]!.content, /x <= hi/);
      assert.ok(s.attempts <= 20);
    },
  },
  {
    id: "repair: a truthiness fallback that drops falsy values becomes a nullish one (nullish-check template)",
    run(l, ctx) {
      const files = { "src/pick.ts": PICK };
      const d = repoDir(ctx, files);
      const s = simulate(l, d, files, "`pick({ a: 0 }, 'a', 5)` gives 5: a present falsy value must be kept.", oracleOf("src/pick.ts", "pick", PICK_VECS), PICK_VECS.length);
      assert.equal(s.result, "pass");
      assert.match(s.proposals.at(-1)![0]!.content, /o\[k\] \?\? d/);
    },
  },
  {
    id: "repair: a declaration the request names that nothing exports gets exported (missing-export template)",
    run(l, ctx) {
      const files = { "src/slug.ts": "function slugify(s: string): string {\n  return s.toLowerCase();\n}\nexport const other = 1;\n" };
      const d = repoDir(ctx, files);
      const s = simulate(l, d, files, "`slugify` cannot be imported from the package.", (m) => (/^export function slugify/m.test(m.get("src/slug.ts")!) ? 1 : 0), 1);
      assert.equal(s.result, "pass");
      assert.equal(s.attempts, 1);
    },
  },
  {
    id: "evidence-grounded combination: two single fixes that each raise the passing count are combined (and only those)",
    run(l, ctx) {
      const files = { "src/bounds.ts": BOUNDS };
      const d = repoDir(ctx, files);
      const o = oracleOf("src/bounds.ts", "clampOk", BOUNDS_VECS);
      const s = simulate(l, d, files, "`clampOk(1, 1, 5)` and `clampOk(5, 1, 5)` are false; both bounds are inclusive.", o, BOUNDS_VECS.length);
      assert.equal(s.result, "pass");
      const fin = s.proposals.at(-1)![0]!.content;
      assert.match(fin, /x >= lo && x <= hi/);
      // the final edit combines two single-site candidates, each proposed alone earlier and each raising the count
      const base = o(new Map([["src/bounds.ts", BOUNDS]]));
      const lo = BOUNDS.replace("x > lo", "x >= lo"), hi = BOUNDS.replace("x < hi", "x <= hi");
      const earlier = s.proposals.slice(0, -1).map((p) => p[0]!.content);
      assert.ok(earlier.includes(lo) && earlier.includes(hi));
      assert.ok(o(new Map([["src/bounds.ts", lo]])) > base && o(new Map([["src/bounds.ts", hi]])) > base);
      for (const c of earlier) assert.ok(!(/x >= lo/.test(c) && /x <= hi/.test(c)), "the combination came early");
    },
  },
  {
    id: "evidence-grounded combination near-miss: an attempt that raised the count but also timed out is never combined",
    run(l, ctx) {
      const files = { "src/bounds.ts": BOUNDS };
      const d = repoDir(ctx, files);
      const o = oracleOf("src/bounds.ts", "clampOk", BOUNDS_VECS);
      // every attempt also reports TIMEOUT: nothing qualifies, so no combined edit is ever proposed
      const s = simulate(l, d, files, "`clampOk(1, 1, 5)` and `clampOk(5, 1, 5)` are false; both bounds are inclusive.", o, BOUNDS_VECS.length, 60, () => ["TIMEOUT"]);
      assert.notEqual(s.result, "pass");
      for (const p of s.proposals) assert.ok(!(/x >= lo/.test(p[0]!.content) && /x <= hi/.test(p[0]!.content)), "combined an attempt with another failure code");
    },
  },
  {
    id: "evidence near-miss: a request naming nothing, or a symbol defined only in a test file, gets NO_EDIT (no edit anywhere)",
    run(l, ctx) {
      const files = { "src/range.ts": RANGE, "test/helper.test.ts": "export function onlyInTests(a: number) { return a < 1; }\n" };
      const d = repoDir(ctx, files);
      const none = simulate(l, d, files, "The bounds are wrong somewhere; please fix it.", oracleOf("src/range.ts", "inRange", RANGE_VECS), 5);
      assert.equal(none.result, "NO_EDIT");
      assert.equal(none.proposals.length, 0);
      const testOnly = simulate(l, d, files, "`onlyInTests` is off by one.", () => 0, 1);
      assert.equal(testOnly.result, "NO_EDIT");
      assert.equal(testOnly.proposals.length, 0);
    },
  },
  {
    id: "test-path: a symbol defined in both a source and a test file is only ever edited in the source file",
    run(l, ctx) {
      const files = { "src/range.ts": RANGE, "src/range.test.ts": "export function inRange(x: number, lo: number, hi: number): boolean {\n  return x > lo;\n}\n" };
      const d = repoDir(ctx, files);
      const s = simulate(l, d, files, "`inRange` is wrong at the edges.", () => 0, 1, 60);
      assert.ok(s.proposals.length > 0);
      for (const p of s.proposals) for (const e of p) assert.equal(e.path, "src/range.ts");
    },
  },
  {
    id: "generated: a symbol defined in a generated file (dist/, .d.ts) is never edited there",
    run(l, ctx) {
      const files = { "dist/range.ts": RANGE.replace("inRange", "genRange"), "src/use.ts": "export const z = 1;\n" };
      const d = repoDir(ctx, files);
      const s = simulate(l, d, files, "`genRange` is off by one.", () => 0, 1, 60);
      assert.equal(s.result, "NO_EDIT");
      assert.equal(s.proposals.length, 0);
    },
  },
  {
    id: "cap and dedupe: a large function gives at most MAX_CANDIDATES distinct proposals, then NO_MORE_EDITS",
    run(l, ctx) {
      const files = { "src/many.ts": BIG, "src/wrap.ts": "import { many } from \"./many.ts\";\nexport class Box { many(a: number, b: number, c: number) { return many(a, b, c); } }\n" };
      const d = repoDir(ctx, files);
      const s = simulate(l, d, files, "`many` and `Box` give wrong sums; `many` is called by Box.", () => 0, 1, 200);
      assert.equal(s.result, "NO_MORE_EDITS");
      assert.ok(s.proposals.length <= l.prop.MAX_CANDIDATES, `${s.proposals.length} proposals`);
      const keys = s.proposals.map((p) => JSON.stringify(p));
      assert.equal(new Set(keys).size, keys.length, "a repeated proposal");
    },
  },
  {
    id: "dedupe: overlapping located sites (a class and its method) never repeat a proposal",
    run(l, ctx) {
      const files = { "src/acc.ts": "export class Acc {\n  total = 0;\n  add(v: number, w: number) { if (v > w) this.total = this.total + v; return this.total; }\n}\n" };
      const d = repoDir(ctx, files);
      const s = simulate(l, d, files, "`Acc` and `add` drop the value: `add(1, 2)` does not count.", () => 0, 1, 200);
      const keys = s.proposals.map((p) => JSON.stringify(p));
      assert.ok(keys.length >= 3);
      assert.equal(new Set(keys).size, keys.length, "a repeated proposal");
    },
  },
  {
    id: "stop-unsafe: after an attempt with TAMPERED or LEFTOVERS the proposer stops (NO_MORE_EDITS), never another candidate",
    run(l, ctx) {
      const files = { "src/range.ts": RANGE };
      const d = repoDir(ctx, files);
      for (const code of ["TAMPERED", "LEFTOVERS"]) {
        const s = simulate(l, d, files, "`inRange` is wrong at the edges.", () => 0, 5, 20, () => [code]);
        assert.equal(s.result, "NO_MORE_EDITS", code);
        assert.equal(s.proposals.length, 1, code);
      }
    },
  },
  {
    id: "changed / parse: a candidate that changes nothing or does not parse is dropped before it is ever proposed",
    run(l) {
      const files = new Map([["src/a.ts", "export const a = 1;\n"]]);
      const same = l.prop.candidateFor(files, [{ path: "src/a.ts", start: 0, end: 0, text: "", template: "comparison", site: 0 }]);
      assert.equal(same, null);
      const broken = l.prop.candidateFor(files, [{ path: "src/a.ts", start: 17, end: 18, text: "(((", template: "off-by-one", site: 0 }]);
      assert.equal(broken, null);
      const ok = l.prop.candidateFor(files, [{ path: "src/a.ts", start: 17, end: 18, text: "2", template: "off-by-one", site: 0 }]);
      assert.equal(ok?.edits[0]?.content, "export const a = 2;\n");
    },
  },
  {
    id: "search only in prepare: the loop resets the copy first, so the proposer's search never sees the team's tests",
    run(l, ctx) {
      if (!ctx.cand) {
        const r = l.loop.runLoopTask(ctx.task, "public", "a".repeat(64), { root: ctx.root, fetcher: ctx.fetcher, proposer: l.prop.repairProposer(), maxAttempts: 5, runMs: 60_000, env: ctx.env, rules: [], training: new Set<string>() });
        assert.match(r.row.code, /^CAND_UID_/);
        return;
      }
      const seen: string[][] = [];
      const inner = l.prop.repairProposer();
      const spy: Loop.Proposer = { name: inner.name, prepare(search, input) { const t = search.tree(); seen.push(t.ok ? t.files : []); inner.prepare(search, input); }, next: (i) => inner.next(i) };
      const r = l.loop.runLoopTask(ctx.task, "public", "a".repeat(64), { root: ctx.root, fetcher: ctx.fetcher, proposer: spy, maxAttempts: 20, runMs: 60_000, env: ctx.env, rules: [], training: new Set<string>() });
      assert.equal(seen.length, 1);
      assert.ok(!seen[0]!.includes("test/window.test.ts"), "the proposer's search saw the team's test file");
      assert.ok(seen[0]!.includes("src/window.ts"));
      assert.equal(r.row.code, "PASS");
      assert.equal(r.row.proposer, "repair-v1");
      assert.ok(r.row.baseline && r.row.baseline.failing > 0);
    },
  },
  {
    id: "prepare-failed: a proposer whose search throws ends the task as PROPOSER_FAILED (fixed code, no error text); near miss: the same proposer not throwing passes",
    run(l, ctx) {
      const SECRET = "m152-secret-error-text /tmp/should-never-reach-a-row";
      const opts = (proposer: Loop.Proposer) => ({ root: ctx.root, fetcher: ctx.fetcher, proposer, maxAttempts: 20, runMs: 60_000, env: ctx.env, rules: [], training: new Set<string>() });
      const throwing = (fail: boolean): Loop.Proposer => {
        const inner = l.prop.repairProposer();
        // the search itself runs first, so without the guard the loop would go on and pass
        return { name: inner.name, prepare(search, input) { inner.prepare(search, input); if (fail) throw new Error(SECRET); }, next: (i) => inner.next(i) };
      };
      if (!ctx.cand) {
        assert.match(l.loop.runLoopTask(ctx.task, "public", "a".repeat(64), opts(throwing(true))).row.code, /^CAND_UID_/);
        return;
      }
      const bad = l.loop.runLoopTask(ctx.task, "public", "a".repeat(64), opts(throwing(true)));
      assert.equal(bad.row.code, "PROPOSER_FAILED");
      assert.equal(bad.row.result, "refused");
      assert.equal(bad.row.attempts, 0);
      assert.ok(bad.row.baseline && bad.row.baseline.failing > 0, "the baseline still ran and is recorded");
      assert.equal(loopRowProblem(bad.row), null);
      assert.ok(!JSON.stringify(bad.row).includes("m152-secret"), "the error text reached the row");
      const { runner: _r, deps: _d, baseline: _b, planner: _p, plannerSha256: _ps, modelManifestSha256: _ms, ...v1 } = bad.row;
      assert.equal(loopRowProblem({ ...v1, schema: "peaceai-plan-loop:v1", loop: "loop-v1" } as never), "code", "v1 rows cannot carry PROPOSER_FAILED");
      assert.equal(loopRowProblem({ ...v1, code: "NO_EDIT", schema: "peaceai-plan-loop:v1", loop: "loop-v1" } as never), null, "near miss: the same v1 row with a v1 code validates");
      // near miss: the same proposer, not throwing
      assert.equal(l.loop.runLoopTask(ctx.task, "public", "a".repeat(64), opts(throwing(false))).row.code, "PASS");
    },
  },
  {
    id: "sha-proposer: loopSha256 binds editpropose.ts (a changed proposer gives a new hash); near miss: a file outside the loop does not",
    run(l, ctx) {
      const root = join(ctx.base, "sha-root");
      mkdirSync(join(root, "peaceai/lib"), { recursive: true });
      for (const f of ["loop.ts", "looprow.ts", "loopdeps.ts", "editpropose.ts", "modelpropose.ts", "codesearch.ts"]) copyFileSync(join(l.loop.ROOT, "peaceai/lib", f), join(root, "peaceai/lib", f));
      const h0 = l.loop.loopSha256(root);
      assert.match(h0, /^[0-9a-f]{64}$/);
      // near miss: a file the loop row does not bind
      writeFileSync(join(root, "peaceai/lib/codesearch.ts"), readFileSync(join(root, "peaceai/lib/codesearch.ts"), "utf8") + "\n// changed\n");
      assert.equal(l.loop.loopSha256(root), h0, "a file outside the loop changed the hash");
      writeFileSync(join(root, "peaceai/lib/editpropose.ts"), readFileSync(join(root, "peaceai/lib/editpropose.ts"), "utf8") + "\n// changed\n");
      assert.notEqual(l.loop.loopSha256(root), h0, "a changed edit proposer kept the same loopSha256");
    },
  },
];
