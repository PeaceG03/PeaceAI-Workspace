// M164 mutation runner (child process): imports one loop.ts (possibly mutated) and the real edit proposer, runs every
// M164 loop case against them and prints one JSON line {failed, crashed, cand}. Run in its own process group by
// m164-proposer-next.test.ts (capped, group killed).
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import * as prop from "../lib/editpropose.ts";
import { CASES } from "./m164-loop-cases.ts";
import { setup, teardown } from "./m152-fixtures.ts";

const loop = await import(pathToFileURL(process.argv[2]!).href);
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
