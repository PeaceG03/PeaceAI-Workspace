// M88: TEST_CASE_EXISTING v3 examples at each repo's HEAD: a test file that calls an exported function of a relative
// sibling module which the v2 target refuses and the v3 target (v2 plus the global Date) accepts on the module text.
import { execFileSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import ts from "/workspace/v4-ws/node_modules/typescript/lib/typescript.js";
import { existingTargetRefusal } from "/workspace/v4-ws/peaceai/lib/learned-test-existing.ts";
import { readFileSync } from "node:fs";
const git = (d: string, ...a: string[]) => execFileSync("git", ["-C", d, ...a], { encoding: "utf8", maxBuffer: 1 << 28, stdio: ["ignore", "pipe", "ignore"], timeout: 120000 });
const dirs = readFileSync(process.argv[2]!, "utf8").trim().split("\n");
const outFile = process.argv[3]!;
const out: unknown[] = [];
const norm = (p: string) => { const o: string[] = []; for (const s of p.split("/")) { if (!s || s === ".") continue; if (s === "..") o.pop(); else o.push(s); } return o.join("/"); };
for (const dn of dirs) {
  const name = dn.replace("__", "/");
  const d = `/workspace/mine/repos/${dn}`;
  if (!existsSync(d)) continue;
  let head: string, all: Set<string>;
  try { head = git(d, "rev-parse", "HEAD").trim(); all = new Set(git(d, "ls-tree", "-r", "--name-only", head).split("\n")); } catch { continue; }
  const cache = new Map<string, string | null>();
  const read = (rel: string): string | null => { if (!all.has(rel)) return null; if (!cache.has(rel)) { try { cache.set(rel, git(d, "show", `${head}:${rel}`)); } catch { cache.set(rel, null); } } return cache.get(rel)!; };
  let found = 0; const seen = new Set<string>();
  for (const path of [...all].filter((p) => /\.(?:test|spec)\.ts$/.test(p) && !/node_modules\//.test(p)).sort()) {
    if (found >= 3) break;
    const test = read(path); if (!test || !/\bnew Date\(/.test(test)) continue;
    const sf = ts.createSourceFile(path, test, ts.ScriptTarget.Latest, true);
    const dir = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
    for (const s of sf.statements) {
      if (found >= 3) break;
      if (!ts.isImportDeclaration(s) || !ts.isStringLiteral(s.moduleSpecifier) || !s.moduleSpecifier.text.startsWith(".")) continue;
      const nb = s.importClause?.namedBindings;
      if (!nb || !ts.isNamedImports(nb) || s.importClause?.isTypeOnly) continue;
      const base = norm(`${dir}/${s.moduleSpecifier.text}`);
      const mod = [base, `${base}.ts`, base.replace(/\.js$/, ".ts"), `${base}/index.ts`].find((c) => /\.ts$/.test(c) && !/\.d\.ts$/.test(c) && read(c) !== null);
      if (!mod) continue;
      const content = read(mod)!;
      for (const el of nb.elements) {
        if (el.isTypeOnly || found >= 3) continue;
        const local = el.name.text, imported = (el.propertyName ?? el.name).text;
        if (seen.has(`${mod}#${imported}`)) continue;
        let calls = 0; const v = (n: ts.Node): void => { if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === local) calls++; ts.forEachChild(n, v); }; v(sf);
        if (!calls) continue;
        let r2: string | null, r3: string | null;
        try { r2 = existingTargetRefusal(mod, content, imported, { v2: { read } }); r3 = existingTargetRefusal(mod, content, imported, { v2: { read }, dates: true }); } catch { continue; }
        if (r2 === null || r3 !== null) continue;
        seen.add(`${mod}#${imported}`);
        const fw = /from ["']vitest["']/.test(test) ? "vitest" : /from ["']node:test["']/.test(test) ? "node:test" : /from ["']bun:test["']/.test(test) ? "bun:test" : /@jest|jest/.test(test) ? "jest" : "other";
        out.push({ repo: name, commit: head, parent: head, test: path, module: mod, fn: imported, v1: existingTargetRefusal(mod, content, imported), v2: r2, calls, framework: fw, files: 0, status: "HEAD" });
        found++;
        writeFileSync(outFile, JSON.stringify(out, null, 1));
      }
    }
  }
}
writeFileSync(outFile, JSON.stringify(out, null, 1));
console.error("done", out.length);
