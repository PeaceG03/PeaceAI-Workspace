"""M37: held-out set C v2 score for a freshly trained model: mean per-token loss on the whole held-out external
repositories (files fetched and sha256-verified by ext-fetch.ts --set-c). Prints one line of aggregates only (no text).
Runs only when peaceai/model/heldout-c.json has wiredAsEval = true (the workflow step checks; so does this script).

Usage: eval_c.py --model DIR --corpus CDIR [--max-tokens N] [--threads K]"""
import argparse
import json
import os
import sys

ap = argparse.ArgumentParser()
ap.add_argument("--model", required=True)
ap.add_argument("--corpus", required=True)
ap.add_argument("--max-tokens", type=int, default=262144)
ap.add_argument("--threads", type=int, default=4)
args = ap.parse_args()
for v in ("OPENBLAS_NUM_THREADS", "OMP_NUM_THREADS"):
    os.environ[v] = str(args.threads)
import numpy as np  # noqa: E402

here = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, here)
import lm  # noqa: E402

if json.load(open(os.path.join(here, "heldout-c.json"))).get("wiredAsEval") is not True:
    sys.exit("set C v2 is not wired as eval (Architect decision pending)")
cfg = json.load(open(os.path.join(args.model, "config.json")))
tok = lm.Tokenizer(json.load(open(os.path.join(args.model, "tokenizer.json"))))
p = lm.load_weights(os.path.join(args.model, "weights.npz"))
T = cfg["ctx"]
ids = []
total_files = 0
touched = 0  # files with at least one token inside the cap
full = 0  # files entirely inside the cap
with open(os.path.join(args.corpus, "docs.jsonl"), encoding="utf-8") as f:
    for line in f:  # set C v2 order (repo, then path): deterministic
        if not line.strip():
            continue
        total_files += 1
        if len(ids) > args.max_tokens:
            continue
        doc = [lm.EOD] + tok.encode(json.loads(line)["text"])
        touched += 1
        if len(ids) + len(doc) <= args.max_tokens + 1:
            full += 1
        ids.extend(doc)
ids = ids[: args.max_tokens + 1]
total, n = 0.0, 0
for lo in range(0, len(ids) - 1, T):
    x = ids[lo: lo + T]
    y = ids[lo + 1: lo + T + 1]
    x = x[: len(y)]
    if not y:
        break
    logits, _, _ = lm.forward(p, cfg, np.array([x], np.int64))
    z = logits[0] - logits[0].max(-1, keepdims=True)
    lp = z - np.log(np.exp(z).sum(-1, keepdims=True))
    total += float(-lp[np.arange(len(y)), y].sum())
    n += len(y)
scope = "full" if full == total_files else "partial"
print(f"setC_v2 scope={scope} model={cfg.get('version')} files_scored={touched} files_fully_scored={full} files_total={total_files} tokens={n} mean_loss={total / max(n, 1):.4f}")
