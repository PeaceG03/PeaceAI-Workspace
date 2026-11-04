// M188 (batch 23): package-manager settings PeaceAI's dependency install vouches for (spec:
// peaceai/spec/deps-pm-config-v1.md). The cases live in m188-cases.ts (replayed against mutants by
// m188-mutation.test.ts); this file runs them once. Synthetic fixtures only; no network.
import { after, before, test } from "node:test";
import * as deps from "../lib/loopdeps.ts";
import * as loop from "../lib/loop.ts";
import * as row from "../lib/looprow.ts";
import { CASES } from "./m188-cases.ts";
import { setup, teardown, type Ctx } from "./m151-fixtures.ts";

process.env.M151_CAND ??= process.env.M188_CAND;
let ctx: Ctx;
before(() => { ctx = setup(); });
after(() => teardown(ctx));

for (const c of CASES) test(`M188: ${c.id}`, (t) => { if (c.needsCand && !ctx.cand) { t.skip(c.needsCand); return; } c.run({ deps, loop, row }, ctx); });
