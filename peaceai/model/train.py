"""M9 training: self-trained BPE tokenizer + from-scratch transformer, seeded, CPU only, resumable.

Usage: train.py --corpus DIR --work DIR [--steps N] [--max-seconds S] [--threads K] [--seed N]
       [--replay-corpus RDIR [--replay-frac F] [--val-windows N] --val-seed S] [--keep-checkpoints]
Reads DIR/docs.jsonl and DIR/manifest.jsonl (from peaceai/bin/lm-corpus.ts). Writes into --work only:
tokenizer.json, tokens_*.npy, checkpoint.npz (fp32 weights + AdamW state + RNG state), metrics.jsonl.
Prints step metrics only (no corpus text). Run it somewhere private when the corpus holds private code.

LM retrain replay (forgetting fix after run 40375535718; peaceai/model/replay.py holds the shared rules):
  --replay-corpus RDIR  docs.jsonl + manifest.jsonl of general code from the live model's own pretrain manifest
                        (lm-retrain-replay.sh). Its split=train docs are replayed; its split=heldout docs are the
                        ONLY validation data: early stopping and best.json read val windows from them, never --corpus
                        heldout docs (the fine-tune split is by file path and is not used for selection).
  --replay-frac F       share of every batch drawn from the replay train docs: replay.replay_rows(batch, F) rows
                        (default 0.75); the other rows come from --corpus split=train. Each step's record carries
                        replay_rows and ft_rows as built.
  --val-windows N       replay.val_windows: ctx+1 tokens of each of the first N heldout docs that are long enough, one
                        window per doc (default 64), starting at replay.val_offset (seeded by --val-seed and the doc
                        id, clamped to fit). Writes val.json {docs, windows, sha256, seed} into --work.
  --val-seed S          the window-offset seed (lm-retrain.json finetune.valSeed); required with --replay-corpus.
  --keep-checkpoints    copy checkpoint.npz to ckpt-<step>.npz at every eval (the retrain dry run scores each one on
                        set C v2 AFTER training; train.py itself never reads set C or any judge item)."""
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
ap.add_argument("--lr", type=float, default=6e-4)
ap.add_argument("--warmup", type=int, default=30)
# M49 fine-tune stage: start from these weights (p.* arrays of a checkpoint/best .npz with the same model shape);
# fresh optimizer state. Ignored when the work dir already has a checkpoint (resume wins).
ap.add_argument("--init-from", default="")
ap.add_argument("--patience", type=int, default=0)  # early stop after N evals without a held-out improvement; 0 = off
ap.add_argument("--replay-corpus", default="")
ap.add_argument("--replay-frac", type=float, default=0.75)
ap.add_argument("--val-windows", type=int, default=64)
ap.add_argument("--val-seed", default=None)
ap.add_argument("--keep-checkpoints", action="store_true")
args = ap.parse_args()
for v in ("OPENBLAS_NUM_THREADS", "OMP_NUM_THREADS", "MKL_NUM_THREADS"):
    os.environ[v] = str(args.threads)

import numpy as np  # noqa: E402

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lm  # noqa: E402
import replay  # noqa: E402

os.makedirs(args.work, exist_ok=True)
W = lambda name: os.path.join(args.work, name)  # noqa: E731
t0 = time.time()



def read_corpus(d):
    texts, sp = {}, {}
    with open(os.path.join(d, "docs.jsonl"), encoding="utf-8") as f:
        for line in f:
            if line.strip():
                o = json.loads(line)
                texts[o["doc"]] = o["text"]
    with open(os.path.join(d, "manifest.jsonl"), encoding="utf-8") as f:
        for line in f:
            if line.strip():
                o = json.loads(line)
                sp[o["doc"]] = o["split"]
    return texts, sp


docs, split = read_corpus(args.corpus)
train_ids = sorted(i for i in docs if split[i] == "train")
held_ids = sorted(i for i in docs if split[i] == "heldout")
REPLAY = bool(args.replay_corpus)
if REPLAY:
    rdocs, rsplit = read_corpus(args.replay_corpus)
    if set(rdocs) != set(rsplit):
        raise SystemExit("REPLAY_CORPUS_MISMATCH")
    replay_ids = sorted(i for i in rdocs if rsplit[i] == "train")
    val_ids = sorted(i for i in rdocs if rsplit[i] == "heldout")
    if not replay_ids or not val_ids:
        raise SystemExit("REPLAY_SPLIT_EMPTY")

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
held_tok = stream(held_ids, "heldout") if not REPLAY else None  # with replay the fine-tune heldout docs are never read
train_bytes = sum(len(docs[i].encode()) for i in train_ids)
if REPLAY:
    path = W("tokens_replay.npy")
    if os.path.exists(path):
        replay_tok = np.load(path)
    else:
        out = []
        for i in replay_ids:
            out.extend(tok.encode(rdocs[i]))
            out.append(lm.EOD)
        replay_tok = np.array(out, np.uint16)
        np.save(path, replay_tok)
    print(f"tokens train={len(train_tok)} replay={len(replay_tok)} val_docs={len(val_ids)} bytes_per_token={train_bytes / max(1, len(train_tok)):.2f}", flush=True)
