"""lb-chain2 v1 (spec peaceai/spec/lb-chain2-v1.md): the guards the peace-lb-chain2.yml training job runs around
peaceai/bin/lb-chain2-run.sh (which runs the lb-daily cycle, peaceai/bin/lb-daily-cycle.sh). Chain 2 is a NEW chain
on the lb-corpus v2 (lb-corpus2.json build pins, cleared in lb-train.json clearedCorpora): its chainId is the run id of
its first dispatch (never chain 1's), its saves are R2 lb-daily/<chainId>/, its trusted record is the add-only Results
rows runs/lb-chain2/<YYYY-MM-DD>-<run id>.json, and day 1 warm-starts (train.py --warm-start-from, warmstart.py) from
chain 1's final save, pinned three ways: the save's manifest sha256 (lb-train.json chain2Run.warmStart, which must equal
lb-corpus2.json chain2.warmStart), the day-3 Results row (by its file sha256) that names it, and saves.verify_save.
Usage: lb_chain2.py ref --ref REF
       lb_chain2.py config
       lb_chain2.py pins --corpus DIR                 (the build job's artifact, BEFORE any secret: exactly docs.jsonl,
                                                       manifest.jsonl, fingerprint.json; sha-checked against the
                                                       protected pins; fail closed)
       lb_chain2.py trusted --out FILE --today D      (under results-write.sh, read only: $RESULTS_DIR runs/lb-chain2/
                                                       and the one pinned day-3 row of runs/lb-daily/)
       lb_chain2.py restore --trusted FILE --trusted-sha SHA --state DIR --warm DIR
       lb_chain2.py cycle-args --trusted FILE --trusted-sha SHA --job-start EPOCH --warm DIR [--now EPOCH]
       lb_chain2.py row --trusted FILE --trusted-sha SHA --state DIR --today D --run-id ID --sha SHA --job-start EPOCH
                        --uploaded SAVE:SHA --out FILE [--now EPOCH]
       lb_chain2.py land --row FILE --run-id ID --today D (under results-write.sh: $RESULTS_DIR/runs/lb-chain2/<D>-<ID>.json)
Settings come from lb-train.json chain2Run only. A refusal prints one fixed code and exits 3; output is codes, pins,
shas, save names, steps and metrics only. Standard library only (CI and the trusted steps have no numpy)."""
import argparse
import hashlib
import json
import math
import os
import re
import sys
import time

import lb_daily
import saves

HERE = os.path.dirname(os.path.abspath(__file__))
PIN_KEYS = ("docs", "manifest", "fingerprint")
CORPUS_FILES = ("docs.jsonl", "fingerprint.json", "manifest.jsonl")
ROW_SCHEMA = "peaceai-lb-chain2-run:v1"
ROW_FIELDS = lb_daily.ROW_FIELDS + ("warmStart", "heldoutV2")
V2_FIELDS = ("bpb", "baselineBpb", "modelCe", "tokens", "bytes", "windows", "docs")
WARM_KEYS = ("fromChain", "save", "manifestSha256")
SHAPE_ARGS = ("--d-model", "--n-layer", "--n-head", "--ctx", "--vocab")
WARM_ARGS = re.compile(r"^--warm-start")
HEX64 = lb_daily.HEX64
NAME_RE = lb_daily.NAME_RE
DATE_RE = lb_daily.DATE_RE


class Chain2Error(Exception):
    def __init__(self, code):
        super().__init__(code)
        self.code = code


def load_json(name):
    with open(os.path.join(HERE, name), encoding="utf-8") as f:
        return json.load(f)


def sha256_file(p):
    return lb_daily.sha256_file(p)


def check_ref(ref):
    if ref != "refs/heads/main":  # guard:c2-ref
        raise Chain2Error("LB_C2_REF_NOT_MAIN")


