// M21: builder-log/** is in the protected set (no self-change may touch the log, its validator or its CI config).
import assert from "node:assert/strict";
import test from "node:test";
import { protectedReason } from "../lib/selfchange.ts";

test("protected (M21): every builder-log path is protected; lookalikes outside it are not matched by that entry", () => {
  for (const p of ["builder-log/tasks.jsonl", "builder-log/check.ts", "builder-log/check.test.ts", "builder-log/README.md", "builder-log/tsconfig.json", "builder-log/new/any.file"])
    assert.match(protectedReason(p) ?? "", /Builder task log/, p);
  for (const p of ["src/builder-log.ts", "docs/builder-log/x.md", "builder-logs/x"]) assert.doesNotMatch(protectedReason(p) ?? "", /Builder task log/, p);
});
