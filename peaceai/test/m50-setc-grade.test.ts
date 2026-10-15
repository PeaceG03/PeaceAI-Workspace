// M50: set C v2 grader. Every task counted; static only.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import ts from "typescript";
import { gradeAll as gradeList, gradeOne, declaredCount, tokens, type CTask } from "../lib/setc-grade.ts";
const repo = join(import.meta.dirname, "../..");
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const SRC = "export function add(a: number, b: number): number {\n  const s = a + b;\n  return s;\n}\nconst re = /x/g;\n";
const bs = SRC.indexOf("{"), be = SRC.indexOf("}\n") + 1;
const T: CTask = { id: "t1", repo: "o/r", path: "src/a.ts", fileSha256: sha(SRC), function: "add", bodyStart: bs, bodyEnd: be, bodySha256: sha(SRC.slice(bs, be)) };
const g = (b: string | undefined) => gradeOne(T, SRC, b).verdict;
const listOf = (tasks: CTask[], declared: number) => ({ tasks, counts: { "o/r": { chosen: declared } } });
const gradeAll = (tasks: CTask[], rd: (t: CTask) => string, p: { id: string; body: string }[], declared: number) => gradeList(listOf(tasks, declared), rd, p);

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
const BANNED_IDS = new Set(["getPrototypeOf", "getOwnPropertyDescriptor", "getOwnPropertyDescriptors", "getOwnPropertyNames", "setPrototypeOf", "eval", "require", "Function", "process", "globalThis", "global", "window", "self", "module", "exports", "createRequire", "Reflect", "Proxy", "constructor", "__proto__", "importScripts", "WebAssembly"]);
// Auditor #177: only these `ts` members (no createProgram, sys, transpile*, ...) and only readFileSync from node:fs.
const ALLOWED_TS = new Set(["Block", "LanguageVariant", "Node", "ScriptKind", "ScriptTarget", "SourceFile", "SyntaxKind", "createScanner", "createSourceFile", "forEachChild", "isFunctionDeclaration", "isIdentifier", "isMethodDeclaration"]);
const ALLOWED_FS = new Set(["readFileSync"]);
const NEVER_PROP = ["constructor", "__proto__", "eval", "require", "Function", "getPrototypeOf", "getOwnPropertyDescriptor", "getOwnPropertyDescriptors", "getOwnPropertyNames", "setPrototypeOf"];
const ALLOWED_PROCESS = new Set(["process.argv", "process.env.EXT_DIR"]);
function auditAst(file: string, text: string): string[] {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const bad: string[] = []; const imports: string[] = [];
  const v = (n: ts.Node): void => {
    if (ts.isImportDeclaration(n) && ts.isStringLiteral(n.moduleSpecifier) && /^(node:)?fs(\/promises)?$/.test(n.moduleSpecifier.text)) {
      const c = n.importClause;
      if (!c || c.name || !c.namedBindings || !ts.isNamedImports(c.namedBindings)) bad.push("fs: only named imports");
      else for (const e of c.namedBindings.elements) if (!ALLOWED_FS.has((e.propertyName ?? e.name).text)) bad.push(`fs.${(e.propertyName ?? e.name).text}`);
    }
    if (ts.isIdentifier(n) && n.text === "ts" && !(ts.isImportClause(n.parent))) {
      const p = n.parent;
      const member = ts.isPropertyAccessExpression(p) && p.expression === n ? p.name.text : ts.isQualifiedName(p) && p.left === n ? p.right.text : null;
      if (member === null) bad.push("ts used other than as ts.<allowed member>");
      else if (!ALLOWED_TS.has(member)) bad.push(`ts.${member}`);
    }
    if (ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) { if (n.moduleSpecifier && ts.isStringLiteral(n.moduleSpecifier)) imports.push(n.moduleSpecifier.text); else if (n.moduleSpecifier) bad.push("non-literal module specifier"); }
    else if (ts.isImportEqualsDeclaration(n)) bad.push("import = require");
    else if (ts.isCallExpression(n) && n.expression.kind === ts.SyntaxKind.ImportKeyword) bad.push("dynamic import()");
    else if (ts.isMetaProperty(n) && n.keywordToken === ts.SyntaxKind.ImportKeyword && !(ts.isPropertyAccessExpression(n.parent) && n.parent.name.text === "url" && ts.isNewExpression(n.parent.parent) && ts.isIdentifier(n.parent.parent.expression) && n.parent.parent.expression.text === "URL")) bad.push("import.meta use other than new URL(..., import.meta.url)");
    else if (ts.isElementAccessExpression(n) && !ts.isNumericLiteral(n.argumentExpression) && !ts.isIdentifier(n.argumentExpression) && !ts.isPropertyAccessExpression(n.argumentExpression) && !ts.isNonNullExpression(n.argumentExpression)) bad.push(`computed member access: ${n.getText(sf)}`);
    else if (ts.isTaggedTemplateExpression(n)) bad.push("tagged template");
    else if (ts.isIdentifier(n) && BANNED_IDS.has(n.text)) {
      let top: ts.Node = n; while (ts.isPropertyAccessExpression(top.parent) && top.parent.expression === top) top = top.parent;
      const isPropName = ts.isPropertyAccessExpression(n.parent) && n.parent.name === n;
      if (!(n.text === "process" && ALLOWED_PROCESS.has(top.getText(sf))) && !(isPropName && !NEVER_PROP.includes(n.text))) bad.push(`identifier ${n.text}`);
    } else if (ts.isStringLiteralLike(n) && /^(eval|require|Function|constructor|__proto__|getPrototypeOf|getOwnPropertyDescriptors?|getOwnPropertyNames|setPrototypeOf|child_process|node:vm|vm|node:child_process|node:module|module)$/.test(n.text) && !imports.includes(n.text)) bad.push(`string ${n.text}`);
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
  const L = JSON.parse(readFileSync(join(repo, "peaceai/model/heldout-c-tasks.json"), "utf8"));
  const run = (f: (t: CTask) => string | undefined) => gradeList(L, src, tasks.flatMap((t) => { const b = f(t); return b === undefined ? [] : [{ id: t.id, body: b }]; })).summary;
  const s1 = run((t) => src(t).slice(t.bodyStart, t.bodyEnd));
  assert.deepEqual([s1.tasks, s1.pass, s1.fail, s1.ungradable], [138, 138, 0, 0]);
  const s2 = run(() => undefined);
  assert.deepEqual([s2.tasks, s2.pass, s2.fail, s2.ungradable], [138, 0, 138, 0]);
  const s3 = run(() => "{ (((");
  assert.deepEqual([s3.tasks, s3.pass, s3.fail, s3.ungradable], [138, 0, 0, 138]);
});

