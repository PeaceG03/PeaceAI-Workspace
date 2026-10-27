"""LM retrain, pretrain mode: one memcheck record from the two memcheck runs over the same landed candidate.
Continued pretraining trains on the replay corpus (the live model's full pretrain train split) and starts from weights
that saw the fine-tune corpus's code, so BOTH runs are required (Auditor, 2026-10-27):
  ftCorpus      lm-memcheck.ts with PEACEAI_LM_CORPUS = the proven fine-tune corpus (the strict 32-character rule,
                exactly as in finetune mode)
  replayCorpus  lm-memcheck.ts with PEACEAI_LM_CORPUS = the replay corpus (public prompts drawn from what this run
                trained on, on top of the core prompts; strict rule as well: no training corpus is given)
  memcheck_combine.py --ft <memcheck.json> --replay <memcheck.json> --out <memcheck.json>
The output is the fine-tune-corpus record (schema and model-file binding unchanged) with status = PASS iff both runs
are PASS and both used the strict rule, substringRule = "strict" iff both did (else "mixed", which the workflow
refuses), and the replay-corpus run under pretrainMemcheck. Unreadable or missing input: FAIL. Prints one line only."""
import argparse
import json
import sys

SCHEMA = "peaceai-lm-retrain-memcheck-pretrain:v1"


def combine(ft, rp):
    """The fine-tune-corpus record (its schema and model-file binding kept as is) with status replaced by the combined
    status and the replay-corpus run attached under pretrainMemcheck."""
    runs = {"ftCorpus": ft, "replayCorpus": rp}
    strict = all(isinstance(r, dict) and r.get("substringRule") == "strict" for r in runs.values())
    ok = strict and all(isinstance(r, dict) and r.get("status") == "PASS" for r in runs.values())
    out = dict(ft) if isinstance(ft, dict) else {}
    out["status"] = "PASS" if ok else "FAIL"
    out["substringRule"] = "strict" if strict else "mixed"
    out["pretrainMemcheck"] = {"schema": SCHEMA, "rule": "PASS iff the fine-tune-corpus run and the replay-corpus run are both PASS under the strict rule",
                               "runStatus": {k: (r.get("status") if isinstance(r, dict) else None) for k, r in runs.items()},
                               "replayCorpus": rp if isinstance(rp, dict) else None}
    return out


def main():
    ap = argparse.ArgumentParser()
    for k in ("--ft", "--replay", "--out"):
        ap.add_argument(k, required=True)
    a = ap.parse_args()

    def load(p):
        try:
            return json.load(open(p, encoding="utf-8"))
        except (OSError, ValueError):
            return None
    rep = combine(load(a.ft), load(a.replay))
    json.dump(rep, open(a.out, "w"), indent=1, sort_keys=True)
    print(f"memcheck pretrain status={rep['status']} rule={rep['substringRule']} ft={rep['pretrainMemcheck']['runStatus']['ftCorpus']} replay={rep['pretrainMemcheck']['runStatus']['replayCorpus']}")
    sys.exit(0 if rep["status"] == "PASS" else 1)


if __name__ == "__main__":
    main()
