// M34: public-throw-guard-v2 — regex-literal .test(param) and no-arg getTime/trim on params; v1 unchanged.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import test from "node:test";
import ts from "typescript";
import { buildGuardEdit, GUARD_TRIGGER, parseGuardTask, safeCondition } from "../lib/learned-guard.ts";
import { validateSpec } from "../lib/learned.ts";

const root = resolve(import.meta.dirname, "..", "..");
const expr = (t: string) => (ts.createSourceFile("c.ts", `(${t});`, ts.ScriptTarget.Latest, true).statements[0] as ts.ExpressionStatement).expression as ts.ParenthesizedExpression;
const P = new Set(["d", "o", "s"]);
const v2 = (t: string) => safeCondition(expr(t).expression, P, true);
const v1 = (t: string) => safeCondition(expr(t).expression, P);

test("v2 accepts the mined forms", () => {
  for (const t of ['!/^\\d{4}-\\d{2}-\\d{2}$/u.test(s)', "Number.isNaN(d.getTime())", "!s.trim()", "!/^[0-9a-f]{64}$/u.test(o.hex)", "typeof s !== \"string\" || !s.trim()", "Number.isNaN(o.at.getTime()) || !/^x$/i.test(s)"])
    assert.equal(v2(t), true, t);
});

test("v2 refuses other methods, arguments and receivers", () => {
  for (const t of [
    "s.toString()", "s.startsWith(\"x\")", "s.includes(\"x\")", "o.valueOf()", "s.trim(1)", "d.getTime(0)",
    "R.test(s)", "/x/.test(K)", "/x/.test(s, s)", "/x/.test()", "/x/g.test(s)", "/x/y.test(s)", "/(a+)+$/.test(s)", "/(a)\\1/.test(s)", "/(?=a)/.test(s)",
    `/${"a".repeat(80)}/.test(s)`, "K.trim()", "Date.now()", "s?.trim()", "o?.d.getTime()", "f().trim()", "this.s.trim()", "(s + \"\").trim()", "s[\"trim\"]()",
    "/x/.test(s.trim())", "constructor.trim()",
  ]) assert.equal(v2(t), false, t);
});

test("v1 (no calls key) keeps the v1 grammar exactly", () => {
  for (const t of ['!/^x$/u.test(s)', "Number.isNaN(d.getTime())", "!s.trim()"]) assert.equal(v1(t), false, t);
  assert.equal(v1("!Number.isInteger(s) || s < 1"), true);
});

test("buildGuardEdit: v2 builds regex and no-arg-method guards; v1 and an unknown calls value refuse", () => {
  const base = JSON.parse(readFileSync(join(root, "peaceai/rules/learned/public-throw-guard-v1.json"), "utf8")).params;
  const V2 = { ...base, calls: "regex-test+noarg-methods" };
  const files = [{ path: "src/lib.ts", content: "export function month(s: string, n: number): string {\n  return s.slice(0, n);\n}\n" }];
  const T = (cond: string, bad: string) => parseGuardTask(GUARD_TRIGGER, `guard \x60month\x60 in \x60src/lib.ts\x60: throw BAD_MONTH when ${cond}\n- \x60month(${bad}, 2)\x60 throws BAD_MONTH\n- \x60month("2026-10", 4)\x60 is "2026"`)!;
  const re = T("!/^\\d{4}-\\d{2}$/u.test(s)", '"2026/10"'), tr = T("!s.trim()", '"  "');
  for (const [task, line] of [[re, 'if (!/^\\d{4}-\\d{2}$/u.test(s)) throw new Error("BAD_MONTH");'], [tr, 'if (!s.trim()) throw new Error("BAD_MONTH");']] as const) {
    assert.ok(task);
    const e = buildGuardEdit(V2, task, files);
    assert.ok(e && e.content.includes(line), line);
    assert.equal(buildGuardEdit(base, task, files), null, "v1 refuses");
    assert.equal(buildGuardEdit({ ...base, calls: "anything" }, task, files), null, "unknown calls value");
  }
  assert.equal(buildGuardEdit(V2, T("!s.startsWith(\"2\")", '"x"'), files), null, "other method");
});

test("the v2 spec validates; a bad calls value does not; it is not approved by this PR", () => {
  const s = JSON.parse(readFileSync(join(root, "peaceai/rules/learned/public-throw-guard-v2.json"), "utf8"));
  assert.equal(validateSpec(s), true);
  assert.equal(validateSpec({ ...s, params: { ...s.params, calls: "eval" } }), false);
  assert.equal(validateSpec({ ...s, params: { ...s.params, extra: "x" } }), false);
  assert.ok(!readFileSync(join(root, "peaceai/rules/approved.json"), "utf8").includes("public-throw-guard-v2"));
});
