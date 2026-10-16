// M64 LOOP_FUNCTION (public-loop-function-v1): the COMPLEX_FUNCTION engine with loops enabled per spec params.loops.
// public-complex-function-v1 (#211) keeps loops ["none"] and still refuses every loop as loop_unsupported.
import { test } from "node:test";
import assert from "node:assert/strict";
import ts from "typescript";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { CLOSURE_NOT_ALLOWED, LOOP_ASYNC, LOOP_LABEL, LOOP_TRIGGER, LOOP_UNBOUNDED, LOOP_UNSUPPORTED, LOOP_WHILE_UNSUPPORTED, COMPLEX_TRIGGER } from "../lib/learned-complex.ts";
import { applyRule, specHash, validateSpec, type RuleSpec } from "../lib/learned.ts";
import { readManifestBytes } from "../lib/manifestparts.ts";
import { classifyLicense } from "../lib/lmcorpus.ts";
import { PROTECTED_SELF } from "../lib/selfchange.ts";

const root = resolve(import.meta.dirname, "../..");
const read = (p: string) => readFileSync(resolve(root, p), "utf8");
const SPEC = JSON.parse(read("peaceai/rules/learned/public-loop-function-v1.json")) as RuleSpec;
const SPEC_SHA = "d01626560b33dbc88bd12e7375f3e003b32f1059677b2dfeb69920e231cc2512";
const COMPLEX = JSON.parse(read("peaceai/rules/learned/public-complex-function-v1.json")) as RuleSpec;
// v1 ships for/for-of only (while deferred: 2 qualifying while examples under the tighter start rule). V2 = the same
// spec with while-bounded, used below as groundwork for the bounded-while grammar kept in the engine.
const V2 = { ...SPEC, params: { ...SPEC.params, loops: ["counted-literal-or-length", "for-of-param", "while-bounded"] } } as RuleSpec;
const files = [{ path: "src/a.ts", content: "export const x = 1;\n" }];
const SIG = "f(n: number, xs: number[], s: string): number";
const task = (body: string, sig = SIG, check = "- f(3, [1, 2], \"ab\") is 1") => `add loop function ${sig} to src/a.ts with body:\n${body}\n${check}`;
const run = (body: string, spec: RuleSpec = V2, sig = SIG) => {
  const w: { reason?: string } = {};
  const e = applyRule(spec, spec === COMPLEX ? task(body, sig).replace("add loop function", "add complex function") : task(body, sig), files, undefined, undefined, w, () => false);
  return { e, r: w.reason };
};

// ---- positives: every allowed form ----
const ok: Record<string, string> = {
  "counted, literal bound": "let t = n;\nfor (let i = 0; i < 4; i++) {\nt += i;\n}\nreturn t;",
  "counted, <= literal": "let t = n;\nfor (let i = 1; i <= 4; i++) {\nt += i;\n}\nreturn t;",
  "counted, PARAM.length bound": "let t = 0;\nfor (let i = 0; i < xs.length; i++) {\nt += xs[i];\n}\nreturn t;",
  "counted, PARAM.length start": "let t = n;\nfor (let i = s.length; i < 9; i++) {\nt += 1;\n}\nreturn t;",
  "counted, i += 1": "let t = n;\nfor (let i = 0; i < xs.length; i += 1) {\nt += 2;\n}\nreturn t;",
  "counted, break/continue": "let t = 0;\nfor (let i = 0; i < 9; i++) {\nif (i === 2) continue;\nif (n < i) break;\nt += i;\n}\nreturn t;",
  "for-of over a parameter": "let t = 0;\nfor (const v of xs) {\nt += v;\n}\nreturn t;",
  "for-of over a slice of a parameter": "let t = 0;\nfor (const v of xs.slice(1)) {\nt += v;\n}\nreturn t;",
  "while up, C < B, += literal": "let c = 0;\nwhile (c < xs.length) {\nc += 2;\n}\nreturn c;",
  "while up, C <= PARAM.length, ++": "let c = 0;\nlet t = 0;\nwhile (c <= xs.length) {\nt += 1;\nc++;\n}\nreturn t;",
  "while up, swapped B > C": "let c = 0;\nwhile (10 > c) {\nc += 3;\n}\nreturn c + n;",
  "while down, C > B, --": "let c = xs.length;\nwhile (c > 0) {\nc--;\n}\nreturn c;",
  "while down, swapped B < C, -= literal": "let c = s.length;\nlet t = 0;\nwhile (0 < c) {\nif (s[c - 1] !== \" \") break;\nt += 1;\nc -= 1;\n}\nreturn t;",
  "two loops": "let t = 0;\nfor (const v of xs) {\nt += v;\n}\nlet c = 0;\nwhile (c < 3) {\nc += 1;\n}\nreturn t + c;",
};
for (const [name, body] of Object.entries(ok)) test(`builds: ${name}`, () => { const { e, r } = run(body); assert.ok(e, `${name}: ${r}`); assert.ok(e!.content.includes("export function f(n: number, xs: number[], s: string): number")); });

