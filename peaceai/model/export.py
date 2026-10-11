"""Exports a training checkpoint as an inference model directory and evaluates it on held-out data.

Usage: export.py --work DIR --out DIR [--threads K]
Writes config.json, tokenizer.json, weights.npz (fp16) and eval.json (held-out loss vs a unigram
baseline trained on the training split, bits per byte). The model is NOT usable until
peaceai/bin/lm-memcheck.ts writes a passing memcheck.json bound to these files' hashes."""
import argparse
import json
import math
import os
import shutil
import sys

ap = argparse.ArgumentParser()
ap.add_argument("--work", required=True)
ap.add_argument("--out", required=True)
ap.add_argument("--threads", type=int, default=8)
ap.add_argument("--checkpoint", default="checkpoint.npz")  # best.npz after early stopping
args = ap.parse_args()
for v in ("OPENBLAS_NUM_THREADS", "OMP_NUM_THREADS"):
    os.environ[v] = str(args.threads)
import numpy as np  # noqa: E402

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lm  # noqa: E402

with np.load(os.path.join(args.work, args.checkpoint), allow_pickle=False) as z:
    meta = json.loads(str(z["meta"]))
    params = {k[2:]: z[k].astype(np.float32) for k in z.files if k.startswith("p.")}
cfg = meta["cfg"]
os.makedirs(args.out, exist_ok=True)
lm.save_weights(os.path.join(args.out, "weights.npz"), params)
shutil.copyfile(os.path.join(args.work, "tokenizer.json"), os.path.join(args.out, "tokenizer.json"))
wsha = lm.file_sha256(os.path.join(args.out, "weights.npz"))
config = {"schema": lm.MODEL_SCHEMA, "version": "lm-v1-" + wsha[:12], "arch": "decoder-only transformer, pre-LN, GELU, tied embeddings, learned positions",
          "d_model": cfg["d_model"], "n_head": cfg["n_head"], "n_layer": cfg["n_layer"], "vocab_size": cfg["vocab_size"], "ctx": cfg["ctx"],
          "params": lm.param_count(cfg), "trained_steps": meta["step"], "seed": cfg["seed"], "weights_dtype": "float16"}
with open(os.path.join(args.out, "config.json"), "w") as f:
    f.write(json.dumps(config, indent=2, sort_keys=True) + "\n")

held = np.load(os.path.join(args.work, "tokens_heldout.npy")).astype(np.int64)
train = np.load(os.path.join(args.work, "tokens_train.npy")).astype(np.int64)
T = cfg["ctx"]
n = (len(held) - 1) // T
n_eval = min(n, 96)
counts = np.bincount(train, minlength=cfg["vocab_size"]).astype(np.float64) + 1.0
uni = np.log(counts / counts.sum())
w16 = lm.load_weights(os.path.join(args.out, "weights.npz"))


def ce(p):
    tot = 0.0
    for i in range(0, n_eval, 4):
        j = range(i, min(n_eval, i + 4))
        x = np.stack([held[k * T:k * T + T] for k in j])
        y = np.stack([held[k * T + 1:k * T + T + 1] for k in j])
        tot += lm.forward(p, cfg, x, y)[1] * len(j)
    return tot / n_eval


ys = np.concatenate([held[k * T + 1:k * T + T + 1] for k in range(n_eval)])
uni_ce = float(-uni[ys].mean())
tok = lm.Tokenizer(json.load(open(os.path.join(args.out, "tokenizer.json"))))
held_bytes = len(tok.decode(ys.tolist()).encode())
m16 = ce(w16)
ev = {"heldout_tokens": int(len(ys)), "heldout_windows": int(n_eval), "model_ce_fp32": round(ce(params), 4), "model_ce_fp16": round(m16, 4),
      "unigram_ce": round(uni_ce, 4), "model_ppl": round(math.exp(m16), 2), "unigram_ppl": round(math.exp(uni_ce), 2),
      "model_bits_per_byte": round(m16 * len(ys) / math.log(2) / held_bytes, 4), "unigram_bits_per_byte": round(uni_ce * len(ys) / math.log(2) / held_bytes, 4)}
with open(os.path.join(args.out, "eval.json"), "w") as f:
    f.write(json.dumps(ev, indent=2, sort_keys=True) + "\n")
print(json.dumps({"version": config["version"], "params": config["params"], **ev}))
