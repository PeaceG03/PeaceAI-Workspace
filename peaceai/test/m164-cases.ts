// M164 (part B) cases: what plan-only-v4's named-test rule must pick (admit) and the near miss it must leave to v3's
// import-based pick (refuse), for each of its tagged rules. Each case runs against a planner module (v4 adapted to
// M153's PlannerModule shape), so m164-plan-v4.test.ts can run the same cases against v4 with one tagged rule removed.
// Condition ids are the new `rule:<id>` tags in plan4.ts.
import assert from "node:assert/strict";
import { planOn, type Case, type PlannerModule, type CaseCtx } from "./m153-cases.ts";
import { SCHEMA, schemaWith, WS } from "./m164-fixtures.ts";

export type { Case, CaseCtx, PlannerModule };
type Plan = ReturnType<typeof planOn>;
const shape = (p: Plan) => p.steps.map((s) => `${s.action} ${s.file ?? "-"}`);

export const ONE = "`create` returns undefined when a fallback is given.";
export const EXAMPLE_ONLY = "Fallbacks are ignored:\n- `create(undefined, 3)` returns undefined instead of 3";
export const BOTH = "`coerce` is not applied: `create(\"1\", 0)` returns \"1\".";
export const NONE = "`assertValid` accepts null.";
const TWO = schemaWith([{ path: "test/node/create.test.ts", content: 'import { create } from "../../src/index.ts";\n' }]);
const WS_OWN = [...WS, { path: "packages/core/test/api/create.test.ts", content: 'import { create } from "../../src/index.ts";\n' }];

export const CASES_V4: Case[] = [
  { id: "named-beats-aggregate", kind: "admit", condition: "test-named", run: (m, c) => {
    // The aggregate typings test imports src/struct.ts directly (v3's pick); the test named after `create` wins.
    const p = planOn(m, c, SCHEMA, ONE);
    assert.deepEqual(shape(p), ["edit-source src/struct.ts", "edit-test test/api/create.test.ts", "run-tests -"]);
    assert.equal(p.tests.command, "pnpm vitest run test/api/create.test.ts");
    assert.equal(p.files.find((f) => f.path === "test/api/create.test.ts")?.reason, "named by the request");
  } },
  { id: "no-named-test-keeps-v3", kind: "refuse", condition: "test-named", run: (m, c) => {
    // No test is named after `assertValid`: v3's import-based pick stands.
    assert.deepEqual(planOn(m, c, SCHEMA, NONE).tests.files, ["test/typings/struct.test.ts"]);
  } },
  { id: "helper-named-ignored", kind: "refuse", condition: "test-named", run: (m, c) => {
    // A helper file named after the function is not a behavior test, so it is never the named test.
    const p = planOn(m, c, schemaWith([], (x) => x === "test/api/create.test.ts"), ONE);
    assert.deepEqual(p.tests.files, ["test/typings/struct.test.ts"]);
  } },
  { id: "named-replaces-v3-pick", kind: "admit", condition: "test-named-first", run: (m, c) => {
    assert.deepEqual(planOn(m, c, SCHEMA, ONE).tests.files, ["test/api/create.test.ts"]);
  } },
  { id: "named-not-added-to-v3-pick", kind: "refuse", condition: "test-named-first", run: (m, c) => {
    // The named test replaces v3's pick; it is not one more test step on top of it.
    const p = planOn(m, c, SCHEMA, ONE);
    assert.ok(!p.tests.files.includes("test/typings/struct.test.ts"), p.tests.files.join(" | "));
    assert.equal(p.steps.filter((s) => s.action === "edit-test" || s.action === "add-test").length, 1);
  } },
  { id: "unique-named", kind: "admit", condition: "test-named-unique", run: (m, c) => {
    assert.deepEqual(planOn(m, c, SCHEMA, ONE).tests.files, ["test/api/create.test.ts"]);
  } },
  { id: "two-named-refused", kind: "refuse", condition: "test-named-unique", run: (m, c) => {
    // Two test files are named after `create`: ambiguous, so v3's pick stands.
    assert.deepEqual(planOn(m, c, TWO, ONE).tests.files, ["test/typings/struct.test.ts"]);
  } },
  { id: "same-package-named", kind: "admit", condition: "test-named-package", run: (m, c) => {
    const p = planOn(m, c, WS_OWN, ONE);
    assert.deepEqual(shape(p), ["edit-source packages/core/src/struct.ts", "edit-test packages/core/test/api/create.test.ts", "run-tests -"]);
    assert.equal(p.tests.command, "cd packages/core && pnpm vitest run test/api/create.test.ts");
  } },
  { id: "other-package-named-refused", kind: "refuse", condition: "test-named-package", run: (m, c) => {
    // The only test named `create` is in another package than the planned source: v3's pick stands.
    assert.deepEqual(planOn(m, c, WS, ONE).tests.files, ["packages/core/test/struct.test.ts"]);
  } },
  { id: "example-name-when-no-plain-name", kind: "admit", condition: "test-named-examples-last", run: (m, c) => {
    // `create` appears only inside a code example and no plain name fits a test: the example's name is used.
    assert.deepEqual(planOn(m, c, SCHEMA, EXAMPLE_ONLY).tests.files, ["test/api/create.test.ts"]);
  } },
  { id: "plain-name-before-example", kind: "refuse", condition: "test-named-examples-last", run: (m, c) => {
    // `coerce` is a plain name with its own test, so the example's `create` adds nothing.
    assert.deepEqual(planOn(m, c, SCHEMA, BOTH).tests.files, ["test/api/coerce.test.ts"]);
  } },
];
