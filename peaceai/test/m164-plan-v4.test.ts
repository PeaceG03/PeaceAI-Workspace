// M164 PLAN-ONLY v4 (peaceai/spec/plan-only-v4.md): v4 is v3 plus one named-test rule. Checked here: plan4.ts is
// plan3.ts with only the renames and the new rule block (so M153's v3 mutants keep covering every inherited line);
// every M153 case still holds on v4; the new rule's admit cases and refused near misses (m164-cases.ts) on synthetic
// fixtures; a mutation check over the new `rule:<id>` tags; a generality check (plan4.ts and plan4run.ts name no
// task, task repository, task file or project); the synthetic runTests before (v3) and after (v4); and the wiring:
// v4 is selectable and EXPERIMENTAL, v3 stays the default with its digest, v4 rows have their own id and digest and
// pass the log validator. Offline.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test, { after } from "node:test";
import { pathToFileURL } from "node:url";
import { approvedRules, sha256, type Plan, type PlanTask, type PlanTaskFile } from "../lib/plan.ts";
import * as plan3 from "../lib/plan3.ts";
import * as plan4 from "../lib/plan4.ts";
import { DEFAULT_PLANNER, PLANNERS, selectPlanner } from "../lib/plandefault.ts";
import { gradePlan, logRowProblem } from "../lib/plangrade.ts";
import { type Checkout, type Fetcher } from "../lib/planrun.ts";
import { plannerSha256V3 } from "../lib/plan3run.ts";
import { plannerSha256V4, runTaskV4 } from "../lib/plan4run.ts";
import { loadModel } from "../lib/nlparse.ts";
import { loadTargets } from "../lib/target.ts";
import type { IndexFile } from "../lib/symbols.ts";
import { CASES, planOn, type CaseCtx, type PlannerModule } from "./m153-cases.ts";
import { LICENSE_SHA } from "./m153-fixtures.ts";
import { BOTH, CASES_V4, EXAMPLE_ONLY, NONE, ONE } from "./m164-cases.ts";
import { SCHEMA, schemaWith, WS } from "./m164-fixtures.ts";

const repo = resolve(import.meta.dirname, "..", "..");
const libDir = join(repo, "peaceai/lib");
const source = readFileSync(join(libDir, "plan4.ts"), "utf8");
const ctx: CaseCtx = { rules: approvedRules(repo), model: loadModel(), targetRepo: Object.keys(loadTargets().targets).sort()[0]! };
const H40 = "a".repeat(40);
/** v4 in M153's PlannerModule shape, so M153's cases and planOn run on it unchanged. */
const asModule = (m: typeof plan4): PlannerModule => ({ planTaskV3: m.planTaskV4 as unknown as PlannerModule["planTaskV3"], repoFromFiles: m.repoFromFiles });
const V4 = asModule(plan4);
const NEW_TAGS = ["test-named", "test-named-examples-last", "test-named-first", "test-named-package", "test-named-unique"];

/** One mutant per new tagged rule. `find` must occur exactly once in plan4.ts. */
const MUTANTS: { id: string; find: string; replace: string }[] = [
  { id: "test-named", find: "const m = all.filter((p) => isBehaviorTest(p) && norm(fileStem(p)) === norm(n.name)); // rule:test-named", replace: "const m = [] as string[]; void n;" },
  { id: "test-named-package", find: "const own = sourcePkgs === null ? m : m.filter((p) => sourcePkgs.has(packageDirOf(all, p))); // rule:test-named-package", replace: "const own = m;" },
  { id: "test-named-unique", find: "return own.length === 1 ? own : []; // rule:test-named-unique", replace: "return own;" },
  { id: "test-named-examples-last", find: "return stated.length ? stated : pick(names.filter((n) => n.example)); // rule:test-named-examples-last", replace: "return stated;" },
  { id: "test-named-first", find: "if (named.length === 0) for (const s of scope.sources) { // rule:test-named-first", replace: "for (const s of scope.sources) {" },
];

const dir = mkdtempSync(join(tmpdir(), "peaceai-m164-mut-"));
after(() => rmSync(dir, { recursive: true, force: true }));
const absImports = (text: string) => text.replace(/from "\.\/([\w-]+\.ts)"/g, (_m, f: string) => `from ${JSON.stringify(pathToFileURL(join(libDir, f)).href)}`);
const body = (text: string) => text.slice(text.indexOf("\nimport ") + 1);

