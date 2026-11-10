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

test("dev accepted answers are correct, and held-out is only scored", () => {
  const model = trainRequestModel(rows);
  void thresholdOnDev(rows);
  const dev = scoreFamilies(model, rows, false);
  assert.equal(dev.wrong, 0);
  assert.ok(dev.correct > 0);
  const held = scoreFamilies(model, rows, true);
  assert.ok(held.rows > 0);
  assert.ok(held.correct + held.wrong + held.refused === held.rows);
});
