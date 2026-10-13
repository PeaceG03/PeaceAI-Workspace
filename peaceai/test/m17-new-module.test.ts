// M17: ADD_FUNCTION v2 may create the named module when it does not exist (next to existing source only).
// v1 (end-of-module) never creates one. The new test must pass with the module and fail without it.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { applyRule, specHash, validateSpec, type RuleSpec } from "../lib/learned.ts";
import { FUNCTION_TRIGGER } from "../lib/learned-function.ts";
import { observeFile, parseHunks } from "../lib/mine.ts";

const repo = resolve(import.meta.dirname, "..", "..");
const tsx = join(repo, "node_modules/.bin/tsx");
const P1 = { body: "single-return", grading: "self-fail-before-pass-after", params: "typed", placement: "end-of-module", returns: "annotated", test: "new-file" };
const P2 = { ...P1, placement: "end-of-module-or-new-module" };
const spec = (params: Record<string, string>): RuleSpec => ({
  schema: "peaceai-learned-rule:v1", id: "public-add-function-v2", kind: "ADD_FUNCTION", minedFrom: "public", minerVersion: "peaceai-miner:v1", shape: "PURE_FUNCTION",
  trigger: FUNCTION_TRIGGER, params, evidence: { hunks: 1, commits: 1, files: 1, repos: ["PeaceG03/PeaceSTOCKS"] },
});
const LIB = "export function scale(value: number, factor: number): number {\n  return value * factor;\n}\n";
const files = [{ path: "src/lib.ts", content: LIB }, { path: "src/lib.test.ts", content: "" }];
const task = (file: string) => `add function \`pct(x: number, n: number): number\` to \`${file}\` returning Math.round(x / n * 100)\n- \`pct(1, 4)\` is 25\n- \`pct(1, 3)\` is 33`;
const isTest = (p: string) => /\.test\.ts$/.test(p);

test("spec: committed public-add-function-v2 validates, public-only, placement allows new modules; v1 file unchanged", () => {
  const s = JSON.parse(readFileSync(join(repo, "peaceai/rules/learned/public-add-function-v2.json"), "utf8")) as RuleSpec;
  assert.ok(validateSpec(s));
  assert.deepEqual(s.params, P2);
  assert.match(specHash(s), /^[0-9a-f]{64}$/);
  assert.ok(!validateSpec({ ...s, minedFrom: "core", id: "core-add-function-v2" }));
  const v1 = JSON.parse(readFileSync(join(repo, "peaceai/rules/learned/public-add-function-v1.json"), "utf8")) as RuleSpec;
  assert.equal(specHash(v1), "b5f13fcca732c6ce7a22a66647ffdaf7b6035cf8d6aba6830ef6f6fa811e7999");
});

test("engine v2: missing module -> one created module holding only the function + one new test; self-graded", () => {
  const e = applyRule(spec(P2), task("src/pct.ts"), files, isTest)!;
  assert.ok(e);
  assert.equal(e.path, "src/pct.ts");
  assert.equal(e.create, true);
  assert.equal(e.content, "export function pct(x: number, n: number): number {\n  return Math.round(x / n * 100);\n}\n");
  assert.equal(e.selfGrade, true);
  assert.equal(e.extra!.length, 1);
  assert.match(e.extra![0]!.content, /from "\.\/pct"/);
});

test("engine v1 never creates a module", () => {
  assert.equal(applyRule(spec(P1), task("src/pct.ts"), files, isTest), null);
});

test("engine v2 refusals: new directory, no sibling, test/declaration/upper-case path, case-colliding name, unsafe body", () => {
  for (const f of ["src/newdir/pct.ts", "lib/pct.ts", "src/pct.test.ts", "src/pct.d.ts", "src/Pct.ts", "src/LIB.ts", "src/../pct.ts", "pct.ts"])
    assert.equal(applyRule(spec(P2), task(f), files, isTest), null, f);
  assert.equal(applyRule(spec(P2), task("src/pct.ts").replace("Math.round(x / n * 100)", "scale(x, n)"), files, isTest), null);
  assert.equal(applyRule(spec(P2), task("src/pct.ts").replace("Math.round(x / n * 100)", "7"), files, isTest), null);
});

test("grading: the new test PASSES with the new module and FAILS without it", () => {
  const e = applyRule(spec(P2), task("src/pct.ts"), files, isTest)!;
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("NODE_TEST")));
  const run = (withModule: boolean) => {
    const d = mkdtempSync(join(tmpdir(), "m17-"));
    for (const f of [{ path: "src/lib.ts", content: LIB }, ...(withModule ? [{ path: e.path, content: e.content }] : []), e.extra![0]!]) { mkdirSync(join(d, dirname(f.path)), { recursive: true }); writeFileSync(join(d, f.path), f.content); }
    writeFileSync(join(d, "package.json"), '{"type":"module"}');
    return spawnSync(tsx, ["--test", e.extra![0]!.path], { cwd: d, env, encoding: "utf8" }).status;
  };
  assert.equal(run(true), 0);
  assert.notEqual(run(false), 0);
});

test("miner: an exported single-return function in a file-creating hunk is PURE_FUNCTION placement new-module", () => {
  const post = "export function a(x: number): number {\n  return x + 1;\n}\n";
  const obs = observeFile("R@1", "src/a.ts", post, parseHunks("@@ -0,0 +1,3 @@\n+export function a(x: number): number {\n+  return x + 1;\n+}\n"));
  assert.equal(obs.length, 1);
  assert.equal(obs[0]!.shape, "PURE_FUNCTION");
  assert.equal(obs[0]!.style.placement, "new-module");
});
