// M151 mutation runner (child process): imports one mutant of loopdeps.ts (and a loop.ts that imports it), runs every
// M151 case against them and prints one JSON line {failed, crashed}. Run in its own process group by
// m151-mutation.test.ts (capped, group killed).
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { CASES } from "./m151-cases.ts";
import { setup, teardown } from "./m151-fixtures.ts";

const deps = await import(pathToFileURL(process.argv[2]!).href);
const loop = await import(pathToFileURL(process.argv[3]!).href);
const ctx = setup();
const failed: string[] = [];
const crashed: string[] = [];
try {
  for (const c of CASES) {
    try { c.run({ deps, loop }, ctx); } catch (e) {
      const top = e instanceof Error ? (e.stack ?? "").split("\n").find((l) => l.trim().startsWith("at ")) ?? "" : "";
      if (e instanceof assert.AssertionError || !top.includes("mutant-")) failed.push(c.id); else crashed.push(`${c.id}: ${String(e)}`);
    }
  }
} finally { teardown(ctx); }
process.stdout.write(JSON.stringify({ failed, crashed, cand: !!ctx.cand }) + "\n");
