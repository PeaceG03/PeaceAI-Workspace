#!/usr/bin/env bash
# LM retrain replay (forgetting fix after run 40375535718): build the replay corpus and prove, BEFORE any training,
# that it overlaps neither set C v2 nor the judge-v2 items.
#   MODE=<finetune|pretrain> lm-retrain-replay.sh <work> <judge-items.json>   (needs <work>/setc and <work>/ft from lm-retrain-corpus.sh)
# MODE (lm-retrain-mode.sh allowlist; anything else refused) picks the replay train cap: finetune replay.trainMaxBytes,
# pretrain replay.pretrainTrainMaxBytes (the full train split; replay_corpus.py refuses if any train doc is left out).
# 1. the public ext manifest at replay.source (anonymous partial fetch of the public Workspace repo; sha256-pinned);
# 2. replay_corpus.py plan: rebuilds the live model's training manifest from it (must hash to replay.manifestSha256) and
#    selects the replay train docs and the pretrain-heldout val docs (and keeps that rebuilt manifest as
#    <work>/replay-live-manifest.jsonl for the memcheck proof chain); this script fetches them at their pinned commits;
#    replay_corpus.py assemble checks each file's sha256 against the manifest;
# 3. eval_dedup.py against set C v2 and the judge items (same window / exact / short rules as the fine-tune corpus;
#    re-check must be 0) into <work>/replay, report <work>/replay-dedup.json;
# 4. replay_proof.py: doc-id and sha256 proof of no overlap with set C v2 / the judge items and train/val disjointness,
#    <work>/replay-proof.json (with the plan stats <work>/replay-plan.json and the sha256 / bytes of the docs.jsonl train.py
#    reads); refuses on any overlap, or in pretrain mode unless the plan took the full train split. Counts and shas only.
set -euo pipefail
work="$1"; items="$2"
mode=$(./peaceai/bin/lm-retrain-mode.sh)
cfg=peaceai/model/lm-retrain.json; py="${PEACEAI_PYTHON:-python3}"
src_repo=$(jq -r .replay.source.repo "$cfg"); src_commit=$(jq -r .replay.source.commit "$cfg"); src_path=$(jq -r .replay.source.path "$cfg")
[[ "$src_repo" =~ ^PeaceG03/[A-Za-z0-9._-]+$ && "$src_commit" =~ ^[0-9a-f]{40}$ && "$src_path" =~ ^[A-Za-z0-9._/-]+$ ]] || { echo "unpinned replay source: refused"; exit 1; }
[ -f "$work/setc/docs.jsonl" ] && [ -f "$work/ft/manifest.jsonl" ] || { echo "set C v2 / fine-tune corpus missing: run lm-retrain-corpus.sh first"; exit 1; }
s="$work/replay-src"; rm -rf "$s" "$work/replay-git" "$work/replay-raw" "$work/replay" "$work/replay-blobs"; mkdir -p "$s"
git -C "$s" init -q; git -C "$s" remote add origin "https://github.com/$src_repo.git"
git -C "$s" fetch -q --depth 1 --filter=blob:none --no-tags origin "$src_commit"
git -C "$s" show "$src_commit:$src_path" > "$work/replay-src.jsonl"
plan="$work/replay-plan.jsonl"; blobs="$work/replay-blobs"; mkdir -p "$blobs" "$work/replay-git"
rm -f "$work/replay-plan.json" "$work/replay-live-manifest.jsonl"
"$py" peaceai/model/replay_corpus.py plan --mode "$mode" --source "$work/replay-src.jsonl" --config "$cfg" --plan "$plan" --stats "$work/replay-plan.json" --manifest-out "$work/replay-live-manifest.jsonl"
# Fetch: per (repo, commit), an anonymous partial clone at the pinned commit with a no-cone sparse checkout of exactly the
# planned paths; each planned blob is written to <blobs>/<plan index>; replay_corpus.py assemble checks every sha256.
while IFS=$'\t' read -r repo commit; do
  [[ "$repo" =~ ^[A-Za-z0-9._-]+/[A-Za-z0-9._-]+$ && "$commit" =~ ^[0-9a-f]{40}$ ]] || { echo "unpinned replay repo: refused"; exit 1; }
  d="$work/replay-git/$(printf '%s@%s' "$repo" "$commit" | sha256sum | cut -c1-16)"
  git init -q "$d"; git -C "$d" remote add origin "https://github.com/$repo.git"
  jq -r --arg r "$repo" --arg c "$commit" 'select(.repo == $r and .commit == $c) | .pattern' "$plan" | git -C "$d" sparse-checkout set --no-cone --stdin
  git -C "$d" fetch -q --depth 1 --filter=blob:none --no-tags origin "$commit"
  git -C "$d" -c advice.detachedHead=false checkout -q --detach FETCH_HEAD
  test "$(git -C "$d" rev-parse HEAD)" = "$commit" || { echo "replay: fetched head is not the pinned commit: refused"; exit 1; }
  while IFS=$'\t' read -r i p; do
    [[ "$i" =~ ^[0-9]+$ ]] || { echo "bad plan index: refused"; exit 1; }
    git -C "$d" cat-file blob "$commit:$p" > "$blobs/$i"
  done < <(jq -r --arg r "$repo" --arg c "$commit" 'select(.repo == $r and .commit == $c) | "\(.i)\t\(.path)"' "$plan")
  rm -rf "$d"
done < <(jq -r '"\(.repo)\t\(.commit)"' "$plan" | sort -u)
"$py" peaceai/model/replay_corpus.py assemble --plan "$plan" --blobs "$blobs" --out "$work/replay-raw"
"$py" peaceai/model/eval_dedup.py --corpus "$work/replay-raw" --setc "$work/setc" --judge "$items" --out "$work/replay" --report "$work/replay-dedup.json" \
  --window "$(jq -r .dedup.window "$cfg")" --short-min "$(jq -r .dedup.shortMin "$cfg")"
rm -rf "$s" "$work/replay-src.jsonl" "$work/replay-git" "$work/replay-raw" "$plan" "$blobs"
"$py" peaceai/model/replay_proof.py --replay "$work/replay" --dedup "$work/replay-dedup.json" --setc "$work/setc" --heldout-c peaceai/model/heldout-c.json \
  --judge "$items" --judge-sha "$(jq -r .eval.judgeItemsSha256 "$cfg")" --ft "$work/ft" \
  --mode "$mode" --plan-stats "$work/replay-plan.json" --out "$work/replay-proof.json"
