#!/usr/bin/env python3
"""Judge scorer reproduction check, shared by peace-lm-retrain.yml and peace-lm-judge-v2.yml.

judge364.py must reproduce a model's recorded per-item judge aggregates. The rule is the retrain's scorer-repro rule:
the same keys, the same token counts, and every mean within 1e-4. Exact float equality is not required:
judge364.py rounds each block's log-probability to 4 decimals before summing, so a sub-1e-9 difference in the BLAS
kernel (AVX-512 on one CPU, AVX2 on another) can move a block across a rounding boundary. That shifts `logprob` by
1e-4 and `mean` by about 1e-4 / tokens (run 40467123898 refused 27 such entries under exact equality).

Usage: judge_repro.py RECORDED.json GOT.json [--subset] [--drift]
  --subset  compare only the keys in GOT (each must be in RECORDED): the judge-v2 items are a subset of the v1 items.
            Without it the key sets must be equal (the retrain).
  --drift   also print the largest absolute difference per field and the count of entries not exactly equal.
Prints "judge scorer reproduction: entries=N differing=B" and exits 1 if B > 0 or there are no entries.
"""
import json, sys

MEAN_TOL = 1e-4


def entry_differs(r, g):
    """The retrain's rule for one key: missing on either side, a token count mismatch, or a mean more than 1e-4 off."""
    return (r is None or g is None or r["tokens"] != g["tokens"]
            or (r["mean"] is None) != (g["mean"] is None)
            or (r["mean"] is not None and abs(r["mean"] - g["mean"]) > MEAN_TOL))


def compare(rec, got, subset=False):
    keys = set(got) if subset else set(rec) | set(got)
    bad = sorted(k for k in keys if entry_differs(rec.get(k), got.get(k)))
    both = [k for k in keys if k in rec and k in got]
    mx = {}
    for f in ("logprob", "tokens", "mean"):
        ds = [abs(rec[k][f] - got[k][f]) for k in both if rec[k].get(f) is not None and got[k].get(f) is not None]
        mx[f] = max(ds, default=0)
    inexact = sum(1 for k in both if rec[k] != got[k])
    return {"entries": len(got) if subset else len(rec), "differing": len(bad), "bad": bad, "max_abs_diff": mx, "inexact": inexact}


def main(argv):
    flags = {a for a in argv if a.startswith("--")}
    paths = [a for a in argv if not a.startswith("--")]
    if len(paths) != 2 or flags - {"--subset", "--drift"}:
        sys.exit(__doc__)
    rec, got = (json.load(open(p))["agg"] for p in paths)
    r = compare(rec, got, "--subset" in flags)
    print(f"judge scorer reproduction: entries={r['entries']} differing={r['differing']}")
    if "--drift" in flags:
        m = r["max_abs_diff"]
        print(f"judge scorer drift: not_exactly_equal={r['inexact']} max_abs_diff logprob={m['logprob']:.3g} tokens={m['tokens']} mean={m['mean']:.3g} (tolerance: tokens equal, mean within {MEAN_TOL:g})")
    return 1 if r["differing"] or not r["entries"] else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
