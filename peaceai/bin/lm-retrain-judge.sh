#!/usr/bin/env bash
# M119 (LM retrain): fetch the judge items (and, optionally, one model's recorded judge scores) from Results.
#   DEPLOY_KEY=<a Results key> [JUDGE_SET=v1] lm-retrain-judge.sh <dest> [<live-version>]
# Default (judge set v2, the retrain gate's set): lm-judge-v2/items.json on Results main, pinned by content
# (lm-retrain.json eval.judgeItemsSha256 and eval.judgeItemCount), so it works as soon as peace-lm-judge-v2.yml has landed
# lm-judge-v2/ and fails closed before that. The Results commit it was read from is written to <dest>/judge-commit.txt.
# JUDGE_SET=v1 (peace-lm-judge-v2.yml only): the v1 set under lm-judge/ on notes/lm-judge-eval, fetched by the exact
# pinned commit (eval.judgeV1.commit) so a moved branch cannot change the items.
# Writes <dest>/items.json and, with a version, <dest>/scores-live-recorded.json. Fails closed if the commit, either
# file, the items sha256 or the pinned item count is missing or different. git's own errors are not printed (no URLs).
set -euo pipefail
dest="$1"; ver="${2:-}"; cfg=peaceai/model/lm-retrain.json
[ -n "${DEPLOY_KEY:-}" ] || { echo "no Results key: refused (fail closed)"; exit 1; }
case "${JUDGE_SET:-v2}" in
  v1) c=$(jq -r .eval.judgeV1.commit "$cfg"); items=$(jq -r .eval.judgeV1.items "$cfg"); sha=$(jq -r .eval.judgeV1.itemsSha256 "$cfg"); n=$(jq -r .eval.judgeV1.itemCount "$cfg")
      [[ "$c" =~ ^[0-9a-f]{40}$ ]] || { echo "bad judge commit pin: refused"; exit 1; }
      [ "$items" = lm-judge/items.json ] || { echo "unexpected judge items path: refused"; exit 1; }
      want="$c" ;;
  v2) [ "$(jq -r .eval.judgeRef "$cfg")" = main ] || { echo "judge v2 is read from Results main only: refused"; exit 1; }
      items=$(jq -r .eval.judgeItems "$cfg"); sha=$(jq -r .eval.judgeItemsSha256 "$cfg"); n=$(jq -r .eval.judgeItemCount "$cfg")
      [ "$items" = lm-judge-v2/items.json ] || { echo "unexpected judge items path: refused"; exit 1; }
      want=refs/heads/main ;;
  *) echo "unknown JUDGE_SET: refused"; exit 1 ;;
esac
[[ "$sha" =~ ^[0-9a-f]{64}$ ]] || { echo "bad judge items sha256 pin: refused"; exit 1; }
[[ "$n" =~ ^[1-9][0-9]*$ ]] || { echo "bad judge item count pin: refused"; exit 1; }
[ -z "$ver" ] || [[ "$ver" =~ ^lm-v1-[0-9a-f]{12}$ ]] || { echo "bad version"; exit 1; }
dir="${items%/items.json}"
res="$dest/judge-res"; rm -rf "$res"; mkdir -p "$res"
git -C "$res" init --quiet; git -C "$res" remote add origin git@github.com:PeaceG03/PeaceAI-Results.git
paths=("/$items"); [ -z "$ver" ] || paths+=("/$dir/scores-$ver.json")
git -C "$res" sparse-checkout set --no-cone "${paths[@]}"
./peaceai/bin/with-deploy-key.sh git -C "$res" fetch --quiet --depth 1 --filter=blob:none origin "$want" 2>/dev/null || { echo "judge commit could not be fetched: refused"; exit 1; }
./peaceai/bin/with-deploy-key.sh git -C "$res" checkout --quiet --detach FETCH_HEAD 2>/dev/null || { echo "judge commit checkout failed: refused"; exit 1; }
got=$(git -C "$res" rev-parse HEAD)
[ "${JUDGE_SET:-v2}" != v1 ] || test "$got" = "$c" || { echo "judge checkout is not the pinned commit: refused"; exit 1; }
test -f "$res/$items" || { echo "judge items missing at the pinned commit: refused (not landed yet?)"; exit 1; }
test "$(sha256sum < "$res/$items" | cut -c1-64)" = "$sha" || { echo "judge items sha256 differs from the pin: refused"; exit 1; }
test "$(jq length "$res/$items")" = "$n" || { echo "judge item count changed: refused"; exit 1; }
cp "$res/$items" "$dest/items.json"; echo "$got" > "$dest/judge-commit.txt"
if [ -n "$ver" ]; then
  test -f "$res/$dir/scores-$ver.json" || { echo "recorded judge scores missing for $ver: refused"; exit 1; }
  test "$(jq -r .model "$res/$dir/scores-$ver.json")" = "$ver" || { echo "recorded judge scores are for another model: refused"; exit 1; }
  cp "$res/$dir/scores-$ver.json" "$dest/scores-live-recorded.json"
fi
rm -rf "$res"
echo "judge items fetched from the pinned commit: $(jq length "$dest/items.json") (set ${JUDGE_SET:-v2}, Results commit $got)"
