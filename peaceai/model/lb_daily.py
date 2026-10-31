"""lb-train daily cycle on GitHub (Auditor ruling, R2 ready): the guards the peace-lb-daily.yml workflow runs around
peaceai/bin/lb-daily-cycle.sh. The cycle's saves live in their own R2 folder (dailyRun.r2Folder); the trusted record is
the add-only Results rows runs/lb-daily/<YYYY-MM-DD>-<run id>.json, never the bucket and never the restored state.
Usage: lb_daily.py ref --ref REF
       lb_daily.py config
       lb_daily.py trusted --out FILE --today D       (under results-write.sh, read only: $RESULTS_DIR runs/lb-daily/,
                                                       runs/lb-train/; writes FILE and kind/chain/save/sha/trusted_sha outputs)
       lb_daily.py restore --trusted FILE --trusted-sha SHA --state DIR
       lb_daily.py cycle-args --trusted FILE --trusted-sha SHA --job-start EPOCH [--now EPOCH]
       lb_daily.py row --trusted FILE --trusted-sha SHA --state DIR --today D --run-id ID --sha SHA --job-start EPOCH
                       --uploaded SAVE:SHA --out FILE [--now EPOCH]
       lb_daily.py land --row FILE --run-id ID --today D (under results-write.sh: $RESULTS_DIR/runs/lb-daily/<D>-<ID>.json)
Settings come from lb-train.json dailyRun only. A refusal prints one fixed code and exits 3; output is codes, pins, shas,
save names, steps and metrics only. LoRA is refused (LB_DAILY_LORA_LOCKED) until a full-model run row has the same-split
unigram baseline dailyRun.loraUnlock.baselineBpb and a held-out bpb below it; even then the daily cycle has no LoRA path
(LB_DAILY_LORA_NOT_WIRED) until an Auditor-reviewed change adds one."""
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
# v2 (batch 6) adds the inputs heldoutBpb is computed from (export.py eval.json model_ce, heldout_tokens, held_bytes), so
# heldoutBpb = modelCe * heldoutTokens / ln 2 / heldBytes can be recomputed. New rows are v2 only; v1 rows (landed before
# this change, e.g. the first daily run) are still read as part of the trusted record, never written or landed.
ROW_SCHEMA = "peaceai-lb-daily-run:v2"
LEGACY_SCHEMA = "peaceai-lb-daily-run:v1"
V1_FIELDS = ("schema", "runId", "workflowSha", "chainId", "today", "pins", "status", "startStep", "endStep", "stopReason",
             "heldoutBpb", "baselineBpb", "wallSeconds", "resumedFrom", "marker")
ROW_FIELDS = V1_FIELDS + ("modelCe", "heldoutTokens", "heldBytes")
# batch 7 (Auditor's #661 note): v1 is trusted history only. The last run that can have landed a v1 row is the first
# daily run, 41222155935 (dispatched on 08c2383, before v2 merged as ec36fc1); every later run writes v2. A v1 row with a
# larger run id cannot be genuine history, so the trusted-record read refuses it (LB_DAILY_RECORD_BAD).
V1_LAST_RUN_ID = 41222155935
MARKER_SCHEMA = "peaceai-lm-chain:v1"
MARKER_FIELDS = ("schema", "more", "stopReason", "step", "totalSteps", "save", "manifestSha256", "cfgSha256")
STOP_REASONS = ("patience", "steps", "max_seconds", "deadline", "max_steps_this_run", "nonfinite")
LORA = re.compile(r"^--(lora|init-from)")
FORBIDDEN = re.compile(r"^--(replay|resume|save-dir|marker|keep-checkpoints|corpus|work|max-seconds|deadline|job-start)")
HEX64 = re.compile(r"^[0-9a-f]{64}$")
SAVE_RE = re.compile(r"^save-[0-9]{9}$")
DATE_RE = re.compile(r"^20[0-9]{2}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$")
ID_RE = re.compile(r"^[1-9][0-9]{0,19}$")
NAME_RE = re.compile(r"^(20[0-9]{2}-[0-9]{2}-[0-9]{2})-([1-9][0-9]{0,19})\.json$")


