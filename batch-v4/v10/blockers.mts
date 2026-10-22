// batch-v10 Part B (v6 engine, PeaceSTOCKS 0ab37c8): every signature blocker per v6-refused function (not just the first), plus a body-only verdict
// (the function re-analyzed with its signature neutralized to numbers), to estimate what each widening unlocks.
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import ts from "/workspace/batch-v10/ws/node_modules/typescript/lib/typescript.js";
import { existingTargetRefusal } from "/workspace/batch-v10/ws/peaceai/lib/learned-test-existing.ts";
const R = "/tmp/v6chk/stocks";
const walk = (d: string): string[] => readdirSync(join(R, d), { withFileTypes: true }).flatMap((e) => e.isDirectory() ? (e.name === "node_modules" ? [] : walk(join(d, e.name))) : [join(d, e.name)]);
const files = walk("src").filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts") && !f.endsWith(".d.ts"));
const read = (rel: string) => { try { return rel.endsWith(".test.ts") ? null : readFileSync(join(R, rel), "utf8"); } catch { return null; } };
const opts = { v2: { read }, dates: true, v4: true, v5: true, v6: true };
const mods = new Map<string, ts.SourceFile | null>();
const load = (p: string) => { if (!mods.has(p)) { const t = read(p); mods.set(p, t === null ? null : ts.createSourceFile(p, t, ts.ScriptTarget.Latest, true)); } return mods.get(p)!; };
const resolveRel = (from: string, spec: string): string | null => {
  if (!spec.startsWith(".")) return null; const dir = from.slice(0, from.lastIndexOf("/")); const parts: string[] = [];
  for (const s of `${dir}/${spec}`.split("/")) { if (!s || s === ".") continue; if (s === "..") parts.pop(); else parts.push(s); }
  const b = parts.join("/"); for (const c of [b, `${b}.ts`, `${b.replace(/\.js$/, "")}.ts`, `${b}/index.ts`]) if (c.endsWith(".ts") && read(c) !== null) return c; return null; };
