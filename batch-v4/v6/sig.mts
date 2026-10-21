import ts from "typescript";
import { readFileSync } from "node:fs";
const d = JSON.parse(readFileSync("/workspace/batch-v5/census-8b1f413.json", "utf8"));
const R = "/workspace/land-proofs/";
const cats: Record<string, number> = {};
const bump = (k: string) => (cats[k] = (cats[k] ?? 0) + 1);
for (const x of d.filter((x: any) => x.v2 === "test_target_signature")) {
  const sf = ts.createSourceFile(x.f, readFileSync(R + x.f, "utf8"), ts.ScriptTarget.Latest, true);
  let decl: ts.FunctionDeclaration | undefined;
  sf.forEachChild((n) => { if (ts.isFunctionDeclaration(n) && n.name?.text === x.fn) decl = n; });
  if (!decl) { bump("not-found"); continue; }
  const t = [...decl.parameters.map((p) => p.type?.getText(sf) ?? "?"), decl.type?.getText(sf) ?? "(inferred return)"].join(" ; ");
  const k = /\(inferred return\)/.test(t) ? "inferred return type" : /=>/.test(t) ? "function-typed param" : /Map<|Set<|ReadonlyMap|ReadonlySet/.test(t) ? "Map/Set" : /Promise|AbortSignal|Response|fetch/i.test(t) ? "async/io types" : /Record<|unknown|any\b/.test(t) ? "Record/unknown" : /Date/.test(t) ? "Date" : /Uint8Array|Buffer/.test(t) ? "bytes" : "named interface not plain-data / other";
  bump(k);
}
console.log(cats);
