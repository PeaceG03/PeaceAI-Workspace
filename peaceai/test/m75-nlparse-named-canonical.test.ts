// M75: nlparse's learned-rule triggers are keyed by name (LEARNED_CANONICAL) instead of CANONICAL[CANONICAL.length - N]
// indexing. M74 showed the hazard: appending a trigger shifted every index, so unapproved wording read as approved.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ENV_FIX_TRIGGER } from "../lib/env-fix.ts";
import { IMPORT_EDIT_V2_TRIGGER } from "../lib/import-edit-v2.ts";
import { REPLACE_TRIGGER } from "../lib/learned-body.ts";
import { COMPLEX_TRIGGER, DATE_TRIGGER, LOOP_TRIGGER, WHILE_TRIGGER } from "../lib/learned-complex.ts";
import { FUNCTION_TRIGGER } from "../lib/learned-function.ts";
import { GUARD_TOP_TRIGGER, GUARD_TRIGGER } from "../lib/learned-guard.ts";
import { TEST_TRIGGER } from "../lib/learned-test.ts";
import { TEST_EXISTING_TRIGGER } from "../lib/learned-test-existing.ts";
import { WORKFLOW_TRIGGER } from "../lib/learned-workflow.ts";
import { METHOD_GUARD_TRIGGER } from "../lib/method-guard.ts";
import { LEARNED_CANONICAL, parseTask, type LearnedTriggerName } from "../lib/nlparse.ts";
import { TSCONFIG_SCRIPT_TRIGGER } from "../lib/tsconfig-script.ts";
import { WORKFLOW_JOB_TRIGGER } from "../lib/workflow-job.ts";
import { EXISTING_EDIT_TRIGGER } from "../lib/learned-edit-existing.ts";
import { DERIVE_APPEND_TRIGGER, DERIVE_STRING_TRIGGER, DERIVE_TRIGGER } from "../lib/learned-derive.ts";

const root = resolve(import.meta.dirname, "../..");
const KINDS: Record<LearnedTriggerName, string> = {
  setLiteral: "SET_LITERAL", switchCase: "ADD_SWITCH_CASE", nullishDefault: "ADD_NULLISH_DEFAULT", testCase: "ADD_TEST_CASE",
  throwGuard: "ADD_THROW_GUARD", addFunction: "ADD_FUNCTION", workflowStep: "ADD_WORKFLOW_STEP", replaceExpression: "REPLACE_EXPRESSION",
  throwGuardTop: "ADD_THROW_GUARD", methodGuard: "METHOD_GUARD", complexFunction: "COMPLEX_FUNCTION", loopFunction: "COMPLEX_FUNCTION",
  importEditV2: "IMPORT_EDIT_V2", loopWhile: "COMPLEX_FUNCTION", workflowJob: "WORKFLOW_JOB", tsconfigScript: "TSCONFIG_SCRIPT",
  envFix: "ENV_FIX", dateFunction: "COMPLEX_FUNCTION", testExisting: "TEST_EXISTING", existingEdit: "EXISTING_EDIT", deriveFromBehavior: "DERIVE_FROM_BEHAVIOR",
  deriveAppend: "DERIVE_FROM_BEHAVIOR",
  deriveString: "DERIVE_FROM_BEHAVIOR",
};
const ENGINE: Partial<Record<LearnedTriggerName, string>> = {
  testCase: TEST_TRIGGER, throwGuard: GUARD_TRIGGER, addFunction: FUNCTION_TRIGGER, workflowStep: WORKFLOW_TRIGGER, replaceExpression: REPLACE_TRIGGER,
  throwGuardTop: GUARD_TOP_TRIGGER, methodGuard: METHOD_GUARD_TRIGGER, complexFunction: COMPLEX_TRIGGER, loopFunction: LOOP_TRIGGER,
  importEditV2: IMPORT_EDIT_V2_TRIGGER, loopWhile: WHILE_TRIGGER, workflowJob: WORKFLOW_JOB_TRIGGER, tsconfigScript: TSCONFIG_SCRIPT_TRIGGER,
  envFix: ENV_FIX_TRIGGER, dateFunction: DATE_TRIGGER, testExisting: TEST_EXISTING_TRIGGER, existingEdit: EXISTING_EDIT_TRIGGER, deriveFromBehavior: DERIVE_TRIGGER,
  deriveAppend: DERIVE_APPEND_TRIGGER,
  deriveString: DERIVE_STRING_TRIGGER,
};

test("every learned trigger is keyed by name with its pinned kind, and each name maps to its own engine trigger", () => {
  assert.deepEqual(Object.fromEntries(Object.entries(LEARNED_CANONICAL).map(([n, t]) => [n, t.kind])), KINDS);
  for (const [n, src] of Object.entries(ENGINE)) {
    const t = LEARNED_CANONICAL[n as LearnedTriggerName];
    assert.equal(t.re.source, new RegExp(src, "imu").source, n);
    assert.equal(t.re.flags, "imu", n);
  }
  const sources = Object.values(LEARNED_CANONICAL).map((t) => t.re.source);
  assert.equal(new Set(sources).size, sources.length, "no two names share a trigger");
  for (const [n, t] of Object.entries(LEARNED_CANONICAL)) assert.equal(t.family !== null, ["setLiteral", "switchCase", "nullishDefault"].includes(n), n);
});

test("no positional indexing into CANONICAL is left in nlparse.ts", () => {
  const src = readFileSync(resolve(root, "peaceai/lib/nlparse.ts"), "utf8");
  assert.doesNotMatch(src, /CANONICAL\.length\s*-/);
  assert.doesNotMatch(src, /CANONICAL\[\s*\d/);
  assert.doesNotMatch(src, /CANONICAL\.slice\(/);
});

// Approval follows the name's kind: canonical only when that kind is approved, RULE_NOT_APPROVED otherwise,
// and approving some other kind does not help.
const fn = (head: string) => `${head} \`f(n: number): number\` to \`src/a.ts\` with body:\nconst m = n * 2;\nreturn m;\n- f(2) is 4`;
const SAMPLES: [LearnedTriggerName, string][] = [
  ["setLiteral", 'Change name in src/theme.ts to "classic"'],
  ["complexFunction", fn("add complex function")],
  ["loopFunction", fn("add loop function")],
  ["loopWhile", fn("add while loop function")],
  ["dateFunction", 'add date function `f(d: Date): number` to `src/a.ts` with body:\nconst m = d.getUTCHours() * 60;\nreturn m + d.getUTCMinutes();\n- f(new Date("2026-10-16T05:30:00Z")) is 330'],
  ["testExisting", 'add a characterization test for `isOutage` in `src/a.ts`: outage codes\n- isOutage("MASSIVE_HTTP_503 x") is true\n- isOutage("MASSIVE_HTTP_404") is false'],
];
for (const [name, body] of SAMPLES) test(`approval by name: ${name}`, () => {
  assert.ok(body.split("\n").some((l) => LEARNED_CANONICAL[name].re.test(l.trim())), `${name}: sample matches its own trigger`);
  const kind = LEARNED_CANONICAL[name].kind;
  const parse = (kinds: string[]) => parseTask({ title: "", body }, { model: null, approvedKinds: new Set(kinds) });
  const off = parse([]);
  assert.equal(off.status, "unsure", name); if (off.status === "unsure") assert.equal(off.reason, "RULE_NOT_APPROVED", name);
  const other = parse(Object.values(KINDS).filter((k) => k !== kind));
  assert.equal(other.status, "unsure", `${name}: every other kind approved is still not enough`);
  assert.equal(parse([kind]).status, "canonical", name);
});
