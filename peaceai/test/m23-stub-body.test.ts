// M23 (Auditor, #127): a learned test whose fix commit CREATED its module is graded against a stubbed body
// when the revert cannot apply on today's file. Fail closed otherwise.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { declaredFunctions, expectsThrow, gradedTestSourceProblem, hasNonDeclarationCallables, importedNames, newStubCode, STUB_BODY_CODE, stubAll, stubBody, stubFailureCredited } from "../lib/learned-function.ts";
import { validTestGrading, gradingVerdict } from "../lib/results.ts";
import { PROTECTED_SELF } from "../lib/selfchange.ts";

const repo = resolve(import.meta.dirname, "..", "..");
const tsx = join(repo, "node_modules/.bin/tsx");
const MOD = [
  "export type Mode = { mode: string; next: string };",
  "export function helper(n: number): number { return n + 1; }",
  "export function decide(s: { outcome: string; failures: number }): Mode {",
  "  if (s.outcome === \"refused\") return { mode: \"ALERT\", next: \"alert\" };",
  "  if (s.failures > 3) return { mode: \"ALERT\", next: \"alert\" };",
  "  return { mode: \"DAILY\", next: \"stop\" };",
  "}",
  "export function later(): string { return \"x\"; }",
  "",
].join("\n");

test("stubBody: whole body of the one exported function; type-default when M17 applies, else a throw; others untouched", () => {
  const s = stubBody(MOD, "decide")!;
  assert.equal(s.throws, true);
  assert.match(s.content, new RegExp(`export function decide\\(s: \\{ outcome: string; failures: number \\}\\): Mode \\{ throw new Error\\("${STUB_BODY_CODE}"\\); \\}`));
  assert.ok(s.content.includes("export function helper(n: number): number { return n + 1; }"));
  assert.ok(s.content.includes("export function later(): string { return \"x\"; }"));
  assert.deepEqual(stubBody(MOD, "helper"), { content: MOD.replace("return n + 1;", "return 0;"), throws: false }, "M17 machinery reused");
  for (const fn of ["missing", "Mode"]) assert.equal(stubBody(MOD, fn), null, fn);
  assert.equal(stubBody("function decide(): number { return 1; }\nfunction decide2() {}\n".replace("function decide(", "function decide("), "decide2"), null, "not exported");
  assert.equal(stubBody("export function* gen() { yield 1; }\n", "gen"), null, "generator");
  assert.equal(stubBody("export function f(a: number): number;\nexport function f(a: any) { return a; }\n", "f"), null, "overloads");
  assert.equal(stubBody("export declare function f(): void;\n", "f"), null, "no body");
});

test("stubAll (Auditor #129): every fix-created function stubbed; fail closed if any is missing or unstubbable", () => {
  assert.deepEqual(declaredFunctions(MOD), ["helper", "decide", "later"]);
  const all = stubAll(MOD, ["helper", "decide", "later"])!;
  assert.equal(all.throws, true);
  assert.ok(all.content.includes("{ return 0; }") || all.content.includes("return 0;"), "helper -> type default");
  assert.ok(all.content.includes(`{ throw new Error("${STUB_BODY_CODE}"); }`), "decide -> throw");
  assert.ok(all.content.includes('export function later(): string { return ""; }'), "later -> type default");
  assert.equal(stubAll(MOD, ["decide", "gone"]), null, "a created function no longer present");
  assert.equal(stubAll(MOD, []), null);
  assert.equal(stubAll(MOD, ["decide", "decide"]), null);
  const priv = "function inner(x: number): number { return x * 2; }\nexport function outer(x: number): number { return inner(x) + 1; }\n";
  assert.equal(stubAll(priv, ["inner", "outer"])!.content, "function inner(x: number): number { return 0; }\nexport function outer(x: number): number { return 0; }\n", "non-exported helpers too");
});

