// M166 (model-v1 rows, ruling c of spec/edit-proposer-model-v1.md): loop rows v4 = v3 (planner keys as today) plus
// `modelManifestSha256`, the model manifest sha256 behind a model-backed proposer's ranking (null for a proposer
// without a model). The loop writes v4 rows from M166 on; v1 / v2 / v3 rows keep validating (the log is add-only).
// Tiny fixtures only: no model, no network, no task run past the first refusal.
//  - validator cases (v4 rules, and v1 / v2 / v3 near misses);
//  - writer cases: runLoopTask on a task that is refused before any fetch, with and without a model-backed proposer;
//  - mutants: each "// m166-guard:<id>" line of peaceai/lib/looprow.ts deleted, plus fixed semantic rewrites of
//    looprow.ts and loop.ts; each must fail at least one case with an assertion.
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
  return {
    schema: "peaceai-plan-loop:v4", at: "2026-10-31T08:00:00Z", set: "public", taskFileSha256: H("a"), taskKey: "0123456789abcdef", repo: "o/r", commit: "c".repeat(40),
    workspace: "d".repeat(40), loop: "loop-v2", loopSha256: H("e"), proposer: "model-v1", planner: "plan-only-v4", plannerSha256: H("f"), modelManifestSha256: H("1"), lm: "not-loadable",
    code: "ATTEMPT_LIMIT", maxAttempts: 3, attempts: 3, result: "fail", attemptCodes: [["TEST_FAIL"], ["TEST_FAIL"], ["TEST_FAIL"]], tests: { total: 1, passedByPeaceAI: 0, filledByTeam: 1 }, runner: "node-test", deps: "none", baseline: { total: 1, passing: 0, failing: 1 },
    ...over,
  };
}
const refusedAt0 = { code: "PROPOSER_FAILED", attempts: 0, result: "refused", attemptCodes: [], tests: null };

interface Libs { loop: typeof Loop; row: typeof Row }
interface Case { id: string; run: (l: Libs) => void }

const BAD_TASK = { id: "m166-bad", repo: "o/r", commit: "c".repeat(40) } as never; // refused TASK_INVALID before any fetch
const noFetch = () => { throw new Error("m166: no fetch expected"); };
function writeRow(l: Libs, proposer: Loop.Proposer): Row.LoopRow {
  return l.loop.runLoopTask(BAD_TASK, "public", H("a"), { root: ROOT, fetcher: noFetch as never, proposer, maxAttempts: 1, runMs: 1000, env: {}, rules: [], training: new Set<string>() }).row;
}

