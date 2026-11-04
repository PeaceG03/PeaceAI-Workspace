// M187 (batch 22): the ava runner (spec: peaceai/spec/loop-runners-v4.md). Detection cases live in m187-cases.ts
// (replayed against mutants by m187-mutation.test.ts); this file runs them once. The report channel and forging
// behaviour on a real ava install are in m187-forge.test.ts. Synthetic fixtures only; no network.
import { after, before, test } from "node:test";
import * as deps from "../lib/loopdeps.ts";
import * as loop from "../lib/loop.ts";
import * as row from "../lib/looprow.ts";
import * as prop from "../lib/editpropose.ts";
import { CASES } from "./m187-cases.ts";
import { setup, teardown, type Ctx } from "./m151-fixtures.ts";

process.env.M151_CAND ??= process.env.M187_CAND;
let ctx: Ctx;
before(() => { ctx = setup(); });
after(() => teardown(ctx));

for (const c of CASES) test(`M187: ${c.id}`, (t) => { if (c.needsCand && !ctx.cand) { t.skip(c.needsCand); return; } c.run({ deps, loop, row, prop }, ctx); });
