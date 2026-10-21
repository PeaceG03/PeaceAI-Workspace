import assert from "node:assert/strict";
import test from "node:test";
import { parseQuantity } from "./config";

test("quantity parsing", () => {
  assert.equal(parseQuantity("2.5"), 1);
  assert.equal(parseQuantity("0"), 1);
  assert.equal(parseQuantity(" 3 "), 3);
  assert.equal(parseQuantity("1e2"), 100);
});
