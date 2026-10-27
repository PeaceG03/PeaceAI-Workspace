"""LM retrain replay: the overlap proof, run in the workflow BEFORE any training (Auditor condition 2).

Proves, by doc id and sha256, that the replay train docs (trained on) and the replay heldout docs (the only early-
stopping / step-selection data) overlap neither set C v2 nor the judge-v2 items, nor each other. Set C stays the
final gate only: this script reads set C and the judge items to EXCLUDE them, and nothing it writes is read by
train.py or the selection step except the replay corpus itself.
Checks (any failure exits 1 after printing the counts):
  judgeSha     sha256(items.json bytes) == --judge-sha (lm-retrain.json eval.judgeItemsSha256)
  repo         no replay doc's repo is a set C v2 repo (heldout-c.json sets.C[].repo)
  setcSha      no replay doc's text sha256 is in heldout-c.json contentSha256 or is the sha256 of a fetched set C doc
  judgeSha256  no replay doc's text sha256 equals the sha256 of any judge item's context, reference, derived,
               context+reference or context+derived
  dedup        the replay eval_dedup report (24-token window / exact / short vs set C + judge) has recheckOverlapDocs
               == 0 and outManifestSha256 == sha256 of --replay/manifest.jsonl
  trainVal     replay train and heldout doc ids are disjoint, and so are their text sha256s
  ftVal        no replay heldout doc's text sha256 is a fine-tune doc's (--ft, optional)
  docsMatch    docs.jsonl and manifest.jsonl list the same ids; every manifest line carries a 64-hex sha256 equal to
               its doc's text sha256 (so the doc ids and shas printed are the corpus actually used)
  planFull     (with --plan-stats) the plan stats are for --mode, and in pretrain mode the plan selected the FULL
               replay train split (fullTrainSplit, trainDocs == splitTrainDocs); --mode is checked against MODES
Records the corpus actually used (Auditor condition 3, continued pretraining): replayDocsSha256 / replayDocsBytes =
sha256 and byte size of --replay/docs.jsonl (the file train.py reads), trainBytes / valBytes = UTF-8 bytes of the
train / heldout texts, and the plan stats.
Prints counts and list shas only (never text): trainIdsSha256 / valIdsSha256 = sha256 over "<doc>\\t<text sha256>\\n"
in doc order; setcShaListSha256 = sha256 over the sorted unique set C shas (listed + fetched), one per line;
judgeItemsSha256. Writes the same as JSON to --out.
  replay_proof.py --replay DIR --dedup JSON --setc DIR --heldout-c JSON --judge items.json --judge-sha HEX [--ft DIR]
                  [--mode finetune|pretrain --plan-stats JSON] --out JSON"""
import argparse
import hashlib
import json
import os
import sys

MODES = ("finetune", "pretrain")

def sha(s):
    return hashlib.sha256(s if isinstance(s, bytes) else s.encode("utf-8")).hexdigest()


def read_docs(d):
    out = {}
    with open(os.path.join(d, "docs.jsonl"), encoding="utf-8") as f:
        for line in f:
            if line.strip():
                o = json.loads(line)
                if o["doc"] in out:
                    raise ValueError("doc listed twice")
                out[o["doc"]] = o["text"]
    return out


def list_sha(pairs):
    return sha("".join(f"{d}\t{h}\n" for d, h in pairs))


