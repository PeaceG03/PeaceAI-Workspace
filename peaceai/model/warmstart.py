"""lb-chain2 v1 + v2: the full-model warm start of train.py (spec peaceai/spec/lb-chain2-v1.md, section v2).

train.py --warm-start-from SAVE --warm-start-manifest-sha SHA starts a NEW run (step 0, fresh optimizer state, fresh
RNG) from the weights and the tokenizer of one VERIFIED save (saves.verify_save: the manifest sha256, every file's
sha256 and size, no extra or missing file, the checkpoint step and config). It is the only way a run starts from
another run's weights without LoRA: --init-from stays the LoRA base (and the M49 fine-tune path), and --resume-from
still refuses a different DATA_SHA. The tokenizer is the save's own, so the held-out docs of the old split tokenize to
the same stream and the held-out bpb series stays comparable.

The save's manifest sha256 is recorded in the run config (cfg.warmStart.manifestSha256), so it is in cfgSha256, in
every save manifest of the new chain and in the resume check: a later day resumes with --warm-start-manifest-sha SHA
alone (no --warm-start-from; resume wins) and a resume that drops or changes it is SAVE_CONFIG_MISMATCH.

Refusals (one fixed code each, nothing trained): WARM_START_SHA_REQUIRED, WARM_START_CONFLICT (with --init-from,
LoRA or replay), WARM_START_WITH_RESUME (both --warm-start-from and --resume-from), WARM_START_NEEDS_SAVE (a sha with
no save and no resume), WARM_START_SAVE_* (the save fails verify_save), WARM_START_LORA_SAVE, WARM_START_WORK_NOT_EMPTY,
WARM_START_SHAPE_MISMATCH (model shape or parameter set), WARM_START_FILE_SHA (a file changed after verification).

v2 (Auditor, run 41686765194: chain-2 day 1 regressed because step 0 was never scored, best started at inf and the LR
re-warmed to 5x chain 1's final LR with a fresh optimizer):
- the weights are the save's best.npz (the model of record: the one export.py scored for the Results row) when the
  save has one, else its checkpoint.npz; the optimizer state (AdamW / 8-bit moments and t) is KEPT from the save's
  checkpoint.npz (same optimizer required: WARM_START_OPT_MISMATCH);
- --warm-start-expect BPB:TOKENS:BYTES:TOL is required with --warm-start-from (WARM_START_EXPECT_REQUIRED /
  WARM_START_EXPECT_BAD): before any training step the step-0 model is scored exactly as export.py scores a model
  (fp16 weights, at most 96 non-overlapping ctx windows of the held-out stream) and must reproduce the recorded
  held-out bpb within TOL on the same split (WARM_START_STEP0_SPLIT / WARM_START_STEP0_MISMATCH);
- best is seeded with the step-0 val loss (seed_best), so a later eval becomes best only by beating step 0;
- the LR may not re-warm: warmup 0 and a peak LR at or below the save's own final LR (lr_at(step - 1) of the save's
  cfg) (WARM_START_LR_REWARM / WARM_START_LR_ABOVE_FINAL);
- batch 19: the weights and the kept optimizer state must be from the same step (best.npz meta step and t equal to
  checkpoint.npz's, which is the save's step): WARM_START_STEP_MISMATCH (check_same_step). Later days resume from the
  chain-2 save's last checkpoint.npz (weights and optimizer from one file), not from its best.npz.
Standard library only at import time (numpy is passed in by train.py)."""
import math
import os
import re
import shutil

import saves

SHA_RE = re.compile(r"^[0-9a-f]{64}\Z")
EXPECT_RE = re.compile(r"^([0-9]+\.[0-9]+):([1-9][0-9]{0,9}):([1-9][0-9]{0,9}):([0-9]+\.[0-9]+)\Z")
MAX_TOL = 0.002
MAX_WINDOWS = 96  # export.py's held-out eval
SHAPE_KEYS = ("schema", "d_model", "n_head", "n_layer", "vocab_size", "ctx")
WORK_FILES = ("checkpoint.npz", "tokenizer.json", "tokens_train.npy", "tokens_heldout.npy", "best.npz", "best.json", "metrics.jsonl")


class WarmError(Exception):
    def __init__(self, code):
        super().__init__(code)
        self.code = code


