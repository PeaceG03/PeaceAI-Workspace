"""M9 core-free proof for a model's Results record (written at training time, next to the weights).

Usage: corefree_proof.py --corpus TRAIN_CORPUS_DIR --core-dir CORE_CHECKOUT --model MODEL_DIR [--near 0.8]
Writes MODEL_DIR/corefree-proof.json:
  schema, model (config.json version), noCoreFiles (PROVEN only if every file passes), manifestSha256,
  coreCommit, near {method, threshold}, files: [{doc, path, source, sha256, coreExact, coreNearMax}]
coreExact: the file's text equals a core file's (raw or whitespace-normalised). coreNearMax: the highest
MinHash Jaccard estimate (64 permutations, 16 bands, 8-token shingles; same as corpus_filter.py) against any
core text file that shares an LSH band (0.0 when none does). Deterministic. Prints counts only.
"""
import argparse, hashlib, json, os, re, subprocess, sys

ap = argparse.ArgumentParser()
ap.add_argument("--corpus", required=True)
ap.add_argument("--core-dir", required=True)
ap.add_argument("--model", required=True)
ap.add_argument("--near", type=float, default=0.8)
args = ap.parse_args()
# M40 (Auditor #160): a stale proof from an earlier run never survives a refused or crashed run.
try:
    os.remove(os.path.join(args.model, "corefree-proof.json"))
except FileNotFoundError:
    pass
# M40: ASCII whitespace only (Python's \s also matches NBSP, U+2000-200A, U+3000, \x1c-\x1f, U+FEFF); same set as JS.
ASCII_WS = re.compile(r"[ \t\r\n\f\v]+")
blank = lambda t: not ASCII_WS.sub("", t)  # noqa: E731

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


# M39 (Architect): core's public-origin allowlist (docs/peaceai-public-origin.json, same rule as coreindex.ts): a core
# file is left out of the core index only when its path is pinned AND its exact bytes hash to the pin. A training file
# that matches a pinned file counts as non-core only when its own content sha256 equals that pin; anything else that
# copies or near-copies a pinned file is flagged like any core file. Malformed allowlist -> no pins (all files core).
pins = {}
try:
    po = json.load(open(os.path.join(args.core_dir, "docs", "peaceai-public-origin.json"), encoding="utf-8"))
    if po.get("schema") == "peaceai-public-origin:v1" and isinstance(po.get("files"), list) and all(
            isinstance(f, dict) and isinstance(f.get("path"), str) and re.fullmatch(r"[0-9a-f]{64}", str(f.get("sha256", ""))) for f in po["files"]):
        pins = {f["path"]: f["sha256"] for f in po["files"]}
except (OSError, ValueError):
    pins = {}
core_texts, pinned_texts = [], []  # pinned_texts: (pin sha256, text) of allowlisted public-origin core files
for p in subprocess.run(["git", "ls-files", "-z"], cwd=args.core_dir, capture_output=True, check=True).stdout.decode().split("\0"):
    full = os.path.join(args.core_dir, p)
    if p and os.path.isfile(full) and os.path.getsize(full) < 2_000_000:
        try:
            raw = open(full, "rb").read()
            t = raw.decode("utf-8")
        except (UnicodeDecodeError, OSError):
            continue
        if blank(t):
            continue  # M39: empty / whitespace-only core files carry no text to copy
        if p in pins and hashlib.sha256(raw).hexdigest() == pins[p]:
            pinned_texts.append((pins[p], t))
            continue
        core_texts.append(t)
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

# M39 (Architect): two manifest schemas. Internal (lm-corpus.ts: source + visibility, unchanged: every entry must be
# visibility "public"). External (ext-fetch.ts: repo + license + sha256): every field must be known, external repos
# must carry a permissive license and never be Peace's, and Peace's own repos only the public owner repos with the
# owner license. Unknown fields, mixed schemas or anything malformed: fail closed (exit 1, no proof written).
EXT_KEYS = {"doc", "stage", "repo", "commit", "license", "path", "sha256", "bytes", "origin", "split"}
EXT_REQUIRED = {"doc", "repo", "commit", "license", "path", "sha256", "origin"}
PERMISSIVE = {"MIT", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "ISC"}
OWNER_PUBLIC = {"PeaceG03/PeaceSTOCKS", "PeaceG03/PeaceAI-Workspace"}


def ext_problem(m):
    if not isinstance(m, dict):
        return "not an object"
    unknown = set(m) - EXT_KEYS
    if unknown:
        return f"unknown field {sorted(unknown)[0]}"
    if EXT_REQUIRED - set(m):
        return f"missing field {sorted(EXT_REQUIRED - set(m))[0]}"
    if type(m["doc"]) is not int or m["doc"] < 0 or not isinstance(m["path"], str) or not m["path"]:
        return "bad doc/path"  # M40: bools are not ints
    if "bytes" in m and (type(m["bytes"]) is not int or m["bytes"] < 0):
        return "bad bytes"
    if not isinstance(m["license"], str):
        return "bad license"
    if not re.fullmatch(r"[0-9a-f]{64}", str(m["sha256"])) or not re.fullmatch(r"[0-9a-f]{40}", str(m["commit"])):
        return "bad sha256/commit"
    repo = m["repo"]
    if not isinstance(repo, str) or not re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", repo, re.ASCII) or any(x[:1] in ".-" for x in repo.split("/")):
        return "bad repo"
    if m["origin"] == "external":
        if repo.lower().startswith("peaceg03/") or m["license"] not in PERMISSIVE:
            return "external entry: Peace repo or non-permissive license"
    elif m["origin"] == "owner-public":
        if repo not in OWNER_PUBLIC or m["license"] != "owner:PeaceG03":
            return "owner entry: not a public owner repo"
    else:
        return "bad origin"
    return None


