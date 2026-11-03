// M173 (batch 12): repair-v2's module-scope constant sites and const-value template (spec: peaceai/spec/repair-v2-m173.md).
// Behavior cases live in m173-cases.ts (replayed against mutants by m173-mutation.test.ts); this file runs them once and
// checks that repair-v1 and the earlier v2 lists are unchanged. Synthetic fixtures only; no network; no candidate uid.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import * as prop from "../lib/editpropose.ts";
import { CASES, setup, teardown, type Ctx } from "./m173-cases.ts";

const ROOT = resolve(import.meta.dirname, "../..");
let ctx: Ctx;
before(() => { ctx = setup(); });
after(() => teardown(ctx));

for (const c of CASES) test(`M173: ${c.id}`, () => c.run({ prop }, ctx));

test("M173: repair-v1 is unchanged (template list, callee depth); the new code names no dev task", () => {
  assert.deepEqual([...prop.TEMPLATES], ["missing-export", "nullish-check", "comparison", "arithmetic", "off-by-one", "logical", "default-value", "null-guard", "negate-condition", "boolean-return"]);
  assert.deepEqual(prop.CALLEE_DEPTH, { v1: 1, v2: 2 });
  const src = readFileSync(join(ROOT, "peaceai/lib/editpropose.ts"), "utf8");
  const code = src.split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n");
  assert.doesNotMatch(code, /PeaceSTOCKS|peacestocks|defu|destr|scule|ohash|yup|valibot|remeda|neverthrow|kysely|superstruct|p-queue/i);
});
