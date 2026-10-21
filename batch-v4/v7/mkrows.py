import json, datetime, zoneinfo, re
prs = {p['number']: p for p in json.load(open('/workspace/batch-v7/prs.json'))}
inc = [217,218,219,222,223,224,226,227,228,236,241,242,243,244,245,246,247,249,251,253,256,258,260,263,268,277,278,279,280,281,282,283,284,285,287,291,309,310,311,312,314,315,316,317,321,323,326,327,331,333,335,336,337,339,340,344,347,348,351,361,364,375,377,378,379,386,398]
WHY = {
 377: "Stress-v1 run showed parser misses (an HTML comment inside a quoted literal, 'is [..]' bullets, NaN/Infinity values) that dropped valid tasks before any rule ran",
 378: "Stress-v1 gaps 1/2/4/6/7: calls and callbacks, test-existing v2 target, replace-expression v2, template literals and Date expected values; rules stayed off until Peace's /approve-rule",
 379: "Accepted PeaceSTOCKS verdicts needed a reviewable landing route: the verdict job now opens a bot PR through the peacestocks-write environment that Peace approves; the bot never merges",
 386: "Once public-complex-calls-v1 was approved, its refusal reason had to show in the refusal line or Job A hid why it declined",
 398: "Batch-v5 landed through verdict PRs, so trace.ts needed the PR route (PR_REPLY, T_PR_MISMATCH, H_RESULTS_PR) to trace them; the PR also recorded seq 139-145",
}
GENERIC = "Builder change to PeaceAI's own tooling (protected paths; PEACEAI_SELF_CHANGE is never a PeaceAI edit by design); merged as PeaceAI-Workspace@{sha}"
tz = zoneinfo.ZoneInfo("America/Denver")
rows = []
for n in sorted(inc, key=lambda n: prs[n]['mergedAt']):
    p = prs[n]
    t = datetime.datetime.fromisoformat(p['mergedAt'].replace('Z', '+00:00')).astimezone(tz)
    sha = p['mergeCommit']['oid'][:7]
    title = re.sub(r"\s+", " ", p['title']).strip()
    asked = title if len(title) <= 400 else title[:397] + "..."
    why = WHY.get(n, GENERIC.format(sha=sha))
    if n in WHY: why = f"{why}; merged as PeaceAI-Workspace@{sha}"
    assert 8 <= len(why) <= 400 and 8 <= len(asked) <= 400, n
    rows.append({"date": t.strftime("%Y-%m-%d"), "time": t.strftime("%H:%M"), "asked": asked, "changed": f"PeaceAI-Workspace#{n}, PeaceAI-Workspace@{sha}", "why": why, "skill": "PEACEAI_SELF_CHANGE", "mark": "missing skill PEACEAI_SELF_CHANGE", "by": "Builder"})
log = 'builder-log/tasks.jsonl'
lines = open(log).read().splitlines()
seq = json.loads(lines[-1])['seq']
sep = ", " if '", "' in lines[-1] else ","
out = []
for r in rows:
    seq += 1
    out.append(json.dumps({"seq": seq, **r}, ensure_ascii=False, separators=(",", ":")))
open(log, 'a').write("\n".join(out) + "\n")
print(len(out), "rows, last seq", seq)