schema = "external" if man and all(isinstance(m, dict) and "repo" in m for m in man) else "internal"
if schema == "external":
    for m in man:
        why = ext_problem(m)
        if why:
            sys.exit(f"corefree_proof: external manifest refused (doc {m.get('doc') if isinstance(m, dict) else '?'}: {why})")
elif any(not isinstance(m, dict) or "repo" in m or "source" not in m for m in man):
    sys.exit("corefree_proof: manifest refused (mixed or unknown schema)")
pinned_raw = {}
pinned_norm = {}
for sha, t in pinned_texts:
    pinned_raw[hashlib.sha256(t.encode()).hexdigest()] = sha
    pinned_norm[norm(t)] = sha
pinned_sigs = [(sha, minhash(t)) for sha, t in pinned_texts]
docs = {}
for line in open(os.path.join(args.corpus, "docs.jsonl"), encoding="utf-8"):
    if line.strip():
        d = json.loads(line)
        if type(d.get("doc")) is not int or d["doc"] in docs or not isinstance(d.get("text"), str):
            sys.exit("corefree_proof: docs.jsonl refused (bad or duplicate doc id)")
        docs[d["doc"]] = d["text"]
# M40 (Auditor #160): the docs and manifest id sets must be equal (no extra, missing or duplicate ids).
man_ids = [m.get("doc") if isinstance(m, dict) else None for m in man]
if len(set(man_ids)) != len(man_ids) or set(man_ids) != set(docs):
    sys.exit("corefree_proof: docs.jsonl and manifest.jsonl doc ids differ")
files = []
ignored_empty = 0
allowlisted = 0
for m in man:
    t = docs[m["doc"]]
    src = m["repo"] if schema == "external" else m["source"]
    tsha = hashlib.sha256(t.encode()).hexdigest()
    if tsha != m["sha256"]:
        sys.exit(f"corefree_proof: doc {m['doc']} text does not hash to its manifest sha256")
    if blank(t):
        # M39: empty / whitespace-only after normalisation: ignored (no wider byte threshold).
        ignored_empty += 1
        files.append({"doc": m["doc"], "path": m["path"], "source": src, "sha256": m["sha256"], "coreExact": False, "coreNearMax": 0.0})
        continue
    s = minhash(t)
    # Against allowlisted public-origin core files: fine only when the content sha256 IS that file's pin.
    hit_pin = {pinned_raw.get(tsha), pinned_norm.get(norm(t))} - {None}
    hit_pin |= {sha for sha, sg in pinned_sigs if sum(x == y for x, y in zip(s, sg)) / NPERM >= args.near}
    pin_ok = bool(hit_pin) and hit_pin == {tsha}
    pin_bad = bool(hit_pin) and not pin_ok
    allowlisted += pin_ok
    exact = pin_bad or hashlib.sha256(t.encode()).hexdigest() in core_raw or m.get("sha256") in core_raw or norm(t) in core_norm
    cands = set()
    for b in range(BANDS):
        cands.update(buckets.get((b, s[b * ROWS:(b + 1) * ROWS]), ()))
    near = max((sum(x == y for x, y in zip(s, sigs[c])) / NPERM for c in cands), default=0.0)
    files.append({"doc": m["doc"], "path": m["path"], "source": src, "sha256": m["sha256"], "coreExact": bool(exact), "coreNearMax": round(near, 4)})
visible = all(m.get("visibility") == "public" for m in man) if schema == "internal" else True  # external: checked above
proven = len(files) > 0 and all((not f["coreExact"]) and f["coreNearMax"] < args.near for f in files) and visible
model = json.load(open(os.path.join(args.model, "config.json")))["version"]
core_commit = subprocess.run(["git", "rev-parse", "HEAD"], cwd=args.core_dir, capture_output=True, check=True, text=True).stdout.strip()
proof = {"schema": "peaceai-lm-corefree-proof:v1", "model": model, "noCoreFiles": "PROVEN" if proven else "NOT_PROVEN",
         "manifestSha256": hashlib.sha256(man_text.encode()).hexdigest(), "coreCommit": core_commit,
         "near": {"method": "minhash 64 perms / 16 bands / 8-token shingles", "threshold": args.near}, "files": files}
json.dump(proof, open(os.path.join(args.model, "corefree-proof.json"), "w"), indent=1)
print(json.dumps({"model": model, "noCoreFiles": proof["noCoreFiles"], "files": len(files), "coreExact": sum(f["coreExact"] for f in files),
                  "maxNear": max((f["coreNearMax"] for f in files), default=0.0), "coreFiles": len(core_texts),
                  "schema": schema, "ignoredEmpty": ignored_empty, "allowlistedPublicOrigin": allowlisted, "pinnedCoreFiles": len(pinned_texts)}))
