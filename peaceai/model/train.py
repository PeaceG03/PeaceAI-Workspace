"""M9 training: self-trained BPE tokenizer + from-scratch transformer, seeded, CPU only, resumable.

Usage: train.py --corpus DIR --work DIR [--steps N] [--max-seconds S] [--threads K] [--seed N]
Reads DIR/docs.jsonl and DIR/manifest.jsonl (from peaceai/bin/lm-corpus.ts). Writes into --work only:
tokenizer.json, tokens_*.npy, checkpoint.npz (fp32 weights + AdamW state + RNG state), metrics.jsonl.
Prints step metrics only (no corpus text). Run it somewhere private when the corpus holds private code."""
import argparse
import json
import os
import sys
import time

ap = argparse.ArgumentParser()
ap.add_argument("--corpus", required=True)
ap.add_argument("--work", required=True)
ap.add_argument("--steps", type=int, default=600)
ap.add_argument("--max-seconds", type=float, default=1e9)
ap.add_argument("--max-steps-this-run", type=int, default=0)  # stop early (resume later); 0 = no limit
ap.add_argument("--threads", type=int, default=8)
ap.add_argument("--seed", type=int, default=20261010)
ap.add_argument("--batch", type=int, default=16)
ap.add_argument("--eval-every", type=int, default=50)
ap.add_argument("--d-model", type=int, default=384)
ap.add_argument("--n-layer", type=int, default=6)
ap.add_argument("--n-head", type=int, default=6)
ap.add_argument("--ctx", type=int, default=256)
ap.add_argument("--vocab", type=int, default=4096)
args = ap.parse_args()
for v in ("OPENBLAS_NUM_THREADS", "OMP_NUM_THREADS", "MKL_NUM_THREADS"):
    os.environ[v] = str(args.threads)

import numpy as np  # noqa: E402

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lm  # noqa: E402

os.makedirs(args.work, exist_ok=True)
W = lambda name: os.path.join(args.work, name)  # noqa: E731
t0 = time.time()

docs = {}
with open(os.path.join(args.corpus, "docs.jsonl"), encoding="utf-8") as f:
    for line in f:
        if line.strip():
            d = json.loads(line)
            docs[d["doc"]] = d["text"]
split = {}
with open(os.path.join(args.corpus, "manifest.jsonl"), encoding="utf-8") as f:
    for line in f:
        if line.strip():
            m = json.loads(line)
            split[m["doc"]] = m["split"]
train_ids = sorted(i for i in docs if split[i] == "train")
held_ids = sorted(i for i in docs if split[i] == "heldout")

if not os.path.exists(W("tokenizer.json")):
    spec = lm.train_bpe([docs[i] for i in train_ids], args.vocab)  # held-out files never train the tokenizer
    with open(W("tokenizer.json"), "w") as f:
        f.write(lm.canonical(spec) + "\n")
    print(f"tokenizer trained merges={len(spec['merges'])} seconds={time.time() - t0:.0f}", flush=True)
tok = lm.Tokenizer(json.load(open(W("tokenizer.json"))))


def stream(ids, name):
    path = W(f"tokens_{name}.npy")
    if os.path.exists(path):
        return np.load(path)
    out = []
    for i in ids:
        out.extend(tok.encode(docs[i]))
        out.append(lm.EOD)
    arr = np.array(out, np.uint16)
    np.save(path, arr)
    return arr


train_tok = stream(train_ids, "train")
held_tok = stream(held_ids, "heldout")
train_bytes = sum(len(docs[i].encode()) for i in train_ids)
print(f"tokens train={len(train_tok)} heldout={len(held_tok)} bytes_per_token={train_bytes / len(train_tok):.2f}", flush=True)

cfg = {"schema": lm.MODEL_SCHEMA, "d_model": args.d_model, "n_head": args.n_head, "n_layer": args.n_layer,
       "vocab_size": args.vocab, "ctx": args.ctx, "lr": 6e-4, "warmup": 30, "total_steps": args.steps,
       "batch": args.batch, "weight_decay": 0.1, "grad_clip": 1.0, "seed": args.seed}
T, B = cfg["ctx"], cfg["batch"]

