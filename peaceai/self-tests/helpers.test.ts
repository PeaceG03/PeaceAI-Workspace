import test from "node:test";
import assert from "node:assert/strict";
import { plural, truncate } from "./helpers/text.ts";
import { minutesOfUtcDay, utcDayKey } from "./helpers/dates.ts";

test("text helpers", () => {
  assert.equal(plural(1, "run"), "1 run");
  assert.equal(plural(3, "run"), "3 runs");
  assert.equal(truncate("abcdef", 4), "abc…");
  assert.equal(truncate("abc", 4), "abc");
  assert.equal(truncate("abc", 0), "");
});

test("date helpers", () => {
  assert.equal(utcDayKey(new Date("2026-10-16T23:59:00Z")), "2026-10-16");
  assert.equal(minutesOfUtcDay(new Date("2026-10-16T05:30:00Z")), 330);
});
