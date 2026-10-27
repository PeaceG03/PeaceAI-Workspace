"""LM retrain replay corpus (forgetting fix after run 40375535718): general code from the LIVE model's own pretrain
manifest, so the fine-tune keeps seeing what the live model learned, and pretrain-heldout docs for validation.

Source: the live model lm-v1-088073d41dbc was trained on manifest sha256 = replay.manifestSha256 in lm-retrain.json
(Results models/lm/<live>/manifest.jsonl; its corefree-proof.json says noCoreFiles PROVEN for that sha; lm-retrain-
live.sh checks both). That manifest is rebuilt here from the public ext manifest it was made from (replay.source:
repo/commit/path/sha256), by the training rule: drop the header line, append "split" = "heldout" iff
sha256(repo + "\\n" + path)[0] < round(256 * 5 / 100), else "train"; compact JSON lines, "\\n"-terminated. The rebuilt
bytes must hash to replay.manifestSha256 or this refuses; so every replay doc is a line of the live model's manifest,
with the live doc id and the live split (train docs were trained on, heldout docs never were).

Selection (deterministic, no RNG): key(doc) = sha256(salt + "\\n" + split + "\\n" + doc id), ascending.
  train: split=train docs in key order, each added while the running byte total stays <= the mode's cap:
         --mode finetune: replay.trainMaxBytes (pretrainTrainMaxBytes is never read);
         --mode pretrain: replay.pretrainTrainMaxBytes (continued pretraining on the full train split: every split=train
         doc must be selected, or this refuses). --mode is checked against the fixed allowlist MODES.
  val:   split=heldout docs with bytes >= valMinBytes in key order, the first valDocs (spread over many docs and repos
         by construction; train.py takes one window per doc).
Two offline steps around the fetch (model code never touches the network; lm-retrain-replay.sh fetches):
  replay_corpus.py plan --mode <finetune|pretrain> --source <ext-manifest.jsonl> --config <lm-retrain.json> --plan <plan.jsonl> [--stats <json>]
      checks both shas, selects, writes --stats {mode, trainCap, splitTrainDocs, splitTrainBytes, trainDocs, trainBytes,
      fullTrainSplit, valDocs, valBytes} and one JSON line per selected doc {i, doc, repo, commit, path, sha256, pattern
      (the no-cone sparse-checkout pattern for exactly that path), line (the doc's manifest line, byte-identical)}.
  replay_corpus.py assemble --plan <plan.jsonl> --blobs <dir with one file per plan index> --out <dir>
      each blob's sha256 (of its UTF-8 text) must equal the manifest's or this refuses; writes --out/docs.jsonl
      ({doc, text}) and --out/manifest.jsonl (the selected manifest lines, byte-identical, ascending doc id).
Prints counts and shas only, never text."""
import argparse
import hashlib
import json
import os
import re
import sys

REPO = re.compile(r"^[A-Za-z0-9._-]+/[A-Za-z0-9._-]+$")
COMMIT = re.compile(r"^[0-9a-f]{40}$")

HELDOUT_PERCENT = 5
MODES = ("finetune", "pretrain")


def train_cap(rc, mode):
    """The replay train byte cap for this mode. pretrainTrainMaxBytes is read in pretrain mode only."""
    if mode not in MODES:
        raise ValueError("unknown retrain mode")
    cap = rc["pretrainTrainMaxBytes"] if mode == "pretrain" else rc["trainMaxBytes"]
    if isinstance(cap, bool) or not isinstance(cap, int) or cap < 1:
        raise ValueError("bad replay train byte cap")
    return cap


def sha(b):
    return hashlib.sha256(b).hexdigest()


def split_of(repo, path):
    return "heldout" if hashlib.sha256(f"{repo}\n{path}".encode("utf-8")).digest()[0] < round(256 * HELDOUT_PERCENT / 100) else "train"


def rebuild(src_bytes):
    """The live training manifest from the public ext manifest: (manifest bytes, [(entry dict, line str)])."""
    lines = src_bytes.decode("utf-8").split("\n")
    head = json.loads(lines[0])
    if head.get("schema") != "peaceai-ext-manifest:v1":
        raise ValueError("source is not an ext manifest")
    out = []
    for l in lines[1:]:
        if not l:
            continue
        o = json.loads(l)
        o["split"] = split_of(o["repo"], o["path"])
        out.append((o, json.dumps(o, separators=(",", ":"), ensure_ascii=False)))
    if len(out) != head.get("entries"):
        raise ValueError("source entry count differs from its header")
    return ("\n".join(l for _, l in out) + "\n").encode("utf-8"), out


def select(entries, rc, cap):
    def key(o):
        return sha(f"{rc['salt']}\n{o['split']}\n{o['doc']}".encode("utf-8"))
    train, total = [], 0
    for o, l in sorted((e for e in entries if e[0]["split"] == "train"), key=lambda e: key(e[0])):
        if total + o["bytes"] <= cap:
            train.append((o, l))
            total += o["bytes"]
    val = [e for e in sorted((e for e in entries if e[0]["split"] == "heldout" and e[0]["bytes"] >= rc["valMinBytes"]), key=lambda e: key(e[0]))][:rc["valDocs"]]
    if not train or len(val) < rc["valDocs"]:
        raise ValueError("replay selection short")
    return train, val


