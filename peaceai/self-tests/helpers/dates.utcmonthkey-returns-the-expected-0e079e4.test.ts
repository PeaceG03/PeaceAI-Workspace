import assert from "node:assert/strict";
import test from "node:test";
import { utcMonthKey } from "./dates";

test("utcMonthKey returns the expected values", () => {
  assert.equal(utcMonthKey("2026-10-16"), "2026-10");
  assert.equal(utcMonthKey("2026-10-16T23:59:00Z"), "2026-10");
  assert.throws(() => utcMonthKey("2026"), /BAD_DAY/);
});
