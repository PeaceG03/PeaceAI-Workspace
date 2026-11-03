// M177 behavior cases (batch 16) for repair-v2's statement-level edits (peaceai/lib/editpropose.ts stmtMutationsIn:
// copy-guard, delete-statement). As data so m177-mutation.test.ts can replay the pure cases against each mutant. Each
// case throws (node:assert) on failure. Every class is admitted on at least two unrelated code shapes, every m177 guard
// has a refused near miss, and every statement candidate on the admit fixtures is checked against the loop's M175 gate
// (in-body, nothing wider). Fixtures are tiny synthetic repos written for these tests from general bug shapes (a wallet,
// list statistics, a tag list, a capped sum, shipping, a grid, a timer): none is modeled on a dev-split task's code or on
// a reference diff, and none is a PeaceSTOCKS shape. The "tests" are an in-process oracle (the edited module is
// transpiled and called), so the pure cases run anywhere; the end-to-end case (needsCand) runs the real loop and needs
// M177_CAND (no fallback user). Spec: peaceai/spec/repair-v2-m177.md.
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

// M176 runs ONLY as the candidate uid named by M177_CAND (peaceai-cand3 on the box); with none set it asserts the
// fail-closed CAND_UID_* refusal. It never falls back to another batch's candidate user.
const M177_CAND = process.env.M177_CAND ?? "";
export const m177Cand = (): boolean => stage2CandUid({ [STAGE2_CAND_ENV]: M177_CAND }).ok;

export interface Libs { prop: typeof Prop }
export interface Ctx { base: string }
export interface Case { id: string; needsCand?: boolean; run: (l: Libs, ctx: Ctx) => void }

export function setup(): Ctx { return { base: mkdtempSync(join(tmpdir(), "peaceai-m177-")) }; }
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
  vm.runInNewContext(js, { module: mod, exports: mod.exports, Math, Error, TypeError, RangeError }, { timeout: 1000 });
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
/** Statement candidates for a whole file taken as one site: "template: replaced -> new" (a copy shows only what it adds). */
function stmt(l: Libs, text: string, site?: { start: number; end: number }): string[] {
  const sf = l.prop.parseSource("src/x.ts", text);
  return l.prop.stmtMutationsIn(sf, { path: "src/x.ts", name: "x", start: site?.start ?? 0, end: site?.end ?? text.length, tier: 0 }, 0).map((m) => `${m.template}: ${text.slice(m.start, m.end)} -> ${m.text.trim()}`);
}
const only = (got: string[], t: string) => got.filter((g) => g.startsWith(t + ":"));
const has = (got: string[], want: string) => assert.ok(got.includes(want), `missing "${want}" in ${JSON.stringify(got)}`);
const lacks = (got: string[], re: RegExp) => assert.ok(!got.some((g) => re.test(g)), `unexpected ${re} in ${JSON.stringify(got)}`);
const STMT = new Set<string>(["copy-guard", "delete-statement"]);
/** The M175 gate on a candidate: the class the loop would give it before any run (in-body is the only one expected). */
function gate(orig: ReadonlyMap<string, string>, edits: readonly Prop.RepairEdit[]): string {
  const read = (p: string) => orig.get(p) ?? null;
  return loop.editScopeProblem(edits, read, () => false) ?? loop.editScopeOf(edits, read) ?? "none";
}
/** The passing proposal of an admit is a statement template's, and every statement candidate of that site list is in-body. */
function admitted(l: Libs, ctx: Ctx, s: Sim, files: Record<string, string>, request: string, template: string): void {
  assert.equal(s.result, "pass", `${s.result} after ${s.attempts}`);
  const d = repoDir(ctx, files);
  const sites = l.prop.locate(openRepo(d), { request, failing: [] }, l.prop.CALLEE_DEPTH.v2);
  const queue = l.prop.repairCandidates(sites, s.orig, new Set(), true);
  const last = s.proposals.at(-1)!;
  const winner = queue.find((c) => JSON.stringify(c.edits) === JSON.stringify(last));
  assert.ok(winner, "the passing edit is a queue candidate");
  assert.deepEqual(winner.muts.map((m) => m.template), [template]);
  const ss = queue.filter((c) => c.muts.some((m) => STMT.has(m.template)));
  assert.ok(ss.length > 0);
  for (const c of ss) assert.equal(gate(s.orig, c.edits), "in-body", `M175 gate on ${c.muts[0]!.template}`);
  // no regression: every earlier template's candidate comes before every statement candidate (last in TEMPLATES_V2)
  const firstSs = queue.findIndex((c) => c.muts.some((m) => STMT.has(m.template)));
  assert.ok(queue.slice(firstSs).every((c) => c.muts.every((m) => STMT.has(m.template))), "an earlier template's candidate after a statement one");
}

