// M149 PLAN-ONLY v2 (peaceai/spec/plan-only-v2.md): the planner's admit cases on two code shapes and a refused near
// miss per condition (m149-cases.ts), a mutation check (each condition removed from a copy of lib/plan2.ts must fail
// at least one case), a generality check (plan2.ts names no task, task repo or project), the can-do claim verified by
// the unchanged grader, and the runner: v1 stays runnable (default: v3, M154) and v2 rows pass the same log validator. Offline.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test, { after } from "node:test";
import { pathToFileURL } from "node:url";
import { approvedRules, PLANNER_VERSION, sha256, type Plan, type PlanTask, type PlanTaskFile } from "../lib/plan.ts";
import * as plan2 from "../lib/plan2.ts";
import { gradePlan, logRowProblem, parseLog, RUN_LOG } from "../lib/plangrade.ts";
import { plannerSha256, runTask, type Checkout, type Fetcher } from "../lib/planrun.ts";
import { plannerSha256V2, runTaskV2 } from "../lib/plan2run.ts";
import { loadModel } from "../lib/nlparse.ts";
import { loadTargets } from "../lib/target.ts";
import { CASES, planOn, type CaseCtx, type PlannerModule } from "./m149-cases.ts";
import { KIT, LICENSE_SHA } from "./m149-fixtures.ts";

const repo = resolve(import.meta.dirname, "..", "..");
const libDir = join(repo, "peaceai/lib");
const source = readFileSync(join(libDir, "plan2.ts"), "utf8");
const ctx: CaseCtx = { rules: approvedRules(repo), model: loadModel(), targetRepo: Object.keys(loadTargets().targets).sort()[0]! };
const H40 = "a".repeat(40);

/** Each mutant removes one condition: `find` must occur exactly once in plan2.ts, so a refactor cannot silently skip it. */
const MUTANTS: { id: string; find: string; replace: string }[] = [
  { id: "ident-home", find: "if (home.length === 1) { add(home[0]!, w, why(`named ${id.name}`)); continue; }", replace: "" },
  { id: "keep-second", find: "x.score >= KEEP_RATIO * pool[0]!.score", replace: "false" },
  { id: "entry-named-list", find: String.raw`export\s*(?:type\s*)?\{[^}]*\}\s*from\s*["']`, replace: String.raw`export[^;]*from\s*["']` },
  { id: "new-test-gate", find: "sources.every((s) => s.entry || !testFor(v, s.anchor, req, relTests, false))", replace: "true" },
  { id: "example-weak", find: "const w = id.example ? 3 : 8;\n    const why = (t: string) => (id.example ? null : t);", replace: "const w = 8;\n    const why = (t: string) => t;" },
  { id: "same-stem-test", find: "cand.set(p, (cand.get(p) ?? 0) + 20)", replace: "cand.has(p) && cand.set(p, cand.get(p)!)" },
  { id: "fallback-needs-tests", find: "if (cand.size === 0 && fallback && req.wantsTests) {", replace: "if (cand.size === 0) {" },
  { id: "can-do-same-file", find: "if (edit && (edit.path === file || (edit.extra ?? []).some((x) => x.path === file))) return { spec, objective };", replace: "if (edit) return { spec, objective };" },
  { id: "run-tests-target", find: "const runnable = Object.prototype.hasOwnProperty.call(loadTargets().targets, ctx.repo);", replace: "const runnable = loadTargets() !== null;" },
  { id: "phrase-most-spelled", find: "if (x.ws.length === most) add(", replace: "add(" },
  { id: "phrase-function", find: "const best = runs.find(", replace: "const best = null && runs.find(" },
  { id: "phrase-specifier", find: "&& need.every((w) => x.ws.includes(w))", replace: "" },
  { id: "phrase-dominance", find: "const pool = located ? ranked.filter((x) => x.phrase) : ranked;", replace: "const pool = ranked;" },
  { id: "pattern-owner", find: "if (req.wantsPattern && ranked.length) {", replace: "if (false) {" },
  { id: "harness-index", find: String.raw`|(?:^|\/)tests?\/index\.[cm]?[jt]sx?$/.test(p) &&`, replace: "/.test(p) &&" },
];

const dir = mkdtempSync(join(tmpdir(), "peaceai-m149-mut-"));
after(() => rmSync(dir, { recursive: true, force: true }));
const absImports = (text: string) => text.replace(/from "\.\/([\w-]+\.ts)"/g, (_m, f: string) => `from ${JSON.stringify(pathToFileURL(join(libDir, f)).href)}`);

test("M149: every admit case and every refused near miss holds on plan2.ts (two code shapes)", () => {
  for (const c of CASES) c.run(plan2 as PlannerModule, ctx);
  assert.ok(CASES.filter((c) => c.kind === "admit").length >= 8 && CASES.filter((c) => c.kind === "refuse").length >= 8);
  const conds = new Set(CASES.map((c) => c.condition));
  for (const m of MUTANTS) assert.ok(conds.has(m.id), `no case for condition ${m.id}`);
  for (const id of ["entry-named-list", "new-test-gate", "can-do-same-file", "pattern-owner"]) {
    assert.ok(CASES.some((c) => c.condition === id && c.kind === "admit") && CASES.some((c) => c.condition === id && c.kind === "refuse"), `${id} needs an admit and a refused near miss`);
  }
});

