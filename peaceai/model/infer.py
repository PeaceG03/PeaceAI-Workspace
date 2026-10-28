"""M9 inference: score | fill | sample. Reads a request JSON, writes a response JSON. Prints nothing else.

Usage: infer.py MODE --model DIR --request FILE --response FILE [--threads K]
score and fill refuse (exit 3, MEMCHECK_REQUIRED) unless DIR/memcheck.json is a PASS bound to the exact
sha256 of config.json, tokenizer.json and weights.npz, or (Fix B, the same rule as lm.ts verifyModelDir) memcheck.json
binds those files and a PASS recheck in the model's own retrain run (<results>/runs/lm-retrain/<retrain.runId>/
memcheck-recheck-<run>.json) accepts it; any FAIL recheck refuses. sample is only for the memorization check itself and
needs --unverified."""
import argparse
import json
import os
import re
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


MEMCHECK_SCHEMA = "peaceai-lm-memcheck:v1"
PRETRAIN_V2 = "peaceai-lm-retrain-memcheck-pretrain:v2"
RUN_ID = re.compile(r"^[1-9][0-9]{5,19}$")
RECHECK_FILE = re.compile(r"^memcheck-recheck-([1-9][0-9]{5,19})\.json$")
HEX64 = re.compile(r"^[0-9a-f]{64}$")


def same(a, b):
    """Key-order independent JSON equality (lm.ts sameJson)."""
    return json.dumps(a, sort_keys=True) == json.dumps(b, sort_keys=True)


def obj(x):
    return x if isinstance(x, dict) else {}


def retrain_trained_on(cfg):
    """lm.ts retrainPretrainTrainedOn."""
    r = obj(cfg).get("retrain")
    if not isinstance(r, dict) or r.get("mode") != "pretrain":
        return None
    p, f, pc = r.get("replayManifestSha256"), r.get("finetuneManifestSha256"), obj(r.get("replayCorpus")).get("manifestSha256")
    hexok = lambda x: isinstance(x, str) and HEX64.match(x) is not None
    if not hexok(p) or not hexok(f) or p != pc or p == f:
        return None
    return {"pretrain": p, "finetune": f}


def recheck_decision(model_dir, cfg, shas):
    """lm.ts retrainRunDir + recheckDecision: "none" | "ok" | "failed" | "invalid"."""
    version, run_id = cfg.get("version"), obj(cfg.get("retrain")).get("runId")
    d = os.path.abspath(model_dir)
    if not isinstance(run_id, str) or not RUN_ID.match(run_id) or os.path.basename(d) != version \
            or os.path.basename(os.path.dirname(d)) != "lm" or os.path.basename(os.path.dirname(os.path.dirname(d))) != "models":
        return "none"
    run = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(d))), "runs", "lm-retrain", run_id)
    if not os.path.isdir(run) or os.path.islink(run):
        return "none"
    names = sorted(n for n in os.listdir(run) if n.startswith("memcheck-recheck-"))
    if not names:
        return "none"
    recs = []
    for n in names:
        m, p = RECHECK_FILE.match(n), os.path.join(run, n)
        if not m or os.path.islink(p) or not os.path.isfile(p):
            return "failed"
        try:
            recs.append((m.group(1), json.load(open(p))))
        except (OSError, ValueError):
            return "failed"

    def failed(r):
        if not isinstance(r, dict) or r.get("status") != "PASS":
            return True
        pm = obj(r.get("pretrainMemcheck"))
        rs = obj(pm.get("runStatus"))
        return any(x is not None and x != "PASS" for x in (obj(pm.get("replayCorpus")).get("status"), rs.get("ftCorpus"), rs.get("replayCorpus")))

    if any(failed(r) for _, r in recs):
        return "failed"
    t = retrain_trained_on(cfg)
    if t is None:
        return "invalid"

    def passes(rid, r):
        pm = obj(r.get("pretrainMemcheck"))
        rc, rk, rs = obj(pm.get("replayCorpus")), obj(r.get("recheck")), obj(pm.get("runStatus"))
        cf, rcf = obj(r.get("coreFreeProofs")), obj(rc.get("coreFreeProofs"))
        return (r.get("schema") == MEMCHECK_SCHEMA and r.get("substringRule") == "core-free-64"
                and pm.get("schema") == PRETRAIN_V2 and pm.get("twoCorpus") is True
                and rs.get("ftCorpus") == "PASS" and rs.get("replayCorpus") == "PASS"
                and rc.get("schema") == MEMCHECK_SCHEMA and rc.get("substringRule") == "core-free-64"
                and cf.get("ok") is True and rcf.get("ok") is True
                and same(cf.get("trainedOn"), t) and same(rcf.get("trainedOn"), t)
                and same(r.get("files"), shas) and same(rc.get("files"), shas)
                and r.get("model") == version and rc.get("model") == version and rk.get("candidate") == version
                and str(rk.get("sourceRunId", "")) == run_id and str(rk.get("recheckRunId", "")) == rid)

    return "ok" if any(passes(rid, r) for rid, r in recs) else "invalid"


def verified(model_dir):
    try:
        mc = json.load(open(os.path.join(model_dir, "memcheck.json")))
        shas = {f: lm.file_sha256(os.path.join(model_dir, f)) for f in FILES}
    except (OSError, ValueError):
        return False
    if not isinstance(mc, dict) or mc.get("schema") != MEMCHECK_SCHEMA:
        return False
    try:
        cfg = obj(json.load(open(os.path.join(model_dir, "config.json"))))
    except (OSError, ValueError):
        cfg = {}
    cfg_ok = cfg.get("schema") == "peaceai-lm:v1" and re.match(r"^lm-v1-[0-9a-f]{12}$", str(cfg.get("version", ""))) is not None
    recheck = recheck_decision(model_dir, cfg, shas) if cfg_ok else "none"
    if recheck == "failed":
        return False
    if mc.get("status") == "PASS":
        return mc.get("files") == shas
    return recheck == "ok" and same(mc.get("files"), shas) and mc.get("model", cfg.get("version")) == cfg.get("version")


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
