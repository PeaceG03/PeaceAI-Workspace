// M174 (batch 13) behavior cases, as data so m174-mutation.test.ts can replay them against each mutant of
// editpropose.ts / loop.ts / looprow.ts. Spec: peaceai/spec/load-diagnostics-m174.md.
//   1. load diagnostics (lib/loop.ts loadDiagnostics): filtered TypeScript codes for a team test that imports a name a relative
//      source module does not export (MISSING_EXPORT) or a relative module that does not exist (MISSING_MODULE);
//   2. repair-v2's load-repair candidate (lib/editpropose.ts): export an existing declaration (one inserted keyword
//      token per site); never a new body, statement or import (load-reexport was dropped: outside the single-token scope);
//   2b. the loop's L0 edit gate (lib/loop.ts loadEditProblem): a load-repair proposal outside that shape is refused
//      before anything runs (forging cases: an added import, a new file, a config or test edit);
//   3. the loop (lib/loop.ts, looprow.ts): only a SUITE_LOAD baseline, only for a load-repair proposer, only with a
//      MISSING_EXPORT goes on (row baselineLoad); every other baseline that proved nothing refuses as before, and PASS
//      still needs an attempt with no failure code (a suite that still does not load never passes).
// Every fixture is synthetic and unrelated to any public dev task or reference diff: an inventory restock helper, a
// shapes barrel, a palette module, a calendar helper, a unit-price table, a week calendar class. Admitting shapes
// (end to end): a module-local inventory function and a module-local week class; unit also an enum and a const.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { availableParallelism, loadavg } from "node:os";
import { dirname, join } from "node:path";
import type * as Propose from "../lib/editpropose.ts";
import type * as Loop from "../lib/loop.ts";
import type * as Row from "../lib/looprow.ts";
import { MIT, pkgJson, type Ctx as Ctx151 } from "./m151-fixtures.ts";

export interface Libs { diag: typeof Loop; propose: typeof Propose; loop: typeof Loop; row: typeof Row }
export interface Ctx { m151: Ctx151; scratch: string }
export interface Case { id: string; needsCand?: boolean; run(l: Libs, ctx: Ctx): void }

const put = (dir: string, files: Record<string, string>) => { for (const [p, c] of Object.entries(files)) { mkdirSync(dirname(join(dir, p)), { recursive: true }); writeFileSync(join(dir, p), c); } };
let seq = 0;
const tree = (ctx: Ctx, files: Record<string, string>): string => { const d = join(ctx.scratch, `t-${seq++}`); put(d, files); return d; };
const diags = (l: Libs, ctx: Ctx, files: Record<string, string>, tests: string[], team?: string[]) => l.diag.loadDiagnostics(tree(ctx, files), tests, team ? new Set(team) : undefined);
const brief = (ds: readonly Loop.LoadDiag[]) => ds.map((d) => `${d.kind} ${d.module} ${d.name}`.trimEnd());

// ---- shape A: an inventory module whose restock helper is module-local
export const STOCK = "const SAFETY = 2;\n\nfunction restockLevel(onHand, daily) {\n  return Math.max(0, daily * 7 + SAFETY - onHand);\n}\n\nexport function inStock(onHand) {\n  return onHand > 0;\n}\n";
export const STOCK_TEST = 'import assert from "node:assert/strict";\nimport { inStock, restockLevel } from "../src/stock.ts";\n\ntest("restock to a week of sales", () => assert.equal(restockLevel(5, 2), 11));\ntest("empty shelf", () => assert.equal(inStock(0), false));\n';
// ---- shape B: a shapes barrel that re-exports one module and misses another
const SHAPES = {
  "src/index.ts": 'export { circleArea } from "./circle.ts";\n',
  "src/circle.ts": "export function circleArea(r) {\n  return Math.PI * r * r;\n}\n",
  "src/square.ts": "export function squareArea(side) {\n  return side * side;\n}\n",
};
const SHAPES_TEST = 'import assert from "node:assert/strict";\nimport { circleArea, squareArea } from "../src/index.ts";\n\ntest("unit square", () => assert.equal(squareArea(1), 1));\ntest("circle of radius 0", () => assert.equal(circleArea(0), 0));\n';
// ---- shape C: a week calendar whose class is module-local
const WEEK = "class Week {\n  start: number;\n  constructor(start: number) {\n    this.start = start;\n  }\n  dayAt(i: number): number {\n    return (this.start + i) % 7;\n  }\n}\n\nexport function isWeekend(d: number): boolean {\n  return d === 0 || d === 6;\n}\n";
const WEEK_TEST = 'import assert from "node:assert/strict";\nimport { Week, isWeekend } from "../src/week.ts";\n\ntest("wraps past saturday", () => assert.equal(new Week(5).dayAt(3), 1));\ntest("sunday is weekend", () => assert.equal(isWeekend(0), true));\n';

