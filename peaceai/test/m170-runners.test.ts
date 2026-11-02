// M170 (batch 10): vitest < 2 run through its node API with the results cache off, and the service check before the
// runner check (spec: peaceai/spec/loop-runners-v2.md). Behavior cases live in m170-cases.ts (replayed against mutants
// by m170-mutation.test.ts); this file runs them once. Synthetic fixtures only; no network.
import { after, before, test } from "node:test";
import * as deps from "../lib/loopdeps.ts";
import * as loop from "../lib/loop.ts";
import * as row from "../lib/looprow.ts";
import { CASES } from "./m170-cases.ts";
import { setup, teardown, type Ctx } from "./m151-fixtures.ts";

process.env.M151_CAND ??= process.env.M170_CAND ?? process.env.M169_CAND;
let ctx: Ctx;
before(() => { ctx = setup(); });
after(() => teardown(ctx));

for (const c of CASES) test(`M170: ${c.id}`, (t) => { if (c.needsCand && !ctx.cand) { t.skip(c.needsCand); return; } c.run({ deps, loop, row }, ctx); });
