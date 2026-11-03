// M177 (batch 16): repair-v2's statement-level edits (spec: peaceai/spec/repair-v2-m177.md). Behavior cases live in
// m177-cases.ts (the pure ones are replayed against mutants by m177-mutation.test.ts); this file runs them once and
// checks that the new code names no dev task. Synthetic fixtures only; no network. The end-to-end case needs the
// candidate uid named by M177_CAND (peaceai-cand3 on the box); without it, it asserts the CAND_UID_* refusal.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import * as prop from "../lib/editpropose.ts";
import { CASES, m177Cand, setup, teardown, type Ctx } from "./m177-cases.ts";

const ROOT = resolve(import.meta.dirname, "../..");
let ctx: Ctx;
before(() => { ctx = setup(); });
after(() => teardown(ctx));

test("M177: environment", (t) => { t.diagnostic(m177Cand() ? "candidate uid available: the end-to-end case runs for real" : "no candidate uid here: the end-to-end case asserts the CAND_UID_* refusal"); });
for (const c of CASES) test(`M177: ${c.id}`, () => c.run({ prop }, ctx));

test("M177: the new code and its fixtures name no dev task", () => {
  const dev = /PeaceSTOCKS|peacestocks|defu|destr|scule|ohash|yup|valibot|remeda|neverthrow|kysely|superstruct|p-queue/i;
  const src = readFileSync(join(ROOT, "peaceai/lib/editpropose.ts"), "utf8");
  const m177 = src.slice(src.indexOf("// ---- M177 statement-level templates"), src.indexOf("const parses = "));
  assert.ok(m177.length > 1000);
  assert.doesNotMatch(m177, dev);
  const cases = readFileSync(join(ROOT, "peaceai/test/m177-cases.ts"), "utf8").split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n");
  assert.doesNotMatch(cases, dev);
});
