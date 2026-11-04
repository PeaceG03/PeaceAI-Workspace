// M191 (batch 24): repair-v2's fail-to-pass promotion. Pure cases (no candidate uid needed); spec
// peaceai/spec/repair-v2-m191.md. The same cases replay against every mutant in m191-mutation.test.ts.
import { after, before, test } from "node:test";
import * as prop from "../lib/editpropose.ts";
import { CASES, setup, teardown, type Ctx } from "./m191-cases.ts";

let ctx: Ctx;
before(() => { ctx = setup(); });
after(() => teardown(ctx));
for (const c of CASES) test(c.id, () => c.run({ prop }, ctx));
