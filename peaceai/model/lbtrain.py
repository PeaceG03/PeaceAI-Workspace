"""Limit-breaker training steps 3-7 (M157-M161), used by train.py and daily_cycle.py. numpy only, seeded, CPU.

Every option is OFF by default and adds nothing to the training config when off, so a default run (and every
existing save, resume and fingerprint) is byte-for-byte unchanged. When an option is on it is recorded in the config
(cfg: optimizer, curriculum, lora), which saves.py binds into every save manifest (cfgSha256) and which a
resume must match exactly, and in run.json (the run fingerprint: cfgSha256, dataSha256 and the stop rule).

  M157 8-bit opt   --optimizer adamw|adamw8bit (default adamw). adamw8bit keeps the Adam moments block-wise
                   quantized between steps (m: int8 absmax per block, v: uint8 of sqrt(v), absmax per block, block
                   256), about 1/4 of the fp32 optimizer-state memory and checkpoint bytes. Precision is fp32 only
                   (Auditor ruling on #654: the emulated bfloat16 option was dropped; numpy has no native one).
  M158 curriculum  --curriculum easy_to_hard: train docs ordered by lb-clean's difficulty.score (manifest), ties by
                   sha256(seed:doc); batches are drawn from the easiest prefix of the token stream, growing linearly
                   from --curriculum-start (fraction) to all of it at --curriculum-ramp steps. Seeded, recorded.
  M159 stop rule   --patience N evals without an improvement of more than --min-delta (default 0 = the old strict
                   rule), a non-finite loss stops at once (no update applied), plus the existing --steps,
                   --max-seconds and --deadline budgets. stop.json records why it stopped, on EVERY run: a stale one
                   is removed first and a refusal / crash writes reason "error" with its fixed code.
  M160 daily cycle daily_cycle.py (separate file).
  M161 LoRA        --lora-rank R --lora-alpha A --lora-targets wqkv,wo,w1,w2 with --init-from BASE (on EVERY run,
                   resumes included): the base weights are frozen, W_eff = W + (A/R) * La @ Lb is trained through La
                   (d_in x R) and Lb (R x d_out, zero at start, so step 0 is exactly the base). The params_sha256 of
                   the actual BASE file is bound into cfg.lora.baseSha256 (so into cfgSha256, every save manifest and
                   the chain marker), and a resume compares the checkpoint's frozen weights with that file's hash.
                   Adapters are saved separately (adapter.npz, best-adapter.npz); best.npz is the MERGED model, so
                   export/eval read it unchanged; lbtrain.py lora-merge BASE ADAPTER OUT --base-sha SHA merges an
                   adapter for eval, where SHA comes from a trusted record (the save manifest / run.json cfg), never
                   taken from the adapter file itself.

Refusals raise LbError(code) (one fixed code, no paths or text). Guards are tagged `# guard:<name>` and
mutation-checked by peaceai/test/m157..m161 (disabling any one changes its case's outcome).
"""
import hashlib
import json
import math
import os
import re
import sys

import numpy as np

RUN_SCHEMA = "peaceai-lb-run:v1"
STOP_SCHEMA = "peaceai-lb-stop:v1"
ADAPTER_SCHEMA = "peaceai-lora:v1"
OPTIMIZERS = ("adamw", "adamw8bit")
LORA_TARGETS = ("wqkv", "wo", "w1", "w2")
BLOCK = 256
SHA_RE = re.compile(r"^[0-9a-f]{64}$")
CODE_RE = re.compile(r"^[A-Z][A-Z0-9_]{2,80}$")


class LbError(Exception):
    def __init__(self, code):
        super().__init__(code)
        self.code = code


def canonical(o):
    return json.dumps(o, sort_keys=True, separators=(",", ":"))


def sha256_bytes(b):
    return hashlib.sha256(b).hexdigest()


def finite_num(x):
    return isinstance(x, (int, float)) and not isinstance(x, bool) and math.isfinite(x)