test("contract (Auditor #129): a test that still passes with only the tested function stubbed but a helper real is caught", () => {
  // outer delegates to a fix-created helper; stubbing outer alone would already fail, so check the stronger
  // direction: a test that calls outer passes on real code and FAILS with all created functions stubbed.
  const dir = mkdtempSync(join(tmpdir(), "m23b-"));
  try {
    const mod = "export function inner(x: number): number { return x * 2; }\nexport function outer(x: number): number { return inner(x) + 1; }\n";
    writeFileSync(join(dir, "package.json"), JSON.stringify({ type: "module" }));
    writeFileSync(join(dir, "mod.ts"), mod);
    writeFileSync(join(dir, "mod.test.ts"), 'import assert from "node:assert/strict";\nimport test from "node:test";\nimport { outer } from "./mod.ts";\ntest("t", () => { assert.equal(outer(2), 5); });\n');
    const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("NODE_TEST")));
    const run = () => spawnSync(tsx, ["--test", "mod.test.ts"], { cwd: dir, encoding: "utf8", env }).status === 0;
    assert.equal(run(), true, "passes on real code");
    writeFileSync(join(dir, "mod.ts"), stubAll(mod, declaredFunctions(mod))!.content);
    assert.equal(run(), false, "fails with all created functions stubbed");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("importedNames / expectsThrow", () => {
  const t = 'import assert from "node:assert/strict";\nimport { decide, helper as h, type Mode } from "./mod";\nimport type { X } from "./mod";\n';
  assert.deepEqual(importedNames(t, "./mod"), ["decide", "helper"]);
  assert.deepEqual(importedNames(t, "./other"), []);
  assert.ok(expectsThrow("assert.throws(() => f(), /X/);"));
  assert.ok(expectsThrow("await assert.rejects(p);"));
  assert.ok(!expectsThrow("assert.equal(f(), 1);"));
});

test("contract: the test passes on the real module and FAILS on the stubbed body (COUNTS; stubFails recorded)", () => {
  const dir = mkdtempSync(join(tmpdir(), "m23-"));
  try {
    writeFileSync(join(dir, "package.json"), JSON.stringify({ type: "module" }));
    writeFileSync(join(dir, "mod.ts"), MOD);
    writeFileSync(join(dir, "mod.test.ts"), 'import assert from "node:assert/strict";\nimport test from "node:test";\nimport { decide } from "./mod.ts";\ntest("t", () => { assert.equal(decide({ outcome: "refused", failures: 0 }).mode, "ALERT"); });\n');
    const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("NODE_TEST")));
    const run = () => spawnSync(tsx, ["--test", "mod.test.ts"], { cwd: dir, encoding: "utf8", env }).status === 0;
    const after = run();
    writeFileSync(join(dir, "mod.ts"), stubAll(MOD, declaredFunctions(MOD))!.content);
    const before = run();
    assert.equal(after, true);
    assert.equal(before, false);
    const g = { fixSha: "a".repeat(40), afterFix: after, beforeFix: before, verdict: gradingVerdict(after, before, !before), reason: null, stubFails: !before };
    assert.equal(g.verdict, "COUNTS");
    assert.ok(validTestGrading(g));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("harness wiring: stub-body only after the revert check fails, fail closed on every other shape", () => {
  const tc = readFileSync(join(repo, "peaceai/bin/test-candidates.ts"), "utf8");
  const g = tc.slice(tc.indexOf("function gradeTest("), tc.indexOf("function stubBefore("));
  assert.match(g, /if \(!runTrusted\(tree, "git", \["apply", "--check"[^\n]*\)\) \{\n(?:[^\n]*\n){2,8}?\s+const stubbed = stubBefore\(/, "only when the revert cannot apply");
  assert.match(g, /if \(!stubbed\) return ungradable\("revert-failed"\);/, "fail closed");
  assert.match(g, /writeFileSync\(stubbed\.file, stubbed\.real\);/, "real code restored");
  assert.match(g, /stubFails: !run\.ok/);
  const sb = tc.slice(tc.indexOf("function stubBefore("), tc.indexOf("function gradeSelf("));
  for (const re of [/if \(paths\.length !== 1\) return null;/, /--diff-filter=A/, /if \(!added\.split\("\\n"\)\.includes\(path\)\) return null;/, /isSymbolicLink\(\)/, /if \(called\.length !== 1\) return null;/, /if \(!a \|\| !b\) return null;/, /if \(fns\.size !== 1\) return null;/, /stub\.throws && tests\.some\(expectsThrow\)/, /fixContent = git\(repo, "show", `\$\{fixSha\}:\$\{path\}`\); created = declaredFunctions\(fixContent\)/, /if \(!created\.includes\(fn\)\) return null;/, /const stub = stubAll\(real, created, code\);/]) assert.match(sb, re, String(re));
});

test("protected (M23): learned-function.ts and test-candidates.ts stay protected", () => {
  for (const p of ["peaceai/lib/learned-function.ts", "peaceai/bin/test-candidates.ts"]) assert.ok(PROTECTED_SELF.some((x) => x.pattern.test(p)), p);
});

test("Auditor #129: aliases followed, namespace/default imports fail closed", async () => {
  const { importedBindings } = await import("../lib/learned-function.ts");
  assert.deepEqual(importedBindings('import { decide as d, helper } from "./m";\nd({});\n', "./m"), [{ imported: "decide", local: "d" }, { imported: "helper", local: "helper" }]);
  assert.equal(importedBindings('import * as m from "./m";\n', "./m"), null);
  assert.equal(importedBindings('import m, { decide } from "./m";\n', "./m"), null);
  assert.deepEqual(importedBindings('import type { Mode } from "./m";\n', "./m"), []);
});

const runIn = (dir: string, file: string) => {
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("NODE_TEST")));
  const r = spawnSync(tsx, ["--test", file], { cwd: dir, encoding: "utf8", env });
  return { ok: r.status === 0, out: `${r.stdout}\n${r.stderr}` };
};

test("Auditor #129 behavior (real module, end to end): stubbing only the target passes, stubbing every created function fails and is credited", () => {
  const dir = mkdtempSync(join(tmpdir(), "m23c-"));
  try {
    // The test calls ONE function (outer) but also reads K, which the created helper computes at load.
    const mod = "export function inner(): number { return 7; }\nexport const K = inner();\nexport function outer(n: number): number { return n - n; }\n";
    const t = 'import assert from "node:assert/strict";\nimport test from "node:test";\nimport { K, outer } from "./mod.ts";\ntest("t", () => { assert.equal(outer(3), 0); assert.equal(K, 7); });\n';
    writeFileSync(join(dir, "package.json"), JSON.stringify({ type: "module" }));
    writeFileSync(join(dir, "mod.test.ts"), t);
    assert.equal(gradedTestSourceProblem(t, ["./mod.ts"], declaredFunctions(mod)), null, "K is a value, outer is only called");
    assert.equal(hasNonDeclarationCallables(mod), false);
    writeFileSync(join(dir, "mod.ts"), mod);
    assert.equal(runIn(dir, "mod.test.ts").ok, true, "real code passes");
    writeFileSync(join(dir, "mod.ts"), stubAll(mod, ["outer"])!.content);
    assert.equal(runIn(dir, "mod.test.ts").ok, true, "only the target stubbed: still passes (would be REJECTED_PASSES_WITH_STUB)");
    const code = newStubCode();
    writeFileSync(join(dir, "mod.ts"), stubAll(mod, declaredFunctions(mod), code)!.content);
    const all = runIn(dir, "mod.test.ts");
    assert.equal(all.ok, false, "every created function stubbed: fails");
    assert.equal(stubFailureCredited(all.out, code), true, "an assertion failure: credited");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Auditor #129 forged marker: credit comes only from the runner's report; load errors and other throws are not credited", () => {
  const dir = mkdtempSync(join(tmpdir(), "m23d-"));
  try {
    writeFileSync(join(dir, "package.json"), JSON.stringify({ type: "module" }));
    const code = newStubCode();
    writeFileSync(join(dir, "m.ts"), stubAll(MOD, ["helper", "decide", "later"], code)!.content);
    const head = 'import assert from "node:assert/strict";\nimport test from "node:test";\nimport { decide as d } from "./m.ts";\n';
    const run = (src: string) => { writeFileSync(join(dir, "x.test.ts"), src); return runIn(dir, "x.test.ts"); };
    const thrown = run(head + 'test("t", () => { assert.equal(d({ outcome: "refused", failures: 0 }).mode, "ALERT"); });\n');
    assert.equal(thrown.ok, false); assert.equal(stubFailureCredited(thrown.out, code), true, "the stub's own throw");
    assert.equal(stubFailureCredited(thrown.out, newStubCode()), false, "Round 2: another run's code is not credited");
    assert.equal(stubFailureCredited(thrown.out, "PEACEAI_STUB_BODY"), false, "Round 2: the fixed prefix alone is never credited");
    const other = run(head + 'test("t", () => { throw new TypeError("boom"); });\n');
    assert.equal(other.ok, false); assert.equal(stubFailureCredited(other.out, code), false, "another error");
    const load = run('import test from "node:test";\nimport { nope } from "./missing.ts";\ntest("t", () => { nope(); });\n');
    assert.equal(load.ok, false); assert.equal(stubFailureCredited(load.out, code), false, "import/load error");
    assert.equal(stubFailureCredited("", code), false);
    assert.equal(stubFailureCredited("ok 1 - t\n", code), false, "no failure");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  // A test cannot read the stubbed file, env or processes, or forge the stub's code.
  const h = 'import assert from "node:assert/strict";\nimport test from "node:test";\nimport { decide } from "./m";\n';
  for (const [src, why] of [
    ['import { readFileSync } from "node:fs";\n', "fs import"],
    [h + 'test("t", async () => { const fs = await import("node:fs"); });\n', "dynamic import"],
    [h + 'test("t", () => { process.stderr.write("x"); });\n', "process"],
    [h + 'test("t", () => { console.error("x"); });\n', "console"],
    [h + 'test("t", () => { throw new Error("PEACEAI_STUB_BODY"); });\n', "stub code"],
    [h + 'test("t", () => { const u = import.meta.url; });\n', "import.meta"],
    [h + 'test("t", () => { globalThis.x = 1; });\n', "globalThis"],
    [h + 'test("t", () => { const g = (0, eval)("1"); });\n', "eval"],
    [h + 'test("t", () => { const o: any = {}; o["constructor"]; });\n', "computed access"],
    [h + 'import { x } from "./other";\n', "other module"],
  ] as const) assert.ok(gradedTestSourceProblem(src, ["./m", "./m.ts"]), why);
  assert.equal(gradedTestSourceProblem(h + 'test("t", () => { assert.equal(decide({ outcome: "x", failures: 0 }).mode, "DAILY"); });\n', ["./m", "./m.ts"]), null);
  assert.ok(!readFileSync(join(repo, "peaceai/lib/learned-function.ts"), "utf8").includes("PEACEAI_STUB_REACHED"), "no printed marker remains");
});

test("Auditor #129: fail closed on any callable that is not a top-level function declaration", () => {
  for (const src of [
    "export const f = (n: number): number => n;\n",
    "export const f = function (n: number): number { return n; };\n",
    "export class C { m(): number { return 1; } }\n",
    "export const o = { m(): number { return 1; } };\n",
    "export const o = { get v(): number { return 1; } };\n",
    "export const xs = [1].map((x) => x);\n",
  ]) assert.equal(hasNonDeclarationCallables(src), true, src);
  assert.equal(hasNonDeclarationCallables("export function f(xs: number[]): number[] { return xs.map((x) => x + 1); }\nexport const N = 3;\n"), false, "arrows inside a declaration's body are stubbed with it");
  const tc = readFileSync(join(repo, "peaceai/bin/test-candidates.ts"), "utf8");
  assert.match(tc, /if \(hasNonDeclarationCallables\(fixContent\) \|\| hasNonDeclarationCallables\(real\)\) return null;/);
  assert.match(tc, /if \(gradedTestSourceProblem\(tests\[i\]!, \[spec, `\$\{spec\}\.ts`\], moduleFunctions\)\) return null;/);
  assert.match(tc, /const credited = !run\.ok && stubFailureCredited\(run\.out, code\);/);
});

test("Auditor #129: harness restores the file in finally, records stubbed names, refuses unreached stubs", () => {
  const g = readFileSync(join(repo, "peaceai/bin/test-candidates.ts"), "utf8");
  assert.match(g, /try \{\s*run = runGradedTests\(tree, tsx, newTests\);\s*\} finally \{\s*writeFileSync\(stubbed\.file, stubbed\.real\);/);
  assert.match(g, /if \(!run\.ok && !credited\) return \{ \.\.\.ungradable\("stub-not-reached"\), stubbed: stubbed\.stubbed \};/);
  assert.match(g, /stubFails: !run\.ok, stubbed: stubbed\.stubbed/);
  assert.ok(validTestGrading({ fixSha: "a".repeat(40), afterFix: true, beforeFix: false, verdict: "COUNTS", reason: null, stubFails: true, stubbed: ["decide", "helper"] }));
  assert.ok(!validTestGrading({ fixSha: "a".repeat(40), afterFix: true, beforeFix: false, verdict: "COUNTS", reason: null, stubFails: true, stubbed: ["bad name"] }));
  assert.ok(PROTECTED_SELF.some((p) => p.pattern.test("peaceai/test/m23-stub-body.test.ts")), "this test is protected");
});

// ---- Round 2 (Auditor #129)

const H2 = 'import assert from "node:assert/strict";\nimport test from "node:test";\nimport { decide, K } from "./m";\n';
const FNS = ["decide", "helper"];

test("Round 2 #129 item 1: test files may not name constructor, __proto__, prototype, caller or callee", () => {
  for (const name of ["constructor", "__proto__", "prototype", "caller", "callee"]) {
    assert.ok(gradedTestSourceProblem(H2 + `test("t", () => { const o: any = {}; o.${name}; });\n`, ["./m"], FNS), `${name} as property`);
    assert.ok(gradedTestSourceProblem(H2 + `test("t", () => { const o: any = { ${name}: 1 }; });\n`, ["./m"], FNS), `${name} as key`);
    assert.ok(gradedTestSourceProblem(H2 + `test("t", () => { const o: any = {}; const { ${name}: v } = o; });\n`, ["./m"], FNS), `${name} destructured`);
    assert.ok(gradedTestSourceProblem(H2 + `test("t", () => { const o: any = { "${name}": 1 }; });\n`, ["./m"], FNS), `${name} as string key`);
  }
  assert.ok(gradedTestSourceProblem(H2 + 'test("t", function () { arguments; });\n', ["./m"], FNS), "arguments");
});

test("Round 2 #129 item 1: graded tests run under the permission model on Node >= 22 (no fs write, no child_process)", () => {
  const tc = readFileSync(join(repo, "peaceai/bin/test-candidates.ts"), "utf8");
  const g = tc.slice(tc.indexOf("function runGradedTests("), tc.indexOf("const REAL_RUNS_REQUIRED"));
  assert.match(g, /"--permission", `--allow-fs-read=\$\{realpathSync\(tree\)\}`, `--allow-fs-read=\$\{modules\}`, "--allow-worker", "--import", loader, "--test-reporter=tap", t\]/);
  assert.doesNotMatch(g, /allow-fs-write|allow-child-process|allow-addons|allow-wasi/, "never granted");
  assert.match(g, /TSX_DISABLE_CACHE: "1"/);
  if (Number(process.versions.node.split(".")[0]) < 22) return; // CI runs Node 22: the live check below runs there
  const dir = mkdtempSync(join(tmpdir(), "m23p-"));
  try {
    writeFileSync(join(dir, "package.json"), JSON.stringify({ type: "module" }));
    writeFileSync(join(dir, "m.ts"), "export function f(): number { return 1; }\n");
    writeFileSync(join(dir, "p.test.ts"), 'import assert from "node:assert/strict";\nimport test from "node:test";\nimport { f } from "./m.ts";\n'
      + 'test("ok", () => { assert.equal(f(), 1); });\n'
      + 'test("w", async () => { const fs = await import("node:fs"); fs.writeFileSync("w.txt", "x"); });\n'
      + 'test("c", async () => { const cp = await import("node:child_process"); cp.execFileSync("true"); });\n');
    const modules = realpathSync(join(repo, "node_modules"));
    const env = { ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("NODE_TEST"))), TSX_DISABLE_CACHE: "1" };
    const r = spawnSync(process.execPath, ["--permission", `--allow-fs-read=${realpathSync(dir)}`, `--allow-fs-read=${modules}`, "--allow-worker", "--import", join(modules, "tsx", "dist", "esm", "index.mjs"), "--test-reporter=tap", "p.test.ts"], { cwd: dir, encoding: "utf8", env });
    const out = `${r.stdout}\n${r.stderr}`;
    assert.match(out, /^ok 1 - ok$/m, "the real test still runs and passes");
    assert.match(out, /^not ok 2 - w$/m); assert.match(out, /^not ok 3 - c$/m);
    assert.equal((out.match(/code: 'ERR_ACCESS_DENIED'/g) ?? []).length, 2, "write and spawn denied");
    assert.equal(existsSync(join(dir, "w.txt")), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Round 2 #129 item 2: an imported function may only be called, never stringified, interpolated or read", () => {
  for (const [body, why] of [
    ['const s = decide.toString();', ".toString"],
    ['const s = decide.toLocaleString();', ".toLocaleString"],
    ['const s = String(decide);', "String()"],
    ['const s = `${decide}`;', "template interpolation"],
    ['const s = "" + decide;', "concatenation"],
    ['const g = decide; g({});', "aliased"],
    ['assert.equal(typeof decide, "function");', "typeof"],
    ['const o = { decide };', "shorthand"],
    ['[decide].join("");', "array join"],
    ['const s = `${K}`.toString();', "toString on anything"],
  ] as const) assert.ok(gradedTestSourceProblem(H2 + `test("t", () => { ${body} });\n`, ["./m"], FNS), why);
  assert.equal(gradedTestSourceProblem(H2 + 'test("t", () => { assert.equal(decide({}).mode, "DAILY"); assert.equal(`${decide({}).mode}`, "DAILY"); assert.equal(K, 7); });\n', ["./m"], FNS), null, "calls, interpolated results and values are fine");
  assert.ok(gradedTestSourceProblem(H2 + 'test("t", () => { assert.equal(K, 7); });\n', ["./m"]), "without the module's function list every binding is call-only");
});

test("Round 2 #129 item 3: credit only ERR_ASSERTION or this run's random stub code", () => {
  const a = newStubCode(), b = newStubCode();
  assert.match(a, /^PEACEAI_STUB_BODY_[0-9a-f]{32}$/); assert.notEqual(a, b);
  const tap = (err: string, code: string) => `not ok 1 - t\n  ---\n  error: '${err}'\n  code: '${code}'\n  ...\n`;
  assert.equal(stubFailureCredited(tap("x", "ERR_ASSERTION"), a), true);
  assert.equal(stubFailureCredited(tap(a, "ERR_TEST_FAILURE"), a), true);
  assert.equal(stubFailureCredited(tap(b, "ERR_TEST_FAILURE"), a), false, "another run's code");
  assert.equal(stubFailureCredited(tap("PEACEAI_STUB_BODY", "ERR_TEST_FAILURE"), a), false, "the guessable prefix");
  assert.equal(stubFailureCredited(tap("PEACEAI_STUB_BODY", "ERR_TEST_FAILURE"), "PEACEAI_STUB_BODY"), false, "a non-random code is never accepted");
  assert.equal(stubFailureCredited(tap("x", "ERR_ASSERTION") + tap("boom", "ERR_TEST_FAILURE"), a), false, "every failure must qualify");
  assert.ok(stubBody(MOD, "decide", true, a)!.content.includes(`throw new Error("${a}")`));
  assert.ok(gradedTestSourceProblem(H2 + 'test("t", () => { throw new Error("PEACEAI_STUB_BODY_" + "0".repeat(32)); });\n', ["./m"], FNS), "the prefix may not appear in a test");
  const tc = readFileSync(join(repo, "peaceai/bin/test-candidates.ts"), "utf8");
  assert.match(tc, /const code = newStubCode\(\);\s*const stubbed = stubBefore\(tree, fixSha, paths, newTests, code\);/, "a fresh code per grading run");
});

test("Round 2 #129 item 4: no Math.random, Date, performance, Symbol; the real code must pass 3 runs", () => {
  for (const [body, why] of [
    ['if (Math.random() < 0.5) assert.fail("x");', "Math.random"],
    ['if (Date.now() % 2) assert.fail("x");', "Date"],
    ['if (new Date().getSeconds() % 2) assert.fail("x");', "new Date"],
    ['if (performance.now() % 2 > 1) assert.fail("x");', "performance"],
    ['const s = Symbol("x");', "Symbol"],
    ['const u = crypto.randomUUID();', "crypto"],
  ] as const) assert.ok(gradedTestSourceProblem(H2 + `test("t", () => { ${body} });\n`, ["./m"], FNS), why);
  const tc = readFileSync(join(repo, "peaceai/bin/test-candidates.ts"), "utf8");
  assert.match(tc, /const REAL_RUNS_REQUIRED = 3;/);
  assert.match(tc, /if \(afterFix\) for \(let i = 1; i < REAL_RUNS_REQUIRED; i\+\+\) if \(!runGradedTests\(tree, tsx, newTests\)\.ok\) return ungradable\("real-not-stable"\);/);
  const g = tc.slice(tc.indexOf("function gradeTest("), tc.indexOf("function stubBefore("));
  assert.ok(g.indexOf('ungradable("real-not-stable")') < g.indexOf("const stubbed = stubBefore("), "stability runs come before the stub is written");
});