class DailyRunError(Exception):
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


def canonical(o):
    return json.dumps(o, sort_keys=True, separators=(",", ":"))


def num_ok(x):
    return type(x) in (int, float) and math.isfinite(x) and x > 0


def check_ref(ref):
    if ref != "refs/heads/main":  # guard:dr-ref
        raise DailyRunError("LB_DAILY_REF_NOT_MAIN")


def full_model_beats(rows, base):
    """A full-model run (no LoRA) whose row has exactly the pinned same-split baseline and a held-out bpb below it."""
    return any(isinstance(r, dict) and r.get("baselineBpb") == base and num_ok(r.get("heldoutBpb")) and r["heldoutBpb"] < base
               and not r.get("lora") for r in rows)


def lora_gate(train, rows, cfg):
    if not any(LORA.match(k) for k in train):
        return
    base = cfg["dailyRun"]["loraUnlock"]["baselineBpb"]
    if not full_model_beats(rows, base):  # guard:dr-lora-locked
        raise DailyRunError("LB_DAILY_LORA_LOCKED")
    if True:  # guard:dr-lora-not-wired
        raise DailyRunError("LB_DAILY_LORA_NOT_WIRED")


def check_config(cfg, rows=()):
    dr = cfg["dailyRun"]
    t = dr["train"]
    lora_gate(t, list(rows), cfg)
    if any(FORBIDDEN.match(k) for k in t):  # guard:dr-setting-forbidden
        raise DailyRunError("LB_DAILY_FORBIDDEN_SETTING")
    if any(k not in cfg["daily"]["trainArgsAllowed"] for k in t):  # guard:dr-setting-allowed
        raise DailyRunError("LB_DAILY_SETTING_NOT_ALLOWED")
    if any(not isinstance(v, str) or not re.match(r"^[A-Za-z0-9._]+$", v) for v in t.values()):  # guard:dr-setting-values
        raise DailyRunError("LB_DAILY_SETTING_NOT_ALLOWED")
    if t.get("--val-split") != "disjoint":  # guard:dr-val-split
        raise DailyRunError("LB_DAILY_SETTING_REQUIRED")
    td, rv, jt, mb = dr.get("trainDeadlineMin"), dr.get("reserveMin"), dr.get("jobTimeoutMin"), dr.get("minBudgetMin")
    if not all(type(x) is int for x in (td, rv, jt, mb)) or mb < 1 or td < mb or rv < 30 or td + rv > jt or jt > 355:  # guard:dr-deadline-cap
        raise DailyRunError("LB_DAILY_BAD_DEADLINE")
    if dr.get("r2Folder") != "lb-daily":  # guard:dr-r2-folder
        raise DailyRunError("LB_DAILY_BAD_CONFIG")
    if not any(isinstance(c, dict) and all(c.get(k) == dr["corpus"].get(k) for k in PIN_KEYS) for c in cfg["clearedCorpora"]):  # guard:dr-cleared
        raise DailyRunError("LB_DAILY_NOT_CLEARED")
    return dr


def check_marker(m):
    ok = (isinstance(m, dict) and sorted(m) == sorted(MARKER_FIELDS) and m["schema"] == MARKER_SCHEMA and type(m["more"]) is bool
          and m["stopReason"] in STOP_REASONS and type(m["step"]) is int and m["step"] > 0 and type(m["totalSteps"]) is int
          and isinstance(m["save"], str) and SAVE_RE.match(m["save"]) and isinstance(m["manifestSha256"], str) and HEX64.match(m["manifestSha256"])
          and isinstance(m["cfgSha256"], str) and HEX64.match(m["cfgSha256"]))
    if not ok:  # guard:dr-marker
        raise DailyRunError("LB_DAILY_ROW_VALUE")
    return m


