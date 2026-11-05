// M205 (batch 41) verifier-v1: admit more general, common test-file shapes in the fail-closed extractor.
// Spec: peaceai/spec/verifier-v1.md ("M205"). EXPERIMENTAL, opt-in (VERDICT_MODE oop-v1), NOT the default.
// Forms (static extraction only; never evaluates test code):
//   (a) describe/suite nesting — pure grouping; suite names concatenate into case ids;
//   (b) const bindings of JSON literals at top level, in suites, or in test bodies — resolved by value;
//       shadowing and reassignment refused;
//   (c) test.each / it.each with a literal table (array-of-arrays, array-of-primitives, array-of-objects);
//   (d) imports of other modules when unused; relative imports only when they are the module under test.
// Fixtures are synthetic (scores, tokens, probes): nothing modelled on PeaceSTOCKS, a dev task or a reference diff.
// Batch 40 silent-skip regression must still refuse. Every m205-guard line deleted in a copy is caught by its own case.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import * as V from "../lib/verifier.ts";
import { STAGE2_CAND_ENV, stage2CandUid, type CandUid } from "../lib/selfpropose.ts";

type VT = typeof V;
const libDir = join(import.meta.dirname, "../lib");
const tsPath = createRequire(join(libDir, "verifier.ts")).resolve("typescript");
const CAND = process.env.M205_CAND ?? process.env.M204_CAND ?? process.env.M146_CAND ?? "";
const VERIFIER = process.env.M205_VERIFIER ?? process.env.M204_VERIFIER ?? process.env.PEACEAI_VERIFIER_UID ?? "";
const cu = stage2CandUid({ [STAGE2_CAND_ENV]: CAND });
const cand: CandUid | null = cu.ok ? cu.cand : null;
const vOk = cand !== null && V.verifierUid({ [V.VERIFIER_UID_ENV]: VERIFIER }, cand).ok;
const skipE2e = !(cand && vOk) && "needs peaceai-cand3 + PEACEAI_VERIFIER_UID=peaceai-verify";
const env = { ...process.env, [STAGE2_CAND_ENV]: CAND, [V.VERIFIER_UID_ENV]: VERIFIER };

const base = mkdtempSync(join(tmpdir(), "peaceai-m205-"));
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

// ---- synthetic modules (not PeaceSTOCKS / dev / reference)
const SCORE_OK = `export function grade(n) {
  if (typeof n !== "number" || Number.isNaN(n)) throw new TypeError("not a number");
  if (n < 0 || n > 100) throw new RangeError("out of range");
  return n >= 70 ? "pass" : "fail";
}
export function band(n) { return n >= 90 ? "A" : n >= 70 ? "B" : "C"; }
`;
const SCORE_BUG = SCORE_OK.replace('n >= 70 ? "pass"', 'n >= 90 ? "pass"');
const TOKEN_OK = `"use strict";
exports.clip = (s, n) => {
  if (typeof s !== "string") throw new TypeError("want string");
  if (!Number.isInteger(n) || n < 0) throw new RangeError("bad n");
  return s.length <= n ? s : s.slice(0, n);
};
exports.parts = (s, sep) => s.split(sep).filter(Boolean);
`;

// ============================================================================
// (a) describe / suite nesting
// ============================================================================
const NEST_A = `import { describe, it, expect } from "vitest";
import { grade, band } from "../src/score.mjs";

describe("scoring", () => {
  describe("grade", () => {
    it("labels a passing mark", () => {
      expect(grade(80)).toBe("pass");
      expect(grade(10)).toBe("fail");
    });
  });
  describe("band", () => {
    it("picks a letter", () => expect(band(95)).toBe("A"));
  });
});
`;
const NEST_B = `import { suite, test } from "node:test";
import assert from "node:assert/strict";
import { clip } from "../src/token.cjs";

suite("token", () => {
  suite("clip", () => {
    test("keeps a short string", () => {
      assert.strictEqual(clip("ab", 5), "ab");
      assert.strictEqual(clip("abcdef", 3), "abc");
    });
  });
});
`;

