"""lb-chain2 v1 (spec peaceai/spec/lb-chain2-v1.md, Auditor condition 3): the heldout_v2 evaluation, reported
SEPARATELY from the days-1-3 held-out bpb (export.py eval.json, unchanged). Same method as export.py: the exported fp16
weights (<work>/model/weights.npz), the run's tokenizer, non-overlapping ctx windows (at most 96) of the heldout_v2
stream (the corpus's split == "heldout_v2" docs in doc order, each followed by EOD), and the unigram baseline from the
run's own tokens_train.npy (add-one counts). Output <work>/model/eval-v2.json:
  docs, heldout_tokens, windows, held_bytes, model_ce (unrounded), model_bits_per_byte, unigram_bits_per_byte
(bpb = ce * tokens / ln 2 / bytes, rounded to 4 places). heldout_v2 docs are never trained on (train.py reads split ==
"train" only) and never select a checkpoint (early stop reads split == "heldout").
Usage: eval_v2.py --corpus DIR --work DIR [--threads N]"""
import argparse
import json
import math
import os
import sys

HELDOUT2 = "heldout_v2"
MAX_WINDOWS = 96

ap = argparse.ArgumentParser()
ap.add_argument("--corpus", required=True)
ap.add_argument("--work", required=True)
ap.add_argument("--threads", type=int, default=1)
args = ap.parse_args()
for v in ("OPENBLAS_NUM_THREADS", "OMP_NUM_THREADS"):
    os.environ[v] = str(args.threads)
import numpy as np  # noqa: E402

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lm  # noqa: E402


def v2_ids(d):
    sp = {}
    with open(os.path.join(d, "manifest.jsonl"), encoding="utf-8") as f:
        for line in f:
            if line.strip():
                o = json.loads(line)
                sp[o["doc"]] = o["split"]
    return sorted(i for i, s in sp.items() if s == HELDOUT2)


ids = set(v2_ids(args.corpus))
if not ids:
    raise SystemExit("EVAL_V2_NO_DOCS")
texts = {}
with open(os.path.join(args.corpus, "docs.jsonl"), encoding="utf-8") as f:
    for line in f:
        if line.strip():
            o = json.loads(line)
            if o["doc"] in ids:
                texts[o["doc"]] = o["text"]
if set(texts) != ids:
    raise SystemExit("EVAL_V2_DOCS_MISSING")
W = args.work
ck = "best.npz" if os.path.isfile(os.path.join(W, "best.npz")) else "checkpoint.npz"
with np.load(os.path.join(W, ck), allow_pickle=False) as z:
    cfg = json.loads(str(z["meta"]))["cfg"]
tok = lm.Tokenizer(json.load(open(os.path.join(W, "model", "tokenizer.json"))))
stream = []
for i in sorted(ids):
    stream.extend(tok.encode(texts[i]))
    stream.append(lm.EOD)
held = np.array(stream, np.int64)
T = cfg["ctx"]
n_eval = min((len(held) - 1) // T, MAX_WINDOWS)
if n_eval < 1:
    raise SystemExit("EVAL_V2_TOO_SHORT")
train = np.load(os.path.join(W, "tokens_train.npy")).astype(np.int64)
counts = np.bincount(train, minlength=cfg["vocab_size"]).astype(np.float64) + 1.0
uni = np.log(counts / counts.sum())
w16 = lm.load_weights(os.path.join(W, "model", "weights.npz"))
tot = 0.0
for i in range(0, n_eval, 4):
    j = range(i, min(n_eval, i + 4))
    x = np.stack([held[k * T:k * T + T] for k in j])
    y = np.stack([held[k * T + 1:k * T + T + 1] for k in j])
    tot += lm.forward(w16, cfg, x, y)[1] * len(j)
m16 = float(tot / n_eval)
ys = np.concatenate([held[k * T + 1:k * T + T + 1] for k in range(n_eval)])
uni_ce = float(-uni[ys].mean())
held_bytes = len(tok.decode(ys.tolist()).encode())
ev = {"docs": len(ids), "heldout_tokens": int(len(ys)), "windows": int(n_eval), "held_bytes": int(held_bytes), "model_ce": m16,
      "model_bits_per_byte": round(m16 * len(ys) / math.log(2) / held_bytes, 4),
      "unigram_bits_per_byte": round(uni_ce * len(ys) / math.log(2) / held_bytes, 4)}
fd = os.open(os.path.join(W, "model", "eval-v2.json"), os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0), 0o644)
with os.fdopen(fd, "w") as f:
    f.write(json.dumps(ev, indent=2, sort_keys=True) + "\n")
print("eval_v2 docs=%d windows=%d tokens=%d bytes=%d bpb=%s baseline_bpb=%s" % (ev["docs"], ev["windows"], ev["heldout_tokens"], ev["held_bytes"],
      ev["model_bits_per_byte"], ev["unigram_bits_per_byte"]))
