"""M9 core-free proof for a model's Results record (written at training time, next to the weights).

Manifest schemas: internal (lm-corpus.ts), external (ext-fetch.ts), fine-tune (M49 ft-pairs.ts; M52).
Usage: corefree_proof.py --corpus TRAIN_CORPUS_DIR --core-dir CORE_CHECKOUT --model MODEL_DIR [--near 0.8]
Writes MODEL_DIR/corefree-proof.json:
  schema, model (config.json version), noCoreFiles (PROVEN only if every file passes), manifestSha256,
  coreCommit, near {method, threshold}, files: [{doc, path, source, sha256, coreExact, coreNearMax}]
coreExact: the file's text equals a core file's (raw or whitespace-normalised), or it near-copies a pinned file
whose source is not its origin, or it holds a verbatim private-core span (coreContained >= CONTAIN_RUN shingles; M49 fix (2)). coreNearMax: the highest
MinHash Jaccard estimate (64 permutations, 16 bands, 8-token shingles; same as corpus_filter.py) against any
core text file that shares an LSH band (0.0 when none does). Deterministic. Prints counts only.
"""
import argparse, hashlib, json, os, re, subprocess, sys

ap = argparse.ArgumentParser()
ap.add_argument("--corpus", required=True)
ap.add_argument("--core-dir", required=True)
ap.add_argument("--model", required=True)
ap.add_argument("--near", type=float, default=0.8)
# M52 (Architect (a)): a two-corpus model (pretrain + fine-tune) gets one proof per corpus:
# MODEL_DIR/corefree-proof-<stage>.json, carrying "corpus": <stage>. Without --stage: the single-corpus file, unchanged.
ap.add_argument("--stage", choices=["pretrain", "finetune"])
# M49 fix (2) (Auditor #227): a fine-tune manifest is checked against git. DIR/<owner>/<repo> must be a git repo (bare
# is fine) holding <sha>; each doc must be a prefix of <sha>:<path>. Missing root, repo, commit or file: fail closed.
ap.add_argument("--source-root")
args = ap.parse_args()
PROOF_NAME = f"corefree-proof-{args.stage}.json" if args.stage else "corefree-proof.json"
# M40 (Auditor #160): a stale proof from an earlier run never survives a refused or crashed run.
try:
    os.remove(os.path.join(args.model, PROOF_NAME))
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
pin_origin = {}  # M49 fix (2): pin sha256 -> (public repo, path) parsed from the pin's "origin" ("owner/repo@commit:path")
ORIGIN_RE = re.compile(r"([A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+)@[0-9a-f]{7,40}:([A-Za-z0-9._/-]+)", re.ASCII)
try:
    po = json.load(open(os.path.join(args.core_dir, "docs", "peaceai-public-origin.json"), encoding="utf-8"))
    if po.get("schema") == "peaceai-public-origin:v1" and isinstance(po.get("files"), list) and all(
            isinstance(f, dict) and isinstance(f.get("path"), str) and re.fullmatch(r"[0-9a-f]{64}", str(f.get("sha256", ""))) for f in po["files"]):
        pins = {f["path"]: f["sha256"] for f in po["files"]}
        for f in po["files"]:
            o = ORIGIN_RE.fullmatch(f["origin"]) if isinstance(f.get("origin"), str) else None
            if o:
                pin_origin[f["sha256"]] = (o.group(1), o.group(2))
except (OSError, ValueError):
    pins, pin_origin = {}, {}
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


# M49 fix (2) (Auditor #227): containment, applied to every doc of every schema. Walk the doc's 8-token shingles in
# order; a shingle is private to core file F when F contains it and no pinned public-origin file does. The doc is
# refused (coreExact) when it holds a verbatim span of CONTAIN_RUN consecutive shingles all private to ONE core file
# (CONTAIN_RUN + 7 = 39 tokens; tokens count every punctuation mark, so this is about 2 lines of code). Catches a pinned
# file (or any public text) padded with a few verbatim private lines, and half-core dilution that MinHash averages away.
# Measured on the M49 corpora: single-line idioms (comparators, a 40-hex regex, typeof guards) reach 16-24 shingles in
# one core file, and runs stitched across different core files are not copies, so neither counts.
CONTAIN_RUN = 32


def shingle_seq(text):
    toks = TOKEN.findall(text)
    return [hash_(" ".join(toks[i:i + 8])) for i in range(len(toks) - 7)]


pinned_sh = set()
for _sha, t in pinned_texts:
    pinned_sh.update(shingle_seq(t))
private_idx = {}  # shingle -> ids of the non-pinned core files that hold it
for fid, t in enumerate(core_texts):
    for x in set(shingle_seq(t)) - pinned_sh:
        private_idx.setdefault(x, []).append(fid)


