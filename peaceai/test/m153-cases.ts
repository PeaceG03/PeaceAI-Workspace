// M153 cases: what plan-only-v3 must plan on three code shapes (admit), and the near miss it must refuse for each of
// its rules (refuse). Each case runs against a planner module, so the mutation check in m153-plan-v3.test.ts can run
// the same cases against a planner with one tagged rule removed. Condition ids are the `rule:<id>` tags in plan3.ts.
import assert from "node:assert/strict";
import type { RuleSpec } from "../lib/learned.ts";
import type { IndexFile } from "../lib/symbols.ts";
import { BARE, GEO, geoWith, MONO, plainWith } from "./m153-fixtures.ts";

export interface PlannerModule {
  planTaskV3: typeof import("../lib/plan3.ts").planTaskV3;
  repoFromFiles: typeof import("../lib/plan3.ts").repoFromFiles;
}
export interface CaseCtx { rules: RuleSpec[]; model: any; targetRepo: string }
type Plan = ReturnType<PlannerModule["planTaskV3"]>;
export interface Case { id: string; kind: "admit" | "refuse"; condition: string; run(mod: PlannerModule, ctx: CaseCtx): void }

export function planOn(mod: PlannerModule, ctx: CaseCtx, files: IndexFile[], request: string, repo = "example-org/fixture"): Plan {
  const r = mod.repoFromFiles(files);
  try { return mod.planTaskV3("m153", request, { repo, files: files.filter((f) => /\.[cm]?[jt]sx?$/.test(f.path)), rules: ctx.rules, model: ctx.model, testCommand: null }, r.code); }
  finally { r.close(); }
}
const shape = (p: Plan) => p.steps.map((s) => `${s.action} ${s.file ?? "-"}`);
const reasons = (p: Plan) => p.files.filter((f) => f.role === "source").map((f) => `${f.path}: ${f.reason}`);
const srcs = (p: Plan) => p.steps.filter((s) => s.action === "edit-source").map((s) => s.file);
const PLAIN_TEST = "spec/slug.spec.js";
const slug = "`slugify` keeps double dashes.";