def check_config(cfg, plan, fp_sha):
    """lb-train.json chain2Run against lb-corpus2.json (the published v2 pins and the chain-2 plan) and the committed
    fingerprint file's sha256 `fp_sha`."""
    c2 = cfg.get("chain2Run")
    ch = plan.get("chain2") or {}
    b = plan.get("build") or {}
    if not isinstance(c2, dict) or ch.get("enabled") is not True:  # guard:c2-enabled
        raise Chain2Error("LB_C2_DISABLED")
    pins = {"docs": b.get("docsSha256"), "manifest": b.get("manifestSha256"), "fingerprint": b.get("fingerprint")}
    if not isinstance(c2.get("corpus"), dict) or sorted(c2["corpus"]) != sorted(PIN_KEYS) or any(c2["corpus"][k] != pins[k] for k in PIN_KEYS):  # guard:c2-config-pins
        raise Chain2Error("LB_C2_PIN_MISMATCH")
    if c2.get("fingerprintFileSha256") != fp_sha:  # guard:c2-config-fp-file
        raise Chain2Error("LB_C2_PIN_MISMATCH")
    if not any(isinstance(c, dict) and all(c.get(k) == pins[k] for k in PIN_KEYS) for c in cfg["clearedCorpora"]):  # guard:c2-cleared
        raise Chain2Error("LB_C2_NOT_CLEARED")
    if any(c2["corpus"][k] == cfg["dailyRun"]["corpus"][k] for k in PIN_KEYS):  # guard:c2-new-pins
        raise Chain2Error("LB_C2_PIN_MISMATCH")
    w, pw = c2.get("warmStart") or {}, ch.get("warmStart") or {}
    if any(w.get(k) != pw.get(k) for k in WARM_KEYS + ("resultsRow",)) or not str(w.get("resultsCommit", "")).startswith(str(pw.get("resultsCommit")) or "?"):  # guard:c2-warm-plan
        raise Chain2Error("LB_C2_WARM_CONFIG")
    ok = (isinstance(w.get("fromChain"), str) and lb_daily.ID_RE.match(w["fromChain"]) and isinstance(w.get("save"), str) and lb_daily.SAVE_RE.match(w["save"])
          and isinstance(w.get("manifestSha256"), str) and HEX64.match(w["manifestSha256"]) and isinstance(w.get("resultsRowSha256"), str)
          and HEX64.match(w["resultsRowSha256"]) and isinstance(w.get("cfgSha256"), str) and HEX64.match(w["cfgSha256"])
          and type(w.get("heldoutTokens")) is int and w["heldoutTokens"] >= 1 and type(w.get("heldBytes")) is int and w["heldBytes"] >= 1
          and isinstance(w.get("resultsRow"), str) and re.match(r"^runs/lb-daily/20[0-9]{2}-[0-9]{2}-[0-9]{2}-[1-9][0-9]{0,19}\.json\Z", w["resultsRow"]))
    if not ok:  # guard:c2-warm-values
        raise Chain2Error("LB_C2_WARM_CONFIG")
    t = c2.get("train") or {}
    if any(lb_daily.LORA.match(k) or lb_daily.FORBIDDEN.match(k) or WARM_ARGS.match(k) for k in t):  # guard:c2-setting-forbidden
        raise Chain2Error("LB_C2_FORBIDDEN_SETTING")
    if any(k not in cfg["daily"]["trainArgsAllowed"] for k in t):  # guard:c2-setting-allowed
        raise Chain2Error("LB_C2_SETTING_NOT_ALLOWED")
    if any(not isinstance(v, str) or not re.match(r"^[A-Za-z0-9._]+\Z", v) for v in t.values()):  # guard:c2-setting-values
        raise Chain2Error("LB_C2_SETTING_NOT_ALLOWED")
    if t.get("--val-split") != "disjoint":  # guard:c2-val-split
        raise Chain2Error("LB_C2_SETTING_REQUIRED")
    if any(t.get(k) != cfg["dailyRun"]["train"].get(k) for k in SHAPE_ARGS):  # guard:c2-shape
        raise Chain2Error("LB_C2_SHAPE")
    td, rv, jt, mb = c2.get("trainDeadlineMin"), c2.get("reserveMin"), c2.get("jobTimeoutMin"), c2.get("minBudgetMin")
    if not all(type(x) is int for x in (td, rv, jt, mb)) or mb < 1 or td < mb or rv < 30 or td + rv > jt or jt > 355:  # guard:c2-deadline-cap
        raise Chain2Error("LB_C2_BAD_DEADLINE")
    if c2.get("r2Folder") != "lb-daily" or c2.get("resultsDir") != "lb-chain2":  # guard:c2-folders
        raise Chain2Error("LB_C2_BAD_CONFIG")
    return c2


