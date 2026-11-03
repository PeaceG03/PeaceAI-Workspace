// M178 (batch 17): repair-v2's inert-site demotion (spec: peaceai/spec/repair-v2-m178.md). Behavior cases live in
// m178-cases.ts (the pure ones are replayed against mutants by m178-mutation.test.ts); this file runs them once and
// checks that the new code names no dev task. Synthetic fixtures only; no network. The end-to-end case needs the
// candidate uid named by M178_CAND (peaceai-cand3 on the box); without it, it asserts the CAND_UID_* refusal.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import * as prop from "../lib/editpropose.ts";
import { E2E_LOAD } from "./m174-cases.ts";
import { CASES, E2E_TRIES, m178Cand, setup, teardown, withE2eRetry, type Ctx } from "./m178-cases.ts";

const ROOT = resolve(import.meta.dirname, "../..");
let ctx: Ctx;
before(() => { ctx = setup(); });
after(() => teardown(ctx));

test("M178: environment", (t) => { t.diagnostic(m178Cand() ? `candidate uid available: the end-to-end case runs for real (up to ${E2E_TRIES} tries, load factor ${E2E_LOAD})` : "no candidate uid here: the end-to-end case asserts the CAND_UID_* refusal"); });
// batch 18: the end-to-end case (a real loop run as the shared candidate uid) may run up to E2E_TRIES times, as
// m174-mutation's control does; a pure case is never retried, and without a candidate uid nothing is retried
for (const c of CASES) test(`M178: ${c.id}`, (t) => (c.needsCand && m178Cand() ? withE2eRetry(t, () => c.run({ prop }, ctx)) : c.run({ prop }, ctx)));

test("M178: the e2e retry runs a failing case E2E_TRIES times and then fails; a passing one once", (t) => {
  let n = 0;
  assert.throws(() => withE2eRetry(t, () => { n++; throw new Error("flaky"); }), /flaky/);
  assert.equal(n, E2E_TRIES);
  n = 0;
  withE2eRetry(t, () => { n++; if (n < 2) throw new Error("once"); });
  assert.equal(n, 2);
  assert.equal(E2E_TRIES, 3);
});

test("M178: the new code and its fixtures name no dev task", () => {
  const dev = /PeaceSTOCKS|peacestocks|defu|destr|scule|ohash|yup|valibot|remeda|neverthrow|kysely|superstruct|p-queue/i;
  const src = readFileSync(join(ROOT, "peaceai/lib/editpropose.ts"), "utf8");
  const m178 = src.slice(src.indexOf("// ---- M178 inert-site demotion"), src.indexOf("/** M167: options for a proposer"));
  assert.ok(m178.length > 1000);
  const next = src.slice(src.indexOf("// M178 (repair-v2 only; never repair-v1"), src.indexOf("pick ??= queue.shift()"));
  assert.ok(next.length > 300);
  assert.doesNotMatch(next, dev);
  assert.doesNotMatch(m178, dev);
  const cases = readFileSync(join(ROOT, "peaceai/test/m178-cases.ts"), "utf8").split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n");
  assert.doesNotMatch(cases, dev);
});
