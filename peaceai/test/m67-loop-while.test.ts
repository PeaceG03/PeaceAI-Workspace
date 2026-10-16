// M67 LOOP_WHILE (public-loop-function-v2, un-drop batch): the COMPLEX_FUNCTION engine with loops
// ["counted-literal-or-length", "for-of-param", "while-literal-counter"]. A while runs ONLY as
// `while (C < LIT | C <= LIT)` with C an own let starting at an integer literal and exactly one top-level `C += 1`.
// Every other while is loop_unbounded (including the two real public while examples, which use PARAM.length / a
// decrement: they are refusal fixtures here, not positives). v1 keeps refusing while as loop_while_unsupported.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { LOOP_UNBOUNDED, LOOP_WHILE_UNSUPPORTED, LOOP_ASYNC, LOOP_LABEL, CLOSURE_NOT_ALLOWED, WHILE_TRIGGER } from "../lib/learned-complex.ts";
import { applyRule, validateSpec, type RuleSpec } from "../lib/learned.ts";

const root = resolve(import.meta.dirname, "../..");
const read = (p: string) => readFileSync(resolve(root, p), "utf8");
const V2 = JSON.parse(read("peaceai/rules/learned/public-loop-function-v2.json")) as RuleSpec;
const V1 = JSON.parse(read("peaceai/rules/learned/public-loop-function-v1.json")) as RuleSpec;
const files = [{ path: "src/a.ts", content: "export const x = 1;\n" }];
const SIG = "f(n: number, xs: number[], s: string): number";
const task = (body: string, head = "add while loop function") => `${head} ${SIG} to src/a.ts with body:\n${body}\n- f(3, [1, 2], "ab") is 1`;
const run = (body: string, spec: RuleSpec = V2, head?: string) => {
  const w: { reason?: string } = {};
  const e = applyRule(spec, task(body, head ?? (spec === V1 ? "add loop function" : "add while loop function")), files, undefined, undefined, w, () => false);
  return { e, r: w.reason };
};

test("spec: valid, own trigger, while-literal-counter only (no while-bounded)", () => {
  assert.ok(validateSpec(V2));
  assert.equal(V2.trigger, WHILE_TRIGGER);
  assert.deepEqual(V2.params.loops, ["counted-literal-or-length", "for-of-param", "while-literal-counter"]);
  assert.ok(!read("peaceai/rules/approved.json").includes("public-loop-function-v2"), "not approved: Peace /approve-rule only");
});

// Real example (PeaceSTOCKS@3459cef, store-path assertNoReparseAncestors): `let depth = 0; while (depth < 512) { ...; depth += 1; }`.
const REAL_STORE_PATH = "let depth = 0;\nlet t = 0;\nwhile (depth < 512) {\nif (n < depth) break;\nt += 1;\ndepth += 1;\n}\nreturn t;";
const ok: Record<string, string> = {
  "store-path shape (PeaceSTOCKS@3459cef)": REAL_STORE_PATH,
  "C <= LIT": "let c = 1;\nlet t = 0;\nwhile (c <= 10) {\nt += xs.length;\nc += 1;\n}\nreturn t + n;",
  "early return inside": "let c = 0;\nwhile (c < 100) {\nif (c === n) return c;\nc += 1;\n}\nreturn -1;",
};
for (const [name, body] of Object.entries(ok)) test(`builds: ${name}`, () => { const { e, r } = run(body); assert.ok(e, `${name}: ${r}`); });

// Refusals: every while outside the literal-counter shape is loop_unbounded.
const bad: [string, string, string][] = [
  ["vscode computeIndentLevel shape (PARAM.length bound)", "let i = 0;\nlet t = 0;\nwhile (i < s.length) {\nt += 1;\ni += 1;\n}\nreturn t;", LOOP_UNBOUNDED],
  ["pnpm findEndWithoutTrailingPlusesAndDots shape (down, PARAM.length start)", "let end = s.length;\nwhile (end > 0) {\nif (s[end - 1] !== \".\") break;\nend--;\n}\nreturn end;", LOOP_UNBOUNDED],
  ["while(true)", "let c = 0;\nwhile (true) {\nc += 1;\nif (n < c) return c;\n}\nreturn c;", LOOP_UNBOUNDED],
  ["bound is a parameter", "let c = 0;\nwhile (c < n) {\nc += 1;\n}\nreturn c;", LOOP_UNBOUNDED],
  ["start is a parameter", "let c = n;\nwhile (c < 10) {\nc += 1;\n}\nreturn c;", LOOP_UNBOUNDED],
  ["step += 2", "let c = 0;\nwhile (c < 10) {\nc += 2;\n}\nreturn c + n;", LOOP_UNBOUNDED],
  ["step ++", "let c = 0;\nwhile (c < 10) {\nc++;\n}\nreturn c + n;", LOOP_UNBOUNDED],
  ["two steps", "let c = 0;\nwhile (c < 10) {\nc += 1;\nc += 1;\n}\nreturn c + n;", LOOP_UNBOUNDED],
  ["continue skips the step", "let c = 0;\nwhile (c < 10) {\nif (c === n) continue;\nc += 1;\n}\nreturn c;", LOOP_UNBOUNDED],
  ["bound over 1000", "let c = 0;\nwhile (c < 5000) {\nc += 1;\n}\nreturn c + n;", LOOP_UNBOUNDED],
  ["down-counting", "let c = 10;\nwhile (c > 0) {\nc -= 1;\n}\nreturn c + n;", LOOP_UNBOUNDED],
  ["label", "let c = 0;\nouter: while (c < 10) {\nc += 1;\n}\nreturn c + n;", LOOP_LABEL],
  ["closure", "let c = 0;\nwhile (c < 10) {\nconst g = () => c;\nc += 1;\n}\nreturn c + n;", CLOSURE_NOT_ALLOWED],
];
for (const [name, body, code] of bad) test(`refused (${code}): ${name}`, () => { const { e, r } = run(body); assert.equal(e, null, name); assert.equal(r, code, name); });

test("v1 still refuses every while (loop_while_unsupported); v1's phrase does not reach v2", () => {
  assert.equal(run(REAL_STORE_PATH, V1).r, LOOP_WHILE_UNSUPPORTED);
  assert.equal(run(REAL_STORE_PATH, V2, "add loop function").e, null);
});
