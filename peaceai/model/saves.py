"""Limit-breaker step 1 (M148): time-based resume saves, sha256-verified resume and the chain decision.

A save is one directory <saves>/save-<step:09d>/ holding the full resume state of train.py (checkpoint.npz: fp32
weights + AdamW m/v + t + step + the numpy RNG state, which is the data position: every batch offset is drawn from
it), the tokenizer, metrics.jsonl, best.json, a trimmed best.npz (meta + weights only) and, with replay, replay.json
and val.json, plus manifest.json binding every file by sha256 and byte count, the training config and the training
data sha256. It is written in a temporary directory and renamed into place (atomic); only the latest KEEP saves are
kept. Resume (train.py --resume-from DIR --resume-manifest-sha SHA) verifies the manifest's own sha256, every file,
no extra or missing file, the checkpoint's step, the config and the data before anything is loaded; any failure
stops the run with one filtered code (never a silent fresh start). Codes only are printed: no paths, no text.

CLI (used by the workflow; one quiet line each):
  saves.py verify DIR SHA                      -> "save ok step=N" or exit 3 with "SAVE_..."
  saves.py decide MARKER SAVE_DIR INDEX MAX    -> "chain next=yes index=I+1 ..." (exit 0), "chain next=no reason=..."
                                                  (exit 0), or exit 3 with "CHAIN_..." (refusal: no next run)
"""
import hashlib
import json
import os
import re
import shutil
import sys

SAVE_SCHEMA = "peaceai-lm-save:v1"
MARKER_SCHEMA = "peaceai-lm-chain:v1"
KEEP = 2
HARD_MAX_CHAIN = 12  # about 68 hours of 5h40m links; a larger max_chain input is refused
REQUIRED = ("checkpoint.npz", "tokenizer.json", "metrics.jsonl")
OPTIONAL = ("best.json", "best.npz", "replay.json", "val.json")
ALLOWED = REQUIRED + OPTIONAL
MORE_REASONS = ("deadline", "max_seconds", "max_steps_this_run")  # stopped by time or a per-run cap: more to do
SHA_RE = re.compile(r"^[0-9a-f]{64}$")
NAME_RE = re.compile(r"^save-[0-9]{9}$")


class SaveError(Exception):
    def __init__(self, code):
        super().__init__(code)
        self.code = code


def canonical(o):
    return json.dumps(o, sort_keys=True, separators=(",", ":"))


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def sha256_bytes(b):
    return hashlib.sha256(b).hexdigest()


def cfg_sha256(cfg):
    return sha256_bytes(canonical(cfg).encode())


def data_sha256(paths):
    """sha256 over the named training-data files (corpus docs + manifest, replay corpus): a changed corpus refuses."""
    h = hashlib.sha256()
    for p in paths:
        h.update(os.path.basename(p).encode() + b"\0" + sha256_file(p).encode() + b"\n")
    return h.hexdigest()


def due(now, last, every_sec):
    """A timed save is due when saving is on and every_sec has passed since the last save (or the run start)."""
    return every_sec > 0 and now - last >= every_sec


def save_name(step):
    return f"save-{int(step):09d}"


def list_saves(saves_dir):
    if not os.path.isdir(saves_dir):
        return []
    return sorted(n for n in os.listdir(saves_dir) if NAME_RE.match(n))


def _fsync_file(path):
    with open(path, "rb") as f:
        os.fsync(f.fileno())


def _trim_best(src, dst):
    import numpy as np
    with np.load(src, allow_pickle=False) as z:
        arrays = {k: z[k] for k in z.files if k == "meta" or k.startswith("p.")}
    with open(dst, "wb") as f:
        np.savez(f, **arrays)


