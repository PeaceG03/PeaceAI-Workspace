// M58: METHOD_GUARD proposal (a new kind; ADD_THROW_GUARD v1 unchanged). Evidence, acceptance and refusal proofs.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import test from "node:test";
import ts from "typescript";
import { buildMethodGuardEdit, guardCondition, methodGuardCondition, methodGuardEnabled, safeRegexLiteral } from "../lib/method-guard.ts";
import { safeCondition } from "../lib/learned-guard.ts";
import { PROTECTED_SELF } from "../lib/selfchange.ts";

const root = resolve(import.meta.dirname, "../..");
const read = (p: string) => readFileSync(join(root, p), "utf8");
const EV = JSON.parse(read("peaceai/rules/proposals/m58-method-guard-evidence.json"));
const REC = JSON.parse(read("peaceai/rules/proposals/public-method-guard-v1.json"));
const expr = (t: string) => (ts.createSourceFile("c.ts", `(${t});`, ts.ScriptTarget.Latest, true).statements[0] as ts.ExpressionStatement).expression as ts.ParenthesizedExpression;
const C = (t: string, ps = ["s", "d", "o", "set"]) => methodGuardCondition(expr(t).expression, new Set(ps));
const SRC = 'export function f(s: string, d: Date, o: { name: string }, set: Set<string>) {\n  if (!s) return 0;\n  return s.length;\n}\n';
const B = (cond: string, form: "one-line" | "block" = "block", src = SRC, code = "BAD_S") => buildMethodGuardEdit("src/f.ts", src, "f", cond, code, form);
let refusals = 0;
const refuse = (r: unknown, msg: string) => { assert.ok(r === null || r === false, msg); refusals++; };

test("off by default; not approved; not wired; v1 untouched", () => {
  assert.equal(methodGuardEnabled({}), false);
  assert.equal(methodGuardEnabled({ PEACEAI_METHOD_GUARD: "1" }), false);
  assert.equal(methodGuardEnabled({ PEACEAI_METHOD_GUARD: "true" }), true);
  assert.ok(!read("peaceai/rules/approved.json").includes("public-method-guard-v1"));
  assert.match(REC.status, /^proposal-off/);
  assert.ok(!read("peaceai/lib/learned.ts").includes("method-guard"));
  assert.equal(safeCondition(expr("s.startsWith('x')").expression, new Set(["s"])), false, "v1 grammar still refuses method calls");
});

test("evidence: AST scan of the pinned example-only repos; every recorded guard is first-statement shaped and accepted", () => {
  const setc = new Set((JSON.parse(read("peaceai/model/heldout-c.json")).sets.C as { repo: string }[]).map((r) => r.repo));
  const pins = new Map((JSON.parse(read("peaceai/rules/proposals/m45-example-repos.json")).repos as { name: string; commit: string; spdx: string; licenseSha256: string }[]).map((r) => [r.name, r]));
  for (const x of EV.examples as { repo: string; commit: string; path: string; sha256: string; params: string[]; guard: string; license: string; licenseSha256: string }[]) {
    assert.ok(!setc.has(x.repo));
    const p = pins.get(x.repo);
    assert.ok(p, `${x.repo} is not on the example-only list`);
    assert.equal(x.commit, p.commit); assert.equal(x.license, p.spdx); assert.equal(x.licenseSha256, p.licenseSha256);
    assert.match(x.sha256, /^[0-9a-f]{64}$/);
    const sf = ts.createSourceFile("g.ts", x.guard, ts.ScriptTarget.Latest, true);
    assert.equal(sf.statements.length, 1);
    const c = guardCondition(sf.statements[0]!);
    assert.ok(c && methodGuardCondition(c, new Set(x.params)), x.guard);
  }
  assert.equal(EV.counts.firstStatementMethodGuards, EV.examples.length);
  assert.equal(REC.evidence.examples, EV.examples.length);
  assert.equal(REC.evidence.repos, new Set(EV.examples.map((x: { repo: string }) => x.repo)).size);
  assert.equal(REC.evidence.qualifies, EV.examples.length >= EV.bar);
  assert.equal(EV.bar, 5);
});

test("no overlap: no example repo is in the training corpus list or manifest (Architect M60)", () => {
  const corpus = new Set<string>((JSON.parse(read("peaceai/model/ext-corpus.json")).repos as { name: string }[]).map((r) => r.name));
  for (const l of read("peaceai/model/ext-manifest.jsonl").split("\n")) if (l.trim()) { const r = JSON.parse(l).repo; if (r) corpus.add(r); }
  for (const x of EV.examples as { repo: string }[]) assert.ok(!corpus.has(x.repo), `${x.repo} is in the training corpus`);
});

test("METHOD_GUARD accepts the method forms (#149 folded in) and builds one-line and block guards first", () => {
  for (const t of ["!s.startsWith('#')", "s.endsWith('.d.ts')", "s.includes('--')", "set.has(s)", "o.name.includes(':')", "s.trim() === ''", "!(d.getTime() > 0)", "!/^[0-9]{1,3}$/.test(s)", "/^[a-z]+$/i.test(o.name)", "typeof s !== 'string' || !s.startsWith(\"x\")"]) assert.ok(C(t), t);
  const block = B("s.startsWith('#')");
  assert.ok(block);
  assert.ok(block!.includes("  if (s.startsWith('#')) {\n    throw new Error(\"BAD_S\");\n  }\n  if (!s) return 0;"), block!);
  const one = B("s.includes('--')", "one-line");
  assert.ok(one!.includes("  if (s.includes('--')) throw new Error(\"BAD_S\");\n  if (!s) return 0;"), one!);
  const sq = B("s.endsWith('x')", "block", SRC.replace("return s.length;", "if (s === 'q') throw new Error('Q_ERR');\n  return s.length;"));
  assert.ok(sq!.includes("throw new Error('BAD_S');"), "file's quote style");
  assert.ok(B("set.has(s)", "block", "export function f(s: string, set: Set<string>) {}\n"), "empty body");
});