test("M205 admit (a): nested describe/suite — grouping only; names concatenate into case ids (vitest shape)", () => {
  const { result: r, stats } = V.extractCasesWithStats(NEST_A, "test/score.test.ts");
  assert.ok(r.ok, JSON.stringify(r));
  assert.deepEqual([stats.tests, stats.assertionsSeen, stats.extracted], [2, 3, 3]);
  assert.deepEqual(r.cases.map((c) => c.id), [
    "scoring/grade/c1:grade", "scoring/grade/c2:grade", "scoring/band/c3:band",
  ]);
  assert.deepEqual(r.cases.map((c) => c.expect), [
    { ok: true, value: "pass", cmp: "is" }, { ok: true, value: "fail", cmp: "is" }, { ok: true, value: "A", cmp: "is" },
  ]);
});

test("M205 admit (a): nested suite — node:test shape (second unrelated admit)", () => {
  const { result: r, stats } = V.extractCasesWithStats(NEST_B, "test/token.test.mjs");
  assert.ok(r.ok, JSON.stringify(r));
  assert.deepEqual([stats.tests, stats.extracted], [1, 2]);
  assert.deepEqual(r.cases.map((c) => c.id), ["token/clip/c1:clip", "token/clip/c2:clip"]);
  assert.equal(r.moduleHint, "../src/token.cjs");
});

// ============================================================================
// (b) const-of-JSON-literal bindings
// ============================================================================
const CONST_TOP = `import { test } from "node:test";
import assert from "node:assert/strict";
import { grade } from "../src/score.mjs";

const PASS = 80;
const FAIL = 10;
const LABEL = "pass";

test("grades from named constants", () => {
  assert.strictEqual(grade(PASS), LABEL);
  assert.strictEqual(grade(FAIL), "fail");
});
`;
const CONST_BODY = `import { describe, it, expect } from "vitest";
import { clip, parts } from "../src/token.cjs";

describe("token consts", () => {
  const LIMIT = 3;
  const SEP = ",";
  it("clips and splits with suite + body consts", () => {
    const sample = "abcdef";
    expect(clip(sample, LIMIT)).toBe("abc");
    const expected = ["a", "b"];
    expect(parts("a,b", SEP)).toEqual(expected);
  });
});
`;

test("M205 admit (b): top-level const JSON bindings resolved by value (node:test shape)", () => {
  const { result: r, stats } = V.extractCasesWithStats(CONST_TOP, "t.mjs");
  assert.ok(r.ok, JSON.stringify(r));
  assert.deepEqual([stats.tests, stats.extracted], [1, 2]);
  assert.deepEqual(r.cases.map((c) => [c.args, c.expect]), [
    [[80], { ok: true, value: "pass", cmp: "is" }],
    [[10], { ok: true, value: "fail", cmp: "is" }],
  ]);
});

test("M205 admit (b): suite + test-body const JSON bindings resolved (vitest shape)", () => {
  const { result: r, stats } = V.extractCasesWithStats(CONST_BODY, "t.ts");
  assert.ok(r.ok, JSON.stringify(r));
  assert.deepEqual([stats.tests, stats.extracted], [1, 2]);
  assert.deepEqual(r.cases.map((c) => c.args), [["abcdef", 3], ["a,b", ","]]);
  assert.deepEqual(r.cases[1]!.expect, { ok: true, value: ["a", "b"], cmp: "deep" });
  assert.ok(r.cases[0]!.id.startsWith("token consts/"));
});

// ============================================================================
// (c) test.each / it.each with a literal table
// ============================================================================
const EACH_AA = `import { test, expect } from "vitest";
import { grade } from "../src/score.mjs";

test.each([
  [80, "pass"],
  [10, "fail"],
  [70, "pass"],
])("grade(%s) -> %s", (n, want) => {
  expect(grade(n)).toBe(want);
});
`;
const EACH_OBJ = `import { it, expect } from "vitest";
import { clip } from "../src/token.cjs";

it.each([
  { s: "hi", n: 5, out: "hi" },
  { s: "hello", n: 2, out: "he" },
])("clips", ({ s, n, out }) => {
  expect(clip(s, n)).toBe(out);
});
`;

test("M205 admit (c): test.each with array-of-arrays literal table (vitest)", () => {
  const { result: r, stats } = V.extractCasesWithStats(EACH_AA, "t.ts");
  assert.ok(r.ok, JSON.stringify(r));
  assert.equal(stats.tests, 1);
  assert.equal(stats.assertionsSeen, 1);
  assert.equal(stats.extracted, 3);
  assert.deepEqual(r.cases.map((c) => [c.id, c.args, c.expect]), [
    ["@0/c1:grade", [80], { ok: true, value: "pass", cmp: "is" }],
    ["@1/c2:grade", [10], { ok: true, value: "fail", cmp: "is" }],
    ["@2/c3:grade", [70], { ok: true, value: "pass", cmp: "is" }],
  ]);
});

