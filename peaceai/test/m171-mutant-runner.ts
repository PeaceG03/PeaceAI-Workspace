// M171 mutation runner (child process): imports one mutant set of loopdeps.ts / looprow.ts / loop.ts, runs every M171
// case against it and prints one JSON line {failed, crashed, skipped, cand}. Run in its own process group by
// m171-mutation.test.ts (capped, group killed).
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { CASES } from "./m171-cases.ts";
import { setup, teardown } from "./m171-fixtures.ts";
import { setup as setup151, teardown as teardown151 } from "./m151-fixtures.ts";

const deps = await import(pathToFileURL(process.argv[2]!).href);
const row = await import(pathToFileURL(process.argv[3]!).href);
const loop = await import(pathToFileURL(process.argv[4]!).href);
const ctx = { m171: setup(), m151: setup151() };
const failed: string[] = [];
const crashed: string[] = [];
const skipped: string[] = [];
try {
  for (const c of CASES) {
    if (c.needsCand && !ctx.m171.cand) { skipped.push(c.id); continue; }
    try { c.run({ deps, loop, row }, ctx); } catch (e) {
      const top = e instanceof Error ? (e.stack ?? "").split("\n").find((l) => l.trim().startsWith("at ")) ?? "" : "";
      if (e instanceof assert.AssertionError || !top.includes("mutant-")) failed.push(c.id); else crashed.push(`${c.id}: ${String(e)}`);
    }
  }
} finally { teardown(ctx.m171); teardown151(ctx.m151); }
process.stdout.write(JSON.stringify({ failed, crashed, skipped, cand: !!ctx.m171.cand }) + "\n");