# ---------------------------------------------------------------- M157 8-bit optimizer (precision is fp32 only)

def cfg_matches(saved, cur):
    """A work-dir checkpoint's cfg equals this run's cfg on EVERY key of either side except total_steps (a key on one
    side only, e.g. optimizer=adamw8bit against a default checkpoint, is a mismatch, never a KeyError)."""
    if not isinstance(saved, dict):  # guard:opt-cfg-dict
        return False
    keys = sorted((set(saved) | set(cur)) - {"total_steps"})
    return all(canonical(saved.get(k)) == canonical(cur.get(k)) for k in keys)


def _q_signed(x):
    flat = x.astype(np.float32).ravel()
    n = flat.size
    pad = (-n) % BLOCK
    blocks = np.concatenate([flat, np.zeros(pad, np.float32)]).reshape(-1, BLOCK)
    scale = np.abs(blocks).max(1) / 127.0
    if not np.isfinite(scale).all():  # guard:opt8-finite
        raise LbError("OPT8_NONFINITE")
    safe = np.where(scale > 0, scale, 1.0)  # an all-zero block: scale 0, codes 0
    q = np.clip(np.rint(blocks / safe[:, None]), -127, 127).astype(np.int8)
    return q, scale.astype(np.float32)


def _dq_signed(q, scale, shape):
    n = int(np.prod(shape))
    return (q.astype(np.float32) * scale[:, None]).ravel()[:n].reshape(shape)


def _q_unsigned(x):
    flat = x.astype(np.float32).ravel()
    if (flat < 0).any():  # guard:opt8-unsigned
        raise LbError("OPT8_NEGATIVE")
    n = flat.size
    pad = (-n) % BLOCK
    blocks = np.concatenate([flat, np.zeros(pad, np.float32)]).reshape(-1, BLOCK)
    scale = blocks.max(1) / 255.0
    if not np.isfinite(scale).all():  # guard:opt8-finite-v
        raise LbError("OPT8_NONFINITE")
    safe = np.where(scale > 0, scale, 1.0)  # an all-zero block: scale 0, codes 0
    q = np.clip(np.rint(blocks / safe[:, None]), 0, 255).astype(np.uint8)
    return q, scale.astype(np.float32)


def opt_init(trainable, optimizer):
    if optimizer not in OPTIMIZERS:  # guard:opt-name
        raise LbError("OPTIMIZER_BAD")
    if optimizer == "adamw":
        return {"t": 0, "m": {k: np.zeros_like(v) for k, v in trainable.items()}, "v": {k: np.zeros_like(v) for k, v in trainable.items()}}
    st = {"t": 0, "q": {}}
    for k, v in trainable.items():
        z = np.zeros(v.shape, np.float32)
        mq, ms = _q_signed(z)
        vq, vs = _q_unsigned(z)
        st["q"][k] = {"mq": mq, "ms": ms, "vq": vq, "vs": vs}
    return st


def adamw8_step(p, g, st, lr, cfg):
    """lm.adamw_step's math (b1 .9, b2 .95, global-norm clip, decoupled decay on matrices) with 8-bit moments."""
    b1, b2, eps, wd = 0.9, 0.95, 1e-8, cfg.get("weight_decay", 0.1)
    norm = math.sqrt(sum(float((v.astype(np.float64) ** 2).sum()) for v in g.values()))
    if not math.isfinite(norm):  # guard:opt8-grad-finite
        raise LbError("OPT8_GRAD_NONFINITE")
    clip = min(1.0, cfg.get("grad_clip", 1.0) / (norm + 1e-6))
    st["t"] += 1
    t = st["t"]
    for k in sorted(p):
        q = st["q"][k]
        gk = g[k] * clip
        m = _dq_signed(q["mq"], q["ms"], p[k].shape) * b1 + (1 - b1) * gk
        sv = _dq_signed(q["vq"].astype(np.int16), q["vs"], p[k].shape)
        v = sv * sv * b2 + (1 - b2) * gk * gk
        mh = m / (1 - b1 ** t)
        vh = v / (1 - b2 ** t)
        if p[k].ndim == 2:
            p[k] *= (1 - lr * wd)
        p[k] -= (lr * mh / (np.sqrt(vh) + eps)).astype(np.float32)
        q["mq"], q["ms"] = _q_signed(m)
        q["vq"], q["vs"] = _q_unsigned(np.sqrt(np.maximum(v, 0.0)))
    return norm


