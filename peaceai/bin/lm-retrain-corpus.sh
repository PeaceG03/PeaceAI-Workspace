#!/usr/bin/env bash
# M119 (LM retrain): rebuild the retrain fine-tune corpus exactly, in every job that needs it.
#   lm-retrain-corpus.sh <work> <judge-items.json> [<drop-ids-file>]
# 1. anonymous clones of the public repos at the heads pinned in peaceai/model/lm-retrain.json (<work>/srcroot/<repo>,
#    also corefree_proof.py's --source-root), and lm-retrain-headcheck.sh: merged content == PR head content, file by
#    file (squash/rebase merges against refs/pull/N/head); 2. ft-pairs.ts --list over the reviewed commit list (sha256-pinned);
# 3. set C v2 (ext-fetch.ts --set-c) into <work>/setc; 4. eval_dedup.py against set C v2 and the judge items, also
#    dropping the ids in <drop-ids-file> (core-flagged docs), into <work>/ft with the report <work>/dedup.json.
# Counts only on stdout. Needs PEACEAI_PYTHON (numpy not needed) or python3.
set -euo pipefail
work="$1"; items="$2"; drops="${3:-}"
cfg=peaceai/model/lm-retrain.json; py="${PEACEAI_PYTHON:-python3}"
list=$(jq -r .list.file "$cfg"); lsha=$(jq -r .list.sha256 "$cfg")
[[ "$lsha" =~ ^[0-9a-f]{64}$ ]] || { echo "unpinned commit list: refused"; exit 1; }
specs=()
while read -r r sha; do
  [[ "$r" =~ ^PeaceG03/[A-Za-z0-9._-]+$ && "$sha" =~ ^[0-9a-f]{40}$ ]] || { echo "unpinned retrain repo: refused"; exit 1; }
  d="$work/srcroot/$r"
  if [ ! -d "$d" ]; then git clone --quiet "https://github.com/$r.git" "$d"; fi
  git -C "$d" checkout --quiet --detach "$sha"
  test "$(git -C "$d" rev-parse HEAD)" = "$sha" || { echo "pinned commit missing: refused"; exit 1; }
  specs+=("$r=$d@$sha")
done < <(jq -r '.list.repos | to_entries[] | "\(.key) \(.value)"' "$cfg")
./peaceai/bin/lm-retrain-headcheck.sh "$work/srcroot"
rm -rf "$work/ft-raw" "$work/ft"
./node_modules/.bin/tsx peaceai/bin/ft-pairs.ts "$work/ft-raw" --list "$list" --list-sha256 "$lsha" "${specs[@]}"
if [ ! -f "$work/setc/docs.jsonl" ]; then ./node_modules/.bin/tsx peaceai/bin/ext-fetch.ts "$work/csrc" "$work/setc" --set-c; rm -rf "$work/csrc"; fi
dargs=(); [ -n "$drops" ] && dargs=(--drop "$drops")
"$py" peaceai/model/eval_dedup.py --corpus "$work/ft-raw" --setc "$work/setc" --judge "$items" --out "$work/ft" --report "$work/dedup.json" \
  --window "$(jq -r .dedup.window "$cfg")" --short-min "$(jq -r .dedup.shortMin "$cfg")" "${dargs[@]}"
rm -rf "$work/ft-raw"