def bpb_matches(row):
    """heldoutBpb is export.py's round(model_ce * tokens / ln 2 / bytes, 4): the recompute from the logged inputs must
    agree to the rounding (5e-5; 1e-4 allows for numpy's round)."""
    return abs(row["modelCe"] * row["heldoutTokens"] / math.log(2) / row["heldBytes"] - row["heldoutBpb"]) <= 1e-4


def check_row(row, cfg, legacy_ok=False):
    """legacy_ok (the trusted-record read only): a v1 row with exactly the v1 fields and runId <= V1_LAST_RUN_ID is
    accepted."""
    legacy = legacy_ok and isinstance(row, dict) and row.get("schema") == LEGACY_SCHEMA
    if not isinstance(row, dict) or sorted(row) != sorted(V1_FIELDS if legacy else ROW_FIELDS):  # guard:dr-row-fields
        raise DailyRunError("LB_DAILY_ROW_FIELD")
    if not isinstance(row["pins"], dict) or sorted(row["pins"]) != sorted(PIN_KEYS) or any(row["pins"][k] != cfg["dailyRun"]["corpus"][k] for k in PIN_KEYS):  # guard:dr-row-pins
        raise DailyRunError("LB_DAILY_PIN_MISMATCH")
    ok = (row["schema"] == (LEGACY_SCHEMA if legacy else ROW_SCHEMA) and isinstance(row["runId"], str) and ID_RE.match(row["runId"])
          and isinstance(row["chainId"], str) and ID_RE.match(row["chainId"]) and isinstance(row["workflowSha"], str)
          and re.match(r"^[0-9a-f]{40}$", row["workflowSha"]) and isinstance(row["today"], str) and DATE_RE.match(row["today"])
          and row["status"] == "trained" and type(row["startStep"]) is int and row["startStep"] >= 0 and type(row["endStep"]) is int
          and row["endStep"] >= row["startStep"] and row["stopReason"] in STOP_REASONS and num_ok(row["heldoutBpb"]) and num_ok(row["baselineBpb"])
          and type(row["wallSeconds"]) is int and row["wallSeconds"] >= 0
          and (row["resumedFrom"] is None or (isinstance(row["resumedFrom"], str) and HEX64.match(row["resumedFrom"]))))
    if not ok:  # guard:dr-row-values
        raise DailyRunError("LB_DAILY_ROW_VALUE")
    if legacy and int(row["runId"]) > V1_LAST_RUN_ID:  # guard:dr-row-v1-cutoff
        raise DailyRunError("LB_DAILY_ROW_VALUE")
    if not legacy:
        ins = (num_ok(row["modelCe"]) and type(row["heldoutTokens"]) is int and row["heldoutTokens"] >= 1
               and type(row["heldBytes"]) is int and row["heldBytes"] >= 1)
        if not ins:  # guard:dr-row-inputs
            raise DailyRunError("LB_DAILY_ROW_VALUE")
        if not bpb_matches(row):  # guard:dr-row-bpb
            raise DailyRunError("LB_DAILY_ROW_VALUE")
    check_marker(row["marker"])
    if row["marker"]["step"] != row["endStep"] or row["marker"]["stopReason"] != row["stopReason"]:  # guard:dr-row-marker-match
        raise DailyRunError("LB_DAILY_ROW_VALUE")
    return row


def read_rows(res, sub):
    d = os.path.join(res, "runs", sub)
    if os.path.islink(os.path.join(res, "runs")) or os.path.islink(d):  # guard:dr-read-symlink
        raise DailyRunError("LB_DAILY_RECORD_BAD")
    out = []
    for n in sorted(os.listdir(d)) if os.path.isdir(d) else []:
        p = os.path.join(d, n)
        try:
            with open(p, encoding="utf-8") as f:
                out.append((n, json.load(f)))
        except (OSError, ValueError):
            raise DailyRunError("LB_DAILY_RECORD_BAD")
    return out


