import assert from "node:assert/strict";
import test from "node:test";
import { truncate } from "./text";

test("short limits", () => {
  assert.equal(truncate("abc", 1), "a");
  assert.equal(truncate("abc", 0), "");
  assert.equal(truncate("abcd", 2), "a…");
});
