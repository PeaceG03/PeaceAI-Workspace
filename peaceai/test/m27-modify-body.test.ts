// M27: family `modify-body` (REPLACE_EXPRESSION, ADD_GUARD_BEFORE). Strict limits; refusals fail closed.
import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
const root = resolve(import.meta.dirname, "..", "..");
import { applyReplaceRule, assertionFailuresOnly, BODY_VOCAB, REPLACE_TRIGGER, tokens } from "../lib/learned-body.ts";

const P = { calls: BODY_VOCAB.calls[0], grading: "self-fail-before-pass-after", match: "unique-site", names: BODY_VOCAB.names[0], paths: BODY_VOCAB.paths[0], sites: [...BODY_VOCAB.sites], test: "new-file" };
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

test("M27 (after Auditor #136 fixes): evidence is below the bar, so no spec is written; validator still strict", async () => {
  const { existsSync } = await import("node:fs");
  const { validateSpec } = await import("../lib/learned.ts");
  const { protectedReason } = await import("../lib/selfchange.ts");
  const { MIN_BODY_FITS, proposeRules } = await import("../lib/propose.ts");
  assert.equal(existsSync(join(root, "peaceai/rules/learned/public-replace-expression-v1.json")), false);
  // The mined evidence as of 8260281 + fixes: 27 replacements, 5 fit the vocabulary outside scanner-chain code.
  const stats = [{ shape: "EXPR_REPLACE" as const, covered: null, hunks: 27, commits: 20, files: 15, examples: [], styles: { names: { "old-names-params-and-enclosing-locals": 19, other: 8 }, site: { "if-condition": 12, "return-expression": 15 }, vocabulary: { pure: 5, other: 22 } } }];
  const r = proposeRules(stats, "public", ["PeaceG03/PeaceAI-Workspace", "PeaceG03/PeaceSTOCKS"]);
  assert.equal(r.proposals.length, 0);
  assert.deepEqual(r.skipped, [{ shape: "EXPR_REPLACE", why: "no-learnable-params" }]);
  const ok = proposeRules([{ ...stats[0]!, styles: { ...stats[0]!.styles, vocabulary: { pure: MIN_BODY_FITS, other: 17 } } }], "public", ["PeaceG03/PeaceAI-Workspace"]);
  const spec = ok.proposals[0]!.spec;
  assert.ok(validateSpec(spec));
  assert.ok(!validateSpec({ ...spec, params: { ...spec.params, names: "any" } }));
  assert.ok(!validateSpec({ ...spec, params: { ...spec.params, paths: "any" } }));
  assert.ok(!validateSpec({ ...spec, params: { ...spec.params, sites: ["if-condition", "assignment"] } }));
  assert.ok(!validateSpec({ ...spec, minedFrom: "core" }));
  for (const f of ["peaceai/lib/learned-body.ts", "peaceai/lib/minebody.ts"]) assert.ok(protectedReason(f), f);
});