# Backstop (Architect): scattered copying with no long run. Refused when at least CONTAIN_TOTAL distinct shingles of
# the doc are private core shingles AND they are at least CONTAIN_FRAC of the doc's distinct shingles.
CONTAIN_TOTAL, CONTAIN_FRAC = 64, 0.10


def private_run(text):
    seq = shingle_seq(text)
    best, runs = 0, {}
    for x in seq:
        runs = {f: runs.get(f, 0) + 1 for f in private_idx.get(x, ())}
        if runs:
            best = max(best, max(runs.values()))
    uniq = set(seq)
    hits = sum(1 for x in uniq if x in private_idx)
    return best, hits, (hits / len(uniq) if uniq else 0.0)
core_norm = {norm(t) for t in core_texts}
buckets, sigs = {}, []
for t in core_texts:
    s = minhash(t)
    for b in range(BANDS):
        buckets.setdefault((b, s[b * ROWS:(b + 1) * ROWS]), []).append(len(sigs))
    sigs.append(s)

# M51: the corpus manifest may be one file or split parts (manifest/ + index.json), never both; fail closed.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import manifest_parts  # noqa: E402
try:
    man_text = manifest_parts.read_manifest_bytes(args.corpus, "manifest").decode("utf-8")
except ValueError as e:
    sys.exit(f"corefree_proof: manifest refused ({e})")
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


# M52 (Architect, M49 M5): a third schema, the M49 fine-tune manifest (ft-pairs.ts: doc, split, repo, sha, path,
# function; all six required, nothing else). Only Peace's public owner repos. It carries no content sha256, so the
# proof records the sha256 of the doc text itself. Unknown fields, mixed schemas or anything malformed: fail closed.
FT_KEYS = {"doc", "split", "repo", "sha", "path", "function"}


def ft_problem(m):
    if not isinstance(m, dict):
        return "not an object"
    unknown = set(m) - FT_KEYS
    if unknown:
        return f"unknown field {sorted(unknown)[0]}"
    if FT_KEYS - set(m):
        return f"missing field {sorted(FT_KEYS - set(m))[0]}"
    if type(m["doc"]) is not int or m["doc"] < 0 or not isinstance(m["path"], str) or not m["path"]:
        return "bad doc/path"
    if not isinstance(m["function"], str) or not m["function"]:
        return "bad function"
    if m["split"] not in ("train", "heldout"):
        return "bad split"
    if not isinstance(m["sha"], str) or not re.fullmatch(r"[0-9a-f]{40}", m["sha"]):
        return "bad sha"
    if not isinstance(m["repo"], str) or m["repo"] not in OWNER_PUBLIC:
        return "fine-tune entry: not a public owner repo"
    return None


is_ft = [isinstance(m, dict) and ("function" in m or "sha" in m) for m in man]  # keys only the fine-tune schema has
if any(is_ft) and not all(is_ft):
    sys.exit("corefree_proof: manifest refused (mixed fine-tune and other schema)")
schema = "finetune" if man and all(is_ft) else "external" if man and all(isinstance(m, dict) and "repo" in m for m in man) else "internal"
if args.stage and (schema == "finetune") != (args.stage == "finetune"):
    sys.exit(f"corefree_proof: --stage {args.stage} does not match the {schema} manifest")
if schema == "finetune":
    for m in man:
        why = ft_problem(m)
        if why:
            sys.exit(f"corefree_proof: fine-tune manifest refused (doc {m.get('doc') if isinstance(m, dict) else '?'}: {why})")
elif schema == "external":
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
if schema == "finetune":
    # M49 fix (2): every fine-tune doc must be a prefix of the file it claims to come from, read from git.
    if not args.source_root:
        sys.exit("corefree_proof: fine-tune manifest refused (no --source-root to check docs against git)")
_git_files = {}


