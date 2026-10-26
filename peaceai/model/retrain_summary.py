"""M119: one sweep arm's summary from its metrics.jsonl. Fails closed on any non-finite validation loss
(NaN or inf), so the arm selection never sees one.
  retrain_summary.py <metrics.jsonl> <lr> <steps> <stopAt> <earlyStopCount> <valSplit-json>"""
import json, math, sys

def summarize(rows, lr, steps, stop, early, vs):
    val = [(r["step"], r["val_loss"]) for r in rows if "val_loss" in r]
    for s, v in val:
        if isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v):
            raise ValueError(f"non-finite validation loss at step {s}: refused")
    if not val or val[0][0] != 0:
        raise ValueError("no step-0 validation loss")
    after = [v for v in val if v[0] > 0]
    if not after:
        raise ValueError("no validation loss after step 0")
    best = min(after, key=lambda v: (v[1], v[0]))
    stopped = max(r["step"] for r in rows)
    return {"lr": lr, "steps": steps, "stopAt": stop, "step0Val": val[0][1], "bestVal": best[1], "bestStep": best[0],
            "stoppedStep": stopped, "valAtStop": dict(val).get(stopped), "earlyStop": early > 0, "valSplit": vs}

if __name__ == "__main__":
    a = sys.argv
    try:
        out = summarize([json.loads(l) for l in open(a[1]) if l.strip()], float(a[2]), int(a[3]), int(a[4]), int(a[5]), json.loads(a[6]))
    except ValueError as e:
        sys.exit(str(e))
    print(json.dumps(out, sort_keys=True, allow_nan=False))
