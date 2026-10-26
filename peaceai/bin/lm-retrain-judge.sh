#!/usr/bin/env bash
# M119 (LM retrain): fetch the 364 judge items (and, optionally, one model's recorded judge scores) from Results.
#   DEPLOY_KEY=<a Results key> lm-retrain-judge.sh <dest> [<live-version>]
# The judge set is not on Results main: it lives under lm-judge/ on the notes/lm-judge-eval branch. This fetches the
# exact pinned commit (lm-retrain.json eval.judgeCommit, from eval.judgeRef) by sha, sparse, so a moved branch cannot
# change the items. Writes <dest>/items.json and, with a version, <dest>/scores-live-recorded.json. Fails closed if
# the commit, either file or the pinned item count is missing or different. Counts only on stdout.
set -euo pipefail
dest="$1"; ver="${2:-}"; cfg=peaceai/model/lm-retrain.json
[ -n "${DEPLOY_KEY:-}" ] || { echo "no Results key: refused (fail closed)"; exit 1; }
c=$(jq -r .eval.judgeCommit "$cfg"); items=$(jq -r .eval.judgeItems "$cfg")
[[ "$c" =~ ^[0-9a-f]{40}$ ]] || { echo "bad judge commit pin: refused"; exit 1; }
[ "$items" = lm-judge/items.json ] || { echo "unexpected judge items path: refused"; exit 1; }
[ -z "$ver" ] || [[ "$ver" =~ ^lm-v1-[0-9a-f]{12}$ ]] || { echo "bad version"; exit 1; }
res="$dest/judge-res"; rm -rf "$res"; mkdir -p "$res"
git -C "$res" init --quiet; git -C "$res" remote add origin git@github.com:PeaceG03/PeaceAI-Results.git
paths=("/$items"); [ -z "$ver" ] || paths+=("/lm-judge/scores-$ver.json")
git -C "$res" sparse-checkout set --no-cone "${paths[@]}"
./peaceai/bin/with-deploy-key.sh git -C "$res" fetch --quiet --depth 1 --filter=blob:none origin "$c" || { echo "judge commit could not be fetched: refused"; exit 1; }
./peaceai/bin/with-deploy-key.sh git -C "$res" checkout --quiet --detach "$c" || { echo "judge commit checkout failed: refused"; exit 1; }
test "$(git -C "$res" rev-parse HEAD)" = "$c" || { echo "judge checkout is not the pinned commit: refused"; exit 1; }
test -f "$res/$items" || { echo "judge items missing at the pinned commit: refused"; exit 1; }
test "$(jq length "$res/$items")" = "$(jq -r .eval.judgeItemCount "$cfg")" || { echo "judge item count changed: refused"; exit 1; }
cp "$res/$items" "$dest/items.json"
if [ -n "$ver" ]; then
  test -f "$res/lm-judge/scores-$ver.json" || { echo "recorded judge scores missing for $ver: refused"; exit 1; }
  test "$(jq -r .model "$res/lm-judge/scores-$ver.json")" = "$ver" || { echo "recorded judge scores are for another model: refused"; exit 1; }
  cp "$res/lm-judge/scores-$ver.json" "$dest/scores-live-recorded.json"
fi
rm -rf "$res"
echo "judge items fetched from the pinned commit: $(jq length "$dest/items.json")"