def opt_arrays(st, keys=None):
    """Checkpoint arrays of the optimizer state, in `keys` order (train.py passes its trainable order: for adamw this
    is exactly the old m.<k>... then v.<k>... layout)."""
    if "q" not in st:
        keys = list(st["m"]) if keys is None else keys
        out = {f"m.{k}": st["m"][k] for k in keys}
        out.update({f"v.{k}": st["v"][k] for k in keys})
        return out
    out = {}
    for k in (list(st["q"]) if keys is None else keys):
        q = st["q"][k]
        out.update({f"qm.{k}": q["mq"], f"qms.{k}": q["ms"], f"qv.{k}": q["vq"], f"qvs.{k}": q["vs"]})
    return out


def opt_load(z, t, trainable, optimizer):
    """Optimizer state from a checkpoint's arrays; the key set must be exactly the trainable set."""
    if optimizer == "adamw":
        st = {"t": t, "m": {k[2:]: z[k] for k in z.files if k.startswith("m.")}, "v": {k[2:]: z[k] for k in z.files if k.startswith("v.")}}
        if sorted(st["m"]) != sorted(trainable) or sorted(st["v"]) != sorted(trainable):  # guard:opt-load-keys
            raise LbError("CHECKPOINT_OPT_MISMATCH")
        return st
    st = {"t": t, "q": {}}
    for k in trainable:
        need = (f"qm.{k}", f"qms.{k}", f"qv.{k}", f"qvs.{k}")
        if any(n not in z.files for n in need):  # guard:opt8-load-keys
            raise LbError("CHECKPOINT_OPT_MISMATCH")
        st["q"][k] = {"mq": z[need[0]], "ms": z[need[1]], "vq": z[need[2]], "vs": z[need[3]]}
    return st


def opt_state_bytes(st):
    return int(sum(a.nbytes for a in opt_arrays(st).values()))


# ---------------------------------------------------------------- M158 easy-to-hard curriculum

def curriculum_cfg(mode, start, ramp, seed, replay=False):
    if mode not in ("", "easy_to_hard"):  # guard:cur-mode
        raise LbError("CURRICULUM_BAD_ARGS")
    if not mode:
        return None
    if replay:  # guard:cur-replay
        raise LbError("CURRICULUM_WITH_REPLAY")
    if not finite_num(start) or not (0.0 < start <= 1.0):  # guard:cur-start
        raise LbError("CURRICULUM_BAD_ARGS")
    if not isinstance(ramp, int) or isinstance(ramp, bool) or ramp < 1:  # guard:cur-ramp
        raise LbError("CURRICULUM_BAD_ARGS")
    return {"order": "easy_to_hard", "score": "lb-clean difficulty.score", "start": float(start), "ramp": int(ramp), "seed": str(seed)}


def order_easy_to_hard(ids, score, seed):
    """Train doc ids sorted by (difficulty score, sha256(seed:doc)). Every id needs a finite numeric score."""
    for i in ids:
        s = score.get(i)
        if not finite_num(s):  # guard:cur-score
            raise LbError("CURRICULUM_NO_DIFFICULTY")
    return sorted(ids, key=lambda i: (score[i], sha256_bytes(f"{seed}:{i}".encode())))