const E2E_ATTEMPTS = 4;

// ---- fixtures (synthetic, general bug shapes)
const WALLET = "export function withdraw(balance: number, amount: number): number {\n  if (amount < 0) throw new RangeError(\"amount must not be negative\");\n  return balance - amount;\n}\nexport function deposit(balance: number, amount: number): number {\n  return balance + amount;\n}\n";
const throwsOn = (f: () => unknown) => { try { f(); return false; } catch { return true; } };
const WALLET_CHECKS: Check[] = [(x) => x.deposit(5, 2) === 7, (x) => throwsOn(() => x.deposit(5, -1)), (x) => x.withdraw(5, 2) === 3, (x) => throwsOn(() => x.withdraw(5, -1))];
const STATS = "export function mean(xs: number[]): number {\n  if (xs.length === 0) return 0;\n  let s = 0;\n  for (const x of xs) s += x;\n  return s / xs.length;\n}\nexport function spread(xs: number[]): number {\n  return Math.max(...xs) - Math.min(...xs);\n}\n";
const STATS_CHECKS: Check[] = [(x) => x.spread([3, 9, 4]) === 6, (x) => x.spread([]) === 0, (x) => x.mean([]) === 0, (x) => x.mean([2, 4]) === 3];
const TAGS = "export function addTag(tags: string[], tag: string): string[] {\n  const out = tags.slice();\n  out.length = 0;\n  out.push(tag);\n  return out;\n}\n";
const TAGS_CHECKS: Check[] = [(x) => JSON.stringify(x.addTag(["a"], "b")) === '["a","b"]', (x) => { const t = ["a"]; x.addTag(t, "b"); return t.length === 1; }, (x) => JSON.stringify(x.addTag([], "c")) === '["c"]'];
const CAPPED = "export function sumPositive(xs: number[]): number {\n  let total = 0;\n  for (const x of xs) {\n    if (x === 0) return total;\n    if (x > 0) total += x;\n  }\n  return total;\n}\n";
const CAPPED_CHECKS: Check[] = [(x) => x.sumPositive([1, 0, 2]) === 3, (x) => x.sumPositive([5, -1, 0, 4]) === 9, (x) => x.sumPositive([0]) === 0];

const admit = (id: string, files: Record<string, string>, request: string, path: string, checks: Check[], template: string, want: RegExp): Case => ({
  id, run(l, ctx) {
    const s = simulate(l, ctx, files, request, path, checks);
    admitted(l, ctx, s, files, request, template);
    assert.match(s.proposals.at(-1)![0]!.content, want);
  },
});

