// M206 (batch 42) verifier-v1: widen fail-closed static case extractor with more exact-reproducible forms.
// Spec: peaceai/spec/verifier-v1.md ("M206"). EXPERIMENTAL, opt-in (VERDICT_MODE oop-v1), NOT the default.
// Forms (static extraction only; never evaluates test code):
//   (a) let/var of JSON literals that are never reassigned, mutated, or captured in a nested function;
//   (b) each tables bound to a const / never-reassigned literal identifier;
//   (c) describe.each / suite.each with literal tables (one case per row; names concatenated);
//   (d) tagged-template each when every cell is a literal and the header is a plain identifier list;
//   (e) destructuring const of a literal object or array (simple, non-computed, no defaults).
// Fixtures are synthetic (probes, clips, bands): nothing modelled on PeaceSTOCKS, a dev task or a reference diff.
// Batch 40 silent-skip regression and m205 admits must still hold. Every m206-guard line deleted is caught by its case.
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
const CAND = process.env.M206_CAND ?? process.env.M205_CAND ?? process.env.M204_CAND ?? process.env.M146_CAND ?? "";
const VERIFIER = process.env.M206_VERIFIER ?? process.env.M205_VERIFIER ?? process.env.M204_VERIFIER ?? process.env.PEACEAI_VERIFIER_UID ?? "";
const cu = stage2CandUid({ [STAGE2_CAND_ENV]: CAND });
const cand: CandUid | null = cu.ok ? cu.cand : null;
const vOk = cand !== null && V.verifierUid({ [V.VERIFIER_UID_ENV]: VERIFIER }, cand).ok;
const skipE2e = !(cand && vOk) && "needs peaceai-cand3 + PEACEAI_VERIFIER_UID=peaceai-verify";
const env = { ...process.env, [STAGE2_CAND_ENV]: CAND, [V.VERIFIER_UID_ENV]: VERIFIER };

const base = mkdtempSync(join(tmpdir(), "peaceai-m206-"));
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
const PROBE_OK = `export function probe(n) {
  if (typeof n !== "number" || Number.isNaN(n)) throw new TypeError("not a number");
  if (n < 0 || n > 100) throw new RangeError("out of range");
  return n >= 50 ? "hot" : "cold";
}
export function label(n) { return n >= 90 ? "A" : n >= 50 ? "B" : "C"; }
`;
const PROBE_BUG = PROBE_OK.replace('n >= 50 ? "hot"', 'n >= 90 ? "hot"');
const CLIP_OK = `"use strict";
exports.trimTo = (s, n) => {
  if (typeof s !== "string") throw new TypeError("want string");
  if (!Number.isInteger(n) || n < 0) throw new RangeError("bad n");
  return s.length <= n ? s : s.slice(0, n);
};
exports.splitBy = (s, sep) => s.split(sep).filter(Boolean);
`;

// ============================================================================
// (a) let / var of JSON literals (never reassigned / mutated / captured)
// ============================================================================
const LET_TOP = `import { test } from "node:test";
import assert from "node:assert/strict";
import { probe } from "../src/probe.mjs";

let HOT = 80;
var COLD = 10;

test("probes from let/var", () => {
  assert.strictEqual(probe(HOT), "hot");
  assert.strictEqual(probe(COLD), "cold");
});
`;
const LET_BODY = `import { describe, it, expect } from "vitest";
import { trimTo } from "../src/clip.cjs";

describe("clip lets", () => {
  it("clips with body lets", () => {
    let sample = "abcdef";
    let limit = 3;
    expect(trimTo(sample, limit)).toBe("abc");
  });
});
`;

test("M206 admit (a): top-level let/var JSON bindings resolved (node:test shape)", () => {
  const { result: r, stats } = V.extractCasesWithStats(LET_TOP, "t.mjs");
  assert.ok(r.ok, JSON.stringify(r));
  assert.deepEqual([stats.tests, stats.extracted], [1, 2]);
  assert.deepEqual(r.cases.map((c) => [c.args, c.expect]), [
    [[80], { ok: true, value: "hot", cmp: "is" }],
    [[10], { ok: true, value: "cold", cmp: "is" }],
  ]);
});

