"""M160 limit-breaker daily cycle (the checks and the report; peaceai/bin/lb-daily-cycle.sh runs the steps).

  lb-daily-cycle.sh CORPUS STATE BUDGET_MIN [TODAY] [-- <train.py args>]
    1. daily_cycle.py plan    every check below, then prints ONE line: "plan fresh start=0",
                              "plan resume start=N save=save-NNNNNNNNN sha=<64 hex>" or "plan done ..." (a finished
                              chain: the "done" report is written and nothing is trained); a refusal prints one fixed
                              DAILY_* code and exits 3, and nothing is trained.
    2. train.py               --save-dir STATE/saves --marker STATE/chain.json --max-seconds and --deadline = the
                              budget, resuming from the plan's verified save, in a fresh STATE/work/<today>; stdout to
                              STATE/logs/<today>.log (step metrics only, no corpus text).
    3. export.py              best.npz (or checkpoint.npz) -> held-out cross-entropy and bits per byte vs unigram.
    4. daily_cycle.py report  STATE/reports/<today>.json (never overwritten), one quiet line.

Free compute only: local processes on this box, or a GitHub-hosted runner when a human dispatches it (any other
runner is refused). No network, no upload, no cloud storage; it writes only under STATE. It is not scheduled anywhere; the drafted
workflow in peaceai/spec/lb-train-v1.md is NOT installed and needs Auditor and Peace before it is.

plan checks (fail-closed):
  corpus  docs.jsonl sha256, manifest.jsonl sha256 and fingerprint.json's lb-clean fingerprint must be ONE entry of
          lb-train.json clearedCorpora (Auditor-cleared for exactly those pins), else DAILY_CORPUS_NOT_CLEARED.
  args    whole minutes 1..daily.maxBudgetMin; TODAY is YYYY-MM-DD (default: the UTC date); train.py args only
          "--flag value" pairs from daily.trainArgsAllowed (the cycle owns corpus, work, saves, marker, resume, budget).
  once    one cycle per TODAY (a report or work dir for it already exists: refused).
  resume  STATE/chain.json (the previous train.py --marker) names a save that must be the newest in STATE/saves;
          train.py verifies its manifest sha256 before loading (never a fresh start over existing saves; saves with no
          chain.json, or a chain.json that is not a marker, are refused as DAILY_STATE_INCONSISTENT).
"""
import argparse
import hashlib
import json
import os
import re
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import saves  # noqa: E402

REPORT_SCHEMA = "peaceai-lb-daily:v1"
OWNED = ("--corpus", "--work", "--save-dir", "--marker", "--resume-from", "--resume-manifest-sha", "--max-seconds", "--deadline",
         "--job-start", "--replay-corpus", "--init-from")
DATE_RE = re.compile(r"^20[0-9]{2}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$")
CODE_RE = re.compile(r"^[A-Z][A-Z0-9_:]{2,80}$")


class DailyError(Exception):
    def __init__(self, code):
        super().__init__(code)
        self.code = code


def load_config(path=os.path.join(HERE, "lb-train.json")):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def sha256_file(p):
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for b in iter(lambda: f.read(1 << 20), b""):
            h.update(b)
    return h.hexdigest()


def corpus_pins(corpus):
    try:
        fp = json.load(open(os.path.join(corpus, "fingerprint.json"), encoding="utf-8")).get("fingerprint")
        return {"docs": sha256_file(os.path.join(corpus, "docs.jsonl")), "manifest": sha256_file(os.path.join(corpus, "manifest.jsonl")), "fingerprint": fp}
    except (OSError, ValueError, AttributeError):
        raise DailyError("DAILY_CORPUS_NOT_CLEARED")


def check_corpus(corpus, cleared):
    pins = corpus_pins(corpus)
    ok = any(isinstance(c, dict) and all(c.get(k) == pins[k] for k in ("docs", "manifest", "fingerprint")) for c in cleared)
    if not ok:  # guard:daily-corpus-cleared
        raise DailyError("DAILY_CORPUS_NOT_CLEARED")
    return pins


def check_runner(env):
    """Free compute only: on GitHub Actions only a GitHub-hosted runner (a self-hosted or other runner refuses)."""
    if env.get("GITHUB_ACTIONS") == "true" and env.get("RUNNER_ENVIRONMENT") != "github-hosted":  # guard:daily-free-runner
        raise DailyError("DAILY_NOT_FREE_RUNNER")


def check_args(budget, today, train_args, daily):
    if not re.match(r"^[1-9][0-9]{0,3}$", str(budget)) or int(budget) > daily["maxBudgetMin"]:  # guard:daily-budget
        raise DailyError("DAILY_BAD_ARGS")
    if not DATE_RE.match(str(today)):  # guard:daily-date
        raise DailyError("DAILY_BAD_ARGS")
    allowed = set(daily["trainArgsAllowed"])
    for i in range(0, len(train_args), 2):
        if train_args[i] not in allowed or train_args[i] in OWNED or i + 1 >= len(train_args) or train_args[i + 1].startswith("--"):  # guard:daily-train-args
            raise DailyError("DAILY_BAD_ARGS")