def pick_trusted(daily, cfg, today):
    """daily = [(file name, row)]. Every row must be valid and named <today>-<runId>.json; the newest (date, run id)
    row is the trusted resume point. Fail-closed on any doubt."""
    keyed = []
    for n, r in daily:
        m = NAME_RE.match(n)
        try:
            check_row(r, cfg, legacy_ok=True)
        except DailyRunError:
            raise DailyRunError("LB_DAILY_RECORD_BAD")
        if not m or m.group(1) != r["today"] or m.group(2) != r["runId"]:  # guard:dr-record-name
            raise DailyRunError("LB_DAILY_RECORD_BAD")
        keyed.append(((r["today"], int(r["runId"])), n, r))
    keyed.sort()
    if any(r["today"] == today for _, _, r in keyed):  # guard:dr-once
        raise DailyRunError("LB_DAILY_ALREADY_RAN")
    if not keyed:
        return {"kind": "fresh", "chainId": None, "marker": None, "row": None}
    _, n, r = keyed[-1]
    if any(x["chainId"] != r["chainId"] for _, _, x in keyed):  # guard:dr-one-chain
        raise DailyRunError("LB_DAILY_RECORD_BAD")
    return {"kind": "resume" if r["marker"]["more"] else "done", "chainId": r["chainId"], "marker": r["marker"], "row": n}


def trusted(a, cfg):
    res = os.environ.get("RESULTS_DIR", "")
    if not res or not os.path.isdir(res):
        raise DailyRunError("LB_DAILY_NO_RESULTS")
    if not DATE_RE.match(a.today):
        raise DailyRunError("LB_DAILY_BAD_ARGS")
    daily = read_rows(res, "lb-daily")
    full = [r for _, r in read_rows(res, "lb-train")] + [r for _, r in daily]
    check_config(cfg, full)
    t = pick_trusted(daily, cfg, a.today)
    body = (json.dumps(t, sort_keys=True) + "\n").encode("ascii")
    fd = os.open(a.out, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0), 0o644)
    with os.fdopen(fd, "wb") as f:
        f.write(body)
    tsha = hashlib.sha256(body).hexdigest()
    m = t["marker"] or {}
    out = os.environ.get("GITHUB_OUTPUT", "")
    if out:
        with open(out, "a", encoding="ascii") as f:
            f.write(f"kind={t['kind']}\nchain={t['chainId'] or ''}\nsave={m.get('save', '')}\nsha={m.get('manifestSha256', '')}\ntrusted_sha={tsha}\n")
    return f"trusted kind={t['kind']} chain={t['chainId'] or '-'} save={m.get('save', '-')} sha={m.get('manifestSha256', '-')} step={m.get('step', 0)} record={t['row'] or '-'}"


def load_trusted(path, want):
    try:
        got = sha256_file(path)
        with open(path, encoding="ascii") as f:
            t = json.load(f)
    except (OSError, ValueError):
        raise DailyRunError("LB_DAILY_UNTRUSTED")
    if not isinstance(want, str) or not HEX64.match(want) or got != want:  # guard:dr-trusted-sha
        raise DailyRunError("LB_DAILY_UNTRUSTED")
    if not isinstance(t, dict) or t.get("kind") not in ("fresh", "resume", "done"):
        raise DailyRunError("LB_DAILY_UNTRUSTED")
    if t["kind"] != "fresh":
        check_marker(t.get("marker"))
    return t


