// M153 PLAN-ONLY v3 (peaceai/spec/plan-only-v3.md): the planner's admit cases on three code shapes and a refused near
// miss per rule (m153-cases.ts); a mutation check (every `rule:<id>` line of lib/plan3.ts has a mutant that removes
// it, and each mutant must fail at least one case); a generality check (plan3.ts names no task, task repository,
// task file or project); the can-do claim verified by the unchanged grader; and the runner: v1 stays the default,
// v1's and v2's fingerprints are unchanged, and v3 rows pass the same log validator. Offline.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test, { after } from "node:test";
import { pathToFileURL } from "node:url";
import { approvedRules, PLANNER_VERSION, sha256, type Plan, type PlanTask, type PlanTaskFile } from "../lib/plan.ts";
import * as plan3 from "../lib/plan3.ts";
import { gradePlan, logRowProblem, parseLog, RUN_LOG } from "../lib/plangrade.ts";
import { plannerSha256, type Checkout, type Fetcher } from "../lib/planrun.ts";
import { plannerSha256V2 } from "../lib/plan2run.ts";
import { plannerSha256V3, runTaskV3 } from "../lib/plan3run.ts";
import { loadModel } from "../lib/nlparse.ts";
import { loadTargets } from "../lib/target.ts";
import { CASES, planOn, type CaseCtx, type PlannerModule } from "./m153-cases.ts";
import { GEO, LICENSE_SHA } from "./m153-fixtures.ts";

const repo = resolve(import.meta.dirname, "..", "..");
const libDir = join(repo, "peaceai/lib");
const source = readFileSync(join(libDir, "plan3.ts"), "utf8");
const ctx: CaseCtx = { rules: approvedRules(repo), model: loadModel(), targetRepo: Object.keys(loadTargets().targets).sort()[0]! };
const H40 = "a".repeat(40);

/** One mutant per tagged rule (several for a rule with two parts). `find` must occur exactly once in plan3.ts. */
const MUTANTS: { id: string; find: string; replace: string }[] = [
  { id: "source-filter", find: " && !NON_SOURCE_DIR.test(p); // rule:source-filter", replace: ";" },
  { id: "behavior-test", find: "boolean => isTest(p) && CODE.test(p) && !/", replace: "boolean => isTest(p) && CODE.test(p) || !1 && !/" },
  { id: "tests-only", find: "boolean {\n  return /^\\s*(?:please", replace: "boolean {\n  return false && /^\\s*(?:please" },
  { id: "home-eponymous", find: "paths.filter((p) => norm(fileStem(p)) === norm(name)); // rule:home-eponymous", replace: "[] as string[];" },
  { id: "home-exported", find: "return exported.length === 1 ? exported[0]! : null;", replace: "return null;" },
  { id: "max-sources", find: " && sources.length < MAX_SOURCES_V3) sources.push", replace: ") sources.push" },
  { id: "qualifier-home", find: "own ?? (n.qualifier ? homeOf(code, n.qualifier) : null); // rule:qualifier-home", replace: "own;" },
  { id: "example-fallback", find: "if (sources.length === 0) pass(names.filter((n) => n.example)); // rule:example-fallback", replace: "" },
  { id: "rank-fallback", find: "if (sources.length === 0) { // rule:rank-fallback", replace: "if (false) {" },
  { id: "test-direct", find: "&& x.score >= 2); // rule:test-direct", replace: ");" },
  { id: "new-test-beside", find: "newTestPath(all, s.path); // rule:new-test-beside", replace: "null as string | null;" },
  { id: "new-test-same-package", find: "&& packageDirOf(all, t) === own); // rule:new-test-same-package", replace: ");" },
  { id: "test-step-always", find: "if (tests.length === 0) push({ action: \"add-test\"", replace: "if (false) push({ action: \"add-test\"" },
  { id: "can-do-same-file", find: "if (edit && (edit.path === file || (edit.extra ?? []).some((x) => x.path === file))) return { spec, objective }; // rule:can-do-same-file", replace: "if (edit) return { spec, objective };" },
  { id: "run-tests-target", find: "const runnable = Object.prototype.hasOwnProperty.call(loadTargets().targets, ctx.repo); // rule:run-tests-target", replace: "const runnable = loadTargets() !== null;" },
  { id: "nearest-package", find: "packageDirOf(all, anchor ?? testFiles[0] ?? \"\"); // rule:nearest-package", replace: "\"\";" },
  { id: "pm-lockfile", find: "if (!pm && set.has(join2(d, f))) pm = m; // rule:pm-lockfile", replace: "void set;" },
  { id: "pm-field", find: "if (!pm && typeof root?.packageManager === \"string\")", replace: "if (false)" },
  { id: "runner-script", find: "RUNNERS.find((r) => testScript !== null && new RegExp", replace: "RUNNERS.find((r) => false && new RegExp" },
  { id: "runner-config", find: "if (!runner) runner = RUNNERS.find((r) => all.some(", replace: "if (false) runner = RUNNERS.find((r) => all.some(" },
  { id: "runner-deps", find: "if (!runner) runner = RUNNERS.find((r) => Object.prototype.hasOwnProperty.call(deps, r)) ?? null; // rule:runner-deps", replace: "void deps;" },
  { id: "targeted-runner", find: "if (runner && runner !== \"mocha\" && rel.length) { // rule:targeted-runner", replace: "if (false) {" },
  { id: "targeted-runner", find: "runner !== \"mocha\" && rel.length", replace: "rel.length" },
  { id: "script-fallback", find: "testScript !== null ? \"test\" : named[0] ?? null; // rule:script-fallback", replace: "testScript !== null ? \"test\" : null;" },
];