test("M206 admit (a): test-body let JSON bindings resolved (vitest shape)", () => {
  const { result: r, stats } = V.extractCasesWithStats(LET_BODY, "t.ts");
  assert.ok(r.ok, JSON.stringify(r));
  assert.deepEqual([stats.tests, stats.extracted], [1, 1]);
  assert.deepEqual(r.cases[0]!.args, ["abcdef", 3]);
});

// ============================================================================
// (b) each tables bound to a const / safe identifier
// ============================================================================
const EACH_CONST = `import { test, expect } from "vitest";
import { probe } from "../src/probe.mjs";

const rows = [
  [80, "hot"],
  [10, "cold"],
];

test.each(rows)("probe(%s) -> %s", (n, want) => {
  expect(probe(n)).toBe(want);
});
`;
const EACH_CONST_OBJ = `import { it, expect } from "vitest";
import { trimTo } from "../src/clip.cjs";

const table = [
  { s: "hi", n: 5, out: "hi" },
  { s: "hello", n: 2, out: "he" },
];

it.each(table)("clips", ({ s, n, out }) => {
  expect(trimTo(s, n)).toBe(out);
});
`;

test("M206 admit (b): test.each with const-bound array-of-arrays table", () => {
  const { result: r, stats } = V.extractCasesWithStats(EACH_CONST, "t.ts");
  assert.ok(r.ok, JSON.stringify(r));
  assert.deepEqual([stats.assertionsSeen, stats.extracted], [1, 2]);
  assert.deepEqual(r.cases.map((c) => c.args), [[80], [10]]);
});

test("M206 admit (b): it.each with const-bound array-of-objects table", () => {
  const { result: r, stats } = V.extractCasesWithStats(EACH_CONST_OBJ, "t.ts");
  assert.ok(r.ok, JSON.stringify(r));
  assert.deepEqual([stats.extracted], [2]);
  assert.deepEqual(r.cases.map((c) => c.args), [["hi", 5], ["hello", 2]]);
});

// ============================================================================
// (c) describe.each / suite.each
// ============================================================================
const DESC_EACH = `import { describe, it, expect } from "vitest";
import { probe } from "../src/probe.mjs";

describe.each([
  [80, "hot"],
  [10, "cold"],
])("probe $0", (n, want) => {
  it("matches", () => {
    expect(probe(n)).toBe(want);
  });
});
`;
const SUITE_EACH = `import { suite, test } from "node:test";
import assert from "node:assert/strict";
import { trimTo } from "../src/clip.cjs";

suite.each([
  ["abcdef", 3, "abc"],
  ["hi", 5, "hi"],
])("clip", (s, n, out) => {
  test("trims", () => {
    assert.strictEqual(trimTo(s, n), out);
  });
});
`;

test("M206 admit (c): describe.each with literal table; names concatenate (vitest)", () => {
  const { result: r, stats } = V.extractCasesWithStats(DESC_EACH, "t.ts");
  assert.ok(r.ok, JSON.stringify(r));
  assert.equal(stats.extracted, 2);
  assert.deepEqual(r.cases.map((c) => c.id), [
    "probe $0/@0/c1:probe", "probe $0/@1/c2:probe",
  ]);
  assert.deepEqual(r.cases.map((c) => c.args), [[80], [10]]);
});

test("M206 admit (c): suite.each with literal table (node:test shape)", () => {
  const { result: r, stats } = V.extractCasesWithStats(SUITE_EACH, "t.mjs");
  assert.ok(r.ok, JSON.stringify(r));
  assert.equal(stats.extracted, 2);
  assert.ok(r.cases.every((c) => c.id.includes("/@")), JSON.stringify(r.cases.map((c) => c.id)));
  assert.deepEqual(r.cases.map((c) => c.args), [["abcdef", 3], ["hi", 5]]);
});

// ============================================================================
// (d) tagged-template each (literal cells + plain identifier header)
// ============================================================================
const TAGGED_TEST = `import { test, expect } from "vitest";
import { probe } from "../src/probe.mjs";

test.each\`
  n | want
  \${80} | \${"hot"}
  \${10} | \${"cold"}
\`("probe", ({ n, want }) => {
  expect(probe(n)).toBe(want);
});
`;
const TAGGED_POS = `import { it, expect } from "vitest";
import { trimTo } from "../src/clip.cjs";

it.each\`
  s | n | out
  \${"hello"} | \${2} | \${"he"}
  \${"ab"} | \${5} | \${"ab"}
\`("clips", (s, n, out) => {
  expect(trimTo(s, n)).toBe(out);
});
`;

