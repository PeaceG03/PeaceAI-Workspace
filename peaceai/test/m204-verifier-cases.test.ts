// M204 (batch 40) verifier-v1: fail-closed case extraction, careful matcher widening, and a THIRD uid for the verdict.
// Spec: peaceai/spec/verifier-v1.md ("M204"). EXPERIMENTAL, opt-in (VERDICT_MODE oop-v1), NOT the default.
//   1. extraction: admitted on two non-PeaceSTOCKS shapes (node:test + node:assert/strict; vitest / @jest/globals
//      expect); refused near misses for every unsupported matcher / test form; a mixed test is refused, never
//      partially extracted; the Batch 39 silent-skip shape now refuses (and did not, under the Batch 39 extractor);
//   2. soundness on the harness report: inexact values (NaN, -0, undefined property, class instance, hole), async
//      returns, load / lookup errors, truncated messages and toBe-on-objects are never credited;
//   3. three uids: the judge runs as PEACEAI_VERIFIER_UID (M204_VERIFIER, here peaceai-verify); a verifier uid equal to
//      the candidate, the runner or root (or unset / missing) is refused; the candidate (peaceai-cand3) cannot write
//      the harness, the judge, their sources, the spec or the verdict directory (write attempts fail as that uid);
//   4. mutation: every m204-guard line of verifier.ts / verifier-harness.cjs / verifier-judge.cjs / loop.ts deleted in
//      a copy, and a case of that guard fails on the copy (and passes on an unmutated copy).
// Fixtures are synthetic (ranges, words, probes): nothing is modelled on PeaceSTOCKS, a dev task or a reference diff.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir, userInfo } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import * as V from "../lib/verifier.ts";
import { STAGE2_CAND_ENV, stage2CandUid, type CandUid } from "../lib/selfpropose.ts";

type VT = typeof V;
const libDir = join(import.meta.dirname, "../lib");
const specPath = join(import.meta.dirname, "../spec/verifier-v1.md");
const tsPath = createRequire(join(libDir, "verifier.ts")).resolve("typescript");
const CAND = process.env.M204_CAND ?? process.env.M146_CAND ?? "";
const VERIFIER = process.env.M204_VERIFIER ?? process.env.PEACEAI_VERIFIER_UID ?? "";
const cu = stage2CandUid({ [STAGE2_CAND_ENV]: CAND });
const cand: CandUid | null = cu.ok ? cu.cand : null;
const vOk = cand !== null && V.verifierUid({ [V.VERIFIER_UID_ENV]: VERIFIER }, cand).ok;
const skipE2e = !(cand && vOk) && "needs the stage-2 candidate uid (M204_CAND / M146_CAND = peaceai-cand3) and a third verifier uid (M204_VERIFIER / PEACEAI_VERIFIER_UID = peaceai-verify)";
const env = { ...process.env, [STAGE2_CAND_ENV]: CAND, [V.VERIFIER_UID_ENV]: VERIFIER };

const base = mkdtempSync(join(tmpdir(), "peaceai-m204-"));
after(() => {
  if (cand) for (const p of candPids(cand.uid)) spawnSync("sudo", ["-n", "kill", "-KILL", String(p)], { stdio: "ignore" });
  spawnSync("sudo", ["-n", "rm", "-rf", "--", base], { stdio: "ignore" });
  rmSync(base, { recursive: true, force: true });
});
const candPids = (uid: number) => (spawnSync("ps", ["-e", "-o", "pid=,uid="], { encoding: "utf8" }).stdout ?? "").split("\n")
  .map((l) => l.trim().split(/\s+/).map(Number)).filter((x) => x.length === 2 && x[1] === uid && x[0]! > 0).map(([p]) => p!);
let n = 0;
function fixture(files: Record<string, string>): string {
  const d = join(base, `fx-${n++}`);
  for (const [f, t] of Object.entries(files)) { mkdirSync(join(d, f, ".."), { recursive: true }); writeFileSync(join(d, f), t); }
  return d;
}

// ---- shapes (synthetic)
const RANGE_OK = `export function clamp(n, lo, hi) {
  if (lo > hi) throw new RangeError("lo above hi");
  return n < lo ? lo : n > hi ? hi : n;
}
export function span(xs) {
  if (!Array.isArray(xs) || xs.length === 0) throw new TypeError("empty input");
  let min = xs[0], max = xs[0];
  for (const x of xs) { if (x < min) min = x; if (x > max) max = x; }
  return { min, max };
}
`;
const RANGE_BUG = RANGE_OK.replace("n > hi ? hi : n", "n");
const RANGE_UNDEF = RANGE_OK.replace("return { min, max };", "return { min, max, note: undefined };");
const SHAPE_ASSERT = `import { test } from "node:test";
import assert from "node:assert/strict";
import { clamp, span } from "../src/range.mjs";

test("clamp keeps a value inside the range", () => {
  assert.strictEqual(clamp(5, 0, 3), 3);
  assert.strictEqual(clamp(-2, 0, 3), 0);
  assert.notStrictEqual(clamp(2, 0, 3), 3);
  assert.throws(() => clamp(1, 5, 0), RangeError);
  assert.doesNotThrow(() => clamp(0, 0, 0));
});
test("span reports the extremes", () => {
  assert.deepStrictEqual(span([4, 1, 9]), { min: 1, max: 9 });
  assert.throws(() => span([]), { name: "TypeError", message: /empty/ });
});
`;
const WORDS_OK = `"use strict";
function words(s) {
  if (typeof s !== "string") throw new TypeError("expected a string");
  return s.split(/\\s+/).filter(Boolean);
}
exports.words = words;
exports.count = (s) => words(s).length;
exports.stats = (s) => { const w = words(s); return { n: w.length, longest: w.reduce((a, b) => (b.length > a.length ? b : a), "") }; };
`;
const WORDS_BUG = WORDS_OK.replace(".filter(Boolean)", "");
const SHAPE_EXPECT = `import { describe, it, expect } from "vitest";
import * as w from "../src/words.cjs";

describe("words", () => {
  it("splits on runs of space", () => {
    expect(w.words("a  b")).toEqual(["a", "b"]);
    expect(w.count("a b c")).toBe(3);
    expect(w.count("")).not.toBe(1);
    expect(() => w.words(42)).toThrow(TypeError);
    expect(() => w.words(null)).toThrow("expected a string");
    expect(() => w.count("x")).not.toThrow();
  });
  it("reports the longest word", () => expect(w.stats("a bb")).toStrictEqual({ n: 2, longest: "bb" }));
});
`;
const SHAPE_JEST = `const { expect, test } = require("@jest/globals");
const { words: split } = require("../src/words.cjs");

test("splits", () => {
  expect(split(" x y ")).toStrictEqual(["x", "y"]);
  expect(() => split(7)).toThrowError(/string/);
});
`;

