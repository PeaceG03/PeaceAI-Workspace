import assert from "node:assert/strict";
import test from "node:test";

import { LIMITS } from "./config";

test("LIMITS.timeoutMs is 3000", () => {
  assert.deepEqual(LIMITS.timeoutMs, 3000);
});