test("M164: plan4.ts is plan3.ts with only the v4 renames and the named-test block (inherited rules stay M153's)", () => {
  const p3 = body(readFileSync(join(libDir, "plan3.ts"), "utf8"));
  let p4 = body(source).replace(/V4\b/g, "V3").replace(/"plan-only-v4"/g, '"plan-only-v3"');
  const start = p4.indexOf("/** (M164) ");
  const end = p4.indexOf("// rule:test-named-examples-last\n}\n");
  assert.ok(start > 0 && end > start, "the named-test block is where it was put");
  p4 = p4.slice(0, start) + p4.slice(end + "// rule:test-named-examples-last\n}\n".length);
  const use = p4.indexOf("  const named = namedTests(");
  const loop = "  if (named.length === 0) for (const s of scope.sources) { // rule:test-named-first\n";
  assert.ok(use > 0 && p4.includes(loop));
  p4 = p4.slice(0, use) + "  for (const s of scope.sources) {\n" + p4.slice(p4.indexOf(loop) + loop.length);
  assert.equal(p4, p3, "plan4.ts differs from plan3.ts outside the named-test rule");
});

test("M164: every M153 case (v3's rules on three code shapes) still holds on v4", () => {
  for (const c of CASES) c.run(V4, ctx);
});

test("M164: every named-test admit case and refused near miss holds on v4; each new rule has a mutant and a near miss", () => {
  for (const c of CASES_V4) c.run(V4, ctx);
  const tags = new Set([...source.matchAll(/\/\/ rule:([a-z-]+)/g)].map((m) => m[1]!));
  const v3tags = new Set([...readFileSync(join(libDir, "plan3.ts"), "utf8").matchAll(/\/\/ rule:([a-z-]+)/g)].map((m) => m[1]!));
  assert.deepEqual([...tags].filter((t) => !v3tags.has(t)).sort(), NEW_TAGS);
  for (const t of NEW_TAGS) {
    assert.ok(MUTANTS.some((m) => m.id === t), `rule ${t} has no mutant`);
    assert.ok(CASES_V4.some((c) => c.condition === t && c.kind === "admit"), `rule ${t} has no admit case`);
    assert.ok(CASES_V4.some((c) => c.condition === t && c.kind === "refuse"), `rule ${t} needs a refused near miss`);
  }
  for (const c of CASES_V4) assert.ok(NEW_TAGS.includes(c.condition), c.id);
});

test("M164 mutation: removing any one new tagged rule from plan4.ts fails at least one case", async () => {
  let n = 0;
  for (const m of MUTANTS) {
    assert.equal(source.split(m.find).length - 1, 1, `mutant ${m.id}: anchor text must occur once in plan4.ts`);
    const file = join(dir, `mutant-${m.id}-${n++}.ts`);
    writeFileSync(file, absImports(source.replace(m.find, () => m.replace)));
    const mod = asModule((await import(pathToFileURL(file).href)) as typeof plan4);
    const failed: string[] = [];
    for (const c of [...CASES_V4, ...CASES]) { try { c.run(mod, ctx); } catch (e) { if (e instanceof assert.AssertionError) failed.push(c.id); else throw e; } }
    assert.ok(failed.length > 0, `mutant ${m.id} survived every case`);
  }
});

test("M164 generality: plan4.ts and plan4run.ts name no task, task repository, task file, organization or project", () => {
  const pub = JSON.parse(readFileSync(join(repo, "peaceai/plan/tasks-public-v1.json"), "utf8")) as PlanTaskFile;
  const words = new Set<string>(["peacestocks", "stocks"]);
  for (const t of pub.tasks) {
    words.add(t.id.toLowerCase());
    for (const part of t.repo.toLowerCase().split("/")) if (part.length >= 4) words.add(part);
    for (const f of [...t.reference.files.map((x) => x.path), ...t.tests.files]) if (f.split("/").length >= 2) words.add(f.toLowerCase());
  }
  for (const f of ["plan4.ts", "plan4run.ts"]) {
    const lower = readFileSync(join(libDir, f), "utf8").toLowerCase();
    for (const w of words) assert.ok(!new RegExp(String.raw`(?<![a-z0-9])${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![a-z0-9])`).test(lower), `${f} mentions ${w}`);
  }
});

const task = (request: string, testFile: string, command: string, source: string): PlanTask => ({
  id: "m164-synthetic", repo: "example-org/m164-fixture", license: "MIT", licensePath: "LICENSE", licenseSha256: LICENSE_SHA, commit: H40, request,
  tests: { command, files: [testFile] },
  reference: { from: { pr: 1, merge: "b".repeat(40) }, files: [{ path: source, change: "modify" }, { path: testFile, change: "modify" }], steps: [{ action: "edit-source", file: source }, { action: "edit-test", file: testFile }, { action: "run-tests", file: null }], docs: [] },
  trainingCheck: { workspaceCommit: H40, sources: 1, inTraining: false },
});
const WS_OWN: IndexFile[] = [...WS, { path: "packages/core/test/api/create.test.ts", content: 'import { create } from "../../src/index.ts";\n' }];
const TWO = schemaWith([{ path: "test/node/create.test.ts", content: 'import { create } from "../../src/index.ts";\n' }]);
/** Synthetic tasks: the team's test is the one named after the stated function (3), or v3's pick where no single
 *  same-package test is named after it (3 near misses, where v4 must not lose what v3 gets). */