// ---- 1. extraction
test("M204 admit: node:test + node:assert/strict shape (strictEqual, notStrictEqual, deepStrictEqual, throws class / object, doesNotThrow)", () => {
  const { result: r, stats } = V.extractCasesWithStats(SHAPE_ASSERT, "test/range.test.mjs");
  assert.ok(r.ok, JSON.stringify(r));
  assert.equal(r.moduleHint, "../src/range.mjs");
  assert.deepEqual(stats, { tests: 2, assertionsSeen: 7, extracted: 7, supported: 7, refusals: [] });
  assert.deepEqual(r.cases.map((c) => c.expect), [
    { ok: true, value: 3, cmp: "is" }, { ok: true, value: 0, cmp: "is" }, { ok: true, value: 3, negate: true },
    { ok: false, error: { isa: "RangeError" } }, { ok: true, any: true },
    { ok: true, value: { min: 1, max: 9 }, cmp: "deep" }, { ok: false, error: { name: "TypeError", message: { re: "empty", flags: "" } } },
  ]);
  assert.deepEqual(r.cases.map((c) => c.id), ["c1:clamp", "c2:clamp", "c3:clamp", "c4:clamp", "c5:clamp", "c6:span", "c7:span"]);
});

test("M204 admit: vitest expect shape (toEqual, toBe, not.toBe, toThrow class / text, not.toThrow, toStrictEqual) and @jest/globals require shape", () => {
  const { result: r, stats } = V.extractCasesWithStats(SHAPE_EXPECT, "test/words.test.ts");
  assert.ok(r.ok, JSON.stringify(r));
  assert.deepEqual([stats.tests, stats.assertionsSeen, stats.extracted], [2, 7, 7]);
  assert.ok(r.cases.every((c) => c.recv === "module"), "ns.fn() calls carry the module receiver");
  assert.deepEqual(r.cases[4]!.expect, { ok: false, error: { includes: "expected a string" } });
  const j = V.extractCasesWithStats(SHAPE_JEST, "test/split.test.js");
  assert.ok(j.result.ok, JSON.stringify(j.result));
  assert.deepEqual(j.result.cases.map((c) => [c.fn, c.recv ?? null]), [["words", null], ["words", null]], "the export name, not the local alias");
  assert.deepEqual(j.result.cases[1]!.expect, { ok: false, error: { message: { re: "string", flags: "" } } });
});

test("M204 fixture is faithful: the node:test shape passes under the real runner on the honest module and fails on the bug", () => {
  for (const [mod, want] of [[RANGE_OK, 0], [RANGE_BUG, 1], [RANGE_UNDEF, 1]] as const) {
    const d = fixture({ "src/range.mjs": mod, "test/range.test.mjs": SHAPE_ASSERT });
    const r = spawnSync(process.execPath, ["--test", "test/range.test.mjs"], { cwd: d, encoding: "utf8", env: { PATH: process.env.PATH } });
    assert.equal(r.status === 0 ? 0 : 1, want, r.stdout);
  }
});

