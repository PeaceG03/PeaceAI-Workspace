import { readFileSync } from "node:fs";
import ts from "/workspace/v4-ws/node_modules/typescript/lib/typescript.js";
const d = JSON.parse(readFileSync("/workspace/batch-v7/census3.json", "utf8"));
for (const x of d) {
  if (!x.v2) continue;
  const c = readFileSync("/workspace/land-proofs/" + x.f, "utf8");
  const sf = ts.createSourceFile("m.ts", c, ts.ScriptTarget.Latest, true);
  const f = sf.statements.find((s: any) => ts.isFunctionDeclaration(s) && s.name?.text === x.fn);
  const sig = `(${f.parameters.map((p: any) => p.type?.getText(sf)).join(", ")}): ${f.type?.getText(sf)}`;
  if (/\bDate\b/.test(sig)) console.log(x.v3 ?? "OK", x.tested ? "T" : "-", x.f, x.fn, sig.slice(0, 120));
}
