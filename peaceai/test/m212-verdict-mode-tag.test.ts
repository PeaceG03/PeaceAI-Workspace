// M212 (batch 48): tag non-inproc verdictMode on loop rows. Spec: peaceai/spec/verifier-v1.md (M212).
// Optional v4 field `verdictMode: "oop-v1"` when the loop ran under oop-v1; default inproc omits the key
// (backward compatible; pre-M212 rows still validate). NOT for credit; EDIT_SCOPE_POLICY / stage-2 / SELF_TARGET
// unchanged. Tiny fixtures only: no scanner, no dev task, no reference-diff modelling.
//  - validator + helper cases (admit / refuse near misses);
//  - writer cases: runLoopTask early-refuse under oop-v1 / inproc / default;
//  - mutants: each "// m212-guard:<id>" line deleted, plus fixed semantic rewrites; each must fail a case.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import * as Loop from "../lib/loop.ts";
import * as Row from "../lib/looprow.ts";

const ROOT = resolve(import.meta.dirname, "../..");
const libDir = join(ROOT, "peaceai/lib");
const H = (c: string) => c.repeat(64);

function v4Row(over: Record<string, unknown> = {}): Record<string, unknown> {
  const o: Record<string, unknown> = {
    schema: "peaceai-plan-loop:v4", at: "2026-11-05T20:00:00Z", set: "public", taskFileSha256: H("a"), taskKey: "0123456789abcdef",
    repo: "o/r", commit: "c".repeat(40), workspace: "d".repeat(40), loop: "loop-v2", loopSha256: H("e"),
    proposer: "repair-v1", planner: "plan-only-v4", plannerSha256: H("f"), modelManifestSha256: null, lm: "not-loadable",
    code: "TASK_INVALID", maxAttempts: 1, attempts: 0, result: "refused", attemptCodes: [], tests: null,
    runner: null, deps: null, baseline: null, ...over,
  };
  return o;
}

interface Libs { loop: typeof Loop; row: typeof Row }
interface Case { id: string; guard?: string; run: (l: Libs) => void }

const BAD_TASK = { id: "m212-bad", repo: "o/r", commit: "c".repeat(40) } as never;
const noFetch = () => { throw new Error("m212: no fetch expected"); };
function writeRow(l: Libs, over: { verdictMode?: string; repairRetry?: string } = {}): Row.LoopRow {
  return l.loop.runLoopTask(BAD_TASK, "public", H("a"), {
    root: ROOT, fetcher: noFetch as never, proposer: { name: "repair-v1" }, maxAttempts: 1, runMs: 1000, env: {},
    rules: [], training: new Set<string>(), ...over,
  } as never).row;
}