def sparse_pattern(path):
    """A no-cone sparse-checkout (gitignore syntax) pattern matching exactly this path."""
    if any(c in path for c in "\n\r\t"):
        raise ValueError("path with a control character")
    return "/" + "".join("\\" + c if c in "*?[]\\!# " else c for c in path)


def plan(a, rc):
    if a.mode not in MODES:
        sys.exit("replay refused: unknown retrain mode")
    src = open(a.source, "rb").read()
    if sha(src) != rc["source"]["sha256"]:
        sys.exit("replay refused: source ext manifest sha256 differs from the pin")
    try:
        mbytes, entries = rebuild(src)
        if sha(mbytes) != rc["manifestSha256"]:
            sys.exit("replay refused: rebuilt manifest is not the live model's training manifest")
        cap = train_cap(rc, a.mode)
        train, val = select(entries, rc, cap)
        split_train = [o for o, _ in entries if o["split"] == "train"]
        stats = {"mode": a.mode, "trainCap": cap, "splitTrainDocs": len(split_train), "splitTrainBytes": sum(o["bytes"] for o in split_train),
                 "trainDocs": len(train), "trainBytes": sum(o["bytes"] for o, _ in train), "valDocs": len(val), "valBytes": sum(o["bytes"] for o, _ in val)}
        stats["fullTrainSplit"] = stats["trainDocs"] == stats["splitTrainDocs"]
        if a.mode == "pretrain" and not stats["fullTrainSplit"]:
            sys.exit("replay refused: pretrain mode must replay the full train split (pretrainTrainMaxBytes is below it)")
        rows = [dict(i=i, doc=o["doc"], repo=o["repo"], commit=o["commit"], path=o["path"], sha256=o["sha256"], pattern=sparse_pattern(o["path"]), line=l)
                for i, (o, l) in enumerate(sorted(train + val, key=lambda e: e[0]["doc"]))]
    except (ValueError, KeyError) as e:
        sys.exit(f"replay refused: {e}")
    for r in rows:
        if not REPO.match(r["repo"]) or not COMMIT.match(r["commit"]):
            sys.exit("replay refused: unpinned repo or commit in the manifest")
    with open(a.plan, "w", encoding="utf-8") as f:
        for r in rows:
            f.write(json.dumps(r, ensure_ascii=False, separators=(",", ":")) + "\n")
    if a.stats:
        with open(a.stats, "w", encoding="utf-8") as f:
            json.dump(stats, f, sort_keys=True)
    print(f"replay mode={a.mode} train_cap={cap} full_train_split={str(stats['fullTrainSplit']).lower()} split_train_docs={stats['splitTrainDocs']} split_train_bytes={stats['splitTrainBytes']}")
    print(f"replay manifest sha256={rc['manifestSha256']} entries={len(entries)} train_docs={len(train)} train_bytes={sum(o['bytes'] for o, _ in train)} "
          f"val_docs={len(val)} val_bytes={sum(o['bytes'] for o, _ in val)} repos={len({o['repo'] for o, _ in train + val})} val_repos={len({o['repo'] for o, _ in val})}")


def assemble(a):
    rows = [json.loads(l) for l in open(a.plan, encoding="utf-8") if l.strip()]
    texts = {}
    for r in rows:
        p = os.path.join(a.blobs, str(r["i"]))
        if not os.path.isfile(p):
            sys.exit(f"replay refused: doc {r['doc']} was not fetched")
        t = open(p, "rb").read().decode("utf-8", errors="replace")
        if sha(t.encode("utf-8")) != r["sha256"]:
            sys.exit(f"replay refused: doc {r['doc']} content sha256 differs from the manifest")
        texts[r["doc"]] = t
    os.makedirs(a.out, exist_ok=True)
    with open(os.path.join(a.out, "docs.jsonl"), "w", encoding="utf-8") as f:
        for r in rows:
            f.write(json.dumps({"doc": r["doc"], "text": texts[r["doc"]]}, ensure_ascii=False) + "\n")
    with open(os.path.join(a.out, "manifest.jsonl"), "w", encoding="utf-8") as f:
        for r in rows:
            f.write(r["line"] + "\n")
    print(f"replay fetched docs={len(rows)} manifest_sha256={sha(open(os.path.join(a.out, 'manifest.jsonl'), 'rb').read())}")


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("plan")
    p.add_argument("--mode", required=True)  # checked against MODES in plan() (no argparse default: unset is refused)
    p.add_argument("--stats", default="")
    p.add_argument("--source", required=True)
    p.add_argument("--config", required=True)
    p.add_argument("--plan", required=True)
    q = sub.add_parser("assemble")
    q.add_argument("--plan", required=True)
    q.add_argument("--blobs", required=True)
    q.add_argument("--out", required=True)
    a = ap.parse_args()
    if a.cmd == "plan":
        plan(a, json.load(open(a.config, encoding="utf-8"))["replay"])
    else:
        assemble(a)


if __name__ == "__main__":
    main()
