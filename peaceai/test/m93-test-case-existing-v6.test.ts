// M93 TEST_EXISTING v6 target (public-test-case-existing-v6): characterization tests for existing exported functions
// with a parameter whose whole type is `unknown`, or a `NodeJS.ProcessEnv` parameter (optionally `= process.env`, which
// every check must override with an object literal). v1-v5 targets stay with v1-v5 (not_needed). Job B re-checks under
// v6, re-checks the graded test's env arguments (envArgProblem) and stubs with the v2 object-aware stub.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import { admitRules } from "../lib/approved.ts";
import { applyRule, specHash, validateSpec, type RuleSpec } from "../lib/learned.ts";
import { stubAll } from "../lib/learned-function.ts";
import { callsPassEnv, envArgProblem, envDefaultParams, existingTargetAnalysisForEvidence, existingTargetRefusal, TEST_CHECK_REFUSED, TEST_EXISTING_TRIGGER, TEST_EXISTING_VOCAB, TEST_TARGET_IO, TEST_TARGET_SIGNATURE } from "../lib/learned-test-existing.ts";
import { readManifestBytes } from "../lib/manifestparts.ts";
import { phrasingFor } from "../lib/propose.ts";
import { PROTECTED_SELF } from "../lib/selfchange.ts";

const root = resolve(import.meta.dirname, "../..");
const read = (p: string) => readFileSync(resolve(root, p), "utf8");
const SPEC = JSON.parse(read("peaceai/rules/learned/public-test-case-existing-v6.json")) as RuleSpec;
const V1 = JSON.parse(read("peaceai/rules/learned/public-test-case-existing-v1.json")) as RuleSpec;
const V5 = JSON.parse(read("peaceai/rules/learned/public-test-case-existing-v5.json")) as RuleSpec;
const SHA = "256f7b3260433df204c8498773e40c7e0986192c096940dcd44787dc19b0c195";

const A = [
  'export const FLAG_ENV = "FEATURE_X" as const;',
  "export function codeOf(error: unknown): string { const m = error instanceof Error ? error.message : String(error); return /^[A-Z][A-Z0-9_]*/u.exec(m)?.[0] ?? \"UNKNOWN\"; }",
  "export function stable(value: unknown): string { if (value === null || typeof value !== \"object\") return JSON.stringify(value); if (Array.isArray(value)) return `[${value.map(stable).join(\",\")}]`; const r = value as Record<string, unknown>; return `{${Object.keys(r).sort().map((k) => `${JSON.stringify(k)}:${stable(r[k])}`).join(\",\")}}`; }",
  "export function maybe(v?: unknown): boolean { return v === undefined; }",
  "export function enabled(env: NodeJS.ProcessEnv): boolean { return env.FEATURE === \"true\"; }",
  "export function flagOn(env: NodeJS.ProcessEnv = process.env): boolean { return env[FLAG_ENV] === \"true\"; }",
  "export function limitOf(env: NodeJS.ProcessEnv = process.env, fallback = 5): number { const n = Number(env.LIMIT); return Number.isInteger(n) && n > 0 ? n : fallback; }",
  "export function plain(x: number): number { return x + 1; }",
  'export function kindOf(k: typeof FLAG_ENV): string { return k; }',
  // negatives
  "export function anyParam(x: any): string { return String(x); }",
  "export function nestedRecord(x: Record<string, unknown>): number { return Object.keys(x).length; }",
  "export function nestedArray(x: unknown[]): number { return x.length; }",
  "export function unionUnknown(x: unknown | string): string { return String(x); }",
  "export function retUnknown(x: string): unknown { return x; }",
  "export function strDefault(s: string = process.env.X ?? \"\"): string { return s; }",
  "export function spreadDefault(env: NodeJS.ProcessEnv = { ...process.env }): boolean { return env.A === \"1\"; }",
  "export function writesEnv(env: NodeJS.ProcessEnv): boolean { env.SEEN = \"1\"; return true; }",
  "export function deletesEnv(env: NodeJS.ProcessEnv): boolean { delete env.SEEN; return true; }",
  "function helper(env: NodeJS.ProcessEnv = process.env): boolean { return env.H === \"1\"; }",
  "export function viaHelper(x: number): boolean { return x > 0 && helper(); }",
  "export function readsGlobal(env: NodeJS.ProcessEnv): boolean { return env.A === process.env.A; }",
  "export function envArg(env: NodeJS.ProcessEnv<string>): boolean { return true; }",
  "",
].join("\n");
const FILES = [{ path: "src/a.ts", content: A }];
const rd = { read: (rel: string) => FILES.find((f) => f.path === rel)?.content ?? null };
const v5 = { v2: rd, v5: true };
const v6 = { v2: rd, v6: true };
const isTest = (p: string) => /\.test\.ts$/.test(p);
const run = (fn: string, checks: string, spec: RuleSpec = SPEC, files = FILES) => {
  const w: { reason?: string } = {};
  const e = applyRule(spec, `add a characterization test for ${fn} in src/a.ts\n${checks}`, files, isTest, undefined, w, () => false);
  return { e: e as { path: string; content: string } | null, r: w.reason };
};