def git_file(repo, sha, path):
    key = (repo, sha, path)
    if key not in _git_files:
        gd = os.path.join(args.source_root, *repo.split("/"))
        r = subprocess.run(["git", "-C", gd, "cat-file", "blob", f"{sha}:{path}"], capture_output=True) if os.path.isdir(gd) else None
        if r is not None and r.returncode != 0 and subprocess.run(["git", "-C", gd, "cat-file", "-e", f"{sha}^{{commit}}"], capture_output=True).returncode != 0:
            subprocess.run(["git", "-C", gd, "fetch", "-q", "origin", sha], capture_output=True)
            r = subprocess.run(["git", "-C", gd, "cat-file", "blob", f"{sha}:{path}"], capture_output=True)
        try:
            _git_files[key] = r.stdout.decode("utf-8") if r is not None and r.returncode == 0 else None
        except UnicodeDecodeError:
            _git_files[key] = None
    return _git_files[key]


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
    src = m["source"] if schema == "internal" else m["repo"]
    tsha = hashlib.sha256(t.encode()).hexdigest()
    if schema == "finetune":
        m = {**m, "sha256": tsha}  # derived from the doc text (the fine-tune manifest carries none)
    if schema == "finetune":
        src_text = git_file(m["repo"], m["sha"], m["path"])
        if src_text is None or not src_text.startswith(t):
            sys.exit(f"corefree_proof: doc {m['doc']} is not a prefix of {m['repo']}@{m['sha']}:{m['path']} (or it cannot be read from git)")
    if tsha != m["sha256"]:
        sys.exit(f"corefree_proof: doc {m['doc']} text does not hash to its manifest sha256")
    if blank(t):
        # M39: empty / whitespace-only after normalisation: ignored (no wider byte threshold).
        ignored_empty += 1
        files.append({"doc": m["doc"], "path": m["path"], "source": src, "sha256": m["sha256"], "coreExact": False, "coreNearMax": 0.0, "coreContained": 0, "corePrivateShingles": 0})
        continue
    s = minhash(t)
    # Against allowlisted public-origin core files: fine only when the content sha256 IS that file's pin.
    hit_pin = {pinned_raw.get(tsha), pinned_norm.get(norm(t))} - {None}
    hit_pin |= {sha for sha, sg in pinned_sigs if sum(x == y for x, y in zip(s, sg)) / NPERM >= args.near}
    # M49 fix (2) (Architect option (i)): fine-tune docs are cut-off prefixes, often of a NEWER version of a pinned
    # public file, so their sha256 never equals the pin. Such a doc is accepted ONLY when every pinned file it matches
    # has a public origin whose repo AND path equal the doc's own source repo and path (e.g. a PeaceSTOCKS:src/features.ts
    # doc against the features.ts pin). Matching a pinned file from any other repo or path stays pin_bad (refused), and
    # the doc is still checked against every non-pinned core file below, so this never admits other core text.
    origin_ok = schema != "internal" and bool(hit_pin) and all(pin_origin.get(h) == (m["repo"], m["path"]) for h in hit_pin)
    pin_ok = bool(hit_pin) and (hit_pin == {tsha} or origin_ok)
    pin_bad = bool(hit_pin) and not pin_ok
    allowlisted += pin_ok
    contained, priv_hits, priv_frac = private_run(t)  # longest one-file verbatim private span; scattered private shingles
    scattered = priv_hits >= CONTAIN_TOTAL and priv_frac >= CONTAIN_FRAC
    exact = contained >= CONTAIN_RUN or scattered or pin_bad or hashlib.sha256(t.encode()).hexdigest() in core_raw or m.get("sha256") in core_raw or norm(t) in core_norm
    cands = set()
    for b in range(BANDS):
        cands.update(buckets.get((b, s[b * ROWS:(b + 1) * ROWS]), ()))
    near = max((sum(x == y for x, y in zip(s, sigs[c])) / NPERM for c in cands), default=0.0)
    files.append({"doc": m["doc"], "path": m["path"], "source": src, "sha256": m["sha256"], "coreExact": bool(exact), "coreNearMax": round(near, 4), "coreContained": contained, "corePrivateShingles": priv_hits})
visible = all(m.get("visibility") == "public" for m in man) if schema == "internal" else True  # external/finetune: checked above
proven = len(files) > 0 and all((not f["coreExact"]) and f["coreNearMax"] < args.near for f in files) and visible
model = json.load(open(os.path.join(args.model, "config.json")))["version"]
core_commit = subprocess.run(["git", "rev-parse", "HEAD"], cwd=args.core_dir, capture_output=True, check=True, text=True).stdout.strip()
proof = {"schema": "peaceai-lm-corefree-proof:v1", "model": model, "noCoreFiles": "PROVEN" if proven else "NOT_PROVEN",
         "manifestSha256": hashlib.sha256(man_text.encode()).hexdigest(), "coreCommit": core_commit,
         "near": {"method": "minhash 64 perms / 16 bands / 8-token shingles", "threshold": args.near}, "files": files}
if args.stage:
    proof["corpus"] = args.stage
json.dump(proof, open(os.path.join(args.model, PROOF_NAME), "w"), indent=1)
print(json.dumps({"model": model, "noCoreFiles": proof["noCoreFiles"], "files": len(files), "coreExact": sum(f["coreExact"] for f in files), "coreContainedDocs": sum(f.get("coreContained", 0) >= CONTAIN_RUN for f in files),
                  "maxNear": max((f["coreNearMax"] for f in files), default=0.0), "coreFiles": len(core_texts),
                  "schema": schema, "ignoredEmpty": ignored_empty, "allowlistedPublicOrigin": allowlisted, "pinnedCoreFiles": len(pinned_texts)}))
