// M15: the new-pure-function learned edit type (ADD_FUNCTION). The committed spec, the trigger and its task
// parsing, the body vocabulary and its refusals, the appended function + new test, the self-grading contract
// (the new test passes with the function and fails on the task base), the miner shape and the protected set.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { applyRule, specHash, validateSpec, type RuleSpec } from "../lib/learned.ts";
import { FUNCTION_TRIGGER, parseFunctionTask } from "../lib/learned-function.ts";
import { parseTask } from "../lib/nlparse.ts";
import { PROTECTED_SELF } from "../lib/selfchange.ts";
import { cleanIssueText } from "../lib/taskmap.ts";

const repo = resolve(import.meta.dirname, "..", "..");
const tsx = join(repo, "node_modules/.bin/tsx");
const PARAMS = { body: "single-return", grading: "self-fail-before-pass-after", params: "typed", placement: "end-of-module", returns: "annotated", test: "new-file" };
const spec = (over: Partial<RuleSpec> = {}): RuleSpec => ({
  schema: "peaceai-learned-rule:v1", id: "public-add-function-v1", kind: "ADD_FUNCTION", minedFrom: "public", minerVersion: "peaceai-miner:v1", shape: "PURE_FUNCTION",
  trigger: FUNCTION_TRIGGER, params: { ...PARAMS }, evidence: { hunks: 8, commits: 8, files: 7, repos: ["PeaceG03/PeaceAI-Workspace", "PeaceG03/PeaceSTOCKS"] }, ...over,
});
const LIB = "export function scale(value: number, factor: number): number {\n  return value * factor;\n}\n";
const files = (content = LIB) => [{ path: "src/lib.ts", content }];
const TASK = "add function `clampPct(x: number): number` to `src/lib.ts` returning Math.min(100, Math.max(0, x))\n- `clampPct(150)` is 100\n- `clampPct(-3)` is 0\n- `clampPct(42)` is 42";

test("spec: the committed public-add-function-v1 file validates, is public-mined and hashes to its canonical JSON", () => {
  const raw = readFileSync(join(repo, "peaceai/rules/learned/public-add-function-v1.json"), "utf8");
  const s = JSON.parse(raw) as RuleSpec;
  assert.ok(validateSpec(s));
  assert.equal(s.minedFrom, "public");
  assert.deepEqual(s.params, PARAMS);
  assert.equal(s.trigger, FUNCTION_TRIGGER);
  assert.match(specHash(s), /^[0-9a-f]{64}$/);
  assert.ok(!validateSpec({ ...s, minedFrom: "core", id: "core-add-function-v1" }), "core-mined ADD_FUNCTION is refused");
  assert.ok(!validateSpec({ ...s, params: { ...PARAMS, test: "append" } }), "params outside the vocabulary are refused");
  assert.ok(!validateSpec({ ...s, params: { ...PARAMS, extra: "x" } }), "extra params are refused");
});

test("trigger: canonical task parses to ADD_FUNCTION with name, typed params, return type, body and test bullets", () => {
  const t = parseFunctionTask(FUNCTION_TRIGGER, TASK)!;
  assert.equal(t.fn, "clampPct");
  assert.deepEqual(t.params, [{ name: "x", type: "number" }]);
  assert.equal(t.ret, "number");
  assert.equal(t.file, "src/lib.ts");
  const on = parseTask({ title: "[test] f", body: TASK }, { model: null, approvedKinds: new Set(["ADD_FUNCTION"]) });
  const off = parseTask({ title: "[test] f", body: TASK }, { model: null, approvedKinds: new Set() });
  assert.equal(on.status, "canonical");
  assert.equal(off.status === "unsure" ? off.reason : off.status, "RULE_NOT_APPROVED");
});

