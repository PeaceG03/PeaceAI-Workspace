import assert from "node:assert/strict";
import test from "node:test";
import { truncate } from "./text";

test("truncate edges", () => {
  assert.equal(truncate("abcd", 1), "…");
  assert.equal(truncate("abcd", 4), "abcd");
  assert.equal(truncate("abcd", -2), "");
  assert.equal(truncate("", 3), "");
});
