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


def adapter(path, base, schema=lbtrain.ADAPTER_SCHEMA, lora=None, lc=LC):
    lora = lora if lora is not None else lbtrain.lora_init(base, lc, 1)
    np.savez(path, meta=np.array(json.dumps({"schema": schema, "lora": lc, "baseSha256": lbtrain.params_sha256(base), "step": 3})),
             **{f"a.{k}": v for k, v in lora.items()})
    return path


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
    # ---- M157 precision / 8-bit
    if name == "prec-name":
        return lbtrain.resolve_precision("fp16")
    if name == "prec-nan":
        x = np.array([0x7FFFFFFF], np.uint32).view(np.float32)
        return "nan" if np.isnan(lbtrain.bf16_round(x)[0]) else f"not-nan {lbtrain.bf16_round(x)[0]}"
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
    # ---- M161 LoRA
    if name == "lora-rank":
        return f"ok {lbtrain.lora_cfg(17, 4.0, 'wo', 'base.npz', False, CFG)}"
    if name == "lora-alpha":
        return f"ok {lbtrain.lora_cfg(2, -1.0, 'wo', 'base.npz', False, CFG)}"
    if name == "lora-targets":
        return f"ok {lbtrain.lora_cfg(2, 4.0, 'wo,bogus', 'base.npz', False, CFG)}"
    if name == "lora-base":
        return f"ok {lbtrain.lora_cfg(2, 4.0, 'wo', '', False, CFG)}"
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
        lbtrain.lora_merge(b, adapter(os.path.join(TMP, "a.npz"), b, schema="other:v1"))
        return "ok"
    if name == "lora-base-sha":
        b = params()
        path = adapter(os.path.join(TMP, "a.npz"), b)
        b["wte"] = b["wte"] + 1
        lbtrain.lora_merge(b, path)
        return "ok"
    if name == "lora-merge-out":
        b = params()
        np.savez(os.path.join(TMP, "base.npz"), meta=np.array(json.dumps({"cfg": {"x": 1}, "step": 3})), **{f"p.{k}": v for k, v in b.items()})
        adapter(os.path.join(TMP, "a.npz"), b)
        open(os.path.join(TMP, "out.npz"), "w").write("keep")
        buf = io.StringIO()
        with redirect_stdout(buf):
            rc = lbtrain.main(["lora-merge", os.path.join(TMP, "base.npz"), os.path.join(TMP, "a.npz"), os.path.join(TMP, "out.npz")])
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
    # ---- near misses (must pass with the real code)
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
        m, meta = lbtrain.lora_merge(b, adapter(os.path.join(TMP, "a.npz"), b, lora=lo))
        return f"ok changed={sorted(k for k in b if not np.array_equal(b[k], m[k]))}"
    if name == "near-cur":
        return f"ok {lbtrain.curriculum_cfg('easy_to_hard', 1.0, 1, 's')['start']} {lbtrain.order_easy_to_hard([1, 2, 3], {1: 5, 2: 5.5, 3: 1}, 's')}"
    if name == "near-stop":
        lbtrain.check_stop_args(0, 0.0)
        return f"ok {lbtrain.improved(4.9, 5.0, 0.1)} {lbtrain.improved(4.89, 5.0, 0.1)} {lbtrain.improved(4.99, 5.0, 0.0)}"
    if name == "near-prec":
        return f"ok {lbtrain.resolve_precision('auto')} {lbtrain.resolve_precision('bf16')} {lbtrain.resolve_precision('fp32')}"
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