def check_args(from_dir, sha, resume_from, init_from, lora_rank, replay):
    """None when warm start is off; else the cfg.warmStart record."""
    if not from_dir and not sha:
        return None
    if not isinstance(sha, str) or not SHA_RE.match(sha):  # guard:ws-sha-format
        raise WarmError("WARM_START_SHA_REQUIRED")
    if init_from or lora_rank or replay:  # guard:ws-conflict
        raise WarmError("WARM_START_CONFLICT")
    if resume_from and from_dir:  # guard:ws-with-resume
        raise WarmError("WARM_START_WITH_RESUME")
    if not resume_from and not from_dir:  # guard:ws-needs-save
        raise WarmError("WARM_START_NEEDS_SAVE")
    return {"manifestSha256": sha}


def verify(from_dir, sha, work):
    """The save, fully verified, before anything is read from it; the work dir holds no earlier run."""
    try:
        man = saves.verify_save(from_dir, sha)
    except saves.SaveError as e:
        raise WarmError("WARM_START_" + e.code)
    if "lora" in man["cfg"]:  # guard:ws-lora-save
        raise WarmError("WARM_START_LORA_SAVE")
    if any(os.path.lexists(os.path.join(work, n)) for n in WORK_FILES):  # guard:ws-work-empty
        raise WarmError("WARM_START_WORK_NOT_EMPTY")
    return man


def copy_tokenizer(from_dir, man, work):
    dst = os.path.join(work, "tokenizer.json")
    shutil.copyfile(os.path.join(from_dir, "tokenizer.json"), dst)
    if saves.sha256_file(dst) != man["files"]["tokenizer.json"]["sha256"]:  # guard:ws-tokenizer-sha
        os.remove(dst)
        raise WarmError("WARM_START_FILE_SHA")


def check_shape(man, cfg):
    if any(man["cfg"].get(k) != cfg.get(k) for k in SHAPE_KEYS):  # guard:ws-shape
        raise WarmError("WARM_START_SHAPE_MISMATCH")


def weights_file(man):
    """v2: the model of record (best.npz, which export.py scored for the save's Results row) when the save has one."""
    return "best.npz" if "best.npz" in man["files"] else "checkpoint.npz"


def load_params(np, from_dir, man, init):
    """The save's weights (p.* of weights_file(man), re-hashed against the manifest) in place of `init`."""
    n = weights_file(man)
    p = os.path.join(from_dir, n)
    if saves.sha256_file(p) != man["files"][n]["sha256"]:  # guard:ws-checkpoint-sha
        raise WarmError("WARM_START_FILE_SHA")
    with np.load(p, allow_pickle=False) as z:
        w = {k[2:]: z[k].astype(np.float32) for k in z.files if k.startswith("p.")}
    if sorted(w) != sorted(init) or any(w[k].shape != init[k].shape for k in init):  # guard:ws-param-shape
        raise WarmError("WARM_START_SHAPE_MISMATCH")
    return w


# ---------------------------------------------------------------- v2 (spec lb-chain2-v1.md, section v2)

def check_expect(from_dir, expect):
    """--warm-start-expect BPB:TOKENS:BYTES:TOL -> dict; required with --warm-start-from, refused without it."""
    if not from_dir:
        if expect:  # guard:ws-expect-needs-save
            raise WarmError("WARM_START_EXPECT_BAD")
        return None
    if not expect:  # guard:ws-expect-required
        raise WarmError("WARM_START_EXPECT_REQUIRED")
    m = EXPECT_RE.match(str(expect))
    if not m or not 0.0 < float(m.group(4)) <= MAX_TOL:  # guard:ws-expect-format
        raise WarmError("WARM_START_EXPECT_BAD")
    return {"bpb": float(m.group(1)), "tokens": int(m.group(2)), "bytes": int(m.group(3)), "tol": float(m.group(4))}


def load_opt(np, from_dir, man, trainable, optimizer, opt_load):
    """The optimizer state of the save's checkpoint.npz (re-hashed), kept: the same optimizer, the same key set."""
    if man["cfg"].get("optimizer", "adamw") != optimizer:  # guard:ws-opt-name
        raise WarmError("WARM_START_OPT_MISMATCH")
    p = os.path.join(from_dir, "checkpoint.npz")
    if saves.sha256_file(p) != man["files"]["checkpoint.npz"]["sha256"]:  # guard:ws-opt-sha
        raise WarmError("WARM_START_FILE_SHA")
    import json
    with np.load(p, allow_pickle=False) as z:
        meta = json.loads(str(z["meta"]))
        check_same_step(from_dir, man, meta)
        t = meta["t"]
        try:
            return opt_load(z, t, trainable, optimizer)
        except Exception:  # noqa: BLE001  (lbtrain.LbError: a missing key)
            raise WarmError("WARM_START_OPT_MISMATCH")