test("Auditor #177: no-exec audit blocks Function via getPrototypeOf, ts.createProgram, ts.sys.writeFile and fs writes", () => {
  const lib = "peaceai/lib/setc-grade.ts", bin = "peaceai/bin/setc-grade.ts";
  const hdr = 'import ts from "typescript";\nimport { createHash } from "node:crypto";\n';
  const bhdr = 'import { readFileSync } from "node:fs";\nimport { gradeAll, declaredCount, type CTask } from "../lib/setc-grade.ts";\n';
  const cases: [string, string, RegExp][] = [
    [lib, hdr + "const F = Object.getPrototypeOf(async () => {}).constructor; F('x')();", /getPrototypeOf/],
    [lib, hdr + "const F = Object.getPrototypeOf(function* () {}).constructor;", /getPrototypeOf/],
    [lib, hdr + "Object.getOwnPropertyDescriptor(Object.prototype, 'x');", /getOwnPropertyDescriptor/],
    [lib, hdr + "Object.getOwnPropertyDescriptors(Object.prototype);", /getOwnPropertyDescriptors/],
    [lib, hdr + "Object.getOwnPropertyNames(Object.prototype);", /getOwnPropertyNames/],
    [lib, hdr + "const { getPrototypeOf: g } = Object; g(1);", /getPrototypeOf/],
    [lib, hdr + "ts.createProgram(['x.ts'], {}).emit();", /ts\.createProgram/],
    [lib, hdr + "ts.sys.writeFile('x', 'y');", /ts\.sys/],
    [lib, hdr + "ts.transpileModule('x', {});", /ts\.transpileModule/],
    [lib, hdr + "const t = ts; t.sys.writeFile('x', 'y');", /ts used other than/],
    [lib, hdr + "const { sys } = ts;", /ts used other than/],
    [lib, hdr + "let x: ts.Program;", /ts\.Program/],
    [bin, 'import { readFileSync, writeFileSync } from "node:fs";\nimport { gradeAll, declaredCount, type CTask } from "../lib/setc-grade.ts";\nwriteFileSync("x", "y");', /fs\.writeFileSync/],
    [bin, 'import { readFileSync as r, appendFileSync as a } from "node:fs";\nimport { gradeAll, declaredCount, type CTask } from "../lib/setc-grade.ts";', /fs\.appendFileSync/],
    [bin, 'import * as fs from "node:fs";\nimport { gradeAll, declaredCount, type CTask } from "../lib/setc-grade.ts";\nfs.writeFileSync("x", "y");', /fs: only named imports/],
    [bin, 'import fs from "node:fs";\nimport { gradeAll, declaredCount, type CTask } from "../lib/setc-grade.ts";', /fs: only named imports/],
    [bin, bhdr + "readFileSync.constructor('x');", /identifier constructor/],
  ];
  for (const [f, src, why] of cases) assert.ok(auditAst(f, src).some((b) => why.test(b)), `${src} -> ${JSON.stringify(auditAst(f, src))}`);
  assert.deepEqual(auditAst(lib, hdr + "const k = ts.SyntaxKind.Identifier; let b: ts.Block;"), [], "allowed members pass");
});