const VT_ = (body: string, imports = "") => `import { test, expect } from "vitest";\nimport { f } from "../src/m.js";\n${imports}test("t", () => {\n  expect(f(0)).toBe(0);\n${body}\n});\n`;
const AT_ = (body: string, assertFrom = "node:assert/strict") => `import { test } from "node:test";\nimport assert from "${assertFrom}";\nimport { f } from "../src/m.js";\ntest("t", () => {\n  assert.strictEqual(f(0), 0);\n${body}\n});\n`;
const NEAR: readonly [string, string, string, string][] = [
  // [label, source, code, detail]: every unsupported matcher refused by name
  ["toContain", VT_("  expect(f(1)).toContain(1);"), "OOP_CASES_UNSUPPORTED_ASSERT", "toContain"],
  ["toMatchObject", VT_("  expect(f(1)).toMatchObject({ a: 1 });"), "OOP_CASES_UNSUPPORTED_ASSERT", "toMatchObject"],
  ["toBeCloseTo", VT_("  expect(f(1)).toBeCloseTo(0.3);"), "OOP_CASES_UNSUPPORTED_ASSERT", "toBeCloseTo"],
  ["toBeTruthy", VT_("  expect(f(1)).toBeTruthy();"), "OOP_CASES_UNSUPPORTED_ASSERT", "toBeTruthy"],
  ["toBeNull", VT_("  expect(f(1)).toBeNull();"), "OOP_CASES_UNSUPPORTED_ASSERT", "toBeNull"],
  ["toHaveLength", VT_("  expect(f(1)).toHaveLength(2);"), "OOP_CASES_UNSUPPORTED_ASSERT", "toHaveLength"],
  ["not.toEqual", VT_("  expect(f(1)).not.toEqual([1]);"), "OOP_CASES_UNSUPPORTED_ASSERT", "not.toEqual"],
  ["not.toStrictEqual", VT_("  expect(f(1)).not.toStrictEqual([1]);"), "OOP_CASES_UNSUPPORTED_ASSERT", "not.toStrictEqual"],
  ["resolves", VT_("  expect(f(1)).resolves.toBe(1);"), "OOP_CASES_UNSUPPORTED_ASSERT", "resolves.toBe"],
  ["await resolves", VT_("  await expect(f(1)).resolves.toBe(1);"), "OOP_CASES_UNSUPPORTED_ASSERT", "await:resolves.toBe"],
  ["rejects", VT_("  expect(f(1)).rejects.toThrow();"), "OOP_CASES_UNSUPPORTED_ASSERT", "rejects.toThrow"],
  ["toBe on an object", VT_("  expect(f(1)).toBe({ a: 1 });"), "OOP_CASES_UNSUPPORTED_ASSERT", "toBe:object"],
  ["not.toBe on an array", VT_("  expect(f(1)).not.toBe([1]);"), "OOP_CASES_UNSUPPORTED_ASSERT", "not.toBe:object"],
  ["toThrow(variable)", VT_("  expect(() => f(1)).toThrow(Oops);"), "OOP_CASES_UNSUPPORTED_ASSERT", "toThrow:arg"],
  ["toThrow(custom class)", VT_("  expect(() => f(1)).toThrow(AbortError);"), "OOP_CASES_UNSUPPORTED_ASSERT", "toThrow:arg"],
  ["toThrowErrorMatchingSnapshot", VT_("  expect(() => f(1)).toThrowErrorMatchingSnapshot();"), "OOP_CASES_UNSUPPORTED_ASSERT", "toThrowErrorMatchingSnapshot"],
  ["toMatchSnapshot", VT_("  expect(f(1)).toMatchSnapshot();"), "OOP_CASES_UNSUPPORTED_ASSERT", "toMatchSnapshot"],
  ["expect.soft", VT_("  expect.soft(f(1)).toBe(1);"), "OOP_CASES_UNSUPPORTED_ASSERT", "expect.soft.toBe"],
  ["expect.assertions", VT_("  expect.assertions(1);"), "OOP_CASES_UNSUPPORTED_ASSERT", "expect.assertions"],
  ["bare expect", VT_("  expect(f(1));"), "OOP_CASES_UNSUPPORTED_ASSERT", "expect"],
  ["assert.ok", AT_("  assert.ok(f(1));"), "OOP_CASES_UNSUPPORTED_ASSERT", "assert.ok"],
  ["assert()", AT_("  assert(f(1));"), "OOP_CASES_UNSUPPORTED_ASSERT", "assert.assert"],
  ["assert.match", AT_("  assert.match(f(1), /x/);"), "OOP_CASES_UNSUPPORTED_ASSERT", "assert.match"],
  ["assert.notDeepStrictEqual", AT_("  assert.notDeepStrictEqual(f(1), [1]);"), "OOP_CASES_UNSUPPORTED_ASSERT", "assert.notDeepStrictEqual"],
  ["assert.rejects", AT_("  assert.rejects(() => f(1));"), "OOP_CASES_UNSUPPORTED_ASSERT", "assert.rejects"],
  ["strictEqual on an object", AT_("  assert.strictEqual(f(1), { a: 1 });"), "OOP_CASES_UNSUPPORTED_ASSERT", "strictEqual:object"],
  ["notStrictEqual on an array", AT_("  assert.notStrictEqual(f(1), [1]);"), "OOP_CASES_UNSUPPORTED_ASSERT", "notStrictEqual:object"],
  ["throws(regexp)", AT_("  assert.throws(() => f(1), /bad/);"), "OOP_CASES_UNSUPPORTED_ASSERT", "throws:regexp"],
  ["throws(string)", AT_("  assert.throws(() => f(1), \"bad\");"), "OOP_CASES_UNSUPPORTED_ASSERT", "throws:string"],
  ["throws(validator)", AT_("  assert.throws(() => f(1), (e) => e instanceof Error);"), "OOP_CASES_UNSUPPORTED_ASSERT", "throws:validator"],
  ["throws({ code })", AT_("  assert.throws(() => f(1), { code: \"E_BAD\" });"), "OOP_CASES_UNSUPPORTED_ASSERT", "throws:object-key"],
  ["throws({})", AT_("  assert.throws(() => f(1), {});"), "OOP_CASES_UNSUPPORTED_ASSERT", "throws:object-empty"],
  ["legacy assert.equal", AT_("  assert.equal(f(1), 1);", "node:assert"), "OOP_CASES_UNSUPPORTED_ASSERT", "equal:loose"],
  ["legacy assert.deepEqual", AT_("  assert.deepEqual(f(1), [1]);", "assert"), "OOP_CASES_UNSUPPORTED_ASSERT", "deepEqual:loose"],
  // test forms
  ["test.skip", VT_("") + `test.skip("s", () => expect(f(1)).toBe(1));\n`, "OOP_CASES_UNSUPPORTED_TEST", "test-modifier:skip"],
  ["test.each non-literal table", VT_("") + `const rows = [[1]];\ntest.each(rows)("e", (x) => expect(f(x)).toBe(1));\n`, "OOP_CASES_UNSUPPORTED_TEST", "test-modifier:each"],
  ["hook", VT_("", "import { beforeEach } from \"vitest\";\n") + `beforeEach(() => {});\n`, "OOP_CASES_UNSUPPORTED_TEST", "hook:beforeEach"],
  ["test params", `import { test } from "node:test";\nimport assert from "node:assert/strict";\nimport { f } from "../src/m.js";\ntest("t", (t) => { assert.strictEqual(f(1), 1); });\n`, "OOP_CASES_UNSUPPORTED_TEST", "test-params"],
  ["test options", `import { test } from "node:test";\nimport assert from "node:assert/strict";\nimport { f } from "../src/m.js";\ntest("t", { timeout: 5 }, () => { assert.strictEqual(f(1), 1); });\n`, "OOP_CASES_UNSUPPORTED_TEST", "test-shape"],
  ["statement in a test", VT_("  const y = f(1);"), "OOP_CASES_UNSUPPORTED_TEST", "stmt:var"],
  ["loop in a test", VT_("  for (const x of [1]) expect(f(x)).toBe(1);"), "OOP_CASES_UNSUPPORTED_TEST", "stmt:loop"],
  ["mock call", VT_("  vi.useFakeTimers();", "import { vi } from \"vitest\";\n"), "OOP_CASES_UNSUPPORTED_TEST", "stmt:expr"],
  ["top-level code", VT_("") + "if (process.env.X) process.exit(1);\n", "OOP_CASES_UNSUPPORTED_TEST", "top-level:if"],
  ["top-level let", VT_("") + "let y = 2;\n", "OOP_CASES_UNSUPPORTED_TEST", "top-level:var"],
  ["used other import", VT_("  expect(other(1)).toBe(1);", "import { other } from \"lodash\";\n"), "OOP_CASES_NONLITERAL", "expect-nonliteral"],
  ["side-effect import", VT_("", "import \"./setup.js\";\n"), "OOP_CASES_UNSUPPORTED_TEST", "side-effect-import"],
  ["two target modules", VT_("  expect(g(1)).toBe(1);", "import { g } from \"../src/n.js\";\n"), "OOP_CASES_UNSUPPORTED_TEST", "multi-module"],
  ["used helper as a bare call", VT_("  h(1);", "import { h } from \"./helpers.js\";\n"), "OOP_CASES_UNSUPPORTED_TEST", "stmt:expr"],
  ["no assertion", VT_("") + `test("empty", () => {});\n`, "OOP_CASES_NO_ASSERT", "test"],
  // literals / calls
  ["non-literal argument", VT_("  expect(f(Date.now())).toBe(1);"), "OOP_CASES_NONLITERAL", "expect-nonliteral"],
  ["literal -0", VT_("  expect(f(1)).toBe(-0);"), "OOP_CASES_NONLITERAL", "expect-nonliteral"],
  ["__proto__ key", VT_("  expect(f(1)).toEqual({ __proto__: { a: 1 } });"), "OOP_CASES_NONLITERAL", "expect-nonliteral"],
  ["global function", VT_("  expect(parseInt(\"1\")).toBe(1);"), "OOP_CASES_NONLITERAL", "expect-nonliteral"],
  ["default import", `import { test, expect } from "vitest";\nimport m from "../src/m.js";\ntest("t", () => expect(m(1)).toBe(1));\n`, "OOP_CASES_NONLITERAL", "expect-nonliteral"],
  ["async thunk", VT_("  expect(async () => f(1)).toThrow();"), "OOP_CASES_NONLITERAL", "toThrow-nonliteral"],
  ["optional call", VT_("  expect(f?.(1)).toBe(1);"), "OOP_CASES_NONLITERAL", "expect-nonliteral"],
];
test("M204 refuse: every unsupported matcher / test form / literal is refused by name (no silent skip)", () => {
  for (const [label, src, code, detail] of NEAR) {
    const { result: r, stats } = V.extractCasesWithStats(src, "test/m.test.ts");
    assert.equal(r.ok, false, `${label}: admitted`);
    if (r.ok) continue;
    assert.deepEqual([r.code, r.detail], [code, detail], `${label}: ${JSON.stringify(stats.refusals)}`);
    assert.equal(stats.extracted, 0, `${label}: nothing extracted from a refused file`);
    assert.ok(stats.refusals.every((x) => /^[A-Z_]+:[A-Za-z0-9_.:-]{1,60}$/.test(x)), `${label}: details are fixed words`);
  }
});