export const CASES: Case[] = [
  // ---- admits: two unrelated shapes per class, each fixed by the class, each candidate in-body under the M175 gate
  admit("copy-guard admit (throw guard, free functions): a deposit that accepts a negative amount gets withdraw's input check", { "src/wallet.ts": WALLET }, "`deposit` accepts a negative amount.", "src/wallet.ts", WALLET_CHECKS, "copy-guard", /deposit\(balance: number, amount: number\): number \{\n {2}if \(amount < 0\) throw new RangeError\("amount must not be negative"\);\n {2}return balance \+ amount;/),
  admit("copy-guard admit (early return, list statistics): a spread of an empty list gets mean's empty check", { "src/stats.ts": STATS }, "`spread` of an empty list is not 0.", "src/stats.ts", STATS_CHECKS, "copy-guard", /spread\(xs: number\[\]\): number \{\n {2}if \(xs\.length === 0\) return 0;\n {2}return Math\.max/),
  admit("delete-statement admit (expression statement): a stray truncation that drops the earlier tags is removed", { "src/tags.ts": TAGS }, "`addTag` loses the earlier tags.", "src/tags.ts", TAGS_CHECKS, "delete-statement", /const out = tags\.slice\(\);\n {2}\n {2}out\.push\(tag\);/),
  admit("delete-statement admit (if statement in a loop body): a spurious early exit is removed", { "src/sum.ts": CAPPED }, "`sumPositive` stops at a zero.", "src/sum.ts", CAPPED_CHECKS, "delete-statement", /for \(const x of xs\) \{\n {4}\n {4}if \(x > 0\) total \+= x;/),
  {
    id: "unit: one small file gives exactly its copies and deletions, in visit order",
    run(l) {
      const text = "function a(n: number) {\n  if (n < 0) return 0;\n  return n;\n}\nfunction b(n: number, o: { k: number }) {\n  o.k = n;\n  o.k++;\n  return o.k;\n}\n";
      assert.deepEqual(stmt(l, text), [
        "delete-statement: if (n < 0) return 0; -> ",
        "copy-guard:  -> if (n < 0) return 0;",
        "delete-statement: o.k = n; -> ",
        "delete-statement: o.k++; -> ",
      ]);
    },
  },
  {
    id: "unit: a guard is the shape `if (c) return|throw ...` with no else (also in a one-statement block); readNames skips property names, keys and types",
    run(l) {
      const sts = (t: string) => l.prop.parseSource("src/x.ts", t).statements;
      assert.deepEqual(sts("if (a) return 1;\nif (a) { throw e; }\nif (a) return 1; else return 2;\nif (a) { f(); return 1; }\nif (a) f();\nwhile (a) return 1;\n").map((s) => l.prop.guardShape(s)), [true, true, false, false, false, false]);
      const names = (t: string) => { const r = l.prop.readNames(sts(t)[0]!); return r ? [...r].sort() : null; };
      assert.deepEqual(names("if (o.size > lim) throw new RangeError({ size: o.size } as unknown as string);\n"), ["RangeError", "lim", "o"]);
      assert.equal(names("if (this.n) return 0;\n"), null);
      assert.equal(names("if (arguments.length) return 0;\n"), null);
      assert.equal(names("if (a) return () => b;\n"), null);
      assert.equal(names("if (await a) return 0;\n"), null);
    },
  },
  // ---- near misses: one per guard (the refused shape next to an admitted one in the same file)
  {
    id: "copy-guard near miss (m177-guard:cg-shape): an if-else, an if with a call, a while are no ingredients; the guard beside them is",
    run(l) {
      const got = only(stmt(l, "function a(n: number) {\n  if (n > 9) return 1; else return 2;\n  if (n > 8) { log(n); return 3; }\n  if (n > 7) return 4;\n}\nfunction b(n: number) {\n  return n;\n}\ndeclare function log(n: number): void;\n"), "copy-guard");
      assert.deepEqual(got, ["copy-guard:  -> if (n > 7) return 4;"]);
    },
  },
  {
    id: "copy-guard near miss (m177-guard:cg-ctx): a guard that reads `this` (or arguments, a function, await) is not copied; a plain one beside it is",
    run(l) {
      const got = only(stmt(l, "class C {\n  lo = 0;\n  a(n: number) {\n    if (n < this.lo) return 0;\n    if (n < 0) return 0;\n    return n;\n  }\n  b(n: number) {\n    return n;\n  }\n}\n"), "copy-guard");
      assert.deepEqual(got, ["copy-guard:  -> if (n < 0) return 0;"]);
    },
  },
  {
    id: "copy-guard near miss (m177-guard:cg-target-kind): a constructor, a setter and a generator get no copy; a method does",
    run(l) {
      const got = only(stmt(l, "function g(n: number) {\n  if (n < 0) return 0;\n  return n;\n}\nclass C {\n  v = 0;\n  constructor(n: number) {\n    this.v = n;\n  }\n  set w(n: number) {\n    this.v = n;\n  }\n  *gen(n: number) {\n    yield n;\n  }\n  m(n: number) {\n    return n;\n  }\n}\n"), "copy-guard");
      assert.deepEqual(got, ["copy-guard:  -> if (n < 0) return 0;"]);
      const sf = l.prop.parseSource("src/x.ts", "x");
      assert.ok(sf);
    },
  },
  {
    id: "copy-guard near misses (m177-guard:cg-dup): a function's own guard is not copied to its top; a function that has the guard already gets none",
    run(l) {
      assert.deepEqual(only(stmt(l, "function a(n: number) {\n  n = n * 2;\n  if (n < 0) return 0;\n  return n;\n}\n"), "copy-guard"), []);
      const got = only(stmt(l, "function a(n: number) {\n  if (n < 0) return 0;\n  return n;\n}\nfunction b(n: number) {\n  if (n < 0) return 0;\n  return n + 1;\n}\nfunction c(n: number) {\n  return n - 1;\n}\n"), "copy-guard");
      // a and b have the guard already; c gets it once (a's and b's are the same text)
      assert.deepEqual(got, ["copy-guard:  -> if (n < 0) return 0;"]);
      const sf = l.prop.parseSource("src/x.ts", "function a(n: number) {\n  if (n < 0) return 0;\n  return n;\n}\nfunction b(n: number) {\n  if (n < 0) return 0;\n  return n + 1;\n}\n");
      assert.deepEqual(l.prop.stmtMutationsIn(sf, { path: "src/x.ts", name: "x", start: 0, end: sf.text.length, tier: 0 }, 0).filter((m) => m.template === "copy-guard"), [], "neither a nor b gets a second copy");
    },
  },
  {
    id: "copy-guard near misses (m177-guard:cg-bound / cg-shadow): a guard reading a name the target cannot see, or one the target re-declares, is not copied; one reading a module constant is",
    run(l) {
      const text = "const MAX = 10;\nfunction a(n: number) {\n  const lim = 5;\n  if (n > lim) return lim;\n  if (n > MAX) return MAX;\n  return n;\n}\nfunction b(n: number) {\n  return n;\n}\nfunction c(n: number) {\n  const MAX = 3;\n  return n + MAX;\n}\n";
      assert.deepEqual(only(stmt(l, text), "copy-guard"), ["copy-guard:  -> if (n > MAX) return MAX;"]);
      // a parameter of another name is no binding either
      assert.deepEqual(only(stmt(l, "function a(n: number) {\n  if (n < 0) return 0;\n  return n;\n}\nfunction b(m: number) {\n  return m;\n}\n"), "copy-guard"), []);
    },
  },
  {
    id: "copy-guard near miss (m177-guard:cg-cap): at most MAX_COPY_GUARDS copies per site",
    run(l) {
      const guards = Array.from({ length: 9 }, (_, i) => `  if (n === ${i + 1}) return ${i};\n`).join("");
      const got = only(stmt(l, `function a(n: number) {\n${guards}  return n;\n}\nfunction b(n: number) {\n  return n;\n}\n`), "copy-guard");
      assert.equal(l.prop.MAX_COPY_GUARDS, 6);
      assert.equal(got.length, 6);
    },
  },
  {
    id: "delete-statement near misses (m177-guard:ds-only / ds-kind / ds-no-else): the only statement, a declaration, a return, an if-else are not deleted; an expression statement beside them is",
    run(l) {
      assert.deepEqual(only(stmt(l, "function a(o: { k: number }) {\n  o.k++;\n}\n"), "delete-statement"), []);
      const got = only(stmt(l, "function a(o: { k: number }, n: number) {\n  const x = o.k;\n  if (n) o.k = 1; else o.k = 2;\n  o.k += x;\n  return o.k;\n}\n"), "delete-statement");
      assert.deepEqual(got, ["delete-statement: o.k += x; -> "]);
    },
  },
  {
    id: "delete-statement near miss (m177-guard:ds-asi): a statement after one without a semicolon is not deleted (the two around it could join); after a `;` or a block it is",
    run(l) {
      const got = only(stmt(l, "function a(o: { k: number; f: (n: number) => void }) {\n  o.k = 1\n  o.k++\n  o.f(2);\n  if (o.k) { o.k = 0 }\n  o.k--;\n}\n"), "delete-statement");
      // `o.k = 1` is first (nothing before it); `o.k++` and `o.f(2);` follow a statement with no `;`; the if follows `;`, `o.k--;` a block
      assert.deepEqual(got, ["delete-statement: o.k = 1 -> ", "delete-statement: if (o.k) { o.k = 0 } -> ", "delete-statement: o.k--; -> "]);
    },
  },
  {
    id: "near miss (m177-guard:stmt-v2-only): repair-v1's candidate list has no statement template and does not fix the wallet fixture",
    run(l, ctx) {
      const s = simulate(l, ctx, { "src/wallet.ts": WALLET }, "`deposit` accepts a negative amount.", "src/wallet.ts", WALLET_CHECKS, false);
      assert.notEqual(s.result, "pass", "repair-v1 passed");
      const d = repoDir(ctx, { "src/wallet.ts": WALLET });
      const sites = l.prop.locate(openRepo(d), { request: "`deposit` accepts a negative amount.", failing: [] }, l.prop.CALLEE_DEPTH.v1);
      assert.ok(!l.prop.repairCandidates(sites, s.orig, new Set(), false).some((c) => c.muts.some((m) => STMT.has(m.template))));
    },
  },
  {
    id: "order: the statement templates are the last v2 templates; repair-v1's list and the earlier v2 order are unchanged",
    run(l) {
      assert.deepEqual([...l.prop.STMT_TEMPLATES], ["copy-guard", "delete-statement"]);
      assert.deepEqual([...l.prop.TEMPLATES_V2], [...l.prop.IDIOM_TEMPLATES, ...l.prop.TEMPLATES, ...l.prop.CONST_TEMPLATES, ...l.prop.SSTUB_TEMPLATES, ...l.prop.STMT_TEMPLATES]);
      assert.deepEqual([...l.prop.TEMPLATES], ["missing-export", "nullish-check", "comparison", "arithmetic", "off-by-one", "logical", "default-value", "null-guard", "negate-condition", "boolean-return"]);
      assert.deepEqual([...l.prop.GUARD_GLOBALS].sort(), ["Array", "Error", "Infinity", "Math", "NaN", "Number", "RangeError", "String", "TypeError", "isFinite", "isNaN", "undefined"]);
    },
  },
  {
    id: "gate: a copied guard that would raise a dangerous word's count is refused by the M175 gate (the gate, not the proposer, is the bound)",
    run(l) {
      const text = "export function a(o: { constructor: unknown }) {\n  if (o.constructor) return 0;\n  return 1;\n}\nexport function b(o: { constructor: unknown }) {\n  return 2;\n}\n";
      const sf = l.prop.parseSource("src/x.ts", text);
      const muts = l.prop.stmtMutationsIn(sf, { path: "src/x.ts", name: "b", start: text.indexOf("export function b"), end: text.length, tier: 0 }, 0).filter((m) => m.template === "copy-guard");
      assert.equal(muts.length, 1, "the proposer offers it (property names are not reads)");
      const c = l.prop.candidateFor(new Map([["src/x.ts", text]]), muts)!;
      assert.match(gate(new Map([["src/x.ts", text]]), c.edits), /^dangerous:constructor/);
    },
  },
  // ---- end to end (candidate uid): the real loop with repair-v2 copies the input check into deposit, the M175 gate
  // admits the inserted statement as in-body before the run, and the PASS row records editScope in-body
  {
    id: "loop e2e: repair-v2 copies withdraw's input check into deposit; the row is a valid PASS with editScope in-body",
    needsCand: true,
    run() {
      const m151 = setup151();
      const scratch = mkdtempSync(join(tmpdir(), "peaceai-m177-e2e-"));
      try {
        const ctx = { m151, scratch };
        const test = 'import assert from "node:assert/strict";\nimport { deposit } from "../src/wallet.ts";\n\ntest("adds", () => assert.equal(deposit(5, 2), 7));\ntest("refuses a negative amount", () => assert.throws(() => deposit(5, -1)));\n';
        const task = { ...e2eTask(ctx, `m177-wallet-${Date.now() % 100000}`, { "src/wallet.ts": WALLET }, test), request: "`deposit` accepts a negative amount." };
        const r = loop.runLoopTask(task as never, "public", "a".repeat(64), { ...opts174(ctx, repairProposer({ v2: true }) as unknown as Loop.Proposer, 6), env: { ...m151.env, [STAGE2_CAND_ENV]: M177_CAND } } as never);
        assert.equal(loopRowProblem(r.row), null, `row valid (${loopRowProblem(r.row)})`);
        if (!m177Cand()) { assert.match(r.row.code, /^CAND_UID_/); return; }
        assert.equal(r.row.code, "PASS", `codes ${JSON.stringify(r.row.attemptCodes)}`);
        assert.equal((r.row as LoopRow).editScope, "in-body");
        assert.equal(r.row.attempts, E2E_ATTEMPTS, "arithmetic and change-identifier first, then copy-guard");
      } finally { teardown151(m151); rmSync(scratch, { recursive: true, force: true }); }
    },
  },
];
