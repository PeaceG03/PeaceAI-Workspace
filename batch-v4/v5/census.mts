import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { existingTargetRefusal } from "/workspace/v4-ws/peaceai/lib/learned-test-existing.ts";
const R = "/workspace/land-proofs";
const walk = (d: string): string[] => readdirSync(join(R, d), { withFileTypes: true }).flatMap((e) => e.isDirectory() ? (e.name === "node_modules" ? [] : walk(join(d, e.name))) : [join(d, e.name)]);
const files = walk("src").filter((f) => f.endsWith(".ts"));
const tests = files.filter((f) => f.endsWith(".test.ts"));
const testText = tests.map((t) => readFileSync(join(R, t), "utf8")).join("\n");
const read = (rel: string) => { try { return rel.endsWith(".test.ts") ? null : readFileSync(join(R, rel), "utf8"); } catch { return null; } };
const out: any[] = [];
for (const f of files.filter((f) => !f.endsWith(".test.ts"))) {
  const c = readFileSync(join(R, f), "utf8");
  for (const m of c.matchAll(/^export function (\w+)/gm)) {
    const fn = m[1];
    const v1 = existingTargetRefusal(f, c, fn);
    const v2 = existingTargetRefusal(f, c, fn, { v2: { read } });
    const tested = new RegExp(`\\b${fn}\\b`).test(testText);
    out.push({ f, fn, v1, v2, tested });
  }
}
const cnt = (p: (x: any) => boolean) => out.filter(p).length;
console.error(`total ${out.length} v1ok ${cnt((x) => !x.v1)} v2ok ${cnt((x) => !x.v2)} v2only ${cnt((x) => x.v1 && !x.v2)} v2only-untested ${cnt((x) => x.v1 && !x.v2 && !x.tested)}`);
console.log(JSON.stringify(out, null, 0));
