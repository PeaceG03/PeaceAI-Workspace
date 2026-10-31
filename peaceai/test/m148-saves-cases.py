"""M148 case driver: run ONE named case against the saves.py found in argv[1] (the real module or a mutated copy)
and print its outcome (a SAVE_/CHAIN_/RESUME_ code, "ok", "next=yes|no ..." or "crash"). Used by m148-lm-saves.test.ts."""
import json
import os
import shutil
import sys
import tempfile

sys.path.insert(0, sys.argv[1])
import numpy as np  # noqa: E402
import saves  # noqa: E402

CFG = {"schema": "peaceai-lm:v1", "d_model": 8, "n_head": 2, "n_layer": 1, "vocab_size": 300, "ctx": 8, "lr": 0.001, "warmup": 1,
       "total_steps": 10, "batch": 2, "weight_decay": 0.1, "grad_clip": 1.0, "seed": 1}
DATA = "d" * 64


def ckpt(path, step, cfg=CFG):
    meta = {"cfg": cfg, "t": step, "step": step, "rng": {"x": 1}}
    with open(path, "wb") as f:
        np.savez(f, meta=np.array(json.dumps(meta)), **{"p.w": np.arange(6, dtype=np.float32) + step, "m.w": np.zeros(6, np.float32), "v.w": np.ones(6, np.float32)})


def work(root, step=4, best=True):
    w = os.path.join(root, "work")
    os.makedirs(w, exist_ok=True)
    ckpt(os.path.join(w, "checkpoint.npz"), step)
    open(os.path.join(w, "tokenizer.json"), "w").write('{"merges":[]}\n')
    open(os.path.join(w, "metrics.jsonl"), "w").write('{"step":1,"loss":5.0}\n')
    if best:
        shutil.copyfile(os.path.join(w, "checkpoint.npz"), os.path.join(w, "best.npz"))
        open(os.path.join(w, "best.json"), "w").write('{"val":4.0,"step":2,"stale":0}')
    return w


def fixture(root, step=4, best=True):
    w = work(root, step, best)
    name, sha = saves.write_save(w, os.path.join(root, "saves"), step, CFG, DATA)
    return os.path.join(root, "saves", name), sha


def rewrite_manifest(d, fn):
    mp = os.path.join(d, "manifest.json")
    man = json.load(open(mp))
    fn(man)
    body = (saves.canonical(man) + "\n").encode()
    open(mp, "wb").write(body)
    return saves.sha256_bytes(body)


def marker(root, d, sha, more=True, step=4, schema=None, save=None, cfg=CFG):
    p = os.path.join(root, "chain.json")
    rec = saves.write_marker(p, "deadline" if more else "steps", step, 10, save or os.path.basename(d), sha, cfg)
    if schema:
        rec["schema"] = schema
        open(p, "w").write(json.dumps(rec))
    return p


