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

// M181 (Auditor #673 binding condition chain2.buildIsolation): the one exemption. The lb-corpus v2 builder
// (peaceai/bin/lb-corpus2.ts and its lib peaceai/lib/lbcorpus2.ts) is unprotected by design and runs ONLY from
// lb-chain2-corpus.sh, which runs ONLY in the c2-corpus job of peace-lb-chain2.yml: no environment, no secrets.,
// permissions contents: read, persist-credentials: false; its output is sha-checked against protected pins by the
// training job. Anything else (another script, another job, or that job gaining a secret) puts the .ts back in the
// closure and the test fails. Exact pair, not a directory.
const C2_SH = "lb-chain2-corpus.sh", C2_TS = "peaceai/bin/lb-corpus2.ts";
const C2_WF = () => read(".github/workflows/peace-lb-chain2.yml");
function c2CorpusJob(wf = C2_WF()): string {
  const m = /\n  c2-corpus:\n([\s\S]*?)(?=\n  [\w-]+:\n|$)/.exec(wf);
  return m ? m[1]! : "";
}
function secretsFreeBuild(sh: string, ts: string, c2wf = C2_WF()): boolean {
  if (sh !== C2_SH || ts !== C2_TS) return false;
  const job = c2CorpusJob(c2wf);
  if (!job.includes(`./peaceai/bin/${C2_SH}`)) return false;
  if (/secrets\.|environment:|write|id-token|TOKEN|\$\{\{\s*vars\./i.test(job)) return false;
  if (!/\n    permissions:\n      contents: read\n    steps:/.test(job)) return false;
  if (!/persist-credentials: false/.test(job)) return false;
  // Named nowhere else: no other workflow, no other job, no other bin/*.sh.
  for (const wf of readdirSync(resolve(root, ".github/workflows")).filter((f) => /\.ya?ml$/.test(f))) {
    const t = wf === "peace-lb-chain2.yml" ? c2wf : read(`.github/workflows/${wf}`);
    const n = t.split(C2_SH).length - 1;
    if (wf === "peace-lb-chain2.yml" ? n !== job.split(C2_SH).length - 1 : n !== 0) return false;
    if (t.includes("lb-corpus2.ts") || t.includes("lbcorpus2")) return false;
  }
  for (const o of readdirSync(resolve(root, "peaceai/bin")).filter((f) => f.endsWith(".sh") && f !== C2_SH))
    if (read(`peaceai/bin/${o}`).includes(C2_SH) || read(`peaceai/bin/${o}`).includes("lb-corpus2.ts")) return false;
  return true;
}

test("m181 exemption: only lb-corpus2.ts from lb-chain2-corpus.sh in the secrets-free c2-corpus job; near misses are not exempt", () => {
  assert.equal(secretsFreeBuild(C2_SH, C2_TS), true);
  assert.equal(secretsFreeBuild("lb-daily-cycle.sh", C2_TS), false);
  assert.equal(secretsFreeBuild(C2_SH, "peaceai/lib/lbcorpus2.ts"), false);
  assert.equal(secretsFreeBuild(C2_SH, "peaceai/bin/lb-corpus2b.ts"), false);
  assert.ok(!isProt(C2_TS) && !isProt("peaceai/lib/lbcorpus2.ts"));
  assert.ok(isProt(`peaceai/bin/${C2_SH}`) && isProt(".github/workflows/peace-lb-chain2.yml"));
  // The job text the exemption reads really is the c2-corpus job (it stops at c2-train).
  const job = c2CorpusJob();
  assert.match(job, /upload-artifact/);
  assert.doesNotMatch(job, /c2-train|LM_SAVES_R2/);
  // Mutants of the workflow text: each one must lose the exemption.
  const wf = C2_WF();
  const sub = (a: string, b: string) => { assert.ok(wf.includes(a), a); return wf.replace(a, b); };
  const MUT: [string, string][] = [
    ["secret env", sub("          retention-days: 1\n", "          retention-days: 1\n        env:\n          K: ${{ secrets.X }}\n")],
    ["contents write", sub("      contents: read\n    steps:\n      - uses: actions/checkout@3d3c", "      contents: write\n    steps:\n      - uses: actions/checkout@3d3c")],
    ["no permissions", sub("    permissions:\n      contents: read\n    steps:\n      - uses: actions/checkout@3d3c", "    steps:\n      - uses: actions/checkout@3d3c")],
    ["persisted credentials", sub("          fetch-depth: 0\n          persist-credentials: false\n", "          fetch-depth: 0\n")],
    ["environment", sub("    timeout-minutes: 60\n", "    timeout-minutes: 60\n    environment: peaceai-results\n")],
    ["vars", sub("          retention-days: 1\n", "          retention-days: 1\n          x: ${{ vars.Y }}\n")],
    ["not run in c2-corpus", sub("        run: ./peaceai/bin/lb-chain2-corpus.sh", "        run: echo")],
    ["also run in c2-train", wf.replace(/\n  c2-train:\n/, "\n  c2-train:\n    # ./peaceai/bin/lb-chain2-corpus.sh\n")],
    ["builder named in the workflow", wf + "\n# peaceai/bin/lb-corpus2.ts\n"],
  ];
  for (const [name, t] of MUT) { assert.notEqual(t, wf, name); assert.equal(secretsFreeBuild(C2_SH, C2_TS, t), false, name); }
});

test("every relative import of a protected module, and every .ts a bin/*.sh runs, is protected (closure is closed)", () => {
  const code = [...walk("peaceai"), ...walk("builder-log")].filter((p) => p.endsWith(".ts") && !p.endsWith(".d.ts") && !p.endsWith(".test.ts") && !p.startsWith("peaceai/test/") && !p.startsWith("peaceai/self-tests/"));
  const entries = new Set(code.filter(isProt));
  for (const sh of readdirSync(resolve(root, "peaceai/bin")).filter((f) => f.endsWith(".sh")))
    for (const m of read(`peaceai/bin/${sh}`).matchAll(/(peaceai\/[\w./-]+\.ts)\b/g)) if (isFile(m[1]!) && !secretsFreeBuild(sh, m[1]!)) entries.add(m[1]!);
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
