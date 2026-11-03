// M174 (batch 13): compile-diagnostic feedback for a team suite that does not load. Cases: m174-cases.ts (also
// replayed against mutants by m174-mutation.test.ts). Spec: peaceai/spec/load-diagnostics-m174.md.
import { after, before, test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as diag from "../lib/loaddiag.ts";
import * as propose from "../lib/editpropose.ts";
import * as loop from "../lib/loop.ts";
import * as row from "../lib/looprow.ts";
import { CASES, type Ctx } from "./m174-cases.ts";
import { setup, teardown } from "./m151-fixtures.ts";

let ctx: Ctx;
before(() => { ctx = { m151: setup(), scratch: mkdtempSync(join(tmpdir(), "peaceai-m174-")) }; });
after(() => { teardown(ctx.m151); rmSync(ctx.scratch, { recursive: true, force: true }); });

for (const c of CASES) {
  test(`M174 load: ${c.id}`, (t) => {
    if (c.needsCand && !ctx.m151.cand) { t.skip("needs the stage-2 candidate uid (box / private job)"); return; }
    c.run({ diag, propose, loop, row }, ctx);
  });
}
