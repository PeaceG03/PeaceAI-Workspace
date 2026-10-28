"""M123 sweep select rule, shared by finetune-eval-land's select step and retrain-outcome's dry-run pick (one copy, no drift).

usage: sweep_select.py <lm-retrain.json> <validation split json> <mode> <arm summary json>...
Picks the arm/step with the lowest validation loss on the pretrain-heldout windows (never set C v2, the judge items or the
fine-tune corpus); refuses (exit != 0) on any arm that is not the configured arm. Prints the select record (JSON).
Moved verbatim from the select step of .github/workflows/peace-lm-retrain.yml (run 40555453905 follow-up, Auditor).
"""
import json, sys
MODES = ("finetune", "pretrain")
cfg, vs, mode = json.load(open(sys.argv[1])), json.loads(sys.argv[2]), sys.argv[3]
if mode not in MODES:
    sys.exit("unknown retrain mode: refused")
ft = cfg[mode]; lrs = ft["sweep"]["lrs"]
arms = [json.loads(a) for a in sys.argv[4:]]
if sorted(a["arm"] for a in arms) != list(range(len(lrs))) or len(arms) != len(lrs):
    sys.exit("sweep arms missing")
for a in arms:
    if a["lr"] != lrs[a["arm"]] or a["steps"] != ft["steps"] or a["stopAt"] != 0:
        sys.exit("sweep arm is not the configured arm")
    if a["valSplit"] != vs:
        sys.exit("sweep arm used a different validation split")
    r = a.get("replay") or {}
    if r.get("replayFrac") != ft["replayFrac"] or (r.get("val") or {}).get("windows") != ft["valWindows"] or (r.get("val") or {}).get("docs") != ft["valWindows"]:
        sys.exit("sweep arm used a different replay share or validation windows")
    if a.get("mode") != mode or (mode == "pretrain" and r.get("ftRows") != 0):
        sys.exit("sweep arm ran in a different mode")
    if a["bestStep"] == 0:
        # deadline-cut before its first evaluation after step 0: step 0 = the live weights (gain 0), never a candidate
        if not (a.get("deadlineCut") is True and a.get("noEvalAfterStep0") is True and (a.get("timing") or {}).get("timeCut") is True and a["bestVal"] == a["step0Val"]):
            sys.exit("bad sweep best step")
    elif not (0 < a["bestStep"] <= ft["steps"]) or a["bestStep"] % ft["evalEvery"] and a["bestStep"] != ft["steps"]:
        sys.exit("bad sweep best step")
if len({json.dumps(a["replay"]["val"], sort_keys=True) for a in arms}) != 1:
    sys.exit("sweep arms used different validation windows")
if len({json.dumps(a["replay"]["corpus"], sort_keys=True) for a in arms}) != 1:
    sys.exit("sweep arms used different replay corpora")
real = [a for a in arms if a["bestStep"] > 0]
if real:
    best = min(real, key=lambda a: (a["bestVal"], a["bestStep"], a["arm"]))
    selected = {"arm": best["arm"], "lr": best["lr"], "step": best["bestStep"], "valLoss": best["bestVal"], "candidate": True}
else:  # every arm deadline-cut before its first evaluation after step 0: the selected step is 0 (the live weights)
    selected = {"arm": None, "lr": None, "step": 0, "valLoss": min(a["step0Val"] for a in arms), "candidate": False, "result": "no candidate",
                "why": "every sweep arm was deadline-cut before its first evaluation after step 0; step 0 is the live weights (gain 0), so the margin gate fails by construction"}
print(json.dumps({"mode": mode, "validationSplit": vs, "arms": sorted(arms, key=lambda a: a["arm"]), "selected": selected,
                  "rule": ft["sweep"]["select"]}, sort_keys=True))