def restore(a):
    """Before any resume: the save restored from R2 must hash to the trusted record's manifest sha256, it must be the
    only save in STATE, and chain.json is written from the trusted record (never from the bucket or the restored state)."""
    t = load_trusted(a.trusted, a.trusted_sha)
    s = a.state
    if t["kind"] == "done":
        raise DailyRunError("LB_DAILY_CHAIN_DONE")
    saves = os.path.join(s, "saves")
    names = sorted(os.listdir(saves)) if os.path.isdir(saves) else []
    if t["kind"] == "fresh":
        if names or os.path.lexists(os.path.join(s, "chain.json")):  # guard:dr-fresh-empty
            raise DailyRunError("LB_DAILY_STATE_NOT_EMPTY")
        for sub in ("saves", "work", "logs", "reports"):
            os.makedirs(os.path.join(s, sub), exist_ok=True)
        return "restore fresh"
    m = t["marker"]
    if names != [m["save"]]:  # guard:dr-only-trusted-save
        raise DailyRunError("LB_DAILY_SAVE_SET")
    mp = os.path.join(saves, m["save"], "manifest.json")
    if os.path.islink(mp) or not os.path.isfile(mp) or sha256_file(mp) != m["manifestSha256"]:  # guard:dr-save-sha
        raise DailyRunError("LB_DAILY_SAVE_SHA_MISMATCH")
    if os.path.lexists(os.path.join(s, "chain.json")):  # guard:dr-chain-absent
        raise DailyRunError("LB_DAILY_STATE_NOT_EMPTY")
    for sub in ("work", "logs", "reports"):
        os.makedirs(os.path.join(s, sub), exist_ok=True)
    fd = os.open(os.path.join(s, "chain.json"), os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0), 0o644)
    with os.fdopen(fd, "w", encoding="ascii") as f:
        f.write(canonical(m) + "\n")
    return f"restore resume save={m['save']} sha={m['manifestSha256']} step={m['step']}"


