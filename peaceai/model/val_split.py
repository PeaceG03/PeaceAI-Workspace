"""M119 (Auditor condition 1): the fine-tune validation split, carved from the training data only.

The split is the fine-tune corpus's own "heldout" docs (ft-pairs.ts assigns them; train.py's val_loss and early stopping
read only them). Set C v2 and the 364 judge items never enter it: eval_dedup.py removed every overlapping doc from the
WHOLE corpus (train and heldout) and the re-check must be 0 before this runs.

  val_split.py --corpus <ft dir> --dedup <dedup.json>
Prints one JSON line {docs, trainDocs, sha256}. sha256 = sha256 over "<doc>\\t<sha256 of the doc text, utf-8>\\n" for
every heldout doc in ascending doc order (public, reviewed data only; no text is printed). Refuses (exit 1): no heldout
docs, a doc listed twice or missing, a heldout text identical to a train text, a dedup re-check that is not 0.
"""
import argparse
import hashlib
import json
import os
import sys


def split_sha(corpus):
    docs, split = {}, {}
    with open(os.path.join(corpus, "docs.jsonl"), encoding="utf-8") as f:
        for line in f:
            if line.strip():
                d = json.loads(line)
                if d["doc"] in docs:
                    raise ValueError("doc listed twice")
                docs[d["doc"]] = d["text"]
    with open(os.path.join(corpus, "manifest.jsonl"), encoding="utf-8") as f:
        for line in f:
            if line.strip():
                m = json.loads(line)
                if m["doc"] in split or m["split"] not in ("train", "heldout"):
                    raise ValueError("bad manifest split")
                split[m["doc"]] = m["split"]
    if set(docs) != set(split):
        raise ValueError("docs and manifest disagree")
    held = sorted(i for i in docs if split[i] == "heldout")
    train = [i for i in docs if split[i] == "train"]
    if not held or not train:
        raise ValueError("empty split")
    th = lambda t: hashlib.sha256(t.encode("utf-8")).hexdigest()  # noqa: E731
    train_texts = {th(docs[i]) for i in train}
    lines = []
    for i in held:
        h = th(docs[i])
        if h in train_texts:
            raise ValueError("a validation doc is identical to a train doc")
        lines.append(f"{i}\t{h}\n")
    return {"docs": len(held), "trainDocs": len(train), "sha256": hashlib.sha256("".join(lines).encode("utf-8")).hexdigest()}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--corpus", required=True)
    ap.add_argument("--dedup", required=True)
    a = ap.parse_args()
    if json.load(open(a.dedup)).get("recheckOverlapDocs") != 0:
        print("validation split refused: eval overlap re-check is not 0")
        sys.exit(1)
    try:
        r = split_sha(a.corpus)
    except (ValueError, KeyError) as e:
        print(f"validation split refused: {e}")
        sys.exit(1)
    print(json.dumps(r, sort_keys=True))


if __name__ == "__main__":
    main()
