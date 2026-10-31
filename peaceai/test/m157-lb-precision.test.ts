// M157 (limit-breaker step 3): an optional 8-bit AdamW (block-wise int8 m, uint8 sqrt(v)), default OFF; a default
// run is bitwise the run of main's train.py. When on, the choice is in the config (save manifests, resume check) and
// run.json. Precision is fp32 only (Auditor ruling on #654: the emulated bfloat16 option was dropped). A work-dir
// checkpoint is resumed only with exactly its config (every key of either side: CHECKPOINT_CONFIG_MISMATCH, never a
// KeyError). Every tagged guard is mutation-checked; the cfg-match call site has a text mutant.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { guards, json, losses, MODEL, mutationCheck, ok, py, refused, repo, runCase, stateHash, stopOf, textMutant, tinyCorpus, train, withDir } from "./m157-lbtrain-mut.ts";

const keys = (f: string) => JSON.parse(execFileSync(py, ["-c", `import numpy as np,sys,json;z=np.load(sys.argv[1]);m=json.loads(str(z["meta"]));print(json.dumps([sorted({k.split(".")[0] for k in z.files}),sorted(m["cfg"])]))`, f], { encoding: "utf8" }));
const bytesOf = (f: string, re: string) => Number(execFileSync(py, ["-c", `import numpy as np,sys,re;z=np.load(sys.argv[1]);print(sum(z[k].nbytes for k in z.files if re.match(sys.argv[2],k)))`, f, re], { encoding: "utf8" }).trim());

