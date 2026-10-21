// M85: TEST_CASE_EXISTING v2 examples: a non-merge commit that changes ONLY test files and adds calls to an exported
// function of a relative sibling module that existed at the parent, which the v1 target refuses and the v2 target
// (plain-data types, followed sibling imports) accepts on the parent's module text.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import ts from "/workspace/v4-ws/node_modules/typescript/lib/typescript.js";
import { existingTargetRefusal } from "/workspace/v4-ws/peaceai/lib/learned-test-existing.ts";
const git = (d: string, ...a: string[]) => execFileSync("git", ["-C", d, ...a], { encoding: "utf8", maxBuffer: 1 << 28, stdio: ["ignore", "pipe", "ignore"], timeout: 120000 });
const dirs = readFileSync(process.argv[2]!, "utf8").trim().split("\n");
const outFile = process.argv[3]!;
const out: unknown[] = [];
for (const dn of dirs) {
  const name = dn.replace("__", "/");
  const d = `/workspace/mine/repos/${dn}`;
  if (!existsSync(d)) continue;
  let log: string;
  try { log = git(d, "log", "--no-merges", "--format=@%H %P", "--name-status", "--no-renames", "-n", "6000", "HEAD"); } catch { continue; }
  let found = 0;
  for (const block of log.split("\n@").map((b) => b.replace(/^@/, ""))) {
    if (found >= 3) break;
    const lines = block.split("\n").filter(Boolean);
    const [sha, parent, more] = lines[0]!.split(" ");
    if (!parent || more) continue;
    const ch = lines.slice(1);
    if (ch.length === 0 || ch.length > 6) continue;
    const parts = ch.map((c) => c.split("\t"));
    if (!parts.every(([st, p]) => (st === "A" || st === "M") && /\.(?:test|spec)\.ts$/.test(p!))) continue;
    let parentFiles: Set<string> | null = null;
    const cache = new Map<string, string | null>();
    const read = (rel: string): string | null => {
      if (!parentFiles) { try { parentFiles = new Set(git(d, "ls-tree", "-r", "--name-only", parent).split("\n")); } catch { parentFiles = new Set(); } }
      if (!parentFiles.has(rel)) return null;
      if (!cache.has(rel)) { try { cache.set(rel, git(d, "show", `${parent}:${rel}`)); } catch { cache.set(rel, null); } }
      return cache.get(rel)!;
    };
    for (const [st0, path] of parts) {
      if (found >= 3) break;
      let test: string;
      try { test = git(d, "show", `${sha}:${path}`); } catch { continue; }
      let before = "";
      if (st0 === "M") { try { before = git(d, "show", `${parent}:${path}`); } catch { continue; } }
      const sf = ts.createSourceFile(path!, test, ts.ScriptTarget.Latest, true);
      const dir = path!.includes("/") ? path!.slice(0, path!.lastIndexOf("/")) : "";
      const norm = (p: string) => { const o: string[] = []; for (const s of p.split("/")) { if (!s || s === ".") continue; if (s === "..") o.pop(); else o.push(s); } return o.join("/"); };
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
          if (el.isTypeOnly) continue;
          const local = el.name.text, imported = (el.propertyName ?? el.name).text;
          const count = (src: ts.SourceFile) => { let c = 0; const v = (n: ts.Node): void => { if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === local) c++; ts.forEachChild(n, v); }; v(src); return c; };
          const calls = count(sf);
          if (!calls) continue;
          if (st0 === "M" && calls <= count(ts.createSourceFile("b.ts", before, ts.ScriptTarget.Latest, true))) continue;
          let r1: string | null, r2: string | null;
          try { r1 = existingTargetRefusal(mod, content, imported, { v2: { read } }); r2 = existingTargetRefusal(mod, content, imported, { v2: { read }, dates: true }); } catch { continue; }
          if (r1 === null || r2 !== null || !/\bDate\b/.test(test)) continue;
          const fw = /from ["']vitest["']/.test(test) ? "vitest" : /from ["']node:test["']/.test(test) ? "node:test" : /from ["']bun:test["']/.test(test) ? "bun:test" : /@jest|jest/.test(test) ? "jest" : "other";
          const followed = [...cache.entries()].filter(([, v]) => v !== null).map(([k]) => k);
          out.push({ repo: name, commit: sha, parent, test: path, module: mod, fn: imported, v1: r1, calls, framework: fw, files: parts.length, status: st0, read: followed });
          found++;
          writeFileSync(outFile, JSON.stringify(out, null, 1));
          break;
        }
      }
    }
  }
}
writeFileSync(outFile, JSON.stringify(out, null, 1));
console.error("done", out.length);