test("M206 admit (d): tagged-template test.each with literal cells + object params", () => {
  const { result: r, stats } = V.extractCasesWithStats(TAGGED_TEST, "t.ts");
  assert.ok(r.ok, JSON.stringify(r));
  assert.deepEqual([stats.assertionsSeen, stats.extracted], [1, 2]);
  assert.deepEqual(r.cases.map((c) => [c.args, c.expect]), [
    [[80], { ok: true, value: "hot", cmp: "is" }],
    [[10], { ok: true, value: "cold", cmp: "is" }],
  ]);
});

test("M206 admit (d): tagged-template it.each with positional params", () => {
  const { result: r, stats } = V.extractCasesWithStats(TAGGED_POS, "t.ts");
  assert.ok(r.ok, JSON.stringify(r));
  assert.equal(stats.extracted, 2);
  assert.deepEqual(r.cases.map((c) => c.args), [["hello", 2], ["ab", 5]]);
});

// ============================================================================
// (e) destructuring const of a literal object / array
// ============================================================================
const DESTRUCT_OBJ = `import { test } from "node:test";
import assert from "node:assert/strict";
import { probe } from "../src/probe.mjs";

const { hot, cold } = { hot: 80, cold: 10 };

test("probes from destructured const", () => {
  assert.strictEqual(probe(hot), "hot");
  assert.strictEqual(probe(cold), "cold");
});
`;
const DESTRUCT_ARR = `import { describe, it, expect } from "vitest";
import { trimTo } from "../src/clip.cjs";

describe("clip destructure", () => {
  it("clips", () => {
    const [sample, limit] = ["abcdef", 3];
    expect(trimTo(sample, limit)).toBe("abc");
  });
});
`;

test("M206 admit (e): destructuring const of a literal object (node:test)", () => {
  const { result: r, stats } = V.extractCasesWithStats(DESTRUCT_OBJ, "t.mjs");
  assert.ok(r.ok, JSON.stringify(r));
  assert.deepEqual([stats.extracted], [2]);
  assert.deepEqual(r.cases.map((c) => c.args), [[80], [10]]);
});

test("M206 admit (e): destructuring const of a literal array in test body (vitest)", () => {
  const { result: r, stats } = V.extractCasesWithStats(DESTRUCT_ARR, "t.ts");
  assert.ok(r.ok, JSON.stringify(r));
  assert.equal(stats.extracted, 1);
  assert.deepEqual(r.cases[0]!.args, ["abcdef", 3]);
});