// ---- negatives: named refusals ----
const bad: [string, string, string][] = [
  ["while(true)", "let c = 0;\nwhile (true) {\nc += 1;\nif (n < c) return c;\n}\nreturn c;", LOOP_UNBOUNDED],
  ["while on a non-comparison", "let c = n;\nwhile (c) {\nc -= 1;\n}\nreturn c;", LOOP_UNBOUNDED],
  ["while without a step", "let c = 0;\nlet t = 0;\nwhile (c < n) {\nt += 1;\n}\nreturn t;", LOOP_UNBOUNDED],
  ["while with two steps", "let c = 0;\nwhile (c < n) {\nc += 1;\nc += 1;\n}\nreturn c;", LOOP_UNBOUNDED],
  ["while stepping away from the bound", "let c = 0;\nwhile (c < n) {\nc -= 1;\n}\nreturn c;", LOOP_UNBOUNDED],
  ["while stepping by a parameter", "let c = 0;\nwhile (c < 10) {\nc += n;\n}\nreturn c;", LOOP_UNBOUNDED],
  ["while stepping by zero", "let c = 0;\nwhile (c < 10) {\nc += 0;\n}\nreturn c;", LOOP_UNBOUNDED],
  ["while counter also assigned inside an if", "let c = 0;\nwhile (c < 10) {\nif (n < c) {\nc = 0;\n}\nc += 1;\n}\nreturn c;", LOOP_UNBOUNDED],
  ["while with continue", "let c = 0;\nwhile (c < 10) {\nif (c === n) continue;\nc += 1;\n}\nreturn c;", LOOP_UNBOUNDED],
  ["while bound is a const copy of PARAM.length", "const len = xs.length;\nlet c = 0;\nwhile (c < len) {\nc += 1;\n}\nreturn c;", LOOP_UNBOUNDED],
  ["while bound is a let local", "let m = n;\nlet c = 0;\nwhile (c < m) {\nc += 1;\n}\nreturn c;", LOOP_UNBOUNDED],
  ["while counter is a parameter", "while (n < 10) {\nn += 1;\n}\nreturn n;", LOOP_UNBOUNDED],
  ["while bound over the literal cap", "let c = 0;\nwhile (c < 5000) {\nc += 1;\n}\nreturn c;", LOOP_UNBOUNDED],
  ["counted bound over the literal cap", "let t = 0;\nfor (let i = 0; i < 1001; i++) {\nt += 1;\n}\nreturn t;", LOOP_UNBOUNDED],
  ["counted bound is a string parameter", "let t = 0;\nfor (let i = 0; i < s; i++) {\nt += 1;\n}\nreturn t;", LOOP_UNBOUNDED],
  ["counted i += 2", "let t = 0;\nfor (let i = 0; i < 9; i += 2) {\nt += 1;\n}\nreturn t;", LOOP_UNBOUNDED],
  ["counted i--", "let t = 0;\nfor (let i = 0; i < 9; i--) {\nt += 1;\n}\nreturn t;", LOOP_UNBOUNDED],
  ["counted without a condition", "let t = 0;\nfor (let i = 0; ; i++) {\nt += 1;\n}\nreturn t;", LOOP_UNBOUNDED],
  ["counted counting down", "let t = 0;\nfor (let i = 9; i > 0; i++) {\nt += 1;\n}\nreturn t;", LOOP_UNBOUNDED],
  ["await in the body", "let t = 0;\nfor (const v of xs) {\nt += await v;\n}\nreturn t;", LOOP_ASYNC],
  ["for await", "let t = 0;\nfor await (const v of xs) {\nt += v;\n}\nreturn t;", LOOP_ASYNC],
  ["async arrow", "const g = async () => n;\nreturn n;", LOOP_ASYNC],
  ["labelled loop", "let t = 0;\nouter: for (const v of xs) {\nt += v;\n}\nreturn t;", LOOP_LABEL],
  ["break to a label", "let t = 0;\nouter: for (let i = 0; i < 3; i++) {\nfor (const v of xs) {\nif (v === i) break outer;\n}\n}\nreturn t;", LOOP_LABEL],
  ["arrow closure", "const g = (v: number) => v + n;\nreturn g(1);", CLOSURE_NOT_ALLOWED],
  ["function expression", "const g = function (v: number) { return v; };\nreturn g(n);", CLOSURE_NOT_ALLOWED],
  ["closure inside a loop", "let t = 0;\nfor (const v of xs) {\nt += [v].map((q) => q)[0];\n}\nreturn t;", CLOSURE_NOT_ALLOWED],
  // Auditor #218: starts and bounds are an integer literal 0..1000 or PARAM.length only.
  ["counted number-parameter bound", "let t = 0;\nfor (let i = 0; i < n; i++) {\nt += 1;\n}\nreturn t;", LOOP_UNBOUNDED],
  ["while number-parameter bound", "let c = 0;\nwhile (c < n) {\nc += 1;\n}\nreturn c;", LOOP_UNBOUNDED],
  ["counted start 1e17 (digits, wraps above 2^53)", "let t = n;\nfor (let i = 100000000000000000; i < 9; i++) {\nt += 1;\n}\nreturn t;", LOOP_UNBOUNDED],
  ["counted start 1e17 (exponent)", "let t = n;\nfor (let i = 1e17; i < 9; i++) {\nt += 1;\n}\nreturn t;", LOOP_UNBOUNDED],
  ["counted start over the literal cap", "let t = n;\nfor (let i = 1001; i < 9; i++) {\nt += 1;\n}\nreturn t;", LOOP_UNBOUNDED],
  ["counted negative start", "let t = n;\nfor (let i = -1000000; i < 9; i++) {\nt += 1;\n}\nreturn t;", LOOP_UNBOUNDED],
  ["counted number-parameter start", "let t = 0;\nfor (let i = n; i < 9; i++) {\nt += 1;\n}\nreturn t;", LOOP_UNBOUNDED],
  ["while start 1e17", "let c = 100000000000000000;\nwhile (c < xs.length) {\nc += 1;\n}\nreturn c;", LOOP_UNBOUNDED],
  ["while negative start counting up", "let c = -100000000;\nwhile (c < 10) {\nc += 1;\n}\nreturn c + n;", LOOP_UNBOUNDED],
  ["while number-parameter start", "let c = n;\nwhile (c > 0) {\nc -= 1;\n}\nreturn c;", LOOP_UNBOUNDED],
  ["while start is an expression", "let c = xs.length - 1;\nwhile (c > 0) {\nc -= 1;\n}\nreturn c;", LOOP_UNBOUNDED],
  ["while counter reassigned before the loop", "let c = 0;\nc = n;\nwhile (c < 10) {\nc += 1;\n}\nreturn c;", LOOP_UNBOUNDED],
  ["counted Infinity bound", "let t = n;\nfor (let i = 0; i < Infinity; i++) {\nt += 1;\n}\nreturn t;", LOOP_UNBOUNDED],
  ["while Infinity bound", "let c = 0;\nwhile (c < Infinity) {\nc += 1;\n}\nreturn c + n;", LOOP_UNBOUNDED],
  ["counted NaN bound", "let t = n;\nfor (let i = 0; i < NaN; i++) {\nt += 1;\n}\nreturn t;", LOOP_UNBOUNDED],
  ["while NaN bound", "let c = 10;\nwhile (c > NaN) {\nc -= 1;\n}\nreturn c + n;", LOOP_UNBOUNDED],
  ["counted huge bound 1e9", "let t = n;\nfor (let i = 0; i < 1e9; i++) {\nt += 1;\n}\nreturn t;", LOOP_UNBOUNDED],
  ["while huge bound 9007199254740993", "let c = 0;\nwhile (c < 9007199254740993) {\nc += 1;\n}\nreturn c + n;", LOOP_UNBOUNDED],
  ["do-while", "let c = 0;\ndo {\nc += 1;\n} while (c < 3);\nreturn c;", LOOP_UNSUPPORTED],
  ["for-in", "let t = 0;\nfor (const k in xs) {\nt += 1;\n}\nreturn t;", LOOP_UNSUPPORTED],
];
for (const [name, body, reason] of bad) test(`refused ${reason}: ${name}`, () => { const { e, r } = run(body); assert.equal(e, null); assert.equal(r, reason, name); });
test("refused body_refused: index modified, growing for-of source, three loops", () => {
  assert.equal(run("let t = 0;\nfor (let i = 0; i < 9; i++) {\ni = 9;\n}\nreturn t;").r, "body_refused");
  assert.equal(run("const out: number[] = [];\nfor (const v of out) {\nout.push(v);\n}\nreturn n;").r, "body_refused");
  assert.equal(run("let t = 0;\nfor (const v of xs) {\nt += v;\n}\nfor (const v of xs) {\nt += v;\n}\nfor (const v of xs) {\nt += v;\n}\nreturn t;").r, "body_refused");
});

