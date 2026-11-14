// Runs the text-edit cases against one mutant of editpropose.ts.
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { CASES, setup, teardown } from "./m236-text-edit-cases.ts";

const prop = await import(pathToFileURL(process.argv[2]!).href);
const ctx = setup();
const failed: string[] = [];
const crashed: string[] = [];
try {
  for (const c of CASES) {
    try { c.run({ prop }, ctx); } catch (e) {
      const top = e instanceof Error ? (e.stack ?? "").split("\n").find((l) => l.trim().startsWith("at ")) ?? "" : "";
      if (e instanceof assert.AssertionError || !top.includes("mutant-")) failed.push(c.id); else crashed.push(`${c.id}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
} finally { teardown(ctx); }
process.stdout.write(JSON.stringify({ failed, crashed }) + "\n");