def check_pins(d, c2, fp_bytes):
    """The build job's artifact before any use: exactly the three files, regular and not symlinks; docs and manifest
    sha256 equal to the protected pins; fingerprint.json byte-equal to the committed lb-corpus2-fingerprint.json (whose
    .fingerprint is the pin)."""
    if os.path.islink(d) or not os.path.isdir(d) or sorted(os.listdir(d)) != sorted(CORPUS_FILES):  # guard:c2-pins-files
        raise Chain2Error("LB_C2_CORPUS_FILES")
    if any(os.path.islink(os.path.join(d, f)) or not os.path.isfile(os.path.join(d, f)) for f in CORPUS_FILES):  # guard:c2-pins-regular
        raise Chain2Error("LB_C2_CORPUS_FILES")
    if sha256_file(os.path.join(d, "docs.jsonl")) != c2["corpus"]["docs"]:  # guard:c2-pins-docs
        raise Chain2Error("LB_C2_CORPUS_SHA_MISMATCH")
    if sha256_file(os.path.join(d, "manifest.jsonl")) != c2["corpus"]["manifest"]:  # guard:c2-pins-manifest
        raise Chain2Error("LB_C2_CORPUS_SHA_MISMATCH")
    with open(os.path.join(d, "fingerprint.json"), "rb") as f:
        got = f.read()
    if got != fp_bytes:  # guard:c2-pins-fingerprint-file
        raise Chain2Error("LB_C2_CORPUS_SHA_MISMATCH")
    try:
        fp = json.loads(got)
    except ValueError:
        raise Chain2Error("LB_C2_CORPUS_SHA_MISMATCH")
    if not isinstance(fp, dict) or fp.get("fingerprint") != c2["corpus"]["fingerprint"]:  # guard:c2-pins-fingerprint
        raise Chain2Error("LB_C2_CORPUS_SHA_MISMATCH")
    return "pins ok docs=%s manifest=%s fingerprint=%s" % (c2["corpus"]["docs"], c2["corpus"]["manifest"], c2["corpus"]["fingerprint"])


def check_warm_row(res, cfg, c2):
    """The chain-1 row that names the warm-start save: the exact pinned file (sha256), a valid lb-daily row, and its
    marker the pinned save at the end of chain 1."""
    w = c2["warmStart"]
    p = os.path.join(res, w["resultsRow"])
    for q in (os.path.join(res, "runs"), os.path.join(res, "runs", "lb-daily"), p):
        if os.path.islink(q):  # guard:c2-warm-row-symlink
            raise Chain2Error("LB_C2_WARM_ROW")
    try:
        got = sha256_file(p)
        with open(p, encoding="utf-8") as f:
            row = json.load(f)
    except (OSError, ValueError):
        raise Chain2Error("LB_C2_WARM_ROW")
    if got != w["resultsRowSha256"]:  # guard:c2-warm-row-sha
        raise Chain2Error("LB_C2_WARM_ROW")
    try:
        lb_daily.check_row(row, cfg)
    except lb_daily.DailyRunError:
        raise Chain2Error("LB_C2_WARM_ROW")
    m = row["marker"]
    if m["save"] != w["save"] or m["manifestSha256"] != w["manifestSha256"] or m["cfgSha256"] != w["cfgSha256"]:  # guard:c2-warm-row-marker
        raise Chain2Error("LB_C2_WARM_ROW")
    if row["chainId"] != w["fromChain"] or m["more"] is not False:  # guard:c2-warm-row-chain
        raise Chain2Error("LB_C2_WARM_ROW")
    if row["heldoutTokens"] != w["heldoutTokens"] or row["heldBytes"] != w["heldBytes"]:  # guard:c2-warm-row-split
        raise Chain2Error("LB_C2_WARM_ROW")
    return row


def check_v2(v):
    ok = (isinstance(v, dict) and sorted(v) == sorted(V2_FIELDS) and lb_daily.num_ok(v["bpb"]) and lb_daily.num_ok(v["baselineBpb"])
          and lb_daily.num_ok(v["modelCe"]) and type(v["tokens"]) is int and v["tokens"] >= 1 and type(v["bytes"]) is int and v["bytes"] >= 1
          and type(v["windows"]) is int and v["windows"] >= 1 and type(v["docs"]) is int and v["docs"] >= 1)
    if not ok:  # guard:c2-row-v2
        raise Chain2Error("LB_C2_ROW_VALUE")
    if abs(v["modelCe"] * v["tokens"] / math.log(2) / v["bytes"] - v["bpb"]) > 1e-4:  # guard:c2-row-v2-bpb
        raise Chain2Error("LB_C2_ROW_VALUE")


