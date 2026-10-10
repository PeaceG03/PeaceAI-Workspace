import assert from "node:assert/strict";
import test from "node:test";

import { average, clamp, MAX_RETRIES, sum } from "./numbers";

test("clamp keeps values inside the range", () => {
  assert.equal(clamp(15, 0, 10), 10);
  assert.equal(clamp(-1, 0, 10), 0);
  assert.equal(clamp(4, 0, 10), 4);
});

test("sum and average handle empty and filled lists", () => {
  assert.equal(sum([]), 0);
  assert.equal(sum([1, 2, 3]), 6);
  assert.equal(average([]), 0);
  assert.equal(average([2, 4]), 3);
});

test("retry limit is positive", () => {
  assert.ok(MAX_RETRIES > 0);
});
