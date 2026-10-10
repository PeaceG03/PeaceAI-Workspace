import assert from "node:assert/strict";
import test from "node:test";

import { normalizeLabel } from "./numbers";

test("normalizeLabel trims only surrounding whitespace", () => {
  assert.equal(normalizeLabel("  example"), "example");
  assert.equal(normalizeLabel("example  "), "example");
  assert.equal(normalizeLabel(" \t example \n"), "example");
  assert.equal(normalizeLabel("example"), "example");
});
