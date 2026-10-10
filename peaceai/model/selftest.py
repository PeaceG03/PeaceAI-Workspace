"""Gradient check and determinism check for lm.py (run by peaceai/test/m9.test.ts)."""
import json
import sys

import numpy as np

sys.path.insert(0, __file__.rsplit("/", 1)[0])
import lm  # noqa: E402

cfg = {"d_model": 16, "n_head": 2, "n_layer": 2, "vocab_size": 300, "ctx": 8, "lr": 1e-2, "warmup": 2, "total_steps": 10}
p = lm.init_params(cfg, 7)
# float64 copy for a precise numeric gradient
p64 = {k: v.astype(np.float64) for k, v in p.items()}
rng = np.random.Generator(np.random.PCG64(1))
idx = rng.integers(0, 300, (2, 8))
tgt = rng.integers(0, 300, (2, 8))
_, loss, cache = lm.forward(p64, cfg, idx, tgt, keep=True)
g = lm.backward(p64, cfg, cache)
worst = 0.0
checked = 0
for k in ["wte", "wpe", "h0.wqkv", "h1.wo", "h0.w1", "h1.w2", "h0.ln1_g", "h1.ln2_b", "lnf_g"]:
    flat = p64[k].reshape(-1)
    for j in rng.choice(flat.size, 4, replace=False):
        old = flat[j]
        flat[j] = old + 1e-5
        lp = lm.forward(p64, cfg, idx, tgt)[1]
        flat[j] = old - 1e-5
        lm_ = lm.forward(p64, cfg, idx, tgt)[1]
        flat[j] = old
        num = (lp - lm_) / 2e-5
        ana = g[k].reshape(-1)[j]
        rel = abs(num - ana) / max(1e-8, abs(num) + abs(ana))
        if abs(num) + abs(ana) > 1e-9:
            worst = max(worst, rel)
            checked += 1


def run(steps):
    q = lm.init_params(cfg, 3)
    st = {"t": 0, "m": {k: np.zeros_like(v) for k, v in q.items()}, "v": {k: np.zeros_like(v) for k, v in q.items()}}
    r = np.random.Generator(np.random.PCG64(5))
    losses = []
    for s in range(steps):
        start = r.integers(0, 290, (4, 1))
        seq = (start + np.arange(9)[None, :]) % 300  # learnable: next token = previous + 1
        x, y = seq[:, :8], seq[:, 1:]
        _, l, c = lm.forward(q, cfg, x, y, keep=True)
        lm.adamw_step(q, lm.backward(q, cfg, c), st, lm.lr_at(s, cfg), cfg)
        losses.append(l)
    h = __import__("hashlib").sha256(b"".join(q[k].tobytes() for k in sorted(q))).hexdigest()
    return h, losses


h1, l1 = run(40)
h2, _ = run(40)
tok = lm.Tokenizer(lm.train_bpe(["const value = 1;\nconst other = value + 1;\n"] * 3, 300))
text = "const value = other;\n\tlet x = 'é';"
print(json.dumps({"grad_rel_err": worst, "grad_checked": checked, "deterministic": h1 == h2, "loss_first": l1[0], "loss_last": l1[-1],
                  "roundtrip": tok.decode(tok.encode(text)) == text, "merged": len(tok.encode(text)) < len(text.encode()),
                  "params_m9": lm.param_count({"d_model": 384, "n_head": 6, "n_layer": 6, "vocab_size": 4096, "ctx": 256})}))
