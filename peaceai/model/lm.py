"""PeaceAI M9 language model: a self-trained byte-level BPE tokenizer and a small decoder-only
transformer, written from scratch on numpy (forward, backward, AdamW). No pretrained model,
tokenizer, weights or embeddings of any kind (CONSTITUTION section 12). CPU only, seeded."""
import hashlib
import heapq
import json
import math
import re

import numpy as np

TOKENIZER_SCHEMA = "peaceai-bpe:v1"
MODEL_SCHEMA = "peaceai-lm:v1"
EOD = 256  # document separator; merged tokens start at 257
PATTERN = r" ?[A-Za-z_$][A-Za-z0-9_$]*| ?[0-9]+| ?[^\sA-Za-z0-9_$]+|\s+(?!\S)|\s+"


# ---------------------------------------------------------------- tokenizer (byte-level BPE)

def train_bpe(texts, vocab_size):
    """Deterministic BPE training on chunk counts. Ties break on the smallest pair ids."""
    counts = {}
    rx = re.compile(PATTERN)
    for t in texts:
        for m in rx.findall(t):
            counts[m] = counts.get(m, 0) + 1
    chunks = sorted(counts)
    words = [list(c.encode("utf-8")) for c in chunks]
    freq = [counts[c] for c in chunks]
    pairs, where = {}, {}
    for wi, w in enumerate(words):
        for a, b in zip(w, w[1:]):
            pairs[(a, b)] = pairs.get((a, b), 0) + freq[wi]
            where.setdefault((a, b), set()).add(wi)
    heap = [(-n, p) for p, n in pairs.items()]
    heapq.heapify(heap)
    merges = []
    next_id = EOD + 1
    while next_id < vocab_size and heap:
        n, p = heapq.heappop(heap)
        if pairs.get(p, 0) != -n or -n < 2:
            if pairs.get(p, 0) >= 2 and pairs.get(p, 0) != -n:
                heapq.heappush(heap, (-pairs[p], p))
            continue
        merges.append(list(p))
        new = next_id
        next_id += 1
        touched = {}
        for wi in sorted(where.pop(p, ())):
            w, f = words[wi], freq[wi]
            for a, b in zip(w, w[1:]):
                pairs[(a, b)] -= f
                touched[(a, b)] = True
            out, i = [], 0
            while i < len(w):
                if i + 1 < len(w) and w[i] == p[0] and w[i + 1] == p[1]:
                    out.append(new)
                    i += 2
                else:
                    out.append(w[i])
                    i += 1
            words[wi] = out
            for a, b in zip(out, out[1:]):
                pairs[(a, b)] = pairs.get((a, b), 0) + f
                where.setdefault((a, b), set()).add(wi)
                touched[(a, b)] = True
        pairs.pop(p, None)
        for q in touched:
            if pairs.get(q, 0) > 0:
                heapq.heappush(heap, (-pairs[q], q))
    return {"schema": TOKENIZER_SCHEMA, "pattern": PATTERN, "eod": EOD, "vocab_size": vocab_size, "merges": merges}


class Tokenizer:
    def __init__(self, spec):
        if spec.get("schema") != TOKENIZER_SCHEMA:
            raise ValueError("TOKENIZER_INVALID")
        self.spec = spec
        self.vocab_size = int(spec["vocab_size"])
        self.ranks = {tuple(m): i for i, m in enumerate(spec["merges"])}
        self.rx = re.compile(spec["pattern"])
        self.cache = {}
        self.bytes_of = {i: bytes([i]) for i in range(256)}
        self.bytes_of[EOD] = b""
        for i, (a, b) in enumerate(spec["merges"]):
            self.bytes_of[EOD + 1 + i] = self.bytes_of[a] + self.bytes_of[b]

    def _chunk(self, c):
        hit = self.cache.get(c)
        if hit is not None:
            return hit
        w = list(c.encode("utf-8"))
        while len(w) > 1:
            best, at = None, -1
            for i in range(len(w) - 1):
                r = self.ranks.get((w[i], w[i + 1]))
                if r is not None and (best is None or r < best):
                    best, at = r, i
            if best is None:
                break
            w = w[:at] + [EOD + 1 + best] + w[at + 2:]
        if len(self.cache) < 500000:
            self.cache[c] = w
        return w

    def encode(self, text):
        out = []
        for c in self.rx.findall(text):
            out.extend(self._chunk(c))
        return out

    def decode(self, ids):
        return b"".join(self.bytes_of.get(int(i), b"") for i in ids).decode("utf-8", errors="replace")