def check_row(row, cfg, c2):
    """A chain-2 row: the lb-daily v2 row fields (same checks, chain-2 pins) plus warmStart and heldoutV2; the held-out
    inputs equal the day-3 row's (the same split as days 1-3)."""
    if not isinstance(row, dict) or sorted(row) != sorted(ROW_FIELDS):  # guard:c2-row-fields
        raise Chain2Error("LB_C2_ROW_FIELD")
    if row["schema"] != ROW_SCHEMA:  # guard:c2-row-schema
        raise Chain2Error("LB_C2_ROW_VALUE")
    base = {k: row[k] for k in lb_daily.ROW_FIELDS}
    base["schema"] = lb_daily.ROW_SCHEMA
    view = dict(cfg, dailyRun=dict(cfg["dailyRun"], corpus=c2["corpus"]))
    try:
        lb_daily.check_row(base, view)
    except lb_daily.DailyRunError as e:
        raise Chain2Error("LB_C2_PIN_MISMATCH" if e.code == "LB_DAILY_PIN_MISMATCH" else "LB_C2_ROW_VALUE")
    w = c2["warmStart"]
    if row["warmStart"] != {k: w[k] for k in WARM_KEYS}:  # guard:c2-row-warm
        raise Chain2Error("LB_C2_ROW_VALUE")
    if row["chainId"] == w["fromChain"]:  # guard:c2-row-new-chain
        raise Chain2Error("LB_C2_ROW_VALUE")
    if row["heldoutTokens"] != w["heldoutTokens"] or row["heldBytes"] != w["heldBytes"]:  # guard:c2-row-same-split
        raise Chain2Error("LB_C2_HELDOUT_SPLIT_DIFFERS")
    check_v2(row["heldoutV2"])
    return row


def pick_trusted(rows, cfg, c2, today):
    keyed = []
    for n, r in rows:
        m = NAME_RE.match(n)
        try:
            check_row(r, cfg, c2)
        except Chain2Error:
            raise Chain2Error("LB_C2_RECORD_BAD")
        if not m or m.group(1) != r["today"] or m.group(2) != r["runId"]:  # guard:c2-record-name
            raise Chain2Error("LB_C2_RECORD_BAD")
        keyed.append(((r["today"], int(r["runId"])), n, r))
    keyed.sort()
    if any(r["today"] == today for _, _, r in keyed):  # guard:c2-once
        raise Chain2Error("LB_C2_ALREADY_RAN")
    if not keyed:
        w = c2["warmStart"]
        return {"kind": "warm", "chainId": None, "marker": None, "row": None, "warm": {k: w[k] for k in WARM_KEYS}}
    _, n, r = keyed[-1]
    if any(x["chainId"] != r["chainId"] for _, _, x in keyed):  # guard:c2-one-chain
        raise Chain2Error("LB_C2_RECORD_BAD")
    if keyed[0][2]["startStep"] != 0 or keyed[0][2]["resumedFrom"] is not None:  # guard:c2-first-row-warm
        raise Chain2Error("LB_C2_RECORD_BAD")
    return {"kind": "resume" if r["marker"]["more"] else "done", "chainId": r["chainId"], "marker": r["marker"], "row": n, "warm": None}


def trusted(a, cfg, c2):
    res = os.environ.get("RESULTS_DIR", "")
    if not res or not os.path.isdir(res):
        raise Chain2Error("LB_C2_NO_RESULTS")
    if not DATE_RE.match(a.today):
        raise Chain2Error("LB_C2_BAD_ARGS")
    check_warm_row(res, cfg, c2)
    try:
        rows = lb_daily.read_rows(res, "lb-chain2")
    except lb_daily.DailyRunError:
        raise Chain2Error("LB_C2_RECORD_BAD")
    t = pick_trusted(rows, cfg, c2, a.today)
    body = (json.dumps(t, sort_keys=True) + "\n").encode("ascii")
    fd = os.open(a.out, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0), 0o644)
    with os.fdopen(fd, "wb") as f:
        f.write(body)
    tsha = hashlib.sha256(body).hexdigest()
    m = t["marker"] or t["warm"]
    chain = t["chainId"] or ""
    out = os.environ.get("GITHUB_OUTPUT", "")
    if out:
        with open(out, "a", encoding="ascii") as f:
            f.write(f"kind={t['kind']}\nchain={chain}\nwarm_chain={(t['warm'] or {}).get('fromChain', '')}\nsave={m['save']}\nsha={m['manifestSha256']}\ntrusted_sha={tsha}\n")
    return f"trusted kind={t['kind']} chain={chain or '-'} save={m['save']} sha={m['manifestSha256']} step={(t['marker'] or {}).get('step', 0)} record={t['row'] or '-'}"