test("Auditor #177: \"/\" is a regex only after a non-expression token", () => {
  const kinds = (s: string) => tokens(s, "x.ts").map((t) => Number(t.split(":")[0]));
  const RE = ts.SyntaxKind.RegularExpressionLiteral, SL = ts.SyntaxKind.SlashToken;
  assert.deepEqual(kinds("a / b / c").filter((k) => k === SL).length, 2, "division chain is not a regex");
  assert.ok(!kinds("(a) / 2 / (b)").includes(RE)); assert.ok(!kinds("x[0] / y / z").includes(RE)); assert.ok(!kinds("x! / y / z").includes(RE));
  assert.ok(!kinds("1 / 2 / 3").includes(RE)); assert.ok(!kinds("i++ / 2 / j").includes(RE)); assert.ok(!kinds("this.a /= 2 / b").includes(RE));
  assert.ok(kinds("const r = /a b/g;").includes(RE)); assert.ok(kinds("f(/x/);").includes(RE)); assert.ok(kinds("return /x/.test(s);").includes(RE));
  assert.ok(kinds("!/x/.test(s)").includes(RE)); assert.ok(kinds("[/a/, /b/]").includes(RE)); assert.ok(kinds("a = b ? /x/ : /y/;").includes(RE));
  assert.deepEqual(tokens("a / b /  c", "x.ts"), tokens("a / b / c", "x.ts"), "whitespace between division operands is trivia");
});

test("Auditor #177: gradeAll derives the expected count from the list's own declaredCount", () => {
  const ts3 = [T, { ...T, id: "t2" }, { ...T, id: "t3" }];
  assert.equal(gradeList(listOf(ts3, 3), () => SRC, []).summary.tasks, 3);
  assert.throws(() => gradeList(listOf(ts3, 138), () => SRC, []), /task count 3 != declared 138/);
  assert.throws(() => gradeList({ tasks: ts3, counts: { a: { chosen: 1 }, b: { chosen: 1 } } }, () => SRC, []), /task count 3 != declared 2/);
  assert.equal(gradeList.length, 3, "no caller-supplied count parameter");
  assert.ok(/gradeAll\(L,/.test(readFileSync(join(repo, "peaceai/bin/setc-grade.ts"), "utf8")));
});
