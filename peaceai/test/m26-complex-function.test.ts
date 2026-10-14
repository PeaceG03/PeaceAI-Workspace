import { test } from "node:test";
import assert from "node:assert/strict";
import { applyComplexRule, COMPLEX_TRIGGER } from "../lib/learned-complex.ts";
const P = { body: "bounded-block", grading: "self-fail-before-pass-after-and-stub", loops: ["for-of-param", "counted-literal-or-length"], params: "typed", placement: "end-of-module", returns: "annotated", test: "new-file" };
const files = [{ path: "src/a.ts", content: "export const x = 1;\n" }];
const t = (body: string) => `add complex function monthsSpan(from: string, to: string): string[] to src/a.ts with body:\n${body}\n- monthsSpan("2026-09", "2026-11") equals ["2026-09", "2026-10", "2026-11"]`;
const ok = `const out: string[] = [];\nlet y = Number(from.slice(0, 4));\nlet m = Number(from.slice(5, 7));\nfor (let i = 0; i < 48; i++) {\nconst key = String(y) + "-" + String(m).padStart(2, "0");\nif (to.slice(0, 7) < key) break;\nout.push(key);\nm += 1;\nif (m === 13) { m = 1; y += 1; }\n}\nreturn out;`;
test("builds a bounded planner function", () => {
  const e = applyComplexRule(COMPLEX_TRIGGER, P, t(ok), files);
  assert.ok(e && e.content.includes("export function monthsSpan(from: string, to: string): string[]"));
});
for (const bad of ["while (true) {}\nreturn [];", "for (let i = 0; i < 1e9; i++) {}\nreturn [];", "const out: string[] = [];\nfor (const v of out) { out.push(v); }\nreturn out;", "return globalThis.x;", "const f = () => 1;\nreturn [];", "for (let j = 0; j < 3; j++) { j = 0; }\nreturn [];", "return [];"]) {
  test(`refuses ${JSON.stringify(bad.slice(0, 40))}`, () => assert.equal(applyComplexRule(COMPLEX_TRIGGER, P, t(bad), files), null));
}

import ts from "typescript";
import { blockRefusal, calledFunctions, stubForGrading } from "../lib/learned-complex.ts";
const why = (src: string, fn = "main") => {
  const sf = ts.createSourceFile("m.ts", src, ts.ScriptTarget.Latest, true);
  const f = sf.statements.find((s): s is ts.FunctionDeclaration => ts.isFunctionDeclaration(s) && s.name?.text === fn)!;
  return blockRefusal(f.body!, new Set(f.parameters.map((p) => p.name.getText(sf))), sf);
};
const H = "export function inc(n: number): number { return n + 1; }\n";
test("option A: calls to vetted exported same-file functions", () => {
  assert.equal(why(H + "export function main(a: number): number {\n  const b = inc(a);\n  return inc(b);\n}\n"), null);
  const sf = ts.createSourceFile("m.ts", H + "export function main(a: number): number {\n  const b = inc(inc(a));\n  return b;\n}\n", ts.ScriptTarget.Latest, true);
  const f = sf.statements[1] as ts.FunctionDeclaration;
  assert.deepEqual(calledFunctions(f.body!, new Set(["a"]), sf), ["inc"]);
});
test("option A refusals: recursion, mutual recursion, depth over 2, non-exported, alias, namespace, method call", () => {
  assert.match(why("export function main(a: number): number {\n  const b = main(a);\n  return b;\n}\n") ?? "", /recursive/);
  assert.match(why("export function f(a: number): number {\n  const x = main(a);\n  return x;\n}\nexport function main(a: number): number {\n  const b = f(a);\n  return b;\n}\n") ?? "", /recursive/);
  assert.match(why("export function g(n: number): number { return n; }\nexport function f(n: number): number {\n  const x = g(n);\n  return x;\n}\nexport function h(n: number): number {\n  const y = f(n);\n  return y;\n}\nexport function main(a: number): number {\n  const b = h(a);\n  return b;\n}\n") ?? "", /depth/);
  assert.match(why("function inc(n: number): number { return n + 1; }\nexport function main(a: number): number {\n  const b = inc(a);\n  return b;\n}\n") ?? "", /not an exported/);
  assert.ok(why(H + "export function main(a: number): number {\n  const g = inc;\n  return g(a);\n}\n"), "alias");
  assert.ok(why('import * as m from "./m";\nexport function main(a: number): number {\n  const b = m.inc(a);\n  return b;\n}\n'), "namespace");
  assert.ok(why("export function main(a: string[]): number {\n  const b = a.map(String);\n  return b.length;\n}\n"), "method call outside vocab");
  assert.match(why("export function bad(n: number): number { while (n) {} return n; }\nexport function main(a: number): number {\n  const b = bad(a);\n  return b;\n}\n") ?? "", /bad:/);
});
test("option A throws: only a one-line `if (COND) throw new Error(\"literal\")`", () => {
  assert.equal(why('export function main(a: number): number {\n  if (a < 0) throw new Error("NEG");\n  return a;\n}\n'), null);
  for (const b of ['throw new Error("X");\n  return a;', 'if (a < 0) throw new Error(String(a));\n  return a;', 'if (a < 0) throw new TypeError("X");\n  return a;', 'if (a < 0) {\n    throw new Error("X");\n  }\n  return a;', 'if (a < 0) throw new Error("X"); else return 1;\n  return a;']) assert.ok(why(`export function main(a: number): number {\n  ${b}\n}\n`), b);
});
test("option A grading: stubs the function and every called helper the candidate added", () => {
  const src = H + "export function main(a: number): number {\n  const b = inc(a);\n  return b;\n}\n";
  const s = stubForGrading(src, "main", ["inc", "main"])!;
  assert.match(s, /function inc\(n: number\): number \{ return 0; \}/);
  assert.match(s, /function main\(a: number\): number \{ return 0; \}/);
  assert.match(stubForGrading(src, "main", ["main"])!, /return n \+ 1/, "pre-existing helper untouched");
});