const SYNTHETIC: [string, IndexFile[], PlanTask][] = [
  ["named", SCHEMA, task(ONE, "test/api/create.test.ts", "pnpm vitest run test/api/create.test.ts", "src/struct.ts")],
  ["named-example", SCHEMA, task(EXAMPLE_ONLY, "test/api/create.test.ts", "pnpm vitest run test/api/create.test.ts", "src/struct.ts")],
  ["named-package", WS_OWN, task(ONE, "packages/core/test/api/create.test.ts", "cd packages/core && pnpm vitest run test/api/create.test.ts", "packages/core/src/struct.ts")],
  ["none", SCHEMA, task(NONE, "test/typings/struct.test.ts", "pnpm vitest run test/typings/struct.test.ts", "src/struct.ts")],
  ["ambiguous", TWO, task(ONE, "test/typings/struct.test.ts", "pnpm vitest run test/typings/struct.test.ts", "src/struct.ts")],
  ["other-package", WS, task(ONE, "packages/core/test/struct.test.ts", "cd packages/core && pnpm vitest run test/struct.test.ts", "packages/core/src/struct.ts")],
  ["plain-first", SCHEMA, task(BOTH, "test/api/coerce.test.ts", "pnpm vitest run test/api/coerce.test.ts", "src/coerce.ts")],
];

test("M164: synthetic runTests before (v3) and after (v4): v4 gets every task v3 gets and the named-test ones", () => {
  const rt = (mod: PlannerModule) => SYNTHETIC.map(([, files, t]) => gradePlan(planOn(mod, ctx, files, t.request) as unknown as Plan, t, ctx.rules, files.filter((f) => /\.ts$/.test(f.path))).runTests);
  const v3 = rt(plan3 as PlannerModule);
  const v4 = rt(V4);
  for (let i = 0; i < SYNTHETIC.length; i++) assert.ok(v4[i]! >= v3[i]!, `v4 lost ${SYNTHETIC[i]![0]}`);
  assert.deepEqual(v3, [0, 0, 0, 1, 1, 1, 1], "v3 (before)");
  assert.deepEqual(v4, [1, 1, 1, 1, 1, 1, 1], "v4 (after)");
});

test("M164 wiring: v4 is selectable and EXPERIMENTAL, v3 stays the default; v4 has its own digest over its own files", () => {
  assert.equal(DEFAULT_PLANNER, "plan-only-v3");
  assert.equal(selectPlanner(undefined)?.name, "plan-only-v3");
  for (const f of ["v4", "plan-only-v4"]) assert.deepEqual(selectPlanner(f), { name: "plan-only-v4", module: "../lib/plan4run.ts", run: "runFileV4", status: "EXPERIMENTAL" });
  assert.equal(PLANNERS["plan-only-v4"].status, "EXPERIMENTAL");
  const expect = sha256(["lib/plan4.ts", "lib/plangrade.ts", "lib/plan4run.ts"].map((f) => readFileSync(join(repo, "peaceai", f), "utf8")).join("\0"));
  assert.equal(plannerSha256V4(), expect);
  assert.notEqual(plannerSha256V4(), plannerSha256V3());
  assert.equal(plannerSha256V3(), "f49997972d7aaea495257366ac4b1f8587619099b695869753531f6c72198f35", "v3 (the default) is byte-identical");
  const cli = readFileSync(join(repo, "peaceai/bin/plan-only-v4.ts"), "utf8");
  assert.match(cli, /import\("\.\.\/lib\/plan4run\.ts"\)/);
  assert.ok(!/plan3run|runFileV3/.test(cli), "v4's CLI runs v4 only");
});

test("M164 runner: v4 rows carry their own id and digest, pass the log validator, and a hidden row names no repo", () => {
  const fetcher: Fetcher = () => ({ head: H40, files: SCHEMA.filter((f) => /\.tsx?$/.test(f.path)), read: (p) => SCHEMA.find((f) => f.path === p)?.content ?? null, unchanged: () => true, close: () => {} } satisfies Checkout);
  const o = { root: repo, fetcher, outDir: dir, rules: ctx.rules, training: new Set<string>() };
  const t = SYNTHETIC[0]![2];
  const pub = runTaskV4(t, "public", sha256("m164"), o);
  assert.equal(pub.row.planner, "plan-only-v4");
  assert.equal(pub.row.plannerSha256, plannerSha256V4());
  assert.equal(pub.row.code, "OK");
  assert.equal(logRowProblem(pub.row), null);
  assert.deepEqual(pub.plan?.tests.files, ["test/api/create.test.ts"]);
  const hid = runTaskV4(t, "hidden", sha256("m164"), o);
  assert.equal(logRowProblem(hid.row), null);
  assert.ok(!("repo" in hid.row) && !("commit" in hid.row));
});
