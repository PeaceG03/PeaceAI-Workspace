#!/usr/bin/env python3
"""Builds report.json and the score tables of REPORT.md from runs/*/result.json and tasks.json."""
import json, os, glob, collections
H = os.path.dirname(os.path.abspath(__file__))
tasks = {t["id"]: t for t in json.load(open(os.path.join(H, "tasks.json")))["tasks"]}
res = {r["id"]: r for r in (json.load(open(f)) for f in glob.glob(os.path.join(H, "runs/*/result.json")))}
GAP = {  # false refusal -> root cause (from the Job A refusal line / Job B result of that task)
 "A4": "nl-plain-to-learned", "C3": "bullet-is-array+closure", "C4": "complex-template-literal", "L3": "while-nonconst-bound",
 "L4": "bullet-is-array+helper-call", "D2": "bullet-is-date", "G1": "bullet-nan-literal", "M2": "clean-html-comment-in-literal",
 "T1": "te-cross-module-import", "T4": "te-cross-module-import", "E1": "envfix-presence-read", "K1": "kernel-object-property",
 "K2": "kernel-type-field", "K5": "kernel-guard-return", "K6": "task-conflicts-existing-test"}
out = {"schema": "peaceai-stress-report:v1", "base": "5c41528", "node": "22", "tasks": []}
cnt = collections.Counter(); cat = collections.defaultdict(lambda: [0, 0])
for i, t in tasks.items():
    r = res[i]; o = r["outcome"]; cnt[o] += 1
    ok = o in ("SOLVED", "CORRECT_REFUSAL"); cat[t["category"]][0] += ok; cat[t["category"]][1] += 1
    out["tasks"].append({"id": i, "category": t["category"], "skill": t["skill"], "expect": t["expect"], "outcome": o,
        "candidates": len(r["candidates"]), "accepted": sum(1 for c in r["candidates"] if c.get("accepted")), "refusals": r["refusals"],
        "nl": r["nl"], "gap": GAP.get(i)})
n = len(tasks); solve = sum(1 for t in tasks.values() if t["expect"] == "solve")
out["score"] = {"tasks": n, "pass": cnt["SOLVED"] + cnt["CORRECT_REFUSAL"], "pass_pct": round(100 * (cnt["SOLVED"] + cnt["CORRECT_REFUSAL"]) / n, 1),
    "solved": cnt["SOLVED"], "in_scope": solve, "solve_pct": round(100 * cnt["SOLVED"] / solve, 1), "correct_refusals": cnt["CORRECT_REFUSAL"],
    "refuse_expected": n - solve, "wrong_or_unsafe": cnt["WRONG"], "false_refusals": cnt["FALSE_REFUSAL"], "crashes": cnt["CRASH"]}
out["per_category"] = {k: {"pass": v[0], "total": v[1]} for k, v in sorted(cat.items())}
json.dump(out, open(os.path.join(H, "report.json"), "w"), indent=1)
s = out["score"]
print(f"| overall | {s['pass']}/{s['tasks']} = {s['pass_pct']}% |\n| correct solves | {s['solved']}/{s['in_scope']} in-scope = {s['solve_pct']}% |\n| correct refusals | {s['correct_refusals']}/{s['refuse_expected']} |\n| wrong/unsafe (critical) | {s['wrong_or_unsafe']} |\n| false refusals | {s['false_refusals']} |\n| crashes | {s['crashes']} |")
print("\n| category | pass |\n|---|---:|")
for k, v in out["per_category"].items(): print(f"| {k} | {v['pass']}/{v['total']} |")
print("\n| task | expect | outcome | gap / reason |\n|---|---|---|---|")
for t in out["tasks"]: print(f"| {t['id']} | {t['expect']} | {t['outcome']} | {t['gap'] or ''} |")