def cycle_args(a, cfg, now):
    """Lines: the budget in whole minutes, LB_DAILY_EXPECT for lb-daily-cycle.sh (fresh | resume:<trusted sha>), then the
    train.py args (sorted flag value pairs from dailyRun.train)."""
    dr = check_config(cfg)
    t = load_trusted(a.trusted, a.trusted_sha)
    if t["kind"] == "done":
        raise DailyRunError("LB_DAILY_CHAIN_DONE")
    if not re.match(r"^[0-9]{10}$", str(a.job_start)) or int(a.job_start) > now + 60:  # guard:dr-job-start
        raise DailyRunError("LB_DAILY_BAD_DEADLINE")
    budget = min(dr["trainDeadlineMin"], (int(a.job_start) + dr["trainDeadlineMin"] * 60 - now) // 60)
    if budget < dr["minBudgetMin"]:  # guard:dr-budget
        raise DailyRunError("LB_DAILY_BAD_DEADLINE")
    expect = "fresh" if t["kind"] == "fresh" else "resume:" + t["marker"]["manifestSha256"]
    lines = [str(budget), expect]
    for k in sorted(dr["train"]):
        lines += [k, dr["train"][k]]
    return lines


def build_row(a, cfg, now):
    check_config(cfg)
    t = load_trusted(a.trusted, a.trusted_sha)
    s = a.state
    try:
        with open(os.path.join(s, "reports", f"{a.today}.json"), encoding="utf-8") as f:
            rep = json.load(f)
        with open(os.path.join(s, "chain.json"), encoding="utf-8") as f:
            mk = json.load(f)
    except (OSError, ValueError):
        raise DailyRunError("LB_DAILY_TRAIN_ERROR")
    if not isinstance(rep, dict) or rep.get("status") != "trained" or not isinstance(rep.get("eval"), dict):  # guard:dr-report-trained
        raise DailyRunError("LB_DAILY_TRAIN_ERROR")
    check_marker(mk)
    mp = os.path.join(s, "saves", mk["save"], "manifest.json")
    if not os.path.isfile(mp) or sha256_file(mp) != mk["manifestSha256"]:  # guard:dr-row-save-sha
        raise DailyRunError("LB_DAILY_SAVE_SHA_MISMATCH")
    if a.uploaded != f"{mk['save']}:{mk['manifestSha256']}":  # guard:dr-row-uploaded
        raise DailyRunError("LB_DAILY_NOT_UPLOADED")
    prev = t["marker"]["manifestSha256"] if t["kind"] == "resume" else None
    if (prev is None) != (rep.get("startStep") == 0) or (t["kind"] == "resume" and rep.get("startStep") != t["marker"]["step"]):  # guard:dr-row-chain
        raise DailyRunError("LB_DAILY_ROW_VALUE")
    ev = rep["eval"]
    row = {"schema": ROW_SCHEMA, "runId": a.run_id, "workflowSha": a.sha, "chainId": t["chainId"] or a.run_id, "today": a.today,
           "pins": rep.get("corpus"), "status": "trained", "startStep": rep.get("startStep"), "endStep": rep.get("endStep"),
           "stopReason": rep.get("stopReason"), "heldoutBpb": ev.get("model_bits_per_byte"), "baselineBpb": ev.get("unigram_bits_per_byte"),
           "wallSeconds": int(now) - int(a.job_start), "resumedFrom": prev, "marker": mk,
           "modelCe": ev.get("model_ce"), "heldoutTokens": ev.get("heldout_tokens"), "heldBytes": ev.get("held_bytes")}
    return check_row(row, cfg)


def land(a, cfg):
    try:
        with open(a.row, encoding="utf-8") as f:
            row = json.load(f)
    except (OSError, ValueError):
        raise DailyRunError("LB_DAILY_ROW_VALUE")
    check_row(row, cfg)
    if row["runId"] != a.run_id or row["today"] != a.today:  # guard:dr-land-id
        raise DailyRunError("LB_DAILY_ROW_VALUE")
    res = os.environ.get("RESULTS_DIR", "")
    if not res or not os.path.isdir(res):
        raise DailyRunError("LB_DAILY_NO_RESULTS")
    d = os.path.join(res, "runs", "lb-daily")
    if os.path.islink(os.path.join(res, "runs")) or os.path.islink(d):  # guard:dr-land-symlink
        raise DailyRunError("LB_DAILY_LAND_SYMLINK")
    os.makedirs(d, exist_ok=True)
    rel = f"runs/lb-daily/{a.today}-{a.run_id}.json"
    try:
        with open(os.path.join(res, rel), "x", encoding="utf-8") as f:
            f.write(json.dumps(row, indent=1, sort_keys=True) + "\n")
    except FileExistsError:
        raise DailyRunError("LB_DAILY_ROW_EXISTS")
    return rel


def main(argv):
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=("ref", "config", "trusted", "restore", "cycle-args", "row", "land"))
    for o in ("--ref", "--out", "--today", "--trusted", "--trusted-sha", "--state", "--job-start", "--run-id", "--sha", "--uploaded", "--row"):
        ap.add_argument(o, default="")
    ap.add_argument("--now", type=int, default=0)
    a = ap.parse_args(argv)
    now = a.now or int(time.time())
    cfg = load_cfg()
    if a.cmd == "ref":
        check_ref(a.ref)
        print("ref ok")
    elif a.cmd == "config":
        check_config(cfg)
        print("config ok")
    elif a.cmd == "trusted":
        print(trusted(a, cfg))
    elif a.cmd == "restore":
        print(restore(a))
    elif a.cmd == "cycle-args":
        print("\n".join(cycle_args(a, cfg, now)))
    elif a.cmd == "row":
        row = build_row(a, cfg, now)
        try:
            with open(a.out, "x", encoding="utf-8") as f:
                f.write(json.dumps(row, sort_keys=True) + "\n")
        except OSError:
            raise DailyRunError("LB_DAILY_ROW_EXISTS")
        v = "beats_baseline" if row["heldoutBpb"] < row["baselineBpb"] else "no_gain"
        print(f"lb-daily start={row['startStep']} end={row['endStep']} stop={row['stopReason']} more={row['marker']['more']} heldout_bpb={row['heldoutBpb']} "
              f"baseline_bpb={row['baselineBpb']} verdict={v} save={row['marker']['save']} sha={row['marker']['manifestSha256']} wall_s={row['wallSeconds']} "
              f"model_ce={row['modelCe']} heldout_tokens={row['heldoutTokens']} held_bytes={row['heldBytes']}")
    else:
        print("landed " + land(a, cfg))


if __name__ == "__main__":
    try:
        main(sys.argv[1:])
    except DailyRunError as e:
        print(e.code)
        sys.exit(3)
