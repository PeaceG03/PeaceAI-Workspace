// M198 PLAN-ONLY v5 symptom-to-cause trace (Batch 34, peaceai/spec/plan-only-v5.md "Batch 34"). Checked here: every
// trace admit case and refused near miss (m198-cases.ts) on two module styles (BILLING: a class-based TypeScript ESM
// service in a pnpm + jest workspace; ETL: a functional CommonJS pipeline in a flat npm + vitest package); every
// M194/M195 case still holds with the trace on; each tagged `rule:trace-*` line has admit cases, near misses and a
// mutant that removes the guard (plus loosening mutants), and every mutant fails a case of its own condition; a
// generality check on the M198 fixtures; v4 stays the default and byte-identical, v5 stays unselectable, plandefault.ts
// unchanged. Offline.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test, { after } from "node:test";
import { pathToFileURL } from "node:url";
import { approvedRules, type PlanTaskFile } from "../lib/plan.ts";
import * as plan5 from "../lib/plan5.ts";
import { DEFAULT_PLANNER, selectPlanner } from "../lib/plandefault.ts";
import { plannerSha256V4 } from "../lib/plan4run.ts";
import { loadModel } from "../lib/nlparse.ts";
import { CASES_V5, type CaseCtx, type V5Module } from "./m194-cases.ts";
import { CASES_V5_REPORT } from "./m195-cases.ts";
import { CASES_V5_TRACE } from "./m198-cases.ts";

const repo = resolve(import.meta.dirname, "..", "..");
const libDir = join(repo, "peaceai/lib");
const source = readFileSync(join(libDir, "plan5.ts"), "utf8");
const ctx: CaseCtx = { rules: approvedRules(repo), model: loadModel() };
const TAGS = ["trace-can-fail", "trace-caught", "trace-condition", "trace-delegate", "trace-delegate-all", "trace-depends", "trace-depth", "trace-not-planned", "trace-own-body", "trace-plan-cause", "trace-resolve-import", "trace-resolve-this", "trace-rethrow", "trace-same-package", "trace-unique", "trace-workspace-name"];
/** Style-specific: `this.m()` exists only in the class-based shape. Every other trace rule needs admits on both shapes. */
const ONE_SHAPE = new Set(["trace-resolve-this"]);
const ALL = [...CASES_V5, ...CASES_V5_REPORT, ...CASES_V5_TRACE];