const CASES: Case[] = [
  {
    id: "row: oop-v1 tag validates; absent key (inproc) validates",
    guard: "row-tag-value",
    run(l) {
      assert.equal(l.row.loopRowProblem(v4Row({ verdictMode: "oop-v1" })), null);
      assert.equal(l.row.loopRowProblem(v4Row()), null, "absent = inproc");
      assert.deepEqual([...l.row.LOOP_VERDICT_MODES_TAGGED], ["oop-v1"]);
    },
  },
  {
    id: "row: explicit inproc / unknown / wrong type refused (near misses)",
    guard: "row-tag-value",
    run(l) {
      assert.equal(l.row.loopRowProblem(v4Row({ verdictMode: "inproc" })), "verdict_mode", "near miss: stored inproc");
      assert.equal(l.row.loopRowProblem(v4Row({ verdictMode: "oop-v2" })), "verdict_mode");
      assert.equal(l.row.loopRowProblem(v4Row({ verdictMode: "OOP-V1" })), "verdict_mode");
      assert.equal(l.row.loopRowProblem(v4Row({ verdictMode: "" })), "verdict_mode");
      assert.equal(l.row.loopRowProblem(v4Row({ verdictMode: 1 })), "verdict_mode");
      assert.equal(l.row.loopRowProblem(v4Row({ verdictMode: null })), "verdict_mode");
    },
  },
  {
    id: "row: pre-v4 schemas cannot carry the key (near miss: same row as v4)",
    run(l) {
      const tagged = v4Row({ verdictMode: "oop-v1" });
      assert.equal(l.row.loopRowProblem(tagged), null);
      const v2 = { ...tagged, schema: "peaceai-plan-loop:v2" };
      delete (v2 as { planner?: unknown }).planner;
      delete (v2 as { plannerSha256?: unknown }).plannerSha256;
      delete (v2 as { modelManifestSha256?: unknown }).modelManifestSha256;
      assert.equal(l.row.loopRowProblem(v2), "loop_keys");
      const v3ok = { ...tagged, schema: "peaceai-plan-loop:v3" };
      delete (v3ok as { verdictMode?: unknown }).verdictMode;
      delete (v3ok as { modelManifestSha256?: unknown }).modelManifestSha256;
      assert.equal(l.row.loopRowProblem(v3ok), null, "near miss: v3 without the key");
      assert.equal(l.row.loopRowProblem({ ...tagged, schema: "peaceai-plan-loop:v3" }), "loop_keys");
    },
  },
  {
    id: "row: repairRetry alone still validates; with oop tag validates",
    run(l) {
      assert.equal(l.row.loopRowProblem(v4Row({ repairRetry: "repair-retry-v1" })), null);
      assert.equal(l.row.loopRowProblem(v4Row({ repairRetry: "repair-retry-v1", verdictMode: "oop-v1" })), null);
    },
  },
  {
    id: "helper: rowVerdictMode is inproc when absent, oop-v1 when tagged; never invents oop",
    guard: "row-effective",
    run(l) {
      assert.equal(l.row.rowVerdictMode({}), "inproc");
      assert.equal(l.row.rowVerdictMode(v4Row() as unknown as Row.LoopRow), "inproc");
      assert.equal(l.row.rowVerdictMode(v4Row({ verdictMode: "oop-v1" }) as unknown as Row.LoopRow), "oop-v1");
      // near miss: a consumer must not treat a tagged row as inproc
      assert.notEqual(l.row.rowVerdictMode(v4Row({ verdictMode: "oop-v1" }) as unknown as Row.LoopRow), "inproc");
    },
  },
  {
    id: "writer: oop-v1 early-refuse tags the row; default and inproc omit",
    guard: "loop-tag",
    run(l) {
      const oop = writeRow(l, { verdictMode: "oop-v1" });
      assert.equal(l.row.loopRowProblem(oop), null, String(l.row.loopRowProblem(oop)));
      assert.equal(oop.code, "TASK_INVALID");
      assert.equal(oop.verdictMode, "oop-v1");
      assert.equal(l.row.rowVerdictMode(oop), "oop-v1");

      const def = writeRow(l, {});
      assert.equal(l.row.loopRowProblem(def), null);
      assert.equal("verdictMode" in def, false, "default omits");
      assert.equal(l.row.rowVerdictMode(def), "inproc");

      const inp = writeRow(l, { verdictMode: "inproc" });
      assert.equal(l.row.loopRowProblem(inp), null);
      assert.equal("verdictMode" in inp, false, "explicit inproc omits");
      assert.equal(l.row.rowVerdictMode(inp), "inproc");
    },
  },
  {
    id: "writer: oop-v1 + repair-retry refused-before-cand still tags verdictMode; inproc repair-retry omits it",
    guard: "loop-tag",
    run(l) {
      const oopRr = writeRow(l, { verdictMode: "oop-v1", repairRetry: "repair-retry-v1" });
      // candidacy fails first (no STAGE2 cand in env) or TASK_INVALID — either way the row must carry both tags under oop
      assert.equal(oopRr.verdictMode, "oop-v1");
      assert.equal(oopRr.repairRetry, "repair-retry-v1");
      assert.equal(l.row.loopRowProblem(oopRr), null, String(l.row.loopRowProblem(oopRr)));

      const inRr = writeRow(l, { verdictMode: "inproc", repairRetry: "repair-retry-v1" });
      assert.equal(inRr.code, "RETRY_INPROC_REFUSED");
      assert.equal(inRr.repairRetry, "repair-retry-v1");
      assert.equal("verdictMode" in inRr, false, "refused-inproc repair-retry omits verdictMode");
      assert.equal(l.row.rowVerdictMode(inRr), "inproc");
      assert.equal(l.row.loopRowProblem(inRr), null, String(l.row.loopRowProblem(inRr)));
    },
  },
  {
    id: "defaults: EDIT_SCOPE_POLICY and DEFAULT_VERDICT_MODE unchanged; for-credit not enabled",
    run(l) {
      assert.deepEqual(l.loop.EDIT_SCOPE_POLICY, { edit: ["export-keyword", "in-body"], load: ["export-keyword"] });
      assert.equal(l.loop.DEFAULT_VERDICT_MODE, "inproc");
      assert.equal(l.loop.selectVerdictMode(undefined), "inproc");
      assert.equal(l.loop.selectVerdictMode("oop-v1"), "oop-v1");
    },
  },
];

for (const c of CASES) test(`M212: ${c.id}`, () => c.run({ loop: Loop, row: Row }));

test("M212: the committed loop log still parses (add-only; pre-M212 rows omit the key)", () => {
  const r = Row.parseLoopLog(readFileSync(join(ROOT, Row.LOOP_LOG), "utf8"));
  assert.ok(!("problem" in r), "problem" in r ? `line ${r.line}: ${r.problem}` : "");
  for (const row of r.rows) assert.equal(Row.rowVerdictMode(row), row.verdictMode ?? "inproc");
});

