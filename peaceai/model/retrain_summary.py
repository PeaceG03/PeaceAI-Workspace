"""M119: one sweep arm's summary from its metrics.jsonl. Fails closed on any non-finite validation loss
(NaN or inf), so the arm selection never sees one.
  retrain_summary.py <metrics.jsonl> <lr> <steps> <stopAt> <earlyStopCount> <valSplit-json> [<stopReason>]
M123 (condition 4): <stopReason> is train.py's timing.json stopReason. A run with no validation loss after step 0 is
refused, EXCEPT when it was time-cut (stopReason deadline or max_seconds) before its first evaluation after step 0: then
the summary is still written, marked deadlineCut, with bestStep 0 and bestVal = the step-0 validation loss (step 0 is
the live weights themselves, so its gain is 0 and the margin gate fails by construction; the select step turns an
all-step-0 sweep into "no candidate" and the run record still lands, never a promotion)."""
import json, math, sys

STOP_REASONS = ("patience", "steps", "max_steps_this_run", "max_seconds", "deadline")
TIME_CUTS = ("max_seconds", "deadline")

def summarize(rows, lr, steps, stop, early, vs, stop_reason=None):
    if stop_reason is not None and stop_reason not in STOP_REASONS:
        raise ValueError("unknown stop reason: refused")
    val = [(r["step"], r["val_loss"]) for r in rows if "val_loss" in r]
    for s, v in val:
        if isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v):
            raise ValueError(f"non-finite validation loss at step {s}: refused")
    if not val or val[0][0] != 0:
        raise ValueError("no step-0 validation loss")
    cut = stop_reason in TIME_CUTS
    after = [v for v in val if v[0] > 0]
    if after:
        best = min(after, key=lambda v: (v[1], v[0]))
    elif cut:
        best = val[0]  # deadline-cut before the first evaluation after step 0: step 0 (the live weights, gain 0)
    else:
        raise ValueError("no validation loss after step 0")
    stopped = max(r["step"] for r in rows)
    return {"lr": lr, "steps": steps, "stopAt": stop, "step0Val": val[0][1], "bestVal": best[1], "bestStep": best[0],
            "stoppedStep": stopped, "valAtStop": dict(val).get(stopped), "earlyStop": early > 0, "valSplit": vs,
            "deadlineCut": cut, "noEvalAfterStep0": not after}

if __name__ == "__main__":
    a = sys.argv
    try:
        out = summarize([json.loads(l) for l in open(a[1]) if l.strip()], float(a[2]), int(a[3]), int(a[4]), int(a[5]), json.loads(a[6]),
                        a[7] if len(a) > 7 else None)
    except ValueError as e:
        sys.exit(str(e))
    print(json.dumps(out, sort_keys=True, allow_nan=False))