/** One or more mutants per tagged trace rule; the first for each removes the guard. `find` must occur once in plan5.ts. */
const MUTANTS: { id: string; find: string; replace: string }[] = [
  { id: "trace-resolve-this", find: "if (ts.isPropertyAccessExpression(callee) && callee.expression.kind === ts.SyntaxKind.ThisKeyword) { // rule:trace-resolve-this", replace: "if (Date.now() < 0) {" },
  { id: "trace-workspace-name", find: "return env.pkgNames.some((n) => spec === n || spec!.startsWith(`${n}/`)) ? { kind: \"cross\", key: spec } : opaque; // rule:trace-workspace-name", replace: "return opaque;" },
  { id: "trace-resolve-import", find: "const target = resolveRelative(env.files, sf.fileName, spec); // rule:trace-resolve-import", replace: "const target = null as string | null;" },
  { id: "trace-can-fail", find: "(p) => p.kind === \"cross\" || (p.kind === \"fn\" ? canFail(p.fn) : false)); // rule:trace-can-fail", replace: "(p) => p.kind !== \"opaque\");" },
  { id: "trace-caught", find: "if (ts.isTryStatement(node)) return caughtTrace(tryCalls(node.tryBlock)); // rule:trace-caught", replace: "if (ts.isTryStatement(node)) return \"TRACE_NO_CONDITION\";" },
  { id: "trace-caught", find: "if (ts.isTryStatement(node)) return caughtTrace(tryCalls(node.tryBlock)); // rule:trace-caught", replace: "if (ts.isTryStatement(node)) return fromCalls(\"caught\", tryCalls(node.tryBlock).filter((x) => resolveCall(env, sf, x).kind !== \"opaque\"), () => true);" },
  { id: "trace-condition", find: "if (!cond && ts.isIfStatement(p) && cur !== p.expression) cond = p.expression; // rule:trace-condition", replace: "" },
  { id: "trace-rethrow", find: "if (!tryStmt && ts.isCatchClause(p)) tryStmt = p.parent; // rule:trace-rethrow", replace: "" },
  { id: "trace-rethrow", find: "if (!tryStmt && ts.isCatchClause(p)) tryStmt = p.parent; // rule:trace-rethrow", replace: "if (!tryStmt && ts.isTryStatement(p)) tryStmt = p;" },
  { id: "trace-depends", find: "if (valued && valued.producers.length > 0) return valued; // rule:trace-depends", replace: "" },
  { id: "trace-depends", find: "if (c && !out.includes(c)) out.push(c);", replace: "if (c && !out.includes(c)) out.push(c);\n      if (!c && ts.isCallExpression(x.parent) && !out.includes(x.parent)) out.push(x.parent);" },
  { id: "trace-delegate-all", find: "if (!call) return null; // rule:trace-delegate-all", replace: "if (!call) continue;" },
  { id: "trace-unique", find: "if (first.producers.length > 1) return { ...out, stop: \"TRACE_AMBIGUOUS\" }; // rule:trace-unique", replace: "" },
  { id: "trace-depth", find: "if (hop > MAX_TRACE_HOPS) return { ...out, stop: \"TRACE_DEPTH\" }; // rule:trace-depth", replace: "" },
  { id: "trace-depth", find: "if (hop > MAX_TRACE_HOPS) return { ...out, stop: \"TRACE_DEPTH\" }; // rule:trace-depth", replace: "if (hop > MAX_TRACE_HOPS + 1) return { ...out, stop: \"TRACE_DEPTH\" };" },
  { id: "trace-same-package", find: "if (p.kind === \"cross\" || packageDirOf(env.all, p.fn.path) !== own) return { ...out, stop: \"TRACE_CROSS_PACKAGE\" }; // rule:trace-same-package", replace: "if (p.kind === \"cross\") return { ...out, stop: \"TRACE_CROSS_PACKAGE\" };" },
  { id: "trace-not-planned", find: "if (planned.has(key) || out.causes.some((c) => `${c.path}#${c.symbol}` === key)) return { ...out, stop: hop === 1 ? \"TRACE_ALREADY_PLANNED\" : null }; // rule:trace-not-planned", replace: "if (out.causes.some((c) => `${c.path}#${c.symbol}` === key)) return out;" },
  { id: "trace-delegate", find: "const next = delegate(env, p.fn); // rule:trace-delegate", replace: "const next = null as ReturnType<typeof delegate>;" },
  { id: "trace-own-body", find: "const visit = (x: ts.Node): void => { f(x); if (!ts.isFunctionLike(x)) ts.forEachChild(x, visit); }; // rule:trace-own-body", replace: "const visit = (x: ts.Node): void => { f(x); ts.forEachChild(x, visit); };" },
  { id: "trace-plan-cause", find: "for (const { c, code: k } of causesOf(s.path)) { // rule:trace-plan-cause", replace: "for (const { c, code: k } of [] as ReturnType<typeof causesOf>) {" },
  { id: "trace-plan-cause", find: "if (stepped.has(`${c.path}#${c.symbol}`) || (!known", replace: "if ((!known" },
];

const dir = mkdtempSync(join(tmpdir(), "peaceai-m198-mut-"));
after(() => rmSync(dir, { recursive: true, force: true }));
const tsUrl = pathToFileURL(createRequire(join(repo, "package.json")).resolve("typescript")).href;
const absImports = (text: string) => text.replace(/from "\.\/([\w-]+\.ts)"/g, (_m, f: string) => `from ${JSON.stringify(pathToFileURL(join(libDir, f)).href)}`).replace('from "typescript"', `from ${JSON.stringify(tsUrl)}`);

test("M198: every trace admit case and refused near miss holds, and every M194/M195 case still holds with the trace on", () => {
  for (const c of ALL) c.run(plan5, ctx);
});