// ---- fallback spec (for/for-of only) and #211 untouched ----
test("v1 spec (for/for-of only): every while is loop_while_unsupported; for/for-of forms and refusals as in V2", () => {
  for (const [name, body] of Object.entries(ok)) {
    const v1 = run(body, SPEC);
    if (/while/.test(body)) assert.equal(v1.r, LOOP_WHILE_UNSUPPORTED, name); else assert.ok(v1.e, `${name}: ${v1.r}`);
  }
  for (const [name, body, reason] of bad) if (!/\bwhile \(/.test(body) || /\bdo \{/.test(body)) assert.equal(run(body, SPEC).r, reason, name);
  assert.equal(run(bad[0]![1], SPEC).r, LOOP_WHILE_UNSUPPORTED, "while(true) under v1");
});
test("#211 public-complex-function-v1 is untouched: loops [none], every loop form is loop_unsupported", () => {
  assert.equal(specHash(COMPLEX), "e0ff5c68586d04d5366d204e2cd7956236891b4d7ad3dc2dbb69888859bcc7d3");
  assert.deepEqual((COMPLEX.params as { loops: string[] }).loops, ["none"]);
  for (const body of [ok["counted, literal bound"]!, ok["for-of over a parameter"]!, ok["while up, C < B, += literal"]!, bad[0]![1]]) assert.equal(run(body, COMPLEX).r, LOOP_UNSUPPORTED);
  assert.equal(run(ok["counted, literal bound"]!).e === null, false, "the same body builds under the loop rule");
  const w: { reason?: string } = {};
  assert.equal(applyRule(COMPLEX, task(ok["counted, literal bound"]!), files, undefined, undefined, w, () => false), null, "the loop phrase is not the complex phrase");
  assert.equal(w.reason, "task_unparsed");
});

// ---- wiring ----
test("wiring: spec valid, hash pinned, own trigger, nlparse knows it, approval only with the exact hash, protected", () => {
  assert.ok(validateSpec(SPEC));
  assert.equal(specHash(SPEC), SPEC_SHA);
  assert.equal(SPEC.kind, "COMPLEX_FUNCTION");
  assert.equal(SPEC.trigger, LOOP_TRIGGER);
  assert.notEqual(LOOP_TRIGGER, COMPLEX_TRIGGER);
  assert.deepEqual((SPEC.params as { loops: string[] }).loops, ["counted-literal-or-length", "for-of-param"]);
  assert.ok(!validateSpec({ ...SPEC, params: { ...SPEC.params, loops: ["none", "for-of-param"] } }), "none mixed with loop kinds refused");
  assert.ok(!validateSpec({ ...SPEC, params: { ...SPEC.params, loops: ["while-bounded", "none"] } }), "none mixed with loop kinds refused");
  assert.ok(validateSpec({ ...SPEC, params: { ...SPEC.params, loops: ["none"] } }), "none alone is fine");
  assert.ok(read("peaceai/lib/nlparse.ts").includes("new RegExp(LOOP_TRIGGER"));
  const list = JSON.parse(read("peaceai/rules/approved.json")) as { rules: { id: string; sha256: string }[] };
  for (const r of list.rules.filter((x) => x.id === SPEC.id)) assert.equal(r.sha256, SPEC_SHA);
  const rec = JSON.parse(read("peaceai/rules/proposals/public-loop-function-v1.json")) as { status: string; evidence: { examples: number; bar: number; forAndForOf: number; while: number; v2WhileCandidates: number } };
  assert.equal(rec.evidence.while, 0); assert.equal(rec.evidence.v2WhileCandidates, EV.v2WhileCandidates.length);
  assert.match(rec.status, /^proposal-off/);
  assert.equal(rec.evidence.examples, EV.examples.length);
  assert.ok(rec.evidence.forAndForOf >= rec.evidence.bar);
  for (const p of ["peaceai/rules/learned/public-loop-function-v1.json", "peaceai/rules/proposals/public-loop-function-v1.json", "peaceai/rules/proposals/m64-loop-function-evidence.json", "peaceai/test/m64-loop-function.test.ts", "peaceai/test/fixtures/m64/x.txt"]) assert.ok(PROTECTED_SELF.some((x) => x.pattern.test(p)), p);
});
test("proof A (daysBackToSlotDay) builds; proof B (number-parameter bound) is refused as loop_unbounded", () => {
  const scan = { path: "src/scan-backstop.ts", content: "export const SCAN_SLOT_DAYS = [2, 3, 4, 5, 6] as const;\n" };
  const w: { reason?: string } = {};
  const a = applyRule(SPEC, "add loop function daysBackToSlotDay(todayUtcDay: number, slotDays: readonly number[]): number to src/scan-backstop.ts with body:\nfor (let d = 0; d <= 4; d++) {\nif (slotDays.includes((todayUtcDay + 7 - d) % 7)) return d;\n}\nreturn -1;\n- daysBackToSlotDay(2, [2, 3, 4, 5, 6]) is 0\n- daysBackToSlotDay(1, [2, 3, 4, 5, 6]) is 2", [scan], undefined, undefined, w, () => false);
  assert.ok(a, w.reason);
  const wb: { reason?: string } = {};
  const b = applyRule(SPEC, "add loop function countUpTo(limit: number): number to src/scan-backstop.ts with body:\nlet n = 0;\nfor (let i = 0; i < limit; i++) {\nn += 1;\n}\nreturn n;\n- countUpTo(3) is 3", [scan], undefined, undefined, wb, () => false);
  assert.equal(b, null); assert.equal(wb.reason, LOOP_UNBOUNDED);
  const wt: { reason?: string } = {};
  assert.equal(applyRule(SPEC, "add loop function stepsUntilOver(limit: number): number to src/scan-backstop.ts with body:\nlet n = 0;\nwhile (true) {\nn += 1;\nif (limit < n) return n;\n}\nreturn n;\n- stepsUntilOver(3) is 4", [scan], undefined, undefined, wt, () => false), null);
  assert.equal(wt.reason, LOOP_WHILE_UNSUPPORTED, "while(true) under v1");
});

// ---- synthetic while tests (extra only; never counted as evidence) ----
test("synthetic (extra): bounded whiles from the prep set", () => {
  assert.ok(run("let c = 0;\nwhile (c < s.length) {\nc += 5;\n}\nreturn c + n;").e);
  assert.ok(run("let i = s.length;\nwhile (i > 0) {\nif (s[i - 1] !== \" \") return s.length - i;\ni -= 1;\n}\nreturn s.length;").e);
});

// ---- mined evidence (#135 sourcing rules) ----
type Ex = { repo: string; commit: string; path: string; fn: string; line: number; exported: boolean; loops: string[]; sha256: string; license: string; licenseSha256: string; fixture: string; fileBlob: string };
const EV = JSON.parse(read("peaceai/rules/proposals/m64-loop-function-evidence.json")) as { bar: number; manifestSha256: string; note: string; examples: Ex[]; v2WhileCandidates: Ex[] };
const ALL = () => [...EV.examples, ...EV.v2WhileCandidates];
const PINS = JSON.parse(read("peaceai/rules/proposals/m45-example-repos.json")) as { notMined: string[]; repos: { name: string; commit: string; spdx: string; licenseFile: string; licenseSha256: string }[] };
const gitBlob = (b: Buffer) => createHash("sha1").update(`blob ${b.length}\0`).update(b).digest("hex");

test("evidence: v1 bar met (10 exported for/for-of), while deferred to v2 (2 candidates < 3), every example pinned, licenses by hash only", () => {
  assert.ok(EV.examples.length >= EV.bar);
  assert.ok(EV.examples.every((e) => e.exported && !e.loops.includes("while-bounded")), "v1 evidence: exported, no while");
  assert.ok(EV.v2WhileCandidates.length < 3 && EV.v2WhileCandidates.every((e) => e.loops.includes("while-bounded")));
  assert.match(EV.note, /deferred to v2/);
  for (const e of ALL()) {
    const pin = PINS.repos.find((p) => p.name === e.repo);
    assert.ok(pin && !PINS.notMined.includes(e.repo), e.repo);
    assert.equal(e.commit, pin!.commit); assert.equal(e.license, pin!.spdx); assert.equal(e.licenseSha256, pin!.licenseSha256);
    assert.ok(["MIT", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "ISC"].includes(e.license));
    if (!e.loops.includes("while-bounded")) assert.equal(e.exported, true, `${e.fn}: for/for-of evidence is exported`);
  }
});

// Test-side replay of the bounded-loop definition over the real (vocabulary-free) bodies.
function loopsOf(fn: ts.FunctionDeclaration, sf: ts.SourceFile): string[] {
  const params = new Set(fn.parameters.map((p) => p.name.getText(sf)));
  const body = fn.body!;
  const assigns = (n: ts.Node, k: string) => { let h = false; const v = (x: ts.Node) => { if (ts.isBinaryExpression(x) && x.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && x.operatorToken.kind <= ts.SyntaxKind.LastAssignment && ts.isIdentifier(x.left) && x.left.text === k) h = true; if ((ts.isPrefixUnaryExpression(x) || ts.isPostfixUnaryExpression(x)) && (x.operator === ts.SyntaxKind.PlusPlusToken || x.operator === ts.SyntaxKind.MinusMinusToken) && ts.isIdentifier(x.operand) && x.operand.text === k) h = true; ts.forEachChild(x, v); }; v(n); return h; };
  const fixed = (e: ts.Expression) => (ts.isNumericLiteral(e) && /^\d+$/.test(e.text) && Number(e.text) <= 1000) || (ts.isPropertyAccessExpression(e) && e.name.text === "length" && ts.isIdentifier(e.expression) && params.has(e.expression.text));
  const letInit = (k: string): ts.Expression | undefined => { let r: ts.Expression | undefined; const v = (x: ts.Node) => { if (ts.isVariableDeclaration(x) && x.name.getText(sf) === k && x.initializer) r = x.initializer; ts.forEachChild(x, v); }; v(body); return r; };
  const out: string[] = [];
  const visit = (n: ts.Node): void => {
    assert.ok(!ts.isAwaitExpression(n) && !ts.isLabeledStatement(n) && !ts.isDoStatement(n) && !ts.isForInStatement(n) && !(n !== fn && ts.isFunctionLike(n)), `${fn.name!.text}: refused form`);
    if (ts.isForOfStatement(n)) {
      const it = n.expression; const src = ts.isIdentifier(it) ? it : ts.isCallExpression(it) && ts.isPropertyAccessExpression(it.expression) && it.expression.name.text === "slice" && ts.isIdentifier(it.expression.expression) ? it.expression.expression : null;
      assert.ok(!n.awaitModifier && src && params.has(src.text) && !assigns(n.statement, src.text), `${fn.name!.text}: for-of over a parameter`);
      out.push("for-of-param");
    } else if (ts.isForStatement(n)) {
      const d = (n.initializer as ts.VariableDeclarationList).declarations[0]!; const i = d.name.getText(sf); const c = n.condition as ts.BinaryExpression; const inc = n.incrementor!;
      assert.ok(d.initializer && fixed(d.initializer) && c && ts.isIdentifier(c.left) && c.left.text === i && [ts.SyntaxKind.LessThanToken, ts.SyntaxKind.LessThanEqualsToken].includes(c.operatorToken.kind) && fixed(c.right), `${fn.name!.text}: counted bound`);
      assert.ok(((ts.isPostfixUnaryExpression(inc) || ts.isPrefixUnaryExpression(inc)) && inc.operator === ts.SyntaxKind.PlusPlusToken) || (ts.isBinaryExpression(inc) && inc.operatorToken.kind === ts.SyntaxKind.PlusEqualsToken && inc.right.getText(sf) === "1"), `${fn.name!.text}: step`);
      assert.ok(!assigns(n.statement, i), `${fn.name!.text}: untouched index`);
      out.push("counted-literal-or-length");
    } else if (ts.isWhileStatement(n)) {
      const c = n.expression as ts.BinaryExpression; const op = c.operatorToken.kind;
      const L = [ts.SyntaxKind.LessThanToken, ts.SyntaxKind.LessThanEqualsToken], G = [ts.SyntaxKind.GreaterThanToken, ts.SyntaxKind.GreaterThanEqualsToken];
      const leftCounter = ts.isIdentifier(c.left) && !fixed(c.left);
      const k = (leftCounter ? c.left : c.right).getText(sf); const bound = leftCounter ? c.right : c.left;
      const up = leftCounter ? L.includes(op) : G.includes(op);
      assert.ok([...L, ...G].includes(op) && fixed(bound) && ts.isBlock(n.statement), `${fn.name!.text}: while bound`);
      const init = letInit(k);
      assert.ok(init && fixed(init), `${fn.name!.text}: while start ${init?.getText(sf)}`);
      const st = (n.statement as ts.Block).statements;
      const isStep = (x: ts.Statement) => { if (!ts.isExpressionStatement(x)) return false; const e = x.expression; return (ts.isBinaryExpression(e) && e.left.getText(sf) === k && e.operatorToken.kind === (up ? ts.SyntaxKind.PlusEqualsToken : ts.SyntaxKind.MinusEqualsToken) && /^[1-9]\d*$/.test(e.right.getText(sf))) || ((ts.isPostfixUnaryExpression(e) || ts.isPrefixUnaryExpression(e)) && e.operand.getText(sf) === k && e.operator === (up ? ts.SyntaxKind.PlusPlusToken : ts.SyntaxKind.MinusMinusToken)); };
      let cont = false; const cv = (x: ts.Node) => { if (ts.isContinueStatement(x)) cont = true; ts.forEachChild(x, cv); }; cv(n.statement);
      assert.ok(st.filter(isStep).length === 1 && st.every((x) => isStep(x) || !assigns(x, k)) && !cont, `${fn.name!.text}: one provable step`);
      out.push("while-bounded");
    }
    ts.forEachChild(n, visit);
  };
  visit(body);
  return out;
}
test("evidence: every fixture is blob-pinned, <= 64 KB, and each function's loops replay through the bounded-loop definition", () => {
  for (const e of ALL()) {
    const b = readFileSync(resolve(root, e.fixture));
    assert.ok(b.length <= 65536, e.fixture);
    assert.equal(gitBlob(b), e.fileBlob, e.fixture);
    assert.equal(createHash("sha256").update(b).digest("hex"), e.sha256);
    assert.ok(e.fixture.endsWith(`${e.repo.replace("/", "__")}-${e.fileBlob.slice(0, 12)}.txt`));
    const sf = ts.createSourceFile("f.ts", b.toString("utf8"), ts.ScriptTarget.Latest, true);
    const fn = sf.statements.find((s): s is ts.FunctionDeclaration => ts.isFunctionDeclaration(s) && s.name?.text === e.fn && sf.getLineAndCharacterOfPosition(s.getStart(sf)).line + 1 === e.line);
    assert.ok(fn?.body, `${e.fn} in ${e.fixture}`);
    assert.equal((ts.getModifiers(fn!) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword), e.exported, e.fn);
    assert.ok(!(ts.getModifiers(fn!) ?? []).some((m) => m.kind === ts.SyntaxKind.AsyncKeyword) && !fn!.asteriskToken, e.fn);
    assert.deepEqual([...new Set(loopsOf(fn!, sf))].sort(), [...e.loops].sort(), e.fn);
  }
});
test("evidence: no LICENSE text committed; fixtures dir holds exactly the evidence fixtures", () => {
  const listed = new Set(ALL().map((e) => e.fixture.split("/").pop()));
  const have = readdirSync(resolve(root, "peaceai/test/fixtures/m64"));
  for (const f of have) { assert.ok(listed.has(f), f); assert.ok(!/licen[cs]e/i.test(f)); }
  assert.equal(have.length, listed.size);
});
test("evidence: no overlap with the training corpus or ext-manifest d4399d79", () => {
  const buf = readManifestBytes(resolve(root, "peaceai/model"), "ext-manifest");
  assert.equal(createHash("sha256").update(buf).digest("hex"), EV.manifestSha256);
  assert.ok(EV.manifestSha256.startsWith("d4399d79"));
  const repos = new Set<string>(); const shas = new Set<string>();
  for (const l of buf.toString("utf8").split("\n")) if (l.trim()) { const r = JSON.parse(l) as { repo?: string; sha256?: string }; if (r.repo) repos.add(r.repo); if (r.sha256) shas.add(r.sha256); }
  for (const r of (JSON.parse(read("peaceai/model/ext-corpus.json")) as { repos: { name: string }[] }).repos) repos.add(r.name);
  assert.ok(repos.size > 10);
  assert.ok(repos.has("PeaceG03/PeaceSTOCKS"), "Peace's repos are in the manifest, so none are used");
  for (const e of ALL()) { assert.ok(!repos.has(e.repo), e.repo); assert.ok(!shas.has(e.sha256), e.path); assert.ok(!e.repo.startsWith("PeaceG03/")); }
  for (const p of PINS.repos) assert.ok(!repos.has(p.name), `example-only repo ${p.name} not in the corpus`);
});

// vscode pin (new for M64): its LICENSE.txt at the pinned commit classifies as MIT with the pinned hash. Needs the
// network (no LICENSE text is committed); skipped offline.
test("m45 pin microsoft/vscode: LICENSE classifies as MIT and matches the pinned hash", async (t) => {
  const pin = PINS.repos.find((p) => p.name === "microsoft/vscode");
  assert.ok(pin);
  assert.equal(pin!.commit, "ce2bc857c5b748bde66ef464d7f7fc73dd1faad2");
  assert.equal(pin!.licenseSha256, "20535828272932407c2f5172aeb714ac7b374a34e5ecb1825af509f2902cde54");
  let text: string;
  try {
    const dir = mkdtempSync(join(tmpdir(), "m64-vscode-"));
    const g = (...a: string[]) => execFileSync("git", ["-C", dir, ...a], { encoding: "utf8", timeout: 120_000, stdio: ["ignore", "pipe", "ignore"] });
    g("init", "-q"); g("remote", "add", "o", "https://github.com/microsoft/vscode");
    g("fetch", "-q", "--depth", "1", "--filter=blob:none", "o", pin!.commit);
    text = g("show", `${pin!.commit}:${pin!.licenseFile}`);
  } catch { t.skip("network unavailable"); return; }
  assert.equal(classifyLicense(text), "MIT");
  assert.equal(createHash("sha256").update(text.trim()).digest("hex"), pin!.licenseSha256);
});
