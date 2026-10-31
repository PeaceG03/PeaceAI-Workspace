// M158 (limit-breaker step 3): easy-to-hard curriculum. Train docs are ordered by lb-clean's manifest
// difficulty.score (ties broken by sha256(seed:doc), so the order is deterministic and seeded), the token stream is
// re-laid in that order in memory (tokens_train.npy on disk is unchanged), and batches are drawn from the easiest
// prefix that grows linearly from --curriculum-start of the stream to all of it over --curriculum-ramp steps. The
// choice is in the config (saves, resume check) and run.json. Every tagged guard is mutation-checked.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { json, losses, MODEL, mutationCheck, ok, py, refused, runCase, stateHash, tinyCorpus, withDir } from "./m157-lbtrain-mut.ts";

const lb = (code: string) => JSON.parse(execFileSync(py, ["-c", `import sys,json;sys.path.insert(0,sys.argv[1]);import numpy as np,lbtrain\n${code}`, MODEL], { encoding: "utf8" }));

test("m158: the order is easy-to-hard by score, seeded on ties, and the re-laid stream keeps every doc's tokens", () => {
  assert.equal(runCase(MODEL, "near-cur"), "ok 1.0 [3, 1, 2]");
  const r = lb(`s={i:(i%3)*10 for i in range(30)}\na=lbtrain.order_easy_to_hard(list(range(30)),s,1);b=lbtrain.order_easy_to_hard(list(range(30)),s,1);c=lbtrain.order_easy_to_hard(list(range(30)),s,2)\nprint(json.dumps([a,a==b,a==c,[s[i] for i in a]==sorted(s.values())]))`);
  assert.equal(r[1], true, "same seed, same order"); assert.equal(r[2], false, "the seed breaks ties"); assert.equal(r[3], true, "scores ascend");
  const t = lb(`tok=np.array([5,6,256,7,256,8,9,10,256],np.int32)\nn=lbtrain.reorder_stream(tok,[10,11,12],[12,10,11],256)\nprint(json.dumps(n.tolist()))`);
  assert.deepEqual(t, [8, 9, 10, 256, 5, 6, 256, 7, 256]);
  const h = lb(`c=lbtrain.curriculum_cfg("easy_to_hard",0.25,4,0)\nprint(json.dumps([lbtrain.curriculum_hi(s,c,1000,32) for s in range(7)]))`);
  assert.deepEqual(h, [250, 438, 625, 813, 1000, 1000, 1000], "linear ramp from 25% to all of the stream over 4 steps");
  assert.equal(runCase(MODEL, "cur-min-window"), "hi 34", "never below one window + 1 token");
});

test("m158: a curriculum run is recorded, keeps tokens_train.npy, differs from the plain run and resumes bitwise", () => withDir((dir) => {
  const corpus = tinyCorpus(dir);
  ok(["--corpus", corpus, "--work", join(dir, "p"), "--steps", "6"]);
  const c = ["--corpus", corpus, "--steps", "6", "--curriculum", "easy_to_hard", "--curriculum-ramp", "4"];
  const out = ok([...c, "--work", join(dir, "c")]);
  assert.match(out, /^curriculum easy_to_hard start=0.25 ramp=4$/m);
  const run = json(join(dir, "c/run.json"));
  assert.deepEqual(run.cfg.curriculum, { order: "easy_to_hard", ramp: 4, score: "lb-clean difficulty.score", seed: "20261010", start: 0.25 });
  assert.deepEqual(run.curriculum, run.cfg.curriculum);
  assert.equal(readFileSync(join(dir, "c/tokens_train.npy")).equals(readFileSync(join(dir, "p/tokens_train.npy"))), true, "on-disk stream unchanged (export.py)");
  assert.notDeepEqual(losses(join(dir, "c")), losses(join(dir, "p")));
  ok([...c, "--work", join(dir, "u")]);
  assert.equal(stateHash(join(dir, "u/checkpoint.npz")), stateHash(join(dir, "c/checkpoint.npz")), "deterministic");
  ok([...c, "--work", join(dir, "r1"), "--max-steps-this-run", "3", "--save-dir", join(dir, "s"), "--marker", join(dir, "m.json")]);
  const m = json(join(dir, "m.json"));
  ok([...c, "--work", join(dir, "r2"), "--resume-from", join(dir, "s", m.save), "--resume-manifest-sha", m.manifestSha256]);
  assert.equal(stateHash(join(dir, "r2/checkpoint.npz")), stateHash(join(dir, "c/checkpoint.npz")), "resumed curriculum run is bitwise the uninterrupted one");
  // near miss: another curriculum seed is another config; the save refuses it
  refused([...c, "--curriculum-seed", "9", "--work", join(dir, "r3"), "--resume-from", join(dir, "s", m.save), "--resume-manifest-sha", m.manifestSha256], "SAVE_CONFIG_MISMATCH");
}));

test("m158: refusals: no difficulty in the manifest, curriculum with replay, bad mode / start / ramp", () => withDir((dir) => {
  const plain = tinyCorpus(dir, { difficulty: false, name: "nodiff" });
  const corpus = tinyCorpus(dir);
  refused(["--corpus", plain, "--work", join(dir, "a"), "--curriculum", "easy_to_hard"], "CURRICULUM_NO_DIFFICULTY");
  refused(["--corpus", corpus, "--work", join(dir, "b"), "--curriculum", "easy_to_hard", "--replay-corpus", plain], "CURRICULUM_WITH_REPLAY");
  refused(["--corpus", corpus, "--work", join(dir, "c"), "--curriculum", "hard_first"], "CURRICULUM_BAD_ARGS");
  refused(["--corpus", corpus, "--work", join(dir, "d"), "--curriculum", "easy_to_hard", "--curriculum-start", "0"], "CURRICULUM_BAD_ARGS");
  refused(["--corpus", corpus, "--work", join(dir, "e"), "--curriculum", "easy_to_hard", "--curriculum-ramp", "-1"], "CURRICULUM_BAD_ARGS");
}));

test("m158: mutation check: disabling any curriculum guard changes its case's outcome", () => {
  mutationCheck(/^cur-/, {
    "cur-mode": "CURRICULUM_BAD_ARGS", "cur-replay": "CURRICULUM_WITH_REPLAY", "cur-start": "CURRICULUM_BAD_ARGS", "cur-ramp": "CURRICULUM_BAD_ARGS",
    "cur-score": "CURRICULUM_NO_DIFFICULTY", "cur-split": "CURRICULUM_STREAM_MISMATCH", "cur-min-window": "hi 34",
  });
});
