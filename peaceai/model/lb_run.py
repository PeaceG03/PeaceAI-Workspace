"""lb-train v1 first real run (Auditor ruling after #654): the guards the peace-lm-train.yml lb-first-run job runs.
Usage: lb_run.py ref --ref REF
       lb_run.py pins --corpus DIR
       lb_run.py train-argv --corpus DIR --work DIR --job-start EPOCH [--now EPOCH]
       lb_run.py row --corpus DIR --work DIR --eval FILE --checkpoint FILE --run-id ID --sha SHA --job-start EPOCH --out FILE [--now EPOCH]
       lb_run.py land --row FILE --run-id ID          (under results-write.sh: writes $RESULTS_DIR/runs/lb-train/<ID>.json)
Settings come from lb-train.json firstRun only (no CLI override). A refusal prints one fixed code and exits 3; output is
codes, pins, shas and metrics only. The row has exactly the allowed fields (pins, workflow sha, run id, steps, stop reason,
held-out bpb, unigram baseline bpb on the same held-out windows, wall seconds, checkpoint sha256, and (batch 6) the
inputs the bpb is computed from: the unrounded model cross-entropy, the held-out token count and the held-out byte
count, so heldoutBpb = modelCe * heldoutTokens / ln 2 / heldBytes can be recomputed): no weights, no bytes."""
import argparse
import hashlib
import json
import math
import os
import re
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
PIN_KEYS = ("docs", "manifest", "fingerprint")
ROW_FIELDS = ("pins", "workflowSha", "runId", "steps", "stopReason", "heldoutBpb", "baselineBpb", "wallSeconds", "checkpointSha256",
              "modelCe", "heldoutTokens", "heldBytes")
STOP_REASONS = ("patience", "steps", "max_seconds", "deadline", "nonfinite")
FORBIDDEN = re.compile(r"^--(lora|replay|init-from|resume|save-dir|marker|keep-checkpoints)")
OWNED = ("--corpus", "--work", "--max-seconds", "--deadline", "--job-start")
HEX64 = re.compile(r"^[0-9a-f]{64}$")


class RunError(Exception):
    def __init__(self, code):
        super().__init__(code)
        self.code = code


def load_cfg():
    with open(os.path.join(HERE, "lb-train.json"), encoding="utf-8") as f:
        return json.load(f)


def sha256_file(p):
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for b in iter(lambda: f.read(1 << 20), b""):
            h.update(b)
    return h.hexdigest()


def check_ref(ref):
    if ref != "refs/heads/main":  # guard:run-ref
        raise RunError("LB_RUN_REF_NOT_MAIN")


def check_pins(corpus, cfg):
    """All three pins must equal firstRun.corpus exactly, and that corpus must be one Auditor cleared."""
    try:
        with open(os.path.join(corpus, "fingerprint.json"), encoding="utf-8") as f:
            fp = json.load(f).get("fingerprint")
        pins = {"docs": sha256_file(os.path.join(corpus, "docs.jsonl")), "manifest": sha256_file(os.path.join(corpus, "manifest.jsonl")), "fingerprint": fp}
    except (OSError, ValueError, AttributeError):
        raise RunError("LB_RUN_PIN_MISMATCH")
    want = cfg["firstRun"]["corpus"]
    if any(pins[k] != want.get(k) for k in PIN_KEYS):  # guard:run-pins
        raise RunError("LB_RUN_PIN_MISMATCH")
    if not any(isinstance(c, dict) and all(c.get(k) == pins[k] for k in PIN_KEYS) for c in cfg["clearedCorpora"]):  # guard:run-pins-cleared
        raise RunError("LB_RUN_NOT_CLEARED")
    return pins


