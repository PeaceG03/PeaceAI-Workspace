// M23 (Auditor, #127): a learned test whose fix commit CREATED its module is graded against a stubbed body
// when the revert cannot apply on today's file. Fail closed otherwise.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { closeSync, constants as fsConstants, existsSync, mkdtempSync, openSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { countStubNotes, declaredFunctions, moduleDataKeys, expectsThrow, gradedTestSourceProblem, hasNonDeclarationCallables, importedNames, newStubCode, STUB_BODY_CODE, stubAll, stubBody, stubFailureCredited } from "../lib/learned-function.ts";
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

test("stubBody (round 3): whole body -> note + type default (or undefined); never throws, holds no code", () => {
  const s = stubBody(MOD, "decide")!;
  assert.equal(s.throws, true, "no type default: flagged so expects-throw tests are still refused");
  assert.match(s.content, /export function decide\(s: \{ outcome: string; failures: number \}\): Mode \{ __peaceaiStubRan\(\); return undefined as never; \}/);
  assert.ok(s.content.includes("export function helper(n: number): number { return n + 1; }"));
  assert.ok(s.content.includes("export function later(): string { return \"x\"; }"));
  assert.deepEqual(stubBody(MOD, "helper"), { content: MOD.replace("{\n  return n + 1;\n}", "{ __peaceaiStubRan(); return 0; }").replace("{ return n + 1; }", "{ __peaceaiStubRan(); return 0; }"), throws: false });
  for (const fn of ["missing", "Mode"]) assert.equal(stubBody(MOD, fn), null, fn);
  assert.equal(stubBody("function decide(): number { return 1; }\nfunction decide2() {}\n", "decide2"), null, "not exported");
  assert.equal(stubBody("export function* gen() { yield 1; }\n", "gen"), null, "generator");
  assert.equal(stubBody("export function f(a: number): number;\nexport function f(a: any) { return a; }\n", "f"), null, "overloads");
  assert.equal(stubBody("export declare function f(): void;\n", "f"), null, "no body");
  assert.ok(!s.content.includes("throw") && !s.content.includes(STUB_BODY_CODE), "no throw and no code in the stubbed module");
});
test("stubAll (Auditor #129): every fix-created function stubbed, one write-only note helper; fail closed otherwise", () => {
  assert.deepEqual(declaredFunctions(MOD), ["helper", "decide", "later"]);
  const all = stubAll(MOD, ["helper", "decide", "later"])!;
  assert.equal(all.throws, true);
  assert.ok(all.content.startsWith('import { writeSync as __peaceaiStubWrite } from "node:fs";\nfunction __peaceaiStubRan(): void { try { __peaceaiStubWrite(2, "\\u0000peaceai-stub-ran\\n"); }'), "note helper: writes only, to fd 2");
  assert.ok(!/readSync|readFileSync|openSync|PEACEAI_STUB_BODY/.test(all.content), "the stub never reads and holds no code");
  assert.ok(all.content.includes('export function later(): string { __peaceaiStubRan(); return ""; }'), "later -> note + type default");
  assert.equal(stubAll(MOD, ["decide", "gone"]), null, "a created function no longer present");
  assert.equal(stubAll(MOD, []), null);
  assert.equal(stubAll(MOD, ["decide", "decide"]), null);
  assert.equal(stubAll("export function __peaceaiStubRan(): number { return 1; }\n", ["__peaceaiStubRan"]), null, "a module naming the helper");
  const priv = "function inner(x: number): number { return x * 2; }\nexport function outer(x: number): number { return inner(x) + 1; }\n";
  assert.ok(stubAll(priv, ["inner", "outer"])!.content.endsWith("function inner(x: number): number { __peaceaiStubRan(); return 0; }\nexport function outer(x: number): number { __peaceaiStubRan(); return 0; }\n"), "non-exported helpers too");
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
  assert.match(g, /if \(!runTrusted\(tree, "git", \["apply", "--check"[^\n]*\)\) \{\n(?:[^\n]*\n){2,16}?\s+const stubbed = stubBefore\(/, "only when the revert cannot apply");
  assert.match(g, /if \(!stubbed\) return ungradable\("revert-failed"\);/, "fail closed");
  assert.match(g, /writeFileSync\(stubbed\.file, stubbed\.real\);/, "real code restored");
  assert.match(g, /stubFails: !run\.ok/);
  const sb = tc.slice(tc.indexOf("function stubBefore("), tc.indexOf("function gradeSelf("));
  for (const re of [/if \(paths\.length !== 1\) return null;/, /--diff-filter=A/, /if \(!added\.split\("\\n"\)\.includes\(path\)\) return null;/, /isSymbolicLink\(\)/, /if \(called\.length !== 1\) return null;/, /if \(!a \|\| !b\) return null;/, /if \(fns\.size !== 1\) return null;/, /stub\.throws && tests\.some\(expectsThrow\)/, /fixContent = git\(repo, "show", `\$\{fixSha\}:\$\{path\}`\); created = declaredFunctions\(fixContent\)/, /if \(!created\.includes\(fn\)\) return null;/, /const stub = stubAll\(real, created\);/]) assert.match(sb, re, String(re));
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

// Mirrors the harness's runGradedTests: the test file runs directly (tsx loader), under the permission model on
// Node >= 22 with reads narrowed to the test file, the module and node_modules; stderr is a parent-only file
// opened write-only, and the parent counts the stub's notes in it.
const runIn = (dir: string, file: string, module = "mod.ts") => {
  const env = { ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("NODE_TEST"))), TSX_DISABLE_CACHE: "1" };
  const modules = realpathSync(join(repo, "node_modules"));
  const loader = join(modules, "tsx", "dist", "esm", "index.mjs");
  const confined = Number(process.versions.node.split(".")[0]) >= 22;
  const args = confined ? ["--permission", `--allow-fs-read=${realpathSync(join(dir, file))}`, `--allow-fs-read=${realpathSync(join(dir, module))}`, `--allow-fs-read=${modules}`, "--allow-worker", "--import", loader, "--test-reporter=tap", file] : ["--import", loader, "--test-reporter=tap", file];
  const chan = mkdtempSync(join(tmpdir(), "m23n-"));
  const fd = openSync(join(chan, "channel"), fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_APPEND | fsConstants.O_EXCL, 0o600);
  try {
    const r = spawnSync(process.execPath, args, { cwd: dir, encoding: "utf8", env, stdio: ["ignore", "pipe", fd] });
    closeSync(fd);
    const channel = readFileSync(join(chan, "channel"), "utf8");
    return { ok: r.status === 0, out: r.stdout, channel, notes: countStubNotes(channel), confined };
  } finally {
    try { closeSync(fd); } catch { /* closed */ }
    rmSync(chan, { recursive: true, force: true });
  }
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
    writeFileSync(join(dir, "mod.ts"), stubAll(mod, declaredFunctions(mod))!.content);
    const all = runIn(dir, "mod.test.ts");
    assert.equal(all.ok, false, "every created function stubbed: fails");
    assert.ok(all.notes > 0, "the parent saw the stub run");
    assert.equal(stubFailureCredited(all.out, all.notes), true, "stub ran + assertion failure: credited");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Round 3 #129: credit needs the parent to SEE the stub run AND an assertion failure; nothing else is credited", () => {
  const dir = mkdtempSync(join(tmpdir(), "m23d-"));
  try {
    writeFileSync(join(dir, "package.json"), JSON.stringify({ type: "module" }));
    writeFileSync(join(dir, "m.ts"), stubAll(MOD, ["helper", "decide", "later"])!.content);
    const head = 'import assert from "node:assert/strict";\nimport test from "node:test";\nimport { decide as d, later } from "./m.ts";\n';
    const run = (src: string) => { writeFileSync(join(dir, "x.test.ts"), src); return runIn(dir, "x.test.ts", "m.ts"); };
    const good = run(head + 'test("t", () => { assert.equal(later(), "x"); });\n');
    assert.equal(good.ok, false); assert.equal(good.notes, 1); assert.equal(stubFailureCredited(good.out, good.notes), true, "stub ran, assertion failed");
    const crash = run(head + 'test("t", () => { assert.equal(d({ outcome: "refused", failures: 0 }).mode, "ALERT"); });\n');
    assert.equal(crash.ok, false); assert.ok(crash.notes > 0); assert.equal(stubFailureCredited(crash.out, crash.notes), false, "stub ran but the failure is a TypeError");
    const noCall = run(head + 'test("t", () => { assert.equal(1, 2); });\n');
    assert.equal(noCall.notes, 0); assert.equal(stubFailureCredited(noCall.out, noCall.notes), false, "assertion failed but the stub never ran");
    const other = run(head + 'test("t", () => { later(); throw new TypeError("boom"); });\n');
    assert.equal(stubFailureCredited(other.out, other.notes), false, "another error");
    const load = run('import test from "node:test";\nimport { nope } from "./missing.ts";\ntest("t", () => { nope(); });\n');
    assert.equal(load.ok, false); assert.equal(stubFailureCredited(load.out, load.notes), false, "import/load error");
    assert.equal(stubFailureCredited("not ok 1 - t\n  code: 'ERR_ASSERTION'\n", 0), false, "no notes, no credit");
    assert.equal(stubFailureCredited("ok 1 - t\n", 3), false, "no failure");
    // An escaped test (one that got past the source checks) tries to read the note fd and the stubbed source.
    const escaped = run(head + 'test("t", async () => { const fs = await import("node:fs"); let r = "";\n'
      + '  try { const b = Buffer.alloc(64); fs.readSync(2, b); r += "fd:" + b.toString(); } catch (e: any) { r += "fd:" + e.code; }\n'
      + '  try { r += " src:" + fs.readFileSync("m.ts", "utf8").includes("PEACEAI_STUB_BODY_"); } catch (e: any) { r += " src:" + e.code; }\n'
      + '  try { fs.readFileSync("package.json"); r += " other:read"; } catch (e: any) { r += " other:" + e.code; }\n'
      + '  assert.equal(r, "none"); });\n');
    assert.equal(escaped.ok, false);
    assert.equal(escaped.notes, 0, "it learned nothing that makes the stub's note appear");
    assert.equal(stubFailureCredited(escaped.out, escaped.notes), false, "an escaped reader gets no credit");
    assert.match(escaped.out, /fd:EBADF/, "the note fd is write-only");
    assert.match(escaped.out, /src:false/, "the stubbed source holds no code");
    if (escaped.confined) assert.match(escaped.out, /other:ERR_ACCESS_DENIED/, "reads outside the test, module and node_modules are denied");
    assert.equal(gradedTestSourceProblem(head.replace(", later", "") + 'test("t", async () => { const fs = await import("node:fs"); });\n', ["./m.ts"], FNS), "dynamic import", "and the harness refuses such a test before it runs");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  // A test cannot read the stubbed file, env or processes, or name the stub.
  const h = 'import assert from "node:assert/strict";\nimport test from "node:test";\nimport { decide } from "./m";\n';
  for (const [src, why] of [
    ['import { readFileSync } from "node:fs";\n', "fs import"],
    [h + 'test("t", async () => { const fs = await import("node:fs"); });\n', "dynamic import"],
    [h + 'test("t", () => { process.stderr.write("x"); });\n', "process"],
    [h + 'test("t", () => { console.error("x"); });\n', "console"],
    [h + 'test("t", () => { __peaceaiStubRan(); });\n', "the note helper"],
    [h + 'test("t", () => { const u = import.meta.url; });\n', "import.meta"],
    [h + 'test("t", () => { globalThis.x = 1; });\n', "globalThis"],
    [h + 'test("t", () => { const g = (0, eval)("1"); });\n', "eval"],
    [h + 'test("t", () => { const o: any = {}; o["constructor"]; });\n', "computed access"],
    [h + 'import { x } from "./other";\n', "other module"],
  ] as const) assert.ok(gradedTestSourceProblem(src, ["./m", "./m.ts"]), why);
  assert.equal(gradedTestSourceProblem(h + 'test("t", () => { assert.equal(decide({ outcome: "x", failures: 0 }).mode, "DAILY"); });\n', ["./m", "./m.ts"], undefined, moduleDataKeys(MOD)), null);
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
  assert.match(tc, /if \(gradedTestSourceProblem\(tests\[i\]!, \[spec, `\$\{spec\}\.ts`\], moduleFunctions, moduleKeys\)\) return null;/);
  assert.match(tc, /const credited = !run\.ok && stubFailureCredited\(run\.out, run\.notes\);/);
});

test("Auditor #129: harness restores the file in finally, records stubbed names, refuses unreached stubs", () => {
  const g = readFileSync(join(repo, "peaceai/bin/test-candidates.ts"), "utf8");
  assert.match(g, /try \{\s*run = runGradedTests\(tree, tsx, newTests, stubbed\.file, true\);\s*\} finally \{\s*writeFileSync\(stubbed\.file, stubbed\.real\);/);
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
  assert.match(g, /"--permission", `--allow-fs-read=\$\{realpathSync\(join\(tree, t\)\)\}`, `--allow-fs-read=\$\{realpathSync\(module\)\}`, `--allow-fs-read=\$\{modules\}`, "--allow-worker", "--import", loader, "--test-reporter=tap", t\]/, "reads: test file, module, node_modules only");
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
  assert.equal(gradedTestSourceProblem(H2 + 'test("t", () => { assert.equal(decide({}).mode, "DAILY"); assert.equal(`${decide({}).mode}`, "DAILY"); assert.equal(K, 7); });\n', ["./m"], FNS, moduleDataKeys(MOD)), null, "calls, interpolated results and values are fine");
  assert.ok(gradedTestSourceProblem(H2 + 'test("t", () => { assert.equal(K, 7); });\n', ["./m"]), "without the module's function list every binding is call-only");
});

test("Round 3 #129: the random nonce stays in the parent; the harness wiring", () => {
  const a = newStubCode(), b = newStubCode();
  assert.match(a, /^PEACEAI_STUB_BODY_[0-9a-f]{32}$/); assert.notEqual(a, b);
  const tc = readFileSync(join(repo, "peaceai/bin/test-candidates.ts"), "utf8");
  const g = tc.slice(tc.indexOf("function runGradedTests("), tc.indexOf("const REAL_RUNS_REQUIRED"));
  assert.match(g, /dir = mkdtempSync\(join\(tmpdir\(\), `\$\{newStubCode\(\)\}-`\)\);/, "nonce names the parent-only directory");
  assert.match(g, /fd = openSync\(join\(dir, "channel"\), fsConstants\.O_WRONLY \| fsConstants\.O_CREAT \| fsConstants\.O_APPEND \| fsConstants\.O_EXCL, 0o600\);/, "write-only for the child");
  assert.match(g, /seen \+= countStubNotes\(readFileSync\(join\(dir, "channel"\), "utf8"\)\);/, "only the parent reads it");
  assert.match(tc, /const credited = !run\.ok && stubFailureCredited\(run\.out, run\.notes\);/);
  assert.match(tc, /run = runGradedTests\(tree, tsx, newTests, stubbed\.file, true\);/);
  assert.ok(!/stubAll\(real, created, /.test(tc), "nothing secret is passed into the stub");
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
  assert.match(tc, /if \(afterFix\) for \(let i = 1; i < REAL_RUNS_REQUIRED; i\+\+\) if \(!runGradedTests\(tree, tsx, newTests, join\(tree, paths\[0\]!\)\)\.ok\) return ungradable\("real-not-stable"\);/);
  const g = tc.slice(tc.indexOf("function gradeTest("), tc.indexOf("function stubBefore("));
  assert.ok(g.indexOf('ungradable("real-not-stable")') < g.indexOf("const stubbed = stubBefore("), "stability runs come before the stub is written");
});

// ---- Round 3 (Auditor #129: F1 descriptor escape, timing globals, F2 Node < 22, multi-file modules)

test("Round 3 #129 F1: descriptor/prototype escape refused; Object only via allow-listed members", () => {
  for (const [body, why] of [
    ['const d = Object.getOwnPropertyDescriptors(decide);', "getOwnPropertyDescriptors"],
    ['const p = Object.getPrototypeOf(decide);', "getPrototypeOf"],
    ['const v = Object.values({ a: 1 });', "Object.values"],
    ['const n = Object.values(Object.getOwnPropertyDescriptors(Object.getPrototypeOf(K))).map((d: any) => d.value.name);', "the full F1 chain"],
    ['const x: any = K; const n = x.name;', ".name lookup"],
    ['const d = Object.getOwnPropertyDescriptor(K, "x");', "getOwnPropertyDescriptor"],
    ['const e = Object.entries({ a: 1 });', "Object.entries (not allow-listed)"],
    ['const O = Object; O.keys({});', "Object aliased"],
    ['const k = Object["keys"];', "Object computed member"],
  ] as const) assert.ok(gradedTestSourceProblem(H2 + `test("t", () => { ${body} });\n`, ["./m"], FNS), why);
  assert.equal(gradedTestSourceProblem(H2 + 'test("t", () => { assert.deepEqual(Object.keys(decide({})), ["mode"]); const f = Object.freeze({ a: 1 }); const o = Object.fromEntries([["a", 1]]); });\n', ["./m"], FNS), null, "Object.keys/freeze/fromEntries calls are allowed");
});

test("Round 3 #129 F2-timing: setImmediate, AbortSignal, MessageChannel, WeakRef, FinalizationRegistry and hrtime-style timing are refused", () => {
  for (const [body, why] of [
    ['setImmediate(() => 0);', "setImmediate"],
    ['const s = AbortSignal.timeout(1);', "AbortSignal"],
    ['const c = new MessageChannel();', "MessageChannel"],
    ['const r = new WeakRef({});', "WeakRef"],
    ['const f = new FinalizationRegistry(() => 0);', "FinalizationRegistry"],
    ['const t = process.hrtime.bigint();', "process.hrtime"],
    ['const o: any = {}; o.hrtime();', "hrtime member"],
    ['const o: any = {}; o.now();', "now member"],
    ['const t = performance.timeOrigin;', "performance"],
    ['const a = new SharedArrayBuffer(4); Atomics.wait(new Int32Array(a), 0, 0, 1);', "Atomics/SharedArrayBuffer"],
    ['const c = structuredClone({});', "structuredClone"],
    ['clearTimeout(0);', "any non-allow-listed global"],
  ] as const) assert.ok(gradedTestSourceProblem(H2 + `test("t", () => { ${body} });\n`, ["./m"], FNS), why);
});

test("Round 3 #129: allow-list grammar refuses syntax outside the list", () => {
  for (const [body, why] of [
    ['class X {}', "class"],
    ['label: for (;;) { break label; }', "labels"],
    ['const o: any = {}; delete o.a;', "delete"],
    ['const v = void 0;', "void"],
    ['const g = function* () { yield 1; };', "generator/yield"],
    ['const o = { get a() { return 1; } };', "accessor"],
    ['const o = { m() { return 1; } };', "method"],
    ['debugger;', "debugger"],
  ] as const) assert.ok(gradedTestSourceProblem(H2 + `test("t", () => { ${body} });\n`, ["./m"], FNS), why);
  assert.match(gradedTestSourceProblem(H2 + 'test("t", async () => {\n  const xs: number[] = [1, 2];\n  for (const x of xs) { if (x > 1) { assert.equal(decide({ n: x }).mode, `M${x}`); } }\n  const [a, , b] = [1, 2, 3]; const { c = 1 } = { c: 2 } as { c?: number };\n  try { assert.ok(a < b && c > 0 ? true : false); } catch (e: unknown) { throw e; }\n  assert.throws(() => decide(null as never), /x/); await Promise.resolve; });\n', ["./m"], FNS, moduleDataKeys(MOD)) ?? "", /global Promise|property resolve/, "Promise is not an allowed global");
  assert.equal(gradedTestSourceProblem(H2 + 'test("t", async () => {\n  const xs: number[] = [1, 2];\n  for (const x of xs) { if (x > 1) { assert.equal(decide({ n: x }).mode, `M${x}`); } }\n  const [a, , b] = [1, 2, 3]; const { c = 1 } = { c: 2 } as { c?: number };\n  try { assert.ok(a < b && c > 0 ? true : false); } catch (e: unknown) { throw e; }\n  assert.throws(() => decide(null as never), /x/); });\n', ["./m"], FNS, moduleDataKeys(MOD)), null, "ordinary test syntax passes");
});

test("Round 3 #129 F2: on Node < 22 the stub-body route is ungradable, never graded unconfined", () => {
  const tc = readFileSync(join(repo, "peaceai/bin/test-candidates.ts"), "utf8");
  const g = tc.slice(tc.indexOf("function gradeTest("), tc.indexOf("function stubBefore("));
  assert.match(g, /if \(Number\(process\.versions\.node\.split\("\."\)\[0\]\) < PERMISSION_NODE_MAJOR\) return ungradable\("not-confined"\);/);
  assert.ok(g.indexOf('ungradable("not-confined")') < g.indexOf("runGradedTests("), "checked before any graded run");
  assert.ok(validTestGrading({ fixSha: "a".repeat(40), afterFix: true, beforeFix: null, verdict: "UNGRADABLE", reason: "not-confined" }));
});

test("Round 3 #129: a module that imports repo files is recorded as ungradable 'module-imports-repo-files'", async () => {
  const { moduleImportsRepoFiles } = await import("../lib/learned-function.ts");
  assert.equal(moduleImportsRepoFiles('import { a } from "./contracts";\nexport function f(): number { return a; }\n'), true);
  assert.equal(moduleImportsRepoFiles('export { a } from "../lib/x.ts";\n'), true, "re-export");
  assert.equal(moduleImportsRepoFiles('export async function f() { return import("./x"); }\n'), true, "dynamic import");
  assert.equal(moduleImportsRepoFiles('import type { T } from "./contracts";\nimport { x } from "zod";\nexport function f(): number { return 1; }\n'), false, "type-only and packages");
  const tc = readFileSync(join(repo, "peaceai/bin/test-candidates.ts"), "utf8");
  assert.match(tc, /moduleImportsRepoFiles\(readFileSync\(join\(tree, paths\[0\]!\), "utf8"\)\)\) return ungradable\("module-imports-repo-files"\);/);
  assert.ok(validTestGrading({ fixSha: "a".repeat(40), afterFix: true, beforeFix: null, verdict: "UNGRADABLE", reason: "module-imports-repo-files" }));
});

// ---- Round 4 (Auditor #129 B1/B2)

const DK = moduleDataKeys(MOD);
const P4 = (body: string) => gradedTestSourceProblem(H2 + `test("t", () => { ${body} });\n`, ["./m"], FNS, DK);

test("Round 4 #129 B1: Auditor's exact __lookupGetter__ exploit is refused", () => {
  const exploit = 'const pg = ({} as any).__lookupGetter__("__pro"+"to__"); const OP = pg.call({}); OP.__defineSetter__("x", () => 0);';
  assert.ok(P4(exploit), "the exact exploit");
  for (const h of ["__lookupGetter__", "__lookupSetter__", "__defineGetter__", "__defineSetter__"]) assert.ok(P4(`const o: any = {}; o.${h}("a");`), h);
});

test("Round 4 #129 B1: property names are an allow-list (assert methods, module data keys, listed global members)", () => {
  assert.deepEqual(DK.filter((k) => ["mode", "next", "outcome", "failures"].includes(k)).sort(), ["failures", "mode", "next", "outcome"], "module data keys harvested");
  for (const [body, why] of [
    ['const o: any = {}; o.call();', "call (not a data key)"],
    ['const o: any = {}; o.apply(null, []);', "apply"],
    ['const o: any = {}; o.bind(null);', "bind"],
    ['const o: any = {}; o.whatever;', "unknown key"],
    ['assert.prototype;', "assert member outside the method list"],
    ['assert.AssertionError;', "assert class"],
    ['Math.random();', "Math.random"],
    ['JSON.rawJSON("1");', "JSON member outside the list"],
    ['const o = decide({}); o.next.constructor;', "constructor via a data key"],
    ['const o = { qty: 1 }; assert.equal(o.qty, 1);', "M29: a test-declared key is not allow-listed"],
  ] as const) assert.ok(P4(body), why);
  assert.equal(P4('const r = decide({ outcome: "x", failures: 0 }); assert.equal(r.mode, "DAILY"); assert.deepEqual(Object.keys(r), ["mode", "next"]); const xs = [1, 2].map((x) => x + 1); assert.equal(xs.length, 2); assert.equal(Math.max(1, 2), 2); test.skip;'), null, "ordinary access passes");
  assert.ok(gradedTestSourceProblem(H2 + 'test("t", () => { assert.equal(decide({}).mode, "DAILY"); });\n', ["./m"], FNS), "without the module's keys, its members are not allow-listed");
});

test("Round 4 #129 B1: string constants/concatenations that spell __proto__ (or other forbidden names) are refused; computed keys too", () => {
  for (const [body, why] of [
    ['const k = "__pro" + "to__";', "concatenation"],
    ['const k = ("__p" + "ro") + ("to" + "__");', "nested parens"],
    ['const k = `__pro${"to"}__`;', "template with constant substitution"],
    ['const k = "__proto__";', "plain literal"],
    ['const k = "proto" + "type";', "prototype"],
    ['const k = "constr" + "uctor";', "constructor"],
    ['const k = "__lookup" + "Getter__";', "__lookupGetter__"],
    ['const o: any = {}; const k = "a"; o[k];', "non-constant computed member"],
    ['const o = { ["__pro" + "to__"]: 1 };', "computed object key"],
    ['const o: any = {}; o["mode"];', "string computed member"],
  ] as const) assert.ok(P4(body), why);
  assert.equal(P4('const s = "ab" + "cd"; assert.equal(s, "abcd"); const xs = [1]; assert.equal(xs[0], 1);'), null, "harmless constants and numeric indexes pass");
});

test("Round 4 #129 B2: Error only with new; Buffer only from/alloc", () => {
  for (const [body, why] of [
    ['(Error as any).prepareStackTrace = () => 0;', "Error.prepareStackTrace"],
    ['Error.captureStackTrace({});', "Error.captureStackTrace"],
    ['const E = Error;', "Error aliased"],
    ['const e = Error("x");', "Error called without new"],
    ['TypeError.captureStackTrace({});', "TypeError member"],
    ['const b = Buffer.allocUnsafe(4);', "Buffer.allocUnsafe"],
    ['const b = Buffer.concat([]);', "Buffer.concat"],
    ['const B = Buffer;', "Buffer aliased"],
    ['const p = (Buffer as any).poolSize;', "Buffer member"],
  ] as const) assert.ok(P4(body), why);
  assert.equal(P4('assert.throws(() => { throw new Error("x"); }); const t = new TypeError("y"); const b = Buffer.from("ab"); const z = Buffer.alloc(2); assert.equal(b.length + z.length, 4);'), null, "new Error/TypeError and Buffer.from/alloc pass");
});

test("Round 4 #129: the harness passes the module's data keys to the checker", () => {
  const tc = readFileSync(join(repo, "peaceai/bin/test-candidates.ts"), "utf8");
  assert.match(tc, /const moduleKeys = moduleDataKeys\(real\);/);
  assert.ok(!moduleDataKeys("export const o = { __proto__: null, constructor: 1, a: 2 };\n").some((k) => ["__proto__", "constructor"].includes(k)), "forbidden names never become data keys");
});

test("M29: allowed keys come only from the module; a test-declared key unlocks nothing", () => {
  const DK = moduleDataKeys(MOD);
  for (const body of [
    'const _k = { mock: 0, fn: 0, timers: 0 }; (test as any).mock;',
    'const _k = { mock: 0 }; const o: any = {}; o.mock;',
    'const { mock } = {} as any; const o: any = {}; o.mock;',
  ]) assert.match(gradedTestSourceProblem(H2 + `test("t", () => { ${body} });\n`, ["./m"], FNS, DK) ?? "", /property mock not allow-listed|aliases/, body);
  assert.equal(gradedTestSourceProblem(H2 + 'test("t", () => { assert.equal(decide({}).mode, "DAILY"); });\n', ["./m"], FNS, DK), null, "module keys still work");
});

test("M29: test-context members limited to skip/todo/diagnostic; destructured context refused", () => {
  const DK = moduleDataKeys(MOD);
  for (const m of ["skip", "todo", "diagnostic"])
    assert.equal(gradedTestSourceProblem(H2 + `test("t", (t) => { t.${m}("x"); assert.equal(decide({}).mode, "DAILY"); });\n`, ["./m"], FNS, DK), null, m);
  for (const m of ["mock", "test", "before", "after", "plan", "signal", "runOnly"])
    assert.ok(gradedTestSourceProblem(H2 + `test("t", (t) => { t.${m}; });\n`, ["./m"], FNS, DK), m);
  assert.equal(gradedTestSourceProblem(H2 + 'test("t", ({ mock }) => { });\n', ["./m"], FNS, DK), "destructured test context");
});

test("M29: assert, the runner and the context are never aliased or passed", () => {
  const DK = moduleDataKeys(MOD);
  for (const body of ['const a = assert;', 'const r = test;', 'const c = t;', '[t][0];', 'decide(t as never);', 'const { mock } = test as any;'])
    assert.ok(gradedTestSourceProblem(H2 + `test("t", (t) => { ${body} });\n`, ["./m"], FNS, DK), body);
});