// ============================================================================
// Refused near misses (one or more per new condition)
// ============================================================================
const NEAR: readonly [string, string, string, string][] = [
  // (a) let/var unsound
  ["let reassign", `import { test, expect } from "vitest";\nimport { probe } from "../src/probe.mjs";\ntest("t", () => { let X = 1; X = 2; expect(probe(X)).toBe("cold"); });\n`, "OOP_CASES_UNSUPPORTED_TEST", "stmt:var-reassign"],
  ["let compound", `import { test, expect } from "vitest";\nimport { probe } from "../src/probe.mjs";\ntest("t", () => { let X = 1; X += 1; expect(probe(X)).toBe("cold"); });\n`, "OOP_CASES_UNSUPPORTED_TEST", "stmt:var-reassign"],
  ["letplusplus", `import { test, expect } from "vitest";\nimport { probe } from "../src/probe.mjs";\ntest("t", () => { let X = 1; ++X; expect(probe(X)).toBe("cold"); });\n`, "OOP_CASES_UNSUPPORTED_TEST", "stmt:var-reassign"],
  ["let mutate method", `import { test, expect } from "vitest";\nimport { probe } from "../src/probe.mjs";\ntest("t", () => { let X = [1]; X.push(2); expect(probe(X.length)).toBe("cold"); });\n`, "OOP_CASES_UNSUPPORTED_TEST", "stmt:var-mutate"],
  ["let mutate prop", `import { test, expect } from "vitest";\nimport { probe } from "../src/probe.mjs";\ntest("t", () => { let X = { n: 1 }; X.n = 2; expect(probe(X.n)).toBe("cold"); });\n`, "OOP_CASES_UNSUPPORTED_TEST", "stmt:var-mutate"],
  ["let capture", `import { test, expect } from "vitest";\nimport { probe } from "../src/probe.mjs";\ntest("t", () => { let X = 1; (function () { X; })(); expect(probe(X)).toBe("cold"); });\n`, "OOP_CASES_UNSUPPORTED_TEST", "stmt:var-capture"],
  ["let nonliteral", `import { test, expect } from "vitest";\nimport { probe } from "../src/probe.mjs";\ntest("t", () => { let X = probe(1); expect(X).toBe("cold"); });\n`, "OOP_CASES_UNSUPPORTED_TEST", "stmt:var"],
  // (b) each table id
  ["each mutated table", `import { test, expect } from "vitest";\nimport { probe } from "../src/probe.mjs";\nlet rows = [[80, "hot"]];\nrows.push([10, "cold"]);\ntest.each(rows)("e", (n, w) => expect(probe(n)).toBe(w));\n`, "OOP_CASES_UNSUPPORTED_TEST", "top-level:var-mutate"],
  ["each unbound table id", `import { test, expect } from "vitest";\nimport { probe } from "../src/probe.mjs";\ntest.each(rows)("e", (n, w) => expect(probe(n)).toBe(w));\n`, "OOP_CASES_UNSUPPORTED_TEST", "test-modifier:each"],
  ["each nonlit const table", `import { test, expect } from "vitest";\nimport { probe } from "../src/probe.mjs";\nconst rows = [[80, "hot"], ...[]];\ntest.each(rows)("e", (n, w) => expect(probe(n)).toBe(w));\n`, "OOP_CASES_UNSUPPORTED_TEST", "top-level:var"],
  // (c) describe.each
  ["describe.each nonlit table", `import { describe, it, expect } from "vitest";\nimport { probe } from "../src/probe.mjs";\ndescribe.each(rows)("s", (n) => { it("t", () => expect(probe(n)).toBe("hot")); });\n`, "OOP_CASES_UNSUPPORTED_TEST", "test-modifier:each"],
  ["describe.only.each", `import { describe, it, expect } from "vitest";\nimport { probe } from "../src/probe.mjs";\ndescribe.only.each([[1]])("s", (n) => { it("t", () => expect(probe(n)).toBe("cold")); });\n`, "OOP_CASES_UNSUPPORTED_TEST", "test-modifier:only"],
  ["describe.each empty", `import { describe, it, expect } from "vitest";\nimport { probe } from "../src/probe.mjs";\ndescribe.each([])("s", (n) => { it("t", () => expect(probe(n)).toBe("hot")); });\n`, "OOP_CASES_UNSUPPORTED_TEST", "test-modifier:each"],
  // (d) tagged template
  ["tagged nonlit cell", `import { test, expect } from "vitest";\nimport { probe } from "../src/probe.mjs";\ntest.each\`n | w\\n\${Date.now()} | \${"hot"}\`("e", ({ n, w }) => expect(probe(n)).toBe(w));\n`, "OOP_CASES_UNSUPPORTED_TEST", "test-modifier:each"],
  ["tagged bad header", `import { test, expect } from "vitest";\nimport { probe } from "../src/probe.mjs";\ntest.each\`1n | w\\n\${80} | \${"hot"}\`("e", ({ n, w }) => expect(probe(n)).toBe(w));\n`, "OOP_CASES_UNSUPPORTED_TEST", "test-modifier:each"],
  ["tagged no cells", `import { test, expect } from "vitest";\nimport { probe } from "../src/probe.mjs";\ntest.each\`n | w\\n80 | hot\`("e", ({ n, w }) => expect(probe(n)).toBe(w));\n`, "OOP_CASES_UNSUPPORTED_TEST", "test-modifier:each"],
  // (e) destructure
  ["destructure default expr", `import { test, expect } from "vitest";\nimport { probe } from "../src/probe.mjs";\ntest("t", () => { const { a = probe(1) } = {}; expect(probe(a)).toBe("cold"); });\n`, "OOP_CASES_UNSUPPORTED_TEST", "stmt:const-destructure"],
  ["destructure nested", `import { test, expect } from "vitest";\nimport { probe } from "../src/probe.mjs";\ntest("t", () => { const { a: { b } } = { a: { b: 1 } }; expect(probe(b)).toBe("cold"); });\n`, "OOP_CASES_UNSUPPORTED_TEST", "stmt:const-destructure"],
  ["destructure rest", `import { test, expect } from "vitest";\nimport { probe } from "../src/probe.mjs";\ntest("t", () => { const { a, ...rest } = { a: 1, b: 2 }; expect(probe(a)).toBe("cold"); });\n`, "OOP_CASES_UNSUPPORTED_TEST", "stmt:const-destructure"],
  ["destructure let", `import { test, expect } from "vitest";\nimport { probe } from "../src/probe.mjs";\ntest("t", () => { let { a } = { a: 1 }; expect(probe(a)).toBe("cold"); });\n`, "OOP_CASES_UNSUPPORTED_TEST", "stmt:const-shape"],
  ["destructure computed", `import { test, expect } from "vitest";\nimport { probe } from "../src/probe.mjs";\ntest("t", () => { const { ["a"]: a } = { a: 1 }; expect(probe(a)).toBe("cold"); });\n`, "OOP_CASES_UNSUPPORTED_TEST", "stmt:const-destructure"],
];