test("spec: valid, hash pinned, v5 params except the target, the v1 trigger; any listed approval pins the exact hash", () => {
  assert.ok(validateSpec(SPEC));
  assert.equal(specHash(SPEC), SHA);
  assert.equal(SPEC.trigger, TEST_EXISTING_TRIGGER);
  assert.deepEqual(SPEC.params, { ...V1.params, target: "exported-pure-function-v6" });
  assert.deepEqual(V5.params, { ...V1.params, target: "exported-pure-function-v5" }, "v5 is unchanged");
  assert.equal(specHash(V5), "ad677b3667432177ebdc221fe74160bb590e074c5d7768d840119505c9fe5bab", "the v5 hash is unchanged");
  // M97: v7 appends one more target; the v1-v6 entries and their order are unchanged.
  assert.deepEqual([...TEST_EXISTING_VOCAB.target].slice(0, 6), ["exported-pure-function", "exported-pure-function-v2", "exported-pure-function-v3", "exported-pure-function-v4", "exported-pure-function-v5", "exported-pure-function-v6"]);
  assert.ok(!validateSpec({ ...SPEC, params: { ...SPEC.params, target: "exported-pure-function-v8" } }));
  // Lesson (M85/M87/M88/M90/M91): never assert the rule is absent from approved.json; any listed entry must pin this exact hash.
  const onMain = JSON.parse(read("peaceai/rules/approved.json")) as { rules: { id: string; sha256: string }[] };
  for (const r of onMain.rules.filter((x) => x.id === SPEC.id)) assert.equal(r.sha256, SHA, "a listed entry pins the exact spec hash");
  assert.match(phrasingFor(SPEC), /characteri[sz]ation/);
  for (const p of ["peaceai/rules/learned/public-test-case-existing-v6.json", "peaceai/rules/proposals/public-test-case-existing-v6.json", "peaceai/rules/proposals/m93-test-case-existing-v6-evidence.json", "peaceai/test/m93-test-case-existing-v6.test.ts", "peaceai/test/fixtures/m93-te6/x.txt", "peaceai/spec/test-case-existing-v6.md", "peaceai/lib/learned-test-existing.ts", "peaceai/bin/test-candidates.ts"]) assert.ok(PROTECTED_SELF.some((x) => x.pattern.test(p)), p);
  const list = (sha: string) => ({ ok: true as const, list: { schema: "peaceai-approved-rules:v1", rules: [{ id: SPEC.id, sha256: sha, source: "workspace" }] } as never });
  assert.equal(admitRules([SPEC], list(SHA))[0]!.decision, "APPROVED");
  assert.equal(admitRules([SPEC], list("0".repeat(64)))[0]!.decision, "HASH_CHANGED");
});

test("target: top-level unknown and NodeJS.ProcessEnv parameters pass under v6 only; v1-v5 still refuse them", () => {
  for (const fn of ["codeOf", "stable", "maybe", "enabled", "flagOn", "limitOf"]) {
    assert.equal(existingTargetRefusal("src/a.ts", A, fn, v6), null, `v6 ${fn}`);
    assert.notEqual(existingTargetRefusal("src/a.ts", A, fn, v5), null, `v5 ${fn}`);
    assert.notEqual(existingTargetRefusal("src/a.ts", A, fn, { v2: rd, v4: true }), null, `v4 ${fn}`);
    assert.notEqual(existingTargetRefusal("src/a.ts", A, fn, { v2: rd }), null, `v2 ${fn}`);
    assert.notEqual(existingTargetRefusal("src/a.ts", A, fn), null, `v1 ${fn}`);
  }
  for (const fn of ["plain", "kindOf"]) assert.equal(existingTargetRefusal("src/a.ts", A, fn, v6), null, `v6 keeps ${fn}`);
  assert.deepEqual(envDefaultParams(A, "flagOn"), [0]);
  assert.deepEqual(envDefaultParams(A, "limitOf"), [0]);
  assert.deepEqual(envDefaultParams(A, "enabled"), []);
});

