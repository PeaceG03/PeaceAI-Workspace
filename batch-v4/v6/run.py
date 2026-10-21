#!/usr/bin/env python3
"""Run the stress suite through PeaceAI's own Job A (generate.ts) and Job B (test-candidates.ts) locally,
then grade every candidate PeaceAI accepts with independent checks. Usage: run.py [task ids...]
Env: WS (Workspace checkout), STOCKS (target clone Job A/B use), GRADE (separate clone for grading),
KERNEL (bundle built by peaceai/bin/build-kernel.sh), CORE, RUNS (output dir)."""
import json, os, re, subprocess, sys, time
E = os.environ
WS, STOCKS, GRADE = E.get("WS", "/workspace/v4-ws"), E.get("STOCKS", "/workspace/stress/stocks"), E.get("GRADE", "/workspace/stress/grade")
KERNEL, CORE, RUNS = E.get("KERNEL", "/workspace/stress/kernel.cjs"), E.get("CORE", "/workspace/stress/core"), E.get("RUNS", "/workspace/stress/runs")
HERE = os.path.dirname(os.path.abspath(__file__))
suite = json.load(open(os.path.join(HERE, "tasks.json")))
BASE = suite["base"]
suite["tasks"] = [{**t, "body": t["body"].replace("{DRY}", "A box dry-run is recorded with the batch.")} for t in suite["tasks"]]
TSX = os.path.join(WS, "node_modules/.bin/tsx")

def sh(cmd, cwd, env=None, timeout=900):
    p = subprocess.run(cmd, cwd=cwd, shell=isinstance(cmd, str), capture_output=True, text=True, env={**E, **(env or {})}, timeout=timeout)
    return p.returncode, p.stdout + p.stderr

def reset():
    sh(["git", "reset", "-q", "--hard", BASE], GRADE); sh(["git", "clean", "-fdq", "-e", "node_modules"], GRADE)
    sh("rm -rf stress-accept", GRADE)

def tap(out):
    m = lambda k: (re.search(rf"^# {k} (\d+)", out, re.M) or [None, "?"])[1]
    return f"{m('pass')}/{m('tests')}"

def mutate_check(task, new_tests):
    f, fn = task["accept"]["mutate"]["file"], task["accept"]["mutate"]["fn"]
    path = os.path.join(GRADE, f); src = open(path).read()
    m = re.search(rf"export function {re.escape(fn)}\s*\(", src)
    if not m: return False, "fn-not-found"
    depth, j = 0, m.end() - 1
    while True:
        c = src[j]; depth += c == "("; depth -= c == ")"; j += 1
        if depth == 0: break
    i = src.index("{", j)
    open(path, "w").write(src[: i + 1] + " return undefined as any;" + src[i + 1 :])
    rc, out = sh([TSX, "--test", *new_tests], GRADE, timeout=300)
    open(path, "w").write(src)
    return rc != 0, f"stubbed-run rc={rc} {tap(out)}"

def grade(task, diff_path):
    reset(); g = {}
    rc, out = sh(["git", "apply", "--whitespace=nowarn", diff_path], GRADE)
    g["applies"] = rc == 0
    if not g["applies"]: return g
    new_files = [l[6:] for l in open(diff_path).read().splitlines() if l.startswith("+++ b/")]
    g["files"] = new_files
    tc = {}
    for s in ["typecheck"]:
        tc[s] = sh(["npm", "run", "-s", s], GRADE, timeout=600)[0] == 0
    g["typecheck"] = all(tc.values()); g["typecheck_detail"] = tc
    rc, out = sh("npx tsx --test src/*.test.ts $(find peaceai/self-tests -name '*.test.ts' | sort)", GRADE, timeout=900)
    g["suite"] = rc == 0; g["suite_counts"] = tap(out)
    acc = task["accept"]; ok = True; notes = []
    if "ts" in acc:
        os.makedirs(os.path.join(GRADE, "stress-accept"), exist_ok=True)
        p = os.path.join(GRADE, "stress-accept", f"{task['id']}.test.ts"); open(p, "w").write(acc["ts"])
        rc, out = sh([TSX, "--test", p], GRADE, timeout=300); ok &= rc == 0; notes.append(f"accept {tap(out)}")
    if "cmd" in acc:
        rc, out = sh(acc["cmd"], GRADE, timeout=600); ok &= rc == 0; notes.append(f"cmd rc={rc}")
    if "mutate" in acc:
        tests = [f for f in new_files if f.endswith(".test.ts")]
        rc, out = sh([TSX, "--test", *tests], GRADE, timeout=300) if tests else (1, "")
        passes = bool(tests) and rc == 0
        kills, why = mutate_check(task, tests) if passes else (False, "no passing new test")
        mentions = any(acc["mutate"]["fn"] in open(os.path.join(GRADE, t)).read() for t in tests)
        ok &= passes and kills and mentions and len(new_files) == 1; notes.append(f"newtest passes={passes} kills_stub={kills} ({why})")
    if not acc: ok = False; notes.append("no acceptance: candidate was not expected")
    g["acceptance"] = bool(ok); g["acceptance_notes"] = notes
    g["pass"] = g["applies"] and g["typecheck"] and g["suite"] and g["acceptance"]
    reset(); return g

