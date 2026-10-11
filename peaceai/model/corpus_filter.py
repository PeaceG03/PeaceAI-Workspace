"""M9 retrain corpus filter (Auditor/Architect decision: PUBLIC code only, no core files at all).

Usage: corpus_filter.py --in DIR --out DIR [--core-dir CORE_CHECKOUT]
Reads DIR/docs.jsonl + DIR/manifest.jsonl (lm-corpus.ts output) and writes the same two files into --out,
plus filter.json (counts per drop reason). Deterministic. Prints counts only, never corpus text.
Drops, in order:
  private      visibility != public (every core file, without exception)
  core-copy    a public file whose text is the same as, or a near-duplicate of, any core file (the private
               corpus entries, plus every text file of --core-dir when given). Public repos that vendor core
               code (or that core vendors) would otherwise put core files back in under a public name.
  path         generated / vendored / fixture / snapshot / data-like paths (dist, vendor, fixtures, *.min.*, .d.ts, ...)
  data-like    long average lines, few letters, or mostly literals (tables, encoded blobs, test vectors)
  exact-dup    same text after whitespace normalisation as an earlier file
  near-dup     MinHash Jaccard >= 0.8 on 8-token shingles with an earlier file (held-out files are kept first,
               so a train file never near-duplicates a held-out one)
"""
import argparse, hashlib, json, os, re, subprocess

ap = argparse.ArgumentParser()
ap.add_argument("--in", dest="src", required=True)
ap.add_argument("--out", required=True)
ap.add_argument("--near", type=float, default=0.8)
ap.add_argument("--core-dir", default="")
args = ap.parse_args()

PATH_DROP = re.compile(r"(^|/)(dist|build|out|vendor|vendored|third[_-]?party|node_modules|fixtures?|__fixtures__|__snapshots__|snapshots?|testdata|test-data|generated|gen|coverage|benchmarks?/data)(/|$)"
                       r"|\.min\.[jt]s$|\.d\.ts$|\.generated\.|_pb\.|\.pb\.|(^|/)(package-lock|yarn\.lock|pnpm-lock)|\.(json|csv|tsv|snap|map|lock|svg|txt)$", re.I)
TOKEN = re.compile(r"[A-Za-z_$][\w$]*|\d+|\S")
NPERM, BANDS = 64, 16
MASK = (1 << 61) - 1
perms = [(int(hashlib.sha256(f"a{i}".encode()).hexdigest()[:15], 16) | 1, int(hashlib.sha256(f"b{i}".encode()).hexdigest()[:15], 16)) for i in range(NPERM)]


def data_like(text):
    lines = [l for l in text.split("\n") if l.strip()]
    if not lines:
        return True
    avg = sum(len(l) for l in lines) / len(lines)
    letters = sum(c.isalpha() for c in text) / max(1, len(text))
    literal = sum(1 for l in lines if re.fullmatch(r"\s*[\[\]{}(),\d.\-+eE\"'xXa-fA-F:\s]*,?\s*", l)) / len(lines)
    return avg > 160 or letters < 0.35 or literal > 0.5


def minhash(text):
    toks = TOKEN.findall(text)
    sh = {hash_(" ".join(toks[i:i + 8])) for i in range(max(1, len(toks) - 7))}
    return tuple(min(((a * h + b) & MASK) for h in sh) for a, b in perms)


def hash_(s):
    return int.from_bytes(hashlib.blake2b(s.encode(), digest_size=8).digest(), "big")


docs = {}
for line in open(os.path.join(args.src, "docs.jsonl"), encoding="utf-8"):
    if line.strip():
        d = json.loads(line)
        docs[d["doc"]] = d["text"]