def write_save(work, saves_dir, step, cfg, data_sha, keep=KEEP):
    """Copy the resume state of `work` into <saves_dir>/save-<step>/ atomically; prune to the latest `keep`.
    Returns (name, manifest sha256). A save for a step that already exists is not rewritten."""
    os.makedirs(saves_dir, exist_ok=True)
    name = save_name(step)
    final = os.path.join(saves_dir, name)
    if os.path.isdir(final):
        return name, sha256_file(os.path.join(final, "manifest.json"))
    tmp = os.path.join(saves_dir, f".tmp-{name}-{os.getpid()}")
    shutil.rmtree(tmp, ignore_errors=True)
    os.makedirs(tmp)
    files = {}
    for f in ALLOWED:
        src = os.path.join(work, f)
        if not os.path.exists(src):
            if f in REQUIRED:
                shutil.rmtree(tmp, ignore_errors=True)
                raise SaveError("SAVE_WRITE_MISSING_FILE")
            continue
        dst = os.path.join(tmp, f)
        if f == "best.npz":
            _trim_best(src, dst)
        else:
            shutil.copyfile(src, dst)
        _fsync_file(dst)
        files[f] = {"sha256": sha256_file(dst), "bytes": os.path.getsize(dst)}
    man = {"schema": SAVE_SCHEMA, "step": int(step), "cfg": cfg, "cfgSha256": cfg_sha256(cfg), "dataSha256": data_sha, "files": files}
    body = (canonical(man) + "\n").encode()
    with open(os.path.join(tmp, "manifest.json"), "wb") as f:
        f.write(body)
        f.flush()
        os.fsync(f.fileno())
    os.rename(tmp, final)  # atomic on one filesystem: a save dir either exists whole or not at all
    prune(saves_dir, keep)
    return name, sha256_bytes(body)


def prune(saves_dir, keep=KEEP):
    for n in os.listdir(saves_dir):
        if n.startswith(".tmp-"):
            shutil.rmtree(os.path.join(saves_dir, n), ignore_errors=True)
    names = list_saves(saves_dir)
    for n in names[:-keep] if keep > 0 else names:
        shutil.rmtree(os.path.join(saves_dir, n), ignore_errors=True)


def verify_save(d, want_sha, cfg=None, data_sha=None):
    """Fail-closed check of one save directory. Returns its manifest; raises SaveError(code) on any doubt."""
    if not isinstance(want_sha, str) or not SHA_RE.match(want_sha):  # guard:want-sha-format
        raise SaveError("SAVE_SHA_REQUIRED")
    mp = os.path.join(d, "manifest.json")
    if not os.path.isdir(d) or not os.path.isfile(mp):  # guard:missing
        raise SaveError("SAVE_MISSING")
    if sha256_file(mp) != want_sha:  # guard:manifest-sha
        raise SaveError("SAVE_MANIFEST_SHA")
    try:
        man = json.load(open(mp, encoding="utf-8"))
    except ValueError:
        raise SaveError("SAVE_SCHEMA")
    if not isinstance(man, dict) or man.get("schema") != SAVE_SCHEMA or not isinstance(man.get("files"), dict):  # guard:schema
        raise SaveError("SAVE_SCHEMA")
    if man.get("cfgSha256") != cfg_sha256(man.get("cfg")):  # guard:cfg-self
        raise SaveError("SAVE_SCHEMA")
    files = man["files"]
    if any(f not in ALLOWED for f in files) or any(f not in files for f in REQUIRED):  # guard:file-set
        raise SaveError("SAVE_FILE_SET")
    present = sorted(n for n in os.listdir(d) if n != "manifest.json")
    if present != sorted(files):  # guard:extra-or-missing
        raise SaveError("SAVE_FILE_SET")
    for f, rec in files.items():
        p = os.path.join(d, f)
        if os.path.islink(p) or not os.path.isfile(p):  # guard:symlink
            raise SaveError("SAVE_FILE_SET")
        if os.path.getsize(p) != rec.get("bytes") or sha256_file(p) != rec.get("sha256"):  # guard:file-sha
            raise SaveError("SAVE_FILE_SHA")
    import numpy as np
    try:
        with np.load(os.path.join(d, "checkpoint.npz"), allow_pickle=False) as z:
            meta = json.loads(str(z["meta"]))
    except Exception:
        raise SaveError("SAVE_CHECKPOINT")
    if meta.get("step") != man.get("step") or canonical(meta.get("cfg")) != canonical(man.get("cfg")):  # guard:checkpoint-step
        raise SaveError("SAVE_CHECKPOINT")
    if cfg is not None or data_sha is not None:
        check_identity(man, cfg, data_sha)
    return man


