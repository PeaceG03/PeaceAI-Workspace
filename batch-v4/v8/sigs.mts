import { readFileSync } from "node:fs";
import ts from "/workspace/v4-ws/node_modules/typescript/lib/typescript.js";
const d = JSON.parse(readFileSync("/workspace/batch-v8/v8/census.json", "utf8"));
const cnt: Record<string, number> = {}; const ex: Record<string, string[]> = {};
for (const x of d) {
  if (x.v3 !== "test_target_signature") continue;
  const c = readFileSync("/workspace/batch-v8/grade/" + x.f, "utf8");
  const sf = ts.createSourceFile("m.ts", c, ts.ScriptTarget.Latest, true);
  const f: any = sf.statements.find((s: any) => ts.isFunctionDeclaration(s) && s.name?.text === x.fn);
  const sig = `(${f.parameters.map((p: any) => p.type?.getText(sf) ?? "?").join(", ")}): ${f.type?.getText(sf) ?? "?"}`;
  const tags = new Set<string>();
  if (/\bMap\b|\bSet\b|ReadonlyMap|ReadonlySet/.test(sig)) tags.add("Map/Set");
  if (/Uint8Array|Buffer|ArrayBuffer/.test(sig)) tags.add("bytes");
  if (/Record</.test(sig)) tags.add("Record");
  if (/\bunknown\b|\bany\b/.test(sig)) tags.add("unknown/any");
  if (/=>/.test(sig)) tags.add("callback");
  if (f.typeParameters) tags.add("generic");
  if (/\?\)|: \?$|\(\?/.test(sig) || sig.includes("?")) tags.add("untyped");
  if (/\bNodeJS\.|ProcessEnv|Env\b/.test(sig)) tags.add("env");
  if (/\b[A-Z]\w+\b/.test(sig.replace(/\b(Map|Set|ReadonlyMap|ReadonlySet|Uint8Array|Buffer|Record|Date|Readonly|Array|ReadonlyArray|Promise|Partial)\b/g, ""))) tags.add("named-type");
  if (!tags.size) tags.add("other");
  for (const t of tags) { cnt[t] = (cnt[t] ?? 0) + 1; (ex[t] ??= []).length < 4 && ex[t].push(`${x.fn}${sig}`.slice(0, 140)); }
}
for (const [k, v] of Object.entries(cnt).sort((a, b) => b[1] - a[1])) console.log(v, k, "\n   " + ex[k].join("\n   "));
