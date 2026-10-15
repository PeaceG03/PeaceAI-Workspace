"""M49: predictions for the set C v2 tasks (#176), graded by peaceai/bin/setc-grade.ts (#177). Greedy, one attempt:
prompt = the pinned file up to and including the body's '{' (last ctx/2 tokens); the body is the text up to the
matching '}'. Writes one {"id","body"} line per task (no output -> empty body, graded as fail). Prints counts only.
Usage: gen_c.py --model DIR --ext DIR --out FILE"""
import argparse, json, os, sys, hashlib
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lm  # noqa: E402
ap = argparse.ArgumentParser()
for a in ("--model", "--ext", "--out"): ap.add_argument(a, required=True)
args = ap.parse_args()
HERE = os.path.dirname(os.path.abspath(__file__))
cfg = json.load(open(f"{args.model}/config.json")); tok = lm.Tokenizer(json.load(open(f"{args.model}/tokenizer.json"))); P = lm.load_weights(f"{args.model}/weights.npz")
T = json.load(open(f"{HERE}/heldout-c-tasks.json"))["tasks"]; rng = np.random.Generator(np.random.PCG64(20261014))
n = 0
with open(args.out, "w") as o:
    for t in T:
        src = open(f"{args.ext}/{t['repo'].replace('/', '__')}/{t['path']}", encoding="utf-8").read()
        assert hashlib.sha256(src.encode()).hexdigest() == t["fileSha256"], t["id"]
        ids = [lm.EOD] + tok.encode(src[:t["bodyStart"] + 1])
        gen = tok.decode(lm.generate(P, cfg, ids[-(cfg["ctx"] // 2):], cfg["ctx"] // 2, rng, 0.0)); d = 1; b = ""
        for i, ch in enumerate(gen):
            d += ch == "{"; d -= ch == "}"
            if d == 0: b = "{" + gen[:i + 1]; n += 1; break
        o.write(json.dumps({"id": t["id"], "body": b}) + "\n")
print(json.dumps({"tasks": len(T), "closed": n}))
