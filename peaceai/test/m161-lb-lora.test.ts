// M161 (limit-breaker step 3): LoRA fine-tuning. With --lora-rank r the base (--init-from) is frozen and only
// A (din x r, small random) and B (r x dout, zeros) per targeted matrix train: W_eff = W + (alpha/r) A@B, so step 0 is
// exactly the base model. The adapters are saved separately (adapter.npz, best-adapter.npz, bound to the base by
// params_sha256); best.npz is the merged model for eval/export, and `lbtrain.py lora-merge` rebuilds it from the
// base + adapter. Trust anchor: the hash of the ACTUAL --init-from file is bound into cfg.lora.baseSha256 (so into
// cfgSha256, every save manifest and the chain marker); a LoRA resume needs --init-from again and refuses a checkpoint
// whose frozen base is not that file; lora-merge needs --base-sha from a trusted record (run.json / a save manifest)
// and checks the actual base file against it, so a swapped base with an edited adapter sidecar is refused.
// Every tagged guard is mutation-checked; the train.py resume check has a text mutant.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { json, MODEL, mutationCheck, ok, py, refused, runCase, stateHash, stopOf, textMutant, tinyCorpus, train, withDir } from "./m157-lbtrain-mut.ts";

const LB = join(MODEL, "lbtrain.py");
const pHash = (f: string) => execFileSync(py, ["-c", `import numpy as np,hashlib,sys;z=np.load(sys.argv[1]);print(hashlib.sha256(b"".join(k.encode()+z[k].tobytes() for k in sorted(z.files) if k.startswith("p."))).hexdigest())`, f], { encoding: "utf8" }).trim();
const names = (f: string) => JSON.parse(execFileSync(py, ["-c", `import numpy as np,sys,json;print(json.dumps(sorted(np.load(sys.argv[1]).files)))`, f], { encoding: "utf8" })) as string[];
const baseSha = (f: string) => execFileSync(py, ["-c", "import sys;sys.path.insert(0,sys.argv[1]);import lbtrain;print(lbtrain.lora_base(sys.argv[2])[1])", MODEL, f], { encoding: "utf8" }).trim();
const merge = (args: string[]) => { const r = spawnSync(py, [LB, "lora-merge", ...args], { encoding: "utf8" }); return [r.status, r.stdout.trim()] as const; };
// rewrite an npz's meta (adapter sidecar or checkpoint) with a python edit of `m`
const editMeta = (f: string, code: string) => execFileSync(py, ["-c", `import numpy as np,json,sys;z=dict(np.load(sys.argv[1]));m=json.loads(str(z["meta"]));${code};z["meta"]=np.array(json.dumps(m));np.savez(sys.argv[1],**z)`, f]);
const vals = (w: string) => execFileSync("cat", [join(w, "metrics.jsonl")], { encoding: "utf8" }).trim().split("\n").map((l) => JSON.parse(l)).filter((r) => r.val_loss !== undefined);

function base(dir: string, corpus: string) {
  ok(["--corpus", corpus, "--work", join(dir, "w0"), "--steps", "4"]);
  return join(dir, "w0/best.npz");
}
const L = (b: string) => ["--lora-rank", "2", "--lora-targets", "wqkv,w1", "--init-from", b];

