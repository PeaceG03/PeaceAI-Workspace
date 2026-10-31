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
    "stop-clean-exit": "code=None", "stop-code": "code=TRAIN_ERROR",
    "stop-val-split-mode": "VAL_SPLIT_BAD", "stop-val-split-replay": "VAL_SPLIT_BAD", "stop-val-disjoint-short": "VAL_NOT_DISJOINT",
    "stop-val-best-split": "best={'val': inf, 'step': 0, 'stale': 0, 'valSplit': 'disjoint'}" });
});

// batch 6 (Auditor's #660 note): early-stop validation must not use export.py's 96 held-out eval windows.
test("batch 6 val split: disjoint val windows share no token with export's 96 eval windows; the legacy split shares all 16; near misses", () => {
  assert.equal(runCase(MODEL, "near-val-split"),
    "ok first disjoint 97..112:16:shared=0 97..112:16:shared=0 97..112:16:shared=0 98:VAL_NOT_DISJOINT 112:VAL_NOT_DISJOINT w96shared=1 first=0..15:shared=16 same=4 legacy=4 none={'val': inf, 'step': 0, 'stale': 0}");
  // the window count lbtrain assumes is export.py's: n_eval = min(n, 96), window k = held[k*T : k*T+T+1]
  const exp = readFileSync(join(MODEL, "export.py"), "utf8");
  assert.equal(exp.split("n_eval = min(n, 96)\n").length, 2, "export.py evaluates min(n, 96) windows");
  assert.ok(exp.includes("held[k * T:k * T + T]") && exp.includes("held[k * T + 1:k * T + T + 1]"), "export.py window k = held[kT .. kT+T]");
  assert.match(readFileSync(join(MODEL, "lbtrain.py"), "utf8"), /^EXPORT_EVAL_WINDOWS = 96 /m);
});

// batch 7 (Auditor's #661 note): 98..112 windows used to validate on fewer than 16 windows; now refused.
test("batch 7 val split boundary: 112 windows refused, 113 accepted with exactly 16 windows; the old 98 bound is a killed mutant", () => withDir((dir) => {
  assert.equal(runCase(MODEL, "stop-val-disjoint-short"), "VAL_NOT_DISJOINT");
  assert.equal(runCase(MODEL, "near-val-disjoint-113"), "ok [97, 98, 99, 100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 111, 112]");
  const m = textMutant(dir, "m-lo1", [{ file: "model/lbtrain.py", from: "if n < lo + VAL_WINDOWS:  # guard:stop-val-disjoint-short", to: "if n < lo + 1:  # guard:stop-val-disjoint-short" }]);
  assert.equal(runCase(join(m, "model"), "stop-val-disjoint-short"), "ok [97, 98, 99, 100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 111]",
    "mutant killed: the old bound silently validates on 15 windows");
  assert.equal(runCase(join(m, "model"), "near-val-disjoint-113"), runCase(MODEL, "near-val-disjoint-113"), "the 113 near miss does not tell them apart");
}));

test("batch 6 val split: a real tiny run validates on windows 97..112, records the split, refuses a short held set, and resumes a best.json only from the same split", () => withDir((dir) => {
  const big = tinyCorpus(dir, { bigHeld: true, name: "big" });
  const out = ok(["--corpus", big, "--work", join(dir, "d"), "--steps", "4", "--val-split", "disjoint"]);
  assert.match(out, /^val split=disjoint windows=97\.\.112 n=16 eval_windows=0\.\.95$/m);
  assert.equal(json(join(dir, "d/best.json")).valSplit, "disjoint");
  // default: unchanged (no val split line, best.json as before)
  const leg = ok(["--corpus", big, "--work", join(dir, "f"), "--steps", "4"]);
  assert.ok(!/val split=/.test(leg));
  assert.deepEqual(Object.keys(json(join(dir, "f/best.json"))).sort(), ["stale", "step", "val"]);
  refused(["--corpus", tinyCorpus(dir, { name: "small" }), "--work", join(dir, "s"), "--steps", "4", "--val-split", "disjoint"], "VAL_NOT_DISJOINT");
  assert.equal(json(join(dir, "s/stop.json")).code, "VAL_NOT_DISJOINT");
  refused(["--corpus", big, "--work", join(dir, "x"), "--steps", "4", "--val-split", "overlap"], "VAL_SPLIT_BAD");
  // resume a legacy (first-split) work dir whose best.json is impossibly good: on the disjoint split it is not kept
  const seed = (w: string) => { ok(["--corpus", big, "--work", join(dir, w), "--steps", "4"]); writeFileSync(join(dir, w, "best.json"), JSON.stringify({ val: 0.001, step: 4, stale: 0 })); };
  seed("r");
  ok(["--corpus", big, "--work", join(dir, "r"), "--steps", "8", "--val-split", "disjoint"]);
  const r = json(join(dir, "r/best.json"));
  assert.equal(r.valSplit, "disjoint"); assert.ok(r.step > 4 && r.val > 0.001, "early stopping restarted on the new split");
  // near miss: the same split resumes its best.json (nothing beats 0.001)
  seed("q");
  ok(["--corpus", big, "--work", join(dir, "q"), "--steps", "8"]);
  assert.deepEqual(json(join(dir, "q/best.json")), { val: 0.001, step: 4, stale: 2 });
  // the val loss really is computed on other windows: same seed and model, different step-0 val loss
  const v0 = (w: string) => readFileSync(join(w, "metrics.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l)).find((x) => x.step === 0).val_loss;
  assert.notEqual(v0(join(dir, "d")), v0(join(dir, "f")));
  // killed mutants: train.py building the val windows from 0..n-1 again, or keeping an other-split best.json
  const m = textMutant(dir, "m-vs", [
    { file: "model/train.py", from: "eval_x = np.stack([held_tok[i * T: i * T + T] for i in val_ids])", to: "eval_x = np.stack([held_tok[i * T: i * T + T] for i in range(n_eval)])" },
    { file: "model/train.py", from: "eval_y = np.stack([held_tok[i * T + 1: i * T + T + 1] for i in val_ids])", to: "eval_y = np.stack([held_tok[i * T + 1: i * T + T + 1] for i in range(n_eval)])" }]);
  assert.equal(train(["--corpus", big, "--work", join(dir, "md"), "--steps", "4", "--val-split", "disjoint"], join(m, "model/train.py")).status, 0);
  assert.equal(v0(join(dir, "md")), v0(join(dir, "f")), "mutant killed: the val loss is the legacy split's again");
  const k = textMutant(dir, "m-keepbest", [{ file: "model/train.py", from: "best = lbtrain.val_best(json.load(open(W(\"best.json\"))) if os.path.exists(W(\"best.json\")) else None, VAL_SPLIT)",
    to: "best = json.load(open(W(\"best.json\"))) if os.path.exists(W(\"best.json\")) else lbtrain.val_best(None, VAL_SPLIT)" }]);
  seed("mk");
  assert.equal(train(["--corpus", big, "--work", join(dir, "mk"), "--steps", "8", "--val-split", "disjoint"], join(k, "model/train.py")).status, 0);
  assert.equal(json(join(dir, "mk/best.json")).step, 4, "mutant killed: the old split's best survives the resume");
}));
