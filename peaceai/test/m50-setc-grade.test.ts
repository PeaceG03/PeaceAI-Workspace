// M50: set C v2 grader. Every task counted; static only.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import ts from "typescript";
import { gradeAll, gradeOne, declaredCount, tokens, type CTask } from "../lib/setc-grade.ts";
const repo = join(import.meta.dirname, "../..");
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const SRC = "export function add(a: number, b: number): number {\n  const s = a + b;\n  return s;\n}\nconst re = /x/g;\n";
const bs = SRC.indexOf("{"), be = SRC.indexOf("}\n") + 1;
const T: CTask = { id: "t1", repo: "o/r", path: "src/a.ts", fileSha256: sha(SRC), function: "add", bodyStart: bs, bodyEnd: be, bodySha256: sha(SRC.slice(bs, be)) };
const g = (b: string | undefined) => gradeOne(T, SRC, b).verdict;

test("pass is token-equal (whitespace and comments ignored); a changed token fails", () => {
  assert.equal(g(SRC.slice(bs, be)), "pass");
  assert.equal(g("{ const s = a + b; /* c */ return s; }"), "pass");
  assert.equal(g("{ const t = a + b; return t; }"), "fail");
  assert.equal(g("{ return a - b; }"), "fail");
});

test("no output fails; unparsable or span-escaping output is ungradable", () => {
  assert.equal(g(undefined), "fail"); assert.equal(g("  "), "fail");
  assert.equal(g("{ return a +; }"), "ungradable");
  assert.equal(g("{ return a; } } function x() {"), "ungradable");
  assert.equal(g("{ return a; }\nfunction extra() {}"), "ungradable", "must close at the original boundary");
});

test("a wrong pinned file or span is refused, never graded", () => {
  assert.throws(() => gradeOne(T, SRC + " ", "{}"), /pinned file mismatch/);
  assert.throws(() => gradeOne({ ...T, bodySha256: "0".repeat(64) }, SRC, "{}"), /body span mismatch/);
});

test("denominator: every task counted; unknown ids ignored; duplicates refused", () => {
  const ts2 = [T, { ...T, id: "t2" }, { ...T, id: "t3" }];
  const { summary } = gradeAll(ts2, () => SRC, [{ id: "t1", body: SRC.slice(bs, be) }, { id: "t2", body: "{ x" }, { id: "zz", body: "{}" }], 3);
  assert.deepEqual([summary.tasks, summary.pass, summary.fail, summary.ungradable, summary.unknownPredictions], [3, 1, 1, 1, 1]);
  assert.throws(() => gradeAll(ts2, () => SRC, [{ id: "t1", body: "{}" }, { id: "t1", body: "{}" }], 3), /duplicate/);
  assert.throws(() => gradeAll(ts2, () => SRC, [], 138), /task count 3 != declared 138/);
  assert.throws(() => gradeAll(ts2.slice(0, 2), () => SRC, [], 3), /task count/);
});

test("template literals: text after ${...} is compared as literal text, not code", () => {
  const TS = "export function f(a: string): string {\n  return `x ${a} y z`;\n}\n";
  const s0 = TS.indexOf("{"), e0 = TS.indexOf("}\n", TS.indexOf("`;")) + 1;
  const TT: CTask = { id: "tt", repo: "o/r", path: "src/t.ts", fileSha256: sha(TS), function: "f", bodyStart: s0, bodyEnd: e0, bodySha256: sha(TS.slice(s0, e0)) };
  const gt = (b: string) => gradeOne(TT, TS, b).verdict;
  assert.equal(gt("{ return `x ${a} y z`; }"), "pass");
  assert.equal(gt("{ return `x ${a} y   z`; }"), "fail", "whitespace inside the template tail is content");
  assert.equal(gt("{ return `x ${a} y /*q*/ z`; }"), "fail", "a comment-looking run inside the template is content");
  assert.equal(gt("{ return `x ${a}  y z`; }"), "fail", "whitespace-only change inside the template");
  assert.equal(gt("{ return `x ${ a } y z`; }"), "pass", "trivia inside the substitution is ignored");
  assert.equal(gt("{ return `x ${{ a }.a} y z`; }"), "fail");
  assert.notDeepEqual(tokens("`a ${b} c ${d} e`", "x.ts"), tokens("`a ${b} c ${d}  e`", "x.ts"));
  assert.deepEqual(tokens("`a ${ {k: 1}.k } c`", "x.ts").at(-1)?.endsWith("} c`"), true);
});

test("the task list declares 138 and holds 138", () => {
  const L = JSON.parse(readFileSync(join(repo, "peaceai/model/heldout-c-tasks.json"), "utf8"));
  assert.equal(declaredCount(L), 138); assert.equal(L.tasks.length, 138);
});