def reorder_stream(tok, ids, order, eod):
    """The train token stream (docs in `ids` order, each ending with eod) re-laid in `order`; eod never occurs inside
    a doc (merged ids start above it), so the split is exact. The cached tokens_train.npy itself is never changed."""
    ends = np.flatnonzero(tok == eod)
    if len(ends) != len(ids):  # guard:cur-split
        raise LbError("CURRICULUM_STREAM_MISMATCH")
    starts = np.concatenate([[0], ends[:-1] + 1])
    at = {i: n for n, i in enumerate(ids)}
    return np.concatenate([tok[starts[at[i]]:ends[at[i]] + 1] for i in order]) if order else tok[:0]


def curriculum_hi(step, ccfg, n_tokens, T):
    """Exclusive upper bound of the token prefix batches may draw from at `step` (always room for one window)."""
    frac = min(1.0, ccfg["start"] + (1.0 - ccfg["start"]) * step / ccfg["ramp"])
    hi = int(math.ceil(frac * n_tokens))
    if hi < T + 2:  # guard:cur-min-window
        hi = T + 2
    return min(hi, n_tokens)


# ---------------------------------------------------------------- M159 stop rule

def check_stop_args(patience, min_delta):
    if not isinstance(patience, int) or isinstance(patience, bool) or patience < 0:  # guard:stop-patience
        raise LbError("STOP_BAD_ARGS")
    if not finite_num(min_delta) or min_delta < 0:  # guard:stop-min-delta
        raise LbError("STOP_BAD_ARGS")


def improved(val, best_val, min_delta):
    """A held-out loss improves only when finite and lower than best by MORE than min_delta (0 = strictly lower)."""
    if not finite_num(val):  # guard:stop-val-finite
        return False
    return val < best_val - min_delta


def loss_ok(loss):
    """A non-finite training loss stops the run before its update is applied (stop reason "nonfinite")."""
    return finite_num(loss)


def stop_record(reason, step, total, best, last_val, patience, min_delta, max_seconds, elapsed):
    return {"schema": STOP_SCHEMA, "reason": reason, "step": int(step), "totalSteps": int(total), "bestStep": int(best["step"]),
            "bestVal": best["val"] if finite_num(best["val"]) else None, "lastVal": last_val, "stale": int(best.get("stale", 0)),
            "patience": int(patience), "minDelta": float(min_delta), "maxSeconds": float(max_seconds), "elapsedSeconds": round(float(elapsed), 1)}


def exit_code(e):
    """The fixed code a train.py exit carries (None for a clean exit). A SystemExit("CODE: detail") keeps only CODE;
    anything that is not a fixed code (free text, paths) becomes TRAIN_ERROR, so stop.json never holds paths or text."""
    if isinstance(e, SystemExit):
        if e.code is None or e.code == 0:  # guard:stop-clean-exit
            return None
        c = str(e.code).split(":")[0].strip()
        if not CODE_RE.match(c):  # guard:stop-code
            return "TRAIN_ERROR"
        return c
    if isinstance(e, KeyboardInterrupt):
        return "INTERRUPTED"
    return "TRAIN_CRASH"


def error_stop_record(code, step):
    return {"schema": STOP_SCHEMA, "reason": "error", "code": code, "step": step if isinstance(step, int) and not isinstance(step, bool) else None}


def write_stop(path, rec):
    """stop.json is created exclusively (O_EXCL: never through a symlink, never over a stale file train.py did not
    remove at its start)."""
    with open(path, "x", encoding="ascii") as f:
        f.write(canonical(rec) + "\n")


# ---------------------------------------------------------------- M161 LoRA

def lora_cfg(rank, alpha, targets, init_from, cfg):
    if not rank:
        return None
    d = cfg["d_model"]
    if not isinstance(rank, int) or isinstance(rank, bool) or rank < 1 or rank > d:  # guard:lora-rank
        raise LbError("LORA_BAD_RANK")
    if not finite_num(alpha) or alpha <= 0:  # guard:lora-alpha
        raise LbError("LORA_BAD_ALPHA")
    tl = [t for t in str(targets).split(",") if t]
    if not tl or len(set(tl)) != len(tl) or any(t not in LORA_TARGETS for t in tl):  # guard:lora-targets
        raise LbError("LORA_BAD_TARGETS")
    if not init_from:  # guard:lora-base
        raise LbError("LORA_NEEDS_BASE")  # every LoRA run, resumes included: the base file is the hash anchor
    return {"rank": int(rank), "alpha": float(alpha), "targets": sorted(tl)}


