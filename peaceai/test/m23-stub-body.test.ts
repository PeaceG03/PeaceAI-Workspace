// M23 (Auditor, #127): a learned test whose fix commit CREATED its module is graded against a stubbed body
// when the revert cannot apply on today's file. Fail closed otherwise.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { expectsThrow, importedNames, STUB_BODY_CODE, stubBody } from "../lib/learned-function.ts";
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
    writeFileSync(join(dir, "mod.ts"), stubBody(MOD, "decide")!.content);
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
  assert.match(g, /if \(!runTrusted\(tree, "git", \["apply", "--check"[^\n]*\)\) \{\n[^\n]*\n[^\n]*\n\s+const stubbed = stubBefore\(/, "only when the revert cannot apply");
  assert.match(g, /if \(!stubbed\) return ungradable\("revert-failed"\);/, "fail closed");
  assert.match(g, /writeFileSync\(stubbed\.file, stubbed\.real\);/, "real code restored");
  assert.match(g, /stubFails: !stubPass/);
  const sb = tc.slice(tc.indexOf("function stubBefore("), tc.indexOf("function gradeSelf("));
  for (const re of [/if \(paths\.length !== 1\) return null;/, /--diff-filter=A/, /if \(!added\.split\("\\n"\)\.includes\(path\)\) return null;/, /isSymbolicLink\(\)/, /if \(names\.length !== 1\) return null;/, /if \(fns\.size !== 1\) return null;/, /callsFunction\(t, fn\)/, /stub\.throws && tests\.some\(expectsThrow\)/]) assert.match(sb, re, String(re));
});

test("protected (M23): learned-function.ts and test-candidates.ts stay protected", () => {
  for (const p of ["peaceai/lib/learned-function.ts", "peaceai/bin/test-candidates.ts"]) assert.ok(PROTECTED_SELF.some((x) => x.pattern.test(p)), p);
});
