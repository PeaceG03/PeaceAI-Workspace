"""M157-M161 case driver: run ONE named case against the lbtrain.py / daily_cycle.py found in argv[1] (the real model
dir or a mutated copy) and print its outcome (a fixed code, "ok ...", a value, or "crash"). Used by the m157..m161
tests: each tagged guard has one case here whose outcome must change when that guard is disabled."""
import io
import json
import math
import os
import shutil
import sys
import tempfile
from contextlib import redirect_stdout

sys.path.insert(0, sys.argv[1])
import numpy as np  # noqa: E402
import lbtrain  # noqa: E402
import daily_cycle  # noqa: E402

CFG = {"d_model": 16}
TMP = tempfile.mkdtemp(prefix="m157c-")


def params():
    rng = np.random.Generator(np.random.PCG64(3))
    return {"h0.wqkv": rng.standard_normal((16, 48)).astype(np.float32), "h0.wo": rng.standard_normal((16, 16)).astype(np.float32),
            "h0.ln1_g": np.ones(16, np.float32), "wte": rng.standard_normal((30, 16)).astype(np.float32)}


LC = {"rank": 2, "alpha": 4.0, "targets": ["wo", "wqkv"]}


def adapter(path, base, schema=lbtrain.ADAPTER_SCHEMA, lora=None, lc=LC, sha=None):
    lora = lora if lora is not None else lbtrain.lora_init(base, lc, 1)
    sha = sha or lbtrain.params_sha256(base)
    np.savez(path, meta=np.array(json.dumps({"schema": schema, "lora": dict(lc, baseSha256=sha), "baseSha256": sha, "step": 3})),
             **{f"a.{k}": v for k, v in lora.items()})
    return path


def sym(target, link, is_dir=True):
    if is_dir:
        os.makedirs(target, exist_ok=True)
    else:
        open(target, "w").write("precious\n")
    os.makedirs(os.path.dirname(link), exist_ok=True)
    os.symlink(target, link)


class Z:  # a checkpoint-like mapping for opt_load
    def __init__(self, d):
        self.d, self.files = d, list(d)

    def __getitem__(self, k):
        return self.d[k]


def corpus(root, cleared=True):
    c = os.path.join(root, "c")
    os.makedirs(c, exist_ok=True)
    open(os.path.join(c, "docs.jsonl"), "w").write('{"doc":0,"text":"x"}\n')
    open(os.path.join(c, "manifest.jsonl"), "w").write('{"doc":0,"split":"train"}\n')
    open(os.path.join(c, "fingerprint.json"), "w").write('{"fingerprint":"f"}')
    pins = daily_cycle.corpus_pins(c)
    cfg = {"clearedCorpora": [pins] if cleared else [dict(pins, docs="0" * 64)], "daily": {"maxBudgetMin": 340, "trainArgsAllowed": ["--steps"]}}
    return c, cfg


def marker(state, save, step=4, more=True, schema="peaceai-lm-chain:v1"):
    open(os.path.join(state, "chain.json"), "w").write(json.dumps({"schema": schema, "more": more, "step": step, "save": save, "manifestSha256": "a" * 64, "stopReason": "max_steps_this_run"}))


def plan(state, cfg, c, budget="5", today="2026-10-31", targs=(), env=None):
    return daily_cycle.plan(c, state, budget, today, list(targs), cfg, env or {})


