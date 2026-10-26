"""M119 (LM retrain, Auditor gate 2): drop every training doc that overlaps an eval item, before training.

Eval items: every doc of set C v2 (--setc DIR/docs.jsonl, from ext-fetch.ts --set-c) and every item of the 364-item
judge set (--judge items.json; each item checked as context+reference, context+derived, and the reference and the
derived text each on its own, so a short snippet of either inside a training doc is caught).
A training doc overlaps an eval item when any of:
  exact   the raw text, or the whitespace-normalised token sequence, is equal (sha256 of either form);
  window  the two share a run of --window code tokens (\\w+ or one punctuation char; all positions);
  short   an eval item shorter than --window tokens (and at least --short-min tokens) appears whole inside the
          doc's token sequence. Items under --short-min tokens (e.g. a 2-token "{}" file) are matched exactly only:
          containment of such a fragment says nothing about the eval item being in training.
Writes --out (docs.jsonl + manifest.jsonl, the kept docs with their ids unchanged) and --report (counts only).
--drop FILE (optional) also removes the doc ids listed in FILE (one int per line; e.g. a core-free proof's flagged docs).
The output corpus is re-checked; the script fails unless the re-check finds 0 overlaps.
Prints counts only, never text, item keys or hashes."""
import argparse, hashlib, json, os, re, sys

ap = argparse.ArgumentParser()
ap.add_argument("--corpus", required=True)
ap.add_argument("--setc", required=True)
ap.add_argument("--judge", required=True)
ap.add_argument("--out", required=True)
ap.add_argument("--report", required=True)
ap.add_argument("--drop", default="")
ap.add_argument("--window", type=int, default=24)
ap.add_argument("--short-min", type=int, default=8)
args = ap.parse_args()
W = args.window
TOK = re.compile(r"\w+|[^\w\s]")


def toks(t):
    return TOK.findall(t)


def sha(s):
    return hashlib.sha256(s.encode("utf-8")).hexdigest()


def read_docs(d):
    docs = []
    with open(os.path.join(d, "docs.jsonl"), encoding="utf-8") as f:
        for line in f:
            if line.strip():
                o = json.loads(line)
                docs.append((o["doc"], o["text"]))
    return docs


train = read_docs(args.corpus)
man = [json.loads(l) for l in open(os.path.join(args.corpus, "manifest.jsonl"), encoding="utf-8") if l.strip()]
if sorted(m["doc"] for m in man) != sorted(d for d, _ in train) or len({d for d, _ in train}) != len(train):
    sys.exit("eval_dedup: docs.jsonl and manifest.jsonl doc ids differ")
evals = [("setc", t) for _, t in read_docs(args.setc)]
items = json.load(open(args.judge, encoding="utf-8"))
if not isinstance(items, list) or not items:
    sys.exit("eval_dedup: judge items unreadable")
for it in items:
    for w in ("reference", "derived"):
        evals.append(("judge", str(it["context"]) + str(it[w])))
        evals.append(("judge", str(it[w])))  # alone too: a short reference/derived snippet inside a training doc
if not any(k == "setc" for k, _ in evals):
    sys.exit("eval_dedup: set C v2 is empty: refused")


def overlaps(docs):
    """doc id -> set of eval kinds it overlaps (exact / window / short)."""
    raw = {}
    norm = {}
    win = {}
    seqs = {}
    for d, t in docs:
        raw.setdefault(sha(t), set()).add(d)
        tt = toks(t)
        seqs[d] = " " + " ".join(tt) + " "
        norm.setdefault(sha(" ".join(tt)), set()).add(d)
        for i in range(len(tt) - W + 1):
            win.setdefault(hash(tuple(tt[i:i + W])), set()).add(d)
    hit = {}  # doc -> {(kind, method)}
    ev_hit = {"setc": 0, "judge": 0}
    for kind, t in evals:
        tt = toks(t)
        found = set()
        for d in raw.get(sha(t), ()):
            found.add((d, "exact"))
        for d in norm.get(sha(" ".join(tt)), ()):
            found.add((d, "exact"))
        if len(tt) >= W:
            for i in range(len(tt) - W + 1):
                ds = win.get(hash(tuple(tt[i:i + W])))
                if ds:
                    for d in ds:
                        found.add((d, "window"))
        elif len(tt) >= args.short_min:
            needle = " " + " ".join(tt) + " "
            for d, s in seqs.items():
                if needle in s:
                    found.add((d, "short"))
        if found:
            ev_hit[kind] += 1
        for d, m in found:
            hit.setdefault(d, set()).add((kind, m))
    return hit, ev_hit


hit, ev_hit = overlaps(train)
drop_extra = set()
if args.drop:
    for line in open(args.drop):
        if line.strip():
            drop_extra.add(int(line))
    unknown = drop_extra - {d for d, _ in train}
    if unknown:
        sys.exit("eval_dedup: --drop lists ids not in the corpus")
gone = set(hit) | drop_extra
kept = [(d, t) for d, t in train if d not in gone]
if not kept:
    sys.exit("eval_dedup: nothing left after dedup")
os.makedirs(args.out, exist_ok=True)
with open(os.path.join(args.out, "docs.jsonl"), "w", encoding="utf-8") as f:
    for d, t in kept:
        f.write(json.dumps({"doc": d, "text": t}, ensure_ascii=False) + "\n")
with open(os.path.join(args.out, "manifest.jsonl"), "w", encoding="utf-8") as f:
    for m in man:
        if m["doc"] not in gone:
            f.write(json.dumps(m, ensure_ascii=False, separators=(",", ":")) + "\n")
recheck, _ = overlaps(kept)
meth = lambda k, m: sum(1 for s in hit.values() if (k, m) in s)
rep = {"schema": "peaceai-lm-eval-dedup:v1", "window": W, "shortMin": args.short_min,
       "evalItemsExactOnly": sum(1 for _, t in evals if len(toks(t)) < args.short_min), "tokenizer": "regex \\w+|[^\\w\\s]",
       "docsIn": len(train), "docsOut": len(kept),
       "overlapDocs": len(hit), "overlapDocsSetC": sum(1 for s in hit.values() if any(k == "setc" for k, _ in s)),
       "overlapDocsJudge": sum(1 for s in hit.values() if any(k == "judge" for k, _ in s)),
       "byMethod": {f"{k}_{m}": meth(k, m) for k in ("setc", "judge") for m in ("exact", "window", "short")},
       "evalItemsHit": ev_hit, "evalItems": {"setc": sum(k == "setc" for k, _ in evals), "judge": sum(k == "judge" for k, _ in evals)},
       "droppedByList": len(drop_extra - set(hit)), "recheckOverlapDocs": len(recheck),
       "trainDocsOut": sum(1 for m in man if m["doc"] not in gone and m["split"] == "train"),
       "outManifestSha256": hashlib.sha256(open(os.path.join(args.out, "manifest.jsonl"), "rb").read()).hexdigest()}
json.dump(rep, open(args.report, "w"), indent=1)
print("eval_dedup " + " ".join(f"{k}={rep[k]}" for k in ("docsIn", "docsOut", "overlapDocs", "overlapDocsSetC", "overlapDocsJudge", "droppedByList", "recheckOverlapDocs")))
if recheck:
    sys.exit("eval_dedup: re-check found overlaps after dedup: refused")
