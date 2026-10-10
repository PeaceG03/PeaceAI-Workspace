import assert from "node:assert/strict";
import test from "node:test";

import { EXPORT_KINDS, LIMITS, parseQuantity, readProfile, type Severity } from "./config";

test("limits and export kinds", () => {
  assert.equal(LIMITS.pageSize, 20);
  assert.ok(EXPORT_KINDS.includes("csv"));
  const level: Severity = "medium";
  assert.equal(level, "medium");
});

test("parseQuantity keeps positive integers and falls back to one", () => {
  assert.equal(parseQuantity("7"), 7);
  assert.equal(parseQuantity("-2"), 1);
  assert.equal(parseQuantity("abc"), 1);
});

test("readProfile needs an id and defaults the display name", () => {
  assert.deepEqual(readProfile('{"id":"u1"}'), { id: "u1", displayName: "u1" });
  assert.equal(readProfile("{}"), null);
});
