"""M49: held-out task success on sets A and B (protocol of M31/M44, fixed, no per-example tuning).
For every set A/B commit the model rewrites each function body the commit changed; pass = the commit's own tests (or
the module's sibling test) pass. Attempt 1 greedy, attempts 2-5 sampled T=0.8 seed=20261014; prompt = the tokens before
the body's '{' (last ctx/2). Every task is reported: pass / fail / ungradable (no-test, no-changed-body, real-fails);
the denominator is always every set A/B task. Prints aggregate counts only.

Two phases, so model-generated code never runs where a secret exists (Auditor #178 H1):
  --gen OUT   (landing job, after the model has landed) loads the model, finds the changed bodies by parsing only, and
              writes every attempt's bodies to OUT. Runs no repo code and no generated code.
  --run CANDS (separate eval job: no environment, no secrets, no model) installs nothing itself; runs each commit's
              tests once unchanged (baseline) and then with each attempt's bodies applied, in a throwaway worktree.
Usage: eval_ab.py --gen OUT --model DIR --clones DIR --node NODE --tsc TYPESCRIPT_DIR [--attempts 5]
       eval_ab.py --run CANDS --clones DIR --node NODE
--clones holds <name>/ for PeaceAI-Workspace and PeaceSTOCKS (for --run, with node_modules installed --ignore-scripts)."""
import argparse, json, os, shutil, subprocess, sys
HERE = os.path.dirname(os.path.abspath(__file__))
ap = argparse.ArgumentParser()
g = ap.add_mutually_exclusive_group(required=True); g.add_argument("--gen"); g.add_argument("--run")
for a in ("--model", "--tsc"): ap.add_argument(a)
for a in ("--clones", "--node"): ap.add_argument(a, required=True)
ap.add_argument("--attempts", type=int, default=5)
args = ap.parse_args()
H = json.load(open(f"{HERE}/heldout.json"))
istest = lambda p: p.endswith(".test.ts") or "/test/" in p or p.startswith("test/")
tmp = os.environ.get("RUNNER_TEMP", "/tmp")
def sh(cwd, *a, t=300):
    try: r = subprocess.run(a, cwd=cwd, capture_output=True, text=True, timeout=t); return r.returncode, r.stdout + r.stderr
    except subprocess.TimeoutExpired: return 124, ""
def worktree(e):
    src = f"{args.clones}/{e['repo'].split('/')[1]}"; wt = f"{tmp}/ab-wt"
    sh(src, "git", "worktree", "remove", "--force", wt); shutil.rmtree(wt, ignore_errors=True); sh(src, "git", "worktree", "prune")
    if sh(src, "git", "worktree", "add", "-f", "--detach", wt, e["sha"])[0]: return None, src
    return wt, src
def split(e, wt):
    paths = [p for p in e["paths"] if p.endswith(".ts")]; srcs = [p for p in paths if not istest(p)]; tests = [p for p in paths if istest(p)]
    if not tests: tests = [p[:-3] + ".test.ts" for p in srcs if os.path.exists(f"{wt}/{p[:-3]}.test.ts")]
    return srcs, tests

