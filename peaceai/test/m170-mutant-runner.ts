// M170 mutation runner (child process): imports one mutant set of loopdeps.ts / looprow.ts / loop.ts, runs every M169
// case against it and prints one JSON line {failed, crashed, skipped, cand}. Run in its own process group by
// m170-mutation.test.ts (capped, group killed).
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { CASES } from "./m170-cases.ts";
import { setup, teardown } from "./m151-fixtures.ts";

const deps = await import(pathToFileURL(process.argv[2]!).href);
const row = await import(pathToFileURL(process.argv[3]!).href);
const loop = await import(pathToFileURL(process.argv[4]!).href);
const ctx = setup();
const failed: string[] = [];
const crashed: string[] = [];
const skipped: string[] = [];
try {
  for (const c of CASES) {
    if (c.needsCand && !ctx.cand) { skipped.push(c.id); continue; }
    try { c.run({ deps, loop, row }, ctx); } catch (e) {
      const top = e instanceof Error ? (e.stack ?? "").split("\n").find((l) => l.trim().startsWith("at ")) ?? "" : "";
      if (e instanceof assert.AssertionError || !top.includes("mutant-")) failed.push(c.id); else crashed.push(`${c.id}: ${String(e)}`);
    }
  }
} finally { teardown(ctx); }
process.stdout.write(JSON.stringify({ failed, crashed, skipped, cand: !!ctx.cand }) + "\n");