test("target negatives under v6: any, nested or returned unknown, other env defaults, env writes, helper defaults, global process, shadowed names", () => {
  for (const fn of ["anyParam", "nestedRecord", "nestedArray", "unionUnknown", "retUnknown", "strDefault", "spreadDefault", "writesEnv", "deletesEnv", "viaHelper", "readsGlobal", "envArg"])
    assert.notEqual(existingTargetRefusal("src/a.ts", A, fn, v6), null, fn);
  // A module-local or imported NodeJS / process name is not the global one.
  const shadowNs = 'import type { NodeJS } from "./types";\nexport function f(env: NodeJS.ProcessEnv): boolean { return env.A === "1"; }\n';
  assert.equal(existingTargetRefusal("src/b.ts", shadowNs, "f", { v2: { read: () => null }, v6: true }), TEST_TARGET_SIGNATURE);
  const shadowProc = 'const process = { env: { A: "1" } };\nexport function f(env: NodeJS.ProcessEnv = process.env): boolean { return env.A === "1"; }\n';
  // A module-local `process` is not the global: its `.env` default is walked like any default (here a pure const),
  // and it is not an env default the checks must override.
  assert.equal(existingTargetRefusal("src/b.ts", shadowProc, "f", { v2: { read: () => null }, v6: true }), null);
  assert.deepEqual(envDefaultParams(shadowProc, "f"), []);
  const shadowProcIo = 'import { process } from "node:process";\nexport function f(env: NodeJS.ProcessEnv = process.env): boolean { return env.A === "1"; }\n';
  assert.equal(existingTargetRefusal("src/b.ts", shadowProcIo, "f", { v2: { read: () => null }, v6: true }), "test_target_io");
  // `process.env` as a default on a non-env type or reached through the global process stays io.
  assert.equal(existingTargetRefusal("src/a.ts", A, "strDefault", v6), "test_target_io");
  assert.equal(existingTargetRefusal("src/a.ts", A, "viaHelper", v6), "test_target_io");
});

test("Job A: v6 targets get one candidate; every check must pass an object literal for a process.env default", () => {
  const c = run("codeOf", '- codeOf("BAD_THING: x") is "BAD_THING"\n- codeOf(42) is "UNKNOWN"');
  assert.ok(c.e, c.r);
  assert.match(c.e!.content, /^import \{ codeOf \} from "\.\/a";$/m);
  const s = run("stable", "- stable([2, 1]) is \"[2,1]\"\n- stable(true) is \"true\"");
  assert.ok(s.e, s.r);
  const e = run("enabled", '- enabled({ FEATURE: "true" }) is true\n- enabled({}) is false');
  assert.ok(e.e, e.r);
  const f = run("flagOn", '- flagOn({ FEATURE_X: "true" }) is true\n- flagOn({ FEATURE_X: "1" }) is false');
  assert.ok(f.e, f.r);
  assert.match(f.e!.content, /flagOn\(\{ FEATURE_X: "true" \}\)/);
  assert.equal(run("flagOn", "- flagOn() is false").r, TEST_CHECK_REFUSED, "omitted env");
  assert.equal(run("flagOn", '- flagOn({ FEATURE_X: "true" }) is true\n- flagOn() is false').r, TEST_CHECK_REFUSED, "one check omits it");
  assert.equal(run("flagOn", "- flagOn(undefined) is false").r, TEST_CHECK_REFUSED, "explicit undefined runs the default");
  assert.equal(run("limitOf", "- limitOf(undefined, 3) is 3").r, TEST_CHECK_REFUSED);
  assert.ok(run("limitOf", '- limitOf({ LIMIT: "7" }) is 7\n- limitOf({}, 3) is 3').e);
  assert.equal(run("plain", "- plain(1) is 2").r, "not_needed", "a v1 target");
  assert.equal(run("kindOf", '- kindOf("FEATURE_X") is "FEATURE_X"').r, "not_needed", "a v5 target");
  assert.equal(run("anyParam", "- anyParam(1) is \"1\"").r, TEST_TARGET_SIGNATURE);
  assert.equal(run("codeOf", '- codeOf("X") is "X"', V5).r, TEST_TARGET_SIGNATURE, "v5 refuses v6 targets by name");
});

