// M157 (limit-breaker step 3): bf16 mixed precision (emulated on numpy: bf16 compute copy of the weight matrices,
// fp32 master weights; auto = fp32 since numpy has no native bf16) and an optional 8-bit AdamW (block-wise int8 m,
// uint8 sqrt(v)). Both default OFF; a default run is bitwise the run of main's train.py. When on, the choice is in
// the config (save manifests, resume check) and run.json. Every tagged guard is mutation-checked.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { guards, json, losses, MODEL, mutationCheck, ok, py, refused, repo, runCase, stateHash, tinyCorpus, train, withDir } from "./m157-lbtrain-mut.ts";

const keys = (f: string) => JSON.parse(execFileSync(py, ["-c", `import numpy as np,sys,json;z=np.load(sys.argv[1]);m=json.loads(str(z["meta"]));print(json.dumps([sorted({k.split(".")[0] for k in z.files}),sorted(m["cfg"])]))`, f], { encoding: "utf8" }));
const bytesOf = (f: string, re: string) => Number(execFileSync(py, ["-c", `import numpy as np,sys,re;z=np.load(sys.argv[1]);print(sum(z[k].nbytes for k in z.files if re.match(sys.argv[2],k)))`, f, re], { encoding: "utf8" }).trim());

test("m157: a default run records fp32/adamw and adds no config key", () => withDir((dir) => {
  const corpus = tinyCorpus(dir);
  ok(["--corpus", corpus, "--work", join(dir, "d"), "--steps", "2"]);
  const [arrays, cfgKeys] = keys(join(dir, "d/checkpoint.npz"));
  assert.deepEqual(arrays, ["m", "meta", "p", "v"]);
  for (const k of ["precision", "optimizer", "curriculum", "lora"]) assert.ok(!cfgKeys.includes(k), `default cfg has no ${k} key`);
  const run = json(join(dir, "d/run.json"));
  assert.deepEqual([run.precision, run.optimizer, run.curriculum, run.lora], ["fp32", "adamw", null, null]);
  assert.equal(run.schema, "peaceai-lb-run:v1"); assert.match(run.cfgSha256, /^[0-9a-f]{64}$/); assert.match(run.dataSha256, /^[0-9a-f]{64}$/);
}));

const hasMain = spawnSync("git", ["-C", repo, "cat-file", "-e", "origin/main:peaceai/model/train.py"]).status === 0;
test("m157: a default run is bitwise origin/main's train.py (params, Adam moments, losses, arrays, config keys)", { skip: hasMain ? false : "origin/main not in this checkout (shallow clone)" }, () => withDir((dir) => {
  const corpus = tinyCorpus(dir);
  const old = join(dir, "main-model");
  mkdirSync(old);
  for (const f of readdirSync(MODEL).filter((x) => x.endsWith(".py"))) {
    let src: string;
    try { src = execFileSync("git", ["-C", repo, "show", `origin/main:peaceai/model/${f}`], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }); } catch { continue; }
    writeFileSync(join(old, f), src);
  }
  const a = train(["--corpus", corpus, "--work", join(dir, "new"), "--steps", "6"]);
  const b = train(["--corpus", corpus, "--work", join(dir, "old"), "--steps", "6"], join(old, "train.py"));
  assert.equal(a.status, 0, a.stderr); assert.equal(b.status, 0, b.stderr);
  assert.equal(stateHash(join(dir, "new/checkpoint.npz")), stateHash(join(dir, "old/checkpoint.npz")), "same weights and moments");
  assert.deepEqual(losses(join(dir, "new")), losses(join(dir, "old")));
  assert.deepEqual(keys(join(dir, "new/checkpoint.npz")), keys(join(dir, "old/checkpoint.npz")), "same arrays and config keys");
}));

test("m157: bf16 rounds to nearest even, keeps NaN/inf, and a bf16 run is recorded and close to fp32", () => withDir((dir) => {
  const r = execFileSync(py, ["-c", `import sys;sys.path.insert(0,sys.argv[1]);import numpy as np,lbtrain;x=np.array([1.0,1+2**-8,1+3*2**-8,3.0,np.inf,-np.inf,1e-3],np.float32);print(lbtrain.bf16_round(x).tolist())`, MODEL], { encoding: "utf8" });
  assert.deepEqual(JSON.parse(r.replace(/-?inf/g, (m) => `"${m}"`)), [1.0, 1.0, 1.015625, 3.0, "inf", "-inf", 0.00099945068359375]);
  assert.equal(runCase(MODEL, "prec-nan"), "nan");
  assert.equal(runCase(MODEL, "near-prec"), "ok fp32 bf16 fp32", "auto falls back to fp32 here");
  const corpus = tinyCorpus(dir);
  ok(["--corpus", corpus, "--work", join(dir, "f"), "--steps", "6"]);
  const out = ok(["--corpus", corpus, "--work", join(dir, "b"), "--steps", "6", "--precision", "bf16"]);
  assert.match(out, /^precision=bf16 optimizer=adamw opt_state_bytes=\d+$/m);
  assert.equal(json(join(dir, "b/run.json")).cfg.precision, "bf16");
  const lf = losses(join(dir, "f")), lb = losses(join(dir, "b"));
  assert.notDeepEqual(lf, lb, "bf16 compute really differs");
  for (let i = 0; i < lf.length; i += 1) assert.ok(Math.abs((lf[i]![1] as number) - (lb[i]![1] as number)) < 0.05, `step ${i + 1} loss within 0.05 of fp32`);
  ok(["--corpus", corpus, "--work", join(dir, "a"), "--steps", "2", "--precision", "auto"]);
  assert.equal(json(join(dir, "a/run.json")).precision, "fp32"); assert.equal(json(join(dir, "a/run.json")).cfg.precision, undefined);
  refused(["--corpus", corpus, "--work", join(dir, "x"), "--precision", "fp16"], "PRECISION_BAD");
}));

