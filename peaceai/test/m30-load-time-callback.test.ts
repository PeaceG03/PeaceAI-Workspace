// M30 (Auditor, #127): a narrow #129 relaxation. A function/arrow expression is not an escaping callable only when it
// runs while the module loads, over data, and computes a pure value. Everything else still fails closed.
import assert from "node:assert/strict";
import test from "node:test";
import { hasNonDeclarationCallables } from "../lib/learned-function.ts";

const FN = "export function decideTenMinMode(i: number): number {\n  return BACKOFF_MS[i]!;\n}\n";
const has = (line: string, rest = FN) => hasNonDeclarationCallables(`${line}\n${rest}`);

test("M30 positive: the exact BACKOFF_MS line from PeaceSTOCKS b6dbd91 is allowed", () => {
  assert.equal(has("const BACKOFF_MS = [5, 15, 45, 120].map((m) => m * 60_000);"), false);
  assert.equal(has("const R = [1, 2];\nconst BACKOFF_MS = R.filter(function (x) { return x > 1; });"), false, "const receiver, function expression with simple return");
  assert.equal(has("const BACKOFF_MS = [1.5, 2].map((x) => Math.round(x));"), false, "Math members");
});

test("M30 refusals named by Auditor", () => {
  for (const [line, why] of [
    ["const BACKOFF_MS = [() => 1].map((f) => f);", "receiver holds a function"],
    ["const BACKOFF_MS = [1].map((m) => decideTenMinMode);", "references a module binding (the stub target)"],
    ["let g = 0;\nconst BACKOFF_MS = [1].map((m) => (g = m));", "assignment"],
    ["const BACKOFF_MS = [1].map((m) => class { });", "class expression"],
    ["const K = class { };\nconst BACKOFF_MS = [1];", "class expression as a const"],
  ] as const) assert.equal(has(line), true, why);
});

test("M30 refusals: every other condition fails closed", () => {
  for (const [line, why] of [
    ["const BACKOFF_MS = [1].map((m) => m++);", "update operator"],
    ["const BACKOFF_MS = [1].map((m) => () => m);", "nested function / returns a function"],
    ["const BACKOFF_MS = [1].map(function (m) { return this; });", "this"],
    ["const BACKOFF_MS = [1].map(function (m) { return arguments; });", "arguments"],
    ["const BACKOFF_MS = [1].map((m) => { const k = m; return k; });", "not simple returns"],
    ["const BACKOFF_MS = [1].map((m = 2) => m);", "default param"],
    ["const BACKOFF_MS = [1].map(({ a }) => a);", "destructured param"],
    ["const BACKOFF_MS = [1].forEach((m) => m);", "method outside the list"],
    ["const BACKOFF_MS = [1].map((m) => m).map((m) => m);", "receiver is not a literal"],
    ["const BACKOFF_MS = [decideTenMinMode].map((m) => m);", "receiver holds a binding"],
    ["let BACKOFF_MS = [1].map((m) => m);", "not const"],
    ["if (1) { const x = [1].map((m) => m); }", "not a top-level const"],
    ["const BACKOFF_MS = [1].map((m) => m.constructor);", "forbidden member"],
    ["const BACKOFF_MS = [1].map((m) => Math.random());", "Math member outside the list"],
    ["const BACKOFF_MS = [1].map((m) => globalThis.x);", "global"],
    ["const BACKOFF_MS = [1].map((m) => m);\nBACKOFF_MS.map(String);", "the const is called (member call)"],
    ["const BACKOFF_MS = [1].map((m) => m);\n(BACKOFF_MS as any)();", "the const is called"],
    ["const BACKOFF_MS = () => 1;", "plain arrow const"],
  ] as const) assert.equal(has(line), true, why);
});

test("Auditor #139 X1: the callback is the first and only argument; reduce's initial value must be data", () => {
  for (const [src, why] of [
    ["const B = [0].reduce((a) => a, (y: number) => (y > 3 ? 'HIGH' : 'LOW'));\nconst g = B;\nexport function old(x: number) { return g(x); }\n", "Auditor's exploit: callable as reduce's initial value, aliased and called"],
    ["const B = [0].some((x) => x > 0, (y: number) => y * 2);\n", "Auditor's exploit: callable thisArg"],
    ["const B = [0].reduce((a, x) => a + x, decideTenMinMode);\n", "initial value is a binding"],
    ["const B = [0].map(String, (m: number) => m);\n", "callback not first"],
    ["const B = [0].map((m) => m, 1);\n", "map takes exactly one argument"],
  ] as const) assert.equal(hasNonDeclarationCallables(src + FN), true, why);
  assert.equal(hasNonDeclarationCallables("const B = [1, 2].reduce((a, x) => a + x, 0);\n" + FN), false, "reduce with a data initial value");
});

test("Auditor #139 X1: the const is only read through property/index access, never aliased, passed or called", () => {
  const L = "const BACKOFF_MS = [5, 15, 45, 120].map((m) => m * 60_000);\n";
  for (const [rest, why] of [
    ["const g = BACKOFF_MS;\n", "aliased"],
    ["export function f(x: number) { return [BACKOFF_MS][0]![x]; }\n", "placed in a literal"],
    ["export function f(x: number) { return ([BACKOFF_MS][0] as any)(x); }\n", "[B][0](x)"],
    ["export function f(x: number) { return (BACKOFF_MS[0] as any)(x); }\n", "an element is called"],
    ["export function f() { return String(BACKOFF_MS); }\n", "passed"],
    ["export function f() { BACKOFF_MS[0] = 1; }\n", "element assigned"],
    ["export function f() { BACKOFF_MS[0]++; }\n", "element updated"],
    ["export { BACKOFF_MS };\n", "re-exported"],
  ] as const) assert.equal(hasNonDeclarationCallables(L + FN + rest), true, why);
  assert.equal(hasNonDeclarationCallables(L + "export function w(i: number): number { return BACKOFF_MS[Math.min(i, BACKOFF_MS.length - 1)]!; }\n"), false, "the b6dbd91 read pattern");
});