test("M198: each tagged trace rule has admit cases (both shapes unless style-specific), a refused near miss and a removing mutant", () => {
  const tags = [...new Set([...source.matchAll(/\/\/ rule:(trace-[a-z0-9-]+)/g)].map((m) => m[1]!))].sort();
  assert.deepEqual(tags, TAGS);
  for (const t of TAGS) {
    assert.ok(MUTANTS.some((m) => m.id === t), `rule ${t} has no mutant`);
    const admits = new Set(CASES_V5_TRACE.filter((c) => c.condition === t && c.kind === "admit").map((c) => c.shape));
    assert.equal(admits.size, ONE_SHAPE.has(t) ? 1 : 2, `rule ${t} admit shapes`);
    assert.ok(CASES_V5_TRACE.some((c) => c.condition === t && c.kind === "refuse"), `rule ${t} needs a refused near miss`);
  }
  for (const c of CASES_V5_TRACE) assert.ok(TAGS.includes(c.condition), c.id);
  // the refusal vocabulary the near misses exercise: ambiguous, cross-package (both ways), depth, independent condition
  const src = readFileSync(join(repo, "peaceai/test/m198-cases.ts"), "utf8");
  for (const stop of ["TRACE_AMBIGUOUS", "TRACE_CROSS_PACKAGE", "TRACE_DEPTH", "TRACE_INDEPENDENT", "TRACE_NO_CONDITION", "TRACE_UNRESOLVED", "TRACE_ALREADY_PLANNED"]) assert.ok(src.includes(stop), stop);
});

test("M198 mutation: each tagged trace guard removed (or loosened) fails a case of its own condition", async () => {
  let n = 0;
  for (const m of MUTANTS) {
    assert.equal(source.split(m.find).length - 1, 1, `mutant ${m.id}: anchor text must occur once in plan5.ts`);
    const file = join(dir, `mutant-${m.id}-${n++}.ts`);
    writeFileSync(file, absImports(source.replace(m.find, () => m.replace)));
    const mod = (await import(pathToFileURL(file).href)) as V5Module;
    const failed: string[] = [];
    for (const c of ALL) { try { c.run(mod, ctx); } catch (e) { if (e instanceof assert.AssertionError) failed.push(c.id); else throw new Error(`mutant ${m.id} #${n - 1} crashed on ${c.id}: ${String(e)}`); } }
    assert.ok(CASES_V5_TRACE.some((c) => c.condition === m.id && failed.includes(c.id)), `mutant ${m.id} #${n - 1}: no ${m.id} case fails (${failed.join(", ")})`);
  }
});

test("M198 generality: the trace fixtures and cases name no task, task repository, task file or Peace project", () => {
  const pub = JSON.parse(readFileSync(join(repo, "peaceai/plan/tasks-public-v1.json"), "utf8")) as PlanTaskFile;
  const words = new Set<string>(["peacestocks", "stocks", "scanner", "markets", "ticker", "daily_bars", "r2_put", "corporate_actions", "stop_chain", "trading", "universe", "object-store"]);
  for (const t of pub.tasks) {
    words.add(t.id.toLowerCase());
    for (const part of t.repo.toLowerCase().split("/")) if (part.length >= 4) words.add(part);
    for (const f of [...t.reference.files.map((x) => x.path), ...t.tests.files]) if (f.split("/").length >= 2) words.add(f.toLowerCase());
  }
  for (const f of ["peaceai/test/m198-fixtures.ts", "peaceai/test/m198-cases.ts", "peaceai/lib/plan5.ts"]) {
    const lower = readFileSync(join(repo, f), "utf8").toLowerCase();
    for (const w of words) assert.ok(!new RegExp(String.raw`(?<![a-z0-9])${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![a-z0-9])`).test(lower), `${f} mentions ${w}`);
  }
});

test("M198 wiring: v4 stays the default and byte-identical, v5 stays unselectable, plandefault.ts unchanged", () => {
  assert.equal(DEFAULT_PLANNER, "plan-only-v4");
  assert.equal(selectPlanner("v5"), null);
  assert.equal(selectPlanner("plan-only-v5"), null);
  assert.equal(plannerSha256V4(), "b667d518936d28723e4c6eecf12fd9d784febbf22804a3622362819f604c2c7c");
  assert.equal(createHash("sha256").update(readFileSync(join(libDir, "plandefault.ts"))).digest("hex"), "68b6d51973fb66afad71224fbb1dada638daa56dcaa39374267ca1ba1c91c1cb");
  assert.equal(plan5.MAX_TRACE_HOPS, 2);
});
