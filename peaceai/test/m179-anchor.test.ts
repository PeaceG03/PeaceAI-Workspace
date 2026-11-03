// M179 (batch 18): repair-v2's anchored continuation (spec: peaceai/spec/repair-v2-m179.md). Behavior cases live in
// m179-cases.ts (the pure ones are replayed against mutants by m179-mutation.test.ts); this file runs them once and
// checks that the new code names no dev task. Synthetic fixtures only; no network. The end-to-end case needs the
// candidate uid named by M179_CAND; without it, it asserts the CAND_UID_* refusal. Like m178-demote.test.ts, the
// end-to-end case (a real loop run as the shared candidate uid, which another session's stage-2 run may disturb) may
// run up to E2E_TRIES times; a pure case is never retried.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import * as prop from "../lib/editpropose.ts";
import { E2E_LOAD } from "./m174-cases.ts";
import { CASES, m179Cand, setup, teardown, type Ctx } from "./m179-cases.ts";
import { E2E_TRIES, withE2eRetry } from "./m178-cases.ts";

const ROOT = resolve(import.meta.dirname, "../..");
let ctx: Ctx;
before(() => { ctx = setup(); });
after(() => teardown(ctx));

test("M179: environment", (t) => { t.diagnostic(m179Cand() ? `candidate uid available: the end-to-end case runs for real (up to ${E2E_TRIES} tries, load factor ${E2E_LOAD})` : "no candidate uid here: the end-to-end case asserts the CAND_UID_* refusal"); });
for (const c of CASES) test(`M179: ${c.id}`, (t) => (c.needsCand && m179Cand() ? withE2eRetry(t, () => c.run({ prop }, ctx)) : c.run({ prop }, ctx)));

test("M179: the new code and its fixtures name no dev task", () => {
  const dev = /PeaceSTOCKS|peacestocks|defu|destr|scule|ohash|yup|valibot|remeda|neverthrow|kysely|superstruct|p-queue/i;
  const src = readFileSync(join(ROOT, "peaceai/lib/editpropose.ts"), "utf8");
  const m179 = src.slice(src.indexOf("// ---- M179 anchored continuation"), src.indexOf("/** M167: options for a proposer"));
  assert.ok(m179.length > 1000);
  const next = src.slice(src.indexOf("// M179 (repair-v2 only, like M178)"), src.indexOf("if (pick.anchored) seen.add(pick.key);"));
  assert.ok(next.length > 300);
  assert.doesNotMatch(next, dev);
  assert.doesNotMatch(m179, dev);
  const cases = readFileSync(join(ROOT, "peaceai/test/m179-cases.ts"), "utf8").split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n");
  assert.doesNotMatch(cases, dev);
});
