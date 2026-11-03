// M176 (batch 15): repair-v2's SStuB edit classes (spec: peaceai/spec/repair-v2-m176.md). Behavior cases live in
// m176-cases.ts (the pure ones are replayed against mutants by m176-mutation.test.ts); this file runs them once and
// checks that the new code names no dev task. Synthetic fixtures only; no network. The end-to-end case needs the
// candidate uid named by M176_CAND (peaceai-cand3 on the box); without it, it asserts the CAND_UID_* refusal.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import * as prop from "../lib/editpropose.ts";
import { CASES, m176Cand, setup, teardown, type Ctx } from "./m176-cases.ts";

const ROOT = resolve(import.meta.dirname, "../..");
let ctx: Ctx;
before(() => { ctx = setup(); });
after(() => teardown(ctx));

test("M176: environment", (t) => { t.diagnostic(m176Cand() ? "candidate uid available: the end-to-end case runs for real" : "no candidate uid here: the end-to-end case asserts the CAND_UID_* refusal"); });
for (const c of CASES) test(`M176: ${c.id}`, () => c.run({ prop }, ctx));

test("M176: the new code and its fixtures name no dev task", () => {
  const dev = /PeaceSTOCKS|peacestocks|defu|destr|scule|ohash|yup|valibot|remeda|neverthrow|kysely|superstruct|p-queue/i;
  const src = readFileSync(join(ROOT, "peaceai/lib/editpropose.ts"), "utf8");
  const m176 = src.slice(src.indexOf("// ---- M176 SStuB templates"), src.indexOf("const parses = "));
  assert.ok(m176.length > 1000);
  assert.doesNotMatch(m176, dev);
  const cases = readFileSync(join(ROOT, "peaceai/test/m176-cases.ts"), "utf8").split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n");
  assert.doesNotMatch(cases, dev);
});