test("METHOD_GUARD refuses everything else", () => {
  const conds: [string, string][] = [
    ["s.length > 3", "no method call (that is v1)"],
    ["s.replace('a', 'b') === ''", "method outside the list"],
    ["s.startsWith('a', 1)", "extra argument"],
    ["s.startsWith()", "missing argument"],
    ["s.startsWith(s.slice(1))", "computed argument"],
    ["s.startsWith(x)", "free name argument"],
    ["s.trim('x') === ''", "argument to a no-arg method"],
    ["s?.startsWith('a')", "optional chaining"],
    ["s['startsWith']('a')", "computed access"],
    ["s.trim().startsWith('a')", "call-result receiver"],
    ["x.startsWith('a')", "non-param receiver"],
    ["globalThis.process.env.X.startsWith('a')", "global receiver"],
    ["re.test(s)", "regex held in a variable"],
    ["/a/g.test(s)", "flag g"],
    ["/a/y.test(s)", "flag y"],
    ["/(a+)+$/.test(s)", "ReDoS: quantified group"],
    ["/(a)\\1/.test(s)", "backreference"],
    ["/(?=a)b/.test(s)", "lookahead"],
    ["/(?<=a)b/.test(s)", "lookbehind"],
    [`/${"a".repeat(81)}/.test(s)`, "overlong regex"],
    ["/a/.test(s.slice(1))", "regex on a call result"],
    ["/a/.test('lit')", "regex on a literal"],
    ["s.startsWith(`${s}`)", "template with substitution"],
    ["(s.startsWith('a'), true)", "comma operator"],
    ["s.startsWith('a') ? 1 : 0", "conditional"],
    ["(s = 'a').startsWith('a')", "assignment"],
    ["new Set([s]).has(s)", "new"],
    ["s.startsWith<string>('a')", "type arguments"],
    ["s.startsWith.call(s, 'a')", "call indirection"],
  ];
  for (const [t, msg] of conds) refuse(C(t), msg);
  refuse(B("s.startsWith('#')", "block", SRC, "lower"), "bad code");
  refuse(B("s.startsWith('#')", "nested" as "block"), "bad form");
  refuse(B("s.startsWith('#')".padEnd(161, " ")), "too long");
  refuse(B("s.startsWith('#')", "block", SRC + "const z = 'BAD_S';\n"), "code already in file");
  refuse(buildMethodGuardEdit("src/f.test.ts", SRC, "f", "s.startsWith('#')", "BAD_S", "block"), "test file");
  refuse(buildMethodGuardEdit("src/f.d.ts", SRC, "f", "s.startsWith('#')", "BAD_S", "block"), ".d.ts");
  refuse(buildMethodGuardEdit("src/f.js", SRC, "f", "s.startsWith('#')", "BAD_S", "block"), ".js");
  refuse(buildMethodGuardEdit("src/f.ts", SRC, "g", "s.startsWith('#')", "BAD_S", "block"), "no such function");
  refuse(buildMethodGuardEdit("src/f.ts", SRC.replace("export function", "function"), "f", "s.startsWith('#')", "BAD_S", "block"), "not exported");
  refuse(buildMethodGuardEdit("src/f.ts", SRC + SRC, "f", "s.startsWith('#')", "BAD_S", "block"), "two implementations");
  refuse(buildMethodGuardEdit("src/f.ts", "export function f({ s }: { s: string }) { return s; }\n", "f", "s.startsWith('#')", "BAD_S", "block"), "destructured parameter");
  refuse(B("s.startsWith('#')); evil(("), "injection");
  refuse(guardCondition(ts.createSourceFile("g.ts", "if (s.startsWith('a')) { throw new Error('A'); } else { x(); }", ts.ScriptTarget.Latest, true).statements[0]!), "else branch");
  refuse(guardCondition(ts.createSourceFile("g.ts", "if (s.startsWith('a')) { log(); throw new Error('A'); }", ts.ScriptTarget.Latest, true).statements[0]!), "block with more than the throw");
  refuse(guardCondition(ts.createSourceFile("g.ts", "if (s.startsWith('a')) throw 'A';", ts.ScriptTarget.Latest, true).statements[0]!), "throw of a non-Error");
  refuse(safeRegexLiteral("/a/gi"), "regex flags");
  assert.equal(refusals, REFUSALS_STATED);
});
const REFUSALS_STATED = 45;

test("engine, spec, evidence and this test are protected; spec pinned", () => {
  for (const p of ["peaceai/lib/method-guard.ts", "peaceai/spec/method-guard-v1.md", "peaceai/test/m58-method-guard.test.ts", "peaceai/rules/proposals/m58-method-guard-evidence.json", "peaceai/rules/proposals/public-method-guard-v1.json"])
    assert.ok(PROTECTED_SELF.some((x) => x.pattern.test(p)), p);
  assert.equal(createHash("sha256").update(read("peaceai/spec/method-guard-v1.md")).digest("hex"), SPEC_SHA);
});
const SPEC_SHA = "4dc3b8326f699913f5b031408e54a6f144e0e0a8da1987c216cfd2d834af03d9";