// ---- the loop, end to end (candidate uid): small vitest-stub repos built from the M151 stub runner and stub package manager
const VITEST_LOCK = JSON.stringify({ name: "fixture", lockfileVersion: 3, requires: true, packages: { "": { name: "fixture", devDependencies: { vitest: "1.0.0" } } } }, null, 1) + "\n";
const G = ["-c", "user.name=PeaceG03", "-c", "user.email=301894882+PeaceG03@users.noreply.github.com", "-c", "commit.gpgsign=false"];
export function e2eTask(ctx: Ctx, name: string, src: Record<string, string>, teamTest: string) {
  const dir = join(ctx.m151.base, "repos", name);
  const git = (...a: string[]) => execFileSync("git", [...G, ...a], { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  mkdirSync(dir, { recursive: true });
  git("init", "-q", "-b", "main");
  put(dir, { "package.json": pkgJson({ test: "vitest run" }, { vitest: "1.0.0" }), "package-lock.json": VITEST_LOCK, LICENSE: MIT, ...src });
  git("add", "-A"); git("commit", "-q", "-m", "base");
  execFileSync("chmod", ["-R", "a+rX", dir]);
  const commit = git("rev-parse", "HEAD");
  const first = Object.keys(src).sort()[0]!;
  put(dir, { [first]: src[first]! + "// reference\n", "test/unit.test.ts": teamTest }); git("add", "-A"); git("commit", "-q", "-m", "reference");
  return { ...ctx.m151.vitest, id: `m174-${name}`.slice(0, 40), repo: `m151-fixture/${name}`, commit,
    request: `Make the team tests in test/unit.test.ts pass (${first}).`,
    tests: { command: "vitest run", files: ["test/unit.test.ts"] },
    reference: { from: { pr: 1, merge: git("rev-parse", "HEAD") }, files: [{ path: first, change: "modify" as const }, { path: "test/unit.test.ts", change: "add" as const }],
      steps: [{ action: "edit-source" as const, file: first }, { action: "add-test" as const, file: "test/unit.test.ts" }, { action: "run-tests" as const, file: null }], docs: [] } };
}
/** Batch 16: the load factor (1..3) for a loop e2e run on a shared box: the 1-minute load average per CPU, bounded. The
 *  real loop's run timeout (60 s) and m174-mutation's runner cap scale by it, so a run slowed by other sessions' load is
 *  not cut off; a bound keeps a hang a hang. */
export const E2E_LOAD = Math.min(3, Math.max(1, Math.round((loadavg()[0]! / Math.max(1, availableParallelism())) * 10) / 10));
export const opts = (ctx: Ctx, proposer: Loop.Proposer, maxAttempts = 1) => ({
  root: ctx.m151.root, fetcher: ctx.m151.fetcher, proposer, maxAttempts, runMs: Math.round(60_000 * E2E_LOAD), env: ctx.m151.env, rules: [], training: new Set<string>(),
  deps: { tool: ctx.m151.tool, extraEnv: { M151_STUB_VITEST_DIR: ctx.m151.stubVitest } },
});
const loopRun = (l: Libs, ctx: Ctx, name: string, src: Record<string, string>, test: string, p: Loop.Proposer, max = 1) =>
  l.loop.runLoopTask(e2eTask(ctx, `${name}-${seq++}`, src, test) as never, "public", "a".repeat(64), opts(ctx, p, max) as never);
const v2 = (l: Libs) => l.propose.repairProposer({ v2: true }) as unknown as Loop.Proposer;

// ---- a valid v4 public row to vary
function row(l: Libs, over: Record<string, unknown>): Record<string, unknown> {
  return {
    schema: l.row.LOOP_SCHEMA_V4, at: "2026-11-02T22:00:00Z", set: "public", taskFileSha256: "a".repeat(64), taskKey: "0123456789abcdef",
    repo: "example/inventory", commit: "b".repeat(40), workspace: "c".repeat(40), loop: l.row.LOOP_VERSION_V2, loopSha256: "d".repeat(64),
    proposer: "repair-v2", lm: "not-loadable", code: "PASS", maxAttempts: 2, attempts: 1, result: "pass",
    attemptCodes: [[]], tests: { total: 2, passedByPeaceAI: 2, filledByTeam: 0 }, runner: "vitest", deps: "npm",
    baseline: { total: 1, passing: 0, failing: 1 }, planner: "plan-only-v4", plannerSha256: "e".repeat(64), modelManifestSha256: null, baselineLoad: "MISSING_EXPORT", ...over,
  };
}

export const CASES: readonly Case[] = [
  // ---- 1. load diagnostics
  {
    id: "diag: admits a module-local name (TS2459), an absent name (TS2305) and a missing relative module (TS2307), inventory shape",
    run(l, ctx) {
      const t = STOCK_TEST.replace('import { inStock, restockLevel } from "../src/stock.ts";', 'import { inStock, restockLevel, reorderDate } from "../src/stock.ts";\nimport { label } from "../src/labels.ts";');
      assert.deepEqual(brief(diags(l, ctx, { "src/stock.ts": STOCK, "test/unit.test.ts": t }, ["test/unit.test.ts"])), ["MISSING_EXPORT src/stock.ts reorderDate", "MISSING_EXPORT src/stock.ts restockLevel", "MISSING_MODULE src/labels.ts"]);
      assert.deepEqual(diags(l, ctx, { "src/stock.ts": STOCK, "test/unit.test.ts": STOCK_TEST }, ["test/unit.test.ts"]), [{ kind: "MISSING_EXPORT", test: "test/unit.test.ts", module: "src/stock.ts", name: "restockLevel", spec: "../src/stock.ts" }]);
      assert.deepEqual(diags(l, ctx, { "src/stock.ts": "export " + STOCK.replace("\nfunction", "\nexport function"), "test/unit.test.ts": STOCK_TEST }, ["test/unit.test.ts"]), [], "near miss: every name exported");
    },
  },
  {
    id: "diag: admits a barrel that does not re-export a name (shapes shape, .js specifiers resolve to .ts sources)",
    run(l, ctx) {
      const files = { ...SHAPES, "src/index.ts": 'export { circleArea } from "./circle.js";\n', "test/unit.test.ts": SHAPES_TEST.replace("../src/index.ts", "../src/index.js") };
      assert.deepEqual(brief(diags(l, ctx, files, ["test/unit.test.ts"])), ["MISSING_EXPORT src/index.ts squareArea"]);
      assert.deepEqual(brief(diags(l, ctx, { ...SHAPES, "test/unit.test.ts": SHAPES_TEST }, ["test/unit.test.ts"])), ["MISSING_EXPORT src/index.ts squareArea"]);
    },
  },
  {
    id: "diag: near misses are dropped: type-only imports, package imports, test / team / declaration / js modules, escaping paths, string names",
    run(l, ctx) {
      const base = { "src/palette.ts": "export const red = '#f00';\n", "src/vendor.d.ts": "export declare const blue: string;\n", "src/legacy.js": "export const green = 1;\n", "src/fixture-data.ts": "export const rows = [];\n", "test/helpers.ts": "export function mk() {}\n" };
      const one = (imp: string, team?: string[]) => brief(diags(l, ctx, { ...base, "test/unit.test.ts": `${imp}\n` }, ["test/unit.test.ts"], team));
      assert.deepEqual(one('import { teal } from "../src/palette.ts";'), ["MISSING_EXPORT src/palette.ts teal"], "the admitted form, for contrast");
      assert.deepEqual(one('import type { Teal } from "../src/palette.ts";'), [], "import type (m174-guard:type-only)");
      assert.deepEqual(one('import { type Teal } from "../src/palette.ts";'), [], "a type-only name (m174-guard:type-only-name)");
      assert.deepEqual(one('import { teal } from "color-pkg";'), [], "a package (m174-guard:relative)");
      assert.deepEqual(one('import { mk2 } from "./helpers.ts";'), [], "a test helper (m174-guard:module-not-test)");
      assert.deepEqual(one('import { cols } from "../src/fixture-data.ts";', ["test/unit.test.ts", "src/fixture-data.ts"]), [], "a team file (m174-guard:module-not-team)");
      assert.deepEqual(one('import { cols } from "../src/fixture-data.ts";', ["test/unit.test.ts"]), ["MISSING_EXPORT src/fixture-data.ts cols"], "near miss of the team rule: the same module, not a team file");
      assert.deepEqual(one('import { cyan } from "../src/vendor";'), [], "resolves to the declaration file (m174-guard:module-source)");
      assert.deepEqual(one('import { teal } from "../src/legacy.js";'), [], "a .js module (m174-guard:module-source)");
      assert.deepEqual(one('import { far } from "../../outside.ts";'), [], "escapes the copy (m174-guard:module-lex-inside)");
      assert.deepEqual(one('import { "not-an-ident" as x } from "../src/palette.ts";'), [], "a string import name (m174-guard:name-ident)");
    },
  },
  {
    id: "diag: a module that star-exports something outside the copy is opaque (calendar shape), one star level and two",
    run(l, ctx) {
      const t = { "test/unit.test.ts": 'import { nextMonday } from "../src/cal.ts";\n' };
      assert.deepEqual(brief(diags(l, ctx, { "src/cal.ts": 'export * from "date-pkg";\nexport const DAYS = 7;\n', ...t }, ["test/unit.test.ts"])), [], "m174-guard:star-opaque / star-unknown");
      assert.deepEqual(brief(diags(l, ctx, { "src/cal.ts": 'export * from "./inner.ts";\n', "src/inner.ts": 'export * from "date-pkg";\n', ...t }, ["test/unit.test.ts"])), [], "two levels");
      assert.deepEqual(brief(diags(l, ctx, { "src/cal.ts": 'export * from "./inner.ts";\n', "src/inner.ts": "export const DAYS = 7;\n", ...t }, ["test/unit.test.ts"])), ["MISSING_EXPORT src/cal.ts nextMonday"], "near miss: the star target is in the copy");
    },
  },
  {
    id: "diag: at most MAX_LOAD_DIAGS, sorted (m174-guard:cap)",
    run(l, ctx) {
      const names = Array.from({ length: 25 }, (_, i) => `price${String(i).padStart(2, "0")}`);
      const d = diags(l, ctx, { "src/prices.ts": "export const base = 1;\n", "test/unit.test.ts": `import { ${names.join(", ")} } from "../src/prices.ts";\n` }, ["test/unit.test.ts"]);
      assert.equal(d.length, l.diag.MAX_LOAD_DIAGS);
      assert.deepEqual(d.map((x) => x.name), names.slice(0, l.diag.MAX_LOAD_DIAGS));
    },
  },
  {
    id: "diag: the compiler host reads only regular files inside the copy, never under node_modules (also by a link), plus TypeScript's lib",
    run(l, ctx) {
      const d = tree(ctx, { "src/a.ts": "export const a = 1;\n", "node_modules/pkg/index.ts": "export const p = 1;\n" });
      const outside = tree(ctx, { "secret.ts": "export const s = 1;\n" });
      symlinkSync(join(outside, "secret.ts"), join(d, "src/link.ts"));
      symlinkSync(join(d, "src"), join(d, "node_modules/srclink"));
      symlinkSync(join(d, "node_modules/pkg/index.ts"), join(d, "src/dep.ts"));
      const h = l.diag.confinedHost(d);
      assert.equal(h.fileExists(join(d, "src/a.ts")), true);
      assert.equal(h.readFile(join(d, "src/a.ts")), "export const a = 1;\n");
      assert.equal(h.fileExists(join(outside, "secret.ts")), false, "outside (m174-guard:host-inside)");
      assert.equal(h.fileExists(join(d, "src/link.ts")), false, "a link out of the copy (m174-guard:host-inside)");
      assert.equal(h.readFile(join(d, "src/link.ts")), undefined);
      assert.equal(h.fileExists(join(d, "node_modules/pkg/index.ts")), false, "node_modules (m174-guard:host-no-modules)");
      assert.equal(h.fileExists(join(d, "src/dep.ts")), false, "a link into node_modules (m174-guard:host-no-modules)");
      assert.equal(h.fileExists(join(d, "node_modules/srclink/a.ts")), false, "node_modules by its lexical path (m174-guard:host-no-modules-lex)");
      assert.equal(h.fileExists(join(d, "src")), false, "a directory is not a file");
      assert.ok(h.getSourceFile(h.getDefaultLibFileName(l.diag.LOAD_OPTIONS), 99 as never), "TypeScript's lib is readable");
    },
  },
  // ---- 2. repair-v2 load-repair candidates
  {
    id: "propose: load-export on a module-local function, class, enum and const (inventory, week shapes); a barrel gets no candidate",
    run(l) {
      const p = l.propose;
      const at = (text: string, name: string) => p.loadExportAt(p.parseSource("src/x.ts", text), name);
      assert.equal(at(STOCK, "restockLevel"), STOCK.indexOf("function restockLevel"));
      assert.equal(at(WEEK, "Week"), 0);
      assert.equal(at("enum Unit { Box, Each }\n", "Unit"), 0);
      assert.equal(at("const LEAD_DAYS = 3;\n", "LEAD_DAYS"), 0);
      const d = (module: string, name: string, spec: string) => ({ kind: "MISSING_EXPORT" as const, test: "test/unit.test.ts", module, name, spec });
      const stock = p.loadCandidates([d("src/stock.ts", "restockLevel", "../src/stock.ts")], new Map([["src/stock.ts", STOCK]]));
      assert.deepEqual(stock.map((c) => c.edits), [[{ path: "src/stock.ts", content: STOCK.replace("\nfunction restockLevel", "\nexport function restockLevel") }]]);
      const week = p.loadCandidates([d("src/week.ts", "Week", "../src/week.ts")], new Map([["src/week.ts", WEEK]]));
      assert.deepEqual(week.map((c) => c.edits), [[{ path: "src/week.ts", content: "export " + WEEK }]]);
      assert.deepEqual([...p.LOAD_TEMPLATES], ["load-export"], "load-reexport is not a template (outside the single-token scope)");
      assert.deepEqual(p.loadCandidates([d("src/index.ts", "squareArea", "../src/index.ts")], new Map(Object.entries(SHAPES))), [], "near miss: a barrel that does not declare the name gets nothing (no re-export is written)");
    },
  },
  {
    id: "propose: load-export near misses (overloads, merged / multi declarations, declare, default, bodiless, listed, namespace)",
    run(l) {
      const p = l.propose;
      const at = (text: string, name: string) => p.loadExportAt(p.parseSource("src/x.ts", text), name);
      assert.equal(at("function f(a: string): string;\nfunction f(a: any) { return a; }\n", "f"), null, "overloads (m174-guard:le-one-decl)");
      assert.equal(at("interface Box { w: number }\ninterface Box { h: number }\n", "Box"), null, "merged (m174-guard:le-one-decl)");
      assert.equal(at("namespace Units { export const m = 1; }\n", "Units"), null, "a namespace (m174-guard:le-kind)");
      assert.equal(at("const lo = 1, hi = 9;\n", "lo"), null, "two declarators (m174-guard:le-single)");
      assert.equal(at("declare function ext(): void;\n", "ext"), null, "declare (m174-guard:le-plain)");
      assert.equal(at("export default function main() {}\n", "main"), null, "default (m174-guard:le-plain)");
      assert.equal(at("function sig(): void\n", "sig"), null, "no body (m174-guard:le-body)");
      assert.equal(at("function inner() {}\nexport { inner as outer };\n", "inner"), null, "already listed under another name (m174-guard:le-not-listed)");
      assert.equal(at("function inner() {}\nexport { other };\nconst other = 1;\n", "inner"), 0, "near miss: a list that does not name it");
    },
  },
  {
    id: "propose: one candidate fixes every missing name (two names, two modules); none when a name has no declaration",
    run(l) {
      const p = l.propose;
      const d = (module: string, name: string) => ({ kind: "MISSING_EXPORT" as const, test: "test/unit.test.ts", module, name, spec: `../${module}` });
      const files = new Map(Object.entries({ "src/stock.ts": STOCK, "src/week.ts": WEEK }));
      const c = p.loadCandidates([d("src/week.ts", "Week"), d("src/stock.ts", "restockLevel"), d("src/stock.ts", "SAFETY")], files);
      assert.equal(c.length, 1);
      assert.deepEqual(c[0]!.edits, [
        { path: "src/stock.ts", content: "export " + STOCK.replace("\nfunction restockLevel", "\nexport function restockLevel") },
        { path: "src/week.ts", content: "export " + WEEK },
      ]);
      assert.deepEqual(p.loadCandidates([d("src/stock.ts", "restockLevel"), d("src/stock.ts", "reorderDate")], files), [], "reorderDate is not declared (m174-guard:lc-all-fixed)");
      assert.deepEqual(p.loadCandidates([{ kind: "MISSING_MODULE", test: "test/unit.test.ts", module: "src/labels.ts", name: "", spec: "../src/labels.ts" }], files), [], "a missing module only (m174-guard:lc-export-only)");
    },
  },
  {
    id: "propose: only repair-v2 is a load-repair proposer (not repair-v1, not a reranked list); it then proposes load candidates only",
    run(l) {
      const p = l.propose;
      assert.equal(p.repairProposer().loadRepair, false);
      assert.equal(p.repairProposer({ v2: true }).loadRepair, true, "m174-guard:lr-v2-only");
      assert.equal(p.repairProposer({ v2: true, order: (q) => [...q] }).loadRepair, false);
      const files = [{ path: "src/stock.ts", content: STOCK }];
      const diag = [{ kind: "MISSING_EXPORT" as const, test: "test/unit.test.ts", module: "src/stock.ts", name: "restockLevel", spec: "../src/stock.ts" }];
      const r = p.repairProposer({ v2: true });
      assert.deepEqual(r.next({ files, attempt: 1, feedback: [], loadDiagnostics: diag }), { edits: [{ path: "src/stock.ts", content: STOCK.replace("\nfunction restockLevel", "\nexport function restockLevel") }], kind: "load-export" });
      assert.deepEqual(r.next({ files, attempt: 2, feedback: [], loadDiagnostics: diag }), { refuse: "NO_MORE_EDITS" });
      assert.deepEqual(p.repairProposer({ v2: true }).next({ files, attempt: 1, feedback: [], loadDiagnostics: [{ ...diag[0]!, name: "reorderDate" }] }), { refuse: "NO_EDIT" });
    },
  },
  // ---- 2b. the loop's L0 edit gate (load-repair mode only)
  {
    id: "gate: a load-repair edit is single `export ` insertions in existing non-test, non-config source files; every wider edit is refused",
    run(l) {
      const g = l.loop;
      const pinned: Record<string, string> = { "src/stock.ts": STOCK, "src/week.ts": WEEK, "vitest.config.ts": "const cfg = {};\nexport default cfg;\n", "src/app.setup.ts": "const ready = true;\n", "test/helpers.ts": "function make() {}\n", "src/stock.js": "function f() {}\n", "src/types.d.ts": "type T = 1;\n" };
      const read = (f: string) => pinned[f] ?? null;
      const ok = STOCK.replace("\nfunction restockLevel", "\nexport function restockLevel");
      // admits: one site; two files with one site each (inventory, week shapes). M175: two sites in ONE file is refused
      // (exactly one insert per edit, before a plain top-level declaration; see m175-cases export-shape)
      assert.equal(g.loadEditProblem([{ path: "src/stock.ts", content: ok }], read), null);
      assert.equal(g.loadEditProblem([{ path: "src/stock.ts", content: "export " + ok }], read), "shape", "M175: two inserts in one edit");
      assert.equal(g.loadEditProblem([{ path: "src/stock.ts", content: ok }, { path: "src/week.ts", content: "export " + WEEK }], read), null);
      assert.equal(g.loadEditShape("export function f() {}\n", "export export function f() {}\n"), false, "M175: an already exported declaration");
      assert.equal(g.loadEditShape("enum E { A }\n", "export enum E { A }\n"), true, "a site whose text starts like the token");
      // near misses, one per condition
      assert.equal(g.loadEditProblem([], read), "empty", "m174-guard:scope-nonempty");
      assert.equal(g.loadEditProblem([{ path: "src/stock.js", content: "export function f() {}\n" }], read), "not-source", "m174-guard:scope-source (.js)");
      assert.equal(g.loadEditProblem([{ path: "src/types.d.ts", content: "export type T = 1;\n" }], read), "not-source", "m174-guard:scope-source (.d.ts)");
      assert.equal(g.loadEditProblem([{ path: "test/helpers.ts", content: "export function make() {}\n" }], read), "test-path", "m174-guard:scope-not-test");
      assert.equal(g.loadEditProblem([{ path: "vitest.config.ts", content: "export const cfg = {};\nexport default cfg;\n" }], read), "infra", "m174-guard:scope-not-infra (runner config)");
      assert.equal(g.loadEditProblem([{ path: "src/app.setup.ts", content: "export const ready = true;\n" }], read), "infra", "m174-guard:scope-not-infra (setup file)");
      assert.equal(g.loadEditProblem([{ path: "src/patch.ts", content: "export const x = 1;\n" }], read), "new-file", "m174-guard:scope-exists");
      // forging shapes: an added import that could patch expect, a new statement, a body change, a joined identifier
      assert.equal(g.loadEditProblem([{ path: "src/stock.ts", content: 'import "./patch.ts";\n' + ok }], read), "shape", "an added import (m174-guard:scope-shape)");
      assert.equal(g.loadEditShape(STOCK, STOCK + "x = 1;\n"), false, "a new statement of the token length");
      assert.equal(g.loadEditShape(STOCK, STOCK.replace("daily * 7", "daily * 70000000")), false, "a body edit of the token length");
      assert.equal(g.loadEditShape("const total = 1;\n", "const totalexport  = 1;\n"), false, "joined to an identifier");
      assert.equal(g.loadEditShape(STOCK, STOCK), false, "unchanged");
      assert.equal(g.loadEditShape("a\n".repeat(30), "export a\n".repeat(21) + "a\n".repeat(9)), false, "many sites");
      assert.equal(g.loadEditShape("a\n".repeat(30), "export a\n" + "a\n".repeat(29)), false, "M175: before a non-declaration statement");
      assert.equal(g.loadEditShape(STOCK, "export default " + STOCK), false, "another token");
    },
  },
  // ---- 3. the loop and its rows
  {
    id: "loop: loadRepairDiags goes on only for SUITE_LOAD, a load-repair proposer and a MISSING_EXPORT",
    run(l) {
      const ex = [{ kind: "MISSING_EXPORT" as const, test: "t", module: "m.ts", name: "n", spec: "./m.ts" }];
      const mod = [{ kind: "MISSING_MODULE" as const, test: "t", module: "m.ts", name: "", spec: "./m.ts" }];
      const f = l.loop.loadRepairDiags;
      assert.deepEqual(f("BASELINE_SUITE_LOAD", { loadRepair: true }, () => ex), ex);
      for (const c of ["BASELINE_NO_REPORT", "NO_TESTS_RAN", "BASELINE_EXIT_ONLY", null] as const) assert.equal(f(c, { loadRepair: true }, () => ex), null, `${c} (m174-guard:lm-suite-load-only)`);
      assert.equal(f("BASELINE_SUITE_LOAD", {}, () => ex), null, "m174-guard:lm-proposer");
      assert.equal(f("BASELINE_SUITE_LOAD", { loadRepair: false }, () => ex), null);
      assert.equal(f("BASELINE_SUITE_LOAD", { loadRepair: true }, () => mod), null, "m174-guard:lm-needs-export");
      assert.equal(f("BASELINE_SUITE_LOAD", { loadRepair: true }, () => []), null);
    },
  },
  {
    id: "rows: baselineLoad is a v4 fixed code on a post-baseline outcome with its baseline; such a row did not reach the team's tests",
    run(l) {
      const p = l.row.loopRowProblem;
      assert.equal(p(row(l, {})), null);
      assert.equal(p(row(l, { code: "ATTEMPT_LIMIT", result: "fail", attempts: 2, attemptCodes: [["SUITE_LOAD", "TEST_FAIL"], ["TEST_FAIL"]], tests: { total: 2, passedByPeaceAI: 1, filledByTeam: 1 } })), null);
      assert.equal(p(row(l, { code: "NO_EDIT", result: "refused", attempts: 0, attemptCodes: [], tests: null })), null);
      const h = row(l, { set: "hidden", runner: null, deps: null, baseline: null }); delete h.repo; delete h.commit;
      assert.equal(p(h), null, "a hidden row keeps the fixed code, no baseline");
      assert.equal(p(row(l, { baselineLoad: "MISSING_MODULE" })), "baseline_load", "m174-guard:row-load-value");
      assert.equal(p(row(l, { code: "BASELINE_SUITE_LOAD", result: "refused", attempts: 0, attemptCodes: [], tests: null })), "baseline_load_code", "m174-guard:row-load-code");
      assert.equal(p(row(l, { code: "BASELINE_PASSES", result: "refused", attempts: 0, attemptCodes: [], tests: null })), "baseline_load_code");
      assert.equal(p(row(l, { code: "NO_EDIT", result: "refused", attempts: 0, attemptCodes: [], tests: null, baseline: null })), "baseline_presence", "m174-guard:row-load-baseline");
      const v3 = row(l, { schema: l.row.LOOP_SCHEMA_V3 }); delete v3.modelManifestSha256;
      assert.equal(p(v3), "loop_keys", "v3 row");
      const r = l.row.reachedTests as (x: unknown) => boolean;
      assert.equal(r(row(l, {})), false, "m174-guard:row-reached-load");
      const plain = row(l, { code: "ATTEMPT_LIMIT", result: "fail", attempts: 2, attemptCodes: [["TEST_FAIL"], ["TEST_FAIL"]], tests: { total: 2, passedByPeaceAI: 1, filledByTeam: 1 } }); delete plain.baselineLoad;
      assert.equal(r(plain), true, "near miss: the same row without baselineLoad");
    },
  },
  {
    id: "loop e2e: a module-local helper the team test imports -> repair-v2 exports it, the suite loads, PASS (inventory shape)",
    needsCand: true,
    run(l, ctx) {
      const r = loopRun(l, ctx, "stock", { "src/stock.ts": STOCK }, STOCK_TEST, v2(l), 2);
      assert.equal(r.row.code, "PASS");
      assert.equal(r.row.baselineLoad, "MISSING_EXPORT");
      assert.deepEqual(r.row.attemptCodes, [[]]);
      assert.deepEqual(r.row.tests, { total: 2, passedByPeaceAI: 2, filledByTeam: 0 });
      assert.equal(l.row.loopRowProblem(r.row), null);
      assert.equal(l.row.reachedTests(r.row), false);
    },
  },
  {
    id: "loop e2e: a module-local class the team test imports -> repair-v2 exports it, PASS (week shape); a barrel missing a re-export -> NO_EDIT",
    needsCand: true,
    run(l, ctx) {
      const r = loopRun(l, ctx, "week", { "src/week.ts": WEEK }, WEEK_TEST, v2(l), 2);
      assert.equal(r.row.code, "PASS");
      assert.equal(r.row.baselineLoad, "MISSING_EXPORT");
      assert.deepEqual(r.row.attemptCodes, [[]]);
      assert.equal(l.row.loopRowProblem(r.row), null);
      const b = loopRun(l, ctx, "shapes", SHAPES, SHAPES_TEST, v2(l), 2);
      assert.equal(b.row.code, "NO_EDIT", "no re-export is written");
      assert.equal(l.row.loopRowProblem(b.row), null);
    },
  },
  {
    id: "loop e2e forging: a load-repair proposal wider than single `export ` insertions is refused before anything runs (m174-guard:scope-gate)",
    needsCand: true,
    run(l, ctx) {
      const ok = STOCK.replace("\nfunction restockLevel", "\nexport function restockLevel");
      const patch = "const g = globalThis as any;\nif (g.expect) g.expect = () => ({ toBe() {}, toEqual() {} });\nexport {};\n";
      const forge = (edits: Loop.Edit[]): Loop.Proposer => ({ name: "forge", loadRepair: true, next: () => ({ edits }) });
      for (const [why, edits] of [
        ["an added import of a patch file", [{ path: "src/stock.ts", content: 'import "./patch.ts";\n' + ok }, { path: "src/patch.ts", content: patch }]],
        ["a new file next to a valid edit", [{ path: "src/stock.ts", content: ok }, { path: "src/patch.ts", content: patch }]],
        ["a config edit", [{ path: "src/stock.ts", content: ok }, { path: "vitest.config.ts", content: "export default {};\n" }]],
      ] as const) {
        const r = loopRun(l, ctx, "stock-forge", { "src/stock.ts": STOCK }, STOCK_TEST, forge(edits as unknown as Loop.Edit[]), 2);
        assert.equal(r.row.code, "PROPOSER_FAILED", why);
        assert.equal(r.row.attempts, 0, `${why}: nothing ran`);
        assert.equal(r.row.baselineLoad, "MISSING_EXPORT");
        assert.equal(l.row.loopRowProblem(r.row), null);
      }
      const fine = loopRun(l, ctx, "stock-fine", { "src/stock.ts": STOCK }, STOCK_TEST, forge([{ path: "src/stock.ts", content: ok }]), 2);
      assert.equal(fine.row.code, "PASS", "near miss: the same proposer with the single-token edit");
    },
  },
  {
    id: "loop e2e near misses: no load-repair proposer, or only a missing module -> BASELINE_SUITE_LOAD as before; nothing asked",
    needsCand: true,
    run(l, ctx) {
      let calls = 0;
      const plain: Loop.Proposer = { name: "count", next: () => { calls++; return { refuse: "NO_EDIT" }; } };
      const a = loopRun(l, ctx, "stock-plain", { "src/stock.ts": STOCK }, STOCK_TEST, plain);
      assert.equal(a.row.code, "BASELINE_SUITE_LOAD");
      assert.equal("baselineLoad" in a.row, false);
      const b = loopRun(l, ctx, "labels", { "src/stock.ts": STOCK.replace("\nfunction", "\nexport function") }, STOCK_TEST.replace("../src/stock.ts", "../src/labels.ts"), { ...plain, loadRepair: true });
      assert.equal(b.row.code, "BASELINE_SUITE_LOAD");
      assert.equal(calls, 0, "the proposer was asked");
      for (const x of [a, b]) assert.equal(l.row.loopRowProblem(x.row), null);
    },
  },
  {
    id: "loop e2e fail-closed: an edit that keeps the suite unloaded is a SUITE_LOAD attempt; a loaded suite with a failing test is no PASS",
    needsCand: true,
    run(l, ctx) {
      let seen: unknown = null;
      const wrong: Loop.Proposer = { name: "wrong", loadRepair: true, next: (i) => { seen = i.loadDiagnostics; return { edits: [{ path: "src/stock.ts", content: "export " + STOCK }] }; } };
      const a = loopRun(l, ctx, "stock-wrong", { "src/stock.ts": STOCK }, STOCK_TEST, wrong);
      assert.equal(a.row.code, "ATTEMPT_LIMIT");
      assert.deepEqual(a.row.attemptCodes, [["SUITE_LOAD", "TEST_FAIL"]]);
      assert.equal(a.row.baselineLoad, "MISSING_EXPORT");
      assert.deepEqual((seen as Loop.LoadDiag[]).map((d) => d.name), ["restockLevel"], "the proposer got the diagnostics");
      const buggy = { "src/stock.ts": STOCK.replace("daily * 7", "daily * 6") };
      const b = loopRun(l, ctx, "stock-buggy", buggy, STOCK_TEST, v2(l), 2);
      assert.equal(b.row.code, "NO_MORE_EDITS");
      assert.deepEqual(b.row.attemptCodes, [["TEST_FAIL"]]);
      for (const x of [a, b]) assert.equal(l.row.loopRowProblem(x.row), null);
    },
  },
];