def lora_base(path):
    """The base weights (p.* of BASE.npz) and their params_sha256: the anchor the adapters are bound to."""
    try:
        with np.load(path, allow_pickle=False) as z:
            base = {k[2:]: z[k].astype(np.float32) for k in z.files if k.startswith("p.")}
    except Exception:
        raise LbError("LORA_BASE_READ")
    if not base:  # guard:lora-base-read
        raise LbError("LORA_BASE_READ")
    return base, params_sha256(base)


def lora_bind(lcfg, base_sha):
    """cfg.lora with the base's params_sha256 in it, so cfgSha256 / every save manifest / the chain marker bind it."""
    if not SHA_RE.match(str(base_sha)):  # guard:lora-bind-sha
        raise LbError("LORA_BASE_READ")
    return dict(lcfg, baseSha256=base_sha)


def lora_resume_check(params, lcfg):
    """On resume the checkpoint's frozen weights must hash to the actual --init-from file's hash (cfg.lora.baseSha256),
    never to a value read from the checkpoint or an adapter sidecar."""
    if params_sha256(params) != lcfg.get("baseSha256"):  # guard:lora-resume-base
        raise LbError("LORA_BASE_MISMATCH")


def lora_keys(params, lcfg):
    return sorted(k for k in params if params[k].ndim == 2 and k.split(".")[-1] in lcfg["targets"] and k.startswith("h"))


def lora_init(params, lcfg, seed):
    rng = np.random.Generator(np.random.PCG64(seed + 7))
    out = {}
    for k in lora_keys(params, lcfg):
        din, dout = params[k].shape
        out[f"{k}.A"] = (rng.standard_normal((din, lcfg["rank"])) / math.sqrt(din)).astype(np.float32)
        out[f"{k}.B"] = np.zeros((lcfg["rank"], dout), np.float32)
    return out


def lora_check(params, lora, lcfg):
    want = sorted([f"{k}.A" for k in lora_keys(params, lcfg)] + [f"{k}.B" for k in lora_keys(params, lcfg)])
    if sorted(lora) != want:  # guard:lora-keys
        raise LbError("LORA_SHAPE")
    for k in lora_keys(params, lcfg):
        din, dout = params[k].shape
        if lora[f"{k}.A"].shape != (din, lcfg["rank"]) or lora[f"{k}.B"].shape != (lcfg["rank"], dout):  # guard:lora-shape
            raise LbError("LORA_SHAPE")


def lora_effective(params, lora, lcfg):
    s = lcfg["alpha"] / lcfg["rank"]
    out = dict(params)
    for k in lora_keys(params, lcfg):
        out[k] = (params[k] + s * (lora[f"{k}.A"] @ lora[f"{k}.B"])).astype(np.float32)
    return out


def lora_grads(g, lora, lcfg, params):
    """d/dLa = s * dW @ Lb^T, d/dLb = s * La^T @ dW (dW = the gradient of the effective weight); base gets none."""
    s = lcfg["alpha"] / lcfg["rank"]
    out = {}
    for k in lora_keys(params, lcfg):
        out[f"{k}.A"] = (s * (g[k] @ lora[f"{k}.B"].T)).astype(np.float32)
        out[f"{k}.B"] = (s * (lora[f"{k}.A"].T @ g[k])).astype(np.float32)
    return out


def params_sha256(params):
    h = hashlib.sha256()
    for k in sorted(params):
        a = np.ascontiguousarray(params[k], dtype=np.float32)
        h.update(k.encode() + b"\0" + str(a.shape).encode() + b"\0" + a.tobytes())
    return h.hexdigest()


