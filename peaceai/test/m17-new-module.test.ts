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

// ---- M17 Auditor fixes
import { mkdirSync as mk, symlinkSync } from "node:fs";
import { callsFunction, PROTECTED_MODULE, PROTECTED_NAMES, safeNewModuleOnDisk, stubFunction } from "../lib/learned-function.ts";
import { gradingVerdict, validTestGrading } from "../lib/results.ts";
import { freshVerdict, regradeRecord } from "../lib/rebase.ts";

test("stub: body replaced by the type default; a test the stub satisfies is REJECTED_PASSES_WITH_STUB", () => {
  assert.equal(stubFunction("export function f(x: number): number {\n  return x + 1;\n}\n", "f"), "export function f(x: number): number {\n  return 0;\n}\n");
  assert.match(stubFunction("export function f(s: string): readonly string[] {\n  return s.split(\",\");\n}\n", "f")!, /return \[\];/);
  assert.match(stubFunction("export function f(s: string): boolean {\n  return s.length === 2;\n}\n", "f")!, /return false;/);
  assert.equal(stubFunction("export function f(x: number): number {\n  return x;\n}\nexport function f(x: number): number {\n  return x;\n}\n", "f"), null);
  assert.equal(gradingVerdict(true, false, false), "REJECTED_PASSES_WITH_STUB");
  assert.equal(gradingVerdict(true, false, true), "COUNTS");
  assert.equal(gradingVerdict(true, false), "COUNTS");
  const base = { fixSha: "a".repeat(40), afterFix: true, beforeFix: false, reason: null };
  assert.ok(validTestGrading({ ...base, verdict: "COUNTS", stubFails: true }));
  assert.ok(validTestGrading({ ...base, verdict: "REJECTED_PASSES_WITH_STUB", stubFails: false }));
  assert.ok(!validTestGrading({ ...base, verdict: "COUNTS", stubFails: false }), "COUNTS with a passing stub is invalid");
  // End to end: a boolean helper whose only bullet expects false passes with the stub.
  const e = applyRule(spec(P2), "add function `isTwo(s: string): boolean` to `src/two.ts` returning s.length === 2\n- `isTwo(\"abc\")` is false", files, isTest)!;
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("NODE_TEST")));
  const d = mkdtempSync(join(tmpdir(), "m17s-"));
  mk(join(d, "src"), { recursive: true });
  writeFileSync(join(d, "package.json"), '{"type":"module"}');
  writeFileSync(join(d, e.path), stubFunction(e.content, "isTwo")!);
  writeFileSync(join(d, e.extra![0]!.path), e.extra![0]!.content);
  assert.equal(spawnSync(tsx, ["--test", e.extra![0]!.path], { cwd: d, env }).status, 0, "this weak test passes with the stub -> must not count");
});

test("import-only tests are refused: the test must call the function", () => {
  assert.equal(callsFunction('import { f } from "./m";\nimport test from "node:test";\ntest("x", () => {});\n', "f"), false);
  assert.equal(callsFunction('import { f } from "./m";\ntest("x", () => { assert.equal(f(1), 2); });\n', "f"), true);
});

test("protected names and module paths are refused", () => {
  for (const n of ["scanText", "isProtectedPath", "constructor", "__proto__", "toString", "then"]) {
    assert.ok(PROTECTED_NAMES.test(n), n);
    assert.equal(applyRule(spec(P2), task("src/pct.ts").replace(/pct\(/g, `${n}(`), files, isTest), null, n);
  }
  for (const f of ["src/gate.ts", "src/approved-list.ts", "src/leak.ts", "src/scripts/x.ts", "src/peaceai/x.ts", "src/token.ts"]) assert.ok(PROTECTED_MODULE.test(f), f);
  for (const f of ["src/aggregate.ts", "src/pct.ts", "src/tokenize-dates.ts"]) assert.ok(!PROTECTED_MODULE.test(f), f);
});

test("on disk: realpath inside the root, no symlinked component, file must not exist", () => {
  const root = mkdtempSync(join(tmpdir(), "m17d-"));
  mk(join(root, "src", "sub"), { recursive: true });
  writeFileSync(join(root, "src", "lib.ts"), LIB);
  const outside = mkdtempSync(join(tmpdir(), "m17o-"));
  symlinkSync(outside, join(root, "src", "link"));
  symlinkSync(join(root, "src", "sub"), join(root, "src", "inner"));
  assert.equal(safeNewModuleOnDisk(root, "src/pct.ts"), true);
  assert.equal(safeNewModuleOnDisk(root, "src/sub/pct.ts"), true);
  assert.equal(safeNewModuleOnDisk(root, "src/lib.ts"), false, "exists");
  assert.equal(safeNewModuleOnDisk(root, "src/link/pct.ts"), false, "symlink to outside");
  assert.equal(safeNewModuleOnDisk(root, "src/inner/pct.ts"), false, "symlink even when inside");
  assert.equal(safeNewModuleOnDisk(root, "src/missing/pct.ts"), false, "no new directory");
  symlinkSync("/etc/passwd", join(root, "src", "dangle.ts"));
  assert.equal(safeNewModuleOnDisk(root, "src/dangle.ts"), false, "symlink at the file itself");
});

test("regrade (#99): stub check and the old base -> new head -> fresh grade record", () => {
  assert.ok("reason" in freshVerdict({ suite: true, newTests: ["t"], afterPass: true, beforeFail: true, stubFail: false }));
  const g = freshVerdict({ suite: true, newTests: ["t"], afterPass: true, beforeFail: true, stubFail: true });
  assert.ok(!("reason" in g));
  const r = regradeRecord({ issue: 97, runId: "1", candidateId: "candidate-1", diffSha256: "d", patchSha256: "p", oldBase: "a".repeat(40), newHead: "b".repeat(40), appliedCommit: null, grade: g as never, now: new Date("2026-10-13T15:00:00.123Z") });
  assert.deepEqual(Object.keys(r).sort(), ["appliedCommit", "candidateId", "diffSha256", "grade", "gradedAt", "issue", "newHead", "oldBase", "patchSha256", "runId", "schema"]);
  assert.equal(r.schema, "peaceai-regrade:v1");
  assert.equal(r.gradedAt, "2026-10-13T15:00:00Z");
  assert.equal(r.oldBase, "a".repeat(40));
  assert.equal(r.newHead, "b".repeat(40));
});

test("miner label bumped to v2", async () => {
  const { MINER_VERSION } = await import("../lib/mine.ts");
  assert.equal(MINER_VERSION, "peaceai-miner:v2");
});