test("m161: LoRA starts at the base, trains only the adapters, keeps the base, and saves the merged best + separate adapter", () => withDir((dir) => {
  const corpus = tinyCorpus(dir), b = base(dir, corpus);
  const out = ok(["--corpus", corpus, "--work", join(dir, "w1"), "--steps", "6", ...L(b)]);
  assert.match(out, /^optimizer=adamw opt_state_bytes=\d+ lora rank=2 targets=w1,wqkv trainable=288$/m, "2*(16+48) + 2*(16+64)");
  assert.equal(vals(join(dir, "w1"))[0].val_loss, json(join(dir, "w0/best.json")).val, "B=0: step 0 is exactly the base");
  assert.equal(pHash(join(dir, "w1/checkpoint.npz")), pHash(b), "base weights frozen");
  const ck = names(join(dir, "w1/checkpoint.npz"));
  assert.deepEqual(ck.filter((k) => /^[mv]\./.test(k)).map((k) => k.slice(2)).sort(), ck.filter((k) => k.startsWith("l.")).map((k) => k.slice(2)).flatMap((k) => [k, k]).sort(), "optimizer state only for the adapters");
  assert.ok(existsSync(join(dir, "w1/adapter.npz")) && existsSync(join(dir, "w1/best-adapter.npz")));
  assert.notEqual(pHash(join(dir, "w1/best.npz")), pHash(b), "best.npz is the merged model");
  const run = json(join(dir, "w1/run.json"));
  const T = baseSha(b);
  assert.deepEqual(run.lora, { alpha: 2, rank: 2, targets: ["w1", "wqkv"], baseSha256: T }, "the actual base file's hash is in cfg");
  assert.deepEqual([run.loraBaseSha256, run.cfg.lora.baseSha256], [T, T]);
  // merge-for-eval path: base + best-adapter == best.npz, with the trusted sha from run.json
  const m = spawnSync(py, [LB, "lora-merge", b, join(dir, "w1/best-adapter.npz"), join(dir, "merged.npz"), "--base-sha", run.cfg.lora.baseSha256], { encoding: "utf8" });
  assert.equal(m.status, 0, m.stderr); assert.match(m.stdout, /^lora merged rank=2 targets=w1,wqkv step=\d+$/m);
  assert.equal(pHash(join(dir, "merged.npz")), pHash(join(dir, "w1/best.npz")));
  const e = spawnSync(py, [join(MODEL, "export.py"), "--work", join(dir, "w1"), "--out", join(dir, "w1/model"), "--checkpoint", "best.npz", "--threads", "1"], { encoding: "utf8" });
  assert.equal(e.status, 0, e.stderr);
  assert.ok(Number.isFinite(json(join(dir, "w1/model/eval.json")).model_bits_per_byte));
  // refusals: no trusted sha, merging onto another base, over an existing file; and the attack: a swapped base with
  // the adapter sidecar edited to name it -- the trusted sha from run.json still names the real base
  assert.deepEqual(merge([b, join(dir, "w1/best-adapter.npz"), join(dir, "m0.npz")]), [3, "LORA_BASE_SHA_REQUIRED"]);
  assert.deepEqual(merge([join(dir, "w1/best.npz"), join(dir, "w1/best-adapter.npz"), join(dir, "m2.npz"), "--base-sha", T]), [3, "LORA_BASE_MISMATCH"]);
  assert.deepEqual(merge([b, join(dir, "w1/best-adapter.npz"), join(dir, "merged.npz"), "--base-sha", T]), [3, "LORA_OUT_EXISTS"]);
  const evil = baseSha(join(dir, "w1/best.npz"));
  editMeta(join(dir, "w1/best-adapter.npz"), `m["baseSha256"]="${evil}";m["lora"]["baseSha256"]="${evil}"`);
  assert.deepEqual(merge([join(dir, "w1/best.npz"), join(dir, "w1/best-adapter.npz"), join(dir, "m3.npz"), "--base-sha", T]), [3, "LORA_BASE_MISMATCH"]);
  assert.deepEqual(merge([b, join(dir, "w1/best-adapter.npz"), join(dir, "m4.npz"), "--base-sha", T]), [3, "LORA_ADAPTER_MISMATCH"], "the edited sidecar no longer matches the trusted base");
  for (const f of ["m0", "m2", "m3", "m4"]) assert.ok(!existsSync(join(dir, `${f}.npz`)));
}));