def check_same_step(from_dir, man, ckpt_meta):
    """Batch 19 (Auditor, #679): the warm-start weights (weights_file: best.npz when the save has one) and the kept
    optimizer state (checkpoint.npz: moments and t) come from the SAME step. best.npz is a copy of checkpoint.npz taken
    at the best eval (meta step and t included, saves._trim_best keeps the meta), so a save whose best eval was not its
    last step pairs older weights with newer moments: refused (WARM_START_STEP_MISMATCH), never silently mixed. A save
    without best.npz warm-starts from checkpoint.npz alone (one file, one step). Resumed days do not come here: they
    load weights and optimizer state from the one checkpoint.npz of the chain-2 save (the last step, not the best)."""
    n = weights_file(man)
    if n == "checkpoint.npz":
        return
    p = os.path.join(from_dir, n)
    if saves.sha256_file(p) != man["files"][n]["sha256"]:  # guard:ws-same-step-sha
        raise WarmError("WARM_START_FILE_SHA")
    try:
        import json
        w = json.loads(saves.npz_meta(p))
    except (ValueError, KeyError, OSError):
        w = {}
    if not isinstance(w, dict) or w.get("step") != ckpt_meta.get("step") or w.get("t") != ckpt_meta.get("t") or ckpt_meta.get("step") != man.get("step"):  # guard:ws-same-step
        raise WarmError("WARM_START_STEP_MISMATCH")


def final_lr(man, lr_at):
    """The LR of the save's last update: lr_at(step - 1) under the save's own cfg."""
    return lr_at(max(0, int(man["step"]) - 1), man["cfg"])


def check_lr(man, cfg, lr_at):
    """No re-warm: warmup 0 and a peak LR at or below the save's final LR (lr_at is cosine-decaying after warmup, so the
    peak is the run's highest LR)."""
    if cfg.get("warmup") != 0:  # guard:ws-lr-warmup
        raise WarmError("WARM_START_LR_REWARM")
    if not cfg.get("lr", 0) > 0 or cfg["lr"] > final_lr(man, lr_at):  # guard:ws-lr-cap
        raise WarmError("WARM_START_LR_ABOVE_FINAL")
    return final_lr(man, lr_at)


def step0_eval(np, forward, params, cfg, held, decode):
    """export.py's held-out eval of `params`: fp16 weights, at most 96 non-overlapping ctx windows of `held`."""
    w16 = {k: params[k].astype(np.float16).astype(np.float32) for k in params}
    T = cfg["ctx"]
    held = np.asarray(held).astype(np.int64)
    n_eval = min((len(held) - 1) // T, MAX_WINDOWS)
    tot = 0.0
    for i in range(0, n_eval, 4):
        j = range(i, min(n_eval, i + 4))
        x = np.stack([held[k * T:k * T + T] for k in j])
        y = np.stack([held[k * T + 1:k * T + T + 1] for k in j])
        tot += forward(w16, cfg, x, y)[1] * len(j)
    ce = float(tot / n_eval)
    ys = np.concatenate([held[k * T + 1:k * T + T + 1] for k in range(n_eval)])
    nbytes = len(decode(ys.tolist()).encode())
    return {"bpb": round(ce * len(ys) / math.log(2) / nbytes, 4), "modelCe": ce, "tokens": int(len(ys)), "bytes": int(nbytes)}


def check_step0(got, expect):
    """The step-0 model reproduces the recorded held-out bpb within the stated tolerance, on the same split."""
    if got["tokens"] != expect["tokens"] or got["bytes"] != expect["bytes"]:  # guard:ws-step0-split
        raise WarmError("WARM_START_STEP0_SPLIT")
    if not math.isfinite(got["modelCe"]) or abs(got["bpb"] - expect["bpb"]) > expect["tol"]:  # guard:ws-step0-bpb
        raise WarmError("WARM_START_STEP0_MISMATCH")
    return got


def seed_best(best, val0, mode):
    """best.json at the warm start: the step-0 val loss, so only an eval that beats step 0 can become best."""
    if not isinstance(val0, float) or not math.isfinite(val0):  # guard:ws-seed-finite
        raise WarmError("WARM_START_STEP0_MISMATCH")
    if best.get("val") != float("inf") or best.get("step") != 0:  # guard:ws-seed-fresh
        raise WarmError("WARM_START_WORK_NOT_EMPTY")
    return {"val": val0, "step": 0, "stale": 0, **({"valSplit": mode} if mode != "first" else {})}
