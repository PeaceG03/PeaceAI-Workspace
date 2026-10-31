// M162 mutation runner (child process): imports one (possibly mutated) loop.ts and looprow.ts, runs every M162 case
// against them and prints one JSON line {failed, crashed, cand}. Run in its own process group by
// m162-mutation.test.ts (capped, group killed).
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { CASES } from "./m162-cases.ts";
import { setup, teardown } from "./m152-fixtures.ts";

const loop = await import(pathToFileURL(process.argv[2]!).href);
const row = await import(pathToFileURL(process.argv[3]!).href);
const ctx = setup();
const failed: string[] = [];
const crashed: string[] = [];
try {
  for (const c of CASES) {
    try { c.run({ loop, row }, ctx); } catch (e) {
      const top = e instanceof Error ? (e.stack ?? "").split("\n").find((l) => l.trim().startsWith("at ")) ?? "" : "";
      if (e instanceof assert.AssertionError || !top.includes("mutant-")) failed.push(c.id); else crashed.push(`${c.id}: ${String(e)}`);
    }
  }
} finally { teardown(ctx); }
process.stdout.write(JSON.stringify({ failed, crashed, cand: ctx.cand }) + "\n");