// AST check: imports are an exact allow-list, and nothing reaches eval/require/Function/process/vm, even dynamically.
const ALLOWED: Record<string, string[]> = {
  "peaceai/lib/setc-grade.ts": ["typescript", "node:crypto"],
  "peaceai/bin/setc-grade.ts": ["node:fs", "../lib/setc-grade.ts"],
};
const BANNED_IDS = new Set(["eval", "require", "Function", "process", "globalThis", "global", "window", "self", "module", "exports", "createRequire", "Reflect", "Proxy", "constructor", "__proto__", "importScripts", "WebAssembly"]);
const ALLOWED_PROCESS = new Set(["process.argv", "process.env.EXT_DIR"]);
function auditAst(file: string, text: string): string[] {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const bad: string[] = []; const imports: string[] = [];
  const v = (n: ts.Node): void => {
    if (ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) { if (n.moduleSpecifier && ts.isStringLiteral(n.moduleSpecifier)) imports.push(n.moduleSpecifier.text); else if (n.moduleSpecifier) bad.push("non-literal module specifier"); }
    else if (ts.isImportEqualsDeclaration(n)) bad.push("import = require");
    else if (ts.isCallExpression(n) && n.expression.kind === ts.SyntaxKind.ImportKeyword) bad.push("dynamic import()");
    else if (ts.isMetaProperty(n) && n.keywordToken === ts.SyntaxKind.ImportKeyword && !(ts.isPropertyAccessExpression(n.parent) && n.parent.name.text === "url" && ts.isNewExpression(n.parent.parent) && ts.isIdentifier(n.parent.parent.expression) && n.parent.parent.expression.text === "URL")) bad.push("import.meta use other than new URL(..., import.meta.url)");
    else if (ts.isElementAccessExpression(n) && !ts.isNumericLiteral(n.argumentExpression) && !ts.isIdentifier(n.argumentExpression) && !ts.isPropertyAccessExpression(n.argumentExpression) && !ts.isNonNullExpression(n.argumentExpression)) bad.push(`computed member access: ${n.getText(sf)}`);
    else if (ts.isTaggedTemplateExpression(n)) bad.push("tagged template");
    else if (ts.isIdentifier(n) && BANNED_IDS.has(n.text)) {
      let top: ts.Node = n; while (ts.isPropertyAccessExpression(top.parent) && top.parent.expression === top) top = top.parent;
      const isPropName = ts.isPropertyAccessExpression(n.parent) && n.parent.name === n;
      if (!(n.text === "process" && ALLOWED_PROCESS.has(top.getText(sf))) && !(isPropName && !["constructor", "__proto__", "eval", "require", "Function"].includes(n.text))) bad.push(`identifier ${n.text}`);
    } else if (ts.isStringLiteralLike(n) && /^(eval|require|Function|constructor|__proto__|child_process|node:vm|vm|node:child_process|node:module|module)$/.test(n.text) && !imports.includes(n.text)) bad.push(`string ${n.text}`);
    ts.forEachChild(n, v);
  };
  v(sf);
  const want = ALLOWED[file]!;
  if (imports.length !== want.length || !imports.every((m) => want.includes(m))) bad.push(`imports ${JSON.stringify(imports)} != ${JSON.stringify(want)}`);
  return bad;
}

test("the grader never executes code: AST-checked import allow-list, no eval/require/Function/process/vm, even dynamically", () => {
  for (const f of Object.keys(ALLOWED)) assert.deepEqual(auditAst(f, readFileSync(join(repo, f), "utf8")), [], f);
  const lib = "peaceai/lib/setc-grade.ts";
  const hdr = 'import ts from "typescript";\nimport { createHash } from "node:crypto";\n';
  for (const evil of ["globalThis['ev'+'al']('1');", "const { createRequire } = await import('node:module');", "import { createRequire } from 'node:module';", "const f = (0, eval); f('1');", "new Function('return 1')();", "const x = {}; x['con'+'structor'];", "process.mainModule;", "require('child_process');", "ts.sys.readFile('x');".replace("ts.sys.readFile('x');", "const k = 'ev' + 'al'; (globalThis as any)[k]('1');")])
    assert.notDeepEqual(auditAst(lib, hdr + evil), [], evil);
});

const EXT = process.env.EXT_DIR ?? "/workspace/ext";
test("all 138 #176 tasks: perfect = 138 pass, empty = 138 fail, broken = 138 ungradable", { skip: !existsSync(EXT) }, () => {
  const tasks = JSON.parse(readFileSync(join(repo, "peaceai/model/heldout-c-tasks.json"), "utf8")).tasks as CTask[];
  assert.equal(tasks.length, 138);
  const src = (t: CTask) => readFileSync(`${EXT}/${t.repo.replace("/", "__")}/${t.path}`, "utf8");
  const run = (f: (t: CTask) => string | undefined) => gradeAll(tasks, src, tasks.flatMap((t) => { const b = f(t); return b === undefined ? [] : [{ id: t.id, body: b }]; }), 138).summary;
  const s1 = run((t) => src(t).slice(t.bodyStart, t.bodyEnd));
  assert.deepEqual([s1.tasks, s1.pass, s1.fail, s1.ungradable], [138, 138, 0, 0]);
  const s2 = run(() => undefined);
  assert.deepEqual([s2.tasks, s2.pass, s2.fail, s2.ungradable], [138, 0, 138, 0]);
  const s3 = run(() => "{ (((");
  assert.deepEqual([s3.tasks, s3.pass, s3.fail, s3.ungradable], [138, 0, 0, 138]);
});
