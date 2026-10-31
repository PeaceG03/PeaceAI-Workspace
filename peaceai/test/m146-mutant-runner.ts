// M146 mutation runner (child process): imports one mutant of loop.ts, runs every M146 case against it and prints
// one JSON line {failed, crashed}. Run in its own process group by m146-loop-mutation.test.ts (capped, group killed).
import assert from "node:assert/strict";
import net from "node:net";
import { pathToFileURL } from "node:url";
import { CASES } from "./m146-loop-cases.ts";
import { setup, teardown } from "./m146-fixtures.ts";

const mod = await import(pathToFileURL(process.argv[2]!).href);
let hits = 0;
const server = net.createServer((s) => { hits++; s.destroy(); });
await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
const ctx = setup((server.address() as net.AddressInfo).port, () => hits);
const failed: string[] = [];
const crashed: string[] = [];
try {
  for (const c of CASES) {
    try { c.run(mod, ctx); } catch (e) {
      const top = e instanceof Error ? (e.stack ?? "").split("\n").find((l) => l.trim().startsWith("at ")) ?? "" : "";
      if (e instanceof assert.AssertionError || !top.includes("mutant-")) failed.push(c.id); else crashed.push(`${c.id}: ${String(e)}`);
    }
  }
} finally { teardown(ctx); server.close(); }
process.stdout.write(JSON.stringify({ failed, crashed, cand: ctx.cand }) + "\n");