test("m157: adamw8bit keeps ~1/4 of the optimizer bytes, tracks fp32 AdamW, and resumes bitwise from a save", () => withDir((dir) => {
  const corpus = tinyCorpus(dir);
  ok(["--corpus", corpus, "--work", join(dir, "f"), "--steps", "6"]);
  const out = ok(["--corpus", corpus, "--work", join(dir, "q"), "--steps", "6", "--optimizer", "adamw8bit"]);
  assert.match(out, /^precision=fp32 optimizer=adamw8bit opt_state_bytes=\d+$/m);
  const k = keys(join(dir, "q/checkpoint.npz"));
  assert.deepEqual(k[0], ["meta", "p", "qm", "qms", "qv", "qvs"], "8-bit moments only, no fp32 m./v.");
  const f32 = bytesOf(join(dir, "f/checkpoint.npz"), "^[mv]\\."), q8 = bytesOf(join(dir, "q/checkpoint.npz"), "^q");
  assert.ok(q8 < 0.3 * f32, `8-bit state ${q8} B vs fp32 ${f32} B`);
  const lf = losses(join(dir, "f")), lq = losses(join(dir, "q"));
  for (let i = 0; i < lf.length; i += 1) assert.ok(Math.abs((lf[i]![1] as number) - (lq[i]![1] as number)) < 0.05, `step ${i + 1} loss within 0.05 of fp32 AdamW`);
  // resume: 4 steps + save, then resume to 6 == the uninterrupted 6-step 8-bit run
  const a = ["--corpus", corpus, "--steps", "6", "--optimizer", "adamw8bit", "--precision", "bf16"];
  ok([...a, "--work", join(dir, "u")]);
  ok([...a, "--work", join(dir, "r1"), "--max-steps-this-run", "4", "--save-dir", join(dir, "s"), "--marker", join(dir, "chain.json")]);
  const m = json(join(dir, "chain.json"));
  assert.equal(m.step, 4);
  ok([...a, "--work", join(dir, "r2"), "--resume-from", join(dir, "s", m.save), "--resume-manifest-sha", m.manifestSha256]);
  assert.equal(stateHash(join(dir, "r2/checkpoint.npz")), stateHash(join(dir, "u/checkpoint.npz")), "resumed 8-bit + bf16 run is bitwise the uninterrupted one");
  assert.deepEqual(losses(join(dir, "r2")).slice(-2), losses(join(dir, "u")).slice(-2));
  // near miss: the same save resumed with a different optimizer refuses (the choice is in the save's config)
  refused(["--corpus", corpus, "--steps", "6", "--precision", "bf16", "--work", join(dir, "r3"), "--resume-from", join(dir, "s", m.save), "--resume-manifest-sha", m.manifestSha256], "SAVE_CONFIG_MISMATCH");
  refused(["--corpus", corpus, "--work", join(dir, "x"), "--optimizer", "sgd"], "OPTIMIZER_BAD");
}));

test("m157: mutation check: disabling any precision / optimizer guard changes its case's outcome", () => {
  mutationCheck(/^(prec|opt)/, {
    "prec-name": "PRECISION_BAD", "prec-nan": "nan", "opt8-finite": "OPT8_NONFINITE", "opt8-finite-v": "OPT8_NONFINITE", "opt8-unsigned": "OPT8_NEGATIVE",
    "opt-name": "OPTIMIZER_BAD", "opt8-grad-finite": "OPT8_GRAD_NONFINITE", "opt-load-keys": "CHECKPOINT_OPT_MISMATCH", "opt8-load-keys": "CHECKPOINT_OPT_MISMATCH",
  });
});

test("m157: every guard tag belongs to one of m157..m161; the new code names no Results, latest.json, R2/cloud storage, token or network", () => {
  const all = guards(/./).map((g) => g.name);
  for (const g of all) assert.ok(/^(prec|opt|cur-|stop-|daily-|lora-)/.test(g), g);
  assert.equal(new Set(all).size, all.length, "guard tags are unique");
  for (const f of ["peaceai/model/lbtrain.py", "peaceai/model/daily_cycle.py", "peaceai/bin/lb-daily-cycle.sh", "peaceai/model/lb-train.json"]) {
    const t = readFileSync(join(repo, f), "utf8");
    assert.ok(!/latest\.json|PeaceAI-Results|results-write|GITHUB_TOKEN|secrets\.|\bR2\b|R2_|\baws\b|\bboto|\bs3\b|cloudflare|\bcurl\b|\bwget\b|urllib|\brequests\b|\bsocket\b|subprocess/i.test(t), `${f}: no Results / latest.json / R2 / tokens / network`);
    assert.ok(/^[\x09\x0a\x20-\x7e]*$/.test(t), `${f} is ASCII`);
  }
  const spec = readFileSync(join(repo, "peaceai/spec/lb-train-v1.md"), "utf8");
  assert.ok(/^[\x09\x0a\x20-\x7e]*$/.test(spec), "spec is ASCII");
  assert.match(spec, /needs Auditor and Peace/);
});
