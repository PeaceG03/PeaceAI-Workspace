// M173 (Auditor ruling on CI run 41556098711): reachedTests counts only real baselines, the shim's made-up counts are
// told apart in rows, and a baseline whose suite did not load (or ran no test) refuses the task before any edit.
// Cases: m173-loop-cases.ts (also replayed against mutants by m173-loop-mutation.test.ts). Spec: peaceai/spec/repair-v2-m173.md.
import { after, before, test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import * as deps from "../lib/loopdeps.ts";
import * as loop from "../lib/loop.ts";
import * as row from "../lib/looprow.ts";
import { binPin, CASES, type Ctx } from "./m173-loop-cases.ts";
import { setup, teardown } from "./m151-fixtures.ts";

const ROOT = resolve(import.meta.dirname, "../..");
let ctx: Ctx;
before(() => { ctx = { m151: setup(), scratch: mkdtempSync(join(tmpdir(), "peaceai-m173-loop-")) }; });
after(() => { teardown(ctx.m151); rmSync(ctx.scratch, { recursive: true, force: true }); });

for (const c of CASES) {
  test(`M173 loop: ${c.id}`, (t) => {
    if (c.needsCand && !ctx.m151.cand) { t.skip("needs the stage-2 candidate uid (box / private job)"); return; }
    c.run({ deps, loop, row }, ctx);
  });
}
test("M173 loop: bin/loop.ts prints reachedTests through looprow.reachedTests", () => binPin(ROOT));