def run(name):
    st = os.path.join(TMP, "state")
    os.makedirs(st, exist_ok=True)
    # ---- M157 8-bit optimizer / config match
    if name == "opt-cfg-dict":
        return f"match={lbtrain.cfg_matches(None, {'a': 1})}"
    if name == "opt8-finite":
        lbtrain._q_signed(np.array([1.0, np.inf], np.float32))
        return "ok"
    if name == "opt8-finite-v":
        lbtrain._q_unsigned(np.array([1.0, np.inf], np.float32))
        return "ok"
    if name == "opt8-unsigned":
        q, s = lbtrain._q_unsigned(np.array([1.0, -2.0], np.float32))
        return f"ok {q.ravel()[:2].tolist()}"
    if name == "opt-name":
        lbtrain.opt_init({}, "sgd")
        return "ok"
    if name == "opt8-grad-finite":
        p = {"w": np.ones((2, 2), np.float32)}
        st8 = lbtrain.opt_init(p, "adamw8bit")
        lbtrain.adamw8_step(p, {"w": np.full((2, 2), np.nan, np.float32)}, st8, 0.1, {})
        return "ok"
    if name == "opt-load-keys":
        p = {"a": np.ones(2, np.float32), "b": np.ones(2, np.float32)}
        lbtrain.opt_load(Z({"m.a": p["a"], "v.a": p["a"]}), 1, p, "adamw")
        return "ok"
    if name == "opt8-load-keys":
        p = {"a": np.ones(2, np.float32)}
        lbtrain.opt_load(Z({"qm.a": np.zeros((1, 256), np.int8)}), 1, p, "adamw8bit")
        return "ok"
    # ---- M158 curriculum
    if name == "cur-mode":
        return f"ok {lbtrain.curriculum_cfg('hardest', 0.5, 10, 's')}"
    if name == "cur-replay":
        return f"ok {lbtrain.curriculum_cfg('easy_to_hard', 0.5, 10, 's', True)['order']}"
    if name == "cur-start":
        return f"ok {lbtrain.curriculum_cfg('easy_to_hard', 0.0, 10, 's')['start']}"
    if name == "cur-ramp":
        return f"ok {lbtrain.curriculum_cfg('easy_to_hard', 0.5, 0, 's')['ramp']}"
    if name == "cur-score":
        return f"ok {lbtrain.order_easy_to_hard([1, 2, 3], {1: 5, 2: None, 3: 1}, 's')}"
    if name == "cur-split":
        r = lbtrain.reorder_stream(np.array([5, 256, 6, 7, 256], np.uint16), [0, 1, 2], [2, 1, 0], 256)
        return f"ok {r.tolist()}"
    if name == "cur-min-window":
        return f"hi {lbtrain.curriculum_hi(0, {'start': 0.01, 'ramp': 10}, 1000, 32)}"
    # ---- M159 stop rule
    if name == "stop-patience":
        lbtrain.check_stop_args(-1, 0.0)
        return "ok"
    if name == "stop-min-delta":
        lbtrain.check_stop_args(3, -0.1)
        return "ok"
    if name == "stop-val-finite":
        return f"improved={lbtrain.improved(-math.inf, 5.0, 0.0)}"
    if name == "stop-clean-exit":
        return f"code={lbtrain.exit_code(SystemExit(0))}"
    if name == "stop-code":
        return f"code={lbtrain.exit_code(SystemExit('could not read /data/x/private.npz'))}"
    # ---- batch 6 val split (disjoint from export's eval windows)
    if name == "stop-val-split-mode":
        return f"ok {lbtrain.check_val_split('overlap', False)}"
    if name == "stop-val-split-replay":
        return f"ok {lbtrain.check_val_split('disjoint', True)}"
    if name == "stop-val-disjoint-short":
        return f"ok {lbtrain.val_window_ids('disjoint', 97 * 32 + 1 + 31, 32)}"  # 97 windows: one short of 98
    if name == "stop-val-best-split":
        return f"best={lbtrain.val_best({'val': 1.0, 'step': 4, 'stale': 2}, 'disjoint')}"
    # ---- M161 LoRA
    if name == "lora-rank":
        return f"ok {lbtrain.lora_cfg(17, 4.0, 'wo', 'base.npz', CFG)}"
    if name == "lora-alpha":
        return f"ok {lbtrain.lora_cfg(2, -1.0, 'wo', 'base.npz', CFG)}"
    if name == "lora-targets":
        return f"ok {lbtrain.lora_cfg(2, 4.0, 'wo,bogus', 'base.npz', CFG)}"
    if name == "lora-base":
        return f"ok {lbtrain.lora_cfg(2, 4.0, 'wo', '', CFG)}"
    if name == "lora-base-read":
        np.savez(os.path.join(TMP, "nop.npz"), meta=np.array("{}"))
        return f"ok {lbtrain.lora_base(os.path.join(TMP, 'nop.npz'))[1][:8]}"
    if name == "lora-bind-sha":
        return f"ok {lbtrain.lora_bind(LC, 'not-a-sha')}"
    if name == "lora-resume-base":
        b = params()
        lc = lbtrain.lora_bind(LC, lbtrain.params_sha256(b))
        b["h0.wo"] = b["h0.wo"] + 1  # the checkpoint's frozen base is not the --init-from file
        lbtrain.lora_resume_check(b, lc)
        return "ok"
    if name == "lora-trusted-sha":
        b = params()
        lbtrain.lora_merge(b, adapter(os.path.join(TMP, "a.npz"), b), None)
        return "ok"
    if name == "lora-adapter-sha":
        b = params()  # the trusted base, but an adapter that says it was trained on another base
        lbtrain.lora_merge(b, adapter(os.path.join(TMP, "a.npz"), b, sha="1" * 64), lbtrain.params_sha256(b))
        return "ok"
    if name == "lora-keys":
        b = params()
        lo = lbtrain.lora_init(b, LC, 1)
        del lo["h0.wo.A"]
        lbtrain.lora_check(b, lo, LC)
        return "ok"
    if name == "lora-shape":
        b = params()
        lo = lbtrain.lora_init(b, LC, 1)
        lo["h0.wo.B"] = np.zeros((3, 16), np.float32)
        lbtrain.lora_check(b, lo, LC)
        return "ok"
    if name == "lora-schema":
        b = params()
        lbtrain.lora_merge(b, adapter(os.path.join(TMP, "a.npz"), b, schema="other:v1"), lbtrain.params_sha256(b))
        return "ok"
    if name == "lora-base-sha":
        b = params()  # swapped base + an adapter sidecar edited to match it; the trusted record still names the old base
        trusted = lbtrain.params_sha256(b)
        b["wte"] = b["wte"] + 1
        lbtrain.lora_merge(b, adapter(os.path.join(TMP, "a.npz"), b), trusted)
        return "ok"
    if name == "lora-merge-out":
        b = params()
        np.savez(os.path.join(TMP, "base.npz"), meta=np.array(json.dumps({"cfg": {"x": 1}, "step": 3})), **{f"p.{k}": v for k, v in b.items()})
        adapter(os.path.join(TMP, "a.npz"), b)
        open(os.path.join(TMP, "out.npz"), "w").write("keep")
        buf = io.StringIO()
        with redirect_stdout(buf):
            rc = lbtrain.main(["lora-merge", os.path.join(TMP, "base.npz"), os.path.join(TMP, "a.npz"), os.path.join(TMP, "out.npz"),
                               "--base-sha", lbtrain.params_sha256(b)])
        return f"rc={rc} {buf.getvalue().strip()} kept={open(os.path.join(TMP, 'out.npz')).read() == 'keep'}"
    # ---- M160 daily cycle
    if name == "daily-corpus-cleared":
        c, cfg = corpus(TMP, cleared=False)
        return plan(st, cfg, c)
    if name == "daily-free-runner":
        c, cfg = corpus(TMP)
        return plan(st, cfg, c, env={"GITHUB_ACTIONS": "true", "RUNNER_ENVIRONMENT": "self-hosted"})
    if name == "daily-budget":
        c, cfg = corpus(TMP)
        return plan(st, cfg, c, budget="341")
    if name == "daily-date":
        c, cfg = corpus(TMP)
        return plan(st, cfg, c, today="2026-13-01")
    if name == "daily-train-args":
        c, cfg = corpus(TMP)
        return plan(st, cfg, c, targs=["--save-dir", "elsewhere"])
    if name == "daily-saves-without-chain":
        c, cfg = corpus(TMP)
        os.makedirs(os.path.join(st, "saves", "save-000000004"))
        return plan(st, cfg, c)
    if name == "daily-chain-schema":
        c, cfg = corpus(TMP)
        os.makedirs(os.path.join(st, "saves", "save-000000004"))
        marker(st, "save-000000004", more=False, schema="other:v1")
        return plan(st, cfg, c)
    if name == "daily-latest-save":
        c, cfg = corpus(TMP)
        for n in ("save-000000004", "save-000000006"):
            os.makedirs(os.path.join(st, "saves", n))
        marker(st, "save-000000004")
        return plan(st, cfg, c)
    if name == "daily-once":
        c, cfg = corpus(TMP)
        os.makedirs(os.path.join(st, "reports"))
        open(os.path.join(st, "reports", "2026-10-31.json"), "w").write("{}")
        return plan(st, cfg, c)
    if name == "daily-state-symlink":
        c, cfg = corpus(TMP)
        sym(os.path.join(TMP, "elsewhere"), os.path.join(TMP, "state-link"))
        return plan(os.path.join(TMP, "state-link"), cfg, c)
    if name == "daily-sub-symlink":
        c, cfg = corpus(TMP)
        sym(os.path.join(TMP, "elsewhere"), os.path.join(st, "reports"))
        return plan(st, cfg, c)
    if name == "daily-chain-symlink":
        c, cfg = corpus(TMP)
        os.makedirs(os.path.join(st, "saves", "save-000000004"))
        os.makedirs(os.path.join(TMP, "elsewhere"))
        marker(os.path.join(TMP, "elsewhere"), "save-000000004")
        os.symlink(os.path.join(TMP, "elsewhere", "chain.json"), os.path.join(st, "chain.json"))
        return plan(st, cfg, c)
    if name == "daily-save-symlink":
        c, cfg = corpus(TMP)
        sym(os.path.join(TMP, "elsewhere"), os.path.join(st, "saves", "save-000000004"))
        marker(st, "save-000000004")
        return plan(st, cfg, c)
    if name == "daily-logs-exist":
        c, cfg = corpus(TMP)
        sym(os.path.join(TMP, "precious.txt"), os.path.join(st, "logs", "2026-10-31.log"), is_dir=False)
        return plan(st, cfg, c)
    # ---- near misses (must pass with the real code)
    if name == "near-daily-state":
        c, cfg = corpus(TMP)
        for d in ("saves", "work", "reports", "logs"):
            os.makedirs(os.path.join(st, d), exist_ok=True)
        for n in ("2026-10-30.log", "2026-10-30.err", "2026-10-310.log"):
            open(os.path.join(st, "logs", n), "w").write("")
        sym(os.path.join(TMP, "elsewhere"), os.path.join(st, "notes"))  # not a path the cycle writes through
        return plan(st, cfg, c)
    if name == "near-cfg":
        d = {"a": 1, "total_steps": 5}
        return (f"ok {lbtrain.cfg_matches(d, {'a': 1, 'total_steps': 9})} {lbtrain.cfg_matches(d, {'a': 1, 'total_steps': 5, 'optimizer': 'adamw8bit'})}"
                f" {lbtrain.cfg_matches(dict(d, optimizer='adamw8bit'), {'a': 1, 'total_steps': 5})} {lbtrain.cfg_matches(d, {'a': 2, 'total_steps': 5})}")
    if name == "near-stop-code":
        return " ".join(str(lbtrain.exit_code(e)) for e in (SystemExit("REPLAY_REFUSED: /data/x"), SystemExit("SAVE_FILE_SET"), SystemExit(None),
                                                             SystemExit(2), ValueError("x"), KeyboardInterrupt()))
    if name == "near-daily-fresh":
        c, cfg = corpus(TMP)
        return plan(st, cfg, c, targs=["--steps", "8"])
    if name == "near-daily-resume":
        c, cfg = corpus(TMP)
        for n in ("save-000000002", "save-000000004"):
            os.makedirs(os.path.join(st, "saves", n))
        marker(st, "save-000000004")
        return plan(st, cfg, c, env={"GITHUB_ACTIONS": "true", "RUNNER_ENVIRONMENT": "github-hosted"})
    if name == "near-daily-done":
        c, cfg = corpus(TMP)
        os.makedirs(os.path.join(st, "saves", "save-000000008"))
        marker(st, "save-000000008", step=8, more=False)
        return plan(st, cfg, c, budget="340")
    if name == "near-lora-merge":
        b = params()
        lo = lbtrain.lora_init(b, LC, 1)
        lo = {k: (v + 0.5 if k.endswith(".B") else v) for k, v in lo.items()}
        m, meta = lbtrain.lora_merge(b, adapter(os.path.join(TMP, "a.npz"), b, lora=lo), lbtrain.params_sha256(b))
        return f"ok changed={sorted(k for k in b if not np.array_equal(b[k], m[k]))}"
    if name == "near-cur":
        return f"ok {lbtrain.curriculum_cfg('easy_to_hard', 1.0, 1, 's')['start']} {lbtrain.order_easy_to_hard([1, 2, 3], {1: 5, 2: 5.5, 3: 1}, 's')}"
    if name == "near-val-split":
        T = 32
        out = [lbtrain.check_val_split("first", True), lbtrain.check_val_split("disjoint", False)]
        for n_tok in (98 * T + 1, 200 * T + 1, 1225844):
            ids = lbtrain.val_window_ids("disjoint", n_tok, T)
            n = (n_tok - 1) // T
            ev = range(min(n, lbtrain.EXPORT_EVAL_WINDOWS))  # export.py's eval windows
            used = lambda ks: {t for k in ks for t in range(k * T, k * T + T + 1)}  # noqa: E731  (window k reads held[kT .. kT+T])
            out.append(f"{ids[0]}..{ids[-1]}:{len(ids)}:shared={len(used(ids) & used(ev))}")
        out.append(f"w96shared={len(used([96]) & used(range(96)))}")  # why the gap: window 96 starts on export's last target token
        legacy = lbtrain.val_window_ids("first", 200 * T + 1, T)
        out.append(f"first={legacy[0]}..{legacy[-1]}:shared={len({k for k in legacy} & set(range(96)))}")
        out.append(f"same={lbtrain.val_best({'val': 1.0, 'step': 4, 'stale': 2, 'valSplit': 'disjoint'}, 'disjoint')['step']}")
        out.append(f"legacy={lbtrain.val_best({'val': 1.0, 'step': 4, 'stale': 2}, 'first')['step']}")
        out.append(f"none={lbtrain.val_best(None, 'first')}")
        return "ok " + " ".join(str(x) for x in out)
    if name == "near-stop":
        lbtrain.check_stop_args(0, 0.0)
        return f"ok {lbtrain.improved(4.9, 5.0, 0.1)} {lbtrain.improved(4.89, 5.0, 0.1)} {lbtrain.improved(4.99, 5.0, 0.0)}"
    raise SystemExit(f"unknown case {name}")


try:
    out = run(sys.argv[2])
except (lbtrain.LbError, daily_cycle.DailyError) as e:
    out = e.code
except Exception as e:  # noqa: BLE001
    out = f"crash {type(e).__name__}"
finally:
    shutil.rmtree(TMP, ignore_errors=True)
print(out)