# ---------------------------------------------------------------- model

def param_shapes(cfg):
    d, L, V, T = cfg["d_model"], cfg["n_layer"], cfg["vocab_size"], cfg["ctx"]
    shapes = {"wte": (V, d), "wpe": (T, d), "lnf_g": (d,), "lnf_b": (d,)}
    for l in range(L):
        shapes.update({
            f"h{l}.ln1_g": (d,), f"h{l}.ln1_b": (d,), f"h{l}.wqkv": (d, 3 * d), f"h{l}.wo": (d, d),
            f"h{l}.ln2_g": (d,), f"h{l}.ln2_b": (d,), f"h{l}.w1": (d, 4 * d), f"h{l}.w2": (4 * d, d),
        })
    return shapes


def param_count(cfg):
    return int(sum(int(np.prod(s)) for s in param_shapes(cfg).values()))


def init_params(cfg, seed):
    rng = np.random.Generator(np.random.PCG64(seed))
    out = {}
    for k in sorted(param_shapes(cfg)):
        s = param_shapes(cfg)[k]
        if k.endswith("_g"):
            out[k] = np.ones(s, np.float32)
        elif k.endswith("_b"):
            out[k] = np.zeros(s, np.float32)
        else:
            std = 0.02 / math.sqrt(2 * cfg["n_layer"]) if k.endswith(".wo") or k.endswith(".w2") else 0.02
            out[k] = (rng.standard_normal(s) * std).astype(np.float32)
    return out


def _ln(x, g, b):
    mu = x.mean(-1, keepdims=True)
    xc = x - mu
    var = (xc * xc).mean(-1, keepdims=True)
    rstd = 1.0 / np.sqrt(var + 1e-5)
    xh = xc * rstd
    return xh * g + b, (xh, rstd)


def _ln_back(dy, g, cache):
    xh, rstd = cache
    dg = (dy * xh).reshape(-1, xh.shape[-1]).sum(0)
    db = dy.reshape(-1, xh.shape[-1]).sum(0)
    dxh = dy * g
    dx = rstd * (dxh - dxh.mean(-1, keepdims=True) - xh * (dxh * xh).mean(-1, keepdims=True))
    return dx, dg, db


_C = math.sqrt(2.0 / math.pi)


def _gelu(x):
    t = np.tanh(_C * (x + 0.044715 * x ** 3))
    return 0.5 * x * (1 + t), t


def _gelu_back(dy, x, t):
    dt = _C * (1 + 3 * 0.044715 * x * x)
    return dy * (0.5 * (1 + t) + 0.5 * x * (1 - t * t) * dt)


def forward(p, cfg, idx, targets=None, keep=False):
    """idx (B,T) int. Returns (logits (B,T,V), loss or None, cache)."""
    B, T = idx.shape
    d, H, L = cfg["d_model"], cfg["n_head"], cfg["n_layer"]
    hd = d // H
    x = p["wte"][idx] + p["wpe"][:T]
    mask = np.triu(np.full((T, T), -1e9, np.float32), 1)
    caches = []
    for l in range(L):
        a_in, c1 = _ln(x, p[f"h{l}.ln1_g"], p[f"h{l}.ln1_b"])
        qkv = a_in @ p[f"h{l}.wqkv"]
        q, k, v = np.split(qkv, 3, axis=-1)
        q = q.reshape(B, T, H, hd).transpose(0, 2, 1, 3)
        k = k.reshape(B, T, H, hd).transpose(0, 2, 1, 3)
        v = v.reshape(B, T, H, hd).transpose(0, 2, 1, 3)
        att = (q @ k.transpose(0, 1, 3, 2)) * (1.0 / math.sqrt(hd)) + mask
        att = att - att.max(-1, keepdims=True)
        att = np.exp(att)
        att /= att.sum(-1, keepdims=True)
        y = (att @ v).transpose(0, 2, 1, 3).reshape(B, T, d)
        x = x + y @ p[f"h{l}.wo"]
        m_in, c2 = _ln(x, p[f"h{l}.ln2_g"], p[f"h{l}.ln2_b"])
        hpre = m_in @ p[f"h{l}.w1"]
        hact, th = _gelu(hpre)
        x = x + hact @ p[f"h{l}.w2"]
        if keep:
            caches.append((a_in, c1, q, k, v, att, y, m_in, c2, hpre, hact, th))
    xf, cf = _ln(x, p["lnf_g"], p["lnf_b"])
    logits = xf @ p["wte"].T
    loss = None
    probs = None
    if targets is not None:
        z = logits - logits.max(-1, keepdims=True)
        e = np.exp(z)
        s = e.sum(-1, keepdims=True)
        logp_t = np.take_along_axis(z, targets[..., None], -1)[..., 0] - np.log(s[..., 0])
        loss = float(-logp_t.mean())
        probs = e / s
    return logits, loss, (idx, caches, xf, cf, probs, targets)