const CASES: Case[] = [
  {
    id: "row: a v4 model-v1 row with a manifest sha256 validates; malformed digests are model_sha",
    run(l) {
      assert.equal(l.row.loopRowProblem(v4Row()), null);
      for (const h of ["F".repeat(64), "1".repeat(63), "1".repeat(65), "", 7, false]) assert.equal(l.row.loopRowProblem(v4Row({ modelManifestSha256: h })), "model_sha", JSON.stringify(h));
      assert.equal(l.row.loopRowProblem(v4Row({ proposer: "repair-v1", modelManifestSha256: "F".repeat(64) })), "model_sha", "a malformed digest on a non-model row is model_sha first");
    },
  },
  {
    id: "row: a model-backed proposer's row must be v4; near miss: the same row as v4",
    run(l) {
      const { modelManifestSha256: _m, ...v3 } = v4Row({ schema: "peaceai-plan-loop:v3" });
      assert.equal(l.row.loopRowProblem(v3), "model_needs_v4");
      const { planner: _p, plannerSha256: _s, ...v2 } = v3;
      assert.equal(l.row.loopRowProblem({ ...v2, schema: "peaceai-plan-loop:v2" }), "model_needs_v4");
      assert.equal(l.row.loopRowProblem({ ...v3, proposer: "repair-v1" }), null, "near miss: a v3 repair-v1 row");
      assert.deepEqual([...l.row.LOOP_MODEL_PROPOSERS], ["model-v1"]);
    },
  },
  {
    id: "row: a v4 row of a proposer without a model carries null, never a digest",
    run(l) {
      for (const p of ["rules-v1", "repair-v1", "model-v2"]) {
        assert.equal(l.row.loopRowProblem(v4Row({ proposer: p, modelManifestSha256: null })), null, p);
        assert.equal(l.row.loopRowProblem(v4Row({ proposer: p })), "model_sha_unexpected", p);
      }
    },
  },
  {
    id: "row: a model-v1 row with attempts must name the model; null only when no attempt ran (no usable ranking)",
    run(l) {
      assert.equal(l.row.loopRowProblem(v4Row({ modelManifestSha256: null })), "model_sha_missing");
      assert.equal(l.row.loopRowProblem(v4Row({ modelManifestSha256: null, code: "PASS", attempts: 1, result: "pass", attemptCodes: [[]], tests: { total: 1, passedByPeaceAI: 1, filledByTeam: 0 } })), "model_sha_missing");
      assert.equal(l.row.loopRowProblem(v4Row({ modelManifestSha256: null, ...refusedAt0 })), null, "near miss: refused before any attempt");
      assert.equal(l.row.loopRowProblem(v4Row({ ...refusedAt0 })), null, "near miss: refused with the model named");
    },
  },
  {
    id: "row: v4 keys are exact (the key is required, may be null); v1 / v2 / v3 rows still validate and cannot carry it",
    run(l) {
      const { modelManifestSha256: _m, ...noKey } = v4Row({ proposer: "repair-v1" });
      assert.equal(l.row.loopRowProblem(noKey), "loop_keys", "a v4 row without the key");
      assert.equal(l.row.loopRowProblem({ ...v4Row(), extra: 1 }), "loop_keys");
      const v3: Record<string, unknown> = { ...noKey, schema: "peaceai-plan-loop:v3" };
      assert.equal(l.row.loopRowProblem(v3), null, "near miss: a v3 row as before");
      assert.equal(l.row.loopRowProblem({ ...v3, modelManifestSha256: null }), "loop_keys", "a v3 row cannot carry the key");
      const { planner: _p, plannerSha256: _s, ...v2 } = v3;
      assert.equal(l.row.loopRowProblem({ ...v2, schema: "peaceai-plan-loop:v2" }), null, "near miss: a v2 row as before");
      assert.equal(l.row.loopRowProblem({ ...v2, schema: "peaceai-plan-loop:v2", modelManifestSha256: null }), "loop_keys");
      const { runner: _r, deps: _d, baseline: _b, ...v1 } = v2;
      assert.equal(l.row.loopRowProblem({ ...v1, schema: "peaceai-plan-loop:v1", loop: "loop-v1" }), null, "near miss: a v1 row as before");
      assert.equal(l.row.loopRowProblem({ ...v1, schema: "peaceai-plan-loop:v1", loop: "loop-v1", modelManifestSha256: null }), "loop_keys");
      assert.equal(l.row.loopRowProblem(v4Row({ schema: "peaceai-plan-loop:v5" })), "schema");
      assert.equal(l.row.loopRowProblem(v4Row({ loop: "loop-v1" })), "loop", "v4 is still loop-v2");
      assert.equal(l.row.loopRowProblem(v4Row({ planner: "plan-only-v9" })), "planner", "v4 keeps v3's planner rules");
    },
  },
  {
    id: "writer: the loop writes v4 rows; a proposer without a model gives null, a model-backed one its manifest sha256",
    run(l) {
      const plain = writeRow(l, { name: "repair-v1", next: () => ({ refuse: "NO_EDIT" }) });
      assert.equal(plain.code, "TASK_INVALID");
      assert.equal(plain.schema, "peaceai-plan-loop:v4");
      assert.ok("modelManifestSha256" in plain && plain.modelManifestSha256 === null);
      assert.equal(l.row.loopRowProblem(plain), null);
      const model = writeRow(l, { name: "model-v1", modelManifestSha256: H("2"), next: () => ({ refuse: "NO_EDIT" }) });
      assert.equal(model.modelManifestSha256, H("2"));
      assert.equal(l.row.loopRowProblem(model), null);
      const none = writeRow(l, { name: "model-v1", modelManifestSha256: null, next: () => ({ refuse: "NO_EDIT" }) });
      assert.equal(none.modelManifestSha256, null);
      assert.equal(l.row.loopRowProblem(none), null, "no attempt ran: null is allowed");
    },
  },
];

