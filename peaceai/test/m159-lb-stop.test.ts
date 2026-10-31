// M159 (limit-breaker step 3): the stopping rule. An eval improves only when val < best - --min-delta (finite values
// only); --patience evals without improvement stop the run; --steps / --max-steps-this-run / --max-seconds /
// --deadline bound it; a non-finite training loss stops it BEFORE the update ("nonfinite", never resumable). Every run
// writes stop.json saying why it stopped. Every tagged guard is mutation-checked.
import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";
import { json, MODEL, mutationCheck, ok, refused, runCase, tinyCorpus, withDir } from "./m157-lbtrain-mut.ts";

const KEYS = ["bestStep", "bestVal", "elapsedSeconds", "lastVal", "maxSeconds", "minDelta", "patience", "reason", "schema", "stale", "step", "totalSteps"];

test("m159: improved() is val < best - min_delta on finite values only", () => {
  assert.equal(runCase(MODEL, "near-stop"), "ok False True True");
  assert.equal(runCase(MODEL, "stop-val-finite"), "improved=False");
});

test("m159: min-delta makes patience stop early, and stop.json says why; the near miss runs to --steps", () => withDir((dir) => {
  const corpus = tinyCorpus(dir);
  ok(["--corpus", corpus, "--work", join(dir, "a"), "--steps", "8", "--patience", "1", "--min-delta", "10"]);
  const a = json(join(dir, "a/stop.json"));
  assert.deepEqual(Object.keys(a).sort(), KEYS);
  assert.deepEqual([a.schema, a.reason, a.step, a.bestStep, a.stale, a.minDelta, a.patience], ["peaceai-lb-stop:v1", "patience", 4, 2, 1, 10, 1]);
  assert.equal(json(join(dir, "a/timing.json")).stopReason, "patience");
  ok(["--corpus", corpus, "--work", join(dir, "b"), "--steps", "8", "--patience", "1"]);
  const b = json(join(dir, "b/stop.json"));
  assert.deepEqual([b.reason, b.step, b.bestStep, b.stale], ["steps", 8, 8, 0], "min-delta 0: every eval improves on this corpus");
  ok(["--corpus", corpus, "--work", join(dir, "c"), "--steps", "8", "--max-seconds", "0"]);
  assert.equal(json(join(dir, "c/stop.json")).reason, "max_seconds");
}));

test("m159: a non-finite loss stops before the update, keeps best.npz finite, and the chain ends", () => withDir((dir) => {
  const corpus = tinyCorpus(dir);
  ok(["--corpus", corpus, "--work", join(dir, "n"), "--steps", "6", "--lr", "1e30", "--warmup", "1", "--save-dir", join(dir, "s"), "--marker", join(dir, "m.json")]);
  const s = json(join(dir, "n/stop.json"));
  assert.deepEqual([s.reason, s.step, s.bestVal], ["nonfinite", 1, null]);
  const m = json(join(dir, "m.json"));
  assert.deepEqual([m.more, m.stopReason], [false, "nonfinite"], "never resumed");
}));

test("m159: refusals: negative patience, negative or NaN min-delta", () => withDir((dir) => {
  const corpus = tinyCorpus(dir);
  refused(["--corpus", corpus, "--work", join(dir, "a"), "--patience", "-1"], "STOP_BAD_ARGS");
  refused(["--corpus", corpus, "--work", join(dir, "b"), "--min-delta", "-0.5"], "STOP_BAD_ARGS");
  refused(["--corpus", corpus, "--work", join(dir, "c"), "--min-delta", "nan"], "STOP_BAD_ARGS");
}));

test("m159: mutation check: disabling any stop-rule guard changes its case's outcome", () => {
  mutationCheck(/^stop-/, { "stop-patience": "STOP_BAD_ARGS", "stop-min-delta": "STOP_BAD_ARGS", "stop-val-finite": "improved=False" });
});