test("M206 refuse: near miss for every new condition (no silent skip)", () => {
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
import { probe } from "../src/probe.mjs";
test("a", () => assert.strictEqual(probe(80), "hot"));
test("b", () => { expect(probe(10)).toStrictEqual("cold"); assert.ok(probe(0) === "cold"); });
`;
test("M206 regression: Batch 40 silent-skip shape still refuses", () => {
  const { result: r, stats } = V.extractCasesWithStats(SILENT, "t.mjs");
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.code, "OOP_CASES_UNSUPPORTED_ASSERT");
  assert.equal(stats.extracted, 0);
});

// m205 forms still admit
test("M206 regression: m205 nested / const / inline-each / unused-import still admit", () => {
  const nest = V.extractCasesWithStats(`import { describe, it, expect } from "vitest";
import { probe } from "../src/probe.mjs";
describe("outer", () => { describe("inner", () => { it("t", () => expect(probe(80)).toBe("hot")); }); });
`, "t.ts");
  assert.ok(nest.result.ok);
  const inline = V.extractCasesWithStats(`import { test, expect } from "vitest";
import { probe } from "../src/probe.mjs";
test.each([[80, "hot"], [10, "cold"]])("e", (n, w) => expect(probe(n)).toBe(w));
`, "t.ts");
  assert.ok(inline.result.ok);
  if (inline.result.ok) assert.equal(inline.result.cases.length, 2);
});

// ============================================================================
// e2e
// ============================================================================
test("M206 e2e: new forms pass on honest modules and fail on bugs", { skip: skipE2e }, () => {
  for (const [label, file, mod, src, okSrc, bugSrc] of [
    ["let", "t.mjs", "src/probe.mjs", LET_TOP, PROBE_OK, PROBE_BUG],
    ["each-const", "t.ts", "src/probe.mjs", EACH_CONST, PROBE_OK, PROBE_BUG],
    ["describe.each", "t.ts", "src/probe.mjs", DESC_EACH, PROBE_OK, PROBE_BUG],
    ["tagged", "t.ts", "src/probe.mjs", TAGGED_TEST, PROBE_OK, PROBE_BUG],
    ["destructure", "t.mjs", "src/probe.mjs", DESTRUCT_OBJ, PROBE_OK, PROBE_BUG],
  ] as const) {
    const ex = V.extractCasesFromSource(src, file);
    assert.ok(ex.ok, label + " " + JSON.stringify(ex));
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
// Mutation: every m206-guard tag has a case; deleting its line makes that case fail
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
  writeFileSync(join(d, "lib/verifier-harness.cjs"), readFileSync(join(libDir, "verifier-harness.cjs")));
  writeFileSync(join(d, "lib/verifier-judge.cjs"), readFileSync(join(libDir, "verifier-judge.cjs")));
  mkdirSync(join(d, "spec"), { recursive: true });
  writeFileSync(join(d, "spec/verifier-v1.md"), readFileSync(join(libDir, "../spec/verifier-v1.md")));
  return (await import(pathToFileURL(join(d, "lib/verifier.ts")).href)) as VT;
}
const tagsOf = (t: string) => t.split("\n").flatMap((l) => { const m = /\/\/ m206-guard:([a-z0-9-]+)/.exec(l); return m ? [m[1]!] : []; });
const drop = (text: string, tag: string) => {
  const ls = text.split("\n"), hit = (l: string) => new RegExp(`// m206-guard:${tag}(?![a-z0-9-])`).test(l);
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
  "var-bind": (m) => admitted(X(m, LET_TOP)),
  "var-reassign": (m) => refusedAs(X(m, `import { test, expect } from "vitest";\nimport { probe } from "../src/probe.mjs";\ntest("t", () => { let X = 1; X = 2; expect(probe(X)).toBe("cold"); });\n`), "OOP_CASES_UNSUPPORTED_TEST", "stmt:var-reassign"),
  "var-mutate": (m) => refusedAs(X(m, `import { test, expect } from "vitest";\nimport { probe } from "../src/probe.mjs";\ntest("t", () => { let X = [1]; X.push(2); expect(probe(X.length)).toBe("cold"); });\n`), "OOP_CASES_UNSUPPORTED_TEST", "stmt:var-mutate"),
  "var-capture": (m) => refusedAs(X(m, `import { test, expect } from "vitest";\nimport { probe } from "../src/probe.mjs";\ntest("t", () => { let X = 1; (function () { X; })(); expect(probe(X)).toBe("cold"); });\n`), "OOP_CASES_UNSUPPORTED_TEST", "stmt:var-capture"),
  "each-const-table": (m) => admitted(X(m, EACH_CONST)),
  "suite-each": (m) => {
    const src = `import { describe, it, expect } from "vitest";
import { probe } from "../src/probe.mjs";
describe.each\`
  n | want
  \${80} | \${"hot"}
  \${10} | \${"cold"}
\`("probe", (n, want) => {
  it("matches", () => { expect(probe(n)).toBe(want); });
});
`;
    admitted(X(m, src));
  },
  "suite-each-expand": (m) => {
    const r = X(m, DESC_EACH);
    admitted(r);
    if (r.ok) assert.equal(r.cases.length, 2);
  },
  "each-tagged": (m) => admitted(X(m, TAGGED_TEST)),
  "each-tagged-header": (m) => refusedAs(X(m, `import { test, expect } from "vitest";\nimport { probe } from "../src/probe.mjs";\ntest.each\`1n | w\\n\${80} | \${"hot"}\`("e", ({ n, w }) => expect(probe(n)).toBe(w));\n`), "OOP_CASES_UNSUPPORTED_TEST", "test-modifier:each"),
  "each-tagged-cell": (m) => refusedAs(X(m, `import { test, expect } from "vitest";\nimport { probe } from "../src/probe.mjs";\ntest.each\`n | w\\n\${Date.now()} | \${"hot"}\`("e", ({ n, w }) => expect(probe(n)).toBe(w));\n`), "OOP_CASES_UNSUPPORTED_TEST", "test-modifier:each"),
  "const-destructure": (m) => admitted(X(m, DESTRUCT_OBJ)),
  "const-destructure-array": (m) => admitted(X(m, DESTRUCT_ARR)),
  "const-destructure-default": (m) => refusedAs(X(m, `import { test, expect } from "vitest";\nimport { probe } from "../src/probe.mjs";\ntest("t", () => { const { a = 1 } = { a: 2 }; expect(probe(a)).toBe("cold"); });\n`), "OOP_CASES_UNSUPPORTED_TEST", "stmt:const-destructure"),
};

test("M206 mutation: every m206-guard tag has a case; each passes unmutated and fails with its line deleted", async () => {
  const tags = [...new Set(tagsOf(SRC))];
  assert.ok(tags.length >= 10, `expected many m206 guards, got ${tags.length}: ${tags}`);
  for (const t of tags) assert.ok(GUARD[t], `no case for m206-guard:${t}`);
  for (const t of tags) {
    await GUARD[t]!(await loadV(SRC));
    let failed = false;
    try { await GUARD[t]!(await loadV(drop(SRC, t))); } catch { failed = true; }
    assert.ok(failed, `deleting m206-guard:${t} was not caught by its own case`);
  }
});

test("M206 hygiene: no candidate process outlives the file", { skip: !cand && "needs cand3" }, () => {
  assert.deepEqual(candPids(cand!.uid), []);
});