test("M205 admit (c): it.each with array-of-objects + destructuring (second unrelated admit)", () => {
  const { result: r, stats } = V.extractCasesWithStats(EACH_OBJ, "t.ts");
  assert.ok(r.ok, JSON.stringify(r));
  assert.deepEqual([stats.assertionsSeen, stats.extracted], [1, 2]);
  assert.deepEqual(r.cases.map((c) => c.args), [["hi", 5], ["hello", 2]]);
  assert.deepEqual(r.cases.map((c) => c.expect), [
    { ok: true, value: "hi", cmp: "is" }, { ok: true, value: "he", cmp: "is" },
  ]);
});

// ============================================================================
// (d) unused imports
// ============================================================================
const UNUSED_PKG = `import { test, expect } from "vitest";
import { inspect } from "node:util";
import { grade } from "../src/score.mjs";

test("grades", () => {
  expect(grade(80)).toBe("pass");
});
`;
const UNUSED_REL = `import { test } from "node:test";
import assert from "node:assert/strict";
import { grade } from "../src/score.mjs";
import { helper } from "./helpers.mjs";

test("grades", () => {
  assert.strictEqual(grade(80), "pass");
});
`;

test("M205 admit (d): unused package import is ignored (vitest)", () => {
  const { result: r, stats } = V.extractCasesWithStats(UNUSED_PKG, "t.ts");
  assert.ok(r.ok, JSON.stringify({ r, stats }));
  assert.equal(stats.extracted, 1);
  assert.equal(r.moduleHint, "../src/score.mjs");
});

test("M205 admit (d): unused relative import is ignored; used relative is the module under test", () => {
  const { result: r } = V.extractCasesWithStats(UNUSED_REL, "t.mjs");
  assert.ok(r.ok, JSON.stringify(r));
  assert.equal(r.moduleHint, "../src/score.mjs");
  // and a file whose only relative import is the target still admits
  const only = V.extractCasesWithStats(`import { test } from "node:test";
import assert from "node:assert/strict";
import { grade } from "../src/score.mjs";
test("g", () => assert.strictEqual(grade(80), "pass"));
`, "t.mjs");
  assert.ok(only.result.ok);
  assert.equal(only.result.moduleHint, "../src/score.mjs");
});

