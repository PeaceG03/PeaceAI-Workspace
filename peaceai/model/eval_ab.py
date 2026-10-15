"""M49: held-out task success on sets A and B (protocol of M31/M44, fixed, no per-example tuning).
For every set A/B commit the model rewrites each function body the commit changed; pass = the commit's own tests (or
the module's sibling test) pass. Attempt 1 greedy, attempts 2-5 sampled T=0.8 seed=20261014; prompt = the tokens before
the body's '{' (last ctx/2). Every task is reported: pass / fail / ungradable (no-test, no-changed-body, real-fails);
the denominator is always every set A/B task. Prints aggregate counts only.

Usage: eval_ab.py --model DIR --clones DIR --node NODE --tsc TYPESCRIPT_DIR [--attempts 5]
--clones holds <name>/ for PeaceAI-Workspace and PeaceSTOCKS with node_modules installed (--ignore-scripts)."""
import argparse, json, os, shutil, subprocess, sys
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lm  # noqa: E402
ap = argparse.ArgumentParser()
for a in ("--model", "--clones", "--node", "--tsc"): ap.add_argument(a, required=True)
ap.add_argument("--attempts", type=int, default=5)
args = ap.parse_args()
HERE = os.path.dirname(os.path.abspath(__file__))
cfg = json.load(open(f"{args.model}/config.json")); tok = lm.Tokenizer(json.load(open(f"{args.model}/tokenizer.json"))); P = lm.load_weights(f"{args.model}/weights.npz")
H = json.load(open(f"{HERE}/heldout.json")); rng = np.random.Generator(np.random.PCG64(20261014))
istest = lambda p: p.endswith(".test.ts") or "/test/" in p or p.startswith("test/")
def sh(cwd, *a, t=300):
    try: r = subprocess.run(a, cwd=cwd, capture_output=True, text=True, timeout=t); return r.returncode, r.stdout + r.stderr
    except subprocess.TimeoutExpired: return 124, ""
def spans(f): return json.loads(subprocess.run([args.node, f"{HERE}/spans.cjs", f], capture_output=True, text=True, env={**os.environ, "TSPATH": args.tsc}).stdout or "[]")
def body(gen):
    d = 1
    for i, c in enumerate(gen):
        d += c == "{"; d -= c == "}"
        if d == 0: return gen[:i]
    return None
tot = {}; tmp = os.environ.get("RUNNER_TEMP", "/tmp")
for S in ("A", "B"):
    c = tot.setdefault(S, {"tasks": 0, "pass": 0, "fail": 0, "ungradable": 0})
    for e in H["sets"][S]:
        c["tasks"] += 1
        src = f"{args.clones}/{e['repo'].split('/')[1]}"; wt = f"{tmp}/ab-wt"
        sh(src, "git", "worktree", "remove", "--force", wt); shutil.rmtree(wt, ignore_errors=True); sh(src, "git", "worktree", "prune")
        if sh(src, "git", "worktree", "add", "-f", "--detach", wt, e["sha"])[0]: c["ungradable"] += 1; continue
        os.symlink(f"{src}/node_modules", f"{wt}/node_modules")
        paths = [p for p in e["paths"] if p.endswith(".ts")]; srcs = [p for p in paths if not istest(p)]; tests = [p for p in paths if istest(p)]
        if not tests: tests = [p[:-3] + ".test.ts" for p in srcs if os.path.exists(f"{wt}/{p[:-3]}.test.ts")]
        holes = []
        for p in srcs:
            rc, parent = sh(wt, "git", "show", f"{e['sha']}^:{p}"); open(f"{tmp}/ab-parent.ts", "w").write(parent if rc == 0 else "")
            old = {s["name"]: s["text"] for s in spans(f"{tmp}/ab-parent.ts")}
            holes += [(p, s) for s in spans(f"{wt}/{p}") if old.get(s["name"]) != s["text"]]
        if not tests or not holes or sh(wt, args.node, "node_modules/.bin/tsx", "--test", *tests)[0] != 0: c["ungradable"] += 1; continue
        orig = {p: open(f"{wt}/{p}").read() for p in srcs}; ok = False
        for a in range(args.attempts):
            files = dict(orig); parsed = True
            for p, s in sorted(holes, key=lambda h: -h[1]["open"]):
                ids = [lm.EOD] + tok.encode(orig[p][:s["open"]])
                b = body(tok.decode(lm.generate(P, cfg, ids[-(cfg["ctx"] // 2):], cfg["ctx"] // 2, rng, 0.0 if a == 0 else 0.8)))
                if b is None: parsed = False; break
                files[p] = files[p][:s["open"]] + b + files[p][s["end"]:]
            if not parsed: continue
            for p in srcs: open(f"{wt}/{p}", "w").write(files[p])
            rc = sh(wt, args.node, "node_modules/.bin/tsx", "--test", *tests)[0]
            for p in srcs: open(f"{wt}/{p}", "w").write(orig[p])
            if rc == 0: ok = True; break
        c["pass" if ok else "fail"] += 1
    assert c["pass"] + c["fail"] + c["ungradable"] == c["tasks"] == len(H["sets"][S])
    print(json.dumps({"set": S, **c}), flush=True)