test("m157: a default run records adamw and adds no config key", () => withDir((dir) => {
  const corpus = tinyCorpus(dir);
  ok(["--corpus", corpus, "--work", join(dir, "d"), "--steps", "2"]);
  const [arrays, cfgKeys] = keys(join(dir, "d/checkpoint.npz"));
  assert.deepEqual(arrays, ["m", "meta", "p", "v"]);
  for (const k of ["precision", "optimizer", "curriculum", "lora"]) assert.ok(!cfgKeys.includes(k), `default cfg has no ${k} key`);
  const run = json(join(dir, "d/run.json"));
  assert.deepEqual([run.precision, run.optimizer, run.curriculum, run.lora], [undefined, "adamw", null, null]);
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

test("m157: precision is fp32 only: no --precision flag and no bf16 option anywhere (Auditor ruling)", () => withDir((dir) => {
  for (const f of ["model/train.py", "model/lbtrain.py", "model/daily_cycle.py", "model/lb-train.json", "bin/lb-daily-cycle.sh"]) {
    const t = readFileSync(join(repo, "peaceai", f), "utf8");
    assert.ok(!/--precision|\bbf16\b|PRECISION_BAD|resolve_precision|bf16_round/.test(t), `${f} has no precision option`);
  }
  assert.ok(!json(join(MODEL, "lb-train.json")).daily.trainArgsAllowed.includes("--precision"));
  const corpus = tinyCorpus(dir);
  const r = train(["--corpus", corpus, "--work", join(dir, "x"), "--steps", "2", "--precision", "bf16"]);
  assert.equal(r.status, 2, "argparse refuses the removed flag"); assert.match(r.stderr, /unrecognized arguments: --precision bf16/);
}));

test("m157: adamw8bit keeps ~1/4 of the optimizer bytes, tracks fp32 AdamW, and resumes bitwise from a save", () => withDir((dir) => {
  const corpus = tinyCorpus(dir);
  ok(["--corpus", corpus, "--work", join(dir, "f"), "--steps", "6"]);
  const out = ok(["--corpus", corpus, "--work", join(dir, "q"), "--steps", "6", "--optimizer", "adamw8bit"]);
  assert.match(out, /^optimizer=adamw8bit opt_state_bytes=\d+$/m);
  const k = keys(join(dir, "q/checkpoint.npz"));
  assert.deepEqual(k[0], ["meta", "p", "qm", "qms", "qv", "qvs"], "8-bit moments only, no fp32 m./v.");
  const f32 = bytesOf(join(dir, "f/checkpoint.npz"), "^[mv]\\."), q8 = bytesOf(join(dir, "q/checkpoint.npz"), "^q");
  assert.ok(q8 < 0.3 * f32, `8-bit state ${q8} B vs fp32 ${f32} B`);
  const lf = losses(join(dir, "f")), lq = losses(join(dir, "q"));
  for (let i = 0; i < lf.length; i += 1) assert.ok(Math.abs((lf[i]![1] as number) - (lq[i]![1] as number)) < 0.05, `step ${i + 1} loss within 0.05 of fp32 AdamW`);
  // resume: 4 steps + save, then resume to 6 == the uninterrupted 6-step 8-bit run
  const a = ["--corpus", corpus, "--steps", "6", "--optimizer", "adamw8bit"];
  ok([...a, "--work", join(dir, "u")]);
  ok([...a, "--work", join(dir, "r1"), "--max-steps-this-run", "4", "--save-dir", join(dir, "s"), "--marker", join(dir, "chain.json")]);
  const m = json(join(dir, "chain.json"));
  assert.equal(m.step, 4);
  ok([...a, "--work", join(dir, "r2"), "--resume-from", join(dir, "s", m.save), "--resume-manifest-sha", m.manifestSha256]);
  assert.equal(stateHash(join(dir, "r2/checkpoint.npz")), stateHash(join(dir, "u/checkpoint.npz")), "resumed 8-bit run is bitwise the uninterrupted one");
  assert.deepEqual(losses(join(dir, "r2")).slice(-2), losses(join(dir, "u")).slice(-2));
  // near miss: the same save resumed with a different optimizer refuses (the choice is in the save's config)
  refused(["--corpus", corpus, "--steps", "6", "--work", join(dir, "r3"), "--resume-from", join(dir, "s", m.save), "--resume-manifest-sha", m.manifestSha256], "SAVE_CONFIG_MISMATCH");
  assert.deepEqual(stopOf(join(dir, "r3")), { schema: "peaceai-lb-stop:v1", reason: "error", code: "SAVE_CONFIG_MISMATCH", step: null });
  refused(["--corpus", corpus, "--work", join(dir, "x"), "--optimizer", "sgd"], "OPTIMIZER_BAD");
}));

test("m157: a work-dir checkpoint resumes only with its exact config: another optimizer either way is CHECKPOINT_CONFIG_MISMATCH, not a KeyError", () => withDir((dir) => {
  const corpus = tinyCorpus(dir);
  const d = ["--corpus", corpus, "--work", join(dir, "d")], q = ["--corpus", corpus, "--work", join(dir, "q")];
  ok([...d, "--steps", "2"]);
  refused([...d, "--steps", "4", "--optimizer", "adamw8bit"], "CHECKPOINT_CONFIG_MISMATCH");
  assert.deepEqual(stopOf(join(dir, "d")), { schema: "peaceai-lb-stop:v1", reason: "error", code: "CHECKPOINT_CONFIG_MISMATCH", step: null });
  ok([...q, "--steps", "2", "--optimizer", "adamw8bit"]);
  refused([...q, "--steps", "4"], "CHECKPOINT_CONFIG_MISMATCH");
  // near misses: the same config with a longer --steps resumes (total_steps is the one key allowed to differ)
  assert.match(ok([...d, "--steps", "4"]), /^resumed step=2$/m);
  assert.match(ok([...q, "--steps", "4", "--optimizer", "adamw8bit"]), /^resumed step=2$/m);
  assert.equal(runCase(MODEL, "near-cfg"), "ok True False False False");
  // text mutants: main's one-sided comparison (KeyError) at the call site, and a one-sided lookup in cfg_matches
  for (const [name, file, from, to] of [
    ["m-call", "model/train.py", 'if not lbtrain.cfg_matches(meta.get("cfg"), cfg):', 'if lm.canonical({k: meta["cfg"][k] for k in cfg if k != "total_steps"}) != lm.canonical({k: cfg[k] for k in cfg if k != "total_steps"}):'],
    ["m-get", "model/lbtrain.py", "canonical(saved.get(k)) == canonical(cur.get(k))", "canonical(saved[k]) == canonical(cur.get(k))"],
  ] as const) {
    const m = textMutant(dir, name, [{ file, from, to }]);
    ok(["--corpus", corpus, "--work", join(dir, `${name}-w`), "--steps", "2"]);
    const r = train(["--corpus", corpus, "--work", join(dir, `${name}-w`), "--steps", "4", "--optimizer", "adamw8bit"], join(m, "model/train.py"));
    assert.notEqual(r.stderr.trim().split("\n").pop(), "CHECKPOINT_CONFIG_MISMATCH", `${name}: the mutant must change the outcome`);
    assert.match(r.stderr, /KeyError/);
  }
}));

test("m157: mutation check: disabling any optimizer guard changes its case's outcome", () => {
  mutationCheck(/^opt/, {
    "opt-cfg-dict": "match=False", "opt8-finite": "OPT8_NONFINITE", "opt8-finite-v": "OPT8_NONFINITE", "opt8-unsigned": "OPT8_NEGATIVE",
    "opt-name": "OPTIMIZER_BAD", "opt8-grad-finite": "OPT8_GRAD_NONFINITE", "opt-load-keys": "CHECKPOINT_OPT_MISMATCH", "opt8-load-keys": "CHECKPOINT_OPT_MISMATCH",
  });
});

test("m157: every guard tag belongs to one of m157..m161; the new code names no Results, latest.json, R2/cloud storage, token or network", () => {
  const all = guards(/./).map((g) => g.name);
  for (const g of all) assert.ok(/^(opt|cur-|stop-|daily-|lora-)/.test(g), g);
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