if args.gen:
    import numpy as np
    sys.path.insert(0, HERE)
    import lm  # noqa: E402
    if not args.model or not args.tsc: ap.error("--gen needs --model and --tsc")
    cfg = json.load(open(f"{args.model}/config.json")); tok = lm.Tokenizer(json.load(open(f"{args.model}/tokenizer.json"))); P = lm.load_weights(f"{args.model}/weights.npz")
    rng = np.random.Generator(np.random.PCG64(20261014))
    def spans(f): return json.loads(subprocess.run([args.node, f"{HERE}/spans.cjs", f], capture_output=True, text=True, env={**os.environ, "TSPATH": args.tsc}).stdout or "[]")
    def body(gen):
        d = 1
        for i, c in enumerate(gen):
            d += c == "{"; d -= c == "}"
            if d == 0: return gen[:i]
        return None
    n = 0
    with open(args.gen, "w") as o:
        for S in ("A", "B"):
            for e in H["sets"][S]:
                rec = {"set": S, "repo": e["repo"], "sha": e["sha"], "holes": [], "attempts": []}; n += 1
                wt, _ = worktree(e)
                if wt is None: rec["why"] = "checkout"; o.write(json.dumps(rec) + "\n"); continue
                srcs, tests = split(e, wt); holes = []
                for p in srcs:
                    rc, parent = sh(wt, "git", "show", f"{e['sha']}^:{p}"); open(f"{tmp}/ab-parent.ts", "w").write(parent if rc == 0 else "")
                    old = {s["name"]: s["text"] for s in spans(f"{tmp}/ab-parent.ts")}
                    holes += [(p, s) for s in spans(f"{wt}/{p}") if old.get(s["name"]) != s["text"]]
                holes.sort(key=lambda h: -h[1]["open"])
                rec["holes"] = [{"path": p, "open": s["open"], "end": s["end"]} for p, s in holes]
                if not tests or not holes: rec["why"] = "no-test" if not tests else "no-changed-body"; o.write(json.dumps(rec) + "\n"); continue
                orig = {p: open(f"{wt}/{p}").read() for p in srcs}
                for a in range(args.attempts):
                    bs = []
                    for p, s in holes:
                        ids = [lm.EOD] + tok.encode(orig[p][:s["open"]])
                        b = body(tok.decode(lm.generate(P, cfg, ids[-(cfg["ctx"] // 2):], cfg["ctx"] // 2, rng, 0.0 if a == 0 else 0.8)))
                        if b is None: bs = None; break
                        bs.append(b)
                    rec["attempts"].append(bs)
                o.write(json.dumps(rec) + "\n")
    assert n == sum(len(H["sets"][S]) for S in ("A", "B"))
    print(json.dumps({"candidates": n}), flush=True)
    sys.exit(0)

C = [json.loads(l) for l in open(args.run) if l.strip()]
want = [(S, e["repo"], e["sha"]) for S in ("A", "B") for e in H["sets"][S]]
if [(c["set"], c["repo"], c["sha"]) for c in C] != want: sys.exit("candidates do not match the set A/B list: refused")
tot = {}
for c, e in zip(C, [e for S in ("A", "B") for e in H["sets"][S]]):
    t = tot.setdefault(c["set"], {"tasks": 0, "pass": 0, "fail": 0, "ungradable": 0}); t["tasks"] += 1
    if c.get("why") or not c["holes"]: t["ungradable"] += 1; continue
    wt, src = worktree(e)
    if wt is None: t["ungradable"] += 1; continue
    os.symlink(f"{src}/node_modules", f"{wt}/node_modules")
    srcs, tests = split(e, wt)
    if not tests or sh(wt, args.node, "node_modules/.bin/tsx", "--test", *tests)[0] != 0: t["ungradable"] += 1; continue
    orig = {p: open(f"{wt}/{p}").read() for p in srcs}; ok = False
    for bs in c["attempts"][: args.attempts]:
        if bs is None or len(bs) != len(c["holes"]): continue
        files = dict(orig)
        for h, b in zip(c["holes"], bs):
            if h["path"] not in files: break
            files[h["path"]] = files[h["path"]][:h["open"]] + b + files[h["path"]][h["end"]:]
        else:
            for p in srcs: open(f"{wt}/{p}", "w").write(files[p])
            rc = sh(wt, args.node, "node_modules/.bin/tsx", "--test", *tests)[0]
            for p in srcs: open(f"{wt}/{p}", "w").write(orig[p])
            if rc == 0: ok = True; break
    t["pass" if ok else "fail"] += 1
for S in ("A", "B"):
    t = tot.get(S, {"tasks": 0, "pass": 0, "fail": 0, "ungradable": 0})
    assert t["pass"] + t["fail"] + t["ungradable"] == t["tasks"] == len(H["sets"][S])
    print(json.dumps({"set": S, **t}), flush=True)