def backward(p, cfg, cache):
    idx, caches, xf, cf, probs, targets = cache
    B, T = idx.shape
    d, H, L = cfg["d_model"], cfg["n_head"], cfg["n_layer"]
    hd = d // H
    g = {k: np.zeros_like(v) for k, v in p.items()}
    dlogits = probs.copy()
    np.put_along_axis(dlogits, targets[..., None], np.take_along_axis(dlogits, targets[..., None], -1) - 1.0, -1)
    dlogits /= (B * T)
    g["wte"] += (dlogits.reshape(-1, dlogits.shape[-1]).T @ xf.reshape(-1, d))
    dxf = dlogits @ p["wte"]
    dx, g["lnf_g"], g["lnf_b"] = _ln_back(dxf, p["lnf_g"], cf)
    for l in reversed(range(L)):
        a_in, c1, q, k, v, att, y, m_in, c2, hpre, hact, th = caches[l]
        # MLP
        g[f"h{l}.w2"] += hact.reshape(-1, 4 * d).T @ dx.reshape(-1, d)
        dh = _gelu_back(dx @ p[f"h{l}.w2"].T, hpre, th)
        g[f"h{l}.w1"] += m_in.reshape(-1, d).T @ dh.reshape(-1, 4 * d)
        dm, dg2, db2 = _ln_back(dh @ p[f"h{l}.w1"].T, p[f"h{l}.ln2_g"], c2)
        g[f"h{l}.ln2_g"] += dg2
        g[f"h{l}.ln2_b"] += db2
        dx = dx + dm
        # attention
        g[f"h{l}.wo"] += y.reshape(-1, d).T @ dx.reshape(-1, d)
        dy = (dx @ p[f"h{l}.wo"].T).reshape(B, T, H, hd).transpose(0, 2, 1, 3)
        datt = dy @ v.transpose(0, 1, 3, 2)
        dv = att.transpose(0, 1, 3, 2) @ dy
        ds = att * (datt - (datt * att).sum(-1, keepdims=True)) * (1.0 / math.sqrt(hd))
        dq = ds @ k
        dk = ds.transpose(0, 1, 3, 2) @ q
        dqkv = np.concatenate([t.transpose(0, 2, 1, 3).reshape(B, T, d) for t in (dq, dk, dv)], -1)
        g[f"h{l}.wqkv"] += a_in.reshape(-1, d).T @ dqkv.reshape(-1, 3 * d)
        da, dg1, db1 = _ln_back(dqkv @ p[f"h{l}.wqkv"].T, p[f"h{l}.ln1_g"], c1)
        g[f"h{l}.ln1_g"] += dg1
        g[f"h{l}.ln1_b"] += db1
        dx = dx + da
    np.add.at(g["wte"], idx, dx)
    g["wpe"][:T] += dx.sum(0)
    return g


def adamw_step(p, g, state, lr, cfg):
    b1, b2, eps, wd = 0.9, 0.95, 1e-8, cfg.get("weight_decay", 0.1)
    norm = math.sqrt(sum(float((v.astype(np.float64) ** 2).sum()) for v in g.values()))
    clip = min(1.0, cfg.get("grad_clip", 1.0) / (norm + 1e-6))
    state["t"] += 1
    t = state["t"]
    for k in sorted(p):
        gk = g[k] * clip
        m = state["m"][k]
        v = state["v"][k]
        m *= b1
        m += (1 - b1) * gk
        v *= b2
        v += (1 - b2) * gk * gk
        mh = m / (1 - b1 ** t)
        vh = v / (1 - b2 ** t)
        if p[k].ndim == 2:
            p[k] *= (1 - lr * wd)
        p[k] -= (lr * mh / (np.sqrt(vh) + eps)).astype(np.float32)
    return norm


