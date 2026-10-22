import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const LIB = process.env.LIB ?? "/workspace/te4/ws/peaceai/lib/learned-test-existing.ts";
const { existingTargetRefusal } = await import(LIB);
const R = process.env.R ?? "/tmp/v8stocks";
const walk = (d: string): string[] => readdirSync(join(R, d), { withFileTypes: true }).flatMap((e) => e.isDirectory() ? (e.name === "node_modules" ? [] : walk(join(d, e.name))) : [join(d, e.name)]);
const files = walk(process.env.SRC ?? "src").filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts") && !f.endsWith(".d.ts"));
const read = (rel: string) => { try { return rel.endsWith(".test.ts") ? null : readFileSync(join(R, rel), "utf8"); } catch { return null; } };
const out: any[] = [];
for (const f of files) {
  const c = readFileSync(join(R, f), "utf8");
  for (const m of c.matchAll(/^export function (\w+)/gm)) {
    const fn = m[1];
    const v1 = existingTargetRefusal(f, c, fn), v2 = existingTargetRefusal(f, c, fn, { v2: { read } }), v3 = existingTargetRefusal(f, c, fn, { v2: { read }, dates: true });
    const v4 = existingTargetRefusal(f, c, fn, { v2: { read }, dates: true, v4: true });
    out.push({ f, fn, v1, v2, v3, v4 });
  }
}
const n = (p: (x: any) => boolean) => out.filter(p).length;
console.log(`total ${out.length} v1ok ${n((x) => !x.v1)} v2ok ${n((x) => !x.v2)} v3ok ${n((x) => !x.v3)} v4ok ${n((x) => !x.v4)} v4-new ${n((x) => x.v3 && !x.v4)} v4-lost ${n((x) => !x.v3 && x.v4)}`);
const c: Record<string, number> = {}; for (const x of out) if (x.v4) c[x.v4] = (c[x.v4] ?? 0) + 1; console.log("v4 refusals", JSON.stringify(c));
writeFileSync(process.env.OUT ?? "/workspace/te4/census4.json", JSON.stringify(out));
