// M175 (batch 14): the general L0 edit-scope gate (lib/loop.ts) on the m146 calc fixture. The pure cases need no
// candidate uid; the end-to-end cases run the whole loop and need the stage-2 candidate uid (M175_CAND = peaceai-cand3
// on the box / private job; the CI test job has none, where they assert the fail-closed CAND_UID_* refusal). Cases:
// m175-cases.ts (also replayed against mutants by m175-mutation.test.ts). Spec: peaceai/spec/edit-gate-m175.md.
import { after, before, test } from "node:test";
import * as loop from "../lib/loop.ts";
import * as row from "../lib/looprow.ts";
import { CASES, m175Cand } from "./m175-cases.ts";
import { setup, teardown, type Ctx } from "./m146-fixtures.ts";

let ctx: Ctx;
before(() => { ctx = setup(0, () => 0); }); // the calc fixture uses no network; the port only seeds the (unused) jail test
after(() => teardown(ctx));

test("M175: environment", (t) => { t.diagnostic(m175Cand() ? "candidate uid available: the end-to-end cases run for real" : "no candidate uid here: the end-to-end cases assert the CAND_UID_* refusal"); });
for (const c of CASES) {
  test(`M175: ${c.id}`, () => c.run({ loop, row }, ctx));
}