// Auditor (#136) fixes 1-6.
const R2 = (src: string, line: string, bullets = ["- g(1) is 1"], path = "src/g.ts") => applyReplaceRule(REPLACE_TRIGGER, P, [line, ...bullets].join("\n"), [{ path, content: src }]);
test("Auditor #136 (1): a const in an earlier, closed block is not in scope", () => {
  const src = "export function g(x: number): number {\n  if (x) { const process = 1; }\n  if (x < 0) return 0;\n  return x;\n}\n";
  assert.equal(R2(src, "in g in src/g.ts: replace condition x < 0 with process.env.SECRET === undefined"), null);
  const ok = "export function g(x: number): number {\n  const lim = 2;\n  if (x) {\n    const k = 1;\n    if (x < 0) return k;\n  }\n  return x;\n}\n";
  assert.ok(R2(ok, "in g in src/g.ts: replace condition x < 0 with x < lim - k"), "enclosing-block locals still count");
});
test("Auditor #136 (2): needs an is/equals bullet; the before-run must fail by assertions only", () => {
  assert.equal(R("in mode in src/mode.ts: replace condition failures < limit with failures <= limit", ["- mode(3, 3) throws X"]), null, "throws bullet alone refused");
  assert.equal(assertionFailuresOnly("not ok 1 - t\n  ---\n  failureType: 'testCodeFailure'\n  error: |-\n  code: 'ERR_ASSERTION'\n  ...\n"), true);
  assert.equal(assertionFailuresOnly("not ok 1 - /x/a.test.ts\n  failureType: 'testCodeFailure'\n  error: 'test failed'\n  code: 'ERR_TEST_FAILURE'\n"), false, "load error");
  assert.equal(assertionFailuresOnly("not ok 1 - t\n  error: 'Cannot read properties of null'\n  code: 'ERR_TEST_FAILURE'\nnot ok 2 - u\n  code: 'ERR_ASSERTION'\n"), false, "a crash in any failing test");
  assert.equal(assertionFailuresOnly("ok 1 - t\n"), false, "no failure");
  const tc = readFileSync(join(root, "peaceai/bin/test-candidates.ts"), "utf8");
  assert.match(tc, /if \(!run\.ok && !assertionFailuresOnly\(run\.out\)\) return ungradable\("before-not-assertion"\);/);
  assert.match(tc, /candidate\.transformations\.includes\("LEARNED_REPLACE_EXPRESSION"\)\);/);
});
test("Auditor #136 (2) behavior: the before-run fails by assertion on the real edited module", () => {
  const dir = mkdtempSync(join(tmpdir(), "m27-"));
  try {
    const e = R("in mode in src/mode.ts: replace condition failures < limit with failures <= limit")!;
    mkdirSync(join(dir, "src"));
    writeFileSync(join(dir, "package.json"), JSON.stringify({ type: "module" }));
    writeFileSync(join(dir, e.extra[0]!.path), e.extra[0]!.content);
    const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("NODE_TEST")));
    const run = () => { const r = spawnSync(join(root, "node_modules/.bin/tsx"), ["--test", e.extra[0]!.path], { cwd: dir, encoding: "utf8", env }); return { ok: r.status === 0, out: `${r.stdout}\n${r.stderr}` }; };
    writeFileSync(join(dir, "src/mode.ts"), e.content);
    assert.equal(run().ok, true, "passes with the edit");
    writeFileSync(join(dir, "src/mode.ts"), SRC);
    const before = run();
    assert.equal(before.ok, false, "fails without");
    assert.equal(assertionFailuresOnly(before.out), true, "by assertion");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
test("Auditor #136 (3): refused on a protected path and on PeaceSTOCKS scanner-chain files", () => {
  const src = "export function g(x: number): number {\n  if (x < 0) return 0;\n  return x;\n}\n";
  for (const path of ["peaceai/lib/gate.ts", "peaceai/lib/learned-body.ts", "src/scanner.ts", "src/tenmin-redispatch.ts", "src/scan-backstop.ts", "src/daily-picks.ts"]) assert.equal(R2(src, `in g in ${path}: replace condition x < 0 with x <= 0`, ["- g(1) is 1"], path), null, path);
  assert.ok(R2(src, "in g in src/g.ts: replace condition x < 0 with x <= 0"));
});
test("Auditor #136 (4): prototype, optional chaining, escapes, break-outs, in/delete/void/await, templates, ++", () => {
  const src = "export function g(x: number, o: { a: number }): number {\n  if (x < o.a) return 0;\n  return x;\n}\n";
  for (const nu of ["o.prototype", "o?.a", "\\u0078 < 1", "x) || (o", "x < 1), (o", "(x, o)", "\"a\" in o", "delete o.a", "void x", "await x", "String.raw`x`", "`${x}` === \"1\"", "x++ < 1", "--x < 1", "o.a = 1"])
    assert.equal(R2(src, `in g in src/g.ts: replace condition x < o.a with ${nu}`), null, nu);
  assert.ok(R2(src, "in g in src/g.ts: replace condition x < o.a with x <= o.a"));
});
test("Auditor #136 (5): token comparison, not whitespace/quote collapsing", () => {
  assert.deepEqual(tokens("a  <\tb"), tokens("a < b"));
  assert.notDeepEqual(tokens('x === "a b"'), tokens('x === "a  b"'), "string contents kept");
  assert.notDeepEqual(tokens("x === 'a'"), tokens('x === "a"'), "quotes kept");
  const src = 'export function g(s: string): number {\n  if (s === "a  b") return 1;\n  return 0;\n}\n';
  assert.equal(R2(src, 'in g in src/g.ts: replace condition s === "a b" with s === "c"', ['- g("c") is 1']), null, "collapsed whitespace no longer matches");
  assert.ok(R2(src, 'in g in src/g.ts: replace condition s === "a  b" with s === "c"', ['- g("c") is 1']), "exact tokens match");
});
test("Auditor #136 (6): an old callee may be called with new arguments (documented in spec params and proposal)", () => {
  const src = 'export function g(s: string[]): boolean {\n  if (s.includes("a")) return true;\n  return false;\n}\n';
  assert.ok(R2(src, 'in g in src/g.ts: replace condition s.includes("a") with s.includes("b")', ['- g(["b"]) is true']));
  assert.equal(BODY_VOCAB.calls[0], "pure-builtins-and-old-callees-any-args");
  assert.match(readFileSync(join(root, "peaceai/lib/propose.ts"), "utf8"), /may call with NEW arguments/);
});
