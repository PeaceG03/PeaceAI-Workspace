"""M9 inference: score | fill | sample. Reads a request JSON, writes a response JSON. Prints nothing else.

Usage: infer.py MODE --model DIR --request FILE --response FILE [--threads K]
score and fill refuse (exit 3, MEMCHECK_REQUIRED) unless DIR/memcheck.json is a PASS bound to the exact
sha256 of config.json, tokenizer.json and weights.npz. sample is only for the memorization check itself and
needs --unverified."""
import argparse
import json
import os
import sys

ap = argparse.ArgumentParser()
ap.add_argument("mode", choices=["score", "fill", "sample"])
ap.add_argument("--model", required=True)
ap.add_argument("--request", required=True)
ap.add_argument("--response", required=True)
ap.add_argument("--threads", type=int, default=2)
ap.add_argument("--unverified", action="store_true")
args = ap.parse_args()
for v in ("OPENBLAS_NUM_THREADS", "OMP_NUM_THREADS"):
    os.environ[v] = str(args.threads)
import numpy as np  # noqa: E402

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lm  # noqa: E402

FILES = ("config.json", "tokenizer.json", "weights.npz")


def verified(model_dir):
    try:
        mc = json.load(open(os.path.join(model_dir, "memcheck.json")))
        shas = {f: lm.file_sha256(os.path.join(model_dir, f)) for f in FILES}
    except (OSError, ValueError):
        return False
    return mc.get("schema") == "peaceai-lm-memcheck:v1" and mc.get("status") == "PASS" and mc.get("files") == shas


if args.mode == "sample":
    if not args.unverified:
        sys.exit("sample is for the memorization check only (--unverified)")
elif not verified(args.model):
    print("MEMCHECK_REQUIRED", file=sys.stderr)
    sys.exit(3)

cfg = json.load(open(os.path.join(args.model, "config.json")))
if cfg.get("schema") != lm.MODEL_SCHEMA:
    sys.exit("MODEL_INVALID")
tok = lm.Tokenizer(json.load(open(os.path.join(args.model, "tokenizer.json"))))
p = lm.load_weights(os.path.join(args.model, "weights.npz"))
req = json.load(open(args.request))
T = cfg["ctx"]


def cond_logprob(prefix, target):
    """Sum and count of log P(target tokens | prefix), prefix truncated to fit the context."""
    t_ids = tok.encode(target)[: T // 2]
    p_ids = ([lm.EOD] + tok.encode(prefix))[-(T - len(t_ids)):]
    lps = lm.log_probs(p, cfg, p_ids + t_ids)
    part = lps[len(p_ids):]
    return float(sum(part)), len(part)


out = {"model": cfg["version"], "mode": args.mode}
if args.mode == "score":
    res = []
    for it in req["items"][:64]:
        s, n = cond_logprob(str(it["context"]), str(it["target"]))
        res.append({"id": it["id"], "logprob": round(s, 4), "tokens": n, "mean": round(s / n, 6) if n else None})
    out["scores"] = res
elif args.mode == "fill":
    res = []
    for h in req["holes"][:8]:
        opts = [str(o) for o in h["options"]][:32]
        scored = [round(cond_logprob(str(h["prefix"]), o + str(h.get("suffix", "")))[0], 4) for o in opts]
        best = max(range(len(opts)), key=lambda i: (scored[i], -i)) if opts else None
        res.append({"key": h["key"], "best": opts[best] if best is not None else None, "scores": scored})
    out["fills"] = res
else:
    rng = np.random.Generator(np.random.PCG64(int(req.get("seed", 1))))
    res = []
    for pr in req["prompts"]:
        ids = ([lm.EOD] + tok.encode(str(pr["text"])))[-int(req.get("prompt_tokens", 64)):]
        for kind, temp in (("greedy", 0.0), ("sampled", float(req.get("temperature", 0.8)))):
            gen = lm.generate(p, cfg, ids, int(req.get("new_tokens", 128)), rng, temp)
            res.append({"id": f"{pr['id']}:{kind}", "prompt": pr["id"], "kind": kind, "prompt_tail": tok.decode(ids).split("\n")[-1], "text": tok.decode(gen)})
    out["samples"] = res
with open(args.response, "w") as f:
    json.dump(out, f)