man = [json.loads(l) for l in open(os.path.join(args.src, "manifest.jsonl"), encoding="utf-8") if l.strip()]
# Core reference set: private corpus entries plus (optionally) every text file in a core checkout.
core_texts = [docs[m["doc"]] for m in man if m.get("visibility") != "public"]
if args.core_dir:
    for p in subprocess.run(["git", "ls-files", "-z"], cwd=args.core_dir, capture_output=True, check=True).stdout.decode().split("\0"):
        full = os.path.join(args.core_dir, p)
        if p and os.path.isfile(full) and os.path.getsize(full) < 2_000_000:
            try:
                core_texts.append(open(full, encoding="utf-8").read())
            except (UnicodeDecodeError, OSError):
                pass
norm_of = lambda t: hashlib.sha256(re.sub(r"\s+", " ", t).strip().encode()).hexdigest()  # noqa: E731
core_raw = {hashlib.sha256(t.encode()).hexdigest() for t in core_texts}
core_norm = {norm_of(t) for t in core_texts}
core_buckets, core_sigs = {}, []
for t in core_texts:
    sig = minhash(t)
    for b in range(BANDS):
        core_buckets.setdefault((b, sig[b * (NPERM // BANDS):(b + 1) * (NPERM // BANDS)]), []).append(len(core_sigs))
    core_sigs.append(sig)


def core_copy(t):
    if hashlib.sha256(t.encode()).hexdigest() in core_raw or norm_of(t) in core_norm:
        return True
    sig, rows = minhash(t), NPERM // BANDS
    cands = set()
    for b in range(BANDS):
        cands.update(core_buckets.get((b, sig[b * rows:(b + 1) * rows]), ()))
    return any(sum(x == y for x, y in zip(sig, core_sigs[c])) / NPERM >= args.near for c in cands)


# Held-out first, then train; stable by doc id.
order = sorted(man, key=lambda m: (m["split"] != "heldout", m["doc"]))
reasons, kept, exact, buckets, sigs = {}, [], set(), {}, {}
drop = lambda r: reasons.__setitem__(r, reasons.get(r, 0) + 1)  # noqa: E731
for m in order:
    t = docs[m["doc"]]
    if m.get("visibility") != "public":
        drop("private"); continue
    if core_copy(t):
        drop("core-copy"); continue
    if PATH_DROP.search(m["path"]):
        drop("path"); continue
    if data_like(t):
        drop("data-like"); continue
    norm = hashlib.sha256(re.sub(r"\s+", " ", t).strip().encode()).hexdigest()
    if norm in exact:
        drop("exact-dup"); continue
    exact.add(norm)
    sig = minhash(t)
    rows = NPERM // BANDS
    cands = set()
    for b in range(BANDS):
        cands.update(buckets.get((b, sig[b * rows:(b + 1) * rows]), ()))
    if any(sum(x == y for x, y in zip(sig, sigs[c])) / NPERM >= args.near for c in cands):
        drop("near-dup"); continue
    for b in range(BANDS):
        buckets.setdefault((b, sig[b * rows:(b + 1) * rows]), []).append(m["doc"])
    sigs[m["doc"]] = sig
    kept.append(m)
kept.sort(key=lambda m: m["doc"])
os.makedirs(args.out, exist_ok=True)
with open(os.path.join(args.out, "docs.jsonl"), "w", encoding="utf-8") as f:
    for m in kept:
        f.write(json.dumps({"doc": m["doc"], "text": docs[m["doc"]]}) + "\n")
with open(os.path.join(args.out, "manifest.jsonl"), "w", encoding="utf-8") as f:
    for m in kept:
        f.write(json.dumps(m) + "\n")
by = {}
for m in kept:
    s = by.setdefault(m["source"], {"files": 0, "bytes": 0, "license": m["license"]})
    s["files"] += 1; s["bytes"] += m["bytes"]
summary = {"schema": "peaceai-lm-corpus-filter:v1", "kept": len(kept), "dropped": reasons, "sources": by,
           "heldout": sum(m["split"] == "heldout" for m in kept), "private_kept": sum(m.get("visibility") != "public" for m in kept)}
json.dump(summary, open(os.path.join(args.out, "filter.json"), "w"), indent=1, sort_keys=True)
print(json.dumps(summary, sort_keys=True))
