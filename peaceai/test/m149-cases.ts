// M149 cases: what plan-only-v2 must plan on two code shapes (admit), and the near miss it must refuse for each of
// its conditions (refuse). Each case runs against a planner module, so the mutation check in m149-plan-v2.test.ts
// can run the same cases against a planner with one condition removed. Condition ids match MUTANTS there.
import assert from "node:assert/strict";
import type { RuleSpec } from "../lib/learned.ts";
import type { IndexFile } from "../lib/symbols.ts";
import { KIT, SVC } from "./m149-fixtures.ts";

export interface PlannerModule {
  planTaskV2: typeof import("../lib/plan2.ts").planTaskV2;
  repoFromFiles: typeof import("../lib/plan2.ts").repoFromFiles;
}
export interface CaseCtx { rules: RuleSpec[]; model: any; targetRepo: string }
type Plan = ReturnType<PlannerModule["planTaskV2"]>;
export interface Case { id: string; kind: "admit" | "refuse"; condition: string; run(mod: PlannerModule, ctx: CaseCtx): void }

export function planOn(mod: PlannerModule, ctx: CaseCtx, files: IndexFile[], request: string, repo = "example-org/fixture"): Plan {
  const r = mod.repoFromFiles(files);
  try { return mod.planTaskV2("m149", request, { repo, files: files.filter((f) => /\.tsx?$/.test(f.path)), rules: ctx.rules, model: ctx.model, testCommand: null }, r.code); }
  finally { r.close(); }
}
const shape = (p: Plan) => p.steps.map((s) => `${s.action} ${s.file ?? "-"}`);
const work = (p: Plan) => p.steps.filter((s) => s.action !== "run-tests").map((s) => `${s.action} ${s.file ?? "-"}`).sort();

