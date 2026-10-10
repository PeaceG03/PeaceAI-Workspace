import assert from "node:assert/strict";
import test from "node:test";

import { GUEST, isGuest } from "./presets";

test("the guest profile is recognised", () => {
  assert.equal(isGuest(GUEST), true);
  assert.equal(isGuest({ id: "u1", displayName: "U" }), false);
});