test("Job B: envArgProblem checks every call of the function in the graded test source", () => {
  const ok = 'import { flagOn } from "./a";\ntest("t", () => { assert.equal(flagOn({ FEATURE_X: "true" }), true); assert.equal(flagOn({}), false); });\n';
  assert.equal(envArgProblem(A, "flagOn", ok), null);
  assert.equal(envArgProblem(A, "enabled", 'import { enabled } from "./a";\nenabled({});\n'), null, "no default: nothing to check");
  const bad = [
    'import { flagOn } from "./a";\nassert.equal(flagOn(), false);\n',
    'import { flagOn } from "./a";\nassert.equal(flagOn(undefined), false);\n',
    'import { flagOn } from "./a";\nconst e = {};\nassert.equal(flagOn(e), false);\n',
    'import { flagOn } from "./a";\nconst g = flagOn;\nassert.equal(g(), false);\n',
    'import { flagOn } from "./a";\nassert.deepEqual([1].map(() => 0).map(flagOn as never), [false]);\n',
    'import { flagOn } from "./a";\nassert.ok(true);\n',
  ];
  for (const t of bad) assert.equal(envArgProblem(A, "flagOn", t), "env-default-not-overridden", t);
  assert.equal(envArgProblem("export const flagOn = 1;\n", "flagOn", ok), "env-target-unreadable");
  const sf = ts.createSourceFile("t.ts", "f({ A: 1 }, 2); f({}, 3);", ts.ScriptTarget.Latest, true);
  assert.ok(callsPassEnv(sf, "f", [0]));
  assert.ok(!callsPassEnv(sf, "f", [1]));
});

