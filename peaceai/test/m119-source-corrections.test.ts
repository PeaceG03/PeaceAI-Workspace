// M119 add-only source corrections: the Results task records of #540, #541 and #513-#516 say source "peace"
// although the issue bodies' own provenance says the team picked them (PeaceAI-Workspace#544 audit). Results
// records are never edited; the reader applies peaceai/source-corrections.jsonl instead.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { buildRecords, taskEntry } from "../lib/records.ts";
import { toExample } from "../lib/ranker/pipeline.ts";
import { effectiveVerdict } from "../lib/records.ts";
import {
  correctedSource, correctionKey, correctionsAddOnly, loadSourceCorrections, parseSourceCorrections, SOURCE_CORRECTIONS_FILE,
} from "../lib/sourcecorrections.ts";

const EXPECTED = [
  [513, "40239699762"], [514, "40239964384"], [515, "40240249590"], [516, "40240521131"], [516, "40266834483"],
  [540, "40388615799"], [541, "40396646762"],
] as const;
const text = readFileSync(SOURCE_CORRECTIONS_FILE, "utf8");

test("the committed corrections are exactly the seven mislabelled records, all lowered to builder", () => {
  const { corrections, errors } = parseSourceCorrections(text);
  assert.deepEqual(errors, []);
  assert.deepEqual(corrections.map((c) => [c.issue, c.runId]), EXPECTED.map(([i, r]) => [i, r]));
  for (const c of corrections) {
    assert.equal(c.recorded, "peace");
    assert.equal(c.source, "builder");
    assert.match(c.reason, /team|picked/i);
  }
  assert.equal(loadSourceCorrections().size, 7);
});

test("the reader applies a correction only to its own record, and only downward", () => {
  for (const [issue, runId] of EXPECTED) {
    assert.equal(correctedSource({ issue, runId }, "peace"), "builder");
    assert.equal(correctedSource({ issue, runId }, "builder"), "builder");
  }
  assert.equal(correctedSource({ issue: 540, runId: "1" }, "peace"), "peace"); // another run of the same issue
  assert.equal(correctedSource({ issue: 501, runId: "40388615799" }, "peace"), "peace");
  assert.equal(correctedSource({ issue: 501, runId: "1" }, "builder"), "builder");
});

const record = (issue: number, runId: string) =>
  buildRecords({ issue, runId, recordedAt: "2026-10-26T00:00:00Z", baseSha: "a".repeat(40), title: "t", body: "b", source: "peace" }, [], [], "seed");

test("summary entries and ranker examples use the corrected source; the record itself is untouched", () => {
  const corrected = record(540, "40388615799");
  assert.equal(corrected.task.source, "peace"); // what Results holds stays as written
  assert.equal(taskEntry(corrected.task, corrected.ranking, []).source, "builder");
  assert.equal(toExample(corrected.task, corrected.ranking, effectiveVerdict([]), () => "").source, "builder");
  const other = record(501, "40000000000");
  assert.equal(taskEntry(other.task, other.ranking, []).source, "peace");
});

const line = (o: Record<string, unknown> = {}) =>
  JSON.stringify({ schema: "peaceai-source-correction:v1", issue: 1, runId: "123", recorded: "peace", source: "builder", reason: "team-picked by its own credit line", filedAt: "2026-10-26T21:45:00Z", filedBy: "Builder", ...o });

test("invalid corrections are refused: never to peace, exact keys, no duplicates", () => {
  assert.deepEqual(parseSourceCorrections(`${line()}\n`).errors, []);
  for (const bad of [
    line({ source: "peace" }), line({ recorded: "builder" }), line({ runId: 123 }), line({ runId: "01" }), line({ issue: 0 }),
    line({ reason: "" }), line({ filedAt: "today" }), line({ extra: 1 }), "{", "[]",
  ])
    assert.notDeepEqual(parseSourceCorrections(`${bad}\n`).errors, [], bad);
  assert.match(parseSourceCorrections(`${line()}\n${line()}\n`).errors.join(), /duplicate/);
  assert.match(parseSourceCorrections(line()).errors.join(), /newline/);
  const dir = mkdtempSync(join(tmpdir(), "m119-corr-"));
  try {
    const p = join(dir, "c.jsonl");
    writeFileSync(p, `${line({ source: "peace" })}\n`);
    assert.throws(() => loadSourceCorrections(p), /source must be "builder"/);
    writeFileSync(p, `${line()}\n`);
    assert.ok(loadSourceCorrections(p).has(correctionKey(1, "123")));
    assert.equal(loadSourceCorrections(join(dir, "missing.jsonl")).size, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("add-only: lines may be added, never changed or removed", () => {
  const a = `${line()}\n`;
  const b = `${a}${line({ issue: 2 })}\n`;
  assert.deepEqual(correctionsAddOnly("", a), []);
  assert.deepEqual(correctionsAddOnly(a, b), []);
  assert.notDeepEqual(correctionsAddOnly(b, a), []);
  assert.notDeepEqual(correctionsAddOnly(a, `${line({ reason: "changed reason text" })}\n`), []);
});

test("wiring: CI checks add-only against the base; the reader paths use correctedSource", () => {
  const wf = readFileSync(".github/workflows/builder-log.yml", "utf8");
  assert.match(wf, /tsx peaceai\/bin\/source-corrections-check\.ts --base "\$BASE_SHA"/);
  assert.match(readFileSync("peaceai/lib/records.ts", "utf8"), /source: correctedSource\(task, taskSourceOf\(task\)\)/);
  assert.match(readFileSync("peaceai/lib/ranker/pipeline.ts", "utf8"), /source: correctedSource\(task, taskSourceOf\(task\)\)/);
});
