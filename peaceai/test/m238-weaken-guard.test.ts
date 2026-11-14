// Text mode is test-only. Test-as-spec probes can still be strict. Bakery fixtures only.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { finishTextReplay, gradeTextRuns } from "../bin/practice-replay.ts";
import { replayDocument, seededIdiom } from "../lib/practicereplay.ts";
import { visibleNodeBin } from "../lib/practicemine.ts";
import { gradeBehavior, type Behavior } from "../lib/specgrade.ts";

const nodePath = visibleNodeBin() ?? process.execPath;

function grade(candidate: string, fix: string, args: unknown[][], target: { symbol: string; exportName: string; form?: "named" | "named-prop"; prop?: string } = { symbol: "warm", exportName: "warm" }): Behavior {
  const write = (text: string) => {
    const root = mkdtempSync(join(tmpdir(), "peaceai-guard-"));
    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(join(root, "src/oven.ts"), text);
    return root;
  };
  const left = write(candidate);
  const right = write(fix);
  try {
    return gradeBehavior({
      candidateRoot: left, fixRoot: right, nodePath,
      target: { symbol: target.symbol, file: "src/oven.ts", form: target.form ?? "named", exportName: target.exportName, prop: target.prop, args },
    }).behavior;
  } finally {
    rmSync(left, { recursive: true, force: true });
    rmSync(right, { recursive: true, force: true });
  }
}

const range = "export function warm(n: number): boolean {\n  return n > 0 && n < 10;\n}\n";

test("thirteen weakenings are not strict, and an equivalent rewrite still can be", () => {
  const weak: [string, string, unknown[][]][] = [
    ["export function warm(n: number): boolean {\n  return n > 0;\n}\n", range, [[3], [12]]],
    ["export function warm(n: number): boolean {\n  if (n > 0) return true;\n  return n < 10;\n}\n", range, [[12]]],
    ["export function warm(n: number): boolean {\n  if (n > 0) return true;\n  return true;\n}\n", range, [[-1]]],
    ["function ready(n: number): boolean { return n > 0; }\nexport { ready as warm };\n", range, [[12]]],
    ["export function warm(n: number): boolean {\n  return n;\n}\n", "export function warm(n: number): number {\n  if (n < 0) throw new RangeError(\"cold\");\n  return n;\n}\n", [[-1]]],
    ["export function warm(n: number): boolean {\n  return n >= 0 || n < 0;\n}\n", range, [[12]]],
    ["export function warm(n: number): boolean {\n  return n < 10;\n}\n", range, [[-1]]],
    ["export function warm(n: number): boolean {\n  return n >= 0;\n}\n", "export function warm(n: number): boolean {\n  return n > 0;\n}\n", [[0]]],
    ["export function warm(batch: { hot: boolean } | null): boolean {\n  return Boolean(batch && batch.hot);\n}\n", "export function warm(batch: { hot: boolean } | null): boolean {\n  if (!batch) return false;\n  return batch.hot;\n}\n", [[null]]],
    ["export function warm(n: number): boolean {\n  if (n > 0) return true;\n  return false;\n}\n", "export function warm(n: number): boolean {\n  if (n > 0 && n < 10) return true;\n  return false;\n}\n", [[12]]],
    ["export function warm(n: number): boolean {\n  return true;\n}\n", range, [[-1]]],
    ["export function warm(n: number): boolean {\n  return n === n || n > 100;\n}\n", range, [[12]]],
  ];
  assert.equal(weak.length, 12);
  const method = grade(
    "export const oven = { warm(n: number): boolean { return n > 0; } };\n",
    "export const oven = { warm(n: number): boolean { return n > 0 && n < 10; } };\n",
    [[12]],
    { symbol: "warm", exportName: "oven", form: "named-prop", prop: "warm" },
  );
  assert.notEqual(method, "verified_strict");
  for (const [candidate, fix, args] of weak) assert.notEqual(grade(candidate, fix, args), "verified_strict");
  assert.equal(grade(
    "export function warm(a: boolean, b: boolean): boolean {\n  return !a || !b;\n}\n",
    "export function warm(a: boolean, b: boolean): boolean {\n  return !(a && b);\n}\n",
    [[true, true]],
  ), "verified_strict");
  assert.equal(grade(
    "export function warm(label: string): boolean {\n  return new RegExp(\"^loaf \").test(label);\n}\n",
    "export function warm(label: string): boolean {\n  return /^loaf /.test(label);\n}\n",
    [["loaf rye"]],
  ), "verified_strict");
});

