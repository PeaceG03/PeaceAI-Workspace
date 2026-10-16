// Auditor note on #242: regrade.ts accepts a version digit in learned transformation ids, same rule as gate.ts.
import assert from "node:assert/strict";
import test from "node:test";
import { validChosenMeta } from "../lib/regrade.ts";

const meta = (transformations: unknown[]) => ({ runId: "123", candidateId: "candidate-1", baseSha: "a".repeat(40), operationId: null, transformations });

test("regrade meta: LEARNED_IMPORT_EDIT_V2 accepted; leading digit, lower case, dash, empty and over-long refused", () => {
  assert.equal(validChosenMeta(meta(["LEARNED_IMPORT_EDIT_V2"])), true);
  assert.equal(validChosenMeta(meta(["LEARNED_SET_LITERAL"])), true);
  for (const t of ["2LEARNED", "LEARNED_v2", "LEARNED-V2", "", "_LEARNED", "A".repeat(41)]) assert.equal(validChosenMeta(meta([t])), false, t);
  assert.equal(validChosenMeta(meta([])), false, "at least one transformation");
});