test("M204 mixed: one supported + one unsupported assertion in the same test is refused, not partially extracted", () => {
  const src = `import { test } from "node:test";\nimport assert from "node:assert/strict";\nimport { clamp } from "../src/range.mjs";\ntest("t", () => {\n  assert.strictEqual(clamp(5, 0, 3), 3);\n  assert.ok(clamp(1, 0, 3) > 0);\n});\n`;
  const { result: r, stats } = V.extractCasesWithStats(src, "t.mjs");
  assert.deepEqual(r, { ok: false, code: "OOP_CASES_UNSUPPORTED_ASSERT", detail: "assert.ok" });
  assert.deepEqual([stats.assertionsSeen, stats.supported, stats.extracted], [2, 1, 0]);
  const v = `import { it, expect } from "vitest";\nimport { clamp } from "../src/range.mjs";\nit("t", () => {\n  expect(clamp(5, 0, 3)).toBe(3);\n  expect(clamp(5, 0, 3)).toBeGreaterThan(2);\n});\n`;
  assert.deepEqual(V.extractCasesFromSource(v, "t.ts"), { ok: false, code: "OOP_CASES_UNSUPPORTED_ASSERT", detail: "toBeGreaterThan" });
  // message text never reaches a detail
  const msg = V.extractCasesFromSource(`import { it, expect } from "vitest";\nimport { clamp } from "../src/range.mjs";\nit("t", () => expect(clamp(1, 0, 3))["secret message here"](1));\n`, "t.ts");
  assert.equal(msg.ok, false);
  if (!msg.ok) assert.ok(!String(msg.detail).includes("secret"), String(msg.detail));
});

// The Batch 39 silent-skip shape: toStrictEqual / assert.ok next to admitted asserts were dropped without a word.
const SILENT = `import { test } from "node:test";
import assert from "node:assert/strict";
import { expect } from "vitest";
import { clamp, span } from "../src/range.mjs";
test("a", () => assert.strictEqual(clamp(5, 0, 3), 3));
test("b", () => { expect(span([2, 1])).toStrictEqual({ min: 1, max: 2 }); assert.ok(clamp(0, 0, 1) === 0); });
`;
test("M204 regression: the Batch 39 silent-skip shape now refuses (the Batch 39 extractor admitted it with cases dropped)", async () => {
  const { result: r, stats } = V.extractCasesWithStats(SILENT, "t.mjs");
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.code, "OOP_CASES_UNSUPPORTED_ASSERT");
  assert.deepEqual([stats.tests, stats.assertionsSeen, stats.extracted], [2, 3, 0]);
  // the old extractor, from the Batch 39 head (skipped only if that commit is not in this clone)
  const old = spawnSync("git", ["show", "550357a:peaceai/lib/verifier.ts"], { cwd: libDir, encoding: "utf8" });
  if (old.status !== 0) return;
  const f = join(base, "b39-verifier.ts");
  writeFileSync(f, rewriteV(old.stdout));
  const O = await import(pathToFileURL(f).href);
  const o = O.extractCasesFromSource(SILENT, "t.mjs");
  assert.equal(o.ok, true, "the Batch 39 extractor admitted the shape");
  assert.ok(o.cases.length < stats.assertionsSeen, "with assertions silently dropped");
});

// ---- 2. soundness of the report (pure: harness helpers + judge)
const H = createRequire(import.meta.url)(join(libDir, "verifier-harness.cjs"));
test("M204 exact: only plain JSON data is exact; JSON's losses are flagged, never credited", () => {
  class Pt { x = 1; }
  const holey = [1, , 3]; // eslint-disable-line no-sparse-arrays
  const arr = [1, 2] as unknown as { extra?: number }; arr.extra = 1;
  for (const [v, exact] of [
    [null, true], [1, true], ["s", true], [true, true], [{ a: [1, { b: "c" }] }, true], [[], true],
    [NaN, false], [Infinity, false], [-0, false], [undefined, false], [1n, false], [() => 1, false], [Symbol("s"), false],
    [{ a: undefined }, false], [new Pt(), false], [Object.create(null), false], [new Map(), false], [new Date(0), false],
    [holey, false], [arr, false], [{ [Symbol("k")]: 1 }, false], [{ get a() { return 1; } }, false], [Object.defineProperty({}, "h", { value: 1, enumerable: false }), false],
  ] as const) assert.equal(H.isExact(v), exact, typeof v === "symbol" || typeof v === "bigint" ? typeof v : String(JSON.stringify(v) ?? typeof v));
  let deep: any = 1; for (let i = 0; i < 40; i++) deep = [deep];
  assert.equal(H.isExact(deep), false, "over the depth bound");
  assert.deepEqual(H.replyValue(NaN), { value: null, exact: false });
  const e = H.serializeErr(new Error("y".repeat(2100)));
  assert.deepEqual([e.trunc, e.message.length, e.obj, e.isa], [true, 2000, true, ["Error"]]);
  assert.deepEqual(H.serializeErr("plain"), { name: "Error", message: "plain", obj: false, nameStr: false, msgStr: false, trunc: false, isa: [] });
});

const okR = (value: unknown, o: Record<string, unknown> = {}) => ({ ok: true, id: 1, resultOk: true, value, exact: true, sync: true, ...o }) as never;
const errR = (error: Record<string, unknown>, where = "call") => ({ ok: true, id: 1, resultOk: false, where, error: { name: "Error", message: "", obj: true, nameStr: true, msgStr: true, trunc: false, isa: ["Error"], ...error } }) as never;
test("M204 judge: each admitted matcher's semantics on the harness report", () => {
  const E = V.expectHolds;
  // toBe / strictEqual: Object.is on a primitive, synchronous, exact
  assert.equal(E(okR(3), { ok: true, value: 3, cmp: "is" }), true);
  assert.equal(E(okR(3, { sync: false }), { ok: true, value: 3, cmp: "is" }), false, "a promise is not a value");
  assert.equal(E(okR(null, { exact: false }), { ok: true, value: null, cmp: "is" }), false, "NaN / undefined arrive as null, inexact");
  assert.equal(E(okR({ a: 1 }), { ok: true, value: { a: 1 }, cmp: "is" }), false, "=== on a fresh object never holds");
  assert.equal(E(okR({ a: 1 }), { ok: true, value: { a: 1 } }), true);
  assert.equal(E(okR({ a: 1 }, { exact: false }), { ok: true, value: { a: 1 }, cmp: "deep" }), false, "an undefined property / class instance is not toStrictEqual");
  // not.toBe / notStrictEqual
  assert.equal(E(okR(2), { ok: true, value: 3, negate: true }), true);
  assert.equal(E(okR(3), { ok: true, value: 3, negate: true }), false);
  assert.equal(E(okR(null, { exact: false }), { ok: true, value: null, negate: true }), true, "an inexact value is never the literal");
  assert.equal(E(okR({ a: 1 }), { ok: true, value: { a: 1 }, negate: true }), false, "negation on an object is refused");
  // doesNotThrow / not.toThrow
  assert.equal(E(okR(null, { exact: false }), { ok: true, any: true }), true);
  assert.equal(E(errR({}), { ok: true, any: true }), false);
  // throws
  assert.equal(E(errR({}), { ok: false }), true);
  assert.equal(E(errR({}, "load"), { ok: false }), false, "a module that fails to load is not a throwing call");
  assert.equal(E(errR({}, "lookup"), { ok: false }), false, "a missing export is not a throwing call");
  assert.equal(E(errR({}, "await"), { ok: false }), false, "a rejected promise is not a synchronous throw");
  assert.equal(E(errR({ isa: ["Error", "RangeError"] }), { ok: false, error: { isa: "RangeError" } }), true);
  assert.equal(E(errR({ isa: ["Error", "TypeError"] }), { ok: false, error: { isa: "RangeError" } }), false);
  assert.equal(E(errR({ name: "TypeError" }), { ok: false, error: { name: "TypeError" } }), true);
  assert.equal(E(errR({ name: "TypeError", nameStr: false }), { ok: false, error: { name: "TypeError" } }), false);
  assert.equal(E(errR({ message: "empty input" }), { ok: false, error: { message: { re: "empty", flags: "" } } }), true);
  assert.equal(E(errR({ message: "empty input", trunc: true }), { ok: false, error: { message: { re: "empty", flags: "" } } }), false, "a truncated message is not matched");
  assert.equal(E(errR({ message: "boom", obj: false, msgStr: false }), { ok: false, error: { includes: "boom" } }), false, "a thrown string has no message");
  assert.equal(E(errR({ message: "expected a string" }), { ok: false, error: { includes: "a string" } }), true);
});

