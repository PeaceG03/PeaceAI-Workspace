// M20: object-literal arguments in learned test checks (ADD_TEST_CASE specs with `args: object-literal`).
// The plain test specs stay unchanged and still cap a check at 200 characters; the separate objargs specs
// (public-mined: test cases whose calls take object literals) accept checks up to 600 characters when every
// object is plain bounded data. Same template, same fail-before/pass-after grading.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import test from "node:test";
import ts from "typescript";
import { applyRule, validateSpec, type RuleSpec } from "../lib/learned.ts";
import { MAX_OBJECT_EXPR_CHARS, objectArgsReason, TEST_TRIGGER } from "../lib/learned-test.ts";
import { proposeRules } from "../lib/propose.ts";
import { tally, type Observation } from "../lib/mine.ts";

const repo = resolve(import.meta.dirname, "..", "..");
const load = (id: string) => JSON.parse(readFileSync(join(repo, "peaceai/rules/learned", `${id}.json`), "utf8")) as RuleSpec;
const V1 = load("public-test-case-v1");
const OBJ = load("public-test-case-objargs-v1");
const APP = load("public-test-case-append-objargs-v1");
const LIB = "export interface In { cursor: string; plan: { windowStart: string; ratePerMin: number }; gaps: string[]; lastOutcome: string; n: number }\nexport function decide(i: In): { mode: string } {\n  return { mode: i.lastOutcome === \"refused\" ? \"ALERT\" : i.n > 3 ? \"STOP\" : \"RUN\" };\n}\n";
const files = [{ path: "src/mode.ts", content: LIB }, { path: "src/mode.test.ts", content: 'import assert from "node:assert/strict";\nimport test from "node:test";\nimport { decide } from "./mode.ts";\n\ntest("x", () => {\n  assert.equal(decide({ cursor: "a", plan: { windowStart: "b", ratePerMin: 1 }, gaps: [], lastOutcome: "ok", n: 0 }).mode, "RUN");\n});\n' }];
const ARG = '{ cursor: "2026-10-14", plan: { windowStart: "2021-10-12", ratePerMin: 5 }, gaps: ["2026-10-01", "2026-10-02"], lastOutcome: "refused", n: 0, extraPaddingFieldName: "aaaaaaaaaaaaaaaaaaaa" }';
const task = (arg: string, value = '"ALERT"') => `add a test for \`decide\` in \`src/mode.ts\`: refusals alert\n- \`decide(${arg}).mode\` is ${value}\nFix: ${"a".repeat(40)}`;
const isTest = (p: string) => /\.test\.ts$/.test(p);

test("specs: both objargs specs validate, public-mined, same params as plain + args; plain v1 unchanged and still valid", () => {
  for (const s of [OBJ, APP]) {
    assert.ok(validateSpec(s), s.id);
    assert.equal(s.minedFrom, "public");
    assert.equal(s.trigger, TEST_TRIGGER);
    assert.equal(s.params.args, "object-literal");
  }
  const { args: _a, ...rest } = OBJ.params;
  assert.deepEqual(rest, V1.params);
  assert.equal(APP.params.placement, "append");
  assert.ok(validateSpec(V1));
  assert.ok(!validateSpec({ ...OBJ, params: { ...OBJ.params, args: "any" } }), "args has one value only");
  assert.ok(!validateSpec({ ...OBJ, minedFrom: "core", id: "core-test-case-objargs-v1" }));
});

test("the #87 v1 shape: a check over 200 chars with object-literal args -> plain spec refuses, objargs spec builds", () => {
  assert.ok(`decide(${ARG}).mode`.length > 200);
  assert.equal(applyRule(V1, task(ARG), files, isTest), null);
  const e = applyRule(OBJ, task(ARG), files, isTest)!;
  assert.ok(e && e.create);
  assert.ok(e.content.includes(`assert.equal(decide(${ARG}).mode, "ALERT");`));
  const a = applyRule(APP, task(ARG), files, isTest)!;
  assert.ok(a && a.content.startsWith(files[1]!.content), "append spec appends only");
});

test("objargs spec: only for tasks that pass an object literal (plain tasks stay with the plain spec)", () => {
  const plain = `add a test for \`decide\` in \`src/mode.ts\`: x\n- \`decide.length\` is 1\nFix: ${"a".repeat(40)}`;
  assert.equal(applyRule(OBJ, plain, files, isTest), null);
});

test("objargs refusals: spread, shorthand, methods, getters, computed keys, __proto__/constructor/prototype, repeats, depth, key count, length, non-literal values", () => {
  const bad = [
    '{ ...x, n: 1 }', '{ n }', '{ f() { return 1 } }', '{ get g() { return 1 } }', '{ ["k"]: 1 }',
    '{ __proto__: { n: 1 } }', '{ constructor: 1 }', '{ "prototype": 1 }', '{ n: 1, n: 2 }',
    '{ a: { b: { c: { d: 1 } } } }', `{ ${Array.from({ length: 17 }, (_, i) => `k${i}: 1`).join(", ")} }`,
    `{ s: "${"x".repeat(MAX_OBJECT_EXPR_CHARS)}" }`, '{ n: process.env.X }', '{ n: (() => 1)() }', '{ n: `t${1}` }',
  ];
  for (const b of bad) assert.equal(applyRule(OBJ, task(b), files, isTest), null, b);
  assert.equal(objectArgsReason(ts.factory.createObjectLiteralExpression([])), null);
  assert.notEqual(applyRule(OBJ, task('{ a: { b: { c: 1 } }, "x-y": [1, { z: null }] }', '"RUN"'), files, isTest), null, "depth 3, string keys, arrays ok");
});

test("propose: objargs specs only with enough public evidence of object-literal call arguments; ids are separate", () => {
  const obs = (n: number, yes: number): Observation[] => Array.from({ length: n }, (_, i) => ({ shape: "TEST_CASE", commit: `r@${i}`, path: `src/f${i}.test.ts`, line: 1, style: { framework: "node:test-default", assert: "node:assert/strict-default", lines: "<=12", matcher: "regex", "check:equal": "yes", "check:deepEqual": "no", "check:throws": "yes", "check:rejects": "no", objectArgs: i < yes ? "yes" : "no" } }));
  const ids = (yes: number) => proposeRules(tally(obs(10, yes)), "public", ["PeaceG03/PeaceSTOCKS"]).proposals.map((p) => p.spec.id);
  assert.deepEqual(ids(5), ["public-test-case-v1", "public-test-case-objargs-v1"]);
  assert.deepEqual(ids(1), ["public-test-case-v1"]);
  assert.deepEqual(proposeRules(tally(obs(10, 5)), "core", ["x"]).proposals.map((p) => p.spec.id), [], "core never");
});