// Auditor #460 (blocking): the exempted `= process.env` default must be unreachable except from the test. These were
// accepted by Job A and the Job B re-check before the fix (envTargetReferenced).
const ENV_REACH: Record<string, { fn: string; check: string; files: { path: string; content: string }[] }> = {
  depthFlag: { fn: "depthFlag", check: "- depthFlag(1, {}) is false", files: [{ path: "src/a.ts", content: 'export function depthFlag(n: number, env: NodeJS.ProcessEnv = process.env): boolean { return n > 0 ? depthFlag(n - 1) : env.PEACE_PROBE === "1"; }\n' }] },
  recursesUndefined: { fn: "f", check: "- f(1, {}) is false", files: [{ path: "src/a.ts", content: 'export function f(n: number, env: NodeJS.ProcessEnv = process.env): boolean { return n > 0 ? f(n - 1, undefined) : env.PEACE_PROBE === "1"; }\n' }] },
  siblingCallsBack: { fn: "f", check: "- f(1, {}) is false", files: [
    { path: "src/a.ts", content: 'import { g } from "./b";\nexport function f(n: number, env: NodeJS.ProcessEnv = process.env): boolean { return n > 0 ? g(n - 1) : env.PEACE_PROBE === "1"; }\n' },
    { path: "src/b.ts", content: 'import { f } from "./a";\nexport function g(n: number): boolean { return f(n); }\n' }] },
  otherExportCalls: { fn: "f", check: "- f(1, {}) is false", files: [{ path: "src/a.ts", content: 'export function h(n: number): boolean { return f(0); }\nexport function f(n: number, env: NodeJS.ProcessEnv = process.env): boolean { return n > 0 ? h(n) : env.PEACE_PROBE === "1"; }\n' }] },
  topLevelCall: { fn: "f", check: "- f(1, {}) is false", files: [{ path: "src/a.ts", content: 'export function f(n: number, env: NodeJS.ProcessEnv = process.env): boolean { return env.PEACE_PROBE === "1"; }\nexport const AT_LOAD = f(0);\n' }] },
  aliased: { fn: "f", check: "- f(1, {}) is false", files: [{ path: "src/a.ts", content: 'export function f(n: number, env: NodeJS.ProcessEnv = process.env): boolean { const g = f; return n > 0 ? g(n - 1) : env.PEACE_PROBE === "1"; }\n' }] },
  namespaceBack: { fn: "f", check: "- f(1, {}) is false", files: [
    { path: "src/a.ts", content: 'import { g } from "./b";\nexport function f(n: number, env: NodeJS.ProcessEnv = process.env): boolean { return n > 0 ? g(n - 1) : env.PEACE_PROBE === "1"; }\n' },
    { path: "src/b.ts", content: 'import * as A from "./a";\nexport function g(n: number): boolean { return A.f(n); }\n' }] },
  closureBack: { fn: "f", check: "- f(1, {}) is false", files: [
    { path: "src/a.ts", content: 'import { g } from "./b";\nexport function f(n: number, env: NodeJS.ProcessEnv = process.env): boolean { return n > 0 ? g(n) : env.PEACE_PROBE === "1"; }\n' },
    { path: "src/b.ts", content: 'import { k } from "./c";\nexport function g(n: number): boolean { return n > 1; }\nexport function unused(): boolean { return k(); }\n' },
    { path: "src/c.ts", content: 'import "./a";\nexport function k(): boolean { return true; }\n' }] },
  shadowedEnv: { fn: "f", check: "- f(1, {}) is false", files: [{ path: "src/a.ts", content: 'export function f(n: number, env: NodeJS.ProcessEnv = process.env): boolean { const g = (env?: NodeJS.ProcessEnv): boolean => f(0, env); return n > 0 ? g() : env.PEACE_PROBE === "1"; }\n' }] },
  // Auditor #460 2nd review, gap 1: a load-time caller the target never reaches.
  loadTimeCaller: { fn: "flagOf", check: "- flagOf(2, {}) is 2", files: [{ path: "src/a.ts", content: 'function h(): number { if (flagOf(0) === 1) throw new Error("x"); return 1; }\nexport const READY = h();\nexport function flagOf(n: number, env: NodeJS.ProcessEnv = process.env): number { return env.PEACE_PROBE === "1" ? 1 : n; }\n' }] },
  loadTimeIndirect: { fn: "flagOf", check: "- flagOf(2, {}) is 2", files: [{ path: "src/a.ts", content: 'function k(): number { return flagOf(0); }\nfunction h(): number { return k(); }\nexport const READY = h();\nexport function flagOf(n: number, env: NodeJS.ProcessEnv = process.env): number { return env.PEACE_PROBE === "1" ? 1 : n; }\n' }] },
  // gap 2: relative imports that are not one readable .ts module (the walk cannot see them).
  mjsImportBack: { fn: "f", check: "- f(1, {}) is false", files: [
    { path: "src/a.ts", content: 'import "./c.mjs";\nexport function f(n: number, env: NodeJS.ProcessEnv = process.env): boolean { return env.PEACE_PROBE === "1"; }\n' },
    { path: "src/c.mjs", content: 'import { f } from "./a.ts";\nf(0);\n' }] },
  mjsInSibling: { fn: "f", check: "- f(1, {}) is false", files: [
    { path: "src/a.ts", content: 'import { g } from "./b";\nexport function f(n: number, env: NodeJS.ProcessEnv = process.env): boolean { return n > 0 ? g(n) : env.PEACE_PROBE === "1"; }\n' },
    { path: "src/b.ts", content: 'import { k } from "./c.mjs";\nexport function g(n: number): boolean { return n > 1; }\n' },
    { path: "src/c.mjs", content: 'import { f } from "./a.ts";\nexport const k = f(0);\n' }] },
  jsNoTs: { fn: "f", check: "- f(1, {}) is false", files: [
    { path: "src/a.ts", content: 'import "./c.js";\nexport function f(n: number, env: NodeJS.ProcessEnv = process.env): boolean { return env.PEACE_PROBE === "1"; }\n' },
    { path: "src/c.js", content: 'import { f } from "./a.ts";\nf(0);\n' }] },
  requireInSibling: { fn: "f", check: "- f(1, {}) is false", files: [
    { path: "src/a.ts", content: 'import { g } from "./b";\nexport function f(n: number, env: NodeJS.ProcessEnv = process.env): boolean { return n > 0 ? g(n) : env.PEACE_PROBE === "1"; }\n' },
    { path: "src/b.ts", content: 'export function g(n: number): boolean { return n > 1; }\nexport function late(): unknown { return require("./c.cjs"); }\n' }] },
  reassignedParam: { fn: "f", check: "- f(1, {}) is false", files: [{ path: "src/a.ts", content: 'export function f(n: number, env: NodeJS.ProcessEnv = process.env): boolean { if (n > 5) env = {}; return n > 0 ? f(n - 1, env) : env.PEACE_PROBE === "1"; }\n' }] },
};
const ENV_SAFE: Record<string, { fn: string; check: string; files: { path: string; content: string }[] }> = {
  passesOwnEnv: { fn: "f", check: "- f(1, {}) is false", files: [{ path: "src/a.ts", content: 'export function f(n: number, env: NodeJS.ProcessEnv = process.env): boolean { return n > 0 ? f(n - 1, env) : env.PEACE_PROBE === "1"; }\n' }] },
  passesLiteral: { fn: "f", check: "- f(1, {}) is false", files: [{ path: "src/a.ts", content: 'export function f(n: number, env: NodeJS.ProcessEnv = process.env): boolean { return n > 0 ? f(n - 1, {}) : env.PEACE_PROBE === "1"; }\n' }] },
  jsSpecifierToTs: { fn: "f", check: "- f(1, {}) is false", files: [
    { path: "src/a.ts", content: 'import { g } from "./b.js";\nexport function f(n: number, env: NodeJS.ProcessEnv = process.env): boolean { return n > 0 ? g(n) : env.PEACE_PROBE === "1"; }\n' },
    { path: "src/b.ts", content: 'export function g(n: number): boolean { return n > 1; }\n' }] },
  loadTimeUnrelated: { fn: "flagOf", check: "- flagOf(2, {}) is 2", files: [{ path: "src/a.ts", content: 'function h(): number { return 1; }\nexport const READY = h();\nexport function flagOf(n: number, env: NodeJS.ProcessEnv = process.env): number { return env.PEACE_PROBE === "1" ? 1 : n; }\n' }] },
  unreachedCaller: { fn: "f", check: "- f(1, {}) is false", files: [{ path: "src/a.ts", content: 'export function f(n: number, env: NodeJS.ProcessEnv = process.env): boolean { return env.PEACE_PROBE === "1"; }\nexport function report(env: NodeJS.ProcessEnv = process.env): string { return f(1, env) ? "on" : "off"; }\n' }] },
};
test("Auditor #460: a process.env default reachable from anything but the test is refused (Job A and the Job B re-check)", () => {
  for (const [k, c] of Object.entries(ENV_REACH)) {
    const sib = { read: (rel: string) => c.files.find((f) => f.path === rel)?.content ?? null };
    // A namespace import is already refused by the purity walk (test_target_impure); every other case is the new check.
    // Auditor #466 (3rd review): a top-level call (direct or via a load-time caller) is refused first by the fail-closed load allowlist (test_target_impure).
    const want = ["namespaceBack", "topLevelCall", "loadTimeCaller", "loadTimeIndirect"].includes(k) ? "test_target_impure" : TEST_TARGET_IO;
    assert.equal(existingTargetRefusal("src/a.ts", c.files[0]!.content, c.fn, { v2: sib, v6: true }), want, `re-check ${k}`);
    const r = run(c.fn, c.check, SPEC, c.files);
    assert.equal(r.e, null, `Job A ${k}`);
    assert.equal(r.r, want, `Job A reason ${k}`);
  }
  for (const [k, c] of Object.entries(ENV_SAFE)) {
    const sib = { read: (rel: string) => c.files.find((f) => f.path === rel)?.content ?? null };
    // Auditor #466 (3rd review): a load-time call of any user function (here `READY = h()`) is outside the fail-closed
    // load allowlist, so loadTimeUnrelated is now refused (test_target_impure) rather than kept.
    if (k === "loadTimeUnrelated") {
      assert.equal(existingTargetRefusal("src/a.ts", c.files[0]!.content, c.fn, { v2: sib, v6: true }), "test_target_impure", `re-check ${k}`);
      assert.equal(run(c.fn, c.check, SPEC, c.files).e, null, `Job A ${k}`);
      continue;
    }
    assert.equal(existingTargetRefusal("src/a.ts", c.files[0]!.content, c.fn, { v2: sib, v6: true }), null, `re-check ${k}`);
    assert.ok(run(c.fn, c.check, SPEC, c.files).e, `Job A ${k}`);
  }
  // A NodeJS.ProcessEnv parameter without a default is not exempted, so a recursive call without it is a plain call.
  const plainEnv = 'export function f(n: number, env: NodeJS.ProcessEnv): boolean { return n > 0 ? f(n - 1, env) : env.PEACE_PROBE === "1"; }\n';
  assert.equal(existingTargetRefusal("src/a.ts", plainEnv, "f", { v2: { read: (rel: string) => (rel === "src/a.ts" ? plainEnv : null) }, v6: true }), null);
});

