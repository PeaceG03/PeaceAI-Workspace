// M96 (Auditor #463 follow-up): the protected tools' lib import closure is protected too. Code in an imported module runs
// in the same trusted workflow step as the tool, so an unprotected import was a way around PROTECTED_SELF: before this,
// checkSelfChangeDiff accepted `export const authorIsNoreply = (_s: string) => true;` in lib/patch.ts (imported by the
// protected apply-verdict-patch.ts). Invariant pinned here: every relative import (static, re-export, dynamic import()
// or require) of a protected PeaceAI module resolves to a protected module, and so does every .ts a bin/*.sh runs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, normalize, resolve } from "node:path";
import ts from "typescript";
import { checkSelfChangeDiff, PROTECTED_SELF } from "../lib/selfchange.ts";

const root = resolve(import.meta.dirname, "../..");
const read = (p: string) => readFileSync(resolve(root, p), "utf8");
const isProt = (p: string) => PROTECTED_SELF.some((x) => x.pattern.test(p));
const isFile = (p: string) => existsSync(resolve(root, p)) && statSync(resolve(root, p)).isFile();
const walk = (d: string): string[] =>
  readdirSync(resolve(root, d), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? (e.name === "node_modules" || e.name === "fixtures" ? [] : walk(join(d, e.name))) : [join(d, e.name)]));

const NAMED = ["patch", "self-zone", "queue", "fill", "dedupe", "provenance", "sourcehunt", "memprompts", "refusal-reason", "review", "repair", "repairrecord", "repairloop", "symbols", "sources", "nlparse", "store", "mine", "minegit", "propose"].map((n) => `peaceai/lib/${n}.ts`)
  .concat(["features", "model", "pipeline"].map((n) => `peaceai/lib/ranker/${n}.ts`), ["peaceai/bin/kernel-guard.ts"]);

/** Relative module specifiers of a TypeScript file, including type-only, re-exports, import() and require(). */
function specifiers(p: string): string[] {
  const out: string[] = [];
  const v = (n: ts.Node): void => {
    if ((ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) && n.moduleSpecifier && ts.isStringLiteral(n.moduleSpecifier)) out.push(n.moduleSpecifier.text);
    if (ts.isCallExpression(n) && (n.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(n.expression) && n.expression.text === "require")) && n.arguments[0] && ts.isStringLiteralLike(n.arguments[0])) out.push(n.arguments[0].text);
    if (ts.isImportEqualsDeclaration(n) && ts.isExternalModuleReference(n.moduleReference) && ts.isStringLiteral(n.moduleReference.expression)) out.push(n.moduleReference.expression.text);
    ts.forEachChild(n, v);
  };
  v(ts.createSourceFile(p, read(p), ts.ScriptTarget.Latest, true));
  return out.filter((s) => s.startsWith("."));
}
function resolveRel(from: string, sp: string): string | null {
  const b = normalize(join(dirname(from), sp));
  for (const k of [b, b + ".ts", b + "/index.ts", b.replace(/\.js$/, ".ts")]) if (isFile(k)) return k;
  return null;
}

test("the lib modules the protected tools import, and kernel-guard.ts, are protected", () => {
  for (const p of NAMED) {
    assert.ok(isFile(p), p);
    assert.ok(isProt(p), p);
  }
  // kernel-guard.ts is what build-kernel.sh runs on the bundle.
  assert.match(read("peaceai/bin/build-kernel.sh"), /peaceai\/bin\/kernel-guard\.ts/);
  // An exact list, not a directory: a new helper module is not swept in.
  assert.ok(!isProt("peaceai/lib/m96-new-helper.ts"));
  assert.ok(!isProt("peaceai/lib/ranker/m96-new.ts"));
});

test("every relative import of a protected module, and every .ts a bin/*.sh runs, is protected (closure is closed)", () => {
  const code = [...walk("peaceai"), ...walk("builder-log")].filter((p) => p.endsWith(".ts") && !p.endsWith(".d.ts") && !p.endsWith(".test.ts") && !p.startsWith("peaceai/test/") && !p.startsWith("peaceai/self-tests/"));
  const entries = new Set(code.filter(isProt));
  for (const sh of readdirSync(resolve(root, "peaceai/bin")).filter((f) => f.endsWith(".sh")))
    for (const m of read(`peaceai/bin/${sh}`).matchAll(/(peaceai\/[\w./-]+\.ts)\b/g)) if (isFile(m[1]!)) entries.add(m[1]!);
  assert.ok(entries.size >= 100, String(entries.size));
  const seen = new Set(entries);
  const queue = [...entries];
  const bad: string[] = [];
  while (queue.length) {
    const p = queue.shift()!;
    if (!isProt(p)) bad.push(`${p} (entry)`);
    for (const sp of specifiers(p)) {
      const c = resolveRel(p, sp);
      if (c === null) { bad.push(`${p}: unresolved ${sp}`); continue; }
      if (!isProt(c)) bad.push(`${c} <- ${p}`);
      if (!seen.has(c)) { seen.add(c); queue.push(c); }
    }
  }
  assert.deepEqual(bad, []);
});

test("negative proof (Auditor #463): a self-change may not edit lib/patch.ts or any other closure module", () => {
  const edit = (path: string, line: string) =>
    `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n@@ -1,0 +1 @@\n+${line}\n`;
  const r = checkSelfChangeDiff(edit("peaceai/lib/patch.ts", "export const authorIsNoreply = (_s: string) => true;"));
  assert.equal(r.ok, false);
  assert.ok(r.refusals.some((x) => x.path === "peaceai/lib/patch.ts" && /^protected: /.test(x.reason)), JSON.stringify(r.refusals));
  for (const p of NAMED) assert.equal(checkSelfChangeDiff(edit(p, "export const m96 = 1;")).ok, false, p);
  // Control: a new, unprotected helper is still a valid self-change.
  assert.equal(checkSelfChangeDiff(`diff --git a/peaceai/lib/m96-new-helper.ts b/peaceai/lib/m96-new-helper.ts\nnew file mode 100644\n--- /dev/null\n+++ b/peaceai/lib/m96-new-helper.ts\n@@ -0,0 +1 @@\n+export const one = 1;\n`).ok, true);
});