test("a text flip is test-only, and a flaky base from another candidate is not a pass", () => {
  const row = {
    scorable: true, core: "ok" as const, job: { status: "pass" as const, reason: "JOB_A_CANDIDATES:1" }, gatePass: true,
  };
  const shapes = [
    "exact isPositive fix: return isNumber(value) && value > 0",
    "FLAGS.strict = false",
    "isClass = Boolean as never",
    "closing brace and a statement on the same line",
  ];
  for (const shape of shapes) {
    const graded = gradeTextRuns([{ beforeExit: 1, afterExit: 0 }], row);
    assert.equal(graded.reason, "VERIFIED_TEST_ONLY", shape);
    assert.notEqual(graded.status, "pass", shape);
  }
  const mixed = gradeTextRuns([{ beforeExit: 1, afterExit: null }, { beforeExit: 0, afterExit: 0 }], row);
  assert.notEqual(mixed.status, "pass");
  assert.equal(mixed.reason, "TEST_NOT_RUN");
  const flake = gradeTextRuns([{ beforeExit: 0, afterExit: 0 }], row);
  assert.equal(flake.status, "unmeasured");
  assert.equal(flake.reason, "TEST_BASE_NOT_FAILING");
  let calls = 0;
  const throughReplay = finishTextReplay(
    [{ file: "a.diff" }, { file: "b.diff" }],
    () => {
      calls += 1;
      return calls === 1 ? { beforeExit: 1, afterExit: null } : { beforeExit: 0, afterExit: 0 };
    },
    row,
  );
  assert.equal(calls, 2);
  assert.notEqual(throughReplay.status, "pass");
  assert.notEqual(throughReplay.reason, "GATE_PASS_AND_TEST");
  assert.equal(throughReplay.reason, "TEST_NOT_RUN");
  const beside = finishTextReplay(
    [{ file: "a.diff" }, { file: "b.diff" }, { file: "c.diff" }],
    (file) => file === "b.diff" ? { beforeExit: 0, afterExit: 0 } : file === "c.diff" ? { beforeExit: 1, afterExit: 0 } : { beforeExit: 1, afterExit: null },
    row,
  );
  assert.equal(beside.reason, "VERIFIED_TEST_ONLY");
  assert.equal(beside.flakyBase, true);
  assert.equal(beside.beforeExit, 1);
  assert.equal(beside.afterExit, 0);
  let stopped = 0;
  const early = finishTextReplay(
    [{ file: "a.diff" }, { file: "b.diff" }, { file: "c.diff" }],
    () => { stopped += 1; return { beforeExit: 1, afterExit: 0 }; },
    row,
  );
  assert.equal(stopped, 1);
  assert.equal(early.reason, "VERIFIED_TEST_ONLY");
  assert.equal(early.flakyBase, undefined);
  const dev = replayDocument([{
    repo: "fixture/oven", split: "dev", fixSha: "a".repeat(40), understanding: "text",
    status: beside.status, reason: beside.reason, gap: true, beforeExit: beside.beforeExit, afterExit: beside.afterExit, flakyBase: true,
  }]);
  const held = replayDocument([{
    repo: "fixture/oven", split: "held-out", fixSha: "b".repeat(40), understanding: "text",
    status: beside.status, reason: beside.reason, gap: true, beforeExit: beside.beforeExit, afterExit: beside.afterExit, flakyBase: true,
  }]);
  assert.equal(dev.flakyBase.dev, 1);
  assert.equal(dev.rows[0]?.reason, "VERIFIED_TEST_ONLY");
  assert.equal(dev.rows[0]?.flakyBase, true);
  assert.equal(held.flakyBase["held-out"], 1);
  assert.equal(held.rows[0]?.reason, "VERIFIED_TEST_ONLY");
  assert.equal("flakyBase" in (held.rows[0] ?? {}), false);
  assert.equal(held.rows[0]?.beforeExit, 1);
  assert.equal(held.rows[0]?.afterExit, 0);
});

test("seeded idiom rows are excluded from credit, and a held-out row with the same sha is not", () => {
  const dev = { repo: "sindresorhus/is", split: "dev" as const, fixSha: "cb4ee0e92cd3bff8353bb6738bd1f54db87dc293", status: "pass" as const, reason: "GATE_PASS_AND_TEST", gap: false, understanding: "text" as const };
  const held = { ...dev, split: "held-out" as const, status: "fail" as const, reason: "VERIFIED_TEST_ONLY", gap: true };
  const defu = { repo: "unjs/defu", split: "dev" as const, fixSha: "11ba02213d4b1c6b02dd686041f75edc479c98e9", status: "pass" as const, reason: "GATE_PASS_AND_TEST", gap: false, understanding: "text" as const };
  assert.equal(seededIdiom(dev), "enum-values");
  assert.equal(seededIdiom(held), null);
  assert.equal(seededIdiom(defu), "own-keys");
  const doc = replayDocument([dev, held, defu]);
  assert.deepEqual(doc.excludedFromCredit.map((row) => row.idiom).sort(), ["enum-values", "own-keys"]);
  assert.equal(doc.excludedFromCredit.every((row) => row.split === "dev"), true);
  assert.equal(doc.counts.text.dev.pass, 2);
  assert.equal(doc.creditCounts.text.dev.pass, 0);
});