def load_trusted(path, want):
    try:
        got = sha256_file(path)
        with open(path, encoding="ascii") as f:
            t = json.load(f)
    except (OSError, ValueError):
        raise Chain2Error("LB_C2_UNTRUSTED")
    if not isinstance(want, str) or not HEX64.match(want) or got != want:  # guard:c2-trusted-sha
        raise Chain2Error("LB_C2_UNTRUSTED")
    if not isinstance(t, dict) or t.get("kind") not in ("warm", "resume", "done"):
        raise Chain2Error("LB_C2_UNTRUSTED")
    if t["kind"] != "warm":
        try:
            lb_daily.check_marker(t.get("marker"))
        except lb_daily.DailyRunError:
            raise Chain2Error("LB_C2_UNTRUSTED")
    return t


def warm_dir(a, t):
    return os.path.join(a.warm, t["warm"]["save"])


def restore(a, c2):
    """warm: STATE empty; WARM holds exactly the pinned save, fully verified (saves.verify_save: manifest sha256 = the
    pin, every file's sha256) and with the day-3 row's cfgSha256. resume: as lb_daily.restore (the one trusted save in
    STATE/saves, manifest sha256 = the trusted record's) and WARM empty."""
    t = load_trusted(a.trusted, a.trusted_sha)
    s = a.state
    if t["kind"] == "done":
        raise Chain2Error("LB_C2_CHAIN_DONE")
    names = sorted(os.listdir(os.path.join(s, "saves"))) if os.path.isdir(os.path.join(s, "saves")) else []
    wnames = sorted(os.listdir(a.warm)) if a.warm and os.path.isdir(a.warm) else []
    if t["kind"] == "warm":
        w = t["warm"]
        if w != {k: c2["warmStart"][k] for k in WARM_KEYS}:  # guard:c2-restore-warm-config
            raise Chain2Error("LB_C2_UNTRUSTED")
        if names or os.path.lexists(os.path.join(s, "chain.json")):  # guard:c2-warm-state-empty
            raise Chain2Error("LB_C2_STATE_NOT_EMPTY")
        if os.path.islink(a.warm) or wnames != [w["save"]]:  # guard:c2-warm-save-set
            raise Chain2Error("LB_C2_WARM_SAVE_SET")
        try:
            man = saves.verify_save(warm_dir(a, t), w["manifestSha256"])
        except saves.SaveError:
            raise Chain2Error("LB_C2_WARM_SHA_MISMATCH")
        if man["cfgSha256"] != c2["warmStart"]["cfgSha256"]:  # guard:c2-warm-cfg
            raise Chain2Error("LB_C2_WARM_SHA_MISMATCH")
        for sub in ("saves", "work", "logs", "reports"):
            os.makedirs(os.path.join(s, sub), exist_ok=True)
        return f"restore warm from={w['fromChain']} save={w['save']} sha={w['manifestSha256']} step={man['step']}"
    if wnames:  # guard:c2-resume-no-warm
        raise Chain2Error("LB_C2_WARM_SAVE_SET")
    m = t["marker"]
    if names != [m["save"]]:  # guard:c2-only-trusted-save
        raise Chain2Error("LB_C2_SAVE_SET")
    mp = os.path.join(s, "saves", m["save"], "manifest.json")
    if os.path.islink(mp) or not os.path.isfile(mp) or sha256_file(mp) != m["manifestSha256"]:  # guard:c2-save-sha
        raise Chain2Error("LB_C2_SAVE_SHA_MISMATCH")
    if os.path.lexists(os.path.join(s, "chain.json")):  # guard:c2-chain-absent
        raise Chain2Error("LB_C2_STATE_NOT_EMPTY")
    for sub in ("work", "logs", "reports"):
        os.makedirs(os.path.join(s, sub), exist_ok=True)
    fd = os.open(os.path.join(s, "chain.json"), os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0), 0o644)
    with os.fdopen(fd, "w", encoding="ascii") as f:
        f.write(lb_daily.canonical(m) + "\n")
    return f"restore resume save={m['save']} sha={m['manifestSha256']} step={m['step']}"


