// M152 mutation runner (child process): imports one mutant of editpropose.ts (and a loop.ts, possibly mutated), runs
// every M152 case against them and prints one JSON line {failed, crashed}. Run in its own process group by
// m152-mutation.test.ts (capped, group killed).
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { CASES } from "./m152-cases.ts";
import { setup, teardown } from "./m152-fixtures.ts";

const prop = await import(pathToFileURL(process.argv[2]!).href);
const loop = await import(pathToFileURL(process.argv[3]!).href);
const ctx = setup();
const failed: string[] = [];
const crashed: string[] = [];
try {
  for (const c of CASES) {
    try { c.run({ prop, loop }, ctx); } catch (e) {
      const top = e instanceof Error ? (e.stack ?? "").split("\n").find((l) => l.trim().startsWith("at ")) ?? "" : "";
      if (e instanceof assert.AssertionError || !top.includes("mutant-")) failed.push(c.id); else crashed.push(`${c.id}: ${String(e)}`);
    }
  }
} finally { teardown(ctx); }
process.stdout.write(JSON.stringify({ failed, crashed, cand: ctx.cand }) + "\n");
