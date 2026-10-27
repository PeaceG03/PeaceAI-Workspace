"""Judge AUC gate for the LM retrain (spec: peaceai/spec/lm-retrain-judge-gate-v1.md).

bpb and the set-C slice stay hard gates in the workflow. The judge AUC is REPORT-ONLY: it is recorded (full set and
non-identity subset, each with its 95% interval) but it can neither block nor pass a candidate.

Promote-to-hard rule: the judge AUC may act as a hard gate only when the configured mode is "hard" AND the lower 95%
bound of the AUC is above 0.5 on BOTH the full set and the non-identity subset. The bounds are read from the live
(reference) model's judge364 summary from the same run, so the rule is about the judge set and the reference, never
about the candidate being gated. A bound of exactly 0.5, a missing bound, or a missing subset is not eligible.
When the gate is hard, a candidate whose full-set auc_exact is below the live model's is blocked (why: judge_auc).

Usage: judge_gate.py --mode report-only|hard --live live.json --candidate candidate.json
(each file is a judge364 --out file or its "summary" object). Prints one JSON object; exits 0 unless the input is bad.
"""
import argparse, json, sys

MODES = ("report-only", "hard")
HARD_LOWER_BOUND_ABOVE = 0.5


def summary_of(doc):
    return doc["summary"] if isinstance(doc, dict) and "summary" in doc else doc


def lower(ci):
    if not isinstance(ci, list) or len(ci) != 2 or not all(isinstance(x, (int, float)) and not isinstance(x, bool) for x in ci):
        return None
    return ci[0]


def eligible(live):
    """True only when both lower 95% bounds (full set, non-identity subset) are strictly above 0.5."""
    full = lower(live.get("auc_ci95"))
    ni = lower((live.get("nonidentity") or {}).get("auc_ci95"))
    return full is not None and ni is not None and full > HARD_LOWER_BOUND_ABOVE and ni > HARD_LOWER_BOUND_ABOVE


def report(s):
    ni = s.get("nonidentity") or {}
    return {"model": s.get("model"), "full": {"n": s.get("n"), "auc_exact": s.get("auc_exact"), "auc_ci95": s.get("auc_ci95")},
            "nonidentity": {"n": ni.get("n"), "auc_exact": ni.get("auc_exact"), "auc_ci95": ni.get("auc_ci95")}}


def decide(mode, live, candidate):
    if mode not in MODES:
        raise ValueError(f"judge gate mode must be one of {MODES}")
    live, candidate = summary_of(live), summary_of(candidate)
    ok_hard = eligible(live)
    effective = "hard" if mode == "hard" and ok_hard else "report-only"
    blocks = False
    if effective == "hard":
        a, b = candidate.get("auc_exact"), live.get("auc_exact")
        blocks = not (isinstance(a, (int, float)) and isinstance(b, (int, float)) and a >= b)
    return {"configured": mode, "effective": effective, "hardEligible": ok_hard, "blocks": blocks,
            "rule": "hard only when the live model's lower 95% AUC bound is above 0.5 on both the full set and the non-identity subset",
            "live": report(live), "candidate": report(candidate)}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--mode", required=True)
    ap.add_argument("--live", required=True)
    ap.add_argument("--candidate", required=True)
    a = ap.parse_args()
    try:
        out = decide(a.mode, json.load(open(a.live)), json.load(open(a.candidate)))
    except (ValueError, OSError, AttributeError, TypeError) as e:
        sys.exit(f"judge gate: bad input ({type(e).__name__}): refused")
    print(json.dumps(out, separators=(",", ":")))


if __name__ == "__main__":
    main()