// ============================================================================
// Refused near misses (one or more per new condition)
// ============================================================================
const NEAR: readonly [string, string, string, string][] = [
  // suite / describe
  ["describe.each", `import { describe, it, expect } from "vitest";\nimport { grade } from "../src/score.mjs";\ndescribe.each([[1]])("s", (n) => { it("t", () => expect(grade(n)).toBe("pass")); });\n`, "OOP_CASES_UNSUPPORTED_TEST", "test-modifier:each"],
  ["suite with params", `import { suite, test } from "node:test";\nimport assert from "node:assert/strict";\nimport { grade } from "../src/score.mjs";\nsuite("s", (t) => { test("t", () => assert.strictEqual(grade(1), "fail")); });\n`, "OOP_CASES_UNSUPPORTED_TEST", "suite-params"],
  // const bindings
  ["const shadow top", `import { test } from "node:test";\nimport assert from "node:assert/strict";\nimport { grade } from "../src/score.mjs";\nconst X = 1;\nconst X = 2;\ntest("t", () => assert.strictEqual(grade(X), "fail"));\n`, "OOP_CASES_UNSUPPORTED_TEST", "top-level:const-shadow"],
  ["const shadow in test", `import { test, expect } from "vitest";\nimport { grade } from "../src/score.mjs";\nconst X = 1;\ntest("t", () => { const X = 2; expect(grade(X)).toBe("fail"); });\n`, "OOP_CASES_UNSUPPORTED_TEST", "stmt:const-shadow"],
  ["const reassign", `import { test, expect } from "vitest";\nimport { grade } from "../src/score.mjs";\nconst X = 1;\ntest("t", () => { X = 2; expect(grade(X)).toBe("fail"); });\n`, "OOP_CASES_UNSUPPORTED_TEST", "stmt:const-reassign"],
  ["let binding", `import { test, expect } from "vitest";\nimport { grade } from "../src/score.mjs";\ntest("t", () => { let X = 1; expect(grade(X)).toBe("fail"); });\n`, "OOP_CASES_UNSUPPORTED_TEST", "stmt:var"],
  ["const non-literal", `import { test, expect } from "vitest";\nimport { grade } from "../src/score.mjs";\ntest("t", () => { const X = grade(1); expect(X).toBe("fail"); });\n`, "OOP_CASES_UNSUPPORTED_TEST", "stmt:var"],
  ["const destructure", `import { test, expect } from "vitest";\nimport { grade } from "../src/score.mjs";\ntest("t", () => { const { a } = { a: 1 }; expect(grade(a)).toBe("fail"); });\n`, "OOP_CASES_UNSUPPORTED_TEST", "stmt:const-shape"],
  // each
  ["each non-literal table", `import { test, expect } from "vitest";\nimport { grade } from "../src/score.mjs";\nconst rows = [[80, "pass"]];\ntest.each(rows)("e", (n, w) => expect(grade(n)).toBe(w));\n`, "OOP_CASES_UNSUPPORTED_TEST", "test-modifier:each"],
  ["each tagged template", `import { test, expect } from "vitest";\nimport { grade } from "../src/score.mjs";\ntest.each\`n | w\\n80 | pass\`("e", ({ n, w }) => expect(grade(n)).toBe(w));\n`, "OOP_CASES_UNSUPPORTED_TEST", "test-modifier:each"],
  ["each skip", `import { test, expect } from "vitest";\nimport { grade } from "../src/score.mjs";\ntest.skip.each([[80, "pass"]])("e", (n, w) => expect(grade(n)).toBe(w));\n`, "OOP_CASES_UNSUPPORTED_TEST", "test-modifier:skip"],
  ["each mismatched arity", `import { test, expect } from "vitest";\nimport { grade } from "../src/score.mjs";\ntest.each([[80, "pass"]])("e", (n) => expect(grade(n)).toBe("pass"));\n`, "OOP_CASES_UNSUPPORTED_TEST", "test-modifier:each"],
  ["each empty table", `import { test, expect } from "vitest";\nimport { grade } from "../src/score.mjs";\ntest.each([])("e", (n) => expect(grade(n)).toBe("pass"));\n`, "OOP_CASES_UNSUPPORTED_TEST", "test-modifier:each"],
  ["each shadow param", `import { test, expect } from "vitest";\nimport { grade } from "../src/score.mjs";\nconst n = 1;\ntest.each([[80]])("e", (n) => expect(grade(n)).toBe("pass"));\n`, "OOP_CASES_UNSUPPORTED_TEST", "each-shadow"],
  // imports
  ["used package import", `import { test, expect } from "vitest";\nimport { inspect } from "node:util";\nimport { grade } from "../src/score.mjs";\ntest("t", () => expect(inspect(grade(80))).toBe("'pass'"));\n`, "OOP_CASES_NONLITERAL", "expect-nonliteral"],
  ["multi-module used", `import { test, expect } from "vitest";\nimport { grade } from "../src/score.mjs";\nimport { clip } from "../src/token.cjs";\ntest("t", () => { expect(grade(80)).toBe("pass"); expect(clip("ab", 1)).toBe("a"); });\n`, "OOP_CASES_UNSUPPORTED_TEST", "multi-module"],
  ["side-effect import", `import { test, expect } from "vitest";\nimport "./setup.js";\nimport { grade } from "../src/score.mjs";\ntest("t", () => expect(grade(80)).toBe("pass"));\n`, "OOP_CASES_UNSUPPORTED_TEST", "side-effect-import"],
];

test("M205 refuse: near miss for every new condition (no silent skip)", () => {
  for (const [label, src, code, detail] of NEAR) {
    const { result: r, stats } = V.extractCasesWithStats(src, "test/m.test.ts");
    assert.equal(r.ok, false, `${label}: admitted`);
    if (r.ok) continue;
    assert.deepEqual([r.code, r.detail], [code, detail], `${label}: ${JSON.stringify(stats.refusals)}`);
    assert.equal(stats.extracted, 0, `${label}: nothing extracted from a refused file`);
  }
});

// Batch 40 silent-skip regression must still hold
const SILENT = `import { test } from "node:test";
import assert from "node:assert/strict";
import { expect } from "vitest";
import { grade } from "../src/score.mjs";
test("a", () => assert.strictEqual(grade(80), "pass"));
test("b", () => { expect(grade(10)).toStrictEqual("fail"); assert.ok(grade(0) === "fail"); });
`;
test("M205 regression: Batch 40 silent-skip shape still refuses", () => {
  const { result: r, stats } = V.extractCasesWithStats(SILENT, "t.mjs");
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.code, "OOP_CASES_UNSUPPORTED_ASSERT");
  assert.equal(stats.extracted, 0);
});