export const CASES: Case[] = [
  // ---- scope: one source step per file a stated name lives in
  { id: "geo-one-name", kind: "admit", condition: "source-filter", run: (m, c) => {
    const p = planOn(m, c, GEO, "`area` returns the diameter for negative input.");
    assert.deepEqual(shape(p), ["edit-source src/area.ts", "edit-test test/area.test.ts", "run-tests -"]);
    assert.deepEqual(reasons(p), ["src/area.ts: defines area"]);
  } },
  { id: "geo-examples-dir-refused", kind: "refuse", condition: "source-filter", run: (m, c) => {
    const p = planOn(m, c, GEO, "`area` returns the diameter for negative input.");
    assert.ok(!p.files.some((f) => f.path.startsWith("examples/")), reasons(p).join(" | "));
  } },
  { id: "geo-scale-two", kind: "admit", condition: "test-direct", run: (m, c) => {
    // Two stated names in two files: two source steps, two test steps, one run.
    const p = planOn(m, c, GEO, "`area` and `round` both mishandle negative zero.");
    assert.deepEqual(shape(p), ["edit-source src/area.ts", "edit-source src/round.ts", "edit-test test/area.test.ts", "edit-test test/round.test.ts", "run-tests -"]);
    assert.deepEqual(p.understanding.scope, { names: 2, sources: 2, tests: 2 });
  } },
  { id: "geo-scale-shared-test", kind: "admit", condition: "test-direct", run: (m, c) => {
    // Three files share one test file: the test step is not repeated.
    const p = planOn(m, c, GEO, "`hue`, `tint` and `shade` overflow above 255.");
    assert.deepEqual(shape(p), ["edit-source src/hue.ts", "edit-source src/tint.ts", "edit-source src/shade.ts", "edit-test test/color.test.ts", "run-tests -"]);
  } },
  { id: "geo-indirect-test-refused", kind: "refuse", condition: "test-direct", run: (m, c) => {
    // test/api.test.ts reaches src/core.ts only through src/api.ts: not core's test; a new one goes beside the tests.
    const p = planOn(m, c, GEO, "`sum` loses precision on large arrays.");
    assert.deepEqual(shape(p), ["edit-source src/core.ts", "add-test test/core.test.ts", "run-tests -"]);
  } },
  { id: "geo-eponymous-home", kind: "admit", condition: "home-eponymous", run: (m, c) => {
    // `round` is exported by src/round.ts and src/format.ts: the file named after it is its home.
    const p = planOn(m, c, GEO, "`round` returns -0 for small negative numbers.");
    assert.deepEqual(reasons(p), ["src/round.ts: defines round"]);
  } },
  { id: "geo-ambiguous-refused", kind: "refuse", condition: "home-eponymous", run: (m, c) => {
    // `part` is a private helper in two files, neither named after it: the name locates nothing.
    const p = planOn(m, c, GEO, "`part` rounds the wrong way.");
    assert.ok(!reasons(p).some((r) => r.endsWith("defines part")), reasons(p).join(" | "));
  } },
  { id: "geo-exported-home", kind: "admit", condition: "home-exported", run: (m, c) => {
    // `scale` is exported only by src/vector.ts (src/matrix.ts keeps a private one).
    const p = planOn(m, c, GEO, "`scale` ignores a zero factor.");
    assert.deepEqual(shape(p), ["edit-source src/vector.ts", "edit-test test/scale.test.ts", "run-tests -"]);
    assert.deepEqual(reasons(p), ["src/vector.ts: defines scale"]);
  } },
  { id: "geo-private-twice-refused", kind: "refuse", condition: "home-exported", run: (m, c) => {
    const p = planOn(m, c, GEO, "The `part` helper should never return a fraction.");
    assert.ok(!p.files.some((f) => f.reason === "defines part"), reasons(p).join(" | "));
  } },
  { id: "geo-max-sources", kind: "admit", condition: "max-sources", run: (m, c) => {
    const p = planOn(m, c, GEO, "Rename the first parameter of `area`, `round`, `toCm`, `scale`, `hue` and `tint`.");
    assert.equal(srcs(p).length, 6);
  } },
  { id: "geo-max-sources-cap-refused", kind: "refuse", condition: "max-sources", run: (m, c) => {
    const p = planOn(m, c, GEO, "Rename the first parameter of `area`, `round`, `toCm`, `scale`, `hue`, `tint` and `shade`.");
    assert.equal(srcs(p).length, 6, "a bound, not a target: never more than MAX_SOURCES_V3");
  } },
  { id: "geo-qualifier", kind: "admit", condition: "qualifier-home", run: (m, c) => {
    // `len` is a method (no module-level definition): the qualifier's file is its home.
    const p = planOn(m, c, GEO, "`Vec.len` returns the Manhattan length instead of the Euclidean one.");
    assert.deepEqual(shape(p), ["edit-source src/vec.ts", "edit-test test/vec.test.ts", "run-tests -"]);
    assert.deepEqual(reasons(p), ["src/vec.ts: defines Vec"]);
    // With another stated name, the qualifier still places the method (the qualifier alone is never a stated subject).
    const q = planOn(m, c, GEO, "`Vec.len` and `area` both ignore the sign of their inputs.");
    assert.deepEqual(srcs(q), ["src/vec.ts", "src/area.ts"]);
  } },
  { id: "geo-qualifier-external-refused", kind: "refuse", condition: "qualifier-home", run: (m, c) => {
    const p = planOn(m, c, GEO, "Use `Math.hypot` for the length.");
    assert.ok(!reasons(p).some((r) => /defines (?:Math|hypot)/.test(r)), reasons(p).join(" | "));
  } },
  { id: "geo-example-only", kind: "admit", condition: "example-fallback", run: (m, c) => {
    const p = planOn(m, c, GEO, "Calling `area(-1) > 0` should be false; negative radii are invalid.");
    assert.deepEqual(reasons(p), ["src/area.ts: defines area"]);
  } },
  { id: "geo-example-not-subject-refused", kind: "refuse", condition: "example-fallback", run: (m, c) => {
    // The bare name is the subject; a name inside a code example is usage context only.
    const p = planOn(m, c, GEO, "`round` drops digits, e.g. `round(area(1), 2) === 3.14` fails.");
    assert.deepEqual(srcs(p), ["src/round.ts"]);
  } },
  { id: "geo-no-names", kind: "admit", condition: "rank-fallback", run: (m, c) => {
    const p = planOn(m, c, GEO, "The circle perimeter calculation returns the diameter instead.");
    assert.equal(srcs(p).length, 1);
    assert.match(reasons(p)[0] ?? "", /: best search match$/);
  } },
  { id: "geo-nothing-refused", kind: "refuse", condition: "rank-fallback", run: (m, c) => {
    const p = planOn(m, c, GEO, "Please make it better overall.");
    assert.equal(p.steps[0]!.file, null);
    assert.equal(p.steps[0]!.missing, "understand-request");
  } },
  // ---- tests
  { id: "geo-helper-not-test", kind: "admit", condition: "behavior-test", run: (m, c) => {
    // test/helpers.ts imports src/units.ts but holds no test cases: a new test file goes beside the tests.
    const p = planOn(m, c, GEO, "`toCm` should round to two decimals.");
    assert.deepEqual(shape(p), ["edit-source src/units.ts", "add-test test/units.test.ts", "run-tests -"]);
  } },
  { id: "geo-helpers-named-test-kept", kind: "refuse", condition: "behavior-test", run: (m, c) => {
    // Near miss: test/helpers.test.ts is named like a helper but is a test file with cases: it is units' test.
    const files = geoWith([{ path: "test/helpers.test.ts", content: 'import { toCm } from "../src/units.ts";\nimport { test, expect } from "vitest";\ntest("toCm", () => { expect(toCm(1)).toBe(2.54); });\n' }]);
    const p = planOn(m, c, files, "`toCm` should round to two decimals.");
    assert.deepEqual(shape(p), ["edit-source src/units.ts", "edit-test test/helpers.test.ts", "run-tests -"]);
  } },
  { id: "geo-new-test", kind: "admit", condition: "new-test-beside", run: (m, c) => {
    const p = planOn(m, c, GEO, "`toCm` should round to two decimals.");
    assert.equal(p.steps.find((s) => s.action === "add-test")?.file, "test/units.test.ts");
    assert.equal(p.steps.find((s) => s.action === "add-test")?.missing, "add-test-file");
  } },
  { id: "bare-no-tests", kind: "refuse", condition: "new-test-beside", run: (m, c) => {
    // No test files at all: the test step stays, with no invented path.
    const p = planOn(m, c, BARE, "`djb2` overflows on long input.");
    assert.deepEqual(shape(p), ["edit-source src/hash.ts", "add-test -", "run-tests -"]);
  } },
  { id: "bare-test-step-always", kind: "admit", condition: "test-step-always", run: (m, c) => {
    const p = planOn(m, c, BARE, "`djb2` overflows on long input.");
    assert.equal(p.steps.filter((s) => s.action === "add-test").length, 1);
    assert.equal(p.tests.command, null, "no scripts, no runner: no command is invented");
  } },
  { id: "geo-test-found-no-placeholder", kind: "refuse", condition: "test-step-always", run: (m, c) => {
    // Near miss: when a test file is found, no placeholder test step is added beside it.
    const p = planOn(m, c, GEO, "`area` returns the diameter.");
    assert.ok(!p.steps.some((s) => s.file === null && s.action !== "run-tests"), shape(p).join(" | "));
  } },
  { id: "mono-new-test-own-package", kind: "refuse", condition: "new-test-same-package", run: (m, c) => {
    // tools/release.ts belongs to the root package, which has no tests: never a test in another package.
    const p = planOn(m, c, MONO, "`releaseTag` should not add a second v prefix.");
    assert.deepEqual(shape(p), ["edit-source tools/release.ts", "add-test -", "run-tests -"]);
  } },
  { id: "geo-tests-only", kind: "admit", condition: "tests-only", run: (m, c) => {
    const p = planOn(m, c, GEO, "Add more tests for `toCm`.");
    assert.deepEqual(shape(p), ["add-test test/units.test.ts", "run-tests -"]);
    assert.equal(p.understanding.testsOnly, true);
  } },
  { id: "geo-fix-and-tests-refused", kind: "refuse", condition: "tests-only", run: (m, c) => {
    const p = planOn(m, c, GEO, "Add tests for `toCm` and fix its rounding.");
    assert.deepEqual(srcs(p), ["src/units.ts"]);
  } },
  // ---- can-do and run-tests status
  { id: "geo-can-do-guard", kind: "admit", condition: "can-do-same-file", run: (m, c) => {
    const p = planOn(m, c, GEO, "`clamp` should throw `RANGE_INVALID` when lo > hi.\n- `clamp(5, 3, 1)` throws `RANGE_INVALID`\nAdd a test.");
    const src = p.steps.find((s) => s.file === "src/clamp.ts");
    assert.equal(src?.status, "can-do");
    assert.match(src?.rule ?? "", /^public-throw-guard-v1@[0-9a-f]{64}$/);
    // The guard rule writes its own new test file, never test/clamp.test.ts: that step stays missing.
    assert.equal(p.steps.find((s) => s.file === "test/clamp.test.ts")?.status, "missing");
  } },
  { id: "geo-can-do-needs-examples-refused", kind: "refuse", condition: "can-do-same-file", run: (m, c) => {
    const p = planOn(m, c, GEO, "`clamp` should throw `RANGE_INVALID` when lo > hi. Add a test.");
    assert.ok(p.steps.every((s) => s.status === "missing"), shape(p).join(" | "));
  } },
  { id: "geo-run-tests-target-only", kind: "refuse", condition: "run-tests-target", run: (m, c) => {
    const req = "`area` returns the diameter.";
    assert.equal(planOn(m, c, GEO, req).steps.at(-1)!.status, "missing");
    const t = planOn(m, c, GEO, req, c.targetRepo).steps.at(-1)!;
    assert.equal(t.status, "can-do");
    assert.equal(t.rule, "pipeline:job-b-tests");
  } },
  // ---- the project's real test command
  { id: "geo-pnpm-vitest", kind: "admit", condition: "pm-lockfile", run: (m, c) => {
    const p = planOn(m, c, GEO, "`area` and `round` both mishandle negative zero.");
    assert.equal(p.tests.command, "pnpm vitest run test/area.test.ts test/round.test.ts");
    assert.deepEqual(p.testCommand, { pm: "pnpm", runner: "vitest", packageDir: "", form: "targeted" });
  } },
  { id: "plain-no-lock-refused", kind: "refuse", condition: "pm-lockfile", run: (m, c) => {
    const p = planOn(m, c, plainWith({ scripts: { test: "vitest" } }), slug);
    assert.equal(p.tests.command, `npx vitest run ${PLAIN_TEST}`);
  } },
  { id: "plain-pm-field", kind: "admit", condition: "pm-field", run: (m, c) => {
    const p = planOn(m, c, plainWith({ packageManager: "yarn@4.1.0", scripts: { test: "jest --ci" } }), slug);
    assert.equal(p.tests.command, `yarn jest ${PLAIN_TEST}`);
  } },
  { id: "plain-pm-field-near-miss", kind: "refuse", condition: "pm-field", run: (m, c) => {
    const p = planOn(m, c, plainWith({ packageManager: "yarnish@1.0.0", scripts: { test: "jest --ci" } }), slug);
    assert.equal(p.tests.command, `npx jest ${PLAIN_TEST}`);
  } },
  { id: "geo-runner-script", kind: "admit", condition: "runner-script", run: (m, c) => {
    const p = planOn(m, c, GEO, "`area` returns the diameter.");
    assert.equal(p.tests.command, "pnpm vitest run test/area.test.ts");
  } },
  { id: "plain-runner-word-part-refused", kind: "refuse", condition: "runner-script", run: (m, c) => {
    // `vitest-shim` is not the vitest runner; the declared dependency decides.
    const p = planOn(m, c, plainWith({ scripts: { test: "node tools/vitest-shim.mjs" }, devDependencies: { jest: "29.0.0" } }), slug);
    assert.equal(p.tests.command, `npx jest ${PLAIN_TEST}`);
  } },
  { id: "plain-runner-config", kind: "admit", condition: "runner-config", run: (m, c) => {
    const p = planOn(m, c, plainWith({ scripts: { test: "run-s check unit" } }, [{ path: "vitest.config.ts", content: "export default {};\n" }]), slug);
    assert.equal(p.tests.command, `npx vitest run ${PLAIN_TEST}`);
  } },
  { id: "plain-runner-config-elsewhere-refused", kind: "refuse", condition: "runner-config", run: (m, c) => {
    const p = planOn(m, c, plainWith({ scripts: { test: "run-s check unit" } }, [{ path: "docs/vitest.config.ts", content: "export default {};\n" }]), slug);
    assert.equal(p.tests.command, "npm test");
  } },
  { id: "plain-runner-deps", kind: "admit", condition: "runner-deps", run: (m, c) => {
    const p = planOn(m, c, plainWith({ scripts: { test: "c8 node run.js" }, devDependencies: { ava: "6.0.0" } }), slug);
    assert.equal(p.tests.command, `npx ava ${PLAIN_TEST}`);
  } },
  { id: "plain-runner-deps-near-miss", kind: "refuse", condition: "runner-deps", run: (m, c) => {
    const p = planOn(m, c, plainWith({ scripts: { test: "c8 node run.js" }, devDependencies: { "vitest-mock-extended": "1.0.0" } }), slug);
    assert.equal(p.tests.command, "npm test");
  } },
  { id: "mono-nearest-package", kind: "admit", condition: "nearest-package", run: (m, c) => {
    const p = planOn(m, c, MONO, "`Queue.drain` leaves the last item behind.");
    assert.deepEqual(shape(p), ["edit-source packages/core/src/queue.ts", "edit-test packages/core/__tests__/queue.test.ts", "run-tests -"]);
    assert.equal(p.tests.command, "cd packages/core && yarn jest __tests__/queue.test.ts");
  } },
  { id: "mono-root-package-refused", kind: "refuse", condition: "nearest-package", run: (m, c) => {
    const p = planOn(m, c, MONO, "`releaseTag` should not add a second v prefix.");
    assert.equal(p.tests.command, "yarn test");
  } },
  { id: "geo-targeted", kind: "admit", condition: "targeted-runner", run: (m, c) => {
    const p = planOn(m, c, GEO, "`sum` loses precision on large arrays.");
    assert.equal(p.tests.command, "pnpm vitest run test/core.test.ts");
  } },
  { id: "mono-mocha-script-refused", kind: "refuse", condition: "targeted-runner", run: (m, c) => {
    // mocha's TypeScript setup lives in its config and script: run the package's own script.
    const p = planOn(m, c, MONO, "`parseFlags` drops `--no-x` negations.");
    assert.deepEqual(shape(p), ["edit-source packages/cli/src/argv.ts", "edit-test packages/cli/test/argv.spec.ts", "run-tests -"]);
    assert.equal(p.tests.command, "cd packages/cli && yarn test");
  } },
  { id: "plain-script-fallback", kind: "admit", condition: "script-fallback", run: (m, c) => {
    const p = planOn(m, c, plainWith({ scripts: { "test:e2e": "playwright test", "test:unit": "node --test spec" } }), slug);
    assert.equal(p.tests.command, "npm run test:unit");
    assert.equal(p.testCommand.form, "script");
  } },
  { id: "plain-no-scripts-refused", kind: "refuse", condition: "script-fallback", run: (m, c) => {
    const p = planOn(m, c, plainWith({}), slug);
    assert.equal(p.tests.command, null);
    assert.equal(p.testCommand.form, "none");
  } },
];
