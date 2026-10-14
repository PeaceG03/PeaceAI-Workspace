// M27: family `modify-body` (REPLACE_EXPRESSION, ADD_GUARD_BEFORE). Strict limits; refusals fail closed.
import assert from "node:assert/strict";
import test from "node:test";
import { applyReplaceRule, BODY_VOCAB, REPLACE_TRIGGER } from "../lib/learned-body.ts";

const P = { grading: "self-fail-before-pass-after", match: "unique-site", names: "old-names-params-and-prior-locals", sites: [...BODY_VOCAB.sites], test: "new-file" };
const SRC = [
  "export function mode(failures: number, limit: number): string {",
  "  const over = failures - limit;",
  "  if (failures < limit) return \"DAILY\";",
  "  const tag = over + 1;",
  "  return \"ALERT\";",
  "}",
  "export function other(x: number): number { if (x < 1) return 0; return x; }",
  "",
].join("\n");
const files = [{ path: "src/mode.ts", content: SRC }];
const R = (line: string, bullets = ['- mode(3, 3) is "DAILY"']) => applyReplaceRule(REPLACE_TRIGGER, P, [line, ...bullets].join("\n"), files);

test("REPLACE_EXPRESSION: one if-condition or one return expression, test file added, selfGrade", () => {
  const e = R("in mode in src/mode.ts: replace condition failures < limit with failures <= limit")!;
  assert.ok(e.content.includes("if (failures <= limit) return \"DAILY\";"));
  assert.equal(e.content.split("\n").length, SRC.split("\n").length);
  assert.equal(e.selfGrade, true);
  assert.equal(e.extra.length, 1);
  assert.match(e.extra[0]!.path, /\.test\.ts$/);
  const r = R('in mode in src/mode.ts: replace return "ALERT" with failures < 0 ? "NONE" : "ALERT"', ['- mode(9, 3) is "ALERT"'])!;
  assert.ok(r.content.includes('return failures < 0 ? "NONE" : "ALERT";'));
});

test("REPLACE_EXPRESSION refusals", () => {
  for (const line of [
    "in mode in src/mode.ts: replace condition failures < limit with failures < limit", // unchanged
    "in mode in src/mode.ts: replace condition failures < limit with process.exit(1)", // global / call
    "in mode in src/mode.ts: replace condition failures < limit with failures < tag", // local declared after the site
    "in mode in src/mode.ts: replace condition failures < limit with true", // constant
    "in mode in src/mode.ts: replace condition x < 1 with x <= 1", // site is in another function
    "in mode in src/mode.ts: replace condition failures < 99 with failures < 1", // no such site
    "in mode in src/mode.ts: replace condition failures < limit with (limit = 1)", // assignment
    "in mode in src/mode.ts: replace condition failures < limit with failures.constructor", // prototype
    "in nope in src/mode.ts: replace condition failures < limit with failures <= limit", // no function
    "in mode in src/missing.ts: replace condition failures < limit with failures <= limit",
  ]) assert.equal(R(line), null, line);
  assert.equal(R("in mode in src/mode.ts: replace condition failures < limit with failures <= limit", []), null, "needs a test bullet");
});

test("REPLACE_EXPRESSION: prior locals and old callees allowed; new callees refused", () => {
  assert.ok(R("in mode in src/mode.ts: replace condition failures < limit with failures < limit && over < 2"), "prior const local");
  const src = "export function f(s: string[]): boolean {\n  if (s.includes(\"a\")) return true;\n  return false;\n}\n";
  const fl = [{ path: "src/f.ts", content: src }];
  const T = (l: string) => applyReplaceRule(REPLACE_TRIGGER, P, `${l}\n- f(["b"]) is true`, fl);
  assert.ok(T('in f in src/f.ts: replace condition s.includes("a") with s.includes("a") || s.includes("b")'), "same callee");
  assert.equal(T('in f in src/f.ts: replace condition s.includes("a") with s.some(Boolean)'), null, "new method");
  assert.equal(T('in f in src/f.ts: replace condition s.includes("a") with s.includes(eval("1"))'), null, "global call in args");
  assert.equal(T('in f in src/f.ts: replace condition s.includes("a") with s[0] === "b"'), null, "element access");
});

test("M27 spec: public-mined, fixed vocabulary, valid, protected engine and miner", async () => {
  const { readFileSync } = await import("node:fs");
  const { join, resolve } = await import("node:path");
  const { validateSpec } = await import("../lib/learned.ts");
  const { protectedReason } = await import("../lib/selfchange.ts");
  const root = resolve(import.meta.dirname, "..", "..");
  const spec = JSON.parse(readFileSync(join(root, "peaceai/rules/learned/public-replace-expression-v1.json"), "utf8"));
  assert.ok(validateSpec(spec));
  assert.equal(spec.minedFrom, "public");
  assert.ok(spec.evidence.commits >= 10);
  assert.ok(!validateSpec({ ...spec, params: { ...spec.params, names: "any" } }));
  assert.ok(!validateSpec({ ...spec, params: { ...spec.params, sites: ["if-condition", "assignment"] } }));
  assert.ok(!validateSpec({ ...spec, minedFrom: "core" }));
  for (const f of ["peaceai/lib/learned-body.ts", "peaceai/lib/minebody.ts"]) assert.ok(protectedReason(f), f);
});