for (const c of CASES) test(`M166: ${c.id}`, () => c.run({ loop: Loop, row: Row }));

test("M166: the committed loop log still parses (v1 / v2 / v3 rows unchanged; counts only)", () => {
  const r = Row.parseLoopLog(readFileSync(join(ROOT, Row.LOOP_LOG), "utf8"));
  assert.ok(!("problem" in r), "the committed log no longer validates");
});

// ---- mutants

const rowSource = readFileSync(join(libDir, "looprow.ts"), "utf8");
const loopSource = readFileSync(join(libDir, "loop.ts"), "utf8");
const TAG = /\/\/ m166-guard:([a-z0-9-]+)\s*$/;
const guards = rowSource.split("\n").flatMap((l, i) => { const m = TAG.exec(l); return m ? [{ id: m[1]!, line: i }] : []; });
// [id, file, from, to]: each `from` must occur exactly once
const SEMANTIC: [string, "row" | "loop", string, string][] = [
  ["v4-not-recognised", "row", "const v4 = r.schema === LOOP_SCHEMA_V4;", "const v4 = false;"],
  ["v4-not-v3", "row", "const v3 = r.schema === LOOP_SCHEMA_V3 || v4;", "const v3 = r.schema === LOOP_SCHEMA_V3;"],
  ["no-model-proposers", "row", "const model = (LOOP_MODEL_PROPOSERS as readonly string[]).includes(r.proposer);", "const model = false;"],
  ["v4-keys-as-v3", "row", "const keys = v4 ? KEYS_V4 : v3", "const keys = v4 ? [...KEYS_V3, \"modelManifestSha256\"].slice(0, -1) : v3"],
  ["writer-v3", "loop", "schema: LOOP_SCHEMA_V4, at: now(),", "schema: \"peaceai-plan-loop:v3\" as never, at: now(),"],
  ["writer-null", "loop", "modelManifestSha256: o.proposer.modelManifestSha256 ?? null,", "modelManifestSha256: null,"],
  ["writer-dropped", "loop", "modelManifestSha256: o.proposer.modelManifestSha256 ?? null,", ""],
];

let dir: string;
before(() => { dir = mkdtempSync(join(tmpdir(), "peaceai-m166-mut-")); });
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
  const row = await import(pathToFileURL(rowFile).href) as typeof Row;
  const loop = await import(pathToFileURL(loopFile).href) as typeof Loop;
  const failed: string[] = [], crashed: string[] = [];
  for (const c of CASES) {
    try { c.run({ loop, row }); } catch (e) { (e instanceof assert.AssertionError ? failed : crashed).push(c.id); }
  }
  return { failed, crashed };
}

test("M166 mutation: the guard list is exact", () => {
  assert.deepEqual(guards.map((g) => g.id).sort(), ["row-model-missing", "row-model-sha", "row-model-unexpected", "row-model-v4"]);
});

test("M166 mutation: the unmutated sources pass every case (control)", async () => {
  const r = await killed("control", rowSource, loopSource);
  assert.deepEqual(r, { failed: [], crashed: [] });
});

for (const g of guards) {
  test(`M166 mutation: deleting guard ${g.id} fails a case`, async () => {
    const lines = rowSource.split("\n");
    lines.splice(g.line, 1);
    const r = await killed(`guard-${g.id}`, lines.join("\n"), loopSource);
    assert.ok(r.failed.length > 0, `guard ${g.id} survived (crashed: ${r.crashed.join("; ")})`);
  });
}

for (const [id, file, from, to] of SEMANTIC) {
  test(`M166 mutation: semantic mutant ${id} fails a case`, async () => {
    const src = file === "row" ? rowSource : loopSource;
    assert.equal(src.split(from).length, 2, `${id}: anchor must occur exactly once`);
    const mutated = src.replace(from, to);
    const r = await killed(`sem-${id}`, file === "row" ? mutated : rowSource, file === "loop" ? mutated : loopSource);
    assert.ok(r.failed.length > 0, `semantic mutant ${id} survived (crashed: ${r.crashed.join("; ")})`);
  });
}
