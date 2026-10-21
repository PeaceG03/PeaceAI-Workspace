import assert from "node:assert/strict";
import test from "node:test";
import { slugify } from "./text";

test("slug edges", () => {
  assert.equal(slugify(""), "");
  assert.equal(slugify("---"), "");
  assert.equal(slugify("Top 10 Tips"), "top-10-tips");
});
