// M190 (batch 24): failing test names for vitest / jest runs. Runs every case of m190-cases.ts (the end-to-end ones need
// the stage-2 candidate uid, M151_CAND; elsewhere skipped) plus the selfpropose.ts plumbing: guardedRun hands a caller
// that asks for it the run's raw stdout through a sink, and RawRun (what stage-2 run records hold) never carries it.
// Spec: peaceai/spec/json-failing-names-m190.md. Nothing here is modelled on a task repo or a reference diff.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import * as deps from "../lib/loopdeps.ts";
import * as loop from "../lib/loop.ts";
import * as prop from "../lib/editpropose.ts";
import { guardedRun, type RunSink } from "../lib/selfpropose.ts";
import { CASES } from "./m190-cases.ts";
import { setup as setup151, teardown as teardown151 } from "./m151-fixtures.ts";

const ROOT = resolve(import.meta.dirname, "../..");
const ctx = { m151: setup151(), scratch: mkdtempSync(join(tmpdir(), "peaceai-m190-")) };
after(() => { teardown151(ctx.m151); rmSync(ctx.scratch, { recursive: true, force: true }); });

for (const c of CASES) {
  test(`M190: ${c.id}`, (t) => {
    if (c.needsCand && !ctx.m151.cand) { t.skip("needs the stage-2 candidate uid (M151_CAND)"); return; }
    c.run({ deps, loop, prop }, ctx);
  });
}

test("M190: guardedRun gives the raw stdout to a sink only; the returned run has the same keys as before", () => {
  const d = join(ctx.scratch, "sink");
  mkdirSync(d, { recursive: true });
  symlinkSync(join(ROOT, "node_modules"), join(d, "node_modules"));
  writeFileSync(join(d, "p.mjs"), 'process.stdout.write("hello\\n# failed-names -\\n# pass 2\\n# fail 1\\n");\n');
  const sink: RunSink = { stdout: "" };
  const r = guardedRun(d, ["p.mjs"], Date.now() + 60_000, [], null, null, sink);
  assert.equal(sink.stdout, "hello\n# failed-names -\n# pass 2\n# fail 1\n");
  assert.deepEqual(Object.keys(r).sort(), ["exitCode", "fail", "leftovers", "pass", "tampered"]);
  assert.deepEqual([r.pass, r.fail], [2, 1]);
  const plain = guardedRun(d, ["p.mjs"], Date.now() + 60_000, [], null, null);
  assert.deepEqual(plain, r, "no sink: the same run");
});

test("M190: the shim always writes the names line right before its counts, for every runner and exit path", () => {
  const src = deps.SHIM_SOURCE;
  assert.match(src, /# failed-names \$\{names \?/);
  assert.equal((src.match(/process\.stdout\.write\(/g) ?? []).length, 1, "the one write is done()'s");
  assert.match(src, /done\(pass, fail, synth \|\| \(fail \? 1 : 0\), failedNames \?\? null\);/);
});
