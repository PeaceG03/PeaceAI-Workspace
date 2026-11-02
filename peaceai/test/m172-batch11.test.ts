// M172 (batch 11): the mocha runner (spec: peaceai/spec/loop-runners-v3.md) and repair-v2's localisation and
// undefined-keeps-key idiom (spec: peaceai/spec/repair-v2-m172.md). Behavior cases live in m172-cases.ts (replayed
// against mutants by m172-mutation.test.ts); this file runs them once. Synthetic fixtures only; no network.
import { after, before, test } from "node:test";
import * as deps from "../lib/loopdeps.ts";
import * as loop from "../lib/loop.ts";
import * as row from "../lib/looprow.ts";
import * as prop from "../lib/editpropose.ts";
import { CASES } from "./m172-cases.ts";
import { setup, teardown, type Ctx } from "./m151-fixtures.ts";

process.env.M151_CAND ??= process.env.M172_CAND ?? process.env.M170_CAND;
let ctx: Ctx;
before(() => { ctx = setup(); });
after(() => teardown(ctx));

for (const c of CASES) test(`M172: ${c.id}`, (t) => { if (c.needsCand && !ctx.cand) { t.skip(c.needsCand); return; } c.run({ deps, loop, row, prop }, ctx); });