def run(task):
    d = os.path.join(RUNS, task["id"]); sh(f"rm -rf {d}", "/"); os.makedirs(os.path.join(d, "results"))
    json.dump({"number": f"stress-{task['id']}", "title": task["title"], "body": task["body"]}, open(os.path.join(d, "issue.json"), "w"))
    t0 = time.time(); r = {"id": task["id"]}
    rc, out = sh([TSX, "peaceai/bin/generate.ts"], WS, {"PEACEAI_KERNEL_BUNDLE": KERNEL, "PEACEAI_OUT_DIR": os.path.join(d, "out"), "PEACEAI_WORKSPACE_DIR": STOCKS,
        "PEACEAI_TARGET": suite["target"], "PEACEAI_CORE_DIR": CORE, "ISSUE_JSON": os.path.join(d, "issue.json"), "GITHUB_OUTPUT": os.path.join(d, "gh-output.txt")}, timeout=600)
    open(os.path.join(d, "jobA.log"), "w").write(out)
    r["jobA_rc"] = rc
    mm = re.search(r"^nl=(\S+)(?: reason=(\S+))?", out, re.M); r["nl"] = list(mm.groups()) if mm else None
    r["refusals"] = (re.search(r"^learned refusals: (.*)$", out, re.M) or [None, ""])[1]
    summ = json.load(open(os.path.join(d, "out", "summary.json"))) if os.path.exists(os.path.join(d, "out", "summary.json")) else {"candidates": []}
    r["candidates"] = [{"id": c["id"], "op": c.get("operationId") or ",".join(c.get("transformations", [])), "files": None} for c in summ["candidates"]]
    if rc != 0: r["crash"] = "jobA"; r["crash_tail"] = out.strip().splitlines()[-1][:200] if out.strip() else ""
    if summ["candidates"]:
        rc2, out2 = sh([TSX, "peaceai/bin/test-candidates.ts"], WS, {"PEACEAI_IN_DIR": os.path.join(d, "out"), "PEACEAI_RESULTS_FILE": os.path.join(d, "results", "results.json"),
            "PEACEAI_WORKSPACE_DIR": STOCKS, "PEACEAI_TARGET": suite["target"]}, timeout=1800)
        open(os.path.join(d, "jobB.log"), "w").write(out2)
        if rc2 != 0: r["crash"] = "jobB"; r["crash_tail"] = out2.strip().splitlines()[-1][:200]
        res = json.load(open(os.path.join(d, "results", "results.json")))["results"] if rc2 == 0 else []
        for c in r["candidates"]:
            x = next((y for y in res if y["id"] == c["id"]), None)
            if not x: c["jobB"] = "missing"; continue
            tg = x.get("testGrading")
            c["jobB"] = {k: x[k] for k in ("applied", "typecheckPassed", "originalSuitePassed", "newTestsPassed")} | ({"grading": tg["verdict"]} if tg else {})
            c["accepted"] = all(x[k] for k in ("applied", "typecheckPassed", "originalSuitePassed", "newTestsPassed")) and (not tg or tg["verdict"] == "COUNTS")
            if c["accepted"]: c["grade"] = grade(task, os.path.join(d, "out", "candidates", f"{c['id']}.diff"))
    acc = [c for c in r["candidates"] if c.get("accepted")]
    if task["expect"] == "solve":
        if acc and all(c["grade"]["pass"] for c in acc): r["outcome"] = "SOLVED"
        elif acc and any(c["grade"]["pass"] for c in acc): r["outcome"] = "WRONG"; r["why"] = "one accepted candidate passes, another accepted candidate fails grading"
        elif acc: r["outcome"] = "WRONG"
        else: r["outcome"] = "FALSE_REFUSAL"
    else:
        r["outcome"] = "CORRECT_REFUSAL" if not acc else "WRONG"
    if r.get("crash"): r["outcome"] = "CRASH" if not acc else r["outcome"]
    r["seconds"] = round(time.time() - t0, 1)
    json.dump(r, open(os.path.join(d, "result.json"), "w"), indent=1)
    return r

ids = sys.argv[1:]
for t in suite["tasks"]:
    if ids and t["id"] not in ids: continue
    r = run(t)
    print(t["id"], r["outcome"], "nl=" + str(r["nl"]), "cands=" + str(len(r["candidates"])), "accepted=" + str(sum(1 for c in r["candidates"] if c.get("accepted"))),
          ("refusals=" + r["refusals"][:160]) if r["refusals"] else "", r.get("crash", ""), f"{r['seconds']}s", flush=True)
