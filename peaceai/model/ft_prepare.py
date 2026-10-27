"""LM retrain (forgetting fix after run 40375535718): dedup and re-split the fine-tune pairs before the eval dedup.

Run 40375535718's fine-tune set held 18 distinct files with 85% duplicated lines (one doc per changed function per
merged PR, so every PR that touched a file added another near-copy of it), and its split was by (commit, path,
function), so 92% of the heldout lines were also in train. This step, on ft-pairs.ts --list output:
  1. one version per (repo, path, function): the LAST listed one is kept (the list is in merge order per repo), every
     earlier version of the same function is dropped;
  2. the split is by FILE PATH (replay.path_split), so no version of a file is on both sides;
  3. a heldout doc that shares any significant line (stripped, at least --line-min-chars characters; replay.
     significant_lines) with a train doc is dropped, so no significant heldout line appears in train.
Doc ids and every manifest field except "split" are unchanged. Writes --out (docs.jsonl + manifest.jsonl) and
--report (counts only). Refuses with no train doc left. Prints counts only.
  ft_prepare.py --in <ft-raw> --out <dir> --report <json> --line-min-chars N"""
import argparse
import hashlib
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import replay  # noqa: E402


def prepare(docs, man, line_min):
    """docs: {doc: text}; man: [manifest dict] in doc order. Returns (kept manifest dicts, report)."""
    if sorted(docs) != sorted(m["doc"] for m in man) or len(man) != len(docs):
        raise ValueError("docs.jsonl and manifest.jsonl doc ids differ")
    latest = {}
    for m in sorted(man, key=lambda m: m["doc"]):
        latest[(m["repo"], m["path"], m["function"])] = m["doc"]
    keep = set(latest.values())
    out = []
    for m in sorted(man, key=lambda m: m["doc"]):
        if m["doc"] in keep:
            out.append(dict(m, split=replay.path_split(m["repo"], m["path"])))
    train_lines = set()
    for m in out:
        if m["split"] == "train":
            train_lines |= replay.significant_lines(docs[m["doc"]], line_min)
    shared = {m["doc"] for m in out if m["split"] == "heldout" and replay.significant_lines(docs[m["doc"]], line_min) & train_lines}
    out = [m for m in out if m["doc"] not in shared]
    rep = {"schema": "peaceai-ft-prepare:v1", "lineMinChars": line_min, "docsIn": len(man), "keys": len(latest),
           "olderVersionsDropped": len(man) - len(keep), "heldoutSharedLineDropped": len(shared), "docsOut": len(out),
           "train": sum(m["split"] == "train" for m in out), "heldout": sum(m["split"] == "heldout" for m in out),
           "trainPaths": len({(m["repo"], m["path"]) for m in out if m["split"] == "train"}),
           "heldoutPaths": len({(m["repo"], m["path"]) for m in out if m["split"] == "heldout"})}
    if not rep["train"]:
        raise ValueError("no train doc left")
    return out, rep


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--in", dest="inp", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--report", required=True)
    ap.add_argument("--line-min-chars", type=int, required=True)
    a = ap.parse_args()
    docs = {}
    with open(os.path.join(a.inp, "docs.jsonl"), encoding="utf-8") as f:
        for line in f:
            if line.strip():
                o = json.loads(line)
                if o["doc"] in docs:
                    sys.exit("ft_prepare: doc listed twice")
                docs[o["doc"]] = o["text"]
    man = [json.loads(l) for l in open(os.path.join(a.inp, "manifest.jsonl"), encoding="utf-8") if l.strip()]
    try:
        out, rep = prepare(docs, man, a.line_min_chars)
    except (ValueError, KeyError) as e:
        sys.exit(f"ft_prepare refused: {e}")
    os.makedirs(a.out, exist_ok=True)
    with open(os.path.join(a.out, "docs.jsonl"), "w", encoding="utf-8") as f:
        for m in out:
            f.write(json.dumps({"doc": m["doc"], "text": docs[m["doc"]]}, ensure_ascii=False) + "\n")
    with open(os.path.join(a.out, "manifest.jsonl"), "w", encoding="utf-8") as f:
        for m in out:
            f.write(json.dumps(m, ensure_ascii=False, separators=(",", ":")) + "\n")
    rep["outManifestSha256"] = hashlib.sha256(open(os.path.join(a.out, "manifest.jsonl"), "rb").read()).hexdigest()
    json.dump(rep, open(a.report, "w"), indent=1, sort_keys=True)
    print("ft_prepare " + " ".join(f"{k}={rep[k]}" for k in ("docsIn", "keys", "olderVersionsDropped", "heldoutSharedLineDropped", "train", "heldout", "trainPaths", "heldoutPaths")))


if __name__ == "__main__":
    main()