def resume_plan(state):
    """("fresh", 0, None) | ("resume", step, marker) | ("done", step, marker). Fail-closed on anything else."""
    names = saves.list_saves(os.path.join(state, "saves"))
    cp = os.path.join(state, "chain.json")
    if not os.path.exists(cp):
        if names:  # guard:daily-saves-without-chain
            raise DailyError("DAILY_STATE_INCONSISTENT")
        return "fresh", 0, None
    try:
        m = json.load(open(cp, encoding="utf-8"))
    except (OSError, ValueError):
        raise DailyError("DAILY_STATE_INCONSISTENT")
    if not isinstance(m, dict) or m.get("schema") != saves.MARKER_SCHEMA or not isinstance(m.get("step"), int):  # guard:daily-chain-schema
        raise DailyError("DAILY_STATE_INCONSISTENT")
    if m.get("more") is not True:
        return "done", m["step"], m
    if not names or m.get("save") != names[-1] or not saves.SHA_RE.match(str(m.get("manifestSha256"))):  # guard:daily-latest-save
        raise DailyError("DAILY_STATE_INCONSISTENT")
    return "resume", m["step"], m


def write_report(path, rec):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    body = json.dumps(rec, sort_keys=True, indent=2) + "\n"
    with open(path, "x", encoding="ascii") as f:  # one report per day; never overwritten
        f.write(body)


def _json(p):
    try:
        return json.load(open(p, encoding="utf-8"))
    except (OSError, ValueError):
        return None


def plan(corpus, state, budget, today, train_args, cfg, env):
    check_runner(env)
    check_args(budget, today, train_args, cfg["daily"])
    pins = check_corpus(corpus, cfg["clearedCorpora"])
    rpath = os.path.join(state, "reports", f"{today}.json")
    work = os.path.join(state, "work", today)
    if os.path.exists(rpath) or os.path.exists(work):  # guard:daily-once
        raise DailyError("DAILY_ALREADY_RAN")
    kind, step, m = resume_plan(state)
    if kind == "done":
        write_report(rpath, {"schema": REPORT_SCHEMA, "today": today, "budgetMin": int(budget), "corpus": pins, "status": "done", "startStep": step,
                             "endStep": step, "stopReason": m.get("stopReason"), "save": m.get("save"), "manifestSha256": m.get("manifestSha256")})
        return f"plan done step={step} stop={m.get('stopReason')}"
    os.makedirs(work)
    os.makedirs(os.path.join(state, "logs"), exist_ok=True)
    if kind == "fresh":
        return "plan fresh start=0"
    return f"plan resume start={step} save={m['save']} sha={m['manifestSha256']}"


def report(corpus, state, budget, today, start_step, train_rc, cfg):
    pins = corpus_pins(corpus)
    work = os.path.join(state, "work", today)
    base = {"schema": REPORT_SCHEMA, "today": today, "budgetMin": int(budget), "corpus": pins, "startStep": int(start_step)}
    if str(train_rc) != "0":
        lines = (open(os.path.join(state, "logs", f"{today}.err"), encoding="utf-8", errors="replace").read().strip().split("\n")
                 if os.path.exists(os.path.join(state, "logs", f"{today}.err")) else [""])
        code = lines[-1] if CODE_RE.match(lines[-1]) else "DAILY_TRAIN_FAILED"
        rec = dict(base, status="train_failed", code=code)
        write_report(os.path.join(state, "reports", f"{today}.json"), rec)
        return rec
    stop, best, run, ev = (_json(os.path.join(work, n)) for n in ("stop.json", "best.json", "run.json", "model/eval.json"))
    mk = _json(os.path.join(state, "chain.json")) or {}
    stop, best, run = stop or {}, best or {}, run or {}
    rec = dict(base, status="trained", endStep=stop.get("step"), stopReason=stop.get("reason"), more=mk.get("more"), bestVal=best.get("val"),
               bestStep=best.get("step"), lastVal=stop.get("lastVal"), eval=ev, evalOk=ev is not None, save=mk.get("save"),
               manifestSha256=mk.get("manifestSha256"), cfgSha256=run.get("cfgSha256"), precision=run.get("precision"),
               optimizer=run.get("optimizer"), curriculum=run.get("curriculum"), stopRule=run.get("stop"))
    write_report(os.path.join(state, "reports", f"{today}.json"), rec)
    return rec


def main(argv, cfg=None, env=None):
    train_args = []
    if "--" in argv:
        i = argv.index("--")
        argv, train_args = argv[:i], argv[i + 1:]
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=("plan", "report"))
    ap.add_argument("--corpus", required=True)
    ap.add_argument("--state", required=True)
    ap.add_argument("--budget-min", required=True)
    ap.add_argument("--today", default=time.strftime("%Y-%m-%d", time.gmtime()))
    ap.add_argument("--start-step", default="0")
    ap.add_argument("--train-rc", default="0")
    a = ap.parse_args(argv)
    cfg = cfg or load_config()
    try:
        if a.cmd == "plan":
            print(plan(a.corpus, a.state, a.budget_min, a.today, train_args, cfg, dict(os.environ) if env is None else env))
            return 0
        rec = report(a.corpus, a.state, a.budget_min, a.today, a.start_step, a.train_rc, cfg)
    except DailyError as e:
        print(e.code)
        return 3
    print(f"daily {rec['today']} status={rec['status']} start={rec['startStep']} end={rec.get('endStep')} stop={rec.get('stopReason')} best_val={rec.get('bestVal')}"
          + (f" code={rec['code']}" if rec.get("code") else ""))
    return 0 if rec["status"] == "trained" else 3


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