test("M149 mutation: removing any one condition from plan2.ts fails at least one case", async () => {
  for (const m of MUTANTS) {
    assert.equal(source.split(m.find).length - 1, 1, `mutant ${m.id}: anchor text must occur once in plan2.ts`);
    const file = join(dir, `mutant-${m.id}.ts`);
    writeFileSync(file, absImports(source.replace(m.find, () => m.replace)));
    const mod = (await import(pathToFileURL(file).href)) as PlannerModule;
    const failed: string[] = [];
    for (const c of CASES) { try { c.run(mod, ctx); } catch (e) { if (e instanceof assert.AssertionError) failed.push(c.id); else throw e; } }
    assert.ok(failed.length > 0, `mutant ${m.id} survived every case`);
  }
});

test("M149 generality: plan2.ts names no task, task repository, organization or project", () => {
  const lower = source.toLowerCase();
  const pub = JSON.parse(readFileSync(join(repo, "peaceai/plan/tasks-public-v1.json"), "utf8")) as PlanTaskFile;
  const words = new Set<string>(["peacestocks", "stocks"]);
  for (const t of pub.tasks) {
    words.add(t.id.toLowerCase());
    for (const part of t.repo.toLowerCase().split("/")) if (part.length >= 4) words.add(part);
    for (const f of t.reference.files) if (f.path.split("/").length >= 3) words.add(f.path.toLowerCase());
  }
  for (const w of words) assert.ok(!new RegExp(String.raw`(?<![a-z0-9])${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![a-z0-9])`).test(lower), `plan2.ts mentions ${w}`);
});

const kitTask = (over: Partial<PlanTask> = {}): PlanTask => ({
  id: "m149-guard", repo: "example-org/fixture-kit", license: "MIT", licensePath: "LICENSE", licenseSha256: LICENSE_SHA, commit: H40,
  request: "`clamp` should throw `RANGE_INVALID` when lo > hi.\n- `clamp(5, 3, 1)` throws `RANGE_INVALID`\nAdd a test.",
  tests: { command: "vitest run test/clamp.test.ts", files: ["test/clamp.test.ts"] },
  reference: { from: { pr: 1, merge: "b".repeat(40) }, files: [{ path: "src/clamp.ts", change: "modify" }, { path: "test/clamp.test.ts", change: "modify" }], steps: [{ action: "edit-source", file: "src/clamp.ts", symbols: ["clamp"] }, { action: "edit-test", file: "test/clamp.test.ts" }, { action: "run-tests", file: null }], docs: [] },
  trainingCheck: { workspaceCommit: H40, sources: 1, inTraining: false },
  ...over,
});

test("M149: the one can-do claim is verified by the unchanged grader (the rule re-run edits that file)", () => {
  const plan = planOn(plan2 as PlannerModule, ctx, KIT, kitTask().request);
  const g = gradePlan(plan as unknown as Plan, kitTask(), ctx.rules, KIT.filter((f) => /\.ts$/.test(f.path)));
  assert.equal(g.canDoClaimed, 1);
  assert.equal(g.canDoVerified, 1);
  assert.equal(g.score, 1);
  assert.equal(g.runTests, 1);
});

/** v1's fingerprint on main (sha256 of plan.ts, plangrade.ts, planrun.ts at 4d0ea69; the same at 94c444a and 62de1df).
 *  Add-only: if v1 is ever changed on purpose, add the new value with its own comment, never edit this one. */
const MAIN_V1_PLANNER_SHA256 = "275e559b93822a74c461970d122b9c27233d034c0839b04d599d7c112e7aedeb";

test("M149: v1's plannerSha256 on this branch equals main's, and the latest v1 rows (public and hidden) carry it", () => {
  assert.equal(plannerSha256(), MAIN_V1_PLANNER_SHA256, "plan.ts, plangrade.ts or planrun.ts changed: v1 rows would lose their fingerprint");
  const log = parseLog(readFileSync(join(repo, RUN_LOG), "utf8"));
  assert.ok("rows" in log, "committed log parses");
  const rows = log.rows.filter((r: any) => r.planner === PLANNER_VERSION && r.grader === "plan-grade-v2") as any[];
  for (const set of ["public", "hidden"]) assert.equal(rows.filter((r) => r.set === set).at(-1)?.plannerSha256, MAIN_V1_PLANNER_SHA256, `latest v1 ${set} row`);
  assert.notEqual(plannerSha256V2(), MAIN_V1_PLANNER_SHA256);
});

test("M149 runner: v1 rows come from planrun.ts unchanged; v2 rows from plan2run.ts carry their own id and digest and pass the log validator", () => {
  const fetcher: Fetcher = () => ({ head: H40, files: KIT.filter((f) => /\.tsx?$/.test(f.path)), read: (p) => KIT.find((f) => f.path === p)?.content ?? null, unchanged: () => true, close: () => {} } satisfies Checkout);
  const o = { root: repo, fetcher, outDir: dir, rules: ctx.rules, training: new Set<string>() };
  const fileSha = sha256("m149");
  const v1 = runTask(kitTask(), "public", fileSha, o);
  const v2 = runTaskV2(kitTask(), "public", fileSha, o);
  assert.equal(v1.row.planner, PLANNER_VERSION);
  assert.equal(v1.row.plannerSha256, MAIN_V1_PLANNER_SHA256);
  assert.equal(v2.row.planner, "plan-only-v2");
  assert.equal(v2.row.plannerSha256, plannerSha256V2());
  for (const r of [v1.row, v2.row]) { assert.equal(r.code, "OK"); assert.equal(logRowProblem(r), null); }
  assert.equal(v2.row.grade!.canDoVerified, 1);
  assert.equal(v2.plan!.missingSkills.includes("extend-existing-test"), true);
});