def prove(replay_docs, replay_man, man_sha, dedup, setc_docs, heldout_c, items_bytes, judge_sha, ft_docs=None, mode=None, plan_stats=None, docs_bytes=None):
    fail = {}
    items = json.loads(items_bytes.decode("utf-8"))
    fail["judgeSha"] = 0 if sha(items_bytes) == judge_sha else 1
    man = {m["doc"]: m for m in replay_man}
    fail["docsMatch"] = 0 if set(man) == set(replay_docs) and len(man) == len(replay_man) else 1
    tsha = {d: sha(t) for d, t in replay_docs.items()}
    fail["docsMatch"] += sum(1 for d, m in man.items() if tsha.get(d) != m.get("sha256"))
    train = sorted(d for d, m in man.items() if m.get("split") == "train" and d in tsha)
    val = sorted(d for d, m in man.items() if m.get("split") == "heldout" and d in tsha)
    fail["docsMatch"] += sum(1 for m in man.values() if m.get("split") not in ("train", "heldout"))
    crepos = {e["repo"] for e in heldout_c["sets"]["C"]}
    fail["repo"] = sum(1 for d in train + val if man[d]["repo"] in crepos)
    cshas = {h for e in heldout_c["sets"]["C"] for h in e["contentSha256"]} | {sha(t) for t in setc_docs.values()}
    fail["setcSha"] = sum(1 for d in train + val if tsha[d] in cshas)
    jshas = set()
    for it in items:
        c, r, v = str(it["context"]), str(it["reference"]), str(it["derived"])
        jshas |= {sha(c), sha(r), sha(v), sha(c + r), sha(c + v)}
    fail["judgeSha256"] = sum(1 for d in train + val if tsha[d] in jshas)
    fail["dedup"] = 0 if dedup.get("recheckOverlapDocs") == 0 and dedup.get("outManifestSha256") == man_sha else 1
    fail["trainVal"] = len(set(train) & set(val)) + len({tsha[d] for d in train} & {tsha[d] for d in val})
    fail["ftVal"] = 0 if ft_docs is None else len({tsha[d] for d in val} & {sha(t) for t in ft_docs.values()})
    if mode is not None or plan_stats is not None:
        ps = plan_stats or {}
        fail["planFull"] = 0 if (mode in MODES and ps.get("mode") == mode and (mode != "pretrain" or (ps.get("fullTrainSplit") is True and ps.get("trainDocs") == ps.get("splitTrainDocs")))) else 1
    rep = {"schema": "peaceai-replay-proof:v1", "trainDocs": len(train), "valDocs": len(val),
           "trainRepos": len({man[d]["repo"] for d in train}), "valRepos": len({man[d]["repo"] for d in val}),
           "trainIdsSha256": list_sha((d, tsha[d]) for d in train), "valIdsSha256": list_sha((d, tsha[d]) for d in val),
           "replayManifestSha256": man_sha, "setcRepos": len(crepos), "setcShas": len(cshas), "setcShaListSha256": sha("".join(h + "\n" for h in sorted(cshas))),
           "judgeItems": len(items), "judgeShas": len(jshas), "judgeItemsSha256": sha(items_bytes),
           "ftDocsChecked": None if ft_docs is None else len(ft_docs),
           "trainBytes": sum(len(replay_docs[d].encode("utf-8")) for d in train), "valBytes": sum(len(replay_docs[d].encode("utf-8")) for d in val),
           "replayDocsSha256": None if docs_bytes is None else sha(docs_bytes), "replayDocsBytes": None if docs_bytes is None else len(docs_bytes),
           "mode": mode, "plan": plan_stats, "overlap": fail, "ok": not any(fail.values()) and bool(train) and bool(val)}
    return rep


def main():
    ap = argparse.ArgumentParser()
    for k in ("--replay", "--dedup", "--setc", "--heldout-c", "--judge", "--judge-sha", "--out"):
        ap.add_argument(k, required=True)
    ap.add_argument("--ft", default="")
    ap.add_argument("--mode", default=None)
    ap.add_argument("--plan-stats", default="")
    a = ap.parse_args()
    if (a.mode is None) != (not a.plan_stats):
        sys.exit("replay proof: --mode and --plan-stats go together: refused")
    mbytes = open(os.path.join(a.replay, "manifest.jsonl"), "rb").read()
    dbytes = open(os.path.join(a.replay, "docs.jsonl"), "rb").read()
    rep = prove(read_docs(a.replay), [json.loads(l) for l in mbytes.decode("utf-8").split("\n") if l.strip()], sha(mbytes),
                json.load(open(a.dedup, encoding="utf-8")), read_docs(a.setc), json.load(open(a.heldout_c, encoding="utf-8")),
                open(a.judge, "rb").read(), a.judge_sha, read_docs(a.ft) if a.ft else None,
                a.mode, json.load(open(a.plan_stats, encoding="utf-8")) if a.plan_stats else None, dbytes)
    json.dump(rep, open(a.out, "w"), indent=1, sort_keys=True)
    for k in ("trainDocs", "valDocs", "trainRepos", "valRepos", "trainIdsSha256", "valIdsSha256", "replayManifestSha256", "setcRepos", "setcShas", "setcShaListSha256", "judgeItems", "judgeShas", "judgeItemsSha256", "ftDocsChecked", "trainBytes", "valBytes", "replayDocsSha256", "replayDocsBytes", "mode"):
        print(f"replay proof {k}={rep[k]}")
    print("replay proof overlap " + " ".join(f"{k}={v}" for k, v in rep["overlap"].items()))
    if not rep["ok"]:
        print("replay proof: OVERLAP or unreadable input: refused")
        sys.exit(1)
    print("replay proof: no overlap with set C v2 or the judge-v2 items; train and val disjoint")


if __name__ == "__main__":
    main()
