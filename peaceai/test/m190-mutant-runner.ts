// M190 mutation runner (child process): imports one mutant set of loopdeps.ts / loop.ts / editpropose.ts, runs every
// M190 case against it and prints one JSON line {failed, crashed, skipped, cand}. Run in its own process group by
// m190-mutation.test.ts (capped, group killed).
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { CASES } from "./m190-cases.ts";
import { setup as setup151, teardown as teardown151 } from "./m151-fixtures.ts";

const deps = await import(pathToFileURL(process.argv[2]!).href);
const loop = await import(pathToFileURL(process.argv[3]!).href);
const prop = await import(pathToFileURL(process.argv[4]!).href);
const ctx = { m151: setup151(), scratch: mkdtempSync(join(tmpdir(), "peaceai-m190-")) };
const failed: string[] = [];
const crashed: string[] = [];
const skipped: string[] = [];
try {
  for (const c of CASES) {
    if (c.needsCand && !ctx.m151.cand) { skipped.push(c.id); continue; }
    try { c.run({ deps, loop, prop }, ctx); } catch (e) {
      const top = e instanceof Error ? (e.stack ?? "").split("\n").find((l) => l.trim().startsWith("at ")) ?? "" : "";
      if (e instanceof assert.AssertionError || !top.includes("mutant-")) failed.push(c.id); else crashed.push(`${c.id}: ${String(e)}`);
    }
  }
} finally { teardown151(ctx.m151); rmSync(ctx.scratch, { recursive: true, force: true }); }
process.stdout.write(JSON.stringify({ failed, crashed, skipped, cand: !!ctx.m151.cand }) + "\n");
