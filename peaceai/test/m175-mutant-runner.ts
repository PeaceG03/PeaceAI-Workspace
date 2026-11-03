// M175 mutation runner (child process): imports one mutant set of looprow.ts / loop.ts, runs every M175 case against
// it and prints one JSON line {failed, crashed, skipped, cand}. Run in its own process group by m175-mutation.test.ts.
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { CASES, m175Cand } from "./m175-cases.ts";
import { setup, teardown, type Ctx } from "./m146-fixtures.ts";

const row = await import(pathToFileURL(process.argv[2]!).href);
const loop = await import(pathToFileURL(process.argv[3]!).href);
const ctx: Ctx = setup(0, () => 0);
const failed: string[] = [];
const crashed: string[] = [];
const skipped: string[] = [];
try {
  for (const c of CASES) {
    if (c.needsCand && !m175Cand()) { skipped.push(c.id); continue; }
    try { c.run({ loop: loop as never, row: row as never }, ctx); } catch (e) {
      const top = e instanceof Error ? (e.stack ?? "").split("\n").find((l) => l.trim().startsWith("at ")) ?? "" : "";
      if (e instanceof assert.AssertionError || !top.includes("mutant-")) failed.push(c.id); else crashed.push(`${c.id}: ${String(e)}`);
    }
  }
} finally { teardown(ctx); }
process.stdout.write(JSON.stringify({ failed, crashed, skipped, cand: m175Cand() }) + "\n");