def save_adapter(path, lora, lcfg, base_sha, step):
    meta = {"schema": ADAPTER_SCHEMA, "lora": lcfg, "baseSha256": base_sha, "step": int(step)}
    tmp = path + ".tmp.npz"
    np.savez(tmp, meta=np.array(canonical(meta)), **{f"a.{k}": lora[k] for k in sorted(lora)})
    os.replace(tmp, path)


def load_adapter(path):
    try:
        with np.load(path, allow_pickle=False) as z:
            meta = json.loads(str(z["meta"]))
            lora = {k[2:]: z[k].astype(np.float32) for k in z.files if k.startswith("a.")}
    except Exception:
        raise LbError("LORA_SCHEMA")
    if not isinstance(meta, dict) or meta.get("schema") != ADAPTER_SCHEMA or not isinstance(meta.get("lora"), dict):  # guard:lora-schema
        raise LbError("LORA_SCHEMA")
    return meta, lora


def lora_merge(base_params, adapter_path, trusted_sha):
    """Merged fp32 weights for eval. trusted_sha is the base hash from a TRUSTED record (cfg.lora.baseSha256 of the
    sha-verified save manifest or run.json), never from the adapter: the actual base file must hash to it, and the
    adapter must say it was trained on it."""
    if not SHA_RE.match(str(trusted_sha)):  # guard:lora-trusted-sha
        raise LbError("LORA_BASE_SHA_REQUIRED")
    if params_sha256(base_params) != trusted_sha:  # guard:lora-base-sha
        raise LbError("LORA_BASE_MISMATCH")
    meta, lora = load_adapter(adapter_path)
    if meta.get("baseSha256") != trusted_sha or meta["lora"].get("baseSha256") != trusted_sha:  # guard:lora-adapter-sha
        raise LbError("LORA_ADAPTER_MISMATCH")
    lora_check(base_params, lora, meta["lora"])
    return lora_effective(base_params, lora, meta["lora"]), meta


def load_params(path):
    with np.load(path, allow_pickle=False) as z:
        return {k[2:]: z[k].astype(np.float32) for k in z.files if k.startswith("p.")}, (str(z["meta"]) if "meta" in z.files else None)


# ---------------------------------------------------------------- fingerprint

def run_record(cfg, data_sha, stop):
    rec = {"schema": RUN_SCHEMA, "cfg": cfg, "cfgSha256": sha256_bytes(canonical(cfg).encode()), "dataSha256": data_sha,
           "optimizer": cfg.get("optimizer", "adamw"),
           "curriculum": cfg.get("curriculum"), "lora": cfg.get("lora"), "stop": stop}
    if cfg.get("lora"):
        rec["loraBaseSha256"] = cfg["lora"]["baseSha256"]
    return rec


def main(argv):
    try:
        if argv[:1] == ["lora-merge"] and len(argv) in (4, 6):
            trusted = argv[5] if len(argv) == 6 and argv[4] == "--base-sha" else None
            base, base_meta = load_params(argv[1])
            merged, meta = lora_merge(base, argv[2], trusted)
            if os.path.exists(argv[3]):  # guard:lora-merge-out
                raise LbError("LORA_OUT_EXISTS")
            out_meta = json.loads(base_meta) if base_meta else {}
            out_meta["loraMerged"] = {"lora": meta["lora"], "baseSha256": meta["baseSha256"], "step": meta.get("step")}
            with open(argv[3], "xb") as f:
                np.savez(f, meta=np.array(canonical(out_meta)), **{f"p.{k}": merged[k] for k in sorted(merged)})
            print(f"lora merged rank={meta['lora']['rank']} targets={','.join(meta['lora']['targets'])} step={meta.get('step')}")
            return 0
    except LbError as e:
        print(e.code)
        return 3
    print("usage: lbtrain.py lora-merge BASE.npz ADAPTER.npz OUT.npz --base-sha SHA")
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