def check_identity(man, cfg, data_sha):
    """The save must be for exactly this training config (all of it, total_steps included) and this data."""
    if canonical(cfg) != canonical(man.get("cfg")):  # guard:config
        raise SaveError("SAVE_CONFIG_MISMATCH")
    if data_sha != man.get("dataSha256"):  # guard:data
        raise SaveError("SAVE_DATA_MISMATCH")


def restore(d, work, man):
    """Copy a VERIFIED save's files (man = verify_save's manifest) into a work dir with no checkpoint; every copy is
    re-hashed against the manifest, so a save changed after verification is refused, not loaded."""
    if os.path.exists(os.path.join(work, "checkpoint.npz")):  # guard:work-not-empty
        raise SaveError("RESUME_WORK_NOT_EMPTY")
    os.makedirs(work, exist_ok=True)
    for f, rec in man["files"].items():
        shutil.copyfile(os.path.join(d, f), os.path.join(work, f))
        if sha256_file(os.path.join(work, f)) != rec["sha256"]:  # guard:copy-sha
            unrestore(man, work)
            raise SaveError("SAVE_FILE_SHA")
    return man


def unrestore(man, work):
    for f in man["files"]:
        p = os.path.join(work, f)
        if os.path.isfile(p):
            os.remove(p)


def write_marker(path, reason, step, total_steps, save, manifest_sha, cfg):
    rec = {"schema": MARKER_SCHEMA, "more": reason in MORE_REASONS, "stopReason": reason, "step": int(step), "totalSteps": int(total_steps),
           "save": save, "manifestSha256": manifest_sha, "cfgSha256": cfg_sha256(cfg)}
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        f.write(canonical(rec) + "\n")
    os.replace(tmp, path)
    return rec


def decide(marker_path, saves_dir, index, max_chain):
    """Whether this link dispatches the next one. Returns (next, line); raises SaveError on a refusal."""
    if not re.match(r"^(0|[1-9][0-9]{0,2})$", str(index)) or not re.match(r"^[1-9][0-9]{0,2}$", str(max_chain)):  # guard:chain-args
        raise SaveError("CHAIN_BAD_ARGS")
    index, max_chain = int(index), int(max_chain)
    if max_chain > HARD_MAX_CHAIN:  # guard:hard-cap
        raise SaveError("CHAIN_MAX_TOO_LARGE")
    if index >= max_chain:  # guard:index-in-range
        raise SaveError("CHAIN_BAD_ARGS")
    try:
        m = json.load(open(marker_path, encoding="utf-8"))
    except (OSError, ValueError):
        raise SaveError("CHAIN_NO_MARKER")
    if not isinstance(m, dict) or m.get("schema") != MARKER_SCHEMA:  # guard:marker-schema
        raise SaveError("CHAIN_NO_MARKER")
    if m.get("more") is not True:
        return False, f"chain next=no reason=done stop={m.get('stopReason')} step={m.get('step')} index={index}"
    if index + 1 >= max_chain:  # guard:chain-cap
        return False, f"chain next=no reason=cap step={m.get('step')} index={index} max={max_chain}"
    save = m.get("save")
    if not isinstance(save, str) or not NAME_RE.match(save):  # guard:marker-save-name
        raise SaveError("CHAIN_SAVE_BAD")
    try:
        man = verify_save(os.path.join(saves_dir, save), m.get("manifestSha256"))
    except SaveError as e:
        raise SaveError("CHAIN_SAVE_BAD:" + e.code)
    if man["step"] != m.get("step") or man["cfgSha256"] != m.get("cfgSha256"):  # guard:marker-matches-save
        raise SaveError("CHAIN_SAVE_BAD:SAVE_MARKER")
    return True, f"chain next=yes index={index + 1} step={man['step']} of {m.get('totalSteps')} save={save} sha={m['manifestSha256']}"


def main(argv):
    try:
        if len(argv) == 3 and argv[0] == "verify":
            man = verify_save(argv[1], argv[2])
            print(f"save ok step={man['step']}")
            return 0
        if len(argv) == 5 and argv[0] == "decide":
            nxt, line = decide(argv[1], argv[2], argv[3], argv[4])
            print(line)
            return 0
    except SaveError as e:
        print(e.code)
        return 3
    print("usage: saves.py verify DIR SHA | decide MARKER SAVE_DIR INDEX MAX")
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