export const CASES: Case[] = [
  // ---- KIT (flat library)
  { id: "kit-one-function", kind: "admit", condition: "ident-home", run: (m, c) => {
    const p = planOn(m, c, KIT, "`clamp` returns values above `hi` unchanged; it should clamp them to `hi`. Fix it and add a test.");
    assert.deepEqual(shape(p), ["edit-source src/clamp.ts", "edit-test test/clamp.test.ts", "run-tests -"]);
  } },
  { id: "kit-two-functions-scale", kind: "admit", condition: "keep-second", run: (m, c) => {
    const p = planOn(m, c, KIT, "`clamp` ignores its upper bound and `pad` never pads past 10 characters. Fix both and extend the tests.");
    assert.deepEqual(work(p), ["edit-source src/clamp.ts", "edit-source src/pad.ts", "edit-test test/clamp.test.ts", "edit-test test/pad.test.ts"]);
    assert.equal(p.steps.length, 5, "one step per file plus the test run");
    // src/format.ts defines another `pad`; the file named after the function is its home.
  } },
  { id: "kit-entry-export", kind: "admit", condition: "entry-named-list", run: (m, c) => {
    const p = planOn(m, c, KIT, "Add a `wrap` function to the clamp module next to `clamp` and export it from the package entry.");
    assert.deepEqual(work(p), ["edit-source src/clamp.ts", "edit-source src/index.ts", "edit-test test/clamp.test.ts"]);
    assert.equal(p.steps.find((s) => s.file === "src/index.ts")!.missing, "re-export-from-entry");
    assert.equal(p.steps.find((s) => s.file === "src/clamp.ts")!.missing, "add-function-or-member");
  } },
  { id: "kit-entry-star-refused", kind: "refuse", condition: "entry-named-list", run: (m, c) => {
    // `export *` already re-exports anything new in misc.ts: no entry step.
    const p = planOn(m, c, KIT, "Add an `always` function next to `identity` and export it from the package entry.");
    assert.ok(!p.steps.some((s) => s.file === "src/index.ts"), shape(p).join(" | "));
  } },
  { id: "kit-new-test-file", kind: "admit", condition: "new-test-gate", run: (m, c) => {
    const p = planOn(m, c, KIT, "`slugify` keeps trailing dashes. Fix it and add a test for `slugify`.");
    assert.deepEqual(shape(p), ["edit-source src/slug.ts", "add-test test/slugify.test.ts", "run-tests -"]);
  } },
  { id: "kit-new-test-existing-refused", kind: "refuse", condition: "new-test-gate", run: (m, c) => {
    const p = planOn(m, c, KIT, "`clamp` ignores `hi`. Fix it and add a test for `clamp`.");
    assert.ok(!p.steps.some((s) => s.action === "add-test"), shape(p).join(" | "));
    assert.ok(p.steps.some((s) => s.action === "edit-test" && s.file === "test/clamp.test.ts"));
  } },
  { id: "kit-new-test-reached-refused", kind: "refuse", condition: "new-test-gate", run: (m, c) => {
    // No test file is named identity, but test/misc.test.ts already tests its module: extend it, add none.
    const p = planOn(m, c, KIT, "`identity` returns a copy instead of its argument. Fix it and add a test for `identity`.");
    assert.deepEqual(shape(p), ["edit-source src/misc.ts", "edit-test test/misc.test.ts", "run-tests -"]);
  } },
  { id: "kit-example-name-refused", kind: "refuse", condition: "example-weak", run: (m, c) => {
    // `pipe` appears only inside the example call: the bug is in `pick`.
    const p = planOn(m, c, KIT, "`pick` drops every key: `pipe({ a: 1 }, pick([\"a\"]))` returns an empty object. Fix it and add a test.");
    assert.deepEqual(shape(p).filter((s) => s.startsWith("edit-source")), ["edit-source src/pick.ts"]);
  } },
  { id: "kit-own-test-file", kind: "admit", condition: "same-stem-test", run: (m, c) => {
    // test/pick.test.ts imports pipe.ts directly; test/pipe.test.ts imports the package by name (no import edge) but is the module's own test file.
    const p = planOn(m, c, KIT, "Fix the pipe helper so it runs the last function too. Add a test.");
    assert.deepEqual(shape(p), ["edit-source src/pipe.ts", "edit-test test/pipe.test.ts", "run-tests -"]);
  } },
  { id: "kit-no-tests-asked-no-guess", kind: "refuse", condition: "fallback-needs-tests", run: (m, c) => {
    // No test imports limits.ts and none is asked for: no guessed test step.
    const p = planOn(m, c, KIT, "Set `MAX_RETRIES` to a bigger number.");
    assert.deepEqual(shape(p), ["edit-source src/limits.ts", "run-tests -"]);
    assert.equal(p.steps[0]!.missing, "edit-constant");
  } },
  { id: "kit-can-do-guard", kind: "admit", condition: "can-do-same-file", run: (m, c) => {
    const p = planOn(m, c, KIT, "`clamp` should throw `RANGE_INVALID` when lo > hi.\n- `clamp(5, 3, 1)` throws `RANGE_INVALID`\nAdd a test.");
    const src = p.steps.find((s) => s.file === "src/clamp.ts")!;
    assert.equal(src.status, "can-do");
    assert.match(src.rule!, /^public-throw-guard-v1@[0-9a-f]{64}$/);
    // The guard rule writes its own new test file, never test/clamp.test.ts: that step stays missing.
    const t = p.steps.find((s) => s.file === "test/clamp.test.ts")!;
    assert.equal(t.status, "missing");
  } },
  { id: "kit-can-do-needs-examples-refused", kind: "refuse", condition: "can-do-same-file", run: (m, c) => {
    // Without the example bullet the approved rule refuses, so no claim.
    const p = planOn(m, c, KIT, "`clamp` should throw `RANGE_INVALID` when lo > hi. Add a test.");
    assert.ok(p.steps.every((s) => s.status === "missing"), shape(p).join(" | "));
  } },
  { id: "kit-run-tests-target-only", kind: "refuse", condition: "run-tests-target", run: (m, c) => {
    const req = "`clamp` ignores `hi`. Fix it.";
    assert.equal(planOn(m, c, KIT, req).steps.at(-1)!.status, "missing");
    const t = planOn(m, c, KIT, req, c.targetRepo).steps.at(-1)!;
    assert.equal(t.status, "can-do");
    assert.equal(t.rule, "pipeline:job-b-tests");
  } },
  // ---- SVC (nested service)
  { id: "svc-phrase-file", kind: "admit", condition: "phrase-most-spelled", run: (m, c) => {
    // "the cache loader" spells cache-loader.ts in full; helpers/cache.ts only in part. tests/index.ts is the harness.
    const p = planOn(m, c, SVC, "Fix the cache loader so a miss does not throw. Add a test.");
    assert.deepEqual(shape(p), ["edit-source src/cache/cache-loader.ts", "edit-test tests/cache/cache-loader.spec.ts", "run-tests -"]);
  } },
  { id: "svc-harness-not-a-test", kind: "refuse", condition: "harness-index", run: (m, c) => {
    // tests/index.ts imports helpers/cache.ts to warm it, but it is the harness, not a test of that module.
    const p = planOn(m, c, SVC, "Fix the cache helpers so keys are namespaced. Add a test.");
    assert.deepEqual(shape(p), ["edit-source src/helpers/cache.ts", "edit-test tests/cache/cache-loader.spec.ts", "run-tests -"]);
  } },
  { id: "svc-phrase-method", kind: "admit", condition: "phrase-function", run: (m, c) => {
    // No file is named loader; the method `load` is.
    const p = planOn(m, c, SVC, "Fix the loader so a miss does not throw.");
    assert.equal(shape(p)[0], "edit-source src/cache/cache-loader.ts");
  } },
  { id: "svc-generic-noun-refused", kind: "refuse", condition: "phrase-specifier", run: (m, c) => {
    // "the upload handler" names upload.ts; the base class file handler.ts is named by the generic noun alone.
    const p = planOn(m, c, SVC, "Fix the upload handler so an empty body returns 400 without throwing. Add a test.");
    assert.deepEqual(shape(p).filter((s) => s.startsWith("edit-source")), ["edit-source src/http/upload.ts"]);
    assert.ok(p.steps.some((s) => s.file === "tests/http/upload.spec.ts"));
  } },
  { id: "svc-phrase-dominates-symptom", kind: "refuse", condition: "phrase-dominance", run: (m, c) => {
    // The request names the component; `handle` only shows the symptom.
    const p = planOn(m, c, SVC, "Fix the cache loader: `handle` returns 400 for every cached id.");
    assert.deepEqual(shape(p).filter((s) => s.startsWith("edit-source")), ["edit-source src/cache/cache-loader.ts"]);
  } },
  { id: "svc-pattern-constant", kind: "admit", condition: "pattern-owner", run: (m, c) => {
    const p = planOn(m, c, SVC, "Fix the email pattern used by `validateEmail`: it accepts spaces. Add a test.");
    assert.deepEqual(shape(p), ["edit-source src/patterns.ts", "edit-test tests/http/request-handler.spec.ts", "run-tests -"]);
    assert.equal(p.steps[0]!.missing, "edit-constant");
  } },
  { id: "svc-no-pattern-refused", kind: "refuse", condition: "pattern-owner", run: (m, c) => {
    const p = planOn(m, c, SVC, "`validateEmail` accepts spaces. Fix it and add a test.");
    assert.deepEqual(shape(p), ["edit-source src/http/request-handler.ts", "edit-test tests/http/request-handler.spec.ts", "run-tests -"]);
  } },
];
