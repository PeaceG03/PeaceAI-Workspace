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
  const holes = [
    "from the test file",
    "src/",
    "(and eggs) from the store",
    "the iPhone from the store",
    "from aisle B12",
    "on page4",
    "from the McDonald essay",
    "from chapter 3/4.5 of the book",
    "(night shift) is tiring",
    "(pages 3-4)",
  ];
  const cues: Record<string, string> = {
    TEST_CASE_EXISTING: "characterization test",
    TEST_CASE_APPEND: "append a test",
    TEST_CASE: "regression tests",
    METHOD_GUARD: "with a method",
    THROW_GUARD: "guard",
    ENV_FIX: "environment variable",
    IMPORT_EDIT: "import",
    DERIVE_FROM_BEHAVIOR: "derive",
    LOOP_FUNCTION: "loop function",
    COMPLEX_FUNCTION: "complex function",
    WORKFLOW_JOB: "workflow of the job",
    WORKFLOW_STEP: "cron",
    ADD_FUNCTION_NEW_MODULE: "new module",
    ADD_FUNCTION: "add helper",
    TSCONFIG_SCRIPT: "typecheck",
    MODIFY_LOGIC: "fail closed",
    CHECK_OBJECT_LITERAL_ARGS: "object-literal",
  };
  const fixed = [
    "please import the milk from the test file",
    "please import the milk src/",
    "please import the milk (and eggs) from the store",
    "please import the iPhone from the store",
    "please import the milk from aisle B12",
    "derive a conclusion from the essay (pages 3-4)",
    "derive a conclusion from the essay on page4",
    "derive a conclusion from the McDonald essay",
    "derive the answer from chapter 3/4.5 of the book",
    "the workflow of the job (night shift) is tiring",
  ];
  for (const sentence of fixed) assert.equal(guessFamily(model, sentence).family, null, sentence);
  for (const family of model.families) {
    const cue = cues[family];
    assert.ok(cue, family);
    for (const hole of holes) assert.equal(guessFamily(model, `please ${cue} ${hole}`).family, null, `${family}: ${hole}`);
  }
  const dev = scoreFamilies(model, rows, false);
  assert.equal(dev.wrong, 0);
  assert.ok(dev.correct > 0);
});

test("held-out is scored only after the cues are frozen", () => {
  const held = scoreFamilies(trainRequestModel(rows), rows, true);
  assert.deepEqual(held, { rows: 39, correct: 16, wrong: 0, refused: 23 });
});
