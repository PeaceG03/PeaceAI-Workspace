// M159 (limit-breaker step 3): the stopping rule. An eval improves only when val < best - --min-delta (finite values
// only); --patience evals without improvement stop the run; --steps / --max-steps-this-run / --max-seconds /
// --deadline bound it; a non-finite training loss stops it BEFORE the update ("nonfinite", never resumable). Every run
// writes stop.json saying why it stopped -- including every refusal / crash ({reason: "error", code, step}, the code
// a fixed name, never a message or path), and a stale stop.json is removed first. Every tagged guard is
// mutation-checked; the train.py wrapper has text mutants.
import assert from "node:assert/strict";
import { existsSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { json, MODEL, mutationCheck, ok, refused, runCase, stopOf, textMutant, tinyCorpus, train, withDir } from "./m157-lbtrain-mut.ts";

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

const err = (code: string, step: number | null = null) => ({ schema: "peaceai-lb-stop:v1", reason: "error", code, step });

test("m159: every exit writes stop.json: refusals (args, SAVE_*, LORA_*), crashes; a stale one is removed first", () => withDir((dir) => {
  const corpus = tinyCorpus(dir);
  const stale = '{"reason": "patience", "stale": "from an earlier run"}\n';
  writeFileSync(join(dir, "pre.json"), stale);
  const plant = (w: string) => { ok(["--corpus", corpus, "--work", w, "--steps", "0"]); writeFileSync(join(w, "stop.json"), stale); };
  plant(join(dir, "a"));
  refused(["--corpus", corpus, "--work", join(dir, "a"), "--patience", "-1"], "STOP_BAD_ARGS");
  assert.deepEqual(stopOf(join(dir, "a")), err("STOP_BAD_ARGS"));
  ok(["--corpus", corpus, "--work", join(dir, "sv"), "--steps", "2", "--save-dir", join(dir, "s"), "--marker", join(dir, "m.json")]);
  const m = json(join(dir, "m.json"));
  refused(["--corpus", corpus, "--work", join(dir, "b"), "--steps", "4", "--resume-from", join(dir, "s", m.save), "--resume-manifest-sha", "0".repeat(64)], "SAVE_MANIFEST_SHA");
  assert.deepEqual(stopOf(join(dir, "b")), err("SAVE_MANIFEST_SHA"));
  refused(["--corpus", corpus, "--work", join(dir, "c"), "--lora-rank", "2"], "LORA_NEEDS_BASE");
  assert.deepEqual(stopOf(join(dir, "c")), err("LORA_NEEDS_BASE"));
  const r = train(["--corpus", join(dir, "no-such-corpus"), "--work", join(dir, "d")]);
  assert.notEqual(r.status, 0);
  assert.deepEqual(stopOf(join(dir, "d")), err("TRAIN_CRASH"), "a crash's stop.json names no message or path");
  // a stop.json symlink is removed as a link: the file it points at is never written
  ok(["--corpus", corpus, "--work", join(dir, "e"), "--steps", "0"]);
  rmSync(join(dir, "e/stop.json")); symlinkSync(join(dir, "pre.json"), join(dir, "e/stop.json"));
  // near miss: a good run after a refusal replaces the error record with its own
  ok(["--corpus", corpus, "--work", join(dir, "a"), "--steps", "2"]);
  assert.equal(json(join(dir, "a/stop.json")).reason, "steps");
  ok(["--corpus", corpus, "--work", join(dir, "e"), "--steps", "2"]);
  assert.equal(json(join(dir, "e/stop.json")).reason, "steps");
  assert.equal(readFileSync(join(dir, "pre.json"), "utf8"), stale);
  // text mutants: without the stale removal the old record survives a refusal; without the handler's write there is none
  const keep = textMutant(dir, "m-keep", [{ file: "model/train.py", from: "if os.path.lexists(STOP_PATH):  # M159: a stale", to: "if False:  # M159: a stale" }]);
  plant(join(dir, "k"));
  assert.equal(train(["--corpus", corpus, "--work", join(dir, "k"), "--patience", "-1"], join(keep, "model/train.py")).status, 1);
  assert.equal(readFileSync(join(dir, "k/stop.json"), "utf8"), stale, "mutant killed: the stale record survives");
  const none = textMutant(dir, "m-none", [{ file: "model/train.py", from: "lbtrain.write_stop(STOP_PATH, lbtrain.error_stop_record(CODE, step))", to: "pass" }]);
  assert.equal(train(["--corpus", corpus, "--work", join(dir, "n"), "--patience", "-1"], join(none, "model/train.py")).status, 1);
  assert.equal(existsSync(join(dir, "n/stop.json")), false, "mutant killed: no stop.json on a refusal");
}));

test("m159: the error code is a fixed name: a message or path becomes TRAIN_ERROR, a clean exit writes none", () => {
  assert.equal(runCase(MODEL, "near-stop-code"), "REPLAY_REFUSED SAVE_FILE_SET None TRAIN_ERROR TRAIN_CRASH INTERRUPTED");
});

test("m159: mutation check: disabling any stop-rule guard changes its case's outcome", () => {
  mutationCheck(/^stop-/, { "stop-patience": "STOP_BAD_ARGS", "stop-min-delta": "STOP_BAD_ARGS", "stop-val-finite": "improved=False",
    "stop-clean-exit": "code=None", "stop-code": "code=TRAIN_ERROR" });
});