// ---- mutants
const rowSource = readFileSync(join(libDir, "looprow.ts"), "utf8");
const loopSource = readFileSync(join(libDir, "loop.ts"), "utf8");
const TAG = /\/\/ m212-guard:([a-z0-9-]+)\s*$/;
const rowGuards = rowSource.split("\n").flatMap((l, i) => { const m = TAG.exec(l); return m ? [{ id: m[1]!, line: i, file: "row" as const }] : []; });
const loopGuards = loopSource.split("\n").flatMap((l, i) => { const m = TAG.exec(l); return m ? [{ id: m[1]!, line: i, file: "loop" as const }] : []; });
const ALL_GUARDS = [...rowGuards, ...loopGuards];

const SEMANTIC: [string, "row" | "loop", string, string][] = [
  ["tag-as-inproc-ok", "row", "if (!(LOOP_VERDICT_MODES_TAGGED as readonly string[]).includes(r.verdictMode)) return \"verdict_mode\"; // m212-guard:row-tag-value", "if (false) return \"verdict_mode\"; // m212-guard:row-tag-value"],
  ["writer-drops-tag", "loop", "...(verdictMode === \"oop-v1\" ? { verdictMode: \"oop-v1\" as const } : {}), // non-inproc only; inproc omits // m212-guard:loop-tag", ""],
  ["effective-always-inproc", "row", "return row.verdictMode ?? \"inproc\"; // m212-guard:row-effective", "return \"inproc\"; // m212-guard:row-effective"],
];

let dir: string;
before(() => { dir = mkdtempSync(join(tmpdir(), "peaceai-m212-mut-")); });
after(() => rmSync(dir, { recursive: true, force: true }));

function rewrite(text: string, rowFile: string | null): string {
  const tsPath = createRequire(join(libDir, "loop.ts")).resolve("typescript");
  return text
    .replace(/from "\.\/([a-z0-9-]+\.ts)"/g, (_, f: string) => `from ${JSON.stringify(pathToFileURL(f === "looprow.ts" && rowFile ? rowFile : join(libDir, f)).href)}`)
    .replace(/from "typescript"/, `from ${JSON.stringify(pathToFileURL(tsPath).href)}`)
    .replace(/import\.meta\.dirname/g, JSON.stringify(libDir));
}

async function killed(name: string, rowText: string, loopText: string): Promise<{ failed: string[]; crashed: string[] }> {
  const rowFile = join(dir, `mutant-${name}-looprow.ts`);
  const loopFile = join(dir, `mutant-${name}-loop.ts`);
  writeFileSync(rowFile, rewrite(rowText, null));
  writeFileSync(loopFile, rewrite(loopText, rowFile));
  const row = await import(pathToFileURL(rowFile).href + `?m=${name}`) as typeof Row;
  const loop = await import(pathToFileURL(loopFile).href + `?m=${name}`) as typeof Loop;
  const failed: string[] = [], crashed: string[] = [];
  for (const c of CASES) {
    try { c.run({ loop, row }); } catch (e) { (e instanceof assert.AssertionError ? failed : crashed).push(c.id); }
  }
  return { failed, crashed };
}

test("M212 mutation: the guard list is exact", () => {
  assert.deepEqual(ALL_GUARDS.map((g) => g.id).sort(), ["loop-tag", "row-effective", "row-tag-value"]);
});

test("M212 mutation: the unmutated sources pass every case (control)", async () => {
  const r = await killed("control", rowSource, loopSource);
  assert.deepEqual(r, { failed: [], crashed: [] });
});

for (const g of ALL_GUARDS) {
  test(`M212 mutation: deleting guard ${g.id} fails a case`, async () => {
    const src = g.file === "row" ? rowSource : loopSource;
    const lines = src.split("\n");
    lines.splice(g.line, 1);
    const rowText = g.file === "row" ? lines.join("\n") : rowSource;
    const loopText = g.file === "loop" ? lines.join("\n") : loopSource;
    const r = await killed(`guard-${g.id}`, rowText, loopText);
    assert.ok(r.failed.length > 0, `guard ${g.id} survived (crashed: ${r.crashed.join("; ")})`);
  });
}

for (const [id, file, from, to] of SEMANTIC) {
  test(`M212 mutation: semantic mutant ${id} fails a case`, async () => {
    const src = file === "row" ? rowSource : loopSource;
    assert.equal(src.split(from).length, 2, `${id}: anchor must occur exactly once`);
    const mutated = src.replace(from, to);
    const r = await killed(`sem-${id}`, file === "row" ? mutated : rowSource, file === "loop" ? mutated : loopSource);
    assert.ok(r.failed.length > 0, `semantic mutant ${id} survived (crashed: ${r.crashed.join("; ")})`);
  });
}
