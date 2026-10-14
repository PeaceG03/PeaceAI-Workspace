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