def cycle_args(a, c2, now):
    """Lines: budget minutes, LB_DAILY_EXPECT (fresh on the warm day, resume:<sha> after), then the train.py args:
    chain2Run.train (sorted pairs), then the warm-start flags (the warm day: --warm-start-from WARM/<save> and the
    pinned sha; resume days: the pinned sha alone, so a resume without it is SAVE_CONFIG_MISMATCH)."""
    t = load_trusted(a.trusted, a.trusted_sha)
    if t["kind"] == "done":
        raise Chain2Error("LB_C2_CHAIN_DONE")
    if not re.match(r"^[0-9]{10}\Z", str(a.job_start)) or int(a.job_start) > now + 60:  # guard:c2-job-start
        raise Chain2Error("LB_C2_BAD_DEADLINE")
    budget = min(c2["trainDeadlineMin"], (int(a.job_start) + c2["trainDeadlineMin"] * 60 - now) // 60)
    if budget < c2["minBudgetMin"]:  # guard:c2-budget
        raise Chain2Error("LB_C2_BAD_DEADLINE")
    pin = c2["warmStart"]["manifestSha256"]
    expect = "fresh" if t["kind"] == "warm" else "resume:" + t["marker"]["manifestSha256"]
    lines = [str(budget), expect]
    for k in sorted(c2["train"]):
        lines += [k, c2["train"][k]]
    if t["kind"] == "warm":
        lines += ["--warm-start-from", warm_dir(a, t)]
    lines += ["--warm-start-manifest-sha", pin]
    return lines


def build_row(a, cfg, c2, now):
    t = load_trusted(a.trusted, a.trusted_sha)
    s = a.state
    try:
        with open(os.path.join(s, "reports", f"{a.today}.json"), encoding="utf-8") as f:
            rep = json.load(f)
        with open(os.path.join(s, "chain.json"), encoding="utf-8") as f:
            mk = json.load(f)
        with open(os.path.join(s, "work", a.today, "model", "eval-v2.json"), encoding="utf-8") as f:
            ev2 = json.load(f)
    except (OSError, ValueError):
        raise Chain2Error("LB_C2_TRAIN_ERROR")
    if not isinstance(rep, dict) or rep.get("status") != "trained" or not isinstance(rep.get("eval"), dict):  # guard:c2-report-trained
        raise Chain2Error("LB_C2_TRAIN_ERROR")
    try:
        lb_daily.check_marker(mk)
    except lb_daily.DailyRunError:
        raise Chain2Error("LB_C2_ROW_VALUE")
    mp = os.path.join(s, "saves", mk["save"], "manifest.json")
    if not os.path.isfile(mp) or sha256_file(mp) != mk["manifestSha256"]:  # guard:c2-row-save-sha
        raise Chain2Error("LB_C2_SAVE_SHA_MISMATCH")
    if a.uploaded != f"{mk['save']}:{mk['manifestSha256']}":  # guard:c2-row-uploaded
        raise Chain2Error("LB_C2_NOT_UPLOADED")
    prev = t["marker"]["manifestSha256"] if t["kind"] == "resume" else None
    if (prev is None) != (rep.get("startStep") == 0) or (t["kind"] == "resume" and rep.get("startStep") != t["marker"]["step"]):  # guard:c2-row-chain
        raise Chain2Error("LB_C2_ROW_VALUE")
    ev = rep["eval"]
    w = c2["warmStart"]
    if not isinstance(ev2, dict):
        raise Chain2Error("LB_C2_TRAIN_ERROR")
    row = {"schema": ROW_SCHEMA, "runId": a.run_id, "workflowSha": a.sha, "chainId": t["chainId"] or a.run_id, "today": a.today,
           "pins": rep.get("corpus"), "status": "trained", "startStep": rep.get("startStep"), "endStep": rep.get("endStep"),
           "stopReason": rep.get("stopReason"), "heldoutBpb": ev.get("model_bits_per_byte"), "baselineBpb": ev.get("unigram_bits_per_byte"),
           "wallSeconds": int(now) - int(a.job_start), "resumedFrom": prev, "marker": mk,
           "modelCe": ev.get("model_ce"), "heldoutTokens": ev.get("heldout_tokens"), "heldBytes": ev.get("held_bytes"),
           "warmStart": {k: w[k] for k in WARM_KEYS},
           "heldoutV2": {"bpb": ev2.get("model_bits_per_byte"), "baselineBpb": ev2.get("unigram_bits_per_byte"), "modelCe": ev2.get("model_ce"),
                         "tokens": ev2.get("heldout_tokens"), "bytes": ev2.get("held_bytes"), "windows": ev2.get("windows"), "docs": ev2.get("docs")}}
    return check_row(row, cfg, c2)


def land(a, cfg, c2):
    try:
        with open(a.row, encoding="utf-8") as f:
            row = json.load(f)
    except (OSError, ValueError):
        raise Chain2Error("LB_C2_ROW_VALUE")
    check_row(row, cfg, c2)
    if row["runId"] != a.run_id or row["today"] != a.today:  # guard:c2-land-id
        raise Chain2Error("LB_C2_ROW_VALUE")
    res = os.environ.get("RESULTS_DIR", "")
    if not res or not os.path.isdir(res):
        raise Chain2Error("LB_C2_NO_RESULTS")
    d = os.path.join(res, "runs", "lb-chain2")
    if os.path.islink(os.path.join(res, "runs")) or os.path.islink(d):  # guard:c2-land-symlink
        raise Chain2Error("LB_C2_LAND_SYMLINK")
    os.makedirs(d, exist_ok=True)
    rel = f"runs/lb-chain2/{a.today}-{a.run_id}.json"
    try:
        with open(os.path.join(res, rel), "x", encoding="utf-8") as f:
            f.write(json.dumps(row, indent=1, sort_keys=True) + "\n")
    except FileExistsError:
        raise Chain2Error("LB_C2_ROW_EXISTS")
    return rel


def main(argv):
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=("ref", "config", "pins", "trusted", "restore", "cycle-args", "row", "land"))
    for o in ("--ref", "--corpus", "--out", "--today", "--trusted", "--trusted-sha", "--state", "--warm", "--job-start", "--run-id", "--sha",
              "--uploaded", "--row"):
        ap.add_argument(o, default="")
    ap.add_argument("--now", type=int, default=0)
    a = ap.parse_args(argv)
    now = a.now or int(time.time())
    if a.cmd == "ref":
        check_ref(a.ref)
        print("ref ok")
        return
    cfg = load_json("lb-train.json")
    plan = load_json("lb-corpus2.json")
    fp_path = os.path.join(HERE, "lb-corpus2-fingerprint.json")
    with open(fp_path, "rb") as f:
        fp_bytes = f.read()
    c2 = check_config(cfg, plan, hashlib.sha256(fp_bytes).hexdigest())
    if a.cmd == "config":
        print("config ok")
    elif a.cmd == "pins":
        print(check_pins(a.corpus, c2, fp_bytes))
    elif a.cmd == "trusted":
        print(trusted(a, cfg, c2))
    elif a.cmd == "restore":
        print(restore(a, c2))
    elif a.cmd == "cycle-args":
        print("\n".join(cycle_args(a, c2, now)))
    elif a.cmd == "row":
        row = build_row(a, cfg, c2, now)
        try:
            with open(a.out, "x", encoding="utf-8") as f:
                f.write(json.dumps(row, sort_keys=True) + "\n")
        except OSError:
            raise Chain2Error("LB_C2_ROW_EXISTS")
        v = "beats_baseline" if row["heldoutBpb"] < row["baselineBpb"] else "no_gain"
        h = row["heldoutV2"]
        print(f"lb-chain2 start={row['startStep']} end={row['endStep']} stop={row['stopReason']} more={row['marker']['more']} heldout_bpb={row['heldoutBpb']} "
              f"baseline_bpb={row['baselineBpb']} verdict={v} heldout_v2_bpb={h['bpb']} heldout_v2_baseline_bpb={h['baselineBpb']} "
              f"save={row['marker']['save']} sha={row['marker']['manifestSha256']} wall_s={row['wallSeconds']} model_ce={row['modelCe']} "
              f"heldout_tokens={row['heldoutTokens']} held_bytes={row['heldBytes']}")
    else:
        print("landed " + land(a, cfg, c2))


if __name__ == "__main__":
    try:
        main(sys.argv[1:])
    except Chain2Error as e:
        print(e.code)
        sys.exit(3)