def lr_at(step, cfg):
    warm, total, peak = cfg["warmup"], cfg["total_steps"], cfg["lr"]
    if step < warm:
        return peak * (step + 1) / warm
    frac = min(1.0, (step - warm) / max(1, total - warm))
    return peak * (0.1 + 0.9 * 0.5 * (1 + math.cos(math.pi * frac)))


def log_probs(p, cfg, ids):
    """Per-position log P(ids[i] | ids[:i]) for i >= 1, using the last ctx tokens as context."""
    ids = list(ids)
    T = cfg["ctx"]
    out = [0.0] * len(ids)
    start = 1
    while start < len(ids):
        lo = max(0, start - (T - 1)) if start > T - 1 else 0
        lo = max(0, min(lo, start - 1))
        window = ids[lo: lo + T]
        logits, _, _ = forward(p, cfg, np.array([window], np.int64))
        z = logits[0] - logits[0].max(-1, keepdims=True)
        lp = z - np.log(np.exp(z).sum(-1, keepdims=True))
        end = min(len(ids), lo + len(window))
        for i in range(start, end):
            out[i] = float(lp[i - 1 - lo, ids[i]])
        start = end
    return out


def file_sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for b in iter(lambda: f.read(1 << 20), b""):
            h.update(b)
    return h.hexdigest()


def save_weights(path, p, dtype=np.float16):
    np.savez(path, **{k: p[k].astype(dtype) for k in sorted(p)})


def load_weights(path):
    with np.load(path) as z:
        return {k: z[k].astype(np.float32) for k in z.files}


def canonical(o):
    return json.dumps(o, sort_keys=True, separators=(",", ":"))


def generate(p, cfg, prompt, n, rng=None, temperature=0.0, top_k=40):
    """Incremental decoding with a key/value cache. temperature 0 = greedy. Stops at EOD or ctx."""
    d, H, L, T = cfg["d_model"], cfg["n_head"], cfg["n_layer"], cfg["ctx"]
    hd = d // H
    ks = [np.zeros((H, 0, hd), np.float32) for _ in range(L)]
    vs = [np.zeros((H, 0, hd), np.float32) for _ in range(L)]

    def step(ids, pos0):
        t = len(ids)
        x = p["wte"][ids] + p["wpe"][pos0:pos0 + t]
        for l in range(L):
            a, _ = _ln(x, p[f"h{l}.ln1_g"], p[f"h{l}.ln1_b"])
            q, k, v = np.split(a @ p[f"h{l}.wqkv"], 3, axis=-1)
            q, k, v = (z.reshape(t, H, hd).transpose(1, 0, 2) for z in (q, k, v))
            ks[l] = np.concatenate([ks[l], k], 1)
            vs[l] = np.concatenate([vs[l], v], 1)
            S = ks[l].shape[1]
            att = (q @ ks[l].transpose(0, 2, 1)) * (1.0 / math.sqrt(hd))
            qpos = pos0 + np.arange(t)[:, None]
            att = np.where(np.arange(S)[None, :] > qpos, -1e9, att)
            att = np.exp(att - att.max(-1, keepdims=True))
            att /= att.sum(-1, keepdims=True)
            x = x + (att @ vs[l]).transpose(1, 0, 2).reshape(t, d) @ p[f"h{l}.wo"]
            m, _ = _ln(x, p[f"h{l}.ln2_g"], p[f"h{l}.ln2_b"])
            x = x + _gelu(m @ p[f"h{l}.w1"])[0] @ p[f"h{l}.w2"]
        xf, _ = _ln(x[-1:], p["lnf_g"], p["lnf_b"])
        return (xf @ p["wte"].T)[0]

    ids = list(prompt)[-(T // 2):] or [EOD]
    logits = step(np.array(ids), 0)
    out = []
    while len(out) < n and len(ids) < T:
        if temperature <= 0:
            nxt = int(np.argmax(logits))
        else:
            z = logits / temperature
            cut = np.sort(z)[-top_k]
            z = np.where(z < cut, -1e9, z)
            pr = np.exp(z - z.max())
            pr /= pr.sum()
            nxt = int(rng.choice(len(pr), p=pr))
        if nxt == EOD:
            break
        out.append(nxt)
        ids.append(nxt)
        if len(ids) >= T:
            break
        logits = step(np.array([nxt]), len(ids) - 1)
    return out