test("stub and Job B wiring: v6 candidates are re-checked under v6 (with v2-v5 set), env-checked and stubbed by the v2 object-aware stub", () => {
  const st = stubAll(A, ["flagOn"], true);
  assert.ok(st && !st.throws && /export function flagOn\(env: NodeJS\.ProcessEnv = process\.env\): boolean \{ __peaceaiStubRan\(\);/.test(st.content));
  const tc = read("peaceai/bin/test-candidates.ts");
  assert.match(tc, /function gradeExisting\([^)]*v2 = false, v3 = false, v4 = false, v5 = false, v6 = false(?:, v7 = false)?\): TestGrading/);
  assert.match(tc, /existing-v5@"\) \|\| candidate\.operationId\.startsWith\("learned:public-test-case-existing-v6@"\)(?: \|\| candidate\.operationId\.startsWith\("learned:public-test-case-existing-v7@"\))?\), typeof candidate\.operationId === "string" && \(?candidate\.operationId\.startsWith\("learned:public-test-case-existing-v6@"\)/);
  assert.match(tc, /dates: v3, v4, v5, v6(?:, v7)? \} : \{ load: \{ read: \(rel\) => \(scope\.isSource\(rel\) && !scope\.isTest\(rel\) \? regular\(rel\) : null\) \} \}\) !== null\) return ungradable\("not-test-only"\);\n  if \(v6 && envArgProblem\(real, fn, test\) !== null\) return ungradable\("not-test-only"\);/);
  assert.match(tc, /stubAll\(real, \[fn\], v2\)/);
});