// ---- 3 + e2e: verify() as three uids
const EDGE = `export const nan = () => NaN;
export const negz = () => -0;
export const undef = () => ({ a: 1, b: undefined });
class Pt { constructor() { this.x = 1; } }
export const inst = () => new Pt();
export const holes = () => [1, , 3];
export const later = async () => 3;
export const big = () => { throw new Error("x".repeat(2500) + "END"); };
export const str = () => { throw "bad input"; };
export function self() { return this === undefined; }
export const pick = () => "named";
export default { pick: () => "default" };
`;
test("M204 e2e: both shapes admitted; honest modules pass, bugs fail; the verdict comes from the third uid", { skip: skipE2e }, () => {
  for (const [shape, file, mod, modName, okSrc, bugs] of [
    ["assert", "test/range.test.mjs", "src/range.mjs", "range", RANGE_OK, [RANGE_BUG, RANGE_UNDEF]],
    ["expect", "test/words.test.ts", "src/words.cjs", "words", WORDS_OK, [WORDS_BUG]],
  ] as const) {
    const ex = V.extractCasesFromSource(shape === "assert" ? SHAPE_ASSERT : SHAPE_EXPECT, file);
    assert.ok(ex.ok, modName);
    const run = (src: string) => V.verify({ root: fixture({ [mod]: src }), module: mod, cases: ex.cases, env, callMs: 10_000, sessionMs: 120_000 });
    const good = run(okSrc);
    assert.equal(good.code, "OOP_OK", JSON.stringify(good));
    assert.deepEqual([good.pass, good.fail], [ex.cases.length, 0], `${modName}: ${JSON.stringify(good.results)}`);
    for (const b of bugs) {
      const r = run(b);
      assert.equal(r.code, "OOP_OK");
      assert.ok((r.fail ?? 0) > 0, `${modName}: a bug was credited`);
    }
  }
  const undef = V.verify({ root: fixture({ "src/range.mjs": RANGE_UNDEF }), module: "src/range.mjs", cases: [{ id: "u", fn: "span", args: [[4, 1, 9]], expect: { ok: true, value: { min: 1, max: 9 }, cmp: "deep" } }], env });
  assert.deepEqual(undef.results, [{ id: "u", pass: false, reason: "inexact" }], "an undefined property is not deepStrictEqual (and its lossy copy is no evidence)");
});

test("M204 e2e soundness: inexact, async, load / lookup failures, truncation, thrown strings and export shadowing are never credited", { skip: skipE2e }, () => {
  const root = fixture({ "src/edge.mjs": EDGE, "src/boom.mjs": "throw new TypeError('at load');\nexport const f = () => 1;\n" });
  const C = (id: string, fn: string, expect: V.CaseExpect, recv?: "module"): V.DataCase => ({ id, fn, args: [], expect, ...(recv ? { recv } : {}) });
  const r = V.verify({ root, module: "src/edge.mjs", env, cases: [
    C("nan", "nan", { ok: true, value: null }), C("negz", "negz", { ok: true, value: 0, cmp: "is" }), C("undef", "undef", { ok: true, value: { a: 1 } }),
    C("inst", "inst", { ok: true, value: { x: 1 } }), C("holes", "holes", { ok: true, value: [1, null, 3] }), C("later", "later", { ok: true, value: 3, cmp: "is" }),
    C("big", "big", { ok: false, error: { message: { re: "END$", flags: "" } } }), C("str", "str", { ok: false, error: { includes: "bad" } }),
    C("missing", "nope", { ok: false }), C("self", "self", { ok: true, value: true, cmp: "is" }), C("pick", "pick", { ok: true, value: "named", cmp: "is" }),
    C("big-any", "big", { ok: false }),
  ] });
  assert.equal(r.code, "OOP_OK", JSON.stringify(r));
  const by = Object.fromEntries((r.results ?? []).map((x) => [x.id, x.pass ? "pass" : (x as { reason: string }).reason]));
  assert.deepEqual(by, { nan: "inexact", negz: "inexact", undef: "inexact", inst: "inexact", holes: "inexact", later: "async", big: "error", str: "error", missing: "error", self: "pass", pick: "pass", "big-any": "pass" });
  const load = V.verify({ root, module: "src/boom.mjs", env, cases: [C("t", "f", { ok: false }), C("t2", "f", { ok: false, error: { isa: "TypeError" } })] });
  assert.equal(load.code, "OOP_OK");
  assert.equal(load.pass, 0, "a module that throws at load does not satisfy toThrow");
});

test("M204 third uid: unset / bad / missing / root / runner / candidate verifier uids are refused (fail-closed)", { skip: !cand && "needs the stage-2 candidate uid" }, () => {
  const c = cand!;
  const me = userInfo().username;
  for (const [name, code, detail] of [
    [undefined, "OOP_VERIFIER_REQUIRED", "unset"], ["", "OOP_VERIFIER_REQUIRED", "unset"], ["Bad Name", "OOP_VERIFIER_BAD", "name"],
    ["peaceai-no-such-uid", "OOP_VERIFIER_BAD", "missing"], ["root", "OOP_VERIFIER_NOT_SEPARATE", "root"],
    [me, "OOP_VERIFIER_NOT_SEPARATE", "runner"], [c.name, "OOP_VERIFIER_NOT_SEPARATE", "cand"],
  ] as const) {
    const r = V.verifierUid({ [V.VERIFIER_UID_ENV]: name }, c);
    assert.deepEqual(r, { ok: false, code, detail }, String(name));
  }
  // and verify() refuses before any candidate process runs
  const root = fixture({ "src/range.mjs": RANGE_OK });
  const cases: V.DataCase[] = [{ id: "a", fn: "clamp", args: [5, 0, 3], expect: { ok: true, value: 3, cmp: "is" } }];
  for (const [name, code] of [[undefined, "OOP_VERIFIER_REQUIRED"], [c.name, "OOP_VERIFIER_NOT_SEPARATE"], [me, "OOP_VERIFIER_NOT_SEPARATE"]] as const) {
    const r = V.verify({ root, module: "src/range.mjs", cases, env: { ...env, [V.VERIFIER_UID_ENV]: name } });
    assert.equal(r.code, code, String(name));
    assert.equal(r.results, undefined);
  }
  if (vOk) assert.equal(V.verifierUid({ [V.VERIFIER_UID_ENV]: VERIFIER }, c).ok, true, "the configured third uid is accepted");
});