// ============================================================================
// e2e: admitted shapes pass/fail under oop-v1
// ============================================================================
test("M205 e2e: nested + const + each shapes pass on honest modules and fail on bugs", { skip: skipE2e }, () => {
  for (const [label, file, mod, src, okSrc, bugSrc] of [
    ["nest", "test/score.test.ts", "src/score.mjs", NEST_A, SCORE_OK, SCORE_BUG],
    ["const", "t.mjs", "src/score.mjs", CONST_TOP, SCORE_OK, SCORE_BUG],
    ["each", "t.ts", "src/score.mjs", EACH_AA, SCORE_OK, SCORE_BUG],
  ] as const) {
    const ex = V.extractCasesFromSource(src, file);
    assert.ok(ex.ok, label);
    const run = (body: string) => V.verify({ root: fixture({ [mod]: body }), module: mod, cases: ex.cases, env, callMs: 10_000, sessionMs: 120_000 });
    const good = run(okSrc);
    assert.equal(good.code, "OOP_OK", `${label}: ${JSON.stringify(good)}`);
    assert.deepEqual([good.pass, good.fail], [ex.cases.length, 0], label);
    const bad = run(bugSrc);
    assert.equal(bad.code, "OOP_OK", label);
    assert.ok((bad.fail ?? 0) > 0, `${label}: bug credited`);
  }
});

// ============================================================================
// Mutation: every m205-guard tag has a case; deleting its line makes that case fail
// ============================================================================
function rewriteV(t: string): string {
  return t.replace(/from "\.\/([a-z0-9-]+\.ts)"/g, (_m, f: string) => `from ${JSON.stringify(pathToFileURL(join(libDir, f)).href)}`)
    .replace(/from "typescript"/g, `from ${JSON.stringify(pathToFileURL(tsPath).href)}`);
}
const SRC = readFileSync(join(libDir, "verifier.ts"), "utf8");
async function loadV(text: string): Promise<VT> {
  const d = join(base, `var-${n++}`);
  mkdirSync(join(d, "lib"), { recursive: true });
  writeFileSync(join(d, "lib/verifier.ts"), rewriteV(text));
  // harness/judge still resolved via import.meta.url relative to the copied verifier — point them at real lib
  // rewrite fileURL paths embedded by the real module: the copied file still does new URL("./verifier-harness.cjs", import.meta.url)
  // so copy harness+judge next to it
  writeFileSync(join(d, "lib/verifier-harness.cjs"), readFileSync(join(libDir, "verifier-harness.cjs")));
  writeFileSync(join(d, "lib/verifier-judge.cjs"), readFileSync(join(libDir, "verifier-judge.cjs")));
  mkdirSync(join(d, "spec"), { recursive: true });
  writeFileSync(join(d, "spec/verifier-v1.md"), readFileSync(join(libDir, "../spec/verifier-v1.md")));
  return (await import(pathToFileURL(join(d, "lib/verifier.ts")).href)) as VT;
}
const tagsOf = (t: string) => t.split("\n").flatMap((l) => { const m = /\/\/ m205-guard:([a-z0-9-]+)/.exec(l); return m ? [m[1]!] : []; });
const drop = (text: string, tag: string) => {
  const ls = text.split("\n"), hit = (l: string) => new RegExp(`// m205-guard:${tag}(?![a-z0-9-])`).test(l);
  assert.equal(ls.filter(hit).length, 1, `one line holds ${tag}`);
  return ls.filter((l) => !hit(l)).join("\n");
};
const X = (m: VT, src: string) => m.extractCasesFromSource(src, "t.ts");
const refusedAs = (r: ReturnType<VT["extractCasesFromSource"]>, code: string, detail?: string) => {
  assert.equal(r.ok, false, "admitted");
  if (!r.ok) { assert.equal(r.code, code); if (detail !== undefined) assert.equal(r.detail, detail); }
};
const admitted = (r: ReturnType<VT["extractCasesFromSource"]>) => { assert.equal(r.ok, true, JSON.stringify(r)); };