const dir = mkdtempSync(join(tmpdir(), "peaceai-m153-mut-"));
after(() => rmSync(dir, { recursive: true, force: true }));
const absImports = (text: string) => text.replace(/from "\.\/([\w-]+\.ts)"/g, (_m, f: string) => `from ${JSON.stringify(pathToFileURL(join(libDir, f)).href)}`);

test("M153: every admit case and every refused near miss holds on plan3.ts (three code shapes)", () => {
  for (const c of CASES) c.run(plan3 as PlannerModule, ctx);
  const tags = new Set([...source.matchAll(/\/\/ rule:([a-z-]+)/g)].map((m) => m[1]!));
  assert.ok(tags.size >= 20, `tagged rules: ${tags.size}`);
  for (const t of tags) {
    assert.ok(MUTANTS.some((m) => m.id === t), `rule ${t} has no mutant`);
    assert.ok(CASES.some((c) => c.condition === t), `rule ${t} has no case`);
    assert.ok(CASES.some((c) => c.condition === t && c.kind === "refuse") || CASES.some((c) => c.condition === t && c.kind === "admit"), t);
  }
  for (const m of MUTANTS) assert.ok(tags.has(m.id), `mutant ${m.id} names no tagged rule`);
  assert.ok(CASES.filter((c) => c.kind === "admit").length >= 15 && CASES.filter((c) => c.kind === "refuse").length >= 15);
  for (const t of tags) assert.ok(CASES.some((c) => c.condition === t && c.kind === "refuse"), `rule ${t} needs a refused near miss`);
});

test("M153 mutation: removing any one tagged rule from plan3.ts fails at least one case", async () => {
  let n = 0;
  for (const m of MUTANTS) {
    assert.equal(source.split(m.find).length - 1, 1, `mutant ${m.id}: anchor text must occur once in plan3.ts`);
    const file = join(dir, `mutant-${m.id}-${n++}.ts`);
    writeFileSync(file, absImports(source.replace(m.find, () => m.replace)));
    const mod = (await import(pathToFileURL(file).href)) as PlannerModule;
    const failed: string[] = [];
    for (const c of CASES) { try { c.run(mod, ctx); } catch (e) { if (e instanceof assert.AssertionError) failed.push(c.id); else throw e; } }
    assert.ok(failed.length > 0, `mutant ${m.id} survived every case`);
  }
});

test("M153 generality: plan3.ts and plan3run.ts name no task, task repository, task file, organization or project", () => {
  const pub = JSON.parse(readFileSync(join(repo, "peaceai/plan/tasks-public-v1.json"), "utf8")) as PlanTaskFile;
  const words = new Set<string>(["peacestocks", "stocks"]);
  for (const t of pub.tasks) {
    words.add(t.id.toLowerCase());
    for (const part of t.repo.toLowerCase().split("/")) if (part.length >= 4) words.add(part);
    for (const f of [...t.reference.files.map((x) => x.path), ...t.tests.files]) if (f.split("/").length >= 2) words.add(f.toLowerCase());
  }
  for (const f of ["plan3.ts", "plan3run.ts"]) {
    const lower = readFileSync(join(libDir, f), "utf8").toLowerCase();
    for (const w of words) assert.ok(!new RegExp(String.raw`(?<![a-z0-9])${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![a-z0-9])`).test(lower), `${f} mentions ${w}`);
  }
});