const findType = (sf: ts.SourceFile, n: string) => sf.statements.find((s: any) => (ts.isInterfaceDeclaration(s) || ts.isTypeAliasDeclaration(s) || ts.isClassDeclaration(s) || ts.isEnumDeclaration(s)) && s.name?.text === n) as any;
const findImport = (sf: ts.SourceFile, n: string) => { for (const s of sf.statements) if (ts.isImportDeclaration(s) && s.importClause?.namedBindings && ts.isNamedImports(s.importClause.namedBindings)) for (const el of s.importClause.namedBindings.elements) if (el.name.text === n) return { spec: (s.moduleSpecifier as ts.StringLiteral).text, imported: (el.propertyName ?? el.name).text }; return null; };
const G4 = new Set(["Array", "ReadonlyArray", "Readonly", "Partial", "Record", "Pick", "Omit"]);
type C = { sf: ts.SourceFile; path: string; depth: number; seen: Set<string> };
function all(t: ts.TypeNode, c: C, out: Set<string>, d = 0): void {
  if (d > 6) { out.add("depth>6"); return; }
  const rec = (x: ts.TypeNode) => all(x, c, out, d + 1);
  if (ts.isParenthesizedTypeNode(t)) return rec(t.type);
  if (ts.isArrayTypeNode(t)) return rec(t.elementType);
  if (ts.isTypeOperatorNode(t)) { if (t.operator === ts.SyntaxKind.ReadonlyKeyword) return rec(t.type); out.add("typeop"); return; }
  if (ts.isLiteralTypeNode(t)) return;
  if ([ts.SyntaxKind.UndefinedKeyword, ts.SyntaxKind.StringKeyword, ts.SyntaxKind.NumberKeyword, ts.SyntaxKind.BooleanKeyword, ts.SyntaxKind.NullKeyword].includes(t.kind)) return;
  if (t.kind === ts.SyntaxKind.VoidKeyword) { out.add("void"); return; }
  if (t.kind === ts.SyntaxKind.UnknownKeyword || t.kind === ts.SyntaxKind.AnyKeyword) { out.add("unknown/any"); return; }
  if (t.kind === ts.SyntaxKind.NeverKeyword) { out.add("never"); return; }
  if (t.kind === ts.SyntaxKind.BigIntKeyword) { out.add("bigint"); return; }
  if (ts.isUnionTypeNode(t)) { if (t.types.length > 12) out.add("union>12"); t.types.forEach(rec); return; }
  if (ts.isTypeLiteralNode(t)) return mem(t.members, rec, out);
  if (ts.isIntersectionTypeNode(t)) { out.add("intersection"); return; }
  if (ts.isFunctionTypeNode(t)) { out.add("callback"); return; }
  if (ts.isTupleTypeNode(t)) { out.add("tuple"); return; }
  if (ts.isTypeQueryNode(t)) { out.add("typeof:" + t.exprName.getText(c.sf)); return; }
  if (ts.isIndexedAccessTypeNode(t)) { out.add("indexed-access:" + t.getText(c.sf).replace(/\s+/g, "")); return; }
  if (ts.isTemplateLiteralTypeNode(t)) { out.add("template-type"); return; }
  if (ts.isTypeReferenceNode(t)) {
    if (!ts.isIdentifier(t.typeName)) { const q = t.typeName.getText(c.sf); out.add(q.startsWith("NodeJS.") ? "NodeJS.ProcessEnv" : "qualified:" + q); return; }
    const n = t.typeName.text;
    if (t.typeArguments?.length) {
      if (n === "Map" || n === "ReadonlyMap" || n === "Set" || n === "ReadonlySet") { out.add("Map/Set"); t.typeArguments.forEach(rec); return; }
      if (n === "Promise") { out.add("async"); return; }
      if (G4.has(n)) { if (n === "Record" && !(t.typeArguments[0]!.kind === ts.SyntaxKind.StringKeyword || ts.isLiteralTypeNode(t.typeArguments[0]!) || ts.isUnionTypeNode(t.typeArguments[0]!))) { out.add("record-key"); } (n === "Record" ? [t.typeArguments[1]!] : n === "Pick" || n === "Omit" ? [t.typeArguments[0]!] : [t.typeArguments[0]!]).forEach(rec); return; }
      out.add("generic:" + n); return;
    }
    if (n === "Date") return;
    if (["Uint8Array", "Buffer", "ArrayBuffer"].includes(n)) { out.add("bytes"); return; }
    if (n === "RegExp" || n === "Error") { out.add("builtin:" + n); return; }
    const key = `${c.path}#${n}`; if (c.seen.has(key)) return; c.seen.add(key);
    const decl = findType(c.sf, n);
    const handle = (dd: any, cc: C) => {
      if (ts.isEnumDeclaration(dd)) return;
      if (ts.isClassDeclaration(dd)) { out.add("class"); return; }
      if (dd.typeParameters?.length) { out.add("generic-decl"); return; }
      if (ts.isInterfaceDeclaration(dd) && dd.heritageClauses?.length) out.add("interface-extends");
      const r2 = (x: ts.TypeNode) => all(x, cc, out, d + 1);
      if (ts.isInterfaceDeclaration(dd)) mem(dd.members, r2, out); else r2(dd.type);
    };
    if (decl) return handle(decl, c);
    const imp = findImport(c.sf, n);
    if (!imp) { out.add("global:" + n); return; }
    const p = resolveRel(c.path, imp.spec);
    if (!p) { out.add("package-type"); return; }
    if (c.depth >= 2) { out.add("import-depth"); return; }
    const sf2 = load(p); const d2 = sf2 && findType(sf2, imp.imported);
    if (!d2) { out.add("reexport"); return; }
    return handle(d2, { sf: sf2!, path: p, depth: c.depth + 1, seen: c.seen });
  }
  out.add("kind:" + ts.SyntaxKind[t.kind]);
}
function mem(ms: ts.NodeArray<ts.TypeElement>, rec: (x: ts.TypeNode) => void, out: Set<string>) {
  if (ms.length > 32) out.add("members>32");
  for (const m of ms) {
    if (ts.isMethodSignature(m)) { out.add("method-member"); continue; }
    if (ts.isIndexSignatureDeclaration(m)) { out.add("index-signature"); continue; }
    if (!ts.isPropertySignature(m) || !m.type) { out.add("member-kind"); continue; }
    if (m.type && ts.isFunctionTypeNode(m.type)) { out.add("callback"); continue; }
    rec(m.type);
  }
}
const rows: any[] = [];
for (const f of files) {
  const text = read(f)!; const sf = ts.createSourceFile(f, text, ts.ScriptTarget.Latest, true);
  for (const m of text.matchAll(/^export function (\w+)/gm)) {
    const fn = m[1]!;
    const r = existingTargetRefusal(f, text, fn, opts);
    if (r === null) continue;
    const decls = sf.statements.filter((s: any) => ts.isFunctionDeclaration(s) && s.name?.text === fn) as ts.FunctionDeclaration[];
    const fd = decls.find((x) => x.body) ?? decls[0]!;
    const B = new Set<string>();
    if (decls.length > 1) B.add("overload");
    if (fd.typeParameters?.length) B.add("generic-fn");
    if (fd.asteriskToken) B.add("generator");
    if (fd.modifiers?.some((x) => x.kind === ts.SyntaxKind.AsyncKeyword)) B.add("async");
    if (!fd.type) B.add("no-return-annotation");
    if (fd.parameters.length > 4) B.add("params>4");
    const c: C = { sf, path: f, depth: 0, seen: new Set() };
    for (const p of fd.parameters) {
      if (!ts.isIdentifier(p.name)) B.add("destructured-param");
      if (p.dotDotDotToken) B.add("rest-param");
      if (p.questionToken && p.initializer) B.add("?+default");
      if (!p.type) { if (!p.initializer) B.add("untyped-param"); else if (!/^-?\d|^["'`]|^(true|false)$/.test(p.initializer.getText(sf))) B.add("untyped-nonliteral-default"); }
      else all(p.type, c, B);
    }
    if (fd.type) all(fd.type, c, B);
    // body-only verdict: same function with every parameter `number`, no defaults, return `number`, at most 4 params.
    let body: string | null = null;
    if (fd.body && !fd.typeParameters?.length) {
      const names = fd.parameters.map((p, i) => ts.isIdentifier(p.name) ? p.name.text : `__p${i}`);
      const sig = `export function ${fn}(${names.slice(0, 4).map((n) => `${n}: number`).join(", ")}): number `;
      const start = fd.getStart(sf), bodyStart = fd.body.getStart(sf);
      const neutral = text.slice(0, start) + sig + text.slice(bodyStart);
      try { body = existingTargetRefusal(f, neutral, fn, opts); } catch (e) { body = "crash"; }
      if (body === "test_target_signature") body = "sig-after-neutral";
    }
    rows.push({ f, fn, refusal: r, blockers: [...B].sort(), body });
  }
}
writeFileSync("/workspace/batch-v10/b/blockers.json", JSON.stringify(rows, null, 0));
const by: Record<string, { any: number; only: number; onlyBodyOk: number; ex: string[] }> = {};
for (const x of rows) {
  if (x.refusal !== "test_target_signature") continue;
  const ks = [...new Set((x.blockers as string[]).map((b) => b.split(":")[0]!))];
  for (const k of ks) { const e = (by[k] ??= { any: 0, only: 0, onlyBodyOk: 0, ex: [] }); e.any++; if (ks.length === 1) { e.only++; if (x.body === null || x.body === undefined ? false : false) {} if (x.body === null) { e.onlyBodyOk++; e.ex.push(`${x.f.replace("src/", "")}#${x.fn}`); } } }
}
console.log("refusals", JSON.stringify(rows.reduce((a: any, x) => ((a[x.refusal] = (a[x.refusal] ?? 0) + 1), a), {})));
console.log("signature blockers: any / sole blocker / sole blocker and body passes");
for (const [k, v] of Object.entries(by).sort((a, b) => b[1].onlyBodyOk - a[1].onlyBodyOk || b[1].any - a[1].any)) console.log(String(v.any).padStart(4), String(v.only).padStart(4), String(v.onlyBodyOk).padStart(4), k, "  ", v.ex.slice(0, 6).join(" "));
const bodyRef = rows.filter((x) => x.refusal !== "test_target_signature");
console.log("body refusals", bodyRef.length, JSON.stringify(bodyRef.reduce((a: any, x) => ((a[x.refusal] = (a[x.refusal] ?? 0) + 1), a), {})));
