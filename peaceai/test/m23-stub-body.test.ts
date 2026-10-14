// M23 (Auditor, #127): a learned test whose fix commit CREATED its module is graded against a stubbed body
// when the revert cannot apply on today's file. Fail closed otherwise.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { declaredFunctions, expectsThrow, importedNames, STUB_BODY_CODE, stubAll, stubBody } from "../lib/learned-function.ts";
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
  assert.match(g, /if \(!runTrusted\(tree, "git", \["apply", "--check"[^\n]*\)\) \{\n[^\n]*\n[^\n]*\n[^\n]*\n\s+const stubbed = stubBefore\(/, "only when the revert cannot apply");
  assert.match(g, /if \(!stubbed\) return ungradable\("revert-failed"\);/, "fail closed");
  assert.match(g, /writeFileSync\(stubbed\.file, stubbed\.real\);/, "real code restored");
  assert.match(g, /stubFails: !run\.ok/);
  const sb = tc.slice(tc.indexOf("function stubBefore("), tc.indexOf("function gradeSelf("));
  for (const re of [/if \(paths\.length !== 1\) return null;/, /--diff-filter=A/, /if \(!added\.split\("\\n"\)\.includes\(path\)\) return null;/, /isSymbolicLink\(\)/, /if \(called\.length !== 1\) return null;/, /if \(!a \|\| !b\) return null;/, /if \(fns\.size !== 1\) return null;/, /stub\.throws && tests\.some\(expectsThrow\)/, /declaredFunctions\(git\(repo, "show", `\$\{fixSha\}:\$\{path\}`\)\)/, /if \(!created\.includes\(fn\)\) return null;/, /const stub = stubAll\(real, created, marker\);/]) assert.match(sb, re, String(re));
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

test("Auditor #129 behavior: a stub failure counts only when the stub was reached (random marker in output)", () => {
  const dir = mkdtempSync(join(tmpdir(), "m23-reach-"));
  try {
    const marker = "PEACEAI_STUB_REACHED_0123456789abcdef";
    const run = (testSrc: string) => {
      writeFileSync(join(dir, "m.ts"), stubAll(MOD, ["helper", "decide", "later"], marker)!.content);
      writeFileSync(join(dir, "m.test.ts"), testSrc);
      const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("NODE_TEST")));
      const r = spawnSync(tsx, ["--test", "m.test.ts"], { cwd: dir, encoding: "utf8", env });
      return { ok: r.status === 0, reached: `${r.stdout}\n${r.stderr}`.includes(marker) };
    };
    const head = 'import assert from "node:assert/strict";\nimport test from "node:test";\nimport { decide as d } from "./m.ts";\n';
    assert.deepEqual(run(head + 'test("t", () => { assert.equal(d({ outcome: "refused", failures: 0 }).mode, "ALERT"); });\n'), { ok: false, reached: true }, "stub reached: counts");
    assert.deepEqual(run(head + 'test("t", () => { assert.equal(1, 2); });\n'), { ok: false, reached: false }, "unrelated failure: not attributed to the stub");
    assert.throws(() => stubAll(MOD, ["helper"], "forged marker"), /bad stub marker/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Auditor #129: harness restores the file in finally, records stubbed names, refuses unreached stubs", () => {
  const g = readFileSync(join(repo, "peaceai/bin/test-candidates.ts"), "utf8");
  assert.match(g, /try \{\s*run = runCandidateCapture\(tree, tsx, \["--test", \.\.\.newTests\]\);\s*\} finally \{\s*writeFileSync\(stubbed\.file, stubbed\.real\);/);
  assert.match(g, /ungradable\("stub-not-reached"\), stubbed: stubbed\.stubbed/);
  assert.match(g, /stubFails: !run\.ok, stubbed: stubbed\.stubbed/);
  assert.ok(validTestGrading({ fixSha: "a".repeat(40), afterFix: true, beforeFix: false, verdict: "COUNTS", reason: null, stubFails: true, stubbed: ["decide", "helper"] }));
  assert.ok(!validTestGrading({ fixSha: "a".repeat(40), afterFix: true, beforeFix: false, verdict: "COUNTS", reason: null, stubFails: true, stubbed: ["bad name"] }));
  assert.ok(PROTECTED_SELF.some((p) => p.pattern.test("peaceai/test/m23-stub-body.test.ts")), "this test is protected");
});
