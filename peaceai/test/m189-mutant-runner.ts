// M189 mutation runner (child process): imports one mutant of editpropose.ts, runs every M189 case against it and prints
// one JSON line {failed, crashed}. Run in its own process group by m189-mutation.test.ts (capped, group killed).
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { CASES } from "./m189-cases.ts";

const prop = await import(pathToFileURL(process.argv[2]!).href);
const failed: string[] = [];
const crashed: string[] = [];
for (const c of CASES) {
  try { c.run({ prop }); } catch (e) {
    const top = e instanceof Error ? (e.stack ?? "").split("\n").find((l) => l.trim().startsWith("at ")) ?? "" : "";
    if (e instanceof assert.AssertionError || !top.includes("mutant-")) failed.push(c.id); else crashed.push(`${c.id}: ${String(e)}`);
  }
}
process.stdout.write(JSON.stringify({ failed, crashed }) + "\n");