test("m161: a LoRA run resumes bitwise from a save with --init-from (bound in the manifest) and refuses any other base", () => withDir((dir) => {
  const corpus = tinyCorpus(dir), b = base(dir, corpus);
  const a = ["--corpus", corpus, "--steps", "6", "--lora-rank", "2", "--lora-targets", "wqkv,w1"];
  ok([...a, "--init-from", b, "--work", join(dir, "u")]);
  ok([...a, "--init-from", b, "--work", join(dir, "r1"), "--max-steps-this-run", "3", "--save-dir", join(dir, "s"), "--marker", join(dir, "m.json")]);
  const m = json(join(dir, "m.json")), sv = ["--resume-from", join(dir, "s", m.save), "--resume-manifest-sha", m.manifestSha256];
  assert.equal(json(join(dir, "s", m.save, "manifest.json")).cfg.lora.baseSha256, baseSha(b), "the save manifest binds the base");
  refused([...a, "--work", join(dir, "r0"), ...sv], "LORA_NEEDS_BASE");
  assert.deepEqual(stopOf(join(dir, "r0")).code, "LORA_NEEDS_BASE");
  ok(["--corpus", corpus, "--work", join(dir, "w9"), "--steps", "4", "--seed", "9"]);
  refused([...a, "--init-from", join(dir, "w9/best.npz"), "--work", join(dir, "r3"), ...sv], "SAVE_CONFIG_MISMATCH");
  ok([...a, "--init-from", b, "--work", join(dir, "r2"), ...sv]);
  assert.equal(stateHash(join(dir, "r2/checkpoint.npz")), stateHash(join(dir, "u/checkpoint.npz")));
  assert.equal(pHash(join(dir, "r2/best.npz")), pHash(join(dir, "u/best.npz")));
  // work-dir checkpoint: near miss resumes; a tampered frozen base refuses; the attack (swap the base file AND edit
  // the checkpoint's cfg.lora.baseSha256 to name it) refuses because the frozen base is checked against the file
  for (const w of ["r4", "r5", "r6"]) ok([...a, "--init-from", b, "--work", join(dir, w), "--max-steps-this-run", "3"]);
  assert.match(ok([...a, "--init-from", b, "--work", join(dir, "r4")]), /^resumed step=3$/m);
  execFileSync(py, ["-c", `import numpy as np,sys;z=dict(np.load(sys.argv[1]));z["p.h0.wo"]=z["p.h0.wo"]+1;np.savez(sys.argv[1],**z)`, join(dir, "r5/checkpoint.npz")]);
  refused([...a, "--init-from", b, "--work", join(dir, "r5")], "LORA_BASE_MISMATCH");
  const other = join(dir, "w9/best.npz");
  editMeta(join(dir, "r6/checkpoint.npz"), `m["cfg"]["lora"]["baseSha256"]="${baseSha(other)}"`);
  const attack = [...a, "--init-from", other, "--work", join(dir, "r6")];
  refused(attack, "LORA_BASE_MISMATCH");
  // text mutant: without the resume check the attack resumes -- killed
  const mut = textMutant(dir, "m-resume", [{ file: "model/train.py", from: "                lbtrain.lora_resume_check(params, LCFG)\n", to: "                pass\n" }]);
  const r = train(attack, join(mut, "model/train.py"));
  assert.equal(r.status, 0, "the mutant accepts the swapped base"); assert.match(r.stdout, /^resumed step=3$/m);
}));

test("m161: refusals: no base, bad rank / alpha / targets", () => withDir((dir) => {
  const corpus = tinyCorpus(dir), b = base(dir, corpus);
  refused(["--corpus", corpus, "--work", join(dir, "a"), "--lora-rank", "2"], "LORA_NEEDS_BASE");
  refused(["--corpus", corpus, "--work", join(dir, "b"), "--lora-rank", "99", "--init-from", b], "LORA_BAD_RANK");
  refused(["--corpus", corpus, "--work", join(dir, "c"), "--lora-rank", "2", "--lora-alpha", "-1", "--init-from", b], "LORA_BAD_ALPHA");
  refused(["--corpus", corpus, "--work", join(dir, "d"), "--lora-rank", "2", "--lora-targets", "wqkv,emb", "--init-from", b], "LORA_BAD_TARGETS");
}));

test("m161: mutation check: disabling any LoRA guard changes its case's outcome", () => {
  assert.equal(runCase(MODEL, "near-lora-merge"), "ok changed=['h0.wo', 'h0.wqkv']");
  mutationCheck(/^lora-/, {
    "lora-rank": "LORA_BAD_RANK", "lora-alpha": "LORA_BAD_ALPHA", "lora-targets": "LORA_BAD_TARGETS", "lora-base": "LORA_NEEDS_BASE", "lora-keys": "LORA_SHAPE",
    "lora-shape": "LORA_SHAPE", "lora-schema": "LORA_SCHEMA", "lora-base-sha": "LORA_BASE_MISMATCH", "lora-merge-out": "rc=3 LORA_OUT_EXISTS kept=True",
    "lora-base-read": "LORA_BASE_READ", "lora-bind-sha": "LORA_BASE_READ", "lora-resume-base": "LORA_BASE_MISMATCH", "lora-trusted-sha": "LORA_BASE_SHA_REQUIRED",
    "lora-adapter-sha": "LORA_ADAPTER_MISMATCH",
  });
});