# Fixed held-out evaluation windows (non-overlapping, deterministic).
n_eval = min(16, max(1, (len(held_tok) - 1) // T))
eval_x = np.stack([held_tok[i * T: i * T + T] for i in range(n_eval)]).astype(np.int64)
eval_y = np.stack([held_tok[i * T + 1: i * T + T + 1] for i in range(n_eval)]).astype(np.int64)

if os.path.exists(W("checkpoint.npz")):
    with np.load(W("checkpoint.npz"), allow_pickle=False) as z:
        meta = json.loads(str(z["meta"]))
        if lm.canonical({k: meta["cfg"][k] for k in cfg if k != "total_steps"}) != lm.canonical({k: cfg[k] for k in cfg if k != "total_steps"}):
            raise SystemExit("CHECKPOINT_CONFIG_MISMATCH")
        params = {k[2:]: z[k].astype(np.float32) for k in z.files if k.startswith("p.")}
        state = {"t": meta["t"], "m": {k[2:]: z[k] for k in z.files if k.startswith("m.")}, "v": {k[2:]: z[k] for k in z.files if k.startswith("v.")}}
    rng = np.random.Generator(np.random.PCG64())
    rng.bit_generator.state = meta["rng"]
    step = meta["step"]
    print(f"resumed step={step}", flush=True)
else:
    params = lm.init_params(cfg, args.seed)
    state = {"t": 0, "m": {k: np.zeros_like(v) for k, v in params.items()}, "v": {k: np.zeros_like(v) for k, v in params.items()}}
    rng = np.random.Generator(np.random.PCG64(args.seed + 1))
    step = 0
print(f"params={lm.param_count(cfg)} d={cfg['d_model']} layers={cfg['n_layer']} heads={cfg['n_head']} ctx={T} vocab={cfg['vocab_size']} threads={args.threads}", flush=True)


def eval_loss():
    tot = 0.0
    for i in range(0, n_eval, 4):
        tot += lm.forward(params, cfg, eval_x[i:i + 4], eval_y[i:i + 4])[1] * len(eval_x[i:i + 4])
    return tot / n_eval


def log(rec):
    with open(W("metrics.jsonl"), "a") as f:
        f.write(json.dumps(rec) + "\n")
    print(json.dumps(rec), flush=True)


def save():
    meta = {"cfg": cfg, "t": state["t"], "step": step, "rng": rng.bit_generator.state}
    arrays = {f"p.{k}": params[k] for k in params}
    arrays.update({f"m.{k}": state["m"][k] for k in params})
    arrays.update({f"v.{k}": state["v"][k] for k in params})
    np.savez(W("checkpoint.tmp.npz"), meta=np.array(json.dumps(meta)), **arrays)
    os.replace(W("checkpoint.tmp.npz"), W("checkpoint.npz"))


if step == 0:
    log({"step": 0, "val_loss": round(eval_loss(), 4)})
start = time.time()
run_start_step = step
while step < cfg["total_steps"] and time.time() - start < args.max_seconds and not (args.max_steps_this_run and step - run_start_step >= args.max_steps_this_run):
    offs = rng.integers(0, len(train_tok) - T - 1, B)
    x = np.stack([train_tok[o:o + T] for o in offs]).astype(np.int64)
    y = np.stack([train_tok[o + 1:o + T + 1] for o in offs]).astype(np.int64)
    ts = time.time()
    _, loss, cache = lm.forward(params, cfg, x, y, keep=True)
    grads = lm.backward(params, cfg, cache)
    del cache
    lr = lm.lr_at(step, cfg)
    gnorm = lm.adamw_step(params, grads, state, lr, cfg)
    step += 1
    rec = {"step": step, "loss": round(loss, 4), "lr": round(lr, 7), "grad_norm": round(gnorm, 3), "sec": round(time.time() - ts, 2)}
    if step % args.eval_every == 0 or step == cfg["total_steps"]:
        rec["val_loss"] = round(eval_loss(), 4)
        save()
    log(rec)
save()
print(f"stopped step={step} of {cfg['total_steps']} elapsed={time.time() - t0:.0f}s", flush=True)
