// M145 mutation runner (child process): imports one mutant of codesearch.ts, runs every M145 case against it and
// prints one JSON line {failed, crashed}. Run in its own process group by m145-codesearch-mutation.test.ts, so a
// mutant that hangs (e.g. one without the regex deadline) is killed with its children and counted as detected.
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { CASES } from "./m145-codesearch-cases.ts";
import { setup, teardown } from "./m145-fixtures.ts";

const file = process.argv[2]!;
const mod = await import(pathToFileURL(file).href);
const ctx = setup();
const failed: string[] = [];
const crashed: string[] = [];
try {
  for (const c of CASES) {
    try { c.run(mod, ctx); } catch (e) {
      // A failure thrown from inside the mutant itself (not an assertion in the case) is a crash, not a detection.
      const top = e instanceof Error ? (e.stack ?? "").split("\n").find((l) => l.trim().startsWith("at ")) ?? "" : "";
      if (e instanceof assert.AssertionError || !top.includes("mutant-")) failed.push(c.id); else crashed.push(`${c.id}: ${String(e)}`);
    }
  }
} finally { teardown(ctx); }
process.stdout.write(JSON.stringify({ failed, crashed }) + "\n");