else:
    print(f"tokens train={len(train_tok)} heldout={len(held_tok)} bytes_per_token={train_bytes / len(train_tok):.2f}", flush=True)

cfg = {"schema": lm.MODEL_SCHEMA, "d_model": args.d_model, "n_head": args.n_head, "n_layer": args.n_layer,
       "vocab_size": args.vocab, "ctx": args.ctx, "lr": args.lr, "warmup": args.warmup, "total_steps": args.steps,
       "batch": args.batch, "weight_decay": 0.1, "grad_clip": 1.0, "seed": args.seed}
T, B = cfg["ctx"], cfg["batch"]

if REPLAY:
    # Validation = replay heldout docs only: one window per doc over val-windows distinct docs (replay.val_windows).
    if not args.val_seed:
        raise SystemExit("REPLAY_REFUSED: --val-seed is required with --replay-corpus")
    try:
        k_replay = replay.replay_rows(B, args.replay_frac)
        wins = replay.val_windows([(i, tok.encode(rdocs[i]) + [lm.EOD]) for i in val_ids], T, args.val_windows, args.val_seed)
    except ValueError as e:
        raise SystemExit(f"REPLAY_REFUSED: {e}")
    if k_replay and len(replay_tok) < T + 2:
        raise SystemExit("REPLAY_TOO_SHORT")
    if k_replay < B and len(train_tok) < T + 2:
        raise SystemExit("FT_TOO_SHORT")
    vrec = {"docs": len({d for d, _ in wins}), "windows": len(wins), "sha256": replay.windows_sha(wins), "seed": args.val_seed}
    rrec = {"replayFrac": args.replay_frac, "replayRows": k_replay, "ftRows": B - k_replay, "replayTokens": int(len(replay_tok)), "ftTokens": int(len(train_tok)), "val": vrec}
    if os.path.exists(W("replay.json")) and json.load(open(W("replay.json"))) != rrec:
        raise SystemExit("REPLAY_CONFIG_MISMATCH")
    json.dump(rrec, open(W("replay.json"), "w"), sort_keys=True)
    json.dump(vrec, open(W("val.json"), "w"), sort_keys=True)
    n_eval = len(wins)
    # export.py's eval.json reads tokens_heldout.npy: with replay it is these same pretrain-heldout windows, concatenated.
    np.save(W("tokens_heldout.npy"), np.array([t for _, w in wins for t in w], np.uint16))
    eval_x = np.array([w[:T] for _, w in wins], np.int64)
    eval_y = np.array([w[1:T + 1] for _, w in wins], np.int64)
    print(f"replay rows={k_replay} ft rows={B - k_replay} of batch={B} (frac={args.replay_frac}); val windows={vrec['windows']} docs={vrec['docs']}", flush=True)
else:
    k_replay = 0
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
    if args.init_from:
        with np.load(args.init_from, allow_pickle=False) as z:
            init = {k[2:]: z[k].astype(np.float32) for k in z.files if k.startswith("p.")}
        if sorted(init) != sorted(params) or any(init[k].shape != params[k].shape for k in params):
            raise SystemExit("INIT_SHAPE_MISMATCH")
        params = init
        print("initialized from weights", flush=True)
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


best = {"val": float("inf"), "step": 0, "stale": 0}
if os.path.exists(W("best.json")):
    best = json.load(open(W("best.json")))
if step == 0:
    log({"step": 0, "val_loss": round(eval_loss(), 4)})
start = time.time()
run_start_step = step
while best["stale"] < (args.patience or 10**9) and step < cfg["total_steps"] and time.time() - start < args.max_seconds and not (args.max_steps_this_run and step - run_start_step >= args.max_steps_this_run):
    if REPLAY:
        offs_r = rng.integers(0, len(replay_tok) - T - 1, k_replay) if k_replay else []
        offs_f = rng.integers(0, len(train_tok) - T - 1, B - k_replay) if B - k_replay else []
        rows = [replay_tok[o:o + T + 1] for o in offs_r] + [train_tok[o:o + T + 1] for o in offs_f]
        xy = np.stack(rows).astype(np.int64)
        x, y = xy[:, :T], xy[:, 1:]
    else:
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
    if REPLAY:
        rec["replay_rows"], rec["ft_rows"] = len(offs_r), len(offs_f)
    if step % args.eval_every == 0 or step == cfg["total_steps"]:
        rec["val_loss"] = round(eval_loss(), 4)
        save()
        if args.keep_checkpoints:
            import shutil
            shutil.copyfile(W("checkpoint.npz"), W(f"ckpt-{step}.npz"))
        if rec["val_loss"] < best["val"]:
            best = {"val": rec["val_loss"], "step": step, "stale": 0}
            import shutil
            shutil.copyfile(W("checkpoint.npz"), W("best.npz"))
        else:
            best["stale"] += 1
        json.dump(best, open(W("best.json"), "w"))
    log(rec)
save()
print(f"best val_loss={best['val']} at step={best['step']}" + (" (early stop)" if args.patience and best["stale"] >= args.patience else ""), flush=True)
print(f"stopped step={step} of {cfg['total_steps']} elapsed={time.time() - t0:.0f}s", flush=True)
