"""M37: held-out set C v2 score for a freshly trained model: mean per-token loss on the whole held-out external
repositories (files fetched and sha256-verified by ext-fetch.ts --set-c). Prints one line of aggregates only (no text).
Runs only when peaceai/model/heldout-c.json has wiredAsEval = true (the workflow step checks; so does this script).

M39 (Architect): every line also reports bytes_scored and loss per byte (nats/byte and bits/byte), so models with
different tokenizers compare. Token mode (default): bytes_scored = UTF-8 bytes of the scored target tokens.
Byte mode (--max-bytes N): a model-independent slice: the files in set C v2 order, concatenated as UTF-8, cut at N
bytes (the last file cut back to a character boundary). Each model tokenizes exactly that slice and scores every
token of it (no token cap); slice_sha256 proves two runs scored identical bytes.

Usage: eval_c.py --model DIR --corpus CDIR [--max-tokens N | --max-bytes N] [--threads K]"""
import argparse
import hashlib
import json
import math
import os
import sys

ap = argparse.ArgumentParser()
ap.add_argument("--model", required=True)
ap.add_argument("--corpus", required=True)
ap.add_argument("--max-tokens", type=int, default=262144)
ap.add_argument("--max-bytes", type=int, default=0)
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
touched = 0  # files with at least one byte/token inside the cap
full = 0  # files entirely inside the cap
slice_h = hashlib.sha256()
slice_bytes = 0
cut_done = False
with open(os.path.join(args.corpus, "docs.jsonl"), encoding="utf-8") as f:
    for line in f:  # set C v2 order (repo, then path): deterministic
        if not line.strip():
            continue
        total_files += 1
        if args.max_bytes > 0:
            if slice_bytes >= args.max_bytes or cut_done:
                continue
            b = json.loads(line)["text"].encode("utf-8")
            room = args.max_bytes - slice_bytes
            if len(b) <= room:
                full += 1
            else:
                b = b[:room].decode("utf-8", "ignore").encode("utf-8")  # back to a character boundary
                cut_done = True  # the slice ends inside this file: no later file contributes
            if not b and len(json.loads(line)["text"]) > 0:
                continue
            touched += 1
            slice_h.update(len(b).to_bytes(8, "big") + b)
            slice_bytes += len(b)
            ids.append(lm.EOD)
            ids.extend(tok.encode(b.decode("utf-8")))
            continue
        if len(ids) >= args.max_tokens:  # a file starting at the cap has no token scored (only its EOD separator)
            continue
        doc = [lm.EOD] + tok.encode(json.loads(line)["text"])
        touched += 1
        if len(ids) + len(doc) <= args.max_tokens + 1:
            full += 1
        ids.extend(doc)
if args.max_bytes <= 0:
    ids = ids[: args.max_tokens + 1]
else:
    ids.append(lm.EOD)  # the slice's last byte is scored too (its successor is the end-of-document)
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
if args.max_bytes > 0:
    nbytes = slice_bytes
    mode = f"bytes max_bytes={args.max_bytes} slice_sha256={slice_h.hexdigest()}"
else:
    nbytes = sum(len(tok.bytes_of[t]) for t in ids[1:])
    mode = f"tokens max_tokens={args.max_tokens}"
scope = "full" if full == total_files else "partial"
print(f"setC_v2 scope={scope} model={cfg.get('version')} mode={mode} files_scored={touched} files_fully_scored={full} files_total={total_files} "
      f"tokens={n} bytes_scored={nbytes} mean_loss={total / max(n, 1):.4f} loss_per_byte={total / max(nbytes, 1):.4f} bits_per_byte={total / max(nbytes, 1) / math.log(2):.4f}")
