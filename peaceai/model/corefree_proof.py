"""M9 core-free proof for a model's Results record (written at training time, next to the weights).

Usage: corefree_proof.py --corpus TRAIN_CORPUS_DIR --core-dir CORE_CHECKOUT --model MODEL_DIR [--near 0.8]
Writes MODEL_DIR/corefree-proof.json:
  schema, model (config.json version), noCoreFiles (PROVEN only if every file passes), manifestSha256,
  coreCommit, near {method, threshold}, files: [{doc, path, source, sha256, coreExact, coreNearMax}]
coreExact: the file's text equals a core file's (raw or whitespace-normalised). coreNearMax: the highest
MinHash Jaccard estimate (64 permutations, 16 bands, 8-token shingles; same as corpus_filter.py) against any
core text file that shares an LSH band (0.0 when none does). Deterministic. Prints counts only.
"""
import argparse, hashlib, json, os, re, subprocess

ap = argparse.ArgumentParser()
ap.add_argument("--corpus", required=True)
ap.add_argument("--core-dir", required=True)
ap.add_argument("--model", required=True)
ap.add_argument("--near", type=float, default=0.8)
args = ap.parse_args()

TOKEN = re.compile(r"[A-Za-z_$][\w$]*|\d+|\S")
NPERM, BANDS = 64, 16
ROWS = NPERM // BANDS
MASK = (1 << 61) - 1
perms = [(int(hashlib.sha256(f"a{i}".encode()).hexdigest()[:15], 16) | 1, int(hashlib.sha256(f"b{i}".encode()).hexdigest()[:15], 16)) for i in range(NPERM)]
hash_ = lambda s: int.from_bytes(hashlib.blake2b(s.encode(), digest_size=8).digest(), "big")  # noqa: E731
norm = lambda t: hashlib.sha256(re.sub(r"\s+", " ", t).strip().encode()).hexdigest()  # noqa: E731


def minhash(text):
    toks = TOKEN.findall(text)
    sh = {hash_(" ".join(toks[i:i + 8])) for i in range(max(1, len(toks) - 7))}
    return tuple(min(((a * h + b) & MASK) for h in sh) for a, b in perms)


core_texts = []
for p in subprocess.run(["git", "ls-files", "-z"], cwd=args.core_dir, capture_output=True, check=True).stdout.decode().split("\0"):
    full = os.path.join(args.core_dir, p)
    if p and os.path.isfile(full) and os.path.getsize(full) < 2_000_000:
        try:
            core_texts.append(open(full, encoding="utf-8").read())
        except (UnicodeDecodeError, OSError):
            pass
core_raw = {hashlib.sha256(t.encode()).hexdigest() for t in core_texts}
core_norm = {norm(t) for t in core_texts}
buckets, sigs = {}, []
for t in core_texts:
    s = minhash(t)
    for b in range(BANDS):
        buckets.setdefault((b, s[b * ROWS:(b + 1) * ROWS]), []).append(len(sigs))
    sigs.append(s)

man_text = open(os.path.join(args.corpus, "manifest.jsonl"), encoding="utf-8").read()
man = [json.loads(l) for l in man_text.split("\n") if l.strip()]
docs = {}
for line in open(os.path.join(args.corpus, "docs.jsonl"), encoding="utf-8"):
    if line.strip():
        d = json.loads(line)
        docs[d["doc"]] = d["text"]
files = []
for m in man:
    t = docs[m["doc"]]
    exact = hashlib.sha256(t.encode()).hexdigest() in core_raw or m.get("sha256") in core_raw or norm(t) in core_norm
    s = minhash(t)
    cands = set()
    for b in range(BANDS):
        cands.update(buckets.get((b, s[b * ROWS:(b + 1) * ROWS]), ()))
    near = max((sum(x == y for x, y in zip(s, sigs[c])) / NPERM for c in cands), default=0.0)
    files.append({"doc": m["doc"], "path": m["path"], "source": m["source"], "sha256": m["sha256"], "coreExact": bool(exact), "coreNearMax": round(near, 4)})
proven = len(files) > 0 and all((not f["coreExact"]) and f["coreNearMax"] < args.near for f in files) and all(m.get("visibility") == "public" for m in man)
model = json.load(open(os.path.join(args.model, "config.json")))["version"]
core_commit = subprocess.run(["git", "rev-parse", "HEAD"], cwd=args.core_dir, capture_output=True, check=True, text=True).stdout.strip()
proof = {"schema": "peaceai-lm-corefree-proof:v1", "model": model, "noCoreFiles": "PROVEN" if proven else "NOT_PROVEN",
         "manifestSha256": hashlib.sha256(man_text.encode()).hexdigest(), "coreCommit": core_commit,
         "near": {"method": "minhash 64 perms / 16 bands / 8-token shingles", "threshold": args.near}, "files": files}
json.dump(proof, open(os.path.join(args.model, "corefree-proof.json"), "w"), indent=1)
print(json.dumps({"model": model, "noCoreFiles": proof["noCoreFiles"], "files": len(files), "coreExact": sum(f["coreExact"] for f in files),
                  "maxNear": max((f["coreNearMax"] for f in files), default=0.0), "coreFiles": len(core_texts)}))
