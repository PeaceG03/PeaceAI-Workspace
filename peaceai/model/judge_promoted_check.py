#!/usr/bin/env python3
"""Judge v2 promoted pin check (peace-lm-judge-v2-promoted.yml; Auditor, after #571).

The promoted model rescored on the v2 items must reproduce, exactly, the AUC (3 dp), both 95% bounds (3 dp), n and the
right / wrong counts of BOTH peaceai/model/judge-v2.json promoted (+ items) AND the run record's judge.candidate, and
must be the promoted model. Per-item agreement with the run's judge-model.json is judge_repro.py's job (run before this).

Usage: judge_promoted_check.py NEW_SCORES.json JUDGE_V2.json RECORD_JUDGE_CANDIDATE.json
Prints one line of aggregates; exits 1 (refused) on any difference.
"""
import json, sys


def check(new, pin, rec):
    """Returns a list of refusal reasons (empty = reproduced)."""
    s, p = new["summary"], pin["promoted"]
    got = (s["auc_derived_right_vs_wrong_mean"], s["auc_ci95"], s["n"], s["right"], s["wrong"])
    why = []
    if new.get("model") != p["version"] or s.get("model") != p["version"]:
        why.append("rescored model is not judge-v2.json promoted.version")
    if got != (p["auc"], p["auc_ci95"], pin["items"]["n"], pin["items"]["right"], pin["items"]["wrong"]):
        why.append("AUC, CI, n or counts differ from the judge-v2.json promoted pin")
    if rec.get("model") != p["version"] or got != (rec["auc_derived_right_vs_wrong_mean"], rec["auc_ci95"], rec["n"], rec["right"], rec["wrong"]):
        why.append("AUC, CI, n or counts differ from the run record's judge.candidate")
    return why


def main(argv):
    if len(argv) != 3:
        sys.exit(__doc__)
    new, pin, rec = (json.load(open(a)) for a in argv)
    why = check(new, pin, rec)
    s = new["summary"]
    if why:
        for w in why:
            print(f"promoted judge v2: {w}: refused")
        return 1
    print(f"promoted judge v2 reproduced: model={s['model']} n={s['n']} auc={s['auc_derived_right_vs_wrong_mean']} auc_ci95={s['auc_ci95']}".replace(", ", ","))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