const PROBE = `"use strict";
const fs = require("node:fs");
exports.probe = (paths) => {
  const out = {};
  const attempt = (k, f) => { try { f(); out[k] = "WROTE"; } catch (e) { out[k] = String(e && e.code || "ERR"); } };
  attempt("harness", () => fs.appendFileSync("harness.cjs", "//x"));
  attempt("judge", () => fs.appendFileSync("judge.cjs", "//x"));
  attempt("verdict-file", () => fs.writeFileSync("verdict/verdict.json", "{\\"code\\":\\"OOP_OK\\"}", { flag: "wx" }));
  attempt("verdict-dir", () => fs.chmodSync("verdict", 0o777));
  attempt("work", () => fs.writeFileSync("planted.json", "{}"));
  for (const [k, p] of Object.entries(paths)) attempt(k, () => fs.appendFileSync(p, ""));
  return out;
};
`;
test("M204 third uid: the candidate cannot write the harness, the judge, their sources, the spec or the verdict directory", { skip: skipE2e }, () => {
  const c = cand!;
  const srcs = { "harness-src": join(libDir, "verifier-harness.cjs"), "judge-src": join(libDir, "verifier-judge.cjs"), "lib-src": join(libDir, "verifier.ts"), spec: specPath };
  // as the candidate uid, directly
  for (const [k, p] of Object.entries(srcs)) {
    const before = readFileSync(p);
    const w = spawnSync("sudo", ["-n", "-u", c.name, "--", "sh", "-c", 'printf x >> "$1"', "sh", p], { encoding: "utf8" });
    assert.notEqual(w.status, 0, `${k}: written as ${c.name}`);
    assert.deepEqual(readFileSync(p), before, `${k}: changed`);
    assert.notEqual(statSync(p).uid, c.uid, `${k}: owned by ${c.name}`);
  }
  // from inside a candidate call (cwd = the verifier's work dir, which holds harness.cjs, judge.cjs and verdict/)
  const r = V.verify({ root: fixture({ "src/probe.cjs": PROBE }), module: "src/probe.cjs", env, cases: [{ id: "probe", fn: "probe", args: [srcs], expect: { ok: true, value: {
    harness: "EACCES", judge: "EACCES", "verdict-file": "EACCES", "verdict-dir": "EPERM", work: "EACCES",
    "harness-src": "EACCES", "judge-src": "EACCES", "lib-src": "EACCES", spec: "EACCES",
  } } }] });
  assert.equal(r.code, "OOP_OK", JSON.stringify(r));
  assert.deepEqual(r.results, [{ id: "probe", pass: true }], JSON.stringify(r.results));
  // the permission model the runner checks, on files of each kind
  const d = join(base, "perm"); mkdirSync(d, { recursive: true });
  const gids = new Set((spawnSync("id", ["-G", c.name], { encoding: "utf8" }).stdout ?? "").trim().split(/\s+/).map(Number));
  const mk = (f: string, mode: number) => { const p = join(d, f); writeFileSync(p, ""); chmodSync(p, mode); return p; };
  assert.equal(V.candMayWrite(mk("plain", 0o644), c, gids), false);
  assert.equal(V.candMayWrite(mk("other", 0o646), c, gids), true);
  const grp = mk("group", 0o664); assert.equal(spawnSync("sudo", ["-n", "chgrp", String([...gids][0]), grp]).status, 0);
  assert.equal(V.candMayWrite(grp, c, gids), true);
  const own = mk("owned", 0o644); assert.equal(spawnSync("sudo", ["-n", "chown", c.name, own]).status, 0);
  assert.equal(V.candMayWrite(own, c, gids), true);
  assert.equal(V.candMayWrite(join(d, "absent"), c, gids), true, "unknown is treated as writable");
});

