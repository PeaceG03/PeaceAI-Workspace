import assert from "node:assert/strict";
import test from "node:test";
import { plural } from "./text";

test("plural counts", () => {
  assert.equal(plural(0, "run"), "0 runs");
  assert.equal(plural(1, "file"), "1 file");
  assert.equal(plural(-1, "run"), "-1 runs");
});