def train_argv(corpus, work, job_start, now, cfg):
    """train.py argv from firstRun.train plus the owned paths and the time limits; refuses LoRA, replay, init/resume
    and saves, any flag the daily cycle does not allow, a missing adamw8bit / easy_to_hard / patience, a val split other
    than disjoint (batch 6: early-stop windows share no token with export's eval windows), and a deadline
    that does not leave firstRun.reserveMin inside the job cap."""
    fr = cfg["firstRun"]
    t = fr["train"]
    if any(FORBIDDEN.match(k) for k in t):  # guard:run-setting-forbidden
        raise RunError("LB_RUN_FORBIDDEN_SETTING")
    if any(k not in cfg["daily"]["trainArgsAllowed"] or k in OWNED for k in t):  # guard:run-setting-allowed
        raise RunError("LB_RUN_SETTING_NOT_ALLOWED")
    if any(not isinstance(v, str) or not re.match(r"^[A-Za-z0-9._]+$", v) for v in t.values()):  # guard:run-setting-values
        raise RunError("LB_RUN_SETTING_NOT_ALLOWED")
    if t.get("--optimizer") != "adamw8bit" or t.get("--curriculum") != "easy_to_hard":  # guard:run-setting-required
        raise RunError("LB_RUN_SETTING_REQUIRED")
    if t.get("--val-split") != "disjoint":  # guard:run-val-split
        raise RunError("LB_RUN_SETTING_REQUIRED")
    if not re.match(r"^[1-9][0-9]?$", t.get("--patience", "")):  # guard:run-patience
        raise RunError("LB_RUN_SETTING_REQUIRED")
    td, rv, jt = fr.get("trainDeadlineMin"), fr.get("reserveMin"), fr.get("jobTimeoutMin")
    if not all(type(x) is int for x in (td, rv, jt)) or td < 1 or rv < 20 or td + rv > jt or jt > 330:  # guard:run-deadline-cap
        raise RunError("LB_RUN_BAD_DEADLINE")
    if not re.match(r"^[0-9]{10}$", str(job_start)) or int(job_start) > now + 60:  # guard:run-job-start
        raise RunError("LB_RUN_BAD_DEADLINE")
    deadline = int(job_start) + td * 60
    if deadline - now < 60:  # guard:run-deadline-passed
        raise RunError("LB_RUN_BAD_DEADLINE")
    argv = ["--corpus", corpus, "--work", work]
    for k in sorted(t):
        argv += [k, t[k]]
    return argv + ["--max-seconds", str(int(deadline - now)), "--deadline", str(deadline)]


def num_ok(x, lo):
    return type(x) in (int, float) and math.isfinite(x) and x >= lo


def check_row(row, cfg):
    if not isinstance(row, dict) or sorted(row) != sorted(ROW_FIELDS):  # guard:run-row-fields
        raise RunError("LB_RUN_ROW_FIELD")
    if not isinstance(row["pins"], dict) or sorted(row["pins"]) != sorted(PIN_KEYS):  # guard:run-row-pin-fields
        raise RunError("LB_RUN_ROW_FIELD")
    if any(row["pins"][k] != cfg["firstRun"]["corpus"].get(k) for k in PIN_KEYS):  # guard:run-row-pins
        raise RunError("LB_RUN_PIN_MISMATCH")
    ok = (isinstance(row["workflowSha"], str) and re.match(r"^[0-9a-f]{40}$", row["workflowSha"])
          and isinstance(row["runId"], str) and re.match(r"^[1-9][0-9]{0,19}$", row["runId"])
          and type(row["steps"]) is int and row["steps"] >= 0 and row["stopReason"] in STOP_REASONS
          and num_ok(row["heldoutBpb"], 0) and num_ok(row["baselineBpb"], 0) and row["heldoutBpb"] > 0 and row["baselineBpb"] > 0
          and type(row["wallSeconds"]) is int and row["wallSeconds"] >= 0
          and isinstance(row["checkpointSha256"], str) and HEX64.match(row["checkpointSha256"])
          and num_ok(row["modelCe"], 0) and row["modelCe"] > 0
          and type(row["heldoutTokens"]) is int and row["heldoutTokens"] >= 1 and type(row["heldBytes"]) is int and row["heldBytes"] >= 1)
    if not ok:  # guard:run-row-values
        raise RunError("LB_RUN_ROW_VALUE")
    if not bpb_matches(row):  # guard:run-row-bpb
        raise RunError("LB_RUN_ROW_VALUE")
    return row


def bpb_matches(row):
    """heldoutBpb is export.py's round(model_ce * tokens / ln 2 / bytes, 4): the recompute from the logged inputs must
    agree to the rounding (5e-5; 1e-4 allows for numpy's round)."""
    return abs(row["modelCe"] * row["heldoutTokens"] / math.log(2) / row["heldBytes"] - row["heldoutBpb"]) <= 1e-4


def verdict(row):
    """A gain is claimed only when the held-out bpb is strictly below the unigram baseline on the same windows."""
    v = "beats_baseline"
    if not row["heldoutBpb"] < row["baselineBpb"]:  # guard:run-gain
        v = "no_gain"
    return v