// ---- mined evidence ----
type Pin = { path: string; fileBlob: string; sha256: string; fixture: string; repo: string; commit: string };
type Ex = Pin & { module: string; fn: string; signature: string; v1Refusal: string; v2Refusal: string; v3Refusal: string; v4Refusal: string; v5Refusal: string; siblings: Pin[]; license: string; licenseSha256: string };
const EV = JSON.parse(read("peaceai/rules/proposals/m93-test-case-existing-v6-evidence.json")) as { bar: number; manifestSha256: string; examples: Ex[]; peace: { repo: string; checkedAt: string; counted: number }[] };
const gitBlob = (b: Buffer) => createHash("sha1").update(`blob ${b.length}\0`).update(b).digest("hex");
const pinned = (p: { fixture: string; fileBlob: string; sha256: string }) => {
  const b = readFileSync(resolve(root, p.fixture));
  assert.ok(b.length <= 65536, p.fixture);
  assert.equal(gitBlob(b), p.fileBlob, p.fixture);
  assert.equal(createHash("sha256").update(b).digest("hex"), p.sha256, p.fixture);
  return b.toString("utf8");
};
test("evidence: bar met; every module and sibling blob-pinned; v1-v5 refuse and v6 accepts each on the pinned text", () => {
  assert.ok(EV.examples.length >= EV.bar && EV.bar >= 10);
  assert.equal(new Set(EV.examples.map((e) => `${e.repo}\0${e.module}\0${e.fn}`)).size, EV.examples.length);
  const perRepo = new Map<string, number>();
  for (const e of EV.examples) perRepo.set(e.repo, (perRepo.get(e.repo) ?? 0) + 1);
  assert.ok([...perRepo.values()].every((n) => n <= 3), "at most 3 per repo");
  let env = 0, unk = 0;
  for (const e of EV.examples) {
    const text = pinned(e);
    const sibs = new Map(e.siblings.map((s) => [s.path, pinned(s)]));
    const rd = { read: (rel: string) => sibs.get(rel) ?? null };
    assert.equal(existingTargetAnalysisForEvidence(e.module, text, e.fn), e.v1Refusal, `${e.repo} ${e.fn} v1`);
    assert.equal(existingTargetAnalysisForEvidence(e.module, text, e.fn, { v2: rd }), e.v2Refusal, `${e.repo} ${e.fn} v2`);
    assert.equal(existingTargetAnalysisForEvidence(e.module, text, e.fn, { v2: rd, dates: true }), e.v3Refusal, `${e.repo} ${e.fn} v3`);
    assert.equal(existingTargetAnalysisForEvidence(e.module, text, e.fn, { v2: rd, v4: true }), e.v4Refusal, `${e.repo} ${e.fn} v4`);
    assert.equal(existingTargetAnalysisForEvidence(e.module, text, e.fn, { v2: rd, v5: true }), e.v5Refusal, `${e.repo} ${e.fn} v5`);
    for (const r of [e.v1Refusal, e.v2Refusal, e.v3Refusal, e.v4Refusal, e.v5Refusal]) assert.notEqual(r, null);
    assert.equal(existingTargetAnalysisForEvidence(e.module, text, e.fn, { v2: rd, v6: true }), null, `${e.repo} ${e.fn} v6`);
    // v6 differs from v5 only by top-level unknown / NodeJS.ProcessEnv parameters: the signature shows one.
    assert.match(e.signature, /\bunknown\b|NodeJS\.ProcessEnv/, e.fn);
    if (/NodeJS\.ProcessEnv/.test(e.signature)) env++; else unk++;
  }
  assert.ok(env >= 5 && unk >= 5, "both widenings are evidenced");
});
test("evidence: licenses by hash in THIRD_PARTY_NOTICES; fixtures dir holds exactly the evidence fixtures", () => {
  const notices = read("THIRD_PARTY_NOTICES");
  const listed = new Set<string>();
  for (const e of EV.examples) {
    assert.ok(["MIT", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "ISC"].includes(e.license), e.repo);
    assert.ok(notices.includes(`repo: ${e.repo}\nlicense: ${e.license} (`) && notices.includes(`sha256 of trimmed text ${e.licenseSha256})`), e.repo);
    for (const p of [e, ...e.siblings]) { assert.ok(notices.includes(` ${p.fixture}\n`), p.fixture); listed.add(p.fixture.split("/").pop()!); }
  }
  const have = readdirSync(resolve(root, "peaceai/test/fixtures/m93-te6"));
  for (const f of have) assert.ok(listed.has(f), f);
  assert.equal(have.length, listed.size);
});
test("evidence: no overlap with the training corpus or the ext-manifest; Peace's repos checked first and not counted", () => {
  const buf = readManifestBytes(resolve(root, "peaceai/model"), "ext-manifest");
  assert.equal(createHash("sha256").update(buf).digest("hex"), EV.manifestSha256);
  const repos = new Set<string>(); const shas = new Set<string>();
  for (const l of buf.toString("utf8").split("\n")) if (l.trim()) { const r = JSON.parse(l) as { repo?: string; sha256?: string }; if (r.repo) repos.add(r.repo); if (r.sha256) shas.add(r.sha256); }
  for (const r of (JSON.parse(read("peaceai/model/ext-corpus.json")) as { repos: { name: string }[] }).repos) repos.add(r.name);
  for (const e of EV.examples) { assert.ok(!repos.has(e.repo), e.repo); for (const p of [e, ...e.siblings]) assert.ok(!shas.has(p.sha256), p.fixture); assert.ok(!e.repo.startsWith("PeaceG03/")); }
  for (const p of EV.peace) { assert.ok(repos.has(p.repo)); assert.equal(p.counted, 0); assert.match(p.checkedAt, /^[0-9a-f]{40}$/); }
  const rec = JSON.parse(read("peaceai/rules/proposals/public-test-case-existing-v6.json")) as { status: string; evidence: { examples: number; repos: number; bar: number; qualifies: boolean } };
  assert.match(rec.status, /^proposal-off/);
  assert.equal(rec.evidence.examples, EV.examples.length);
  assert.equal(rec.evidence.repos, new Set(EV.examples.map((e) => e.repo)).size);
  assert.ok(rec.evidence.qualifies && rec.evidence.examples >= rec.evidence.bar);
  assert.deepEqual(SPEC.evidence.repos, [...new Set(EV.examples.map((e) => e.repo))].sort());
});
