"""lb-chain2 v1: the full-model warm start of train.py (spec peaceai/spec/lb-chain2-v1.md).

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
Standard library only at import time (numpy is passed in by train.py)."""
import os
import re
import shutil

import saves

SHA_RE = re.compile(r"^[0-9a-f]{64}\Z")
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


def load_params(np, from_dir, man, init):
    """The save's weights (p.* of its checkpoint.npz, re-hashed against the manifest) in place of `init`."""
    p = os.path.join(from_dir, "checkpoint.npz")
    if saves.sha256_file(p) != man["files"]["checkpoint.npz"]["sha256"]:  # guard:ws-checkpoint-sha
        raise WarmError("WARM_START_FILE_SHA")
    with np.load(p, allow_pickle=False) as z:
        w = {k[2:]: z[k].astype(np.float32) for k in z.files if k.startswith("p.")}
    if sorted(w) != sorted(init) or any(w[k].shape != init[k].shape for k in init):  # guard:ws-param-shape
        raise WarmError("WARM_START_SHAPE_MISMATCH")
    return w