def build_row(a, cfg, now):
    pins = check_pins(a.corpus, cfg)
    try:
        with open(os.path.join(a.work, "stop.json"), encoding="utf-8") as f:
            stop = json.load(f)
        with open(a.eval, encoding="utf-8") as f:
            ev = json.load(f)
        ck = sha256_file(a.checkpoint)
    except (OSError, ValueError):
        raise RunError("LB_RUN_TRAIN_ERROR")
    if not isinstance(stop, dict) or stop.get("reason") not in STOP_REASONS:  # guard:run-stop
        raise RunError("LB_RUN_TRAIN_ERROR")
    if not isinstance(ev, dict) or type(ev.get("heldout_windows")) is not int or ev["heldout_windows"] < 1:  # guard:run-eval-windows
        raise RunError("LB_RUN_TRAIN_ERROR")
    if not re.match(r"^[0-9]{10}$", str(a.job_start)):
        raise RunError("LB_RUN_BAD_DEADLINE")
    row = {"pins": pins, "workflowSha": a.sha, "runId": a.run_id, "steps": stop.get("step"), "stopReason": stop["reason"],
           "heldoutBpb": ev.get("model_bits_per_byte"), "baselineBpb": ev.get("unigram_bits_per_byte"),
           "wallSeconds": int(now) - int(a.job_start), "checkpointSha256": ck,
           "modelCe": ev.get("model_ce"), "heldoutTokens": ev.get("heldout_tokens"), "heldBytes": ev.get("held_bytes")}
    return check_row(row, cfg)


def land(a, cfg):
    try:
        with open(a.row, encoding="utf-8") as f:
            row = json.load(f)
    except (OSError, ValueError):
        raise RunError("LB_RUN_ROW_VALUE")
    check_row(row, cfg)
    if row["runId"] != a.run_id:  # guard:run-land-id
        raise RunError("LB_RUN_ROW_VALUE")
    res = os.environ.get("RESULTS_DIR", "")
    if not res or not os.path.isdir(res):
        raise RunError("LB_RUN_NO_RESULTS")
    d = os.path.join(res, "runs", "lb-train")
    if os.path.islink(os.path.join(res, "runs")) or os.path.islink(d):  # guard:run-land-symlink
        raise RunError("LB_RUN_LAND_SYMLINK")
    os.makedirs(d, exist_ok=True)
    rel = "runs/lb-train/" + a.run_id + ".json"
    try:
        with open(os.path.join(res, rel), "x", encoding="utf-8") as f:
            f.write(json.dumps(row, indent=1, sort_keys=True) + "\n")
    except FileExistsError:
        raise RunError("LB_RUN_ROW_EXISTS")
    return rel


def main(argv):
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=("ref", "pins", "train-argv", "row", "land"))
    for o in ("--ref", "--corpus", "--work", "--eval", "--checkpoint", "--run-id", "--sha", "--job-start", "--out", "--row"):
        ap.add_argument(o, default="")
    ap.add_argument("--now", type=int, default=0)
    a = ap.parse_args(argv)
    now = a.now or int(time.time())
    cfg = load_cfg()
    if a.cmd == "ref":
        check_ref(a.ref)
        print("ref ok")
    elif a.cmd == "pins":
        p = check_pins(a.corpus, cfg)
        print(f"pins ok docs={p['docs']} manifest={p['manifest']} fingerprint={p['fingerprint']}")
    elif a.cmd == "train-argv":
        print("\n".join(train_argv(a.corpus, a.work, a.job_start, now, cfg)))
    elif a.cmd == "row":
        row = build_row(a, cfg, now)
        try:
            with open(a.out, "x", encoding="utf-8") as f:
                f.write(json.dumps(row, sort_keys=True) + "\n")
        except OSError:
            raise RunError("LB_RUN_ROW_EXISTS")
        print(f"lb-run steps={row['steps']} stop={row['stopReason']} heldout_bpb={row['heldoutBpb']} baseline_bpb={row['baselineBpb']} "
              f"verdict={verdict(row)} wall_s={row['wallSeconds']} checkpoint={row['checkpointSha256']} "
              f"model_ce={row['modelCe']} heldout_tokens={row['heldoutTokens']} held_bytes={row['heldBytes']}")
    else:
        print("landed " + land(a, cfg))


if __name__ == "__main__":
    try:
        main(sys.argv[1:])
    except RunError as e:
        print(e.code)
        sys.exit(3)
