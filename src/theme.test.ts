import assert from "node:assert/strict";
import test from "node:test";

import { DEFAULT_THEME, themeLabel } from "./theme";

test("the default theme label is its name", () => {
  assert.equal(themeLabel(DEFAULT_THEME), "plain");
});

test("a dark theme says so in its label", () => {
  assert.equal(themeLabel({ ...DEFAULT_THEME, dark: true }), "plain (dark)");
});
