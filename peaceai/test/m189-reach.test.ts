// M189 (batch 23): repair-v2's candidate cap keeps slots for reach-site candidates (spec: peaceai/spec/repair-v2-m189.md).
// The cases live in m189-cases.ts (replayed against mutants by m189-mutation.test.ts); this file runs them once.
import { test } from "node:test";
import * as prop from "../lib/editpropose.ts";
import { CASES } from "./m189-cases.ts";

for (const c of CASES) test(`M189: ${c.id}`, () => c.run({ prop }));
