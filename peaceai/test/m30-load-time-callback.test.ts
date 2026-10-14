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