def case(name, root):
    V = saves.verify_save
    if name == "ok":
        d, sha = fixture(root); V(d, sha, CFG, DATA); return "ok"
    if name == "ok-no-optional":
        d, sha = fixture(root, best=False); V(d, sha, CFG, DATA); return "ok"
    if name == "want-sha-format":
        d, sha = fixture(root); V(d, sha[:63] + "G"); return "ok"
    if name == "want-sha-upper":  # near miss of a valid sha: same hex but upper case is refused, not normalised
        d, sha = fixture(root); V(d, sha.upper()); return "ok"
    if name == "missing":
        V(os.path.join(root, "nope"), "a" * 64); return "ok"
    if name == "missing-manifest":
        d, sha = fixture(root); os.remove(os.path.join(d, "manifest.json")); V(d, sha); return "ok"
    if name == "manifest-sha":
        d, sha = fixture(root); V(d, ("0" if sha[0] != "0" else "1") + sha[1:]); return "ok"
    if name == "schema":
        d, _ = fixture(root); sha = rewrite_manifest(d, lambda m: m.update(schema="peaceai-lm-save:v0")); V(d, sha); return "ok"
    if name == "cfg-self":
        d, _ = fixture(root); sha = rewrite_manifest(d, lambda m: m["cfg"].update(lr=0.5)); V(d, sha); return "ok"
    if name == "file-set":
        d, _ = fixture(root); open(os.path.join(d, "evil.txt"), "w").write("x")
        sha = rewrite_manifest(d, lambda m: m["files"].update({"evil.txt": {"sha256": saves.sha256_file(os.path.join(d, "evil.txt")), "bytes": 1}}))
        V(d, sha); return "ok"
    if name == "file-set-required":
        d, _ = fixture(root); os.remove(os.path.join(d, "metrics.jsonl"))
        sha = rewrite_manifest(d, lambda m: m["files"].pop("metrics.jsonl")); V(d, sha); return "ok"
    if name == "extra-or-missing":
        d, sha = fixture(root); open(os.path.join(d, "best.json.bak"), "w").write("x"); V(d, sha); return "ok"
    if name == "symlink":
        d, sha = fixture(root); t = os.path.join(root, "tok-copy.json"); shutil.copyfile(os.path.join(d, "tokenizer.json"), t)
        os.remove(os.path.join(d, "tokenizer.json")); os.symlink(t, os.path.join(d, "tokenizer.json")); V(d, sha); return "ok"
    if name == "file-sha":
        d, sha = fixture(root); p = os.path.join(d, "metrics.jsonl"); b = bytearray(open(p, "rb").read()); b[2] ^= 1; open(p, "wb").write(bytes(b)); V(d, sha); return "ok"
    if name == "file-sha-truncated":
        d, sha = fixture(root); p = os.path.join(d, "checkpoint.npz"); b = open(p, "rb").read(); open(p, "wb").write(b[:-10]); V(d, sha); return "ok"
    if name == "checkpoint-step":
        d, _ = fixture(root); sha = rewrite_manifest(d, lambda m: m.update(step=5)); V(d, sha); return "ok"
    if name == "config":
        d, sha = fixture(root); V(d, sha, dict(CFG, total_steps=11), DATA); return "ok"
    if name == "data":
        d, sha = fixture(root); V(d, sha, CFG, "e" * 64); return "ok"
    if name == "work-not-empty":
        d, sha = fixture(root); w2 = os.path.join(root, "w2"); os.makedirs(w2); ckpt(os.path.join(w2, "checkpoint.npz"), 1); saves.restore(d, w2, V(d, sha)); return "ok"
    if name == "copy-sha":  # the save changes between verify and copy: the copy is re-hashed and refused, work left clean
        d, sha = fixture(root); man = V(d, sha); open(os.path.join(d, "metrics.jsonl"), "a").write("x"); w2 = os.path.join(root, "w2")
        try:
            saves.restore(d, w2, man)
        except saves.SaveError as e:
            return e.code + (" clean" if not os.listdir(w2) else " dirty")
        return "ok"
    if name == "work-other-file":  # near miss: a work dir with unrelated files but no checkpoint is fine
        d, sha = fixture(root); w2 = os.path.join(root, "w2"); os.makedirs(w2); open(os.path.join(w2, "tokens_train.npy"), "w").write("x"); saves.restore(d, w2, V(d, sha)); return "ok"
    if name == "keep-2":
        w = work(root)
        for s in (1, 2, 3, 4):
            ckpt(os.path.join(w, "checkpoint.npz"), s); saves.write_save(w, os.path.join(root, "saves"), s, CFG, DATA)
        os.makedirs(os.path.join(root, "saves", ".tmp-save-000000009-1"))
        saves.prune(os.path.join(root, "saves"))
        return "kept=" + ",".join(sorted(os.listdir(os.path.join(root, "saves"))))
    # chain decisions: argv after the case name is INDEX MAX
    if name.startswith("chain-"):
        idx, mx = sys.argv[4], sys.argv[5]
        d, sha = fixture(root)
        sd = os.path.dirname(d)
        kind = name[len("chain-"):]
        if kind == "next":
            p = marker(root, d, sha)
        elif kind == "done":
            p = marker(root, d, sha, more=False)
        elif kind == "no-marker":
            p = os.path.join(root, "none.json")
        elif kind == "marker-schema":
            p = marker(root, d, sha, schema="peaceai-lm-chain:v0")
        elif kind == "marker-save-name":
            p = marker(root, d, sha, save="../save-000000004")
        elif kind == "save-missing":
            p = marker(root, d, sha); shutil.rmtree(d)
        elif kind == "save-corrupt":
            p = marker(root, d, sha); q = os.path.join(d, "tokenizer.json"); open(q, "a").write(" ")
        elif kind == "marker-step":
            p = marker(root, d, sha, step=3)
        elif kind == "marker-cfg":
            p = marker(root, d, sha, cfg=dict(CFG, lr=0.5))
        else:
            return "unknown"
        nxt, line = saves.decide(p, sd, idx, mx)
        return line.split(" ")[1] + (" " + line.split(" ")[2] if not nxt else "")
    return "unknown"


if __name__ == "__main__":
    root = tempfile.mkdtemp(prefix="m148-case-")
    try:
        print(case(sys.argv[2], root))
    except saves.SaveError as e:
        print(e.code)
    except Exception as e:  # a mutated guard may fall through to a crash: that is a different outcome, not a pass
        print("crash:" + type(e).__name__)
    finally:
        shutil.rmtree(root, ignore_errors=True)