test("engine: appends exactly one exported function at the end and writes one new test file; self-graded", () => {
  const e = applyRule(spec(), TASK, files(), (p) => /\.test\.ts$/.test(p))!;
  assert.ok(e);
  assert.ok(e.content.startsWith(LIB), "existing lines unchanged");
  assert.equal(e.content.slice(LIB.length), "\nexport function clampPct(x: number): number {\n  return Math.min(100, Math.max(0, x));\n}\n");
  assert.equal(e.selfGrade, true);
  assert.equal(e.extra!.length, 1);
  assert.ok(e.extra![0]!.create);
  assert.match(e.extra![0]!.content, /clampPct\(150\)/);
});

test("engine: refusals (existing name, unknown type, outside names, side effects, no test bullet, unused params, test target)", () => {
  const no = (task: string, content = LIB) => assert.equal(applyRule(spec(), task, files(content)), null, task);
  no(TASK.replace(/clampPct/g, "scale"));
  no(TASK.replace("x: number", "x: Date"));
  no(TASK.replace("Math.min(100, Math.max(0, x))", "scale(x, 2)"));
  no(TASK.replace("Math.min(100, Math.max(0, x))", "process.exit(x)"));
  no(TASK.replace("Math.min(100, Math.max(0, x))", "(x = 1)"));
  no(TASK.replace("Math.min(100, Math.max(0, x))", "new Array(x)"));
  no(TASK.replace("Math.min(100, Math.max(0, x))", "[1, 2][x]"));
  no(TASK.replace("Math.min(100, Math.max(0, x))", "42"));
  no(TASK.split("\n")[0]!);
  no(TASK.replace("src/lib.ts", "src/nope.ts"));
  assert.equal(applyRule(spec(), TASK.replace(/src\/lib\.ts/g, "src/lib.test.ts"), [{ path: "src/lib.test.ts", content: LIB }], (p) => /\.test\.ts$/.test(p)), null);
});

test("engine: issue-cleaned text still works (no `>` needed), string/array bodies allowed", () => {
  const t = cleanIssueText({ title: "[test] f", body: "add function `pad2(n: number): string` to `src/lib.ts` returning String(n).padStart(2, \"0\")\n- `pad2(7)` is \"07\"\n- `pad2(12)` is \"12\"" });
  const e = applyRule(spec(), t, files())!;
  assert.ok(e, t);
  assert.match(e.content, /return String\(n\)\.padStart\(2, "0"\);/);
});

test("grading: the new test PASSES with the function and FAILS on the task base", () => {
  const e = applyRule(spec(), TASK, files())!;
  const run = (src: string) => {
    const d = mkdtempSync(join(tmpdir(), "m15-"));
    for (const f of [{ path: "src/lib.ts", content: src }, e.extra![0]!]) { mkdirSync(join(d, dirname(f.path)), { recursive: true }); writeFileSync(join(d, f.path), f.content); }
    writeFileSync(join(d, "package.json"), '{"type":"module"}');
    return spawnSync(tsx, ["--test", e.extra![0]!.path], { cwd: d, encoding: "utf8", env: Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("NODE_TEST"))) }).status;
  };
  assert.equal(run(e.content), 0, "pass-after");
  assert.notEqual(run(LIB), 0, "fail-before");
});

test("protected set: learned-function.ts is protected", () => {
  assert.ok(PROTECTED_SELF.some((p) => p.pattern.test("peaceai/lib/learned-function.ts")));
});

test("vocabulary (M15.1): repeat refused; padStart/padEnd need an integer literal length <= 64", () => {
  const t = (expr: string) => "add function `f(s: string, n: number): string` to `src/lib.ts` returning " + expr + "\n- `f(\"a\", 1)` is \"a\"";
  for (const bad of ["s.repeat(n)", "s.repeat(2)", "s.padStart(n, \"0\")", "s.padEnd(65, \" \")", "s.padStart(1e9, \"0\")", "s.padStart(2.5, \"0\")", "s.padStart(-1, \"0\")", "s.padStart(n + 1, \"0\")", "s.padStart()"])
    assert.equal(applyRule(spec(), t(bad), files()), null, bad);
  for (const good of ["s.padStart(1, String(n))", "s.padEnd(64, \" \").slice(0, n + 1)"]) assert.ok(applyRule(spec(), t(good), files()), good);
});
