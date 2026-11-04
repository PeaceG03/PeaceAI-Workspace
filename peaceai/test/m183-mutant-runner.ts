// M183 mutation runner (child process): imports one mutant of editpropose.ts, runs every pure M183 case (not the needsCand end-to-end case) against it and
// prints one JSON line {failed, crashed}. Run in its own process group by m183-mutation.test.ts (capped, group killed).
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { CASES, setup, teardown } from "./m183-cases.ts";

const prop = await import(pathToFileURL(process.argv[2]!).href);
const ctx = setup();
const failed: string[] = [];
const crashed: string[] = [];
try {
  for (const c of CASES) {
    if (c.needsCand) continue;
    try { c.run({ prop }, ctx); } catch (e) {
      const top = e instanceof Error ? (e.stack ?? "").split("\n").find((l) => l.trim().startsWith("at ")) ?? "" : "";
      if (e instanceof assert.AssertionError || !top.includes("mutant-")) failed.push(c.id); else crashed.push(`${c.id}: ${String(e)}`);
    }
  }
} finally { teardown(ctx); }
process.stdout.write(JSON.stringify({ failed, crashed }) + "\n");
