"""M119 (LM retrain, Auditor gate 3): score a model on the 364-item judge set (Results lm-judge/items.json;
items are labelled right or wrong). The score is a comparison number only; it is not a claim about either model.

Same items, blocks and math as Results lm-judge/score.mts + score_unverified.py: per item and per candidate
(derived, reference) a unified diff adding the candidate under the item's context is split into blocks exactly like
lm.ts diffScoreItems (max 8 blocks; context = "// <path>\\n" + last 30 before-lines; target = block[:2000] + "\\n"),
each block is scored with infer.py's cond_logprob, and the candidate's mean = sum(logprob) / sum(tokens).
Primary metric (lm-judge/analyze.py): AUC over the right-labelled vs wrong-labelled items of the derived candidate's mean (ties count 1/2),
with the same bootstrap 95% interval (2000 draws, seed 7).
This runs on a model with or without a memcheck PASS (comparison only, never a pipeline score).
Writes --out (per-candidate aggregates; private: Results only). Prints one line of aggregates, never text or keys.
Usage: judge364.py --model DIR --items items.json --out scores.json [--threads K]"""
import argparse, json, math, os, random, sys

def js_slice(s, n):
    """JavaScript String.prototype.slice(0, n): n UTF-16 code units."""
    b = s.encode("utf-16-le", "surrogatepass")
    return b[: 2 * n].decode("utf-16-le", "surrogatepass") if len(b) > 2 * n else s


def diff_score_items(diff, max_blocks=8):
    """Port of peaceai/lib/lm.ts diffScoreItems."""
    items, path, before, block = [], "", [], []

    def flush():
        nonlocal block
        if block and len(items) < max_blocks:
            items.append({"context": f"// {path}\n" + "\n".join(before[-30:]) + ("\n" if before else ""), "target": js_slice("\n".join(block), 2000) + "\n"})
        if block:
            before.extend(block)
        block = []

    for line in diff.split("\n"):
        if line.startswith("+++ "):
            flush()
            path = line[6:] if line.startswith("+++ b/") else line[4:]
            before = []
            continue
        if line.startswith("--- ") or line.startswith("diff --git") or line.startswith("index "):
            continue
        if line.startswith("@@"):
            flush()
            before = []
            continue
        if line.startswith("+"):
            block.append(line[1:])
        else:
            flush()
            if line.startswith(" "):
                before.append(line[1:])
    flush()
    return items


def strip_nl(s):
    return s[:-1] if s.endswith("\n") else s


def diff_of(it, which):
    ctx = strip_nl(it["context"]).split("\n")[1:]
    add = strip_nl(it[which]).split("\n")
    return "\n".join([f"+++ b/{it['file']}", f"@@ -1,{len(ctx)} +1,{len(ctx) + len(add)} @@"] + [" " + l for l in ctx] + ["+" + l for l in add])


def auc(pos, neg):
    w = 0.0
    for a in pos:
        for b in neg:
            w += 1.0 if a > b else 0.5 if a == b else 0.0
    return w / (len(pos) * len(neg))


def boot_auc(pos, neg, n=2000, seed=7):
    r = random.Random(seed)
    v = sorted(auc([r.choice(pos) for _ in pos], [r.choice(neg) for _ in neg]) for _ in range(n))
    return [round(v[int(.025 * n)], 3), round(v[int(.975 * n)], 3)]


def js_round6(x):
    return math.floor(x * 1e6 + 0.5) / 1e6


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", required=True)
    ap.add_argument("--items", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--threads", type=int, default=4)
    args = ap.parse_args()
    for v in ("OPENBLAS_NUM_THREADS", "OMP_NUM_THREADS"):
        os.environ[v] = str(args.threads)
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    import lm  # noqa: E402
    cfg = json.load(open(os.path.join(args.model, "config.json")))
    if cfg.get("schema") != lm.MODEL_SCHEMA:
        sys.exit("judge364: not a model dir")
    tok = lm.Tokenizer(json.load(open(os.path.join(args.model, "tokenizer.json"))))
    p = lm.load_weights(os.path.join(args.model, "weights.npz"))
    T = cfg["ctx"]


    def cond_logprob(prefix, target):  # infer.py cond_logprob
        t_ids = tok.encode(target)[: T // 2]
        p_ids = ([lm.EOD] + tok.encode(prefix))[-(T - len(t_ids)):]
        lps = lm.log_probs(p, cfg, p_ids + t_ids)
        part = lps[len(p_ids):]
        return float(sum(part)), len(part)


    items = json.load(open(args.items, encoding="utf-8"))
    agg = {}
    for it in items:
        for w in ("derived", "reference"):
            lp, n = 0.0, 0
            for b in diff_score_items(diff_of(it, w)):
                s, k = cond_logprob(b["context"], b["target"])
                lp += round(s, 4)
                n += k
            agg[f"{it['key']}:{w}"] = {"logprob": lp, "tokens": n, "mean": js_round6(lp / n) if n else None}
    right = [it for it in items if it["label"] == "right"]
    wrong = [it for it in items if it["label"] == "wrong"]
    if not right or not wrong or any(agg[f"{i['key']}:derived"]["mean"] is None for i in items):
        sys.exit("judge364: an item scored no tokens: refused")
    pr = [agg[f"{i['key']}:derived"]["mean"] for i in right]
    ng = [agg[f"{i['key']}:derived"]["mean"] for i in wrong]
    summary = {"model": cfg["version"], "n": len(items), "right": len(right), "wrong": len(wrong),
               "auc_derived_right_vs_wrong_mean": round(auc(pr, ng), 3), "auc_exact": auc(pr, ng), "auc_ci95": boot_auc(pr, ng),
               "pairwise_ref_beats_wrong_derived": sum(agg[f"{i['key']}:reference"]["mean"] > agg[f"{i['key']}:derived"]["mean"] for i in wrong)}
    json.dump({"model": cfg["version"], "verified": False, "scorer": "judge364.py (score.mts blocks + infer.py cond_logprob)", "summary": summary, "agg": agg}, open(args.out, "w"), indent=1)
    print(f"judge364 model={summary['model']} n={summary['n']} auc={summary['auc_derived_right_vs_wrong_mean']} auc_ci95={summary['auc_ci95']}".replace(", ", ","))


if __name__ == "__main__":
    main()
