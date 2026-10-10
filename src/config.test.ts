import assert from "node:assert/strict";
import test from "node:test";

import { DEFAULTS, parseCount, parseSettings, SUPPORTED_FORMATS, type LogLevel } from "./config";

test("defaults and formats", () => {
  assert.equal(DEFAULTS.retries, 3);
  assert.ok(SUPPORTED_FORMATS.includes("json"));
  const level: LogLevel = "info";
  assert.equal(level, "info");
});

test("parseCount reads integers and falls back to zero", () => {
  assert.equal(parseCount("12"), 12);
  assert.equal(parseCount("x"), 0);
});

test("parseSettings fills missing fields", () => {
  assert.deepEqual(parseSettings('{"name":"a"}'), { name: "a", retries: 3 });
});