// ---- 4. mutation: each m204-guard line deleted in a copy; a case of that guard fails on the copy
function rewriteV(t: string): string {
  return t.replace(/from "\.\/([a-z0-9-]+\.ts)"/g, (_m, f: string) => `from ${JSON.stringify(pathToFileURL(join(libDir, f)).href)}`)
    .replace(/from "typescript"/g, `from ${JSON.stringify(pathToFileURL(tsPath).href)}`);
}
interface Mods { V: VT; H: { isExact(v: unknown): boolean; serializeErr(e: unknown): { trunc: boolean } }; J: { expectHolds: VT["expectHolds"] } }
const SRC = { verifier: readFileSync(join(libDir, "verifier.ts"), "utf8"), harness: readFileSync(join(libDir, "verifier-harness.cjs"), "utf8"), judge: readFileSync(join(libDir, "verifier-judge.cjs"), "utf8"), loop: readFileSync(join(libDir, "loop.ts"), "utf8") };
async function variant(o: { verifier?: string; harness?: string; judge?: string; specMode?: number } = {}): Promise<Mods> {
  const d = join(base, `var-${n++}`);
  mkdirSync(join(d, "lib"), { recursive: true }); mkdirSync(join(d, "spec"), { recursive: true });
  writeFileSync(join(d, "lib/verifier.ts"), rewriteV(o.verifier ?? SRC.verifier));
  writeFileSync(join(d, "lib/verifier-harness.cjs"), o.harness ?? SRC.harness);
  writeFileSync(join(d, "lib/verifier-judge.cjs"), o.judge ?? SRC.judge);
  copyFileSync(specPath, join(d, "spec/verifier-v1.md"));
  chmodSync(join(d, "spec/verifier-v1.md"), o.specMode ?? 0o644);
  const req = createRequire(join(d, "lib/x.js"));
  return { V: (await import(pathToFileURL(join(d, "lib/verifier.ts")).href)) as VT, H: req("./verifier-harness.cjs"), J: req("./verifier-judge.cjs") };
}
const tagsOf = (t: string) => t.split("\n").flatMap((l) => { const m = /\/\/ m204-guard:([a-z0-9-]+)/.exec(l); return m ? [m[1]!] : []; });
const drop = (text: string, tag: string) => {
  const ls = text.split("\n"), hit = (l: string) => new RegExp(`// m204-guard:${tag}(?![a-z0-9-])`).test(l);
  assert.equal(ls.filter(hit).length, 1, `one line holds ${tag}`);
  return ls.filter((l) => !hit(l)).join("\n");
};
const X = (m: Mods, src: string) => m.V.extractCasesFromSource(src, "t.ts");
const refusedAs = (r: ReturnType<VT["extractCasesFromSource"]>, code: string, detail?: string) => {
  assert.equal(r.ok, false, "admitted");
  if (!r.ok) { assert.equal(r.code, code); if (detail !== undefined) assert.equal(r.detail, detail); }
};
const e2eOnly = () => { if (skipE2e) throw new Error("e2e guard case needs cand3 + verifier uid"); };
const SPAN_CASE: V.DataCase[] = [{ id: "s", fn: "span", args: [[2, 1]], expect: { ok: true, value: { min: 1, max: 2 }, cmp: "deep" } }];
const GUARD: Record<string, { file: keyof typeof SRC; e2e?: true; run(m: Mods): void | Promise<void> }> = {
  // extractor (verifier.ts)
  "lit-neg-zero": { file: "verifier", run: (m) => refusedAs(X(m, VT_("  expect(f(1)).toBe(-0);")), "OOP_CASES_NONLITERAL") },
  "lit-proto": { file: "verifier", run: (m) => refusedAs(X(m, VT_("  expect(f(1)).toEqual({ __proto__: { a: 1 } });")), "OOP_CASES_NONLITERAL") },
  "test-modifier": { file: "verifier", run: (m) => refusedAs(X(m, VT_("") + `test.only("s", () => expect(f(1)).toBe(1));\n`), "OOP_CASES_UNSUPPORTED_TEST", "test-modifier:only") },
  "hook": { file: "verifier", run: (m) => refusedAs(X(m, VT_("", "import { afterAll } from \"vitest\";\n") + "afterAll(() => {});\n"), "OOP_CASES_UNSUPPORTED_TEST", "hook:afterAll") },
  "test-shape": { file: "verifier", run: (m) => refusedAs(X(m, VT_("") + "const body = 1;\ntest(\"s\", body);\n"), "OOP_CASES_UNSUPPORTED_TEST", "test-shape") },
  "test-params": { file: "verifier", run: (m) => refusedAs(X(m, `import { it, expect } from "vitest";\nimport { f } from "../src/m.js";\nit("t", (done) => { expect(f(1)).toBe(1); });\n`), "OOP_CASES_UNSUPPORTED_TEST", "test-params") },
  "top-level": { file: "verifier", run: (m) => refusedAs(X(m, VT_("") + "while (false) {}\n"), "OOP_CASES_UNSUPPORTED_TEST", "top-level:loop") },
  "target-binding": { file: "verifier", run: (m) => refusedAs(X(m, VT_("  expect(Number(\"1\")).toBe(1);")), "OOP_CASES_NONLITERAL") },
  "thunk-async": { file: "verifier", run: (m) => refusedAs(X(m, VT_("  expect(async () => f(1)).toThrow();")), "OOP_CASES_NONLITERAL") },
  "loose-equal": { file: "verifier", run: (m) => refusedAs(X(m, AT_("  assert.equal(f(1), 1);", "node:assert")), "OOP_CASES_UNSUPPORTED_ASSERT", "equal:loose") },
  "is-object": { file: "verifier", run: (m) => refusedAs(X(m, AT_("  assert.strictEqual(f(1), [1]);")), "OOP_CASES_UNSUPPORTED_ASSERT", "strictEqual:object") },
  "throws-arg": { file: "verifier", run: (m) => refusedAs(X(m, AT_("  assert.throws(() => f(1), /x/);")), "OOP_CASES_UNSUPPORTED_ASSERT", "throws:regexp") },
  "tobe-object": { file: "verifier", run: (m) => refusedAs(X(m, VT_("  expect(f(1)).toBe([1]);")), "OOP_CASES_UNSUPPORTED_ASSERT", "toBe:object") },
  "tothrow-arg": { file: "verifier", run: (m) => refusedAs(X(m, VT_("  expect(() => f(1)).toThrow(err);")), "OOP_CASES_UNSUPPORTED_ASSERT", "toThrow:arg") },
  "unsupported-matcher": { file: "verifier", run: (m) => refusedAs(X(m, VT_("  expect(f(1)).toBeDefined();")), "OOP_CASES_UNSUPPORTED_ASSERT", "toBeDefined") },
  "test-stmt": { file: "verifier", run: (m) => refusedAs(X(m, VT_("  console.log(1);")), "OOP_CASES_UNSUPPORTED_TEST", "stmt:expr") },
  "no-assert": { file: "verifier", run: (m) => refusedAs(X(m, VT_("") + "test(\"e\", () => {});\n"), "OOP_CASES_NO_ASSERT") },
  "multi-module": { file: "verifier", run: (m) => refusedAs(X(m, VT_("  expect(g(1)).toBe(1);", "import { g } from \"../src/other.js\";\n")), "OOP_CASES_UNSUPPORTED_TEST", "multi-module") },
  // third uid + permissions (verifier.ts)
  "verifier-required": { file: "verifier", run: (m) => assert.deepEqual(m.V.verifierUid({}, cand ?? { name: "x", uid: 1 }), { ok: false, code: "OOP_VERIFIER_REQUIRED", detail: "unset" }) },
  "verifier-root": { file: "verifier", e2e: true, run: (m) => assert.deepEqual(m.V.verifierUid({ [V.VERIFIER_UID_ENV]: "root" }, cand!), { ok: false, code: "OOP_VERIFIER_NOT_SEPARATE", detail: "root" }) },
  "verifier-vs-runner": { file: "verifier", e2e: true, run: (m) => assert.deepEqual(m.V.verifierUid({ [V.VERIFIER_UID_ENV]: userInfo().username }, cand!), { ok: false, code: "OOP_VERIFIER_NOT_SEPARATE", detail: "runner" }) },
  "verifier-vs-cand": { file: "verifier", e2e: true, run: (m) => assert.deepEqual(m.V.verifierUid({ [V.VERIFIER_UID_ENV]: cand!.name }, cand!), { ok: false, code: "OOP_VERIFIER_NOT_SEPARATE", detail: "cand" }) },
  "perm-owner": { file: "verifier", e2e: true, run: (m) => {
    const p = join(base, `po-${n++}`); writeFileSync(p, ""); chmodSync(p, 0o644);
    assert.equal(spawnSync("sudo", ["-n", "chown", cand!.name, p]).status, 0);
    assert.equal(m.V.candMayWrite(p, cand!, new Set()), true);
  } },
  "perm-other": { file: "verifier", e2e: true, run: (m) => { const p = join(base, `pw-${n++}`); writeFileSync(p, ""); chmodSync(p, 0o666); assert.equal(m.V.candMayWrite(p, cand!, new Set()), true); } },
  "perm-group": { file: "verifier", e2e: true, run: (m) => { const p = join(base, `pg-${n++}`); writeFileSync(p, ""); chmodSync(p, 0o664); assert.equal(m.V.candMayWrite(p, cand!, new Set([statSync(p).gid])), true); } },
  "perm-check": { file: "verifier", e2e: true, run: async () => {
    // a spec the candidate could write: refused before the candidate runs (the copy's spec is 0666)
    const w = await variant({ verifier: CUR.verifier, specMode: 0o666 });
    const r = w.V.verify({ root: fixture({ "src/range.mjs": RANGE_OK }), module: "src/range.mjs", cases: SPAN_CASE, env });
    assert.deepEqual([r.code, (r as { detail?: string }).detail], ["OOP_VERIFIER_BAD", "cand-writable:spec"]);
  } },
  "verdict-owner": { file: "verifier", e2e: true, run: async () => {
    // a judge whose verdict file others could rewrite is not believed
    const w = await variant({ verifier: CUR.verifier, judge: SRC.judge.replace('process.stdout.write("ok\\n");', 'fs.chmodSync(path.join(out, "verdict.json"), 0o666); process.stdout.write("ok\\n");') });
    const r = w.V.verify({ root: fixture({ "src/range.mjs": RANGE_OK }), module: "src/range.mjs", cases: SPAN_CASE, env });
    assert.deepEqual([r.code, (r as { detail?: string }).detail], ["OOP_JUDGE", "verdict-owner"]);
  } },
  // harness
  "h-number": { file: "harness", run: (m) => { assert.equal(m.H.isExact(1.5), true); assert.equal(m.H.isExact(-0), false); assert.equal(m.H.isExact(NaN), false); } },
  "h-array-proto": { file: "harness", run: (m) => { class L extends Array {} assert.equal(m.H.isExact(L.from([1])), false); } },
  "h-object-proto": { file: "harness", run: (m) => { class Pt { x = 1; } assert.equal(m.H.isExact(new Pt()), false); } },
  "h-symbol": { file: "harness", run: (m) => assert.equal(m.H.isExact({ [Symbol("k")]: 1 }), false) },
  "h-data-prop": { file: "harness", run: (m) => { assert.equal(m.H.isExact({ a: undefined }), false); assert.equal(m.H.isExact({ get a() { return 1; } }), false); } },
  "h-trunc": { file: "harness", run: (m) => assert.equal(m.H.serializeErr(new Error("z".repeat(2001))).trunc, true) },
  "h-async": { file: "harness", e2e: true, run: async () => {
    const w = await variant({ verifier: CUR.verifier, harness: CUR.harness });
    const r = w.V.verify({ root: fixture({ "src/a.mjs": "export const later = async () => 3;\n" }), module: "src/a.mjs", cases: [{ id: "l", fn: "later", args: [], expect: { ok: true, value: 3, cmp: "is" } }], env });
    assert.deepEqual(r.results, [{ id: "l", pass: false, reason: "async" }]);
  } },
  // judge
  "sync": { file: "judge", run: (m) => assert.equal(m.J.expectHolds(okR(3, { sync: false }), { ok: true, value: 3, cmp: "is" }), false) },
  "negate-primitive": { file: "judge", run: (m) => assert.equal(m.J.expectHolds(okR({ a: 1 }), { ok: true, value: { a: 1 }, negate: true }), false) },
  "exact": { file: "judge", run: (m) => assert.equal(m.J.expectHolds(okR(null, { exact: false }), { ok: true, value: null }), false) },
  "cmp-is": { file: "judge", run: (m) => assert.equal(m.J.expectHolds(okR([1]), { ok: true, value: [1], cmp: "is" }), false) },
  "where-call": { file: "judge", run: (m) => assert.equal(m.J.expectHolds(errR({}, "load"), { ok: false }), false) },
  "isa": { file: "judge", run: (m) => assert.equal(m.J.expectHolds(errR({ isa: ["Error"] }), { ok: false, error: { isa: "TypeError" } }), false) },
  "err-name": { file: "judge", run: (m) => assert.equal(m.J.expectHolds(errR({ name: "Error", nameStr: true }), { ok: false, error: { name: "TypeError" } }), false) },
  "err-msg-str": { file: "judge", run: (m) => assert.equal(m.J.expectHolds(errR({ message: "abc", trunc: true }), { ok: false, error: { message: "abc" } }), false) },
};
// the sources the current case runs against (unmutated, or with one line dropped)
let CUR: { verifier: string; harness: string; judge: string } = { verifier: SRC.verifier, harness: SRC.harness, judge: SRC.judge };

