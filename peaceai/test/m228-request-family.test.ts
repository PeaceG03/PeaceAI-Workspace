// M228: request-to-family classifier. Dev and held-out are a hash split. Unsure refuses.
// EXPERIMENTAL. credit is false. The fixture sentences are made up.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { canonicalRequest, guessFamily, heldOutRow, scoreFamilies, thresholdOnDev, trainRequestModel, type FamilyRow } from "../lib/requestfamily.ts";

const log = readFileSync(resolve(import.meta.dirname, "../../builder-log/tasks.jsonl"), "utf8");
const rows: FamilyRow[] = log.split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l) as FamilyRow);

test("the hash split is stable and the two sides do not overlap", () => {
  assert.equal(heldOutRow(134, rows.find((r) => r.seq === 134)!.asked), heldOutRow(134, rows.find((r) => r.seq === 134)!.asked));
  const dev = rows.filter((r) => !heldOutRow(r.seq, r.asked));
  const held = rows.filter((r) => heldOutRow(r.seq, r.asked));
  assert.ok(dev.length > held.length);
  assert.equal(dev.filter((r) => held.some((h) => h.seq === r.seq)).length, 0);
});

test("a characterization sentence maps to the existing-test family, and a vague sentence refuses", () => {
  const model = trainRequestModel(rows);
  const yes = guessFamily(model, "Please add a characterization test for total in src/cart.ts");
  assert.equal(yes.family, "TEST_CASE_EXISTING");
  const no = guessFamily(model, "hello there friend");
  assert.equal(no.family, null);
  const line = canonicalRequest("TEST_CASE_EXISTING", "add a characterization test for total in src/cart.ts: totals");
  assert.equal(line, "add a characterization test for total in src/cart.ts: totals");
  assert.equal(canonicalRequest("TEST_CASE_EXISTING", "add a test someday"), null);
  assert.equal(canonicalRequest("ENV_FIX", "make env BUDGET_MS strict in src/gap.ts as integer 1..10"), "make env BUDGET_MS strict in src/gap.ts as integer 1..10");
});

test("an ordinary sentence does not pick a family, and dev accepted answers are correct", () => {
  const model = trainRequestModel(rows);
  void thresholdOnDev(rows);
  const prose: Record<string, string> = {
    TEST_CASE_EXISTING: "I took a characterization test at the clinic",
    TEST_CASE_APPEND: "please append a test to the soup",
    TEST_CASE: "write regression tests for the new employee",
    METHOD_GUARD: "please guard the milk with a method",
    THROW_GUARD: "guard the door and throw the ball",
    ENV_FIX: "please make the environment variable comfortable",
    IMPORT_EDIT: "please import the milk from the store",
    DERIVE_FROM_BEHAVIOR: "derive a conclusion from the essay",
    LOOP_FUNCTION: "the loop function of the poem is rhyme",
    COMPLEX_FUNCTION: "a complex function of the economy",
    WORKFLOW_JOB: "the workflow of the job is tiring",
    WORKFLOW_STEP: "please cron the bread to rise",
    ADD_FUNCTION_NEW_MODULE: "a new module of the course starts Monday",
    ADD_FUNCTION: "please add helper butter to the cake",
    TSCONFIG_SCRIPT: "typecheck the oven temperature",
    MODIFY_LOGIC: "fail closed the shop for the night",
    CHECK_OBJECT_LITERAL_ARGS: "the object-literal of my feelings",
  };
  for (const [family, sentence] of Object.entries(prose)) {
    assert.equal(guessFamily(model, sentence).family, null, `${family}: ${sentence}`);
  }
  for (const family of model.families) assert.ok(family in prose, family);
  const dev = scoreFamilies(model, rows, false);
  assert.equal(dev.wrong, 0);
  assert.ok(dev.correct > 0);
});