const geoTask = (over: Partial<PlanTask> = {}): PlanTask => ({
  id: "m153-guard", repo: "example-org/geo-fixture", license: "MIT", licensePath: "LICENSE", licenseSha256: LICENSE_SHA, commit: H40,
  request: "`clamp` should throw `RANGE_INVALID` when lo > hi.\n- `clamp(5, 3, 1)` throws `RANGE_INVALID`\nAdd a test.",
  tests: { command: "pnpm vitest run test/clamp.test.ts", files: ["test/clamp.test.ts"] },
  reference: { from: { pr: 1, merge: "b".repeat(40) }, files: [{ path: "src/clamp.ts", change: "modify" }, { path: "test/clamp.test.ts", change: "modify" }], steps: [{ action: "edit-source", file: "src/clamp.ts", symbols: ["clamp"] }, { action: "edit-test", file: "test/clamp.test.ts" }, { action: "run-tests", file: null }], docs: [] },
  trainingCheck: { workspaceCommit: H40, sources: 1, inTraining: false },
  ...over,
});

test("M153: the can-do claim is verified by the unchanged grader, and the named test command is the project's own", () => {
  const plan = planOn(plan3 as PlannerModule, ctx, GEO, geoTask().request);
  const g = gradePlan(plan as unknown as Plan, geoTask(), ctx.rules, GEO.filter((f) => /\.ts$/.test(f.path)));
  assert.equal(g.canDoClaimed, 1);
  assert.equal(g.canDoVerified, 1);
  assert.equal(g.score, 1);
  assert.equal(g.runTests, 1);
  assert.equal(plan.tests.command, "pnpm vitest run test/clamp.test.ts");
});

/** Main's fingerprints (add-only: a deliberate change adds a new value with its own comment, never edits these). */
const MAIN_V1_PLANNER_SHA256 = "275e559b93822a74c461970d122b9c27233d034c0839b04d599d7c112e7aedeb";
const MAIN_V2_PLANNER_SHA256 = "fae6c0c489dcd18acf968706dcaa7bc0643a01f9375ee85b09747745cc697227";

test("M153: v1 (the default) and v2 keep main's plannerSha256; v3 has its own", () => {
  assert.equal(plannerSha256(), MAIN_V1_PLANNER_SHA256, "plan.ts, plangrade.ts or planrun.ts changed");
  assert.equal(plannerSha256V2(), MAIN_V2_PLANNER_SHA256, "plan2.ts, plangrade.ts or plan2run.ts changed");
  const v3 = plannerSha256V3();
  assert.ok(v3 !== MAIN_V1_PLANNER_SHA256 && v3 !== MAIN_V2_PLANNER_SHA256);
  const cli = readFileSync(join(repo, "peaceai/bin/plan-only.ts"), "utf8");
  assert.ok(!/plan3|plan-only-v3/.test(cli), "v1's CLI stays the default and never routes to v3");
  const log = parseLog(readFileSync(join(repo, RUN_LOG), "utf8"));
  assert.ok("rows" in log, "committed log parses");
  // Dev rows, plus exactly the 20 hidden-half rows the Auditor ran at c4dd914 (planner digest f4999797...).
  let hidden = 0;
  for (const r of log.rows as any[]) if (r.planner === "plan-only-v3") {
    if (r.set === "hidden") { hidden++; assert.equal(r.plannerSha256, v3, "hidden v3 rows come from this exact v3"); }
    else assert.equal(r.set, "public", "v3 rows are dev rows or the Auditor's hidden rows");
  }
  assert.ok(hidden === 0 || hidden === 20, "hidden v3 rows are the Auditor's 20, add-only");
});

test("M153 runner: v3 rows carry their own id and digest, pass the log validator, and a hidden row names no repo", () => {
  const fetcher: Fetcher = () => ({ head: H40, files: GEO.filter((f) => /\.tsx?$/.test(f.path)), read: (p) => GEO.find((f) => f.path === p)?.content ?? null, unchanged: () => true, close: () => {} } satisfies Checkout);
  const o = { root: repo, fetcher, outDir: dir, rules: ctx.rules, training: new Set<string>() };
  const fileSha = sha256("m153");
  const pub = runTaskV3(geoTask(), "public", fileSha, o);
  assert.equal(pub.row.planner, "plan-only-v3");
  assert.equal(pub.row.plannerSha256, plannerSha256V3());
  assert.equal(pub.row.code, "OK");
  assert.equal(logRowProblem(pub.row), null);
  assert.equal(pub.row.grade!.canDoVerified, 1);
  assert.notEqual(pub.row.planner as string, PLANNER_VERSION as string);
  const hid = runTaskV3(geoTask(), "hidden", fileSha, o);
  assert.equal(logRowProblem(hid.row), null);
  assert.ok(!("repo" in hid.row) && !("commit" in hid.row));
});