test("M204 mutation: every m204-guard tag has a case; each passes unmutated and fails with its line deleted", async () => {
  const all = (["verifier", "harness", "judge"] as const).flatMap((f) => tagsOf(SRC[f]).map((t) => [f, t] as const));
  assert.ok(all.length >= 40, `expected many guards, got ${all.length}`);
  for (const [f, t] of all) {
    const g = GUARD[t];
    assert.ok(g, `no case for m204-guard:${t}`);
    assert.equal(g.file, f, `${t} lives in ${f}`);
  }
  for (const [f, t] of all) {
    const g = GUARD[t]!;
    if (g.e2e && skipE2e) continue;
    CUR = { verifier: SRC.verifier, harness: SRC.harness, judge: SRC.judge };
    await g.run(await variant());
    CUR = { ...CUR, [f]: drop(SRC[f], t) };
    const mut = await variant(CUR);
    let failed = false;
    try { await g.run(mut); } catch { failed = true; }
    assert.ok(failed, `deleting m204-guard:${t} in ${f} was not caught by its own case`);
  }
  CUR = { verifier: SRC.verifier, harness: SRC.harness, judge: SRC.judge };
});

test("M204 loopSha256 binds repair-retry.ts and the verifier files (mutants without each push line do not); near miss: a file outside the loop does not", async () => {
  const lib = ["loop.ts", "looprow.ts", "loopdeps.ts", "editpropose.ts", "modelpropose.ts", "repair-retry.ts", "verifier.ts", "verifier-harness.cjs", "verifier-judge.cjs", "modelscore.ts"];
  const shaOf = async (loopText: string, edit: string | null) => {
    const root = join(base, `sha-${n++}`);
    mkdirSync(join(root, "peaceai/lib"), { recursive: true });
    for (const f of lib) copyFileSync(join(libDir, f), join(root, "peaceai/lib", f));
    const f = join(base, `loop-${n++}.ts`);
    writeFileSync(f, loopText.replace(/from "\.\/([a-z0-9-]+\.ts)"/g, (_m, x: string) => `from ${JSON.stringify(pathToFileURL(join(libDir, x)).href)}`)
      .replace(/from "typescript"/g, `from ${JSON.stringify(pathToFileURL(tsPath).href)}`).replace(/import\.meta\.dirname/g, JSON.stringify(libDir)));
    const L = await import(pathToFileURL(f).href);
    const h0 = L.loopSha256(root);
    if (edit) writeFileSync(join(root, "peaceai/lib", edit), readFileSync(join(root, "peaceai/lib", edit), "utf8") + "\n// changed\n");
    return [h0, L.loopSha256(root)] as const;
  };
  const tags = tagsOf(SRC.loop);
  assert.deepEqual(tags, ["sha-repair-retry", "sha-verifier"]);
  const cases: Record<string, readonly string[]> = { "sha-repair-retry": ["repair-retry.ts"], "sha-verifier": ["verifier.ts", "verifier-harness.cjs", "verifier-judge.cjs"] };
  for (const t of tags) {
    for (const file of cases[t]!) {
      const [a, b] = await shaOf(SRC.loop, file);
      assert.notEqual(a, b, `a changed ${file} kept the same loopSha256`);
      const [c, d] = await shaOf(drop(SRC.loop, t), file);
      assert.equal(c, d, `mutant without ${t}: ${file} still bound`);
    }
  }
  const [x, y] = await shaOf(SRC.loop, "modelscore.ts");
  assert.equal(x, y, "a file outside the loop changes nothing");
  assert.ok(existsSync(join(libDir, "plan4.ts")));
});

test("M204 hygiene: no candidate process outlives the file (checked last)", { skip: !cand && "needs the stage-2 candidate uid" }, () => {
  assert.deepEqual(candPids(cand!.uid), []);
});