const GUARD: Record<string, (m: VT) => void> = {
  "const-resolve": (m) => admitted(X(m, CONST_TOP)),
  "const-prop": (m) => {
    const src = `import { test, expect } from "vitest";\nimport { clip } from "../src/token.cjs";\nconst row = { s: "hi", n: 2 };\ntest("t", () => expect(clip(row.s, row.n)).toBe("hi"));\n`;
    admitted(X(m, src));
  },
  "unused-import": (m) => admitted(X(m, UNUSED_PKG)),
  "const-kind": (m) => refusedAs(X(m, `import { test, expect } from "vitest";\nimport { grade } from "../src/score.mjs";\ntest("t", () => { let X = 1; expect(grade(X)).toBe("fail"); });\n`), "OOP_CASES_UNSUPPORTED_TEST", "stmt:var"),
  "const-shape": (m) => refusedAs(X(m, `import { test, expect } from "vitest";\nimport { grade } from "../src/score.mjs";\ntest("t", () => { const { a } = { a: 1 }; expect(grade(a)).toBe("fail"); });\n`), "OOP_CASES_UNSUPPORTED_TEST", "stmt:const-shape"),
  "const-shadow": (m) => refusedAs(X(m, `import { test, expect } from "vitest";\nimport { grade } from "../src/score.mjs";\nconst X = 1;\ntest("t", () => { const X = 2; expect(grade(X)).toBe("fail"); });\n`), "OOP_CASES_UNSUPPORTED_TEST", "stmt:const-shadow"),
  "const-bind": (m) => admitted(X(m, CONST_TOP)),
  "const-reassign": (m) => refusedAs(X(m, `import { test, expect } from "vitest";\nimport { grade } from "../src/score.mjs";\nconst X = 1;\nX = 2;\ntest("t", () => expect(grade(X)).toBe("fail"));\n`), "OOP_CASES_UNSUPPORTED_TEST", "top-level:const-reassign"),
  "const-in-test": (m) => admitted(X(m, CONST_BODY)),
  "each-table": (m) => refusedAs(X(m, `import { test, expect } from "vitest";\nimport { grade } from "../src/score.mjs";\ntest.each([])("e", (n) => expect(grade(n)).toBe("pass"));\n`), "OOP_CASES_UNSUPPORTED_TEST", "test-modifier:each"),
  "each-params": (m) => refusedAs(X(m, `import { test, expect } from "vitest";\nimport { grade } from "../src/score.mjs";\ntest.each([[80, "pass"]])("e", (n, w = "x") => expect(grade(n)).toBe(w));\n`), "OOP_CASES_UNSUPPORTED_TEST", "test-modifier:each"),
  "each-shape": (m) => refusedAs(X(m, `import { test, expect } from "vitest";\nimport { grade } from "../src/score.mjs";\ntest.each([[1]])("e", "not-a-fn");\n`), "OOP_CASES_UNSUPPORTED_TEST", "each-shape"),
  "each-shadow": (m) => refusedAs(X(m, `import { test, expect } from "vitest";\nimport { grade } from "../src/score.mjs";\nconst n = 1;\ntest.each([[80]])("e", (n) => expect(grade(n)).toBe("pass"));\n`), "OOP_CASES_UNSUPPORTED_TEST", "each-shadow"),
  "each-expand": (m) => {
    const r = X(m, EACH_AA);
    admitted(r);
    if (r.ok) assert.equal(r.cases.length, 3);
  },
  "suite-nest": (m) => admitted(X(m, NEST_A)),
  "suite-id": (m) => {
    const r = X(m, NEST_A);
    admitted(r);
    if (r.ok) assert.ok(r.cases.every((c) => c.id.includes("/")), JSON.stringify(r.cases.map((c) => c.id)));
  },
};

test("M205 mutation: every m205-guard tag has a case; each passes unmutated and fails with its line deleted", async () => {
  const tags = [...new Set(tagsOf(SRC))];
  assert.ok(tags.length >= 10, `expected many m205 guards, got ${tags.length}: ${tags}`);
  for (const t of tags) assert.ok(GUARD[t], `no case for m205-guard:${t}`);
  for (const t of tags) {
    await GUARD[t]!(await loadV(SRC));
    let failed = false;
    try { await GUARD[t]!(await loadV(drop(SRC, t))); } catch { failed = true; }
    assert.ok(failed, `deleting m205-guard:${t} was not caught by its own case`);
  }
});

test("M205 hygiene: no candidate process outlives the file", { skip: !cand && "needs cand3" }, () => {
  assert.deepEqual(candPids(cand!.uid), []);
});
