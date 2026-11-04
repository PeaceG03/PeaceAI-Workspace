// M182 (batch 19): repair-v2's member-callee localisation (spec: peaceai/spec/repair-v2-m182.md). Behavior cases live in
// m182-cases.ts (the pure ones are replayed against mutants by m182-mutation.test.ts); this file runs them once and
// checks that the new code names no dev task. Synthetic fixtures only; no network. The end-to-end case needs the
// candidate uid named by M182_CAND; without it, it asserts the CAND_UID_* refusal. Like m179-anchor.test.ts, the
// end-to-end case (a real loop run as the shared candidate uid, which another session's stage-2 run may disturb) may
// run up to E2E_TRIES times; a pure case is never retried.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import * as prop from "../lib/editpropose.ts";
import { E2E_LOAD } from "./m174-cases.ts";
import { CASES, m182Cand, setup, teardown, type Ctx } from "./m182-cases.ts";
import { E2E_TRIES, withE2eRetry } from "./m178-cases.ts";

const ROOT = resolve(import.meta.dirname, "../..");
let ctx: Ctx;
before(() => { ctx = setup(); });
after(() => teardown(ctx));

test("M182: environment", (t) => { t.diagnostic(m182Cand() ? `candidate uid available: the end-to-end case runs for real (up to ${E2E_TRIES} tries, load factor ${E2E_LOAD})` : "no candidate uid here: the end-to-end case asserts the CAND_UID_* refusal"); });
for (const c of CASES) test(`M182: ${c.id}`, (t) => (c.needsCand && m182Cand() ? withE2eRetry(t, () => c.run({ prop }, ctx)) : c.run({ prop }, ctx)));

test("M182: the new code and its fixtures name no dev task", () => {
  const dev = /PeaceSTOCKS|peacestocks|defu|destr|scule|ohash|yup|valibot|remeda|neverthrow|kysely|superstruct|p-queue/i;
  const src = readFileSync(join(ROOT, "peaceai/lib/editpropose.ts"), "utf8");
  const m182 = src.slice(src.indexOf("// ---- M182 member callees"), src.indexOf("// ---- templates"));
  assert.ok(m182.length > 1000);
  assert.doesNotMatch(m182, dev);
  const cases = readFileSync(join(ROOT, "peaceai/test/m182-cases.ts"), "utf8").split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n");
  assert.doesNotMatch(cases, dev);
});
